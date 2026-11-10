import RumProductAnalyticsReadService from "../../../../Server/Utils/RumProductAnalytics/RumProductAnalyticsReadService";
import RumProductAnalyticsSessionService from "../../../../Server/Services/RumProductAnalyticsSessionService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_LIMIT,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDto,
} from "../../../../Types/Rum/ProductAnalytics";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The statements behind the product analytics pages (issue #6444), and how
 * their rows become the pages' numbers. What the statements COUNT is proved
 * against a real ClickHouse in App/Tests/Telemetry/
 * RumProductAnalyticsClickhouse.test.ts; this file pins what every
 * statement must be, whatever it counts - one project and one application,
 * bound; every session folded before it is counted; a time limit that
 * fails rather than truncates; and no name read unless the caller may see
 * names - and the arithmetic between the rows and the answer.
 */

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000b1");
const userKey: string = "ab".repeat(32);
const otherUserKey: string = "cd".repeat(32);
const visitorId: string = "0123456789abcdef0123456789abcdef";

const startTime: Date = new Date("2026-03-01T00:00:00.000Z");
const endTime: Date = new Date("2026-03-07T23:59:59.999Z");
const now: Date = new Date("2026-03-08T12:00:00.000Z");

const range: {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
} = {
  projectId: projectId,
  rumApplicationId: applicationId,
  startTime: startTime,
  endTime: endTime,
};

type Answer = (statement: Statement) => Array<JSONObject>;

let answer: Answer = (): Array<JSONObject> => {
  return [];
};

let statements: Array<Statement> = [];

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function everyStatement(check: (statement: Statement) => void): void {
  expect(statements.length).toBeGreaterThan(0);

  for (const statement of statements) {
    check(statement);
  }
}

function expectScopedAndLimited(): void {
  everyStatement((statement: Statement): void => {
    expect(params(statement)).toContain(projectId.toString());
    expect(params(statement)).toContain(applicationId.toString());
    expect(statement.query).toContain("max_execution_time = 45");
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    expect(statement.query).not.toMatch(/\bFINAL\b/);
  });
}

function expectNoName(): void {
  everyStatement((statement: Statement): void => {
    expect(statement.query).not.toContain("identifiedUserLabel");
    expect(params(statement)).not.toContain(AnalyticsTableName.RumSession);
  });
}

/*
 * Each read of the session table folds a session's rows before it counts.
 * The one exception is the read of when data started: whether any row
 * exists and the earliest start are the same before and after a merge.
 */
function expectSessionsFolded(): void {
  everyStatement((statement: Statement): void => {
    if (
      params(statement).includes(
        AnalyticsTableName.RumProductAnalyticsSession,
      ) &&
      !statement.query.includes("AS paRows")
    ) {
      expect(statement.query).toContain("GROUP BY sessionId, startTime");
    }
  });
}

beforeEach(() => {
  statements = [];
  answer = (): Array<JSONObject> => {
    return [];
  };

  jest
    .spyOn(RumProductAnalyticsSessionService, "executeQuery")
    .mockImplementation((async (statement: Statement): Promise<unknown> => {
      statements.push(statement);
      return resultSetOf(answer(statement));
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getSummary", () => {
  test("reads the range, the range before it and the history, every read scoped, folded and time-limited, none naming anyone", async () => {
    await RumProductAnalyticsReadService.getSummary({
      ...range,
      dormantAfterDays: 30,
      now: now,
    });

    /* Users and sessions for each of two ranges, the history, the first session. */
    expect(statements).toHaveLength(6);
    expectScopedAndLimited();
    expectSessionsFolded();
    expectNoName();
  });

  test("the range before is as long as the range and ends just before it", async () => {
    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 30,
        now: now,
      });

    expect(summary.previousEndTime).toBe(startTime.getTime() - 1);
    expect(summary.previousEndTime - summary.previousStartTime).toBe(
      endTime.getTime() - startTime.getTime(),
    );
    expect(summary.dormantAfterDays).toBe(30);
  });

  test("turns the rows into the page's numbers", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      const query: string = statement.query;

      if (query.includes("AS paActiveUsers")) {
        return [{ paActiveUsers: "10", paSignedInUsers: 4, paNewUsers: 3 }];
      }

      if (query.includes("AS paSessions,")) {
        return [
          {
            paSessions: 12,
            paSignedInSessions: 5,
            paFinishedSessions: 11,
            paMedianSessionMs: 61234.6,
            paAveragePages: 2.5,
            paErrorSessions: 2,
            paFrustratedSessions: 1,
            paLength0: 1,
            paLength1: 2,
            paLength6: 8,
          },
        ];
      }

      if (query.includes("AS paTotalUsers")) {
        return [{ paTotalUsers: 40, paDormantUsers: 25 }];
      }

      if (query.includes("AS paRows")) {
        return [{ paRows: 7, paFirst: 1700000000000 }];
      }

      return [];
    };

    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 30,
        now: now,
      });

    expect(summary.current).toEqual({
      activeUsers: 10,
      signedInUsers: 4,
      anonymousUsers: 6,
      newUsers: 3,
      returningUsers: 7,
      sessions: 12,
      signedInSessions: 5,
      finishedSessions: 11,
      medianSessionMs: 61235,
      averagePagesPerSession: 2.5,
      errorSessions: 2,
      frustratedSessions: 1,
      sessionLengths: [1, 2, 0, 0, 0, 0, 8],
    });
    expect(summary.current.sessionLengths).toHaveLength(
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.length,
    );
    expect(summary.totalUsers).toBe(40);
    expect(summary.dormantUsers).toBe(25);
    expect(summary.dataStartedAt).toBe(1700000000000);
  });

  test("an application with nothing yet answers zeros and no start", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      return statement.query.includes("AS paRows")
        ? [{ paRows: 0, paFirst: 0 }]
        : [];
    };

    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 7,
        now: now,
      });

    expect(summary.current.activeUsers).toBe(0);
    expect(summary.current.sessionLengths).toEqual(
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map((): number => {
        return 0;
      }),
    );
    expect(summary.totalUsers).toBe(0);
    expect(summary.dataStartedAt).toBeNull();
  });

  test("a count that is not a number reads as zero, never NaN", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      return statement.query.includes("AS paActiveUsers")
        ? [{ paActiveUsers: "nan", paSignedInUsers: null, paNewUsers: "inf" }]
        : [];
    };

    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 30,
        now: now,
      });

    expect(summary.current.activeUsers).toBe(0);
    expect(summary.current.signedInUsers).toBe(0);
    expect(summary.current.newUsers).toBe(0);
  });

  test("the read of when data started needs no fold: it reads only whether a row exists and the earliest start", async () => {
    await RumProductAnalyticsReadService.getDataStartedAt({
      projectId: projectId,
      rumApplicationId: applicationId,
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.query).toMatch(
      /^SELECT toFloat64\(count\(\)\) AS paRows, toFloat64\(toUnixTimestamp64Milli\(min\(startTime\)\)\) AS paFirst FROM /,
    );
    expectScopedAndLimited();
  });

  test("dormant counts back from now by the window asked for", async () => {
    await RumProductAnalyticsReadService.getHistory({
      projectId: projectId,
      rumApplicationId: applicationId,
      dormantAfterDays: 14,
      now: now,
    });

    const dormantBefore: number = now.getTime() - 14 * 86400000;

    expect(
      params(statements[0]!).some((value: unknown): boolean => {
        return (
          typeof value === "string" &&
          new Date(`${value.replace(" ", "T")}Z`).getTime() === dormantBefore
        );
      }),
    ).toBe(true);
  });
});

