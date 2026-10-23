import { PIDNUM, hex, type OpKind, type PresetId, type ProcState, type Step, type Sys, type TrapEvent } from '../../sim/syscalls';

export interface Ctx {
  /** Timer quantum, 0 = off. */
  T: number;
}

const call: Record<Sys, string> = {
  write: 'write(1, "hola\\n", 5)',
  getpid: 'getpid()',
  read: 'read(3, buf, 512)',
  exit: 'exit(0)',
};
const callEn = call;

/* ---------------- Spanish ---------------- */

function labelEs(s: Step): string {
  const p = s.pid ?? '';
  switch (s.kind) {
    case 'boot-trap-table':
      return 'inicializa la trap table';
    case 'hw-remember':
      return 'recuerda las direcciones de los handlers (syscall, timer, …)';
    case 'boot-timer':
      return 'arranca el timer de interrupciones';
    case 'hw-timer-start':
      return `arranca el timer: interrumpe cada ${s.n} instr.`;
    case 'os-create':
      return `crea ${p}: entrada en la lista de procesos, memoria, carga el programa, user stack con argv, llena el k-stack(${p}) con regs/PC`;
    case 'os-rft':
      return s.first ? `pasa al k-stack(${p}) · return-from-trap` : `return-from-trap → ${p}`;
    case 'hw-rft':
      return `restaura regs(${p}) ← k-stack(${p}) · modo usuario · salta ${s.first ? 'a main' : `al PC de ${p}`}`;
    case 'user-compute':
      return `${p} ejecuta ${s.n} instrucci${s.n === 1 ? 'ón' : 'ones'}`;
    case 'user-syscall':
      return `llama a ${call[s.sys!]}: %eax ← ${s.sysno}, ejecuta trap`;
    case 'user-priv':
      return 'ejecuta cli (instrucción privilegiada)';
    case 'hw-trap':
      return `guarda regs(${p}) → k-stack(${p}) · modo kernel · salta al syscall handler`;
    case 'hw-irq':
      return `interrupción del ${s.irq === 'timer' ? 'timer' : 'disco'}: guarda regs(${p}) → k-stack(${p}) · modo kernel · salta al ${s.irq} handler`;
    case 'hw-fault':
      return `¡excepción! guarda regs(${p}) → k-stack(${p}) · modo kernel · salta al handler (13)`;
    case 'os-syscall':
      return s.sys === 'write' ? `sys_write: escribe "hola\\n" · deja ${s.ret} en el trap frame` : `sys_getpid: deja ${s.ret} en el trap frame`;
    case 'os-read-block':
      return 'sys_read: pide el bloque al disco · A queda bloqueado';
    case 'os-disk':
      return `atiende el disco: datos al buffer de A, ${s.ret} en su trap frame · A listo`;
    case 'os-timer':
      return s.to ? `atiende el timer: el scheduler elige a ${s.to}` : `atiende el timer: nadie más listo, sigue ${p}`;
    case 'os-switch':
      return s.saved
        ? `switch(): guarda regs(${s.from}) → proc_t(${s.from}) · restaura regs(${s.to}) ← proc_t(${s.to}) · pasa al k-stack(${s.to})`
        : `switch(): restaura regs(${s.to}) ← proc_t(${s.to}) · pasa al k-stack(${s.to})`;
    case 'os-kill':
      return 'mata a A';
    case 'os-exit':
      return 'sys_exit: libera la memoria de A y lo saca de la lista de procesos';
    case 'os-idle':
      return 'no queda nadie: espera en el scheduler';
  }
}

