import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  EMPTY_LIST_ID,
  LIST_ID,
  ORDER_CASES,
  OTHER_LIST_ID,
  OTHER_PROJECT_ID,
  OrderCase,
  PROJECT_ID,
  ROW_X,
  ROW_Y,
  adminProps,
  nameApart,
  newRow,
  orderOf,
  ordersById,
  rowInList,
} from "./ContiguousOrderCases";
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
 * A WHOLE LIST NUMBERED AT ONCE ENDS UP NUMBERED AS WRITTEN (issue #9573).
 *
 * Terraform, and anything else that manages a list declaratively, writes
 * each row's `order` on its own: the rows whose number changed, all at
 * once, in no set order. When a write of `order` was taken as a move - the
 * rows it passed stepped aside - each write renumbered rows another write
 * had just placed. The apply succeeded, the next plan found new
 * differences, duplicates and zeros among them, and applying again never
 * settled. Even one write at a time could not settle it: moves made in
 * some orders end somewhere else than the numbers written.
 *
 * Here each of the five numbered lists is numbered as a configuration
 * numbers it - every changed row written at once, in a shuffled order -
 * through the real updateOneById, create and deleteOneById of its service,
 * hooks and permission checks included, over an in-memory table. Every row
 * must end at the number written, and no row of another list may move.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The rows of the list under test: six, at 1..6 to begin with.
const LIST_ROWS: Array<string> = [
  "1c000000-0000-4000-8000-0000000000d1",
  "1c000000-0000-4000-8000-0000000000d2",
  "1c000000-0000-4000-8000-0000000000d3",
  "1c000000-0000-4000-8000-0000000000d4",
  "1c000000-0000-4000-8000-0000000000d5",
  "1c000000-0000-4000-8000-0000000000d6",
];

/*
 * The numberings a configuration gives the six rows (a number per row, in
 * LIST_ROWS's order) and the orders their writes land in (ListNumberings).
 */
const NUMBERINGS: ReadonlyArray<ListNumbering> = NUMBERINGS_OF_SIX;

function creatorFor(
  orderCase: OrderCase,
  row: BaseModel,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = orderCase.creatorProps();

  if (props.isRoot) {
    (row as unknown as StoredRow)["projectId"] = PROJECT_ID;
  }

  return props;
}

describe.each(ORDER_CASES)("$label", (orderCase: OrderCase) => {
  let table: InMemoryTable;

  const otherList: Array<[string, number]> = [
    [ROW_X, 1],
    [ROW_Y, 2],
  ];

  beforeEach(() => {
    table = useInMemoryTable(orderCase.service, [
      ...LIST_ROWS.map((id: string, index: number): StoredRow => {
        return rowInList({ orderCase, id, order: index + 1 });
      }),
      rowInList({
        orderCase,
        id: ROW_X,
        order: 1,
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
      rowInList({
        orderCase,
        id: ROW_Y,
        order: 2,
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);
    orderCase.stubCollaborators();
  });

  describe.each([...NUMBERINGS])(
    "numbering the list $name",
    (numbering: ListNumbering) => {
      test.each([...WRITE_SEEDS])(
        "every changed row written at once, shuffled (seed %i), ends at its number",
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

          await Promise.all(
            shuffled(writes, seed).map(
              async (write: { id: string; order: number }): Promise<void> => {
                await orderCase.service.updateOneById({
                  id: new ObjectID(write.id),
                  data: { order: write.order } as never,
                  props: adminProps(),
                });
              },
            ),
          );

          expect(ordersById(table, orderCase, LIST_ID)).toEqual(expected);
          expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(otherList);
        },
      );
    },
  );

  /*
   * Adding a row in the middle renumbers the rows after it: a create and
   * an update of each of them, all at once.
   */
  test.each([...WRITE_SEEDS])(
    "a row added in the middle, and the rows after it renumbered, all at once (seed %i)",
    async (seed: number) => {
      const added: BaseModel = nameApart(newRow(orderCase, 3), "added");
      const createdIds: Array<string> = [];

      const writes: Array<() => Promise<void>> = [
        async (): Promise<void> => {
          const created: BaseModel = await orderCase.service.create({
            data: added,
            props: creatorFor(orderCase, added),
          });

          createdIds.push(created.id!.toString());
        },
        ...LIST_ROWS.slice(2).map((id: string, index: number) => {
          return async (): Promise<void> => {
            await orderCase.service.updateOneById({
              id: new ObjectID(id),
              data: { order: index + 4 } as never,
              props: adminProps(),
            });
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
      expect(ordersById(table, orderCase, LIST_ID)).toEqual({
        [LIST_ROWS[0]!]: 1,
        [LIST_ROWS[1]!]: 2,
        [createdIds[0]!]: 3,
        [LIST_ROWS[2]!]: 4,
        [LIST_ROWS[3]!]: 5,
        [LIST_ROWS[4]!]: 6,
        [LIST_ROWS[5]!]: 7,
      });
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(otherList);
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
          await orderCase.service.deleteOneById({
            id: new ObjectID(LIST_ROWS[2]!),
            props: adminProps(),
          });
        },
        ...LIST_ROWS.slice(3).map((id: string, index: number) => {
          return async (): Promise<void> => {
            await orderCase.service.updateOneById({
              id: new ObjectID(id),
              data: { order: index + 3 } as never,
              props: adminProps(),
            });
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

      expect(ordersById(table, orderCase, LIST_ID)).toEqual({
        [LIST_ROWS[0]!]: 1,
        [LIST_ROWS[1]!]: 2,
        [LIST_ROWS[3]!]: 3,
        [LIST_ROWS[4]!]: 4,
        [LIST_ROWS[5]!]: 5,
      });
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(otherList);
    },
  );

  /*
   * The issue's own steps: rows created at once without an order, numbered
   * by the server however the creates landed, then given the numbers a
   * sorted configuration gives them - the rows whose number differs
   * written at once.
   */
  test("rows created without an order, then numbered by a configuration, end at their numbers", async () => {
    const names: Array<string> = ["G1", "C1", "R1"];
    const createdByName: Record<string, string> = {};

    await Promise.all(
      names.map(async (name: string): Promise<void> => {
        const row: BaseModel = nameApart(
          newRow(orderCase, undefined, EMPTY_LIST_ID),
          name,
        );

        const created: BaseModel = await orderCase.service.create({
          data: row,
          props: creatorFor(orderCase, row),
        });

        createdByName[name] = created.id!.toString();
      }),
    );

    const configured: Array<string> = [...names].sort();
    const numberedByServer: Record<string, number> = ordersById(
      table,
      orderCase,
      EMPTY_LIST_ID,
    );

    await Promise.all(
      configured.map(async (name: string, index: number): Promise<void> => {
        const id: string = createdByName[name]!;

        if (numberedByServer[id] === index + 1) {
          return;
        }

        await orderCase.service.updateOneById({
          id: new ObjectID(id),
          data: { order: index + 1 } as never,
          props: adminProps(),
        });
      }),
    );

    expect(ordersById(table, orderCase, EMPTY_LIST_ID)).toEqual({
      [createdByName["C1"]!]: 1,
      [createdByName["G1"]!]: 2,
      [createdByName["R1"]!]: 3,
    });
  });
});
