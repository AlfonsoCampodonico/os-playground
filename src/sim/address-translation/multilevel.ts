import { PyRandom } from '../../lib/pyrandom';
import { commandLine, emptyRun, pd, px, type MlMachine, type Region, type Run, type RunError, type Step } from './common';

/** Flags of OSTEP's vm-smalltables/paging-multilevel-translate.py. */
export interface MlConfig {
  seed: number;
  /** -a: virtual pages to allocate. */
  allocated: number;
  /** -n: addresses to generate. */
  num: number;
  /** Addresses typed by the student (the script has no -A; generation comes last, so the memory is the same). */
  vas: number[] | null;
}

export const ML_DEFAULTS: Omit<MlConfig, 'vas'> = { seed: 0, allocated: 64, num: 10 };

class NoFrames extends Error {}

/** Reads a big-endian PDE/PTE: top bit VALID, the rest the frame number. */
export function readEntry(m: MlMachine, addr: number): { raw: number; valid: boolean; pfn: number } {
  let raw = 0;
  for (let k = 0; k < m.pteBytes; k++) raw = raw * 256 + m.memory[addr + k];
  const top = 2 ** (8 * m.pteBytes - 1);
  return { raw, valid: raw >= top, pfn: raw % top };
}

function writeEntry(m: MlMachine, addr: number, valid: boolean, pfn: number) {
  let raw = (valid ? 2 ** (8 * m.pteBytes - 1) : 0) + pfn;
  for (let k = m.pteBytes - 1; k >= 0; k--) {
    m.memory[addr + k] = raw % 256;
    raw = Math.floor(raw / 256);
  }
}

/** The OSTEP machine: 32-byte pages, 1024 virtual pages (15-bit VA), 128 frames, 1-byte PDE/PTE. */
export function buildOstepMachine(seed: number, allocated: number): { m: MlMachine; used: number[]; rng: PyRandom } {
  const rng = new PyRandom(seed);
  const pageSize = 32;
  const physPages = 128;
  const m: MlMachine = { pageBits: 5, pdBits: 5, ptBits: 5, pteBytes: 1, physPages, memory: new Uint8Array(pageSize * physPages), pdbr: 0, ptPages: new Map(), mapping: new Map() };
  const usedPages = new Uint8Array(physPages);
  let usedCount = 0;
  const findFree = () => {
    if (usedCount >= physPages) throw new NoFrames();
    let look = Math.trunc(rng.random() * physPages);
    while (usedPages[look] === 1) look = Math.trunc(rng.random() * physPages);
    usedCount++;
    usedPages[look] = 1;
    return look;
  };
  const initPage = (p: number) => m.memory.fill(0x7f, p << 5, (p << 5) + pageSize);

  m.pdbr = findFree();
  initPage(m.pdbr);
  const usedVp = new Uint8Array(1024);
  const used: number[] = [];
  for (let k = 0; k < allocated; k++) {
    let vp = Math.trunc(rng.random() * 1024);
    while (usedVp[vp] === 1) vp = Math.trunc(rng.random() * 1024);
    usedVp[vp] = 1;
    used.push(vp);
    const pp = findFree();
    // allocVirtualPage
    const va = vp << 5;
    const pdi = (va & 0x7c00) >> 10;
    const pdeAddr = (m.pdbr << 5) | pdi;
    let ptePage: number;
    if ((m.memory[pdeAddr] & 0x80) === 0) {
      ptePage = findFree();
      m.memory[pdeAddr] = 0x80 | ptePage;
      initPage(ptePage);
      m.ptPages.set(pdi, ptePage);
    } else {
      ptePage = m.memory[pdeAddr] & 0x7f;
    }
    m.memory[(ptePage << 5) | ((va & 0x03e0) >> 5)] = 0x80 | pp;
    m.mapping.set(vp, pp);
    // fillPage
    for (let j = 0; j < pageSize; j++) m.memory[pp * pageSize + j] = Math.trunc(rng.random() * 31);
  }
  return { m, used, rng };
}

/**
 * OSTEP ch. 20, "A Detailed Multi-Level Example" (fig. 20.5): 16 KB address
 * space, 64-byte pages, 4-byte PTEs, 16-entry page directory. VPNs 0, 1 (code),
 * 4, 5 (heap) and 254, 255 (stack) are mapped. The book does not say where the
 * directory lives or what the data pages hold; those are filled in here.
 */