function narrateEs(s: Step, c: Ctx): string {
  const p = s.pid ?? '';
  switch (s.kind) {
    case 'boot-trap-table':
      return 'Boot: la máquina arranca en modo kernel. Lo primero que hace el SO es armar la trap table: qué handler corre para cada syscall, interrupción o excepción.';
    case 'hw-remember':
      return 'Con una instrucción privilegiada (lidt) el SO le dice al hardware dónde está la trap table. Desde ahora la CPU sabe a dónde saltar en cada trap, y ningún proceso lo puede cambiar.';
    case 'boot-timer':
      return 'El SO programa el timer (también es privilegiado). Es su garantía de recuperar la CPU aunque un proceso nunca haga una syscall.';
    case 'hw-timer-start':
      return `El timer arranca: va a interrumpir a la CPU cada ${s.n} instrucciones de usuario.`;
    case 'os-create':
      return p === 'A'
        ? 'El SO crea el proceso A y deja en su kernel stack un trap frame «falso» con el PC de main y el user stack. Así A puede arrancar volviendo de un trap que nunca hizo.'
        : 'El SO crea B igual que A y además prepara su contexto en proc_t(B), para que switch() lo pueda poner a correr más adelante.';
    case 'os-rft':
      return s.first
        ? 'El kernel se pasa al kernel stack de A y ejecuta return-from-trap: el proceso arranca como si volviera de un trap.'
        : `El kernel ejecuta return-from-trap (iret): la instrucción especial que vuelve a modo usuario. Va a volver a ${p}.`;
    case 'hw-rft':
      return s.first
        ? 'El hardware saca el trap frame del k-stack(A): carga %eip = main y %esp = user stack, baja a modo usuario y salta a main(). Arrancó el proceso.'
        : `El hardware saca el trap frame del k-stack(${p}): restaura %eip, %esp, %eax y %ebx, baja a modo usuario y salta a ${hex(s.cpu.regs.eip)}, donde ${p} había quedado.` +
            (s.cpu.eaxNote === 'ret' ? ` En %eax viene el valor de retorno: ${s.cpu.regs.eax}.` : '');
    case 'user-compute':
      return (
        `Ejecución directa: ${p} corre ${s.n} instrucci${s.n === 1 ? 'ón' : 'ones'} a toda velocidad en la CPU. El SO no está corriendo: no se entera de nada hasta el próximo trap.` +
        (c.T && s.timerOn ? ` Faltan ${s.timerLeft} para la interrupción del timer.` : '')
      );
    case 'user-syscall':
      return `${p} llama a ${call[s.sys!]}. La función de la libc pone el número de syscall (SYS_${s.sys} = ${s.sysno}) en %eax y ejecuta trap (int $64). No elige a qué dirección saltar: solo dice qué servicio quiere.`;
    case 'user-priv':
      return 'A intenta ejecutar cli (deshabilitar interrupciones). Es una instrucción privilegiada: si un proceso pudiera hacerlo, el SO no recuperaría nunca la CPU.';
    case 'hw-trap':
      return `El hardware guarda los registros de ${p} en su kernel stack (el trap frame), pone el mode bit en kernel y salta al handler de la entrada 64 de la trap table. Es la única puerta de entrada al kernel.`;
    case 'hw-irq':
      return s.irq === 'timer'
        ? `El timer interrumpe a ${p} sin que lo pida: el hardware guarda sus registros en el k-stack(${p}), pasa a modo kernel y salta al timer handler (entrada 32). El SO recupera el control.`
        : `El disco avisa que terminó: interrupción (entrada 46). Se guardan los registros de ${p}, que es el que estaba corriendo, aunque la interrupción no tenga nada que ver con él.`;
    case 'hw-fault':
      return 'La CPU ve una instrucción privilegiada en modo usuario y no la ejecuta: lanza una excepción (protección general, entrada 13). Guarda los registros de A, pasa a modo kernel y salta al handler del SO.';
    case 'os-syscall':
      return s.sys === 'write'
        ? `Modo kernel: el syscall handler lee %eax = ${s.sysno} y llama a sys_write, que escribe "hola\\n" en la consola. El valor de retorno (${s.ret} bytes) lo deja en el %eax del trap frame, para que ${p} lo vea al volver.`
        : `El syscall handler lee %eax = ${s.sysno} → sys_getpid. El valor de retorno (${s.ret}, el pid de ${p}) lo deja en el %eax del trap frame.`;
    case 'os-read-block':
      return 'sys_read: los datos no están en memoria, así que el kernel le pide el bloque al disco. Esperar llevaría millones de ciclos: marca a A como bloqueado y busca otro proceso.';
    case 'os-disk':
      return `El disk handler copia el bloque al buffer de A y deja ${s.ret} (bytes leídos) en el %eax de su trap frame. A pasa de bloqueado a listo y el scheduler lo elige.`;
    case 'os-timer':
      return s.to
        ? `El timer handler llama al scheduler: ${p} ya usó su quantum y ${s.to} está listo, así que toca context switch.`
        : `El timer handler llama al scheduler, pero no hay otro proceso listo: ${p} sigue corriendo.`;
    case 'os-switch':
      return s.saved
        ? `Context switch: switch() guarda los registros de kernel de ${s.from} en proc_t(${s.from}), restaura los de ${s.to} desde proc_t(${s.to}) y cambia al kernel stack de ${s.to}. Ahora el return-from-trap va a volver a ${s.to}, no a ${s.from}.`
        : `switch() restaura los registros de kernel de ${s.to} desde proc_t(${s.to}) y cambia a su kernel stack. ${s.from} ya no existe: no hay nada que guardar.`;
    case 'os-kill':
      return 'El SO no deja que un proceso en modo usuario deshabilite las interrupciones: lo mata. El resto del programa de A no se ejecuta.';
    case 'os-exit':
      return 'sys_exit: el kernel libera la memoria de A y lo saca de la lista de procesos. A nunca vuelve a modo usuario.';
    case 'os-idle':
      return 'No queda ningún proceso listo: el kernel se queda en el scheduler esperando una interrupción.';
  }
}

