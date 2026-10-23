import { describe, expect, it } from 'vitest';
import { PRESETS, beladyPoints, compareAll, configFromFlags, faultCurve, ostepCommand, parseAddresses, parseFlags, simulate, type PrConfig } from './page-replacement';

const compact = (cfg: PrConfig) =>
  simulate(cfg)
    .steps.map((s) => `${s.hit ? 'h' : 'm'}${s.page}:${s.memory.join('.')}:${s.victim ?? '-'}`)
    .join(' ');

describe('paging-policy.py parity (golden output of `python3 paging-policy.py <flags> -c`)', () => {
  it.each(GOLDEN)('%s', (flags, accesses, final) => {
    const { cfg, errors } = configFromFlags(flags);
    expect(errors).toEqual([]);
    expect(compact(cfg)).toBe(accesses);
    expect(simulate(cfg).finalLine).toBe(final);
  });

  it.each(GOLDEN_LINES)('prints the exact lines for %s', (flags, lines) => {
    const run = simulate(configFromFlags(flags).cfg);
    expect([...run.steps.map((s) => s.line), run.finalLine]).toEqual(lines);
  });
});

describe('page replacement', () => {
  const base = (over: Partial<PrConfig>): PrConfig => ({ ...configFromFlags('').cfg, ...over });

  it('OSTEP ch. 22 example (cache 3): OPT 6 hits, FIFO 4, LRU 6', () => {
    const addresses = parseAddresses(PRESETS.ch22.addresses).pages;
    expect(simulate(base({ addresses, policy: 'OPT' })).hits).toBe(6);
    expect(simulate(base({ addresses, policy: 'FIFO' })).hits).toBe(4);
    expect(simulate(base({ addresses, policy: 'LRU' })).hits).toBe(6);
  });

  it("Belady's anomaly: FIFO 9 faults with 3 frames, 10 with 4; LRU and OPT never increase", () => {
    const cfg = base({ addresses: parseAddresses(PRESETS.belady.addresses).pages });
    const fifo = faultCurve(cfg, 'FIFO', 6);
    expect(fifo[2]).toBe(9);
    expect(fifo[3]).toBe(10);
    expect(beladyPoints(fifo)).toEqual([3]);
    expect(beladyPoints(faultCurve(cfg, 'LRU', 6))).toEqual([]);
    expect(beladyPoints(faultCurve(cfg, 'OPT', 6))).toEqual([]);
  });

  it('a loop one page larger than the cache misses every time under LRU', () => {
    const run = simulate(base({ addresses: parseAddresses(PRESETS.loop.addresses).pages, policy: 'LRU' }));
    expect(run.hits).toBe(0);
  });

  it('keeps pages in fixed frames: the new page takes the victim frame', () => {
    const run = simulate(base({ addresses: [1, 2, 3, 4], policy: 'FIFO' }));
    expect(run.steps[3].slots).toEqual([4, 2, 3]);
    expect(run.steps[3].slot).toBe(0);
  });

  it('OPT reports the next use of each resident page; the victim is the farthest', () => {
    const run = simulate(base({ addresses: parseAddresses(PRESETS.ch22.addresses).pages, policy: 'OPT' }));
    const s = run.steps[5]; // access to 3, memory [0,1,2]
    expect(s.future).toEqual([
      { page: 0, slot: 0, next: 6 },
      { page: 1, slot: 1, next: 8 },
      { page: 2, slot: 2, next: 9 },
    ]);
    expect(s.victim).toBe(2);
  });

  it('circular clock gives a second chance in frame order', () => {
    const run = simulate(base({ addresses: [1, 2, 3, 1, 4], policy: 'CLOCK', clockHand: 'circular', clockBits: 1 }));
    const s = run.steps[4];
    expect(s.scan!.map((l) => [l.page, l.ref, l.victim])).toEqual([
      [1, 1, false],
      [2, 1, false],
      [3, 1, false],
      [1, 0, true],
    ]);
    expect(s.slots).toEqual([4, 2, 3]);
    expect(s.hand).toBe(1);
  });

  it('compares every policy on the same trace', () => {
    const rows = compareAll(base({ addresses: parseAddresses(PRESETS.ch22.addresses).pages }));
    expect(rows.find((r) => r.policy === 'OPT')!.hits).toBe(6);
    expect(rows.every((r) => r.hits + r.misses === 11)).toBe(true);
  });
});

describe('flags', () => {
  it('parses short, attached and long forms', () => {
    expect(parseFlags('./paging-policy.py -pLRU --cachesize=4 -a 1,2,3 -b 1 -s 5 -c')).toEqual({
      policy: 'LRU',
      cacheSize: 4,
      addresses: '1,2,3',
      clockBits: 1,
      seed: 5,
      errors: [],
    });
    expect(parseFlags('-p NOPE -f x').errors).toEqual(['-p NOPE', '-f x']);
  });

  it('round-trips the OSTEP command', () => {
    for (const flags of ['-p CLOCK -b 3 -s 2 -n 20 -m 8 -C 4', '-p RAND -s 3 -a 0,1,2,3', '-a 1,2,3,4,1,2,5,1,2,3,4,5 -C 4']) {
      const { cfg } = configFromFlags(flags);
      expect(configFromFlags(ostepCommand(cfg)).cfg).toEqual(cfg);
    }
  });
});

