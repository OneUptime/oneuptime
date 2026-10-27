import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityTelemetryScanner, {
  SECURITY_TELEMETRY_SCAN_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/TelemetryScan/SecurityTelemetryScanner";

/*
 * "Your OneUptime data" tick. Each run pages through every project that
 * turned on a telemetry source - traces, network flows, the audit log,
 * session replays - and queues one turn for each. A turn reads what arrived
 * of each kind since the project's last scan for what an attack leaves in
 * it, and stores each finding as a security event for the detection rules
 * to read.
 */
RunCron(
  "SecurityEvents:ScanTelemetryForSecurityEvents",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityTelemetryScanner.enqueueProjectsWithEnabledSources();
  },
);

export const scanProjectTelemetryForSecurityEvents: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  SECURITY_TELEMETRY_SCAN_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return SecurityTelemetryScanner.scanProject(projectId, lease);
  },
);
