import { describe, expect, it } from "@jest/globals";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import {
  REPLAY_TIMELINE_EVENT_KINDS,
  ReplayTimelineEvent,
  ReplayTimelineEventKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";
import {
  ReplayClockAlignmentState,
  ReplaySignal,
  ReplaySignalKind,
  ReplayTelemetryClock,
  makeRecordingSignalId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  REPLAY_SIGNAL_SEEK_PRE_ROLL_MS,
  REPLAY_SIGNAL_TITLE_MAX_LENGTH,
  REPLAY_TRACE_WATERFALL_MAX_SPANS,
  ReplayClientErrorSignalDetail,
  ReplayErrorPair,
  ReplayInteractionSignalDetail,
  ReplayLogSignalDetail,
  ReplayNetworkSignalDetail,
  ReplayPerformanceSignalDetail,
  ReplayServerErrorSignalDetail,
  ReplaySpanSignalDetail,
  ReplayTraceWaterfallSpan,
  buildErrorCounterpartIndex,
  findErrorAfterInteraction,
  findErrorLogsForTrace,
  formatSignalBytes,
  formatSignalDuration,
  fromExceptionRow,
  fromLogRow,
  fromSpanRow,
  fromTimelineEvent,
  fromTimelineEvents,
  getActiveSignalIndex,
  groupSpansIntoTraces,
  indexTraceSignalsByTraceId,
  isSignalActiveAt,
  mergeSignals,
  pairClientAndServerErrors,
  splitSignalUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";

/*
 * The rail renders one row shape for everything; these adapters are where
 * a recording event or a server row becomes that shape. Every kind must
 * land with the right severity, title, links and id, telemetry rows must
 * sit on the session clock WITHOUT the clockSkewMs correction (which only
 * applies to client-stamped values), and the merge/active-index helpers
 * must keep the "synced to the playhead" claim true.
 */

const START_UNIX_MS: number = 1_700_000_000_000;

function makeEvent(
  kind: ReplayTimelineEventKind,
  overrides?: Partial<ReplayTimelineEvent>,
): ReplayTimelineEvent {
  return {
    id: makeRecordingSignalId(2, 7),
    kind: kind,
    chunkIndex: 2,
    offsetMs: 12_500,
    ...overrides,
  };
}

const UNANCHORED: ReplayClockAlignmentState = {
  status: "unanchored",
  deltaMs: 0,
  pairCount: 0,
  uncertaintyMs: 3500,
};

const ANCHORED: ReplayClockAlignmentState = {
  status: "anchored",
  deltaMs: -1500,
  pairCount: 3,
  uncertaintyMs: 200,
};

function makeClock(
  alignment: ReplayClockAlignmentState = UNANCHORED,
  serviceNameById?: Record<string, string>,
): ReplayTelemetryClock {
  return {
    startTimeUnixMs: START_UNIX_MS,
    alignment: alignment,
    serviceNameById: serviceNameById,
  };
}

function makeLog(args: {
  id: string;
  atMs: number;
  body?: string;
  severity?: LogSeverity;
  severityNumber?: number;
  serviceId?: string;
  traceId?: string;
  spanId?: string;
}): Log {
  const log: Log = new Log();

  log.id = new ObjectID(args.id);
  log.time = new Date(START_UNIX_MS + args.atMs);
  log.body = args.body ?? "charge failed: card_declined";

  if (args.severity !== undefined) {
    log.severityText = args.severity;
  }

  if (args.severityNumber !== undefined) {
    log.severityNumber = args.severityNumber;
  }

  if (args.serviceId) {
    log.primaryEntityId = new ObjectID(args.serviceId);
  }

  if (args.traceId) {
    log.traceId = args.traceId;
  }

  if (args.spanId) {
    log.spanId = args.spanId;
  }

  return log;
}

function makeSpan(args: {
  spanId: string;
  traceId: string;
  atMs: number;
  durationMs: number;
  name?: string;
  parentSpanId?: string | undefined;
  status?: SpanStatus;
  serviceId?: string;
}): Span {
  const span: Span = new Span();

  span.spanId = args.spanId;
  span.traceId = args.traceId;
  span.startTime = new Date(START_UNIX_MS + args.atMs);
  span.durationUnixNano = args.durationMs * 1_000_000;
  span.name = args.name ?? `span ${args.spanId}`;

  if (args.parentSpanId) {
    span.parentSpanId = args.parentSpanId;
  }

  if (args.status !== undefined) {
    span.statusCode = args.status;
  }

  if (args.serviceId) {
    span.primaryEntityId = new ObjectID(args.serviceId);
  }

  return span;
}

function makeException(args: {
  id: string;
  atMs: number;
  message?: string;
  exceptionType?: string;
  fingerprint?: string;
  traceId?: string;
  spanId?: string;
  stackTrace?: string;
  serviceId?: string;
}): ExceptionInstance {
  const instance: ExceptionInstance = new ExceptionInstance();

  instance.id = new ObjectID(args.id);
  instance.time = new Date(START_UNIX_MS + args.atMs);
  instance.message = args.message ?? "Cannot read properties of undefined";

  if (args.exceptionType) {
    instance.exceptionType = args.exceptionType;
  }

  if (args.fingerprint) {
    instance.fingerprint = args.fingerprint;
  }

  if (args.traceId) {
    instance.traceId = args.traceId;
  }

  if (args.spanId) {
    instance.spanId = args.spanId;
  }

  if (args.stackTrace) {
    instance.stackTrace = args.stackTrace;
  }

  if (args.serviceId) {
    instance.primaryEntityId = new ObjectID(args.serviceId);
  }

  return instance;
}

function makeSignal(overrides: Partial<ReplaySignal>): ReplaySignal {
  return {
    id: overrides.id ?? "rec:0:0",
    kind: overrides.kind ?? "console",
    source: overrides.source ?? "recording",
    offsetMs: overrides.offsetMs ?? 0,
    severity: overrides.severity ?? "info",
    title: overrides.title ?? "row",
    links: overrides.links ?? {},
    detail: overrides.detail ?? {},
    ...overrides,
  };
}

describe("fromTimelineEvent: every kind maps", () => {
  const expectedKinds: Record<ReplayTimelineEventKind, ReplaySignalKind> = {
    console: "console",
    network: "network",
    route: "navigation",
    navigation: "navigation",
    error: "client-error",
    frustration: "frustration",
    performance: "performance",
    click: "interaction",
    visibility: "marker",
    custom: "custom",
    identify: "marker",
    tags: "marker",
    "click-dropped": "marker",
    "custom-dropped": "marker",
  };

  it.each(REPLAY_TIMELINE_EVENT_KINDS)(
    "%s becomes a recording signal with the event's id, chunk and offset",
    (kind: ReplayTimelineEventKind) => {
      const signal: ReplaySignal = fromTimelineEvent(makeEvent(kind), {
        startTimeUnixMs: START_UNIX_MS,
      });

      expect(signal.kind).toBe(expectedKinds[kind]);
      expect(signal.id).toBe("rec:2:7");
      expect(signal.source).toBe("recording");
      expect(signal.chunkIndex).toBe(2);
      expect(signal.offsetMs).toBe(12_500);
      expect(signal.alignment).toBe("exact");
      expect(signal.title.length).toBeGreaterThan(0);
      expect(signal.title).not.toContain("undefined");
      expect(signal.title).not.toContain("NaN");
    },
  );

  it("never throws on a bare event with no per-kind fields", () => {
    for (const kind of REPLAY_TIMELINE_EVENT_KINDS) {
      expect(() => {
        return fromTimelineEvent(makeEvent(kind), { startTimeUnixMs: null });
      }).not.toThrow();
    }
  });

  it("stamps a wall clock from the event, else from start + offset, else null", () => {
    const fromEvent: ReplaySignal = fromTimelineEvent(
      makeEvent("click", { atUnixMs: 123 }),
      { startTimeUnixMs: START_UNIX_MS },
    );
    const derived: ReplaySignal = fromTimelineEvent(makeEvent("click"), {
      startTimeUnixMs: START_UNIX_MS,
    });
    const unknown: ReplaySignal = fromTimelineEvent(makeEvent("click"), {
      startTimeUnixMs: null,
    });

    expect(fromEvent.detail["atUnixMs"]).toBe(123);
    expect(derived.detail["atUnixMs"]).toBe(START_UNIX_MS + 12_500);
    expect(unknown.detail["atUnixMs"]).toBeNull();
  });
});

describe("console rows", () => {
  it("maps level to severity and keeps the full message in detail", () => {
    const message: string = "TypeError: boom\n    at app.js:1:1";
    const error: ReplaySignal = fromTimelineEvent(
      makeEvent("console", { level: "error", message: message }),
      { startTimeUnixMs: null },
    );
    const warn: ReplaySignal = fromTimelineEvent(
      makeEvent("console", { level: "warn", message: "careful" }),
      { startTimeUnixMs: null },
    );

    expect(error.severity).toBe("error");
    expect(error.title).toBe("TypeError: boom");
    expect(error.subtitle).toBe("error");
    expect(error.detail["message"]).toBe(message);
    expect(warn.severity).toBe("warn");
  });

  it("truncates long titles with an ellipsis but not the detail", () => {
    const message: string = "x".repeat(REPLAY_SIGNAL_TITLE_MAX_LENGTH + 50);
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("console", { level: "warn", message: message }),
      { startTimeUnixMs: null },
    );

    expect(signal.title.length).toBe(REPLAY_SIGNAL_TITLE_MAX_LENGTH);
    expect(signal.title.endsWith("…")).toBe(true);
    expect(signal.detail["message"]).toBe(message);
  });
});

describe("network rows", () => {
  const base: Partial<ReplayTimelineEvent> = {
    method: "post",
    url: "https://api.example.com/api/orders?x=1",
    status: 500,
    durationMs: 220,
    responseBytes: 1229,
    requestBytes: 512,
    initiator: "fetch",
    traceId: "abc123abc123abc123abc123abc123ab",
    isError: true,
  };

  it("renders 'POST 500 /api/orders' with duration and bytes and a trace link", () => {
    const signal: ReplaySignal = fromTimelineEvent(makeEvent("network", base), {
      startTimeUnixMs: null,
    });
    const detail: ReplayNetworkSignalDetail =
      signal.detail as ReplayNetworkSignalDetail;

    expect(signal.title).toBe("POST 500 /api/orders?x=1");
    expect(signal.subtitle).toBe("220ms 1.2KB");
    expect(signal.severity).toBe("error");
    expect(signal.links.traceId).toBe(base.traceId);
    expect(detail.method).toBe("POST");
    expect(detail.url).toBe(base.url);
    expect(detail.origin).toBe("https://api.example.com");
    expect(detail.path).toBe("/api/orders?x=1");
    expect(detail.status).toBe(500);
    expect(detail.durationMs).toBe(220);
    expect(detail.responseBytes).toBe(1229);
    expect(detail.requestBytes).toBe(512);
    expect(detail.initiator).toBe("fetch");
    expect(detail.traceId).toBe(base.traceId);
    expect(detail.isError).toBe(true);
    expect(detail.failedBeforeResponse).toBe(false);
    expect(detail.isSlow).toBe(false);
  });

  it("grades severity by status: 2xx info, 4xx warn, 5xx error, 0 error", () => {
    const grade: (status: number) => string = (status: number): string => {
      return fromTimelineEvent(
        makeEvent("network", { ...base, status: status, isError: false }),
        { startTimeUnixMs: null },
      ).severity;
    };

    expect(grade(200)).toBe("info");
    expect(grade(302)).toBe("info");
    expect(grade(404)).toBe("warn");
    expect(grade(503)).toBe("error");
    expect(grade(0)).toBe("error");
  });

  it("names a status-0 request 'failed' and flags it as failed before response", () => {
    const failedBase: Partial<ReplayTimelineEvent> = { ...base, status: 0 };

    delete failedBase.durationMs;

    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("network", failedBase),
      { startTimeUnixMs: null },
    );
    const detail: ReplayNetworkSignalDetail =
      signal.detail as ReplayNetworkSignalDetail;

    expect(signal.title).toBe("POST failed /api/orders?x=1");
    expect(detail.failedBeforeResponse).toBe(true);
    expect(detail.isError).toBe(true);
    /* No duration was measured, so none is claimed. */
    expect(detail.durationMs).toBeNull();
    expect(signal.subtitle).toBe("1.2KB");
  });

  it("omits the subtitle entirely when neither duration nor bytes were measured", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("network", { method: "GET", url: "/x", status: 200 }),
      { startTimeUnixMs: null },
    );

    expect(signal.subtitle).toBeUndefined();
    expect(signal.links.traceId).toBeUndefined();
  });

  it("flags requests over 1s as slow", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("network", { ...base, status: 200, durationMs: 1400 }),
      { startTimeUnixMs: null },
    );

    expect((signal.detail as ReplayNetworkSignalDetail).isSlow).toBe(true);
    expect(signal.subtitle).toBe("1.4s 1.2KB");
  });
});

