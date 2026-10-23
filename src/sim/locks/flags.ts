/** `x86.py` command lines: parse what a student pastes, print the equivalent of the current setup. */
import { X86_DEFAULTS, type X86Config } from './machine';

type Key = keyof X86Config;
const VALUED: Record<string, Key | 'prog' | 'headercount'> = {
  '-s': 'seed',
  '--seed': 'seed',
  '-t': 'threads',
  '--threads': 'threads',
  '-p': 'prog',
  '--program': 'prog',
  '-i': 'intfreq',
  '--interrupt': 'intfreq',
  '-P': 'procsched',
  '--procsched': 'procsched',
  '-a': 'argv',
  '--argv': 'argv',
  '-L': 'loadAddr',
  '--loadaddr': 'loadAddr',
  '-m': 'memsize',
  '--memsize': 'memsize',
  '-M': 'memtrace',
  '--memtrace': 'memtrace',
  '-R': 'regtrace',
  '--regtrace': 'regtrace',
  '-H': 'headercount',
  '--headercount': 'headercount',
};
const BOOL: Record<string, Key | 'ignore'> = {
  '-r': 'intrand',
  '--randints': 'intrand',
  '-C': 'cctrace',
  '--cctrace': 'cctrace',
  '-c': 'ignore',
  '--compute': 'ignore',
  '-S': 'ignore',
  '--printstats': 'ignore',
  '-v': 'ignore',
  '--verbose': 'ignore',
  '-h': 'ignore',
  '--help': 'ignore',
};
const INT_KEYS = new Set<string>(['seed', 'threads', 'intfreq', 'loadAddr', 'memsize', 'headercount']);

export interface ParsedFlags {
  /** Only the flags present in the command (x86.py defaults are NOT filled in). */
  patch: Partial<X86Config>;
  prog?: string;
  /** -H (only affects the printed trace). */
  headercount?: number;
  /** Tokens that could not be understood. */
  bad: string[];
}

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Parses e.g. `./x86.py -p flag.s -t 2 -a bx=2,bx=2 -M flag,count -c` (optparse style: `-t2`, `--threads=2`, `-rC`). */
export function parseFlags(cmd: string): ParsedFlags {
  const toks = tokenize(cmd);
  const patch: Partial<X86Config> = {};
  const bad: string[] = [];
  let prog: string | undefined;
  let headercount: number | undefined;
  const assign = (key: string, raw: string, tok: string) => {
    if (key === 'prog') {
      prog = raw;
      return;
    }
    if (key === 'headercount') {
      if (/^[+-]?\d+$/.test(raw)) headercount = Number(raw);
      else bad.push(tok);
      return;
    }
    if (INT_KEYS.has(key)) {
      if (!/^[+-]?\d+$/.test(raw)) {
        bad.push(tok);
        return;
      }
      (patch as Record<string, number>)[key] = Number(raw);
    } else (patch as Record<string, string>)[key] = raw;
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (i === 0 && /(^|\/)x86\.py$|^python3?$/.test(tok)) continue;
    if (/(^|\/)x86\.py$/.test(tok)) continue;
    if (tok.startsWith('--')) {
      const [name, val] = tok.includes('=') ? [tok.slice(0, tok.indexOf('=')), tok.slice(tok.indexOf('=') + 1)] : [tok, undefined];
      if (name in VALUED) {
        const v = val ?? toks[++i];
        if (v === undefined) bad.push(tok);
        else assign(VALUED[name], v, tok);
      } else if (name in BOOL) {
        const k = BOOL[name];
        if (k !== 'ignore') (patch as Record<string, boolean>)[k] = true;
      } else bad.push(tok);
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) {
      // a cluster of short options: booleans, possibly ending in one that takes a value
      let j = 1;
      while (j < tok.length) {
        const f = '-' + tok[j];
        if (f in BOOL) {
          const k = BOOL[f];
          if (k !== 'ignore') (patch as Record<string, boolean>)[k] = true;
          j++;
          continue;
        }
        if (f in VALUED) {
          const rest = tok.slice(j + 1);
          const v = rest !== '' ? rest : toks[++i];
          if (v === undefined) bad.push(tok);
          else assign(VALUED[f], v, tok);
          j = tok.length;
          continue;
        }
        bad.push(tok);
        break;
      }
      continue;
    }
    bad.push(tok);
  }
  return { patch, prog, headercount, bad };
}

/** x86.py's defaults overridden by the flags in `cmd`. */
export function configFromFlags(cmd: string): ParsedFlags & { cfg: X86Config } {
  const parsed = parseFlags(cmd);
  return { ...parsed, cfg: { ...X86_DEFAULTS, ...parsed.patch } };
}

/** The x86.py command for a setup, with only the flags that differ from x86.py's defaults (plus -p, -t and -c). */
export function formatCommand(file: string, cfg: X86Config): string {
  const d = X86_DEFAULTS;
  const parts = ['./x86.py', '-p', file, '-t', String(cfg.threads)];
  if (cfg.procsched === '') {
    if (cfg.intfreq !== d.intfreq) parts.push('-i', String(cfg.intfreq));
    if (cfg.intrand) parts.push('-r');
    if (cfg.intrand || cfg.seed !== d.seed) parts.push('-s', String(cfg.seed));
  } else parts.push('-P', cfg.procsched);
  if (cfg.argv !== '') parts.push('-a', cfg.argv);
  if (cfg.memtrace !== '') parts.push('-M', cfg.memtrace);
  if (cfg.regtrace !== '') parts.push('-R', cfg.regtrace);
  if (cfg.cctrace) parts.push('-C');
  if (cfg.loadAddr !== d.loadAddr) parts.push('-L', String(cfg.loadAddr));
  if (cfg.memsize !== d.memsize) parts.push('-m', String(cfg.memsize));
  parts.push('-c');
  return parts.join(' ');
}
