import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import {
  EXCEPTION_CONTEXT_ANCHOR_LOG_ID,
  EXCEPTION_CONTEXT_LOG_COUNT,
  EXCEPTION_FINGERPRINT_SHORT_LENGTH,
  EXCEPTION_GROUP_LABEL_MAX_LENGTH,
  EXCEPTION_LOG_WINDOW_MS,
  ExceptionGroupLink,
  ExceptionGroupSummary,
  ExceptionLogsScopePlan,
  OccurrenceContextLogRow,
  OccurrenceLogWindow,
  OccurrenceLogsLink,
  REPLAY_CARD_MOMENT_TOLERANCE_MS,
  RumSessionAnchor,
  buildExceptionGroupLink,
  buildOccurrenceLogsContextRequest,
  buildOccurrenceLogsExplorerLink,
  buildRumSessionAnchorMap,
  collectDistinctSessionIds,
  getExceptionGroupLabel,
  getExceptionLogsScopePlan,
  getOccurrenceLogWindow,
  getReplayAnchorOffsetMs,
  getReplayCardMoment,
  indexExceptionGroupsByFingerprint,
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

describe("getReplayCardMoment (correlation-1)", () => {
  const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const OTHER_SESSION_ID: string = "ffffffffffffffffffffffffffffffff";
  const START: Date = new Date("2026-08-14T10:00:00.000Z");
  const END: Date = new Date("2026-08-14T10:10:00.000Z");
  const ERROR_UNIX_MS: number = START.getTime() + 5 * 60 * 1000;

  test("claims the moment only when the occurrence names the linked session and lies inside it", () => {
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: ERROR_UNIX_MS,
        instanceSessionId: SESSION_ID,
        session: { sessionId: SESSION_ID, startTime: START, endTime: END },
      }),
    ).toEqual({ errorTimeUnixMs: ERROR_UNIX_MS });
  });

  test("never pairs one instance's time with a different session's recording", () => {
    /*
     * The audit's failure: latestInstance is the newest occurrence, the
     * /for-exception list is the newest session that ever hit the
     * fingerprint, and they coincide only by luck.
     */
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: ERROR_UNIX_MS,
        instanceSessionId: OTHER_SESSION_ID,
        session: { sessionId: SESSION_ID, startTime: START, endTime: END },
      }),
    ).toBeNull();

    /* An occurrence with no session id cannot vouch for any recording. */
    for (const blank of [undefined, null, "", "   "]) {
      expect(
        getReplayCardMoment({
          errorTimeUnixMs: ERROR_UNIX_MS,
          instanceSessionId: blank,
          session: { sessionId: SESSION_ID, startTime: START, endTime: END },
        }),
      ).toBeNull();
    }
  });

  test("rejects an occurrence outside the recording beyond the skew tolerance", () => {
    const tooEarly: number =
      START.getTime() - REPLAY_CARD_MOMENT_TOLERANCE_MS - 1;
    const tooLate: number = END.getTime() + REPLAY_CARD_MOMENT_TOLERANCE_MS + 1;
    const justEarly: number = START.getTime() - REPLAY_CARD_MOMENT_TOLERANCE_MS;
    const justLate: number = END.getTime() + REPLAY_CARD_MOMENT_TOLERANCE_MS;

    const session: { sessionId: string; startTime: Date; endTime: Date } = {
      sessionId: SESSION_ID,
      startTime: START,
      endTime: END,
    };

    expect(
      getReplayCardMoment({
        errorTimeUnixMs: tooEarly,
        instanceSessionId: SESSION_ID,
        session,
      }),
    ).toBeNull();
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: tooLate,
        instanceSessionId: SESSION_ID,
        session,
      }),
    ).toBeNull();
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: justEarly,
        instanceSessionId: SESSION_ID,
        session,
      }),
    ).toEqual({ errorTimeUnixMs: justEarly });
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: justLate,
        instanceSessionId: SESSION_ID,
        session,
      }),
    ).toEqual({ errorTimeUnixMs: justLate });
  });

  test("derives the end from durationMs when endTime is blank, and accepts anything after the start of an open recording", () => {
    const withDuration: {
      sessionId: string;
      startTime: string;
      endTime: string;
      durationMs: number;
    } = {
      sessionId: SESSION_ID,
      startTime: START.toISOString(),
      endTime: "",
      durationMs: 60 * 1000,
    };

    expect(
      getReplayCardMoment({
        errorTimeUnixMs: START.getTime() + 30 * 1000,
        instanceSessionId: SESSION_ID,
        session: withDuration,
      }),
    ).toEqual({ errorTimeUnixMs: START.getTime() + 30 * 1000 });
    expect(
      getReplayCardMoment({
        errorTimeUnixMs:
          START.getTime() + 60 * 1000 + REPLAY_CARD_MOMENT_TOLERANCE_MS + 1,
        instanceSessionId: SESSION_ID,
        session: withDuration,
      }),
    ).toBeNull();

    const open: {
      sessionId: string;
      startTime: string;
      endTime: string;
      durationMs: number;
    } = {
      sessionId: SESSION_ID,
      startTime: START.toISOString(),
      endTime: "",
      durationMs: 0,
    };

    expect(
      getReplayCardMoment({
        errorTimeUnixMs: START.getTime() + 3 * 60 * 60 * 1000,
        instanceSessionId: SESSION_ID,
        session: open,
      }),
    ).toEqual({ errorTimeUnixMs: START.getTime() + 3 * 60 * 60 * 1000 });
  });

  test("trusts a matching id when the recording's start is unknown, and returns null for a bad time", () => {
    expect(
      getReplayCardMoment({
        errorTimeUnixMs: ERROR_UNIX_MS,
        instanceSessionId: SESSION_ID,
        session: { sessionId: SESSION_ID, startTime: "" },
      }),
    ).toEqual({ errorTimeUnixMs: ERROR_UNIX_MS });

    for (const bad of [
      undefined,
      null,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        getReplayCardMoment({
          errorTimeUnixMs: bad,
          instanceSessionId: SESSION_ID,
          session: { sessionId: SESSION_ID, startTime: START },
        }),
      ).toBeNull();
    }
  });
});