describe("navigation rows", () => {
  it("labels history routes by kind and full loads as such", () => {
    const route: ReplaySignal = fromTimelineEvent(
      makeEvent("route", {
        from: "/cart",
        to: "/checkout",
        routeKind: "pushState",
      }),
      { startTimeUnixMs: null },
    );
    const load: ReplaySignal = fromTimelineEvent(
      makeEvent("navigation", { to: "https://app.example.com/login" }),
      { startTimeUnixMs: null },
    );

    expect(route.title).toBe("/checkout");
    expect(route.subtitle).toBe("history push");
    expect(route.detail["from"]).toBe("/cart");
    expect(route.detail["kind"]).toBe("pushState");
    expect(load.title).toBe("https://app.example.com/login");
    expect(load.subtitle).toBe("full page load");
    expect(load.detail["kind"]).toBe("full-load");
    expect(load.detail["from"]).toBeNull();
  });
});

describe("client error rows", () => {
  it("carries stack, source, line and column into detail with a location line", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("error", {
        errorKind: "error",
        message: "Cannot read properties of undefined (reading 'id')",
        source: "https://app.example.com/static/app.js",
        lineNumber: 12,
        columnNumber: 5,
        stack: "TypeError: Cannot read...\n    at render (app.js:12:5)",
      }),
      { startTimeUnixMs: null },
    );
    const detail: ReplayClientErrorSignalDetail =
      signal.detail as ReplayClientErrorSignalDetail;

    expect(signal.kind).toBe("client-error");
    expect(signal.severity).toBe("error");
    expect(signal.title).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
    expect(signal.subtitle).toBe("uncaught error · /static/app.js:12:5");
    expect(detail.stack).toContain("at render");
    expect(detail.source).toBe("https://app.example.com/static/app.js");
    expect(detail.lineNumber).toBe(12);
    expect(detail.columnNumber).toBe(5);
    expect(detail.location).toBe("/static/app.js:12:5");
  });

  it("labels unhandled rejections and tolerates a missing location", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("error", {
        errorKind: "unhandledrejection",
        message: "Network down",
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.subtitle).toBe("unhandled rejection");
    expect(
      (signal.detail as ReplayClientErrorSignalDetail).location,
    ).toBeNull();
    expect((signal.detail as ReplayClientErrorSignalDetail).stack).toBeNull();
  });
});

