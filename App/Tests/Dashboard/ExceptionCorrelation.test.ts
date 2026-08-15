import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import {
  EXCEPTION_CONTEXT_ANCHOR_LOG_ID,
  EXCEPTION_CONTEXT_LOG_COUNT,
  EXCEPTION_LOG_WINDOW_MS,
  ExceptionLogsScopePlan,
  OccurrenceContextLogRow,
  OccurrenceLogWindow,
  OccurrenceLogsLink,
  RumSessionAnchor,
  buildOccurrenceLogsContextRequest,
  buildOccurrenceLogsExplorerLink,
  buildRumSessionAnchorMap,
  collectDistinctSessionIds,
  getExceptionLogsScopePlan,
  getOccurrenceLogWindow,
  getReplayAnchorOffsetMs,
  parseLogsContextResponse,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionCorrelation";

/*
 * These helpers are the logic behind the exception page's correlation
 * surfaces: the lazy Logs section (trace-scoped viewer pin vs. the
 * /telemetry/logs/context fallback) and the per-occurrence replay / logs
 * affordances in the occurrence table. Each is exercised on its happy path,
 * absent/empty inputs, and the malformed data an analytics row can carry.
 */

const NOW: Date = new Date("2026-08-14T12:00:00.000Z");

describe("getOccurrenceLogWindow", () => {
  test("derives a full ±5 minute window around an old occurrence", () => {
    const occurredAt: Date = new Date("2026-08-14T10:00:00.000Z");

    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      occurredAt,
      NOW,
    );

    expect(window).not.toBeNull();
    expect(window!.startTime.toISOString()).toBe("2026-08-14T09:55:00.000Z");
    expect(window!.endTime.toISOString()).toBe("2026-08-14T10:05:00.000Z");
    expect(window!.endTime.getTime() - window!.startTime.getTime()).toBe(
      2 * EXCEPTION_LOG_WINDOW_MS,
    );
  });

  test("does not re-anchor a very old occurrence's window to now", () => {
    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      "2020-01-01T00:00:00.000Z",
      NOW,
    );

    expect(window!.startTime.toISOString()).toBe("2019-12-31T23:55:00.000Z");
    expect(window!.endTime.toISOString()).toBe("2020-01-01T00:05:00.000Z");
  });

  test("clamps the end to now for a now-adjacent occurrence", () => {
    const occurredAt: Date = new Date(NOW.getTime() - 60 * 1000);

    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      occurredAt,
      NOW,
    );

    expect(window!.startTime.getTime()).toBe(
      occurredAt.getTime() - EXCEPTION_LOG_WINDOW_MS,
    );
    expect(window!.endTime.getTime()).toBe(NOW.getTime());
  });

  test("never pulls the end before the occurrence itself (skewed clock)", () => {
    const occurredAt: Date = new Date(NOW.getTime() + 90 * 1000);

    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      occurredAt,
      NOW,
    );

    expect(window!.endTime.getTime()).toBe(occurredAt.getTime());
    expect(window!.startTime.getTime()).toBeLessThan(window!.endTime.getTime());
  });

  test("accepts ISO strings and epoch numbers", () => {
    expect(
      getOccurrenceLogWindow("2026-08-14T10:00:00.000Z", NOW),
    ).not.toBeNull();
    expect(
      getOccurrenceLogWindow(Date.parse("2026-08-14T10:00:00.000Z"), NOW),
    ).not.toBeNull();
  });

  test("returns null for absent, blank, and malformed times", () => {
    expect(getOccurrenceLogWindow(undefined, NOW)).toBeNull();
    expect(getOccurrenceLogWindow(null, NOW)).toBeNull();
    expect(getOccurrenceLogWindow("", NOW)).toBeNull();
    expect(getOccurrenceLogWindow("   ", NOW)).toBeNull();
    expect(getOccurrenceLogWindow("not-a-date", NOW)).toBeNull();
    expect(getOccurrenceLogWindow(Number.NaN, NOW)).toBeNull();
    expect(getOccurrenceLogWindow(new Date("garbage"), NOW)).toBeNull();
    expect(getOccurrenceLogWindow({}, NOW)).toBeNull();
  });
});

