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
  parseRemediationTrackRecord,
  RemediationTrackRecord,
  RemediationTrackRecordRun,
  RemediationTrackRecordTone,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import { isAiResourceType } from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { getResourceSentenceName } from "../../../Types/AI/ResourceAiAccessPermissions";
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
import { getLastingCloudChange } from "../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  OpenStackChangeReach,
  OpenStackReachInstance,
  OpenStackReachProject,
  describeOpenStackChangeReachCounts,
} from "../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import { MessageBlocksByWorkspaceType } from "../../Services/WorkspaceNotificationRuleService";
import AlertService from "../../Services/AlertService";
import IncidentService from "../../Services/IncidentService";
import { describeRemediationTrackRecord } from "../../../Types/AutoRemediation/RemediationTrackRecordWords";
import logger from "../Logger";
import SlackActionType from "../Workspace/Slack/Actions/ActionTypes";
import { getRemediationPlanFingerprint } from "../../../Types/AutoRemediation/RemediationPlanFingerprint";
import {
  getApprovalMessageNote,
  getViewInProductTitle,
  REMEDIATION_CHAT_WORDS,
} from "./RemediationChatWords";
import ProductBrandingText from "../ProductBrandingText";
import {
  getCountedFirstApproverId,
  getFixApprovalsNeeded,
  readTwoApprovalsRule,
} from "./RemediationApprovalsNeeded";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import User from "../../../Models/DatabaseModels/User";
import UserService from "../../Services/UserService";
import WorkspaceNotificationText from "../Workspace/WorkspaceNotificationText";
import {
  decodeRemediationApprovalStep,
  RemediationApprovalStep,
} from "../../../Types/AutoRemediation/RemediationApprovals";
import WorkspaceLiveMessageKey from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceLiveMessageService from "../../Services/WorkspaceLiveMessageService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import WorkspaceLiveMessages from "../Workspace/LiveMessages/WorkspaceLiveMessages";
import FeedPersonNameRule from "../Feed/FeedPersonNameRule";

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
  /*
   * How the runbook a Runbook fix proposes went the last times OneUptime
   * AI ran it as a fix here (the suggestion's runbookTrackRecord).
   */
  runbookTrackRecord?: RemediationTrackRecord | undefined;
  verificationWindowMinutes?: number | undefined;
  /*
   * How many people must approve it, as known when the message is made:
   * two for a riskier fix where the project asks two people to approve one
   * (Project.requireTwoApprovalsForRiskierFixes), else one. Left out, one.
   */
  approvalsNeeded?: number | undefined;
}

/*
 * Where a fix stands with the approvals it needs, for its approval dialog:
 * how many it needs and, for one that needs two, whether someone approved
 * it first, and who - their name, when it could be read.
 */
export interface RemediationChatApprovals {
  needed: number;
  hasFirstApproval: boolean;
  firstApproverName?: string | undefined;
  /*
   * What a press of the dialog's Approve does as it is shown: its button
   * carries it, and does nothing once that is no longer so.
   */
  step?: RemediationApprovalStep | undefined;
}

/*
 * Who someone is, as a fix's message names them: as every channel line
 * names a member (FeedPersonName), by their name, else the part of their
 * address before the "@" - never the address (#10669). Null when it cannot
 * be read - the message then says "Someone".
 */
async function readPersonName(userId: ObjectID): Promise<string | null> {
  try {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { name: true, email: true },
      props: { isRoot: true },
    });

    return (
      FeedPersonNameRule.getMemberName({
        name: user?.name,
        email: user?.email,
      }) || null
    );
  } catch (error) {
    logger.debug(
      `RemediationChatMessage: could not read the name of who acted on a fix: ${error}`,
    );
    return null;
  }
}

/*
 * How a fix stands, as its message in the chats says it (refreshKeptMessages):
 * it waits for approval; the first of the two a riskier fix needs is in,
 * from someone it names; someone approved it (after whose first, where it
 * needed two); someone dismissed it. A name is left out when it could not
 * be read.
 */
export type RemediationFixMessageState =
  | { kind: "waiting" }
  | { kind: "firstApproved"; firstApproverName?: string | undefined }
  | {
      kind: "approved";
      approverName?: string | undefined;
      firstApproverName?: string | undefined;
    }
  | { kind: "dismissed"; dismisserName?: string | undefined };

/*
 * The pages of the incidents and alerts a fix's track records name, by
 * getTrackRecordRunKey: what each name in a record's line links to
 * (getTrackRecordRunLinks). A run whose page could not be built is named
 * without a link.
 */
