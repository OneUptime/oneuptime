import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import StorageArrayConnectionTestService from "Common/Server/Services/StorageArrayConnectionTestService";

/*
 * ------------------------------------------------------------------
 * StorageArray:ExpireConnectionTests
 *
 * Every minute, answer the storage array connection tests (#11004) no
 * probe will answer: one still waiting after
 * STORAGE_ARRAY_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS (its probe is
 * offline, or older than storage array collection) and one running past
 * STORAGE_ARRAY_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS. Each becomes Failed
 * with the reason, and any password still on it is wiped - so the Connect
 * form's "Test connection" always ends with an answer, and no password
 * waits in the table for a probe that is not coming.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "StorageArray:ExpireConnectionTests";

RunCron(
  JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      await StorageArrayConnectionTestService.expireStaleTests();
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
