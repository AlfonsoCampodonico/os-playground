/**
 * Assembler for the tiny x86-like language of OSTEP's `x86.py`
 * (threads-intro/ and threads-locks/). It is a line-by-line port of
 * `cpu.load()` / `cpu.getarg()`: same operand forms, same quirks (e.g.
 * `xchg`/`fetchadd` ignore the scale; `lea a(%r1,%r2)` keeps only %r1 because
 * those opcodes split their arguments on the first comma), same data layout
 * (`.var` starts at address 100, 4 bytes per slot).
 *
 * Where x86.py would crash with a Python exception, this returns a
 * structured error with the source line instead.
 */

export const REG_NAMES = ['zero', 'ax', 'bx', 'cx', 'dx', 'ex', 'fx', 'sp', 'bp'] as const;
export type RegName = (typeof REG_NAMES)[number];
export const REG: Record<RegName, number> = { zero: 0, ax: 1, bx: 2, cx: 3, dx: 4, ex: 5, fx: 6, sp: 7, bp: 8 };
export const SP = REG.sp;

/** Condition codes in x86.py's `condlist` order: >= > <= < != == */
export const CC_NAMES = ['>=', '>', '<=', '<', '!=', '=='] as const;
export const CC = { GTE: 0, GT: 1, LTE: 2, LT: 3, NEQ: 4, EQ: 5 } as const;

/** Effective address = disp + r1 + scale * r2 (scale ignored by xchg/fetchadd). */
export interface Mem {
  disp: number;
  r1: number;
  r2: number;
  scale: number;
}

export type JumpCond = 'always' | 'ne' | 'eq' | 'lt' | 'lte' | 'gt' | 'gte';

export type Op =
  | { k: 'mov_ir'; imm: number; dst: number }
  | { k: 'mov_mr'; m: Mem; dst: number }
  | { k: 'mov_rm'; src: number; m: Mem }
  | { k: 'mov_rr'; src: number; dst: number }
  | { k: 'mov_im'; imm: number; m: Mem }
  | { k: 'lea'; m: Mem; dst: number }
  | { k: 'neg'; r: number }
  | { k: 'pop' }
  | { k: 'pop_r'; dst: number }
  | { k: 'push_r'; src: number }
  | { k: 'push_m'; m: Mem }
  | { k: 'call'; target: number; label: string }
  | { k: 'ret' }
  | { k: 'add_i' | 'sub_i' | 'mul_i'; imm: number; dst: number }
  | { k: 'add_r' | 'sub_r' | 'mul_r'; src: number; dst: number }
  | { k: 'fetchadd'; src: number; m: Mem }
  | { k: 'xchg'; src: number; m: Mem }
  | { k: 'test_ir'; imm: number; reg: number }
  | { k: 'test_ri'; reg: number; imm: number }
  | { k: 'test_rr'; src: number; dst: number }
  | { k: 'jump'; cond: JumpCond; target: number; label: string }
  | { k: 'nop' }
  | { k: 'halt' }
  | { k: 'yield' }
  | { k: 'rdump' }
  | { k: 'mdump'; addr: number };

export interface Instr {
  /** Address where the instruction lives (load address + index). */
  pc: number;
  /** 1-based source line. */
  line: number;
  /** Instruction text as x86.py prints it (comment removed, trimmed). */
  text: string;
  /** Comment on the same line, if any. */
  comment?: string;
  op: Op;
  /** Memory operand that names something directly (variable or constant address), for cross-highlighting. */
  staticAddr?: number;
}

export interface SourceLine {
  line: number;
  kind: 'instr' | 'label' | 'var' | 'comment' | 'blank';
  /** Code part (comment removed, trimmed). */
  code: string;
  comment?: string;
  /** Index into `program` for instruction lines. */
  idx?: number;
}

export type AsmErrorCode =
  | 'opcode'
  | 'args'
  | 'imm'
  | 'reg'
  | 'var'
  | 'mem'
  | 'operands'
  | 'label'
  | 'target'
  | 'paren'
  | 'directive'
  | 'data'
  | 'empty';

export interface AsmError {
  line: number;
  code: AsmErrorCode;
  /** The offending token or opcode. */
  detail: string;
}

