import { MoveInListResult } from "../../../Types/Database/MoveInList";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
import { getJestSpyOn } from "../../Spy";
import { memberProps, rejectionOf } from "./ContiguousOrderCases";
import {
  LIST_ORDER_CASES,
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
 * A WRITE OF A DRAG-ORDERED LIST'S ROW CHANGES THAT ROW; A MOVE IS ITS OWN
 * REQUEST (issue #9609).
 *
 * Every model marked @ListOrderColumn, through its own service over an
 * in-memory table, hooks and permission checks included:
 *
 *   - a row given the number another row holds takes it, and no other row
 *     of either project moves;
 *   - a row is moved by POST <list>/:id/move (DatabaseService.moveInList):
 *     it takes the place of the row named, the rows between step one place
 *     towards where it was, and the list is numbered from scratch - 1..n
 *     from the top, or n..1 for the two lists whose top is the highest
 *     number - in one transaction that holds the list's rows;
 *   - a move is refused to whoever may not change the row's number, for a
 *     row of another project, and to the place of a row of another list,
 *     and nothing is written;
 *   - two moves at once run one after the other;
 *   - the service hears of the rows a move renumbered, as a write of their
 *     numbers tells it (onUpdateSuccess): caches read again, reminders
 *     worked out again.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ROW_A: string = "1d000000-0000-4000-8000-0000000000a1";
const ROW_B: string = "1d000000-0000-4000-8000-0000000000a2";
const ROW_C: string = "1d000000-0000-4000-8000-0000000000a3";
const ROW_X: string = "1d000000-0000-4000-8000-0000000000b1";
const ROW_Y: string = "1d000000-0000-4000-8000-0000000000b2";

const viewerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.Viewer]);
  };

// An owner of another project, asking in their own.
const strangerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
  };

/*
 * The number of the row at `position` (1 = the top) of a list of three
 * numbered from scratch: 1, 2, 3 from the top - or 3, 2, 1 for a list
 * whose top is its highest number.
 */
function numberAt(listOrderCase: ListOrderCase, position: number): number {
  return listOrderCase.sortOrder === SortOrder.Descending
    ? 4 - position
    : position;
}

async function moveInList(
  listOrderCase: ListOrderCase,
  data: {
    id: string;
    placeOfId: string;
    props: DatabaseCommonInteractionProps;
  },
): Promise<MoveInListResult> {
  return await listOrderCase.service.moveInList({
    id: new ObjectID(data.id),
    placeOfId: new ObjectID(data.placeOfId),
    props: data.props,
  });
}

