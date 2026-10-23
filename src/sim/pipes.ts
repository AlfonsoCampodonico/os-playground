/**
 * How a TP1-style shell builds a pipeline: pipe(), fork(), dup2(), close(),
 * open(), execvp() and waitpid(), with the three kernel levels behind every
 * file descriptor (per-process fd table → open file table → object).
 *
 * Pure TS: `simulatePipes(cfg)` returns the initial snapshot plus one full
 * snapshot per syscall. There is no OSTEP homework simulator for this topic;
 * the sequence mirrors what `strace -f sh -c '…'` shows for a simple shell.
 */
import { PyRandom } from '../lib/pyrandom';

/* ---------------------------------------------------------------- parsing */

export type RedirKind = 'in' | 'out' | 'append' | 'dup';

export interface Redir {
  /** The fd being redirected (0, 1 or 2). */
  fd: number;
  kind: RedirKind;
  path?: string;
  /** For `N>&M`: M. */
  target?: number;
  text: string;
}

export interface Stage {
  argv: string[];
  redirs: Redir[];
  text: string;
}

export type ParseError =
  | { code: 'empty' }
  | { code: 'pipeStart' }
  | { code: 'pipeEnd' }
  | { code: 'emptyStage'; n: number }
  | { code: 'noCommand'; n: number }
  | { code: 'missingFile'; op: string }
  | { code: 'unsupported'; op: string }
  | { code: 'quote' }
  | { code: 'badFd'; fd: number }
  | { code: 'badDup'; op: string }
  | { code: 'tooMany'; max: number };

export type ParseResult = { ok: true; stages: Stage[] } | { ok: false; error: ParseError };

export const MAX_STAGES = 5;

type Tok =
  | { t: 'word'; v: string }
  | { t: 'pipe' }
  | { t: 'redir'; fd: number | null; op: '<' | '>' | '>>' }
  | { t: 'dup'; fd: number | null; target: number };

class ParseFail {
  constructor(public error: ParseError) {}
}
const fail = (error: ParseError): never => {
  throw new ParseFail(error);
};

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  const special = (c: string) => /[\s|&;<>()`]/.test(c);
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '|') {
      if (src[i + 1] === '|') fail({ code: 'unsupported', op: '||' });
      toks.push({ t: 'pipe' });
      i++;
      continue;
    }
    if (c === '&') fail({ code: 'unsupported', op: src[i + 1] === '&' ? '&&' : src[i + 1] === '>' ? '&>' : '&' });
    if (c === ';' || c === '(' || c === ')' || c === '`') fail({ code: 'unsupported', op: c });
    if (c === '$' && src[i + 1] === '(') fail({ code: 'unsupported', op: '$(' });

    // [n]< [n]> [n]>> [n]>&m
    let j = i;
    while (j < n && /\d/.test(src[j])) j++;
    const hasFd = j > i && (src[j] === '<' || src[j] === '>');
    if (hasFd || c === '<' || c === '>') {
      const fd = hasFd ? Number(src.slice(i, j)) : null;
      let k = hasFd ? j : i;
      if (src[k] === '<') {
        if (src[k + 1] === '<') fail({ code: 'unsupported', op: '<<' });
        if (src[k + 1] === '&') fail({ code: 'unsupported', op: '<&' });
        toks.push({ t: 'redir', fd, op: '<' });
        i = k + 1;
      } else if (src[k + 1] === '>') {
        toks.push({ t: 'redir', fd, op: '>>' });
        i = k + 2;
      } else if (src[k + 1] === '&') {
        k += 2;
        let m = k;
        while (m < n && /\d/.test(src[m])) m++;
        if (m === k) fail({ code: 'badDup', op: src.slice(i, k + 1).trim() });
        toks.push({ t: 'dup', fd, target: Number(src.slice(k, m)) });
        i = m;
      } else if (src[k + 1] === '|') {
        fail({ code: 'unsupported', op: '>|' });
      } else {
        toks.push({ t: 'redir', fd, op: '>' });
        i = k + 1;
      }
      continue;
    }

    let v = '';
    while (i < n && !special(src[i])) {
      const ch = src[i];
      if (ch === "'") {
        const e = src.indexOf("'", i + 1);
        if (e < 0) fail({ code: 'quote' });
        v += src.slice(i + 1, e);
        i = e + 1;
      } else if (ch === '"') {
        let e = i + 1;
        while (e < n && src[e] !== '"') {
          if (src[e] === '\\' && e + 1 < n && /["\\$`]/.test(src[e + 1])) {
            v += src[e + 1];
            e += 2;
          } else v += src[e++];
        }
        if (e >= n) fail({ code: 'quote' });
        i = e + 1;
      } else if (ch === '\\') {
        if (i + 1 < n) v += src[i + 1];
        i += 2;
      } else {
        v += ch;
        i++;
      }
    }
    toks.push({ t: 'word', v });
  }
  return toks;
}

