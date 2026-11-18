import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  LIST_ORDER_CASES,
  LIST_ORDER_MODEL_NAMES,
  ListOrderCase,
  OTHER_LIST_ID,
  OTHER_PROJECT_ID,
  adminProps,
  numbersById,
  rowInList,
  useInMemoryHookFreeWrites,
} from "./ListOrderColumnCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A DRAG-ORDERED LIST NUMBERED AT ONCE ENDS UP NUMBERED AS WRITTEN (issue
 * #9609).
 *
 * Terraform, and anything else that manages a list declaratively, writes
 * each row's number on its own: the rows whose number changed, all at once,
 * in no set order. When a write of a number another row held made that row
 * step aside - and the run of rows behind it - each write renumbered rows
 * another write had just placed: the apply succeeded, the next plan found
 * new differences, and applying again never settled. #9573 was the same
 * failure on status page groups and the other lists ContiguousOrder keeps;
 * these are the lists @ListOrderColumn keeps: severities, states, monitor
 * statuses, custom fields, a status page's links, pipelines and their
 * processors, filters and rules of every kind.
 *
 * Each list is numbered as a configuration numbers it - every changed row
 * written at once, in a shuffled order - through the real updateOneById,
 * create and deleteOneById of its service, hooks and permission checks
 * included, over an in-memory table. Every row must end at the number
 * written, and no row of another list may move.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The rows of the list under test: six, numbered 1..6 to begin with.
const LIST_ROWS: Array<string> = [
  "1d000000-0000-4000-8000-0000000000d1",
  "1d000000-0000-4000-8000-0000000000d2",
  "1d000000-0000-4000-8000-0000000000d3",
  "1d000000-0000-4000-8000-0000000000d4",
  "1d000000-0000-4000-8000-0000000000d5",
  "1d000000-0000-4000-8000-0000000000d6",
];

// Two rows of another project's list, at 1 and 2.
const ROW_X: string = "1d000000-0000-4000-8000-0000000000b1";
const ROW_Y: string = "1d000000-0000-4000-8000-0000000000b2";

