import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityLogScanner, {
  SECURITY_LOG_SCAN_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";

/*
 * "Your logs" tick. Each run pages through every project that turned it on
 * and queues one turn for each. A turn reads the logs that arrived since
 * the project's last scan for the security records OneUptime recognizes,
 * and stores each as a security event for the detection rules to read.
 */
RunCron(
  "SecurityEvents:ScanLogsForSecurityEvents",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityLogScanner.enqueueProjectsWithEnabledSources();
  },
);

export const scanProjectLogsForSecurityEvents: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  SECURITY_LOG_SCAN_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return SecurityLogScanner.scanProject(projectId, lease);
  },
);
