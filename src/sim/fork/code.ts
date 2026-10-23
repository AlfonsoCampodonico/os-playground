import { PyRandom } from '../../lib/pyrandom';

/**
 * A tiny interpreter for the C you see in fork() exam questions: fork, wait,
 * waitpid, exit, exec*, printf (with stdio buffering), int variables, if /
 * for / while. The program is compiled to a small stack bytecode so a fork in
 * the middle of an expression (`fork() && fork()`) just copies the process:
 * pc, operand stack, variables and the stdout buffer.
 */

/* =================== Errors =================== */

export type CodeErrorKind =
  | 'char'
  | 'string'
  | 'expected'
  | 'unknownFn'
  | 'execv'
  | 'arrays'
  | 'pointers'
  | 'strings'
  | 'keyword'
  | 'otherFn'
  | 'args'
  | 'fmtArgs'
  | 'notLvalue'
  | 'undeclared'
  | 'divZero'
  | 'loopCtl'
  | 'empty';

export interface CodeError {
  kind: CodeErrorKind;
  line: number;
  /** Token, name or detail the message needs. */
  detail?: string;
  /** Second detail (e.g. expected count). */
  detail2?: string;
}

class CompileError extends Error {
  constructor(public err: CodeError) {
    super(err.kind);
  }
}

/* =================== Lexer =================== */

type TokT = 'num' | 'str' | 'id' | 'op' | 'eof';
interface Tok {
  t: TokT;
  v: string;
  n?: number;
  line: number;
}

const OPS3 = ['<<=', '>>='];
const OPS2 = ['&&', '||', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '->', '<<', '>>'];
const OPS1 = '+-*/%<>=!(){};,&?:[]|^~.';

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#' && lineStart) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    lineStart = false;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      let s = '';
      const start = line;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') throw new CompileError({ kind: 'string', line: start });
        if (src[i] === '\\') {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '0' ? '\0' : e;
          i += 2;
        } else s += src[i++];
      }
      if (i >= src.length) throw new CompileError({ kind: 'string', line: start });
      i++;
      // adjacent string literals concatenate, like C
      const prev = toks.at(-1);
      if (prev?.t === 'str') prev.v += s;
      else toks.push({ t: 'str', v: s, line: start });
      continue;
    }
    if (c === "'") {
      const e = src[i + 1] === '\\' ? (src[i + 2] === 'n' ? '\n' : src[i + 2] === '0' ? '\0' : src[i + 2]) : src[i + 1];
      const len = src[i + 1] === '\\' ? 4 : 3;
      if (src[i + len - 1] !== "'") throw new CompileError({ kind: 'char', line, detail: "'" });
      toks.push({ t: 'num', v: src.slice(i, i + len), n: e.charCodeAt(0), line });
      i += len;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^(0x[0-9a-fA-F]+|\d+)[uUlL]*/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[0], n: Number(m[1]), line });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0], line });
      i += m[0].length;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS3.includes(three)) {
      toks.push({ t: 'op', v: three, line });
      i += 3;
    } else if (OPS2.includes(two)) {
      toks.push({ t: 'op', v: two, line });
      i += 2;
    } else if (OPS1.includes(c)) {
      toks.push({ t: 'op', v: c, line });
      i++;
    } else throw new CompileError({ kind: 'char', line, detail: c });
  }
  toks.push({ t: 'eof', v: '', line });
  return toks;
}

/* =================== Bytecode =================== */

export type Val = number | string | { ref: string };

type Instr =
  | { op: 'push'; v: Val; line: number; stmt?: boolean }
  | { op: 'load' | 'store' | 'decl'; name: string; line: number; stmt?: boolean }
  | { op: 'bin'; o: string; line: number; stmt?: boolean }
  | { op: 'un'; o: string; line: number; stmt?: boolean }
  | { op: 'jmp' | 'jz' | 'jnz'; to: number; line: number; stmt?: boolean; tag?: 'if' | 'loop' }
  | { op: 'pop' | 'dup'; line: number; stmt?: boolean }
  | { op: 'call'; fn: string; argc: number; line: number; stmt?: boolean };

/** An instruction before the compiler stamps its line (Omit spread over the union). */
type InstrInput = Instr extends infer I ? (I extends unknown ? Omit<I, 'line'> & { line?: number } : never) : never;

const TYPE_WORDS = new Set(['int', 'pid_t', 'long', 'short', 'unsigned', 'signed', 'const', 'void', 'char', 'size_t', 'ssize_t', 'static', 'register', 'volatile']);
const INT_TYPES = new Set(['int', 'pid_t', 'long', 'short', 'unsigned', 'signed', 'const', 'size_t', 'ssize_t', 'static', 'register', 'volatile']);
const CONSTS: Record<string, Val> = { NULL: 0, EXIT_SUCCESS: 0, EXIT_FAILURE: 1, true: 1, false: 0, stdout: 'stdout', stderr: 'stderr', WNOHANG: 1 };
const UNSUPPORTED_KW = new Set(['switch', 'case', 'goto', 'struct', 'union', 'enum', 'typedef', 'sizeof', 'default']);

/** name → [min args, max args] */
const BUILTINS: Record<string, [number, number]> = {
  fork: [0, 0],
  getpid: [0, 0],
  getppid: [0, 0],
  wait: [1, 1],
  waitpid: [3, 3],
  exit: [1, 1],
  _exit: [1, 1],
  printf: [1, 16],
  fprintf: [2, 16],
  puts: [1, 1],
  fflush: [1, 1],
  sleep: [1, 1],
  execlp: [2, 16],
  execl: [2, 16],
  WEXITSTATUS: [1, 1],
  WIFEXITED: [1, 1],
};

interface Program {
  code: Instr[];
  /** Line of the implicit `exit(0)` at the end of main. */
  endLine: number;
}

class Compiler {
  code: Instr[] = [];
  private p = 0;
  private stmtPending = false;
  private line = 1;
  private loops: { breaks: number[]; continues: number[] }[] = [];

  constructor(private toks: Tok[]) {}

