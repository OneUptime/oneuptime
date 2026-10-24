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
 * A Logs finding's page (Logs → AI → Insights → one finding): while it is
 * open with no fix linked, "Fix with AI" - the pull request OneUptime AI
 * would open on its own, what an AI rule that asks before fixing leaves to a
 * person - saying what that pull request does for its kind. The server
 * decides what is offered (POST /telemetry-ai/fix-suggestion) and the strip
 * draws exactly that. "Open in Logs" opens the message's lines in the hour
 * it was found in; a failure that writes no log line opens its failed spans
 * in Traces instead. (Create Monitor on these findings is covered with the
 * page's other monitor cases, in AIInsightViewCreateMonitor.test.tsx.)
 */

const INSIGHT_ID: string = "5a880000-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5a880000-2222-4222-8222-222222222222";
const TASK_ID: string = "5a880000-3333-4333-8333-333333333333";
const REPO_A: string = "5a880000-4444-4444-8444-444444444444";

const postMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
}

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

/*
 * The evidence is drawn through LazyMarkdownViewer, a React.lazy boundary
 * ts-jest would compile synchronously on first render. These tests are about
 * what the detector wrote and how it is drawn (safe mode: a log line is the
 * service's own text), so the source is drawn straight through.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown", "data-safe-mode": String(props.safeMode) },
        props.text,
      );
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
  TELEMETRY_AI_FIX_LEADS,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import { LogInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import Navigation from "../../../UI/Utils/Navigation";
import { buildLogInsightDetail } from "../../../Utils/Logs/LogInsight";

const LOGS_PATH: RegExp = /\/logs$/u;
const WORD_JOINER: RegExp = /\u2060/gu;
const TRACES_PATH: RegExp = /\/traces$/u;

const WINDOW: { windowStartTime: string; windowEndTime: string } = {
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
};

const ERROR_LOG: LogInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "Error",
  ...WINDOW,
  logCount: 18400,
  errorLogCount: 2100,
  pattern: "Payment provider returned <num>: card declined",
  patternCount: 1240,
  severities: ["Error"],
  searchText: "Payment provider returned",
  traceCount: 312,
  sampleTraceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
};

const SILENT_FAILURE: LogInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "MissingLogging",
  gap: "SilentFailures",
  ...WINDOW,
  logCount: 18400,
  tracedLogCount: 17000,
  operationName: "POST /checkout",
  operationSpanCount: 2600,
  failedSpanCount: 312,
  failedSampleSize: 20,
  sampleTraceId: "5bf92f3577b34da6a3ce929d0e0e4737",
};

const NOISY: LogInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "Noisy",
  ...WINDOW,
  logCount: 48000,
  pattern: "cache hit for key <uuid>",
  patternCount: 29760,
  patternPercent: 62,
  sampledLogCount: 48000,
  severities: ["Debug"],
  searchText: "cache hit for key",
};

interface Finding {
  insightType: AIInsightType;
  evidence: LogInsightEvidence;
  title: string;
  status: AIInsightStatus;
}

let finding: Finding;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = finding.title;
  insight.insightType = finding.insightType;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = finding.status;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.detailMarkdown = buildLogInsightDetail({
    serviceName: "checkout",
    evidence: finding.evidence,
  }).toString();
  insight.evidence = { log: finding.evidence };
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");
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
    insightType: AIInsightType.LogErrorPattern,
    evidence: ERROR_LOG,
    title:
      'checkout logged "Payment provider returned <num>: card declined" 1,240 times in an hour',
    status: AIInsightStatus.ActionRequired,
  };

  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildInsight());
  });

  postMock.mockImplementation(
    async (args: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = args.url.toString();

      if (url.endsWith("/telemetry-ai/fix-suggestion")) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            offer: SuggestionOffer.Act,
            blocker: null,
            repository: { id: REPO_A, name: "acme/checkout" },
            repositories: [],
            taskId: null,
          },
          {},
        );
      }

      if (url.endsWith("/telemetry-ai/fix")) {
        return new HTTPResponse<JSONObject>(200, { taskId: TASK_ID }, {});
      }

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

function navigatedTo(navigate: ReturnType<typeof jest.spyOn>): {
  path: string;
  query: URLSearchParams;
} {
  const route: string = String(navigate.mock.calls[0]![0]);

  return {
    path: route.substring(0, route.indexOf("?")),
    query: new URLSearchParams(route.substring(route.indexOf("?") + 1)),
  };
}

describe("a Logs finding's page", () => {
  test.each([
    [AIInsightType.LogErrorPattern, ERROR_LOG],
    [AIInsightType.LogMissingLogging, SILENT_FAILURE],
    [AIInsightType.LogNoisyPattern, NOISY],
  ])(
    "a %s finding offers Fix with AI, saying what its pull request does",
    async (insightType: AIInsightType, evidence: LogInsightEvidence) => {
      finding = { ...finding, insightType, evidence };
      await renderPage();

      expect(
        await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
      ).toHaveTextContent(TELEMETRY_AI_FIX_LEADS[insightType]!);
      expect(posted("/telemetry-ai/fix-suggestion")).toEqual([
        { insightId: INSIGHT_ID },
      ]);
    },
  );

  test("its evidence reads as the detector wrote it, drawn in safe mode", async () => {
    await renderPage();

    await screen.findByText(finding.title);

    const evidence: HTMLElement = screen
      .getAllByTestId("markdown")
      .find((element: HTMLElement): boolean => {
        return (element.textContent || "").includes("Error log in checkout");
      })!;

    expect(evidence).toBeDefined();
    expect(evidence).toHaveAttribute("data-safe-mode", "true");
    expect(evidence.textContent).toBe(
      buildLogInsightDetail({
        serviceName: "checkout",
        evidence: ERROR_LOG,
      }).toString(),
    );
    // The message as the detector kept it; mdText puts a word joiner after "<".
    expect((evidence.textContent || "").replace(WORD_JOINER, "")).toContain(
      "- Message: `Payment provider returned <num>: card declined`",
    );
  });

  test("Fix with AI names the finding", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    );

    await waitFor(() => {
      expect(posted("/telemetry-ai/fix")).toEqual([{ insightId: INSIGHT_ID }]);
    });
  });

  test("a closed finding offers nothing and asks nothing", async () => {
    finding.status = AIInsightStatus.Resolved;
    await renderPage();

    await screen.findByText(finding.title);
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
    ).not.toBeInTheDocument();
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("AI Insights' own error-log spike offers no Logs fix", async () => {
    finding = {
      ...finding,
      insightType: AIInsightType.ErrorLogSpike,
      title: "Error-log spike: 6.0x normal volume in checkout",
    };
    await renderPage();

    await screen.findByText(finding.title);
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("Open in Logs: the error's lines in the hour it was found in", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    fireEvent.click(await screen.findByText("Open in Logs"));

    const { path, query } = navigatedTo(navigate);

    expect(path).toMatch(LOGS_PATH);
    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["primaryEntityId", [SERVICE_ID]],
      ["body", ["Payment provider returned"]],
    ]);
    expect(query.get("start")).toBe(WINDOW.windowStartTime);
    expect(query.get("end")).toBe(WINDOW.windowEndTime);
  });

  test("a failure that writes no log line opens its failed spans in Traces", async () => {
    finding = {
      ...finding,
      insightType: AIInsightType.LogMissingLogging,
      evidence: SILENT_FAILURE,
      title: "POST /checkout in checkout fails without logging",
    };

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    fireEvent.click(await screen.findByText("Open in Traces"));

    const { path, query } = navigatedTo(navigate);

    expect(path).toMatch(TRACES_PATH);
    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["primaryEntityId", SERVICE_ID],
      ["name", "POST /checkout"],
      ["statusCode", "2"],
    ]);
  });
});
