import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ToolImportRunExecutor, {
  TOOL_IMPORT_RUN_JOB,
  TOOL_IMPORT_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/ToolImport/ToolImportRunExecutor";

/*
 * One step of an import from another tool (Project Settings > Import from
 * another tool): reading the tool, or importing what the person ticked. The
 * job carries the run's id only; the run itself says which step is due
 * (ToolImportRunExecutor.executeRun). Queued once, never retried by the
 * queue: a read failed is read again by the person (with the key again), and
 * an import never runs twice on its own.
 */
export async function runToolImport(job?: QueueJob): Promise<void> {
  const runId: unknown = job?.data?.["runId"];

  if (typeof runId !== "string" || !ObjectID.isValidUUID(runId)) {
    throw new BadDataException("A valid import ID is required.");
  }

  await ToolImportRunExecutor.executeRun(new ObjectID(runId));
}

JobDictionary.setJobFunction(TOOL_IMPORT_RUN_JOB, runToolImport);
JobDictionary.setTimeoutInMs(TOOL_IMPORT_RUN_JOB, TOOL_IMPORT_RUN_TIMEOUT_MS);
