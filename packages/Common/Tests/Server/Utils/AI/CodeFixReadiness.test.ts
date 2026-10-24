import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
  GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
  NO_GLOBAL_RUNNER_ONLINE_DETAIL,
  NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
  describeRepositoryRunnerStatus,
  getRepositoryRunnerBlocker,
  getRepositoryRunnerOfflineDetail,
} from "../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice from "../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import { CodeTaskBlockerType } from "../../../../Types/AI/CodeTask";
import { CodeRepositoryRunnerChoiceKind } from "../../../../Types/Runner/CodeRepositoryRunner";
import AIService from "../../../../Server/Services/AIService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../../Types/AI/AIFixReadiness";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The gates the AI Tasks page renders. The invariant worth protecting: a
 * project LLM provider is NOT a prerequisite — the shared global provider is
 * a legitimate resolution for the agent path, so a project running on it must
 * read as ready. The banner these checks replaced claimed otherwise.
 */

const projectId: ObjectID = ObjectID.generate();

function fakeProvider(params: {
  name: string;
  isGlobalLlm?: boolean;
  costPerMillionTokensInUSDCents?: number;
}): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: params.name,
    isGlobalLlm: params.isGlobalLlm ?? false,
    costPerMillionTokensInUSDCents: params.costPerMillionTokensInUSDCents ?? 0,
  } as unknown as LlmProvider;
}

describe("CodeFixReadiness.getLlmProviderCheck", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no provider resolves at all: not ready, and says where to add one", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(null);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({ projectId });

    expect(check.id).toBe("llmProvider");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("LLM Providers");
  });

  test("a project-owned provider is ready and is named as the project's own", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(fakeProvider({ name: "My OpenAI" }));

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(true);
    expect(check.title).toContain("My OpenAI");
    expect(check.detail).toContain("this project's own provider");
  });

  /*
   * The headline case the old banner got wrong: no project provider, a free
   * global one, and the project is nonetheless ready.
   */
  test("a FREE global provider is ready with no project provider and no balance", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "Global LLM Provider",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 0,
        }),
      );
    const projectSpy: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(true);
    expect(check.detail).toContain("shared provider");
    // A free provider bills nothing, so the balance must never be consulted.
    expect(projectSpy).not.toHaveBeenCalled();
  });

  test("a costed global provider with billing OFF is ready and skips the balance check", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    const projectSpy: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: false,
      });

    expect(check.ok).toBe(true);
    expect(projectSpy).not.toHaveBeenCalled();
  });

  test("a costed global provider with billing ON and a funded balance is ready and says it is metered", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: 2000,
    } as unknown as Project);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(true);
    expect(check.detail).toContain("AI balance");
  });

  test("a costed global provider with billing ON and an empty balance is NOT ready", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: 0,
    } as unknown as Project);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("AI Credits");
    /*
     * Read by everyone on the AI Tasks page: it names who can add credits
     * rather than telling the reader to recharge.
     */
    expect(check.detail).toBe(CODE_FIX_AI_CREDITS_USED_UP_DETAIL);
    expect(check.detail).toContain(
      "A project owner or someone with Manage Billing can add AI credits",
    );
    expect(check.detail).not.toMatch(/\brecharge\b/i);
  });

  /*
   * The first fix completion on used-up credits recharges them first when
   * Auto Recharge is on, as every billed AI call does - so the AI Tasks page
   * says ready, as the AI agent pages and the investigation gate do
   * (AIService.getAiBalanceBlocker).
   */
  test("an empty balance with Auto Recharge on and set up is ready: the first completion refills it", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: 0,
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    } as unknown as Project);
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(true);
  });

  test("an empty balance whose Auto Recharge last failed is NOT ready: it will not refill before the run", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: 0,
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    } as unknown as Project);
    jest
      .spyOn(GlobalCache, "getString")
      .mockResolvedValue("2026-10-07T08:00:00.000Z");

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(false);
    expect(check.detail).toBe(CODE_FIX_AI_CREDITS_USED_UP_DETAIL);
  });

  test("an empty balance with Auto Recharge on but nothing to add is NOT ready", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        fakeProvider({
          name: "OneUptime AI",
          isGlobalLlm: true,
          costPerMillionTokensInUSDCents: 500,
        }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: 0,
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 0,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    } as unknown as Project);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: true,
      });

    expect(check.ok).toBe(false);
  });
});

