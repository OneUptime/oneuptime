import MonitorCriteriaInstance from "../MonitorCriteriaInstance";
import ObjectID from "../../ObjectID";
import FilterCondition from "../../Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../CriteriaFilter";

/*
 * One extra metric comparison OR'd (or AND'd) alongside the primary one.
 *
 * Ceph needs these: a single "PG Damaged" monitor watches PG_DAMAGED OR
 * OSD_SCRUB_ERRORS, and recovers only when both have cleared.
 */
export interface AdditionalCriteriaFilterSpec {
  metricAlias: string;
  filterType: FilterType;
  value: number;
}

/*
 * The criteria pair every one-click monitor recommendation is built from.
 *
 * Before this module, nine `*AlertTemplates.ts` files each carried their own
 * near-verbatim copy of these two functions. The copies had already silently
 * diverged (Docker Swarm's group-by key, Ceph's second pair), and — more
 * importantly — every copy hardcoded the same two defaults that made
 * recommendation-created monitors flap:
 *
 *   1. `EvaluateOverTimeType.AnyValue` on the FIRE side, so a single sample
 *      anywhere in the rolling window opened an alert. A window of
 *      [72.35, 81.54, 79.95, 91.53, 87.73] against "> 90" fired on the one
 *      sample that crossed.
 *   2. The SAME threshold on both sides — fire at "> 90", recover at
 *      "<= 90" — so a workload sitting near its threshold alternated
 *      between the two on consecutive evaluations, forever. One customer
 *      cluster produced 39 emails (19 open, 20 resolve) from a single
 *      monitor in under two hours.
 *
 * Both defaults now live here, in one place, and both are inverted.
 */

/*
 * "The condition held for the WHOLE window", not "at some point during it".
 *
 * `AllValues` is the quantifier ServiceAlertTemplates already used for the
 * same reason. It is what makes `rollingTime` mean a duration: with
 * `AnyValue`, a five-minute window and a one-minute window behave
 * identically for anything that spikes, because both reduce to "did any
 * sample cross".
 */
export const SustainedEvaluation: EvaluateOverTimeType =
  EvaluateOverTimeType.AllValues;

/*
 * How far a metric must fall back past the firing threshold before the
 * monitor is called healthy again, as a fraction of the threshold.
 *
 * A dead band is what stops a metric hovering at the threshold from
 * toggling the monitor's status on every evaluation. 10% is deliberately
 * modest: it is wide enough to absorb ordinary scrape-to-scrape jitter on a
 * percentage metric, and narrow enough that a genuine recovery is still
 * reported promptly.
 *
 * NOTE this makes the monitor STATUS sticky. It does not by itself stop an
 * ALERT from resolving, because alert auto-resolution keys on the firing
 * criteria no longer matching rather than on the healthy criteria matching
 * (see MonitorResource.checkOpenAlertsAndCloseIfResolved). Sustained
 * evaluation above is what does the work there.
 */
export const DefaultRecoveryMarginFraction: number = 0.1;

/*
 * The recovery threshold for a firing threshold, or `undefined` when the
 * comparison has no meaningful dead band.
 *
 * Only the ordered comparisons get one. An equality or boolean criterion
 * ("phase == Pending", "leader is false") has no "slightly better" state to
 * sit in, and inventing one would just move the edge rather than widen it.
 *
 * A threshold of 0 also gets none: 10% of 0 is 0, and a count-based
 * criterion ("> 0 failed jobs") recovers correctly at exactly 0.
 */
export function getRecoveryThreshold(data: {
  filterType: FilterType;
  value: number;
  marginFraction?: number | undefined;
}): number | undefined {
  if (data.value === 0 || !Number.isFinite(data.value)) {
    return undefined;
  }

  const margin: number =
    Math.abs(data.value) *
    (data.marginFraction ?? DefaultRecoveryMarginFraction);

  switch (data.filterType) {
    /*
     * Fires when the metric climbs. Recover lower, so the metric has to
     * come meaningfully back down.
     */
    case FilterType.GreaterThan:
    case FilterType.GreaterThanOrEqualTo:
      return data.value - margin;
    /*
     * Fires when the metric falls (free disk, battery, signal). Recover
     * higher.
     */
    case FilterType.LessThan:
    case FilterType.LessThanOrEqualTo:
      return data.value + margin;
    default:
      return undefined;
  }
}

/*
 * The complementary comparison for the healthy criteria.
 *
 * Kept here rather than at each call site so a template cannot accidentally
 * ship a healthy criteria that overlaps its own unhealthy one.
 */
export function getRecoveryFilterType(filterType: FilterType): FilterType {
  switch (filterType) {
    case FilterType.GreaterThan:
      return FilterType.LessThanOrEqualTo;
    case FilterType.GreaterThanOrEqualTo:
      return FilterType.LessThan;
    case FilterType.LessThan:
      return FilterType.GreaterThanOrEqualTo;
    case FilterType.LessThanOrEqualTo:
      return FilterType.GreaterThan;
    case FilterType.EqualTo:
      return FilterType.NotEqualTo;
    case FilterType.NotEqualTo:
      return FilterType.EqualTo;
    default:
      return filterType;
  }
}