describe("getTrend", () => {
  test("reads days in the zone asked for, bound as a value, over 7 and 30 day windows", async () => {
    await RumProductAnalyticsReadService.getTrend({
      ...range,
      timeZone: "Europe/Berlin",
    });

    expect(statements).toHaveLength(3);
    expectScopedAndLimited();
    expectSessionsFolded();
    expectNoName();

    everyStatement((statement: Statement): void => {
      expect(statement.query).not.toContain("Europe/Berlin");
      expect(params(statement)).toContain("Europe/Berlin");
    });

    const active: Statement = statements[0]!;

    expect(active.query).toContain("RANGE BETWEEN 6 PRECEDING AND CURRENT ROW");
    expect(active.query).toContain(
      "RANGE BETWEEN 29 PRECEDING AND CURRENT ROW",
    );
    /* Every day is there: the empty ones are filled in. */
    expect(active.query).toContain("uniqStateIf('', 0)");
    expect(active.query).toContain("FROM numbers(");
  });

  test("puts each day's new, returning and per-device sessions on the day", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      const query: string = statement.query;

      if (query.includes("AS paWeekly")) {
        return [
          { paDayText: "2026-03-01", paDaily: 3, paWeekly: 3, paMonthly: 5 },
          { paDayText: "2026-03-02", paDaily: 0, paWeekly: 3, paMonthly: 5 },
        ];
      }

      if (query.includes("AS paNew")) {
        return [
          { paDayText: "2026-03-01", paActive: 3, paNew: 1 },
          /* A day outside the range is dropped. */
          { paDayText: "2026-02-28", paActive: 9, paNew: 9 },
        ];
      }

      if (query.includes("AS paDevice")) {
        return [
          { paDayText: "2026-03-01", paDevice: "desktop", paSessions: 2 },
          { paDayText: "2026-03-01", paDevice: "mobile", paSessions: 1 },
          { paDayText: "2026-03-01", paDevice: "tablet", paSessions: 4 },
          { paDayText: "2026-03-01", paDevice: "", paSessions: 1 },
          { paDayText: "2026-03-09", paDevice: "desktop", paSessions: 6 },
        ];
      }

      return [];
    };

    const trend: ProductAnalyticsTrendDto =
      await RumProductAnalyticsReadService.getTrend({
        ...range,
        timeZone: "UTC",
      });

    expect(trend.timeZone).toBe("UTC");
    expect(trend.days).toEqual([
      {
        day: "2026-03-01",
        activeUsers: 3,
        weeklyActiveUsers: 3,
        monthlyActiveUsers: 5,
        newUsers: 1,
        returningUsers: 2,
        sessions: 8,
        desktopSessions: 2,
        mobileSessions: 1,
        tabletSessions: 4,
        otherSessions: 1,
      },
      {
        day: "2026-03-02",
        activeUsers: 0,
        weeklyActiveUsers: 3,
        monthlyActiveUsers: 5,
        newUsers: 0,
        returningUsers: 0,
        sessions: 0,
        desktopSessions: 0,
        mobileSessions: 0,
        tabletSessions: 0,
        otherSessions: 0,
      },
    ]);
  });
});

