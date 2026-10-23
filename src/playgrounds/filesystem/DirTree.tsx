import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Badge } from '../../components/kit';
import type { TreeNode } from '../../sim/filesystem';
import { spring, type Focus, type Marks, type Related } from './model';
import type { Strings } from './strings';

interface Props {
  tree: TreeNode;
  rel: Related;
  focused: boolean;
  marks: Marks;
  /** Path currently in the lookup tool. */
  activePath: string;
  onHover: (f: Focus) => void;
  onPick: (node: TreeNode) => void;
  s: Strings;
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
    </svg>
  );
}

export function DirTree({ tree, rel, focused, marks, activePath, onHover, onPick, s }: Props) {
  const row = (n: TreeNode, depth: number) => {
    const isRel = rel.inodes.has(n.inum);
    const isNew = marks.inode.get(n.inum) === 'alloc' || (n.type === 'f' && marks.refs.has(n.inum) && n.refs > 1);
    return (
      <motion.li
        key={n.path}
        layout="position"
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 8, transition: { duration: 0.16 } }}
        transition={spring}
      >
        <button
          type="button"
          onMouseEnter={() => onHover({ kind: 'inode', i: n.inum })}
          onMouseLeave={() => onHover(null)}
          onClick={() => onPick(n)}
          style={{ paddingLeft: 8 + depth * 18 }}
          className={clsx(
            'flex w-full min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left font-mono text-[13px] transition-[background-color,opacity] duration-200',
            isRel ? 'bg-accent-soft' : isNew ? 'bg-ok-soft' : 'hover:bg-chip',
            focused && !isRel && 'opacity-55',
            activePath === n.path && 'ring-1 ring-info',
          )}
        >
          {n.type === 'd' ? <FolderIcon className="size-4 shrink-0 text-c2" /> : <FileIcon className="size-4 shrink-0 text-c1" />}
          <span className="truncate text-ink">{n.name}</span>
          <span className="shrink-0 text-[11px] text-ink-3">i{n.inum}</span>
          {n.type === 'f' && n.refs > 1 && (
            <Badge tone="accent" className="ml-auto shrink-0">
              {s.links(n.refs)}
            </Badge>
          )}
        </button>
        {n.children.length > 0 && (
          <ul className="relative before:absolute before:bottom-1.5 before:left-[var(--guide)] before:top-0 before:w-px before:bg-line" style={{ ['--guide' as string]: `${15 + depth * 18}px` }}>
            <AnimatePresence initial={false}>{n.children.map((c) => row(c, depth + 1))}</AnimatePresence>
          </ul>
        )}
      </motion.li>
    );
  };
  return <ul className="min-w-0">{row(tree, 0)}</ul>;
}
