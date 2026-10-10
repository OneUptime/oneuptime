import DatabaseService from "../../../Server/Services/DatabaseService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Select from "../../../Server/Types/Database/Select";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { meetsCondition } from "../TestingUtils/QueryConditions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * THE ROWS A DELETE REMOVES, READ FOR A HOOK, ARE THE ONLY ROWS IT REMOVES.
 *
 * A service's onBeforeDelete that judges or acts on the rows a delete
 * removes - the feed line naming who was removed, the provider number it
 * releases, the rows it cleans up first, the built-in it refuses to remove -
 * reads them with findRowsAndHoldDeleteToThem. For OneUptime and a master
 * admin, who delete any row, they are the delete's own rows, read by its
 * own query in its window and kept to the request's project as the delete
 * itself is (the first describe below); for anyone else they are the rows
 * the caller may delete - found by the delete path before the hooks, or by
 * the hook itself when the delete reached it some other way - that the
 * delete's query, as its hooks have narrowed it, still names (the second).
 * The delete is then held to the rows read: its query names them, with a
 * window that covers just them, so it can never remove a row the hook did
 * not see - and when the hook read none, it removes none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000d1",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000d2",
);
const ROW_A: string = "5f000000-0000-4000-8000-0000000000d1";
const ROW_B: string = "5f000000-0000-4000-8000-0000000000d2";
const ROW_C: string = "5f000000-0000-4000-8000-0000000000d3";

interface RowsADeleteRemoves {
  findRowsAndHoldDeleteToThem(
    deleteBy: DeleteBy<StatusPageSubscriber>,
    select: Select<StatusPageSubscriber>,
  ): Promise<Array<StatusPageSubscriber>>;
  findOneRowAndHoldDeleteToIt(
    deleteBy: DeleteBy<StatusPageSubscriber>,
    select: Select<StatusPageSubscriber>,
  ): Promise<{ row: StatusPageSubscriber | null; deletesMore: boolean }>;
  keepRowsCallerMayWrite(
    write: DeleteBy<StatusPageSubscriber>,
    type: DatabaseRequestType.Delete,
  ): Promise<boolean>;
}

const SELECT: Select<StatusPageSubscriber> = {
  statusPageId: true,
  isUnsubscribed: true,
};

// A select that reads a relation as well.
const RELATION_SELECT: Select<StatusPageSubscriber> = {
  statusPageId: true,
  statusPageResources: { _id: true },
};

interface Read {
  query: JSONObject | Array<JSONObject>;
  select: JSONObject;
  skip: number;
  limit: number;
  props: JSONObject;
}

function row(id: string): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = id;
  return subscriber;
}

// The ids an `_id` condition names: a plain id, or "any of" several.
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (!value) {
    return [];
  }

  return Object.values(
    (value as { objectLiteralParameters: JSONObject }).objectLiteralParameters,
  ).flat() as Array<string>;
}

// The conditions an And(...) condition holds together, in order.
function partsOf(value: unknown): Array<unknown> {
  const operator: { type?: unknown; value?: unknown } = (value || {}) as {
    type?: unknown;
    value?: unknown;
  };

  return operator.type === "and" && Array.isArray(operator.value)
    ? operator.value
    : [];
}

function deleteOf(data: {
  query?: Query<StatusPageSubscriber>;
  props?: JSONObject;
  skip?: number | PositiveNumber;
  limit?: number | PositiveNumber;
}): DeleteBy<StatusPageSubscriber> {
  return {
    query: data.query || { statusPageId: STATUS_PAGE_ID },
    props: (data.props || {
      isRoot: true,
    }) as unknown as DatabaseCommonInteractionProps,
    skip: data.skip ?? 0,
    limit: data.limit ?? LIMIT_MAX,
  } as DeleteBy<StatusPageSubscriber>;
}

