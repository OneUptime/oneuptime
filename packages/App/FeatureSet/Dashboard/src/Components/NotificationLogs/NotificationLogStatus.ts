import CallStatus from "Common/Types/Call/CallStatus";
import { isSentToCallAndSmsGatewayMessage } from "Common/Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "Common/Types/Mail/MailStatus";
import { WhoWasToldLogKind } from "Common/Types/Notification/WhoWasTold";
import {
  CallOutcomeLine,
  readCallOutcomeMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import SmsStatus from "Common/Types/SmsStatus";
import TelegramStatus from "Common/Types/TelegramStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT EVERY STATUS OF EVERY NOTIFICATION LOG MEANS, AND THE COLOUR IT IS
 * DRAWN IN (#11138).
 *
 * "What are the statuses in SMS Logs, and is Sent or Delivered the last one
 * on the happy path?" The logs never said. Each table coloured its pills its
 * own way - an SMS still waiting for its carrier's receipt read a green Sent,
 * a Telegram message that failed a yellow one, a project out of balance red
 * in one log, orange in another and grey in a third - and none said what a
 * status meant. So every status of the eight logs (email, SMS, WhatsApp,
 * Telegram, webhook, call, push, workspace) is placed here once, by what it
 * means for the message, and each log draws it from here
 * (NotificationLogStatusPill): its colour, and a sentence or two that say
 * what happened and what comes next, on hover, tap or focus.
 *
 * The colour says where the message is, in the steps the on-call test page
 * and Who Was Told already draw (OnCallTestPageWords, WhoWasToldWords):
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
 * (CallAndSmsGatewayLine). Each pill says which.
 *
 * Every word here is a key, looked up where it is drawn: the status as the
 * log stores it (a WhatsApp message's Read with a key of its own, as the
 * bare Read is the verb), and each sentence on its own, run together the way
 * the reader's script writes a paragraph (joinSentences). A sentence several
 * statuses say ("View Status Message says why.") is worded once.
 */

// The eight notification logs, as Who Was Told reads them.
export { WhoWasToldLogKind as NotificationLogKind };

// Where a message stands: the colour its status is drawn in.
export enum NotificationLogStatusMeaning {
  // Handed over; nothing has come back yet.
  HandedOver = "HandedOver",
  // The provider took it, and is still to say how it ended.
  OnItsWay = "OnItsWay",
  // It reached them, or this is its last status.
  Done = "Done",
  // It reached the phone and nobody answered, or it went with a warning.
  NeedsALook = "NeedsALook",
  // It did not reach them.
  NotSent = "NotSent",
  // A status OneUptime cannot place.
  Unknown = "Unknown",
}

export const NOTIFICATION_LOG_STATUS_TONES: Readonly<
  Record<NotificationLogStatusMeaning, PillTone>
> = {
  [NotificationLogStatusMeaning.HandedOver]: PillTone.Neutral,
  [NotificationLogStatusMeaning.OnItsWay]: PillTone.Info,
  [NotificationLogStatusMeaning.Done]: PillTone.Success,
  [NotificationLogStatusMeaning.NeedsALook]: PillTone.Warning,
  [NotificationLogStatusMeaning.NotSent]: PillTone.Danger,
  [NotificationLogStatusMeaning.Unknown]: PillTone.Neutral,
};

export interface NotificationLogStatusWords {
  /*
   * The status as the log draws it: a key, looked up where it is drawn -
   * or, for a value OneUptime does not know, the stored value as written.
   */
  text: string;
  isTextAsWritten?: boolean | undefined;
  meaning: NotificationLogStatusMeaning;
  // What it means, a whole sentence at a time, each a key.
  explanation: ReadonlyArray<string>;
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

// What every log says of a project out of balance: it was not sent, and who can add some.
function getLowBalanceWords(): NotificationLogStatusWords {
  return words(
    LOW_BALANCE,
    M.NotSent,
    translationKey(
      "It was not sent: the project's balance was too low to pay for it.",
    ),
    translationKey("View Status Message says who can add balance."),
  );
}

function getSmsStatusWords(
  status: SmsStatus,
  statusMessage: string | null | undefined,
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
      if (isSentToCallAndSmsGatewayMessage(statusMessage)) {
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
        M.Done,
        translationKey("The carrier confirmed the SMS reached the phone."),
        LAST_STATUS,
      );
    case SmsStatus.Undelivered:
      return words(
        UNDELIVERED,
        M.NotSent,
        translationKey(
          "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts.",
        ),
        ERROR_CODE_SAYS_WHY,
      );
    case SmsStatus.Failed:
      return words(
        FAILED,
        M.NotSent,
        translationKey("Twilio could not send the SMS."),
        ERROR_CODE_SAYS_WHY,
      );
    case SmsStatus.Error:
      return words(
        ERROR,
        M.NotSent,
        translationKey("The SMS was not sent."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
  statusMessage: string | null | undefined,
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
      if (
        readCallOutcomeMessage(statusMessage)?.outcome ===
        CallOutcomeLine.Answered
      ) {
        return words(
          SUCCESS,
          M.Done,
          translationKey("The call was answered."),
          translationKey("View Status Message says how long it lasted."),
        );
      }

      if (isSentToCallAndSmsGatewayMessage(statusMessage)) {
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
      return words(
        VOICEMAIL,
        M.NeedsALook,
        translationKey("Voicemail answered the call."),
        translationKey("View Status Message says whether a message was left."),
      );
    case CallStatus.Error:
      return words(
        ERROR,
        M.NotSent,
        translationKey("The call could not be made or connected."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
        M.Done,
        translationKey("The message reached the phone."),
        translationKey(
          "It moves to Read once it is opened, if the person shares read receipts.",
        ),
      );
    case WhatsAppStatus.Read:
      return words(
        READ,
        M.Done,
        translationKey("The message was opened."),
        LAST_STATUS,
      );
    case WhatsAppStatus.Warning:
      return words(
        WARNING,
        M.NeedsALook,
        translationKey("WhatsApp sent the message with a warning."),
        translationKey("View Status Message says what WhatsApp reported."),
      );
    case WhatsAppStatus.Failed:
      return words(
        FAILED,
        M.NotSent,
        translationKey("WhatsApp could not deliver the message."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
      );
    case WhatsAppStatus.Error:
      return words(
        ERROR,
        M.NotSent,
        MESSAGE_NOT_SENT,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
      return words(
        UNKNOWN,
        M.Unknown,
        translationKey("WhatsApp reported a status OneUptime does not know."),
        VIEW_STATUS_MESSAGE_SHOWS_IT,
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
        M.Done,
        translationKey("The message reached the chat."),
      );
    case TelegramStatus.Read:
      return words(READ, M.Done, translationKey("The message was read."));
    case TelegramStatus.Failed:
      return words(
        FAILED,
        M.NotSent,
        translationKey("Telegram could not deliver the message."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
      );
    case TelegramStatus.Error:
      return words(
        ERROR,
        M.NotSent,
        MESSAGE_NOT_SENT,
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
      return words(
        UNKNOWN,
        M.Unknown,
        translationKey("Telegram reported a status OneUptime does not know."),
        VIEW_STATUS_MESSAGE_SHOWS_IT,
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
      return words(
        ERROR,
        M.NotSent,
        translationKey("The email was not sent."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
      return words(
        ERROR,
        M.NotSent,
        translationKey("The push notification was not delivered."),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
      );
  }
}

function getWebhookStatusWords(
  status: WebhookStatus,
): NotificationLogStatusWords {
  switch (status) {
    case WebhookStatus.Success:
      return words(
        SUCCESS,
        M.Done,
        translationKey("The webhook's address accepted the request."),
        translationKey("HTTP Status shows its answer."),
      );
    case WebhookStatus.Error:
      return words(
        ERROR,
        M.NotSent,
        translationKey(
          "The webhook's address refused the request, or could not be reached.",
        ),
        VIEW_STATUS_MESSAGE_SAYS_WHY,
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
      return words(
        ERROR,
        M.NotSent,
        translationKey("The action did not go through."),
        translationKey("Reason says why."),
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
    explanation: [
      translationKey("OneUptime does not know this status."),
      VIEW_STATUS_MESSAGE_SHOWS_IT,
    ],
  };
}

/*
 * What a log's status means, for its pill: its word, its colour and what
 * to say of it. Some statuses read by the log's message too: an SMS the
 * gateway took is Sent for good, and a call's Success says whether it was
 * answered. Null for a log with no status.
 */
export function getNotificationLogStatusWords(data: {
  kind: WhoWasToldLogKind;
  status: string | null | undefined;
  statusMessage?: string | null | undefined;
}): NotificationLogStatusWords | null {
  const status: string | null | undefined = data.status;

  if (!status) {
    return null;
  }

  switch (data.kind) {
    case WhoWasToldLogKind.SMS:
      return isValueOf(SmsStatus, status)
        ? getSmsStatusWords(status, data.statusMessage)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Call:
      return isValueOf(CallStatus, status)
        ? getCallStatusWords(status, data.statusMessage)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.WhatsApp:
      return isValueOf(WhatsAppStatus, status)
        ? getWhatsAppStatusWords(status)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Telegram:
      return isValueOf(TelegramStatus, status)
        ? getTelegramStatusWords(status)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Email:
      return isValueOf(MailStatus, status)
        ? getEmailStatusWords(status)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Push:
      return isValueOf(PushStatus, status)
        ? getPushStatusWords(status)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Webhook:
      return isValueOf(WebhookStatus, status)
        ? getWebhookStatusWords(status)
        : getUnknownStatusWords(status);
    case WhoWasToldLogKind.Workspace:
      return isValueOf(WorkspaceNotificationStatus, status)
        ? getWorkspaceStatusWords(status)
        : getUnknownStatusWords(status);
  }
}

/*
 * THE STATUSES EACH LOG'S STATUS FILTER OFFERS, IN THE ORDER A MESSAGE
 * MOVES THROUGH THEM: on its way, then how it ended, then why it did not
 * go. Every status OneUptime writes on the log, and the one it wrote before
 * delivery was tracked (an SMS's and a WhatsApp message's Success); none it
 * never writes - a Telegram message is never Read, nor a WhatsApp message
 * Not Verified.
 * The filter had no choices at all on six of the eight logs: a Dropdown
 * filter that is handed none draws nothing.
 */
export const NOTIFICATION_LOG_FILTER_STATUSES: Readonly<
  Record<WhoWasToldLogKind, ReadonlyArray<string>>
> = {
  [WhoWasToldLogKind.Email]: [MailStatus.Success, MailStatus.Error],
  [WhoWasToldLogKind.SMS]: [
    SmsStatus.Sending,
    SmsStatus.Sent,
    SmsStatus.Delivered,
    SmsStatus.Undelivered,
    SmsStatus.Failed,
    SmsStatus.Error,
    SmsStatus.LowBalance,
    SmsStatus.Success,
  ],
  [WhoWasToldLogKind.Call]: [
    CallStatus.Calling,
    CallStatus.Success,
    CallStatus.MissedCall,
    CallStatus.Busy,
    CallStatus.Voicemail,
    CallStatus.Error,
    CallStatus.LowBalance,
  ],
  [WhoWasToldLogKind.Push]: [PushStatus.Success, PushStatus.Error],
  [WhoWasToldLogKind.WhatsApp]: [
    WhatsAppStatus.Queued,
    WhatsAppStatus.Sent,
    WhatsAppStatus.Delivered,
    WhatsAppStatus.Read,
    WhatsAppStatus.Warning,
    WhatsAppStatus.Failed,
    WhatsAppStatus.Error,
    WhatsAppStatus.LowBalance,
    WhatsAppStatus.Deleted,
    WhatsAppStatus.Unknown,
    WhatsAppStatus.Success,
  ],
  [WhoWasToldLogKind.Telegram]: [
    TelegramStatus.Sent,
    TelegramStatus.Error,
    TelegramStatus.LowBalance,
  ],
  [WhoWasToldLogKind.Webhook]: [WebhookStatus.Success, WebhookStatus.Error],
  [WhoWasToldLogKind.Workspace]: [
    WorkspaceNotificationStatus.Success,
    WorkspaceNotificationStatus.Error,
  ],
};

/*
 * A log's Status filter: each status it can hold, named as its pill names
 * it - a key, looked up in the menu and the chip alike.
 */
export function getNotificationLogStatusFilterOptions(
  kind: WhoWasToldLogKind,
): Array<DropdownOption> {
  return NOTIFICATION_LOG_FILTER_STATUSES[kind].map(
    (status: string): DropdownOption => {
      return {
        value: status,
        label:
          getNotificationLogStatusWords({ kind: kind, status: status })?.text ||
          status,
      };
    },
  );
}
