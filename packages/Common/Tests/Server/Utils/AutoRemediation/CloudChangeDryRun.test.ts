import CloudChangeDryRun, {
  CLOUD_DRY_RUN_CLAIM_TIMEOUT_MS,
  CLOUD_DRY_RUN_TIMEOUT_MS,
  CloudDryRunOutcome,
  OLD_AGENT_DRY_RUN_SUMMARY,
  readCloudDryRunOutcome,
} from "../../../../Server/Utils/AutoRemediation/CloudChangeDryRun";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ResourceCommandJobRunner, {
  ResourceCommandJobOutcome,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationDryRunStatus,
  MAX_DRY_RUN_SUMMARY_CHARS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import {
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — CloudChangeDryRun, the dry runs OneUptime asks for
 * before a person approves a fix that changes a cloud account:
 *
 *  - only a suggestion that waits for approval (Suggested, a command plan)
 *    is dry-run, and only its cloud changes that have not run;
 *  - every change says it is being checked first (one write), then each
 *    answer lands on its own step as it comes (one write each);
 *  - every write is conditional on the suggestion still waiting
 *    (Suggested -> Suggested): an approval or a dismissal in between wins,
 *    the dry run stops and asks the agent nothing more;
 *  - each change is one job of the fix: origin AiRemediation, the
 *    suggestion, step id ai-dry-run-<n>, `cloud dry-run <change>`, the
 *    plan's agent, a bounded wait;
 *  - the agent's answer is read into would run (with what it would
 *    replace), would be refused (with why) or could not finish - including
 *    an agent older than dry runs, which is told to update;
 *  - one dry run of a suggestion at a time (a lock), and it never throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10101010-1010-4010-8010-101010101010",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "20202020-2020-4020-8020-202020202020",
);
const ACCOUNT_ID: string = "30303030-3030-4030-8030-303030303030";
const AGENT_ID: string = "40404040-4040-4040-8040-404040404040";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const ASG: string =
  "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:0e9d8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b:autoScalingGroupName/web-asg";

function cloudStep(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 120_000,
    rationale: "more tasks",
    expectedEffect: "latency drops",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function suggestion(
  commands: Array<AiRemediationCommand>,
  overrides: Partial<AutoRemediationSuggestion> = {},
): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row.id = SUGGESTION_ID;
  row.projectId = PROJECT_ID;
  row.status = AutoRemediationSuggestionStatus.Suggested;
  row.suggestionType = AutoRemediationSuggestionType.CommandPlan;
  row.commandPlan = AiRemediationCommandPlanUtil.toJSON({ commands });
  Object.assign(row, overrides);
  return row;
}

function outcome(
  overrides: Partial<ResourceCommandJobOutcome> = {},
): ResourceCommandJobOutcome {
  return {
    jobId: "50505050-5050-4050-8050-505050505050",
    succeeded: true,
    exitCode: 0,
    output: "",
    displayCommand: "cloud dry-run",
    executed: true,
    ...overrides,
  };
}

function wouldRunOutput(command: string, count: string): string {
  return [
    formatCloudDryRunVerdict("would-run"),
    formatCloudReplacedValue({ count }),
    `Dry run: nothing was changed. ${command} would run, replacing count ${count}.`,
    "It would make ecs:UpdateService with desiredCount, and nothing else.",
    `To undo it: cloud scale-in ${ECS} --count ${count}`,
  ].join("\n");
}

