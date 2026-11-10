import CallStatus from "Common/Types/Call/CallStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

/*
 * HOW A CALL ENDED, AS TWILIO TELLS IT.
 *
 * A call is placed the moment Twilio accepts it (CallService), long before
 * anybody picks up. When it ends, Twilio calls the call's status callback
 * (API/Call.ts) with its final CallStatus: completed (it was answered, and
 * has ended), no-answer (it rang out), busy (the line was busy - which is
 * also what many phones answer when the call is declined), failed (it could
 * not be connected) or canceled (OneUptime never cancels a call). This
 * says what each means for the call's log and for the on-call notification
 * it was made for.
 *
 * "Answered" is Twilio's word: a call voicemail picked up is answered too.
 * So an answered call is said in the logs only, and the record's feed tells
 * of the calls that were not (UserNotificationStatus.NotAnswered): "Nitin
 * did not answer the phone call".
 */

export enum TwilioCallStatus {
  Completed = "completed",
  NoAnswer = "no-answer",
  Busy = "busy",
  Failed = "failed",
  Canceled = "canceled",
}

export interface CallOutcome {
  // What the call log's status becomes. Null keeps it: an answered call stays Success.
  callStatus: CallStatus | null;
  /*
   * What the on-call notification the call was made for becomes, while it
   * is only sent. Null keeps its status: an answered call is still a sent
   * notification until the person presses 1.
   */
  notificationStatus: UserNotificationStatus | null;
  // How the call ended, in a sentence the logs show. Never the number called.
  sentence: string;
}

// "42 seconds", "1 second": how long an answered call lasted.
function getDurationText(durationInSeconds: number): string {
  return durationInSeconds === 1 ? "1 second" : `${durationInSeconds} seconds`;
}

/*
 * What a call's final status means - or null for a status that is not how
 * a call ended (queued, ringing, in-progress), or one OneUptime does not
 * act on (canceled). `durationInSeconds` is Twilio's CallDuration, said of
 * an answered call when it is a whole number of seconds.
 */
export function getCallOutcome(data: {
  providerStatus: unknown;
  durationInSeconds?: unknown;
}): CallOutcome | null {
  const providerStatus: string =
    typeof data.providerStatus === "string"
      ? data.providerStatus.trim().toLowerCase()
      : "";

  switch (providerStatus) {
    case TwilioCallStatus.Completed: {
      // Text, as Twilio posts it, or a number; anything else is no duration.
      const durationText: string =
        typeof data.durationInSeconds === "number"
          ? String(data.durationInSeconds)
          : typeof data.durationInSeconds === "string"
            ? data.durationInSeconds.trim()
            : "";
      const duration: number = Number(durationText);
      const hasDuration: boolean =
        durationText !== "" && Number.isInteger(duration) && duration >= 0;

      return {
        callStatus: null,
        notificationStatus: null,
        sentence: hasDuration
          ? `The call was answered and lasted ${getDurationText(duration)}.`
          : "The call was answered.",
      };
    }
    case TwilioCallStatus.NoAnswer:
      return {
        callStatus: CallStatus.MissedCall,
        notificationStatus: UserNotificationStatus.NotAnswered,
        sentence: "The call was not answered: it rang out.",
      };
    case TwilioCallStatus.Busy:
      return {
        callStatus: CallStatus.Busy,
        notificationStatus: UserNotificationStatus.NotAnswered,
        sentence:
          "The call was not answered: the line was busy, or the call was declined.",
      };
    case TwilioCallStatus.Failed:
      return {
        callStatus: CallStatus.Error,
        notificationStatus: UserNotificationStatus.Error,
        sentence: "The call could not be connected.",
      };
    default:
      return null;
  }
}

// A Twilio call's id: "CA" and 32 hexadecimal digits.
const TWILIO_CALL_SID: RegExp = new RegExp("^CA[0-9a-fA-F]{32}$");

/*
 * The message a call's log and its notification are left with once it
 * ended: the call's Twilio id, as the log has always shown it, and how it
 * ended. Written whole each time, so a callback Twilio sends twice leaves
 * the same message. An id that is not a Twilio call's is left out.
 */
export function getCallOutcomeStatusMessage(data: {
  callSid: unknown;
  outcome: CallOutcome;
}): string {
  const callSid: string =
    typeof data.callSid === "string" ? data.callSid.trim() : "";

  return TWILIO_CALL_SID.test(callSid)
    ? `Call ID: ${callSid}. ${data.outcome.sentence}`
    : data.outcome.sentence;
}
