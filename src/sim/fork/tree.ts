import { PyRandom } from '../../lib/pyrandom';

/**
 * Port of OSTEP's cpu-api/fork.py: a process tree that grows with forks
 * ("a+b": a forks b) and shrinks with exits ("b-"). Random problems come out
 * identical to the script for the same `-s` seed.
 */

export type PrintStyle = 'fancy' | 'basic' | 'line1' | 'line2';

export interface ForkPyConfig {
  /** `-s` (the script leaves `random` unseeded for -1; here a seed is always used). */
  seed: number;
  /** `-a`: number of actions to generate. */
  actions: number;
  /** `-f`: probability that a generated action is a fork. */
  forkPct: number;
  /** `-A`: explicit comma-separated action list (overrides the generator). */
  actionList: string;
  /** `-R`: orphans go to the exiting process's parent instead of the root. */
  localReparent: boolean;
  /** `-L`: only leaves may exit. */
  leafOnly: boolean;
}

/** Alive processes and their parent/children links, in fork.py's insertion order. */
export interface TreeSnap {
  root: string;
  children: Record<string, string[]>;
  parent: Record<string, string>;
}

export interface ForkPyStep {
  /** The raw action, e.g. "a+b" or "b-". */
  action: string;
  kind: 'fork' | 'exit' | 'exitFailed';
  actor: string;
  child?: string;
  /** What fork.py prints after "Action: ". */
  text: string;
  /** Tree after the action. */
  tree: TreeSnap;
  /** Processes whose parent changed because `actor` exited. */
  orphans: { name: string; from: string; to: string }[];
  /** The exited process and where it hung, so the UI can show it struck out. */
  exited?: { name: string; parent: string };
}

export interface ForkPyRun {
  actions: string[];
  initial: TreeSnap;
  steps: ForkPyStep[];
  /** fork.py would stop here with this message. */
  error?: { index: number; action: string; message: string };
}

const BASE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** fork.py's name generator: b, c, … Z, then aa, ab, … */
class Names {
  private curr: string[] = [...BASE];
  private index = 1;
  next(): string {
    if (this.index === this.curr.length) {
      const grown: string[] = [];
      for (const b1 of this.curr) for (const b2 of BASE) grown.push(b1 + b2);
      this.curr = grown;
      this.index = 0;
    }
    return this.curr[this.index++];
  }
}

/** The script's own `random_randint` / `random_choice`, built on random.random(). */
function pyChoice<T>(r: PyRandom, list: T[]): T {
  return list[Math.floor(0 + r.random() * (list.length - 1 - 0 + 1))];
}

/** Generates the random action list exactly like fork.py (same call order). */
export function generateActions(seed: number, count: number, forkPct: number): string[] {
  const r = new PyRandom(seed);
  const names = new Names();
  const out: string[] = [];
  const temp = ['a'];
  let actions = 0;
  let guard = 0;
  while (actions < count && guard++ < 1e6) {
    if (r.random() < forkPct) {
      const parent = pyChoice(r, temp);
      const child = names.next();
      out.push(`${parent}+${child}`);
      temp.push(child);
    } else {
      const victim = pyChoice(r, temp);
      if (victim === 'a') continue;
      temp.splice(temp.indexOf(victim), 1);
      out.push(`${victim}-`);
    }
    actions++;
  }
  return out;
}

export function actionsFor(cfg: ForkPyConfig): string[] {
  if (cfg.actionList.trim() !== '') return cfg.actionList.split(',').map((a) => a.trim());
  return generateActions(cfg.seed, cfg.actions, cfg.forkPct);
}

function snap(children: Record<string, string[]>, parent: Record<string, string>): TreeSnap {
  const c: Record<string, string[]> = {};
  for (const k of Object.keys(children)) c[k] = [...children[k]];
  return { root: 'a', children: c, parent: { ...parent } };
}

export function badActionMessage(a: string): string {
  return `bad action (${a}), must be X+Y or X- where X and Y are processes`;
}

