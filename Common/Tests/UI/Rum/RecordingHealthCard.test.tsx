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
 * The Replay Policy page's recording-health summary card, the shared paste
 * box, the action links, and the installation test rows that share the
 * diagnosis. (The full health picture is RecordingHealthDashboard.test.tsx.)
 *
 * The summary shows only the diagnosis and a way to the Health page; the
 * diagnostics paste box explains real recorder codes and reports malformed
 * input; the installation rows branch their copy on the
 * capture trigger (settings-setup-2), link failing rows to the page that
 * fixes them (settings-setup-3) and describe both origin allowlists
 * (settings-setup-6).
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
      getList: (): Promise<{ data: Array<unknown> }> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

import {
  RecorderDiagnosticsPasteBox,
  RecordingHealthSummaryView,
  getRecordingHealthActionLink,
  getRecordingHealthPageRoute,
  getReplayPolicyPageRoute,
  labelEnum,
  CAPTURE_TRIGGER_LABELS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard";
import InstallationTestPanel, {
  CheckRow,
  buildInstallationCheckRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/InstallationTestPanel";
import {
  SessionReplayHealthExtras,
  SessionReplayHealthSnapshot,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const GB: number = 1024 * 1024 * 1024;

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

/*
 * The same shape against the REAL clock.
 *
 * Snapshots this file builds itself are diagnosed at the frozen NOW, so a
 * fixed date is right for them. The connected tests are not: they go through
 * the hook, which diagnoses whatever /ingest-status answers against
 * Date.now(). An age built from the frozen NOW therefore grows by a day for
 * every day that passes, and a fixture meant to read "last chunk 12s ago"
 * eventually reads "no chunk for 15h" - green on the morning it was written,
 * amber by that evening, and a failing job on master ever after.
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
    lastChunkReceivedAt: iso(5 * 60 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

const NO_EXTRAS: SessionReplayHealthExtras = {
  dropsLast24h: null,
  recorderCapabilities: null,
};

function makeSnapshot(
  status: RecordingHealthStatus | null,
  overrides?: Partial<SessionReplayHealthSnapshot>,
): SessionReplayHealthSnapshot {
  return {
    status: status,
    diagnosis: diagnoseRecordingHealth(status, NOW),
    extras: NO_EXTRAS,
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

function renderCard(snapshot: SessionReplayHealthSnapshot): void {
  render(
    <MemoryRouter>
      <RecordingHealthSummaryView rumApplicationId={APP_ID} health={snapshot} />
    </MemoryRouter>,
  );
}

/*
 * The wire shape, as /ingest-status answers it. Read by the hook, which
 * diagnoses against the real clock - so its ages come from it too.
 */
function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: [],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: null,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: isoFromRealNow(12 * 1000),
    lastSessionStartedAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    dropsLast24h: null,
    ...overrides,
  };
}

function rowByKey(rows: Array<CheckRow>, key: string): CheckRow {
  const row: CheckRow | undefined = rows.find((entry: CheckRow): boolean => {
    return entry.key === key;
  });

  expect(row).toBeDefined();

  return row as CheckRow;
}

beforeEach(() => {
  postMock.mockReset();
  clearSessionReplayHealthStore();
});

describe("RecordingHealthSummaryView (the Replay Policy page's card)", () => {
  it("shows the one-line diagnosis and nothing of the full health page", () => {
    renderCard(makeSnapshot(makeStatus()));

    expect(screen.getByTestId("health-card")).toHaveAttribute(
      "data-state",
      "healthy",
    );
    expect(screen.getByTestId("health-diagnosis")).toHaveTextContent(
      "Recording healthy",
    );
    /* The fact grid, budgets and paste box live on the Health page now. */
    expect(screen.queryByTestId("health-fact-last-chunk")).toBeNull();
    expect(screen.queryByTestId("health-bytes")).toBeNull();
    expect(screen.queryByTestId("diagnostics-paste-box")).toBeNull();
    expect(screen.queryByTestId("health-pipeline")).toBeNull();
  });

  it("offers a way to the Health page", () => {
    renderCard(makeSnapshot(makeStatus()));

    expect(screen.getByText("View health details")).toBeInTheDocument();
  });

  it("carries the diagnosis action for a state that has one", () => {
    renderCard(
      makeSnapshot(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      ),
    );

    expect(screen.getByTestId("health-card")).toHaveAttribute(
      "data-state",
      "never-loaded",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Open the setup guide",
    );
  });

  it("keeps the last good status on a failed refresh and says when it was read", () => {
    renderCard(
      makeSnapshot(makeStatus(), {
        error: { kind: "other", message: "boom" },
        fetchedAtUnixMs: NOW - 3 * 60 * 1000,
      }),
    );

    expect(screen.getByTestId("health-diagnosis")).toBeInTheDocument();
    expect(screen.getByTestId("health-card-stale")).toHaveTextContent(
      "showing the status read 3m ago",
    );
  });

  it("with no status and a permission error, names the permission", () => {
    renderCard(
      makeSnapshot(null, {
        error: { kind: "permission", message: "Forbidden" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-card-error")).toHaveTextContent(
      "You cannot see recording health",
    );
    expect(screen.getByTestId("health-card-error")).toHaveTextContent(
      "Server said: Forbidden",
    );
    expect(screen.queryByTestId("health-diagnosis")).toBeNull();
  });

  it("loading says so", () => {
    renderCard(makeSnapshot(null, { isLoading: true, fetchedAtUnixMs: null }));

    expect(screen.getByTestId("health-card")).toHaveAttribute(
      "data-state",
      "loading",
    );
    expect(screen.getByTestId("health-card-loading")).toHaveTextContent(
      "Checking recording health",
    );
  });
});

describe("Recorder diagnostics paste box", () => {
  function renderPasteBox(showHeading?: boolean): void {
    render(
      <MemoryRouter>
        <RecorderDiagnosticsPasteBox showHeading={showHeading} />
      </MemoryRouter>,
    );
  }

  it("keeps its own heading by default and drops it inside a panel that has one", () => {
    const { unmount } = render(
      <MemoryRouter>
        <RecorderDiagnosticsPasteBox />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("diagnostics-paste-box")).toHaveTextContent(
      "Ask the browser instead",
    );

    unmount();
    renderPasteBox(false);

    expect(screen.getByTestId("diagnostics-paste-box")).not.toHaveTextContent(
      "Ask the browser instead",
    );
    expect(screen.getByTestId("diagnostics-paste-box")).toHaveTextContent(
      "run this in the browser console",
    );
  });

  it("cannot explain an empty box", () => {
    renderPasteBox();

    expect(screen.getByTestId("diagnostics-explain")).toBeDisabled();

    fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("diagnostics-explain")).toBeDisabled();

    fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
      target: { value: "{}" },
    });

    expect(screen.getByTestId("diagnostics-explain")).not.toBeDisabled();
  });

  it("reports malformed input instead of throwing", () => {
    renderPasteBox();

    fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
      target: { value: "not json {" },
    });
    fireEvent.click(screen.getByTestId("diagnostics-explain"));

    expect(screen.getByTestId("diagnostics-error")).toHaveTextContent(
      "That is not JSON",
    );
  });

  it("explains real codes, picks the last outcome as the headline and flags unknown codes", () => {
    renderPasteBox();

    const diagnostics: JSONObject = {
      version: "1.4.0",
      sessionId: null,
      isRecording: false,
      isUploading: false,
      state: "none",
      bootstrapDecision: "privacy-signal",
      capabilities: [],
      records: [
        {
          atUnixMs: NOW,
          level: "info",
          code: "loader-start",
          message: "Loader running.",
        },
        {
          atUnixMs: NOW,
          level: "warn",
          code: "privacy-signal",
          message: "DNT",
        },
        { atUnixMs: NOW, level: "info", code: "brand-new-code", message: "?" },
      ],
    };

    fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
      target: { value: JSON.stringify(diagnostics) },
    });
    fireEvent.click(screen.getByTestId("diagnostics-explain"));

    const explanation: HTMLElement = screen.getByTestId(
      "diagnostics-explanation",
    );

    expect(explanation).toHaveTextContent(
      "This browser sends Do Not Track or Global Privacy Control",
    );
    expect(screen.getAllByTestId("diagnostics-record")).toHaveLength(3);
    expect(explanation).toHaveTextContent("1 code newer than this dashboard");
    expect(explanation).toHaveTextContent("brand-new-code");
    expect(explanation).toHaveTextContent(
      "none: no session was started on this page",
    );
  });
});

