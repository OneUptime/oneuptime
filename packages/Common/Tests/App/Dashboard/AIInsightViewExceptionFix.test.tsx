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
 * An Exceptions finding's page (Exceptions → AI → Insights → one finding):
 * while it is open with no fix linked, "Fix with AI" - the exception's own
 * AI task, a fix or better handling of an expected error, or for a
 * service's missing stack traces a request in Code. The server decides
 * what is offered (POST /telemetry-ai/fix-suggestion), and which pull
 * request it is (its recipe): the strip says exactly that. The fix it
 * starts names the finding; the page then reads the finding again and
 * shows its fix task. "Open in Exceptions" opens the service's unresolved
 * exceptions over the day a missing-stack-trace finding read.
 */

const INSIGHT_ID: string = "5240fafa-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5240fafa-2222-4222-8222-222222222222";
const TASK_ID: string = "5240fafa-3333-4333-8333-333333333333";
const REPO_A: string = "5240fafa-4444-4444-8444-444444444444";
const EXCEPTION_ID: string = "5240fafa-5555-4555-8555-555555555555";

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
  TELEMETRY_AI_FIX_LEADS_BY_RECIPE,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import Navigation from "../../../UI/Utils/Navigation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

// The unresolved exceptions list's own address, as the page builds it.
function unresolvedExceptionsPath(): string {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
  ).toString();
}

interface Finding {
  status: AIInsightStatus;
  fixAiRunId: ObjectID | null;
  insightType: AIInsightType;
}

let finding: Finding;
let suggestion: JSONObject;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.insightType = finding.insightType;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = finding.status;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");

  if (finding.insightType === AIInsightType.ExceptionMissingStackTrace) {
    insight.title = "Exceptions in checkout have no stack trace";
    insight.detailMarkdown = "**Missing stack traces in checkout**";
    insight.evidence = {
      exceptionStackTrace: {
        serviceId: SERVICE_ID,
        windowStartTime: "2026-10-23T09:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        exceptions: [],
        exceptionCount: 2,
        occurrenceCount: 120,
        withStackTraceCount: 0,
      },
    };
  } else {
    insight.title = "New exception in checkout: TypeError";
    insight.detailMarkdown = "**New exception in checkout**";
    insight.telemetryExceptionId = new ObjectID(EXCEPTION_ID);
    insight.evidence = {
      exception: {
        exceptionType: "TypeError",
        exceptionMessage: "Cannot read properties of undefined",
        serviceId: SERVICE_ID,
        ownCodeFrames: [
          {
            functionName: "getOrder",
            fileName: "src/orders.ts",
            lineNumber: 42,
          },
        ],
      },
    };
  }

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
    insightType: AIInsightType.NewException,
  };
  suggestion = {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: { id: REPO_A, name: "acme/checkout" },
    repositories: [],
    taskId: null,
    recipe: CodeFixTaskType.FixException,
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

describe("an Exceptions finding's page", () => {
  test("a new exception offers Fix with AI, saying it fixes the exception", async () => {
    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(TELEMETRY_AI_FIX_LEADS[AIInsightType.NewException]!);
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([
      { insightId: INSIGHT_ID },
    ]);
  });

  test("an expected error: the strip says its handling is improved, not that it is fixed", async () => {
    suggestion = {
      ...suggestion,
      recipe: CodeFixTaskType.ImproveExceptionHandling,
    };

    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(
      TELEMETRY_AI_FIX_LEADS_BY_RECIPE[
        CodeFixTaskType.ImproveExceptionHandling
      ]!,
    );
    expect(
      screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).not.toHaveTextContent("fixes this exception");
  });

  test.each([
    [AIInsightType.ExceptionSpike],
    [AIInsightType.ExceptionMissingStackTrace],
  ])("the %s finding says what its fix does", async (type: AIInsightType) => {
    finding.insightType = type;
    suggestion = {
      ...suggestion,
      recipe:
        type === AIInsightType.ExceptionMissingStackTrace
          ? CodeFixTaskType.CodeRequest
          : CodeFixTaskType.FixException,
    };

    await renderPage();

    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(TELEMETRY_AI_FIX_LEADS[type]!);
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
    await waitFor(() => {
      expect(
        screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
      ).not.toBeInTheDocument();
    });
  });

  test("a task already on its way - one started on the exception's own page too: a link to it, not a second one", async () => {
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
    const href: string = link.getAttribute("href") || "";

    expect(href.split("/").slice(-3)).toEqual(["code", "tasks", TASK_ID]);
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.button),
    ).not.toBeInTheDocument();
  });

  test("a closed finding offers nothing and asks nothing", async () => {
    finding.status = AIInsightStatus.Resolved;
    await renderPage();

    await screen.findByText("New exception in checkout: TypeError");
    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip),
    ).not.toBeInTheDocument();
    expect(posted("/telemetry-ai/fix-suggestion")).toEqual([]);
  });

  test("Open in Exceptions opens the service's unresolved exceptions, over the day it read", async () => {
    finding.insightType = AIInsightType.ExceptionMissingStackTrace;
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    fireEvent.click(await screen.findByText("Open in Exceptions"));

    const route: string = String(navigate.mock.calls[0]![0]);
    const query: URLSearchParams = new URLSearchParams(
      route.substring(route.indexOf("?") + 1),
    );

    expect(route.substring(0, route.indexOf("?"))).toBe(
      unresolvedExceptionsPath(),
    );
    expect(JSON.parse(query.get("filters") || "[]")).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
    expect(query.get("start")).toBe("2026-10-23T09:00:00.000Z");
    expect(query.get("end")).toBe("2026-10-24T09:00:00.000Z");
  });
});
