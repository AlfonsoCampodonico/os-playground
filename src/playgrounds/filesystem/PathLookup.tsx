import clsx from 'clsx';
import { motion } from 'motion/react';
import { Fragment } from 'react';
import { IconButton, Icons, Narration, TextField, useUi, type Stepper } from '../../components/kit';
import type { Lookup } from '../../sim/filesystem';
import { spring, type Focus } from './model';
import type { Strings } from './strings';

interface Props {
  path: string;
  setPath: (p: string) => void;
  lk: Lookup;
  stepper: Stepper;
  suggestions: string[];
  onHover: (f: Focus) => void;
  s: Strings;
}

export function PathLookup({ path, setPath, lk, stepper, suggestions, onHover, s }: Props) {
  const t = useUi();
  const complete = stepper.index >= lk.steps.length;
  return (
    <div className="flex flex-col gap-3">
      <TextField value={path} onChange={setPath} placeholder={s.lookupPh} ariaLabel={s.lookupTitle} invalid={!!lk.error && lk.error.code === 'EINVAL'} />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11.5px] text-ink-3">{s.tryPaths}</span>
          {suggestions.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPath(p)}
              className={clsx('rounded-md px-1.5 py-0.5 font-mono text-[11.5px] transition-colors', p === path ? 'bg-info-soft text-info' : 'bg-sunken text-ink-2 hover:text-ink')}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <IconButton label={t.first} className="size-8" onClick={stepper.first} disabled={stepper.index === 0}>
          <Icons.first className="size-3.5" />
        </IconButton>
        <IconButton label={t.back} className="size-8" onClick={stepper.prev} disabled={stepper.index === 0}>
          <Icons.prev className="size-3.5" />
        </IconButton>
        <IconButton label={t.forward} className="size-8" onClick={stepper.next} disabled={complete}>
          <Icons.next className="size-3.5" />
        </IconButton>
        <IconButton label={t.last} className="size-8" onClick={stepper.last} disabled={complete}>
          <Icons.last className="size-3.5" />
        </IconButton>
        <span className="ml-auto font-mono text-[12px] text-ink-3 tabular-nums">
          <span key={stepper.index} className="inline-block font-serif text-[22px] text-ink animate-pop">
            {stepper.index}
          </span>{' '}
          {s.reads}
        </span>
      </div>

      <ol className="flex flex-wrap items-center gap-1.5">
        {lk.steps.map((st, k) => {
          const on = k < stepper.index;
          const now = k === stepper.index - 1 && !complete;
          const miss = st.kind === 'block' && st.found === -1;
          return (
            <Fragment key={k}>
              {k > 0 && <li className={clsx('text-[12px] transition-opacity', on ? 'text-ink-3' : 'text-ink-3/40')}>→</li>}
              <motion.li layout transition={spring}>
                <button
                  type="button"
                  onClick={() => stepper.setIndex(k + 1)}
                  onMouseEnter={() => onHover(st.kind === 'inode' ? { kind: 'inode', i: st.inum } : { kind: 'block', b: st.block })}
                  onMouseLeave={() => onHover(null)}
                  className={clsx(
                    'rounded-lg border px-2 py-1 text-left font-mono text-[12px] transition-all duration-200',
                    !on && 'border-dashed border-line text-ink-3 opacity-60',
                    on && (miss ? 'border-bad/40 bg-bad-soft text-bad' : st.kind === 'inode' ? 'border-c2/30 bg-info-soft text-info' : 'border-line-strong bg-sunken text-ink'),
                    now && 'ring-2 ring-info ring-offset-1 ring-offset-surface',
                  )}
                >
                  {st.kind === 'inode' ? (
                    s.readInode(st.inum)
                  ) : (
                    <>
                      {s.readBlock(st.block)}: {s.seek(st.name!)} <b className="font-semibold">→ {st.found === -1 ? '✗' : `i${st.found}`}</b>
                    </>
                  )}
                </button>
              </motion.li>
            </Fragment>
          );
        })}
      </ol>

      {complete && (
        <Narration key={path + lk.reads} tone={lk.error ? 'bad' : 'ok'}>
          {lk.error ? s.lookupFail(s.err(lk.error), lk.reads) : s.resolved(path, lk.inum, lk.reads)}
        </Narration>
      )}
    </div>
  );
}
