import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDto,
} from "../../../Types/Rum/ProductAnalytics";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The client half of the five product analytics reads (issue #6444): what
 * each fetch sends, and how each answer is read back. A server mid-rollout
 * may leave a field out or send it as a string; the page must draw a zero,
 * never NaN or "undefined", and must never draw a link to a person the
 * person route would refuse.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import {
  fetchProductAnalyticsBreakdown,
  fetchProductAnalyticsPeople,
  fetchProductAnalyticsPerson,
  fetchProductAnalyticsSummary,
  fetchProductAnalyticsTrend,
  parseProductAnalyticsBreakdown,
  parseProductAnalyticsPeople,
  parseProductAnalyticsPerson,
  parseProductAnalyticsPersonDetail,
  parseProductAnalyticsSummary,
  parseProductAnalyticsTrend,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsApi";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const VISITOR_ID: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const START: Date = new Date("2026-09-01T00:00:00.000Z");
const END: Date = new Date("2026-09-08T00:00:00.000Z");

interface CapturedRequest {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

function lastRequest(): CapturedRequest {
  const call: Array<unknown> | undefined =
    postMock.mock.calls[postMock.mock.calls.length - 1];
  const request: {
    url: { toString: () => string };
    data: JSONObject;
    headers: Record<string, string>;
  } = call![0] as {
    url: { toString: () => string };
    data: JSONObject;
    headers: Record<string, string>;
  };

  return {
    url: request.url.toString(),
    data: request.data,
    headers: request.headers,
  };
}

function answer(data: JSONObject): void {
  postMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, data, {}));
  });
}

beforeEach(() => {
  postMock.mockReset();
});

describe("a period", () => {
  test("every count read, and the lengths always one per bucket", () => {
    const summary: ProductAnalyticsSummaryDto = parseProductAnalyticsSummary({
      current: {
        activeUsers: 10,
        signedInUsers: 4,
        anonymousUsers: 6,
        newUsers: 3,
        returningUsers: 7,
        sessions: 25,
        signedInSessions: 9,
        finishedSessions: 20,
        medianSessionMs: 61000,
        averagePagesPerSession: 2.5,
        errorSessions: 2,
        frustratedSessions: 1,
        sessionLengths: [1, 2, 3, 4, 5, 6, 7, 8],
      },
      previous: { activeUsers: "8", sessions: "x" },
      previousStartTime: 1,
      previousEndTime: 2,
      totalUsers: 40,
      dormantUsers: 12,
      dormantAfterDays: 30,
      dataStartedAt: 1700000000000,
    });

    expect(summary.current).toEqual({
      activeUsers: 10,
      signedInUsers: 4,
      anonymousUsers: 6,
      newUsers: 3,
      returningUsers: 7,
      sessions: 25,
      signedInSessions: 9,
      finishedSessions: 20,
      medianSessionMs: 61000,
      averagePagesPerSession: 2.5,
      errorSessions: 2,
      frustratedSessions: 1,
      /* An extra count from a newer server is not drawn as an eighth bucket. */
      sessionLengths: [1, 2, 3, 4, 5, 6, 7],
    });
    /* A string count is read, a word is zero, a missing list is all zeros. */
    expect(summary.previous.activeUsers).toBe(8);
    expect(summary.previous.sessions).toBe(0);
    expect(summary.previous.sessionLengths).toEqual(
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map((): number => {
        return 0;
      }),
    );
    expect(summary.totalUsers).toBe(40);
    expect(summary.dormantUsers).toBe(12);
    expect(summary.dormantAfterDays).toBe(30);
    expect(summary.dataStartedAt).toBe(1700000000000);
  });

  test("a short or broken length list is padded with zeros", () => {
    expect(
      parseProductAnalyticsSummary({
        current: { sessionLengths: [5, "6", null, "x"] },
      }).current.sessionLengths,
    ).toEqual([5, 6, 0, 0, 0, 0, 0]);
  });

  test("nothing at all reads as zeros, and no first session as null", () => {
    for (const value of [undefined, null, "nope", 42, [], {}]) {
      const summary: ProductAnalyticsSummaryDto =
        parseProductAnalyticsSummary(value);

      expect(summary.current.activeUsers).toBe(0);
      expect(summary.current.sessionLengths).toHaveLength(
        PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.length,
      );
      expect(summary.totalUsers).toBe(0);
      expect(summary.dataStartedAt).toBeNull();
    }

    for (const dataStartedAt of [0, -1, "", null, "soon"]) {
      expect(
        parseProductAnalyticsSummary({ dataStartedAt: dataStartedAt })
          .dataStartedAt,
      ).toBeNull();
    }
  });
});

