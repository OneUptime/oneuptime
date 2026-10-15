import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import DiscoveryImportRunner, {
  DISCOVERY_IMPORT_JOB,
  DISCOVERY_IMPORT_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/NetworkDiscovery/DiscoveryImportRunner";

/*
 * Runs a project's imports of discovered hosts (Network > Discovery > Review
 * Results > Import), oldest first, until none is waiting. The job carries the
 * project's id only; each import says what it is importing and as whom. The
 * queue keeps one job per project waiting at most, so a project's imports
 * run one after another, never side by side (DiscoveryImportRunner).
 */
export async function runDiscoveryImports(job?: QueueJob): Promise<void> {
  const projectId: unknown = job?.data?.["projectId"];

  if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
    throw new BadDataException("A valid project ID is required.");
  }

  await DiscoveryImportRunner.runProjectImports(new ObjectID(projectId));
}

JobDictionary.setJobFunction(DISCOVERY_IMPORT_JOB, runDiscoveryImports);
JobDictionary.setTimeoutInMs(
  DISCOVERY_IMPORT_JOB,
  DISCOVERY_IMPORT_JOB_TIMEOUT_MS,
);
