import { PyRandom } from '../lib/pyrandom';

/**
 * vsfs — the Very Simple File System of OSTEP ch. 40, ported from
 * `file-implementation/vsfs.py`: an inode bitmap, an inode table, a data
 * bitmap and data blocks. Directories are one block holding `(name, inum)`
 * entries; files hold at most one block of data (a single character).
 * The random workload generator reproduces vsfs.py's `-s seed` problems
 * exactly (same PyRandom call order).
 */

export type FType = 'd' | 'f';

export interface Inode {
  /** null = free. */
  type: FType | null;
  /** Data block, -1 if none. */
  addr: number;
  /** Reference (link) count. */
  refs: number;
}

export interface Block {
  /** null = free. */
  type: FType | null;
  /** Directory entries `(name, inum)` (directories only). */
  entries: [string, number][];
  /** File contents (files only). */
  data: string;
}

export interface FsState {
  ibitmap: number[];
  inodes: Inode[];
  dbitmap: number[];
  blocks: Block[];
}

export type Op =
  | { kind: 'mkdir' | 'creat' | 'unlink'; path: string }
  | { kind: 'write'; path: string; data: string }
  | { kind: 'link'; target: string; path: string };

export type OpKind = Op['kind'];

export type FsErrorCode =
  | 'EINVAL' // malformed path / operating on "/", ".", ".."
  | 'ENOENT' // a component (or the target) doesn't exist
  | 'ENOTDIR' // a component in the middle is a file
  | 'EEXIST' // name already in the directory
  | 'EISDIR' // link/unlink/write on a directory (vsfs only does these on files)
  | 'DIRFULL' // the parent's single block already holds 32 entries
  | 'NOINODE' // no free inode
  | 'NOBLOCK' // no free data block
  | 'FILEFULL'; // vsfs files hold one block: the file already has data

export interface FsError {
  code: FsErrorCode;
  /** Path (or path prefix) where it failed. */
  at: string;
}

export type Effect =
  | { k: 'ibit'; i: number; to: number }
  | { k: 'ialloc'; i: number; type: FType }
  | { k: 'ifree'; i: number }
  | { k: 'refs'; i: number; from: number; to: number }
  | { k: 'addr'; i: number; from: number; to: number }
  | { k: 'dbit'; b: number; to: number }
  | { k: 'entry'; b: number; name: string; inum: number; add: boolean }
  | { k: 'data'; b: number; data: string; add: boolean };

export interface FsStep {
  op: Op;
  ok: boolean;
  error?: FsError;
  /** State after the op (unchanged if it failed). */
  state: FsState;
  effects: Effect[];
  /** 'gen' = from vsfs.py's random generator; 'user' = appended by hand. */
  source: 'gen' | 'user';
}

export interface FsConfig {
  seed: number;
  numInodes: number;
  numData: number;
  /** Random requests from vsfs.py's generator (-n). 0 = only your own ops. */
  numRequests: number;
  /** Ops appended after the generated ones. */
  ops: Op[];
}

export interface FsRun {
  initial: FsState;
  steps: FsStep[];
  /** vsfs.py stops (exit 1) as soon as the disk runs out of inodes or data blocks. */
  halted?: 'inodes' | 'data' | 'stuck';
  /** Index of the first user step in `steps`. */
  userStart: number;
  /** vsfs.py's generator bookkeeping (what `-p` prints). */
  files: string[];
  dirs: string[];
}

export const MAX_ENTRIES = 32;
export const ROOT = 0;

/* ---------- state helpers ---------- */

export function emptyFs(numInodes: number, numData: number): FsState {
  const s: FsState = {
    ibitmap: Array(numInodes).fill(0),
    inodes: Array.from({ length: numInodes }, () => ({ type: null, addr: -1, refs: 1 })),
    dbitmap: Array(numData).fill(0),
    blocks: Array.from({ length: numData }, () => ({ type: null, entries: [], data: '' })),
  };
  s.ibitmap[ROOT] = 1;
  s.inodes[ROOT] = { type: 'd', addr: 0, refs: 2 };
  s.dbitmap[0] = 1;
  s.blocks[0] = { type: 'd', entries: [['.', ROOT], ['..', ROOT]], data: '' };
  return s;
}

function clone(s: FsState): FsState {
  return {
    ibitmap: [...s.ibitmap],
    inodes: s.inodes.map((n) => ({ ...n })),
    dbitmap: [...s.dbitmap],
    blocks: s.blocks.map((b) => ({ type: b.type, entries: b.entries.map((e) => [e[0], e[1]] as [string, number]), data: b.data })),
  };
}

