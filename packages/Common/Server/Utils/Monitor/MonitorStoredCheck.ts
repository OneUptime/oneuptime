import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import {
  EVIDENCE_SCOPE_FIELD,
  EVIDENCE_TRUNCATED_FIELD,
  LOGGED_SERIES_FIELD,
  LoggedSeries,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
  StoredCheckEvidenceScope,
} from "../../../Utils/Monitor/StoredCheckEvidence";
import JsonBudget, { JsonBudgetResult } from "../JsonBudget";
import DataToProcess from "./DataToProcess";
import MonitorRecordEvidence from "./MonitorRecordEvidence";

/*
 * THE CHECK AN INCIDENT, AN ALERT OR A STATE CHANGE KEEPS, SCOPED AND
 * BOUNDED (OneUptime issue #9189; what is kept: StoredCheckEvidence).
 *
 * In this order, so no step works on what a step before it dropped:
 *
 *   1. Scope. A record about one series of a grouped monitor keeps that
 *      series: the entry of seriesBreakdown (a Metrics monitor's), of
 *      groupBreakdown and resolvedGroups (a Logs monitor's) whose
 *      fingerprint is the record's, and - for a metric series - its points
 *      in metricResult, query by query and formula by formula, which is
 *      what the series' aggregatedResults are. A series the evaluation no
 *      longer has (it stopped reporting) keeps none. The entry is found
 *      through an index built once for each evaluation's list, so the
 *      fifteenth alert of a fan-out costs what the first did.
 *   2. Bound, before redaction: containers cut to BOUND_BEFORE_REDACTION
 *      times the limit, strings kept whole - a secret cut in half may no
 *      longer look like one. So redaction never walks a fleet.
 *   3. Redact and make storable (MonitorRecordEvidence.toStoredCheck).
 *   4. Cap: cut to the limit, strings too, and say so
 *      (EVIDENCE_TRUNCATED_FIELD).
 *
 * A record that is not about one series - a monitor that is not grouped, a
 * criteria that judges the whole monitor - keeps the check as before, cut
 * to the limit when it is past it.
 */

// The lists of a check that hold one entry per series or group.
const SERIES_LIST_FIELDS: ReadonlyArray<string> = [
  "seriesBreakdown",
  "groupBreakdown",
  "resolvedGroups",
];

const METRIC_SERIES_LIST_FIELD: string = "seriesBreakdown";

/*
 * How much bigger than the limit a check may be before it is redacted: room
 * for what redaction and storing change, never a fleet.
 */
export const BOUND_BEFORE_REDACTION: number = 4;

// Room kept for the marker a cut check carries.
const MARKER_RESERVE_IN_BYTES: number = 64;

/*
 * Each evaluation's series list, indexed by fingerprint the first time a
 * record of it is stored. Weak: the index goes with the evaluation.
 */
const seriesIndexes: WeakMap<
  ReadonlyArray<unknown>,
  Map<string, JSONObject>
> = new WeakMap<ReadonlyArray<unknown>, Map<string, JSONObject>>();

