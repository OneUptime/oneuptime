import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import AccessTokenService from "../../Services/AccessTokenService";
import ProjectService from "../../Services/ProjectService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserService from "../../Services/UserService";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import PushNotificationUtil from "../PushNotificationUtil";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { securityCaseGroupingKey } from "./SecurityCaseIngest";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import {
  SecurityCaseNotificationChoiceKind,
  SecurityCaseNotificationPriorityChoice,
  describeSecurityCaseNotificationChoice,
  getSecurityCaseNotificationPriorityChoices,
  readSecurityCaseNotificationMinimum,
  reachesNotificationPriorityNow,
} from "../../../Utils/SecurityCase/SecurityCaseNotificationPriority";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "./SecurityCaseValues";
import {
  SecurityEntity,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { describeMitreId } from "../../../Types/SecurityEvent/MitreAttack";
import { SETUP_TEST_SOURCE_IP } from "../../../Types/SecurityEvent/SecuritySetupTest";
import { getSecurityPlaybookAction } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
  readStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import EmailColorUtil from "../../../Utils/Email/EmailColorUtil";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { securityCaseSummaryMarkdown } from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";

/*
 * TELLING PEOPLE ABOUT SECURITY CASES.
 *
 * Three things about a case need a person, and each is sent through the
 * notification settings every other event uses - email, SMS, call, push,
 * WhatsApp, Telegram, Slack and Microsoft Teams messages to the person,
 * webhooks - as the person chose (User Settings > Notification Settings):
 *
 *  - A case opens, or rises, at the priority the person chose (High and
 *    above when they chose none): SEND_SECURITY_CASE_OPENED_NOTIFICATION, to
 *    everyone who can read the case. Once per person: the case keeps the
 *    highest priority people were told about it at
 *    (notifiedSecurityCasePriorityId), so a
 *    rise is told only to the people whose priority it newly reaches.
 *  - A case is assigned to the person, or to a team they are on:
 *    SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION.
 *  - A playbook step on a case waits for approval:
 *    SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION, to the people on the case
 *    who can approve it - its assignee and its team's members - or, when
 *    none of them can, to everyone who can.
 *
 * Each is also posted to the Slack and Microsoft Teams channels and chats the
 * project's Security Case rules name (WorkspaceNotificationRuleService), and
 * the case's feed says who was told.
 *
 * Only people who can read the case are ever told about it: a case is the
 * investigation trail of a possible breach, which a project-wide Viewer is
 * not shown, and a notification is the case in another place. Whether a
 * person can read it is asked of the same check a read of theirs goes
 * through, labels and blocks included. Nobody is told about what they did
 * themselves, and nobody is told about the setup test's case: the test
 * notifies, pages and contains nothing.
 *
 * The case's service, the detection ingest and the playbook engine only
 * queue a job (SECURITY_CASE_NOTIFICATION_JOB) and never wait on, or fail
 * on, a notification; the Worker sends it.
 */
export const SECURITY_CASE_NOTIFICATION_JOB: string =
  "SecurityCases:SendNotification";

/*
 * How long a new or raised case waits before people are told: long enough
 * for what opened it to finish around it - the detection ingest attaches the
 * case's first detection and may raise it with the next one of its batch, the
 * Case Opened playbooks start and may assign it - so one message describes
 * the case as it stands.
 */
export const SECURITY_CASE_PRIORITY_NOTIFICATION_DELAY_MS: number = 15 * 1000;

/*
 * A case first told about this long after it opened has been open a while:
 * its message says it rose to its priority, not that it is new.
 */
const NEW_CASE_WINDOW_MS: number = 60 * 60 * 1000;

// At most this many entities are named in a message; the rest are counted.
const ENTITY_NAME_LIMIT: number = 10;

export enum SecurityCaseNotificationKind {
  PriorityReached = "PriorityReached",
  Assigned = "Assigned",
  ApprovalRequested = "ApprovalRequested",
}

export interface SecurityCaseRecipient {
  userId: ObjectID;
  name: string;
  email: string;
}

// What every message about a case says about it.
export interface SecurityCaseMessageFacts {
  caseId: ObjectID;
  projectId: ObjectID;
  number: string;
  title: string;
  // The case's priority and status, as the project names them.
  priority: string;
  priorityColor: Color;
  /*
   * At or above the project's critical priority: sent at once, never held
   * for a rollup, and asked to be acknowledged on a phone.
   */
  isCritical: boolean;
  status: string;
  source: string;
  assignee: string;
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  detectionCount: number;
  projectName: string;
  url: string;
  descriptionHtml: string;
}

// What one notification says, in every form a person may receive it.
export interface SecurityCaseMessage {
  eventType: NotificationSettingEventType;
  subject: string;
  templateType: EmailTemplateType;
  emailVars: Dictionary<string>;
  smsText: string;
  callText: string;
  pushTitle: string;
  pushBody: string;
  pushType: string;
  requireInteraction: boolean;
  forceImmediate: boolean;
}

// A job's own words, read back from the queue.
function readId(data: JSONObject, key: string): ObjectID | undefined {
  const value: JSONValue | undefined = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : undefined;
}

function readText(data: JSONObject, key: string): string | undefined {
  const value: JSONValue | undefined = data[key];

  return typeof value === "string" && value ? value : undefined;
}

// "a1, a2 and 3 more": what a message names a case's entities by.
export function describeEntities(entities: Array<SecurityEntity>): string {
  const shown: Array<string> = entities
    .slice(0, ENTITY_NAME_LIMIT)
    .map((entity: SecurityEntity): string => {
      return `${entity.value} (${entity.type})`;
    });
  const more: number = entities.length - shown.length;

  return `${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}

// "Critical only", "High and above": a person's choice, as the setting names it.
export function describePriorityChoice(
  choice: Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind">,
): string {
  return describeSecurityCaseNotificationChoice(choice);
}

/*
 * A person's chosen minimum as a choice of the setting: its name, and
 * whether it is the top priority, the last one or one between - read off
 * the whole list, archived priorities among them.
 */
export function getChosenPriorityChoice(data: {
  priorities: ReadonlyArray<SecurityCasePriority>;
  minimum: SecurityCasePriority;
}): Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind"> {
  const choice: SecurityCaseNotificationPriorityChoice | undefined =
    getSecurityCaseNotificationPriorityChoices({
      priorities: data.priorities,
      currentId: data.minimum.id,
    }).find((candidate: SecurityCaseNotificationPriorityChoice): boolean => {
      return candidate.priorityId === data.minimum.id?.toString();
    });

  return (
    choice || {
      name: data.minimum.name || "",
      kind: SecurityCaseNotificationChoiceKind.AndAbove,
    }
  );
}

// "Step 2 (Contain CrowdStrike host)".
export function describeStep(
  stepNumber: number,
  step: SecurityPlaybookStep | undefined,
): string {
  const title: string = step
    ? getSecurityPlaybookAction(step.action)?.title || step.action
    : "";

  return title ? `step ${stepNumber} (${title})` : `step ${stepNumber}`;
}

// How a run started, for the approval email's "Started" row.
export function describeRunTrigger(
  trigger: SecurityPlaybookTrigger | string | undefined,
): string {
  switch (trigger) {
    case SecurityPlaybookTrigger.CaseOpened:
      return "Automatically, when the case opened";
    case SecurityPlaybookTrigger.DetectionAdded:
      return "Automatically, for a new detection";
    case SecurityPlaybookTrigger.TriagedAsLikelyMalicious:
      return "Automatically, when AI triage read the case as Likely Malicious";
    default:
      return "By hand";
  }
}

// The setup test's case is about its documentation address, and nobody is told about it.
export function isSetupTestCase(
  securityCase: Pick<SecurityCase, "groupingKey">,
): boolean {
  return (
    securityCase.groupingKey ===
    securityCaseGroupingKey({
      groupValue: SETUP_TEST_SOURCE_IP,
      fingerprint: "",
    })
  );
}

/*
 * What people are told when a case opens at their priority, or rises to it:
 * new when nobody was told about it before and it opened within the hour,
 * risen otherwise.
 */
export function buildPriorityReachedMessage(data: {
  facts: SecurityCaseMessageFacts;
  isNew: boolean;
  minimum: Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind">;
}): SecurityCaseMessage {
  const { facts, isNew } = data;
  const headline: string = isNew
    ? `New ${facts.priority} security case ${facts.number}`
    : `Security case ${facts.number} is now ${facts.priority}`;

  return {
    eventType:
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
    subject: isNew
      ? `[${facts.number}] New ${facts.priority} security case: ${facts.title}`
      : `[${facts.number}] Security case is now ${facts.priority}: ${facts.title}`,
    templateType: EmailTemplateType.SecurityCaseOpened,
    emailVars: {
      ...getCaseEmailVars(facts),
      emailTitle: `Security Case ${facts.number}: ${facts.title}`,
      leadSentence: isNew
        ? `A new ${facts.priority} security case opened in ${facts.projectName}. Nobody may be on it yet.`
        : `This security case in ${facts.projectName} is now ${facts.priority}.`,
      reasonSentence: `You can see this project's security cases, and you are told about cases at your chosen priority: ${describePriorityChoice(data.minimum)}. Change it in User Settings > Notification Settings.`,
    },
    smsText: buildNotificationSms(
      isNew
        ? `New ${facts.priority} security case ${facts.number}: ${facts.title}.`
        : `Security case ${facts.number} is now ${facts.priority}: ${facts.title}.`,
    ),
    callText: `This is a message from OneUptime. ${headline}: ${facts.title}. Open OneUptime to look into it. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.`,
    pushTitle: headline,
    pushBody: `${facts.title} (${facts.projectName})`,
    pushType: "security-case-opened",
    requireInteraction: facts.isCritical,
    // A Critical case is never held back in an email rollup.
    forceImmediate: facts.isCritical,
  };
}

