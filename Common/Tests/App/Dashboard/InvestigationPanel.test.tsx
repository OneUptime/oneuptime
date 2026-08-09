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
 * InvestigationPanel joins three independently changing pieces of state: the
 * live AIRun, the report posted just after completion, and the persisted
 * recommendation that authorizes a code-fix action. These tests drive real
 * React effects and timers so completion, navigation, and request races stay
 * covered rather than testing only static snapshots.
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
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>) => {
        return getFriendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<unknown>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

/*
 * Record MarkdownViewer's props so safeMode remains an asserted part of the
 * contract even when the Common Jest config replaces its markdown renderer.
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
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
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
  analysisTldr?: string | null | undefined;
  isAnalysisPending?: boolean | undefined;
  errorMessage?: string | null | undefined;
  toolCallCount?: number | undefined;
  totalTokens?: number | undefined;
  humanVerdict?: string | null | undefined;
  codeFixRecommendation?: AIRunCodeFixRecommendation | undefined;
  completedAt?: string | undefined;
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
const RECOMMENDATION_SETTLEMENT_MAX_AGE_MS: number = 3 * 60 * 1000;
const MAX_RECOMMENDATION_POLL_RESPONSES: number = Math.ceil(
  RECOMMENDATION_SETTLEMENT_MAX_AGE_MS / POLL_INTERVAL_MS,
);
const COMPLETED_AT: string = "2026-08-07T12:00:00.000Z";
const OLD_COMPLETED_AT: string = "2026-08-07T11:56:59.000Z";
const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const FIX_RUN_ID: string = "22222222-2222-4222-8222-222222222222";
const NEXT_RUN_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const EVENT_ID: string = "55555555-5555-4555-8555-555555555555";
const ANALYSIS: string =
  "## Root cause\n\nThe database connection pool was exhausted.";
const TLDR: string =
  "Checkout is returning 500s because the database connection pool is exhausted.";

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

  if (options.codeFixRecommendation !== undefined) {
    run["codeFixRecommendation"] = options.codeFixRecommendation;
  }

  if (options.completedAt !== undefined) {
    run["completedAt"] = options.completedAt;
  }

  return {
    run,
    events: options.events || [],
    analysisMarkdown: options.analysisMarkdown ?? null,
    analysisTldr: options.analysisTldr ?? null,
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
      analysisTldr: null,
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
      codeFixRecommendation: AIRunCodeFixRecommendation.Recommended,
      completedAt: COMPLETED_AT,
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
  onStatusChange?: ((status: AIRunStatus | null) => void) | undefined;
}): ReturnType<typeof render> {
  return render(
    <InvestigationPanel
      subjectType={data?.subjectType || "incident"}
      subjectId={data?.subjectId || INCIDENT_ID}
      onAnalysisAvailable={data?.onAnalysisAvailable}
      onStatusChange={data?.onStatusChange}
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

async function advanceFastPolls(count: number = 1): Promise<void> {
  for (let index: number = 0; index < count; index++) {
    await tick(POLL_INTERVAL_MS);
  }
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

function requestPath(index: number): string {
  return postRequestAt(index).url.toString();
}

function fixButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: "Open Fix PR from this analysis",
  });
}

function lastActivityProps(): ActivityFeedProps {
  const calls: Array<Array<ActivityFeedProps>> = activityFeedMock.mock
    .calls as Array<Array<ActivityFeedProps>>;
  return calls[calls.length - 1]![0]!;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(COMPLETED_AT));
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

describe("InvestigationPanel report lifecycle", () => {
  test("renders nothing and briefly discovers a run when none exists yet", async () => {
    postMock.mockResolvedValue(noInvestigationResponse() as never);

    const { container } = renderPanel();
    await flush();

    expect(container).toBeEmptyDOMElement();
    expect(jest.getTimerCount()).toBe(1);

    await advanceFastPolls(4);
    expect(postMock).toHaveBeenCalledTimes(5);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("shows live activity and requests the incident endpoint", async () => {
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
    expect(
      document.querySelector('[class~="motion-safe:animate-ping"]'),
    ).not.toBeNull();

    const request: PostRequest = postRequestAt(0);
    expect(request.url.toString()).toContain("/ai-investigation/incident");
    expect(request.data).toEqual({ incidentId: INCIDENT_ID.toString() });
    expect(getCommonHeadersMock).toHaveBeenCalledTimes(1);
  });

  test("renders the completed report safely and demotes activity to a disclosure", async () => {
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
    expect(fixButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("keeps polling across Completed until the same run report appears", async () => {
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

    /* Status, run id, events and recommendation remain identical. */
    await tick(POLL_INTERVAL_MS);

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The database connection pool was exhausted.",
    );
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);

    await tick(POLL_INTERVAL_MS * 4);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("does not overlap a slow active-run poll", async () => {
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

    view.rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={new ObjectID(INCIDENT_ID.toString())}
      />,
    );
    await flush();
    await tick(POLL_INTERVAL_MS * 3);
    expect(postMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(slowPoll, completedResponse());
    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("ignores a previous subject response after route navigation", async () => {
    const previousSubject: Deferred<ApiResponse> =
      createDeferred<ApiResponse>();
    const statuses: Array<AIRunStatus | null> = [];
    postMock
      .mockReturnValueOnce(previousSubject.promise as never)
      .mockResolvedValueOnce(completedResponse() as never);

    const view: ReturnType<typeof render> = renderPanel({
      onStatusChange: (status: AIRunStatus | null): void => {
        statuses.push(status);
      },
    });
    await flush();

    view.rerender(
      <InvestigationPanel
        subjectType="alert"
        subjectId={ALERT_ID}
        onStatusChange={(status: AIRunStatus | null): void => {
          statuses.push(status);
        }}
      />,
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
    expect(statuses[statuses.length - 1]).toBe(AIRunStatus.Completed);
  });

  test("does not notify a new subject with the previous report", async () => {
    const nextSubject: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    const onAnalysisAvailable: MockFunction = getJestMockFunction();
    const nextAnalysis: string =
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
      completedResponse({ runId: NEXT_RUN_ID, analysisMarkdown: nextAnalysis }),
    );

    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The upstream dependency rejected requests.",
    );
    expect(onAnalysisAvailable).toHaveBeenCalledTimes(1);
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
    expect(fixButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeDisabled();
  });

  test("shows a terminal failure without completed actions", async () => {
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
    expect(fixButton()).toBeNull();
    expect(screen.queryByText("Rate this investigation")).toBeNull();
  });

  test("uses the alert endpoint and alert id", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({ status: AIRunStatus.Running }),
      ) as never,
    );

    renderPanel({ subjectType: "alert", subjectId: ALERT_ID });
    await flush();

    expect(requestPath(0)).toContain("/ai-investigation/alert");
    expect(postRequestAt(0).data).toEqual({ alertId: ALERT_ID.toString() });
  });
});

