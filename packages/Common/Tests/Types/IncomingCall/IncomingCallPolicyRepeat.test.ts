import { describe, expect, test } from "@jest/globals";
import { getIncomingCallPolicyRepeatsAllowed } from "../../../Types/IncomingCall/IncomingCallPolicyRepeat";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  DEFAULT_INCOMING_CALL_GREETING_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
  INCOMING_CALL_POLICY_OFF_MESSAGE,
} from "../../../Types/IncomingCall/IncomingCallMessages";

/*
 * How many more times an incoming call policy rings its rules from the
 * first, after the last one rang and nobody answered. The call handler
 * (dial-status) used to read the two columns inline -
 * `repeatPolicyIfNoOneAnswers && repeatCount < (times || 1)` - and the
 * policy's Settings page now says the same in words, so both read this one
 * function. These hold it to that expression, case by case.
 */

// The call handler's old expression: whether a call with `repeatCount` repeats.
function handlerWouldRepeat(
  repeat: boolean | null | undefined,
  times: number | null | undefined,
  repeatCount: number,
): boolean {
  return Boolean(repeat && repeatCount < ((times as number) || 1));
}

describe("the repeats an incoming call policy allows", () => {
  test("are none while the switch is off, whatever the number says", () => {
    for (const times of [0, 1, 3, 10, null, undefined]) {
      expect({
        times,
        allowed: getIncomingCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAnswers: false,
          repeatPolicyIfNoOneAnswersTimes: times,
        }),
      }).toEqual({ times, allowed: 0 });
    }
  });

  test("are none for a policy that never set the switch: a new policy ends the call", () => {
    expect(getIncomingCallPolicyRepeatsAllowed({})).toBe(0);
    expect(
      getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers: null,
        repeatPolicyIfNoOneAnswersTimes: 3,
      }),
    ).toBe(0);
    expect(getIncomingCallPolicyRepeatsAllowed(null)).toBe(0);
    expect(getIncomingCallPolicyRepeatsAllowed(undefined)).toBe(0);
  });

  test("are the number while the switch is on", () => {
    for (const times of [1, 2, 3, 7]) {
      expect(
        getIncomingCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAnswers: true,
          repeatPolicyIfNoOneAnswersTimes: times,
        }),
      ).toBe(times);
    }
  });

  test("count a number left at 0, or never set, as once - unlike an on-call policy", () => {
    for (const times of [0, null, undefined]) {
      expect({
        times,
        incoming: getIncomingCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAnswers: true,
          repeatPolicyIfNoOneAnswersTimes: times,
        }),
        onCall: getOnCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAcknowledges: true,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
        }),
      }).toEqual({ times, incoming: 1, onCall: 0 });
    }
  });

  test("never repeat for a negative number", () => {
    expect(
      getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: -2,
      }),
    ).toBe(0);
  });

  test("let a call repeat exactly when the handler's old expression did", () => {
    const switches: Array<boolean | null | undefined> = [
      true,
      false,
      null,
      undefined,
    ];
    const numbers: Array<number | null | undefined> = [
      -3,
      -1,
      0,
      1,
      2,
      3,
      5,
      10,
      null,
      undefined,
    ];
    const mismatches: Array<string> = [];

    for (const repeat of switches) {
      for (const times of numbers) {
        const allowed: number = getIncomingCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAnswers: repeat,
          repeatPolicyIfNoOneAnswersTimes: times,
        });

        for (let repeatCount: number = 0; repeatCount <= 12; repeatCount++) {
          const now: boolean = repeatCount < allowed;
          const before: boolean = handlerWouldRepeat(
            repeat,
            times,
            repeatCount,
          );

          if (now !== before) {
            mismatches.push(
              `${String(repeat)}/${String(times)}/${repeatCount}: ${String(before)} -> ${String(now)}`,
            );
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe("the words a caller hears when a policy has none of its own", () => {
  test("are the call handler's own sentences, unchanged", () => {
    expect(DEFAULT_INCOMING_CALL_GREETING_MESSAGE).toBe(
      "Please wait while we connect you to the on-call engineer.",
    );
    expect(DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE).toBe(
      "No one is available. Please try again later.",
    );
    expect(DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE).toBe(
      "We're sorry, but no on-call engineer is currently available.",
    );
    expect(INCOMING_CALL_POLICY_OFF_MESSAGE).toBe(
      "Sorry, this service is currently disabled.",
    );
  });
});
