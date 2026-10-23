import type { L10n } from './i18n';

export type SectionId = 'kernel' | 'processes' | 'scheduling' | 'memory' | 'concurrency' | 'filesystem' | 'virtualization';

export interface Section {
  id: SectionId;
  title: L10n;
}

export interface PlaygroundMeta {
  slug: string;
  section: SectionId;
  /** Week of the 2026/2 course calendar where the topic is taught. */
  week: number;
  /** OSTEP chapter(s), e.g. "19" or "26–28". */
  ostep?: string;
  /** OSTEP homework simulator this playground reproduces, if any. */
  ostepSim?: string;
  title: L10n;
  /** One sentence for the home page card. */
  blurb: L10n;
  /** Intro paragraph under the page title. */
  lede: L10n;
}

export const SECTIONS: Section[] = [
  { id: 'kernel', title: { es: 'Kernel', en: 'Kernel' } },
  { id: 'processes', title: { es: 'Procesos', en: 'Processes' } },
  { id: 'scheduling', title: { es: 'Scheduling', en: 'Scheduling' } },
  { id: 'memory', title: { es: 'Memoria', en: 'Memory' } },
  { id: 'concurrency', title: { es: 'Concurrencia', en: 'Concurrency' } },
  { id: 'filesystem', title: { es: 'Filesystem', en: 'Filesystem' } },
  { id: 'virtualization', title: { es: 'Virtualización', en: 'Virtualization' } },
];

