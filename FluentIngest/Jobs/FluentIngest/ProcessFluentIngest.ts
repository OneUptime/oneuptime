import { FluentIngestJobData } from "../../Services/Queue/FluentIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogService from "Common/Server/Services/LogService";
import LogSeverity from "Common/Types/Log/LogSeverity";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import { FLUENT_INGEST_CONCURRENCY } from "../../Config";

interface FluentIngestProcessData {
  projectId: ObjectID;
  requestBody: JSONObject;
  requestHeaders: JSONObject;
}

const FLUENT_INGEST_LOG_FLUSH_BATCH_SIZE: number = 500;

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
  const dbLogs: Array<JSONObject> = [];

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

  for (const logItem of logItems) {
    const logBody: string =
      typeof logItem === "string" ? logItem : JSON.stringify(logItem);

    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionIso: string = OneUptimeDate.toString(ingestionDate);
    const timeUnixNano: number = OneUptimeDate.toUnixNano(ingestionDate);

    const logRow: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionIso,
      updatedAt: ingestionIso,
      projectId: data.projectId.toString(),
      serviceId: telemetryService.serviceId.toString(),
      time: ingestionIso,
      timeUnixNano: Math.trunc(timeUnixNano).toString(),
      severityNumber: 0,
      severityText: LogSeverity.Unspecified,
      attributes: {},
      attributeKeys: [],
      traceId: "",
      spanId: "",
      body: logBody,
    };

    dbLogs.push(logRow);

    if (dbLogs.length >= FLUENT_INGEST_LOG_FLUSH_BATCH_SIZE) {
      await flushLogBuffer(dbLogs);
    }
  }

  await flushLogBuffer(dbLogs, true);
}

logger.debug("Fluent ingest worker initialized");

async function flushLogBuffer(
  logs: Array<JSONObject>,
  force: boolean = false,
): Promise<void> {
  while (
    logs.length >= FLUENT_INGEST_LOG_FLUSH_BATCH_SIZE ||
    (force && logs.length > 0)
  ) {
    const batchSize: number = Math.min(
      logs.length,
      FLUENT_INGEST_LOG_FLUSH_BATCH_SIZE,
    );
    const batch: Array<JSONObject> = logs.splice(0, batchSize);

    if (batch.length === 0) {
      continue;
    }

    await LogService.insertJsonRows(batch);
  }
}