/*
 * AI_CODE_FIX_FEATURE is one of AUTONOMOUS_AI_FEATURES, so executeWithLogging
 * runs every fix completion through the daily token budget. Readiness that
 * ignored it would report ready and then die at the run's first completion
 * call — the exact fail-late hole the balance gate exists to close.
 */
/*
 * Readiness only covers subjectless fix tasks, and subjectless AI work has no
 * daily token limit, so the token budget never gates it.
 */
describe("CodeFixReadiness.getLlmProviderCheck — daily autonomous token budget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the daily token budget is not consulted", async () => {
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(fakeProvider({ name: "My OpenAI" }));
    const getBudget: jest.SpyInstance = jest.spyOn(
      AIService,
      "getAutonomousDailyBudgetStatus",
    );

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: false,
      });

    expect(check.ok).toBe(true);
    expect(getBudget).not.toHaveBeenCalled();
  });
});

/*
 * Whether a Runner is online to do the work: for a known repository, the one
 * its Runner setting in Code picks (or a global Runner for one that picks
 * none - CodeRepositoryRunnerChoice, which has its own suite); before a
 * repository is known, anything online for the project's repositories.
 */
describe("CodeFixReadiness.getAgentCheck", () => {
  const RUNNER_ID: string = "0a1b2c3d-1111-4222-8333-944455556666";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("project-wide: nothing online for the project's repositories is not ready, and says what decides it", async () => {
    const anyOnline: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(false);

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
    });

    expect(anyOnline).toHaveBeenCalledWith(projectId);
    expect(check.id).toBe("agentAvailable");
    expect(check.ok).toBe(false);
    expect(check.title).toBe("Runner online");
    expect(check.detail).toBe(NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL);
  });

  test("project-wide: something online is ready", async () => {
    jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(true);

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
    });

    expect(check.ok).toBe(true);
    expect(check.detail).toBe("Connected and polling for tasks.");
  });

  test("a repository's own Runner online: ready, and named", async () => {
    const status: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: RUNNER_ID,
        },
        isOnline: true,
        runnerName: "prod-runner",
      });

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
      repository: { projectId, runnerId: RUNNER_ID },
    });

    expect(status).toHaveBeenCalledWith({ projectId, runnerId: RUNNER_ID });
    expect(check.ok).toBe(true);
    expect(check.title).toBe("Runner online: prod-runner");
  });

  test("a repository on a global Runner that is online: ready, as the Global Runner", async () => {
    jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      });

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
      repository: { projectId },
    });

    expect(check.ok).toBe(true);
    expect(check.title).toBe("Global Runner online");
  });

  test.each([
    [
      "its own Runner is offline",
      {
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: RUNNER_ID,
        },
        isOnline: false,
        runnerName: "prod-runner",
      },
      getRepositoryRunnerOfflineDetail("prod-runner"),
    ],
    [
      "no global Runner is online",
      {
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: false,
      },
      NO_GLOBAL_RUNNER_ONLINE_DETAIL,
    ],
    [
      "its project turned global Runners off",
      {
        decision: { kind: CodeRepositoryRunnerChoiceKind.NoRunner },
        isOnline: false,
      },
      GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
    ],
  ])(
    "a repository whose %s: not ready, saying why",
    async (_why: string, status: unknown, detail: string) => {
      jest
        .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
        .mockResolvedValue(status as never);

      const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
        projectId,
        repository: { projectId },
      });

      expect(check.ok).toBe(false);
      expect(check.title).toBe("Runner online");
      expect(check.detail).toBe(detail);
    },
  );
});

