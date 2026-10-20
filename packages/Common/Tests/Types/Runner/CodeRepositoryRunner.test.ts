import ObjectID from "../../../Types/ObjectID";
import {
  CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL,
  CodeRepositoryRunnerChoiceKind,
  CodeRepositoryRunnerDecision,
  CodeWorker,
  CodeWorkerKind,
  decideCodeRepositoryRunner,
  getRepositoryRunnerId,
  mayWorkInCodeRepository,
} from "../../../Types/Runner/CodeRepositoryRunner";
import { describe, expect, test } from "@jest/globals";

/*
 * The repository's one rule: where AI works in a code repository.
 *
 *   - a repository that picked one of its project's Runners works on it,
 *     and only on it - whatever the project's switch says;
 *   - one that picked none works on a global Runner while its project uses
 *     global Runners, and needs one of the project's own otherwise;
 *   - an AI agent of the project's own (from before Runners) serves the
 *     repositories that picked none either way, and never one that picked a
 *     Runner.
 */

const RUNNER_ID: string = "0a1b2c3d-1111-4222-8333-944455556666";
const OTHER_RUNNER_ID: string = "0a1b2c3d-3333-4222-8333-944455556666";
const AGENT_ID: string = "0a1b2c3d-2222-4222-8333-944455556666";

const CUSTOM: CodeRepositoryRunnerDecision = {
  kind: CodeRepositoryRunnerChoiceKind.Custom,
  runnerId: RUNNER_ID,
};
const GLOBAL: CodeRepositoryRunnerDecision = {
  kind: CodeRepositoryRunnerChoiceKind.Global,
};
const NO_RUNNER: CodeRepositoryRunnerDecision = {
  kind: CodeRepositoryRunnerChoiceKind.NoRunner,
};

function worker(kind: CodeWorkerKind, id: string): CodeWorker {
  return { kind, id };
}

describe("getRepositoryRunnerId", () => {
  test("reads an ObjectID, a string and nothing alike: trimmed and lower-cased", () => {
    expect(getRepositoryRunnerId(new ObjectID(RUNNER_ID.toUpperCase()))).toBe(
      RUNNER_ID,
    );
    expect(getRepositoryRunnerId(`  ${RUNNER_ID.toUpperCase()}  `)).toBe(
      RUNNER_ID,
    );
    expect(getRepositoryRunnerId("")).toBe("");
    expect(getRepositoryRunnerId("   ")).toBe("");
    expect(getRepositoryRunnerId(null)).toBe("");
    expect(getRepositoryRunnerId(undefined)).toBe("");
    expect(getRepositoryRunnerId(42)).toBe("");
    expect(getRepositoryRunnerId({ _id: RUNNER_ID })).toBe("");
  });
});

describe("decideCodeRepositoryRunner", () => {
  test("a repository that picked a Runner works on it, whatever the project's switch says", () => {
    for (const projectUsesGlobalRunners of [true, false]) {
      expect(
        decideCodeRepositoryRunner({
          repositoryRunnerId: new ObjectID(RUNNER_ID),
          projectUsesGlobalRunners,
        }),
      ).toEqual(CUSTOM);
      expect(
        decideCodeRepositoryRunner({
          repositoryRunnerId: RUNNER_ID.toUpperCase(),
          projectUsesGlobalRunners,
        }),
      ).toEqual(CUSTOM);
    }
  });

  test("one that picked none works on a global Runner while its project uses them", () => {
    for (const none of [null, undefined, "", "  "]) {
      expect(
        decideCodeRepositoryRunner({
          repositoryRunnerId: none,
          projectUsesGlobalRunners: true,
        }),
      ).toEqual(GLOBAL);
    }
  });

  test("one that picked none in a project that turned global Runners off has no Runner", () => {
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        projectUsesGlobalRunners: false,
      }),
    ).toEqual(NO_RUNNER);
  });
});

describe("mayWorkInCodeRepository", () => {
  test("a repository's own pick: that Runner, and nothing else", () => {
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectRunner, RUNNER_ID),
        decision: CUSTOM,
      }),
    ).toBe(true);
    // The id is compared as Postgres renders a uuid.
    expect(
      mayWorkInCodeRepository({
        worker: {
          kind: CodeWorkerKind.ProjectRunner,
          id: new ObjectID(RUNNER_ID.toUpperCase()),
        },
        decision: CUSTOM,
      }),
    ).toBe(true);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectRunner, OTHER_RUNNER_ID),
        decision: CUSTOM,
      }),
    ).toBe(false);
    // A global Runner or an agent never works where a Runner was picked.
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.GlobalRunner, AGENT_ID),
        decision: CUSTOM,
      }),
    ).toBe(false);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectAgent, AGENT_ID),
        decision: CUSTOM,
      }),
    ).toBe(false);
    // Not even an agent that happens to carry the picked Runner's id.
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.GlobalRunner, RUNNER_ID),
        decision: CUSTOM,
      }),
    ).toBe(false);
  });

  test("a worker with no id never matches a pick", () => {
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectRunner, ""),
        decision: { kind: CodeRepositoryRunnerChoiceKind.Custom, runnerId: "" },
      }),
    ).toBe(false);
  });

  test("no pick, global Runners in use: a global Runner or the project's own agent; never a project's Runner", () => {
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.GlobalRunner, AGENT_ID),
        decision: GLOBAL,
      }),
    ).toBe(true);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectAgent, AGENT_ID),
        decision: GLOBAL,
      }),
    ).toBe(true);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectRunner, RUNNER_ID),
        decision: GLOBAL,
      }),
    ).toBe(false);
  });

  test("no pick, global Runners off: only the project's own agent", () => {
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectAgent, AGENT_ID),
        decision: NO_RUNNER,
      }),
    ).toBe(true);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.GlobalRunner, AGENT_ID),
        decision: NO_RUNNER,
      }),
    ).toBe(false);
    expect(
      mayWorkInCodeRepository({
        worker: worker(CodeWorkerKind.ProjectRunner, RUNNER_ID),
        decision: NO_RUNNER,
      }),
    ).toBe(false);
  });

  test("every worker against every decision, in one table", () => {
    const table: Array<
      [CodeWorkerKind, CodeRepositoryRunnerDecision, boolean]
    > = [
      [CodeWorkerKind.ProjectRunner, CUSTOM, true],
      [CodeWorkerKind.ProjectRunner, GLOBAL, false],
      [CodeWorkerKind.ProjectRunner, NO_RUNNER, false],
      [CodeWorkerKind.GlobalRunner, CUSTOM, false],
      [CodeWorkerKind.GlobalRunner, GLOBAL, true],
      [CodeWorkerKind.GlobalRunner, NO_RUNNER, false],
      [CodeWorkerKind.ProjectAgent, CUSTOM, false],
      [CodeWorkerKind.ProjectAgent, GLOBAL, true],
      [CodeWorkerKind.ProjectAgent, NO_RUNNER, true],
    ];

    for (const [kind, decision, expected] of table) {
      expect({
        kind,
        decision: decision.kind,
        may: mayWorkInCodeRepository({
          worker: worker(
            kind,
            kind === CodeWorkerKind.ProjectRunner ? RUNNER_ID : AGENT_ID,
          ),
          decision,
        }),
      }).toEqual({ kind, decision: decision.kind, may: expected });
    }
  });
});

describe("the token refusal", () => {
  test("says where the work goes and what to do, without naming another Runner", () => {
    expect(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL).toContain(
      "the Runner its settings in Code pick",
    );
    expect(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL).toContain(
      "Start the task again",
    );
    expect(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL).not.toContain(RUNNER_ID);
  });
});
