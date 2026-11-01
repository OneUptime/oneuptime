import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../Server/Services/AIRunService";
import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../Server/Services/AIService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
} from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeRepositoryRunnerChoice from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import {
  CODE_TASK_ASK_REFUSED_MESSAGE,
  CODE_TASK_NOT_FOUND_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import {
  CODE_TASK_PLAN_REQUIRED_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import {
  CODE_TASK_BRANCH_NOT_FOUND_MESSAGE,
  CODE_TASK_BRANCHES_UNREADABLE_MESSAGE,
  CODE_TASK_NOT_A_PRODUCTION_REVIEW_MESSAGE,
  CODE_TASK_REVIEW_AGAIN_REFUSED_MESSAGE,
  CODE_TASK_REVIEW_PULL_REQUEST_REFUSED_MESSAGE,
  CodeTaskListKind,
} from "../../../Server/API/CodeTaskAPI";
import ProductionReviewAsk from "../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewAsk";
import ProductionReviewQueue, {
  ProductionReviewRequest,
} from "../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue";
import GitHubCommandType from "../../../Types/CodeRepository/GitHubCommand";
import { ProductionReviewTrigger } from "../../../Types/CodeRepository/ProductionReview";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeTaskPresenter from "../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import {
  CODE_TASK_BUSY_MESSAGE,
  CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import CodeTaskStats from "../../../Server/Utils/AI/CodeTask/CodeTaskStats";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE,
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskState,
} from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CodeRepositoryRunnerChoiceKind } from "../../../Types/Runner/CodeRepositoryRunner";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The Code API, route by route, as a person reaches it: who may read a
 * repository's tasks (the repository decides, labels and all), who may ask
 * AI to work in it (what an edit of it takes), and what stops AI working at
 * all - the plan, the project's AI switch, a disconnected repository, used
 * up credits - each refused before anything is written, in the words the
 * pages show. The access and gate logic, the context reading and the turns
 * are the real ones; only the rows they read and write are stood in for.
 *
 * Billing is on here, as on OneUptime Cloud, so the plan is weighed.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: true };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const USER_ID: ObjectID = new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
const INCIDENT_ID: ObjectID = new ObjectID(
  "9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
);
const INSTALLATION_ID: string = "48213377";

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

function caller(
  permissions: Array<Permission>,
  plan: PlanType = PlanType.Scale,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission;
        }),
      },
    },
  } as DatabaseCommonInteractionProps;
}

const MEMBER: DatabaseCommonInteractionProps = caller([
  Permission.ProjectMember,
]);
const VIEWER: DatabaseCommonInteractionProps = caller([Permission.Viewer]);
const OUTSIDER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

interface World {
  props: DatabaseCommonInteractionProps;
  repositoryReadable: boolean;
  enableAi: boolean;
  llmOk: boolean;
  llmDetail: string;
  task: AIRun | null;
  latestReply: AIRun | null;
  incidentReadable: boolean;
}

let world: World;
let created: Array<AIRun>;

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = PROJECT_ID;
  value.name = "users-api";
  value.organizationName = "acme";
  value.repositoryName = "users-api";
  value.repositoryHostedAt = CodeRepositoryType.GitHub;
  value.gitHubAppInstallationId = INSTALLATION_ID;
  value.mainBranchName = "main";
  value.labels = [];
  return value;
}

function task(): AIRun {
  const value: AIRun = new AIRun();
  value._id = TASK_ID.toString();
  value.projectId = PROJECT_ID;
  value.runType = AIRunType.CodeFix;
  value.codeFixTaskType = CodeFixTaskType.CodeRequest;
  value.codeRepositoryId = REPOSITORY_ID;
  value.status = AIRunStatus.Completed;
  value.taskContext = { request: { message: "Add retries", context: [] } };
  return value;
}

async function call(
  route: string,
  data: { body?: JSONObject; params?: Record<string, string> } = {},
): Promise<{ next: jest.Mock; result: JSONObject | null }> {
  const next: jest.Mock = jest.fn();

  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  await mockRouter.match("post", route).handlerFunction(
    {
      body: data.body || {},
      params: data.params || {},
      headers: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    next,
    result: calls.length > 0 ? (calls[0]![2] as JSONObject) : null,
  };
}

function refusal(next: jest.Mock): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  mockRouter.routes.length = 0;
  const CodeTaskAPI: { new (): unknown } = (
    await import("../../../Server/API/CodeTaskAPI")
  ).default as unknown as { new (): unknown };
  new CodeTaskAPI();
});

