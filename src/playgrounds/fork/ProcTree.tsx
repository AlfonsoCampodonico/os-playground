import clsx from 'clsx';
import { LayoutGroup, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SPRING } from './colors';

/**
 * An indented process tree (like `pstree`) whose nodes keep their identity
 * across steps: a node that changes parent (an orphan) glides to its new
 * place, a new node pops in.
 */
export function ProcTree({
  roots,
  childrenOf,
  renderNode,
  isNew,
  idPrefix,
  className,
}: {
  roots: string[];
  childrenOf: (id: string) => string[];
  renderNode: (id: string) => ReactNode;
  /** Nodes that were just created get an entrance animation. */
  isNew: (id: string) => boolean;
  idPrefix: string;
  className?: string;
}) {
  const branch = (id: string, depth: number): ReactNode => {
    const kids = childrenOf(id);
    return (
      <li
        key={id}
        className={clsx(
          'relative',
          depth > 0 &&
            'pl-5 before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-line-strong last:before:h-[17px] after:absolute after:left-0 after:top-[17px] after:h-px after:w-4 after:bg-line-strong',
        )}
      >
        <div className="py-[3px]">
          <motion.div
            layout="position"
            layoutId={`${idPrefix}-${id}`}
            initial={isNew(id) ? { opacity: 0, scale: 0.5 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={SPRING}
            className="inline-flex origin-left"
          >
            {renderNode(id)}
          </motion.div>
        </div>
        {kids.length > 0 && <ul className="ml-3.5">{kids.map((k) => branch(k, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <LayoutGroup id={idPrefix}>
      <ul className={clsx('min-w-max', className)}>{roots.map((r) => branch(r, 0))}</ul>
    </LayoutGroup>
  );
}
