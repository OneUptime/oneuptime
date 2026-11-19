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

/*
 * HOW A CALL ENDED, AS TWILIO TELLS IT (CallOutcome, #8576): the sentence
 * a call's notification is left with once it ended, after the call's id
 * when Twilio gave one ("Call ID: CA0123…. The call was not answered: it
 * rang out.").
 */
export enum CallOutcomeLine {
  Answered = "answered",
  RangOut = "rang-out",
  Busy = "busy",
  NotConnected = "not-connected",
  /*
   * Voicemail answered it (Twilio's answering machine detection, #6594),
   * and OneUptime left a message once the greeting ended - or could not:
   * the call had ended, or the greeting never did.
   */
  VoicemailMessageLeft = "voicemail-message-left",
  VoicemailNoMessage = "voicemail-no-message",
  // A fax machine answered it.
  Fax = "fax",
}

export const CALL_ANSWERED_MESSAGE: string = "The call was answered.";
export const CALL_RANG_OUT_MESSAGE: string =
  "The call was not answered: it rang out.";
export const CALL_BUSY_MESSAGE: string =
  "The call was not answered: the line was busy, or the call was declined.";
export const CALL_NOT_CONNECTED_MESSAGE: string =
  "The call could not be connected.";
export const CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE: string =
  "The call was not answered: it went to voicemail, and a message was left.";
export const CALL_VOICEMAIL_NO_MESSAGE_MESSAGE: string =
  "The call was not answered: it went to voicemail, and no message was left.";
export const CALL_FAX_MESSAGE: string =
  "The call was not answered: a fax machine picked up.";

/*
 * The outcomes of a call that a machine answered, not the person: what the
 * record's feed adds after "Nitin did not answer the phone call"
 * (getCallMachineAnsweredFeedSentence).
 */
export const MACHINE_ANSWERED_CALL_OUTCOMES: ReadonlyArray<CallOutcomeLine> = [
  CallOutcomeLine.VoicemailMessageLeft,
  CallOutcomeLine.VoicemailNoMessage,
  CallOutcomeLine.Fax,
];

export function isMachineAnsweredCallOutcome(
  outcome: CallOutcomeLine | null | undefined,
): boolean {
  return Boolean(outcome && MACHINE_ANSWERED_CALL_OUTCOMES.includes(outcome));
}

/*
 * What the record's feed says after "Nitin did not answer the phone call
 * from on-call policy PolicyX at Level 1 of 3." of a call a machine
 * answered: whether it went to voicemail, and whether a message was left,
 * so a responder knows the person may hear it. Null for any other outcome:
 * a call that rang out or found the line busy is told of as before.
 */
export function getCallMachineAnsweredFeedSentence(
  outcome: CallOutcomeLine | null | undefined,
): string | null {
  switch (outcome) {
    case CallOutcomeLine.VoicemailMessageLeft:
      return "It went to voicemail, and a message was left.";
    case CallOutcomeLine.VoicemailNoMessage:
      return "It went to voicemail, and no message was left.";
    case CallOutcomeLine.Fax:
      return "A fax machine picked up.";
    default:
      return null;
  }
}

// "The call was answered and lasted 42 seconds." ("1 second").
export function getCallAnsweredAndLastedMessage(seconds: number): string {
  return `The call was answered and lasted ${
    seconds === 1 ? "1 second" : `${seconds} seconds`
  }.`;
}

// The call's line: its id first, when there is one, then how it ended.
export function getCallOutcomeMessage(data: {
  callId: string | null;
  sentence: string;
}): string {
  return data.callId
    ? `${getCallIdStatusMessage(data.callId)}. ${data.sentence}`
    : data.sentence;
}

const CALL_OUTCOME_WITH_ID: RegExp = /^Call ID: (\S+?)\. ([\s\S]+)$/;
const ANSWERED_AND_LASTED: RegExp =
  /^The call was answered and lasted (\d+) seconds?\.$/;

/*
 * How a call ended, its id and how long it lasted, read back from a call's
 * line and checked against its builder; null for any other line.
 */
export function readCallOutcomeMessage(
  statusMessage: string | null | undefined,
): {
  outcome: CallOutcomeLine;
  seconds?: number | undefined;
  callId?: string | undefined;
} | null {
  const message: string = (statusMessage || "").trim();
  const withId: RegExpMatchArray | null = message.match(CALL_OUTCOME_WITH_ID);
  const callId: string | undefined = withId ? withId[1] : undefined;
  const sentence: string = withId ? withId[2]! : message;

  const known: Array<[string, CallOutcomeLine]> = [
    [CALL_ANSWERED_MESSAGE, CallOutcomeLine.Answered],
    [CALL_RANG_OUT_MESSAGE, CallOutcomeLine.RangOut],
    [CALL_BUSY_MESSAGE, CallOutcomeLine.Busy],
    [CALL_NOT_CONNECTED_MESSAGE, CallOutcomeLine.NotConnected],
    [CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE, CallOutcomeLine.VoicemailMessageLeft],
    [CALL_VOICEMAIL_NO_MESSAGE_MESSAGE, CallOutcomeLine.VoicemailNoMessage],
    [CALL_FAX_MESSAGE, CallOutcomeLine.Fax],
  ];

  for (const [words, outcome] of known) {
    if (sentence === words) {
      return { outcome: outcome, ...(callId ? { callId: callId } : {}) };
    }
  }

  const lasted: RegExpMatchArray | null = sentence.match(ANSWERED_AND_LASTED);

  if (lasted) {
    const seconds: number = Number(lasted[1]);

    if (getCallAnsweredAndLastedMessage(seconds) === sentence) {
      return {
        outcome: CallOutcomeLine.Answered,
        seconds: seconds,
        ...(callId ? { callId: callId } : {}),
      };
    }
  }

  return null;
}
