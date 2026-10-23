import { PyRandom } from '../../lib/pyrandom';
import { bitsFor, commandLine, convertSize, emptyRun, isPow2, pd, px, type Region, type Run, type RunError, type Segment, type Step } from './common';

/** Flags of OSTEP's vm-segmentation/segmentation.py ("-1" = pick at random). */
export interface SegConfig {
  seed: number;
  asize: string;
  psize: string;
  num: number;
  /** -b / -l: segment 0 (grows positive). */
  base0: string;
  len0: string;
  /** -B / -L: segment 1 (grows negative); like the script, -B is the segment's TOP. */
  base1: string;
  len1: string;
  /** -A: addresses to translate instead of random ones. */
  vas: number[] | null;
}

/** OSTEP ch. 16 (fig. 16.1–16.3): three segments picked by the top two VA bits; the stack grows down. */
export interface BookSegConfig {
  asize: string;
  psize: string;
  code: [string, string];
  heap: [string, string];
  /** Base is the top of the stack. */
  stack: [string, string];
  vas: number[];
}

export const SEG_DEFAULTS: Omit<SegConfig, 'vas'> = { seed: 0, asize: '1k', psize: '16k', num: 5, base0: '-1', len0: '-1', base1: '-1', len1: '-1' };

const MAX_TRIES = 200_000;