const firstFree = (bm: number[]) => bm.indexOf(0);
export const numFree = (bm: number[]) => bm.filter((b) => b === 0).length;

/** vsfs.py's dump, one line per region (inode bitmap, inodes, data bitmap, data). */
export function dumpLines(s: FsState): [string, string, string, string] {
  return [
    s.ibitmap.join(''),
    s.inodes.map((n) => (n.type ? `[${n.type} a:${n.addr} r:${n.refs}]` : '[]')).join(''),
    s.dbitmap.join(''),
    s.blocks.map((b) => (b.type === 'd' ? `[${b.entries.map(([n, i]) => `(${n},${i})`).join(' ')}]` : b.type === 'f' ? `[${b.data}]` : '[]')).join(''),
  ];
}

export function dump(s: FsState): string {
  const [a, b, c, d] = dumpLines(s);
  return `inode bitmap  ${a}\ninodes       ${b}\ndata bitmap   ${c}\ndata         ${d}`;
}

/* ---------- paths ---------- */

const NAME_RE = /^[^\s/(),;"']+$/;

export function splitPath(path: string): string[] | null {
  if (!path.startsWith('/')) return null;
  const parts = path.split('/').filter((p) => p !== '');
  return parts.every((p) => NAME_RE.test(p)) ? parts : null;
}

export interface LookupStep {
  kind: 'inode' | 'block';
  /** Inode read (kind 'inode') or directory block read (kind 'block'). */
  inum: number;
  block: number;
  /** For 'block': the name being searched and what it maps to (-1 = not there). */
  name?: string;
  found?: number;
  /** Path resolved so far, e.g. "/a/b". */
  prefix: string;
}

export interface Lookup {
  steps: LookupStep[];
  /** Disk reads = steps.length (each inode or directory block read is one read). */
  reads: number;
  inum: number;
  error?: FsError;
}

/** Walks `path` from the root inode the way OSTEP ch. 40 describes `open()`: inode → its block → entry → next inode … */
export function lookup(s: FsState, path: string): Lookup {
  const parts = splitPath(path);
  const steps: LookupStep[] = [];
  const done = (inum: number, error?: FsError): Lookup => ({ steps, reads: steps.length, inum, error });
  if (!parts) return done(-1, { code: 'EINVAL', at: path });
  let inum = ROOT;
  let prefix = '/';
  steps.push({ kind: 'inode', inum, block: s.inodes[inum].addr, prefix });
  for (const name of parts) {
    const node = s.inodes[inum];
    if (node.type !== 'd') return done(-1, { code: 'ENOTDIR', at: prefix });
    const blk = s.blocks[node.addr];
    const hit = blk.entries.find((e) => e[0] === name);
    steps.push({ kind: 'block', inum, block: node.addr, name, found: hit ? hit[1] : -1, prefix });
    const next = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
    if (!hit) return done(-1, { code: 'ENOENT', at: next });
    inum = hit[1];
    prefix = next;
    steps.push({ kind: 'inode', inum, block: s.inodes[inum].addr, prefix });
  }
  return done(inum);
}

function resolve(s: FsState, path: string): { inum: number; error?: FsError } {
  const r = lookup(s, path);
  return { inum: r.inum, error: r.error };
}

function parentOf(path: string): { parent: string; name: string } | null {
  const parts = splitPath(path);
  if (!parts || parts.length === 0) return null;
  const name = parts[parts.length - 1];
  return { parent: '/' + parts.slice(0, -1).join('/'), name };
}

/* ---------- operations (same checks, same order as vsfs.py) ---------- */

export type ApplyResult = { ok: true; state: FsState } | { ok: false; error: FsError };

export function apply(s0: FsState, op: Op): ApplyResult {
  const fail = (code: FsErrorCode, at: string): ApplyResult => ({ ok: false, error: { code, at } });
  const pp = parentOf(op.path);
  if (!pp || pp.name === '.' || pp.name === '..') return fail('EINVAL', op.path);
  const { parent, name } = pp;

  if (op.kind === 'write') {
    const t = resolve(s0, op.path);
    if (t.error) return { ok: false, error: t.error };
    if (s0.inodes[t.inum].type === 'd') return fail('EISDIR', op.path);
    if (s0.inodes[t.inum].addr !== -1) return fail('FILEFULL', op.path);
    const b = firstFree(s0.dbitmap);
    if (b === -1) return fail('NOBLOCK', op.path);
    const s = clone(s0);
    s.dbitmap[b] = 1;
    s.blocks[b] = { type: 'f', entries: [], data: op.data };
    s.inodes[t.inum].addr = b;
    return { ok: true, state: s };
  }

  let target = -1;
  if (op.kind === 'link') {
    const t = resolve(s0, op.target);
    if (t.error) return { ok: false, error: t.error };
    if (s0.inodes[t.inum].type === 'd') return fail('EISDIR', op.target);
    target = t.inum;
  }

  const p = resolve(s0, parent);
  if (p.error) return { ok: false, error: p.error };
  const pnode = s0.inodes[p.inum];
  if (pnode.type !== 'd') return fail('ENOTDIR', parent);
  const pblock = pnode.addr;
  const entries = s0.blocks[pblock].entries;
  const existing = entries.find((e) => e[0] === name);

  if (op.kind === 'unlink') {
    if (!existing) return fail('ENOENT', op.path);
    const inum = existing[1];
    const ftype = s0.inodes[inum].type;
    // vsfs.py only ever unlinks files (its block.free() asserts an empty dir, and it never rmdirs).
    if (ftype === 'd') return fail('EISDIR', op.path);
    const s = clone(s0);
    if (s.inodes[inum].refs === 1) {
      const d = s.inodes[inum].addr;
      if (d !== -1) {
        s.dbitmap[d] = 0;
        s.blocks[d] = { type: null, entries: [], data: '' };
      }
      s.ibitmap[inum] = 0;
      s.inodes[inum] = { type: null, addr: -1, refs: s.inodes[inum].refs };
    } else {
      s.inodes[inum].refs -= 1;
    }
    const pb = s.blocks[pblock];
    pb.entries.splice(
      pb.entries.findIndex((e) => e[0] === name),
      1,
    );
    return { ok: true, state: s };
  }

  // creat / mkdir / link
  if (entries.length >= MAX_ENTRIES) return fail('DIRFULL', parent);
  if (existing) return fail('EEXIST', op.path);

  if (op.kind === 'link') {
    const s = clone(s0);
    s.inodes[target].refs += 1;
    s.blocks[pblock].entries.push([name, target]);
    return { ok: true, state: s };
  }

  const inum = firstFree(s0.ibitmap);
  if (inum === -1) return fail('NOINODE', op.path);
  const s = clone(s0);
  s.ibitmap[inum] = 1;
  let fblock = -1;
  if (op.kind === 'mkdir') {
    fblock = firstFree(s.dbitmap);
    if (fblock === -1) return fail('NOBLOCK', op.path);
    s.dbitmap[fblock] = 1;
    s.blocks[fblock] = { type: 'd', entries: [['.', inum], ['..', p.inum]], data: '' };
  }
  s.inodes[inum] = { type: op.kind === 'mkdir' ? 'd' : 'f', addr: fblock, refs: op.kind === 'mkdir' ? 2 : 1 };
  if (op.kind === 'mkdir') s.inodes[p.inum].refs += 1;
  s.blocks[pblock].entries.push([name, inum]);
  return { ok: true, state: s };
}

/** What changed between two states, region by region. */
export function diff(a: FsState, b: FsState): Effect[] {
  const out: Effect[] = [];
  a.ibitmap.forEach((v, i) => v !== b.ibitmap[i] && out.push({ k: 'ibit', i, to: b.ibitmap[i] }));
  a.inodes.forEach((x, i) => {
    const y = b.inodes[i];
    if (!x.type && y.type) out.push({ k: 'ialloc', i, type: y.type });
    else if (x.type && !y.type) out.push({ k: 'ifree', i });
    else if (x.type && y.type) {
      if (x.addr !== y.addr) out.push({ k: 'addr', i, from: x.addr, to: y.addr });
      if (x.refs !== y.refs) out.push({ k: 'refs', i, from: x.refs, to: y.refs });
    }
  });
  a.dbitmap.forEach((v, i) => v !== b.dbitmap[i] && out.push({ k: 'dbit', b: i, to: b.dbitmap[i] }));
  a.blocks.forEach((x, i) => {
    const y = b.blocks[i];
    const key = (e: [string, number]) => `${e[0]}\u0000${e[1]}`;
    const xs = new Set(x.entries.map(key));
    const ys = new Set(y.entries.map(key));
    for (const e of x.entries) if (!ys.has(key(e))) out.push({ k: 'entry', b: i, name: e[0], inum: e[1], add: false });
    for (const e of y.entries) if (!xs.has(key(e))) out.push({ k: 'entry', b: i, name: e[0], inum: e[1], add: true });
    if (x.type === 'f' && (y.type !== 'f' || x.data !== y.data)) out.push({ k: 'data', b: i, data: x.data, add: false });
    if (y.type === 'f' && (x.type !== 'f' || x.data !== y.data)) out.push({ k: 'data', b: i, data: y.data, add: true });
  });
  return out;
}

/* ---------- vsfs.py's random workload ---------- */

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

export function simulateFs(cfg: FsConfig): FsRun {
  const initial = emptyFs(cfg.numInodes, cfg.numData);
  const steps: FsStep[] = [];
  let state = initial;
  const rng = new PyRandom(cfg.seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng.random() * xs.length)];
  const files: string[] = [];
  const dirs: string[] = ['/'];
  const full = (parent: string, name: string) => (parent === '/' ? `/${name}` : `${parent}/${name}`);
  let halted: FsRun['halted'];

  const attempt = (op: Op): boolean => {
    const r = apply(state, op);
    if (!r.ok) return false;
    steps.push({ op, ok: true, state: r.state, effects: diff(state, r.state), source: 'gen' });
    state = r.state;
    return true;
  };

  const doAppend = (): boolean => {
    if (files.length === 0) return false;
    const f = pick(files);
    const data = String.fromCharCode(97 + Math.floor(rng.random() * 26));
    return attempt({ kind: 'write', path: f, data });
  };
  const doDelete = (): boolean => {
    if (files.length === 0) return false;
    const f = pick(files);
    attempt({ kind: 'unlink', path: f });
    files.splice(files.indexOf(f), 1);
    return true;
  };
  const doLink = (): boolean => {
    if (files.length === 0) return false;
    const parent = pick(dirs);
    const name = pick(NAMES);
    const target = pick(files);
    const path = full(parent, name);
    if (!attempt({ kind: 'link', target, path })) return false;
    files.push(path);
    return true;
  };
  const doCreate = (type: FType): boolean => {
    const parent = pick(dirs);
    const name = pick(NAMES);
    const path = full(parent, name);
    if (!attempt({ kind: type === 'd' ? 'mkdir' : 'creat', path })) return false;
    (type === 'd' ? dirs : files).push(path);
    return true;
  };

  outer: for (let i = 0; i < cfg.numRequests; i++) {
    let ok = false;
    let tries = 0;
    while (!ok) {
      if (++tries > 10000) {
        halted = 'stuck';
        break outer;
      }
      const r = rng.random();
      if (r < 0.3) ok = doAppend();
      else if (r < 0.5) ok = doDelete();
      else if (r < 0.7) ok = doLink();
      else ok = rng.random() < 0.75 ? doCreate('f') : doCreate('d');
      if (numFree(state.ibitmap) === 0) {
        halted = 'inodes';
        break outer;
      }
      if (numFree(state.dbitmap) === 0) {
        halted = 'data';
        break outer;
      }
    }
  }

  const userStart = steps.length;
  for (const op of cfg.ops) {
    const r = apply(state, op);
    if (r.ok) {
      steps.push({ op, ok: true, state: r.state, effects: diff(state, r.state), source: 'user' });
      state = r.state;
    } else {
      steps.push({ op, ok: false, error: r.error, state, effects: [], source: 'user' });
    }
  }
  return { initial, steps, halted, userStart, files, dirs };
}

