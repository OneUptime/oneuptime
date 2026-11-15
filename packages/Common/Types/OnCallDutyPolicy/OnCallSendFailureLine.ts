import { OnCallPageChannel } from "./OnCallPageChannel";

/*
 * WHAT A PAGE'S MESSAGE SAYS WHEN IT WAS NOT SENT, IN ONEUPTIME'S WORDS
 * (#7550).
 *
 * A page's notification that failed says why on its row of the person's
 * on-call timeline (UserOnCallLogTimeline), in English for every reader.
 * Some of those lines are OneUptime's own sentences, not a provider's:
 *
 *   - the Notification service turned the request away, or answered with
 *     an error (Server/Utils/OnCall/OnCallSendFailure): "The Notification
 *     service refused to send this (HTTP 400): <its words>.";
 *   - the request never reached it: "Could not reach the Notification
 *     service to send this (ECONNREFUSED).";
 *   - a send failed with no words of its own: "Error sending SMS.";
 *   - a workspace that is not connected: "This project is not connected to
 *     Slack. Please go to Project Settings and connect the account."
 *
 * Each is written here, and read back here into what it says - so a line
 * that changes is read the same way, or not at all - for a test page's
 * result to word it in the reader's language (OnCallTestPageLine). The
 * service's own words after a refusal are not OneUptime's: they are kept
 * as written, a value of the sentence.
 *
 * React-free and server-safe: the server, the dashboard and their tests
 * read it.
 */

// The end of a sentence words already have - or words cut short.
const SENTENCE_END: RegExp = /[.!?…]$/;

const escapeForRegExp: (text: string) => string = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
 * A SEND THAT FAILED WITH NO WORDS OF ITS OWN: what a page's notification
 * says when its send threw an error that said nothing (whenSendFails,
 * whenNotificationRequestFails' fallbackStatusMessage).
 */
export type OnCallSendFailedChannel =
  | OnCallPageChannel.Email
  | OnCallPageChannel.SMS
  | OnCallPageChannel.WhatsApp
  | OnCallPageChannel.Telegram
  | OnCallPageChannel.Webhook
  | OnCallPageChannel.Call
  | OnCallPageChannel.Push;

const SEND_FAILED_LINES: Readonly<Record<OnCallSendFailedChannel, string>> = {
  [OnCallPageChannel.Email]: "Error sending email.",
  [OnCallPageChannel.SMS]: "Error sending SMS.",
  [OnCallPageChannel.WhatsApp]: "Error sending WhatsApp message.",
  [OnCallPageChannel.Telegram]: "Error sending Telegram message.",
  [OnCallPageChannel.Webhook]: "Error sending webhook.",
  [OnCallPageChannel.Call]: "Error making call.",
  [OnCallPageChannel.Push]: "Error sending push notification.",
};

// "Error sending email.", "Error making call.".
export function getOnCallSendFailedMessage(
  channel: OnCallSendFailedChannel,
): string {
  return SEND_FAILED_LINES[channel];
}

// The chat workspaces a page messages a person on.
export type OnCallWorkspaceChannel =
  | OnCallPageChannel.Slack
  | OnCallPageChannel.MicrosoftTeams
  | OnCallPageChannel.Mattermost;

const WORKSPACE_CHANNELS: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.Slack,
  OnCallPageChannel.MicrosoftTeams,
  OnCallPageChannel.Mattermost,
];

export function isOnCallWorkspaceChannel(
  channel: OnCallPageChannel | null | undefined,
): channel is OnCallWorkspaceChannel {
  return Boolean(channel && WORKSPACE_CHANNELS.includes(channel));
}

/*
 * A workspace message whose send threw with no words: "Error sending
 * Microsoft Teams message." - by the workspace's name as people read it
 * (getWorkspaceTypeDisplayName), which is the page channel's own.
 */
export function getOnCallWorkspaceSendFailedMessage(
  workspaceDisplayName: string,
): string {
  return `Error sending ${workspaceDisplayName} message.`;
}

/*
 * A workspace's direct message that failed with no words of its own
 * (WorkspaceUserNotificationService): "Failed to send Slack direct
 * message."
 */
export function getOnCallWorkspaceDirectMessageFailedMessage(
  workspaceDisplayName: string,
): string {
  return `Failed to send ${workspaceDisplayName} direct message.`;
}

/*
 * What a custom channel is called in a line, when it has no name of its
 * own.
 */
export const ON_CALL_CUSTOM_CHANNEL_FALLBACK_NAME: string =
  "the custom channel";

const CUSTOM_CHANNEL_SEND_FAILED_PREFIX: string = "Error sending to ";
const CUSTOM_CHANNEL_SEND_FAILED_SUFFIX: string = ".";