describe("getExceptionLogsScopePlan", () => {
  test("selects trace scope when the instance carries a traceId", () => {
    const plan: ExceptionLogsScopePlan = getExceptionLogsScopePlan({
      traceId: "trace-1",
      primaryEntityId: "service-1",
      time: "2026-08-14T10:00:00.000Z",
      now: NOW,
    });

    expect(plan.mode).toBe("trace");
    expect(plan.traceId).toBe("trace-1");
    expect(plan.primaryEntityId).toBe("service-1");
    expect(plan.anchorTime?.toISOString()).toBe("2026-08-14T10:00:00.000Z");
    expect(plan.window).not.toBeNull();
  });

  test("keeps trace scope with a null window when the time is unreadable", () => {
    const plan: ExceptionLogsScopePlan = getExceptionLogsScopePlan({
      traceId: "trace-1",
      primaryEntityId: "service-1",
      time: "garbage",
      now: NOW,
    });

    expect(plan.mode).toBe("trace");
    expect(plan.window).toBeNull();
    expect(plan.anchorTime).toBeNull();
  });

  test("falls back to service-window scope when the traceId is absent or blank", () => {
    for (const traceId of [undefined, null, "", "   "]) {
      const plan: ExceptionLogsScopePlan = getExceptionLogsScopePlan({
        traceId,
        primaryEntityId: "service-1",
        time: "2026-08-14T10:00:00.000Z",
        now: NOW,
      });

      expect(plan.mode).toBe("service-window");
      expect(plan.traceId).toBeNull();
      expect(plan.primaryEntityId).toBe("service-1");
      expect(plan.anchorTime).not.toBeNull();
      expect(plan.window).not.toBeNull();
    }
  });

  test("service-window scope requires a parseable occurrence time", () => {
    const plan: ExceptionLogsScopePlan = getExceptionLogsScopePlan({
      traceId: "",
      primaryEntityId: "service-1",
      time: "garbage",
      now: NOW,
    });

    expect(plan.mode).toBe("none");
  });

  test("returns none when neither trace nor service scope is derivable", () => {
    const plan: ExceptionLogsScopePlan = getExceptionLogsScopePlan({});

    expect(plan.mode).toBe("none");
    expect(plan.traceId).toBeNull();
    expect(plan.primaryEntityId).toBeNull();
    expect(plan.anchorTime).toBeNull();
    expect(plan.window).toBeNull();
  });
});

describe("buildOccurrenceLogsContextRequest", () => {
  test("builds the /telemetry/logs/context body the endpoint requires", () => {
    const request: JSONObject | null = buildOccurrenceLogsContextRequest({
      primaryEntityId: "service-1",
      time: "2026-08-14T10:00:00.000Z",
    });

    expect(request).toEqual({
      logId: EXCEPTION_CONTEXT_ANCHOR_LOG_ID,
      primaryEntityId: "service-1",
      time: "2026-08-14T10:00:00.000Z",
      count: EXCEPTION_CONTEXT_LOG_COUNT,
    });
  });

  test("scopes to the occurrence's RUM session when one is present", () => {
    const request: JSONObject | null = buildOccurrenceLogsContextRequest({
      primaryEntityId: "service-1",
      time: "2026-08-14T10:00:00.000Z",
      sessionId: "session-1",
    });

    expect(request!["sessionIds"]).toEqual(["session-1"]);
  });

  test("omits sessionIds for a blank session id", () => {
    const request: JSONObject | null = buildOccurrenceLogsContextRequest({
      primaryEntityId: "service-1",
      time: "2026-08-14T10:00:00.000Z",
      sessionId: "  ",
    });

    expect(request!["sessionIds"]).toBeUndefined();
  });

  test("clamps count to the server's cap of 20 and floors fractions", () => {
    expect(
      buildOccurrenceLogsContextRequest({
        primaryEntityId: "service-1",
        time: "2026-08-14T10:00:00.000Z",
        count: 50,
      })!["count"],
    ).toBe(20);

    expect(
      buildOccurrenceLogsContextRequest({
        primaryEntityId: "service-1",
        time: "2026-08-14T10:00:00.000Z",
        count: 7.9,
      })!["count"],
    ).toBe(7);

    // Non-positive / non-finite counts fall back to the default.
    for (const count of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        buildOccurrenceLogsContextRequest({
          primaryEntityId: "service-1",
          time: "2026-08-14T10:00:00.000Z",
          count,
        })!["count"],
      ).toBe(EXCEPTION_CONTEXT_LOG_COUNT);
    }
  });

  test("returns null without a usable service id or time", () => {
    expect(
      buildOccurrenceLogsContextRequest({
        primaryEntityId: "",
        time: "2026-08-14T10:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      buildOccurrenceLogsContextRequest({
        primaryEntityId: "service-1",
        time: "garbage",
      }),
    ).toBeNull();

    expect(
      buildOccurrenceLogsContextRequest({
        primaryEntityId: undefined,
        time: undefined,
      }),
    ).toBeNull();
  });
});

