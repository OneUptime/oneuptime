import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * HOW THE EXCEPTIONS LIST READS EVERY EXCEPTION THAT MATCHES
 * (ExceptionListRead): "Select every matching exception across pages, not
 * just the page shown: the list has no read-all path yet" - the maintainer's
 * follow-up to #5344.
 *
 * The list's own read already counts the whole match (its pagination says
 * "of 4,213"); every match is read through the same list route, with the
 * list's own query and columns, a thousand at a time, up to the most one
 * selection holds - in the list's order with the exception's id after it,
 * so no exception lands on two pages while another is never read.
 */

interface ListCall {
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

const listCalls: Array<ListCall> = [];
let matching: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: ListCall): Promise<unknown> => {
        listCalls.push(request);

        return {
          data: matching.slice(request.skip, request.skip + request.limit),
          count: matching.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
    },
  };
});

import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  BULK_SELECT_ALL_PAGE_SIZE,
  EveryMatch,
} from "../../../UI/Components/BulkUpdate/BulkSelectAll";
import {
  EXCEPTION_LIST_SELECT,
  getEveryMatchSort,
  readEveryMatchingException,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionListRead";
import { ExceptionListSort } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAssignment";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

function exceptions(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      _id: `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      fingerprint: `fp-${index + 1}`,
      exceptionType: "TypeError",
      message: `x is undefined (${index + 1})`,
      isResolved: false,
      isArchived: false,
    };
  });
}

const QUERY: Query<TelemetryException> = {
  projectId: new ObjectID(PROJECT_ID),
  isResolved: false,
  isArchived: false,
};

beforeEach(() => {
  listCalls.length = 0;
  matching = [];
});

describe("reading every exception that matches", () => {
  test("reads the whole match a thousand at a time, with the list's own query", async () => {
    matching = exceptions(2345);

    const match: EveryMatch<TelemetryException> | null =
      await readEveryMatchingException({
        query: QUERY,
        sort: ExceptionListSort.LastSeen,
        isSuperseded: (): boolean => {
          return false;
        },
      });

    expect(match!.items).toHaveLength(2345);
    expect(match!.totalCount).toBe(2345);
    expect(match!.isTruncated).toBe(false);
    expect(
      listCalls.map((call: ListCall): Array<number> => {
        return [call.skip, call.limit];
      }),
    ).toEqual([
      [0, BULK_SELECT_ALL_PAGE_SIZE],
      [1000, BULK_SELECT_ALL_PAGE_SIZE],
      [2000, BULK_SELECT_ALL_PAGE_SIZE],
    ]);

    for (const call of listCalls) {
      // The list's query, untouched: only what the list shows is read.
      expect(call.query).toBe(QUERY);
    }
  });

  test("reads the columns a row draws and its menus read, the list's own", async () => {
    matching = exceptions(3);

    await readEveryMatchingException({
      query: QUERY,
      sort: ExceptionListSort.LastSeen,
      isSuperseded: (): boolean => {
        return false;
      },
    });

    expect(listCalls[0]!.select).toBe(EXCEPTION_LIST_SELECT);
    // What Bulk Actions decides by: the two switches, the release, the owner.
    for (const column of [
      "isResolved",
      "isArchived",
      "lastSeenInRelease",
      "assignToUserId",
      "assignToTeamId",
      "exceptionType",
      "message",
      "fingerprint",
    ]) {
      expect(EXCEPTION_LIST_SELECT).toHaveProperty(column, true);
    }
  });

  test.each([
    [ExceptionListSort.LastSeen, { lastSeenAt: SortOrder.Descending }],
    [
      ExceptionListSort.FirstSeen,
      { firstSeenAt: SortOrder.Descending, lastSeenAt: SortOrder.Descending },
    ],
    [
      ExceptionListSort.MostEvents,
      {
        occuranceCount: SortOrder.Descending,
        lastSeenAt: SortOrder.Descending,
      },
    ],
  ])(
    "reads in the list's order (%s), the exception's id after it so no two pages share one",
    async (sort: ExceptionListSort, order: Record<string, SortOrder>) => {
      matching = exceptions(2);

      await readEveryMatchingException({
        query: QUERY,
        sort: sort,
        isSuperseded: (): boolean => {
          return false;
        },
      });

      expect(listCalls[0]!.sort).toEqual({
        ...order,
        _id: SortOrder.Ascending,
      });
      expect(Object.keys(listCalls[0]!.sort).pop()).toBe("_id");
      expect(getEveryMatchSort(sort)).toEqual(listCalls[0]!.sort);
    },
  );

  test("stops at the most one selection holds, and says more matched", async () => {
    matching = exceptions(LIMIT_PER_PROJECT + 5);

    const match: EveryMatch<TelemetryException> | null =
      await readEveryMatchingException({
        query: QUERY,
        sort: ExceptionListSort.LastSeen,
        isSuperseded: (): boolean => {
          return false;
        },
      });

    expect(match!.items).toHaveLength(LIMIT_PER_PROJECT);
    expect(match!.totalCount).toBe(LIMIT_PER_PROJECT + 5);
    expect(match!.isTruncated).toBe(true);
    expect(listCalls).toHaveLength(
      LIMIT_PER_PROJECT / BULK_SELECT_ALL_PAGE_SIZE,
    );
  });

  test("a read superseded part-way stops, and selects nothing", async () => {
    matching = exceptions(2500);
    let reads: number = 0;

    const match: EveryMatch<TelemetryException> | null =
      await readEveryMatchingException({
        query: QUERY,
        sort: ExceptionListSort.LastSeen,
        isSuperseded: (): boolean => {
          reads++;
          return reads > 1;
        },
      });

    expect(match).toBeNull();
    expect(listCalls).toHaveLength(2);
  });
});
