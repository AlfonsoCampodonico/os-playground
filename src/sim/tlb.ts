import { PyRandom } from '../lib/pyrandom';

export type TlbPolicy = 'lru' | 'fifo' | 'random';

export interface TlbConfig {
  /** Page size in bytes (power of two). */
  pageSize: number;
  entries: number;
  policy: TlbPolicy;
  /** Seed for the random policy. */
  seed: number;
  /** Virtual addresses, in access order. */
  trace: number[];
}

export interface TlbEntry {
  valid: boolean;
  vpn: number;
  pfn: number;
  /** Access number (1-based) when the entry was filled; FIFO evicts the smallest. */
  loadedAt: number;
  /** Access number of the last use; LRU evicts the smallest. */
  lastUsed: number;
}

export interface TlbStep {
  va: number;
  vpn: number;
  offset: number;
  hit: boolean;
  /** TLB slot that served (hit) or was filled (miss). */
  slot: number;
  /** VPN that was evicted to make room, if any. */
  evicted?: number;
  pfn: number;
  pa: number;
  /** TLB contents after this access. */
  tlb: TlbEntry[];
  hits: number;
  misses: number;
}

export interface TlbRun {
  offsetBits: number;
  vpnBits: number;
  vaBits: number;
  initial: TlbEntry[];
  steps: TlbStep[];
  /** Page table rows touched by the trace, sorted by VPN. */
  pageTable: { vpn: number; pfn: number }[];
}

export function log2(n: number): number {
  return Math.round(Math.log2(n));
}

/** Stable, scrambled-looking frame for each page so translations read like a real page table. */
export function pfnOf(vpn: number): number {
  return (vpn * 37 + 11) % 251;
}

function emptyEntry(): TlbEntry {
  return { valid: false, vpn: 0, pfn: 0, loadedAt: 0, lastUsed: 0 };
}

export function simulateTlb(cfg: TlbConfig): TlbRun {
  const offsetBits = log2(cfg.pageSize);
  const maxVa = Math.max(0, ...cfg.trace);
  const vaBits = Math.max(8, maxVa.toString(2).length, offsetBits + 1);
  const vpnBits = vaBits - offsetBits;
  const rng = new PyRandom(cfg.seed);

  let tlb: TlbEntry[] = Array.from({ length: cfg.entries }, emptyEntry);
  const initial = tlb.map((e) => ({ ...e }));
  const steps: TlbStep[] = [];
  let hits = 0;
  let misses = 0;

  cfg.trace.forEach((va, k) => {
    const n = k + 1;
    const vpn = Math.floor(va / cfg.pageSize);
    const offset = va % cfg.pageSize;
    tlb = tlb.map((e) => ({ ...e }));
    let slot = tlb.findIndex((e) => e.valid && e.vpn === vpn);
    const hit = slot !== -1;
    let evicted: number | undefined;

    if (hit) {
      hits++;
      tlb[slot].lastUsed = n;
    } else {
      misses++;
      slot = tlb.findIndex((e) => !e.valid);
      if (slot === -1) {
        slot = victim(tlb, cfg.policy, rng);
        evicted = tlb[slot].vpn;
      }
      tlb[slot] = { valid: true, vpn, pfn: pfnOf(vpn), loadedAt: n, lastUsed: n };
    }

    const pfn = tlb[slot].pfn;
    steps.push({ va, vpn, offset, hit, slot, evicted, pfn, pa: pfn * cfg.pageSize + offset, tlb, hits, misses });
  });

  const vpns = [...new Set(cfg.trace.map((va) => Math.floor(va / cfg.pageSize)))].sort((a, b) => a - b);
  return { offsetBits, vpnBits, vaBits, initial, steps, pageTable: vpns.map((vpn) => ({ vpn, pfn: pfnOf(vpn) })) };
}

function victim(tlb: TlbEntry[], policy: TlbPolicy, rng: PyRandom): number {
  if (policy === 'random') return rng.randbelow(tlb.length);
  const key = policy === 'lru' ? 'lastUsed' : 'loadedAt';
  let best = 0;
  for (let i = 1; i < tlb.length; i++) if (tlb[i][key] < tlb[best][key]) best = i;
  return best;
}

/** Parses "0x1004, 0x2010 4096 0b101" into addresses; returns the bad tokens too. */
export function parseTrace(text: string): { trace: number[]; bad: string[] } {
  const trace: number[] = [];
  const bad: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const n = /^0x[0-9a-f]+$/i.test(tok) ? parseInt(tok.slice(2), 16) : /^0b[01]+$/i.test(tok) ? parseInt(tok.slice(2), 2) : /^\d+$/.test(tok) ? Number(tok) : NaN;
    if (Number.isFinite(n) && n >= 0 && n < 2 ** 32) trace.push(n);
    else bad.push(tok);
  }
  return { trace, bad };
}

export function hex(n: number, digits = 0): string {
  return '0x' + n.toString(16).padStart(digits, '0');
}

/**
 * Traces for the presets. `array` is OSTEP Figure 19.2: ten 4-byte ints at
 * virtual address 100 with 16-byte pages (3 misses, 7 hits).
 */
export const PRESETS = {
  array: { pageSize: 16, entries: 4, trace: Array.from({ length: 10 }, (_, i) => 100 + 4 * i) },
  twice: { pageSize: 16, entries: 4, trace: [...Array.from({ length: 10 }, (_, i) => 100 + 4 * i), ...Array.from({ length: 10 }, (_, i) => 100 + 4 * i)] },
  loop: { pageSize: 4096, entries: 3, trace: [0x0000, 0x1000, 0x2000, 0x3000, 0x0000, 0x1000, 0x2000, 0x3000, 0x0000, 0x1000, 0x2000, 0x3000] },
  locality: { pageSize: 4096, entries: 4, trace: [0x1004, 0x2010, 0x1008, 0x3000, 0x1010, 0x4000, 0x5000, 0x2014] },
} as const satisfies Record<string, { pageSize: number; entries: number; trace: readonly number[] }>;

export type PresetId = keyof typeof PRESETS;

/** A short trace with some locality, for the "random problem" button. */
export function randomProblem(seed: number): { pageSize: number; entries: number; policy: TlbPolicy; trace: number[] } {
  const r = new PyRandom(seed);
  const pageSize = r.choice([16, 64, 256, 4096]);
  const entries = r.randint(2, 4);
  const policy = r.choice(['lru', 'fifo'] as const);
  const pages = Array.from({ length: r.randint(entries + 1, entries + 3) }, () => r.randint(0, 15));
  const len = r.randint(8, 12);
  const trace: number[] = [];
  let cur = r.choice(pages);
  for (let i = 0; i < len; i++) {
    if (r.random() < 0.45) cur = r.choice(pages);
    trace.push(cur * pageSize + r.randbelow(pageSize / 4) * 4);
  }
  return { pageSize, entries, policy, trace };
}
