import ProjectService from "../../Services/ProjectService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import logger from "../Logger";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import ObjectID from "../../../Types/ObjectID";

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
 * IT FAILS OPEN
 *
 * The answer is cached per server (ProjectService.isProjectBlocked). A
 * lookup that fails sends the message as usual: a fault in a check that is
 * there for abuse must not stop every project's on-call pages with it.
 */
export default class BlockedProjectNotifications {
  public static getNotSentReason(channel: string): string {
    return `${channel} not sent: ${ExceptionMessages.ProjectBlocked}`;
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
  }): Promise<HTTPErrorResponse | null> {
    if (!data.projectId) {
      return null;
    }

    if (!(await BlockedProjectNotifications.isBlocked(data.projectId))) {
      return null;
    }

    const reason: string = BlockedProjectNotifications.getNotSentReason(
      data.channel,
    );

    logger.debug(reason, { projectId: data.projectId.toString() });

    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId || undefined,
      reason: reason,
    });

    return new HTTPErrorResponse(403, { message: reason }, {});
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
