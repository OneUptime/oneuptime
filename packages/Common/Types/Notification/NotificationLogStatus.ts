import CallStatus from "../Call/CallStatus";
import { isSentToCallAndSmsGatewayMessage } from "../CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "../Mail/MailStatus";
import { OnCallPageChannel } from "../OnCallDutyPolicy/OnCallPageChannel";
import {
  CallOutcomeLine,
  readCallOutcomeMessage,
} from "../OnCallDutyPolicy/OnCallSentLine";
import PushStatus from "../PushNotification/PushStatus";
import SmsStatus from "../SmsStatus";
import TelegramStatus from "../TelegramStatus";
import { translationKey } from "../Translator";
import UserNotificationStatus from "../UserNotification/UserNotificationStatus";
import WebhookStatus from "../WebhookStatus";
import WhatsAppStatus from "../WhatsAppStatus";
import WorkspaceNotificationStatus from "../Workspace/WorkspaceNotificationStatus";
import NotificationLogKind from "./NotificationLogKind";

/*
 * WHAT EVERY STATUS OF EVERY NOTIFICATION LOG MEANS (#11138, #11416).
 *
 * "What are the statuses in SMS Logs, and is Sent or Delivered the last one
 * on the happy path?" The logs never said. Each table coloured its pills its
 * own way - an SMS still waiting for its carrier's receipt read a green Sent,
 * a Telegram message that failed a yellow one, a project out of balance red
 * in one log, orange in another and grey in a third - and none said what a
 * status meant. So every status of the eight logs (email, SMS, WhatsApp,
 * Telegram, webhook, call, push, workspace) is placed here once, by what it
 * means for the message: its word, where it stands (the colour it is drawn
 * in) and a sentence or two that say what happened and what comes next.
 *
 * Every page that says what became of a message reads it here, so a message
 * reads alike wherever it is shown (#11416): each log's pill
 * (NotificationLogStatusPill), an incident's or an alert's Who Was Told, a
 * test page's result and a person's On-Call Logs. They used to sum a
 * message up in words of their own, and said "Sent" alike of a call still
 * ringing and one that was answered, of an SMS waiting for its carrier's
 * receipt and of one the server's own gateway took for good - and people
 * read "Sent" as "they got it".
 *
 * Where a message stands, the colour the Dashboard draws it in:
 *
 *   - grey: handed over, and nothing has come back yet (Sending, Queued);
 *   - blue: the provider took it, and is still to say how it ended - an SMS
 *     its carrier accepted (Sent), a call that is ringing (Calling);
 *   - green: it reached them - Delivered, Read, an answered call - or the
 *     provider took it and will say nothing more, so this is its last
 *     status: an email the mail server accepted, an SMS the server's own
 *     gateway took, a Telegram message posted in its chat;
 *   - yellow: it reached the phone and nobody answered, or it went with a
 *     warning;
 *   - red: it did not reach them - not sent, refused, undelivered.
 *
 * So the same word can mean two things: Sent is blue for an SMS Twilio's
 * carrier accepted - Delivered or Undelivered comes next - and green for
 * one the server's own gateway took, which reports nothing after it
 * (CallAndSmsGatewayLine). The log's message tells them apart
 * (NotificationLogStatusLine), and each pill says which.
 *
 * Every word here is a key of the Dashboard's locales, looked up where it is
 * drawn: the status as the log stores it (a WhatsApp message's Read with a
 * key of its own, as the bare Read is the verb), and each sentence on its
 * own, run together the way the reader's script writes a paragraph. A
 * sentence several statuses say ("View Status Message says why.") is worded
 * once. React-free and server-safe: Who Was Told's server reads the same
 * meanings to say where a person stands.
 */

export { NotificationLogKind };

// Where a message stands: the colour its status is drawn in.
export enum NotificationLogStatusMeaning {
  // Handed over; nothing has come back yet.
  HandedOver = "HandedOver",
  // The provider took it, and is still to say how it ended.
  OnItsWay = "OnItsWay",
  /*
   * It reached them: the carrier, WhatsApp or Telegram said it was
   * delivered or read, or the call was answered.
   */
  Reached = "Reached",
  /*
   * The provider took it and will say nothing more, so this is its last
   * status: an email the mail server accepted, an SMS or a call the
   * server's own gateway took, a Telegram message posted in its chat.
   */
  Done = "Done",
  // It reached the phone and nobody answered, or it went with a warning.
  NeedsALook = "NeedsALook",
  // It did not reach them.
  NotSent = "NotSent",
  // A status OneUptime cannot place.
  Unknown = "Unknown",
}

