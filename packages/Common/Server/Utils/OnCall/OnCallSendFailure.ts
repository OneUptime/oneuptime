import logger from "../Logger";
import {
  SEND_RESULT_MOVES_ON_FROM,
  STUCK_NOTIFICATION_AFTER_MINUTES,
  writeNotificationStatusWhileStill,
} from "./OnCallNotificationStatus";
import {
  classifyNotificationRequestFailure,
  getNotReachedStatusMessage,
  NotificationRequestFailure,
  NotificationRequestFailureKind,
} from "./NotificationRequestFailure";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

/*
 * WHAT A PAGE'S NOTIFICATION SAYS WHEN ITS SEND THREW (issue #6873).
 *
 * A page writes each notification as Sending, then asks for it to be sent
 * (UserNotificationRuleService). Most are a request to the Notification
 * service - an email, an SMS, a call, a WhatsApp or Telegram message, a
 * webhook, a custom channel - which writes the notification's result
 * itself. Common's API.post hands back an answer that is an HTTP error
 * rather than throwing it, so the request throws only when no answer came
 * back (API.getErrorResponse), or when the send failed before the request
 * was made:
 *
 *  - The request never reached the Notification service: the connection
 *    was refused, or the service's address did not resolve. Nothing was
 *    sent, and nothing else will write the notification: Error.
 *  - The request may have reached it: the connection was reset or hung up
 *    after it was sent, or no answer came in time - a replica restarting
 *    during a deploy, a network blip. The Notification service may still
 *    send it and write how it went, so nothing is claimed here. One whose
 *    result never comes is settled by the stuck check
 *    (OnCallStuckNotifications).
 *  - Not a request that got no answer: the send failed before the request
 *    was made. Error, with the failure's own words.
 *
 * A push or a Slack, Microsoft Teams or Mattermost message is sent in this
 * process, which writes its result itself (PushNotificationService,
 * WorkspaceUserNotificationService); its handler only covers a failure
 * raised before that: Error.
 *
 * Every Error is written over Sending only, at the version read
 * (OnCallNotificationStatus): never over the send's own result, a
 * provider's report, or the person's acknowledgement.
 *
 * How the request went is read by NotificationRequestFailure.
 */

// The words of whatever was thrown, or null when it has none.
function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message || null;
  }

  if (typeof error === "string") {
    return error || null;
  }

  return null;
}

/*
 * Writes Error with the message over Sending only. Never throws: a send's
 * failure handler has nobody to hand a failure to.
 */
async function writeNotSent(data: {
  userOnCallLogTimelineId: ObjectID;
  statusMessage: string;
}): Promise<void> {
  try {
    await writeNotificationStatusWhileStill({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      from: SEND_RESULT_MOVES_ON_FROM,
      status: UserNotificationStatus.Error,
      statusMessage: data.statusMessage,
    });
  } catch (err) {
    logger.error(
      `On-call notification ${data.userOnCallLogTimelineId.toString()}: could not record that it was not sent (${data.statusMessage}): ${err}`,
    );
  }
}

/*
 * A request to the Notification service to send a page's notification
 * threw: what the notification says now, by what the error says of the
 * request. Never throws.
 */
export async function recordNotificationRequestFailure(data: {
  userOnCallLogTimelineId: ObjectID;
  error: unknown;
  // Said when the error has no words of its own.
  fallbackStatusMessage: string;
}): Promise<void> {
  const failure: NotificationRequestFailure | null =
    classifyNotificationRequestFailure(data.error);

  if (failure?.kind === NotificationRequestFailureKind.NoAnswer) {
    logger.warn(
      `On-call notification ${data.userOnCallLogTimelineId.toString()}: the request to the Notification service got no answer (${failure.code}), so whether it was sent is not known here. It is left to the Notification service's own result, or to the stuck check after ${STUCK_NOTIFICATION_AFTER_MINUTES} minutes: ${getErrorMessage(data.error) || failure.code}`,
    );

    return;
  }

  if (failure?.kind === NotificationRequestFailureKind.NotReached) {
    logger.error(
      `On-call notification ${data.userOnCallLogTimelineId.toString()}: not sent, the request never reached the Notification service: ${getErrorMessage(data.error) || failure.code}`,
    );

    await writeNotSent({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      statusMessage: getNotReachedStatusMessage(failure.code),
    });

    return;
  }

  await writeNotSent({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    statusMessage: getErrorMessage(data.error) || data.fallbackStatusMessage,
  });
}

/*
 * A send in this process - a push, a Slack, Microsoft Teams or Mattermost
 * message - threw before writing its own result: Error, over Sending only.
 * Never throws.
 */
export async function recordSendFailure(data: {
  userOnCallLogTimelineId: ObjectID;
  error: unknown;
  // Said when the error has no words of its own.
  fallbackStatusMessage: string;
}): Promise<void> {
  await writeNotSent({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    statusMessage: getErrorMessage(data.error) || data.fallbackStatusMessage,
  });
}

/*
 * The failure handler of a request to the Notification service, for the
 * send's `.catch`: recordNotificationRequestFailure.
 */
export function whenNotificationRequestFails(data: {
  userOnCallLogTimelineId: ObjectID;
  fallbackStatusMessage: string;
}): (error: unknown) => Promise<void> {
  return async (error: unknown): Promise<void> => {
    await recordNotificationRequestFailure({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      error: error,
      fallbackStatusMessage: data.fallbackStatusMessage,
    });
  };
}

/*
 * The failure handler of a send in this process, for the send's `.catch`:
 * recordSendFailure.
 */
export function whenSendFails(data: {
  userOnCallLogTimelineId: ObjectID;
  fallbackStatusMessage: string;
}): (error: unknown) => Promise<void> {
  return async (error: unknown): Promise<void> => {
    await recordSendFailure({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      error: error,
      fallbackStatusMessage: data.fallbackStatusMessage,
    });
  };
}
