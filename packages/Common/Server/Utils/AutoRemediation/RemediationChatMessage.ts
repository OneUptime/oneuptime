import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import URL from "../../../Types/API/URL";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationDryRunStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import {
  getRemediationTrackRecordTone,
  RemediationTrackRecord,
  RemediationTrackRecordTone,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  CloudChangeWords,
  describeCloudChange,
} from "../../../Utils/AiRemediation/CloudChangeWords";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { MessageBlocksByWorkspaceType } from "../../Services/WorkspaceNotificationRuleService";
import AlertService from "../../Services/AlertService";
import IncidentService from "../../Services/IncidentService";
import { describeRemediationTrackRecordLine } from "../../../Types/AutoRemediation/RemediationTrackRecordWords";
import logger from "../Logger";
import SlackActionType from "../Workspace/Slack/Actions/ActionTypes";
import { getRemediationPlanFingerprint } from "./RemediationPlanFingerprint";
import {
  getApprovalMessageNote,
  getViewInProductTitle,
  REMEDIATION_CHAT_WORDS,
} from "./RemediationChatWords";
import ProductBrandingText from "../ProductBrandingText";

/*
 * A FIX THAT WAITS FOR APPROVAL, WHERE THE TEAM IS.
 *
 * When OneUptime AI proposes a fix for approval, the incident's or alert's
 * Slack and Microsoft Teams channels get the news - and used to get only
 * the news: to approve the fix, someone had to open OneUptime. The people
 * who are paged work the incident in its channel, and a fix that waits for
 * a click is minutes of outage, so the message now carries the fix:
 *
 *   - what it runs, change by change: a cloud change in plain words above
 *     its exact command (CloudChangeWords), how risky each is, and how the
 *     same change went the last times it ran there (its track record);
 *   - Review and approve, which opens everything approving runs - each
 *     command, its undo, its dry run - and Approve and run; Dismiss; and
 *     View in OneUptime.
 *
 * Approving from the dialog is approving in OneUptime: as the person's own
 * OneUptime account, through RemediationApproval, so every check the
 * Dashboard's Approve makes is made. Each button carries the fix and its
 * plan fingerprint (RemediationPlanFingerprint): a fix that changed since
 * the message was posted is not approved, nor dismissed, from it.
 *
 * Everything a person, a resource or the model wrote goes in through
 * mdText or FeedMarkdown, escaped for where it sits.
 */

// What a fix's message and dialog are made from, as its suggestion stores it.
export interface RemediationChatFix {
  suggestionId: ObjectID;
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  suggestionType: AutoRemediationSuggestionType;
  commandPlan?: AiRemediationCommandPlan | null | undefined;
  mcpToolCallPlan?: ExternalMcpToolCallPlan | null | undefined;
  runbookId?: ObjectID | undefined;
  runbookName?: string | undefined;
  verificationWindowMinutes?: number | undefined;
}

// A button's value: the fix, and the fingerprint of what it ran then.
export interface RemediationActionValue {
  suggestionId: ObjectID;
  fingerprint: string;
}

// What a message shows of a change's reasoning and answers, at most.
const MAX_RATIONALE_CHARS: number = 400;
const MAX_DRY_RUN_SUMMARY_CHARS: number = 400;

// A value's separator: a suggestion id never holds one.
const ACTION_VALUE_SEPARATOR: string = ":";

// What a track record's line starts with, by how it went.
const TRACK_RECORD_MARKS: Readonly<Record<RemediationTrackRecordTone, string>> =
  {
    [RemediationTrackRecordTone.Worked]: "✅",
    [RemediationTrackRecordTone.Mixed]: "⚠️",
    [RemediationTrackRecordTone.DidNotWork]: "❌",
  };

function capped(text: string, maxChars: number): string {
  const oneLine: string = text.trim();

  return oneLine.length > maxChars
    ? `${oneLine.slice(0, maxChars - 1)}…`
    : oneLine;
}

/*
 * How risky a change is, in the card's own words: what the policy tiered it
 * when the fix was proposed (the agent checks it again when it runs).
 */
export function describeChangeTier(
  command: AiRemediationCommand,
): string | null {
  const tier: string | undefined =
    command.stepType === RunbookStepType.ResourceCommand
      ? command.resourceCommandTier
      : command.kubectlTier;

  if (
    tier === KubectlCommandTier.SafeWrite ||
    tier === ResourceCommandTier.SafeWrite
  ) {
    return "safe change";
  }

  if (
    tier === KubectlCommandTier.RiskyWrite ||
    tier === ResourceCommandTier.RiskyWrite
  ) {
    return "riskier change";
  }

  return null;
}

