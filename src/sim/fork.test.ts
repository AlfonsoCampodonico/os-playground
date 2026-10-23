import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_PRESETS, compileC, randomProgram, runC, type Policy } from './fork/code';
import { FORK_PY_FULL, FORK_PY_SEEDS } from './fork/golden';
import { forkPyCommand, forkPyOutput, parseForkPyFlags, printTree, simulateForkPy, type ForkPyConfig, type ForkPyPrint } from './fork/tree';

const DEF: ForkPyConfig = { seed: -1, actions: 5, forkPct: 0.7, actionList: '', localReparent: false, leafOnly: false };

/** Turns a fork.py command line into our config + print options, the way the UI's "paste flags" does. */
function fromFlags(line: string): [ForkPyConfig, ForkPyPrint] {
  const { flags, errors } = parseForkPyFlags(line);
  expect(errors).toEqual([]);
  const cfg: ForkPyConfig = { ...DEF, ...flags };
  return [cfg, { showTree: !!flags.showTree, finalOnly: !!flags.finalOnly, solve: !!flags.solve, style: flags.style ?? 'fancy', seedArg: flags.seed ?? -1 }];
}

describe('fork.py port: golden outputs', () => {
  for (const [line, expected] of Object.entries(FORK_PY_FULL)) {
    it(`./fork.py ${line}`, () => {
      const [cfg, p] = fromFlags(line);
      expect(forkPyOutput(cfg, p)).toBe(expected);
    });
  }

  it('reproduces the actions and final tree of 150 random problems', () => {
    for (const [key, actions, tree] of FORK_PY_SEEDS) {
      const [seed, a, f] = key.split(',').map(Number);
      const run = simulateForkPy({ ...DEF, seed, actions: a, forkPct: f });
      expect(run.steps.map((s) => s.text).join('|'), key).toBe(actions);
      const final = run.steps.at(-1)?.tree ?? run.initial;
      const basic = printTree(final, 'basic')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.slice(31).trimEnd())
        .join('/');
      expect(basic, key).toBe(tree);
    }
  });
});

// Live check against the real script when it is around (python3 + OSTEP homework checkout).
const SCRIPT = process.env.FORK_PY ?? resolve(process.env.OSTEP_HOMEWORK ?? '.ostep-homework', 'cpu-api/fork.py');
const live = existsSync(SCRIPT);
describe.skipIf(!live)('fork.py port: live against python3', () => {
  const lines = [
    '-s 10 -c',
    '-s 10',
    '-s 1 -a 20 -c',
    '-s 2 -a 30 -f 0.9 -c',
    '-s 3 -a 40 -f 0.2 -c',
    '-s 5 -a 25 -f 0.5 -R -c',
    '-s 6 -a 25 -f 0.5 -L -c',
    '-s 7 -a 12 -t',
    '-s 7 -a 12 -tc',
    '-s 8 -a 15 -F',
    '-s 8 -a 15 -F -c',
    '-s 11 -a 18 -f 0.6 -P basic -c',
    '-s 12 -a 18 -P line1 -c',
    '-s 13 -a 18 -P line2 -c',
    '-s 100 -a 100 -f 0.1 -c',
    '-s 42 -a 60 -f 0.95 -c',
    '-A a+b,a- -c',
    '-s 77 -a 200 -f 0.8 -R -L -c',
  ];
  for (const line of lines) {
    it(`./fork.py ${line}`, () => {
      const real = spawnSync('python3', ['-I', SCRIPT, ...line.split(' ')], { cwd: tmpdir(), encoding: 'utf8' }).stdout;
      const [cfg, p] = fromFlags(line);
      expect(forkPyOutput(cfg, p)).toBe(real);
    });
  }
});

