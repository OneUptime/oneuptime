import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
  CodeFixCredentialCheck,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import CodeRepositoryRunnerChoice from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import { getKubernetesAgentRunnerName } from "../../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CodeWorkerKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO A CODE-FIX PAIR PROVES IT IS, NOW THAT GLOBAL RUNNERS DO CODE FIXES.
 *
 * Every code-fix route reads the aiAgentId/aiAgentKey pair through
 * CodeFixAgentAuth.checkCredential, and what it proves decides the work it
 * may claim and the repositories it may be handed a token for
 * (getCodeWorker, deniesAccessToProject):
 *
 *   - a global Runner - a Runner row OneUptime runs for every project, with
 *     no project of its own - is a global Runner for code: it serves every
 *     project, by each repository's Runner choice;
 *   - a project's Runner a repository works on is that project's, and only
 *     that project's;
 *   - an AI agent a project created before Runners is that project's own;
 *   - the agent the shared Runner registered as, before global Runners took
 *     its work, has no project and proves nothing, though its key is right;
 *   - a row in a state the server never writes (global with a project, a
 *     Runner with neither) is never served as global.
 *
 * The two registries are stood in for, row by row.
 */

const PROJECT_ID: string = "6a7b8c9d-1111-4222-8333-944455556666";
const OTHER_PROJECT_ID: string = "6a7b8c9d-2222-4222-8333-944455556666";

interface Row {
  table: "AIAgent" | "Runner";
  key: string;
  projectId?: string | undefined;
  isGlobalRunner?: boolean | undefined;
  name?: string | undefined;
  // Whether a code repository of its project works on the Runner.
  worksInARepository?: boolean | undefined;
}

let registry: Map<string, Row>;

function standInFor(table: "AIAgent" | "Runner") {
  return async (findBy: unknown): Promise<unknown> => {
    const query: JSONObject = (findBy as { query: JSONObject }).query;
    const row: Row | undefined = registry.get(
      String(query["_id"]).toLowerCase(),
    );

    if (!row || row.table !== table) {
      return null;
    }

    if ("key" in query && query["key"] !== row.key) {
      return null;
    }

    return {
      id: new ObjectID(String(query["_id"])),
      _id: String(query["_id"]),
      projectId: row.projectId ? new ObjectID(row.projectId) : undefined,
      isGlobalRunner: row.isGlobalRunner === true,
      name: row.name || "a Runner",
    };
  };
}

function add(row: Row): { id: string; pair: JSONObject } {
  const id: string = ObjectID.generate().toString().toLowerCase();
  registry.set(id, row);
  return { id, pair: { aiAgentId: id, aiAgentKey: row.key } };
}

