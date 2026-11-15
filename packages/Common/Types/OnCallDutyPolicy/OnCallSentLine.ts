/*
 * WHAT A PAGE'S NOTIFICATION SAYS ONCE IT WENT OUT, OR WAS ANSWERED (#8434).
 *
 * Each notification of a person's page (UserOnCallLogTimeline) says how it
 * went in its status message, in English, for every reader: the sender of
 * each channel writes it as the provider takes the message (MailService,
 * SmsService, CallService, WhatsAppService, TelegramService,
 * PushNotificationService, WorkspaceUserNotificationService), and the
 * acknowledgement writes its own (OnCallNotificationStatus).
 *
 * The senders write these lines from here, and the on-call logs read them
 * back into codes (OnCallLogLine) to word them in the reader's language:
 * the same words as before, so a notification written before this file is
 * read the same. A provider's own words - why an SMS was not delivered, a
 * mail service's answer - are not here: they are drawn as written.
 *
 * React-free and server-safe.
 */

// What a notification the person acknowledged the page from says.
export const ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE: string =
  "Notification Acknowledged";

/*
 * What every email that went says it was not: delivered. Its first two
 * sentences say it alone, where a mail service's answer needs the room
 * (EmailStatusMessage.getSentWithoutImagesStatusMessage).
 */
export const EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT: string =
  "This does not mean the email was delivered. We do not track email delivery.";

export const EMAIL_DELIVERY_NOT_TRACKED: string = `${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT} If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.`;

// An email the mail service took.
export const EMAIL_SENT_STATUS_MESSAGE: string = `Email sent successfully. ${EMAIL_DELIVERY_NOT_TRACKED}`;

// A push notification that reached at least one of the person's devices.
export const PUSH_NOTIFICATION_SENT_MESSAGE: string =
  "Push notification sent successfully";

// A Telegram or a WhatsApp message the provider took without an id.
export const TELEGRAM_MESSAGE_SENT_MESSAGE: string =
  "Telegram message sent successfully";
export const WHATSAPP_MESSAGE_SENT_MESSAGE: string =
  "WhatsApp message sent successfully";

/*
 * An SMS, a WhatsApp or a Telegram message the provider took, by the id it
 * gave it ("Message ID: SM0123"), and a call it placed ("Call ID: CA0123").
 */
const MESSAGE_ID_LINE_START: string = "Message ID: ";
const CALL_ID_LINE_START: string = "Call ID: ";
const WHITESPACE: RegExp = /\s/;

export function getMessageIdStatusMessage(messageId: string): string {
  return `${MESSAGE_ID_LINE_START}${messageId}`;
}

export function getCallIdStatusMessage(callId: string): string {
  return `${CALL_ID_LINE_START}${callId}`;
}

/*
 * The id a "Message ID: ..." or "Call ID: ..." line names, and which of the
 * two it is; null for any other line.
 */
export function readProviderIdStatusMessage(
  statusMessage: string | null | undefined,
): { id: string; isCall: boolean } | null {
  const message: string = (statusMessage || "").trim();

  for (const [start, isCall] of [
    [MESSAGE_ID_LINE_START, false],
    [CALL_ID_LINE_START, true],
  ] as Array<[string, boolean]>) {
    if (message.startsWith(start)) {
      const id: string = message.slice(start.length).trim();

      // An id is one word: anything else is some other line.
      return id && !WHITESPACE.test(id) ? { id: id, isCall: isCall } : null;
    }
  }

  return null;
}

/*
 * A direct message a Slack, Microsoft Teams or Mattermost workspace took:
 * "Message sent on Slack."
 */
const WORKSPACE_MESSAGE_SENT_START: string = "Message sent on ";
const WORKSPACE_MESSAGE_SENT_END: string = ".";

export function getWorkspaceMessageSentMessage(workspaceName: string): string {
  return `${WORKSPACE_MESSAGE_SENT_START}${workspaceName}${WORKSPACE_MESSAGE_SENT_END}`;
}

// The workspace a "Message sent on ..." line names, or null for any other line.
export function readWorkspaceMessageSentMessage(
  statusMessage: string | null | undefined,
): string | null {
  const message: string = (statusMessage || "").trim();

  if (
    !message.startsWith(WORKSPACE_MESSAGE_SENT_START) ||
    !message.endsWith(WORKSPACE_MESSAGE_SENT_END)
  ) {
    return null;
  }

  const name: string = message
    .slice(
      WORKSPACE_MESSAGE_SENT_START.length,
      message.length - WORKSPACE_MESSAGE_SENT_END.length,
    )
    .trim();

  return name || null;
}

