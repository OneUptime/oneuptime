import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SecurityCaseSourceAlerts, {
  SECURITY_CASE_SOURCE_ALERTS_JOB,
} from "Common/Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import { JSONObject } from "Common/Types/JSON";

/*
 * A closed security case's alerts, closed in the products they came from
 * (SecurityCaseSourceAlerts): first which connections they came from, then
 * one job per connection, which the queue tries again with backoff while
 * its product is rate limited or unreachable. The case's timeline says what
 * happened once, on the try that settles it.
 */
export async function closeSecurityCaseSourceAlerts(
  job?: QueueJob,
): Promise<void> {
  const attempts: number = Math.max(1, Number(job?.opts?.attempts) || 1);
  const attemptsMade: number = Math.max(0, Number(job?.attemptsMade) || 0);

  await SecurityCaseSourceAlerts.runJob((job?.data || {}) as JSONObject, {
    isLastAttempt: attemptsMade + 1 >= attempts,
  });
}

JobDictionary.setJobFunction(
  SECURITY_CASE_SOURCE_ALERTS_JOB,
  closeSecurityCaseSourceAlerts,
);
