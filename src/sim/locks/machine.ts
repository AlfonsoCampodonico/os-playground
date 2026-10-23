/**
 * The machine of OSTEP's `x86.py` (threads-locks/ version, a superset of the
 * threads-intro/ one): per-thread registers, PC and condition codes, a shared
 * memory, and the interrupt / manual-schedule logic of `cpu.run()` and
 * `proclist`, including its quirks (the interrupt counter keeps running after
 * a halt; a halt consumes an extra `-P` slot; `-r` draws `int(random()*i)+1`).
 *
 * x86.py copies registers between the CPU and each thread on save/restore;
 * here each thread's context *is* its register file, which is equivalent
 * (a halted thread is never restored, and saving/restoring the same thread is
 * a no-op).
 */
import { PyRandom } from '../../lib/pyrandom';
import { CC, REG, REG_NAMES, SP, type Assembled, type Instr, type Mem, type RegName } from './asm';

export interface ThreadState {
  pc: number;
  regs: number[];
  cc: boolean[];
  done: boolean;
}

export interface X86Config {
  /** -t */
  threads: number;
  /** -i */
  intfreq: number;
  /** -r */
  intrand: boolean;
  /** -s */
  seed: number;
  /** -P, e.g. "0011" ('' = use the interrupt timer) */
  procsched: string;
  /** -a, e.g. "bx=2,bx=2" (comma between threads, colon between registers) */
  argv: string;
  /** -M, e.g. "count,2000" */
  memtrace: string;
  /** -R, e.g. "ax,bx" */
  regtrace: string;
  /** -C */
  cctrace: boolean;
  /** -L */
  loadAddr: number;
  /** -m, in KB */
  memsize: number;
  /** Safety cap: x86.py would happily spin forever. */
  maxSteps?: number;
}

export const X86_DEFAULTS: X86Config = {
  threads: 2,
  intfreq: 50,
  intrand: false,
  seed: 0,
  procsched: '',
  argv: '',
  memtrace: '',
  regtrace: '',
  cctrace: false,
  loadAddr: 1000,
  memsize: 128,
};

export type ConfigErrorCode = 'threads' | 'intfreq' | 'argvCount' | 'argvReg' | 'schedThread' | 'schedMissing' | 'schedChar' | 'memtrace' | 'regtrace';
export interface ConfigError {
  flag: string;
  code: ConfigErrorCode;
  detail: string;
}

export type FaultCode = 'readCode' | 'writeCode' | 'badAddr' | 'pcOut';
export interface Fault {
  code: FaultCode;
  /** Offending address. */
  addr: number;
  tid: number;
  pc: number;
}

export class MachineFault extends Error {
  constructor(
    public code: FaultCode,
    public addr: number,
  ) {
    super(code);
  }
}

export interface Write {
  addr: number;
  old: number;
  value: number;
}

export interface ExecResult {
  /** 0 normal, -1 halt, -2 yield (x86.py's return codes). */
  rc: 0 | -1 | -2;
  reads: number[];
  writes: Write[];
  jump?: { taken: boolean; label: string };
  /** Values compared by `test` (x86.py's test_all(src, dst)). */
  test?: { src: number; dst: number };
  /** Text printed by rdump / mdump. */
  dump?: string;
}

/** Shared memory with x86.py's addressing rules. */
export class Memory {
  cells: Map<number, number>;
  constructor(
    public codeLo: number,
    public codeHi: number,
    public max: number,
    cells?: Map<number, number>,
  ) {
    this.cells = cells ?? new Map();
  }
  read(addr: number): number {
    if (addr >= this.codeLo && addr < this.codeHi) throw new MachineFault('readCode', addr);
    const v = this.cells.get(addr);
    if (v !== undefined) return v;
    if (addr >= 0 && addr < this.max) return 0;
    throw new MachineFault('badAddr', addr);
  }
  /** Read without faulting (for traces and displays). */
  peek(addr: number): number {
    return this.cells.get(addr) ?? 0;
  }
  write(addr: number, value: number): number {
    if (addr >= this.codeLo && addr < this.codeHi) throw new MachineFault('writeCode', addr);
    const old = this.cells.get(addr) ?? 0;
    this.cells.set(addr, value);
    return old;
  }
  clone(): Memory {
    return new Memory(this.codeLo, this.codeHi, this.max, new Map(this.cells));
  }
}

