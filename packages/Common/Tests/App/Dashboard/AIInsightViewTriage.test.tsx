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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { act } from "react";
import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUN_ID: string = "22222222-2222-4222-8222-222222222222";
const INSIGHT_TITLE: string = "Worker job count increased";
const EVIDENCE: string = "The worker queue grew to 13,191,243 jobs.";
const RCA: string =
  "Root cause: an increased enqueue rate saturated the api workers [C1].";
const RUN_ERROR: string = "The worker stopped before triage could finish.";
const POLL_INTERVAL_MS: number = 5000;

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const postMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("react-router-dom", () => {
  return {
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Request failed";
      },
    },
  };
});

interface FakeServer {
  summary: string | undefined;
  run: JSONObject | null;
  events: Array<JSONObject>;
}

let server: FakeServer;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = INSIGHT_TITLE;
  insight.insightType = AIInsightType.MetricDrift;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = AIInsightStatus.ActionRequired;
  insight.detailMarkdown = EVIDENCE;
  if (server.summary !== undefined) {
    insight.triageSummaryMarkdown = server.summary;
  }
  insight.occurrenceCount = 4;
  return insight;
}

function buildEvents(): Array<JSONObject> {
  return [
    { eventType: AIRunEventType.RunStarted },
    { eventType: AIRunEventType.LlmCallStarted },
    { eventType: AIRunEventType.LlmCallCompleted },
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: "search_logs",
    },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName: "search_logs",
      resultSummary: { rowCount: 3, durationInMs: 1500 },
    },
  ].map((event: JSONObject, index: number): JSONObject => {
    return {
      ...event,
      _id: ObjectID.generate().toString(),
      sequence: index + 1,
    };
  });
}

async function renderPage(): Promise<void> {
  render(<AIInsightViewPage {...({} as any)} />);
  await screen.findByText(INSIGHT_TITLE);
  // Wait for the real lazy MarkdownViewer to finish loading as well.
  await screen.findByText(EVIDENCE);
}

// The triage's steps: a list under its own Activity heading.
function activityRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Activity" });
}

/*
 * The AI Triage panel's body: the strip (or the notice, or the summary)
 * and the activity under it.
 */
function triageBody(): HTMLElement {
  return (screen.queryByTestId("ai-triage-status") ||
    screen.getByTestId("ai-triage-failure"))!.parentElement as HTMLElement;
}

// What moves in the panel: a spinner or a pulse, plain or motion-safe.
function movingMarks(): Array<Element> {
  return Array.from(triageBody().querySelectorAll("[class*='animate-']"));
}

