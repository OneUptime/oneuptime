import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { enqueueDueTelemetryMonitorEvaluationJobs } from "./MonitorTelemetryMonitor";

RunCron(
  "TelemetryMonitor:MonitorTelemetryMonitor",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  enqueueDueTelemetryMonitorEvaluationJobs,
);
