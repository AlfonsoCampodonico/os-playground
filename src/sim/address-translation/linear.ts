import { PyRandom } from '../../lib/pyrandom';
import { bitsFor, commandLine, convertSize, emptyRun, pd, px, type Run, type RunError, type Step } from './common';

/** Flags of OSTEP's vm-paging/paging-linear-translate.py. */
export interface LinConfig {
  seed: number;
  asize: string;
  psize: string;
  pagesize: string;
  num: number;
  /** -u: percent of the address space that is mapped. */
  used: number;
  /** -A: addresses to translate instead of random ones. */
  vas: number[] | null;
  /** Page table edited by hand (PFN per VPN, -1 = invalid); used only if its length matches. */
  table: number[] | null;
  /** -v: print the VPN next to each entry (only changes the output text). */
  verbose?: boolean;
}

export const LIN_DEFAULTS: Omit<LinConfig, 'vas' | 'table'> = { seed: 0, asize: '16k', psize: '64k', pagesize: '4k', num: 5, used: 50 };

/** More entries than this are not worth drawing (the script would print them all). */
export const MAX_VPAGES = 4096;

/** Reproduces `paging-linear-translate.py -c`: same page table and addresses for the same seed. */
export function runLin(cfg: LinConfig): Run {
  const run = emptyRun('lin');
  run.perTranslation = 1;
  const addresses = cfg.vas ? cfg.vas.join(',') : '-1';
  const out: string[] = [
    `ARG seed ${cfg.seed}`,
    `ARG address space size ${cfg.asize.trim()}`,
    `ARG phys mem size ${cfg.psize.trim()}`,
    `ARG page size ${cfg.pagesize.trim()}`,
    `ARG verbose ${cfg.verbose ? 'True' : 'False'}`,
    `ARG addresses ${addresses}`,
    '',
  ];
  run.command = commandLine('paging-linear-translate.py', [
    ['-s', cfg.seed, 0],
    ['-A', addresses, '-1'],
    ['-a', cfg.asize.trim(), '16k'],
    ['-p', cfg.psize.trim(), '64k'],
    ['-P', cfg.pagesize.trim(), '4k'],
    ['-n', cfg.vas ? 5 : cfg.num, 5],
    ['-u', cfg.used, 50],
  ]);
  if (cfg.vas) run.notes.push('customVas');

  const fail = (code: RunError['code'], msg: string, prefix = 'Error: ') => {
    out.push(prefix + msg);
    run.error = { code, msg };
    run.output = out.join('\n');
    run.steps = [];
    return run;
  };

  const rng = new PyRandom(cfg.seed);
  const asize = convertSize(cfg.asize);
  const psize = convertSize(cfg.psize);
  const pagesize = convertSize(cfg.pagesize);
  if ([asize, psize, pagesize].some((n) => !Number.isFinite(n)) || pagesize <= 0) return fail('badInput', 'cannot parse a size');
  run.asize = asize;
  run.psize = psize;

  if (psize <= 1) return fail('psizeSmall', 'must specify a non-zero physical memory size.');
  if (asize < 1) return fail('asizeZero', 'must specify a non-zero address-space size.');
  if (psize <= asize) return fail('psizeLeAsize', 'physical memory size must be GREATER than address space size (for this simulation)');
  if (psize >= 1024 ** 3 || asize >= 1024 ** 3) return fail('tooBig', 'must use smaller sizes (less than 1 GB) for this simulation.');
  if (Math.trunc(asize / pagesize) !== asize / pagesize) return fail('notMultiple', 'address space must be a multiple of the pagesize', 'Error in argument: ');
  if (Math.trunc(psize / pagesize) !== psize / pagesize) return fail('notMultiple', 'physical memory must be a multiple of the pagesize', 'Error in argument: ');

  const pages = Math.trunc(psize / pagesize);
  const vpages = Math.trunc(asize / pagesize);
  const vabits = Math.trunc(Math.log(asize) / Math.log(2.0));
  if (2 ** vabits !== asize) return fail('notPow2', 'address space must be a power of 2', 'Error in argument: ');
  const pagebits = Math.trunc(Math.log(pagesize) / Math.log(2.0));
  if (2 ** pagebits !== pagesize) return fail('notPow2', 'page size must be a power of 2', 'Error in argument: ');
  if (vpages > MAX_VPAGES) return fail('tooBig', `more than ${MAX_VPAGES} pages: too many to draw`);

  out.push(
    '',
    'The format of the page table is simple:',
    'The high-order (left-most) bit is the VALID bit.',
    '  If the bit is 1, the rest of the entry is the PFN.',
    '  If the bit is 0, the page is not valid.',
    'Use verbose mode (-v) if you want to print the VPN # by',
    'each entry of the page table.',
    '',
    'Page Table (from entry 0 down to the max size)',
  );

  // Same loop as the script: a collision re-rolls the valid test too.
  const usedFrames = new Uint8Array(pages);
  const generated: number[] = [];
  const threshold = 100.0 - cfg.used;
  for (let v = 0; v < vpages; v++) {
    for (;;) {
      if (rng.random() * 100.0 > threshold) {
        const u = Math.trunc(pages * rng.random());
        if (usedFrames[u] === 0) {
          usedFrames[u] = 1;
          generated.push(u);
          break;
        }
      } else {
        generated.push(-1);
        break;
      }
    }
  }

  const edited = cfg.table && cfg.table.length === vpages && cfg.table.every((p) => p === -1 || (Number.isInteger(p) && p >= 0 && p < pages));
  const table = edited ? [...cfg.table!] : generated;
  if (edited && table.some((p, i) => p !== generated[i])) run.notes.push('editedTable');

  table.forEach((u, v) => out.push((cfg.verbose ? `  [${pd(v, 8)}]  ` : '  ') + `0x${px(u < 0 ? 0 : 0x80000000 + u, 8)}`));
  out.push('');

  const vas = cfg.vas ?? Array.from({ length: Math.max(0, cfg.num) }, () => Math.trunc(asize * rng.random()));
  run.vas = vas;
  run.vaBits = vabits;
  run.paBits = bitsFor(psize);
  run.tableBytes = vpages * 4;
  run.linearBytes = vpages * 4;
  run.lin = { pageSize: pagesize, pageBits: pagebits, vpnBits: vabits - pagebits, table, pages, generated };
  run.regions = table.flatMap((pfn, vpn) =>
    pfn < 0 ? [] : [{ id: `p${vpn}`, label: `VP ${vpn}`, kind: 'page' as const, color: (vpn % 6) + 1, v: [vpn * pagesize, (vpn + 1) * pagesize] as [number, number], p: [pfn * pagesize, (pfn + 1) * pagesize] as [number, number] }],
  );

  out.push('Virtual Address Trace');
  let valid = 0;
  let faults = 0;
  for (let i = 0; i < vas.length; i++) {
    const va = vas[i];
    const vpn = Math.floor(va / pagesize);
    if (vpn >= vpages) return fail('vaRange', `virtual address ${va} cannot be generated in an address space of size ${asize}`);
    const offset = va % pagesize;
    const pfn = table[vpn];
    const pte = pfn < 0 ? 0 : 0x80000000 + pfn;
    const head = `  VA 0x${px(va, 8)} (decimal: ${pd(va, 8)}) --> `;
    let step: Step;
    const base = { i, va, vpn, offset, pte, reads: 1, totalReads: i + 1 };
    if (pfn < 0) {
      faults++;
      step = { ...base, outcome: 'invalid', pa: null, region: null, ostep: [head + ` Invalid (VPN ${vpn} not valid)`], valid, faults };
    } else {
      valid++;
      const pa = pfn * pagesize + offset;
      step = { ...base, outcome: 'ok', pa, pfn, region: `p${vpn}`, ostep: [head + `${px(pa, 8)} (decimal ${pd(pa, 8)}) [VPN ${vpn}]`], valid, faults };
    }
    out.push(...step.ostep);
    run.steps.push(step);
  }
  out.push('');
  run.output = out.join('\n');
  return run;
}
