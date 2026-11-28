jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// Billing on, so the bill and the plan are asked as on OneUptime Cloud.
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIRunService from "../../../Server/Services/AIRunService";
import AIService from "../../../Server/Services/AIService";
import AlertService from "../../../Server/Services/AlertService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeFixOnItsWay from "../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import CodeFixReadiness from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskAccess from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import {
  CODE_TASK_PLAN_REQUIRED_MESSAGE,
  CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import PrivateRecordWriteCheck from "../../../Server/Utils/Permission/PrivateRecordWriteCheck";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CodeRepositoryRunnerChoiceKind } from "../../../Types/Runner/CodeRepositoryRunner";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Utils/Suggestions/CodeFixRepositoryPick";
import {
  parseInvestigationCodeFixSuggestion,
  PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import {
  parseTelemetryImprovementSuggestion,
  PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
} from "../../../Utils/Suggestions/TelemetryImprovementSuggestion";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import RemediationRulePullRequests from "../../../Server/Utils/AI/SRE/RemediationRulePullRequests";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * FIX THE CAUSE AND IMPROVE LOGGING / TRACING WITH AI, HELD TO THE
 * REPOSITORIES THE PERSON MAY USE IN CODE - THROUGH THE SERVER'S OWN ROUTES,
 * AS THE BUTTONS SEND THEM (#11209).
 *
 * #11075 held a trace's Fix performance with AI to the rule every Fix with
 * AI follows: the person may use the repository the fix works in, in Code -
 * read it, and ask OneUptime AI to work in it. The two other buttons that
 * start a code task on a person's behalf did not:
 *
 *   - an incident's or alert's Open fix pull request (Fix the Cause,
 *     POST /ai-investigation/create-fix-task) checked only that the person
 *     may read the record, then queued the run in whichever connected
 *     repository the record's monitor is named like - one they may not
 *     read, or may not ask AI in - and took no pick at all;
 *   - a service's Improve Logging and Improve Tracing
 *     (POST /ai-investigation/create-telemetry-improvement-task) the same,
 *     by the service's name.
 *
 * Here each route runs as the App serves it - Express, the body as the
 * Dashboard sends it, the error handler - and Code's own checks run for
 * real: the repositories are read under the caller's permissions through
 * the permission layer, from tables held in memory (CodeTaskAccess), the
 * run's repository is resolved by the server's resolver among them
 * (CodeFixRunRepository), and Code's gate (CodeTaskGate) answers from the
 * world below. What the run is about - the investigation and its report,
 * the record, the service, a fix already on its way, the lock and the
 * day's budget - is stood in for, and the run itself is written to a
 * stand-in of AIRunService.create, so the row the Runner would claim is
 * read back whole.
 *
 * The incident's monitor and the service are both named like `billing-api`,
 * so a run left to the resolver alone is made there.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11209000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: string = "11209000-0000-4000-8000-0000000000b1";
const ALERT_ID: string = "11209000-0000-4000-8000-0000000000b2";
const INVESTIGATION_ID: ObjectID = new ObjectID(
  "11209000-0000-4000-8000-0000000000c1",
);
const SERVICE_ID: string = "11209000-0000-4000-8000-0000000000d1";
const RUN_ID: ObjectID = new ObjectID("11209000-0000-4000-8000-0000000000f1");

// The project's connected repositories.
const BILLING_ID: string = "11209000-0000-4000-8000-0000000000a1";
const CHECKOUT_ID: string = "11209000-0000-4000-8000-0000000000a2";
const LEDGER_ID: string = "11209000-0000-4000-8000-0000000000a3";

// What the incident's monitor and the service are called.
const SERVICE_NAME: string = "billing-api";

const ANALYSIS: string =
  "## Root cause\n\nThe retry loop in the invoice writer never backs off.";

const PERMISSION_TO_READ_CODE_REFUSED: RegExp =
  /^You do not have permissions to read Code Repository/;

interface World {
  plan: PlanType | null;
  isSubscriptionUnpaid: boolean;
}

let world: World;
let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let codeRepositories: InMemoryTable;
// Every run the routes asked to be written, as AIRunService.create got it.
let created: Array<AIRun>;
let create: SpyInstance<typeof AIRunService.create>;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function repositoryRow(id: string, name: string): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: name,
    repositoryHostedAt: CodeRepositoryType.GitHub,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    gitHubAppInstallationId: "11209",
    labels: [],
  };
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function passSessionGuards(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
}

function monitorNamed(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = name;
  return monitor;
}

// The investigation the Remediation step shows: done, recommending a fix.
function investigation(): AIRun {
  const run: AIRun = new AIRun();
  run.id = INVESTIGATION_ID;
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.Investigation;
  run.status = AIRunStatus.Completed;
  run.completedAt = new Date("2026-11-27T09:00:00.000Z");
  run.codeFixRecommendation = AIRunCodeFixRecommendation.Recommended;
  run.taskContext = {
    sourceInvestigationRunId: INVESTIGATION_ID.toString(),
    sourceInvestigationAnalysisMarkdown: ANALYSIS,
  };
  return run;
}

// The plans a billed server sells, as its environment names them.
const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  // The router is built as the module loads, with the session guard above.
  const router: typeof import("../../../Server/API/AIInvestigationAPI").default =
    (await import("../../../Server/API/AIInvestigationAPI")).default;
  await server.start([router]);
});