describe("DatabaseService.findRowsAndHoldDeleteToThem - OneUptime's own delete", () => {
  let service: DatabaseService<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let rowsRead: Array<StatusPageSubscriber>;

  function rowsADeleteRemoves(): RowsADeleteRemoves {
    return service as unknown as RowsADeleteRemoves;
  }

  function readWith(): Read {
    expect(findBy).toHaveBeenCalledTimes(1);

    return findBy.mock.calls[0]![0] as Read;
  }

  beforeEach(() => {
    service = new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);
    rowsRead = [row(ROW_A)];

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return rowsRead;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the delete's rows as OneUptime, by the delete's own query, with what the hook asks for and their ids", async () => {
    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteOf({}), SELECT);

    const read: Read = readWith();

    expect(read.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(read.select).toEqual({
      statusPageId: true,
      isUnsubscribed: true,
      _id: true,
    });
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  it("reads in the delete's own window, whether it is given as numbers or PositiveNumbers", async () => {
    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
      deleteOf({ skip: 20000, limit: 15000 }),
      SELECT,
    );

    expect(readWith()).toMatchObject({ skip: 20000, limit: 15000 });

    findBy.mockClear();

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
      deleteOf({ skip: new PositiveNumber(5), limit: new PositiveNumber(7) }),
      SELECT,
    );

    expect(readWith()).toMatchObject({ skip: 5, limit: 7 });
  });

  /*
   * OneUptime's delete, unlike its update, is kept to the project its
   * request names (DeletePermission): the rows read are the rows the delete
   * removes, so a row of another project is neither read nor acted on.
   */
  it("keeps the read to the project the request names, as the delete itself is kept", async () => {
    for (const props of [
      { isRoot: true, tenantId: PROJECT_ID },
      { isMasterAdmin: true, tenantId: PROJECT_ID },
    ]) {
      findBy.mockClear();

      await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
        deleteOf({ props: props }),
        SELECT,
      );

      expect(readWith().query).toEqual({
        statusPageId: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
      });
    }
  });

  it("overrides a project the query names with the request's, as the delete does", async () => {
    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
      deleteOf({
        query: {
          statusPageId: STATUS_PAGE_ID,
          projectId: new ObjectID("5e000000-0000-4000-8000-0000000000ff"),
        } as Query<StatusPageSubscriber>,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
      SELECT,
    );

    expect((readWith().query as JSONObject)["projectId"]).toEqual(PROJECT_ID);
  });

  it("adds nothing to the query of a request that names no project, or one across projects", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true },
      { isRoot: true, tenantId: PROJECT_ID, isMultiTenantRequest: true },
    ]) {
      findBy.mockClear();

      await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
        deleteOf({ props: props }),
        SELECT,
      );

      expect(readWith().query).toEqual({ statusPageId: STATUS_PAGE_ID });
    }
  });

  it("leaves the delete's own query as it was sent while it reads", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: { isRoot: true, tenantId: PROJECT_ID },
    });
    const sent: Query<StatusPageSubscriber> = deleteBy.query;

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(sent).toEqual({ statusPageId: STATUS_PAGE_ID });
  });

  it("hands back the rows read", async () => {
    rowsRead = [row(ROW_A), row(ROW_B)];

    const rows: Array<StatusPageSubscriber> =
      await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(
        deleteOf({}),
        SELECT,
      );

    expect(rows).toBe(rowsRead);
  });

  it("holds the delete to the one row read: its query names it, its window covers just it", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      skip: 3,
      limit: 9,
    });

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(deleteBy.query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      _id: ROW_A,
    });
    expect(deleteBy.skip).toBe(0);
    expect(deleteBy.limit).toBe(1);
  });

  it("holds the delete to every row read, and to no other", async () => {
    rowsRead = [row(ROW_A), row(ROW_B), row(ROW_C)];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      skip: 0,
      limit: LIMIT_MAX,
    });

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    const query: JSONObject = deleteBy.query as unknown as JSONObject;

    expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(idsNamedBy(query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B, ROW_C].sort(),
    );
    expect(deleteBy.skip).toBe(0);
    expect(deleteBy.limit).toBe(3);
  });

  it("narrows a delete that names its rows by id to the ones read", async () => {
    // The delete names A and B; only A is read - B was deleted meanwhile, say.
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      query: {
        _id: QueryHelper.any([ROW_A, ROW_B]),
      } as unknown as Query<StatusPageSubscriber>,
    });

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect((deleteBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
  });

  it("holds an either-or delete to the rows read by id alone", async () => {
    rowsRead = [row(ROW_A), row(ROW_C)];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      query: [
        { statusPageId: STATUS_PAGE_ID },
        { _id: ROW_C },
      ] as unknown as Query<StatusPageSubscriber>,
    });

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    // An either-or query is read as it was sent.
    expect(readWith().query).toEqual([
      { statusPageId: STATUS_PAGE_ID },
      { _id: ROW_C },
    ]);

    const query: JSONObject = deleteBy.query as unknown as JSONObject;

    expect(Object.keys(query)).toEqual(["_id"]);
    expect(idsNamedBy(query["_id"]).sort()).toEqual([ROW_A, ROW_C].sort());
    expect(deleteBy.limit).toBe(2);
  });

  it("holds a delete that reaches no row to none: a row that appears before the delete is not removed", async () => {
    rowsRead = [];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      skip: 4,
      limit: 10,
    });

    const rows: Array<StatusPageSubscriber> =
      await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(rows).toEqual([]);

    const query: JSONObject = deleteBy.query as unknown as JSONObject;

    expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(typeof query["_id"]).not.toBe("string");
    expect(idsNamedBy(query["_id"])).toEqual([]);
    // Matches nothing, whatever row the table holds by then.
    expect(meetsCondition(query["_id"], ROW_A)).toBe(false);
    expect(deleteBy.skip).toBe(0);
  });

  it("leaves out a row read back without an id", async () => {
    const withoutId: StatusPageSubscriber = new StatusPageSubscriber();
    rowsRead = [row(ROW_A), withoutId];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({});

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect((deleteBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(deleteBy.limit).toBe(1);
  });

  it("reads a second time within the rows a first read held the delete to", async () => {
    rowsRead = [row(ROW_A), row(ROW_B)];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      skip: 40,
      limit: 20,
    });

    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, SELECT);
    await rowsADeleteRemoves().findRowsAndHoldDeleteToThem(deleteBy, {
      isUnsubscribed: true,
    });

    const second: Read = findBy.mock.calls[1]![0] as Read;

    expect(idsNamedBy((second.query as JSONObject)["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(second.skip).toBe(0);
    expect(second.limit).toBe(2);
  });
});

