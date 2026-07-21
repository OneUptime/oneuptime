import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ResourceEntityRef } from "Common/Server/Utils/Telemetry/TelemetryEntity";
import EventLoop from "Common/Server/Utils/EventLoop";
import OtelPayloadDecoder from "../Utils/OtelPayloadDecoder";
import OneUptimeDate from "Common/Types/Date";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  SpanEventType,
  SpanKind,
  SpanStatus,
} from "Common/Models/AnalyticsModels/Span";
import ExceptionUtil, { TelemetryExceptionPayload } from "../Utils/Exception";
import StackTraceParser, {
  ParsedStackTrace,
} from "Common/Server/Utils/Telemetry/StackTraceParser";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import LlmSpanUtil, {
  LlmSpanFields,
} from "Common/Server/Utils/Telemetry/LlmSpan";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import Text from "Common/Types/Text";
import TracesQueueService from "./Queue/TracesQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "./TraceDropFilterService";
import TraceScrubRuleService from "./TraceScrubRuleService";
import TracePipelineService, {
  LoadedTracePipeline,
} from "./TracePipelineService";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import {
  TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE,
  TELEMETRY_TRACE_FLUSH_BATCH_SIZE,
} from "../Config";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";

type CompiledTraceScrubRule = {
  rule: TraceScrubRule;
  regex: RegExp;
};

type ParsedUnixNano = {
  unixNano: number;
  nano: string;
  iso: string;
  date: Date;
};

type ExceptionEventPayload = {
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  spanId: string;
  traceId: string;
  spanStatusCode: SpanStatus;
  spanName: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  escaped: boolean | null;
  attributes: JSONObject;
  time: ParsedUnixNano;
  fingerprint: string;
  release: string;
  environment: string;
  parsedFrames: string;
  serviceMetadata: TelemetryServiceMetadata;
};

/*
 * Exception content lifted verbatim from a span's exception event.
 * Deliberately unfingerprinted and unscrubbed: rows are only built
 * AFTER the span has survived the drop filter and passed through the
 * scrub rules, so exception storage sees the same post-scrub view of
 * the data as the Span row itself (mirrors the logs path, which
 * extracts exceptions from the post-scrub log row).
 */
type RawSpanExceptionEvent = {
  message: string;
  stackTrace: string;
  exceptionType: string;
  escaped: boolean | null;
  attributes: JSONObject;
  time: ParsedUnixNano;
};

const SPAN_KIND_BY_OTEL_INT: Record<number, SpanKind> = {
  1: SpanKind.Internal,
  2: SpanKind.Server,
  3: SpanKind.Client,
  4: SpanKind.Producer,
  5: SpanKind.Consumer,
};

class TraceStorageFlushError extends Error {
  public constructor(error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);
    super(`Failed to flush traces to ClickHouse: ${message}`);
    this.name = "TraceStorageFlushError";

    if (error instanceof Error && error.stack) {
      this.stack = `${this.stack}\nCaused by: ${error.stack}`;
    }
  }
}

export default class OtelTracesIngestService extends OtelIngestBaseService {
  /**
   * OTLP wire format encodes span kind as an integer (1=Internal, 2=Server,
   * ...). Filter/drop/scrub expressions configured in the UI compare against
   * the OpenTelemetry string form ('SPAN_KIND_SERVER'). Translate at ingest
   * time so downstream evaluators see a stable string.
   */
  private static mapSpanKind(rawKind: unknown): SpanKind {
    if (typeof rawKind === "number") {
      return SPAN_KIND_BY_OTEL_INT[rawKind] || SpanKind.Internal;
    }
    if (typeof rawKind === "string") {
      const asInt: number = parseInt(rawKind, 10);
      if (!isNaN(asInt) && SPAN_KIND_BY_OTEL_INT[asInt]) {
        return SPAN_KIND_BY_OTEL_INT[asInt]!;
      }
      if (
        rawKind === SpanKind.Server ||
        rawKind === SpanKind.Client ||
        rawKind === SpanKind.Producer ||
        rawKind === SpanKind.Consumer ||
        rawKind === SpanKind.Internal
      ) {
        return rawKind as SpanKind;
      }
    }
    return SpanKind.Internal;
  }

