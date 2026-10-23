import { PyRandom } from '../../lib/pyrandom';
import type { Job, MlfqParams, Policy } from './types';

export const LIMITS = { jobs: 8, arrival: 500, length: 500, ioFreq: 100, ioTime: 100, quantum: 100, queues: 6, allotment: 20, boost: 1000 };

export const jobName = (i: number) => String.fromCharCode(65 + i);

/* ---------- compact text form ---------- */

/** "0,10 0,10,3 …": arrival,length[,ioFreq] per job; trailing ",0" omitted. */
export function formatJobs(jobs: Job[]): string {
  return jobs.map((j) => (j.ioFreq > 0 ? `${j.arrival},${j.length},${j.ioFreq}` : `${j.arrival},${j.length}`)).join(' ');
}

/**
 * Parses the text form. Jobs are separated by spaces, newlines, ";" or ":"
 * (so mlfq.py's `-l 0,100,0:10,20,2` pastes as is); commas separate the
 * fields of one job, and a bare number is a job of that length arriving at 0.
 */
export function parseJobs(text: string): { jobs: Job[]; bad: string[] } {
  const trimmed = text.trim();
  const bad: string[] = [];
  const jobs: Job[] = [];
  if (trimmed === '') return { jobs, bad: [''] };
  const tokens = trimmed.split(/[\s;:]+/).filter(Boolean);
  for (const tok of tokens) {
    const parts = tok.split(',');
    const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
    let job: Job | null = null;
    if (nums.length === 1) job = { arrival: 0, length: nums[0], ioFreq: 0 };
    else if (nums.length === 2) job = { arrival: nums[0], length: nums[1], ioFreq: 0 };
    else if (nums.length === 3) job = { arrival: nums[0], length: nums[1], ioFreq: nums[2] };
    if (
      job &&
      [job.arrival, job.length, job.ioFreq].every(Number.isFinite) &&
      job.length >= 1 &&
      job.length <= LIMITS.length &&
      job.arrival <= LIMITS.arrival &&
      job.ioFreq <= LIMITS.ioFreq
    )
      jobs.push(job);
    else bad.push(tok);
  }
  if (jobs.length > LIMITS.jobs) bad.push(`> ${LIMITS.jobs}`);
  return { jobs, bad };
}

export function formatList(xs: number[]): string {
  return xs.join(',');
}

export function parseList(s: string, min: number, max: number): number[] | null {
  const xs = s.split(',').map((x) => (/^\s*\d+\s*$/.test(x) ? Number(x) : NaN));
  return xs.length > 0 && xs.every((x) => Number.isFinite(x) && x >= min && x <= max) ? xs : null;
}

/* ---------- OSTEP random problems ---------- */

/** scheduler.py's job generator: `runtime = int(maxlen * random.random()) + 1`. */
export function schedulerJobs(seed: number, count = 3, maxlen = 10): Job[] {
  const r = new PyRandom(seed);
  return Array.from({ length: count }, () => ({ arrival: 0, length: Math.floor(maxlen * r.random()) + 1, ioFreq: 0 }));
}

/** mlfq.py's job generator (runTime, then ioFreq, per job; all start at 0). */
export function mlfqJobs(seed: number, count = 3, maxlen = 100, maxio = 10): Job[] {
  const r = new PyRandom(seed);
  return Array.from({ length: count }, () => {
    const length = Math.floor(r.random() * (maxlen - 1) + 1);
    const ioFreq = Math.floor(r.random() * (maxio - 1) + 1);
    return { arrival: 0, length, ioFreq };
  });
}

/* ---------- OSTEP command lines ---------- */

export interface Gen {
  seed: number;
  count: number;
  maxlen: number;
  maxio: number;
}

export function formatGen(g: Gen, kind: 'scheduler' | 'mlfq'): string {
  return kind === 'scheduler' ? `${g.seed},${g.count},${g.maxlen}` : `${g.seed},${g.count},${g.maxlen},${g.maxio}`;
}

