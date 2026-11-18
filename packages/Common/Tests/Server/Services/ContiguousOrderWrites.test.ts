import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MoveInListResult } from "../../../Types/Database/MoveInList";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  ListMoveTransactions,
  useInMemoryListMoves,
} from "../TestingUtils/ListMovesInMemory";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  EMPTY_LIST_ID,
  LIST_ID,
  ORDER_CASES,
  OTHER_LIST_ID,
  OrderCase,
  PROJECT_ID,
  ROW_A,
  ROW_B,
  ROW_C,
  ROW_X,
  ROW_Y,
  adminProps,
  nameApart,
  newRow,
  orderOf,
  rejectionOf,
  startingRows,
  strangerProps,
  viewerProps,
} from "./ContiguousOrderCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A WRITE OF A NUMBERED LIST'S ROW CHANGES THAT ROW; A MOVE IS ITS OWN
 * REQUEST (issue #9573).
 *
 * The escalation rules of an on-call policy, the layers of a schedule, the
 * users of a layer, the groups of a status page and the resources of a status
 * page are numbered by `order` (ContiguousOrder). A row created at a number
 * keeps it, a row given another number takes it, a deleted row leaves its
 * gap - and none of them moves another row: Terraform numbers a whole list
 * one write per row, all at once, and must find every row at the number it
 * wrote (ContiguousOrderConverges). A row created without a number goes
 * after the last row of its list.
 *
 * Moving a row to another's place - what the Dashboard sends for a drag, or
 * Move up and Move down - is moveInList: the rows between the two places
 * step one place towards where it was, and the list is numbered 1..n, in
 * one transaction that holds the list's rows (ListMovesInMemory answers it
 * here). The caller must be allowed to change the row's order.
 *
 * These drive the real create, updateOneById, deleteOneById and moveInList
 * of each service, hooks and permission checks included, over an in-memory
 * table with a list of three in this project and a list of two in another
 * project.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

// The service's move, as the API calls it.
async function moveInList(
  orderCase: OrderCase,
  data: {
    id: string;
    placeOfId: string;
    props: DatabaseCommonInteractionProps;
  },
): Promise<MoveInListResult> {
  return await (
    orderCase.service as unknown as {
      moveInList: (data: {
        id: ObjectID;
        placeOfId: ObjectID;
        props: DatabaseCommonInteractionProps;
      }) => Promise<MoveInListResult>;
    }
  ).moveInList({
    id: new ObjectID(data.id),
    placeOfId: new ObjectID(data.placeOfId),
    props: data.props,
  });
}

