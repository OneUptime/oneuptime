import {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../Services/Queue/TelemetryQueueService";
import OtelLogsIngestService from "../../Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../../Services/OtelMetricsIngestService";
import SyslogIngestService from "../../Services/SyslogIngestService";
import FluentLogsIngestService from "../../Services/FluentLogsIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import ObjectID from "Common/Types/ObjectID";
import {
  TELEMETRY_CONCURRENCY,
  TELEMETRY_LOCK_DURATION_MS,
} from "../../Config";

// Set up the unified worker for processing telemetry queue
QueueWorker.getWorker(
  QueueName.Telemetry,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing telemetry ingestion job: ${job.name}`);

    try {
      const jobData: TelemetryIngestJobData =
        job.data as TelemetryIngestJobData;

      // Create a mock request object with the queued data
      const mockRequest: TelemetryRequest = {
        projectId: new ObjectID(jobData.projectId.toString()),
        body: jobData.requestBody,
        headers: jobData.requestHeaders,
      } as TelemetryRequest;

      // Process based on telemetry type
      switch (jobData.type) {
        case TelemetryType.Logs:
          await OtelLogsIngestService.processLogsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed logs for project: ${jobData.projectId}`,
          );
          break;

        case TelemetryType.Traces:
          await OtelTracesIngestService.processTracesFromQueue(mockRequest);
          logger.debug(
            `Successfully processed traces for project: ${jobData.projectId}`,
          );
          break;

        case TelemetryType.Metrics:
          await OtelMetricsIngestService.processMetricsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed metrics for project: ${jobData.projectId}`,
          );
          break;

        case TelemetryType.Syslog:
          await SyslogIngestService.processSyslogFromQueue(mockRequest);
          logger.debug(
            `Successfully processed syslog payload for project: ${jobData.projectId}`,
          );
          break;

        case TelemetryType.FluentLogs:
          await FluentLogsIngestService.processFluentLogsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed fluent logs for project: ${jobData.projectId}`,
          );
          break;

        default:
          throw new Error(`Unknown telemetry type: ${jobData.type}`);
      }
    } catch (error) {
      logger.error(`Error processing telemetry job:`);
      logger.error(error);
      throw error;
    }
  },
  {
    concurrency: TELEMETRY_CONCURRENCY,
    lockDuration: TELEMETRY_LOCK_DURATION_MS,
    // allow a couple of stall recoveries before marking failed if genuinely stuck
    maxStalledCount: 2,
  },
);

logger.debug("Unified telemetry worker initialized");