const quoteArg = (a: string) => (a === '' || /[\s|&;<>()'"`$\\]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a);

/** Parses `ls -l | grep txt | wc -l > out.txt` into stages with their redirections. */
export function parseCommandLine(src: string): ParseResult {
  try {
    const toks = tokenize(src);
    if (toks.length === 0) fail({ code: 'empty' });
    if (toks[0].t === 'pipe') fail({ code: 'pipeStart' });
    if (toks[toks.length - 1].t === 'pipe') fail({ code: 'pipeEnd' });
    const groups: Tok[][] = [[]];
    for (const tk of toks) {
      if (tk.t === 'pipe') {
        if (groups[groups.length - 1].length === 0) fail({ code: 'emptyStage', n: groups.length });
        groups.push([]);
      } else groups[groups.length - 1].push(tk);
    }
    if (groups.length > MAX_STAGES) fail({ code: 'tooMany', max: MAX_STAGES });
    const stages = groups.map((g, gi): Stage => {
      const argv: string[] = [];
      const redirs: Redir[] = [];
      for (let k = 0; k < g.length; k++) {
        const tk = g[k];
        if (tk.t === 'word') argv.push(tk.v);
        else if (tk.t === 'dup') {
          const fd = tk.fd ?? 1;
          if (fd > 2) fail({ code: 'badFd', fd });
          if (tk.target > 2) fail({ code: 'badFd', fd: tk.target });
          redirs.push({ fd, kind: 'dup', target: tk.target, text: `${fd}>&${tk.target}` });
        } else if (tk.t === 'redir') {
          const fd = tk.fd ?? (tk.op === '<' ? 0 : 1);
          if (fd > 2) fail({ code: 'badFd', fd });
          const next = g[k + 1];
          const opText = `${tk.fd ?? ''}${tk.op}`;
          if (!next || next.t !== 'word') fail({ code: 'missingFile', op: opText });
          const path = (next as { v: string }).v;
          if (path === '') fail({ code: 'missingFile', op: opText });
          k++;
          redirs.push({ fd, kind: tk.op === '<' ? 'in' : tk.op === '>' ? 'out' : 'append', path, text: `${opText} ${quoteArg(path)}` });
        }
      }
      if (argv.length === 0) fail({ code: 'noCommand', n: gi + 1 });
      return { argv, redirs, text: [...argv.map(quoteArg), ...redirs.map((r) => r.text)].join(' ') };
    });
    return { ok: true, stages };
  } catch (e) {
    if (e instanceof ParseFail) return { ok: false, error: e.error };
    throw e;
  }
}

/* ---------------------------------------------------------------- kernel model */

export type ObjKind = 'tty' | 'pipe' | 'file';

/** Level 3: what a file descriptor ultimately reaches. */
export interface KObj {
  id: string;
  kind: ObjKind;
  name: string;
  /** Pipe number (1-based) for pipes. */
  n?: number;
  inode?: number;
  /** Pipe: bytes written and not yet read. */
  buffer: string;
  /** File: contents. */
  content: string;
  /** Terminal: everything printed so far. */
  screen: string;
  /** Terminal: what the user will type (read once, then Ctrl+D). */
  typed: string;
}

/** Level 2: an entry of the kernel's open file table. */
export interface OpenFile {
  id: string;
  obj: string;
  /** Pipe end. */
  end?: 'r' | 'w';
  mode: 'r' | 'w' | 'rw';
  append?: boolean;
  /** Byte offset (files only; terminals and pipes have none). */
  offset: number | null;
  ref: number;
  /** Step that created it (0 = initial). */
  since: number;
  flags?: string;
}

export type ProcState = 'running' | 'blocked' | 'waiting' | 'zombie';

/** Level 1: a process and its fd table (each slot points at an open file id). */
export interface Proc {
  pid: number;
  /** "sh" until execvp, then the program. */
  name: string;
  argv: string[];
  /** Categorical color 1..6 (shell = 1). */
  color: number;
  role: 'shell' | 'child';
  /** Pipeline position (-1 for the shell). */
  stage: number;
  fds: (string | null)[];
  /** Step that last set each fd (for click-to-jump). */
  fdSince: number[];
  state: ProcState;
  execd: boolean;
  /** Shell: pid it is blocked on in waitpid. */
  waitingFor?: number;
}

export interface Snapshot {
  procs: Proc[];
  files: OpenFile[];
  objs: KObj[];
}

export interface Delta {
  file: string;
  from: number;
  to: number;
}

export interface Holder {
  pid: number;
  name: string;
  fd: number;
}

export type Note =
  | { k: 'pipe'; n: number; r: number; w: number }
  | { k: 'fork'; child: number; nfds: number }
  | { k: 'dup2'; oldfd: number; newfd: number; to: string; replaced: string | null; inShell: boolean }
  | { k: 'close'; fd: number; file: string; ref: number; inShell: boolean }
  | { k: 'open'; path: string; fd: number; flags: string; created: boolean; truncated: boolean }
  | { k: 'exec'; prog: string; std: (string | null)[]; extra: { fd: number; file: string }[] }
  | { k: 'waitBlock'; child: number; name: string }
  | { k: 'waitRet'; child: number; name: string; immediate: boolean }
  | { k: 'read'; fd: number; n: number; file: string; tty: boolean }
  | { k: 'eof'; fd: number; file: string; tty: boolean }
  | { k: 'block'; fd: number; file: string; pipe: number; holders: Holder[]; self: boolean }
  | { k: 'selfLoop'; fd: number; file: string; pipe: number }
  | { k: 'write'; fd: number; n: number; file: string }
  | { k: 'sigpipe'; fd: number; file: string; pipe: number }
  | { k: 'ebadf'; fd: number; op: 'read' | 'write' }
  | { k: 'exit'; name: string; closed: number; eofPipes: number[]; signal: boolean }
  | { k: 'prompt'; file: string | null; ok: boolean; stdinOk: boolean }
  | { k: 'hang'; blocked: { pid: number; name: string; pipe: number; holders: Holder[]; loop: boolean }[]; waitingFor: { pid: number; name: string } | null };

export type StepKind = 'pipe' | 'fork' | 'dup2' | 'close' | 'open' | 'exec' | 'wait' | 'read' | 'write' | 'exit' | 'prompt' | 'hang';
export type StepTone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info';

export interface Flow {
  pid: number;
  fd: number;
  dir: 'in' | 'out';
  file: string;
  obj: string;
  bytes: number;
  text: string;
}

export interface Stats {
  syscalls: number;
  pipes: number;
  openFds: number;
  procs: number;
}

export interface Step {
  pid: number;
  /** Process name at the time of the call. */
  who: string;
  color: number;
  kind: StepKind;
  call: string;
  ret: string;
  phase: 'setup' | 'run' | 'end';
  note: Note;
  tone: StepTone;
  /** Refcounts that changed in this step. */
  deltas: Delta[];
  /** fd slots this step touched. */
  fds: { pid: number; fd: number }[];
  flow?: Flow;
  state: Snapshot;
  stats: Stats;
}

export interface FileInfo {
  id: string;
  obj: string;
  end?: 'r' | 'w';
  mode: 'r' | 'w' | 'rw';
  append?: boolean;
}

export interface ObjInfo {
  id: string;
  kind: ObjKind;
  name: string;
  n?: number;
  inode?: number;
}

export interface PipesConfig {
  stages: Stage[];
  /** Bug mode: skip every close() of a pipe end. */
  forgetClose: boolean;
  /** Bug mode: the shell applies redirections to itself before fork(). */
  redirectInParent: boolean;
  /** Show read()/write() steps of the data phase. */
  data: boolean;
}

export interface PipesRun {
  stages: Stage[];
  initial: Snapshot;
  initialStats: Stats;
  steps: Step[];
  fileInfo: Record<string, FileInfo>;
  objInfo: Record<string, ObjInfo>;
  hang: boolean;
  /** 1-based index of the first waitpid() step. */
  firstWait: number;
  /** Shell fds open right before the first waitpid(). */
  shellFdsBeforeWait: { fd: number; file: string }[];
  /** Terminal refcount right after the last fork(). */
  ttyRefAfterLastFork: number;
  pipeCount: number;
}

export const SHELL_PID = 100;
export const TTY_PATH = '/dev/pts/0';
export const TTY_TYPED = 'hola\nchau\n';

/** The fake working directory every simulation starts from. */
export const FS0: readonly [string, string][] = [
  ['Makefile', 'shell: shell.c\n\tgcc -Wall -o shell shell.c\n'],
  ['in.txt', 'pera\nbanana\nmanzana\nkiwi\nuva\n'],
  ['informe.txt', 'Informe TP1: shell\nGrupo 7\n'],
  ['log.txt', 'shell iniciada\n'],
  ['main.c', '#include <stdio.h>\nint main(void) { puts("hola"); return 0; }\n'],
  ['notas.txt', 'fork duplica la tabla de fds\nexec la conserva\n'],
  ['shell.c', '#include <unistd.h>\n/* runcmd, exec_cmd, parsing */\n'],
  ['todo.txt', 'cerrar los extremos del pipe\n'],
];

const enc = new TextEncoder();
const dec = new TextDecoder();
export const byteLen = (s: string) => enc.encode(s).length;

const splitLines = (s: string) => (s === '' ? [] : (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n'));
const unlines = (ls: string[]) => ls.map((l) => l + '\n').join('');
const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);

/* ---------------------------------------------------------------- programs */

interface Out {
  fd: number;
  text: string;
}

interface Program {
  reads: boolean;
  stream: boolean;
  produce: () => Out[];
  chunk: (s: string) => string;
  finish: (acc: string) => string;
}

interface ProgEnv {
  fs: Map<string, string>;
  stdinTty: boolean;
  stdoutTty: boolean;
}

function expandSet(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i + 1] === '-' && i + 2 < s.length) {
      for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c);
      i += 2;
    } else out += s[i];
  }
  return out;
}