export const GOLDEN: [string, string, string][] = [
[
"-p FIFO -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:7.4.2:8 m5:4.2.5:7 h4:4.2.5:- m7:2.5.7:4 m3:5.7.3:2 m4:7.3.4:5 m5:3.4.5:7",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p FIFO -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:8.7.2:1 m4:7.2.4:8 h4:7.2.4:- m6:2.4.6:7 m7:4.6.7:2 m0:6.7.0:4 h0:6.7.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p FIFO -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:0.8.7:9 m6:8.7.6:0 m3:7.6.3:8 h6:7.6.3:- h6:7.6.3:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p FIFO -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:5.3.6:2 h6:5.3.6:- m0:3.6.0:5 h0:3.6.0:- m8:6.0.8:3 m2:0.8.2:6 h2:0.8.2:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p FIFO -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.1.3:- m0:1.3.0:2 m4:3.0.4:1 m9:0.4.9:3 m8:4.9.8:0 m7:9.8.7:4 m2:8.7.2:9",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p LRU -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:7.4.2:8 m5:4.2.5:7 h4:2.5.4:- m7:5.4.7:2 m3:4.7.3:5 h4:7.3.4:- m5:3.4.5:7",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p LRU -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:8.7.2:1 m4:7.2.4:8 h4:7.2.4:- m6:2.4.6:7 m7:4.6.7:2 m0:6.7.0:4 h0:6.7.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p LRU -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:0.8.7:9 m6:8.7.6:0 m3:7.6.3:8 h6:7.3.6:- h6:7.3.6:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p LRU -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:5.3.6:2 h6:5.3.6:- m0:3.6.0:5 h0:3.6.0:- m8:6.0.8:3 m2:0.8.2:6 h2:0.8.2:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p LRU -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.3.1:- m0:3.1.0:2 m4:1.0.4:3 m9:0.4.9:1 m8:4.9.8:0 m7:9.8.7:4 m2:8.7.2:9",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p MRU -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:8.7.2:4 m5:8.7.5:2 m4:8.7.4:5 h7:8.4.7:- m3:8.4.3:7 h4:8.3.4:- m5:8.3.5:4",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p MRU -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:1.8.2:7 m4:1.8.4:2 h4:1.8.4:- m6:1.8.6:4 m7:1.8.7:6 m0:1.8.0:7 h0:1.8.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p MRU -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:9.0.7:8 m6:9.0.6:7 m3:9.0.3:6 m6:9.0.6:3 h6:9.0.6:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p MRU -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:2.5.6:3 h6:2.5.6:- m0:2.5.0:6 h0:2.5.0:- m8:2.5.8:0 h2:5.8.2:- h2:5.8.2:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p MRU -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.3.1:- m0:2.3.0:1 m4:2.3.4:0 m9:2.3.9:4 m8:2.3.8:9 m7:2.3.7:8 h2:3.7.2:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p OPT -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:7.4.2:8 m5:7.4.5:2 h4:7.4.5:- h7:7.4.5:- m3:4.5.3:7 h4:4.5.3:- h5:4.5.3:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p OPT -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:1.7.2:8 m4:1.7.4:2 h4:1.7.4:- m6:1.7.6:4 h7:1.7.6:- m0:1.7.0:6 h0:1.7.0:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p OPT -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:9.0.7:8 m6:9.0.6:7 m3:9.6.3:0 h6:9.6.3:- h6:9.6.3:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p OPT -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:2.5.6:3 h6:2.5.6:- m0:2.5.0:6 h0:2.5.0:- m8:2.5.8:0 h2:2.5.8:- h2:2.5.8:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p OPT -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.1.3:- m0:2.1.0:3 m4:2.1.4:0 m9:2.1.9:4 m8:2.1.8:9 m7:2.1.7:8 h2:2.1.7:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p UNOPT -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:8.7.2:4 m5:8.2.5:7 m4:8.2.4:5 m7:8.2.7:4 m3:2.7.3:8 m4:7.3.4:2 m5:3.4.5:7",
"FINALSTATS hits 0   misses 10   hitrate 0.00"
],
[
"-p UNOPT -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:1.8.2:7 m4:8.2.4:1 h4:8.2.4:- m6:2.4.6:8 m7:4.6.7:2 m0:6.7.0:4 h0:6.7.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p UNOPT -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:0.8.7:9 m6:8.7.6:0 m3:8.7.3:6 m6:7.3.6:8 h6:7.3.6:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p UNOPT -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:5.3.6:2 h6:5.3.6:- m0:3.6.0:5 h0:3.6.0:- m8:6.0.8:3 m2:0.8.2:6 h2:0.8.2:-",
"FINALSTATS hits 3   misses 7   hitrate 30.00"
],
[
"-p UNOPT -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.1.3:- m0:1.3.0:2 m4:3.0.4:1 m9:0.4.9:3 m8:4.9.8:0 m7:9.8.7:4 m2:8.7.2:9",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p RAND -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:8.7.2:4 m5:8.2.5:7 m4:2.5.4:8 m7:2.5.7:4 m3:2.7.3:5 m4:7.3.4:2 m5:7.3.5:4",
"FINALSTATS hits 0   misses 10   hitrate 0.00"
],
[
"-p RAND -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:1.8.2:7 m4:1.2.4:8 h4:1.2.4:- m6:1.2.6:4 m7:2.6.7:1 m0:2.7.0:6 h0:2.7.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p RAND -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:9.8.7:0 m6:8.7.6:9 m3:8.6.3:7 h6:8.6.3:- h6:8.6.3:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p RAND -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:2.5.6:3 h6:2.5.6:- m0:2.6.0:5 h0:2.6.0:- m8:2.6.8:0 h2:2.6.8:- h2:2.6.8:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p RAND -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.1.3:- m0:2.3.0:1 m4:3.0.4:2 m9:0.4.9:3 m8:4.9.8:0 m7:9.8.7:4 m2:9.8.2:7",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p CLOCK -s 0",
"m8:8:- m7:8.7:- m4:8.7.4:- m2:8.7.2:4 m5:8.2.5:7 m4:2.5.4:8 m7:2.5.7:4 m3:2.5.3:7 m4:2.5.4:3 h5:2.5.4:-",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p CLOCK -s 1",
"m1:1:- m8:1.8:- m7:1.8.7:- m2:1.8.2:7 m4:1.2.4:8 h4:1.2.4:- m6:2.4.6:1 m7:2.4.7:6 m0:4.7.0:2 h0:4.7.0:-",
"FINALSTATS hits 2   misses 8   hitrate 20.00"
],
[
"-p CLOCK -s 2",
"m9:9:- h9:9:- m0:9.0:- h0:9.0:- m8:9.0.8:- m7:9.8.7:0 m6:9.8.6:7 m3:9.6.3:8 h6:9.6.3:- h6:9.6.3:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p CLOCK -s 3",
"m2:2:- m5:2.5:- m3:2.5.3:- m6:2.5.6:3 h6:2.5.6:- m0:2.6.0:5 h0:2.6.0:- m8:2.0.8:6 h2:2.0.8:- h2:2.0.8:-",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
],
[
"-p CLOCK -s 4",
"m2:2:- m1:2.1:- m3:2.1.3:- h1:2.1.3:- m0:1.3.0:2 m4:3.0.4:1 m9:3.0.9:4 m8:3.0.8:9 m7:0.8.7:3 m2:0.8.2:7",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
],
[
"-p FIFO -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:0.1.2:- h1:0.1.2:- m3:1.2.3:0 m0:2.3.0:1 h3:2.3.0:- m1:3.0.1:2 m2:0.1.2:3 h1:0.1.2:-",
"FINALSTATS hits 4   misses 7   hitrate 36.36"
],
[
"-p FIFO -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.0.3:- h3:1.0.3:- m2:1.0.3.2:- h0:1.0.3.2:- h3:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- h0:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- m4:0.3.2.4:1 h0:0.3.2.4:- m1:3.2.4.1:0 h3:3.2.4.1:- m5:2.4.1.5:3 m3:4.1.5.3:2 m2:1.5.3.2:4 h5:1.5.3.2:- m0:5.3.2.0:1 h5:5.3.2.0:- m1:3.2.0.1:5 h0:3.2.0.1:-",
"FINALSTATS hits 14   misses 11   hitrate 56.00"
],
[
"-p LRU -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:1.2.0:- h1:2.0.1:- m3:0.1.3:2 h0:1.3.0:- h3:1.0.3:- h1:0.3.1:- m2:3.1.2:0 h1:3.2.1:-",
"FINALSTATS hits 6   misses 5   hitrate 54.55"
],
[
"-p LRU -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.3.0:- h3:1.0.3:- m2:1.0.3.2:- h0:1.3.2.0:- h3:1.2.0.3:- h0:1.2.3.0:- h2:1.3.0.2:- h0:1.3.2.0:- h0:1.3.2.0:- h2:1.3.0.2:- m4:3.0.2.4:1 h0:3.2.4.0:- m1:2.4.0.1:3 m3:4.0.1.3:2 m5:0.1.3.5:4 h3:0.1.5.3:- m2:1.5.3.2:0 h5:1.3.2.5:- m0:3.2.5.0:1 h5:3.2.0.5:- m1:2.0.5.1:3 h0:2.5.1.0:-",
"FINALSTATS hits 14   misses 11   hitrate 56.00"
],
[
"-p MRU -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:1.2.0:- h1:2.0.1:- m3:2.0.3:1 h0:2.3.0:- h3:2.0.3:- m1:2.0.1:3 h2:0.1.2:- h1:0.2.1:-",
"FINALSTATS hits 6   misses 5   hitrate 54.55"
],
[
"-p MRU -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.3.0:- h3:1.0.3:- m2:1.0.3.2:- h0:1.3.2.0:- h3:1.2.0.3:- h0:1.2.3.0:- h2:1.3.0.2:- h0:1.3.2.0:- h0:1.3.2.0:- h2:1.3.0.2:- m4:1.3.0.4:2 h0:1.3.4.0:- h1:3.4.0.1:- h3:4.0.1.3:- m5:4.0.1.5:3 m3:4.0.1.3:5 m2:4.0.1.2:3 m5:4.0.1.5:2 h0:4.1.5.0:- h5:4.1.0.5:- h1:4.0.5.1:- h0:4.5.1.0:-",
"FINALSTATS hits 16   misses 9   hitrate 64.00"
],
[
"-p OPT -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:0.1.2:- h1:0.1.2:- m3:0.1.3:2 h0:0.1.3:- h3:0.1.3:- h1:0.1.3:- m2:0.1.2:3 h1:0.1.2:-",
"FINALSTATS hits 6   misses 5   hitrate 54.55"
],
[
"-p OPT -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.0.3:- h3:1.0.3:- m2:1.0.3.2:- h0:1.0.3.2:- h3:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- h0:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- m4:1.0.3.4:2 h0:1.0.3.4:- h1:1.0.3.4:- h3:1.0.3.4:- m5:1.0.3.5:4 h3:1.0.3.5:- m2:1.0.5.2:3 h5:1.0.5.2:- h0:1.0.5.2:- h5:1.0.5.2:- h1:1.0.5.2:- h0:1.0.5.2:-",
"FINALSTATS hits 18   misses 7   hitrate 72.00"
],
[
"-p UNOPT -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:0.1.2:- h1:0.1.2:- m3:1.2.3:0 m0:1.2.0:3 m3:2.0.3:1 m1:0.3.1:2 m2:0.3.2:1 m1:3.2.1:0",
"FINALSTATS hits 2   misses 9   hitrate 18.18"
],
[
"-p UNOPT -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.0.3:- h3:1.0.3:- m2:1.0.3.2:- h0:1.0.3.2:- h3:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- h0:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- m4:1.3.2.4:0 m0:3.2.4.0:1 m1:2.4.0.1:3 m3:4.0.1.3:2 m5:4.0.1.5:3 m3:4.0.1.3:5 m2:4.1.3.2:0 m5:4.3.2.5:1 m0:4.3.2.0:5 m5:4.3.2.5:0 m1:3.2.5.1:4 m0:2.5.1.0:3",
"FINALSTATS hits 9   misses 16   hitrate 36.00"
],
[
"-p RAND -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:0.1.2:- h1:0.1.2:- m3:0.1.3:2 h0:0.1.3:- h3:0.1.3:- h1:0.1.3:- m2:0.1.2:3 h1:0.1.2:-",
"FINALSTATS hits 6   misses 5   hitrate 54.55"
],
[
"-p RAND -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.0.3:- h3:1.0.3:- m2:1.0.3.2:- h0:1.0.3.2:- h3:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- h0:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- m4:0.3.2.4:1 h0:0.3.2.4:- m1:0.2.4.1:3 m3:0.2.4.3:1 m5:2.4.3.5:0 h3:2.4.3.5:- h2:2.4.3.5:- h5:2.4.3.5:- m0:2.4.5.0:3 h5:2.4.5.0:- m1:2.4.0.1:5 h0:2.4.0.1:-",
"FINALSTATS hits 15   misses 10   hitrate 60.00"
],
[
"-p CLOCK -a 0,1,2,0,1,3,0,3,1,2,1",
"m0:0:- m1:0.1:- m2:0.1.2:- h0:0.1.2:- h1:0.1.2:- m3:0.1.3:2 h0:0.1.3:- h3:0.1.3:- h1:0.1.3:- m2:0.3.2:1 m1:0.3.1:2",
"FINALSTATS hits 5   misses 6   hitrate 45.45"
],
[
"-p CLOCK -s 7 -n 25 -m 6 -C 4",
"m1:1:- m0:1.0:- m3:1.0.3:- h0:1.0.3:- h3:1.0.3:- m2:1.0.3.2:- h0:1.0.3.2:- h3:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- h0:1.0.3.2:- h0:1.0.3.2:- h2:1.0.3.2:- m4:0.3.2.4:1 h0:0.3.2.4:- m1:0.3.4.1:2 h3:0.3.4.1:- m5:3.4.1.5:0 h3:3.4.1.5:- m2:3.1.5.2:4 h5:3.1.5.2:- m0:3.5.2.0:1 h5:3.5.2.0:- m1:3.5.0.1:2 h0:3.5.0.1:-",
"FINALSTATS hits 15   misses 10   hitrate 60.00"
],
[
"-p FIFO -C 3 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:2.3.4:1 m1:3.4.1:2 m2:4.1.2:3 m5:1.2.5:4 h1:1.2.5:- h2:1.2.5:- m3:2.5.3:1 m4:5.3.4:2 h5:5.3.4:-",
"FINALSTATS hits 3   misses 9   hitrate 25.00"
],
[
"-p LRU -C 3 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:2.3.4:1 m1:3.4.1:2 m2:4.1.2:3 m5:1.2.5:4 h1:2.5.1:- h2:5.1.2:- m3:1.2.3:5 m4:2.3.4:1 m5:3.4.5:2",
"FINALSTATS hits 2   misses 10   hitrate 16.67"
],
[
"-p OPT -C 3 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:1.2.4:3 h1:1.2.4:- h2:1.2.4:- m5:1.2.5:4 h1:1.2.5:- h2:1.2.5:- m3:1.5.3:2 m4:1.5.4:3 h5:1.5.4:-",
"FINALSTATS hits 5   misses 7   hitrate 41.67"
],
[
"-p FIFO -C 4 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:1.2.3.4:- h1:1.2.3.4:- h2:1.2.3.4:- m5:2.3.4.5:1 m1:3.4.5.1:2 m2:4.5.1.2:3 m3:5.1.2.3:4 m4:1.2.3.4:5 m5:2.3.4.5:1",
"FINALSTATS hits 2   misses 10   hitrate 16.67"
],
[
"-p LRU -C 4 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:1.2.3.4:- h1:2.3.4.1:- h2:3.4.1.2:- m5:4.1.2.5:3 h1:4.2.5.1:- h2:4.5.1.2:- m3:5.1.2.3:4 m4:1.2.3.4:5 m5:2.3.4.5:1",
"FINALSTATS hits 4   misses 8   hitrate 33.33"
],
[
"-p OPT -C 4 -a 1,2,3,4,1,2,5,1,2,3,4,5",
"m1:1:- m2:1.2:- m3:1.2.3:- m4:1.2.3.4:- h1:1.2.3.4:- h2:1.2.3.4:- m5:1.2.3.5:4 h1:1.2.3.5:- h2:1.2.3.5:- h3:1.2.3.5:- m4:1.2.5.4:3 h5:1.2.5.4:-",
"FINALSTATS hits 6   misses 6   hitrate 50.00"
],
[
"-p CLOCK -b 0 -s 0 -n 20 -m 8 -C 4",
"m6:6:- h6:6:- m3:6.3:- m2:6.3.2:- m4:6.3.2.4:- h3:6.3.2.4:- h6:6.3.2.4:- h2:6.3.2.4:- h3:6.3.2.4:- h4:6.3.2.4:- m7:6.2.4.7:3 h4:6.2.4.7:- h2:6.2.4.7:- h6:6.2.4.7:- h4:6.2.4.7:- h2:6.2.4.7:- h7:6.2.4.7:- h7:6.2.4.7:- h6:6.2.4.7:- h7:6.2.4.7:-",
"FINALSTATS hits 15   misses 5   hitrate 75.00"
],
[
"-p CLOCK -b 0 -s 1 -n 20 -m 8 -C 4",
"m1:1:- m6:1.6:- h6:1.6:- m2:1.6.2:- m3:1.6.2.3:- h3:1.6.2.3:- m5:1.6.2.5:3 h6:1.6.2.5:- m0:1.2.5.0:6 h0:1.2.5.0:- m6:2.5.0.6:1 m3:5.0.6.3:2 h6:5.0.6.3:- h0:5.0.6.3:- h3:5.0.6.3:- h5:5.0.6.3:- m1:0.6.3.1:5 m7:0.3.1.7:6 h7:0.3.1.7:- h0:0.3.1.7:-",
"FINALSTATS hits 10   misses 10   hitrate 50.00"
],
[
"-p CLOCK -b 0 -s 2 -n 20 -m 8 -C 4",
"m7:7:- h7:7:- m0:7.0:- h0:7.0:- m6:7.0.6:- m5:7.0.6.5:- h5:7.0.6.5:- m2:0.6.5.2:7 m4:6.5.2.4:0 h4:6.5.2.4:- h4:6.5.2.4:- m1:6.2.4.1:5 m3:6.4.1.3:2 h3:6.4.1.3:- m5:6.4.1.5:3 m7:6.4.5.7:1 h7:6.4.5.7:- h4:6.4.5.7:- m3:4.5.7.3:6 m2:5.7.3.2:4",
"FINALSTATS hits 8   misses 12   hitrate 40.00"
],
[
"-p CLOCK -b 0 -s 3 -n 20 -m 8 -C 4",
"m1:1:- m4:1.4:- m2:1.4.2:- h4:1.4.2:- m5:1.4.2.5:- m0:1.4.5.0:2 h0:1.4.5.0:- m6:1.5.0.6:4 m2:5.0.6.2:1 m1:5.6.2.1:0 m7:5.6.1.7:2 m3:5.6.1.3:7 h6:5.6.1.3:- h3:5.6.1.3:- h5:5.6.1.3:- h1:5.6.1.3:- h5:5.6.1.3:- h6:5.6.1.3:- m4:5.1.3.4:6 h5:5.1.3.4:-",
"FINALSTATS hits 9   misses 11   hitrate 45.00"
],
[
"-p CLOCK -b 1 -s 0 -n 20 -m 8 -C 4",
"m6:6:- h6:6:- m3:6.3:- m2:6.3.2:- m4:6.3.2.4:- h3:6.3.2.4:- h6:6.3.2.4:- h2:6.3.2.4:- h3:6.3.2.4:- h4:6.3.2.4:- m7:6.3.4.7:2 h4:6.3.4.7:- m2:6.4.7.2:3 h6:6.4.7.2:- h4:6.4.7.2:- h2:6.4.7.2:- h7:6.4.7.2:- h7:6.4.7.2:- h6:6.4.7.2:- h7:6.4.7.2:-",
"FINALSTATS hits 14   misses 6   hitrate 70.00"
],
[
"-p CLOCK -b 1 -s 1 -n 20 -m 8 -C 4",
"m1:1:- m6:1.6:- h6:1.6:- m2:1.6.2:- m3:1.6.2.3:- h3:1.6.2.3:- m5:6.2.3.5:1 h6:6.2.3.5:- m0:6.3.5.0:2 h0:6.3.5.0:- h6:6.3.5.0:- h3:6.3.5.0:- h6:6.3.5.0:- h0:6.3.5.0:- h3:6.3.5.0:- h5:6.3.5.0:- m1:3.5.0.1:6 m7:3.0.1.7:5 h7:3.0.1.7:- h0:3.0.1.7:-",
"FINALSTATS hits 12   misses 8   hitrate 60.00"
],
[
"-p CLOCK -b 1 -s 2 -n 20 -m 8 -C 4",
"m7:7:- h7:7:- m0:7.0:- h0:7.0:- m6:7.0.6:- m5:7.0.6.5:- h5:7.0.6.5:- m2:0.6.5.2:7 m4:0.5.2.4:6 h4:0.5.2.4:- h4:0.5.2.4:- m1:0.5.4.1:2 m3:5.4.1.3:0 h3:5.4.1.3:- h5:5.4.1.3:- m7:5.1.3.7:4 h7:5.1.3.7:- m4:5.1.7.4:3 m3:1.7.4.3:5 m2:1.7.4.2:3",
"FINALSTATS hits 8   misses 12   hitrate 40.00"
],
[
"-p CLOCK -b 1 -s 3 -n 20 -m 8 -C 4",
"m1:1:- m4:1.4:- m2:1.4.2:- h4:1.4.2:- m5:1.4.2.5:- m0:1.4.5.0:2 h0:1.4.5.0:- m6:4.5.0.6:1 m2:4.0.6.2:5 m1:4.0.2.1:6 m7:4.0.2.7:1 m3:4.2.7.3:0 m6:4.2.7.6:3 m3:2.7.6.3:4 m5:7.6.3.5:2 m1:6.3.5.1:7 h5:6.3.5.1:- h6:6.3.5.1:- m4:6.5.1.4:3 h5:6.5.1.4:-",
"FINALSTATS hits 5   misses 15   hitrate 25.00"
],
[
"-p CLOCK -b 3 -s 0 -n 20 -m 8 -C 4",
"m6:6:- h6:6:- m3:6.3:- m2:6.3.2:- m4:6.3.2.4:- h3:6.3.2.4:- h6:6.3.2.4:- h2:6.3.2.4:- h3:6.3.2.4:- h4:6.3.2.4:- m7:6.3.4.7:2 h4:6.3.4.7:- m2:6.3.4.2:7 h6:6.3.4.2:- h4:6.3.4.2:- h2:6.3.4.2:- m7:6.4.2.7:3 h7:6.4.2.7:- h6:6.4.2.7:- h7:6.4.2.7:-",
"FINALSTATS hits 13   misses 7   hitrate 65.00"
],
[
"-p CLOCK -b 3 -s 1 -n 20 -m 8 -C 4",
"m1:1:- m6:1.6:- h6:1.6:- m2:1.6.2:- m3:1.6.2.3:- h3:1.6.2.3:- m5:6.2.3.5:1 h6:6.2.3.5:- m0:6.3.5.0:2 h0:6.3.5.0:- h6:6.3.5.0:- h3:6.3.5.0:- h6:6.3.5.0:- h0:6.3.5.0:- h3:6.3.5.0:- h5:6.3.5.0:- m1:3.5.0.1:6 m7:5.0.1.7:3 h7:5.0.1.7:- h0:5.0.1.7:-",
"FINALSTATS hits 12   misses 8   hitrate 60.00"
],
[
"-p CLOCK -b 3 -s 2 -n 20 -m 8 -C 4",
"m7:7:- h7:7:- m0:7.0:- h0:7.0:- m6:7.0.6:- m5:7.0.6.5:- h5:7.0.6.5:- m2:7.6.5.2:0 m4:6.5.2.4:7 h4:6.5.2.4:- h4:6.5.2.4:- m1:6.2.4.1:5 m3:2.4.1.3:6 h3:2.4.1.3:- m5:2.4.3.5:1 m7:4.3.5.7:2 h7:4.3.5.7:- h4:4.3.5.7:- h3:4.3.5.7:- m2:4.3.5.2:7",
"FINALSTATS hits 9   misses 11   hitrate 45.00"
],
[
"-p CLOCK -b 3 -s 3 -n 20 -m 8 -C 4",
"m1:1:- m4:1.4:- m2:1.4.2:- h4:1.4.2:- m5:1.4.2.5:- m0:1.4.5.0:2 h0:1.4.5.0:- m6:4.5.0.6:1 m2:4.0.6.2:5 m1:4.0.2.1:6 m7:4.0.2.7:1 m3:4.0.2.3:7 m6:0.2.3.6:4 h3:0.2.3.6:- m5:2.3.6.5:0 m1:2.6.5.1:3 h5:2.6.5.1:- h6:2.6.5.1:- m4:2.5.1.4:6 h5:2.5.1.4:-",
"FINALSTATS hits 6   misses 14   hitrate 30.00"
],
[
"-p RAND -s 5 -n 30 -C 4",
"m6:6:- m7:6.7:- h7:6.7:- m9:6.7.9:- h7:6.7.9:- h9:6.7.9:- m0:6.7.9.0:- m4:6.7.9.4:0 h9:6.7.9.4:- h6:6.7.9.4:- h9:6.7.9.4:- m1:6.7.9.1:4 m4:6.9.1.4:7 m2:6.9.1.2:4 m5:6.9.2.5:1 h5:6.9.2.5:- m0:6.9.5.0:2 m2:9.5.0.2:6 h2:9.5.0.2:- h9:9.5.0.2:- m7:9.5.0.7:2 m1:9.5.7.1:0 h7:9.5.7.1:- h1:9.5.7.1:- m6:9.5.7.6:1 m1:9.5.7.1:6 m0:9.7.1.0:5 m8:9.1.0.8:7 m2:1.0.8.2:9 h2:1.0.8.2:-",
"FINALSTATS hits 12   misses 18   hitrate 40.00"
],
[
"-p RAND -s 6 -n 30 -C 4",
"m7:7:- m8:7.8:- m4:7.8.4:- m2:7.8.4.2:- m0:7.8.2.0:4 m6:7.2.0.6:8 m4:7.2.0.4:6 h7:7.2.0.4:- m3:7.2.4.3:0 h7:7.2.4.3:- h2:7.2.4.3:- m8:2.4.3.8:7 m7:2.4.8.7:3 h4:2.4.8.7:- m5:2.8.7.5:4 m6:2.8.7.6:5 m1:2.8.7.1:6 m5:2.8.1.5:7 h8:2.8.1.5:- h2:2.8.1.5:- h8:2.8.1.5:- m6:2.8.5.6:1 h8:2.8.5.6:- m3:2.8.6.3:5 m0:2.8.6.0:3 h8:2.8.6.0:- h8:2.8.6.0:- m4:2.8.6.4:0 m0:8.6.4.0:2 m1:8.4.0.1:6",
"FINALSTATS hits 10   misses 20   hitrate 33.33"
],
[
"-p RAND -s 7 -n 30 -C 4",
"m3:3:- m1:3.1:- m6:3.1.6:- m0:3.1.6.0:- m5:3.1.0.5:6 h3:3.1.0.5:- h0:3.1.0.5:- h5:3.1.0.5:- h0:3.1.0.5:- m4:3.0.5.4:1 h0:3.0.5.4:- h0:3.0.5.4:- h4:3.0.5.4:- m8:3.0.4.8:5 m1:0.4.8.1:3 m2:4.8.1.2:0 m6:8.1.2.6:4 m9:8.1.6.9:2 m5:8.6.9.5:1 m3:8.9.5.3:6 h9:8.9.5.3:- m0:8.9.3.0:5 h8:8.9.3.0:- m2:8.3.0.2:9 m1:8.0.2.1:3 h1:8.0.2.1:- m3:8.0.2.3:1 h8:8.0.2.3:- m1:8.0.3.1:2 m5:0.3.1.5:8",
"FINALSTATS hits 11   misses 19   hitrate 36.67"
],
[
"-p RAND -s 8 -n 30 -C 4",
"m2:2:- m9:2.9:- m1:2.9.1:- m7:2.9.1.7:- m0:2.1.7.0:9 h2:2.1.7.0:- m9:2.1.0.9:7 h2:2.1.0.9:- m6:2.1.0.6:9 m4:2.1.6.4:0 h4:2.1.6.4:- h4:2.1.6.4:- h1:2.1.6.4:- m8:1.6.4.8:2 m0:6.4.8.0:1 m2:6.4.8.2:0 m0:6.8.2.0:4 h2:6.8.2.0:- m4:8.2.0.4:6 m9:8.2.0.9:4 m3:8.2.9.3:0 m1:8.2.3.1:9 h2:8.2.3.1:- m9:8.2.3.9:1 m0:8.3.9.0:2 m6:8.9.0.6:3 m3:8.9.0.3:6 m6:9.0.3.6:8 h3:9.0.3.6:- h6:9.0.3.6:-",
"FINALSTATS hits 9   misses 21   hitrate 30.00"
],
[
"-p RAND -s 3 -a 0,1,2,3,0,1,4,0,1,2,3,4",
"m0:0:- m1:0.1:- m2:0.1.2:- m3:1.2.3:0 m0:1.3.0:2 h1:1.3.0:- m4:1.0.4:3 h0:1.0.4:- h1:1.0.4:- m2:1.4.2:0 m3:1.2.3:4 m4:2.3.4:1",
"FINALSTATS hits 3   misses 9   hitrate 25.00"
],
[
"-p RAND -s 11 -C 1 -n 12 -m 3",
"m1:1:- h1:1:- m2:2:1 m1:1:2 h1:1:- h1:1:- m0:0:1 m1:1:0 h1:1:- m2:2:1 m0:0:2 h0:0:-",
"FINALSTATS hits 5   misses 7   hitrate 41.67"
],
[
"-p CLOCK -s 3 -a 0,1,2,3,0,1,4,0,1,2,3,4",
"m0:0:- m1:0.1:- m2:0.1.2:- m3:0.2.3:1 h0:0.2.3:- m1:0.3.1:2 m4:3.1.4:0 m0:1.4.0:3 h1:1.4.0:- m2:1.0.2:4 m3:1.2.3:0 m4:1.3.4:2",
"FINALSTATS hits 2   misses 10   hitrate 16.67"
],
[
"-p CLOCK -s 11 -C 1 -n 12 -m 3",
"m1:1:- h1:1:- m2:2:1 m1:1:2 h1:1:- h1:1:- m0:0:1 m1:1:0 h1:1:- m2:2:1 m0:0:2 h0:0:-",
"FINALSTATS hits 5   misses 7   hitrate 41.67"
],
[
"-p LRU -C 3 -a 0,1,2,3,0,1,2,3,0,1,2,3",
"m0:0:- m1:0.1:- m2:0.1.2:- m3:1.2.3:0 m0:2.3.0:1 m1:3.0.1:2 m2:0.1.2:3 m3:1.2.3:0 m0:2.3.0:1 m1:3.0.1:2 m2:0.1.2:3 m3:1.2.3:0",
"FINALSTATS hits 0   misses 12   hitrate 0.00"
],
[
"-p OPT -C 5 -s 9 -n 40 -m 12",
"m5:5:- m4:5.4:- m1:5.4.1:- m10:5.4.1.10:- m0:5.4.1.10.0:- m6:5.4.10.0.6:1 h10:5.4.10.0.6:- h0:5.4.10.0.6:- h6:5.4.10.0.6:- m7:5.4.0.6.7:10 h0:5.4.0.6.7:- h4:5.4.0.6.7:- m8:5.4.6.7.8:0 h5:5.4.6.7.8:- h8:5.4.6.7.8:- m1:4.6.7.8.1:5 m2:4.6.7.1.2:8 h1:4.6.7.1.2:- h6:4.6.7.1.2:- m11:4.7.1.2.11:6 h7:4.7.1.2.11:- m9:4.7.1.2.9:11 h4:4.7.1.2.9:- m8:4.1.2.9.8:7 h1:4.1.2.9.8:- m3:1.2.9.8.3:4 h8:1.2.9.8.3:- h8:1.2.9.8.3:- m5:1.2.9.3.5:8 h1:1.2.9.3.5:- h3:1.2.9.3.5:- h2:1.2.9.3.5:- h3:1.2.9.3.5:- h9:1.2.9.3.5:- h2:1.2.9.3.5:- m10:1.2.9.5.10:3 h10:1.2.9.5.10:- m0:1.2.9.5.0:10 m4:1.2.9.5.4:0 h5:1.2.9.5.4:-",
"FINALSTATS hits 22   misses 18   hitrate 55.00"
]
];

