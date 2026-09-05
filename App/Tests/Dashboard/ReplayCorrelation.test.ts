import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Route from "Common/Types/API/Route";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Dictionary from "Common/Types/Dictionary";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  REPLAY_LOGS_MOMENT_HALF_WINDOW_MS,
  REPLAY_PANEL_DEFAULT_WIDTH_CLASS,
  REPLAY_PANEL_WIDE_WIDTH_CLASS,
  REPLAY_SESSION_WINDOW_PADDING_MS,
  ReplayFingerprintLink,
  buildReplayFingerprintLinks,
  buildReplayLogsAtMomentQueryParams,
  buildReplayLogsAtMomentRoute,
  buildReplaySessionExceptionsQuery,
  buildReplaySessionLogsQuery,
  buildReplaySessionSpansQuery,
  formatReplayClockSkew,
  formatReplayMilliseconds,
  getReplayConsentStateLabel,
  getReplayMomentWindow,
  getReplayPanelWidthClassName,
  getReplayTriggerReasonLabel,
  getReplaySessionWindow,
} from "../../FeatureSet/Dashboard/src/Utils/ReplayCorrelation";

/*
 * The pure logic behind the session replay correlation panel's Logs / Errors
 * tabs and its exception-fingerprint deep links: bounding the tabs to the
 * session's (padded) recording window, compiling the queries the embedded
 * viewers run, mapping fingerprints to exceptions-list routes, and the
 * per-tab panel width gate. Each helper is exercised on its happy path, its
 * absent/empty inputs, and the malformed manifest data a network payload can
 * always contain.
 */

const SESSION_START: string = "2026-08-14T10:00:00.000Z";
const SESSION_END: string = "2026-08-14T10:12:30.000Z";
const NOW: Date = new Date("2026-08-14T10:20:00.000Z");

