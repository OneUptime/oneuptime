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

/*
 * A POLICY THAT SAYS IT REPEATS MUST REPEAT AT LEAST ONCE.
 *
 * "Repeat if no one acknowledges" on with "Number of times to repeat" at 0
 * (or below it, or not a whole number) says the policy starts again and
 * never does: the run reads 0 repeats (above), and every screen reads the
 * pair as "Stop paging". The Dashboard's Repeat Policy card cannot make it -
 * its "How many more times?" box takes a whole number of 1 or more - and the
 * server holds the API, Terraform, MCP and workflows to the same
 * (OnCallDutyPolicyService, through Server/Utils/Database/ColumnRuleCheck).
 * A policy stored that way before keeps running as it did, once, and an edit
 * that leaves the pair as it is still saves.
 *
 * A number not given is the column's default, 0: a create that turns the
 * switch on must say how many times.
 */
export const ON_CALL_POLICY_REPEAT_COLUMNS: ReadonlyArray<string> = [
  "repeatPolicyIfNoOneAcknowledges",
  "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
];

export const ON_CALL_POLICY_REPEAT_TIMES_REFUSAL: string =
  "An on-call policy that repeats must start again at least once: set Repeat Policy Times If No One Acknowledges to a whole number of 1 or more, or turn off Repeat Policy If No One Acknowledges.";

/*
 * Whether a count, as a write sends it, is a whole number of at least 1. A
 * number or its digits; anything else - nothing, an empty box, a part of a
 * number, 0 or below - is not.
 */
export function isRepeatCountOfAtLeastOne(value: unknown): boolean {
  if (typeof value !== "number" && typeof value !== "string") {
    return false;
  }

  if (typeof value === "string" && !value.trim()) {
    return false;
  }

  const times: number = Number(value);

  return Number.isFinite(times) && Number.isInteger(times) && times >= 1;
}

/*
 * The refusal for a pair that says it repeats and never does, or null: the
 * switch off (the number then means nothing), or on with 1 or more.
 */
export function getOnCallPolicyRepeatRefusal(policy: {
  repeatPolicyIfNoOneAcknowledges?: unknown;
  repeatPolicyIfNoOneAcknowledgesNoOfTimes?: unknown;
}): string | null {
  if (policy.repeatPolicyIfNoOneAcknowledges !== true) {
    return null;
  }

  return isRepeatCountOfAtLeastOne(
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes,
  )
    ? null
    : ON_CALL_POLICY_REPEAT_TIMES_REFUSAL;
}
