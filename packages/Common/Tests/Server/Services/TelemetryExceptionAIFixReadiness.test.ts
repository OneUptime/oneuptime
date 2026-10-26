import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../Types/AI/AIFixReadiness";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIAgentService from "../../../Server/Services/AIAgentService";
import RunnerService from "../../../Server/Services/RunnerService";
import GlobalRunnerChoice from "../../../Server/Utils/Runner/GlobalRunnerChoice";
import {
  GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
  NO_GLOBAL_RUNNER_ONLINE_DETAIL,
  NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
} from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../Models/DatabaseModels/Runner";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import AIService from "../../../Server/Services/AIService";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * "Fix with AI Agent" readiness: every prerequisite is checked BEFORE a task
 * is created. Since the runtime-resolution change there are exactly three
 * checks — LLM provider (project-owned preferred, metered global fallback —
 * agent completions are server-mediated), repository RESOLVED (stack-trace
 * matching with fallbacks, no Service Catalog prerequisite), agent online.
 * These tests mock the persistence layer and lock in each check's fail
 * condition and the fail-early behaviour of task creation.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
// The repository the exception resolves to, and a Runner it may pick.
const repositoryId: ObjectID = ObjectID.generate();
const runnerId: ObjectID = ObjectID.generate();

function fakeException(): TelemetryException {
  return {
    id: exceptionId,
    projectId: projectId,
    primaryEntityId: serviceId,
    stackTrace: "at charge (/app/src/billing/charge.ts:12:5)",
  } as unknown as TelemetryException;
}

function fakeResolution(): RepoResolution {
  return {
    codeRepositoryId: repositoryId.toString(),
    organizationName: "acme",
    repositoryName: "checkout",
    servicePathInRepository: null,
    method: "stack-trace",
    evidence: "Matched src/billing/charge.ts in acme/checkout",
  };
}

function fakeAgent(data: {
  connectionStatus?: AIAgentConnectionStatus;
  lastAlive?: Date;
}): AIAgent {
  return {
    id: ObjectID.generate(),
    name: "agent",
    connectionStatus: data.connectionStatus,
    lastAlive: data.lastAlive,
  } as unknown as AIAgent;
}

interface ReadinessMocks {
  provider?: LlmProvider | null;
  resolution?: RepoResolution | null;
  resolutionThrows?: Error;
  // The global Runner for code (a global AI agent); one alive by default.
  agent?: AIAgent | null;
  // The Runner the resolved repository picks, if it picks one.
  repositoryRunner?: Runner | null;
  // Whether the project uses global Runners (on by default).
  projectUsesGlobalRunners?: boolean;
}

function mockReadiness(data: ReadinessMocks): void {
  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockResolvedValue(fakeException());
  jest
    .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
    .mockResolvedValue(
      data.provider === undefined
        ? ({ id: ObjectID.generate(), name: "BYO" } as unknown as LlmProvider)
        : data.provider,
    );
  jest.spyOn(ServiceService, "findOneById").mockResolvedValue({
    id: serviceId,
    name: "checkout",
  } as unknown as TelemetryService);

  const resolutionSpy: jest.SpiedFunction<
    typeof CodeRepositoryService.resolveRepositoryForException
  > = jest.spyOn(CodeRepositoryService, "resolveRepositoryForException");

  if (data.resolutionThrows) {
    resolutionSpy.mockRejectedValue(data.resolutionThrows);
  } else {
    resolutionSpy.mockResolvedValue(
      data.resolution === undefined ? fakeResolution() : data.resolution,
    );
  }

  const agent: AIAgent | null =
    data.agent === undefined
      ? fakeAgent({ connectionStatus: AIAgentConnectionStatus.Connected })
      : data.agent;

  /*
   * The agent check asks whether what the resolved repository works on is
   * online: the Runner it picks, or - for one that picks none - a global
   * Runner for code. Liveness runs through the real isAgentAlive and
   * getRunnerLiveStatus, so a stale heartbeat behaves here exactly as it
   * does in production.
   */
  jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue({
    id: repositoryId,
    runnerId: data.repositoryRunner?.id,
  } as unknown as CodeRepository);
  jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([]);
  // None of them, so none follows the project's default Runner (#5275).
  jest
    .spyOn(CodeRepositoryService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue(data.repositoryRunner || null);
  jest
    .spyOn(GlobalRunnerChoice, "doesProjectUseGlobalRunners")
    .mockResolvedValue(data.projectUsesGlobalRunners !== false);
  jest.spyOn(AIAgentService, "getOnlineProjectAIAgent").mockResolvedValue(null);
  jest
    .spyOn(AIAgentService, "findGlobalCodeRunners")
    .mockResolvedValue(agent ? [agent] : []);
}

function fakeRunner(data: { lastAlive?: Date | undefined }): Runner {
  return {
    id: runnerId,
    _id: runnerId.toString(),
    name: "prod-eu-runner",
    lastAlive: data.lastAlive,
    hostInfo: {},
  } as unknown as Runner;
}

function getCheck(readiness: AIFixReadiness, id: string): AIFixReadinessCheck {
  const check: AIFixReadinessCheck | undefined = readiness.checks.find(
    (item: AIFixReadinessCheck) => {
      return item.id === id;
    },
  );
  expect(check).toBeDefined();
  return check!;
}

/*
 * The llmProvider check also gates on the daily autonomous token budget
 * (AI_CODE_FIX_FEATURE is autonomous, so executeWithLogging enforces it).
 * Default it to unset — these suites are about the other fail conditions.
 */
function mockBudgetNotExhausted(): void {
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });
}

