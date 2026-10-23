/**
 * Address translation (OSTEP ch. 15–20): base & bounds, segmentation, linear
 * and multi-level paging. Each mechanism reproduces its OSTEP homework script
 * (same flags, same random problem for the same -s seed, same -c answers).
 */
import { parseVas, type Mech, type Run } from './common';
import { BB_DEFAULTS, runBb } from './relocation';
import { SEG_DEFAULTS, runBookSeg, runSeg } from './segmentation';
import { LIN_DEFAULTS, runLin } from './linear';
import { BOOK_ML_VAS, ML_DEFAULTS, runBookMl, runMl } from './multilevel';

export * from './common';
export * from './relocation';
export * from './segmentation';
export * from './linear';
export * from './multilevel';

export const BOOK_SEG_VAS = [100, 4200, 15360, 8000, 9000, 14000];

/** The whole setup, flat, as it lives in the URL. Each mechanism keeps its own keys. */
export const SETUP_DEFAULTS = {
  mech: 'bb' as Mech,
  // base & bounds — relocation.py
  bbS: BB_DEFAULTS.seed,
  bbA: BB_DEFAULTS.asize,
  bbP: BB_DEFAULTS.psize,
  bbN: BB_DEFAULTS.num,
  bbB: BB_DEFAULTS.base,
  bbL: BB_DEFAULTS.limit,
  bbV: '',
  // segmentation — segmentation.py, or the 3-segment book example
  sgBook: false,
  sgS: SEG_DEFAULTS.seed,
  sgA: SEG_DEFAULTS.asize,
  sgP: SEG_DEFAULTS.psize,
  sgN: SEG_DEFAULTS.num,
  sgB0: SEG_DEFAULTS.base0,
  sgL0: SEG_DEFAULTS.len0,
  sgB1: SEG_DEFAULTS.base1,
  sgL1: SEG_DEFAULTS.len1,
  sgV: '',
  sgBA: '16k',
  sgBP: '64k',
  sgCb: '32k',
  sgCs: '2k',
  sgHb: '34k',
  sgHs: '3k',
  sgSb: '28k',
  sgSs: '2k',
  sgBV: '',
  // linear paging — paging-linear-translate.py
  lnS: LIN_DEFAULTS.seed,
  lnA: LIN_DEFAULTS.asize,
  lnP: LIN_DEFAULTS.psize,
  lnPg: LIN_DEFAULTS.pagesize,
  lnN: LIN_DEFAULTS.num,
  lnU: LIN_DEFAULTS.used,
  lnT: '',
  lnV: '',
  // multi-level — paging-multilevel-translate.py, or the ch. 20 example
  mlBook: false,
  mlS: ML_DEFAULTS.seed,
  mlA: ML_DEFAULTS.allocated,
  mlN: ML_DEFAULTS.num,
  mlV: '',
  mlBV: '',
};

export type Setup = typeof SETUP_DEFAULTS;
export type SetupKey = keyof Setup;

const PREFIX: Record<Mech, string> = { bb: 'bb', seg: 'sg', lin: 'ln', ml: 'ml' };

/** The URL keys that belong to a mechanism. */
export function keysOf(mech: Mech): SetupKey[] {
  return (Object.keys(SETUP_DEFAULTS) as SetupKey[]).filter((k) => k.startsWith(PREFIX[mech]));
}

/** All of a mechanism's keys back at their defaults, plus `patch`. */
export function mechPatch(mech: Mech, patch: Partial<Setup> = {}): Partial<Setup> {
  const out: Partial<Setup> = {};
  for (const k of keysOf(mech)) (out as Record<string, unknown>)[k] = SETUP_DEFAULTS[k];
  return { ...out, ...patch };
}

/** "3,7,-,2" → [3, 7, -1, 2]. */
export function parseTable(text: string): number[] | null {
  if (!text.trim()) return null;
  const out = text.split(',').map((t) => (t.trim() === '-' || t.trim() === '-1' ? -1 : /^\d+$/.test(t.trim()) ? Number(t.trim()) : NaN));
  return out.some((n) => Number.isNaN(n)) ? null : out;
}

export const tableText = (t: readonly number[]) => t.map((p) => (p < 0 ? '-' : String(p))).join(',');

/** The VA list for the mechanism's text field: null when empty (generate as OSTEP does). */
function vaList(text: string): { vas: number[] | null; bad: string[] } {
  if (!text.trim()) return { vas: null, bad: [] };
  const { vas, bad } = parseVas(text);
  return { vas, bad };
}

