/**
 * Whether a burn rate rule currently has something open.
 *
 * A rule has TWO independent lifecycles — the Alert it raises and the
 * Incident it declares — and the evaluation worker stamps a separate pair
 * of columns for each (`lastAlertCreatedAt` / `lastAlertResolvedAt` and
 * `lastIncidentCreatedAt` / `lastIncidentResolvedAt`). Together those four
 * columns are the only record of the rule's state, but nothing read them
 * outside the worker, so the Burn Rate Rules table could not tell the user
 * whether a rule was paging someone right now, had ever fired, or had never
 * once triggered.
 *
 * The predicates are the worker's own, lifted here so the table and the
 * worker can never disagree about what "firing" means. The worker reads
 * them per output: it will not re-declare an incident a responder resolved
 * by hand while the burn is still going, and it resolves only the output
 * that is actually open.
 *
 * Kept free of React and of the database model so both can import it and
 * so the ordering edges are unit-testable without a DOM.
 */

import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";

export interface SloBurnRateRuleAlertState {
  lastAlertCreatedAt?: Date | undefined | null;
  lastAlertResolvedAt?: Date | undefined | null;
}

export interface SloBurnRateRuleIncidentState {
  lastIncidentCreatedAt?: Date | undefined | null;
  lastIncidentResolvedAt?: Date | undefined | null;
}

export type SloBurnRateRuleState = SloBurnRateRuleAlertState &
  SloBurnRateRuleIncidentState;

/*
 * A resolve stamped at exactly the same instant as the fire counts as
 * resolved: the worker writes the resolve strictly after the fire, so an
 * equal pair can only be the same lifecycle, and treating it as firing
 * would leave a red "Firing" pill on a rule with nothing open.
 */
type IsOpenFunction = (
  createdAt: Date | undefined | null,
  resolvedAt: Date | undefined | null,
) => boolean;

const isOpen: IsOpenFunction = (
  createdAt: Date | undefined | null,
  resolvedAt: Date | undefined | null,
): boolean => {
  if (!createdAt) {
    return false;
  }

  if (!resolvedAt) {
    return true;
  }

  return resolvedAt.getTime() < createdAt.getTime();
};

/**
 * True when the rule raised an Alert that has not been resolved since.
 */
export type IsBurnRateRuleAlertFiringFunction = (
  rule: SloBurnRateRuleAlertState,
) => boolean;

export const isBurnRateRuleAlertFiring: IsBurnRateRuleAlertFiringFunction = (
  rule: SloBurnRateRuleAlertState,
): boolean => {
  return isOpen(rule.lastAlertCreatedAt, rule.lastAlertResolvedAt);
};

/**
 * True when the rule declared an Incident that has not been resolved since.
 */
export type IsBurnRateRuleIncidentFiringFunction = (
  rule: SloBurnRateRuleIncidentState,
) => boolean;

export const isBurnRateRuleIncidentFiring: IsBurnRateRuleIncidentFiringFunction =
  (rule: SloBurnRateRuleIncidentState): boolean => {
    return isOpen(rule.lastIncidentCreatedAt, rule.lastIncidentResolvedAt);
  };

/**
 * True when EITHER output is open — what the "Firing" pill means to a
 * reader, who cares that the rule is currently declaring something and not
 * which table it landed in.
 */
export type IsBurnRateRuleFiringFunction = (
  rule: SloBurnRateRuleState,
) => boolean;

export const isBurnRateRuleFiring: IsBurnRateRuleFiringFunction = (
  rule: SloBurnRateRuleState,
): boolean => {
  return isBurnRateRuleAlertFiring(rule) || isBurnRateRuleIncidentFiring(rule);
};

/**
 * Whether the OWNING SLO is in a state where a burn rate rule could be
 * firing at all.
 *
 * The firing predicates alone are not quite enough to render a live "Firing"
 * badge. When an SLO is disabled, or the worker's guards move it to
 * Misconfigured or Paused, the SLO-level resolve paths
 * (ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo
 * and the worker's setGuardStatusAndResolveOpenAlerts) close every open alert
 * and incident. They deliberately do NOT stamp the resolve columns — those
 * drive a live rule's re-fire suppression, and this is a state change of the
 * SLO rather than a burn rate that recovered — so they clear the CREATED
 * columns instead (clearOpenOutputStateForRule), which is what keeps both
 * this badge and the worker's own firing gate honest.
 *
 * That clear is a separate write, though, and it can fail while the resolve
 * succeeded. This predicate is the cheap belt to that braces: a disabled or
 * guard-stopped SLO cannot have a rule firing whatever its rules' columns
 * say, so pairing the two never shows a red pill on a rule with nothing
 * open.
 */
export interface SloBurnRateFiringContext {
  isEnabled?: boolean | undefined | null;
  sloStatus?: SloStatus | undefined | null;
}

export type CanSloFireBurnRateRulesFunction = (
  slo: SloBurnRateFiringContext,
) => boolean;

export const canSloFireBurnRateRules: CanSloFireBurnRateRulesFunction = (
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