  /* ---- token helpers ---- */
  private peek(k = 0): Tok {
    return this.toks[Math.min(this.p + k, this.toks.length - 1)];
  }
  private next(): Tok {
    return this.toks[this.p++] ?? this.toks.at(-1)!;
  }
  private is(v: string, k = 0): boolean {
    const t = this.peek(k);
    return (t.t === 'op' || t.t === 'id') && t.v === v;
  }
  private accept(v: string): boolean {
    if (this.is(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  private expect(v: string): Tok {
    if (!this.is(v)) {
      const t = this.peek();
      // a missing ';' belongs to the line before the next token, like gcc says
      const line = t.t === 'eof' || v === ';' ? this.prevLine() : t.line;
      throw new CompileError({ kind: 'expected', line, detail: v, detail2: t.t === 'eof' ? '' : t.v });
    }
    return this.next();
  }
  private prevLine(): number {
    return this.toks[Math.max(0, this.p - 1)]?.line ?? 1;
  }

  /* ---- emit ---- */
  private emit(i: InstrInput): number {
    const ins = { ...i, line: i.line ?? this.line } as Instr;
    if (this.stmtPending) {
      ins.stmt = true;
      this.stmtPending = false;
    }
    this.code.push(ins);
    return this.code.length - 1;
  }
  private here(): number {
    return this.code.length;
  }
  private patch(at: number, to: number) {
    (this.code[at] as { to: number }).to = to;
  }
  private startStmt(line: number) {
    this.line = line;
    this.stmtPending = true;
  }

  /* ---- program ---- */
  compile(): Program {
    if (this.peek().t === 'eof') throw new CompileError({ kind: 'empty', line: 1 });
    // A function definition: types, a name, "(".
    let k = 0;
    while (this.peek(k).t === 'id' && TYPE_WORDS.has(this.peek(k).v)) k++;
    if (k > 0 && this.peek(k).t === 'id' && this.is('(', k + 1)) {
      const name = this.peek(k);
      if (name.v !== 'main') throw new CompileError({ kind: 'otherFn', line: name.line, detail: name.v });
      this.p += k + 2;
      let depth = 1;
      while (depth > 0 && this.peek().t !== 'eof') {
        const t = this.next();
        if (t.v === '(') depth++;
        if (t.v === ')') depth--;
      }
      this.expect('{');
      while (!this.is('}')) {
        if (this.peek().t === 'eof') throw new CompileError({ kind: 'expected', line: this.prevLine(), detail: '}', detail2: '' });
        this.statement();
      }
      const close = this.next();
      if (this.peek().t !== 'eof') {
        const t = this.peek();
        let j = 0;
        while (this.peek(j).t === 'id' && TYPE_WORDS.has(this.peek(j).v)) j++;
        throw new CompileError({ kind: 'otherFn', line: t.line, detail: this.peek(j).v || t.v });
      }
      return this.finish(close.line);
    }
    while (this.peek().t !== 'eof') this.statement();
    return this.finish(this.prevLine());
  }

  private finish(endLine: number): Program {
    this.startStmt(endLine);
    this.emit({ op: 'push', v: 0 });
    this.emit({ op: 'call', fn: 'exit', argc: 1 });
    return { code: this.code, endLine };
  }

  /* ---- statements ---- */
  private statement(): void {
    const t = this.peek();
    if (t.t === 'eof') throw new CompileError({ kind: 'expected', line: this.prevLine(), detail: ';', detail2: '' });
    if (this.accept('{')) {
      while (!this.is('}')) {
        if (this.peek().t === 'eof') throw new CompileError({ kind: 'expected', line: this.prevLine(), detail: '}', detail2: '' });
        this.statement();
      }
      this.next();
      return;
    }
    if (this.accept(';')) return;
    if (t.t === 'id' && UNSUPPORTED_KW.has(t.v)) throw new CompileError({ kind: 'keyword', line: t.line, detail: t.v });
    if (t.t === 'id' && TYPE_WORDS.has(t.v)) return this.declaration();
    if (t.t === 'id' && t.v === 'if') return this.ifStmt();
    if (t.t === 'id' && t.v === 'while') return this.whileStmt();
    if (t.t === 'id' && t.v === 'do') return this.doStmt();
    if (t.t === 'id' && t.v === 'for') return this.forStmt();
    if (t.t === 'id' && t.v === 'return') {
      this.next();
      this.startStmt(t.line);
      if (this.is(';')) this.emit({ op: 'push', v: 0 });
      else this.expr();
      this.emit({ op: 'call', fn: 'exit', argc: 1 });
      this.expect(';');
      return;
    }
    if (t.t === 'id' && (t.v === 'break' || t.v === 'continue')) {
      this.next();
      const loop = this.loops.at(-1);
      if (!loop) throw new CompileError({ kind: 'loopCtl', line: t.line, detail: t.v });
      this.startStmt(t.line);
      const j = this.emit({ op: 'jmp', to: -1 });
      (t.v === 'break' ? loop.breaks : loop.continues).push(j);
      this.expect(';');
      return;
    }
    this.startStmt(t.line);
    this.expr();
    this.emit({ op: 'pop' });
    this.expect(';');
  }

  private declaration(): void {
    const first = this.peek();
    const types: string[] = [];
    while (this.peek().t === 'id' && TYPE_WORDS.has(this.peek().v)) types.push(this.next().v);
    if (types.includes('char')) throw new CompileError({ kind: 'strings', line: first.line });
    if (types.includes('void') || !types.every((x) => INT_TYPES.has(x))) throw new CompileError({ kind: 'strings', line: first.line });
    this.startStmt(first.line);
    do {
      if (this.is('*')) throw new CompileError({ kind: 'pointers', line: this.peek().line });
      const name = this.next();
      if (name.t !== 'id') throw new CompileError({ kind: 'expected', line: name.line, detail: 'nombre', detail2: name.v });
      if (this.is('[')) throw new CompileError({ kind: 'arrays', line: name.line });
      if (this.is('(')) throw new CompileError({ kind: 'otherFn', line: name.line, detail: name.v });
      if (this.accept('=')) this.assignExpr();
      else this.emit({ op: 'push', v: 0 });
      this.emit({ op: 'decl', name: name.v });
    } while (this.accept(','));
    this.expect(';');
  }

  private ifStmt(): void {
    const t = this.next();
    this.startStmt(t.line);
    this.expect('(');
    this.expr();
    this.expect(')');
    const jz = this.emit({ op: 'jz', to: -1, tag: 'if' });
    this.statement();
    if (this.is('else')) {
      this.next();
      const jmp = this.emit({ op: 'jmp', to: -1, line: t.line });
      this.patch(jz, this.here());
      this.statement();
      this.patch(jmp, this.here());
    } else this.patch(jz, this.here());
  }

  private whileStmt(): void {
    const t = this.next();
    const top = this.here();
    this.startStmt(t.line);
    this.expect('(');
    this.expr();
    this.expect(')');
    const jz = this.emit({ op: 'jz', to: -1, tag: 'loop' });
    this.loops.push({ breaks: [], continues: [] });
    this.statement();
    this.emit({ op: 'jmp', to: top, line: t.line });
    const loop = this.loops.pop()!;
    this.patch(jz, this.here());
    loop.breaks.forEach((b) => this.patch(b, this.here()));
    loop.continues.forEach((c) => this.patch(c, top));
  }

  private doStmt(): void {
    const t = this.next();
    const top = this.here();
    this.loops.push({ breaks: [], continues: [] });
    this.statement();
    const w = this.expect('while');
    const condAt = this.here();
    this.startStmt(w.line);
    this.expect('(');
    this.expr();
    this.expect(')');
    this.expect(';');
    this.emit({ op: 'jnz', to: top, line: t.line });
    const loop = this.loops.pop()!;
    loop.breaks.forEach((b) => this.patch(b, this.here()));
    loop.continues.forEach((c) => this.patch(c, condAt));
  }

  private forStmt(): void {
    const t = this.next();
    this.expect('(');
    // init
    if (this.peek().t === 'id' && TYPE_WORDS.has(this.peek().v)) this.declaration();
    else if (!this.accept(';')) {
      this.startStmt(t.line);
      this.expr();
      this.emit({ op: 'pop' });
      this.expect(';');
    }
    // cond
    const top = this.here();
    let jz = -1;
    if (!this.is(';')) {
      this.startStmt(t.line);
      this.expr();
      jz = this.emit({ op: 'jz', to: -1, tag: 'loop' });
    }
    this.expect(';');
    // update: compile into a side buffer, append after the body
    const saved = this.code;
    this.code = [];
    if (!this.is(')')) {
      this.startStmt(t.line);
      this.expr();
      this.emit({ op: 'pop' });
      while (this.accept(',')) {
        this.expr();
        this.emit({ op: 'pop' });
      }
    }
    const update = this.code;
    this.code = saved;
    this.stmtPending = false;
    this.expect(')');
    this.loops.push({ breaks: [], continues: [] });
    this.statement();
    const updAt = this.here();
    const shift = updAt;
    for (const ins of update) {
      const copy = { ...ins } as Instr;
      if ('to' in copy) copy.to += shift;
      this.code.push(copy);
    }
    this.emit({ op: 'jmp', to: top, line: t.line });
    const loop = this.loops.pop()!;
    if (jz !== -1) this.patch(jz, this.here());
    loop.breaks.forEach((b) => this.patch(b, this.here()));
    loop.continues.forEach((c) => this.patch(c, updAt));
  }

  /* ---- expressions ---- */
  private expr(): void {
    this.assignExpr();
  }

  private assignExpr(): void {
    const t = this.peek();
    const op = this.peek(1);
    if (t.t === 'id' && op.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(op.v) && !(t.v in CONSTS) && !(t.v in BUILTINS)) {
      this.p += 2;
      if (op.v !== '=') this.emit({ op: 'load', name: t.v, line: t.line });
      this.assignExpr();
      if (op.v !== '=') this.emit({ op: 'bin', o: op.v[0] });
      this.emit({ op: 'dup' });
      this.emit({ op: 'store', name: t.v, line: t.line });
      return;
    }
    this.ternary();
    if (this.peek().t === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(this.peek().v)) throw new CompileError({ kind: 'notLvalue', line: this.peek().line });
  }

  private ternary(): void {
    this.binary(0);
    if (this.accept('?')) {
      const jz = this.emit({ op: 'jz', to: -1 });
      this.assignExpr();
      this.expect(':');
      const jmp = this.emit({ op: 'jmp', to: -1 });
      this.patch(jz, this.here());
      this.assignExpr();
      this.patch(jmp, this.here());
    }
  }

  private static PREC: string[][] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

  private binary(level: number): void {
    if (level >= Compiler.PREC.length) return this.unary();
    const ops = Compiler.PREC[level];
    this.binary(level + 1);
    while (this.peek().t === 'op' && ops.includes(this.peek().v)) {
      const op = this.next().v;
      if (op === '&&' || op === '||') {
        // short-circuit: a && b  →  a; jz F; b; jz F; 1; jmp E; F: 0; E:
        const j1 = this.emit({ op: op === '&&' ? 'jz' : 'jnz', to: -1 });
        this.binary(level + 1);
        const j2 = this.emit({ op: op === '&&' ? 'jz' : 'jnz', to: -1 });
        this.emit({ op: 'push', v: op === '&&' ? 1 : 0 });
        const jend = this.emit({ op: 'jmp', to: -1 });
        this.patch(j1, this.here());
        this.patch(j2, this.here());
        this.emit({ op: 'push', v: op === '&&' ? 0 : 1 });
        this.patch(jend, this.here());
      } else {
        this.binary(level + 1);
        this.emit({ op: 'bin', o: op });
      }
    }
  }

  private unary(): void {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~')) {
      this.next();
      this.unary();
      if (t.v !== '+') this.emit({ op: 'un', o: t.v });
      return;
    }
    if (t.t === 'op' && (t.v === '++' || t.v === '--')) {
      this.next();
      const name = this.next();
      if (name.t !== 'id') throw new CompileError({ kind: 'notLvalue', line: t.line });
      this.emit({ op: 'load', name: name.v });
      this.emit({ op: 'push', v: 1 });
      this.emit({ op: 'bin', o: t.v[0] });
      this.emit({ op: 'dup' });
      this.emit({ op: 'store', name: name.v });
      return;
    }
    if (t.t === 'op' && t.v === '&') {
      this.next();
      const name = this.next();
      if (name.t !== 'id') throw new CompileError({ kind: 'pointers', line: t.line });
      this.emit({ op: 'push', v: { ref: name.v } });
      return;
    }
    if (t.t === 'op' && t.v === '*') throw new CompileError({ kind: 'pointers', line: t.line });
    // cast: (int) x, (char *) NULL
    if (t.t === 'op' && t.v === '(' && this.peek(1).t === 'id' && TYPE_WORDS.has(this.peek(1).v)) {
      this.next();
      while (this.peek().t === 'id' && TYPE_WORDS.has(this.peek().v)) this.next();
      while (this.accept('*'));
      this.expect(')');
      this.unary();
      return;
    }
    this.postfix();
  }

  private postfix(): void {
    const t = this.next();
    if (t.t === 'num') {
      this.emit({ op: 'push', v: t.n! });
      return;
    }
    if (t.t === 'str') {
      this.emit({ op: 'push', v: t.v });
      return;
    }
    if (t.t === 'op' && t.v === '(') {
      this.expr();
      this.expect(')');
      return;
    }
    if (t.t === 'id') {
      if (UNSUPPORTED_KW.has(t.v)) throw new CompileError({ kind: 'keyword', line: t.line, detail: t.v });
      if (this.is('(')) return this.call(t);
      if (this.is('[')) throw new CompileError({ kind: 'arrays', line: t.line });
      if (t.v in CONSTS) {
        this.emit({ op: 'push', v: CONSTS[t.v] });
        return;
      }
      if (this.is('++') || this.is('--')) {
        const op = this.next().v;
        this.emit({ op: 'load', name: t.v, line: t.line });
        this.emit({ op: 'dup' });
        this.emit({ op: 'push', v: 1 });
        this.emit({ op: 'bin', o: op[0] });
        this.emit({ op: 'store', name: t.v });
        return;
      }
      this.emit({ op: 'load', name: t.v, line: t.line });
      return;
    }
    if (t.t === 'eof') throw new CompileError({ kind: 'expected', line: this.prevLine(), detail: ';', detail2: '' });
    throw new CompileError({ kind: 'expected', line: t.line, detail: 'expresión', detail2: t.v });
  }

  private call(name: Tok): void {
    const fn = name.v;
    if (fn === 'execvp' || fn === 'execv' || fn === 'execve' || fn === 'execvpe') throw new CompileError({ kind: 'execv', line: name.line, detail: fn });
    const spec = BUILTINS[fn];
    if (!spec) throw new CompileError({ kind: 'unknownFn', line: name.line, detail: fn });
    this.expect('(');
    let argc = 0;
    let fmt: string | undefined;
    if (!this.is(')')) {
      do {
        const tk = this.peek();
        const isLastStr = tk.t === 'str';
        this.assignExpr();
        if (isLastStr && ((fn === 'printf' && argc === 0) || (fn === 'fprintf' && argc === 1))) fmt = tk.v;
        argc++;
      } while (this.accept(','));
    }
    this.expect(')');
    if (argc < spec[0] || argc > spec[1]) throw new CompileError({ kind: 'args', line: name.line, detail: fn, detail2: spec[0] === spec[1] ? String(spec[0]) : `${spec[0]}+` });
    if (fmt !== undefined) {
      const wanted = countSpecs(fmt);
      const given = argc - (fn === 'fprintf' ? 2 : 1);
      if (wanted !== given) throw new CompileError({ kind: 'fmtArgs', line: name.line, detail: String(wanted), detail2: String(given) });
    }
    this.emit({ op: 'call', fn, argc, line: name.line });
  }
}

const SPEC_RE = /%([-+ 0#]*)(\d*)(?:\.(\d+))?(hh|h|ll|l|z)?([diuxXcs%])/g;

function countSpecs(fmt: string): number {
  let n = 0;
  for (const m of fmt.matchAll(SPEC_RE)) if (m[5] !== '%') n++;
  return n;
}

function formatC(fmt: string, args: Val[]): string {
  let i = 0;
  return fmt.replace(SPEC_RE, (_all, flags: string, width: string, _prec, _len, conv: string) => {
    if (conv === '%') return '%';
    const a = args[i++];
    let s: string;
    if (conv === 's') s = typeof a === 'string' ? a : '(null)';
    else {
      const n = typeof a === 'number' ? a : 0;
      s = conv === 'c' ? String.fromCharCode(n) : conv === 'x' ? (n >>> 0).toString(16) : conv === 'X' ? (n >>> 0).toString(16).toUpperCase() : conv === 'u' ? String(n >>> 0) : String(n);
    }
    const w = Number(width || 0);
    if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : flags.includes('0') && conv !== 's' ? s.padStart(w, '0') : s.padStart(w);
    return s;
  });
}

export function compileC(src: string): { program?: Program; error?: CodeError } {
  try {
    return { program: new Compiler(lex(src)).compile() };
  } catch (e) {
    if (e instanceof CompileError) return { error: e.err };
    throw e;
  }
}

/* =================== Runtime =================== */

export type Policy = 'parent' | 'child' | 'random';
export type ProcState = 'running' | 'ready' | 'waiting' | 'sleeping' | 'zombie' | 'done';

export const INIT_PID = 1;
export const SHELL_PID = 99;
export const ROOT_PID = 100;
/** fork() fails (returns -1) once this many processes were created, like hitting RLIMIT_NPROC. */
export const MAX_PROCS = 40;
export const MAX_STEPS = 1500;
/** Steps a sleep(1) lasts (global clock ticks once per step). */
export const TICKS_PER_SECOND = 6;

export interface ProcSnap {
  pid: number;
  ppid: number;
  /** Original parent (differs once orphaned). */
  origPpid: number;
  /** Program image: "a.out" until an exec. */
  image: string;
  state: ProcState;
  /** Line it will run next (null once it exited or became a new image). */
  line: number | null;
  vars: [string, number][];
  /** Pending stdout (not yet flushed). */
  buf: string;
  /** Index into c1..c6. */
  color: number;
  exitCode?: number;
  orphan: boolean;
  /** Step (1-based) in which it was created; 0 for the original process. */
  bornAt: number;
  /** Step in which it exited, if it did. */
  exitedAt?: number;
  /** What it waits for while blocked in wait/waitpid (-1 = any child). */
  waitFor?: number;
}

export interface OutLine {
  pid: number;
  text: string;
  /** 1-based step that printed it. */
  step: number;
  stream: 'out' | 'err';
  /** Printed by an exec'd program, not by printf. */
  image?: string;
}

export type CodeEvent =
  | { k: 'fork'; pid: number; child: number; bufCopied: string }
  | { k: 'forkFail'; pid: number }
  | { k: 'set'; pid: number; name: string; value: number; decl: boolean }
  | { k: 'print'; pid: number; text: string; flushed: boolean }
  | { k: 'err'; pid: number; text: string }
  | { k: 'exit'; pid: number; code: number; to: 'zombie' | 'done'; reaper?: number; lostBuf?: string }
  | { k: 'orphan'; pid: number; from: number }
  | { k: 'wake'; pid: number; by: number }
  | { k: 'block'; pid: number; target: number }
  | { k: 'reap'; pid: number; child: number; code: number }
  | { k: 'waitNone'; pid: number }
  | { k: 'sleep'; pid: number; secs: number }
  | { k: 'wakeSleep'; pid: number }
  | { k: 'exec'; pid: number; argv: string[]; ok: boolean; lostBuf: string }
  | { k: 'image'; pid: number; image: string; lines: number }
  | { k: 'branch'; pid: number; taken: boolean; loop: boolean }
  /** A child runs for the first time: for it, fork() returned 0. */
  | { k: 'first'; pid: number };

export interface CodeStep {
  /** Process that ran in this step. */
  pid: number;
  /** Line it executed (where it started this step). */
  line: number | null;
  events: CodeEvent[];
  procs: ProcSnap[];
  /** Output lines so far (prefix length into `run.output`). */
  outLen: number;
  zombies: number;
  orphans: number;
  created: number;
}

export interface CodeRun {
  initial: ProcSnap[];
  steps: CodeStep[];
  output: OutLine[];
  error?: CodeError;
  /** Stopped at MAX_STEPS. */
  truncated: boolean;
  /** Line of the implicit exit at the end of main. */
  endLine: number;
}

interface Proc {
  pid: number;
  ppid: number;
  origPpid: number;
  image: string;
  state: ProcState;
  pc: number;
  stack: Val[];
  vars: Map<string, number>;
  buf: string;
  color: number;
  exitCode?: number;
  orphan: boolean;
  bornAt: number;
  exitedAt?: number;
  waitFor?: number;
  wakeAt?: number;
  /** argv of the exec'd program, which runs (prints and exits) next time it is scheduled. */
  execArgv?: string[];
}

/** What an exec'd command prints, so `execlp("ls", ...)` has something to show. */
export function fakeCommand(argv: string[]): { lines: string[]; code: number } | null {
  const [cmd, ...args] = argv;
  const base = cmd.split('/').at(-1)!;
  switch (base) {
    case 'ls':
      return args.includes('-l')
        ? { lines: ['total 24', '-rwxr-xr-x 1 alumno alumno 16000 oct 20 10:00 a.out', '-rw-r--r-- 1 alumno alumno   412 oct 20 09:58 fork.c', '-rw-r--r-- 1 alumno alumno    95 oct 20 09:12 notas.txt'], code: 0 }
        : { lines: ['a.out  fork.c  notas.txt'], code: 0 };
    case 'echo':
      return { lines: [args.join(' ')], code: 0 };
    case 'wc':
      return { lines: [args.length ? `  29 107 1030 ${args.filter((a) => !a.startsWith('-')).join(' ')}` : '      0       0       0'], code: 0 };
    case 'date':
      return { lines: ['lun 20 oct 2026 10:00:00 -03'], code: 0 };
    case 'pwd':
      return { lines: ['/home/alumno/so'], code: 0 };
    case 'whoami':
      return { lines: ['alumno'], code: 0 };
    case 'cat':
      return { lines: args.length ? args.map((a) => `(contenido de ${a})`) : [], code: 0 };
    case 'ps':
      return { lines: ['  PID TTY          TIME CMD', '   99 pts/0    00:00:00 bash', '  100 pts/0    00:00:00 a.out'], code: 0 };
    case 'true':
      return { lines: [], code: 0 };
    case 'false':
      return { lines: [], code: 1 };
    case 'uname':
      return { lines: ['Linux'], code: 0 };
    default:
      return null;
  }
}

export interface CodeConfig {
  src: string;
  policy: Policy;
  seed: number;
}

export function runC(cfg: CodeConfig): CodeRun {
  const { program, error } = compileC(cfg.src);
  if (!program) return { initial: [], steps: [], output: [], error, truncated: false, endLine: error?.line ?? 1 };
  const code = program.code;
  const rng = new PyRandom(cfg.seed);
  const procs = new Map<number, Proc>();
  const output: OutLine[] = [];
  const steps: CodeStep[] = [];
  let nextPid = ROOT_PID + 1;
  let created = 0;
  let orphans = 0;
  let clock = 0;
  const queue: number[] = [];
  let current: number | null = ROOT_PID;

  const root: Proc = { pid: ROOT_PID, ppid: SHELL_PID, origPpid: SHELL_PID, image: 'a.out', state: 'running', pc: 0, stack: [], vars: new Map(), buf: '', color: 0, orphan: false, bornAt: 0 };
  procs.set(ROOT_PID, root);

  const lineOf = (p: Proc): number | null => (p.state === 'zombie' || p.state === 'done' || p.execArgv ? null : (code[p.pc]?.line ?? program.endLine));
  const snapAll = (): ProcSnap[] =>
    [...procs.values()].map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      origPpid: p.origPpid,
      image: p.image,
      state: p.state,
      line: lineOf(p),
      vars: [...p.vars.entries()],
      buf: p.buf,
      color: p.color,
      exitCode: p.exitCode,
      orphan: p.orphan,
      bornAt: p.bornAt,
      exitedAt: p.exitedAt,
      waitFor: p.state === 'waiting' ? p.waitFor : undefined,
    }));
  const initial = snapAll();

  let stepNo = 0;
  let events: CodeEvent[] = [];
  let runtimeError: CodeError | undefined;

  const emitOut = (pid: number, text: string, stream: 'out' | 'err', image?: string) => {
    output.push({ pid, text, step: stepNo, stream, image });
  };
  /** Writes to the stdio buffer; flushes complete lines (stdout to a terminal is line-buffered). */
  const writeStdout = (p: Proc, text: string) => {
    p.buf += text;
    const cut = p.buf.lastIndexOf('\n');
    if (cut === -1) {
      events.push({ k: 'print', pid: p.pid, text, flushed: false });
      return;
    }
    const ready = p.buf.slice(0, cut);
    p.buf = p.buf.slice(cut + 1);
    for (const l of ready.split('\n')) emitOut(p.pid, l, 'out');
    events.push({ k: 'print', pid: p.pid, text, flushed: true });
  };
  const flush = (p: Proc) => {
    if (p.buf === '') return;
    for (const l of p.buf.split('\n')) emitOut(p.pid, l, 'out');
    p.buf = '';
  };
  const ready = (p: Proc, front = false) => {
    p.state = 'ready';
    if (!queue.includes(p.pid)) front ? queue.unshift(p.pid) : queue.push(p.pid);
  };
  const childrenOf = (pid: number) => [...procs.values()].filter((c) => c.ppid === pid && c.state !== 'done');

  const doExit = (p: Proc, status: number, flushBuf: boolean) => {
    let lostBuf: string | undefined;
    if (flushBuf) flush(p);
    else if (p.buf) {
      lostBuf = p.buf;
      p.buf = '';
    }
    p.exitCode = status & 0xff;
    p.exitedAt = stepNo;
    p.execArgv = undefined;
    const qi = queue.indexOf(p.pid);
    if (qi !== -1) queue.splice(qi, 1);
    if (current === p.pid) current = null;
    // its children are adopted by init, which reaps zombies right away
    for (const c of childrenOf(p.pid)) {
      c.ppid = INIT_PID;
      if (c.state === 'zombie') {
        c.state = 'done';
        events.push({ k: 'reap', pid: INIT_PID, child: c.pid, code: c.exitCode ?? 0 });
      } else {
        c.orphan = true;
        orphans++;
        events.push({ k: 'orphan', pid: c.pid, from: p.pid });
      }
    }
    if (p.ppid === INIT_PID || p.ppid === SHELL_PID) {
      p.state = 'done';
      events.push({ k: 'exit', pid: p.pid, code: p.exitCode, to: 'done', reaper: p.ppid, lostBuf });
      return;
    }
    p.state = 'zombie';
    events.push({ k: 'exit', pid: p.pid, code: p.exitCode, to: 'zombie', lostBuf });
    const parent = procs.get(p.ppid)!;
    if (parent.state === 'waiting' && (parent.waitFor === -1 || parent.waitFor === p.pid)) {
      ready(parent);
      events.push({ k: 'wake', pid: parent.pid, by: p.pid });
    }
  };

  const truthy = (v: Val) => (typeof v === 'number' ? v !== 0 : true);
  const num = (v: Val) => (typeof v === 'number' ? v : 0);
  const fail = (e: CodeError) => {
    runtimeError = e;
  };

  /** Runs `p` for one step. */
  const runStep = (p: Proc) => {
    // an exec'd image: print its output and exit
    if (p.execArgv) {
      const r = fakeCommand(p.execArgv)!;
      for (const l of r.lines) emitOut(p.pid, l, 'out', p.image);
      events.push({ k: 'image', pid: p.pid, image: p.image, lines: r.lines.length });
      doExit(p, r.code, true);
      return;
    }
    let executed = 0;
    // A step is one statement. A step that starts mid-statement (a child right
    // after fork, a parent resuming) finishes it and runs the next one too,
    // unless it already did something visible (a call).
    let sawStmt = false;
    let sawCall = false;
    let yieldAfter = false;
    for (let guard = 0; guard < 10000; guard++) {
      const ins = code[p.pc];
      if (!ins) {
        doExit(p, 0, true);
        return;
      }
      if (executed > 0 && ins.stmt && (sawStmt || sawCall)) return;
      if (yieldAfter && ins.op === 'call') return;
      executed++;
      if (ins.stmt) sawStmt = true;
      if (ins.op === 'call') sawCall = true;
      const st = p.stack;
      switch (ins.op) {
        case 'push':
          st.push(ins.v);
          p.pc++;
          break;
        case 'load': {
          if (!p.vars.has(ins.name)) return fail({ kind: 'undeclared', line: ins.line, detail: ins.name });
          st.push(p.vars.get(ins.name)!);
          p.pc++;
          break;
        }
        case 'store':
        case 'decl': {
          if (ins.op === 'store' && !p.vars.has(ins.name)) return fail({ kind: 'undeclared', line: ins.line, detail: ins.name });
          const v = num(st.pop()!) | 0;
          p.vars.set(ins.name, v);
          events.push({ k: 'set', pid: p.pid, name: ins.name, value: v, decl: ins.op === 'decl' });
          p.pc++;
          break;
        }
        case 'bin': {
          const b = num(st.pop()!);
          const a = num(st.pop()!);
          let r: number;
          switch (ins.o) {
            case '+': r = a + b; break;
            case '-': r = a - b; break;
            case '*': r = Math.imul(a, b); break;
            case '/':
              if (b === 0) return fail({ kind: 'divZero', line: ins.line });
              r = Math.trunc(a / b);
              break;
            case '%':
              if (b === 0) return fail({ kind: 'divZero', line: ins.line });
              r = a % b;
              break;
            case '==': r = +(a === b); break;
            case '!=': r = +(a !== b); break;
            case '<': r = +(a < b); break;
            case '>': r = +(a > b); break;
            case '<=': r = +(a <= b); break;
            case '>=': r = +(a >= b); break;
            case '&': r = a & b; break;
            case '|': r = a | b; break;
            case '^': r = a ^ b; break;
            case '<<': r = a << b; break;
            case '>>': r = a >> b; break;
            default: r = 0;
          }
          st.push(r | 0);
          p.pc++;
          break;
        }
        case 'un': {
          const a = num(st.pop()!);
          st.push(ins.o === '!' ? +(a === 0) : ins.o === '-' ? -a | 0 : ~a);
          p.pc++;
          break;
        }
        case 'jmp':
          p.pc = ins.to;
          break;
        case 'jz':
        case 'jnz': {
          const v = truthy(st.pop()!);
          const jump = ins.op === 'jz' ? !v : v;
          if (ins.tag) events.push({ k: 'branch', pid: p.pid, taken: v, loop: ins.tag === 'loop' });
          p.pc = jump ? ins.to : p.pc + 1;
          break;
        }
        case 'pop':
          st.pop();
          p.pc++;
          break;
        case 'dup':
          st.push(st[st.length - 1]);
          p.pc++;
          break;
        case 'call': {
          const args = st.splice(st.length - ins.argc, ins.argc);
          const ret = (v: Val) => {
            st.push(v);
            p.pc++;
          };
          switch (ins.fn) {
            case 'fork': {
              if (procs.size >= MAX_PROCS) {
                events.push({ k: 'forkFail', pid: p.pid });
                ret(-1);
                break;
              }
              const pid = nextPid++;
              created++;
              const child: Proc = {
                ...p,
                pid,
                ppid: p.pid,
                origPpid: p.pid,
                state: 'ready',
                pc: p.pc + 1,
                stack: [...st, 0],
                vars: new Map(p.vars),
                color: created % 6,
                orphan: false,
                bornAt: stepNo,
                exitCode: undefined,
                exitedAt: undefined,
                waitFor: undefined,
                wakeAt: undefined,
              };
              procs.set(pid, child);
              events.push({ k: 'fork', pid: p.pid, child: pid, bufCopied: p.buf });
              ret(pid);
              if (cfg.policy === 'parent') {
                ready(child);
                yieldAfter = true;
              } else if (cfg.policy === 'child') {
                ready(p, true);
                child.state = 'running';
                current = pid;
                return;
              } else {
                ready(child);
                ready(p);
                current = null;
                return;
              }
              break;
            }
            case 'getpid':
              ret(p.pid);
              break;
            case 'getppid':
              ret(p.ppid);
              break;
            case 'WEXITSTATUS':
              ret((num(args[0]) >> 8) & 0xff);
              break;
            case 'WIFEXITED':
              ret(1);
              break;
            case 'wait':
            case 'waitpid': {
              const target = ins.fn === 'wait' ? -1 : num(args[0]);
              const ref = ins.fn === 'wait' ? args[0] : args[1];
              const opts = ins.fn === 'waitpid' ? num(args[2]) : 0;
              const kids = childrenOf(p.pid).filter((c) => target <= 0 || c.pid === target);
              if (kids.length === 0) {
                events.push({ k: 'waitNone', pid: p.pid });
                ret(-1);
                break;
              }
              const z = kids.filter((c) => c.state === 'zombie').sort((a, b) => a.exitedAt! - b.exitedAt! || a.pid - b.pid)[0];
              if (z) {
                z.state = 'done';
                if (typeof ref === 'object') {
                  if (!p.vars.has(ref.ref)) return fail({ kind: 'undeclared', line: ins.line, detail: ref.ref });
                  p.vars.set(ref.ref, (z.exitCode ?? 0) << 8);
                }
                events.push({ k: 'reap', pid: p.pid, child: z.pid, code: z.exitCode ?? 0 });
                ret(z.pid);
                break;
              }
              if (opts & 1) {
                ret(0);
                break;
              }
              // block: put the args back so the call runs again on wake-up
              st.push(...args);
              p.state = 'waiting';
              p.waitFor = target <= 0 ? -1 : target;
              events.push({ k: 'block', pid: p.pid, target: p.waitFor });
              if (current === p.pid) current = null;
              return;
            }
            case 'exit':
            case '_exit':
              doExit(p, num(args[0]), ins.fn === 'exit');
              return;
            case 'printf':
            case 'puts': {
              const text = ins.fn === 'puts' ? `${typeof args[0] === 'string' ? args[0] : ''}\n` : formatC(typeof args[0] === 'string' ? args[0] : '', args.slice(1));
              writeStdout(p, text);
              ret(text.length);
              break;
            }
            case 'fprintf': {
              const text = formatC(typeof args[1] === 'string' ? args[1] : '', args.slice(2));
              if (args[0] === 'stdout') writeStdout(p, text);
              else {
                for (const l of text.replace(/\n$/, '').split('\n')) emitOut(p.pid, l, 'err');
                events.push({ k: 'err', pid: p.pid, text });
              }
              ret(text.length);
              break;
            }
            case 'fflush':
              if (p.buf) {
                events.push({ k: 'print', pid: p.pid, text: '', flushed: true });
                flush(p);
              }
              ret(0);
              break;
            case 'sleep': {
              const secs = Math.max(0, num(args[0]));
              ret(0);
              if (secs === 0) break;
              p.state = 'sleeping';
              p.wakeAt = clock + secs * TICKS_PER_SECOND;
              events.push({ k: 'sleep', pid: p.pid, secs });
              if (current === p.pid) current = null;
              return;
            }
            case 'execlp':
            case 'execl': {
              const argv: string[] = [];
              for (const a of args.slice(1)) {
                if (a === 0) break;
                argv.push(typeof a === 'string' ? a : String(a));
              }
              const file = typeof args[0] === 'string' ? args[0] : '';
              const known = fakeCommand([file, ...argv.slice(1)]);
              if (!known) {
                events.push({ k: 'exec', pid: p.pid, argv: [file, ...argv.slice(1)], ok: false, lostBuf: '' });
                ret(-1);
                break;
              }
              const lostBuf = p.buf;
              p.buf = '';
              p.image = file.split('/').at(-1)!;
              p.execArgv = [file, ...argv.slice(1)];
              p.vars = new Map();
              p.stack = [];
              events.push({ k: 'exec', pid: p.pid, argv: [file, ...argv.slice(1)], ok: true, lostBuf });
              return;
            }
          }
          break;
        }
      }
    }
  };

  const runnable = () => [...procs.values()].filter((p) => p.state === 'running' || p.state === 'ready');
  const wakeSleepers = () => {
    for (const p of [...procs.values()].sort((a, b) => a.pid - b.pid)) {
      if (p.state === 'sleeping' && p.wakeAt! <= clock) {
        p.wakeAt = undefined;
        ready(p);
        events.push({ k: 'wakeSleep', pid: p.pid });
      }
    }
  };

  let truncated = false;
  const ran = new Set<number>();
  while (!runtimeError) {
    events = [];
    wakeSleepers();
    if (runnable().length === 0) {
      const sleepers = [...procs.values()].filter((p) => p.state === 'sleeping');
      if (sleepers.length === 0) break;
      clock = Math.min(...sleepers.map((p) => p.wakeAt!));
      wakeSleepers();
    }
    if (stepNo >= MAX_STEPS) {
      truncated = true;
      break;
    }
    // pick who runs
    let pid: number;
    if (cfg.policy === 'random') {
      const list = runnable().sort((a, b) => a.pid - b.pid);
      pid = rng.choice(list).pid;
    } else if (current !== null && procs.get(current)!.state === 'running') pid = current;
    else pid = queue.shift()!;
    const qi = queue.indexOf(pid);
    if (qi !== -1) queue.splice(qi, 1);
    for (const p of procs.values()) if (p.state === 'running' && p.pid !== pid) ready(p);
    const p = procs.get(pid)!;
    p.state = 'running';
    current = pid;
    stepNo++;
    clock++;
    const line = lineOf(p);
    const pre = events;
    events = [];
    if (!ran.has(pid)) {
      ran.add(pid);
      if (pid !== ROOT_PID) events.push({ k: 'first', pid });
    }
    runStep(p);
    if (p.state === 'running' && current !== pid) ready(p);
    const all = [...pre, ...events];
    const snapshot = snapAll();
    steps.push({
      pid,
      line,
      events: all,
      procs: snapshot,
      outLen: output.length,
      zombies: snapshot.filter((s) => s.state === 'zombie').length,
      orphans,
      created,
    });
    if (runtimeError) break;
  }

  return { initial, steps, output, error: runtimeError, truncated, endLine: program.endLine };
}

/* =================== Presets & random programs =================== */

export const CODE_PRESETS = {
  hola: `fork();
fork();
printf("hola\\n");`,
  loop: `for (int i = 0; i < 3; i++) {
  fork();
}
printf("hola\\n");`,
  p1: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  printf("hello world (pid:%d)\\n", (int) getpid());
  int rc = fork();
  if (rc < 0) {          // fork failed; exit
    fprintf(stderr, "fork failed\\n");
    exit(1);
  } else if (rc == 0) {  // child (new process)
    printf("hello, I am child (pid:%d)\\n", (int) getpid());
  } else {               // parent goes down this path
    printf("hello, I am parent of %d (pid:%d)\\n", rc, (int) getpid());
  }
  return 0;
}`,
  p2: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(int argc, char *argv[]) {
  printf("hello world (pid:%d)\\n", (int) getpid());
  int rc = fork();
  if (rc < 0) {
    fprintf(stderr, "fork failed\\n");
    exit(1);
  } else if (rc == 0) {
    printf("hello, I am child (pid:%d)\\n", (int) getpid());
  } else {
    int rc_wait = wait(NULL);
    printf("hello, I am parent of %d (rc_wait:%d) (pid:%d)\\n",
           rc, rc_wait, (int) getpid());
  }
  return 0;
}`,
  p3: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(int argc, char *argv[]) {
  printf("hello world (pid:%d)\\n", (int) getpid());
  int rc = fork();
  if (rc < 0) {
    fprintf(stderr, "fork failed\\n");
    exit(1);
  } else if (rc == 0) {
    printf("hello, I am child (pid:%d)\\n", (int) getpid());
    // en el libro: execvp(myargs[0], myargs) con {"wc", "p3.c", NULL}
    execlp("wc", "wc", "p3.c", NULL);
    printf("this shouldn't print out");
  } else {
    int rc_wait = wait(NULL);
    printf("hello, I am parent of %d (rc_wait:%d) (pid:%d)\\n",
           rc, rc_wait, (int) getpid());
  }
  return 0;
}`,
  zombie: `int main() {
  pid_t pid = fork();
  if (pid == 0) {
    printf("hijo: termino ya\\n");
    exit(0);
  }
  sleep(2);
  printf("padre: no hice wait, mi hijo es zombie\\n");
  wait(NULL);
  printf("padre: ahora sí lo recogí\\n");
  return 0;
}`,
  orphan: `int main() {
  pid_t pid = fork();
  if (pid == 0) {
    sleep(1);
    printf("hijo: mi padre ahora es %d\\n", getppid());
    exit(0);
  }
  printf("padre: me voy sin esperar\\n");
  return 0;
}`,
  vars: `int main() {
  int x = 5;
  pid_t pid = fork();
  if (pid == 0) {
    x++;
    x = x + 10;
    printf("hijo: x = %d\\n", x);
  } else {
    wait(NULL);
    printf("padre: x = %d\\n", x);
  }
  return 0;
}`,
} as const;

export type CodePresetId = keyof typeof CODE_PRESETS;

/** A short exam-style program, reproducible from a seed. */
export function randomProgram(seed: number): string {
  const r = new PyRandom(seed);
  const word = r.choice(['hola', 'chau', 'SO', 'fork', 'x']);
  switch (r.randbelow(6)) {
    case 0: {
      const k = r.randint(2, 3);
      return `${'fork();\n'.repeat(k)}printf("${word}\\n");`;
    }
    case 1: {
      const n = r.randint(2, 3);
      return `for (int i = 0; i < ${n}; i++) {\n  fork();\n  printf("${word} %d\\n", i);\n}`;
    }
    case 2:
      return `if (fork() == 0) {\n  fork();\n  printf("${word}\\n");\n}\nprintf("fin\\n");`;
    case 3: {
      const form = r.choice(['fork() && fork()', 'fork() || fork()', 'fork() && fork() || fork()', '(fork() || fork()) && fork()']);
      return `${form};\nprintf("${word}\\n");`;
    }
    case 4: {
      const x = r.randint(1, 9);
      const a = r.randint(1, 5);
      const b = r.randint(1, 5);
      return `int x = ${x};\nif (fork() == 0) {\n  x += ${a};\n  printf("hijo x=%d\\n", x);\n} else {\n  wait(NULL);\n  x -= ${b};\n  printf("padre x=%d\\n", x);\n}`;
    }
    default: {
      const n = r.randint(2, 3);
      return `for (int i = 0; i < ${n}; i++) {\n  if (fork() == 0) {\n    printf("hijo %d\\n", i);\n    exit(0);\n  }\n}\nwhile (wait(NULL) > 0);\nprintf("${word}\\n");`;
    }
  }
}
