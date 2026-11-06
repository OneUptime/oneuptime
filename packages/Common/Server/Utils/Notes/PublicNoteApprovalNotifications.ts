import User from "../../../Models/DatabaseModels/User";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import AccessTokenService from "../../Services/AccessTokenService";
import ProjectService from "../../Services/ProjectService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserService from "../../Services/UserService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import PushNotificationUtil from "../PushNotificationUtil";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * TELLING PEOPLE ABOUT PUBLIC NOTE APPROVAL.
 *
 * Two things about a public note's approval need a person, and each goes
 * through the notification settings every other event uses - email, SMS,
 * call, push, and the person's chat and webhooks - as they chose (User
 * Settings > Notification Settings):
 *
 *  - A note, or an edit of one, waits for a step the person is named on, or
 *    a team of theirs is: SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION.
 *    Asked: the people the step names and the members of the teams it
 *    names, less whoever sent the note and whoever approved it already
 *    (PublicNoteApproval.getPeopleToAsk), and only those who can read the
 *    note - an approver must see what they approve, and a notification is
 *    the note in another place.
 *  - A note the person sent is published, or rejected:
 *    SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION, with the reason.
 *
 * Email and push are on by default for the first - a note waits for them,
 * and customers wait for the note - and email for the second. Members who
 * joined before these existed get the defaults as they are first told
 * (addPublicNoteApprovalNotificationSettings is idempotent).
 *
 * A notification never fails, or holds back, the decision it follows: it
 * is sent after the decision is written, and a failure is logged.
 */

// The record and the note a message is about.
export interface PublicNoteApprovalMessageFacts {
  projectId: ObjectID;
  // "Incident INC-42"
  recordLabel: string;
  recordTitle: string;
  // "incident", "episode", "scheduled maintenance event"
  recordNoun: string;
  // The record's public notes in the Dashboard, where it is decided.
  notesUrl: string;
  note: string;
  isEdit: boolean;
  // For incidents and episodes, maintenance events: what the webhook names.
  incidentId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
}

export interface PublicNoteApprovalMessage {
  eventType: NotificationSettingEventType;
  subject: string;
  templateType: EmailTemplateType;
  emailVars: Dictionary<string>;
  smsText: string;
  callText: string;
  pushTitle: string;
  pushBody: string;
  pushType: string;
}

// What an approver is told: a note waits for them.
export function buildApprovalRequestedMessage(data: {
  facts: PublicNoteApprovalMessageFacts;
  projectName: string;
  sentBy: string;
  stepLabel: string;
  isTeam: boolean;
}): PublicNoteApprovalMessage {
  const { facts } = data;
  const what: string = facts.isEdit
    ? "An edit of a public note"
    : "A public note";

  return {
    eventType:
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
    subject: `Approval needed: public note on ${facts.recordLabel} - ${facts.recordTitle}`,
    templateType: EmailTemplateType.PublicNoteApprovalRequested,
    emailVars: {
      emailTitle: `Approval needed: public note on ${facts.recordLabel}`,
      leadSentence: `${what} on ${facts.recordNoun} ${facts.recordLabel} is waiting for your approval. It is not on status pages and no subscriber is told about it until it is approved.`,
      recordTitle: facts.recordTitle,
      recordLabel: facts.recordLabel,
      sentBy: data.sentBy,
      stepLabel: data.stepLabel,
      projectName: data.projectName,
      notesViewLink: facts.notesUrl,
      reasonSentence: data.isTeam
        ? "You are on a team that approves public notes for this step. Change these emails in User Settings > Notification Settings."
        : "You approve public notes for this step. Change these emails in User Settings > Notification Settings.",
    },
    smsText: buildNotificationSms(
      `Approval needed: ${what.toLowerCase()} on ${facts.recordLabel} (${facts.recordTitle}) waits for you.`,
    ),
    callText: `This is a message from OneUptime. ${what} on ${facts.recordNoun} ${facts.recordLabel}, ${facts.recordTitle}, is waiting for your approval. To approve or reject it, go to the OneUptime Dashboard. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.`,
    pushTitle: `Approval needed: ${facts.recordLabel}`,
    pushBody: `${what} on ${facts.recordLabel} (${facts.recordTitle}) is waiting for your approval.`,
    pushType: "public-note-approval-requested",
  };
}

