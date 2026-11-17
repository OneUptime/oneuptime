import RunCron from "../../Utils/Cron";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import OversizedStoredChecks, {
  OversizedStoredChecksSummary,
  TRIM_TIME_BUDGET_MS,
} from "Common/Server/Utils/Retention/OversizedStoredChecks";
import { formatStoredBytes } from "Common/Server/Utils/Retention/StoredLogScreenshots";
import logger from "Common/Server/Utils/Logger";

/*
 * Trims the checks a grouped monitor's alerts, incidents and status changes
 * kept before stored checks were bounded (issues #9189, #9232): the whole
 * evaluation, every series of every query, up to 95 MB of JSON a row. Each
 * table is walked once; a row keeps its own series and its small fields,
 * trimmed in Postgres one row at a time. See OversizedStoredChecks for what
 * is kept, how, and the bounds.
 *
 * Hourly, a bounded amount of work a run, until every table's walk is done,
 * and from then on one read a run. The timeout leaves the last trim room to
 * finish after the run's own budget is spent; the run stops at its deadline
 * too - its time limit, or its lock lost.
 */
RunCron(
  "Monitor:TrimOversizedStoredChecks",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: TRIM_TIME_BUDGET_MS + 2 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run({ deadline: deadline });

      const rowsWritten: number =
        summary.rowsTrimmed + summary.rowsReplacedByMarkers;

      if (
        rowsWritten === 0 &&
        summary.finishedTables.length === 0 &&
        summary.failedRows === 0 &&
        summary.failedTables === 0
      ) {
        return;
      }

      const parts: Array<string> = [
        `trimmed ${rowsWritten} oversized stored ${rowsWritten === 1 ? "check" : "checks"} (${formatStoredBytes(summary.storedBytesBefore)} as stored before, ${formatStoredBytes(summary.storedBytesAfter)} after)`,
      ];

      if (summary.rowsReplacedByMarkers > 0) {
        parts.push(
          `${summary.rowsReplacedByMarkers} of them could not be trimmed within the database's limits and ${summary.rowsReplacedByMarkers === 1 ? "keeps" : "keep"} only a note that ${summary.rowsReplacedByMarkers === 1 ? "it was" : "they were"} trimmed`,
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

      logger.info(`Oversized stored checks: ${parts.join("; ")}.`);
    } catch (error) {
      logger.error(
        "Oversized stored checks: trimming the oversized checks kept before they were bounded failed. It is tried again next run.",
      );
      logger.error(error);
    }
  },
);