/*
 * WHAT A LOG'S MESSAGE SAYS THAT CHANGES WHAT ITS STATUS MEANS: the two
 * places one stored status means two things. A page that draws a log's
 * status away from its message - Who Was Told, which never hands a sent
 * message's provider id to the browser - carries this instead.
 */
export enum NotificationLogStatusLine {
  /*
   * The server's own SMS and call gateway took the SMS or the call
   * (CallAndSmsGatewayLine): it reports nothing after, so the SMS's Sent
   * and the call's Success are its last status.
   */
  SentToGateway = "SentToGateway",
  // Twilio said the call was answered: the call's Success is an answer.
  Answered = "Answered",
}

/*
 * A log's status as the pages that summarise it carry it: which log, the
 * status as it stores it, and what its message says that changes what the
 * status means.
 */
export interface NotificationLogStatusReading {
  kind: NotificationLogKind;
  status: string;
  line?: NotificationLogStatusLine | undefined;
}

export interface NotificationLogStatusWords {
  /*
   * The status as the log draws it: a key, looked up where it is drawn -
   * or, for a value OneUptime does not know, the stored value as written.
   */
  text: string;
  isTextAsWritten?: boolean | undefined;
  meaning: NotificationLogStatusMeaning;
  /*
   * What it means and what comes next, a whole sentence at a time, each a
   * key: said wherever the status is drawn.
   */
  explanation: ReadonlyArray<string>;
  /*
   * Where its log says more: a sentence that names one of the log's own
   * columns or buttons ("Error Code says why.", "View Status Message says
   * why."), said by the log alone. A page that draws the status away from
   * its log - Who Was Told, a test page's result - has neither, and says
   * why a message failed on a line of its own.
   */
  inTheLog?: string | undefined;
}

/*
 * THE STATUSES' WORDS: the stored values, worded as the logs draw them -
 * the words the on-call test page and Who Was Told say, where they say one.
 */
const SENDING: string = translationKey("Sending");
const SENT: string = translationKey("Sent");
const DELIVERED: string = translationKey("Delivered");
const UNDELIVERED: string = translationKey("Undelivered");
const FAILED: string = translationKey("Failed");
const ERROR: string = translationKey("Error");
const LOW_BALANCE: string = translationKey("Low Balance");
const SUCCESS: string = translationKey("Success");
const CALLING: string = translationKey("Calling");
// Stored "Missed Call": drawn in the words the other call lists use.
const MISSED_CALL: string = translationKey("Missed call");
const BUSY: string = translationKey("Busy");
const VOICEMAIL: string = translationKey("Voicemail");
const QUEUED: string = translationKey("Queued");
/*
 * A message the person has read. The bare Read is the Read buttons' verb,
 * worded so in every language (Lesen, Чтение, 読み取り): a key of its own
 * (Common/Types/MeaningKeys).
 */
const READ: string = translationKey("Read (message status)");
const WARNING: string = translationKey("Warning");
const DELETED: string = translationKey("Deleted");
const NOT_VERIFIED: string = translationKey("Not Verified");
const UNKNOWN: string = translationKey("Unknown");

// THE SENTENCES SEVERAL STATUSES SAY.
const VIEW_STATUS_MESSAGE_SAYS_WHY: string = translationKey(
  "View Status Message says why.",
);
const VIEW_STATUS_MESSAGE_SHOWS_IT: string = translationKey(
  "View Status Message shows what was reported.",
);
const ERROR_CODE_SAYS_WHY: string = translationKey("Error Code says why.");
const LAST_STATUS: string = translationKey("This is its last status.");
const MESSAGE_NOT_SENT: string = translationKey("The message was not sent.");

const M: typeof NotificationLogStatusMeaning = NotificationLogStatusMeaning;

function words(
  text: string,
  meaning: NotificationLogStatusMeaning,
  ...explanation: Array<string>
): NotificationLogStatusWords {
  return { text: text, meaning: meaning, explanation: explanation };
}

// The same words, and where the log says more.
function wordsWithLogSentence(
  text: string,
  meaning: NotificationLogStatusMeaning,
  inTheLog: string,
  ...explanation: Array<string>
): NotificationLogStatusWords {
  return {
    text: text,
    meaning: meaning,
    explanation: explanation,
    inTheLog: inTheLog,
  };
}

