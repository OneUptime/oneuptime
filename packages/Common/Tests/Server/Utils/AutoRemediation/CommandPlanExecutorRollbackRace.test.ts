import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import CommandPolicy from "../../../../Utils/AiRemediation/CommandPolicy";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the approved-plan executor and the rollback arm
 * running at the same time, and a rollback resumed after a restart:
 *
 * - verification can fail an Approved plan (it overran its window) while
 *   the executor still waits on a command. The rollback arm WAITS for that
 *   command's job and rolls it back once it succeeds; and the executor's
 *   later writes never erase the rollback arm's record (rollbackExecution,
 *   rollbackStatus) — each arm writes only its own fields of the plan;
 * - the executor starts each command (stand-down check, Pending marker,
 *   enqueue, job id) under the per-plan lock the rollback arm reads the
 *   plan under, so no forward job can slip in unseen;
 * - a plan that finished after verification concluded says so on the feed
 *   instead of "verification is watching";
 * - a resumed rollback settles the undos an interrupted attempt already
 *   handed to a Runner from their jobs — never runs one twice — and runs
 *   the ones that never reached a Runner; with an undo's outcome unknown
 *   the rollback is never reported complete;
 * - the rollback arm stamps a heartbeat, returns what it did, and settles
 *   Failed (with a feed item) on an unexpected error rather than leaving
 *   rollbackStatus unset.
 */

const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const JOB_IDS: Record<string, ObjectID> = {
  "ai-approved-1": new ObjectID("10000000-0000-4000-8000-000000000001"),
  "ai-approved-2": new ObjectID("10000000-0000-4000-8000-000000000002"),
  "ai-rollback-1": new ObjectID("20000000-0000-4000-8000-000000000001"),
  "ai-rollback-2": new ObjectID("20000000-0000-4000-8000-000000000002"),
  "ai-rollback-3": new ObjectID("20000000-0000-4000-8000-000000000003"),
};

function command(
  sequence: number,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sequence,
    stepType: "Bash",
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "prod-runner-1",
    command: `forward-${sequence}`,
    rollbackCommand: `undo-${sequence}`,
    timeoutInMs: 5000,
    rationale: "The service crashed.",
    expectedEffect: "The service restarts.",
    policyVerdict: "RequiresApproval",
    ...overrides,
  };
}

function job(
  jobId: ObjectID,
  status: RunnerJobStatus,
  overrides: Partial<Record<string, unknown>> = {},
): RunnerJob {
  return {
    id: jobId,
    _id: jobId.toString(),
    status,
    exitCode: status === RunnerJobStatus.Succeeded ? 0 : 1,
    output: "ok",
    ...overrides,
  } as unknown as RunnerJob;
}

function suggestionWith(
  commandPlan: JSONObject,
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    status: AutoRemediationSuggestionStatus.Approved,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    ruleNameSnapshot: "Restart nginx",
    commandPlan,
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

/*
 * The suggestion row as the database holds it: every plan write lands
 * here, and every read — the executor's load and stand-down checks, and
 * the column read a merge starts from — sees the latest write.
 */
interface Store {
  plan: JSONObject;
  verificationStatus: AutoRemediationVerificationStatus;
}

function backWithStore(store: Store): {
  writes: Array<JSONObject>;
} {
  const writes: Array<JSONObject> = [];

  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(async (): Promise<AutoRemediationSuggestion> => {
      return suggestionWith(JSON.parse(JSON.stringify(store.plan)), {
        verificationStatus: store.verificationStatus,
      });
    });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockImplementation(async (): Promise<AutoRemediationSuggestion> => {
      return suggestionWith(JSON.parse(JSON.stringify(store.plan)));
    });
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const plan: JSONObject = (args as { data: { commandPlan: JSONObject } })
        .data.commandPlan;
      store.plan = JSON.parse(JSON.stringify(plan));
      writes.push(store.plan);
      return undefined as never;
    });

  return { writes };
}

function commandsOf(plan: JSONObject): Array<Record<string, unknown>> {
  return plan["commands"] as unknown as Array<Record<string, unknown>>;
}