export function buildBookMachine(): MlMachine {
  const m: MlMachine = { pageBits: 6, pdBits: 4, ptBits: 4, pteBytes: 4, physPages: 128, memory: new Uint8Array(64 * 128), pdbr: 73, ptPages: new Map(), mapping: new Map() };
  const pts: Record<number, number> = { 0: 100, 15: 101 };
  for (const [pdi, ptPage] of Object.entries(pts)) {
    writeEntry(m, m.pdbr * 64 + Number(pdi) * 4, true, ptPage);
    m.ptPages.set(Number(pdi), ptPage);
  }
  const map: [number, number][] = [
    [0, 10],
    [1, 23],
    [4, 80],
    [5, 59],
    [254, 55],
    [255, 45],
  ];
  const rng = new PyRandom(20);
  for (const [vpn, pfn] of map) {
    const pdi = vpn >> 4;
    writeEntry(m, pts[pdi] * 64 + (vpn & 15) * 4, true, pfn);
    m.mapping.set(vpn, pfn);
    for (let j = 0; j < 64; j++) m.memory[pfn * 64 + j] = Math.trunc(rng.random() * 31);
  }
  return m;
}

export const BOOK_ML_VAS = [0x3f80, 0x0000, 0x0110, 0x00c0, 0x0a00, 0x3fc4];

/** Walks the two-level table for every address. */
function translateAll(run: Run, m: MlMachine, vas: number[], ostep: boolean): RunError | null {
  const pageSize = 2 ** m.pageBits;
  const vaSize = 2 ** (m.pageBits + m.ptBits + m.pdBits);
  let valid = 0;
  let faults = 0;
  let totalReads = 0;
  for (let i = 0; i < vas.length; i++) {
    const va = vas[i];
    if (va >= vaSize) return { code: 'vaRange', msg: `virtual address ${va} cannot be generated in an address space of size ${vaSize}` };
    const offset = va % pageSize;
    const vpn = Math.floor(va / pageSize);
    const pti = vpn % 2 ** m.ptBits;
    const pdi = Math.floor(vpn / 2 ** m.ptBits);
    const pdeAddr = m.pdbr * pageSize + pdi * m.pteBytes;
    const pde = readEntry(m, pdeAddr);
    const lines = ostep ? [`Virtual Address 0x${px(va, 4)}:`, `  --> pde index:0x${px(pdi)} [decimal ${pdi}] pde contents:0x${px(pde.raw)} (valid ${+pde.valid}, pfn 0x${px(pde.pfn, 2)} [decimal ${pde.pfn}])`] : [];
    const base = { i, va, vpn, offset, pdi, pti, pdeAddr, pde: pde.raw, pdeValid: pde.valid, ostep: lines };
    let step: Step;
    if (!pde.valid) {
      faults++;
      totalReads += 1;
      if (ostep) lines.push('      --> Fault (page directory entry not valid)');
      step = { ...base, outcome: 'pdeFault', pa: null, region: null, valid, faults, reads: 1, totalReads };
    } else {
      const pteAddr = pde.pfn * pageSize + pti * m.pteBytes;
      const pte = readEntry(m, pteAddr);
      if (ostep) lines.push(`    --> pte index:0x${px(pti)} [decimal ${pti}] pte contents:0x${px(pte.raw)} (valid ${+pte.valid}, pfn 0x${px(pte.pfn, 2)} [decimal ${pte.pfn}])`);
      totalReads += 2;
      const more = { ptPage: pde.pfn, pteAddr, pte: pte.raw, pteValid: pte.valid, reads: 2, totalReads };
      if (!pte.valid) {
        faults++;
        if (ostep) lines.push('      --> Fault (page table entry not valid)');
        step = { ...base, ...more, outcome: 'pteFault', pa: null, region: `pt${pdi}`, valid, faults };
      } else {
        valid++;
        const pa = pte.pfn * pageSize + offset;
        const value = m.memory[pa];
        if (ostep) lines.push(`      --> Translates to Physical Address 0x${px(pa, 3)} --> Value: 0x${px(value, 2)}`);
        step = { ...base, ...more, outcome: 'ok', pa, pfn: pte.pfn, value, region: `p${vpn}`, valid, faults };
      }
    }
    run.steps.push(step);
  }
  return null;
}

