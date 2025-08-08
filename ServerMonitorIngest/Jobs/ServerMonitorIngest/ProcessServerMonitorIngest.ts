import { ServerMonitorIngestJobData } from "../../Services/Queue/ServerMonitorIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import ProjectService from "Common/Server/Services/ProjectService";
import { SERVER_MONITOR_INGEST_CONCURRENCY } from "../../Config";

// Set up the worker for processing server monitor ingest queue
QueueWorker.getWorker(
  QueueName.ServerMonitorIngest,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing server monitor ingestion job: ${job.name}`);

    try {
      const jobData: ServerMonitorIngestJobData =
        job.data as ServerMonitorIngestJobData;

      await processServerMonitorFromQueue(jobData);

      logger.debug(
        `Successfully processed server monitor ingestion job: ${job.name}`,
      );
    } catch (error) {
      logger.error(`Error processing server monitor ingestion job:`);
      logger.error(error);
      throw error;
    }
  },
  { concurrency: SERVER_MONITOR_INGEST_CONCURRENCY }, // Configurable via env, defaults to 100
);

async function processServerMonitorFromQueue(
  jobData: ServerMonitorIngestJobData,
): Promise<void> {
  const monitorSecretKeyAsString: string = jobData.secretKey;

  if (!monitorSecretKeyAsString) {
    throw new BadDataException("Invalid Secret Key");
  }

  const monitor: Monitor | null = await MonitorService.findOneBy({
    query: {
      serverMonitorSecretKey: new ObjectID(monitorSecretKeyAsString),
      monitorType: MonitorType.Server,
      ...MonitorService.getEnabledMonitorQuery(),
      project: {
        ...ProjectService.getActiveProjectStatusQuery(),
      },
    },
    select: {
      _id: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (!monitor) {
    throw new BadDataException("Monitor not found");
  }

  const serverMonitorResponse: ServerMonitorResponse =
    JSONFunctions.deserialize(
      jobData.serverMonitorResponse["serverMonitorResponse"] as JSONObject,
    ) as any;

  if (!serverMonitorResponse) {
    throw new BadDataException("Invalid Server Monitor Response");
  }

  if (!monitor.id) {
    throw new BadDataException("Monitor id not found");
  }

  serverMonitorResponse.monitorId = monitor.id;
  serverMonitorResponse.requestReceivedAt = OneUptimeDate.getCurrentDate();
  serverMonitorResponse.timeNow = OneUptimeDate.getCurrentDate();

  // process probe response here.
  await MonitorResourceUtil.monitorResource(serverMonitorResponse);
}

logger.debug("Server monitor ingest worker initialized");
