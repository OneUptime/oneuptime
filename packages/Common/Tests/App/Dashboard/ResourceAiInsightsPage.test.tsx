import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  MemoryRouter,
  NavigateFunction,
  Route as PageRoute,
  Routes,
  useNavigate,
} from "react-router-dom";
import ResourceAiInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiInsightsPage";
import {
  RESOURCE_AI_INSIGHTS_EMPTY_TITLE,
  RESOURCE_AI_INSIGHTS_PAGE_TITLE,
  RESOURCE_COMMAND_JOB_ORIGIN_LABELS,
  ResourceAiInsights,
  describeResourceCommandJobOrigin,
  describeResourceFixType,
  describeResourceInvestigationSubject,
  getResourceAiInsightsEmptyDescription,
  getResourceAiInsightsPageSubtitle,
  getResourceCommandsEmptyMessage,
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
  getResourceInvestigationSummary,
  parseResourceAiInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiInsights";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import { toHeadline } from "../../../UI/Components/Table/EmptyTableMessage";

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

/*
 * A resource's AI Insights page (AI → Insights) renders for real on its
 * real route, with the insights and status routes, the model API and the
 * permission snapshot stubbed. It answers "what did OneUptime AI do on this
 * resource?": the investigations of incidents and alerts here, the fixes
 * AI proposed or applied, and every command it ran through the resource's
 * AI agent — a RunnerJob table filtered on this resource's ResourceCommand
 * jobs, with a permission fallback.
 */

const WAIT_TIMEOUT: number = 20000;

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";
const OTHER_RESOURCE_ID: string = "44444444-0000-4000-8000-000000000005";
const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
const SECOND_RUN_ID: string = "66666666-0000-4000-8000-000000000007";
const FIX_ID: string = "77777777-0000-4000-8000-000000000001";
const SECOND_FIX_ID: string = "77777777-0000-4000-8000-000000000002";

const INSIGHTS_ROUTE: string = "/resource-ai-access/insights";
const STATUS_ROUTE: string = "/resource-ai-access/status";

const CEPH: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.CephCluster,
);

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

function makeStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.CephCluster,
    resourceId: RESOURCE_ID,
    resourceName: "ceph-prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

function incidentInvestigation(): JSONObject {
  return {
    aiRunId: RUN_ID,
    status: AIRunStatus.Completed,
    analysisTldr: "osd.3 went down after its disk filled.",
    createdAt: "2026-09-22T09:00:00.000Z",
    completedAt: "2026-09-22T09:04:00.000Z",
    incident: {
      id: INCIDENT_ID,
      title: "HEALTH_WARN on ceph-prod",
      number: 42,
    },
  };
}

function alertInvestigation(): JSONObject {
  return {
    aiRunId: SECOND_RUN_ID,
    status: AIRunStatus.Running,
    createdAt: "2026-09-22T09:30:00.000Z",
    alert: { id: ALERT_ID, title: "PGs degraded" },
  };
}

function fullInsights(): JSONObject {
  return {
    resourceType: AiResourceType.CephCluster,
    resourceId: RESOURCE_ID,
    investigations: [incidentInvestigation(), alertInvestigation()],
    fixes: [
      {
        id: FIX_ID,
        status: AutoRemediationSuggestionStatus.Suggested,
        executionMode: "Suggest",
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        rationale: "Mark osd.3 out so its PGs recover elsewhere.",
        createdAt: "2026-09-22T09:05:00.000Z",
        incidentId: INCIDENT_ID,
      },
      {
        id: SECOND_FIX_ID,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        createdAt: "2026-09-22T09:35:00.000Z",
        alertId: ALERT_ID,
      },
    ],
    commandCounts: { investigation: 1717, remediation: 2929 },
  };
}

function emptyInsights(): JSONObject {
  return {
    resourceType: AiResourceType.CephCluster,
    resourceId: RESOURCE_ID,
    investigations: [],
    fixes: [],
    commandCounts: { investigation: 0, remediation: 0 },
  };
}

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function ok(body: unknown): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  };
}