export type TrackRecordRunLinks = Map<string, URL>;

// The key a run's page is kept under: its kind and its incident's or alert's id.
export function getTrackRecordRunKey(run: RemediationTrackRecordRun): string {
  return `${run.subjectKind}:${run.subjectId.toLowerCase()}`;
}

/*
 * A button's value: the fix, the fingerprint of what it ran then and - on
 * an approval dialog's Approve - the step that press was offered as
 * (RemediationApprovalStep, encoded): the first of two approvals, the
 * second after someone's, or the only one. A dialog left open while that
 * changed does nothing when pressed (RemediationApproval).
 */
export interface RemediationActionValue {
  suggestionId: ObjectID;
  fingerprint: string;
  approvalStep?: string | undefined;
}

// What a message shows of a change's reasoning and answers, at most.
const MAX_RATIONALE_CHARS: number = 400;
const MAX_DRY_RUN_SUMMARY_CHARS: number = 400;
// How many projects and instances a change's chat message names.
const MAX_REACH_NAMES_IN_CHAT: number = 8;

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
 * How a chat breaks the lines of one change - its heading, its command,
 * how it went before. Slack breaks a line at a newline. Microsoft Teams
 * reads a single newline in a card's text as a space, and a change's
 * heading, command and record would run into one line there: in Teams each
 * line is a paragraph of its own, and each change a text block of its own
 * (getApprovalBlocks, describeApprovalParts).
 */
