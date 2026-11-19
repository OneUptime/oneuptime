import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  LIST_ORDER_CASES,
  ListOrderCase,
  getCoveredTables,
  listAdminProps,
  listRow,
  newListRow,
  numbersById,
} from "./ListOrderCases";
import {
  ListNumbering,
  NUMBERINGS_OF_SIX,
  WRITE_SEEDS,
  shuffled,
} from "./ListNumberings";
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
 * A WHOLE DRAG-ORDERED LIST NUMBERED AT ONCE ENDS UP NUMBERED AS WRITTEN
 * (issue #9609).
 *
 * Severities, states, monitor statuses, custom fields, rules, pipelines,
 * filters and status page links are lists people put in order by dragging
 * rows (@ListOrderColumn). Terraform, and anything else that manages a list
 * declaratively, writes each row's number on its own: the rows whose number
 * changed, all at once, in no set order. When a write of a number another
 * row held made that row - and the run of rows behind it - step aside, each
 * write moved rows another write had just placed: the apply succeeded, the
 * next plan found new differences, and applying again never settled.
 *
 * Here every one of those lists is numbered as a configuration numbers it -
 * every changed row written at once, in a shuffled order - through the real
 * updateOneById of its service, hooks and permission checks included, over
 * an in-memory table. Every row must end at the number written, and no row
 * of another project's list may move. For a list of each kind, a row is
 * also added in the middle, taken out of the middle, and created without a
 * number before a configuration numbers the list.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The rows of the list under test: six, at 1..6 to begin with.
const LIST_ROWS: Array<string> = [
  "9b000000-0000-4000-8000-0000000000d1",
  "9b000000-0000-4000-8000-0000000000d2",
  "9b000000-0000-4000-8000-0000000000d3",
  "9b000000-0000-4000-8000-0000000000d4",
  "9b000000-0000-4000-8000-0000000000d5",
  "9b000000-0000-4000-8000-0000000000d6",
];

// Another project's list of two, at 1 and 2.
const OTHER_ROWS: Array<string> = [
  "9b000000-0000-4000-8000-0000000000b1",
  "9b000000-0000-4000-8000-0000000000b2",
];

const OTHER_LIST: Record<string, number> = {
  [OTHER_ROWS[0]!]: 1,
  [OTHER_ROWS[1]!]: 2,
};

const NUMBERINGS: ReadonlyArray<ListNumbering> = NUMBERINGS_OF_SIX;

// The lists a suite creates rows of: one of each kind (ListOrderCases).
const CREATING_CASES: Array<ListOrderCase> = LIST_ORDER_CASES.filter(
  (listCase: ListOrderCase): boolean => {
    return Boolean(listCase.newRowData);
  },
);

type ModelType = { new (): BaseModel };

test("every drag-ordered list is a case here", () => {
  const lists: Array<string> = (AllModelTypes as unknown as Array<ModelType>)
    .filter((modelType: ModelType): boolean => {
      return Boolean(new modelType().getListOrder());
    })
    .map((modelType: ModelType): string => {
      return new modelType().tableName || modelType.name;
    })
    .sort();

  expect(getCoveredTables().sort()).toEqual(lists);
  expect(CREATING_CASES.length).toBeGreaterThan(5);
});

async function writeNumber(
  listCase: ListOrderCase,
  id: string,
  value: number,
): Promise<void> {
  await listCase.service.updateOneById({
    id: new ObjectID(id),
    data: { [listCase.settings.column]: value } as never,
    props: listAdminProps(),
  });
}

describe.each(LIST_ORDER_CASES)("$label", (listCase: ListOrderCase) => {
  let table: InMemoryTable;

  beforeEach(() => {
    table = useInMemoryTable(listCase.service, [
      ...LIST_ROWS.map((id: string, index: number): StoredRow => {
        return listRow({ listCase, id, order: index + 1, n: index + 1 });
      }),
      ...OTHER_ROWS.map((id: string, index: number): StoredRow => {
        return listRow({
          listCase,
          id,
          order: index + 1,
          n: index + 1,
          isOtherList: true,
        });
      }),
    ]);
    useInMemoryHookFreeWrites(listCase.service, table);

    listCase.stubCollaborators?.();
  });

  test("a row given the number another row holds takes it, and no other row moves", async () => {
    await writeNumber(listCase, LIST_ROWS[5]!, 1);

    expect(numbersById(table, listCase)).toEqual({
      [LIST_ROWS[0]!]: 1,
      [LIST_ROWS[1]!]: 2,
      [LIST_ROWS[2]!]: 3,
      [LIST_ROWS[3]!]: 4,
      [LIST_ROWS[4]!]: 5,
      [LIST_ROWS[5]!]: 1,
    });
    expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
  });

  describe.each([...NUMBERINGS])(
    "numbering the list $name",
    (numbering: ListNumbering) => {
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

      test.each([...WRITE_SEEDS])(
        "every changed row written at once, shuffled (seed %i), ends at its number",
        async (seed: number) => {
          await Promise.all(
            shuffled(writes, seed).map(
              async (write: { id: string; order: number }): Promise<void> => {
                await writeNumber(listCase, write.id, write.order);
              },
            ),
          );

          expect(numbersById(table, listCase)).toEqual(expected);
          expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
        },
      );

      /*
       * One write after the other, as a provider run with -parallelism=1
       * writes them, or as a server that answers them one at a time lands
       * them: every row still ends at its number.
       */
      test.each([...WRITE_SEEDS])(
        "every changed row written one after another, shuffled (seed %i), ends at its number",
        async (seed: number) => {
          for (const write of shuffled(writes, seed)) {
            await writeNumber(listCase, write.id, write.order);
          }

          expect(numbersById(table, listCase)).toEqual(expected);
          expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
        },
      );
    },
  );
});

describe.each(CREATING_CASES)(
  "$label, rows created and deleted",
  (listCase: ListOrderCase) => {
    let table: InMemoryTable;

    beforeEach(() => {
      table = useInMemoryTable(listCase.service, [
        ...LIST_ROWS.map((id: string, index: number): StoredRow => {
          return listRow({ listCase, id, order: index + 1, n: index + 1 });
        }),
        ...OTHER_ROWS.map((id: string, index: number): StoredRow => {
          return listRow({
            listCase,
            id,
            order: index + 1,
            n: index + 1,
            isOtherList: true,
          });
        }),
      ]);
      useInMemoryHookFreeWrites(listCase.service, table);

      listCase.stubCollaborators?.();
    });

    test("a row created at the number another row holds keeps it, and no other row moves", async () => {
      const created: BaseModel = await listCase.service.create({
        data: newListRow(listCase, 2, "Added"),
        props: listAdminProps(),
      });

      expect(numbersById(table, listCase)).toEqual({
        [LIST_ROWS[0]!]: 1,
        [LIST_ROWS[1]!]: 2,
        [LIST_ROWS[2]!]: 3,
        [LIST_ROWS[3]!]: 4,
        [LIST_ROWS[4]!]: 5,
        [LIST_ROWS[5]!]: 6,
        [created.id!.toString()]: 2,
      });
      expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
    });

    /*
     * Adding a row in the middle renumbers the rows after it: a create and
     * an update of each of them, all at once.
     */
    test.each([...WRITE_SEEDS])(
      "a row added in the middle, and the rows after it renumbered, all at once (seed %i)",
      async (seed: number) => {
        const createdIds: Array<string> = [];

        const writes: Array<() => Promise<void>> = [
          async (): Promise<void> => {
            const created: BaseModel = await listCase.service.create({
              data: newListRow(listCase, 3, "Added"),
              props: listAdminProps(),
            });

            createdIds.push(created.id!.toString());
          },
          ...LIST_ROWS.slice(2).map((id: string, index: number) => {
            return async (): Promise<void> => {
              await writeNumber(listCase, id, index + 4);
            };
          }),
        ];

        await Promise.all(
          shuffled(writes, seed).map(
            async (write: () => Promise<void>): Promise<void> => {
              await write();
            },
          ),
        );

        expect(createdIds).toHaveLength(1);
        expect(numbersById(table, listCase)).toEqual({
          [LIST_ROWS[0]!]: 1,
          [LIST_ROWS[1]!]: 2,
          [createdIds[0]!]: 3,
          [LIST_ROWS[2]!]: 4,
          [LIST_ROWS[3]!]: 5,
          [LIST_ROWS[4]!]: 6,
          [LIST_ROWS[5]!]: 7,
        });
        expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
      },
    );

    /*
     * Taking a row out of the middle renumbers the rows after it: a delete
     * and an update of each of them, all at once.
     */
    test.each([...WRITE_SEEDS])(
      "a row taken out of the middle, and the rows after it renumbered, all at once (seed %i)",
      async (seed: number) => {
        const writes: Array<() => Promise<void>> = [
          async (): Promise<void> => {
            await listCase.service.deleteOneById({
              id: new ObjectID(LIST_ROWS[2]!),
              props: listAdminProps(),
            });
          },
          ...LIST_ROWS.slice(3).map((id: string, index: number) => {
            return async (): Promise<void> => {
              await writeNumber(listCase, id, index + 3);
            };
          }),
        ];

        await Promise.all(
          shuffled(writes, seed).map(
            async (write: () => Promise<void>): Promise<void> => {
              await write();
            },
          ),
        );

        expect(numbersById(table, listCase)).toEqual({
          [LIST_ROWS[0]!]: 1,
          [LIST_ROWS[1]!]: 2,
          [LIST_ROWS[3]!]: 3,
          [LIST_ROWS[4]!]: 4,
          [LIST_ROWS[5]!]: 5,
        });
        expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
      },
    );

    /*
     * Rows created at once without a number, numbered by the server however
     * the creates landed, then given the numbers a sorted configuration
     * gives them - the rows whose number differs written at once.
     */
    test("rows created without a number, then numbered by a configuration, end at their numbers", async () => {
      table.rows = table.rows.filter((row: StoredRow): boolean => {
        return !LIST_ROWS.includes(String(row["_id"]));
      });

      const names: Array<string> = ["G1", "C1", "R1"];
      const createdByName: Record<string, string> = {};

      await Promise.all(
        names.map(async (name: string): Promise<void> => {
          const created: BaseModel = await listCase.service.create({
            data: newListRow(listCase, undefined, name),
            props: listAdminProps(),
          });

          createdByName[name] = created.id!.toString();
        }),
      );

      const configured: Array<string> = [...names].sort();
      const numberedByServer: Record<string, number | null> = numbersById(
        table,
        listCase,
      );

      await Promise.all(
        configured.map(async (name: string, index: number): Promise<void> => {
          const id: string = createdByName[name]!;

          if (numberedByServer[id] === index + 1) {
            return;
          }

          await writeNumber(listCase, id, index + 1);
        }),
      );

      expect(numbersById(table, listCase)).toEqual({
        [createdByName["C1"]!]: 1,
        [createdByName["G1"]!]: 2,
        [createdByName["R1"]!]: 3,
      });
      expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
    });
  },
);
