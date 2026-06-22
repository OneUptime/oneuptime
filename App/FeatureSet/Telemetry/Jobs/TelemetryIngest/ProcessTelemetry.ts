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
import { runWithInsertDedup } from "Common/Server/Services/AnalyticsDatabaseService";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import { DisableQueueWorkers } from "Common/Server/EnvironmentConfig";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import {
  TELEMETRY_CONCURRENCY,
  TELEMETRY_LOCK_DURATION_MS,
} from "../../Config";
import OtelPayloadDecoder from "../../Utils/OtelPayloadDecoder";
import TelemetryBodyStore from "../../Utils/TelemetryBodyStore";
import { JSONObject } from "Common/Types/JSON";

/*
 * Resolve the parsed JSON body for an OTel job. The HTTP enqueue
 * stashes the raw request buffer in Redis via TelemetryBodyStore
 * and only carries the `bodyKey` reference in the BullMQ job. The
 * decoder fetches the binary back out and runs the heavy
 * gunzip + protobuf decode here in the worker, off the Express
 * event loop.
 *
 * Throws if a required field is missing — that indicates a
 * producer bug in TelemetryQueueService and must not be silently
 * swallowed.
 */
async function resolveOtelBody(
  jobData: TelemetryIngestJobData,
): Promise<JSONObject> {
  if (!jobData.bodyKey || !jobData.bodyFormat || !jobData.productType) {
    throw new Error(
      `ProcessTelemetry: OTel job is missing bodyKey/bodyFormat/productType (type=${jobData.type})`,
    );
  }

  return await OtelPayloadDecoder.decodeFromQueue({
    productType: jobData.productType,
    format: jobData.bodyFormat,
    encoding: jobData.bodyEncoding ?? "none",
    bodyKey: jobData.bodyKey,
  });
}

/*
 * Set up the unified worker for processing the telemetry queue. Skipped in
 * the "api" role (DISABLE_QUEUE_WORKERS=true) so the heavy protobuf decode +
 * per-span/log transform + ClickHouse writes run only in the dedicated
 * worker deployment, never on the API request event loop.
 */
if (DisableQueueWorkers) {
  logger.info(
    "DISABLE_QUEUE_WORKERS=true — telemetry queue consumer not registered (api role).",
  );
} else {
  QueueWorker.getWorker(
    QueueName.Telemetry,
    async (job: QueueJob): Promise<void> => {
      logger.debug(`Processing telemetry ingestion job: ${job.name}`);

      const jobData: TelemetryIngestJobData =
        job.data as TelemetryIngestJobData;

      /*
       * For the telemetry signal types, every ClickHouse insert performed
       * while processing the job carries a deterministic
       * insert_deduplication_token derived from the BullMQ job id (stable
       * across stalled-job recoveries and attempts-based retries), so a
       * retry that re-processes the same payload is deduplicated
       * server-side instead of double-writing rows. See runWithInsertDedup
       * in AnalyticsDatabaseService.
       *
       * The probe / server-monitor / incoming-request types are excluded
       * deliberately: their inserts go through shared cross-job buffers
       * (MonitorLogUtil / monitor metrics), where a flushed batch can mix
       * rows from several jobs — a retry would then reuse a token for a
       * differently-composed block and ClickHouse would drop it (tokens
       * dedup by token, not content), losing other jobs' rows.
       */
      const useInsertDedup: boolean = [
        TelemetryType.Logs,
        TelemetryType.Traces,
        TelemetryType.Metrics,
        TelemetryType.Profiles,
        TelemetryType.Syslog,
        TelemetryType.FluentLogs,
      ].includes(jobData.type);

      const dedupTokenBase: string = String(
        job.id ?? jobData.bodyKey ?? job.name,
      );

      const runJob: (fn: () => Promise<void>) => Promise<void> = (
        fn: () => Promise<void>,
      ): Promise<void> => {
        return useInsertDedup ? runWithInsertDedup(dedupTokenBase, fn) : fn();
      };

      await runJob(async (): Promise<void> => {
        try {
          // Process based on telemetry type
          switch (jobData.type) {
            case TelemetryType.Logs: {
              const body: JSONObject = await resolveOtelBody(jobData);
              const mockRequest: TelemetryRequest = {
                projectId: new ObjectID(jobData.projectId!.toString()),
                body,
                headers: jobData.requestHeaders!,
              } as TelemetryRequest;

              await OtelLogsIngestService.processLogsFromQueue(mockRequest);
              logger.debug(
                `Successfully processed logs for project: ${jobData.projectId}`,
              );
              break;
            }

            case TelemetryType.Traces: {
              const body: JSONObject = await resolveOtelBody(jobData);
              const mockRequest: TelemetryRequest = {
                projectId: new ObjectID(jobData.projectId!.toString()),
                body,
                headers: jobData.requestHeaders!,
              } as TelemetryRequest;

              await OtelTracesIngestService.processTracesFromQueue(mockRequest);
              logger.debug(
                `Successfully processed traces for project: ${jobData.projectId}`,
              );
              break;
            }

            case TelemetryType.Metrics: {
              const body: JSONObject = await resolveOtelBody(jobData);
              const mockRequest: TelemetryRequest = {
                projectId: new ObjectID(jobData.projectId!.toString()),
                body,
                headers: jobData.requestHeaders!,
              } as TelemetryRequest;

              await OtelMetricsIngestService.processMetricsFromQueue(
                mockRequest,
              );
              logger.debug(
                `Successfully processed metrics for project: ${jobData.projectId}`,
              );
              break;
            }

            case TelemetryType.Profiles: {
              const body: JSONObject = await resolveOtelBody(jobData);
              const mockRequest: TelemetryRequest = {
                projectId: new ObjectID(jobData.projectId!.toString()),
                body,
                headers: jobData.requestHeaders!,
              } as TelemetryRequest;

              await OtelProfilesIngestService.processProfilesFromQueue(
                mockRequest,
              );
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

              await FluentLogsIngestService.processFluentLogsFromQueue(
                mockRequest,
              );
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
                await processServerMonitorFromQueue(
                  jobData.serverMonitorIngest,
                );
              }
              logger.debug(`Successfully processed server monitor ingest job`);
              break;

            case TelemetryType.IncomingRequestIngest:
              if (jobData.incomingRequestIngest) {
                await processIncomingRequestFromQueue(
                  jobData.incomingRequestIngest,
                );
              }
              logger.debug(
                `Successfully processed incoming request ingest job`,
              );
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
      });

      /*
       * The job succeeded (runJob re-throws on failure, so we only get here
       * on success or a deliberately-swallowed non-actionable case). The
       * out-of-band OTLP body is now fully consumed, so reclaim it — it is
       * deliberately NOT deleted at read time (see TelemetryBodyStore.readBody)
       * so a transient-failure retry can re-read it. Best-effort; the TTL
       * backstops a missed delete. Only OTel-type jobs carry a bodyKey.
       */
      if (jobData.bodyKey) {
        await TelemetryBodyStore.deleteBody(jobData.bodyKey);
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
}
