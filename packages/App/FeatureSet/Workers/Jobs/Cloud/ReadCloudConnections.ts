import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import CloudConnectionPullRunner, {
  CloudConnectionPullOutcome,
} from "Common/Server/Utils/CloudConnection/CloudConnectionPullRunner";
import CloudConnectionScheduler, {
  CLOUD_CONNECTION_PULL_JOB,
  CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/CloudConnection/CloudConnectionScheduler";
import OtelMetricsIngestService from "../../../Telemetry/Services/OtelMetricsIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";

/*
 * Cloud connections (Cloud > Connect): every minute, queue a read of each
 * connection that is due; each read runs as a job of its own
 * (CloudConnectionPullRunner).
 *
 * The metrics a read brings in are kept through the same metrics ingest an
 * OpenTelemetry Collector sends to: the read hands the OTLP/JSON it built,
 * in the cloud receivers' own shape, to OtelMetricsIngestService, so drop
 * filters, pipeline rules, retention and finding each datapoint's cloud
 * resource apply to them exactly as to a collector's.
 */

export async function importCloudMetrics(data: {
  projectId: ObjectID;
  payload: JSONObject;
}): Promise<void> {
  /*
   * The ingest reads the body and the project off a request; nothing else
   * of it. The processing awaits every write before it returns.
   */
  const request: { body: JSONObject; projectId: ObjectID } = {
    body: data.payload,
    projectId: data.projectId,
  };

  await OtelMetricsIngestService.processMetricsFromQueue(
    request as unknown as ExpressRequest,
  );
}

export async function runCloudConnectionRead(job?: QueueJob): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException("A valid cloud connection ID is required.");
  }

  const outcome: CloudConnectionPullOutcome = await CloudConnectionPullRunner.run(
    new ObjectID(connectionId),
    { importMetrics: importCloudMetrics },
  );

  // The outcome is on the connection; the log line names no cloud data.
  logger.debug(`CloudConnection:Read ${connectionId}: ${outcome.status}`);
}

JobDictionary.setJobFunction(CLOUD_CONNECTION_PULL_JOB, runCloudConnectionRead);
JobDictionary.setTimeoutInMs(
  CLOUD_CONNECTION_PULL_JOB,
  CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS,
);

RunCron(
  "CloudConnection:ReadDueConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await CloudConnectionScheduler.enqueueDueConnections(new Date());
  },
);
