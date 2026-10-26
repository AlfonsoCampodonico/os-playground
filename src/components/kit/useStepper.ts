import { useCallback, useEffect, useRef, useState } from 'react';

export interface Stepper {
  /** Current step, 0..total (0 = initial state, before any step ran). */
  index: number;
  total: number;
  setIndex: (i: number) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  playing: boolean;
  toggle: () => void;
  /** Playback multiplier: 1× shows each step for STEP_MS. */
  speed: number;
  setSpeed: (s: number) => void;
}

export const SPEEDS = [0.5, 1, 2, 4, 8];

/** How long each step stays on screen at 1×, long enough to read the narration. */
export const STEP_MS = 2500;

const SPEED_KEY = 'speed';

function savedSpeed(): number | undefined {
  try {
    const n = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drives a step-through simulation. `total` is the number of steps; when it
 * changes (new inputs) the index is clamped, or moved to `startAt` if given.
 * Arrow keys / space / Home / End work anywhere outside form fields.
 */
export function useStepper(total: number, opts: { startAt?: 'first' | 'last'; keyboard?: boolean } = {}): Stepper {
  const { startAt, keyboard = true } = opts;
  const [index, setIndexRaw] = useState(startAt === 'last' ? total : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedRaw] = useState(1);

  // The student's last choice applies on every page; read after hydration.
  useEffect(() => {
    const s = savedSpeed();
    if (s !== undefined) setSpeedRaw(s);
  }, []);
  const setSpeed = useCallback((s: number) => {
    setSpeedRaw(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch {}
  }, []);

  const clamp = useCallback((i: number) => Math.max(0, Math.min(total, i)), [total]);
  const setIndex = useCallback((i: number) => setIndexRaw(clamp(i)), [clamp]);

  const prevTotal = useRef(total);
  useEffect(() => {
    if (prevTotal.current === total) return;
    prevTotal.current = total;
    setIndexRaw((i) => (startAt === 'last' ? total : startAt === 'first' ? 0 : Math.min(i, total)));
  }, [total, startAt]);

  const next = useCallback(() => setIndexRaw((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndexRaw((i) => clamp(i - 1)), [clamp]);
  const first = useCallback(() => {
    setPlaying(false);
    setIndexRaw(0);
  }, []);
  const last = useCallback(() => {
    setPlaying(false);
    setIndexRaw(total);
  }, [total]);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p) setIndexRaw((i) => (i >= total ? 0 : i));
      return !p;
    });
  }, [total]);

  useEffect(() => {
    if (!playing) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setIndexRaw((i) => clamp(i + 1)), STEP_MS / speed);
    return () => window.clearTimeout(id);
  }, [playing, index, total, speed, clamp]);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, () => void> = {
        ArrowRight: () => {
          setPlaying(false);
          next();
        },
        ArrowLeft: () => {
          setPlaying(false);
          prev();
        },
        Home: first,
        End: last,
        ' ': toggle,
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, next, prev, first, last, toggle]);

  return { index: clamp(index), total, setIndex, next, prev, first, last, playing, toggle, speed, setSpeed };
}
