import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import TelemetryUsageBillingService from "Common/Server/Services/TelemetryUsageBillingService";
import logger from "Common/Server/Utils/Logger";

/*
 * Retention for the daily telemetry usage rows (TelemetryUsageBilling): the
 * days past the instance's telemetry usage retention (Admin Dashboard >
 * Settings > Data Retention, 120 days unless changed) are deleted, with
 * billing on or off. Never inside metering's one-week catch-up, whatever is
 * saved: TelemetryUsageBillingService.deleteUsageOlderThanRetention.
 */
export const DELETE_OLD_TELEMETRY_USAGE_JOB_NAME: string =
  "TelemetryUsage:DeleteOldTelemetryUsage";

RunCron(
  DELETE_OLD_TELEMETRY_USAGE_JOB_NAME,
  { schedule: EVERY_DAY, runOnStartup: false },
  async () => {
    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    logger.debug(
      `${DELETE_OLD_TELEMETRY_USAGE_JOB_NAME}: deleted ${result.deleted} usage row(s) of the days before ${result.cutoff.toISOString()} (kept ${result.retentionInDays} days).`,
    );
  },
);
