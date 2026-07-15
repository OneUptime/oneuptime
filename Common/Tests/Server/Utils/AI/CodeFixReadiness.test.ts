import CodeFixReadiness from "../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import AIAgentService from "../../../../Server/Services/AIAgentService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
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
  });
});

describe("CodeFixReadiness.getAgentCheck", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no agent for the project: not ready", async () => {
    jest.spyOn(AIAgentService, "getAIAgentForProject").mockResolvedValue(null);

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
    });

    expect(check.id).toBe("agentAvailable");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("No AI agent is available");
  });

  test("an agent that exists but is not alive: not ready, and names it", async () => {
    jest
      .spyOn(AIAgentService, "getAIAgentForProject")
      .mockResolvedValue({ name: "fix-worker" } as unknown as AIAgent);
    jest.spyOn(AIAgentService, "isAgentAlive").mockReturnValue(false);

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
    });

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("fix-worker");
  });

  test("a live agent is ready and is named", async () => {
    jest
      .spyOn(AIAgentService, "getAIAgentForProject")
      .mockResolvedValue({ name: "fix-worker" } as unknown as AIAgent);
    jest.spyOn(AIAgentService, "isAgentAlive").mockReturnValue(true);

    const check: AIFixReadinessCheck = await CodeFixReadiness.getAgentCheck({
      projectId,
    });

    expect(check.ok).toBe(true);
    expect(check.title).toContain("fix-worker");
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
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(true);

    const check: AIFixReadinessCheck =
      await CodeFixReadiness.getRepositoryConnectedCheck({ projectId });

    expect(check.id).toBe("repositoryConnected");
    expect(check.ok).toBe(true);
  });

  test("no connected repository: not ready, and points at the GitHub App", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
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
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(params.hasRepo);
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(
        params.hasProvider ? fakeProvider({ name: "provider" }) : null,
      );
    jest
      .spyOn(AIAgentService, "getAIAgentForProject")
      .mockResolvedValue({ name: "agent" } as unknown as AIAgent);
    jest
      .spyOn(AIAgentService, "isAgentAlive")
      .mockReturnValue(params.agentAlive);
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
