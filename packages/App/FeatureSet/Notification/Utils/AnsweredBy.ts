import { CallOutcome } from "./CallOutcome";
import CallStatus from "Common/Types/Call/CallStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { NotificationDeliveryStatus } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import {
  CALL_FAX_MESSAGE,
  CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
  CALL_VOICEMAIL_NO_MESSAGE_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";

/*
 * WHO ANSWERED AN ON-CALL CALL, AS TWILIO'S ANSWERING MACHINE DETECTION
 * TELLS IT (#6594).
 *
 * To Twilio, a call that voicemail picks up is answered - "completed" - like
 * one a person picks up. Most carriers send a call nobody picks up to
 * voicemail after 20 to 30 seconds, well before Twilio's 60 second ring
 * timeout, and many send a declined call there too. So for a responder with
 * voicemail, "did not pick up" ended as answered: the feed said nothing, and
 * the call's log said it was answered and lasted 35 seconds.
 *
 * So an on-call call asks Twilio, while it plays, who answered it
 * (CallService: MachineDetection DetectMessageEnd, asynchronously, so a
 * person who picks up hears the page at once), and Twilio posts the answer
 * to the call's answering machine callback (API/Call.ts) as AnsweredBy:
 * https://www.twilio.com/docs/voice/answering-machine-detection
 *
 *   - human, unknown: a person, or Twilio could not tell. The call is left as
 *     its status callback says it ended: answered, unless it was not.
 *   - machine_end_beep, machine_end_silence, machine_end_other: a voicemail,
 *     whose greeting has just ended - at its beep, in silence, or otherwise.
 *     A message left now is recorded, so the call is turned to one
 *     (getVoicemailMessage) - and the call counts as not answered.
 *   - machine_start: a voicemail, at the start of its greeting. Only
 *     MachineDetection Enable answers this, which OneUptime does not ask
 *     for; read as voicemail all the same, with no message left over its
 *     greeting.
 *   - fax: a fax machine. Not answered, and nothing is left.
 */

/*
 * What an on-call call asks Twilio for: a voicemail reported at the end of
 * its greeting, where a message left is the one it records - and a person
 * as soon as Twilio can tell.
 */
export const VOICEMAIL_MACHINE_DETECTION: string = "DetectMessageEnd";

/*
 * Where a call's log keeps the message to leave on voicemail
 * (CallLog.callData), next to the words the call says: written as the call
 * is placed, read by the answering machine callback.
 */
export const VOICEMAIL_MESSAGE_CALL_DATA_KEY: string = "voicemailMessage";

export enum TwilioAnsweredBy {
  Human = "human",
  Unknown = "unknown",
  MachineStart = "machine_start",
  MachineEndBeep = "machine_end_beep",
  MachineEndSilence = "machine_end_silence",
  MachineEndOther = "machine_end_other",
  Fax = "fax",
}

// What answered the call, when it was not a person.
export enum MachineAnswered {
  Voicemail = "voicemail",
  Fax = "fax",
}

export interface AnsweredByOutcome {
  answered: MachineAnswered;
  /*
   * Whether the voicemail's greeting is over, so a message played now is
   * the one it records: the end of the greeting, as DetectMessageEnd
   * reports it.
   */
  canLeaveMessage: boolean;
}

/*
 * What Twilio's AnsweredBy means for the call - or null for a person, for
 * Twilio not being able to tell, and for anything that is not one of its
 * values: the call is then left as its status callback says it ended.
 */
export function getAnsweredByOutcome(
  answeredBy: unknown,
): AnsweredByOutcome | null {
  const value: string =
    typeof answeredBy === "string" ? answeredBy.trim().toLowerCase() : "";

  switch (value) {
    case TwilioAnsweredBy.MachineEndBeep:
    case TwilioAnsweredBy.MachineEndSilence:
    case TwilioAnsweredBy.MachineEndOther:
      return { answered: MachineAnswered.Voicemail, canLeaveMessage: true };
    case TwilioAnsweredBy.MachineStart:
      return { answered: MachineAnswered.Voicemail, canLeaveMessage: false };
    case TwilioAnsweredBy.Fax:
      return { answered: MachineAnswered.Fax, canLeaveMessage: false };
    default:
      return null;
  }
}

/*
 * How a call a machine answered ended, for its log and for the on-call
 * notification it was made for: Voicemail - or a missed call, for a fax
 * machine - and Not Answered, whose own hooks tell the record's feed "Nitin
 * did not answer the phone call ... It went to voicemail, and a message was
 * left." Counted as not answered in the platform's delivery metrics. The
 * sentences are written from OnCallSentLine, where the on-call logs read
 * them back to word them in the reader's language.
 */
export function getMachineAnsweredCallOutcome(data: {
  outcome: AnsweredByOutcome;
  isMessageLeft: boolean;
}): CallOutcome {
  if (data.outcome.answered === MachineAnswered.Fax) {
    return {
      callStatus: CallStatus.MissedCall,
      notificationStatus: UserNotificationStatus.NotAnswered,
      sentence: CALL_FAX_MESSAGE,
      deliveryStatus: NotificationDeliveryStatus.NotAnswered,
      durationInSeconds: null,
    };
  }

  return {
    callStatus: CallStatus.Voicemail,
    notificationStatus: UserNotificationStatus.NotAnswered,
    sentence: data.isMessageLeft
      ? CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE
      : CALL_VOICEMAIL_NO_MESSAGE_MESSAGE,
    deliveryStatus: NotificationDeliveryStatus.NotAnswered,
    durationInSeconds: null,
  };
}

/*
 * The last sentence of the message left on voicemail, after what the call
 * said: what to do, for whoever listens to it later. "One Uptime", as every
 * call says it, so text to speech says the name right; an installation
 * that goes by its own name says that instead (ProductBrandingText).
 */
export const VOICEMAIL_MESSAGE_CLOSING: string =
  "Open One Uptime to respond. Good bye.";

/*
 * What is left on voicemail when the call's own words were not kept - a
 * call whose words are not logged - or are gone: who called, and what to
 * do.
 */
export const VOICEMAIL_MESSAGE_WITHOUT_WORDS: string = `This is a call from One Uptime about an on-call page. ${VOICEMAIL_MESSAGE_CLOSING}`;

/*
 * The message left on voicemail: what the call said - its sentences, never
 * the keypad prompt, as a gateway is told them - and what to do. Without
 * the call's words, who called and what to do.
 */
export function getVoicemailMessage(callWords: string | null): string {
  const words: string = (callWords || "").trim();

  return words
    ? `${words} ${VOICEMAIL_MESSAGE_CLOSING}`
    : VOICEMAIL_MESSAGE_WITHOUT_WORDS;
}
