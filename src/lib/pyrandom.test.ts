import { describe, expect, it } from 'vitest';
import golden from './pyrandom.golden.json';
import { PyRandom } from './pyrandom';

// Values produced by CPython 3 (`random.seed(s)` then the listed calls).
describe('PyRandom matches CPython', () => {
  for (const [seed, g] of Object.entries(golden)) {
    it(`seed ${seed}`, () => {
      const s = BigInt(seed);
      let r = new PyRandom(s);
      expect(Array.from({ length: 5 }, () => r.random())).toEqual(g.random);
      expect(Array.from({ length: 5 }, () => r.randint(0, 99))).toEqual(g.randint);
      expect(Array.from({ length: 3 }, () => r.randint(0, 2 ** 40))).toEqual(g.randint_big);

      r = new PyRandom(s);
      expect(r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual(g.shuffle);

      r = new PyRandom(s);
      expect(Array.from({ length: 5 }, () => r.choice('abcdefg'))).toEqual(g.choice);

      r = new PyRandom(s);
      expect([1, 7, 32, 33, 64].map((k) => r.getrandbitsBig(k).toString())).toEqual(g.bits);
    });
  }
});
