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
  within,
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
const widgetRendererMock: MockFunction = getJestMockFunction();

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
 * The recorded `inlineReferences` are the panel's own chip/link renderers, so
 * tests can call them and render what they return.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
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

/*
 * The feed owns "how many steps will this draw?", because several event
 * types only close a step an earlier event opened. The panel and its run
 * details ask it instead of counting raw events, so the mock has to answer
 * too. countActivityStepsMock lets a test make events and steps disagree —
 * the case that used to frame an empty box — and hasRenderableActivityMock
 * follows it by default, exactly as the real predicate does, so the two
 * exports can never contradict each other unless a test says so.
 */
const hasRenderableActivityMock: MockFunction = getJestMockFunction();
const countActivityStepsMock: MockFunction = getJestMockFunction();

// Evidence rows render through the chat widgets; their output is not under test.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (props: { widgets: Array<JSONObject> }): React.ReactElement => {
        widgetRendererMock(props);
        return React.createElement("div", { "data-testid": "evidence-widget" });
      },
    };
  },
);

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
      hasRenderableActivity: (events: Array<AIRunEvent>): boolean => {
        return hasRenderableActivityMock(events) as boolean;
      },
      countActivitySteps: (events: Array<AIRunEvent>): number => {
        return countActivityStepsMock(events) as number;
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
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import type { MarkdownInlineReferenceRenderers } from "../../../UI/Components/Markdown.tsx/InlineReferences";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
  inlineReferences?: MarkdownInlineReferenceRenderers | undefined;
}

interface ActivityFeedProps {
  events: Array<AIRunEvent>;
  title?: string | undefined;
  showLiveIndicator?: boolean | undefined;
  maxVisibleSteps?: number | undefined;
  hideChrome?: boolean | undefined;
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
  evidence?: JSONArray | undefined;
  references?: JSONArray | undefined;
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

  const payload: JSONObject = {
    run,
    events: options.events || [],
    analysisMarkdown: options.analysisMarkdown ?? null,
    analysisTldr: options.analysisTldr ?? null,
    isAnalysisPending: options.isAnalysisPending === true,
  };

  /*
   * Older API replicas omit these keys entirely, so they are only present
   * when a test asks for them.
   */
  if (options.evidence !== undefined) {
    payload["evidence"] = options.evidence;
  }

  if (options.references !== undefined) {
    payload["references"] = options.references;
  }

  return payload;
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
  onReportSummaryChange?: ((summary: string | null) => void) | undefined;
  onVerdictChange?: ((verdict: AIRunHumanVerdict | null) => void) | undefined;
}): ReturnType<typeof render> {
  return render(
    <InvestigationPanel
      subjectType={data?.subjectType || "incident"}
      subjectId={data?.subjectId || INCIDENT_ID}
      onAnalysisAvailable={data?.onAnalysisAvailable}
      onStatusChange={data?.onStatusChange}
      onReportSummaryChange={data?.onReportSummaryChange}
      onVerdictChange={data?.onVerdictChange}
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

/*
 * A completed run ends with one collapsed section holding its evidence, its
 * activity and what it cost. Its body stays mounted while collapsed, so the
 * role queries below (which skip hidden content) only find what a reader
 * could actually reach; tests open the section before reaching inside it.
 */
function runDetails(): HTMLElement {
  return screen.getByTestId("investigation-details");
}

function detailsToggle(): HTMLElement {
  return screen.getByTestId("investigation-details-toggle");
}

function detailsBody(): HTMLElement {
  const bodyId: string | null = detailsToggle().getAttribute("aria-controls");
  expect(bodyId).toBeTruthy();
  return document.getElementById(bodyId!)!;
}

function openDetails(): void {
  expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(detailsToggle());
  expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
}

function detailsTab(name: RegExp): HTMLElement {
  return within(
    screen.getByRole("tablist", { name: "Investigation details" }),
  ).getByRole("tab", { name });
}

function evidenceList(): HTMLElement {
  return screen.getByRole("list", { name: "Evidence checked" });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(COMPLETED_AT));
  getCommonHeadersMock.mockReturnValue({});
  /*
   * Default to the real component's behaviour for the ordinary event shapes
   * these tests use: every step-opening event draws a step, and there is
   * activity to render exactly when at least one step is drawn.
   */
  countActivityStepsMock.mockImplementation(
    (events: Array<AIRunEvent>): number => {
      return events.length;
    },
  );
  hasRenderableActivityMock.mockImplementation(
    (events: Array<AIRunEvent>): boolean => {
      return (countActivityStepsMock(events) as number) > 0;
    },
  );
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
  hasRenderableActivityMock.mockReset();
  countActivityStepsMock.mockReset();
  widgetRendererMock.mockReset();
});

