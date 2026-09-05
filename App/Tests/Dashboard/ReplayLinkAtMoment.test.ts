import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Inbound links into a moment of a recording (final-design "Correlation",
 * INBOUND -> REPLAY 1-4). Every surface - the exception occurrence row, the
 * exception card, a log line, a span - carries the wall-clock moment as
 * ?at=, the row as &signal=, the rail tab as &rail=, and builds the URL
 * through ONE builder so the pre-roll and the clamp are identical
 * everywhere. Half of this file pins ReplayLink's URL grammar through its
 * pure route function; the other half is source-level, asserting that no
 * surface builds the player URL by hand any more.
 *
 * ReplayLink pulls in RouteMap, which pulls in Common/UI/Config, which reads
 * `window` on load - so the module is imported after a browser stub exists
 * (same approach as ReplayPlayerUrlState.test.ts).
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const AT_UNIX_MS: number = 1_757_000_030_000;

type ReplayLinkModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayLink");
type UrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState");
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];

let replayLink: ReplayLinkModule;
let urlState: UrlStateModule;

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

function searchParamsOf(route: { toString(): string } | null): URLSearchParams {
  expect(route).not.toBeNull();

  return new URL(`https://example.com${route!.toString()}`).searchParams;
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // never asserted on
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  replayLink = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayLink"
  );
  urlState = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState"
  );

  const Navigation: NavigationClass = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