// What every log says of a project out of balance: it was not sent, and who can add some.
function getLowBalanceWords(): NotificationLogStatusWords {
  return wordsWithLogSentence(
    LOW_BALANCE,
    M.NotSent,
    translationKey("View Status Message says who can add balance."),
    translationKey(
      "It was not sent: the project's balance was too low to pay for it.",
    ),
  );
}

function getSmsStatusWords(
  status: SmsStatus,
  line: NotificationLogStatusLine | null,
): NotificationLogStatusWords {
  switch (status) {
    case SmsStatus.Sending:
      return words(
        SENDING,
        M.HandedOver,
        translationKey(
          "OneUptime handed the SMS to Twilio, which is passing it to the carrier.",
        ),
        translationKey("It moves to Sent once the carrier accepts it."),
      );
    case SmsStatus.Sent:
      /*
       * The server's own gateway took it, and reports nothing after: its
       * last status. Twilio's carrier accepted it: on its way.
       */
      if (line === NotificationLogStatusLine.SentToGateway) {
        return words(
          SENT,
          M.Done,
          translationKey("Your SMS and call gateway accepted the SMS."),
          translationKey(
            "Gateways do not report delivery, so this is its last status.",
          ),
        );
      }

      return words(
        SENT,
        M.OnItsWay,
        translationKey("The carrier accepted the SMS."),
        translationKey(
          "It moves to Delivered or Undelivered once the carrier reports back.",
        ),
        translationKey(
          "Some carriers never report back, so an SMS can stay Sent.",
        ),
      );
    case SmsStatus.Delivered:
      return words(
        DELIVERED,
        M.Reached,
        translationKey("The carrier confirmed the SMS reached the phone."),
        LAST_STATUS,
      );
    case SmsStatus.Undelivered:
      return wordsWithLogSentence(
        UNDELIVERED,
        M.NotSent,
        ERROR_CODE_SAYS_WHY,
        translationKey(
          "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts.",
        ),
      );
    case SmsStatus.Failed:
      return wordsWithLogSentence(
        FAILED,
        M.NotSent,
        ERROR_CODE_SAYS_WHY,
        translationKey("Twilio could not send the SMS."),
      );
    case SmsStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("The SMS was not sent."),
      );
    case SmsStatus.LowBalance:
      return getLowBalanceWords();
    // Twilio took it, before OneUptime was told what became of an SMS.
    case SmsStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey("Twilio accepted the SMS."),
        translationKey(
          "It was sent before OneUptime tracked delivery, so whether it was delivered is not known.",
        ),
      );
  }
}

function getCallStatusWords(
  status: CallStatus,
  line: NotificationLogStatusLine | null,
): NotificationLogStatusWords {
  switch (status) {
    case CallStatus.Calling:
      return words(
        CALLING,
        M.OnItsWay,
        translationKey("Twilio placed the call."),
        translationKey("It changes once Twilio says how the call ended."),
      );
    case CallStatus.Success:
      // Twilio said it was answered: the message says so, and how long it lasted.
      if (line === NotificationLogStatusLine.Answered) {
        return wordsWithLogSentence(
          SUCCESS,
          M.Reached,
          translationKey("View Status Message says how long it lasted."),
          translationKey("The call was answered."),
        );
      }

      if (line === NotificationLogStatusLine.SentToGateway) {
        return words(
          SUCCESS,
          M.Done,
          translationKey("Your SMS and call gateway accepted the call."),
          translationKey(
            "Gateways do not report whether a call was answered, so this is its last status.",
          ),
        );
      }

      /*
       * Placed, and never told how it ended: on a server Twilio cannot call
       * back, or before Calling was written.
       */
      return words(
        SUCCESS,
        M.Done,
        translationKey("Twilio placed the call."),
        translationKey(
          "OneUptime was not told how it ended, so this is its last status.",
        ),
      );
    case CallStatus.MissedCall:
      return words(
        MISSED_CALL,
        M.NeedsALook,
        translationKey("The call rang out: nobody answered."),
      );
    case CallStatus.Busy:
      return words(
        BUSY,
        M.NeedsALook,
        translationKey("The line was busy, or the call was declined."),
      );
    case CallStatus.Voicemail:
      return wordsWithLogSentence(
        VOICEMAIL,
        M.NeedsALook,
        translationKey("View Status Message says whether a message was left."),
        translationKey("Voicemail answered the call."),
      );
    case CallStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("The call could not be made or connected."),
      );
    case CallStatus.LowBalance:
      return getLowBalanceWords();
  }
}

