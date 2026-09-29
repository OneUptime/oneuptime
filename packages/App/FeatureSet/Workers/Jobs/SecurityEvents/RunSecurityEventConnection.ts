import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { redactLogString } from "Common/Server/Utils/LogRedaction";
import ConnectorErrorMessage from "Common/Server/Utils/SecurityEvent/ConnectorErrorMessage";
import SecurityEventConnectionRunExecutor, {
  SECURITY_EVENT_CONNECTION_RUN_JOB,
  SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
} from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";

export async function runSecurityEventConnection(
  job?: QueueJob,
): Promise<void> {
  const runId: unknown = job?.data?.["runId"];

  if (typeof runId !== "string" || !ObjectID.isValidUUID(runId)) {
    throw new BadDataException(
      "A valid security event connection operation ID is required.",
    );
  }

  try {
    await SecurityEventConnectionRunExecutor.executeRun(new ObjectID(runId));
  } catch (error) {
    /*
     * executeRun records failures it can see. An exception escaping it (the
     * run lock timed out, the database was unreachable while reading the run)
     * would leave the row "queued" until the stale sweep blames worker
     * health, so on the LAST attempt the real reason lands on the row before
     * BullMQ marks the job failed. Earlier attempts rethrow so BullMQ retries.
     */
    const attempts: number = Number(job?.opts?.attempts || 1);
    const attemptsMade: number = Number(job?.attemptsMade || 0) + 1;

    if (attemptsMade >= attempts) {
      try {
        await SecurityEventConnectionRunExecutor.markRunFailed(
          new ObjectID(runId),
          redactLogString(ConnectorErrorMessage.toMessage(error)),
        );
      } catch (recordError) {
        logger.error(
          "RunSecurityEventConnection: could not record the job failure on the run.",
        );
        logger.error(recordError);
      }
    }

    throw error;
  }
}

JobDictionary.setJobFunction(
  SECURITY_EVENT_CONNECTION_RUN_JOB,
  runSecurityEventConnection,
);
JobDictionary.setTimeoutInMs(
  SECURITY_EVENT_CONNECTION_RUN_JOB,
  SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS,
);