/*
 * The TL;DR is the first thing on the card, and it is AI prose about the
 * report below it. So it must never appear without that report, must never be
 * rendered as markdown, and must be dropped the instant the panel changes
 * subject — a summary of the previous incident is worse than no summary.
 */
describe("InvestigationPanel TL;DR", () => {
  function markdownTexts(): Array<string> {
    return (
      markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>
    ).map((call: Array<MarkdownViewerProps>): string => {
      return call[0]!.text;
    });
  }

  test("leads the completed card with the AI summary, as plain text above the report", async () => {
    postMock.mockResolvedValue(
      completedResponse({ analysisTldr: TLDR }) as never,
    );

    renderPanel();
    await flush();

    const summary: HTMLElement = screen.getByLabelText("Investigation summary");
    expect(summary).toHaveTextContent("TL;DR");
    expect(summary).toHaveTextContent(TLDR);

    // The summary is never routed through the markdown renderer.
    expect(markdownTexts().length).toBeGreaterThan(0);
    expect(
      markdownTexts().every((text: string): boolean => {
        return text === ANALYSIS;
      }),
    ).toBe(true);

    // It sits above the report it summarizes.
    const report: HTMLElement = screen.getByLabelText("Investigation report");
    expect(
      summary.compareDocumentPosition(report) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("omits the block for a run that has no stored summary", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    expect(screen.getByLabelText("Investigation report")).toBeInTheDocument();
    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.queryByText("TL;DR")).toBeNull();
  });

  test("omits a blank summary rather than rendering an empty banner", async () => {
    postMock.mockResolvedValue(
      completedResponse({ analysisTldr: "   \n  " }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
  });

  test("never shows a summary before the report it describes is published", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: null,
        analysisTldr: TLDR,
        isAnalysisPending: true,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.queryByText(TLDR)).toBeNull();
    expect(screen.getByText("Preparing the final report")).toBeVisible();
  });

  test("appears on the poll that publishes the report", async () => {
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          analysisMarkdown: null,
          analysisTldr: null,
          isAnalysisPending: true,
        }) as never,
      )
      .mockResolvedValue(completedResponse({ analysisTldr: TLDR }) as never);

    renderPanel();
    await flush();
    expect(screen.queryByLabelText("Investigation summary")).toBeNull();

    await advanceFastPolls();

    expect(screen.getByLabelText("Investigation summary")).toHaveTextContent(
      TLDR,
    );
  });

  test("is not shown for a run that never completed", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Error,
          analysisTldr: TLDR,
          errorMessage: "The provider timed out.",
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.getByText("The provider timed out.")).toBeVisible();
  });

  test("drops the previous subject's summary the moment the subject changes", async () => {
    const nextSubject: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(completedResponse({ analysisTldr: TLDR }) as never)
      .mockReturnValueOnce(nextSubject.promise as never);

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    expect(screen.getByLabelText("Investigation summary")).toBeInTheDocument();

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();

    expect(screen.queryByLabelText("Investigation summary")).toBeNull();

    await resolveDeferred(
      nextSubject,
      completedResponse({
        runId: NEXT_RUN_ID,
        analysisTldr: "The alert cleared on its own after the pod restarted.",
      }),
    );

    expect(screen.getByLabelText("Investigation summary")).toHaveTextContent(
      "The alert cleared on its own after the pod restarted.",
    );
  });
});