function makeProgram(argv: string[], env: ProgEnv): Program {
  const name = argv[0].split('/').pop()!;
  const rest = argv.slice(1);
  const flags = rest.filter((a) => a.startsWith('-') && a.length > 1);
  const args = rest.filter((a) => !(a.startsWith('-') && a.length > 1));
  const has = (f: string) => flags.some((x) => x === `-${f}` || (/^-[a-z]+$/i.test(x) && x.includes(f)));
  const id = (s: string) => s;
  const producer = (produce: () => Out[]): Program => ({ reads: false, stream: false, produce, chunk: id, finish: id });
  const filter = (stream: boolean, chunk: (s: string) => string, finish: (acc: string) => string = () => ''): Program => ({ reads: true, stream, produce: () => [], chunk, finish });
  /** A filter given file arguments reads them itself instead of stdin. */
  const withFiles = (fn: (input: string) => string): Program | null => {
    if (args.length === 0) return null;
    return producer(() => {
      const outs: Out[] = [];
      let input = '';
      for (const f of args) {
        const c = env.fs.get(f);
        if (c === undefined) outs.push({ fd: 2, text: `${name}: ${f}: No such file or directory\n` });
        else input += c;
      }
      const o = fn(input);
      return o ? [{ fd: 1, text: o }, ...outs] : outs;
    });
  };
  const nArg = (def: number) => {
    const i = rest.indexOf('-n');
    if (i >= 0 && rest[i + 1] && /^\d+$/.test(rest[i + 1])) return Number(rest[i + 1]);
    const short = flags.find((f) => /^-\d+$/.test(f));
    return short ? Number(short.slice(1)) : def;
  };

  switch (name) {
    case 'ls':
      return producer(() => {
        const all = [...env.fs.keys()].sort(byName);
        const wanted = args.length ? args : all;
        const outs: Out[] = [];
        const names = wanted.filter((f) => {
          if (env.fs.has(f)) return true;
          outs.push({ fd: 2, text: `ls: cannot access '${f}': No such file or directory\n` });
          return false;
        });
        if (has('l')) {
          const lines = names.map((f) => `-rw-r--r-- 1 alumno alumno ${String(byteLen(env.fs.get(f) ?? '')).padStart(4)} Oct 21 18:03 ${f}`);
          const text = unlines([...(args.length ? [] : [`total ${names.length * 4}`]), ...lines]);
          return [{ fd: 1, text }, ...outs];
        }
        if (names.length === 0) return outs;
        return [{ fd: 1, text: env.stdoutTty ? names.join('  ') + '\n' : unlines(names) }, ...outs];
      });
    case 'echo': {
      const noNl = rest[0] === '-n';
      const words = noNl ? rest.slice(1) : rest;
      return producer(() => [{ fd: 1, text: words.join(' ') + (noNl ? '' : '\n') }]);
    }
    case 'cmd':
      return producer(() => [
        { fd: 1, text: 'compilando main.c...\n' },
        { fd: 2, text: "main.c:3: warning: unused variable 'x'\n" },
        { fd: 1, text: 'listo\n' },
      ]);
    case 'cat':
      return withFiles(id) ?? filter(true, id);
    case 'less':
    case 'more':
      return filter(true, id);
    case 'grep': {
      const pattern = args[0];
      if (pattern === undefined) return producer(() => [{ fd: 2, text: 'Usage: grep [OPTION]... PATTERNS [FILE]...\n' }]);
      const ci = has('i');
      const inv = has('v');
      const count = has('c');
      const match = (l: string) => (ci ? l.toLowerCase().includes(pattern.toLowerCase()) : l.includes(pattern)) !== inv;
      const run = (s: string) => unlines(splitLines(s).filter(match));
      const files = args.slice(1);
      if (files.length) {
        return producer(() => {
          const input = files.map((f) => env.fs.get(f) ?? '').join('');
          return [{ fd: 1, text: count ? `${splitLines(input).filter(match).length}\n` : run(input) }];
        });
      }
      return count ? filter(false, id, (acc) => `${splitLines(acc).filter(match).length}\n`) : filter(true, run);
    }
    case 'wc': {
      const fmt = (s: string, file?: string) => {
        const l = (s.match(/\n/g) ?? []).length;
        const w = s.split(/\s+/).filter(Boolean).length;
        const c = byteLen(s);
        const sel = [has('l') && l, has('w') && w, has('c') && c].filter((x) => x !== false) as number[];
        const nums = sel.length === 1 ? [String(sel[0])] : (sel.length ? sel : [l, w, c]).map((x) => String(x).padStart(7));
        return nums.join(' ') + (file ? ` ${file}` : '') + '\n';
      };
      if (args.length) return producer(() => [{ fd: 1, text: args.map((f) => fmt(env.fs.get(f) ?? '', f)).join('') }]);
      return filter(false, id, (acc) => fmt(acc));
    }
    case 'sort': {
      const run = (s: string) => {
        let ls = splitLines(s);
        ls = has('n') ? ls.sort((a, b) => parseFloat(a) - parseFloat(b) || byName(a, b)) : ls.sort(byName);
        if (has('r')) ls.reverse();
        return unlines(ls);
      };
      return withFiles(run) ?? filter(false, id, run);
    }
    case 'uniq': {
      const run = (s: string) => unlines(splitLines(s).filter((l, i, a) => i === 0 || a[i - 1] !== l));
      return withFiles(run) ?? filter(false, id, run);
    }
    case 'head': {
      const run = (s: string) => unlines(splitLines(s).slice(0, nArg(10)));
      return withFiles(run) ?? filter(false, id, run);
    }
    case 'tail': {
      const run = (s: string) => {
        const k = nArg(10);
        const ls = splitLines(s);
        return unlines(ls.slice(Math.max(0, ls.length - k)));
      };
      return withFiles(run) ?? filter(false, id, run);
    }
    case 'tr': {
      const from = expandSet(args[0] ?? '');
      const to = expandSet(args[1] ?? '');
      const map = (s: string) => [...s].map((ch) => (from.includes(ch) ? (to[Math.min(from.indexOf(ch), to.length - 1)] ?? ch) : ch)).join('');
      return filter(true, map);
    }
    default:
      return env.stdinTty ? producer(() => [{ fd: 1, text: `${name}: hola desde ${name}\n` }]) : filter(true, id);
  }
}