function getWhatsAppStatusWords(
  status: WhatsAppStatus,
): NotificationLogStatusWords {
  switch (status) {
    case WhatsAppStatus.Queued:
      return words(
        QUEUED,
        M.HandedOver,
        translationKey("OneUptime is handing the message to WhatsApp."),
        translationKey("It moves to Sent once WhatsApp accepts it."),
      );
    case WhatsAppStatus.Sent:
      return words(
        SENT,
        M.OnItsWay,
        translationKey("WhatsApp accepted the message."),
        translationKey("It moves to Delivered once it reaches the phone."),
      );
    case WhatsAppStatus.Delivered:
      return words(
        DELIVERED,
        M.Reached,
        translationKey("The message reached the phone."),
        translationKey(
          "It moves to Read once it is opened, if the person shares read receipts.",
        ),
      );
    case WhatsAppStatus.Read:
      return words(
        READ,
        M.Reached,
        translationKey("The message was opened."),
        LAST_STATUS,
      );
    case WhatsAppStatus.Warning:
      return wordsWithLogSentence(
        WARNING,
        M.NeedsALook,
        translationKey("View Status Message says what WhatsApp reported."),
        translationKey("WhatsApp sent the message with a warning."),
      );
    case WhatsAppStatus.Failed:
      return wordsWithLogSentence(
        FAILED,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("WhatsApp could not deliver the message."),
      );
    case WhatsAppStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        MESSAGE_NOT_SENT,
      );
    case WhatsAppStatus.LowBalance:
      return getLowBalanceWords();
    case WhatsAppStatus.NotVerified:
      return words(
        NOT_VERIFIED,
        M.NotSent,
        translationKey("It was not sent: the WhatsApp number is not verified."),
      );
    case WhatsAppStatus.Deleted:
      return words(
        DELETED,
        M.Unknown,
        translationKey("WhatsApp reported the message as deleted."),
      );
    case WhatsAppStatus.Unknown:
      return wordsWithLogSentence(
        UNKNOWN,
        M.Unknown,
        VIEW_STATUS_MESSAGE_SHOWS_IT,
        translationKey("WhatsApp reported a status OneUptime does not know."),
      );
    // What the first WhatsApp sends wrote once Meta took the message.
    case WhatsAppStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey("WhatsApp accepted the message."),
        translationKey("OneUptime was not told whether it was delivered."),
      );
  }
}

function getTelegramStatusWords(
  status: TelegramStatus,
): NotificationLogStatusWords {
  switch (status) {
    case TelegramStatus.Queued:
      return words(
        QUEUED,
        M.HandedOver,
        translationKey("OneUptime is handing the message to Telegram."),
      );
    // Telegram took it and posted it: it reports nothing after that.
    case TelegramStatus.Sent:
      return words(
        SENT,
        M.Done,
        translationKey("Telegram posted the message in the chat."),
        translationKey(
          "Telegram does not report when it is read, so this is its last status.",
        ),
      );
    case TelegramStatus.Delivered:
      return words(
        DELIVERED,
        M.Reached,
        translationKey("The message reached the chat."),
      );
    case TelegramStatus.Read:
      return words(READ, M.Reached, translationKey("The message was read."));
    case TelegramStatus.Failed:
      return wordsWithLogSentence(
        FAILED,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("Telegram could not deliver the message."),
      );
    case TelegramStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        MESSAGE_NOT_SENT,
      );
    case TelegramStatus.LowBalance:
      return getLowBalanceWords();
    case TelegramStatus.NotVerified:
      return words(
        NOT_VERIFIED,
        M.NotSent,
        translationKey("It was not sent: the Telegram chat is not verified."),
      );
    case TelegramStatus.Unknown:
      return wordsWithLogSentence(
        UNKNOWN,
        M.Unknown,
        VIEW_STATUS_MESSAGE_SHOWS_IT,
        translationKey("Telegram reported a status OneUptime does not know."),
      );
    case TelegramStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey("Telegram accepted the message."),
      );
  }
}

