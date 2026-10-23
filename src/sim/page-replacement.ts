import { PyRandom } from '../lib/pyrandom';

/**
 * Page replacement, reproducing OSTEP's `vm-beyondphys-policy/paging-policy.py`
 * (chapters 21–22) access by access: same policies, same tie-breaking, same
 * `random.random()` call order (address generation first, then RAND / CLOCK).
 *
 * The script keeps memory as a Python list (`memory`) whose order is what it
 * prints (FIFO queue, LRU stack…). For the exam-style grid we also track fixed
 * frames (`slots`): a page stays in its frame until evicted, and the incoming
 * page takes the victim's frame.
 */

export const POLICIES = ['FIFO', 'LRU', 'OPT', 'CLOCK', 'RAND', 'MRU', 'UNOPT'] as const;
export type Policy = (typeof POLICIES)[number];

/**
 * `ostep`: the script's CLOCK, which picks a *random* frame on each look and
 * spends one reference bit per look. `circular`: the textbook clock (second
 * chance with a hand that sweeps the frames in order); not in paging-policy.py.
 */
export type ClockHand = 'ostep' | 'circular';

export interface PrConfig {
  policy: Policy;
  cacheSize: number;
  /** `-b`: max value of each page's reference counter (CLOCK). */
  clockBits: number;
  clockHand: ClockHand;
  /** `-a`; `null` means generate `numAddrs` pages from the seed (`-a -1`). */
  addresses: number[] | null;
  numAddrs: number;
  maxPage: number;
  seed: number;
}

export const DEFAULT_CONFIG: PrConfig = {
  policy: 'FIFO',
  cacheSize: 3,
  clockBits: 2,
  clockHand: 'ostep',
  addresses: null,
  numAddrs: 10,
  maxPage: 10,
  seed: 0,
};

export interface FutureUse {
  page: number;
  slot: number;
  /** Index of the next access to the page; `>= trace.length` means never. */
  next: number;
}

export interface ClockLook {
  slot: number;
  page: number;
  /** Reference counter when the hand looked at it. */
  ref: number;
  victim: boolean;
}

export interface PrState {
  /** Frame contents (fixed positions), `null` = free. */
  slots: (number | null)[];
  /** The script's list, in the order it prints it. */
  memory: number[];
  /** Reference counters of resident pages (CLOCK). */
  ref: Record<number, number>;
  /** Circular clock: frame the hand points to. */
  hand: number;
  /** Total hand advances so far, to animate it always forward. */
  handTicks: number;
}

export interface PrStep extends PrState {
  /** 0-based access number. */
  index: number;
  page: number;
  hit: boolean;
  victim: number | null;
  /** Frame that served the hit or received the page. */
  slot: number;
  /** Memory list before this access. */
  memoryBefore: number[];
  /** Reference counters before this access. */
  refBefore: Record<number, number>;
  /** OPT / UNOPT: next use of every resident page, when a victim had to be chosen. */
  future?: FutureUse[];
  /** CLOCK: frames the hand looked at, in order, when a victim had to be chosen. */
  scan?: ClockLook[];
  /** RAND: index into `memoryBefore` picked by `random()`. */
  pick?: number;
  hits: number;
  misses: number;
  evictions: number;
  /** The exact line paging-policy.py prints for this access with `-c`. */
  line: string;
}

export interface PrRun {
  trace: number[];
  initial: PrState;
  steps: PrStep[];
  hits: number;
  misses: number;
  evictions: number;
  /** The script's `FINALSTATS` line (empty if there were no accesses). */
  finalLine: string;
  leftStr: string;
  riteStr: string;
}

function labels(policy: Policy): [string, string] {
  if (policy === 'FIFO') return ['FirstIn', 'Lastin '];
  if (policy === 'LRU' || policy === 'MRU') return ['LRU', 'MRU'];
  return ['Left ', 'Right'];
}

/** `int(maxpage * random.random())`, `numaddrs` times. */
export function generateTrace(rng: PyRandom, numAddrs: number, maxPage: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < numAddrs; i++) out.push(Math.trunc(maxPage * rng.random()));
  return out;
}