afterAll(async () => {
  await server.stop();

  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  server.requests.length = 0;
  created = [];
  caller = callerWith([Permission.ProjectMember]);
  world = { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  // The project's three connected repositories, read for real.
  codeRepositories = useInMemoryTable(asService(CodeRepositoryService), [
    repositoryRow(BILLING_ID, SERVICE_NAME),
    repositoryRow(CHECKOUT_ID, "checkout"),
    repositoryRow(LEDGER_ID, "ledger"),
  ]);

  // Every one of them is reached, through the GitHub App.
  jest
    .spyOn(CodeHostAccess, "getReachableRepositoryIds")
    .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
      return new Set<string>(
        data.repositoryIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
    });
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(
      async (data: {
        repositoryIds: Array<ObjectID>;
      }): Promise<Map<string, CodeHostConnectionSummary>> => {
        return new Map(
          data.repositoryIds.map(
            (id: ObjectID): [string, CodeHostConnectionSummary] => {
              return [
                id.toString(),
                {
                  connectionId: null,
                  provider: CodeRepositoryType.GitHub,
                  hostUrl: null,
                  hostProduct: null,
                  accountLogin: "acme",
                  credentialHint: null,
                  state: CodeHostConnectionState.Connected,
                  isReachableFromServer: true,
                },
              ];
            },
          ),
        );
      },
    );

  // Code's gate: AI on, a provider with credits, a Runner online.
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project | null> => {
      const project: Project = new Project(PROJECT_ID);
      project.enableAi = true;
      project.enableAutomaticIncidentRemediation = false;
      project.enableAutomaticAlertRemediation = false;
      return project;
    });
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockImplementation(async (): Promise<CurrentPlan> => {
      return {
        plan: world.plan,
        isSubscriptionUnpaid: world.isSubscriptionUnpaid,
      } as CurrentPlan;
    });
  jest.spyOn(CodeFixReadiness, "getLlmProviderCheck").mockResolvedValue({
    id: "llmProvider",
    ok: true,
    title: "An LLM provider is available",
    detail: "",
  } as never);
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockImplementation(async (): Promise<CodeRepositoryRunnerStatus> => {
      return {
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      };
    });

  // The record: a public incident and alert, whose monitor is billing-api's.
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident(new ObjectID(INCIDENT_ID));
      incident.projectId = PROJECT_ID;
      incident.monitors = [monitorNamed(SERVICE_NAME)];
      return incident;
    }) as never);
  jest
    .spyOn(AlertService, "findOneById")
    .mockImplementation((async (): Promise<Alert> => {
      const alert: Alert = new Alert(new ObjectID(ALERT_ID));
      alert.projectId = PROJECT_ID;
      alert.monitor = monitorNamed(SERVICE_NAME);
      return alert;
    }) as never);
  jest.spyOn(PrivateRecordWriteCheck, "assertReaches").mockResolvedValue();

  // The investigation and its posted report; no fix yet, of either kind.
  jest.spyOn(AIRunService, "findOneBy").mockImplementation((async (data: {
    query: { runType?: AIRunType };
  }): Promise<AIRun | null> => {
    return data.query.runType === AIRunType.Investigation
      ? investigation()
      : null;
  }) as never);
  jest
    .spyOn(PostedRootCause, "getForInvestigation")
    .mockResolvedValue(ANALYSIS);
  jest.spyOn(CodeFixOnItsWay, "findTurn").mockResolvedValue(null);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue();
  jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();

  // The service the improvement is for.
  jest
    .spyOn(ServiceService, "findOneById")
    .mockImplementation((async (): Promise<Service> => {
      const service: Service = new Service(new ObjectID(SERVICE_ID));
      service.name = SERVICE_NAME;
      service.projectId = PROJECT_ID;
      return service;
    }) as never);

  // The run, as it would be written for the Runner to claim.
  create = jest.spyOn(AIRunService, "create").mockImplementation((async (data: {
    data: AIRun;
  }): Promise<AIRun> => {
    data.data.id = RUN_ID;
    created.push(data.data);
    return data.data;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  // The session guard stays as the router was built with it.
  passSessionGuards();
});

const FIX_THE_CAUSE: string = "/api/ai-investigation/create-fix-task";
const IMPROVE: string =
  "/api/ai-investigation/create-telemetry-improvement-task";
const FIX_THE_CAUSE_SUGGESTION: string =
  "/api/ai-investigation/code-fix-suggestion";
const IMPROVE_SUGGESTION: string =
  "/api/ai-investigation/telemetry-improvement-suggestion";

// What the Remediation step's Open fix pull request sends.
function fixTheCauseBody(
  extra: JSONObject = {},
  subject: "incident" | "alert" = "incident",
): JSONObject {
  return {
    subjectType: subject,
    subjectId: subject === "incident" ? INCIDENT_ID : ALERT_ID,
    investigationRunId: INVESTIGATION_ID.toString(),
    ...extra,
  };
}

// What a service's Improve Logging (or Tracing) sends.
function improveBody(
  extra: JSONObject = {},
  taskType: CodeFixTaskType = CodeFixTaskType.ImproveLogging,
): JSONObject {
  return {
    telemetryServiceId: SERVICE_ID,
    taskType: taskType,
    ...extra,
  };
}

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

// The one run written, its repository and the repository it is held to.
function theRun(): {
  codeRepositoryId: string | undefined;
  pickedCodeRepositoryId: string | undefined;
  taskContext: CodeFixTaskContext | undefined;
  userId: string | undefined;
} {
  expect(created).toHaveLength(1);
  const run: AIRun = created[0]!;
  return {
    codeRepositoryId: run.codeRepositoryId?.toString(),
    pickedCodeRepositoryId: run.taskContext?.pickedCodeRepositoryId,
    taskContext: run.taskContext,
    userId: run.userId?.toString(),
  };
}

interface Path {
  name: string;
  route: string;
  suggestionRoute: string;
  body: (extra?: JSONObject) => JSONObject;
  suggestionBody: JSONObject;
  // What the route says when several repositories are theirs and none matched.
  pickMessage: string;
  // The repositories the page offers to pick from, read as the page reads them.
  choicesOf: (answer: unknown) => Array<{ id: string; name: string }>;
}

const PATHS: Array<Path> = [
  {
    name: "Fix the Cause from an incident",
    route: FIX_THE_CAUSE,
    suggestionRoute: FIX_THE_CAUSE_SUGGESTION,
    body: (extra: JSONObject = {}): JSONObject => {
      return fixTheCauseBody(extra, "incident");
    },
    suggestionBody: { subjectType: "incident", subjectId: INCIDENT_ID },
    pickMessage: PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES.incident,
    choicesOf: (answer: unknown) => {
      return parseInvestigationCodeFixSuggestion(answer).repositories;
    },
  },
  {
    name: "Fix the Cause from an alert",
    route: FIX_THE_CAUSE,
    suggestionRoute: FIX_THE_CAUSE_SUGGESTION,
    body: (extra: JSONObject = {}): JSONObject => {
      return fixTheCauseBody(extra, "alert");
    },
    suggestionBody: { subjectType: "alert", subjectId: ALERT_ID },
    pickMessage: PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES.alert,
    choicesOf: (answer: unknown) => {
      return parseInvestigationCodeFixSuggestion(answer).repositories;
    },
  },
  {
    name: "Improve Logging",
    route: IMPROVE,
    suggestionRoute: IMPROVE_SUGGESTION,
    body: (extra: JSONObject = {}): JSONObject => {
      return improveBody(extra, CodeFixTaskType.ImproveLogging);
    },
    suggestionBody: {
      telemetryServiceId: SERVICE_ID,
      taskType: CodeFixTaskType.ImproveLogging,
    },
    pickMessage: PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
    choicesOf: (answer: unknown) => {
      return parseTelemetryImprovementSuggestion(answer).repositories;
    },
  },
  {
    name: "Improve Tracing",
    route: IMPROVE,
    suggestionRoute: IMPROVE_SUGGESTION,
    body: (extra: JSONObject = {}): JSONObject => {
      return improveBody(extra, CodeFixTaskType.ImproveTracing);
    },
    suggestionBody: {
      telemetryServiceId: SERVICE_ID,
      taskType: CodeFixTaskType.ImproveTracing,
    },
    pickMessage: PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
    choicesOf: (answer: unknown) => {
      return parseTelemetryImprovementSuggestion(answer).repositories;
    },
  },
];

/*
 * WHO MAY START ONE, BY ROLE: every check of the person's repositories runs
 * through the permission layer as their role reads it.
 */
describe.each(PATHS)("$name, by role, with Code's own checks", (path: Path) => {
  test("a project member, who may read and change every repository: the run is made where the record's name points, and held to it", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body(),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(answerOf(sent)["aiRunId"]).toBe(RUN_ID.toString());
    expect(theRun()).toMatchObject({
      codeRepositoryId: BILLING_ID,
      // Held to that one repository when it starts, too.
      pickedCodeRepositoryId: BILLING_ID,
      userId: caller.userId!.toString(),
    });
  });

  test("a project member's pick of another repository they may use: taken, and the run is held to it", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: LEDGER_ID }),
    );

    expect(sent.status).toBe(200);
    expect(theRun()).toMatchObject({
      codeRepositoryId: LEDGER_ID,
      pickedCodeRepositoryId: LEDGER_ID,
    });
  });

  test("a viewer, who reads the repositories but may not change them: refused, saying why and who can help - nothing written", async () => {
    caller = callerWith([Permission.Viewer]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body(),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal: NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("a viewer's pick of a repository they may read: refused as one they may not ask AI in, a 422 - nothing written", async () => {
    caller = callerWith([Permission.Viewer]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: BILLING_ID }),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal: PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("someone who may not read Code's repositories at all: refused, nothing written", async () => {
    // Reads incidents, alerts and services; nothing of Code.
    caller = callerWith([
      Permission.ReadProjectIncident,
      Permission.ReadAlert,
      Permission.ReadService,
    ]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body(),
    );

    expect(sent.status).toBe(422);
    expect(refusalOf(sent)).toBe(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
    expect(refusalOf(sent)).not.toMatch(PERMISSION_TO_READ_CODE_REFUSED);
    expect(create).not.toHaveBeenCalled();
  });

  test("their pick: refused as not found - never said to exist - a 404, nothing written", async () => {
    caller = callerWith([
      Permission.ReadProjectIncident,
      Permission.ReadAlert,
      Permission.ReadService,
    ]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: BILLING_ID }),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 404,
      refusal: PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("a pick that is no repository of the project: refused as not found", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: ObjectID.generate().toString() }),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 404,
      refusal: PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("a pick that is no id: refused before anything is read", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: SERVICE_NAME }),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: "repositoryId must be a repository's ID.",
    });
    expect(create).not.toHaveBeenCalled();
    // Neither the record, the service nor a repository was read for it.
    expect(IncidentService.findOneById).not.toHaveBeenCalled();
    expect(AlertService.findOneById).not.toHaveBeenCalled();
    expect(ServiceService.findOneById).not.toHaveBeenCalled();
    expect(codeRepositories.repository.find).not.toHaveBeenCalled();
  });

  test("a pick written in capitals is the same repository, and is held to as the database writes it", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: LEDGER_ID.toUpperCase() }),
    );

    expect(sent.status).toBe(200);
    expect(theRun().pickedCodeRepositoryId).toBe(LEDGER_ID);
  });

  test("a null pick is no pick", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body({ repositoryId: null }),
    );

    expect(sent.status).toBe(200);
    expect(theRun().pickedCodeRepositoryId).toBe(BILLING_ID);
  });

  test("the page offers a viewer nothing, so it never shows a button the route refuses", async () => {
    caller = callerWith([Permission.Viewer]);

    const sent: SentRequest = await server.request(
      "POST",
      path.suggestionRoute,
      path.suggestionBody,
    );

    expect(sent.status).toBe(200);
    expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.None);
  });

  test("and nothing to someone who may not read Code's repositories, without an error", async () => {
    caller = callerWith([
      Permission.ReadProjectIncident,
      Permission.ReadAlert,
      Permission.ReadService,
    ]);

    const sent: SentRequest = await server.request(
      "POST",
      path.suggestionRoute,
      path.suggestionBody,
    );

    expect(sent.status).toBe(200);
    expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.None);
  });

  test("the page offers a project member the button", async () => {
    caller = callerWith([Permission.ProjectMember]);

    const sent: SentRequest = await server.request(
      "POST",
      path.suggestionRoute,
      path.suggestionBody,
    );

    expect(sent.status).toBe(200);
    expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.Act);
  });
});

