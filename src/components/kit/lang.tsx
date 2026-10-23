import { createContext, useContext, type ReactNode } from 'react';
import { ui, type L10n, type Lang, type UiStrings } from '../../lib/i18n';

const LangContext = createContext<Lang>('es');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** Shared kit strings in the current language. */
export function useUi(): UiStrings {
  return ui[useLang()];
}

/** Picks the current language out of a playground's own `{ es, en }` dictionary. */
export function useStrings<T>(dict: L10n<T>): T {
  return dict[useLang()];
}