afterAll(() => {
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
  world = {
    props: MEMBER,
    repositoryReadable: true,
    enableAi: true,
    llmOk: true,
    llmDetail: "",
    task: task(),
    latestReply: null,
    incidentReadable: true,
  };
  created = [];

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return world.props;
    });

  // The repository, read as the caller (or as root, for the edit check).
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation(
      async (data: { props: DatabaseCommonInteractionProps }) => {
        if (!data.props.isRoot && !world.repositoryReadable) {
          return null;
        }
        return repository();
      },
    );
  jest
    .spyOn(CodeRepositoryService, "findOneById")
    .mockImplementation(async () => {
      return repository();
    });
  jest.spyOn(CodeRepositoryService, "findBy").mockImplementation(async () => {
    return world.repositoryReadable ? [repository()] : [];
  });

  jest
    .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
    .mockResolvedValue(INSTALLATION_ID);
  jest.spyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project();
    project.enableAi = world.enableAi;
    return project;
  });
  jest
    .spyOn(CodeFixReadiness, "getLlmProviderCheck")
    .mockImplementation(async () => {
      return {
        id: "llmProvider",
        ok: world.llmOk,
        title: "",
        detail: world.llmDetail,
      } as never;
    });
  // The repository's Runner (a global Runner here) is online.
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockResolvedValue({
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: true,
    });
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue(undefined);
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ release: jest.fn() } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

  jest
    .spyOn(AIRunService, "create")
    .mockImplementation(async (data: { data: AIRun }) => {
      data.data._id = ObjectID.generate().toString();
      created.push(data.data);
      return data.data;
    });
  // findTask (the task itself) and getLatestTurn (its newest reply).
  jest
    .spyOn(AIRunService, "findOneBy")
    .mockImplementation(async (data: { query: Record<string, unknown> }) => {
      if (data.query["_id"]) {
        return world.task;
      }
      return world.latestReply;
    });

  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation(async (data: { props: unknown }) => {
      if (!world.incidentReadable) {
        return null;
      }
      expect(data.props).toBe(world.props);
      const incident: Incident = new Incident();
      incident.title = "Users API is slow";
      incident.incidentNumber = 7;
      return incident;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every route is for a member of the project", () => {
  test.each([
    ["/code-task/repositories", {}],
    [
      "/code-task/repository/:repositoryId",
      { repositoryId: REPOSITORY_ID.toString() },
    ],
    ["/code-task/get/:taskId", { taskId: TASK_ID.toString() }],
    [
      "/code-task/branches/:repositoryId",
      { repositoryId: REPOSITORY_ID.toString() },
    ],
    ["/code-task/create", {}],
    ["/code-task/reply/:taskId", { taskId: TASK_ID.toString() }],
    ["/code-task/stop/:taskId", { taskId: TASK_ID.toString() }],
    ["/code-task/review-again/:taskId", { taskId: TASK_ID.toString() }],
    [
      "/code-task/review-pull-request/:repositoryId",
      { repositoryId: REPOSITORY_ID.toString() },
    ],
  ])(
    "%s refuses someone who is not",
    async (route: string, params: Record<string, string>) => {
      world.props = OUTSIDER;

      const { next, result } = await call(route, {
        params,
        body: { repositoryId: REPOSITORY_ID.toString(), message: "x" },
      });

      expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
      expect(result).toBeNull();
      expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    },
  );
});