/*
 * What a change runs on: 'cluster "prod-eu-west-1"', 'AWS account "prod"',
 * or nothing for a Runner's command.
 */
export function describeChangeTarget(
  command: AiRemediationCommand,
): string | null {
  if (command.stepType === RunbookStepType.Kubectl) {
    const name: string =
      command.kubernetesClusterNameSnapshot ||
      command.kubernetesClusterId ||
      "";

    return name ? `cluster "${capped(name, 120)}"` : null;
  }

  if (
    command.stepType === RunbookStepType.ResourceCommand &&
    isAiResourceType(command.resourceType)
  ) {
    const noun: string =
      command.resourceType === AiResourceType.Host
        ? "host"
        : AI_RESOURCE_TYPE_INFO[command.resourceType].displayName;
    const name: string = command.resourceNameSnapshot || "";

    return name ? `${noun} "${capped(name, 120)}"` : noun;
  }

  return null;
}

export default class RemediationChatMessage {
  public static encodeActionValue(value: RemediationActionValue): string {
    return `${value.suggestionId.toString()}${ACTION_VALUE_SEPARATOR}${value.fingerprint}`;
  }

  // A button's value, or null when it is not one this message wrote.
  public static decodeActionValue(
    value: unknown,
  ): RemediationActionValue | null {
    if (typeof value !== "string" || value.length > 128) {
      return null;
    }

    const separator: number = value.indexOf(ACTION_VALUE_SEPARATOR);

    if (separator <= 0) {
      return null;
    }

    const suggestionId: string = value.slice(0, separator);
    const fingerprint: string = value.slice(separator + 1);

    if (!ObjectID.isValidUUID(suggestionId) || !fingerprint) {
      return null;
    }

    return { suggestionId: new ObjectID(suggestionId), fingerprint };
  }

  // The fix a suggestion row holds, as its message and dialog read it.
  public static fromSuggestion(
    suggestion: AutoRemediationSuggestion,
  ): RemediationChatFix | null {
    if (!suggestion.id || !suggestion.projectId) {
      return null;
    }

    return {
      suggestionId: suggestion.id,
      projectId: suggestion.projectId,
      incidentId: suggestion.incidentId,
      alertId: suggestion.alertId,
      suggestionType:
        suggestion.suggestionType || AutoRemediationSuggestionType.Runbook,
      commandPlan: AiRemediationCommandPlanUtil.parse(suggestion.commandPlan),
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.parse(
        suggestion.mcpToolCallPlan,
      ),
      runbookId: suggestion.runbookId,
      runbookName: suggestion.runbookNameSnapshot,
      verificationWindowMinutes: suggestion.verificationWindowMinutes,
    };
  }

  // The fingerprint of what the fix runs, read as approving reads it.
  public static getFingerprint(fix: RemediationChatFix): string {
    return getRemediationPlanFingerprint({
      suggestionType: fix.suggestionType,
      commandPlan: fix.commandPlan
        ? AiRemediationCommandPlanUtil.toJSON(fix.commandPlan)
        : undefined,
      mcpToolCallPlan: fix.mcpToolCallPlan
        ? ExternalMcpToolCallPlanUtil.toJSON(fix.mcpToolCallPlan)
        : undefined,
      runbookId: fix.runbookId,
    });
  }

  /*
   * What the fix runs, as chat Markdown: one entry per change, numbered,
   * each with a cloud change's words, its exact command, how risky it is
   * and its track record. With details (the dialog): each change's reason,
   * its undo and its dry run too.
   */
  public static describeChanges(
    fix: RemediationChatFix,
    options: { withDetails: boolean },
  ): MarkdownText {
    if (
      fix.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
      fix.commandPlan
    ) {
      return FeedMarkdown.join(
        fix.commandPlan.commands.map(
          (command: AiRemediationCommand): MarkdownText => {
            return RemediationChatMessage.describeCommand(
              command,
              options.withDetails,
            );
          },
        ),
        "\n\n",
      );
    }

    if (
      fix.suggestionType === AutoRemediationSuggestionType.McpToolCalls &&
      fix.mcpToolCallPlan
    ) {
      const calls: Array<ExternalMcpToolCall> =
        ExternalMcpToolCallPlanUtil.getProposedCalls(fix.mcpToolCallPlan);

      return FeedMarkdown.join(
        calls.map((call: ExternalMcpToolCall): MarkdownText => {
          return mdText`**${String(call.sequence)}.** ${capped(call.serverNameSnapshot, 120)} · \`${capped(call.toolName, 120)}\``;
        }),
        "\n",
      );
    }

    return mdText`Runbook **${capped(fix.runbookName || "Runbook", 200)}**`;
  }