describe("frustration and interaction rows", () => {
  it("names each frustration kind and quantifies it", () => {
    const rage: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", {
        frustrationKind: "rage-click",
        clickCount: 5,
        x: 120.4,
        y: 340.6,
      }),
      { startTimeUnixMs: null },
    );
    const refresh: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", {
        frustrationKind: "refresh-rage",
        reloadCount: 3,
      }),
      { startTimeUnixMs: null },
    );
    const dead: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", { frustrationKind: "dead-click" }),
      { startTimeUnixMs: null },
    );

    expect(rage.kind).toBe("frustration");
    expect(rage.severity).toBe("warn");
    expect(rage.title).toBe("Rage click (5 clicks)");
    expect(rage.subtitle).toBe("at 120, 341");
    expect(refresh.title).toBe("Refresh rage (3 reloads)");
    expect(dead.title).toBe("Dead click");
    expect(dead.subtitle).toBeUndefined();
  });

  it("prefers the click's text, then its selector, then coordinates", () => {
    const labelled: ReplaySignal = fromTimelineEvent(
      makeEvent("click", {
        selector: "button.pay",
        text: "Pay now",
        x: 10,
        y: 20,
      }),
      { startTimeUnixMs: null },
    );
    const selectorOnly: ReplaySignal = fromTimelineEvent(
      makeEvent("click", { selector: "button.pay", x: 10, y: 20 }),
      { startTimeUnixMs: null },
    );
    const coordinates: ReplaySignal = fromTimelineEvent(
      makeEvent("click", { x: 10, y: 20 }),
      { startTimeUnixMs: null },
    );

    expect(labelled.kind).toBe("interaction");
    expect(labelled.title).toBe('Click "Pay now"');
    expect(labelled.subtitle).toBe("button.pay");
    expect(selectorOnly.title).toBe("Click button.pay");
    expect(selectorOnly.subtitle).toBe("at 10, 20");
    expect(coordinates.title).toBe("Click at (10, 20)");
    expect(
      (coordinates.detail as ReplayInteractionSignalDetail).isCoordinateOnly,
    ).toBe(true);
    expect(
      (labelled.detail as ReplayInteractionSignalDetail).isCoordinateOnly,
    ).toBe(false);
  });
});

