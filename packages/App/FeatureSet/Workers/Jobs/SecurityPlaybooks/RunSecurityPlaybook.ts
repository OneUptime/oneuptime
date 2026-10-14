import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import SecurityPlaybookEngine, {
  SECURITY_PLAYBOOK_RUN_JOB,
  SECURITY_PLAYBOOK_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";

/*
 * One playbook run's turn, queued by SecurityPlaybookEngine.enqueueRun when
 * a run is started and again after each approval. The engine claims the run
 * itself (Queued to Running in one compare-and-set), so a job that arrives
 * twice runs it once, and records every failure on the run.
 */
export async function runSecurityPlaybook(job?: QueueJob): Promise<void> {
  const runId: unknown = job?.data?.["runId"];

  if (typeof runId !== "string" || !ObjectID.isValidUUID(runId)) {
    throw new BadDataException("A valid security playbook run ID is required.");
  }

  await SecurityPlaybookEngine.executeRun(new ObjectID(runId));
}

JobDictionary.setJobFunction(SECURITY_PLAYBOOK_RUN_JOB, runSecurityPlaybook);
JobDictionary.setTimeoutInMs(
  SECURITY_PLAYBOOK_RUN_JOB,
  SECURITY_PLAYBOOK_RUN_TIMEOUT_MS,
);
