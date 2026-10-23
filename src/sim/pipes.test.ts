import { describe, expect, it } from 'vitest';
import { PRESETS, parseCommandLine, randomCommand, simulatePipes, type PipesConfig, type Snapshot, type Stage } from './pipes';

function stages(cmd: string): Stage[] {
  const p = parseCommandLine(cmd);
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return p.stages;
}
const run = (cmd: string, opts: Partial<Omit<PipesConfig, 'stages'>> = {}) =>
  simulatePipes({ stages: stages(cmd), forgetClose: false, redirectInParent: false, data: true, ...opts });
const trace = (r: ReturnType<typeof run>) => r.steps.map((s) => `${s.pid} ${s.call}${s.ret ? ` = ${s.ret}` : ''}`);
const screen = (s: Snapshot) => s.objs.find((o) => o.id === 'tty')!.screen;

/** Every refcount must equal the number of fd slots pointing at that entry. */
function checkRefcounts(s: Snapshot) {
  const count = new Map<string, number>();
  for (const p of s.procs) for (const f of p.fds) if (f) count.set(f, (count.get(f) ?? 0) + 1);
  for (const f of s.files) expect(f.ref, f.id).toBe(count.get(f.id) ?? 0);
  for (const id of count.keys()) expect(s.files.some((f) => f.id === id), id).toBe(true);
}

describe('parseCommandLine', () => {
  it('splits a pipeline with redirections', () => {
    const p = parseCommandLine('ls -l | grep txt | wc -l > out.txt');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.stages.map((s) => s.argv)).toEqual([['ls', '-l'], ['grep', 'txt'], ['wc', '-l']]);
    expect(p.stages[2].redirs).toEqual([{ fd: 1, kind: 'out', path: 'out.txt', text: '> out.txt' }]);
  });

  it('understands <, >>, 2>, 2>&1 and quotes, attached or not', () => {
    const p = parseCommandLine(`sort<in.txt 2>err.txt >>"mi log.txt" 2>&1`);
    expect(p.ok && p.stages[0].redirs.map((r) => [r.fd, r.kind, r.path ?? r.target])).toEqual([
      [0, 'in', 'in.txt'],
      [2, 'out', 'err.txt'],
      [1, 'append', 'mi log.txt'],
      [2, 'dup', 1],
    ]);
    expect(p.ok && p.stages[0].text).toBe(`sort < in.txt 2> err.txt >> 'mi log.txt' 2>&1`);
  });

  it('a digit inside a word is not an fd', () => {
    const p = parseCommandLine('echo a2>x');
    expect(p.ok && p.stages[0].argv).toEqual(['echo', 'a2']);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['| wc', 'pipeStart'],
    ['ls |', 'pipeEnd'],
    ['ls | | wc', 'emptyStage'],
    ['ls >', 'missingFile'],
    ['ls > | wc', 'missingFile'],
    ['> out.txt', 'noCommand'],
    ['ls && wc', 'unsupported'],
    ['ls; wc', 'unsupported'],
    ['ls &', 'unsupported'],
    ['ls || wc', 'unsupported'],
    ['cat << EOF', 'unsupported'],
    ["echo 'hola", 'quote'],
    ['ls 3> x', 'badFd'],
    ['ls 2>&', 'badDup'],
    ['a | b | c | d | e | f', 'tooMany'],
  ])('rejects %j (%s)', (cmd, code) => {
    const p = parseCommandLine(cmd);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe(code);
  });
});