describe('fork.py flags', () => {
  it('parses grouped short flags, attached values and long options', () => {
    expect(parseForkPyFlags('./fork.py -s4 -a 10 -tcF --forks=0.3 -R').flags).toEqual({ seed: 4, actions: 10, showTree: true, solve: true, finalOnly: true, forkPct: 0.3, localReparent: true });
    expect(parseForkPyFlags('-A a+b,b+c -L').flags).toEqual({ actionList: 'a+b,b+c', leafOnly: true });
    expect(parseForkPyFlags('-x -s').errors).toEqual(['-x', '-s']);
  });

  it('builds the equivalent command', () => {
    expect(forkPyCommand({ ...DEF, seed: 4 }, { showTree: false, finalOnly: false, solve: true })).toBe('./fork.py -s 4 -c');
    expect(forkPyCommand({ ...DEF, actionList: 'a+b, b-', localReparent: true }, { showTree: true, finalOnly: true, solve: false })).toBe('./fork.py -A a+b,b- -R -t -F');
  });

  it('records orphans: to the root by default, to the grandparent with -R', () => {
    const plain = simulateForkPy({ ...DEF, actionList: 'a+b,b+c,c+d,c+e,c-' }).steps.at(-1)!;
    expect(plain.orphans).toEqual([
      { name: 'd', from: 'c', to: 'a' },
      { name: 'e', from: 'c', to: 'a' },
    ]);
    const local = simulateForkPy({ ...DEF, actionList: 'a+b,b+c,c+d,c+e,c-', localReparent: true }).steps.at(-1)!;
    expect(local.orphans.map((o) => o.to)).toEqual(['b', 'b']);
    expect(local.exited).toEqual({ name: 'c', parent: 'b' });
  });
});

/* ---------------- Código: the C-subset interpreter ---------------- */


const out = (src: string, policy: Policy = 'parent', seed = 0) => runC({ src, policy, seed }).output.map((o) => o.text);