function getEmailStatusWords(status: MailStatus): NotificationLogStatusWords {
  switch (status) {
    case MailStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey("The mail server accepted the email."),
        translationKey(
          "OneUptime does not track it further, so this is its last status.",
        ),
      );
    case MailStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("The email was not sent."),
      );
  }
}

function getPushStatusWords(status: PushStatus): NotificationLogStatusWords {
  switch (status) {
    case PushStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey(
          "The push service accepted the notification for the device.",
        ),
        translationKey(
          "If it reports later that the notification was not delivered, this changes to Error.",
        ),
      );
    case PushStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey("The push notification was not delivered."),
      );
  }
}

function getWebhookStatusWords(
  status: WebhookStatus,
): NotificationLogStatusWords {
  switch (status) {
    case WebhookStatus.Success:
      return wordsWithLogSentence(
        SUCCESS,
        M.Done,
        translationKey("HTTP Status shows its answer."),
        translationKey("The webhook's address accepted the request."),
      );
    case WebhookStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
        translationKey(
          "The webhook's address refused the request, or could not be reached.",
        ),
      );
  }
}

/*
 * A workspace's log keeps every action: a message posted, a channel made, a
 * person invited, a button pressed, a video call started.
 */
function getWorkspaceStatusWords(
  status: WorkspaceNotificationStatus,
): NotificationLogStatusWords {
  switch (status) {
    case WorkspaceNotificationStatus.Success:
      return words(SUCCESS, M.Done, translationKey("The action went through."));
    case WorkspaceNotificationStatus.Error:
      return wordsWithLogSentence(
        ERROR,
        M.NotSent,
        translationKey("Reason says why."),
        translationKey("The action did not go through."),
      );
  }
}

function isValueOf<TEnum extends string>(
  values: Record<string, TEnum>,
  value: string,
): value is TEnum {
  return (Object.values(values) as Array<string>).includes(value);
}

/*
 * A stored value OneUptime does not know - written by something newer, or
 * by hand through the API: drawn as written, grey.
 */
function getUnknownStatusWords(status: string): NotificationLogStatusWords {
  return {
    text: status,
    isTextAsWritten: true,
    meaning: M.Unknown,
    explanation: [translationKey("OneUptime does not know this status.")],
    inTheLog: VIEW_STATUS_MESSAGE_SHOWS_IT,
  };
}

/*
 * What a log's message says that changes what its status means, or null:
 * an SMS's Sent or a call's Success the server's own gateway took (its last
 * status), and a call's Success that Twilio said was answered - the line
 * the call's log keeps (CallOutcome), read as the call log's pill reads it.
 * Read the same wherever the message is: a log's own row, or the page's
 * notification it was sent for, which keeps the same lines.
 */
export function readNotificationLogStatusLine(data: {
  kind: NotificationLogKind;
  status: string | null | undefined;
  statusMessage?: string | null | undefined;
}): NotificationLogStatusLine | null {
  const isGatewayLine: boolean = isSentToCallAndSmsGatewayMessage(
    data.statusMessage,
  );

  if (data.kind === NotificationLogKind.SMS && data.status === SmsStatus.Sent) {
    return isGatewayLine ? NotificationLogStatusLine.SentToGateway : null;
  }

  if (
    data.kind === NotificationLogKind.Call &&
    data.status === CallStatus.Success
  ) {
    if (
      readCallOutcomeMessage(data.statusMessage)?.outcome ===
      CallOutcomeLine.Answered
    ) {
      return NotificationLogStatusLine.Answered;
    }

    return isGatewayLine ? NotificationLogStatusLine.SentToGateway : null;
  }

  return null;
}

/*
 * What a log's status means: its word, where it stands (its colour) and
 * what to say of it. Some statuses read by the log's message too: an SMS
 * the gateway took is Sent for good, and a call's Success says whether it
 * was answered. A page with the message reads it (`statusMessage`); a page
 * that carries only what the message says hands that over (`line`). Null
 * for a log with no status.
 */
