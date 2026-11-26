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
/*
 * Present only on findings of correlation rules: the Sigma correlation type
 * (event_count, value_count, temporal, temporal_ordered, new_value), and
 * what happened, in a sentence.
 */
export const DETECTION_CORRELATION_TYPE_ATTRIBUTE: string =
  "oneuptime.detection.correlation_type";
export const DETECTION_SUMMARY_ATTRIBUTE: string =
  "oneuptime.detection.summary";

// Save-time bounds for DetectionRule.evaluationIntervalInMinutes.
export const DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES: number = 1;
export const DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES: number = 1440;

/*
 * Cap on how far back one evaluation may scan, whatever lastEvaluatedAt
 * says — a rule re-enabled after a month must not trigger a month-long
 * table scan. A rule catching up after its runs failed (#10490) reads past
 * it, a stretch of at most this long at a time.
 */
export const DETECTION_MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

/*
 * How soon a scheduled rule whose run failed is tried again (#10490): at
 * its next interval, or within the hour when its interval is longer - a
 * daily rule that failed once would otherwise wait a day, and a failing rule
 * tried every minute read a longer stretch each time. Its place stays where
 * its last good run left it, so nothing it missed is skipped.
 */
export const DETECTION_RETRY_AFTER_FAILURE_IN_MINUTES: number = 60;

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
 * How far behind the clock a scheduled rule judges what has arrived. A rule
 * judges the events that ARRIVED since its last run - by createdAt, stamped
 * as each row is built - whenever they happened (#10337), and a row reaches
 * the table a few seconds after it is stamped: the ingest API's writer
 * holds a batch for up to five seconds and retries an insert for up to
 * about forty, and ClickHouse flushes its async-insert buffer after that. A
 * run that judged right up to now could pass a row stamped a moment ago
 * that is not in the table yet. Judging what arrived up to two minutes ago,
 * every event stamped by then is there, and is judged once.
 */
export const DETECTION_EVALUATION_DELAY_IN_SECONDS: number = 120;

/*
 * How long before it arrived an event may have happened and still be
 * judged by a scheduled rule: a day, as long as a Security Event
 * Destination sends one late (FORWARD_LATE_EVENT_WINDOW_IN_HOURS). That
 * covers a span read an hour after it started, a flow read in whole
 * windows, a cloud audit log that lags by minutes or hours, and a log
 * shipper that was down for most of a day. An event older than that when
 * it arrives is stored and searchable, but no scheduled rule judges it:
 * Run on Past Events does.
 */
export const DETECTION_LATE_EVENT_WINDOW_IN_MINUTES: number = 24 * 60;

/*
 * The most windows of its interval one run of a rule that counts reads. A
 * run whose events fall in more - catching up after a gap, or a source that
 * sent a day of events at once - judges what arrived up to the point they
 * fill this many, records where it got to, and the next run goes on from
 * there, so no run reads without bound and none skips an event.
 */
export const DETECTION_MAX_WINDOWS_PER_RUN: number = 12;