  private static describeCommand(
    command: AiRemediationCommand,
    withDetails: boolean,
  ): MarkdownText {
    const words: CloudChangeWords | null =
      command.stepType === RunbookStepType.ResourceCommand
        ? describeCloudChange({
            resourceType: command.resourceType,
            command: command.command,
          })
        : null;
    const tier: string | null = describeChangeTier(command);
    const target: string | null = describeChangeTarget(command);
    const facts: Array<string> = [tier, target ? `on ${target}` : null].filter(
      (fact: string | null): fact is string => {
        return Boolean(fact);
      },
    );
    const factsText: string = facts.length > 0 ? ` · ${facts.join(" ")}` : "";

    const lines: Array<MarkdownText> = [
      words
        ? mdText`**${String(command.sequence)}. ${words.sentence}**${factsText}`
        : mdText`**${String(command.sequence)}.**${factsText}`,
      mdText`\`${command.command}\``,
    ];

    if (withDetails && command.rationale) {
      lines.push(
        mdText`Why: ${FeedMarkdown.aiWritten(capped(command.rationale, MAX_RATIONALE_CHARS))}`,
      );
    }

    if (withDetails && command.rollbackCommand) {
      lines.push(mdText`Undo: \`${command.rollbackCommand}\``);
    }

    if (withDetails && command.dryRun) {
      lines.push(RemediationChatMessage.describeDryRun(command));
    }

    const record: RemediationTrackRecord | undefined = command.trackRecord;

    if (record) {
      lines.push(
        mdText`${TRACK_RECORD_MARKS[getRemediationTrackRecordTone(record)]} ${describeRemediationTrackRecordLine(record)}`,
      );
    }

    return FeedMarkdown.join(lines, "\n");
  }

  private static describeDryRun(command: AiRemediationCommand): MarkdownText {
    const dryRun: AiRemediationCommand["dryRun"] = command.dryRun;

    if (!dryRun) {
      return FeedMarkdown.empty();
    }

    const said: string = dryRun.summary
      ? capped(dryRun.summary, MAX_DRY_RUN_SUMMARY_CHARS)
      : "";

    switch (dryRun.status) {
      case AiRemediationDryRunStatus.WouldRun:
        return mdText`Dry run: this change would run. Nothing was changed.`;
      case AiRemediationDryRunStatus.WouldBeRefused:
        return said
          ? mdText`Dry run: the agent would refuse this change. ${said}`
          : mdText`Dry run: the agent would refuse this change.`;
      case AiRemediationDryRunStatus.Failed:
        return mdText`Dry run: it could not finish. Nothing was changed.`;
      default:
        return mdText`Dry run: being checked now.`;
    }
  }

  /*
   * The approval dialog: what the fix is for, everything it runs, and what
   * approving does - in the person's own name, watched and undone.
   */
  public static describeApproval(data: {
    fix: RemediationChatFix;
    // "Incident INC-42", "Alert #305".
    subjectName: string;
    subjectTitle?: string | undefined;
  }): MarkdownText {
    const window: number = data.fix.verificationWindowMinutes || 15;
    const product: string = ProductBrandingText.getProductName();
    const watched: MarkdownText =
      data.fix.suggestionType === AutoRemediationSuggestionType.CommandPlan
        ? mdText`${product} then watches the monitors for ${String(window)} minutes and rolls back the changes that have an undo if they do not recover.`
        : mdText`${product} then watches the monitors for ${String(window)} minutes.`;

    const subject: MarkdownText = data.subjectTitle
      ? mdText`**${data.subjectName}:** ${capped(data.subjectTitle, 200)}`
      : mdText`**${data.subjectName}**`;

    return FeedMarkdown.join(
      [
        subject,
        RemediationChatMessage.describeChanges(data.fix, {
          withDetails: true,
        }),
        mdText`Approving runs exactly what is shown, under your name. ${watched}`,
      ],
      "\n\n",
    );
  }

