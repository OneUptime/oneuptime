/*
 * How long an incoming call rings the person an escalation rule calls before
 * the call moves on to the next rule: the rule's escalateAfterSeconds
 * column, shown as "Ring for (in seconds)".
 *
 * It is the timeout of Twilio's <Dial>, which takes no more than 600. Twilio
 * adds a few seconds of its own to every <Dial>, so a phone rings a little
 * longer than this.
 *
 * Mind voicemail: a phone that sends an unanswered call to voicemail before
 * the time is up has the call answered - by its voicemail - and the call
 * stops there instead of moving on to the next rule. So a new rule rings for
 * 20 seconds, to move on before most voicemail picks up: the column's
 * default (what the API and Terraform store when a rule leaves it out) and
 * what the dashboard's form starts with. It used to be 30, Twilio's own
 * default for a <Dial> given no timeout, and many phones go to voicemail
 * sooner. Rules saved then keep the 30 they hold: a default applies when a
 * rule is created, and nothing rewrites a rule's ring time.
 *
 * React-free and server-safe: the model, the dashboard's form, the incoming
 * call webhook and their tests all read it.
 */

export const DEFAULT_INCOMING_CALL_RING_SECONDS: number = 20;

// The shortest ring Twilio's <Dial> takes.
export const MIN_INCOMING_CALL_RING_SECONDS: number = 5;

// The longest ring Twilio's <Dial> takes: ten minutes.
export const MAX_INCOMING_CALL_RING_SECONDS: number = 600;

/*
 * The ring time to hand Twilio for a rule: its own, kept inside what Twilio
 * takes, or the default when it has none. The API stores what it is sent,
 * so a rule written there with 1 or 1000 still rings for a time Twilio
 * accepts, instead of failing the call.
 */
export const getIncomingCallRingSeconds: (
  ringSeconds: number | undefined | null,
) => number = (ringSeconds: number | undefined | null): number => {
  if (
    typeof ringSeconds !== "number" ||
    !Number.isFinite(ringSeconds) ||
    ringSeconds <= 0
  ) {
    return DEFAULT_INCOMING_CALL_RING_SECONDS;
  }

  return Math.min(
    Math.max(Math.round(ringSeconds), MIN_INCOMING_CALL_RING_SECONDS),
    MAX_INCOMING_CALL_RING_SECONDS,
  );
};