// What the person who sent a note is told once it is decided.
export function buildApprovalDecidedMessage(data: {
  facts: PublicNoteApprovalMessageFacts;
  projectName: string;
  decidedBy: string;
  isApproved: boolean;
  reason?: string | undefined;
}): PublicNoteApprovalMessage {
  const { facts } = data;
  const what: string = facts.isEdit
    ? "Your edit of a public note"
    : "Your public note";

  const lead: string = data.isApproved
    ? facts.isEdit
      ? `${what} on ${facts.recordNoun} ${facts.recordLabel} was approved by ${data.decidedBy}. Status pages now show the edited note.`
      : `${what} on ${facts.recordNoun} ${facts.recordLabel} was approved by ${data.decidedBy} and is now published on status pages.`
    : `${what} on ${facts.recordNoun} ${facts.recordLabel} was rejected by ${data.decidedBy}. It is not published. Change it and send it again from the Dashboard.`;

  return {
    eventType:
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION,
    subject: data.isApproved
      ? `Approved: public note on ${facts.recordLabel} - ${facts.recordTitle}`
      : `Rejected: public note on ${facts.recordLabel} - ${facts.recordTitle}`,
    templateType: EmailTemplateType.PublicNoteApprovalDecided,
    emailVars: {
      emailTitle: data.isApproved
        ? `Public note approved: ${facts.recordLabel}`
        : `Public note rejected: ${facts.recordLabel}`,
      leadSentence: lead,
      recordTitle: facts.recordTitle,
      recordLabel: facts.recordLabel,
      decidedBy: data.decidedBy,
      decision: data.isApproved ? "Approved" : "Rejected",
      reason: data.isApproved ? "" : data.reason || "",
      projectName: data.projectName,
      notesViewLink: facts.notesUrl,
      reasonSentence:
        "You sent this public note for approval. Change these emails in User Settings > Notification Settings.",
    },
    smsText: buildNotificationSms(
      data.isApproved
        ? `${what} on ${facts.recordLabel} was approved by ${data.decidedBy} and is published.`
        : `${what} on ${facts.recordLabel} was rejected by ${data.decidedBy}.${data.reason ? ` Reason: ${data.reason}` : ""}`,
    ),
    callText: data.isApproved
      ? `This is a message from OneUptime. ${what} on ${facts.recordNoun} ${facts.recordLabel} was approved and is published. Good bye.`
      : `This is a message from OneUptime. ${what} on ${facts.recordNoun} ${facts.recordLabel} was rejected. To see why, go to the OneUptime Dashboard. Good bye.`,
    pushTitle: data.isApproved
      ? `Public note approved: ${facts.recordLabel}`
      : `Public note rejected: ${facts.recordLabel}`,
    pushBody: data.isApproved
      ? `Approved by ${data.decidedBy}. It is now published.`
      : `Rejected by ${data.decidedBy}.${data.reason ? ` ${data.reason}` : ""}`,
    pushType: data.isApproved
      ? "public-note-approval-approved"
      : "public-note-approval-rejected",
  };
}

export default class PublicNoteApprovalNotifications {
  /*
   * Asks these people to approve. `canRead` says whether one of them may
   * read the note (PublicNoteApprovalEngine asks the note's own read, with
   * the person's permissions). Returns the people asked.
   */
  @CaptureSpan()
  public static async askApprovers(data: {
    facts: PublicNoteApprovalMessageFacts;
    userIds: ReadonlyArray<string>;
    // The people the step names themselves; the rest are there through a team.
    namedUserIds: ReadonlyArray<string>;
    sentByUserId?: string | undefined;
    stepLabel: string;
    canRead: (props: DatabaseCommonInteractionProps) => Promise<boolean>;
  }): Promise<Array<ObjectID>> {
    const asked: Array<ObjectID> = [];

    if (data.userIds.length === 0) {
      return asked;
    }

    const projectName: string = await this.getProjectName(data.facts.projectId);
    const sentBy: string = data.sentByUserId
      ? (await this.getUserNames([data.sentByUserId]))[data.sentByUserId] ||
        "A member of your team"
      : "OneUptime";

    for (const userIdText of data.userIds) {
      try {
        const userId: ObjectID = new ObjectID(userIdText);

        if (
          !(await this.mayBeTold({
            userId,
            facts: data.facts,
            canRead: data.canRead,
          }))
        ) {
          continue;
        }

        await UserNotificationSettingService.addPublicNoteApprovalNotificationSettings(
          userId,
          data.facts.projectId,
        );

        await this.send({
          userId,
          facts: data.facts,
          message: buildApprovalRequestedMessage({
            facts: data.facts,
            projectName,
            sentBy,
            stepLabel: data.stepLabel,
            isTeam: !data.namedUserIds.includes(userIdText),
          }),
        });

        asked.push(userId);
      } catch (error) {
        logger.error(
          `Public note approval: could not ask user ${userIdText} to approve.`,
        );
        logger.error(error);
      }
    }

    return asked;
  }