export function newThread(): ThreadState {
  return { pc: 0, regs: REG_NAMES.map(() => 0), cc: [false, false, false, false, false, false], done: false };
}

export function cloneThread(t: ThreadState): ThreadState {
  return { pc: t.pc, regs: t.regs.slice(), cc: t.cc.slice(), done: t.done };
}

const ea = (m: Mem, r: number[]) => m.disp + r[m.r1] + m.scale * r[m.r2];

/** Executes the instruction at `t.pc` on thread context `t`. */
export function execInstr(asm: Assembled, t: ThreadState, mem: Memory): ExecResult {
  const idx = t.pc - asm.loadAddr;
  const ins: Instr | undefined = asm.program[idx];
  if (!ins) throw new MachineFault('pcOut', t.pc);
  t.pc += 1;
  const r = t.regs;
  const reads: number[] = [];
  const writes: Write[] = [];
  const rd = (a: number) => {
    reads.push(a);
    return mem.read(a);
  };
  const wr = (a: number, v: number) => {
    const old = mem.write(a, v);
    writes.push({ addr: a, old, value: v });
  };
  const res: ExecResult = { rc: 0, reads, writes };
  const op = ins.op;
  switch (op.k) {
    case 'mov_ir':
      r[op.dst] = op.imm;
      break;
    case 'mov_mr':
      r[op.dst] = rd(ea(op.m, r));
      break;
    case 'mov_rm':
      wr(ea(op.m, r), r[op.src]);
      break;
    case 'mov_rr':
      r[op.dst] = r[op.src];
      break;
    case 'mov_im':
      wr(ea(op.m, r), op.imm);
      break;
    case 'lea':
      r[op.dst] = ea(op.m, r);
      break;
    case 'neg':
      r[op.r] = -r[op.r];
      break;
    case 'add_i':
      r[op.dst] += op.imm;
      break;
    case 'add_r':
      r[op.dst] += r[op.src];
      break;
    case 'sub_i':
      r[op.dst] -= op.imm;
      break;
    case 'sub_r':
      r[op.dst] -= r[op.src];
      break;
    case 'mul_i':
      r[op.dst] *= op.imm;
      break;
    case 'mul_r':
      r[op.dst] *= r[op.src];
      break;
    case 'xchg': {
      const a = op.m.disp + r[op.m.r1] + r[op.m.r2];
      const old = rd(a);
      wr(a, r[op.src]);
      r[op.src] = old;
      break;
    }
    case 'fetchadd': {
      const a = op.m.disp + r[op.m.r1] + r[op.m.r2];
      const old = rd(a);
      wr(a, old + r[op.src]);
      r[op.src] = old;
      break;
    }
    case 'test_ir':
      setcc(t, op.imm, r[op.reg]);
      res.test = { src: op.imm, dst: r[op.reg] };
      break;
    case 'test_ri':
      setcc(t, r[op.reg], op.imm);
      res.test = { src: r[op.reg], dst: op.imm };
      break;
    case 'test_rr':
      setcc(t, r[op.src], r[op.dst]);
      res.test = { src: r[op.src], dst: r[op.dst] };
      break;
    case 'jump': {
      const c = t.cc;
      const taken =
        op.cond === 'always' ||
        (op.cond === 'ne' && c[CC.NEQ]) ||
        (op.cond === 'eq' && c[CC.EQ]) ||
        (op.cond === 'lt' && c[CC.LT]) ||
        (op.cond === 'lte' && c[CC.LTE]) ||
        (op.cond === 'gt' && c[CC.GT]) ||
        (op.cond === 'gte' && c[CC.GTE]);
      if (taken) t.pc = op.target;
      res.jump = { taken, label: op.label };
      break;
    }
    case 'call':
      r[SP] -= 4;
      wr(r[SP], t.pc);
      t.pc = op.target;
      break;
    case 'ret':
      t.pc = rd(r[SP]);
      r[SP] += 4;
      break;
    case 'push_r':
      r[SP] -= 4;
      wr(r[SP], r[op.src]);
      break;
    case 'push_m': {
      r[SP] -= 4;
      const a = op.m.disp + r[op.m.r1] + r[op.m.r2] * op.m.scale;
      wr(r[SP], a);
      break;
    }
    case 'pop':
      r[SP] += 4;
      break;
    case 'pop_r':
      r[op.dst] = rd(r[SP]);
      r[SP] += 4;
      break;
    case 'halt':
      res.rc = -1;
      break;
    case 'yield':
      res.rc = -2;
      break;
    case 'nop':
      break;
    case 'rdump':
      res.dump = `REGISTERS:: ax: ${r[REG.ax]} bx: ${r[REG.bx]} cx: ${r[REG.cx]} dx: ${r[REG.dx]} ex: ${r[REG.ex]} fx: ${r[REG.fx]} `;
      break;
    case 'mdump':
      res.dump = `m[${op.addr}]  ${mem.peek(op.addr)}\n`;
      break;
  }
  return res;
}