describe.each(LIST_ORDER_CASES)("$label", (listOrderCase: ListOrderCase) => {
  let table: InMemoryTable;
  let transactions: ListMoveTransactions;

  // A, B, C from the top of the list; X, Y in another project's.
  const startingNumbers: () => Record<string, number> = (): Record<
    string,
    number
  > => {
    return {
      [ROW_A]: numberAt(listOrderCase, 1),
      [ROW_B]: numberAt(listOrderCase, 2),
      [ROW_C]: numberAt(listOrderCase, 3),
    };
  };

  const otherList: () => Record<string, number> = (): Record<
    string,
    number
  > => {
    return {
      [ROW_X]: numberAt(listOrderCase, 1),
      [ROW_Y]: numberAt(listOrderCase, 2),
    };
  };

  const listNumbers: () => Record<string, number> = (): Record<
    string,
    number
  > => {
    return numbersById({ table, listOrderCase });
  };

  const otherListNumbers: () => Record<string, number> = (): Record<
    string,
    number
  > => {
    return numbersById({
      table,
      listOrderCase,
      listId: OTHER_LIST_ID,
      projectId: OTHER_PROJECT_ID,
    });
  };

  beforeEach(() => {
    table = useInMemoryTable(listOrderCase.service, [
      rowInList({
        listOrderCase,
        id: ROW_A,
        order: numberAt(listOrderCase, 1),
      }),
      rowInList({
        listOrderCase,
        id: ROW_B,
        order: numberAt(listOrderCase, 2),
      }),
      rowInList({
        listOrderCase,
        id: ROW_C,
        order: numberAt(listOrderCase, 3),
      }),
      rowInList({
        listOrderCase,
        id: ROW_X,
        order: numberAt(listOrderCase, 1),
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
      rowInList({
        listOrderCase,
        id: ROW_Y,
        order: numberAt(listOrderCase, 2),
        listId: OTHER_LIST_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);
    useInMemoryHookFreeWrites({ service: listOrderCase.service, table });
    transactions = useInMemoryListMoves({
      service: listOrderCase.service,
      table: table,
    });
    listOrderCase.stubCollaborators();
  });

  describe("a write of the number", () => {
    test("a row given the number another row holds takes it, and no other row moves", async () => {
      await listOrderCase.service.updateOneById({
        id: new ObjectID(ROW_C),
        data: { [listOrderCase.column]: numberAt(listOrderCase, 1) } as never,
        props: adminProps(),
      });

      expect(listNumbers()).toEqual({
        ...startingNumbers(),
        [ROW_C]: numberAt(listOrderCase, 1),
      });
      expect(otherListNumbers()).toEqual(otherList());
      expect(transactions.opened).toBe(0);
    });

    test("rows given each other's numbers, one write each, end at the numbers written", async () => {
      await listOrderCase.service.updateOneById({
        id: new ObjectID(ROW_A),
        data: { [listOrderCase.column]: numberAt(listOrderCase, 3) } as never,
        props: adminProps(),
      });
      await listOrderCase.service.updateOneById({
        id: new ObjectID(ROW_C),
        data: { [listOrderCase.column]: numberAt(listOrderCase, 1) } as never,
        props: adminProps(),
      });

      expect(listNumbers()).toEqual({
        [ROW_A]: numberAt(listOrderCase, 3),
        [ROW_B]: numberAt(listOrderCase, 2),
        [ROW_C]: numberAt(listOrderCase, 1),
      });
    });
  });

  describe("a move", () => {
    test("the bottom row moved to the top row's place: the rows it passes step down, the list numbered from scratch", async () => {
      const result: MoveInListResult = await moveInList(listOrderCase, {
        id: ROW_C,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(listNumbers()).toEqual({
        [ROW_C]: numberAt(listOrderCase, 1),
        [ROW_A]: numberAt(listOrderCase, 2),
        [ROW_B]: numberAt(listOrderCase, 3),
      });
      expect(result.changedRows).toEqual([
        { id: ROW_C, order: numberAt(listOrderCase, 1) },
        { id: ROW_A, order: numberAt(listOrderCase, 2) },
        { id: ROW_B, order: numberAt(listOrderCase, 3) },
      ]);
      expect(otherListNumbers()).toEqual(otherList());
    });

    test("the top row moved to the next one's place swaps them, and the bottom row is not written", async () => {
      await moveInList(listOrderCase, {
        id: ROW_A,
        placeOfId: ROW_B,
        props: adminProps(),
      });

      expect(listNumbers()).toEqual({
        [ROW_B]: numberAt(listOrderCase, 1),
        [ROW_A]: numberAt(listOrderCase, 2),
        [ROW_C]: numberAt(listOrderCase, 3),
      });
      expect(
        table.updates
          .map((update: { id: string }): string => {
            return update.id;
          })
          .sort(),
      ).toEqual([ROW_A, ROW_B].sort());
    });

    test("a row moved to its own place writes nothing", async () => {
      const result: MoveInListResult = await moveInList(listOrderCase, {
        id: ROW_B,
        placeOfId: ROW_B,
        props: adminProps(),
      });

      expect(result.changedRows).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(listNumbers()).toEqual(startingNumbers());
    });

    /*
     * A list written through the API can have gaps, and twins until every
     * write of an apply has landed. A move goes by the order the list is
     * read in - by number from the top, twins by id - and leaves it
     * numbered from scratch.
     */
    test("a move in a list with gaps and twins lands where it was dropped, the list numbered from scratch", async () => {
      const descending: boolean =
        listOrderCase.sortOrder === SortOrder.Descending;

      // Read as A, B (twins, by id), then C - far below them.
      table.get(ROW_A)![listOrderCase.column] = descending ? 50 : 10;
      table.get(ROW_B)![listOrderCase.column] = descending ? 50 : 10;
      table.get(ROW_C)![listOrderCase.column] = descending ? -40 : 90;

      await moveInList(listOrderCase, {
        id: ROW_C,
        placeOfId: ROW_B,
        props: adminProps(),
      });

      expect(listNumbers()).toEqual({
        [ROW_A]: numberAt(listOrderCase, 1),
        [ROW_C]: numberAt(listOrderCase, 2),
        [ROW_B]: numberAt(listOrderCase, 3),
      });
    });

    test("the place of a row of another list is refused, and nothing moves", async () => {
      const error: unknown = await rejectionOf(
        moveInList(listOrderCase, {
          id: ROW_C,
          placeOfId: ROW_X,
          props: adminProps(),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(table.updates).toEqual([]);
      expect(listNumbers()).toEqual(startingNumbers());
      expect(otherListNumbers()).toEqual(otherList());
    });

    test("a member who may only look is refused, and nothing moves", async () => {
      const error: unknown = await rejectionOf(
        moveInList(listOrderCase, {
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
        moveInList(listOrderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: strangerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(transactions.opened).toBe(0);
      expect(table.updates).toEqual([]);
      expect(listNumbers()).toEqual(startingNumbers());
    });

    test("a row deleted before its move is told it is not found, and nothing moves", async () => {
      table.rows = table.rows.filter((row: StoredRow): boolean => {
        return row["_id"] !== ROW_C;
      });

      const error: unknown = await rejectionOf(
        moveInList(listOrderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: adminProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(table.updates).toEqual([]);
    });

    test("two moves at once run one after the other, and leave every number its own", async () => {
      await Promise.all([
        moveInList(listOrderCase, {
          id: ROW_C,
          placeOfId: ROW_A,
          props: adminProps(),
        }),
        moveInList(listOrderCase, {
          id: ROW_A,
          placeOfId: ROW_B,
          props: adminProps(),
        }),
      ]);

      expect(transactions.opened).toBe(2);
      expect(Object.values(listNumbers()).sort()).toEqual(
        [1, 2, 3]
          .map((position: number) => {
            return numberAt(listOrderCase, position);
          })
          .sort(),
      );
    });

    test("reads and writes the list in one transaction that locks its rows, by the list's own column", async () => {
      await moveInList(listOrderCase, {
        id: ROW_C,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(transactions.opened).toBe(1);
      expect(transactions.statements).toHaveLength(2);
      expect(transactions.statements[0]).toContain("FOR UPDATE");
      expect(transactions.statements[0]).toContain(
        `SELECT "_id", "${listOrderCase.column}" FROM`,
      );
      expect(transactions.statements[0]).toContain('"projectId"');

      for (const column of listOrderCase.scopeColumns) {
        expect(transactions.statements[0]).toContain(`"${column}"`);
      }

      expect(transactions.statements[1]).toContain(
        `SET "${listOrderCase.column}" = "moved"."order"`,
      );
    });

    test("the service hears of the rows the move gave another number, as a write of their numbers tells it", async () => {
      const heard: jest.SpyInstance = getJestSpyOn(
        listOrderCase.service,
        "onUpdateSuccess",
      );

      await moveInList(listOrderCase, {
        id: ROW_C,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(heard).toHaveBeenCalledTimes(1);
      expect(
        (heard.mock.calls[0]![1] as Array<ObjectID>)
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .sort(),
      ).toEqual([ROW_A, ROW_B, ROW_C].sort());
    });

    test("a move that changes nothing tells the service nothing", async () => {
      const heard: jest.SpyInstance = getJestSpyOn(
        listOrderCase.service,
        "onUpdateSuccess",
      );

      await moveInList(listOrderCase, {
        id: ROW_A,
        placeOfId: ROW_A,
        props: adminProps(),
      });

      expect(heard).not.toHaveBeenCalled();
    });
  });
});
