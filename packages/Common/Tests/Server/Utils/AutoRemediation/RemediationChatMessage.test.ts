import RemediationChatMessage, {
  describeChangeTarget,
  describeChangeTier,
  RemediationActionValue,
  RemediationChatFix,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import {
  getApprovalMessageNote,
  getViewInProductTitle,
  REMEDIATION_CHAT_WORDS,
  REMEDIATION_PRESSES,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatWords";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import URL from "../../../../Types/API/URL";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationDryRunStatus,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { RemediationTrackRecordOutcome } from "../../../../Types/AutoRemediation/RemediationTrackRecord";
import { KubectlCommandTier } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - a fix that waits for approval, in its record's
 * Slack and Microsoft Teams channels (Server/Utils/AutoRemediation/
 * RemediationChatMessage):
 *
 *  - the message lists what the fix runs, change by change: a cloud
 *    change's plain words above its exact command, how risky it is, what it
 *    runs on and how the same change went before; a runbook by name; MCP
 *    changes by server and tool;
 *  - it carries Review and approve (the one primary button), Dismiss and
 *    View in OneUptime, the same in both chats, each fix button carrying
 *    the fix and the fingerprint of what it runs, the same fingerprint
 *    approving reads;
 *  - the dialog says what the fix is for, everything it runs - each
 *    change's reason, undo and dry run - and that approving runs exactly
 *    that, under your name, watched for its window and, for commands,
 *    rolled back when the monitors do not recover;
 *  - a button value is read back only when this message could have
 *    written it;
 *  - what a person, a resource or a model wrote is escaped for where it
 *    sits: a backtick in a command cannot close its code span;
 *  - the product is named as the installation names it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const ALERT_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000004");
const ACCOUNT: string = "50000000-0000-4000-8000-000000000005";
const AGENT: string = "60000000-0000-4000-8000-000000000006";
const CLUSTER: string = "70000000-0000-4000-8000-000000000007";
const ECS: string =
  "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api";
const INCIDENT_URL: string =
  "https://oneuptime.example.com/dashboard/10000000-0000-4000-8000-000000000001/incidents/30000000-0000-4000-8000-000000000003";

function cloudChange(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT,
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: `cloud scale-out ${ECS} --count 8`,
    rollbackCommand: `cloud scale-in ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "checkout-api's 4 tasks have run at 100% CPU since 17:52.",
    expectedEffect: "p95 falls under 500 ms.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function kubectlChange(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 2,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT,
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: CLUSTER,
    kubernetesClusterNameSnapshot: "prod-eu-west-1",
    kubectlTier: KubectlCommandTier.RiskyWrite,
    command: "kubectl rollout restart deployment/checkout-api -n checkout",
    timeoutInMs: 60000,
    rationale: "new pods read DB_POOL_MAX=40 again",
    expectedEffect: "the queue drains",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function commandFix(
  commands: Array<AiRemediationCommand>,
  overrides: Partial<RemediationChatFix> = {},
): RemediationChatFix {
  return {
    suggestionId: SUGGESTION_ID,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands },
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_URL));
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        "https://oneuptime.example.com/dashboard/10000000-0000-4000-8000-000000000001/alerts/40000000-0000-4000-8000-000000000004",
      ),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the message lists", () => {
  test("a cloud change: its words, its tier and target, its exact command", () => {
    const text: string = RemediationChatMessage.describeChanges(
      commandFix([cloudChange()]),
      { withDetails: false },
    ).toString();

    expect(text).toContain(
      '**1. Scale the ECS service checkout-api out to 8 tasks** · safe change on AWS account "prod"',
    );
    expect(text).toContain(`\`cloud scale-out ${ECS} --count 8\``);
    // The message is short: the details are the dialog's.
    expect(text).not.toContain("Why:");
    expect(text).not.toContain("Undo:");
  });

  test("a kubectl change: its number, tier and cluster, then its command", () => {
    const text: string = RemediationChatMessage.describeChanges(
      commandFix([kubectlChange()]),
      { withDetails: false },
    ).toString();

    expect(text).toContain(
      '**2.** · riskier change on cluster "prod-eu-west-1"',
    );
    expect(text).toContain(
      "`kubectl rollout restart deployment/checkout-api -n checkout`",
    );
  });

  test("each change's track record, with how it went", () => {
    const worked: string = RemediationChatMessage.describeChanges(
      commandFix([
        cloudChange({
          trackRecord: {
            workedCount: 2,
            didNotWorkCount: 0,
            runs: [
              {
                subjectKind: "incident",
                subjectId: "80000000-0000-4000-8000-000000000008",
                subjectNumber: "INC-41",
                ranAt: "2026-10-20T00:00:00.000Z",
                outcome: RemediationTrackRecordOutcome.Worked,
              },
            ],
          },
        }),
      ]),
      { withDetails: false },
    ).toString();

    expect(worked).toContain(
      "✅ Worked all 2 times it ran here before (INC-41).",
    );

    const failed: string = RemediationChatMessage.describeChanges(
      commandFix([
        cloudChange({
          trackRecord: { workedCount: 0, didNotWorkCount: 1, runs: [] },
        }),
      ]),
      { withDetails: false },
    ).toString();

    expect(failed).toContain("❌ Didn't work the one time it ran here before.");

    const mixed: string = RemediationChatMessage.describeChanges(
      commandFix([
        cloudChange({
          trackRecord: { workedCount: 1, didNotWorkCount: 1, runs: [] },
        }),
      ]),
      { withDetails: false },
    ).toString();

    expect(mixed).toContain("⚠️ Worked 1 of the 2 times it ran here before.");
  });

  test("a runbook by its name, MCP changes by server and tool", () => {
    expect(
      RemediationChatMessage.describeChanges(
        commandFix([], {
          suggestionType: AutoRemediationSuggestionType.Runbook,
          commandPlan: null,
          runbookName: "Restart *checkout* pods",
        }),
        { withDetails: false },
      ).toString(),
    ).toBe("Runbook **Restart \\*checkout\\* pods**");

    const mcp: ExternalMcpToolCallPlan = {
      calls: [
        {
          sequence: 1,
          serverId: "90000000-0000-4000-8000-000000000009",
          serverNameSnapshot: "Feature flags",
          toolName: "set_flag",
          arguments: {},
          status: ExternalMcpToolCallStatus.Proposed,
        },
        {
          sequence: 2,
          serverId: "90000000-0000-4000-8000-000000000009",
          serverNameSnapshot: "Feature flags",
          toolName: "already_sent",
          arguments: {},
          status: ExternalMcpToolCallStatus.Succeeded,
        },
      ],
    };

    const text: string = RemediationChatMessage.describeChanges(
      commandFix([], {
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        commandPlan: null,
        mcpToolCallPlan: mcp,
      }),
      { withDetails: false },
    ).toString();

    expect(text).toBe("**1.** Feature flags · `set_flag`");
  });

  test("a backtick in a command cannot close its code span", () => {
    const text: string = RemediationChatMessage.describeChanges(
      commandFix([
        kubectlChange({
          command: "kubectl annotate pod web `x` --overwrite",
        }),
      ]),
      { withDetails: false },
    ).toString();

    expect(text).toContain("`` kubectl annotate pod web `x` --overwrite ``");
  });

  test("a change's tier and target, in the card's words", () => {
    expect(describeChangeTier(cloudChange())).toBe("safe change");
    expect(describeChangeTier(kubectlChange())).toBe("riskier change");
    expect(
      describeChangeTier(
        cloudChange({ resourceCommandTier: ResourceCommandTier.Read }),
      ),
    ).toBeNull();
    expect(describeChangeTarget(cloudChange())).toBe('AWS account "prod"');
    expect(describeChangeTarget(kubectlChange())).toBe(
      'cluster "prod-eu-west-1"',
    );
    expect(
      describeChangeTarget(
        cloudChange({
          resourceType: AiResourceType.Host,
          resourceNameSnapshot: "web-1",
        }),
      ),
    ).toBe('host "web-1"');
    expect(
      describeChangeTarget({
        ...kubectlChange(),
        stepType: RunbookStepType.Bash,
      }),
    ).toBeNull();
  });
});