/*
 * WHO MAY DELETE A ROW DECIDES WHETHER IT IS SEEN.
 *
 * Before the hooks, the delete path reads the rows its caller may delete,
 * in the delete's window (keepRowsCallerMayWrite, with the caller's delete
 * permission). The rows a hook reads are those, read again with the
 * delete's query in the same read: a row the caller cannot delete - outside
 * their labels, owned by someone else - is neither seen nor removed, so it
 * can neither refuse the delete nor have anything done to it.
 */
describe("DatabaseService.findRowsAndHoldDeleteToThem - the rows the caller may delete", () => {
  // A service with a delete hook, as every service that reads its rows has.
  class ServiceWithDeleteHook extends DatabaseService<StatusPageSubscriber> {
    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeDelete(
      deleteBy: DeleteBy<StatusPageSubscriber>,
    ): Promise<OnDelete<StatusPageSubscriber>> {
      return { deleteBy, carryForward: null };
    }
  }

  let service: ServiceWithDeleteHook;
  let rowsTheCallerMayDelete: Array<StatusPageSubscriber>;
  let rowsReadAgain: Array<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let findRowsCallerMayDelete: jest.SpyInstance;
  let deleteQueryPermission: jest.SpyInstance;

  function callerRows(): RowsADeleteRemoves {
    return service as unknown as RowsADeleteRemoves;
  }

  const TEAM_MEMBER: JSONObject = {
    tenantId: PROJECT_ID,
    userId: new ObjectID("5d000000-0000-4000-8000-0000000000d1"),
  };

  beforeEach(() => {
    service = new ServiceWithDeleteHook();

    // The caller may delete A and B; C matches the query but is not theirs.
    rowsTheCallerMayDelete = [row(ROW_A), row(ROW_B)];
    rowsReadAgain = [row(ROW_A), row(ROW_B)];

    deleteQueryPermission = getJestSpyOn(
      ModelPermission,
      "checkDeleteQueryPermission",
    ).mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return { ...(query as JSONObject), labelsTheCallerMayDelete: true };
      },
    );

    findRowsCallerMayDelete = getJestSpyOn(
      service,
      "_findBy",
    ).mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
      return rowsTheCallerMayDelete;
    });

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return rowsReadAgain;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds the rows the caller may delete with the caller's delete permission, in the delete's window", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
      skip: 30,
      limit: 10,
    });

    await expect(
      callerRows().keepRowsCallerMayWrite(deleteBy, DatabaseRequestType.Delete),
    ).resolves.toBe(true);

    expect(deleteQueryPermission).toHaveBeenCalledTimes(1);

    const read: Read = findRowsCallerMayDelete.mock.calls[0]![0] as Read;

    expect(read.query).toMatchObject({
      statusPageId: STATUS_PAGE_ID,
      labelsTheCallerMayDelete: true,
    });
    expect(read.skip).toBe(30);
    expect(read.limit).toBe(10);
  });

  it("reads again only the rows the delete path found the caller may delete, by the delete's query and their ids", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
    });

    await callerRows().keepRowsCallerMayWrite(
      deleteBy,
      DatabaseRequestType.Delete,
    );

    await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(findBy).toHaveBeenCalledTimes(1);

    const read: Read = findBy.mock.calls[0]![0] as Read;
    const query: JSONObject = read.query as JSONObject;

    expect(idsNamedBy(query["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());
    expect(read.skip).toBe(0);
    expect(read.limit).toBe(2);
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });

    // The delete path read them once; the hook did not read them again.
    expect(findRowsCallerMayDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the condition a hook narrowed the delete by: a row the delete no longer names is neither read nor held", async () => {
    // B no longer matches the delete's query once the hook narrowed it.
    rowsReadAgain = [row(ROW_A)];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
    });

    await callerRows().keepRowsCallerMayWrite(
      deleteBy,
      DatabaseRequestType.Delete,
    );

    // The hook's narrowing - a privacy filter, say.
    deleteBy.query = {
      ...deleteBy.query,
      isUnsubscribed: false,
    } as Query<StatusPageSubscriber>;

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    const read: Read = findBy.mock.calls[0]![0] as Read;

    expect((read.query as JSONObject)["isUnsubscribed"]).toBe(false);

    expect(
      rows.map((each: StatusPageSubscriber) => {
        return each._id;
      }),
    ).toEqual([ROW_A]);

    // Held to A, with the narrowing kept.
    const held: JSONObject = deleteBy.query as unknown as JSONObject;

    expect(held["_id"]).toBe(ROW_A);
    expect(held["isUnsubscribed"]).toBe(false);
    expect(deleteBy.limit).toBe(1);
  });

  it("never hands back, nor holds, a row the caller may not delete, even one the query names by id", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
    });

    await callerRows().keepRowsCallerMayWrite(
      deleteBy,
      DatabaseRequestType.Delete,
    );

    // A hook names C by id, which the caller may not delete.
    deleteBy.query = {
      ...deleteBy.query,
      _id: QueryHelper.any([ROW_A, ROW_C]),
    } as unknown as Query<StatusPageSubscriber>;

    // A database answering the read: rows that meet every condition on _id.
    rowsReadAgain = [row(ROW_A), row(ROW_C)];
    findBy.mockImplementation((async (
      findByArgument: Read,
    ): Promise<Array<StatusPageSubscriber>> => {
      const condition: unknown = (findByArgument.query as JSONObject)["_id"];

      return rowsReadAgain.filter((each: StatusPageSubscriber): boolean => {
        return meetsCondition(condition, each._id);
      });
    }) as never);

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(
      rows.map((each: StatusPageSubscriber) => {
        return each._id;
      }),
    ).toEqual([ROW_A]);

    // The hook's own condition on _id stays beside the ids held.
    const held: unknown = (deleteBy.query as unknown as JSONObject)["_id"];

    expect(meetsCondition(held, ROW_A)).toBe(true);
    expect(meetsCondition(held, ROW_B)).toBe(false);
    expect(meetsCondition(held, ROW_C)).toBe(false);
    expect(partsOf(held).length).toBe(2);
  });

  it("reads nothing, and holds the delete to none, when the caller may delete no row", async () => {
    rowsTheCallerMayDelete = [];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
    });

    // The delete path stops here: there is nothing to delete.
    await expect(
      callerRows().keepRowsCallerMayWrite(deleteBy, DatabaseRequestType.Delete),
    ).resolves.toBe(false);

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(rows).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
    expect(idsNamedBy((deleteBy.query as unknown as JSONObject)["_id"])).toEqual(
      [],
    );
  });

  it("finds the rows the caller may delete itself for a delete that reached the hook without the delete path", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
      skip: 12,
      limit: 6,
    });

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    // The caller's delete permission asked, in the delete's window.
    expect(deleteQueryPermission).toHaveBeenCalledTimes(1);

    const callerRead: Read = findRowsCallerMayDelete.mock.calls[0]![0] as Read;

    expect(callerRead.skip).toBe(12);
    expect(callerRead.limit).toBe(6);

    expect(
      rows
        .map((each: StatusPageSubscriber) => {
          return each._id;
        })
        .sort(),
    ).toEqual([ROW_A, ROW_B].sort());
    expect(deleteBy.limit).toBe(2);
    expect(deleteBy.skip).toBe(0);
  });

  it("asks the caller's update permission for none of it", async () => {
    const updatableQuery: jest.SpyInstance = getJestSpyOn(
      ModelPermission,
      "getUpdatableQuery",
    );

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      props: TEAM_MEMBER,
    });

    await callerRows().findRowsAndHoldDeleteToThem(deleteBy, SELECT);

    expect(updatableQuery).not.toHaveBeenCalled();
    expect(deleteQueryPermission).toHaveBeenCalledTimes(1);
  });
});

