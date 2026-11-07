import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import CloudStreamReader, {
  CLOUD_STREAM_READ_JOB,
  CLOUD_STREAM_READ_JOB_TIMEOUT_MS,
  CloudStreamReadOutcome,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import AzureEventHubsIngestService from "../../../Telemetry/Services/AzureEventHubsIngestService";

/*
 * Azure connections that stream (Cloud > Connect, Stream metrics and
 * logs): every minute, queue a read of each one's event hubs; each read
 * runs as a job of its own, one per connection at a time
 * (CloudStreamReader). What it reads is queued as the connection's
 * project's metrics and logs (AzureEventHubsIngestService), exactly as an
 * OTLP export is.
 */

export async function runCloudStreamRead(job?: QueueJob): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException("A valid cloud connection ID is required.");
  }

  const outcome: CloudStreamReadOutcome = await CloudStreamReader.readAzure(
    new ObjectID(connectionId),
    {
      deliver: AzureEventHubsIngestService.deliver,
    },
  );

  // What it read is on the connection; the log line names no cloud data.
  logger.debug(
    `${CLOUD_STREAM_READ_JOB} ${connectionId}: ${outcome.status}, ${outcome.events} events`,
  );
}

JobDictionary.setJobFunction(CLOUD_STREAM_READ_JOB, runCloudStreamRead);
JobDictionary.setTimeoutInMs(
  CLOUD_STREAM_READ_JOB,
  CLOUD_STREAM_READ_JOB_TIMEOUT_MS,
);

RunCron(
  "CloudStream:ReadDueEventHubs",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 60 * 1000,
  },
  async () => {
    await CloudStreamReader.enqueueDue(new Date());
  },
);
