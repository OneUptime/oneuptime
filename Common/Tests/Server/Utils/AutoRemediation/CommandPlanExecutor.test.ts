import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
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
 * and pings the feed; the denylist is re-checked at execution time. The
 * rollback arm undoes only Succeeded commands that carry a rollbackCommand,
 * in REVERSE sequence order, re-checking the denylist, and settles
 * rollbackStatus exactly once.
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
     * Persist order: Running plan, cmd1 Pending, cmd1 result, cmd2 Pending,
     * cmd2 result, plan Completed — and each Pending marker lands BEFORE
     * its enqueue side effect.
     */
    expect(update).toHaveBeenCalledTimes(6);
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
    const secondPendingPlan: Record<string, unknown> = persistedPlanAt(
      update,
      3,
    );
    expect(
      (
        commandInPlan(secondPendingPlan, 1)["execution"] as Record<
          string,
          unknown
        >
      )["status"],
    ).toBe("Pending");
    expect(update.mock.invocationCallOrder[3]).toBeLessThan(
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

  it("leaves a Pending command with no runnerJobId alone — it never reached the Runner", async () => {
    const update: jest.SpyInstance = mockPersist();
    const enqueue: jest.SpyInstance = mockEnqueue();
    mockPoll();
    mockFeed();
    const jobLookup: jest.SpyInstance = mockJobLookup(terminalJob());

    await CommandPlanExecutor.executeRollback({
      suggestion: fakeSuggestion({
        commandPlan: rawPlan(
          [
            pendingCommand(1, {
              execution: {
                status: "Pending",
                startedAt: "2026-01-01T00:00:00.000Z",
              },
            }),
          ],
          { executionStatus: "Running" },
        ),
      }),
    });

    expect(jobLookup).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    const finalPlan: Record<string, unknown> = lastPersistedPlan(update);
    expect(
      (commandInPlan(finalPlan, 0)["execution"] as Record<string, unknown>)[
        "status"
      ],
    ).toBe("Pending");
    expect(finalPlan["rollbackStatus"]).toBe("NotApplicable");
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