function expectNoActivity(): void {
  expect(screen.queryByText("Activity")).not.toBeInTheDocument();
  expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
  expect(screen.queryByText("Starting investigation")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  expect(screen.queryByText("Searching logs")).not.toBeInTheDocument();
}

/*
 * Render the real insight page and ChatActivityFeed against the two API
 * boundaries. The saved summary and the run endpoint are independent reads:
 * an RCA can already exist while the endpoint still reports Running. The
 * summary's presence must decide whether activity is displayed.
 */
describe("AI insight detail — triage activity", () => {
  beforeEach(() => {
    server = {
      summary: undefined,
      run: { _id: RUN_ID, status: AIRunStatus.Running },
      events: buildEvents(),
    };
    getItemMock.mockReset();
    getItemMock.mockImplementation(() => {
      return Promise.resolve(buildInsight());
    });
    postMock.mockReset();
    postMock.mockImplementation(
      (request: { url: { toString: () => string } }) => {
        if (!request.url.toString().endsWith("/ai-insight/triage-run")) {
          throw new Error(`Unexpected request: ${request.url.toString()}`);
        }
        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            { run: server.run, events: server.events },
            {},
          ),
        );
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test.each(Object.values(AIRunStatus))(
    "a saved RCA hides activity even when the run reports %s",
    async (runStatus: AIRunStatus) => {
      server.summary = RCA;
      server.run = {
        _id: RUN_ID,
        status: runStatus,
        errorMessage: RUN_ERROR,
      };

      await renderPage();

      expect(screen.getByRole("heading", { name: "AI Triage" })).toBeVisible();
      expect(await screen.findByText(RCA)).toBeVisible();
      expect(screen.getByText(EVIDENCE)).toBeVisible();
      // Publishing an RCA does not resolve the human's insight action.
      expect(screen.getByText("Needs Attention")).toBeVisible();
      expectNoActivity();
      expect(screen.queryByText("Triage complete")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Triage did not finish"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(RUN_ERROR)).not.toBeInTheDocument();
    },
  );

  test("a saved RCA remains visible when its run is unavailable", async () => {
    server.summary = RCA;
    server.run = null;
    server.events = [];

    await renderPage();

    expect(screen.getByRole("heading", { name: "AI Triage" })).toBeVisible();
    expect(await screen.findByText(RCA)).toBeVisible();
    expectNoActivity();
  });

  test("a running triage without an RCA shows its live query trail", async () => {
    await renderPage();

    /*
     * The strip says where the triage stands, once: its steps are a list
     * under a heading of their own - not a second message (a chat bubble
     * headed "Triaging…" under the strip that said it).
     */
    expect(screen.getAllByText("Triaging…")).toHaveLength(1);
    expect(screen.getByTestId("ai-triage-status")).toHaveTextContent(
      "Triaging…",
    );
    expect(screen.getByTestId("ai-triage-status-pulse")).toBeInTheDocument();
    const activity: HTMLElement = activityRegion();
    expect(
      within(activity).getByRole("heading", { level: 3, name: "Activity" }),
    ).toBeVisible();
    expect(within(activity).getByText("Starting investigation")).toBeVisible();
    /*
     * The model call that answered is no step of its own (issue #6437):
     * the search it chose follows it.
     */
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    expect(within(activity).getByText("Searching logs")).toBeVisible();
    expect(screen.getByText("· 3 rows · 1.5s")).toBeVisible();
    expect(screen.queryByText(RCA)).not.toBeInTheDocument();
    /*
     * Only the steps, under the card's own heading: no chat message's
     * avatar, bordered bubble or "Investigating…" title around them.
     */
    expect(
      within(activity).queryByText("Investigating…"),
    ).not.toBeInTheDocument();
    expect(activity.querySelector(".rounded-xl")).toBeNull();
    expect(activity.querySelector(".bg-gray-900")).toBeNull();
  });

  test("a queued triage without an RCA keeps its status and activity", async () => {
    server.run = { _id: RUN_ID, status: AIRunStatus.Queued };

    await renderPage();

    expect(screen.getByTestId("ai-triage-status")).toHaveTextContent(
      "Queued — waiting for a worker…",
    );
    // About to be picked up: the strip pulses, and nothing says it twice.
    expect(screen.getByTestId("ai-triage-status-pulse")).toBeInTheDocument();
    expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
    expect(within(activityRegion()).getByText("Searching logs")).toBeVisible();
  });

  test("a completed run without an RCA keeps its available activity", async () => {
    server.run = { _id: RUN_ID, status: AIRunStatus.Completed };

    await renderPage();

    expect(screen.getByText("Triage complete")).toBeVisible();
    expect(screen.getByText("Activity")).toBeVisible();
    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
  });

  test.each([AIRunStatus.Error, AIRunStatus.Cancelled, AIRunStatus.Stale])(
    "%s triage without an RCA preserves activity and failure diagnostics",
    async (runStatus: AIRunStatus) => {
      server.run = {
        _id: RUN_ID,
        status: runStatus,
        errorMessage: RUN_ERROR,
      };

      await renderPage();

      expect(screen.getByText("Triage did not finish")).toBeVisible();
      expect(screen.getByText(RUN_ERROR)).toBeVisible();
      expect(screen.getByText("Activity")).toBeVisible();
      expect(screen.getByText("Searching logs")).toBeVisible();
      expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
    },
  );

  test.each([
    [AIRunStatus.Running, "Triaging…"],
    [AIRunStatus.Completed, "Triage complete"],
  ])(
    "%s triage with no events shows only its status",
    async (runStatus: string, statusText: string) => {
      server.run = { _id: RUN_ID, status: runStatus };
      server.events = [];

      await renderPage();

      expect(screen.getAllByText(statusText)).toHaveLength(1);
      expect(screen.queryByText("Activity")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Starting investigation"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Searching logs")).not.toBeInTheDocument();
    },
  );

  test("no run and no RCA leaves the AI triage section absent", async () => {
    server.run = null;
    server.events = [];

    await renderPage();

    expect(
      screen.queryByRole("heading", { name: "AI Triage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(EVIDENCE)).toBeVisible();
    expectNoActivity();
  });

  test("an empty summary does not hide a running triage's activity", async () => {
    server.summary = "";

    await renderPage();

    expect(screen.getAllByText("Triaging…")).toHaveLength(1);
    expect(within(activityRegion()).getByText("Searching logs")).toBeVisible();
  });

  test("polling completion replaces live activity with the posted RCA without remounting", async () => {
    jest.useFakeTimers();
    await renderPage();

    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(screen.getAllByText("Triaging…")).toHaveLength(1);
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledTimes(1);

    // The server publishes the summary as it completes the existing run.
    server.summary = RCA;
    server.run = { _id: RUN_ID, status: AIRunStatus.Completed };
    server.events.push({
      _id: ObjectID.generate().toString(),
      sequence: server.events.length + 1,
      eventType: AIRunEventType.RunCompleted,
    });

    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(screen.getByText(RCA)).toBeVisible();
    });
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenCalledTimes(2);
    expectNoActivity();
    expect(screen.getByText(EVIDENCE)).toBeVisible();

    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MS * 4);
    });

    /*
     * The same mounted page has settled: completion stops both polling and
     * repeated insight refetches, and the old steps never reappear.
     */
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(RCA)).toBeVisible();
    expectNoActivity();
  });
});