export function getChatLineBreak(workspaceType: WorkspaceType): string {
  return workspaceType === WorkspaceType.MicrosoftTeams ? "\n\n" : "\n";
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
 * A track record's line in a chat: its mark, its sentence and the incidents
 * and alerts it names, each a link to its page in OneUptime when one was
 * built - '✅ Worked both times it ran here before ([INC-41](...),
 * [#305](...)).' - as the AI card links them.
 */
export function describeTrackRecordLine(
  record: RemediationTrackRecord,
  links?: TrackRecordRunLinks | undefined,
): MarkdownText {
  const mark: string =
    TRACK_RECORD_MARKS[getRemediationTrackRecordTone(record)];
  const sentence: string = describeRemediationTrackRecord(record);
  const named: Array<MarkdownText> = record.runs
    .filter((run: RemediationTrackRecordRun): boolean => {
      return Boolean(run.subjectNumber);
    })
    .map((run: RemediationTrackRecordRun): MarkdownText => {
      const url: URL | undefined = links?.get(getTrackRecordRunKey(run));

      return url
        ? FeedMarkdown.link(run.subjectNumber || "", url.toString())
        : mdText`${run.subjectNumber || ""}`;
    });

  return named.length > 0
    ? mdText`${mark} ${sentence} (${FeedMarkdown.join(named, ", ")}).`
    : mdText`${mark} ${sentence}.`;
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
    // After "on", mid-sentence: "host", "database server", "Docker host".
    const noun: string = getResourceSentenceName(command.resourceType);
    const name: string = command.resourceNameSnapshot || "";

    return name ? `${noun} "${capped(name, 120)}"` : noun;
  }

  return null;
}

export default class RemediationChatMessage {
  // The key a fix's messages are kept under, wherever they were posted.
  public static getLiveMessageKey(suggestionId: ObjectID): string {
    return WorkspaceLiveMessageKey.forRemediationFix(suggestionId);
  }

  /*
   * What a feed entry that carries a fix's message posts with
   * (FeedWorkspaceNotification): the fix's blocks, appended to the entry,
   * and the key the posts are kept under, so a person approving or
   * dismissing the fix edits them in place (refreshKeptMessages). Nothing
   * when there are no blocks to append.
   */
  public static withFixMessage(data: {
    suggestionId?: ObjectID | null | undefined;
    appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
  }): {
    appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    keepPostsAs?: string | undefined;
  } {
    if (!data.appendMessageBlocks || data.appendMessageBlocks.length === 0) {
      return {};
    }

    return {
      appendMessageBlocks: data.appendMessageBlocks,
      ...(data.suggestionId
        ? {
            keepPostsAs: RemediationChatMessage.getLiveMessageKey(
              data.suggestionId,
            ),
          }
        : {}),
    };
  }

  // "<fix id>:<fingerprint>", and ":<step>" on a dialog's Approve.
  public static encodeActionValue(value: RemediationActionValue): string {
    const fix: string = `${value.suggestionId.toString()}${ACTION_VALUE_SEPARATOR}${value.fingerprint}`;

    return value.approvalStep
      ? `${fix}${ACTION_VALUE_SEPARATOR}${value.approvalStep}`
      : fix;
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
    const rest: string = value.slice(separator + 1);
    // A fingerprint is hex digits: what follows its separator is the step.
    const stepSeparator: number = rest.indexOf(ACTION_VALUE_SEPARATOR);
    const fingerprint: string =
      stepSeparator < 0 ? rest : rest.slice(0, stepSeparator);
    const approvalStep: string =
      stepSeparator < 0 ? "" : rest.slice(stepSeparator + 1);

    if (!ObjectID.isValidUUID(suggestionId) || !fingerprint) {
      return null;
    }

    if (stepSeparator >= 0 && !decodeRemediationApprovalStep(approvalStep)) {
      return null;
    }

    return {
      suggestionId: new ObjectID(suggestionId),
      fingerprint,
      ...(approvalStep ? { approvalStep } : {}),
    };
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
      runbookTrackRecord: parseRemediationTrackRecord(
        suggestion.runbookTrackRecord,
      ),
      verificationWindowMinutes: suggestion.verificationWindowMinutes,
    };
  }

  /*
   * The page of every incident and alert the fix's track records name - a
   * change's, its runbook's - built once each, so the names in a record's
   * line are links (describeTrackRecordLine). Empty when there are none; a
   * page that cannot be built is left out, and its name stays text.
   */
  public static async getTrackRecordRunLinks(
    fix: RemediationChatFix,
  ): Promise<TrackRecordRunLinks> {
    const links: TrackRecordRunLinks = new Map<string, URL>();
    const runs: Array<RemediationTrackRecordRun> = [
      ...(fix.commandPlan?.commands || []).flatMap(
        (command: AiRemediationCommand): Array<RemediationTrackRecordRun> => {
          return command.trackRecord?.runs || [];
        },
      ),
      ...(fix.runbookTrackRecord?.runs || []),
    ];

    for (const run of runs) {
      const key: string = getTrackRecordRunKey(run);

      if (
        links.has(key) ||
        !run.subjectNumber ||
        !ObjectID.isValidUUID(run.subjectId)
      ) {
        continue;
      }

      try {
        links.set(
          key,
          run.subjectKind === "incident"
            ? await IncidentService.getIncidentLinkInDashboard(
                fix.projectId,
                new ObjectID(run.subjectId),
              )
            : await AlertService.getAlertLinkInDashboard(
                fix.projectId,
                new ObjectID(run.subjectId),
              ),
        );
      } catch (error) {
        logger.error(
          `RemediationChatMessage: could not build the link of a track record's run: ${error}`,
        );
      }
    }

    return links;
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
   * What the fix runs, as chat Markdown, a part a change: its heading
   * (describeCommandHeading), its exact command and its track record, and
   * with details (the dialog) its reason, its undo and its dry run too -
   * each on a line of its own, broken as the chat breaks lines
   * (getChatLineBreak). An MCP fix is one part, a line a call; a runbook
   * one line.
   */
  public static describeChangeParts(
    fix: RemediationChatFix,
    options: {
      withDetails: boolean;
      // Slack's when not given.
      workspaceType?: WorkspaceType | undefined;
      // The pages a track record's names link to (getTrackRecordRunLinks).
      runLinks?: TrackRecordRunLinks | undefined;
    },
  ): Array<MarkdownText> {
    const workspaceType: WorkspaceType =
      options.workspaceType || WorkspaceType.Slack;

    if (
      fix.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
      fix.commandPlan
    ) {
      return fix.commandPlan.commands.map(
        (command: AiRemediationCommand): MarkdownText => {
          return RemediationChatMessage.describeCommand({
            command,
            withDetails: options.withDetails,
            workspaceType,
            runLinks: options.runLinks,
          });
        },
      );
    }

    if (
      fix.suggestionType === AutoRemediationSuggestionType.McpToolCalls &&
      fix.mcpToolCallPlan
    ) {
      const calls: Array<ExternalMcpToolCall> =
        ExternalMcpToolCallPlanUtil.getProposedCalls(fix.mcpToolCallPlan);

      if (calls.length === 0) {
        return [];
      }

      return [
        FeedMarkdown.join(
          calls.map((call: ExternalMcpToolCall): MarkdownText => {
            return mdText`**${String(call.sequence)}.** ${capped(call.serverNameSnapshot, 120)} · \`${capped(call.toolName, 120)}\``;
          }),
          getChatLineBreak(workspaceType),
        ),
      ];
    }

    const runbook: MarkdownText = mdText`Runbook **${capped(fix.runbookName || "Runbook", 200)}**`;

    // How the runbook went the last times it ran, on a line of its own.
    return fix.runbookTrackRecord
      ? [
          FeedMarkdown.join(
            [
              runbook,
              describeTrackRecordLine(fix.runbookTrackRecord, options.runLinks),
            ],
            getChatLineBreak(workspaceType),
          ),
        ]
      : [runbook];
  }

  // The changes as one Slack Markdown text: a change a paragraph.
  public static describeChanges(
    fix: RemediationChatFix,
    options: {
      withDetails: boolean;
      runLinks?: TrackRecordRunLinks | undefined;
    },
  ): MarkdownText {
    return FeedMarkdown.join(
      RemediationChatMessage.describeChangeParts(fix, {
        withDetails: options.withDetails,
        workspaceType: WorkspaceType.Slack,
        runLinks: options.runLinks,
      }),
      "\n\n",
    );
  }

  /*
   * A change's first line: its number and, for a cloud change, what it does
   * in plain words, in bold - then how risky it is and what it runs on:
   * '**1. Scale the ECS service checkout-api out to 8 tasks** · safe change
   * on AWS account "prod"'. A change with no plain words is headed by those
   * facts: '**2.** Riskier change on cluster "prod-eu-west-1"'.
   */
  public static describeCommandHeading(
    command: AiRemediationCommand,
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
    const facts: string = [tier, target ? `on ${target}` : null]
      .filter((fact: string | null): fact is string => {
        return Boolean(fact);
      })
      .join(" ");
    const sequence: string = String(command.sequence);

    if (words) {
      return facts
        ? mdText`**${sequence}. ${words.sentence}** · ${facts}`
        : mdText`**${sequence}. ${words.sentence}**`;
    }

    if (!facts) {
      return mdText`**${sequence}.**`;
    }

    const heading: string = `${facts.charAt(0).toUpperCase()}${facts.slice(1)}`;

    return mdText`**${sequence}.** ${heading}`;
  }

  private static describeCommand(data: {
    command: AiRemediationCommand;
    withDetails: boolean;
    workspaceType: WorkspaceType;
    runLinks?: TrackRecordRunLinks | undefined;
  }): MarkdownText {
    const { command, withDetails } = data;

    const lines: Array<MarkdownText> = [
      RemediationChatMessage.describeCommandHeading(command),
      mdText`\`${command.command}\``,
    ];

    if (withDetails && command.rationale) {
      const rationale: string = capped(command.rationale, MAX_RATIONALE_CHARS);

      lines.push(
        mdText`Why: ${
          data.workspaceType === WorkspaceType.MicrosoftTeams
            ? FeedMarkdown.aiWrittenForTeams(rationale)
            : FeedMarkdown.aiWritten(rationale)
        }`,
      );
    }

    if (withDetails && command.rollbackCommand) {
      lines.push(mdText`Undo: \`${command.rollbackCommand}\``);
    }

    if (withDetails && command.dryRun) {
      lines.push(RemediationChatMessage.describeDryRun(command));
    }

    // What it touches: the numbers always, for whoever is about to press Approve.
    if (command.reach) {
      lines.push(RemediationChatMessage.describeReach(command.reach));
    }

    /*
     * A change the code declares - a scale, a concurrency, a roll back - is
     * put back by the next apply, and can be a pull request to that code
     * too, asked for from the fix in OneUptime (DeclaredCodeChanges). A
     * restart, a reboot, a start or a fail over sets nothing the code
     * declares, so the next apply undoes none of them: the message says
     * nothing of the code there.
     */
    if (
      command.managedAsCode &&
      getLastingCloudChange({
        resourceType: command.resourceType,
        command: command.command,
      })
    ) {
      lines.push(
        mdText`Declared as code by ${command.managedAsCode}: the next apply may put the old value back. Open the fix in ${ProductBrandingText.getProductName()} to ask for a pull request to that code with the same change.`,
      );
    }

    const record: RemediationTrackRecord | undefined = command.trackRecord;

    if (record) {
      lines.push(describeTrackRecordLine(record, data.runLinks));
    }

    return FeedMarkdown.join(lines, getChatLineBreak(data.workspaceType));
  }

  /*
   * What an OpenStack change touches, as its cloud's AI agent read it: how many,
   * whose, and the first of them by name. The names come from the cloud's tenants, so
   * each goes in as a value, and nothing in one acts.
   */
  private static describeReach(reach: OpenStackChangeReach): MarkdownText {
    const named: (name: string) => MarkdownText = (
      name: string,
    ): MarkdownText => {
      return mdText`${capped(name, 80)}`;
    };
    const projects: Array<MarkdownText> = reach.projects
      .slice(0, MAX_REACH_NAMES_IN_CHAT)
      .map((project: OpenStackReachProject): MarkdownText => {
        return mdText`${named(project.name || project.id)} (${String(project.instanceCount)})`;
      });
    const instances: Array<MarkdownText> =
      reach.kind === "changes"
        ? reach.instances
            .slice(0, MAX_REACH_NAMES_IN_CHAT)
            .map((instance: OpenStackReachInstance): MarkdownText => {
              return named(instance.name || instance.id);
            })
        : [];
    const more: number =
      reach.kind === "changes" ? reach.instanceCount - instances.length : 0;
    const lines: Array<MarkdownText> = [
      mdText`${describeOpenStackChangeReachCounts(reach)}`,
    ];

    if (projects.length > 0) {
      lines.push(mdText`Projects: ${FeedMarkdown.join(projects, ", ")}.`);
    }

    if (instances.length > 0) {
      lines.push(
        more > 0
          ? mdText`Instances: ${FeedMarkdown.join(instances, ", ")}, and ${String(more)} more.`
          : mdText`Instances: ${FeedMarkdown.join(instances, ", ")}.`,
      );
    }

    if (reach.leftBehindCount > 0) {
      lines.push(
        mdText`It leaves ${String(reach.leftBehindCount)} more on that host, which it does not name.`,
      );
    }

    return FeedMarkdown.join(lines, " ");
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
   * The approval dialog in parts: what the fix is for, each change it runs,
   * and what approving does - in the person's own name, watched and undone.
   * Slack's modal joins them (describeApproval); Microsoft Teams' card draws
   * each as a text block of its own.
   */
  public static describeApprovalParts(data: {
    fix: RemediationChatFix;
    // "Incident INC-42", "Alert #305".
    subjectName: string;
    subjectTitle?: string | undefined;
    // Slack's when not given.
    workspaceType?: WorkspaceType | undefined;
    // The pages a track record's names link to (getTrackRecordRunLinks).
    runLinks?: TrackRecordRunLinks | undefined;
    // The approvals it needs, and the first one (a riskier fix's second).
    approvals?: RemediationChatApprovals | undefined;
  }): Array<MarkdownText> {
    const window: number = data.fix.verificationWindowMinutes || 15;
    const product: string = ProductBrandingText.getProductName();
    const watched: MarkdownText =
      data.fix.suggestionType === AutoRemediationSuggestionType.CommandPlan
        ? mdText`${product} then watches the monitors for ${String(window)} minutes and rolls back the changes that have an undo if they do not recover.`
        : mdText`${product} then watches the monitors for ${String(window)} minutes.`;

    const subject: MarkdownText = data.subjectTitle
      ? mdText`**${data.subjectName}:** ${capped(data.subjectTitle, 200)}`
      : mdText`**${data.subjectName}**`;

    return [
      subject,
      ...RemediationChatMessage.describeChangeParts(data.fix, {
        withDetails: true,
        workspaceType: data.workspaceType,
        runLinks: data.runLinks,
      }),
      RemediationChatMessage.describeWhatApprovingDoes({
        approvals: data.approvals,
        watched,
      }),
    ];
  }

  /*
   * The dialog's last part: what pressing its button does. Approving runs
   * the fix, under the person's name, watched - unless it is the first of
   * the two approvals a riskier fix needs, which runs nothing; the second
   * names whose approval came first.
   */
  public static describeWhatApprovingDoes(data: {
    approvals?: RemediationChatApprovals | undefined;
    watched: MarkdownText;
  }): MarkdownText {
    const approvals: RemediationChatApprovals | undefined = data.approvals;

    if (!approvals || approvals.needed < 2) {
      return mdText`Approving runs exactly what is shown, under your name. ${data.watched}`;
    }

    if (!approvals.hasFirstApproval) {
      return mdText`This fix holds a riskier change, so two people must approve it, and yours is the first. It runs once someone else approves it too.`;
    }

    return approvals.firstApproverName
      ? mdText`**${capped(approvals.firstApproverName, 120)}** approved this fix first. Approving it too runs exactly what is shown, under your name. ${data.watched}`
      : mdText`Someone else approved this fix first. Approving it too runs exactly what is shown, under your name. ${data.watched}`;
  }

  // The approval dialog as one Slack Markdown text: a part a paragraph.
  public static describeApproval(data: {
    fix: RemediationChatFix;
    // "Incident INC-42", "Alert #305".
    subjectName: string;
    subjectTitle?: string | undefined;
    runLinks?: TrackRecordRunLinks | undefined;
    approvals?: RemediationChatApprovals | undefined;
  }): MarkdownText {
    return FeedMarkdown.join(
      RemediationChatMessage.describeApprovalParts({
        ...data,
        workspaceType: WorkspaceType.Slack,
      }),
      "\n\n",
    );
  }

  /*
   * What a fix's message lists before its buttons, in a chat's blocks:
   * Slack's one text of every change; a text block a change in Microsoft
   * Teams (getChatLineBreak). For a runbook only how it went before, when
   * it ran before: the message above the buttons names it already, and its
   * dialog names it again.
   */
  private static getChangeBlocks(
    fix: RemediationChatFix,
    workspaceType: WorkspaceType,
    runLinks: TrackRecordRunLinks,
  ): Array<WorkspacePayloadMarkdown> {
    if (fix.suggestionType === AutoRemediationSuggestionType.Runbook) {
      return fix.runbookTrackRecord
        ? [
            {
              _type: "WorkspacePayloadMarkdown",
              text: describeTrackRecordLine(
                fix.runbookTrackRecord,
                runLinks,
              ).toString(),
            },
          ]
        : [];
    }

    const parts: Array<MarkdownText> =
      workspaceType === WorkspaceType.MicrosoftTeams
        ? RemediationChatMessage.describeChangeParts(fix, {
            withDetails: false,
            workspaceType,
            runLinks,
          })
        : [
            RemediationChatMessage.describeChanges(fix, {
              withDetails: false,
              runLinks,
            }),
          ];

    return parts
      .map((part: MarkdownText): string => {
        return part.toString();
      })
      .filter((text: string): boolean => {
        return Boolean(text.trim());
      })
      .map((text: string): WorkspacePayloadMarkdown => {
        return { _type: "WorkspacePayloadMarkdown", text };
      });
  }

  /*
   * The blocks a "needs your approval" message carries in the record's
   * Slack and Microsoft Teams channels: the changes, then Review and
   * approve, Dismiss and View in OneUptime, and a quiet line on what
   * pressing does. Empty when the fix cannot be described - the message
   * then says what it always said.
   */
  public static async getApprovalBlocks(
    fix: RemediationChatFix,
    // How it stands, once someone acted on it; left out, it waits.
    state: RemediationFixMessageState = { kind: "waiting" },
  ): Promise<Array<MessageBlocksByWorkspaceType>> {
    try {
      const value: string = RemediationChatMessage.encodeActionValue({
        suggestionId: fix.suggestionId,
        fingerprint: RemediationChatMessage.getFingerprint(fix),
      });

      const viewUrl: URL | null =
        await RemediationChatMessage.getSubjectUrl(fix);
      const runLinks: TrackRecordRunLinks =
        await RemediationChatMessage.getTrackRecordRunLinks(fix);

      /*
       * A fix that waits - for its first approval, or its second - keeps
       * Review and approve and Dismiss; one that was approved or dismissed
       * keeps only View in OneUptime: its buttons would do nothing now.
       */
      const isWaiting: boolean =
        state.kind === "waiting" || state.kind === "firstApproved";

      const buttons: Array<WorkspaceMessagePayloadButton> = isWaiting
        ? [
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
          ]
        : [];

      if (viewUrl) {
        buttons.push({
          _type: "WorkspaceMessagePayloadButton",
          title: getViewInProductTitle(),
          value: "",
          url: viewUrl,
          actionId: SlackActionType.OpenInOneUptime,
        });
      }

      const buttonsBlock: WorkspacePayloadButtons | null =
        buttons.length > 0
          ? {
              _type: "WorkspacePayloadButtons",
              buttons,
            }
          : null;

      // What pressing does now, or what came of the fix.
      const note: WorkspacePayloadContext = {
        _type: "WorkspacePayloadContext",
        text: RemediationChatMessage.describeMessageNote({
          approvalsNeeded: fix.approvalsNeeded || 1,
          state,
        }).toString(),
      };

      return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
        (workspaceType: WorkspaceType): MessageBlocksByWorkspaceType => {
          const blocks: Array<WorkspaceMessageBlock> = [
            ...RemediationChatMessage.getChangeBlocks(
              fix,
              workspaceType,
              runLinks,
            ),
            ...(buttonsBlock ? [buttonsBlock] : []),
            note,
          ];

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
   * The quiet line under a fix's buttons, as the fix stands: what pressing
   * Review and approve does while it waits (two people where it needs two);
   * once the first of two approvals is in, whose it was and that someone
   * else's runs it - so the message never reads as if one more press from
   * anyone runs it; once it was approved or dismissed, who did. Names are
   * text, never markdown (mdText).
   */
  public static describeMessageNote(data: {
    approvalsNeeded: number;
    state: RemediationFixMessageState;
  }): MarkdownText {
    const state: RemediationFixMessageState = data.state;

    switch (state.kind) {
      case "firstApproved":
        return state.firstApproverName
          ? mdText`**${capped(state.firstApproverName, 120)}** approved this fix first. It runs once someone else approves it too. Review and approve shows the whole fix before you do.`
          : mdText`Someone approved this fix first. It runs once someone else approves it too. Review and approve shows the whole fix before you do.`;
      case "approved":
        if (!state.approverName) {
          return mdText`✅ This fix was approved.`;
        }

        return state.firstApproverName
          ? mdText`✅ **${capped(state.approverName, 120)}** approved this fix, after **${capped(state.firstApproverName, 120)}** approved it first.`
          : mdText`✅ **${capped(state.approverName, 120)}** approved this fix.`;
      case "dismissed":
        return state.dismisserName
          ? mdText`**${capped(state.dismisserName, 120)}** dismissed this fix.`
          : mdText`This fix was dismissed.`;
      default:
        return mdText`${getApprovalMessageNote(data.approvalsNeeded)}`;
    }
  }

  /*
   * How a fix stands, as its message says it, from its row as it is now:
   * the first of two approvals that counts (for the plan it holds) names
   * who gave it; an approval names who gave it, and whose came first; a
   * dismissal names who dismissed it. Null for a fix its message has
   * nothing new to say of: still being planned, run without asking, or
   * found to have nothing that applies.
   */
  public static async getMessageState(
    suggestion: Pick<
      AutoRemediationSuggestion,
      | "status"
      | "approvedByUserId"
      | "dismissedByUserId"
      | "firstApprovedByUserId"
      | "firstApprovedPlanFingerprint"
      | "suggestionType"
      | "commandPlan"
      | "mcpToolCallPlan"
      | "runbookId"
    >,
  ): Promise<RemediationFixMessageState | null> {
    const firstApproverId: ObjectID | undefined =
      getCountedFirstApproverId(suggestion);

    switch (suggestion.status) {
      case AutoRemediationSuggestionStatus.Suggested:
        return firstApproverId
          ? {
              kind: "firstApproved",
              firstApproverName:
                (await readPersonName(firstApproverId)) || undefined,
            }
          : { kind: "waiting" };
      case AutoRemediationSuggestionStatus.Approved: {
        const approverId: ObjectID | undefined =
          suggestion.approvedByUserId || undefined;
        const isSomeoneElseFirst: boolean = Boolean(
          firstApproverId &&
            approverId &&
            firstApproverId.toString().toLowerCase() !==
              approverId.toString().toLowerCase(),
        );

        return {
          kind: "approved",
          approverName: approverId
            ? (await readPersonName(approverId)) || undefined
            : undefined,
          firstApproverName:
            isSomeoneElseFirst && firstApproverId
              ? (await readPersonName(firstApproverId)) || undefined
              : undefined,
        };
      }
      case AutoRemediationSuggestionStatus.Dismissed:
        return {
          kind: "dismissed",
          dismisserName: suggestion.dismissedByUserId
            ? (await readPersonName(suggestion.dismissedByUserId)) || undefined
            : undefined,
        };
      default:
        return null;
    }
  }

  /*
   * Edits a fix's message in every place it was posted and kept (its feed
   * entry's blocks as they were, then the fix's, as it now stands): the
   * first of two approvals names who gave it, so its buttons never read as
   * if one press runs it; an approval or a dismissal takes Review and
   * approve and Dismiss away and says who acted. How it stands is read
   * from the fix's row with its messages held, so two edits racing (a
   * first approval, then the second) always end on the newer. Best effort
   * and never throws: a message that cannot be edited still says what it
   * said, and the record's feed says the rest.
   */
  public static async refreshKeptMessages(data: {
    suggestionId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const messageKey: string = RemediationChatMessage.getLiveMessageKey(
      data.suggestionId,
    );

    try {
      await WorkspaceLiveMessages.withLock(
        messageKey,
        async (): Promise<void> => {
          const kept: Array<WorkspaceLiveMessage> =
            await WorkspaceLiveMessageService.findByMessageKey({
              projectId: data.projectId,
              messageKey,
            });

          if (kept.length === 0) {
            return;
          }

          const suggestion: AutoRemediationSuggestion | null =
            await AutoRemediationSuggestionService.findOneBy({
              query: { _id: data.suggestionId, projectId: data.projectId },
              select: {
                _id: true,
                projectId: true,
                incidentId: true,
                alertId: true,
                status: true,
                approvedByUserId: true,
                dismissedByUserId: true,
                firstApprovedByUserId: true,
                firstApprovedPlanFingerprint: true,
                suggestionType: true,
                commandPlan: true,
                mcpToolCallPlan: true,
                runbookId: true,
                runbookNameSnapshot: true,
                runbookTrackRecord: true,
                verificationWindowMinutes: true,
              },
              props: { isRoot: true },
            });

          const fix: RemediationChatFix | null = suggestion
            ? RemediationChatMessage.fromSuggestion(suggestion)
            : null;

          const state: RemediationFixMessageState | null = suggestion
            ? await RemediationChatMessage.getMessageState(suggestion)
            : null;

          if (!fix || !state) {
            return;
          }

          // A fix that still waits says what a press does now, as its post did.
          if (state.kind === "waiting") {
            fix.approvalsNeeded =
              await RemediationChatMessage.readApprovalsNeeded(fix);
          }

          const blocksByWorkspaceType: Array<MessageBlocksByWorkspaceType> =
            await RemediationChatMessage.getApprovalBlocks(fix, state);

          for (const keptMessage of kept) {
            const appended: Array<WorkspaceMessageBlock> | undefined =
              blocksByWorkspaceType.find(
                (blocks: MessageBlocksByWorkspaceType): boolean => {
                  return blocks.workspaceType === keptMessage.workspaceType;
                },
              )?.messageBlocks;

            if (!appended) {
              continue;
            }

            const messageBlocks: Array<WorkspaceMessageBlock> = [
              ...(keptMessage.messageData?.leadBlocks || []),
              ...appended,
            ];

            await WorkspaceLiveMessages.updateKept({
              keptMessage,
              messageBlocks,
              text: WorkspaceNotificationText.fromBlocks(messageBlocks),
            });
          }
        },
      );
    } catch (error) {
      logger.error(
        `RemediationChatMessage: could not update the messages of suggestion ${data.suggestionId.toString()} in place: ${error}`,
      );
    }
  }

  /*
   * How many approvals a fix needs now, as its proposal's message says it:
   * two for a riskier command plan or a fix through MCP servers where the
   * project asks for two (read now; unknown, one), one otherwise.
   */
  public static async readApprovalsNeeded(
    fix: Pick<
      RemediationChatFix,
      "projectId" | "suggestionType" | "commandPlan"
    >,
  ): Promise<number> {
    if (fix.suggestionType === AutoRemediationSuggestionType.Runbook) {
      return 1;
    }

    return getFixApprovalsNeeded({
      project: {
        requireTwoApprovalsForRiskierFixes:
          (await readTwoApprovalsRule(fix.projectId)) === true,
      },
      suggestionType: fix.suggestionType,
      plan: fix.commandPlan,
    });
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
    // How the runbook went the last times it ran (RemediationPlanRunner).
    runbookTrackRecord?: RemediationTrackRecord | undefined;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    if (!data.suggestion.id || !data.suggestion.projectId) {
      return [];
    }

    const suggestionType: AutoRemediationSuggestionType = data.commandPlan
      ? AutoRemediationSuggestionType.CommandPlan
      : data.mcpToolCallPlan
        ? AutoRemediationSuggestionType.McpToolCalls
        : AutoRemediationSuggestionType.Runbook;

    /*
     * Whether two people must approve it: a riskier command plan, or a
     * fix through MCP servers, in a project that asks for two (read now;
     * unknown, the message says what it says of one approval, and the
     * approval itself decides).
     */
    const approvalsNeeded: number =
      suggestionType !== AutoRemediationSuggestionType.Runbook
        ? getFixApprovalsNeeded({
            project: {
              requireTwoApprovalsForRiskierFixes:
                (await readTwoApprovalsRule(data.suggestion.projectId)) ===
                true,
            },
            suggestionType,
            plan: data.commandPlan,
          })
        : 1;

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
      runbookTrackRecord: data.runbookTrackRecord,
      verificationWindowMinutes: data.suggestion.verificationWindowMinutes,
      approvalsNeeded,
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