/*
 * THE BILL AND THE PLAN COME FIRST: they stop everyone in the project, and a
 * plan below the repositories' own also reads as "may not edit the
 * repository" - which would send people to an admin who cannot help
 * either (CodeTaskGate).
 */
describe.each(PATHS)("$name, the bill and the plan first", (path: Path) => {
  test.each([
    [
      "an unpaid subscription",
      { plan: PlanType.Enterprise, isSubscriptionUnpaid: true },
      CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
    ],
    [
      "a plan without AI in Code",
      { plan: PlanType.Free, isSubscriptionUnpaid: false },
      CODE_TASK_PLAN_REQUIRED_MESSAGE,
    ],
  ])(
    "%s is said before a viewer's pick is refused, as a 402",
    async (_name: string, bill: World, message: string) => {
      world = bill;
      caller = callerWith([Permission.Viewer]);

      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body({ repositoryId: BILLING_ID }),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 402,
        refusal: message,
      });
      expect(create).not.toHaveBeenCalled();
    },
  );

  test("a plan without AI in Code is said before a viewer is told no repository is theirs", async () => {
    world = { plan: PlanType.Free, isSubscriptionUnpaid: false };
    caller = callerWith([Permission.Viewer]);

    const sent: SentRequest = await server.request(
      "POST",
      path.route,
      path.body(),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 402,
      refusal: CODE_TASK_PLAN_REQUIRED_MESSAGE,
    });
  });

  test("and the page says the plan to the viewer, as Code would, rather than nothing", async () => {
    world = { plan: PlanType.Free, isSubscriptionUnpaid: false };
    caller = callerWith([Permission.Viewer]);

    const sent: SentRequest = await server.request(
      "POST",
      path.suggestionRoute,
      path.suggestionBody,
    );

    expect(sent.status).toBe(200);

    if (path.route === FIX_THE_CAUSE) {
      // The Remediation step draws Code's words, with the step that clears them.
      expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.SetUp);
      expect(
        (answerOf(sent)["blocker"] as JSONObject | null)?.["message"],
      ).toBe(CODE_TASK_PLAN_REQUIRED_MESSAGE);
    } else {
      // A service's card draws nothing while anything stops the run.
      expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.None);
    }
  });
});

