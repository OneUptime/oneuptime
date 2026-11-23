import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHO DELETED A RECORD, NAMED BY A READ OR A WRITE AFTER THE COLUMN WENT
 * (#10469).
 *
 * deletedByUserId and deletedByUser are gone from every model, and the API
 * refuses a select, a sort or a query that names a column a model does not
 * have. So DatabaseService reads them as they always were, before any hook
 * or check sees the request (RetiredColumns): a select and a sort leave them
 * out, a value a write sends is dropped, and a query reads them as empty on
 * every record - one that no record could match reads nothing, counts 0 and
 * writes nothing, and asks nothing of a hook or the database. These drive
 * the real service up to the first step after the rule;
 * RetiredColumnsPostgres runs reads through to Postgres.
 */

const RECORD_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";
const SOMEBODY: string = "0193c0de-aaaa-4aaa-8bbb-0000000000f2";

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// Where a spied step stops the request, once the rule has run.
class Stop extends Error {}

function service(): DatabaseService<Monitor> {
  return new DatabaseService<Monitor>(Monitor);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a read that names who deleted a record", () => {
  test("with a value no record held reads nothing, and asks nothing of a hook or the database", async () => {
    const monitors: DatabaseService<Monitor> = service();
    const narrow: jest.SpyInstance = getJestSpyOn(monitors, "narrowRead");

    for (const condition of [SOMEBODY, { name: "Alex" }]) {
      await expect(
        monitors.findBy({
          query: { deletedByUserId: condition } as never,
          select: { name: true },
          skip: 0,
          limit: 10,
          props: ROOT,
        }),
      ).resolves.toEqual([]);
    }

    for (const query of [
      { deletedByUser: { name: "Alex" } },
      // Through a relation: its record held the same nothing.
      { project: { deletedByUserId: SOMEBODY } },
    ]) {
      await expect(
        monitors.findBy({
          query: query as never,
          select: { name: true },
          skip: 0,
          limit: 10,
          props: ROOT,
        }),
      ).resolves.toEqual([]);
    }

    expect(narrow).not.toHaveBeenCalled();
  });

  test("leaves it out of the select, the sort, the group by and the query, and reads the rest", async () => {
    const monitors: DatabaseService<Monitor> = service();
    let seen: JSONObject | undefined = undefined;

    getJestSpyOn(monitors, "narrowRead").mockImplementation(
      async (findBy: unknown): Promise<never> => {
        seen = { ...(findBy as JSONObject) };
        throw new Stop();
      },
    );

    const select: JSONObject = {
      name: true,
      deletedByUserId: true,
      deletedByUser: { name: true },
    };
    const sort: JSONObject = {
      deletedByUserId: SortOrder.Ascending,
      name: SortOrder.Descending,
      project: {
        deletedByUserId: SortOrder.Ascending,
        name: SortOrder.Ascending,
      },
    };
    const query: JSONObject = {
      name: "API",
      deletedByUserId: new IsNull() as unknown as JSONObject,
      project: { deletedByUserId: null },
    };

    await expect(
      monitors.findBy({
        query: query as never,
        select: select as never,
        sort: sort as never,
        groupBy: { deletedByUserId: true } as never,
        skip: 0,
        limit: 10,
        props: ROOT,
      }),
    ).rejects.toBeInstanceOf(Stop);

    expect(seen!["select"]).toEqual({ name: true });
    expect(seen!["sort"]).toEqual({
      name: SortOrder.Descending,
      project: { name: SortOrder.Ascending },
    });
    expect(seen!["query"]).toEqual({ name: "API" });
    expect(seen!["groupBy"]).toEqual({});

    // The caller's own objects are as they were.
    expect(Object.keys(select)).toEqual([
      "name",
      "deletedByUserId",
      "deletedByUser",
    ]);
    expect(Object.keys(sort)).toEqual(["deletedByUserId", "name", "project"]);
    expect(Object.keys(sort["project"] as JSONObject)).toEqual([
      "deletedByUserId",
      "name",
    ]);
    expect(Object.keys(query)).toEqual(["name", "deletedByUserId", "project"]);
  });

  test("that names none is handed on as it was, the same objects", async () => {
    const monitors: DatabaseService<Monitor> = service();
    let seen: JSONObject | undefined = undefined;

    getJestSpyOn(monitors, "narrowRead").mockImplementation(
      async (findBy: unknown): Promise<never> => {
        seen = { ...(findBy as JSONObject) };
        throw new Stop();
      },
    );

    const select: JSONObject = { name: true };
    const query: JSONObject = { name: "API" };

    await expect(
      monitors.findBy({
        query: query as never,
        select: select as never,
        skip: 0,
        limit: 10,
        props: ROOT,
      }),
    ).rejects.toBeInstanceOf(Stop);

    expect(seen!["select"]).toBe(select);
    expect(seen!["query"]).toBe(query);
    expect(Object.keys(seen!)).not.toContain("groupBy");
  });

  test("a count by a value no record held is 0, and asks nothing of the database", async () => {
    const check: jest.SpyInstance = getJestSpyOn(
      ModelPermission,
      "checkReadQueryPermission",
    );

    const count: number = (
      await service().countBy({
        query: { deletedByUserId: SOMEBODY } as never,
        props: ROOT,
      })
    ).toNumber();

    expect(count).toBe(0);
    expect(check).not.toHaveBeenCalled();
  });

  test("a count by an empty one counts what the rest of the query names", async () => {
    let asked: JSONObject | undefined = undefined;

    getJestSpyOn(
      ModelPermission,
      "checkReadQueryPermission",
    ).mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<never> => {
        asked = { ...(query as JSONObject) };
        throw new Stop();
      },
    );

    await expect(
      service().countBy({
        query: { name: "API", deletedByUserId: null } as never,
        props: ROOT,
      }),
    ).rejects.toBeInstanceOf(Stop);

    expect(asked).toEqual({ name: "API" });
  });
});