describe("getRecordingHealthActionLink", () => {
  it("routes each target to the page that owns the setting, docs in a new tab", () => {
    expect(
      getRecordingHealthActionLink("app-settings", APP_ID).to.toString(),
    ).toContain(`/rum/${APP_ID}/session-replay-settings`);
    expect(
      getRecordingHealthActionLink("allowed-origins", APP_ID).to.toString(),
    ).toContain(`/rum/${APP_ID}/session-replay-settings`);
    expect(
      getRecordingHealthActionLink("budget", APP_ID).to.toString(),
    ).toContain(`/rum/${APP_ID}/session-replay-settings`);
    expect(
      getRecordingHealthActionLink("project-settings", APP_ID).to.toString(),
    ).toContain("/rum/settings/session-replay");
    expect(
      getRecordingHealthActionLink("setup-guide", APP_ID).to.toString(),
    ).toContain(`/rum/${APP_ID}/session-replay-documentation`);

    const consent: { to: { toString: () => string }; openInNewTab: boolean } =
      getRecordingHealthActionLink("docs-consent", APP_ID);
    const csp: { to: { toString: () => string }; openInNewTab: boolean } =
      getRecordingHealthActionLink("docs-csp", APP_ID);

    expect(consent.openInNewTab).toBe(true);
    expect(consent.to.toString()).toContain("#privacy");
    expect(csp.openInNewTab).toBe(true);
    expect(csp.to.toString()).toContain("#content-security-policy");
  });

  it("the Health and Replay Policy page routes are siblings of the session list, never children of it", () => {
    expect(getRecordingHealthPageRoute(APP_ID).toString()).toContain(
      `/rum/${APP_ID}/session-replay-health`,
    );
    expect(getReplayPolicyPageRoute(APP_ID).toString()).toContain(
      `/rum/${APP_ID}/session-replay-settings`,
    );
    expect(getRecordingHealthPageRoute(APP_ID).toString()).not.toContain(
      "session-replay/",
    );
  });

  it("labelEnum never leaks a raw enum value", () => {
    expect(labelEnum(CAPTURE_TRIGGER_LABELS, "OnErrorOrFrustration")).toBe(
      "On error or frustration",
    );
    expect(labelEnum(CAPTURE_TRIGGER_LABELS, "")).toBe("not reported");
    expect(labelEnum(CAPTURE_TRIGGER_LABELS, "Whatever")).toBe(
      "unrecognised value (Whatever)",
    );
  });
});