/* ---------------- English ---------------- */

function labelEn(s: Step): string {
  const p = s.pid ?? '';
  switch (s.kind) {
    case 'boot-trap-table':
      return 'initialize trap table';
    case 'hw-remember':
      return 'remember addresses of the handlers (syscall, timer, …)';
    case 'boot-timer':
      return 'start interrupt timer';
    case 'hw-timer-start':
      return `start timer: interrupt every ${s.n} instr.`;
    case 'os-create':
      return `create ${p}: process list entry, memory, load program, user stack with argv, fill k-stack(${p}) with regs/PC`;
    case 'os-rft':
      return s.first ? `switch to k-stack(${p}) · return-from-trap` : `return-from-trap → ${p}`;
    case 'hw-rft':
      return `restore regs(${p}) ← k-stack(${p}) · user mode · jump to ${s.first ? 'main' : `${p}'s PC`}`;
    case 'user-compute':
      return `${p} runs ${s.n} instruction${s.n === 1 ? '' : 's'}`;
    case 'user-syscall':
      return `calls ${callEn[s.sys!]}: %eax ← ${s.sysno}, executes trap`;
    case 'user-priv':
      return 'executes cli (privileged instruction)';
    case 'hw-trap':
      return `save regs(${p}) → k-stack(${p}) · kernel mode · jump to syscall handler`;
    case 'hw-irq':
      return `${s.irq} interrupt: save regs(${p}) → k-stack(${p}) · kernel mode · jump to ${s.irq} handler`;
    case 'hw-fault':
      return `exception! save regs(${p}) → k-stack(${p}) · kernel mode · jump to handler (13)`;
    case 'os-syscall':
      return s.sys === 'write' ? `sys_write: writes "hola\\n" · leaves ${s.ret} in the trap frame` : `sys_getpid: leaves ${s.ret} in the trap frame`;
    case 'os-read-block':
      return 'sys_read: asks the disk for the block · A blocks';
    case 'os-disk':
      return `handle disk: data into A's buffer, ${s.ret} in its trap frame · A ready`;
    case 'os-timer':
      return s.to ? `handle timer: the scheduler picks ${s.to}` : `handle timer: nobody else ready, ${p} keeps going`;
    case 'os-switch':
      return s.saved
        ? `switch(): save regs(${s.from}) → proc_t(${s.from}) · restore regs(${s.to}) ← proc_t(${s.to}) · switch to k-stack(${s.to})`
        : `switch(): restore regs(${s.to}) ← proc_t(${s.to}) · switch to k-stack(${s.to})`;
    case 'os-kill':
      return 'kill A';
    case 'os-exit':
      return "sys_exit: free A's memory, remove it from the process list";
    case 'os-idle':
      return 'nobody left: wait in the scheduler';
  }
}

