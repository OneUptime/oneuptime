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
import KubernetesClusterAILogs, {
  AI_LOGS_EMPTY_DESCRIPTION,
  AI_LOGS_EMPTY_TITLE,
  AI_LOGS_PAGE_SUBTITLE,
  AI_LOGS_PAGE_TITLE,
  KUBECTL_COMMANDS_CARD_TITLE,
  KUBECTL_COMMANDS_EMPTY_MESSAGE,
  KUBECTL_JOB_ORIGIN_LABELS,
  KUBECTL_JOBS_TABLE_PREFERENCES_KEY,
  KubernetesAiLogs,
  KubernetesAiLogsInvestigation,
  describeFixType,
  describeInvestigationSubject,
  describeKubectlJobOrigin,
  getAgentPageHint,
  getFixStatusLook,
  getInvestigationStatusLook,
  getInvestigationSummary,
  parseKubernetesAiLogs,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Logs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
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
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
 * The cluster's AI Logs page (AI → Logs) renders for real on its
 * real route, with the logs and status routes, the model API and the
 * permission snapshot stubbed. It answers "what did OneUptime AI do on this
 * cluster?": the investigations of incidents and alerts here, the fixes AI
 * proposed or applied, and every kubectl command it ran — the table that
 * used to sit at the bottom of the old AI page, moved here with the same
 * columns, filters, preferences key and permission fallback.
 */

// Real components fetch; give the waits room on a loaded CI box.
const WAIT_TIMEOUT: number = 20000;

const CLUSTER_ID: string = "44444444-0000-4000-8000-000000000004";
const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
const SECOND_RUN_ID: string = "66666666-0000-4000-8000-000000000007";
const THIRD_RUN_ID: string = "66666666-0000-4000-8000-000000000008";
const FIX_ID: string = "77777777-0000-4000-8000-000000000001";
const SECOND_FIX_ID: string = "77777777-0000-4000-8000-000000000002";
const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/logs`;
const AGENT_HREF: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`;

const LOGS_ROUTE: string = "/kubernetes-cluster/ai-access/logs";
const STATUS_ROUTE: string = "/kubernetes-cluster/ai-access/status";

const NOT_READY_HINT: string =
  "OneUptime AI can't run kubectl on this cluster right now.";
const AUTOMATIC_OFF_HINT: string =
  "Automatic investigation is off for new incidents and alerts in this project.";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const MEMBER_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectMember,
];

function makeStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: "88888888-0000-4000-8000-000000000008",
      name: "Kubernetes AI agent",
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: true, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: "2026-09-22T10:00:30.000Z",
    ...overrides,
  };
}

function incidentInvestigation(): JSONObject {
  return {
    aiRunId: RUN_ID,
    status: AIRunStatus.Completed,
    analysisTldr:
      "The web deployment ran out of memory after the 14:02 rollout.",
    createdAt: "2026-09-22T09:00:00.000Z",
    completedAt: "2026-09-22T09:04:00.000Z",
    incident: { id: INCIDENT_ID, title: "Checkout is slow", number: 42 },
  };
}

function alertInvestigation(): JSONObject {
  return {
    aiRunId: SECOND_RUN_ID,
    status: AIRunStatus.Running,
    analysisTldr: null,
    createdAt: "2026-09-22T09:30:00.000Z",
    completedAt: null,
    alert: { id: ALERT_ID, title: "Pod restarts in api" },
  };
}

function subjectlessInvestigation(): JSONObject {
  return {
    aiRunId: THIRD_RUN_ID,
    status: AIRunStatus.Error,
    createdAt: "2026-09-22T08:00:00.000Z",
  };
}

function waitingFix(): JSONObject {
  return {
    id: FIX_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    executionMode: "Suggest",
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    rationale: "Restart the web deployment to clear the leaked connections.",
    createdAt: "2026-09-22T09:05:00.000Z",
    incidentId: INCIDENT_ID,
    alertId: null,
    approvedAt: null,
  };
}

function appliedFix(): JSONObject {
  return {
    id: SECOND_FIX_ID,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    executionMode: "FullAuto",
    suggestionType: AutoRemediationSuggestionType.Runbook,
    rationale: "Scale api back to 3 replicas.",
    createdAt: "2026-09-22T09:35:00.000Z",
    incidentId: null,
    alertId: ALERT_ID,
    approvedAt: null,
  };
}

function fullLogs(): JSONObject {
  return {
    investigations: [
      incidentInvestigation(),
      alertInvestigation(),
      subjectlessInvestigation(),
    ],
    fixes: [waitingFix(), appliedFix()],
    commandCounts: { investigation: 1717, remediation: 2929 },
  };
}

