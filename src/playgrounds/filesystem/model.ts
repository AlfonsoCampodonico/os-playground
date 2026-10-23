import type { Effect, FsState } from '../../sim/filesystem';

/** What the user is pointing at: an inode or a data block. */
export type Focus = { kind: 'inode'; i: number } | { kind: 'block'; b: number } | null;

export interface Related {
  inodes: Set<number>;
  blocks: Set<number>;
  /** Directory entries, keyed `${block}/${name}`. */
  entries: Set<string>;
}

export const entryKey = (b: number, name: string) => `${b}/${name}`;

const NONE: Related = { inodes: new Set(), blocks: new Set(), entries: new Set() };

/** Everything that refers to (or is referred to by) the focused inode / block. */
export function related(s: FsState, f: Focus): Related {
  if (!f) return NONE;
  const r: Related = { inodes: new Set(), blocks: new Set(), entries: new Set() };
  const addInode = (i: number) => {
    r.inodes.add(i);
    const n = s.inodes[i];
    if (n?.type && n.addr >= 0) r.blocks.add(n.addr);
    s.blocks.forEach((blk, b) => blk.entries.forEach(([name, inum]) => inum === i && r.entries.add(entryKey(b, name))));
  };
  if (f.kind === 'inode') addInode(f.i);
  else {
    r.blocks.add(f.b);
    s.inodes.forEach((n, i) => n.type && n.addr === f.b && addInode(i));
  }
  return r;
}

export type Change = 'alloc' | 'free' | 'update';

export interface Marks {
  ibit: Set<number>;
  inode: Map<number, Change>;
  refs: Set<number>;
  addr: Set<number>;
  dbit: Set<number>;
  block: Map<number, Change>;
  entries: Set<string>;
}

export const NO_MARKS: Marks = { ibit: new Set(), inode: new Map(), refs: new Set(), addr: new Set(), dbit: new Set(), block: new Map(), entries: new Set() };

/** Turns a step's diff into per-cell highlight marks. */
export function marksOf(effects: Effect[]): Marks {
  const m: Marks = { ibit: new Set(), inode: new Map(), refs: new Set(), addr: new Set(), dbit: new Set(), block: new Map(), entries: new Set() };
  for (const e of effects) {
    if (e.k === 'ibit') m.ibit.add(e.i);
    else if (e.k === 'ialloc') m.inode.set(e.i, 'alloc');
    else if (e.k === 'ifree') m.inode.set(e.i, 'free');
    else if (e.k === 'refs' || e.k === 'addr') {
      (e.k === 'refs' ? m.refs : m.addr).add(e.i);
      if (!m.inode.has(e.i)) m.inode.set(e.i, 'update');
    } else if (e.k === 'dbit') {
      m.dbit.add(e.b);
      m.block.set(e.b, e.to ? 'alloc' : 'free');
    } else if (e.k === 'entry' || e.k === 'data') {
      if (e.k === 'entry' && e.add) m.entries.add(entryKey(e.b, e.name));
      if (!m.block.has(e.b)) m.block.set(e.b, 'update');
    }
  }
  return m;
}

/** Last step (1-based) at which each inode / block changed, up to `upTo`. */
export function lastChange(effectsPerStep: Effect[][], upTo: number, f: Focus): number | null {
  if (!f) return null;
  for (let k = Math.min(upTo, effectsPerStep.length); k >= 1; k--) {
    const hit = effectsPerStep[k - 1].some((e) =>
      f.kind === 'inode' ? 'i' in e && e.i === f.i : 'b' in e && e.b === f.b,
    );
    if (hit) return k;
  }
  return null;
}

export const spring = { type: 'spring', stiffness: 520, damping: 34 } as const;
