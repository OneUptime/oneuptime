import { FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import { getRecoveryThreshold } from "../../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";

/*
 * The invariant every recommendation template's fire/recover pair must hold.
 *
 * These suites used to assert the OPPOSITE — that the two thresholds were
 * the identical number and exactly partitioned the range ("disjoint
 * complement"). That is a textbook flapping configuration, and it was
 * load-bearing in the tests, so the bug could not be fixed without them
 * failing. A metric parked at the threshold satisfied "> 90" on one
 * evaluation and "<= 90" on the next, forever; one customer cluster
 * produced 39 alert emails from a single monitor in under two hours.
 *
 * The invariant is now a DEAD BAND: the recover comparison is still the
 * complement of the fire comparison, but its threshold sits strictly
 * inside the fire threshold, so a metric has to move a real distance back
 * before the monitor is called healthy.
 */

export interface CriteriaThreshold {
  filterType: FilterType;
  value: number;
}

export function getComplementFilterType(
  filterType: FilterType,
): FilterType | null {
  switch (filterType) {
    case FilterType.GreaterThan:
      return FilterType.LessThanOrEqualTo;
    case FilterType.GreaterThanOrEqualTo:
      return FilterType.LessThan;
    case FilterType.LessThan:
      return FilterType.GreaterThanOrEqualTo;
    case FilterType.LessThanOrEqualTo:
      return FilterType.GreaterThan;
    default:
      return null;
  }
}

/*
 * Whether a fire/recover pair leaves a gap the metric must cross.
 *
 * A threshold of exactly 0 gets no dead band — 10% of 0 is 0, and a
 * count-based criterion ("> 0 failed jobs") recovers correctly at exactly
 * 0 — so an equal-valued pair is accepted there and only there. The same
 * applies to the `> 0` / `= 0` pair Ceph uses for health-check series.
 */
export function hasRecoveryDeadBand(
  fire: CriteriaThreshold,
  recover: CriteriaThreshold,
): boolean {
  const expectedComplement: FilterType | null = getComplementFilterType(
    fire.filterType,
  );

  const isComplement: boolean =
    recover.filterType === expectedComplement ||
    // Ceph health-check series: fire when the count is > 0, recover at = 0.
    (fire.value === 0 &&
      fire.filterType === FilterType.GreaterThan &&
      recover.filterType === FilterType.EqualTo) ||
    // Docker Swarm task-down: fire when uptime == 0, recover when uptime > 0.
    (fire.value === 0 &&
      fire.filterType === FilterType.EqualTo &&
      recover.filterType === FilterType.GreaterThan);

  if (!isComplement) {
    return false;
  }

  const expectedRecoveryValue: number | undefined = getRecoveryThreshold({
    filterType: fire.filterType,
    value: fire.value,
  });

  if (expectedRecoveryValue === undefined) {
    // No meaningful dead band exists; the thresholds must match exactly.
    return recover.value === fire.value;
  }

  if (recover.value !== expectedRecoveryValue) {
    return false;
  }

  /*
   * And the band must point the right way: a ceiling recovers BELOW its
   * firing threshold, a floor recovers ABOVE it. Checked independently of
   * getRecoveryThreshold so a sign error in that function cannot make this
   * assertion vacuously true.
   */
  if (
    fire.filterType === FilterType.GreaterThan ||
    fire.filterType === FilterType.GreaterThanOrEqualTo
  ) {
    return recover.value < fire.value;
  }

  return recover.value > fire.value;
}
