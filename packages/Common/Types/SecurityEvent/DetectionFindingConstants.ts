/*
 * The contract between the detection engine and everything that watches
 * its output. writeDetectionFindings (DetectionRuleEvaluator) stamps every
 * finding row with these class/attribute values, and the dashboard's
 * "create a monitor from this rule" flow builds its filters from the same
 * constants — one source, so a renamed attribute cannot silently orphan
 * every monitor built on it.
 */

// OCSF Findings class the engine writes matches back as.
export const DETECTION_FINDING_CLASS_UID: number = 2004;
export const DETECTION_FINDING_CLASS_NAME: string = "Detection Finding";

// Flattened attributes carried by every Detection Finding row.
export const DETECTION_RULE_ID_ATTRIBUTE: string =
  "oneuptime.detection.rule_id";
export const DETECTION_RULE_NAME_ATTRIBUTE: string =
  "oneuptime.detection.rule_name";
export const DETECTION_MATCH_COUNT_ATTRIBUTE: string =
  "oneuptime.detection.match_count";
// Present only on findings from rules with a distinctCountField set.
export const DETECTION_DISTINCT_COUNT_ATTRIBUTE: string =
  "oneuptime.detection.distinct_count";

/*
 * Save-time bounds for DetectionRule.matchCountThreshold — one home for
 * the server validator and the dashboard form, so the two ranges cannot
 * drift apart.
 */
export const DETECTION_MATCH_COUNT_THRESHOLD_MIN: number = 1;
export const DETECTION_MATCH_COUNT_THRESHOLD_MAX: number = 1000000;
export const DETECTION_GROUP_VALUE_ATTRIBUTE: string =
  "oneuptime.detection.group_value";
export const DETECTION_SIGMA_ID_ATTRIBUTE: string =
  "oneuptime.detection.sigma_id";

// Save-time bounds for DetectionRule.evaluationIntervalInMinutes.
export const DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES: number = 1;
export const DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES: number = 1440;

/*
 * Cap on how far back one evaluation may scan, whatever lastEvaluatedAt
 * says — a rule re-enabled after a month must not trigger a month-long
 * table scan.
 */
export const DETECTION_MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

// One alert per distinct group value per cycle, at most.
export const DETECTION_MAX_GROUPS_PER_EVALUATION: number = 100;
