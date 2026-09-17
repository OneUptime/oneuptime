import { describe, expect, test } from "@jest/globals";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import { ReplayTimelineEvent } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";
import {
  REPLAY_RAIL_TAB_IDS,
  ReplayRailTabId,
  ReplaySignal,
  ReplayTelemetryClock,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  fromExceptionRow,
  fromLogRow,
  fromTimelineEvent,
  groupSpansIntoTraces,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";
import {
  REPLAY_RAIL_CHIPS,
  REPLAY_RAIL_PLAYHEAD_SCOPE_RADIUS_MS,
  ReplayRailChip,
  ReplayRailChipId,
  ReplayRailParsedQuery,
  ReplayRailScope,
  countSignalsByTab,
  getSignalSearchText,
  isSignalInScope,
  makePlayheadScope,
  matchesChip,
  matchesSignal,
  parseRailQuery,
  signalsForTab,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailFilters";

/*
 * The filter box is the fastest way from "something broke" to the row that
 * broke it, so every token the design names must narrow exactly, and an
 * unknown token must fall back to text rather than filtering to nothing.
 */

const START_UNIX_MS: number = 1_700_000_000_000;

const CLOCK: ReplayTelemetryClock = {
  startTimeUnixMs: START_UNIX_MS,
  alignment: {
    status: "unanchored",
    deltaMs: 0,
    pairCount: 0,
    uncertaintyMs: 0,
  },
  serviceNameById: { svc1: "payment-svc", svc2: "orders-svc" },
};

let ordinal: number = 0;

function recording(
  kind: ReplayTimelineEvent["kind"],
  offsetMs: number,
  fields: Partial<ReplayTimelineEvent>,
): ReplaySignal {
  ordinal++;

  return fromTimelineEvent(
    {
      id: `rec:0:${ordinal}`,
      kind: kind,
      chunkIndex: 0,
      offsetMs: offsetMs,
      ...fields,
    },
    { startTimeUnixMs: START_UNIX_MS },
  );
}

function log(
  id: string,
  atMs: number,
  body: string,
  severity: LogSeverity,
  serviceId?: string,
  traceId?: string,
): ReplaySignal {
  const row: Log = new Log();

  row.id = new ObjectID(id);
  row.time = new Date(START_UNIX_MS + atMs);
  row.body = body;
  row.severityText = severity;

  if (serviceId) {
    row.primaryEntityId = new ObjectID(serviceId);
  }

  if (traceId) {
    row.traceId = traceId;
  }

  return fromLogRow(row, CLOCK) as ReplaySignal;
}

function exception(id: string, atMs: number, message: string): ReplaySignal {
  const row: ExceptionInstance = new ExceptionInstance();

  row.id = new ObjectID(id);
  row.time = new Date(START_UNIX_MS + atMs);
  row.message = message;
  row.exceptionType = "TypeError";
  row.fingerprint = "fp";

  return fromExceptionRow(row, CLOCK) as ReplaySignal;
}

function trace(args: {
  traceId: string;
  atMs: number;
  durationMs: number;
  name: string;
  serviceId?: string;
  hasError?: boolean;
}): ReplaySignal {
  const row: Span = new Span();

  row.spanId = `${args.traceId}-root`;
  row.traceId = args.traceId;
  row.startTime = new Date(START_UNIX_MS + args.atMs);
  row.durationUnixNano = args.durationMs * 1_000_000;
  row.name = args.name;
  row.statusCode = args.hasError ? SpanStatus.Error : SpanStatus.Ok;

  if (args.serviceId) {
    row.primaryEntityId = new ObjectID(args.serviceId);
  }

  return groupSpansIntoTraces([row], CLOCK)[0] as ReplaySignal;
}

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const okRequest: ReplaySignal = recording("network", 1_000, {
  method: "GET",
  url: "https://api.example.com/api/products",
  status: 200,
  durationMs: 120,
});
const failedRequest: ReplaySignal = recording("network", 2_000, {
  method: "POST",
  url: "https://api.example.com/api/orders",
  status: 500,
  durationMs: 1_800,
  traceId: TRACE_ID,
  isError: true,
});
const notFound: ReplaySignal = recording("network", 3_000, {
  method: "GET",
  url: "https://cdn.example.com/missing.png",
  status: 404,
  durationMs: 30,
});
const aborted: ReplaySignal = recording("network", 3_500, {
  method: "GET",
  url: "https://api.example.com/api/slow",
  status: 0,
});
const redirect: ReplaySignal = recording("network", 3_600, {
  method: "GET",
  url: "https://api.example.com/old",
  status: 302,
});
const consoleError: ReplaySignal = recording("console", 4_000, {
  level: "error",
  message: "Uncaught TypeError: cannot read id",
});
const consoleWarn: ReplaySignal = recording("console", 4_100, {
  level: "warn",
  message: "deprecated API",
});
const route: ReplaySignal = recording("route", 5_000, {
  from: "/cart",
  to: "/checkout",
  routeKind: "pushState",
});
const click: ReplaySignal = recording("click", 6_000, {
  selector: "button.pay",
  text: "Pay now",
  x: 1,
  y: 1,
});
const rage: ReplaySignal = recording("frustration", 6_500, {
  frustrationKind: "rage-click",
  clickCount: 4,
});
const custom: ReplaySignal = recording("custom", 6_600, {
  name: "checkout.step",
});
const lcp: ReplaySignal = recording("performance", 7_000, {
  performanceKind: "lcp",
  durationMs: 4_800,
  budgetMs: 4_000,
  url: "https://app.example.com/checkout",
});
const goodVital: ReplaySignal = recording("performance", 7_100, {
  performanceKind: "web-vital",
  metric: "CLS",
  value: 0.01,
  rating: "good",
});
const clientError: ReplaySignal = recording("error", 8_000, {
  errorKind: "error",
  message: "cannot read id",
  source: "https://app.example.com/app.js",
});
const marker: ReplaySignal = recording("visibility", 9_000, {
  visibilityState: "hidden",
});
const errorLog: ReplaySignal = log(
  "l1",
  2_100,
  "charge failed: card_declined",
  LogSeverity.Error,
  "svc1",
  TRACE_ID,
);
const infoLog: ReplaySignal = log(
  "l2",
  2_200,
  "order created",
  LogSeverity.Information,
  "svc2",
);
const debugLog: ReplaySignal = log(
  "l3",
  2_300,
  "cache miss",
  LogSeverity.Debug,
);
const warnLog: ReplaySignal = log("l4", 2_400, "retrying", LogSeverity.Warning);
const serverError: ReplaySignal = exception("e1", 2_150, "cannot read id");
const slowTrace: ReplaySignal = trace({
  traceId: TRACE_ID,
  atMs: 2_050,
  durationMs: 1_700,
  name: "POST /checkout",
  serviceId: "svc1",
  hasError: true,
});
const fastTrace: ReplaySignal = trace({
  traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  atMs: 1_050,
  durationMs: 90,
  name: "GET /products",
  serviceId: "svc2",
});

const ALL: Array<ReplaySignal> = [
  okRequest,
  fastTrace,
  failedRequest,
  slowTrace,
  errorLog,
  serverError,
  infoLog,
  debugLog,
  warnLog,
  notFound,
  aborted,
  redirect,
  consoleError,
  consoleWarn,
  route,
  click,
  rage,
  custom,
  lcp,
  goodVital,
  clientError,
  marker,
];

function ids(signals: Array<ReplaySignal>): Array<string> {
  return signals.map((signal: ReplaySignal): string => {
    return signal.id;
  });
}

function matching(query: string): Array<string> {
  return ids(
    ALL.filter((signal: ReplaySignal): boolean => {
      return matchesSignal(signal, query);
    }),
  );
}

describe("parseRailQuery", () => {
  test("splits tokens from free text and keeps quoted phrases together", () => {
    const parsed: ReplayRailParsedQuery = parseRailQuery(
      'status:>=400 method:POST "card declined" checkout level:error',
    );

    expect(parsed.terms).toEqual(["card declined", "checkout"]);
    expect(parsed.tokens).toEqual([
      { field: "status", operator: ">=", value: 400 },
      { field: "method", value: "post" },
      { field: "level", value: "error" },
    ]);
  });

  test("parses every status form", () => {
    expect(parseRailQuery("status:5xx").tokens).toEqual([
      { field: "status", statusClass: 5 },
    ]);
    expect(parseRailQuery("status:failed").tokens).toEqual([
      { field: "status", failed: true },
    ]);
    expect(parseRailQuery("status:0").tokens).toEqual([
      { field: "status", failed: true },
    ]);
    expect(parseRailQuery("status:404").tokens).toEqual([
      { field: "status", operator: "=", value: 404 },
    ]);
    expect(parseRailQuery("status:<300").tokens).toEqual([
      { field: "status", operator: "<", value: 300 },
    ]);
  });

  test("treats unknown fields and malformed statuses as free text", () => {
    expect(parseRailQuery("error: timeout").terms).toEqual([
      "error:",
      "timeout",
    ]);
    expect(parseRailQuery("foo:bar").terms).toEqual(["foo:bar"]);
    expect(parseRailQuery("status:abc").terms).toEqual(["status:abc"]);
    expect(parseRailQuery("status:abc").tokens).toEqual([]);
  });

  test("ignores empty input and empty token values", () => {
    expect(parseRailQuery("")).toEqual({ terms: [], tokens: [] });
    expect(parseRailQuery("   ")).toEqual({ terms: [], tokens: [] });
    expect(parseRailQuery("kind:")).toEqual({ terms: ["kind:"], tokens: [] });
  });
});

describe("matchesSignal tokens", () => {
  test("status:>=400 keeps 4xx and 5xx requests and nothing without a status", () => {
    expect(matching("status:>=400")).toEqual([failedRequest.id, notFound.id]);
  });

  test("status:5xx, status:4xx, status:failed and status:<300", () => {
    expect(matching("status:5xx")).toEqual([failedRequest.id]);
    expect(matching("status:4xx")).toEqual([notFound.id]);
    expect(matching("status:failed")).toEqual([aborted.id]);
    /* A failed (status 0) request is not "under 400"; only status:failed selects it. */
    expect(matching("status:<400")).toEqual([okRequest.id, redirect.id]);
    expect(matching("status:<300")).toEqual([okRequest.id]);
    expect(matching("status:302")).toEqual([redirect.id]);
  });

  test("level:error covers console errors, log errors and error rows; level:warn both warn kinds", () => {
    expect(matching("level:error")).toEqual([
      errorLog.id,
      serverError.id,
      consoleError.id,
      clientError.id,
    ]);
    expect(matching("level:warn")).toEqual([warnLog.id, consoleWarn.id]);
    expect(matching("level:warning")).toEqual([warnLog.id, consoleWarn.id]);
    expect(matching("level:info")).toEqual([infoLog.id]);
    expect(matching("level:debug")).toEqual([debugLog.id]);
  });

  test("kind: matches the signal kind exactly", () => {
    expect(matching("kind:frustration")).toEqual([rage.id]);
    expect(matching("kind:client-error")).toEqual([clientError.id]);
    expect(matching("kind:nope")).toEqual([]);
  });

  test("trace: matches full ids and prefixes of at least 8 characters", () => {
    expect(matching(`trace:${TRACE_ID}`)).toEqual([
      failedRequest.id,
      slowTrace.id,
      errorLog.id,
    ]);
    expect(matching(`trace:${TRACE_ID.slice(0, 8)}`)).toEqual([
      failedRequest.id,
      slowTrace.id,
      errorLog.id,
    ]);
    expect(matching(`trace:${TRACE_ID.slice(0, 4)}`)).toEqual([]);
    expect(matching(`trace:${TRACE_ID.toUpperCase()}`)).toEqual([
      failedRequest.id,
      slowTrace.id,
      errorLog.id,
    ]);
  });

  test("method: and url: narrow requests", () => {
    expect(matching("method:post")).toEqual([failedRequest.id]);
    expect(matching("method:GET status:2xx")).toEqual([okRequest.id]);
    expect(matching("url:/api/orders")).toEqual([failedRequest.id]);
    expect(matching("url:example.com/api")).toEqual([
      okRequest.id,
      failedRequest.id,
      aborted.id,
    ]);
  });

  test("url: also reaches performance and navigation rows that carry a url", () => {
    expect(matching("url:/checkout")).toEqual([route.id, lcp.id]);
  });

  test("service: matches the resolved name or the raw id of telemetry rows", () => {
    expect(matching("service:payment")).toEqual([slowTrace.id, errorLog.id]);
    expect(matching("service:svc2")).toEqual([fastTrace.id, infoLog.id]);
    expect(matching("service:nothing")).toEqual([]);
  });

  test("tokens AND together with free text", () => {
    expect(matching("status:5xx orders")).toEqual([failedRequest.id]);
    expect(matching("status:5xx products")).toEqual([]);
    expect(matching("level:error card")).toEqual([errorLog.id]);
  });
});

describe("matchesSignal free text", () => {
  test("is case-insensitive and reaches titles, urls, messages, bodies and ids", () => {
    expect(matching("CARD_DECLINED")).toEqual([errorLog.id]);
    expect(matching("pay now")).toEqual([click.id]);
    expect(matching("missing.png")).toEqual([notFound.id]);
    expect(matching("cannot read id")).toEqual([
      serverError.id,
      consoleError.id,
      clientError.id,
    ]);
    expect(matching("rage")).toEqual([rage.id]);
    expect(matching("hidden")).toEqual([marker.id]);
  });

  test("an empty query matches everything and multi-word text requires every word", () => {
    expect(matching("")).toEqual(ids(ALL));
    expect(matching("   ")).toEqual(ids(ALL));
    expect(matching("checkout step")).toEqual([custom.id]);
    expect(matching("checkout zebra")).toEqual([]);
  });

  test("accepts a pre-parsed query", () => {
    const parsed: ReplayRailParsedQuery = parseRailQuery("status:5xx");

    expect(matchesSignal(failedRequest, parsed)).toBe(true);
    expect(matchesSignal(okRequest, parsed)).toBe(false);
  });

  test("search text includes the status code and links", () => {
    expect(getSignalSearchText(failedRequest)).toContain("500");
    expect(getSignalSearchText(failedRequest)).toContain(TRACE_ID);
    expect(getSignalSearchText(errorLog)).toContain("payment-svc");
  });
});

describe("chips", () => {
  test("every tab has a chip set, and each chip id is prefixed by its tab", () => {
    for (const tabId of REPLAY_RAIL_TAB_IDS) {
      const chips: ReadonlyArray<ReplayRailChip> = REPLAY_RAIL_CHIPS[tabId];

      expect(Array.isArray(chips)).toBe(true);

      for (const chip of chips) {
        expect(chip.id.startsWith(`${tabId}-`)).toBe(true);
        expect(chip.label.length).toBeGreaterThan(0);
      }
    }
  });

  const chipCases: Array<[ReplayRailChipId, Array<string>]> = [
    ["console-error", [consoleError.id]],
    ["console-warn", [consoleWarn.id]],
    ["network-2xx", [okRequest.id]],
    ["network-3xx", [redirect.id]],
    ["network-4xx", [notFound.id]],
    ["network-5xx", [failedRequest.id]],
    ["network-failed", [aborted.id]],
    ["network-slow", [failedRequest.id]],
    ["network-with-trace", [failedRequest.id]],
    ["interactions-frustration", [rage.id]],
    ["interactions-custom", [custom.id]],
    ["performance-over-budget", [lcp.id]],
    ["errors-client", [clientError.id]],
    ["errors-server", [serverError.id]],
    ["logs-error", [errorLog.id]],
    ["logs-warn", [warnLog.id]],
    ["logs-info", [infoLog.id]],
    ["logs-debug", [debugLog.id]],
    ["traces-with-errors", [slowTrace.id]],
    ["traces-slow", [slowTrace.id]],
  ];

  test.each(chipCases)(
    "chip %s selects exactly the expected rows",
    (chipId: ReplayRailChipId, expected: Array<string>) => {
      expect(
        ids(
          ALL.filter((signal: ReplaySignal): boolean => {
            return matchesChip(signal, chipId);
          }),
        ),
      ).toEqual(expected);
    },
  );

  test("good web vitals are not 'over budget'", () => {
    expect(matchesChip(goodVital, "performance-over-budget")).toBe(false);
  });
});

describe("signalsForTab", () => {
  test("routes each kind to the tabs the contract names", () => {
    const expected: Record<ReplayRailTabId, Array<string>> = {
      all: ids(ALL),
      console: [consoleError.id, consoleWarn.id],
      network: [
        okRequest.id,
        failedRequest.id,
        notFound.id,
        aborted.id,
        redirect.id,
      ],
      navigation: [route.id, marker.id],
      interactions: [click.id, rage.id, custom.id],
      performance: [lcp.id, goodVital.id],
      errors: [serverError.id, clientError.id],
      logs: [errorLog.id, infoLog.id, debugLog.id, warnLog.id],
      traces: [fastTrace.id, slowTrace.id],
    };

    for (const tabId of REPLAY_RAIL_TAB_IDS) {
      expect(ids(signalsForTab(ALL, tabId))).toEqual(expected[tabId]);
    }
  });

  test("chips OR within a tab, AND with the query, and foreign chips are ignored", () => {
    expect(
      ids(
        signalsForTab(ALL, "network", {
          chips: ["network-4xx", "network-5xx"],
        }),
      ),
    ).toEqual([failedRequest.id, notFound.id]);
    expect(
      ids(
        signalsForTab(ALL, "network", {
          chips: ["network-4xx", "network-5xx"],
          query: "method:post",
        }),
      ),
    ).toEqual([failedRequest.id]);
    /* A logs chip on the network tab must not blank the list. */
    expect(
      ids(signalsForTab(ALL, "network", { chips: ["logs-error"] })),
    ).toEqual(ids(signalsForTab(ALL, "network")));
  });

  test("scope keeps rows inside the window and traces that overlap it", () => {
    const scope: ReplayRailScope = makePlayheadScope(2_000, 100);

    expect(scope).toEqual({ fromMs: 1_900, toMs: 2_100 });
    expect(ids(signalsForTab(ALL, "all", { scope: scope }))).toEqual([
      failedRequest.id,
      slowTrace.id,
      errorLog.id,
    ]);
    /* A trace that started before the window but is still running is in. */
    expect(isSignalInScope(slowTrace, { fromMs: 3_000, toMs: 3_100 })).toBe(
      true,
    );
    expect(isSignalInScope(slowTrace, { fromMs: 4_000, toMs: 4_100 })).toBe(
      false,
    );
    expect(makePlayheadScope(1_000)).toEqual({
      fromMs: 0,
      toMs: 1_000 + REPLAY_RAIL_PLAYHEAD_SCOPE_RADIUS_MS,
    });
  });

  test("countSignalsByTab counts every tab, including the merged ones", () => {
    const counts: Record<ReplayRailTabId, number> = countSignalsByTab(ALL);

    expect(counts.all).toBe(ALL.length);
    expect(counts.errors).toBe(2);
    expect(counts.logs).toBe(4);
    expect(counts.traces).toBe(2);
    expect(counts.network).toBe(5);
    expect(countSignalsByTab([]).all).toBe(0);
  });
});
