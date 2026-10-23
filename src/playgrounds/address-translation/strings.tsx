import type { ReactNode } from 'react';
import type { Mech, PresetId, Region, RunError } from '../../sim/address-translation/index';

const es = {
  mech: 'Mecanismo',
  mechs: { bb: 'Base y límite', seg: 'Segmentación', lin: 'Paginación', ml: 'Multinivel' } as Record<Mech, string>,
  preset: 'Ejemplo',
  presets: {
    bb: { book: 'Cap. 15', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    seg: { book: 'Cap. 16', hw: 'Tarea', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    lin: { book: 'Cap. 18', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    ml: { book: 'Cap. 20', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
  } as Record<Mech, Partial<Record<PresetId, string>>>,
  presetTitles: {
    bb: { book: 'Fig. 15.2: base 32 KB, límite 16 KB' },
    seg: { book: 'Fig. 16.1–16.3: código, heap y stack (que crece hacia abajo)', hw: 'Tarea del cap. 16: -a 128 -p 512 -b 0 -l 20 -B 512 -L 20' },
    lin: { book: 'Fig. 18.1–18.2: espacio de 64 B, páginas de 16 B' },
    ml: { book: 'Fig. 20.5: espacio de 16 KB, páginas de 64 B, PTE de 4 bytes' },
  } as Record<Mech, Partial<Record<PresetId, string>>>,
  variant: 'Modelo',
  ostepVariant: (n: number) => `OSTEP (${n} segmentos)`,
  bookSeg: 'Libro (3 segmentos)',
  ostepMl: 'OSTEP (páginas de 32 B)',
  bookMl: 'Libro (cap. 20)',
  seed: 'Semilla (-s)',
  asize: 'Espacio de direcciones (-a)',
  psize: 'Memoria física (-p)',
  pagesize: 'Tamaño de página (-P)',
  used: '% del espacio usado (-u)',
  allocated: 'Páginas asignadas (-a)',
  num: 'Cantidad de VAs (-n)',
  base: 'Base (-b)',
  limit: 'Límite (-l)',
  base0: 'Base seg 0 (-b)',
  len0: 'Límite seg 0 (-l)',
  base1: 'Tope seg 1 (-B)',
  len1: 'Límite seg 1 (-L)',
  randomHint: '-1 = al azar',
  sizesHint: '16, 64k, 32m',
  segRegs: 'Registros de segmento',
  segName: { proc: 'proceso', code: 'código', heap: 'heap', stack: 'stack', seg0: 'seg 0', seg1: 'seg 1', page: 'página', pd: 'directorio', pt: 'tabla' } as Record<Region['kind'], string>,
  baseCol: 'Base',
  sizeCol: 'Tamaño',
  limitCol: 'Límite',
  growsCol: 'Crece',
  up: '↓ positivo',
  down: '↑ negativo',
  vas: 'Direcciones virtuales',
  vasHint: 'vacío = las genera OSTEP',
  vasPlaceholder: (v: string) => `p. ej. ${v}`,
  bad: (t: string[]) => `No entiendo: ${t.join(', ')}`,
  paste: 'Pegá un comando de OSTEP',
  pasteHint: 'arma todo igual',
  pastePlaceholder: './segmentation.py -a 128 -p 512 -s 1 -c',
  apply: 'Aplicar',
  badFlags: (t: string[]) => `Ignoré: ${t.join(' ')}`,
  restoreTable: 'Volver a la tabla de OSTEP',
  // machine
  machine: 'MMU',
  map: 'Mapa de memoria',
  vSpace: 'Espacio virtual',
  pSpace: 'Memoria física',
  outside: 'fuera del espacio',
  start: 'Todavía no se tradujo nada. Dale play o usá → para la primera dirección.',
  noVas: 'No hay direcciones para traducir.',
  setupError: 'Con esta configuración OSTEP no arranca:',
  errors: {
    badInput: 'No entiendo algún tamaño (usá 16, 64k, 32m o 1g).',
    psizeSmall: 'La memoria física es demasiado chica.',
    asizeZero: 'El espacio de direcciones no puede ser 0.',
    psizeLeAsize: 'La memoria física tiene que ser más grande que el espacio de direcciones (en esta simulación).',
    need2x: 'Para ubicar los segmentos al azar, la memoria física tiene que ser más del doble del espacio de direcciones.',
    noFit: 'El espacio de direcciones no entra en memoria física con esa base y ese límite.',
    seg0Out: 'El segmento 0 queda fuera de la memoria física.',
    seg1Out: 'El segmento 1 queda fuera de la memoria física.',
    len0Big: 'Un segmento no puede ser más grande que su parte del espacio de direcciones.',
    len1Big: 'Un segmento no puede ser más grande que su parte del espacio de direcciones.',
    overlap: 'Los segmentos se pisan en memoria física.',
    vaRange: 'Hay una dirección virtual fuera del espacio de direcciones.',
    tooBig: 'Tamaños demasiado grandes para esta simulación.',
    notMultiple: 'Los tamaños tienen que ser múltiplos del tamaño de página.',
    notPow2: 'El espacio de direcciones y la página tienen que ser potencias de 2.',
    noFrames: 'No hay marcos libres para tantas páginas (el script corta con un AssertionError).',
    hang: 'No hay dónde ubicar el segmento: el script quedaría en un loop infinito.',
  } as Record<RunError['code'], string>,
  va: 'Dirección virtual',
  pa: 'Dirección física',
  vpn: 'VPN',
  pfn: 'PFN',
  offset: 'offset',
  segBits: 'segmento',
  pdIndex: 'índice PD',
  ptIndex: 'índice PT',
  noPa: 'no hay dirección física',
  // narration
  okTo: 'PA',
  violation: 'SEGMENTATION VIOLATION',
  violationWhy: {
    bb: (va: string, l: string) => `${va} ≥ límite ${l}`,
    seg: (s: string) => `fuera de ${s}`,
    noSeg: 'ningún segmento usa esos bits',
  },
  invalid: (vpn: number) => `VPN ${vpn} inválida → fault`,
  pdeFault: 'PDE inválida → fault',
  pteFault: 'PTE inválida → fault',
  value: 'valor',
  // flow
  flowVa: 'VA',
  flowCmp: (va: string, l: string, ok: boolean) => `${va} ${ok ? '<' : '≥'} límite ${l}`,
  flowPa: 'PA = base + VA',
  flowSel: (bits: string, seg: string) => `bits ${bits} → ${seg}`,
  flowSelHalf: (hi: boolean, seg: string) => `VA ${hi ? '≥' : '<'} mitad → ${seg}`,
  flowNoSeg: 'no hay segmento',
  flowNeg: (off: string, max: string, neg: string) => `offset ${off} − ${max} = ${neg}`,
  flowSegCmp: (lhs: string, l: string, ok: boolean, neg: boolean) => `${lhs} ${neg ? (ok ? '≤' : '>') : ok ? '<' : '≥'} límite ${l}`,
  flowSegPa: (neg: boolean): string => (neg ? 'PA = tope + offset' : 'PA = base + offset'),
  flowSplit: 'VPN | offset',
  flowPte: (vpn: number, pte: string) => `PTE[${vpn}] = ${pte}`,
  flowValid: (v: boolean, pfn?: number) => (v ? `válida, PFN ${pfn}` : 'válida = 0'),
  flowPaPage: 'PA = PFN · página + offset',
  flowPdbr: (p: number) => `PDBR = ${p}`,
  flowPde: (addr: string, val: string, ok: boolean, p: number) => `PDE en ${addr} = ${val} ${ok ? `→ PT en página ${p}` : '→ inválida'}`,
  flowPteMl: (addr: string, val: string, ok: boolean, p: number) => `PTE en ${addr} = ${val} ${ok ? `→ PFN ${p}` : '→ inválida'}`,
  flowValue: (v: string) => `valor ${v}`,
  // stats
  valid: 'Válidas',
  violations: 'Violaciones',
  faults: 'Faults',
  reads: 'Accesos p/ traducir',
  readsSub: (n: number) => `${n} en total`,
  tableSize: 'Tabla',
  regs: (n: number) => `${n} reg.`,
  regsSub: 'sin tabla en memoria',
  tableSub: (pt: string) => `lineal: ${pt}`,
  ptesSub: (n: number) => `${n} PTE de 4 B`,
  // tables
  registers: 'Registros de la MMU',
  pageTable: 'Tabla de páginas',
  pageTableSub: 'clic en V o en el PFN para editar',
  edited: 'editada',
  pteRaw: 'PTE',
  walk: 'Recorrido de la tabla multinivel',
  pdbr: 'PDBR',
  pdbrSub: 'página del directorio',
  pdPage: (p: number) => `Directorio de páginas · página ${p}`,
  ptTitle: 'Página de la tabla',
  dataTitle: 'Página de datos',
  ptPage: (p: number) => `Página de la tabla · página ${p}`,
  dataPage: (p: number) => `Página de datos · marco ${p}`,
  notReached: 'no se llega',
  fullDump: 'Volcado completo de memoria (como lo imprime el script)',
  // ostep
  ostepPanel: 'Igual que OSTEP',
  copy: 'Copiar',
  copied: 'Copiado',
  output: 'Salida del script con -c',
  notes: {
    customVas: 'Con -A le pasás tus direcciones.',
    noAFlag: 'El script no tiene -A: tus direcciones no salen en su salida, pero los registros y la memoria son los mismos.',
    editedTable: 'Editaste la tabla de páginas: el script con esta semilla genera otra.',
    book: 'Este es el ejemplo del libro: no hay un comando de OSTEP equivalente.',
    editedRegs: '',
  },
  // practice
  practice: 'Practicá',
  qPa: (va: string) => `¿A qué dirección física va la VA ${va}? ¿O es una violación/fault?`,
  qPaAns: {
    ok: (pa: string) => `Va a ${pa}.`,
    violation: 'Segmentation violation: queda fuera del segmento.',
    invalid: 'Invalid: la PTE tiene el bit de válido en 0.',
    pdeFault: 'Fault: la entrada del directorio (PDE) es inválida.',
    pteFault: 'Fault: la PTE es inválida.',
  },
  qBbMin: '¿Cuál es el valor más chico del límite para que TODAS estas VAs sean válidas?',
  aBbMin: (n: number) => `${n}: la VA más alta más uno (los chequeos son VA < límite).`,
  qBbRange: (b: string, l: string) => `Con base ${b} y límite ${l}, ¿qué rango de memoria física puede tocar el proceso?`,
  aBbRange: (lo: string, hi: string) => `De ${lo} a ${hi} inclusive.`,
  qSegEdge: '¿Cuál es la VA válida más alta del segmento 0 y la más baja del segmento 1 (o del stack)?',
  aSegEdge: (a: string, b: string) => `Segmento 0: ${a}. Stack/segmento 1: ${b}.`,
  qLinSize: (as: string, ps: string) => `Con un espacio de ${as} y páginas de ${ps}, ¿cuánto ocupa la tabla lineal con PTE de 4 bytes?`,
  aLinSize: (n: number, b: string, half: string) => `${n} entradas × 4 B = ${b}. Con páginas del doble de grandes, la mitad: ${half}.`,
  qMlSize: '¿Cuánta memoria ocupa esta tabla multinivel? ¿Y una tabla lineal para el mismo espacio?',
  aMlSize: (pages: number, b: string, lin: string) => `${pages} páginas (directorio + tablas) = ${b}; una lineal ocuparía ${lin}, aunque la mayoría de sus entradas sean inválidas.`,
  explain: {
    bb: (
      <>
        <p>
          <b>Base y límite</b> (OSTEP cap. 15): el proceso ve un espacio de direcciones que empieza en 0. La MMU chequea <code>VA &lt; límite</code> y, si pasa, suma la <b>base</b>: <code>PA = base + VA</code>. Si no, trap al kernel: <b>segmentation violation</b>.
        </p>
        <p>Son dos registros, sin tabla en memoria: traducir no cuesta accesos extra. El problema es que todo el espacio, aunque no se use, ocupa memoria física.</p>
      </>
    ),
    seg: (
      <>
        <p>
          <b>Segmentación</b> (OSTEP cap. 16): un par base/límite por segmento. Los bits altos de la VA eligen el segmento; el resto es el <b>offset</b> dentro de él.
        </p>
        <p>
          El <b>stack crece hacia abajo</b>: su offset es negativo (<code>offset − tamaño máximo</code>), se suma al <b>tope</b> del segmento y se chequea que su valor absoluto no supere el límite. <code>segmentation.py</code> usa un solo bit (2 segmentos); el ejemplo del libro usa dos (código, heap, stack).
        </p>
      </>
    ),
    lin: (
      <>
        <p>
          <b>Paginación</b> (OSTEP cap. 18): el espacio se corta en páginas de tamaño fijo. La VA se parte en <b>VPN</b> (bits altos) y <b>offset</b>. La MMU lee <code>PTE[VPN]</code> de la tabla de páginas (un acceso a memoria) y, si el bit de válido está en 1, arma <code>PA = PFN · página + offset</code>.
        </p>
        <p>En el script cada PTE es <code>0x8000_0000 | PFN</code> (bit alto = válido). La tabla lineal tiene una entrada por página virtual, se use o no: con espacios grandes ocupa mucho.</p>
      </>
    ),
    ml: (
      <>
        <p>
          <b>Tabla multinivel</b> (OSTEP cap. 20): la tabla lineal se corta en páginas y solo se guardan las que tienen alguna entrada válida. El <b>directorio de páginas</b> (apuntado por el <b>PDBR</b>) dice dónde está cada una.
        </p>
        <p>
          La VA se parte en <b>índice PD</b> | <b>índice PT</b> | <b>offset</b>. La MMU lee la PDE (acceso 1); si es válida, lee la PTE en esa página de la tabla (acceso 2) y arma la PA. En el script cada entrada es 1 byte: <code>VALID | PFN (7 bits)</code>; probá hacer el recorrido a mano con el volcado de memoria.
        </p>
      </>
    ),
  } as Record<Mech, ReactNode>,
};

const en: typeof es = {
  mech: 'Mechanism',
  mechs: { bb: 'Base & bounds', seg: 'Segmentation', lin: 'Paging', ml: 'Multi-level' },
  preset: 'Example',
  presets: {
    bb: { book: 'Ch. 15', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    seg: { book: 'Ch. 16', hw: 'Homework', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    lin: { book: 'Ch. 18', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
    ml: { book: 'Ch. 20', s0: '-s 0', s1: '-s 1', s2: '-s 2' },
  },
  presetTitles: {
    bb: { book: 'Fig. 15.2: base 32 KB, bounds 16 KB' },
    seg: { book: 'Fig. 16.1–16.3: code, heap and a stack that grows down', hw: 'Ch. 16 homework: -a 128 -p 512 -b 0 -l 20 -B 512 -L 20' },
    lin: { book: 'Fig. 18.1–18.2: 64-byte address space, 16-byte pages' },
    ml: { book: 'Fig. 20.5: 16 KB address space, 64-byte pages, 4-byte PTEs' },
  },
  variant: 'Model',
  ostepVariant: (n: number) => `OSTEP (${n} segments)`,
  bookSeg: 'Book (3 segments)',
  ostepMl: 'OSTEP (32-byte pages)',
  bookMl: 'Book (ch. 20)',
  seed: 'Seed (-s)',
  asize: 'Address space (-a)',
  psize: 'Physical memory (-p)',
  pagesize: 'Page size (-P)',
  used: '% of space used (-u)',
  allocated: 'Allocated pages (-a)',
  num: 'Number of VAs (-n)',
  base: 'Base (-b)',
  limit: 'Bounds (-l)',
  base0: 'Seg 0 base (-b)',
  len0: 'Seg 0 limit (-l)',
  base1: 'Seg 1 top (-B)',
  len1: 'Seg 1 limit (-L)',
  randomHint: '-1 = random',
  sizesHint: '16, 64k, 32m',
  segRegs: 'Segment registers',
  segName: { proc: 'process', code: 'code', heap: 'heap', stack: 'stack', seg0: 'seg 0', seg1: 'seg 1', page: 'page', pd: 'directory', pt: 'table' },
  baseCol: 'Base',
  sizeCol: 'Size',
  limitCol: 'Bounds',
  growsCol: 'Grows',
  up: '↓ positive',
  down: '↑ negative',
  vas: 'Virtual addresses',
  vasHint: 'empty = OSTEP generates them',
  vasPlaceholder: (v: string) => `e.g. ${v}`,
  bad: (t: string[]) => `Can't parse: ${t.join(', ')}`,
  paste: 'Paste an OSTEP command',
  pasteHint: 'sets everything up',
  pastePlaceholder: './segmentation.py -a 128 -p 512 -s 1 -c',
  apply: 'Apply',
  badFlags: (t: string[]) => `Ignored: ${t.join(' ')}`,
  restoreTable: "Back to OSTEP's table",
  machine: 'MMU',
  map: 'Memory map',
  vSpace: 'Virtual space',
  pSpace: 'Physical memory',
  outside: 'outside the space',
  start: 'Nothing translated yet. Press play or use → for the first address.',
  noVas: 'No addresses to translate.',
  setupError: "OSTEP won't run with this setup:",
  errors: {
    badInput: "Can't parse a size (use 16, 64k, 32m or 1g).",
    psizeSmall: 'Physical memory is too small.',
    asizeZero: "The address space can't be 0.",
    psizeLeAsize: 'Physical memory must be larger than the address space (in this simulation).',
    need2x: 'To place segments at random, physical memory must be more than twice the address space.',
    noFit: "The address space doesn't fit in physical memory with that base and bounds.",
    seg0Out: 'Segment 0 lies outside physical memory.',
    seg1Out: 'Segment 1 lies outside physical memory.',
    len0Big: "A segment can't be larger than its share of the address space.",
    len1Big: "A segment can't be larger than its share of the address space.",
    overlap: 'The segments overlap in physical memory.',
    vaRange: 'A virtual address is outside the address space.',
    tooBig: 'Sizes too large for this simulation.',
    notMultiple: 'Sizes must be multiples of the page size.',
    notPow2: 'The address space and the page size must be powers of 2.',
    noFrames: 'Not enough free frames for that many pages (the script stops with an AssertionError).',
    hang: 'No room to place the segment: the script would loop forever.',
  },
  va: 'Virtual address',
  pa: 'Physical address',
  vpn: 'VPN',
  pfn: 'PFN',
  offset: 'offset',
  segBits: 'segment',
  pdIndex: 'PD index',
  ptIndex: 'PT index',
  noPa: 'no physical address',
  okTo: 'PA',
  violation: 'SEGMENTATION VIOLATION',
  violationWhy: {
    bb: (va: string, l: string) => `${va} ≥ bounds ${l}`,
    seg: (s: string) => `outside ${s}`,
    noSeg: 'no segment uses those bits',
  },
  invalid: (vpn: number) => `VPN ${vpn} invalid → fault`,
  pdeFault: 'invalid PDE → fault',
  pteFault: 'invalid PTE → fault',
  value: 'value',
  flowVa: 'VA',
  flowCmp: (va: string, l: string, ok: boolean) => `${va} ${ok ? '<' : '≥'} bounds ${l}`,
  flowPa: 'PA = base + VA',
  flowSel: (bits: string, seg: string) => `bits ${bits} → ${seg}`,
  flowSelHalf: (hi: boolean, seg: string) => `VA ${hi ? '≥' : '<'} half → ${seg}`,
  flowNoSeg: 'no segment',
  flowNeg: (off: string, max: string, neg: string) => `offset ${off} − ${max} = ${neg}`,
  flowSegCmp: (lhs: string, l: string, ok: boolean, neg: boolean) => `${lhs} ${neg ? (ok ? '≤' : '>') : ok ? '<' : '≥'} limit ${l}`,
  flowSegPa: (neg: boolean) => (neg ? 'PA = top + offset' : 'PA = base + offset'),
  flowSplit: 'VPN | offset',
  flowPte: (vpn: number, pte: string) => `PTE[${vpn}] = ${pte}`,
  flowValid: (v: boolean, pfn?: number) => (v ? `valid, PFN ${pfn}` : 'valid = 0'),
  flowPaPage: 'PA = PFN · page + offset',
  flowPdbr: (p: number) => `PDBR = ${p}`,
  flowPde: (addr: string, val: string, ok: boolean, p: number) => `PDE at ${addr} = ${val} ${ok ? `→ PT on page ${p}` : '→ invalid'}`,
  flowPteMl: (addr: string, val: string, ok: boolean, p: number) => `PTE at ${addr} = ${val} ${ok ? `→ PFN ${p}` : '→ invalid'}`,
  flowValue: (v: string) => `value ${v}`,
  valid: 'Valid',
  violations: 'Violations',
  faults: 'Faults',
  reads: 'Reads to translate',
  readsSub: (n: number) => `${n} in total`,
  tableSize: 'Table',
  regs: (n: number) => `${n} reg.`,
  regsSub: 'no table in memory',
  tableSub: (pt: string) => `linear: ${pt}`,
  ptesSub: (n: number) => `${n} 4-byte PTEs`,
  registers: 'MMU registers',
  pageTable: 'Page table',
  pageTableSub: 'click V or the PFN to edit',
  edited: 'edited',
  pteRaw: 'PTE',
  walk: 'Multi-level page-table walk',
  pdbr: 'PDBR',
  pdbrSub: 'page of the directory',
  pdPage: (p: number) => `Page directory · page ${p}`,
  ptTitle: 'Page-table page',
  dataTitle: 'Data page',
  ptPage: (p: number) => `Page-table page · page ${p}`,
  dataPage: (p: number) => `Data page · frame ${p}`,
  notReached: 'not reached',
  fullDump: 'Full memory dump (as the script prints it)',
  ostepPanel: 'Same as OSTEP',
  copy: 'Copy',
  copied: 'Copied',
  output: 'Script output with -c',
  notes: {
    customVas: '-A passes your own addresses.',
    noAFlag: "The script has no -A: your addresses won't be in its output, but the registers and memory are the same.",
    editedTable: 'You edited the page table: the script generates a different one for this seed.',
    book: "This is the book's example: there is no equivalent OSTEP command.",
    editedRegs: '',
  },
  practice: 'Practice',
  qPa: (va: string) => `Which physical address does VA ${va} go to? Or is it a violation/fault?`,
  qPaAns: {
    ok: (pa: string) => `It goes to ${pa}.`,
    violation: 'Segmentation violation: it falls outside the segment.',
    invalid: 'Invalid: the PTE has its valid bit set to 0.',
    pdeFault: 'Fault: the page directory entry (PDE) is invalid.',
    pteFault: 'Fault: the PTE is invalid.',
  },
  qBbMin: 'What is the smallest bounds value that makes ALL these VAs valid?',
  aBbMin: (n: number) => `${n}: the highest VA plus one (the check is VA < bounds).`,
  qBbRange: (b: string, l: string) => `With base ${b} and bounds ${l}, which physical memory range can the process touch?`,
  aBbRange: (lo: string, hi: string) => `From ${lo} to ${hi} inclusive.`,
  qSegEdge: 'What is the highest valid VA in segment 0, and the lowest in segment 1 (or the stack)?',
  aSegEdge: (a: string, b: string) => `Segment 0: ${a}. Stack/segment 1: ${b}.`,
  qLinSize: (as: string, ps: string) => `With a ${as} address space and ${ps} pages, how big is a linear page table with 4-byte PTEs?`,
  aLinSize: (n: number, b: string, half: string) => `${n} entries × 4 B = ${b}. With pages twice as large, half: ${half}.`,
  qMlSize: 'How much memory does this multi-level table use? And a linear table for the same space?',
  aMlSize: (pages: number, b: string, lin: string) => `${pages} pages (directory + tables) = ${b}; a linear one would take ${lin}, even though most of its entries are invalid.`,
  explain: {
    bb: (
      <>
        <p>
          <b>Base and bounds</b> (OSTEP ch. 15): the process sees an address space starting at 0. The MMU checks <code>VA &lt; bounds</code> and, if it passes, adds the <b>base</b>: <code>PA = base + VA</code>. Otherwise it traps to the kernel: <b>segmentation violation</b>.
        </p>
        <p>Just two registers, no table in memory: translating costs no extra accesses. The catch is that the whole space, used or not, takes physical memory.</p>
      </>
    ),
    seg: (
      <>
        <p>
          <b>Segmentation</b> (OSTEP ch. 16): one base/bounds pair per segment. The top VA bits pick the segment; the rest is the <b>offset</b> inside it.
        </p>
        <p>
          The <b>stack grows down</b>: its offset is negative (<code>offset − max segment size</code>), it is added to the segment's <b>top</b>, and its absolute value must not exceed the limit. <code>segmentation.py</code> uses one bit (2 segments); the book's example uses two (code, heap, stack).
        </p>
      </>
    ),
    lin: (
      <>
        <p>
          <b>Paging</b> (OSTEP ch. 18): the space is cut into fixed-size pages. A VA splits into the <b>VPN</b> (high bits) and the <b>offset</b>. The MMU reads <code>PTE[VPN]</code> from the page table (one memory access) and, if the valid bit is 1, builds <code>PA = PFN · page + offset</code>.
        </p>
        <p>In the script each PTE is <code>0x8000_0000 | PFN</code> (top bit = valid). A linear table has one entry per virtual page, used or not: for large spaces it gets big.</p>
      </>
    ),
    ml: (
      <>
        <p>
          <b>Multi-level page tables</b> (OSTEP ch. 20): the linear table is cut into pages and only the ones with some valid entry are kept. The <b>page directory</b> (pointed to by the <b>PDBR</b>) says where each one is.
        </p>
        <p>
          A VA splits into <b>PD index</b> | <b>PT index</b> | <b>offset</b>. The MMU reads the PDE (access 1); if valid, it reads the PTE in that page-table page (access 2) and builds the PA. In the script each entry is 1 byte: <code>VALID | PFN (7 bits)</code>; try doing the walk by hand with the memory dump.
        </p>
      </>
    ),
  },
};

export const S = { es, en };
export type Strings = typeof es;
