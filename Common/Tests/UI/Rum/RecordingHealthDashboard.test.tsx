import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import { diagnoseRecordingHealth } from "../../../Utils/Rum/SessionReplayHealth";

/*
 * The Replay Health page.
 *
 * The hero carries the diagnosis for every state (title, detail, the one
 * action, and the state word the E2E suites read); the pipeline colours each
 * stage; refusals and drops are ranked with human words; budgets draw a bar
 * only when a ceiling exists; the policy and recorder panels never leak a
 * raw enum or a blank; the paste box sits in its own panel; and a counter the
 * server could not read says "unknown", never 0.
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
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

/* Imported after the mocks are registered so the components see them. */
import RecordingHealthDashboard, {
  RecordingHealthDashboardView,
  describeRecorderCapabilities,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard";
import {
  SessionReplayHealthSnapshot,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

/*
 * The connected tests go through the hook, which diagnoses against the REAL
 * clock, so their wire timestamps come from it too (see the same helper in
 * RecordingHealthCard.test.tsx for the failure a frozen date caused).
 */
function isoFromRealNow(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  return {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "NotRequired",
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: iso(12 * 1000),
    lastChunkReceivedAt: iso(12 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

function withPolicy(
  policy: Partial<RecordingHealthStatus["policy"]>,
): RecordingHealthStatus {
  const status: RecordingHealthStatus = makeStatus();

  return { ...status, policy: { ...status.policy, ...policy } };
}

function makeSnapshot(
  status: RecordingHealthStatus | null,
  overrides?: Partial<SessionReplayHealthSnapshot>,
): SessionReplayHealthSnapshot {
  return {
    status: status,
    diagnosis: diagnoseRecordingHealth(status, NOW),
    extras: { dropsLast24h: [], recorderCapabilities: null },
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: isoFromRealNow(12 * 1000),
    budgetExceededAt: null,
    projectBytesUsedToday: 1024,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: isoFromRealNow(12 * 1000),
    lastSessionStartedAt: isoFromRealNow(60 * 1000),
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    dropsLast24h: [],
    recorderCapabilities: ["click-events", "web-vitals"],
    ...overrides,
  };
}

function renderView(
  snapshot: SessionReplayHealthSnapshot,
  props?: Partial<React.ComponentProps<typeof RecordingHealthDashboardView>>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RecordingHealthDashboardView
        rumApplicationId={APP_ID}
        health={snapshot}
        {...props}
      />
    </MemoryRouter>,
  );
}

function level(): string {
  return screen.getByTestId("health-level").textContent ?? "";
}

beforeEach(() => {
  postMock.mockReset();
  clearSessionReplayHealthStore();
});

describe("RecordingHealthDashboardView hero, per diagnosis state", () => {
  it("healthy: the quantified detail, the application, a live marker and no action", () => {
    renderView(makeSnapshot(makeStatus()));

    const hero: HTMLElement = screen.getByTestId("health-hero");

    expect(hero).toHaveAttribute("data-state", "healthy");
    expect(screen.getByTestId("health-page")).toHaveAttribute(
      "data-state",
      "healthy",
    );
    expect(level()).toBe("healthy");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "Recording healthy",
    );
    expect(screen.getByTestId("health-detail")).toHaveTextContent(
      "Last chunk 12s ago - 143 sessions in 24h (120 playable) - sampling 100%.",
    );
    expect(hero).toHaveTextContent("acme-web");
    expect(screen.queryByTestId("health-action")).toBeNull();
  });

  it("never-loaded: names the cause and links the setup guide on the documentation page", () => {
    renderView(
      makeSnapshot(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      ),
    );

    expect(level()).toBe("never-loaded");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "The recorder has never loaded for acme-web",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Open the setup guide",
    );
    expect(screen.getByTestId("health-action").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`/rum/${APP_ID}/session-replay-documentation`),
    );
  });

  it("disabled-project: the action goes to the project-wide switch", () => {
    renderView(makeSnapshot(withPolicy({ isProjectEnabled: false })));

    expect(level()).toBe("disabled-project");
    expect(screen.getByTestId("health-action")).toHaveTextContent("Turn it on");
    expect(screen.getByTestId("health-action").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/rum/settings/session-replay"),
    );
  });

  it("disabled-app: the action goes to this application's Replay Policy page", () => {
    renderView(makeSnapshot(withPolicy({ isApplicationEnabled: false })));

    expect(level()).toBe("disabled-app");
    expect(screen.getByTestId("health-action").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`/rum/${APP_ID}/session-replay-settings`),
    );
  });

  it("refusing: quantifies the top reason in human words, never the bare code", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          refusalsLast24h: [
            { reason: "origin-not-allowed", count: 212 },
            { reason: "rate-limited", count: 3 },
          ],
        }),
      ),
    );

    expect(level()).toBe("refusing");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "212 uploads refused in 24h: origin not allowed",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Edit allowed origins",
    );
  });

  it("budget-paused: says uploads are paused and offers the budget", () => {
    renderView(
      makeSnapshot(
        makeStatus({ projectBytesUsedToday: GB, dailyByteLimit: GB }),
      ),
    );

    expect(level()).toBe("budget-paused");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "Uploads paused for today",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Review the budget",
    );
  });

  it("loaded-never-uploaded under consent: the docs action opens in a new tab", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          lastChunkReceivedAt: null,
          policy: {
            ...makeStatus().policy,
            consentMode: "RequireExplicit",
          },
        }),
      ),
    );

    expect(level()).toBe("loaded-never-uploaded");
    expect(screen.getByTestId("health-detail")).toHaveTextContent(
      "Waiting for consent",
    );

    const anchor: HTMLElement | null = screen
      .getByTestId("health-action")
      .closest("a");

    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute(
      "href",
      expect.stringContaining("/telemetry/session-replay#privacy"),
    );
  });

  it("stale: no chunk while the recorder keeps loading", () => {
    renderView(
      makeSnapshot(
        makeStatus({ lastChunkReceivedAt: iso(7 * 60 * 60 * 1000) }),
      ),
    );

    expect(level()).toBe("stale");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "No chunk for 7h while the recorder keeps loading",
    );
  });
});