describe("the trend", () => {
  test("each day read; a row that is not a day is dropped", () => {
    const trend: ProductAnalyticsTrendDto = parseProductAnalyticsTrend({
      timeZone: "Europe/Berlin",
      days: [
        {
          day: "2026-09-01",
          activeUsers: 3,
          weeklyActiveUsers: 5,
          monthlyActiveUsers: 9,
          newUsers: 1,
          returningUsers: 2,
          sessions: 4,
          desktopSessions: 2,
          mobileSessions: 1,
          tabletSessions: 1,
          otherSessions: 0,
        },
        { day: "Sept 2" },
        { activeUsers: 4 },
        "2026-09-03",
        { day: "2026-09-04", activeUsers: "7" },
      ],
    });

    expect(trend.timeZone).toBe("Europe/Berlin");
    expect(
      trend.days.map((entry: { day: string }): string => {
        return entry.day;
      }),
    ).toEqual(["2026-09-01", "2026-09-04"]);
    expect(trend.days[0]).toEqual({
      day: "2026-09-01",
      activeUsers: 3,
      weeklyActiveUsers: 5,
      monthlyActiveUsers: 9,
      newUsers: 1,
      returningUsers: 2,
      sessions: 4,
      desktopSessions: 2,
      mobileSessions: 1,
      tabletSessions: 1,
      otherSessions: 0,
    });
    expect(trend.days[1]!.activeUsers).toBe(7);
    expect(trend.days[1]!.weeklyActiveUsers).toBe(0);
  });

  test("no days is an empty trend, not an error", () => {
    expect(parseProductAnalyticsTrend({})).toEqual({
      timeZone: "",
      days: [],
    });
    expect(parseProductAnalyticsTrend({ days: "all of them" }).days).toEqual(
      [],
    );
  });
});

describe("a breakdown", () => {
  test("rows in the server's order, with the totals and whether more exist", () => {
    const breakdown: ProductAnalyticsBreakdownDto =
      parseProductAnalyticsBreakdown(
        {
          dimension: "browser",
          rows: [
            { value: "Chrome", users: 5, sessions: 9 },
            { value: null, users: "2", sessions: 3 },
          ],
          hasMore: 1,
          totalUsers: 7,
          totalSessions: 12,
        },
        ProductAnalyticsDimension.Browser,
      );

    expect(breakdown).toEqual({
      dimension: ProductAnalyticsDimension.Browser,
      rows: [
        { value: "Chrome", users: 5, sessions: 9 },
        { value: "", users: 2, sessions: 3 },
      ],
      hasMore: true,
      totalUsers: 7,
      totalSessions: 12,
    });
  });

  test("the dimension answered is kept when known, else the one asked", () => {
    expect(
      parseProductAnalyticsBreakdown(
        { dimension: "country" },
        ProductAnalyticsDimension.Browser,
      ).dimension,
    ).toBe(ProductAnalyticsDimension.Country);
    expect(
      parseProductAnalyticsBreakdown(
        { dimension: "plan" },
        ProductAnalyticsDimension.Page,
      ).dimension,
    ).toBe(ProductAnalyticsDimension.Page);
    expect(
      parseProductAnalyticsBreakdown({}, ProductAnalyticsDimension.EntryPage),
    ).toEqual({
      dimension: ProductAnalyticsDimension.EntryPage,
      rows: [],
      hasMore: false,
      totalUsers: 0,
      totalSessions: 0,
    });
  });
});

