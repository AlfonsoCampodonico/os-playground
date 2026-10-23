import type { ReactNode } from 'react';
import type { Holder, Note, PresetId } from '../../sim/pipes';

export interface NoteCtx {
  /** Name of the process doing the step. */
  who: string;
  /** Human label of an open file entry. */
  file: (id: string | null) => string;
  /** Hint for the fix in the hang summary. */
  parentDup: boolean;
}

const C = ({ children }: { children: ReactNode }) => <code>{children}</code>;
const Q = ({ children }: { children: ReactNode }) => <b className="font-semibold">«{children}»</b>;

const holdersEs = (hs: Holder[]) => hs.map((h) => `${h.name} fd ${h.fd}`).join(', ');

const es = {
  preset: 'Ejemplo',
  presets: {
    simple: 'ls | wc -l',
    three: 'ls -l | grep txt | wc -l > out.txt',
    sort: 'sort < in.txt > out.txt',
    stderr: 'cmd 2>&1 | less',
    append: 'echo hola >> log.txt',
  } as Record<PresetId, string>,
  cmd: 'Línea de comandos',
  cmdHint: '|  <  >  >>  2>  2>&1',
  forget: 'Olvidarse de cerrar los extremos del pipe',
  forgetHint: 'Ni el shell ni los hijos hacen close() de los fds del pipe.',
  parent: 'Redirigir en el shell (dup2 antes del fork)',
  parentHint: 'El shell hace los dup2/open sobre sí mismo y después forkea.',
  data: 'Mostrar el paso de datos',
  dataHint: 'Los read() y write() después del execvp.',
  tryIt: 'Probalo en Linux',
  errors: {
    empty: 'Escribí un comando, por ejemplo ls | wc -l.',
    pipeStart: 'Falta un comando antes del primer |.',
    pipeEnd: 'Falta un comando después del último |.',
    emptyStage: (n: number) => `Hay dos | seguidos: falta el comando ${n + 1}.`,
    noCommand: (n: number) => `El comando ${n} tiene redirecciones pero ningún programa.`,
    missingFile: (op: string) => `Falta el nombre de archivo después de ${op}.`,
    unsupported: (op: string) => `${op} no está soportado acá: probá con |, <, >, >>, 2> y 2>&1.`,
    quote: 'Hay una comilla sin cerrar.',
    badFd: (fd: number) => `Solo se pueden redirigir los fds 0, 1 y 2 (no el ${fd}).`,
    badDup: (op: string) => `${op} tiene que ir seguido de un número de fd, como en 2>&1.`,
    tooMany: (max: number) => `Hasta ${max} comandos por pipeline.`,
  },
  machine: 'Kernel',
  colFds: 'Tablas de fds (por proceso)',
  colFiles: 'Tabla de archivos abiertos',
  colObjs: 'Objetos (inodos, buffers)',
  std: ['stdin', 'stdout', 'stderr'],
  closed: 'cerrado',
  term: 'terminal',
  readEnd: 'lectura',
  writeEnd: 'escritura',
  ref: 'ref',
  offset: 'offset',
  mode: 'modo',
  appendMode: 'append',
  inode: 'inodo',
  bytes: (n: number) => `${n} B`,
  empty: 'vacío',
  readers: 'lectores',
  writers: 'escritores',
  onDisk: 'en disco, sin abrir',
  states: {
    running: 'corriendo',
    preExec: 'hijo, antes de exec',
    blocked: 'bloqueado en read',
    waiting: 'en waitpid',
    zombie: 'zombie',
  },
  shell: 'shell',
  start: 'El shell arranca con fds 0, 1 y 2 apuntando a la terminal (una sola entrada, refcount 3). Dale play o usá → para ver cada syscall.',
  log: 'Traza de syscalls',
  logHint: 'click para saltar a ese paso',
  phases: { setup: 'armado del pipeline', run: 'ejecución', end: 'fin' },
  syscalls: 'Syscalls',
  pipes: 'Pipes',
  openFds: 'Fds abiertos',
  procs: 'Procesos',
  freed: 'liberada',
  changed: 'Refcount',
  hangBadge: 'colgado',
  practice: 'Practicá',
  jump: 'click: ir al paso donde se creó',
  q1: '¿Cuántos fds abiertos tiene el shell justo antes del primer waitpid()?',
  a1: (n: number, list: string, leak: boolean, moved: boolean) => (
    <>
      <b>{n}</b>: {list}.{' '}
      {leak
        ? 'Los que sobran son extremos de pipe que el shell nunca cerró: cada hijo que forkeó después los heredó.'
        : 'Solo 0, 1 y 2: después de cada fork() el shell cierra los extremos del pipe que ya pasó a los hijos.'}
      {moved && ' Ojo: alguno de sus fds 0–2 ya no apunta a la terminal, porque el shell se redirigió a sí mismo.'}
    </>
  ),
  q2: (reader: string, n: number) => `¿Qué pasa si ${reader} hereda el extremo de escritura del pipe ${n} y no lo cierra?`,
  a2: (reader: string) => (
    <>
      {reader} nunca recibe EOF. <C>read()</C> devuelve 0 solo cuando el refcount del extremo de escritura llega a 0, y el propio {reader} lo mantiene en al menos 1.
      Se queda bloqueado en <C>read()</C> y el shell, en <C>waitpid()</C>. Prendé «Olvidarse de cerrar» y mirá el refcount.
    </>
  ),
  q2b: '¿Por qué el open() y el dup2() de la redirección los hace el hijo y no el shell?',
  a2b: (
    <>
      Porque los cambios en la tabla de fds del shell son permanentes: si el shell hiciera <C>dup2(fd, 1)</C>, su propio stdout quedaría apuntando al archivo y el próximo prompt iría a
      parar ahí. Al hacerlo en el hijo, entre el fork y el exec, solo cambia el programa nuevo. Prendé «Redirigir en el shell» para verlo.
    </>
  ),
  q3: '¿Cuál es el refcount de la entrada de /dev/pts/0 justo después del último fork()?',
  a3: (n: number) => <>{n}. Cada fd que apunta a la terminal, del shell o de cualquier hijo, suma uno; los dup2 que redirigen a un pipe o a un archivo restan.</>,
  explain: (
    <>
      <p>
        Cada proceso tiene su <b>tabla de file descriptors</b>: el fd es un índice y cada casilla apunta a una entrada de la <b>tabla de archivos abiertos</b> del kernel, que guarda el modo
        (r/w), el offset y un <b>refcount</b> (cuántos fds la apuntan). Esa entrada apunta al <b>objeto</b>: el inodo de un archivo, la terminal o el buffer de un pipe.
      </p>
      <p>
        <code>fork()</code> copia la tabla de fds: las entradas se comparten y su refcount sube. <code>execvp()</code> cambia el programa pero conserva la tabla. <code>dup2(a, b)</code> hace que b
        apunte a lo mismo que a. <code>close(fd)</code> baja el refcount y libera la entrada cuando llega a 0.
      </p>
      <p>
        Un <code>read()</code> de un pipe vacío devuelve 0 (EOF) <b>solo cuando nadie tiene abierto el extremo de escritura</b>. Por eso cada proceso cierra los extremos que no usa; si no, el
        lector espera para siempre. Pasá el mouse por un fd o una entrada para ver la cadena completa.
      </p>
      <p>OSTEP cap. 5 (fork, exec, wait y cómo la shell redirige) y cap. 39 (tabla de archivos abiertos, fork y dup). Es lo mismo que hacés en el TP1.</p>
    </>
  ),
  note: (n: Note, x: NoteCtx): ReactNode => {
    switch (n.k) {
      case 'pipe':
        return (
          <>
            El shell crea el pipe {n.n}: <C>fds[0] = {n.r}</C> es el extremo de lectura y <C>fds[1] = {n.w}</C> el de escritura. Son dos entradas nuevas en la tabla de archivos abiertos.
          </>
        );
      case 'fork':
        return (
          <>
            <C>fork()</C> crea el proceso {n.child}, una copia del shell: hereda sus {n.nfds} fds, así que cada entrada apuntada suma una referencia. Las entradas se comparten, no se copian.
          </>
        );
      case 'dup2':
        return (
          <>
            {n.inShell && <b>¡Ojo! Esto lo hace el shell sobre sí mismo. </b>}
            Ahora el fd {n.newfd} ({es.std[n.newfd] ?? 'fd'}) de {x.who} apunta a <Q>{x.file(n.to)}</Q>
            {n.replaced && n.replaced !== n.to ? (
              <>
                ; <Q>{x.file(n.replaced)}</Q> pierde una referencia
              </>
            ) : null}
            .{n.inShell && ' El cambio queda en el shell y lo heredan todos los hijos que forkee después.'}
          </>
        );
      case 'close':
        return (
          <>
            {x.who} suelta su fd {n.fd}: <Q>{x.file(n.file)}</Q> queda con refcount {n.ref}
            {n.ref === 0 ? ' y se libera' : ''}.
            {n.ref === 0 && x.file(n.file).includes(es.writeEnd) && ' Ya nadie puede escribir en ese pipe: quien lo lea va a ver EOF.'}
            {n.ref > 0 && x.file(n.file).includes('pipe') && n.inShell && ' Ese extremo ya lo tiene el hijo; el shell no lo necesita.'}
          </>
        );
      case 'open':
        return (
          <>
            <C>open()</C> devuelve {n.fd}, el fd libre más bajo, con una entrada nueva (offset 0).
            {n.created && ' Como no existía, O_CREAT lo crea.'}
            {n.truncated && ' O_TRUNC lo deja vacío antes de que nadie lo lea.'}
            {n.flags.includes('APPEND') && ' Con O_APPEND cada write() va al final.'}
          </>
        );
      case 'exec':
        return (
          <>
            <C>execvp</C> reemplaza el programa por {n.prog}, pero la tabla de fds queda igual: stdin = <Q>{x.file(n.std[0])}</Q>, stdout = <Q>{x.file(n.std[1])}</Q>, stderr ={' '}
            <Q>{x.file(n.std[2])}</Q>.
            {n.extra.length > 0 && (
              <>
                {' '}
                Ojo: también le quedaron abiertos {n.extra.map((e) => `fd ${e.fd} (${x.file(e.file)})`).join(', ')}.
              </>
            )}
          </>
        );
      case 'waitBlock':
        return (
          <>
            El shell se bloquea en <C>waitpid({n.child})</C> hasta que {n.name} termine.
          </>
        );
      case 'waitRet':
        return n.immediate ? (
          <>
            {n.name} ya había terminado (era zombie), así que <C>waitpid({n.child})</C> vuelve enseguida y lo recoge.
          </>
        ) : (
          <>
            <C>waitpid</C> devuelve {n.child}: el shell recoge a {n.name}, que deja de ser zombie.
          </>
        );
      case 'read':
        return n.tty ? (
          <>
            {x.who} lee de la terminal lo que tipeás: {n.n} bytes.
          </>
        ) : (
          <>
            {x.who} lee {n.n} bytes de <Q>{x.file(n.file)}</Q>.
          </>
        );
      case 'eof':
        return n.tty ? (
          <>Ctrl+D: el read() de la terminal devuelve 0, EOF.</>
        ) : x.file(n.file).includes('pipe') ? (
          <>
            <C>read()</C> devuelve 0 = EOF: el pipe está vacío y nadie tiene abierto el extremo de escritura. {x.who} puede terminar.
          </>
        ) : (
          <>
            <C>read()</C> devuelve 0: llegó al final del archivo.
          </>
        );
      case 'block':
        return (
          <>
            <C>read()</C> se bloquea: el pipe {n.pipe} está vacío, pero el extremo de escritura tiene refcount {n.holders.length} ({holdersEs(n.holders)}).{' '}
            {n.self ? <b>¡El propio {x.who} lo tiene abierto, así que nunca va a ver EOF!</b> : 'Mientras alguien lo tenga abierto, el kernel no puede devolver EOF.'}
          </>
        );
      case 'selfLoop':
        return (
          <>
            {x.who} vuelve a leer lo que él mismo escribió: su stdin y su stdout son el mismo pipe {n.pipe}. Loop infinito.
          </>
        );
      case 'write':
        return (
          <>
            {x.who} escribe {n.n} bytes en <Q>{x.file(n.file)}</Q>.
          </>
        );
      case 'sigpipe':
        return (
          <>
            <C>write()</C> en el pipe {n.pipe}, que ya no tiene lectores: falla con EPIPE y el kernel le manda SIGPIPE a {x.who}.
          </>
        );
      case 'ebadf':
        return (
          <>
            <C>{n.op}()</C> sobre el fd {n.fd} falla con EBADF: ese fd no está abierto para {n.op === 'read' ? 'leer' : 'escribir'}.
          </>
        );
      case 'exit':
        return (
          <>
            {n.signal ? `${n.name} muere por SIGPIPE` : `${n.name} termina`}: el kernel cierra sus {n.closed} fds y queda zombie hasta el waitpid.
            {n.eofPipes.map((p) => (
              <span key={p}> El pipe {p} se queda sin escritores: el próximo read() del otro lado da EOF.</span>
            ))}
          </>
        );
      case 'prompt':
        return n.ok && n.stdinOk ? (
          <>Listo: el shell vuelve a escribir el prompt en la terminal, con sus fds 0, 1 y 2 intactos.</>
        ) : (
          <>
            El prompt no fue a la terminal sino a <Q>{x.file(n.file)}</Q>: el shell hizo la redirección sobre sí mismo y perdió su stdout.
            {!n.stdinOk && ' Y su stdin tampoco es más la terminal.'}
          </>
        );
      case 'hang':
        return (
          <>
            <b>El pipeline se colgó.</b>{' '}
            {n.blocked.map((b) =>
              b.loop ? (
                <span key={b.pid}>{b.name} lee su propia salida del pipe {b.pipe}. </span>
              ) : (
                <span key={b.pid}>
                  {b.name} espera EOF en el pipe {b.pipe}, pero lo tienen abierto para escribir: {holdersEs(b.holders)}.{' '}
                </span>
              ),
            )}
            {n.waitingFor && <>El shell queda en waitpid({n.waitingFor.pid}) para siempre. </>}
            {x.parentDup ? 'Solución: hacer los dup2 en el hijo, después del fork.' : 'Solución: cerrar en cada proceso los extremos del pipe que no usa.'}
          </>
        );
    }
  },
};

