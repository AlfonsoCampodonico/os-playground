/**
 * Programs: OSTEP's own .s files from threads-intro/ and threads-locks/
 * (verbatim), plus two friendly counter++ programs written for this page.
 */
import type { L10n } from '../../lib/i18n';
import type { X86Config } from './machine';

/** OSTEP's files, keyed "<dir>/<file>" (dir = intro | locks). */
export const OSTEP_PROGRAMS: Record<string, string> = {
  "intro/loop.s": ".main\n.top\nsub  $1,%dx\ntest $0,%dx     \njgte .top         \nhalt\n",
  "intro/looping-race-nolock.s": "# assumes %bx has loop count in it\n\n.main\n.top\t\n# critical section\nmov 2000, %ax  # get 'value' at address 2000\nadd $1, %ax    # increment it\nmov %ax, 2000  # store it back\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n",
  "intro/simple-race.s": ".main\n# this is a critical section\nmov 2000(%bx), %ax   # get the value at the address\nadd $1, %ax          # increment it\nmov %ax, 2000(%bx)   # store it back\nhalt\n",
  "intro/wait-for-me.s": ".main\ntest $1, %ax     # ax should be 1 (signaller) or 0 (waiter)\nje .signaller\n\n.waiter\t\nmov  2000, %cx\ntest $1, %cx\njne .waiter\nhalt\n\n.signaller\nmov  $1, 2000\nhalt\n",
  "locks/flag.s": ".var flag\n.var count\n\n.main\n.top\n\n.acquire\nmov  flag, %ax      # get flag\ntest $0, %ax        # if we get 0 back: lock is free!\njne  .acquire       # if not, try again\nmov  $1, flag       # store 1 into flag\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\nmov  $0, flag       # clear the flag now\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n\n",
  "locks/test-and-set.s": ".var mutex\n.var count\n\n.main\n.top\t\n\n.acquire\nmov  $1, %ax        \nxchg %ax, mutex     # atomic swap of 1 and mutex\ntest $0, %ax        # if we get 0 back: lock is free!\njne  .acquire       # if not, try again\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\nmov  $0, mutex\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n",
  "locks/test-and-test-and-set.s": ".var mutex\n.var count\n\n.main\n.top\t\n\n.acquire\nmov  mutex, %ax\ntest $0, %ax\njne .acquire\nmov  $1, %ax        \nxchg %ax, mutex     # atomic swap of 1 and mutex\ntest $0, %ax        # if we get 0 back: lock is free!\njne .acquire        # if not, try again\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\nmov  $0, mutex\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n",
  "locks/peterson.s": "# array of 2 integers (each size 4 bytes)\n# load address of flag into fx register\n# access flag[] with 0(%fx,%index,4)\n# where %index is a register holding 0 or 1\n# index reg contains 0 -> flag[0], if 1->flag[1]\n.var flag   2     \n\n# global turn variable\n.var turn\n\n# global count\n.var count\n\n.main\n\n# put address of flag into fx\nlea flag, %fx\n\n# assume thread ID is in bx (0 or 1, scale by 4 to get proper flag address)\nmov %bx, %cx   # bx: self, now copies to cx\nneg %cx        # cx: - self\nadd $1, %cx    # cx: 1 - self\n\n.acquire\nmov $1, 0(%fx,%bx,4)    # flag[self] = 1\nmov %cx, turn           # turn       = 1 - self\n\n.spin1\nmov 0(%fx,%cx,4), %ax   # flag[1-self]\ntest $1, %ax            \njne .fini               # if flag[1-self] != 1, skip past loop to .fini\n\n.spin2                  # just labeled for fun, not needed\nmov turn, %ax\ntest %cx, %ax           # compare 'turn' and '1 - self'\nje .spin1               # if turn==1-self, go back and start spin again\n\n# fall out of spin\n.fini\n\n# do critical section now\nmov count, %ax\nadd $1, %ax\nmov %ax, count\n\n.release\nmov $0, 0(%fx,%bx,4)    # flag[self] = 0\n\n\n# end case: make sure it's other's turn\nmov %cx, turn           # turn       = 1 - self\nhalt\n\n",
  "locks/ticket.s": ".var ticket\n.var turn\n.var count\n\n.main\n.top\t\n\n.acquire\nmov $1, %ax\nfetchadd %ax, ticket  # grab a ticket \n.tryagain\nmov turn, %cx         # check if it's your turn \ntest %cx, %ax\njne .tryagain\n\n# critical section\nmov  count, %ax       # get the value at the address\nadd  $1, %ax          # increment it\nmov  %ax, count       # store it back\n\n# release lock\nmov $1, %ax\nfetchadd %ax, turn\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n",
  "locks/yield.s": ".var mutex\n.var count\n\n.main\n.top\t\n\n.acquire\nmov  $1, %ax        \nxchg %ax, mutex     # atomic swap of 1 and mutex\ntest $0, %ax        # if we get 0 back: lock is free!\nje .acquire_done    \nyield               # if not, yield and try again\nj .acquire\n.acquire_done\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\nmov  $0, mutex\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n",
  "locks/flag-withcallret.s": ".var mutex\n.var count\n\n.main\n.top\nmov  %sp, %bp\nlea  mutex, %ax\npush %ax\ncall .lock\npop\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\nlea  mutex, %ax\npush %ax\ncall .unlock\npop\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n\n.lock\n.acquire\npush %bp\nmov  %sp, %bp\nmov  8(%bp), %ax    # get addr of flag\nmov  (%ax),   %cx   # get value of flag \ntest $0, %cx        # if we get 0 back: lock is free!\njne  .acquire       # if not, try again\nmov  $1, (%cx)      # store 1 into flag\npop  %bp\nret\n\n.unlock\nmov  8(%bp), %ax    # all done: release lock by clearing it\nmov  $0, (%ax)      # clear\nret\n",
  "locks/looping-race-withlock-withcallret.s": ".var mutex\n.var count\n\n.main\n.top\t\npush mutex\ncall .lock\npop\n\n# critical section\nmov  count, %ax     # get the value at the address\nadd  $1, %ax        # increment it\nmov  %ax, count     # store it back\n\n# release lock\npush mutex\ncall .unlock\npop\n\n# see if we're still looping\nsub  $1, %bx\ntest $0, %bx\njgt .top\t\n\nhalt\n\n.lock\n.acquire\nmov  -4(%sp), %ax   # get addr of flag\nmov  $1, %cx        # \nxchg %cx, (%ax)     # atomic swap of 1 and flag\ntest $0, %cx        # if we get 0 back: lock is free!\njne  .acquire       # if not, try again\nret\n\n.unlock\nmov  -4(%sp), %ax   # all done: release lock by clearing it\nmov  $0, (%ax)      # \nret\n\n\n",
  "locks/loop.s": ".main\n.top\nsub  $1,%dx\ntest $0,%dx     \njgt .top         \nhalt\n\t\n",
  "locks/simple-race.s": ".main\nmov 2000, %ax   # get the value at the address\nadd $1, %ax     # increment it\nmov %ax, 2000   # store it back\nhalt\n",
};

