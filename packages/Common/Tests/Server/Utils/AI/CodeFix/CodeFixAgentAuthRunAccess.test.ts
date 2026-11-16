import CodeFixAgentAuth, {
  CODE_FIX_RUN_HOLD_SELECT,
  CodeFixAgentIdentity,
  CodeFixAgentSource,
  CodeFixRunAccess,
  CodeFixRunHoldFacts,
  CodeRepositoryCommands,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { LLMToolDefinition } from "../../../../../Server/Utils/LLM/LLMService";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../../Types/ObjectID";
import { CODE_AGENT_COMMAND_TOOL_NAME } from "../../../../../Types/Runner/GlobalRunnerWork";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A CODE-FIX IDENTITY MAY DO WITH A RUN, NOW THAT GLOBAL RUNNERS DO
 * CODE FIXES.
 *
 * A global Runner's key is held on a host that runs every project's
 * JavaScript steps, or on one a master admin started, and it serves every
 * project. Every code-fix route used to let a global identity through the
 * project check (deniesAccessToProject answers false for it), so its key
 * reached every project's runs, exceptions and repositories at will. The
 * rule now, the one every route asks (deniesAccessToRun):
 *
 *   - every identity - a global Runner, a project's own Runner and an AI
 *     agent a project created before 12.0 - acts only for the run it claimed
 *     (its id on the run, aiAgentId), in a project it may act in: what it is
 *     handed for the work only while the run is Running, what it reports
 *     about the work whatever state the run is in now;
 *   - it is never handed a repository's own commands, nor offered the code
 *     agent's command tool (getRepositoryCommands, getOfferedTools).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a6b7c8d-1111-4222-8333-944455556666",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5a6b7c8d-2222-4222-8333-944455556666",
);
const WORKER_ID: ObjectID = new ObjectID(
  "5a6b7c8d-3333-4222-8333-944455556666",
);
const OTHER_WORKER_ID: ObjectID = new ObjectID(
  "5a6b7c8d-4444-4222-8333-944455556666",
);

const GLOBAL_RUNNER: CodeFixAgentIdentity = {
  id: WORKER_ID,
  source: CodeFixAgentSource.Runner,
};

const PROJECT_RUNNER: CodeFixAgentIdentity = {
  id: WORKER_ID,
  projectId: PROJECT_ID,
  source: CodeFixAgentSource.Runner,
};

const PROJECT_AGENT: CodeFixAgentIdentity = {
  id: WORKER_ID,
  projectId: PROJECT_ID,
  source: CodeFixAgentSource.AIAgent,
};

const EVERY_STATUS: Array<AIRunStatus> = Object.values(AIRunStatus);

function runOf(data: {
  projectId?: ObjectID | undefined;
  claimedBy?: ObjectID | undefined;
  status?: AIRunStatus | undefined;
}): CodeFixRunHoldFacts {
  return {
    ...(data.projectId ? { projectId: data.projectId } : {}),
    ...(data.claimedBy ? { aiAgentId: data.claimedBy } : {}),
    ...(data.status ? { status: data.status } : {}),
  };
}

describe("isGlobalIdentity", () => {
  test("a Runner with no project is global; every identity with a project is not", () => {
    expect(CodeFixAgentAuth.isGlobalIdentity(GLOBAL_RUNNER)).toBe(true);
    expect(CodeFixAgentAuth.isGlobalIdentity(PROJECT_RUNNER)).toBe(false);
    expect(CodeFixAgentAuth.isGlobalIdentity(PROJECT_AGENT)).toBe(false);
  });

  test("an AI agent with no project (one never let through) would count as global, never as every project's agent", () => {
    expect(
      CodeFixAgentAuth.isGlobalIdentity({
        id: WORKER_ID,
        source: CodeFixAgentSource.AIAgent,
      }),
    ).toBe(true);
  });
});

describe("deniesAccessToRun: a global Runner", () => {
  test("works on the run it claimed only while the run is Running", () => {
    for (const status of EVERY_STATUS) {
      expect(
        CodeFixAgentAuth.deniesAccessToRun(
          GLOBAL_RUNNER,
          runOf({ projectId: PROJECT_ID, claimedBy: WORKER_ID, status }),
          CodeFixRunAccess.Work,
        ),
      ).toBe(status !== AIRunStatus.Running);
    }
  });

  test("reports on the run it claimed whatever state it is in now (a retried final report is answered, not refused)", () => {
    for (const status of EVERY_STATUS) {
      expect(
        CodeFixAgentAuth.deniesAccessToRun(
          GLOBAL_RUNNER,
          runOf({ projectId: PROJECT_ID, claimedBy: WORKER_ID, status }),
          CodeFixRunAccess.Report,
        ),
      ).toBe(false);
    }
  });

  test("is refused the run another worker claimed, for work and for reports, in every state", () => {
    for (const access of Object.values(CodeFixRunAccess)) {
      for (const status of EVERY_STATUS) {
        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            GLOBAL_RUNNER,
            runOf({
              projectId: PROJECT_ID,
              claimedBy: OTHER_WORKER_ID,
              status,
            }),
            access,
          ),
        ).toBe(true);
      }
    }
  });

  test("is refused a run nobody claimed - one still waiting in the queue - in every state", () => {
    for (const access of Object.values(CodeFixRunAccess)) {
      for (const status of EVERY_STATUS) {
        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            GLOBAL_RUNNER,
            runOf({ projectId: PROJECT_ID, status }),
            access,
          ),
        ).toBe(true);
      }
    }
  });

  test("is refused a run that belongs to no project, even one with its id on it", () => {
    for (const access of Object.values(CodeFixRunAccess)) {
      expect(
        CodeFixAgentAuth.deniesAccessToRun(
          GLOBAL_RUNNER,
          runOf({ claimedBy: WORKER_ID, status: AIRunStatus.Running }),
          access,
        ),
      ).toBe(true);
    }
  });

  test("a run it holds in any project is its own: the project does not matter, the claim does", () => {
    for (const projectId of [PROJECT_ID, OTHER_PROJECT_ID]) {
      expect(
        CodeFixAgentAuth.deniesAccessToRun(
          GLOBAL_RUNNER,
          runOf({
            projectId,
            claimedBy: WORKER_ID,
            status: AIRunStatus.Running,
          }),
          CodeFixRunAccess.Work,
        ),
      ).toBe(false);
    }
  });
});