describe("RecordingHealthDashboardView hero, load and refresh states", () => {
  it("loading: says so, draws a skeleton and hides every panel that needs a status", () => {
    renderView(
      makeSnapshot(null, {
        isLoading: true,
        fetchedAtUnixMs: null,
      }),
    );

    expect(level()).toBe("loading");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "Checking recording health",
    );
    expect(screen.getByTestId("health-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("health-pipeline")).toBeNull();
    expect(screen.queryByTestId("health-policy")).toBeNull();
    expect(screen.queryByTestId("health-browser-diagnostics")).toBeNull();
    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      "Not read yet",
    );
  });

  it("no status and a permission error: names the permission and quotes the server once", () => {
    renderView(
      makeSnapshot(null, {
        error: { kind: "permission", message: "Forbidden" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(level()).toBe("error");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "You cannot see recording health",
    );
    expect(screen.getByTestId("health-error-message")).toHaveTextContent(
      "Server said: Forbidden",
    );
    expect(screen.queryByTestId("health-pipeline")).toBeNull();
    expect(screen.queryByTestId("health-action")).toBeNull();
    /* The browser's half still works without the server's. */
    expect(
      screen.getByTestId("health-browser-diagnostics"),
    ).toBeInTheDocument();
  });

  it("no status and a plan error: the plan copy, not 'Please upgrade your plan' bare", () => {
    renderView(
      makeSnapshot(null, {
        error: { kind: "plan", message: "Please upgrade your plan" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "Recording health is not included in this project's plan",
    );
  });

  it("a failed refresh keeps the last status on screen and says when it was read", () => {
    renderView(
      makeSnapshot(makeStatus(), {
        error: { kind: "other", message: "boom" },
        fetchedAtUnixMs: NOW - 3 * 60 * 1000,
      }),
    );

    expect(level()).toBe("healthy");
    expect(screen.getByTestId("health-pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("health-stale")).toHaveTextContent(
      "showing the status read 3m ago",
    );
  });

  it("no stale note when the last refresh succeeded", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(screen.queryByTestId("health-stale")).toBeNull();
  });

  it("says how long ago it was read against the wall clock, and how often it refreshes", () => {
    renderView(makeSnapshot(makeStatus()), {
      clockUnixMs: NOW + 45 * 1000,
      pollIntervalMs: 60 * 1000,
    });

    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      "Updated 45s ago",
    );
    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      "refreshes every minute",
    );
  });

  it("a wall clock behind the read time never claims a negative age", () => {
    renderView(makeSnapshot(makeStatus()), { clockUnixMs: NOW - 60 * 1000 });

    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      "Updated just now",
    );
  });

  it("the refresh button calls onRefresh, and is disabled while a request is in flight", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    const { unmount } = renderView(makeSnapshot(makeStatus()), {
      onRefresh: onRefresh as unknown as () => void,
    });

    fireEvent.click(screen.getByTestId("health-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    unmount();

    renderView(makeSnapshot(makeStatus(), { isRefreshing: true }), {
      onRefresh: onRefresh as unknown as () => void,
    });

    expect(screen.getByTestId("health-refresh")).toBeDisabled();
    expect(screen.getByTestId("health-refresh")).toHaveTextContent(
      "Refreshing",
    );
  });

  it("no refresh button without a handler", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(screen.queryByTestId("health-refresh")).toBeNull();
  });
});

describe("RecordingHealthDashboardView pipeline", () => {
  it("renders the four stages in order with their values and tones", () => {
    renderView(makeSnapshot(makeStatus()));

    const items: Array<HTMLElement> = within(
      screen.getByTestId("health-pipeline"),
    ).getAllByRole("listitem");

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-testid");
      }),
    ).toEqual([
      "health-stage-recorder",
      "health-stage-policy",
      "health-stage-uploads",
      "health-stage-sessions",
    ]);
    expect(screen.getByTestId("health-stage-recorder-value")).toHaveTextContent(
      "12s ago",
    );
    expect(screen.getByTestId("health-stage-policy-value")).toHaveTextContent(
      "100% sampled",
    );
    expect(screen.getByTestId("health-stage-uploads-value")).toHaveTextContent(
      "12s ago",
    );
    expect(screen.getByTestId("health-stage-sessions-value")).toHaveTextContent(
      "143",
    );

    for (const item of items) {
      expect(item).toHaveAttribute("data-tone", "ok");
    }
  });

  it("the first failing stage is coloured and the rest read what they know", () => {
    renderView(makeSnapshot(withPolicy({ isApplicationEnabled: false })));

    expect(screen.getByTestId("health-stage-policy")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(screen.getByTestId("health-stage-policy-value")).toHaveTextContent(
      "Off",
    );
    expect(screen.getByTestId("health-stage-recorder")).toHaveAttribute(
      "data-tone",
      "ok",
    );
  });

  it("an unread session counter is 'unknown' and neutral, never 0", () => {
    renderView(
      makeSnapshot(
        makeStatus({ sessionsLast24h: null, playableSessionsLast24h: null }),
      ),
    );

    expect(screen.getByTestId("health-stage-sessions")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(screen.getByTestId("health-stage-sessions-value")).toHaveTextContent(
      "unknown",
    );
  });
});

describe("RecordingHealthDashboardView uploads panel", () => {
  it("lists refusals most frequent first with human words and the code beside them", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          refusalsLast24h: [
            { reason: "rate-limited", count: 3 },
            { reason: "origin-not-allowed", count: 20 },
          ],
        }),
      ),
    );

    const refusals: HTMLElement = screen.getByTestId("health-refusals");
    const rows: Array<HTMLElement> = within(refusals).getAllByTestId(
      "health-refusals-row",
    );

    expect(refusals).toHaveAttribute("data-kind", "list");
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-reason");
      }),
    ).toEqual(["origin-not-allowed", "rate-limited"]);
    expect(rows[0]).toHaveTextContent("Origin not allowed");
    expect(rows[0]).toHaveTextContent("origin-not-allowed");
    expect(rows[0]).toHaveTextContent("20");
    expect(screen.getByTestId("health-refusals-total")).toHaveTextContent(
      "23 total",
    );
  });

  it("drops are their own list, and an open-vocabulary reason is shown as it came", () => {
    renderView(
      makeSnapshot(makeStatus(), {
        extras: {
          dropsLast24h: [{ reason: "scrub-incomplete", count: 12 }],
          recorderCapabilities: null,
        },
      }),
    );

    const drops: HTMLElement = screen.getByTestId("health-drops");

    expect(drops).toHaveAttribute("data-kind", "list");
    expect(within(drops).getByTestId("health-drops-row")).toHaveTextContent(
      "scrub-incomplete12",
    );
    expect(screen.getByTestId("health-refusals")).toHaveAttribute(
      "data-kind",
      "none",
    );
  });

  it("nothing refused or dropped says so in words", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(screen.getByTestId("health-refusals")).toHaveTextContent(
      "No upload was refused in the last 24 hours.",
    );
    expect(screen.getByTestId("health-drops")).toHaveTextContent(
      "No accepted chunk was dropped in the last 24 hours.",
    );
  });

  it("an unreachable counter store is 'unknown', never '0 refusals'", () => {
    renderView(
      makeSnapshot(makeStatus({ refusalsLast24h: null }), {
        extras: { dropsLast24h: null, recorderCapabilities: null },
      }),
    );

    expect(screen.getByTestId("health-refusals")).toHaveAttribute(
      "data-kind",
      "unknown",
    );
    expect(screen.getByTestId("health-refusals")).toHaveTextContent(
      "Unknown: the counter store was unreachable.",
    );
    expect(screen.getByTestId("health-drops")).toHaveAttribute(
      "data-kind",
      "unknown",
    );
    expect(screen.getByTestId("health-page").textContent).not.toMatch(
      /\b0 refus/,
    );
  });
});