export function parseGen(s: string): Gen | null {
  const xs = parseList(s, 0, 1e9);
  if (!xs || xs.length < 3) return null;
  return { seed: xs[0], count: xs[1], maxlen: xs[2], maxio: xs[3] ?? 10 };
}

export function genJobs(g: Gen, kind: 'scheduler' | 'mlfq'): Job[] {
  return kind === 'scheduler' ? schedulerJobs(g.seed, g.count, g.maxlen) : mlfqJobs(g.seed, g.count, g.maxlen, g.maxio);
}

export type OstepCommand = { ok: true; cmd: string } | { ok: false; reason: 'stcf' | 'arrivals' | 'io' };

export function ostepCommand(opts: {
  policy: Policy;
  jobs: Job[];
  quantum: number;
  ioTime: number;
  mlfq: MlfqParams;
  /** Seed-generated problem, if the jobs still match it. */
  gen?: Gen | null;
}): OstepCommand {
  const { policy, jobs, quantum, ioTime, mlfq, gen } = opts;
  if (policy === 'mlfq') {
    const parts = ['./mlfq.py'];
    if (gen && same(genJobs(gen, 'mlfq'), jobs)) {
      parts.push(`-s ${gen.seed}`, `-j ${gen.count}`);
      if (gen.maxlen !== 100) parts.push(`-m ${gen.maxlen}`);
      if (gen.maxio !== 10) parts.push(`-M ${gen.maxio}`);
    } else parts.push(`-l ${jobs.map((j) => `${j.arrival},${j.length},${j.ioFreq}`).join(':')}`);
    const allSame = (xs: number[]) => xs.every((x) => x === xs[0]);
    if (allSame(mlfq.quanta)) {
      if (mlfq.quanta.length !== 3) parts.push(`-n ${mlfq.quanta.length}`);
      if (mlfq.quanta[0] !== 10) parts.push(`-q ${mlfq.quanta[0]}`);
    } else parts.push(`-Q ${formatList(mlfq.quanta)}`);
    if (allSame(mlfq.allotments)) {
      if (mlfq.allotments[0] !== 1) parts.push(`-a ${mlfq.allotments[0]}`);
    } else parts.push(`-A ${formatList(mlfq.allotments)}`);
    if (mlfq.boost > 0) parts.push(`-B ${mlfq.boost}`);
    if (ioTime !== 5) parts.push(`-i ${ioTime}`);
    if (mlfq.stay) parts.push('-S');
    if (mlfq.iobump) parts.push('-I');
    parts.push('-c');
    return { ok: true, cmd: parts.join(' ') };
  }
  if (policy === 'stcf') return { ok: false, reason: 'stcf' };
  if (jobs.some((j) => j.arrival !== 0)) return { ok: false, reason: 'arrivals' };
  if (jobs.some((j) => j.ioFreq !== 0)) return { ok: false, reason: 'io' };
  const parts = ['./scheduler.py', `-p ${policy.toUpperCase()}`];
  if (gen && same(genJobs(gen, 'scheduler'), jobs)) {
    parts.push(`-s ${gen.seed}`);
    if (gen.count !== 3) parts.push(`-j ${gen.count}`);
    if (gen.maxlen !== 10) parts.push(`-m ${gen.maxlen}`);
  } else parts.push(`-l ${jobs.map((j) => j.length).join(',')}`);
  if (policy === 'rr') parts.push(`-q ${quantum}`);
  parts.push('-c');
  return { ok: true, cmd: parts.join(' ') };
}

function same(a: Job[], b: Job[]): boolean {
  return a.length === b.length && a.every((j, i) => j.arrival === b[i].arrival && j.length === b[i].length && j.ioFreq === b[i].ioFreq);
}

/* ---------- pasting OSTEP flags ---------- */

export interface ParsedFlags {
  kind: 'scheduler' | 'mlfq';
  policy: Policy;
  jobs: Job[];
  gen: Gen | null;
  quantum?: number;
  ioTime?: number;
  mlfq?: MlfqParams;
}