/*
 * WHO MAY USE SOME OF THE REPOSITORIES: the per-repository answers of Code's
 * checks (CodeTaskAccess) - read it, ask AI in it - stood in for by
 * repository, the way a team's labels give them, with everything above
 * them real. The person reads every repository and may ask AI in checkout
 * and ledger, unless a test says otherwise; billing-api, the one the
 * record's name points at, is not theirs to ask in.
 */
describe.each(PATHS)(
  "$name, for someone who may use some repositories",
  (path: Path) => {
    let askable: Set<string>;

    const mayRead: (id: string) => boolean = (_id: string): boolean => {
      return true;
    };
    const mayAsk: (id: string) => boolean = (id: string): boolean => {
      return askable.has(id);
    };

    // Whose permissions each per-repository check was asked under.
    let asked: Array<DatabaseCommonInteractionProps>;

    const rowOf: (id: string) => CodeRepository = (
      id: string,
    ): CodeRepository => {
      const repository: CodeRepository = new CodeRepository();
      repository.id = new ObjectID(id);
      return repository;
    };

    beforeEach(() => {
      asked = [];
      askable = new Set<string>([CHECKOUT_ID, LEDGER_ID]);
      caller = callerWith([Permission.ProjectMember]);

      jest
        .spyOn(CodeTaskAccess, "findReadableRepository")
        .mockImplementation(
          async (data: {
            props: DatabaseCommonInteractionProps;
            repositoryId: ObjectID;
          }): Promise<CodeRepository | null> => {
            asked.push(data.props);
            const id: string = data.repositoryId.toString();
            return mayRead(id) ? rowOf(id) : null;
          },
        );
      jest
        .spyOn(CodeTaskAccess, "canAskInRepository")
        .mockImplementation(
          async (data: {
            props: DatabaseCommonInteractionProps;
            repositoryId: ObjectID;
          }): Promise<boolean> => {
            asked.push(data.props);
            return mayAsk(data.repositoryId.toString());
          },
        );
      jest
        .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
        .mockImplementation(
          async (data: {
            props: DatabaseCommonInteractionProps;
            repositoryIds: Array<ObjectID | string>;
          }): Promise<Array<CodeRepository>> => {
            asked.push(data.props);
            return data.repositoryIds
              .map((id: ObjectID | string): string => {
                return id.toString();
              })
              .filter(mayRead)
              .map(rowOf);
          },
        );
      jest
        .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
        .mockImplementation(
          async (data: {
            props: DatabaseCommonInteractionProps;
            repositoryIds: Array<ObjectID | string>;
          }): Promise<Set<string>> => {
            asked.push(data.props);
            return new Set<string>(
              data.repositoryIds
                .map((id: ObjectID | string): string => {
                  return id.toString();
                })
                .filter(mayAsk),
            );
          },
        );
    });

    test("their pick of the repository the record's name points at, which they may read but not ask AI in: refused - nothing written", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body({ repositoryId: BILLING_ID }),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal: PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
      });
      expect(create).not.toHaveBeenCalled();
    });

    test("their pick of one they may use: taken and held to - checked under their own permissions", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body({ repositoryId: CHECKOUT_ID }),
      );

      expect(sent.status).toBe(200);
      expect(theRun()).toMatchObject({
        codeRepositoryId: CHECKOUT_ID,
        pickedCodeRepositoryId: CHECKOUT_ID,
      });
      expect(asked.length).toBeGreaterThan(0);
      for (const props of asked) {
        expect(props.userId?.toString()).toBe(caller.userId!.toString());
        expect(props.isRoot).toBeFalsy();
      }
    });

    test("no pick, and one repository theirs: made there, not where the record's name points - and held to it", async () => {
      askable = new Set<string>([CHECKOUT_ID]);

      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body(),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(theRun()).toMatchObject({
        codeRepositoryId: CHECKOUT_ID,
        pickedCodeRepositoryId: CHECKOUT_ID,
      });
    });

    test("no pick, and several theirs that the record's name matches none of: asked to pick, never made in billing-api", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body(),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: path.pickMessage,
      });
      expect(create).not.toHaveBeenCalled();
    });

    test("the page asks that pick first: the button, with the repositories theirs to pick from, by name", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        path.suggestionRoute,
        path.suggestionBody,
      );

      expect(sent.status).toBe(200);
      expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.Act);
      expect(path.choicesOf(sent.answer)).toEqual([
        { id: CHECKOUT_ID, name: "checkout" },
        { id: LEDGER_ID, name: "ledger" },
      ]);
    });

    test("and the pick the page then sends is taken", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body({ repositoryId: LEDGER_ID }),
      );

      expect(sent.status).toBe(200);
      expect(theRun()).toMatchObject({
        codeRepositoryId: LEDGER_ID,
        pickedCodeRepositoryId: LEDGER_ID,
      });
    });

    test("one repository theirs: the page asks no pick", async () => {
      askable = new Set<string>([CHECKOUT_ID]);

      const sent: SentRequest = await server.request(
        "POST",
        path.suggestionRoute,
        path.suggestionBody,
      );

      expect(answerOf(sent)["offer"]).toBe(SuggestionOffer.Act);
      expect(path.choicesOf(sent.answer)).toEqual([]);
    });

    test("the repository the record's name points at among theirs: no pick asked, and the run is made there", async () => {
      askable = new Set<string>([BILLING_ID, CHECKOUT_ID, LEDGER_ID]);

      const suggested: SentRequest = await server.request(
        "POST",
        path.suggestionRoute,
        path.suggestionBody,
      );

      expect(answerOf(suggested)["offer"]).toBe(SuggestionOffer.Act);
      expect(path.choicesOf(suggested.answer)).toEqual([]);

      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body(),
      );

      expect(sent.status).toBe(200);
      expect(theRun()).toMatchObject({
        codeRepositoryId: BILLING_ID,
        pickedCodeRepositoryId: BILLING_ID,
      });
    });

    test("none theirs to ask in: refused, saying who can help - nothing written", async () => {
      askable = new Set<string>();

      const sent: SentRequest = await server.request(
        "POST",
        path.route,
        path.body(),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal: NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
      });
      expect(create).not.toHaveBeenCalled();
    });
  },
);

