import { IncomingRequestIngestJobData } from "../../Services/Queue/IncomingRequestIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { INCOMING_REQUEST_INGEST_CONCURRENCY } from "../../Config";

// Set up the worker for processing incoming request ingest queue
QueueWorker.getWorker(
  QueueName.IncomingRequestIngest,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing incoming request ingestion job: ${job.name}`);

    try {
      const jobData: IncomingRequestIngestJobData =
        job.data as IncomingRequestIngestJobData;

      await processIncomingRequestFromQueue(jobData);

      logger.debug(
        `Successfully processed incoming request ingestion job: ${job.name}`,
      );
    } catch (error) {
      logger.error(`Error processing incoming request ingestion job:`);
      logger.error(error);
      throw error;
    }
  },
  { concurrency: INCOMING_REQUEST_INGEST_CONCURRENCY }, // Configurable via env, defaults to 100
);

async function processIncomingRequestFromQueue(
  jobData: IncomingRequestIngestJobData,
): Promise<void> {
  const requestHeaders: Dictionary<string> = jobData.requestHeaders;
  const requestBody: string | JSONObject = jobData.requestBody;
  const monitorSecretKeyAsString: string = jobData.secretKey;

  if (!monitorSecretKeyAsString) {
    throw new BadDataException("Invalid Secret Key");
  }

  const isGetRequest: boolean = jobData.requestMethod === "GET";
  const isPostRequest: boolean = jobData.requestMethod === "POST";

  let httpMethod: HTTPMethod = HTTPMethod.GET;

  if (isGetRequest) {
    httpMethod = HTTPMethod.GET;
  }

  if (isPostRequest) {
    httpMethod = HTTPMethod.POST;
  }

  const monitor: Monitor | null = await MonitorService.findOneBy({
    query: {
      incomingRequestSecretKey: new ObjectID(monitorSecretKeyAsString),
      monitorType: MonitorType.IncomingRequest,
    },
    select: {
      _id: true,
      projectId: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (!monitor || !monitor._id) {
    throw new BadDataException("Monitor not found");
  }

  if (!monitor.projectId) {
    throw new BadDataException("Project not found");
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  const incomingRequest: IncomingMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: new ObjectID(monitor._id.toString()),
    requestHeaders: requestHeaders,
    requestBody: requestBody,
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    requestMethod: httpMethod,
    checkedAt: now,
  };

  // process probe response here.
  await MonitorResourceUtil.monitorResource(incomingRequest);
}

logger.debug("Incoming request ingest worker initialized");