describe("CloudChangeDryRun.dryRunSuggestion", () => {
  let stored: AutoRemediationSuggestion | null;
  let writes: Array<{ fromStatus: string; set: JSONObject }>;
  let runJob: jest.SpyInstance;
  let lock: jest.SpyInstance;
  let release: jest.SpyInstance;
  let casResult: () => number;

  function storedPlan(): AiRemediationCommandPlan {
    return AiRemediationCommandPlanUtil.parse(stored!.commandPlan)!;
  }

  beforeEach(() => {
    writes = [];
    casResult = (): number => {
      return 1;
    };
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    lock = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as unknown as never);
    release = jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation(
        async (): Promise<AutoRemediationSuggestion | null> => {
          return stored
            ? (Object.assign(
                new AutoRemediationSuggestion(),
                stored,
              ) as AutoRemediationSuggestion)
            : null;
        },
      );
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockImplementation(
        async (data: {
          fromStatus: AutoRemediationSuggestionStatus;
          set: Record<string, unknown>;
        }): Promise<number> => {
          const affected: number = casResult();

          writes.push({
            fromStatus: data.fromStatus,
            set: data.set as unknown as JSONObject,
          });

          if (affected > 0 && stored && data.set["commandPlan"]) {
            stored.commandPlan = data.set["commandPlan"] as JSONObject;
          }

          return affected;
        },
      );
    runJob = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockImplementation(
        async (data: {
          command: string;
        }): Promise<ResourceCommandJobOutcome> => {
          return outcome({
            output: wouldRunOutput(data.command.replace("dry-run ", ""), "2"),
          });
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("dry-runs each cloud change as one job of the fix, and writes would-run with what it would replace", async () => {
    stored = suggestion([cloudStep()]);

    const result: CloudDryRunOutcome = await CloudChangeDryRun.dryRunSuggestion(
      { suggestionId: SUGGESTION_ID },
    );

    expect(result).toEqual({ kind: "checked", checked: 1 });
    expect(runJob).toHaveBeenCalledTimes(1);

    const job: Record<string, unknown> = runJob.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect((job["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(job["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect((job["autoRemediationSuggestionId"] as ObjectID).toString()).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(job["resourceType"]).toBe(AiResourceType.AwsAccount);
    expect((job["resourceId"] as ObjectID).toString()).toBe(ACCOUNT_ID);
    expect((job["targetResourceAiAgentId"] as ObjectID).toString()).toBe(
      AGENT_ID,
    );
    expect(job["command"]).toBe(`cloud dry-run scale-out ${ECS} --count 4`);
    expect(job["stepId"]).toBe("ai-dry-run-1");
    expect(job["timeoutInMs"]).toBe(CLOUD_DRY_RUN_TIMEOUT_MS);
    expect(job["claimTimeoutInMs"]).toBe(CLOUD_DRY_RUN_CLAIM_TIMEOUT_MS);
    expect(job["aiRunId"]).toBeUndefined();

    const dryRun: AiRemediationCommand["dryRun"] =
      storedPlan().commands[0]!.dryRun;

    expect(dryRun?.status).toBe(AiRemediationDryRunStatus.WouldRun);
    expect(dryRun?.replaced).toEqual({ count: "2" });
    // The card says the first sentence itself: the agent's lines after it.
    expect(dryRun?.summary).toBe(
      `It would make ecs:UpdateService with desiredCount, and nothing else.\nTo undo it: cloud scale-in ${ECS} --count 2`,
    );
    expect(dryRun?.runnerJobId).toBe("50505050-5050-4050-8050-505050505050");
    expect(lock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("says every change is being checked before it checks any, then writes each answer as it comes", async () => {
    stored = suggestion([
      cloudStep({ sequence: 1 }),
      cloudStep({ sequence: 2, command: `cloud scale-out ${ASG} --count 5` }),
    ]);

    const seenBeforeFirstJob: Array<unknown> = [];

    runJob.mockImplementation(
      async (data: { command: string }): Promise<ResourceCommandJobOutcome> => {
        if (seenBeforeFirstJob.length === 0) {
          seenBeforeFirstJob.push(
            storedPlan().commands.map((command: AiRemediationCommand) => {
              return command.dryRun?.status;
            }),
          );
        }

        return outcome({
          output: wouldRunOutput(data.command.replace("dry-run ", ""), "3"),
        });
      },
    );

    await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID });

    expect(seenBeforeFirstJob[0]).toEqual([
      AiRemediationDryRunStatus.Running,
      AiRemediationDryRunStatus.Running,
    ]);
    // One write marking both, then one per answer.
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.fromStatus).toBe(AutoRemediationSuggestionStatus.Suggested);
      expect(write.set["status"]).toBe(
        AutoRemediationSuggestionStatus.Suggested,
      );
    }
    expect(
      runJob.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as Record<string, unknown>)["stepId"];
      }),
    ).toEqual(["ai-dry-run-1", "ai-dry-run-2"]);
    expect(
      storedPlan().commands.map((command: AiRemediationCommand) => {
        return command.dryRun?.status;
      }),
    ).toEqual([
      AiRemediationDryRunStatus.WouldRun,
      AiRemediationDryRunStatus.WouldRun,
    ]);
  });

  it("would be refused: only the agent's reason is kept", async () => {
    stored = suggestion([cloudStep()]);
    runJob.mockResolvedValue(
      outcome({
        output: [
          formatCloudDryRunVerdict("would-be-refused"),
          `Dry run: nothing was changed. cloud scale-out ${ECS} --count 4 would be refused: --count 4 is above 3, the most the ECS service may run.`,
        ].join("\n"),
      }),
    );

    await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID });

    expect(storedPlan().commands[0]!.dryRun).toMatchObject({
      status: AiRemediationDryRunStatus.WouldBeRefused,
      summary: "--count 4 is above 3, the most the ECS service may run.",
    });
  });

  it("an agent older than dry runs could not finish, and is told to update", async () => {
    stored = suggestion([cloudStep()]);
    runJob.mockResolvedValue(
      outcome({
        succeeded: false,
        exitCode: undefined,
        output: "",
        errorMessage:
          'Refused by the Cloud AI agent: its cloud catalog refuses "cloud dry-run scale-out ...": "dry-run" is not a cloud operation; the operations on AWS are describe, ...',
      }),
    );

    await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID });

    expect(storedPlan().commands[0]!.dryRun).toMatchObject({
      status: AiRemediationDryRunStatus.Failed,
      summary: OLD_AGENT_DRY_RUN_SUMMARY,
    });
  });

  it("a dry run the chokepoint refuses (Enable AI, fixes, the agent, the inventory) could not finish, with why", async () => {
    stored = suggestion([cloudStep()]);
    runJob.mockRejectedValue(
      new BadDataException(
        'AWS account "prod" has no online Cloud AI agent, so this command was not enqueued.',
      ),
    );

    const result: CloudDryRunOutcome = await CloudChangeDryRun.dryRunSuggestion(
      { suggestionId: SUGGESTION_ID },
    );

    expect(result).toEqual({ kind: "checked", checked: 1 });
    expect(storedPlan().commands[0]!.dryRun).toMatchObject({
      status: AiRemediationDryRunStatus.Failed,
      summary:
        'AWS account "prod" has no online Cloud AI agent, so this command was not enqueued.',
    });
  });

  it("an approval in between wins: the answer is dropped and nothing more is asked", async () => {
    stored = suggestion([
      cloudStep({ sequence: 1 }),
      cloudStep({ sequence: 2, command: `cloud scale-out ${ASG} --count 5` }),
    ]);

    let write: number = 0;

    casResult = (): number => {
      write++;
      // The marking write lands; the suggestion is approved before the first answer.
      return write === 1 ? 1 : 0;
    };
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation(
        async (): Promise<AutoRemediationSuggestion | null> => {
          // The answer's re-read finds it approved after the first job.
          return runJob.mock.calls.length > 0
            ? suggestion([cloudStep()], {
                status: AutoRemediationSuggestionStatus.Approved,
              })
            : (Object.assign(
                new AutoRemediationSuggestion(),
                stored,
              ) as AutoRemediationSuggestion);
        },
      );

    const result: CloudDryRunOutcome = await CloudChangeDryRun.dryRunSuggestion(
      { suggestionId: SUGGESTION_ID },
    );

    expect(result).toEqual({ kind: "not-awaiting-approval" });
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a suggestion that no longer waits for approval", async () => {
    for (const status of [
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.Planning,
      AutoRemediationSuggestionStatus.AutoExecuted,
    ]) {
      stored = suggestion([cloudStep()], { status });

      expect(
        await CloudChangeDryRun.dryRunSuggestion({
          suggestionId: SUGGESTION_ID,
        }),
      ).toEqual({ kind: "not-awaiting-approval" });
    }

    stored = null;

    expect(
      await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID }),
    ).toEqual({ kind: "not-awaiting-approval" });
    expect(runJob).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("a fix with no cloud change to check has nothing to dry-run", async () => {
    stored = suggestion([
      cloudStep({
        resourceType: AiResourceType.DockerHost,
        command: "docker restart web",
      }),
      cloudStep({
        sequence: 2,
        execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
      }),
    ]);

    expect(
      await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID }),
    ).toEqual({ kind: "nothing-to-check" });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("one at a time: while another dry run holds the suggestion, it is busy and reads nothing", async () => {
    stored = suggestion([cloudStep()]);
    lock.mockRejectedValue(new Error("lock held"));

    expect(
      await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID }),
    ).toEqual({ kind: "busy" });
    expect(runJob).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect((lock.mock.calls[0]![0] as Record<string, unknown>)["key"]).toBe(
      `cloud-dry-run-${SUGGESTION_ID.toString()}`,
    );
    expect(
      (lock.mock.calls[0]![0] as Record<string, unknown>)[
        "acquireAttemptsLimit"
      ],
    ).toBe(1);
  });

  it("writes an answer only onto its own step: another step, or one that ran meanwhile, keeps what it holds", async () => {
    stored = suggestion([
      cloudStep({ sequence: 1 }),
      cloudStep({
        sequence: 2,
        resourceType: AiResourceType.DockerHost,
        command: "docker restart web",
      }),
    ]);
    runJob.mockImplementation(async (): Promise<ResourceCommandJobOutcome> => {
      // The first step ran meanwhile (a stale page approved it another way).
      const plan: AiRemediationCommandPlan = storedPlan();
      plan.commands[0]!.execution = {
        status: AiRemediationCommandExecutionStatus.Running,
      };
      stored!.commandPlan = AiRemediationCommandPlanUtil.toJSON(plan);

      return outcome({
        output: wouldRunOutput(`cloud scale-out ${ECS} --count 4`, "2"),
      });
    });

    await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID });

    const commands: Array<AiRemediationCommand> = storedPlan().commands;

    // Still the Running mark from before it ran: the answer was not written onto it.
    expect(commands[0]!.dryRun?.status).toBe(AiRemediationDryRunStatus.Running);
    expect(commands[0]!.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Running,
    );
    expect(commands[1]!.dryRun).toBeUndefined();
  });

  it("never throws: a failure is logged and the lock given back", async () => {
    stored = suggestion([cloudStep()]);
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockRejectedValue(new Error("database down"));

    expect(
      await CloudChangeDryRun.dryRunSuggestion({ suggestionId: SUGGESTION_ID }),
    ).toEqual({ kind: "checked", checked: 0 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  /*
   * Dry run again: the route answers once the changes are marked, so the
   * card's read right after the click shows the dry run on its way (and
   * polls) - never the plan as it was before the click.
   */
  describe("startDryRun", () => {
    // Lets the background dry runs move on as far as they can.
    async function settle(): Promise<void> {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }

    it("answers once every change is marked as being checked; the answers land after, and then the lock is given back", async () => {
      stored = suggestion([
        cloudStep({
          sequence: 1,
          dryRun: {
            status: AiRemediationDryRunStatus.Failed,
            checkedAt: "2026-10-29T09:00:00.000Z",
            summary: "The Cloud AI agent did not pick up the command in time.",
          },
        }),
        cloudStep({ sequence: 2, command: `cloud scale-out ${ASG} --count 5` }),
      ]);

      const answers: Array<(value: ResourceCommandJobOutcome) => void> = [];

      runJob.mockImplementation(
        (data: { command: string }): Promise<ResourceCommandJobOutcome> => {
          return new Promise<ResourceCommandJobOutcome>(
            (resolve: (value: ResourceCommandJobOutcome) => void): void => {
              answers.push((value: ResourceCommandJobOutcome): void => {
                resolve({
                  ...value,
                  output: wouldRunOutput(
                    data.command.replace("dry-run ", ""),
                    "3",
                  ),
                });
              });
            },
          );
        },
      );

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "started", changes: 2 });

      // What a read right after the answer sees: both on their way, the old answer gone.
      expect(
        storedPlan().commands.map((command: AiRemediationCommand) => {
          return command.dryRun?.status;
        }),
      ).toEqual([
        AiRemediationDryRunStatus.Running,
        AiRemediationDryRunStatus.Running,
      ]);
      expect(storedPlan().commands[0]!.dryRun?.summary).toBeUndefined();
      expect(writes).toHaveLength(1);
      // The first change is with its agent; the lock is still held.
      expect(runJob).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();

      answers[0]!(outcome());
      await settle();
      expect(runJob).toHaveBeenCalledTimes(2);
      expect(storedPlan().commands[0]!.dryRun?.status).toBe(
        AiRemediationDryRunStatus.WouldRun,
      );
      expect(release).not.toHaveBeenCalled();

      answers[1]!(outcome());
      await settle();
      expect(
        storedPlan().commands.map((command: AiRemediationCommand) => {
          return command.dryRun?.status;
        }),
      ).toEqual([
        AiRemediationDryRunStatus.WouldRun,
        AiRemediationDryRunStatus.WouldRun,
      ]);
      expect(writes).toHaveLength(3);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("busy while another dry run holds the suggestion: it marked the changes already, so nothing is written", async () => {
      stored = suggestion([cloudStep()]);
      lock.mockRejectedValue(new Error("lock held"));

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "busy" });
      expect(writes).toHaveLength(0);
      expect(runJob).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    });

    it("starts nothing for a fix that no longer waits for approval, or has no cloud change, and gives the lock back", async () => {
      stored = suggestion([cloudStep()], {
        status: AutoRemediationSuggestionStatus.Approved,
      });

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "not-awaiting-approval" });

      stored = suggestion([
        cloudStep({
          resourceType: AiResourceType.DockerHost,
          command: "docker restart web",
        }),
      ]);

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "nothing-to-check" });

      // Approved between the read and the mark: the mark is refused.
      stored = suggestion([cloudStep()]);
      casResult = (): number => {
        return 0;
      };

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "not-awaiting-approval" });

      expect(runJob).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(3);
    });

    it("a suggestion it cannot read is an error for the route, and the lock is given back", async () => {
      stored = suggestion([cloudStep()]);
      jest
        .spyOn(AutoRemediationSuggestionService, "findOneById")
        .mockRejectedValue(new Error("database down"));

      await expect(
        CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).rejects.toThrow("database down");
      expect(runJob).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("a failure in the background is logged, never thrown, and the lock is given back", async () => {
      stored = suggestion([cloudStep()]);
      const logged: jest.SpyInstance = jest.spyOn(logger, "error");
      let write: number = 0;

      jest
        .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
        .mockImplementation(
          async (data: { set: Record<string, unknown> }): Promise<number> => {
            write++;

            if (write > 1) {
              throw new Error("database down");
            }

            stored!.commandPlan = data.set["commandPlan"] as JSONObject;
            return 1;
          },
        );

      expect(
        await CloudChangeDryRun.startDryRun({ suggestionId: SUGGESTION_ID }),
      ).toEqual({ kind: "started", changes: 1 });

      await settle();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("database down"),
      );
      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});

describe("CloudChangeDryRun.startForProposedPlan", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts in the background only for a plan with a cloud change to check", async () => {
    const dryRun: jest.SpyInstance = jest
      .spyOn(CloudChangeDryRun, "dryRunSuggestion")
      .mockResolvedValue({ kind: "checked", checked: 1 });

    CloudChangeDryRun.startForProposedPlan({
      suggestionId: SUGGESTION_ID,
      plan: {
        commands: [
          cloudStep({
            resourceType: AiResourceType.DockerHost,
            command: "docker restart web",
          }),
        ],
      },
    });
    CloudChangeDryRun.startForProposedPlan({
      suggestionId: SUGGESTION_ID,
      plan: null,
    });

    expect(dryRun).not.toHaveBeenCalled();

    CloudChangeDryRun.startForProposedPlan({
      suggestionId: SUGGESTION_ID,
      plan: { commands: [cloudStep()] },
    });

    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(
      (dryRun.mock.calls[0]![0] as { suggestionId: ObjectID }).suggestionId,
    ).toBe(SUGGESTION_ID);
  });

  it("a dry run that fails is logged, never thrown", async () => {
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    jest
      .spyOn(CloudChangeDryRun, "dryRunSuggestion")
      .mockRejectedValue(new Error("boom"));

    expect(() => {
      CloudChangeDryRun.startForProposedPlan({
        suggestionId: SUGGESTION_ID,
        plan: { commands: [cloudStep()] },
      });
    }).not.toThrow();

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(logged).toHaveBeenCalled();
  });
});

