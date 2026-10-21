import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityEventForwarder, {
  SECURITY_EVENT_FORWARD_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/Destinations/SecurityEventForwarder";

/*
 * Security Event Destinations tick. Each run pages through every enabled
 * destination and queues one turn for each project that has one. A turn
 * sends each of the project's destinations (Google SecOps...) the security
 * events that arrived since its cursor; a destination whose SIEM does not
 * answer keeps its place and is tried again on the next run.
 */
RunCron(
  "SecurityEvents:ForwardSecurityEvents",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityEventForwarder.enqueueProjectsWithEnabledDestinations();
  },
);

export const forwardProjectSecurityEvents: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  SECURITY_EVENT_FORWARD_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return SecurityEventForwarder.forwardProject(projectId, lease);
  },
);
