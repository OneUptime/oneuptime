import DatabaseService from "../../../Server/Services/DatabaseService";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Select from "../../../Server/Types/Database/Select";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
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
 * them with findRowsAndHoldUpdateToThem: as OneUptime, pinned to the
 * request's project (hooks run before the framework scopes the update), in
 * the update's own window. The update is then held to the rows read: its
 * query names them by id, with a window that covers just them, so the write
 * - which narrows that by the caller's permissions - can never reach a row
 * the check did not see. A bulk update matching more rows than its window,
 * by a caller whose permissions leave some of them out, could otherwise
 * write a row past the window the check read.
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
  statusPageResources: { _id: true },
};

function row(id: string): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = id;
  return subscriber;
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

describe("DatabaseService.findRowsAndHoldUpdateToThem", () => {
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
        tenantId: PROJECT_ID,
        userId: ObjectID.generate(),
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

  it("reads the update's rows as OneUptime, pinned to the request's project, with what the check asks for and their ids", async () => {
    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(update({}), SELECT);

    const read: ReturnType<typeof readWith> = readWith();

    expect(read.query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });
    expect(read.select).toEqual({
      statusPageId: true,
      statusPageResources: { _id: true },
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

  it("does not pin OneUptime's own update, which names no project, nor a request across projects", async () => {
    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
      update({ props: { isRoot: true } }),
      SELECT,
    );

    expect(readWith().query).toEqual({ statusPageId: STATUS_PAGE_ID });

    findBy.mockClear();

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
      update({
        props: { tenantId: PROJECT_ID, isMultiTenantRequest: true },
      }),
      SELECT,
    );

    expect(readWith().query).toEqual({ statusPageId: STATUS_PAGE_ID });
  });

  it("pins every branch of an either-or query to the request's project", async () => {
    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
      update({
        query: [
          { statusPageId: STATUS_PAGE_ID },
          { _id: ROW_C },
        ] as unknown as Query<StatusPageSubscriber>,
      }),
      SELECT,
    );

    expect(readWith().query).toEqual([
      { statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID },
      { _id: ROW_C, projectId: PROJECT_ID },
    ]);
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
    // The update names A and B; only A is the request's project's.
    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      query: {
        _id: QueryHelper.any([ROW_A, ROW_B]),
      } as unknown as Query<StatusPageSubscriber>,
    });

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
  });

  it("holds an either-or update to the rows read by id alone", async () => {
    rowsRead = [row(ROW_A), row(ROW_C)];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      query: [
        { statusPageId: STATUS_PAGE_ID },
        { _id: ROW_C },
      ] as unknown as Query<StatusPageSubscriber>,
    });

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    const query: JSONObject = updateBy.query as unknown as JSONObject;

    expect(Object.keys(query)).toEqual(["_id"]);
    expect(idsNamedBy(query["_id"]).sort()).toEqual([ROW_A, ROW_C].sort());
    expect(updateBy.limit).toBe(2);
  });

  it("leaves an update that reaches no row as it is: it writes nothing either way", async () => {
    rowsRead = [];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({
      skip: 4,
      limit: 10,
    });

    const rows: Array<StatusPageSubscriber> =
      await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(
        updateBy,
        SELECT,
      );

    expect(rows).toEqual([]);
    expect(updateBy.query).toEqual({ statusPageId: STATUS_PAGE_ID });
    expect(updateBy.skip).toBe(4);
    expect(updateBy.limit).toBe(10);
  });

  it("leaves out a row read back without an id", async () => {
    const withoutId: StatusPageSubscriber = new StatusPageSubscriber();
    rowsRead = [row(ROW_A), withoutId];

    const updateBy: UpdateBy<StatusPageSubscriber> = update({});

    await rowsAnUpdateWrites().findRowsAndHoldUpdateToThem(updateBy, SELECT);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.limit).toBe(1);
  });
});
