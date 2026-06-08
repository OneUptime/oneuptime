import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Text from "Common/Types/Text";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import LogsQueueService from "./Queue/LogsQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import EntityExtractor from "Common/Server/Utils/Telemetry/EntityExtractor";
import ExtractedEntity, {
  EntityMembership,
} from "Common/Types/Telemetry/ExtractedEntity";
import TelemetryEntityService from "Common/Server/Services/TelemetryEntityService";
import {
  TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE,
  TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED,
  TELEMETRY_LOG_FLUSH_BATCH_SIZE,
} from "../Config";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ExceptionUtil, { TelemetryExceptionPayload } from "../Utils/Exception";
import LogExceptionExtractor, {
  ExtractedLogException,
} from "Common/Server/Utils/Telemetry/LogExceptionExtractor";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import LogPipelineService, { LoadedPipeline } from "./LogPipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "./LogDropFilterService";
import LogScrubRuleService from "./LogScrubRuleService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import DockerResourceService, {
  ParsedDockerResource,
} from "Common/Server/Services/DockerResourceService";
import {
  extractInventoryResource,
  ExtractedInventoryRecord,
  INVENTORIED_RESOURCE_TYPES,
  ParsedKubernetesResource,
  ParsedKubernetesContainerRow,
} from "Common/Types/Kubernetes/KubernetesInventoryExtractor";
import {
  extractDockerInventoryResource,
  ExtractedDockerInventoryRecord,
  INVENTORY_KIND_ATTRIBUTE as DOCKER_INVENTORY_KIND_ATTRIBUTE,
  isInventoriedDockerKind,
} from "Common/Types/Docker/DockerInventoryExtractor";

const INVENTORIED_TYPE_SET: Set<string> = new Set(
  INVENTORIED_RESOURCE_TYPES.map((t: string) => {
    return t.toLowerCase();
  }),
);

export default class OtelLogsIngestService extends OtelIngestBaseService {
  private static async flushLogsBuffer(
    logs: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      logs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE ||
      (force && logs.length > 0)
    ) {
      const batchSize: number = Math.min(
        logs.length,
        TELEMETRY_LOG_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = logs.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await LogService.insertJsonRows(batch);
    }
  }

  /*
   * Flush log-derived ClickHouse ExceptionInstance rows. Mirrors
   * OtelTracesIngestService.flushExceptionsBuffer so the two ingest paths
   * write exception instances identically.
   */
  private static async flushExceptionsBuffer(
    exceptions: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      exceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE ||
      (force && exceptions.length > 0)
    ) {
      const batchSize: number = Math.min(
        exceptions.length,
        TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = exceptions.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await ExceptionInstanceService.insertJsonRows(batch);
    }
  }

