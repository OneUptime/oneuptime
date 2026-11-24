import { JSONObject } from "../../../Types/JSON";
import { MonitorEvaluationEvent } from "../../../Types/Monitor/MonitorEvaluationSummary";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";

/*
 * THE SERIES AN EVALUATION EVENT IS ABOUT (OneUptime issue #10841).
 *
 * An event that a grouped monitor's alerts and incidents add about one
 * series - opened, already open, left open, resolved, skipped, failed -
 * names that series. A record about one series then keeps the events about
 * it and those about the whole monitor, and never another series'
 * (MonitorStoredCheck.scopeToSeries), as it keeps its own series and not
 * the fleet's.
 *
 * Before, each record kept every event the evaluation had added so far: the
 * k-th alert of a fleet-wide problem kept the "Alert created" events of the
 * k-1 alerts opened before it, and redacted, measured and stored them all.
 * The work grew with the square of the alerts: 513 alerts of the #10108
 * fleet spent 6 seconds on the checks they kept, the 200th keeping 143 KB of
 * events about other series.
 */
export default class EvaluationEventSeries {
  /*
   * The field an event about `fingerprint` carries: none for a record of no
   * series or of the whole monitor, whose events are the whole monitor's.
   */
  public static of(
    fingerprint: string | null | undefined,
  ): Pick<MonitorEvaluationEvent, "seriesFingerprint"> {
    if (
      !fingerprint ||
      fingerprint === MetricSeriesFingerprint.WholeMonitorFingerprint
    ) {
      return {};
    }

    return { seriesFingerprint: fingerprint };
  }

  /*
   * The events a record about the series `fingerprint` keeps, in their
   * order: those about the whole monitor, and its own. The same array when
   * it keeps them all.
   */
  public static keptFor(input: {
    events: ReadonlyArray<unknown>;
    fingerprint: string;
  }): ReadonlyArray<unknown> {
    let isAnyLeftOut: boolean = false;

    const kept: Array<unknown> = input.events.filter(
      (event: unknown): boolean => {
        const series: unknown =
          event && typeof event === "object"
            ? (event as JSONObject)["seriesFingerprint"]
            : undefined;
        const isKept: boolean =
          typeof series !== "string" ||
          series.length === 0 ||
          series === input.fingerprint;

        if (!isKept) {
          isAnyLeftOut = true;
        }

        return isKept;
      },
    );

    return isAnyLeftOut ? kept : input.events;
  }
}
