/**
 * Whether a burn rate rule currently has an alert open.
 *
 * `lastAlertCreatedAt` / `lastAlertResolvedAt` are stamped by the
 * evaluation worker every time it fires or resolves a rule's alert, and
 * together they are the only record of the rule's lifecycle — but nothing
 * read them outside the worker, so the Burn Rate Rules table could not
 * tell the user whether a rule was paging someone right now, had ever
 * fired, or had never once triggered.
 *
 * The predicate is the worker's own (EvaluateSlos.evaluateBurnRateRule's
 * `hasUnresolvedFiringState`), lifted here so the table and the worker can
 * never disagree about what "firing" means.
 *
 * Kept free of React and of the database model so both can import it and
 * so the ordering edges are unit-testable without a DOM.
 */

import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";

export interface SloBurnRateRuleAlertState {
  lastAlertCreatedAt?: Date | undefined | null;
  lastAlertResolvedAt?: Date | undefined | null;
}

/**
 * True when the rule has fired and that alert has not been resolved
 * since.
 *
 * A resolve stamped at exactly the same instant as the fire counts as
 * resolved: the worker writes the resolve strictly after the fire, so an
 * equal pair can only be the same lifecycle, and treating it as firing
 * would leave a red "Firing" pill on a rule with nothing open.
 */
export type IsBurnRateRuleFiringFunction = (
  rule: SloBurnRateRuleAlertState,
) => boolean;

export const isBurnRateRuleFiring: IsBurnRateRuleFiringFunction = (
  rule: SloBurnRateRuleAlertState,
): boolean => {
  if (!rule.lastAlertCreatedAt) {
    return false;
  }

  if (!rule.lastAlertResolvedAt) {
    return true;
  }

  return rule.lastAlertResolvedAt.getTime() < rule.lastAlertCreatedAt.getTime();
};

/**
 * Whether the OWNING SLO is in a state where a burn rate rule could be
 * firing at all.
 *
 * `isBurnRateRuleFiring` alone is not enough to render a live "Firing"
 * badge. When an SLO is disabled, or the worker's guards move it to
 * Misconfigured or Paused, the SLO-level resolve paths
 * (ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo and the
 * worker's setGuardStatusAndResolveOpenAlerts) close every open alert but
 * deliberately do NOT stamp `lastAlertResolvedAt` — that column drives a
 * live rule's re-fire suppression, and this is a state change of the SLO
 * rather than a burn rate that recovered. The rule's own columns are
 * therefore left mid-lifecycle, and a UI reading them alone would show a
 * red "Firing" pill on a rule with nothing open, forever.
 *
 * Pairing the two predicates keeps the badge honest without touching the
 * suppression semantics the worker depends on.
 */
export interface SloBurnRateFiringContext {
  isEnabled?: boolean | undefined | null;
  sloStatus?: SloStatus | undefined | null;
}

export type CanSloFireBurnRateAlertsFunction = (
  slo: SloBurnRateFiringContext,
) => boolean;

export const canSloFireBurnRateAlerts: CanSloFireBurnRateAlertsFunction = (
  slo: SloBurnRateFiringContext,
): boolean => {
  if (slo.isEnabled === false) {
    return false;
  }

  return (
    slo.sloStatus !== SloStatus.Misconfigured &&
    slo.sloStatus !== SloStatus.Paused
  );
};