describe("RecordingHealthDashboardView storage panel", () => {
  it("draws a bar for each budgeted counter with human units and a percentage", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          projectBytesUsedToday: 512 * MB,
          dailyByteLimit: GB,
          applicationBytesUsedThisMonth: 512 * MB,
          monthlyBudgetInGB: 2,
        }),
      ),
    );

    const bars: Array<HTMLElement> = within(
      screen.getByTestId("health-bytes"),
    ).getAllByRole("progressbar");

    expect(bars).toHaveLength(2);
    expect(screen.getByTestId("health-meter-project-day")).toHaveTextContent(
      "512 MB of 1 GB",
    );
    expect(screen.getByTestId("health-meter-project-day")).toHaveTextContent(
      "50%",
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveTextContent(
      "512 MB of 2 GB",
    );
    expect(bars[1]).toHaveAttribute("aria-valuenow", "25");
  });

  it("colours a meter amber near its ceiling and red at it", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          projectBytesUsedToday: 900 * MB,
          dailyByteLimit: GB,
          applicationBytesUsedThisMonth: 2 * GB,
          monthlyBudgetInGB: 2,
        }),
      ),
    );

    expect(screen.getByTestId("health-meter-project-day")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveAttribute(
      "data-tone",
      "error",
    );
  });

  it("with no monthly budget says so instead of drawing an empty bar", () => {
    renderView(
      makeSnapshot(makeStatus({ applicationBytesUsedThisMonth: 3 * MB })),
    );

    expect(
      within(screen.getByTestId("health-bytes")).getAllByRole("progressbar"),
    ).toHaveLength(1);
    expect(screen.getByTestId("health-meter-app-month")).toHaveAttribute(
      "data-kind",
      "unlimited",
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveTextContent(
      "3 MB used",
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveTextContent(
      "No monthly budget is set (0 or blank means no ceiling).",
    );
  });

  it("an unreachable usage counter says so", () => {
    renderView(makeSnapshot(makeStatus({ projectBytesUsedToday: null })));

    expect(screen.getByTestId("health-meter-project-day")).toHaveTextContent(
      "Unknown: the usage counter was unreachable.",
    );
  });

  it("links to the Replay Policy page to change a budget", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(
      screen.getByTestId("health-change-budget").closest("a"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/rum/${APP_ID}/session-replay-settings`),
    );
  });
});

describe("RecordingHealthDashboardView policy panel", () => {
  it("reads the policy as the recorder receives it, in labels rather than enum values", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(screen.getByTestId("health-policy-recording")).toHaveTextContent(
      "On",
    );
    expect(screen.getByTestId("health-policy-trigger")).toHaveTextContent(
      "Always",
    );
    expect(screen.getByTestId("health-policy-sampling")).toHaveTextContent(
      "100%",
    );
    expect(screen.getByTestId("health-policy-consent")).toHaveTextContent(
      "Not required",
    );
    expect(screen.getByTestId("health-policy-masking")).toHaveTextContent(
      "Sensitive inputs masked, page text recorded",
    );
    expect(screen.getByTestId("health-policy-retention")).toHaveTextContent(
      "7 days",
    );
    expect(screen.getByTestId("health-policy-origins")).toHaveTextContent(
      "https://app.acme.com",
    );
  });

  it("names which switch is off", () => {
    const { unmount } = renderView(
      makeSnapshot(withPolicy({ isProjectEnabled: false })),
    );

    expect(screen.getByTestId("health-policy-recording")).toHaveTextContent(
      "Off for the project",
    );

    unmount();
    renderView(makeSnapshot(withPolicy({ isApplicationEnabled: false })));

    expect(screen.getByTestId("health-policy-recording")).toHaveTextContent(
      "Off for this application",
    );
  });

  it("an empty allowlist reads as 'any origin', never as a blank that looks like 'none'", () => {
    renderView(makeSnapshot(makeStatus({ allowedOrigins: [] })));

    expect(screen.getByTestId("health-policy-origins")).toHaveTextContent(
      "Any origin the ingestion key allows",
    );
  });

  it("unknown or unreported values say so instead of leaking the raw value", () => {
    renderView(
      makeSnapshot(
        withPolicy({
          captureTrigger: "Brand-new",
          consentMode: "",
          retentionInDays: null,
        }),
      ),
    );

    expect(screen.getByTestId("health-policy-trigger")).toHaveTextContent(
      "unrecognised value (Brand-new)",
    );
    expect(screen.getByTestId("health-policy-consent")).toHaveTextContent(
      "not reported",
    );
    expect(screen.getByTestId("health-policy-retention")).toHaveTextContent(
      "not reported",
    );
  });

  it("a one-day retention is singular", () => {
    renderView(makeSnapshot(withPolicy({ retentionInDays: 1 })));

    expect(screen.getByTestId("health-policy-retention")).toHaveTextContent(
      "1 day",
    );
    expect(screen.getByTestId("health-policy-retention")).not.toHaveTextContent(
      "1 days",
    );
  });

  it("links to the Replay Policy page to edit it", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(
      screen.getByTestId("health-edit-policy").closest("a"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/rum/${APP_ID}/session-replay-settings`),
    );
  });
});