export function getNotificationLogStatusWords(data: {
  kind: NotificationLogKind;
  status: string | null | undefined;
  statusMessage?: string | null | undefined;
  line?: NotificationLogStatusLine | null | undefined;
}): NotificationLogStatusWords | null {
  const status: string | null | undefined = data.status;

  if (!status) {
    return null;
  }

  const line: NotificationLogStatusLine | null =
    data.line || readNotificationLogStatusLine(data);

  switch (data.kind) {
    case NotificationLogKind.SMS:
      return isValueOf(SmsStatus, status)
        ? getSmsStatusWords(status, line)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Call:
      return isValueOf(CallStatus, status)
        ? getCallStatusWords(status, line)
        : getUnknownStatusWords(status);
    case NotificationLogKind.WhatsApp:
      return isValueOf(WhatsAppStatus, status)
        ? getWhatsAppStatusWords(status)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Telegram:
      return isValueOf(TelegramStatus, status)
        ? getTelegramStatusWords(status)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Email:
      return isValueOf(MailStatus, status)
        ? getEmailStatusWords(status)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Push:
      return isValueOf(PushStatus, status)
        ? getPushStatusWords(status)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Webhook:
      return isValueOf(WebhookStatus, status)
        ? getWebhookStatusWords(status)
        : getUnknownStatusWords(status);
    case NotificationLogKind.Workspace:
      return isValueOf(WorkspaceNotificationStatus, status)
        ? getWorkspaceStatusWords(status)
        : getUnknownStatusWords(status);
  }
}

/*
 * WHAT A PAGE'S NOTIFICATION SAYS OF ITS LOG, from the notification alone
 * (a person's UserOnCallLogTimeline row: a test page's result, a person's
 * On-Call Logs). The notification says Sent once its provider took the
 * message, whatever became of it after; its log says more.
 *
 * Read only where the notification says it for certain:
 *
 *   - an email, a push notification, a Telegram message, a Slack, Microsoft
 *     Teams or Mattermost message and a webhook: their providers say
 *     nothing after they take a message, so a sent notification's log
 *     holds its last status - the email's Success, Telegram's Sent;
 *   - an SMS or a call the server's own gateway took, and a call Twilio
 *     said was answered: the notification keeps the line its log keeps
 *     (the call's status callback writes it on both).
 *
 * Null for anything else: an SMS or a WhatsApp message on its way or
 * delivered, and a call still ringing or never answered, whose own logs say
 * which (the test page reads them); a custom channel, which keeps no log; a
 * notification that did not go out, or that the person answered or
 * escalated from, which says more than its log.
 */
export function readPageNotificationLogStatus(data: {
  channel: OnCallPageChannel | null | undefined;
  status: UserNotificationStatus | string | null | undefined;
  statusMessage?: string | null | undefined;
}): NotificationLogStatusReading | null {
  if (data.status !== UserNotificationStatus.Sent) {
    return null;
  }

  switch (data.channel) {
    case OnCallPageChannel.Email:
      return { kind: NotificationLogKind.Email, status: MailStatus.Success };
    case OnCallPageChannel.Push:
      return { kind: NotificationLogKind.Push, status: PushStatus.Success };
    case OnCallPageChannel.Telegram:
      return {
        kind: NotificationLogKind.Telegram,
        status: TelegramStatus.Sent,
      };
    case OnCallPageChannel.Slack:
    case OnCallPageChannel.MicrosoftTeams:
    case OnCallPageChannel.Mattermost:
      return {
        kind: NotificationLogKind.Workspace,
        status: WorkspaceNotificationStatus.Success,
      };
    case OnCallPageChannel.Webhook:
      return {
        kind: NotificationLogKind.Webhook,
        status: WebhookStatus.Success,
      };
    case OnCallPageChannel.SMS: {
      const line: NotificationLogStatusLine | null =
        readNotificationLogStatusLine({
          kind: NotificationLogKind.SMS,
          status: SmsStatus.Sent,
          statusMessage: data.statusMessage,
        });

      return line
        ? { kind: NotificationLogKind.SMS, status: SmsStatus.Sent, line: line }
        : null;
    }
    case OnCallPageChannel.Call: {
      const line: NotificationLogStatusLine | null =
        readNotificationLogStatusLine({
          kind: NotificationLogKind.Call,
          status: CallStatus.Success,
          statusMessage: data.statusMessage,
        });

      return line
        ? {
            kind: NotificationLogKind.Call,
            status: CallStatus.Success,
            line: line,
          }
        : null;
    }
    default:
      return null;
  }
}