/*
 * A relation the delete's query sets a condition on is read by the rows'
 * ids alone: read with that query, the condition would leave out the part
 * of the relation it does not match, and the hook would act on a row by
 * less than it holds.
 */
describe("DatabaseService.findRowsAndHoldDeleteToThem - relations", () => {
  let service: DatabaseService<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;

  beforeEach(() => {
    service = new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [row(ROW_A), row(ROW_B)];
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds the rows by the delete's query and window, then reads the relation by their ids alone", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      query: {
        statusPageResources: { _id: ROW_C },
      } as unknown as Query<StatusPageSubscriber>,
      skip: 8,
      limit: 4,
    });

    await (
      service as unknown as RowsADeleteRemoves
    ).findRowsAndHoldDeleteToThem(deleteBy, RELATION_SELECT);

    expect(findBy).toHaveBeenCalledTimes(2);

    const first: Read = findBy.mock.calls[0]![0] as Read;
    const second: Read = findBy.mock.calls[1]![0] as Read;

    expect(first.query).toEqual({ statusPageResources: { _id: ROW_C } });
    expect(first.select).toEqual({ _id: true });
    expect(first.skip).toBe(8);
    expect(first.limit).toBe(4);

    expect(idsNamedBy((second.query as JSONObject)["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(second.select).toEqual({
      statusPageId: true,
      statusPageResources: { _id: true },
      _id: true,
    });
    expect(second.skip).toBe(0);
    expect(second.limit).toBe(2);
  });

  it("reads once, relation and all, when the delete's query sets no condition on the relation", async () => {
    await (
      service as unknown as RowsADeleteRemoves
    ).findRowsAndHoldDeleteToThem(deleteOf({}), RELATION_SELECT);

    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

/*
 * A hook that acts on the one row a delete removes - a timeline entry whose
 * neighbours close its gap, a list entry whose followers move up - reads it
 * with findOneRowAndHoldDeleteToIt: two rows read are enough to tell a
 * delete of one from a delete of more, which is left as it is for the hook
 * to refuse.
 */
describe("DatabaseService.findOneRowAndHoldDeleteToIt", () => {
  let service: DatabaseService<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let rowsRead: Array<StatusPageSubscriber>;

  function oneRow(): RowsADeleteRemoves {
    return service as unknown as RowsADeleteRemoves;
  }

  beforeEach(() => {
    service = new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);
    rowsRead = [row(ROW_A)];

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return rowsRead;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads two rows at most, however many the delete's window reaches", async () => {
    await oneRow().findOneRowAndHoldDeleteToIt(
      deleteOf({ skip: 7, limit: LIMIT_MAX }),
      SELECT,
    );

    const read: Read = findBy.mock.calls[0]![0] as Read;

    expect(read.limit).toBe(2);
    expect(read.skip).toBe(7);
  });

  it("hands back the one row the delete removes, with the delete held to it", async () => {
    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({ limit: 50 });

    await expect(
      oneRow().findOneRowAndHoldDeleteToIt(deleteBy, SELECT),
    ).resolves.toEqual({ row: rowsRead[0], deletesMore: false });

    expect((deleteBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(deleteBy.limit).toBe(1);
    expect(deleteBy.skip).toBe(0);
  });

  it("answers that a delete removes more than one row, and leaves it as it is", async () => {
    rowsRead = [row(ROW_A), row(ROW_B)];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({
      skip: 3,
      limit: 50,
    });

    await expect(
      oneRow().findOneRowAndHoldDeleteToIt(deleteBy, SELECT),
    ).resolves.toEqual({ row: null, deletesMore: true });

    expect(deleteBy.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(deleteBy.skip).toBe(3);
    expect(deleteBy.limit).toBe(50);
  });

  it("holds a delete of no row to none", async () => {
    rowsRead = [];

    const deleteBy: DeleteBy<StatusPageSubscriber> = deleteOf({});

    await expect(
      oneRow().findOneRowAndHoldDeleteToIt(deleteBy, SELECT),
    ).resolves.toEqual({ row: null, deletesMore: false });

    expect(idsNamedBy((deleteBy.query as unknown as JSONObject)["_id"])).toEqual(
      [],
    );
  });
});