/*
 * What a person is told when a case is assigned to them, or to a team they
 * are on. `assignedBy` names who did it: a person, or a playbook.
 */
export function buildAssignedMessage(data: {
  facts: SecurityCaseMessageFacts;
  teamName?: string | undefined;
  assignedBy?: string | undefined;
}): SecurityCaseMessage {
  const { facts } = data;
  const toWhom: string = data.teamName ? data.teamName : "you";
  const assignedTo: string = data.teamName
    ? `${data.teamName}, a team you are on`
    : "you";

  return {
    eventType:
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
    subject: `[${facts.number}] Security case assigned to ${toWhom}: ${facts.title}`,
    templateType: EmailTemplateType.SecurityCaseAssigned,
    emailVars: {
      ...getCaseEmailVars(facts),
      emailTitle: `Security Case ${facts.number}: ${facts.title}`,
      leadSentence: data.assignedBy
        ? `${data.assignedBy} assigned this ${facts.priority} security case to ${assignedTo}.`
        : `This ${facts.priority} security case was assigned to ${assignedTo}.`,
      reasonSentence: data.teamName
        ? `You are on ${data.teamName}, the team this case is assigned to. Change these emails in User Settings > Notification Settings.`
        : "This case was assigned to you. Change these emails in User Settings > Notification Settings.",
    },
    smsText: buildNotificationSms(
      `Security case ${facts.number} (${facts.priority}) is assigned to ${toWhom}: ${facts.title}.`,
    ),
    callText: `This is a message from OneUptime. Security case ${facts.number}, priority ${facts.priority}, is assigned to ${toWhom}: ${facts.title}. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.`,
    pushTitle: `Security case ${facts.number} assigned to ${toWhom}`,
    pushBody: `${facts.priority}: ${facts.title}`,
    pushType: "security-case-assigned",
    requireInteraction: facts.isCritical,
    forceImmediate: facts.isCritical,
  };
}

