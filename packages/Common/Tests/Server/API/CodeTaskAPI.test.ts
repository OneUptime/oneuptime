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
import {
  CODE_TASK_ASK_REFUSED_MESSAGE,
  CODE_TASK_NOT_FOUND_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import { CODE_TASK_PLAN_REQUIRED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskPresenter from "../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import { CODE_TASK_BUSY_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
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
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskState,
} from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
  jest.spyOn(CodeFixReadiness, "getAgentCheck").mockResolvedValue({
    id: "agentAvailable",
    ok: true,
    title: "",
    detail: "",
  } as never);
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
    ["/code-task/create", {}],
    ["/code-task/reply/:taskId", { taskId: TASK_ID.toString() }],
    ["/code-task/stop/:taskId", { taskId: TASK_ID.toString() }],
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
      "/code-task/get/:taskId",
      "/code-task/create",
      "/code-task/reply/:taskId",
      "/code-task/retry/:taskId",
      "/code-task/stop/:taskId",
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
          isConnected: true,
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
});