/** Reproduces `segmentation.py -c` for the same flags and seed. */
export function runSeg(cfg: SegConfig): Run {
  const run = emptyRun('seg');
  const out: string[] = [`ARG seed ${cfg.seed}`, `ARG address space size ${cfg.asize.trim()}`, `ARG phys mem size ${cfg.psize.trim()}`, ''];
  run.command = commandLine('segmentation.py', [
    ['-s', cfg.seed, 0],
    ['-A', cfg.vas ? cfg.vas.join(',') : '-1', '-1'],
    ['-a', cfg.asize.trim(), '1k'],
    ['-p', cfg.psize.trim(), '16k'],
    ['-n', cfg.vas ? 5 : cfg.num, 5],
    ['-b', cfg.base0.trim(), '-1'],
    ['-l', cfg.len0.trim(), '-1'],
    ['-B', cfg.base1.trim(), '-1'],
    ['-L', cfg.len1.trim(), '-1'],
  ]);
  if (cfg.vas) run.notes.push('customVas');

  const fail = (code: RunError['code'], msg: string) => {
    out.push(`Error: ${msg}`);
    run.error = { code, msg };
    run.output = out.join('\n');
    run.steps = [];
    return run;
  };

  const rng = new PyRandom(cfg.seed);
  const asize = convertSize(cfg.asize);
  const psize = convertSize(cfg.psize);
  let len0 = convertSize(cfg.len0);
  let len1 = convertSize(cfg.len1);
  let base0 = convertSize(cfg.base0);
  let base1 = convertSize(cfg.base1);
  if ([asize, psize, len0, len1, base0, base1].some((n) => !Number.isFinite(n))) return fail('badInput', 'cannot parse a size');
  run.asize = asize;
  run.psize = psize;

  if (psize <= 4) return fail('psizeSmall', 'must specify a bigger physical memory size');
  if (asize === 0) return fail('asizeZero', 'must specify a non-zero address-space size');
  if (psize <= asize) return fail('psizeLeAsize', 'physical memory size > address space size (for this simulation)');

  if (len0 === -1) len0 = Math.trunc(asize / 4.0 + (asize / 4.0) * rng.random());
  if (len1 === -1) len1 = Math.trunc(asize / 4.0 + (asize / 4.0) * rng.random());
  if ((base0 === -1 || base1 === -1) && psize <= 2 * asize)
    return fail('need2x', 'physical memory must be 2x GREATER than address space size (if randomly generating base registers)');

  if (base0 === -1) {
    let tries = 0;
    do {
      base0 = Math.trunc(psize * rng.random());
      if (++tries > MAX_TRIES) return fail('hang', 'no room for segment 0 (segmentation.py would loop forever)');
    } while (!(base0 + len0 < psize));
  }
  // Internally base1 is the LOW end of segment 1 (the user passes its top).
  if (base1 === -1) {
    let tries = 0;
    for (;;) {
      base1 = Math.trunc(psize * rng.random());
      if (base1 + len1 < psize && (base1 > base0 + len0 || base1 + len1 < base0)) break;
      if (++tries > MAX_TRIES) return fail('hang', 'no room for segment 1 (segmentation.py would loop forever)');
    }
  } else {
    base1 = base1 - len1;
  }

  if (psize < base0 + len0 - 1) return fail('seg0Out', 'seg0 is not in physical memory');
  if (psize < base1) return fail('seg1Out', 'seg1 is not in physical memory');
  if (len0 > asize / 2.0) return fail('len0Big', 'length0 register is too large for this address space');
  if (len1 > asize / 2.0) return fail('len1Big', 'length1 register is too large for this address space');

  const nbase1 = base1 + len1;
  out.push(
    'Segment register information:',
    '',
    `  Segment 0 base  (grows positive) : 0x${px(base0, 8)} (decimal ${base0})`,
    `  Segment 0 limit                  : ${len0}`,
    '',
    `  Segment 1 base  (grows negative) : 0x${px(nbase1, 8)} (decimal ${nbase1})`,
    `  Segment 1 limit                  : ${len1}`,
    '',
  );
  if (len0 + base0 > base1 && base1 > base0) return fail('overlap', 'segments overlap in physical memory');

  const segments: Segment[] = [
    { id: 'seg0', kind: 'seg0', base: base0, size: len0, grows: 1, selector: 0 },
    { id: 'seg1', kind: 'seg1', base: nbase1, size: len1, grows: -1, selector: 1 },
  ];
  run.seg = { segments, segBits: 1, maxSeg: asize / 2, book: false };
  run.regions = [
    { id: 'seg0', label: 'seg0', kind: 'seg0', color: 1, v: [0, len0], p: [base0, base0 + len0] },
    { id: 'seg1', label: 'seg1', kind: 'seg1', color: 3, v: [asize - len1, asize], p: [base1, nbase1], grows: -1 },
  ];

  const vas = cfg.vas ?? Array.from({ length: Math.max(0, cfg.num) }, () => Math.trunc(asize * rng.random()));
  run.vas = vas;
  run.vaBits = bitsFor(asize);
  run.paBits = bitsFor(psize);

  out.push('Virtual Address Trace');
  let valid = 0;
  let faults = 0;
  for (let i = 0; i < vas.length; i++) {
    const va = vas[i];
    if (va < 0 || va >= asize) {
      run.steps = [];
      return fail('vaRange', `virtual address ${va} cannot be generated in an address space of size ${asize}`);
    }
    const head = `  VA ${pd(i, 2)}: 0x${px(va, 8)} (decimal: ${pd(va, 4)}) --> `;
    let step: Step;
    if (va >= asize / 2) {
      const segOffset = va - asize;
      const pa = nbase1 + segOffset;
      if (pa < base1) {
        faults++;
        step = { i, va, outcome: 'violation', pa: null, region: 'seg1', seg: 1, segOffset, ostep: [head + 'SEGMENTATION VIOLATION (SEG1)'], valid, faults, reads: 0, totalReads: 0 };
      } else {
        valid++;
        step = { i, va, outcome: 'ok', pa, region: 'seg1', seg: 1, segOffset, ostep: [head + `VALID in SEG1: 0x${px(pa, 8)} (decimal: ${pd(pa, 4)})`], valid, faults, reads: 0, totalReads: 0 };
      }
    } else if (va >= len0) {
      faults++;
      step = { i, va, outcome: 'violation', pa: null, region: 'seg0', seg: 0, segOffset: va, ostep: [head + 'SEGMENTATION VIOLATION (SEG0)'], valid, faults, reads: 0, totalReads: 0 };
    } else {
      valid++;
      const pa = va + base0;
      step = { i, va, outcome: 'ok', pa, region: 'seg0', seg: 0, segOffset: va, ostep: [head + `VALID in SEG0: 0x${px(pa, 8)} (decimal: ${pd(pa, 4)})`], valid, faults, reads: 0, totalReads: 0 };
    }
    out.push(...step.ostep);
    run.steps.push(step);
  }
  out.push('');
  run.output = out.join('\n');
  return run;
}

