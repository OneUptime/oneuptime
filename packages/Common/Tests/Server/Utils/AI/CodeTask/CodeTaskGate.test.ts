import AIService, {
  AI_DISABLED_MESSAGE,
  ProjectAiDailyLimitStatus,
} from "../../../../../Server/Services/AIService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
  GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
  NO_GLOBAL_RUNNER_ONLINE_DETAIL,
  getRepositoryRunnerOfflineDetail,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import { CODE_TASK_ASK_REFUSED_MESSAGE } from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate, {
  CODE_TASK_PLAN_REQUIRED_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
  CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../../Types/AI/CodeTask";
import { ProjectAiDailyLimit } from "../../../../../Types/AI/ProjectAiDailyLimits";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import { CodeRepositoryRunnerChoiceKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
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

/*
 * Whether AI may start or continue a task in a repository, and if not, the
 * one thing to fix - in the order a person would fix them. The repository
 * page asks first (so the box says what is missing before anyone types) and
 * every route that starts work asks again and refuses with the same words,
 * as an error of its kind: no permission is 403, a plan or unpaid bill is
 * 402, the rest are 400.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const OTHER_REPOSITORY_ID: ObjectID = new ObjectID(
  "4d0e3a2f-6b7c-4d8e-9f0a-1b2c3d4e5f60",
);
const INSTALLATION_ID: string = "48213377";
const RUNNER_ID: ObjectID = new ObjectID(
  "5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6071",
);

interface World {
  enableAi: boolean | undefined;
  projectFound: boolean;
  boundInstallationId: string | null;
  repositoryHost: CodeRepositoryType;
  repositoryInstallationId: string | undefined;
  llmOk: boolean;
  llmDetail: string;
  reachedLimit: ProjectAiDailyLimitStatus | null;
  // The Runner the repository picks (its Runner setting in Code), if any.
  repositoryRunnerId: ObjectID | undefined;
  // What it runs on now, and whether that is online.
  runnerStatus: CodeRepositoryRunnerStatus;
}

let world: World;

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

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
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

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = PROJECT_ID;
  return value;
}

function props(
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"),
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

async function blocker(
  data: {
    canAsk?: boolean;
    props?: DatabaseCommonInteractionProps;
    billingEnabled?: boolean;
  } = {},
): Promise<CodeTaskBlocker | null> {
  return await CodeTaskGate.getBlocker({
    props: data.props || props(),
    projectId: PROJECT_ID,
    repository: repository(),
    canAsk: data.canAsk ?? true,
    billingEnabled: data.billingEnabled ?? true,
  });
}

beforeEach(() => {
  world = {
    enableAi: true,
    projectFound: true,
    boundInstallationId: INSTALLATION_ID,
    repositoryHost: CodeRepositoryType.GitHub,
    repositoryInstallationId: INSTALLATION_ID,
    llmOk: true,
    llmDetail: "",
    reachedLimit: null,
    repositoryRunnerId: undefined,
    runnerStatus: {
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: true,
    },
  };

  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project | null> => {
      if (!world.projectFound) {
        return null;
      }
      const project: Project = new Project();
      if (world.enableAi !== undefined) {
        project.enableAi = world.enableAi;
      }
      return project;
    });

  jest
    .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
    .mockImplementation(async (): Promise<string | null> => {
      return world.boundInstallationId;
    });

  jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockImplementation(async (): Promise<Array<CodeRepository>> => {
      const row: CodeRepository = new CodeRepository();
      row._id = REPOSITORY_ID.toString();
      row.repositoryHostedAt = world.repositoryHost;
      if (world.repositoryInstallationId) {
        row.gitHubAppInstallationId = world.repositoryInstallationId;
      }
      return [row];
    });

  jest
    .spyOn(CodeFixReadiness, "getLlmProviderCheck")
    .mockImplementation(async () => {
      return {
        id: "llmProvider",
        ok: world.llmOk,
        title: "An LLM provider is available",
        detail: world.llmDetail,
      } as never;
    });

  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async () => {
      return world.reachedLimit;
    });

  // The repository's Runner setting, read as OneUptime.
  jest
    .spyOn(CodeRepositoryService, "findOneById")
    .mockImplementation(async (): Promise<CodeRepository | null> => {
      const row: CodeRepository = new CodeRepository();
      row._id = REPOSITORY_ID.toString();
      if (world.repositoryRunnerId) {
        row.runnerId = world.repositoryRunnerId;
      }
      return row;
    });

  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockImplementation(async () => {
      return world.runnerStatus;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskGate.getBlocker", () => {
  test("nothing stops AI when every gate is open", async () => {
    expect(await blocker()).toBeNull();
  });

  test("an unpaid bill or a plan below Growth is said before permission: it stops everyone", async () => {
    expect(
      (
        await blocker({
          canAsk: false,
          props: props({ isSubscriptionUnpaid: true }),
        })
      )?.type,
    ).toBe(CodeTaskBlockerType.SubscriptionUnpaid);
    expect(
      (
        await blocker({
          canAsk: false,
          props: props({ currentPlan: PlanType.Free }),
        })
      )?.type,
    ).toBe(CodeTaskBlockerType.PlanRequired);
  });

  test("someone who may only read the repository is told so, and nothing else is asked", async () => {
    world.enableAi = false;
    world.runnerStatus = {
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: false,
    };

    expect(await blocker({ canAsk: false })).toEqual({
      type: CodeTaskBlockerType.NoPermission,
      message: CODE_TASK_ASK_REFUSED_MESSAGE,
    });
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("an unpaid subscription, then a plan below Growth", async () => {
    expect(
      await blocker({ props: props({ isSubscriptionUnpaid: true }) }),
    ).toEqual({
      type: CodeTaskBlockerType.SubscriptionUnpaid,
      message: CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
    });

    expect(
      await blocker({ props: props({ currentPlan: PlanType.Free }) }),
    ).toEqual({
      type: CodeTaskBlockerType.PlanRequired,
      message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
    });
  });

  test("with billing off, the plan and the bill never stop anyone", async () => {
    expect(
      await blocker({
        props: props({
          currentPlan: PlanType.Free,
          isSubscriptionUnpaid: true,
        }),
        billingEnabled: false,
      }),
    ).toBeNull();
  });

  test("the project's one AI switch: off stops it, unset means on", async () => {
    world.enableAi = false;
    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.AiDisabled,
      message: AI_DISABLED_MESSAGE,
    });

    world.enableAi = undefined;
    expect(await blocker()).toBeNull();

    world.projectFound = false;
    expect((await blocker())?.type).toBe(CodeTaskBlockerType.AiDisabled);
  });

  test("the switch is read from the project as it is now, as root", async () => {
    await blocker();

    const call: {
      id: ObjectID;
      select: Record<string, boolean>;
      props: unknown;
    } = (ProjectService.findOneById as unknown as jest.Mock).mock
      .calls[0]![0] as never;

    expect(call.id.toString()).toBe(PROJECT_ID.toString());
    expect(call.select["enableAi"]).toBe(true);
    expect(call.props).toEqual({ isRoot: true });
  });

  test.each([
    [
      "the project has no GitHub installation bound",
      { boundInstallationId: null },
    ],
    [
      "the repository came from another installation",
      { repositoryInstallationId: "99999999" },
    ],
    [
      "the repository has no installation",
      { repositoryInstallationId: undefined },
    ],
    [
      "the repository is not on GitHub",
      { repositoryHost: CodeRepositoryType.GitLab },
    ],
  ])(
    "a repository AI cannot reach: %s",
    async (_why: string, change: Partial<World>) => {
      Object.assign(world, change);

      expect(await blocker()).toEqual({
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
      });
    },
  );

  test("no LLM provider, and used-up AI credits, are told apart", async () => {
    world.llmOk = false;
    world.llmDetail = "No LLM provider is configured for this project.";

    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.NoLlmProvider,
      message: "No LLM provider is configured for this project.",
    });

    world.llmDetail = CODE_FIX_AI_CREDITS_USED_UP_DETAIL;

    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.NoAiCredits,
      message: CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
    });
  });

  test("a daily AI limit the project reached says which, and when it resets", async () => {
    world.reachedLimit = {
      reachedLimit: ProjectAiDailyLimit.Tokens,
      tokenLimit: 100000,
      spendLimitInUSD: null,
      usage: { usedTokensToday: 100500, spentTodayInUSDCents: 0 },
    } as unknown as ProjectAiDailyLimitStatus;

    const found: CodeTaskBlocker | null = await blocker();

    expect(found?.type).toBe(CodeTaskBlockerType.DailyLimitReached);
    expect(found?.message).toContain(
      "This project has reached its daily AI token limit: 100,500 of 100,000 tokens used today.",
    );
    expect(found?.message).toContain(
      "OneUptime AI starts again at midnight UTC.",
    );
  });

  test("no Runner online to do the work is the last thing asked", async () => {
    world.runnerStatus = {
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: false,
    };

    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.NoAgent,
      message: NO_GLOBAL_RUNNER_ONLINE_DETAIL,
    });
  });

  test("asks about the Runner the repository picks, read as OneUptime whatever the reader may see", async () => {
    world.repositoryRunnerId = RUNNER_ID;

    await blocker({ props: props({ isRoot: false }) });

    expect(CodeRepositoryService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REPOSITORY_ID,
        select: expect.objectContaining({ runnerId: true }),
        props: { isRoot: true },
      }),
    );
    expect(
      CodeRepositoryRunnerChoice.getStatusForRepository,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      runnerId: RUNNER_ID,
    });
  });

  test("the Runner the repository picks is offline: RunnerNotOnline, naming it", async () => {
    world.repositoryRunnerId = RUNNER_ID;
    world.runnerStatus = {
      decision: {
        kind: CodeRepositoryRunnerChoiceKind.Custom,
        runnerId: RUNNER_ID.toString(),
      },
      isOnline: false,
      runnerName: "prod-runner",
    };

    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: getRepositoryRunnerOfflineDetail("prod-runner"),
      runnerName: "prod-runner",
    });
  });

  test("a repository that picks none in a project that turned global Runners off: GlobalRunnersOff", async () => {
    world.runnerStatus = {
      decision: { kind: CodeRepositoryRunnerChoiceKind.NoRunner },
      isOnline: false,
    };

    expect(await blocker()).toEqual({
      type: CodeTaskBlockerType.GlobalRunnersOff,
      message: GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
    });
  });

  test("the repository's own Runner online lets the work start, whatever global Runners do", async () => {
    world.repositoryRunnerId = RUNNER_ID;
    world.runnerStatus = {
      decision: {
        kind: CodeRepositoryRunnerChoiceKind.Custom,
        runnerId: RUNNER_ID.toString(),
      },
      isOnline: true,
      runnerName: "prod-runner",
    };

    expect(await blocker()).toBeNull();
  });

  test("the first thing to fix is the one said, in order", async () => {
    world.enableAi = false;
    world.boundInstallationId = null;
    world.llmOk = false;
    world.runnerStatus = {
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: false,
    };

    const order: Array<CodeTaskBlockerType> = [];

    for (const fix of [
      (): void => {
        world.enableAi = true;
      },
      (): void => {
        world.boundInstallationId = INSTALLATION_ID;
      },
      (): void => {
        world.llmOk = true;
      },
      (): void => {
        world.runnerStatus = {
          decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
          isOnline: true,
        };
      },
    ]) {
      order.push((await blocker())!.type);
      fix();
    }

    expect(order).toEqual([
      CodeTaskBlockerType.AiDisabled,
      CodeTaskBlockerType.RepositoryNotConnected,
      CodeTaskBlockerType.NoLlmProvider,
      CodeTaskBlockerType.NoAgent,
    ]);
    expect(await blocker()).toBeNull();
  });
});

describe("CodeTaskGate.assertCanStart", () => {
  async function thrown(data: {
    canAsk?: boolean;
    props?: DatabaseCommonInteractionProps;
  }): Promise<unknown> {
    try {
      await CodeTaskGate.assertCanStart({
        props: data.props || props(),
        projectId: PROJECT_ID,
        repository: repository(),
        canAsk: data.canAsk ?? true,
        billingEnabled: true,
      });
    } catch (error) {
      return error;
    }

    return null;
  }

  test("refuses with the blocker's own words, as an error of its kind", async () => {
    const noPermission: unknown = await thrown({ canAsk: false });
    expect(noPermission).toBeInstanceOf(NotAuthorizedException);
    expect((noPermission as Error).message).toBe(CODE_TASK_ASK_REFUSED_MESSAGE);

    const plan: unknown = await thrown({
      props: props({ currentPlan: PlanType.Free }),
    });
    expect(plan).toBeInstanceOf(PaymentRequiredException);
    expect((plan as Error).message).toBe(CODE_TASK_PLAN_REQUIRED_MESSAGE);

    world.enableAi = false;
    const off: unknown = await thrown({});
    expect(off).toBeInstanceOf(BadDataException);
    expect((off as Error).message).toBe(AI_DISABLED_MESSAGE);
  });

  test("lets the work start when nothing stops it", async () => {
    expect(await thrown({})).toBeNull();
  });
});

describe("CodeTaskGate.getReachableRepositoryIds", () => {
  test("only GitHub repositories of the installation bound to the project", async () => {
    (CodeRepositoryService.findBy as unknown as jest.Mock).mockImplementation(
      async (): Promise<Array<CodeRepository>> => {
        const reachable: CodeRepository = new CodeRepository();
        reachable._id = REPOSITORY_ID.toString();
        reachable.repositoryHostedAt = CodeRepositoryType.GitHub;
        reachable.gitHubAppInstallationId = INSTALLATION_ID;

        const stale: CodeRepository = new CodeRepository();
        stale._id = OTHER_REPOSITORY_ID.toString();
        stale.repositoryHostedAt = CodeRepositoryType.GitHub;
        stale.gitHubAppInstallationId = "1";

        return [reachable, stale];
      },
    );

    const reachable: Set<string> = await CodeTaskGate.getReachableRepositoryIds(
      {
        projectId: PROJECT_ID,
        repositoryIds: [REPOSITORY_ID, OTHER_REPOSITORY_ID],
      },
    );

    expect(Array.from(reachable)).toEqual([REPOSITORY_ID.toString()]);

    const call: { query: Record<string, unknown>; props: unknown } = (
      CodeRepositoryService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(call.props).toEqual({ isRoot: true });
  });

  test("asks nothing for no repositories, or a project with no installation", async () => {
    expect(
      Array.from(
        await CodeTaskGate.getReachableRepositoryIds({
          projectId: PROJECT_ID,
          repositoryIds: [],
        }),
      ),
    ).toEqual([]);

    world.boundInstallationId = null;

    expect(
      Array.from(
        await CodeTaskGate.getReachableRepositoryIds({
          projectId: PROJECT_ID,
          repositoryIds: [REPOSITORY_ID],
        }),
      ),
    ).toEqual([]);
    expect(CodeRepositoryService.findBy).not.toHaveBeenCalled();
  });
});