// "Error sending to Ops bridge."
export function getOnCallCustomChannelSendFailedMessage(
  channelName: string | null | undefined,
): string {
  return `${CUSTOM_CHANNEL_SEND_FAILED_PREFIX}${
    channelName || ON_CALL_CUSTOM_CHANNEL_FALLBACK_NAME
  }${CUSTOM_CHANNEL_SEND_FAILED_SUFFIX}`;
}

/*
 * Whether a message's line says its send failed with no words, and - for a
 * custom channel - the channel's name it gives. Null for any other line.
 * A custom channel with no name of its own gives none.
 */
export function readOnCallSendFailedLine(data: {
  statusMessage: string | null | undefined;
  channel: OnCallPageChannel | null | undefined;
}): { name?: string | undefined } | null {
  const message: string = (data.statusMessage || "").trim();
  const channel: OnCallPageChannel | null | undefined = data.channel;

  if (!message || !channel) {
    return null;
  }

  if (isOnCallWorkspaceChannel(channel)) {
    return message === getOnCallWorkspaceSendFailedMessage(channel) ||
      message === getOnCallWorkspaceDirectMessageFailedMessage(channel)
      ? {}
      : null;
  }

  if (channel === OnCallPageChannel.CustomChannel) {
    if (
      message.length <=
        CUSTOM_CHANNEL_SEND_FAILED_PREFIX.length +
          CUSTOM_CHANNEL_SEND_FAILED_SUFFIX.length ||
      !message.startsWith(CUSTOM_CHANNEL_SEND_FAILED_PREFIX) ||
      !message.endsWith(CUSTOM_CHANNEL_SEND_FAILED_SUFFIX)
    ) {
      return null;
    }

    const name: string = message
      .slice(
        CUSTOM_CHANNEL_SEND_FAILED_PREFIX.length,
        message.length - CUSTOM_CHANNEL_SEND_FAILED_SUFFIX.length,
      )
      .trim();

    if (!name) {
      return null;
    }

    return name === ON_CALL_CUSTOM_CHANNEL_FALLBACK_NAME ? {} : { name: name };
  }

  const line: string | undefined = (
    SEND_FAILED_LINES as Partial<Record<OnCallPageChannel, string>>
  )[channel];

  return line && message === line ? {} : null;
}

/*
 * THE NOTIFICATION SERVICE'S ANSWER, WHEN IT WAS AN ERROR
 * (OnCallSendFailure's getAnsweredFailureStatusMessage):
 *
 *   The Notification service refused to send this (HTTP 400): Email
 *   ana@ is not in valid format.
 *
 *   The Notification service answered with an error (HTTP 500), so this
 *   may not have been sent: Server Error.
 *
 * A refusal (4xx) is sure: nothing was sent. Any other error answer is
 * not. The words after the colon are the service's, as it answered.
 */
const NOTIFICATION_SERVICE_REFUSED: string =
  "The Notification service refused to send this";
const NOTIFICATION_SERVICE_ANSWER_FAILED: string =
  "The Notification service answered with an error";
const MAY_NOT_HAVE_BEEN_SENT: string = ", so this may not have been sent";

// Whether an answer's status is a refusal: a 4xx.
export function isNotificationServiceRefusal(
  statusCode: number | null | undefined,
): boolean {
  return (
    typeof statusCode === "number" && statusCode >= 400 && statusCode <= 499
  );
}

/*
 * The line for an error answer: its HTTP status, when it had a valid one,
 * and the service's own words, already fit for a person's timeline (on one
 * line, nothing secret in them), when it had any.
 */
export function getNotificationServiceAnswerLine(data: {
  statusCode: number | null;
  words: string;
}): string {
  const status: string =
    data.statusCode !== null ? ` (HTTP ${data.statusCode})` : "";

  const sentence: string = isNotificationServiceRefusal(data.statusCode)
    ? `${NOTIFICATION_SERVICE_REFUSED}${status}`
    : `${NOTIFICATION_SERVICE_ANSWER_FAILED}${status}${MAY_NOT_HAVE_BEEN_SENT}`;

  if (!data.words) {
    return `${sentence}.`;
  }

  return `${sentence}: ${SENTENCE_END.test(data.words) ? data.words : `${data.words}.`}`;
}

export interface NotificationServiceAnswerLine {
  // A 4xx: the request was turned away, and nothing was sent.
  isRefused: boolean;
  // The answer's HTTP status, when the line names one.
  statusCode?: number | undefined;
  // The service's own words, as the line gives them - with their full stop.
  words?: string | undefined;
}

