import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SecurityHuntNotifications, {
  SECURITY_HUNT_NOTIFICATION_JOB,
} from "Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import { JSONObject } from "Common/Types/JSON";

/*
 * What a scheduled hunt found, told to the people and teams it names
 * (SecurityHuntNotifications). Queued by a run whose record held
 * (SecurityHuntScheduler), so a window is told about once.
 */
export async function sendSecurityHuntNotification(
  job?: QueueJob,
): Promise<void> {
  await SecurityHuntNotifications.runJob((job?.data || {}) as JSONObject);
}

JobDictionary.setJobFunction(
  SECURITY_HUNT_NOTIFICATION_JOB,
  sendSecurityHuntNotification,
);
