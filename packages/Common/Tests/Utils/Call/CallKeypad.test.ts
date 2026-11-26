import {
  CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
  CALL_KEYPAD_FINISH_ON_KEY,
  CALL_PROMPT_REPEATS,
  CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS,
  CALL_WRONG_KEY_ASKS,
  CALL_WRONG_KEY_SENTENCE,
  getKeyAnswer,
  readCallKeypadPrompt,
  readWrongKeyCount,
  shouldAskAgainAfterWrongKey,
} from "../../../Utils/Call/CallKeypad";
import { OnCallInputRequest } from "../../../Types/Call/CallRequest";
import { describe, expect, test } from "@jest/globals";

/*
 * A WRONG KEY ASKS AGAIN, WITHIN THE SAME LIMITS AS NO KEY AT ALL (#10949).
 *
 * The rules the Notification service builds a call's prompt from and the
 * keypad route answers its keys from: how often a call asks, what it says
 * to a wrong key, how the route counts the wrong keys it asked again for,
 * and which keys the call answers itself.
 */

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: {
    sayMessage:
      "That key does nothing, so this incident is not acknowledged. Good bye.",
  },
};

describe("how often a call asks for a key", () => {
  test("twice in all while no key is pressed, with a pause before the second time", () => {
    expect(CALL_PROMPT_REPEATS).toBe(1);
    expect(CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS).toBe(5);
  });

  test("a wrong key is asked again as often as the call asks when no key is pressed: twice", () => {
    expect(CALL_WRONG_KEY_ASKS).toBe(CALL_PROMPT_REPEATS + 1);
    expect(CALL_WRONG_KEY_ASKS).toBe(2);
  });

  test("what the call says to a wrong key before it asks again", () => {
    expect(CALL_WRONG_KEY_SENTENCE).toBe("That key does nothing.");
  });

  test("no key ends the prompt early, so # and * are keys like any other", () => {
    expect(CALL_KEYPAD_FINISH_ON_KEY).toBe("");
  });

  test("a prompt that says nothing of how long to listen listens Twilio's 5 seconds, as before", () => {
    expect(CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS).toBe(5);
  });
});

describe("the wrong keys a call has been asked again for, as its prompt's address counts them", () => {
  test("none for the call's own prompt, which carries no count", () => {
    for (const value of [undefined, null, ""]) {
      expect(readWrongKeyCount(value)).toBe(0);
    }
  });

  test("the count the route wrote", () => {
    expect(readWrongKeyCount("0")).toBe(0);
    expect(readWrongKeyCount("1")).toBe(1);
    expect(readWrongKeyCount("2")).toBe(2);
    expect(readWrongKeyCount(" 1 ")).toBe(1);
    expect(readWrongKeyCount(1)).toBe(1);
  });

  test("never more than every ask: a count beyond them is every ask spent", () => {
    expect(readWrongKeyCount("3")).toBe(CALL_WRONG_KEY_ASKS);
    expect(readWrongKeyCount("999")).toBe(CALL_WRONG_KEY_ASKS);
  });

  test("anything the route never writes is read as every ask spent, so a call can never be asked again forever", () => {
    for (const value of [
      "-1",
      "1.5",
      "two",
      "1e3",
      "0x1",
      "1000",
      ["0"],
      { count: 0 },
      Number.NaN,
      -1,
    ]) {
      expect({ value, count: readWrongKeyCount(value) }).toEqual({
        value,
        count: CALL_WRONG_KEY_ASKS,
      });
    }
  });
});

describe("whether a wrong key is asked again", () => {
  test("the first two wrong keys are, the third is not", () => {
    expect(shouldAskAgainAfterWrongKey(0)).toBe(true);
    expect(shouldAskAgainAfterWrongKey(1)).toBe(true);
    expect(shouldAskAgainAfterWrongKey(2)).toBe(false);
    expect(shouldAskAgainAfterWrongKey(3)).toBe(false);
  });

  test("nothing that is not a count asks again", () => {
    for (const count of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldAskAgainAfterWrongKey(count)).toBe(false);
    }
  });

  test("however a call's wrong keys are counted, it asks again at most twice", () => {
    let asked: number = 0;
    let wrongKeys: number = readWrongKeyCount(undefined);

    // A person who keeps pressing 3.
    for (let press: number = 0; press < 20; press++) {
      if (!shouldAskAgainAfterWrongKey(wrongKeys)) {
        break;
      }

      asked++;
      wrongKeys = readWrongKeyCount(String(wrongKeys + 1));
    }

    expect(asked).toBe(CALL_WRONG_KEY_ASKS);
  });
});

