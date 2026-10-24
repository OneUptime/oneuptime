import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { MemoryRouter } from "react-router-dom";

/*
 * A Traces finding's page (Traces → AI → Insights → one finding): while it
 * is open with no fix linked, "Fix with AI" - the pull request OneUptime AI
 * would open on its own, what an AI rule that asks before fixing leaves to a
 * person. The server decides what is offered (POST /telemetry-ai/fix-
 * suggestion) and the strip draws exactly that: the button, a repository to
 * pick, the one step in the way, or the task already on its way. The fix it
 * starts names the finding; the page then reads the finding again and shows
 * its fix task instead. "Open in Traces" opens the operation's spans in the
 * hour it was found in.
 */

const INSIGHT_ID: string = "5229fafa-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5229fafa-2222-4222-8222-222222222222";
const TASK_ID: string = "5229fafa-3333-4333-8333-333333333333";
const REPO_A: string = "5229fafa-4444-4444-8444-444444444444";
const REPO_B: string = "5229fafa-5555-4555-8555-555555555555";

const postMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("react-router-dom", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-router-dom",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 5 });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import {
  TELEMETRY_AI_FIX_COPY,
  TELEMETRY_AI_FIX_LEADS,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import { TraceInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import Navigation from "../../../UI/Utils/Navigation";

// The Traces explorer's own address, whatever project it is under.
const TRACES_PATH: RegExp = /\/traces$/u;

const EVIDENCE: TraceInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "Slow",
  operationName: "GET /orders",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  spanCount: 1234,
  p99Ms: 2400,
  sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
};

interface Finding {
  status: AIInsightStatus;
  fixAiRunId: ObjectID | null;
  insightType: AIInsightType;
}

let finding: Finding;
let suggestion: JSONObject;
let createAnswer: "ok" | "refused";

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title =
    "GET /orders in checkout runs the same database query 40 times";
  insight.insightType = finding.insightType;
  insight.severity = AIInsightSeverity.High;
  insight.status = finding.status;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.traceId = EVIDENCE.sampleTraceId!;
  insight.detailMarkdown = "**Slow operation in checkout**";
  insight.evidence = { trace: EVIDENCE };
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");
  if (finding.fixAiRunId) {
    insight.fixAiRunId = finding.fixAiRunId;
  }
  return insight;
}

function posted(route: string): Array<JSONObject> {
  return postMock.mock.calls
    .map((call: Array<any>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    })
    .map((request: JSONObject): JSONObject => {
      return request["data"] as JSONObject;
    });
}

beforeEach(() => {
  finding = {
    status: AIInsightStatus.ActionRequired,
    fixAiRunId: null,
    insightType: AIInsightType.TraceSlowOperation,
  };
  suggestion = {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: { id: REPO_A, name: "acme/checkout" },
    repositories: [],
    taskId: null,
  };
  createAnswer = "ok";

  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildInsight());
  });

  postMock.mockImplementation(
    async (args: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = args.url.toString();

      if (url.endsWith("/telemetry-ai/fix-suggestion")) {
        return new HTTPResponse<JSONObject>(200, suggestion, {});
      }

      if (url.endsWith("/telemetry-ai/fix")) {
        if (createAnswer === "refused") {
          return new HTTPErrorResponse(
            400,
            { message: "No AI credits left." },
            {},
          );
        }

        // The finding links the task once it has started.
        finding.fixAiRunId = new ObjectID(TASK_ID);
        finding.status = AIInsightStatus.FixOpened;
        return new HTTPResponse<JSONObject>(200, { taskId: TASK_ID }, {});
      }

      // The triage panel: none yet.
      return new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AIInsightViewPage
          pageRoute={new Route("/")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

describe("a Traces finding's page", () => {
  test("offers Fix with AI for the finding, saying what it does for its kind", async () => {
    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).toBeInTheDocument();
    expect(screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead)).toHaveTextContent(
      TELEMETRY_AI_FIX_LEADS[AIInsightType.TraceSlowOperation]!,
    );
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([
      { insightId: INSIGHT_ID },
    ]);
  });

  test.each([
    [AIInsightType.TraceFailingOperation],
    [AIInsightType.TraceMissingTracing],
  ])("the %s finding says what its fix does", async (type: AIInsightType) => {
    finding.insightType = type;
    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(TELEMETRY_AI_FIX_LEADS[type]!);
  });

  test("the fix names the finding, and the page then shows the finding's fix task", async () => {
    await renderPage();

    fireEvent.click(await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button));

    await waitFor(() => {
      expect(posted("/telemetry-ai/fix")).toEqual([{ insightId: INSIGHT_ID }]);
    });

    expect(
      await screen.findByText("View the fix task and pull request"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
      ).not.toBeInTheDocument();
    });
  });

  test("with no repository found for certain, one is picked first", async () => {
    suggestion = {
      ...suggestion,
      repository: null,
      repositories: [
        { id: REPO_A, name: "acme/checkout" },
        { id: REPO_B, name: "acme/web" },
      ],
    };

    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.repository),
    ).toHaveTextContent(TELEMETRY_AI_FIX_COPY.pickRepository);
    expect(screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.button)).toBeDisabled();
  });

  test("no repository connected: the one step, in place of the button", async () => {
    suggestion = {
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: "Connect the repository that holds this code in Code.",
      },
      repository: null,
      repositories: [],
      taskId: null,
    };

    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.connect),
    ).toHaveTextContent(TELEMETRY_AI_FIX_COPY.connectRepository);
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).not.toBeInTheDocument();
    // Nothing to do yet: what Fix with AI would do is not said.
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).not.toBeInTheDocument();
  });

  test("a task already on its way: a link to it, not a second one", async () => {
    suggestion = {
      offer: SuggestionOffer.InProgress,
      blocker: null,
      repository: null,
      repositories: [],
      taskId: TASK_ID,
    };

    await renderPage();

    const link: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_FIX_TEST_IDS.taskLink,
    );

    expect(link.getAttribute("href")).toContain(`/code/tasks/${TASK_ID}`);
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).not.toBeInTheDocument();
  });

  test("a refusal that is no set-up step says why, under the button", async () => {
    createAnswer = "refused";

    await renderPage();

    fireEvent.click(await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button));

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.error),
    ).toBeInTheDocument();
  });

  test("a closed finding, or one with its fix, offers nothing and asks nothing", async () => {
    finding.status = AIInsightStatus.Dismissed;
    await renderPage();

    await screen.findByText(
      "GET /orders in checkout runs the same database query 40 times",
    );
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
    ).not.toBeInTheDocument();
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("a finding of AI Insights' own offers no Traces fix", async () => {
    finding.insightType = AIInsightType.TraceLatencyRegression;
    await renderPage();

    await screen.findByText(
      "GET /orders in checkout runs the same database query 40 times",
    );
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("Open in Traces opens the operation's spans, in the hour it was found in", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    fireEvent.click(await screen.findByText("Open in Traces"));

    const route: string = String(navigate.mock.calls[0]![0]);
    const query: URLSearchParams = new URLSearchParams(
      route.substring(route.indexOf("?") + 1),
    );

    expect(route.substring(0, route.indexOf("?"))).toMatch(TRACES_PATH);
    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["primaryEntityId", SERVICE_ID],
      ["name", "GET /orders"],
    ]);
    expect(query.get("start")).toBe("2026-10-24T08:00:00.000Z");
    expect(query.get("end")).toBe("2026-10-24T09:00:00.000Z");
  });
});