describe("performance rows", () => {
  it("renders budget overruns as 'LCP 4.8s (budget 4s)' with warn severity", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("performance", {
        performanceKind: "lcp",
        durationMs: 4800,
        budgetMs: 4000,
        url: "https://app.example.com/checkout",
      }),
      { startTimeUnixMs: null },
    );
    const detail: ReplayPerformanceSignalDetail =
      signal.detail as ReplayPerformanceSignalDetail;

    expect(signal.title).toBe("LCP 4.8s (budget 4s)");
    expect(signal.severity).toBe("warn");
    expect(signal.subtitle).toBe("/checkout");
    expect(detail.isOverBudget).toBe(true);
    expect(detail.kind).toBe("lcp");
  });

  it("grades web vitals by rating and formats CLS without a unit", () => {
    const poor: ReplaySignal = fromTimelineEvent(
      makeEvent("performance", {
        performanceKind: "web-vital",
        metric: "INP",
        value: 320,
        rating: "poor",
      }),
      { startTimeUnixMs: null },
    );
    const good: ReplaySignal = fromTimelineEvent(
      makeEvent("performance", {
        performanceKind: "web-vital",
        metric: "CLS",
        value: 0.0234,
        rating: "good",
      }),
      { startTimeUnixMs: null },
    );

    expect(poor.title).toBe("INP 320ms poor");
    expect(poor.severity).toBe("error");
    expect((poor.detail as ReplayPerformanceSignalDetail).isOverBudget).toBe(
      true,
    );
    expect(good.title).toBe("CLS 0.023 good");
    expect(good.severity).toBe("success");
    expect((good.detail as ReplayPerformanceSignalDetail).isOverBudget).toBe(
      false,
    );
  });

  it("does not claim a budget or duration it was not given", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("performance", { performanceKind: "long-task" }),
      { startTimeUnixMs: null },
    );

    expect(signal.title).toBe("Long task");
    expect(signal.severity).toBe("info");
    expect(signal.title).not.toContain("0ms");
  });
});

describe("custom and marker rows", () => {
  it("names the custom event and counts its properties", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("custom", {
        name: "checkout.step",
        properties: { step: "2", plan: "pro" },
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.kind).toBe("custom");
    expect(signal.title).toBe("checkout.step");
    expect(signal.subtitle).toBe("2 properties");
    expect(signal.detail["properties"]).toEqual({ step: "2", plan: "pro" });
  });

  it("renders visibility, identify, tags and cap notices as markers", () => {
    const hidden: ReplaySignal = fromTimelineEvent(
      makeEvent("visibility", { visibilityState: "hidden" }),
      { startTimeUnixMs: null },
    );
    const identify: ReplaySignal = fromTimelineEvent(
      makeEvent("identify", { hasTraits: true }),
      { startTimeUnixMs: null },
    );
    const tags: ReplaySignal = fromTimelineEvent(
      makeEvent("tags", { tags: { plan: "pro" } }),
      { startTimeUnixMs: null },
    );
    const dropped: ReplaySignal = fromTimelineEvent(
      makeEvent("click-dropped", { droppedCount: 12 }),
      { startTimeUnixMs: null },
    );
    const droppedCustom: ReplaySignal = fromTimelineEvent(
      makeEvent("custom-dropped", { droppedCount: 3 }),
      { startTimeUnixMs: null },
    );

    expect(hidden.title).toBe("Tab hidden");
    expect(hidden.detail["markerKind"]).toBe("visibility");
    expect(identify.title).toBe("User identified");
    expect(identify.subtitle).toBe("with traits");
    expect(tags.title).toBe("Tags set");
    expect(tags.subtitle).toBe("1 tag");
    expect(dropped.title).toBe("12 clicks not labelled (recorder cap)");
    expect(dropped.severity).toBe("warn");
    expect(droppedCustom.title).toBe(
      "3 custom events not recorded (recorder cap)",
    );
  });

  it("fromTimelineEvents maps a batch in order", () => {
    const signals: Array<ReplaySignal> = fromTimelineEvents(
      [
        makeEvent("console", { id: "rec:0:0", level: "warn", message: "a" }),
        makeEvent("click", { id: "rec:0:1", x: 1, y: 2 }),
      ],
      { startTimeUnixMs: null },
    );

    expect(
      signals.map((signal: ReplaySignal): string => {
        return signal.id;
      }),
    ).toEqual(["rec:0:0", "rec:0:1"]);
  });
});

