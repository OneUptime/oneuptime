import logger from "../Logger";
import { redactLogString } from "../LogRedaction";
import {
  recordSendResult,
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
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
 * A request the Notification service answered with an error - a 4xx or a
 * 5xx - does not throw: API.post hands the answer back (issue #7083). The
 * service writes the notification's result itself once its sender ran, so an
 * error answer matters when it failed before that: the request refused, or
 * the route failing on its way to the sender. Each send hands its answer to
 * whenNotificationRequestAnswers, which writes Error with the answer's own
 * words (getAnsweredFailureStatusMessage) - instead of leaving the
 * notification Sending until the stuck check says it may not have gone out.
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

/*
 * How much of an error answer's own words a notification keeps: enough for
 * any refusal the Notification service writes, well within its message.
 */
export const MAX_ANSWER_WORDS_LENGTH: number = 300;

// A run of white space, where an answer's words are broken into words.
const WHITE_SPACE_RUN: RegExp = /\s+/;

// The end of a sentence an answer's words already have - or words cut short.
const SENTENCE_END: RegExp = /[.!?…]$/;

// What a word that is an address is shown as: an answer never names one.
const ADDRESS_PLACEHOLDER: string = "[address]";

/*
 * The words of an error answer, fit for a person's timeline: on one line,
 * no address in them (a word with :// - the service's own, or anything it
 * called), no credential (redactLogString), and no longer than
 * MAX_ANSWER_WORDS_LENGTH. Empty when it had none, or when it is a page of
 * markup - an HTML error page from a proxy in front of the service, which
 * HTTPErrorResponse hands back whole as its message.
 */
function getAnswerWords(message: string | undefined): string {
  if (!message || message.trimStart().startsWith("<")) {
    return "";
  }

  const words: string = message
    .split(WHITE_SPACE_RUN)
    .filter((word: string) => {
      return word.length > 0;
    })
    .map((word: string) => {
      return word.includes("://") ? ADDRESS_PLACEHOLDER : word;
    })
    .join(" ");

  const safeWords: string = redactLogString(words);

  if (safeWords.length <= MAX_ANSWER_WORDS_LENGTH) {
    return safeWords;
  }

  return `${safeWords.substring(0, MAX_ANSWER_WORDS_LENGTH - 1).trimEnd()}…`;
}

/*
 * What a notification whose request the Notification service answered with
 * an error says, in its words:
 *
 *   The Notification service refused to send this (HTTP 400): Email
 *   ana@ is not in valid format.
 *
 * A refusal (4xx) is sure: the request was turned away before anything was
 * sent. Any other error answer is not: the service may have failed after
 * the message went out - writing its log, say - so it says it may not have
 * been sent, as the stuck check does:
 *
 *   The Notification service answered with an error (HTTP 500), so this
 *   may not have been sent: Server Error.
 */
export function getAnsweredFailureStatusMessage(answer: {
  statusCode?: number | undefined;
  message?: string | undefined;
}): string {
  const statusCode: number | null =
    typeof answer.statusCode === "number" &&
    Number.isInteger(answer.statusCode) &&
    answer.statusCode >= 100 &&
    answer.statusCode <= 599
      ? answer.statusCode
      : null;

  const status: string = statusCode ? ` (HTTP ${statusCode})` : "";
  const words: string = getAnswerWords(answer.message);

  const sentence: string =
    statusCode !== null && statusCode >= 400 && statusCode <= 499
      ? `The Notification service refused to send this${status}`
      : `The Notification service answered with an error${status}, so this may not have been sent`;

  if (!words) {
    return `${sentence}.`;
  }

  return `${sentence}: ${SENTENCE_END.test(words) ? words : `${words}.`}`;
}

/*
 * A page's request to the Notification service was answered: when the
 * answer is an error (an HTTPErrorResponse, which API.post hands back
 * rather than throws), the notification says so - Error with the answer's
 * words, over Sending only, or over the stuck check's verdict: this is the
 * request's own result, come late (recordSendResult). An answer that is
 * not an error writes nothing: the Notification service wrote its result.
 * Whether it was written. Never throws.
 */
export async function recordNotificationRequestAnswer(data: {
  userOnCallLogTimelineId: ObjectID;
  answer: unknown;
}): Promise<boolean> {
  if (!(data.answer instanceof HTTPErrorResponse)) {
    return false;
  }

  const statusMessage: string = getAnsweredFailureStatusMessage({
    statusCode: data.answer.statusCode,
    message: data.answer.message,
  });

  try {
    const isWritten: boolean = await recordSendResult({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      isSent: false,
      statusMessage: statusMessage,
    });

    if (isWritten) {
      logger.error(
        `On-call notification ${data.userOnCallLogTimelineId.toString()}: not sent, the Notification service answered the request to send it with an error: ${statusMessage}`,
      );
    }

    return isWritten;
  } catch (err) {
    logger.error(
      `On-call notification ${data.userOnCallLogTimelineId.toString()}: could not record that the Notification service answered with an error (${statusMessage}): ${err}`,
    );

    return false;
  }
}

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
 * The answer handler of a request to the Notification service, for the
 * send's `.then`, ahead of its `.catch`: recordNotificationRequestAnswer.
 * Never throws, so the `.catch` after it hears of the request only.
 */
export function whenNotificationRequestAnswers(data: {
  userOnCallLogTimelineId: ObjectID;
}): (answer: unknown) => Promise<void> {
  return async (answer: unknown): Promise<void> => {
    await recordNotificationRequestAnswer({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      answer: answer,
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
