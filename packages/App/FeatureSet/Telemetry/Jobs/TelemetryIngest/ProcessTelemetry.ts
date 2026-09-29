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
import SecurityEventsIngestService from "../../Services/SecurityEventsIngestService";
import {
  processProbeFromQueue,
  processIncomingEmailFromQueue,
  processSnmpTrapFromQueue,
  processNetworkDeviceWalkFromQueue,
} from "../ProbeIngest/ProcessProbeIngest";
import { processServerMonitorFromQueue } from "../ServerMonitorIngest/ProcessServerMonitorIngest";
import KubernetesCostIngestService from "../../Services/KubernetesCostIngestService";
import { processIncomingRequestFromQueue } from "../IncomingRequestIngest/ProcessIncomingRequestIngest";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
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
  SESSION_REPLAY_WORKER_CONCURRENCY,
  TELEMETRY_CONCURRENCY,
  TELEMETRY_LOCK_DURATION_MS,
} from "../../Config";
import OtelPayloadDecoder from "../../Utils/OtelPayloadDecoder";
import TelemetryBodyStore from "../../Utils/TelemetryBodyStore";
import SessionReplayChunkStore from "../../Utils/SessionReplayChunkStore";
import SessionReplayIngestService from "../../Services/SessionReplayIngestService";
import { JSONObject } from "Common/Types/JSON";
import PinServiceName from "Common/Server/Utils/Telemetry/PinServiceName";

/*
 * Enforce the ingestion key's pinned `service.name` on a decoded OTLP body,
 * in place, before anything downstream reads it.
 *
 * WHY IN THE WORKER AND NOT AT THE HTTP EDGE: the ingest endpoints never
 * decode the payload. They stash the raw bytes — routinely gzipped protobuf —
 * in Redis via TelemetryBodyStore and hand the worker a key, precisely so the
 * decode stays off the Express event loop. The first moment the payload exists
 * as JSON is the decode in resolveOtelBody below, so that is the earliest
 * point at which a service name can be rewritten at all. The pin therefore has
 * to ride on the job (TelemetryIngestJobData.pinnedServiceName) and be applied
 * here.
 *
 * WHY IT MUST HAPPEN BEFORE THE INGEST SERVICES: everything past this point
 * treats the payload as the customer's own data. `service.name` decides which
 * service a span, log or metric is filed under, and therefore what dashboards
 * chart, what telemetry monitors evaluate and what alerts fire on. A Browser
 * ingestion key is published in page source by design and must be assumed
 * scraped, so its payload has to be relabelled before any of that reads a
 * service name out of it — otherwise a scraped key can forge telemetry that
 * looks like it came from a backend service the attacker never touched.
 *
 * It is called from inside resolveOtelBody on purpose: all four OTel signals
 * resolve their body through that one function, so the control has exactly one
 * call site and a fifth signal cannot be wired up without inheriting it.
 * PinServiceName walks the resource container of all four (spans, logs,
 * metrics and profiles), so a pin means the same thing whichever signal the
 * key is used for.
 */
function applyPinnedServiceName(
  body: JSONObject,
  jobData: TelemetryIngestJobData,
): void {
  if (!jobData.pinnedServiceName) {
    return;
  }

  /*
   * PinServiceName is specified never to throw — every malformed shape it
   * meets is repaired or skipped — and it is wrapped anyway, because the two
   * blast radii here are wildly lopsided. It runs on attacker-controlled JSON,
   * and an unhandled error out of it would fail the whole job: with BullMQ
   * retries re-hitting the same payload, that is permanent loss of everything
   * else in the batch. A pin that failed to apply, by contrast, is a labelling
   * failure on ONE key, whose abuse is still bounded by the origin allowlist,
   * the per-key rate limit and the kill switch. So: log loudly, never fail the
   * job.
   */
  try {
    PinServiceName.pinInPlace(body, jobData.pinnedServiceName);
  } catch (error) {
    logger.error(
      `ProcessTelemetry: failed to pin service.name for project ${jobData.projectId}:`,
    );
    logger.error(error);
  }
}

