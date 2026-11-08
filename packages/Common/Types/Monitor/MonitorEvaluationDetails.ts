import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";

/*
 * THE EVALUATION THAT OPENED AN INCIDENT OR AN ALERT.
 *
 * Stored on the incident or alert row when a monitor's criteria opens it, so
 * "why did this fire?" has an answer long after the monitor's own logs have
 * aged out (MonitorLog keeps a day by default). It says which criteria
 * matched, and for each of its filters what it checked, the value it was
 * given, what the check found and where: the response field or JSON path a
 * filter read, the values a JavaScript expression's references had, and a
 * short excerpt of the response around the match - never the whole body.
 *
 * Everything here was redacted and bounded on the server before it was
 * stored (MonitorEvidenceRedaction, MonitorEvaluationDetailsBuilder):
 * credential headers, secret query values, JSON fields whose names say they
 * hold a secret or personal data, and text that looks like a bearer token, a
 * JWT, a card number or an email address never reach the row. The limits
 * below are fixed on purpose: an excerpt is something a person reads at a
 * glance, and a setting for its size would be one more decision on every
 * monitor for no one's benefit.
 *
 * Plain data only - it round-trips through a jsonb column and is read by the
 * Dashboard, so nothing here imports server code.
 */

export const MonitorEvaluationDetailsVersion: number = 1;

export const MonitorEvaluationDetailsLimits: {
  // Characters of the response kept on each side of the match.
  readonly excerptContextChars: number;
  // The match itself, at most.
  readonly matchChars: number;
  // A response's start, kept when the filter found nothing to point at.
  readonly startExcerptChars: number;
  // One value: an actual value, a field's value, a configured value.
  readonly valueChars: number;
  // The evaluation's own sentence for a filter.
  readonly messageChars: number;
  // A JavaScript expression's references, listed.
  readonly fieldValuesPerFilter: number;
  // Filters kept from one criteria.
  readonly filters: number;
  // Header names listed for a Response Header filter.
  readonly headerNames: number;
  // The request's URL.
  readonly urlChars: number;
  // A probe's failure text.
  readonly failureCauseChars: number;
  // The whole record, serialized.
  readonly maxSizeInBytes: number;
  /*
   * How much of a response the server reads for an excerpt or a path. A
   * larger body is read as text around the match, never parsed whole.
   */
  readonly scannedBodyChars: number;
} = {
  excerptContextChars: 160,
  matchChars: 200,
  startExcerptChars: 320,
  valueChars: 300,
  messageChars: 1000,
  fieldValuesPerFilter: 10,
  filters: 20,
  headerNames: 20,
  urlChars: 500,
  failureCauseChars: 500,
  maxSizeInBytes: 32 * 1024,
  scannedBodyChars: 2 * 1024 * 1024,
};

/*
 * A short part of a response or request body, around what a filter matched:
 * the text before it, the matched text, and the text after it. A filter with
 * nothing to point at - Response Body Does Not Contain - keeps the start of
 * the response as `after`, with an empty `match`.
 */
export interface MonitorEvaluationExcerpt {
  before: string;
  match: string;
  after: string;
  // The body goes on before `before`.
  isCutAtStart: boolean;
  // The body goes on after `after`.
  isCutAtEnd: boolean;
}

/*
 * One reference of a JavaScript expression ({{responseBody.data.status}})
 * and the value it had when the expression was evaluated, as JSON text.
 */
export interface MonitorEvaluationFieldValue {
  // As the expression names it, without the braces.
  path: string;
  // Absent when the path found nothing in the response.
  value?: string | undefined;
  isMissing?: boolean | undefined;
  // The value was masked: a secret, or personal data.
  isRedacted?: boolean | undefined;
  // The value was longer than MonitorEvaluationDetailsLimits.valueChars.
  isTruncated?: boolean | undefined;
}