function setcc(t: ThreadState, src: number, dst: number) {
  const c = t.cc;
  c[CC.GT] = dst > src;
  c[CC.GTE] = dst >= src;
  c[CC.LT] = dst < src;
  c[CC.LTE] = dst <= src;
  c[CC.EQ] = dst === src;
  c[CC.NEQ] = dst !== src;
}

/* ---------- configuration ---------- */

export interface Prepared {
  threads: ThreadState[];
  /** Parsed -P (empty = timer mode). */
  sched: number[];
  memtrace: { label: string; addr: number }[];
  regtrace: number[];
  errors: ConfigError[];
  stackBottoms: number[];
}

/** Validates the flags the way x86.py's main program does and builds the initial threads. */
export function prepare(asm: Assembled, cfg: X86Config): Prepared {
  const errors: ConfigError[] = [];
  const n = cfg.threads;
  if (!(Number.isInteger(n) && n >= 1)) errors.push({ flag: '-t', code: 'threads', detail: String(n) });
  if (!(cfg.intfreq > 0)) errors.push({ flag: '-i', code: 'intfreq', detail: String(cfg.intfreq) });
  const count = Math.max(1, Math.min(n || 1, 64));

  const argv = cfg.argv.split(',');
  if (argv.length !== count && argv.length !== 1) errors.push({ flag: '-a', code: 'argvCount', detail: cfg.argv });
  const threads: ThreadState[] = [];
  const stackBottoms: number[] = [];
  let stack = cfg.memsize * 1000;
  for (let i = 0; i < count; i++) {
    const t = newThread();
    t.pc = cfg.loadAddr;
    const arg = argv.length > 1 ? (argv[i] ?? '') : argv[0];
    if (arg !== '') {
      for (const piece of arg.split(':')) {
        const kv = piece.split('=');
        const name = kv[0]?.trim() as RegName;
        const v = kv.length === 2 ? Number(kv[1].trim()) : NaN;
        if (kv.length !== 2 || !(name in REG) || !/^[+-]?\d+$/.test(kv[1].trim())) {
          errors.push({ flag: '-a', code: 'argvReg', detail: piece });
          continue;
        }
        t.regs[REG[name]] = v;
      }
    }
    t.regs[SP] = stack;
    stackBottoms.push(stack);
    stack -= 1000;
    threads.push(t);
  }

  const sched: number[] = [];
  if (cfg.procsched !== '') {
    for (const ch of cfg.procsched) {
      if (!/[0-9]/.test(ch)) {
        errors.push({ flag: '-P', code: 'schedChar', detail: ch });
        break;
      }
      const p = Number(ch);
      if (p >= count) {
        errors.push({ flag: '-P', code: 'schedThread', detail: ch });
        break;
      }
      sched.push(p);
    }
    if (!errors.some((e) => e.flag === '-P') && new Set(sched).size !== count) errors.push({ flag: '-P', code: 'schedMissing', detail: cfg.procsched });
  }

  const memtrace: { label: string; addr: number }[] = [];
  if (cfg.memtrace !== '') {
    for (const m of cfg.memtrace.split(',')) {
      if (/^[0-9]/.test(m)) {
        const v = Number.parseInt(m, 10);
        if (!/^\d+$/.test(m.trim())) errors.push({ flag: '-M', code: 'memtrace', detail: m });
        else memtrace.push({ label: m, addr: v });
      } else if (m in asm.vars) memtrace.push({ label: m, addr: asm.vars[m] });
      else errors.push({ flag: '-M', code: 'memtrace', detail: m });
    }
  }
  const regtrace: number[] = [];
  if (cfg.regtrace !== '') {
    for (const r of cfg.regtrace.split(',')) {
      if (r in REG) regtrace.push(REG[r as RegName]);
      else errors.push({ flag: '-R', code: 'regtrace', detail: r });
    }
  }
  return { threads, sched, memtrace, regtrace, errors, stackBottoms };
}