describe("InvestigationPanel report lifecycle", () => {
  test("explains a missing run and briefly checks whether one appears", async () => {
    postMock.mockResolvedValue(noInvestigationResponse() as never);

    renderPanel();
    await flush();

    expect(
      screen.getByText("No investigation has been recorded"),
    ).toBeVisible();
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
    /*
     * The panel frames the feed itself, so the feed drops its own bubble and
     * heading — the "Investigating…" wording must appear exactly once.
     */
    expect(lastActivityProps().hideChrome).toBe(true);
    expect(screen.getAllByText("Investigating…")).toHaveLength(1);
    expect(
      document.querySelector('[class~="motion-safe:animate-ping"]'),
    ).not.toBeNull();

    const request: PostRequest = postRequestAt(0);
    expect(request.url.toString()).toContain("/ai-investigation/incident");
    expect(request.data).toEqual({ incidentId: INCIDENT_ID.toString() });
    expect(getCommonHeadersMock).toHaveBeenCalledTimes(1);
  });

  test("renders the completed report safely and folds its activity into a collapsed section", async () => {
    const onAnalysisAvailable: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel({ onAnalysisAvailable });
    await flush();

    expect(screen.getByText("Investigation complete")).toBeInTheDocument();
    expect(screen.getByLabelText("Investigation report")).toBeInTheDocument();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "The database connection pool was exhausted.",
    );
    /*
     * The report renders section by section: the "## Root cause" heading
     * becomes the section's own title and its body goes through the safe
     * viewer together with the panel's inline reference renderers.
     */
    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "The database connection pool was exhausted.",
      safeMode: true,
      inlineReferences: expect.objectContaining({
        renderCitation: expect.any(Function),
        renderEventReference: expect.any(Function),
      }),
    });
    expect(
      screen.getByRole("heading", { level: 4, name: "Root cause" }),
    ).toBeInTheDocument();
    /*
     * This report carries no evidence, so the section is only the activity
     * and is named for it. It starts collapsed: the report is the answer.
     */
    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).not.toBeVisible();
    expect(lastActivityProps()).toEqual(
      expect.objectContaining({
        hideChrome: true,
        showLiveIndicator: false,
      }),
    );

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toBeVisible();
    expect(usage).toHaveTextContent("2 telemetry queries");
    expect(usage).toHaveTextContent(
      "Read-only — nothing in your systems was changed",
    );
    expect(screen.getByLabelText("Model and tokens")).toHaveTextContent(
      "1,234 tokens",
    );
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
    // The steps can already be checked while the report is being written.
    expect(detailsToggle()).toHaveTextContent("Investigation activity");
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

    expect(screen.getByText("Checking investigation status…")).toBeVisible();
    expect(screen.queryByTestId("investigation-markdown")).toBeNull();
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
    /*
     * No steps were recorded, so the notice does not point at an activity
     * section that is not there, and there is nothing to expand: the run's
     * usage is all that is left to say.
     */
    expect(
      screen.getByText("The run finished without a final analysis."),
    ).toBeVisible();
    expect(screen.queryByText(/Investigation activity/)).toBeNull();
    expect(screen.queryByTestId("investigation-details-toggle")).toBeNull();
    expect(screen.getByLabelText("Investigation usage")).toHaveTextContent(
      "0 telemetry queries",
    );
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
    expect(
      screen.getByText("The investigation stopped before it could report."),
    ).toBeVisible();
    expect(
      screen.getByText("What the investigation got through"),
    ).toBeVisible();
    expect(lastActivityProps()).toEqual(
      expect.objectContaining({
        hideChrome: true,
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
 * Every state of the card has to stand on its own: a responder can land on it
 * while the run is queued, live, failed, or finished. These tests pin the
 * framing and the plain-language explanation each state owes the reader.
 */
describe("InvestigationPanel card states", () => {
  test("frames the live run and says what it is doing and that it cannot change anything", async () => {
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

    const live: HTMLElement = screen.getByLabelText("Live investigation");
    expect(live).toHaveTextContent("OneUptime AI is investigating");
    expect(live).toHaveTextContent("Read-only — nothing is changed");
    expect(live).toContainElement(screen.getByTestId("investigation-activity"));
  });

  test("explains the wait while the run is only queued", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({ status: AIRunStatus.Queued }),
      ) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByLabelText("Live investigation")).toHaveTextContent(
      "Waiting for a worker to pick this up",
    );
    expect(screen.getByText("Starting investigation…")).toBeVisible();
  });

  test("puts a copy control and a verify-first note on the report", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    const report: HTMLElement = screen.getByLabelText("Investigation report");
    expect(report).toHaveTextContent(
      "AI-generated first pass — verify before acting.",
    );
    expect(report).toContainElement(
      screen.getByRole("button", { name: "Copy report" }),
    );
  });

  /*
   * A queued run carries a stats object whose counts are all zero, so an
   * ungated strip would tell the reader the AI ran zero queries and changed
   * nothing — a past-tense report on work that has not started, directly
   * under "waiting for a worker".
   */
  test.each([AIRunStatus.Running, AIRunStatus.Queued])(
    "shows no usage strip while a %s run has not produced anything yet",
    async (status: AIRunStatus) => {
      postMock.mockResolvedValue(
        successfulResponse(
          investigationPayload({
            status,
            toolCallCount: 0,
            totalTokens: 0,
          }),
        ) as never,
      );

      renderPanel();
      await flush();

      expect(screen.queryByLabelText("Investigation usage")).toBeNull();
      expect(
        screen.queryByText(/nothing in your systems was changed/),
      ).toBeNull();
    },
  );

  /*
   * A failed run has no report and no collapsed details, so what it ran and
   * the read-only guarantee close its own activity frame instead — a reader
   * deciding whether a half-finished run touched anything finds the answer
   * right under the steps it took.
   */
  test("ends a failed run's activity with what it ran and that it changed nothing", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Error,
          errorMessage: "The model provider timed out.",
          events: [activityEvent],
          toolCallCount: 3,
          totalTokens: 900,
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    const activity: HTMLElement = screen.getByRole("region", {
      name: "Investigation activity",
    });
    const usage: HTMLElement = within(activity).getByRole("list", {
      name: "Investigation usage",
    });
    expect(activity.lastElementChild).toBe(usage);
    expect(usage).toBeVisible();
    expect(usage).toHaveTextContent("3 telemetry queries");
    expect(usage).toHaveTextContent("900 tokens");
    expect(usage).toHaveTextContent(
      "Read-only — nothing in your systems was changed",
    );
    expect(screen.queryByTestId("investigation-details")).toBeNull();
    expect(screen.getAllByLabelText("Investigation usage")).toHaveLength(1);
  });

  /*
   * Events and rendered steps are not the same thing: RunFailed and the
   * completion halves of tool/LLM calls only close a step an earlier event
   * opened. A run whose RunStarted failed to persist and then failed outright
   * carries one event and draws nothing, and counting raw events would frame
   * an empty panel instead of saying what happened.
   */
  test("explains an empty trail instead of framing a blank panel", async () => {
    countActivityStepsMock.mockReturnValue(0);
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Error,
          errorMessage: "The provider timed out.",
          events: [activityEvent],
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    expect(screen.queryByTestId("investigation-activity")).toBeNull();
    expect(
      screen.getByText("No investigation steps were recorded."),
    ).toBeVisible();
  });

  /*
   * The same event/step mismatch on a completed run: with no evidence and no
   * step to draw, a collapsed section would open onto nothing. The run's
   * usage is all there is, so it stands alone — tokens included, since there
   * is no body to hold them.
   */
  test("offers nothing to expand when a completed run has no evidence and no step would render", async () => {
    countActivityStepsMock.mockReturnValue(0);
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel();
    await flush();

    expect(screen.getByLabelText("Investigation report")).toBeInTheDocument();
    expect(screen.queryByText("Investigation activity")).toBeNull();
    expect(screen.queryByTestId("investigation-details-toggle")).toBeNull();
    expect(screen.queryByTestId("investigation-activity")).toBeNull();

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toBeVisible();
    expect(usage).toHaveTextContent("2 telemetry queries");
    expect(usage).toHaveTextContent("1,234 tokens");
    expect(usage).not.toHaveTextContent("step");
  });

  test("reports a single query and step without pluralising them", async () => {
    postMock.mockResolvedValue(
      completedResponse({ toolCallCount: 1, totalTokens: 0 }) as never,
    );

    renderPanel();
    await flush();

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toHaveTextContent("1 telemetry query");
    expect(usage).not.toHaveTextContent("queries");
    expect(usage).toHaveTextContent("1 step");
    expect(usage).not.toHaveTextContent("steps");
    expect(usage).not.toHaveTextContent("tokens");
  });

  /*
   * The no-report notice used to send every reader to "the activity below",
   * even when no step had been recorded and there was nothing below to read.
   */
  test("points the no-report notice at the activity only when there is some", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: null,
        isAnalysisPending: false,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(
      screen.getByText(
        "The run finished without a final analysis. Its steps are under Investigation activity below.",
      ),
    ).toBeVisible();

    /*
     * Evidence only exists beside a report, so the section is the activity
     * alone: named for it, and without tabs once opened.
     */
    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    expect(detailsToggle()).not.toHaveTextContent("Evidence");
    expect(screen.getByLabelText("Investigation usage")).toHaveTextContent(
      "2 telemetry queries",
    );

    openDetails();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(screen.getByTestId("investigation-activity")).toBeVisible();
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
      markdownTexts().some((text: string): boolean => {
        return text.includes(TLDR);
      }),
    ).toBe(false);

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

  /*
   * The report is recomputed from the feed on every poll, so it can vanish
   * (a deleted feed item) while the run stays Completed. The summary must go
   * with it — a summary of a report the reader cannot see is worse than none.
   * Cadence matters: a settled Recommended run polls at the SETTLED interval,
   * so advancing by the fast interval would make this pass vacuously.
   */
  test("drops the summary if the report it describes disappears on a later poll", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse({ analysisTldr: TLDR }) as never)
      .mockResolvedValue(
        completedResponse({
          analysisMarkdown: null,
          analysisTldr: TLDR,
        }) as never,
      );

    renderPanel();
    await flush();
    expect(screen.getByLabelText("Investigation summary")).toHaveTextContent(
      TLDR,
    );

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.queryByText(TLDR)).toBeNull();
  });

  /*
   * "Never attributed to the wrong run" — the same subject can be
   * re-investigated, and the previous run's summary must not survive onto the
   * new run's report.
   */
  test("does not carry a summary over to a new run on the same subject", async () => {
    const nextAnalysis: string = "## Root cause\n\nA second, different cause.";
    postMock
      .mockResolvedValueOnce(completedResponse({ analysisTldr: TLDR }) as never)
      .mockResolvedValue(
        completedResponse({
          runId: NEXT_RUN_ID,
          analysisMarkdown: nextAnalysis,
          analysisTldr: null,
        }) as never,
      );

    renderPanel();
    await flush();
    expect(screen.getByLabelText("Investigation summary")).toBeInTheDocument();

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(screen.queryByLabelText("Investigation summary")).toBeNull();
    expect(screen.queryByText(TLDR)).toBeNull();
    expect(screen.getByTestId("investigation-markdown")).toHaveTextContent(
      "A second, different cause.",
    );
  });

  /*
   * The module's threat model is "the worst a prompt injection achieves is a
   * misleading sentence". That holds only while the summary is rendered as
   * inert text — never as markdown, never as HTML.
   */
  test("renders hostile summary content inertly, as text", async () => {
    const hostile: string =
      '<img src=x onerror="window.__pwned = true"> **bold** [link](https://evil.example)';
    postMock.mockResolvedValue(
      completedResponse({ analysisTldr: hostile }) as never,
    );

    renderPanel();
    await flush();

    const summary: HTMLElement = screen.getByLabelText("Investigation summary");
    expect(summary).toHaveTextContent(hostile);
    expect(summary.querySelector("img")).toBeNull();
    expect(summary.querySelector("a")).toBeNull();
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned,
    ).toBeUndefined();
    // The summary never reaches the markdown renderer.
    expect(
      markdownTexts().some((text: string): boolean => {
        return text.includes("__pwned");
      }),
    ).toBe(false);
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

/*
 * The completed report is laid out for a responder: its Summary in a section
 * of its own, the report section by section, and every query the AI ran with
 * the rows behind it one click away. The payload's `evidence` and
 * `references` drive the interactive parts; older API replicas omit them and
 * the panel must fall back to the markdown alone.
 */
const PRIOR_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const PRIOR_ALERT_ID: string = "77777777-7777-4777-8777-777777777777";
const REPORT_SUMMARY: string =
  "the connection pool ran dry after the 18:00 deploy.";

const STRUCTURED_REPORT: string = [
  "## \u{1F9E0} AI — Automated Root Cause Analysis",
  "",
  "**Summary** — the connection pool ran dry after the 18:00 deploy [C1].",
  "",
  "**Most likely root cause** — the deploy halved the pool size; this matches prior #6954 [C2].",
  "",
  "**Suggested next steps**",
  "- Roll back the deploy",
  "",
  "**Evidence checked**",
  "- **[C1]** Active incidents (7 total) — 7 row(s)",
  "- **[C2]** Logs 17:20 – 18:20 (1 shown) — 1 row(s)",
  "",
  "---",
  "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry using gpt-5. This is an AI-generated first pass; verify before acting.*",
].join("\n");

const EVIDENCE_ITEMS: JSONArray = [
  {
    citationId: "C1",
    toolName: "query_incidents",
    label: "Active incidents (7 total)",
    rowCount: 7,
    durationInMs: 812,
    queryArguments: { state: "active" },
    target: { type: "Incidents" },
    executedAt: "2026-08-07T11:58:00.000Z",
    canLoadRows: true,
  },
  {
    citationId: "C2",
    toolName: "search_logs",
    label: "Logs 17:20 – 18:20 (1 shown)",
    rowCount: 1,
    queryArguments: { bodySearchText: "pool timeout" },
    target: { type: "Logs" },
    executedAt: "2026-08-07T11:59:00.000Z",
    canLoadRows: true,
  },
];

const REFERENCES: JSONArray = [
  {
    kind: "incident",
    number: 6954,
    id: PRIOR_INCIDENT_ID,
    displayNumber: "INC-6954",
    title: "Checkout pool exhausted",
    stateName: "Resolved",
  },
  {
    kind: "alert",
    number: 6954,
    id: PRIOR_ALERT_ID,
    displayNumber: "#6954",
    title: "Webhook failures",
  },
];

interface EvidencePostRequest extends PostRequest {
  headers?: JSONObject | undefined;
}

function structuredResponse(
  overrides: Partial<InvestigationPayloadOptions> = {},
): ApiResponse {
  return completedResponse({
    analysisMarkdown: STRUCTURED_REPORT,
    evidence: EVIDENCE_ITEMS,
    references: REFERENCES,
    ...overrides,
  });
}

function evidenceRowsResponse(citationId: string, text: string): ApiResponse {
  return successfulResponse({
    citationId,
    toolName: "query_incidents",
    label: "Active incidents (7 total)",
    rowCount: 7,
    isTruncated: false,
    executedAt: COMPLETED_AT,
    isPinnedToInvestigationTime: false,
    text,
  });
}

/*
 * Investigation polls and evidence re-runs share API.post, so route by URL:
 * the investigation handler answers the panel's own endpoint and the evidence
 * handler (default: never resolves) answers /ai-investigation/evidence.
 */
function routePosts(handlers: {
  investigation: (request: EvidencePostRequest) => unknown;
  evidence?: ((request: EvidencePostRequest) => unknown) | undefined;
}): void {
  postMock.mockImplementation((request: unknown): unknown => {
    const typedRequest: EvidencePostRequest = request as EvidencePostRequest;

    if (typedRequest.url.toString().includes("/ai-investigation/evidence")) {
      return handlers.evidence
        ? handlers.evidence(typedRequest)
        : new Promise<never>(() => {});
    }

    return handlers.investigation(typedRequest);
  });
}

function evidencePosts(): Array<EvidencePostRequest> {
  return (postMock.mock.calls as Array<Array<EvidencePostRequest>>)
    .map((call: Array<EvidencePostRequest>): EvidencePostRequest => {
      return call[0]!;
    })
    .filter((request: EvidencePostRequest): boolean => {
      return request.url.toString().includes("/ai-investigation/evidence");
    });
}

function investigationPostCount(): number {
  return postMock.mock.calls.length - evidencePosts().length;
}

function lastInlineReferences(): MarkdownInlineReferenceRenderers {
  const calls: Array<Array<MarkdownViewerProps>> = markdownViewerMock.mock
    .calls as Array<Array<MarkdownViewerProps>>;
  return calls[calls.length - 1]![0]!.inlineReferences!;
}

function allMarkdownProps(): Array<MarkdownViewerProps> {
  return (
    markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>
  ).map((call: Array<MarkdownViewerProps>): MarkdownViewerProps => {
    return call[0]!;
  });
}

describe("InvestigationPanel structured report", () => {
  const scrollIntoViewMock: MockFunction = getJestMockFunction();

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset();
    delete (Element.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
  });

  test("lifts the report's Summary into its own section above the report", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    const summary: HTMLElement = screen.getByRole("region", {
      name: "Investigation summary",
    });
    expect(summary).toHaveTextContent(
      "the connection pool ran dry after the 18:00 deploy [C1].",
    );
    expect(within(summary).queryByText("TL;DR")).toBeNull();

    const report: HTMLElement = screen.getByRole("region", {
      name: "Investigation report",
    });
    expect(
      within(report)
        .getAllByRole("heading", { level: 4 })
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual(["Most likely root cause", "Suggested next steps"]);
    expect(report).not.toHaveTextContent("the connection pool ran dry");
    expect(
      summary.compareDocumentPosition(report) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const props of allMarkdownProps()) {
      expect(props.safeMode).toBe(true);
      expect(props.text).not.toContain("Automated Root Cause Analysis");
      expect(props.text).not.toContain("Evidence checked");
      expect(props.text).not.toContain("Investigated automatically");
    }
  });

  test("renders the evidence the API returns, below the report", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    expect(
      screen
        .getByLabelText("Investigation report")
        .compareDocumentPosition(runDetails()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    openDetails();

    // The tab carries the query count the old list header used to show.
    expect(detailsTab(/^Evidence checked/)).toHaveTextContent(
      "Evidence checked2",
    );
    const evidence: HTMLElement = evidenceList();
    expect(runDetails()).toContainElement(evidence);
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(evidence).getByRole("button", { name: /Active incidents/ }),
    ).toHaveAttribute("aria-expanded", "false");
    // Rendering evidence never re-runs anything by itself.
    expect(evidencePosts()).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("expanding a query POSTs its citation once and shows the rows", async () => {
    routePosts({
      investigation: (): unknown => {
        return Promise.resolve(structuredResponse());
      },
      evidence: (): unknown => {
        return Promise.resolve(
          evidenceRowsResponse("C1", "id | title\n1 | Checkout down"),
        );
      },
    });

    renderPanel();
    await flush();
    openDetails();

    const toggle: HTMLElement = screen.getByRole("button", {
      name: /Active incidents \(7 total\)/,
    });
    fireEvent.click(toggle);
    await flush();

    expect(evidencePosts()).toHaveLength(1);
    expect(evidencePosts()[0]!.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      investigationRunId: RUN_ID,
      citationId: "C1",
    });
    expect(screen.getByText(/Checkout down/)).toBeVisible();

    // Collapse and re-open: served from the cache.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await flush();

    expect(evidencePosts()).toHaveLength(1);
    expect(investigationPostCount()).toBe(1);
  });

  test("falls back to the report's own Evidence checked list for an older API", async () => {
    postMock.mockResolvedValue(
      completedResponse({ analysisMarkdown: STRUCTURED_REPORT }) as never,
    );

    renderPanel();
    await flush();
    openDetails();

    const evidence: HTMLElement = evidenceList();
    expect(detailsTab(/^Evidence checked/)).toHaveTextContent(
      "Evidence checked2",
    );
    expect(evidence).toHaveTextContent("Active incidents (7 total)");
    expect(evidence).toHaveTextContent("Logs 17:20 – 18:20 (1 shown)");
    expect(within(evidence).queryAllByRole("button")).toHaveLength(0);
    // No references from an older API, so numbers stay plain text.
    expect(
      lastInlineReferences().renderEventReference!({
        kind: null,
        number: 6954,
        text: "#6954",
      }),
    ).toBeNull();
  });

  test("picks up evidence that arrives on a later poll", async () => {
    postMock
      .mockResolvedValueOnce(
        completedResponse({ analysisMarkdown: STRUCTURED_REPORT }) as never,
      )
      .mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();
    openDetails();
    expect(within(evidenceList()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(evidenceList()).queryAllByRole("button")).toHaveLength(0);

    await tick(SETTLED_POLL_INTERVAL_MS);

    // Still open on the same list, now with a toggle per query.
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(evidenceList()).getAllByRole("button")).toHaveLength(2);
  });

  test("never shows evidence without the report it belongs to", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: null,
        isAnalysisPending: true,
        evidence: EVIDENCE_ITEMS,
        references: REFERENCES,
      }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByText("Preparing the final report")).toBeVisible();
    expect(screen.queryByLabelText("Evidence checked")).toBeNull();

    // The section still offers the run's steps, and only those.
    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    openDetails();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(screen.getByTestId("investigation-activity")).toBeVisible();
  });

  test("drops evidence when the report disappears on a later poll", async () => {
    postMock
      .mockResolvedValueOnce(structuredResponse() as never)
      .mockResolvedValue(
        structuredResponse({ analysisMarkdown: null }) as never,
      );

    renderPanel();
    await flush();
    expect(screen.getByLabelText("Evidence checked")).toBeInTheDocument();
    expect(detailsToggle()).toHaveTextContent("Evidence and activity");

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    expect(
      screen.getByText("No investigation report was published."),
    ).toBeVisible();
  });

  test("ignores malformed evidence and references from the API", async () => {
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: STRUCTURED_REPORT,
        evidence: [
          { citationId: "not-a-citation", toolName: "search_logs" },
          { citationId: "C1" },
        ] as unknown as JSONArray,
        references: [
          { kind: "incident", number: 6954, id: "javascript:alert(1)" },
        ] as unknown as JSONArray,
      }) as never,
    );

    renderPanel();
    await flush();
    openDetails();

    // Nothing valid survived, so the legacy list and plain numbers are used.
    expect(within(evidenceList()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(evidenceList()).queryAllByRole("button")).toHaveLength(0);
    expect(
      lastInlineReferences().renderEventReference!({
        kind: "incident",
        number: 6954,
        text: "#6954",
      }),
    ).toBeNull();
  });

  /*
   * The report's chips are rendered by the markdown viewer, which is mocked
   * here, so render the panel's own chip renderer output and click it the
   * way a reader would.
   */
  function clickCitation(citationId: string, name: string): void {
    const chip: React.ReactElement | null =
      lastInlineReferences().renderCitation!(citationId);
    expect(chip).not.toBeNull();
    render(chip!);

    const chipButton: HTMLElement = screen.getByRole("button", { name });
    fireEvent.click(chipButton);
  }

  /*
   * The evidence sits in a section that starts collapsed, so a chip that only
   * highlighted its row would highlight something nobody can see. The chip
   * has to open the section on the Evidence tab first.
   */
  test("a citation chip opens the collapsed details and expands, scrolls to and highlights its row", async () => {
    routePosts({
      investigation: (): unknown => {
        return Promise.resolve(structuredResponse());
      },
    });

    renderPanel();
    await flush();
    expect(jest.getTimerCount()).toBe(1);
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).not.toBeVisible();

    const chip: React.ReactElement | null =
      lastInlineReferences().renderCitation!("C2");
    expect(chip).not.toBeNull();
    render(chip!);

    const chipButton: HTMLElement = screen.getByRole("button", {
      name: "Citation C2: Logs 17:20 – 18:20 (1 shown)",
    });
    expect(chipButton).toHaveAttribute("title", "Logs 17:20 – 18:20 (1 shown)");

    fireEvent.click(chipButton);
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(detailsBody()).toBeVisible();
    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const toggle: HTMLElement = within(evidenceList()).getByRole("button", {
      name: /Logs 17:20/,
    });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    expect(toggle.closest("li")).toHaveAttribute("data-highlighted", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
    expect(evidencePosts()).toHaveLength(1);
    expect(evidencePosts()[0]!.data["citationId"]).toBe("C2");
    // The settled poll plus the single highlight timer.
    expect(jest.getTimerCount()).toBe(2);

    await tick(2000);

    expect(toggle.closest("li")).not.toHaveAttribute("data-highlighted");
    expect(jest.getTimerCount()).toBe(1);
    // The highlight fades; the section the reader was taken to stays open.
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
  });

  test("a citation chip switches an open section from Activity to Evidence", async () => {
    routePosts({
      investigation: (): unknown => {
        return Promise.resolve(structuredResponse());
      },
    });

    renderPanel();
    await flush();
    openDetails();
    fireEvent.click(detailsTab(/^Activity/));
    expect(screen.getByTestId("investigation-activity")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();

    clickCitation("C1", "Citation C1: Active incidents (7 total)");
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(detailsTab(/^Activity/)).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("investigation-activity")).not.toBeVisible();

    const toggle: HTMLElement = within(evidenceList()).getByRole("button", {
      name: /Active incidents/,
    });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    expect(toggle.closest("li")).toHaveAttribute("data-highlighted", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  /*
   * An older API sends no structured evidence, so the report's own list is
   * shown and its rows have no toggle. The row itself takes focus, or a
   * keyboard or screen-reader user would be left on the chip.
   */
  test("a citation chip on an older report reveals and focuses its plain row", async () => {
    postMock.mockResolvedValue(
      completedResponse({ analysisMarkdown: STRUCTURED_REPORT }) as never,
    );

    renderPanel();
    await flush();
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");

    clickCitation("C2", "Citation C2: Logs 17:20 – 18:20 (1 shown)");
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const row: HTMLElement = within(evidenceList())
      .getAllByRole("listitem")
      .find((item: HTMLElement): boolean => {
        return item.textContent?.includes("Logs 17:20") === true;
      })!;
    expect(row).toBeVisible();
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    // A plain row has nothing to re-run.
    expect(evidencePosts()).toHaveLength(0);
  });

  /*
   * A chip's request lives in the panel, so it outlives the evidence list
   * when the report briefly disappears between polls. When the list comes
   * back it must not replay that old request — scrolling the page and
   * stealing focus with no click behind it.
   */
  test("does not replay a chip when the evidence comes back on a later poll", async () => {
    let investigationCalls: number = 0;
    routePosts({
      investigation: (): unknown => {
        investigationCalls += 1;
        return Promise.resolve(
          investigationCalls === 2
            ? structuredResponse({ analysisMarkdown: null })
            : structuredResponse(),
        );
      },
    });

    renderPanel();
    await flush();
    clickCitation("C2", "Citation C2: Logs 17:20 – 18:20 (1 shown)");
    await flush();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    await tick(2000);

    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(screen.queryByLabelText("Evidence checked")).toBeNull();
    expect(screen.getByTestId("investigation-activity")).toBeVisible();

    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(investigationPostCount()).toBe(3);

    const toggle: HTMLElement = within(evidenceList()).getByRole("button", {
      name: /Logs 17:20/,
    });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveFocus();
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(evidencePosts()).toHaveLength(1);
  });

  test("a new run on the same subject starts collapsed, even after a chip opened the last one", async () => {
    let investigationCalls: number = 0;
    routePosts({
      investigation: (): unknown => {
        investigationCalls += 1;
        return Promise.resolve(
          investigationCalls === 1
            ? structuredResponse()
            : structuredResponse({ runId: NEXT_RUN_ID }),
        );
      },
    });

    renderPanel();
    await flush();
    clickCitation("C2", "Citation C2: Logs 17:20 – 18:20 (1 shown)");
    await flush();
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(investigationPostCount()).toBe(2);
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).not.toBeVisible();

    openDetails();

    expect(
      within(evidenceList()).getByRole("button", { name: /Logs 17:20/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  test("leaves a citation that is not in the evidence as plain text", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    expect(lastInlineReferences().renderCitation!("C9")).toBeNull();
    expect(lastInlineReferences().renderCitation!("C1")).not.toBeNull();
  });

  test("links a referenced incident number to that incident", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    const link: React.ReactElement | null = lastInlineReferences()
      .renderEventReference!({
      kind: null,
      number: 6954,
      text: "#6954",
    });
    expect(link).not.toBeNull();
    render(link!);

    const anchor: HTMLElement = screen.getByRole("link", {
      name: "INC-6954 · Checkout pool exhausted · Resolved",
    });
    expect(anchor).toHaveTextContent("#6954");
    expect(anchor.getAttribute("href")).toMatch(
      new RegExp(`/incidents/${PRIOR_INCIDENT_ID}$`),
    );
    expect(
      lastInlineReferences().renderEventReference!({
        kind: "incident",
        number: 1,
        text: "#1",
      }),
    ).toBeNull();
  });

  test("resolves an unqualified number as an alert on an alert investigation", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel({ subjectType: "alert", subjectId: ALERT_ID });
    await flush();

    const link: React.ReactElement | null = lastInlineReferences()
      .renderEventReference!({
      kind: null,
      number: 6954,
      text: "#6954",
    });
    render(link!);

    expect(
      screen
        .getByRole("link", { name: "#6954 · Webhook failures" })
        .getAttribute("href"),
    ).toMatch(new RegExp(`/alerts/${PRIOR_ALERT_ID}$`));
  });

  test("ignores evidence rows that resolve after navigating to another subject", async () => {
    const staleRows: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    let evidenceCalls: number = 0;
    routePosts({
      investigation: (request: EvidencePostRequest): unknown => {
        return Promise.resolve(
          request.data["alertId"]
            ? structuredResponse({ runId: NEXT_RUN_ID })
            : structuredResponse(),
        );
      },
      evidence: (): unknown => {
        evidenceCalls += 1;
        return evidenceCalls === 1
          ? staleRows.promise
          : Promise.resolve(
              evidenceRowsResponse("C1", "id | title\n9 | Alert subject rows"),
            );
      },
    });

    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    openDetails();
    fireEvent.click(
      screen.getByRole("button", { name: /Active incidents \(7 total\)/ }),
    );
    await flush();
    expect(evidencePosts()).toHaveLength(1);

    view.rerender(
      <InvestigationPanel subjectType="alert" subjectId={ALERT_ID} />,
    );
    await flush();
    await resolveDeferred(
      staleRows,
      evidenceRowsResponse("C1", "id | title\n1 | Previous subject rows"),
    );

    expect(screen.queryByText(/Previous subject rows/)).toBeNull();
    // The new subject's details start collapsed like any other.
    openDetails();
    const toggle: HTMLElement = screen.getByRole("button", {
      name: /Active incidents \(7 total\)/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    await flush();

    expect(screen.getByText(/Alert subject rows/)).toBeVisible();
    expect(screen.queryByText(/Previous subject rows/)).toBeNull();
    expect(evidencePosts()[1]!.data).toEqual({
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
      investigationRunId: NEXT_RUN_ID,
      citationId: "C1",
    });
  });

  test("renders a hostile report only through the safe viewer", async () => {
    const hostile: string = [
      '**Summary** — <img src=x onerror="window.__panelPwned = true"> [click](https://evil.example)',
      "",
      "**Most likely root cause** — ![pixel](https://evil.example/p.png) [C1]",
      "",
      "[C1]: https://evil.example/exfil",
    ].join("\n");
    postMock.mockResolvedValue(
      structuredResponse({ analysisMarkdown: hostile }) as never,
    );

    const { container } = renderPanel();
    await flush();

    expect(allMarkdownProps().length).toBeGreaterThan(0);
    for (const props of allMarkdownProps()) {
      expect(props.safeMode).toBe(true);
    }
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(
      (window as unknown as { __panelPwned?: boolean }).__panelPwned,
    ).toBeUndefined();
  });

  /*
   * Collapsed, the header answers "what did it do, and did it touch
   * anything?". What the run cost and which model wrote the report are for
   * the reader who opens the details, and the verify-first note belongs on
   * the report it qualifies.
   */
  test("names the model and its tokens inside the details, not in the collapsed header", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toBeVisible();
    expect(usage).toHaveTextContent("2 telemetry queries");
    expect(usage).not.toHaveTextContent("tokens");
    expect(usage).not.toHaveTextContent("gpt-5");

    const cost: HTMLElement = screen.getByLabelText("Model and tokens");
    expect(detailsBody()).toContainElement(cost);
    expect(cost).not.toBeVisible();
    expect(cost).toHaveTextContent("1,234 tokens");
    expect(cost).toHaveTextContent("Model gpt-5");
    // Counts and the guarantee are already in the header; no repeats.
    expect(cost).not.toHaveTextContent("telemetry");
    expect(cost).not.toHaveTextContent("Read-only");

    openDetails();

    expect(screen.getByRole("list", { name: "Model and tokens" })).toBe(cost);
    expect(cost).toBeVisible();
    expect(screen.getByLabelText("Investigation report")).toHaveTextContent(
      "AI-generated first pass — verify before acting.",
    );
  });

  test("does not ask to verify a report that does not exist", async () => {
    postMock.mockResolvedValue(
      successfulResponse(
        investigationPayload({
          status: AIRunStatus.Error,
          errorMessage: "The provider timed out.",
          toolCallCount: 3,
        }),
      ) as never,
    );

    renderPanel();
    await flush();

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toHaveTextContent("3 telemetry queries");
    expect(usage).not.toHaveTextContent("Model");
    expect(screen.queryByText(/verify before acting/)).toBeNull();
    expect(screen.queryByLabelText("Model and tokens")).toBeNull();
  });

  test("titles the act and rate blocks with headings instead of icon-in-paragraph", async () => {
    postMock.mockResolvedValue(completedResponse() as never);

    const { container } = renderPanel();
    await flush();

    expect(
      screen.getByRole("heading", { name: "Act on this investigation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Rate this investigation" }),
    ).toBeVisible();
    expect(container.querySelectorAll("p div")).toHaveLength(0);
  });
});

/*
 * "Evidence checked", "Investigation activity" and the usage strip used to be
 * three stacked boxes under the report. They are now one section that starts
 * collapsed: the report is the answer, this is its working. Collapsed, it
 * still has to say what the run did and that it changed nothing, because a
 * responder asks that before trusting the report at all.
 */
describe("InvestigationPanel run details", () => {
  function tabNames(): Array<string> {
    return within(
      screen.getByRole("tablist", { name: "Investigation details" }),
    )
      .getAllByRole("tab")
      .map((tab: HTMLElement): string => {
        return tab.textContent || "";
      });
  }

  test("starts collapsed and still says what the run did in its header", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();

    const section: HTMLElement = screen.getByRole("region", {
      name: "Evidence and activity",
    });
    expect(section).toBe(runDetails());

    /*
     * The toggle is named by the title alone: the usage line beside it is
     * not part of the button, so a screen reader hears a short name.
     */
    const toggle: HTMLElement = within(section).getByRole("button", {
      name: "Evidence and activity",
    });
    expect(toggle).toBe(detailsToggle());
    expect(
      within(section).getByRole("heading", {
        level: 3,
        name: "Evidence and activity",
      }),
    ).toContainElement(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).not.toBeVisible();
    expect(section).toContainElement(detailsBody());
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
    expect(screen.getByTestId("investigation-activity")).not.toBeVisible();

    const usage: HTMLElement = within(section).getByRole("list", {
      name: "Investigation usage",
    });
    expect(usage).toBeVisible();
    expect(
      within(usage)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([
      "2 telemetry queries",
      "1 step",
      "Read-only — nothing in your systems was changed",
    ]);
  });

  /*
   * The run's tool-call count also includes calls that failed and never
   * became evidence. Inside a section whose Evidence tab lists the queries,
   * the header has to count the same queries, or the two numbers a reader
   * sees side by side disagree. Without evidence the run's own count is all
   * there is.
   */
  test("counts the queries the Evidence tab lists, not the run's raw call count", async () => {
    postMock
      .mockResolvedValueOnce(structuredResponse({ toolCallCount: 3 }) as never)
      .mockResolvedValue(
        structuredResponse({ toolCallCount: 3, evidence: [] }) as never,
      );

    renderPanel();
    await flush();

    expect(screen.getByLabelText("Investigation usage")).toHaveTextContent(
      "2 telemetry queries",
    );
    openDetails();
    expect(detailsTab(/^Evidence checked/)).toHaveTextContent(
      "Evidence checked2",
    );

    /*
     * An older API: the report's own list still names the queries, so the
     * header follows it rather than the raw call count.
     */
    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(within(evidenceList()).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByLabelText("Investigation usage")).toHaveTextContent(
      "2 telemetry queries",
    );
  });

  test("falls back to the run's call count when there is no evidence at all", async () => {
    postMock.mockResolvedValue(
      completedResponse({ toolCallCount: 3 }) as never,
    );

    renderPanel();
    await flush();

    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    expect(screen.getByLabelText("Investigation usage")).toHaveTextContent(
      "3 telemetry queries",
    );
  });

  test("opening reveals the tabs and the evidence list, and closing hides them again", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();
    openDetails();

    expect(detailsBody()).toBeVisible();
    expect(tabNames()).toEqual(["Evidence checked2", "Activity1"]);

    const evidenceTab: HTMLElement = detailsTab(/^Evidence checked/);
    expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    expect(evidenceTab).toHaveAttribute("tabindex", "0");
    expect(detailsTab(/^Activity/)).toHaveAttribute("aria-selected", "false");
    expect(detailsTab(/^Activity/)).toHaveAttribute("tabindex", "-1");

    // Only the selected panel is reachable, and it is named by its tab.
    const panel: HTMLElement = screen.getByRole("tabpanel");
    expect(panel).toBe(
      screen.getByRole("tabpanel", { name: /^Evidence checked/ }),
    );
    expect(evidenceTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("tabindex", "0");
    expect(panel).toContainElement(evidenceList());
    expect(
      within(evidenceList()).getByRole("button", { name: /Active incidents/ }),
    ).toBeVisible();
    expect(
      within(evidenceList()).getByRole("button", { name: /Logs 17:20/ }),
    ).toBeVisible();
    expect(screen.getByTestId("investigation-activity")).not.toBeVisible();

    fireEvent.click(detailsToggle());

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).not.toBeVisible();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
    // The header's summary does not depend on the body being open.
    expect(screen.getByLabelText("Investigation usage")).toBeVisible();
  });

  test("switches between the evidence and activity tabs", async () => {
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();
    openDetails();

    fireEvent.click(detailsTab(/^Activity/));

    expect(detailsTab(/^Activity/)).toHaveAttribute("aria-selected", "true");
    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "false",
    );
    const activityPanel: HTMLElement = screen.getByRole("tabpanel", {
      name: /^Activity/,
    });
    expect(activityPanel).toContainElement(
      screen.getByTestId("investigation-activity"),
    );
    expect(screen.getByTestId("investigation-activity")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();

    // The footer belongs to the body, not to one tab.
    expect(
      screen.getByRole("list", { name: "Model and tokens" }),
    ).toBeVisible();

    fireEvent.click(detailsTab(/^Evidence checked/));

    expect(evidenceList()).toBeVisible();
    expect(screen.getByTestId("investigation-activity")).not.toBeVisible();
  });

  /*
   * The old disclosure advertised the raw event count and showed only the
   * last ten steps. Several event types only close a step, so the count the
   * reader sees has to be the steps the feed draws — and a finished run is
   * short enough to show its whole trail.
   */
  test("counts the steps the feed draws and shows the whole finished trail", async () => {
    const events: JSONArray = [];

    for (let index: number = 0; index < 24; index++) {
      events.push({
        _id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
        sequence: index + 1,
        eventType:
          index % 2 === 0
            ? AIRunEventType.ToolCallStarted
            : AIRunEventType.ToolCallCompleted,
        toolName: "search_logs",
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
      });
    }

    countActivityStepsMock.mockReturnValue(12);
    postMock.mockResolvedValue(structuredResponse({ events }) as never);

    renderPanel();
    await flush();

    const usage: HTMLElement = screen.getByLabelText("Investigation usage");
    expect(usage).toHaveTextContent("12 steps");
    expect(usage).not.toHaveTextContent("24");

    openDetails();

    expect(tabNames()).toEqual(["Evidence checked2", "Activity12"]);
    expect(lastActivityProps().events).toHaveLength(24);
    expect(lastActivityProps()).toEqual(
      expect.objectContaining({
        hideChrome: true,
        showLiveIndicator: false,
        maxVisibleSteps: 12,
      }),
    );
  });

  /*
   * Evidence can land on a later poll than the report. A reader who opened
   * the section onto the activity is reading it; the arriving evidence adds
   * a tab beside it rather than yanking the view to the new first tab.
   */
  test("keeps a reader on the activity when evidence arrives after they opened it", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();
    openDetails();

    expect(detailsToggle()).toHaveTextContent("Investigation activity");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("investigation-activity")).toBeVisible();

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(detailsToggle()).toHaveTextContent("Evidence and activity");
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(tabNames()).toEqual(["Evidence checked2", "Activity1"]);
    expect(detailsTab(/^Activity/)).toHaveAttribute("aria-selected", "true");
    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByTestId("investigation-activity")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
  });

  /*
   * The counterpart: nobody has looked yet, so there is nothing to keep, and
   * the section opens on the evidence like any report that has some.
   */
  test("opens on the evidence when it arrived before the reader looked", async () => {
    postMock
      .mockResolvedValueOnce(completedResponse() as never)
      .mockResolvedValue(structuredResponse() as never);

    renderPanel();
    await flush();
    await tick(SETTLED_POLL_INTERVAL_MS);
    openDetails();

    expect(detailsTab(/^Evidence checked/)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(evidenceList()).toBeVisible();
  });
});

describe("InvestigationPanel report summary callback", () => {
  function nonNullCalls(callback: MockFunction): Array<unknown> {
    return callback.mock.calls
      .map((call: Array<unknown>): unknown => {
        return call[0];
      })
      .filter((value: unknown): boolean => {
        return value !== null;
      });
  }

  test("reports the TL;DR of a completed report", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({ analysisTldr: TLDR }) as never,
    );

    renderPanel({ onReportSummaryChange });
    await flush();

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(TLDR);
    expect(nonNullCalls(onReportSummaryChange)).toEqual([TLDR]);
  });

  test("falls back to the report's Summary as plain text without a TL;DR", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel({ onReportSummaryChange });
    await flush();

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(REPORT_SUMMARY);
  });

  test("bounds a long Summary", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      completedResponse({
        analysisMarkdown: `**Summary** — ${"pool exhausted ".repeat(60)}\n\n**Root cause** — a deploy.`,
      }) as never,
    );

    renderPanel({ onReportSummaryChange });
    await flush();

    const summary: string = nonNullCalls(onReportSummaryChange)[0] as string;
    // Bounded by the analysisTldr column; the header clamps it on screen.
    expect(summary.length).toBeLessThanOrEqual(500);
    expect(summary.length).toBeGreaterThan(280);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("reports a TL;DR at the server's 320-character cap whole", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    const longTldr: string =
      "checkout-api release 2026.09.14-2 restarted at 17:52:04 with DB_POOL_MAX=10 instead of 40, so requests waited up to 2s in pg.pool.connect for an orders-db connection and p95 latency rose from ~310 ms to 2.35 s (db.client.connections.usage pinned at 10/10). Rolling back to 2026.09.14-1 cleared it, as in #1017 and #1029.";

    expect(longTldr).toHaveLength(320);
    postMock.mockResolvedValue(
      structuredResponse({ analysisTldr: longTldr }) as never,
    );

    renderPanel({ onReportSummaryChange });
    await flush();

    expect(nonNullCalls(onReportSummaryChange)).toEqual([longTldr]);
  });

  test("reports null when a report has neither a TL;DR nor a Summary", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(completedResponse() as never);

    renderPanel({ onReportSummaryChange });
    await flush();

    expect(onReportSummaryChange).toHaveBeenCalledWith(null);
    expect(nonNullCalls(onReportSummaryChange)).toEqual([]);
  });

  test("reports null while the run is active or the report is pending", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(
        successfulResponse(
          investigationPayload({
            status: AIRunStatus.Running,
            analysisTldr: TLDR,
          }),
        ) as never,
      )
      .mockResolvedValueOnce(
        completedResponse({
          analysisMarkdown: null,
          analysisTldr: TLDR,
          isAnalysisPending: true,
        }) as never,
      )
      .mockResolvedValue(structuredResponse({ analysisTldr: TLDR }) as never);

    renderPanel({ onReportSummaryChange });
    await flush();
    await advanceFastPolls();

    expect(nonNullCalls(onReportSummaryChange)).toEqual([]);

    await advanceFastPolls();

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(TLDR);
  });

  test("does not repeat an unchanged summary across polls", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({ analysisTldr: TLDR }) as never,
    );

    renderPanel({ onReportSummaryChange });
    await flush();
    const callsAfterLoad: number = onReportSummaryChange.mock.calls.length;

    await tick(SETTLED_POLL_INTERVAL_MS);
    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(investigationPostCount()).toBe(3);
    expect(onReportSummaryChange).toHaveBeenCalledTimes(callsAfterLoad);
  });

  test("reports null the moment the subject changes, then the new summary", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    const nextSubject: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    const nextTldr: string = "The webhook signer rotated its key.";
    postMock
      .mockResolvedValueOnce(
        structuredResponse({ analysisTldr: TLDR }) as never,
      )
      .mockReturnValueOnce(nextSubject.promise as never);

    const view: ReturnType<typeof render> = renderPanel({
      onReportSummaryChange,
    });
    await flush();
    expect(onReportSummaryChange).toHaveBeenLastCalledWith(TLDR);

    view.rerender(
      <InvestigationPanel
        subjectType="alert"
        subjectId={ALERT_ID}
        onReportSummaryChange={onReportSummaryChange}
      />,
    );
    await flush();

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(null);

    await resolveDeferred(
      nextSubject,
      structuredResponse({ runId: NEXT_RUN_ID, analysisTldr: nextTldr }),
    );

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(nextTldr);
  });

  test("reports null when the report disappears", async () => {
    const onReportSummaryChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(
        structuredResponse({ analysisTldr: TLDR }) as never,
      )
      .mockResolvedValue(
        structuredResponse({
          analysisMarkdown: null,
          analysisTldr: TLDR,
        }) as never,
      );

    renderPanel({ onReportSummaryChange });
    await flush();
    expect(onReportSummaryChange).toHaveBeenLastCalledWith(TLDR);

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(onReportSummaryChange).toHaveBeenLastCalledWith(null);
  });

  test("uses the latest callback without re-reporting", async () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({ analysisTldr: TLDR }) as never,
    );

    const view: ReturnType<typeof render> = renderPanel({
      onReportSummaryChange: first,
    });
    await flush();
    expect(first).toHaveBeenLastCalledWith(TLDR);

    view.rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={INCIDENT_ID}
        onReportSummaryChange={second}
      />,
    );
    await flush();
    expect(second).not.toHaveBeenCalled();

    postMock.mockResolvedValue(
      structuredResponse({ analysisTldr: "A newer summary." }) as never,
    );
    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(second).toHaveBeenLastCalledWith("A newer summary.");
  });
});