describe("TelemetryExceptionService.getAIFixReadiness", () => {
  beforeEach(() => {
    mockBudgetNotExhausted();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is ready with provider, resolved repository, and alive agent — exactly three checks", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toHaveLength(3);
    for (const check of readiness.checks) {
      expect(check.ok).toBe(true);
    }
  });

  test("resolved repository is named in the check title as evidence", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(getCheck(readiness, "repositoryResolved").title).toContain(
      "acme/checkout",
    );
  });

  test("fails llmProvider check when no provider is available", async () => {
    mockReadiness({ provider: null });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "llmProvider");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("LLM Providers");
  });

  test("fails repositoryResolved check when nothing resolves", async () => {
    mockReadiness({ resolution: null });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(
      readiness,
      "repositoryResolved",
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub App");
  });

  test("resolver failure fails the check with the error surfaced, not a crash", async () => {
    mockReadiness({ resolutionThrows: new Error("GitHub API rate limited") });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(
      readiness,
      "repositoryResolved",
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub API rate limited");
  });

  test("fails agent check when the only global Runner has a stale heartbeat", async () => {
    mockReadiness({
      agent: fakeAgent({
        connectionStatus: AIAgentConnectionStatus.Disconnected,
        lastAlive: OneUptimeDate.getSomeMinutesAgo(10),
      }),
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "agentAvailable");
    expect(check.ok).toBe(false);
    expect(check.detail).toBe(NO_GLOBAL_RUNNER_ONLINE_DETAIL);
  });

  test("a repository that picks no Runner is ready on a live global Runner, said so", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    const check: AIFixReadinessCheck = getCheck(readiness, "agentAvailable");
    expect(check.ok).toBe(true);
    expect(check.title).toBe("Global Runner online");
  });

  test("asks about the Runner the resolved repository picks: online, it is named", async () => {
    mockReadiness({
      // No global Runner at all: it is not what this repository runs on.
      agent: null,
      repositoryRunner: fakeRunner({
        lastAlive: OneUptimeDate.getSomeMinutesAgo(1),
      }),
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(true);
    expect(getCheck(readiness, "agentAvailable").title).toBe(
      "Runner online: prod-eu-runner",
    );
    // Read from the repository the exception resolved to, as OneUptime.
    expect(CodeRepositoryService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: repositoryId.toString(),
          projectId: projectId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("the Runner the repository picks is offline: not ready, named, with what to do - a live global Runner does not stand in", async () => {
    mockReadiness({
      repositoryRunner: fakeRunner({
        lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      }),
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "agentAvailable");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('The Runner "prod-eu-runner"');
    expect(check.detail).toContain("pick another Runner");
  });

  test("a repository that picks none, in a project that turned global Runners off, needs one of the project's Runners", async () => {
    mockReadiness({ projectUsesGlobalRunners: false });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    expect(getCheck(readiness, "agentAvailable").detail).toBe(
      GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
    );
  });

  test("with no repository resolved, asks whether anything is online for the project's repositories", async () => {
    mockReadiness({ resolution: null, agent: null });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(getCheck(readiness, "agentAvailable").detail).toBe(
      NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
    );
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
  });
});

/*
 * The llmProvider check must model PAYABILITY, not just existence: on cloud
 * a COSTED global provider bills the project's AI balance per completion
 * (AIService.executeWithLogging), so a zero balance would pass a
 * presence-only readiness check and then fail the run at its first LLM
 * call — the exact fail-late mode readiness exists to prevent. Project-owned
 * and free-global providers consume no balance and must never require one.
 */
describe("TelemetryExceptionService.getAIFixReadiness — AI balance gate", () => {
  beforeEach(() => {
    mockBudgetNotExhausted();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function costedGlobalProvider(): LlmProvider {
    return {
      id: ObjectID.generate(),
      name: "OneUptime Hosted",
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: 300,
    } as unknown as LlmProvider;
  }

  function mockProjectBalance(balanceInUSDCents: number): void {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      aiCurrentBalanceInUSDCents: balanceInUSDCents,
    } as unknown as Project);
  }

  test("cloud + costed global provider + zero balance: fails with recharge guidance", async () => {
    mockReadiness({ provider: costedGlobalProvider() });
    mockProjectBalance(0);

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        billingEnabled: true,
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "llmProvider");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("AI Credits");
  });

  test("cloud + costed global provider + positive balance: ready", async () => {
    mockReadiness({ provider: costedGlobalProvider() });
    mockProjectBalance(500);

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        billingEnabled: true,
      });

    expect(getCheck(readiness, "llmProvider").ok).toBe(true);
    expect(readiness.ready).toBe(true);
  });

  test("a FREE global provider needs no balance — the project is never queried", async () => {
    mockReadiness({
      provider: {
        id: ObjectID.generate(),
        name: "Hosted free",
        isGlobalLlm: true,
        costPerMillionTokensInUSDCents: 0,
      } as unknown as LlmProvider,
    });
    const projectSpy: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        billingEnabled: true,
      });

    expect(getCheck(readiness, "llmProvider").ok).toBe(true);
    expect(projectSpy).not.toHaveBeenCalled();
  });

  test("self-host (billing disabled): a costed global provider needs no balance", async () => {
    mockReadiness({ provider: costedGlobalProvider() });
    const projectSpy: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        billingEnabled: false,
      });

    expect(getCheck(readiness, "llmProvider").ok).toBe(true);
    expect(projectSpy).not.toHaveBeenCalled();
  });

  test("project-owned provider on cloud: no balance requirement", async () => {
    // The default mockReadiness fixture is a BYO (project-owned) provider.
    mockReadiness({});
    const projectSpy: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        billingEnabled: true,
      });

    expect(getCheck(readiness, "llmProvider").ok).toBe(true);
    expect(projectSpy).not.toHaveBeenCalled();
  });
});

describe("TelemetryExceptionService.createCodeFixRunForException fail-early", () => {
  beforeEach(() => {
    // AI on: the switch's own refusal has its suite (TelemetryExceptionCodeFixRun).
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects with every missing prerequisite named, before any run is created", async () => {
    mockReadiness({ provider: null, agent: null });

    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);

    // Both prerequisites are named, whichever comes first.
    const refusal: Error | null =
      await TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }).then(
        (): null => {
          return null;
        },
        (error: Error): Error => {
          return error;
        },
      );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toContain("LLM provider");
    expect(refusal?.message).toContain("Runner online");
  });
});

describe("AIAgentService.isAgentAlive", () => {
  test("alive on Connected status regardless of lastAlive", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ connectionStatus: AIAgentConnectionStatus.Connected }),
      ),
    ).toBe(true);
  });

  test("alive on a heartbeat within five minutes", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ lastAlive: OneUptimeDate.getCurrentDate() }),
      ),
    ).toBe(true);
  });

  test("dead with a stale heartbeat and no Connected status", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(10) }),
      ),
    ).toBe(false);
  });

  test("dead with no heartbeat at all", () => {
    expect(AIAgentService.isAgentAlive(fakeAgent({}))).toBe(false);
  });
});