const REFUSED_LINE: RegExp = new RegExp(
  `^${escapeForRegExp(NOTIFICATION_SERVICE_REFUSED)} \\(HTTP (4\\d\\d)\\)(?:\\.|: ([\\s\\S]+))$`,
);

const ANSWER_FAILED_LINE: RegExp = new RegExp(
  `^${escapeForRegExp(NOTIFICATION_SERVICE_ANSWER_FAILED)}(?: \\(HTTP ([1-5]\\d\\d)\\))?${escapeForRegExp(MAY_NOT_HAVE_BEEN_SENT)}(?:\\.|: ([\\s\\S]+))$`,
);

/*
 * What an error answer's line says, read back: refused or not, its status
 * and the service's words. Null for any other line.
 */
export function readNotificationServiceAnswerLine(
  statusMessage: string | null | undefined,
): NotificationServiceAnswerLine | null {
  const message: string = (statusMessage || "").trim();

  if (!message) {
    return null;
  }

  const refused: RegExpExecArray | null = REFUSED_LINE.exec(message);

  if (refused) {
    const words: string = (refused[2] || "").trim();

    return {
      isRefused: true,
      statusCode: Number(refused[1]),
      ...(words ? { words: words } : {}),
    };
  }

  const failed: RegExpExecArray | null = ANSWER_FAILED_LINE.exec(message);

  if (failed) {
    const words: string = (failed[2] || "").trim();

    /*
     * A 4xx is never this line: its writer calls it a refusal. A line that
     * says so anyway was not written here.
     */
    if (failed[1] && isNotificationServiceRefusal(Number(failed[1]))) {
      return null;
    }

    return {
      isRefused: false,
      ...(failed[1] ? { statusCode: Number(failed[1]) } : {}),
      ...(words ? { words: words } : {}),
    };
  }

  return null;
}

/*
 * THE REQUEST NEVER REACHED THE NOTIFICATION SERVICE: the connection was
 * refused, or the service's address did not resolve
 * (NotificationRequestFailure). The code is the socket's: "ECONNREFUSED",
 * "ENOTFOUND".
 */
const NOT_REACHED_PREFIX: string =
  "Could not reach the Notification service to send this (";
const NOT_REACHED_SUFFIX: string = ").";

// "Could not reach the Notification service to send this (ECONNREFUSED)."
export function getNotificationServiceNotReachedLine(code: string): string {
  return `${NOT_REACHED_PREFIX}${code}${NOT_REACHED_SUFFIX}`;
}

// The code a not-reached line names, or null for any other line.
export function readNotificationServiceNotReachedLine(
  statusMessage: string | null | undefined,
): string | null {
  const message: string = (statusMessage || "").trim();

  if (
    message.length <= NOT_REACHED_PREFIX.length + NOT_REACHED_SUFFIX.length ||
    !message.startsWith(NOT_REACHED_PREFIX) ||
    !message.endsWith(NOT_REACHED_SUFFIX)
  ) {
    return null;
  }

  const code: string = message
    .slice(
      NOT_REACHED_PREFIX.length,
      message.length - NOT_REACHED_SUFFIX.length,
    )
    .trim();

  return code || null;
}

/*
 * A WORKSPACE THAT IS NOT CONNECTED, when a page messages a person on it
 * (WorkspaceUserNotificationService): the person's own account, or the
 * project's connection to the workspace. By the workspace's name as people
 * read it (getWorkspaceTypeDisplayName).
 */
export function getWorkspaceAccountNotConnectedLine(
  workspaceDisplayName: string,
): string {
  return `This account is not connected to ${workspaceDisplayName}. Please go to User Settings and connect the account.`;
}

export function getWorkspaceProjectNotConnectedLine(
  workspaceDisplayName: string,
): string {
  return `This project is not connected to ${workspaceDisplayName}. Please go to Project Settings and connect the account.`;
}

/*
 * Whose connection a workspace message's line says is missing - the
 * project's, or the person's own account's - or null for any other line.
 */
export function readWorkspaceNotConnectedLine(data: {
  statusMessage: string | null | undefined;
  channel: OnCallPageChannel | null | undefined;
}): { isProjectConnection: boolean } | null {
  const message: string = (data.statusMessage || "").trim();

  if (!message || !isOnCallWorkspaceChannel(data.channel)) {
    return null;
  }

  if (message === getWorkspaceProjectNotConnectedLine(data.channel)) {
    return { isProjectConnection: true };
  }

  if (message === getWorkspaceAccountNotConnectedLine(data.channel)) {
    return { isProjectConnection: false };
  }

  return null;
}
