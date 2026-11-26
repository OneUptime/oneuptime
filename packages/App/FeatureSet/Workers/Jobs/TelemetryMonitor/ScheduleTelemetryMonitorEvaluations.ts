import RunCron from "../../Utils/Cron";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { enqueueDueTelemetryMonitorEvaluationJobs } from "./MonitorTelemetryMonitor";

/*
 * Every 10 seconds (TELEMETRY_SCHEDULE_TICK_MS): each run queues the
 * evaluations due before the next, each at its own moment of its monitor's
 * interval, so they start spread over the minute (issue #11060). It ran once
 * a minute, and queued every evaluation of the minute at its start.
 */
RunCron(
  "TelemetryMonitor:MonitorTelemetryMonitor",
  { schedule: EVERY_TEN_SECONDS, runOnStartup: false },
  enqueueDueTelemetryMonitorEvaluationJobs,
);