/*
 * The verdict prompt is a single question with two answers, so both choices
 * live in one labelled group; once answered it collapses to the recorded
 * verdict plus a way back. These tests pin that shape — the earlier suites
 * cover the request/optimistic-state contract behind it.
 */
describe("InvestigationPanel verdict control", () => {
  function verdictGroup(): HTMLElement | null {
    return screen.queryByRole("group", { name: "Rate this investigation" });
  }

  test("offers both verdicts inside one labelled group", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    const group: HTMLElement = verdictGroup()!;
    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rejected" }),
    ).toBeInTheDocument();
    expect(group).toContainElement(
      screen.getByRole("button", { name: "Confirmed" }),
    );
    expect(group).toContainElement(
      screen.getByRole("button", { name: "Rejected" }),
    );
  });

  test("collapses to the recorded verdict and back again through Change", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await flush();

    expect(verdictGroup()).toBeNull();
    expect(screen.getByText(/You rejected this analysis/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(verdictGroup()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
    // Reopening the prompt must not itself save anything.
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("locks both choices while a verdict is saving", async () => {
    const save: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockReturnValueOnce(save.promise as never);

    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();

    // Optimistic: the pill replaces the prompt immediately.
    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeDisabled();

    await resolveDeferred(save, successfulResponse({}));

    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
  });

  test("shows the run status as a badge in the card header", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
      "Investigation complete",
    );
  });
});

