import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityLogScanner from "Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";

/*
 * "Your logs" tick. Each run reads, for every project that turned it on,
 * the logs that arrived since the last scan for the security records
 * OneUptime recognizes, and stores each as a security event for the
 * detection rules to read.
 */
RunCron(
  "SecurityEvents:ScanLogsForSecurityEvents",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityLogScanner.scanAllEnabled();
  },
);
