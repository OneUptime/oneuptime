import {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../Services/Queue/TelemetryQueueService";
import OtelLogsIngestService from "../../Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../../Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../Services/OtelProfilesIngestService";
import SyslogIngestService from "../../Services/SyslogIngestService";
import FluentLogsIngestService from "../../Services/FluentLogsIngestService";
import {
  processProbeFromQueue,
  processIncomingEmailFromQueue,
} from "../ProbeIngest/ProcessProbeIngest";
import { processServerMonitorFromQueue } from "../ServerMonitorIngest/ProcessServerMonitorIngest";
import { processIncomingRequestFromQueue } from "../IncomingRequestIngest/ProcessIncomingRequestIngest";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
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

      /*
       * Defensive: BullMQ can occasionally hand us job objects whose underlying
       * Redis hash has lost its `data` field. This happens when a stalled job
       * is recovered concurrently with `removeOnComplete` / `removeOnFail`
       * cleanup, leaving an orphan record that gets replayed with `job.data`
       * materialized as an empty object. Without this guard the worker throws
       * "Unknown telemetry type: undefined" for every such replay and the log
       * fills up with noise that is neither actionable nor tied to a real
       * ingestion failure. Skip silently (debug log) instead of throwing.
       */
      if (
        !jobData ||
        typeof jobData !== "object" ||
        Object.keys(jobData as object).length === 0 ||
        !jobData.type
      ) {
        logger.debug(
          `Skipping telemetry job ${job.id ?? "?"}: missing or empty data (likely a stalled-job orphan)`,
        );
        return;
      }

      // Process based on telemetry type
      switch (jobData.type) {
        case TelemetryType.Logs: {
          // Create a mock request object with the queued data
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await OtelLogsIngestService.processLogsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed logs for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.Traces: {
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await OtelTracesIngestService.processTracesFromQueue(mockRequest);
          logger.debug(
            `Successfully processed traces for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.Metrics: {
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await OtelMetricsIngestService.processMetricsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed metrics for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.Profiles: {
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await OtelProfilesIngestService.processProfilesFromQueue(mockRequest);
          logger.debug(
            `Successfully processed profiles for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.Syslog: {
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await SyslogIngestService.processSyslogFromQueue(mockRequest);
          logger.debug(
            `Successfully processed syslog payload for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.FluentLogs: {
          const mockRequest: TelemetryRequest = {
            projectId: new ObjectID(jobData.projectId!.toString()),
            body: jobData.requestBody!,
            headers: jobData.requestHeaders!,
          } as TelemetryRequest;

          await FluentLogsIngestService.processFluentLogsFromQueue(mockRequest);
          logger.debug(
            `Successfully processed fluent logs for project: ${jobData.projectId}`,
          );
          break;
        }

        case TelemetryType.ProbeIngest:
          if (jobData.probeIngest) {
            if (jobData.probeIngest.jobType === "incoming-email") {
              await processIncomingEmailFromQueue(jobData.probeIngest);
            } else {
              await processProbeFromQueue(jobData.probeIngest);
            }
          }
          logger.debug(`Successfully processed probe ingest job`);
          break;

        case TelemetryType.ServerMonitorIngest:
          if (jobData.serverMonitorIngest) {
            await processServerMonitorFromQueue(jobData.serverMonitorIngest);
          }
          logger.debug(`Successfully processed server monitor ingest job`);
          break;

        case TelemetryType.IncomingRequestIngest:
          if (jobData.incomingRequestIngest) {
            await processIncomingRequestFromQueue(
              jobData.incomingRequestIngest,
            );
          }
          logger.debug(`Successfully processed incoming request ingest job`);
          break;

        default:
          throw new Error(`Unknown telemetry type: ${jobData.type}`);
      }
    } catch (error) {
      /*
       * Certain BadDataException cases are expected / non-actionable and should not fail the job.
       * These include disabled monitors (manual, maintenance, explicitly disabled) and missing monitors
       * (e.g. secret key referencing a deleted monitor). Retrying provides no value and only creates noise.
       */
      if (
        error instanceof BadDataException &&
        (error.message === ExceptionMessages.MonitorNotFound ||
          error.message === ExceptionMessages.MonitorDisabled)
      ) {
        return;
      }

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
