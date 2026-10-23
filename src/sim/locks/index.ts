/**
 * Race conditions and locks: a faithful port of OSTEP's x86.py plus the
 * analysis the page shows on top (critical sections, lost updates, spins).
 * Config in → `{ initial, steps[] }` out, each step a full snapshot.
 */
import { assemble, type AsmError, type Assembled } from './asm';
import { counterStore, findCriticalSections, findSpinJumps, insideCS, type Range } from './analysis';
import { DEFAULT_MAX_STEPS, prepare, runX86, type ConfigError, type ExecResult, type Fault, type RawRun, type SwitchEvent, type ThreadState, type X86Config } from './machine';

export * from './asm';
export * from './machine';
export * from './analysis';
export * from './flags';
export * from './programs';

export interface Cell {
  addr: number;
  /** Variable name (with [i] for arrays) or the address. */
  label: string;
  isVar: boolean;
}

export interface Snapshot {
  threads: ThreadState[];
  /** Thread that runs next (null when all are done). */
  running: number | null;
  /** Value of each `cells` entry. */
  mem: number[];
  inCS: boolean[];
  /** Two or more threads inside the critical section at once. */
  overlap: boolean;
  /** Shared counter so far vs. how many increments completed (one per critical-section store). */
  counter?: { value: number; expected: number };
  /** Cumulative spin-loop iterations per thread. */
  spins: number[];
  /** Cumulative context switches (to a different thread). */
  switches: number;
}

export interface LocksStep extends Snapshot {
  /** 1-based instruction count. */
  n: number;
  tid: number;
  pc: number;
  idx: number;
  res: ExecResult;
  events: SwitchEvent[];
  /** This store left the counter behind the number of increments: an update was lost. */
  lost: boolean;
  /** This step is a taken jump back into a spin loop. */
  spin: boolean;
}

export interface LocksRun {
  asm: Assembled;
  errors: AsmError[];
  configErrors: ConfigError[];
  /** Assembled and configured cleanly (steps are meaningful). */
  ok: boolean;
  raw?: RawRun;
  initial: Snapshot;
  steps: LocksStep[];
  cells: Cell[];
  cs: Range[];
  counterAddr?: number;
  counterLabel?: string;
  spinJumps: Set<number>;
  manual: boolean;
  truncated: boolean;
  fault?: Fault;
}

const EMPTY: Snapshot = { threads: [], running: null, mem: [], inCS: [], overlap: false, spins: [], switches: 0 };

export function labelFor(asm: Assembled, addr: number): string {
  for (const [name, a] of Object.entries(asm.vars)) {
    const size = asm.varSizes[name] ?? 1;
    if (addr >= a && addr < a + 4 * size && (addr - a) % 4 === 0) return size > 1 ? `${name}[${(addr - a) / 4}]` : name;
  }
  return String(addr);
}

export function simulateLocks(source: string, cfg: X86Config): LocksRun {
  const asm = assemble(source, cfg.loadAddr);
  const prep = prepare(asm, cfg);
  const cs = findCriticalSections(asm);
  const spinJumps = findSpinJumps(asm);
  const base = { asm, errors: asm.errors, configErrors: prep.errors, cs, spinJumps };
  if (asm.errors.length || prep.errors.length || asm.program.length === 0) {
    return { ...base, ok: false, initial: { ...EMPTY, threads: prep.threads, spins: prep.threads.map(() => 0) }, steps: [], cells: [], manual: false, truncated: false };
  }
  const raw = runX86(asm, { ...cfg, maxSteps: cfg.maxSteps ?? DEFAULT_MAX_STEPS }, prep);

  // shared memory cells: variables, traced addresses, and any non-stack data the run touched
  const stackLo = Math.min(...prep.stackBottoms) - 1000;
  const stackHi = Math.max(...prep.stackBottoms);
  const isStack = (a: number) => a > stackLo && a <= stackHi;
  const addrs = new Set<number>();
  for (const [name, a] of Object.entries(asm.vars)) for (let i = 0; i < (asm.varSizes[name] ?? 1); i++) addrs.add(a + 4 * i);
  for (const m of prep.memtrace) addrs.add(m.addr);
  for (const st of raw.steps) {
    for (const a of st.res.reads) if (!isStack(a)) addrs.add(a);
    for (const w of st.res.writes) if (!isStack(w.addr)) addrs.add(w.addr);
  }
  const cellAddrs = [...addrs].sort((a, b) => a - b).slice(0, 32);
  const cells: Cell[] = cellAddrs.map((addr) => {
    const label = labelFor(asm, addr);
    return { addr, label, isVar: label !== String(addr) };
  });
  const cellIndex = new Map(cellAddrs.map((a, i) => [a, i]));

  const storeIdx = counterStore(asm, cs);
  let counterAddr = storeIdx !== undefined ? asm.program[storeIdx].staticAddr : undefined;
  if (storeIdx !== undefined && counterAddr === undefined) counterAddr = raw.steps.find((s) => s.idx === storeIdx && s.res.writes.length)?.res.writes[0].addr;

  const n = raw.initialThreads.length;
  const mem = cellAddrs.map(() => 0);
  const spins = Array(n).fill(0) as number[];
  let switches = 0;
  let expected = 0;
  let counterValue = 0;
  let deficit = 0;
  const hasCounter = counterAddr !== undefined;
  const initInCS = insideCS(asm, raw.initialThreads, cs);
  const initial: Snapshot = {
    threads: raw.initialThreads,
    running: raw.initialRunning,
    mem: mem.slice(),
    inCS: initInCS,
    overlap: false,
    counter: hasCounter ? { value: 0, expected: 0 } : undefined,
    spins: spins.slice(),
    switches: 0,
  };

  const steps: LocksStep[] = raw.steps.map((st) => {
    for (const w of st.res.writes) {
      const i = cellIndex.get(w.addr);
      if (i !== undefined) mem[i] = w.value;
      if (w.addr === counterAddr) counterValue = w.value;
    }
    let lost = false;
    if (hasCounter && st.idx === storeIdx) {
      expected++;
      if (expected - counterValue > deficit) lost = true;
      deficit = Math.max(deficit, expected - counterValue);
    }
    const spin = spinJumps.has(st.idx) && !!st.res.jump?.taken;
    if (spin) spins[st.tid]++;
    for (const ev of st.events) if (ev.from !== ev.to) switches++;
    const inCS = insideCS(asm, st.threads, cs);
    return {
      n: st.n,
      tid: st.tid,
      pc: st.pc,
      idx: st.idx,
      res: st.res,
      events: st.events,
      threads: st.threads,
      running: st.running,
      mem: mem.slice(),
      inCS,
      overlap: inCS.filter(Boolean).length >= 2,
      counter: hasCounter ? { value: counterValue, expected } : undefined,
      spins: spins.slice(),
      switches,
      lost,
      spin,
    };
  });

  return {
    ...base,
    ok: true,
    raw,
    initial,
    steps,
    cells,
    counterAddr,
    counterLabel: counterAddr !== undefined ? labelFor(asm, counterAddr) : undefined,
    manual: raw.manual,
    truncated: raw.truncated,
    fault: raw.fault,
  };
}