beforeEach(() => {
  registry = new Map<string, Row>();

  jest
    .spyOn(AIAgentService, "findOneBy")
    .mockImplementation(standInFor("AIAgent") as never);
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockImplementation(standInFor("Runner") as never);
  jest
    .spyOn(CodeRepositoryRunnerChoice, "doesRunnerWorkInARepository")
    .mockImplementation(
      async (runner: {
        id?: ObjectID | null | undefined;
        projectId?: ObjectID | null | undefined;
      }): Promise<boolean> => {
        // The real rule: a Runner with no project works in no repository.
        if (!runner.projectId) {
          return false;
        }

        return (
          registry.get(runner.id?.toString().toLowerCase() || "")
            ?.worksInARepository === true
        );
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a global Runner", () => {
  test("proves a global Runner for code: a Runner with no project, serving every project", async () => {
    const { id, pair } = add({
      table: "Runner",
      key: "global-runner-key-a1b2c3d4e5f6a7b8c9d0",
      isGlobalRunner: true,
    });

    const check: CodeFixCredentialCheck =
      await CodeFixAgentAuth.checkCredential(pair);
    const identity: CodeFixAgentIdentity = check.identity!;

    expect(check.isKeyRight).toBe(true);
    expect(identity.id.toString()).toBe(id);
    expect(identity.source).toBe(CodeFixAgentSource.Runner);
    expect(identity.projectId).toBeUndefined();
    expect(CodeFixAgentAuth.getCodeWorker(identity)).toEqual({
      kind: CodeWorkerKind.GlobalRunner,
      id: identity.id,
    });

    for (const project of [PROJECT_ID, OTHER_PROJECT_ID]) {
      expect(
        CodeFixAgentAuth.deniesAccessToProject(
          identity,
          new ObjectID(project),
        ),
      ).toBe(false);
    }
  });

  test("needs no repository to name it, and none is asked about", async () => {
    const { pair } = add({
      table: "Runner",
      key: "global-runner-key-0f9e8d7c6b5a4f3e2d1c",
      isGlobalRunner: true,
    });

    expect(
      (await CodeFixAgentAuth.checkCredential(pair)).identity,
    ).not.toBeNull();
    expect(
      CodeRepositoryRunnerChoice.doesRunnerWorkInARepository,
    ).not.toHaveBeenCalled();
  });

  test("a wrong key proves nothing", async () => {
    const { pair } = add({
      table: "Runner",
      key: "global-runner-key-1a2b3c4d5e6f7a8b9c0d",
      isGlobalRunner: true,
    });

    expect(
      await CodeFixAgentAuth.checkCredential({
        ...pair,
        aiAgentKey: "a-guess-at-the-global-runner-key",
      }),
    ).toMatchObject({ identity: null, isKeyRight: false });
  });

  test("a row that says it is a Kubernetes agent's is never a code-fix identity, global or not", async () => {
    const { pair } = add({
      table: "Runner",
      key: "agent-runner-key-9f8e7d6c5b4a39281706",
      isGlobalRunner: true,
      name: getKubernetesAgentRunnerName("prod-eu"),
    });

    expect(await CodeFixAgentAuth.checkCredential(pair)).toMatchObject({
      identity: null,
      isKeyRight: true,
    });
  });
});

describe("rows the server never writes are never served as global", () => {
  test("a Runner marked global but holding a project is that project's Runner, and needs a repository like one", async () => {
    const { pair } = add({
      table: "Runner",
      key: "odd-runner-key-5a6b7c8d9e0f1a2b3c4d",
      isGlobalRunner: true,
      projectId: PROJECT_ID,
      worksInARepository: false,
    });

    expect(await CodeFixAgentAuth.checkCredential(pair)).toMatchObject({
      identity: null,
      isKeyRight: true,
    });

    registry.forEach((row: Row) => {
      row.worksInARepository = true;
    });

    const identity: CodeFixAgentIdentity = (
      await CodeFixAgentAuth.checkCredential(pair)
    ).identity!;

    expect(identity.projectId?.toString()).toBe(PROJECT_ID);
    expect(CodeFixAgentAuth.getCodeWorker(identity).kind).toBe(
      CodeWorkerKind.ProjectRunner,
    );
    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        identity,
        new ObjectID(OTHER_PROJECT_ID),
      ),
    ).toBe(true);
  });

  test("a Runner with neither a project nor the global mark proves nothing", async () => {
    const { pair } = add({
      table: "Runner",
      key: "stray-runner-key-6b7c8d9e0f1a2b3c4d5e",
      isGlobalRunner: false,
    });

    expect(await CodeFixAgentAuth.checkCredential(pair)).toMatchObject({
      identity: null,
      isKeyRight: true,
    });
  });
});

describe("AI agents", () => {
  test("the agent the shared Runner registered as proves nothing, though its key is right", async () => {
    const { pair } = add({
      table: "AIAgent",
      key: "former-shared-agent-key-7c8d9e0f1a2b3c",
    });

    expect(await CodeFixAgentAuth.checkCredential(pair)).toMatchObject({
      identity: null,
      isKeyRight: true,
    });
    expect(RunnerService.findOneBy).not.toHaveBeenCalled();
  });

  test("an agent a project created before Runners is that project's own, and only that project's", async () => {
    const { pair } = add({
      table: "AIAgent",
      key: "project-agent-key-8d9e0f1a2b3c4d5e6f7a",
      projectId: PROJECT_ID,
    });

    const identity: CodeFixAgentIdentity = (
      await CodeFixAgentAuth.checkCredential(pair)
    ).identity!;

    expect(identity.source).toBe(CodeFixAgentSource.AIAgent);
    expect(identity.projectId?.toString()).toBe(PROJECT_ID);
    expect(CodeFixAgentAuth.getCodeWorker(identity).kind).toBe(
      CodeWorkerKind.ProjectAgent,
    );
    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        identity,
        new ObjectID(OTHER_PROJECT_ID),
      ),
    ).toBe(true);
  });
});

describe("a project's Runner", () => {
  test("a repository works on it: that project's Runner, and only that project's", async () => {
    const { pair } = add({
      table: "Runner",
      key: "project-runner-key-9e0f1a2b3c4d5e6f7a8b",
      projectId: PROJECT_ID,
      worksInARepository: true,
    });

    const identity: CodeFixAgentIdentity = (
      await CodeFixAgentAuth.checkCredential(pair)
    ).identity!;

    expect(identity.source).toBe(CodeFixAgentSource.Runner);
    expect(CodeFixAgentAuth.getCodeWorker(identity).kind).toBe(
      CodeWorkerKind.ProjectRunner,
    );
    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        identity,
        new ObjectID(PROJECT_ID),
      ),
    ).toBe(false);
    expect(
      CodeFixAgentAuth.deniesAccessToProject(
        identity,
        new ObjectID(OTHER_PROJECT_ID),
      ),
    ).toBe(true);
  });
});