describe("deniesAccessToRun: a project's own worker is held to the run it claimed too", () => {
  /*
   * A project's Runner - one a team may run on several hosts with the same
   * key - and an AI agent a project created before 12.0 act for the run they
   * claimed, as a global Runner does: never every run of their project.
   */
  test("works on the run it claimed only while the run is Running", () => {
    for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
      for (const status of EVERY_STATUS) {
        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            identity,
            runOf({ projectId: PROJECT_ID, claimedBy: WORKER_ID, status }),
            CodeFixRunAccess.Work,
          ),
        ).toBe(status !== AIRunStatus.Running);
      }
    }
  });

  test("reports on the run it claimed whatever state it is in now", () => {
    for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
      for (const status of EVERY_STATUS) {
        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            identity,
            runOf({ projectId: PROJECT_ID, claimedBy: WORKER_ID, status }),
            CodeFixRunAccess.Report,
          ),
        ).toBe(false);
      }
    }
  });

  test("is refused the run of its own project another worker claimed, and one nobody claimed, for work and reports, in every state", () => {
    for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
      for (const access of Object.values(CodeFixRunAccess)) {
        for (const status of EVERY_STATUS) {
          for (const claimedBy of [OTHER_WORKER_ID, undefined] as Array<
            ObjectID | undefined
          >) {
            expect(
              CodeFixAgentAuth.deniesAccessToRun(
                identity,
                runOf({ projectId: PROJECT_ID, claimedBy, status }),
                access,
              ),
            ).toBe(true);
          }
        }
      }
    }
  });

  test("never acts for another project's run, nor one with no project, even one it claimed", () => {
    for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
      for (const access of Object.values(CodeFixRunAccess)) {
        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            identity,
            runOf({
              projectId: OTHER_PROJECT_ID,
              claimedBy: WORKER_ID,
              status: AIRunStatus.Running,
            }),
            access,
          ),
        ).toBe(true);

        expect(
          CodeFixAgentAuth.deniesAccessToRun(
            identity,
            runOf({ claimedBy: WORKER_ID, status: AIRunStatus.Running }),
            access,
          ),
        ).toBe(true);
      }
    }
  });

  test("every identity answers by the same rule: a global Runner and a project's own worker are told the same of a run of the project they share", () => {
    for (const access of Object.values(CodeFixRunAccess)) {
      for (const status of EVERY_STATUS) {
        for (const claimedBy of [
          WORKER_ID,
          OTHER_WORKER_ID,
          undefined,
        ] as Array<ObjectID | undefined>) {
          const run: CodeFixRunHoldFacts = runOf({
            projectId: PROJECT_ID,
            claimedBy,
            status,
          });

          const globalAnswer: boolean = CodeFixAgentAuth.deniesAccessToRun(
            GLOBAL_RUNNER,
            run,
            access,
          );

          for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
            expect(
              CodeFixAgentAuth.deniesAccessToRun(identity, run, access),
            ).toBe(globalAnswer);
          }
        }
      }
    }
  });
});

describe("isRunClaimedBy", () => {
  test("a run of a project with the identity's id on it is its claim, whatever its state", () => {
    for (const identity of [GLOBAL_RUNNER, PROJECT_RUNNER, PROJECT_AGENT]) {
      for (const status of EVERY_STATUS) {
        expect(
          CodeFixAgentAuth.isRunClaimedBy(
            identity,
            runOf({ projectId: PROJECT_ID, claimedBy: WORKER_ID, status }),
          ),
        ).toBe(true);
      }
    }
  });

  test("another worker's run, a run nobody claimed and a run of no project are not", () => {
    for (const identity of [GLOBAL_RUNNER, PROJECT_RUNNER, PROJECT_AGENT]) {
      expect(
        CodeFixAgentAuth.isRunClaimedBy(
          identity,
          runOf({ projectId: PROJECT_ID, claimedBy: OTHER_WORKER_ID }),
        ),
      ).toBe(false);
      expect(
        CodeFixAgentAuth.isRunClaimedBy(
          identity,
          runOf({ projectId: PROJECT_ID }),
        ),
      ).toBe(false);
      expect(
        CodeFixAgentAuth.isRunClaimedBy(
          identity,
          runOf({ claimedBy: WORKER_ID }),
        ),
      ).toBe(false);
    }
  });

  test("ids are compared as written, however the run's was spelled", () => {
    expect(
      CodeFixAgentAuth.isRunClaimedBy(PROJECT_RUNNER, {
        projectId: PROJECT_ID,
        aiAgentId: new ObjectID(WORKER_ID.toString()),
      }),
    ).toBe(true);
  });
});