/* ---------- vsfs.py's exact stdout ---------- */

export type QuizMode = 'op' | 'state' | 'all';

/** The line vsfs.py prints for an op. */
export function opToVsfs(op: Op): string {
  switch (op.kind) {
    case 'mkdir':
    case 'creat':
    case 'unlink':
      return `${op.kind}("${op.path}");`;
    case 'link':
      return `link("${op.target}", "${op.path}");`;
    case 'write':
      return `fd=open("${op.path}", O_WRONLY|O_APPEND); write(fd, buf, BLOCKSIZE); close(fd);`;
  }
}

/** Short form used in this page's op list and URL: `mkdir /a`, `link /a /b`, `write /a x`. */
export function opToText(op: Op): string {
  if (op.kind === 'link') return `link ${op.target} ${op.path}`;
  if (op.kind === 'write') return `write ${op.path} ${op.data}`;
  return `${op.kind} ${op.path}`;
}

const pyBool = (b: boolean) => (b ? 'True' : 'False');
const pyList = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;

/** Reproduces `vsfs.py -s S -i I -d D -n N [-r] [-p] [-c]` stdout byte for byte. */
export function vsfsTranscript(o: { seed: number; numInodes: number; numData: number; numRequests: number; reverse?: boolean; printFinal?: boolean; compute?: boolean }): string {
  const run = simulateFs({ seed: o.seed, numInodes: o.numInodes, numData: o.numData, numRequests: o.numRequests, ops: [] });
  const printOps = o.compute || !!o.reverse;
  const printState = o.compute || !o.reverse;
  const L: string[] = [
    `ARG seed ${o.seed}`,
    `ARG numInodes ${o.numInodes}`,
    `ARG numData ${o.numData}`,
    `ARG numRequests ${o.numRequests}`,
    `ARG reverse ${pyBool(!!o.reverse)}`,
    `ARG printFinal ${pyBool(!!o.printFinal)}`,
    '',
    'Initial state',
    '',
    dump(run.initial),
    '',
  ];
  run.steps.forEach((st, i) => {
    if (!printOps) L.push('Which operation took place?');
    if (printOps) L.push(opToVsfs(st.op));
    if (run.halted && run.halted !== 'stuck' && i === run.steps.length - 1) return;
    if (printState) L.push('', dump(st.state), '');
    else L.push('', '  State of file system (inode bitmap, inodes, data bitmap, data)?', '');
  });
  if (run.halted === 'inodes' || run.halted === 'data') {
    // the failing request may not have produced a step (fs already full before it)
    if (run.steps.length < o.numRequests && !printOps && !run.steps.length) L.push('Which operation took place?');
    L.push(`File system out of ${run.halted === 'inodes' ? 'inodes' : 'data blocks'}; rerun with more via command-line flag?`);
    return L.join('\n') + '\n';
  }
  if (o.printFinal) L.push('', 'Summary of files, directories::', '', `  Files:       ${pyList(run.files)}`, `  Directories: ${pyList(run.dirs)}`, '');
  return L.join('\n') + '\n';
}

