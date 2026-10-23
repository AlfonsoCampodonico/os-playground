import { describe, expect, it } from 'vitest';
import {
  KSTACK_TOP,
  PRESETS,
  TRAP_BASE,
  USER_BASE,
  encodeProgram,
  parseProgram,
  randomProblem,
  simulateSyscalls,
  type PresetId,
  type Setup,
  type Step,
} from './syscalls';

const run = (s: Setup) => simulateSyscalls({ program: parseProgram(s.prog), boot: s.boot, timer: s.timer, disk: s.disk });
const rows = (steps: Step[]) => steps.map((s) => `${s.lane}:${s.kind}${s.pid ? `(${s.pid})` : ''}`);

describe('Figure 6.2 — LDE protocol without interrupts', () => {
  it('boot + write + exit follows the book row by row', () => {
    const r = run(PRESETS.boot);
    expect(rows(r.steps)).toEqual([
      // OS @ boot / Hardware
      'os:boot-trap-table',
      'hw:hw-remember',
      // OS @ run: create the process, return-from-trap into it
      'os:os-create(A)',
      'os:os-rft(A)',
      'hw:hw-rft(A)',
      // Program runs main(), calls a syscall
      'user:user-compute(A)',
      'user:user-syscall(A)',
      'hw:hw-trap(A)',
      'os:os-syscall(A)',
      'os:os-rft(A)',
      'hw:hw-rft(A)',
      // return from main → exit()
      'user:user-syscall(A)',
      'hw:hw-trap(A)',
      'os:os-exit(A)',
      'os:os-idle',
    ]);
    expect(r.figure).toBe('6.2');
    expect(r.hasB).toBe(false);
    expect(r.steps.filter((s) => s.phase === 'boot')).toHaveLength(2);
    expect(r.steps[1].cpu.idtr).toBe(TRAP_BASE);
    expect(r.initial.trapTable).toBe(false);
  });

  it('a syscall: number in %eax, trap frame pushed, return value popped back', () => {
    const r = run(PRESETS.write);
    const call = r.steps.findIndex((s) => s.kind === 'user-syscall');
    const [u, hw, os, rft, back] = r.steps.slice(call, call + 5);
    expect(u.cpu).toMatchObject({ mode: 'user', eaxNote: 'sysno' });
    expect(u.cpu.regs.eax).toBe(16);
    // hardware: user regs → kernel stack, kernel mode, jump through the trap table
    expect(hw.cpu.mode).toBe('kernel');
    expect(hw.vector).toBe(64);
    expect(hw.procs.A.frame).toMatchObject({ eax: 16, eip: u.cpu.regs.eip + 4 });
    expect(hw.cpu.regs.esp).toBeLessThan(KSTACK_TOP.A);
    expect(hw.cpu.stack).toBe('kernel');
    // kernel writes, leaves 5 in the trap frame
    expect(os.kind).toBe('os-syscall');
    expect(os.console).toBe('hola\n');
    expect(os.procs.A.frame!.eax).toBe(5);
    expect(rft.kind).toBe('os-rft');
    // hardware restores: user mode, PC after the trap, eax = 5
    expect(back.cpu.mode).toBe('user');
    expect(back.cpu.regs.eip).toBe(u.cpu.regs.eip + 4);
    expect(back.cpu.regs.eax).toBe(5);
    expect(back.cpu.eaxNote).toBe('ret');
    expect(back.procs.A.frame).toBeNull();
  });

  it('getpid twice: 2 syscalls + exit, 5 mode switches', () => {
    const r = run(PRESETS.getpid);
    const last = r.steps.at(-1)!;
    expect(last.counts.syscalls).toBe(3);
    expect(last.counts.modeSwitches).toBe(5); // 3 into the kernel, 2 back (exit never returns)
    expect(r.steps.filter((s) => s.kind === 'os-syscall').map((s) => s.ret)).toEqual([3, 3]);
    expect(last.counts.ctxSwitches).toBe(0);
  });

  it('adds the implicit exit() when main returns', () => {
    const r = run({ prog: 'c3 w', boot: false, timer: 0, disk: 3 });
    expect(r.program.at(-1)).toMatchObject({ kind: 'exit', implicit: true });
    expect(r.steps.at(-1)!.kind).toBe('os-idle');
  });
});

describe('Figure 6.3 — timer interrupt and context switch', () => {
  it('two register saves: hardware → k-stack(A), switch() → proc_t(A)', () => {
    const r = run(PRESETS.timer);
    expect(r.figure).toBe('6.3');
    expect(rows(r.steps).slice(0, 4)).toEqual(['os:boot-trap-table', 'hw:hw-remember', 'os:boot-timer', 'hw:hw-timer-start']);
    const irq = r.steps.findIndex((s) => s.kind === 'hw-irq' && s.irq === 'timer');
    const [hw, timer, sw, rft, back] = r.steps.slice(irq, irq + 5);
    expect(r.steps[irq - 1]).toMatchObject({ kind: 'user-compute', pid: 'A', n: 3 });
    expect(hw.vector).toBe(32);
    expect(hw.procs.A.frame).not.toBeNull();
    expect(hw.procs.A.ctx).toBeNull();
    expect(timer).toMatchObject({ kind: 'os-timer', to: 'B' });
    expect(sw).toMatchObject({ kind: 'os-switch', from: 'A', to: 'B', saved: true });
    expect(sw.procs.A.ctx).not.toBeNull();
    expect(sw.procs.A.frame).not.toBeNull();
    expect(sw.procs.B.ctx).toBeNull();
    expect(sw.cpu.pid).toBe('B');
    expect(rft.kind).toBe('os-rft');
    expect(back).toMatchObject({ kind: 'hw-rft', pid: 'B' });
    expect(back.cpu.mode).toBe('user');
    expect(back.procs.B.frame).toBeNull();
    expect(back.procs.A.state).toBe('ready');
  });

  it('round robin: B runs a full quantum, then A gets the CPU back', () => {
    const r = run(PRESETS.timer);
    const users = r.steps.filter((s) => s.kind === 'user-compute').map((s) => `${s.pid}${s.n}`);
    expect(users).toEqual(['A3', 'B3', 'A2']);
    const last = r.steps.at(-1)!;
    expect(last.counts.ctxSwitches).toBe(3); // A→B, B→A, A(exit)→B
    expect(last.cpu.pid).toBe('B');
    expect(last.procs.A.state).toBe('done');
  });

  it('without another ready process the timer handler returns to the same one', () => {
    // read blocks A; B gets preempted by the timer but A is still blocked
    const r = run({ prog: 'r x', boot: false, timer: 2, disk: 5 });
    const stay = r.steps.find((s) => s.kind === 'os-timer' && s.pid === 'B');
    expect(stay?.to).toBeUndefined();
  });
});