export default class MonitorStoredCheck {
  /*
   * The check as an incident, an alert, or a state or status change keeps
   * it: about the record's own series, redacted, storable, and at most
   * maxSizeInBytes of JSON. Never changes what it is handed.
   */
  public static toStoredCheck(input: {
    dataToProcess: DataToProcess;
    keepResponseContent: boolean;
    monitorStep?: MonitorStep | undefined;
    // The series the record is about; none for the whole monitor.
    seriesFingerprint?: string | null | undefined;
    /*
     * For a record about the whole of a grouped check: the series the
     * evaluation acted on, kept first (boundSeries).
     */
    firstFingerprints?: ReadonlySet<string> | undefined;
    maxSizeInBytes?: number | undefined;
  }): JSONObject {
    const maxSizeInBytes: number =
      input.maxSizeInBytes || STORED_CHECK_MAX_SIZE_IN_BYTES;

    const scopedToSeries: DataToProcess = MonitorStoredCheck.scopeToSeries({
      check: input.dataToProcess,
      seriesFingerprint: input.seriesFingerprint,
    });

    /*
     * A record about the whole of a grouped check - a change of the
     * monitor's status, a criteria that judges the whole monitor - keeps its
     * series as the monitor's log does, before anything walks them
     * (boundSeries, #10108): the series the evaluation acted on first, up to
     * the limit, and how many there were. Bounded only by the steps below,
     * 16,000 series were a megabyte of the check copied and redacted, in one
     * block of the event loop, only for most of it to be cut at the end.
     */
    const scoped: DataToProcess =
      scopedToSeries === input.dataToProcess
        ? MonitorStoredCheck.boundSeries({
            check: scopedToSeries,
            firstFingerprints: input.firstFingerprints,
            maxSizeInBytes: maxSizeInBytes,
          })
        : scopedToSeries;

    const bounded: JsonBudgetResult = JsonBudget.fit(
      scoped,
      maxSizeInBytes * BOUND_BEFORE_REDACTION,
      { cutStrings: false },
    );

    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: (bounded.value || {}) as DataToProcess,
      keepResponseContent: input.keepResponseContent,
      monitorStep: input.monitorStep,
    });

    const capped: JsonBudgetResult = JsonBudget.fit(
      stored,
      maxSizeInBytes - MARKER_RESERVE_IN_BYTES,
      { cutStrings: true },
    );

    if (
      !bounded.isTrimmed &&
      !capped.isTrimmed &&
      bounded.value !== undefined
    ) {
      return stored;
    }

    const result: JSONObject = {
      ...((capped.value as JSONObject | undefined) || {}),
      [EVIDENCE_TRUNCATED_FIELD]: true,
    };

    if (Buffer.byteLength(JSON.stringify(result), "utf8") <= maxSizeInBytes) {
      return result;
    }

    // Never reached while measuring is exact; a guard all the same.
    return { [EVIDENCE_TRUNCATED_FIELD]: true };
  }

  /*
   * The check as a record about one series keeps it: the series' entry of
   * each series list, and its own points in metricResult. A check with no
   * series list, or a record with no series, is returned as it is. Copies
   * the check's own object only; what it holds is shared, never changed.
   */
  public static scopeToSeries(input: {
    check: DataToProcess;
    seriesFingerprint?: string | null | undefined;
  }): DataToProcess {
    const fingerprint: string | null | undefined = input.seriesFingerprint;

    if (
      !fingerprint ||
      fingerprint === MetricSeriesFingerprint.WholeMonitorFingerprint ||
      !MonitorStoredCheck.isPlainObject(input.check)
    ) {
      return input.check;
    }

    const source: JSONObject = input.check as unknown as JSONObject;
    const scoped: JSONObject = { ...source };
    let seriesInEvaluation: number | undefined = undefined;

    for (const field of SERIES_LIST_FIELDS) {
      const list: unknown = source[field];

      if (!Array.isArray(list)) {
        continue;
      }

      if (seriesInEvaluation === undefined) {
        seriesInEvaluation = list.length;
      }

      const entry: JSONObject | undefined = MonitorStoredCheck.findSeries({
        list: list,
        fingerprint: fingerprint,
      });

      scoped[field] = entry ? [entry] : [];

      if (field !== METRIC_SERIES_LIST_FIELD) {
        continue;
      }

      /*
       * The series' own points: its aggregatedResults are metricResult's
       * rows of this series, query by query, and the formulas worked out
       * on them, in metricResult's order.
       */
      if (Array.isArray(source["metricResult"])) {
        scoped["metricResult"] = Array.isArray(entry?.["aggregatedResults"])
          ? entry!["aggregatedResults"]
          : [];
      }

      if (source["metricResultArrivals"] !== undefined) {
        if (Array.isArray(entry?.["arrivals"])) {
          scoped["metricResultArrivals"] = entry!["arrivals"];
        } else {
          delete scoped["metricResultArrivals"];
        }
      }
    }

    if (seriesInEvaluation === undefined) {
      return input.check;
    }

    const scope: StoredCheckEvidenceScope = {
      seriesFingerprint: fingerprint,
      seriesInEvaluation: seriesInEvaluation,
    };

    scoped[EVIDENCE_SCOPE_FIELD] = scope as unknown as JSONObject;

    return scoped as unknown as DataToProcess;
  }

  /*
   * A grouped evaluation as the monitor's log keeps it (MonitorLogUtil,
   * #10108): its series lists - a Metrics monitor's seriesBreakdown, a Logs
   * monitor's groups - held to maxSizeInBytes of JSON, the series the
   * evaluation acted on first, then the others in the evaluation's order.
   * A Metrics check's metricResult keeps the points of the series kept,
   * query by query and formula by formula, as a record about one series
   * does (scopeToSeries), so the two halve the budget between them. The
   * copy says how many series there were (LOGGED_SERIES_FIELD) and that it
   * was cut (EVIDENCE_TRUNCATED_FIELD).
   *
   * The log used to keep every series: 73 MB of JSON per evaluation at
   * 16,000 series, copied, redacted and encoded on the event loop - four
   * seconds of the evaluation - and written to ClickHouse every five
   * minutes, for a page that cannot show it. A check whose series fit is
   * returned as it is; nothing it holds is changed or copied, but its own
   * object and lists.
   */
  public static boundSeries(input: {
    check: DataToProcess;
    // The series the evaluation acted on: kept first.
    firstFingerprints?: ReadonlySet<string> | undefined;
    maxSizeInBytes?: number | undefined;
  }): DataToProcess {
    if (!MonitorStoredCheck.isPlainObject(input.check)) {
      return input.check;
    }

    const maxSizeInBytes: number =
      input.maxSizeInBytes || STORED_CHECK_MAX_SIZE_IN_BYTES;
    const source: JSONObject = input.check as unknown as JSONObject;

    const fields: Array<string> = SERIES_LIST_FIELDS.filter(
      (field: string): boolean => {
        return Array.isArray(source[field]);
      },
    );

    if (fields.length === 0) {
      return input.check;
    }

    const hasMetricPoints: boolean =
      fields.includes(METRIC_SERIES_LIST_FIELD) &&
      Array.isArray(source["metricResult"]);

    // What the series take: their lists, and a Metrics check's points.
    let size: number = 0;

    for (const field of hasMetricPoints
      ? [...fields, "metricResult"]
      : fields) {
      size += JsonBudget.measure(source[field], maxSizeInBytes - size);

      if (size > maxSizeInBytes) {
        break;
      }
    }

    if (size <= maxSizeInBytes) {
      return input.check;
    }

    const bounded: JSONObject = { ...source };
    let room: number = hasMetricPoints
      ? Math.floor(maxSizeInBytes / 2)
      : maxSizeInBytes;
    let logged: LoggedSeries | undefined = undefined;

    for (const field of fields) {
      const list: Array<unknown> = source[field] as Array<unknown>;
      const kept: Array<JSONObject> = [];

      for (const entry of MonitorStoredCheck.orderForLog({
        list: list,
        firstFingerprints: input.firstFingerprints,
      })) {
        // The entry, and the comma before it.
        const entrySize: number = JsonBudget.measure(entry, room) + 1;

        if (entrySize > room) {
          break;
        }

        kept.push(entry);
        room -= entrySize;
      }

      bounded[field] = kept;

      if (!logged) {
        logged = {
          seriesInEvaluation: list.length,
          seriesWithDataInEvaluation:
            field === METRIC_SERIES_LIST_FIELD
              ? MonitorStoredCheck.countSeriesWithData(list)
              : list.length,
          seriesKept: kept.length,
        };
      }

      if (field === METRIC_SERIES_LIST_FIELD && hasMetricPoints) {
        bounded["metricResult"] = MonitorStoredCheck.pointsOfSeries({
          results: source["metricResult"] as Array<unknown>,
          series: kept,
        });
      }
    }

    bounded[LOGGED_SERIES_FIELD] = logged as unknown as JSONObject;
    bounded[EVIDENCE_TRUNCATED_FIELD] = true;

    return bounded as unknown as DataToProcess;
  }

  // A series list in the order the log keeps it: the series acted on first.
  private static orderForLog(input: {
    list: ReadonlyArray<unknown>;
    firstFingerprints?: ReadonlySet<string> | undefined;
  }): Array<JSONObject> {
    const first: Array<JSONObject> = [];
    const rest: Array<JSONObject> = [];

    for (const entry of input.list) {
      if (!MonitorStoredCheck.isPlainObject(entry)) {
        continue;
      }

      const fingerprint: unknown = (entry as JSONObject)["fingerprint"];

      if (
        input.firstFingerprints &&
        typeof fingerprint === "string" &&
        input.firstFingerprints.has(fingerprint)
      ) {
        first.push(entry as JSONObject);
      } else {
        rest.push(entry as JSONObject);
      }
    }

    return first.length > 0 ? [...first, ...rest] : rest;
  }

  /*
   * How many series of a Metrics check had a data point, as its log page
   * counts them (MonitorLogSummaryUtil): an absent host's seeded series has
   * none.
   */
  private static countSeriesWithData(list: ReadonlyArray<unknown>): number {
    let count: number = 0;

    for (const entry of list) {
      const results: unknown = MonitorStoredCheck.isPlainObject(entry)
        ? (entry as JSONObject)["aggregatedResults"]
        : undefined;

      if (
        Array.isArray(results) &&
        results.some((result: unknown): boolean => {
          const data: unknown = (result as JSONObject | null)?.["data"];
          return Array.isArray(data) && data.length > 0;
        })
      ) {
        count++;
      }
    }

    return count;
  }

  /*
   * metricResult for the series kept: each query's and formula's result,
   * with the points of those series - their aggregatedResults, in the same
   * order - and whatever else the result says (a read cut at its limit).
   */
  private static pointsOfSeries(input: {
    results: ReadonlyArray<unknown>;
    series: ReadonlyArray<JSONObject>;
  }): Array<JSONObject> {
    return input.results.map((result: unknown, index: number): JSONObject => {
      const data: Array<unknown> = [];

      for (const entry of input.series) {
        const results: unknown = entry["aggregatedResults"];
        const own: unknown = Array.isArray(results)
          ? (results[index] as JSONObject | undefined)?.["data"]
          : undefined;

        if (Array.isArray(own)) {
          for (const point of own) {
            data.push(point);
          }
        }
      }

      return {
        ...(MonitorStoredCheck.isPlainObject(result)
          ? (result as JSONObject)
          : {}),
        data: data as Array<JSONObject>,
      };
    });
  }

  // The entry of a series list with this fingerprint, through its index.
  private static findSeries(input: {
    list: ReadonlyArray<unknown>;
    fingerprint: string;
  }): JSONObject | undefined {
    let index: Map<string, JSONObject> | undefined = seriesIndexes.get(
      input.list,
    );

    if (!index) {
      index = new Map<string, JSONObject>();

      for (const item of input.list) {
        const entryFingerprint: unknown = MonitorStoredCheck.isPlainObject(item)
          ? (item as JSONObject)["fingerprint"]
          : undefined;

        if (
          typeof entryFingerprint === "string" &&
          !index.has(entryFingerprint)
        ) {
          index.set(entryFingerprint, item as JSONObject);
        }
      }

      seriesIndexes.set(input.list, index);
    }

    return index.get(input.fingerprint);
  }

  private static isPlainObject(value: unknown): boolean {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
