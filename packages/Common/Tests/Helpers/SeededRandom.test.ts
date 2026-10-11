/*
 * The suites' one seeded generator (SeededRandom.ts): the same numbers for
 * the same seed on every run, as many different ones as a test asks for, and
 * every bit of a draw as good as another - so no suite that draws from it
 * repeats itself the way the copies it replaced did.
 */

import {
  LARGEST_LIMIT,
  SeededRandom,
  seededRandom,
  shuffled,
} from "./SeededRandom";
import { describe, expect, test } from "@jest/globals";

// `count` draws of a stream, each below the limit (or fractions, with none).
const drawsOf: (
  random: SeededRandom,
  count: number,
  limit?: number,
) => Array<number> = (
  random: SeededRandom,
  count: number,
  limit?: number,
): Array<number> => {
  const draws: Array<number> = [];

  for (let index: number = 0; index < count; index++) {
    draws.push(random(limit));
  }

  return draws;
};

describe("seededRandom", () => {
  test("draws the same numbers for the same seed, and others for another", () => {
    expect(drawsOf(seededRandom(7), 1000)).toEqual(
      drawsOf(seededRandom(7), 1000),
    );
    expect(drawsOf(seededRandom(7), 1000, 6)).toEqual(
      drawsOf(seededRandom(7), 1000, 6),
    );
    expect(drawsOf(seededRandom(8), 1000)).not.toEqual(
      drawsOf(seededRandom(7), 1000),
    );
  });

  test("draws what it has always drawn: every suite's inputs hang on it", () => {
    /*
     * mulberry32's first draws, as 32-bit numbers. A change here changes the
     * texts, graphs and noise of every suite that draws from it: make it on
     * purpose, and run them all.
     */
    expect(drawsOf(seededRandom(0), 5, LARGEST_LIMIT)).toEqual([
      1144304738, 1416247, 958946056, 627933444, 2007157716,
    ]);
    expect(drawsOf(seededRandom(1), 5, LARGEST_LIMIT)).toEqual([
      2693262067, 11749833, 2265367787, 4213581821, 4159151403,
    ]);
    expect(drawsOf(seededRandom(2718), 5, LARGEST_LIMIT)).toEqual([
      4096722398, 2877357419, 3402521114, 2744810594, 2073103965,
    ]);
  });

  test("gives a fraction with no limit and a whole number below one, from one stream", () => {
    const fractions: Array<number> = drawsOf(seededRandom(2718), 5);
    const mixed: SeededRandom = seededRandom(2718);

    // Each call takes the next draw, whatever it is asked for.
    expect([mixed(6), mixed(6), mixed(6), mixed(100), mixed()]).toEqual([
      Math.floor(fractions[0]! * 6),
      Math.floor(fractions[1]! * 6),
      Math.floor(fractions[2]! * 6),
      Math.floor(fractions[3]! * 100),
      fractions[4],
    ]);
    expect([
      Math.floor(fractions[0]! * 6),
      Math.floor(fractions[1]! * 6),
      Math.floor(fractions[2]! * 6),
      Math.floor(fractions[3]! * 100),
    ]).toEqual([5, 4, 4, 63]);
  });

  test("keeps every fraction from 0 up to, not including, 1, and every whole number below its limit", () => {
    const random: SeededRandom = seededRandom(31);
    const outOfRange: Array<string> = [];

    for (let draw: number = 0; draw < 20000; draw++) {
      const fraction: number = random();
      const limit: number = 1 + (draw % 50);
      const whole: number = random(limit);

      if (!(fraction >= 0 && fraction < 1)) {
        outOfRange.push(`fraction ${fraction}`);
      }

      if (!(Number.isInteger(whole) && whole >= 0 && whole < limit)) {
        outOfRange.push(`${whole} for the limit ${limit}`);
      }
    }

    expect(outOfRange).toEqual([]);
    // A limit of one always draws 0, and the largest limit a 32-bit number.
    expect(drawsOf(seededRandom(3), 100, 1)).toEqual(new Array(100).fill(0));
    expect(
      drawsOf(seededRandom(3), 100, LARGEST_LIMIT).every(
        (value: number): boolean => {
          return Number.isInteger(value) && value < LARGEST_LIMIT;
        },
      ),
    ).toBe(true);
  });

  test("draws every number below a limit about as often as each other", () => {
    for (const limit of [2, 6, 10, 26]) {
      const counts: Array<number> = new Array(limit).fill(0);

      for (const value of drawsOf(seededRandom(42), 100000, limit)) {
        counts[value] = counts[value]! + 1;
      }

      const expected: number = 100000 / limit;

      // Within 5 % of an even share, for every number: one expect per limit.
      expect([
        limit,
        counts.every((count: number): boolean => {
          return Math.abs(count - expected) < expected * 0.05;
        }),
      ]).toEqual([limit, true]);
    }
  });

  test("draws as many different numbers as it is asked for", () => {
    /*
     * 200,000 draws of 32 bits: by the birthday bound about five pairs
     * collide. The plain-multiply copy it replaced fell into a loop of
     * 10,466 numbers within a few thousand draws.
     */
    const draws: Array<number> = drawsOf(
      seededRandom(9),
      200000,
      LARGEST_LIMIT,
    );

    expect(new Set<number>(draws).size).toBeGreaterThan(199950);
  });

  test("changes its low bits as freely as its high ones", () => {
    /*
     * A power-of-two generator read through `state % limit` repeats its low
     * bits: its last bit alternates, its last byte comes round every 256
     * draws. Every bit of a draw here is mixed.
     */
    const draws: Array<number> = drawsOf(seededRandom(5), 4096, LARGEST_LIMIT);
    const lowBits: Array<number> = draws.map((value: number): number => {
      return value % 2;
    });
    const sameAsNext: number = lowBits.filter(
      (bit: number, index: number): boolean => {
        return index > 0 && bit === lowBits[index - 1];
      },
    ).length;
    const lowBytes: Array<number> = draws.map((value: number): number => {
      return value % 256;
    });

    // About half the neighbours share a last bit; an alternating bit shares none.
    expect(sameAsNext).toBeGreaterThan(1800);
    expect(sameAsNext).toBeLessThan(2300);
    // The last byte takes every value, and does not come round every 256 draws.
    expect(new Set<number>(lowBytes).size).toBe(256);
    expect(lowBytes.slice(256, 512)).not.toEqual(lowBytes.slice(0, 256));
  });

  test("starts the draws of neighbouring seeds apart", () => {
    /*
     * Suites loop over seeds 1, 2, 3 ... A linear congruential generator
     * puts the first draws of neighbouring seeds a fixed step apart - on a
     * line. Here the step from one seed's first draw to the next seed's is
     * as varied as the draws themselves.
     */
    const firsts: Array<number> = [];

    for (let seed: number = 1; seed <= 2001; seed++) {
      firsts.push(seededRandom(seed)(LARGEST_LIMIT));
    }

    const steps: Set<number> = new Set<number>(
      firsts.slice(1).map((value: number, index: number): number => {
        return (value - firsts[index]! + LARGEST_LIMIT) % LARGEST_LIMIT;
      }),
    );

    expect(steps.size).toBeGreaterThan(1990);
  });

  test("reads a seed as 32 bits: seeds 2^32 apart, and -1 and 2^32 - 1, draw the same", () => {
    expect(drawsOf(seededRandom(5 + LARGEST_LIMIT), 10)).toEqual(
      drawsOf(seededRandom(5), 10),
    );
    expect(drawsOf(seededRandom(-1), 10)).toEqual(
      drawsOf(seededRandom(LARGEST_LIMIT - 1), 10),
    );
    expect(drawsOf(seededRandom(0x5eed), 10)).toEqual(
      drawsOf(seededRandom(24301), 10),
    );
  });

  test.each([
    ["not a number", Number.NaN],
    ["a fraction", 1.5],
    ["infinite", Number.POSITIVE_INFINITY],
    ["past the whole numbers a number holds exactly", 2 ** 53],
  ])("refuses a seed that is %s", (_case: string, seed: number) => {
    expect(() => {
      return seededRandom(seed);
    }).toThrow(RangeError);
  });

  test.each([
    ["none", 0],
    ["below none", -3],
    ["a fraction", 2.5],
    ["not a number", Number.NaN],
    ["more than 32 bits hold", LARGEST_LIMIT + 1],
  ])(
    "refuses a limit of %s, and takes no draw for it",
    (_case: string, limit: number) => {
      const random: SeededRandom = seededRandom(11);

      expect(() => {
        return random(limit);
      }).toThrow(RangeError);
      // The refused call left the stream where it was.
      expect(drawsOf(random, 3)).toEqual(drawsOf(seededRandom(11), 3));
    },
  );

  test("says what it refuses", () => {
    expect(() => {
      return seededRandom(1.5);
    }).toThrow("seededRandom takes a whole number as its seed, not 1.5.");
    expect(() => {
      return seededRandom(1)(0);
    }).toThrow(
      "A seeded draw takes a whole number from 1 to 2^32 as its limit, not 0.",
    );
  });

  test("reaches every 32-bit number in two halves", () => {
    /*
     * One draw of the whole range is not one-to-one; two 16-bit halves each
     * take every value, so every 32-bit number can come up.
     */
    const random: SeededRandom = seededRandom(17);
    const seen: Array<Uint8Array> = [
      new Uint8Array(65536),
      new Uint8Array(65536),
    ];
    const missing: Array<number> = [65536, 65536];
    let pairs: number = 0;

    // Every half-value turns up within about a million pairs (the coupon collector's 727,000).
    while ((missing[0]! > 0 || missing[1]! > 0) && pairs < 2000000) {
      for (const half of [0, 1]) {
        const value: number = random(65536);

        if (seen[half]![value] === 0) {
          seen[half]![value] = 1;
          missing[half] = missing[half]! - 1;
        }
      }

      pairs++;
    }

    expect(missing).toEqual([0, 0]);
  });
});

