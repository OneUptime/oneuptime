import DatabaseService from "../../../Server/Services/DatabaseService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Select from "../../../Server/Types/Database/Select";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { meetsCondition } from "../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * THE ROWS AN UPDATE WRITES, READ FOR A CHECK, ARE THE ONLY ROWS IT WRITES.
 *
 * A service's onBeforeUpdate that checks the rows an update changes - the
 * resources a subscription adds, the command settings a rule widens - reads
 * them with findRowsAndHoldUpdateToThem. For OneUptime and a master admin,
 * who write any row, they are the update's own rows, read by its own query
 * in its window, as their write reaches them (the first describe below);
 * for anyone else they are the rows the caller may write - found by the
 * update path before the hooks, or by the hook itself when the update
 * reached it some other way - that the update's query, as its hooks have
 * narrowed it, still names (the second).
 * The update is then held to the rows read: its query names them, with a
 * window that covers just them, so the write can never reach a row the
 * check did not see.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);
const ROW_A: string = "5f000000-0000-4000-8000-000000000001";
const ROW_B: string = "5f000000-0000-4000-8000-000000000002";
const ROW_C: string = "5f000000-0000-4000-8000-000000000003";

interface RowsAnUpdateWrites {
  findRowsAndHoldUpdateToThem(
    updateBy: UpdateBy<StatusPageSubscriber>,
    select: Select<StatusPageSubscriber>,
  ): Promise<Array<StatusPageSubscriber>>;
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

function row(id: string): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = id;
  return subscriber;
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

// The ids an `_id: QueryHelper.any([...])` condition names.
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  return Object.values(
    (value as { objectLiteralParameters: JSONObject }).objectLiteralParameters,
  ).flat() as Array<string>;
}

/*
 * The ids a query names its rows by, as the update path reads them
 * (DatabaseService.getIdsNamedBy): a plain id, or a condition on _id the
 * update path set - null for a query that names its rows any other way.
 */
function idsTheUpdatePathNamed(query: unknown): Array<string> | null {
  return (
    DatabaseService as unknown as {
      getIdsNamedBy(query: unknown): Array<string> | null;
    }
  ).getIdsNamedBy(query);
}

describe("DatabaseService.findRowsAndHoldUpdateToThem - OneUptime's own update", () => {
  let service: DatabaseService<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let rowsRead: Array<StatusPageSubscriber>;

  function rowsAnUpdateWrites(): RowsAnUpdateWrites {
    return service as unknown as RowsAnUpdateWrites;
  }

  function update(data: {
    query?: Query<StatusPageSubscriber>;
    props?: JSONObject;
    skip?: number | PositiveNumber;
    limit?: number | PositiveNumber;
  }): UpdateBy<StatusPageSubscriber> {
    return {
      query: data.query || { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: (data.props || {
        isRoot: true,
        tenantId: PROJECT_ID,
      }) as unknown as DatabaseCommonInteractionProps,
      skip: data.skip ?? 0,
      limit: data.limit ?? LIMIT_MAX,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  function readWith(): {
    query: JSONObject | Array<JSONObject>;
    select: JSONObject;
    skip: number;
    limit: number;
    props: JSONObject;
  } {
    expect(findBy).toHaveBeenCalledTimes(1);

    return findBy.mock.calls[0]![0] as {
      query: JSONObject | Array<JSONObject>;
      select: JSONObject;
      skip: number;
      limit: number;
      props: JSONObject;
    };
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

  it("reads the update's rows as OneUptime, by the update's own query, with what the check asks for and their ids", async () => {
    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(update({}), SELECT);

    const read: ReturnType<typeof readWith> = readWith();

    expect(read.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(read.select).toEqual({
      statusPageId: true,
      isUnsubscribed: true,
      _id: true,
    });
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  it("reads in the update's own window, whether it is given as numbers or PositiveNumbers", async () => {
    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
      update({ skip: 20000, limit: 15000 }),
      SELECT,
    );

    expect(readWith()).toMatchObject({ skip: 20000, limit: 15000 });

    findBy.mockClear();

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
      update({ skip: new PositiveNumber(5), limit: new PositiveNumber(7) }),
      SELECT,
    );

    expect(readWith()).toMatchObject({ skip: 5, limit: 7 });
  });

  /*
   * OneUptime's write of an update is not narrowed by the project its request
   * names, so neither is the read of its rows: they are the rows the write
   * reaches, every one of them checked - and none of them dropped from the
   * write for being outside the request's project.
   */
  it("adds nothing to OneUptime's own query, whatever project its request names", async () => {
    for (const props of [
      { isRoot: true },
      { isRoot: true, tenantId: PROJECT_ID },
      { isRoot: true, tenantId: PROJECT_ID, isMultiTenantRequest: true },
    ]) {
      findBy.mockClear();

      await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
        update({ props: props }),
        SELECT,
      );

      expect(readWith().query).toEqual({ statusPageId: STATUS_PAGE_ID });
    }
  });

  it("hands back the rows read", async () => {
    rowsRead = [row(ROW_A), row(ROW_B)];

    const rows: Array<StatusPageSubscriber> =
      await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
        update({}),
        SELECT,
      );

    expect(rows).toBe(rowsRead);
  });

  it("holds the update to the one row read: its query names it, its window covers just it", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      skip: 3,
      limit: 9,
    });

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(updateBy.query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      _id: ROW_A,
    });
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(1);
  });

  it("holds the update to every row read, and to no other", async () => {
    rowsRead = [row(ROW_A), row(ROW_B), row(ROW_C)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      skip: 0,
      limit: LIMIT_MAX,
    });

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const query: JSONObject = updateBy.query as unknown as JSONObject;

    expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(idsNamedBy(query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B, ROW_C].sort(),
    );
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(3);
  });

  it("narrows an update that names its rows by id to the ones read", async () => {
    // The update names A and B; only A is read - B was deleted meanwhile, say.
    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      query: {
        _id: QueryHelper.any([ROW_A, ROW_B]),
      } as unknown as Query<StatusPageSubscriber>,
    });

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
  });

  it("holds an update that reaches no row to none: a row that appears before the write is not written", async () => {
    rowsRead = [];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      skip: 4,
      limit: 10,
    });

    const rows: Array<StatusPageSubscriber> =
      await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(rows).toEqual([]);

    const query: JSONObject = updateBy.query as unknown as JSONObject;

    expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(typeof query["_id"]).not.toBe("string");
    expect(idsNamedBy(query["_id"])).toEqual([]);
    expect(updateBy.skip).toBe(0);
  });

  it("leaves out a row read back without an id", async () => {
    const withoutId: StatusPageSubscriber = new StatusPageSubscriber();
    rowsRead = [row(ROW_A), withoutId];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({});

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.limit).toBe(1);
  });

  /*
   * A hold names the rows it read in a condition the update path records
   * (idConditionsNamingRows), so a later check knows the update writes none
   * but those - the named-record check after the hooks asks nothing again
   * of rows it asked about before them (isReadBySameUpdate).
   */
  it("names the rows it read in a way the update path knows again, the same query or a new one", async () => {
    rowsRead = [row(ROW_A), row(ROW_B)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      query: {
        _id: QueryHelper.any([ROW_A, ROW_B, ROW_C]),
      } as unknown as Query<StatusPageSubscriber>,
    });

    // A condition the caller wrote is not one the update path set.
    expect(idsTheUpdatePathNamed(updateBy.query)).toBeNull();

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(idsTheUpdatePathNamed(updateBy.query)!.sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );

    // Copied into a query of its own, the condition still names them.
    expect(
      idsTheUpdatePathNamed({
        ...updateBy.query,
        isUnsubscribed: false,
      })!.sort(),
    ).toEqual([ROW_A, ROW_B].sort());
  });

  it("names no row once it holds an update to none", async () => {
    rowsRead = [];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({});

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(idsTheUpdatePathNamed(updateBy.query)).toEqual([]);
  });
});

