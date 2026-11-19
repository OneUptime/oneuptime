/*
 * HOW A CONFIGURATION NUMBERS A LIST OF SIX ROWS, AND THE ORDERS ITS WRITES
 * LAND IN - for the suites that hold a list's writes to converge
 * (ContiguousOrderConverges, issue #9573; ListOrderConverges, issue #9609).
 *
 * Terraform writes each changed row's number on its own, all at once, in no
 * set order. A suite numbers a list each of these ways, its writes shuffled
 * by each of the seeds, and every row must end at the number written.
 */

import {
  seededRandom,
  shuffled as shuffledBy,
} from "../../Helpers/SeededRandom";

// The items in an order drawn from a seed (Tests/Helpers/SeededRandom): the same shuffles every run.
export function shuffled<T>(items: Array<T>, seed: number): Array<T> {
  return shuffledBy(items, seededRandom(seed));
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
