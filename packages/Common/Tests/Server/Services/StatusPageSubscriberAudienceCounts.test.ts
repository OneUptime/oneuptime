import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { IncidentSubscriberAudienceCounts } from "../../../Types/StatusPage/IncidentSubscriberAudience";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * StatusPageSubscriberService.countActiveSubscribersByChannel: the counts the
 * audience summary shows before an incident or a public note is sent.
 *
 * These tests stub the database driver and pin down the query's contract:
 * it counts (never reads an address), it is pinned to the project, it counts
 * only the subscribers the jobs send to, and it reads the rows back into
 * per-page, per-channel numbers. StatusPageSubscriberAudienceCountsPostgres
 * runs the same query against a real Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";

let query: MockFunction;

beforeEach(() => {
  query = getJestMockFunction();
  query.mockResolvedValue([] as never);

  jest.spyOn(StatusPageSubscriberService, "getRepository").mockReturnValue({
    manager: {
      query: query,
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sql(): string {
  return (query.mock.calls[0]![0] as string).replace(/\s+/g, " ");
}

function params(): Array<unknown> {
  return query.mock.calls[0]![1] as Array<unknown>;
}

describe("StatusPageSubscriberService.countActiveSubscribersByChannel", () => {
  test("no status pages: no query at all", async () => {
    const counts: Dictionary<IncidentSubscriberAudienceCounts> =
      await StatusPageSubscriberService.countActiveSubscribersByChannel({
        projectId: PROJECT_ID,
        statusPageIds: [],
      });

    expect(counts).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });

  test("one aggregate query, grouped by status page", async () => {
    await StatusPageSubscriberService.countActiveSubscribersByChannel({
      projectId: PROJECT_ID,
      statusPageIds: [new ObjectID(PAGE_A), new ObjectID(PAGE_B)],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(sql()).toContain('FROM "StatusPageSubscriber"');
    expect(sql()).toContain('GROUP BY "statusPageId"');
  });

  test("it counts and never selects an address", async () => {
    await StatusPageSubscriberService.countActiveSubscribersByChannel({
      projectId: PROJECT_ID,
      statusPageIds: [new ObjectID(PAGE_A)],
    });

    // Everything between SELECT and FROM is the statusPageId and counts.
    const selected: string = sql().split(" FROM ")[0]!;
    const columns: Array<string> = selected
      .replace(/^ ?SELECT /, "")
      .split(/,(?![^(]*\))/)
      .map((column: string): string => {
        return column.trim();
      });

    expect(columns).toHaveLength(6);
    expect(columns[0]).toBe('"statusPageId"::text AS "statusPageId"');

    for (const column of columns.slice(1)) {
      expect(column).toMatch(
        /^COUNT\(\*\) FILTER \(WHERE .+\)::text AS "\w+"$/,
      );
    }
  });

  test("only the subscribers the jobs send to: confirmed, subscribed, not deleted", async () => {
    await StatusPageSubscriberService.countActiveSubscribersByChannel({
      projectId: PROJECT_ID,
      statusPageIds: [new ObjectID(PAGE_A)],
    });

    expect(sql()).toContain('"isUnsubscribed" = false');
    expect(sql()).toContain('"isSubscriptionConfirmed" = true');
    expect(sql()).toContain('"deletedAt" IS NULL');
  });

  test("pinned to the project, with the page ids as a bound parameter", async () => {
    await StatusPageSubscriberService.countActiveSubscribersByChannel({
      projectId: PROJECT_ID,
      statusPageIds: [
        new ObjectID(PAGE_A.toUpperCase()),
        new ObjectID(PAGE_A),
        new ObjectID(PAGE_B),
      ],
    });

    expect(sql()).toContain('"projectId" = $1');
    expect(sql()).toContain('"statusPageId" = ANY($2::uuid[])');
    expect(params()).toEqual([PROJECT_ID.toString(), [PAGE_A, PAGE_B]]);
  });

  test("reads the rows back as numbers, keyed by the lower-cased page id", async () => {
    query.mockResolvedValue([
      {
        statusPageId: PAGE_A.toUpperCase(),
        email: "41",
        sms: "3",
        slack: "0",
        microsoftTeams: "1",
        webhook: "2",
      },
      {
        statusPageId: PAGE_B,
        email: "18",
        sms: "0",
        slack: "0",
        microsoftTeams: "0",
        webhook: "0",
      },
    ] as never);

    const counts: Dictionary<IncidentSubscriberAudienceCounts> =
      await StatusPageSubscriberService.countActiveSubscribersByChannel({
        projectId: PROJECT_ID,
        statusPageIds: [new ObjectID(PAGE_A), new ObjectID(PAGE_B)],
      });

    expect(counts).toEqual({
      [PAGE_A]: {
        email: 41,
        sms: 3,
        slack: 0,
        microsoftTeams: 1,
        webhook: 2,
      },
      [PAGE_B]: {
        email: 18,
        sms: 0,
        slack: 0,
        microsoftTeams: 0,
        webhook: 0,
      },
    });
  });

  test("a garbled count reads as zero", async () => {
    query.mockResolvedValue([
      {
        statusPageId: PAGE_A,
        email: "abc",
        sms: null,
        slack: "-2",
        microsoftTeams: undefined,
        webhook: "7",
      },
    ] as never);

    const counts: Dictionary<IncidentSubscriberAudienceCounts> =
      await StatusPageSubscriberService.countActiveSubscribersByChannel({
        projectId: PROJECT_ID,
        statusPageIds: [new ObjectID(PAGE_A)],
      });

    expect(counts[PAGE_A]).toEqual({
      email: 0,
      sms: 0,
      slack: 0,
      microsoftTeams: 0,
      webhook: 7,
    });
  });
});