// What an observer's notification says once they said they have seen it (OnCallObserverPage).
export const ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE: string =
  "Marked as seen, paged as an observer";

/*
 * What the stuck check writes on a notification that said Sending for too
 * long (OnCallStuckNotifications): no result came back, so it may well not
 * have gone out.
 */
const STUCK_NOTIFICATION_START: string = "Sending did not finish within ";
const STUCK_NOTIFICATION_END: string =
  " minutes, so this notification may not have been sent.";
const WHOLE_MINUTES: RegExp = /^\d+$/;

export function getStuckNotificationStatusMessage(minutes: number): string {
  return `${STUCK_NOTIFICATION_START}${minutes}${STUCK_NOTIFICATION_END}`;
}

// The minutes a stuck notification's line names, or null for any other line.
export function readStuckNotificationMinutes(
  statusMessage: string | null | undefined,
): number | null {
  const message: string = (statusMessage || "").trim();

  if (
    !message.startsWith(STUCK_NOTIFICATION_START) ||
    !message.endsWith(STUCK_NOTIFICATION_END)
  ) {
    return null;
  }

  const minutes: string = message.slice(
    STUCK_NOTIFICATION_START.length,
    message.length - STUCK_NOTIFICATION_END.length,
  );

  return WHOLE_MINUTES.test(minutes) ? Number(minutes) : null;
}

/*
 * What a provider's delivery report writes over an SMS's or a WhatsApp
 * message's notification (API/SMS.ts, API/WhatsApp.ts): its status, the
 * message's id, and the provider's error code or words when it failed.
 *
 *   "Delivery status: Undelivered. Message ID: SM0123. Provider error code: 30003."
 *   "Delivery status: Failed. Message ID: wamid.1. Provider error: Message undeliverable (code 131026)."
 */
export interface ProviderDeliveryStatus {
  status: string;
  messageId?: string | undefined;
  errorCode?: string | undefined;
  // The provider's own words for why it failed, as written.
  providerError?: string | undefined;
}

export function getProviderDeliveryStatusMessage(
  report: ProviderDeliveryStatus,
): string {
  let message: string = `Delivery status: ${report.status}.`;

  if (report.messageId) {
    message += ` Message ID: ${report.messageId}.`;
  }

  if (report.errorCode) {
    message += ` Provider error code: ${report.errorCode}.`;
  }

  if (report.providerError) {
    message += ` Provider error: ${report.providerError}.`;
  }

  return message;
}

const PROVIDER_DELIVERY_STATUS: RegExp =
  /^Delivery status: ([^.]+)\.(?: Message ID: (\S+?)\.)?(?: Provider error code: (\S+?)\.)?(?: Provider error: ([\s\S]+)\.)?$/;

/*
 * A provider's delivery report read back, checked against the builder; null
 * for any other line.
 */
export function readProviderDeliveryStatusMessage(
  statusMessage: string | null | undefined,
): ProviderDeliveryStatus | null {
  const message: string = (statusMessage || "").trim();
  const parts: RegExpMatchArray | null = message.match(
    PROVIDER_DELIVERY_STATUS,
  );

  if (!parts) {
    return null;
  }

  const report: ProviderDeliveryStatus = {
    status: parts[1]!,
    ...(parts[2] ? { messageId: parts[2] } : {}),
    ...(parts[3] ? { errorCode: parts[3] } : {}),
    ...(parts[4] ? { providerError: parts[4] } : {}),
  };

  return getProviderDeliveryStatusMessage(report) === message ? report : null;
}

/*
 * An email the mail service took without its images, with the service's
 * own words for refusing them, and that delivery is not tracked
 * (EmailStatusMessage.getSentWithoutImagesStatusMessage).
 */
export const EMAIL_SENT_WITHOUT_IMAGES_PREFIX: string =
  "Email sent successfully without its images, which the mail service refused: ";

// The mail service's words a "sent without its images" line names, or null.
export function readEmailSentWithoutImagesMessage(
  statusMessage: string | null | undefined,
): string | null {
  const message: string = (statusMessage || "").trim();

  if (!message.startsWith(EMAIL_SENT_WITHOUT_IMAGES_PREFIX)) {
    return null;
  }

  for (const note of [
    ` ${EMAIL_DELIVERY_NOT_TRACKED}`,
    ` ${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT}`,
  ]) {
    if (message.endsWith(note)) {
      const answer: string = message
        .slice(
          EMAIL_SENT_WITHOUT_IMAGES_PREFIX.length,
          message.length - note.length,
        )
        .trim();

      return answer || null;
    }
  }

  return null;
}