describe("why nothing can do a repository's work, in words and as Code's blocker", () => {
  test("a Runner the repository picks that is offline is named, with what to do", () => {
    expect(getRepositoryRunnerOfflineDetail("prod-runner")).toBe(
      'The Runner "prod-runner" this repository picks is not online. Check that its container is running, or pick another Runner in the repository\'s settings in Code.',
    );
    // A pick the project no longer has is still said, without a name.
    expect(getRepositoryRunnerOfflineDetail(undefined)).toBe(
      "The Runner this repository picks is not online. Check that its container is running, or pick another Runner in the repository's settings in Code.",
    );
  });

  test("each says where the Runner is picked: the repository's settings in Code", () => {
    for (const detail of [
      NO_GLOBAL_RUNNER_ONLINE_DETAIL,
      GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
      getRepositoryRunnerOfflineDetail("x"),
    ]) {
      expect(detail).toContain("repository's settings in Code");
      // Never the switch Runners no longer have.
      expect(detail).not.toContain("Code Fixes");
    }
  });

  test("online is no reason at all, and no blocker", () => {
    const online: Parameters<typeof describeRepositoryRunnerStatus>[0] = {
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: true,
    };

    expect(describeRepositoryRunnerStatus(online)).toBeNull();
    expect(getRepositoryRunnerBlocker(online)).toBeNull();
  });

  test("a Runner whose name is not known is not named", () => {
    const blocker: ReturnType<typeof getRepositoryRunnerBlocker> =
      getRepositoryRunnerBlocker({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: "0a1b2c3d-1111-4222-8333-944455556666",
        },
        isOnline: false,
      });

    expect(blocker).toEqual({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: getRepositoryRunnerOfflineDetail(undefined),
    });
    expect(Object.keys(blocker || {})).not.toContain("runnerName");
  });

  test("each kind of decision is its own blocker", () => {
    expect(
      getRepositoryRunnerBlocker({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: "0a1b2c3d-1111-4222-8333-944455556666",
        },
        isOnline: false,
        runnerName: "prod-runner",
      }),
    ).toEqual({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: getRepositoryRunnerOfflineDetail("prod-runner"),
      // Named, so Code's notice says which Runner to check.
      runnerName: "prod-runner",
    });
    expect(
      getRepositoryRunnerBlocker({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: false,
      }),
    ).toEqual({
      type: CodeTaskBlockerType.NoAgent,
      message: NO_GLOBAL_RUNNER_ONLINE_DETAIL,
    });
    expect(
      getRepositoryRunnerBlocker({
        decision: { kind: CodeRepositoryRunnerChoiceKind.NoRunner },
        isOnline: false,
      }),
    ).toEqual({
      type: CodeTaskBlockerType.GlobalRunnersOff,
      message: GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
    });
  });
});

describe("CodeFixReadiness.getRepositoryConnectedCheck", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The page-level gate asserts the WEAKER any-repo claim, so its id must
   * stay distinct from the per-exception repositoryResolved — a UI that saw
   * the same id would imply a specific exception will resolve.
   */
  test("a connected repository is ready under the repositoryConnected id", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getRepositoryConnectedCheck({ projectId });

    expect(check.id).toBe("repositoryConnected");
    expect(check.ok).toBe(true);
  });

  test("no connected repository: not ready, and points at the GitHub App", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getRepositoryConnectedCheck({ projectId });

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub App");
  });
});

describe("CodeFixReadiness.getProjectReadiness", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type MockAllParams = {
    hasRepo: boolean;
    hasProvider: boolean;
    agentAlive: boolean;
  };

  function mockAll(params: MockAllParams): void {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(params.hasRepo);
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        params.hasProvider ? fakeProvider({ name: "provider" }) : null,
      );
    jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(params.agentAlive);
  }

  test("all three gates satisfied: ready", async () => {
    mockAll({ hasRepo: true, hasProvider: true, agentAlive: true });

    const readiness: AIFixReadiness =
      await CodeFixReadiness.getProjectReadiness({ projectId });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toHaveLength(3);
  });

  test("the checks are ordered the way the user sets them up", async () => {
    mockAll({ hasRepo: true, hasProvider: true, agentAlive: true });

    const readiness: AIFixReadiness =
      await CodeFixReadiness.getProjectReadiness({ projectId });

    expect(
      readiness.checks.map((check: AIFixReadinessCheck) => {
        return check.id;
      }),
    ).toEqual(["repositoryConnected", "llmProvider", "agentAvailable"]);
  });

  test("any single failing gate makes the whole project not ready", async () => {
    const cases: Array<MockAllParams> = [
      { hasRepo: false, hasProvider: true, agentAlive: true },
      { hasRepo: true, hasProvider: false, agentAlive: true },
      { hasRepo: true, hasProvider: true, agentAlive: false },
    ];

    for (const params of cases) {
      jest.restoreAllMocks();
      mockAll(params);

      const readiness: AIFixReadiness =
        await CodeFixReadiness.getProjectReadiness({ projectId });

      expect(readiness.ready).toBe(false);
      // The failing gate must still be reported, not swallowed.
      expect(
        readiness.checks.some((check: AIFixReadinessCheck) => {
          return !check.ok;
        }),
      ).toBe(true);
    }
  });
});
