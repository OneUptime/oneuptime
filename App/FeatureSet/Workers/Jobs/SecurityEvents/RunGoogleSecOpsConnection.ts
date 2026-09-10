import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import GoogleSecOpsRunExecutor, {
  GOOGLE_SECOPS_RUN_JOB,
  GOOGLE_SECOPS_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";

export async function runGoogleSecOpsConnection(job?: QueueJob): Promise<void> {
  const runId: unknown = job?.data?.["runId"];
  if (typeof runId !== "string" || !ObjectID.isValidUUID(runId)) {
    throw new BadDataException(
      "A valid Google SecOps operation ID is required.",
    );
  }
  await GoogleSecOpsRunExecutor.executeRun(new ObjectID(runId));
}

JobDictionary.setJobFunction(GOOGLE_SECOPS_RUN_JOB, runGoogleSecOpsConnection);
JobDictionary.setTimeoutInMs(
  GOOGLE_SECOPS_RUN_JOB,
  GOOGLE_SECOPS_RUN_TIMEOUT_MS,
);