describe("CODE_FIX_RUN_HOLD_SELECT", () => {
  test("reads every column the rule reads: the project, who claimed the run and its state", () => {
    expect(CODE_FIX_RUN_HOLD_SELECT).toEqual({
      _id: true,
      projectId: true,
      aiAgentId: true,
      status: true,
    });
  });
});

describe("getRepositoryCommands", () => {
  const REPOSITORY: {
    setupCommand: string;
    buildCommand: string;
    testCommand: string;
  } = {
    setupCommand: "npm ci",
    buildCommand: "npm run build",
    testCommand: "npm test",
  };

  test("a global Runner is handed none of a repository's commands", () => {
    const commands: CodeRepositoryCommands =
      CodeFixAgentAuth.getRepositoryCommands(GLOBAL_RUNNER, REPOSITORY);

    expect(commands).toEqual({
      setupCommand: null,
      buildCommand: null,
      testCommand: null,
    });
  });

  test("a project's own Runner or agent is handed them as they are set", () => {
    for (const identity of [PROJECT_RUNNER, PROJECT_AGENT]) {
      expect(
        CodeFixAgentAuth.getRepositoryCommands(identity, REPOSITORY),
      ).toEqual(REPOSITORY);
    }
  });

  test("a command that is not set is none, for everyone", () => {
    for (const identity of [GLOBAL_RUNNER, PROJECT_RUNNER]) {
      expect(
        CodeFixAgentAuth.getRepositoryCommands(identity, {
          setupCommand: "",
          buildCommand: null,
          testCommand: undefined,
        }),
      ).toEqual({ setupCommand: null, buildCommand: null, testCommand: null });
    }
  });

  test("hands over exactly the three command keys, never another field of the repository", () => {
    const repositoryWithMore: Record<string, string> = {
      ...REPOSITORY,
      secretToken: "not-a-command",
      name: "users-api",
    };

    expect(
      Object.keys(
        CodeFixAgentAuth.getRepositoryCommands(
          PROJECT_RUNNER,
          repositoryWithMore as never,
        ),
      ).sort(),
    ).toEqual(["buildCommand", "setupCommand", "testCommand"]);
  });
});

describe("getOfferedTools", () => {
  const tool: (name: string) => LLMToolDefinition = (
    name: string,
  ): LLMToolDefinition => {
    return {
      name,
      description: `${name} tool`,
      inputSchema: { type: "object", properties: {} },
    };
  };

  const TOOLS: Array<LLMToolDefinition> = [
    tool("read_file"),
    tool("write_file"),
    tool(CODE_AGENT_COMMAND_TOOL_NAME),
    tool("search_files"),
    tool("query_traces"),
  ];

  test("the code agent's command tool is the Runner's run_command", () => {
    expect(CODE_AGENT_COMMAND_TOOL_NAME).toBe("run_command");
  });

  test("a global Runner's model is never offered the command tool, and keeps every other tool in order", () => {
    const offered: Array<LLMToolDefinition> | undefined =
      CodeFixAgentAuth.getOfferedTools(GLOBAL_RUNNER, TOOLS);

    expect(
      offered!.map((each: LLMToolDefinition): string => {
        return each.name;
      }),
    ).toEqual(["read_file", "write_file", "search_files", "query_traces"]);
  });

  test("a project's own Runner's model is offered every tool it sent, the command tool included", () => {
    expect(CodeFixAgentAuth.getOfferedTools(PROJECT_RUNNER, TOOLS)).toBe(TOOLS);
    expect(CodeFixAgentAuth.getOfferedTools(PROJECT_AGENT, TOOLS)).toBe(TOOLS);
  });

  test("no tools sent is no tools offered, for everyone", () => {
    expect(
      CodeFixAgentAuth.getOfferedTools(GLOBAL_RUNNER, undefined),
    ).toBeUndefined();
    expect(
      CodeFixAgentAuth.getOfferedTools(PROJECT_RUNNER, undefined),
    ).toBeUndefined();
    expect(CodeFixAgentAuth.getOfferedTools(GLOBAL_RUNNER, [])).toEqual([]);
  });

  test("a list that is only the command tool leaves a global Runner with none", () => {
    expect(
      CodeFixAgentAuth.getOfferedTools(GLOBAL_RUNNER, [
        tool(CODE_AGENT_COMMAND_TOOL_NAME),
      ]),
    ).toEqual([]);
  });
});
