import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Button, Icons, Segmented, TextField } from '../../components/kit';
import { apply, type FsState, type Op, type OpKind } from '../../sim/filesystem';
import type { Strings } from './strings';

const KINDS: OpKind[] = ['mkdir', 'creat', 'write', 'link', 'unlink'];

/** Small form to append one op; predicts on the final state whether vsfs would accept it. */
export function OpBuilder({ state, nextData, onAdd, s }: { state: FsState; nextData: string; onAdd: (op: Op) => void; s: Strings }) {
  const [kind, setKind] = useState<OpKind>('mkdir');
  const [path, setPath] = useState('');
  const [target, setTarget] = useState('');

  const op: Op | null = useMemo(() => {
    const p = path.trim();
    if (!p) return null;
    if (kind === 'link') return target.trim() ? { kind, target: target.trim(), path: p } : null;
    if (kind === 'write') return { kind, path: p, data: nextData };
    return { kind, path: p };
  }, [kind, path, target, nextData]);

  const result = useMemo(() => (op ? apply(state, op) : null), [op, state]);

  const submit = () => {
    if (!op || !result?.ok) return;
    onAdd(op);
    setPath('');
  };

  return (
    <div className="flex flex-col gap-2">
      <Segmented size="sm" value={kind} options={KINDS.map((k) => ({ value: k, label: s.kindLabel[k] }))} onChange={setKind} />
      <div
        className="flex items-start gap-2"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className={clsx('grid min-w-0 flex-1 gap-2', kind === 'link' && 'grid-cols-2')}>
          {kind === 'link' && <TextField value={target} onChange={setTarget} placeholder={`${s.target}: /a`} ariaLabel={s.target} />}
          <TextField value={path} onChange={setPath} placeholder={kind === 'link' ? `${s.newName}: /b` : `${s.path}: /a`} ariaLabel={s.path} invalid={!!result && !result.ok} />
        </div>
        <Button variant="primary" icon={<Icons.plus className="size-3.5" />} disabled={!result?.ok} onClick={submit}>
          {s.add}
        </Button>
      </div>
      {result && (
        <p key={result.ok ? 'ok' : result.error.code + result.error.at} className={clsx('text-[12px] animate-rise', result.ok ? 'text-ok' : 'text-bad')}>
          {result.ok ? s.willWork : s.err(result.error)}
        </p>
      )}
    </div>
  );
}