const COUNTER: L10n<string> = {
  es: `# counter++ con dos threads, sin lock.
# En C es una sola línea; en el procesador son tres instrucciones.
.var counter

.main
# sección crítica: counter = counter + 1
mov  counter, %ax   # load:  ax = counter
add  $1, %ax        # add:   ax = ax + 1
mov  %ax, counter   # store: counter = ax
halt
`,
  en: `# counter++ with two threads and no lock.
# One line of C; three instructions for the processor.
.var counter

.main
# critical section: counter = counter + 1
mov  counter, %ax   # load:  ax = counter
add  $1, %ax        # add:   ax = ax + 1
mov  %ax, counter   # store: counter = ax
halt
`,
};

const COUNTER_TAS: L10n<string> = {
  es: `# counter++ protegido con un spin lock (test-and-set con xchg).
.var mutex
.var counter

.main
.lock
mov  $1, %ax
xchg %ax, mutex     # atómico: ax <- mutex, mutex <- 1
test $0, %ax        # ¿el lock estaba libre (0)?
jne  .lock          # no: girá y probá de nuevo (spin)

# sección crítica: counter = counter + 1
mov  counter, %ax   # load
add  $1, %ax        # add
mov  %ax, counter   # store

mov  $0, mutex      # unlock
halt
`,
  en: `# counter++ protected by a spin lock (test-and-set with xchg).
.var mutex
.var counter

.main
.lock
mov  $1, %ax
xchg %ax, mutex     # atomic: ax <- mutex, mutex <- 1
test $0, %ax        # was the lock free (0)?
jne  .lock          # no: spin and try again

# critical section: counter = counter + 1
mov  counter, %ax   # load
add  $1, %ax        # add
mov  %ax, counter   # store

mov  $0, mutex      # unlock
halt
`,
};