describe("getBreakdown", () => {
  test.each(PRODUCT_ANALYTICS_DIMENSIONS)(
    "%s: scoped, folded, time-limited, nameless, and capped one past the page",
    async (dimension: ProductAnalyticsDimension) => {
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: dimension,
      });

      expect(statements).toHaveLength(2);
      expectScopedAndLimited();
      expectSessionsFolded();
      expectNoName();
      expect(params(statements[0]!)).toContain(
        PRODUCT_ANALYTICS_BREAKDOWN_LIMIT + 1,
      );

      /* Only the pages are joined out: a session counts once on each page it saw. */
      if (dimension === ProductAnalyticsDimension.Page) {
        expect(statements[0]!.query).toContain(
          "ARRAY JOIN if(empty(paPages), [''], paPages) AS paValue",
        );
      } else {
        expect(statements[0]!.query).not.toContain("ARRAY JOIN");
      }
    },
  );

  test("reads the column each dimension names", async () => {
    const columns: Record<string, string> = {
      [ProductAnalyticsDimension.DeviceType]: "max(deviceType) AS paValue",
      [ProductAnalyticsDimension.Browser]: "max(browserName) AS paValue",
      [ProductAnalyticsDimension.OperatingSystem]: "max(osName) AS paValue",
      [ProductAnalyticsDimension.Country]: "max(countryCode) AS paValue",
      [ProductAnalyticsDimension.AppVersion]: "max(appVersion) AS paValue",
      [ProductAnalyticsDimension.EntryPage]: "max(entryPage) AS paValue",
      [ProductAnalyticsDimension.Page]: "groupUniqArrayArray(pages) AS paPages",
    };

    for (const dimension of PRODUCT_ANALYTICS_DIMENSIONS) {
      statements = [];

      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: dimension,
      });

      expect(statements[0]!.query).toContain(columns[dimension]);
    }
  });

  test("a full page says there is more, and the totals come with it", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      if (statement.query.includes("GROUP BY paValue")) {
        return Array.from(
          { length: PRODUCT_ANALYTICS_BREAKDOWN_LIMIT + 1 },
          (_unused: unknown, index: number): JSONObject => {
            return { paValue: `/page-${index}`, paUsers: 2, paSessions: 3 };
          },
        );
      }

      return [{ paUsers: 20, paSessions: 90 }];
    };

    const breakdown: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.Page,
      });

    expect(breakdown.dimension).toBe(ProductAnalyticsDimension.Page);
    expect(breakdown.rows).toHaveLength(PRODUCT_ANALYTICS_BREAKDOWN_LIMIT);
    expect(breakdown.rows[0]).toEqual({
      value: "/page-0",
      users: 2,
      sessions: 3,
    });
    expect(breakdown.hasMore).toBe(true);
    expect(breakdown.totalUsers).toBe(20);
    expect(breakdown.totalSessions).toBe(90);
  });
});

