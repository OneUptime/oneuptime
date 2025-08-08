import { ProbeIngestJobData } from "../../Services/Queue/ProbeIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import OneUptimeDate from "Common/Types/Date";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { JSONObject } from "Common/Types/JSON";
import { PROBE_INGEST_CONCURRENCY } from "../../Config";

// Set up the worker for processing probe ingest queue
QueueWorker.getWorker(
  QueueName.ProbeIngest,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing probe ingestion job: ${job.name}`);

    try {
      const jobData: ProbeIngestJobData = job.data as ProbeIngestJobData;

      await processProbeFromQueue(jobData);

      logger.debug(`Successfully processed probe ingestion job: ${job.name}`);
    } catch (error) {
      logger.error(`Error processing probe ingestion job:`);
      logger.error(error);
      throw error;
    }
  },
  { concurrency: PROBE_INGEST_CONCURRENCY }, // Configurable via env, defaults to 100
);

async function processProbeFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const probeResponse: ProbeMonitorResponse = JSONFunctions.deserialize(
    jobData.probeMonitorResponse["probeMonitorResponse"] as JSONObject,
  ) as any;

  if (!probeResponse) {
    throw new BadDataException("ProbeMonitorResponse not found");
  }

  // this is when the resource was ingested.
  probeResponse.ingestedAt = OneUptimeDate.getCurrentDate();

  if (jobData.jobType === "probe-response") {
    // Handle regular probe response
    await MonitorResourceUtil.monitorResource(probeResponse);
  } else if (jobData.jobType === "monitor-test" && jobData.testId) {
    // Handle monitor test response
    const testId: ObjectID = new ObjectID(jobData.testId);

    if (!testId) {
      throw new BadDataException("TestId not found");
    }

    probeResponse.ingestedAt = OneUptimeDate.getCurrentDate();

    // save the probe response to the monitor test.
    await MonitorTestService.updateOneById({
      id: testId,
      data: {
        monitorStepProbeResponse: {
          [probeResponse.monitorStepId.toString()]: {
            ...JSON.parse(JSON.stringify(probeResponse)),
            monitoredAt: OneUptimeDate.getCurrentDate(),
          },
        } as any,
      },
      props: {
        isRoot: true,
      },
    });
  } else {
    throw new BadDataException(`Invalid job type: ${jobData.jobType}`);
  }
}

logger.debug("Probe ingest worker initialized");
