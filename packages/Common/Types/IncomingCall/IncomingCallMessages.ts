/*
 * What a caller hears from an incoming call policy when it has no message of
 * its own for the moment: the call handler (Notification/API/IncomingCall)
 * reads these out, and the policy's Settings page shows them in place of a
 * message that was emptied, so it says what callers really hear.
 *
 * A new policy is stored with messages of its own (the columns' defaults,
 * IncomingCallPolicy): these are read only for one whose message was cleared.
 * They are read out by Twilio's text-to-speech voice, in English.
 */

// Before the first person is rung.
export const DEFAULT_INCOMING_CALL_GREETING_MESSAGE: string =
  "Please wait while we connect you to the on-call engineer.";

// When every rule rang and nobody answered.
export const DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE: string =
  "No one is available. Please try again later.";

// When no rule has anybody to ring.
export const DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE: string =
  "We're sorry, but no on-call engineer is currently available.";

// When the policy does not answer calls (it is turned off).
export const INCOMING_CALL_POLICY_OFF_MESSAGE: string =
  "Sorry, this service is currently disabled.";
