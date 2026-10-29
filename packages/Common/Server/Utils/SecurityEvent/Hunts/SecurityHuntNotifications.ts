import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityHunt from "../../../../Models/DatabaseModels/SecurityHunt";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CallRequestMessage } from "../../../../Types/Call/CallRequest";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { EmailEnvelope } from "../../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PushNotificationMessage from "../../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../../Types/SMS/SMS";
import {
  SecurityHuntRunWindow,
  countSecurityHuntFilterValues,
  isScheduledSecurityHunt,
} from "../../../../Types/SecurityEvent/SecurityHunt";
import TimeRange from "../../../../Types/Time/TimeRange";
import Timezone from "../../../../Types/Timezone";
import { buildNotificationSms } from "../../../../Utils/Sms/NotificationSms";
import DatabaseConfig from "../../../DatabaseConfig";
import Queue, { QueueName } from "../../../Infrastructure/Queue";
import AccessTokenService from "../../../Services/AccessTokenService";
import ProjectService from "../../../Services/ProjectService";
import SecurityHuntService from "../../../Services/SecurityHuntService";
import TeamMemberService from "../../../Services/TeamMemberService";
import UserNotificationSettingService from "../../../Services/UserNotificationSettingService";
import logger from "../../Logger";
import CallerPermission from "../../Permission/CallerPermission";
import PushNotificationUtil from "../../PushNotificationUtil";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * TELLING PEOPLE WHAT A SCHEDULED HUNT FOUND.
 *
 * A scheduled run that finds events (SecurityHuntScheduler) queues one job
 * (SECURITY_HUNT_NOTIFICATION_JOB); the Worker sends it to the people the
 * hunt names and the members of the teams it names, each through their own
 * notification settings for SEND_SECURITY_HUNT_FOUND_NOTIFICATION - email,
 * SMS, call, push, WhatsApp, Telegram, Slack and Microsoft Teams messages,
 * webhooks - as they chose (User Settings > Notification Settings).
 *
 * Only people who can read the project's hunts and its security events are
 * told: a hunt's findings are security data. What they are told is the
 * hunt, how many events its run found, and when those events arrived, with
 * the way to them - the hunt's page on that window, which reads the events
 * as whoever opens it. No event's own words travel in a message.
 *
 * The scheduler only queues the job and never waits on, or fails on, a
 * notification.
 */

export const SECURITY_HUNT_NOTIFICATION_JOB: string =
  "SecurityHunts:SendNotification";

export interface SecurityHuntRecipient {
  userId: ObjectID;
  name: string;
  email: string;
  timezone?: Timezone | undefined;
}

// What every message about a run of a hunt says.
export interface SecurityHuntFoundFacts {
  huntId: ObjectID;
  projectId: ObjectID;
  huntName: string;
  searchQuery: string;
  // How many chip values the hunt keeps beside its search.
  filterCount: number;
  projectName: string;
  // The hunt's page on the run's window.
  url: string;
  eventCount: number;
  startTime: Date;
  endTime: Date;
}

// What one notification says, in every form a person may receive it.
export interface SecurityHuntMessage {
  eventType: NotificationSettingEventType;
  subject: string;
  templateType: EmailTemplateType;
  emailVars: Dictionary<string>;
  smsText: string;
  callText: string;
  pushTitle: string;
  pushBody: string;
}

// "1 security event", "3 security events".
export function describeSecurityEventCount(count: number): string {
  return `${count.toLocaleString("en-US")} security ${count === 1 ? "event" : "events"}`;
}

/*
 * What a hunt searches for, in a message: its search as written, and how
 * many filters it keeps beside it.
 */
export function describeHuntSearch(data: {
  searchQuery: string;
  filterCount: number;
}): string {
  const search: string = data.searchQuery.trim();
  const filters: string =
    data.filterCount === 0
      ? ""
      : `${data.filterCount} ${data.filterCount === 1 ? "filter" : "filters"}`;

  if (search && filters) {
    return `${search} (and ${filters})`;
  }

  return search || filters;
}

// A moment as the person reads it: in their time zone, else UTC.
export function formatHuntTime(date: Date, timezone?: Timezone): string {
  return (
    OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
      date,
      timezones: [timezone || Timezone.UTC],
    })[0] || date.toISOString()
  );
}

/*
 * Where a hunt opens in the Dashboard: its page, on a run's window when one
 * is given (the Events page's own range params).
 */
export async function getHuntLinkInDashboard(data: {
  projectId: ObjectID;
  huntId: ObjectID;
  window?: SecurityHuntRunWindow | undefined;
}): Promise<URL> {
  const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
  const url: URL = URL.fromString(dashboardUrl.toString()).addRoute(
    `/${data.projectId.toString()}/security-events/hunts/${data.huntId.toString()}`,
  );

  if (data.window) {
    url.addQueryParam("range", TimeRange.CUSTOM, true);
    url.addQueryParam("start", data.window.startTime.toISOString(), true);
    url.addQueryParam("end", data.window.endTime.toISOString(), true);
  }

  return url;
}