describe("fromLogRow", () => {
  it("places the row at time - startTimeUnixMs on the baseline, labelled unanchored", () => {
    const signal: ReplaySignal | null = fromLogRow(
      makeLog({
        id: "log-1",
        atMs: 42_000,
        severity: LogSeverity.Error,
        traceId: "trace-a",
        spanId: "span-a",
        serviceId: "svc-1",
      }),
      makeClock(UNANCHORED, { "svc-1": "payment-svc" }),
    );

    expect(signal).not.toBeNull();
    expect(signal?.id).toBe("log:log-1");
    expect(signal?.kind).toBe("log");
    expect(signal?.source).toBe("telemetry");
    expect(signal?.offsetMs).toBe(42_000);
    expect(signal?.alignment).toBe("unanchored");
    expect(signal?.severity).toBe("error");
    expect(signal?.title).toBe("[ERROR] charge failed: card_declined");
    expect(signal?.subtitle).toBe("payment-svc");
    expect(signal?.links).toEqual({
      traceId: "trace-a",
      spanId: "span-a",
      logId: "log-1",
    });

    const detail: ReplayLogSignalDetail =
      signal?.detail as ReplayLogSignalDetail;

    expect(detail.level).toBe("ERROR");
    expect(detail.serviceName).toBe("payment-svc");
    expect(detail.timeUnixMs).toBe(START_UNIX_MS + 42_000);
    expect(detail.baselineOffsetMs).toBe(42_000);
  });

  it("applies the anchoring delta when anchored, and keeps the baseline in detail", () => {
    const signal: ReplaySignal | null = fromLogRow(
      makeLog({ id: "log-2", atMs: 42_000, severity: LogSeverity.Warning }),
      makeClock(ANCHORED),
    );

    expect(signal?.offsetMs).toBe(42_000 + ANCHORED.deltaMs);
    expect(signal?.alignment).toBe("anchored");
    expect((signal?.detail as ReplayLogSignalDetail).baselineOffsetMs).toBe(
      42_000,
    );
    expect(signal?.severity).toBe("warn");
    expect(signal?.title).toBe("[WARN] charge failed: card_declined");
  });

  it("is never adjusted by a clock skew, whatever the manifest says", () => {
    /*
     * The clock has no clockSkewMs input on purpose: skew is a client-vs-
     * server delta and these rows are server-stamped. Pin the shape so a
     * future "helpful" parameter cannot creep in.
     */
    const clock: ReplayTelemetryClock = makeClock(UNANCHORED);

    expect(Object.keys(clock).sort()).toEqual([
      "alignment",
      "serviceNameById",
      "startTimeUnixMs",
    ]);
    expect(
      fromLogRow(makeLog({ id: "log-3", atMs: 10_000 }), clock)?.offsetMs,
    ).toBe(10_000);
  });

  it("falls back to the OTLP severity number and omits the level when unset", () => {
    const numbered: ReplaySignal | null = fromLogRow(
      makeLog({ id: "log-4", atMs: 1, severityNumber: 18 }),
      makeClock(),
    );
    const plain: ReplaySignal | null = fromLogRow(
      makeLog({ id: "log-5", atMs: 1, body: "hello" }),
      makeClock(),
    );

    expect(numbered?.severity).toBe("error");
    expect(plain?.severity).toBe("info");
    expect(plain?.title).toBe("hello");
    expect(plain?.subtitle).toBeUndefined();
  });

  it("returns null for a row with no id or no time", () => {
    const noTime: Log = new Log();

    noTime.id = new ObjectID("log-6");

    const noId: Log = new Log();

    noId.time = new Date(START_UNIX_MS);

    expect(fromLogRow(noTime, makeClock())).toBeNull();
    expect(fromLogRow(noId, makeClock())).toBeNull();
  });
});

describe("fromExceptionRow", () => {
  it("maps to a server-error with fingerprint, instance, trace and span links", () => {
    const signal: ReplaySignal | null = fromExceptionRow(
      makeException({
        id: "exc-1",
        atMs: 9_000,
        exceptionType: "TypeError",
        message: "Cannot read properties of undefined",
        fingerprint: "fp-1",
        traceId: "trace-a",
        spanId: "span-a",
        stackTrace: "TypeError: ...\n at handler",
        serviceId: "svc-1",
      }),
      makeClock(ANCHORED, { "svc-1": "orders-svc" }),
    );

    expect(signal?.id).toBe("exc:exc-1");
    expect(signal?.kind).toBe("server-error");
    expect(signal?.severity).toBe("error");
    expect(signal?.offsetMs).toBe(9_000 + ANCHORED.deltaMs);
    expect(signal?.alignment).toBe("anchored");
    expect(signal?.title).toBe(
      "TypeError: Cannot read properties of undefined",
    );
    expect(signal?.subtitle).toBe("orders-svc");
    expect(signal?.links).toEqual({
      exceptionInstanceId: "exc-1",
      exceptionFingerprint: "fp-1",
      traceId: "trace-a",
      spanId: "span-a",
    });

    const detail: ReplayServerErrorSignalDetail =
      signal?.detail as ReplayServerErrorSignalDetail;

    expect(detail.stackTrace).toContain("at handler");
    expect(detail.fingerprint).toBe("fp-1");
    expect(detail.baselineOffsetMs).toBe(9_000);
  });

  it("uses the message alone when there is no type, and 'Exception' when there is neither", () => {
    const messageOnly: ReplaySignal | null = fromExceptionRow(
      makeException({ id: "exc-2", atMs: 1, message: "boom" }),
      makeClock(),
    );
    const bare: ReplaySignal | null = fromExceptionRow(
      makeException({ id: "exc-3", atMs: 1, message: "" }),
      makeClock(),
    );

    expect(messageOnly?.title).toBe("boom");
    expect(bare?.title).toBe("Exception");
    expect(bare?.links).toEqual({ exceptionInstanceId: "exc-3" });
  });

  it("returns null without an id or a time", () => {
    const instance: ExceptionInstance = new ExceptionInstance();

    instance.message = "x";

    expect(fromExceptionRow(instance, makeClock())).toBeNull();
  });
});