/*
 * IN THE ONE PROJECT THE REQUEST IS FOR: a record of another project the
 * person belongs to, read through a read across projects, never has its fix
 * weighed by their grants here.
 */
describe("Fix the Cause, in the request's own project", () => {
  test("a record of another project: refused, nothing written", async () => {
    caller = callerWith([Permission.ProjectMember]);

    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident(new ObjectID(INCIDENT_ID));
        incident.projectId = ObjectID.generate();
        incident.monitors = [monitorNamed(SERVICE_NAME)];
        return incident;
      }) as never);

    const sent: SentRequest = await server.request(
      "POST",
      FIX_THE_CAUSE,
      fixTheCauseBody(),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal: "You are not authorized to access this project's data.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("the person's repositories are weighed in that one project, never across projects", async () => {
    caller = {
      ...callerWith([Permission.ProjectMember]),
      isMultiTenantRequest: true,
    };
    const readable: SpyInstance<
      typeof CodeTaskAccess.listReadableRepositoriesByIds
    > = jest.spyOn(CodeTaskAccess, "listReadableRepositoriesByIds");

    const sent: SentRequest = await server.request(
      "POST",
      FIX_THE_CAUSE,
      fixTheCauseBody(),
    );

    expect(sent.status).toBe(200);
    expect(readable).toHaveBeenCalled();
    for (const call of readable.mock.calls) {
      expect(call[0].props.isMultiTenantRequest).toBe(false);
      expect(call[0].props.tenantId?.toString()).toBe(PROJECT_ID.toString());
      expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
    }
  });
});