type Strings = typeof es;

const holdersEn = (hs: Holder[]) => hs.map((h) => `${h.name} fd ${h.fd}`).join(', ');

const en: Strings = {
  preset: 'Example',
  presets: es.presets,
  cmd: 'Command line',
  cmdHint: es.cmdHint,
  forget: 'Forget to close the pipe ends',
  forgetHint: 'Neither the shell nor the children close() the pipe fds.',
  parent: 'Redirect in the shell (dup2 before fork)',
  parentHint: 'The shell does the dup2/open on itself and then forks.',
  data: 'Show the data flowing',
  dataHint: 'The read() and write() calls after execvp.',
  tryIt: 'Try it on Linux',
  errors: {
    empty: 'Type a command, e.g. ls | wc -l.',
    pipeStart: 'A command is missing before the first |.',
    pipeEnd: 'A command is missing after the last |.',
    emptyStage: (n: number) => `Two | in a row: command ${n + 1} is missing.`,
    noCommand: (n: number) => `Command ${n} has redirections but no program.`,
    missingFile: (op: string) => `A file name is missing after ${op}.`,
    unsupported: (op: string) => `${op} isn't supported here: use |, <, >, >>, 2> and 2>&1.`,
    quote: 'There is an unclosed quote.',
    badFd: (fd: number) => `Only fds 0, 1 and 2 can be redirected (not ${fd}).`,
    badDup: (op: string) => `${op} must be followed by an fd number, as in 2>&1.`,
    tooMany: (max: number) => `At most ${max} commands per pipeline.`,
  },
  machine: 'Kernel',
  colFds: 'Fd tables (per process)',
  colFiles: 'Open file table',
  colObjs: 'Objects (inodes, buffers)',
  std: ['stdin', 'stdout', 'stderr'],
  closed: 'closed',
  term: 'terminal',
  readEnd: 'read end',
  writeEnd: 'write end',
  ref: 'ref',
  offset: 'offset',
  mode: 'mode',
  appendMode: 'append',
  inode: 'inode',
  bytes: (n: number) => `${n} B`,
  empty: 'empty',
  readers: 'readers',
  writers: 'writers',
  onDisk: 'on disk, not open',
  states: {
    running: 'running',
    preExec: 'child, before exec',
    blocked: 'blocked in read',
    waiting: 'in waitpid',
    zombie: 'zombie',
  },
  shell: 'shell',
  start: 'The shell starts with fds 0, 1 and 2 pointing at the terminal (a single entry, refcount 3). Press play or use → to see each syscall.',
  log: 'Syscall trace',
  logHint: 'click to jump to that step',
  phases: { setup: 'building the pipeline', run: 'running', end: 'end' },
  syscalls: 'Syscalls',
  pipes: 'Pipes',
  openFds: 'Open fds',
  procs: 'Processes',
  freed: 'freed',
  changed: 'Refcount',
  hangBadge: 'hung',
  practice: 'Practice',
  jump: 'click: go to the step that created it',
  q1: 'How many fds does the shell have open right before the first waitpid()?',
  a1: (n: number, list: string, leak: boolean, moved: boolean) => (
    <>
      <b>{n}</b>: {list}.{' '}
      {leak
        ? 'The extra ones are pipe ends the shell never closed: every child forked afterwards inherited them.'
        : 'Just 0, 1 and 2: after each fork() the shell closes the pipe ends it handed to the children.'}
      {moved && ' Careful: some of its fds 0–2 no longer point at the terminal, because the shell redirected itself.'}
    </>
  ),
  q2: (reader: string, n: number) => `What happens if ${reader} inherits the write end of pipe ${n} and doesn't close it?`,
  a2: (reader: string) => (
    <>
      {reader} never gets EOF. <C>read()</C> returns 0 only when the write end's refcount drops to 0, and {reader} itself keeps it at 1 or more. It blocks in <C>read()</C> and the shell
      in <C>waitpid()</C>. Turn on “Forget to close” and watch the refcount.
    </>
  ),
  q2b: 'Why does the child, not the shell, do the open() and dup2() of a redirection?',
  a2b: (
    <>
      Because changes to the shell’s fd table are permanent: if the shell did <C>dup2(fd, 1)</C>, its own stdout would keep pointing at the file and the next prompt would end up there. Doing it
      in the child, between fork and exec, only affects the new program. Turn on “Redirect in the shell” to see it.
    </>
  ),
  q3: 'What is the refcount of the /dev/pts/0 entry right after the last fork()?',
  a3: (n: number) => <>{n}. Every fd pointing at the terminal, in the shell or any child, adds one; each dup2 that redirects to a pipe or a file takes one away.</>,
  explain: (
    <>
      <p>
        Each process has its own <b>file descriptor table</b>: the fd is an index and each slot points at an entry of the kernel’s <b>open file table</b>, which holds the mode (r/w), the
        offset and a <b>refcount</b> (how many fds point at it). That entry points at the <b>object</b>: a file’s inode, the terminal or a pipe’s buffer.
      </p>
      <p>
        <code>fork()</code> copies the fd table: entries are shared and their refcount goes up. <code>execvp()</code> changes the program but keeps the table. <code>dup2(a, b)</code> makes b
        point where a points. <code>close(fd)</code> drops the refcount and frees the entry at 0.
      </p>
      <p>
        A <code>read()</code> on an empty pipe returns 0 (EOF) <b>only when nobody holds the write end open</b>. That is why every process closes the ends it doesn’t use; otherwise the reader
        waits forever. Hover an fd or an entry to see the whole chain.
      </p>
      <p>OSTEP ch. 5 (fork, exec, wait and how the shell redirects) and ch. 39 (open file table, fork and dup). It is exactly what you do in TP1.</p>
    </>
  ),
  note: (n: Note, x: NoteCtx): ReactNode => {
    switch (n.k) {
      case 'pipe':
        return (
          <>
            The shell creates pipe {n.n}: <C>fds[0] = {n.r}</C> is the read end and <C>fds[1] = {n.w}</C> the write end. Two new entries in the open file table.
          </>
        );
      case 'fork':
        return (
          <>
            <C>fork()</C> creates process {n.child}, a copy of the shell: it inherits its {n.nfds} fds, so every entry they point at gains a reference. Entries are shared, not copied.
          </>
        );
      case 'dup2':
        return (
          <>
            {n.inShell && <b>Careful! The shell is doing this to itself. </b>}
            Now fd {n.newfd} ({en.std[n.newfd] ?? 'fd'}) of {x.who} points at <Q>{x.file(n.to)}</Q>
            {n.replaced && n.replaced !== n.to ? (
              <>
                ; <Q>{x.file(n.replaced)}</Q> loses a reference
              </>
            ) : null}
            .{n.inShell && ' The change stays in the shell and every child it forks later inherits it.'}
          </>
        );
      case 'close':
        return (
          <>
            {x.who} lets go of fd {n.fd}: <Q>{x.file(n.file)}</Q> is left with refcount {n.ref}
            {n.ref === 0 ? ' and is freed' : ''}.
            {n.ref === 0 && x.file(n.file).includes(en.writeEnd) && ' Nobody can write into that pipe anymore: its reader will see EOF.'}
            {n.ref > 0 && x.file(n.file).includes('pipe') && n.inShell && ' The child already has that end; the shell doesn’t need it.'}
          </>
        );
      case 'open':
        return (
          <>
            <C>open()</C> returns {n.fd}, the lowest free fd, with a new entry (offset 0).
            {n.created && ' It didn’t exist, so O_CREAT creates it.'}
            {n.truncated && ' O_TRUNC empties it before anyone reads it.'}
            {n.flags.includes('APPEND') && ' With O_APPEND every write() goes to the end.'}
          </>
        );
      case 'exec':
        return (
          <>
            <C>execvp</C> replaces the program with {n.prog}, but the fd table stays the same: stdin = <Q>{x.file(n.std[0])}</Q>, stdout = <Q>{x.file(n.std[1])}</Q>, stderr ={' '}
            <Q>{x.file(n.std[2])}</Q>.
            {n.extra.length > 0 && (
              <>
                {' '}
                Careful: it also kept {n.extra.map((e) => `fd ${e.fd} (${x.file(e.file)})`).join(', ')} open.
              </>
            )}
          </>
        );
      case 'waitBlock':
        return (
          <>
            The shell blocks in <C>waitpid({n.child})</C> until {n.name} exits.
          </>
        );
      case 'waitRet':
        return n.immediate ? (
          <>
            {n.name} had already exited (a zombie), so <C>waitpid({n.child})</C> returns right away and reaps it.
          </>
        ) : (
          <>
            <C>waitpid</C> returns {n.child}: the shell reaps {n.name}, which stops being a zombie.
          </>
        );
      case 'read':
        return n.tty ? (
          <>
            {x.who} reads what you type in the terminal: {n.n} bytes.
          </>
        ) : (
          <>
            {x.who} reads {n.n} bytes from <Q>{x.file(n.file)}</Q>.
          </>
        );
      case 'eof':
        return n.tty ? (
          <>Ctrl+D: the terminal read() returns 0, EOF.</>
        ) : x.file(n.file).includes('pipe') ? (
          <>
            <C>read()</C> returns 0 = EOF: the pipe is empty and nobody holds the write end. {x.who} can finish.
          </>
        ) : (
          <>
            <C>read()</C> returns 0: end of file.
          </>
        );
      case 'block':
        return (
          <>
            <C>read()</C> blocks: pipe {n.pipe} is empty, but its write end has refcount {n.holders.length} ({holdersEn(n.holders)}).{' '}
            {n.self ? <b>{x.who} itself holds it open, so it will never see EOF!</b> : 'While anyone holds it open, the kernel can’t return EOF.'}
          </>
        );
      case 'selfLoop':
        return (
          <>
            {x.who} reads back what it just wrote: its stdin and stdout are the same pipe {n.pipe}. Infinite loop.
          </>
        );
      case 'write':
        return (
          <>
            {x.who} writes {n.n} bytes into <Q>{x.file(n.file)}</Q>.
          </>
        );
      case 'sigpipe':
        return (
          <>
            <C>write()</C> into pipe {n.pipe}, which has no readers left: it fails with EPIPE and the kernel sends SIGPIPE to {x.who}.
          </>
        );
      case 'ebadf':
        return (
          <>
            <C>{n.op}()</C> on fd {n.fd} fails with EBADF: that fd isn’t open for {n.op === 'read' ? 'reading' : 'writing'}.
          </>
        );
      case 'exit':
        return (
          <>
            {n.signal ? `${n.name} dies of SIGPIPE` : `${n.name} exits`}: the kernel closes its {n.closed} fds and it stays a zombie until waitpid.
            {n.eofPipes.map((p) => (
              <span key={p}> Pipe {p} has no writers left: the next read() on the other side gets EOF.</span>
            ))}
          </>
        );
      case 'prompt':
        return n.ok && n.stdinOk ? (
          <>Done: the shell prints its prompt to the terminal again, with fds 0, 1 and 2 untouched.</>
        ) : (
          <>
            The prompt didn’t go to the terminal but to <Q>{x.file(n.file)}</Q>: the shell redirected itself and lost its stdout.
            {!n.stdinOk && ' Its stdin isn’t the terminal anymore either.'}
          </>
        );
      case 'hang':
        return (
          <>
            <b>The pipeline hung.</b>{' '}
            {n.blocked.map((b) =>
              b.loop ? (
                <span key={b.pid}>{b.name} reads its own output from pipe {b.pipe}. </span>
              ) : (
                <span key={b.pid}>
                  {b.name} waits for EOF on pipe {b.pipe}, but these hold it open for writing: {holdersEn(b.holders)}.{' '}
                </span>
              ),
            )}
            {n.waitingFor && <>The shell stays in waitpid({n.waitingFor.pid}) forever. </>}
            {x.parentDup ? 'Fix: do the dup2 calls in the child, after fork.' : 'Fix: in every process, close the pipe ends it doesn’t use.'}
          </>
        );
    }
  },
};

export const S = { es, en };
export type PipesStrings = Strings;
