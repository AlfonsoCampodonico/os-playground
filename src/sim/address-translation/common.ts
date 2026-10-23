/** Shared types and helpers for the four address-translation mechanisms. */

export type Mech = 'bb' | 'seg' | 'lin' | 'ml';

/** What the MMU did with one virtual address. */
export type Outcome = 'ok' | 'violation' | 'invalid' | 'pdeFault' | 'pteFault';

/**
 * Why a setup cannot run. Codes map to localized text in the UI; `msg` is the
 * line the OSTEP script prints (after "Error: "), or our own for the cases
 * where the script would hang or crash instead.
 */
export interface RunError {
  code:
    | 'badInput'
    | 'psizeSmall'
    | 'asizeZero'
    | 'psizeLeAsize'
    | 'need2x'
    | 'noFit'
    | 'seg0Out'
    | 'seg1Out'
    | 'len0Big'
    | 'len1Big'
    | 'overlap'
    | 'vaRange'
    | 'tooBig'
    | 'notMultiple'
    | 'notPow2'
    | 'noFrames'
    | 'hang';
  msg: string;
}

/** A contiguous piece of memory drawn on the virtual and/or physical bar. */
export interface Region {
  id: string;
  /** Short label: "code", "heap", "VP 3", "PD", "PT 0x1f"... (UI may localize by `kind`). */
  label: string;
  kind: 'proc' | 'code' | 'heap' | 'stack' | 'seg0' | 'seg1' | 'page' | 'pd' | 'pt';
  /** Categorical color 1..6. */
  color: number;
  /** [start, end) in the virtual address space; null for page-table pages. */
  v: [number, number] | null;
  /** [start, end) in physical memory. */
  p: [number, number];
  /** -1 when the segment grows towards lower addresses (the stack). */
  grows?: 1 | -1;
}

/** One virtual address translated: a full snapshot of what the UI needs. */
export interface Step {
  i: number;
  va: number;
  outcome: Outcome;
  pa: number | null;
  /** Region the address falls in (or was checked against), if any. */
  region: string | null;
  /** The line(s) the OSTEP script prints for this address with -c. */
  ostep: string[];
  /** Running totals after this step. */
  valid: number;
  faults: number;
  /** Memory reads the MMU made to translate this address (page-table walks). */
  reads: number;
  totalReads: number;

  /* base & bounds */
  bound?: number;
  /* segmentation */
  seg?: number;
  /** Offset inside the segment as the hardware uses it (negative for the stack). */
  segOffset?: number;
  /* paging */
  vpn?: number;
  offset?: number;
  pfn?: number;
  /* linear paging: raw PTE value */
  pte?: number;
  /* multi-level */
  pdi?: number;
  pti?: number;
  pdeAddr?: number;
  pde?: number;
  pdeValid?: boolean;
  ptPage?: number;
  pteAddr?: number;
  pteValid?: boolean;
  /** Byte fetched at the physical address (multi-level homework asks for it). */
  value?: number;
}

export interface Segment {
  id: string;
  kind: 'code' | 'heap' | 'stack' | 'seg0' | 'seg1';
  /** Value of the base register. For a segment that grows negative this is its top. */
  base: number;
  size: number;
  grows: 1 | -1;
  /** Value of the segment-selector bits that pick it. */
  selector: number;
}

export interface MlMachine {
  pageBits: number;
  pdBits: number;
  ptBits: number;
  /** Bytes per PDE/PTE; the top bit is VALID and the rest is the frame number. */
  pteBytes: number;
  physPages: number;
  memory: Uint8Array;
  pdbr: number;
  /** Page-table pages, by page-directory index. */
  ptPages: Map<number, number>;
  /** vpn → pfn for every mapped page. */
  mapping: Map<number, number>;
}