/*
 * What a person is told when a playbook step on a case waits for approval:
 * the run does nothing until somebody approves or rejects it, so it is never
 * held back in an email rollup.
 */
export function buildApprovalRequestedMessage(data: {
  facts: SecurityCaseMessageFacts;
  playbookName: string;
  stepDescription: string;
  startedBy: string;
  isOnCase: boolean;
  // What a Contain step proposes to act on, for the approver to check.
  targets?: Array<string> | undefined;
}): SecurityCaseMessage {
  const { facts } = data;
  const targets: string = (data.targets || []).join(", ");

  return {
    eventType:
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    subject: `[${facts.number}] Approval needed: ${data.playbookName}, ${data.stepDescription}`,
    templateType: EmailTemplateType.SecurityPlaybookApprovalRequested,
    emailVars: {
      ...getCaseEmailVars(facts),
      emailTitle: `Approval needed: ${data.playbookName}`,
      leadSentence: `Playbook ${data.playbookName} is waiting for someone to approve ${data.stepDescription} on security case ${facts.number}. The run does nothing until somebody approves or rejects it on the case.`,
      reasonSentence: data.isOnCase
        ? "You can approve playbook steps, and this case is assigned to you or to a team you are on. Change these emails in User Settings > Notification Settings."
        : "You can approve playbook steps, and nobody the case is assigned to can. Change these emails in User Settings > Notification Settings.",
      playbookName: data.playbookName,
      stepDescription: data.stepDescription,
      stepTargets: targets,
      startedBy: data.startedBy,
    },
    smsText: buildNotificationSms(
      `Approval needed on security case ${facts.number}: playbook ${data.playbookName}, ${data.stepDescription}${targets ? ` on ${targets}` : ""}.`,
    ),
    callText: `This is a message from OneUptime. Playbook ${data.playbookName} is waiting for your approval on security case ${facts.number}: ${facts.title}. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.`,
    pushTitle: `Approval needed: ${data.playbookName}`,
    pushBody: `${data.stepDescription} on ${facts.number}: ${facts.title}`,
    pushType: "security-playbook-approval",
    requireInteraction: true,
    forceImmediate: true,
  };
}

// The case's own rows of the three emails.
function getCaseEmailVars(facts: SecurityCaseMessageFacts): Dictionary<string> {
  return {
    caseNumber: facts.number,
    caseTitle: facts.title,
    casePriority: facts.priority,
    caseStatus: facts.status,
    caseSource: facts.source,
    caseAssignee: facts.assignee,
    caseEntities: describeEntities(facts.entities),
    caseMitreTactics: facts.mitreTactics
      .map((tactic: string): string => {
        return describeMitreId(tactic);
      })
      .join(", "),
    caseDescription: facts.descriptionHtml,
    caseViewLink: facts.url,
    projectName: facts.projectName,
    priorityBadgeText: facts.priority,
    ...EmailColorUtil.getTemplateVariables("priority", facts.priorityColor),
  };
}

// The case in a few lines, after what happened, for Slack and Microsoft Teams.
export function buildChannelMarkdown(data: {
  headline: MarkdownText;
  facts: SecurityCaseMessageFacts;
}): MarkdownText {
  return FeedMarkdown.join(
    [
      data.headline,
      securityCaseSummaryMarkdown({
        caseNumber: data.facts.number,
        title: data.facts.title,
        priority: data.facts.priority,
        status: data.facts.status,
        assignee:
          data.facts.assignee === "Unassigned"
            ? undefined
            : data.facts.assignee,
        detectionCount: data.facts.detectionCount,
        entities: data.facts.entities,
        mitreTactics: data.facts.mitreTactics,
        url: data.facts.url,
      }),
    ],
    "\n\n",
  );
}