export function simulateForkPy(cfg: ForkPyConfig): ForkPyRun {
  const actions = actionsFor(cfg);
  const alive = ['a'];
  const children: Record<string, string[]> = { a: [] };
  const parent: Record<string, string> = {};
  const initial = snap(children, parent);
  const steps: ForkPyStep[] = [];

  const collect = (p: string): string[] => {
    const out = [p];
    for (const c of children[p]) out.push(...collect(c));
    return out;
  };

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const fail = (message: string): ForkPyRun => ({ actions, initial, steps, error: { index: i, action: a, message } });
    if (a.includes('+')) {
      const parts = a.split('+');
      if (parts.length !== 2 || parts[1] === '' || !alive.includes(parts[0])) return fail(badActionMessage(a));
      const [p, c] = parts;
      if (c in children || c === 'a') return fail(badActionMessage(a));
      alive.push(c);
      children[c] = [];
      children[p].push(c);
      parent[c] = p;
      steps.push({ action: a, kind: 'fork', actor: p, child: c, text: `${p} forks ${c}`, tree: snap(children, parent), orphans: [] });
    } else if (a.includes('-')) {
      const parts = a.split('-');
      if (parts.length !== 2 || !alive.includes(parts[0])) return fail(badActionMessage(a));
      const p = parts[0];
      if (cfg.leafOnly && children[p].length > 0) {
        steps.push({ action: a, kind: 'exitFailed', actor: p, text: `${p} EXITS (failed: has children)`, tree: snap(children, parent), orphans: [] });
        continue;
      }
      if (p === 'a') return fail('root process: cannot exit');
      const exitParent = parent[p];
      alive.splice(alive.indexOf(p), 1);
      const orphans: ForkPyStep['orphans'] = [];
      if (cfg.localReparent) {
        for (const o of children[p]) {
          parent[o] = exitParent;
          children[exitParent].push(o);
          orphans.push({ name: o, from: p, to: exitParent });
        }
      } else {
        const desc = collect(p).slice(1);
        for (const d of desc) {
          orphans.push({ name: d, from: parent[d], to: 'a' });
          children[d] = [];
          parent[d] = 'a';
          children.a.push(d);
        }
      }
      const sib = children[exitParent];
      sib.splice(sib.indexOf(p), 1);
      delete children[p];
      delete parent[p];
      steps.push({ action: a, kind: 'exit', actor: p, text: `${p} EXITS`, tree: snap(children, parent), orphans, exited: { name: p, parent: exitParent } });
    } else {
      return fail(badActionMessage(a));
    }
  }
  return { actions, initial, steps };
}

/* ---------- Text output, character for character ---------- */

const PAD = '                               ';

/** fork.py's `print_tree()`, including its 31-space left margin. */
export function printTree(t: TreeSnap, style: PrintStyle = 'fancy'): string {
  let out = '';
  const chars = style === 'line1' ? ['|', '-', '+', '|'] : style === 'line2' ? ['|', '_', '|', '|'] : ['│', '─', '├', '└'];
  const walk = (p: string, level: number, pmask: Map<number, boolean>, isLast: boolean) => {
    out += PAD;
    if (style === 'basic') {
      out += '   '.repeat(level) + p.padStart(2) + '\n';
      for (const c of t.children[p]) walk(c, level + 1, new Map(), false);
      return;
    }
    if (level > 0) {
      for (let i = 0; i < level - 1; i++) out += pmask.get(i) ? `${chars[0]}   ` : '    ';
      if (pmask.get(level - 1)) out += isLast ? `${chars[3]}${chars[1]}${chars[1]} ` : `${chars[2]}${chars[1]}${chars[1]} `;
      else out += ` ${chars[1]}${chars[1]}${chars[1]} `;
    }
    out += p + '\n';
    if (isLast) pmask.set(level - 1, false);
    pmask.set(level, true);
    const kids = t.children[p];
    for (const c of kids.slice(0, -1)) walk(c, level + 1, pmask, false);
    for (const c of kids.slice(-1)) walk(c, level + 1, pmask, true);
  };
  walk(t.root, 0, new Map(), false);
  return out;
}

/** The `-t`, `-F`, `-c`, `-P` flags only change what the script prints. */
export interface ForkPyPrint {
  showTree: boolean;
  finalOnly: boolean;
  solve: boolean;
  style: PrintStyle;
  /** `-s` as typed (-1 = not given). */
  seedArg: number;
}

const pyBool = (b: boolean) => (b ? 'True' : 'False');
const pyFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Everything fork.py writes to stdout for this setup (for golden tests and the "real output" view). */
export function forkPyOutput(cfg: ForkPyConfig, p: ForkPyPrint): string {
  const run = simulateForkPy(cfg);
  let o = '\n';
  o += `ARG seed ${p.seedArg}\n`;
  o += `ARG fork_percentage ${pyFloat(cfg.forkPct)}\n`;
  o += `ARG actions ${cfg.actions}\n`;
  o += `ARG action_list ${cfg.actionList}\n`;
  o += `ARG show_tree ${pyBool(p.showTree)}\n`;
  o += `ARG just_final ${pyBool(p.finalOnly)}\n`;
  o += `ARG leaf_only ${pyBool(cfg.leafOnly)}\n`;
  o += `ARG local_reparent ${pyBool(cfg.localReparent)}\n`;
  o += `ARG print_style ${p.style}\n`;
  o += `ARG solve ${pyBool(p.solve)}\n\n`;
  o += '                           Process Tree:\n';
  o += printTree(run.initial, p.style);
  o += '\n';
  for (const s of run.steps) {
    if (p.showTree) {
      o += p.solve ? `Action: ${s.text}\n` : 'Action?\n';
      if (!p.finalOnly) o += printTree(s.tree, p.style);
    } else {
      o += `Action: ${s.text}\n`;
      if (!p.finalOnly) o += p.solve ? printTree(s.tree, p.style) : 'Process Tree?\n';
    }
  }
  if (run.error) return o + run.error.message + '\n';
  const final = run.steps.at(-1)?.tree ?? run.initial;
  if (p.finalOnly) {
    if (p.showTree || p.solve) o += '\n                        Final Process Tree:\n' + printTree(final, p.style) + '\n';
    else o += '\n                        Final Process Tree?\n\n';
  }
  return o;
}