export type FlagError =
  | { k: 'unknown'; flag: string }
  | { k: 'value'; flag: string }
  | { k: 'policy'; value: string }
  | { k: 'jobs' }
  | { k: 'mismatch' }
  | { k: 'range'; flag: string };

const SCHED_FLAGS: Record<string, string> = { s: 's', seed: 's', j: 'j', jobs: 'j', l: 'l', jlist: 'l', m: 'm', maxlen: 'm', p: 'p', policy: 'p', q: 'q', quantum: 'q', c: 'c' };
const MLFQ_FLAGS: Record<string, string> = {
  s: 's', seed: 's', n: 'n', numQueues: 'n', q: 'q', quantum: 'q', a: 'a', allotment: 'a', Q: 'Q', quantumList: 'Q', A: 'A', allotmentList: 'A',
  j: 'j', numJobs: 'j', m: 'm', maxlen: 'm', M: 'M', maxio: 'M', B: 'B', boost: 'B', i: 'i', iotime: 'i', S: 'S', stay: 'S', I: 'I', iobump: 'I',
  l: 'l', jlist: 'l', c: 'c',
};
const BOOLEAN = new Set(['c', 'S', 'I']);

/**
 * Reads a pasted command line for scheduler.py or mlfq.py (short or long
 * options, `-q 2`, `-q2`, `--quantum=2`) and returns the same problem.
 */
