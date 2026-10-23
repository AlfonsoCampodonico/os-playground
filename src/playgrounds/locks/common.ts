import type { Assembled } from '../../sim/locks';

/** Per-thread categorical colors (literal class names so Tailwind sees them). */
export const T_BG = ['bg-c1', 'bg-c2', 'bg-c3', 'bg-c4', 'bg-c5', 'bg-c6'];
export const T_SOFT = ['bg-c1/15', 'bg-c2/15', 'bg-c3/15', 'bg-c4/15', 'bg-c5/15', 'bg-c6/15'];
export const T_TEXT = ['text-c1', 'text-c2', 'text-c3', 'text-c4', 'text-c5', 'text-c6'];
export const T_BORDER = ['border-c1', 'border-c2', 'border-c3', 'border-c4', 'border-c5', 'border-c6'];
export const tc = (arr: string[], t: number) => arr[t % arr.length];

/** Shared hover state for cross-highlighting between views. */
export interface Hover {
  /** Instruction index. */
  idx?: number;
  /** Memory address. */
  addr?: number;
  /** Step number (1-based). */
  step?: number;
}

export const SPRING = { type: 'spring', stiffness: 520, damping: 36 } as const;

/** Registers the program touches (always at least ax), in x86.py order, plus any traced ones. */
export function usedRegisters(asm: Assembled, traced: number[]): number[] {
  const set = new Set<number>(traced);
  for (const ins of asm.program) {
    const op = ins.op as unknown as Record<string, unknown>;
    for (const k of ['dst', 'src', 'r', 'reg']) if (typeof op[k] === 'number') set.add(op[k] as number);
    const m = op.m as { r1: number; r2: number } | undefined;
    if (m) {
      set.add(m.r1);
      set.add(m.r2);
    }
    if (['push_r', 'push_m', 'pop', 'pop_r', 'call', 'ret'].includes(ins.op.k)) set.add(7);
  }
  set.delete(0);
  if (set.size === 0) set.add(1);
  return [...set].sort((a, b) => a - b);
}