describe("an update that names who deleted a record", () => {
  test("drops the value it sends, and writes the rest", async () => {
    const monitors: DatabaseService<Monitor> = service();
    let written: JSONObject | undefined = undefined;

    getJestSpyOn(monitors, "sanitizeUpdateData").mockImplementation(
      (data: unknown): never => {
        written = { ...(data as JSONObject) };
        throw new Stop();
      },
    );

    await expect(
      monitors.updateBy({
        query: { _id: RECORD_ID } as never,
        data: {
          name: "API",
          deletedByUserId: SOMEBODY,
          deletedByUser: { _id: SOMEBODY },
        } as never,
        skip: 0,
        limit: 1,
        props: ROOT,
      }),
    ).rejects.toBeInstanceOf(Stop);

    expect(written).toEqual({ name: "API" });
  });

  test("by id drops it before anything reads the update", async () => {
    const monitors: DatabaseService<Monitor> = service();
    let read: JSONObject | undefined = undefined;

    getJestSpyOn(monitors, "getListWriteOfUpdate").mockImplementation(
      async (updateById: unknown): Promise<never> => {
        read = {
          ...((updateById as { data: JSONObject }).data as JSONObject),
        };
        throw new Stop();
      },
    );

    await expect(
      monitors.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { name: "API", deletedByUserId: SOMEBODY } as never,
        props: ROOT,
      }),
    ).rejects.toBeInstanceOf(Stop);

    expect(read).toEqual({ name: "API" });
  });

  test("by a query no record could match writes nothing, and asks nothing", async () => {
    const monitors: DatabaseService<Monitor> = service();
    const sanitize: jest.SpyInstance = getJestSpyOn(
      monitors,
      "sanitizeUpdateData",
    );

    await expect(
      monitors.updateBy({
        query: { deletedByUserId: SOMEBODY } as never,
        data: { name: "API" } as never,
        skip: 0,
        limit: 100,
        props: ROOT,
      }),
    ).resolves.toBe(0);

    expect(sanitize).not.toHaveBeenCalled();
  });

  test("by a query that holds for every record writes what the rest of it names", async () => {
    const monitors: DatabaseService<Monitor> = service();

    getJestSpyOn(monitors, "sanitizeUpdateData").mockImplementation(
      (): never => {
        throw new Stop();
      },
    );

    const updateBy: { query: JSONObject } & Record<string, unknown> = {
      query: { _id: RECORD_ID, deletedByUserId: new IsNull() } as never,
      data: { name: "API" },
      skip: 0,
      limit: 1,
      props: ROOT,
    };

    await expect(monitors.updateBy(updateBy as never)).rejects.toBeInstanceOf(
      Stop,
    );

    expect(updateBy.query).toEqual({ _id: RECORD_ID });
  });
});

describe("a delete by a query that names who deleted a record", () => {
  test("that no record could match deletes nothing, and asks nothing", async () => {
    const monitors: DatabaseService<Monitor> = service();
    const caller: jest.SpyInstance = getJestSpyOn(
      monitors,
      "checkCallerBeforeHooks",
    );

    await expect(
      monitors.deleteBy({
        query: { deletedByUserId: SOMEBODY } as never,
        skip: 0,
        limit: 100,
        props: ROOT,
      }),
    ).resolves.toBe(0);
    await expect(
      monitors.hardDeleteBy({
        query: { deletedByUserId: SOMEBODY } as never,
        skip: 0,
        limit: 100,
        props: ROOT,
      }),
    ).resolves.toBe(0);

    expect(caller).not.toHaveBeenCalled();
  });

  test("that holds for every record deletes what the rest of it names - never more", async () => {
    const monitors: DatabaseService<Monitor> = service();

    getJestSpyOn(monitors, "checkCallerBeforeHooks").mockImplementation(
      async (): Promise<never> => {
        throw new Stop();
      },
    );

    for (const remove of ["deleteBy", "hardDeleteBy"] as const) {
      const deleteBy: { query: JSONObject } & Record<string, unknown> = {
        query: { _id: RECORD_ID, deletedByUserId: null } as never,
        skip: 0,
        limit: 1,
        props: ROOT,
      };

      await expect(monitors[remove](deleteBy as never)).rejects.toBeInstanceOf(
        Stop,
      );

      expect([remove, deleteBy.query]).toEqual([remove, { _id: RECORD_ID }]);
    }
  });
});