  /*
   * Hand accumulated span rows to the shared fan-in writer, which batches
   * them ACROSS jobs and inserts through a small per-pod concurrency gate
   * (see TelemetryFanInWriter). Awaiting this method is only the writer's
   * acceptance/backpressure gate — durability acks land in `pendingAcks`
   * and MUST be awaited before the job completes (ack-after-flush).
   */
  private static async submitSpansBuffer(
    spans: Array<JSONObject>,
    pendingAcks: Array<Promise<void>>,
    force: boolean = false,
  ): Promise<void> {
    while (
      spans.length >= TELEMETRY_TRACE_FLUSH_BATCH_SIZE ||
      (force && spans.length > 0)
    ) {
      const batch: Array<JSONObject> = spans.splice(
        0,
        Math.min(spans.length, TELEMETRY_TRACE_FLUSH_BATCH_SIZE),
      );

      if (batch.length === 0) {
        continue;
      }

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        SpanService,
        batch,
      );
      pendingAcks.push(
        submission.flushed.catch((error: Error) => {
          throw new TraceStorageFlushError(error);
        }),
      );
    }
  }

  private static async submitExceptionsBuffer(
    exceptions: Array<JSONObject>,
    pendingAcks: Array<Promise<void>>,
    force: boolean = false,
  ): Promise<void> {
    while (
      exceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE ||
      (force && exceptions.length > 0)
    ) {
      const batch: Array<JSONObject> = exceptions.splice(
        0,
        Math.min(exceptions.length, TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE),
      );

      if (batch.length === 0) {
        continue;
      }

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        ExceptionInstanceService,
        batch,
      );
      pendingAcks.push(
        submission.flushed.catch((error: Error) => {
          throw new TraceStorageFlushError(error);
        }),
      );
    }
  }

  @CaptureSpan()
  public static async ingestTraces(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      /*
       * Send the 200 first, then enqueue the raw request bytes. The
       * heavy protobuf decode + toJSON used to run here on the
       * Express event loop, blocking all other requests (including
       * dashboard reads). The worker now handles it.
       */
      Response.sendEmptySuccessResponse(req, res);

      await TracesQueueService.addTraceIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processTracesFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processTracesAsync(req);
  }

  @CaptureSpan()
  private static async processTracesAsync(req: ExpressRequest): Promise<void> {
    /*
     * Durability acks from the fan-in writer, one per submitted batch. The
     * job only completes once every ack has resolved (ack-after-flush), so
     * a payload whose rows never landed fails and is retried by BullMQ.
     * Declared outside the try so the catch can settle them — an error
     * thrown mid-processing must not leave rejected acks unobserved.
     */
    const pendingAcks: Array<Promise<void>> = [];

    try {
      const resourceSpans: JSONArray = req.body["resourceSpans"] as JSONArray;

      if (!resourceSpans || !Array.isArray(resourceSpans)) {
        /*
         * Nothing to ingest. Reached when the out-of-band body was lost
         * (TTL elapsed before the worker ran — decodeFromQueue returns {})
         * or the payload genuinely carried no resourceSpans. Skip, do NOT
         * throw: this runs in the worker after the 200 was already sent, so
         * throwing only burns retries (the body won't reappear) and masks
         * the real first-attempt error behind "Invalid resourceSpans format".
         */
        logger.warn(
          "No resourceSpans to ingest (empty or lost body); skipping batch.",
        );
        logger.warn(getLogAttributesFromRequest(req as RequestLike));
        return;
      }

      /*
       * Canonicalize host.name casing so the resolved hostIdentifier and
       * the stored resource.host.name attribute share one casing, keeping
       * host-scoped trace queries matching via the fast query path.
       */
      OtelIngestBaseService.normalizeHostNameAttributesInPlace(resourceSpans);

      const dbSpans: Array<JSONObject> = [];
      const dbExceptions: Array<JSONObject> = [];
      /*
       * Pending TelemetryException (Postgres) upserts for this batch.
       * The old code did one fire-and-forget findOneBy + update/create
       * pair per exception event, which (a) burnt one Postgres
       * round-trip per event and (b) lost occuranceCount increments
       * under concurrent writes because the +1 was read-modify-write
       * in JS. We now buffer the payloads and flush them in one
       * batched ON CONFLICT statement (per
       * ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch) at the
       * end of the worker job, which collapses thousands of
       * round-trips into one and lets Postgres do the increment
       * atomically.
       */
      const pendingExceptionUpserts: Array<TelemetryExceptionPayload> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalSpansProcessed: number = 0;

      const projectId: ObjectID = (req as TelemetryRequest).projectId;

      // Load trace pipeline artifacts once per batch (60s cached inside services).
      let dropFilters: Array<LoadedTraceDropFilter> = [];
      let scrubRules: Array<CompiledTraceScrubRule> = [];
      let pipelines: Array<LoadedTracePipeline> = [];
      try {
        [dropFilters, scrubRules, pipelines] = await Promise.all([
          TraceDropFilterService.loadDropFilters(projectId),
          TraceScrubRuleService.loadScrubRules(projectId),
          TracePipelineService.loadPipelines(projectId),
        ]);
      } catch (err) {
        logger.warn(
          `Failed to load trace pipeline rules for project ${projectId.toString()}; skipping: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        dropFilters = [];
        scrubRules = [];
        pipelines = [];
      }

      let resourceSpanCounter: number = 0;
      for (const resourceSpan of resourceSpans) {
        try {
          if (resourceSpanCounter % 25 === 0) {
            await EventLoop.yieldToEventLoop();
          }
          resourceSpanCounter++;
          const resourceAttributes_raw: JSONArray =
            ((resourceSpan["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [];

          // Producer-declared entities (authoritative when present).
          const resourceEntityRefs: Array<ResourceEntityRef> =
            OtelPayloadDecoder.getEntityRefsFromResource(
              resourceSpan["resource"] as JSONObject | undefined,
            );

          /*
           * K8s cluster and Docker host discovery are independent — they
           * inspect different resource attributes and don't share state.
           * Run them concurrently so per-resource Postgres latency
           * collapses from `t(k8s) + t(docker)` to `max(t(k8s), t(docker))`.
           * `autoDiscoverHost` still has to wait because it consumes
           * the two ids above.
           */
          const [kubernetesClusterId, dockerHostId, podmanHostId]: [
            ObjectID | null,
            ObjectID | null,
            ObjectID | null,
          ] = await Promise.all([
            this.autoDiscoverKubernetesCluster({
              projectId,
              attributes: resourceAttributes_raw,
            }),
            this.autoDiscoverDockerHost({
              projectId,
              attributes: resourceAttributes_raw,
            }),
            this.autoDiscoverPodmanHost({
              projectId,
              attributes: resourceAttributes_raw,
            }),
          ]);

          /*
           * Generic Host auto-discovery from resource attributes.
           * Traces don't carry infra metrics; we gate on resource
           * signals (os.type / container.runtime) so app-only traces
           * don't flood the Hosts list. K8s telemetry routes to the
           * KubernetesCluster id instead.
           */
          const hostId: ObjectID | null = await this.autoDiscoverHost({
            projectId,
            attributes: resourceAttributes_raw,
            hasInfraSignal: false,
            dockerHostId,
            podmanHostId,
            kubernetesClusterId,
          });

          const serverlessFunctionId: ObjectID | null =
            await this.autoDiscoverServerless({
              projectId,
              attributes: resourceAttributes_raw,
            });

          const cloudResourceId: ObjectID | null =
            await this.autoDiscoverCloudResource({
              projectId,
              attributes: resourceAttributes_raw,
            });

          const rumApplicationId: ObjectID | null = await this.autoDiscoverRum({
            projectId,
            attributes: resourceAttributes_raw,
          });

          const serviceMetadata: TelemetryServiceMetadata =
            await this.resolveTelemetryResource({
              req,
              attributes: resourceAttributes_raw,
              projectId,
              hostId,
              dockerHostId,
              podmanHostId,
              kubernetesClusterId,
              serverlessFunctionId,
              cloudResourceId,
              rumApplicationId,
              entityRefs: resourceEntityRefs,
            });
          const serviceName: string = serviceMetadata.serviceName;

          serviceDictionary[serviceName] = serviceMetadata;

          const stampHostName: string | null =
            OtelIngestBaseService.getStringAttribute(
              resourceAttributes_raw,
              "host.name",
            );
          const stampClusterName: string | null =
            OtelIngestBaseService.getClusterNameFromAttributes(
              resourceAttributes_raw,
            );

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...(serviceMetadata.primaryEntityType === ServiceType.OpenTelemetry
              ? TelemetryUtil.getAttributesForServiceIdAndServiceName({
                  serviceId: serviceMetadata.primaryEntityId!,
                  serviceName: serviceName,
                })
              : {}),
            ...(hostId && stampHostName
              ? TelemetryUtil.getAttributesForHostIdAndHostName({
                  hostId,
                  hostName: stampHostName,
                })
              : {}),
            ...(dockerHostId && stampHostName
              ? TelemetryUtil.getAttributesForDockerHostIdAndHostName({
                  dockerHostId,
                  hostName: stampHostName,
                })
              : {}),
            ...(podmanHostId && stampHostName
              ? TelemetryUtil.getAttributesForPodmanHostIdAndHostName({
                  podmanHostId,
                  hostName: stampHostName,
                })
              : {}),
            ...(kubernetesClusterId && stampClusterName
              ? TelemetryUtil.getAttributesForKubernetesClusterIdAndName({
                  kubernetesClusterId,
                  clusterName: stampClusterName,
                })
              : {}),
            ...TelemetryUtil.getAttributes({
              items: resourceAttributes_raw,
              prefixKeysWithString: "resource",
            }),
          };

          const scopeSpans: JSONArray = resourceSpan["scopeSpans"] as JSONArray;

          if (!scopeSpans || !Array.isArray(scopeSpans)) {
            logger.warn("Invalid scopeSpans format, skipping resource span");
            continue;
          }

          let scopeSpanCounter: number = 0;
          for (const scopeSpan of scopeSpans) {
            try {
              if (scopeSpanCounter % 50 === 0) {
                await EventLoop.yieldToEventLoop();
              }
              scopeSpanCounter++;
              const spans: JSONArray = scopeSpan["spans"] as JSONArray;

              if (!spans || !Array.isArray(spans)) {
                logger.warn("Invalid spans format, skipping scope span");
                continue;
              }

              let spanCounter: number = 0;
              for (const span of spans) {
                try {
                  if (spanCounter % 200 === 0) {
                    await EventLoop.yieldToEventLoop();
                  }
                  spanCounter++;

                  const spanAttributes: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (span["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "",
                    }),
                  };

                  if (
                    scopeSpan["scope"] &&
                    Object.keys(scopeSpan["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeSpan[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      spanAttributes[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  /*
                   * Stored as a ClickHouse Array column and only read
                   * back as an unordered set. Skip the sort the shared
                   * TelemetryUtil.getAttributeKeys helper does — it's
                   * an O(N log N) cost per record that the downstream
                   * consumers do not depend on.
                   */
                  const attributeKeys: Array<string> =
                    Object.keys(spanAttributes);

                  const primaryEntityId: ObjectID =
                    serviceDictionary[serviceName]!.primaryEntityId!;

                  const spanId: string = this.convertBase64ToHexSafe(
                    span["spanId"] as string | undefined,
                  );
                  const traceId: string = this.convertBase64ToHexSafe(
                    span["traceId"] as string | undefined,
                  );
                  const parentSpanId: string = this.convertBase64ToHexSafe(
                    span["parentSpanId"] as string | undefined,
                  );

                  const startTime: ParsedUnixNano = this.safeParseUnixNano(
                    (span as JSONObject)["startTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "span startTimeUnixNano",
                  );
                  const endTime: ParsedUnixNano = this.safeParseUnixNano(
                    (span as JSONObject)["endTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "span endTimeUnixNano",
                  );

                  const durationUnixNano: string = this.calculateDurationNano(
                    startTime,
                    endTime,
                  );

                  let statusCode: SpanStatus = SpanStatus.Unset;
                  let statusMessage: string = "";
                  try {
                    statusCode = this.getSpanStatusCode(
                      span["status"] as JSONObject,
                    );
                    statusMessage =
                      ((span["status"] as JSONObject)?.["message"] as string) ||
                      "";
                  } catch (statusError) {
                    logger.warn(
                      `Error processing span status: ${statusError instanceof Error ? statusError.message : String(statusError)}`,
                    );
                  }

                  const spanName: string = (span["name"] as string) || "";
                  const spanKind: SpanKind =
                    OtelTracesIngestService.mapSpanKind(span["kind"]);
                  const traceState: string =
                    (span["traceState"] as string) || "";

                  let spanEvents: Array<JSONObject> = [];
                  let hasException: boolean = false;
                  let rawSpanExceptions: Array<RawSpanExceptionEvent> = [];
                  try {
                    const spanEventsResult: {
                      events: Array<JSONObject>;
                      hasException: boolean;
                      rawExceptions: Array<RawSpanExceptionEvent>;
                    } = this.getSpanEvents(span["events"] as JSONArray);
                    spanEvents = spanEventsResult.events;
                    hasException = spanEventsResult.hasException;
                    rawSpanExceptions = spanEventsResult.rawExceptions;
                  } catch (eventsError) {
                    logger.warn(
                      `Error processing span events: ${eventsError instanceof Error ? eventsError.message : String(eventsError)}`,
                    );
                    spanEvents = [];
                  }

                  let spanLinks: Array<JSONObject> = [];
                  try {
                    spanLinks = this.getSpanLinks(span["links"] as JSONArray);
                  } catch (linksError) {
                    logger.warn(
                      `Error processing span links: ${linksError instanceof Error ? linksError.message : String(linksError)}`,
                    );
                    spanLinks = [];
                  }

                  /*
                   * Denormalize first-class LLM / GenAI / agent fields (if any)
                   * from the span attributes for fast AI-observability queries.
                   */
                  const llmFields: LlmSpanFields =
                    LlmSpanUtil.extract(spanAttributes);

                  let spanRow: JSONObject = this.buildSpanRow({
                    projectId: projectId,
                    primaryEntityId: primaryEntityId,
                    attributes: spanAttributes,
                    attributeKeys: attributeKeys,
                    traceId: traceId,
                    spanId: spanId,
                    parentSpanId: parentSpanId,
                    traceState: traceState,
                    statusCode: statusCode,
                    statusMessage: statusMessage,
                    name: spanName,
                    kind: spanKind,
                    startTime: startTime,
                    endTime: endTime,
                    durationUnixNano: durationUnixNano,
                    events: spanEvents,
                    links: spanLinks,
                    hasException: hasException,
                    isRootSpan: !parentSpanId || parentSpanId === "",
                    llmFields: llmFields,
                    serviceMetadata: serviceDictionary[serviceName]!,
                  });

                  /*
                   * Apply trace pipeline: drop filter -> scrub -> pipeline.
                   * Order matches logs: a dropped span never reaches scrub/pipeline.
                   */
                  if (
                    dropFilters.length > 0 &&
                    TraceDropFilterService.shouldDropSpan(spanRow, dropFilters)
                  ) {
                    continue;
                  }

                  if (scrubRules.length > 0) {
                    spanRow = TraceScrubRuleService.scrubSpan(
                      spanRow,
                      scrubRules,
                    );
                  }

                  if (pipelines.length > 0) {
                    spanRow = TracePipelineService.processSpan(
                      spanRow,
                      pipelines,
                    );
                  }

                  /*
                   * Exception rows are only built for spans that survived
                   * the drop filter, and on post-scrub content — see
                   * collectSpanExceptions.
                   */
                  if (rawSpanExceptions.length > 0) {
                    this.collectSpanExceptions({
                      rawExceptions: rawSpanExceptions,
                      spanContext: {
                        projectId: projectId,
                        primaryEntityId: primaryEntityId,
                        spanId: spanId,
                        traceId: traceId,
                        spanStatusCode: statusCode,
                        spanName: spanName,
                        resourceAttributes: resourceAttributes,
                        serviceMetadata: serviceDictionary[serviceName]!,
                      },
                      scrubRules: scrubRules,
                      dbExceptions: dbExceptions,
                      pendingExceptionUpserts: pendingExceptionUpserts,
                    });
                  }

                  dbSpans.push(spanRow);
                  totalSpansProcessed++;

                  if (dbSpans.length >= TELEMETRY_TRACE_FLUSH_BATCH_SIZE) {
                    await this.submitSpansBuffer(dbSpans, pendingAcks);
                  }

                  if (
                    dbExceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE
                  ) {
                    await this.submitExceptionsBuffer(
                      dbExceptions,
                      pendingAcks,
                    );
                  }
                } catch (spanError) {
                  if (spanError instanceof TraceStorageFlushError) {
                    throw spanError;
                  }
                  logger.error("Error processing individual span:");
                  logger.error(spanError);
                  logger.error(`Span data: ${JSON.stringify(span)}`);
                }
              }
            } catch (scopeError) {
              if (scopeError instanceof TraceStorageFlushError) {
                throw scopeError;
              }
              logger.error("Error processing scope span:");
              logger.error(scopeError);
              logger.error(`Scope span data: ${JSON.stringify(scopeSpan)}`);
            }
          }
        } catch (resourceError) {
          if (resourceError instanceof TraceStorageFlushError) {
            throw resourceError;
          }
          logger.error("Error processing resource span:");
          logger.error(resourceError);
          logger.error(`Resource span data: ${JSON.stringify(resourceSpan)}`);
        }
      }

      await this.submitSpansBuffer(dbSpans, pendingAcks, true);
      await this.submitExceptionsBuffer(dbExceptions, pendingAcks, true);

      await Promise.all([
        /*
         * Ack-after-flush: wait for every fan-in batch containing this
         * job's rows to durably land in ClickHouse before the job is
         * allowed to succeed. A rejected ack (batch definitively failed
         * after the writer's own retries) fails the job so BullMQ
         * re-processes the payload.
         */
        ...pendingAcks,
        /*
         * Flush the Postgres TelemetryException upserts in one
         * batched ON CONFLICT statement (chunked internally). Wrap
         * in a local try so a Postgres outage cannot fail the whole
         * worker job — the ClickHouse-side ExceptionInstance rows
         * have already been queued in `dbExceptions` above and are
         * the source of truth; the TelemetryException Postgres
         * table is a denormalised summary used by the dashboard.
         * Losing one flush under failure produces a stale dashboard
         * count, not lost telemetry data.
         */
        ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(
          pendingExceptionUpserts,
        ).catch((err: Error) => {
          logger.error(
            "Telemetry exception batch upsert failed; dashboard counts may lag this batch.",
            getLogAttributesFromRequest(req as RequestLike),
          );
          logger.error(err);
        }),
      ]);

      if (totalSpansProcessed === 0) {
        logger.warn("No valid spans were processed from the request");
        return;
      }

      logger.debug(
        `Successfully processed ${totalSpansProcessed} spans for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbSpans.length = 0;
        dbExceptions.length = 0;
        pendingExceptionUpserts.length = 0;
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      /*
       * Settle all outstanding write acks before rethrowing: an error
       * thrown mid-processing (span parse failure, lost body, ...) must
       * not leave still-pending ack promises to reject unobserved later.
       * The original error stays the one reported to BullMQ.
       */
      await Promise.allSettled(pendingAcks);

      logger.error(
        "Critical error in processTracesAsync:",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  private static getSpanStatusCode(status: JSONObject): SpanStatus {
    let spanStatusCode: SpanStatus = SpanStatus.Unset;

    if (status?.["code"] && typeof status["code"] === "number") {
      spanStatusCode = status["code"] as number;
    } else if (status?.["code"] && typeof status["code"] === "string") {
      if (status["code"] === "STATUS_CODE_UNSET") {
        spanStatusCode = SpanStatus.Unset;
      } else if (status["code"] === "STATUS_CODE_OK") {
        spanStatusCode = SpanStatus.Ok;
      } else if (status["code"] === "STATUS_CODE_ERROR") {
        spanStatusCode = SpanStatus.Error;
      }
    }

    return spanStatusCode;
  }

  private static getSpanEvents(events: JSONArray): {
    events: Array<JSONObject>;
    hasException: boolean;
    rawExceptions: Array<RawSpanExceptionEvent>;
  } {
    const spanEvents: Array<JSONObject> = [];
    const rawExceptions: Array<RawSpanExceptionEvent> = [];
    let hasException: boolean = false;

    if (events && Array.isArray(events)) {
      for (const event of events) {
        try {
          const eventObject: JSONObject = event as JSONObject;
          const parsedTime: ParsedUnixNano = this.safeParseUnixNano(
            eventObject["timeUnixNano"] as string | number | undefined,
            "span event timeUnixNano",
          );

          const eventAttributes: JSONObject = TelemetryUtil.getAttributes({
            items: (eventObject["attributes"] as JSONArray) || [],
            prefixKeysWithString: "",
          });

          const eventName: string = (eventObject["name"] as string) || "";

          spanEvents.push({
            time: parsedTime.iso,
            timeUnixNano: parsedTime.nano,
            name: eventName,
            attributes: eventAttributes,
          });

          if (eventName === SpanEventType.Exception) {
            hasException = true;

            const escapedParsed: boolean | null = this.toBoolean(
              eventAttributes["exception.escaped"],
            );

            const exceptionAttributes: JSONObject = { ...eventAttributes };
            for (const key of Object.keys(exceptionAttributes)) {
              if (key.startsWith("exception.")) {
                delete exceptionAttributes[key];
              }
            }

            /*
             * Only lift the raw content here. Fingerprinting and row
             * building happen in collectSpanExceptions AFTER the span
             * has cleared the drop filter and scrub rules — a dropped
             * span must not leave exception rows behind, and scrubbed
             * secrets must not survive in the exception copy of the
             * event attributes.
             */
            rawExceptions.push({
              message: (eventAttributes["exception.message"] as string) || "",
              stackTrace:
                (eventAttributes["exception.stacktrace"] as string) || "",
              exceptionType:
                (eventAttributes["exception.type"] as string) || "",
              escaped: escapedParsed === null ? false : escapedParsed,
              attributes: exceptionAttributes,
              time: parsedTime,
            });
          }
        } catch (eventError) {
          logger.warn(
            `Error processing span event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
          );
        }
      }
    }

    return { events: spanEvents, hasException, rawExceptions };
  }

  /*
   * Build ClickHouse ExceptionInstance rows + Postgres TelemetryException
   * upsert payloads for a span's exception events. Runs post-drop and
   * post-scrub: stored content is the scrubbed view, while the fingerprint
   * hashes the pre-scrub content to keep existing group identities stable
   * (see the comment at the getFingerprint call).
   *
   * Buffering rationale: the legacy code called
   * ExceptionUtil.saveOrUpdateTelemetryException fire-and-forget per
   * event, which produced one Postgres round-trip per exception and lost
   * occuranceCount increments under concurrent writes. Aggregation by
   * fingerprint + atomic increment now happens inside
   * saveOrUpdateTelemetryExceptionsBatch at the end of the worker job.
   *
   * Every primaryEntityType gets a TelemetryException summary row. The
   * table's primaryEntityId is polymorphic (the FK to Service was
   * dropped), so exceptions from Host / DockerHost / KubernetesCluster
   * and unattributed (Unknown) telemetry land in the Issues list too —
   * attributed by primaryEntityType — instead of being dropped from the
   * summary.
   */
  private static collectSpanExceptions(data: {
    rawExceptions: Array<RawSpanExceptionEvent>;
    spanContext: {
      projectId: ObjectID;
      primaryEntityId: ObjectID;
      spanId: string;
      traceId: string;
      spanStatusCode: SpanStatus;
      spanName: string;
      resourceAttributes: Dictionary<AttributeType | Array<AttributeType>>;
      serviceMetadata: TelemetryServiceMetadata;
    };
    scrubRules: Array<CompiledTraceScrubRule>;
    dbExceptions: Array<JSONObject>;
    pendingExceptionUpserts: Array<TelemetryExceptionPayload>;
  }): void {
    const { spanContext } = data;

    for (const rawException of data.rawExceptions) {
      try {
        const scrubbed: {
          message: string;
          stackTrace: string;
          attributes: JSONObject;
        } =
          data.scrubRules.length > 0
            ? TraceScrubRuleService.scrubExceptionContent(
                {
                  message: rawException.message,
                  stackTrace: rawException.stackTrace,
                  attributes: rawException.attributes,
                },
                data.scrubRules,
              )
            : rawException;

        const message: string = scrubbed.message;
        const stackTrace: string = scrubbed.stackTrace;
        const exceptionType: string = rawException.exceptionType;

        /*
         * Fingerprint deliberately computed on the PRE-scrub content while
         * everything STORED uses the scrubbed values. The fingerprint is a
         * one-way SHA-256 over normalized text — it never surfaces content
         * — but it IS the group identity: hashing post-scrub text would
         * re-fingerprint every existing group the moment a project adds a
         * scrub rule matching its exception messages, orphaning the old
         * rows (with their resolved/archived/classification state) and
         * restarting occurrence counts from zero.
         */
        const fingerprint: string = ExceptionUtil.getFingerprint({
          projectId: spanContext.projectId,
          primaryEntityId: spanContext.primaryEntityId,
          message: rawException.message,
          stackTrace: rawException.stackTrace,
          exceptionType: exceptionType,
        });

        // Extract release and environment from resource attributes
        const release: string =
          (spanContext.resourceAttributes[
            "resource.service.version"
          ] as string) || "";
        const environment: string =
          (spanContext.resourceAttributes[
            "resource.deployment.environment"
          ] as string) || "";

        // Parse stack trace into structured frames
        let parsedFramesJson: string = "[]";
        if (stackTrace) {
          try {
            const parsed: ParsedStackTrace = StackTraceParser.parse(stackTrace);
            parsedFramesJson = JSON.stringify(parsed.frames);
          } catch {
            parsedFramesJson = "[]";
          }
        }

        const exceptionData: ExceptionEventPayload = {
          projectId: spanContext.projectId,
          primaryEntityId: spanContext.primaryEntityId,
          spanId: spanContext.spanId,
          traceId: spanContext.traceId,
          spanStatusCode: spanContext.spanStatusCode,
          spanName: spanContext.spanName,
          message: message,
          stackTrace: stackTrace,
          exceptionType: exceptionType,
          escaped: rawException.escaped,
          attributes: scrubbed.attributes,
          time: rawException.time,
          fingerprint: fingerprint,
          release: release,
          environment: environment,
          parsedFrames: parsedFramesJson,
          serviceMetadata: spanContext.serviceMetadata,
        };

        data.dbExceptions.push(this.buildExceptionRow(exceptionData));

        data.pendingExceptionUpserts.push({
          fingerprint: fingerprint,
          projectId: spanContext.projectId,
          primaryEntityId: spanContext.primaryEntityId,
          primaryEntityType: spanContext.serviceMetadata.primaryEntityType,
          unhandled: rawException.escaped === true,
          ...(exceptionType
            ? {
                exceptionType: exceptionType,
              }
            : {}),
          ...(message
            ? {
                message: message,
              }
            : {}),
          ...(stackTrace
            ? {
                stackTrace: stackTrace,
              }
            : {}),
          ...(release
            ? {
                release: release,
              }
            : {}),
          ...(environment
            ? {
                environment: environment,
              }
            : {}),
        });
      } catch (exceptionError) {
        logger.warn(
          `Error processing span exception event: ${exceptionError instanceof Error ? exceptionError.message : String(exceptionError)}`,
        );
      }
    }
  }

  private static getSpanLinks(links: JSONArray): Array<JSONObject> {
    const spanLinks: Array<JSONObject> = [];

    if (links && Array.isArray(links)) {
      for (const link of links) {
        try {
          const linkObject: JSONObject = link as JSONObject;
          spanLinks.push({
            traceId: this.convertBase64ToHexSafe(
              linkObject["traceId"] as string | undefined,
            ),
            spanId: this.convertBase64ToHexSafe(
              linkObject["spanId"] as string | undefined,
            ),
            attributes: TelemetryUtil.getAttributes({
              items: (linkObject["attributes"] as JSONArray) || [],
              prefixKeysWithString: "",
            }),
          });
        } catch (linkError) {
          logger.warn(
            `Error processing span link: ${linkError instanceof Error ? linkError.message : String(linkError)}`,
          );
        }
      }
    }

    return spanLinks;
  }

  private static buildSpanRow(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    attributes: Dictionary<AttributeType | Array<AttributeType>>;
    attributeKeys: Array<string>;
    traceId: string;
    spanId: string;
    parentSpanId: string;
    traceState: string;
    statusCode: SpanStatus;
    statusMessage: string;
    name: string;
    kind: SpanKind;
    startTime: ParsedUnixNano;
    endTime: ParsedUnixNano;
    durationUnixNano: string;
    events: Array<JSONObject>;
    links: Array<JSONObject>;
    hasException: boolean;
    isRootSpan: boolean;
    llmFields: LlmSpanFields;
    serviceMetadata: TelemetryServiceMetadata;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "traces",
      bucketKey: data.statusCode,
      serviceConfig: data.serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
      projectConfig: data.serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
    });
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );
    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.primaryEntityId.toString(),
      primaryEntityType: data.serviceMetadata.primaryEntityType,
      entityKeys: data.serviceMetadata.entityKeys || [],
      ...getScalarEntityKeyColumns(data.serviceMetadata),
      startTime: OneUptimeDate.toClickhouseDateTime(data.startTime.date),
      endTime: OneUptimeDate.toClickhouseDateTime(data.endTime.date),
      startTimeUnixNano: data.startTime.nano,
      endTimeUnixNano: data.endTime.nano,
      durationUnixNano: data.durationUnixNano,
      traceId: data.traceId,
      spanId: data.spanId,
      parentSpanId: data.parentSpanId,
      traceState: data.traceState || "",
      attributes: data.attributes,
      attributeKeys: data.attributeKeys,
      statusCode: Number(data.statusCode),
      statusMessage: data.statusMessage || "",
      name: data.name,
      kind: data.kind,
      events: data.events,
      links: data.links,
      hasException: data.hasException,
      isRootSpan: data.isRootSpan,
      isLlmSpan: data.llmFields.isLlmSpan,
      llmSystem: data.llmFields.llmSystem,
      llmOperation: data.llmFields.llmOperation,
      llmRequestModel: data.llmFields.llmRequestModel,
      llmResponseModel: data.llmFields.llmResponseModel,
      llmAgentName: data.llmFields.llmAgentName,
      llmToolName: data.llmFields.llmToolName,
      llmInputTokens: data.llmFields.llmInputTokens,
      llmOutputTokens: data.llmFields.llmOutputTokens,
      llmTotalTokens: data.llmFields.llmTotalTokens,
      llmCost: data.llmFields.llmCost,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };
  }

  private static buildExceptionRow(data: ExceptionEventPayload): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "traces",
      bucketKey: data.spanStatusCode,
      serviceConfig: data.serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
      projectConfig: data.serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
    });
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );
    const attributes: JSONObject = data.attributes || {};

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.primaryEntityId.toString(),
      primaryEntityType: data.serviceMetadata.primaryEntityType,
      entityKeys: data.serviceMetadata.entityKeys || [],
      ...getScalarEntityKeyColumns(data.serviceMetadata),
      time: OneUptimeDate.toClickhouseDateTime(data.time.date),
      timeUnixNano: data.time.nano,
      exceptionType: data.exceptionType || "",
      stackTrace: data.stackTrace || "",
      message: data.message || "",
      spanStatusCode: Number(data.spanStatusCode),
      escaped:
        data.escaped === null || data.escaped === undefined
          ? null
          : Boolean(data.escaped),
      traceId: data.traceId || "",
      spanId: data.spanId || "",
      fingerprint: data.fingerprint,
      spanName: data.spanName || "",
      release: data.release || "",
      environment: data.environment || "",
      parsedFrames: data.parsedFrames || "[]",
      attributes: attributes,
      attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };
  }

  private static safeParseUnixNano(
    value: string | number | undefined,
    context: string,
  ): ParsedUnixNano {
    let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

    if (value !== undefined && value !== null) {
      try {
        if (typeof value === "string") {
          const parsed: number = Number.parseFloat(value);
          if (!Number.isNaN(parsed)) {
            numericValue = parsed;
          } else {
            throw new Error(`Invalid timestamp string: ${value}`);
          }
        } else if (typeof value === "number") {
          if (!Number.isFinite(value)) {
            throw new Error(`Invalid timestamp number: ${value}`);
          }
          numericValue = value;
        }
      } catch (error) {
        logger.warn(
          `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
        );
        numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
      }
    }

    numericValue = Math.trunc(numericValue);
    const date: Date = OneUptimeDate.fromUnixNano(numericValue);
    const iso: string = OneUptimeDate.toString(date);

    return {
      unixNano: numericValue,
      nano: numericValue.toString(),
      iso: iso,
      date: date,
    };
  }

  private static calculateDurationNano(
    start: ParsedUnixNano,
    end: ParsedUnixNano,
  ): string {
    const duration: number = Math.max(
      0,
      Math.trunc(end.unixNano - start.unixNano),
    );
    return duration.toString();
  }

  /*
   * OTLP/JSON sends trace/span ids as 16/32-char hex, OTLP/protobuf as
   * base64 — Text.convertOtlpIdToHex tells them apart so hex ids are
   * never base64-decoded into garbage.
   */
  private static convertBase64ToHexSafe(value: string | undefined): string {
    return Text.convertOtlpIdToHex(value);
  }

  private static toBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized: string = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }

    return null;
  }
}
