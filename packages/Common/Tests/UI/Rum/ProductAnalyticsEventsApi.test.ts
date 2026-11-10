import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { APP_API_URL } from "../../../UI/Config";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_ROUTE,
  PRODUCT_ANALYTICS_RETENTION_ROUTE,
  ProductAnalyticsEventBreakdownDto,
  ProductAnalyticsEventField,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsEventTrendDto,
  ProductAnalyticsFieldRef,
  ProductAnalyticsFunnelDto,
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The client half of the six event reads behind the Events, Funnels and
 * Retention pages (issue #6444, part two): what each fetch sends, and how
 * each answer is read back. A server mid-rollout may leave a field out or
 * send a number as a string; the pages must draw a zero, never NaN or
 * "undefined", a bar never longer than its track, and no event they could
 * not name.
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
  fetchProductAnalyticsEventBreakdown,
  fetchProductAnalyticsEventNames,
  fetchProductAnalyticsEventProperties,
  fetchProductAnalyticsEventTrend,
  fetchProductAnalyticsFunnel,
  fetchProductAnalyticsRetention,
  getProductAnalyticsBreakdownFields,
  parseProductAnalyticsEventBreakdown,
  parseProductAnalyticsEventNames,
  parseProductAnalyticsEventProperties,
  parseProductAnalyticsEventTrend,
  parseProductAnalyticsFunnel,
  parseProductAnalyticsRetention,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsApi";
import { PRODUCT_ANALYTICS_PLAIN_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsFormat";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const START: Date = new Date("2026-09-01T00:00:00.000Z");
const END: Date = new Date("2026-09-08T00:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

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

/* The whole address a read posts to: the API's own, then the route. */
function addressOf(route: string): string {
  return URL.fromString(APP_API_URL.toString()).addRoute(route).toString();
}

function answer(data: JSONObject): void {
  postMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, data, {}));
  });
}

beforeEach(() => {
  postMock.mockReset();
});

describe("the application's events", () => {
  test("every event is read, numbers sent as strings too, and an event of a kind the page cannot name is left out", () => {
    const names: ProductAnalyticsEventNamesDto =
      parseProductAnalyticsEventNames({
        events: [
          {
            kind: "custom",
            name: "Signed up",
            events: "1200",
            users: 300,
            lastSeenAt: 1767225600000,
          },
          { kind: "page", name: "/pricing", events: 40 },
          { kind: "screen", name: "Home", events: 9 },
          "not an event",
          { kind: "session", events: "x", users: null },
        ],
        hasMore: 1,
        dataStartedAt: "1767225600000",
      });

    expect(names.events).toEqual([
      {
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        events: 1200,
        users: 300,
        lastSeenAt: 1767225600000,
      },
      {
        kind: ProductAnalyticsEventKind.Page,
        name: "/pricing",
        events: 40,
        users: 0,
        lastSeenAt: 0,
      },
      {
        kind: ProductAnalyticsEventKind.Session,
        name: "",
        events: 0,
        users: 0,
        lastSeenAt: 0,
      },
    ]);
    expect(names.hasMore).toBe(true);
    expect(names.dataStartedAt).toBe(1767225600000);
  });

  test.each([undefined, null, "", 0, -5, "never"])(
    "a start of %p reads as nothing kept yet",
    (dataStartedAt: unknown) => {
      expect(
        parseProductAnalyticsEventNames({ events: [], dataStartedAt }).dataStartedAt,
      ).toBeNull();
    },
  );

  test.each([null, undefined, "nonsense", 42, []])(
    "an answer of %p reads as no events",
    (value: unknown) => {
      expect(parseProductAnalyticsEventNames(value)).toEqual({
        events: [],
        hasMore: false,
        dataStartedAt: null,
      });
    },
  );
});

