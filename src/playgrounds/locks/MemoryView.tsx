import clsx from 'clsx';
import { Badge } from '../../components/kit';
import type { LocksRun, LocksStep, Snapshot } from '../../sim/locks';
import type { Hover } from './common';
import type { LocksStrings } from './strings';

/** Shared memory cells: writes flash, reads glow, hover cross-highlights the code and the timeline. */
export function MemoryView({
  run,
  snap,
  step,
  stepKey,
  hover,
  setHover,
  onCell,
  s,
}: {
  run: LocksRun;
  snap: Snapshot;
  step?: LocksStep;
  stepKey: number;
  hover: Hover;
  setHover: (h: Hover) => void;
  onCell: (addr: number) => void;
  s: LocksStrings;
}) {
  if (run.cells.length === 0) return <p className="text-[13px] text-ink-3">—</p>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
      {run.cells.map((c, i) => {
        const wrote = step?.res.writes.some((w) => w.addr === c.addr);
        const read = step?.res.reads.includes(c.addr);
        const isCounter = c.addr === run.counterAddr;
        const hot = hover.addr === c.addr || (hover.idx !== undefined && run.asm.program[hover.idx]?.staticAddr === c.addr);
        return (
          <button
            key={c.addr}
            type="button"
            onClick={() => onCell(c.addr)}
            onMouseEnter={() => setHover({ addr: c.addr })}
            onMouseLeave={() => setHover({})}
            className={clsx(
              'rounded-xl border px-3 py-2 text-left transition-all duration-300',
              wrote ? 'border-accent bg-accent-soft' : read ? 'border-info/60 bg-info-soft' : hot ? 'border-line-strong bg-chip' : 'border-line bg-sunken',
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate font-mono text-[12px] font-medium text-ink">{c.label}</span>
              <span className="font-mono text-[10.5px] text-ink-3">{c.addr}</span>
            </div>
            <div key={wrote ? stepKey : 'v'} className={clsx('mt-0.5 font-serif text-[26px] leading-tight tabular-nums', wrote ? 'animate-pop text-accent' : 'text-ink')}>
              {snap.mem[i]}
            </div>
            {isCounter && (
              <Badge tone="accent" className="mt-0.5">
                {s.counter}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