function statusOf(value: unknown): string | undefined {
  return (value as Record<string, unknown> | undefined)?.["status"] as
    | string
    | undefined;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = (): void => {
    return undefined;
  };
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CommandPlanExecutor — a rollback while the approved plan is still executing", () => {
  let feed: jest.SpyInstance;
  let enqueue: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    enqueue = jest
      .spyOn(RunnerJobService, "enqueueAiCommand")
      .mockImplementation(
        async (args: { stepId: string }): Promise<RunnerJob> => {
          return job(JOB_IDS[args.stepId]!, RunnerJobStatus.Pending);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Command 1 runs and succeeds. Command 2 is still running when the
   * verifier fails the plan (its window closed) and starts the rollback:
   * command 2's job finishes as far as the rollback arm can see, the
   * rollback runs to the end — and only THEN does the executor's own wait
   * on command 2 return and write its outcome.
   */
  async function raceRollbackWithExecutor(): Promise<{
    store: Store;
    rollback: CommandPlanRollbackOutcome;
  }> {
    const store: Store = {
      plan: { commands: [command(1), command(2)] } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
    };
    backWithStore(store);

    const executorWaitOnCommand2: {
      promise: Promise<RunnerJob>;
      resolve: (value: RunnerJob) => void;
    } = deferred<RunnerJob>();
    const executorIsWaiting: {
      promise: Promise<void>;
      resolve: (value: void) => void;
    } = deferred<void>();
    let command2Polls: number = 0;

    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(
        async (args: { jobId: ObjectID }): Promise<RunnerJob> => {
          if (args.jobId.toString() === JOB_IDS["ai-approved-2"]!.toString()) {
            command2Polls += 1;
            if (command2Polls === 1) {
              executorIsWaiting.resolve();
              return executorWaitOnCommand2.promise;
            }
          }
          return job(args.jobId, RunnerJobStatus.Succeeded);
        },
      );
    // The rollback arm's look at command 2's job: still running.
    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockImplementation(
        async (args: { id: ObjectID }): Promise<RunnerJob> => {
          return job(args.id, RunnerJobStatus.Running);
        },
      );

    const executor: Promise<void> = CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    await executorIsWaiting.promise;

    // The verifier fails the plan and rolls back from the copy it read.
    store.verificationStatus = AutoRemediationVerificationStatus.Failed;
    const rollback: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: suggestionWith(
          JSON.parse(JSON.stringify(store.plan)) as JSONObject,
          {
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          },
        ),
      });

    executorWaitOnCommand2.resolve(
      job(JOB_IDS["ai-approved-2"]!, RunnerJobStatus.Succeeded),
    );
    await executor;

    return { store, rollback };
  }

  it("rolls back the command that was still in flight, in reverse order with the rest", async () => {
    const { rollback } = await raceRollbackWithExecutor();

    const rollbackCommands: Array<string> = enqueue.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as Record<string, unknown>)["command"] as string;
      })
      .filter((text: string) => {
        return text.startsWith("undo-");
      });
    expect(rollbackCommands).toEqual(["undo-2", "undo-1"]);
    expect(rollback.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
    expect(rollback.rolledBack).toBe(2);
    expect(rollback.summary).toContain("Rollback completed: 2 command(s)");
  });

  it("keeps the rollback record when the executor writes its outcome afterwards — the executor's writes never erase it", async () => {
    const { store } = await raceRollbackWithExecutor();

    const commands: Array<Record<string, unknown>> = commandsOf(store.plan);
    expect(store.plan["rollbackStatus"]).toBe("Completed");
    expect(statusOf(commands[0]!["rollbackExecution"])).toBe("Succeeded");
    expect(statusOf(commands[1]!["rollbackExecution"])).toBe("Succeeded");
    // ...while the executor's own fields landed too.
    expect(statusOf(commands[1]!["execution"])).toBe("Succeeded");
    expect(store.plan["executionStatus"]).toBe("Completed");
  });

  it("tells the feed the plan finished after verification concluded — never 'verification is watching'", async () => {
    await raceRollbackWithExecutor();

    const markdowns: Array<string> = feed.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      },
    );
    const executorItem: string | undefined = markdowns.find(
      (markdown: string) => {
        return markdown.includes("Approved AI command plan");
      },
    );
    expect(executorItem).toContain(
      "finished after its verification had already concluded",
    );
    expect(executorItem).not.toContain("Verification is watching");
  });

  it("starts each command under the per-plan lock the rollback arm reads under: lock < stand-down check < enqueue < release < wait", async () => {
    const store: Store = {
      plan: { commands: [command(1)] } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
    };
    backWithStore(store);
    const lock: jest.SpyInstance = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "plan-lock" } as unknown as SemaphoreMutex);
    const release: jest.SpyInstance = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined);
    const poll: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(
        async (args: { jobId: ObjectID }): Promise<RunnerJob> => {
          return job(args.jobId, RunnerJobStatus.Succeeded);
        },
      );

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SUGGESTION_ID.toString(),
        namespace: "AutoRemediationCommandPlan",
      }),
    );

    /*
     * The critical section: find the lock taken right before the enqueue
     * and the release right after it — the wait comes only after that.
     */
    const enqueueAt: number = enqueue.mock.invocationCallOrder[0]!;
    const lockBefore: number = Math.max(
      ...lock.mock.invocationCallOrder.filter((order: number) => {
        return order < enqueueAt;
      }),
    );
    const releaseAfter: number = Math.min(
      ...release.mock.invocationCallOrder.filter((order: number) => {
        return order > enqueueAt;
      }),
    );
    const standDownCheck: number = (
      AutoRemediationSuggestionService.findOneById as unknown as jest.SpyInstance
    ).mock.invocationCallOrder[1]!;

    expect(lockBefore).toBeLessThan(standDownCheck);
    expect(standDownCheck).toBeLessThan(enqueueAt);
    expect(releaseAfter).toBeLessThan(poll.mock.invocationCallOrder[0]!);
  });

  it("the rollback arm reads the stored plan under the same lock before deciding what to undo", async () => {
    const store: Store = {
      plan: {
        commands: [
          command(1, { execution: { status: "Succeeded", exitCode: 0 } }),
        ],
        executionStatus: "Failed",
      } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    const lock: jest.SpyInstance = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "plan-lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(
        async (args: { jobId: ObjectID }): Promise<RunnerJob> => {
          return job(args.jobId, RunnerJobStatus.Succeeded);
        },
      );

    await CommandPlanExecutor.executeRollback({
      // A stale copy with nothing executed: the stored plan is what counts.
      suggestion: suggestionWith({
        commands: [command(1)],
      } as unknown as JSONObject),
    });

    const storedRead: number = (
      AutoRemediationSuggestionService.findOneBy as unknown as jest.SpyInstance
    ).mock.invocationCallOrder[0]!;
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(storedRead);
    // The stored plan said command 1 ran — so its undo ran.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(store.plan["rollbackStatus"]).toBe("Completed");
  });
});