describe("buildInstallationCheckRows", () => {
  it("under Always, silence is a broken install (settings-setup-2)", () => {
    const rows: Array<CheckRow> = buildInstallationCheckRows(
      makeStatus({ lastChunkReceivedAt: null }),
      NO_EXTRAS,
      NOW,
      APP_ID,
    );

    const chunk: CheckRow = rowByKey(rows, "chunk");

    expect(chunk.state).toBe("waiting");
    expect(chunk.detail).toContain(
      "a chunk should land within about 15 seconds",
    );
    expect(chunk.detail).toContain("the install is broken");
    expect(chunk.detail).not.toContain("usually working correctly");
  });

  it("under On error or frustration, silence can be correct and says how to prove the path", () => {
    const rows: Array<CheckRow> = buildInstallationCheckRows(
      makeStatus({
        lastChunkReceivedAt: null,
        policy: {
          isProjectEnabled: true,
          isApplicationEnabled: true,
          captureTrigger: "OnErrorOrFrustration",
          samplePercentage: 100,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NO_EXTRAS,
      NOW,
      APP_ID,
    );

    const chunk: CheckRow = rowByKey(rows, "chunk");

    expect(chunk.state).toBe("info");
    expect(chunk.detail).toContain("silence here can be correct");
    expect(chunk.detail).toContain("OneUptimeReplay.captureSession()");
    expect(rowByKey(rows, "policy").title).toBe(
      "Uploads on error or frustration, sampling 100%",
    );
  });

  it("a failing switch links to the page that changes it (settings-setup-3)", () => {
    const rows: Array<CheckRow> = buildInstallationCheckRows(
      makeStatus({
        policy: {
          isProjectEnabled: false,
          isApplicationEnabled: false,
          captureTrigger: "Always",
          samplePercentage: 100,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NO_EXTRAS,
      NOW,
      APP_ID,
    );

    const project: CheckRow = rowByKey(rows, "project-switch");
    const app: CheckRow = rowByKey(rows, "app-switch");

    expect(project.state).toBe("fail");
    expect(project.action?.to.toString()).toContain(
      "/rum/settings/session-replay",
    );
    expect(app.state).toBe("fail");
    expect(app.action?.to.toString()).toContain(
      `/rum/${APP_ID}/session-replay-settings`,
    );
    expect(app.detail).not.toContain("table above");
  });

  it("describes both origin allowlists and how they compose (settings-setup-6)", () => {
    const empty: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus({ allowedOrigins: [] }),
        NO_EXTRAS,
        NOW,
        APP_ID,
      ),
      "origins",
    );

    expect(empty.state).toBe("warn");
    expect(empty.title).toBe(
      "This application accepts any origin the ingestion key allows",
    );
    expect(empty.detail).toContain("Two allowlists compose");
    expect(empty.detail).not.toContain("no origin binding of its own");

    const listed: CheckRow = rowByKey(
      buildInstallationCheckRows(makeStatus(), NO_EXTRAS, NOW, APP_ID),
      "origins",
    );

    expect(listed.state).toBe("pass");
    expect(listed.detail).toContain(
      "must also pass the ingestion key's own allowed origins",
    );
    expect(listed.action?.label).toBe("Check the ingestion key's origins");
  });

  it("refusals and drops are separate rows with separate words, unknown when unread", () => {
    const rows: Array<CheckRow> = buildInstallationCheckRows(
      makeStatus({
        refusalsLast24h: [{ reason: "consent-required", count: 40 }],
      }),
      { dropsLast24h: null, recorderCapabilities: null },
      NOW,
      APP_ID,
    );

    expect(rowByKey(rows, "refusals").title).toBe(
      "40 uploads refused in the last 24h",
    );
    expect(rowByKey(rows, "refusals").detail).toContain("40 consent-required");
    expect(rowByKey(rows, "drops").title).toBe(
      "Chunks dropped after acceptance in the last 24h: unknown",
    );
    expect(rowByKey(rows, "capabilities").title).toBe(
      "Recorder capabilities: not reported by the newest recording",
    );
    expect(rowByKey(rows, "capabilities").detail).toContain(
      "this deployment publishes 1.4.0",
    );
  });

  /*
   * docs-and-design-fidelity-3. The route did not send recorderCapabilities
   * at all, so this row read "not reported yet" for every application - and
   * the copy blamed a stale cached artifact even for an application that had
   * never recorded anything, where there is no artifact to blame. Now that
   * the field is on the wire, the two silences get their own sentences.
   */
  it("capabilities: names WHICH silence it is - nothing recorded yet vs an artifact too old to announce them", () => {
    const neverRecorded: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus({ lastChunkReceivedAt: null }),
        NO_EXTRAS,
        NOW,
        APP_ID,
      ),
      "capabilities",
    );

    expect(neverRecorded.title).toBe("Recorder capabilities: not reported yet");
    expect(neverRecorded.detail).toContain("No chunk has arrived");
    /* Nothing recorded means no cached artifact to wait on. */
    expect(neverRecorded.detail).not.toContain("cache window");

    const recordedButSilent: CheckRow = rowByKey(
      buildInstallationCheckRows(makeStatus(), NO_EXTRAS, NOW, APP_ID),
      "capabilities",
    );

    expect(recordedButSilent.title).toBe(
      "Recorder capabilities: not reported by the newest recording",
    );
    expect(recordedButSilent.detail).toContain("cache window");

    const announced: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus(),
        {
          dropsLast24h: null,
          recorderCapabilities: ["click-events", "web-vitals"],
        },
        NOW,
        APP_ID,
      ),
      "capabilities",
    );

    expect(announced.state).toBe("pass");
    expect(announced.title).toBe(
      "Recorder capabilities: click-events, web-vitals",
    );

    const none: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus(),
        { dropsLast24h: null, recorderCapabilities: [] },
        NOW,
        APP_ID,
      ),
      "capabilities",
    );

    expect(none.title).toBe("Recorder capabilities: none announced");
  });

  /*
   * server-1's UI half. budgetExceededAt is a stamp that is never cleared,
   * so the row used to say "Live recorders were told to stand down" months
   * after the window rolled over. diagnoseRecordingHealth owns the live
   * rule; the row follows it.
   */
  it("budget: a live pause fails the check, a stale stamp says uploads are flowing again", () => {
    const paused: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus({
          budgetExceededAt: iso(30 * 60 * 1000),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 3 * GB,
        }),
        NO_EXTRAS,
        NOW,
        APP_ID,
      ),
      "budget-exceeded",
    );

    expect(paused.state).toBe("fail");
    expect(paused.title).toContain("Uploads are paused");
    expect(paused.detail).toContain("nothing is being recorded");

    const stale: CheckRow = rowByKey(
      buildInstallationCheckRows(
        makeStatus({
          budgetExceededAt: iso(40 * 24 * 60 * 60 * 1000),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 100 * 1024 * 1024,
        }),
        NO_EXTRAS,
        NOW,
        APP_ID,
      ),
      "budget-exceeded",
    );

    expect(stale.state).toBe("info");
    expect(stale.title).toContain("uploads are flowing again");
    expect(stale.detail).not.toContain("stand down");
    expect(stale.action?.label).toBe("Review the budget");
  });

  it("budget: a live pause is the card's diagnosis too, with the one action that fixes it", () => {
    renderCard(
      makeSnapshot(
        makeStatus({
          budgetExceededAt: iso(30 * 60 * 1000),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 3 * GB,
        }),
      ),
    );

    expect(screen.getByTestId("health-diagnosis")).toHaveAttribute(
      "data-state",
      "budget-paused",
    );
    expect(screen.getByTestId("health-diagnosis")).toHaveTextContent(
      "Uploads paused",
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      "Raise the budget",
    );
  });

  it("sampling 0% is a warning with an action, and the budget copy says 0 or blank is no ceiling", () => {
    const rows: Array<CheckRow> = buildInstallationCheckRows(
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
      NO_EXTRAS,
      NOW,
      APP_ID,
    );

    expect(rowByKey(rows, "policy").state).toBe("warn");
    expect(rowByKey(rows, "policy").action?.label).toBe("Set sampling to 100%");
    expect(rowByKey(rows, "chunk").detail).toBe(
      "Nothing can arrive while sampling is 0%.",
    );
    expect(rowByKey(rows, "bytes").detail).toContain(
      "0 or blank means no ceiling",
    );
  });
});