describe("spans and traces", () => {
  it("fromSpanRow yields one trace row spanning the span's duration", () => {
    const signal: ReplaySignal | null = fromSpanRow(
      makeSpan({
        spanId: "s1",
        traceId: "t1",
        atMs: 5_000,
        durationMs: 250,
        name: "GET /api/orders",
        serviceId: "svc-1",
      }),
      makeClock(UNANCHORED, { "svc-1": "orders-svc" }),
    );

    expect(signal?.id).toBe("span:s1");
    expect(signal?.kind).toBe("span");
    expect(signal?.offsetMs).toBe(5_000);
    expect(signal?.endOffsetMs).toBe(5_250);
    expect(signal?.title).toBe("GET /api/orders");
    expect(signal?.subtitle).toBe("orders-svc · 250ms · 1 span");
    expect(signal?.links).toEqual({ traceId: "t1", spanId: "s1" });
    expect(signal?.severity).toBe("info");
  });

  it("groupSpansIntoTraces makes one row per trace with a waterfall and an end offset", () => {
    const rows: Array<Span> = [
      makeSpan({
        spanId: "child-b",
        traceId: "t1",
        atMs: 5_120,
        durationMs: 80,
        parentSpanId: "child-a",
        status: SpanStatus.Error,
      }),
      makeSpan({
        spanId: "root",
        traceId: "t1",
        atMs: 5_000,
        durationMs: 300,
        name: "POST /checkout",
        serviceId: "svc-1",
      }),
      makeSpan({
        spanId: "child-a",
        traceId: "t1",
        atMs: 5_100,
        durationMs: 150,
        parentSpanId: "root",
      }),
      makeSpan({
        spanId: "other",
        traceId: "t2",
        atMs: 1_000,
        durationMs: 10,
        name: "GET /health",
      }),
    ];
    const signals: Array<ReplaySignal> = groupSpansIntoTraces(
      rows,
      makeClock(UNANCHORED, { "svc-1": "checkout-svc" }),
    );

    expect(signals).toHaveLength(2);
    /* Sorted by the earliest span of each trace. */
    expect(signals[0]?.links.traceId).toBe("t2");

    const trace: ReplaySignal = signals[1] as ReplaySignal;
    const detail: ReplaySpanSignalDetail =
      trace.detail as ReplaySpanSignalDetail;

    expect(trace.id).toBe("span:root");
    expect(trace.offsetMs).toBe(5_000);
    expect(trace.endOffsetMs).toBe(5_300);
    expect(trace.title).toBe("POST /checkout");
    expect(trace.subtitle).toBe("checkout-svc · 300ms · 3 spans");
    expect(trace.severity).toBe("error");
    expect(detail.spanCount).toBe(3);
    expect(detail.errorSpanCount).toBe(1);
    expect(detail.hasError).toBe(true);
    expect(detail.rootSpanId).toBe("root");
    expect(detail.isWaterfallTruncated).toBe(false);
    expect(
      detail.spans.map(
        (span: ReplayTraceWaterfallSpan): [string, number, number] => {
          return [span.spanId, span.depth, span.startOffsetMs];
        },
      ),
    ).toEqual([
      ["root", 0, 0],
      ["child-a", 1, 100],
      ["child-b", 2, 120],
    ]);
    expect(detail.spans[2]?.hasError).toBe(true);
    expect(detail.spans[1]?.sessionOffsetMs).toBe(5_100);
  });

  it("uses the earliest span as the root when the real root was not ingested", () => {
    const signals: Array<ReplaySignal> = groupSpansIntoTraces(
      [
        makeSpan({
          spanId: "late",
          traceId: "t1",
          atMs: 2_000,
          durationMs: 5,
          parentSpanId: "missing-root",
        }),
        makeSpan({
          spanId: "early",
          traceId: "t1",
          atMs: 1_000,
          durationMs: 5,
          parentSpanId: "missing-root",
        }),
      ],
      makeClock(),
    );

    expect(signals[0]?.id).toBe("span:early");
    expect((signals[0]?.detail as ReplaySpanSignalDetail).spans[0]?.depth).toBe(
      0,
    );
  });

  it("caps the waterfall at the max span count and says so", () => {
    const rows: Array<Span> = [];

    for (let i: number = 0; i < REPLAY_TRACE_WATERFALL_MAX_SPANS + 5; i++) {
      rows.push(
        makeSpan({
          spanId: `s${i}`,
          traceId: "t1",
          atMs: 1_000 + i,
          durationMs: 1,
          parentSpanId: i === 0 ? undefined : "s0",
        }),
      );
    }

    const detail: ReplaySpanSignalDetail = groupSpansIntoTraces(
      rows,
      makeClock(),
    )[0]?.detail as ReplaySpanSignalDetail;

    expect(detail.spanCount).toBe(REPLAY_TRACE_WATERFALL_MAX_SPANS + 5);
    expect(detail.spans).toHaveLength(REPLAY_TRACE_WATERFALL_MAX_SPANS);
    expect(detail.isWaterfallTruncated).toBe(true);
  });

  it("skips spans without a trace id or a start time", () => {
    const orphan: Span = new Span();

    orphan.spanId = "x";

    expect(groupSpansIntoTraces([orphan], makeClock())).toEqual([]);
    expect(fromSpanRow(orphan, makeClock())).toBeNull();
  });

  it("shifts trace rows by the anchoring delta when anchored", () => {
    const signal: ReplaySignal | null = fromSpanRow(
      makeSpan({ spanId: "s1", traceId: "t1", atMs: 5_000, durationMs: 100 }),
      makeClock(ANCHORED),
    );

    expect(signal?.offsetMs).toBe(5_000 + ANCHORED.deltaMs);
    expect(signal?.endOffsetMs).toBe(5_100 + ANCHORED.deltaMs);
  });
});

