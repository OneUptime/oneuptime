import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import RunbookAgentService from "../../../../../Server/Services/RunbookAgentService";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import RunbookAgent from "../../../../../Models/DatabaseModels/RunbookAgent";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * CodeFixAgentAuth resolves the aiAgentId/aiAgentKey pair carried by every
 * code-fix protocol request. It checks the AIAgent registry first, then falls
 * back to the RunbookAgent registry (the unified OneUptime Runner) — but the
 * Runner path only authenticates when canRunCodeFixTasks === true. These
 * tests lock in that server-side capability enforcement plus the
 * project-scoping rules of deniesAccessToProject.
 */

type AIAgentFindSpy = jest.SpiedFunction<typeof AIAgentService.findOneBy>;
type RunnerFindSpy = jest.SpiedFunction<typeof RunbookAgentService.findOneBy>;

const agentId: ObjectID = ObjectID.generate();
const agentKey: string = "secret-agent-key";
const projectId: ObjectID = ObjectID.generate();

function mockAIAgentLookup(result: AIAgent | null): AIAgentFindSpy {
  return jest.spyOn(AIAgentService, "findOneBy").mockResolvedValue(result);
}

function mockRunnerLookup(result: RunbookAgent | null): RunnerFindSpy {
  return jest.spyOn(RunbookAgentService, "findOneBy").mockResolvedValue(result);
}

function fakeAIAgent(): AIAgent {
  return {
    id: agentId,
    projectId: projectId,
  } as unknown as AIAgent;
}

function fakeRunner(
  overrides: { canRunCodeFixTasks?: boolean | undefined } = {},
): RunbookAgent {
  return {
    id: agentId,
    projectId: projectId,
    canRunCodeFixTasks: true,
    ...overrides,
  } as unknown as RunbookAgent;
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

  test("an AIAgent match wins: returns AIAgent source and never queries RunbookAgentService", async () => {
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

  test("falls back to a Runner with canRunCodeFixTasks true and selects the capability column", async () => {
    mockAIAgentLookup(null);
    const runnerSpy: RunnerFindSpy = mockRunnerLookup(fakeRunner());

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
        select: expect.objectContaining({
          canRunCodeFixTasks: true,
        }),
        props: { isRoot: true },
      }),
    );
  });

  test("SERVER-SIDE CAPABILITY ENFORCEMENT: a Runner with canRunCodeFixTasks false is rejected", async () => {
    mockAIAgentLookup(null);
    mockRunnerLookup(fakeRunner({ canRunCodeFixTasks: false }));

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
  });

  test("SERVER-SIDE CAPABILITY ENFORCEMENT: a Runner with canRunCodeFixTasks undefined is rejected", async () => {
    mockAIAgentLookup(null);
    mockRunnerLookup(fakeRunner({ canRunCodeFixTasks: undefined }));

    const identity: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity({
        aiAgentId: agentId.toString(),
        aiAgentKey: agentKey,
      });

    expect(identity).toBeNull();
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
    expect(CodeFixAgentAuth.deniesAccessToProject(globalIdentity, undefined)).toBe(
      false,
    );
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
