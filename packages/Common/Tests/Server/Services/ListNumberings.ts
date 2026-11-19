/*
 * HOW A CONFIGURATION NUMBERS A LIST OF SIX ROWS, AND THE ORDERS ITS WRITES
 * LAND IN - for the suites that hold a list's writes to converge
 * (ContiguousOrderConverges, issue #9573; ListOrderConverges, issue #9609).
 *
 * Terraform writes each changed row's number on its own, all at once, in no
 * set order. A suite numbers a list each of these ways, its writes shuffled
 * by each of the seeds, and every row must end at the number written.
 */

// A small, seeded random number generator (mulberry32): the same shuffles every run.
export function seededRandom(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value: number = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: Array<T>, seed: number): Array<T> {
  const random: () => number = seededRandom(seed);
  const result: Array<T> = [...items];

  for (let index: number = result.length - 1; index > 0; index--) {
    const other: number = Math.floor(random() * (index + 1));
    const held: T = result[index]!;
    result[index] = result[other]!;
    result[other] = held;
  }

  return result;
}

export interface ListNumbering {
  name: string;
  // A number for each of the six rows, in the order the rows start in.
  orders: Array<number>;
}

/*
 * The numberings a configuration gives six rows numbered 1..6: reversed,
 * rotated each way, the ends swapped, neighbours swapped, the one that
 * serialized moves end at [3, 2, 4, 1] for (written 2nd, 3rd, 1st, 4th),
 * and some seeded at random.
 */
export const NUMBERINGS_OF_SIX: ReadonlyArray<ListNumbering> = [
  { name: "reversed", orders: [6, 5, 4, 3, 2, 1] },
  { name: "rotated down", orders: [2, 3, 4, 5, 6, 1] },
  { name: "rotated up", orders: [6, 1, 2, 3, 4, 5] },
  { name: "ends swapped", orders: [6, 2, 3, 4, 5, 1] },
  { name: "neighbours swapped", orders: [2, 1, 4, 3, 6, 5] },
  { name: "first four rotated", orders: [2, 3, 4, 1, 5, 6] },
  ...[11, 23, 37, 41].map((seed: number): ListNumbering => {
    return {
      name: `seeded ${seed}`,
      orders: shuffled([1, 2, 3, 4, 5, 6], seed),
    };
  }),
];

// The orders a numbering's writes land in: three shuffles of every changed row.
export const WRITE_SEEDS: ReadonlyArray<number> = [1, 2, 3];