describe("DatabaseService.getIdsNamedBy", () => {
  it("answers the one row a plain id names, however it is written", () => {
    expect(idsTheUpdatePathNamed({ _id: ROW_A })).toEqual([ROW_A]);
    expect(idsTheUpdatePathNamed({ _id: new ObjectID(ROW_B) })).toEqual([
      ROW_B,
    ]);
  });

  it("answers no rows for a query that names its rows some other way, or not by id", () => {
    expect(
      idsTheUpdatePathNamed({ _id: QueryHelper.any([ROW_A, ROW_B]) }),
    ).toBeNull();
    expect(idsTheUpdatePathNamed({ _id: QueryHelper.any([]) })).toBeNull();
    expect(idsTheUpdatePathNamed({ statusPageId: STATUS_PAGE_ID })).toBeNull();
    expect(idsTheUpdatePathNamed({ _id: "  " })).toBeNull();
    expect(idsTheUpdatePathNamed(undefined)).toBeNull();
  });
});

/*
 * WHO MAY WRITE A ROW DECIDES WHETHER IT IS CHECKED.
 *
 * Before the hooks, the update path reads the rows its caller may write, in
 * the update's window (keepRowsCallerMayWrite). The rows a hook checks are
 * those, read again by id: a row the caller cannot write - outside their
 * labels, owned by someone else - is neither asked about nor held, so it can
 * neither refuse the update nor keep a row it may write from being written.
 */