/*
 * Resolve the parsed JSON body for an OTel job. The HTTP enqueue
 * stashes the raw request buffer in Redis via TelemetryBodyStore
 * and only carries the `bodyKey` reference in the BullMQ job. The
 * decoder fetches the binary back out and runs the heavy
 * gunzip + protobuf decode here in the worker, off the Express
 * event loop.
 *
 * The decoded body is then run through applyPinnedServiceName, so every
 * caller gets a body that already honours the ingestion key's service-name
 * pin — see the comment there for why this is the only place in the system
 * where that pin can be applied.
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

  const body: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
    productType: jobData.productType,
    format: jobData.bodyFormat,
    encoding: jobData.bodyEncoding ?? "none",
    bodyKey: jobData.bodyKey,
  });

  applyPinnedServiceName(body, jobData);

  return body;
}

/*
 * Which telemetry types run their job inside a runWithInsertDedup scope —
 * and why the high-volume OTLP signals (traces / logs / metrics) do NOT.
 *
 * Inside the scope, every fan-in submission captures a deterministic
 * "<jobId>:<table>:<chunk>" token and TelemetryFanInWriter inserts each
 * tokened submission INDIVIDUALLY — one ClickHouse statement per submission.
 * That preserves per-job retry idempotence (a retry re-issues byte-identical
 * statements that content-hash dedup drops), but it also pins the statement
 * rate to the job arrival rate: cross-job batching never merges
 * differently-tokened rows, so at high trace/log/metric volume ClickHouse
 * saturates on per-statement overhead (gunzip + parse + async-insert
 * bookkeeping per statement) while the merged-insert machinery sits unused.
 *
 * So the high-volume signals — the reason the fan-in writer exists — run
 * OUTSIDE the scope: their submissions are untokened, and the writer merges
 * a whole flush window into ONE INSERT per table under a minted per-batch
 * token (still stable across the writer's own retries, so transient-failure
 * retries of the SAME batch never double-write).
 *
 * The accepted trade: a job that fails AFTER one of its merged inserts was
 * accepted (multi-table job failing on a later table, stalled-job recovery
 * after acks) re-processes into a differently-composed batch that content
 * hashing cannot dedup, so those rows can land twice. Per-job tokens were
 * never honored for async inserts anyway (ClickHouse #52018 — see the
 * comment in Common/Server/Services/AnalyticsDatabaseService.ts); what
 * actually deduped retries was content hashing of solo-statement bodies,
 * which is precisely the one-statement-per-job pattern that saturates
 * ClickHouse.
 *
 * Profiles / syslog / fluent-logs / Kubernetes-cost stay tokened: their
 * statement rate is negligible, so their retry idempotence costs nothing
 * to keep.
 *
 * The probe / server-monitor / incoming-request types are excluded
 * deliberately: their inserts go through shared cross-job buffers
 * (MonitorLogUtil / monitor metrics), where a flushed batch can mix
 * rows from several jobs — a retry would then reuse a token for a
 * differently-composed block and ClickHouse would drop it (tokens
 * dedup by token, not content), losing other jobs' rows.
 *
 * SessionReplay is excluded for a different reason again, and must
 * stay excluded: TelemetryFanInWriter.dispatchInsert inserts TOKENED
 * submissions individually, one statement each, so adding replay here
 * would produce one INSERT per chunk on the fattest table in the
 * system. Untokened submissions merge into one batch per flush window
 * instead. Replay gets its idempotency from the chunk table being a
 * ReplacingMergeTree keyed on (projectId, sessionId, tabId,
 * chunkIndex) plus LIMIT 1 BY chunkIndex at read time, so a
 * re-delivered chunk collapses at merge rather than double-writing.
 */
const INSERT_DEDUP_TYPES: Array<TelemetryType> = [
  TelemetryType.Profiles,
  TelemetryType.Syslog,
  TelemetryType.FluentLogs,
  TelemetryType.SecurityEvents,
  TelemetryType.KubernetesCostIngest,
];

// Exported for tests.
export function shouldUseInsertDedup(telemetryType: TelemetryType): boolean {
  return INSERT_DEDUP_TYPES.includes(telemetryType);
}

/*
 * Per-pod cap on how many replay jobs may be DECODING AND SCRUBBING at once.
 *
 * What this does deliver: a bound on concurrent gunzip + rrweb-tree walking,
 * and therefore on the worker's peak memory and CPU from replay. Decoded
 * chunks are held resident until their insert is submitted, so without a cap
 * TELEMETRY_CONCURRENCY simultaneous replay jobs is a multi-GB ceiling.
 *
 * What this does NOT deliver, despite the obvious reading: starvation
 * protection for the other telemetry signals. The gate is applied INSIDE the
 * BullMQ job handler, so a replay job parked here is still holding one of the
 * worker's TELEMETRY_CONCURRENCY slots. With enough replay jobs at the head
 * of the queue every slot is occupied and no trace or log job is fetched.
 * Fixing that properly means a separate worker on a filtered job name, since
 * worker concurrency is the only real enforcement point; it is not what this
 * gate is.
 *
 * In-process rather than the distributed Redis Semaphore on purpose:
 * TELEMETRY_CONCURRENCY is itself a per-pod number, so a per-pod cap is the
 * right unit, and a Redis round trip per chunk would be a significant share
 * of a path whose entire budget is a few milliseconds. FIFO so a queued job
 * cannot be starved indefinitely.
 */