/** Runs the selected mechanism. `bad` lists address tokens that did not parse. */
export function runSetup(s: Setup, opts: { verbose?: boolean } = {}): { run: Run; bad: string[] } {
  switch (s.mech) {
    case 'bb': {
      const { vas, bad } = vaList(s.bbV);
      return { run: runBb({ seed: s.bbS, asize: s.bbA, psize: s.bbP, num: s.bbN, base: s.bbB, limit: s.bbL, vas }), bad };
    }
    case 'seg': {
      if (s.sgBook) {
        const { vas, bad } = vaList(s.sgBV);
        const run = runBookSeg({ asize: s.sgBA, psize: s.sgBP, code: [s.sgCb, s.sgCs], heap: [s.sgHb, s.sgHs], stack: [s.sgSb, s.sgSs], vas: vas ?? BOOK_SEG_VAS });
        return { run, bad };
      }
      const { vas, bad } = vaList(s.sgV);
      return { run: runSeg({ seed: s.sgS, asize: s.sgA, psize: s.sgP, num: s.sgN, base0: s.sgB0, len0: s.sgL0, base1: s.sgB1, len1: s.sgL1, vas }), bad };
    }
    case 'lin': {
      const { vas, bad } = vaList(s.lnV);
      return { run: runLin({ seed: s.lnS, asize: s.lnA, psize: s.lnP, pagesize: s.lnPg, num: s.lnN, used: s.lnU, vas, table: parseTable(s.lnT), verbose: opts.verbose }), bad };
    }
    case 'ml': {
      if (s.mlBook) {
        const { vas, bad } = vaList(s.mlBV);
        return { run: runBookMl(vas ?? BOOK_ML_VAS), bad };
      }
      const { vas, bad } = vaList(s.mlV);
      return { run: runMl({ seed: s.mlS, allocated: s.mlA, num: s.mlN, vas }), bad };
    }
  }
}

/* ---------- presets ---------- */

export type PresetId = 'book' | 'hw' | 's0' | 's1' | 's2';

export const PRESETS: Record<Mech, Partial<Record<PresetId, Partial<Setup>>>> = {
  bb: {
    // ch. 15, fig. 15.2: a 16 KB address space relocated to 32 KB, bounds 16 KB.
    book: mechPatch('bb', { bbA: '16k', bbP: '64k', bbB: '32k', bbL: '16k', bbV: '128 1024 3000 15360 17408' }),
    s0: mechPatch('bb', { bbS: 0 }),
    s1: mechPatch('bb', { bbS: 1 }),
    s2: mechPatch('bb', { bbS: 2 }),
  },
  seg: {
    // ch. 16, fig. 16.1–16.3: code at 32K, heap at 34K, stack at 28K growing down.
    book: mechPatch('seg', { sgBook: true }),
    // ch. 16 homework, question 1.
    hw: mechPatch('seg', { sgA: '128', sgP: '512', sgB0: '0', sgL0: '20', sgB1: '512', sgL1: '20' }),
    s0: mechPatch('seg', { sgS: 0 }),
    s1: mechPatch('seg', { sgS: 1 }),
    s2: mechPatch('seg', { sgS: 2 }),
  },
  lin: {
    // ch. 18, fig. 18.1–18.2: 64-byte address space, 16-byte pages, VP0→PF3, VP1→PF7, VP2→PF5, VP3→PF2.
    book: mechPatch('lin', { lnA: '64', lnP: '128', lnPg: '16', lnT: '3,7,5,2', lnV: '21 0 47 63' }),
    s0: mechPatch('lin', { lnS: 0 }),
    s1: mechPatch('lin', { lnS: 1 }),
    s2: mechPatch('lin', { lnS: 2 }),
  },
  ml: {
    // ch. 20, fig. 20.5.
    book: mechPatch('ml', { mlBook: true }),
    s0: mechPatch('ml', { mlS: 0 }),
    s1: mechPatch('ml', { mlS: 1 }),
    s2: mechPatch('ml', { mlS: 2 }),
  },
};

export function activePreset(s: Setup): PresetId | undefined {
  const ps = PRESETS[s.mech];
  return (Object.keys(ps) as PresetId[]).find((id) => Object.entries(ps[id]!).every(([k, v]) => s[k as SetupKey] === v));
}

/** Same sizes, a new seed, and everything else back to "let OSTEP pick". */
export function randomPatch(s: Setup, seed: number): Partial<Setup> {
  switch (s.mech) {
    case 'bb':
      return mechPatch('bb', { bbS: seed, bbA: s.bbA, bbP: s.bbP, bbN: s.bbN });
    case 'seg':
      return mechPatch('seg', { sgS: seed, sgA: s.sgA, sgP: s.sgP, sgN: s.sgN });
    case 'lin':
      return mechPatch('lin', { lnS: seed, lnA: s.lnA, lnP: s.lnP, lnPg: s.lnPg, lnN: s.lnN, lnU: s.lnU });
    case 'ml':
      return mechPatch('ml', { mlS: seed, mlA: s.mlA, mlN: s.mlN });
  }
}

/* ---------- pasting OSTEP flags ---------- */

type FlagSpec = Record<string, { key: SetupKey; kind: 'int' | 'str' | 'list' | 'bool' }>;

