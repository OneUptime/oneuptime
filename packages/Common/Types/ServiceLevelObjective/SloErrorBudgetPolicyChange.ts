/*
 * WHAT AN EVALUATION DID TO AN SLO'S ERROR BUDGET POLICY.
 *
 * The evaluation worker moves an SLO between the tiers of its error budget
 * policy and answers its deploy gate from the tier it is in
 * (Utils/Slo/SloErrorBudgetPolicy). Each change it commits is one of these,
 * or two at once - a tier change that also froze deployments, or allowed
 * them again:
 *
 *   - the SLO entered a tier, from none or from a less severe one;
 *   - it recovered to a less severe tier;
 *   - it left every tier, its budget above them all again;
 *   - its deployments were frozen;
 *   - its deployments were allowed again.
 *
 * The SLO's feed says each in its own words (SloFeedMarkdown). The Slack,
 * Microsoft Teams and Mattermost rules for SLOs pick which of them they post
 * with their Error Budget Policy Change condition
 * (NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange); a rule
 * without one posts them all.
 *
 * The values are what a rule's condition stores and what its dropdown
 * shows, so they never change. A rule matches them with Contains Any, which
 * finds one value inside another (WorkspaceNotificationRuleUtil), so none of
 * them is a part of another.
 */
enum SloErrorBudgetPolicyChange {
  EnteredMoreSevereTier = "Entered a more severe tier",
  RecoveredToLessSevereTier = "Recovered to a less severe tier",
  LeftEveryTier = "Left every tier",
  DeploymentsFrozen = "Deployments frozen",
  DeploymentsAllowed = "Deployments allowed again",
}

// Every change, in the order a rule's dropdown lists them.
export const SLO_ERROR_BUDGET_POLICY_CHANGES: ReadonlyArray<SloErrorBudgetPolicyChange> =
  [
    SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
    SloErrorBudgetPolicyChange.RecoveredToLessSevereTier,
    SloErrorBudgetPolicyChange.LeftEveryTier,
    SloErrorBudgetPolicyChange.DeploymentsFrozen,
    SloErrorBudgetPolicyChange.DeploymentsAllowed,
  ];

export function isSloErrorBudgetPolicyChange(
  value: unknown,
): value is SloErrorBudgetPolicyChange {
  return (
    typeof value === "string" &&
    (SLO_ERROR_BUDGET_POLICY_CHANGES as ReadonlyArray<string>).includes(value)
  );
}

export default SloErrorBudgetPolicyChange;
