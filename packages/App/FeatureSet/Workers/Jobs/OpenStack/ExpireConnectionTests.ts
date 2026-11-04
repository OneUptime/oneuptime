import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import OpenStackCloudConnectionTestService from "Common/Server/Services/OpenStackCloudConnectionTestService";

/*
 * ------------------------------------------------------------------
 * OpenStack:ExpireConnectionTests
 *
 * Every minute, answer the cloud connection tests no probe will answer: one still
 * waiting after OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS (its probe is
 * offline, or older than OpenStack collection) and one running past
 * OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS. Each becomes Failed with the reason,
 * and any secret still on it is wiped, so the dashboard's "Test connection" always ends
 * with an answer, and no secret waits in the table for a probe that is not coming.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "OpenStack:ExpireConnectionTests";

RunCron(
  JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      await OpenStackCloudConnectionTestService.expireStaleTests();
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