/* ---------- the run loop (cpu.run + proclist) ---------- */

export type SwitchKind = 'halt' | 'interrupt' | 'yield';
export interface SwitchEvent {
  kind: SwitchKind;
  from: number;
  to: number;
  /** x86.py prints no "Interrupt" line for a manual-schedule switch to the same thread. */
  silent: boolean;
}

export interface RawStep {
  n: number;
  tid: number;
  pc: number;
  idx: number;
  res: ExecResult;
  /** Logical state of every thread after this instruction (and any switch). */
  threads: ThreadState[];
  /** Thread that runs next (null when all are done). */
  running: number | null;
  events: SwitchEvent[];
}

export interface RawRun {
  prep: Prepared;
  manual: boolean;
  initialThreads: ThreadState[];
  initialRunning: number;
  steps: RawStep[];
  finalMem: Memory;
  truncated: boolean;
  fault?: Fault;
}

export const DEFAULT_MAX_STEPS = 3000;

export function newMemory(asm: Assembled, cfg: X86Config): Memory {
  return new Memory(asm.loadAddr, asm.loadAddr + asm.program.length, cfg.memsize * 1024);
}

/** Runs the program exactly like `x86.py` (which must have assembled and validated cleanly). */
export function runX86(asm: Assembled, cfg: X86Config, prep: Prepared = prepare(asm, cfg)): RawRun {
  const maxSteps = cfg.maxSteps ?? DEFAULT_MAX_STEPS;
  const threads = prep.threads.map(cloneThread);
  const n = threads.length;
  const manual = prep.sched.length > 0;
  const sched = manual ? prep.sched : threads.map((_, i) => i);
  let curr = 0;
  let active = n;
  const mem = newMemory(asm, cfg);
  const rng = new PyRandom(cfg.seed);

  let intfreq = cfg.intfreq;
  let intrand = cfg.intrand;
  if (manual) {
    intfreq = 1;
    intrand = false;
  }
  const setint = () => (intrand ? Math.floor(rng.random() * intfreq) + 1 : intfreq);
  const next = () => {
    for (;;) {
      curr += 1;
      if (curr === sched.length) curr = 0;
      if (!threads[sched[curr]].done) return;
    }
  };

  const initialThreads = threads.map(cloneThread);
  const initialRunning = sched[0];
  const steps: RawStep[] = [];
  let interrupt = setint();
  let truncated = false;
  let fault: Fault | undefined;

  for (;;) {
    if (steps.length >= maxSteps) {
      truncated = true;
      break;
    }
    const tid = sched[curr];
    const t = threads[tid];
    const pc = t.pc;
    let res: ExecResult;
    try {
      res = execInstr(asm, t, mem);
    } catch (e) {
      if (!(e instanceof MachineFault)) throw e;
      fault = { code: e.code, addr: e.addr, tid, pc };
      break;
    }
    const events: SwitchEvent[] = [];
    let finished = false;
    if (res.rc === -1) {
      t.done = true;
      active -= 1;
      if (active === 0) finished = true;
      else {
        next();
        events.push({ kind: 'halt', from: tid, to: sched[curr], silent: false });
      }
    }
    if (!finished) {
      interrupt -= 1;
      if (interrupt === 0 || res.rc === -2) {
        interrupt = setint();
        const from = sched[curr];
        next();
        const to = sched[curr];
        events.push({ kind: res.rc === -2 ? 'yield' : 'interrupt', from, to, silent: manual && from === to });
      }
    }
    steps.push({
      n: steps.length + 1,
      tid,
      pc,
      idx: pc - asm.loadAddr,
      res,
      threads: threads.map(cloneThread),
      running: finished ? null : sched[curr],
      events,
    });
    if (finished) break;
  }
  return { prep, manual, initialThreads, initialRunning, steps, finalMem: mem, truncated, fault };
}

