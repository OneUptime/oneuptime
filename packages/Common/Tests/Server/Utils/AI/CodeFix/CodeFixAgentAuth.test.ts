import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import CodeRepositoryRunnerChoice from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { CodeWorkerKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * CodeFixAgentAuth resolves the aiAgentId/aiAgentKey pair carried by every
 * code-fix protocol request. It checks the AIAgent registry first, then falls
 * back to the Runner registry (the unified OneUptime Runner) — but the
 * Runner path only authenticates while a code repository of the Runner's
 * project picks it (its Runner setting in Code): a Runner has no "Runs AI
 * Code Fixes" switch any more. These tests lock in that server-side
 * enforcement plus the project-scoping rules of deniesAccessToProject.
 */

type AIAgentFindSpy = jest.SpiedFunction<typeof AIAgentService.findOneBy>;
type RunnerFindSpy = jest.SpiedFunction<typeof RunnerService.findOneBy>;

const agentId: ObjectID = ObjectID.generate();
const agentKey: string = "secret-agent-key";
const projectId: ObjectID = ObjectID.generate();

function mockAIAgentLookup(result: AIAgent | null): AIAgentFindSpy {
  return jest.spyOn(AIAgentService, "findOneBy").mockResolvedValue(result);
}

function mockRunnerLookup(result: Runner | null): RunnerFindSpy {
  return jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(result);
}

// Whether a code repository of the Runner's project picks it.
function mockPicked(isPicked: boolean): jest.SpyInstance {
  return jest
    .spyOn(CodeRepositoryRunnerChoice, "doesRunnerWorkInARepository")
    .mockResolvedValue(isPicked);
}

function fakeAIAgent(): AIAgent {
  return {
    id: agentId,
    projectId: projectId,
  } as unknown as AIAgent;
}

function fakeRunner(
  overrides: {
    name?: string | undefined;
    hostInfo?: unknown;
  } = {},
): Runner {
  return {
    id: agentId,
    projectId: projectId,
    ...overrides,
  } as unknown as Runner;
}

describe("CodeFixAgentAuth.resolveAgentIdentity", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns null when aiAgentId is missing without querying either registry", async () => {
    const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(null);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
    expect(aiAgentSpy).not.toHaveBeenCalled();
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  test("returns null when aiAgentKey is missing without querying either registry", async () => {
    const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(null);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
      });

    expect(identity).toBeNull();
    expect(aiAgentSpy).not.toHaveBeenCalled();
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  test("returns null for a malformed aiAgentId and does not throw", async () => {
    mockAIAgentLookup(null);
    mockRunnerLookup(null);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: "definitely-not-an-object-id",
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
  });

  test("an AIAgent match wins: returns AIAgent source and never queries RunnerService", async () => {
    const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(fakeAIAgent());
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).not.toBeNull();
    expect(identity!.source).toBe(CodeFixAgentSource.AIAgent);
    expect(identity!.id.toString()).toBe(agentId.toString());
    expect(identity!.projectId!.toString()).toBe(projectId.toString());

    expect(aiAgentSpy).toHaveBeenCalledTimes(1);
    expect(aiAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: agentId.toString(),
          key: agentKey,
        },
        props: { isRoot: true },
      }),
    );
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  test("falls back to a Runner a code repository picks", async () => {
    mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());
    const picked: jest.SpyInstance = mockPicked(true);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).not.toBeNull();
    expect(identity!.source).toBe(CodeFixAgentSource.Runner);
    expect(identity!.id.toString()).toBe(agentId.toString());
    expect(identity!.projectId!.toString()).toBe(projectId.toString());

    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: agentId.toString(),
          key: agentKey,
        },
        props: { isRoot: true },
      }),
    );
    // Asked of the Runner row found by its id and key, with its project.
    expect(picked).toHaveBeenCalledWith(
      expect.objectContaining({ id: agentId, projectId: projectId }),
    );
  });

  test("SERVER-SIDE ENFORCEMENT: a Runner no code repository picks is rejected", async () => {
    mockAIAgentLookup(null);
    mockRunnerLookup(fakeRunner());
    mockPicked(false);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
  });

  test("the pick is read from the Runner's own project's repositories, as OneUptime", async () => {
    mockAIAgentLookup(null);
    mockRunnerLookup(fakeRunner());
    const count: jest.SpyInstance = jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity?.source).toBe(CodeFixAgentSource.Runner);
    expect(count).toHaveBeenCalledWith({
      query: { projectId: projectId, runnerId: agentId },
      props: { isRoot: true },
    });
  });

  test("the capability is no column of the Runner: the lookup never selects one", async () => {
    mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());
    mockPicked(true);

    await CodeFixAgentAuth.resolveAgentIdentity({
      aiAgentId: agentId.toString(),
      aiAgentKey: agentKey,
    });

    const select: Record<string, unknown> = (
      runnerSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(Object.keys(select)).not.toContain("canRunCodeFixTasks");
  });

  /*
   * A kubernetes-agent Runner row is minted and re-keyed with the project's
   * telemetry ingestion key. CodeRepositoryService refuses to let a
   * repository pick one, but a row picked before it became an agent row
   * stays picked, so the protocol must refuse the identity itself:
   * otherwise anyone holding the ingestion key could claim code-fix work
   * and mint repository tokens. "Agent row" is RunnerService's one rule
   * (name marker OR agent posture).
   */
  describe("a kubernetes-agent Runner row never authenticates", () => {
    const agentRows: Array<{
      label: string;
      name?: string | undefined;
      hostInfo?: unknown;
    }> = [
      { label: "by the name marker", name: "kubernetes-agent/prod" },
      {
        label: "by the name marker in another case, padded",
        name: "  Kubernetes-Agent/prod ",
      },
      {
        label: "by a shortened agent name",
        name: "kubernetes-agent/a-very-long-cluster-name-1a2b3c4d",
      },
      {
        label: "by an agent posture alone (renamed before the guard)",
        name: "build-runner",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod" },
        },
      },
      {
        label: "by the name marker with a posture that dropped out",
        name: "kubernetes-agent/prod",
        hostInfo: { os: "linux" },
      },
    ];

    test.each(agentRows)(
      "refuses an agent row $label even when a code repository picks it and the key matches",
      async (row: {
        label: string;
        name?: string | undefined;
        hostInfo?: unknown;
      }) => {
        mockAIAgentLookup(null);
        mockRunnerLookup(
          fakeRunner({
            name: row.name,
            hostInfo: row.hostInfo,
          }),
        );
        const picked: jest.SpyInstance = mockPicked(true);

        const identity: CodeFixAgentIdentity | null =
          await CodeFixAgentAuth.resolveAgentIdentity({
            aiAgentId: agentId.toString(),
            aiAgentKey: agentKey,
          });

        expect(identity).toBeNull();
        // Refused on the row alone, before any repository is read.
        expect(picked).not.toHaveBeenCalled();
      },
    );

    const ordinaryRows: Array<{
      label: string;
      name?: string | undefined;
      hostInfo?: unknown;
    }> = [
      { label: "with an ordinary name", name: "build-runner" },
      {
        label: "whose name only mentions the prefix mid-string",
        name: "my-kubernetes-agent/prod",
      },
      {
        label: "living in a pod without a cluster identity",
        name: "pod-runner",
        hostInfo: { kubernetes: { inCluster: true } },
      },
      {
        label: "that names a cluster but is not in-cluster",
        name: "laptop-runner",
        hostInfo: {
          kubernetes: { inCluster: false, clusterIdentifier: "prod" },
        },
      },
      { label: "with no name or host info selected" },
    ];

    test.each(ordinaryRows)(
      "negative control: an ordinary Runner $label still resolves",
      async (row: {
        label: string;
        name?: string | undefined;
        hostInfo?: unknown;
      }) => {
        mockAIAgentLookup(null);
        mockRunnerLookup(
          fakeRunner({
            name: row.name,
            hostInfo: row.hostInfo,
          }),
        );
        mockPicked(true);

        const identity: CodeFixAgentIdentity | null =
          await CodeFixAgentAuth.resolveAgentIdentity({
            aiAgentId: agentId.toString(),
            aiAgentKey: agentKey,
          });

        expect(identity).not.toBeNull();
        expect(identity!.source).toBe(CodeFixAgentSource.Runner);
        expect(identity!.id.toString()).toBe(agentId.toString());
      },
    );

    test("selects the columns the agent-row rule reads", async () => {
      mockAIAgentLookup(null);
      const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());
      mockPicked(true);

      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

      expect(runnerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            projectId: true,
            name: true,
            hostInfo: true,
          }),
        }),
      );
    });

    test("an AIAgent-registry match is unaffected by the Runner rule", async () => {
      mockAIAgentLookup(fakeAIAgent());
      const runnerSpy: RunnerFindSpy = mockRunnerLookup(
        fakeRunner({ name: "kubernetes-agent/prod" }),
      );

      const identity: CodeFixAgentIdentity | null =
        await CodeFixAgentAuth.resolveAgentIdentity({
          aiAgentId: agentId.toString(),
          aiAgentKey: agentKey,
        });

      expect(identity?.source).toBe(CodeFixAgentSource.AIAgent);
      expect(runnerSpy).not.toHaveBeenCalled();
    });
  });

  test("returns null when neither registry matches", async () => {
    const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(null);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
    expect(aiAgentSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledTimes(1);
  });
});