describe("what the call says a key answers", () => {
  test("a key the call offered: its answer", () => {
    expect(getKeyAnswer(ANSWERS, "1")).toEqual(ANSWERS["1"]);
  });

  test("a key it did not offer is a wrong key: no answer of its own, not even the fallback", () => {
    for (const key of ["0", "2", "3", "9", "*", "#"]) {
      expect({ key, answer: getKeyAnswer(ANSWERS, key) }).toEqual({
        key,
        answer: null,
      });
    }
  });

  test("only a key of a phone's keypad is looked up: never default, nor what a token carries beside the answers", () => {
    const claims: OnCallInputRequest = {
      ...ANSWERS,
      ask: { sayMessage: "Press 1 to acknowledge, or 2 to escalate." },
      voice: "Polly.Joanna-Neural",
    } as unknown as OnCallInputRequest;

    for (const key of [
      "default",
      "ask",
      "voice",
      "purpose",
      "notification",
      "11",
      "",
      " 1",
      "1#",
    ]) {
      expect({ key, answer: getKeyAnswer(claims, key) }).toEqual({
        key,
        answer: null,
      });
    }
  });

  test("an answer that is not a sentence is no answer", () => {
    const answers: OnCallInputRequest = {
      ...ANSWERS,
      "3": { sayMessage: 42 },
      "4": "Press 4",
      "5": null,
    } as unknown as OnCallInputRequest;

    for (const key of ["3", "4", "5"]) {
      expect(getKeyAnswer(answers, key)).toBeNull();
    }
  });

  test("no answers, or a key that is not text, answers nothing", () => {
    expect(getKeyAnswer(null, "1")).toBeNull();
    expect(getKeyAnswer(undefined, "1")).toBeNull();
    expect(getKeyAnswer(ANSWERS, 1)).toBeNull();
    expect(getKeyAnswer(ANSWERS, ["1"])).toBeNull();
  });
});

describe("a prompt, as a call's token carries it", () => {
  test("is its words, its words for silence and how long it listens", () => {
    expect(
      readCallKeypadPrompt({
        sayMessage: "Press 1 to acknowledge, or 2 to escalate.",
        noInputMessage:
          "You did not press a key, so this incident is not acknowledged. Good bye.",
        timeoutInSeconds: 10,
      }),
    ).toEqual({
      sayMessage: "Press 1 to acknowledge, or 2 to escalate.",
      noInputMessage:
        "You did not press a key, so this incident is not acknowledged. Good bye.",
      timeoutInSeconds: 10,
    });
  });

  test("is none without words to ask with", () => {
    for (const value of [
      undefined,
      null,
      "Press 1",
      ["Press 1"],
      {},
      { sayMessage: "" },
      { sayMessage: "  \n " },
      { sayMessage: 1 },
    ]) {
      expect(readCallKeypadPrompt(value)).toBeNull();
    }
  });

  test("says nothing after silence when it carries no words for it", () => {
    expect(
      readCallKeypadPrompt({ sayMessage: "Press 1.", noInputMessage: 7 }),
    ).toEqual({
      sayMessage: "Press 1.",
      noInputMessage: "",
      timeoutInSeconds: CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
    });
  });

  test("listens for a whole number of seconds, a minute at most", () => {
    expect(
      readCallKeypadPrompt({ sayMessage: "Press 1.", timeoutInSeconds: 600 })
        ?.timeoutInSeconds,
    ).toBe(60);
    expect(
      readCallKeypadPrompt({ sayMessage: "Press 1.", timeoutInSeconds: 1 })
        ?.timeoutInSeconds,
    ).toBe(1);

    for (const timeoutInSeconds of [0, -10, 1.5, "10", null, Number.NaN]) {
      expect(
        readCallKeypadPrompt({
          sayMessage: "Press 1.",
          timeoutInSeconds: timeoutInSeconds,
        })?.timeoutInSeconds,
      ).toBe(CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS);
    }
  });
});