/*
 * Why a filter that reads a body has no excerpt:
 *
 *   response-excerpts-off  The monitor is set not to keep response content
 *                          on its incidents and alerts.
 *   matched-text-masked    What matched is part of a value that was masked
 *                          as a secret or personal data.
 *   empty-body             The body was empty.
 */
export type MonitorEvaluationExcerptOmission =
  | "response-excerpts-off"
  | "matched-text-masked"
  | "empty-body";

export interface MonitorEvaluationFilterDetails {
  checkOn: CheckOn;
  filterType?: FilterType | undefined;
  // The filter's own value as it was configured (a threshold, a text).
  value?: string | number | undefined;
  met: boolean;
  /*
   * The evaluation's sentence for this filter, as the evaluation log has it:
   * "Response Status Code was 503, above the 499 threshold."
   */
  message: string;
  /*
   * What the check found for this filter, written as a value: "503",
   * "6200 ms", "true". Absent where the sentence above is the only account
   * there is.
   */
  actual?: string | undefined;
  /*
   * A measurement's actual value as a number and its unit ("ms", "%"), so a
   * reader's language writes the number its own way ("2.412 ms" in German).
   * `actual` says the same in English, for anything that reads it as text.
   */
  actualNumber?: number | undefined;
  actualUnit?: string | undefined;
  /*
   * The filter is judged over a time window - its minutes, and how the
   * window's values are judged (an EvaluateOverTimeType: "Average", "All
   * Values") - so `actual` is the latest check's value, not the window's.
   */
  windowMinutes?: number | undefined;
  windowType?: string | undefined;
  // Where it was found: a JSON path, a header name, a result path.
  field?: string | undefined;
  fieldValues?: Array<MonitorEvaluationFieldValue> | undefined;
  // More references than were kept.
  areFieldValuesTruncated?: boolean | undefined;
  excerpt?: MonitorEvaluationExcerpt | undefined;
  excerptOmission?: MonitorEvaluationExcerptOmission | undefined;
}

// What the check asked: the request line, or the host it reached.
export interface MonitorEvaluationRequest {
  // API monitors, and Incoming Request monitors' callers.
  method?: string | undefined;
  // Credentials and secret query values masked.
  url?: string | undefined;
  // A host or an address, for checks that are not to a URL (Ping, Port).
  destination?: string | undefined;
  port?: number | undefined;
}

// What came back.
export interface MonitorEvaluationResponse {
  statusCode?: number | undefined;
  responseTimeInMs?: number | undefined;
  isOnline?: boolean | undefined;
  isTimeout?: boolean | undefined;
  // The probe's own account of a failure, redacted and bounded.
  failureCause?: string | undefined;
}

export default interface MonitorEvaluationDetails {
  /*
   * Bumped when the shape changes incompatibly. A reader that does not
   * know a version shows nothing rather than guess.
   */
  version: number;
  monitorType: MonitorType;
  evaluatedAt: Date;
  probeName?: string | undefined;
  // The step that was evaluated, counted from 1 - only for several steps.
  stepNumber?: number | undefined;
  stepCount?: number | undefined;
  criteriaId?: string | undefined;
  criteriaName?: string | undefined;
  // All of the filters had to match, or any one of them.
  filterCondition: FilterCondition;
  filters: Array<MonitorEvaluationFilterDetails>;
  // The criteria has more filters than were kept.
  areFiltersTruncated?: boolean | undefined;
  request?: MonitorEvaluationRequest | undefined;
  response?: MonitorEvaluationResponse | undefined;
  /*
   * The monitor keeps no response content on its incidents and alerts:
   * there are no excerpts and no values read from a body or a header.
   */
  areResponseExcerptsOff?: boolean | undefined;
  /*
   * Excerpts and values were dropped to keep the record within
   * MonitorEvaluationDetailsLimits.maxSizeInBytes.
   */
  isTrimmedToSizeLimit?: boolean | undefined;
}
