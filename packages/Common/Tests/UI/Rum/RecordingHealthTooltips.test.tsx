import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import {
  diagnoseRecordingHealth,
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
  SESSION_REPLAY_STALE_CHUNK_MS,
} from "../../../Utils/Rum/SessionReplayHealth";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Replay Health page's (i) tooltips: the four pipeline stages, the two
 * upload counters and the two byte meters. The policy and recorder panels
 * list settings and versions, not measurements, and carry none; nor does
 * the compact card on the Replay Policy page, which only shows the
 * diagnosis.
 *
 * Each (i) is hovered and must show its own text from
 * RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS. The thresholds the texts name
 * (amber after 24 hours, after 6 hours, from 80%, "5 or more") are checked
 * against what the page actually colours, on both sides of each line.
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

import {
  PIPELINE_STAGE_TOOLTIPS,
  RecordingHealthDashboardView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard";
import { RecordingHealthSummaryView } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard";
import { USAGE_WARNING_PERCENT } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthModel";
import { SessionReplayHealthSnapshot } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";
import {
  RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS,
  RumRecordingHealthMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import { expectReadableDescriptionRecord } from "../../App/Dashboard/MetricDescriptionRules";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;
// Every (i) is a button named "About <what it explains>".
const INFO_BUTTON_NAME: RegExp = /^About /;

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
    lastSessionStartedAt: iso(MINUTE_MS),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: 256 * MB,
    monthlyBudgetInGB: 1,
    ...overrides,
  };
}

