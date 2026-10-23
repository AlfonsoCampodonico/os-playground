import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assemble,
  configFromFlags,
  derivePoints,
  findCriticalSections,
  findViolation,
  formatCommand,
  formatTrace,
  OSTEP_PROGRAMS,
  parseFlags,
  prepare,
  programSource,
  runPoints,
  runX86,
  scheduleFromSequence,
  simulateLocks,
  toggleSwitch,
  X86_DEFAULTS,
  type X86Config,
} from './locks';
import { GOLDEN, GOLDEN_RUNS } from './locks/golden';

/** Same FNV-1a the golden generator uses on the script's stdout. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const src = (prog: string) => programSource(prog, 'es')!;

function traceOf(prog: string, flags: string, flavor: 'intro' | 'locks' = 'locks'): string {
  const { cfg, bad, headercount } = configFromFlags(flags);
  expect(bad).toEqual([]);
  const asm = assemble(src(prog), cfg.loadAddr);
  expect(asm.errors).toEqual([]);
  const prep = prepare(asm, cfg);
  expect(prep.errors).toEqual([]);
  const run = runX86(asm, { ...cfg, maxSteps: 100_000 }, prep);
  expect(run.fault).toBeUndefined();
  expect(run.truncated).toBe(false);
  return formatTrace(asm, run, cfg, { headercount, flavor });
}

describe('x86.py parity (stored golden hashes of `x86.py -p <prog> <flags> -c`)', () => {
  it('has a golden for every configured run', () => {
    expect(GOLDEN.length).toBe(GOLDEN_RUNS.length);
  });
  for (const g of GOLDEN) {
    it(`${g.prog} ${g.flags}`, () => {
      const out = traceOf(g.prog, g.flags, g.dir);
      expect(out.split('\n').length).toBe(g.lines);
      expect(fnv(out)).toBe(g.hash);
    });
  }
});

// Live comparison against the real scripts when the OSTEP homework checkout is around.
const REF = resolve(process.env.OSTEP_HOMEWORK ?? '.ostep-homework');
describe.skipIf(!existsSync(join(REF, 'threads-locks/x86.py')))('x86.py parity (live python3)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x86-'));
  const python = (g: { dir: string; prog: string; flags: string }) => {
    const file = join(dir, g.prog.replace(/\//g, '_') + (g.prog.endsWith('.s') ? '' : '.s'));
    writeFileSync(file, src(g.prog));
    const script = join(REF, g.dir === 'intro' ? 'threads-intro' : 'threads-locks', 'x86.py');
    const out = spawnSync('python3', ['-I', script, '-p', file, ...g.flags.split(' '), '-c'], { cwd: tmpdir(), encoding: 'utf8' }).stdout;
    return out.slice(out.indexOf('\n\n') + 2);
  };
  it.each(GOLDEN_RUNS)('$prog $flags', (g) => {
    expect(traceOf(g.prog, g.flags, g.dir as 'intro' | 'locks')).toBe(python(g));
  });

  it('-P strings built from the timeline editor reproduce the same run in x86.py', () => {
    for (const [prog, flags] of [
      ['counter', '-t 2 -i 2 -M counter -R ax'],
      ['locks/flag.s', '-t 2 -a bx=1 -M flag,count -R ax -i 50'],
      ['locks/test-and-set.s', '-t 3 -a bx=1 -M mutex,count -R ax -i 4'],
      ['locks/yield.s', '-t 2 -a bx=1 -M mutex,count -R ax -i 3'],
    ] as const) {
      const { cfg } = configFromFlags(flags);
      const asm = assemble(src(prog));
      const base = runX86(asm, cfg);
      const r = toggleSwitch(asm, cfg, base, 1);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const P = `${flags.replace(/-i \d+/, '')} -P ${r.procsched}`;
      expect(traceOf(prog, P)).toBe(python({ dir: 'locks', prog, flags: P }));
    }
  });
});

describe('assembler', () => {
  it('lays out .var from address 100, 4 bytes per slot (arrays with a count)', () => {
    const asm = assemble(OSTEP_PROGRAMS['locks/peterson.s']);
    expect(asm.vars).toEqual({ flag: 100, turn: 108, count: 112 });
    expect(asm.errors).toEqual([]);
  });

  it('parses every addressing mode of mov', () => {
    const asm = assemble('.var x\nmov $5, %ax\nmov 2000, %ax\nmov x, %bx\nmov 4(%ax), %cx\nmov 4(%ax,%bx), %cx\nmov 0(%fx,%bx,4), %cx\nmov (%ax), %dx\nmov %ax, -4(%sp)\nmov $1, (%cx)\nhalt');
    expect(asm.errors).toEqual([]);
    expect(asm.program.map((i) => i.op.k)).toEqual(['mov_ir', 'mov_mr', 'mov_mr', 'mov_mr', 'mov_mr', 'mov_mr', 'mov_mr', 'mov_rm', 'mov_im', 'halt']);
    expect(asm.program[5].op).toEqual({ k: 'mov_mr', m: { disp: 0, r1: 6, r2: 2, scale: 4 }, dst: 3 });
    expect(asm.program[7].op).toEqual({ k: 'mov_rm', src: 1, m: { disp: -4, r1: 7, r2: 0, scale: 1 } });
  });

  it('reports errors with their line instead of crashing', () => {
    const asm = assemble('.main\nmov 2000, %ax\nadd $1, %zz\nmovv %ax, 2000\njne .nowhere\nmov 2000, 3000\nhalt');
    expect(asm.errors.map((e) => [e.line, e.code, e.detail])).toEqual([
      [3, 'reg', 'zz'],
      [4, 'opcode', 'movv'],
      [5, 'label', '.nowhere'],
      [6, 'operands', 'mov'],
    ]);
  });

  it('finds critical sections from the comment, or from a load/add/store pattern', () => {
    expect(findCriticalSections(assemble(OSTEP_PROGRAMS['locks/flag.s']))).toEqual([{ start: 4, end: 7 }]);
    expect(findCriticalSections(assemble(OSTEP_PROGRAMS['locks/simple-race.s']))).toEqual([{ start: 0, end: 3 }]);
  });
});

describe('flags', () => {
  it('parses pasted commands in optparse style', () => {
    const p = parseFlags('./x86.py -p flag.s -t2 --interrupt=7 -rC -s 3 -a bx=2,bx=2 -M flag,count -c');
    expect(p.prog).toBe('flag.s');
    expect(p.patch).toEqual({ threads: 2, intfreq: 7, intrand: true, cctrace: true, seed: 3, argv: 'bx=2,bx=2', memtrace: 'flag,count' });
    expect(p.bad).toEqual([]);
    expect(parseFlags('-x 3').bad).toEqual(['-x', '3']);
  });

  it('prints the equivalent command', () => {
    const cfg: X86Config = { ...X86_DEFAULTS, intfreq: 2, memtrace: 'counter', regtrace: 'ax' };
    expect(formatCommand('counter.s', cfg)).toBe('./x86.py -p counter.s -t 2 -i 2 -M counter -R ax -c');
    expect(formatCommand('flag.s', { ...cfg, procsched: '0011' })).toBe('./x86.py -p flag.s -t 2 -P 0011 -M counter -R ax -c');
  });
});

describe('races, locks and schedules', () => {
  const run = (prog: string, flags: string) => {
    const { cfg } = configFromFlags(flags);
    return simulateLocks(src(prog), cfg);
  };

  it('counter++ with -i 2 loses an increment; with -i 3 (whole counter++ per slice) it does not', () => {
    const lost = run('counter', '-t 2 -i 2');
    expect(lost.steps.at(-1)!.counter).toEqual({ value: 1, expected: 2 });
    expect(lost.steps.some((s) => s.lost)).toBe(true);
    expect(lost.steps.some((s) => s.overlap)).toBe(true);
    const fine = run('counter', '-t 2 -i 4');
    expect(fine.steps.at(-1)!.counter).toEqual({ value: 2, expected: 2 });
    expect(fine.steps.some((s) => s.overlap)).toBe(false);
  });

  it('the test-and-set lock keeps the counter right and spins while waiting', () => {
    const r = run('counter-tas', '-t 2 -i 2');
    expect(r.steps.at(-1)!.counter).toEqual({ value: 2, expected: 2 });
    expect(r.steps.some((s) => s.overlap)).toBe(false);
    expect(r.steps.at(-1)!.spins.reduce((a, b) => a + b)).toBeGreaterThan(0);
  });

  it('a -P built from a sequence reproduces it exactly (halts burn an extra slot)', () => {
    const { cfg } = configFromFlags('-t 3 -a bx=1 -i 2');
    const asm = assemble(src('locks/test-and-set.s'));
    const base = runX86(asm, cfg);
    const seq = base.steps.map((s) => s.tid);
    const P = scheduleFromSequence(
      seq,
      base.steps.map((s) => s.res.rc === -1),
      3,
    );
    const manual = runX86(asm, { ...cfg, procsched: P });
    expect(manual.steps.map((s) => s.tid)).toEqual(seq);
  });

  it('derived switch points reproduce the run they came from', () => {
    const { cfg } = configFromFlags('-t 2 -a bx=2 -i 3 -r -s 4');
    const asm = assemble(src('locks/ticket.s'));
    const base = runX86(asm, cfg);
    const { seq } = runPoints(asm, cfg, derivePoints(base), base.steps[0].tid);
    expect(seq).toEqual(base.steps.map((s) => s.tid));
  });

  it('toggling a gap adds a context switch there, and toggling it again removes it', () => {
    const { cfg } = configFromFlags('-t 2 -i 50');
    const asm = assemble(src('counter'));
    const base = runX86(asm, cfg);
    expect(base.steps.map((s) => s.tid).join('')).toBe('00001111');
    const r = toggleSwitch(asm, cfg, base, 0);
    expect(r).toMatchObject({ ok: true, added: true });
    if (!r.ok) return;
    const after = runX86(asm, { ...cfg, procsched: r.procsched });
    expect(after.steps.map((s) => s.tid).join('')).toBe('01111000');
    const back = toggleSwitch(asm, cfg, after, 0);
    expect(back.ok && runX86(asm, { ...cfg, procsched: back.procsched }).steps.map((s) => s.tid).join('')).toBe('00001111');
  });

  it('finds the interleaving that breaks flag.s, and none for test-and-set, Peterson or ticket', () => {
    const v = findViolation(assemble(src('locks/flag.s')), configFromFlags('-a bx=1').cfg, findCriticalSections(assemble(src('locks/flag.s'))));
    expect(v).not.toBeNull();
    expect(v!.segments.map((s) => s[0])).toEqual([0, 1, 0]);
    const broken = runX86(assemble(src('locks/flag.s')), { ...configFromFlags('-a bx=1').cfg, procsched: v!.procsched });
    expect(broken.steps.length).toBeGreaterThan(v!.at);
    for (const [prog, flags] of [
      ['locks/test-and-set.s', '-a bx=1'],
      ['locks/peterson.s', '-a bx=0,bx=1'],
      ['locks/ticket.s', '-a bx=1'],
    ]) {
      const asm = assemble(src(prog));
      expect(findViolation(asm, configFromFlags(flags).cfg, findCriticalSections(asm)), prog).toBeNull();
    }
  });

  it('Peterson with both threads claiming to be thread 0 breaks', () => {
    const asm = assemble(src('locks/peterson.s'));
    expect(findViolation(asm, configFromFlags('-a bx=0,bx=0').cfg, findCriticalSections(asm))).not.toBeNull();
  });

  it('stops runaway spinning at the step cap', () => {
    const r = run('intro/wait-for-me.s', '-t 1 -a ax=0');
    expect(r.truncated).toBe(true);
    expect(r.steps.at(-1)!.spins[0]).toBeGreaterThan(100);
  });

  it('flags runtime faults (running off the end of the program)', () => {
    const r = simulateLocks('mov $1, %ax', { ...X86_DEFAULTS, threads: 1 });
    expect(r.fault?.code).toBe('pcOut');
  });
});
