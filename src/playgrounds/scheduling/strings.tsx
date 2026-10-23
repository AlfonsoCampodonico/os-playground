import type { FlagError, Policy, PresetId } from '../../sim/scheduling';

const es = {
  presetsCh7: 'Ejemplos del cap. 7',
  presetsCh8: 'Ejemplos del cap. 8 (MLFQ)',
  presets: {
    fifo: 'FIFO 10·10·10',
    convoy: 'Convoy',
    sjfLate: 'SJF tarde',
    stcf: 'STCF',
    rr: 'RR vs SJF',
    mlfqLong: 'Uno largo',
    mlfqShort: 'Largo + corto',
    mlfqIo: 'Con E/S',
    starve: 'Inanición',
    boost: 'Boost',
  } as Record<PresetId, string>,
  presetTitles: {
    fifo: 'Fig. 7.1: tres jobs de 10, FIFO',
    convoy: 'Fig. 7.2: el efecto convoy (probá SJF)',
    sjfLate: 'Fig. 7.4: SJF con B y C llegando en t=10',
    stcf: 'Fig. 7.5: STCF desaloja al largo',
    rr: 'Figs. 7.6–7.7: RR q=1 (probá SJF)',
    mlfqLong: 'Fig. 8.2: un job largo baja de a una cola',
    mlfqShort: 'Fig. 8.3: llega un job corto e interactivo',
    mlfqIo: 'Fig. 8.4: el job con E/S se queda arriba (-S)',
    starve: 'Fig. 8.5 (izq.): dos interactivos matan de hambre al largo',
    boost: 'Fig. 8.5 (der.): boost cada 50',
  } as Record<PresetId, string>,
  policy: 'Política',
  policyTitles: {
    fifo: 'First In, First Out: en orden de llegada, sin desalojo',
    sjf: 'Shortest Job First: el más corto primero, sin desalojo',
    stcf: 'Shortest Time-to-Completion First: SJF con desalojo (extensión: scheduler.py no lo tiene)',
    rr: 'Round Robin: turnos de un quantum',
    mlfq: 'Multi-Level Feedback Queue (mlfq.py)',
  } as Record<Policy, string>,
  quantum: 'Quantum (time slice)',
  queues: 'Cantidad de colas',
  perLevel: 'Quantum y allotment por cola',
  allotHint: 'allotment = cuántos quanta antes de bajar',
  level: (q: number, top: boolean, bottom: boolean) => `Q${q}${top ? ' · alta' : bottom ? ' · baja' : ''}`,
  q: 'q',
  a: 'a',
  boost: 'Boost cada',
  boostHint: '0 = nunca (-B)',
  stay: 'Resetear y quedarse al hacer E/S (-S)',
  iobump: 'Al volver de E/S, al frente de la cola (-I)',
  ioTime: 'Duración de cada E/S',
  ioTimeHint: '-i',
  jobs: 'Jobs',
  arrival: 'Llega',
  length: 'Dura',
  ioFreq: 'E/S c/',
  ioFreqTitle: 'Hace una E/S cada tantas unidades de CPU (0 = nunca)',
  addJob: 'Agregar job',
  removeJob: (n: string) => `Sacar ${n}`,
  jobsText: 'Como texto',
  jobsTextHint: 'llegada,duración[,E/S] separados por espacio',
  badJobs: (b: string[]) => `No entiendo: ${b.filter(Boolean).join(', ') || 'vacío'}`,
  ostep: 'Igual que OSTEP',
  ext: {
    stcf: 'STCF es una extensión: scheduler.py solo tiene FIFO, SJF y RR.',
    arrivals: 'Llegadas distintas de 0: extensión, scheduler.py arranca todo en t=0.',
    io: 'E/S en FIFO/SJF/RR: extensión (sección 7.8); scheduler.py no la modela.',
  },
  paste: 'Pegá flags de scheduler.py o mlfq.py',
  pastePh: './scheduler.py -p RR -q 2 -s 3 -c',
  apply: 'Aplicar',
  flagError: (e: FlagError) =>
    e.k === 'unknown'
      ? `No conozco «${e.flag}»`
      : e.k === 'value'
        ? `Falta o está mal el valor de ${e.flag}`
        : e.k === 'range'
          ? `${e.flag} está fuera de rango`
          : e.k === 'policy'
            ? `Política desconocida: ${e.value} (FIFO, SJF, RR)`
            : e.k === 'mismatch'
              ? '-A tiene que tener tantos valores como -Q'
              : 'La lista -l está mal formada',
  machine: 'Scheduler',
  cpu: 'CPU',
  idle: 'ociosa',
  gantt: 'Diagrama de Gantt',
  legendRun: 'corre',
  legendReady: 'listo, esperando',
  legendIo: 'en E/S',
  ready: 'Cola de listos',
  readySorted: 'ordenada por tiempo restante',
  inIo: 'En E/S',
  until: (t: number) => `hasta t=${t}`,
  notYet: 'Por llegar',
  at: (t: number) => `t=${t}`,
  done: 'Terminados',
  empty: 'vacía',
  left: (n: number) => `${n} restantes`,
  endsAt: (t: number) => `termina en t=${t}`,
  startNarr: 'Todavía no corrió nada. Dale play o usá → para avanzar de a una unidad de tiempo.',
  narr: {
    t: (t: number) => `t=${t}`,
    arrive: (j: string) => `llega ${j}`,
    ioDone: (j: string, bump: boolean) => `${j} vuelve de E/S${bump ? ' (al frente, -I)' : ''}`,
    boost: 'BOOST: todos a la cola más alta',
    slice: (j: string) => `${j} agotó su quantum → al final de la cola`,
    preempt: (j: string, by: string) => `${by} desaloja a ${j}`,
    idle: 'CPU ociosa: no hay nadie listo',
    run: (j: string) => `corre ${j}`,
    runAt: (j: string, q: number) => `corre ${j} en Q${q}`,
    finish: (j: string, t: number) => `${j} termina en t=${t}`,
    ioStart: (j: string, until: number) => `${j} pide E/S (hasta t=${until})`,
    demote: (j: string, from: number, to: number) => `${j} gastó su allotment en Q${from} → baja a Q${to}`,
    requeue: (j: string, q: number, bottom: boolean) => (bottom ? `${j} agotó su quantum en la cola más baja → al final de Q${q}` : `${j} agotó un quantum → al final de Q${q}`),
  },
  avgTurnaround: 'Turnaround prom.',
  avgResponse: 'Response prom.',
  avgWait: 'Wait prom.',
  switches: 'Cambios de contexto',
  switchesTitle: 'Veces que la CPU pasa a un job distinto del último que corrió',
  ofDone: (k: number, n: number) => `${k} de ${n} terminaron`,
  ofStarted: (k: number, n: number) => `${k} de ${n} arrancaron`,
  metrics: 'Métricas por job',
  job: 'Job',
  firstRun: '1ª vez',
  completion: 'Fin',
  response: 'Response',
  turnaround: 'Turnaround',
  wait: 'Wait',
  average: 'Promedio',
  metricsHint: 'response = 1ª vez − llegada · turnaround = fin − llegada · wait = turnaround − duración − E/S',
  jumpTo: (t: number) => `Ir a t=${t}`,
  compare: 'Comparación',
  compareHint: 'Las mismas cargas con cada política. Tocá una para cambiar.',
  compareIo: 'Hay E/S: FIFO/SJF/STCF/RR la simulan como extensión (cap. 7.8).',
  truncated: (n: number) => `La simulación se cortó en t=${n}.`,
  practice: 'Practicá',
  pq1: '¿Cuál es el turnaround promedio con SJF?',
  pa1: (sjf: string, fifo: string, stcf: string) => `${sjf}. Comparalo con FIFO (${fifo}) y STCF (${stcf}).`,
  pq2: '¿Qué job termina último con RR q=2? ¿En qué instante?',
  pa2: (j: string, t: number) => `${j}, en t=${t}.`,
  pq3: (p: string) => `Con ${p}, ¿cuál es el response time de cada job?`,
  pa3: (list: string, avg: string) => `${list} (promedio ${avg}).`,
  explain: (
    <>
      <p>
        El <b>scheduler</b> elige qué job usa la CPU en cada instante. Medimos dos cosas (OSTEP cap. 7): <b>turnaround</b> = T<sub>fin</sub> − T<sub>llegada</sub> (cuánto tarda en terminar) y{' '}
        <b>response</b> = T<sub>1ª vez</sub> − T<sub>llegada</sub> (cuánto tarda en arrancar). <b>Wait</b> es el tiempo en la cola de listos.
      </p>
      <p>
        <b>FIFO</b> sufre el <b>efecto convoy</b>: un job largo adelante hace esperar a todos. <b>SJF</b> corre primero el más corto y es óptimo en turnaround si todos llegan juntos; <b>STCF</b> además desaloja cuando llega uno más corto. <b>RR</b> reparte la CPU en quanta: gana en response pero pierde en turnaround.
      </p>
      <p>
        <b>MLFQ</b> (cap. 8) no sabe cuánto dura cada job: lo aprende. Arranca arriba (regla 3), corre el de mayor prioridad y en RR entre iguales (reglas 1–2), baja de cola al gastar su allotment (regla 4) y cada tanto hay un <b>boost</b> que sube a todos y evita la inanición (regla 5).
      </p>
      <p>
        Desempates: los que llegan (o vuelven de E/S) entran a la cola antes que el job al que se le acabó el quantum en ese mismo instante; SJF y STCF eligen el de menor tiempo restante, después el que llegó antes y después el de menor número; STCF no desaloja en un empate.
      </p>
    </>
  ),
};

