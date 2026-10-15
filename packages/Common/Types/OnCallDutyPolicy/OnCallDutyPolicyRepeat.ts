/*
 * How many times an on-call policy starts again from its first escalation
 * rule after its last one, when nobody has acknowledged.
 *
 * A policy's Repeat Policy card asks two things: "Repeat if no one
 * acknowledges" (repeatPolicyIfNoOneAcknowledges) and "Number of times to
 * repeat" (repeatPolicyIfNoOneAcknowledgesNoOfTimes). The card, the
 * escalation summary above the rules, "Policy at a glance" on the policy's
 * Overview, the docs and the Terraform examples all read the switch as the
 * switch: while it is off, the policy runs once. The run itself used to read
 * the number alone, so a policy whose repeats were switched off - the switch
 * turned off, the number left at 3 - still started again three times while
 * every screen said "Repeat disabled".
 *
 * Everything that runs a policy, or tells people about a run, reads the
 * repeats here: the escalation worker (ExecutePendingExecutions) and the
 * Slack and Microsoft Teams message of a run (OnCallPolicyRunMessage).
 */

export interface OnCallDutyPolicyRepeatSettings {
  repeatPolicyIfNoOneAcknowledges?: boolean | null | undefined;
  repeatPolicyIfNoOneAcknowledgesNoOfTimes?: number | null | undefined;
}

/*
 * The number of repeats a run may make: 0 while "Repeat if no one
 * acknowledges" is off, otherwise "Number of times to repeat" - a whole
 * number, never below 0. A run goes through its levels once, then this many
 * more times.
 */
export function getOnCallPolicyRepeatsAllowed(
  policy: OnCallDutyPolicyRepeatSettings | null | undefined,
): number {
  if (!policy || policy.repeatPolicyIfNoOneAcknowledges !== true) {
    return 0;
  }

  const times: number = Number(policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes);

  if (!Number.isFinite(times) || times <= 0) {
    return 0;
  }

  return Math.floor(times);
}
