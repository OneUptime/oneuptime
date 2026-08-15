import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Route from "Common/Types/API/Route";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import {
  REPLAY_PANEL_DEFAULT_WIDTH_CLASS,
  REPLAY_PANEL_WIDE_WIDTH_CLASS,
  REPLAY_SESSION_WINDOW_PADDING_MS,
  ReplayFingerprintLink,
  buildReplayFingerprintLinks,
  buildReplaySessionExceptionsQuery,
  buildReplaySessionLogsQuery,
  getReplayPanelWidthClassName,
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

/*
 * The panel component itself is renderer-bound, so its integration contract
 * is pinned at the source level (the same pattern as
 * AIInvestigationHeaderWiring.test.ts): the Logs tab must scope by
 * sessionIds AND pin the window through logQuery, the Errors tab must keep
 * URL state off so a restored filter cannot replace the pinned window, and
 * the fingerprints must link out through the shared group-route builder.
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

  test("the logs tab rides the sessionIds prop and pins the window via logQuery", () => {
    expect(panelSource).toContain("sessionIds={[props.sessionId]}");
    expect(panelSource).toContain("logQuery={logsQuery}");
    // Embedded viewer: syncUrlState must never be opted into here.
    expect(panelSource).not.toContain("syncUrlState");
  });

  test("the errors tab pins its window and disables URL state restoration", () => {
    expect(panelSource).toContain("query={exceptionsQuery}");
    expect(panelSource).toContain("disableUrlState={true}");
  });

  test("fingerprints link out through the shared exceptions group route", () => {
    expect(panelSource).toContain("buildReplayFingerprintLinks(");
    expect(panelSource).toContain("PageMap.EXCEPTIONS_UNRESOLVED");
    expect(panelSource).toContain("to={link.route}");
  });

  test("the new tabs are gated behind the lazily-mounting detail panel", () => {
    expect(panelSource).toContain('id: "logs"');
    expect(panelSource).toContain('id: "errors"');
    expect(panelSource).toContain(
      "widthClassName={getReplayPanelWidthClassName(props.activeTabId)}",
    );
  });
});
