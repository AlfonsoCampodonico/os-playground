import { Field, LangProvider, Segmented, useStrings, useUrlState } from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import { CODE_PRESETS, type Policy } from '../../sim/fork/code';
import { CodeMode } from './CodeMode';
import { S, type TreeView } from './strings';
import { TreeMode } from './TreeMode';

export type Mode = 'tree' | 'code';

export const DEFAULTS = {
  mode: 'code' as Mode,
  // Código
  code: CODE_PRESETS.hola as string,
  sched: 'parent' as Policy,
  cseed: 0,
  // Árbol (fork.py)
  seed: 4,
  actions: 5,
  forks: 0.7,
  alist: '',
  R: false,
  L: false,
  view: 'solve' as TreeView,
  F: false,
};

export type ForkCfg = typeof DEFAULTS;
export type SetCfg = (patch: Partial<ForkCfg>) => void;

export default function ForkPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Fork />
    </LangProvider>
  );
}

function Fork() {
  const s = useStrings(S);
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const modeField = (
    <Field label={s.mode}>
      <Segmented
        value={cfg.mode}
        options={[
          { value: 'tree' as Mode, label: s.modes.tree },
          { value: 'code' as Mode, label: s.modes.code },
        ]}
        onChange={(mode) => set({ mode })}
      />
    </Field>
  );
  return cfg.mode === 'tree' ? <TreeMode cfg={cfg} set={set} reset={reset} modeField={modeField} /> : <CodeMode cfg={cfg} set={set} reset={reset} modeField={modeField} />;
}
