import { describe, expect, it } from 'vitest';
import { SCENARIOS, actorSequence, modeOf, randomSetup, simulateVirt, type Mode, type Scenario } from './virtualization';

const run = (scenario: Scenario, assist = false, paravirt = false, spins = 3) => simulateVirt({ scenario, assist, paravirt, spins });
const last = <T>(xs: T[]) => xs[xs.length - 1];

describe('appendix B protocol tables (trap-and-emulate)', () => {
  it('system call without virtualization: process → hardware → OS → hardware → process', () => {
    const r = run('syscall');
    expect(actorSequence(r.native.steps)).toEqual(['app', 'hw', 'os', 'hw', 'app']);
    expect(last(r.native.steps).counters).toMatchObject({ traps: 1, modeSwitches: 2, emulated: 0 });
  });

  it('system call with a VMM: process → VMM → OS → VMM → process, two traps', () => {
    const r = run('syscall');
    expect(actorSequence(r.virt.steps)).toEqual(['app', 'vmm', 'guest', 'vmm', 'app']);
    expect(last(r.virt.steps).counters).toMatchObject({ traps: 2, hypercalls: 0, modeSwitches: 4, emulated: 1 });
  });

  it('TLB miss without virtualization: process → hardware → OS → hardware → process', () => {
    const r = run('tlb');
    expect(actorSequence(r.native.steps)).toEqual(['app', 'hw', 'os', 'hw', 'app']);
    expect(last(r.native.steps).xlate?.tlb).toEqual({ frame: 0xa, kind: 'pfn' });
  });

  it('TLB miss with a VMM: process → VMM → OS → VMM → OS → VMM → process, installing VPN → MFN', () => {
    const r = run('tlb');
    expect(actorSequence(r.virt.steps)).toEqual(['app', 'vmm', 'guest', 'vmm', 'guest', 'vmm', 'app']);
    const end = last(r.virt.steps);
    expect(end.counters).toMatchObject({ traps: 3, modeSwitches: 6, emulated: 2 });
    expect(end.xlate).toMatchObject({ hop: 2, tlb: { frame: 0x19, kind: 'mfn' } });
  });
});

describe('privilege', () => {
  it('the guest OS believes it is in kernel mode but really runs in user mode under trap-and-emulate', () => {
    const g = run('syscall').virt.steps.find((s) => s.actor === 'guest')!;
    expect(g).toMatchObject({ believes: 'kernel', real: 'user' });
  });
  it('with VT-x the guest runs in non-root ring 0; the VMM in root mode', () => {
    const r = run('syscall', true);
    expect(r.virt.steps.find((s) => s.actor === 'guest')!.real).toBe('nonroot-kernel');
    expect(run('timer', true).virt.steps.find((s) => s.actor === 'vmm')!.real).toBe('root');
  });
  it('a paravirtualized guest knows it is a guest', () => {
    expect(run('syscall', false, true).virt.steps.find((s) => s.actor === 'guest')!.believes).toBe('aware');
  });
  it('the VMM tracks the guest virtual mode', () => {
    const steps = run('syscall').virt.steps;
    expect(steps.map((s) => s.vmm.vMode)).toEqual(['user', 'user', 'user', 'kernel', 'kernel', 'kernel', 'user']);
  });
});