export const GOLDEN_LINES: [string, string[]][] = [
[
"-p FIFO -s 0",
[
"Access: 8  MISS FirstIn ->          [8] <- Lastin  Replaced:- [Hits:0 Misses:1]",
"Access: 7  MISS FirstIn ->       [8, 7] <- Lastin  Replaced:- [Hits:0 Misses:2]",
"Access: 4  MISS FirstIn ->    [8, 7, 4] <- Lastin  Replaced:- [Hits:0 Misses:3]",
"Access: 2  MISS FirstIn ->    [7, 4, 2] <- Lastin  Replaced:8 [Hits:0 Misses:4]",
"Access: 5  MISS FirstIn ->    [4, 2, 5] <- Lastin  Replaced:7 [Hits:0 Misses:5]",
"Access: 4  HIT  FirstIn ->    [4, 2, 5] <- Lastin  Replaced:- [Hits:1 Misses:5]",
"Access: 7  MISS FirstIn ->    [2, 5, 7] <- Lastin  Replaced:4 [Hits:1 Misses:6]",
"Access: 3  MISS FirstIn ->    [5, 7, 3] <- Lastin  Replaced:2 [Hits:1 Misses:7]",
"Access: 4  MISS FirstIn ->    [7, 3, 4] <- Lastin  Replaced:5 [Hits:1 Misses:8]",
"Access: 5  MISS FirstIn ->    [3, 4, 5] <- Lastin  Replaced:7 [Hits:1 Misses:9]",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
]
],
[
"-p LRU -s 4",
[
"Access: 2  MISS LRU ->          [2] <- MRU Replaced:- [Hits:0 Misses:1]",
"Access: 1  MISS LRU ->       [2, 1] <- MRU Replaced:- [Hits:0 Misses:2]",
"Access: 3  MISS LRU ->    [2, 1, 3] <- MRU Replaced:- [Hits:0 Misses:3]",
"Access: 1  HIT  LRU ->    [2, 3, 1] <- MRU Replaced:- [Hits:1 Misses:3]",
"Access: 0  MISS LRU ->    [3, 1, 0] <- MRU Replaced:2 [Hits:1 Misses:4]",
"Access: 4  MISS LRU ->    [1, 0, 4] <- MRU Replaced:3 [Hits:1 Misses:5]",
"Access: 9  MISS LRU ->    [0, 4, 9] <- MRU Replaced:1 [Hits:1 Misses:6]",
"Access: 8  MISS LRU ->    [4, 9, 8] <- MRU Replaced:0 [Hits:1 Misses:7]",
"Access: 7  MISS LRU ->    [9, 8, 7] <- MRU Replaced:4 [Hits:1 Misses:8]",
"Access: 2  MISS LRU ->    [8, 7, 2] <- MRU Replaced:9 [Hits:1 Misses:9]",
"FINALSTATS hits 1   misses 9   hitrate 10.00"
]
],
[
"-p OPT -s 3",
[
"Access: 2  MISS Left  ->          [2] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 5  MISS Left  ->       [2, 5] <- Right Replaced:- [Hits:0 Misses:2]",
"Access: 3  MISS Left  ->    [2, 5, 3] <- Right Replaced:- [Hits:0 Misses:3]",
"Access: 6  MISS Left  ->    [2, 5, 6] <- Right Replaced:3 [Hits:0 Misses:4]",
"Access: 6  HIT  Left  ->    [2, 5, 6] <- Right Replaced:- [Hits:1 Misses:4]",
"Access: 0  MISS Left  ->    [2, 5, 0] <- Right Replaced:6 [Hits:1 Misses:5]",
"Access: 0  HIT  Left  ->    [2, 5, 0] <- Right Replaced:- [Hits:2 Misses:5]",
"Access: 8  MISS Left  ->    [2, 5, 8] <- Right Replaced:0 [Hits:2 Misses:6]",
"Access: 2  HIT  Left  ->    [2, 5, 8] <- Right Replaced:- [Hits:3 Misses:6]",
"Access: 2  HIT  Left  ->    [2, 5, 8] <- Right Replaced:- [Hits:4 Misses:6]",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
]
],
[
"-p RAND -s 2",
[
"Access: 9  MISS Left  ->          [9] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 9  HIT  Left  ->          [9] <- Right Replaced:- [Hits:1 Misses:1]",
"Access: 0  MISS Left  ->       [9, 0] <- Right Replaced:- [Hits:1 Misses:2]",
"Access: 0  HIT  Left  ->       [9, 0] <- Right Replaced:- [Hits:2 Misses:2]",
"Access: 8  MISS Left  ->    [9, 0, 8] <- Right Replaced:- [Hits:2 Misses:3]",
"Access: 7  MISS Left  ->    [9, 8, 7] <- Right Replaced:0 [Hits:2 Misses:4]",
"Access: 6  MISS Left  ->    [8, 7, 6] <- Right Replaced:9 [Hits:2 Misses:5]",
"Access: 3  MISS Left  ->    [8, 6, 3] <- Right Replaced:7 [Hits:2 Misses:6]",
"Access: 6  HIT  Left  ->    [8, 6, 3] <- Right Replaced:- [Hits:3 Misses:6]",
"Access: 6  HIT  Left  ->    [8, 6, 3] <- Right Replaced:- [Hits:4 Misses:6]",
"FINALSTATS hits 4   misses 6   hitrate 40.00"
]
],
[
"-p FIFO -s 7 -n 25 -m 6 -C 4",
[
"Access: 1  MISS FirstIn ->          [1] <- Lastin  Replaced:- [Hits:0 Misses:1]",
"Access: 0  MISS FirstIn ->       [1, 0] <- Lastin  Replaced:- [Hits:0 Misses:2]",
"Access: 3  MISS FirstIn ->    [1, 0, 3] <- Lastin  Replaced:- [Hits:0 Misses:3]",
"Access: 0  HIT  FirstIn ->    [1, 0, 3] <- Lastin  Replaced:- [Hits:1 Misses:3]",
"Access: 3  HIT  FirstIn ->    [1, 0, 3] <- Lastin  Replaced:- [Hits:2 Misses:3]",
"Access: 2  MISS FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:2 Misses:4]",
"Access: 0  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:3 Misses:4]",
"Access: 3  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:4 Misses:4]",
"Access: 0  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:5 Misses:4]",
"Access: 2  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:6 Misses:4]",
"Access: 0  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:7 Misses:4]",
"Access: 0  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:8 Misses:4]",
"Access: 2  HIT  FirstIn -> [1, 0, 3, 2] <- Lastin  Replaced:- [Hits:9 Misses:4]",
"Access: 4  MISS FirstIn -> [0, 3, 2, 4] <- Lastin  Replaced:1 [Hits:9 Misses:5]",
"Access: 0  HIT  FirstIn -> [0, 3, 2, 4] <- Lastin  Replaced:- [Hits:10 Misses:5]",
"Access: 1  MISS FirstIn -> [3, 2, 4, 1] <- Lastin  Replaced:0 [Hits:10 Misses:6]",
"Access: 3  HIT  FirstIn -> [3, 2, 4, 1] <- Lastin  Replaced:- [Hits:11 Misses:6]",
"Access: 5  MISS FirstIn -> [2, 4, 1, 5] <- Lastin  Replaced:3 [Hits:11 Misses:7]",
"Access: 3  MISS FirstIn -> [4, 1, 5, 3] <- Lastin  Replaced:2 [Hits:11 Misses:8]",
"Access: 2  MISS FirstIn -> [1, 5, 3, 2] <- Lastin  Replaced:4 [Hits:11 Misses:9]",
"Access: 5  HIT  FirstIn -> [1, 5, 3, 2] <- Lastin  Replaced:- [Hits:12 Misses:9]",
"Access: 0  MISS FirstIn -> [5, 3, 2, 0] <- Lastin  Replaced:1 [Hits:12 Misses:10]",
"Access: 5  HIT  FirstIn -> [5, 3, 2, 0] <- Lastin  Replaced:- [Hits:13 Misses:10]",
"Access: 1  MISS FirstIn -> [3, 2, 0, 1] <- Lastin  Replaced:5 [Hits:13 Misses:11]",
"Access: 0  HIT  FirstIn -> [3, 2, 0, 1] <- Lastin  Replaced:- [Hits:14 Misses:11]",
"FINALSTATS hits 14   misses 11   hitrate 56.00"
]
],
[
"-p RAND -a 0,1,2,0,1,3,0,3,1,2,1",
[
"Access: 0  MISS Left  ->          [0] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 1  MISS Left  ->       [0, 1] <- Right Replaced:- [Hits:0 Misses:2]",
"Access: 2  MISS Left  ->    [0, 1, 2] <- Right Replaced:- [Hits:0 Misses:3]",
"Access: 0  HIT  Left  ->    [0, 1, 2] <- Right Replaced:- [Hits:1 Misses:3]",
"Access: 1  HIT  Left  ->    [0, 1, 2] <- Right Replaced:- [Hits:2 Misses:3]",
"Access: 3  MISS Left  ->    [0, 1, 3] <- Right Replaced:2 [Hits:2 Misses:4]",
"Access: 0  HIT  Left  ->    [0, 1, 3] <- Right Replaced:- [Hits:3 Misses:4]",
"Access: 3  HIT  Left  ->    [0, 1, 3] <- Right Replaced:- [Hits:4 Misses:4]",
"Access: 1  HIT  Left  ->    [0, 1, 3] <- Right Replaced:- [Hits:5 Misses:4]",
"Access: 2  MISS Left  ->    [0, 1, 2] <- Right Replaced:3 [Hits:5 Misses:5]",
"Access: 1  HIT  Left  ->    [0, 1, 2] <- Right Replaced:- [Hits:6 Misses:5]",
"FINALSTATS hits 6   misses 5   hitrate 54.55"
]
],
[
"-p OPT -C 4 -a 1,2,3,4,1,2,5,1,2,3,4,5",
[
"Access: 1  MISS Left  ->          [1] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 2  MISS Left  ->       [1, 2] <- Right Replaced:- [Hits:0 Misses:2]",
"Access: 3  MISS Left  ->    [1, 2, 3] <- Right Replaced:- [Hits:0 Misses:3]",
"Access: 4  MISS Left  -> [1, 2, 3, 4] <- Right Replaced:- [Hits:0 Misses:4]",
"Access: 1  HIT  Left  -> [1, 2, 3, 4] <- Right Replaced:- [Hits:1 Misses:4]",
"Access: 2  HIT  Left  -> [1, 2, 3, 4] <- Right Replaced:- [Hits:2 Misses:4]",
"Access: 5  MISS Left  -> [1, 2, 3, 5] <- Right Replaced:4 [Hits:2 Misses:5]",
"Access: 1  HIT  Left  -> [1, 2, 3, 5] <- Right Replaced:- [Hits:3 Misses:5]",
"Access: 2  HIT  Left  -> [1, 2, 3, 5] <- Right Replaced:- [Hits:4 Misses:5]",
"Access: 3  HIT  Left  -> [1, 2, 3, 5] <- Right Replaced:- [Hits:5 Misses:5]",
"Access: 4  MISS Left  -> [1, 2, 5, 4] <- Right Replaced:3 [Hits:5 Misses:6]",
"Access: 5  HIT  Left  -> [1, 2, 5, 4] <- Right Replaced:- [Hits:6 Misses:6]",
"FINALSTATS hits 6   misses 6   hitrate 50.00"
]
],
[
"-p CLOCK -b 3 -s 0 -n 20 -m 8 -C 4",
[
"Access: 6  MISS Left  ->          [6] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 6  HIT  Left  ->          [6] <- Right Replaced:- [Hits:1 Misses:1]",
"Access: 3  MISS Left  ->       [6, 3] <- Right Replaced:- [Hits:1 Misses:2]",
"Access: 2  MISS Left  ->    [6, 3, 2] <- Right Replaced:- [Hits:1 Misses:3]",
"Access: 4  MISS Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:1 Misses:4]",
"Access: 3  HIT  Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:2 Misses:4]",
"Access: 6  HIT  Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:3 Misses:4]",
"Access: 2  HIT  Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:4 Misses:4]",
"Access: 3  HIT  Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:5 Misses:4]",
"Access: 4  HIT  Left  -> [6, 3, 2, 4] <- Right Replaced:- [Hits:6 Misses:4]",
"Access: 7  MISS Left  -> [6, 3, 4, 7] <- Right Replaced:2 [Hits:6 Misses:5]",
"Access: 4  HIT  Left  -> [6, 3, 4, 7] <- Right Replaced:- [Hits:7 Misses:5]",
"Access: 2  MISS Left  -> [6, 3, 4, 2] <- Right Replaced:7 [Hits:7 Misses:6]",
"Access: 6  HIT  Left  -> [6, 3, 4, 2] <- Right Replaced:- [Hits:8 Misses:6]",
"Access: 4  HIT  Left  -> [6, 3, 4, 2] <- Right Replaced:- [Hits:9 Misses:6]",
"Access: 2  HIT  Left  -> [6, 3, 4, 2] <- Right Replaced:- [Hits:10 Misses:6]",
"Access: 7  MISS Left  -> [6, 4, 2, 7] <- Right Replaced:3 [Hits:10 Misses:7]",
"Access: 7  HIT  Left  -> [6, 4, 2, 7] <- Right Replaced:- [Hits:11 Misses:7]",
"Access: 6  HIT  Left  -> [6, 4, 2, 7] <- Right Replaced:- [Hits:12 Misses:7]",
"Access: 7  HIT  Left  -> [6, 4, 2, 7] <- Right Replaced:- [Hits:13 Misses:7]",
"FINALSTATS hits 13   misses 7   hitrate 65.00"
]
],
[
"-p RAND -s 11 -C 1 -n 12 -m 3",
[
"Access: 1  MISS Left  ->          [1] <- Right Replaced:- [Hits:0 Misses:1]",
"Access: 1  HIT  Left  ->          [1] <- Right Replaced:- [Hits:1 Misses:1]",
"Access: 2  MISS Left  ->          [2] <- Right Replaced:1 [Hits:1 Misses:2]",
"Access: 1  MISS Left  ->          [1] <- Right Replaced:2 [Hits:1 Misses:3]",
"Access: 1  HIT  Left  ->          [1] <- Right Replaced:- [Hits:2 Misses:3]",
"Access: 1  HIT  Left  ->          [1] <- Right Replaced:- [Hits:3 Misses:3]",
"Access: 0  MISS Left  ->          [0] <- Right Replaced:1 [Hits:3 Misses:4]",
"Access: 1  MISS Left  ->          [1] <- Right Replaced:0 [Hits:3 Misses:5]",
"Access: 1  HIT  Left  ->          [1] <- Right Replaced:- [Hits:4 Misses:5]",
"Access: 2  MISS Left  ->          [2] <- Right Replaced:1 [Hits:4 Misses:6]",
"Access: 0  MISS Left  ->          [0] <- Right Replaced:2 [Hits:4 Misses:7]",
"Access: 0  HIT  Left  ->          [0] <- Right Replaced:- [Hits:5 Misses:7]",
"FINALSTATS hits 5   misses 7   hitrate 41.67"
]
]
];
