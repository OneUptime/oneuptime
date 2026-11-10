import AIRunService, {
  AIRunTransitionSet,
} from "../../../Server/Services/AIRunService";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { CodeTaskOutcome } from "../../../Types/AI/CodeTask";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A run's status transition holds each value to what its column takes.
 *
 * attemptStatusTransition is one raw UPDATE, which skips the checks a
 * service write makes, and its callers pass on what others said: a Runner's
 * report of a git failure (update-task-status), an LLM provider's error, a
 * remediation's. AIRun.errorMessage is varchar(500), and those are often
 * longer. Postgres then refused the whole UPDATE - "value too long for type
 * character varying(500)" - so the run was never closed: it sat Running
 * until the stale-run sweeper failed it without saying why (issue #6144).
 * Every raw write path holds its values to their columns
 * (truncateStringColumnsToMaxLength); this one now does too.
 */

interface RecordedUpdate {
  set: Record<string, unknown> | null;
}

function mockUpdateQueryBuilder(): RecordedUpdate {
  const recorded: RecordedUpdate = { set: null };

  const builder: Record<string, unknown> = {
    update: () => {
      return builder;
    },
    set: (values: Record<string, unknown>) => {
      recorded.set = values;
      return builder;
    },
    where: () => {
      return builder;
    },
    andWhere: () => {
      return builder;
    },
    execute: async () => {
      return { affected: 1 };
    },
  };

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    createQueryBuilder: () => {
      return builder;
    },
  } as never);

  return recorded;
}

// What the Runner reported for the run in issue #6144, give or take.
const GIT_FAILURE: string = `Command failed: git -c http.followRedirects=false -c http.curloptResolve=tfs.example.com:443:10.20.30.40 clone --single-branch --branch main -- https://deploy@tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter /tmp/oneuptime-ai-agent/task-1793957521407-0cb53341-6e6e-47e9-9758-651b60a8ee11-d20e88de/DefaultCollection-ScriptVault-_git__InstantAccessReporter\nCloning into '/tmp/oneuptime-ai-agent/task-1793957521407-0cb53341-6e6e-47e9-9758-651b60a8ee11-d20e88de/DefaultCollection-ScriptVault-_git__InstantAccessReporter'...\nfatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'`;

describe("AIRunService.attemptStatusTransition - what it writes fits its columns", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the git failure the run was closed with is longer than its column", () => {
    expect(GIT_FAILURE.length).toBeGreaterThan(ColumnLength.LongText);
  });

  test("an error message longer than its column is cut to it, and the run is still closed", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder();

    const changed: number = await AIRunService.attemptStatusTransition({
      aiRunId: ObjectID.generate(),
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        errorMessage: GIT_FAILURE,
      },
    });

    expect(changed).toBe(1);
    expect(recorded.set!["status"]).toBe(AIRunStatus.Error);
    expect((recorded.set!["errorMessage"] as string).length).toBe(
      ColumnLength.LongText,
    );
    expect(
      GIT_FAILURE.startsWith(recorded.set!["errorMessage"] as string),
    ).toBe(true);
  });

  test("a message that fits is written as it is", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder();
    const message: string =
      "tfs.example.com refused the credentials OneUptime signed in with, so DefaultCollection/ScriptVault/_git/InstantAccessReporter could not be cloned.";

    await AIRunService.attemptStatusTransition({
      aiRunId: ObjectID.generate(),
      fromStatus: AIRunStatus.Running,
      set: { status: AIRunStatus.Error, errorMessage: message },
    });

    expect(recorded.set!["errorMessage"]).toBe(message);
  });

  test("a message of exactly the column's length is not cut", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder();
    const message: string = "x".repeat(ColumnLength.LongText);

    await AIRunService.attemptStatusTransition({
      aiRunId: ObjectID.generate(),
      fromStatus: AIRunStatus.Running,
      set: { status: AIRunStatus.Error, errorMessage: message },
    });

    expect(recorded.set!["errorMessage"]).toBe(message);
  });

  test("the caller's values are not changed, and nothing else in the transition is touched", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder();
    const completedAt: Date = new Date();
    const outcome: CodeTaskOutcome = {
      summary: "x".repeat(5000),
    } as unknown as CodeTaskOutcome;
    const set: AIRunTransitionSet = {
      status: AIRunStatus.Error,
      completedAt,
      errorMessage: GIT_FAILURE,
      aiAgentId: ObjectID.generate().toString(),
      totalTokens: 1234,
      needsUserInput: false,
      taskOutcome: outcome,
    };

    await AIRunService.attemptStatusTransition({
      aiRunId: ObjectID.generate(),
      fromStatus: AIRunStatus.Running,
      set,
    });

    // The caller's own object keeps what it said.
    expect(set.errorMessage).toBe(GIT_FAILURE);

    expect(recorded.set!["completedAt"]).toBe(completedAt);
    expect(recorded.set!["aiAgentId"]).toBe(set.aiAgentId);
    expect(recorded.set!["totalTokens"]).toBe(1234);
    expect(recorded.set!["needsUserInput"]).toBe(false);
    // A jsonb column has no length: its object is written whole.
    expect(recorded.set!["taskOutcome"]).toBe(outcome);
  });

  test("a transition without a message gets none", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder();

    await AIRunService.attemptStatusTransition({
      aiRunId: ObjectID.generate(),
      fromStatus: AIRunStatus.Queued,
      set: { status: AIRunStatus.Running, attemptCount: 1 },
    });

    expect(Object.keys(recorded.set!).sort()).toEqual(
      ["attemptCount", "status"].sort(),
    );
  });
});
