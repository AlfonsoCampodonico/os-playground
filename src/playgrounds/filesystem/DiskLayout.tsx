import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { FsState } from '../../sim/filesystem';
import { entryKey, spring, type Change, type Focus, type Marks, type Related } from './model';
import type { Strings } from './strings';

interface Props {
  state: FsState;
  marks: Marks;
  rel: Related;
  /** Something is focused (so unrelated cells dim). */
  focused: boolean;
  /** The inode / block the path lookup is reading right now. */
  lookupMark: Focus;
  onHover: (f: Focus) => void;
  onPin: (f: Focus) => void;
  s: Strings;
}

const changeCls: Record<Change, string> = {
  alloc: 'bg-ok-soft border-ok/50',
  free: 'bg-bad-soft border-bad/50',
  update: 'bg-warn-soft border-warn/50',
};

function Region({ title, count, children }: { title: ReactNode; count?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</h3>
        {count && <span className="font-mono text-[11px] text-ink-3 tabular-nums">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Bits({ bits, changed, rel, focused, onHover, onPin, kind }: { bits: number[]; changed: Set<number>; rel: Set<number>; focused: boolean; onHover: (f: Focus) => void; onPin: (f: Focus) => void; kind: 'inode' | 'block' }) {
  const focusOf = (i: number): Focus => (kind === 'inode' ? { kind, i } : { kind, b: i });
  return (
    <div className="flex flex-wrap gap-1">
      {bits.map((v, i) => (
        <button
          key={i}
          type="button"
          onMouseEnter={() => onHover(focusOf(i))}
          onMouseLeave={() => onHover(null)}
          onClick={() => onPin(focusOf(i))}
          className={clsx('flex flex-col items-center gap-0.5 transition-opacity duration-200', focused && !rel.has(i) && 'opacity-45')}
          aria-label={`${kind} ${i}: ${v}`}
        >
          <span
            className={clsx(
              'grid size-6 place-items-center overflow-hidden rounded-md font-mono text-[11.5px] transition-colors duration-300',
              v ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-3',
              changed.has(i) && (v ? 'ring-2 ring-ok' : 'ring-2 ring-bad'),
              rel.has(i) && !changed.has(i) && 'ring-2 ring-accent',
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={v} initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={spring}>
                {v}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="font-mono text-[9.5px] leading-none text-ink-3">{i}</span>
        </button>
      ))}
    </div>
  );
}

function Pop({ k, className, children }: { k: string | number; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={k} initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={spring} className={clsx('inline-block', className)}>
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

export function DiskLayout({ state, marks, rel, focused, lookupMark, onHover, onPin, s }: Props) {
  const usedI = state.ibitmap.filter(Boolean).length;
  const usedD = state.dbitmap.filter(Boolean).length;
  const cell = (change: Change | undefined, isRel: boolean, isLookup: boolean, used: boolean) =>
    clsx(
      'relative rounded-xl border px-2 py-1.5 text-left font-mono text-[12px] transition-[background-color,border-color,opacity,box-shadow] duration-300',
      used ? 'border-line-strong bg-surface' : 'border-dashed border-line text-ink-3',
      change && changeCls[change],
      isLookup && 'ring-2 ring-info ring-offset-1 ring-offset-surface',
      isRel && !isLookup && 'ring-2 ring-accent ring-offset-1 ring-offset-surface',
      focused && !isRel && !isLookup && 'opacity-45',
    );

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Region title={s.ibitmap} count={`${usedI}/${state.ibitmap.length}`}>
          <Bits bits={state.ibitmap} changed={marks.ibit} rel={rel.inodes} focused={focused} onHover={onHover} onPin={onPin} kind="inode" />
        </Region>
        <Region title={s.dbitmap} count={`${usedD}/${state.dbitmap.length}`}>
          <Bits bits={state.dbitmap} changed={marks.dbit} rel={rel.blocks} focused={focused} onHover={onHover} onPin={onPin} kind="block" />
        </Region>
      </div>

      <Region title={s.inodes}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-1.5">
          {state.inodes.map((n, i) => {
            const isLookup = lookupMark?.kind === 'inode' && lookupMark.i === i;
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => onHover({ kind: 'inode', i })}
                onMouseLeave={() => onHover(null)}
                onClick={() => onPin({ kind: 'inode', i })}
                className={cell(marks.inode.get(i), rel.inodes.has(i), isLookup, !!n.type)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10.5px] text-ink-3">i{i}</span>
                  {n.type ? (
                    <Pop k={n.type} className={clsx('text-[11px] font-semibold', n.type === 'd' ? 'text-c2' : 'text-c1')}>
                      {n.type}
                    </Pop>
                  ) : null}
                </div>
                {n.type ? (
                  <div className="mt-0.5 flex gap-2 whitespace-nowrap text-[12px]">
                    <span className={clsx(marks.addr.has(i) && 'font-semibold text-warn')}>
                      a:<Pop k={n.addr}>{n.addr}</Pop>
                    </span>
                    <span className={clsx(marks.refs.has(i) && 'font-semibold text-warn', n.type === 'f' && n.refs > 1 && !marks.refs.has(i) && 'text-accent')}>
                      r:<Pop k={n.refs}>{n.refs}</Pop>
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 text-[11.5px]">{s.free}</div>
                )}
              </button>
            );
          })}
        </div>
      </Region>

      <Region title={s.blocks}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
          {state.blocks.map((blk, b) => {
            const isLookup = lookupMark?.kind === 'block' && lookupMark.b === b;
            return (
              <motion.div
                key={b}
                layout="position"
                role="button"
                tabIndex={0}
                onMouseEnter={() => onHover({ kind: 'block', b })}
                onMouseLeave={() => onHover(null)}
                onClick={() => onPin({ kind: 'block', b })}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPin({ kind: 'block', b }))}
                className={clsx(cell(marks.block.get(b), rel.blocks.has(b), isLookup, !!blk.type), 'min-h-[64px] cursor-pointer')}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10.5px] text-ink-3">b{b}</span>
                  {blk.type && <span className={clsx('text-[10.5px] font-medium', blk.type === 'd' ? 'text-c2' : 'text-c1')}>{blk.type === 'd' ? s.dir : s.file}</span>}
                </div>
                {blk.type === 'd' ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {blk.entries.map(([name, inum]) => {
                        const key = entryKey(b, name);
                        const isNew = marks.entries.has(key);
                        const isRel = rel.entries.has(key);
                        return (
                          <motion.li
                            key={name}
                            layout
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.18 } }}
                            transition={spring}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              onHover({ kind: 'inode', i: inum });
                            }}
                            onMouseLeave={() => onHover({ kind: 'block', b })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPin({ kind: 'inode', i: inum });
                            }}
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] transition-colors duration-300',
                              isNew ? 'bg-ok-soft text-ok' : isRel ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-2',
                            )}
                          >
                            <span className={clsx(name === '.' || name === '..' ? 'text-ink-3' : 'text-ink', (isNew || isRel) && 'text-current')}>{name}</span>
                            <span className="opacity-60">{inum}</span>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                ) : blk.type === 'f' ? (
                  <div className="mt-0.5 font-serif text-[26px] leading-none text-ink">
                    <Pop k={blk.data}>{blk.data}</Pop>
                  </div>
                ) : (
                  <div className="mt-0.5 text-[11.5px]">{s.free}</div>
                )}
              </motion.div>
            );
          })}
        </div>
      </Region>
    </div>
  );
}
