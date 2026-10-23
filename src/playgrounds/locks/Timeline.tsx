import clsx from 'clsx';
import { motion } from 'motion/react';
import { memo, useEffect, useRef } from 'react';
import type { LocksRun, LocksStep } from '../../sim/locks';
import { SPRING, T_BG, T_TEXT, tc, type Hover } from './common';
import type { LocksStrings } from './strings';

const COL = 14;
const GAP = 10;
const PITCH = COL + GAP;
const WINDOW = 600;

type SwitchMark = 'interrupt' | 'halt' | 'yield' | undefined;

function markAfter(st: LocksStep, next: LocksStep | undefined): SwitchMark {
  if (!next || next.tid === st.tid) return undefined;
  if (st.res.rc === -1) return 'halt';
  if (st.res.rc === -2) return 'yield';
  return 'interrupt';
}

/**
 * One column per executed instruction, one lane per thread; the gaps between
 * columns are buttons that add or remove a context switch ("elegí cuándo
 * ocurre la interrupción").
 */
export function Timeline({
  run,
  index,
  onSelect,
  onGap,
  hover,
  setHover,
  s,
}: {
  run: LocksRun;
  index: number;
  onSelect: (step: number) => void;
  onGap: (gap: number) => void;
  hover: Hover;
  setHover: (h: Hover) => void;
  s: LocksStrings;
}) {
  const n = run.initial.threads.length;
  const total = run.steps.length;
  const start = total > WINDOW ? Math.max(0, Math.min(total - WINDOW, index - WINDOW / 2)) : 0;
  const end = Math.min(total, start + WINDOW);
  const scroller = useRef<HTMLDivElement>(null);

  // keep the current instruction in view
  useEffect(() => {
    const el = scroller.current;
    if (!el || index === 0) return;
    const x = (index - 1 - start) * PITCH;
    if (x < el.scrollLeft + PITCH || x > el.scrollLeft + el.clientWidth - 2 * PITCH) el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: 'smooth' });
  }, [index, start]);

  return (
    <div className="flex gap-2">
      <div className="flex shrink-0 flex-col gap-1 pt-[10px] font-mono text-[10.5px]">
        {Array.from({ length: n }, (_, t) => (
          <span key={t} className={clsx('flex h-4 items-center font-medium', tc(T_TEXT, t))}>
            T{t}
          </span>
        ))}
      </div>
      <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto pb-2" onMouseLeave={() => setHover({})}>
        <div className="relative" style={{ width: (end - start) * PITCH + 4, minHeight: 14 + n * 20 + 8 }}>
          <Columns run={run} start={start} end={end} index={index} hover={hover} setHover={setHover} onSelect={onSelect} onGap={onGap} s={s} />
          {index > 0 && index - 1 >= start && index - 1 < end && (
            <motion.div
              className="pointer-events-none absolute top-[8px] rounded-md ring-2 ring-accent"
              style={{ width: COL + 4, height: n * 20 }}
              initial={false}
              animate={{ x: (index - 1 - start) * PITCH - 2 }}
              transition={SPRING}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const Columns = memo(function Columns({
  run,
  start,
  end,
  index,
  hover,
  setHover,
  onSelect,
  onGap,
  s,
}: {
  run: LocksRun;
  start: number;
  end: number;
  index: number;
  hover: Hover;
  setHover: (h: Hover) => void;
  onSelect: (step: number) => void;
  onGap: (gap: number) => void;
  s: LocksStrings;
}) {
  const n = run.initial.threads.length;
  const out = [];
  for (let k = start; k < end; k++) {
    const st = run.steps[k];
    const future = k >= index;
    const hot =
      (hover.idx !== undefined && hover.idx === st.idx) ||
      (hover.addr !== undefined && (st.res.reads.includes(hover.addr) || st.res.writes.some((w) => w.addr === hover.addr))) ||
      hover.step === st.n;
    const x = (k - start) * PITCH;
    out.push(
      <button
        key={`c${k}`}
        type="button"
        aria-label={`#${st.n} T${st.tid} ${run.asm.program[st.idx].text}`}
        title={`#${st.n} · T${st.tid} · ${st.pc} ${run.asm.program[st.idx].text}`}
        onClick={() => onSelect(k + 1)}
        onMouseEnter={() => setHover({ step: st.n, idx: st.idx })}
        className="absolute top-0 flex flex-col items-center gap-1"
        style={{ left: x, width: COL }}
      >
        <span className={clsx('h-[6px] w-[6px] rounded-full', st.lost ? 'bg-bad' : st.spin ? 'bg-warn' : 'bg-transparent')} />
        {Array.from({ length: n }, (_, t) => (
          <span
            key={t}
            className={clsx(
              'h-4 w-full rounded-[4px] transition-all duration-200',
              t === st.tid ? clsx(tc(T_BG, t), future ? 'opacity-30' : 'opacity-100') : 'bg-sunken',
              hot && t === st.tid && 'scale-y-110 ring-2 ring-ink-3/60',
            )}
          />
        ))}
        <span className={clsx('h-[3px] w-full rounded-full', st.overlap ? (future ? 'bg-bad/30' : 'bg-bad') : 'bg-transparent')} />
      </button>,
    );
    if (k + 1 < run.steps.length && k + 1 < end) {
      const mark = markAfter(st, run.steps[k + 1]);
      const label = mark === 'halt' ? s.forced.halt : mark === 'yield' ? s.forced.yield : mark ? s.gapRemove : s.gapAdd;
      out.push(
        <button
          key={`g${k}`}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => onGap(k)}
          className="group absolute top-0 flex justify-center"
          style={{ left: x + COL, width: GAP, height: 14 + n * 20 + 6 }}
        >
          <span
            className={clsx(
              'mt-[8px] w-[2px] rounded-full transition-all duration-200',
              mark === 'interrupt' && 'bg-accent',
              mark === 'halt' && 'bg-ink-3',
              mark === 'yield' && 'bg-info',
              !mark && 'bg-transparent group-hover:bg-accent/40',
              mark && 'group-hover:opacity-50',
            )}
            style={{ height: n * 20 + 2 }}
          />
          {mark === 'interrupt' && <span className="absolute -top-0.5 text-[9px] leading-none text-accent">⚡</span>}
        </button>,
      );
    }
  }
  return <>{out}</>;
});