describe("the message's blocks", () => {
  test("the same in Slack and in Microsoft Teams: the changes, three buttons and a quiet line", async () => {
    const fix: RemediationChatFix = commandFix([cloudChange()]);
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(fix);

    expect(
      blocks.map((each: MessageBlocksByWorkspaceType) => {
        return each.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
    expect(blocks[0]!.messageBlocks).toEqual(blocks[1]!.messageBlocks);

    const [changes, buttons, note] = blocks[0]!.messageBlocks as [
      WorkspacePayloadMarkdown,
      WorkspacePayloadButtons,
      WorkspacePayloadContext,
    ];

    expect(changes._type).toBe("WorkspacePayloadMarkdown");
    expect(changes.text).toContain("Scale the ECS service");
    expect(note._type).toBe("WorkspacePayloadContext");
    expect(note.text).toBe(getApprovalMessageNote());

    const expectedValue: string = `${SUGGESTION_ID.toString()}:${getRemediationPlanFingerprint(
      {
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        commandPlan: AiRemediationCommandPlanUtil.toJSON(fix.commandPlan!),
      },
    )}`;

    expect(
      buttons.buttons.map((button: WorkspaceMessagePayloadButton) => {
        return {
          title: button.title,
          actionId: button.actionId,
          value: button.value,
          isPrimary: Boolean(button.isPrimary),
          url: button.url?.toString(),
        };
      }),
    ).toEqual([
      {
        title: REMEDIATION_CHAT_WORDS.reviewAndApprove,
        actionId: SlackActionType.ViewApproveRemediation,
        value: expectedValue,
        isPrimary: true,
        url: undefined,
      },
      {
        title: REMEDIATION_CHAT_WORDS.dismiss,
        actionId: SlackActionType.DismissRemediation,
        value: expectedValue,
        isPrimary: false,
        url: undefined,
      },
      {
        title: getViewInProductTitle(),
        actionId: SlackActionType.OpenInOneUptime,
        value: "",
        isPrimary: false,
        url: INCIDENT_URL,
      },
    ]);
  });

  test("an alert's fix links to the alert", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(
        commandFix([cloudChange()], {
          incidentId: undefined,
          alertId: ALERT_ID,
        }),
      );

    const buttons: WorkspacePayloadButtons = blocks[0]!
      .messageBlocks[1] as WorkspacePayloadButtons;

    expect(buttons.buttons[2]?.url?.toString()).toContain(
      "/alerts/40000000-0000-4000-8000-000000000004",
    );
  });

  test("with no link to build, the message has no View button, the fix buttons stay", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("no dashboard url"));

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(
        commandFix([cloudChange()]),
      );

    const buttons: WorkspacePayloadButtons = blocks[0]!
      .messageBlocks[1] as WorkspacePayloadButtons;

    expect(
      buttons.buttons.map((button: WorkspaceMessagePayloadButton) => {
        return button.actionId;
      }),
    ).toEqual([
      SlackActionType.ViewApproveRemediation,
      SlackActionType.DismissRemediation,
    ]);
  });

  test("a proposal's blocks read the kind of fix from what it now holds", async () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.id = SUGGESTION_ID;
    suggestion.projectId = PROJECT_ID;
    suggestion.incidentId = INCIDENT_ID;

    const plan: AiRemediationCommandPlan = { commands: [cloudChange()] };

    const fromPlan: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getProposalBlocks({
        suggestion,
        commandPlan: plan,
      });
    const fromRunbook: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getProposalBlocks({
        suggestion,
        runbook: {
          id: new ObjectID("a0000000-0000-4000-8000-00000000000a"),
          name: "Restart pods",
        },
      });

    expect(
      (fromPlan[0]!.messageBlocks[0] as WorkspacePayloadMarkdown).text,
    ).toContain("Scale the ECS service");
    expect(
      (fromRunbook[0]!.messageBlocks[0] as WorkspacePayloadMarkdown).text,
    ).toBe("Runbook **Restart pods**");

    const valueOf: (blocks: Array<MessageBlocksByWorkspaceType>) => string = (
      blocks: Array<MessageBlocksByWorkspaceType>,
    ): string => {
      return (blocks[0]!.messageBlocks[1] as WorkspacePayloadButtons)
        .buttons[0]!.value;
    };

    expect(valueOf(fromPlan)).not.toBe(valueOf(fromRunbook));
  });

  test("a suggestion without its id or project has no blocks", async () => {
    expect(
      await RemediationChatMessage.getProposalBlocks({
        suggestion: new AutoRemediationSuggestion(),
        commandPlan: { commands: [cloudChange()] },
      }),
    ).toEqual([]);
  });
});