describe("RecordingHealthDashboardView recorder panel", () => {
  it("shows the published artifact label and the newest session's capabilities as chips", () => {
    renderView(
      makeSnapshot(makeStatus(), {
        extras: {
          dropsLast24h: [],
          recorderCapabilities: ["click-events", "web-vitals"],
        },
      }),
    );

    expect(screen.getByTestId("health-recorder-version")).toHaveTextContent(
      "1.4.0",
    );

    const capabilities: HTMLElement = screen.getByTestId("health-capabilities");

    expect(within(capabilities).getByText("click-events")).toBeInTheDocument();
    expect(within(capabilities).getByText("web-vitals")).toBeInTheDocument();
  });

  it("an unreported recorder version says so", () => {
    renderView(makeSnapshot(makeStatus({ publishedRecorderVersion: null })));

    expect(screen.getByTestId("health-recorder-version")).toHaveTextContent(
      "not reported",
    );
    expect(screen.getByTestId("health-recorder-version")).toHaveTextContent(
      "builds no recorder artifact",
    );
  });

  it("separates 'never recorded' from 'recorded by an older artifact' (docs-and-design-fidelity-3)", () => {
    const neverRecorded: { value: Array<string> | string; hint: string } =
      describeRecorderCapabilities(
        makeStatus({ lastChunkReceivedAt: null }),
        null,
      );
    const olderArtifact: { value: Array<string> | string; hint: string } =
      describeRecorderCapabilities(makeStatus(), null);

    expect(neverRecorded.value).toBe("not reported yet");
    expect(neverRecorded.hint).toContain("No chunk has arrived");
    expect(olderArtifact.value).toBe("not reported");
    expect(olderArtifact.hint).toContain("reload fetches the latest artifact");
    expect(describeRecorderCapabilities(makeStatus(), []).value).toBe(
      "none announced",
    );
    expect(
      describeRecorderCapabilities(
        makeStatus({ publishedRecorderVersion: null }),
        null,
      ).hint,
    ).not.toContain("reload fetches the latest artifact");
  });
});

