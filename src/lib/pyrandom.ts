/**
 * Bit-for-bit port of CPython 3's `random` module (MT19937) for the calls the
 * OSTEP homework simulators make, so `-s <seed>` problems come out identical.
 */
const N = 624;
const M = 397;

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number | bigint = 0) {
    this.seed(seed);
  }

  /** `random.seed(n)` for an integer n. */
  seed(n: number | bigint): void {
    let v = BigInt(n);
    if (v < 0n) v = -v;
    const key: number[] = [];
    while (v > 0n) {
      key.push(Number(v & 0xffffffffn));
      v >>= 32n;
    }
    if (key.length === 0) key.push(0);
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private genrandUint32(): number {
    const mt = this.mt;
    let y: number;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random.random()`: float in [0, 1) with 53 random bits. */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** `random.getrandbits(k)` as a BigInt. */
  getrandbitsBig(k: number): bigint {
    if (k <= 0) return 0n;
    let result = 0n;
    let shift = 0n;
    for (let left = k; left > 0; left -= 32) {
      let r = this.genrandUint32();
      if (left < 32) r >>>= 32 - left;
      result |= BigInt(r) << shift;
      shift += 32n;
    }
    return result;
  }

  /** `random.getrandbits(k)`; exact for k <= 53. */
  getrandbits(k: number): number {
    if (k <= 32) return k <= 0 ? 0 : this.genrandUint32() >>> (32 - k);
    return Number(this.getrandbitsBig(k));
  }

  /** `random._randbelow(n)`: uniform int in [0, n). */
  randbelow(n: number): number {
    if (n <= 0) throw new RangeError('randbelow(n) needs n > 0');
    const k = bitLength(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** `random.randint(a, b)`, inclusive on both ends. */
  randint(a: number, b: number): number {
    return a + this.randbelow(b - a + 1);
  }

  /** `random.randrange(start, stop)` (step 1). */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) return this.randbelow(start);
    return start + this.randbelow(stop - start);
  }

  /** `random.choice(seq)`. */
  choice<T>(seq: ArrayLike<T>): T {
    return seq[this.randbelow(seq.length)];
  }

  /** `random.shuffle(x)`, in place. */
  shuffle<T>(x: T[]): T[] {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
}

function bitLength(n: number): number {
  return n === 0 ? 0 : n.toString(2).length;
}
