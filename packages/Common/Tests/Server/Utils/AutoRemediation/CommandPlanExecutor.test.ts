import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../../../Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the approved-command-plan executor. Approval
 * executes EXACTLY the frozen plan, in sequence order, through the
 * AiRemediation RunnerJob path: nothing runs for a missing/unapproved/
 * non-CommandPlan suggestion or an invalid or already-started plan; the
 * per-command Pending marker is persisted BEFORE the enqueue side effect;
 * outputs are stored redacted and capped; a failed command skips the rest
 * and pings the feed; the denylist is re-checked at execution time; the
 * RunnerJob id is persisted BEFORE the wait so an interrupted command can
 * still be reconciled. The rollback arm undoes only Succeeded commands that
 * carry a rollbackCommand, in REVERSE sequence order, re-checking the
 * denylist, and settles rollbackStatus exactly once.
 *
 * Kubectl commands are re-checked against the cluster's AI page as it is
 * NOW before every enqueue: remediation still enabled and ready, the same
 * Runner and credential bound — and a rollback must be allowed unattended
 * under the cluster's CURRENT mode, or it is left for a human and said so.
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
const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const CMD_ONE: string = "systemctl restart nginx";
const CMD_TWO: string = "systemctl status nginx";

function rawCommand(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sequence: 1,
    stepType: "Bash",
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "prod-runner-1",
    command: CMD_ONE,
    timeoutInMs: 5000,
    rationale: "The service crashed.",
    expectedEffect: "The service restarts.",
    policyVerdict: "RequiresApproval",
    ...overrides,
  };
}

function rawPlan(
  commands: Array<Record<string, unknown>>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    commands: commands,
    ...overrides,
  };
}

function fakeSuggestion(
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
    /*
     * The executor re-reads these before every command: it stands down as
     * soon as verification settles or the window closes, so the happy path
     * needs a Pending verification and an open deadline.
     */
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    ruleNameSnapshot: "Restart nginx",
    commandPlan: rawPlan([
      rawCommand(),
      rawCommand({ sequence: 2, command: CMD_TWO }),
    ]),
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function mockFetch(suggestion: AutoRemediationSuggestion | null): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue(suggestion);
}

/*
 * The executor reads the suggestion once to load the plan and then re-reads
 * it before every command. This lets a test hand out a different row on the
 * re-reads — the state another actor (verifier or human) moved it to.
 */
function mockFetchThenReread(
  first: AutoRemediationSuggestion | null,
  rereads: AutoRemediationSuggestion | null,
): jest.SpyInstance {
  return jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValueOnce(first)
    .mockResolvedValue(rereads);
}

function mockPersist(): jest.SpyInstance {
  return jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
}

function terminalJob(
  overrides: Partial<Record<string, unknown>> = {},
): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "ok",
    ...overrides,
  } as unknown as RunnerJob;
}

function mockEnqueue(): jest.SpyInstance {
  return jest
    .spyOn(RunnerJobService, "enqueueAiCommand")
    .mockResolvedValue(terminalJob({ status: RunnerJobStatus.Pending }));
}

function mockPoll(): jest.SpyInstance {
  return jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(terminalJob());
}

function mockFeed(): jest.SpyInstance {
  return jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
}

function persistedPlanAt(
  update: jest.SpyInstance,
  index: number,
): Record<string, unknown> {
  const call: Record<string, unknown> = update.mock.calls[index]![0] as Record<
    string,
    unknown
  >;
  const data: Record<string, unknown> = call["data"] as Record<string, unknown>;
  return data["commandPlan"] as Record<string, unknown>;
}

function lastPersistedPlan(update: jest.SpyInstance): Record<string, unknown> {
  return persistedPlanAt(update, update.mock.calls.length - 1);
}

function commandInPlan(
  plan: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const commands: Array<Record<string, unknown>> = plan["commands"] as Array<
    Record<string, unknown>
  >;
  return commands[index] as Record<string, unknown>;
}

