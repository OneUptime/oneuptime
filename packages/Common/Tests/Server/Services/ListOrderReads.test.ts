import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../../Server/Types/Database/Query";
import Sort from "../../../Server/Types/Database/Sort";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { ListOrderItem, sortListOrderItems } from "../../../Utils/ListOrder";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  LIST_ORDER_CASES,
  ListOrderCase,
  createdAtOf,
  listColumnsOf,
  listRow,
} from "./ListOrderCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A DRAG-ORDERED LIST IS READ THE WAY IT IS SHOWN (issue #9654).
 *
 * Every list people put in order by dragging (@ListOrderColumn) is shown
 * top first, two rows at one number the older first (Common/Utils/
 * ListOrder). A read that asked for no order used to come back newest
 * first, so "the project's created state" - a lookup by its flag alone -
 * was the newest created state, wherever it stood in the list, and a read
 * by the number alone put two rows at one number by id. Here every such
 * list's real service reads an in-memory table of rows with twins and gaps,
 * saved in no order, through DatabaseService.getReadSort:
 *
 *   - in no order: top first, twins the older first;
 *   - by its number: the same, either way the list counts;
 *   - by its number from the bottom up (the least severe severity): the
 *     exact reverse, so the first row read is the last one shown;
 *   - in any other order: as asked.
 */

/*
 * Six rows of the list: twins at 2 and 5, gaps between, created out of
 * order. Of the twins at 2 the higher id is the older, and of those at 5
 * the newer, so the order of their ids is not the order the list shows
 * them in, read from the top or from the bottom; and the newest row is not
 * at the top.
 */
const ROWS: Array<{ id: string; order: number; n: number }> = [
  { id: "9d000000-0000-4000-8000-0000000000e1", order: 2, n: 6 },
  { id: "9d000000-0000-4000-8000-0000000000e2", order: 5, n: 1 },
  { id: "9d000000-0000-4000-8000-0000000000e3", order: 2, n: 4 },
  { id: "9d000000-0000-4000-8000-0000000000e4", order: 9, n: 2 },
  { id: "9d000000-0000-4000-8000-0000000000e5", order: 5, n: 3 },
  { id: "9d000000-0000-4000-8000-0000000000e6", order: 1, n: 5 },
];

// A row of another project's list, which no read of this one returns.
const OTHER_ROW_ID: string = "9d000000-0000-4000-8000-0000000000f1";

function startingRows(listCase: ListOrderCase): Array<StoredRow> {
  return [
    ...ROWS.map((row: { id: string; order: number; n: number }): StoredRow => {
      return listRow({
        listCase: listCase,
        id: row.id,
        order: row.order,
        n: row.n,
      });
    }),
    listRow({
      listCase: listCase,
      id: OTHER_ROW_ID,
      order: 1,
      n: 7,
      isOtherList: true,
    }),
  ];
}

// The list's rows as the list shows them: top first, twins the older first.
function shownOrder(listCase: ListOrderCase): Array<string> {
  return sortListOrderItems(
    ROWS.map((row: { id: string; order: number; n: number }): ListOrderItem => {
      return { id: row.id, value: row.order, createdAt: createdAtOf(row.n) };
    }),
    listCase.settings.sortOrder,
  ).map((item: ListOrderItem): string => {
    return item.id;
  });
}

// The query that names the list under test, as a service is asked it.
function listQuery(listCase: ListOrderCase): Query<BaseModel> {
  const model: BaseModel = listCase.service.getModel();
  const query: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(listColumnsOf(listCase))) {
    query[column] =
      column === "projectId" ||
      model.getTableColumnMetadata(column)?.type === TableColumnType.ObjectID
        ? new ObjectID(String(value))
        : value;
  }

  return query as Query<BaseModel>;
}

function opposite(sortOrder: SortOrder): SortOrder {
  return sortOrder === SortOrder.Ascending
    ? SortOrder.Descending
    : SortOrder.Ascending;
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(LIST_ORDER_CASES)("$label", (listCase: ListOrderCase) => {
  let table: InMemoryTable;

  beforeEach(() => {
    table = useInMemoryTable(listCase.service, startingRows(listCase));
    listCase.stubCollaborators?.();
  });

  async function read(sort?: Record<string, unknown>): Promise<Array<string>> {
    const rows: Array<BaseModel> = await listCase.service.findBy({
      query: listQuery(listCase),
      select: { _id: true },
      ...(sort ? { sort: sort as Sort<BaseModel> } : {}),
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

    return rows.map((row: BaseModel): string => {
      return row._id!.toString();
    });
  }

  test("asked for no order, reads the list as it is shown: the top first, twins the older first", async () => {
    expect(await read()).toEqual(shownOrder(listCase));
  });

  test("asked for its number, reads two rows at one number the older first, as the list shows them", async () => {
    expect(
      await read({ [listCase.settings.column]: listCase.settings.sortOrder }),
    ).toEqual(shownOrder(listCase));
  });

  test("asked for its number from the bottom up, reads the list exactly in reverse", async () => {
    expect(
      await read({
        [listCase.settings.column]: opposite(listCase.settings.sortOrder),
      }),
    ).toEqual([...shownOrder(listCase)].reverse());
  });

  test("finds the top of the list when it asks for one row in no order", async () => {
    const found: BaseModel | null = await listCase.service.findOneBy({
      query: listQuery(listCase),
      select: { _id: true },
      props: { isRoot: true },
    });

    expect(found?._id?.toString()).toBe(shownOrder(listCase)[0]);
  });

  test("reads in another order when it asks for one", async () => {
    const newestFirst: Array<string> = [...ROWS]
      .sort(
        (
          a: { id: string; order: number; n: number },
          b: { id: string; order: number; n: number },
        ): number => {
          return b.n - a.n;
        },
      )
      .map((row: { id: string; order: number; n: number }): string => {
        return row.id;
      });

    expect(await read({ createdAt: SortOrder.Descending })).toEqual(
      newestFirst,
    );
    expect(table.rows).toHaveLength(ROWS.length + 1);
  });
});