/* ---------- Flags ---------- */

export interface ForkPyFlags extends Partial<ForkPyConfig> {
  showTree?: boolean;
  finalOnly?: boolean;
  solve?: boolean;
  style?: PrintStyle;
}

const LONG: Record<string, string> = {
  seed: 's',
  forks: 'f',
  action_list: 'A',
  actions: 'a',
  show_tree: 't',
  print_style: 'P',
  final_only: 'F',
  leaf_only: 'L',
  local_reparent: 'R',
  compute: 'c',
};
const TAKES_VALUE = new Set(['s', 'f', 'A', 'a', 'P']);

/** Parses a pasted command line like `./fork.py -s 4 -a 10 -R -c`. */
export function parseForkPyFlags(line: string): { flags: ForkPyFlags; errors: string[] } {
  const toks = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? [];
  const flags: ForkPyFlags = {};
  const errors: string[] = [];
  const apply = (k: string, v: string | undefined) => {
    const num = (x: string | undefined, int: boolean) => {
      const n = Number(x);
      if (x === undefined || !Number.isFinite(n) || (int && !Number.isInteger(n))) {
        errors.push(`-${k} ${x ?? ''}`.trim());
        return undefined;
      }
      return n;
    };
    switch (k) {
      case 's': {
        const n = num(v, true);
        if (n !== undefined) flags.seed = n;
        break;
      }
      case 'a': {
        const n = num(v, true);
        if (n !== undefined) flags.actions = n;
        break;
      }
      case 'f': {
        const n = num(v, false);
        if (n !== undefined) flags.forkPct = n;
        break;
      }
      case 'A':
        flags.actionList = v ?? '';
        break;
      case 'P':
        if (v === 'fancy' || v === 'basic' || v === 'line1' || v === 'line2') flags.style = v;
        else errors.push(`-P ${v ?? ''}`.trim());
        break;
      case 't':
        flags.showTree = true;
        break;
      case 'F':
        flags.finalOnly = true;
        break;
      case 'L':
        flags.leafOnly = true;
        break;
      case 'R':
        flags.localReparent = true;
        break;
      case 'c':
        flags.solve = true;
        break;
      default:
        errors.push(`-${k}`);
    }
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/(^|\/)fork\.py$/.test(t) || /^python3?$/.test(t) || t === 'prompt>' || t === '$') continue;
    if (t.startsWith('--')) {
      const [name, eq] = t.slice(2).split('=', 2);
      const k = LONG[name];
      if (!k) {
        errors.push(t);
        continue;
      }
      apply(k, TAKES_VALUE.has(k) ? (eq ?? toks[++i]) : undefined);
    } else if (t.startsWith('-') && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        const k = t[j];
        if (TAKES_VALUE.has(k)) {
          const rest = t.slice(j + 1);
          apply(k, rest !== '' ? rest : toks[++i]);
          break;
        }
        apply(k, undefined);
      }
    } else errors.push(t);
  }
  return { flags, errors };
}

/** The equivalent command line for the current setup. */
export function forkPyCommand(cfg: ForkPyConfig, p: { showTree: boolean; finalOnly: boolean; solve: boolean }): string {
  const parts = ['./fork.py'];
  if (cfg.actionList.trim() !== '') parts.push('-A', cfg.actionList.replace(/\s+/g, ''));
  else {
    parts.push('-s', String(cfg.seed));
    if (cfg.actions !== 5) parts.push('-a', String(cfg.actions));
    if (cfg.forkPct !== 0.7) parts.push('-f', String(cfg.forkPct));
  }
  if (cfg.leafOnly) parts.push('-L');
  if (cfg.localReparent) parts.push('-R');
  if (p.showTree) parts.push('-t');
  if (p.finalOnly) parts.push('-F');
  if (p.solve) parts.push('-c');
  return parts.join(' ');
}

/** Depth-first order of a tree (root first), for layout and practice questions. */
export function preorder(t: TreeSnap): string[] {
  const out: string[] = [];
  const go = (p: string) => {
    out.push(p);
    for (const c of t.children[p]) go(c);
  };
  go(t.root);
  return out;
}
