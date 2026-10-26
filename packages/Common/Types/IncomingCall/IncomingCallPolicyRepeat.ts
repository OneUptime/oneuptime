import { isRepeatCountOfAtLeastOne } from "../OnCallDutyPolicy/OnCallDutyPolicyRepeat";

/*
 * How many more times an incoming call policy rings its escalation rules
 * from the first one, after the last one rang and nobody answered.
 *
 * A policy stores it in two columns: repeatPolicyIfNoOneAnswers (the switch)
 * and repeatPolicyIfNoOneAnswersTimes (how many times). The call handler
 * (Notification/API/IncomingCall: dial-status) starts the rules again while
 * the call's repeatCount is below this, and the policy's Settings page says
 * the same in words (its "Repeat Policy" card). So both read it here.
 *
 * Unlike an on-call policy's repeats (OnCallDutyPolicyRepeat), a number left
 * at 0, or never set, counts as 1 while the switch is on: the call handler
 * has always read `times || 1`. A negative number never repeats.
 */

export interface IncomingCallPolicyRepeatSettings {
  repeatPolicyIfNoOneAnswers?: boolean | null | undefined;
  repeatPolicyIfNoOneAnswersTimes?: number | null | undefined;
}

/*
 * The number of times the rules start again from the first: 0 while the
 * switch is off, otherwise the number - 1 when it is 0 or not set.
 */
export function getIncomingCallPolicyRepeatsAllowed(
  policy: IncomingCallPolicyRepeatSettings | null | undefined,
): number {
  if (!policy || policy.repeatPolicyIfNoOneAnswers !== true) {
    return 0;
  }

  const times: number = Number(policy.repeatPolicyIfNoOneAnswersTimes);

  if (!Number.isFinite(times) || times === 0) {
    return 1;
  }

  if (times < 0) {
    return 0;
  }

  /*
   * Rounded up, as the handler's `repeatCount < times` reads it: a whole
   * repeatCount is below 2.5 as often as it is below 3. The column holds
   * whole numbers, so this is the number itself.
   */
  return Math.ceil(times);
}

/*
 * A POLICY THAT SAYS IT RINGS AGAIN SAYS HOW MANY TIMES: 1 OR MORE.
 *
 * The call handler reads the switch on with 0 as "ring again once" (above),
 * a quirk kept for the policies stored that way. The Dashboard's Repeat
 * Policy card never makes it - its "How many more times?" box takes a whole
 * number of 1 or more - and the server holds the API, Terraform, MCP and
 * workflows to the same (IncomingCallPolicyService, through
 * Server/Utils/Database/ColumnRuleCheck): 0, a negative number or a part of
 * one is refused while the switch is on. A policy stored that way before
 * keeps ringing as it did, and an edit that leaves the pair as it is still
 * saves.
 *
 * A number not given is the column's default, 1: turning the switch on
 * alone rings again once, as it always did.
 */
export const INCOMING_CALL_POLICY_REPEAT_COLUMNS: ReadonlyArray<string> = [
  "repeatPolicyIfNoOneAnswers",
  "repeatPolicyIfNoOneAnswersTimes",
];

export const INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL: string =
  "An incoming call policy that repeats must ring again at least once: set Repeat Policy Times to a whole number of 1 or more, or turn off Repeat Policy If No One Answers.";

/*
 * The refusal for a pair that says it rings again without a whole number of
 * times of 1 or more, or null: the switch off, on with the number not given,
 * or on with 1 or more.
 */
export function getIncomingCallPolicyRepeatRefusal(policy: {
  repeatPolicyIfNoOneAnswers?: unknown;
  repeatPolicyIfNoOneAnswersTimes?: unknown;
}): string | null {
  if (policy.repeatPolicyIfNoOneAnswers !== true) {
    return null;
  }

  // Not given: the column's default, 1.
  if (policy.repeatPolicyIfNoOneAnswersTimes === undefined) {
    return null;
  }

  return isRepeatCountOfAtLeastOne(policy.repeatPolicyIfNoOneAnswersTimes)
    ? null
    : INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL;
}