function httpError(statusCode: number, message: string): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let getListSpy: ReturnType<typeof jest.spyOn>;
let jobs: Array<RunnerJob> = [];
let insightsAnswers: Array<Answer> = [];
let statusAnswer: Answer = ok(makeStatus());

function serve(insights: Answer | Array<Answer>, status?: Answer): void {
  insightsAnswers = Array.isArray(insights) ? [...insights] : [insights];
  if (status) {
    statusAnswer = status;
  }
}

function postsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    });
}

interface ListRequest {
  modelType?: unknown;
  query?: Record<string, unknown> | undefined;
  select?: Record<string, unknown> | undefined;
}

function jobListRequest(): ListRequest | undefined {
  return getListSpy.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return (call[0] || {}) as ListRequest;
    })
    .find((request: ListRequest): boolean => {
      return request.modelType === RunnerJob;
    });
}

function makeJob(
  id: string,
  overrides: Partial<Record<keyof RunnerJob, unknown>> = {},
): RunnerJob {
  return Object.assign(
    new RunnerJob(),
    {
      _id: id,
      createdAt: new Date("2026-09-22T09:59:00Z"),
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.ResourceCommand,
      status: RunnerJobStatus.Succeeded,
      payload: { displayCommand: `ceph osd tree ${id}` },
      exitCode: 0,
    },
    overrides,
  );
}

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

let navigate: NavigateFunction | undefined;

function NavigationProbe(): React.ReactElement {
  navigate = useNavigate();
  return <></>;
}