describe("a person", () => {
  test("a signed-in user, with the name the reader may see", () => {
    expect(
      parseProductAnalyticsPerson({
        personKey: `u:${USER_KEY}`,
        identifiedUserKey: USER_KEY,
        visitorId: VISITOR_ID,
        identifiedUserLabel: "jane@acme.com",
        firstSeenAt: 1,
        lastSeenAt: 2,
        sessionsInRange: 3,
        totalSessions: 4,
        deviceType: "desktop",
        countryCode: "DE",
        isNew: 1,
      }),
    ).toEqual({
      personKey: `u:${USER_KEY}`,
      kind: "identified",
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR_ID,
      identifiedUserLabel: "jane@acme.com",
      firstSeenAt: 1,
      lastSeenAt: 2,
      sessionsInRange: 3,
      totalSessions: 4,
      deviceType: "desktop",
      countryCode: "DE",
      isNew: true,
    });
  });

  test("an absent name is hidden, not anonymous; an empty one is no kept name", () => {
    expect(
      parseProductAnalyticsPerson({ personKey: `u:${USER_KEY}` })!
        .identifiedUserLabel,
    ).toBeUndefined();
    expect(
      parseProductAnalyticsPerson({
        personKey: `u:${USER_KEY}`,
        identifiedUserLabel: null,
      })!.identifiedUserLabel,
    ).toBeUndefined();
    expect(
      parseProductAnalyticsPerson({
        personKey: `u:${USER_KEY}`,
        identifiedUserLabel: "",
      })!.identifiedUserLabel,
    ).toBe("");
  });

  test("the kind is read from the key, never from a field the server may get wrong", () => {
    expect(
      parseProductAnalyticsPerson({
        personKey: `v:${VISITOR_ID}`,
        kind: "identified",
      })!.kind,
    ).toBe("visitor");
  });

  test("a key the person route would refuse is no person: no dead link", () => {
    for (const personKey of [
      undefined,
      "",
      USER_KEY,
      `x:${USER_KEY}`,
      `u:${USER_KEY.toUpperCase()}`,
      `u:${USER_KEY}0`,
      `v:${VISITOR_ID.slice(1)}`,
      `v:${VISITOR_ID}' OR 1=1`,
    ]) {
      expect(parseProductAnalyticsPerson({ personKey: personKey })).toBeNull();
    }
  });

  test("a list keeps the people it can link to, and says whether names were in it", () => {
    const people: ProductAnalyticsPeopleDto = parseProductAnalyticsPeople({
      people: [
        { personKey: `u:${USER_KEY}`, identifiedUserLabel: "jane" },
        { personKey: "nobody" },
        null,
        { personKey: `v:${VISITOR_ID}` },
      ],
      hasMore: true,
      includesLabels: "1",
    });

    expect(
      people.people.map((entry: { personKey: string }): string => {
        return entry.personKey;
      }),
    ).toEqual([`u:${USER_KEY}`, `v:${VISITOR_ID}`]);
    expect(people.hasMore).toBe(true);
    expect(people.includesLabels).toBe(true);
    expect(parseProductAnalyticsPeople(undefined)).toEqual({
      people: [],
      hasMore: false,
      includesLabels: false,
    });
  });

  test("a person's page: the person, or null for nobody, and their sessions", () => {
    const detail: ProductAnalyticsPersonDetailDto =
      parseProductAnalyticsPersonDetail({
        person: { personKey: `v:${VISITOR_ID}` },
        sessions: [
          {
            sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            startedAt: 10,
            durationMs: 61000,
            pageCount: 2,
            entryPage: "/",
            pages: ["/", "/pricing", 7],
            deviceType: "mobile",
            browserName: "Safari",
            osName: "iOS",
            countryCode: "FR",
            appVersion: "1.2.0",
            errorCount: 1,
            frustrationCount: 0,
            isFinished: true,
            isReplayKept: 0,
          },
          {},
        ],
        hasMore: false,
        includesLabels: true,
      });

    expect(detail.person?.kind).toBe("visitor");
    expect(detail.sessions[0]).toEqual({
      sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      startedAt: 10,
      durationMs: 61000,
      pageCount: 2,
      entryPage: "/",
      pages: ["/", "/pricing", "7"],
      deviceType: "mobile",
      browserName: "Safari",
      osName: "iOS",
      countryCode: "FR",
      appVersion: "1.2.0",
      errorCount: 1,
      frustrationCount: 0,
      isFinished: true,
      isReplayKept: false,
    });
    /* A row with nothing in it is all blanks and zeros, not undefined. */
    expect(detail.sessions[1]!.sessionId).toBe("");
    expect(detail.sessions[1]!.pages).toEqual([]);
    expect(detail.sessions[1]!.isFinished).toBe(false);
    expect(detail.includesLabels).toBe(true);

    expect(parseProductAnalyticsPersonDetail({ person: null }).person).toBe(
      null,
    );
    expect(parseProductAnalyticsPersonDetail({}).person).toBe(null);
    /* A person with a key nobody can have is nobody too. */
    expect(
      parseProductAnalyticsPersonDetail({ person: { personKey: "u:me" } })
        .person,
    ).toBe(null);
  });
});