describe('toggles change the trace', () => {
  const counts = (sc: Scenario, m: Mode) => {
    const r = simulateVirt({ scenario: sc, assist: m === 'hw' || m === 'pvh', paravirt: m === 'pv' || m === 'pvh', spins: 3 });
    const c = last(r.virt.steps).counters;
    return [c.traps, c.hypercalls, c.emulated];
  };
  it.each<[Scenario, Mode, number[]]>([
    ['syscall', 'te', [2, 0, 1]],
    ['syscall', 'hw', [0, 0, 0]],
    ['syscall', 'pv', [1, 1, 0]],
    ['boot', 'te', [1, 0, 1]],
    ['boot', 'pv', [0, 1, 0]],
    ['boot', 'hw', [0, 0, 0]],
    ['cli', 'te', [2, 0, 2]],
    ['cli', 'pv', [0, 0, 0]],
    ['cli', 'hw', [0, 0, 0]],
    ['timer', 'te', [1, 0, 0]],
    ['timer', 'hw', [1, 0, 0]],
    ['tlb', 'te', [3, 0, 2]],
    ['tlb', 'pv', [1, 2, 0]],
    ['tlb', 'hw', [0, 0, 0]],
    ['shadow', 'te', [1, 0, 0]],
    ['shadow', 'pv', [0, 0, 0]],
    ['idle', 'te', [1, 0, 0]],
    ['idle', 'pv', [0, 1, 0]],
    ['idle', 'pvh', [0, 1, 0]],
  ])('%s / %s → traps, hypercalls, emulated = %j', (sc, m, want) => {
    expect(counts(sc, m)).toEqual(want);
  });

  it('the idle loop burns one unit per spin until the timer fires, unless the guest says so (hypercall)', () => {
    expect(last(run('idle', false, false, 5).virt.steps).counters.wasted).toBe(5);
    expect(last(run('idle', true, false, 5).virt.steps).counters.wasted).toBe(5);
    expect(last(run('idle', false, true, 5).virt.steps).counters.wasted).toBe(0);
  });

  it('a machine switch saves VM 1 and runs VM 2', () => {
    const end = last(run('timer').virt.steps);
    expect(end.vm).toBe(2);
    expect(end.vmm.vms).toEqual([
      { id: 1, state: 'saved' },
      { id: 2, state: 'run' },
    ]);
  });

  it('shadow paging: hidden fault handled by the VMM alone, the guest OS never runs', () => {
    const r = run('shadow');
    expect(r.virt.steps.some((s) => s.actor === 'guest')).toBe(false);
    expect(last(r.virt.steps).xlate).toMatchObject({ shadow: 'filled', tlb: { frame: 0x19, kind: 'mfn' } });
  });

  it('boot: the VMM records the guest trap table instead of installing it', () => {
    const r = run('boot');
    expect(r.virt.initial.vmm.guestTable).toBe('none');
    expect(last(r.virt.steps).vmm).toMatchObject({ guestTable: 'vmm', hwTable: 'vmm' });
  });

  it('virtualization never costs less than the bare machine', () => {
    for (const sc of SCENARIOS)
      for (const a of [false, true])
        for (const p of [false, true]) {
          const r = run(sc, a, p);
          expect(last(r.virt.steps).counters.cost, `${sc} assist=${a} pv=${p}`).toBeGreaterThanOrEqual(last(r.native.steps).counters.cost);
        }
  });
});

describe('alignment between columns', () => {
  it('native index is monotonic and ends at the end', () => {
    for (const sc of SCENARIOS)
      for (const m of ['te', 'hw', 'pv', 'pvh'] as Mode[]) {
        const r = simulateVirt({ scenario: sc, assist: m === 'hw' || m === 'pvh', paravirt: m === 'pv' || m === 'pvh', spins: 3 });
        let prev = 0;
        for (let i = 0; i <= r.virt.steps.length; i++) {
          const j = r.nativeIndex(i);
          expect(j).toBeGreaterThanOrEqual(prev);
          expect(j).toBeLessThanOrEqual(r.native.steps.length);
          prev = j;
        }
        expect(r.nativeIndex(r.virt.steps.length)).toBe(r.native.steps.length);
        expect(r.nativeIndex(0)).toBe(0);
      }
  });
});

describe('helpers', () => {
  it('modeOf', () => {
    expect([modeOf(false, false), modeOf(true, false), modeOf(false, true), modeOf(true, true)]).toEqual(['te', 'hw', 'pv', 'pvh']);
  });
  it('randomSetup is reproducible', () => {
    expect(randomSetup(42)).toEqual(randomSetup(42));
  });
});