/* ---------------------------------------------------------------- simulation */

interface Runner {
  pid: number;
  prog: Program | null;
  pc: 'start' | 'read' | 'flush' | 'done';
  queue: Out[];
  acc: string;
  blocked: boolean;
  /** Reading back its own output from a pipe (stdin and stdout on the same pipe). */
  looping: boolean;
  selfReads: number;
}

const O_FLAGS: Record<'in' | 'out' | 'append', string> = {
  in: 'O_RDONLY',
  out: 'O_WRONLY|O_CREAT|O_TRUNC',
  append: 'O_WRONLY|O_CREAT|O_APPEND',
};

const preview = (s: string, max = 14) => {
  const esc = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/"/g, '\\"');
  return esc.length > max ? esc.slice(0, max) + '"…' : esc + '"';
};

class Kernel {
  procs: Proc[] = [];
  files: OpenFile[] = [];
  objs: KObj[] = [];
  fs: Map<string, string>;
  steps: Step[] = [];
  fileInfo: Record<string, FileInfo> = {};
  objInfo: Record<string, ObjInfo> = {};
  syscalls = 0;
  pipes = 0;
  private deltas = new Map<string, Delta>();
  private touched: { pid: number; fd: number }[] = [];
  private nextFile = 1;
  private nextPid = SHELL_PID + 1;
  private nextInode = 2400;
  private inodes = new Map<string, number>();
  /** Last pid that wrote into each pipe. */
  private lastWriter = new Map<string, number>();

  constructor(private showData: boolean) {
    this.fs = new Map(FS0);
    [...this.fs.keys()].sort(byName).forEach((f, i) => this.inodes.set(f, 2311 + i));
    this.addObj({ id: 'tty', kind: 'tty', name: TTY_PATH, buffer: '', content: '', screen: '', typed: TTY_TYPED });
    this.addFile({ id: 'tty', obj: 'tty', mode: 'rw', offset: null, ref: 3, since: 0, flags: 'O_RDWR' });
    this.procs.push({
      pid: SHELL_PID,
      name: 'sh',
      argv: ['sh'],
      color: 1,
      role: 'shell',
      stage: -1,
      fds: ['tty', 'tty', 'tty'],
      fdSince: [0, 0, 0],
      state: 'running',
      execd: true,
    });
  }