  /*
   * The blocks a "needs your approval" message carries in the record's
   * Slack and Microsoft Teams channels: the changes, then Review and
   * approve, Dismiss and View in OneUptime. Empty when the fix cannot be
   * described - the message then says what it always said.
   */
  public static async getApprovalBlocks(
    fix: RemediationChatFix,
  ): Promise<Array<MessageBlocksByWorkspaceType>> {
    try {
      const value: string = RemediationChatMessage.encodeActionValue({
        suggestionId: fix.suggestionId,
        fingerprint: RemediationChatMessage.getFingerprint(fix),
      });

      const viewUrl: URL | null =
        await RemediationChatMessage.getSubjectUrl(fix);

      const changes: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: RemediationChatMessage.describeChanges(fix, {
          withDetails: false,
        }).toString(),
      };

      const buttons: Array<WorkspaceMessagePayloadButton> = [
        {
          _type: "WorkspaceMessagePayloadButton",
          title: REMEDIATION_CHAT_WORDS.reviewAndApprove,
          value,
          actionId: SlackActionType.ViewApproveRemediation,
          isPrimary: true,
        },
        {
          _type: "WorkspaceMessagePayloadButton",
          title: REMEDIATION_CHAT_WORDS.dismiss,
          value,
          actionId: SlackActionType.DismissRemediation,
        },
      ];

      if (viewUrl) {
        buttons.push({
          _type: "WorkspaceMessagePayloadButton",
          title: getViewInProductTitle(),
          value: "",
          url: viewUrl,
          actionId: SlackActionType.OpenInOneUptime,
        });
      }

      const buttonsBlock: WorkspacePayloadButtons = {
        _type: "WorkspacePayloadButtons",
        buttons,
      };

      const note: WorkspacePayloadContext = {
        _type: "WorkspacePayloadContext",
        text: getApprovalMessageNote(),
      };

      const blocks: Array<WorkspaceMessageBlock> = [
        changes,
        buttonsBlock,
        note,
      ];

      return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
        (workspaceType: WorkspaceType): MessageBlocksByWorkspaceType => {
          return { workspaceType, messageBlocks: blocks };
        },
      );
    } catch (error) {
      logger.error(
        `RemediationChatMessage: could not build the approval message of suggestion ${fix.suggestionId.toString()}: ${error}`,
      );
      return [];
    }
  }

  /*
   * The blocks of a proposal's message, from the suggestion as it was just
   * settled: its identity, and the plan, MCP changes or runbook it now
   * holds (what the row stores, so the fingerprint is the one approving
   * reads). Empty when the suggestion is not one a message can carry.
   */
  public static async getProposalBlocks(data: {
    suggestion: AutoRemediationSuggestion;
    commandPlan?: AiRemediationCommandPlan | undefined;
    mcpToolCallPlan?: ExternalMcpToolCallPlan | undefined;
    runbook?: { id?: ObjectID | null | undefined; name?: string | undefined };
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    if (!data.suggestion.id || !data.suggestion.projectId) {
      return [];
    }

    const suggestionType: AutoRemediationSuggestionType = data.commandPlan
      ? AutoRemediationSuggestionType.CommandPlan
      : data.mcpToolCallPlan
        ? AutoRemediationSuggestionType.McpToolCalls
        : AutoRemediationSuggestionType.Runbook;

    return await RemediationChatMessage.getApprovalBlocks({
      suggestionId: data.suggestion.id,
      projectId: data.suggestion.projectId,
      incidentId: data.suggestion.incidentId,
      alertId: data.suggestion.alertId,
      suggestionType,
      commandPlan: data.commandPlan,
      mcpToolCallPlan: data.mcpToolCallPlan,
      runbookId: data.runbook?.id || undefined,
      runbookName: data.runbook?.name,
      verificationWindowMinutes: data.suggestion.verificationWindowMinutes,
    });
  }

  // The incident's or alert's page, where the fix's Remediation step is.
  public static async getSubjectUrl(
    fix: Pick<RemediationChatFix, "projectId" | "incidentId" | "alertId">,
  ): Promise<URL | null> {
    try {
      if (fix.incidentId) {
        return await IncidentService.getIncidentLinkInDashboard(
          fix.projectId,
          fix.incidentId,
        );
      }

      if (fix.alertId) {
        return await AlertService.getAlertLinkInDashboard(
          fix.projectId,
          fix.alertId,
        );
      }
    } catch (error) {
      logger.error(
        `RemediationChatMessage: could not build the record's link: ${error}`,
      );
    }

    return null;
  }
}
