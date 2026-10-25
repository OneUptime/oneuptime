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
 * A Metrics finding's page (Metrics → AI → Insights → one finding): while it
 * is open with no fix linked, "Fix with AI" - the pull request OneUptime AI
 * would open on its own, what an AI rule that asks before fixing leaves to a
 * person - saying what the pull request does for the kind of finding. The
 * server decides what is offered (POST /telemetry-ai/fix-suggestion) and the
 * strip draws exactly that. "Open in Metrics" opens the metric for the
 * service in the hour it was found in; names with ids open the metric list
 * searched for them; a service with no metrics opens its spans instead.
 * That no finding of the lane offers a monitor is AIInsightViewCreateMonitor's.
 */

const INSIGHT_ID: string = "5231fafa-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5231fafa-2222-4222-8222-222222222222";
const TASK_ID: string = "5231fafa-3333-4333-8333-333333333333";
const REPO_A: string = "5231fafa-4444-4444-8444-444444444444";

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
  TELEMETRY_AI_FIX_LEADS,
  TELEMETRY_AI_FIX_LEAD_METRIC_NAMES,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import { MetricInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
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

const TITLE: string =
  "http.server.request.count in checkout records 12,000 different user.id values an hour";

const ATTRIBUTE: MetricInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "HighCardinality",
  shape: "Attribute",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  metricName: "http.server.request.count",
  dataPointCount: 48000,
  attributeKey: "user.id",
  attributeValueCount: 12000,
  valueShape: "Uuid",
};

const NAMES: MetricInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "HighCardinality",
  shape: "Name",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  namePattern: "job.{id}.duration",
  nameCount: 1234,
  dataPointCount: 56000,
};

const NO_METRICS: MetricInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "MissingMetrics",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  spanCount: 4200,
  failedSpanCount: 12,
};

interface Finding {
  status: AIInsightStatus;
  fixAiRunId: ObjectID | null;
  insightType: AIInsightType;
  evidence: MetricInsightEvidence;
}

let finding: Finding;
let suggestion: JSONObject;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = TITLE;
  insight.insightType = finding.insightType;
  insight.severity = AIInsightSeverity.High;
  insight.status = finding.status;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  if (finding.evidence.metricName) {
    insight.metricName = finding.evidence.metricName;
  }
  insight.detailMarkdown = "**High-cardinality metric in checkout**";
  insight.evidence = { metric: finding.evidence };
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
    insightType: AIInsightType.MetricHighCardinality,
    evidence: ATTRIBUTE,
  };
  suggestion = {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: { id: REPO_A, name: "acme/checkout" },
    repositories: [],
    taskId: null,
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
        return new HTTPResponse<JSONObject>(200, suggestion, {});
      }

      if (url.endsWith("/telemetry-ai/fix")) {
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

// Where a click on the finding's explorer link goes, and with what.
async function openedRoute(label: string): Promise<{
  path: string;
  query: URLSearchParams;
}> {
  const navigate: ReturnType<typeof jest.spyOn> = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return undefined;
    });

  await renderPage();

  fireEvent.click(await screen.findByText(label));

  const route: string = String(navigate.mock.calls[0]![0]);
  const at: number = route.indexOf("?");

  return {
    path: at === -1 ? route : route.substring(0, at),
    query: new URLSearchParams(at === -1 ? "" : route.substring(at + 1)),
  };
}

describe("a Metrics finding's page", () => {
  test("offers Fix with AI for the finding, saying what it does for its kind", async () => {
    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(
      TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHighCardinality]!,
    );
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([
      { insightId: INSIGHT_ID },
    ]);
  });

  test.each([
    [AIInsightType.MetricHistogramBuckets],
    [AIInsightType.MetricMissingMetrics],
  ])("the %s finding says what its fix does", async (type: AIInsightType) => {
    finding.insightType = type;
    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(TELEMETRY_AI_FIX_LEADS[type]!);
  });

  test("names with IDs say the pull request takes the IDs out of the names", async () => {
    finding.evidence = NAMES;
    await renderPage();

    const lead: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_FIX_TEST_IDS.lead,
    );

    expect(lead).toHaveTextContent(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES);
    expect(lead).not.toHaveTextContent("stops recording these values");
  });

  test("the fix names the finding, and the page then shows the finding's fix task", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    );

    await waitFor(() => {
      expect(posted("/telemetry-ai/fix")).toEqual([{ insightId: INSIGHT_ID }]);
    });

    expect(
      await screen.findByText("View the fix task and pull request"),
    ).toBeInTheDocument();
  });

  test("a closed finding offers nothing and asks nothing", async () => {
    finding.status = AIInsightStatus.Dismissed;
    await renderPage();

    await screen.findByText(TITLE);
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
    ).not.toBeInTheDocument();
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("a drift finding is AI Insights' own: it offers no Metrics fix", async () => {
    finding.insightType = AIInsightType.MetricDrift;
    await renderPage();

    await screen.findByText(TITLE);
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("Open in Metrics opens the metric for the service, in the hour it was found in", async () => {
    const opened: { path: string; query: URLSearchParams } =
      await openedRoute("Open in Metrics");

    expect(opened.path).toMatch(/\/metrics\/view$/u);
    expect(
      (
        JSON.parse(opened.query.get("metricQueries") || "[]") as Array<{
          metricName: string;
        }>
      )[0]?.metricName,
    ).toBe("http.server.request.count");
    expect(JSON.parse(opened.query.get("services") || "[]")).toEqual([
      SERVICE_ID,
    ]);
    expect(new Date(opened.query.get("startTime") || "").toISOString()).toBe(
      "2026-10-24T08:00:00.000Z",
    );
    expect(new Date(opened.query.get("endTime") || "").toISOString()).toBe(
      "2026-10-24T09:00:00.000Z",
    );
  });

  test("names with ids open the metric list, searched for them in the service", async () => {
    finding.evidence = NAMES;

    const opened: { path: string; query: URLSearchParams } =
      await openedRoute("Open in Metrics");

    expect(opened.path).toMatch(/\/metrics$/u);
    expect(opened.query.get("search")).toBe(".duration");
    expect(JSON.parse(opened.query.get("filters") || "[]")).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
    expect(opened.query.get("start")).toBe("2026-10-24T08:00:00.000Z");
    expect(opened.query.get("end")).toBe("2026-10-24T09:00:00.000Z");
  });

  test("a service with no metrics opens its spans of the hour instead", async () => {
    finding.insightType = AIInsightType.MetricMissingMetrics;
    finding.evidence = NO_METRICS;

    const opened: { path: string; query: URLSearchParams } =
      await openedRoute("Open in Traces");

    expect(opened.path).toMatch(/\/traces$/u);
    expect(opened.query.toString()).toContain(SERVICE_ID);
    expect(opened.query.get("start")).toBe("2026-10-24T08:00:00.000Z");
    expect(opened.query.get("end")).toBe("2026-10-24T09:00:00.000Z");
    expect(screen.queryByText("Open in Metrics")).not.toBeInTheDocument();
  });
});