describe("mergeSignals", () => {
  it("orders by offset, then recording before telemetry, then input order", () => {
    const merged: Array<ReplaySignal> = mergeSignals(
      [
        makeSignal({ id: "log:b", source: "telemetry", offsetMs: 100 }),
        makeSignal({ id: "rec:1:1", source: "recording", offsetMs: 300 }),
      ],
      [
        makeSignal({ id: "rec:1:0", source: "recording", offsetMs: 100 }),
        makeSignal({ id: "log:a", source: "telemetry", offsetMs: 100 }),
        makeSignal({ id: "rec:0:0", source: "recording", offsetMs: 50 }),
      ],
    );

    expect(
      merged.map((signal: ReplaySignal): string => {
        return signal.id;
      }),
    ).toEqual(["rec:0:0", "rec:1:0", "log:b", "log:a", "rec:1:1"]);
  });

  it("does not mutate its inputs and accepts no lists", () => {
    const input: Array<ReplaySignal> = [
      makeSignal({ id: "b", offsetMs: 2 }),
      makeSignal({ id: "a", offsetMs: 1 }),
    ];

    mergeSignals(input);

    expect(input[0]?.id).toBe("b");
    expect(mergeSignals()).toEqual([]);
  });
});

describe("getActiveSignalIndex", () => {
  const signals: Array<ReplaySignal> = [
    makeSignal({ id: "a", offsetMs: 1000 }),
    makeSignal({ id: "b", offsetMs: 2000 }),
    makeSignal({ id: "c", offsetMs: 3000 }),
  ];

  it("returns the last row the playhead has passed, -1 before the first (old helper parity)", () => {
    expect(getActiveSignalIndex(signals, 0)).toBe(-1);
    expect(getActiveSignalIndex(signals, 999)).toBe(-1);
    expect(getActiveSignalIndex(signals, 1000)).toBe(0);
    expect(getActiveSignalIndex(signals, 2500)).toBe(1);
    expect(getActiveSignalIndex(signals, 99_999)).toBe(2);
    expect(getActiveSignalIndex([], 5)).toBe(-1);
  });

  it("keeps the clicked row active while the playhead sits in its pre-roll window", () => {
    /* Row click seeks to offset - pre-roll; the clicked row must not dim. */
    const seekTarget: number = 3000 - REPLAY_SIGNAL_SEEK_PRE_ROLL_MS;

    expect(getActiveSignalIndex(signals, seekTarget)).toBe(1);
    expect(getActiveSignalIndex(signals, seekTarget, "c")).toBe(2);
    /* Once the playhead moves past the row, the plain rule applies again. */
    expect(getActiveSignalIndex(signals, 3000, "c")).toBe(2);
    expect(getActiveSignalIndex(signals, 1500, "c")).toBe(0);
    /* An unknown selection changes nothing. */
    expect(getActiveSignalIndex(signals, seekTarget, "zzz")).toBe(1);
  });

  it("isSignalActiveAt treats traces as live for their whole duration", () => {
    const trace: ReplaySignal = makeSignal({
      id: "span:1",
      kind: "span",
      offsetMs: 1000,
      endOffsetMs: 1500,
    });
    const point: ReplaySignal = makeSignal({ id: "rec:0:0", offsetMs: 1000 });

    expect(isSignalActiveAt(trace, 999)).toBe(false);
    expect(isSignalActiveAt(trace, 1000)).toBe(true);
    expect(isSignalActiveAt(trace, 1400)).toBe(true);
    expect(isSignalActiveAt(trace, 1501)).toBe(false);
    expect(isSignalActiveAt(point, 1000)).toBe(true);
    expect(isSignalActiveAt(point, 1001)).toBe(false);
  });
});