/* ---------- parsing ---------- */

/** Parses ops, one per line or `;`-separated: `mkdir /a`, `creat /a/b`, `link /a/b /c`, `unlink /c`, `write /a/b [x]`; also vsfs.py's `mkdir("/a");`. */
export function parseOps(text: string): { ops: Op[]; bad: string[] } {
  const ops: Op[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const toks = line.replace(/[(),"]/g, ' ').trim().split(/\s+/);
    const kind = toks[0].toLowerCase();
    const args = toks.slice(1);
    const okPath = (p?: string) => !!p && splitPath(p) !== null && splitPath(p)!.length > 0;
    if ((kind === 'mkdir' || kind === 'creat' || kind === 'unlink') && args.length === 1 && okPath(args[0])) ops.push({ kind, path: args[0] });
    else if (kind === 'link' && args.length === 2 && okPath(args[0]) && okPath(args[1])) ops.push({ kind, target: args[0], path: args[1] });
    else if (kind === 'write' && (args.length === 1 || (args.length === 2 && /^[a-z0-9]$/i.test(args[1]))) && okPath(args[0])) ops.push({ kind, path: args[0], data: args[1] ?? 'x' });
    else bad.push(line);
  }
  return { ops, bad };
}

export interface VsfsFlags {
  seed?: number;
  numInodes?: number;
  numData?: number;
  numRequests?: number;
  mode?: QuizMode;
}

/** Parses a vsfs.py command line (`./vsfs.py -s 3 -i 4 -d 4 -n 6 -r -c`, long options too). */
export function parseFlags(text: string): { flags: VsfsFlags; bad: string[] } {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  const flags: VsfsFlags = {};
  const bad: string[] = [];
  let reverse = false;
  let compute = false;
  const num: Record<string, keyof VsfsFlags> = { s: 'seed', seed: 'seed', i: 'numInodes', numInodes: 'numInodes', d: 'numData', numData: 'numData', n: 'numRequests', numRequests: 'numRequests' };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (/vsfs(\.py)?$/.test(t) || t === 'python' || t === 'python3') continue;
    let m = /^--(\w+)(?:=(.*))?$/.exec(t);
    let key: string | undefined;
    let val: string | undefined;
    if (m) {
      key = m[1];
      val = m[2];
    } else if ((m = /^-(\w)(.*)$/.exec(t))) {
      key = m[1];
      val = m[2] || undefined;
    } else {
      bad.push(t);
      continue;
    }
    if (key === 'r' || key === 'reverse') reverse = true;
    else if (key === 'c' || key === 'compute') compute = true;
    else if (key === 'p' || key === 'printFinal') continue;
    else if (num[key]) {
      if (val === undefined) val = toks[++k];
      const n = Number(val);
      if (val === undefined || !Number.isInteger(n) || n < 0) bad.push(t + (val ? ` ${val}` : ''));
      else (flags as Record<string, number>)[num[key]] = n;
    } else bad.push(t);
  }
  flags.mode = compute ? 'all' : reverse ? 'state' : 'op';
  return { flags, bad };
}

/** The equivalent command line. */
export function vsfsCommand(c: { seed: number; numInodes: number; numData: number; numRequests: number; mode: QuizMode }): string {
  const f = [`-s ${c.seed}`];
  if (c.numInodes !== 8) f.push(`-i ${c.numInodes}`);
  if (c.numData !== 8) f.push(`-d ${c.numData}`);
  f.push(`-n ${c.numRequests}`);
  if (c.mode === 'state') f.push('-r');
  if (c.mode === 'all') f.push('-c');
  return `./vsfs.py ${f.join(' ')}`;
}

/* ---------- derived views ---------- */

export interface TreeNode {
  name: string;
  path: string;
  inum: number;
  type: FType;
  refs: number;
  children: TreeNode[];
}

/** Directory tree reachable from the root (skips `.` and `..`). */
export function buildTree(s: FsState): TreeNode {
  const visit = (name: string, path: string, inum: number, depth: number): TreeNode => {
    const n = s.inodes[inum];
    const node: TreeNode = { name, path, inum, type: n.type ?? 'f', refs: n.refs, children: [] };
    if (n.type === 'd' && depth < 32 && n.addr >= 0) {
      for (const [cn, ci] of s.blocks[n.addr].entries) {
        if (cn === '.' || cn === '..') continue;
        node.children.push(visit(cn, path === '/' ? `/${cn}` : `${path}/${cn}`, ci, depth + 1));
      }
    }
    return node;
  };
  return visit('/', '/', ROOT, 0);
}

export interface FsCounts {
  inodesUsed: number;
  inodesFree: number;
  blocksUsed: number;
  blocksFree: number;
  dirs: number;
  files: number;
  /** Extra names beyond the first for files: Σ (refs − 1). */
  extraLinks: number;
  /** Files with refs > 1. */
  multiLinked: number;
}

export function counts(s: FsState): FsCounts {
  const used = s.inodes.filter((n) => n.type);
  const files = used.filter((n) => n.type === 'f');
  return {
    inodesUsed: used.length,
    inodesFree: s.inodes.length - used.length,
    blocksUsed: s.dbitmap.filter((b) => b).length,
    blocksFree: numFree(s.dbitmap),
    dirs: used.length - files.length,
    files: files.length,
    extraLinks: files.reduce((a, n) => a + n.refs - 1, 0),
    multiLinked: files.filter((n) => n.refs > 1).length,
  };
}

/* ---------- presets ---------- */

export type PresetId = 'empty' | 'hardlink' | 'seed0' | 'seed1' | 'seed2';

export const PRESETS: Record<PresetId, { seed: number; numInodes: number; numData: number; numRequests: number; ops: string }> = {
  // OSTEP fig. 40.3/40.4: creating /foo/bar and writing to it
  empty: { seed: 0, numInodes: 8, numData: 8, numRequests: 0, ops: 'mkdir /foo; creat /foo/bar; write /foo/bar h; mkdir /foo/baz' },
  // OSTEP §39.14: echo hello > file; ln file file2; rm file; rm file2
  hardlink: { seed: 0, numInodes: 8, numData: 8, numRequests: 0, ops: 'creat /file; write /file h; link /file /file2; unlink /file; unlink /file2' },
  seed0: { seed: 0, numInodes: 8, numData: 8, numRequests: 10, ops: '' },
  seed1: { seed: 1, numInodes: 8, numData: 8, numRequests: 10, ops: '' },
  seed2: { seed: 2, numInodes: 8, numData: 8, numRequests: 10, ops: '' },
};
