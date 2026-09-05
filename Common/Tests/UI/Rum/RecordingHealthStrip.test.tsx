import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 * The one line above the session list.
 *
 * Every diagnosis state renders its title, detail and single action; the
 * strip can be dismissed ONLY while healthy (a hidden warning is the #3527
 * failure mode); the chevron expands it into the health card; counters the
 * server could not read say "unknown", never 0.
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
import RecordingHealthStrip, {
  HEALTH_STRIP_DISMISSED_KEY_PREFIX,
  RecordingHealthStripView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthStrip";
import {
  SessionReplayHealthSnapshot,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
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
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

function makeSnapshot(
  status: RecordingHealthStatus | null,
  overrides?: Partial<SessionReplayHealthSnapshot>,
): SessionReplayHealthSnapshot {
  return {
    status: status,
    diagnosis: diagnoseRecordingHealth(status, NOW),
    extras: { dropsLast24h: null, recorderCapabilities: null },
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

/* The wire shape, as /ingest-status answers it. */
function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: iso(12 * 1000),
    budgetExceededAt: null,
    projectBytesUsedToday: 1024,
    dailyByteLimit: 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: iso(12 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    dropsLast24h: [],
    ...overrides,
  };
}

function renderView(
  snapshot: SessionReplayHealthSnapshot,
  props?: Partial<React.ComponentProps<typeof RecordingHealthStripView>>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RecordingHealthStripView
        rumApplicationId={APP_ID}
        health={snapshot}
        isExpanded={false}
        onToggleExpanded={(): void => {
          /* controlled by the test */
        }}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  postMock.mockReset();
  clearSessionReplayHealthStore();
  sessionStorage.clear();
});

describe("RecordingHealthStripView per diagnosis state", () => {
  it("healthy: green dot, the quantified detail, a dismiss button and no action", () => {
    renderView(makeSnapshot(makeStatus()), {
      onDismiss: (): void => {
        /* present */
      },
    });

    expect(screen.getByTestId("health-strip")).toHaveAttribute(
      "data-state",
      "healthy",
    );
    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "healthy",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Recording healthy",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Last chunk 12s ago - 143 sessions in 24h (120 playable) - sampling 100%.",
    );
    expect(screen.getByTestId("health-strip-dismiss")).toBeInTheDocument();
    expect(screen.queryByTestId("health-action")).toBeNull();
  });

  it("never-loaded: names the cause, offers the setup guide and cannot be dismissed", () => {
    renderView(
      makeSnapshot(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      ),
      {
        onDismiss: (): void => {
          /* must not render */
        },
      },
    );

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "never-loaded",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "The recorder has never loaded for acme-web",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Open the setup guide",
    );
    expect(screen.getByTestId("health-action").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`/rum/${APP_ID}/session-replay`),
    );
    expect(screen.queryByTestId("health-strip-dismiss")).toBeNull();
  });

  it("disabled-project: the action goes to the project-wide switch", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          policy: {
            isProjectEnabled: false,
            isApplicationEnabled: true,
            captureTrigger: "Always",
            samplePercentage: 100,
            consentMode: "NotRequired",
            maskingMode: "MaskAllText",
            retentionInDays: 7,
          },
        }),
      ),
    );

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "disabled-project",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent("Turn it on");
    expect(screen.getByTestId("health-action").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/rum/settings/session-replay"),
    );
  });

  it("refusing: quantifies the top reason with human words, never the bare code", () => {
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

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "refusing",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "212 uploads refused in 24h: origin not allowed",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Edit allowed origins",
    );
  });

  it("loaded-never-uploaded under sampling 0%: explains from the policy (no decision beacon needed)", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          lastChunkReceivedAt: null,
          policy: {
            isProjectEnabled: true,
            isApplicationEnabled: true,
            captureTrigger: "Always",
            samplePercentage: 0,
            consentMode: "NotRequired",
            maskingMode: "MaskAllText",
            retentionInDays: 7,
          },
        }),
      ),
    );

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "loaded-never-uploaded",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "The recorder loaded 12s ago but nothing has been uploaded",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Your sample percentage is 0%",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Set sampling to 100%",
    );
  });

  it("loading: says it is checking, has no chevron and no dismiss", () => {
    renderView(makeSnapshot(null, { isLoading: true, fetchedAtUnixMs: null }), {
      onDismiss: (): void => {
        /* must not render */
      },
    });

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "loading",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Checking recording health",
    );
    expect(screen.queryByTestId("health-strip-toggle")).toBeNull();
    expect(screen.queryByTestId("health-strip-dismiss")).toBeNull();
  });

  it("permission error without a status: names the missing permission instead of the raw server string", () => {
    renderView(
      makeSnapshot(null, {
        error: { kind: "permission", message: "Not authorized" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent("error");
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "You cannot see recording health",
    );
    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Read Session Replay permission",
    );
  });
});

