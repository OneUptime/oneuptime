import DatabaseService from "../../../Server/Services/DatabaseService";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Every paged read here is LIMIT/OFFSET, and OFFSET only means anything
 * against an ordering with no ties. Rows that compare equal may come back in
 * any order, and nothing obliges Postgres to pick the same order for the query
 * that fetches page 1 and the query that fetches page 2 — so a tied row can be
 * served on both pages while another is served on neither. The user sees one
 * item listed twice.
 *
 * The Inventory list is where this bites hardest, and it is why it belongs in
 * the duplicate-items fix: it sorts on `lastSeenAt`, which the entity
 * reconciler rewrites for every live entity every few minutes, so the sort key
 * is being mutated between the two fetches by design rather than by bad luck.
 * The inventory mirror also stamps one identical `lastSeenAt` across a whole
 * page of rows at a time, which produces large exact-tie groups outright.
 *
 * The fix is to complete whatever sort the caller asked for into a total order
 * by appending the primary key, in the one place every paged read goes
 * through.
 */

type FindArgs = {
  order?: Record<string, unknown> | undefined;
  select?: Record<string, unknown> | undefined;
};

describe("DatabaseService._findBy completes a partial sort into a total order", () => {
  let service: DatabaseService<InventoryItem>;
  let find: jest.Mock;

  type FindByFunction = (
    sort?: Record<string, unknown> | undefined,
  ) => Promise<Array<InventoryItem>>;

  const findBy: FindByFunction = (
    sort?: Record<string, unknown> | undefined,
  ): Promise<Array<InventoryItem>> => {
    return service.findBy({
      query: {},
      limit: 10,
      skip: 0,
      select: { displayName: true } as any,
      ...(sort ? { sort: sort as any } : {}),
      props: { isRoot: true },
    });
  };

  const orderPassedToDatabase: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return (find.mock.calls[0]![0] as FindArgs).order || {};
  };

  beforeEach(() => {
    jest.restoreAllMocks();

    service = new DatabaseService<InventoryItem>(InventoryItem);

    find = jest
      .fn()
      .mockImplementation(async (): Promise<Array<InventoryItem>> => {
        return [];
      });

    jest.spyOn(service, "getRepository").mockReturnValue({ find: find } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("appends the primary key to a single-column sort", async () => {
    await findBy({ lastSeenAt: SortOrder.Descending });

    expect(orderPassedToDatabase()).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  it("keeps the caller's column first so the requested ordering is unchanged", async () => {
    await findBy({ lastSeenAt: SortOrder.Descending });

    expect(Object.keys(orderPassedToDatabase())).toEqual(["lastSeenAt", "_id"]);
  });

  it("appends the primary key to a multi-column sort", async () => {
    await findBy({
      entityType: SortOrder.Ascending,
      lastSeenAt: SortOrder.Descending,
    });

    expect(Object.keys(orderPassedToDatabase())).toEqual([
      "entityType",
      "lastSeenAt",
      "_id",
    ]);
  });

  it("appends the primary key to the default sort as well", async () => {
    await findBy(undefined);

    expect(orderPassedToDatabase()).toEqual({
      createdAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  it("leaves an explicit primary-key sort alone", async () => {
    await findBy({ _id: SortOrder.Descending });

    expect(orderPassedToDatabase()).toEqual({ _id: SortOrder.Descending });
  });

  it("does not add the primary key twice when it is already the tiebreaker", async () => {
    await findBy({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });

    expect(orderPassedToDatabase()).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  it("does not widen the projection — the primary key is already selected", async () => {
    await findBy({ lastSeenAt: SortOrder.Descending });

    const select: Record<string, unknown> = (find.mock.calls[0]![0] as FindArgs)
      .select as Record<string, unknown>;

    expect(select["_id"]).toBe(true);
    expect(select["displayName"]).toBe(true);
  });

  it("does not mutate the caller's own sort object", async () => {
    const callerSort: Record<string, unknown> = {
      lastSeenAt: SortOrder.Descending,
    };

    await findBy(callerSort);

    expect(callerSort).toEqual({ lastSeenAt: SortOrder.Descending });
  });
});
