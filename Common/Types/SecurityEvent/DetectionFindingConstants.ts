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
export const DETECTION_GROUP_VALUE_ATTRIBUTE: string =
  "oneuptime.detection.group_value";
export const DETECTION_SIGMA_ID_ATTRIBUTE: string =
  "oneuptime.detection.sigma_id";
