import SecurityWatchlistItem from "../../../../../Models/DatabaseModels/SecurityWatchlistItem";
import SecurityWatchlistItemService from "../../../../../Server/Services/SecurityWatchlistItemService";
import SecurityWatchlistExpiry, {
  SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE,
  SECURITY_WATCHLIST_EXPIRY_MAX_BATCHES,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistExpiry";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * VALUES THAT LEAVE THEIR LIST (#5391): every minute, the values whose
 * moment to leave has come are deleted - through the delete every value
 * goes through, as OneUptime - a batch at a time, oldest first, one
 * project's at a time, so one project's trouble never keeps another's
 * values on their lists.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const PROJECT_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function item(index: number, projectId: string): SecurityWatchlistItem {
  const row: SecurityWatchlistItem = new SecurityWatchlistItem();
  row._id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  row.projectId = new ObjectID(projectId);
  return row;
}

function batch(
  size: number,
  projectId: string,
  start: number = 0,
): Array<SecurityWatchlistItem> {
  const rows: Array<SecurityWatchlistItem> = [];

  for (let index: number = 0; index < size; index++) {
    rows.push(item(start + index, projectId));
  }

  return rows;
}

function stubReads(...batches: Array<Array<SecurityWatchlistItem>>): Spy {
  const read: Spy = getJestSpyOn(SecurityWatchlistItemService, "findBy");

  for (const rows of batches) {
    read.mockResolvedValueOnce(rows as never);
  }

  read.mockResolvedValue([] as never);
  return read;
}

function stubDeletes(): Spy {
  return getJestSpyOn(
    SecurityWatchlistItemService,
    "deleteBy",
  ).mockResolvedValue(undefined as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityWatchlistExpiry.removeExpiredValues", () => {
  test("reads the values whose moment has come, oldest first, as OneUptime, 500 at a time", async () => {
    const read: Spy = stubReads([item(1, PROJECT_A)]);
    stubDeletes();

    await SecurityWatchlistExpiry.removeExpiredValues(NOW);

    const args: {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      limit: number;
      skip: number;
      props: JSONObject;
    } = read.mock.calls[0]![0] as never;
    const moment: FindOperator<Date> = args.query[
      "expiresAt"
    ] as unknown as FindOperator<Date>;

    expect(SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE).toBe(500);
    // At or before now: a value whose moment is this instant has left too.
    expect(moment.type).toBe("raw");
    expect(moment.getSql!("expiresAt")).toMatch(/^\(expiresAt <= :\w+\)$/);
    expect(Object.values(moment.objectLiteralParameters!)).toEqual([NOW]);
    expect(args.select).toEqual({ _id: true, projectId: true });
    expect(args.sort).toEqual({ expiresAt: SortOrder.Ascending });
    expect(args.limit).toBe(500);
    expect(args.skip).toBe(0);
    expect(args.props).toEqual({ isRoot: true });
  });

  test("deletes them through the values' own delete, one project's at a time, and says how many", async () => {
    stubReads([item(1, PROJECT_A), item(2, PROJECT_B), item(3, PROJECT_A)]);
    const remove: Spy = stubDeletes();

    await expect(
      SecurityWatchlistExpiry.removeExpiredValues(NOW),
    ).resolves.toBe(3);

    expect(remove).toHaveBeenCalledTimes(2);

    const first: { query: JSONObject; props: JSONObject } = remove.mock
      .calls[0]![0] as never;

    expect((first.query["projectId"] as ObjectID).toString()).toBe(PROJECT_A);
    expect((first.query["_id"] as Includes).values).toEqual([
      item(1, PROJECT_A)._id,
      item(3, PROJECT_A)._id,
    ]);
    expect(first.props).toEqual({ isRoot: true });
    expect(
      (
        (remove.mock.calls[1]![0] as { query: JSONObject }).query[
          "projectId"
        ] as ObjectID
      ).toString(),
    ).toBe(PROJECT_B);
  });

  test("none to take off: one read, no delete", async () => {
    const read: Spy = stubReads();
    const remove: Spy = stubDeletes();

    await expect(
      SecurityWatchlistExpiry.removeExpiredValues(NOW),
    ).resolves.toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  test("a full batch is followed by another, a short one ends the sweep", async () => {
    const read: Spy = stubReads(
      batch(SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE, PROJECT_A),
      batch(3, PROJECT_A, 1000),
    );
    stubDeletes();

    await expect(
      SecurityWatchlistExpiry.removeExpiredValues(NOW),
    ).resolves.toBe(SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE + 3);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("at most 20 batches a sweep: the rest go the minute after", async () => {
    const read: Spy = getJestSpyOn(
      SecurityWatchlistItemService,
      "findBy",
    ).mockImplementation((async () => {
      return batch(SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE, PROJECT_A);
    }) as never);
    stubDeletes();

    await SecurityWatchlistExpiry.removeExpiredValues(NOW);

    expect(SECURITY_WATCHLIST_EXPIRY_MAX_BATCHES).toBe(20);
    expect(read).toHaveBeenCalledTimes(SECURITY_WATCHLIST_EXPIRY_MAX_BATCHES);
  });

  test("one project's failed delete keeps no other project's values on their lists, and the next batch reads past it", async () => {
    const read: Spy = stubReads(
      [
        ...batch(SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE - 2, PROJECT_A),
        item(9001, PROJECT_B),
        item(9002, PROJECT_B),
      ],
      [item(9003, PROJECT_B)],
    );
    const remove: Spy = getJestSpyOn(
      SecurityWatchlistItemService,
      "deleteBy",
    ).mockImplementation((async (deleteBy: { query: JSONObject }) => {
      if ((deleteBy.query["projectId"] as ObjectID).toString() === PROJECT_A) {
        throw new Error("lock timeout");
      }
    }) as never);

    await expect(
      SecurityWatchlistExpiry.removeExpiredValues(NOW),
    ).resolves.toBe(3);
    expect(remove).toHaveBeenCalledTimes(3);
    // The values a delete failed for are still there: the next read skips them.
    expect((read.mock.calls[1]![0] as { skip: number }).skip).toBe(
      SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE - 2,
    );
  });
});