describe("RecordingHealthStripView expansion", () => {
  it("expands into the health card and renders unread counters as unknown, not 0", () => {
    renderView(
      makeSnapshot(
        makeStatus({
          sessionsLast24h: null,
          playableSessionsLast24h: null,
          refusalsLast24h: null,
          projectBytesUsedToday: null,
        }),
      ),
      { isExpanded: true },
    );

    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(screen.getByTestId("health-fact-sessions")).toHaveTextContent(
      "unknown",
    );
    expect(screen.getByTestId("health-fact-refusals")).toHaveTextContent(
      "unknown (the counter store was unreachable)",
    );
    expect(screen.getByTestId("health-fact-drops")).toHaveTextContent(
      "unknown (the counter store was unreachable)",
    );
    expect(screen.getByTestId("health-bytes")).toHaveTextContent(
      "unknown (the usage counter was unreachable)",
    );
    expect(screen.getByTestId("health-fact-capabilities")).toHaveTextContent(
      "unknown",
    );
    expect(screen.getByTestId("health-strip-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("the chevron calls onToggleExpanded", () => {
    const onToggle: MockFunction = getJestMockFunction();

    renderView(makeSnapshot(makeStatus()), {
      onToggleExpanded: (): void => {
        onToggle();
      },
    });

    fireEvent.click(screen.getByTestId("health-strip-toggle"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("RecordingHealthStrip (connected)", () => {
  it("fetches /ingest-status once on mount for the application and renders the diagnosis", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthStrip rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
      "loading",
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
        "healthy",
      );
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
  });

  it("dismissing a healthy strip hides it for the browser session", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    const { container } = render(
      <MemoryRouter>
        <RecordingHealthStrip rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    const dismiss: HTMLElement = await screen.findByTestId(
      "health-strip-dismiss",
    );

    fireEvent.click(dismiss);

    await waitFor(() => {
      expect(
        container.querySelector("[data-testid='health-strip']"),
      ).toBeNull();
    });
    expect(
      sessionStorage.getItem(`${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${APP_ID}`),
    ).toBe("1");
  });

  it("a stale dismissal never hides a warning: the strip comes back and the flag is cleared", async () => {
    sessionStorage.setItem(
      `${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${APP_ID}`,
      "1",
    );
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        wireStatus({ lastChunkReceivedAt: null, lastConfigFetchAt: null }),
        {},
      ),
    );

    render(
      <MemoryRouter>
        <RecordingHealthStrip rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
        "never-loaded",
      );
    });

    expect(screen.queryByTestId("health-strip-dismiss")).toBeNull();
    await waitFor(() => {
      expect(
        sessionStorage.getItem(`${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${APP_ID}`),
      ).toBeNull();
    });
  });

  it("a 402 renders the plan copy, not 'Please upgrade your plan' bare", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(402, { message: "Please upgrade your plan" }, {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthStrip rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-strip-level")).toHaveTextContent(
        "error",
      );
    });

    expect(screen.getByTestId("health-strip")).toHaveTextContent(
      "Recording health is not included in this project's plan",
    );
  });
});
