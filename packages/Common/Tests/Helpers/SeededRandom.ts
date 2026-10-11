/*
 * THE SEEDED GENERATOR OF EVERY TEST SUITE.
 *
 * Property tests, fuzz sweeps and generated fixtures draw their numbers from
 * here: the same numbers for the same seed on every run and every machine,
 * so a test that fails can be run again and read, and as many different
 * numbers as a test asks for.
 *
 *   const random: SeededRandom = seededRandom(2718);
 *
 *   random();               // a fraction, from 0 up to, not including, 1
 *   random(6);              // a whole number, from 0 up to, not including, 6
 *   shuffled(items, random); // the items in an order drawn from the stream
 *
 * Texts drawn from an alphabet are GeneratedTexts.generatedTexts, built on
 * this. SeededRandomGuard.test.ts fails a test file that rolls a generator
 * of the kinds tests used to carry (an LCG, mulberry32, xorshift).
 *
 * The generator is mulberry32: its state is a 32-bit counter, stepped by an
 * odd number, so the draws only come round after 2^32 of them, and each
 * state is mixed into a draw whose every bit is as good as any other. A
 * whole number below a limit is about as likely as any other, whatever the
 * limit, and the draws of seeds 1, 2 and 3 have nothing to do with one
 * another. The mixing is not one-to-one: some 32-bit numbers come out of
 * two states and others of none, so a sweep over the whole 32-bit range
 * samples it but cannot reach every number in it. A test that needs a
 * particular number writes it out.
 *
 * Why there is only one. Suites each carried a copy of some generator, and
 * the most copied one, `state * 1103515245 + 12345` with a plain "*",
 * multiplies past 2^53, where a double drops the low bits of the product: its
 * state falls into a loop of 10,466 values (220 from seed 9) within a few
 * thousand draws, and its low 8 bits stop changing at all. A suite that asked
 * it for 20,000 texts got 48 to about a thousand different ones, and noise
 * "like a photo's" was one byte repeated. Other copies read the low bits of
 * a power-of-two generator (`state % limit`), which go round every 2, 4, 8 ...
 * draws.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// A draw: a fraction from 0 up to 1 with no limit, a whole number below the limit with one.
export type SeededRandom = (limit?: number) => number;

export type SeededRandomFunction = (seed: number) => SeededRandom;

// The most a limit may be: one draw holds 32 bits, so there are 2^32 values to share out.
export const LARGEST_LIMIT: number = 4294967296;

/*
 * The draws of a seed. The seed is any whole number (it is read as 32 bits,
 * so seeds 2^32 apart draw the same numbers); anything else is a mistake in
 * the test, and is refused rather than read as 0. So is a limit that is not
 * a whole number from 1 to 2^32, before it takes a draw.
 */
export const seededRandom: SeededRandomFunction = (
  seed: number,
): SeededRandom => {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(
      `seededRandom takes a whole number as its seed, not ${String(seed)}.`,
    );
  }

  let state: number = seed >>> 0;

  return (limit?: number): number => {
    if (
      limit !== undefined &&
      !(Number.isInteger(limit) && limit >= 1 && limit <= LARGEST_LIMIT)
    ) {
      throw new RangeError(
        `A seeded draw takes a whole number from 1 to 2^32 as its limit, not ${String(limit)}.`,
      );
    }

    state = (state + 0x6d2b79f5) >>> 0;

    let mixed: number = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    const fraction: number = ((mixed ^ (mixed >>> 14)) >>> 0) / LARGEST_LIMIT;

    return limit === undefined ? fraction : Math.floor(fraction * limit);
  };
};

export type ShuffledFunction = <ItemType>(
  items: ReadonlyArray<ItemType>,
  random: SeededRandom,
) => Array<ItemType>;

/*
 * The items in an order drawn from a stream (Fisher-Yates, from the last
 * place to the second): every order about as likely as any other, the same
 * for the same stream, one draw per place but the first, and the items
 * themselves left as they were. The stream must be a seededRandom one: a
 * function that ignores its limit is refused.
 */
export const shuffled: ShuffledFunction = <ItemType>(
  items: ReadonlyArray<ItemType>,
  random: SeededRandom,
): Array<ItemType> => {
  const order: Array<ItemType> = [...items];

  for (let place: number = order.length - 1; place > 0; place--) {
    const other: number = random(place + 1);

    if (!(Number.isInteger(other) && other >= 0 && other <= place)) {
      throw new RangeError(
        `shuffled draws from seededRandom; this stream gave ${String(other)} for a limit of ${String(place + 1)}.`,
      );
    }

    const held: ItemType = order[place] as ItemType;
    order[place] = order[other] as ItemType;
    order[other] = held;
  }

  return order;
};
