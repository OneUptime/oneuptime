/*
 * A criteria filter's match history: whether the filter matched, check by
 * check, for the filters that are evaluated over a period of time but have
 * no series of their own (CriteriaFilterUtil.hasMatchHistory) - a response
 * body, a header, a JavaScript expression, a request timeout.
 *
 * Each check writes one row per such filter into the monitor's metrics: 1
 * when the filter matched, 0 when it did not. The row is the evaluator's own
 * record rather than a chart anyone picks, so it is never offered as a
 * metric. CriteriaFilterMatchHistory (Common/Server) writes and reads it.
 */

// The series every filter's match history is written to.
export const CRITERIA_FILTER_MATCH_METRIC_NAME: string =
  "oneuptime.monitor.criteria.filter.matched";

/*
 * The attribute that tells one filter's history from another's: a key made
 * from the monitor step and what the filter checks, so editing what a filter
 * checks starts a new history instead of judging the new filter by the old
 * one's checks.
 */
export const CRITERIA_FILTER_KEY_ATTRIBUTE: string = "criteriaFilterKey";

// What a match history row's value means.
export const CRITERIA_FILTER_MATCHED_VALUE: number = 1;
export const CRITERIA_FILTER_NOT_MATCHED_VALUE: number = 0;
