import JobDictionary, { WorkerJobFunction } from "./JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import SecurityProjectWork, {
  SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS,
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  SecurityProjectWorkOutcome,
} from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";

/*
 * Registers the queue job that does one project's turn of a security
 * pipeline (SecurityProjectWork): the cron beside it queues one per project
 * with work due, and this runs it under the project's lease and a permit.
 */
export default function registerSecurityProjectJob(
  work: SecurityProjectWorkDefinition,
  turn: (projectId: ObjectID, lease: SecurityProjectWorkLease) => Promise<void>,
): WorkerJobFunction {
  const runTurn: WorkerJobFunction = async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID = SecurityProjectWork.projectIdOfJob(job);

    const outcome: SecurityProjectWorkOutcome =
      await SecurityProjectWork.runForProject(
        work,
        projectId,
        (lease: SecurityProjectWorkLease): Promise<void> => {
          return turn(projectId, lease);
        },
      );

    if (outcome !== "Done") {
      logger.debug(
        `${work.jobName}: project ${projectId.toString()} skipped this minute (${outcome}).`,
      );
    }
  };

  JobDictionary.setJobFunction(work.jobName, runTurn);
  JobDictionary.setTimeoutInMs(
    work.jobName,
    SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS,
  );

  return runTurn;
}
