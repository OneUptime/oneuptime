/*
 * What a matched Auto Remediation Rule does to fix the incident or alert.
 *
 * OneUptimeAI: OneUptime AI fixes it on the Kubernetes clusters and
 * infrastructure the signal is linked to, the way each one's AI agent page
 * allows - the same fix every signal gets when no rule is set up. The
 * default for a new rule.
 *
 * Runbooks: start the rule's runbooks - a fix you already wrote.
 *
 * Whether a person approves first is the rule's execution mode: Suggest
 * (ask before fixing) or FullAuto (fix without asking).
 */
enum AutoRemediationAction {
  OneUptimeAI = "OneUptimeAI",
  Runbooks = "Runbooks",
}

export default AutoRemediationAction;

export function isAutoRemediationAction(
  value: unknown,
): value is AutoRemediationAction {
  return (
    typeof value === "string" &&
    (Object.values(AutoRemediationAction) as Array<string>).includes(value)
  );
}
