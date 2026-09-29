import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import { AI_INVESTIGATION_PANEL_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const SUBJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SECOND_SUBJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const POLL_INTERVAL_MS: number = 2500;

type InvestigationResponseFunction = (
  status: AIRunStatus | null,
) => HTTPResponse<JSONObject>;

const investigationResponse: InvestigationResponseFunction = (
  status: AIRunStatus | null,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: status
        ? {
            status: status,
            toolCallCount: 0,
            totalTokens: 0,
          }
        : null,
      events: [],
    },
    {},
  );
};

type AdvanceFunction = () => void;

const advance: AdvanceFunction = (): void => {
  act(() => {
    jest.advanceTimersByTime(POLL_INTERVAL_MS);
  });
};

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue({ tenantid: "project-id" });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("InvestigationPanel status reporting", () => {
  test("reports a running investigation and uses the existing incident endpoint", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(investigationResponse(AIRunStatus.Running));

    const { container } = render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );

    expect(await screen.findByText("Investigating…")).toBeInTheDocument();
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Running);
    });

    const request: any = postMock.mock.calls[0]?.[0];
    expect(request.url.toString()).toContain("/ai-investigation/incident");
    expect(request.data).toEqual({ incidentId: SUBJECT_ID.toString() });
    expect(request.headers).toEqual({ tenantid: "project-id" });

    const panel: HTMLElement = screen.getByRole("region", {
      name: "AI Investigation",
    });
    expect(panel).toHaveAttribute("id", AI_INVESTIGATION_PANEL_ID);
    expect(panel).toHaveAttribute("tabindex", "-1");
    expect(container.innerHTML).toContain("motion-safe:animate-ping");
  });

  test("reports null only after a successful response confirms no run exists", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    let resolveRequest: ((response: HTTPResponse<JSONObject>) => void) | null =
      null;
    postMock.mockReturnValue(
      new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          resolveRequest = resolve;
        },
      ),
    );

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );

    expect(onStatusChange).not.toHaveBeenCalled();

    resolveRequest!(investigationResponse(null));
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledTimes(1);
    });

    expect(onStatusChange).toHaveBeenCalledWith(null);
    expect(
      screen.getByText("No investigation has been recorded"),
    ).toBeVisible();
  });

  test("discovers an AI run that is enqueued after the incident page loads", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(investigationResponse(null))
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Queued));

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(null);
    });
    expect(jest.getTimerCount()).toBe(1);

    advance();
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Queued);
    });

    expect(screen.getByText(/Queued/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("stops discovery polling when no AI run appears", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(investigationResponse(null));

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(null);
    });

    for (
      let expectedRequestCount: number = 2;
      expectedRequestCount <= 5;
      expectedRequestCount++
    ) {
      advance();
      await waitFor(() => {
        expect(postMock).toHaveBeenCalledTimes(expectedRequestCount);
      });
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(jest.getTimerCount()).toBe(0);
    advance();
    expect(postMock).toHaveBeenCalledTimes(5);
  });

  test("follows queued to running to completed and stops polling at the terminal state", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Queued))
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Running))
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Completed));

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Queued);
    });
    expect(screen.getByText(/Queued/)).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(1);

    advance();
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Running);
    });
    expect(screen.getByText("Investigating…")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(1);

    advance();
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Completed);
    });
    expect(screen.getByText("Investigation complete")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);

    advance();
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  /*
   * A run is Completed a moment before its report is posted, so the panel
   * keeps polling and the report (with its evidence) lands on a later poll.
   * The run details are React state now, not a native disclosure: that poll
   * must neither collapse the section a reader opened nor switch them from
   * the activity they were reading to the evidence tab it adds.
   */
  test("keeps the reader's open run details when the report lands on a later poll", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    const runJson: JSONObject = {
      _id: "33333333-3333-4333-8333-333333333333",
      status: AIRunStatus.Completed,
      toolCallCount: 1,
      totalTokens: 0,
    };
    const events: JSONArray = [
      {
        _id: "44444444-4444-4444-8444-444444444444",
        sequence: 1,
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "search_logs",
      },
    ];
    postMock
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            run: runJson,
            events: events,
            analysisMarkdown: null,
            isAnalysisPending: true,
          },
          {},
        ),
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            run: runJson,
            events: events,
            analysisMarkdown:
              "## Root cause\n\nThe database connection pool was exhausted.",
            isAnalysisPending: false,
            evidence: [
              {
                citationId: "C1",
                toolName: "search_logs",
                label: "Logs 17:20 – 18:20 (1 shown)",
                rowCount: 1,
                queryArguments: { bodySearchText: "pool timeout" },
                canLoadRows: true,
              },
            ],
          },
          {},
        ),
      );

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    expect(
      await screen.findByText("Preparing investigation report…"),
    ).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Completed);

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Investigation activity",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Searching logs/)).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Searching logs/)).toBeVisible();
    expect(jest.getTimerCount()).toBe(1);

    advance();
    expect(
      await screen.findByText("Investigation complete"),
    ).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);

    // Same button, still open, renamed for what it now holds.
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Evidence and activity");

    const tabs: HTMLElement = screen.getByRole("tablist", {
      name: "Investigation details",
    });
    const evidenceTab: HTMLElement = within(tabs).getByRole("tab", {
      name: /^Evidence checked/,
    });
    const activityTab: HTMLElement = within(tabs).getByRole("tab", {
      name: /^Activity/,
    });
    expect(evidenceTab).toHaveAttribute("aria-selected", "false");
    expect(activityTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Searching logs/)).toBeVisible();
    expect(screen.getByLabelText("Evidence checked")).not.toBeVisible();

    // A finished run with a report settles into the slow watch.
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("does not start a poller for an already completed investigation", async () => {
    jest.useFakeTimers();
    postMock.mockResolvedValue(investigationResponse(AIRunStatus.Completed));

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );
    expect(
      await screen.findByText("Investigation complete"),
    ).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);
    advance();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  /*
   * The header summary rides along with the status: a completed run with no
   * report (this older payload shape) has nothing to summarise, and neither
   * does a running one.
   */
  test("reports no header summary for runs without a report", async () => {
    jest.useFakeTimers();
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Running))
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Completed));

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onReportSummaryChange={onReportSummaryChange}
      />,
    );
    expect(await screen.findByText("Investigating…")).toBeInTheDocument();

    advance();
    expect(
      await screen.findByText("Investigation complete"),
    ).toBeInTheDocument();

    expect(onReportSummaryChange).toHaveBeenCalled();
    for (const call of onReportSummaryChange.mock.calls) {
      expect(call[0]).toBeNull();
    }
    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("clears its active timer when the panel unmounts", async () => {
    jest.useFakeTimers();
    postMock.mockResolvedValue(investigationResponse(AIRunStatus.Running));

    const { unmount } = render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );
    expect(await screen.findByText("Investigating…")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(1);

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("shows an unavailable status when the initial request fails", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}),
    );

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(null);
    });
    expect(
      screen.getByText("Investigation status is unavailable"),
    ).toBeVisible();
    expect(screen.queryByText("Not investigated")).toBeNull();
  });

  test("preserves the last active status through a transient polling failure", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Running))
      .mockResolvedValueOnce(
        new HTTPErrorResponse(503, { message: "try again" }, {}),
      );

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Running);
    });

    advance();
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Running);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Investigating…")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("does not refetch when the same subject is passed as a new ObjectID instance", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(investigationResponse(AIRunStatus.Completed));

    const { rerender } = render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    expect(
      await screen.findByText("Investigation complete"),
    ).toBeInTheDocument();

    rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={new ObjectID(SUBJECT_ID.toString())}
        onStatusChange={onStatusChange}
      />,
    );
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  test("clears an old active investigation when the subject changes and the new request fails", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Running))
      .mockResolvedValueOnce(
        new HTTPErrorResponse(503, { message: "try again" }, {}),
      );

    const { rerender } = render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    expect(await screen.findByText("Investigating…")).toBeInTheDocument();

    rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SECOND_SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Investigation status is unavailable"),
      ).toBeVisible();
      expect(onStatusChange).toHaveBeenLastCalledWith(null);
    });
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Investigating…")).toBeNull();
  });

  test("ignores a late response from the previous subject", async () => {
    const onStatusChange: MockFunction = getJestMockFunction();
    let resolveFirstSubject:
      | ((response: HTTPResponse<JSONObject>) => void)
      | null = null;

    postMock.mockImplementation((request: any) => {
      if (request.data.incidentId === SUBJECT_ID.toString()) {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (response: HTTPResponse<JSONObject>) => void) => {
            resolveFirstSubject = resolve;
          },
        );
      }

      return Promise.resolve(investigationResponse(AIRunStatus.Completed));
    });

    const { rerender } = render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SECOND_SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    expect(
      await screen.findByText("Investigation complete"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Completed);
    });

    resolveFirstSubject!(investigationResponse(AIRunStatus.Running));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("Investigation complete")).toBeInTheDocument();
    expect(screen.queryByText("Investigating…")).not.toBeInTheDocument();
    expect(onStatusChange).not.toHaveBeenCalledWith(AIRunStatus.Running);
    expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Completed);
  });

  test("waits for an in-flight poll before scheduling another one", async () => {
    jest.useFakeTimers();
    const onStatusChange: MockFunction = getJestMockFunction();
    let resolvePoll: ((response: HTTPResponse<JSONObject>) => void) | null =
      null;
    postMock
      .mockResolvedValueOnce(investigationResponse(AIRunStatus.Running))
      .mockReturnValueOnce(
        new Promise<HTTPResponse<JSONObject>>(
          (resolve: (response: HTTPResponse<JSONObject>) => void) => {
            resolvePoll = resolve;
          },
        ),
      );

    render(
      <InvestigationPanel
        subjectType="incident"
        subjectId={SUBJECT_ID}
        onStatusChange={onStatusChange}
      />,
    );
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Running);
    });

    advance();
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
    expect(jest.getTimerCount()).toBe(0);

    advance();
    expect(postMock).toHaveBeenCalledTimes(2);

    resolvePoll!(investigationResponse(AIRunStatus.Completed));
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenLastCalledWith(AIRunStatus.Completed);
    });

    expect(screen.getByText("Investigation complete")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(0);
  });
});