describe("parseLogsContextResponse", () => {
  test("flattens before + after into one chronological list", () => {
    const rows: Array<OccurrenceContextLogRow> = parseLogsContextResponse({
      before: [
        {
          time: "2026-08-14T09:59:58.000Z",
          severityText: "Information",
          body: "warming up",
          traceId: "trace-1",
          spanId: "span-1",
        },
      ],
      after: [
        {
          time: "2026-08-14T10:00:01.000Z",
          severityText: "Error",
          body: "boom",
          traceId: "",
          spanId: "",
        },
      ],
    });

    expect(rows).toEqual([
      {
        section: "before",
        time: "2026-08-14T09:59:58.000Z",
        severityText: "Information",
        body: "warming up",
        traceId: "trace-1",
        spanId: "span-1",
      },
      {
        section: "after",
        time: "2026-08-14T10:00:01.000Z",
        severityText: "Error",
        body: "boom",
        traceId: "",
        spanId: "",
      },
    ]);
  });

  test("skips malformed rows and coerces missing fields to empty strings", () => {
    const rows: Array<OccurrenceContextLogRow> = parseLogsContextResponse({
      before: [null, "text", 42, [], { body: 123 }] as never,
      after: [{}] as never,
    });

    expect(rows).toEqual([
      {
        section: "before",
        time: "",
        severityText: "",
        body: "123",
        traceId: "",
        spanId: "",
      },
      {
        section: "after",
        time: "",
        severityText: "",
        body: "",
        traceId: "",
        spanId: "",
      },
    ]);
  });

  test("returns an empty list for null, undefined, and shapeless responses", () => {
    expect(parseLogsContextResponse(null)).toEqual([]);
    expect(parseLogsContextResponse(undefined)).toEqual([]);
    expect(parseLogsContextResponse({})).toEqual([]);
    expect(
      parseLogsContextResponse({ before: "nope", after: 12 } as never),
    ).toEqual([]);
  });
});

describe("getReplayAnchorOffsetMs", () => {
  test("anchors at the occurrence's own timestamp within the session", () => {
    expect(
      getReplayAnchorOffsetMs(
        "2026-08-14T10:00:30.000Z",
        "2026-08-14T10:00:00.000Z",
      ),
    ).toBe(30 * 1000);
  });

  test("clamps to zero when the occurrence predates the recording", () => {
    expect(
      getReplayAnchorOffsetMs(
        "2026-08-14T09:59:00.000Z",
        "2026-08-14T10:00:00.000Z",
      ),
    ).toBe(0);
  });

  test("returns null when either time is unreadable", () => {
    expect(
      getReplayAnchorOffsetMs(undefined, "2026-08-14T10:00:00.000Z"),
    ).toBeNull();
    expect(
      getReplayAnchorOffsetMs("2026-08-14T10:00:00.000Z", "garbage"),
    ).toBeNull();
    expect(getReplayAnchorOffsetMs("", "")).toBeNull();
  });
});

describe("collectDistinctSessionIds", () => {
  test("collects distinct non-blank ids in first-appearance order", () => {
    expect(
      collectDistinctSessionIds([
        { sessionId: "s-2" },
        { sessionId: "" },
        { sessionId: "s-1" },
        { sessionId: "s-2" },
        { sessionId: "  " },
        null,
        undefined,
        {},
      ]),
    ).toEqual(["s-2", "s-1"]);
  });

  test("returns an empty list for absent input", () => {
    expect(collectDistinctSessionIds(null)).toEqual([]);
    expect(collectDistinctSessionIds(undefined)).toEqual([]);
    expect(collectDistinctSessionIds([])).toEqual([]);
  });
});

