import Project from "../../../Models/DatabaseModels/Project";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import DatabaseConfig from "../../DatabaseConfig";
import AccessTokenService from "../../Services/AccessTokenService";
import ProjectService from "../../Services/ProjectService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import TelemetryExceptionActivityService from "../../Services/TelemetryExceptionActivityService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import UserService from "../../Services/UserService";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import logger from "../Logger";
import PushNotificationUtil from "../PushNotificationUtil";
import CaptureSpan from "./CaptureSpan";

/*
 * TELLING PEOPLE AN EXCEPTION WAS ASSIGNED TO THEM.
 *
 * An assignment - a person or a team picked in the exception's header, Assign
 * to me, Assign to… under Bulk Actions, the API - leaves an Assigned entry on
 * the exception's activity (TelemetryExceptionActivity), written with
 * isAssigneeNotified false. Once a minute the Workers take those entries
 * (TelemetryException:SendAssignedNotification) the way every owner-added
 * job takes its owner rows: the marker is set first, before anything is
 * sent, so a send that fails is dropped rather than retried every minute.
 *
 * Who is told: the person it was assigned to, or every member of the team -
 * the members of the project among them (a pending invitation has joined
 * nothing), who can read the exception by the check their own read goes
 * through (the exception's resource scope included: a notification is the
 * exception in another place). Never the person who made the assignment:
 * Assign to me tells nobody. Nobody, either, when the exception has since
 * been handed to someone else, or deleted.
 *
 * How: SEND_EXCEPTION_ASSIGNED_NOTIFICATION, through each person's own
 * notification settings (User Settings > Notification Settings), as every
 * other event: email, SMS, call, push, WhatsApp, Telegram, Slack, Microsoft
 * Teams, webhooks - the channels they switched on. The setting is seeded,
 * email on, for a member who joined before it existed.
 */

export const EXCEPTION_ASSIGNED_JOB_NAME: string =
  "TelemetryException:SendAssignedNotification";

// The most entries one run takes; the rest are taken the next minute.
export const MAX_ASSIGNMENTS_PER_RUN: number = 500;

// The longest exception name a message carries.
export const EXCEPTION_NAME_MAX_LENGTH: number = 120;

export interface ExceptionAssignmentRecipient {
  userId: ObjectID;
  name: string;
}

// What every message about the assignment says.
export interface ExceptionAssignmentFacts {
  projectId: ObjectID;
  telemetryExceptionId: ObjectID;
  exceptionName: string;
  // Who assigned it: a person's name, an API key's, or OneUptime.
  assignedBy: string;
  // The team it was assigned to, when it was a team.
  teamName: string | null;
  projectName: string;
  url: string;
}

/*
 * "TypeError: x is undefined": the type and the message's first line, cut
 * to a line a message holds. Read with indexOf and slice, never a regular
 * expression: a message can be megabytes long.
 */