export type Strings = typeof es;

const en: Strings = {
  presetsCh7: 'Chapter 7 examples',
  presetsCh8: 'Chapter 8 examples (MLFQ)',
  presets: {
    fifo: 'FIFO 10·10·10',
    convoy: 'Convoy',
    sjfLate: 'Late SJF',
    stcf: 'STCF',
    rr: 'RR vs SJF',
    mlfqLong: 'One long',
    mlfqShort: 'Long + short',
    mlfqIo: 'With I/O',
    starve: 'Starvation',
    boost: 'Boost',
  },
  presetTitles: {
    fifo: 'Fig. 7.1: three jobs of 10, FIFO',
    convoy: 'Fig. 7.2: the convoy effect (try SJF)',
    sjfLate: 'Fig. 7.4: SJF with B and C arriving at t=10',
    stcf: 'Fig. 7.5: STCF preempts the long job',
    rr: 'Figs. 7.6–7.7: RR q=1 (try SJF)',
    mlfqLong: 'Fig. 8.2: a long job sinks one queue at a time',
    mlfqShort: 'Fig. 8.3: a short interactive job arrives',
    mlfqIo: 'Fig. 8.4: the I/O job stays on top (-S)',
    starve: 'Fig. 8.5 (left): two interactive jobs starve the long one',
    boost: 'Fig. 8.5 (right): boost every 50',
  },
  policy: 'Policy',
  policyTitles: {
    fifo: 'First In, First Out: arrival order, no preemption',
    sjf: 'Shortest Job First: shortest first, no preemption',
    stcf: 'Shortest Time-to-Completion First: preemptive SJF (extension: not in scheduler.py)',
    rr: 'Round Robin: turns of one quantum',
    mlfq: 'Multi-Level Feedback Queue (mlfq.py)',
  },
  quantum: 'Quantum (time slice)',
  queues: 'Number of queues',
  perLevel: 'Quantum and allotment per queue',
  allotHint: 'allotment = quanta before moving down',
  level: (q, top, bottom) => `Q${q}${top ? ' · high' : bottom ? ' · low' : ''}`,
  q: 'q',
  a: 'a',
  boost: 'Boost every',
  boostHint: '0 = never (-B)',
  stay: 'Reset and stay when doing I/O (-S)',
  iobump: 'After I/O, go to the front of the queue (-I)',
  ioTime: 'Length of each I/O',
  ioTimeHint: '-i',
  jobs: 'Jobs',
  arrival: 'Arrives',
  length: 'Length',
  ioFreq: 'I/O every',
  ioFreqTitle: 'Issues an I/O every this many CPU units (0 = never)',
  addJob: 'Add job',
  removeJob: (n) => `Remove ${n}`,
  jobsText: 'As text',
  jobsTextHint: 'arrival,length[,I/O] separated by spaces',
  badJobs: (b) => `Can't parse: ${b.filter(Boolean).join(', ') || 'empty'}`,
  ostep: 'Same as OSTEP',
  ext: {
    stcf: 'STCF is an extension: scheduler.py only has FIFO, SJF and RR.',
    arrivals: 'Non-zero arrivals: extension, scheduler.py starts everything at t=0.',
    io: 'I/O under FIFO/SJF/RR: extension (section 7.8); scheduler.py does not model it.',
  },
  paste: 'Paste scheduler.py or mlfq.py flags',
  pastePh: './scheduler.py -p RR -q 2 -s 3 -c',
  apply: 'Apply',
  flagError: (e) =>
    e.k === 'unknown'
      ? `Unknown option “${e.flag}”`
      : e.k === 'value'
        ? `Missing or bad value for ${e.flag}`
        : e.k === 'range'
          ? `${e.flag} is out of range`
          : e.k === 'policy'
            ? `Unknown policy: ${e.value} (FIFO, SJF, RR)`
            : e.k === 'mismatch'
              ? '-A needs as many values as -Q'
              : 'The -l list is malformed',
  machine: 'Scheduler',
  cpu: 'CPU',
  idle: 'idle',
  gantt: 'Gantt chart',
  legendRun: 'running',
  legendReady: 'ready, waiting',
  legendIo: 'in I/O',
  ready: 'Ready queue',
  readySorted: 'sorted by time left',
  inIo: 'In I/O',
  until: (t) => `until t=${t}`,
  notYet: 'Not arrived',
  at: (t) => `t=${t}`,
  done: 'Finished',
  empty: 'empty',
  left: (n) => `${n} left`,
  endsAt: (t) => `done at t=${t}`,
  startNarr: 'Nothing has run yet. Press play or use → to advance one time unit.',
  narr: {
    t: (t) => `t=${t}`,
    arrive: (j) => `${j} arrives`,
    ioDone: (j, bump) => `${j} is back from I/O${bump ? ' (to the front, -I)' : ''}`,
    boost: 'BOOST: everyone to the top queue',
    slice: (j) => `${j} used up its quantum → back of the queue`,
    preempt: (j, by) => `${by} preempts ${j}`,
    idle: 'CPU idle: nobody is ready',
    run: (j) => `${j} runs`,
    runAt: (j, q) => `${j} runs at Q${q}`,
    finish: (j, t) => `${j} finishes at t=${t}`,
    ioStart: (j, until) => `${j} issues I/O (until t=${until})`,
    demote: (j, from, to) => `${j} used its allotment at Q${from} → down to Q${to}`,
    requeue: (j, q, bottom) => (bottom ? `${j} used a quantum at the bottom queue → back of Q${q}` : `${j} used a quantum → back of Q${q}`),
  },
  avgTurnaround: 'Avg turnaround',
  avgResponse: 'Avg response',
  avgWait: 'Avg wait',
  switches: 'Context switches',
  switchesTitle: 'Times the CPU moves to a different job than the last one that ran',
  ofDone: (k, n) => `${k} of ${n} finished`,
  ofStarted: (k, n) => `${k} of ${n} started`,
  metrics: 'Per-job metrics',
  job: 'Job',
  firstRun: '1st run',
  completion: 'End',
  response: 'Response',
  turnaround: 'Turnaround',
  wait: 'Wait',
  average: 'Average',
  metricsHint: 'response = 1st run − arrival · turnaround = end − arrival · wait = turnaround − length − I/O',
  jumpTo: (t) => `Go to t=${t}`,
  compare: 'Comparison',
  compareHint: 'Same workload under every policy. Tap one to switch.',
  compareIo: 'There is I/O: FIFO/SJF/STCF/RR simulate it as an extension (ch. 7.8).',
  truncated: (n) => `The simulation was cut at t=${n}.`,
  practice: 'Practice',
  pq1: 'What is the average turnaround under SJF?',
  pa1: (sjf, fifo, stcf) => `${sjf}. Compare it with FIFO (${fifo}) and STCF (${stcf}).`,
  pq2: 'Which job finishes last under RR q=2? At what time?',
  pa2: (j, t) => `${j}, at t=${t}.`,
  pq3: (p) => `Under ${p}, what is each job's response time?`,
  pa3: (list, avg) => `${list} (average ${avg}).`,
  explain: (
    <>
      <p>
        The <b>scheduler</b> picks which job uses the CPU at each moment. We measure two things (OSTEP ch. 7): <b>turnaround</b> = T<sub>completion</sub> − T<sub>arrival</sub> (how long until it finishes) and{' '}
        <b>response</b> = T<sub>first run</sub> − T<sub>arrival</sub> (how long until it starts). <b>Wait</b> is the time spent in the ready queue.
      </p>
      <p>
        <b>FIFO</b> suffers from the <b>convoy effect</b>: a long job in front makes everyone wait. <b>SJF</b> runs the shortest first and is optimal for turnaround when all arrive together; <b>STCF</b> also preempts when a shorter one arrives. <b>RR</b> shares the CPU in quanta: great response, poor turnaround.
      </p>
      <p>
        <b>MLFQ</b> (ch. 8) doesn’t know how long jobs are: it learns. Jobs start on top (rule 3), the highest priority runs, RR among equals (rules 1–2), a job moves down once it uses its allotment (rule 4), and a periodic <b>boost</b> lifts everyone to avoid starvation (rule 5).
      </p>
      <p>
        Ties: arrivals (and jobs back from I/O) join the queue before the job whose quantum expired at that same instant; SJF and STCF pick the least time left, then the earliest arrival, then the lowest number; STCF doesn’t preempt on a tie.
      </p>
    </>
  ),
};

export const S = { es, en };