describe('runC: classic exam programs', () => {
  it('fork(); fork(); printf → 4 holas, 3 processes created, whatever the scheduler', () => {
    for (const policy of ['parent', 'child', 'random'] as const) {
      for (const seed of [0, 1, 2, 3]) {
        const run = runC({ src: CODE_PRESETS.hola, policy, seed });
        expect(run.output.map((o) => o.text)).toEqual(['hola', 'hola', 'hola', 'hola']);
        expect(run.steps.at(-1)!.created).toBe(3);
        expect(new Set(run.output.map((o) => o.pid))).toEqual(new Set([100, 101, 102, 103]));
      }
    }
  });

  it('for i < 3 fork() → 8 processes', () => {
    const run = runC({ src: CODE_PRESETS.loop, policy: 'child', seed: 0 });
    expect(run.output).toHaveLength(8);
    expect(run.steps.at(-1)!.created).toBe(7);
  });

  it('p1.c: order depends on who runs first, the count does not', () => {
    expect(out(CODE_PRESETS.p1, 'parent')).toEqual(['hello world (pid:100)', 'hello, I am parent of 101 (pid:100)', 'hello, I am child (pid:101)']);
    expect(out(CODE_PRESETS.p1, 'child')).toEqual(['hello world (pid:100)', 'hello, I am child (pid:101)', 'hello, I am parent of 101 (pid:100)']);
  });

  it('p2.c: wait() makes the child always print first and returns its pid', () => {
    for (const policy of ['parent', 'child', 'random'] as const)
      expect(out(CODE_PRESETS.p2, policy, 5)).toEqual(['hello world (pid:100)', 'hello, I am child (pid:101)', 'hello, I am parent of 101 (rc_wait:101) (pid:100)']);
  });

  it('p3.c: exec replaces the image; the code after it never runs', () => {
    const run = runC({ src: CODE_PRESETS.p3, policy: 'parent', seed: 0 });
    expect(run.output.map((o) => o.text)).toEqual(['hello world (pid:100)', 'hello, I am child (pid:101)', '  29 107 1030 p3.c', 'hello, I am parent of 101 (rc_wait:101) (pid:100)']);
    expect(run.output[2].image).toBe('wc');
    expect(run.steps.some((s) => s.procs.some((p) => p.pid === 101 && p.image === 'wc'))).toBe(true);
  });

  it('zombie: the child stays a zombie until the parent calls wait', () => {
    const run = runC({ src: CODE_PRESETS.zombie, policy: 'parent', seed: 0 });
    const zombieSteps = run.steps.filter((s) => s.procs.find((p) => p.pid === 101)?.state === 'zombie');
    expect(zombieSteps.length).toBeGreaterThan(1);
    expect(run.steps.at(-1)!.zombies).toBe(0);
    expect(run.steps.some((s) => s.events.some((e) => e.k === 'reap' && e.pid === 100 && e.child === 101))).toBe(true);
  });

  it('orphan: the child is adopted by init (PID 1) and getppid() says so', () => {
    for (const policy of ['parent', 'child'] as const) {
      const run = runC({ src: CODE_PRESETS.orphan, policy, seed: 0 });
      expect(run.output.map((o) => o.text)).toContain('hijo: mi padre ahora es 1');
      expect(run.steps.at(-1)!.orphans).toBe(1);
      expect(run.steps.at(-1)!.procs.find((p) => p.pid === 101)).toMatchObject({ ppid: 1, origPpid: 100, orphan: true });
    }
  });

  it('variables are copied: the child’s x++ does not touch the parent', () => {
    expect(out(CODE_PRESETS.vars)).toEqual(['hijo: x = 16', 'padre: x = 5']);
  });

  it('stdio buffer is copied by fork: printf without \\n before fork prints twice', () => {
    expect(out('printf("hola");\nfork();\nprintf("\\n");')).toEqual(['hola', 'hola']);
    // _exit skips the flush
    expect(out('printf("hola");\n_exit(0);')).toEqual([]);
  });

  it('fork() && fork() || fork() → 5 processes', () => {
    for (const policy of ['parent', 'child', 'random'] as const) expect(out('fork() && fork() || fork();\nprintf("x\\n");', policy, 9)).toHaveLength(5);
  });

  it('wait(&status) + WEXITSTATUS, waitpid on a given child, while (wait(NULL) > 0)', () => {
    expect(out('int status;\nif (fork() == 0) exit(3);\nwait(&status);\nprintf("%d\\n", WEXITSTATUS(status));')).toEqual(['3']);
    const src = 'pid_t a = fork();\nif (a == 0) { sleep(1); printf("A\\n"); exit(0); }\npid_t b = fork();\nif (b == 0) { printf("B\\n"); exit(0); }\nwaitpid(a, NULL, 0);\nprintf("fin\\n");';
    expect(out(src, 'parent')).toEqual(['B', 'A', 'fin']);
    expect(out('for (int i = 0; i < 3; i++) { if (fork() == 0) { printf("hijo %d\\n", i); exit(0); } }\nwhile (wait(NULL) > 0);\nprintf("listo\\n");', 'random', 4).at(-1)).toBe('listo');
  });

  it('a failed exec returns -1 and the code below runs', () => {
    expect(out('execlp("noexiste", "noexiste", NULL);\nprintf("sigo acá\\n");')).toEqual(['sigo acá']);
  });

  it('the random scheduler is reproducible and changes order, not count', () => {
    const a = out(CODE_PRESETS.loop.replace('fork();', 'fork();\n  printf("%d\\n", getpid());'), 'random', 7);
    expect(out(CODE_PRESETS.loop.replace('fork();', 'fork();\n  printf("%d\\n", getpid());'), 'random', 7)).toEqual(a);
    const orders = new Set([1, 2, 3, 4, 5].map((s) => out(CODE_PRESETS.p1, 'random', s).join('|')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('fork bombs hit the process limit instead of hanging', () => {
    const run = runC({ src: 'while (1) fork();', policy: 'parent', seed: 0 });
    expect(run.truncated).toBe(true);
    expect(run.steps.at(-1)!.procs.length).toBeLessThanOrEqual(40);
  });

  it('every random program compiles and runs to completion', () => {
    for (let s = 0; s < 60; s++) {
      const run = runC({ src: randomProgram(s), policy: 'random', seed: s });
      expect(run.error, randomProgram(s)).toBeUndefined();
      expect(run.truncated).toBe(false);
      expect(run.output.length).toBeGreaterThan(0);
    }
  });
});

describe('compileC: friendly errors with a line', () => {
  it.each([
    ['fork();\nprintf("hola\\n")\nfork();', 'expected', 2],
    ['fork();\nmalloc(10);', 'unknownFn', 2],
    ['char *s = "hola";', 'strings', 1],
    ['int a[3];', 'arrays', 1],
    ['execvp(args[0], args);', 'execv', 1],
    ['printf("%d %d\\n", 1);', 'fmtArgs', 1],
    ['void f() {}\nint main() { f(); }', 'otherFn', 1],
    ['printf("hola\\n);', 'string', 1],
    ['', 'empty', 1],
    ['switch (x) {}', 'keyword', 1],
  ])('%j → %s', (src, kind, line) => {
    expect(compileC(src).error).toMatchObject({ kind, line });
  });

  it('reports runtime errors such as undeclared variables', () => {
    expect(runC({ src: 'fork();\nx = 3;', policy: 'parent', seed: 0 }).error).toMatchObject({ kind: 'undeclared', line: 2, detail: 'x' });
  });
});
