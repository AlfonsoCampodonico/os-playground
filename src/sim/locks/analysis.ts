/**
 * What x86.py does not compute but a student wants to see: critical sections,
 * the shared counter (expected vs actual), spin-loop iterations, and the
 * schedule editing behind "elegí cuándo ocurre la interrupción".
 */
import type { Assembled } from './asm';
import { cloneThread, execInstr, MachineFault, newMemory, prepare, type Prepared, type RawRun, type ThreadState, type X86Config } from './machine';

/** Instruction-index range [start, end). */
export interface Range {
  start: number;
  end: number;
}

const CS_MARK = /critical section|secci[oó]n cr[ií]tica/i;

/**
 * Critical sections: the instructions right after a comment line mentioning
 * "critical section" / "sección crítica", up to the next blank line, comment,
 * label or halt. Without markers, any load / add / store of the same address
 * counts.
 */
export function findCriticalSections(asm: Assembled): Range[] {
  const out: Range[] = [];
  const src = asm.source;
  for (let i = 0; i < src.length; i++) {
    if (src[i].kind !== 'comment' || !CS_MARK.test(src[i].comment ?? '')) continue;
    let start = -1;
    let end = -1;
    for (let j = i + 1; j < src.length; j++) {
      const l = src[j];
      if (l.kind !== 'instr' || asm.program[l.idx!]?.op.k === 'halt') break;
      if (start === -1) start = l.idx!;
      end = l.idx! + 1;
    }
    if (start !== -1) out.push({ start, end });
  }
  if (out.length > 0) return out;
  const p = asm.program;
  for (let i = 0; i + 2 < p.length; i++) {
    const [a, b, c] = [p[i].op, p[i + 1].op, p[i + 2].op];
    if (a.k === 'mov_mr' && (b.k === 'add_i' || b.k === 'add_r') && b.dst === a.dst && c.k === 'mov_rm' && c.src === a.dst && JSON.stringify(c.m) === JSON.stringify(a.m))
      out.push({ start: i, end: i + 3 });
  }
  return out;
}

/**
 * Spin loops: backward jumps whose loop body reads shared memory (or swaps
 * it atomically) but never does a plain store: they only wait.
 */
export function findSpinJumps(asm: Assembled): Set<number> {
  const out = new Set<number>();
  asm.program.forEach((ins, j) => {
    if (ins.op.k !== 'jump') return;
    const t = ins.op.target - asm.loadAddr;
    if (t < 0 || t > j) return;
    const body = asm.program.slice(t, j + 1).map((x) => x.op.k);
    const reads = body.some((k) => k === 'mov_mr' || k === 'xchg' || k === 'fetchadd');
    const stores = body.some((k) => k === 'mov_rm' || k === 'mov_im' || k === 'push_r' || k === 'push_m' || k === 'call');
    if (reads && !stores) out.add(j);
  });
  return out;
}

/** Threads whose next instruction is strictly inside a critical section (they started it and did not finish). */
export function insideCS(asm: Assembled, threads: ThreadState[], cs: Range[]): boolean[] {
  return threads.map((t) => {
    if (t.done) return false;
    const idx = t.pc - asm.loadAddr;
    return cs.some((r) => idx > r.start && idx < r.end);
  });
}

/** The store that ends the first critical section (its address is the shared counter). */
export function counterStore(asm: Assembled, cs: Range[]): number | undefined {
  for (const r of cs) {
    for (let i = r.end - 1; i >= r.start; i--) {
      const k = asm.program[i].op.k;
      if (k === 'mov_rm' || k === 'mov_im') return i;
    }
  }
  return undefined;
}

/* ---------- schedules ---------- */

/** Switch points of a run: after step k (0-based) the next instruction is run by `target`. */
export type Points = Map<number, number>;

export function derivePoints(run: RawRun): Points {
  const p: Points = new Map();
  for (let k = 0; k + 1 < run.steps.length; k++) if (run.steps[k + 1].tid !== run.steps[k].tid) p.set(k, run.steps[k + 1].tid);
  return p;
}

function nextRunnable(threads: ThreadState[], cur: number): number | undefined {
  const n = threads.length;
  for (let d = 1; d <= n; d++) {
    const x = (cur + d) % n;
    if (!threads[x].done) return x;
  }
  return undefined;
}

/**
 * Runs with explicit switch points (my extension, used to build -P strings):
 * at a point, switch to its target; on halt or yield, round-robin to the next
 * ready thread; after the last point, a timer every `cfg.intfreq` instructions.
 */
export function runPoints(asm: Assembled, cfg: X86Config, points: Points, first: number, prep: Prepared = prepare(asm, cfg), tailFrom?: number) {
  const threads = prep.threads.map(cloneThread);
  const mem = newMemory(asm, cfg);
  const maxSteps = cfg.maxSteps ?? 3000;
  const last = tailFrom ?? (points.size ? Math.max(...points.keys()) : -1);
  const seq: number[] = [];
  const halts: boolean[] = [];
  let cur = first;
  for (let k = 0; k < maxSteps; k++) {
    let rc: number;
    try {
      rc = execInstr(asm, threads[cur], mem).rc;
    } catch (e) {
      if (e instanceof MachineFault) break;
      throw e;
    }
    seq.push(cur);
    halts.push(rc === -1);
    if (rc === -1) threads[cur].done = true;
    if (threads.every((t) => t.done)) break;
    const target = points.get(k);
    if (target !== undefined && !threads[target].done && target !== cur) cur = target;
    else if (rc === -1 || rc === -2 || (k > last && (k - last) % cfg.intfreq === 0)) cur = nextRunnable(threads, cur) ?? cur;
  }
  return { seq, halts };
}

