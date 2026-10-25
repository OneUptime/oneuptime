import Queue, { QueueName } from "../../../Infrastructure/Queue";
import logger from "../../Logger";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The queue job that works one project's entity risk out again, whole: run
 * when the project's Entity Criticality list changes, since how much an
 * entity matters weighs its whole score. The Workers' job
 * (Jobs/SecurityEvents/EntityRisk.ts) runs it; a project changing several
 * entries at once queues one, with the latest asked for kept.
 */
export const SECURITY_ENTITY_RISK_RECOMPUTE_JOB: string =
  "SecurityEntityRisk:RecomputeProject";

export async function queueSecurityEntityRiskRecompute(
  projectId: ObjectID,
): Promise<void> {
  try {
    await Queue.addJob(
      QueueName.Worker,
      `security-entity-risk-recompute-${projectId.toString()}-${ObjectID.generate().toString()}`,
      SECURITY_ENTITY_RISK_RECOMPUTE_JOB,
      { projectId: projectId.toString() },
      {
        deduplication: {
          id: `security-entity-risk-recompute-${projectId.toString()}`,
          keepLastIfActive: true,
        },
        removeWhenDone: true,
      },
    );
  } catch (error) {
    // Best effort: the hourly refresh weighs every entity it touches anew.
    logger.error(
      `SecurityEntityRisk: could not queue the recompute of project ${projectId.toString()}'s entity risk:`,
    );
    logger.error(error);
  }
}
