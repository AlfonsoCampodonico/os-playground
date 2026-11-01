export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

/** A value given in every supported language. */
export type L10n<T = string> = Record<Lang, T>;

/**
 * getStaticPaths for pages under `src/pages/[...lang]/`: Spanish lives at the
 * root (`/tlb`), English under `/en` (`/en/tlb`).
 */
export function langPaths() {
  return LANGS.map((lang) => ({
    params: { lang: lang === DEFAULT_LANG ? undefined : lang },
    props: { lang },
  }));
}

function base(): string {
  return import.meta.env.BASE_URL.replace(/\/+$/, '');
}

/** Site-relative link for `path` ("/", "/tlb") in `lang`, respecting the deploy base. */
export function href(path: string, lang: Lang): string {
  const clean = path === '/' ? '' : '/' + path.replace(/^\/+|\/+$/g, '');
  const prefix = lang === DEFAULT_LANG ? '' : `/${lang}`;
  return `${base()}${prefix}${clean}` || '/';
}

/** Strips the deploy base and language prefix from a pathname: "/en/tlb/" -> "/tlb". */
export function routeOf(pathname: string): string {
  let p = pathname;
  const b = base();
  if (b && p.startsWith(b)) p = p.slice(b.length);
  for (const lang of LANGS) {
    if (lang !== DEFAULT_LANG && (p === `/${lang}` || p.startsWith(`/${lang}/`))) {
      p = p.slice(lang.length + 1);
    }
  }
  p = p.replace(/\/+$/, '');
  return p || '/';
}

/** Strings shared by the site chrome and the playground UI kit. */
export const ui = {
  es: {
    siteName: 'SO Playground',
    tagline: 'Sistemas Operativos, para tocar',
    topics: 'Temas',
    week: 'Semana',
    ostepChapter: 'OSTEP cap.',
    independent: 'Proyecto independiente, hecho por alguien del equipo docente de Sistemas Operativos (FIUBA). No es material oficial de la materia.',
    courseSite: 'Sitio de la materia',
    prev: 'Anterior',
    next: 'Siguiente',
    allTopics: 'Todos los temas',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    themeSystem: 'Sistema',
    // playground kit
    setup: 'Configuración',
    reset: 'Reiniciar',
    stepOf: (i: number, n: number) => `Paso ${i} de ${n}`,
    first: 'Al inicio',
    back: 'Paso anterior',
    forward: 'Paso siguiente',
    last: 'Al final',
    play: 'Reproducir',
    pause: 'Pausa',
    speed: 'Velocidad',
    perStep: (s: number) => `${s.toLocaleString('es-AR', { maximumFractionDigits: 2 })} s por paso`,
    runAll: 'Correr todo',
    share: 'Compartir',
    copied: '¡Link copiado!',
    random: 'Problema aleatorio',
    reveal: 'Ver respuesta',
    hide: 'Ocultar respuesta',
    whatAmISeeing: '¿Qué estoy viendo?',
    sameAsOstep: 'Igual que OSTEP',
    keyboardHint: '← → para avanzar · espacio para reproducir',
    invalid: 'Entrada inválida',
    // guided flow
    flowPick: 'Elegí un escenario',
    flowPickHint: 'Empezá por uno de los ejemplos. Después podés cambiar todo.',
    flowWatch: 'Miralo paso a paso',
    flowWatchHint: 'Dale a Reproducir o avanzá con →. Cada paso dice qué pasó.',
    flowUnderstand: 'Entendé el resultado',
    flowUnderstandHint: 'Compará, mirá los números y probá las preguntas.',
    advanced: 'Ajustes avanzados',
  },
  en: {
    siteName: 'SO Playground',
    tagline: 'Operating Systems you can touch',
    topics: 'Topics',
    week: 'Week',
    ostepChapter: 'OSTEP ch.',
    independent: 'Independent project, made by a member of the Operating Systems teaching staff (FIUBA). Not official course material.',
    courseSite: 'Course website',
    prev: 'Previous',
    next: 'Next',
    allTopics: 'All topics',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    setup: 'Setup',
    reset: 'Reset',
    stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
    first: 'Go to start',
    back: 'Previous step',
    forward: 'Next step',
    last: 'Go to end',
    play: 'Play',
    pause: 'Pause',
    speed: 'Speed',
    perStep: (s: number) => `${s.toLocaleString('en-US', { maximumFractionDigits: 2 })} s per step`,
    runAll: 'Run all',
    share: 'Share',
    copied: 'Link copied!',
    random: 'Random problem',
    reveal: 'Show answer',
    hide: 'Hide answer',
    whatAmISeeing: 'What am I looking at?',
    sameAsOstep: 'Same as OSTEP',
    keyboardHint: '← → to step · space to play',
    invalid: 'Invalid input',
    flowPick: 'Pick a scenario',
    flowPickHint: 'Start from one of the examples. You can change everything later.',
    flowWatch: 'Watch it step by step',
    flowWatchHint: 'Press Play or step with →. Each step says what happened.',
    flowUnderstand: 'Understand the result',
    flowUnderstandHint: 'Compare, read the numbers and try the questions.',
    advanced: 'Advanced settings',
  },
} as const;

export type UiStrings = (typeof ui)[Lang];
