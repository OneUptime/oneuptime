import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import MoveChartsAndSlosOffRetiredCloudMetrics from "../../DataMigrations/MoveChartsAndSlosOffRetiredCloudMetrics";
import MoveMonitorsOffRetiredCloudMetrics from "../../DataMigrations/MoveMonitorsOffRetiredCloudMetrics";

/*
 * ------------------------------------------------------------------
 * Cloud:MoveOffRetiredCloudMetrics
 *
 * Once an hour, every Metrics monitor, dashboard widget and SLO still on
 * a metric its cloud deprecates (Cosmos DB's ServerSideLatency, Pub/Sub's
 * send_message_operation_count) is moved again where it now can be, by the
 * migrations' own rules and compare-and-set (#9739's gap, #9980): a Cosmos
 * DB account that reported neither latency when they ran - idle, or new -
 * moves to the one it reports now, and its monitor's feed says so. Until
 * then, its connection keeps reading the old metric for it
 * (CloudRetiredMetricReads), so nothing is left with nothing new to judge.
 * A query nothing can move (one of a response code) stays, as it is told
 * once; the job tells only what it moves.
 * ------------------------------------------------------------------
 */

export const MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME: string =
  "Cloud:MoveOffRetiredCloudMetrics";

/*
 * A run reads every row that still names a deprecated metric and, for a
 * Cosmos DB one, what its account reported lately: more than the default
 * five minutes on an install with many of them.
 */
export const MOVE_OFF_RETIRED_CLOUD_METRICS_TIMEOUT_MS: number = 30 * 60 * 1000;

export async function moveOffRetiredCloudMetrics(): Promise<void> {
  try {
    await MoveMonitorsOffRetiredCloudMetrics.moveAll({ tellKept: false });
  } catch (err) {
    logger.error(
      `${MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME}: monitors: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await MoveChartsAndSlosOffRetiredCloudMetrics.moveAll({ tellKept: false });
  } catch (err) {
    logger.error(
      `${MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME}: dashboards and SLOs: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

RunCron(
  MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME,
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: MOVE_OFF_RETIRED_CLOUD_METRICS_TIMEOUT_MS,
  },
  moveOffRetiredCloudMetrics,
);