const FLAGS: Record<Mech, { script: RegExp; flags: FlagSpec }> = {
  bb: {
    script: /relocation/,
    flags: {
      '-s': { key: 'bbS', kind: 'int' },
      '--seed': { key: 'bbS', kind: 'int' },
      '-a': { key: 'bbA', kind: 'str' },
      '--asize': { key: 'bbA', kind: 'str' },
      '-p': { key: 'bbP', kind: 'str' },
      '--physmem': { key: 'bbP', kind: 'str' },
      '-n': { key: 'bbN', kind: 'int' },
      '--addresses': { key: 'bbN', kind: 'int' },
      '-b': { key: 'bbB', kind: 'str' },
      '--b': { key: 'bbB', kind: 'str' },
      '-l': { key: 'bbL', kind: 'str' },
      '--l': { key: 'bbL', kind: 'str' },
    },
  },
  seg: {
    script: /segmentation/,
    flags: {
      '-s': { key: 'sgS', kind: 'int' },
      '--seed': { key: 'sgS', kind: 'int' },
      '-A': { key: 'sgV', kind: 'list' },
      '--addresses': { key: 'sgV', kind: 'list' },
      '-a': { key: 'sgA', kind: 'str' },
      '--asize': { key: 'sgA', kind: 'str' },
      '-p': { key: 'sgP', kind: 'str' },
      '--physmem': { key: 'sgP', kind: 'str' },
      '-n': { key: 'sgN', kind: 'int' },
      '--numaddrs': { key: 'sgN', kind: 'int' },
      '-b': { key: 'sgB0', kind: 'str' },
      '--b0': { key: 'sgB0', kind: 'str' },
      '-l': { key: 'sgL0', kind: 'str' },
      '--l0': { key: 'sgL0', kind: 'str' },
      '-B': { key: 'sgB1', kind: 'str' },
      '--b1': { key: 'sgB1', kind: 'str' },
      '-L': { key: 'sgL1', kind: 'str' },
      '--l1': { key: 'sgL1', kind: 'str' },
    },
  },
  lin: {
    script: /linear/,
    flags: {
      '-s': { key: 'lnS', kind: 'int' },
      '--seed': { key: 'lnS', kind: 'int' },
      '-A': { key: 'lnV', kind: 'list' },
      '--addresses': { key: 'lnV', kind: 'list' },
      '-a': { key: 'lnA', kind: 'str' },
      '--asize': { key: 'lnA', kind: 'str' },
      '-p': { key: 'lnP', kind: 'str' },
      '--physmem': { key: 'lnP', kind: 'str' },
      '-P': { key: 'lnPg', kind: 'str' },
      '--pagesize': { key: 'lnPg', kind: 'str' },
      '-n': { key: 'lnN', kind: 'int' },
      '--numaddrs': { key: 'lnN', kind: 'int' },
      '-u': { key: 'lnU', kind: 'int' },
      '--used': { key: 'lnU', kind: 'int' },
    },
  },
  ml: {
    script: /multilevel/,
    flags: {
      '-s': { key: 'mlS', kind: 'int' },
      '--seed': { key: 'mlS', kind: 'int' },
      '-a': { key: 'mlA', kind: 'int' },
      '--allocated': { key: 'mlA', kind: 'int' },
      '-n': { key: 'mlN', kind: 'int' },
      '--addresses': { key: 'mlN', kind: 'int' },
    },
  },
};

const IGNORED = new Set(['-c', '--compute', '--solve', '-v', '-h', '--help']);

/**
 * Parses a pasted command such as `./segmentation.py -a 128 -p 512 -s 1 -c`.
 * The script name (if present) picks the mechanism. Returns the patch (the
 * mechanism's keys reset to defaults, then the flags applied) and what it
 * could not understand.
 */
export function parseFlags(text: string, current: Mech): { mech: Mech; patch: Partial<Setup>; bad: string[] } {
  const mech = (Object.keys(FLAGS) as Mech[]).find((m) => FLAGS[m].script.test(text)) ?? current;
  const { flags } = FLAGS[mech];
  const patch: Partial<Setup> = { ...mechPatch(mech), mech } as Partial<Setup>;
  if (mech === 'seg') patch.sgBook = false;
  if (mech === 'ml') patch.mlBook = false;
  const bad: string[] = [];
  const toks = text.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  // skip "python3 ./script.py"
  while (i < toks.length && !toks[i].startsWith('-')) i++;
  for (; i < toks.length; i++) {
    let tok = toks[i];
    let val: string | undefined;
    if (IGNORED.has(tok)) continue;
    const eq = tok.indexOf('=');
    if (tok.startsWith('--') && eq > 0) {
      val = tok.slice(eq + 1);
      tok = tok.slice(0, eq);
    } else if (/^-[a-zA-Z]./.test(tok) && !tok.startsWith('--')) {
      val = tok.slice(2);
      tok = tok.slice(0, 2);
    }
    const spec = flags[tok];
    if (!spec) {
      bad.push(toks[i]);
      continue;
    }
    if (val === undefined) val = toks[++i];
    if (val === undefined) {
      bad.push(tok);
      break;
    }
    const rec = patch as Record<string, unknown>;
    if (spec.kind === 'int') {
      if (/^-?\d+$/.test(val)) rec[spec.key] = Number(val);
      else bad.push(`${tok} ${val}`);
    } else if (spec.kind === 'list') {
      rec[spec.key] = val === '-1' ? '' : val.split(',').join(' ');
    } else rec[spec.key] = val;
  }
  return { mech, patch, bad };
}