export function traceOf(cfg: Pick<PrConfig, 'addresses' | 'numAddrs' | 'maxPage' | 'seed'>): number[] {
  return cfg.addresses ? [...cfg.addresses] : generateTrace(new PyRandom(cfg.seed), cfg.numAddrs, cfg.maxPage);
}

const pyList = (xs: number[]) => `[${xs.join(', ')}]`;

export function formatLine(n: number, hit: boolean, memory: number[], victim: number | null, hits: number, misses: number, policy: Policy): string {
  const [l, r] = labels(policy);
  return `Access: ${n}  ${hit ? 'HIT ' : 'MISS'} ${l} -> ${pyList(memory).padStart(12)} <- ${r} Replaced:${victim === null ? '-' : victim} [Hits:${hits} Misses:${misses}]`;
}

export function formatFinal(hits: number, misses: number): string {
  if (hits + misses === 0) return '';
  return `FINALSTATS hits ${hits}   misses ${misses}   hitrate ${((100 * hits) / (hits + misses)).toFixed(2)}`;
}

function nextUse(trace: number[], from: number, page: number): number {
  for (let i = from + 1; i < trace.length; i++) if (trace[i] === page) return i;
  return trace.length;
}

export function simulate(cfg: PrConfig): PrRun {
  const { policy } = cfg;
  const C = Math.max(1, Math.floor(cfg.cacheSize));
  const rng = new PyRandom(cfg.seed);
  const trace = cfg.addresses ? [...cfg.addresses] : generateTrace(rng, cfg.numAddrs, cfg.maxPage);
  const circular = policy === 'CLOCK' && cfg.clockHand === 'circular';

  let slots: (number | null)[] = Array.from({ length: C }, () => null);
  let memory: number[] = [];
  let ref: Record<number, number> = {};
  let hand = 0;
  let handTicks = 0;
  let count = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  const initial: PrState = { slots: [...slots], memory: [], ref: {}, hand, handTicks };
  const steps: PrStep[] = [];
  const slotOf = (p: number) => slots.indexOf(p);

  trace.forEach((n, addrIndex) => {
    const memoryBefore = [...memory];
    const refBefore = { ...ref };
    slots = [...slots];
    memory = [...memory];
    ref = { ...ref };

    const hit = memory.includes(n);
    let victim: number | null = null;
    let slot = slotOf(n);
    let future: FutureUse[] | undefined;
    let scan: ClockLook[] | undefined;
    let pick: number | undefined;

    if (hit) {
      hits++;
      if (policy === 'LRU' || policy === 'MRU') {
        memory.splice(memory.indexOf(n), 1);
        memory.push(n);
      }
    } else {
      misses++;
      if (count === C) {
        if (policy === 'FIFO' || policy === 'LRU') {
          victim = memory.shift()!;
        } else if (policy === 'MRU') {
          victim = memory.pop()!;
        } else if (policy === 'RAND') {
          pick = Math.trunc(rng.random() * count);
          victim = memory.splice(pick, 1)[0];
        } else if (policy === 'CLOCK') {
          scan = [];
          if (circular) {
            for (;;) {
              const p = slots[hand]!;
              const look: ClockLook = { slot: hand, page: p, ref: ref[p], victim: false };
              scan.push(look);
              hand = (hand + 1) % C;
              handTicks++;
              if (ref[p] >= 1) ref[p] -= 1;
              else {
                look.victim = true;
                victim = p;
                break;
              }
            }
            memory.splice(memory.indexOf(victim!), 1);
          } else {
            for (;;) {
              const p = memory[Math.trunc(rng.random() * count)];
              const look: ClockLook = { slot: slotOf(p), page: p, ref: ref[p], victim: false };
              scan.push(look);
              if (ref[p] >= 1) ref[p] -= 1;
              else {
                look.victim = true;
                victim = p;
                memory.splice(memory.indexOf(p), 1);
                break;
              }
            }
          }
          delete ref[victim!];
        } else {
          // OPT / UNOPT: scan the future of every resident page, in list order.
          future = memory.map((page) => ({ page, slot: slotOf(page), next: nextUse(trace, addrIndex, page) }));
          let at = -1;
          if (policy === 'OPT') {
            let max = -1;
            future.forEach((f, i) => {
              if (f.next >= max) {
                max = f.next;
                at = i;
              }
            });
          } else {
            let min = trace.length + 1;
            future.forEach((f, i) => {
              if (f.next < min) {
                min = f.next;
                at = i;
              }
            });
          }
          victim = memory.splice(at, 1)[0];
        }
        evictions++;
        slot = slotOf(victim!);
      } else {
        count++;
        slot = slots.indexOf(null);
      }
      memory.push(n);
      slots[slot] = n;
    }

    // After miss processing, update the reference counter (every policy, as the script does).
    if (!(n in ref)) ref[n] = 1;
    else {
      ref[n] += 1;
      if (ref[n] > cfg.clockBits) ref[n] = cfg.clockBits;
    }
    // Only resident pages keep a counter worth showing (non-CLOCK policies never delete).
    const shown: Record<number, number> = {};
    for (const p of memory) shown[p] = ref[p];

    steps.push({
      index: addrIndex,
      page: n,
      hit,
      victim,
      slot,
      slots,
      memory,
      ref: shown,
      hand,
      handTicks,
      memoryBefore,
      refBefore,
      future,
      scan,
      pick,
      hits,
      misses,
      evictions,
      line: formatLine(n, hit, memory, victim, hits, misses, policy),
    });
  });

  const [leftStr, riteStr] = labels(policy);
  return { trace, initial, steps, hits, misses, evictions, finalLine: formatFinal(hits, misses), leftStr, riteStr };
}

