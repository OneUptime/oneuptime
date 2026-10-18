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