describe("the approval dialog", () => {
  test("says what the fix is for, everything it runs and what approving does", () => {
    const text: string = RemediationChatMessage.describeApproval({
      fix: commandFix([
        cloudChange({
          dryRun: {
            status: AiRemediationDryRunStatus.WouldRun,
            checkedAt: "2026-11-01T10:00:00.000Z",
          },
        }),
      ]),
      subjectName: "Incident INC-42",
      subjectTitle: "Checkout API p95 latency above 2s",
    }).toString();

    expect(
      text.startsWith("**Incident INC-42:** Checkout API p95 latency above 2s"),
    ).toBe(true);
    expect(text).toContain(
      "Why: checkout-api's 4 tasks have run at 100% CPU since 17:52.",
    );
    expect(text).toContain(`Undo: \`cloud scale-in ${ECS} --count 4\``);
    expect(text).toContain(
      "Dry run: this change would run. Nothing was changed.",
    );
    expect(text).toContain(
      "Approving runs exactly what is shown, under your name. OneUptime then watches the monitors for 15 minutes and rolls back the changes that have an undo if they do not recover.",
    );
  });

  test("each dry run's answer, in its own words", () => {
    function withDryRun(
      status: AiRemediationDryRunStatus,
      summary?: string,
    ): string {
      return RemediationChatMessage.describeApproval({
        fix: commandFix([
          cloudChange({
            dryRun: {
              status,
              checkedAt: "2026-11-01T10:00:00.000Z",
              ...(summary ? { summary } : {}),
            },
          }),
        ]),
        subjectName: "Incident INC-42",
      }).toString();
    }

    expect(
      withDryRun(
        AiRemediationDryRunStatus.WouldBeRefused,
        "The service lacks the tag oneuptime-ai=allow.",
      ),
    ).toContain(
      "Dry run: the agent would refuse this change. The service lacks the tag oneuptime-ai=allow.",
    );
    expect(withDryRun(AiRemediationDryRunStatus.WouldBeRefused)).toContain(
      "Dry run: the agent would refuse this change.",
    );
    expect(withDryRun(AiRemediationDryRunStatus.Failed)).toContain(
      "Dry run: it could not finish. Nothing was changed.",
    );
    expect(withDryRun(AiRemediationDryRunStatus.Running)).toContain(
      "Dry run: being checked now.",
    );
  });

  test("a runbook's dialog watches without promising a rollback", () => {
    const text: string = RemediationChatMessage.describeApproval({
      fix: commandFix([], {
        suggestionType: AutoRemediationSuggestionType.Runbook,
        commandPlan: null,
        runbookName: "Restart pods",
        verificationWindowMinutes: 30,
      }),
      subjectName: "Alert #305",
    }).toString();

    expect(text).toContain(
      "OneUptime then watches the monitors for 30 minutes.",
    );
    expect(text).not.toContain("rolls back");
  });

  test("a subject title written to steer the message stays text", () => {
    const text: string = RemediationChatMessage.describeApproval({
      fix: commandFix([cloudChange()]),
      subjectName: "Incident INC-42",
      subjectTitle: "[Click](https://evil.example.com) <@U123> **now**",
    }).toString();

    // Its brackets and stars are escaped: no link, no bold, no mention.
    expect(text).toContain("\\[Click\\](https://evil.example.com)");
    expect(text).toContain("\\*\\*now\\*\\*");
    expect(text).not.toContain("<@U123>");
  });
});