  /** 1-based index of the step being built. */
  get idx() {
    return this.steps.length + 1;
  }

  snapshot(): Snapshot {
    return structuredClone({ procs: this.procs, files: this.files, objs: this.objs });
  }

  stats(): Stats {
    return {
      syscalls: this.syscalls,
      pipes: this.pipes,
      openFds: this.procs.reduce((a, p) => a + p.fds.filter(Boolean).length, 0),
      procs: this.procs.length,
    };
  }

  proc(pid: number): Proc {
    const p = this.procs.find((x) => x.pid === pid);
    if (!p) throw new Error(`no pid ${pid}`);
    return p;
  }
  file(id: string): OpenFile | undefined {
    return this.files.find((f) => f.id === id);
  }
  obj(id: string): KObj {
    return this.objs.find((o) => o.id === id)!;
  }

  private addObj(o: KObj) {
    this.objs.push(o);
    this.objInfo[o.id] = { id: o.id, kind: o.kind, name: o.name, n: o.n, inode: o.inode };
  }
  private addFile(f: OpenFile) {
    this.files.push(f);
    this.fileInfo[f.id] = { id: f.id, obj: f.obj, end: f.end, mode: f.mode, append: f.append };
  }

  /** Changes a refcount, recording it for this step and freeing at zero. */
  bump(id: string, d: number) {
    const f = this.file(id)!;
    const prev = this.deltas.get(id);
    const from = prev ? prev.from : f.ref;
    f.ref += d;
    this.deltas.set(id, { file: id, from, to: f.ref });
    if (f.ref <= 0) {
      this.files = this.files.filter((x) => x.id !== id);
      const o = this.obj(f.obj);
      if (o.kind === 'pipe' && !this.files.some((x) => x.obj === o.id)) this.objs = this.objs.filter((x) => x.id !== o.id);
    }
  }

  touch(pid: number, fd: number) {
    this.touched.push({ pid, fd });
  }

  setFd(p: Proc, fd: number, file: string | null) {
    while (p.fds.length <= fd) {
      p.fds.push(null);
      p.fdSince.push(this.idx);
    }
    p.fds[fd] = file;
    p.fdSince[fd] = this.idx;
    if (file === null) while (p.fds.length > 3 && p.fds[p.fds.length - 1] === null) {
      p.fds.pop();
      p.fdSince.pop();
    }
    this.touch(p.pid, fd);
  }

  lowestFd(p: Proc): number {
    const i = p.fds.indexOf(null);
    return i === -1 ? p.fds.length : i;
  }

  emit(pid: number, kind: StepKind, call: string, ret: string, note: Note, tone: StepTone, phase: Step['phase'], extra: { flow?: Flow; silent?: boolean } = {}) {
    const p = this.procs.find((x) => x.pid === pid);
    if (extra.silent) {
      this.deltas.clear();
      this.touched = [];
      return;
    }
    if (kind !== 'hang') this.syscalls++;
    this.steps.push({
      pid,
      who: p?.name ?? '?',
      color: p?.color ?? 1,
      kind,
      call,
      ret,
      phase,
      note,
      tone,
      deltas: [...this.deltas.values()],
      fds: this.touched,
      flow: extra.flow,
      state: this.snapshot(),
      stats: this.stats(),
    });
    this.deltas.clear();
    this.touched = [];
  }

  /* --- setup syscalls --- */

  pipe(pid: number): [number, number, number] {
    const p = this.proc(pid);
    const n = ++this.pipes;
    const oid = `pipe${n}`;
    this.addObj({ id: oid, kind: 'pipe', name: `pipe ${n}`, n, inode: 51200 + n, buffer: '', content: '', screen: '', typed: '' });
    const r = `p${n}r`;
    const w = `p${n}w`;
    this.addFile({ id: r, obj: oid, end: 'r', mode: 'r', offset: null, ref: 0, since: this.idx, flags: 'O_RDONLY' });
    this.addFile({ id: w, obj: oid, end: 'w', mode: 'w', offset: null, ref: 0, since: this.idx, flags: 'O_WRONLY' });
    const rfd = this.lowestFd(p);
    this.setFd(p, rfd, r);
    this.bump(r, 1);
    const wfd = this.lowestFd(p);
    this.setFd(p, wfd, w);
    this.bump(w, 1);
    this.emit(pid, 'pipe', `pipe([${rfd}, ${wfd}])`, '0', { k: 'pipe', n, r: rfd, w: wfd }, 'info', 'setup');
    return [rfd, wfd, n];
  }

  fork(pid: number, stage: number, argv: string[]): number {
    const parent = this.proc(pid);
    const child: Proc = {
      pid: this.nextPid++,
      name: parent.name,
      argv,
      color: Math.min(6, stage + 2),
      role: 'child',
      stage,
      fds: [...parent.fds],
      fdSince: parent.fds.map(() => this.idx),
      state: 'running',
      execd: false,
    };
    this.procs.push(child);
    child.fds.forEach((f, fd) => {
      if (f) {
        this.bump(f, 1);
        this.touch(child.pid, fd);
      }
    });
    this.emit(pid, 'fork', 'fork()', String(child.pid), { k: 'fork', child: child.pid, nfds: child.fds.filter(Boolean).length }, 'info', 'setup');
    return child.pid;
  }

  dup2(pid: number, oldfd: number, newfd: number) {
    const p = this.proc(pid);
    const to = p.fds[oldfd];
    if (!to) throw new Error('dup2 of closed fd');
    const replaced = p.fds[newfd] ?? null;
    if (oldfd !== newfd) {
      this.bump(to, 1);
      this.setFd(p, newfd, to);
      if (replaced) this.bump(replaced, -1);
    }
    const inShell = p.role === 'shell';
    this.emit(pid, 'dup2', `dup2(${oldfd}, ${newfd})`, String(newfd), { k: 'dup2', oldfd, newfd, to, replaced, inShell }, inShell ? 'warn' : 'info', 'setup');
  }