function insightsPath(
  descriptor: ResourceAiAgentDescriptor,
  resourceId: string = RESOURCE_ID,
): string {
  return RouteMap[descriptor.insightsPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", resourceId);
}

function openInsightsPage(descriptor: ResourceAiAgentDescriptor = CEPH): void {
  const path: string = insightsPath(descriptor);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProbe />
      <Routes>
        <PageRoute
          path={String(RouteMap[descriptor.insightsPage])}
          element={
            <ResourceAiInsightsPage
              descriptor={descriptor}
              pageRoute={RouteMap[descriptor.insightsPage] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

function hrefOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectMember]);

  statusAnswer = ok(makeStatus());
  insightsAnswers = [ok(fullInsights())];

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);
      if (url.endsWith(INSIGHTS_ROUTE)) {
        const answer: Answer =
          insightsAnswers.length > 1
            ? insightsAnswers.shift()!
            : insightsAnswers[0]!;
        return await answer();
      }
      if (url.endsWith(STATUS_ROUTE)) {
        return await statusAnswer();
      }
      throw new Error(`Unexpected request to ${url}`);
    },
  );

  jobs = [];
  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation(
    async (args: unknown): Promise<ListResult<RunnerJob>> => {
      const request: ListRequest = args as ListRequest;
      if (request.modelType === RunnerJob) {
        return { data: jobs, count: jobs.length, skip: 0, limit: 10 };
      }
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("parseResourceAiInsights", () => {
  test("reads the shape the insights route returns", () => {
    const parsed: ResourceAiInsights | null =
      parseResourceAiInsights(fullInsights());

    expect(parsed?.investigations).toEqual([
      {
        aiRunId: RUN_ID,
        status: AIRunStatus.Completed,
        analysisTldr: "osd.3 went down after its disk filled.",
        createdAt: "2026-09-22T09:00:00.000Z",
        completedAt: "2026-09-22T09:04:00.000Z",
        incident: {
          id: INCIDENT_ID,
          title: "HEALTH_WARN on ceph-prod",
          number: 42,
        },
        alert: null,
      },
      {
        aiRunId: SECOND_RUN_ID,
        status: AIRunStatus.Running,
        analysisTldr: null,
        createdAt: "2026-09-22T09:30:00.000Z",
        completedAt: null,
        incident: null,
        alert: { id: ALERT_ID, title: "PGs degraded" },
      },
    ]);
    expect(parsed?.fixes[1]).toEqual({
      id: SECOND_FIX_ID,
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      executionMode: null,
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      rationale: null,
      createdAt: "2026-09-22T09:35:00.000Z",
      incidentId: null,
      alertId: ALERT_ID,
      approvedAt: null,
    });
  });

  test.each([
    ["null", null],
    ["a string", "insights"],
    ["an array", [incidentInvestigation()]],
    ["an object with neither list", { commandCounts: {} }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseResourceAiInsights(value)).toBeNull();
  });

  test("drops rows without an id, and reads ids in the serialized envelope", () => {
    expect(
      parseResourceAiInsights({
        investigations: [
          { status: AIRunStatus.Completed },
          { aiRunId: { _type: "ObjectID", value: RUN_ID } },
          "not a row",
        ],
      }),
    ).toEqual({
      investigations: [
        {
          aiRunId: RUN_ID,
          status: null,
          analysisTldr: null,
          createdAt: null,
          completedAt: null,
          incident: null,
          alert: null,
        },
      ],
      fixes: [],
    });
  });
});

describe("the words on each row", () => {
  test("every investigation and fix status has its label and colour", () => {
    const palette: Array<unknown> = [Green500, Red500, Yellow500, Gray500];
    for (const status of Object.values(AIRunStatus)) {
      expect(
        getResourceInvestigationStatusLook(status).label.length,
      ).toBeGreaterThan(0);
      expect(palette).toContain(
        getResourceInvestigationStatusLook(status).color,
      );
    }
    for (const status of Object.values(AutoRemediationSuggestionStatus)) {
      expect(getResourceFixStatusLook(status).label.length).toBeGreaterThan(0);
      expect(palette).toContain(getResourceFixStatusLook(status).color);
    }
    expect(getResourceInvestigationStatusLook(AIRunStatus.Running).label).toBe(
      "Investigating",
    );
    expect(getResourceInvestigationStatusLook(AIRunStatus.Stale).label).toBe(
      "Timed out",
    );
    expect(getResourceInvestigationStatusLook(AIRunStatus.Completed)).toEqual({
      label: "Completed",
      color: Green500,
    });
    expect(getResourceInvestigationStatusLook(AIRunStatus.Error)).toEqual({
      label: "Failed",
      color: Red500,
    });
    expect(
      getResourceFixStatusLook(AutoRemediationSuggestionStatus.Suggested),
    ).toEqual({ label: "Waiting for approval", color: Yellow500 });
    // A status a newer server added shows as it is, in a neutral pill.
    expect(getResourceInvestigationStatusLook("Brand new")).toEqual({
      label: "Brand new",
      color: Gray500,
    });
    expect(getResourceFixStatusLook("Brand new")).toEqual({
      label: "Brand new",
      color: Gray500,
    });
  });

  test("the kind of fix, the subject and the finding", () => {
    expect(
      describeResourceFixType(AutoRemediationSuggestionType.CommandPlan),
    ).toBe("Command plan");
    expect(describeResourceFixType(AutoRemediationSuggestionType.Runbook)).toBe(
      "Runbook",
    );
    expect(describeResourceFixType(null)).toBeNull();

    const parsed: ResourceAiInsights = parseResourceAiInsights(fullInsights())!;
    expect(
      describeResourceInvestigationSubject(parsed.investigations[0]!),
    ).toEqual({
      text: "Incident #42: HEALTH_WARN on ceph-prod",
      incidentId: INCIDENT_ID,
      alertId: null,
    });
    expect(
      describeResourceInvestigationSubject(parsed.investigations[1]!).text,
    ).toBe("Alert: PGs degraded");
    expect(getResourceInvestigationSummary(parsed.investigations[1]!)).toBe(
      "Still investigating.",
    );
    expect(
      getResourceInvestigationSummary({
        ...parsed.investigations[1]!,
        status: AIRunStatus.Error,
      }),
    ).toBe("No summary was recorded.");
  });

  test("a command's reason: an investigation, a connection test or a fix", () => {
    expect(
      describeResourceCommandJobOrigin({
        origin: RunnerJobOrigin.AiInvestigation,
        aiRunId: new ObjectID(RUN_ID),
      }),
    ).toBe("Investigation (read-only)");
    expect(
      describeResourceCommandJobOrigin({
        origin: RunnerJobOrigin.AiInvestigation,
      }),
    ).toBe("Connection test (read-only)");
    expect(
      describeResourceCommandJobOrigin({
        origin: RunnerJobOrigin.AiRemediation,
      }),
    ).toBe("Fix");
    expect(describeResourceCommandJobOrigin({})).toBe("");
    expect(RESOURCE_COMMAND_JOB_ORIGIN_LABELS).toEqual({
      [RunnerJobOrigin.AiInvestigation]: "Investigation or connection test",
      [RunnerJobOrigin.AiRemediation]: "Fix",
    });
  });
});

describe("the AI Insights page", () => {
  test("shows its title and the resource's subtitle", async () => {
    openInsightsPage();

    expect(
      screen.getByText(RESOURCE_AI_INSIGHTS_PAGE_TITLE),
    ).toBeInTheDocument();
    expect(
      screen.getByText(getResourceAiInsightsPageSubtitle(CEPH)),
    ).toBeInTheDocument();
    expect(await findText("Investigations")).toBeInTheDocument();
  });

  test("asks the insights and status routes about this resource", async () => {
    openInsightsPage();
    await findText("Investigations");

    expect(postsTo(INSIGHTS_ROUTE)).toHaveLength(1);
    expect(postsTo(INSIGHTS_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.CephCluster,
      resourceId: RESOURCE_ID,
    });
    expect(String(postsTo(INSIGHTS_ROUTE)[0]!["url"])).toContain(
      "/api/resource-ai-access/insights",
    );
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("lists investigations and fixes, linked to their incident or alert", async () => {
    openInsightsPage();
    await findText("Investigations");

    const investigations: Array<HTMLElement> = screen.getAllByTestId(
      "ai-insights-investigation",
    );
    expect(investigations).toHaveLength(2);
    expect(
      hrefOf(
        within(investigations[0]!).getByText(
          "Incident #42: HEALTH_WARN on ceph-prod",
        ),
      ),
    ).toBe(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`);
    expect(
      within(investigations[0]!).getByText(
        "osd.3 went down after its disk filled.",
      ),
    ).toBeInTheDocument();
    expect(
      hrefOf(within(investigations[1]!).getByText("Alert: PGs degraded")),
    ).toBe(`/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`);

    const fixes: Array<HTMLElement> = screen.getAllByTestId("ai-insights-fix");
    expect(fixes).toHaveLength(2);
    expect(
      within(fixes[0]!).getByText("Waiting for approval"),
    ).toBeInTheDocument();
    expect(within(fixes[0]!).getByText("Command plan")).toBeInTheDocument();
    expect(hrefOf(within(fixes[0]!).getByText("Open incident"))).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
    );
    expect(
      within(fixes[1]!).getByText("No reason was recorded."),
    ).toBeInTheDocument();
    expect(hrefOf(within(fixes[1]!).getByText("Open alert"))).toBe(
      `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`,
    );
    // No KPI tiles: the counts are not rendered.
    expect(screen.queryByText("1717")).not.toBeInTheDocument();
  });

  test("renders server text as text, never as markup", async () => {
    serve(
      ok({
        investigations: [
          {
            aiRunId: RUN_ID,
            analysisTldr: "<img src='x' onerror='window.pwned=1'>",
            incident: {
              id: INCIDENT_ID,
              title: "<script>window.pwned=1</script>",
              number: 1,
            },
          },
        ],
        fixes: [],
      }),
    );
    openInsightsPage();

    expect(
      await findText("Incident #1: <script>window.pwned=1</script>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  test("one empty state, pointing at the AI agent page when AI cannot run commands here", async () => {
    serve(ok(emptyInsights()), ok(makeStatus({ isInvestigationReady: false })));
    openInsightsPage();

    expect(
      await findText(RESOURCE_AI_INSIGHTS_EMPTY_TITLE),
    ).toBeInTheDocument();
    expect(
      screen.getByText(getResourceAiInsightsEmptyDescription(CEPH)),
    ).toBeInTheDocument();
    expect(screen.queryByText("Investigations")).not.toBeInTheDocument();

    const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
    expect(hint).toHaveTextContent(
      "OneUptime AI can't run commands on this Ceph cluster right now.",
    );
    expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
      `/dashboard/${PROJECT_ID}/ceph/${RESOURCE_ID}/ai/agent`,
    );
  });

  test("no pointer when AI is ready, or when the status cannot be read", async () => {
    serve(ok(emptyInsights()));
    openInsightsPage();
    await findText(RESOURCE_AI_INSIGHTS_EMPTY_TITLE);
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      screen.queryByTestId("ai-insights-agent-hint"),
    ).not.toBeInTheDocument();
    cleanup();

    serve(ok(emptyInsights()), httpError(500, "status is down"));
    openInsightsPage();
    await findText(RESOURCE_AI_INSIGHTS_EMPTY_TITLE);
    expect(
      screen.queryByTestId("ai-insights-agent-hint"),
    ).not.toBeInTheDocument();
  });

  test("the pointer sits above the lists when there is history but AI is not ready", async () => {
    serve(ok(fullInsights()), ok(makeStatus({ isInvestigationReady: false })));
    openInsightsPage();

    const hint: HTMLElement = await findTestId("ai-insights-agent-hint");
    expect(screen.getByText("Investigations")).toBeInTheDocument();
    expect(
      hint.compareDocumentPosition(screen.getByText("Investigations")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("shows the server's error and retries on request", async () => {
    serve([
      httpError(500, "The insights service is unavailable."),
      ok(fullInsights()),
    ]);
    openInsightsPage();

    expect(
      await findText("The insights service is unavailable."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("ai-insights-error")).getByTestId(
        "refresh-button",
      ),
    );

    expect(await findText("Investigations")).toBeInTheDocument();
    expect(postsTo(INSIGHTS_ROUTE)).toHaveLength(2);
  });

  test("explains a body it cannot read", async () => {
    serve(ok({ unexpected: true }));
    openInsightsPage();

    expect(
      await findText("The server returned AI insights this page cannot read."),
    ).toBeInTheDocument();
  });

  test("drops a late answer about the resource the user navigated away from", async () => {
    let answerFirst: (() => void) | undefined;
    let calls: number = 0;
    postSpy.mockImplementation(
      async (
        request: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = String((request as JSONObject)["url"]);
        if (url.endsWith(STATUS_ROUTE)) {
          return new HTTPResponse<JSONObject>(
            200,
            makeStatus() as unknown as JSONObject,
            {},
          );
        }
        calls++;
        if (calls === 1) {
          await new Promise<void>((resolve: () => void) => {
            answerFirst = resolve;
          });
          return new HTTPResponse<JSONObject>(200, fullInsights(), {});
        }
        return new HTTPResponse<JSONObject>(
          200,
          { investigations: [alertInvestigation()], fixes: [] },
          {},
        );
      },
    );
    openInsightsPage();

    await waitFor(
      () => {
        expect(answerFirst).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    act(() => {
      navigate!(insightsPath(CEPH, OTHER_RESOURCE_ID));
    });

    expect(await findText("Alert: PGs degraded")).toBeInTheDocument();
    expect(
      postsTo(INSIGHTS_ROUTE).map((request: JSONObject): unknown => {
        return (request["data"] as JSONObject)["resourceId"];
      }),
    ).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);

    await act(async () => {
      answerFirst!();
      await Promise.resolve();
    });

    expect(
      screen.queryByText("Incident #42: HEALTH_WARN on ceph-prod"),
    ).not.toBeInTheDocument();
  });
});

describe("the commands table", () => {
  test("lists this resource's ResourceCommand jobs with every column its cells read", async () => {
    jobs = [
      makeJob("investigation", { aiRunId: new ObjectID(RUN_ID) }),
      makeJob("connection-test"),
      makeJob("fix", {
        origin: RunnerJobOrigin.AiRemediation,
        aiRunId: new ObjectID(RUN_ID),
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Refused by the Ceph AI agent: this agent is read-only",
        payload: { displayCommand: "ceph osd out 3" },
      }),
    ];
    openInsightsPage();

    expect(await findText("ceph osd tree investigation")).toBeInTheDocument();
    expect(
      screen.getByText("ceph osd tree connection-test"),
    ).toBeInTheDocument();
    const fixRow: HTMLElement | null = screen
      .getByText("ceph osd out 3")
      .closest("tr");
    expect(within(fixRow!).getByText("Fix")).toBeInTheDocument();
    expect(within(fixRow!).getByText("Failed (exit 1)")).toBeInTheDocument();
    expect(
      within(fixRow!).getByText(
        "Refused by the Ceph AI agent: this agent is read-only",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Investigation (read-only)")).toBeInTheDocument();
    expect(screen.getByText("Connection test (read-only)")).toBeInTheDocument();

    const request: ListRequest | undefined = jobListRequest();
    expect(request?.select).toEqual(
      expect.objectContaining({
        createdAt: true,
        payload: true,
        origin: true,
        status: true,
        aiRunId: true,
        exitCode: true,
        errorMessage: true,
      }),
    );
    // Summaries only: never the command output.
    expect(request?.select).not.toHaveProperty("output");
    expect(request?.query).toEqual(
      expect.objectContaining({
        resourceType: AiResourceType.CephCluster,
        stepType: RunbookStepType.ResourceCommand,
      }),
    );
    expect(String(request?.query?.["resourceId"])).toBe(RESOURCE_ID);
    // Never a Kubernetes cluster's kubectl jobs.
    expect(request?.query).not.toHaveProperty("kubernetesClusterId");
  });

  test("is titled for the resource's tool and says when nothing ran yet", async () => {
    openInsightsPage();

    expect(
      await findText(toHeadline(getResourceCommandsEmptyMessage(CEPH))),
    ).toBeInTheDocument();
    expect(screen.getAllByText("ceph commands").length).toBeGreaterThan(0);
  });

  for (const permission of [
    Permission.SettingsAdmin,
    Permission.SettingsViewer,
    Permission.ReadCephCluster,
  ]) {
    test(`explains instead of failing for ${permission}`, async () => {
      grant([...BASE_PERMISSIONS, permission]);
      openInsightsPage();

      const note: HTMLElement = await findTestId(
        "resource-command-jobs-permission-note",
      );
      expect(note).toHaveTextContent("Runbook Viewer");
      expect(jobListRequest()).toBeUndefined();
      // The summaries still show: they come from the resource's own read gate.
      expect(await findText("Investigations")).toBeInTheDocument();
    });
  }
});

describe("every resource type", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: asks about its own type and filters the table on it",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      openInsightsPage(descriptor);

      expect(
        await findText(toHeadline(getResourceCommandsEmptyMessage(descriptor))),
      ).toBeInTheDocument();
      expect(postsTo(INSIGHTS_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      expect(jobListRequest()?.query).toEqual(
        expect.objectContaining({
          resourceType: type,
          stepType: RunbookStepType.ResourceCommand,
        }),
      );
      expect(
        screen.getAllByText(descriptor.commandsCardTitle).length,
      ).toBeGreaterThan(0);
    },
  );
});