describe("a button's value", () => {
  test("is the fix and its fingerprint, and reads back as it was written", () => {
    const value: RemediationActionValue = {
      suggestionId: SUGGESTION_ID,
      fingerprint: "0123456789abcdef",
    };
    const written: string = RemediationChatMessage.encodeActionValue(value);

    expect(written).toBe(`${SUGGESTION_ID.toString()}:0123456789abcdef`);

    const read: RemediationActionValue | null =
      RemediationChatMessage.decodeActionValue(written);

    expect(read?.suggestionId.toString()).toBe(SUGGESTION_ID.toString());
    expect(read?.fingerprint).toBe("0123456789abcdef");
  });

  test("anything this message could not have written reads as nothing", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      SUGGESTION_ID.toString(),
      `:${"0".repeat(16)}`,
      `not-a-uuid:${"0".repeat(16)}`,
      `${SUGGESTION_ID.toString()}:`,
      `${SUGGESTION_ID.toString()}:${"0".repeat(200)}`,
    ]) {
      expect(RemediationChatMessage.decodeActionValue(value)).toBeNull();
    }
  });

  test("a fix read from its row is the same fix, with the same fingerprint", () => {
    const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
    row.id = SUGGESTION_ID;
    row.projectId = PROJECT_ID;
    row.incidentId = INCIDENT_ID;
    row.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    row.commandPlan = AiRemediationCommandPlanUtil.toJSON({
      commands: [cloudChange()],
    });
    row.verificationWindowMinutes = 20;

    const fix: RemediationChatFix | null =
      RemediationChatMessage.fromSuggestion(row);

    expect(fix?.verificationWindowMinutes).toBe(20);
    expect(RemediationChatMessage.getFingerprint(fix!)).toBe(
      getRemediationPlanFingerprint(row),
    );
    expect(
      RemediationChatMessage.fromSuggestion(new AutoRemediationSuggestion()),
    ).toBeNull();
  });
});

describe("the buttons' words", () => {
  test("each fix button asks to be connected for what it does, and to be pressed again", () => {
    expect(
      REMEDIATION_PRESSES.get(SlackActionType.ViewApproveRemediation),
    ).toEqual({ purpose: "approve this fix", button: "Review and approve" });
    expect(
      REMEDIATION_PRESSES.get(SlackActionType.SubmitApproveRemediation),
    ).toEqual({ purpose: "approve this fix", button: "Review and approve" });
    expect(REMEDIATION_PRESSES.get(SlackActionType.DismissRemediation)).toEqual(
      {
        purpose: "dismiss this fix",
        button: "Dismiss",
      },
    );
  });

  test("the product is named as the installation names it", () => {
    expect(getViewInProductTitle()).toBe("View in OneUptime");
    expect(getApprovalMessageNote()).toContain("your own OneUptime account");
  });
});