describe("DatabaseService.findRowsAndHoldUpdateToThem - the rows the caller may write", () => {
  // A service with an update hook, as every service that checks rows has.
  class ServiceWithUpdateHook extends DatabaseService<StatusPageSubscriber> {
    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeUpdate(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<OnUpdate<StatusPageSubscriber>> {
      return { updateBy, carryForward: null };
    }
  }

  interface RowsTheCallerMayWrite extends RowsAnUpdateWrites {
    keepRowsCallerMayWrite(
      write: UpdateBy<StatusPageSubscriber>,
      type: DatabaseRequestType.Update,
    ): Promise<boolean>;
  }

  let service: ServiceWithUpdateHook;
  let rowsTheCallerMayWrite: Array<StatusPageSubscriber>;
  let rowsReadAgain: Array<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let findRowsCallerMayWrite: jest.SpyInstance;

  function callerRows(): RowsTheCallerMayWrite {
    return service as unknown as RowsTheCallerMayWrite;
  }

  function update(props: JSONObject): UpdateBy<StatusPageSubscriber> {
    return {
      query: { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: props as unknown as DatabaseCommonInteractionProps,
      skip: 0,
      limit: LIMIT_MAX,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  const TEAM_MEMBER: JSONObject = {
    tenantId: PROJECT_ID,
    userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
  };

  beforeEach(() => {
    service = new ServiceWithUpdateHook();

    // The caller may write A and B; C matches the query but is not theirs.
    rowsTheCallerMayWrite = [row(ROW_A), row(ROW_B)];
    rowsReadAgain = [row(ROW_A), row(ROW_B)];

    getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return { ...(query as JSONObject), labelsTheCallerMayWrite: true };
      },
    );

    findRowsCallerMayWrite = getJestSpyOn(
      service,
      "_findBy",
    ).mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
      return rowsTheCallerMayWrite;
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

  it("reads again only the rows the update path found the caller may write, by the update's query and their ids", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await expect(
      callerRows().keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update),
    ).resolves.toBe(true);

    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(findBy).toHaveBeenCalledTimes(1);

    const read: {
      query: JSONObject;
      skip: number;
      limit: number;
      props: JSONObject;
    } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
      skip: number;
      limit: number;
      props: JSONObject;
    };

    // The update's query, as the update path left it, kept to their ids.
    expect(read.query["statusPageId"]).toEqual(STATUS_PAGE_ID);
    expect(idsNamedBy(read.query["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());
    expect(read.skip).toBe(0);
    expect(read.limit).toBe(2);
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  /*
   * A hook may narrow the update before it checks it - a privacy filter
   * that leaves out the records the caller may not see. The rows checked
   * are then the ones the narrowed update still names, and the write is
   * held to them with the narrowing kept.
   */
  it("keeps the condition a hook narrowed the update by: a row the update no longer names is neither read nor held", async () => {
    // B no longer matches the update's query once the hook narrowed it.
    rowsReadAgain = [row(ROW_A)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // The hook's narrowing.
    updateBy.query = {
      ...updateBy.query,
      isUnsubscribed: false,
    } as Query<StatusPageSubscriber>;

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const read: { query: JSONObject } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
    };

    expect(read.query["isUnsubscribed"]).toBe(false);
    expect(idsNamedBy(read.query["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());

    expect(
      rows.map((each: StatusPageSubscriber) => {
        return each._id;
      }),
    ).toEqual([ROW_A]);

    // Held to A, with the narrowing kept.
    const held: JSONObject = updateBy.query as unknown as JSONObject;

    expect(held["_id"]).toBe(ROW_A);
    expect(held["isUnsubscribed"]).toBe(false);
    expect(updateBy.limit).toBe(1);
  });

  it("never hands back, nor holds, a row the caller may not write, even one the update's query names by id", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // A hook names C by id, which the caller may not write.
    const namedByHook: unknown = QueryHelper.any([ROW_A, ROW_C]);

    updateBy.query = {
      ...updateBy.query,
      _id: namedByHook,
    } as Query<StatusPageSubscriber>;

    // Read as OneUptime, the query finds both.
    rowsReadAgain = [row(ROW_A), row(ROW_C)];

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(
      rows.map((each: StatusPageSubscriber) => {
        return each._id;
      }),
    ).toEqual([ROW_A]);

    // Held to A, with the hook's condition kept beside it.
    const heldBy: unknown = (updateBy.query as unknown as JSONObject)["_id"];

    expect(meetsCondition(heldBy, ROW_A)).toBe(true);
    expect(meetsCondition(heldBy, ROW_C)).toBe(false);
    expect(partsOf(heldBy)).toContain(namedByHook);
    expect(updateBy.limit).toBe(1);
  });

  /*
   * The rows a hook names by id are read together with the rows the caller
   * may write, in the read itself: rows the caller may not write never take
   * the places in the window that the caller's own rows need.
   */
  it("reads the rows a hook names by id only among the rows the caller may write, so none of theirs is left out of the window", async () => {
    const ROW_D: string = "5f000000-0000-4000-8000-000000000004";
    const ROW_E: string = "5f000000-0000-4000-8000-000000000005";

    // The database: answers the read's _id condition, in its window.
    const pool: Array<StatusPageSubscriber> = [
      row(ROW_C),
      row(ROW_D),
      row(ROW_E),
      row(ROW_A),
      row(ROW_B),
    ];

    findBy.mockImplementation(
      async (read: {
        query: JSONObject;
        limit: number;
      }): Promise<Array<StatusPageSubscriber>> => {
        return pool
          .filter((each: StatusPageSubscriber): boolean => {
            return meetsCondition(read.query["_id"], each._id);
          })
          .slice(0, read.limit);
      },
    );

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // A hook names C, D and E - none of them the caller's - and A.
    updateBy.query = {
      ...updateBy.query,
      _id: QueryHelper.any([ROW_C, ROW_D, ROW_E, ROW_A]),
    } as Query<StatusPageSubscriber>;

    const rows: Array<StatusPageSubscriber> =
      await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(
      rows.map((each: StatusPageSubscriber) => {
        return each._id;
      }),
    ).toEqual([ROW_A]);

    const heldBy: unknown = (updateBy.query as unknown as JSONObject)["_id"];

    for (const id of [ROW_B, ROW_C, ROW_D, ROW_E]) {
      expect(meetsCondition(heldBy, id)).toBe(false);
    }

    expect(meetsCondition(heldBy, ROW_A)).toBe(true);
    expect(updateBy.limit).toBe(1);
  });

  it("reads nothing, and holds the update to none, when the one row the update names by id is not the caller's", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // A hook names C by its plain id, which the caller may not write.
    updateBy.query = {
      ...updateBy.query,
      _id: ROW_C,
    } as Query<StatusPageSubscriber>;

    await expect(
      callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT),
    ).resolves.toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
    expect(
      meetsCondition((updateBy.query as unknown as JSONObject)["_id"], ROW_C),
    ).toBe(false);
  });

  it("never asks about, nor holds, a row the caller may not write", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );
    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const read: { query: JSONObject } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
    };

    expect(idsNamedBy(read.query["_id"])).not.toContain(ROW_C);

    const held: JSONObject = updateBy.query as unknown as JSONObject;

    expect(idsNamedBy(held["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());
    expect(idsNamedBy(held["_id"])).not.toContain(ROW_C);
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(2);
  });

  it("holds the update to the one row the caller may write, by its plain id", async () => {
    rowsTheCallerMayWrite = [row(ROW_A)];
    rowsReadAgain = [row(ROW_A)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );
    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.limit).toBe(1);
  });

  it("reads nothing when the caller may write no row of the update", async () => {
    rowsTheCallerMayWrite = [];

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await expect(
      callerRows().keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update),
    ).resolves.toBe(false);

    await expect(
      callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT),
    ).resolves.toEqual([]);
    expect(findBy).not.toHaveBeenCalled();

    // And should it run all the same, it writes no row.
    expect(
      idsNamedBy((updateBy.query as unknown as JSONObject)["_id"]),
    ).toEqual([]);
  });

  /*
   * A service whose only update hook runs once the caller passed the checks
   * (onBeforeUpdateUniqueCheck) has nothing read before its hooks: an update
   * it has nothing to ask about - a rename - costs no read. When its check
   * asks for the rows it writes, the rows the caller may write are read
   * then, from the update as the permission check left it, and the update is
   * held to them with that check's condition on _id kept beside their ids,
   * so the write asks it again.
   */
  it("reads the rows the caller may write only when a check that runs once the checks passed asks, and keeps the permission check's condition", async () => {
    class ServiceWithUniqueCheck extends DatabaseService<StatusPageSubscriber> {
      public constructor() {
        super(StatusPageSubscriber);
      }

      protected override async onBeforeUpdateUniqueCheck(
        _updateBy: UpdateBy<StatusPageSubscriber>,
      ): Promise<void> {
        return Promise.resolve();
      }
    }

    const checkedService: ServiceWithUniqueCheck = new ServiceWithUniqueCheck();
    const checked: RowsTheCallerMayWrite =
      checkedService as unknown as RowsTheCallerMayWrite;

    const updatableQuery: jest.SpyInstance =
      ModelPermission.getUpdatableQuery as unknown as jest.SpyInstance;
    updatableQuery.mockClear();

    const readsCallerMayWrite: jest.SpyInstance = getJestSpyOn(
      checkedService,
      "_findBy",
    ).mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
      return rowsTheCallerMayWrite;
    });
    const readsAgain: jest.SpyInstance = getJestSpyOn(
      checkedService,
      "findBy",
    ).mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
      return rowsReadAgain;
    });

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    // Before the hooks: nothing read, nothing changed.
    await expect(
      checked.keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update),
    ).resolves.toBe(true);
    expect(readsCallerMayWrite).not.toHaveBeenCalled();
    expect(updatableQuery).not.toHaveBeenCalled();
    expect(updateBy.query).toEqual({ statusPageId: STATUS_PAGE_ID });

    // The permission check narrows the update by a condition on _id.
    const permitted: unknown = QueryHelper.any([ROW_A, ROW_B]);

    updateBy.query = {
      ...updateBy.query,
      _id: permitted,
    } as Query<StatusPageSubscriber>;

    await checked.findRowsAndHoldUpdateToThem(updateBy, SELECT);

    // Read when the check asked, and once.
    expect(updatableQuery).toHaveBeenCalledTimes(1);
    expect(readsCallerMayWrite).toHaveBeenCalledTimes(1);
    expect(readsAgain).toHaveBeenCalledTimes(1);

    const heldBy: unknown = (updateBy.query as unknown as JSONObject)["_id"];

    expect(partsOf(heldBy)[0]).toBe(permitted);
    expect(meetsCondition(heldBy, ROW_A)).toBe(true);
    expect(meetsCondition(heldBy, ROW_B)).toBe(true);
    expect(meetsCondition(heldBy, ROW_C)).toBe(false);
    expect(updateBy.limit).toBe(2);
  });

  /*
   * Every hold of an update by a later check names the rows it read beside
   * what the first one kept, and not beside the first one's ids as well: an
   * update held three times names its rows once.
   */
  it("replaces its own ids when it holds an update again, keeping the condition the first hold kept", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // A hook narrows the update by a condition on _id.
    const namedByHook: unknown = QueryHelper.any([ROW_A, ROW_B, ROW_C]);

    updateBy.query = {
      ...updateBy.query,
      _id: namedByHook,
    } as Query<StatusPageSubscriber>;

    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const firstHold: unknown = (updateBy.query as unknown as JSONObject)["_id"];

    expect(partsOf(firstHold)[0]).toBe(namedByHook);

    // A second check reads one of them.
    rowsReadAgain = [row(ROW_B)];

    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const secondHold: unknown = (updateBy.query as unknown as JSONObject)[
      "_id"
    ];

    expect(partsOf(secondHold)).toHaveLength(2);
    expect(partsOf(secondHold)[0]).toBe(namedByHook);
    expect(meetsCondition(secondHold, ROW_B)).toBe(true);
    expect(meetsCondition(secondHold, ROW_A)).toBe(false);
    expect(updateBy.limit).toBe(1);
  });

  it("reads the rows the caller may write itself when the update reached the hook without that read", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    // The caller's rows, found in the update's window...
    const mayWrite: { query: JSONObject; skip: number; limit: number } =
      findRowsCallerMayWrite.mock.calls[0]![0] as {
        query: JSONObject;
        skip: number;
        limit: number;
      };

    expect(mayWrite.query["labelsTheCallerMayWrite"]).toBe(true);
    expect(mayWrite.skip).toBe(0);
    expect(mayWrite.limit).toBe(LIMIT_MAX);

    // ... are the ones read again and held, and no other.
    const read: { query: JSONObject } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
    };

    expect(idsNamedBy(read.query["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());

    const held: JSONObject = updateBy.query as unknown as JSONObject;

    expect(idsNamedBy(held["_id"]).sort()).toEqual([ROW_A, ROW_B].sort());
    expect(idsNamedBy(held["_id"])).not.toContain(ROW_C);
  });

  it("reads a master admin's update as OneUptime's: its own query, in its window", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      tenantId: PROJECT_ID,
      isMasterAdmin: true,
    });

    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(findRowsCallerMayWrite).not.toHaveBeenCalled();

    const read: { query: JSONObject; limit: number } = findBy.mock
      .calls[0]![0] as { query: JSONObject; limit: number };

    expect(read.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(read.limit).toBe(LIMIT_MAX);
  });

  it("reads the update's own query again when OneUptime writes the same update object", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAM_MEMBER);

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );

    // The same object, written as OneUptime: the caller's rows no longer apply.
    updateBy.props = { isRoot: true } as DatabaseCommonInteractionProps;
    updateBy.query = { statusPageId: STATUS_PAGE_ID };
    updateBy.skip = 0;
    updateBy.limit = LIMIT_MAX;

    await callerRows().keepRowsCallerMayWrite(
      updateBy,
      DatabaseRequestType.Update,
    );
    await callerRows().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const read: { query: JSONObject; limit: number } = findBy.mock
      .calls[0]![0] as { query: JSONObject; limit: number };

    expect(read.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(read.limit).toBe(LIMIT_MAX);
  });
});

