import { FluentIngestJobData } from "../../Services/Queue/FluentIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import LogService from "Common/Server/Services/LogService";
import LogSeverity from "Common/Types/Log/LogSeverity";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import JSONFunctions from "Common/Types/JSONFunctions";
import Log from "Common/Models/AnalyticsModels/Log";
import { FLUENT_INGEST_CONCURRENCY } from "../../Config";

interface FluentIngestProcessData {
  projectId: ObjectID;
  requestBody: JSONObject;
  requestHeaders: JSONObject;
}

// Set up the worker for processing fluent ingest queue
QueueWorker.getWorker(
  QueueName.FluentIngest,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing fluent ingestion job: ${job.name}`);

    try {
      const jobData: FluentIngestJobData = job.data as FluentIngestJobData;

      // Pass job data directly to processing function
      await processFluentIngestFromQueue({
        projectId: new ObjectID(jobData.projectId),
        requestBody: jobData.requestBody,
        requestHeaders: jobData.requestHeaders,
      });

      logger.debug(`Successfully processed fluent ingestion job: ${job.name}`);
    } catch (error) {
      logger.error(`Error processing fluent ingestion job:`);
      logger.error(error);
      throw error;
    }
  },
  { concurrency: FLUENT_INGEST_CONCURRENCY },
);

async function processFluentIngestFromQueue(
  data: FluentIngestProcessData,
): Promise<void> {
  const dbLogs: Array<Log> = [];

  let logItems: Array<JSONObject | string> | JSONObject = data.requestBody as
    | Array<JSONObject | string>
    | JSONObject;

  let oneuptimeServiceName: string | string[] | undefined = data.requestHeaders[
    "x-oneuptime-service-name"
  ] as string | string[] | undefined;

  if (!oneuptimeServiceName) {
    oneuptimeServiceName = "Unknown Service";
  }

  const telemetryService: {
    serviceId: ObjectID;
    dataRententionInDays: number;
  } = await OTelIngestService.telemetryServiceFromName({
    serviceName: oneuptimeServiceName as string,
    projectId: data.projectId,
  });

  if (
    logItems &&
    typeof logItems === "object" &&
    (logItems as JSONObject)["json"]
  ) {
    logItems = (logItems as JSONObject)["json"] as
      | Array<JSONObject | string>
      | JSONObject;
  }

  if (!Array.isArray(logItems)) {
    logItems = [logItems];
  }

  for (let logItem of logItems) {
    const dbLog: Log = new Log();

    dbLog.projectId = data.projectId;
    dbLog.serviceId = telemetryService.serviceId;
    dbLog.severityNumber = 0;
    const currentTimeAndDate: Date = OneUptimeDate.getCurrentDate();
    dbLog.timeUnixNano = OneUptimeDate.toUnixNano(currentTimeAndDate);
    dbLog.time = currentTimeAndDate;

    dbLog.severityText = LogSeverity.Unspecified;

    if (typeof logItem === "string") {
      // check if its parseable to json
      try {
        logItem = JSON.parse(logItem);
      } catch {
        // do nothing
      }
    }

    if (typeof logItem !== "string") {
      logItem = JSON.stringify(logItem);
    }

    dbLog.body = logItem as string;

    dbLogs.push(dbLog);
  }

  await LogService.createMany({
    items: dbLogs,
    props: {
      isRoot: true,
    },
  });

  OTelIngestService.recordDataIngestedUsgaeBilling({
    services: {
      [oneuptimeServiceName as string]: {
        dataIngestedInGB: JSONFunctions.getSizeOfJSONinGB(
          data.requestBody as JSONObject,
        ),
        dataRententionInDays: telemetryService.dataRententionInDays,
        serviceId: telemetryService.serviceId,
        serviceName: oneuptimeServiceName as string,
      },
    },
    projectId: data.projectId,
    productType: ProductType.Logs,
  }).catch((err: Error) => {
    logger.error(err);
  });
}

logger.debug("Fluent ingest worker initialized");
