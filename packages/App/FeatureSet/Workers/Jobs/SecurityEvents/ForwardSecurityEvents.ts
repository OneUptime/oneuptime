import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityEventForwarder from "Common/Server/Utils/SecurityEvent/Destinations/SecurityEventForwarder";

/*
 * Security Event Destinations tick. Each run sends every enabled
 * destination (Google SecOps...) the security events that arrived since its
 * cursor; a destination whose SIEM does not answer keeps its place and is
 * tried again on the next run.
 */
RunCron(
  "SecurityEvents:ForwardSecurityEvents",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityEventForwarder.forwardAllEnabled();
  },
);