/** Hits / misses of every policy on the same setup (same seed, same trace). */
export function compareAll(cfg: PrConfig): { policy: Policy; hits: number; misses: number }[] {
  return POLICIES.map((policy) => {
    const r = simulate({ ...cfg, policy });
    return { policy, hits: r.hits, misses: r.misses };
  });
}

/** Page faults for 1..maxFrames frames. */
export function faultCurve(cfg: PrConfig, policy: Policy, maxFrames: number): number[] {
  return Array.from({ length: maxFrames }, (_, i) => simulate({ ...cfg, policy, cacheSize: i + 1 }).misses);
}

/** Frame counts k where adding a frame (k → k+1) produced more faults. */
export function beladyPoints(curve: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < curve.length; i++) if (curve[i + 1] > curve[i]) out.push(i + 1);
  return out;
}

/* ---------- Input parsing ---------- */

export function parseAddresses(text: string): { pages: number[]; bad: string[] } {
  const pages: number[] = [];
  const bad: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d{1,6}$/.test(tok)) pages.push(Number(tok));
    else bad.push(tok);
  }
  return { pages, bad };
}

export interface FlagResult {
  policy?: Policy;
  cacheSize?: number;
  clockBits?: number;
  /** Raw `-a` list, or `null` for `-a -1`. */
  addresses?: string | null;
  numAddrs?: number;
  maxPage?: number;
  seed?: number;
  errors: string[];
}

const LONG: Record<string, string> = {
  addresses: 'a',
  addressfile: 'f',
  numaddrs: 'n',
  policy: 'p',
  clockbits: 'b',
  cachesize: 'C',
  maxpage: 'm',
  seed: 's',
  notrace: 'N',
  compute: 'c',
  help: 'h',
};

