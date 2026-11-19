import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The reads behind a mobile RUM application's Overview (#9588),
 * Components/Rum/MobileOverview/MobileRumSignalReads.ts, with the network
 * replaced at the API client: which endpoint each read asks, with what, and
 * that one read failing marks only itself failed - its tile says "could not
 * load" while the others draw.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const projectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { "x-test-header": "1" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return projectIdMock();
      },
    },
  };
});

import {
  fetchMobileAppStarts,
  fetchMobileFaults,
  fetchMobileFrames,
  fetchMobileSessions,
  fetchNewestAppStartAt,
  fetchNewestFrameEventAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalReads";
import {
  MobileAppStarts,
  MobileFaults,
  MobileFrames,
  MobileSessions,
  MobileSignalScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalData";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Span from "../../../Models/AnalyticsModels/Span";
import Log from "../../../Models/AnalyticsModels/Log";

const APP_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const SCOPE: MobileSignalScope = {
  primaryEntityId: new ObjectID(APP_ID),
  start: new Date("2026-11-19T09:00:00.000Z"),
  end: new Date("2026-11-19T10:00:00.000Z"),
};
const NOW: Date = new Date("2026-11-19T10:00:00.000Z");

interface PostArgs {
  url: { toString: () => string };
  data: JSONObject;
  headers: Record<string, string>;
}

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function refused(): HTTPErrorResponse {
  return new HTTPErrorResponse(403, { message: "Not allowed" }, {});
}

function pathOf(args: PostArgs): string {
  return args.url.toString().replace(/^.*\/telemetry\//, "/telemetry/");
}

// The calls made to one endpoint, in order.
function callsTo(path: string): Array<PostArgs> {
  return (postMock.mock.calls as Array<[PostArgs]>)
    .map(([args]: [PostArgs]): PostArgs => {
      return args;
    })
    .filter((args: PostArgs): boolean => {
      return pathOf(args) === path;
    });
}

// Answers each endpoint from a table, by path and, for analytics, by chart.
function answer(answers: Record<string, (body: JSONObject) => unknown>): void {
  postMock.mockImplementation(async (args: unknown): Promise<unknown> => {
    const post: PostArgs = args as PostArgs;
    const handler: ((body: JSONObject) => unknown) | undefined =
      answers[pathOf(post)];

    if (!handler) {
      throw new Error(`Unexpected request to ${pathOf(post)}`);
    }

    return handler(post.data);
  });
}

beforeEach(() => {
  projectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("fetchMobileAppStarts", () => {
  test("asks the trace analytics for the table and both per-interval series, and folds them", async () => {
    answer({
      "/telemetry/traces/analytics": (body: JSONObject): unknown => {
        if (body["chartType"] === "table") {
          return ok({
            data: [
              {
                groupValues: { "start.type": "cold" },
                count: 12,
                p50DurationMs: 1100,
                p95DurationMs: 2300,
              },
            ],
          } as unknown as JSONObject);
        }

        return ok({
          data: [
            {
              time: "2026-11-19 09:00:00",
              value: body["metric"] === "count" ? 12 : 2300,
              groupValues: { "start.type": "cold" },
            },
          ],
        } as unknown as JSONObject);
      },
    });

    const result: MobileAppStarts = await fetchMobileAppStarts(SCOPE);
    const calls: Array<PostArgs> = callsTo("/telemetry/traces/analytics");

    expect(calls).toHaveLength(3);
    expect(
      calls.map((call: PostArgs): unknown => {
        return [call.data["chartType"], call.data["metric"]];
      }),
    ).toEqual([
      ["table", "count"],
      ["timeseries", "count"],
      ["timeseries", "p95Duration"],
    ]);

    for (const call of calls) {
      expect(call.data["spanNames"]).toEqual(["AppStart"]);
      expect(call.data["groupBy"]).toEqual(["start.type"]);
      expect(call.data["serviceIds"]).toEqual([APP_ID]);
      expect(call.data["startTime"]).toBe("2026-11-19T09:00:00.000Z");
      expect(call.headers).toEqual({ "x-test-header": "1" });
    }

    expect(result.failed).toBe(false);
    expect(result.total).toBe(12);
    expect(result.byType.cold.p95DurationMs).toBe(2300);
    expect(result.countSeries.cold[0]?.x.toISOString()).toBe(
      "2026-11-19T09:00:00.000Z",
    );
    expect(result.p95Series.cold[0]?.y).toBe(2300);
  });

  test("any of the three refused is a failed read, never a confident zero", async () => {
    answer({
      "/telemetry/traces/analytics": (body: JSONObject): unknown => {
        return body["chartType"] === "table" ? refused() : ok({ data: [] });
      },
    });

    const result: MobileAppStarts = await fetchMobileAppStarts(SCOPE);

    expect(result.failed).toBe(true);
    expect(result.total).toBe(0);
  });
});

describe("fetchMobileSessions", () => {
  test("asks the session count for the app's spans in the window", async () => {
    answer({
      "/telemetry/traces/session-count": (): unknown => {
        return ok({ sessions: 31, spans: 900 });
      },
    });

    const result: MobileSessions = await fetchMobileSessions(SCOPE);

    expect(callsTo("/telemetry/traces/session-count")[0]?.data).toEqual({
      startTime: "2026-11-19T09:00:00.000Z",
      endTime: "2026-11-19T10:00:00.000Z",
      serviceIds: [APP_ID],
    });
    expect(result).toEqual({ sessions: 31, spans: 900, failed: false });
  });

  test("a refused read is failed", async () => {
    answer({
      "/telemetry/traces/session-count": (): unknown => {
        return refused();
      },
    });

    expect(await fetchMobileSessions(SCOPE)).toEqual({
      sessions: 0,
      spans: 0,
      failed: true,
    });
  });
});

describe("fetchMobileFaults", () => {
  test("reads crashes as unhandled with ANRs left out, and ANRs by their type, with the sessions of each", async () => {
    answer({
      "/telemetry/exceptions/histogram": (body: JSONObject): unknown => {
        return ok({
          buckets: [
            {
              time: "2026-11-19 09:05:00",
              series: "unhandled",
              count: body["exceptionTypes"] ? 2 : 5,
            },
          ],
        } as unknown as JSONObject);
      },
      "/telemetry/exceptions/session-count": (body: JSONObject): unknown => {
        return ok({
          sessions: body["exceptionTypes"] ? 1 : 4,
          occurrences: 0,
        });
      },
    });

    const result: MobileFaults = await fetchMobileFaults(SCOPE);
    const histograms: Array<PostArgs> = callsTo(
      "/telemetry/exceptions/histogram",
    );

    expect(histograms).toHaveLength(2);
    expect(histograms[0]?.data["escaped"]).toBe(true);
    // An iOS hang counts as the ANR it is, never as a crash (#9712).
    expect(histograms[0]?.data["excludedExceptionTypes"]).toEqual([
      "ANR",
      "Hang",
    ]);
    expect(histograms[1]?.data["exceptionTypes"]).toEqual(["ANR", "Hang"]);
    expect(callsTo("/telemetry/exceptions/session-count")).toHaveLength(2);

    expect(result.crashes).toMatchObject({
      total: 5,
      sessions: 4,
      failed: false,
    });
    expect(result.anrs).toMatchObject({ total: 2, sessions: 1, failed: false });
    expect(result.crashes.series[0]?.x.toISOString()).toBe(
      "2026-11-19T09:05:00.000Z",
    );
  });

  test("a refused histogram fails its own tile only", async () => {
    answer({
      "/telemetry/exceptions/histogram": (body: JSONObject): unknown => {
        return body["exceptionTypes"] ? refused() : ok({ buckets: [] });
      },
      "/telemetry/exceptions/session-count": (): unknown => {
        return ok({ sessions: 0, occurrences: 0 });
      },
    });

    const result: MobileFaults = await fetchMobileFaults(SCOPE);

    expect(result.crashes.failed).toBe(false);
    expect(result.anrs).toEqual({
      total: 0,
      series: [],
      sessions: null,
      failed: true,
    });
  });

  test("a refused session count keeps the count, with no sessions to name", async () => {
    answer({
      "/telemetry/exceptions/histogram": (): unknown => {
        return ok({
          buckets: [{ time: "2026-11-19 09:05:00", count: 3 }],
        } as unknown as JSONObject);
      },
      "/telemetry/exceptions/session-count": (): unknown => {
        return refused();
      },
    });

    const result: MobileFaults = await fetchMobileFaults(SCOPE);

    expect(result.crashes).toMatchObject({
      total: 3,
      sessions: null,
      failed: false,
    });
  });
});

describe("fetchMobileFrames", () => {
  test("adds up the app.jank frames per threshold, and per screen", async () => {
    answer({
      "/telemetry/logs/analytics": (body: JSONObject): unknown => {
        if (body["chartType"] === "timeseries") {
          return ok({
            data: [
              {
                time: "2026-11-19 09:00:00",
                count: 40,
                groupValues: { "app.jank.threshold": "0.016" },
              },
              {
                time: "2026-11-19 09:00:00",
                count: 3,
                groupValues: { "app.jank.threshold": "0.7" },
              },
            ],
          } as unknown as JSONObject);
        }

        return ok({
          data: [
            {
              count: 40,
              groupValues: {
                "app.screen.name": "MenuActivity",
                "app.jank.threshold": "0.016",
              },
            },
            {
              count: 3,
              groupValues: {
                "app.screen.name": "MenuActivity",
                "app.jank.threshold": "0.7",
              },
            },
          ],
        } as unknown as JSONObject);
      },
    });

    const result: MobileFrames = await fetchMobileFrames(SCOPE);
    const calls: Array<PostArgs> = callsTo("/telemetry/logs/analytics");

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(call.data["aggregation"]).toBe("sum");
      expect(call.data["aggregationField"]).toBe("app.jank.frame_count");
      expect(call.data["attributes"]).toEqual({ "event.name": "app.jank" });
      expect(call.data["serviceIds"]).toEqual([APP_ID]);
    }

    expect(result).toMatchObject({
      slow: 40,
      frozen: 3,
      failed: false,
      byScreenFailed: false,
      byScreen: [{ screen: "MenuActivity", slow: 40, frozen: 3 }],
    });
  });

  test("a refused series read fails the frames; a refused per-screen read fails only the card", async () => {
    answer({
      "/telemetry/logs/analytics": (): unknown => {
        return refused();
      },
    });

    expect((await fetchMobileFrames(SCOPE)).failed).toBe(true);

    answer({
      "/telemetry/logs/analytics": (body: JSONObject): unknown => {
        return body["chartType"] === "table" ? refused() : ok({ data: [] });
      },
    });

    const result: MobileFrames = await fetchMobileFrames(SCOPE);

    expect(result.failed).toBe(false);
    expect(result.byScreenFailed).toBe(true);
    expect(result.byScreen).toEqual([]);
  });
});

describe("the newest arrival, for an empty chart", () => {
  test("the newest AppStart span of the past 30 days, one row, newest first", async () => {
    getListMock.mockResolvedValue({
      data: [{ startTime: "2026-11-19T07:00:00.000Z" }],
    } as never);

    const at: Date | null = await fetchNewestAppStartAt({
      primaryEntityId: new ObjectID(APP_ID),
      now: NOW,
    });
    const args: {
      modelType: unknown;
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = getListMock.mock.calls[0]![0] as never;

    expect(args.modelType).toBe(Span);
    expect(args.query["name"]).toBe("AppStart");
    expect(String(args.query["primaryEntityId"])).toBe(APP_ID);
    expect(String(args.query["projectId"])).toBe(PROJECT_ID);
    expect(args.query["startTime"]).toBeInstanceOf(InBetween);
    expect(
      (args.query["startTime"] as InBetween<Date>).startValue.toISOString(),
    ).toBe("2026-10-20T10:00:00.000Z");
    expect(args.sort).toEqual({ startTime: SortOrder.Descending });
    expect(args.limit).toBe(1);
    expect(at?.toISOString()).toBe("2026-11-19T07:00:00.000Z");
  });

  test("none is null", async () => {
    getListMock.mockResolvedValue({ data: [] } as never);

    expect(
      await fetchNewestAppStartAt({
        primaryEntityId: new ObjectID(APP_ID),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("the newest app.jank event of the past 30 days", async () => {
    getListMock.mockResolvedValue({
      data: [{ time: "2026-11-18T10:00:00.000Z" }],
    } as never);

    const at: Date | null = await fetchNewestFrameEventAt({
      primaryEntityId: new ObjectID(APP_ID),
      now: NOW,
    });
    const args: { modelType: unknown; query: Record<string, unknown> } =
      getListMock.mock.calls[0]![0] as never;

    expect(args.modelType).toBe(Log);
    expect(args.query["attributes"]).toEqual({ "event.name": "app.jank" });
    expect(at?.toISOString()).toBe("2026-11-18T10:00:00.000Z");
  });

  test("a failed lookup throws, so the chart says it could not tell", async () => {
    getListMock.mockRejectedValue(new Error("refused") as never);

    await expect(
      fetchNewestFrameEventAt({
        primaryEntityId: new ObjectID(APP_ID),
        now: NOW,
      }),
    ).rejects.toThrow("refused");
  });
});
