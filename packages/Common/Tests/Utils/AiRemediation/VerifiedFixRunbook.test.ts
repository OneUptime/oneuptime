import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import {
  BashStepConfig,
  RunbookStep,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  buildVerifiedFixRunbook,
  getSucceededCommands,
  getUniqueRunbookName,
  getVerifiedFixRunbookRefusal,
  MAX_VERIFIED_FIX_STEP_TITLE_LENGTH,
  VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES,
  VerifiedFixRunbookDraft,
  VerifiedFixRunbookInput,
  VerifiedFixRunbookRefusal,
} from "../../../Utils/AiRemediation/VerifiedFixRunbook";
import { getVerifiedFixRunbookOffer } from "../../../Utils/Suggestions/VerifiedFixRunbookSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { describe, expect, test } from "@jest/globals";

/*
 * A verified fix, written down as a runbook (#6801): which fixes may be
 * saved, what each step of theirs becomes, what the runbook is called and
 * says, and when the fix's card offers it.
 */

const RUNNER_ID: string = ObjectID.generate().toString();
const CLUSTER_ID: string = ObjectID.generate().toString();
const RESOURCE_ID: string = ObjectID.generate().toString();

const command: (
  overrides: Partial<AiRemediationCommand>,
) => AiRemediationCommand = (
  overrides: Partial<AiRemediationCommand>,
): AiRemediationCommand => {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: RUNNER_ID,
    runnerNameSnapshot: "web-runner",
    command: "systemctl restart nginx",
    timeoutInMs: 30000,
    rationale: "nginx stopped answering after the config reload",
    expectedEffect: "nginx answers on port 443 again",
    policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
    execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
    ...overrides,
  };
};

const mcpCall: (
  overrides: Partial<ExternalMcpToolCall>,
) => ExternalMcpToolCall = (
  overrides: Partial<ExternalMcpToolCall>,
): ExternalMcpToolCall => {
  return {
    sequence: 1,
    serverId: ObjectID.generate().toString(),
    serverNameSnapshot: "AWS",
    toolName: "update_ecs_service",
    arguments: { service: "checkout-api", desiredCount: 8 },
    status: ExternalMcpToolCallStatus.Succeeded,
    ...overrides,
  };
};

const input: (
  overrides: Partial<VerifiedFixRunbookInput>,
) => VerifiedFixRunbookInput = (
  overrides: Partial<VerifiedFixRunbookInput>,
): VerifiedFixRunbookInput => {
  return {
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationStatus: AutoRemediationVerificationStatus.Verified,
    commandPlan: { commands: [command({})] },
    mcpToolCallPlan: null,
    subject: {
      kind: "incident",
      handle: "#42",
      title: "Checkout returns 503s",
    },
    ...overrides,
  };
};