  @CaptureSpan()
  public static async ingestLogs(
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
       * Respond first, then enqueue the raw bytes. Protobuf decode +
       * JSON normalization now happens in the worker so the HTTP
       * event loop isn't blocked on every ingest call.
       */
      Response.sendEmptySuccessResponse(req, res);

      await LogsQueueService.addLogIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processLogsFromQueue(req: ExpressRequest): Promise<void> {
    await this.processLogsAsync(req);
  }

  @CaptureSpan()
  private static async processLogsAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceLogs: JSONArray = req.body["resourceLogs"] as JSONArray;

      if (!resourceLogs || !Array.isArray(resourceLogs)) {
        logger.error(
          "Invalid resourceLogs format in request body",
          getLogAttributesFromRequest(req as RequestLike),
        );
        throw new BadRequestException("Invalid resourceLogs format");
      }

      /*
       * Canonicalize host.name casing so the resolved hostIdentifier and
       * the stored resource.host.name attribute share one casing and the
       * host-detail Logs tab keeps matching via the fast query path.
       */
      OtelIngestBaseService.normalizeHostNameAttributesInPlace(resourceLogs);

      const dbLogs: Array<JSONObject> = [];
      /*
       * Exceptions detected inside logs (explicit OTel exception.* attributes,
       * or a stack trace in an error/fatal body). Buffered and flushed exactly
       * like the trace span-event exception path: ClickHouse ExceptionInstance
       * rows in dbExceptions, and batched Postgres TelemetryException upserts in
       * pendingExceptionUpserts — so log-derived and span-derived exceptions
       * share fingerprints and land in the same Issues view.
       */
      const dbExceptions: Array<JSONObject> = [];
      const pendingExceptionUpserts: Array<TelemetryExceptionPayload> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalLogsProcessed: number = 0;

      /*
       * Buffer for k8s object snapshots flushed to the KubernetesResource
       * inventory table once per batch, keyed by clusterId. Populated only
       * when a log record carries the k8sobjects attribute set; otherwise
       * zero cost.
       */
      const k8sInventoryBuffer: Map<
        string,
        Array<ParsedKubernetesResource>
      > = new Map();

      /*
       * Parallel buffer for the per-container snapshot rows expanded
       * out of each Pod record. Empty for non-Pod kinds.
       */
      const k8sContainerBuffer: Map<
        string,
        Array<ParsedKubernetesContainerRow>
      > = new Map();

      /*
       * Docker inventory buffer keyed by docker host ID. Populated only
       * when a log record carries the Docker agent's snapshot envelope
       * attribute (oneuptime.docker.kind).
       */
      const dockerInventoryBuffer: Map<
        string,
        Array<ParsedDockerResource>
      > = new Map();

      // Load pipelines, drop filters, and scrub rules once per batch
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      let loadedPipelines: Array<LoadedPipeline> = [];
      let loadedDropFilters: Array<LoadedLogDropFilter> = [];
      let loadedScrubRules: Awaited<
        ReturnType<typeof LogScrubRuleService.loadScrubRules>
      > = [];
      try {
        loadedPipelines = await LogPipelineService.loadPipelines(projectId);
        loadedDropFilters =
          await LogDropFilterService.loadDropFilters(projectId);
        loadedScrubRules = await LogScrubRuleService.loadScrubRules(projectId);
      } catch (loadError) {
        logger.error("Error loading pipelines/drop filters/scrub rules:");
        logger.error(loadError);
      }

      let resourceLogCounter: number = 0;
      for (const resourceLog of resourceLogs) {
        try {
          if (resourceLogCounter % 50 === 0) {
            await Promise.resolve();
          }
          resourceLogCounter++;
          const resourceAttributes_raw: JSONArray =
            ((resourceLog["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [];

          /*
           * Auto-discover Kubernetes cluster and Docker host from
           * resource attributes. They look at disjoint attributes
           * and don't share state, so we issue both Postgres
           * lookups concurrently and only wait once. The cluster id
           * is also what the inventory hook below keys its buffer on.
           */
          const [kubernetesClusterId, dockerHostId]: [
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
          ]);

          /*
           * The OTel k8sobjects receiver tags each log record (not the
           * resource envelope) with `k8s.resource.name` (plural lowercase
           * kind). We check that per-record inside the loop below and
           * only parse when the cluster is known and the kind is
           * inventoried — zero cost on non-k8sobjects batches.
           */
          const isK8sInventoryEligible: boolean = Boolean(kubernetesClusterId);

          /*
           * Docker inventory eligibility — same shape as the K8s gate.
           * Per-record check happens inside the loop below since the
           * agent tags each line individually.
           */
          const isDockerInventoryEligible: boolean = Boolean(dockerHostId);

          /*
           * Generic Host auto-discovery. Logs don't carry infra metrics,
           * so we rely on resource attribute signals (host.id, host.arch,
           * os.type, container.runtime, k8s.cluster.name) to gate row
           * creation.
           */
          const hostId: ObjectID | null = await this.autoDiscoverHost({
            projectId,
            attributes: resourceAttributes_raw,
            hasInfraSignal: false,
            dockerHostId,
            kubernetesClusterId,
          });

          const serviceMetadata: TelemetryServiceMetadata =
            await this.resolveTelemetryResource({
              req,
              attributes: resourceAttributes_raw,
              projectId,
              hostId,
              dockerHostId,
              kubernetesClusterId,
            });
          const serviceName: string = serviceMetadata.serviceName;

          serviceDictionary[serviceName] = serviceMetadata;

          /*
           * Derive ALL OpenTelemetry entities present in this resource and
           * reduce to the membership stamped onto every log/exception row.
           * Additive — the primary serviceId/serviceType is unchanged.
           */
          const extractedEntities: Array<ExtractedEntity> =
            EntityExtractor.extractEntities({
              projectId,
              resourceAttributes: resourceAttributes_raw,
            });
          const entityMembership: EntityMembership =
            EntityExtractor.toMembership(extractedEntities);

          /*
           * Reconcile the entity registry + topology graph in the
           * background — never block signal ingest on it.
           */
          TelemetryEntityService.reconcileResource({
            projectId,
            entities: extractedEntities,
            primaryServiceType: serviceMetadata.serviceType,
            primaryServiceId: serviceMetadata.serviceId,
          }).catch(() => {
            // best-effort; errors are logged inside the service
          });

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
            ...(serviceMetadata.serviceType === ServiceType.OpenTelemetry
              ? TelemetryUtil.getAttributesForServiceIdAndServiceName({
                  serviceId: serviceMetadata.serviceId!,
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
          const scopeLogs: JSONArray = resourceLog["scopeLogs"] as JSONArray;

          if (!scopeLogs || !Array.isArray(scopeLogs)) {
            logger.warn("Invalid scopeLogs format, skipping resource log");
            continue;
          }

          let scopeLogCounter: number = 0;
          for (const scopeLog of scopeLogs) {
            try {
              if (scopeLogCounter % 100 === 0) {
                await Promise.resolve();
              }
              scopeLogCounter++;
              const logRecords: JSONArray = scopeLog["logRecords"] as JSONArray;

              if (!logRecords || !Array.isArray(logRecords)) {
                logger.warn("Invalid logRecords format, skipping scope log");
                continue;
              }

              let logRecordCounter: number = 0;
              for (const log of logRecords) {
                try {
                  if (logRecordCounter % 500 === 0) {
                    await Promise.resolve();
                  }
                  logRecordCounter++;

                  const attributesObject: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (log["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "",
                    }),
                  };

                  if (
                    scopeLog["scope"] &&
                    Object.keys(scopeLog["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeLog[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      attributesObject[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  /*
                   * `attributeKeys` is stored as a ClickHouse Array column
                   * and used downstream only as an unordered set (for
                   * "has this attribute?" checks). Skip the sort the
                   * shared TelemetryUtil.getAttributeKeys helper does:
                   * for a ~100-attr log row a single Object.keys is
                   * O(N), the sort is O(N log N), and with thousands
                   * of records per batch that sort cost was visible
                   * on flamegraphs.
                   */
                  const attributeKeys: Array<string> =
                    Object.keys(attributesObject);

                  const projectId: ObjectID = (req as TelemetryRequest)
                    .projectId;
                  const serviceId: ObjectID =
                    serviceDictionary[serviceName]!.serviceId!;

                  let timeUnixNanoNumeric: number =
                    OneUptimeDate.getCurrentDateAsUnixNano();
                  let timeDate: Date = OneUptimeDate.getCurrentDate();

                  if (log["timeUnixNano"]) {
                    try {
                      let timeUnixNano: number;
                      if (typeof log["timeUnixNano"] === "string") {
                        timeUnixNano = parseFloat(log["timeUnixNano"]);
                        if (isNaN(timeUnixNano)) {
                          throw new Error(
                            `Invalid timestamp string: ${log["timeUnixNano"]}`,
                          );
                        }
                      } else {
                        timeUnixNano =
                          (log["timeUnixNano"] as number) ||
                          OneUptimeDate.getCurrentDateAsUnixNano();
                      }

                      timeUnixNanoNumeric = timeUnixNano;
                      timeDate = OneUptimeDate.fromUnixNano(timeUnixNano);
                    } catch (timeError) {
                      logger.warn(
                        `Error processing timestamp ${log["timeUnixNano"]}: ${timeError instanceof Error ? timeError.message : String(timeError)}, using current time`,
                      );
                      timeUnixNanoNumeric =
                        OneUptimeDate.getCurrentDateAsUnixNano();
                      timeDate = OneUptimeDate.getCurrentDate();
                    }
                  } else {
                    timeUnixNanoNumeric =
                      OneUptimeDate.getCurrentDateAsUnixNano();
                    timeDate = OneUptimeDate.getCurrentDate();
                  }

                  let logSeverityNumber: number =
                    (log["severityNumber"] as number) || 0;

                  if (typeof logSeverityNumber === "string") {
                    logSeverityNumber =
                      this.convertSeverityNumber(logSeverityNumber);
                  }

                  const severityText: LogSeverity =
                    this.getSeverityText(logSeverityNumber);

                  let body: string = "";
                  try {
                    const logBody: JSONObject = log["body"] as JSONObject;
                    if (
                      logBody &&
                      typeof logBody === "object" &&
                      (logBody["stringValue"] || logBody["string_value"])
                    ) {
                      body = (logBody["stringValue"] ||
                        logBody["string_value"]) as string;
                    } else if (typeof log["body"] === "string") {
                      body = log["body"] as string;
                    } else {
                      body = JSON.stringify(log["body"] || "");
                    }
                  } catch (bodyError) {
                    logger.warn(
                      `Error processing log body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}`,
                    );
                    body = String(log["body"] || "");
                  }

                  /*
                   * Kubernetes inventory hook: convert the k8sobjects log
                   * body into a row for the inventory upsert. Buffered per
                   * cluster and flushed once per request batch below. Uses
                   * the agent-observed timestamp so out-of-order delivery
                   * doesn't regress newer snapshots.
                   *
                   * k8s.resource.name sits on each log record (not the
                   * resource envelope), so we read it from the record's
                   * attributes dictionary built a few lines above.
                   */
                  if (isK8sInventoryEligible && kubernetesClusterId && body) {
                    const recordK8sResourceType: unknown =
                      attributesObject["k8s.resource.name"];
                    if (
                      typeof recordK8sResourceType === "string" &&
                      INVENTORIED_TYPE_SET.has(
                        recordK8sResourceType.toLowerCase(),
                      )
                    ) {
                      try {
                        const parsed: ExtractedInventoryRecord | null =
                          extractInventoryResource({
                            resourceType: recordK8sResourceType,
                            logBody: body,
                            lastSeenAt: timeDate,
                          });
                        if (parsed) {
                          const key: string = kubernetesClusterId.toString();
                          let bucket:
                            | Array<ParsedKubernetesResource>
                            | undefined = k8sInventoryBuffer.get(key);
                          if (!bucket) {
                            bucket = [];
                            k8sInventoryBuffer.set(key, bucket);
                          }
                          bucket.push(parsed.resource);

                          if (parsed.containers.length > 0) {
                            let cbucket:
                              | Array<ParsedKubernetesContainerRow>
                              | undefined = k8sContainerBuffer.get(key);
                            if (!cbucket) {
                              cbucket = [];
                              k8sContainerBuffer.set(key, cbucket);
                            }
                            for (const c of parsed.containers) {
                              cbucket.push(c);
                            }
                          }
                        }
                      } catch (invErr) {
                        // Inventory parsing must never fail log ingest.
                        logger.warn(
                          `K8s inventory parse failed for resourceType=${recordK8sResourceType}: ${invErr instanceof Error ? invErr.message : String(invErr)}`,
                        );
                      }
                    }
                  }

                  /*
                   * Docker inventory hook: the agent's snapshot script
                   * emits each container/image/network/volume as a JSON
                   * envelope tagged with `oneuptime.docker.kind`. We
                   * route these into the DockerResource inventory table
                   * exactly like the K8s flow above.
                   */
                  if (isDockerInventoryEligible && dockerHostId && body) {
                    const recordDockerKind: unknown =
                      attributesObject[DOCKER_INVENTORY_KIND_ATTRIBUTE];
                    if (
                      typeof recordDockerKind === "string" &&
                      isInventoriedDockerKind(recordDockerKind)
                    ) {
                      try {
                        const parsed: ExtractedDockerInventoryRecord | null =
                          extractDockerInventoryResource({
                            kind: recordDockerKind,
                            logBody: body,
                            lastSeenAt: timeDate,
                          });
                        if (parsed) {
                          const key: string = dockerHostId.toString();
                          let bucket: Array<ParsedDockerResource> | undefined =
                            dockerInventoryBuffer.get(key);
                          if (!bucket) {
                            bucket = [];
                            dockerInventoryBuffer.set(key, bucket);
                          }
                          bucket.push(parsed.resource);
                        }
                      } catch (invErr) {
                        logger.warn(
                          `Docker inventory parse failed for kind=${recordDockerKind}: ${invErr instanceof Error ? invErr.message : String(invErr)}`,
                        );
                      }
                    }
                  }

                  let traceId: string = "";
                  try {
                    traceId = Text.convertBase64ToHex(log["traceId"] as string);
                  } catch {
                    traceId = "";
                  }

                  let spanId: string = "";
                  try {
                    spanId = Text.convertBase64ToHex(log["spanId"] as string);
                  } catch {
                    spanId = "";
                  }

                  // Extract observedTimeUnixNano
                  let observedTimeUnixNano: number = 0;
                  if (log["observedTimeUnixNano"]) {
                    try {
                      if (typeof log["observedTimeUnixNano"] === "string") {
                        observedTimeUnixNano = parseFloat(
                          log["observedTimeUnixNano"],
                        );
                        if (isNaN(observedTimeUnixNano)) {
                          observedTimeUnixNano = 0;
                        }
                      } else {
                        observedTimeUnixNano =
                          (log["observedTimeUnixNano"] as number) || 0;
                      }
                    } catch {
                      observedTimeUnixNano = 0;
                    }
                  }

                  const droppedAttributesCount: number =
                    (log["droppedAttributesCount"] as number) || 0;

                  const logFlags: number = (log["flags"] as number) || 0;

                  const ingestionDate: Date = OneUptimeDate.getCurrentDate();
                  const ingestionTimestamp: string =
                    OneUptimeDate.toClickhouseDateTime(ingestionDate);
                  const logTimestamp: string =
                    OneUptimeDate.toClickhouseDateTime64(
                      timeDate,
                      timeUnixNanoNumeric,
                    );

                  const serviceMetadata: TelemetryServiceMetadata =
                    serviceDictionary[serviceName]!;
                  const retentionDays: number = resolveTelemetryRetentionInDays(
                    {
                      pillar: "logs",
                      bucketKey: severityText,
                      serviceConfig: serviceMetadata.serviceRetentionConfig,
                      serviceRetentionInDays:
                        serviceMetadata.serviceRetentionInDays,
                      projectConfig: serviceMetadata.projectRetentionConfig,
                      projectRetentionInDays:
                        serviceMetadata.projectRetentionInDays,
                    },
                  );
                  const retentionDate: Date = OneUptimeDate.addRemoveDays(
                    ingestionDate,
                    retentionDays,
                  );

                  let logRow: JSONObject = {
                    _id: ObjectID.generate().toString(),
                    createdAt: ingestionTimestamp,
                    updatedAt: ingestionTimestamp,
                    projectId: projectId.toString(),
                    serviceId: serviceId.toString(),
                    serviceType: serviceMetadata.serviceType,
                    time: logTimestamp,
                    timeUnixNano: Math.trunc(timeUnixNanoNumeric).toString(),
                    severityNumber: logSeverityNumber,
                    severityText: severityText,
                    attributes: attributesObject,
                    attributeKeys: attributeKeys,
                    traceId: traceId,
                    spanId: spanId,
                    body: body,
                    observedTimeUnixNano:
                      Math.trunc(observedTimeUnixNano).toString(),
                    droppedAttributesCount: droppedAttributesCount,
                    flags: logFlags,
                    retentionDate:
                      OneUptimeDate.toClickhouseDateTime(retentionDate),
                  };

                  // Drop filter check (before pipeline processing)
                  if (
                    loadedDropFilters.length > 0 &&
                    LogDropFilterService.shouldDropLog(
                      logRow,
                      loadedDropFilters,
                    )
                  ) {
                    continue;
                  }

                  // Sensitive data scrubbing
                  if (loadedScrubRules.length > 0) {
                    logRow = LogScrubRuleService.scrubLog(
                      logRow,
                      loadedScrubRules,
                    );
                  }

                  // Pipeline processing
                  if (loadedPipelines.length > 0) {
                    logRow = LogPipelineService.processLog(
                      logRow,
                      loadedPipelines,
                    );
                  }

                  /*
                   * Detect an exception in this log and roll it into the Issues
                   * view. Runs on the post-scrub/post-pipeline logRow (not the
                   * pre-scrub locals) so scrubbed secrets never reach the
                   * exception columns. A drop-filtered log already `continue`d
                   * above, so it never reaches this point.
                   */
                  if (TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED) {
                    try {
                      this.collectExceptionFromLog({
                        logRow,
                        projectId,
                        serviceId,
                        serviceMetadata,
                        entityMembership,
                        severityNumber: logSeverityNumber,
                        severityText,
                        timeDate,
                        timeUnixNano: timeUnixNanoNumeric,
                        retentionDate,
                        dbExceptions,
                        pendingExceptionUpserts,
                      });
                    } catch (exceptionExtractionError) {
                      // Exception extraction must never fail log ingest.
                      logger.warn(
                        `Error extracting exception from log: ${
                          exceptionExtractionError instanceof Error
                            ? exceptionExtractionError.message
                            : String(exceptionExtractionError)
                        }`,
                      );
                    }
                  }

                  dbLogs.push({ ...logRow, ...entityMembership });
                  totalLogsProcessed++;

                  if (dbLogs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE) {
                    await this.flushLogsBuffer(dbLogs);
                  }

                  if (
                    dbExceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE
                  ) {
                    await this.flushExceptionsBuffer(dbExceptions);
                  }
                } catch (logError) {
                  logger.error("Error processing individual log record:");
                  logger.error(logError);
                  logger.error(`Log record data: ${JSON.stringify(log)}`);
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope log:");
              logger.error(scopeError);
              logger.error(`Scope log data: ${JSON.stringify(scopeLog)}`);
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource log:");
          logger.error(resourceError);
          logger.error(`Resource log data: ${JSON.stringify(resourceLog)}`);
        }
      }

      await this.flushLogsBuffer(dbLogs, true);

      /*
       * Flush log-derived exceptions: ClickHouse ExceptionInstance rows plus
       * the batched Postgres TelemetryException summary upsert. The upsert is
       * wrapped so a Postgres failure can't fail the log worker — the
       * ClickHouse rows are the source of truth; a lost upsert only lags the
       * dashboard count for this batch (mirrors the trace path).
       */
      await this.flushExceptionsBuffer(dbExceptions, true);
      if (pendingExceptionUpserts.length > 0) {
        await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(
          pendingExceptionUpserts,
        ).catch((err: Error) => {
          logger.error(
            "Telemetry exception batch upsert (from logs) failed; dashboard counts may lag this batch.",
          );
          logger.error(err);
        });
      }

      /*
       * Flush the k8s inventory buffer — one upsert per cluster. Failures
       * must not affect log ingest; they're logged and swallowed.
       */
      if (k8sInventoryBuffer.size > 0) {
        for (const [clusterIdStr, resources] of k8sInventoryBuffer.entries()) {
          if (resources.length === 0) {
            continue;
          }
          try {
            await KubernetesResourceService.bulkUpsert({
              projectId,
              kubernetesClusterId: new ObjectID(clusterIdStr),
              resources,
            });
          } catch (invErr) {
            logger.error(
              `Error upserting KubernetesResource inventory for cluster ${clusterIdStr}: ${invErr instanceof Error ? invErr.message : String(invErr)}`,
            );
          }
        }
      }

      /*
       * Flush container rows after the parent KubernetesResource flush
       * so the cleanup worker's foreign-key-style invariant ("a
       * container row's parent Pod row exists") holds at any moment.
       */
      if (k8sContainerBuffer.size > 0) {
        for (const [clusterIdStr, containers] of k8sContainerBuffer.entries()) {
          if (containers.length === 0) {
            continue;
          }
          try {
            await KubernetesContainerService.bulkUpsert({
              projectId,
              kubernetesClusterId: new ObjectID(clusterIdStr),
              containers,
            });
          } catch (invErr) {
            logger.error(
              `Error upserting KubernetesContainer inventory for cluster ${clusterIdStr}: ${invErr instanceof Error ? invErr.message : String(invErr)}`,
            );
          }
        }
      }

      if (dockerInventoryBuffer.size > 0) {
        for (const [hostIdStr, resources] of dockerInventoryBuffer.entries()) {
          if (resources.length === 0) {
            continue;
          }
          try {
            await DockerResourceService.bulkUpsert({
              projectId,
              dockerHostId: new ObjectID(hostIdStr),
              resources,
            });
          } catch (invErr) {
            logger.error(
              `Error upserting DockerResource inventory for host ${hostIdStr}: ${invErr instanceof Error ? invErr.message : String(invErr)}`,
            );
          }
        }
      }

      if (totalLogsProcessed === 0) {
        logger.warn("No valid logs were processed from the request");
        return;
      }

      logger.debug(
        `Successfully processed ${totalLogsProcessed} logs for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbLogs.length = 0;
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
      logger.error("Critical error in processLogsAsync:");
      logger.error(error);
      throw error;
    }
  }

  /*
   * Build the ClickHouse ExceptionInstance row and the Postgres
   * TelemetryException upsert payload for an exception detected in a single log
   * record, and push them onto the batch buffers. Mirrors
   * OtelTracesIngestService.buildExceptionRow / its pendingExceptionUpserts
   * push, with log-appropriate values: no span backing (spanStatusCode Unset,
   * spanName ""), escaped left null unless the log carried exception.escaped,
   * the log's own traceId/spanId preserved when correlated, and the log
   * retention policy (pillar "logs") reused from the caller.
   */
  private static collectExceptionFromLog(data: {
    logRow: JSONObject;
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceMetadata: TelemetryServiceMetadata;
    entityMembership: EntityMembership;
    severityNumber: number;
    severityText: LogSeverity;
    timeDate: Date;
    timeUnixNano: number;
    retentionDate: Date;
    dbExceptions: Array<JSONObject>;
    pendingExceptionUpserts: Array<TelemetryExceptionPayload>;
  }): void {
    const finalBody: string = (data.logRow["body"] as string) || "";
    const finalAttributes: JSONObject =
      (data.logRow["attributes"] as JSONObject) || {};
    const traceId: string = (data.logRow["traceId"] as string) || "";
    const spanId: string = (data.logRow["spanId"] as string) || "";

    const extracted: ExtractedLogException | null =
      LogExceptionExtractor.extractFromLogRecord({
        body: finalBody,
        attributes: finalAttributes,
        severityNumber: data.severityNumber,
        hasTraceAndSpan: Boolean(traceId) && Boolean(spanId),
      });

    if (!extracted) {
      return;
    }

    const fingerprint: string = ExceptionUtil.getFingerprint({
      projectId: data.projectId,
      serviceId: data.serviceId,
      message: extracted.message,
      stackTrace: extracted.stackTrace,
      exceptionType: extracted.exceptionType,
    });

    const release: string =
      (finalAttributes["resource.service.version"] as string) || "";
    const environment: string =
      (finalAttributes["resource.deployment.environment"] as string) || "";

    const ingestionTimestamp: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.getCurrentDate(),
    );

    data.dbExceptions.push({
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
      serviceType: data.serviceMetadata.serviceType,
      time: OneUptimeDate.toClickhouseDateTime(data.timeDate),
      timeUnixNano: Math.trunc(data.timeUnixNano).toString(),
      exceptionType: extracted.exceptionType || "",
      stackTrace: extracted.stackTrace || "",
      message: extracted.message || "",
      spanStatusCode: Number(SpanStatus.Unset),
      escaped: extracted.escaped === null ? null : Boolean(extracted.escaped),
      traceId: traceId,
      spanId: spanId,
      fingerprint: fingerprint,
      spanName: "",
      release: release,
      environment: environment,
      parsedFrames: extracted.parsedFrames || "[]",
      attributes: {
        "exception.source": "log",
        "log.severityText": String(data.severityText),
      },
      ...data.entityMembership,
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    });

    data.pendingExceptionUpserts.push({
      fingerprint: fingerprint,
      projectId: data.projectId,
      serviceId: data.serviceId,
      serviceType: data.serviceMetadata.serviceType,
      ...(extracted.exceptionType
        ? { exceptionType: extracted.exceptionType }
        : {}),
      ...(extracted.message ? { message: extracted.message } : {}),
      ...(extracted.stackTrace ? { stackTrace: extracted.stackTrace } : {}),
      ...(release ? { release: release } : {}),
      ...(environment ? { environment: environment } : {}),
    });
  }

  private static convertSeverityNumber(severityNumber: string): number {
    switch (severityNumber) {
      case "SEVERITY_NUMBER_TRACE":
        return 1;
      case "SEVERITY_NUMBER_DEBUG":
        return 5;
      case "SEVERITY_NUMBER_INFO":
        return 9;
      case "SEVERITY_NUMBER_WARN":
        return 13;
      case "SEVERITY_NUMBER_ERROR":
        return 17;
      case "SEVERITY_NUMBER_FATAL":
        return 21;
      default:
        return parseInt(severityNumber);
    }
  }

  private static getSeverityText(severityNumber: number): LogSeverity {
    if (severityNumber >= 1 && severityNumber <= 4) {
      return LogSeverity.Trace;
    } else if (severityNumber >= 5 && severityNumber <= 8) {
      return LogSeverity.Debug;
    } else if (severityNumber >= 9 && severityNumber <= 12) {
      return LogSeverity.Information;
    } else if (severityNumber >= 13 && severityNumber <= 16) {
      return LogSeverity.Warning;
    } else if (severityNumber >= 17 && severityNumber <= 20) {
      return LogSeverity.Error;
    } else if (severityNumber >= 21 && severityNumber <= 24) {
      return LogSeverity.Fatal;
    }
    return LogSeverity.Unspecified;
  }
}