export interface Assembled {
  program: Instr[];
  labels: Record<string, number>;
  /** Variable name → address. */
  vars: Record<string, number>;
  /** Variable name → number of 4-byte slots. */
  varSizes: Record<string, number>;
  source: SourceLine[];
  loadAddr: number;
  errors: AsmError[];
}

class AsmFail extends Error {
  constructor(
    public code: AsmErrorCode,
    public detail: string,
  ) {
    super(code);
  }
}

const fail = (code: AsmErrorCode, detail: string): never => {
  throw new AsmFail(code, detail);
};

/** Python's `str.isdigit()` for ASCII. */
const isDigits = (s: string) => /^[0-9]+$/.test(s);

/** Python's `int(s)` for base-10 strings. */
export function pyInt(s: string): number | undefined {
  const t = s.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) return undefined;
  return Number(t.replace(/_/g, ''));
}

/** Python's `s.split(None, 1)`. */
function splitWs1(s: string): string[] {
  const t = s.replace(/^\s+/, '');
  if (t === '') return [];
  const m = /^\S+/.exec(t)!;
  const rest = t.slice(m[0].length).replace(/^\s+/, '');
  return rest === '' ? [m[0]] : [m[0], rest];
}

/** Python's `s.split(sep, 1)`. */
function split1(s: string, sep: string): string[] {
  const i = s.indexOf(sep);
  return i === -1 ? [s] : [s.slice(0, i), s.slice(i + sep.length)];
}

type Arg = { t: 'imm'; v: number } | { t: 'reg'; r: number } | { t: 'label'; name: string } | { t: 'mem'; m: Mem };

function regnum(name: string): number {
  if (name in REG) return REG[name as RegName];
  return fail('reg', name);
}

function getregname(r: string): string {
  const t = r.trim();
  if (t === '') return 'zero';
  if (t[0] !== '%') fail('reg', t);
  return r.split('%')[1].trim();
}

function getarg(arg: string, vars: Record<string, number>): Arg {
  const tmp0 = arg.replace(/,/g, ' ').split(' \t').join('');
  if (tmp0 === '') return fail('args', arg);
  const c = tmp0[0];
  if (c === '$') {
    let value = tmp0.split('$')[1];
    let neg = 1;
    if (value[0] === '-') {
      value = value.slice(1);
      neg = -1;
    }
    if (!isDigits(value)) fail('imm', tmp0);
    return { t: 'imm', v: neg * Number(value) };
  }
  if (c === '%') return { t: 'reg', r: regnum(tmp0.split('%')[1]) };
  if (c === '.') return { t: 'label', name: tmp0 };
  if (/\p{L}/u.test(c)) {
    if (!(tmp0 in vars)) fail('var', tmp0);
    return { t: 'mem', m: { disp: vars[tmp0], r1: 0, r2: 0, scale: 1 } };
  }
  if (/[0-9]/.test(c) || c === '-' || c === '(') {
    let tmp = tmp0;
    let neg = 1;
    if (tmp[0] === '-') {
      tmp = tmp.slice(1);
      neg = -1;
    }
    if (tmp === '') fail('mem', tmp0);
    const s = tmp.split('(');
    if (s.length === 1) {
      const v = pyInt(tmp);
      if (v === undefined) fail('mem', tmp0);
      return { t: 'mem', m: { disp: neg * v!, r1: 0, r2: 0, scale: 1 } };
    }
    if (s.length === 2) {
      let value = 0;
      if (tmp[0] !== '(') {
        if (!isDigits(s[0].trim())) fail('mem', tmp0);
        value = neg * Number(s[0].trim());
      }
      const t = s[1].split(')')[0].split('__BREAK__');
      if (t.length === 1) return { t: 'mem', m: { disp: value, r1: regnum(getregname(t[0])), r2: 0, scale: 1 } };
      if (t.length === 2) return { t: 'mem', m: { disp: value, r1: regnum(getregname(t[0])), r2: regnum(getregname(t[1])), scale: 1 } };
      if (t.length === 3) {
        const r1 = regnum(getregname(t[0]));
        const r2 = regnum(getregname(t[1]));
        const scale = pyInt(t[2]);
        if (scale === undefined) fail('mem', tmp0);
        return { t: 'mem', m: { disp: value, r1, r2, scale: scale! } };
      }
    }
    return fail('mem', tmp0);
  }
  return fail('args', tmp0);
}

