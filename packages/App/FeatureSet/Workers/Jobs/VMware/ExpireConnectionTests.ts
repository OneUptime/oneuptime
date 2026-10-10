import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import VMwareVCenterConnectionTestService from "Common/Server/Services/VMwareVCenterConnectionTestService";

/*
 * ------------------------------------------------------------------
 * VMware:ExpireConnectionTests
 *
 * Every minute, answer the vCenter connection tests no probe will answer:
 * one still waiting after VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS
 * (its probe is offline, or older than VMware collection) and one running
 * past VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS. Each becomes Failed
 * with the reason, and any password still on it is wiped - so the
 * dashboard's "Test connection" always ends with an answer, and no password
 * waits in the table for a probe that is not coming.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "VMware:ExpireConnectionTests";

RunCron(
  JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      await VMwareVCenterConnectionTestService.expireStaleTests();
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
