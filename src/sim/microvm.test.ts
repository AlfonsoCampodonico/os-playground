import { describe, expect, it } from 'vitest';
import { EMU_REGS_PER_REQ, FULL_BOOT, MICRO_BOOT, hostFootprint, simulateMicrovm } from './microvm';

const end = (r: ReturnType<typeof simulateMicrovm>) => r.steps[r.steps.length - 1].state;

describe('microVM', () => {
  it('boot: the microVM skips firmware and finishes orders of magnitude sooner', () => {
    const s = end(simulateMicrovm({ scenario: 'boot', batch: 1 }));
    expect(s.fullStage).toBe(FULL_BOOT.length - 1);
    expect(s.microStage).toBe(MICRO_BOOT.length - 1);
    expect(MICRO_BOOT.some((b) => (b.id as string) === 'firmware')).toBe(false);
    expect(s.fullMs / s.microMs).toBeGreaterThan(10);
  });

  it('virtio: one kick and one interrupt per batch; emulation traps on every register', () => {
    for (const batch of [1, 4, 8]) {
      const s = end(simulateMicrovm({ scenario: 'virtio', batch }));
      expect(s.exits).toBe(2);
      expect(s.emuExits).toBe(EMU_REGS_PER_REQ * batch);
      expect(s.done).toBe(batch);
      expect(s.queued).toBe(0);
    }
  });

  it('jail: every layer is in place before the guest runs, and the escape is blocked', () => {
    const r = simulateMicrovm({ scenario: 'jail', batch: 1 });
    const guestAt = r.steps.findIndex((s) => s.state.jailed.guest);
    expect(Object.values(r.steps[guestAt].state.jailed).every(Boolean)).toBe(true);
    expect(end(r).blocked).toBe(true);
  });

  it('host footprint grows per VM, much less for microVMs', () => {
    const f = hostFootprint(10);
    expect(f.full.mib - f.micro.mib).toBe(10 * 125);
    expect(f.micro.devices).toBeLessThan(f.full.devices);
  });
});