// What a person is told when a scheduled run of a hunt finds events.
export function buildHuntFoundMessage(data: {
  facts: SecurityHuntFoundFacts;
  timezone?: Timezone | undefined;
}): SecurityHuntMessage {
  const { facts } = data;
  const found: string = describeSecurityEventCount(facts.eventCount);
  const from: string = formatHuntTime(facts.startTime, data.timezone);
  const to: string = formatHuntTime(facts.endTime, data.timezone);

  return {
    eventType:
      NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
    subject: `Hunt found ${found}: ${facts.huntName}`,
    templateType: EmailTemplateType.SecurityHuntFound,
    emailVars: {
      emailTitle: `Hunt found ${found}`,
      // The time range it read is the card's to say, under the hunt.
      leadSentence: `The scheduled hunt ${facts.huntName} found ${found}.`,
      huntName: facts.huntName,
      huntSearch: describeHuntSearch(facts),
      foundText: found,
      windowText: `${from} to ${to}`,
      projectName: facts.projectName,
      huntViewLink: facts.url,
      reasonSentence:
        "This scheduled hunt tells you, or a team you are on, when it finds security events. Change these emails in User Settings > Notification Settings.",
    },
    // Said as the subject says it, the name last: "Hunt found 3 security events: Encoded PowerShell."
    smsText: buildNotificationSms(`Hunt found ${found}: ${facts.huntName}.`),
    callText: `This is a message from OneUptime. The scheduled hunt ${facts.huntName} found ${found}. Open OneUptime to see them. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.`,
    pushTitle: `Hunt found ${found}`,
    pushBody: facts.huntName,
  };
}

function readId(data: JSONObject, key: string): ObjectID | undefined {
  const value: JSONValue | undefined = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : undefined;
}