describe("cross-references", () => {
  it("indexes trace rows by trace id and finds error logs on a trace", () => {
    const trace: ReplaySignal = makeSignal({
      id: "span:root",
      kind: "span",
      source: "telemetry",
      links: { traceId: "t1", spanId: "root" },
    });
    const errorLog: ReplaySignal = makeSignal({
      id: "log:1",
      kind: "log",
      source: "telemetry",
      severity: "error",
      links: { traceId: "t1", logId: "1" },
    });
    const infoLog: ReplaySignal = makeSignal({
      id: "log:2",
      kind: "log",
      source: "telemetry",
      severity: "info",
      links: { traceId: "t1", logId: "2" },
    });
    const otherError: ReplaySignal = makeSignal({
      id: "log:3",
      kind: "log",
      source: "telemetry",
      severity: "error",
      links: { traceId: "t2", logId: "3" },
    });
    const all: Array<ReplaySignal> = [trace, errorLog, infoLog, otherError];

    expect(indexTraceSignalsByTraceId(all).get("t1")).toBe(trace);
    expect(indexTraceSignalsByTraceId(all).has("t2")).toBe(false);
    expect(findErrorLogsForTrace(all, "t1")).toEqual([errorLog]);
    expect(findErrorLogsForTrace(all, "")).toEqual([]);
  });

  it("pairs a client error with the nearest server exception of the same message within 2s", () => {
    const client: ReplaySignal = fromTimelineEvent(
      makeEvent("error", {
        id: "rec:0:0",
        offsetMs: 10_000,
        errorKind: "error",
        message: "Cannot read properties of undefined",
      }),
      { startTimeUnixMs: null },
    );
    const near: ReplaySignal = fromExceptionRow(
      makeException({
        id: "near",
        atMs: 11_500,
        exceptionType: "TypeError",
        message: "Cannot read properties of undefined",
      }),
      makeClock(),
    ) as ReplaySignal;
    const nearer: ReplaySignal = fromExceptionRow(
      makeException({
        id: "nearer",
        atMs: 9_600,
        message: "cannot read properties of undefined",
      }),
      makeClock(),
    ) as ReplaySignal;
    const far: ReplaySignal = fromExceptionRow(
      makeException({
        id: "far",
        atMs: 13_000,
        message: "Cannot read properties of undefined",
      }),
      makeClock(),
    ) as ReplaySignal;
    const different: ReplaySignal = fromExceptionRow(
      makeException({ id: "different", atMs: 10_000, message: "other" }),
      makeClock(),
    ) as ReplaySignal;

    const pairs: Array<ReplayErrorPair> = pairClientAndServerErrors([
      client,
      near,
      nearer,
      far,
      different,
    ]);

    expect(pairs).toEqual([
      { clientSignalId: "rec:0:0", serverSignalId: "exc:nearer", gapMs: -400 },
    ]);

    const index: Map<string, string> = buildErrorCounterpartIndex(pairs);

    expect(index.get("rec:0:0")).toBe("exc:nearer");
    expect(index.get("exc:nearer")).toBe("rec:0:0");
    expect(index.has("exc:near")).toBe(false);
  });

  it("matches a client message against 'Type: message' on the server side", () => {
    const client: ReplaySignal = fromTimelineEvent(
      makeEvent("error", {
        offsetMs: 1_000,
        errorKind: "error",
        message: "TypeError: boom",
      }),
      { startTimeUnixMs: null },
    );
    const server: ReplaySignal = fromExceptionRow(
      makeException({
        id: "s",
        atMs: 1_200,
        exceptionType: "TypeError",
        message: "boom",
      }),
      makeClock(),
    ) as ReplaySignal;

    expect(pairClientAndServerErrors([client, server])).toHaveLength(1);
    expect(pairClientAndServerErrors([client])).toEqual([]);
  });

  it("finds the first client error shortly after an interaction", () => {
    const click: ReplaySignal = makeSignal({
      id: "rec:0:0",
      kind: "interaction",
      offsetMs: 5_000,
    });
    const before: ReplaySignal = makeSignal({
      id: "rec:0:1",
      kind: "client-error",
      offsetMs: 4_900,
    });
    const after: ReplaySignal = makeSignal({
      id: "rec:0:2",
      kind: "client-error",
      offsetMs: 5_400,
    });
    const later: ReplaySignal = makeSignal({
      id: "rec:0:3",
      kind: "client-error",
      offsetMs: 5_900,
    });
    const tooLate: ReplaySignal = makeSignal({
      id: "rec:0:4",
      kind: "client-error",
      offsetMs: 8_000,
    });

    expect(
      findErrorAfterInteraction([later, tooLate, before, after], click)?.id,
    ).toBe("rec:0:2");
    expect(findErrorAfterInteraction([before, tooLate], click)).toBeNull();
  });
});

describe("formatters", () => {
  it("formats bytes and durations for row meta", () => {
    expect(formatSignalBytes(830)).toBe("830B");
    expect(formatSignalBytes(1229)).toBe("1.2KB");
    expect(formatSignalBytes(3.4 * 1024 * 1024)).toBe("3.4MB");
    expect(formatSignalBytes(-1)).toBe("");
    expect(formatSignalDuration(220)).toBe("220ms");
    expect(formatSignalDuration(1234)).toBe("1.2s");
    expect(formatSignalDuration(125_000)).toBe("2m 5s");
    expect(formatSignalDuration(Number.NaN)).toBe("");
  });

  it("splits absolute urls and leaves relative ones whole", () => {
    expect(splitSignalUrl("https://a.com/p?q=1#h")).toEqual({
      origin: "https://a.com",
      path: "/p?q=1#h",
    });
    expect(splitSignalUrl("/relative/path")).toEqual({
      origin: "",
      path: "/relative/path",
    });
  });
});