describe("listPeople", () => {
  async function list(
    filter: ProductAnalyticsPeopleFilter,
    extra?: {
      includeLabel?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ProductAnalyticsPeopleDto> {
    return await RumProductAnalyticsReadService.listPeople({
      ...range,
      filter: filter,
      dormantAfterDays: 30,
      now: now,
      limit: extra?.limit ?? 50,
      offset: extra?.offset ?? 0,
      includeLabel: extra?.includeLabel ?? false,
      search: extra?.search,
    });
  }

  function personRow(personKey: string, lastSeen: number): JSONObject {
    return {
      paPersonKey: personKey,
      paActive: 1,
      paFirstSeenAt: 1700000000000,
      paLastSeenAt: lastSeen,
      paSessionsInRange: "2",
      paTotalSessions: 5,
      paDeviceType: "mobile",
      paCountryCode: "DE",
      paIsNew: 1,
    };
  }

  test.each(PRODUCT_ANALYTICS_PEOPLE_FILTERS)(
    "%s: one statement, scoped, folded, time-limited and nameless",
    async (filter: ProductAnalyticsPeopleFilter) => {
      await list(filter);

      expect(statements).toHaveLength(1);
      expectScopedAndLimited();
      expectSessionsFolded();
      expectNoName();
      expect(statements[0]!.query).toContain(
        "ORDER BY paLastSeenAt DESC, paPersonKey DESC LIMIT ",
      );
    },
  );

  test("a range filter reads only its own people's history, across the cluster", async () => {
    await list(ProductAnalyticsPeopleFilter.Active);

    expect(statements[0]!.query).toContain(
      "AND personKey GLOBAL IN (SELECT paPersonKey FROM (",
    );
  });

  test.each([
    ProductAnalyticsPeopleFilter.Dormant,
    ProductAnalyticsPeopleFilter.All,
  ])(
    "%s reads the whole history and the dormant window's sessions",
    async (filter: ProductAnalyticsPeopleFilter) => {
      await list(filter);

      expect(statements[0]!.query).not.toContain("personKey GLOBAL IN");
      /* The range, the dormant window and the history. */
      expect(statements[0]!.query.split(" UNION ALL ").length).toBe(3);
    },
  );

  test.each([
    [ProductAnalyticsPeopleFilter.Active, "HAVING paActive = 1 ORDER BY"],
    [
      ProductAnalyticsPeopleFilter.New,
      "HAVING paActive = 1 AND min(paFirst) >= ",
    ],
    [
      ProductAnalyticsPeopleFilter.Returning,
      "HAVING paActive = 1 AND min(paFirst) < ",
    ],
    [
      ProductAnalyticsPeopleFilter.SignedIn,
      "HAVING paActive = 1 AND startsWith(paPersonKey, ",
    ],
    [
      ProductAnalyticsPeopleFilter.Anonymous,
      "HAVING paActive = 1 AND startsWith(paPersonKey, ",
    ],
    [ProductAnalyticsPeopleFilter.Dormant, "HAVING max(paLast) < "],
    [ProductAnalyticsPeopleFilter.All, "HAVING 1 = 1 ORDER BY"],
  ])(
    "%s keeps the people it names",
    async (filter: ProductAnalyticsPeopleFilter, having: string) => {
      await list(filter);

      expect(statements[0]!.query).toContain(having);

      if (filter === ProductAnalyticsPeopleFilter.SignedIn) {
        expect(params(statements[0]!)).toContain("u:");
      }

      if (filter === ProductAnalyticsPeopleFilter.Anonymous) {
        expect(params(statements[0]!)).toContain("v:");
      }
    },
  );

  test("pages one past the page, from the offset, and says when there is more", async () => {
    answer = (): Array<JSONObject> => {
      return [
        personRow(`v:${visitorId}`, 3),
        personRow(`u:${userKey}`, 2),
        personRow(`u:${otherUserKey}`, 1),
      ];
    };

    const people: ProductAnalyticsPeopleDto = await list(
      ProductAnalyticsPeopleFilter.All,
      { limit: 2, offset: 40 },
    );

    expect(params(statements[0]!)).toContain(3);
    expect(params(statements[0]!)).toContain(40);
    expect(people.hasMore).toBe(true);
    expect(people.includesLabels).toBe(false);
    expect(people.people).toEqual([
      {
        personKey: `v:${visitorId}`,
        kind: "visitor",
        identifiedUserKey: "",
        visitorId: visitorId,
        firstSeenAt: 1700000000000,
        lastSeenAt: 3,
        sessionsInRange: 2,
        totalSessions: 5,
        deviceType: "mobile",
        countryCode: "DE",
        isNew: true,
      },
      {
        personKey: `u:${userKey}`,
        kind: "identified",
        identifiedUserKey: userKey,
        visitorId: "",
        firstSeenAt: 1700000000000,
        lastSeenAt: 2,
        sessionsInRange: 2,
        totalSessions: 5,
        deviceType: "mobile",
        countryCode: "DE",
        isNew: true,
      },
    ]);
  });

  test("names the signed-in users of the page from their newest kept recording, for a reader who may see it", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      if (statement.query.includes("AS paLabelText")) {
        return [{ paUserKey: userKey, paLabelText: "Alice" }];
      }

      return [
        personRow(`u:${userKey}`, 3),
        personRow(`u:${otherUserKey}`, 2),
        personRow(`v:${visitorId}`, 1),
      ];
    };

    const people: ProductAnalyticsPeopleDto = await list(
      ProductAnalyticsPeopleFilter.All,
      { includeLabel: true },
    );

    expect(statements).toHaveLength(2);
    expectScopedAndLimited();

    const labels: Statement = statements[1]!;

    expect(params(labels)).toContain(AnalyticsTableName.RumSession);
    expect(labels.query).toContain(
      "AND identifiedUserKey != '' AND identifiedUserLabel != '' AND retentionDate >= now()",
    );
    expect(labels.query).toContain("argMax(identifiedUserLabel, startTime)");
    /* Only the page's signed-in users are looked up; a visitor has no name. */
    expect(params(labels)).toContainEqual([userKey, otherUserKey]);

    expect(people.includesLabels).toBe(true);
    expect(
      people.people.map((person: { identifiedUserLabel?: string }) => {
        return person.identifiedUserLabel;
      }),
    ).toEqual(["Alice", "", undefined]);
  });

  test("a page with no signed-in user looks no name up", async () => {
    answer = (): Array<JSONObject> => {
      return [personRow(`v:${visitorId}`, 1)];
    };

    await list(ProductAnalyticsPeopleFilter.All, { includeLabel: true });

    expect(statements).toHaveLength(1);
  });

  test("a search reads names from the kept recordings, bound as a value", async () => {
    await list(ProductAnalyticsPeopleFilter.All, {
      includeLabel: true,
      search: "  alice@example.com ",
    });

    const query: string = statements[0]!.query;

    expect(query).toContain(" WHERE paPersonKey GLOBAL IN (SELECT concat(");
    expect(query).toContain(
      "positionCaseInsensitiveUTF8(argMax(identifiedUserLabel, startTime), ",
    );
    expect(query).toContain("retentionDate >= now()");
    expect(query).not.toContain("alice@example.com");
    expect(params(statements[0]!)).toContain("alice@example.com");
    expect(params(statements[0]!)).toContain(AnalyticsTableName.RumSession);
  });

  test("a search without leave to read names reads none (the route refuses it first)", async () => {
    await list(ProductAnalyticsPeopleFilter.All, { search: "alice" });

    expectNoName();
    expect(params(statements[0]!)).not.toContain("alice");
  });
});