export interface Run {
  mech: Mech;
  error: RunError | null;
  asize: number;
  psize: number;
  vaBits: number;
  paBits: number;
  vas: number[];
  steps: Step[];
  regions: Region[];
  /** Full stdout of the OSTEP script with -c, or null when it has no equivalent. */
  output: string | null;
  /** Equivalent command line, or null (book example with no script equivalent). */
  command: string | null;
  /** Caveats about the command: VAs or table typed by hand, etc. */
  notes: ('customVas' | 'noAFlag' | 'editedTable' | 'book' | 'editedRegs')[];
  /** Memory reads per translation: 0 base & bounds/segmentation, 1 linear, 2 multi-level. */
  perTranslation: number;
  /** Size of the translation structures in bytes (null: just registers). */
  tableBytes: number | null;
  /** Bytes a linear table with 4-byte PTEs would need for the same address space. */
  linearBytes: number | null;

  bb?: { base: number; limit: number };
  seg?: { segments: Segment[]; segBits: number; maxSeg: number; book: boolean };
  lin?: { pageSize: number; pageBits: number; vpnBits: number; table: number[]; pages: number; generated: number[] };
  ml?: MlMachine & { book: boolean };
}

/** OSTEP's `convert()`: "16", "64k", "32m", "1g" (plus hex as a convenience). NaN if unparseable. */
export function convertSize(raw: string): number {
  const s = String(raw).trim();
  const hx = /^0x([0-9a-f]+)$/i.exec(s);
  if (hx) return parseInt(hx[1], 16);
  const m = /^([+-]?\d+)([kmg])?$/i.exec(s);
  if (!m) return NaN;
  const mult = m[2] ? { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase() as 'k' | 'm' | 'g'] : 1;
  return parseInt(m[1], 10) * mult;
}

/** Bytes as OSTEP writes them: 16k, 1m, 100. */
export function sizeStr(n: number): string {
  if (n >= 1024 ** 3 && n % 1024 ** 3 === 0) return `${n / 1024 ** 3}g`;
  if (n >= 1024 ** 2 && n % 1024 ** 2 === 0) return `${n / 1024 ** 2}m`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`;
  return String(n);
}

/** Human size: 16 KB, 1 MB, 100 B. */
export function human(n: number): string {
  if (n >= 1024 ** 3 && n % 1024 ** 3 === 0) return `${n / 1024 ** 3} GB`;
  if (n >= 1024 ** 2 && n % 1024 ** 2 === 0) return `${n / 1024 ** 2} MB`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024} KB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Parses "0x3f80, 100 0b101" into addresses; returns the bad tokens too. */
export function parseVas(text: string): { vas: number[]; bad: string[] } {
  const vas: number[] = [];
  const bad: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const n = /^0x[0-9a-f]+$/i.test(tok) ? parseInt(tok.slice(2), 16) : /^0b[01]+$/i.test(tok) ? parseInt(tok.slice(2), 2) : /^\d+$/.test(tok) ? Number(tok) : NaN;
    if (Number.isFinite(n) && n >= 0 && n < 2 ** 32) vas.push(n);
    else bad.push(tok);
  }
  return { vas, bad };
}

export function hex(n: number, digits = 0): string {
  return '0x' + n.toString(16).padStart(digits, '0');
}

/** Python's `%Nd`. */
export const pd = (n: number, w = 0) => String(n).padStart(w);
/** Python's `%0Nx`. */
export const px = (n: number, w = 0) => n.toString(16).padStart(w, '0');

export function bitsFor(n: number): number {
  return n <= 1 ? 1 : Math.ceil(Math.log2(n));
}

export function isPow2(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function emptyRun(mech: Mech): Run {
  return {
    mech,
    error: null,
    asize: 0,
    psize: 0,
    vaBits: 1,
    paBits: 1,
    vas: [],
    steps: [],
    regions: [],
    output: null,
    command: null,
    notes: [],
    perTranslation: 0,
    tableBytes: null,
    linearBytes: null,
  };
}

/** Joins flags into a command line, skipping the ones left at their default. */
export function commandLine(script: string, flags: [string, string | number, string | number][]): string {
  const parts = [`./${script}`];
  for (const [flag, value, def] of flags) if (String(value) !== String(def)) parts.push(flag, String(value));
  parts.push('-c');
  return parts.join(' ');
}
