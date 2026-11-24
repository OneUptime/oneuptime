import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import { SECURITY_BLOCKLIST_RECONCILE_JOB } from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlocklistReconciler from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";

/*
 * One project's blocklist reconciled (#10338), queued when one of its
 * blocks changes and by the every-minute pass (SecurityBlocklistJobs). Each
 * destination is reconciled under its own lock, so a job that arrives twice
 * writes each destination once at a time, and a destination that fails says
 * so on its blocks and is tried again later.
 */
export async function runSecurityBlocklistReconcile(
  job?: QueueJob,
): Promise<void> {
  const projectId: unknown = job?.data?.["projectId"];

  if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
    throw new BadDataException("A valid project ID is required.");
  }

  await SecurityBlocklistReconciler.reconcileProject({
    projectId: new ObjectID(projectId),
  });
}

JobDictionary.setJobFunction(
  SECURITY_BLOCKLIST_RECONCILE_JOB,
  runSecurityBlocklistReconcile,
);