function readDate(data: JSONObject, key: string): Date | undefined {
  const value: JSONValue | undefined = data[key];

  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default class SecurityHuntNotifications {
  /*
   * A scheduled run found events: queue the job that tells people. Never
   * throws (a run's record must not fail because nobody could be told);
   * says whether the job was queued.
   */
  @CaptureSpan()
  public static async huntFound(data: {
    projectId: ObjectID;
    securityHuntId: ObjectID;
    eventCount: number;
    window: SecurityHuntRunWindow;
  }): Promise<boolean> {
    try {
      await Queue.addJob(
        QueueName.Worker,
        `security-hunt-notification-${ObjectID.generate().toString()}`,
        SECURITY_HUNT_NOTIFICATION_JOB,
        {
          projectId: data.projectId.toString(),
          securityHuntId: data.securityHuntId.toString(),
          eventCount: data.eventCount,
          startTime: data.window.startTime.toISOString(),
          endTime: data.window.endTime.toISOString(),
        },
        {
          attempts: 3,
          backoffDelayInMs: 10000,
          skipExistenceCheck: true,
        },
      );

      return true;
    } catch (error) {
      logger.error(
        `SecurityHuntNotifications: could not queue the notification for hunt ${data.securityHuntId.toString()}:`,
      );
      logger.error(error);
      return false;
    }
  }

  // ---------- The job ----------

  @CaptureSpan()
  public static async runJob(data: JSONObject): Promise<void> {
    const projectId: ObjectID | undefined = readId(data, "projectId");
    const securityHuntId: ObjectID | undefined = readId(data, "securityHuntId");
    const startTime: Date | undefined = readDate(data, "startTime");
    const endTime: Date | undefined = readDate(data, "endTime");
    const eventCount: number = Number(data["eventCount"]);

    if (
      !projectId ||
      !securityHuntId ||
      !startTime ||
      !endTime ||
      !Number.isInteger(eventCount) ||
      eventCount <= 0
    ) {
      logger.warn(
        "SecurityHuntNotifications: a notification job without its project, hunt, window or count was dropped.",
      );
      return;
    }

    await this.notifyHuntFound({
      projectId,
      securityHuntId,
      eventCount,
      window: { startTime, endTime },
    });
  }

  /*
   * Tell the people a hunt names, and its teams' members, who can read it,
   * that a run found events. Returns who was told.
   */
  @CaptureSpan()
  public static async notifyHuntFound(data: {
    projectId: ObjectID;
    securityHuntId: ObjectID;
    eventCount: number;
    window: SecurityHuntRunWindow;
  }): Promise<Array<SecurityHuntRecipient>> {
    const hunt: SecurityHunt | null = await SecurityHuntService.findOneBy({
      query: {
        _id: data.securityHuntId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        searchQuery: true,
        filters: true,
        schedule: true,
        notifyUsers: {
          _id: true,
          name: true,
          email: true,
          timezone: true,
        },
        notifyTeams: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    // Deleted, or taken off its schedule, since it ran: nobody is waiting to hear.
    if (!hunt || !isScheduledSecurityHunt(hunt.schedule)) {
      return [];
    }

    const people: Array<SecurityHuntRecipient> = [];

    for (const user of hunt.notifyUsers || []) {
      const recipient: SecurityHuntRecipient | null = this.toRecipient(
        user.id || undefined,
        user,
      );

      if (recipient) {
        people.push(recipient);
      }
    }

    for (const team of hunt.notifyTeams || []) {
      if (team.id) {
        people.push(...(await this.getTeamMembers(data.projectId, team.id)));
      }
    }

    const recipients: Array<SecurityHuntRecipient> = await this.whoCanRead({
      projectId: data.projectId,
      people,
    });

    if (recipients.length === 0) {
      return [];
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    const facts: SecurityHuntFoundFacts = {
      huntId: data.securityHuntId,
      projectId: data.projectId,
      huntName: hunt.name || "Hunt",
      searchQuery: hunt.searchQuery || "",
      filterCount: countSecurityHuntFilterValues(
        hunt.filters as unknown as { [key: string]: Array<string> },
      ),
      projectName: project?.name || "",
      url: (
        await getHuntLinkInDashboard({
          projectId: data.projectId,
          huntId: data.securityHuntId,
          window: data.window,
        })
      ).toString(),
      eventCount: data.eventCount,
      startTime: data.window.startTime,
      endTime: data.window.endTime,
    };

    return await this.sendToPeople({ facts, recipients });
  }

  // ---------- Who ----------

  /*
   * The people among `people` who can read the project's hunts and its
   * security events, by the check their own reads go through: their roles,
   * and their blocks. Anyone who has left the project reads nothing.
   */
  public static async whoCanRead(data: {
    projectId: ObjectID;
    people: Array<SecurityHuntRecipient>;
  }): Promise<Array<SecurityHuntRecipient>> {
    const readers: Array<SecurityHuntRecipient> = [];

    for (const person of this.uniquePeople(data.people)) {
      if (
        await this.canReadHunts({
          userId: person.userId,
          projectId: data.projectId,
        })
      ) {
        readers.push(person);
      }
    }

    return readers;
  }

  public static async canReadHunts(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    try {
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.userId,
            projectId: data.projectId,
          },
        );

      return (
        CallerPermission.isProjectMember(props, data.projectId) &&
        CallerPermission.holdsAnyOf(
          props,
          new SecurityHunt().getReadPermissions(),
          { projectId: data.projectId },
        ) &&
        CallerPermission.holdsAnyOf(
          props,
          new SecurityEvent().getReadPermissions(),
          { projectId: data.projectId },
        )
      );
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        logger.error(
          `SecurityHuntNotifications: could not tell whether user ${data.userId.toString()} can read hunts in project ${data.projectId.toString()}:`,
        );
        logger.error(error);
      }

      return false;
    }
  }

  private static uniquePeople(
    people: Array<SecurityHuntRecipient>,
  ): Array<SecurityHuntRecipient> {
    const seen: Set<string> = new Set();

    return people.filter((person: SecurityHuntRecipient): boolean => {
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
  ): SecurityHuntRecipient | null {
    if (!userId) {
      return null;
    }

    return {
      userId,
      name: user?.name?.toString() || user?.email?.toString() || "",
      email: user?.email?.toString() || "",
      ...(user?.timezone ? { timezone: user.timezone } : {}),
    };
  }

  private static async getTeamMembers(
    projectId: ObjectID,
    teamId: ObjectID,
  ): Promise<Array<SecurityHuntRecipient>> {
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
          timezone: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    return members
      .map((member: TeamMember): SecurityHuntRecipient | null => {
        return this.toRecipient(member.userId, member.user);
      })
      .filter((recipient: SecurityHuntRecipient | null): boolean => {
        return Boolean(recipient);
      }) as Array<SecurityHuntRecipient>;
  }

  // ---------- Sending ----------

  // Each person as they chose to hear; one person's failure is nobody else's.
  private static async sendToPeople(data: {
    facts: SecurityHuntFoundFacts;
    recipients: Array<SecurityHuntRecipient>;
  }): Promise<Array<SecurityHuntRecipient>> {
    const notified: Array<SecurityHuntRecipient> = [];

    for (const recipient of data.recipients) {
      try {
        const message: SecurityHuntMessage = buildHuntFoundMessage({
          facts: data.facts,
          timezone: recipient.timezone,
        });

        // A member who joined before this event existed gets it now.
        await UserNotificationSettingService.addSecurityHuntNotificationSettings(
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
          PushNotificationUtil.createSecurityHuntNotification({
            title: message.pushTitle,
            body: message.pushBody,
            huntViewLink: data.facts.url,
            securityHuntId: data.facts.huntId.toString(),
            projectId: data.facts.projectId.toString(),
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: recipient.userId,
          projectId: data.facts.projectId,
          eventType: message.eventType,
          emailEnvelope,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
        });

        notified.push(recipient);
      } catch (error) {
        logger.error(
          `SecurityHuntNotifications: could not tell user ${recipient.userId.toString()} what hunt ${data.facts.huntId.toString()} found:`,
        );
        logger.error(error);
      }
    }

    return notified;
  }
}
