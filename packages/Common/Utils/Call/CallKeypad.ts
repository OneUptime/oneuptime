import { OnCallInputRequest, Say } from "../../Types/Call/CallRequest";

/*
 * HOW A CALL ASKS FOR A KEY, AND HOW OFTEN.
 *
 * An on-call page's call asks for a key inside one <Gather input="dtmf">
 * (Notification service, CallService): a key works at any moment, and while
 * no key is pressed the call says its details and its prompt once more
 * (#10762), then waits, says its no-input words and ends.
 *
 * A wrong key - any key the call did not offer, # and * among them - used
 * to end the call at once with "Invalid input. Good bye", so a person woken
 * at night who pressed 3 by mistake lost the page (#10949). Now the keypad
 * route answers it by saying so and asking again, within the same limits as
 * no key at all: as many times as the call asks when no key is pressed, each
 * time listening as long as the call did, and silence after it ends the call
 * as silence always does. A wrong key once those asks are spent ends the
 * call politely, the page left unacknowledged as before. Keys 1 and 2 answer
 * exactly as they always have.
 *
 * Pure, with no Node, browser or database APIs: the Notification service
 * builds the call and the keypad route answers its keys from the same rules.
 */

/*
 * A call that asks for a key says its details and prompt this many times
 * more while no key is pressed: twice in all, as the issue that asked for it
 * suggested (#10762). A key pressed at any moment answers it, and a call
 * that goes unanswered still ends inside its first minute - a call is
 * billed by the minute.
 */
export const CALL_PROMPT_REPEATS: number = 1;

// The silence before each time it says them again, listening for a key all the while.
export const CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS: number = 5;

/*
 * How many times a wrong key is answered by asking again: as many times as
 * the call asks when no key is pressed (CALL_PROMPT_REPEATS more, twice in
 * all). The wrong key after that ends the call.
 */
export const CALL_WRONG_KEY_ASKS: number = CALL_PROMPT_REPEATS + 1;

// What the call says to a wrong key, before it asks again.
export const CALL_WRONG_KEY_SENTENCE: string = "That key does nothing.";

/*
 * The key that ends a call's prompt early: none. Twilio's default is "#",
 * which ended the prompt with no key at all - the call said its no-input
 * words and hung up, as for a wrong key. With none, # and * are keys like
 * any other, and a wrong one is asked again.
 */
export const CALL_KEYPAD_FINISH_ON_KEY: string = "";

// The longest a prompt said again listens for a key, in seconds.
const MAX_PROMPT_TIMEOUT_IN_SECONDS: number = 60;

// A count of wrong keys, as the address of a prompt said again writes it.
const WRONG_KEY_COUNT: RegExp = /^[0-9]{1,3}$/;

// How long a prompt listens for a key once it has spoken, when it says nothing of it.
export const CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS: number = 5;

/*
 * What a call's prompt says, as the keypad route says it again after a
 * wrong key: the prompt, the words for silence after it, and how long it
 * listens.
 */
export interface CallKeypadPrompt {
  // "Press 1 to acknowledge, or 2 to escalate."
  sayMessage: string;
  // "You did not press a key, so this incident is not acknowledged. Good bye."
  noInputMessage: string;
  timeoutInSeconds: number;
}

/*
 * How many wrong keys the call has been asked again for, as the address of
 * its prompt counts them: none for the call's own prompt. Anything that is
 * not a count the route wrote - it never is, as Twilio signs the address
 * it posts to - is read as every ask spent, so a call can never be asked
 * again forever.
 */
export function readWrongKeyCount(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const text: string = Array.isArray(value) ? "" : String(value).trim();

  if (!WRONG_KEY_COUNT.test(text)) {
    return CALL_WRONG_KEY_ASKS;
  }

  return Math.min(parseInt(text, 10), CALL_WRONG_KEY_ASKS);
}

// A key of a phone's keypad, as Twilio posts it: one digit, "*" or "#".
const KEYPAD_KEY: RegExp = /^[0-9*#]$/;

/*
 * What the call said a key answers, or null for a wrong key: one the call
 * did not offer. Only a key of the keypad is looked up, and only a sentence
 * is an answer - never "default", the answer to every other key, nor
 * anything else a call's token carries beside its answers.
 */
export function getKeyAnswer(
  answers: OnCallInputRequest | null | undefined,
  key: unknown,
): Say | null {
  if (!answers || typeof key !== "string" || !KEYPAD_KEY.test(key)) {
    return null;
  }

  const answer: unknown = (answers as Record<string, unknown>)[key];

  if (
    !answer ||
    typeof answer !== "object" ||
    typeof (answer as Say).sayMessage !== "string"
  ) {
    return null;
  }

  return answer as Say;
}

// Whether a wrong key, after `wrongKeysSoFar` asked again, is asked again too.
export function shouldAskAgainAfterWrongKey(wrongKeysSoFar: number): boolean {
  return (
    Number.isInteger(wrongKeysSoFar) &&
    wrongKeysSoFar >= 0 &&
    wrongKeysSoFar < CALL_WRONG_KEY_ASKS
  );
}

/*
 * A prompt as a token carried it, or null when it is not one: words to say
 * and a number of seconds to listen, within reason. A call placed before
 * this release carried none, and its wrong key ends the call as before.
 */
export function readCallKeypadPrompt(value: unknown): CallKeypadPrompt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const prompt: Record<string, unknown> = value as Record<string, unknown>;
  const sayMessage: unknown = prompt["sayMessage"];
  const noInputMessage: unknown = prompt["noInputMessage"];
  const timeoutInSeconds: unknown = prompt["timeoutInSeconds"];

  if (typeof sayMessage !== "string" || !sayMessage.trim()) {
    return null;
  }

  return {
    sayMessage: sayMessage,
    noInputMessage: typeof noInputMessage === "string" ? noInputMessage : "",
    timeoutInSeconds:
      typeof timeoutInSeconds === "number" &&
      Number.isInteger(timeoutInSeconds) &&
      timeoutInSeconds > 0
        ? Math.min(timeoutInSeconds, MAX_PROMPT_TIMEOUT_IN_SECONDS)
        : CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
  };
}