function removecommas(inargs: string): string {
  let inparen = false;
  let out = '';
  for (const ch of inargs) {
    if (ch === '(') {
      if (inparen) fail('paren', inargs.trim());
      inparen = true;
    }
    if (ch === ')') {
      if (!inparen) fail('paren', inargs.trim());
      inparen = false;
    }
    out += inparen && ch === ',' ? '__BREAK__' : ch;
  }
  if (inparen) fail('paren', inargs.trim());
  return out;
}

/** Splits off the comment the way x86.py does (everything after the first '#'). */
function stripComment(raw: string): { code: string; comment?: string } {
  const line = raw.replace(/\s+$/, '');
  const i = line.indexOf('#');
  if (i === -1) return { code: line };
  return { code: line.slice(0, i), comment: line.slice(i + 1).trim() };
}

const JUMPS: Record<string, JumpCond> = { j: 'always', jne: 'ne', je: 'eq', jlt: 'lt', jlte: 'lte', jgt: 'gt', jgte: 'gte' };

export function assemble(src: string, loadAddr = 1000): Assembled {
  const lines = src.split(/\r?\n/);
  const labels: Record<string, number> = {};
  const vars: Record<string, number> = {};
  const varSizes: Record<string, number> = {};
  const errors: AsmError[] = [];
  const source: SourceLine[] = [];

  // pass 1: labels and variables
  let pc = loadAddr;
  let data = 100;
  lines.forEach((raw, li) => {
    const { code, comment } = stripComment(raw);
    const tmp = code.split(/\s+/).filter(Boolean);
    const line = li + 1;
    if (tmp.length === 0) {
      source.push({ line, kind: comment !== undefined ? 'comment' : 'blank', code: '', comment });
      return;
    }
    if (tmp[0] === '.var') {
      source.push({ line, kind: 'var', code: code.trim(), comment });
      if (tmp.length !== 2 && tmp.length !== 3) {
        errors.push({ line, code: 'directive', detail: code.trim() });
        return;
      }
      const mul = tmp.length === 3 ? pyInt(tmp[2]) : 1;
      if (mul === undefined) {
        errors.push({ line, code: 'directive', detail: code.trim() });
        return;
      }
      vars[tmp[1]] = data;
      varSizes[tmp[1]] = mul;
      data += 4 * mul;
      if (!(data < loadAddr)) errors.push({ line, code: 'data', detail: tmp[1] });
    } else if (tmp[0][0] === '.') {
      source.push({ line, kind: 'label', code: code.trim(), comment });
      if (tmp.length !== 1) errors.push({ line, code: 'directive', detail: code.trim() });
      else labels[tmp[0]] = pc;
    } else {
      source.push({ line, kind: 'instr', code: code.trim(), comment, idx: pc - loadAddr });
      pc++;
    }
  });

  // pass 2: instructions
  const program: Instr[] = [];
  pc = loadAddr;
  for (const sl of source) {
    if (sl.kind !== 'instr') continue;
    const text = sl.code;
    const parts = splitWs1(text);
    const opcode = parts[0];
    const rest = parts[1];
    let op: Op = { k: 'nop' };
    try {
      op = parseOp(opcode, rest, parts.length, labels, vars);
    } catch (e) {
      if (!(e instanceof AsmFail)) throw e;
      errors.push({ line: sl.line, code: e.code, detail: e.code === 'opcode' || e.code === 'args' || e.code === 'operands' || e.code === 'target' ? opcode : e.detail });
    }
    const m = 'm' in op ? op.m : undefined;
    const staticAddr = m && m.r1 === 0 && m.r2 === 0 ? m.disp : undefined;
    program.push({ pc, line: sl.line, text, comment: sl.comment, op, staticAddr });
    pc++;
  }
  if (program.length === 0 && errors.length === 0) errors.push({ line: 1, code: 'empty', detail: '' });
  errors.sort((a, b) => a.line - b.line);
  return { program, labels, vars, varSizes, source, loadAddr, errors };
}

function two(opcode: string, rest: string | undefined, vars: Record<string, number>): [Arg, Arg] {
  if (rest === undefined) return fail('args', opcode);
  const r = split1(rest, ',');
  if (r.length !== 2) fail('args', opcode);
  return [getarg(r[0].trim(), vars), getarg(r[1].trim(), vars)];
}

