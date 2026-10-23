import { describe, expect, it } from 'vitest';
import {
  BOOK_ML_VAS,
  PRESETS,
  SETUP_DEFAULTS,
  activePreset,
  buildBookMachine,
  convertSize,
  parseFlags,
  parseTable,
  parseVas,
  readEntry,
  runBookMl,
  runBookSeg,
  runSetup,
  type Mech,
  type Setup,
} from './address-translation/index';
import { GOLDEN } from './address-translation/golden';

const SCRIPT: Record<Mech, string> = {
  bb: 'relocation.py',
  seg: 'segmentation.py',
  lin: 'paging-linear-translate.py',
  ml: 'paging-multilevel-translate.py',
};

/** Same FNV-1a the golden generator uses on the script's stdout. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function setupFor(mech: Mech, flags: string): Setup {
  const { patch, bad, mech: m } = parseFlags(`./${SCRIPT[mech]} ${flags} -c`, 'bb');
  expect(bad).toEqual([]);
  expect(m).toBe(mech);
  return { ...SETUP_DEFAULTS, ...patch } as Setup;
}

const outputOf = (mech: Mech, flags: string) => runSetup(setupFor(mech, flags), { verbose: /(^|\s)-v(\s|$)/.test(flags) }).run;

describe('golden: identical to the OSTEP scripts with -c', () => {
  for (const mech of ['bb', 'seg', 'lin'] as const) {
    describe(SCRIPT[mech], () => {
      for (const g of GOLDEN[mech]) {
        it(`${g.flags || '(defaults)'}`, () => {
          const run = outputOf(mech, g.flags);
          expect(run.output?.trimEnd()).toBe(g.out);
          expect(run.error !== null).toBe('exit' in g);
        });
      }
    });
  }
  describe(SCRIPT.ml, () => {
    for (const g of GOLDEN.ml) {
      it(`${g.flags || '(defaults)'}`, () => {
        const run = outputOf('ml', g.flags);
        const out = run.output!.trimEnd();
        expect(out.slice(out.indexOf('PDBR:'))).toBe(g.head);
        expect(out.split('\n')[4]).toBe(g.page0);
        expect(fnv(out)).toBe(g.fnv);
      });
    }
  });
});

describe('base and bounds', () => {
  it('ch. 15 example: base 32 KB, bounds 16 KB', () => {
    const { run } = runSetup({ ...SETUP_DEFAULTS, ...PRESETS.bb.book, mech: 'bb' } as Setup);
    expect(run.bb).toEqual({ base: 32768, limit: 16384 });
    expect(run.steps.map((s) => s.pa)).toEqual([32896, 33792, 35768, 48128, null]);
    expect(run.steps.at(-1)!.outcome).toBe('violation');
    expect(run.perTranslation).toBe(0);
  });
});

describe('segmentation', () => {
  it('ch. 16 example: three segments, the stack grows down', () => {
    const run = runBookSeg({ asize: '16k', psize: '64k', code: ['32k', '2k'], heap: ['34k', '3k'], stack: ['28k', '2k'], vas: [100, 4200, 15360, 8000, 9000, 14000] });
    expect(run.error).toBeNull();
    expect(run.steps.map((s) => s.pa)).toEqual([32868, 34920, 27648, null, null, null]);
    expect(run.steps[2]).toMatchObject({ seg: 3, segOffset: -1024, region: 'stack' });
    // 9000 has selector 10: no segment there
    expect(run.steps[4]).toMatchObject({ seg: 2, region: null, outcome: 'violation' });
  });

  it('script semantics: segment 1 base is its top, offsets are negative', () => {
    const run = outputOf('seg', '-a 128 -p 512 -b 0 -l 20 -B 512 -L 20 -A 108,127,107');
    expect(run.steps.map((s) => s.pa)).toEqual([492, 511, null]);
    expect(run.steps[0].segOffset).toBe(-20);
  });
});

describe('linear paging', () => {
  it('ch. 18 example: VA 21 → VPN 1, offset 5 → PFN 7 → PA 117', () => {
    const { run } = runSetup({ ...SETUP_DEFAULTS, ...PRESETS.lin.book, mech: 'lin' } as Setup);
    expect(run.lin!.table).toEqual([3, 7, 5, 2]);
    expect(run.steps[0]).toMatchObject({ va: 21, vpn: 1, offset: 5, pfn: 7, pa: 117 });
    expect(run.tableBytes).toBe(16);
  });

  it('an edited table changes the translation but not the generated addresses', () => {
    const base = outputOf('lin', '-s 3');
    const t = [...base.lin!.generated];
    const vpn = base.steps[0].vpn!;
    const free = [...Array(base.lin!.pages).keys()].find((p) => !t.includes(p))!;
    t[vpn] = t[vpn] < 0 ? free : -1;
    const edited = runSetup({ ...setupFor('lin', '-s 3'), lnT: t.join(',') }).run;
    expect(edited.vas).toEqual(base.vas);
    expect(edited.steps[0].outcome).toBe(base.steps[0].outcome === 'ok' ? 'invalid' : 'ok');
    expect(edited.notes).toContain('editedTable');
  });
});

describe('multi-level paging', () => {
  it('ch. 20 example: VA 0x3F80 → PD[15] → PT[14] → PFN 55 → PA 0x0DC0', () => {
    const run = runBookMl(BOOK_ML_VAS);
    expect(run.steps[0]).toMatchObject({ pdi: 15, pti: 14, pfn: 55, pa: 0x0dc0, outcome: 'ok', reads: 2 });
    expect(run.steps.map((s) => s.outcome)).toEqual(['ok', 'ok', 'ok', 'pteFault', 'pdeFault', 'ok']);
    expect(run.steps.map((s) => s.pfn)).toEqual([55, 10, 80, undefined, undefined, 45]);
    expect(run.tableBytes).toBe(3 * 64);
    expect(run.linearBytes).toBe(1024);
    const m = buildBookMachine();
    expect(readEntry(m, m.pdbr * 64 + 15 * 4)).toEqual({ raw: 0x80000065, valid: true, pfn: 101 });
  });
});

describe('parsing', () => {
  it('sizes like OSTEP', () => {
    expect([convertSize('16k'), convertSize('1m'), convertSize('100'), convertSize('-1'), convertSize('0x10')]).toEqual([16384, 1048576, 100, -1, 16]);
    expect(convertSize('12q')).toBeNaN();
  });
  it('addresses in hex, decimal or binary', () => {
    expect(parseVas('0x10, 16 0b10000;x')).toEqual({ vas: [16, 16, 16], bad: ['x'] });
  });
  it('pasted flags: --long=value, glued short flags, unknown ones reported', () => {
    const { mech, patch, bad } = parseFlags('python3 segmentation.py --seed=3 -a128 -L 20 -z -c', 'bb');
    expect(mech).toBe('seg');
    expect(patch).toMatchObject({ sgS: 3, sgA: '128', sgL1: '20' });
    expect(bad).toEqual(['-z']);
  });
  it('page table text', () => {
    expect(parseTable('3, 7,-,2')).toEqual([3, 7, -1, 2]);
    expect(parseTable('')).toBeNull();
  });
  it('presets are recognized', () => {
    for (const mech of ['bb', 'seg', 'lin', 'ml'] as const)
      for (const [id, p] of Object.entries(PRESETS[mech])) expect(activePreset({ ...SETUP_DEFAULTS, ...p, mech } as Setup)).toBe(id);
  });
});