/** In course order; drives the home page, header nav and prev/next links. */
export const PLAYGROUNDS: PlaygroundMeta[] = [
  {
    slug: 'syscalls',
    section: 'kernel',
    week: 2,
    ostep: '6',
    title: { es: 'Syscalls y modo kernel', en: 'Syscalls and kernel mode' },
    blurb: {
      es: 'Seguí un write() desde tu programa, a través del trap, hasta el kernel y de vuelta.',
      en: 'Follow a write() from your program, through the trap, into the kernel and back.',
    },
    lede: {
      es: 'Un proceso no puede tocar el hardware directamente: le pide al kernel con una syscall. Mirá cómo cambia el modo del procesador, qué stack se usa y quién ejecuta cada instrucción.',
      en: 'A process cannot touch hardware directly: it asks the kernel through a syscall. Watch the CPU mode change, which stack is in use, and who runs each instruction.',
    },
  },
  {
    slug: 'fork',
    section: 'processes',
    week: 3,
    ostep: '5',
    ostepSim: 'fork.py',
    title: { es: 'fork, exec y wait', en: 'fork, exec and wait' },
    blurb: {
      es: 'Escribí un programa con fork() y mirá crecer el árbol de procesos, con zombies y huérfanos.',
      en: 'Write a program with fork() and watch the process tree grow, zombies and orphans included.',
    },
    lede: {
      es: 'fork() duplica al proceso que lo llama: dos procesos siguen ejecutando desde la misma línea. Mirá el árbol de procesos, los PIDs, el orden de los printf y qué pasa cuando un padre no espera a su hijo.',
      en: 'fork() duplicates the calling process: two processes continue from the same line. Watch the process tree, the PIDs, the order of printf output, and what happens when a parent does not wait for its child.',
    },
  },
  {
    slug: 'pipes',
    section: 'processes',
    week: 4,
    ostep: '5',
    title: { es: 'File descriptors y pipes', en: 'File descriptors and pipes' },
    blurb: {
      es: 'Mirá la tabla de file descriptors de cada proceso mientras la shell arma ls | grep x > out.',
      en: 'See each process’s file descriptor table as the shell sets up ls | grep x > out.',
    },
    lede: {
      es: 'Así arma tu shell (TP1) un pipeline: pipe(), fork(), dup2() y close(). Seguí paso a paso la tabla de file descriptors de cada proceso y la tabla de archivos abiertos del kernel.',
      en: 'This is how your shell (TP1) builds a pipeline: pipe(), fork(), dup2() and close(). Follow each process’s file descriptor table and the kernel’s open file table step by step.',
    },
  },
  {
    slug: 'scheduling',
    section: 'scheduling',
    week: 4,
    ostep: '7–8',
    ostepSim: 'scheduler.py · mlfq.py',
    title: { es: 'Scheduling de CPU', en: 'CPU scheduling' },
    blurb: {
      es: 'Cargá procesos, elegí FIFO, SJF, STCF, RR o MLFQ y compará turnaround y response time.',
      en: 'Load jobs, pick FIFO, SJF, STCF, RR or MLFQ and compare turnaround and response time.',
    },
    lede: {
      es: 'El scheduler decide qué proceso usa la CPU en cada momento. Cambiá la política y los procesos y mirá cómo cambian el diagrama de Gantt y las métricas.',
      en: 'The scheduler decides which process gets the CPU at each moment. Change the policy and the jobs and watch the Gantt chart and the metrics change.',
    },
  },
  {
    slug: 'address-translation',
    section: 'memory',
    week: 6,
    ostep: '15–20',
    ostepSim: 'relocation.py · segmentation.py · paging-linear-translate.py · paging-multilevel-translate.py',
    title: { es: 'Traducción de direcciones', en: 'Address translation' },
    blurb: {
      es: 'Base y límite, segmentación y paginación: escribí una dirección virtual y mirá cómo se traduce.',
      en: 'Base and bounds, segmentation and paging: type a virtual address and watch it get translated.',
    },
    lede: {
      es: 'Cada dirección que usa un proceso es virtual. El hardware (MMU) la traduce a una dirección física, o genera una excepción. Probá los distintos mecanismos y mirá cada bit.',
      en: 'Every address a process uses is virtual. The hardware (MMU) translates it into a physical address, or raises a fault. Try the different mechanisms and watch every bit.',
    },
  },
  {
    slug: 'tlb',
    section: 'memory',
    week: 7,
    ostep: '19',
    title: { es: 'TLB', en: 'TLB' },
    blurb: {
      es: 'Una traza de accesos, una TLB chica y una política de reemplazo: contá hits y misses.',
      en: 'An access trace, a small TLB and a replacement policy: count hits and misses.',
    },
    lede: {
      es: 'Traducir cada dirección cuesta accesos extra a memoria. La TLB cachea las traducciones recientes: si la traducción está, es un hit; si no, hay que recorrer la tabla de páginas.',
      en: 'Translating every address costs extra memory accesses. The TLB caches recent translations: if the translation is there it is a hit; if not, the page table has to be walked.',
    },
  },
  {
    slug: 'page-replacement',
    section: 'memory',
    week: 7,
    ostep: '21–22',
    ostepSim: 'paging-policy.py',
    title: { es: 'Reemplazo de páginas', en: 'Page replacement' },
    blurb: {
      es: 'FIFO, LRU, OPT y Clock sobre la misma traza: ¿quién tiene menos page faults?',
      en: 'FIFO, LRU, OPT and Clock on the same trace: which one has the fewest page faults?',
    },
    lede: {
      es: 'Cuando la memoria física se llena, el sistema operativo tiene que elegir qué página desalojar. Compará políticas sobre la misma traza y buscá la anomalía de Belady.',
      en: 'When physical memory is full, the operating system must choose a page to evict. Compare policies on the same trace and look for Belady’s anomaly.',
    },
  },
  {
    slug: 'locks',
    section: 'concurrency',
    week: 7,
    ostep: '26–28',
    ostepSim: 'x86.py',
    title: { es: 'Race conditions y locks', en: 'Race conditions and locks' },
    blurb: {
      es: 'Dos threads, un contador y un interleaving: mirá cómo se pierde un incremento y cómo lo arregla un lock.',
      en: 'Two threads, one counter and one interleaving: watch an increment get lost and a lock fix it.',
    },
    lede: {
      es: 'counter++ no es atómico: son tres instrucciones. Elegí cuándo ocurre cada interrupción y mirá cómo dos threads se pisan, y después probá con un lock.',
      en: 'counter++ is not atomic: it is three instructions. Choose when each interrupt happens and watch two threads step on each other, then try it with a lock.',
    },
  },
  {
    slug: 'filesystem',
    section: 'filesystem',
    week: 8,
    ostep: '39–40',
    ostepSim: 'vsfs.py',
    title: { es: 'Filesystem: inodos y bloques', en: 'Filesystem: inodes and blocks' },
    blurb: {
      es: 'Un disco chiquito con bitmaps, inodos y bloques de datos: corré mkdir, creat, link y unlink.',
      en: 'A tiny disk with bitmaps, inodes and data blocks: run mkdir, creat, link and unlink.',
    },
    lede: {
      es: 'Un filesystem es una estructura de datos en disco. Ejecutá operaciones y mirá qué bitmaps, inodos y bloques cambian, y cómo se resuelve una ruta como /a/b/c.',
      en: 'A filesystem is an on-disk data structure. Run operations and watch which bitmaps, inodes and blocks change, and how a path like /a/b/c is resolved.',
    },
  },
  {
    slug: 'virtualization',
    section: 'virtualization',
    week: 12,
    ostep: 'B',
    title: { es: 'Máquinas virtuales', en: 'Virtual machines' },
    blurb: {
      es: 'Trap-and-emulate: el kernel invitado ejecuta una instrucción privilegiada, ¿quién la atiende?',
      en: 'Trap-and-emulate: the guest kernel runs a privileged instruction. Who handles it?',
    },
    lede: {
      es: 'Un hipervisor corre un sistema operativo entero como si fuera un proceso. Seguí qué pasa cuando el kernel invitado intenta hacer algo privilegiado, o cuando una aplicación del invitado hace una syscall.',
      en: 'A hypervisor runs a whole operating system as if it were a process. Follow what happens when the guest kernel tries something privileged, or when a guest application makes a syscall.',
    },
  },
];

export function playground(slug: string): PlaygroundMeta {
  const p = PLAYGROUNDS.find((x) => x.slug === slug);
  if (!p) throw new Error(`Unknown playground: ${slug}`);
  return p;
}

export function neighbours(slug: string): { prev?: PlaygroundMeta; next?: PlaygroundMeta } {
  const i = PLAYGROUNDS.findIndex((x) => x.slug === slug);
  return { prev: PLAYGROUNDS[i - 1], next: PLAYGROUNDS[i + 1] };
}