export function getExceptionNameForMessage(data: {
  exceptionType?: string | undefined | null;
  message?: string | undefined | null;
}): string {
  const type: string = (data.exceptionType || "")
    .slice(0, EXCEPTION_NAME_MAX_LENGTH * 2)
    .trim();
  const message: string = data.message || "";
  const lineEnd: number = message.indexOf("\n");
  const firstLine: string = (lineEnd >= 0 ? message.slice(0, lineEnd) : message)
    .slice(0, EXCEPTION_NAME_MAX_LENGTH * 2)
    .trim();
  const name: string =
    type && firstLine ? `${type}: ${firstLine}` : type || firstLine;

  if (!name) {
    return "An exception";
  }

  return name.length > EXCEPTION_NAME_MAX_LENGTH
    ? `${name.slice(0, EXCEPTION_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;
}

function sameId(
  a: ObjectID | string | null | undefined,
  b: ObjectID | string | null | undefined,
): boolean {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a!.toString().toLowerCase() === b!.toString().toLowerCase()
  );
}

export default class ExceptionAssignmentNotifications {
  // The exception's page in the Dashboard.
  public static async getExceptionUrl(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
  }): Promise<string> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString())
      .addRoute(
        `/${data.projectId.toString()}/exceptions/${data.telemetryExceptionId.toString()}`,
      )
      .toString();
  }

  /*
   * Whether the person can read the exception, by the check their own read
   * goes through: their roles, the resources those reach, their blocks.
   * Anyone who has left the project reads nothing.
   */
  @CaptureSpan()
  public static async canReadException(data: {
    userId: ObjectID;
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
  }): Promise<boolean> {
    try {
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.userId,
            projectId: data.projectId,
          },
        );

      const found: TelemetryException | null =
        await TelemetryExceptionService.findOneBy({
          query: {
            _id: data.telemetryExceptionId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true },
          props,
        });

      return Boolean(found);
    } catch (error) {
      // A refusal is an answer: they may not read it.
      logger.debug(
        `ExceptionAssignmentNotifications: ${data.userId.toString()} may not read exception ${data.telemetryExceptionId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * Who an assignment is told to (see above): the person, or the team's
   * members, who are members of the project and can read the exception,
   * the one who assigned it left out. Each person once.
   */
  @CaptureSpan()
  public static async getRecipients(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
    assigneeUserId?: ObjectID | null | undefined;
    assigneeTeamId?: ObjectID | null | undefined;
    assignedByUserId?: ObjectID | null | undefined;
  }): Promise<Array<ExceptionAssignmentRecipient>> {
    const candidates: Array<User> = [];

    if (data.assigneeUserId) {
      const user: User | null = await UserService.findOneById({
        id: data.assigneeUserId,
        select: { _id: true, name: true, email: true },
        props: { isRoot: true },
      });

      if (user) {
        candidates.push(user);
      }
    }

    if (data.assigneeTeamId) {
      candidates.push(
        ...(await TeamMemberService.getUsersInTeams([data.assigneeTeamId])),
      );
    }

    // A pending invitation has joined nothing.
    const members: Array<User> =
      await TeamMemberService.filterUsersToProjectMembers({
        projectId: data.projectId,
        users: candidates,
      });

    const recipients: Array<ExceptionAssignmentRecipient> = [];
    const seen: Set<string> = new Set<string>();

    for (const user of members) {
      const userId: ObjectID | null = user.id || null;

      if (!userId || seen.has(userId.toString().toLowerCase())) {
        continue;
      }

      seen.add(userId.toString().toLowerCase());

      // Nobody is told about what they did themselves.
      if (sameId(userId, data.assignedByUserId)) {
        continue;
      }

      if (
        !(await this.canReadException({
          userId,
          projectId: data.projectId,
          telemetryExceptionId: data.telemetryExceptionId,
        }))
      ) {
        continue;
      }

      recipients.push({
        userId,
        name: user.name?.toString() || user.email?.toString() || "",
      });
    }

    return recipients;
  }

  // The messages, one per channel, as every owner-added job sends them.
  public static buildMessages(
    facts: ExceptionAssignmentFacts,
    recipient: ExceptionAssignmentRecipient,
  ): {
    emailEnvelope: EmailEnvelope;
    smsMessage: SMSMessage;
    callRequestMessage: CallRequestMessage;
    pushNotificationMessage: PushNotificationMessage;
    whatsAppMessage: WhatsAppMessagePayload;
  } {
    const assignedTo: string = facts.teamName
      ? `to the team ${facts.teamName}, which you are on`
      : "to you";

    const subject: string = facts.teamName
      ? `Exception assigned to ${facts.teamName}: ${facts.exceptionName}`
      : `Exception assigned to you: ${facts.exceptionName}`;

    /*
     * SimpleMessage: the generic owner-added email (the SLO and network
     * device jobs use it too). It loads nothing from outside the
     * installation: its logo is inline, its only link is the exception's.
     */
    const vars: Dictionary<string> = {
      subject: subject,
      message: `${facts.assignedBy} assigned the exception ${facts.exceptionName} ${assignedTo}, in the project ${facts.projectName}. You can view it here: ${facts.url}`,
    };

    const sms: SMSMessage = {
      message: buildNotificationSms(
        facts.teamName
          ? `An exception was assigned to your team ${facts.teamName}: ${facts.exceptionName}.`
          : `An exception was assigned to you: ${facts.exceptionName}.`,
      ),
    };

    return {
      emailEnvelope: {
        templateType: EmailTemplateType.SimpleMessage,
        vars: vars,
        subject: subject,
        isSubjectLiteral: true,
      },
      smsMessage: sms,
      callRequestMessage: {
        data: [
          {
            sayMessage: `This is a message from OneUptime. ${facts.assignedBy} assigned an exception ${assignedTo}, in the project ${facts.projectName}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      },
      pushNotificationMessage: PushNotificationUtil.createGenericNotification({
        title: facts.teamName
          ? `Exception assigned to ${facts.teamName}`
          : "Exception assigned to you",
        body: `${facts.exceptionName}. Click to view it.`,
        clickAction: facts.url,
        tag: `exception-assigned-${facts.telemetryExceptionId.toString()}-${recipient.userId.toString()}`,
        requireInteraction: false,
      }),
      /*
       * No WhatsApp template is registered for this event: a plain body is
       * sent instead, as the SLO and network device owner-added jobs do.
       */
      whatsAppMessage: {
        body: sms.message,
      },
    };
  }

  /*
   * One Assigned entry, told (see above). Returns the people it was sent
   * to. Never throws for one person's broken setting: the others are still
   * told.
   */
  @CaptureSpan()
  public static async notifyAssignment(
    entry: TelemetryExceptionActivity,
  ): Promise<Array<ObjectID>> {
    if (
      entry.activityType !== TelemetryExceptionActivityType.Assigned ||
      !entry.projectId ||
      !entry.telemetryExceptionId ||
      (!entry.assigneeUserId && !entry.assigneeTeamId)
    ) {
      return [];
    }

    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          _id: entry.telemetryExceptionId.toString(),
          projectId: entry.projectId,
        },
        select: {
          _id: true,
          exceptionType: true,
          message: true,
          assignToUserId: true,
          assignToTeamId: true,
        },
        props: { isRoot: true },
      });

    if (!exception) {
      return [];
    }

    // Handed to someone else since: they are the one told, by their own entry.
    const isStillTheirs: boolean = entry.assigneeUserId
      ? sameId(exception.assignToUserId, entry.assigneeUserId)
      : sameId(exception.assignToTeamId, entry.assigneeTeamId);

    if (!isStillTheirs) {
      return [];
    }

    const recipients: Array<ExceptionAssignmentRecipient> =
      await this.getRecipients({
        projectId: entry.projectId,
        telemetryExceptionId: entry.telemetryExceptionId,
        assigneeUserId: entry.assigneeUserId || null,
        assigneeTeamId: entry.assigneeUserId
          ? null
          : entry.assigneeTeamId || null,
        assignedByUserId: entry.userId || null,
      });

    if (recipients.length === 0) {
      return [];
    }

    const facts: ExceptionAssignmentFacts = await this.getFacts({
      entry,
      exception,
    });

    const notified: Array<ObjectID> = [];
    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION;

    for (const recipient of recipients) {
      try {
        /*
         * Newer than most members: sendUserNotification sends nothing to a
         * person without a setting, so the default one (email on) is seeded
         * first. A person who switched it off keeps it off.
         */
        await UserNotificationSettingService.ensureSettingExistsForUser({
          userId: recipient.userId,
          projectId: entry.projectId,
          eventType: eventType,
        });

        await UserNotificationSettingService.sendUserNotification({
          userId: recipient.userId,
          projectId: entry.projectId,
          eventType: eventType,
          ...this.buildMessages(facts, recipient),
          ...(entry.assigneeTeamId && !entry.assigneeUserId
            ? { teamId: entry.assigneeTeamId }
            : {}),
        });

        notified.push(recipient.userId);
      } catch (error) {
        logger.error(
          `ExceptionAssignmentNotifications: could not tell ${recipient.userId.toString()} that exception ${entry.telemetryExceptionId.toString()} was assigned to them: ${error}`,
          { projectId: entry.projectId.toString() },
        );
      }
    }

    return notified;
  }

  private static async getFacts(data: {
    entry: TelemetryExceptionActivity;
    exception: TelemetryException;
  }): Promise<ExceptionAssignmentFacts> {
    const projectId: ObjectID = data.entry.projectId!;
    const telemetryExceptionId: ObjectID = data.entry.telemetryExceptionId!;

    const [project, team, assigner, url]: [
      Project | null,
      Team | null,
      User | null,
      string,
    ] = await Promise.all([
      ProjectService.findOneById({
        id: projectId,
        select: { _id: true, name: true },
        props: { isRoot: true },
      }),
      data.entry.assigneeTeamId && !data.entry.assigneeUserId
        ? TeamService.findOneById({
            id: data.entry.assigneeTeamId,
            select: { _id: true, name: true },
            props: { isRoot: true },
          })
        : Promise.resolve(null),
      data.entry.userId
        ? UserService.findOneById({
            id: data.entry.userId,
            select: { _id: true, name: true, email: true },
            props: { isRoot: true },
          })
        : Promise.resolve(null),
      this.getExceptionUrl({ projectId, telemetryExceptionId }),
    ]);

    const assignedBy: string =
      assigner?.name?.toString() ||
      assigner?.email?.toString() ||
      (data.entry.apiKeyName ? `The API key ${data.entry.apiKeyName}` : "") ||
      "OneUptime";

    return {
      projectId,
      telemetryExceptionId,
      exceptionName: getExceptionNameForMessage(data.exception),
      assignedBy,
      teamName:
        data.entry.assigneeTeamId && !data.entry.assigneeUserId
          ? team?.name?.toString() || "your team"
          : null,
      projectName: project?.name?.toString() || "OneUptime",
      url,
    };
  }

  /*
   * One run of the Workers' job: the Assigned entries not told yet, oldest
   * first, each marked told before anything is sent (so a failure is never
   * sent again every minute), then told. Returns how many entries it took.
   */
  @CaptureSpan()
  public static async sendPendingNotifications(): Promise<number> {
    const entries: Array<TelemetryExceptionActivity> =
      await TelemetryExceptionActivityService.findBy({
        query: {
          activityType: TelemetryExceptionActivityType.Assigned,
          isAssigneeNotified: false,
        },
        select: {
          _id: true,
          projectId: true,
          telemetryExceptionId: true,
          activityType: true,
          userId: true,
          apiKeyName: true,
          assigneeUserId: true,
          assigneeTeamId: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: MAX_ASSIGNMENTS_PER_RUN,
        skip: 0,
        props: { isRoot: true },
      });

    let taken: number = 0;

    for (const entry of entries) {
      if (!entry.id) {
        continue;
      }

      try {
        // Marked first: taken once, whatever happens next.
        const marked: number = await TelemetryExceptionActivityService.updateBy(
          {
            query: {
              _id: entry.id.toString(),
              isAssigneeNotified: false,
            },
            data: { isAssigneeNotified: true },
            limit: 1,
            skip: 0,
            props: { isRoot: true },
          },
        );

        // Another worker took it first.
        if (marked === 0) {
          continue;
        }

        taken++;
        await this.notifyAssignment(entry);
      } catch (error) {
        logger.error(
          `ExceptionAssignmentNotifications: could not tell the assignment ${entry.id.toString()}: ${error}`,
          { projectId: entry.projectId?.toString() },
        );
      }
    }

    return taken;
  }
}