function labelTarget(opcode: string, rest: string | undefined, labels: Record<string, number>, vars: Record<string, number>): { target: number; label: string } {
  if (rest === undefined) return fail('args', opcode);
  const a = getarg(rest.trim(), vars);
  if (a.t !== 'label') return fail('target', opcode);
  if (!(a.name in labels)) return fail('label', a.name);
  return { target: labels[a.name], label: a.name };
}

function parseOp(opcode: string, rest: string | undefined, nparts: number, labels: Record<string, number>, vars: Record<string, number>): Op {
  switch (opcode) {
    case 'mov': {
      if (rest === undefined) return fail('args', opcode);
      const r = removecommas(rest).split(',');
      if (r.length !== 2) fail('args', opcode);
      const a = getarg(r[0].trim(), vars);
      const b = getarg(r[1].trim(), vars);
      if (a.t === 'imm' && b.t === 'reg') return { k: 'mov_ir', imm: a.v, dst: b.r };
      if (a.t === 'mem' && b.t === 'reg') return { k: 'mov_mr', m: a.m, dst: b.r };
      if (a.t === 'reg' && b.t === 'mem') return { k: 'mov_rm', src: a.r, m: b.m };
      if (a.t === 'reg' && b.t === 'reg') return { k: 'mov_rr', src: a.r, dst: b.r };
      if (a.t === 'imm' && b.t === 'mem') return { k: 'mov_im', imm: a.v, m: b.m };
      return fail('operands', opcode);
    }
    case 'lea': {
      const [a, b] = two(opcode, rest, vars);
      if (a.t === 'mem' && b.t === 'reg') return { k: 'lea', m: a.m, dst: b.r };
      return fail('operands', opcode);
    }
    case 'neg': {
      if (nparts !== 2) fail('args', opcode);
      const a = getarg(rest!.trim(), vars);
      if (a.t !== 'reg') fail('operands', opcode);
      return { k: 'neg', r: (a as { r: number }).r };
    }
    case 'pop': {
      if (nparts === 1) return { k: 'pop' };
      const a = getarg(rest!.trim(), vars);
      if (a.t !== 'reg') fail('operands', opcode);
      return { k: 'pop_r', dst: (a as { r: number }).r };
    }
    case 'push': {
      if (rest === undefined) return fail('args', opcode);
      const a = getarg(rest.trim(), vars);
      if (a.t === 'reg') return { k: 'push_r', src: a.r };
      if (a.t === 'mem') return { k: 'push_m', m: a.m };
      return fail('operands', opcode);
    }
    case 'call':
      return { k: 'call', ...labelTarget(opcode, rest, labels, vars) };
    case 'ret':
      if (nparts !== 1) fail('args', opcode);
      return { k: 'ret' };
    case 'add':
    case 'sub':
    case 'mul': {
      const [a, b] = two(opcode, rest, vars);
      if (a.t === 'imm' && b.t === 'reg') return { k: `${opcode}_i`, imm: a.v, dst: b.r };
      if (a.t === 'reg' && b.t === 'reg') return { k: `${opcode}_r`, src: a.r, dst: b.r };
      return fail('operands', opcode);
    }
    case 'fetchadd':
    case 'xchg': {
      const [a, b] = two(opcode, rest, vars);
      if (a.t === 'reg' && b.t === 'mem') return { k: opcode, src: a.r, m: b.m };
      return fail('operands', opcode);
    }
    case 'test': {
      const [a, b] = two(opcode, rest, vars);
      if (a.t === 'imm' && b.t === 'reg') return { k: 'test_ir', imm: a.v, reg: b.r };
      if (a.t === 'reg' && b.t === 'reg') return { k: 'test_rr', src: a.r, dst: b.r };
      if (a.t === 'reg' && b.t === 'imm') return { k: 'test_ri', reg: a.r, imm: b.v };
      return fail('operands', opcode);
    }
    case 'nop':
      return { k: 'nop' };
    case 'halt':
      return { k: 'halt' };
    case 'yield':
      return { k: 'yield' };
    case 'rdump':
      return { k: 'rdump' };
    case 'mdump': {
      const v = rest === undefined ? undefined : pyInt(rest);
      if (v === undefined) return fail('args', opcode);
      return { k: 'mdump', addr: v };
    }
    default:
      if (opcode in JUMPS) return { k: 'jump', cond: JUMPS[opcode], ...labelTarget(opcode, rest, labels, vars) };
      return fail('opcode', opcode);
  }
}