describe("CommandPlanExecutor.executeRollback — resuming an interrupted rollback", () => {
  let enqueue: jest.SpyInstance;
  let feed: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    enqueue = jest
      .spyOn(RunnerJobService, "enqueueAiCommand")
      .mockImplementation(
        async (args: { stepId: string }): Promise<RunnerJob> => {
          return job(JOB_IDS[args.stepId]!, RunnerJobStatus.Pending);
        },
      );
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(
        async (args: { jobId: ObjectID }): Promise<RunnerJob> => {
          return job(args.jobId, RunnerJobStatus.Succeeded);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function executed(sequence: number): Record<string, unknown> {
    return command(sequence, {
      execution: { status: "Succeeded", exitCode: 0 },
    });
  }

  function interruptedPlan(rollbackOfTwo: Record<string, unknown>): JSONObject {
    return {
      commands: [
        executed(1),
        { ...executed(2), rollbackExecution: rollbackOfTwo },
        {
          ...executed(3),
          rollbackExecution: {
            status: "Succeeded",
            exitCode: 0,
            runnerJobId: JOB_IDS["ai-rollback-3"]!.toString(),
          },
        },
      ],
      executionStatus: "Completed",
      rollbackHeartbeatAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    } as unknown as JSONObject;
  }

  function enqueuedCommands(): Array<string> {
    return enqueue.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as Record<string, unknown>)["command"] as string;
    });
  }

  it("settles an undo that already reached a Runner from its job — never runs it twice — and runs only what is left", async () => {
    const store: Store = {
      plan: interruptedPlan({
        status: "Pending",
        runnerJobId: JOB_IDS["ai-rollback-2"]!.toString(),
      }),
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue(
        job(JOB_IDS["ai-rollback-2"]!, RunnerJobStatus.Succeeded) as never,
      );

    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: suggestionWith(store.plan),
      });

    // Only command 1's undo ran now; 2 and 3 had already run.
    expect(enqueuedCommands()).toEqual(["undo-1"]);
    const commands: Array<Record<string, unknown>> = commandsOf(store.plan);
    expect(statusOf(commands[0]!["rollbackExecution"])).toBe("Succeeded");
    expect(statusOf(commands[1]!["rollbackExecution"])).toBe("Succeeded");
    expect(store.plan["rollbackStatus"]).toBe("Completed");
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
    expect(outcome.rolledBack).toBe(3);
  });

  it("waits for an undo that is still running on its Runner, then settles it", async () => {
    const store: Store = {
      plan: interruptedPlan({
        status: "Pending",
        runnerJobId: JOB_IDS["ai-rollback-2"]!.toString(),
      }),
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue(
        job(JOB_IDS["ai-rollback-2"]!, RunnerJobStatus.Running) as never,
      );

    await CommandPlanExecutor.executeRollback({
      suggestion: suggestionWith(store.plan),
    });

    const polledJobs: Array<string> = (
      RunnerJobService.pollUntilTerminal as unknown as jest.SpyInstance
    ).mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { jobId: ObjectID }).jobId.toString();
    });
    expect(polledJobs).toContain(JOB_IDS["ai-rollback-2"]!.toString());
    expect(enqueuedCommands()).toEqual(["undo-1"]);
    expect(store.plan["rollbackStatus"]).toBe("Completed");
  });

  it("re-runs an undo whose record never got a job and whose step id has none — it never reached a Runner", async () => {
    const store: Store = {
      plan: interruptedPlan({ status: "Pending" }),
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    const stepLookup: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "findBy")
      .mockResolvedValue([]);

    await CommandPlanExecutor.executeRollback({
      suggestion: suggestionWith(store.plan),
    });

    expect(
      (stepLookup.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query["stepId"],
    ).toBe("ai-rollback-2");
    expect(enqueuedCommands()).toEqual(["undo-2", "undo-1"]);
    expect(store.plan["rollbackStatus"]).toBe("Completed");
  });

  it("finds an undo's job by its rollback step id when the record never named it", async () => {
    const store: Store = {
      plan: interruptedPlan({ status: "Pending" }),
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    jest
      .spyOn(RunnerJobService, "findBy")
      .mockResolvedValue([
        job(JOB_IDS["ai-rollback-2"]!, RunnerJobStatus.Succeeded),
      ]);

    await CommandPlanExecutor.executeRollback({
      suggestion: suggestionWith(store.plan),
    });

    expect(enqueuedCommands()).toEqual(["undo-1"]);
    const rollbackOfTwo: Record<string, unknown> = commandsOf(store.plan)[1]![
      "rollbackExecution"
    ] as Record<string, unknown>;
    expect(rollbackOfTwo["status"]).toBe("Succeeded");
    expect(rollbackOfTwo["runnerJobId"]).toBe(
      JOB_IDS["ai-rollback-2"]!.toString(),
    );
  });

  it("never reports the rollback complete while an undo's outcome cannot be looked up", async () => {
    const store: Store = {
      plan: interruptedPlan({
        status: "Pending",
        runnerJobId: JOB_IDS["ai-rollback-2"]!.toString(),
      }),
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockRejectedValue(new Error("db down"));

    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: suggestionWith(store.plan),
      });

    // The undo whose outcome is unknown is not run a second time.
    expect(enqueuedCommands()).toEqual(["undo-1"]);
    expect(store.plan["rollbackStatus"]).toBe("Failed");
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
    expect(outcome.summary).toContain("may still be applied");
    expect(feed).toHaveBeenCalled();
  });

  it("stamps a heartbeat as it starts, so a recovery sweep can tell a live rollback from an interrupted one", async () => {
    const store: Store = {
      plan: {
        commands: [executed(1)],
        executionStatus: "Completed",
      } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    const { writes } = backWithStore(store);
    const startedAt: number = Date.now();

    await CommandPlanExecutor.executeRollback({
      suggestion: suggestionWith(store.plan),
    });

    const heartbeat: string = writes[0]!["rollbackHeartbeatAt"] as string;
    expect(heartbeat).toBeDefined();
    expect(new Date(heartbeat).getTime()).toBeGreaterThanOrEqual(startedAt - 5);
    expect(writes[0]!["rollbackStatus"]).toBeUndefined();
  });

  it("settles Failed — with a feed item — on an unexpected error, instead of leaving the rollback unsettled forever", async () => {
    const store: Store = {
      plan: {
        commands: [executed(1)],
        executionStatus: "Completed",
      } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    backWithStore(store);
    jest.spyOn(CommandPolicy, "getDenyReason").mockImplementation(() => {
      throw new Error("policy exploded");
    });

    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: suggestionWith(store.plan),
      });

    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
    expect(store.plan["rollbackStatus"]).toBe("Failed");
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("rollback could not complete");
  });

  it("returns the settled outcome of a rollback that was already done — and does nothing", async () => {
    const store: Store = {
      plan: {
        commands: [
          {
            ...executed(1),
            rollbackExecution: { status: "Succeeded", exitCode: 0 },
          },
        ],
        executionStatus: "Completed",
        rollbackStatus: "Completed",
      } as unknown as JSONObject,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
    };
    const { writes } = backWithStore(store);

    const outcome: CommandPlanRollbackOutcome =
      await CommandPlanExecutor.executeRollback({
        suggestion: suggestionWith(store.plan),
      });

    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
    expect(enqueue).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
