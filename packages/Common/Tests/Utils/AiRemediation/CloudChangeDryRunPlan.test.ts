import {
  CLOUD_DRY_RUN_STALE_AFTER_MS,
  getCloudChangesToDryRun,
  getCloudDryRunCommandText,
  getEffectiveDryRunStatus,
  isCloudDryRunInFlight,
  readCloudDryRunChange,
} from "../../../Utils/AiRemediation/CloudChangeDryRunPlan";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationDryRunStatus,
  DRY_RUN_COMMAND_STEP_ID_PREFIX,
  MAX_DRY_RUN_SUMMARY_CHARS,
  getDryRunCommandStepId,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — what the dry runs of a fix's cloud changes read off
 * its plan (Utils/AiRemediation/CloudChangeDryRunPlan), the same way on the
 * server that runs them and on the card that shows them, and how a plan
 * keeps a dry run (AiRemediationCommandPlanUtil):
 *
 *  - the dry run of a change is "cloud dry-run" and the change's canonical
 *    argv; nothing else (a read, whoami, a dry run, another resource's
 *    command, nonsense) has one;
 *  - the change a dry run checks is read back with its own tier;
 *  - only cloud changes that have not run are dry-run, at most five;
 *  - a Running dry run older than five minutes reads as Failed;
 *  - a stored dry run survives the plan's parse; a malformed one is dropped
 *    (a fact, never what decides a run), and its summary is capped;
 *  - its step id prefix is its own.
 */

const ACCOUNT_ID: string = "11111111-1111-4111-8111-111111111111";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