// "3 people", "1 person".
function people(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

export default class SecurityCaseNotifications {
  // ---------- Queueing: what the case's writers call ----------

  /*
   * The case opened, or its priority went up: tell the people whose chosen
   * priority it reaches. `actorUserId` is the person who opened or raised it,
   * who is not told.
   */
  @CaptureSpan()
  public static async caseReachedPriority(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actorUserId?: ObjectID | undefined;
  }): Promise<void> {
    await this.enqueue(
      {
        kind: SecurityCaseNotificationKind.PriorityReached,
        projectId: data.projectId.toString(),
        securityCaseId: data.securityCaseId.toString(),
        ...(data.actorUserId
          ? { actorUserId: data.actorUserId.toString() }
          : {}),
      },
      SECURITY_CASE_PRIORITY_NOTIFICATION_DELAY_MS,
    );
  }

  /*
   * The case was assigned to a user, a team, or both. `actorUserId` made the
   * change, `playbookName` when a playbook did.
   */
  @CaptureSpan()
  public static async caseAssigned(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    userId?: ObjectID | undefined;
    teamId?: ObjectID | undefined;
    actorUserId?: ObjectID | undefined;
    playbookName?: string | undefined;
  }): Promise<void> {
    if (!data.userId && !data.teamId) {
      return;
    }

    await this.enqueue(
      {
        kind: SecurityCaseNotificationKind.Assigned,
        projectId: data.projectId.toString(),
        securityCaseId: data.securityCaseId.toString(),
        ...(data.userId ? { userId: data.userId.toString() } : {}),
        ...(data.teamId ? { teamId: data.teamId.toString() } : {}),
        ...(data.actorUserId
          ? { actorUserId: data.actorUserId.toString() }
          : {}),
        ...(data.playbookName ? { playbookName: data.playbookName } : {}),
      },
      0,
    );
  }

  // A run stopped in Waiting for Approval.
  @CaptureSpan()
  public static async approvalRequested(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    runId: ObjectID;
  }): Promise<void> {
    await this.enqueue(
      {
        kind: SecurityCaseNotificationKind.ApprovalRequested,
        projectId: data.projectId.toString(),
        securityCaseId: data.securityCaseId.toString(),
        runId: data.runId.toString(),
      },
      0,
    );
  }

  // Never throws: a case's change must not fail because nobody could be told.
  private static async enqueue(
    data: JSONObject,
    delayInMs: number,
  ): Promise<void> {
    try {
      await Queue.addJob(
        QueueName.Worker,
        `security-case-notification-${ObjectID.generate().toString()}`,
        SECURITY_CASE_NOTIFICATION_JOB,
        data,
        {
          ...(delayInMs > 0 ? { delayInMs } : {}),
          attempts: 3,
          backoffDelayInMs: 10000,
          skipExistenceCheck: true,
        },
      );
    } catch (error) {
      logger.error(
        `SecurityCaseNotifications: could not queue a ${String(data["kind"])} notification for case ${String(data["securityCaseId"])}:`,
      );
      logger.error(error);
    }
  }

  // ---------- The job ----------

  @CaptureSpan()
  public static async runJob(data: JSONObject): Promise<void> {
    const projectId: ObjectID | undefined = readId(data, "projectId");
    const securityCaseId: ObjectID | undefined = readId(data, "securityCaseId");

    if (!projectId || !securityCaseId) {
      logger.warn(
        "SecurityCaseNotifications: a notification job without its project or case was dropped.",
      );
      return;
    }

    switch (readText(data, "kind")) {
      case SecurityCaseNotificationKind.PriorityReached:
        await this.notifyPriorityReached({
          projectId,
          securityCaseId,
          actorUserId: readId(data, "actorUserId"),
        });
        return;
      case SecurityCaseNotificationKind.Assigned:
        await this.notifyAssigned({
          projectId,
          securityCaseId,
          userId: readId(data, "userId"),
          teamId: readId(data, "teamId"),
          actorUserId: readId(data, "actorUserId"),
          playbookName: readText(data, "playbookName"),
        });
        return;
      case SecurityCaseNotificationKind.ApprovalRequested: {
        const runId: ObjectID | undefined = readId(data, "runId");

        if (runId) {
          await this.notifyApprovalRequested({
            projectId,
            securityCaseId,
            runId,
          });
        }
        return;
      }
      default:
        logger.warn(
          `SecurityCaseNotifications: a notification job of an unknown kind (${String(data["kind"])}) was dropped.`,
        );
    }
  }

  // ---------- A case at somebody's priority ----------

  @CaptureSpan()
  public static async notifyPriorityReached(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actorUserId?: ObjectID | undefined;
  }): Promise<Array<SecurityCaseRecipient>> {
    const securityCase: SecurityCase | null = await this.readCase(data);

    if (!securityCase || isSetupTestCase(securityCase)) {
      return [];
    }

    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(data.projectId);

    const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
      values.priorities,
      securityCase.securityCasePriorityId,
    );

    if (
      !priority?.id ||
      SecurityCaseStatuses.isClosed(
        values.statuses,
        securityCase.securityCaseStatusId,
      )
    ) {
      return [];
    }

    // A priority the project no longer has reads as nothing told yet.
    const notifiedPriority: SecurityCasePriority | null =
      SecurityCasePriorities.find(
        values.priorities,
        securityCase.notifiedSecurityCasePriorityId,
      );

    if (
      !SecurityCasePriorities.isMoreUrgent(
        values.priorities,
        priority.id,
        notifiedPriority?.id,
      )
    ) {
      return [];
    }

    const priorityName: string = priority.name || "";

    // What people were told as read, before this worker claims the rise.
    const toldAtId: ObjectID | null =
      securityCase.notifiedSecurityCasePriorityId || null;

    /*
     * Claimed in one compare-and-set from what was read: of two workers
     * handed the same rise (the case opened and rose in one batch), one tells
     * people and the other finds nothing new.
     */
    const isClaimed: boolean =
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: data.securityCaseId,
        data: {
          notifiedSecurityCasePriorityId: priority.id,
        },
        expectedData: {
          notifiedSecurityCasePriorityId: toldAtId as unknown as ObjectID,
        },
        skipUpdateDateColumn: true,
      });

    if (!isClaimed) {
      return [];
    }

    // Told about at no priority yet: news of a case that just opened.
    const isNew: boolean =
      !toldAtId &&
      Boolean(securityCase.createdAt) &&
      OneUptimeDate.getCurrentDate().getTime() -
        new Date(securityCase.createdAt!).getTime() <
        NEW_CASE_WINDOW_MS;

    const facts: SecurityCaseMessageFacts = await this.getFacts(
      securityCase,
      values,
    );

    // Whose chosen priority the case reaches now, and not before.
    const members: Array<SecurityCaseRecipient> = (
      await this.getProjectMembers(data.projectId)
    ).filter((member: SecurityCaseRecipient): boolean => {
      return !data.actorUserId || !member.userId.equals(data.actorUserId);
    });

    const settings: Map<string, UserNotificationSetting> =
      await this.getSettings({
        projectId: data.projectId,
        eventType:
          NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
        userIds: members.map((member: SecurityCaseRecipient): ObjectID => {
          return member.userId;
        }),
      });

    const minimums: Map<string, SecurityCasePriority> = new Map();
    const reached: Array<SecurityCaseRecipient> = [];
    const defaultMinimum: SecurityCasePriority | null =
      readSecurityCaseNotificationMinimum(values.priorities, null);

    for (const member of members) {
      const setting: UserNotificationSetting | undefined = settings.get(
        member.userId.toString(),
      );

      // Someone who switched every channel off is not asked about.
      if (setting && !this.hasChannelOn(setting)) {
        continue;
      }

      const minimum: SecurityCasePriority | null =
        readSecurityCaseNotificationMinimum(
          values.priorities,
          setting?.minimumSecurityCasePriorityId,
        );

      if (
        minimum &&
        reachesNotificationPriorityNow({
          priorities: values.priorities,
          priorityId: priority.id,
          notifiedPriorityId: notifiedPriority?.id,
          minimumId: minimum.id,
        })
      ) {
        minimums.set(member.userId.toString(), minimum);
        reached.push(member);
      }
    }

    const recipients: Array<SecurityCaseRecipient> = await this.whoCanRead({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      people: reached,
    });

    const notified: Array<SecurityCaseRecipient> = await this.sendToPeople({
      facts,
      recipients,
      message: (recipient: SecurityCaseRecipient): SecurityCaseMessage => {
        const minimum: SecurityCasePriority | null =
          minimums.get(recipient.userId.toString()) || defaultMinimum;

        return buildPriorityReachedMessage({
          facts,
          isNew,
          minimum: minimum
            ? getChosenPriorityChoice({
                priorities: values.priorities,
                minimum,
              })
            : {
                name: priorityName,
                kind: SecurityCaseNotificationChoiceKind.AndAbove,
              },
        });
      },
    });

    await this.recordInFeed({
      facts,
      notified,
      feedInfo: isNew
        ? mdText`🔔 Notified ${people(notified.length)} of this new **${priorityName}** case.`
        : mdText`🔔 Notified ${people(notified.length)} that this case is now **${priorityName}**.`,
      displayColor: Gray500,
    });

    await this.postToChannels({
      facts,
      markdown: buildChannelMarkdown({
        headline: isNew
          ? mdText`🛡️ **New ${priorityName} security case**`
          : mdText`🚩 **Security case is now ${priorityName}**`,
        facts,
      }),
      notificationText: isNew
        ? `New ${priorityName} security case ${facts.number}: ${facts.title}`
        : `Security case ${facts.number} is now ${priorityName}: ${facts.title}`,
    });

    return notified;
  }

  // ---------- A case assigned ----------

  @CaptureSpan()
  public static async notifyAssigned(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    userId?: ObjectID | undefined;
    teamId?: ObjectID | undefined;
    actorUserId?: ObjectID | undefined;
    playbookName?: string | undefined;
  }): Promise<Array<SecurityCaseRecipient>> {
    const securityCase: SecurityCase | null = await this.readCase(data);

    if (!securityCase || isSetupTestCase(securityCase)) {
      return [];
    }

    /*
     * Told only while it is still theirs: a case handed on again a moment
     * later is the next person's news, not this one's.
     */
    const userId: ObjectID | undefined =
      data.userId &&
      securityCase.assignedToUserId &&
      securityCase.assignedToUserId.equals(data.userId)
        ? data.userId
        : undefined;
    const teamId: ObjectID | undefined =
      data.teamId &&
      securityCase.assignedToTeamId &&
      securityCase.assignedToTeamId.equals(data.teamId)
        ? data.teamId
        : undefined;

    if (!userId && !teamId) {
      return [];
    }

    const facts: SecurityCaseMessageFacts = await this.getFacts(securityCase);
    const teamName: string | undefined = teamId
      ? await this.getTeamName(teamId)
      : undefined;
    const assignedBy: string | undefined = data.playbookName
      ? `Playbook ${data.playbookName}`
      : data.actorUserId
        ? (await this.getUser(data.actorUserId))?.name
        : undefined;

    const byUserId: Map<
      string,
      { recipient: SecurityCaseRecipient; viaTeam: boolean }
    > = new Map();

    if (teamId) {
      for (const member of await this.getTeamMembers(data.projectId, teamId)) {
        byUserId.set(member.userId.toString(), {
          recipient: member,
          viaTeam: true,
        });
      }
    }

    if (userId) {
      const user: SecurityCaseRecipient | null = await this.getUser(userId);

      if (user) {
        byUserId.set(user.userId.toString(), {
          recipient: user,
          viaTeam: false,
        });
      }
    }

    if (data.actorUserId) {
      byUserId.delete(data.actorUserId.toString());
    }

    const recipients: Array<SecurityCaseRecipient> = await this.whoCanRead({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      people: Array.from(byUserId.values()).map(
        (entry: {
          recipient: SecurityCaseRecipient;
          viaTeam: boolean;
        }): SecurityCaseRecipient => {
          return entry.recipient;
        },
      ),
    });

    const notified: Array<SecurityCaseRecipient> = await this.sendToPeople({
      facts,
      recipients,
      message: (recipient: SecurityCaseRecipient): SecurityCaseMessage => {
        return buildAssignedMessage({
          facts,
          teamName: byUserId.get(recipient.userId.toString())?.viaTeam
            ? teamName
            : undefined,
          assignedBy,
        });
      },
    });

    await this.recordInFeed({
      facts,
      notified,
      feedInfo: teamName
        ? mdText`🔔 Notified ${people(notified.length)} that this case is assigned to them or to **${teamName}**.`
        : mdText`🔔 Notified ${people(notified.length)} that this case is assigned to them.`,
      displayColor: Gray500,
    });

    await this.postToChannels({
      facts,
      markdown: buildChannelMarkdown({
        headline: mdText`👤 **Security case assigned to ${facts.assignee}**`,
        facts,
      }),
      notificationText: `Security case ${facts.number} assigned to ${facts.assignee}: ${facts.title}`,
    });

    return notified;
  }

  // ---------- A step waiting for approval ----------

  @CaptureSpan()
  public static async notifyApprovalRequested(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    runId: ObjectID;
  }): Promise<Array<SecurityCaseRecipient>> {
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookRunService.findOneBy({
        query: {
          _id: data.runId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          status: true,
          playbookName: true,
          steps: true,
          currentStepIndex: true,
          stepResults: true,
          triggeredByUserId: true,
          trigger: true,
        },
        props: {
          isRoot: true,
        },
      });

    // Somebody decided already, or the run was cancelled.
    if (!run || run.status !== SecurityPlaybookRunStatus.WaitingForApproval) {
      return [];
    }

    const securityCase: SecurityCase | null = await this.readCase(data);

    if (!securityCase || isSetupTestCase(securityCase)) {
      return [];
    }

    const facts: SecurityCaseMessageFacts = await this.getFacts(securityCase);
    const steps: Array<SecurityPlaybookStep> = this.readSteps(run.steps);
    const stepIndex: number = run.currentStepIndex || 0;
    const stepDescription: string = describeStep(
      stepIndex + 1,
      steps[stepIndex],
    );
    const playbookName: string = run.playbookName || "Playbook";
    const startedBy: string = run.triggeredByUserId
      ? (await this.getUser(run.triggeredByUserId))?.name || "By hand"
      : describeRunTrigger(run.trigger);
    // For a step that acts on users or hosts: the ones it would act on.
    const targets: Array<string> = (
      readStepResults(run.stepResults, steps)[stepIndex]?.targets || []
    )
      .filter((target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      })
      .map((target: SecurityPlaybookTarget): string => {
        return target.value;
      });

    /*
     * Who may decide: whoever can read the case and move its runs along
     * (SecurityPlaybookRunAPI). The person who started the run by hand is
     * looking at it, and is not asked.
     */
    const approvePermissions: Array<Permission> =
      new SecurityPlaybookRun().getUpdatePermissions();
    const startedByUserId: ObjectID | undefined = run.triggeredByUserId;

    const onCase: Array<SecurityCaseRecipient> = [];

    if (securityCase.assignedToTeamId) {
      onCase.push(
        ...(await this.getTeamMembers(
          data.projectId,
          securityCase.assignedToTeamId,
        )),
      );
    }

    if (securityCase.assignedToUserId) {
      const assignee: SecurityCaseRecipient | null = await this.getUser(
        securityCase.assignedToUserId,
      );

      if (assignee) {
        onCase.push(assignee);
      }
    }

    const notStarter: (person: SecurityCaseRecipient) => boolean = (
      person: SecurityCaseRecipient,
    ): boolean => {
      return !startedByUserId || !person.userId.equals(startedByUserId);
    };

    let isOnCase: boolean = true;
    let recipients: Array<SecurityCaseRecipient> = await this.whoCanRead({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      people: this.uniquePeople(onCase).filter(notStarter),
      alsoHolding: approvePermissions,
    });

    if (recipients.length === 0) {
      isOnCase = false;
      recipients = await this.whoCanRead({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        people: (await this.getProjectMembers(data.projectId)).filter(
          notStarter,
        ),
        alsoHolding: approvePermissions,
      });
    }

    const notified: Array<SecurityCaseRecipient> = await this.sendToPeople({
      facts,
      recipients,
      message: (): SecurityCaseMessage => {
        return buildApprovalRequestedMessage({
          facts,
          playbookName,
          stepDescription,
          startedBy,
          isOnCase,
          targets,
        });
      },
    });

    await this.recordInFeed({
      facts,
      notified,
      feedInfo: mdText`🔔 Asked ${people(notified.length)} to approve ${stepDescription} of playbook **${playbookName}**.`,
      displayColor: Yellow500,
    });

    await this.postToChannels({
      facts,
      markdown: buildChannelMarkdown({
        headline: mdText`⏸️ **Approval needed**: playbook **${playbookName}** is waiting for someone to approve ${stepDescription}.`,
        facts,
      }),
      notificationText: `Approval needed on ${facts.number}: ${playbookName}, ${stepDescription}`,
    });

    return notified;
  }

  // ---------- Who ----------

  /*
   * The people among `people` who can read the case - and, when given, hold
   * one of `alsoHolding` too - by the check their own read goes through:
   * their roles, the labels those are limited to, and their blocks. Anyone
   * who has left the project reads nothing.
   */
  public static async whoCanRead(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    people: Array<SecurityCaseRecipient>;
    alsoHolding?: ReadonlyArray<Permission> | undefined;
  }): Promise<Array<SecurityCaseRecipient>> {
    const readers: Array<SecurityCaseRecipient> = [];

    for (const person of this.uniquePeople(data.people)) {
      if (
        await this.canReadCase({
          userId: person.userId,
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          alsoHolding: data.alsoHolding,
        })
      ) {
        readers.push(person);
      }
    }

    return readers;
  }

  public static async canReadCase(data: {
    userId: ObjectID;
    projectId: ObjectID;
    securityCaseId: ObjectID;
    alsoHolding?: ReadonlyArray<Permission> | undefined;
  }): Promise<boolean> {
    try {
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.userId,
            projectId: data.projectId,
          },
        );

      if (!CallerPermission.isProjectMember(props, data.projectId)) {
        return false;
      }

      // The cheap half first: a role that can read cases at all.
      if (
        !CallerPermission.holdsAnyOf(
          props,
          new SecurityCase().getReadPermissions(),
          { projectId: data.projectId },
        )
      ) {
        return false;
      }

      if (
        data.alsoHolding &&
        !CallerPermission.holdsAnyOf(props, data.alsoHolding, {
          projectId: data.projectId,
        })
      ) {
        return false;
      }

      // Then this case: a role limited to labels reads only cases with them.
      const found: SecurityCase | null = await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props,
      });

      return Boolean(found);
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        logger.error(
          `SecurityCaseNotifications: could not tell whether user ${data.userId.toString()} can read case ${data.securityCaseId.toString()}:`,
        );
        logger.error(error);
      }

      return false;
    }
  }

  private static uniquePeople(
    people: Array<SecurityCaseRecipient>,
  ): Array<SecurityCaseRecipient> {
    const seen: Set<string> = new Set();

    return people.filter((person: SecurityCaseRecipient): boolean => {
      const key: string = person.userId.toString();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private static toRecipient(
    userId: ObjectID | undefined,
    user: User | undefined,
  ): SecurityCaseRecipient | null {
    if (!userId) {
      return null;
    }

    return {
      userId,
      name: user?.name?.toString() || user?.email?.toString() || "",
      email: user?.email?.toString() || "",
    };
  }

  // Every member of the project who has accepted their invitation, once each.
  private static async getProjectMembers(
    projectId: ObjectID,
  ): Promise<Array<SecurityCaseRecipient>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
        user: {
          name: true,
          email: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    return this.uniquePeople(
      members
        .map((member: TeamMember): SecurityCaseRecipient | null => {
          return this.toRecipient(member.userId, member.user);
        })
        .filter((recipient: SecurityCaseRecipient | null): boolean => {
          return Boolean(recipient);
        }) as Array<SecurityCaseRecipient>,
    );
  }

  private static async getTeamMembers(
    projectId: ObjectID,
    teamId: ObjectID,
  ): Promise<Array<SecurityCaseRecipient>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId,
        teamId,
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
        user: {
          name: true,
          email: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    return this.uniquePeople(
      members
        .map((member: TeamMember): SecurityCaseRecipient | null => {
          return this.toRecipient(member.userId, member.user);
        })
        .filter((recipient: SecurityCaseRecipient | null): boolean => {
          return Boolean(recipient);
        }) as Array<SecurityCaseRecipient>,
    );
  }

  private static async getUser(
    userId: ObjectID,
  ): Promise<SecurityCaseRecipient | null> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    return user ? this.toRecipient(userId, user) : null;
  }

  private static async getTeamName(teamId: ObjectID): Promise<string> {
    const team: Team | null = await TeamService.findOneById({
      id: teamId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return team?.name || "a team";
  }

  // The people's settings for one event, by user.
  private static async getSettings(data: {
    projectId: ObjectID;
    eventType: NotificationSettingEventType;
    userIds: Array<ObjectID>;
  }): Promise<Map<string, UserNotificationSetting>> {
    const settings: Map<string, UserNotificationSetting> = new Map();

    if (data.userIds.length === 0) {
      return settings;
    }

    const rows: Array<UserNotificationSetting> =
      await UserNotificationSettingService.findBy({
        query: {
          projectId: data.projectId,
          eventType: data.eventType,
          userId: QueryHelper.any(data.userIds),
        },
        select: {
          userId: true,
          minimumSecurityCasePriorityId: true,
          alertByEmail: true,
          alertBySMS: true,
          alertByCall: true,
          alertByPush: true,
          alertByWhatsApp: true,
          alertByTelegram: true,
          alertBySlack: true,
          alertByMicrosoftTeams: true,
          alertByWebhook: true,
          alertByCustomChannel: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const row of rows) {
      if (row.userId) {
        settings.set(row.userId.toString(), row);
      }
    }

    return settings;
  }

  private static hasChannelOn(setting: UserNotificationSetting): boolean {
    return Boolean(
      setting.alertByEmail ||
        setting.alertBySMS ||
        setting.alertByCall ||
        setting.alertByPush ||
        setting.alertByWhatsApp ||
        setting.alertByTelegram ||
        setting.alertBySlack ||
        setting.alertByMicrosoftTeams ||
        setting.alertByWebhook ||
        setting.alertByCustomChannel,
    );
  }

  // ---------- What ----------

  private static async readCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCase | null> {
    return await SecurityCaseService.findOneBy({
      query: {
        _id: data.securityCaseId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        projectId: true,
        caseNumberWithPrefix: true,
        title: true,
        description: true,
        securityCasePriorityId: true,
        notifiedSecurityCasePriorityId: true,
        securityCaseStatusId: true,
        source: true,
        entities: true,
        mitreTactics: true,
        detectionCount: true,
        assignedToUserId: true,
        assignedToTeamId: true,
        groupingKey: true,
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static readSteps(value: unknown): Array<SecurityPlaybookStep> {
    try {
      return parseSecurityPlaybookSteps(value);
    } catch {
      return [];
    }
  }

  public static async getFacts(
    securityCase: SecurityCase,
    projectValues?: ProjectSecurityCaseValues | undefined,
  ): Promise<SecurityCaseMessageFacts> {
    const projectId: ObjectID = securityCase.projectId!;
    const caseId: ObjectID = securityCase.id!;
    // The case's priority and status as the project names them now.
    const values: ProjectSecurityCaseValues =
      projectValues || (await SecurityCaseValues.getForProject(projectId));
    const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
      values.priorities,
      securityCase.securityCasePriorityId,
    );
    const status: SecurityCaseStatus | null = SecurityCaseStatuses.find(
      values.statuses,
      securityCase.securityCaseStatusId,
    );

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    let assignee: string = "Unassigned";

    if (securityCase.assignedToUserId) {
      assignee =
        (await this.getUser(securityCase.assignedToUserId))?.name || assignee;
    } else if (securityCase.assignedToTeamId) {
      assignee = await this.getTeamName(securityCase.assignedToTeamId);
    }

    let descriptionHtml: string = "";

    try {
      descriptionHtml = securityCase.description?.trim()
        ? await Markdown.convertToHTML(
            securityCase.description,
            MarkdownContentType.Email,
          )
        : "";
    } catch (error) {
      // The rest of the message still goes.
      logger.error(error);
    }

    return {
      caseId,
      projectId,
      number: securityCase.caseNumberWithPrefix || "Case",
      title: securityCase.title || "Untitled case",
      priority: priority?.name || "",
      priorityColor: priority?.color || Gray500,
      isCritical: SecurityCasePriorities.isCritical(
        values.priorities,
        securityCase.securityCasePriorityId,
      ),
      status: status?.name || "",
      source: securityCase.source || "",
      assignee,
      entities: mergeSecurityEntities(
        (securityCase.entities || []) as unknown as Array<SecurityEntity>,
      ),
      mitreTactics: securityCase.mitreTactics || [],
      detectionCount: securityCase.detectionCount || 0,
      projectName: project?.name || "",
      url: (
        await SecurityCaseService.getCaseLinkInDashboard(projectId, caseId)
      ).toString(),
      descriptionHtml,
    };
  }

  // ---------- Sending ----------

  // Each person as they chose to hear; one person's failure is nobody else's.
  private static async sendToPeople(data: {
    facts: SecurityCaseMessageFacts;
    recipients: Array<SecurityCaseRecipient>;
    message: (recipient: SecurityCaseRecipient) => SecurityCaseMessage;
  }): Promise<Array<SecurityCaseRecipient>> {
    const notified: Array<SecurityCaseRecipient> = [];

    for (const recipient of data.recipients) {
      try {
        const message: SecurityCaseMessage = data.message(recipient);

        // A member who joined before these events existed gets them now.
        await UserNotificationSettingService.addSecurityCaseNotificationSettings(
          recipient.userId,
          data.facts.projectId,
        );

        const emailEnvelope: EmailEnvelope = {
          templateType: message.templateType,
          vars: message.emailVars,
          subject: message.subject,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: message.smsText,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: message.callText,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createSecurityCaseNotification({
            title: message.pushTitle,
            body: message.pushBody,
            caseViewLink: data.facts.url,
            type: message.pushType,
            securityCaseId: data.facts.caseId.toString(),
            projectId: data.facts.projectId.toString(),
            requireInteraction: message.requireInteraction,
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: recipient.userId,
          projectId: data.facts.projectId,
          eventType: message.eventType,
          emailEnvelope,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          securityCaseId: data.facts.caseId,
          forceImmediate: message.forceImmediate,
        });

        notified.push(recipient);
      } catch (error) {
        logger.error(
          `SecurityCaseNotifications: could not notify user ${recipient.userId.toString()} about case ${data.facts.caseId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return notified;
  }

  // The case's feed says who was told; nothing when nobody was.
  private static async recordInFeed(data: {
    facts: SecurityCaseMessageFacts;
    notified: Array<SecurityCaseRecipient>;
    feedInfo: MarkdownText;
    displayColor: Color;
  }): Promise<void> {
    if (data.notified.length === 0) {
      return;
    }

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.facts.projectId,
      securityCaseId: data.facts.caseId,
      feedInfoInMarkdown: data.feedInfo.toString(),
      moreInformationInMarkdown: FeedMarkdown.bulletList(
        data.notified.map((recipient: SecurityCaseRecipient): MarkdownText => {
          return recipient.email && recipient.name !== recipient.email
            ? mdText`${recipient.name} (${recipient.email})`
            : mdText`${recipient.name || recipient.email}`;
        }),
      ).toString(),
      eventType: SecurityCaseFeedEventType.Notification,
      displayColor: data.displayColor,
    });
  }

  /*
   * The channels and chats of the project's Security Case rules that match
   * the case as it is now. Never throws: the people were told already.
   */
  private static async postToChannels(data: {
    facts: SecurityCaseMessageFacts;
    markdown: MarkdownText;
    notificationText: string;
  }): Promise<void> {
    try {
      await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
        projectId: data.facts.projectId,
        notificationFor: {
          securityCaseId: data.facts.caseId,
        },
        feedInfoInMarkdown: data.markdown.toString(),
        notificationText: data.notificationText,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(
        `SecurityCaseNotifications: could not post case ${data.facts.caseId.toString()} to Slack or Microsoft Teams:`,
      );
      logger.error(error);
    }
  }
}