describe("which fixes may be saved as a runbook", () => {
  test("a verified fix of commands that ran may", () => {
    expect(getVerifiedFixRunbookRefusal(input({}))).toBeNull();
  });

  test("a verified fix through MCP servers that made its calls may", () => {
    expect(
      getVerifiedFixRunbookRefusal(
        input({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          commandPlan: null,
          mcpToolCallPlan: { calls: [mcpCall({})] },
        }),
      ),
    ).toBeNull();
  });

  test.each([
    AutoRemediationVerificationStatus.Pending,
    AutoRemediationVerificationStatus.Failed,
    AutoRemediationVerificationStatus.Skipped,
    undefined,
  ])(
    "one whose verification is %s may not: only what worked is written down",
    (verification: AutoRemediationVerificationStatus | undefined) => {
      expect(
        getVerifiedFixRunbookRefusal(
          input({ verificationStatus: verification }),
        ),
      ).toBe(VerifiedFixRunbookRefusal.NotVerified);
    },
  );

  test("a runbook's own run may not, whether it worked or not: it is a runbook already", () => {
    expect(
      getVerifiedFixRunbookRefusal(
        input({ suggestionType: AutoRemediationSuggestionType.Runbook }),
      ),
    ).toBe(VerifiedFixRunbookRefusal.RanARunbook);
  });

  test("one saved already may not be saved again", () => {
    expect(
      getVerifiedFixRunbookRefusal(
        input({ savedAsRunbookId: ObjectID.generate().toString() }),
      ),
    ).toBe(VerifiedFixRunbookRefusal.AlreadySaved);
  });

  test("one none of whose commands succeeded may not, though it was verified", () => {
    for (const status of [
      AiRemediationCommandExecutionStatus.Failed,
      AiRemediationCommandExecutionStatus.Skipped,
      AiRemediationCommandExecutionStatus.Pending,
      AiRemediationCommandExecutionStatus.Running,
    ]) {
      expect(
        getVerifiedFixRunbookRefusal(
          input({
            commandPlan: { commands: [command({ execution: { status } })] },
          }),
        ),
      ).toBe(VerifiedFixRunbookRefusal.NothingRan);
    }

    expect(
      getVerifiedFixRunbookRefusal(
        input({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          commandPlan: null,
          mcpToolCallPlan: {
            calls: [mcpCall({ status: ExternalMcpToolCallStatus.Proposed })],
          },
        }),
      ),
    ).toBe(VerifiedFixRunbookRefusal.NothingRan);
  });

  test("an SSH command from before runbook credentials were removed never counts as one that ran", () => {
    expect(
      getVerifiedFixRunbookRefusal(
        input({
          commandPlan: {
            commands: [command({ stepType: RunbookStepType.SSH })],
          },
        }),
      ),
    ).toBe(VerifiedFixRunbookRefusal.NothingRan);
  });

  test("every refusal says what happened and what to do next", () => {
    for (const refusal of Object.values(VerifiedFixRunbookRefusal)) {
      const message: string = VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES[refusal];

      expect(message).toMatch(/^[A-Z]/);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });
});

describe("the steps a fix becomes", () => {
  test("a command on a Runner is a Bash step on that Runner, as written, with its time limit", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(input({}));

    expect(draft.steps).toHaveLength(1);

    const step: RunbookStep = draft.steps[0]!;

    expect(step.type).toBe(RunbookStepType.Bash);
    expect(step.order).toBe(1);
    expect(ObjectID.isValidUUID(step.id)).toBe(true);
    expect(step.title).toBe("systemctl restart nginx");
    expect(step.config as BashStepConfig).toEqual({
      script: "systemctl restart nginx",
      agentId: RUNNER_ID,
      timeoutInMs: 30000,
    });
    expect(step.requireApprovalBeforeRunning).toBe(false);
    expect(step.description).toContain(
      "Why: nginx stopped answering after the config reload",
    );
    expect(step.description).toContain(
      "What it does: nginx answers on port 443 again",
    );
  });

  test("a command the policy made a person approve waits for an approval in the runbook too", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        commandPlan: {
          commands: [
            command({
              policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
            }),
          ],
        },
      }),
    );

    expect(draft.steps[0]!.requireApprovalBeforeRunning).toBe(true);
  });

  test("its undo is written under it", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        commandPlan: {
          commands: [
            command({
              command: "sysctl -w net.core.somaxconn=4096",
              rollbackCommand: "sysctl -w net.core.somaxconn=128",
            }),
          ],
        },
      }),
    );

    expect(draft.steps[0]!.description).toContain(
      "To undo it: sysctl -w net.core.somaxconn=128",
    );
  });

  test("a change through a cluster's Kubernetes AI agent is a manual step holding the exact command", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        commandPlan: {
          commands: [
            command({
              stepType: RunbookStepType.Kubectl,
              runnerId: CLUSTER_ID,
              runnerNameSnapshot: "Kubernetes AI agent",
              kubernetesClusterId: CLUSTER_ID,
              kubernetesClusterNameSnapshot: "prod",
              command: "kubectl rollout restart deployment/web -n shop",
            }),
          ],
        },
      }),
    );

    const step: RunbookStep = draft.steps[0]!;

    expect(step.type).toBe(RunbookStepType.Manual);
    expect(step.config).toEqual({});
    expect(step.title).toBe(
      "On the prod cluster: kubectl rollout restart deployment/web -n shop",
    );
    expect(step.description).toContain(
      "Run this on the prod cluster: kubectl rollout restart deployment/web -n shop",
    );
    expect(step.description).toContain("Ask OneUptime AI to make it again");
  });

  test("a change through a resource's AI agent is a manual step naming the resource and its agent", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        commandPlan: {
          commands: [
            command({
              stepType: RunbookStepType.ResourceCommand,
              runnerId: RESOURCE_ID,
              runnerNameSnapshot: "Docker AI agent",
              resourceType: AiResourceType.DockerHost,
              resourceId: RESOURCE_ID,
              resourceNameSnapshot: "docker-01",
              command: "docker restart web",
            }),
          ],
        },
      }),
    );

    expect(draft.steps[0]!.type).toBe(RunbookStepType.Manual);
    expect(draft.steps[0]!.title).toBe(
      "On docker-01 (Docker AI agent): docker restart web",
    );
  });

  test("a call through an MCP server is a manual step with its tool, server and arguments", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        commandPlan: null,
        mcpToolCallPlan: { calls: [mcpCall({})] },
      }),
    );

    const step: RunbookStep = draft.steps[0]!;

    expect(step.type).toBe(RunbookStepType.Manual);
    expect(step.title).toBe("update_ecs_service on AWS");
    expect(step.description).toContain('"service": "checkout-api"');
    expect(step.description).toContain('"desiredCount": 8');
  });

  test("only what ran and succeeded, in the order it ran, numbered from one", () => {
    const plan: AiRemediationCommandPlan = {
      commands: [
        command({ sequence: 3, command: "third" }),
        command({
          sequence: 2,
          command: "failed",
          execution: { status: AiRemediationCommandExecutionStatus.Failed },
        }),
        command({ sequence: 1, command: "first" }),
        command({
          sequence: 4,
          command: "skipped",
          execution: { status: AiRemediationCommandExecutionStatus.Skipped },
        }),
      ],
    };

    expect(
      getSucceededCommands(plan).map((ran: AiRemediationCommand): string => {
        return ran.command;
      }),
    ).toEqual(["first", "third"]);

    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({ commandPlan: plan }),
    );

    expect(
      draft.steps.map((step: RunbookStep): [number, string] => {
        return [step.order, step.title];
      }),
    ).toEqual([
      [1, "first"],
      [2, "third"],
    ]);
  });

  test("an MCP fix's calls that did not succeed are left out", () => {
    const plan: ExternalMcpToolCallPlan = {
      calls: [
        mcpCall({ sequence: 1, toolName: "made" }),
        mcpCall({
          sequence: 2,
          toolName: "failed",
          status: ExternalMcpToolCallStatus.Failed,
        }),
      ],
    };

    expect(
      buildVerifiedFixRunbook(
        input({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          commandPlan: null,
          mcpToolCallPlan: plan,
        }),
      ).steps.map((step: RunbookStep): string => {
        return step.title;
      }),
    ).toEqual(["made on AWS"]);
  });

  test("a long command keeps its whole script, and a title cut to a line", () => {
    const long: string = `curl -fsS https://example.com/${"a".repeat(300)}`;
    const step: RunbookStep = buildVerifiedFixRunbook(
      input({ commandPlan: { commands: [command({ command: long })] } }),
    ).steps[0]!;

    expect(step.title.length).toBeLessThanOrEqual(
      MAX_VERIFIED_FIX_STEP_TITLE_LENGTH,
    );
    expect(step.title.endsWith("…")).toBe(true);
    expect((step.config as BashStepConfig).script).toBe(long);
  });
});

