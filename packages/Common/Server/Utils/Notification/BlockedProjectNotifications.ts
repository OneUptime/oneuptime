import ProjectService from "../../Services/ProjectService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import logger from "../Logger";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
} from "../Telemetry/NotificationDeliveryMetrics";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import ObjectID from "../../../Types/ObjectID";
import { getSampleProjectNotSentReason } from "../../../Types/SampleProject/SampleProject";

/*
 * NOTHING IS SENT FOR A BLOCKED PROJECT.
 *
 * A master admin blocks a project (Admin Dashboard > Projects) to take it
 * offline - most often for abuse - and a blocked project sends nothing until
 * it is unblocked: no email, SMS, call, WhatsApp, Telegram, push or webhook
 * from the senders that name its project (getRefusal), and no chat message
 * as its bot (WorkspaceUtil).
 *
 * A sender asked to send for one answers what it answers for a message the
 * project deliberately does not send: an HTTPErrorResponse, which the
 * subscriber sends count as not delivered and every other caller reads as a
 * failed send, and an on-call timeline entry that says why rather than
 * "Sending" for ever. Nothing reaches the Notification service.
 *
 * NOTHING IS SENT FOR A SAMPLE PROJECT EITHER.
 *
 * A sample project (Project.isSampleProject, issue #6808) is made up for a
 * person to look around in, and nobody is ever notified from it: every
 * sender that names its project refuses it here, the same way, with a
 * reason that says it is a sample (getRefusal, getSilencedReason). Its
 * sample people have no address that can receive anything either
 * (MailService refuses theirs), so a refusal here is the first of two.
 *
 * IT FAILS OPEN
 *
 * The answers are cached per server (ProjectService.isProjectBlocked,
 * ProjectService.isSampleProject). A lookup that fails sends the message as
 * usual: a fault in a check must not stop every project's on-call pages
 * with it.
 */
export default class BlockedProjectNotifications {
  public static getNotSentReason(channel: string): string {
    return `${channel} not sent: ${ExceptionMessages.ProjectBlocked}`;
  }

  /*
   * Why nothing may be sent for the project on `channel`: blocked by a
   * master admin, or a sample project; null when it may send, when none is
   * named, or when it cannot be told.
   */
  public static async getSilencedReason(data: {
    channel: string;
    projectId?: ObjectID | null | undefined;
  }): Promise<string | null> {
    if (!data.projectId) {
      return null;
    }

    if (await BlockedProjectNotifications.isBlocked(data.projectId)) {
      return BlockedProjectNotifications.getNotSentReason(data.channel);
    }

    if (await BlockedProjectNotifications.isSample(data.projectId)) {
      return getSampleProjectNotSentReason(data.channel);
    }

    return null;
  }

  /*
   * What a sender answers instead of sending, for a project a master admin
   * blocked; null when the project is not blocked, when none is named (an
   * account email, a sign-in code), or when it cannot be told.
   */
  public static async getRefusal(data: {
    channel: string;
    projectId?: ObjectID | null | undefined;
    userOnCallLogTimelineId?: ObjectID | null | undefined;
    /*
     * The channel as the platform's delivery metrics name it: a refusal is
     * counted there as not sent (NotificationDeliveryMetrics), since it
     * never reaches the sender that counts the rest.
     */
    deliveryChannel?: NotificationDeliveryChannel | undefined;
  }): Promise<HTTPErrorResponse | null> {
    if (!data.projectId) {
      return null;
    }

    const reason: string | null =
      await BlockedProjectNotifications.getSilencedReason({
        channel: data.channel,
        projectId: data.projectId,
      });

    if (!reason) {
      return null;
    }

    logger.debug(reason, { projectId: data.projectId.toString() });

    if (data.deliveryChannel) {
      NotificationDeliveryMetrics.recordNotSent({
        channel: data.deliveryChannel,
        isOnCallPage: Boolean(data.userOnCallLogTimelineId),
      });
    }

    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId || undefined,
      reason: reason,
    });

    return new HTTPErrorResponse(403, { message: reason }, {});
  }

  /*
   * Whether the project is a sample (issue #6808), which sends nothing;
   * false when it cannot be told.
   */
  public static async isSample(projectId: ObjectID): Promise<boolean> {
    try {
      return await ProjectService.isSampleProject(projectId);
    } catch (err) {
      logger.error(
        `Could not tell whether project ${projectId.toString()} is a sample project; its notifications are sent as usual.`,
      );
      logger.error(err);
      return false;
    }
  }

  // Whether nothing may be sent for the project; false when it cannot be told.
  public static async isBlocked(projectId: ObjectID): Promise<boolean> {
    try {
      return await ProjectService.isProjectBlocked(projectId);
    } catch (err) {
      logger.error(
        `Could not tell whether project ${projectId.toString()} is blocked; its notifications are sent as usual.`,
      );
      logger.error(err);
      return false;
    }
  }
}