  close(pid: number, fd: number) {
    const p = this.proc(pid);
    const f = p.fds[fd];
    if (!f) throw new Error('close of closed fd');
    this.setFd(p, fd, null);
    this.bump(f, -1);
    this.emit(pid, 'close', `close(${fd})`, '0', { k: 'close', fd, file: f, ref: this.file(f)?.ref ?? 0, inShell: p.role === 'shell' }, 'neutral', 'setup');
  }

  open(pid: number, path: string, kind: 'in' | 'out' | 'append'): number {
    const p = this.proc(pid);
    const oid = `file:${path}`;
    const exists = this.fs.has(path);
    if (!exists) this.fs.set(path, '');
    if (!this.inodes.has(path)) this.inodes.set(path, this.nextInode++);
    let o = this.objs.find((x) => x.id === oid);
    if (!o) {
      o = { id: oid, kind: 'file', name: path, inode: this.inodes.get(path), buffer: '', content: this.fs.get(path)!, screen: '', typed: '' };
      this.addObj(o);
    }
    const truncated = kind === 'out' && o.content !== '';
    if (kind === 'out') {
      o.content = '';
      this.fs.set(path, '');
    }
    const id = `f${this.nextFile++}`;
    const flags = O_FLAGS[kind];
    this.addFile({ id, obj: oid, mode: kind === 'in' ? 'r' : 'w', append: kind === 'append', offset: 0, ref: 0, since: this.idx, flags });
    const fd = this.lowestFd(p);
    this.setFd(p, fd, id);
    this.bump(id, 1);
    const call = kind === 'in' ? `open("${path}", ${flags})` : `open("${path}", ${flags}, 0644)`;
    this.emit(pid, 'open', call, String(fd), { k: 'open', path, fd, flags, created: !exists && kind !== 'in', truncated }, 'info', 'setup');
    return fd;
  }

  exec(pid: number) {
    const p = this.proc(pid);
    p.name = p.argv[0];
    p.execd = true;
    const extra = p.fds.map((file, fd) => ({ fd, file })).filter((x) => x.fd > 2 && x.file) as { fd: number; file: string }[];
    const args = p.argv.map((a) => `"${a}"`).join(', ');
    this.emit(pid, 'exec', `execvp("${p.argv[0]}", [${args}, NULL])`, '', { k: 'exec', prog: p.argv[0], std: p.fds.slice(0, 3).map((f) => f ?? null), extra }, extra.length ? 'warn' : 'ok', 'setup');
  }

  /* --- data phase --- */

  writersOf(pipeObj: string): Holder[] {
    const w = this.files.find((f) => f.obj === pipeObj && f.end === 'w');
    if (!w) return [];
    const out: Holder[] = [];
    for (const p of this.procs) p.fds.forEach((f, fd) => f === w.id && out.push({ pid: p.pid, name: p.name, fd }));
    return out;
  }

  write(pid: number, fd: number, text: string): 'ok' | 'killed' {
    const p = this.proc(pid);
    const n = byteLen(text);
    const call = `write(${fd}, "${preview(text)}, ${n})`;
    const fid = p.fds[fd];
    const f = fid ? this.file(fid) : undefined;
    if (!f || f.mode === 'r') {
      this.emit(pid, 'write', call, '-1 EBADF', { k: 'ebadf', fd, op: 'write' }, 'bad', 'run');
      return 'ok';
    }
    const o = this.obj(f.obj);
    if (o.kind === 'pipe' && !this.files.some((x) => x.obj === o.id && x.end === 'r')) {
      this.emit(pid, 'write', call, '-1 EPIPE', { k: 'sigpipe', fd, file: f.id, pipe: o.n! }, 'bad', 'run');
      this.exit(pid, true);
      return 'killed';
    }
    if (o.kind === 'tty') o.screen += text;
    else if (o.kind === 'pipe') {
      o.buffer += text;
      this.lastWriter.set(o.id, pid);
    } else {
      const bytes = enc.encode(o.content);
      const off = f.append ? bytes.length : f.offset!;
      const add = enc.encode(text);
      const out = new Uint8Array(Math.max(bytes.length, off + add.length));
      out.set(bytes);
      out.set(add, off);
      o.content = dec.decode(out);
      f.offset = off + add.length;
      this.fs.set(o.name, o.content);
    }
    this.touch(pid, fd);
    this.emit(pid, 'write', call, String(n), { k: 'write', fd, n, file: f.id }, 'neutral', 'run', {
      flow: { pid, fd, dir: 'out', file: f.id, obj: o.id, bytes: n, text },
      silent: !this.showData,
    });
    return 'ok';
  }