describe("an event's trend and breakdown", () => {
  test("only real days are kept, and every total reads as a number", () => {
    const trend: ProductAnalyticsEventTrendDto =
      parseProductAnalyticsEventTrend({
        timeZone: "Europe/Berlin",
        days: [
          { day: "2026-09-01", events: "12", users: 4 },
          { day: "2026-09-02" },
          { day: "yesterday", events: 3, users: 1 },
          { day: "2026-09-03T00:00:00Z", events: 3, users: 1 },
          null,
        ],
        totalEvents: "12",
        totalUsers: 4,
        totalSessions: "abc",
      });

    expect(trend).toEqual({
      timeZone: "Europe/Berlin",
      days: [
        { day: "2026-09-01", events: 12, users: 4 },
        { day: "2026-09-02", events: 0, users: 0 },
      ],
      totalEvents: 12,
      totalUsers: 4,
      totalSessions: 0,
    });
    expect(parseProductAnalyticsEventTrend(undefined)).toEqual({
      timeZone: "",
      days: [],
      totalEvents: 0,
      totalUsers: 0,
      totalSessions: 0,
    });
  });

  test("a breakdown keeps the field the server answered for, else the one asked for", () => {
    const asked: ProductAnalyticsFieldRef = {
      field: ProductAnalyticsEventField.Property,
      key: "plan",
    };
    const breakdown: ProductAnalyticsEventBreakdownDto =
      parseProductAnalyticsEventBreakdown(
        {
          field: "country",
          rows: [
            { value: "DE", events: "7", users: 2 },
            { value: null, events: 1, users: 1 },
          ],
          hasMore: "1",
          totalEvents: 8,
          totalUsers: 3,
        },
        asked,
      );

    expect(breakdown.field).toBe(ProductAnalyticsEventField.Country);
    expect(breakdown.key).toBe("");
    expect(breakdown.hasMore).toBe(true);
    expect(breakdown.rows).toEqual([
      { value: "DE", events: 7, users: 2 },
      { value: "", events: 1, users: 1 },
    ]);
    expect(breakdown.totalEvents).toBe(8);

    for (const answered of [
      { field: "identifiedUserLabel" },
      { field: "property" },
      {},
    ]) {
      const fallback: ProductAnalyticsEventBreakdownDto =
        parseProductAnalyticsEventBreakdown(answered, asked);

      expect({ field: fallback.field, key: fallback.key }).toEqual(asked);
      expect(fallback.rows).toEqual([]);
    }
  });

  test("property keys keep their order and drop the empty ones", () => {
    const properties: ProductAnalyticsEventPropertiesDto =
      parseProductAnalyticsEventProperties({
        propertyKeys: ["plan", "", "source", 5],
        userPropertyKeys: "role",
      });

    /* A key is a string on the wire; a number sent as one reads as its digits. */
    expect(properties.propertyKeys).toEqual(["plan", "source", "5"]);
    expect(properties.userPropertyKeys).toEqual([]);
  });

  test("the fields to break down by: the plain ones, then the event's keys, then the people's", () => {
    expect(
      getProductAnalyticsBreakdownFields(null, PRODUCT_ANALYTICS_PLAIN_FIELDS),
    ).toEqual(
      PRODUCT_ANALYTICS_PLAIN_FIELDS.map(
        (field: ProductAnalyticsEventField): ProductAnalyticsFieldRef => {
          return { field: field, key: "" };
        },
      ),
    );

    const fields: Array<ProductAnalyticsFieldRef> =
      getProductAnalyticsBreakdownFields(
        { propertyKeys: ["plan"], userPropertyKeys: ["role", "team"] },
        [ProductAnalyticsEventField.DeviceType],
      );

    expect(fields).toEqual([
      { field: ProductAnalyticsEventField.DeviceType, key: "" },
      { field: ProductAnalyticsEventField.Property, key: "plan" },
      { field: ProductAnalyticsEventField.UserProperty, key: "role" },
      { field: ProductAnalyticsEventField.UserProperty, key: "team" },
    ]);
  });
});

