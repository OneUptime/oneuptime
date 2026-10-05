/*
 * How long an incoming call rings the person an escalation rule calls before
 * the call moves on to the next rule: the rule's escalateAfterSeconds
 * column, shown as "Ring for (in seconds)".
 *
 * It is the timeout of Twilio's <Dial>. Twilio rings for 30 seconds when it
 * is given none, and takes no more than 600; a rule saved without one rings
 * for 30 too (the column's default). Twilio adds a few seconds of its own to
 * every <Dial>, so a phone rings a little longer than this.
 *
 * Mind voicemail: a phone that sends an unanswered call to voicemail before
 * the time is up has the call answered - by its voicemail - and the call
 * stops there instead of moving on to the next rule.
 *
 * React-free and server-safe: the dashboard's form, the incoming call
 * webhook and their tests all read it.
 */

export const DEFAULT_INCOMING_CALL_RING_SECONDS: number = 30;

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