/*
 * A RELATION THE UPDATE'S QUERY SETS A CONDITION ON IS READ BY THE ROWS' IDS
 * ALONE.
 *
 * Read with the update's own query, a condition the query sets on a
 * relation would leave out the part of it the condition does not match,
 * and a check would judge a row by less than it holds. So when the check
 * asks for such a relation, the rows are found first - their ids, by the
 * update's query - and then read whole, by those ids alone. A relation the
 * query sets no condition on is read with the rows, in one read.
 */
describe("DatabaseService.findRowsAndHoldUpdateToThem - relations", () => {
  class ServiceWithUpdateHook extends DatabaseService<StatusPageSubscriber> {
    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeUpdate(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<OnUpdate<StatusPageSubscriber>> {
      return { updateBy, carryForward: null };
    }
  }

  interface Reads extends RowsAnUpdateWrites {
    keepRowsCallerMayWrite(
      write: UpdateBy<StatusPageSubscriber>,
      type: DatabaseRequestType.Update,
    ): Promise<boolean>;
  }

  interface Read {
    query: JSONObject;
    select: JSONObject;
    skip: number;
    limit: number;
  }

  let service: ServiceWithUpdateHook;
  let findBy: jest.SpyInstance;

  function reads(): Reads {
    return service as unknown as Reads;
  }

  function readAt(index: number): Read {
    return findBy.mock.calls[index]![0] as Read;
  }

  function update(props: JSONObject): UpdateBy<StatusPageSubscriber> {
    return {
      query: {
        statusPageId: STATUS_PAGE_ID,
        statusPageResources: { _id: ROW_C },
      },
      data: { isSubscribedToAllResources: false },
      props: props as unknown as DatabaseCommonInteractionProps,
      skip: 20000,
      limit: 30,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  beforeEach(() => {
    service = new ServiceWithUpdateHook();

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [row(ROW_A), row(ROW_B)];
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds OneUptime's rows by the update's query and window, then reads the relation by their ids alone", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    await reads().findRowsAndHoldUpdateToThem(updateBy, RELATION_SELECT);

    expect(findBy).toHaveBeenCalledTimes(2);

    // The rows: the update's own query, in its own window, ids only.
    expect(readAt(0).query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      statusPageResources: { _id: ROW_C },
    });
    expect(readAt(0).select).toEqual({ _id: true });
    expect(readAt(0).skip).toBe(20000);
    expect(readAt(0).limit).toBe(30);

    // What the check asks for: by those ids alone, the relation unfiltered.
    expect(Object.keys(readAt(1).query)).toEqual(["_id"]);
    expect(idsNamedBy(readAt(1).query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(readAt(1).select).toEqual({
      statusPageId: true,
      statusPageResources: { _id: true },
      _id: true,
    });
    expect(readAt(1).skip).toBe(0);
    expect(readAt(1).limit).toBe(2);
  });

  /*
   * A teammate's rows are found by the update's query - kept to the ids the
   * permission read found - and the relation that query sets a condition on
   * is then read whole, by their ids alone.
   */
  it("finds a teammate's rows by the update's query and their ids, then reads the relation by their ids alone", async () => {
    getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return query;
      },
    );
    getJestSpyOn(service, "_findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [row(ROW_A), row(ROW_B)];
      },
    );

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      tenantId: PROJECT_ID,
      userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
    });

    await reads().keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update);
    await reads().findRowsAndHoldUpdateToThem(updateBy, RELATION_SELECT);

    expect(findBy).toHaveBeenCalledTimes(2);

    // The rows: the update's query, kept to the ids the caller may write.
    expect(readAt(0).query["statusPageResources"]).toEqual({ _id: ROW_C });
    expect(idsNamedBy(readAt(0).query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(readAt(0).select).toEqual({ _id: true });

    // What the check asks for: by those ids alone, the relation unfiltered.
    expect(Object.keys(readAt(1).query)).toEqual(["_id"]);
    expect(idsNamedBy(readAt(1).query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(readAt(1).select).toEqual({
      statusPageId: true,
      statusPageResources: { _id: true },
      _id: true,
    });
  });

  it("reads once when the check asks for no relation", async () => {
    await reads().findRowsAndHoldUpdateToThem(
      update({ isRoot: true, tenantId: PROJECT_ID }),
      SELECT,
    );

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  it("reads once, relation and all, when the update's query sets no condition on the relation", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = {
      ...update({ isRoot: true, tenantId: PROJECT_ID }),
      query: { statusPageId: STATUS_PAGE_ID },
    } as unknown as UpdateBy<StatusPageSubscriber>;

    await reads().findRowsAndHoldUpdateToThem(updateBy, RELATION_SELECT);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(readAt(0).select).toEqual({
      statusPageId: true,
      statusPageResources: { _id: true },
      _id: true,
    });
    expect(readAt(0).skip).toBe(20000);
    expect(readAt(0).limit).toBe(30);
  });

  it("holds the update to the rows the relation was read for", async () => {
    findBy
      .mockImplementationOnce(
        async (): Promise<Array<StatusPageSubscriber>> => {
          return [row(ROW_A), row(ROW_B)];
        },
      )
      .mockImplementationOnce(
        async (): Promise<Array<StatusPageSubscriber>> => {
          // B was deleted between the two reads.
          return [row(ROW_A)];
        },
      );

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    const rows: Array<StatusPageSubscriber> =
      await reads().findRowsAndHoldUpdateToThem(updateBy, RELATION_SELECT);

    expect(
      rows.map((each: StatusPageSubscriber): string => {
        return String(each._id);
      }),
    ).toEqual([ROW_A]);
    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.limit).toBe(1);
  });
});

/*
 * A LATER CALL READS WITHIN THE ROWS AN EARLIER ONE HELD THE UPDATE TO.
 *
 * Several checks of one update - a base class's and a subclass's, two of a
 * service's own - each read the rows the update writes. The first holds the
 * update to the rows it read; every later one reads within those, so no row
 * one check did not see is judged by another, or written.
 */
describe("DatabaseService.findRowsAndHoldUpdateToThem - more than one check of an update", () => {
  class ServiceWithUpdateHook extends DatabaseService<StatusPageSubscriber> {
    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeUpdate(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<OnUpdate<StatusPageSubscriber>> {
      return { updateBy, carryForward: null };
    }
  }

  interface Reads extends RowsAnUpdateWrites {
    keepRowsCallerMayWrite(
      write: UpdateBy<StatusPageSubscriber>,
      type: DatabaseRequestType.Update,
    ): Promise<boolean>;
  }

  let service: ServiceWithUpdateHook;
  let findBy: jest.SpyInstance;

  function reads(): Reads {
    return service as unknown as Reads;
  }

  function update(props: JSONObject): UpdateBy<StatusPageSubscriber> {
    return {
      query: { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: props as unknown as DatabaseCommonInteractionProps,
      skip: 0,
      limit: LIMIT_MAX,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  function stubTeammateRows(rows: Array<StatusPageSubscriber>): void {
    getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return query;
      },
    );
    getJestSpyOn(service, "_findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return rows;
      },
    );
  }

  const TEAMMATE: JSONObject = {
    tenantId: PROJECT_ID,
    userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
  };

  beforeEach(() => {
    service = new ServiceWithUpdateHook();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads a teammate's rows the second time within the ones the first check held the update to", async () => {
    stubTeammateRows([row(ROW_A), row(ROW_B)]);

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        // B stopped matching between the update path's read and the check.
        return [row(ROW_A)];
      },
    );

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAMMATE);

    await reads().keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update);
    await reads().findRowsAndHoldUpdateToThem(updateBy, SELECT);
    await reads().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect(findBy).toHaveBeenCalledTimes(2);

    const secondRead: { query: JSONObject; limit: number } = findBy.mock
      .calls[1]![0] as { query: JSONObject; limit: number };

    expect(secondRead.query["_id"]).toBe(ROW_A);
    expect(secondRead.limit).toBe(1);
    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
  });

  it("reads OneUptime's rows the second time by the ids the first check held the update to", async () => {
    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [row(ROW_A), row(ROW_B)];
      },
    );

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    await reads().findRowsAndHoldUpdateToThem(updateBy, SELECT);
    await reads().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const secondRead: { query: JSONObject; skip: number; limit: number } =
      findBy.mock.calls[1]![0] as {
        query: JSONObject;
        skip: number;
        limit: number;
      };

    expect(idsNamedBy(secondRead.query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(secondRead.skip).toBe(0);
    expect(secondRead.limit).toBe(2);
  });

  it("reads nothing more once a check held a teammate's update to none", async () => {
    stubTeammateRows([row(ROW_A)]);

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [];
      },
    );

    const updateBy: UpdateBy<StatusPageSubscriber> = update(TEAMMATE);

    await reads().keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update);
    await reads().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    await expect(
      reads().findRowsAndHoldUpdateToThem(updateBy, SELECT),
    ).resolves.toEqual([]);
    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