  // Tells the person who sent the note how it was decided.
  @CaptureSpan()
  public static async tellSender(data: {
    facts: PublicNoteApprovalMessageFacts;
    sentByUserId: string | undefined;
    decidedByUserId: string;
    isApproved: boolean;
    reason?: string | undefined;
    canRead: (props: DatabaseCommonInteractionProps) => Promise<boolean>;
  }): Promise<boolean> {
    if (!data.sentByUserId || data.sentByUserId === data.decidedByUserId) {
      return false;
    }

    try {
      const userId: ObjectID = new ObjectID(data.sentByUserId);

      if (
        !(await this.mayBeTold({
          userId,
          facts: data.facts,
          canRead: data.canRead,
        }))
      ) {
        return false;
      }

      await UserNotificationSettingService.addPublicNoteApprovalNotificationSettings(
        userId,
        data.facts.projectId,
      );

      const names: Record<string, string> = await this.getUserNames([
        data.decidedByUserId,
      ]);

      await this.send({
        userId,
        facts: data.facts,
        message: buildApprovalDecidedMessage({
          facts: data.facts,
          projectName: await this.getProjectName(data.facts.projectId),
          decidedBy: names[data.decidedByUserId] || "An approver",
          isApproved: data.isApproved,
          reason: data.reason,
        }),
      });

      return true;
    } catch (error) {
      logger.error(
        `Public note approval: could not tell user ${data.sentByUserId} how their note was decided.`,
      );
      logger.error(error);
      return false;
    }
  }

  // People's names, by id, as the Dashboard shows them: name, else email.
  @CaptureSpan()
  public static async getUserNames(
    userIds: ReadonlyArray<string>,
  ): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    const ids: Array<string> = Array.from(new Set(userIds)).filter(Boolean);

    if (ids.length === 0) {
      return names;
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      const id: string = user.id?.toString() || "";

      if (!id) {
        continue;
      }

      names[id] =
        user.name?.toString() || user.email?.toString() || "A team member";
    }

    return names;
  }

  /*
   * A member of the project who can read the note: a notification is the
   * note in another place.
   */
  private static async mayBeTold(data: {
    userId: ObjectID;
    facts: PublicNoteApprovalMessageFacts;
    canRead: (props: DatabaseCommonInteractionProps) => Promise<boolean>;
  }): Promise<boolean> {
    try {
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.userId,
            projectId: data.facts.projectId,
          },
        );

      if (!CallerPermission.isProjectMember(props, data.facts.projectId)) {
        return false;
      }

      return await data.canRead(props);
    } catch (error) {
      logger.debug(
        `Public note approval: user ${data.userId.toString()} cannot read the note, so is not told.`,
      );
      logger.debug(error);
      return false;
    }
  }

  private static async send(data: {
    userId: ObjectID;
    facts: PublicNoteApprovalMessageFacts;
    message: PublicNoteApprovalMessage;
  }): Promise<void> {
    const { facts, message } = data;

    const emailEnvelope: EmailEnvelope = {
      templateType: message.templateType,
      vars: {
        ...message.emailVars,
        note: await Markdown.convertToHTML(
          facts.note || "",
          MarkdownContentType.Email,
        ),
      },
      subject: message.subject,
      isSubjectLiteral: true,
    };

    const sms: SMSMessage = {
      message: message.smsText,
    };

    const call: CallRequestMessage = {
      data: [
        {
          sayMessage: message.callText,
        },
      ],
    };

    const push: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: message.pushTitle,
        body: message.pushBody,
        clickAction: facts.notesUrl,
        tag: message.pushType,
        requireInteraction:
          message.eventType ===
          NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
      });

    await UserNotificationSettingService.sendUserNotification({
      userId: data.userId,
      projectId: facts.projectId,
      eventType: message.eventType,
      emailEnvelope,
      smsMessage: sms,
      callRequestMessage: call,
      pushNotificationMessage: push,
      ...(facts.incidentId ? { incidentId: facts.incidentId } : {}),
      ...(facts.incidentEpisodeId
        ? { incidentEpisodeId: facts.incidentEpisodeId }
        : {}),
      ...(facts.scheduledMaintenanceId
        ? { scheduledMaintenanceId: facts.scheduledMaintenanceId }
        : {}),
    });
  }

  private static async getProjectName(projectId: ObjectID): Promise<string> {
    try {
      const project: { name?: string | undefined } | null =
        await ProjectService.findOneById({
          id: projectId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      return project?.name?.toString() || "your project";
    } catch {
      return "your project";
    }
  }
}