function emptyLogs(): JSONObject {
  return {
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

/*
 * A request that fails the way a dropped connection does. Thrown from inside
 * the async body rather than returned as a pre-built rejected promise, so no
 * unhandled rejection is reported between construction and the await.
 */
function networkError(): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    throw new Error("Network Error");
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let getListSpy: ReturnType<typeof jest.spyOn>;
let jobs: Array<RunnerJob> = [];
let logsAnswers: Array<Answer> = [];
let statusAnswer: Answer = ok(makeStatus());

/*
 * Answers the logs route with the queued answers in order (the last one
 * repeats) and the status route with statusAnswer.
 */
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

type JobOverrides = {
  [Key in keyof RunnerJob]?: RunnerJob[Key] | undefined;
};

function makeJob(id: string, overrides: JobOverrides = {}): RunnerJob {
  return Object.assign(
    new RunnerJob(),
    {
      _id: id,
      createdAt: new Date("2026-09-22T09:59:00Z"),
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.Kubectl,
      status: RunnerJobStatus.Succeeded,
      payload: { displayCommand: `kubectl get pods -n web-${id}` },
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

// Lets a test move the router to another cluster's page, as a link would.
let navigate: NavigateFunction | undefined;

function NavigationProbe(): React.ReactElement {
  navigate = useNavigate();
  return <></>;
}

function openLogsPage(): void {
  goTo(LOGS_PATH);

  render(
    <MemoryRouter initialEntries={[LOGS_PATH]}>
      <NavigationProbe />
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS])}
          element={
            <KubernetesClusterAILogs
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS] as Route
              }
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
  const anchor: HTMLAnchorElement | null = element.closest("a");
  if (!anchor) {
    throw new Error(`"${element.textContent}" is not inside a link.`);
  }
  return anchor.getAttribute("href") || "";
}

function investigationRows(): Array<HTMLElement> {
  return screen.queryAllByTestId("ai-logs-investigation");
}

function fixRows(): Array<HTMLElement> {
  return screen.queryAllByTestId("ai-logs-fix");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant(MEMBER_PERMISSIONS);

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

describe("parseKubernetesAiLogs", () => {
  test("reads the shape the logs route returns", () => {
    const parsed: KubernetesAiLogs | null = parseKubernetesAiLogs(fullLogs());

    expect(parsed).not.toBeNull();
    expect(parsed!.investigations).toEqual([
      {
        aiRunId: RUN_ID,
        status: AIRunStatus.Completed,
        analysisTldr:
          "The web deployment ran out of memory after the 14:02 rollout.",
        reportSummary: null,
        createdAt: "2026-09-22T09:00:00.000Z",
        completedAt: "2026-09-22T09:04:00.000Z",
        incident: { id: INCIDENT_ID, title: "Checkout is slow", number: 42 },
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
        alert: { id: ALERT_ID, title: "Pod restarts in api" },
      },
      {
        aiRunId: THIRD_RUN_ID,
        status: AIRunStatus.Error,
        analysisTldr: null,
        reportSummary: null,
        createdAt: "2026-09-22T08:00:00.000Z",
        completedAt: null,
        incident: null,
        alert: null,
      },
    ]);
    expect(parsed!.fixes).toEqual([
      {
        id: FIX_ID,
        status: AutoRemediationSuggestionStatus.Suggested,
        executionMode: "Suggest",
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        rationale:
          "Restart the web deployment to clear the leaked connections.",
        createdAt: "2026-09-22T09:05:00.000Z",
        incidentId: INCIDENT_ID,
        alertId: null,
        approvedAt: null,
      },
      {
        id: SECOND_FIX_ID,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        executionMode: "FullAuto",
        suggestionType: AutoRemediationSuggestionType.Runbook,
        rationale: "Scale api back to 3 replicas.",
        createdAt: "2026-09-22T09:35:00.000Z",
        incidentId: null,
        alertId: ALERT_ID,
        approvedAt: null,
      },
    ]);
  });

  test.each([
    ["null", null],
    ["a string", "logs"],
    ["a number", 7],
    ["an array", [incidentInvestigation()]],
    ["an object with neither list", { commandCounts: {} }],
    ["an object whose lists are not arrays", { investigations: {}, fixes: 3 }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseKubernetesAiLogs(value)).toBeNull();
  });

  test("reads a missing list as empty when the other one is there", () => {
    expect(
      parseKubernetesAiLogs({ investigations: [incidentInvestigation()] }),
    ).toEqual({
      investigations: [expect.objectContaining({ aiRunId: RUN_ID })],
      fixes: [],
    });
    expect(parseKubernetesAiLogs({ fixes: [waitingFix()] })).toEqual({
      investigations: [],
      fixes: [expect.objectContaining({ id: FIX_ID })],
    });
  });

  test("drops rows without an id, which have nothing to key or link by", () => {
    const parsed: KubernetesAiLogs | null = parseKubernetesAiLogs({
      investigations: [
        null,
        "run",
        { status: AIRunStatus.Completed },
        { aiRunId: "   ", status: AIRunStatus.Completed },
        { aiRunId: 12, status: AIRunStatus.Completed },
        incidentInvestigation(),
      ],
      fixes: [
        [],
        { status: AutoRemediationSuggestionStatus.Suggested },
        { id: "", status: AutoRemediationSuggestionStatus.Suggested },
        waitingFix(),
      ],
    });

    expect(
      parsed!.investigations.map(
        (row: KubernetesAiLogsInvestigation): string => {
          return row.aiRunId;
        },
      ),
    ).toEqual([RUN_ID]);
    expect(parsed!.fixes.length).toBe(1);
    expect(parsed!.fixes[0]!.id).toBe(FIX_ID);
  });

  // The contract (KubernetesClusterAiLogs.ts) leaves status optional.
  test("keeps a row whose status is missing, with the status as null", () => {
    const parsed: KubernetesAiLogs | null = parseKubernetesAiLogs({
      investigations: [
        { aiRunId: RUN_ID },
        { aiRunId: SECOND_RUN_ID, status: "" },
      ],
      fixes: [{ id: FIX_ID, status: 5 }],
    });

    expect(
      parsed!.investigations.map(
        (row: KubernetesAiLogsInvestigation): string | null => {
          return row.status;
        },
      ),
    ).toEqual([null, null]);
    expect(parsed!.fixes[0]!.status).toBeNull();
  });

  test("accepts ids and dates in the server's serialized envelope", () => {
    const parsed: KubernetesAiLogs | null = parseKubernetesAiLogs({
      investigations: [
        {
          aiRunId: { _type: "ObjectID", value: RUN_ID },
          status: AIRunStatus.Completed,
          createdAt: { _type: "DateTime", value: "2026-09-22T09:00:00.000Z" },
          incident: {
            id: { _type: "ObjectID", value: INCIDENT_ID },
            title: "Checkout is slow",
            number: 42,
          },
        },
      ],
      fixes: [
        {
          id: { _type: "ObjectID", value: FIX_ID },
          status: AutoRemediationSuggestionStatus.Dismissed,
          alertId: { _type: "ObjectID", value: ALERT_ID },
        },
      ],
    });

    expect(parsed!.investigations[0]).toEqual(
      expect.objectContaining({
        aiRunId: RUN_ID,
        createdAt: "2026-09-22T09:00:00.000Z",
        incident: { id: INCIDENT_ID, title: "Checkout is slow", number: 42 },
      }),
    );
    expect(parsed!.fixes[0]).toEqual(
      expect.objectContaining({ id: FIX_ID, alertId: ALERT_ID }),
    );
  });

  test("reads a subject without an id, a bad number or blank text as missing", () => {
    const parsed: KubernetesAiLogs | null = parseKubernetesAiLogs({
      investigations: [
        {
          aiRunId: RUN_ID,
          status: AIRunStatus.Completed,
          analysisTldr: "   ",
          incident: { title: "No id" },
          alert: { id: "", title: "Blank id" },
        },
        {
          aiRunId: SECOND_RUN_ID,
          status: AIRunStatus.Completed,
          incident: { id: INCIDENT_ID, title: 5, number: Number.NaN },
        },
        {
          aiRunId: THIRD_RUN_ID,
          status: AIRunStatus.Completed,
          incident: { id: INCIDENT_ID, number: "42" },
        },
      ],
    });

    expect(parsed!.investigations[0]).toEqual(
      expect.objectContaining({
        analysisTldr: null,
        reportSummary: null,
        incident: null,
        alert: null,
      }),
    );
    expect(parsed!.investigations[1]!.incident).toEqual({
      id: INCIDENT_ID,
      title: "",
      number: null,
    });
    expect(parsed!.investigations[2]!.incident).toEqual({
      id: INCIDENT_ID,
      title: "",
      number: null,
    });
  });
});

describe("status words", () => {
  test("every investigation status has its own plain label and a colour", () => {
    for (const status of Object.values(AIRunStatus)) {
      const look: { label: string } = getInvestigationStatusLook(status);
      expect(look.label.trim().length).toBeGreaterThan(0);
    }

    expect(getInvestigationStatusLook(AIRunStatus.Completed)).toEqual({
      label: "Completed",
      color: Green500,
    });
    expect(getInvestigationStatusLook(AIRunStatus.Running)).toEqual({
      label: "Investigating",
      color: Yellow500,
    });
    expect(getInvestigationStatusLook(AIRunStatus.Queued).color).toBe(
      Yellow500,
    );
    expect(getInvestigationStatusLook(AIRunStatus.Error)).toEqual({
      label: "Failed",
      color: Red500,
    });
    expect(getInvestigationStatusLook(AIRunStatus.Stale)).toEqual({
      label: "Timed out",
      color: Gray500,
    });
  });

  test("every fix status has its own plain label", () => {
    const labels: Array<string> = Object.values(
      AutoRemediationSuggestionStatus,
    ).map((status: AutoRemediationSuggestionStatus): string => {
      return getFixStatusLook(status).label;
    });

    expect(new Set(labels).size).toBe(labels.length);
    expect(getFixStatusLook(AutoRemediationSuggestionStatus.Suggested)).toEqual(
      { label: "Waiting for approval", color: Yellow500 },
    );
    expect(getFixStatusLook(AutoRemediationSuggestionStatus.Approved)).toEqual({
      label: "Applied after approval",
      color: Green500,
    });
    expect(
      getFixStatusLook(AutoRemediationSuggestionStatus.AutoExecuted),
    ).toEqual({ label: "Applied automatically", color: Green500 });
    expect(getFixStatusLook(AutoRemediationSuggestionStatus.Dismissed)).toEqual(
      { label: "Dismissed", color: Gray500 },
    );
  });

  test("a status a newer server added shows as it is, in a neutral pill", () => {
    expect(getInvestigationStatusLook("Paused")).toEqual({
      label: "Paused",
      color: Gray500,
    });
    expect(getFixStatusLook("Reverted")).toEqual({
      label: "Reverted",
      color: Gray500,
    });
  });

  test("names the kind of fix", () => {
    expect(describeFixType(AutoRemediationSuggestionType.CommandPlan)).toBe(
      "Command plan",
    );
    expect(describeFixType(AutoRemediationSuggestionType.Runbook)).toBe(
      "Runbook",
    );
    expect(describeFixType(null)).toBeNull();
    expect(describeFixType("Something")).toBeNull();
  });
});

describe("investigation rows", () => {
  function investigation(
    overrides: Partial<KubernetesAiLogsInvestigation> = {},
  ): KubernetesAiLogsInvestigation {
    return {
      aiRunId: RUN_ID,
      status: AIRunStatus.Completed,
      analysisTldr: null,
      reportSummary: null,
      createdAt: null,
      completedAt: null,
      incident: null,
      alert: null,
      ...overrides,
    };
  }

  test("lead with the incident, its number and its title", () => {
    expect(
      describeInvestigationSubject(
        investigation({
          incident: { id: INCIDENT_ID, title: "Checkout is slow", number: 42 },
        }),
      ),
    ).toEqual({
      text: "Incident #42: Checkout is slow",
      incidentId: INCIDENT_ID,
      alertId: null,
    });
    expect(
      describeInvestigationSubject(
        investigation({
          incident: { id: INCIDENT_ID, title: "", number: null },
        }),
      ).text,
    ).toBe("Incident");
  });

  test("lead with the alert when there is no incident", () => {
    expect(
      describeInvestigationSubject(
        investigation({ alert: { id: ALERT_ID, title: "Pod restarts" } }),
      ),
    ).toEqual({
      text: "Alert: Pod restarts",
      incidentId: null,
      alertId: ALERT_ID,
    });
    expect(
      describeInvestigationSubject(
        investigation({ alert: { id: ALERT_ID, title: "" } }),
      ).text,
    ).toBe("Alert");
  });

  test("say only 'Investigation' when the run has no incident or alert", () => {
    expect(describeInvestigationSubject(investigation())).toEqual({
      text: "Investigation",
      incidentId: null,
      alertId: null,
    });
  });

  test("show the finding, or why there is none yet", () => {
    expect(
      getInvestigationSummary(investigation({ analysisTldr: "OOM killed." })),
    ).toBe("OOM killed.");
    expect(
      getInvestigationSummary(investigation({ status: AIRunStatus.Running })),
    ).toBe("Still investigating.");
    expect(
      getInvestigationSummary(investigation({ status: AIRunStatus.Queued })),
    ).toBe("Still investigating.");
    expect(
      getInvestigationSummary(investigation({ status: AIRunStatus.Error })),
    ).toBe("No summary was recorded.");
  });

  /*
   * Regression: every row of the cluster's page read "No summary was
   * recorded." for runs whose best-effort TL;DR call had failed, though
   * each had posted a report with a Summary of its own.
   */
  test("show the report's own summary when there is no TL;DR, and the TL;DR over it", () => {
    expect(
      getInvestigationSummary(
        investigation({ reportSummary: "Pods are Pending: no node fits." }),
      ),
    ).toBe("Pods are Pending: no node fits.");
    expect(
      getInvestigationSummary(
        investigation({
          analysisTldr: "OOM killed.",
          reportSummary: "Pods are Pending: no node fits.",
        }),
      ),
    ).toBe("OOM killed.");
  });
});

describe("the pointer to the AI agent page", () => {
  test("is there when AI cannot run kubectl on the cluster", () => {
    expect(getAgentPageHint(makeStatus({ isInvestigationReady: false }))).toBe(
      NOT_READY_HINT,
    );
  });

  test("is there when the project investigates neither incidents nor alerts", () => {
    expect(
      getAgentPageHint(
        makeStatus({
          automaticInvestigation: { incidents: false, alerts: false },
        }),
      ),
    ).toBe(AUTOMATIC_OFF_HINT);
  });

  test("names kubectl first when both are true", () => {
    expect(
      getAgentPageHint(
        makeStatus({
          isInvestigationReady: false,
          automaticInvestigation: { incidents: false, alerts: false },
        }),
      ),
    ).toBe(NOT_READY_HINT);
  });

  test("is not there when AI is ready and one kind is investigated", () => {
    expect(getAgentPageHint(makeStatus())).toBeNull();
    expect(
      getAgentPageHint(
        makeStatus({
          automaticInvestigation: { incidents: false, alerts: true },
        }),
      ),
    ).toBeNull();
  });

  test("is not there without a status, or from a server that does not report the opt-ins", () => {
    expect(getAgentPageHint(null)).toBeNull();
    expect(
      getAgentPageHint(
        makeStatus({
          // An older server sends no opt-ins, which the current type requires.
          automaticInvestigation:
            undefined as unknown as KubernetesClusterAiAccessStatus["automaticInvestigation"],
        }),
      ),
    ).toBeNull();
  });
});

describe("kubectl command rows", () => {
  test("tell an investigation from a connection test and a fix", () => {
    expect(
      describeKubectlJobOrigin({
        origin: RunnerJobOrigin.AiInvestigation,
        aiRunId: new ObjectID(RUN_ID),
      }),
    ).toBe("Investigation (read-only)");
    expect(
      describeKubectlJobOrigin({ origin: RunnerJobOrigin.AiInvestigation }),
    ).toBe("Connection test (read-only)");
    expect(
      describeKubectlJobOrigin({ origin: RunnerJobOrigin.AiRemediation }),
    ).toBe("Fix");
    expect(describeKubectlJobOrigin({ origin: "Runbook" })).toBe("Runbook");
    expect(describeKubectlJobOrigin({})).toBe("");
  });

  test("keep the preferences key the old AI page used", () => {
    expect(KUBECTL_JOBS_TABLE_PREFERENCES_KEY).toBe(
      "kubernetes-cluster-ai-kubectl-jobs",
    );
    expect(KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiInvestigation]).toBe(
      "Investigation or connection test",
    );
    expect(KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiRemediation]).toBe(
      "Fix",
    );
  });
});

describe("AI Logs page", () => {
  test("shows its title and subtitle, and a loader until the logs arrive", async () => {
    let release: (() => void) | undefined;
    serve(async (): Promise<HTTPResponse<JSONObject>> => {
      await new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      return new HTTPResponse<JSONObject>(200, fullLogs(), {});
    });
    openLogsPage();

    expect(screen.getByText(AI_LOGS_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AI_LOGS_PAGE_SUBTITLE)).toBeInTheDocument();
    expect(await findTestId("ai-logs-loading")).toBeInTheDocument();
    expect(screen.queryByText("Investigations")).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(release).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );
    release!();

    expect(await findText("Investigations")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-logs-loading")).not.toBeInTheDocument();
  });

  test("asks the logs and status routes about this cluster", async () => {
    openLogsPage();
    await findText("Investigations");

    const logsRequests: Array<JSONObject> = postsTo(LOGS_ROUTE);
    expect(logsRequests.length).toBe(1);
    expect(logsRequests[0]!["data"]).toEqual({ clusterId: CLUSTER_ID });
    expect(String(logsRequests[0]!["url"])).toContain(
      "/api/kubernetes-cluster/ai-access/logs",
    );

    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE).length).toBe(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(postsTo(STATUS_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID,
    });
  });

  test("lists investigations with their subject link, finding, status and time", async () => {
    openLogsPage();
    await findText("Investigations");

    const rows: Array<HTMLElement> = investigationRows();
    expect(rows.length).toBe(3);

    const incidentRow: HTMLElement = rows[0]!;
    expect(
      hrefOf(within(incidentRow).getByText("Incident #42: Checkout is slow")),
    ).toBe(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`);
    expect(
      within(incidentRow).getByText(
        "The web deployment ran out of memory after the 14:02 rollout.",
      ),
    ).toBeInTheDocument();
    expect(within(incidentRow).getByText("Completed")).toBeInTheDocument();
    const time: HTMLElement | null = incidentRow.querySelector("time");
    expect(time).not.toBeNull();
    expect(time!.getAttribute("dateTime")).toBe("2026-09-22T09:00:00.000Z");
    expect(time!.textContent).toMatch(/ago|in /);

    const alertRow: HTMLElement = rows[1]!;
    expect(
      hrefOf(within(alertRow).getByText("Alert: Pod restarts in api")),
    ).toBe(`/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`);
    expect(within(alertRow).getByText("Investigating")).toBeInTheDocument();
    expect(
      within(alertRow).getByText("Still investigating."),
    ).toBeInTheDocument();

    const subjectlessRow: HTMLElement = rows[2]!;
    expect(
      within(subjectlessRow).getByText("Investigation").closest("a"),
    ).toBeNull();
    expect(within(subjectlessRow).getByText("Failed")).toBeInTheDocument();
    expect(
      within(subjectlessRow).getByText("No summary was recorded."),
    ).toBeInTheDocument();
  });

  test("lists fixes with their status, reason, kind and a link to where they were proposed", async () => {
    openLogsPage();
    await findText("Fixes");

    const rows: Array<HTMLElement> = fixRows();
    expect(rows.length).toBe(2);

    const waiting: HTMLElement = rows[0]!;
    expect(
      within(waiting).getByText("Waiting for approval"),
    ).toBeInTheDocument();
    expect(within(waiting).getByText("Command plan")).toBeInTheDocument();
    expect(
      within(waiting).getByText(
        "Restart the web deployment to clear the leaked connections.",
      ),
    ).toBeInTheDocument();
    expect(hrefOf(within(waiting).getByText("Open incident"))).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
    );

    const applied: HTMLElement = rows[1]!;
    expect(
      within(applied).getByText("Applied automatically"),
    ).toBeInTheDocument();
    expect(within(applied).getByText("Runbook")).toBeInTheDocument();
    expect(hrefOf(within(applied).getByText("Open alert"))).toBe(
      `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`,
    );
  });

  test("a fix with no incident or alert has no link and says when no reason was recorded", async () => {
    serve(
      ok({
        investigations: [incidentInvestigation()],
        fixes: [
          {
            id: FIX_ID,
            status: AutoRemediationSuggestionStatus.NoneApplicable,
            createdAt: "2026-09-22T09:05:00.000Z",
          },
        ],
      }),
    );
    openLogsPage();
    await findText("Fixes");

    const row: HTMLElement = fixRows()[0]!;
    expect(within(row).getByText("No fix found")).toBeInTheDocument();
    expect(
      within(row).getByText("No reason was recorded."),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("link")).toBeNull();
  });

  test("shows no KPI tiles: the command counts the route returns are not rendered", async () => {
    openLogsPage();
    await findText("Investigations");

    expect(screen.queryByText(/1717/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2929/)).not.toBeInTheDocument();
  });

  test("shows a row without a status, just without a status pill", async () => {
    serve(
      ok({
        investigations: [
          {
            aiRunId: RUN_ID,
            analysisTldr: "Found it.",
            incident: {
              id: INCIDENT_ID,
              title: "Checkout is slow",
              number: 42,
            },
          },
        ],
        fixes: [
          { id: FIX_ID, rationale: "Restart web.", incidentId: INCIDENT_ID },
        ],
      }),
    );
    openLogsPage();

    await findText("Found it.");
    const investigation: HTMLElement = investigationRows()[0]!;
    const fix: HTMLElement = fixRows()[0]!;
    expect(
      within(investigation).getByText("Incident #42: Checkout is slow"),
    ).toBeInTheDocument();
    expect(within(fix).getByText("Restart web.")).toBeInTheDocument();
    for (const row of [investigation, fix]) {
      for (const label of [
        "Completed",
        "Failed",
        "Waiting for approval",
        "Dismissed",
      ]) {
        expect(within(row).queryByText(label)).not.toBeInTheDocument();
      }
    }
  });

  /*
   * Regression for the screenshot behind the rename: a cluster whose every
   * investigation had a report but no TL;DR showed "No summary was
   * recorded." on each row.
   */
  test("an investigation without a TL;DR shows what its report found, not 'No summary was recorded.'", async () => {
    serve(
      ok({
        investigations: [
          {
            aiRunId: RUN_ID,
            status: AIRunStatus.Completed,
            reportSummary:
              "The oneuptime-home deployment has 0 of 1 ready replicas: its image tag does not exist.",
            createdAt: "2026-09-22T09:00:00.000Z",
            alert: {
              id: ALERT_ID,
              title: "[K8s] Deployment Replica Mismatch - oneuptime-test",
            },
          },
          {
            aiRunId: SECOND_RUN_ID,
            status: AIRunStatus.Completed,
            createdAt: "2026-09-22T08:00:00.000Z",
            incident: { id: INCIDENT_ID, title: "ghfghgf", number: 2 },
          },
        ],
        fixes: [],
      }),
    );
    openLogsPage();

    const [withReport, without]: Array<HTMLElement> = await waitFor(
      () => {
        const rows: Array<HTMLElement> = investigationRows();
        expect(rows).toHaveLength(2);
        return rows;
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      within(withReport!).getByText(
        "The oneuptime-home deployment has 0 of 1 ready replicas: its image tag does not exist.",
      ),
    ).toBeInTheDocument();
    expect(
      within(withReport!).queryByText("No summary was recorded."),
    ).not.toBeInTheDocument();
    // A run with neither still says so honestly.
    expect(
      within(without!).getByText("No summary was recorded."),
    ).toBeInTheDocument();
  });

  test("renders server text as text, never as markup", async () => {
    serve(
      ok({
        investigations: [
          {
            ...incidentInvestigation(),
            analysisTldr: '<img src=x onerror="window.pwned=1">',
            incident: {
              id: INCIDENT_ID,
              title: "<script>window.pwned=1</script>",
              number: 1,
            },
          },
        ],
        fixes: [
          { ...waitingFix(), rationale: "<b>bold</b> [link](javascript:1)" },
        ],
      }),
    );
    openLogsPage();

    expect(
      await findText('<img src=x onerror="window.pwned=1">'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Incident #1: <script>window.pwned=1</script>"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("<b>bold</b> [link](javascript:1)"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  describe("empty and partial states", () => {
    test("shows one 'Nothing yet' state instead of two empty lists", async () => {
      serve(ok(emptyLogs()));
      openLogsPage();

      expect(await findText(AI_LOGS_EMPTY_TITLE)).toBeInTheDocument();
      expect(screen.getByText(AI_LOGS_EMPTY_DESCRIPTION)).toBeInTheDocument();
      expect(screen.queryByText("Investigations")).not.toBeInTheDocument();
      expect(screen.queryByText("Fixes")).not.toBeInTheDocument();
      // The command history stays: connection tests land there too.
      expect(
        await findText(toHeadline(KUBECTL_COMMANDS_EMPTY_MESSAGE)),
      ).toBeInTheDocument();
    });

    test("points at the AI agent page when AI cannot run kubectl here", async () => {
      serve(ok(emptyLogs()), ok(makeStatus({ isInvestigationReady: false })));
      openLogsPage();

      const hint: HTMLElement = await findTestId("ai-logs-agent-hint");
      expect(hint).toHaveTextContent(NOT_READY_HINT);
      expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
        AGENT_HREF,
      );
      expect(
        screen.getByTestId("kubernetes-ai-logs-empty-footer"),
      ).toContainElement(hint);
    });

    test("points at the AI agent page when automatic investigation is off", async () => {
      serve(
        ok(emptyLogs()),
        ok(
          makeStatus({
            automaticInvestigation: { incidents: false, alerts: false },
          }),
        ),
      );
      openLogsPage();

      const hint: HTMLElement = await findTestId("ai-logs-agent-hint");
      expect(hint).toHaveTextContent(AUTOMATIC_OFF_HINT);
      expect(hrefOf(within(hint).getByText("Open the AI agent page"))).toBe(
        AGENT_HREF,
      );
    });

    test("does not point anywhere when AI is ready", async () => {
      serve(ok(emptyLogs()));
      openLogsPage();

      await findText(AI_LOGS_EMPTY_TITLE);
      await waitFor(
        () => {
          expect(postsTo(STATUS_ROUTE).length).toBe(1);
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(
        screen.queryByTestId("ai-logs-agent-hint"),
      ).not.toBeInTheDocument();
    });

    for (const [label, answer] of [
      ["fails", networkError()],
      ["is refused", httpError(403, "You do not have permission.")],
      ["is not a status", ok({ something: "else" })],
    ] as Array<[string, Answer]>) {
      test(`still renders when the status request ${label}, just without the pointer`, async () => {
        serve(ok(emptyLogs()), answer);
        openLogsPage();

        expect(await findText(AI_LOGS_EMPTY_TITLE)).toBeInTheDocument();
        await waitFor(
          () => {
            expect(postsTo(STATUS_ROUTE).length).toBe(1);
          },
          { timeout: WAIT_TIMEOUT },
        );
        expect(
          screen.queryByTestId("ai-logs-agent-hint"),
        ).not.toBeInTheDocument();
      });
    }

    test("shows the pointer above the lists when there is history but AI is not ready", async () => {
      serve(ok(fullLogs()), ok(makeStatus({ isInvestigationReady: false })));
      openLogsPage();

      const hint: HTMLElement = await findTestId("ai-logs-agent-hint");
      expect(hint).toHaveTextContent(NOT_READY_HINT);
      expect(screen.getByText("Investigations")).toBeInTheDocument();
      expect(screen.queryByText(AI_LOGS_EMPTY_TITLE)).not.toBeInTheDocument();
      // Before the lists, so it is read first.
      expect(
        hint.compareDocumentPosition(screen.getByText("Investigations")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("says so in the Fixes list when only investigations exist", async () => {
      serve(ok({ investigations: [incidentInvestigation()], fixes: [] }));
      openLogsPage();

      expect(await findTestId("ai-logs-no-fixes")).toHaveTextContent(
        "No fixes yet.",
      );
      expect(investigationRows().length).toBe(1);
      expect(
        screen.queryByTestId("ai-logs-no-investigations"),
      ).not.toBeInTheDocument();
    });

    test("says so in the Investigations list when only fixes exist", async () => {
      serve(ok({ investigations: [], fixes: [waitingFix()] }));
      openLogsPage();

      expect(await findTestId("ai-logs-no-investigations")).toHaveTextContent(
        "No investigations yet.",
      );
      expect(fixRows().length).toBe(1);
    });
  });

  /*
   * Moving from one cluster's AI Logs to another's keeps the page
   * mounted. An answer about the cluster the user just left must not paint
   * over the one they are looking at.
   */
  test("drops a late answer about the cluster the user navigated away from", async () => {
    const OTHER_CLUSTER_ID: string = "44444444-0000-4000-8000-0000000000ff";
    let answerFirstCluster: (() => void) | undefined;

    postSpy.mockImplementation(
      async (
        request: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = String((request as JSONObject)["url"]);
        const clusterId: string = String(
          ((request as JSONObject)["data"] as JSONObject)["clusterId"],
        );
        if (url.endsWith(STATUS_ROUTE)) {
          return new HTTPResponse<JSONObject>(
            200,
            makeStatus({ clusterId }) as unknown as JSONObject,
            {},
          );
        }
        if (clusterId === CLUSTER_ID) {
          await new Promise<void>((resolve: () => void) => {
            answerFirstCluster = resolve;
          });
          return new HTTPResponse<JSONObject>(
            200,
            { investigations: [incidentInvestigation()], fixes: [] },
            {},
          );
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
        expect(answerFirstCluster).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    act(() => {
      navigate!(
        `/dashboard/${PROJECT_ID}/kubernetes/${OTHER_CLUSTER_ID}/ai/logs`,
      );
    });

    expect(await findText("Alert: Pod restarts in api")).toBeInTheDocument();
    expect(
      postsTo(LOGS_ROUTE).map((request: JSONObject): unknown => {
        return (request["data"] as JSONObject)["clusterId"];
      }),
    ).toEqual([CLUSTER_ID, OTHER_CLUSTER_ID]);

    await act(async () => {
      answerFirstCluster!();
      await Promise.resolve();
    });

    expect(screen.getByText("Alert: Pod restarts in api")).toBeInTheDocument();
    expect(
      screen.queryByText("Incident #42: Checkout is slow"),
    ).not.toBeInTheDocument();
  });

  describe("errors", () => {
    test("shows the server's message and retries on request", async () => {
      serve([
        httpError(500, "The logs service is unavailable."),
        ok(fullLogs()),
      ]);
      openLogsPage();

      expect(
        await findText("The logs service is unavailable."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Investigations")).not.toBeInTheDocument();

      fireEvent.click(
        within(screen.getByTestId("ai-logs-error")).getByTestId(
          "refresh-button",
        ),
      );

      expect(await findText("Investigations")).toBeInTheDocument();
      expect(postsTo(LOGS_ROUTE).length).toBe(2);
      expect(
        screen.queryByText("The logs service is unavailable."),
      ).not.toBeInTheDocument();
    });

    test("explains a body it cannot read", async () => {
      serve(ok({ unexpected: true }));
      openLogsPage();

      expect(
        await findText("The server returned AI logs this page cannot read."),
      ).toBeInTheDocument();
    });

    test("survives a dropped connection", async () => {
      serve(networkError());
      openLogsPage();

      const error: HTMLElement = await findTestId("ai-logs-error");
      expect(within(error).getByTestId("refresh-button")).toBeInTheDocument();
      expect(screen.queryByText("Investigations")).not.toBeInTheDocument();
      // The command history does not depend on the logs route.
      expect(
        await findText(toHeadline(KUBECTL_COMMANDS_EMPTY_MESSAGE)),
      ).toBeInTheDocument();
    });
  });

  describe("kubectl commands table", () => {
    test("asks for every column its cells read and labels rows from them", async () => {
      jobs = [
        makeJob("investigation", { aiRunId: new ObjectID(RUN_ID) }),
        makeJob("connection-test"),
        makeJob("failed", {
          aiRunId: new ObjectID(RUN_ID),
          status: RunnerJobStatus.Failed,
          exitCode: 1,
          errorMessage: "pods is forbidden: User cannot list resource",
        }),
      ];
      openLogsPage();

      expect(
        await findText("kubectl get pods -n web-investigation"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("kubectl get pods -n web-connection-test"),
      ).toBeInTheDocument();

      const whyCells: Array<string> = screen
        .getAllByText(/^(Investigation|Connection test) \(read-only\)$/)
        .map((cell: HTMLElement): string => {
          return cell.textContent || "";
        });
      expect(whyCells).toEqual([
        "Investigation (read-only)",
        "Connection test (read-only)",
        "Investigation (read-only)",
      ]);

      expect(screen.getByText("Failed (exit 1)")).toBeInTheDocument();
      expect(screen.getAllByText("Succeeded (exit 0)").length).toBe(2);
      expect(
        screen.getByText("pods is forbidden: User cannot list resource"),
      ).toBeInTheDocument();

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
        expect.objectContaining({ stepType: RunbookStepType.Kubectl }),
      );
      expect(String(request?.query?.["kubernetesClusterId"])).toBe(CLUSTER_ID);
    });

    test("labels a fix command", async () => {
      jobs = [
        makeJob("fix", {
          origin: RunnerJobOrigin.AiRemediation,
          aiRunId: new ObjectID(RUN_ID),
          payload: {
            displayCommand: "kubectl rollout restart deployment/web -n web",
          },
        }),
      ];
      openLogsPage();

      const commandCell: HTMLElement = await findText(
        "kubectl rollout restart deployment/web -n web",
      );
      const row: HTMLElement | null = commandCell.closest("tr");
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText("Fix")).toBeInTheDocument();
    });

    test("is titled 'kubectl commands' and says when nothing ran yet", async () => {
      openLogsPage();

      expect(
        await findText(toHeadline(KUBECTL_COMMANDS_EMPTY_MESSAGE)),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(KUBECTL_COMMANDS_CARD_TITLE).length,
      ).toBeGreaterThan(0);
    });
  });

  /*
   * Settings roles and ReadKubernetesCluster may open the cluster but not
   * read RunnerJob rows. RunnerJob's ACL is not widened; they get an
   * explanation and no failing request — while the investigations and fixes,
   * which the server summarises behind the cluster's own read gate, still
   * show.
   */
  describe("command history permission", () => {
    for (const permission of [
      Permission.SettingsAdmin,
      Permission.SettingsViewer,
      Permission.ReadKubernetesCluster,
    ]) {
      test(`explains instead of failing for ${permission}`, async () => {
        grant([...BASE_PERMISSIONS, permission]);
        openLogsPage();

        const note: HTMLElement = await findTestId(
          "kubectl-jobs-permission-note",
        );
        expect(note).toHaveTextContent("Runbook Viewer");
        expect(note).toHaveTextContent("Viewer");
        expect(
          screen.getByText(KUBECTL_COMMANDS_CARD_TITLE),
        ).toBeInTheDocument();
        expect(jobListRequest()).toBeUndefined();

        expect(await findText("Investigations")).toBeInTheDocument();
        expect(investigationRows().length).toBe(3);
      });
    }

    for (const permission of [Permission.ProjectMember, Permission.Viewer]) {
      test(`shows the table for ${permission}`, async () => {
        grant([...BASE_PERMISSIONS, permission]);
        openLogsPage();

        await findText(toHeadline(KUBECTL_COMMANDS_EMPTY_MESSAGE));
        expect(
          screen.queryByTestId("kubectl-jobs-permission-note"),
        ).not.toBeInTheDocument();
        expect(jobListRequest()?.query).toEqual(
          expect.objectContaining({ stepType: RunbookStepType.Kubectl }),
        );
      });
    }
  });
});
