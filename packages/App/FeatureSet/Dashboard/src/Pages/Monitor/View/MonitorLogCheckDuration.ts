import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorEvaluationTime from "Common/Utils/Monitor/MonitorEvaluationTime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import {
  getSlowEvaluationWords,
  SlowEvaluationWords,
} from "../../../Components/Monitor/SummaryView/SlowEvaluationWords";

/*
 * HOW LONG EACH CHECK TOOK, IN A MONITOR'S MONITORING LOGS (#10842).
 *
 * Since #10317 each check's log entry says how long its evaluation took and
 * how often its monitor is checked (evaluationSummary.durationInMs and
 * intervalInMs, in the logBody the table already reads), and the check's
 * summary warns when that was too long for its monitor. The summary is read
 * one check at a time, so an owner who wanted to see whether a monitor's
 * checks were growing, or which were slow, had to open every row.
 *
 * The Check Duration column says it for every row, and marks a slow one by
 * the rule the summary warns by (MonitorEvaluationTime.isSlow), with the
 * summary's words for why when a person points at the mark. An entry logged
 * before its time was kept says nothing: the quiet dash.
 */

export interface MonitorLogCheckDuration {
  // How long the check took, in the reader's language: "820 ms", "2.4 s".
  duration: string;
  // Too long for its monitor, by the rule its summary warns by.
  isSlow: boolean;
  // Why that is slow, as the summary says it. Only for a slow check.
  slowReason?: string | undefined;
}

// A check's evaluation summary, from its monitor log entry's logBody.
export function getEvaluationSummaryOfLogBody(
  logBody: unknown,
): MonitorEvaluationSummary | undefined {
  if (!logBody || typeof logBody !== "object") {
    return undefined;
  }

  const summary: unknown = (logBody as { evaluationSummary?: unknown })
    .evaluationSummary;

  return summary && typeof summary === "object"
    ? (summary as MonitorEvaluationSummary)
    : undefined;
}

/*
 * How long the check behind a monitor log entry took, or null for an entry
 * that does not say: one logged before its time was kept, or one whose
 * time cannot be read.
 */
export function getMonitorLogCheckDuration(
  translator: Translator,
  logBody: unknown,
): MonitorLogCheckDuration | null {
  const summary: MonitorEvaluationSummary | undefined =
    getEvaluationSummaryOfLogBody(logBody);
  const durationInMs: unknown = summary?.durationInMs;

  if (
    !summary ||
    typeof durationInMs !== "number" ||
    !Number.isFinite(durationInMs) ||
    durationInMs < 0
  ) {
    return null;
  }

  const duration: string = MonitorEvaluationTime.formatDuration(
    translator,
    durationInMs,
  );

  if (!MonitorEvaluationTime.isSlow(summary)) {
    return { duration: duration, isSlow: false };
  }

  const words: SlowEvaluationWords = getSlowEvaluationWords(
    translator,
    summary,
  );

  return {
    duration: duration,
    isSlow: true,
    // One paragraph, run together the way the reader's script writes one.
    slowReason: joinSentences([words.why, words.howToSpeedUp || ""]),
  };
}

// What the cell says, and what the CSV export writes: "2.4 s", "25 s (slow)".
export function getMonitorLogCheckDurationText(
  translator: Translator,
  check: MonitorLogCheckDuration,
): string {
  return check.isSlow
    ? translator.translateTemplate("{{duration}} (slow)", {
        duration: check.duration,
      })
    : check.duration;
}
