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
import UserNotificationSettingService, {
  UserNotificationChannels,
} from "../../Services/UserNotificationSettingService";
import UserService from "../../Services/UserService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import PushNotificationUtil from "../PushNotificationUtil";
import CaptureSpan from "../Telemetry/CaptureSpan";
import type { WorkspaceSentDirectMessage } from "../../Services/WorkspaceUserNotificationService";
import type {
  PublicNoteApprovalButtonValue,
  WorkspaceDirectMessage,
} from "../Workspace/WorkspacePublicNoteApproval";
import type { PublicNoteApprovalWaitingFor } from "./PublicNoteApprovalFeed";
import type { PublicNoteKind } from "./PublicNoteApprovalEngine";
import PublicNoteApprovalRequests, {
  ASK_BY_EVERYTHING,
  ASK_BY_NOTHING,
  PublicNoteApprovalRequestClaim,
  PublicNoteApprovalRequestKey,
} from "./PublicNoteApprovalRequests";

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
 * In chat, an approver is asked with the note itself and Approve and Reject
 * on it (WorkspacePublicNoteApproval): they decide where they are asked,
 * as the member their chat account is connected to, with the Dashboard's
 * rules (WorkspacePublicNoteApprovalActions). Each copy of that message is
 * kept as it is sent, and replaced by what happened once the note is
 * decided, changed or deleted (WorkspacePublicNoteApprovalMessages,
 * replaceChatMessages).
 *
 * Who approves can change while a note waits - its approval steps, a team's
 * members - and each change asks the step's people again
 * (PublicNoteApprovalEngine.followUp). So every ask of a step records whom
 * it asked, and how, before it asks them (PublicNoteApprovalRequests): a
 * person is asked about a step once by their notification settings, and in
 * chat once for each message that asks it.
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
  // "incident", "episode", "maintenance event"
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

/*
 * What an approver's chat message carries on its buttons (the engine's
 * getChatAsk): the note and its record, the round and step it asks about,
 * whether approving that step publishes it, and who the step names.
 */
