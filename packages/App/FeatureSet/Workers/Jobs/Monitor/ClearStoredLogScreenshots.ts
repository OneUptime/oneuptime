import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import StoredLogScreenshots, {
  CLEAR_TIME_BUDGET_MS,
  StoredLogScreenshotsSummary,
  formatStoredBytes,
} from "Common/Server/Utils/Retention/StoredLogScreenshots";
import logger from "Common/Server/Utils/Logger";

/*
 * Clears the Synthetic monitor screenshots that incidents, alerts and
 * monitor status changes kept with the check that opened or changed them,
 * before they stopped keeping them (issues #6903, #6942): megabytes a row,
 * which nothing showed, and which grew one installation's database to 27
 * GB. Each table is walked once; a row keeps everything but its
 * screenshots. See StoredLogScreenshots for what is cleared, how, and why.
 *
 * Hourly, a bounded amount of work a run, until every table's walk is done,
 * and from then on one read a run. The timeout leaves the last write room to
 * finish after the run's own budget is spent; the run stops at its deadline
 * too - its time limit, or its lock lost.
 */
RunCron(
  "Monitor:ClearStoredLogScreenshots",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: CLEAR_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run({ deadline: deadline });

      if (
        summary.rowsCleared === 0 &&
        summary.rowsTooBigToRead === 0 &&
        summary.finishedTables.length === 0 &&
        summary.failedRows === 0 &&
        summary.failedTables === 0
      ) {
        return;
      }

      const parts: Array<string> = [
        `cleared the Synthetic monitor screenshots kept in ${summary.rowsCleared} stored ${summary.rowsCleared === 1 ? "log" : "logs"} (${formatStoredBytes(summary.storedBytesCleared)} as stored)`,
      ];

      if (summary.rowsTooBigToRead > 0) {
        parts.push(
          `${summary.rowsTooBigToRead} ${summary.rowsTooBigToRead === 1 ? "log was" : "logs were"} too big to read and ${summary.rowsTooBigToRead === 1 ? "is" : "are"} left as ${summary.rowsTooBigToRead === 1 ? "it is" : "they are"}`,
        );
      }

      if (summary.finishedTables.length > 0) {
        parts.push(
          `${summary.finishedTables.join(", ")} ${summary.finishedTables.length === 1 ? "is" : "are"} done and not read again`,
        );
      }

      if (summary.failedRows > 0) {
        parts.push(
          `${summary.failedRows} ${summary.failedRows === 1 ? "row" : "rows"} failed and ${summary.failedRows === 1 ? "is" : "are"} tried again next run`,
        );
      }

      if (summary.failedTables > 0) {
        parts.push(
          `${summary.failedTables} ${summary.failedTables === 1 ? "table" : "tables"} failed and ${summary.failedTables === 1 ? "is" : "are"} tried again next run`,
        );
      }

      if (summary.isCutShort) {
        parts.push("the rest wait for the next run");
      }

      logger.info(`Stored log screenshots: ${parts.join("; ")}.`);
    } catch (error) {
      logger.error(
        "Stored log screenshots: clearing the screenshots kept in stored logs failed. It is tried again next run.",
      );
      logger.error(error);
    }
  },
);