function narrateEn(s: Step, c: Ctx): string {
  const p = s.pid ?? '';
  switch (s.kind) {
    case 'boot-trap-table':
      return 'Boot: the machine starts in kernel mode. The first thing the OS does is build the trap table: which handler runs for each syscall, interrupt or exception.';
    case 'hw-remember':
      return 'With a privileged instruction (lidt) the OS tells the hardware where the trap table lives. From now on the CPU knows where to jump on every trap, and no process can change it.';
    case 'boot-timer':
      return 'The OS programs the timer (also privileged). It is the guarantee that it gets the CPU back even if a process never makes a syscall.';
    case 'hw-timer-start':
      return `The timer starts: it will interrupt the CPU every ${s.n} user instructions.`;
    case 'os-create':
      return p === 'A'
        ? 'The OS creates process A and leaves a "fake" trap frame on its kernel stack with main\'s PC and the user stack. That way A can start by returning from a trap it never made.'
        : 'The OS creates B like A and also prepares its context in proc_t(B), so switch() can run it later.';
    case 'os-rft':
      return s.first
        ? "The kernel moves onto A's kernel stack and executes return-from-trap: the process starts as if returning from a trap."
        : `The kernel executes return-from-trap (iret): the special instruction that goes back to user mode. It will return to ${p}.`;
    case 'hw-rft':
      return s.first
        ? "The hardware pops the trap frame off k-stack(A): loads %eip = main and %esp = user stack, drops to user mode and jumps to main(). The process is running."
        : `The hardware pops the trap frame off k-stack(${p}): restores %eip, %esp, %eax and %ebx, drops to user mode and jumps to ${hex(s.cpu.regs.eip)}, where ${p} left off.` +
            (s.cpu.eaxNote === 'ret' ? ` %eax carries the return value: ${s.cpu.regs.eax}.` : '');
    case 'user-compute':
      return (
        `Direct execution: ${p} runs ${s.n} instruction${s.n === 1 ? '' : 's'} at full speed on the CPU. The OS is not running: it finds out nothing until the next trap.` +
        (c.T && s.timerOn ? ` ${s.timerLeft} left until the timer interrupt.` : '')
      );
    case 'user-syscall':
      return `${p} calls ${callEn[s.sys!]}. The libc wrapper puts the syscall number (SYS_${s.sys} = ${s.sysno}) in %eax and executes trap (int $64). It does not choose where to jump: it only says which service it wants.`;
    case 'user-priv':
      return 'A tries to execute cli (disable interrupts). It is a privileged instruction: if a process could do it, the OS would never get the CPU back.';
    case 'hw-trap':
      return `The hardware saves ${p}'s registers on its kernel stack (the trap frame), sets the mode bit to kernel and jumps to the handler in trap table entry 64. It is the only way into the kernel.`;
    case 'hw-irq':
      return s.irq === 'timer'
        ? `The timer interrupts ${p} without asking: the hardware saves its registers on k-stack(${p}), switches to kernel mode and jumps to the timer handler (entry 32). The OS is back in control.`
        : `The disk signals it is done: interrupt (entry 46). The registers saved are ${p}'s, since it was running, even though the interrupt has nothing to do with it.`;
    case 'hw-fault':
      return "The CPU sees a privileged instruction in user mode and refuses it: it raises an exception (general protection, entry 13). It saves A's registers, switches to kernel mode and jumps to the OS handler.";
    case 'os-syscall':
      return s.sys === 'write'
        ? `Kernel mode: the syscall handler reads %eax = ${s.sysno} and calls sys_write, which writes "hola\\n" to the console. The return value (${s.ret} bytes) goes into the trap frame's %eax, for ${p} to see on return.`
        : `The syscall handler reads %eax = ${s.sysno} → sys_getpid. The return value (${s.ret}, ${p}'s pid) goes into the trap frame's %eax.`;
    case 'os-read-block':
      return 'sys_read: the data is not in memory, so the kernel asks the disk for the block. Waiting would take millions of cycles: it marks A blocked and looks for another process.';
    case 'os-disk':
      return `The disk handler copies the block into A's buffer and leaves ${s.ret} (bytes read) in its trap frame's %eax. A goes from blocked to ready and the scheduler picks it.`;
    case 'os-timer':
      return s.to
        ? `The timer handler calls the scheduler: ${p} used up its quantum and ${s.to} is ready, so it is time for a context switch.`
        : `The timer handler calls the scheduler, but no other process is ready: ${p} keeps running.`;
    case 'os-switch':
      return s.saved
        ? `Context switch: switch() saves ${s.from}'s kernel registers in proc_t(${s.from}), restores ${s.to}'s from proc_t(${s.to}) and moves onto ${s.to}'s kernel stack. Now return-from-trap will return into ${s.to}, not ${s.from}.`
        : `switch() restores ${s.to}'s kernel registers from proc_t(${s.to}) and moves onto its kernel stack. ${s.from} is gone: nothing to save.`;
    case 'os-kill':
      return "The OS does not let a user-mode process disable interrupts: it kills it. The rest of A's program never runs.";
    case 'os-exit':
      return "sys_exit: the kernel frees A's memory and removes it from the process list. A never returns to user mode.";
    case 'os-idle':
      return 'No process is ready: the kernel waits in the scheduler for an interrupt.';
  }
}

