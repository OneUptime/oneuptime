import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import XcpNgApiTokenExpiry from "Common/Server/Utils/XcpNg/XcpNgApiTokenExpiry";

/*
 * ------------------------------------------------------------------
 * XcpNg:WarnExpiringApiTokens
 *
 * Every hour, warn about the Xen Orchestra API tokens that expire within
 * two weeks (XCP_NG_API_TOKEN_WARNING_DAYS): once per token, on the feed of
 * every pool read through its connection, with how to make a new one
 * (XcpNgApiTokenExpiry). Hourly, so a token whose expiry the probe reads
 * for the first time already inside the window is warned about the same
 * day.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "XcpNg:WarnExpiringApiTokens";

RunCron(
  JOB_NAME,
  { schedule: EVERY_HOUR, runOnStartup: false },
  async (): Promise<void> => {
    try {
      await XcpNgApiTokenExpiry.warnExpiringTokens();
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