describe("RecordingHealthDashboardView browser diagnostics panel", () => {
  it("renders the paste box without repeating the panel's own heading", () => {
    renderView(makeSnapshot(makeStatus()));

    const panel: HTMLElement = screen.getByTestId("health-browser-diagnostics");

    expect(panel).toHaveTextContent("Ask the browser");
    expect(panel).not.toHaveTextContent("Ask the browser instead");
    expect(
      within(panel).getByTestId("diagnostics-paste-input"),
    ).toBeInTheDocument();
  });

  it("explains a pasted diagnostics dump in place", () => {
    renderView(makeSnapshot(makeStatus()));

    fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
      target: { value: "not json {" },
    });
    fireEvent.click(screen.getByTestId("diagnostics-explain"));

    expect(screen.getByTestId("diagnostics-error")).toHaveTextContent(
      "That is not JSON",
    );
  });
});

describe("RecordingHealthDashboard (connected)", () => {
  it("fetches /ingest-status for the application on mount and renders the whole page", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthDashboard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    expect(level()).toBe("loading");

    await waitFor(() => {
      expect(level()).toBe("healthy");
    });

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };

    expect(request.url.toString()).toContain(
      "/telemetry/rum/session-replay/ingest-status",
    );
    expect(request.data).toEqual({ rumApplicationId: APP_ID });
    expect(screen.getByTestId("health-pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("health-capabilities")).toHaveTextContent(
      "click-events",
    );
    expect(screen.getByTestId("health-updated")).toHaveTextContent("Updated");
  });

  it("Refresh reads the status again and shows the new diagnosis", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthDashboard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(level()).toBe("healthy");
    });

    postMock.mockResolvedValueOnce(
      new HTTPResponse<JSONObject>(
        200,
        wireStatus({ isApplicationEnabled: false }),
        {},
      ),
    );

    fireEvent.click(screen.getByTestId("health-refresh"));

    await waitFor(() => {
      expect(level()).toBe("disabled-app");
    });

    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("a 403 renders the permission copy with the server's words as a detail", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthDashboard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(level()).toBe("error");
    });

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      "You cannot see recording health",
    );
  });
});