  /** Returns the data read, '' at EOF, or null if the call blocks. */
  read(r: Runner): string | null {
    const p = this.proc(r.pid);
    const fid = p.fds[0];
    const f = fid ? this.file(fid) : undefined;
    const call = 'read(0, buf, 4096)';
    const unblock = () => {
      r.blocked = false;
      p.state = 'running';
    };
    if (!f || f.mode === 'w') {
      unblock();
      this.emit(r.pid, 'read', call, '-1 EBADF', { k: 'ebadf', fd: 0, op: 'read' }, 'bad', 'run');
      return '';
    }
    const o = this.obj(f.obj);
    const got = (data: string, tty = false) => {
      unblock();
      const n = byteLen(data);
      this.touch(r.pid, 0);
      this.emit(r.pid, 'read', call, String(n), { k: 'read', fd: 0, n, file: f.id, tty }, 'neutral', 'run', {
        flow: { pid: r.pid, fd: 0, dir: 'in', file: f.id, obj: o.id, bytes: n, text: data },
        silent: !this.showData,
      });
      return data;
    };
    const eof = (tty = false) => {
      unblock();
      this.touch(r.pid, 0);
      this.emit(r.pid, 'read', call, '0', { k: 'eof', fd: 0, file: f.id, tty }, 'ok', 'run', { silent: !this.showData });
      return '';
    };
    if (o.kind === 'tty') {
      if (o.typed) {
        const d = o.typed;
        o.typed = '';
        return got(d, true);
      }
      return eof(true);
    }
    if (o.kind === 'pipe') {
      if (o.buffer) {
        if (this.lastWriter.get(o.id) === r.pid && ++r.selfReads >= 2) {
          r.looping = true;
          this.touch(r.pid, 0);
          this.emit(r.pid, 'read', call, String(byteLen(o.buffer)), { k: 'selfLoop', fd: 0, file: f.id, pipe: o.n! }, 'bad', 'run');
          return null;
        }
        const d = o.buffer;
        o.buffer = '';
        return got(d);
      }
      const holders = this.writersOf(o.id);
      if (holders.length === 0) return eof();
      if (!r.blocked) {
        r.blocked = true;
        p.state = 'blocked';
        this.touch(r.pid, 0);
        this.emit(r.pid, 'read', call, '…', { k: 'block', fd: 0, file: f.id, pipe: o.n!, holders, self: holders.some((h) => h.pid === r.pid) }, 'bad', 'run');
      }
      return null;
    }
    const bytes = enc.encode(o.content);
    const off = f.offset ?? 0;
    if (off >= bytes.length) return eof();
    f.offset = bytes.length;
    return got(dec.decode(bytes.slice(off)));
  }

  exit(pid: number, signal = false) {
    const p = this.proc(pid);
    let closed = 0;
    const eofPipes: number[] = [];
    p.fds.forEach((f, fd) => {
      if (!f) return;
      closed++;
      this.touch(pid, fd);
      const info = this.fileInfo[f];
      this.bump(f, -1);
      if (info.end === 'w' && !this.file(f)) eofPipes.push(this.objInfo[info.obj].n!);
    });
    p.fds = [];
    p.fdSince = [];
    p.state = 'zombie';
    this.emit(pid, 'exit', signal ? 'SIGPIPE' : 'exit(0)', '', { k: 'exit', name: p.name, closed, eofPipes: [...new Set(eofPipes)], signal }, signal ? 'bad' : 'neutral', 'run');
  }
}

