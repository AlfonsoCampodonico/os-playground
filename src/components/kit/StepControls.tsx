import clsx from 'clsx';
import { useUi } from './lang';
import { IconButton, Icons, Kbd } from './ui';
import { SPEEDS, STEP_MS, type Stepper } from './useStepper';

/** Transport bar: first / back / play / forward / last, a scrubber and speed. */
export function StepControls({ stepper, className }: { stepper: Stepper; className?: string }) {
  const t = useUi();
  const { index, total, playing } = stepper;
  const pct = total === 0 ? 100 : (index / total) * 100;
  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-1.5">
        <IconButton label={t.first} onClick={stepper.first} disabled={index === 0}>
          <Icons.first />
        </IconButton>
        <IconButton label={t.back} onClick={stepper.prev} disabled={index === 0}>
          <Icons.prev />
        </IconButton>
        <button
          type="button"
          onClick={stepper.toggle}
          disabled={total === 0}
          aria-label={playing ? t.pause : t.play}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-ink shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {playing ? <Icons.pause className="size-4" /> : <Icons.play className="size-4 fill-current" />}
          {playing ? t.pause : t.play}
        </button>
        <IconButton label={t.forward} onClick={stepper.next} disabled={index >= total}>
          <Icons.next />
        </IconButton>
        <IconButton label={t.last} onClick={stepper.last} disabled={index >= total}>
          <Icons.last />
        </IconButton>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative h-5 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            aria-label={t.stepOf(index, total)}
            min={0}
            max={Math.max(total, 1)}
            value={index}
            disabled={total === 0}
            onChange={(e) => stepper.setIndex(Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="w-[86px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink-3">
          {index}/{total}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stepper.speed === s}
              title={t.perStep(STEP_MS / s / 1000)}
              onClick={() => stepper.setSpeed(s)}
              className={clsx(
                'rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors',
                stepper.speed === s ? 'bg-chip text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <Kbd>␣</Kbd>
        </span>
      </div>
    </div>
  );
}
