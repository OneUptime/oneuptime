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
import ResourceAiLogsPage from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogsPage";
import {
  RESOURCE_AI_LOGS_EMPTY_TITLE,
  RESOURCE_AI_LOGS_PAGE_TITLE,
  RESOURCE_COMMAND_JOB_ORIGIN_LABELS,
  ResourceAiLogs,
  describeResourceCommandJobOrigin,
  describeResourceFixType,
  describeResourceInvestigationSubject,
  getResourceAiLogsEmptyDescription,
  getResourceAiLogsPageSubtitle,
  getResourceCommandsEmptyMessage,
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
  getResourceInvestigationSummary,
  parseResourceAiLogs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogs";
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
 * A resource's AI Logs page (AI → Logs) renders for real on its real route,
 * with the logs and status routes, the model API and the permission
 * snapshot stubbed. It answers "what did OneUptime AI do on this
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

const LOGS_ROUTE: string = "/resource-ai-access/logs";
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

/*
 * A completed investigation whose TL;DR call failed: the server sends the
 * summary its posted report opens with instead.
 */
const REPORT_SUMMARY: string =
  "osd.7 is flapping because its journal disk reports read errors.";

function reportOnlyInvestigation(): JSONObject {
  return {
    aiRunId: RUN_ID,
    status: AIRunStatus.Completed,
    reportSummary: REPORT_SUMMARY,
    createdAt: "2026-09-22T09:00:00.000Z",
    completedAt: "2026-09-22T09:04:00.000Z",
    alert: { id: ALERT_ID, title: "OSD flapping" },
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

function fullLogs(): JSONObject {
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

function emptyLogs(): JSONObject {
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
let logsAnswers: Array<Answer> = [];
let statusAnswer: Answer = ok(makeStatus());

function serve(logs: Answer | Array<Answer>, status?: Answer): void {
  logsAnswers = Array.isArray(logs) ? [...logs] : [logs];
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

function logsPath(
  descriptor: ResourceAiAgentDescriptor,
  resourceId: string = RESOURCE_ID,
): string {
  return RouteMap[descriptor.logsPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", resourceId);
}

function openLogsPage(descriptor: ResourceAiAgentDescriptor = CEPH): void {
  const path: string = logsPath(descriptor);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProbe />
      <Routes>
        <PageRoute
          path={String(RouteMap[descriptor.logsPage])}
          element={
            <ResourceAiLogsPage
              descriptor={descriptor}
              pageRoute={RouteMap[descriptor.logsPage] as Route}
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
  logsAnswers = [ok(fullLogs())];

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);
      if (url.endsWith(LOGS_ROUTE)) {
        const answer: Answer =
          logsAnswers.length > 1 ? logsAnswers.shift()! : logsAnswers[0]!;
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

describe("parseResourceAiLogs", () => {
  test("reads the shape the logs route returns", () => {
    const parsed: ResourceAiLogs | null = parseResourceAiLogs(fullLogs());

    expect(parsed?.investigations).toEqual([
      {
        aiRunId: RUN_ID,
        status: AIRunStatus.Completed,
        analysisTldr: "osd.3 went down after its disk filled.",
        reportSummary: null,
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
        reportSummary: null,
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
    ["a string", "logs"],
    ["an array", [incidentInvestigation()]],
    ["an object with neither list", { commandCounts: {} }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseResourceAiLogs(value)).toBeNull();
  });

  test("reads the summary a run's report opens with, and reads a blank one as none", () => {
    const parsed: ResourceAiLogs = parseResourceAiLogs({
      investigations: [
        reportOnlyInvestigation(),
        {
          ...reportOnlyInvestigation(),
          aiRunId: SECOND_RUN_ID,
          reportSummary: "  ",
        },
      ],
    })!;

    expect(parsed.investigations[0]!.analysisTldr).toBeNull();
    expect(parsed.investigations[0]!.reportSummary).toBe(REPORT_SUMMARY);
    expect(parsed.investigations[1]!.reportSummary).toBeNull();
  });

  test("drops rows without an id, and reads ids in the serialized envelope", () => {
    expect(
      parseResourceAiLogs({
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
          reportSummary: null,
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

    const parsed: ResourceAiLogs = parseResourceAiLogs(fullLogs())!;
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

  test("the finding: the TL;DR, else the report's own summary, else why there is none", () => {
    const base: ResourceAiLogs["investigations"][number] = parseResourceAiLogs({
      investigations: [reportOnlyInvestigation()],
    })!.investigations[0]!;

    // Regression: a run whose TL;DR call failed shows what its report found.
    expect(getResourceInvestigationSummary(base)).toBe(REPORT_SUMMARY);
    expect(
      getResourceInvestigationSummary({ ...base, analysisTldr: "The TL;DR." }),
    ).toBe("The TL;DR.");
    expect(
      getResourceInvestigationSummary({ ...base, reportSummary: null }),
    ).toBe("No summary was recorded.");
    expect(
      getResourceInvestigationSummary({
        ...base,
        reportSummary: null,
        status: AIRunStatus.Queued,
      }),
    ).toBe("Still investigating.");
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

describe("the AI Logs page", () => {
  test("shows its title and the resource's subtitle", async () => {
    openLogsPage();

    expect(screen.getByText(RESOURCE_AI_LOGS_PAGE_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(getResourceAiLogsPageSubtitle(CEPH)),
    ).toBeInTheDocument();
    expect(await findText("Investigations")).toBeInTheDocument();
  });

  test("asks the logs and status routes about this resource", async () => {
    openLogsPage();
    await findText("Investigations");

    expect(postsTo(LOGS_ROUTE)).toHaveLength(1);
    expect(postsTo(LOGS_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.CephCluster,
      resourceId: RESOURCE_ID,
    });
    expect(String(postsTo(LOGS_ROUTE)[0]!["url"])).toContain(
      "/api/resource-ai-access/logs",
    );
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("lists investigations and fixes, linked to their incident or alert", async () => {
    openLogsPage();
    await findText("Investigations");

    const investigations: Array<HTMLElement> = screen.getAllByTestId(
      "ai-logs-investigation",
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

    const fixes: Array<HTMLElement> = screen.getAllByTestId("ai-logs-fix");
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
    openLogsPage();

    expect(
      await findText("Incident #1: <script>window.pwned=1</script>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  test("one empty state, pointing at the AI agent page when AI cannot run commands here", async () => {
    serve(ok(emptyLogs()), ok(makeStatus({ isInvestigationReady: false })));
    openLogsPage();

    expect(await findText(RESOURCE_AI_LOGS_EMPTY_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(getResourceAiLogsEmptyDescription(CEPH)),
    ).toBeInTheDocument();
    expect(screen.queryByText("Investigations")).not.toBeInTheDocument();

    const hint: HTMLElement = await findTestId("ai-logs-agent-hint");
    expect(hint).toHaveTextContent(
      "OneUptime AI can't run commands on this Ceph cluster right now.",
    );
    expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
      `/dashboard/${PROJECT_ID}/ceph/${RESOURCE_ID}/ai/agent`,
    );
  });

  test("no pointer when AI is ready, or when the status cannot be read", async () => {
    serve(ok(emptyLogs()));
    openLogsPage();
    await findText(RESOURCE_AI_LOGS_EMPTY_TITLE);
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.queryByTestId("ai-logs-agent-hint")).not.toBeInTheDocument();
    cleanup();

    serve(ok(emptyLogs()), httpError(500, "status is down"));
    openLogsPage();
    await findText(RESOURCE_AI_LOGS_EMPTY_TITLE);
    expect(screen.queryByTestId("ai-logs-agent-hint")).not.toBeInTheDocument();
  });

  test("the pointer sits above the lists when there is history but AI is not ready", async () => {
    serve(ok(fullLogs()), ok(makeStatus({ isInvestigationReady: false })));
    openLogsPage();

    const hint: HTMLElement = await findTestId("ai-logs-agent-hint");
    expect(screen.getByText("Investigations")).toBeInTheDocument();
    expect(
      hint.compareDocumentPosition(screen.getByText("Investigations")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("shows the server's error and retries on request", async () => {
    serve([httpError(500, "The logs service is unavailable."), ok(fullLogs())]);
    openLogsPage();

    expect(
      await findText("The logs service is unavailable."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("ai-logs-error")).getByTestId("refresh-button"),
    );

    expect(await findText("Investigations")).toBeInTheDocument();
    expect(postsTo(LOGS_ROUTE)).toHaveLength(2);
  });

  test("explains a body it cannot read", async () => {
    serve(ok({ unexpected: true }));
    openLogsPage();

    expect(
      await findText("The server returned AI logs this page cannot read."),
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
          return new HTTPResponse<JSONObject>(200, fullLogs(), {});
        }
        return new HTTPResponse<JSONObject>(
          200,
          { investigations: [alertInvestigation()], fixes: [] },
          {},
        );
      },
    );
    openLogsPage();

    await waitFor(
      () => {
        expect(answerFirst).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    act(() => {
      navigate!(logsPath(CEPH, OTHER_RESOURCE_ID));
    });

    expect(await findText("Alert: PGs degraded")).toBeInTheDocument();
    expect(
      postsTo(LOGS_ROUTE).map((request: JSONObject): unknown => {
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
    openLogsPage();

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
    openLogsPage();

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
      openLogsPage();

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
      openLogsPage(descriptor);

      expect(
        await findText(toHeadline(getResourceCommandsEmptyMessage(descriptor))),
      ).toBeInTheDocument();
      expect(postsTo(LOGS_ROUTE)[0]!["data"]).toEqual({
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

  /*
   * Regression for the screenshot this page was renamed from: a completed
   * investigation without a TL;DR read "No summary was recorded." though
   * its report said what it found.
   */
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: an investigation without a TL;DR shows what its report found",
    async (type: AiResourceType) => {
      serve(ok({ investigations: [reportOnlyInvestigation()], fixes: [] }));
      openLogsPage(getResourceAiAgentDescriptor(type));

      const row: HTMLElement = (await findText(REPORT_SUMMARY)).closest(
        "[data-testid='ai-logs-investigation']",
      ) as HTMLElement;
      expect(row).not.toBeNull();
      expect(
        within(row).queryByText("No summary was recorded."),
      ).not.toBeInTheDocument();
      expect(within(row).getByText("Completed")).toBeInTheDocument();
    },
  );
});