/* ---------------- Dictionary ---------------- */

const stateEs: Record<ProcState, string> = { none: 'no existe', ready: 'listo', running: 'corriendo', blocked: 'bloqueado', done: 'terminado', killed: 'muerto' };
const stateEn: Record<ProcState, string> = { none: 'not created', ready: 'ready', running: 'running', blocked: 'blocked', done: 'exited', killed: 'killed' };

export const S = {
  es: {
    label: labelEs,
    narrate: narrateEs,
    call,
    preset: 'Ejemplo',
    presets: {
      write: 'write()',
      getpid: 'getpid() ×2',
      boot: 'Boot (fig. 6.2)',
      timer: 'Timer A→B (fig. 6.3)',
      priv: 'Instr. privilegiada',
      read: 'read() bloqueante',
    } as Record<PresetId, string>,
    program: 'Programa del proceso A',
    programHint: 'en orden',
    ops: {
      compute: 'cómputo',
      write: 'write(1, "hola\\n", 5)',
      getpid: 'getpid()',
      read: 'read(3, buf, 512)',
      exit: 'exit(0)',
      priv: 'cli  ⚠ privilegiada',
    } as Record<OpKind, string>,
    addOps: {
      compute: 'cómputo',
      write: 'write',
      getpid: 'getpid',
      read: 'read',
      exit: 'exit',
      priv: 'cli',
    } as Record<OpKind, string>,
    instr: 'instr.',
    implicitExit: 'exit() implícito (return de main)',
    notRun: 'no se ejecuta',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    remove: 'Sacar',
    add: 'Agregar',
    full: 'Máximo 12 operaciones',
    boot: 'Mostrar el boot',
    bootHint: 'filas de arriba de las figuras',
    timer: 'Interrupción de timer',
    every: 'Cada cuántas instrucciones',
    timerHint: 'instrucciones de usuario',
    disk: 'El disco tarda',
    diskHint: 'instrucciones de B',
    lanes: { os: 'Kernel', hw: 'Hardware', user: 'Proceso' },
    laneSub: { os: 'modo kernel', hw: '', user: 'modo usuario' },
    phaseBoot: 'SO @ boot (modo kernel)',
    phaseRun: 'SO @ run',
    timeline: 'Protocolo LDE',
    same: (f: string): string => (f === '6.3' ? 'Igual que la figura 6.3 de OSTEP (LDE con interrupción de timer)' : 'Igual que la figura 6.2 de OSTEP (LDE, sin interrupciones)'),
    noBoot: 'sin las filas de boot',
    ext: (xs: string[]) => `+ extensión fuera de la figura: ${xs.join(', ')}`,
    extRead: 'read() bloqueante',
    extPriv: 'instrucción privilegiada',
    cpu: 'CPU',
    modeBit: 'Mode bit',
    user: 'usuario',
    kernel: 'kernel',
    cpl: (m: string): string => (m === 'user' ? 'CPL 3 · modo usuario: solo instrucciones comunes' : 'CPL 0 · modo kernel: puede todo'),
    running: 'Corre',
    codeOf: (p: string) => `código de ${p}`,
    kernelCode: 'código del kernel',
    stackOf: { boot: 'stack de boot', user: (p: string) => `user stack (${p})`, kernel: (p: string) => `k-stack (${p})` },
    sysno: 'nº de syscall',
    retval: 'valor de retorno',
    counter: 'cálculo',
    idtr: 'Trap table en',
    notLoaded: 'sin cargar',
    timerOff: 'timer apagado',
    timerBadge: (n: number) => `timer cada ${n}`,
    timerLeft: (n: number) => `timer: faltan ${n}`,
    trapTable: 'Trap table',
    colEvent: 'evento',
    colHandler: 'handler',
    notInit: 'sin inicializar',
    events: { gp: 'excepción: protección general', timer: 'interrupción del timer', disk: 'interrupción del disco', syscall: 'syscall (trap)' } as Record<TrapEvent, string>,
    sysTable: 'Tabla de syscalls (%eax)',
    procs: 'Procesos',
    proc: (p: string) => `Proceso ${p}`,
    pid: (p: 'A' | 'B') => `pid ${PIDNUM[p]}`,
    procB: 'loop de cómputo infinito',
    state: stateEs,
    uStack: 'user stack',
    kStack: 'kernel stack',
    trapFrame: 'trap frame',
    empty: 'vacío',
    context: (p: string) => `proc_t(${p}) · contexto`,
    ctxHint: 'regs de kernel que guarda switch()',
    sp: '← %esp',
    console: 'Consola',
    consoleEmpty: 'todavía nada',
    modeSwitches: 'Cambios de modo',
    syscalls: 'Syscalls',
    kVsU: 'Kernel / usuario',
    kVsUSub: 'filas de cada lado',
    ctxSwitches: 'Context switches',
    modeSub: (k: number, u: number) => `${k} a kernel · ${u} a usuario`,
    start: (boot: boolean, T: number, hasB: boolean): string =>
      boot
        ? 'La máquina recién se prende: corre el kernel, en modo kernel, y todavía no hay trap table. Dale play o usá →.'
        : `A está corriendo en modo usuario, en main(). La trap table ya está cargada${T ? ' y el timer andando' : ''}${hasB ? '; B espera listo, con sus registros guardados' : ''}. Dale play o usá →.`,
    truncated: 'El programa es muy largo: se muestran los primeros 600 pasos.',
    practice: 'Practicá',
    q1: '¿Cuántas veces cambia el modo del procesador en este programa?',
    a1: (n: number, k: number, u: number, parts: string) => `${n} veces: ${k} de usuario a kernel (${parts}) y ${u} de kernel a usuario (cada return-from-trap).`,
    parts: (sys: number, irq: number, fault: number) =>
      [sys && `${sys} syscall${sys === 1 ? '' : 's'}`, irq && `${irq} interrupci${irq === 1 ? 'ón' : 'ones'}`, fault && `${fault} excepción`].filter(Boolean).join(', ') || 'ninguno',
    q2: '¿Por qué el proceso no puede saltar directo a la dirección del handler?',
    a2: 'Porque podría saltar a cualquier parte del kernel (por ejemplo, después de un chequeo de permisos), y un salto común no cambia el mode bit. Con trap el proceso solo elige el número de syscall; a dónde se salta lo decide la trap table, que el SO cargó en el boot con una instrucción privilegiada.',
    q3sw: 'En el primer context switch, ¿dónde quedan guardados los registros de A? (son dos lugares)',
    a3sw: (cause: string, hw: number, sw: number) =>
      `Los de usuario los guarda el hardware en el kernel stack de A, al entrar por ${cause} (paso ${hw}). Los de kernel los guarda switch() en proc_t(A) (paso ${sw}). Al volver, se restauran en orden inverso.`,
    causeTimer: 'la interrupción del timer',
    causeRead: 'el trap de read()',
    q3loop: '¿Qué pasaría si A entrara en un loop infinito sin hacer syscalls?',
    a3loop: (T: number): string =>
      T
        ? `Nada grave: cada ${T} instrucciones el timer interrumpe y el SO recupera la CPU, aunque A no coopere.`
        : 'Sin timer, el SO nunca recupera la CPU: solo entra al kernel cuando A hace un trap o tiene una excepción (enfoque cooperativo). La única salida es reiniciar la máquina. Activá el timer para ver cómo se resuelve.',
    explain: (
      <>
        <p>
          <b>Ejecución directa limitada</b> (OSTEP cap. 6): el proceso corre directo en la CPU, pero en <b>modo usuario</b>. Lo que necesita privilegios (I/O, memoria, otros procesos) lo pide con una <b>syscall</b>: pone el número en <code>%eax</code> y ejecuta <code>trap</code>.
        </p>
        <p>
          El <b>hardware</b> guarda los registros en el <b>kernel stack</b> del proceso, pasa a <b>modo kernel</b> y salta al handler que el SO registró en la <b>trap table</b> durante el boot. <code>return-from-trap</code> hace todo al revés.
        </p>
        <p>
          Para recuperar la CPU sin que el proceso coopere está la <b>interrupción de timer</b> (fig. 6.3). En un <b>context switch</b> hay dos guardados: el hardware guarda los registros de usuario en el kernel stack (trap frame) y <code>switch()</code> guarda los de kernel en <code>proc_t</code>.
        </p>
        <p>Los números de syscall y de vector son los de xv6.</p>
      </>
    ),
  },
  en: {
    label: labelEn,
    narrate: narrateEn,
    call: callEn,
    preset: 'Example',
    presets: {
      write: 'write()',
      getpid: 'getpid() ×2',
      boot: 'Boot (fig. 6.2)',
      timer: 'Timer A→B (fig. 6.3)',
      priv: 'Privileged instr.',
      read: 'Blocking read()',
    } as Record<PresetId, string>,
    program: "Process A's program",
    programHint: 'in order',
    ops: {
      compute: 'compute',
      write: 'write(1, "hola\\n", 5)',
      getpid: 'getpid()',
      read: 'read(3, buf, 512)',
      exit: 'exit(0)',
      priv: 'cli  ⚠ privileged',
    } as Record<OpKind, string>,
    addOps: {
      compute: 'compute',
      write: 'write',
      getpid: 'getpid',
      read: 'read',
      exit: 'exit',
      priv: 'cli',
    } as Record<OpKind, string>,
    instr: 'instr.',
    implicitExit: 'implicit exit() (return from main)',
    notRun: 'never runs',
    moveUp: 'Move up',
    moveDown: 'Move down',
    remove: 'Remove',
    add: 'Add',
    full: 'At most 12 operations',
    boot: 'Show boot',
    bootHint: 'top rows of the figures',
    timer: 'Timer interrupt',
    every: 'Every how many instructions',
    timerHint: 'user instructions',
    disk: 'Disk takes',
    diskHint: "of B's instructions",
    lanes: { os: 'Kernel', hw: 'Hardware', user: 'Process' },
    laneSub: { os: 'kernel mode', hw: '', user: 'user mode' },
    phaseBoot: 'OS @ boot (kernel mode)',
    phaseRun: 'OS @ run',
    timeline: 'LDE protocol',
    same: (f: string): string => (f === '6.3' ? 'Same as OSTEP Figure 6.3 (LDE with timer interrupt)' : 'Same as OSTEP Figure 6.2 (LDE, no interrupts)'),
    noBoot: 'without the boot rows',
    ext: (xs: string[]) => `+ extension beyond the figure: ${xs.join(', ')}`,
    extRead: 'blocking read()',
    extPriv: 'privileged instruction',
    cpu: 'CPU',
    modeBit: 'Mode bit',
    user: 'user',
    kernel: 'kernel',
    cpl: (m: string): string => (m === 'user' ? 'CPL 3 · user mode: ordinary instructions only' : 'CPL 0 · kernel mode: anything goes'),
    running: 'Running',
    codeOf: (p: string) => `${p}'s code`,
    kernelCode: 'kernel code',
    stackOf: { boot: 'boot stack', user: (p: string) => `user stack (${p})`, kernel: (p: string) => `k-stack (${p})` },
    sysno: 'syscall no.',
    retval: 'return value',
    counter: 'computation',
    idtr: 'Trap table at',
    notLoaded: 'not loaded',
    timerOff: 'timer off',
    timerBadge: (n: number) => `timer every ${n}`,
    timerLeft: (n: number) => `timer: ${n} left`,
    trapTable: 'Trap table',
    colEvent: 'event',
    colHandler: 'handler',
    notInit: 'not initialized',
    events: { gp: 'exception: general protection', timer: 'timer interrupt', disk: 'disk interrupt', syscall: 'syscall (trap)' } as Record<TrapEvent, string>,
    sysTable: 'Syscall table (%eax)',
    procs: 'Processes',
    proc: (p: string) => `Process ${p}`,
    pid: (p: 'A' | 'B') => `pid ${PIDNUM[p]}`,
    procB: 'endless compute loop',
    state: stateEn,
    uStack: 'user stack',
    kStack: 'kernel stack',
    trapFrame: 'trap frame',
    empty: 'empty',
    context: (p: string) => `proc_t(${p}) · context`,
    ctxHint: 'kernel regs saved by switch()',
    sp: '← %esp',
    console: 'Console',
    consoleEmpty: 'nothing yet',
    modeSwitches: 'Mode switches',
    syscalls: 'Syscalls',
    kVsU: 'Kernel / user',
    kVsUSub: 'rows on each side',
    ctxSwitches: 'Context switches',
    modeSub: (k: number, u: number) => `${k} to kernel · ${u} to user`,
    start: (boot: boolean, T: number, hasB: boolean): string =>
      boot
        ? 'The machine just powered on: the kernel runs, in kernel mode, and there is no trap table yet. Press play or use →.'
        : `A is running in user mode, in main(). The trap table is already loaded${T ? ' and the timer is ticking' : ''}${hasB ? '; B waits ready, with its registers saved' : ''}. Press play or use →.`,
    truncated: 'The program is very long: showing the first 600 steps.',
    practice: 'Practice',
    q1: 'How many times does the CPU mode change in this program?',
    a1: (n: number, k: number, u: number, parts: string) => `${n} times: ${k} from user to kernel (${parts}) and ${u} from kernel to user (each return-from-trap).`,
    parts: (sys: number, irq: number, fault: number) =>
      [sys && `${sys} syscall${sys === 1 ? '' : 's'}`, irq && `${irq} interrupt${irq === 1 ? '' : 's'}`, fault && `${fault} exception`].filter(Boolean).join(', ') || 'none',
    q2: "Why can't the process just jump to the handler's address?",
    a2: 'It could jump anywhere in the kernel (say, past a permission check), and a plain jump does not change the mode bit. With trap the process only picks the syscall number; where to jump is decided by the trap table, which the OS installed at boot with a privileged instruction.',
    q3sw: "In the first context switch, where do A's registers end up? (two places)",
    a3sw: (cause: string, hw: number, sw: number) =>
      `The user registers are saved by the hardware on A's kernel stack when entering through ${cause} (step ${hw}). The kernel registers are saved by switch() in proc_t(A) (step ${sw}). Coming back, they are restored in reverse order.`,
    causeTimer: 'the timer interrupt',
    causeRead: "read()'s trap",
    q3loop: 'What would happen if A went into an infinite loop without making syscalls?',
    a3loop: (T: number): string =>
      T
        ? `Nothing bad: every ${T} instructions the timer interrupts and the OS gets the CPU back, cooperative or not.`
        : 'Without a timer the OS never gets the CPU back: it only enters the kernel when A traps or faults (the cooperative approach). The only way out is rebooting. Turn on the timer to see the fix.',
    explain: (
      <>
        <p>
          <b>Limited direct execution</b> (OSTEP ch. 6): the process runs directly on the CPU, but in <b>user mode</b>. Anything privileged (I/O, memory, other processes) it requests with a <b>syscall</b>: it puts the number in <code>%eax</code> and executes <code>trap</code>.
        </p>
        <p>
          The <b>hardware</b> saves the registers on the process's <b>kernel stack</b>, switches to <b>kernel mode</b> and jumps to the handler the OS registered in the <b>trap table</b> at boot. <code>return-from-trap</code> undoes all of it.
        </p>
        <p>
          To get the CPU back without the process cooperating there is the <b>timer interrupt</b> (fig. 6.3). A <b>context switch</b> saves twice: the hardware saves the user registers on the kernel stack (trap frame) and <code>switch()</code> saves the kernel registers in <code>proc_t</code>.
        </p>
        <p>Syscall and vector numbers are xv6's.</p>
      </>
    ),
  },
};

export type Strings = (typeof S)['es'];