describe("every route acts as a signed-in person", () => {
  test("a request with no session is told to sign in (401), before anything is read", async () => {
    world.props = { tenantId: PROJECT_ID } as DatabaseCommonInteractionProps;

    const { next } = await call("/code-task/create", {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    expect(refusal(next)).toBeInstanceOf(NotAuthenticatedException);
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
  });

  test("a project API key is refused: AI is asked by a person, who is named on the task", async () => {
    // A project API key: no user, userType API, and the key's grants.
    world.props = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userId: undefined,
      userTenantAccessPermission: caller([Permission.ProjectOwner])
        .userTenantAccessPermission,
    } as DatabaseCommonInteractionProps;

    const { next } = await call("/code-task/create", {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
    expect(created).toHaveLength(0);
  });

  test("every route is behind the user middleware", () => {
    const routes: Array<{ uri: string; middlewares: Array<unknown> }> =
      mockRouter.routes.filter((route: { uri: string }) => {
        return route.uri.startsWith("/code-task/");
      }) as never;

    expect(
      routes.map((route: { uri: string }) => {
        return route.uri;
      }),
    ).toEqual([
      "/code-task/repositories",
      "/code-task/repository/:repositoryId",
      "/code-task/list",
      // A repository's branches, for the branch a task starts from.
      "/code-task/branches/:repositoryId",
      "/code-task/get/:taskId",
      "/code-task/create",
      "/code-task/reply/:taskId",
      "/code-task/retry/:taskId",
      "/code-task/stop/:taskId",
      // A pull request's production review, asked again.
      "/code-task/review-again/:taskId",
      // A pull request reviewed against production, asked by its number.
      "/code-task/review-pull-request/:repositoryId",
      // Where a profile's frames live in the repositories (the Profiler).
      "/code-task/source-links",
    ]);

    for (const route of routes) {
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    }
  });
});

describe("asking AI in a repository (create)", () => {
  const route: string = "/code-task/create";

  test("starts the task: a queued request, with its context read as the person who asked", async () => {
    const { next, result } = await call(route, {
      body: {
        repositoryId: REPOSITORY_ID.toString(),
        message: "Add retries to the users API",
        context: [
          { type: "Incident", id: INCIDENT_ID.toString() },
          { type: "File", path: "./src/api/users.ts" },
        ],
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(result).toEqual({ taskId: created[0]!.id!.toString() });

    const run: AIRun = created[0]!;

    expect(run.codeFixTaskType).toBe(CodeFixTaskType.CodeRequest);
    expect(run.status).toBe(AIRunStatus.Queued);
    expect(run.codeRepositoryId?.toString()).toBe(REPOSITORY_ID.toString());
    expect(run.userId?.toString()).toBe(USER_ID.toString());
    expect(run.taskContext?.request?.message).toBe(
      "Add retries to the users API",
    );
    expect(run.taskContext?.request?.context).toEqual([
      expect.objectContaining({
        type: CodeTaskContextType.Incident,
        recordId: INCIDENT_ID.toString(),
        label: "Incident #7: Users API is slow",
      }),
      {
        type: CodeTaskContextType.File,
        label: "src/api/users.ts",
        path: "src/api/users.ts",
      },
    ]);
  });

  test("someone who may only read the repository is refused, and told why", async () => {
    world.props = VIEWER;

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(CODE_TASK_ASK_REFUSED_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("a repository the caller may not read is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("with AI turned off for the project, nothing starts", async () => {
    world.enableAi = false;

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(AI_DISABLED_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("on a plan below Growth, nothing starts and the plan is named", async () => {
    world.props = caller([Permission.ProjectMember], PlanType.Free);

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(PaymentRequiredException);
    expect(error.message).toBe(CODE_TASK_PLAN_REQUIRED_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("with the project's AI credits used up, nothing starts", async () => {
    world.llmOk = false;
    world.llmDetail = CODE_FIX_AI_CREDITS_USED_UP_DETAIL;

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), message: "Add retries" },
    });

    expect(refusal(next).message).toBe(CODE_FIX_AI_CREDITS_USED_UP_DETAIL);
    expect(created).toHaveLength(0);
  });

  test("context the person may not read - another project's record - refuses the request", async () => {
    world.incidentReadable = false;

    const { next } = await call(route, {
      body: {
        repositoryId: REPOSITORY_ID.toString(),
        message: "Add retries",
        context: [{ type: "Incident", id: INCIDENT_ID.toString() }],
      },
    });

    expect(refusal(next).message).toBe(
      "That incident was not found in this project, or you cannot see it.",
    );
    expect(created).toHaveLength(0);
  });

  test("malformed context, an empty request or a bad repository id is refused before anything is read", async () => {
    for (const body of [
      {
        repositoryId: REPOSITORY_ID.toString(),
        message: "x",
        context: [{ type: "File", path: "../../etc/passwd" }],
      },
      { repositoryId: REPOSITORY_ID.toString(), message: "   " },
      { repositoryId: "not-a-uuid", message: "Add retries" },
    ]) {
      const { next } = await call(route, { body: body as JSONObject });

      expect(refusal(next)).toBeInstanceOf(BadDataException);
    }

    expect(created).toHaveLength(0);
  });
});

describe("asking from a branch the person picked (create with branch)", () => {
  const route: string = "/code-task/create";

  function ask(branch: unknown): Promise<{
    next: jest.Mock;
    result: JSONObject | null;
  }> {
    return call(route, {
      body: {
        repositoryId: REPOSITORY_ID.toString(),
        message: "Backport the retry fix",
        branch: branch as JSONObject,
      },
    });
  }

  test("a branch on GitHub is kept on the task's first turn, and checked where AI reaches the repository", async () => {
    const getBranch: jest.Mock = jest
      .spyOn(GitHubUtil, "getBranch")
      .mockResolvedValue({
        name: "release/2026-10",
        headSha: "abc1234",
        isProtected: false,
      }) as unknown as jest.Mock;

    const { next, result } = await ask(" release/2026-10 ");

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({ taskId: created[0]!.id!.toString() });
    expect(created[0]!.taskContext?.request?.baseBranch).toBe(
      "release/2026-10",
    );
    expect(getBranch).toHaveBeenCalledWith({
      installationId: INSTALLATION_ID,
      organizationName: "acme",
      repositoryName: "users-api",
      branchName: "release/2026-10",
    });
  });

  test("the main branch - where a task starts anyway - is not kept, and GitHub is not asked", async () => {
    const getBranch: jest.Mock = jest.spyOn(
      GitHubUtil,
      "getBranch",
    ) as unknown as jest.Mock;

    const { next } = await ask("main");

    expect(next).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.taskContext?.request).not.toHaveProperty("baseBranch");
    expect(getBranch).not.toHaveBeenCalled();
  });

  test.each([[undefined], [null], [""], ["   "]])(
    "no branch (%p): the main branch, nothing kept",
    async (branch: unknown) => {
      const { next } = await ask(branch);

      expect(next).not.toHaveBeenCalled();
      expect(created[0]!.taskContext?.request).not.toHaveProperty("baseBranch");
    },
  );

  test("a branch no longer on GitHub is refused, and nothing starts", async () => {
    jest.spyOn(GitHubUtil, "getBranch").mockResolvedValue(null);

    const { next } = await ask("deleted/branch");

    const error: Error = refusal(next);
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(CODE_TASK_BRANCH_NOT_FOUND_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("GitHub not answering is said as such, and nothing starts", async () => {
    jest
      .spyOn(GitHubUtil, "getBranch")
      .mockRejectedValue(new Error("GitHub is down"));

    const { next } = await ask("release/2026-10");

    expect(refusal(next).message).toBe(CODE_TASK_BRANCHES_UNREADABLE_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test.each([["a..b"], ["has space"], ["-flag"], ["refs/x.lock"], [42]])(
    "what git would not take as a branch (%p) is refused before GitHub is asked",
    async (branch: unknown) => {
      const getBranch: jest.Mock = jest.spyOn(
        GitHubUtil,
        "getBranch",
      ) as unknown as jest.Mock;

      const { next } = await ask(branch);

      const error: Error = refusal(next);
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE);
      expect(getBranch).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    },
  );

  test("a repository the project's GitHub App no longer reaches cannot be asked from any branch", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("99999999");
    const getBranch: jest.Mock = jest.spyOn(
      GitHubUtil,
      "getBranch",
    ) as unknown as jest.Mock;

    const { next } = await ask("release/2026-10");

    expect(refusal(next).message).toBe(
      CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
    );
    expect(getBranch).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});

describe("a repository's branches (for the branch picker)", () => {
  const route: string = "/code-task/branches/:repositoryId";

  function read(body: JSONObject = {}): Promise<{
    next: jest.Mock;
    result: JSONObject | null;
  }> {
    return call(route, {
      params: { repositoryId: REPOSITORY_ID.toString() },
      body,
    });
  }

  test("the main branch first, then GitHub's - what git would not take left out - and whether that is all of them", async () => {
    const listBranchNames: jest.Mock = jest
      .spyOn(GitHubUtil, "listBranchNames")
      .mockResolvedValue({
        names: ["feature/x", "main", "fix/timeout"],
        isComplete: false,
      }) as unknown as jest.Mock;

    const { next, result } = await read();

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      branches: ["main", "feature/x", "fix/timeout"],
      defaultBranch: "main",
      isComplete: false,
    });
    expect(listBranchNames).toHaveBeenCalledWith({
      installationId: INSTALLATION_ID,
      organizationName: "acme",
      repositoryName: "users-api",
      search: "",
      limit: 100,
    });
  });

  test("searched: the branches that start with what was typed - the main branch only when it does too", async () => {
    const listBranchNames: jest.Mock = jest
      .spyOn(GitHubUtil, "listBranchNames")
      .mockResolvedValue({
        names: ["feature/a", "feature/b"],
        isComplete: true,
      }) as unknown as jest.Mock;

    const { result } = await read({ search: " feature/ " });

    expect(result).toEqual({
      branches: ["feature/a", "feature/b"],
      defaultBranch: "main",
      isComplete: true,
    });
    expect(
      (listBranchNames.mock.calls[0]![0] as { search: string }).search,
    ).toBe("feature/");

    listBranchNames.mockResolvedValue({
      names: ["maintenance"],
      isComplete: true,
    });
    const { result: second } = await read({ search: "ma" });
    expect(second?.["branches"]).toEqual(["main", "maintenance"]);
  });

  test("someone who may only read the repository may not list its branches: nothing is asked of GitHub", async () => {
    world.props = VIEWER;
    const listBranchNames: jest.Mock = jest.spyOn(
      GitHubUtil,
      "listBranchNames",
    ) as unknown as jest.Mock;

    const { next } = await read();

    const error: Error = refusal(next);
    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(CODE_TASK_ASK_REFUSED_MESSAGE);
    expect(listBranchNames).not.toHaveBeenCalled();
  });

  test("a repository the caller may not read is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await read();

    expect(refusal(next)).toBeInstanceOf(NotFoundException);
  });

  test("a repository the project's GitHub App no longer reaches says so", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue(null);

    const { next } = await read();

    expect(refusal(next).message).toBe(
      CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
    );
  });

  test("GitHub not answering is said as such", async () => {
    jest
      .spyOn(GitHubUtil, "listBranchNames")
      .mockRejectedValue(new Error("rate limited"));

    const { next } = await read();

    const error: Error = refusal(next);
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(CODE_TASK_BRANCHES_UNREADABLE_MESSAGE);
  });

  test.each([["a b"], ["x..y"], ["~1"], ["what?"], ["a".repeat(256)]])(
    "a search no branch could start with (%p) is refused before GitHub is asked",
    async (search: string) => {
      const listBranchNames: jest.Mock = jest.spyOn(
        GitHubUtil,
        "listBranchNames",
      ) as unknown as jest.Mock;

      const { next } = await read({ search });

      const error: Error = refusal(next);
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A branch search can only hold what a branch's name can.",
      );
      expect(listBranchNames).not.toHaveBeenCalled();
    },
  );

  test("a prefix that ends where a whole name could not ('release/', 'v1.') is a search", async () => {
    jest
      .spyOn(GitHubUtil, "listBranchNames")
      .mockResolvedValue({ names: [], isComplete: true });

    for (const search of ["release/", "v1."]) {
      const { next } = await read({ search });
      expect(next).not.toHaveBeenCalled();
    }
  });

  test("a search that is not text is refused", async () => {
    const { next } = await read({ search: 7 as unknown as JSONObject });

    expect(refusal(next).message).toBe("A branch search must be text.");
  });

  test("a repository id that is not one is refused before anything is read", async () => {
    const { next } = await call(route, {
      params: { repositoryId: "not-an-id" },
    });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("replying in a task", () => {
  const route: string = "/code-task/reply/:taskId";

  test("is the task's next turn, in its repository", async () => {
    const { next, result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
      body: { message: "Use exponential backoff" },
    });

    expect(next).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.codeTaskId?.toString()).toBe(TASK_ID.toString());
    expect(created[0]!.codeRepositoryId?.toString()).toBe(
      REPOSITORY_ID.toString(),
    );
    expect(result).toEqual({
      taskId: TASK_ID.toString(),
      runId: created[0]!.id!.toString(),
    });
  });

  test("waits while AI is still working on the task", async () => {
    const working: AIRun = new AIRun();
    working.status = AIRunStatus.Running;
    world.latestReply = working;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
      body: { message: "And this" },
    });

    expect(refusal(next).message).toBe(CODE_TASK_BUSY_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("a read-only member reads the task but may not reply", async () => {
    world.props = VIEWER;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
      body: { message: "And this" },
    });

    expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
    expect(created).toHaveLength(0);
  });

  test("a task in a repository the caller may not read is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
      body: { message: "And this" },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(CODE_TASK_NOT_FOUND_MESSAGE);
  });

  test("a task of another project, or no task at all, is not found", async () => {
    world.task = null;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
      body: { message: "And this" },
    });

    expect(refusal(next).message).toBe(CODE_TASK_NOT_FOUND_MESSAGE);
  });
});

describe("reading a task", () => {
  const route: string = "/code-task/get/:taskId";

  beforeEach(() => {
    jest
      .spyOn(CodeTaskPresenter, "getConversation")
      .mockImplementation(async () => {
        return {
          task: { id: TASK_ID.toString(), state: CodeTaskState.Done } as never,
          turns: [],
        };
      });
  });

  test("someone who may ask sees the diff and the box", async () => {
    const { result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(result?.["canAsk"]).toBe(true);
    expect(result?.["canSeeChanges"]).toBe(true);
    expect(result?.["blocker"]).toBeNull();
    expect(
      (
        (CodeTaskPresenter.getConversation as unknown as jest.Mock).mock
          .calls[0]![0] as { canSeeChanges: boolean }
      ).canSeeChanges,
    ).toBe(true);
  });

  test("a read-only member reads it, without the diff, and is told why they cannot reply", async () => {
    world.props = VIEWER;

    const { result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(result?.["canAsk"]).toBe(false);
    expect(result?.["canSeeChanges"]).toBe(false);
    expect((result?.["blocker"] as JSONObject)["type"]).toBe(
      CodeTaskBlockerType.NoPermission,
    );
    expect(result?.["canReadLogContent"]).toBe(false);
    expect(
      (CodeTaskPresenter.getConversation as unknown as jest.Mock).mock
        .calls[0]![0] as { canSeeChanges: boolean; props: unknown },
    ).toMatchObject({ canSeeChanges: false, props: VIEWER });
  });

  test("the verbatim log is for project owners and admins", async () => {
    world.props = caller([Permission.ProjectAdmin]);

    const { result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(result?.["canReadLogContent"]).toBe(true);
  });
});

describe("listing a repository's tasks", () => {
  const route: string = "/code-task/list";

  beforeEach(() => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([task()]);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(41));
    jest.spyOn(CodeTaskPresenter, "summarize").mockResolvedValue([]);
  });

  test("newest first, a page at a time, never more than fifty", async () => {
    const { result } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString(), skip: 20, limit: 5000 },
    });

    expect(result).toEqual({
      tasks: [],
      totalCount: 41,
      skip: 20,
      limit: 50,
    });

    const read: {
      query: Record<string, unknown>;
      sort: unknown;
      limit: number;
    } = (AIRunService.findBy as unknown as jest.Mock).mock
      .calls[0]![0] as never;

    expect(read.sort).toEqual({ createdAt: "DESC" });
    expect(read.limit).toBe(50);
    expect((read.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((read.query["codeRepositoryId"] as ObjectID).toString()).toBe(
      REPOSITORY_ID.toString(),
    );
  });

  test("a repository the caller may not read lists nothing: it is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await call(route, {
      body: { repositoryId: REPOSITORY_ID.toString() },
    });

    expect(refusal(next)).toBeInstanceOf(NotFoundException);
    expect(AIRunService.findBy).not.toHaveBeenCalled();
  });

  test("the tasks with no repository are for those who may read AI runs", async () => {
    world.props = caller([Permission.ReadCodeRepository]);

    const { next } = await call(route, { body: { withoutRepository: true } });

    expect(refusal(next)).toBeInstanceOf(NotFoundException);
  });

  /*
   * A repository's pull requests' production reviews have a page of their
   * own: Tasks lists everything else, and production reviews only those.
   */
  test("Tasks leaves the production reviews out", async () => {
    const notInOrNull: jest.SpyInstance = jest.spyOn(
      QueryHelper,
      "notInOrNull",
    );

    await call(route, { body: { repositoryId: REPOSITORY_ID.toString() } });

    expect(notInOrNull).toHaveBeenCalledWith([
      CodeFixTaskType.GitHubPullRequestProductionReview,
    ]);

    const read: { query: Record<string, unknown> } = (
      AIRunService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect(read.query["codeFixTaskType"]).toBe(
      notInOrNull.mock.results[0]!.value,
    );
  });

  test("Production reviews lists only them", async () => {
    await call(route, {
      body: {
        repositoryId: REPOSITORY_ID.toString(),
        kind: CodeTaskListKind.ProductionReviews,
      },
    });

    const read: { query: Record<string, unknown> } = (
      AIRunService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;
    const count: { query: Record<string, unknown> } = (
      AIRunService.countBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect(read.query["codeFixTaskType"]).toBe(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
    expect(count.query["codeFixTaskType"]).toBe(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
  });
});

describe("reviewing a pull request against production again", () => {
  const route: string = "/code-task/review-again/:taskId";
  let requestSpy: jest.SpyInstance;

  function reviewTask(): AIRun {
    const value: AIRun = task();
    value.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
    value.title = "fix: guard the card";
    value.taskContext = {
      github: {
        codeRepositoryId: REPOSITORY_ID.toString(),
        installationId: INSTALLATION_ID,
        organizationName: "acme",
        repositoryName: "users-api",
        commandType: GitHubCommandType.ProductionReview,
        instruction: "",
        pullRequestNumber: 42,
        isPullRequestFromFork: true,
      },
      productionReview: {
        requestNumber: 3,
        requestedAt: "2026-10-22T09:00:00.000Z",
        headSha: "abc1234",
        trigger: ProductionReviewTrigger.GitHubCommand,
        isAuthorTrusted: false,
      },
    };
    return value;
  }

  beforeEach(() => {
    world.task = reviewTask();
    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      return world.task;
    });
    requestSpy = jest
      .spyOn(ProductionReviewQueue, "request")
      .mockImplementation(async () => {
        return world.task!;
      });
  });

  test("asks for the review again now, as the person who pressed it", async () => {
    const { next, result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({ taskId: TASK_ID.toString() });

    const asked: ProductionReviewRequest = requestSpy.mock
      .calls[0]![0] as ProductionReviewRequest;

    expect(asked).toEqual({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      installationId: INSTALLATION_ID,
      organizationName: "acme",
      repositoryName: "users-api",
      pullRequestNumber: 42,
      pullRequestTitle: "fix: guard the card",
      headSha: "abc1234",
      isFromFork: true,
      trigger: ProductionReviewTrigger.OneUptime,
      isAuthorTrusted: false,
      requestedByUserId: USER_ID,
      isImmediate: true,
    });
  });

  test("only a production review can be reviewed again", async () => {
    world.task = task();

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(next).message).toBe(
      CODE_TASK_NOT_A_PRODUCTION_REVIEW_MESSAGE,
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a read-only member reads the review but may not ask again", async () => {
    world.props = VIEWER;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(CODE_TASK_REVIEW_AGAIN_REFUSED_MESSAGE);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a repository the GitHub App no longer reaches cannot be reviewed", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue(null);

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(next).message).toBe(
      CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a review in a repository the caller may not read is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(next).message).toBe(CODE_TASK_NOT_FOUND_MESSAGE);
  });

  test("a production review takes no reply: it is updated, not talked to", async () => {
    const { next } = await call("/code-task/reply/:taskId", {
      params: { taskId: TASK_ID.toString() },
      body: { message: "Fix what you found" },
    });

    expect(refusal(next).message).toBe(
      CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE,
    );
    expect(created).toHaveLength(0);
  });
});

describe("listing every task the caller may read (Code's first page)", () => {
  const route: string = "/code-task/list";

  beforeEach(() => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([task()]);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));
    jest.spyOn(CodeTaskPresenter, "summarize").mockResolvedValue([]);
    // What each filter was built from, read off the query.
    jest
      .spyOn(QueryHelper, "inOrNull")
      .mockImplementation((values: Array<string | ObjectID>) => {
        return {
          inOrNull: values.map((value: string | ObjectID) => {
            return value.toString();
          }),
        } as never;
      });
    jest
      .spyOn(QueryHelper, "any")
      .mockImplementation((values: Array<string | ObjectID | number>) => {
        return {
          any: values.map((value: string | ObjectID | number) => {
            return value.toString();
          }),
        } as never;
      });
  });

  function readQuery(): Record<string, unknown> {
    return (
      (AIRunService.findBy as unknown as jest.Mock).mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;
  }

  test("the tasks of every repository the caller may read, and those with no repository for who may read AI runs", async () => {
    const { result } = await call(route, {
      body: { allRepositories: true, skip: 0, limit: 20 },
    });

    expect(result).toEqual({ tasks: [], totalCount: 3, skip: 0, limit: 20 });
    expect(readQuery()["codeRepositoryId"]).toEqual({
      inOrNull: [REPOSITORY_ID.toString()],
    });
    expect((readQuery()["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    // Tasks, not their replies.
    expect(readQuery()).toHaveProperty("codeTaskId");
    // The repositories are read as the caller.
    expect(
      (
        (CodeRepositoryService.findBy as unknown as jest.Mock).mock
          .calls[0]![0] as { props: unknown }
      ).props,
    ).toBe(MEMBER);
  });

  test("someone who may not read AI runs lists only their repositories' tasks", async () => {
    world.props = caller([Permission.ReadCodeRepository]);

    await call(route, { body: { allRepositories: true } });

    expect(readQuery()["codeRepositoryId"]).toEqual({
      any: [REPOSITORY_ID.toString()],
    });
    expect(QueryHelper.inOrNull).not.toHaveBeenCalled();
  });

  test("no repository to read and no AI runs to read: nothing, and nothing is asked of the database", async () => {
    world.props = caller([Permission.ReadCodeRepository]);
    world.repositoryReadable = false;

    const { result } = await call(route, {
      body: { allRepositories: true, skip: 5, limit: 10 },
    });

    expect(result).toEqual({ tasks: [], totalCount: 0, skip: 5, limit: 10 });
    expect(AIRunService.findBy).not.toHaveBeenCalled();
  });

  test("a page at a time, never more than fifty, here too", async () => {
    const { result } = await call(route, {
      body: { allRepositories: true, skip: -4, limit: 900 },
    });

    expect(result).toEqual({ tasks: [], totalCount: 3, skip: 0, limit: 50 });
  });
});

describe("stopping a task", () => {
  const route: string = "/code-task/stop/:taskId";

  test("is for those who may ask AI in its repository", async () => {
    world.props = VIEWER;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toContain("Stopping AI takes permission to edit");
  });

  test("stops the turn in progress, even with AI since turned off", async () => {
    world.enableAi = false;
    jest
      .spyOn(CodeTaskThread, "getPeople")
      .mockResolvedValue(
        new Map([
          [USER_ID.toString(), { id: USER_ID.toString(), name: "Jane" }],
        ]),
      );
    const running: AIRun = task();
    running.status = AIRunStatus.Running;
    world.task = running;
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const transition: jest.Mock = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1) as unknown as jest.Mock;

    const { result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(result).toEqual({ stopped: 1 });
    expect(
      (transition.mock.calls[0]![0] as { set: { errorMessage: string } }).set
        .errorMessage,
    ).toBe("Stopped by Jane.");
  });
});

describe("the repositories, at a glance", () => {
  test("each with its stats and whether AI can reach it; the tasks with no repository are counted for those who may read them", async () => {
    jest.spyOn(CodeTaskStats, "getRepositoryStats").mockResolvedValue(
      new Map([
        [
          REPOSITORY_ID.toString(),
          {
            working: 1,
            waitingForYou: 2,
            openPullRequests: 3,
            taskCount: 9,
            lastActivityAt: "2026-10-19T09:00:00.000Z",
          },
        ],
      ]),
    );
    jest
      .spyOn(CodeTaskStats, "countTasksWithoutRepository")
      .mockResolvedValue(4);

    const { result } = await call("/code-task/repositories");

    expect(result).toEqual({
      repositories: [
        {
          id: REPOSITORY_ID.toString(),
          name: "users-api",
          organizationName: "acme",
          repositoryName: "users-api",
          mainBranchName: "main",
          isConnected: true,
          // Where it is hosted, so each row draws its host's mark.
          provider: "GitHub",
          stats: {
            working: 1,
            waitingForYou: 2,
            openPullRequests: 3,
            taskCount: 9,
            lastActivityAt: "2026-10-19T09:00:00.000Z",
          },
        },
      ],
      tasksWithoutRepositoryCount: 4,
    });
    // The repositories are read as the caller.
    expect(
      (
        (CodeRepositoryService.findBy as unknown as jest.Mock).mock
          .calls[0]![0] as { props: unknown }
      ).props,
    ).toBe(MEMBER);
  });

  /*
   * Code's pages say whether a repository's pull requests are reviewed
   * against production: on only when it was turned on - unset, as every
   * repository connected before the setting existed has it, is off, as the
   * server reads it.
   */
  // A GitHub repository its project's GitHub App reaches.
  const CONNECTED_ON_GITHUB: CodeHostConnectionSummary = {
    connectionId: null,
    provider: CodeRepositoryType.GitHub,
    hostUrl: null,
    hostProduct: null,
    accountLogin: null,
    credentialHint: null,
    state: CodeHostConnectionState.Connected,
    isReachableFromServer: true,
  };

  test("says whether production review is on: on only when it was turned on", async () => {
    const CodeTaskAPI: typeof import("../../../Server/API/CodeTaskAPI").default =
      (await import("../../../Server/API/CodeTaskAPI")).default;
    const value: CodeRepository = repository();

    expect(
      CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB),
    ).not.toHaveProperty("isProductionReviewEnabled");

    value.isProductionReviewEnabled = true;
    expect(
      CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB)
        .isProductionReviewEnabled,
    ).toBe(true);

    value.isProductionReviewEnabled = false;
    expect(
      CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB)
        .isProductionReviewEnabled,
    ).toBe(false);

    (
      value as unknown as { isProductionReviewEnabled: null }
    ).isProductionReviewEnabled = null;
    expect(
      CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB)
        .isProductionReviewEnabled,
    ).toBe(false);
  });

  /*
   * And whether the GitHub App answers commands in it - the production
   * review command among them - so the reviews page offers the command only
   * where it is answered: unset is on, as GitHubCommandAuthorizer reads it.
   */
  test("says whether the GitHub App answers commands: on unless turned off", async () => {
    const CodeTaskAPI: typeof import("../../../Server/API/CodeTaskAPI").default =
      (await import("../../../Server/API/CodeTaskAPI")).default;
    const GitHubCommandAuthorizer: typeof import("../../../Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer").default =
      (
        await import(
          "../../../Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer"
        )
      ).default;
    const value: CodeRepository = repository();

    expect(
      CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB),
    ).not.toHaveProperty("isGitHubCommandsEnabled");

    for (const [stored, shown] of [
      [true, true],
      [false, false],
      [null, true],
    ] as Array<[boolean | null, boolean]>) {
      (
        value as unknown as { isGitHubCommandsEnabled: boolean | null }
      ).isGitHubCommandsEnabled = stored;

      expect(
        CodeTaskAPI.toRepositoryJSON(value, CONNECTED_ON_GITHUB)
          .isGitHubCommandsEnabled,
      ).toBe(shown);
      // As the server answers a command.
      expect(GitHubCommandAuthorizer.areCommandsEnabled(value)).toBe(shown);
    }
  });
});

/*
 * A production review of a GitLab merge request (or a Forgejo or Gitea
 * pull request), asked again from its page: through the repository's
 * connection, which must still work, and on the host the review was asked
 * on - with what the task keeps of it, the head and who it trusts.
 */
describe("reviewing a merge request against production again, off GitHub", () => {
  const route: string = "/code-task/review-again/:taskId";
  let requestSpy: jest.SpyInstance;
  let summary: CodeHostConnectionSummary;

  function gitLabReview(): AIRun {
    const value: AIRun = task();
    value.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
    value.title = "fix: guard the card";
    value.taskContext = {
      codeHostPullRequest: {
        codeRepositoryId: REPOSITORY_ID.toString(),
        provider: CodeRepositoryType.GitLab,
        pullRequestNumber: 12,
        isPullRequestFromFork: false,
        pullRequestUrl:
          "https://gitlab.example.com/acme/users-api/-/merge_requests/12",
      },
      productionReview: {
        requestNumber: 2,
        requestedAt: "2026-10-22T09:00:00.000Z",
        headSha: "abc1234",
        trigger: ProductionReviewTrigger.PullRequestChanged,
        isAuthorTrusted: true,
      },
    };
    return value;
  }

  beforeEach(() => {
    world.task = gitLabReview();
    summary = {
      connectionId: "c0de0000-0000-4000-8000-000000000003",
      provider: CodeRepositoryType.GitLab,
      hostUrl: "https://gitlab.example.com",
      hostProduct: null,
      accountLogin: "oneuptime-bot",
      credentialHint: "abcd",
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    };
    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      return world.task;
    });
    jest
      .spyOn(CodeHostAccess, "getConnectionSummaries")
      .mockImplementation(async () => {
        return new Map([[REPOSITORY_ID.toString(), summary]]);
      });
    requestSpy = jest
      .spyOn(ProductionReviewQueue, "request")
      .mockImplementation(async () => {
        return world.task!;
      });
  });

  test("asks again now through the connection, as the person who pressed it, on the host it was asked on", async () => {
    const { next, result } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({ taskId: TASK_ID.toString() });
    expect(requestSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      provider: CodeRepositoryType.GitLab,
      pullRequestNumber: 12,
      pullRequestTitle: "fix: guard the card",
      headSha: "abc1234",
      isFromFork: false,
      trigger: ProductionReviewTrigger.OneUptime,
      isAuthorTrusted: true,
      requestedByUserId: USER_ID,
      isImmediate: true,
    });
  });

  test("a connection whose token was refused, or gone, is said as such and asks nothing", async () => {
    summary.state = CodeHostConnectionState.TokenRefused;

    const refused: { next: jest.Mock } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(refused.next).message).toBe(
      "GitLab refused this repository's access token, so AI cannot work in it. It may have expired: replace it on the repository's Settings page in Code.",
    );

    summary.state = CodeHostConnectionState.NoConnection;

    const gone: { next: jest.Mock } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(gone.next)).toBeInstanceOf(BadDataException);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("a repository now on another host than the review was asked on is not asked again", async () => {
    summary.provider = CodeRepositoryType.Forgejo;

    const { next } = await call(route, {
      params: { taskId: TASK_ID.toString() },
    });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

/*
 * Review a pull request: any of a repository's open pull (merge) requests,
 * by its number - 12, "12", "#12" or GitLab's "!12" - for those who may ask
 * AI in the repository. The repository is read as root for how it is
 * reached (ProductionReviewAsk), and the answer is the review's task.
 */
describe("asking for a review of a pull request by its number", () => {
  const route: string = "/code-task/review-pull-request/:repositoryId";
  let askSpy: jest.SpyInstance;

  beforeEach(() => {
    askSpy = jest
      .spyOn(ProductionReviewAsk, "ask")
      .mockImplementation(async () => {
        const run: AIRun = new AIRun();
        run._id = TASK_ID.toString();
        return run;
      });
  });

  test.each([[12], ["12"], ["#12"], ["!12"], [" 12 "]] as Array<[unknown]>)(
    "%j asks for pull request 12, as the person who asked, and answers its task",
    async (number: unknown) => {
      const { next, result } = await call(route, {
        params: { repositoryId: REPOSITORY_ID.toString() },
        body: { number } as JSONObject,
      });

      expect(next).not.toHaveBeenCalled();
      expect(result).toEqual({ taskId: TASK_ID.toString() });

      const asked: {
        projectId: ObjectID;
        repository: CodeRepository;
        pullRequestNumber: number;
        requestedByUserId: ObjectID;
      } = askSpy.mock.calls[0]![0] as never;

      expect(asked.projectId).toEqual(PROJECT_ID);
      expect(asked.pullRequestNumber).toBe(12);
      expect(asked.requestedByUserId).toBe(USER_ID);
      expect(asked.repository.gitHubAppInstallationId).toBe(INSTALLATION_ID);
    },
  );

  test.each([
    [0],
    [-3],
    ["x"],
    [""],
    ["12a"],
    ["1234567890"],
    [null],
    [1.5],
  ] as Array<[unknown]>)(
    "%j is no pull request's number, said in the host's words, and nothing is asked",
    async (number: unknown) => {
      const { next } = await call(route, {
        params: { repositoryId: REPOSITORY_ID.toString() },
        body: { number } as JSONObject,
      });

      expect(refusal(next).message).toBe(
        "Enter the number of a pull request, such as #12.",
      );
      expect(askSpy).not.toHaveBeenCalled();
    },
  );

  test("a read-only member reads the repository but may not ask", async () => {
    world.props = VIEWER;

    const { next } = await call(route, {
      params: { repositoryId: REPOSITORY_ID.toString() },
      body: { number: 12 },
    });

    const error: Error = refusal(next);

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(CODE_TASK_REVIEW_PULL_REQUEST_REFUSED_MESSAGE);
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a repository the caller may not read is not found", async () => {
    world.repositoryReadable = false;

    const { next } = await call(route, {
      params: { repositoryId: REPOSITORY_ID.toString() },
      body: { number: 12 },
    });

    expect(refusal(next).message).toBe(CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE);
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("what the ask refuses (a closed pull request) reaches the person, word for word", async () => {
    askSpy.mockRejectedValue(
      new BadDataException(
        "The pull request is closed, so it was not reviewed.",
      ),
    );

    const { next } = await call(route, {
      params: { repositoryId: REPOSITORY_ID.toString() },
      body: { number: 12 },
    });

    expect(refusal(next).message).toBe(
      "The pull request is closed, so it was not reviewed.",
    );
  });

  test("a repository id that is not one is refused before anything is read", async () => {
    const { next } = await call(route, {
      params: { repositoryId: "not-an-id" },
      body: { number: 12 },
    });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
  });
});