describe("shuffled", () => {
  const ITEMS: ReadonlyArray<string> = ["a", "b", "c"];

  test("gives every order about as often as any other", () => {
    const random: SeededRandom = seededRandom(23);
    const counts: Map<string, number> = new Map<string, number>();

    for (let round: number = 0; round < 60000; round++) {
      const order: string = shuffled(ITEMS, random).join("");
      counts.set(order, (counts.get(order) || 0) + 1);
    }

    expect(Array.from(counts.keys()).sort()).toEqual([
      "abc",
      "acb",
      "bac",
      "bca",
      "cab",
      "cba",
    ]);
    expect(
      Array.from(counts.values()).every((count: number): boolean => {
        return Math.abs(count - 10000) < 500;
      }),
    ).toBe(true);
  });

  test("gives the same order for the same stream, keeps every item, and leaves the items as they were", () => {
    const items: Array<string | undefined> = ["x", undefined, "y", "x", "z"];
    const order: Array<string | undefined> = shuffled(items, seededRandom(5));

    expect(shuffled(items, seededRandom(5))).toEqual(order);
    expect(items).toEqual(["x", undefined, "y", "x", "z"]);
    expect([...order].sort()).toEqual([...items].sort());
    expect(shuffled([], seededRandom(5))).toEqual([]);
    expect(shuffled(["only"], seededRandom(5))).toEqual(["only"]);
  });

  test("takes one draw for each place but the first, from the stream it is given", () => {
    const random: SeededRandom = seededRandom(31);
    const fresh: SeededRandom = seededRandom(31);

    shuffled(["a", "b", "c", "d", "e"], random);
    drawsOf(fresh, 4, 2);

    expect(random()).toBe(fresh());
  });

  test("is Fisher-Yates from the last place: the suites' shuffles draw the orders they drew", () => {
    const random: SeededRandom = seededRandom(7);
    const order: Array<number> = [0, 1, 2, 3, 4, 5, 6, 7];

    for (let place: number = order.length - 1; place > 0; place--) {
      const other: number = random(place + 1);
      const held: number = order[place]!;
      order[place] = order[other]!;
      order[other] = held;
    }

    expect(shuffled([0, 1, 2, 3, 4, 5, 6, 7], seededRandom(7))).toEqual(order);
  });

  test("refuses a stream that ignores its limit", () => {
    const fractions: () => number = (): number => {
      return 0.5;
    };

    expect(() => {
      return shuffled(ITEMS, fractions);
    }).toThrow(
      "shuffled draws from seededRandom; this stream gave 0.5 for a limit of 3.",
    );
  });
});