describe("readCloudDryRunOutcome", () => {
  const CHECKED_AT: Date = new Date("2026-10-29T12:00:00.000Z");

  it("an answer without a verdict could not finish: the agent and the server disagree", () => {
    expect(
      readCloudDryRunOutcome({
        outcome: outcome({ output: "Cloud: AWS\nAccount: 123456789012" }),
        checkedAt: CHECKED_AT,
      }),
    ).toEqual({
      status: AiRemediationDryRunStatus.Failed,
      checkedAt: CHECKED_AT.toISOString(),
      summary:
        "The Cloud AI agent answered without a dry run's verdict. Run the agent image version that matches your OneUptime server.",
      runnerJobId: "50505050-5050-4050-8050-505050505050",
    });
  });

  it("a would-run answer that replaces nothing keeps no replaced value", () => {
    const read: ReturnType<typeof readCloudDryRunOutcome> =
      readCloudDryRunOutcome({
        outcome: outcome({
          output: [
            formatCloudDryRunVerdict("would-run"),
            formatCloudReplacedValue({}),
            `Dry run: nothing was changed. cloud restart-service ${ECS} would run.`,
            "Nothing to undo: the same version runs again.",
          ].join("\n"),
        }),
        checkedAt: CHECKED_AT,
      });

    expect(read.status).toBe(AiRemediationDryRunStatus.WouldRun);
    expect(read.replaced).toBeUndefined();
    expect(read.summary).toBe("Nothing to undo: the same version runs again.");
  });

  it("a failure without words says the dry run did not finish; a long answer is capped at a line", () => {
    expect(
      readCloudDryRunOutcome({
        outcome: outcome({ succeeded: false, output: "" }),
        checkedAt: CHECKED_AT,
      }).summary,
    ).toBe("The dry run did not finish.");

    const long: ReturnType<typeof readCloudDryRunOutcome> =
      readCloudDryRunOutcome({
        outcome: outcome({
          output: [
            formatCloudDryRunVerdict("would-be-refused"),
            `Dry run: nothing was changed. cloud scale-out ${ECS} --count 4 would be refused: first`,
            ...Array.from(
              { length: 200 },
              (_: unknown, index: number): string => {
                return `line ${index} ${"y".repeat(20)}`;
              },
            ),
          ].join("\n"),
        }),
        checkedAt: CHECKED_AT,
      });

    expect(long.summary!.length).toBeLessThanOrEqual(MAX_DRY_RUN_SUMMARY_CHARS);
    expect(long.summary!.startsWith("first\nline 0 ")).toBe(true);
    expect(long.summary!.endsWith("…")).toBe(true);
  });
});
