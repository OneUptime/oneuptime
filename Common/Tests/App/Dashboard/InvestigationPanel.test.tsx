import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * InvestigationPanel is the hand-off between three independently changing
 * pieces of state: the live AIRun, the RootCause feed item posted just after
 * the run becomes Completed, and the already-mounted incident / alert feed.
 * These tests deliberately drive the real React effects and timers because a
 * static completed-state snapshot cannot catch the completion race that this
 * component exists to bridge.
 */

const postMock: MockFunction = getJestMockFunction();
const getFriendlyMessageMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const markdownViewerMock: MockFunction = getJestMockFunction();
const activityFeedMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<any>) => {
        return getFriendlyMessageMock(...args);
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

/*
 * The Common Jest config replaces react-markdown with a text-only stand-in.
 * Record MarkdownViewer's own props here so safeMode remains an asserted part
 * of the contract rather than an implementation detail hidden by that mock.
 */
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      return React.createElement(
        "div",
        { "data-testid": "investigation-markdown" },
        props.text,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed",
  () => {
    return {
      __esModule: true,
      default: (props: ActivityFeedProps): React.ReactElement => {
        activityFeedMock(props);
        return React.createElement("div", {
          "data-testid": "investigation-activity",
        });
      },
    };
  },
);

import InvestigationPanel, {
  InvestigationSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
}

interface ActivityFeedProps {
  events: Array<AIRunEvent>;
  title?: string | undefined;
  showLiveIndicator?: boolean | undefined;
  maxVisibleSteps?: number | undefined;
}

interface InvestigationPayloadOptions {
  status: AIRunStatus;
  runId?: string | undefined;
  events?: JSONArray | undefined;
  analysisMarkdown?: string | null | undefined;
  isAnalysisPending?: boolean | undefined;
  errorMessage?: string | null | undefined;
  toolCallCount?: number | undefined;
  totalTokens?: number | undefined;
  humanVerdict?: string | null | undefined;
}

interface ApiResponse {
  data: JSONObject;
}

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const POLL_INTERVAL_MS: number = 2500;
const SETTLED_POLL_INTERVAL_MS: number = 30_000;
const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const FIX_RUN_ID: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const EVENT_ID: string = "55555555-5555-4555-8555-555555555555";
const ANALYSIS: string =
  "## Root cause\n\nThe database connection pool was exhausted.";

const activityEvent: JSONObject = {
  _id: EVENT_ID,
  sequence: 1,
  eventType: AIRunEventType.ToolCallStarted,
  toolName: "search_logs",
  createdAt: new Date("2026-08-07T10:00:00.000Z"),
};

function investigationPayload(
  options: InvestigationPayloadOptions,
): JSONObject {
  const run: JSONObject = {
    _id: options.runId || RUN_ID,
    status: options.status,
    errorMessage: options.errorMessage ?? null,
    toolCallCount: options.toolCallCount ?? 0,
    totalTokens: options.totalTokens ?? 0,
    humanVerdict: options.humanVerdict ?? null,
  };

  return {
    run,
    events: options.events || [],
    analysisMarkdown: options.analysisMarkdown ?? null,
    isAnalysisPending: options.isAnalysisPending === true,
  };
}

function successfulResponse(payload: JSONObject): ApiResponse {
  return { data: payload };
}

function noInvestigationResponse(): ApiResponse {
  return {
    data: {
      run: null,
      events: [],
      analysisMarkdown: null,
      isAnalysisPending: false,
    },
  };
}

function completedResponse(
  overrides: Partial<InvestigationPayloadOptions> = {},
): ApiResponse {
  return successfulResponse(
    investigationPayload({
      status: AIRunStatus.Completed,
      analysisMarkdown: ANALYSIS,
      events: [activityEvent],
      toolCallCount: 2,
      totalTokens: 1234,
      ...overrides,
    }),
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
  };
}

function renderPanel(data?: {
  subjectType?: InvestigationSubjectType | undefined;
  subjectId?: ObjectID | undefined;
  onAnalysisAvailable?: (() => void) | undefined;
}): ReturnType<typeof render> {
  return render(
    <InvestigationPanel
      subjectType={data?.subjectType || "incident"}
      subjectId={data?.subjectId || INCIDENT_ID}
      onAnalysisAvailable={data?.onAnalysisAvailable}
    />,
  );
}

/* Let the awaits inside fetchData and the following React effects settle. */
async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resolveDeferred<T>(
  deferred: Deferred<T>,
  value: T,
): Promise<void> {
  await act(async (): Promise<void> => {
    deferred.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function postRequestAt(index: number): PostRequest {
  return postMock.mock.calls[index]![0] as PostRequest;
}

function lastActivityProps(): ActivityFeedProps {
  const calls: Array<Array<ActivityFeedProps>> = activityFeedMock.mock
    .calls as Array<Array<ActivityFeedProps>>;
  return calls[calls.length - 1]![0]!;
}

beforeEach(() => {
  jest.useFakeTimers();
  getCommonHeadersMock.mockReturnValue({});
  getFriendlyMessageMock.mockImplementation((error: unknown): string => {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return (error as { message: string }).message;
    }

    return "Request failed";
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  postMock.mockReset();
  getFriendlyMessageMock.mockReset();
  getCommonHeadersMock.mockReset();
  markdownViewerMock.mockReset();
  activityFeedMock.mockReset();
});

describe("InvestigationPanel", () => {
  test("renders nothing when this subject has no investigation", async () => {
    postMock.mockResolvedValue(noInvestigationResponse() as never);

    const { container } = renderPanel();
    await flush();

    expect(container).toBeEmptyDOMElement();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("shows live activity and requests the incident-specific endpoint", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Running,
          events: [activityEvent],
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByText("Investigating…")).toBeInTheDocument();
    expect(screen.getByTestId("investigation-activity")).toBeInTheDocument();
    expect(lastActivityProps().events).toHaveLength(1);
    expect(lastActivityProps().showLiveIndicator).toBe(true);
    expect(jest.getTimerCount()).toBe(1);

    const request: PostRequest = postRequestAt(0);
    expect(request.url.toString()).toContain("/ai-investigation/incident");
    expect(request.data).toEqual({ incidentId: INCIDENT_ID.toString() });
    expect(getCommonHeadersMock).toHaveBeenCalledTimes(1);
  });

  test("renders a completed report safely and demotes activity to a non-live disclosure", async () => {
    const onAnalysisAvailable: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel({ onAnalysisAvailable });
    await flush();

    expect(screen.getByText("Investigation complete")).toBeInTheDocument();
    expect(screen.getByLabelText("Investigation report")).toBeInTheDocument();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The database connection pool was exhausted.",
    );
    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: ANALYSIS,
      safeMode: true,
    });

    expect(screen.getByText("Investigation activity")).toBeInTheDocument();
    expect(lastActivityProps()).toEqual(
      expect.objectContaining({
        title: "Completed activity",
        showLiveIndicator: false,
        maxVisibleSteps: 10,
      }),
    );

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toHaveTextContent("2 telemetry queries");
    expect(usage).toHaveTextContent("1,234 tokens");
    expect(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("keeps polling across Completed until the same run's report appears", async () => {
    const onAnalysisAvailable: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          analysisMarkdown: null,
          isAnalysisPending: true,
        }) as never,
      )
      .mockResolvedValueOnce(
        completedResponse({
          analysisMarkdown: ANALYSIS,
          isAnalysisPending: false,
        }) as never,
      );

    renderPanel({ onAnalysisAvailable });
    await flush();

    expect(screen.getByText("Preparing investigation report…")).toBeVisible();
    expect(screen.getByText("Preparing the final report")).toBeVisible();
    expect(screen.queryByTestId("investigation-markdown")).toBeNull();
    expect(onAnalysisAvailable).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);

    /*
     * Status, run id and event count are deliberately unchanged. Only the
     * report fields differ, which catches a signature that ignores the
     * post-Completed payload transition.
     */
    await tick(POLL_INTERVAL_MS);

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The database connection pool was exhausted.",
    );
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    await tick(POLL_INTERVAL_MS * 4);
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
  });

  test("does not start another same-subject poll while a slow poll is in flight", async () => {
    const slowPoll: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(
        successfulResponse(
          investigationPayload({ status: AIRunStatus.Running }),
        ) as never,
      )
      .mockReturnValueOnce(slowPoll.promise as never)
      .mockResolvedValue(completedResponse() as never);

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    await tick(POLL_INTERVAL_MS);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Investigating…")).toBeVisible();

    /*
     * The real view pages construct a fresh ObjectID on every render. Its
     * stable string identity must not recreate fetchData or overlap polling.
     */
    view.rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={new ObjectID(INCIDENT_ID.toString())}
      />,
    );
    await flush();
    expect(postMock).toHaveBeenCalledTimes(2);

    /*
     * The response takes longer than the polling period. It must remain the
     * sole in-flight request instead of being invalidated by a newer poll.
     */
    await tick(POLL_INTERVAL_MS + 1);
    expect(postMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(slowPoll, completedResponse());

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The database connection pool was exhausted.",
    );
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("ignores a previous subject response after route navigation", async () => {
    const previousSubject: Deferred<ApiResponse> =
      createDeferred<ApiResponse>();
    postMock
      .mockReturnValueOnce(previousSubject.promise as never)
      .mockResolvedValueOnce(completedResponse() as never);

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(postRequestAt(1).data).toEqual({ alertId: ALERT_ID.toString() });

    await resolveDeferred(
      previousSubject,
      successfulResponse(investigationPayload({ status: AIRunStatus.Running })),
    );

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(screen.queryByText("Investigating…")).toBeNull();
  });

  test("does not notify a new subject with the previous subject's report", async () => {
    const nextSubject: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    const onAnalysisAvailable: MockFunction = getJestMockFunction();
    const nextSubjectAnalysis: string =
      "## Alert root cause\n\nThe upstream dependency rejected requests.";

    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockReturnValueOnce(nextSubject.promise as never);

    const view: ReturnType<typeof render> = renderPanel({
      onAnalysisAvailable,
    });
    await flush();

    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
    onAnalysisAvailable.mockClear();

    view.rerender(
      <InvestigationPanel
        subjectType="alert"
        subjectId={ALERT_ID}
        onAnalysisAvailable={onAnalysisAvailable}
      />,
    );
    await flush();

    expect(view.container).toBeEmptyDOMElement();
    expect(onAnalysisAvailable).not.toHaveBeenCalled();

    await resolveDeferred(
      nextSubject,
      completedResponse({
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        analysisMarkdown: nextSubjectAnalysis,
      }),
    );

    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The upstream dependency rejected requests.",
    );
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
    expect(postRequestAt(1).data).toEqual({ alertId: ALERT_ID.toString() });
  });

  test("shows the no-report outcome and disables analysis-only actions", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: null,
        isAnalysisPending: false,
        events: [],
        toolCallCount: 0,
        totalTokens: 0,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(
      screen.getByText("Investigation completed without a report"),
    ).toBeVisible();
    expect(
      screen.getByText("No investigation report was published."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeDisabled();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("shows a terminal failure without presenting completed actions", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Error,
          errorMessage: "The model provider timed out.",
          events: [activityEvent],
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByText("Investigation did not finish")).toBeVisible();
    expect(screen.getByText("The model provider timed out.")).toBeVisible();
    expect(lastActivityProps()).toEqual(
      expect.objectContaining({
        title: "Investigation activity",
        showLiveIndicator: false,
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeNull();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("uses the alert endpoint and alert id for an alert investigation", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({ status: AIRunStatus.Running }),
      ) as never,
    );

    renderPanel({ subjectType: "alert", subjectId: ALERT_ID });
    await flush();

    const request: PostRequest = postRequestAt(0);
    expect(request.url.toString()).toContain("/ai-investigation/alert");
    expect(request.data).toEqual({ alertId: ALERT_ID.toString() });
  });

  test("creates a fix task from the completed report", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      );

    renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Fix task created");
    expect(screen.getByText("View task progress")).toBeVisible();
    const request: PostRequest = postRequestAt(1);
    expect(request.url.toString()).toContain(
      "/ai-investigation/create-fix-task",
    );
    expect(request.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      aiRunId: RUN_ID,
    });
  });

  test("clears a successful fix task when navigating to another completed subject", async () => {
    const nextSubjectAnalysis: string =
      "## Alert root cause\n\nA deployment removed the required credential.";
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      )
      .mockResolvedValueOnce(
        completedResponse({
          runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          analysisMarkdown: nextSubjectAnalysis,
        }) as never,
      );

    const view: ReturnType<typeof render> = renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Fix task created");

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();

    expect(screen.queryByText(/Fix task created/)).toBeNull();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "A deployment removed the required credential.",
    );
    expect(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeEnabled();
    expect(postRequestAt(2).data).toEqual({ alertId: ALERT_ID.toString() });
  });

  test("resets fix-task and verdict state when the same subject gets a new completed run", async () => {
    const nextRunId: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const nextRunAnalysis: string =
      "## New root cause\n\nA later investigation found a certificate rollover.";
    postMock
      .mockResolvedValueOnce(
        completedResponse({ isAnalysisPending: false }) as never,
      )
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      )
      .mockResolvedValueOnce(successfulResponse({}) as never)
      .mockResolvedValueOnce(
        completedResponse({
          runId: nextRunId,
          analysisMarkdown: nextRunAnalysis,
          isAnalysisPending: false,
        }) as never,
      );

    renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Fix task created");
    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "A later investigation found a certificate rollover.",
    );
    expect(screen.queryByText(/Fix task created/)).toBeNull();
    expect(screen.queryByText(/You confirmed this analysis/)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
    expect(postMock).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("keeps the fix action available and explains a rejected task request", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          { message: "No connected repository exists." },
          {},
        ) as never,
      );

    renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not create the fix task",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No connected repository exists",
    );
    expect(
      screen.getByRole("button", {
        name: "Open Fix PR from this analysis",
      }),
    ).toBeEnabled();
  });

  test("persists a positive verdict and replaces the verdict buttons", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();

    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();
    const request: PostRequest = postRequestAt(1);
    expect(request.url.toString()).toContain("/ai-investigation/verdict");
    expect(request.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      aiRunId: RUN_ID,
      verdict: "Confirmed",
    });
  });

  test("a GET started before verdict save cannot overwrite the saved verdict", async () => {
    const stalePoll: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockReturnValueOnce(stalePoll.promise as never)
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel();
    await flush();

    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(postMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();
    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();

    await resolveDeferred(stalePoll, completedResponse({ humanVerdict: null }));

    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Confirmed" })).toBeNull();
  });

  test("rolls back an optimistic verdict when the save fails", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { message: "Verdict storage is unavailable." },
          {},
        ) as never,
      );

    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save your verdict",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verdict storage is unavailable.",
    );
    expect(screen.queryByText(/You rejected this analysis/)).toBeNull();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
  });
});