/** Parses paging-policy.py flags (`-p LRU -C 4 -a 1,2,3`, `--policy=LRU`, `-pLRU`). */
export function parseFlags(text: string): FlagResult {
  const res: FlagResult = { errors: [] };
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (toks[0] && /paging-policy(\.py)?$|python/.test(toks[0])) toks.shift();
  if (toks[0] && /paging-policy(\.py)?$/.test(toks[0])) toks.shift();
  const int = (v: string, flag: string) => {
    if (/^-?\d+$/.test(v)) return Number(v);
    res.errors.push(`${flag} ${v}`);
    return undefined;
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    let key: string;
    let val: string | undefined;
    if (tok.startsWith('--')) {
      const [name, v] = tok.slice(2).split('=', 2);
      if (!(name in LONG)) {
        res.errors.push(tok);
        continue;
      }
      key = LONG[name];
      val = v;
    } else if (/^-[a-zA-Z]/.test(tok)) {
      key = tok[1];
      val = tok.length > 2 ? tok.slice(2) : undefined;
    } else {
      res.errors.push(tok);
      continue;
    }
    if (key === 'c' || key === 'N' || key === 'h') continue;
    if (!'afnpbCms'.includes(key)) {
      res.errors.push(tok);
      continue;
    }
    if (val === undefined) {
      val = toks[++i];
      if (val === undefined) {
        res.errors.push(tok);
        break;
      }
    }
    if (key === 'a') res.addresses = val === '-1' ? null : val;
    else if (key === 'f') res.errors.push(`-f ${val}`);
    else if (key === 'p') {
      const p = val.toUpperCase() as Policy;
      if (POLICIES.includes(p)) res.policy = p;
      else res.errors.push(`-p ${val}`);
    } else {
      const n = int(val, `-${key}`);
      if (n === undefined) continue;
      if (key === 'n') res.numAddrs = n;
      if (key === 'b') res.clockBits = n;
      if (key === 'C') res.cacheSize = n;
      if (key === 'm') res.maxPage = n;
      if (key === 's') res.seed = n;
    }
  }
  return res;
}

/** Applies parsed flags over the script's defaults (what running it with just those flags means). */
export function configFromFlags(text: string): { cfg: PrConfig; errors: string[] } {
  const f = parseFlags(text);
  const cfg: PrConfig = { ...DEFAULT_CONFIG };
  if (f.policy) cfg.policy = f.policy;
  if (f.cacheSize !== undefined) cfg.cacheSize = f.cacheSize;
  if (f.clockBits !== undefined) cfg.clockBits = f.clockBits;
  if (f.numAddrs !== undefined) cfg.numAddrs = f.numAddrs;
  if (f.maxPage !== undefined) cfg.maxPage = f.maxPage;
  if (f.seed !== undefined) cfg.seed = f.seed;
  if (f.addresses) {
    const { pages, bad } = parseAddresses(f.addresses);
    cfg.addresses = pages;
    if (bad.length) f.errors.push(`-a ${bad.join(',')}`);
  }
  return { cfg, errors: f.errors };
}

/** The equivalent paging-policy.py command line. */
export function ostepCommand(cfg: PrConfig): string {
  const parts = ['./paging-policy.py'];
  if (cfg.addresses) parts.push(`-a ${cfg.addresses.join(',') || '-1'}`);
  else parts.push(`-s ${cfg.seed}`, `-n ${cfg.numAddrs}`, `-m ${cfg.maxPage}`);
  if (cfg.policy !== 'FIFO') parts.push(`-p ${cfg.policy}`);
  if (cfg.cacheSize !== 3) parts.push(`-C ${cfg.cacheSize}`);
  if (cfg.policy === 'CLOCK' && cfg.clockBits !== 2) parts.push(`-b ${cfg.clockBits}`);
  if (cfg.addresses && (cfg.policy === 'RAND' || cfg.policy === 'CLOCK') && cfg.seed !== 0) parts.push(`-s ${cfg.seed}`);
  parts.push('-c');
  return parts.join(' ');
}

/* ---------- Presets ---------- */

export const PRESETS = {
  /** OSTEP ch. 22, Figures 22.1–22.5. */
  ch22: { addresses: '0,1,2,0,1,3,0,3,1,2,1', cacheSize: 3 },
  /** Belady's anomaly: FIFO has 9 faults with 3 frames and 10 with 4. */
  belady: { addresses: '1,2,3,4,1,2,5,1,2,3,4,5', cacheSize: 3, policy: 'FIFO' as Policy },
  /** Looping over one page more than fits: LRU (and FIFO) miss every time. */
  loop: { addresses: '0,1,2,3,0,1,2,3,0,1,2,3', cacheSize: 3, policy: 'LRU' as Policy },
};
export type PresetId = keyof typeof PRESETS;