let sessionReplayInFlight: number = 0;
const sessionReplayWaiters: Array<() => void> = [];

async function withSessionReplaySlot(fn: () => Promise<void>): Promise<void> {
  if (sessionReplayInFlight >= SESSION_REPLAY_WORKER_CONCURRENCY) {
    /*
     * Wait for a slot to be HANDED to us. The releaser deliberately does
     * not decrement when it wakes a waiter: transferring the slot instead
     * of freeing it closes the window in which a third caller could see a
     * free slot between the wake-up and the woken job resuming, which would
     * let the cap be exceeded.
     */
    await new Promise<void>((resolve: () => void) => {
      sessionReplayWaiters.push(resolve);
    });
  } else {
    sessionReplayInFlight++;
  }

  try {
    await fn();
  } finally {
    const next: (() => void) | undefined = sessionReplayWaiters.shift();

    if (next) {
      next();
    } else {
      sessionReplayInFlight--;
    }
  }
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
       * Whether this job's ClickHouse writes carry deterministic per-job
       * insert_deduplication_tokens (inserted one statement per submission)
       * or stay untokened so TelemetryFanInWriter merges them into fat
       * cross-job INSERTs — see the policy comment on shouldUseInsertDedup
       * above.
       */
      const useInsertDedup: boolean = shouldUseInsertDedup(jobData.type);

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

            case TelemetryType.SecurityEvents: {
              const mockRequest: TelemetryRequest = {
                projectId: new ObjectID(jobData.projectId!.toString()),
                body: jobData.requestBody!,
                headers: jobData.requestHeaders!,
              } as TelemetryRequest;

              await SecurityEventsIngestService.processSecurityEventsFromQueue(
                mockRequest,
              );
              logger.debug(
                `Successfully processed security events for project: ${jobData.projectId}`,
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
                } else if (jobData.probeIngest.jobType === "snmp-trap") {
                  await processSnmpTrapFromQueue(jobData.probeIngest);
                } else if (
                  jobData.probeIngest.jobType === "network-device-walk"
                ) {
                  await processNetworkDeviceWalkFromQueue(jobData.probeIngest);
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

            case TelemetryType.TelemetryMonitorEvaluation:
              if (jobData.telemetryMonitorEvaluation) {
                await processTelemetryMonitorEvaluationFromQueue(
                  jobData.telemetryMonitorEvaluation,
                );
              }
              logger.debug(
                `Successfully processed telemetry monitor evaluation job`,
              );
              break;

            case TelemetryType.KubernetesCostIngest:
              if (jobData.kubernetesCostIngest) {
                await KubernetesCostIngestService.processFromQueue(
                  jobData.kubernetesCostIngest,
                );
              }
              logger.debug(`Successfully processed kubernetes cost ingest job`);
              break;

            case TelemetryType.SessionReplay:
              if (jobData.sessionReplayIngest) {
                /*
                 * Held behind the per-pod replay slot gate, which bounds how
                 * many chunks are being decoded and scrubbed at once and so
                 * bounds the worker's peak memory. It does not free the
                 * BullMQ slot while waiting - see withSessionReplaySlot.
                 */
                await withSessionReplaySlot(async (): Promise<void> => {
                  await SessionReplayIngestService.processFromQueue(
                    jobData.sessionReplayIngest!,
                    jobData.bodyKey,
                  );
                });
              }
              logger.debug(`Successfully processed session replay ingest job`);
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
       * backstops a missed delete. Only OTel-type and session-replay jobs
       * carry a bodyKey — and session replay stages into its own keyspace
       * with its own TTL, so it must be reclaimed through its own store.
       */
      if (jobData.bodyKey) {
        if (jobData.type === TelemetryType.SessionReplay) {
          await SessionReplayChunkStore.deleteBody(jobData.bodyKey);
        } else {
          await TelemetryBodyStore.deleteBody(jobData.bodyKey);
        }
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