export function parseOstepFlags(text: string): { ok: true; value: ParsedFlags } | { ok: false; error: FlagError } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const named = tokens.find((t) => /(scheduler|mlfq)(\.py)?$/.test(t));
  const shortOnlyMlfq = /(^|\s)-(n|a|Q|A|M|B|i|S|I)\b|--(numQueues|allotment|quantumList|allotmentList|maxio|boost|iotime|stay|iobump)\b/;
  const kind: 'scheduler' | 'mlfq' = named ? (named.includes('mlfq') ? 'mlfq' : 'scheduler') : shortOnlyMlfq.test(text) || /-l\s*\S*:/.test(text) ? 'mlfq' : 'scheduler';
  const table = kind === 'mlfq' ? MLFQ_FLAGS : SCHED_FLAGS;
  const opts: Record<string, string | true> = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith('-')) {
      if (/^(\.\/)?[\w./-]*(scheduler|mlfq)(\.py)?$/.test(tok) || /^python[\d.]*$/.test(tok) || tok === 'prompt>' || tok === '$') continue;
      return { ok: false, error: { k: 'unknown', flag: tok } };
    }
    let name: string;
    let inline: string | undefined;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      inline = eq === -1 ? undefined : tok.slice(eq + 1);
    } else {
      name = tok[1] ?? '';
      inline = tok.length > 2 ? tok.slice(2) : undefined;
    }
    const key = table[name];
    if (!key) return { ok: false, error: { k: 'unknown', flag: tok } };
    if (BOOLEAN.has(key)) {
      opts[key] = true;
      continue;
    }
    const v = inline ?? tokens[++i];
    if (v === undefined) return { ok: false, error: { k: 'value', flag: tok } };
    opts[key] = v;
  }

  const int = (k: string, def: number, min: number, max: number): number | FlagError => {
    const v = opts[k];
    if (v === undefined) return def;
    if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return { k: 'value', flag: `-${k}` };
    const n = Number(v);
    return n < min || n > max ? { k: 'range', flag: `-${k}` } : n;
  };
  const isErr = (x: unknown): x is FlagError => typeof x === 'object' && x !== null;

  const seed = int('s', 0, 0, 1e9);
  const count = int('j', 3, 1, LIMITS.jobs);
  if (isErr(seed)) return { ok: false, error: seed };
  if (isErr(count)) return { ok: false, error: count };

  if (kind === 'scheduler') {
    const maxlen = int('m', 10, 1, LIMITS.length);
    const quantum = int('q', 1, 1, LIMITS.quantum);
    if (isErr(maxlen)) return { ok: false, error: maxlen };
    if (isErr(quantum)) return { ok: false, error: quantum };
    const p = String(opts.p ?? 'FIFO').toLowerCase();
    if (!['fifo', 'sjf', 'rr', 'stcf'].includes(p)) return { ok: false, error: { k: 'policy', value: String(opts.p) } };
    let jobs: Job[];
    let gen: Gen | null = null;
    if (typeof opts.l === 'string') {
      const lens = opts.l.split(',');
      if (!lens.every((x) => /^\d+$/.test(x) && Number(x) >= 1 && Number(x) <= LIMITS.length) || lens.length > LIMITS.jobs) return { ok: false, error: { k: 'jobs' } };
      jobs = lens.map((x) => ({ arrival: 0, length: Number(x), ioFreq: 0 }));
    } else {
      gen = { seed, count, maxlen, maxio: 10 };
      jobs = genJobs(gen, 'scheduler');
    }
    return { ok: true, value: { kind, policy: p as Policy, jobs, gen, quantum } };
  }

  const fields: [string, number, number, number][] = [
    ['n', 3, 1, LIMITS.queues],
    ['q', 10, 1, LIMITS.quantum],
    ['a', 1, 1, LIMITS.allotment],
    ['m', 100, 2, LIMITS.length],
    ['M', 10, 2, LIMITS.ioFreq],
    ['B', 0, 0, LIMITS.boost],
    ['i', 5, 1, LIMITS.ioTime],
  ];
  const v: Record<string, number> = {};
  for (const [k, def, min, max] of fields) {
    const x = int(k, def, min, max);
    if (isErr(x)) return { ok: false, error: x };
    v[k] = x;
  }
  let quanta = Array.from({ length: v.n }, () => v.q);
  if (typeof opts.Q === 'string') {
    const q = parseList(opts.Q, 1, LIMITS.quantum);
    if (!q || q.length > LIMITS.queues) return { ok: false, error: { k: 'value', flag: '-Q' } };
    quanta = q;
  }
  let allotments = quanta.map(() => v.a);
  if (typeof opts.A === 'string') {
    const a = parseList(opts.A, 1, LIMITS.allotment);
    if (!a) return { ok: false, error: { k: 'value', flag: '-A' } };
    if (a.length !== quanta.length) return { ok: false, error: { k: 'mismatch' } };
    allotments = a;
  }
  let jobs: Job[];
  let gen: Gen | null = null;
  if (typeof opts.l === 'string') {
    const groups = opts.l.split(':');
    const parsed = groups.map((g) => g.split(','));
    if (!parsed.every((g) => g.length === 3 && g.every((x) => /^\d+$/.test(x))) || groups.length > LIMITS.jobs) return { ok: false, error: { k: 'jobs' } };
    jobs = parsed.map(([a, l, z]) => ({ arrival: Number(a), length: Number(l), ioFreq: Number(z) }));
    if (jobs.some((j) => j.length < 1 || j.length > LIMITS.length || j.arrival > LIMITS.arrival || j.ioFreq > LIMITS.ioFreq)) return { ok: false, error: { k: 'jobs' } };
  } else {
    gen = { seed, count, maxlen: v.m, maxio: v.M };
    jobs = genJobs(gen, 'mlfq');
  }
  return {
    ok: true,
    value: { kind, policy: 'mlfq', jobs, gen, ioTime: v.i, mlfq: { quanta, allotments, boost: v.B, stay: opts.S === true, iobump: opts.I === true } },
  };
}

/**
 * Python's `'%.Nf' % x`: like toFixed, but an exact binary tie rounds to even
 * (66.125 → "66.12", where toFixed says "66.13"), so averages read the same as
 * the scripts' output.
 */
export function pyFixed(x: number, digits = 2): string {
  const scaled = x * 10 ** digits;
  const frac = scaled - Math.floor(scaled);
  if (frac === 0.5) {
    const lo = Math.floor(scaled);
    return ((lo % 2 === 0 ? lo : lo + 1) / 10 ** digits).toFixed(digits);
  }
  return x.toFixed(digits);
}