describe('simulatePipes', () => {
  it('ls | wc -l: the canonical sequence', () => {
    const r = run('ls | wc -l');
    expect(trace(r)).toEqual([
      '100 pipe([3, 4]) = 0',
      '100 fork() = 101',
      '101 dup2(4, 1) = 1',
      '101 close(3) = 0',
      '101 close(4) = 0',
      '101 execvp("ls", ["ls", NULL])',
      '100 close(4) = 0',
      '100 fork() = 102',
      '102 dup2(3, 0) = 0',
      '102 close(3) = 0',
      '102 execvp("wc", ["wc", "-l", NULL])',
      '100 close(3) = 0',
      '100 waitpid(101, &status, 0) = …',
      expect.stringMatching(/^101 write\(1, "in\.txt.*, 70\) = 70$/),
      '101 exit(0)',
      '100 waitpid(101, &status, 0) = 101',
      '100 waitpid(102, &status, 0) = …',
      '102 read(0, buf, 4096) = 70',
      '102 read(0, buf, 4096) = 0',
      '102 write(1, "8\\n", 2) = 2',
      '102 exit(0)',
      '100 waitpid(102, &status, 0) = 102',
      '100 write(1, "$ ", 2) = 2',
    ]);
    expect(r.hang).toBe(false);
    expect(screen(r.steps.at(-1)!.state)).toBe('8\n$ ');
    for (const s of r.steps) checkRefcounts(s.state);
  });

  it('refcounts follow fork/dup2/close', () => {
    const r = run('ls | wc -l');
    const ref = (i: number, id: string) => r.steps[i - 1].state.files.find((f) => f.id === id)?.ref ?? 0;
    expect(ref(1, 'tty')).toBe(3);
    expect(ref(2, 'tty')).toBe(6); // fork copies the 3 terminal fds
    expect(ref(2, 'p1w')).toBe(2);
    expect(ref(3, 'tty')).toBe(5); // dup2(4,1) drops ls's terminal stdout
    expect(ref(3, 'p1w')).toBe(3);
    expect(ref(7, 'p1w')).toBe(1); // only ls's stdout is left
    expect(r.steps[2].deltas).toEqual([
      { file: 'p1w', from: 2, to: 3 },
      { file: 'tty', from: 6, to: 5 },
    ]);
    // ls exiting closes the last write end → wc will see EOF
    const exit = r.steps.find((s) => s.kind === 'exit' && s.pid === 101)!;
    expect(exit.note).toMatchObject({ k: 'exit', eofPipes: [1] });
    expect(exit.state.files.some((f) => f.id === 'p1w')).toBe(false);
    expect(r.ttyRefAfterLastFork).toBe(3 + 2 + 3);
    expect(r.shellFdsBeforeWait.map((x) => x.fd)).toEqual([0, 1, 2]);
  });

  it('three stages: grep filters, the shell keeps only 0,1,2 and out.txt gets the count', () => {
    const r = run(PRESETS.three);
    expect(r.hang).toBe(false);
    expect(r.pipeCount).toBe(2);
    const last = r.steps.at(-1)!.state;
    const out = last.objs.find((o) => o.id === 'file:out.txt')!;
    // in.txt, informe.txt, log.txt, notas.txt, out.txt (created by the shell before ls runs), todo.txt
    expect(out.content).toBe('6\n');
    expect(last.procs.map((p) => p.pid)).toEqual([100]);
    expect(last.objs.filter((o) => o.kind === 'pipe')).toEqual([]);
    expect(r.shellFdsBeforeWait.map((x) => x.fd)).toEqual([0, 1, 2]);
    for (const s of r.steps) checkRefcounts(s.state);
    // second pipe reuses fd 4 because the shell closed it
    expect(trace(r)).toContain('100 pipe([4, 5]) = 0');
    // wc opens out.txt, moves it to fd 1, closes the temporary fd
    const t = trace(r);
    const i = t.indexOf('103 open("out.txt", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3');
    expect(t.slice(i, i + 3)).toEqual(['103 open("out.txt", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3', '103 dup2(3, 1) = 1', '103 close(3) = 0']);
  });

  it('sort < in.txt > out.txt sorts the file', () => {
    const r = run(PRESETS.sort);
    const out = r.steps.at(-1)!.state.objs.find((o) => o.id === 'file:out.txt')!;
    expect(out.content).toBe('banana\nkiwi\nmanzana\npera\nuva\n');
    expect(r.pipeCount).toBe(0);
  });

  it('echo hola >> log.txt appends at the end', () => {
    const r = run(PRESETS.append);
    const log = r.steps.at(-1)!.state.objs.find((o) => o.id === 'file:log.txt')!;
    expect(log.content).toBe('shell iniciada\nhola\n');
    const w = r.steps.find((s) => s.kind === 'write' && s.pid === 101)!;
    expect(w.state.files.find((f) => f.obj === 'file:log.txt')!.offset).toBe(20);
  });

  it('cmd 2>&1 | less: stderr follows stdout into the pipe', () => {
    const r = run(PRESETS.stderr);
    const t = trace(r);
    expect(t.slice(2, 7)).toEqual(['101 dup2(4, 1) = 1', '101 close(3) = 0', '101 close(4) = 0', '101 dup2(1, 2) = 2', '101 execvp("cmd", ["cmd", NULL])']);
    expect(screen(r.steps.at(-1)!.state)).toBe("compilando main.c...\nmain.c:3: warning: unused variable 'x'\nlisto\n$ ");
  });

  it('2>&1 > file is not the same as > file 2>&1', () => {
    const a = run('cmd > out.txt 2>&1');
    const b = run('cmd 2>&1 > out.txt');
    const fileOf = (r: ReturnType<typeof run>) => r.steps.at(-1)!.state.objs.find((o) => o.id === 'file:out.txt')!.content;
    expect(fileOf(a)).toContain('warning');
    expect(fileOf(b)).not.toContain('warning');
    expect(screen(b.steps.at(-1)!.state)).toContain('warning');
  });

  it('bug mode: forgetting to close the pipe ends hangs wc', () => {
    const r = run('ls | wc -l', { forgetClose: true });
    expect(r.hang).toBe(true);
    expect(trace(r).filter((t) => t.includes('close('))).toEqual([]);
    const block = r.steps.find((s) => s.note.k === 'block')!;
    expect(block.pid).toBe(102);
    if (block.note.k !== 'block') throw new Error();
    expect(block.note.holders.map((h) => `${h.name}:${h.fd}`)).toEqual(['sh:4', 'wc:4']);
    expect(block.note.self).toBe(true);
    const last = r.steps.at(-1)!;
    expect(last.kind).toBe('hang');
    expect(last.note).toMatchObject({ waitingFor: { pid: 102, name: 'wc' } });
    expect(r.shellFdsBeforeWait.map((x) => x.fd)).toEqual([0, 1, 2, 3, 4]);
    for (const s of r.steps) checkRefcounts(s.state);
  });

  it('bug mode with three stages: grep blocks first, then wc', () => {
    const r = run(PRESETS.three, { forgetClose: true });
    expect(r.hang).toBe(true);
    expect(r.steps.filter((s) => s.note.k === 'block').map((s) => s.who)).toEqual(['grep', 'wc']);
    // ls still finished and was reaped
    expect(trace(r)).toContain('100 waitpid(101, &status, 0) = 101');
  });

  it('redirecting in the parent breaks the shell: the prompt lands in log.txt', () => {
    const r = run(PRESETS.append, { redirectInParent: true });
    const t = trace(r);
    expect(t.slice(0, 4)).toEqual([
      '100 open("log.txt", O_WRONLY|O_CREAT|O_APPEND, 0644) = 3',
      '100 dup2(3, 1) = 1',
      '100 close(3) = 0',
      '100 fork() = 101',
    ]);
    const last = r.steps.at(-1)!;
    expect(last.note).toMatchObject({ k: 'prompt', ok: false });
    expect(last.state.objs.find((o) => o.id === 'file:log.txt')!.content).toBe('shell iniciada\nhola\n$ ');
    expect(screen(last.state)).toBe('');
  });

  it('redirecting in the parent with a pipe: wc inherits the write end on stdout and hangs', () => {
    const r = run('ls | wc -l', { redirectInParent: true });
    expect(r.hang).toBe(true);
    const block = r.steps.find((s) => s.note.k === 'block')!;
    if (block.note.k !== 'block') throw new Error();
    expect(block.note.holders.map((h) => `${h.name}:${h.fd}`)).toEqual(['sh:1', 'wc:1']);
  });

  it('a reader that redirects stdin away leaves the writer with SIGPIPE', () => {
    const r = run('ls | wc -l < in.txt');
    expect(r.steps.some((s) => s.note.k === 'sigpipe' && s.pid === 101)).toBe(true);
    expect(screen(r.steps.at(-1)!.state)).toBe('5\n$ ');
    for (const s of r.steps) checkRefcounts(s.state);
  });

  it('without the data phase there are no read/write steps but the result is the same', () => {
    const a = run(PRESETS.three);
    const b = run(PRESETS.three, { data: false });
    expect(b.steps.some((s) => s.kind === 'read' || s.kind === 'write')).toBe(false);
    expect(b.steps.at(-1)!.state.objs.find((o) => o.id === 'file:out.txt')!.content).toBe('6\n');
    expect(b.steps.length).toBeLessThan(a.steps.length);
    // the hang is still shown
    const h = run('ls | wc -l', { forgetClose: true, data: false });
    expect(h.steps.some((s) => s.note.k === 'block')).toBe(true);
  });

  it('a program reading the terminal gets what was typed, then Ctrl+D', () => {
    const r = run('wc -l');
    expect(screen(r.steps.at(-1)!.state)).toBe('2\n$ ');
  });

  it('stats count syscalls, pipes, open fds and processes', () => {
    const r = run('ls | wc -l');
    expect(r.initialStats).toEqual({ syscalls: 0, pipes: 0, openFds: 3, procs: 1 });
    expect(r.steps[1].stats).toEqual({ syscalls: 2, pipes: 1, openFds: 10, procs: 2 });
    expect(r.steps.at(-1)!.stats).toMatchObject({ syscalls: r.steps.length, openFds: 3, procs: 1 });
  });

  it('every preset and random command parses and never breaks refcounts', () => {
    const cmds = [...Object.values(PRESETS), ...Array.from({ length: 60 }, (_, i) => randomCommand(i))];
    for (const c of cmds) {
      for (const forgetClose of [false, true])
        for (const redirectInParent of [false, true]) {
          const r = run(c, { forgetClose, redirectInParent });
          for (const s of r.steps) checkRefcounts(s.state);
          expect(r.steps.length).toBeLessThan(200);
        }
    }
  });
});

describe('self-feeding pipe', () => {
  it('a filter whose stdin and stdout are the same pipe loops forever (stopped, reported as a hang)', () => {
    const r = run('ls | tr a-z A-Z', { redirectInParent: true });
    expect(r.hang).toBe(true);
    expect(r.steps.some((s) => s.note.k === 'selfLoop')).toBe(true);
  });
});