/*
 * The header shows a responder's verdict next to the report's summary, so the
 * panel reports it on the summary's terms: once per change, null until a
 * report is on screen, and afresh for every subject.
 */
describe("InvestigationPanel verdict callback", () => {
  function reportedVerdicts(callback: MockFunction): Array<unknown> {
    return callback.mock.calls.map((call: Array<unknown>): unknown => {
      return call[0];
    });
  }

  function nonNullVerdicts(callback: MockFunction): Array<unknown> {
    return reportedVerdicts(callback).filter((value: unknown): boolean => {
      return value !== null;
    });
  }

  test.each(Object.values(AIRunHumanVerdict))(
    "reports a %s verdict saved with the completed report",
    async (verdict: AIRunHumanVerdict) => {
      const onVerdictChange: MockFunction = getJestMockFunction();
      postMock.mockResolvedValue(
        structuredResponse({ humanVerdict: verdict }) as never,
      );

      renderPanel({ onVerdictChange });
      await flush();

      expect(onVerdictChange).toHaveBeenLastCalledWith(verdict);
      expect(nonNullVerdicts(onVerdictChange)).toEqual([verdict]);
    },
  );

  test("reports null for a report nobody has rated", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(structuredResponse() as never);

    renderPanel({ onVerdictChange });
    await flush();

    expect(onVerdictChange).toHaveBeenCalledWith(null);
    expect(nonNullVerdicts(onVerdictChange)).toEqual([]);
  });

  test("reports no verdict it cannot name", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({ humanVerdict: "Edited" }) as never,
    );

    renderPanel({ onVerdictChange });
    await flush();

    expect(nonNullVerdicts(onVerdictChange)).toEqual([]);
  });

  test.each([
    [
      "while a new run is in flight",
      (): ApiResponse => {
        return successfulResponse(
          investigationPayload({
            status: AIRunStatus.Running,
            humanVerdict: AIRunHumanVerdict.Confirmed,
          }),
        );
      },
    ],
    [
      "while the report is still being prepared",
      (): ApiResponse => {
        return completedResponse({
          analysisMarkdown: null,
          isAnalysisPending: true,
          humanVerdict: AIRunHumanVerdict.Confirmed,
        });
      },
    ],
  ])(
    "reports no verdict %s",
    async (_label: string, response: () => ApiResponse) => {
      const onVerdictChange: MockFunction = getJestMockFunction();
      postMock.mockResolvedValue(response() as never);

      renderPanel({ onVerdictChange });
      await flush();

      expect(nonNullVerdicts(onVerdictChange)).toEqual([]);
    },
  );

  test("reports a rating the moment it is made, and a changed one", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(structuredResponse() as never)
      .mockResolvedValueOnce(successfulResponse({}) as never)
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel({ onVerdictChange });
    await flush();
    expect(nonNullVerdicts(onVerdictChange)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    // Optimistic, like the panel's own pill: before the save resolves.
    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Confirmed,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await flush();

    expect(nonNullVerdicts(onVerdictChange)).toEqual([
      AIRunHumanVerdict.Confirmed,
      AIRunHumanVerdict.Rejected,
    ]);
    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Rejected,
    );
  });

  test("takes a rating back out when the save fails", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(structuredResponse() as never)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { message: "Verdict storage is unavailable." },
          {},
        ) as never,
      );

    renderPanel({ onVerdictChange });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save your verdict",
    );
    expect(nonNullVerdicts(onVerdictChange)).toEqual([
      AIRunHumanVerdict.Rejected,
    ]);
    expect(onVerdictChange).toHaveBeenLastCalledWith(null);
  });

  test("a poll started before a rating saved cannot flip the reported verdict", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    const stalePoll: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(structuredResponse() as never)
      .mockReturnValueOnce(stalePoll.promise as never)
      .mockResolvedValueOnce(successfulResponse({}) as never);

    renderPanel({ onVerdictChange });
    await flush();
    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(postMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    await flush();
    const callsAfterRating: number = onVerdictChange.mock.calls.length;

    await resolveDeferred(
      stalePoll,
      structuredResponse({ humanVerdict: null }),
    );

    expect(onVerdictChange).toHaveBeenCalledTimes(callsAfterRating);
    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Confirmed,
    );
  });

  test("follows a verdict another responder saves", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(structuredResponse() as never)
      .mockResolvedValue(
        structuredResponse({
          humanVerdict: AIRunHumanVerdict.Rejected,
        }) as never,
      );

    renderPanel({ onVerdictChange });
    await flush();
    expect(nonNullVerdicts(onVerdictChange)).toEqual([]);

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Rejected,
    );
  });

  test("does not repeat an unchanged verdict across polls", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({
        humanVerdict: AIRunHumanVerdict.Confirmed,
      }) as never,
    );

    renderPanel({ onVerdictChange });
    await flush();
    const callsAfterLoad: number = onVerdictChange.mock.calls.length;

    await tick(SETTLED_POLL_INTERVAL_MS);
    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(investigationPostCount()).toBe(3);
    expect(onVerdictChange).toHaveBeenCalledTimes(callsAfterLoad);
    expect(nonNullVerdicts(onVerdictChange)).toEqual([
      AIRunHumanVerdict.Confirmed,
    ]);
  });

  test("drops the verdict when a new run starts", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    postMock
      .mockResolvedValueOnce(
        structuredResponse({
          humanVerdict: AIRunHumanVerdict.Confirmed,
        }) as never,
      )
      .mockResolvedValue(
        successfulResponse(
          investigationPayload({
            status: AIRunStatus.Queued,
            runId: NEXT_RUN_ID,
          }),
        ) as never,
      );

    renderPanel({ onVerdictChange });
    await flush();
    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Confirmed,
    );

    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(onVerdictChange).toHaveBeenLastCalledWith(null);
  });

  test("reports null the moment the subject changes, then the new verdict", async () => {
    const onVerdictChange: MockFunction = getJestMockFunction();
    const nextSubject: Deferred<ApiResponse> = createDeferred<ApiResponse>();
    postMock
      .mockResolvedValueOnce(
        structuredResponse({
          humanVerdict: AIRunHumanVerdict.Confirmed,
        }) as never,
      )
      .mockReturnValueOnce(nextSubject.promise as never);

    const view: ReturnType<typeof render> = renderPanel({ onVerdictChange });
    await flush();
    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Confirmed,
    );

    view.rerender(
      <InvestigationPanel
        subjectType="alert"
        subjectId={ALERT_ID}
        onVerdictChange={onVerdictChange}
      />,
    );
    await flush();

    // Before the alert's report arrives, and without a stale confirmation.
    expect(onVerdictChange).toHaveBeenLastCalledWith(null);

    await resolveDeferred(
      nextSubject,
      structuredResponse({
        runId: NEXT_RUN_ID,
        humanVerdict: AIRunHumanVerdict.Rejected,
      }),
    );

    expect(onVerdictChange).toHaveBeenLastCalledWith(
      AIRunHumanVerdict.Rejected,
    );
    expect(nonNullVerdicts(onVerdictChange)).toEqual([
      AIRunHumanVerdict.Confirmed,
      AIRunHumanVerdict.Rejected,
    ]);
  });

  test("uses the latest callback without re-reporting", async () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();
    postMock.mockResolvedValue(
      structuredResponse({
        humanVerdict: AIRunHumanVerdict.Confirmed,
      }) as never,
    );

    const view: ReturnType<typeof render> = renderPanel({
      onVerdictChange: first,
    });
    await flush();
    expect(first).toHaveBeenLastCalledWith(AIRunHumanVerdict.Confirmed);
    const firstCallCount: number = first.mock.calls.length;

    view.rerender(
      <InvestigationPanel
        subjectType="incident"
        subjectId={INCIDENT_ID}
        onVerdictChange={second}
      />,
    );
    await flush();
    expect(second).not.toHaveBeenCalled();

    postMock.mockResolvedValue(
      structuredResponse({ humanVerdict: AIRunHumanVerdict.Rejected }) as never,
    );
    await tick(SETTLED_POLL_INTERVAL_MS);

    expect(reportedVerdicts(second)).toEqual([AIRunHumanVerdict.Rejected]);
    expect(first).toHaveBeenCalledTimes(firstCallCount);
  });
});
