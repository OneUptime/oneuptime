import {
  getRemediationPlanFingerprint,
  isRemediationPlanFingerprint,
  REMEDIATION_PLAN_FINGERPRINT_LENGTH,
} from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationDryRunStatus,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { RemediationTrackRecordOutcome } from "../../../../Types/AutoRemediation/RemediationTrackRecord";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - what a fix that waits for approval runs, in sixteen
 * hex digits (Server/Utils/AutoRemediation/RemediationPlanFingerprint), the
 * fingerprint a Slack or Teams press carries:
 *
 *  - two reads of the same fix give the same fingerprint, and it is
 *    sixteen lowercase hex digits;
 *  - anything that decides what runs changes it: a command, its order, its
 *    undo, what it runs on, the kind of fix, a runbook, an MCP change;
 *  - nothing that does not changes it: a dry run's answer, a track record,
 *    a rationale, an execution record, the case of an id;
 *  - only well-formed fingerprints are fingerprints.
 */

const AGENT: string = "aaaaaaaa-1111-4111-8111-111111111111";
const ACCOUNT: string = "bbbbbbbb-2222-4222-8222-222222222222";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

function command(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT,
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: `cloud scale-out ${ECS} --count 8`,
    rollbackCommand: `cloud scale-in ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "tasks at 100% CPU",
    expectedEffect: "latency drops",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function plan(commands: Array<AiRemediationCommand>): JSONObject {
  return AiRemediationCommandPlanUtil.toJSON({ commands });
}

function ofPlan(commands: Array<AiRemediationCommand>): string {
  return getRemediationPlanFingerprint({
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: plan(commands),
  });
}

describe("a fix's fingerprint", () => {
  test("is the same for two reads of the same fix, sixteen hex digits", () => {
    const first: string = ofPlan([command()]);
    const second: string = ofPlan([command()]);

    expect(first).toBe(second);
    expect(first).toHaveLength(REMEDIATION_PLAN_FINGERPRINT_LENGTH);
    expect(isRemediationPlanFingerprint(first)).toBe(true);
  });

  test("changes with anything that decides what runs", () => {
    const base: string = ofPlan([command()]);

    for (const changed of [
      [command({ command: `cloud scale-out ${ECS} --count 9` })],
      [command({ rollbackCommand: undefined })],
      [command({ rollbackCommand: `cloud scale-in ${ECS} --count 3` })],
      [command({ runnerId: "cccccccc-3333-4333-8333-333333333333" })],
      [command({ resourceId: "dddddddd-4444-4444-8444-444444444444" })],
      [command({ resourceType: AiResourceType.AzureSubscription })],
      [command({ sequence: 2 })],
      [
        command(),
        command({ sequence: 2, command: `cloud restart-service ${ECS}` }),
      ],
    ]) {
      expect(ofPlan(changed)).not.toBe(base);
    }
  });

  test("the order of two commands is part of it", () => {
    const restart: AiRemediationCommand = command({
      command: `cloud restart-service ${ECS}`,
      rollbackCommand: undefined,
    });

    expect(
      ofPlan([command({ sequence: 1 }), { ...restart, sequence: 2 }]),
    ).not.toBe(ofPlan([{ ...restart, sequence: 1 }, command({ sequence: 2 })]));
  });

  test("does not change with what never decides what runs", () => {
    const base: string = ofPlan([command()]);

    expect(
      ofPlan([
        command({
          rationale: "another reason",
          expectedEffect: "another effect",
          runnerNameSnapshot: "Renamed agent",
          resourceNameSnapshot: "prod",
          resourceCommandTier: ResourceCommandTier.RiskyWrite,
          dryRun: {
            status: AiRemediationDryRunStatus.WouldRun,
            checkedAt: "2026-11-01T10:00:00.000Z",
            summary: "It would make ecs:UpdateService.",
          },
          trackRecord: {
            workedCount: 2,
            didNotWorkCount: 0,
            runs: [
              {
                subjectKind: "incident",
                subjectId: "eeeeeeee-5555-4555-8555-555555555555",
                ranAt: "2026-10-01T00:00:00.000Z",
                outcome: RemediationTrackRecordOutcome.Worked,
              },
            ],
          },
          execution: {
            status: AiRemediationCommandExecutionStatus.Running,
          },
        }),
      ]),
    ).toBe(base);
  });

  test("an id's case does not change it", () => {
    expect(
      ofPlan([
        command({
          runnerId: AGENT.toUpperCase(),
          resourceId: ACCOUNT.toUpperCase(),
        }),
      ]),
    ).toBe(ofPlan([command()]));
  });

  test("a runbook fix is its runbook; another runbook is another fix", () => {
    const runbook: string = getRemediationPlanFingerprint({
      suggestionType: AutoRemediationSuggestionType.Runbook,
      runbookId: new ObjectID("ffffffff-6666-4666-8666-666666666666"),
    });

    expect(runbook).not.toBe(
      getRemediationPlanFingerprint({
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookId: new ObjectID("ffffffff-7777-4777-8777-777777777777"),
      }),
    );
    expect(runbook).toBe(
      getRemediationPlanFingerprint({
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookId: new ObjectID("FFFFFFFF-6666-4666-8666-666666666666"),
      }),
    );
  });

  test("the kind of fix is part of it", () => {
    expect(
      getRemediationPlanFingerprint({
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        commandPlan: plan([command()]),
      }),
    ).not.toBe(
      getRemediationPlanFingerprint({
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        commandPlan: plan([command()]),
      }),
    );
  });

  test("a fix through MCP servers is the changes it proposes", () => {
    function call(
      overrides: Partial<ExternalMcpToolCall> = {},
    ): ExternalMcpToolCall {
      return {
        sequence: 1,
        serverId: "12121212-1212-4121-8121-121212121212",
        serverNameSnapshot: "Feature flags",
        toolName: "set_flag",
        arguments: { flag: "checkout-db-pool-v2", enabled: false },
        status: ExternalMcpToolCallStatus.Proposed,
        ...overrides,
      };
    }

    function ofCalls(calls: Array<ExternalMcpToolCall>): string {
      return getRemediationPlanFingerprint({
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({ calls }),
      });
    }

    const base: string = ofCalls([call()]);

    expect(ofCalls([call()])).toBe(base);
    expect(
      ofCalls([
        call({ arguments: { flag: "checkout-db-pool-v2", enabled: true } }),
      ]),
    ).not.toBe(base);
    expect(ofCalls([call({ toolName: "delete_flag" })])).not.toBe(base);
    // What a server answered never changes what was proposed.
    expect(ofCalls([call({ resultText: "ok" })])).toBe(base);
  });

  test("a plan that cannot be read still has a fingerprint, its own", () => {
    const unreadable: string = getRemediationPlanFingerprint({
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      commandPlan: { commands: "nonsense" } as unknown as JSONObject,
    });

    expect(isRemediationPlanFingerprint(unreadable)).toBe(true);
    expect(unreadable).not.toBe(ofPlan([command()]));
  });
});

describe("what is a fingerprint", () => {
  test("only sixteen lowercase hex digits", () => {
    for (const value of ["0123456789abcdef", "ffffffffffffffff"]) {
      expect(isRemediationPlanFingerprint(value)).toBe(true);
    }

    for (const value of [
      "0123456789ABCDEF",
      "0123456789abcde",
      "0123456789abcdef0",
      "0123456789abcdeg",
      "",
      undefined,
      null,
      16,
    ]) {
      expect(isRemediationPlanFingerprint(value)).toBe(false);
    }
  });
});
