import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import HTTPResponse from "../../../Types/API/HTTPResponse";
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

    // The status strip and the activity header both describe the live run.
    expect(screen.getAllByText("Triaging…")).toHaveLength(2);
    expect(screen.getByText("Starting investigation")).toBeVisible();
    expect(screen.getByText("Thinking")).toBeVisible();
    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(screen.getByText("· 3 rows · 1.5s")).toBeVisible();
    expect(screen.queryByText(RCA)).not.toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
  });

  test("a queued triage without an RCA keeps its status and activity", async () => {
    server.run = { _id: RUN_ID, status: AIRunStatus.Queued };

    await renderPage();

    expect(screen.getByText("Queued — waiting for a worker…")).toBeVisible();
    expect(screen.getByText("Triaging…")).toBeVisible();
    expect(screen.getByText("Searching logs")).toBeVisible();
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

    expect(screen.getAllByText("Triaging…")).toHaveLength(2);
    expect(screen.getByText("Searching logs")).toBeVisible();
  });

  test("polling completion replaces live activity with the posted RCA without remounting", async () => {
    jest.useFakeTimers();
    await renderPage();

    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(screen.getAllByText("Triaging…")).toHaveLength(2);
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