describe("what each read sends", () => {
  const window: { rumApplicationId: ObjectID; startTime: Date; endTime: Date } =
    {
      rumApplicationId: new ObjectID(APP_ID),
      startTime: START,
      endTime: END,
    };

  test("the summary: the window and the dormant cut-off, with the project's headers", async () => {
    answer({ totalUsers: 3 });

    const summary: ProductAnalyticsSummaryDto =
      await fetchProductAnalyticsSummary({ ...window, dormantAfterDays: 60 });

    expect(summary.totalUsers).toBe(3);
    expect(lastRequest().url).toContain(PRODUCT_ANALYTICS_SUMMARY_ROUTE);
    expect(lastRequest().data).toEqual({
      rumApplicationId: APP_ID,
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      dormantAfterDays: 60,
    });
    expect(lastRequest().headers).toEqual({ tenantid: "project-1" });
  });

  test("the trend: the window and the reader's zone", async () => {
    answer({ timeZone: "Asia/Tokyo", days: [] });

    await fetchProductAnalyticsTrend({ ...window, timeZone: "Asia/Tokyo" });

    expect(lastRequest().url).toContain(PRODUCT_ANALYTICS_TREND_ROUTE);
    expect(lastRequest().data).toEqual({
      rumApplicationId: APP_ID,
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      timeZone: "Asia/Tokyo",
    });
  });

  test("the breakdown: the window and the dimension, which the answer keeps", async () => {
    answer({ rows: [{ value: "FR", users: 1, sessions: 1 }] });

    const breakdown: ProductAnalyticsBreakdownDto =
      await fetchProductAnalyticsBreakdown({
        ...window,
        dimension: ProductAnalyticsDimension.Country,
      });

    expect(breakdown.dimension).toBe(ProductAnalyticsDimension.Country);
    expect(lastRequest().url).toContain(PRODUCT_ANALYTICS_BREAKDOWN_ROUTE);
    expect(lastRequest().data).toEqual({
      rumApplicationId: APP_ID,
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      dimension: "country",
    });
  });

  test("the people: filter, window, page, and a search only when there is one", async () => {
    answer({ people: [] });

    await fetchProductAnalyticsPeople({
      ...window,
      filter: ProductAnalyticsPeopleFilter.Dormant,
      dormantAfterDays: 14,
      search: "   ",
      limit: 50,
      offset: 100,
    });

    expect(lastRequest().url).toContain(PRODUCT_ANALYTICS_PEOPLE_ROUTE);
    expect(lastRequest().data).toEqual({
      rumApplicationId: APP_ID,
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      filter: "dormant",
      dormantAfterDays: 14,
      limit: 50,
      offset: 100,
    });
    expect(Object.keys(lastRequest().data)).not.toContain("search");

    await fetchProductAnalyticsPeople({
      ...window,
      filter: ProductAnalyticsPeopleFilter.SignedIn,
      dormantAfterDays: 30,
      search: "  jane ",
      limit: 50,
      offset: 0,
    });

    expect(lastRequest().data["search"]).toBe("jane");
  });

  test("a person: the application, the key and the page; no window", async () => {
    answer({ person: null, sessions: [] });

    const detail: ProductAnalyticsPersonDetailDto =
      await fetchProductAnalyticsPerson({
        rumApplicationId: new ObjectID(APP_ID),
        personKey: `u:${USER_KEY}`,
        limit: 50,
        offset: 50,
      });

    expect(detail.person).toBeNull();
    expect(lastRequest().url).toContain(PRODUCT_ANALYTICS_PERSON_ROUTE);
    expect(lastRequest().data).toEqual({
      rumApplicationId: APP_ID,
      personKey: `u:${USER_KEY}`,
      limit: 50,
      offset: 50,
    });
  });

  test("a refusal is thrown with the server's words, never read as an empty answer", async () => {
    postMock.mockImplementation((): Promise<unknown> => {
      return Promise.resolve(
        new HTTPErrorResponse(
          403,
          { message: "You do not have permission to read sessions." },
          {},
        ),
      );
    });

    await expect(
      fetchProductAnalyticsSummary({ ...window, dormantAfterDays: 30 }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("an empty body is an empty answer", async () => {
    postMock.mockImplementation((): Promise<unknown> => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        {},
        {},
      );

      response.data = null as unknown as JSONObject;

      return Promise.resolve(response);
    });

    const people: ProductAnalyticsPeopleDto = await fetchProductAnalyticsPeople(
      {
        ...window,
        filter: ProductAnalyticsPeopleFilter.All,
        dormantAfterDays: 30,
        search: "",
        limit: 50,
        offset: 0,
      },
    );

    expect(people.people).toEqual([]);
  });
});
