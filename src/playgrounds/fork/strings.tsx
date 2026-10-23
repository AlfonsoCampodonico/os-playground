import type { CodeError, CodePresetId, Policy, ProcState } from '../../sim/fork/code';

export type TreePresetId = 'readme' | 'hw1' | 'hw2' | 'hw4' | 'hw4R' | 'hw6';
export type TreeView = 'solve' | 'tree' | 'action';

const list = (xs: string[], and: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs.at(-1)}`);

const es = {
  mode: 'Modo',
  modes: { tree: 'Árbol (fork.py)', code: 'Código' },
  preset: 'Ejemplo',
  practice: 'Practicá',

  /* ---------- Árbol (fork.py) ---------- */
  treePresets: {
    readme: 'README (-s 4)',
    hw1: 'Tarea 1 (-s 10)',
    hw2: 'Tarea 2 (-a 100 -f 0.1)',
    hw4: 'Tarea 4: huérfanos',
    hw4R: 'Tarea 4 con -R',
    hw6: 'Tarea 6 (-t -F)',
  } as Record<TreePresetId, string>,
  seed: 'Semilla (-s)',
  actions: 'Cantidad de acciones (-a)',
  forkPct: 'Probabilidad de fork (-f)',
  forkPctHint: 'el resto son exits',
  actionList: 'Acciones a mano (-A)',
  actionListHint: 'vacío = aleatorias',
  actionListPh: 'a+b,b+c,c-',
  localReparent: (
    <>
      <code className="font-mono text-[12px]">-R</code> los huérfanos van al abuelo
    </>
  ),
  leafOnly: (
    <>
      <code className="font-mono text-[12px]">-L</code> solo terminan las hojas
    </>
  ),
  view: '¿Qué adivinás?',
  views: { solve: 'Nada (-c)', tree: 'El árbol', action: 'La acción (-t)' } as Record<TreeView, string>,
  finalOnly: (
    <>
      <code className="font-mono text-[12px]">-F</code> solo el árbol final
    </>
  ),
  pasteFlags: 'Pegá flags de fork.py',
  pastePh: './fork.py -s 7 -a 8 -R -c',
  apply: 'Aplicar',
  badFlags: (f: string[]) => `No entiendo: ${f.join(' ')}`,
  treeTitle: 'Árbol de procesos',
  actionsTitle: 'Acciones',
  hiddenTree: '¿Cómo queda el árbol?',
  hiddenFinal: 'Con -F solo se muestra el árbol final: imaginalo vos.',
  hiddenAction: '¿Qué acción hubo?',
  show: 'Mostrar',
  showAll: 'Mostrar todo',
  treeStart: 'Arranca un solo proceso, a: la raíz (en Unix sería init). Dale play o → para aplicar la primera acción.',
  forks: (p: string, c: string) => (
    <>
      <b>{p}</b> hace fork() → nace <b>{c}</b>, hijo de {p}.
    </>
  ),
  exits: (p: string) => (
    <>
      <b>{p}</b> termina (exit).
    </>
  ),
  orphansTo: (os: string[], to: string, local: boolean) => (
    <>
      {os.length === 1 ? 'Su hijo' : 'Sus descendientes'} {list(os, 'y')} {os.length === 1 ? 'queda huérfano' : 'quedan huérfanos'} → {os.length === 1 ? 'pasa' : 'pasan'} a colgar de <b>{to}</b>{' '}
      {local ? '(el abuelo, por -R)' : '(la raíz, como init en Unix)'}.
    </>
  ),
  exitFailed: (p: string) => (
    <>
      <b>{p}</b> quiere terminar pero tiene hijos: con -L solo terminan las hojas, así que falla.
    </>
  ),
  treeError: 'fork.py se corta acá:',
  alive: 'Procesos vivos',
  forkCount: 'Forks',
  exitCount: 'Exits',
  reparented: 'Huérfanos',
  reparentedSub: 'reparentados',
  realOutput: 'Salida de fork.py con estos flags',
  treePractice: {
    afterQ: (k: number, a: string) => (
      <>
        Después de la acción {k} (<code>{a}</code>), ¿cómo queda el árbol?
      </>
    ),
    whichQ: 'Este árbol…',
    whichQ2: '…pasa a ser este otro. ¿Qué acción lo produjo?',
    orphanQ: (p: string, os: string[]) => `Cuando ${p} termina, ¿de quién ${os.length === 1 ? 'pasa a ser hijo' : 'pasan a ser hijos'} ${list(os, 'y')}? ¿Y si corrés con -R?`,
    orphanA: (to: string, toR: string) => (
      <>
        Sin -R (como init en Unix): de <b>{to}</b>, la raíz. Con -R: de <b>{toR}</b>, el padre del que terminó.
      </>
    ),
    forkPctQ: '¿Qué pasa con el árbol final si bajás -f a 0.1? ¿Y si lo subís a 0.9?',
    forkPctA: (lo: number, hi: number) => `Con -f 0.1 quedan ${lo} proceso(s) vivo(s) al final (casi todo son exits, y a la raíz no se la puede matar); con -f 0.9 quedan ${hi}: un árbol ancho y profundo.`,
  },
  treeExplain: (
    <>
      <p>
        <code>fork.py</code> es el simulador de la tarea del capítulo 5 de OSTEP. Cada acción es un <b>fork</b> (<code>a+b</code>: a crea a b) o un <b>exit</b> (<code>b-</code>: b termina). Todos los procesos
        forman un <b>árbol</b> con raíz en a.
      </p>
      <p>
        Cuando un proceso termina, sus hijos quedan <b>huérfanos</b>. En Unix los adopta <b>init</b>; fork.py hace lo mismo y cuelga todo el subárbol de la raíz (lo aplana). Con <code>-R</code> los hijos pasan
        al abuelo.
      </p>
      <p>
        Practicá como en la tarea: «El árbol» esconde el árbol después de cada acción; «La acción» (<code>-t</code>) te muestra los árboles y vos adivinás la acción. <code>-F</code> deja solo el final.
      </p>
    </>
  ),

  /* ---------- Código ---------- */
  codePresets: {
    hola: 'fork ×2',
    loop: 'for ×3',
    p1: 'p1.c',
    p2: 'p2.c · wait',
    p3: 'p3.c · exec',
    zombie: 'Zombie',
    orphan: 'Huérfano',
    vars: 'Variables',
  } as Record<CodePresetId, string>,
  program: 'Programa en C',
  programHint: 'fork, wait, exec, printf, if, for',
  sched: '¿Quién corre después de un fork?',
  scheds: { parent: 'Padre primero', child: 'Hijo primero', random: 'Aleatorio' } as Record<Policy, string>,
  schedSeed: 'Semilla del scheduler',
  realRun: 'En una terminal de verdad',
  code: 'Código',
  tree: 'Árbol de procesos',
  console: 'Salida',
  consoleEmpty: 'Todavía no se imprimió nada.',
  pending: 'en el buffer, sin imprimir',
  vars: 'Memoria de cada proceso',
  varsSub: 'cada uno tiene su propia copia',
  noVars: 'sin variables',
  newImage: (img: string) => `imagen nueva: ${img}`,
  buffer: 'buffer stdout',
  states: {
    running: 'ejecutando',
    ready: 'listo',
    waiting: 'bloqueado en wait',
    sleeping: 'durmiendo',
    zombie: 'zombie',
    done: 'terminado',
  } as Record<ProcState, string>,
  orphan: 'huérfano',
  shell: 'shell',
  created: 'Procesos creados',
  createdSub: (n: number) => `con fork() · ${n} en total`,
  lines: 'Líneas impresas',
  zombies: 'Zombies',
  zombiesSub: 'en este paso',
  orphans: 'Huérfanos',
  orphansSub: 'adoptados por init',
  codeStart: (
    <>
      Arranca <b>P100</b> (a.out), hijo de la shell (bash, PID 99). Dale play o → para ejecutar sentencia por sentencia.
    </>
  ),
  at: (pid: number, line: number | null) => (line === null ? `P${pid}:` : `P${pid} · línea ${line}:`),
  ev: {
    first: (pid: number) => `P${pid} arranca: para el hijo, fork() devolvió 0.`,
    fork: (pid: number, child: number) => (
      <>
        fork() → nace <b>P{child}</b>, una copia de P{pid}. Al padre le devuelve {child}.
      </>
    ),
    bufCopied: (b: string) => `El hijo también hereda el buffer sin imprimir «${b.replace(/\n/g, '\\n')}».`,
    forkFail: 'fork() falla y devuelve -1: se llegó al límite de procesos.',
    set: (name: string, v: number) => `${name} = ${v}`,
    print: (t: string) => `imprime «${t.replace(/\n$/, '').replace(/\n/g, '\\n')}»`,
    buffered: (t: string) => `printf sin \\n: «${t}» queda en el buffer de stdio, todavía no se ve`,
    flush: 'vacía el buffer de stdout',
    err: (t: string) => `escribe en stderr «${t.replace(/\n$/, '')}»`,
    exitZombie: (pid: number, code: number, ppid: number) => (
      <>
        <b>P{pid}</b> termina con exit({code}) → queda <b>zombie</b> hasta que su padre P{ppid} haga wait().
      </>
    ),
    exitShell: (pid: number, code: number) => `P${pid} termina con exit(${code}); la shell, que lo esperaba, lo recoge.`,
    exitInit: (pid: number, code: number) => `P${pid} termina con exit(${code}); como es huérfano, init lo recoge enseguida.`,
    lostBuf: (b: string) => `El buffer «${b.replace(/\n/g, '\\n')}» se pierde sin imprimirse.`,
    orphan: (pid: number) => (
      <>
        <b>P{pid}</b> queda huérfano → lo adopta init (PID 1).
      </>
    ),
    wake: (pid: number, by: number) => `P${pid} estaba en wait() y se despierta: terminó P${by}.`,
    block: (target: number) => (target === -1 ? 'wait(): se bloquea hasta que termine algún hijo.' : `waitpid(${target}): se bloquea hasta que termine P${target}.`),
    reap: (child: number, code: number) => (
      <>
        wait() recoge al zombie <b>P{child}</b> (exit {code}) y devuelve {child}.
      </>
    ),
    initReap: (child: number) => `init recoge al zombie P${child}.`,
    waitNone: 'wait() devuelve -1: no tiene hijos que esperar.',
    sleep: (s: number) => `sleep(${s}): se duerme y cede la CPU.`,
    wakeSleep: (pid: number) => `P${pid} se despierta del sleep.`,
    exec: (argv: string[]) => (
      <>
        exec reemplaza el programa de este proceso por <b>{argv.join(' ')}</b>: mismo PID, otra imagen. Lo que sigue en el código nunca se ejecuta.
      </>
    ),
    execFail: (cmd: string) => `exec falla (no existe «${cmd}») y devuelve -1: sigue con la línea de abajo.`,
    image: (img: string) => `${img} imprime su salida y termina.`,
    ifTrue: 'la condición es verdadera',
    ifFalse: 'la condición es falsa',
    loopTrue: 'el bucle da otra vuelta',
    loopFalse: 'el bucle termina',
  },
  done: (lines: number, procs: number) => `Fin: ${lines} línea(s) impresas por ${procs} proceso(s).`,
  truncated: (n: number) => `Corté la simulación a los ${n} pasos (¿un bucle infinito?).`,
  errorAt: (line: number) => `Línea ${line}: `,
  err: (e: CodeError): string => {
    const d = e.detail ?? '';
    const d2 = e.detail2 ?? '';
    switch (e.kind) {
      case 'char':
        return `carácter inesperado «${d}».`;
      case 'string':
        return 'string sin cerrar: falta la comilla ".';
      case 'expected':
        if (d === ';') return `falta un «;»${d2 ? ` antes de «${d2}»` : ''}.`;
        return d2 ? `esperaba «${d}» y encontré «${d2}».` : `esperaba «${d}» (¿falta cerrar una llave o un paréntesis?).`;
      case 'unknownFn':
        return `no conozco la función ${d}(). Podés usar fork, wait, waitpid, exit, execlp, printf, getpid, getppid y sleep.`;
      case 'execv':
        return `${d} necesita un arreglo argv[] y acá no hay arreglos: usá execlp("ls", "ls", "-l", NULL).`;
      case 'arrays':
        return 'los arreglos no están soportados: usá variables int sueltas.';
      case 'pointers':
        return 'los punteros no están soportados (solo &status en wait/waitpid).';
      case 'strings':
        return 'solo se pueden declarar variables enteras (int, pid_t); los textos van directo en printf("...").';
      case 'keyword':
        return `«${d}» no está soportado en este mini-C: usá if/else, for o while.`;
      case 'otherFn':
        return `solo se puede definir main() (encontré ${d}). Poné todo el código adentro de main, o escribilo sin main.`;
      case 'args':
        return `${d}() recibe ${d2} argumento(s).`;
      case 'fmtArgs':
        return `el formato de printf pide ${d} valor(es) (%d, %s…) pero le pasaste ${d2}.`;
      case 'notLvalue':
        return 'a la izquierda del = tiene que ir una variable.';
      case 'undeclared':
        return `la variable «${d}» no está declarada (declarala con int ${d} = …;).`;
      case 'divZero':
        return 'división por cero.';
      case 'loopCtl':
        return `«${d}» fuera de un bucle.`;
      case 'empty':
        return 'escribí un programa, por ejemplo: fork(); printf("hola\\n");';
    }
  },
  compare: 'Mismo programa, otro scheduler',
  compareSame: (n: number) => `El orden puede cambiar, la cantidad no: siempre ${n} línea(s).`,
  compareDiff: 'Ojo: acá cambia la cantidad de líneas (depende de quién corre primero).',
  current: 'actual',
  codePractice: {
    countQ: (word: string | null) => (word ? `¿Cuántas veces se imprime «${word}»?` : '¿Cuántas líneas imprime este programa?'),
    countA: (n: number, procs: number) => `${n}. Hay ${procs} proceso(s) en total y cada uno que llega a un printf lo ejecuta con su propia copia del programa.`,
    procsQ: '¿Cuántos procesos hay en total, contando el original?',
    procsA: (n: number, forks: number) => `${n}: el original más ${forks} creado(s) con fork(). Cada fork() que se ejecuta duplica al proceso que lo llama.`,
    orphanQ: (pid: number) => `¿Quién es el padre de P${pid} cuando termina?`,
    orphanA: (pid: number, orig: number) => `init (PID 1): su padre original, P${orig}, terminó antes sin esperarlo, así que P${pid} quedó huérfano y lo adoptó init. Por eso getppid() devuelve 1.`,
    zombieQ: '¿Algún proceso queda zombie? ¿Desde cuándo y hasta cuándo?',
    zombieA: (pid: number, from: number, to: number | null, reaper: number | null) =>
      to === null
        ? `P${pid} queda zombie desde el paso ${from} hasta el final.`
        : reaper === 1
          ? `P${pid}, del paso ${from} al ${to}: su padre terminó sin esperarlo, init lo adoptó y lo recogió.`
          : `P${pid}, del paso ${from} al ${to}: terminó, pero recién en el paso ${to} su padre P${reaper} hizo wait() y lo recogió.`,
    noZombie: 'Ninguno: cada hijo terminó cuando su padre ya lo estaba esperando, o lo recogieron enseguida.',
    orderQ: (other: string) => `Si el scheduler elige «${other}», ¿cambia la salida?`,
    orderSame: 'No: sale exactamente igual (el wait() fuerza el orden, o hay un solo orden posible).',
    orderDiff: (n: number) => `Cambia el orden de las líneas, pero siguen siendo ${n}. Nunca asumas quién corre primero después de un fork().`,
  },
  codeExplain: (
    <>
      <p>
        <b>fork()</b> crea un proceso hijo que es una <b>copia</b> del padre: las mismas variables, el mismo punto del programa y hasta el buffer de printf. Lo único distinto es lo que devuelve: <b>0</b> en el
        hijo y el <b>PID del hijo</b> en el padre (−1 si falla). De ahí en adelante cada uno tiene su propia memoria.
      </p>
      <p>
        Después del fork, quién corre primero lo decide el <b>scheduler</b>: no lo podés asumir. Por eso acá lo elegís, y abajo ves que cambia el orden pero no la cantidad.
      </p>
      <p>
        <b>wait()</b> bloquea al padre hasta que termina un hijo, y lo recoge. Un hijo que terminó y nadie esperó todavía es un <b>zombie</b>: ya no corre, pero su entrada en la tabla de procesos sigue para
        guardar el exit status. Si el padre termina antes, el hijo queda <b>huérfano</b> y lo adopta <b>init</b> (PID 1), que lo espera por él.
      </p>
      <p>
        <b>exec()</b> no crea un proceso: reemplaza el programa del proceso actual (mismo PID). Si funciona, no vuelve nunca. OSTEP, capítulo 5 («Process API»).
      </p>
    </>
  ),
};

type Strings = typeof es;

const en: Strings = {
  mode: 'Mode',
  modes: { tree: 'Tree (fork.py)', code: 'Code' },
  preset: 'Example',
  practice: 'Practice',
  treePresets: {
    readme: 'README (-s 4)',
    hw1: 'Homework 1 (-s 10)',
    hw2: 'Homework 2 (-a 100 -f 0.1)',
    hw4: 'Homework 4: orphans',
    hw4R: 'Homework 4 with -R',
    hw6: 'Homework 6 (-t -F)',
  },
  seed: 'Seed (-s)',
  actions: 'Number of actions (-a)',
  forkPct: 'Fork probability (-f)',
  forkPctHint: 'the rest are exits',
  actionList: 'Hand-written actions (-A)',
  actionListHint: 'empty = random',
  actionListPh: 'a+b,b+c,c-',
  localReparent: (
    <>
      <code className="font-mono text-[12px]">-R</code> orphans go to the grandparent
    </>
  ),
  leafOnly: (
    <>
      <code className="font-mono text-[12px]">-L</code> only leaves may exit
    </>
  ),
  view: 'What do you guess?',
  views: { solve: 'Nothing (-c)', tree: 'The tree', action: 'The action (-t)' },
  finalOnly: (
    <>
      <code className="font-mono text-[12px]">-F</code> final tree only
    </>
  ),
  pasteFlags: 'Paste fork.py flags',
  pastePh: './fork.py -s 7 -a 8 -R -c',
  apply: 'Apply',
  badFlags: (f: string[]) => `Can't parse: ${f.join(' ')}`,
  treeTitle: 'Process tree',
  actionsTitle: 'Actions',
  hiddenTree: 'What does the tree look like?',
  hiddenFinal: 'With -F only the final tree is shown: picture it yourself.',
  hiddenAction: 'Which action happened?',
  show: 'Show',
  showAll: 'Show all',
  treeStart: 'A single process, a, starts out: the root (init, on Unix). Press play or → to apply the first action.',
  forks: (p: string, c: string) => (
    <>
      <b>{p}</b> calls fork() → <b>{c}</b> is born, a child of {p}.
    </>
  ),
  exits: (p: string) => (
    <>
      <b>{p}</b> exits.
    </>
  ),
  orphansTo: (os: string[], to: string, local: boolean) => (
    <>
      {os.length === 1 ? 'Its child' : 'Its descendants'} {list(os, 'and')} {os.length === 1 ? 'is orphaned' : 'are orphaned'} → {os.length === 1 ? 'moves' : 'move'} under <b>{to}</b>{' '}
      {local ? '(the grandparent, because of -R)' : '(the root, like init on Unix)'}.
    </>
  ),
  exitFailed: (p: string) => (
    <>
      <b>{p}</b> tries to exit but has children: with -L only leaves may exit, so it fails.
    </>
  ),
  treeError: 'fork.py stops here:',
  alive: 'Live processes',
  forkCount: 'Forks',
  exitCount: 'Exits',
  reparented: 'Orphans',
  reparentedSub: 'reparented',
  realOutput: 'fork.py output for these flags',
  treePractice: {
    afterQ: (k: number, a: string) => (
      <>
        After action {k} (<code>{a}</code>), what does the tree look like?
      </>
    ),
    whichQ: 'This tree…',
    whichQ2: '…turns into this one. Which action did it?',
    orphanQ: (p: string, os: string[]) => `When ${p} exits, whose ${os.length === 1 ? 'child does' : 'children do'} ${list(os, 'and')} become? And with -R?`,
    orphanA: (to: string, toR: string) => (
      <>
        Without -R (like init on Unix): <b>{to}</b>’s, the root. With -R: <b>{toR}</b>’s, the parent of the one that exited.
      </>
    ),
    forkPctQ: 'What happens to the final tree if you lower -f to 0.1? And if you raise it to 0.9?',
    forkPctA: (lo: number, hi: number) => `With -f 0.1, ${lo} process(es) are left alive (almost everything is an exit, and the root can’t be killed); with -f 0.9, ${hi}: a wide, deep tree.`,
  },
  treeExplain: (
    <>
      <p>
        <code>fork.py</code> is the homework simulator for OSTEP chapter 5. Each action is a <b>fork</b> (<code>a+b</code>: a creates b) or an <b>exit</b> (<code>b-</code>: b terminates). All processes form a{' '}
        <b>tree</b> rooted at a.
      </p>
      <p>
        When a process exits its children become <b>orphans</b>. On Unix, <b>init</b> adopts them; fork.py does the same and hangs the whole subtree off the root (flattening it). With <code>-R</code> they go to
        the grandparent instead.
      </p>
      <p>
        Practise like the homework: “The tree” hides the tree after each action; “The action” (<code>-t</code>) shows the trees and you guess the action. <code>-F</code> keeps only the end.
      </p>
    </>
  ),
  codePresets: {
    hola: 'fork ×2',
    loop: 'for ×3',
    p1: 'p1.c',
    p2: 'p2.c · wait',
    p3: 'p3.c · exec',
    zombie: 'Zombie',
    orphan: 'Orphan',
    vars: 'Variables',
  },
  program: 'C program',
  programHint: 'fork, wait, exec, printf, if, for',
  sched: 'Who runs after a fork?',
  scheds: { parent: 'Parent first', child: 'Child first', random: 'Random' },
  schedSeed: 'Scheduler seed',
  realRun: 'In a real terminal',
  code: 'Code',
  tree: 'Process tree',
  console: 'Output',
  consoleEmpty: 'Nothing printed yet.',
  pending: 'in the buffer, not printed',
  vars: 'Each process’s memory',
  varsSub: 'each one has its own copy',
  noVars: 'no variables',
  newImage: (img: string) => `new image: ${img}`,
  buffer: 'stdout buffer',
  states: { running: 'running', ready: 'ready', waiting: 'blocked in wait', sleeping: 'sleeping', zombie: 'zombie', done: 'terminated' },
  orphan: 'orphan',
  shell: 'shell',
  created: 'Processes created',
  createdSub: (n: number) => `by fork() · ${n} in total`,
  lines: 'Lines printed',
  zombies: 'Zombies',
  zombiesSub: 'at this step',
  orphans: 'Orphans',
  orphansSub: 'adopted by init',
  codeStart: (
    <>
      <b>P100</b> (a.out) starts, a child of the shell (bash, PID 99). Press play or → to run it statement by statement.
    </>
  ),
  at: (pid: number, line: number | null) => (line === null ? `P${pid}:` : `P${pid} · line ${line}:`),
  ev: {
    first: (pid: number) => `P${pid} starts: for the child, fork() returned 0.`,
    fork: (pid: number, child: number) => (
      <>
        fork() → <b>P{child}</b> is born, a copy of P{pid}. The parent gets {child}.
      </>
    ),
    bufCopied: (b: string) => `The child also inherits the unprinted buffer “${b.replace(/\n/g, '\\n')}”.`,
    forkFail: 'fork() fails and returns -1: the process limit was reached.',
    set: (name: string, v: number) => `${name} = ${v}`,
    print: (t: string) => `prints “${t.replace(/\n$/, '').replace(/\n/g, '\\n')}”`,
    buffered: (t: string) => `printf without \\n: “${t}” stays in the stdio buffer, not visible yet`,
    flush: 'flushes the stdout buffer',
    err: (t: string) => `writes “${t.replace(/\n$/, '')}” to stderr`,
    exitZombie: (pid: number, code: number, ppid: number) => (
      <>
        <b>P{pid}</b> calls exit({code}) → it is a <b>zombie</b> until its parent P{ppid} calls wait().
      </>
    ),
    exitShell: (pid: number, code: number) => `P${pid} calls exit(${code}); the shell, which was waiting for it, reaps it.`,
    exitInit: (pid: number, code: number) => `P${pid} calls exit(${code}); it is an orphan, so init reaps it right away.`,
    lostBuf: (b: string) => `The buffer “${b.replace(/\n/g, '\\n')}” is lost, never printed.`,
    orphan: (pid: number) => (
      <>
        <b>P{pid}</b> is orphaned → init (PID 1) adopts it.
      </>
    ),
    wake: (pid: number, by: number) => `P${pid} was in wait() and wakes up: P${by} exited.`,
    block: (target: number) => (target === -1 ? 'wait(): blocks until some child exits.' : `waitpid(${target}): blocks until P${target} exits.`),
    reap: (child: number, code: number) => (
      <>
        wait() reaps zombie <b>P{child}</b> (exit {code}) and returns {child}.
      </>
    ),
    initReap: (child: number) => `init reaps zombie P${child}.`,
    waitNone: 'wait() returns -1: there are no children to wait for.',
    sleep: (s: number) => `sleep(${s}): goes to sleep and gives up the CPU.`,
    wakeSleep: (pid: number) => `P${pid} wakes up from sleep.`,
    exec: (argv: string[]) => (
      <>
        exec replaces this process’s program with <b>{argv.join(' ')}</b>: same PID, new image. The rest of the code never runs.
      </>
    ),
    execFail: (cmd: string) => `exec fails (“${cmd}” doesn’t exist) and returns -1: execution continues below.`,
    image: (img: string) => `${img} prints its output and exits.`,
    ifTrue: 'the condition is true',
    ifFalse: 'the condition is false',
    loopTrue: 'the loop goes around again',
    loopFalse: 'the loop ends',
  },
  done: (lines: number, procs: number) => `Done: ${lines} line(s) printed by ${procs} process(es).`,
  truncated: (n: number) => `Stopped the simulation after ${n} steps (an infinite loop?).`,
  errorAt: (line: number) => `Line ${line}: `,
  err: (e: CodeError): string => {
    const d = e.detail ?? '';
    const d2 = e.detail2 ?? '';
    switch (e.kind) {
      case 'char':
        return `unexpected character “${d}”.`;
      case 'string':
        return 'unterminated string: missing the closing ".';
      case 'expected':
        if (d === ';') return `missing “;”${d2 ? ` before “${d2}”` : ''}.`;
        return d2 ? `expected “${d}” but found “${d2}”.` : `expected “${d}” (a missing brace or parenthesis?).`;
      case 'unknownFn':
        return `unknown function ${d}(). You can use fork, wait, waitpid, exit, execlp, printf, getpid, getppid and sleep.`;
      case 'execv':
        return `${d} needs an argv[] array and there are no arrays here: use execlp("ls", "ls", "-l", NULL).`;
      case 'arrays':
        return 'arrays are not supported: use plain int variables.';
      case 'pointers':
        return 'pointers are not supported (only &status in wait/waitpid).';
      case 'strings':
        return 'only integer variables (int, pid_t) can be declared; text goes straight into printf("...").';
      case 'keyword':
        return `“${d}” is not supported in this mini-C: use if/else, for or while.`;
      case 'otherFn':
        return `only main() can be defined (found ${d}). Put all the code inside main, or write it without main.`;
      case 'args':
        return `${d}() takes ${d2} argument(s).`;
      case 'fmtArgs':
        return `the printf format asks for ${d} value(s) (%d, %s…) but you passed ${d2}.`;
      case 'notLvalue':
        return 'the left side of = must be a variable.';
      case 'undeclared':
        return `variable “${d}” is not declared (declare it with int ${d} = …;).`;
      case 'divZero':
        return 'division by zero.';
      case 'loopCtl':
        return `“${d}” outside a loop.`;
      case 'empty':
        return 'write a program, for example: fork(); printf("hola\\n");';
    }
  },
  compare: 'Same program, another scheduler',
  compareSame: (n: number) => `The order may change, the count doesn’t: always ${n} line(s).`,
  compareDiff: 'Careful: here the number of lines changes (it depends on who runs first).',
  current: 'current',
  codePractice: {
    countQ: (word: string | null) => (word ? `How many times is “${word}” printed?` : 'How many lines does this program print?'),
    countA: (n: number, procs: number) => `${n}. There are ${procs} process(es) in total and each one that reaches a printf runs it with its own copy of the program.`,
    procsQ: 'How many processes are there in total, counting the original one?',
    procsA: (n: number, forks: number) => `${n}: the original plus ${forks} created by fork(). Every fork() that runs duplicates the process calling it.`,
    orphanQ: (pid: number) => `Who is P${pid}’s parent when it exits?`,
    orphanA: (pid: number, orig: number) => `init (PID 1): its original parent, P${orig}, exited first without waiting, so P${pid} was orphaned and init adopted it. That’s why getppid() returns 1.`,
    zombieQ: 'Does any process become a zombie? From when until when?',
    zombieA: (pid: number, from: number, to: number | null, reaper: number | null) =>
      to === null
        ? `P${pid} is a zombie from step ${from} to the end.`
        : reaper === 1
          ? `P${pid}, from step ${from} to ${to}: its parent exited without waiting, init adopted and reaped it.`
          : `P${pid}, from step ${from} to ${to}: it exited, but only at step ${to} did its parent P${reaper} call wait() and reap it.`,
    noZombie: 'None: each child exited while its parent was already waiting, or was reaped right away.',
    orderQ: (other: string) => `If the scheduler picks “${other}”, does the output change?`,
    orderSame: 'No: it comes out exactly the same (wait() forces the order, or only one order is possible).',
    orderDiff: (n: number) => `The order of the lines changes, but there are still ${n}. Never assume who runs first after fork().`,
  },
  codeExplain: (
    <>
      <p>
        <b>fork()</b> creates a child process that is a <b>copy</b> of the parent: the same variables, the same point in the program, even the printf buffer. The only difference is what it returns: <b>0</b> in the
        child and the <b>child’s PID</b> in the parent (−1 on failure). From then on each one has its own memory.
      </p>
      <p>
        After fork, who runs first is up to the <b>scheduler</b>: you can’t assume it. That’s why you choose it here, and below you can see the order changes but the count doesn’t.
      </p>
      <p>
        <b>wait()</b> blocks the parent until a child exits, and reaps it. A child that exited and nobody has waited for yet is a <b>zombie</b>: it no longer runs, but its process-table entry stays to keep the
        exit status. If the parent exits first, the child becomes an <b>orphan</b> and <b>init</b> (PID 1) adopts it and waits for it.
      </p>
      <p>
        <b>exec()</b> doesn’t create a process: it replaces the current process’s program (same PID). If it works, it never returns. OSTEP, chapter 5 (“Process API”).
      </p>
    </>
  ),
};

export const S = { es, en };
export type ForkStrings = Strings;
