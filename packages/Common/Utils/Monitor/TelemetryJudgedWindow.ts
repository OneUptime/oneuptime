import { MonitorEvaluationWindow } from "../../Types/Monitor/MonitorEvaluationSummary";

/*
 * THE WINDOW A TELEMETRY CHECK JUDGED, AS ITS ROOT CAUSE SAYS IT (issues
 * #11248 and #11334).
 *
 * A telemetry check judges the window that ends when it was due, however
 * late it runs: one tried again 15 seconds after it failed judges the same
 * minute it was due to, not the minute before it ran. So an incident or an
 * alert it opens names that window, and the logs, metrics or spans behind it
 * are found where the check found them. The window holds its start and not
 * its end (TelemetryCheckWindow), and says so: a record stamped on its end
 * was judged by the next check.
 *
 *   "2026-11-27 10:00:07 up to, but not including, 10:01:07 UTC"
 *   "2026-11-26 10:00:07 up to, but not including, 2026-11-27 10:00:07 UTC"
 *     (a day-long window)
 *   "2026-11-27 10:00:07 to 10:01:07 UTC" (a window judged before #11334,
 *     which held both its ends)
 *
 * In UTC, to the second, as a root cause writes dates (SSLMonitorCriteria):
 * a root cause is read in email, Slack and Teams as well as on the
 * Dashboard, by people in every zone. The Dashboard writes the same window
 * in its reader's zone and language (EvaluationLogList).
 */
export default class TelemetryJudgedWindow {
  public static describe(
    window: MonitorEvaluationWindow | null | undefined,
  ): string | null {
    if (!window) {
      return null;
    }

    const startsAt: Date = new Date(window.startsAt);
    const endsAt: Date = new Date(window.endsAt);

    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      endsAt.getTime() < startsAt.getTime()
    ) {
      return null;
    }

    const start: string = TelemetryJudgedWindow.toUtcText(startsAt);
    const end: string = TelemetryJudgedWindow.toUtcText(endsAt);

    // One day: its date once.
    const endText: string =
      start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end;

    if (window.includesEnd === false) {
      return `${start} up to, but not including, ${endText} UTC`;
    }

    return `${start} to ${endText} UTC`;
  }

  // "2026-11-27 10:00:07": the time in UTC, to the second.
  private static toUtcText(date: Date): string {
    return date.toISOString().slice(0, 19).replace("T", " ");
  }
}
