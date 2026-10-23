import type { Effect, FsError, OpKind, PresetId, QuizMode } from '../../sim/filesystem';

const kindEs: Record<'d' | 'f', string> = { d: 'dir', f: 'archivo' };
const kindEn: Record<'d' | 'f', string> = { d: 'dir', f: 'file' };

export const S = {
  es: {
    preset: 'Ejemplo',
    presets: { empty: 'Vacío → /foo/bar', hardlink: 'Hard link', seed0: 'Seed 0', seed1: 'Seed 1', seed2: 'Seed 2' } as Record<PresetId, string>,
    problem: 'Problema de vsfs.py',
    seed: 'Semilla (-s)',
    numInodes: 'Inodos (-i)',
    numData: 'Bloques (-d)',
    numRequests: 'Operaciones al azar (-n)',
    mode: 'Modo',
    modes: { all: 'Ver todo (-c)', op: '¿Qué op fue?', state: '¿Cómo queda? (-r)' } as Record<QuizMode, string>,
    modeHint: { all: 'operación y estado', op: 'ves el estado, adiviná la operación', state: 'ves la operación, adiviná el estado' } as Record<QuizMode, string>,
    flags: 'Pegá flags de vsfs.py',
    flagsPh: './vsfs.py -s 3 -n 6 -r',
    apply: 'Aplicar',
    badFlags: (b: string[]) => `No entiendo: ${b.join(' ')}`,
    yourOps: 'Tus operaciones',
    yourOpsHint: 'se agregan después de las de vsfs.py',
    opsPh: 'mkdir /a; creat /a/b; link /a/b /c; unlink /c',
    badOps: (b: string[]) => `No entiendo: ${b.join(' · ')}`,
    add: 'Agregar',
    path: 'ruta',
    target: 'existente',
    newName: 'nombre nuevo',
    willWork: 'vsfs lo acepta: Enter o Agregar.',
    clearOps: 'Borrar las mías',
    extraOps: (n: number) => `+ ${n} ${n === 1 ? 'operación tuya' : 'operaciones tuyas'}, que vsfs.py no genera`,
    ops: 'Operaciones',
    hiddenOp: '?',
    start: 'Disco recién formateado: solo existe el directorio raíz (inodo 0, bloque 0, con . y ..). Dale play o usá →.',
    guessOp: '¿Qué operación fue? Mirá qué cambió en el disco.',
    guessState: '¿Cómo queda el disco? Estás viendo el estado anterior.',
    revealOp: 'Revelar operación',
    revealState: 'Revelar estado',
    failed: 'falla',
    unchanged: 'el disco no cambia',
    halted: (w: 'inodes' | 'data' | 'stuck') =>
      w === 'stuck' ? 'vsfs.py no encuentra ninguna operación válida y se colgaría acá.' : `vsfs.py corta acá: el disco se quedó sin ${w === 'inodes' ? 'inodos' : 'bloques de datos'} libres (sale con exit 1). Probá con más -i / -d.`,
    disk: 'Disco',
    ibitmap: 'Bitmap de inodos',
    inodes: 'Tabla de inodos',
    dbitmap: 'Bitmap de datos',
    blocks: 'Bloques de datos',
    free: 'libre',
    dir: 'dir',
    file: 'archivo',
    noData: 'sin datos',
    notation: 'Notación de vsfs.py',
    tree: 'Árbol de directorios',
    links: (n: number) => `${n} links`,
    lookupTitle: 'Resolución de rutas',
    lookupPh: '/a/b/c',
    readInode: (i: number) => `inodo ${i}`,
    readBlock: (b: number) => `bloque ${b}`,
    seek: (n: string) => `busca «${n}»`,
    reads: 'lecturas de disco',
    resolved: (p: string, i: number, r: number) => `${p} → inodo ${i}, en ${r} ${r === 1 ? 'lectura' : 'lecturas'} de disco.`,
    lookupFail: (e: string, r: number) => `${e} (después de ${r} ${r === 1 ? 'lectura' : 'lecturas'}).`,
    tryPaths: 'Probá',
    inodesUsed: 'Inodos',
    blocksUsed: 'Bloques',
    freeOf: (n: number) => `${n} libres`,
    dirs: 'Directorios',
    files: 'Archivos',
    hardLinks: 'Links extra',
    hardLinksSub: (n: number) => `${n} ${n === 1 ? 'archivo' : 'archivos'} con r > 1`,
    focusInode: (i: number) => `inodo ${i}`,
    focusBlock: (b: number) => `bloque ${b}`,
    lastChanged: 'cambió en el paso',
    neverChanged: 'no cambió todavía',
    pinned: 'fijado · clic para soltar',
    explainHover: 'Pasá el mouse o hacé clic en un inodo, un bloque o una entrada para ver qué lo referencia.',
    legend: { alloc: 'asignado', free: 'liberado', update: 'modificado' },
    practice: 'Practicá',
    qOp: (k: number) => `Paso ${k}: el disco pasó de «antes» a «después». ¿Qué operación fue?`,
    before: 'antes',
    after: 'después',
    aOp: 'Fue',
    qFree: (n: number) => `Después de las ${n} operaciones, ¿cuántos inodos y cuántos bloques de datos quedan libres?`,
    aFree: (fi: number, ti: number, fb: number, tb: number) => `${fi} inodos libres de ${ti} y ${fb} bloques libres de ${tb}. Contá los 0 de cada bitmap.`,
    qReads: (p: string) => `Al final, ¿cuántas lecturas de disco hacen falta para resolver ${p}?`,
    aReads: (r: number, chain: string) => `${r}: ${chain}. Una por cada inodo y una por cada bloque de directorio.`,
    err: (e: FsError): string => {
      switch (e.code) {
        case 'EINVAL':
          return `Ruta inválida: ${e.at || '(vacía)'} (tiene que empezar con /, y no puede ser /, . ni ..)`;
        case 'ENOENT':
          return `ENOENT: no existe ${e.at}`;
        case 'ENOTDIR':
          return `ENOTDIR: ${e.at} no es un directorio`;
        case 'EEXIST':
          return `EEXIST: ${e.at} ya existe`;
        case 'EISDIR':
          return `EISDIR: ${e.at} es un directorio (vsfs solo hace link, unlink y write sobre archivos)`;
        case 'DIRFULL':
          return `El directorio ${e.at} está lleno (32 entradas por bloque)`;
        case 'NOINODE':
          return 'No quedan inodos libres';
        case 'NOBLOCK':
          return 'No quedan bloques de datos libres';
        case 'FILEFULL':
          return `${e.at} ya tiene su bloque: en vsfs un archivo ocupa como mucho 1 bloque`;
      }
    },
    effect: (e: Effect): string => {
      switch (e.k) {
        case 'ibit':
          return `ibitmap[${e.i}] = ${e.to}`;
        case 'ialloc':
          return `inodo ${e.i} ← ${kindEs[e.type]}`;
        case 'ifree':
          return `libera inodo ${e.i}`;
        case 'refs':
          return `r de inodo ${e.i}: ${e.from} → ${e.to}`;
        case 'addr':
          return `a de inodo ${e.i}: ${e.from} → ${e.to}`;
        case 'dbit':
          return `dbitmap[${e.b}] = ${e.to}`;
        case 'entry':
          return e.add ? `+ (${e.name},${e.inum}) en bloque ${e.b}` : `− (${e.name},${e.inum}) del bloque ${e.b}`;
        case 'data':
          return e.add ? `bloque ${e.b} ← «${e.data}»` : `borra «${e.data}» del bloque ${e.b}`;
      }
    },
    kindLabel: { mkdir: 'mkdir', creat: 'creat', write: 'write', link: 'link', unlink: 'unlink' } as Record<OpKind, string>,
    explain: (
      <>
        <p>
          vsfs (OSTEP cap. 40) divide el disco en cuatro regiones: el <b>bitmap de inodos</b> y el <b>bitmap de datos</b> (1 = ocupado), la <b>tabla de inodos</b> y los <b>bloques de datos</b>. Cada inodo guarda su tipo (<code>d</code> directorio, <code>f</code> archivo), <code>a:</code> el bloque que usa (<code>-1</code> si ninguno) y <code>r:</code> cuántos nombres lo apuntan.
        </p>
        <p>
          Un directorio es un bloque con entradas <code>(nombre, inodo)</code>, siempre con <code>.</code> y <code>..</code>. Por eso <b>mkdir</b> toca cuatro cosas: inodo nuevo, bloque nuevo, entrada en el padre y el <code>r</code> del padre (el <code>..</code> del hijo también lo apunta). <b>creat</b> no pide bloque (<code>a:-1</code>) hasta el primer <b>write</b>. Siempre se toma el primer libre del bitmap.
        </p>
        <p>
          <b>link</b> agrega otro nombre para el mismo inodo y sube <code>r</code> (hard link, §39.14); <b>unlink</b> borra un nombre y baja <code>r</code>: recién cuando llega a 0 se liberan el inodo y su bloque.
        </p>
        <p>
          Para abrir <code>/a/b</code> el kernel lee el inodo raíz, su bloque, el inodo de <code>a</code>, su bloque y el inodo de <code>b</code>: una lectura por inodo y una por bloque de directorio (§40.4). Pasá el mouse o hacé clic sobre un inodo o un bloque para ver quién lo referencia.
        </p>
      </>
    ),
  },
  en: {
    preset: 'Example',
    presets: { empty: 'Empty → /foo/bar', hardlink: 'Hard link', seed0: 'Seed 0', seed1: 'Seed 1', seed2: 'Seed 2' } as Record<PresetId, string>,
    problem: 'vsfs.py problem',
    seed: 'Seed (-s)',
    numInodes: 'Inodes (-i)',
    numData: 'Blocks (-d)',
    numRequests: 'Random ops (-n)',
    mode: 'Mode',
    modes: { all: 'Show all (-c)', op: 'Which op?', state: 'Which state? (-r)' } as Record<QuizMode, string>,
    modeHint: { all: 'operation and state', op: 'you see the state, guess the op', state: 'you see the op, guess the state' } as Record<QuizMode, string>,
    flags: 'Paste vsfs.py flags',
    flagsPh: './vsfs.py -s 3 -n 6 -r',
    apply: 'Apply',
    badFlags: (b: string[]) => `Can't parse: ${b.join(' ')}`,
    yourOps: 'Your operations',
    yourOpsHint: 'run after vsfs.py’s',
    opsPh: 'mkdir /a; creat /a/b; link /a/b /c; unlink /c',
    badOps: (b: string[]) => `Can't parse: ${b.join(' · ')}`,
    add: 'Add',
    path: 'path',
    target: 'existing',
    newName: 'new name',
    willWork: 'vsfs accepts it: press Enter or Add.',
    clearOps: 'Clear mine',
    extraOps: (n: number) => `+ ${n} op${n === 1 ? '' : 's'} of yours, which vsfs.py doesn’t generate`,
    ops: 'Operations',
    hiddenOp: '?',
    start: 'Freshly formatted disk: only the root directory exists (inode 0, block 0, with . and ..). Press play or use →.',
    guessOp: 'Which operation was it? Look at what changed on disk.',
    guessState: 'What does the disk look like now? You are seeing the previous state.',
    revealOp: 'Reveal operation',
    revealState: 'Reveal state',
    failed: 'fails',
    unchanged: 'the disk does not change',
    halted: (w: 'inodes' | 'data' | 'stuck') =>
      w === 'stuck' ? 'vsfs.py finds no valid operation and would hang here.' : `vsfs.py stops here: the disk ran out of free ${w === 'inodes' ? 'inodes' : 'data blocks'} (exit 1). Try more -i / -d.`,
    disk: 'Disk',
    ibitmap: 'Inode bitmap',
    inodes: 'Inode table',
    dbitmap: 'Data bitmap',
    blocks: 'Data blocks',
    free: 'free',
    dir: 'dir',
    file: 'file',
    noData: 'no data',
    notation: 'vsfs.py notation',
    tree: 'Directory tree',
    links: (n: number) => `${n} links`,
    lookupTitle: 'Path resolution',
    lookupPh: '/a/b/c',
    readInode: (i: number) => `inode ${i}`,
    readBlock: (b: number) => `block ${b}`,
    seek: (n: string) => `looks for “${n}”`,
    reads: 'disk reads',
    resolved: (p: string, i: number, r: number) => `${p} → inode ${i}, in ${r} disk read${r === 1 ? '' : 's'}.`,
    lookupFail: (e: string, r: number) => `${e} (after ${r} read${r === 1 ? '' : 's'}).`,
    tryPaths: 'Try',
    inodesUsed: 'Inodes',
    blocksUsed: 'Blocks',
    freeOf: (n: number) => `${n} free`,
    dirs: 'Directories',
    files: 'Files',
    hardLinks: 'Extra links',
    hardLinksSub: (n: number) => `${n} file${n === 1 ? '' : 's'} with r > 1`,
    focusInode: (i: number) => `inode ${i}`,
    focusBlock: (b: number) => `block ${b}`,
    lastChanged: 'changed at step',
    neverChanged: 'not changed yet',
    pinned: 'pinned · click to release',
    explainHover: 'Hover or click an inode, a block or an entry to see what refers to it.',
    legend: { alloc: 'allocated', free: 'freed', update: 'changed' },
    practice: 'Practice',
    qOp: (k: number) => `Step ${k}: the disk went from “before” to “after”. Which operation was it?`,
    before: 'before',
    after: 'after',
    aOp: 'It was',
    qFree: (n: number) => `After the ${n} operations, how many inodes and how many data blocks are free?`,
    aFree: (fi: number, ti: number, fb: number, tb: number) => `${fi} of ${ti} inodes and ${fb} of ${tb} blocks are free. Count the 0s in each bitmap.`,
    qReads: (p: string) => `At the end, how many disk reads does resolving ${p} take?`,
    aReads: (r: number, chain: string) => `${r}: ${chain}. One per inode and one per directory block.`,
    err: (e: FsError): string => {
      switch (e.code) {
        case 'EINVAL':
          return `Invalid path: ${e.at || '(empty)'} (must start with /, and can’t be /, . or ..)`;
        case 'ENOENT':
          return `ENOENT: ${e.at} does not exist`;
        case 'ENOTDIR':
          return `ENOTDIR: ${e.at} is not a directory`;
        case 'EEXIST':
          return `EEXIST: ${e.at} already exists`;
        case 'EISDIR':
          return `EISDIR: ${e.at} is a directory (vsfs only links, unlinks and writes files)`;
        case 'DIRFULL':
          return `Directory ${e.at} is full (32 entries per block)`;
        case 'NOINODE':
          return 'No free inodes left';
        case 'NOBLOCK':
          return 'No free data blocks left';
        case 'FILEFULL':
          return `${e.at} already has its block: a vsfs file holds at most 1 block`;
      }
    },
    effect: (e: Effect): string => {
      switch (e.k) {
        case 'ibit':
          return `ibitmap[${e.i}] = ${e.to}`;
        case 'ialloc':
          return `inode ${e.i} ← ${kindEn[e.type]}`;
        case 'ifree':
          return `frees inode ${e.i}`;
        case 'refs':
          return `inode ${e.i} r: ${e.from} → ${e.to}`;
        case 'addr':
          return `inode ${e.i} a: ${e.from} → ${e.to}`;
        case 'dbit':
          return `dbitmap[${e.b}] = ${e.to}`;
        case 'entry':
          return e.add ? `+ (${e.name},${e.inum}) in block ${e.b}` : `− (${e.name},${e.inum}) from block ${e.b}`;
        case 'data':
          return e.add ? `block ${e.b} ← “${e.data}”` : `erases “${e.data}” from block ${e.b}`;
      }
    },
    kindLabel: { mkdir: 'mkdir', creat: 'creat', write: 'write', link: 'link', unlink: 'unlink' } as Record<OpKind, string>,
    explain: (
      <>
        <p>
          vsfs (OSTEP ch. 40) splits the disk into four regions: the <b>inode bitmap</b> and the <b>data bitmap</b> (1 = in use), the <b>inode table</b> and the <b>data blocks</b>. Each inode stores its type (<code>d</code> directory, <code>f</code> file), <code>a:</code> the block it uses (<code>-1</code> if none) and <code>r:</code> how many names point to it.
        </p>
        <p>
          A directory is a block of <code>(name, inode)</code> entries, always including <code>.</code> and <code>..</code>. That is why <b>mkdir</b> touches four things: a new inode, a new block, an entry in the parent and the parent’s <code>r</code> (the child’s <code>..</code> points to it too). <b>creat</b> takes no block (<code>a:-1</code>) until the first <b>write</b>. The first free slot in the bitmap is always the one taken.
        </p>
        <p>
          <b>link</b> adds another name for the same inode and bumps <code>r</code> (hard link, §39.14); <b>unlink</b> removes a name and lowers <code>r</code>: only when it reaches 0 are the inode and its block freed.
        </p>
        <p>
          To open <code>/a/b</code> the kernel reads the root inode, its block, <code>a</code>’s inode, its block and <code>b</code>’s inode: one read per inode and one per directory block (§40.4). Hover or click an inode or a block to see what refers to it.
        </p>
      </>
    ),
  },
};

export type Strings = (typeof S)['es'];
