import { describe, expect, it } from 'vitest';
import { NAMESPACES, lookup, simulateContainers, type CtConfig } from './containers';

const cfg = (p: Partial<CtConfig>): CtConfig => ({ scenario: 'syscall', memLimit: 256, want: 192, cpuLimit: 50, ...p });
const end = (r: ReturnType<typeof simulateContainers>) => r.steps[r.steps.length - 1];

describe('containers', () => {
  it('syscall goes straight to the host kernel: one trap, like a bare process', () => {
    expect(end(simulateContainers(cfg({}))).state.traps).toBe(1);
  });

  it('namespaces are added one by one', () => {
    const r = simulateContainers(cfg({ scenario: 'namespaces' }));
    expect(end(r).state.ns).toEqual([...NAMESPACES]);
  });

  it('cgroups: fits under the limit', () => {
    const e = end(simulateContainers(cfg({ scenario: 'cgroups' })));
    expect(e.msg).toBe('cg.fits');
    expect(e.state.mem).toBe(192);
    expect(e.state.killed).toBe(false);
  });

  it('cgroups: exceeding memory.max ends in an OOM kill', () => {
    const r = simulateContainers(cfg({ scenario: 'cgroups', memLimit: 128, want: 384 }));
    expect(end(r).msg).toBe('cg.oom');
    expect(end(r).state.killed).toBe(true);
    expect(Math.max(...r.steps.map((s) => s.state.mem))).toBeLessThanOrEqual(128);
  });

  it('overlay: copy-up on write, whiteout hides lower files', () => {
    const r = simulateContainers(cfg({ scenario: 'overlay' }));
    const msgs = r.steps.map((s) => s.msg);
    expect(msgs).toEqual(['ov.read.base', 'ov.read.app', 'ov.copyUp', 'ov.read.upper', 'ov.create', 'ov.whiteout', 'ov.readMissing']);
    const s = end(r).state;
    expect(s.upper).toEqual(['/etc/app.conf', '/tmp/cache']);
    expect(lookup('/bin/sh', s)).toBe('missing');
    expect(lookup('/lib/libc.so', s)).toBe('base');
  });
});