/* ---------- formatting, exactly like x86.py -c ---------- */

const pad5 = (v: string | number) => String(v).padStart(5, ' ');
const SPACE24 = ' '.repeat(24) + ' ';

/**
 * Reproduces the trace x86.py prints after its "ARG ..." lines (with -c).
 * Used by the golden tests and by the "x86.py output" view. `flavor` picks
 * the threads-intro/ or threads-locks/ copy of the script (they differ only in
 * blank lines here, and intro has no -P, -H or %ex/%fx).
 */
export function formatTrace(asm: Assembled, run: RawRun, cfg: X86Config, opts: { headercount?: number; flavor?: 'intro' | 'locks' } = {}): string {
  const { memtrace, regtrace } = run.prep;
  const n = run.initialThreads.length;
  const cctrace = cfg.cctrace;
  const anyTrace = memtrace.length > 0 || regtrace.length > 0 || cctrace;
  const header = () => {
    let s = '';
    if (memtrace.length > 0) {
      for (const m of memtrace) s += (/^[0-9]/.test(m.label) ? pad5(Number.parseInt(m.label, 10)) : pad5(m.label)) + ' ';
      s += '  ';
    }
    if (regtrace.length > 0) {
      for (const r of regtrace) s += pad5(REG_NAMES[r]) + ' ';
      s += '  ';
    }
    if (cctrace) s += '>= >  <= <  != == ';
    for (let i = 0; i < n; i++) s += `       Thread ${i}        ` + ' ';
    return s + '\n';
  };
  // replay memory for the traced addresses
  const memVals = new Map<number, number>();
  const trace = (t: ThreadState, newline: boolean) => {
    let s = '';
    if (memtrace.length > 0) {
      for (const m of memtrace) s += pad5(memVals.get(m.addr) ?? 0) + ' ';
      s += '  ';
    }
    if (regtrace.length > 0) {
      for (const r of regtrace) s += pad5(t.regs[r]) + ' ';
      s += '  ';
    }
    if (cctrace) for (const c of t.cc) s += (c ? '1 ' : '0 ') + ' ';
    if (anyTrace && newline) s += '\n';
    return s;
  };

  // threads-intro/x86.py prints no blank lines around the first header
  let out = opts.flavor === 'intro' ? header() : '\n' + header() + '\n';
  out += trace(run.initialThreads[run.initialRunning], true);
  let cur = run.initialThreads[run.initialRunning];
  const H = opts.headercount ?? -1;
  run.steps.forEach((st, k) => {
    if (H > 0 && k % H === 0 && k > 0) out += '\n' + header() + '\n' + trace(cur, true);
    for (const w of st.res.writes) memVals.set(w.addr, w.value);
    if (st.res.dump) out += st.res.dump;
    out += trace(st.threads[st.tid], false);
    out += SPACE24.repeat(st.tid) + `${st.pc} ${asm.program[st.idx].text}\n`;
    for (const ev of st.events) {
      if (ev.silent) continue;
      out += trace(st.threads[ev.to], false);
      const tag = ev.kind === 'halt' ? '----- Halt;Switch ----- ' : '------ Interrupt ------ ';
      out += (tag + ' ').repeat(n) + '\n';
    }
    if (st.running !== null) cur = st.threads[st.running];
  });
  return out;
}
