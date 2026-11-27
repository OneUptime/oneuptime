import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import XcpNgConnectionTestService from "Common/Server/Services/XcpNgConnectionTestService";

/*
 * ------------------------------------------------------------------
 * XcpNg:ExpireConnectionTests
 *
 * Every minute, answer the XCP-ng connection tests no probe will answer:
 * one still waiting after XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS
 * (its probe is offline, or older than XCP-ng collection) and one running
 * past XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS. Each becomes Failed
 * with the reason, and any secret still on it is wiped - so "Test
 * connection" always ends with an answer, and no secret waits in the table
 * for a probe that is not coming. A vCenter's tests are answered the same
 * way (VMware:ExpireConnectionTests).
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "XcpNg:ExpireConnectionTests";

RunCron(
  JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      await XcpNgConnectionTestService.expireStaleTests();
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