describe("InvestigationPanel code-fix recommendation", () => {
  test("shows the fix action only for an explicit Recommended decision", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    expect(fixButton()).toBeEnabled();
    expect(screen.getByText("Act on this investigation")).toBeVisible();
    expect(screen.getByText("Rate this investigation")).toBeVisible();
  });

  test("hides every fix-task element for NotRecommended but retains verdict controls", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(screen.queryByText("Act on this investigation")).toBeNull();
    expect(screen.queryByText(/Fix task created/)).toBeNull();
    expect(screen.getByText("Rate this investigation")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeEnabled();
  });

  test("fails closed for a legacy row with no recommendation or completion time", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: undefined,
        completedAt: undefined,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(screen.getByText("Rate this investigation")).toBeVisible();
    expect(jest.getTimerCount()).toBe(1);

    await advanceFastPolls(4);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("fails closed at fast cadence for an old row with no recommendation", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: undefined,
        completedAt: OLD_COMPLETED_AT,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(jest.getTimerCount()).toBe(1);

    await advanceFastPolls(4);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("polls a recent missing decision and reveals the action when it settles", async () => {
    postMock
      .mockResolvedValueOnce(
        completedResponse({ codeFixRecommendation: undefined }) as never,
      )
      .mockResolvedValueOnce(completedResponse() as never);

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(screen.getByText("Rate this investigation")).toBeVisible();
    expect(jest.getTimerCount()).toBe(2);

    await advanceFastPolls();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(fixButton()).toBeEnabled();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("applies Pending to Recommended when no other signature field changes", async () => {
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockResolvedValueOnce(completedResponse() as never);

    renderPanel();
    await flush();

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(fixButton()).toBeNull();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(2);

    await advanceFastPolls();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(fixButton()).toBeEnabled();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("does not present explicit Pending as an active investigation", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByText("Investigation complete")).toBeVisible();
    expect(screen.queryByText("Investigating…")).toBeNull();
    expect(
      document.querySelector('[class~="motion-safe:animate-ping"]'),
    ).toBeNull();
    expect(fixButton()).toBeNull();
  });

  test("tolerates a browser clock behind the server while Pending settles", async () => {
    jest.setSystemTime(new Date("2026-08-07T11:59:55.000Z"));
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockResolvedValueOnce(completedResponse() as never);

    renderPanel();
    await flush();
    expect(fixButton()).toBeNull();

    await advanceFastPolls();
    expect(fixButton()).toBeEnabled();
  });

  test("tolerates a browser clock ahead of the server for explicit Pending", async () => {
    jest.setSystemTime(new Date("2026-08-07T12:05:00.000Z"));
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockResolvedValueOnce(completedResponse() as never);

    renderPanel();
    await flush();
    expect(fixButton()).toBeNull();

    await advanceFastPolls();
    expect(fixButton()).toBeEnabled();
  });

  test("bounds a permanently Pending decision by time and response count", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(jest.getTimerCount()).toBe(2);

    await advanceFastPolls(MAX_RECOMMENDATION_POLL_RESPONSES);

    const callsAtSettlement: number = postMock.mock.calls.length;
    expect(callsAtSettlement).toBeGreaterThan(1);
    expect(callsAtSettlement).toBeLessThanOrEqual(
      MAX_RECOMMENDATION_POLL_RESPONSES + 1,
    );
    expect(fixButton()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(jest.getTimerCount()).toBe(1);

    await advanceFastPolls(4);
    expect(postMock).toHaveBeenCalledTimes(callsAtSettlement);
  });

  test("keeps Pending polls sequential when a response is slow", async () => {
    const slowPending: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockReturnValueOnce(slowPending.promise as never)
      .mockResolvedValueOnce(completedResponse() as never);

    renderPanel();
    await flush();
    await advanceFastPolls();
    expect(postMock).toHaveBeenCalledTimes(2);

    await advanceFastPolls(5);
    expect(postMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(
      slowPending,
      completedResponse({
        codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
      }),
    );
    await advanceFastPolls();

    expect(postMock).toHaveBeenCalledTimes(3);
    expect(fixButton()).toBeEnabled();
  });

  test("stops failed Pending polls at the independent deadline", async () => {
    const failedPoll: HTTPErrorResponse = new HTTPErrorResponse(
      503,
      { message: "temporarily unavailable" },
      {},
    );
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockResolvedValue(failedPoll as never);

    renderPanel();
    await flush();
    await advanceFastPolls(MAX_RECOMMENDATION_POLL_RESPONSES);

    const callsAtDeadline: number = postMock.mock.calls.length;
    expect(callsAtDeadline).toBeGreaterThan(1);
    expect(fixButton()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    await advanceFastPolls(4);
    expect(postMock).toHaveBeenCalledTimes(callsAtDeadline);
  });

  test("a hung Pending request never overlaps before or after the deadline", async () => {
    const hungPoll: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
        }) as never,
      )
      .mockReturnValueOnce(hungPoll.promise as never);

    renderPanel();
    await flush();
    await advanceFastPolls();
    expect(postMock).toHaveBeenCalledTimes(2);

    await tick(RECOMMENDATION_SETTLEMENT_MAX_AGE_MS);
    expect(fixButton()).toBeNull();
    expect(postMock).toHaveBeenCalledTimes(2);

    /* Settled cadence must reuse the still-hung request, not overlap it. */
    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(postMock).toHaveBeenCalledTimes(2);
  });
});

describe("InvestigationPanel completed actions", () => {
  test("creates a run-bound fix task and replaces the action with success", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      );

    renderPanel();
    await flush();
    fireEvent.click(fixButton()!);
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Fix task created");
    expect(fixButton()).toBeNull();
    expect(requestPath(1)).toContain("/ai-investigation/create-fix-task");
    expect(postRequestAt(1).data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      investigationRunId: RUN_ID,
    });
    expect(screen.getByText("View task progress")).toBeVisible();
  });

  test("keeps the Recommended action and shows a friendly task error", async () => {
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
    fireEvent.click(fixButton()!);
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not create the fix task",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No connected repository exists",
    );
    expect(fixButton()).toBeEnabled();
  });

  test("clears settled fix-task state after subject navigation", async () => {
    const nextAnalysis: string =
      "## Alert root cause\n\nA deployment removed the required credential.";
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      )
      .mockResolvedValueOnce(
        completedResponse({
          runId: NEXT_RUN_ID,
          analysisMarkdown: nextAnalysis,
        }) as never,
      );

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    fireEvent.click(fixButton()!);
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
    expect(fixButton()).toBeEnabled();
  });

  test("ignores a fix-task result that resolves on another subject", async () => {
    const staleTask: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockReturnValueOnce(staleTask.promise as never)
      .mockResolvedValueOnce(
        completedResponse({ runId: NEXT_RUN_ID }) as never,
      );

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    fireEvent.click(fixButton()!);
    await flush();

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();
    await resolveDeferred(
      staleTask,
      successfulResponse({ aiRunId: FIX_RUN_ID }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(fixButton()).toBeEnabled();
    expect(screen.getByText("Investigation complete")).toBeVisible();
  });

  test("resets fix-task and verdict state when the same subject gets a new run", async () => {
    const nextAnalysis: string =
      "## New root cause\n\nA later investigation found a certificate rollover.";
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValueOnce(
        successfulResponse({ aiRunId: FIX_RUN_ID }) as never,
      )
      .mockResolvedValueOnce(successfulResponse({}) as never)
      .mockResolvedValueOnce(
        completedResponse({
          runId: NEXT_RUN_ID,
          analysisMarkdown: nextAnalysis,
        }) as never,
      );

    renderPanel();
    await flush();
    fireEvent.click(fixButton()!);
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
    expect(fixButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
  });

  test("binds a verdict to the displayed run even without a fix recommendation", async () => {
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }) as never,
      )
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();

    expect(requestPath(1)).toContain("/ai-investigation/verdict");
    expect(postRequestAt(1).data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      investigationRunId: RUN_ID,
      verdict: "Confirmed",
    });
    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();
  });

  test("retains an existing verdict when a fix is not recommended", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        humanVerdict: "Confirmed",
      }) as never,
    );

    renderPanel();
    await flush();

    expect(fixButton()).toBeNull();
    expect(screen.getByText(/You confirmed this analysis/)).toBeVisible();
    expect(screen.getByText("Change")).toBeVisible();
    expect(screen.getByText("Rate this investigation")).toBeVisible();
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

  test("rolls back an optimistic verdict when save fails", async () => {
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

  test("ignores a verdict result that resolves after navigation", async () => {
    const staleVerdict: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(
        completedResponse({
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }) as never,
      )
      .mockReturnValueOnce(staleVerdict.promise as never)
      .mockResolvedValueOnce(
        completedResponse({
          runId: NEXT_RUN_ID,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        }) as never,
      );

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();
    await resolveDeferred(staleVerdict, successfulResponse({}));

    expect(screen.queryByText(/You confirmed this analysis/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeEnabled();
  });
});