describe("ReplayLink route (buildReplayLinkRoute)", () => {
  test("atTime becomes ?at=<unixMs minus the row pre-roll> with signal and rail", () => {
    const params: URLSearchParams = searchParamsOf(
      replayLink.buildReplayLinkRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        atTime: new Date(AT_UNIX_MS),
        signal: "log:0193c0de-4444-4aaa-8bbb-000000000004",
        rail: "logs",
      }),
    );

    expect(params.get("at")).toBe(
      String(AT_UNIX_MS - urlState.REPLAY_MOMENT_PRE_ROLL_MS),
    );
    expect(params.get("signal")).toBe(
      "log:0193c0de-4444-4aaa-8bbb-000000000004",
    );
    expect(params.get("rail")).toBe("logs");
    expect(params.get("t")).toBeNull();
  });

  test("an exc: signal applies the ten-second exception pre-roll on its own", () => {
    const params: URLSearchParams = searchParamsOf(
      replayLink.buildReplayLinkRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        atTime: new Date(AT_UNIX_MS),
        signal: "exc:0193c0de-5555-4aaa-8bbb-000000000005",
        rail: "errors",
      }),
    );

    expect(params.get("at")).toBe(
      String(AT_UNIX_MS - urlState.REPLAY_EXCEPTION_PRE_ROLL_MS),
    );
    expect(params.get("rail")).toBe("errors");
  });

  test("atOffsetMs becomes ?t= in whole seconds, pre-roll applied and clamped at 0", () => {
    expect(
      searchParamsOf(
        replayLink.buildReplayLinkRoute({
          rumApplicationId: APP_ID,
          sessionId: SESSION_ID,
          atOffsetMs: 41_500,
        }),
      ).get("t"),
    ).toBe(
      String(Math.floor((41_500 - urlState.REPLAY_MOMENT_PRE_ROLL_MS) / 1000)),
    );

    expect(
      searchParamsOf(
        replayLink.buildReplayLinkRoute({
          rumApplicationId: APP_ID,
          sessionId: SESSION_ID,
          atOffsetMs: 200,
        }),
      ).get("t"),
    ).toBe("0");
  });

  test("atTime wins over atOffsetMs when both are given", () => {
    const params: URLSearchParams = searchParamsOf(
      replayLink.buildReplayLinkRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        atTime: new Date(AT_UNIX_MS),
        atOffsetMs: 41_500,
      }),
    );

    expect(params.get("at")).not.toBeNull();
    expect(params.get("t")).toBeNull();
  });

  test("the route is the player page for the session, and carries nothing without a moment", () => {
    const route: ReturnType<typeof replayLink.buildReplayLinkRoute> =
      replayLink.buildReplayLinkRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
      });

    expect(route).not.toBeNull();
    expect(route!.toString()).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`,
    );
  });

  test("renders nothing (null route) without both ids", () => {
    expect(
      replayLink.buildReplayLinkRoute({ sessionId: SESSION_ID }),
    ).toBeNull();
    expect(
      replayLink.buildReplayLinkRoute({ rumApplicationId: APP_ID }),
    ).toBeNull();
    expect(
      replayLink.buildReplayLinkRoute({
        rumApplicationId: APP_ID,
        sessionId: "",
      }),
    ).toBeNull();
  });
});

describe("every inbound surface builds its player URL through the shared builder", () => {
  test("ReplayLink delegates to buildReplayMomentRoute and no longer populates the route by hand", () => {
    const source: string = readSource(
      "Components/SessionReplay/ReplayLink.tsx",
    );

    expect(source).toContain("buildReplayMomentRoute(");
    expect(source).not.toContain("RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW");
    expect(source).not.toMatch(/addQueryParams\(\s*\{\s*t:/);
  });

  test("ReplayCard links at=occurredAt through the builder with an exc: signal and the errors rail", () => {
    const source: string = readSource(
      "Components/SessionReplay/ReplayCard.tsx",
    );

    expect(source).toContain("buildReplayMomentRoute(");
    expect(source).toContain("makeExceptionSignalId(");
    expect(source).toContain('rail: "errors"');
    expect(source).toContain("getReplayCardMoment(");
    /* The audit's wrong pairing: no more start-time arithmetic in the card. */
    expect(source).not.toContain("PRE_ROLL_SECONDS");
    expect(source).not.toContain("RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW");
    /* correlation-8 and -15: the other sessions and the failure kinds render. */
    expect(source).toContain("isApplicationScopeTruncated");
    expect(source).toContain("classifyReplayCardFailure");
  });

  test("the exception explorer hands the card the occurrence's session and instance id", () => {
    const source: string = readSource(
      "Components/Exceptions/ExceptionExplorer.tsx",
    );
    const cardBlock: string = source.slice(
      source.indexOf("<ReplayCard"),
      source.indexOf("/>", source.indexOf("<ReplayCard")),
    );

    expect(cardBlock).toContain("sessionId: latestInstance.sessionId");
    expect(cardBlock).toContain("exceptionInstanceId: latestInstance.id");
  });

  test("the occurrence table links with atTime, an exc: signal and the errors rail through the shared lookup", () => {
    const source: string = readSource(
      "Components/Exceptions/OccuranceTable.tsx",
    );

    expect(source).toContain("lookupRumSessionsBySessionIds(");
    expect(source).toContain("atTime: occurredAt");
    expect(source).toContain("makeExceptionSignalId(instanceId)");
    expect(source).toContain('rail="errors"');
    expect(source).not.toContain("getReplayAnchorOffsetMs");
    expect(source).not.toContain("atOffsetMs");
  });

  test("the logs viewer's getSessionRoute passes the log's time and id (correlation-4)", () => {
    const source: string = readSource("Components/Logs/LogsViewer.tsx");
    const start: number = source.indexOf("const getSessionRoute");
    const block: string = source.slice(
      start,
      source.indexOf("[],\n  );", start),
    );

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("resolveReplayMomentRouteForSession(");
    expect(block).toContain("at: logTime");
    expect(block).toContain("makeLogSignalId(logId)");
    expect(block).toContain('rail: "logs"');
    /* The private RumSession cache moved into Utils/RumSessionLookup. */
    expect(source).not.toContain("sessionRumApplicationIdCacheRef");
    expect(source).not.toContain("buildSessionReplayRoute(");
    expect(source).not.toContain("extractRumApplicationIdFromRumSessions(");
  });

  test("the span panel offers 'Watch session at this span' through the shared lookup (correlation-5)", () => {
    const source: string = readSource("Components/Traces/SpanDetailsPanel.tsx");

    expect(source).toContain("resolveReplayMomentRouteForSession(");
    expect(source).toContain("makeSpanSignalId(spanIdStr)");
    expect(source).toContain('rail: "traces"');
    expect(source).toContain("Watch session at this span");
    expect(source).toContain('data-testid="span-replay-link"');
    /* The session id is fetched with the full span; the list row is light. */
    expect(source).toMatch(/sessionId:\s*true/);
    expect(source).not.toContain("RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW");
  });

  test("RumSessionLookup itself builds through buildReplayMomentRoute, not by hand", () => {
    const source: string = readSource("Utils/RumSessionLookup.ts");

    expect(source).toContain("buildReplayMomentRoute(");
    expect(source).not.toContain("RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW");
    expect(source).not.toContain("populateRouteParams");
  });
});