const BOOK_SEGS = [
  { kind: 'code', selector: 0, grows: 1, color: 1 },
  { kind: 'heap', selector: 1, grows: 1, color: 2 },
  { kind: 'stack', selector: 3, grows: -1, color: 3 },
] as const;

/** Three segments (top two bits: 00 code, 01 heap, 11 stack; 10 unused), exactly as in OSTEP ch. 16. */
export function runBookSeg(cfg: BookSegConfig): Run {
  const run = emptyRun('seg');
  run.notes.push('book');
  const fail = (code: RunError['code'], msg: string) => {
    run.error = { code, msg };
    return run;
  };
  const asize = convertSize(cfg.asize);
  const psize = convertSize(cfg.psize);
  const regs = [cfg.code, cfg.heap, cfg.stack].map(([b, s]) => [convertSize(b), convertSize(s)] as const);
  if ([asize, psize, ...regs.flat()].some((n) => !Number.isFinite(n) || n < 0)) return fail('badInput', 'cannot parse a size');
  run.asize = asize;
  run.psize = psize;
  if (!isPow2(asize) || asize < 4) return fail('notPow2', 'address space must be a power of 2');
  if (psize <= asize) return fail('psizeLeAsize', 'physical memory size > address space size (for this simulation)');
  const maxSeg = asize / 4;
  const segments: Segment[] = [];
  const regions: Region[] = [];
  for (let k = 0; k < 3; k++) {
    const def = BOOK_SEGS[k];
    const [base, size] = regs[k];
    if (size > maxSeg) return fail('len0Big', `${def.kind} is larger than a segment (${maxSeg} bytes)`);
    const low = def.grows === 1 ? base : base - size;
    if (low < 0 || low + size > psize) return fail('noFit', `${def.kind} is not in physical memory`);
    segments.push({ id: def.kind, kind: def.kind, base, size, grows: def.grows, selector: def.selector });
    const vLow = def.selector * maxSeg;
    regions.push({
      id: def.kind,
      label: def.kind,
      kind: def.kind,
      color: def.color,
      v: def.grows === 1 ? [vLow, vLow + size] : [vLow + maxSeg - size, vLow + maxSeg],
      p: [low, low + size],
      grows: def.grows,
    });
  }
  run.seg = { segments, segBits: 2, maxSeg, book: true };
  run.regions = regions;
  run.vas = cfg.vas;
  run.vaBits = bitsFor(asize);
  run.paBits = bitsFor(psize);

  let valid = 0;
  let faults = 0;
  for (let i = 0; i < cfg.vas.length; i++) {
    const va = cfg.vas[i];
    if (va >= asize) {
      run.steps = [];
      return fail('vaRange', `virtual address ${va} cannot be generated in an address space of size ${asize}`);
    }
    const sel = Math.floor(va / maxSeg);
    const off = va % maxSeg;
    const seg = segments.find((s) => s.selector === sel);
    const base = { i, va, seg: sel, valid, faults, reads: 0, totalReads: 0, ostep: [] as string[] };
    if (!seg) {
      faults++;
      run.steps.push({ ...base, faults, outcome: 'violation', pa: null, region: null, segOffset: off });
      continue;
    }
    const segOffset = seg.grows === 1 ? off : off - maxSeg;
    const outside = seg.grows === 1 ? segOffset >= seg.size : -segOffset > seg.size;
    if (outside) {
      faults++;
      run.steps.push({ ...base, faults, outcome: 'violation', pa: null, region: seg.id, segOffset });
    } else {
      valid++;
      run.steps.push({ ...base, valid, outcome: 'ok', pa: seg.base + segOffset, region: seg.id, segOffset });
    }
  }
  return run;
}