/*
 * THE STATUSES EACH LOG'S STATUS FILTER OFFERS, IN THE ORDER A MESSAGE
 * MOVES THROUGH THEM: on its way, then how it ended, then why it did not
 * go. Every status OneUptime writes on the log, and the one it wrote before
 * delivery was tracked (an SMS's and a WhatsApp message's Success); none it
 * never writes - a Telegram message is never Read, nor a WhatsApp message
 * Not Verified. Each in its pill's word: a key, looked up in the menu and
 * the chip alike (FilterOptionLabelsGuard reads them here). Each is a
 * Dropdown's option to the Dashboard (NotificationLogStatus there).
 *
 * The filter had no choices at all on six of the eight logs: a Dropdown
 * filter that is handed none draws nothing.
 */
export interface NotificationLogStatusFilterOption {
  value: string;
  label: string;
}

export const NOTIFICATION_LOG_STATUS_FILTER_OPTIONS: Readonly<
  Record<NotificationLogKind, Array<NotificationLogStatusFilterOption>>
> = {
  [NotificationLogKind.Email]: [
    { value: MailStatus.Success, label: SUCCESS },
    { value: MailStatus.Error, label: ERROR },
  ],
  [NotificationLogKind.SMS]: [
    { value: SmsStatus.Sending, label: SENDING },
    { value: SmsStatus.Sent, label: SENT },
    { value: SmsStatus.Delivered, label: DELIVERED },
    { value: SmsStatus.Undelivered, label: UNDELIVERED },
    { value: SmsStatus.Failed, label: FAILED },
    { value: SmsStatus.Error, label: ERROR },
    { value: SmsStatus.LowBalance, label: LOW_BALANCE },
    { value: SmsStatus.Success, label: SUCCESS },
  ],
  [NotificationLogKind.Call]: [
    { value: CallStatus.Calling, label: CALLING },
    { value: CallStatus.Success, label: SUCCESS },
    { value: CallStatus.MissedCall, label: MISSED_CALL },
    { value: CallStatus.Busy, label: BUSY },
    { value: CallStatus.Voicemail, label: VOICEMAIL },
    { value: CallStatus.Error, label: ERROR },
    { value: CallStatus.LowBalance, label: LOW_BALANCE },
  ],
  [NotificationLogKind.Push]: [
    { value: PushStatus.Success, label: SUCCESS },
    { value: PushStatus.Error, label: ERROR },
  ],
  [NotificationLogKind.WhatsApp]: [
    { value: WhatsAppStatus.Queued, label: QUEUED },
    { value: WhatsAppStatus.Sent, label: SENT },
    { value: WhatsAppStatus.Delivered, label: DELIVERED },
    { value: WhatsAppStatus.Read, label: READ },
    { value: WhatsAppStatus.Warning, label: WARNING },
    { value: WhatsAppStatus.Failed, label: FAILED },
    { value: WhatsAppStatus.Error, label: ERROR },
    { value: WhatsAppStatus.LowBalance, label: LOW_BALANCE },
    { value: WhatsAppStatus.Deleted, label: DELETED },
    { value: WhatsAppStatus.Unknown, label: UNKNOWN },
    { value: WhatsAppStatus.Success, label: SUCCESS },
  ],
  [NotificationLogKind.Telegram]: [
    { value: TelegramStatus.Sent, label: SENT },
    { value: TelegramStatus.Error, label: ERROR },
    { value: TelegramStatus.LowBalance, label: LOW_BALANCE },
  ],
  [NotificationLogKind.Webhook]: [
    { value: WebhookStatus.Success, label: SUCCESS },
    { value: WebhookStatus.Error, label: ERROR },
  ],
  [NotificationLogKind.Workspace]: [
    { value: WorkspaceNotificationStatus.Success, label: SUCCESS },
    { value: WorkspaceNotificationStatus.Error, label: ERROR },
  ],
};

// The statuses each log's filter offers, in its order.
function getFilterStatuses(): Record<
  NotificationLogKind,
  ReadonlyArray<string>
> {
  const statuses: Partial<Record<NotificationLogKind, ReadonlyArray<string>>> =
    {};

  for (const kind of Object.values(NotificationLogKind)) {
    statuses[kind] = NOTIFICATION_LOG_STATUS_FILTER_OPTIONS[kind].map(
      (option: NotificationLogStatusFilterOption): string => {
        return option.value;
      },
    );
  }

  return statuses as Record<NotificationLogKind, ReadonlyArray<string>>;
}

export const NOTIFICATION_LOG_FILTER_STATUSES: Readonly<
  Record<NotificationLogKind, ReadonlyArray<string>>
> = getFilterStatuses();