/** Programs written for this page (localized comments). */
export const OWN_PROGRAMS: Record<string, L10n<string>> = { counter: COUNTER, 'counter-tas': COUNTER_TAS };

export type ProgramId = string;

export function programSource(id: ProgramId, lang: 'es' | 'en'): string | undefined {
  return OWN_PROGRAMS[id]?.[lang] ?? OSTEP_PROGRAMS[id];
}

/** File name for the `-p` flag. */
export function programFile(id: ProgramId): string {
  if (id in OWN_PROGRAMS) return `${id}.s`;
  return id.split('/').pop() ?? id;
}

/** Finds a bundled program by the file name given to `-p` (prefers the directory of `prefer`). */
export function programByFile(file: string, prefer?: ProgramId): ProgramId | undefined {
  const base = file.split('/').pop()!;
  for (const id of Object.keys(OWN_PROGRAMS)) if (`${id}.s` === base) return id;
  const dirs = prefer?.startsWith('locks/') ? ['locks', 'intro'] : ['intro', 'locks'];
  for (const d of dirs) if (`${d}/${base}` in OSTEP_PROGRAMS) return `${d}/${base}`;
  return undefined;
}

export type PresetGroup = 'counter' | 'ch26' | 'ch28';

export interface Preset {
  id: string;
  group: PresetGroup;
  prog: ProgramId;
  flags: Partial<X86Config>;
}

/** Every preset sets all of these flags; anything missing takes x86.py's default. */
export const PRESETS: Preset[] = [
  { id: 'counter', group: 'counter', prog: 'counter', flags: { threads: 2, intfreq: 2, memtrace: 'counter', regtrace: 'ax' } },
  { id: 'counter-tas', group: 'counter', prog: 'counter-tas', flags: { threads: 2, intfreq: 2, memtrace: 'mutex,counter', regtrace: 'ax' } },
  { id: 'loop', group: 'ch26', prog: 'intro/loop.s', flags: { threads: 2, intfreq: 3, intrand: true, seed: 0, argv: 'dx=3,dx=3', regtrace: 'dx', cctrace: true } },
  { id: 'looping-race', group: 'ch26', prog: 'intro/looping-race-nolock.s', flags: { threads: 2, intfreq: 4, intrand: true, seed: 0, argv: 'bx=3', memtrace: '2000', regtrace: 'ax,bx' } },
  { id: 'wait-for-me', group: 'ch26', prog: 'intro/wait-for-me.s', flags: { threads: 2, argv: 'ax=0,ax=1', memtrace: '2000', regtrace: 'ax,cx' } },
  { id: 'flag', group: 'ch28', prog: 'locks/flag.s', flags: { threads: 2, argv: 'bx=2,bx=2', memtrace: 'flag,count', regtrace: 'ax,bx' } },
  { id: 'test-and-set', group: 'ch28', prog: 'locks/test-and-set.s', flags: { threads: 2, intfreq: 5, argv: 'bx=2,bx=2', memtrace: 'mutex,count', regtrace: 'ax,bx' } },
  { id: 'peterson', group: 'ch28', prog: 'locks/peterson.s', flags: { threads: 2, intfreq: 3, argv: 'bx=0,bx=1', memtrace: 'count,turn', regtrace: 'ax,cx' } },
  { id: 'ticket', group: 'ch28', prog: 'locks/ticket.s', flags: { threads: 2, intfreq: 5, argv: 'bx=2,bx=2', memtrace: 'count,ticket,turn', regtrace: 'ax,cx' } },
  { id: 'test-and-test-and-set', group: 'ch28', prog: 'locks/test-and-test-and-set.s', flags: { threads: 2, intfreq: 5, argv: 'bx=2,bx=2', memtrace: 'mutex,count', regtrace: 'ax' } },
  { id: 'yield', group: 'ch28', prog: 'locks/yield.s', flags: { threads: 2, intfreq: 5, argv: 'bx=2,bx=2', memtrace: 'mutex,count', regtrace: 'ax,bx' } },
];