function cloudStep(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: "22222222-2222-4222-8222-222222222222",
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60_000,
    rationale: "more tasks",
    expectedEffect: "latency drops",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function plan(commands: Array<AiRemediationCommand>): AiRemediationCommandPlan {
  return { commands };
}

describe("the dry run of a change", () => {
  test("is cloud dry-run and the change's canonical argv", () => {
    expect(
      getCloudDryRunCommandText({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count=4`,
      }),
    ).toBe(`cloud dry-run scale-out ${ECS} --count 4`);
  });

  test("nothing but a change of the resource's own cloud has one", () => {
    for (const [resourceType, command] of [
      [AiResourceType.AwsAccount, `cloud describe ${ECS}`],
      [AiResourceType.AwsAccount, "cloud whoami"],
      [AiResourceType.AwsAccount, `cloud dry-run scale-out ${ECS} --count 4`],
      [AiResourceType.AwsAccount, "docker restart web"],
      [AiResourceType.AwsAccount, "cloud scale-out not-an-arn --count 4"],
      [AiResourceType.AzureSubscription, `cloud scale-out ${ECS} --count 4`],
      [AiResourceType.DockerHost, "docker restart web"],
      ["NotAType", `cloud scale-out ${ECS} --count 4`],
    ] as Array<[unknown, string]>) {
      expect(getCloudDryRunCommandText({ resourceType, command })).toBeNull();
    }
  });

  test("the change a dry run checks reads back with its own tier", () => {
    expect(
      readCloudDryRunChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud dry-run scale-in ${ECS} --count 1`,
      }),
    ).toEqual({
      command: `cloud scale-in ${ECS} --count 1`,
      tier: ResourceCommandTier.RiskyWrite,
    });
    expect(
      readCloudDryRunChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    ).toBeNull();
    expect(
      readCloudDryRunChange({
        resourceType: AiResourceType.DockerHost,
        command: "docker ps",
      }),
    ).toBeNull();
  });
});

describe("which steps of a plan are dry-run", () => {
  test("cloud changes that have not run, in order, at most five", () => {
    const steps: Array<AiRemediationCommand> = [1, 2, 3, 4, 5].map(
      (sequence: number): AiRemediationCommand => {
        return cloudStep({ sequence });
      },
    );

    expect(
      getCloudChangesToDryRun(plan(steps)).map(
        (step: AiRemediationCommand): number => {
          return step.sequence;
        },
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("never a read, a step that ran, another kind of resource or a step without its account", () => {
    const steps: Array<AiRemediationCommand> = [
      cloudStep({
        sequence: 1,
        command: `cloud describe ${ECS}`,
        resourceCommandTier: ResourceCommandTier.Read,
      }),
      cloudStep({
        sequence: 2,
        execution: {
          status: AiRemediationCommandExecutionStatus.Succeeded,
        },
      }),
      cloudStep({
        sequence: 3,
        resourceType: AiResourceType.DockerHost,
        command: "docker restart web",
      }),
      cloudStep({ sequence: 4, resourceId: "not-a-uuid" }),
      cloudStep({ sequence: 5, stepType: RunbookStepType.Bash }),
    ];

    expect(getCloudChangesToDryRun(plan(steps))).toEqual([]);
    expect(getCloudChangesToDryRun(null)).toEqual([]);
  });
});

describe("a dry run's status as it reads now", () => {
  test("an answer is what it is", () => {
    for (const status of [
      AiRemediationDryRunStatus.WouldRun,
      AiRemediationDryRunStatus.WouldBeRefused,
      AiRemediationDryRunStatus.Failed,
    ]) {
      expect(
        getEffectiveDryRunStatus(
          { status, checkedAt: "2026-01-01T00:00:00.000Z" },
          NOW,
        ),
      ).toBe(status);
    }
  });

  test("Running while it is fresh; Failed past five minutes: it will not answer", () => {
    const fresh: string = new Date(
      NOW.getTime() - CLOUD_DRY_RUN_STALE_AFTER_MS + 1000,
    ).toISOString();
    const stale: string = new Date(
      NOW.getTime() - CLOUD_DRY_RUN_STALE_AFTER_MS - 1000,
    ).toISOString();

    expect(CLOUD_DRY_RUN_STALE_AFTER_MS).toBe(5 * 60_000);
    expect(
      getEffectiveDryRunStatus(
        { status: AiRemediationDryRunStatus.Running, checkedAt: fresh },
        NOW,
      ),
    ).toBe(AiRemediationDryRunStatus.Running);
    expect(
      getEffectiveDryRunStatus(
        { status: AiRemediationDryRunStatus.Running, checkedAt: stale },
        NOW,
      ),
    ).toBe(AiRemediationDryRunStatus.Failed);
  });

  test("a plan is in flight while one of its changes' dry runs is fresh and Running", () => {
    const running: AiRemediationCommand = cloudStep({
      dryRun: {
        status: AiRemediationDryRunStatus.Running,
        checkedAt: NOW.toISOString(),
      },
    });
    const answered: AiRemediationCommand = cloudStep({
      dryRun: {
        status: AiRemediationDryRunStatus.WouldRun,
        checkedAt: NOW.toISOString(),
      },
    });

    expect(isCloudDryRunInFlight(plan([running]), NOW)).toBe(true);
    expect(isCloudDryRunInFlight(plan([answered]), NOW)).toBe(false);
    expect(isCloudDryRunInFlight(plan([cloudStep()]), NOW)).toBe(false);
    expect(
      isCloudDryRunInFlight(
        plan([running]),
        new Date(NOW.getTime() + CLOUD_DRY_RUN_STALE_AFTER_MS + 1),
      ),
    ).toBe(false);
    expect(isCloudDryRunInFlight(null, NOW)).toBe(false);
  });
});

describe("a plan keeps a step's dry run", () => {
  function roundTrip(dryRun: unknown): AiRemediationCommand | undefined {
    const stored: JSONObject = AiRemediationCommandPlanUtil.toJSON(
      plan([cloudStep()]),
    );
    ((stored["commands"] as Array<JSONObject>)[0] as JSONObject)["dryRun"] =
      dryRun as JSONObject;

    return AiRemediationCommandPlanUtil.parse(stored)?.commands[0];
  }

  test("a well-formed one survives the parse", () => {
    const step: AiRemediationCommand | undefined = roundTrip({
      status: "WouldRun",
      checkedAt: NOW.toISOString(),
      summary: "It would make ecs:UpdateService, and nothing else.",
      replaced: { count: "2" },
      runnerJobId: "33333333-3333-4333-8333-333333333333",
    });

    expect(step?.dryRun).toEqual({
      status: AiRemediationDryRunStatus.WouldRun,
      checkedAt: NOW.toISOString(),
      summary: "It would make ecs:UpdateService, and nothing else.",
      replaced: { count: "2" },
      runnerJobId: "33333333-3333-4333-8333-333333333333",
    });
  });

  test("a malformed one is dropped, never the plan", () => {
    for (const bad of [
      { status: "Maybe", checkedAt: NOW.toISOString() },
      { status: "WouldRun" },
      { status: "WouldRun", checkedAt: "" },
      "WouldRun",
      ["WouldRun"],
      null,
    ]) {
      const step: AiRemediationCommand | undefined = roundTrip(bad);

      expect(step).toBeDefined();
      expect(step?.dryRun).toBeUndefined();
    }
  });

  test("its summary is capped; its replaced value keeps short strings only", () => {
    const step: AiRemediationCommand | undefined = roundTrip({
      status: "WouldBeRefused",
      checkedAt: NOW.toISOString(),
      summary: "x".repeat(MAX_DRY_RUN_SUMMARY_CHARS + 500),
      replaced: { count: "2", nested: { a: 1 }, ["k".repeat(40)]: "v" },
    });

    expect(step?.dryRun?.summary?.length).toBe(MAX_DRY_RUN_SUMMARY_CHARS);
    expect(step?.dryRun?.replaced).toEqual({ count: "2" });
  });

  test("its step id prefix is its own, never a forward change's or a rollback's", () => {
    expect(DRY_RUN_COMMAND_STEP_ID_PREFIX).toBe("ai-dry-run-");
    expect(getDryRunCommandStepId({ sequence: 3 })).toBe("ai-dry-run-3");
    expect("ai-dry-run-3".startsWith("ai-command-")).toBe(false);
    expect("ai-dry-run-3".startsWith("ai-approved-")).toBe(false);
    expect("ai-dry-run-3".startsWith("ai-rollback-")).toBe(false);
  });
});