function describe(run: Run, m: MlMachine) {
  const pageSize = 2 ** m.pageBits;
  run.vaBits = m.pageBits + m.ptBits + m.pdBits;
  run.paBits = m.pageBits + Math.ceil(Math.log2(m.physPages));
  run.asize = 2 ** run.vaBits;
  run.psize = pageSize * m.physPages;
  run.perTranslation = 2;
  run.tableBytes = (1 + m.ptPages.size) * pageSize;
  run.linearBytes = 2 ** (m.ptBits + m.pdBits) * m.pteBytes;
  const regions: Region[] = [{ id: 'pd', label: 'PD', kind: 'pd', color: 6, v: null, p: [m.pdbr * pageSize, (m.pdbr + 1) * pageSize] }];
  for (const [pdi, page] of [...m.ptPages].sort((a, b) => a[0] - b[0])) regions.push({ id: `pt${pdi}`, label: `PT ${pdi}`, kind: 'pt', color: 5, v: null, p: [page * pageSize, (page + 1) * pageSize] });
  for (const [vpn, pfn] of [...m.mapping].sort((a, b) => a[0] - b[0]))
    regions.push({ id: `p${vpn}`, label: `VP ${vpn}`, kind: 'page', color: (vpn % 4) + 1, v: [vpn * pageSize, (vpn + 1) * pageSize], p: [pfn * pageSize, (pfn + 1) * pageSize] });
  run.regions = regions;
}

/** Reproduces `paging-multilevel-translate.py -c`: same memory dump, PDBR and addresses for the same seed. */
export function runMl(cfg: MlConfig): Run {
  const run = emptyRun('ml');
  run.command = commandLine('paging-multilevel-translate.py', [
    ['-s', cfg.seed, 0],
    ['-a', cfg.allocated, 64],
    ['-n', cfg.num, 10],
  ]);
  if (cfg.vas) run.notes.push('noAFlag');
  const out = [`ARG seed ${cfg.seed}`, `ARG allocated ${cfg.allocated}`, `ARG num ${cfg.num}`, ''];
  if (cfg.allocated > 1024 || cfg.allocated < 0) {
    run.error = { code: 'noFrames', msg: 'cannot allocate that many pages' };
    return run;
  }
  let built: ReturnType<typeof buildOstepMachine>;
  try {
    built = buildOstepMachine(cfg.seed, cfg.allocated);
  } catch (e) {
    if (!(e instanceof NoFrames)) throw e;
    run.error = { code: 'noFrames', msg: 'ran out of physical pages (the script stops with an AssertionError)' };
    return run;
  }
  const { m, used, rng } = built;
  for (let i = 0; i < m.physPages; i++) out.push(`page ${pd(i, 3)}:` + Array.from(m.memory.subarray(i * 32, i * 32 + 32), (b) => px(b, 2)).join(''));
  out.push('', `PDBR: ${m.pdbr}  (decimal) [This means the page directory is held in this page]`, '');

  let vas = cfg.vas;
  if (!vas) {
    vas = [];
    for (let i = 0; i < cfg.num; i++) {
      if (rng.random() * 100 > 50.0 || i >= used.length) vas.push(Math.trunc(rng.random() * 1024 * 32));
      else vas.push((used[i] << 5) | Math.trunc(rng.random() * 32));
    }
  }
  run.vas = vas;
  describe(run, m);
  run.ml = { ...m, book: false };
  const err = translateAll(run, m, vas, true);
  if (err) {
    run.error = err;
    run.steps = [];
    return run;
  }
  for (const s of run.steps) out.push(...s.ostep);
  out.push('');
  run.output = out.join('\n');
  return run;
}

/** The ch. 20 example machine with the student's addresses. */
export function runBookMl(vas: number[]): Run {
  const run = emptyRun('ml');
  run.notes.push('book');
  const m = buildBookMachine();
  run.vas = vas;
  describe(run, m);
  run.ml = { ...m, book: true };
  const err = translateAll(run, m, vas, false);
  if (err) {
    run.error = err;
    run.steps = [];
  }
  return run;
}