// A small, seeded random number generator (mulberry32): the same shuffles every run.
function seededRandom(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value: number = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: Array<T>, seed: number): Array<T> {
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

/*
 * The numberings a configuration gives the six rows, a number per row in
 * LIST_ROWS's order: reversed, rotated each way, the ends swapped,
 * neighbours swapped, and some seeded at random. Each is a numbering of
 * the same rows 1..6, so every write lands on a number another row holds
 * until that row's own write lands.
 */
const NUMBERINGS: Array<{ name: string; orders: Array<number> }> = [
  { name: "reversed", orders: [6, 5, 4, 3, 2, 1] },
  { name: "rotated down", orders: [2, 3, 4, 5, 6, 1] },
  { name: "rotated up", orders: [6, 1, 2, 3, 4, 5] },
  { name: "ends swapped", orders: [6, 2, 3, 4, 5, 1] },
  { name: "neighbours swapped", orders: [2, 1, 4, 3, 6, 5] },
  { name: "first four rotated", orders: [2, 3, 4, 1, 5, 6] },
  ...[11, 23, 37, 41].map((seed: number) => {
    return {
      name: `seeded ${seed}`,
      orders: shuffled([1, 2, 3, 4, 5, 6], seed),
    };
  }),
];

/*
 * The orders of the write: four shuffles of every changed row. Written one
 * after another, moving the rows in the way ends somewhere else for seed 1
 * of "seeded 37", 4 of "rotated down" and "first four rotated", 5 of
 * "reversed" and 7 of "rotated up", "seeded 11" and "seeded 23" - writes
 * that never overlap, and still never settle.
 */
const WRITE_SEEDS: Array<number> = [1, 4, 5, 7];

/*
 * How the provider's writes land: all at once, or one after another - each
 * request answered before the next arrives, as a slow network or a
 * provider with -parallelism=1 sends them. Moving the rows in the way
 * failed both ways: even writes made one at a time, in some orders, end
 * somewhere else than the numbers written.
 */
interface WriteMode {
  name: string;
  run: (writes: Array<() => Promise<void>>) => Promise<void>;
}

const WRITE_MODES: Array<WriteMode> = [
  {
    name: "at once",
    run: async (writes: Array<() => Promise<void>>): Promise<void> => {
      await Promise.all(
        writes.map(async (write: () => Promise<void>): Promise<void> => {
          await write();
        }),
      );
    },
  },
  {
    name: "one after another",
    run: async (writes: Array<() => Promise<void>>): Promise<void> => {
      for (const write of writes) {
        await write();
      }
    },
  },
];

describe("the drag-ordered lists", () => {
  test("every model marked @ListOrderColumn is numbered here, through its own service", () => {
    expect(
      LIST_ORDER_CASES.map((listOrderCase: ListOrderCase) => {
        return listOrderCase.label;
      }).sort(),
    ).toEqual(LIST_ORDER_MODEL_NAMES);
  });
});

describe.each(LIST_ORDER_CASES)("$label", (listOrderCase: ListOrderCase) => {
  let table: InMemoryTable;

  const otherList: Record<string, number> = {
    [ROW_X]: 1,
    [ROW_Y]: 2,
  };

  beforeEach(() => {
    table = useInMemoryTable(listOrderCase.service, [
      ...LIST_ROWS.map((id: string, index: number): StoredRow => {
        return rowInList({ listOrderCase, id, order: index + 1 });
      }),
      rowInList({
        listOrderCase,
        id: ROW_X,
        order: 1,
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
      rowInList({
        listOrderCase,
        id: ROW_Y,
        order: 2,
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);
    useInMemoryHookFreeWrites({ service: listOrderCase.service, table });
    listOrderCase.stubCollaborators();
  });

  describe.each(WRITE_MODES)("written $name", (mode: WriteMode) => {
    describe.each(NUMBERINGS)(
      "numbering the list $name",
      (numbering: { name: string; orders: Array<number> }) => {
        test.each(WRITE_SEEDS)(
          "every changed row, shuffled (seed %i), ends at its number",
          async (seed: number) => {
            const expected: Record<string, number> = {};
            const writes: Array<{ id: string; order: number }> = [];

            LIST_ROWS.forEach((id: string, index: number) => {
              const order: number = numbering.orders[index]!;
              expected[id] = order;

              // As Terraform plans it: a row already at its number is not written.
              if (order !== index + 1) {
                writes.push({ id, order });
              }
            });

            await mode.run(
              shuffled(writes, seed).map(
                (write: { id: string; order: number }) => {
                  return async (): Promise<void> => {
                    await listOrderCase.service.updateOneById({
                      id: new ObjectID(write.id),
                      data: { [listOrderCase.column]: write.order } as never,
                      props: adminProps(),
                    });
                  };
                },
              ),
            );

            expect(numbersById({ table, listOrderCase })).toEqual(expected);
            expect(
              numbersById({
                table,
                listOrderCase,
                listId: OTHER_LIST_ID,
                projectId: OTHER_PROJECT_ID,
              }),
            ).toEqual(otherList);
          },
        );
      },
    );

    /*
     * Taking a row out of the middle renumbers the rows after it: a delete
     * and an update of each of them.
     */
    test.each(WRITE_SEEDS)(
      "a row taken out of the middle, and the rows after it renumbered (seed %i)",
      async (seed: number) => {
        const writes: Array<() => Promise<void>> = [
          async (): Promise<void> => {
            await listOrderCase.service.deleteOneById({
              id: new ObjectID(LIST_ROWS[2]!),
              props: adminProps(),
            });
          },
          ...LIST_ROWS.slice(3).map((id: string, index: number) => {
            return async (): Promise<void> => {
              await listOrderCase.service.updateOneById({
                id: new ObjectID(id),
                data: { [listOrderCase.column]: index + 3 } as never,
                props: adminProps(),
              });
            };
          }),
        ];

        await mode.run(shuffled(writes, seed));

        expect(numbersById({ table, listOrderCase })).toEqual({
          [LIST_ROWS[0]!]: 1,
          [LIST_ROWS[1]!]: 2,
          [LIST_ROWS[3]!]: 3,
          [LIST_ROWS[4]!]: 4,
          [LIST_ROWS[5]!]: 5,
        });
      },
    );
  });

  test("a list numbered with gaps, as a configuration may number it, keeps every number", async () => {
    await Promise.all(
      LIST_ROWS.map(async (id: string, index: number): Promise<void> => {
        await listOrderCase.service.updateOneById({
          id: new ObjectID(id),
          data: { [listOrderCase.column]: (6 - index) * 10 } as never,
          props: adminProps(),
        });
      }),
    );

    expect(numbersById({ table, listOrderCase })).toEqual({
      [LIST_ROWS[0]!]: 60,
      [LIST_ROWS[1]!]: 50,
      [LIST_ROWS[2]!]: 40,
      [LIST_ROWS[3]!]: 30,
      [LIST_ROWS[4]!]: 20,
      [LIST_ROWS[5]!]: 10,
    });
  });
});