describe("buildRumSessionAnchorMap", () => {
  test("indexes usable sessions and parses start times", () => {
    const anchors: Map<string, RumSessionAnchor> = buildRumSessionAnchorMap([
      {
        sessionId: "s-1",
        rumApplicationId: "app-1",
        startTime: "2026-08-14T10:00:00.000Z",
      },
      { sessionId: "s-2", rumApplicationId: "app-2", startTime: "garbage" },
    ]);

    expect(anchors.size).toBe(2);
    expect(anchors.get("s-1")!.rumApplicationId).toBe("app-1");
    expect(anchors.get("s-1")!.startTime?.toISOString()).toBe(
      "2026-08-14T10:00:00.000Z",
    );
    // The anchor survives an unreadable start (link starts at the beginning).
    expect(anchors.get("s-2")!.rumApplicationId).toBe("app-2");
    expect(anchors.get("s-2")!.startTime).toBeNull();
  });

  test("skips rows missing either id, and the first row per session wins", () => {
    const anchors: Map<string, RumSessionAnchor> = buildRumSessionAnchorMap([
      { sessionId: "", rumApplicationId: "app-1" },
      { sessionId: "s-1", rumApplicationId: "" },
      null,
      undefined,
      { sessionId: "s-1", rumApplicationId: "app-first" },
      { sessionId: "s-1", rumApplicationId: "app-second" },
    ]);

    expect(anchors.size).toBe(1);
    expect(anchors.get("s-1")!.rumApplicationId).toBe("app-first");
  });

  test("returns an empty map for absent input", () => {
    expect(buildRumSessionAnchorMap(null).size).toBe(0);
    expect(buildRumSessionAnchorMap(undefined).size).toBe(0);
    expect(buildRumSessionAnchorMap([]).size).toBe(0);
  });
});

describe("buildOccurrenceLogsExplorerLink", () => {
  const logsRoute: Route = new Route("/dashboard/project-1/logs");

  test("round-trips the trace filter and pinned window through URLSearchParams", () => {
    const link: OccurrenceLogsLink | null = buildOccurrenceLogsExplorerLink({
      logsRoute,
      traceId: "trace-1",
      time: "2026-08-14T10:00:00.000Z",
      now: NOW,
    });

    expect(link).not.toBeNull();
    expect(link!.dropped).toEqual([]);

    const routeString: string = link!.route.toString();
    expect(routeString.startsWith("/dashboard/project-1/logs?")).toBe(true);

    /*
     * The logs explorer reads these with URLSearchParams (one decode) and
     * JSON.parses `filters` — mirror exactly that.
     */
    const params: URLSearchParams = new URLSearchParams(
      routeString.split("?")[1] as string,
    );

    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["traceId", ["trace-1"]],
    ]);
    expect(params.get("range")).toBe(TimeRange.CUSTOM);
    expect(new Date(params.get("start") as string).toISOString()).toBe(
      "2026-08-14T09:55:00.000Z",
    );
    expect(new Date(params.get("end") as string).toISOString()).toBe(
      "2026-08-14T10:05:00.000Z",
    );
  });

  test("still links without a window when the occurrence time is unreadable", () => {
    const link: OccurrenceLogsLink | null = buildOccurrenceLogsExplorerLink({
      logsRoute,
      traceId: "trace-1",
      time: "garbage",
      now: NOW,
    });

    expect(link).not.toBeNull();

    const params: URLSearchParams = new URLSearchParams(
      link!.route.toString().split("?")[1] as string,
    );

    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["traceId", ["trace-1"]],
    ]);
    expect(params.get("range")).toBeNull();
    expect(params.get("start")).toBeNull();
    expect(params.get("end")).toBeNull();
    // A missing window is absent scope, not dropped scope.
    expect(link!.dropped).toEqual([]);
  });

  test("returns null for an absent or blank traceId", () => {
    for (const traceId of [undefined, null, "", "   "]) {
      expect(
        buildOccurrenceLogsExplorerLink({
          logsRoute,
          traceId,
          time: "2026-08-14T10:00:00.000Z",
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("returns null instead of throwing for ids Route cannot carry", () => {
    // encodeURIComponent leaves "~" bare and Route's whitelist rejects it.
    expect(
      buildOccurrenceLogsExplorerLink({
        logsRoute,
        traceId: "~trace",
        time: "2026-08-14T10:00:00.000Z",
        now: NOW,
      }),
    ).toBeNull();
  });
});