describe("a funnel", () => {
  test("every step is read, each share held to 0..1, a median only when there is one", () => {
    const funnel: ProductAnalyticsFunnelDto = parseProductAnalyticsFunnel(
      {
        windowMs: DAY_MS,
        steps: [
          {
            kind: "session",
            name: "",
            people: "100",
            conversionFromStart: 1,
            conversionFromPrevious: 1,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
          {
            kind: "custom",
            name: "Signed up",
            people: 40,
            conversionFromStart: 1.4,
            conversionFromPrevious: -0.2,
            droppedOff: 60,
            medianMsFromPrevious: "90000",
          },
          {
            kind: "screen",
            name: "Home",
            people: 10,
          },
          {
            kind: "page",
            name: "/welcome",
            people: 0,
            conversionFromStart: "NaN",
            medianMsFromPrevious: -1,
          },
        ],
      },
      7 * DAY_MS,
    );

    expect(funnel.windowMs).toBe(DAY_MS);
    expect(funnel.steps).toHaveLength(3);
    expect(funnel.steps[0]!.people).toBe(100);
    expect(funnel.steps[0]!.medianMsFromPrevious).toBeNull();
    expect(funnel.steps[1]!.conversionFromStart).toBe(1);
    expect(funnel.steps[1]!.conversionFromPrevious).toBe(0);
    expect(funnel.steps[1]!.medianMsFromPrevious).toBe(90000);
    expect(funnel.steps[2]).toEqual({
      kind: ProductAnalyticsEventKind.Page,
      name: "/welcome",
      people: 0,
      conversionFromStart: 0,
      conversionFromPrevious: 0,
      droppedOff: 0,
      medianMsFromPrevious: null,
    });
  });

  test("an answer that leaves the window out keeps the one asked for", () => {
    expect(parseProductAnalyticsFunnel({}, 7 * DAY_MS)).toEqual({
      windowMs: 7 * DAY_MS,
      steps: [],
    });
  });
});

describe("retention", () => {
  test("cohorts on real days only; a period not begun stays empty, anything else unreadable is 0", () => {
    const retention: ProductAnalyticsRetentionDto =
      parseProductAnalyticsRetention(
        {
          period: "month",
          timeZone: "Asia/Tokyo",
          cohorts: [
            {
              start: "2026-07-01",
              people: "20",
              returning: [20, "5", "x", null],
            },
            { start: "July", people: 3, returning: [3] },
            { start: "2026-08-01", people: 4, returning: "none" },
          ],
        },
        ProductAnalyticsRetentionPeriod.Week,
      );

    expect(retention).toEqual({
      period: ProductAnalyticsRetentionPeriod.Month,
      timeZone: "Asia/Tokyo",
      cohorts: [
        { start: "2026-07-01", people: 20, returning: [20, 5, 0, null] },
        { start: "2026-08-01", people: 4, returning: [] },
      ],
    });
  });

  test("an answer with no period, or one the page does not know, keeps the one asked for", () => {
    for (const period of [undefined, "year", 7]) {
      expect(
        parseProductAnalyticsRetention(
          { period },
          ProductAnalyticsRetentionPeriod.Day,
        ).period,
      ).toBe(ProductAnalyticsRetentionPeriod.Day);
    }
  });
});

describe("what each read sends", () => {
  const window: { rumApplicationId: ObjectID; startTime: Date; endTime: Date } =
    {
      rumApplicationId: new ObjectID(APP_ID),
      startTime: START,
      endTime: END,
    };
  const windowBody: JSONObject = {
    rumApplicationId: APP_ID,
    startTime: START.toISOString(),
    endTime: END.toISOString(),
  };
  const filters: Array<ProductAnalyticsSegmentFilter> = [
    { field: ProductAnalyticsEventField.Country, key: "", value: "DE" },
    {
      field: ProductAnalyticsEventField.UserProperty,
      key: "plan",
      value: "pro",
    },
  ];
  const signedUp: { kind: ProductAnalyticsEventKind; name: string } = {
    kind: ProductAnalyticsEventKind.Custom,
    name: "Signed up",
  };

  test("the events: the window, a kind only when asked for one, with the project's headers", async () => {
    answer({ events: [{ kind: "custom", name: "Search", events: 3 }] });

    const names: ProductAnalyticsEventNamesDto =
      await fetchProductAnalyticsEventNames(window);

    expect(names.events).toHaveLength(1);
    expect(lastRequest().url).toBe(
      addressOf(PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE),
    );
    expect(lastRequest().data).toEqual(windowBody);
    expect(lastRequest().headers).toEqual({ tenantid: "project-1" });

    await fetchProductAnalyticsEventNames({
      ...window,
      kind: ProductAnalyticsEventKind.Page,
    });

    expect(lastRequest().data).toEqual({ ...windowBody, kind: "page" });
  });

  test("the trend: the event, the segment and the reader's zone", async () => {
    answer({ days: [] });

    await fetchProductAnalyticsEventTrend({
      ...window,
      event: signedUp,
      filters: filters,
      timeZone: "Asia/Tokyo",
    });

    expect(lastRequest().url).toBe(
      addressOf(PRODUCT_ANALYTICS_EVENT_TREND_ROUTE),
    );
    expect(lastRequest().data).toEqual({
      ...windowBody,
      event: { kind: "custom", name: "Signed up" },
      filters: [
        { field: "country", key: "", value: "DE" },
        { field: "userProperty", key: "plan", value: "pro" },
      ],
      timeZone: "Asia/Tokyo",
    });
  });

  test("the breakdown: the event, the segment and the field", async () => {
    answer({ rows: [] });

    const breakdown: ProductAnalyticsEventBreakdownDto =
      await fetchProductAnalyticsEventBreakdown({
        ...window,
        event: signedUp,
        filters: [],
        breakdown: { field: ProductAnalyticsEventField.Property, key: "plan" },
      });

    expect(breakdown.field).toBe(ProductAnalyticsEventField.Property);
    expect(breakdown.key).toBe("plan");
    expect(lastRequest().url).toBe(
      addressOf(PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE),
    );
    expect(lastRequest().data).toEqual({
      ...windowBody,
      event: { kind: "custom", name: "Signed up" },
      filters: [],
      breakdown: { field: "property", key: "plan" },
    });
  });

  test("the property keys: the event in the window", async () => {
    answer({ propertyKeys: ["plan"] });

    await fetchProductAnalyticsEventProperties({ ...window, event: signedUp });

    expect(lastRequest().url).toBe(
      addressOf(PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE),
    );
    expect(lastRequest().data).toEqual({
      ...windowBody,
      event: { kind: "custom", name: "Signed up" },
    });
  });

  test("the funnel: the steps in order, the segment and the window to finish in", async () => {
    answer({ steps: [] });

    await fetchProductAnalyticsFunnel({
      ...window,
      steps: [
        { kind: ProductAnalyticsEventKind.Session, name: "" },
        { kind: ProductAnalyticsEventKind.Page, name: "/pricing" },
        signedUp,
      ],
      filters: filters.slice(0, 1),
      windowMs: 7 * DAY_MS,
    });

    expect(lastRequest().url).toBe(addressOf(PRODUCT_ANALYTICS_FUNNEL_ROUTE));
    expect(lastRequest().data).toEqual({
      ...windowBody,
      steps: [
        { kind: "session", name: "" },
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Signed up" },
      ],
      filters: [{ field: "country", key: "", value: "DE" }],
      windowMs: 7 * DAY_MS,
    });
  });

  test("retention: both events, the segment, the period and the reader's zone", async () => {
    answer({ cohorts: [] });

    const retention: ProductAnalyticsRetentionDto =
      await fetchProductAnalyticsRetention({
        ...window,
        startEvent: signedUp,
        returnEvent: { kind: ProductAnalyticsEventKind.Session, name: "" },
        filters: [],
        period: ProductAnalyticsRetentionPeriod.Day,
        timeZone: "America/New_York",
      });

    expect(retention.period).toBe(ProductAnalyticsRetentionPeriod.Day);
    expect(lastRequest().url).toBe(
      addressOf(PRODUCT_ANALYTICS_RETENTION_ROUTE),
    );
    expect(lastRequest().data).toEqual({
      ...windowBody,
      startEvent: { kind: "custom", name: "Signed up" },
      returnEvent: { kind: "session", name: "" },
      filters: [],
      period: "day",
      timeZone: "America/New_York",
    });
  });

  test("a refusal is thrown with the server's words, never read as an empty answer", async () => {
    postMock.mockImplementation((): Promise<unknown> => {
      return Promise.resolve(
        new HTTPErrorResponse(
          400,
          {
            message:
              "This range has too many weeks. Choose a shorter range or a longer period.",
          },
          {},
        ),
      );
    });

    await expect(
      fetchProductAnalyticsRetention({
        ...window,
        startEvent: signedUp,
        returnEvent: signedUp,
        filters: [],
        period: ProductAnalyticsRetentionPeriod.Week,
        timeZone: "UTC",
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    await expect(fetchProductAnalyticsEventNames(window)).rejects.toBeInstanceOf(
      HTTPErrorResponse,
    );
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

    expect(await fetchProductAnalyticsEventNames(window)).toEqual({
      events: [],
      hasMore: false,
      dataStartedAt: null,
    });
  });
});
