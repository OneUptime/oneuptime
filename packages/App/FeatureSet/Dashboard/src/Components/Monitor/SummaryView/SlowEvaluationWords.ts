import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorEvaluationTime from "Common/Utils/Monitor/MonitorEvaluationTime";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY AN EVALUATION IS SLOW, IN THE READER'S WORDS (#10317, #10842).
 *
 * An evaluation is slow once it takes more than a tenth of its monitor's
 * interval, never under 5 seconds and always past a minute
 * (MonitorEvaluationTime.isSlow). Two places say so, in the same words:
 *
 *   - a check's summary (EvaluationLogList), under "This evaluation took
 *     {{duration}}", on View Summary and on the monitor's Overview;
 *   - the slow mark in the monitor's Monitoring Logs, when a person points
 *     at it (Pages/Monitor/View/MonitorLogCheckDuration).
 *
 * Kept here so the two never say it differently.
 */

// Why one evaluated as its results arrive is slow: it holds up the next.
const WHY_WITHOUT_AN_INTERVAL: string = translationKey(
  "That is a lot for one evaluation: if its evaluations keep growing, each will hold up the next.",
);

export interface SlowEvaluationWords {
  /*
   * Why that is a lot: weighed against how often the monitor is checked,
   * or, for one evaluated as its results arrive, against the next one.
   */
  why: string;
  // What makes it faster, for a check split into series.
  howToSpeedUp?: string | undefined;
}

// How often the summary's monitor is checked, when it runs on a schedule.
export function getIntervalInMs(
  summary: Pick<MonitorEvaluationSummary, "intervalInMs">,
): number | undefined {
  return typeof summary.intervalInMs === "number" && summary.intervalInMs > 0
    ? summary.intervalInMs
    : undefined;
}

// How many series the summary's check judged, for a check split into series.
export function getSeriesJudged(
  summary: Pick<MonitorEvaluationSummary, "seriesJudged">,
): number | undefined {
  return typeof summary.seriesJudged === "number" && summary.seriesJudged >= 0
    ? summary.seriesJudged
    : undefined;
}

export function getSlowEvaluationWords(
  translator: Translator,
  summary: Pick<MonitorEvaluationSummary, "intervalInMs" | "seriesJudged">,
): SlowEvaluationWords {
  const intervalInMs: number | undefined = getIntervalInMs(summary);
  const seriesJudged: number | undefined = getSeriesJudged(summary);

  return {
    why:
      intervalInMs !== undefined
        ? translator.translateTemplate(
            "That is a lot for a monitor checked every {{interval}}: if its evaluations keep growing, its checks will fall behind.",
            {
              interval: MonitorEvaluationTime.formatDuration(
                translator,
                intervalInMs,
              ),
            },
          )
        : translator.translateText(WHY_WITHOUT_AN_INTERVAL) ||
          WHY_WITHOUT_AN_INTERVAL,
    howToSpeedUp:
      seriesJudged !== undefined
        ? translator.translatePlural(
            {
              one: "It judged {{count}} series. To make it faster, narrow its filters or group by fewer attributes.",
              other:
                "It judged {{count}} series. To make it faster, narrow its filters or group by fewer attributes.",
            },
            seriesJudged,
          )
        : undefined,
  };
}