/*
 * Build the filter list for one criteria instance, applying the same
 * aggregation and no-data policy to the primary comparison and to every
 * additional one. Keeping this in one function is what stops an additional
 * filter from quietly retaining `AnyValue` after the primary was moved off
 * it — which is exactly how a "sustained" criteria would go on flapping.
 */
function buildFilters(data: {
  metricAlias: string;
  filterType: FilterType;
  value: number;
  metricAggregationType: EvaluateOverTimeType;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  onNoDataPolicy?: NoDataPolicy | undefined;
  deriveValue?: ((spec: AdditionalCriteriaFilterSpec) => number) | undefined;
}): Array<CriteriaFilter> {
  const specs: Array<AdditionalCriteriaFilterSpec> = [
    {
      metricAlias: data.metricAlias,
      filterType: data.filterType,
      value: data.value,
    },
    ...(data.additionalFilters || []),
  ];

  return specs.map((spec: AdditionalCriteriaFilterSpec) => {
    return {
      checkOn: CheckOn.MetricValue,
      filterType: spec.filterType,
      metricMonitorOptions: {
        metricAggregationType: data.metricAggregationType,
        metricAlias: spec.metricAlias,
        ...(data.onNoDataPolicy ? { onNoDataPolicy: data.onNoDataPolicy } : {}),
      },
      value: data.deriveValue ? data.deriveValue(spec) : spec.value,
    } as CriteriaFilter;
  });
}

export interface UnhealthyCriteriaArgs {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  incidentTitle?: string | undefined;
  incidentDescription?: string | undefined;
  criteriaName?: string | undefined;
  criteriaDescription?: string | undefined;
  /*
   * What the default "See root cause for detailed X information." sentence
   * calls the thing being monitored. Purely cosmetic; the only thing the
   * nine copies of this function actually differed on.
   */
  resourceNoun?: string | undefined;
  /*
   * Override the sustained default. A template should only do this when the
   * signal genuinely is a single event rather than a level — and should say
   * why in a comment at the call site.
   */
  metricAggregationType?: EvaluateOverTimeType | undefined;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
  treatNoDataAsZero?: boolean | undefined;
}

export function buildUnhealthyCriteriaInstance(
  args: UnhealthyCriteriaArgs,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incidentTitle: string =
    args.incidentTitle || `${args.monitorName} - Alert Triggered`;
  const incidentDescription: string =
    args.incidentDescription ||
    `${args.monitorName} has triggered an alert condition. See root cause for detailed ${
      args.resourceNoun || "resource"
    } information.`;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
    filterCondition: args.filterCondition || FilterCondition.Any,
    filters: buildFilters({
      metricAlias: args.metricAlias,
      filterType: args.filterType,
      value: args.value,
      metricAggregationType: args.metricAggregationType ?? SustainedEvaluation,
      additionalFilters: args.additionalFilters,
      onNoDataPolicy: args.treatNoDataAsZero
        ? NoDataPolicy.TreatAsZero
        : undefined,
    }),
    incidents: [
      {
        title: incidentTitle,
        description: incidentDescription,
        incidentSeverityId: args.incidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: incidentTitle,
        description: incidentDescription,
        alertSeverityId: args.alertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: args.criteriaName || `${args.monitorName} - Unhealthy`,
    description:
      args.criteriaDescription || `Criteria for detecting unhealthy state.`,
  };

  return instance;
}

export interface HealthyCriteriaArgs {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  /*
   * The threshold the metric must reach to be called healthy again. Defaults
   * to a dead band below/above `value` — see DefaultRecoveryMarginFraction.
   * Pass the firing threshold explicitly to opt out.
   */
  recoveryValue?: number | undefined;
  marginFraction?: number | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
  /*
   * Health-detail series exist only while the check is active, so a "= 0"
   * recovery comparison would otherwise see no data and never match.
   */
  treatNoDataAsZero?: boolean | undefined;
}

export function buildHealthyCriteriaInstance(
  args: HealthyCriteriaArgs,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  /*
   * Callers pass the ALREADY-COMPLEMENTED filter type and the firing
   * threshold, matching the shape the nine copies used. The dead band is
   * derived from the firing comparison, so complement back to work out
   * which direction "better" is.
   */
  const firingFilterType: FilterType = getRecoveryFilterType(args.filterType);

  const value: number =
    args.recoveryValue ??
    getRecoveryThreshold({
      filterType: firingFilterType,
      value: args.value,
      marginFraction: args.marginFraction,
    }) ??
    args.value;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
    filterCondition: args.filterCondition || FilterCondition.Any,
    filters: buildFilters({
      metricAlias: args.metricAlias,
      filterType: args.filterType,
      value: value,
      metricAggregationType: args.metricAggregationType ?? SustainedEvaluation,
      additionalFilters: args.additionalFilters,
      onNoDataPolicy: args.treatNoDataAsZero
        ? NoDataPolicy.TreatAsZero
        : undefined,
      /*
       * Give every additional recovery comparison its own dead band too,
       * derived the same way as the primary one.
       */
      deriveValue: (spec: AdditionalCriteriaFilterSpec) => {
        if (spec.metricAlias === args.metricAlias) {
          return value;
        }

        return (
          getRecoveryThreshold({
            filterType: getRecoveryFilterType(spec.filterType),
            value: spec.value,
            marginFraction: args.marginFraction,
          }) ?? spec.value
        );
      },
    }),
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: "Criteria for healthy state.",
  };

  return instance;
}