describe("CodeFixAgentAuth.getCodeWorker", () => {
  test("a Runner row is one of its project's Runners", () => {
    expect(
      CodeFixAgentAuth.getCodeWorker({
        id: agentId,
        projectId: projectId,
        source: CodeFixAgentSource.Runner,
      }),
    ).toEqual({ kind: CodeWorkerKind.ProjectRunner, id: agentId });
  });

  test("an AI agent with no project is a global Runner for code", () => {
    expect(
      CodeFixAgentAuth.getCodeWorker({
        id: agentId,
        source: CodeFixAgentSource.AIAgent,
      }),
    ).toEqual({ kind: CodeWorkerKind.GlobalRunner, id: agentId });
  });

  test("an AI agent of a project is that project's own, from before Runners", () => {
    expect(
      CodeFixAgentAuth.getCodeWorker({
        id: agentId,
        projectId: projectId,
        source: CodeFixAgentSource.AIAgent,
      }),
    ).toEqual({ kind: CodeWorkerKind.ProjectAgent, id: agentId });
  });
});

describe("CodeFixAgentAuth.deniesAccessToProject", () => {
  function identityWithProject(
    identityProjectId: ObjectID | undefined,
  ): CodeFixAgentIdentity {
    return {
      id: agentId,
      projectId: identityProjectId,
      source: CodeFixAgentSource.AIAgent,
    };
  }

  test("a global identity (no projectId) never denies", () => {
    const globalIdentity: CodeFixAgentIdentity = identityWithProject(undefined);

    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        globalIdentity,
        ObjectID.generate(),
      ),
    ).toBe(false);
    expect(
      CodeFixAgentAuth.deniesAccessToProject(globalIdentity, undefined),
    ).toBe(false);
  });

  test("a project-scoped identity denies a different projectId", () => {
    const identity: CodeFixAgentIdentity = identityWithProject(projectId);

    expect(
      CodeFixAgentAuth.deniesAccessToProject(identity, ObjectID.generate()),
    ).toBe(true);
  });

  test("a project-scoped identity allows an equal projectId compared by value, not instance", () => {
    const identity: CodeFixAgentIdentity = identityWithProject(
      new ObjectID(projectId.toString()),
    );
    const sameValueDifferentInstance: ObjectID = new ObjectID(
      projectId.toString(),
    );

    expect(identity.projectId).not.toBe(sameValueDifferentInstance);
    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        identity,
        sameValueDifferentInstance,
      ),
    ).toBe(false);
  });

  test("a project-scoped identity denies when the resource projectId is undefined", () => {
    const identity: CodeFixAgentIdentity = identityWithProject(projectId);

    expect(CodeFixAgentAuth.deniesAccessToProject(identity, undefined)).toBe(
      true,
    );
  });
});