describe('extensions: privileged instruction, blocking read', () => {
  it('cli in user mode faults through vector 13 and kills A; the rest never runs', () => {
    const r = run(PRESETS.priv);
    const fault = r.steps.find((s) => s.kind === 'hw-fault')!;
    expect(fault.vector).toBe(13);
    // a fault saves the PC of the faulting instruction itself
    const before = r.steps[r.steps.indexOf(fault) - 1];
    expect(before.kind).toBe('user-priv');
    expect(fault.procs.A.frame!.eip).toBe(before.cpu.regs.eip);
    expect(r.steps.find((s) => s.kind === 'os-kill')!.procs.A.state).toBe('killed');
    expect(r.executed).toEqual([true, true, false, false]);
    expect(r.steps.at(-1)!.counts.faults).toBe(1);
  });

  it('read() blocks A, B runs until the disk interrupt, then A gets 512 bytes', () => {
    const r = run(PRESETS.read);
    expect(r.hasB).toBe(true);
    const k = rows(r.steps);
    const i = k.indexOf('os:os-read-block(A)');
    expect(k.slice(i, i + 8)).toEqual([
      'os:os-read-block(A)',
      'os:os-switch(B)',
      'os:os-rft(B)',
      'hw:hw-rft(B)',
      'user:user-compute(B)',
      'hw:hw-irq(B)',
      'os:os-disk(A)',
      'os:os-switch(A)',
    ]);
    expect(r.steps[i].procs.A.state).toBe('blocked');
    expect(r.steps[i + 4].n).toBe(3);
    expect(r.steps[i + 5].vector).toBe(46);
    const back = r.steps[i + 9];
    expect(back).toMatchObject({ kind: 'hw-rft', pid: 'A' });
    expect(back.cpu.regs.eax).toBe(512);
    // disk rows belong to the read op, for cross-highlighting
    expect(r.steps[i + 6].op).toBe(1);
  });
});

describe('invariants over many random programs', () => {
  const setups: Setup[] = [...(Object.keys(PRESETS) as PresetId[]).map((id) => PRESETS[id]), ...Array.from({ length: 150 }, (_, s) => randomProblem(s))];

  it.each(setups.map((s, i) => [i, s] as const))('setup %i is consistent', (_, s) => {
    const r = run(s);
    expect(r.truncated).toBe(false);
    let prevMode = r.initial.cpu.mode;
    let flips = 0;
    for (const st of r.steps) {
      if (st.lane === 'user') expect(st.cpu.mode).toBe('user');
      if (st.lane === 'os') expect(st.cpu.mode).toBe('kernel');
      if (st.cpu.mode !== prevMode) {
        flips++;
        expect(st.lane).toBe('hw');
        expect(st.fx.modeFlip).toBe(true);
      }
      prevMode = st.cpu.mode;
      // a process off the CPU (or in the kernel) keeps its user registers in a trap frame
      for (const p of ['A', 'B'] as const) {
        const proc = st.procs[p];
        if (proc.state === 'ready' || proc.state === 'blocked') expect(proc.frame).not.toBeNull();
        if (st.cpu.mode === 'user' && st.cpu.pid === p) expect(proc.frame).toBeNull();
      }
      if (st.cpu.mode === 'user') expect(st.cpu.regs.eip).toBeLessThan(0x80000000);
      else expect(st.cpu.regs.eip).toBeGreaterThanOrEqual(0x80000000);
      expect(st.counts.modeSwitches).toBe(st.counts.toKernel + st.counts.toUser);
    }
    expect(r.steps.at(-1)!.counts.modeSwitches).toBe(flips);
    expect(r.steps.at(-1)!.counts.syscalls).toBe(r.steps.filter((x) => x.kind === 'user-syscall').length);
    // A always finishes: exit or killed
    expect(['done', 'killed']).toContain(r.steps.at(-1)!.procs.A.state);
  });
});

describe('program text', () => {
  it('round-trips and drops junk', () => {
    expect(encodeProgram(parseProgram('c3 w  g,r;x p zz c99'))).toBe('c3 w g r x p c20');
    expect(parseProgram('')).toEqual([]);
  });

  it('random problems are reproducible', () => {
    expect(randomProblem(42)).toEqual(randomProblem(42));
  });

  it('a fresh process starts at main with an empty user context', () => {
    const r = run(PRESETS.boot);
    const start = r.steps.find((s) => s.kind === 'hw-rft')!;
    expect(start.first).toBe(true);
    expect(start.cpu.regs.eip).toBe(USER_BASE);
  });
});
