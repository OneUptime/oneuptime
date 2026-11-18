import SloStatus from "./SloStatus";

/*
 * WHAT A CHANNEL IS TOLD OF AN SLO'S STATUS (#6596).
 *
 * The Slack, Microsoft Teams and Mattermost rules for SLOs post the changes
 * of an SLO's error budget policy (SloErrorBudgetPolicyChange), and, when a
 * rule picks them with its SLO Status Change condition
 * (NotificationRuleConditionCheckOn.SloStatusChange), the changes of its
 * status, one of these:
 *
 *   - it became At Risk: less of its budget is left than its at-risk
 *     threshold, from Healthy, from Budget Exhausted as the budget comes
 *     back, or when it is first measured so;
 *   - its budget is exhausted: it became Budget Exhausted;
 *   - it is healthy again: Healthy after At Risk or Budget Exhausted.
 *
 * A move into a status that measures nothing (Waiting, Misconfigured,
 * Paused) is none of them, and neither is Healthy after one: the SLO was
 * not measured, so nothing about its reliability changed. Its owners are not
 * told of those either.
 *
 * The values are what a rule's condition stores and what its dropdown
 * shows, so they never change. A rule matches them with Contains Any, which
 * finds one value inside another (WorkspaceNotificationRuleUtil), so none of
 * them is a part of another.
 */
enum SloStatusChange {
  BecameAtRisk = "Became At Risk",
  BudgetExhausted = "Budget exhausted",
  HealthyAgain = "Healthy again",
}

// Every change, in the order a rule's dropdown lists them.
export const SLO_STATUS_CHANGES: ReadonlyArray<SloStatusChange> = [
  SloStatusChange.BecameAtRisk,
  SloStatusChange.BudgetExhausted,
  SloStatusChange.HealthyAgain,
];

export function isSloStatusChange(value: unknown): value is SloStatusChange {
  return (
    typeof value === "string" &&
    (SLO_STATUS_CHANGES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * What a channel is told when an SLO's status goes from `from` (unset for an
 * SLO never evaluated) to `to`, or null when it is told nothing.
 */
export function getSloStatusChange(
  from: SloStatus | null | undefined,
  to: SloStatus,
): SloStatusChange | null {
  if (from === to) {
    return null;
  }

  if (to === SloStatus.AtRisk) {
    return SloStatusChange.BecameAtRisk;
  }

  if (to === SloStatus.BudgetExhausted) {
    return SloStatusChange.BudgetExhausted;
  }

  if (
    to === SloStatus.Healthy &&
    (from === SloStatus.AtRisk || from === SloStatus.BudgetExhausted)
  ) {
    return SloStatusChange.HealthyAgain;
  }

  return null;
}

export default SloStatusChange;
