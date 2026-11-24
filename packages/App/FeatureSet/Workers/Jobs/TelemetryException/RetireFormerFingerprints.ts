import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import FormerExceptionFingerprints, {
  FormerFingerprintsRetired,
} from "Common/Server/Utils/Telemetry/FormerExceptionFingerprints";

// How long a run reads, at most; what is left waits for the next one.
const RETIRE_FORMER_FINGERPRINTS_TIME_BUDGET_MS: number = 10 * 60 * 1000;

/*
 * Deletes the rows that keep an exception's former fingerprint once no
 * occurrence carries it any more - past the retention of those recorded
 * before the exception moved to a private fingerprint - so the unkeyed
 * fingerprint is gone from Postgres too (FormerExceptionFingerprints,
 * #10619). Daily, a bounded amount of work a run.
 */
RunCron(
  "TelemetryException:RetireFormerFingerprints",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: RETIRE_FORMER_FINGERPRINTS_TIME_BUDGET_MS + 5 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    const retired: FormerFingerprintsRetired =
      await FormerExceptionFingerprints.retireUncarried({
        deadline: deadline,
        timeBudgetMs: RETIRE_FORMER_FINGERPRINTS_TIME_BUDGET_MS,
      });

    if (retired.retired > 0) {
      logger.info(
        `Deleted ${retired.retired} of ${retired.read} former exception fingerprints no occurrence carries any more.`,
      );
    }
  },
);
