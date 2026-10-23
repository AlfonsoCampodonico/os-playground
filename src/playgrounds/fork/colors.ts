/** Per-process colors (categorical c1..c6), as literal classes so Tailwind sees them. */
export const PROC = [
  { dot: 'bg-c1', text: 'text-c1', soft: 'bg-c1/12', border: 'border-c1/60', ring: 'ring-c1', bar: 'border-l-c1' },
  { dot: 'bg-c2', text: 'text-c2', soft: 'bg-c2/12', border: 'border-c2/60', ring: 'ring-c2', bar: 'border-l-c2' },
  { dot: 'bg-c3', text: 'text-c3', soft: 'bg-c3/12', border: 'border-c3/60', ring: 'ring-c3', bar: 'border-l-c3' },
  { dot: 'bg-c4', text: 'text-c4', soft: 'bg-c4/12', border: 'border-c4/60', ring: 'ring-c4', bar: 'border-l-c4' },
  { dot: 'bg-c5', text: 'text-c5', soft: 'bg-c5/12', border: 'border-c5/60', ring: 'ring-c5', bar: 'border-l-c5' },
  { dot: 'bg-c6', text: 'text-c6', soft: 'bg-c6/12', border: 'border-c6/60', ring: 'ring-c6', bar: 'border-l-c6' },
] as const;

export const proc = (i: number) => PROC[((i % 6) + 6) % 6];

export const SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as const;