/** Full syscall trace of a TP1-style shell running the given pipeline. */
export function simulatePipes(cfg: PipesConfig): PipesRun {
  const k = new Kernel(cfg.data);
  const initial = k.snapshot();
  const initialStats = k.stats();
  const { stages, forgetClose, redirectInParent } = cfg;
  const sh = SHELL_PID;
  const n = stages.length;
  const children: number[] = [];
  let prevRead = -1;
  let lastFork = 0;

  const applyRedirs = (pid: number, st: Stage) => {
    for (const r of st.redirs) {
      if (r.kind === 'dup') {
        if (k.proc(pid).fds[r.target!]) k.dup2(pid, r.target!, r.fd);
        continue;
      }
      const fd = k.open(pid, r.path!, r.kind);
      if (fd !== r.fd) {
        k.dup2(pid, fd, r.fd);
        k.close(pid, fd);
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const st = stages[i];
    const last = i === n - 1;
    let r = -1;
    let w = -1;
    if (!last) [r, w] = k.pipe(sh);

    if (redirectInParent) {
      if (prevRead !== -1) {
        k.dup2(sh, prevRead, 0);
        if (!forgetClose) k.close(sh, prevRead);
      }
      if (!last) {
        k.dup2(sh, w, 1);
        if (!forgetClose) k.close(sh, w);
      }
      applyRedirs(sh, st);
    }

    const child = k.fork(sh, i, st.argv);
    lastFork = k.steps.length;
    children.push(child);

    if (!redirectInParent) {
      if (prevRead !== -1) {
        k.dup2(child, prevRead, 0);
        if (!forgetClose) k.close(child, prevRead);
      }
      if (!last) {
        k.dup2(child, w, 1);
        if (!forgetClose) {
          k.close(child, r);
          k.close(child, w);
        }
      }
      applyRedirs(child, st);
    } else if (!last && !forgetClose) {
      k.close(child, r);
    }
    k.exec(child);

    if (!redirectInParent && !forgetClose) {
      if (prevRead !== -1) k.close(sh, prevRead);
      if (!last) k.close(sh, w);
    }
    if (!last) prevRead = r;
  }

  const ttyRefAfterLastFork = lastFork > 0 ? (k.steps[lastFork - 1].state.files.find((f) => f.id === 'tty')?.ref ?? 0) : 0;

  // Shell blocks in waitpid() for each child, in order.
  const waitQueue = [...children];
  const shell = k.proc(sh);
  const shellCheck = () => {
    while (waitQueue.length) {
      const target = waitQueue[0];
      const c = k.procs.find((p) => p.pid === target);
      if (c && c.state !== 'zombie') {
        if (shell.waitingFor !== target) {
          shell.waitingFor = target;
          shell.state = 'waiting';
          k.emit(sh, 'wait', `waitpid(${target}, &status, 0)`, '…', { k: 'waitBlock', child: target, name: c.name }, 'neutral', 'run');
        }
        return;
      }
      const immediate = shell.waitingFor !== target;
      const name = c?.name ?? '?';
      k.procs = k.procs.filter((p) => p.pid !== target);
      waitQueue.shift();
      shell.waitingFor = undefined;
      shell.state = 'running';
      k.emit(sh, 'wait', `waitpid(${target}, &status, 0)`, String(target), { k: 'waitRet', child: target, name, immediate }, 'ok', 'run');
    }
  };
  const shellFdsBeforeWait = shell.fds.map((file, fd) => ({ fd, file })).filter((x) => x.file) as { fd: number; file: string }[];
  shellCheck();
  const firstWait = k.steps.length;

  // Data phase: each program runs until it exits or blocks; repeat while anyone progresses.
  const runners: Runner[] = children.map((pid) => ({ pid, prog: null, pc: 'start', queue: [], acc: '', blocked: false, looping: false, selfReads: 0 }));
  const isTty = (p: Proc, fd: number) => {
    const f = p.fds[fd] ? k.file(p.fds[fd]!) : undefined;
    return f?.obj === 'tty';
  };
  const runOne = (r: Runner): 'progress' | 'stuck' => {
    if (r.pc === 'done' || r.looping || k.steps.length > 400) return 'stuck';
    const p = k.proc(r.pid);
    if (r.pc === 'start') {
      r.prog = makeProgram(p.argv, { fs: k.fs, stdinTty: isTty(p, 0), stdoutTty: isTty(p, 1) });
      if (r.prog.reads) r.pc = 'read';
      else {
        r.queue.push(...r.prog.produce());
        r.pc = 'flush';
      }
    }
    const prog = r.prog!;
    if (r.queue.length) {
      const o = r.queue.shift()!;
      if (k.write(r.pid, o.fd, o.text) === 'killed') {
        r.pc = 'done';
        shellCheck();
      }
      return 'progress';
    }
    if (r.pc === 'read') {
      const d = k.read(r);
      if (d === null) return 'stuck';
      if (d === '') {
        const out = prog.stream ? prog.finish('') : prog.finish(r.acc);
        if (out) r.queue.push({ fd: 1, text: out });
        r.pc = 'flush';
      } else if (prog.stream) {
        const out = prog.chunk(d);
        if (out) r.queue.push({ fd: 1, text: out });
      } else r.acc += d;
      return 'progress';
    }
    // flush done → exit
    k.exit(r.pid);
    r.pc = 'done';
    shellCheck();
    return 'progress';
  };
  let progress = true;
  let guard = 0;
  while (progress && guard++ < 200) {
    progress = false;
    for (const r of runners) while (runOne(r) === 'progress') progress = true;
  }

  let hang = false;
  if (waitQueue.length === 0) {
    // Back at the prompt: where does the shell's own stdout go now?
    const fid = shell.fds[1] ?? null;
    const f = fid ? k.file(fid) : undefined;
    const ok = f?.obj === 'tty';
    const stdinOk = shell.fds[0] === 'tty';
    if (f) {
      const o = k.obj(f.obj);
      if (o.kind === 'tty') o.screen += '$ ';
      else if (o.kind === 'pipe') o.buffer += '$ ';
      else {
        o.content += '$ ';
        if (f.offset !== null) f.offset += 2;
        k.fs.set(o.name, o.content);
      }
      k.touch(sh, 1);
    }
    k.emit(sh, 'prompt', 'write(1, "$ ", 2)', f ? '2' : '-1 EBADF', { k: 'prompt', file: fid, ok, stdinOk }, ok && stdinOk ? 'ok' : 'bad', 'end', {
      flow: f ? { pid: sh, fd: 1, dir: 'out', file: fid!, obj: f.obj, bytes: 2, text: '$ ' } : undefined,
    });
  } else {
    hang = true;
    const blocked = runners
      .filter((r) => r.blocked || r.looping)
      .map((r) => {
        const p = k.proc(r.pid);
        const f = k.file(p.fds[0]!)!;
        const o = k.obj(f.obj);
        return { pid: p.pid, name: p.name, pipe: o.n ?? 0, holders: k.writersOf(o.id), loop: r.looping };
      });
    const wf = waitQueue[0];
    const wp = k.procs.find((p) => p.pid === wf);
    k.emit(sh, 'hang', `waitpid(${wf}, &status, 0)`, '…', { k: 'hang', blocked, waitingFor: wp ? { pid: wf, name: wp.name } : null }, 'bad', 'end');
  }

  return {
    stages,
    initial,
    initialStats,
    steps: k.steps,
    fileInfo: k.fileInfo,
    objInfo: k.objInfo,
    hang,
    firstWait,
    shellFdsBeforeWait,
    ttyRefAfterLastFork,
    pipeCount: k.pipes,
  };
}

/** The same thing on a real Linux box. */
export function straceCommand(cmd: string): string {
  const q = cmd.trim().replace(/'/g, `'\\''`);
  return `strace -f -e trace=pipe,pipe2,clone,fork,dup2,close,openat,execve,wait4 sh -c '${q}'`;
}

export const PRESETS = {
  simple: 'ls | wc -l',
  three: 'ls -l | grep txt | wc -l > out.txt',
  sort: 'sort < in.txt > out.txt',
  stderr: 'cmd 2>&1 | less',
  append: 'echo hola >> log.txt',
} as const;

export type PresetId = keyof typeof PRESETS;

/** A plausible command line for the "random problem" button. */
export function randomCommand(seed: number): string {
  const r = new PyRandom(seed);
  const producers = ['ls', 'ls -l', 'echo hola mundo', 'cat in.txt', 'cmd'];
  const filters = ['grep txt', 'grep -v a', 'sort', 'sort -r', 'wc -l', 'head -n 3', 'tr a-z A-Z', 'uniq', 'wc'];
  const stages = r.randint(1, 3);
  let first = r.random() < 0.25 ? `${r.choice(['sort', 'grep an', 'wc -l', 'tr a-z A-Z'])} < in.txt` : r.choice(producers);
  if (first === 'cmd' && r.random() < 0.6) first += ' 2>&1';
  const parts = [first];
  for (let i = 1; i < stages; i++) parts.push(r.choice(filters));
  return parts.join(' | ') + r.choice(['', '', ' > out.txt', ' >> log.txt', ' 2> err.txt']);
}
