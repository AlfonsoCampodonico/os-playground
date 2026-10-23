import { PyRandom } from '../../lib/pyrandom';
import { bitsFor, commandLine, convertSize, emptyRun, pd, px, type Run, type Step } from './common';

/** Flags of OSTEP's vm-mechanism/relocation.py (sizes as strings, "-1" = pick at random). */
export interface BbConfig {
  seed: number;
  asize: string;
  psize: string;
  num: number;
  base: string;
  limit: string;
  /** Addresses typed by the student instead of the generated ones (relocation.py has no -A). */
  vas: number[] | null;
}

export const BB_DEFAULTS: Omit<BbConfig, 'vas'> = { seed: 0, asize: '1k', psize: '16k', num: 5, base: '-1', limit: '-1' };

/** Reproduces `relocation.py -c`: same random base/limit and addresses for the same seed. */
export function runBb(cfg: BbConfig): Run {
  const run = emptyRun('bb');
  const out: string[] = ['', `ARG seed ${cfg.seed}`, `ARG address space size ${cfg.asize.trim()}`, `ARG phys mem size ${cfg.psize.trim()}`, ''];
  run.command = commandLine('relocation.py', [
    ['-s', cfg.seed, 0],
    ['-a', cfg.asize.trim(), '1k'],
    ['-p', cfg.psize.trim(), '16k'],
    ['-n', cfg.num, 5],
    ['-b', cfg.base.trim(), '-1'],
    ['-l', cfg.limit.trim(), '-1'],
  ]);
  if (cfg.vas) run.notes.push('noAFlag');

  const fail = (code: NonNullable<Run['error']>['code'], msg: string) => {
    out.push(`Error: ${msg}`);
    run.error = { code, msg };
    run.output = out.join('\n');
    return run;
  };

  const rng = new PyRandom(cfg.seed);
  const asize = convertSize(cfg.asize);
  const psize = convertSize(cfg.psize);
  const limitIn = convertSize(cfg.limit);
  const baseIn = convertSize(cfg.base);
  if ([asize, psize, limitIn, baseIn].some((n) => !Number.isFinite(n))) return fail('badInput', 'cannot parse a size');
  run.asize = asize;
  run.psize = psize;
  if (psize <= 1) return fail('psizeSmall', 'must specify a non-zero physical memory size.');
  if (asize === 0) return fail('asizeZero', 'must specify a non-zero address-space size.');
  if (psize <= asize) return fail('psizeLeAsize', 'physical memory size must be GREATER than address space size (for this simulation)');

  let limit = limitIn;
  let base = baseIn;
  if (limit === -1) limit = Math.trunc(asize / 4.0 + (asize / 4.0) * rng.random());
  if (base === -1) {
    if (limit >= psize) return fail('hang', 'no base fits that limit (relocation.py would loop forever)');
    do base = Math.trunc(psize * rng.random());
    while (!(base + limit < psize));
  }

  out.push('Base-and-Bounds register information:', '', `  Base   : 0x${px(base, 8)} (decimal ${base})`, `  Limit  : ${limit}`, '');
  run.bb = { base, limit };
  if (base + limit > psize) {
    out.push('Error: address space does not fit into physical memory with those base/bounds values.', `Base + Limit: ${base + limit}   Psize: ${psize}`);
    run.error = { code: 'noFit', msg: 'address space does not fit into physical memory with those base/bounds values.' };
    run.output = out.join('\n');
    return run;
  }

  const vas = cfg.vas ?? Array.from({ length: Math.max(0, cfg.num) }, () => Math.trunc(asize * rng.random()));
  run.vas = vas;
  run.vaBits = bitsFor(Math.max(asize, ...vas.map((v) => v + 1)));
  run.paBits = bitsFor(psize);
  run.regions = [{ id: 'proc', label: 'proc', kind: 'proc', color: 1, v: [0, Math.min(limit, asize)], p: [base, base + limit] }];

  out.push('Virtual Address Trace');
  let valid = 0;
  let faults = 0;
  vas.forEach((va, i) => {
    const head = `  VA ${pd(i, 2)}: 0x${px(va, 8)} (decimal: ${pd(va, 4)}) --> `;
    let step: Step;
    if (va >= limit) {
      faults++;
      step = { i, va, outcome: 'violation', pa: null, region: 'proc', ostep: [head + 'SEGMENTATION VIOLATION'], valid, faults, reads: 0, totalReads: 0, bound: limit };
    } else {
      valid++;
      const pa = va + base;
      step = { i, va, outcome: 'ok', pa, region: 'proc', ostep: [head + `VALID: 0x${px(pa, 8)} (decimal: ${pd(pa, 4)})`], valid, faults, reads: 0, totalReads: 0, bound: limit };
    }
    out.push(...step.ostep);
    run.steps.push(step);
  });
  out.push('');
  run.output = out.join('\n');
  return run;
}
