import { useCallback, useEffect, useRef, useState } from 'react';

type Prim = string | number | boolean;

function decode<T extends Prim>(raw: string, fallback: T): T {
  if (typeof fallback === 'number') {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (typeof fallback === 'boolean') return (raw === '1' || raw === 'true') as T;
  return raw as T;
}

function encode(v: Prim): string {
  return typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
}

/**
 * Playground setup that lives in the URL query (`?entries=4&policy=lru`), so a
 * link reproduces the exact example. Only values that differ from `defaults`
 * are written. Reads the URL after hydration, so the server-rendered HTML
 * always shows the defaults.
 */
export function useUrlState<T extends Record<string, Prim>>(defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const defaultsRef = useRef(defaults);
  const [state, setState] = useState<T>(defaults);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = defaultsRef.current;
    const next = { ...d };
    let changed = false;
    for (const k of Object.keys(d) as (keyof T & string)[]) {
      const raw = params.get(k);
      if (raw !== null) {
        next[k] = decode(raw, d[k]);
        changed = true;
      }
    }
    if (changed) setState(next);
  }, []);

  const writeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const d = defaultsRef.current;
      for (const k of Object.keys(d)) {
        if (state[k] === d[k]) params.delete(k);
        else params.set(k, encode(state[k]));
      }
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', url);
    }, 250);
    return () => window.clearTimeout(writeTimer.current);
  }, [state]);

  const update = useCallback((patch: Partial<T>) => setState((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setState(defaultsRef.current), []);
  return [state, update, reset];
}