describe("CodeFixAgentAuth.resolveAgentIdentity refuses a shipped agent key", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The in-cluster fleet's global agent registers with ONEUPTIME_RUNNER_KEY,
   * which config.example.env ships as a placeholder. A key the repository
   * ships never authenticates an agent on any code-fix route: it is refused
   * before either registry is read.
   */
  test.each([
    ["the old fallback", "secret"],
    ["the bare placeholder", "please-change-this-to-random-value"],
    ["a partially edited placeholder", "please-change-this-to-random-value-2"],
    ["a blank key", "   "],
  ])(
    "returns null for %s, querying neither registry",
    async (_label: string, shippedKey: string) => {
      const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(fakeAIAgent());
      const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());

      const identity: CodeFixAgentIdentity | null =
        await CodeFixAgentAuth.resolveAgentIdentity({
          aiAgentId: agentId.toString(),
          aiAgentKey: shippedKey,
        });

      expect(identity).toBeNull();
      expect(aiAgentSpy).not.toHaveBeenCalled();
      expect(runnerSpy).not.toHaveBeenCalled();
    },
  );

  test("a real random key still reaches the registries", async () => {
    const aiAgentSpy: AIAgentFindSpy = mockAIAgentLookup(fakeAIAgent());
    mockRunnerLookup(null);

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: ObjectID.generate().toString(),
      });

    expect(identity).not.toBeNull();
    expect(identity!.source).toBe(CodeFixAgentSource.AIAgent);
    expect(aiAgentSpy).toHaveBeenCalledTimes(1);
  });
});