/**
 * The -P string that makes x86.py run exactly `seq` (one thread id per
 * instruction). Manual mode advances one slot per instruction, and a halt
 * burns one extra slot (proclist.next() runs twice), hence the filler.
 */
export function scheduleFromSequence(seq: number[], halts: boolean[], nThreads: number): string {
  if (seq.length === 0) return '';
  const p = [seq[0]];
  for (let k = 0; k + 1 < seq.length; k++) {
    if (halts[k]) p.push(seq[k + 1]);
    p.push(seq[k + 1]);
  }
  for (let t = 0; t < nThreads; t++) if (!p.includes(t)) p.push(t);
  return p.join('');
}

export type ToggleResult = { ok: true; procsched: string; added: boolean } | { ok: false; reason: 'halt' | 'yield' | 'alone' | 'end' };

/** Adds or removes the context switch between step `gap` and `gap + 1` (0-based), returning the new -P. */
export function toggleSwitch(asm: Assembled, cfg: X86Config, run: RawRun, gap: number): ToggleResult {
  const steps = run.steps;
  if (gap < 0 || gap + 1 >= steps.length) return { ok: false, reason: 'end' };
  const points = derivePoints(run);
  const st = steps[gap];
  let added: boolean;
  if (points.has(gap)) {
    if (st.res.rc === -1) return { ok: false, reason: 'halt' };
    if (st.res.rc === -2) return { ok: false, reason: 'yield' };
    points.delete(gap);
    added = false;
  } else {
    const target = nextRunnable(st.threads, st.tid);
    if (target === undefined || target === st.tid) return { ok: false, reason: 'alone' };
    points.set(gap, target);
    added = true;
  }
  const { seq, halts } = runPoints(asm, cfg, points, steps[0].tid);
  return { ok: true, procsched: scheduleFromSequence(seq, halts, run.initialThreads.length), added };
}

/* ---------- "¿con qué interleaving se rompe?" ---------- */

export interface Violation {
  /** Runs of (thread, instructions) up to the moment two threads are inside. */
  segments: [number, number][];
  /** Instruction count when the overlap happens. */
  at: number;
  /** Full -P that reproduces it (and then finishes the run). */
  procsched: string;
}

/**
 * Searches schedules with few context switches (iterative deepening) for one
 * that puts two threads inside the critical section at once.
 */
export function findViolation(asm: Assembled, cfg: X86Config, cs: Range[], opts: { maxSwitches?: number; maxSegment?: number; budget?: number } = {}): Violation | null {
  if (cs.length === 0) return null;
  const prep = prepare(asm, cfg);
  if (prep.errors.length || asm.errors.length) return null;
  const n = prep.threads.length;
  if (n < 2) return null;
  const maxSwitches = opts.maxSwitches ?? 3;
  const maxSeg = opts.maxSegment ?? 12;
  let budget = opts.budget ?? 120_000;
  const first = prep.sched[0] ?? 0;

  type State = { threads: ThreadState[]; mem: ReturnType<typeof newMemory> };
  const clone = (s: State): State => ({ threads: s.threads.map(cloneThread), mem: s.mem.clone() });
  const overlap = (threads: ThreadState[]) => insideCS(asm, threads, cs).filter(Boolean).length >= 2;

  const dfs = (s0: State, cur: number, left: number, seq: number[]): number[] | null => {
    const s = clone(s0);
    const local = seq.slice();
    for (let len = 1; len <= maxSeg; len++) {
      if (--budget < 0) return null;
      let rc: number;
      try {
        rc = execInstr(asm, s.threads[cur], s.mem).rc;
      } catch {
        return null;
      }
      local.push(cur);
      if (overlap(s.threads)) return local;
      if (rc === -1) {
        s.threads[cur].done = true;
        for (let x = 0; x < n; x++) {
          if (s.threads[x].done) continue;
          const r = dfs(s, x, left, local);
          if (r) return r;
        }
        return null;
      }
      if (left > 0) {
        for (let d = 1; d < n; d++) {
          const x = (cur + d) % n;
          if (s.threads[x].done) continue;
          const r = dfs(s, x, left - 1, local);
          if (r) return r;
        }
      }
    }
    return null;
  };

  const s0: State = { threads: prep.threads.map(cloneThread), mem: newMemory(asm, cfg) };
  for (let k = 1; k <= maxSwitches; k++) {
    const seq = dfs(s0, first, k, []);
    if (seq) {
      const segments: [number, number][] = [];
      for (const t of seq) {
        const lastSeg = segments.at(-1);
        if (lastSeg && lastSeg[0] === t) lastSeg[1]++;
        else segments.push([t, 1]);
      }
      const points: Points = new Map();
      for (let i = 0; i + 1 < seq.length; i++) if (seq[i + 1] !== seq[i]) points.set(i, seq[i + 1]);
      // make the prefix explicit even where the timer would agree, then let the timer finish the run
      const full = runPoints(asm, { ...cfg, procsched: '' }, points, first, prep, seq.length - 1);
      return { segments, at: seq.length, procsched: scheduleFromSequence(full.seq, full.halts, n) };
    }
    if (budget < 0) break;
  }
  return null;
}