describe.each(ORDER_CASES)("$label", (orderCase: OrderCase) => {
  let table: InMemoryTable;
  let transactions: ListMoveTransactions;

  const untouchedList: Array<[string, number]> = [
    [ROW_A, 1],
    [ROW_B, 2],
    [ROW_C, 3],
  ];
  const untouchedOtherList: Array<[string, number]> = [
    [ROW_X, 1],
    [ROW_Y, 2],
  ];

  beforeEach(() => {
    table = useInMemoryTable(orderCase.service, startingRows(orderCase));
    transactions = useInMemoryListMoves({
      service: orderCase.service,
      table: table,
    });
    orderCase.stubCollaborators();
    stubProjectDirectory({});
  });

  function creatorFor(row: BaseModel): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps = orderCase.creatorProps();

    if (props.isRoot) {
      (row as unknown as StoredRow)["projectId"] = PROJECT_ID;
    }

    return props;
  }

  describe("create", () => {
    test("a row created at a number another row holds keeps it, and no other row moves", async () => {
      const row: BaseModel = newRow(orderCase, 2);

      const created: BaseModel = await orderCase.service.create({
        data: row,
        props: creatorFor(row),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual(
        [
          [ROW_A, 1],
          [created.id!.toString(), 2],
          [ROW_B, 2],
          [ROW_C, 3],
        ].sort((a: Array<unknown>, b: Array<unknown>): number => {
          if (a[1] !== b[1]) {
            return (a[1] as number) - (b[1] as number);
          }

          return String(a[0]) < String(b[0]) ? -1 : 1;
        }),
      );
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a row created without a number goes after the last row of its list", async () => {
      const row: BaseModel = newRow(orderCase, undefined);

      const created: BaseModel = await orderCase.service.create({
        data: row,
        props: creatorFor(row),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        ...untouchedList,
        [created.id!.toString(), 4],
      ]);
      expect(table.updates).toEqual([]);
    });

    /*
     * A deleted row leaves its gap, so a list of three can be numbered 1, 2
     * and 7: the new row goes after the last, never at 4 among them - nor at
     * 3, where counting the rows put it.
     */
    test("a row created without a number goes after the last row even when the list has gaps", async () => {
      table.get(ROW_B)!["order"] = 3;
      table.get(ROW_C)!["order"] = 7;

      const row: BaseModel = newRow(orderCase, undefined);

      const created: BaseModel = await orderCase.service.create({
        data: row,
        props: creatorFor(row),
      });

      expect(table.get(created.id!.toString())?.["order"]).toBe(8);
      expect(table.updates).toEqual([]);
    });

    test("the first row of an empty list is 1", async () => {
      const row: BaseModel = newRow(orderCase, undefined, EMPTY_LIST_ID);

      const created: BaseModel = await orderCase.service.create({
        data: row,
        props: creatorFor(row),
      });

      expect(orderOf(table, orderCase, EMPTY_LIST_ID)).toEqual([
        [created.id!.toString(), 1],
      ]);
    });

    /*
     * Terraform creates a list's rows in parallel, in no set order, each at
     * the place its configuration gives it
     * (OneUptime/terraform-provider-oneuptime#12).
     */
    test("rows created out of order, each at its number, keep their numbers", async () => {
      const second: BaseModel = nameApart(
        newRow(orderCase, 2, EMPTY_LIST_ID),
        "second",
      );
      const first: BaseModel = nameApart(
        newRow(orderCase, 1, EMPTY_LIST_ID),
        "first",
      );

      const createdSecond: BaseModel = await orderCase.service.create({
        data: second,
        props: creatorFor(second),
      });
      const createdFirst: BaseModel = await orderCase.service.create({
        data: first,
        props: creatorFor(first),
      });

      expect(orderOf(table, orderCase, EMPTY_LIST_ID)).toEqual([
        [createdFirst.id!.toString(), 1],
        [createdSecond.id!.toString(), 2],
      ]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
    });

    test("a member who may only look is refused, and nothing is written", async () => {
      const error: unknown = await rejectionOf(
        orderCase.service.create({
          data: newRow(orderCase, 2),
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(table.inserts).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
    });

    test("a create whose save fails writes nothing", async () => {
      table.repository.save.mockImplementationOnce(async () => {
        throw new Error("the save failed");
      });

      const row: BaseModel = newRow(orderCase, 2);

      await expect(
        orderCase.service.create({ data: row, props: creatorFor(row) }),
      ).rejects.toThrow("the save failed");

      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
    });
  });

  describe("update", () => {
    test("a row given the number another row holds takes it, and no other row moves", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_C),
        data: { order: 1 } as never,
        props: adminProps(),
      });

      expect(
        table.updates.map((update: { id: string }): string => {
          return update.id;
        }),
      ).toEqual([ROW_C]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 1],
        [ROW_B, 2],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a row given a number past the end takes it, and no other row moves", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_A),
        data: { order: 9 } as never,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_B, 2],
        [ROW_C, 3],
        [ROW_A, 9],
      ]);
      expect(table.updates).toHaveLength(1);
    });

    test("rows given each other's numbers, one write each, end at the numbers written", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_A),
        data: { order: 3 } as never,
        props: adminProps(),
      });
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_C),
        data: { order: 1 } as never,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_C, 1],
        [ROW_B, 2],
        [ROW_A, 3],
      ]);
    });

    test("an owner of another project naming this project's row writes nothing in either project", async () => {
      const updated: number = await orderCase.service.updateOneById({
        id: new ObjectID(ROW_B),
        data: { order: 1 } as never,
        props: strangerProps(),
      });

      expect(updated).toBe(0);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a member who may only look is refused, and nothing is written", async () => {
      const error: unknown = await rejectionOf(
        orderCase.service.updateOneById({
          id: new ObjectID(ROW_C),
          data: { order: 1 } as never,
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(table.updates).toEqual([]);
    });
  });

  describe("delete", () => {
    test("a deleted row leaves its gap: the rows after it keep their numbers", async () => {
      await orderCase.service.deleteOneById({
        id: new ObjectID(ROW_B),
        props: adminProps(),
      });

      expect(table.deletes).toEqual([ROW_B]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 3],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("an owner of another project naming this project's row deletes and writes nothing", async () => {
      await orderCase.service.deleteOneById({
        id: new ObjectID(ROW_B),
        props: strangerProps(),
      });

      expect(table.deletes).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });
  });

  describe("move", () => {
    test("the last row moved to the first's place: the rows it passes step down", async () => {
      const result: MoveInListResult = await moveInList(orderCase, {
        id: ROW_C,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_C, 1],
        [ROW_A, 2],
        [ROW_B, 3],
      ]);
      expect(result.changedRows).toEqual([
        { id: ROW_C, order: 1 },
        { id: ROW_A, order: 2 },
        { id: ROW_B, order: 3 },
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("the top row moved to the last's place: only the rows it passes step up", async () => {
      await moveInList(orderCase, {
        id: ROW_A,
        placeOfId: ROW_C,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_B, 1],
        [ROW_C, 2],
        [ROW_A, 3],
      ]);
    });

    test("the middle row moved to the next's place swaps them, and the top row is not written", async () => {
      const result: MoveInListResult = await moveInList(orderCase, {
        id: ROW_B,
        placeOfId: ROW_C,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 2],
        [ROW_B, 3],
      ]);
      expect(
        table.updates
          .map((update: { id: string }): string => {
            return update.id;
          })
          .sort(),
      ).toEqual([ROW_B, ROW_C].sort());
      expect(result.changedRows).toHaveLength(2);
    });

    test("a row moved to its own place writes nothing", async () => {
      const result: MoveInListResult = await moveInList(orderCase, {
        id: ROW_B,
        placeOfId: ROW_B,
        props: adminProps(),
      });

      expect(result.changedRows).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
    });

    /*
     * A list written through the API can have gaps, and twins until every
     * write has landed. A move goes by the order the list is read in - by
     * number, twins by id - and leaves it numbered 1..n.
     */
    test("a move in a list with gaps and twins lands where it was dropped, and numbers the list 1..n", async () => {
      table.get(ROW_B)!["order"] = 1;
      table.get(ROW_C)!["order"] = 9;

      // Read as A, B (twins at 1, by id), then C at 9.
      await moveInList(orderCase, {
        id: ROW_C,
        placeOfId: ROW_B,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 2],
        [ROW_B, 3],
      ]);
    });

    test("the place of a row of another list is refused, and nothing moves", async () => {
      const error: unknown = await rejectionOf(
        moveInList(orderCase, {
          id: ROW_C,
          placeOfId: ROW_X,
          props: adminProps(),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a member who may only look is refused, and nothing moves", async () => {
      const error: unknown = await rejectionOf(
        moveInList(orderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(transactions.opened).toBe(0);
      expect(table.updates).toEqual([]);
    });

    test("an owner of another project naming this project's row is told it is not found, and nothing moves", async () => {
      const error: unknown = await rejectionOf(
        moveInList(orderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: strangerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(transactions.opened).toBe(0);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual(untouchedList);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a row deleted before its move is told it is not found, and nothing moves", async () => {
      table.rows = table.rows.filter((row: StoredRow): boolean => {
        return row["_id"] !== ROW_C;
      });

      const error: unknown = await rejectionOf(
        moveInList(orderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: adminProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(table.updates).toEqual([]);
    });

    /*
     * The move reads and writes its list in one transaction that holds the
     * list's rows: two at once run one after the other, the second on the
     * list as the first left it - never two rows at one number.
     */
    test("two moves at once run one after the other, and leave the list numbered 1..n", async () => {
      await Promise.all([
        moveInList(orderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: adminProps(),
        }),
        moveInList(orderCase, {
          id: ROW_A,
          placeOfId: ROW_B,
          props: adminProps(),
        }),
      ]);

      expect(transactions.opened).toBe(2);

      const orders: Array<number> = orderOf(table, orderCase, LIST_ID).map(
        (entry: [string, number]): number => {
          return entry[1];
        },
      );

      expect(orders).toEqual([1, 2, 3]);
    });

    test("reads and writes the list in one transaction that locks its rows", async () => {
      await moveInList(orderCase, {
        id: ROW_C,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(transactions.opened).toBe(1);
      expect(transactions.statements).toHaveLength(2);
      expect(transactions.statements[0]).toContain("FOR UPDATE");
      expect(transactions.statements[0]).toContain(`"${orderCase.listColumn}"`);
      expect(transactions.statements[0]).toContain('"projectId"');
      expect(transactions.statements[1]).toMatch(/^UPDATE /);
    });
  });
});