/*
 * A CHECK THAT RUNS ONCE AN UPDATE PASSED ITS PERMISSION CHECK READS THE ROWS
 * BY THE QUERY THAT CHECK LEFT IT WITH.
 *
 * ModelPermission.checkUpdateQueryPermissions narrows an update to the rows
 * its caller may write. A check that runs after it
 * (onBeforeUpdateUniqueCheck, onUpdatePermitted) and asks for the rows the
 * update writes has them read by that query, in the update's window - the
 * read the write itself makes - with nothing narrowed a second time and no
 * read of the rows the caller may write first. A hook that put a query of
 * its own in that one's place has the rows the caller may write read
 * first, as a hook before the checks has.
 *
 * Through the update path itself, with no database: the permission checks
 * and the reads are stubbed, and the write's own read of the rows it
 * writes ends each update.
 */
describe("DatabaseService.findRowsAndHoldUpdateToThem - a check once the update passed its permission check", () => {
  // The write's own read of the rows it writes: where each update ends.
  const WRITE_READ_REACHED: string = "The write's own read of its rows";

  type Check = (updateBy: UpdateBy<StatusPageSubscriber>) => Promise<void>;

  class ServiceWithPermittedChecks extends DatabaseService<StatusPageSubscriber> {
    public uniqueCheck: Check | null = null;
    public permittedCheck: Check | null = null;

    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeUpdateUniqueCheck(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<void> {
      if (this.uniqueCheck) {
        await this.uniqueCheck(updateBy);
      }
    }

    protected override async onUpdatePermitted(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<void> {
      if (this.permittedCheck) {
        await this.permittedCheck(updateBy);
      }
    }
  }

  // The same, with a hook before the checks too.
  class ServiceWithHookBeforeTheChecks extends ServiceWithPermittedChecks {
    protected override async onBeforeUpdate(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<OnUpdate<StatusPageSubscriber>> {
      return { updateBy, carryForward: null };
    }
  }

  interface Read {
    query: JSONObject;
    select: JSONObject;
    skip: number;
    limit: number;
    props: JSONObject;
  }

  const TEAMMATE: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;

  let service: ServiceWithPermittedChecks;
  // A condition the permission check sets on _id, when a test has it set one.
  let permittedIdCondition: unknown;
  // What each read of the rows a check makes answers, in turn.
  let rowsReadInTurn: Array<Array<StatusPageSubscriber>>;
  // The rows the caller may write, as the update path reads them.
  let rowsCallerMayWrite: Array<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;
  let updatableQuery: jest.SpyInstance;
  let readsOfRowsCallerMayWrite: Array<Read>;
  let writeReads: Array<Read>;

  // An update of the subscribers of one status page, in a window.
  function update(): UpdateBy<StatusPageSubscriber> {
    return {
      query: { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: TEAMMATE,
      skip: 20,
      limit: 50,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  // The check that reads the rows the update writes, holding it to them.
  const readAndHold: Check = async (
    updateBy: UpdateBy<StatusPageSubscriber>,
  ): Promise<void> => {
    await service.findRowsAndHoldUpdateToThem(updateBy, SELECT);
  };

  function readAt(index: number): Read {
    return findBy.mock.calls[index]![0] as Read;
  }

  function useService(next: ServiceWithPermittedChecks): void {
    service = next;

    // The rows the caller may write, and the write's own read, which ends the update.
    getJestSpyOn(service, "_findBy").mockImplementation((async (
      read: Read,
    ): Promise<Array<StatusPageSubscriber>> => {
      if (read.select["isSubscribedToAllResources"]) {
        writeReads.push(read);
        throw new Error(WRITE_READ_REACHED);
      }

      readsOfRowsCallerMayWrite.push(read);
      return rowsCallerMayWrite;
    }) as never);

    // The reads a check makes of the rows the update writes.
    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      (async (): Promise<Array<StatusPageSubscriber>> => {
        const turn: number = Math.min(
          findBy.mock.calls.length - 1,
          rowsReadInTurn.length - 1,
        );

        return rowsReadInTurn[turn] || [];
      }) as never,
    );
  }

  beforeEach(() => {
    permittedIdCondition = undefined;
    rowsReadInTurn = [[row(ROW_A), row(ROW_B)]];
    rowsCallerMayWrite = [row(ROW_A), row(ROW_B)];
    readsOfRowsCallerMayWrite = [];
    writeReads = [];

    getJestSpyOn(
      ModelPermission,
      "checkTableWritePermission",
    ).mockImplementation((): void => {
      return undefined;
    });

    // The permission check: the update kept to the request's project, in a query of its own.
    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockImplementation((async (
      _modelType: unknown,
      query: JSONObject,
    ): Promise<unknown> => {
      return {
        ...query,
        projectId: PROJECT_ID,
        ...(permittedIdCondition ? { _id: permittedIdCondition } : {}),
      };
    }) as never);

    updatableQuery = getJestSpyOn(
      ModelPermission,
      "getUpdatableQuery",
    ).mockImplementation((async (
      _modelType: unknown,
      query: JSONObject,
    ): Promise<unknown> => {
      return { ...query, labelsTheCallerMayWrite: true };
    }) as never);

    useService(new ServiceWithPermittedChecks());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the rows once, by the query the permission check left the update with, in its window: nothing narrowed again, no read of the rows the caller may write", async () => {
    let rowsChecked: Array<StatusPageSubscriber> = [];

    service.uniqueCheck = async (
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<void> => {
      rowsChecked = await service.findRowsAndHoldUpdateToThem(updateBy, SELECT);
    };

    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    expect(updatableQuery).not.toHaveBeenCalled();
    expect(readsOfRowsCallerMayWrite).toEqual([]);
    expect(findBy).toHaveBeenCalledTimes(1);

    expect(readAt(0).query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });
    expect(readAt(0).select).toEqual({
      statusPageId: true,
      isUnsubscribed: true,
      _id: true,
    });
    expect(readAt(0).skip).toBe(20);
    expect(readAt(0).limit).toBe(50);
    expect(readAt(0).props).toEqual({ isRoot: true, ignoreHooks: true });

    expect(
      rowsChecked.map((each: StatusPageSubscriber): string => {
        return String(each._id);
      }),
    ).toEqual([ROW_A, ROW_B]);
  });

  it("holds the update to the rows read, with the permission check's condition on _id kept beside their ids: the write reads no other row", async () => {
    permittedIdCondition = QueryHelper.any([ROW_A, ROW_B, ROW_C]);
    service.uniqueCheck = readAndHold;

    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    // The check read by the permission check's condition itself.
    expect(readAt(0).query["_id"]).toBe(permittedIdCondition);

    // The write's own read: the rows the check read, and the condition again.
    expect(writeReads).toHaveLength(1);

    const written: Read = writeReads[0]!;
    const heldBy: unknown = written.query["_id"];

    expect(partsOf(heldBy)[0]).toBe(permittedIdCondition);
    expect(meetsCondition(heldBy, ROW_A)).toBe(true);
    expect(meetsCondition(heldBy, ROW_B)).toBe(true);
    expect(meetsCondition(heldBy, ROW_C)).toBe(false);
    expect(written.query["projectId"]).toEqual(PROJECT_ID);
    expect(written.skip).toBe(0);
    expect(written.limit).toBe(2);

    // Named as the update path names rows, so later checks know them again.
    expect(idsTheUpdatePathNamed(written.query)!.sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
  });

  it("has a later check read within the rows the first one held the update to, still without reading the rows the caller may write", async () => {
    // The second check finds B alone: A stopped matching in between.
    rowsReadInTurn = [[row(ROW_A), row(ROW_B)], [row(ROW_B)]];
    service.uniqueCheck = readAndHold;
    service.permittedCheck = readAndHold;

    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    expect(updatableQuery).not.toHaveBeenCalled();
    expect(readsOfRowsCallerMayWrite).toEqual([]);
    expect(findBy).toHaveBeenCalledTimes(2);

    const secondRead: Read = readAt(1);

    expect(meetsCondition(secondRead.query["_id"], ROW_A)).toBe(true);
    expect(meetsCondition(secondRead.query["_id"], ROW_B)).toBe(true);
    expect(meetsCondition(secondRead.query["_id"], ROW_C)).toBe(false);
    expect(secondRead.skip).toBe(0);
    expect(secondRead.limit).toBe(2);

    // The write reads the one row the second check read.
    const written: Read = writeReads[0]!;

    expect(meetsCondition(written.query["_id"], ROW_B)).toBe(true);
    expect(meetsCondition(written.query["_id"], ROW_A)).toBe(false);
    expect(written.limit).toBe(1);
  });

  it("reads the rows the caller may write first when a hook put a query of its own in place of the one the permission check left", async () => {
    rowsReadInTurn = [[row(ROW_A)]];

    service.uniqueCheck = async (
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<void> => {
      // The hook's own narrowing, in a new query.
      updateBy.query = {
        ...updateBy.query,
        isUnsubscribed: false,
      } as Query<StatusPageSubscriber>;

      await service.findRowsAndHoldUpdateToThem(updateBy, SELECT);
    };

    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    // The rows the caller may write, by their update permission, in the update's window.
    expect(updatableQuery).toHaveBeenCalledTimes(1);
    expect(readsOfRowsCallerMayWrite).toHaveLength(1);
    expect(readsOfRowsCallerMayWrite[0]!.query["labelsTheCallerMayWrite"]).toBe(
      true,
    );
    expect(readsOfRowsCallerMayWrite[0]!.skip).toBe(20);
    expect(readsOfRowsCallerMayWrite[0]!.limit).toBe(50);

    // Then the hook's query, within them.
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(readAt(0).query["isUnsubscribed"]).toBe(false);
    expect(idsNamedBy(readAt(0).query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(readAt(0).skip).toBe(0);
    expect(readAt(0).limit).toBe(2);

    expect(meetsCondition(writeReads[0]!.query["_id"], ROW_A)).toBe(true);
    expect(meetsCondition(writeReads[0]!.query["_id"], ROW_B)).toBe(false);
  });

  /*
   * A hook that changes the very query the permission check left - a
   * condition put in it, or one taken off it - has the rows the caller may
   * write read first too: what the query names is no longer what the check
   * passed.
   */
  it.each([
    [
      "put a condition in",
      (query: Record<string, unknown>): void => {
        query["isUnsubscribed"] = false;
      },
    ],
    [
      "took the project's condition off",
      (query: Record<string, unknown>): void => {
        delete query["projectId"];
      },
    ],
  ])(
    "reads the rows the caller may write first when a hook %s the query the permission check left, in place",
    async (
      _change: string,
      change: (query: Record<string, unknown>) => void,
    ) => {
      service.uniqueCheck = async (
        updateBy: UpdateBy<StatusPageSubscriber>,
      ): Promise<void> => {
        change(updateBy.query as Record<string, unknown>);
        await service.findRowsAndHoldUpdateToThem(updateBy, SELECT);
      };

      await expect(service.updateBy(update())).rejects.toThrow(
        WRITE_READ_REACHED,
      );

      expect(updatableQuery).toHaveBeenCalledTimes(1);
      expect(readsOfRowsCallerMayWrite).toHaveLength(1);
      expect(findBy).toHaveBeenCalledTimes(1);

      // The check's read is kept to the rows the caller may write.
      expect(idsNamedBy(readAt(0).query["_id"]).sort()).toEqual(
        [ROW_A, ROW_B].sort(),
      );
      expect(readAt(0).skip).toBe(0);
      expect(readAt(0).limit).toBe(2);
    },
  );

  it("reads within the rows read before the hooks for a service with a hook before the checks: one read of the rows the caller may write, and one by the check", async () => {
    useService(new ServiceWithHookBeforeTheChecks());
    service.uniqueCheck = readAndHold;

    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    // Before the hooks, once.
    expect(updatableQuery).toHaveBeenCalledTimes(1);
    expect(readsOfRowsCallerMayWrite).toHaveLength(1);

    // The check's read, within them.
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(idsNamedBy(readAt(0).query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
    expect(readAt(0).skip).toBe(0);
    expect(readAt(0).limit).toBe(2);
  });

  it("reads nothing for an update no check asks about", async () => {
    await expect(service.updateBy(update())).rejects.toThrow(
      WRITE_READ_REACHED,
    );

    expect(updatableQuery).not.toHaveBeenCalled();
    expect(readsOfRowsCallerMayWrite).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();

    // The write reads by the permission check's query, in the update's window.
    expect(writeReads[0]!.query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });
    expect(writeReads[0]!.skip).toBe(20);
    expect(writeReads[0]!.limit).toBe(50);
  });
});

describe("DatabaseService.findProjectsOfRowsAndHoldUpdateToThem", () => {
  const OTHER_PROJECT_ID: ObjectID = new ObjectID(
    "5e000000-0000-4000-8000-000000000009",
  );

  function inProject(id: string, projectId: ObjectID): StatusPageSubscriber {
    const subscriber: StatusPageSubscriber = row(id);
    subscriber.projectId = projectId;
    return subscriber;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers each project of the rows the update writes once, and holds the update to those rows", async () => {
    const service: DatabaseService<StatusPageSubscriber> =
      new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);

    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findBy",
    ).mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
      return [
        inProject(ROW_A, PROJECT_ID),
        inProject(ROW_B, PROJECT_ID),
        inProject(ROW_C, OTHER_PROJECT_ID),
      ];
    });

    const updateBy: UpdateBy<StatusPageSubscriber> = {
      query: { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: { isRoot: true },
      skip: 10000,
      limit: 3,
    } as unknown as UpdateBy<StatusPageSubscriber>;

    const projectIds: Array<ObjectID> =
      await service.findProjectsOfRowsAndHoldUpdateToThem(updateBy);

    expect(
      projectIds
        .map((projectId: ObjectID): string => {
          return projectId.toString();
        })
        .sort(),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort());

    const read: { select: JSONObject; skip: number; limit: number } = findBy
      .mock.calls[0]![0] as {
      select: JSONObject;
      skip: number;
      limit: number;
    };

    expect(read.select).toEqual({ projectId: true, _id: true });
    expect(read.skip).toBe(10000);
    expect(read.limit).toBe(3);

    expect(
      idsNamedBy((updateBy.query as unknown as JSONObject)["_id"]).sort(),
    ).toEqual([ROW_A, ROW_B, ROW_C].sort());
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(3);
  });

  it("answers none, and reads nothing, for a model with no project", async () => {
    const service: DatabaseService<User> = new DatabaseService<User>(User);
    const findBy: jest.SpyInstance = getJestSpyOn(service, "findBy");

    await expect(
      service.findProjectsOfRowsAndHoldUpdateToThem({
        query: {},
        data: {},
        props: { isRoot: true },
        skip: 0,
        limit: LIMIT_MAX,
      } as unknown as UpdateBy<User>),
    ).resolves.toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});

/*
 * THE PROJECTS A CHECK OF THE ROWS IT READ ASKS IN.
 *
 * A check that read the rows an update writes (findRowsAndHoldUpdateToThem)
 * asks about the records they name in the project the update is kept to -
 * a teammate's request's - and, for OneUptime and a master admin, whose
 * writes reach any row their query names, in each row's own project. It
 * reads nothing more.
 */
describe("DatabaseService.getProjectsToCheckRowsIn", () => {
  const OTHER_PROJECT_ID: ObjectID = new ObjectID(
    "5e000000-0000-4000-8000-000000000009",
  );

  function inProject(id: string, projectId?: ObjectID): StatusPageSubscriber {
    const subscriber: StatusPageSubscriber = row(id);

    if (projectId) {
      subscriber.projectId = projectId;
    }

    return subscriber;
  }

  function asStrings(projectIds: Array<ObjectID>): Array<string> {
    return projectIds
      .map((projectId: ObjectID): string => {
        return projectId.toString();
      })
      .sort();
  }

  const ROWS_IN_TWO_PROJECTS: Array<StatusPageSubscriber> = [
    inProject(ROW_A, PROJECT_ID),
    inProject(ROW_B, OTHER_PROJECT_ID),
    inProject(ROW_C, PROJECT_ID),
  ];

  let service: DatabaseService<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;

  beforeEach(() => {
    service = new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);
    findBy = getJestSpyOn(service, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers the request's project for a teammate's write, whatever the rows name", () => {
    expect(
      asStrings(
        service.getProjectsToCheckRowsIn(
          {
            tenantId: PROJECT_ID,
            userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
          } as DatabaseCommonInteractionProps,
          ROWS_IN_TWO_PROJECTS,
        ),
      ),
    ).toEqual([PROJECT_ID.toString()]);
    expect(findBy).not.toHaveBeenCalled();
  });

  it("answers each project of the rows once for OneUptime's write and a master admin's, with or without a project on the request", () => {
    for (const props of [
      { isRoot: true },
      { isRoot: true, tenantId: PROJECT_ID },
      { isMasterAdmin: true, tenantId: OTHER_PROJECT_ID },
    ]) {
      expect(
        asStrings(
          service.getProjectsToCheckRowsIn(
            props as DatabaseCommonInteractionProps,
            ROWS_IN_TWO_PROJECTS,
          ),
        ),
      ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort());
    }

    expect(findBy).not.toHaveBeenCalled();
  });

  it("answers no project for rows that name none, or a model with none", () => {
    expect(
      service.getProjectsToCheckRowsIn(
        { isRoot: true } as DatabaseCommonInteractionProps,
        [inProject(ROW_A)],
      ),
    ).toEqual([]);

    expect(
      new DatabaseService<User>(User).getProjectsToCheckRowsIn(
        { isRoot: true } as DatabaseCommonInteractionProps,
        [new User()],
      ),
    ).toEqual([]);
  });
});

/*
 * A CHECK THAT APPLIES ONLY TO AN UPDATE OF ONE ROW READS TWO ROWS AT MOST.
 *
 * Two rows read tell an update of one row from one of more, however many it
 * writes. The one row is read as findRowsAndHoldUpdateToThem reads rows,
 * and the update is held to it; an update of more than one row is left as
 * it is, for the check to refuse it or to let it be - it is never held to
 * the two rows that happened to be read.
 */
describe("DatabaseService.findOneRowAndHoldUpdateToIt", () => {
  interface OneRowAnUpdateWrites {
    findOneRowAndHoldUpdateToIt(
      updateBy: UpdateBy<StatusPageSubscriber>,
      select: Select<StatusPageSubscriber>,
    ): Promise<{ row: StatusPageSubscriber | null; writesMore: boolean }>;
  }

  class ServiceWithUpdateHook extends DatabaseService<StatusPageSubscriber> {
    public constructor() {
      super(StatusPageSubscriber);
    }

    protected override async onBeforeUpdate(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<OnUpdate<StatusPageSubscriber>> {
      return { updateBy, carryForward: null };
    }
  }

  let service: ServiceWithUpdateHook;
  let rowsRead: Array<StatusPageSubscriber>;
  let findBy: jest.SpyInstance;

  function oneRow(): OneRowAnUpdateWrites {
    return service as unknown as OneRowAnUpdateWrites;
  }

  function update(props: JSONObject): UpdateBy<StatusPageSubscriber> {
    return {
      query: { statusPageId: STATUS_PAGE_ID },
      data: { isSubscribedToAllResources: false },
      props: props as unknown as DatabaseCommonInteractionProps,
      skip: 7,
      limit: 500,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  beforeEach(() => {
    service = new ServiceWithUpdateHook();
    rowsRead = [row(ROW_A)];

    findBy = getJestSpyOn(service, "findBy").mockImplementation(
      async (read: { limit: number }): Promise<Array<StatusPageSubscriber>> => {
        return rowsRead.slice(0, read.limit);
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads two of OneUptime's rows at most, in the update's window, and holds the update to the one it writes", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = update({ isRoot: true });

    const written: { row: StatusPageSubscriber | null; writesMore: boolean } =
      await oneRow().findOneRowAndHoldUpdateToIt(updateBy, SELECT);

    expect(written.writesMore).toBe(false);
    expect(written.row?._id).toBe(ROW_A);

    const read: { query: JSONObject; skip: number; limit: number } = findBy.mock
      .calls[0]![0] as { query: JSONObject; skip: number; limit: number };

    expect(read.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(read.skip).toBe(7);
    expect(read.limit).toBe(2);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(1);
  });

  it("answers that an update writes more than one row, and leaves it as it is", async () => {
    rowsRead = [row(ROW_A), row(ROW_B), row(ROW_C)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({ isRoot: true });
    const query: unknown = updateBy.query;

    await expect(
      oneRow().findOneRowAndHoldUpdateToIt(updateBy, SELECT),
    ).resolves.toEqual({ row: null, writesMore: true });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(updateBy.query).toBe(query);
    expect(updateBy.skip).toBe(7);
    expect(updateBy.limit).toBe(500);
  });

  it("answers no row for an update that writes none, and holds it to none", async () => {
    rowsRead = [];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({ isRoot: true });

    await expect(
      oneRow().findOneRowAndHoldUpdateToIt(updateBy, SELECT),
    ).resolves.toEqual({ row: null, writesMore: false });

    expect(
      idsNamedBy((updateBy.query as unknown as JSONObject)["_id"]),
    ).toEqual([]);
  });

  it("reads a teammate's rows among the ones they may write, two at most", async () => {
    getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return query;
      },
    );

    // The caller may write A, B and C; the update is read within them.
    getJestSpyOn(service, "_findBy").mockImplementation(
      async (): Promise<Array<StatusPageSubscriber>> => {
        return [row(ROW_A), row(ROW_B), row(ROW_C)];
      },
    );

    rowsRead = [row(ROW_B), row(ROW_C)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      tenantId: PROJECT_ID,
      userId: new ObjectID("5d000000-0000-4000-8000-000000000001"),
    });

    await expect(
      oneRow().findOneRowAndHoldUpdateToIt(updateBy, SELECT),
    ).resolves.toEqual({ row: null, writesMore: true });

    const read: { query: JSONObject; skip: number; limit: number } = findBy.mock
      .calls[0]![0] as { query: JSONObject; skip: number; limit: number };

    expect(idsNamedBy(read.query["_id"]).sort()).toEqual(
      [ROW_A, ROW_B, ROW_C].sort(),
    );
    expect(read.skip).toBe(0);
    expect(read.limit).toBe(2);
  });
});

describe("DatabaseService.getOneRowIdNamedBy", () => {
  it("answers the one row a query names by a plain id", () => {
    expect(DatabaseService.getOneRowIdNamedBy({ _id: ROW_A })?.toString()).toBe(
      ROW_A,
    );

    const id: ObjectID = new ObjectID(ROW_B);

    expect(DatabaseService.getOneRowIdNamedBy({ _id: id })).toBe(id);
  });

  it("answers no row for a query that names its rows some other way", () => {
    expect(
      DatabaseService.getOneRowIdNamedBy({
        _id: QueryHelper.any([ROW_A, ROW_B]),
      }),
    ).toBeNull();
    expect(
      DatabaseService.getOneRowIdNamedBy({ _id: QueryHelper.any([]) }),
    ).toBeNull();
    expect(
      DatabaseService.getOneRowIdNamedBy({ statusPageId: STATUS_PAGE_ID }),
    ).toBeNull();
    expect(DatabaseService.getOneRowIdNamedBy({ _id: "  " })).toBeNull();
    expect(DatabaseService.getOneRowIdNamedBy([{ _id: ROW_A }])).toBeNull();
    expect(DatabaseService.getOneRowIdNamedBy(undefined)).toBeNull();
  });
});
