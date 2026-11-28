import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import OneUptimeDate from "Common/Types/Date";

/*
 * The two ends of the window of data a telemetry check judged (#11248), as
 * its log entry says them: in the reader's zone, language and clock, to the
 * second, and the day once when both ends fall on it - "Nov 27, 2026,
 * 10:00:07 AM" to "10:01:07 AM". A check judges the window it was due to,
 * however late it ran, so this is where its logs, metrics or spans are.
 *
 * `includesEnd` is false for a window that held its start and not its end,
 * as every check's window does since #11334: the summary then says the end
 * was not included, since a record stamped on it was the next check's. A
 * window judged before then held both.
 *
 * Null for a check that judged no window (a probe's, a request's), a summary
 * logged before checks said it, and ends that cannot be read.
 */
export function getJudgedWindowEnds(
  summary: Pick<MonitorEvaluationSummary, "judgedWindow">,
): { start: string; end: string; includesEnd: boolean } | null {
  if (!summary.judgedWindow) {
    return null;
  }

  const startsAtMs: number = new Date(summary.judgedWindow.startsAt).getTime();
  const endsAtMs: number = new Date(summary.judgedWindow.endsAt).getTime();

  if (
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    endsAtMs < startsAtMs
  ) {
    return null;
  }

  const ends: { start: string; end: string } =
    OneUptimeDate.getLocalDateTimeRangeEnds({
      start: new Date(startsAtMs),
      end: new Date(endsAtMs),
      style: "short",
      showYear: true,
      includeSeconds: true,
    });

  return {
    start: ends.start,
    end: ends.end,
    includesEnd: summary.judgedWindow.includesEnd !== false,
  };
}