/*
 * THE RUNS NO PERSON STARTED keep their rule: an investigation that ends
 * recommending a fix in the code opens the pull request on its own while
 * fixing is on, held to the repositories its AI rules allow - every
 * connected one, with no rule - and no person's permissions weigh it.
 */
describe("Fix the Cause opened by OneUptime AI on its own", () => {
  test("is made where the monitor's name points, among every connected repository, and pinned to no person's", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation(async (): Promise<Project | null> => {
        const project: Project = new Project(PROJECT_ID);
        project.enableAi = true;
        project.enableAutomaticIncidentRemediation = true;
        return project;
      });
    // No AI rule for the lane: every connected repository is allowed.
    jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue({ rulesSetUp: false, matchingRules: [] });
    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: true,
    } as never);
    const readable: SpyInstance<
      typeof CodeTaskAccess.listReadableRepositoriesByIds
    > = jest.spyOn(CodeTaskAccess, "listReadableRepositoriesByIds");
    const askable: SpyInstance<typeof CodeTaskAccess.listAskableRepositoryIds> =
      jest.spyOn(CodeTaskAccess, "listAskableRepositoryIds");

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId: PROJECT_ID,
      investigationRunId: INVESTIGATION_ID,
      analysisMarkdown: ANALYSIS,
      incidentId: new ObjectID(INCIDENT_ID),
    });

    expect(theRun()).toMatchObject({
      codeRepositoryId: BILLING_ID,
      pickedCodeRepositoryId: undefined,
      userId: undefined,
    });
    expect(theRun().taskContext).toEqual({
      sourceInvestigationRunId: INVESTIGATION_ID.toString(),
      sourceInvestigationAnalysisMarkdown: ANALYSIS,
    });
    expect(readable).not.toHaveBeenCalled();
    expect(askable).not.toHaveBeenCalled();
  });
});
