import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SecurityCaseNotifications, {
  SECURITY_CASE_NOTIFICATION_JOB,
} from "Common/Server/Utils/SecurityCase/SecurityCaseNotifications";
import { JSONObject } from "Common/Types/JSON";

/*
 * One security case notification, queued by the case's service, the
 * detection ingest's case writes and the playbook engine: a case at somebody's
 * chosen priority, a case assigned, a playbook step waiting for approval
 * (SecurityCaseNotifications). A job that arrives twice for one rise of a
 * case tells people once: the case's notified priority
 * (notifiedSecurityCasePriorityId) is claimed in one compare-and-set.
 */
export async function sendSecurityCaseNotification(
  job?: QueueJob,
): Promise<void> {
  await SecurityCaseNotifications.runJob((job?.data || {}) as JSONObject);
}

JobDictionary.setJobFunction(
  SECURITY_CASE_NOTIFICATION_JOB,
  sendSecurityCaseNotification,
);