describe("InstallationTestPanel (connected, pinned to one application)", () => {
  it("hides the application picker, renders the diagnosis and the rows, and polls the pinned application", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <InstallationTestPanel rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await screen.findByTestId("install-test-rows");

    expect(postMock).toHaveBeenCalledTimes(1);
    expect((postMock.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      rumApplicationId: APP_ID,
    });
    expect(screen.getByTestId("health-diagnosis")).toHaveAttribute(
      "data-state",
      "loaded-never-uploaded",
    );
    expect(screen.getByTestId("install-check-chunk")).toHaveAttribute(
      "data-state",
      "waiting",
    );
    expect(screen.getByTestId("install-test-cadence")).toHaveTextContent(
      "Checking every 10s while a first chunk is outstanding",
    );
    expect(screen.getByTestId("install-snippet")).toBeInTheDocument();
    expect(screen.getByTestId("diagnostics-paste-box")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("Refresh now re-reads the status", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <InstallationTestPanel rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await screen.findByTestId("install-test-rows");
    fireEvent.click(screen.getByTestId("install-test-run-again"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });

  it("a 403 renders the permission copy in place of the rows", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    render(
      <MemoryRouter>
        <InstallationTestPanel rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    const error: HTMLElement = await screen.findByTestId("install-test-error");

    expect(error).toHaveTextContent("You cannot see recording health");
    expect(error).toHaveTextContent("Server said: Not authorized");
    expect(screen.queryByTestId("install-test-rows")).toBeNull();
  });
});
