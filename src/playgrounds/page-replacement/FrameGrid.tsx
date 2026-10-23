import clsx from 'clsx';
import { motion } from 'motion/react';
import { useStrings } from '../../components/kit';
import type { Policy, PrRun } from '../../sim/page-replacement';
import { S } from './strings';

const spring = { type: 'spring', stiffness: 520, damping: 30 } as const;

/**
 * The classic exam grid: one column per access, one row per frame. Cells show
 * the resident page; the one that hit or was loaded is colored, and the page
 * evicted in that column is shown struck through underneath.
 */
export function FrameGrid({
  run,
  index,
  policy,
  circular,
  frames,
  hover,
  setHover,
  onJump,
}: {
  run: PrRun;
  index: number;
  policy: Policy;
  circular: boolean;
  frames: number;
  hover: number | null;
  setHover: (p: number | null) => void;
  onJump: (i: number) => void;
}) {
  const s = useStrings(S);
  const cur = index - 1;
  const clock = policy === 'CLOCK';
  const rowHead = 'sticky left-0 z-10 bg-surface pr-3 text-left text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap';
  const col = (j: number) =>
    clsx('cursor-pointer px-0.5 transition-colors duration-200', j === cur ? 'bg-accent-soft' : 'hover:bg-chip', j === 0 && 'rounded-l-lg', j === run.trace.length - 1 && 'rounded-r-lg');
  const hov = (p: number | null | undefined) => p !== null && p !== undefined && hover === p;
  const enter = (p: number | null | undefined) => () => setHover(p ?? null);
  const leave = () => setHover(null);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-y-0.5 font-mono text-[13px]">
          <thead>
            <tr>
              <th className={rowHead}>{s.access}</th>
              {run.trace.map((p, j) => (
                <th key={j} className={col(j)} onClick={() => onJump(j + 1)}>
                  <button
                    type="button"
                    aria-label={s.jump(j + 1, p)}
                    title={s.jump(j + 1, p)}
                    onMouseEnter={enter(p)}
                    onMouseLeave={leave}
                    onFocus={enter(p)}
                    onBlur={leave}
                    className="flex w-8 flex-col items-center py-1"
                  >
                    <span className={clsx('text-[9.5px] font-normal', j === cur ? 'text-accent' : 'text-ink-3')}>{j + 1}</span>
                    <span
                      className={clsx(
                        'mt-0.5 grid h-6 w-7 place-items-center rounded-md text-[13px] font-semibold transition-all duration-200',
                        j < index ? 'text-ink' : 'text-ink-3',
                        hov(p) ? 'bg-ink text-surface' : j === cur ? 'bg-surface ring-1 ring-accent' : 'bg-sunken',
                      )}
                    >
                      {p}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: frames }, (_, f) => (
              <tr key={f}>
                <th className={rowHead}>
                  {s.frame} {f}
                </th>
                {run.steps.map((st, j) => {
                  const shown = j < index;
                  const v = shown ? st.slots[f] : null;
                  const placed = shown && st.slot === f;
                  const handHere = clock && circular && shown && st.hand === f;
                  return (
                    <td key={j} className={col(j)} onClick={() => onJump(j + 1)} onMouseEnter={enter(v)} onMouseLeave={leave}>
                      <div
                        className={clsx(
                          'relative mx-auto grid h-8 w-8 place-items-center rounded-md border transition-colors duration-300',
                          !shown && 'border-dashed border-line',
                          shown && v === null && 'border-line text-ink-3',
                          shown && v !== null && !placed && 'border-line bg-surface text-ink-2',
                          placed && (st.hit ? 'border-transparent bg-ok-soft font-semibold text-ok' : 'border-transparent bg-bad-soft font-semibold text-bad'),
                          hov(v) && 'ring-2 ring-ink/70',
                        )}
                      >
                        {v !== null && (
                          <motion.span
                            key={`${j}:${v}:${index > j}`}
                            initial={placed && j === cur ? { y: -10, scale: 0.6, opacity: 0 } : false}
                            animate={{ y: 0, scale: 1, opacity: 1 }}
                            transition={spring}
                          >
                            {v}
                          </motion.span>
                        )}
                        {clock && v !== null && st.ref[v] !== undefined && (
                          <span className="absolute right-0.5 top-0 text-[8.5px] font-normal text-ink-3">{st.ref[v]}</span>
                        )}
                        {handHere && <span className="absolute -left-0.5 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className={rowHead}>{s.fault}</th>
              {run.steps.map((st, j) => (
                <td key={j} className={clsx(col(j), 'h-6 text-center text-[11px]')} onClick={() => onJump(j + 1)}>
                  {j < index && (st.hit ? <span className="text-ok">✓</span> : <span className="font-semibold text-bad">F</span>)}
                </td>
              ))}
            </tr>
            <tr>
              <th className={rowHead}>{s.evicted}</th>
              {run.steps.map((st, j) => (
                <td key={j} className={clsx(col(j), 'h-7 text-center')} onClick={() => onJump(j + 1)} onMouseEnter={enter(st.victim)} onMouseLeave={leave}>
                  {j < index && st.victim !== null && (
                    <motion.span
                      key={`v${j}:${index > j}`}
                      initial={j === cur ? { y: -8, opacity: 0 } : false}
                      animate={{ y: 0, opacity: 1 }}
                      transition={spring}
                      className={clsx('inline-block rounded px-1 text-[12px] text-ink-3 line-through decoration-bad decoration-2', hov(st.victim) && 'bg-ink text-surface')}
                    >
                      {st.victim}
                    </motion.span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-bad-soft ring-1 ring-bad/40" /> {s.legendMiss}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-ok-soft ring-1 ring-ok/40" /> {s.legendHit}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-ink-3 line-through decoration-bad decoration-2">7</span> {s.legendEvict}
        </span>
        {clock && (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px]">¹</span> ref
          </span>
        )}
      </div>
    </div>
  );
}
