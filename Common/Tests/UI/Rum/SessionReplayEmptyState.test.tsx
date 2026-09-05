import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import { diagnoseRecordingHealth } from "../../../Utils/Rum/SessionReplayHealth";

/*
 * The explained empty list. Every variant renders its cause, its quantity
 * and exactly one action; the range action calls the range setter with
 * the wider range; chips carry a remove button; never-installed embeds
 * the live setup guide and nothing else does.
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

import SessionReplayEmptyState, {
  getEmptyReason,
  SessionReplayEmptyContext,
  SessionReplayEmptyReason,
  SessionReplayEmptyStateView,
  SessionReplayEmptyStateViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayEmptyState";
import { EMPTY_ADVANCED_FILTERS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function iso(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
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
    ...overrides,
  };
}

function reasonFor(
  status: RecordingHealthStatus | null,
  overrides?: Partial<SessionReplayEmptyContext>,
): SessionReplayEmptyReason {
  const reason: SessionReplayEmptyReason | null = getEmptyReason({
    isLoading: false,
    error: "",
    rowCount: 0,
    page: 1,
    signal: "all",
    advanced: EMPTY_ADVANCED_FILTERS,
    timeRange: { range: TimeRange.PAST_ONE_DAY },
    health:
      status === null
        ? null
        : { status: status, diagnosis: diagnoseRecordingHealth(status, NOW) },
    nowUnixMs: NOW,
    ...overrides,
  });

  expect(reason).not.toBeNull();

  return reason as SessionReplayEmptyReason;
}

const onRemoveChip: MockFunction = getJestMockFunction();
const onClearFilters: MockFunction = getJestMockFunction();
const onSetTimeRange: MockFunction = getJestMockFunction();
const onPreviousPage: MockFunction = getJestMockFunction();
const onRefresh: MockFunction = getJestMockFunction();

function renderView(
  reason: SessionReplayEmptyReason,
  props?: Partial<SessionReplayEmptyStateViewProps>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SessionReplayEmptyStateView
        rumApplicationId={APP_ID}
        reason={reason}
        chips={[]}
        onRemoveChip={onRemoveChip}
        onClearFilters={onClearFilters}
        onSetTimeRange={onSetTimeRange}
        onPreviousPage={onPreviousPage}
        onRefresh={onRefresh}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  postMock.mockReset();
  onRemoveChip.mockReset();
  onClearFilters.mockReset();
  onSetTimeRange.mockReset();
  onPreviousPage.mockReset();
  onRefresh.mockReset();
  clearSessionReplayHealthStore();
});

describe("SessionReplayEmptyStateView variants", () => {
  it("disabled: names the switch, offers Turn it on as a link", () => {
    renderView(
      reasonFor(
        makeStatus({
          policy: { ...makeStatus().policy, isApplicationEnabled: false },
        }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "disabled",
    );
    expect(screen.getByTestId("list-empty-title")).toHaveTextContent(
      "switched off",
    );
    expect(screen.getByTestId("list-empty-action")).toHaveTextContent(
      "Turn it on",
    );
    expect(
      screen.getByTestId("list-empty-action").closest("a"),
    ).toHaveAttribute("href");
    expect(screen.queryByTestId("setup-guide")).toBeNull();
  });

  it("budget: quantifies the budget and offers to raise it", () => {
    renderView(
      reasonFor(
        makeStatus({
          budgetExceededAt: iso(2 * 60 * 60 * 1000),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 3 * 1024 * 1024 * 1024,
        }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "budget",
    );
    expect(screen.getByTestId("list-empty-title")).toHaveTextContent(
      "Uploads paused 2h ago",
    );
    expect(screen.getByTestId("list-empty-detail")).toHaveTextContent(
      "2 GB monthly budget",
    );
    expect(screen.getByTestId("list-empty-action")).toHaveTextContent(
      "Raise the budget",
    );
  });

  it("refusing: counts the refusals, names the reason in words, offers the fix", () => {
    renderView(
      reasonFor(
        makeStatus({
          refusalsLast24h: [{ reason: "origin-not-allowed", count: 212 }],
        }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "refusing",
    );
    expect(screen.getByTestId("list-empty-title")).toHaveTextContent(
      "212 uploads refused",
    );
    expect(screen.getByTestId("list-empty-title")).not.toHaveTextContent(
      "origin-not-allowed",
    );
    expect(screen.getAllByTestId("list-empty-action").length).toBe(1);
  });

  it("never-installed: embeds the live setup guide", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        wireStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
        {},
      ),
    );

    renderView(
      reasonFor(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "never-installed",
    );
    expect(screen.getByTestId("list-empty-title")).toHaveTextContent(
      "Nothing has been recorded here yet",
    );

    await waitFor(() => {
      expect(screen.getByTestId("setup-guide")).toBeInTheDocument();
    });
  });

  it("installed-not-uploading: explains from the policy with one action", () => {
    renderView(
      reasonFor(
        makeStatus({
          lastChunkReceivedAt: null,
          policy: { ...makeStatus().policy, samplePercentage: 0 },
        }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "installed-not-uploading",
    );
    expect(screen.getByTestId("list-empty-detail")).toHaveTextContent("0%");
    expect(screen.getByTestId("list-empty-action")).toHaveTextContent(
      "Set sampling to 100%",
    );
    expect(screen.queryByTestId("setup-guide")).toBeNull();
  });

  it("no-sessions-in-range: 'Show the past 7 days' calls the range setter", () => {
    renderView(
      reasonFor(
        makeStatus({
          lastSessionStartedAt: iso(3 * DAY_MS),
          lastChunkReceivedAt: iso(3 * DAY_MS),
          lastConfigFetchAt: iso(3 * DAY_MS),
        }),
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "no-sessions-in-range",
    );
    expect(screen.getByTestId("list-empty-title")).toHaveTextContent(
      "No sessions in the past 24 hours",
    );
    expect(screen.getByTestId("list-empty-detail")).toHaveTextContent(
      "The most recent started 3d ago",
    );

    fireEvent.click(screen.getByTestId("list-empty-action"));

    expect(onSetTimeRange).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  it("no-sessions-in-range with a session inside the window offers a reload", () => {
    renderView(reasonFor(makeStatus()));

    expect(screen.getByTestId("list-empty-detail")).toHaveTextContent(
      "reported a session 1m ago",
    );

    fireEvent.click(screen.getByTestId("list-empty-action"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("filters-match-nothing: chips with x, and Clear filters", () => {
    renderView(
      reasonFor(makeStatus(), {
        signal: "errors",
        advanced: { ...EMPTY_ADVANCED_FILTERS, urlPrefix: "/checkout" },
      }),
      {
        chips: [
          {
            field: "urlPrefix",
            label: "Page URL starts with",
            text: "/checkout",
          },
        ],
      },
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "filters-match-nothing",
    );
    expect(screen.getByTestId("list-empty-chips")).toHaveTextContent(
      "/checkout",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Page URL starts with filter",
      }),
    );

    expect(onRemoveChip).toHaveBeenCalledWith("urlPrefix");

    fireEvent.click(screen.getByTestId("list-empty-action"));

    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("end-of-list: back to the previous page, never setup", () => {
    renderView(
      reasonFor(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
        { page: 4 },
      ),
    );

    expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
      "end-of-list",
    );
    expect(screen.queryByTestId("setup-guide")).toBeNull();

    fireEvent.click(screen.getByTestId("list-empty-action"));

    expect(onPreviousPage).toHaveBeenCalledTimes(1);
  });
});

describe("SessionReplayEmptyState connected", () => {
  function renderConnected(
    context?: Partial<SessionReplayEmptyContext>,
  ): ReturnType<typeof render> {
    return render(
      <MemoryRouter>
        <SessionReplayEmptyState
          rumApplicationId={APP_ID}
          context={{
            isLoading: false,
            error: "",
            rowCount: 0,
            page: 1,
            signal: "all",
            advanced: EMPTY_ADVANCED_FILTERS,
            timeRange: { range: TimeRange.PAST_ONE_DAY },
            ...context,
          }}
          chips={[]}
          onRemoveChip={onRemoveChip}
          onClearFilters={onClearFilters}
          onSetTimeRange={onSetTimeRange}
          onPreviousPage={onPreviousPage}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );
  }

  it("reads the health poller and picks never-installed when nothing ever loaded", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        wireStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
        {},
      ),
    );

    renderConnected();

    await waitFor(() => {
      expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
        "never-installed",
      );
    });
  });

  it("renders nothing while the list has rows", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    renderConnected({ rowCount: 5 });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("list-empty")).toBeNull();
  });

  it("a health request the viewer may not make still yields an honest quiet answer", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Forbidden" }, {}),
    );

    renderConnected();

    await waitFor(() => {
      expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
        "no-sessions-in-range",
      );
    });

    expect(screen.getByTestId("list-empty-detail")).toHaveTextContent(
      "unknown",
    );
  });
});
