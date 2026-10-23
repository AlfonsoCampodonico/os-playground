import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { CC_NAMES, REG_NAMES, type LocksRun, type LocksStep, type Snapshot } from '../../sim/locks';
import { SPRING, T_BG, T_BORDER, T_SOFT, T_TEXT, tc, type Hover } from './common';
import type { LocksStrings } from './strings';

/** One column per thread: its code with its own PC, its registers and condition codes. */
export function ThreadView({
  run,
  snap,
  prev,
  step,
  stepKey,
  regs,
  showCC,
  hover,
  setHover,
  onLine,
  s,
}: {
  run: LocksRun;
  snap: Snapshot;
  prev: Snapshot;
  step?: LocksStep;
  stepKey: number;
  regs: number[];
  showCC: boolean;
  hover: Hover;
  setHover: (h: Hover) => void;
  onLine: (tid: number, idx: number) => void;
  s: LocksStrings;
}) {
  const { asm } = run;
  const csIdx = new Set<number>();
  for (const r of run.cs) for (let i = r.start; i < r.end; i++) csIdx.add(i);
  const lines = asm.source.filter((l) => l.kind === 'instr' || l.kind === 'label');
  const n = snap.threads.length;
  const sw = step?.events.find((e) => e.from !== e.to);

  return (
    <div className="overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${n}, minmax(200px, 1fr))` }}>
        {snap.threads.map((th, tid) => {
          const running = snap.running === tid;
          const pcIdx = th.pc - asm.loadAddr;
          const role = sw?.from === tid ? 'saved' : sw?.to === tid ? 'restored' : undefined;
          return (
            <div
              key={tid}
              className={clsx(
                'min-w-0 rounded-xl border transition-colors duration-300',
                running ? tc(T_BORDER, tid) : 'border-line',
                snap.inCS[tid] && (snap.overlap ? 'bg-bad-soft/60' : 'bg-warn-soft/40'),
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className={clsx('size-2.5 rounded-full', tc(T_BG, tid))} />
                <span className={clsx('font-mono text-[12.5px] font-medium', tc(T_TEXT, tid))}>{s.thread(tid)}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {running && (
                    <motion.span layoutId="locks-cpu" transition={SPRING} className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-accent-ink">
                      {s.cpu}
                    </motion.span>
                  )}
                  {!running && <span className="font-mono text-[11px] text-ink-3">{th.done ? s.done : s.ready}</span>}
                </span>
              </div>
              <AnimatePresence initial={false}>
                {snap.inCS[tid] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className={clsx('overflow-hidden px-3 font-mono text-[11px]', snap.overlap ? 'text-bad' : 'text-warn')}
                  >
                    <div className="py-1">● {s.inCS}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* code */}
              <div className="max-h-[340px] overflow-y-auto py-1.5 font-mono text-[12px] leading-[1.55]">
                {lines.map((l) => {
                  if (l.kind === 'label') {
                    return (
                      <div key={l.line} className="truncate px-3 pt-1 text-[11px] text-ink-3">
                        {l.code}
                      </div>
                    );
                  }
                  const idx = l.idx!;
                  const ins = asm.program[idx];
                  const executed = step?.tid === tid && step.idx === idx;
                  const here = !th.done && pcIdx === idx;
                  const hot = hover.idx === idx || (hover.addr !== undefined && ins.staticAddr === hover.addr);
                  return (
                    <button
                      key={l.line}
                      type="button"
                      onClick={() => onLine(tid, idx)}
                      onMouseEnter={() => setHover({ idx, addr: ins.staticAddr })}
                      onMouseLeave={() => setHover({})}
                      title={ins.comment}
                      className={clsx(
                        'flex w-full items-center gap-1.5 border-l-2 pr-2 text-left transition-colors duration-200',
                        csIdx.has(idx) ? 'border-warn/70' : 'border-transparent',
                        executed ? tc(T_SOFT, tid) : hot ? 'bg-chip' : 'hover:bg-chip/60',
                      )}
                    >
                      <span className="relative h-4 w-3.5 shrink-0">
                        {here && (
                          <motion.span layoutId={`locks-pc-${tid}`} transition={SPRING} className={clsx('absolute inset-0 grid place-items-center text-[10px]', tc(T_TEXT, tid))}>
                            ▶
                          </motion.span>
                        )}
                      </span>
                      <span className="w-9 shrink-0 text-[10.5px] text-ink-3">{ins.pc}</span>
                      <span className={clsx('truncate', executed ? 'text-ink' : here ? 'text-ink' : 'text-ink-2')}>{ins.text}</span>
                    </button>
                  );
                })}
              </div>

              {/* registers */}
              <motion.div
                key={role ? `${stepKey}-${role}` : 'still'}
                initial={role ? { scale: 0.97, opacity: 0.6 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING}
                className={clsx('border-t border-line px-3 py-2.5 transition-colors duration-500', role === 'saved' && 'bg-info-soft', role === 'restored' && 'bg-accent-soft')}
              >
                <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                  <span>{s.registers}</span>
                  {role && <span className={clsx('normal-case tracking-normal animate-rise', role === 'saved' ? 'text-info' : 'text-accent')}>{role === 'saved' ? `↓ ${s.saved}` : `↑ ${s.restored}`}</span>}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {regs.map((r) => {
                    const v = th.regs[r];
                    const changed = step?.tid === tid && prev.threads[tid]?.regs[r] !== v;
                    return (
                      <div key={r} className={clsx('rounded-md px-1.5 py-1 font-mono transition-colors duration-300', changed ? 'bg-accent-soft' : 'bg-sunken')}>
                        <div className="text-[10px] text-ink-3">%{REG_NAMES[r]}</div>
                        <div key={changed ? `${stepKey}` : 'v'} className={clsx('text-[13px] tabular-nums', changed ? 'animate-pop text-accent' : 'text-ink')}>
                          {v}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {showCC && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {CC_NAMES.map((c, i) => (
                      <span key={c} className={clsx('rounded px-1 font-mono text-[10.5px] transition-colors duration-300', th.cc[i] ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-3')}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