function makeSnapshot(
  status: RecordingHealthStatus,
  overrides?: Partial<SessionReplayHealthSnapshot>,
): SessionReplayHealthSnapshot {
  return {
    status: status,
    diagnosis: diagnoseRecordingHealth(status, NOW),
    extras: {
      dropsLast24h: [{ reason: "scrub-incomplete", count: 2 }],
      recorderCapabilities: ["click-events"],
    },
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

function renderView(status: RecordingHealthStatus = makeStatus()): void {
  render(
    <MemoryRouter>
      <RecordingHealthDashboardView
        rumApplicationId={APP_ID}
        health={makeSnapshot(status)}
      />
    </MemoryRouter>,
  );
}

function infoButton(label: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${label}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function allInfoLabels(): Array<string> {
  return screen
    .queryAllByRole("button", { name: INFO_BUTTON_NAME })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

async function expectExplained(
  label: string,
  key: RumRecordingHealthMetric,
): Promise<void> {
  const button: HTMLElement = infoButton(label);

  expect(button.parentElement?.closest("button, a")).toBeNull();
  expect(await tooltipTextOf(button)).toBe(
    RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS[key],
  );
}

function tone(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("data-tone");
}

beforeEach(() => {
  jest.useFakeTimers();
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the Replay Health descriptions", () => {
  test("read as short, finished, distinct sentences", () => {
    expectReadableDescriptionRecord(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS,
      "RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS",
    );
  });

  test("every pipeline stage has its own text", () => {
    expect(PIPELINE_STAGE_TOOLTIPS).toEqual({
      recorder: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recorderLoaded,
      policy: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recordingAllowed,
      uploads: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.chunksReceived,
      sessions: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.sessionsLast24h,
    });
  });
});

describe("Replay Health tooltips", () => {
  test("the stages, counters and meters explain themselves; settings and versions do not", async () => {
    renderView();

    expect(allInfoLabels()).toEqual([
      "Recorder loaded",
      "Recording allowed",
      "Chunks received",
      "Sessions in 24h",
      "Refused at the gate",
      "Dropped after acceptance",
      "Project bytes today",
      "This application this month",
    ]);

    await expectExplained("Recorder loaded", "recorderLoaded");
    await expectExplained("Recording allowed", "recordingAllowed");
    await expectExplained("Chunks received", "chunksReceived");
    await expectExplained("Sessions in 24h", "sessionsLast24h");
    await expectExplained("Refused at the gate", "refusedAtGate");
    await expectExplained("Dropped after acceptance", "droppedAfterAcceptance");
    await expectExplained("Project bytes today", "projectBytesToday");
    await expectExplained(
      "This application this month",
      "applicationBytesThisMonth",
    );

    expect(
      within(screen.getByTestId("health-policy")).queryAllByRole("button", {
        name: INFO_BUTTON_NAME,
      }),
    ).toHaveLength(0);
    expect(
      within(screen.getByTestId("health-recorder")).queryAllByRole("button", {
        name: INFO_BUTTON_NAME,
      }),
    ).toHaveLength(0);
  });

  test("each (i) sits in its own stage, list or meter", () => {
    renderView();

    for (const key of ["recorder", "policy", "uploads", "sessions"]) {
      const stage: HTMLElement = screen.getByTestId(`health-stage-${key}`);

      expect(
        within(stage).getByTestId(`health-stage-${key}-info`),
      ).toBeInTheDocument();
    }

    for (const testId of [
      "health-refusals",
      "health-drops",
      "health-meter-project-day",
      "health-meter-app-month",
    ]) {
      expect(
        within(screen.getByTestId(testId)).getByTestId(`${testId}-info`),
      ).toBeInTheDocument();
    }
  });

  test("an unknown counter keeps its (i): the explanation does not depend on the value", () => {
    renderView(
      makeStatus({
        refusalsLast24h: null,
        projectBytesUsedToday: null,
        applicationBytesUsedThisMonth: null,
        monthlyBudgetInGB: null,
        sessionsLast24h: null,
        playableSessionsLast24h: null,
      }),
    );

    expect(allInfoLabels()).toHaveLength(8);
  });

  test("the policy page's summary card shows the diagnosis only, with no (i)", () => {
    render(
      <MemoryRouter>
        <RecordingHealthSummaryView
          rumApplicationId={APP_ID}
          health={makeSnapshot(makeStatus())}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(allInfoLabels()).toEqual([]);
  });
});

describe("the thresholds the texts name are the ones the page colours by", () => {
  test("Recorder loaded turns amber only past 24 hours", () => {
    expect(SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS).toBe(24 * HOUR_MS);
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recorderLoaded).toContain(
      "Amber after 24 hours",
    );

    renderView(makeStatus({ lastConfigFetchAt: iso(23 * HOUR_MS) }));
    expect(tone("health-stage-recorder")).toBe("ok");
    cleanup();

    renderView(
      makeStatus({ lastConfigFetchAt: iso(24 * HOUR_MS + MINUTE_MS) }),
    );
    expect(tone("health-stage-recorder")).toBe("warning");
  });

  test("Chunks received turns amber only past 6 hours", () => {
    expect(SESSION_REPLAY_STALE_CHUNK_MS).toBe(6 * HOUR_MS);
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.chunksReceived).toContain(
      "amber after 6 hours without one",
    );

    renderView(makeStatus({ lastChunkReceivedAt: iso(5 * HOUR_MS) }));
    expect(tone("health-stage-uploads")).toBe("ok");
    cleanup();

    renderView(
      makeStatus({ lastChunkReceivedAt: iso(6 * HOUR_MS + MINUTE_MS) }),
    );
    expect(tone("health-stage-uploads")).toBe("warning");
  });

  test("Chunks received shows every refused request once one reason reaches 5", () => {
    expect(SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD).toBe(5);
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.chunksReceived).toContain(
      "When one refusal reason has 5 or more below",
    );

    renderView(
      makeStatus({
        refusalsLast24h: [
          { reason: "origin-not-allowed", count: 4 },
          { reason: "not-sampled", count: 4 },
        ],
      }),
    );
    // Eight refusals, but no single reason reached the threshold.
    expect(screen.getByTestId("health-stage-uploads-value")).toHaveTextContent(
      "12s ago",
    );
    cleanup();

    renderView(
      makeStatus({
        refusalsLast24h: [
          { reason: "origin-not-allowed", count: 5 },
          { reason: "not-sampled", count: 3 },
        ],
      }),
    );
    // The value is the total across reasons, not the top reason alone.
    expect(screen.getByTestId("health-stage-uploads-value")).toHaveTextContent(
      "8 refused",
    );
    expect(screen.getByTestId("health-refusals-total")).toHaveTextContent(
      "8 total",
    );
  });

  test("a byte meter turns amber from 80% and red at 100%", () => {
    expect(USAGE_WARNING_PERCENT).toBe(80);
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.projectBytesToday,
    ).toContain("amber from 80%");
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.applicationBytesThisMonth,
    ).toContain("amber from 80%");

    renderView(
      makeStatus({
        projectBytesUsedToday: Math.floor(GB * 0.79),
        applicationBytesUsedThisMonth: Math.ceil(GB * 0.8),
      }),
    );
    expect(tone("health-meter-project-day")).toBe("ok");
    expect(tone("health-meter-app-month")).toBe("warning");
    cleanup();

    renderView(
      makeStatus({
        projectBytesUsedToday: GB,
        applicationBytesUsedThisMonth: GB,
      }),
    );
    expect(tone("health-meter-project-day")).toBe("error");
    expect(tone("health-meter-app-month")).toBe("error");
  });

  /*
   * Which sessions the server calls playable is pinned against its SQL in
   * App/Tests/Dashboard/RumFlowsUsersHealthTooltipWiring.test.ts; here, the
   * stage shows the two numbers the text talks about.
   */
  test("Sessions in 24h shows the count, with the playable figure beside it", () => {
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.sessionsLast24h).toContain(
      "sessions still recording count as playable",
    );

    renderView(makeStatus({ sessionsLast24h: 10, playableSessionsLast24h: 7 }));

    expect(screen.getByTestId("health-stage-sessions-value")).toHaveTextContent(
      "10",
    );
    expect(screen.getByTestId("health-stage-sessions")).toHaveTextContent(
      "7 playable",
    );
  });
});