describe("CommandPlanExecutor.executeApprovedPlan", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing when the suggestion no longer exists", async () => {
    mockFetch(null);
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does nothing when the suggestion is not Approved", async () => {
    mockFetch(
      fakeSuggestion({ status: AutoRemediationSuggestionStatus.Suggested }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does nothing for a Runbook suggestion", async () => {
    mockFetch(
      fakeSuggestion({
        suggestionType: AutoRemediationSuggestionType.Runbook,
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("logs and executes nothing when the stored plan is invalid", async () => {
    mockFetch(fakeSuggestion({ commandPlan: { commands: [] } }));
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    const errorLog: jest.SpyInstance = jest.spyOn(logger, "error");

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("missing or invalid"),
    );
  });

  it("does not re-execute a plan that is already Running", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([rawCommand()], { executionStatus: "Running" }),
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not re-execute a plan that already Completed", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([rawCommand()], { executionStatus: "Completed" }),
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("executes both commands in order, persists Pending before each enqueue, caps and redacts outputs, and completes the plan", async () => {
    mockFetch(fakeSuggestion());
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    const longOutput: string = "z".repeat(7000);
    const secretOutput: string =
      "restarted. auth header was Bearer abcdefghijklmnopqrstuvwxyz done";
    const poll: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValueOnce(terminalJob({ output: longOutput }))
      .mockResolvedValueOnce(terminalJob({ output: secretOutput }));
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    // Commands are enqueued strictly in sequence order.
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledTimes(2);
    const firstEnqueue: Record<string, unknown> = enqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    const secondEnqueue: Record<string, unknown> = enqueue.mock
      .calls[1]![0] as Record<string, unknown>;
    expect(firstEnqueue["command"]).toBe(CMD_ONE);
    expect(firstEnqueue["stepId"]).toBe("ai-approved-1");
    expect(firstEnqueue["timeoutInMs"]).toBe(5000);
    expect((firstEnqueue["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(secondEnqueue["command"]).toBe(CMD_TWO);
    expect(secondEnqueue["stepId"]).toBe("ai-approved-2");

    /*
     * Persist order: Running plan, cmd1 Pending, cmd1 job id, cmd1 result,
     * cmd2 Pending, cmd2 job id, cmd2 result, plan Completed — each Pending
     * marker lands BEFORE its enqueue side effect, and each job id lands
     * BEFORE its wait.
     */
    expect(update).toHaveBeenCalledTimes(8);
    const firstPendingPlan: Record<string, unknown> = persistedPlanAt(
      update,
      1,
    );
    expect(
      (
        commandInPlan(firstPendingPlan, 0)["execution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Pending");
    expect(commandInPlan(firstPendingPlan, 1)["execution"]).toBeUndefined();
    expect(update.mock.invocationCallOrder[1]).toBeLessThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    const firstJobIdPlan: Record<string, unknown> = persistedPlanAt(update, 2);
    expect(commandInPlan(firstJobIdPlan, 0)["execution"]).toEqual(
      expect.objectContaining({
        status: "Pending",
        runnerJobId: JOB_ID.toString(),
      }),
    );
    expect(update.mock.invocationCallOrder[2]).toBeGreaterThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(update.mock.invocationCallOrder[2]).toBeLessThan(
      poll.mock.invocationCallOrder[0]!,
    );
    const secondPendingPlan: Record<string, unknown> = persistedPlanAt(
      update,
      4,
    );
    expect(
      (
        commandInPlan(secondPendingPlan, 1)["execution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Pending");
    expect(update.mock.invocationCallOrder[4]).toBeLessThan(
      enqueue.mock.invocationCallOrder[1]!,
    );

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Completed");
    const firstExecution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    const secondExecution: Record<string, unknown> = commandInPlan(
      finalPlan,
      1,
    )["execution"] as Record<string, unknown>;
    expect(firstExecution["status"]).toBe("Succeeded");
    expect(firstExecution["exitCode"]).toBe(0);
    // Oversized output is capped, not stored whole.
    const storedOutput: string = firstExecution["output"] as string;
    expect(storedOutput.endsWith("... [output truncated]")).toBe(true);
    expect(storedOutput.length).toBeLessThan(longOutput.length);
    // Secret material is redacted before storage.
    expect(secondExecution["output"] as string).toContain(
      "Bearer [redacted-token]",
    );
    expect(secondExecution["output"] as string).not.toContain(
      "abcdefghijklmnopqrstuvwxyz",
    );

    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: false,
        }),
      }),
    );
  });

  it("skips the remaining commands and pings the feed when a command fails", async () => {
    mockFetch(fakeSuggestion());
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValueOnce(
      terminalJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "boom",
        errorMessage: "unit failed",
      }),
    );
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    // The second command never reaches the Runner.
    expect(enqueue).toHaveBeenCalledTimes(1);

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    const firstExecution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    const secondExecution: Record<string, unknown> = commandInPlan(
      finalPlan,
      1,
    )["execution"] as Record<string, unknown>;
    expect(firstExecution["status"]).toBe("Failed");
    expect(firstExecution["errorMessage"]).toBe("unit failed");
    expect(secondExecution["status"]).toBe("Skipped");

    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });

  it("refuses a denylisted command at execution time without enqueueing it", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([rawCommand({ command: "reboot" })]),
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toContain(
      "Refused by the remediation command policy",
    );
  });

  it("marks the command and the plan Failed when the enqueue itself throws", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawCommand()]) }));
    const update: jest.SpyInstance = mockPersist();
    jest
      .spyOn(RunnerJobService, "enqueueAiCommand")
      .mockRejectedValue(new Error("enqueue exploded"));
    mockPoll();
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toBe("enqueue exploded");
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });

  /*
   * The abort re-check. Verification runs on its own sweep and can settle
   * (and start rolling back) a remediation while this plan is mid-flight, so
   * the executor re-reads the suggestion BEFORE every command and stands
   * down the moment the row says the remediation is no longer a live,
   * in-window, Approved one.
   */
  function expectSkippedBecauseSettled(
    plan: Record<string, unknown>,
    index: number,
  ): void {
    const execution: Record<string, unknown> = commandInPlan(plan, index)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Skipped");
    expect(execution["errorMessage"]).toContain(
      "this remediation was settled (verified, failed, or actioned by a human)",
    );
  }

  it("issues nothing when verification already Failed before the first command", async () => {
    mockFetchThenReread(
      fakeSuggestion(),
      fakeSuggestion({
        verificationStatus: AutoRemediationVerificationStatus.Failed,
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    // Nothing reached the Runner at all.
    expect(enqueue).not.toHaveBeenCalled();

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expectSkippedBecauseSettled(finalPlan, 0);
    expect(
      (commandInPlan(finalPlan, 1)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Skipped");
  });

  it("stops mid-plan when verification settles between commands", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      // The plan load.
      .mockResolvedValueOnce(fakeSuggestion())
      // Re-check before command 1: still live.
      .mockResolvedValueOnce(fakeSuggestion())
      // Re-check before command 2: the verifier settled it in the meantime.
      .mockResolvedValue(
        fakeSuggestion({
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    // Only the first command was issued; the second never left the process.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe(CMD_ONE);

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expect(
      (commandInPlan(finalPlan, 0)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Succeeded");
    expectSkippedBecauseSettled(finalPlan, 1);
  });

  it("issues nothing when a human moved the suggestion off Approved", async () => {
    mockFetchThenReread(
      fakeSuggestion(),
      fakeSuggestion({ status: AutoRemediationSuggestionStatus.Dismissed }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expectSkippedBecauseSettled(finalPlan, 0);
  });

  it("issues nothing once the verification deadline has passed", async () => {
    mockFetchThenReread(
      fakeSuggestion(),
      fakeSuggestion({
        verificationDeadlineAt: new Date(Date.now() - 60 * 1000),
      }),
    );
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expectSkippedBecauseSettled(finalPlan, 0);
  });

  it("fails OPEN and keeps executing when the abort re-check read throws", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValueOnce(fakeSuggestion())
      .mockRejectedValue(new Error("read timeout"));
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const errorLog: jest.SpyInstance = jest.spyOn(logger, "error");

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    /*
     * A transient read failure must not strand a half-applied remediation,
     * so both commands still run — loudly.
     */
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("read timeout"),
    );
    expect(lastPersistedPlan(update)["executionStatus"]).toBe("Completed");
  });
});

describe("CommandPlanExecutor.executeRollback", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function executedCommand(
    sequence: number,
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return rawCommand({
      sequence: sequence,
      command: `forward-${sequence}`,
      rollbackCommand: `undo-${sequence}`,
      execution: { status: "Succeeded", exitCode: 0 },
      ...overrides,
    });
  }

  it("does nothing when the suggestion has no parseable plan", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({ commandPlan: undefined }),
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does nothing when a rollback was already attempted", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([executedCommand(1)], {
          executionStatus: "Failed",
          rollbackStatus: "Completed",
        }),
      }),
    });

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("settles NotApplicable, without a feed item, when nothing rolls back", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [executedCommand(1, { rollbackCommand: undefined })],
          { executionStatus: "Failed" },
        ),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("rolls back in reverse sequence order, completes, and pings the feed", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [executedCommand(1), executedCommand(2), executedCommand(3)],
          { executionStatus: "Failed" },
        ),
      }),
    });

    const enqueuedCommands: Array<string> = enqueue.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as Record<string, unknown>)["command"] as string;
      },
    );
    expect(enqueuedCommands).toEqual(["undo-3", "undo-2", "undo-1"]);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["stepId"],
    ).toBe("ai-rollback-3");

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Completed");
    for (let i: number = 0; i < 3; i++) {
      const rollbackExecution: Record<string, unknown> = commandInPlan(
        finalPlan,
        i,
      )["rollbackExecution"] as Record<string, unknown>;
      expect(rollbackExecution["status"]).toBe("Succeeded");
    }
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });

  it("only rolls back Succeeded commands that carry a rollback command", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [
            executedCommand(1),
            executedCommand(2, {
              execution: { status: "Failed", errorMessage: "boom" },
            }),
            executedCommand(3, { rollbackCommand: undefined }),
          ],
          { executionStatus: "Failed" },
        ),
      }),
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe("undo-1");
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Completed");
    expect(commandInPlan(finalPlan, 1)["rollbackExecution"]).toBeUndefined();
    expect(commandInPlan(finalPlan, 2)["rollbackExecution"]).toBeUndefined();
  });

  it("refuses a denylisted rollback command without enqueueing it and fails the rollback", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    const feed: jest.SpyInstance = mockFeed();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [executedCommand(1, { rollbackCommand: "reboot" })],
          { executionStatus: "Failed" },
        ),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Failed");
    const rollbackExecution: Record<string, unknown> = commandInPlan(
      finalPlan,
      0,
    )["rollbackExecution"] as Record<string, unknown>;
    expect(rollbackExecution["status"]).toBe("Failed");
    expect(rollbackExecution["errorMessage"]).toContain(
      "Rollback refused by the command policy",
    );
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  });

  it("fails the rollback when the rollback job itself fails", async () => {
    const update: jest.SpyInstance = mockPersist();
    mockEnqueue();
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      terminalJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "undo failed",
      }),
    );
    mockFeed();

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([executedCommand(1)], {
          executionStatus: "Failed",
        }),
      }),
    });

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Failed");
    const rollbackExecution: Record<string, unknown> = commandInPlan(
      finalPlan,
      0,
    )["rollbackExecution"] as Record<string, unknown>;
    expect(rollbackExecution["status"]).toBe("Failed");
    expect(rollbackExecution["errorMessage"]).toBe("undo failed");
  });

  /*
   * Reconciliation of unsettled commands. The executor writes Pending,
   * enqueues, and only then writes the outcome — a pod death in that window
   * leaves a command recorded Pending that may well have changed the system.
   * The RunnerJob row is the authority, so rollback resolves those records
   * first; otherwise a crash silently exempts a real change from being undone.
   */
  function pendingCommand(
    sequence: number,
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return executedCommand(sequence, {
      execution: {
        status: "Pending",
        runnerJobId: JOB_ID.toString(),
        startedAt: new Date().toISOString(),
      },
      ...overrides,
    });
  }

  function mockJobLookup(job: RunnerJob | null): jest.SpyInstance {
    return jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue(job as never);
  }

  it("upgrades a Pending command whose job Succeeded and rolls it back", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const jobLookup: jest.SpyInstance = mockJobLookup(
      terminalJob({ status: RunnerJobStatus.Succeeded, output: "restarted" }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([pendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(jobLookup).toHaveBeenCalledTimes(1);
    const lookupArgs: Record<string, unknown> = jobLookup.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((lookupArgs["id"] as ObjectID).toString()).toBe(JOB_ID.toString());

    // The command really ran, so its undo really runs.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe("undo-1");

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Succeeded");
    expect(execution["output"]).toBe("restarted");
    expect(finalPlan["rollbackStatus"]).toBe("Completed");
  });

  it("marks a Pending command whose job Failed as Failed and does not roll it back", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    const feed: jest.SpyInstance = mockFeed();
    mockJobLookup(
      terminalJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "unit failed",
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([pendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toBe("unit failed");
    expect(commandInPlan(finalPlan, 0)["rollbackExecution"]).toBeUndefined();
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("marks a Pending command whose job TimedOut as Failed and does not roll it back", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    mockJobLookup(
      terminalJob({
        status: RunnerJobStatus.TimedOut,
        errorMessage: undefined,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([pendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toContain("TimedOut");
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  /*
   * A Pending record with NO job id: the pod died (or the write failed)
   * between the enqueue and the persist that names the job. The Runner was
   * still handed the job, so the record is resolved through the
   * (suggestion, stepId) pair the lane enqueued it under — never by
   * assuming it did not run.
   */
  function jobLessPendingCommand(
    sequence: number,
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return pendingCommand(sequence, {
      execution: {
        status: "Pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    });
  }

  function mockStepIdLookup(jobs: Array<RunnerJob>): jest.SpyInstance {
    return jest.spyOn(RunnerJobService, "findBy").mockResolvedValue(jobs);
  }

  function stepIdQuery(lookup: jest.SpyInstance): Record<string, unknown> {
    return (lookup.mock.calls[0]![0] as { query: Record<string, unknown> })
      .query;
  }

  it("resolves a Pending command with no runnerJobId through its (suggestion, stepId) job, names the job, and rolls it back when it Succeeded", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const byId: jest.SpyInstance = mockJobLookup(null);
    const byStepId: jest.SpyInstance = mockStepIdLookup([
      terminalJob({ status: RunnerJobStatus.Succeeded, output: "restarted" }),
    ]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([jobLessPendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    // Looked up by the pair the approved-plan lane enqueued it under.
    expect(byId).not.toHaveBeenCalled();
    expect(byStepId).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = stepIdQuery(byStepId);
    expect((query["autoRemediationSuggestionId"] as ObjectID).toString()).toBe(
      SUGGESTION_ID.toString(),
    );
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["stepId"]).toBe("ai-approved-1");
    expect(query["origin"]).toBe("AiRemediation");
    expect((byStepId.mock.calls[0]![0] as { limit: number }).limit).toBe(1);

    // The command really ran, so its undo really runs.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe("undo-1");

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Succeeded");
    expect(execution["output"]).toBe("restarted");
    // The recovered job id now lives on the record.
    expect(execution["runnerJobId"]).toBe(JOB_ID.toString());
    expect(finalPlan["rollbackStatus"]).toBe("Completed");
  });

  it("looks a job-less command a FullAuto run executed inline up under the inline step id", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const byStepId: jest.SpyInstance = mockStepIdLookup([
      terminalJob({ status: RunnerJobStatus.Succeeded }),
    ]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [jobLessPendingCommand(2, { wasAutoExecuted: true })],
          { executionStatus: "Failed" },
        ),
      }),
    });

    expect(stepIdQuery(byStepId)["stepId"]).toBe("ai-command-2");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (enqueue.mock.calls[0]![0] as Record<string, unknown>)["stepId"],
    ).toBe("ai-rollback-2");
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });

  it("marks a job-less Pending command Failed, and does not roll it back, when its stepId job Failed", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    mockStepIdLookup([
      terminalJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "unit failed",
      }),
    ]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([jobLessPendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toBe("unit failed");
    expect(execution["runnerJobId"]).toBe(JOB_ID.toString());
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("names a job-less command's still-running stepId job on the record but leaves its status alone", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    mockStepIdLookup([terminalJob({ status: RunnerJobStatus.Running })]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([jobLessPendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Pending");
    expect(execution["runnerJobId"]).toBe(JOB_ID.toString());
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("leaves a Pending command with no runnerJobId alone when no job carries its stepId — it never reached the Runner", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const byId: jest.SpyInstance = mockJobLookup(terminalJob());
    const byStepId: jest.SpyInstance = mockStepIdLookup([]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([jobLessPendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(byId).not.toHaveBeenCalled();
    expect(byStepId).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Pending");
    expect(execution["runnerJobId"]).toBeUndefined();
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("leaves a job-less Pending command alone when the stepId lookup itself fails, and logs it", async () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    jest
      .spyOn(RunnerJobService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([jobLessPendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("db down"));
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(
      (commandInPlan(finalPlan, 0)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Pending");
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });

  it("prefers the job id on the record over a stepId lookup when both could answer", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const byId: jest.SpyInstance = mockJobLookup(
      terminalJob({ status: RunnerJobStatus.Succeeded }),
    );
    const byStepId: jest.SpyInstance = mockStepIdLookup([
      terminalJob({ status: RunnerJobStatus.Failed, exitCode: 1 }),
    ]);

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([pendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(byId).toHaveBeenCalledTimes(1);
    expect(byStepId).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });

  it("leaves a Pending command alone while its job is still in flight", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    mockJobLookup(terminalJob({ status: RunnerJobStatus.Running }));

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan([pendingCommand(1)], {
          executionStatus: "Running",
        }),
      }),
    });

    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(
      (commandInPlan(finalPlan, 0)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Pending");
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
  });
});

/*
 * Shared fixtures for the kubectl re-check suites below. A kubectl command
 * freezes the cluster, the Runner and the credential its AI page bound at
 * planning time; the executor reads that page again right before enqueueing.
 */
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const KUBECTL_RESTART: string = "kubectl rollout restart deployment/web -n web";
const KUBECTL_UNDO: string = "kubectl rollout undo deployment/web -n web";
const KUBECTL_SET_IMAGE: string =
  "kubectl set image deployment/web web=nginx:1.27 -n web";
const KUBECTL_SET_IMAGE_BACK: string =
  "kubectl set image deployment/web web=nginx:1.26 -n web";

function rawKubectlCommand(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return rawCommand({
    stepType: "Kubectl",
    runnerNameSnapshot: "kubernetes-agent/prod-us",
    command: KUBECTL_RESTART,
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: "SafeWrite",
    rollbackCommand: KUBECTL_UNDO,
    ...overrides,
  });
}

function clusterStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function disabledClusterStatus(): KubernetesClusterAiAccessStatus {
  return clusterStatus({
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [
      {
        code: "remediation_disabled",
        title: "AI remediation is turned off for this cluster",
        description:
          "OneUptime AI will diagnose but never propose or apply a fix on this cluster.",
        nextStep: "Set AI remediation on the cluster's AI page.",
        blocks: "remediation",
      },
    ],
  });
}

function mockClusterStatus(
  status: KubernetesClusterAiAccessStatus | null,
): jest.SpyInstance {
  return jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(status);
}

function mockKubectlEnqueue(): jest.SpyInstance {
  return jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(terminalJob({ status: RunnerJobStatus.Pending }));
}

function mockRecordOutcome(): jest.SpyInstance {
  return jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
}

function feedMarkdown(feed: jest.SpyInstance): string {
  return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

describe("CommandPlanExecutor persists the RunnerJob id before waiting", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the job id on the Pending command before polling an approved command", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawCommand()]) }));
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockFeed();

    let recordAtPollStart: Record<string, unknown> | undefined = undefined;
    const poll: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(async (): Promise<RunnerJob> => {
        recordAtPollStart = commandInPlan(lastPersistedPlan(update), 0)[
          "execution"
        ] as Record<string, unknown>;
        return terminalJob();
      });

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(recordAtPollStart).toEqual(
      expect.objectContaining({
        status: "Pending",
        runnerJobId: JOB_ID.toString(),
      }),
    );
    // enqueue < job-id persist < poll
    const jobIdPersistOrder: number = update.mock.invocationCallOrder[2]!;
    expect(jobIdPersistOrder).toBeGreaterThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(jobIdPersistOrder).toBeLessThan(poll.mock.invocationCallOrder[0]!);

    const finalExecution: Record<string, unknown> = commandInPlan(
      lastPersistedPlan(update),
      0,
    )["execution"] as Record<string, unknown>;
    expect(finalExecution["status"]).toBe("Succeeded");
    expect(finalExecution["runnerJobId"]).toBe(JOB_ID.toString());
  });

  it("keeps the job id on an approved command whose wait throws", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawCommand()]) }));
    const update: jest.SpyInstance = mockPersist();
    mockEnqueue();
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockRejectedValue(new Error("lease lost"));
    mockFeed();

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expect(commandInPlan(finalPlan, 0)["execution"]).toEqual(
      expect.objectContaining({
        status: "Failed",
        runnerJobId: JOB_ID.toString(),
        errorMessage: "lease lost",
      }),
    );
  });

  it("records the job id on a Pending rollback before polling it", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockFeed();

    let recordAtPollStart: Record<string, unknown> | undefined = undefined;
    const poll: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation(async (): Promise<RunnerJob> => {
        recordAtPollStart = commandInPlan(lastPersistedPlan(update), 0)[
          "rollbackExecution"
        ] as Record<string, unknown>;
        return terminalJob();
      });

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [
            rawCommand({
              rollbackCommand: "systemctl stop nginx",
              execution: { status: "Succeeded", exitCode: 0 },
            }),
          ],
          { executionStatus: "Failed" },
        ),
      }),
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordAtPollStart).toEqual(
      expect.objectContaining({
        status: "Pending",
        runnerJobId: JOB_ID.toString(),
      }),
    );
    expect(poll).toHaveBeenCalledTimes(1);
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });
});

describe("CommandPlanExecutor re-checks the cluster before an approved kubectl command runs", () => {
  let feed: jest.SpyInstance;
  let update: jest.SpyInstance;
  let kubectlEnqueue: jest.SpyInstance;
  let bashEnqueue: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    update = mockPersist();
    kubectlEnqueue = mockKubectlEnqueue();
    bashEnqueue = mockEnqueue();
    mockPoll();
    mockRecordOutcome();
    feed = mockFeed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectRefused(reasonFragment: string): void {
    expect(kubectlEnqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    const execution: Record<string, unknown> = commandInPlan(finalPlan, 0)[
      "execution"
    ] as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["errorMessage"]).toContain("Refused at execution time");
    expect(execution["errorMessage"]).toContain(reasonFragment);
    // The human hears the reason on the feed, not just "a command failed".
    expect(feedMarkdown(feed)).toContain(reasonFragment);
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  }

  it("runs the command when the cluster is still ready and bound to the plan's Runner", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    const status: jest.SpyInstance = mockClusterStatus(clusterStatus());

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(status).toHaveBeenCalledTimes(1);
    const statusArgs: { clusterId: ObjectID; projectId: ObjectID } = status.mock
      .calls[0]![0] as { clusterId: ObjectID; projectId: ObjectID };
    expect(statusArgs.clusterId.toString()).toBe(CLUSTER_ID.toString());
    expect(statusArgs.projectId.toString()).toBe(PROJECT_ID.toString());

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    const enqueueArgs: Record<string, unknown> = kubectlEnqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((enqueueArgs["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(
      RUNNER_ID.toString(),
    );
    expect(enqueueArgs["command"]).toBe(KUBECTL_RESTART);
    expect(bashEnqueue).not.toHaveBeenCalled();
    expect(lastPersistedPlan(update)["executionStatus"]).toBe("Completed");
  });

  it("refuses when the cluster's AI remediation was turned off after the plan was composed", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    mockClusterStatus(disabledClusterStatus());

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused('cluster "prod-us" no longer allows AI remediation');
    expect(
      (
        commandInPlan(lastPersistedPlan(update), 0)["execution"] as Record<
          string,
          unknown
        >
      )["errorMessage"],
    ).toContain("AI remediation is turned off for this cluster");
  });

  it("refuses when the cluster is not remediation-ready for any other reason (a read-only in-cluster Runner)", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    mockClusterStatus(
      clusterStatus({
        isRemediationReady: false,
        gaps: [
          {
            code: "remediation_write_access_missing",
            title: "The in-cluster Runner is read-only",
            description: "",
            nextStep: "",
            blocks: "remediation",
          },
        ],
      }),
    );

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused("The in-cluster Runner is read-only");
  });

  it("refuses when the cluster is now bound to a different Runner than the plan froze", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    mockClusterStatus(
      clusterStatus({
        runner: {
          id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us-v2",
          isOnline: true,
          canRunAiCommands: true,
        },
      }),
    );

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused(
      'no longer reached through Runner "kubernetes-agent/prod-us"',
    );
  });

  it("refuses when the cluster has no Runner bound any more", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    mockClusterStatus(clusterStatus({ runner: null, accessMethod: "none" }));

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused("no longer reached through Runner");
  });

  it("refuses when the credential the plan froze is no longer the cluster's", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([
          rawKubectlCommand({
            credentialId: "55555555-5555-4555-8555-555555555555",
            credentialNameSnapshot: "old kubeconfig",
          }),
        ]),
      }),
    );
    mockClusterStatus(
      clusterStatus({
        accessMethod: "credential",
        credentialId: "66666666-6666-4666-8666-666666666666",
        credentialName: "new kubeconfig",
      }),
    );

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused("no longer reached with the credential");
  });

  it("refuses when the cluster no longer exists in the project", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    mockClusterStatus(null);

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused('cluster "prod-us" no longer exists in this project');
  });

  it("fails CLOSED when the cluster status cannot be read", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawKubectlCommand()]) }));
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockRejectedValue(new Error("db down"));

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expectRefused("could not confirm that cluster");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("db down"),
    );
  });

  it("re-checks before EVERY kubectl command, so a change made mid-plan stops the rest", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([
          rawKubectlCommand(),
          rawKubectlCommand({ sequence: 2, command: KUBECTL_UNDO }),
        ]),
      }),
    );
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValueOnce(clusterStatus())
      .mockResolvedValue(disabledClusterStatus());

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["executionStatus"]).toBe("Failed");
    expect(
      (commandInPlan(finalPlan, 0)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Succeeded");
    expect(
      (commandInPlan(finalPlan, 1)["execution"] as Record<string, unknown>)[
        "errorMessage"
      ],
    ).toContain("no longer allows AI remediation");
    expect(feedMarkdown(feed)).toContain("command 2 failed");
  });

  it("does not consult the cluster page for Bash commands", async () => {
    mockFetch(fakeSuggestion({ commandPlan: rawPlan([rawCommand()]) }));
    const status: jest.SpyInstance = mockClusterStatus(clusterStatus());

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(status).not.toHaveBeenCalled();
    expect(bashEnqueue).toHaveBeenCalledTimes(1);
    expect(lastPersistedPlan(update)["executionStatus"]).toBe("Completed");
  });

  it("still refuses a Denied kubectl command before reading the cluster", async () => {
    mockFetch(
      fakeSuggestion({
        commandPlan: rawPlan([
          rawKubectlCommand({
            command: "kubectl delete namespace web",
            rollbackCommand: undefined,
          }),
        ]),
      }),
    );
    const status: jest.SpyInstance = mockClusterStatus(clusterStatus());

    await CommandPlanExecutor.executeApprovedPlan({
      suggestionId: SUGGESTION_ID,
    });

    expect(status).not.toHaveBeenCalled();
    expect(kubectlEnqueue).not.toHaveBeenCalled();
    expect(
      (
        commandInPlan(lastPersistedPlan(update), 0)["execution"] as Record<
          string,
          unknown
        >
      )["errorMessage"],
    ).toContain("Refused by the remediation command policy");
  });
});