describe("getPerson", () => {
  async function person(
    personKey: string,
    includeLabel: boolean = false,
  ): Promise<ProductAnalyticsPersonDetailDto> {
    return await RumProductAnalyticsReadService.getPerson({
      projectId: projectId,
      rumApplicationId: applicationId,
      personKey: personKey,
      now: now,
      limit: 2,
      offset: 0,
      includeLabel: includeLabel,
    });
  }

  test("a signed-in user's sessions are the ones that named them", async () => {
    await person(`u:${userKey}`);

    expect(statements).toHaveLength(2);
    expectScopedAndLimited();
    expectSessionsFolded();
    expectNoName();

    for (const statement of statements) {
      expect(statement.query).toContain("AND identifiedUserKey = ");
      expect(statement.query).not.toContain("HAVING paUserKey = ''");
      expect(statement.query).not.toContain(userKey);
      expect(params(statement)).toContain(userKey);
    }

    expect(params(statements[0]!)).toContain(`u:${userKey}`);
  });

  test("a visitor's sessions are their browser's in which nobody signed in", async () => {
    await person(`v:${visitorId}`);

    for (const statement of statements) {
      expect(statement.query).toContain("AND visitorId = ");
      expect(statement.query).toContain("HAVING paUserKey = ''");
      expect(params(statement)).toContain(visitorId);
    }
  });

  test("somebody nobody knows is null, and no name is looked up for them", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      return statement.query.includes("AS paParts")
        ? [{ paParts: 0, paFirstSeenAt: 0 }]
        : [];
    };

    const detail: ProductAnalyticsPersonDetailDto = await person(
      `u:${userKey}`,
      true,
    );

    expect(detail.person).toBeNull();
    expect(detail.sessions).toEqual([]);
    expect(detail.hasMore).toBe(false);
    expect(statements).toHaveLength(2);
  });

  test("reads the person and their sessions, newest first, and names them only when allowed", async () => {
    answer = (statement: Statement): Array<JSONObject> => {
      const query: string = statement.query;

      if (query.includes("AS paParts")) {
        return [
          {
            paParts: 2,
            paFirstSeenAt: 1600000000000,
            paLastSeenAt: 1700000000000,
            paTotalSessions: 9,
            paDeviceType: "desktop",
            paCountryCode: "FR",
          },
        ];
      }

      if (query.includes("AS paLabelText")) {
        return [{ paUserKey: userKey, paLabelText: "Alice A." }];
      }

      return [
        {
          paSessionId: "s3",
          paStartedAt: 1700000000000,
          paDuration: 61000,
          paPages: 3,
          paEntryPage: "/",
          paPageList: ["/settings", "/", "/billing"],
          paDevice: "desktop",
          paBrowser: "Firefox",
          paOs: "Linux",
          paCountry: "FR",
          paAppVersion: "",
          paErrors: 1,
          paFrustration: 0,
          paFinished: 1,
          paReplayKept: 0,
        },
        { paSessionId: "s2", paStartedAt: 1690000000000, paFinished: 0 },
        { paSessionId: "s1", paStartedAt: 1680000000000, paFinished: 1 },
      ];
    };

    const named: ProductAnalyticsPersonDetailDto = await person(
      `u:${userKey}`,
      true,
    );

    expect(named.includesLabels).toBe(true);
    expect(named.person).toMatchObject({
      personKey: `u:${userKey}`,
      kind: "identified",
      identifiedUserKey: userKey,
      firstSeenAt: 1600000000000,
      lastSeenAt: 1700000000000,
      totalSessions: 9,
      deviceType: "desktop",
      countryCode: "FR",
      identifiedUserLabel: "Alice A.",
    });
    expect(named.hasMore).toBe(true);
    expect(named.sessions).toHaveLength(2);
    expect(named.sessions[0]).toEqual({
      sessionId: "s3",
      startedAt: 1700000000000,
      durationMs: 61000,
      pageCount: 3,
      entryPage: "/",
      pages: ["/", "/billing", "/settings"],
      deviceType: "desktop",
      browserName: "Firefox",
      osName: "Linux",
      countryCode: "FR",
      appVersion: "",
      errorCount: 1,
      frustrationCount: 0,
      isFinished: true,
      isReplayKept: false,
    });
    expect(named.sessions[1]!.isFinished).toBe(false);
    expect(params(statements[1]!)).toContain(3);

    statements = [];

    const nameless: ProductAnalyticsPersonDetailDto = await person(
      `u:${userKey}`,
      false,
    );

    expect(nameless.includesLabels).toBe(false);
    expect(nameless.person?.identifiedUserLabel).toBeUndefined();
    expectNoName();
  });
});
