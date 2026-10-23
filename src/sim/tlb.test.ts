import { describe, expect, it } from 'vitest';
import { PRESETS, parseTrace, simulateTlb } from './tlb';

describe('simulateTlb', () => {
  it('reproduces OSTEP Figure 19.2: array of 10 ints, 16-byte pages → 7 hits, 3 misses', () => {
    const run = simulateTlb({ ...PRESETS.array, trace: [...PRESETS.array.trace], policy: 'lru', seed: 0 });
    expect(run.steps.map((s) => (s.hit ? 'h' : 'm')).join('')).toBe('mhhmhhhmhh');
    expect(run.steps.at(-1)!.hits).toBe(7);
    expect(run.steps.map((s) => s.vpn)).toEqual([6, 6, 6, 7, 7, 7, 7, 8, 8, 8]);
  });

  it('splits addresses into VPN and offset', () => {
    const run = simulateTlb({ pageSize: 4096, entries: 2, policy: 'lru', seed: 0, trace: [0x1008] });
    expect(run.offsetBits).toBe(12);
    expect(run.steps[0]).toMatchObject({ vpn: 1, offset: 8 });
    expect(run.steps[0].pa).toBe(run.steps[0].pfn * 4096 + 8);
  });

  it('LRU keeps the recently used page; FIFO evicts the oldest load', () => {
    // pages: 1 2 1 3 2 with 2 entries
    const trace = [0x1000, 0x2000, 0x1000, 0x3000, 0x2000];
    const lru = simulateTlb({ pageSize: 4096, entries: 2, policy: 'lru', seed: 0, trace });
    const fifo = simulateTlb({ pageSize: 4096, entries: 2, policy: 'fifo', seed: 0, trace });
    // LRU: 3 evicts 2 (1 was used at step 3) → final 2 misses
    expect(lru.steps.map((s) => (s.hit ? 'h' : 'm')).join('')).toBe('mmhmm');
    expect(lru.steps[3].evicted).toBe(2);
    // FIFO: 3 evicts 1 (loaded first) → 2 is still there
    expect(fifo.steps.map((s) => (s.hit ? 'h' : 'm')).join('')).toBe('mmhmh');
    expect(fifo.steps[3].evicted).toBe(1);
  });

  it('a loop over one page more than the TLB holds misses every time under LRU', () => {
    const run = simulateTlb({ ...PRESETS.loop, trace: [...PRESETS.loop.trace], policy: 'lru', seed: 0 });
    expect(run.steps.every((s) => !s.hit)).toBe(true);
  });

  it('random policy is reproducible for a seed', () => {
    const cfg = { pageSize: 4096, entries: 2, policy: 'random' as const, seed: 7, trace: [0, 4096, 8192, 0, 4096, 12288, 0] };
    expect(simulateTlb(cfg).steps.map((s) => s.slot)).toEqual(simulateTlb(cfg).steps.map((s) => s.slot));
  });
});

describe('parseTrace', () => {
  it('accepts hex, binary and decimal separated by spaces or commas', () => {
    expect(parseTrace('0x10, 16 0b10000;x12')).toEqual({ trace: [16, 16, 16], bad: ['x12'] });
  });
});