describe("CommandPlanExecutor re-checks the cluster before a kubectl rollback runs", () => {
  let feed: jest.SpyInstance;
  let update: jest.SpyInstance;
  let kubectlEnqueue: jest.SpyInstance;
  let bashEnqueue: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    update = mockPersist();
    kubectlEnqueue = mockKubectlEnqueue();
    bashEnqueue = mockEnqueue();
    mockPoll();
    mockRecordOutcome();
    feed = mockFeed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A kubectl command that ran, with a RiskyWrite undo (only Bypass accepts one).
  function executedSetImage(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return rawKubectlCommand({
      command: KUBECTL_SET_IMAGE,
      kubectlTier: "RiskyWrite",
      rollbackCommand: KUBECTL_SET_IMAGE_BACK,
      execution: { status: "Succeeded", exitCode: 0 },
      ...overrides,
    });
  }

  function failedPlan(
    commands: Array<Record<string, unknown>>,
  ): AutoRemediationSuggestion {
    return fakeSuggestion({
      commandPlan: rawPlan(commands, { executionStatus: "Failed" }),
    });
  }

  function expectSkipped(reasonFragment: string): void {
    expect(kubectlEnqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Failed");
    const rollbackExecution: Record<string, unknown> = commandInPlan(
      finalPlan,
      0,
    )["rollbackExecution"] as Record<string, unknown>;
    expect(rollbackExecution["status"]).toBe("Skipped");
    expect(rollbackExecution["errorMessage"]).toContain("Rollback not run");
    expect(rollbackExecution["errorMessage"]).toContain(reasonFragment);
    expect(rollbackExecution["errorMessage"]).toContain(
      `Undo it manually: ${KUBECTL_SET_IMAGE_BACK}`,
    );
    // Said so on the feed, with the command a human now has to run.
    const markdown: string = feedMarkdown(feed);
    expect(markdown).toContain("rollback was not run for 1 command(s)");
    expect(markdown).toContain(reasonFragment);
    expect(markdown).toContain(KUBECTL_SET_IMAGE_BACK);
    expect(markdown).toContain("manual intervention is needed");
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: true,
        }),
      }),
    );
  }

  it("skips a RiskyWrite rollback accepted under BypassApproval once the cluster stopped bypassing approvals, and says so", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expectSkipped("no longer allows this change unattended");
    expect(
      (
        commandInPlan(lastPersistedPlan(update), 0)[
          "rollbackExecution"
        ] as Record<string, unknown>
      )["errorMessage"],
    ).toContain("its AI remediation mode is now RequireApproval");
  });

  it("skips the same rollback when the cluster was downgraded to Automatic without an allowlist match", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: ["kubectl scale deployment/web * -n web"],
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expectSkipped("its AI remediation mode is now Automatic");
  });

  it("still runs the RiskyWrite rollback while the cluster bypasses approvals", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    const enqueueArgs: Record<string, unknown> = kubectlEnqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueueArgs["command"]).toBe(KUBECTL_SET_IMAGE_BACK);
    expect(enqueueArgs["stepId"]).toBe("ai-rollback-1");
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Completed");
    expect(
      (
        commandInPlan(finalPlan, 0)["rollbackExecution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Succeeded");
    expect(feedMarkdown(feed)).toContain("rolled back");
  });

  it("runs a RiskyWrite rollback the cluster's allowlist names, in Automatic mode", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });

  it("runs a SafeWrite rollback on a RequireApproval cluster — safe changes are always allowed unattended", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([
        rawKubectlCommand({
          execution: { status: "Succeeded", exitCode: 0 },
        }),
      ]),
    });

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    expect(
      (kubectlEnqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe(KUBECTL_UNDO);
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });

  it("skips every kubectl rollback once the cluster's remediation is Disabled — AI never runs a change there", async () => {
    mockClusterStatus(disabledClusterStatus());

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expectSkipped('cluster "prod-us" no longer allows AI remediation');
  });

  it("skips the rollback when the cluster is now bound to another Runner", async () => {
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
        runner: {
          id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us-v2",
          isOnline: true,
          canRunAiCommands: true,
        },
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expectSkipped("no longer reached through Runner");
  });

  it("fails CLOSED when the cluster status cannot be read at rollback time", async () => {
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockRejectedValue(new Error("db down"));

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([executedSetImage()]),
    });

    expectSkipped("could not confirm that cluster");
  });

  it("skips only the rollbacks the cluster refuses and still runs the rest, reporting both", async () => {
    // Command 1: safe undo (runs). Command 2: risky undo (skipped now that the cluster asks).
    mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([
        rawKubectlCommand({
          execution: { status: "Succeeded", exitCode: 0 },
        }),
        executedSetImage({ sequence: 2 }),
      ]),
    });

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    expect(
      (kubectlEnqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe(KUBECTL_UNDO);

    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(finalPlan["rollbackStatus"]).toBe("Failed");
    expect(
      (
        commandInPlan(finalPlan, 0)["rollbackExecution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Succeeded");
    expect(
      (
        commandInPlan(finalPlan, 1)["rollbackExecution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Skipped");
    expect(feedMarkdown(feed)).toContain("was not run for 1 command(s)");
  });

  it("still refuses a Denied rollback before ever reading the cluster", async () => {
    const status: jest.SpyInstance = mockClusterStatus(
      clusterStatus({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    );

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([
        executedSetImage({ rollbackCommand: "kubectl delete namespace web" }),
      ]),
    });

    expect(status).not.toHaveBeenCalled();
    expect(kubectlEnqueue).not.toHaveBeenCalled();
    const rollbackExecution: Record<string, unknown> = commandInPlan(
      lastPersistedPlan(update),
      0,
    )["rollbackExecution"] as Record<string, unknown>;
    expect(rollbackExecution["status"]).toBe("Failed");
    expect(rollbackExecution["errorMessage"]).toContain(
      "Rollback refused by the command policy",
    );
  });

  it("leaves Bash rollbacks alone — there is no cluster to consult", async () => {
    const status: jest.SpyInstance = mockClusterStatus(disabledClusterStatus());

    await CommandPlanExecutor.executeRollback({
      suggestion: failedPlan([
        rawCommand({
          rollbackCommand: "systemctl stop nginx",
          execution: { status: "Succeeded", exitCode: 0 },
        }),
      ]),
    });

    expect(status).not.toHaveBeenCalled();
    expect(bashEnqueue).toHaveBeenCalledTimes(1);
    expect(lastPersistedPlan(update)["rollbackStatus"]).toBe("Completed");
  });
});