describe("what the runbook is called and says", () => {
  test("named for what it fixed, saying where it comes from and that it is off until reviewed", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(input({}));

    expect(draft.name).toBe("Fix: Checkout returns 503s");
    expect(draft.description).toBe(
      "Written from the fix OneUptime AI ran for incident #42 (Checkout returns 503s), which was verified when it recovered. Turned off until someone reviews each step and turns it on.",
    );
  });

  test("an alert's fix names the alert", () => {
    expect(
      buildVerifiedFixRunbook(
        input({
          subject: {
            kind: "alert",
            handle: "ALR-7",
            title: "Disk full on db-1",
          },
        }),
      ).description,
    ).toContain("for alert ALR-7 (Disk full on db-1)");
  });

  test("name and description fit a runbook's columns, however long the title", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({
        subject: { kind: "incident", handle: "#1", title: "x".repeat(900) },
      }),
    );

    expect(draft.name.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(draft.description.length).toBeLessThanOrEqual(ColumnLength.LongText);
  });

  test("with no title or number, it still has a name and says what it fixed", () => {
    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(
      input({ subject: { kind: "incident", handle: "", title: "" } }),
    );

    expect(draft.name).toBe("Verified fix");
    expect(draft.description).toContain("for the incident, which was verified");
  });
});

describe("a name no runbook of the project has", () => {
  test("is the name itself while nothing has it", () => {
    expect(getUniqueRunbookName("Fix: Disk full", ["Other"])).toBe(
      "Fix: Disk full",
    );
  });

  test("counts up past the ones taken, whatever their case", () => {
    expect(
      getUniqueRunbookName("Fix: Disk full", [
        "fix: disk full",
        "Fix: Disk full (2)",
      ]),
    ).toBe("Fix: Disk full (3)");
  });

  test("stays within a runbook's name when counted", () => {
    const name: string = "y".repeat(ColumnLength.ShortText);
    const unique: string = getUniqueRunbookName(name, [name]);

    expect(unique.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(unique.endsWith(" (2)")).toBe(true);
  });
});

describe("when the fix's card offers Save as Runbook", () => {
  test("a fix that can be saved, to someone who may create runbooks: Act", () => {
    expect(
      getVerifiedFixRunbookOffer({ ...input({}), mayCreateRunbook: true }),
    ).toBe(SuggestionOffer.Act);
  });

  test("to someone who may not create runbooks: nothing", () => {
    expect(
      getVerifiedFixRunbookOffer({ ...input({}), mayCreateRunbook: false }),
    ).toBe(SuggestionOffer.None);
  });

  test("a fix saved already: Done, so the card links to its runbook - for anyone", () => {
    for (const mayCreateRunbook of [true, false]) {
      expect(
        getVerifiedFixRunbookOffer({
          ...input({ savedAsRunbookId: ObjectID.generate().toString() }),
          mayCreateRunbook,
        }),
      ).toBe(SuggestionOffer.Done);
    }
  });

  test("a fix that is not verified, ran a runbook or ran nothing: nothing", () => {
    for (const fix of [
      input({ verificationStatus: AutoRemediationVerificationStatus.Failed }),
      input({ suggestionType: AutoRemediationSuggestionType.Runbook }),
      input({ commandPlan: { commands: [] } }),
    ]) {
      expect(
        getVerifiedFixRunbookOffer({ ...fix, mayCreateRunbook: true }),
      ).toBe(SuggestionOffer.None);
    }
  });
});
