/** Categorical job colors (c1..c6), as literal class names so Tailwind sees them. */
const BG = ['bg-c1', 'bg-c2', 'bg-c3', 'bg-c4', 'bg-c5', 'bg-c6'];
const TEXT = ['text-c1', 'text-c2', 'text-c3', 'text-c4', 'text-c5', 'text-c6'];
const FILL = ['fill-c1', 'fill-c2', 'fill-c3', 'fill-c4', 'fill-c5', 'fill-c6'];
const STROKE = ['stroke-c1', 'stroke-c2', 'stroke-c3', 'stroke-c4', 'stroke-c5', 'stroke-c6'];
const RING = ['ring-c1', 'ring-c2', 'ring-c3', 'ring-c4', 'ring-c5', 'ring-c6'];

export const jobBg = (i: number) => BG[i % 6];
export const jobText = (i: number) => TEXT[i % 6];
export const jobFill = (i: number) => FILL[i % 6];
export const jobStroke = (i: number) => STROKE[i % 6];
export const jobRing = (i: number) => RING[i % 6];
export const colorIndex = (i: number) => i % 6;

export const spring = { type: 'spring', stiffness: 520, damping: 38 } as const;
