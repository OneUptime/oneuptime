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

/*
 * The groups one run opens alerts, incidents and cases for, at most: the
 * ones with the highest counts. A run that matches more records every group
 * as a Detection Finding (up to DETECTION_MAX_FINDINGS_PER_EVALUATION) and
 * opens one case about the rest, so none goes unseen.
 */
export const DETECTION_MAX_GROUPS_PER_EVALUATION: number = 100;

/*
 * The groups one run records as Detection Findings, at most. Past it the
 * rule's lastError and its overflow case say there were more.
 */
export const DETECTION_MAX_FINDINGS_PER_EVALUATION: number = 10000;

/*
 * How far behind the clock a rule reads. An event reaches the table a
 * little after it happened - through the ingest queue, a connection's poll
 * or the scan of "Your logs" a minute later - and a rule that read right up
 * to now would already have moved past it. Reading up to two minutes ago,
 * every event is in the table before a rule reads its moment, and is
 * counted once.
 */
export const DETECTION_EVALUATION_DELAY_IN_SECONDS: number = 120;