describe("getReplaySessionWindow", () => {
  test("pads a closed session's bounds by the shared padding on each side", () => {
    const window: InBetween<Date> | null = getReplaySessionWindow({
      startTime: SESSION_START,
      endTime: SESSION_END,
      now: NOW,
    });

    expect(window).toBeInstanceOf(InBetween);
    expect(window!.startValue.getTime()).toBe(
      new Date(SESSION_START).getTime() - REPLAY_SESSION_WINDOW_PADDING_MS,
    );
    expect(window!.endValue.getTime()).toBe(
      new Date(SESSION_END).getTime() + REPLAY_SESSION_WINDOW_PADDING_MS,
    );
  });

  test("the padding is the trace explorer's five minutes", () => {
    expect(REPLAY_SESSION_WINDOW_PADDING_MS).toBe(5 * 60 * 1000);
  });

  test("a missing end (still-open session) runs the window to the provided now", () => {
    for (const endTime of ["", "   ", "not-a-date"]) {
      const window: InBetween<Date> | null = getReplaySessionWindow({
        startTime: SESSION_START,
        endTime: endTime,
        now: NOW,
      });

      expect(window).not.toBeNull();
      expect(window!.endValue.getTime()).toBe(
        NOW.getTime() + REPLAY_SESSION_WINDOW_PADDING_MS,
      );
    }
  });

  test("a missing end without an explicit now falls back to the wall clock", () => {
    const before: number = Date.now();

    const window: InBetween<Date> | null = getReplaySessionWindow({
      startTime: SESSION_START,
      endTime: "",
    });

    const after: number = Date.now();

    expect(window).not.toBeNull();

    const impliedEnd: number =
      window!.endValue.getTime() - REPLAY_SESSION_WINDOW_PADDING_MS;

    expect(impliedEnd).toBeGreaterThanOrEqual(before);
    expect(impliedEnd).toBeLessThanOrEqual(after);
  });

  test("a missing or unparseable start yields no window at all", () => {
    for (const startTime of ["", "   ", "not-a-date"]) {
      expect(
        getReplaySessionWindow({
          startTime: startTime,
          endTime: SESSION_END,
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("an end before the start is clamped so the window never inverts", () => {
    const window: InBetween<Date> | null = getReplaySessionWindow({
      startTime: SESSION_START,
      endTime: "2026-08-14T09:00:00.000Z",
      now: NOW,
    });

    expect(window).not.toBeNull();
    expect(window!.startValue.getTime()).toBe(
      new Date(SESSION_START).getTime() - REPLAY_SESSION_WINDOW_PADDING_MS,
    );
    expect(window!.endValue.getTime()).toBe(
      new Date(SESSION_START).getTime() + REPLAY_SESSION_WINDOW_PADDING_MS,
    );
    expect(window!.startValue.getTime()).toBeLessThanOrEqual(
      window!.endValue.getTime(),
    );
  });
});

describe("buildReplaySessionLogsQuery", () => {
  test("carries the window as the `time` filter the viewer pins its picker from", () => {
    const window: InBetween<Date> = new InBetween<Date>(
      new Date(SESSION_START),
      new Date(SESSION_END),
    );

    const query: Query<Log> = buildReplaySessionLogsQuery(window);

    expect((query as Record<string, unknown>)["time"]).toBe(window);
    expect(Object.keys(query)).toEqual(["time"]);
  });

  test("no window means an empty query, not a fabricated one", () => {
    expect(Object.keys(buildReplaySessionLogsQuery(null))).toEqual([]);
  });
});

describe("buildReplaySessionExceptionsQuery", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date(SESSION_START),
    new Date(SESSION_END),
  );

  test("filters by session id equality within the window", () => {
    const query: Query<ExceptionInstance> | null =
      buildReplaySessionExceptionsQuery({
        sessionId: "session-1",
        window: window,
      });

    expect(query).not.toBeNull();
    expect((query as Record<string, unknown>)["sessionId"]).toBe("session-1");
    expect((query as Record<string, unknown>)["time"]).toBe(window);
  });

  test("trims the session id", () => {
    const query: Query<ExceptionInstance> | null =
      buildReplaySessionExceptionsQuery({
        sessionId: "  session-1  ",
        window: null,
      });

    expect((query as Record<string, unknown>)["sessionId"]).toBe("session-1");
  });

  test("omits the time filter when there is no window", () => {
    const query: Query<ExceptionInstance> | null =
      buildReplaySessionExceptionsQuery({
        sessionId: "session-1",
        window: null,
      });

    expect(Object.keys(query as Record<string, unknown>)).toEqual([
      "sessionId",
    ]);
  });

  test("a blank session id yields null rather than an unscoped query", () => {
    for (const sessionId of ["", "   "]) {
      expect(
        buildReplaySessionExceptionsQuery({
          sessionId: sessionId,
          window: window,
        }),
      ).toBeNull();
    }
  });
});

describe("buildReplayFingerprintLinks", () => {
  function listRoute(): Route {
    return new Route("/dashboard/project-1/exceptions/unresolved");
  }

  test("links each fingerprint to its group with a pre-encoded exact search", () => {
    const links: Array<ReplayFingerprintLink> = buildReplayFingerprintLinks(
      ["abc123"],
      listRoute(),
    );

    expect(links).toHaveLength(1);
    expect(links[0]!.fingerprint).toBe("abc123");
    expect(links[0]!.route).not.toBeNull();

    const routeString: string = links[0]!.route!.toString();

    expect(
      routeString.startsWith("/dashboard/project-1/exceptions/unresolved?"),
    ).toBe(true);
    /*
     * Encoded exactly once here — the exceptions viewer
     * decodeURIComponent()s the param a second time after URLSearchParams.
     */
    expect(routeString).toContain(
      `search=${encodeURIComponent("@fingerprint:abc123")}`,
    );
    expect(routeString).toContain("search=%40fingerprint%3Aabc123");
    // Resolved / long-quiet groups must not be filtered out on arrival.
    expect(routeString).toContain("status=all");
    expect(routeString).toContain(
      `range=${encodeURIComponent("Past 3 Months")}`,
    );
  });

  test("fingerprints with URL-hostile characters survive the encoding", () => {
    const links: Array<ReplayFingerprintLink> = buildReplayFingerprintLinks(
      ["fp:one/two"],
      listRoute(),
    );

    expect(links[0]!.route!.toString()).toContain(
      `search=${encodeURIComponent("@fingerprint:fp:one/two")}`,
    );
  });

  test("trims entries, drops blanks, and dedupes in first-appearance order", () => {
    const links: Array<ReplayFingerprintLink> = buildReplayFingerprintLinks(
      ["  b  ", "", "a", "   ", "b", "a"],
      listRoute(),
    );

    expect(
      links.map((link: ReplayFingerprintLink): string => {
        return link.fingerprint;
      }),
    ).toEqual(["b", "a"]);

    for (const link of links) {
      expect(link.route).not.toBeNull();
    }
  });

  test("returns an empty list for empty, null, and undefined input", () => {
    expect(buildReplayFingerprintLinks([], listRoute())).toEqual([]);
    expect(buildReplayFingerprintLinks(null, listRoute())).toEqual([]);
    expect(buildReplayFingerprintLinks(undefined, listRoute())).toEqual([]);
  });

  test("never mutates the exceptions list route it is handed", () => {
    const route: Route = listRoute();

    buildReplayFingerprintLinks(["one", "two", "three"], route);

    expect(route.toString()).toBe("/dashboard/project-1/exceptions/unresolved");
  });
});

describe("getReplayPanelWidthClassName", () => {
  test("the data tabs get the wide panel", () => {
    expect(getReplayPanelWidthClassName("logs")).toBe(
      REPLAY_PANEL_WIDE_WIDTH_CLASS,
    );
    expect(getReplayPanelWidthClassName("errors")).toBe(
      REPLAY_PANEL_WIDE_WIDTH_CLASS,
    );
  });

  test("every other tab keeps the TelemetryDetailPanel default width", () => {
    for (const tabId of [
      "session",
      "provenance",
      "correlation",
      "fidelity",
      "",
      "unknown",
    ]) {
      expect(getReplayPanelWidthClassName(tabId)).toBe(
        REPLAY_PANEL_DEFAULT_WIDTH_CLASS,
      );
    }

    expect(REPLAY_PANEL_DEFAULT_WIDTH_CLASS).toBe("w-[38rem]");
    expect(REPLAY_PANEL_WIDE_WIDTH_CLASS).not.toBe(
      REPLAY_PANEL_DEFAULT_WIDTH_CLASS,
    );
  });
});

describe("empty session", () => {
  test("a session with no bounds, traces, or fingerprints produces clean empties", () => {
    expect(
      getReplaySessionWindow({ startTime: "", endTime: "", now: NOW }),
    ).toBeNull();
    expect(Object.keys(buildReplaySessionLogsQuery(null))).toEqual([]);
    expect(
      buildReplayFingerprintLinks(
        [],
        new Route("/dashboard/project-1/exceptions/unresolved"),
      ),
    ).toEqual([]);

    const exceptionsQuery: Query<ExceptionInstance> | null =
      buildReplaySessionExceptionsQuery({
        sessionId: "session-1",
        window: null,
      });

    expect(exceptionsQuery).not.toBeNull();
    expect(Object.keys(exceptionsQuery as Record<string, unknown>)).toEqual([
      "sessionId",
    ]);
  });
});

describe("buildReplaySessionSpansQuery", () => {
  const window: InBetween<Date> = getReplaySessionWindow({
    startTime: SESSION_START,
    endTime: SESSION_END,
  })!;

  test("filters spans by session id equality, windowed on startTime", () => {
    const query: Query<Span> | null = buildReplaySessionSpansQuery({
      sessionId: "session-1",
      window: window,
    });

    expect(query).not.toBeNull();
    expect((query as Record<string, unknown>)["sessionId"]).toBe("session-1");
    expect((query as Record<string, unknown>)["startTime"]).toBe(window);
    expect(Object.keys(query as Record<string, unknown>).sort()).toEqual([
      "sessionId",
      "startTime",
    ]);
  });

  test("trims the session id and omits the window when there is none", () => {
    const query: Query<Span> | null = buildReplaySessionSpansQuery({
      sessionId: "  session-1  ",
      window: null,
    });

    expect((query as Record<string, unknown>)["sessionId"]).toBe("session-1");
    expect(Object.keys(query as Record<string, unknown>)).toEqual([
      "sessionId",
    ]);
  });

  test("a blank session id yields null rather than an unscoped query", () => {
    expect(buildReplaySessionSpansQuery({ sessionId: "", window })).toBeNull();
    expect(
      buildReplaySessionSpansQuery({ sessionId: "   ", window }),
    ).toBeNull();
  });
});

describe("getReplayMomentWindow", () => {
  const MOMENT: number = new Date("2026-08-14T10:05:00.000Z").getTime();

  test("is +-30s around the moment by default", () => {
    const window: InBetween<Date> | null = getReplayMomentWindow({
      momentUnixMs: MOMENT,
    });

    expect(REPLAY_LOGS_MOMENT_HALF_WINDOW_MS).toBe(30 * 1000);
    expect(window!.startValue.getTime()).toBe(MOMENT - 30 * 1000);
    expect(window!.endValue.getTime()).toBe(MOMENT + 30 * 1000);
  });

  test("honours a custom half-window and ignores a negative one", () => {
    expect(
      getReplayMomentWindow({
        momentUnixMs: MOMENT,
        halfWindowMs: 5000,
      })!.startValue.getTime(),
    ).toBe(MOMENT - 5000);
    expect(
      getReplayMomentWindow({
        momentUnixMs: MOMENT,
        halfWindowMs: -1,
      })!.startValue.getTime(),
    ).toBe(MOMENT - REPLAY_LOGS_MOMENT_HALF_WINDOW_MS);
  });

  test("a moment that is not a positive finite timestamp yields no window", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(getReplayMomentWindow({ momentUnixMs: bad })).toBeNull();
    }
  });
});

describe("buildReplayLogsAtMomentQueryParams / Route", () => {
  const MOMENT: number = new Date("2026-08-14T10:05:00.000Z").getTime();
  const LOGS_ROUTE: Route = new Route("/dashboard/project-1/logs");

  test("emits the logs explorer's own grammar: a sessionId filter tuple and a pinned custom window", () => {
    const params: Dictionary<string> | null =
      buildReplayLogsAtMomentQueryParams({
        sessionId: "session-1",
        momentUnixMs: MOMENT,
      });

    expect(params).not.toBeNull();
    expect(JSON.parse(params!["filters"] as string)).toEqual([
      ["sessionId", ["session-1"]],
    ]);
    expect(params!["range"]).toBe("Custom");
    expect(new Date(params!["start"] as string).getTime()).toBe(
      MOMENT - REPLAY_LOGS_MOMENT_HALF_WINDOW_MS,
    );
    expect(new Date(params!["end"] as string).getTime()).toBe(
      MOMENT + REPLAY_LOGS_MOMENT_HALF_WINDOW_MS,
    );
  });

  test("the route carries the params encoded so the explorer decodes them back", () => {
    const route: Route | null = buildReplayLogsAtMomentRoute({
      logsExplorerRoute: LOGS_ROUTE,
      sessionId: "session-1",
      momentUnixMs: MOMENT,
    });

    expect(route).not.toBeNull();

    const url: URL = new URL(`https://example.com${route!.toString()}`);

    expect(url.pathname).toBe("/dashboard/project-1/logs");
    expect(JSON.parse(url.searchParams.get("filters") as string)).toEqual([
      ["sessionId", ["session-1"]],
    ]);
    expect(url.searchParams.get("range")).toBe("Custom");
    expect(url.searchParams.get("start")).toBe(
      new Date(MOMENT - REPLAY_LOGS_MOMENT_HALF_WINDOW_MS).toISOString(),
    );
    /* Never mutates the route it was handed. */
    expect(LOGS_ROUTE.toString()).toBe("/dashboard/project-1/logs");
  });

  test("no session id or no usable moment means no link", () => {
    expect(
      buildReplayLogsAtMomentQueryParams({
        sessionId: "",
        momentUnixMs: MOMENT,
      }),
    ).toBeNull();
    expect(
      buildReplayLogsAtMomentQueryParams({
        sessionId: "session-1",
        momentUnixMs: NaN,
      }),
    ).toBeNull();
    expect(
      buildReplayLogsAtMomentRoute({
        logsExplorerRoute: LOGS_ROUTE,
        sessionId: "session-1",
        momentUnixMs: 0,
      }),
    ).toBeNull();
  });
});

/*
 * correlation-13: sub-second skew and gaps used to round to "0s", which
 * printed "0s (server-clamped)" and listed a "0s missing" gap - copy that
 * contradicted itself. Milliseconds below a second, and the raw enum tokens
 * never reach the panel.
 */
describe("formatReplayMilliseconds", () => {
  test("milliseconds below a second, seconds below a minute, minutes beyond", () => {
    expect(formatReplayMilliseconds(0)).toBe("0 ms");
    expect(formatReplayMilliseconds(420)).toBe("420 ms");
    expect(formatReplayMilliseconds(999)).toBe("999 ms");
    expect(formatReplayMilliseconds(1000)).toBe("1s");
    expect(formatReplayMilliseconds(1500)).toBe("1.5s");
    expect(formatReplayMilliseconds(12_400)).toBe("12s");
    expect(formatReplayMilliseconds(65_000)).toBe("1m 05s");
    expect(formatReplayMilliseconds(-300)).toBe("-300 ms");
  });

  test("a non-finite value is unknown rather than NaN", () => {
    expect(formatReplayMilliseconds(NaN)).toBe("unknown");
  });
});

describe("formatReplayClockSkew", () => {
  test("a sub-second skew is shown in milliseconds with its direction", () => {
    expect(formatReplayClockSkew(300)).toBe("300 ms ahead (server-clamped)");
    expect(formatReplayClockSkew(-2500)).toBe("2.5s behind (server-clamped)");
  });

  test("zero means none measured, never '0s (server-clamped)'", () => {
    expect(formatReplayClockSkew(0)).toBe("None");
    expect(formatReplayClockSkew(NaN)).toBe("None");
  });
});

describe("enum labels", () => {
  test("every trigger reason has readable copy", () => {
    for (const reason of Object.values(SessionReplayTriggerReason)) {
      const label: string = getReplayTriggerReasonLabel(reason);

      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(reason);
      expect(label).not.toMatch(/^[a-z-]+$/);
    }
  });

  test("consent states read as sentences", () => {
    expect(getReplayConsentStateLabel("Granted")).toContain("Granted");
    expect(getReplayConsentStateLabel("NotRequired")).toContain("Not required");
    expect(getReplayConsentStateLabel("Unknown")).toContain("Unknown");
  });

  test("an unknown token is humanised, never shown raw; blank stays blank", () => {
    expect(getReplayTriggerReasonLabel("some-new-reason")).toBe(
      "Some New Reason",
    );
    expect(getReplayConsentStateLabel("some-new-state")).toBe("Some New State");
    expect(getReplayTriggerReasonLabel("")).toBe("");
    expect(getReplayConsentStateLabel("  ")).toBe("");
  });
});

/*
 * The panel component itself is renderer-bound (its rendered behaviour is
 * pinned in Common/Tests/UI/Rum/ReplayCorrelationPanel.test.tsx); its
 * integration contract is pinned at the source level here: the panel has
 * exactly the Session / Privacy / Fidelity tabs, embeds neither the logs
 * viewer nor the exceptions table (the rail owns those rows now), and the
 * fingerprints link out through the shared group-route builder.
 */
describe("replay correlation panel wiring", () => {
  const panelSource: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "SessionReplay",
        "ReplayCorrelationPanel.tsx",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

  test("has the three tabs and no embedded data surfaces", () => {
    expect(panelSource).toContain('id: "session"');
    expect(panelSource).toContain('id: "provenance"');
    expect(panelSource).toContain('id: "fidelity"');
    expect(panelSource).not.toContain('id: "logs"');
    expect(panelSource).not.toContain('id: "errors"');
    expect(panelSource).not.toContain('id: "correlation"');
    expect(panelSource).not.toContain("DashboardLogsViewer");
    expect(panelSource).not.toContain("ExceptionInstanceTable");
    // Embedded viewer opt-ins must never come back here.
    expect(panelSource).not.toContain("syncUrlState");
  });

  test("fingerprints link out through the shared exceptions group route", () => {
    expect(panelSource).toContain("buildReplayFingerprintLinks(");
    expect(panelSource).toContain("PageMap.EXCEPTIONS_UNRESOLVED");
    expect(panelSource).toContain("to={link.route}");
  });

  test("the sub-second formatters and enum labels are what the panel renders", () => {
    expect(panelSource).toContain("formatReplayClockSkew(d.clockSkewMs)");
    expect(panelSource).toContain("formatReplayMilliseconds(gap.missingMs)");
    expect(panelSource).toContain("getReplayConsentStateLabel(d.consentState)");
    expect(panelSource).toContain(
      "getReplayTriggerReasonLabel(d.triggerReason)",
    );
    expect(panelSource).not.toContain("Math.round(d.clockSkewMs / 1000)");
    expect(panelSource).not.toContain("Math.round(gap.missingMs / 1000)");
  });

  test("the panel keeps the width gate on the active tab", () => {
    expect(panelSource).toContain(
      "widthClassName={getReplayPanelWidthClassName(activeTabId)}",
    );
  });
});
