import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SecurityEntityRiskRecorder from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SECURITY_ENTITY_RISK_RECOMPUTE_JOB } from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskJobs";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * Entity risk falls as its sources go quiet: a source that has said nothing
 * about an entity for a week stops counting (SecurityEntityRisk). Findings
 * raise a score as they arrive; this lowers it on time, every fifteen
 * minutes, for the entities whose next source has just stopped counting, and
 * forgets the ones quiet for a month.
 */
RunCron(
  "SecurityEntityRisk:Refresh",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityEntityRiskRecorder.refreshDue();
  },
);

/*
 * A project's Entity Criticality list changed: every entity's risk is
 * weighed again by how much it matters now.
 */
export async function recomputeProjectEntityRisk(
  job?: QueueJob,
): Promise<void> {
  const data: JSONObject = (job?.data || {}) as JSONObject;
  const projectId: unknown = data["projectId"];

  if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
    return;
  }

  await SecurityEntityRiskRecorder.refreshProject({
    projectId: new ObjectID(projectId),
    isWhole: true,
  });
}

JobDictionary.setJobFunction(
  SECURITY_ENTITY_RISK_RECOMPUTE_JOB,
  recomputeProjectEntityRisk,
);