describe("getExceptionGroupLabel (correlation-7)", () => {
  test("reads as an error, not a hash, when the group was resolved", () => {
    expect(
      getExceptionGroupLabel({
        exceptionType: "TypeError",
        message: "x is not a function\n    at foo.js:1",
      }),
    ).toBe("TypeError: x is not a function");
    expect(getExceptionGroupLabel({ exceptionType: "TypeError" })).toBe(
      "TypeError",
    );
    expect(getExceptionGroupLabel({ message: "boom" })).toBe("boom");
  });

  test("truncates a long label with an ellipsis at the cap", () => {
    const label: string = getExceptionGroupLabel({
      exceptionType: "Error",
      message: "m".repeat(500),
    });

    expect(label.length).toBe(EXCEPTION_GROUP_LABEL_MAX_LENGTH);
    expect(label.endsWith("…")).toBe(true);
  });

  test("falls back to a shortened fingerprint, then to 'Unknown error'", () => {
    const fingerprint: string = "0123456789abcdef0123456789abcdef";

    expect(getExceptionGroupLabel(null, fingerprint)).toBe(
      `Error ${fingerprint.slice(0, EXCEPTION_FINGERPRINT_SHORT_LENGTH)}…`,
    );
    expect(getExceptionGroupLabel({ fingerprint: "abc" })).toBe("Error abc");
    expect(getExceptionGroupLabel(null, "")).toBe("Unknown error");
  });
});

describe("buildExceptionGroupLink (correlation-7)", () => {
  const listRoute: Route = new Route("/dashboard/p1/exceptions/unresolved");
  const viewRouteForId: (id: string) => Route = (id: string): Route => {
    return new Route(`/dashboard/p1/exceptions/${id}`);
  };
  const GROUP_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";

  test("links straight to the exception when the group id and a view route are known", () => {
    const link: ExceptionGroupLink | null = buildExceptionGroupLink({
      fingerprint: "fp-1",
      group: { id: GROUP_ID, exceptionType: "TypeError", message: "boom" },
      exceptionsListRoute: listRoute,
      exceptionViewRouteForId: viewRouteForId,
    });

    expect(link).not.toBeNull();
    expect(link!.isDirect).toBe(true);
    expect(link!.route.toString()).toBe(`/dashboard/p1/exceptions/${GROUP_ID}`);
    expect(link!.label).toBe("TypeError: boom");
  });

  test("falls back to the fingerprint-filtered list, with the same grammar as the trace panel", () => {
    const link: ExceptionGroupLink | null = buildExceptionGroupLink({
      fingerprint: "fp-1",
      exceptionsListRoute: listRoute,
    });

    expect(link).not.toBeNull();
    expect(link!.isDirect).toBe(false);

    const params: URLSearchParams = new URL(
      `https://example.com${link!.route.toString()}`,
    ).searchParams;

    expect(params.get("search")).toBe("@fingerprint:fp-1");
    expect(params.get("status")).toBe("all");
    expect(params.get("range")).toBe(TimeRange.PAST_THREE_MONTHS);
    expect(link!.label).toBe("Error fp-1");
  });

  test("falls back to the list when the view route builder is missing or throws", () => {
    const noBuilder: ExceptionGroupLink | null = buildExceptionGroupLink({
      fingerprint: "fp-1",
      group: { id: GROUP_ID },
      exceptionsListRoute: listRoute,
    });

    expect(noBuilder!.isDirect).toBe(false);

    const throwing: ExceptionGroupLink | null = buildExceptionGroupLink({
      fingerprint: "fp-1",
      group: { id: GROUP_ID },
      exceptionsListRoute: listRoute,
      exceptionViewRouteForId: (): Route => {
        throw new Error("bad id");
      },
    });

    expect(throwing!.isDirect).toBe(false);
  });

  test("returns null with neither a fingerprint nor a group id", () => {
    expect(
      buildExceptionGroupLink({
        fingerprint: "  ",
        group: { exceptionType: "TypeError" },
        exceptionsListRoute: listRoute,
        exceptionViewRouteForId: viewRouteForId,
      }),
    ).toBeNull();
  });
});

describe("indexExceptionGroupsByFingerprint", () => {
  test("indexes rows by fingerprint, first row wins, ids read from id or _id", () => {
    const index: Map<string, ExceptionGroupSummary> =
      indexExceptionGroupsByFingerprint([
        { _id: "id-1", fingerprint: "fp-1", exceptionType: "A", message: "m" },
        { id: "id-2", fingerprint: "fp-1", exceptionType: "B" },
        { id: "id-3", fingerprint: "fp-2" },
        { id: "id-4", fingerprint: "" },
        null,
      ]);

    expect(index.size).toBe(2);
    expect(index.get("fp-1")).toEqual({
      id: "id-1",
      fingerprint: "fp-1",
      exceptionType: "A",
      message: "m",
    });
    expect(index.get("fp-2")).toEqual({
      id: "id-3",
      fingerprint: "fp-2",
      exceptionType: null,
      message: null,
    });
  });

  test("tolerates absent input", () => {
    expect(indexExceptionGroupsByFingerprint(null).size).toBe(0);
    expect(indexExceptionGroupsByFingerprint(undefined).size).toBe(0);
  });
});