/*
 * TRY AGAIN FOR A TRIAGE THAT DID NOT FINISH, AND ITS ACTIVITY AS A STORY
 * (issues #6437, #6438).
 *
 * The customer's triage failed - its self-hosted model took longer than
 * the provider's 120 seconds - kept spinning, and offered nothing to press.
 * Now the page says what happened in words to act on, offers Try again to
 * who may change the insight (the server says: mayTryAgain), and a triage
 * waiting to try again by itself says when. Its activity spins nothing
 * once the run stopped, says when each step happened, and folds the
 * earlier steps of a long triage.
 */
describe("AI insight detail — triage Try again", () => {
  const TRY_AGAIN_PATH: string = "/ai-insight/triage-try-again";
  const NEXT_RUN_ID: string = "33333333-3333-4333-8333-333333333333";
  const PROVIDER_ERROR: string =
    "OpenAICompatible API request failed: The LLM provider did not respond within 120 seconds.";

  interface TryAgainServer {
    mayTryAgain: boolean;
    tryAgain: () => Promise<unknown>;
  }

  let tryAgainServer: TryAgainServer;

  function triageRunPosts(): number {
    return postMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { url: { toString: () => string } }).url
        .toString()
        .endsWith("/ai-insight/triage-run");
    }).length;
  }

  function tryAgainRequests(): Array<{ data: JSONObject }> {
    return postMock.mock.calls
      .map(
        (
          call: Array<unknown>,
        ): { url: { toString: () => string }; data: JSONObject } => {
          return call[0] as {
            url: { toString: () => string };
            data: JSONObject;
          };
        },
      )
      .filter((request: { url: { toString: () => string } }): boolean => {
        return request.url.toString().endsWith(TRY_AGAIN_PATH);
      });
  }

  beforeEach(() => {
    server = {
      summary: undefined,
      run: {
        _id: RUN_ID,
        status: AIRunStatus.Error,
        errorMessage: PROVIDER_ERROR,
      },
      events: buildEvents(),
    };
    tryAgainServer = {
      mayTryAgain: true,
      tryAgain: (): Promise<unknown> => {
        server.run = { _id: NEXT_RUN_ID, status: AIRunStatus.Queued };
        server.events = [];
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, { triageAiRunId: NEXT_RUN_ID }, {}),
        );
      },
    };
    getItemMock.mockReset();
    getItemMock.mockImplementation(() => {
      return Promise.resolve(buildInsight());
    });
    postMock.mockReset();
    postMock.mockImplementation(
      (request: { url: { toString: () => string } }) => {
        if (request.url.toString().endsWith(TRY_AGAIN_PATH)) {
          return tryAgainServer.tryAgain();
        }

        if (!request.url.toString().endsWith("/ai-insight/triage-run")) {
          throw new Error(`Unexpected request: ${request.url.toString()}`);
        }

        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            {
              run: server.run,
              events: server.events,
              mayTryAgain: tryAgainServer.mayTryAgain,
            },
            {},
          ),
        );
      },
    );
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("a triage that did not finish says why in words to act on, its error under Details", async () => {
    await renderPage();

    const failure: HTMLElement = screen.getByTestId("ai-triage-failure");
    expect(failure).toHaveTextContent("Triage did not finish");
    expect(screen.getByTestId("ai-triage-failure-cause")).toHaveTextContent(
      "The LLM provider did not answer within 120 seconds.",
    );
    expect(screen.getByTestId("ai-triage-failure-fix")).toHaveTextContent(
      "Response Timeout",
    );
    expect(screen.getByText(PROVIDER_ERROR)).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText(PROVIDER_ERROR)).toBeVisible();
  });

  test.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a %s triage offers Try again; pressing it triages again and the page follows the new run",
    async (status: AIRunStatus) => {
      server.run = { _id: RUN_ID, status, errorMessage: PROVIDER_ERROR };

      await renderPage();

      const button: HTMLElement = screen.getByRole("button", {
        name: "Try again",
      });
      expect(button).toHaveAttribute(
        "data-testid",
        "ai-triage-failure-try-again",
      );
      const readsBefore: number = triageRunPosts();

      await act(async () => {
        fireEvent.click(button);
      });

      await waitFor(() => {
        expect(
          screen.getByText("Queued — waiting for a worker…"),
        ).toBeVisible();
      });
      expect(tryAgainRequests()).toHaveLength(1);
      expect(tryAgainRequests()[0]!.data).toEqual({ insightId: INSIGHT_ID });
      // It read the triage again at once, not at the next poll.
      expect(triageRunPosts()).toBe(readsBefore + 1);
      expect(screen.queryByTestId("ai-triage-failure")).toBeNull();
    },
  );

  test("who may not change the insight gets the notice, and no Try again", async () => {
    tryAgainServer.mayTryAgain = false;

    await renderPage();

    expect(screen.getByTestId("ai-triage-failure")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a refusal is said under the button", async () => {
    tryAgainServer.tryAgain = (): Promise<unknown> => {
      return Promise.resolve(
        new HTTPErrorResponse(
          400,
          { message: "This insight's triage is queued or running already." },
          {},
        ),
      );
    };

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    // The suite's API words every error alike; the button shows them.
    expect(
      await screen.findByTestId("ai-triage-failure-try-again-error"),
    ).toHaveTextContent("Request failed");
    expect(screen.getByTestId("ai-triage-failure")).toBeVisible();
  });

  test("a triage waiting to try again by itself says when, and is no failure", async () => {
    const retryAt: Date = new Date(Date.now() + 10 * 60 * 1000);
    server.run = {
      _id: RUN_ID,
      status: AIRunStatus.Queued,
      retryAt: retryAt.toISOString(),
    };

    await renderPage();

    expect(screen.getByTestId("ai-triage-status")).toHaveTextContent(
      `Trying again at ${OneUptimeDate.getLocalTimeString(retryAt, {
        use12HourFormat: false,
      })}`,
    );
    expect(screen.queryByTestId("ai-triage-failure")).toBeNull();
    /*
     * It is not at work: it waits for its time, so nothing on the panel
     * moves until then - no pulse on the strip, no spinner in its steps.
     */
    expect(screen.queryByTestId("ai-triage-status-pulse")).toBeNull();
    expect(movingMarks()).toEqual([]);
    expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
  });

  test("the strip's words wrap beside a mark and a pulse that never shrink", async () => {
    server.run = { _id: RUN_ID, status: AIRunStatus.Running };

    await renderPage();

    const strip: HTMLElement = screen.getByTestId("ai-triage-status");
    const [mark, words] = Array.from(strip.children) as Array<HTMLElement>;
    expect(mark).toHaveClass("flex-shrink-0");
    expect(words).toHaveTextContent("Triaging…");
    expect(words).toHaveClass("min-w-0", "break-words");

    const pulse: HTMLElement = screen.getByTestId("ai-triage-status-pulse");
    expect(pulse).toHaveAttribute("aria-hidden", "true");
    // At the strip's end in either direction, and still for reduced motion.
    expect(pulse).toHaveClass(
      "ms-auto",
      "flex-shrink-0",
      "motion-safe:animate-ping",
    );
    expect(pulse.className).not.toMatch(/(^|\s)(ml-auto|animate-ping)(\s|$)/);
  });

  test("a triage that did not finish keeps its steps under their heading, after the notice", async () => {
    await renderPage();

    const notice: HTMLElement = screen.getByTestId("ai-triage-failure");
    const activity: HTMLElement = activityRegion();
    expect(
      notice.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(activity).getByText("Searching logs")).toBeVisible();
    // Nothing moves on a triage that stopped, and nothing says it works.
    expect(movingMarks()).toEqual([]);
    expect(screen.queryByText("Triaging…")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-triage-status")).toBeNull();
  });

  test("a triage whose retry time has passed waits for a worker", async () => {
    server.run = {
      _id: RUN_ID,
      status: AIRunStatus.Queued,
      retryAt: new Date(Date.now() - 60 * 1000).toISOString(),
    };

    await renderPage();

    expect(screen.getByTestId("ai-triage-status")).toHaveTextContent(
      "Queued — waiting for a worker…",
    );
  });

  test("a stopped triage's activity spins nothing: what was open did not finish", async () => {
    server.events = [
      { eventType: AIRunEventType.RunStarted },
      { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
      { eventType: AIRunEventType.LlmCallStarted },
    ].map((event: JSONObject, index: number): JSONObject => {
      return {
        ...event,
        _id: ObjectID.generate().toString(),
        sequence: index + 1,
      };
    });

    await renderPage();

    expect(screen.getByText("Activity")).toBeVisible();
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(screen.getAllByText("· did not finish")).toHaveLength(2);
  });

  test("each step says when it happened, and a long triage folds its earlier steps", async () => {
    const STEP_TOOLS: Array<string> = [
      "search_logs",
      "query_traces",
      "query_metrics",
    ];
    server.events = [
      { eventType: AIRunEventType.RunStarted },
      ...Array.from({ length: 12 }, (_value: unknown, index: number) => {
        const toolName: string = STEP_TOOLS[index % STEP_TOOLS.length]!;
        return [
          { eventType: AIRunEventType.ToolCallStarted, toolName },
          {
            eventType: AIRunEventType.ToolCallCompleted,
            toolName,
            resultSummary: { rowCount: 1 },
          },
        ];
      }).flat(),
    ].map((event: JSONObject, index: number): JSONObject => {
      return {
        ...event,
        _id: ObjectID.generate().toString(),
        sequence: index + 1,
        createdAt: {
          _type: "DateTime",
          value: new Date(Date.UTC(2026, 10, 9, 14, 0, index)).toISOString(),
        },
      };
    });

    await renderPage();

    // Thirteen steps: the latest eight show, the rest fold.
    expect(
      screen.getByRole("button", { name: "Show 5 earlier steps" }),
    ).toBeVisible();
    expect(screen.getAllByTestId("activity-step-time")).toHaveLength(8);
    // A step's time is when it started: the last search started at :23.
    expect(screen.getAllByTestId("activity-step-time")[7]).toHaveAttribute(
      "dateTime",
      new Date(Date.UTC(2026, 10, 9, 14, 0, 23)).toISOString(),
    );
  });
});