export interface PublicNoteApprovalChatAsk {
  kind: PublicNoteKind;
  noteId: ObjectID;
  recordId: ObjectID;
  submittedAt: string;
  stepId: string;
  isFinal: boolean;
  waitingFor: PublicNoteApprovalWaitingFor;
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
   *
   * With `request`, each person is asked about that step of the note's
   * round only by what nobody asked them by yet, claimed before they are
   * asked (PublicNoteApprovalRequests): all of it, the first time; in chat
   * alone when only the chat message changed - its Approve now publishes
   * the note, or no longer does; nothing when they were asked already.
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
    // What the chat message's Approve and Reject carry; none, none on it.
    chat?: PublicNoteApprovalChatAsk | undefined;
    /*
     * The step of the note's round this asks about, to ask each person
     * about it once; none, everyone is asked, as before requests were kept.
     */
    request?: PublicNoteApprovalRequestKey | undefined;
    /*
     * Asked because who approves changed while the note waits
     * (PublicNoteApprovalEngine.followUp), not because the note reached the
     * step: nobody is asked when who was asked cannot be told. The step's
     * own ask asks everybody it cannot tell about, as it always has.
     */
    isFollowUp?: boolean | undefined;
  }): Promise<Array<ObjectID>> {
    const asked: Array<ObjectID> = [];

    if (data.userIds.length === 0) {
      return asked;
    }

    if (data.isFollowUp && !data.request) {
      return asked;
    }

    // Who was asked about the step already, read at once, for a follow-up.
    let askedAlready: Map<string, PublicNoteApprovalRequestClaim> = new Map();

    if (data.request && data.isFollowUp) {
      try {
        askedAlready = await PublicNoteApprovalRequests.readAsked(data.request);
      } catch (error) {
        logger.error(
          "Public note approval: could not read who was asked about a public note's step, so nobody new was asked.",
          { projectId: data.facts.projectId.toString() },
        );
        logger.error(error, { projectId: data.facts.projectId.toString() });
        return asked;
      }
    }

    // Those asked by everything already are not looked at again.
    const userIds: Array<string> = data.userIds.filter(
      (userId: string): boolean => {
        const was: PublicNoteApprovalRequestClaim | undefined =
          askedAlready.get(userId.toLowerCase());

        return !(was?.notifications && was.chat);
      },
    );

    if (userIds.length === 0) {
      return asked;
    }

    const projectName: string = await this.getProjectName(data.facts.projectId);
    const sentBy: string = data.sentByUserId
      ? (await this.getUserNames([data.sentByUserId]))[data.sentByUserId] ||
        "A member of your team"
      : "OneUptime";

    // One chat message for everyone the step asks: nothing in it is anybody's own.
    const workspaceMessage: WorkspaceDirectMessage | undefined =
      this.getChatMessage({
        facts: data.facts,
        chat: data.chat,
        sentBy: data.sentByUserId ? sentBy : null,
      });
    // What its buttons carry, for the copies kept as they are sent.
    const buttonValue: PublicNoteApprovalButtonValue | undefined =
      workspaceMessage && data.chat
        ? this.getChatButtonValue({ facts: data.facts, chat: data.chat })
        : undefined;

    for (const userIdText of userIds) {
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

        const claim: PublicNoteApprovalRequestClaim = await this.claimRequest({
          request: data.request,
          userId: userId,
          isFollowUp: Boolean(data.isFollowUp),
        });

        if (!claim.notifications && !claim.chat) {
          continue;
        }

        await UserNotificationSettingService.addPublicNoteApprovalNotificationSettings(
          userId,
          data.facts.projectId,
        );

        try {
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
            workspaceMessage:
              workspaceMessage && buttonValue
                ? this.keptAsSent({
                    message: workspaceMessage,
                    value: buttonValue,
                    userId: userId,
                  })
                : workspaceMessage,
            channels: this.getChannels(claim),
          });
        } catch (error) {
          // Not asked: the next ask of the step asks them.
          if (data.request) {
            await PublicNoteApprovalRequests.release({
              key: data.request,
              userId: userId,
              claim: claim,
            });
          }

          throw error;
        }

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

  /*
   * What this ask may ask a person by (PublicNoteApprovalRequests.claim):
   * everything, when the ask records nothing. When the record cannot be
   * written, the step's own ask asks them anyway - a note must not wait for
   * nobody - and a follow-up does not, so as not to ask them twice.
   */
  private static async claimRequest(data: {
    request: PublicNoteApprovalRequestKey | undefined;
    userId: ObjectID;
    isFollowUp: boolean;
  }): Promise<PublicNoteApprovalRequestClaim> {
    if (!data.request) {
      return ASK_BY_EVERYTHING;
    }

    try {
      return await PublicNoteApprovalRequests.claim({
        key: data.request,
        userId: data.userId,
      });
    } catch (error) {
      logger.error(
        data.isFollowUp
          ? `Public note approval: could not record that user ${data.userId.toString()} is asked to approve, so they were not asked.`
          : `Public note approval: could not record that user ${data.userId.toString()} is asked to approve; they are asked anyway.`,
        { projectId: data.request.projectId.toString() },
      );
      logger.error(error, { projectId: data.request.projectId.toString() });

      return data.isFollowUp ? ASK_BY_NOTHING : ASK_BY_EVERYTHING;
    }
  }

  // The channels a claim asks a person by.
  public static getChannels(
    claim: PublicNoteApprovalRequestClaim,
  ): UserNotificationChannels {
    if (claim.notifications && claim.chat) {
      return UserNotificationChannels.All;
    }

    return claim.chat
      ? UserNotificationChannels.ChatOnly
      : UserNotificationChannels.AllButChat;
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
   * The message an approver's chat accounts get, with Approve and Reject
   * (WorkspacePublicNoteApproval.getAskMessage) - or none, so they are asked
   * as every other event asks in chat, when the note cannot be named on a
   * button or the message cannot be built: an approver is always asked.
   */
  public static getChatMessage(data: {
    facts: PublicNoteApprovalMessageFacts;
    chat: PublicNoteApprovalChatAsk | undefined;
    // Who sent it for approval, by name; null for OneUptime or an API key.
    sentBy: string | null;
  }): WorkspaceDirectMessage | undefined {
    if (!data.chat) {
      return undefined;
    }

    try {
      /*
       * Required here, not imported: it reads the chat apps' modules, and
       * every public note service reads this file, through the notes'
       * engine, as it loads. Imported at the top, loading a note service
       * would start the chat apps' modules before the ones they read
       * (WorkspaceMemberActions' WorkspaceEventType) are ready.
       */
      const WorkspacePublicNoteApproval: typeof import("../Workspace/WorkspacePublicNoteApproval").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../Workspace/WorkspacePublicNoteApproval").default;

      return WorkspacePublicNoteApproval.getAskMessage({
        recordLabel: data.facts.recordLabel,
        recordTitle: data.facts.recordTitle,
        notesUrl: data.facts.notesUrl,
        note: data.facts.note,
        isEdit: data.facts.isEdit,
        sentBy: data.sentBy,
        waitingFor: data.chat.waitingFor,
        value: this.getChatButtonValue({ facts: data.facts, chat: data.chat }),
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not build the chat message with Approve and Reject.",
      );
      logger.error(error);
      return undefined;
    }
  }

  /*
   * What the chat message's Approve and Reject carry: the note and its
   * record, the round and the step it asks about, whether approving that
   * step publishes the note, and a digest of the text it shows.
   */
  public static getChatButtonValue(data: {
    facts: PublicNoteApprovalMessageFacts;
    chat: PublicNoteApprovalChatAsk;
  }): PublicNoteApprovalButtonValue {
    // Required here, not imported: see getChatMessage.
    const WorkspacePublicNoteApproval: typeof import("../Workspace/WorkspacePublicNoteApproval").default =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../Workspace/WorkspacePublicNoteApproval").default;

    return {
      kind: data.chat.kind,
      projectId: data.facts.projectId,
      recordId: data.chat.recordId,
      noteId: data.chat.noteId,
      submittedAt: data.chat.submittedAt,
      stepId: data.chat.stepId,
      isFinal: data.chat.isFinal,
      isEdit: data.facts.isEdit,
      textDigest: WorkspacePublicNoteApproval.getTextDigest(data.facts.note),
    };
  }

  /*
   * The chat message as one approver gets it: each copy of it is kept as it
   * is sent (WorkspacePublicNoteApprovalMessages.keep), so it can be
   * replaced once the note is decided.
   */
  public static keptAsSent(data: {
    message: WorkspaceDirectMessage;
    value: PublicNoteApprovalButtonValue;
    userId: ObjectID;
  }): WorkspaceDirectMessage {
    return {
      ...data.message,
      onSent: async (sent: WorkspaceSentDirectMessage): Promise<void> => {
        await this.getChatMessages().keep({
          value: data.value,
          userId: data.userId,
          sent: sent,
        });
      },
    };
  }

  /*
   * Once a decision, a resubmission, an edit or a withdrawal of a note is
   * written - or the note is gone - the chat copies of its approval message
   * that no longer ask what is true are replaced by what happened
   * (WorkspacePublicNoteApprovalMessages), in the background: this returns
   * at once, and nothing of it ever fails, or holds back, what was written.
   */
  public static replaceChatMessages(data: {
    kind: PublicNoteKind;
    projectId: ObjectID;
    noteId: ObjectID;
  }): void {
    try {
      this.getChatMessages().replaceWhenOver(data);
    } catch (error) {
      logger.error(
        "Public note approval: could not start replacing the chat messages of a public note.",
      );
      logger.error(error);
    }
  }

  /*
   * What keeps the chat copies of approval messages and replaces them
   * (WorkspacePublicNoteApprovalMessages) - for the notes' services too,
   * which read a note's copies before a delete takes them with it.
   */
  public static getChatMessages(): typeof import("../Workspace/WorkspacePublicNoteApprovalMessages").default {
    // Required here, not imported: see getChatMessage.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../Workspace/WorkspacePublicNoteApprovalMessages").default;
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
    // The chat accounts' own message, when the event has one.
    workspaceMessage?: WorkspaceDirectMessage | undefined;
    // Which of the person's channels it goes to; left out, all of them.
    channels?: UserNotificationChannels | undefined;
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
      ...(data.workspaceMessage
        ? { workspaceMessage: data.workspaceMessage }
        : {}),
      ...(data.channels && data.channels !== UserNotificationChannels.All
        ? { channels: data.channels }
        : {}),
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
