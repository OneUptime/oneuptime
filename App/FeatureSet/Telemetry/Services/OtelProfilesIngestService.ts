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
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import Text from "Common/Types/Text";
import ProfilesQueueService from "./Queue/ProfilesQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  TELEMETRY_PROFILE_FLUSH_BATCH_SIZE,
  TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE,
} from "../Config";
import crypto from "crypto";

type ParsedUnixNano = {
  unixNano: number;
  nano: string;
  iso: string;
  date: Date;
};

/*
 * Schema-agnostic projection of one entry from
 * `ScopeProfiles.profiles[]`. v1development moved the per-profile string /
 * function / location / mapping / link / stack / attribute tables up to a
 * top-level `ProfilesDictionary`, replaced the `ProfileContainer` wrapper
 * with a bare `Profile`, flipped `sample_type` to singular, renamed
 * `sample` -> `samples`, replaced `startTimeUnixNano` + `endTimeUnixNano`
 * with `timeUnixNano` + `durationNano`, and switched container attributes
 * from inline `KeyValue[]` to `attributeIndices[]` into a global
 * `KeyValueAndUnit[]` table.
 *
 * We normalise both shapes into this struct so the inner sample loop
 * (stack resolution, label extraction, trace correlation, row building)
 * stays unchanged.
 */
type NormalizedProfileFrame = {
  profileId: string | undefined;
  startTimeUnixNano: string | number | undefined;
  endTimeUnixNano: string | number | undefined;
  attributes: JSONArray;
  originalPayloadFormat: string;
  profile: {
    stringTable: Array<string>;
    functionTable: JSONArray;
    locationTable: JSONArray;
    mappingTable: JSONArray;
    linkTable: JSONArray;
    stackTable: JSONArray;
    attributeTable: JSONArray;
    sampleType: JSONArray;
    periodType: JSONObject | undefined;
    period: number;
    sample: JSONArray;
  };
};

class ProfileStorageFlushError extends Error {
  public constructor(error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);
    super(`Failed to flush profiles to ClickHouse: ${message}`);
    this.name = "ProfileStorageFlushError";

    if (error instanceof Error && error.stack) {
      this.stack = `${this.stack}\nCaused by: ${error.stack}`;
    }
  }
}

export default class OtelProfilesIngestService extends OtelIngestBaseService {
  private static async flushProfilesBuffer(
    profiles: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      profiles.length >= TELEMETRY_PROFILE_FLUSH_BATCH_SIZE ||
      (force && profiles.length > 0)
    ) {
      const batchSize: number = Math.min(
        profiles.length,
        TELEMETRY_PROFILE_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = profiles.slice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      try {
        await ProfileService.insertJsonRows(batch);
      } catch (error) {
        throw new ProfileStorageFlushError(error);
      }

      profiles.splice(0, batch.length);
    }
  }

  private static async flushSamplesBuffer(
    samples: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      samples.length >= TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE ||
      (force && samples.length > 0)
    ) {
      const batchSize: number = Math.min(
        samples.length,
        TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = samples.slice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      try {
        await ProfileSampleService.insertJsonRows(batch);
      } catch (error) {
        throw new ProfileStorageFlushError(error);
      }

      samples.splice(0, batch.length);
    }
  }

  @CaptureSpan()
  public static async ingestProfiles(
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
       * Send 200 first, then enqueue the raw bytes. Protobuf decode
       * now happens in the worker — see TelemetryQueueService.
       */
      Response.sendEmptySuccessResponse(req, res);

      await ProfilesQueueService.addProfileIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processProfilesFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processProfilesAsync(req);
  }

  @CaptureSpan()
  private static async processProfilesAsync(
    req: ExpressRequest,
  ): Promise<void> {
    try {
      /*
       * An empty body means the queued payload was lost (the Redis body
       * key expired or was already consumed) — there is nothing to
       * ingest and never will be, so skip instead of throwing into a
       * pointless BullMQ retry loop. Matches the logs/traces/metrics
       * services' handling of the same condition.
       */
      if (Object.keys(req.body as JSONObject).length === 0) {
        logger.debug(
          "Profiles ingest: empty body (queued payload expired or already consumed) — skipping.",
        );
        return;
      }

      const resourceProfiles: JSONArray = req.body[
        "resourceProfiles"
      ] as JSONArray;

      if (!resourceProfiles || !Array.isArray(resourceProfiles)) {
        /*
         * Nothing to ingest. Reached when the out-of-band body was lost
         * (TTL elapsed before the worker ran — decodeFromQueue returns {})
         * or the payload genuinely carried no resourceProfiles. Skip, do NOT
         * throw: this runs in the worker after the 200 was already sent, so
         * throwing only burns retries (the body won't reappear) and masks
         * the real first-attempt error behind "Invalid resourceProfiles format".
         */
        logger.warn(
          "No resourceProfiles to ingest (empty or lost body); skipping batch.",
        );
        logger.warn(getLogAttributesFromRequest(req as RequestLike));
        return;
      }

      /*
       * v1development OTLP profiles carry one shared `ProfilesDictionary`
       * at the request root. When absent we are talking to an older
       * collector that still emits per-profile tables inside a
       * `ProfileContainer` wrapper -- detection happens per-profile via
       * `normalizeProfileItem` below.
       */
      const globalDictionary: JSONObject | undefined = req.body[
        "dictionary"
      ] as JSONObject | undefined;

      const dbProfiles: Array<JSONObject> = [];
      const dbSamples: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalProfilesProcessed: number = 0;

      let resourceProfileCounter: number = 0;
      for (const resourceProfile of resourceProfiles) {
        try {
          if (resourceProfileCounter % 25 === 0) {
            await EventLoop.yieldToEventLoop();
          }
          resourceProfileCounter++;

          const resourceAttributes_raw: JSONArray =
            ((resourceProfile["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [];

          // Producer-declared entities (authoritative when present).
          const resourceEntityRefs: Array<ResourceEntityRef> =
            OtelPayloadDecoder.getEntityRefsFromResource(
              resourceProfile["resource"] as JSONObject | undefined,
            );

          /*
           * Auto-discover host / docker host / k8s cluster from
           * resource attributes. The eBPF profiler is a host-level
           * agent, so most batches without an explicit service.name
           * carry a host signal and need to land on the Host row
           * rather than synthesising a phantom `host/<name>` Service.
           */
          const kubernetesClusterId: ObjectID | null =
            await this.autoDiscoverKubernetesCluster({
              projectId: (req as TelemetryRequest).projectId,
              attributes: resourceAttributes_raw,
            });

          const dockerHostId: ObjectID | null =
            await this.autoDiscoverDockerHost({
              projectId: (req as TelemetryRequest).projectId,
              attributes: resourceAttributes_raw,
            });

          const podmanHostId: ObjectID | null =
            await this.autoDiscoverPodmanHost({
              projectId: (req as TelemetryRequest).projectId,
              attributes: resourceAttributes_raw,
            });

          const hostId: ObjectID | null = await this.autoDiscoverHost({
            projectId: (req as TelemetryRequest).projectId,
            attributes: resourceAttributes_raw,
            hasInfraSignal: false,
            dockerHostId,
            podmanHostId,
            kubernetesClusterId,
          });

          const serverlessFunctionId: ObjectID | null =
            await this.autoDiscoverServerless({
              projectId: (req as TelemetryRequest).projectId,
              attributes: resourceAttributes_raw,
            });

          const cloudResourceId: ObjectID | null =
            await this.autoDiscoverCloudResource({
              projectId: (req as TelemetryRequest).projectId,
              attributes: resourceAttributes_raw,
            });

          const rumApplicationId: ObjectID | null = await this.autoDiscoverRum({
            projectId: (req as TelemetryRequest).projectId,
            attributes: resourceAttributes_raw,
          });

          const resolvedServiceMetadata: TelemetryServiceMetadata =
            await this.resolveTelemetryResource({
              req,
              attributes: resourceAttributes_raw,
              projectId: (req as TelemetryRequest).projectId,
              hostId,
              dockerHostId,
              podmanHostId,
              kubernetesClusterId,
              serverlessFunctionId,
              cloudResourceId,
              rumApplicationId,
              entityRefs: resourceEntityRefs,
            });
          const serviceName: string = resolvedServiceMetadata.serviceName;

          serviceDictionary[serviceName] = resolvedServiceMetadata;

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
            ...(resolvedServiceMetadata.primaryEntityType ===
            ServiceType.OpenTelemetry
              ? TelemetryUtil.getAttributesForServiceIdAndServiceName({
                  serviceId: resolvedServiceMetadata.primaryEntityId!,
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

          const scopeProfiles: JSONArray = resourceProfile[
            "scopeProfiles"
          ] as JSONArray;

          if (!scopeProfiles || !Array.isArray(scopeProfiles)) {
            logger.warn(
              "Invalid scopeProfiles format, skipping resource profile",
            );
            continue;
          }

          let scopeProfileCounter: number = 0;
          for (const scopeProfile of scopeProfiles) {
            try {
              if (scopeProfileCounter % 50 === 0) {
                await EventLoop.yieldToEventLoop();
              }
              scopeProfileCounter++;

              const profileContainers: JSONArray = scopeProfile[
                "profiles"
              ] as JSONArray;

              if (!profileContainers || !Array.isArray(profileContainers)) {
                logger.warn("Invalid profiles format, skipping scope profile");
                continue;
              }

              let profileCounter: number = 0;
              for (const profileItem of profileContainers) {
                try {
                  if (profileCounter % 100 === 0) {
                    await EventLoop.yieldToEventLoop();
                  }
                  profileCounter++;

                  const projectId: ObjectID = (req as TelemetryRequest)
                    .projectId;
                  const profileServiceMetadata: TelemetryServiceMetadata =
                    serviceDictionary[serviceName]!;
                  const primaryEntityId: ObjectID =
                    profileServiceMetadata.primaryEntityId!;

                  const frame: NormalizedProfileFrame =
                    this.normalizeProfileItem(
                      profileItem as JSONObject,
                      globalDictionary,
                    );

                  const profileId: string =
                    this.convertBase64ToHexSafe(frame.profileId) ||
                    ObjectID.generate().toString();

                  const startTime: ParsedUnixNano = this.safeParseUnixNano(
                    frame.startTimeUnixNano,
                    "profile startTimeUnixNano",
                  );

                  /*
                   * v1development gives us `time_unix_nano` + `duration_nano`
                   * so `endTimeUnixNano` is computed during normalisation. If
                   * neither is present (e.g. a degenerate instant profile)
                   * fall back to the parsed start time so durationNano = 0.
                   */
                  const endTime: ParsedUnixNano =
                    frame.endTimeUnixNano !== undefined
                      ? this.safeParseUnixNano(
                          frame.endTimeUnixNano,
                          "profile endTimeUnixNano",
                        )
                      : startTime;

                  const durationNano: number = Math.max(
                    0,
                    Math.trunc(endTime.unixNano - startTime.unixNano),
                  );

                  const containerAttributes: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: frame.attributes,
                      prefixKeysWithString: "",
                    }),
                  };

                  if (
                    scopeProfile["scope"] &&
                    Object.keys(scopeProfile["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeProfile[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      containerAttributes[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  const attributeKeys: Array<string> =
                    TelemetryUtil.getAttributeKeys(containerAttributes);

                  const profile: NormalizedProfileFrame["profile"] =
                    frame.profile;
                  const originalPayloadFormat: string =
                    frame.originalPayloadFormat;

                  let profileType: string = "unknown";
                  let unit: string = "unknown";
                  let periodType: string = "";
                  let period: number = 0;
                  let sampleCount: number = 0;

                  const stringTable: Array<string> = profile.stringTable;

                  /*
                   * pprof profiles routinely carry several parallel
                   * sample types (Go CPU: [samples/count,
                   * cpu/nanoseconds]; heap: [alloc_objects, alloc_space,
                   * inuse_objects, inuse_space]). Pick the canonical one
                   * once and use that index for BOTH the profile
                   * metadata and every sample's value — mixing index 0
                   * metadata with index-0 values made Go CPU profiles
                   * report raw sample counts labelled as "samples"
                   * instead of cpu time.
                   */
                  const sampleTypes: JSONArray = profile.sampleType;
                  const canonicalSampleTypeIndex: number =
                    this.selectCanonicalSampleTypeIndex(
                      sampleTypes,
                      stringTable,
                    );
                  if (sampleTypes.length > 0) {
                    const canonicalSampleType: JSONObject = sampleTypes[
                      canonicalSampleTypeIndex
                    ] as JSONObject;
                    const typeIndex: number =
                      (canonicalSampleType["type"] as number) || 0;
                    const unitIndex: number =
                      (canonicalSampleType["unit"] as number) || 0;

                    if (stringTable[typeIndex]) {
                      profileType = stringTable[typeIndex]!;
                    }
                    if (stringTable[unitIndex]) {
                      unit = stringTable[unitIndex]!;
                    }
                  }

                  const periodTypeObj: JSONObject | undefined =
                    profile.periodType;
                  if (periodTypeObj) {
                    const periodTypeIndex: number =
                      (periodTypeObj["type"] as number) || 0;
                    if (stringTable[periodTypeIndex]) {
                      periodType = stringTable[periodTypeIndex]!;
                    }
                  }
                  period = profile.period;

                  const samples: JSONArray = profile.sample;
                  sampleCount = samples.length;

                  const functionTable: JSONArray = profile.functionTable;
                  const locationTable: JSONArray = profile.locationTable;
                  const linkTable: JSONArray = profile.linkTable;
                  const stackTable: JSONArray = profile.stackTable;
                  const attributeTable: JSONArray = profile.attributeTable;

                  let firstSampleTraceId: string = "";
                  let firstSampleSpanId: string = "";

                  let sampleCounter: number = 0;
                  for (const sample of samples) {
                    try {
                      if (sampleCounter % 200 === 0) {
                        await EventLoop.yieldToEventLoop();
                      }
                      sampleCounter++;

                      const sampleObj: JSONObject = sample as JSONObject;

                      const resolvedStack: {
                        frames: Array<string>;
                        frameTypes: Array<string>;
                      } = this.resolveStackFrames({
                        sample: sampleObj,
                        stackTable: stackTable,
                        locationTable: locationTable,
                        functionTable: functionTable,
                        stringTable: stringTable,
                        attributeTable: attributeTable,
                      });

                      const stacktraceHash: string = crypto
                        .createHash("sha256")
                        .update(resolvedStack.frames.join("|"))
                        .digest("hex");

                      /*
                       * Resolve trace/span correlation from link table.
                       * Per OTLP profiles convention, linkTable[0] is a
                       * sentinel empty link. We only honour linkIndex when
                       * it is explicitly set on the sample.
                       */
                      let traceId: string = "";
                      let spanId: string = "";
                      const linkIndexRaw: unknown = sampleObj["linkIndex"];
                      if (linkIndexRaw !== undefined && linkIndexRaw !== null) {
                        const linkIndex: number = Number(linkIndexRaw);
                        if (
                          Number.isFinite(linkIndex) &&
                          linkIndex > 0 &&
                          linkIndex < linkTable.length
                        ) {
                          const link: JSONObject = linkTable[
                            linkIndex
                          ] as JSONObject;
                          traceId = this.convertBase64ToHexSafe(
                            link["traceId"] as string | undefined,
                          );
                          spanId = this.convertBase64ToHexSafe(
                            link["spanId"] as string | undefined,
                          );
                          if (this.isEmptyHexId(traceId)) {
                            traceId = "";
                          }
                          if (this.isEmptyHexId(spanId)) {
                            spanId = "";
                          }
                        }
                      }

                      /*
                       * v1development renamed `Sample.value` to
                       * `Sample.values`. Accept either spelling so a mixed-
                       * version fleet keeps working during rollout.
                       */
                      const values: Array<number | string> =
                        (sampleObj["values"] as Array<number | string>) ||
                        (sampleObj["value"] as Array<number | string>) ||
                        [];

                      const timestamps: Array<number | string> =
                        (sampleObj["timestampsUnixNano"] as Array<
                          number | string
                        >) || [];

                      /*
                       * Weight the sample. Spec rules
                       * (opentelemetry-proto profiles v1development):
                       *   values:[v]                  -> v          (aggregated count)
                       *   values:[],  timestamps:[..] -> timestamps.length (one event per timestamp, weight 1 each)
                       *   values:[],  timestamps:[]   -> 1          (single hit; pre-spec convention used by the OTel
                       *                                              eBPF profiler when it emits one Sample per stack)
                       * Falling back to 0 here collapses every flame
                       * graph rectangle to zero width, which is what
                       * made the dashboard look empty even after
                       * samples landed.
                       */
                      let sampleValue: number = 0;
                      if (values.length > 0) {
                        /*
                         * `values` is parallel to `sample_type`; read the
                         * canonical index so the value matches the
                         * profileType/unit recorded on the profile row.
                         * Defensive fallback to index 0 for producers
                         * that emit fewer values than sample types.
                         */
                        const canonicalValue: number | string =
                          values.length > canonicalSampleTypeIndex
                            ? values[canonicalSampleTypeIndex]!
                            : values[0]!;
                        sampleValue =
                          typeof canonicalValue === "string"
                            ? parseInt(canonicalValue, 10) || 0
                            : Number(canonicalValue) || 0;
                      } else if (timestamps.length > 0) {
                        sampleValue = timestamps.length;
                      } else {
                        sampleValue = 1;
                      }

                      let sampleTime: ParsedUnixNano = startTime;
                      if (timestamps.length > 0) {
                        sampleTime = this.safeParseUnixNano(
                          timestamps[0] as string | number,
                          "sample timestampsUnixNano",
                        );
                      }

                      const sampleLabels: Dictionary<string> = {};
                      const sampleAttributeIndices: Array<number> =
                        (sampleObj["attributeIndices"] as Array<number>) || [];
                      for (const attrIdx of sampleAttributeIndices) {
                        /*
                         * Index 0 is the dictionary sentinel (KeyValue with
                         * empty key) -- skip it explicitly.
                         */
                        if (attrIdx > 0 && attrIdx < attributeTable.length) {
                          const attr: JSONObject = attributeTable[
                            attrIdx
                          ] as JSONObject;
                          const key: string = (attr["key"] as string) || "";
                          if (!key) {
                            continue;
                          }
                          const val: JSONObject =
                            (attr["value"] as JSONObject) || {};
                          sampleLabels[key] =
                            (val["stringValue"] as string) ||
                            (val["intValue"]?.toString() as string) ||
                            (val["doubleValue"]?.toString() as string) ||
                            (val["boolValue"]?.toString() as string) ||
                            "";
                        }
                      }

                      /*
                       * Fallback: some agents (Pyroscope-style) attach
                       * trace_id / span_id as sample labels instead of via
                       * the link table.
                       */
                      if (!traceId) {
                        traceId = this.findCorrelationValue(
                          sampleLabels,
                          OtelProfilesIngestService.TRACE_ID_KEYS,
                        );
                      }
                      if (!spanId) {
                        spanId = this.findCorrelationValue(
                          sampleLabels,
                          OtelProfilesIngestService.SPAN_ID_KEYS,
                        );
                      }

                      if (traceId && !firstSampleTraceId) {
                        firstSampleTraceId = traceId;
                        firstSampleSpanId = spanId;
                      }

                      const sampleRow: JSONObject = this.buildSampleRow({
                        projectId: projectId,
                        primaryEntityId: primaryEntityId,
                        profileId: profileId,
                        traceId: traceId,
                        spanId: spanId,
                        time: sampleTime,
                        stacktrace: resolvedStack.frames,
                        stacktraceHash: stacktraceHash,
                        frameTypes: resolvedStack.frameTypes,
                        value: sampleValue,
                        profileType: profileType,
                        labels: sampleLabels,
                        serviceMetadata: profileServiceMetadata,
                      });

                      dbSamples.push(sampleRow);

                      if (
                        dbSamples.length >=
                        TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE
                      ) {
                        await this.flushSamplesBuffer(dbSamples);
                      }
                    } catch (sampleError) {
                      if (sampleError instanceof ProfileStorageFlushError) {
                        throw sampleError;
                      }
                      logger.error("Error processing individual sample:");
                      logger.error(sampleError);
                    }
                  }

                  /*
                   * Resolve the profile-level trace/span correlation.
                   * Precedence: any sample that carried one (most reliable) ->
                   * first non-sentinel entry in the link table ->
                   * container/resource attributes (e.g. trace.id set by the
                   * agent on the profile envelope).
                   */
                  let profileTraceId: string = firstSampleTraceId;
                  let profileSpanId: string = firstSampleSpanId;

                  if (!profileTraceId) {
                    for (
                      let linkIdx: number = 1;
                      linkIdx < linkTable.length;
                      linkIdx++
                    ) {
                      const link: JSONObject = linkTable[linkIdx] as JSONObject;
                      const candidateTraceId: string =
                        this.convertBase64ToHexSafe(
                          link["traceId"] as string | undefined,
                        );
                      const candidateSpanId: string =
                        this.convertBase64ToHexSafe(
                          link["spanId"] as string | undefined,
                        );
                      if (
                        !this.isEmptyHexId(candidateTraceId) ||
                        !this.isEmptyHexId(candidateSpanId)
                      ) {
                        profileTraceId = this.isEmptyHexId(candidateTraceId)
                          ? ""
                          : candidateTraceId;
                        profileSpanId = this.isEmptyHexId(candidateSpanId)
                          ? ""
                          : candidateSpanId;
                        break;
                      }
                    }
                  }

                  if (!profileTraceId) {
                    profileTraceId = this.findCorrelationValue(
                      containerAttributes,
                      OtelProfilesIngestService.TRACE_ID_KEYS,
                    );
                  }
                  if (!profileSpanId) {
                    profileSpanId = this.findCorrelationValue(
                      containerAttributes,
                      OtelProfilesIngestService.SPAN_ID_KEYS,
                    );
                  }

                  const profileRow: JSONObject = this.buildProfileRow({
                    projectId: projectId,
                    primaryEntityId: primaryEntityId,
                    profileId: profileId,
                    traceId: profileTraceId,
                    spanId: profileSpanId,
                    startTime: startTime,
                    endTime: endTime,
                    durationNano: durationNano,
                    profileType: profileType,
                    unit: unit,
                    periodType: periodType,
                    period: period,
                    attributes: containerAttributes,
                    attributeKeys: attributeKeys,
                    sampleCount: sampleCount,
                    originalPayloadFormat: originalPayloadFormat,
                    serviceMetadata: profileServiceMetadata,
                  });

                  dbProfiles.push(profileRow);
                  totalProfilesProcessed++;

                  if (dbProfiles.length >= TELEMETRY_PROFILE_FLUSH_BATCH_SIZE) {
                    await this.flushProfilesBuffer(dbProfiles);
                  }
                } catch (profileError) {
                  if (profileError instanceof ProfileStorageFlushError) {
                    throw profileError;
                  }
                  logger.error("Error processing individual profile:");
                  logger.error(profileError);
                }
              }
            } catch (scopeError) {
              if (scopeError instanceof ProfileStorageFlushError) {
                throw scopeError;
              }
              logger.error("Error processing scope profile:");
              logger.error(scopeError);
            }
          }
        } catch (resourceError) {
          if (resourceError instanceof ProfileStorageFlushError) {
            throw resourceError;
          }
          logger.error("Error processing resource profile:");
          logger.error(resourceError);
        }
      }

      await Promise.all([
        this.flushProfilesBuffer(dbProfiles, true),
        this.flushSamplesBuffer(dbSamples, true),
      ]);

      if (totalProfilesProcessed === 0) {
        logger.warn("No valid profiles were processed from the request");
        return;
      }

      logger.debug(
        `Successfully processed ${totalProfilesProcessed} profiles for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbProfiles.length = 0;
        dbSamples.length = 0;
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error(
        "Critical error in processProfilesAsync:",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  /**
   * Choose which entry of a multi-valued pprof `sample_type` array is
   * the one worth charting. Preference order by (type, unit):
   * cpu/nanoseconds (Go CPU profiles put it at index 1, after
   * samples/count), then wall time, then inuse_space/bytes (live heap),
   * then alloc_space/bytes, then the first available entry. The
   * v1development OTLP schema normalises to a single sample type, so
   * this only does work for multi-type pprof-derived payloads.
   */
  private static selectCanonicalSampleTypeIndex(
    sampleTypes: JSONArray,
    stringTable: Array<string>,
  ): number {
    if (sampleTypes.length <= 1) {
      return 0;
    }

    const resolved: Array<{ type: string; unit: string }> = sampleTypes.map(
      (st: JSONObject): { type: string; unit: string } => {
        const obj: JSONObject = st || {};
        const typeIndex: number = (obj["type"] as number) || 0;
        const unitIndex: number = (obj["unit"] as number) || 0;
        return {
          type: (stringTable[typeIndex] || "").toLowerCase(),
          unit: (stringTable[unitIndex] || "").toLowerCase(),
        };
      },
    );

    const preferences: Array<(st: { type: string; unit: string }) => boolean> =
      [
        (st: { type: string; unit: string }): boolean => {
          return st.type === "cpu" && st.unit === "nanoseconds";
        },
        (st: { type: string; unit: string }): boolean => {
          return st.type === "wall";
        },
        (st: { type: string; unit: string }): boolean => {
          return st.type === "inuse_space" && st.unit === "bytes";
        },
        (st: { type: string; unit: string }): boolean => {
          return st.type === "alloc_space" && st.unit === "bytes";
        },
      ];

    for (const matches of preferences) {
      const index: number = resolved.findIndex(matches);
      if (index >= 0) {
        return index;
      }
    }

    return 0;
  }

  private static resolveStackFrames(data: {
    sample: JSONObject;
    stackTable: JSONArray;
    locationTable: JSONArray;
    functionTable: JSONArray;
    stringTable: Array<string>;
    attributeTable: JSONArray;
  }): { frames: Array<string>; frameTypes: Array<string> } {
    const frames: Array<string> = [];
    const frameTypes: Array<string> = [];

    // Try stack_index first (newer format)
    const stackIndex: number | undefined = data.sample["stackIndex"] as
      | number
      | undefined;

    let locationIndices: Array<number> = [];

    if (
      stackIndex !== undefined &&
      stackIndex >= 0 &&
      stackIndex < data.stackTable.length
    ) {
      const stack: JSONObject = data.stackTable[stackIndex] as JSONObject;
      locationIndices = (stack["locationIndices"] as Array<number>) || [];
    } else {
      // Fall back to locations_start_index + locations_length (older format)
      const startIndex: number =
        (data.sample["locationsStartIndex"] as number) || 0;
      const length: number = (data.sample["locationsLength"] as number) || 0;
      if (length > 0) {
        for (let i: number = startIndex; i < startIndex + length; i++) {
          locationIndices.push(i);
        }
      }
    }

    for (const locationIndex of locationIndices) {
      if (locationIndex < 0 || locationIndex >= data.locationTable.length) {
        frames.push("<unknown>");
        frameTypes.push("unknown");
        continue;
      }

      const location: JSONObject = data.locationTable[
        locationIndex
      ] as JSONObject;

      /*
       * v1development renamed `Location.line` (repeated Line) to
       * `Location.lines`. Accept either spelling.
       */
      const lines: JSONArray =
        (location["lines"] as JSONArray) ||
        (location["line"] as JSONArray) ||
        [];

      /*
       * Frame type resolution differs by schema:
       *   - v1development drops `type_index` and instead lets a Location
       *     reference attribute_table entries with key=`profile.frame.type`
       *     via `attribute_indices`.
       *   - The older schema put that index directly on the location as
       *     `type_index`, pointing at an attribute_table entry whose value
       *     is the frame-type string.
       * Try the new shape first, fall back to the old.
       */
      let locFrameType: string = "unknown";

      const locAttrIndices: Array<number> =
        (location["attributeIndices"] as Array<number>) || [];
      for (const aIdx of locAttrIndices) {
        if (aIdx <= 0 || aIdx >= data.attributeTable.length) {
          continue;
        }
        const attr: JSONObject = data.attributeTable[aIdx] as JSONObject;
        if (attr["key"] !== "profile.frame.type") {
          continue;
        }
        const val: JSONObject = (attr["value"] as JSONObject) || {};
        const sv: unknown = val["stringValue"];
        if (typeof sv === "string" && sv.length > 0) {
          locFrameType = sv;
        }
        break;
      }

      if (locFrameType === "unknown") {
        const typeIndex: number | undefined = location["typeIndex"] as
          | number
          | undefined;
        if (
          typeIndex !== undefined &&
          typeIndex >= 0 &&
          typeIndex < data.attributeTable.length
        ) {
          const attr: JSONObject = data.attributeTable[typeIndex] as JSONObject;
          const val: JSONObject = (attr["value"] as JSONObject) || {};
          locFrameType = (val["stringValue"] as string) || "unknown";
        }
      }

      if (lines.length === 0) {
        // No line info - use address
        const address: number | string =
          (location["address"] as number | string) || 0;
        frames.push(`0x${address.toString(16)}`);
        frameTypes.push(locFrameType);
      } else {
        // Handle inline frames: each line in location.lines expands to a frame
        for (const lineObj of lines) {
          const line: JSONObject = lineObj as JSONObject;
          const functionIndex: number = (line["functionIndex"] as number) || 0;

          let functionName: string = "<unknown>";
          let fileName: string = "";
          let lineNumber: number = 0;

          if (functionIndex >= 0 && functionIndex < data.functionTable.length) {
            const func: JSONObject = data.functionTable[
              functionIndex
            ] as JSONObject;
            /*
             * v1development renamed Function.name -> name_strindex,
             * Function.filename -> filename_strindex (likewise for
             * system_name). Accept either spelling.
             */
            const nameIndex: number =
              ((func["nameStrindex"] as number | undefined) ??
                (func["name"] as number | undefined)) ||
              0;
            const fileIndex: number =
              ((func["filenameStrindex"] as number | undefined) ??
                (func["filename"] as number | undefined)) ||
              0;

            if (nameIndex >= 0 && nameIndex < data.stringTable.length) {
              functionName = data.stringTable[nameIndex] || "<unknown>";
            }
            if (fileIndex >= 0 && fileIndex < data.stringTable.length) {
              fileName = data.stringTable[fileIndex] || "";
            }
          }

          lineNumber = (line["line"] as number) || 0;

          /*
           * Stored shapes: 'fn@file:line', 'fn@file', or bare 'fn'.
           * The line suffix rides only on a fileName: parseFrame treats
           * any '@'-less token entirely as the function name, so a
           * file-less 'fn:line' would bake the line number into the
           * function's identity and break deploy-stable matching.
           */
          let frame: string = functionName;
          if (fileName) {
            frame += `@${fileName}`;
            if (lineNumber > 0) {
              frame += `:${lineNumber}`;
            }
          }

          frames.push(frame);
          frameTypes.push(locFrameType);
        }
      }
    }

    return { frames, frameTypes };
  }

  private static buildProfileRow(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    profileId: string;
    traceId: string;
    spanId: string;
    startTime: ParsedUnixNano;
    endTime: ParsedUnixNano;
    durationNano: number;
    profileType: string;
    unit: string;
    periodType: string;
    period: number;
    attributes: Dictionary<AttributeType | Array<AttributeType>>;
    attributeKeys: Array<string>;
    sampleCount: number;
    originalPayloadFormat: string;
    serviceMetadata: TelemetryServiceMetadata;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "profiles",
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
      profileId: data.profileId,
      traceId: data.traceId || "",
      spanId: data.spanId || "",
      startTime: OneUptimeDate.toClickhouseDateTime(data.startTime.date),
      endTime: OneUptimeDate.toClickhouseDateTime(data.endTime.date),
      startTimeUnixNano: data.startTime.nano,
      endTimeUnixNano: data.endTime.nano,
      durationNano: data.durationNano.toString(),
      profileType: data.profileType,
      unit: data.unit,
      periodType: data.periodType || "",
      period: data.period ? data.period.toString() : "0",
      attributes: data.attributes,
      attributeKeys: data.attributeKeys,
      sampleCount: data.sampleCount,
      originalPayloadFormat: data.originalPayloadFormat || "",
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };
  }

  private static buildSampleRow(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    profileId: string;
    traceId: string;
    spanId: string;
    time: ParsedUnixNano;
    stacktrace: Array<string>;
    stacktraceHash: string;
    frameTypes: Array<string>;
    value: number;
    profileType: string;
    labels: Dictionary<string>;
    serviceMetadata: TelemetryServiceMetadata;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "profiles",
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
      profileId: data.profileId,
      traceId: data.traceId || "",
      spanId: data.spanId || "",
      time: OneUptimeDate.toClickhouseDateTime(data.time.date),
      timeUnixNano: data.time.nano,
      stacktrace: data.stacktrace,
      stacktraceHash: data.stacktraceHash,
      frameTypes: data.frameTypes,
      value: data.value.toString(),
      profileType: data.profileType,
      labels: data.labels,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };
  }

  /**
   * Collapse a `ScopeProfiles.profiles[i]` entry into a schema-agnostic
   * `NormalizedProfileFrame` so the rest of the pipeline does not need to
   * know which OTLP profiles version produced the payload.
   *
   * Detection rule: presence of a top-level `ProfilesDictionary` on the
   * request, OR a `timeUnixNano` / `samples` field on the item itself,
   * means v1development. Otherwise we treat the item as an old-schema
   * `ProfileContainer` whose `profile` sub-object carries the tables.
   */
  private static normalizeProfileItem(
    profileItem: JSONObject,
    globalDictionary: JSONObject | undefined,
  ): NormalizedProfileFrame {
    const isNewSchema: boolean =
      globalDictionary !== undefined ||
      profileItem["timeUnixNano"] !== undefined ||
      profileItem["samples"] !== undefined ||
      profileItem["durationNano"] !== undefined;

    if (!isNewSchema) {
      const oldProfile: JSONObject =
        (profileItem["profile"] as JSONObject) || {};
      const stringTable: Array<string> =
        (oldProfile["stringTable"] as Array<string>) || [];
      return {
        profileId: profileItem["profileId"] as string | undefined,
        startTimeUnixNano: profileItem["startTimeUnixNano"] as
          | string
          | number
          | undefined,
        endTimeUnixNano: profileItem["endTimeUnixNano"] as
          | string
          | number
          | undefined,
        attributes: (profileItem["attributes"] as JSONArray) || [],
        originalPayloadFormat:
          (profileItem["originalPayloadFormat"] as string) || "",
        profile: {
          stringTable: stringTable,
          functionTable: (oldProfile["functionTable"] as JSONArray) || [],
          locationTable: (oldProfile["locationTable"] as JSONArray) || [],
          mappingTable: (oldProfile["mappingTable"] as JSONArray) || [],
          linkTable: (oldProfile["linkTable"] as JSONArray) || [],
          stackTable: (oldProfile["stackTable"] as JSONArray) || [],
          attributeTable: (oldProfile["attributeTable"] as JSONArray) || [],
          sampleType: (oldProfile["sampleType"] as JSONArray) || [],
          periodType: oldProfile["periodType"] as JSONObject | undefined,
          period: (oldProfile["period"] as number) || 0,
          sample: (oldProfile["sample"] as JSONArray) || [],
        },
      };
    }

    const dict: JSONObject = globalDictionary || {};
    const stringTable: Array<string> =
      (dict["stringTable"] as Array<string>) || [];

    /*
     * The dictionary table stores `KeyValueAndUnit` (key as an index into
     * stringTable, plus an optional unit_strindex). Re-shape it into the
     * familiar OTel KeyValue form so the existing sample-label and
     * attribute-extraction code can consume it unchanged.
     */
    const attributeTable: JSONArray = this.normalizeAttributeTable(
      (dict["attributeTable"] as JSONArray) || [],
      stringTable,
    );

    const containerAttributes: JSONArray = this.attributesFromIndices(
      (profileItem["attributeIndices"] as Array<number>) || [],
      attributeTable,
    );

    const startNanoRaw: string | number | undefined = profileItem[
      "timeUnixNano"
    ] as string | number | undefined;
    const durationRaw: string | number | undefined = profileItem[
      "durationNano"
    ] as string | number | undefined;
    const endNanoRaw: string | undefined = this.addUnixNanoStrings(
      startNanoRaw,
      durationRaw,
    );

    const newSampleType: JSONObject | undefined = profileItem["sampleType"] as
      | JSONObject
      | undefined;
    const sampleTypeArray: JSONArray = newSampleType
      ? [this.normalizeValueType(newSampleType)]
      : [];

    const newPeriodType: JSONObject | undefined = profileItem["periodType"] as
      | JSONObject
      | undefined;
    const normalizedPeriodType: JSONObject | undefined = newPeriodType
      ? this.normalizeValueType(newPeriodType)
      : undefined;

    const periodRaw: unknown = profileItem["period"];
    const period: number =
      typeof periodRaw === "number"
        ? periodRaw
        : typeof periodRaw === "string"
          ? parseInt(periodRaw, 10) || 0
          : 0;

    return {
      profileId: profileItem["profileId"] as string | undefined,
      startTimeUnixNano: startNanoRaw,
      endTimeUnixNano: endNanoRaw,
      attributes: containerAttributes,
      originalPayloadFormat:
        (profileItem["originalPayloadFormat"] as string) || "",
      profile: {
        stringTable: stringTable,
        functionTable: (dict["functionTable"] as JSONArray) || [],
        locationTable: (dict["locationTable"] as JSONArray) || [],
        mappingTable: (dict["mappingTable"] as JSONArray) || [],
        linkTable: (dict["linkTable"] as JSONArray) || [],
        stackTable: (dict["stackTable"] as JSONArray) || [],
        attributeTable: attributeTable,
        sampleType: sampleTypeArray,
        periodType: normalizedPeriodType,
        period: period,
        sample: (profileItem["samples"] as JSONArray) || [],
      },
    };
  }

  /**
   * Convert a v1development `repeated KeyValueAndUnit` attribute table
   * into the OTel `KeyValue` shape (`{ key: string, value: AnyValue }`)
   * by resolving each `key_strindex` against the shared string table.
   * Unit is dropped — nothing downstream consumes it today.
   */
  private static normalizeAttributeTable(
    table: JSONArray,
    stringTable: Array<string>,
  ): JSONArray {
    if (!Array.isArray(table) || table.length === 0) {
      return [];
    }
    const out: JSONArray = [];
    for (const entry of table) {
      const e: JSONObject = (entry as JSONObject) || {};
      // Old-schema KeyValue entries already have `key` as a string.
      if (typeof e["key"] === "string") {
        out.push(e);
        continue;
      }
      const idxRaw: unknown = e["keyStrindex"];
      let keyStrindex: number = 0;
      if (typeof idxRaw === "number") {
        keyStrindex = idxRaw;
      } else if (typeof idxRaw === "string") {
        keyStrindex = parseInt(idxRaw, 10) || 0;
      }
      const key: string =
        keyStrindex > 0 && keyStrindex < stringTable.length
          ? stringTable[keyStrindex] || ""
          : "";
      out.push({
        key: key,
        value: (e["value"] as JSONObject) || {},
      });
    }
    return out;
  }

  /**
   * Materialise the OTel KeyValue entries pointed at by `attribute_indices`.
   * The first table entry is the dictionary sentinel (empty key), so we
   * silently drop index 0 and any indices that resolve to an entry with
   * no key.
   */
  private static attributesFromIndices(
    indices: Array<number> | undefined,
    attributeTable: JSONArray,
  ): JSONArray {
    if (!indices || indices.length === 0 || attributeTable.length === 0) {
      return [];
    }
    const out: JSONArray = [];
    for (const idxRaw of indices) {
      const idx: number = Number(idxRaw);
      if (!Number.isFinite(idx) || idx <= 0 || idx >= attributeTable.length) {
        continue;
      }
      const attr: JSONObject = attributeTable[idx] as JSONObject;
      const key: unknown = attr["key"];
      if (typeof key === "string" && key.length > 0) {
        out.push(attr);
      }
    }
    return out;
  }

  /**
   * Translate a v1development `ValueType` (`type_strindex`/`unit_strindex`)
   * into the legacy `{ type, unit }` shape that the rest of the pipeline
   * expects. Tolerates the old field names so a mixed-version batch still
   * round-trips.
   */
  private static normalizeValueType(vt: JSONObject): JSONObject {
    const typeIdx: number =
      ((vt["type"] as number | undefined) ??
        (vt["typeStrindex"] as number | undefined)) ||
      0;
    const unitIdx: number =
      ((vt["unit"] as number | undefined) ??
        (vt["unitStrindex"] as number | undefined)) ||
      0;
    return { type: typeIdx, unit: unitIdx };
  }

  /**
   * Sum two UnixNano values (start + duration) and return the result as a
   * numeric string. Inputs may arrive as numbers, decimal strings, or
   * already-bigint-shaped strings (protobufjs serialises uint64 / fixed64
   * as strings). Returns undefined when neither input is set.
   */
  private static addUnixNanoStrings(
    start: string | number | undefined,
    duration: string | number | undefined,
  ): string | undefined {
    if (start === undefined && duration === undefined) {
      return undefined;
    }
    const ZERO: bigint = BigInt(0);
    const toBig: (v: string | number | undefined) => bigint = (
      v: string | number | undefined,
    ): bigint => {
      if (v === undefined || v === null) {
        return ZERO;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) {
          return ZERO;
        }
        return BigInt(Math.trunc(v));
      }
      const s: string = typeof v === "string" ? v : String(v);
      const cleaned: string = s.includes(".") ? s.split(".")[0] || "0" : s;
      try {
        return BigInt(cleaned || "0");
      } catch {
        return ZERO;
      }
    };
    return (toBig(start) + toBig(duration)).toString();
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

  /*
   * Common attribute/label keys that agents use to carry OTel trace
   * correlation alongside a profile. Checked in order; first non-empty wins.
   */
  private static readonly TRACE_ID_KEYS: Array<string> = [
    "trace_id",
    "traceId",
    "trace.id",
    "profile.trace_id",
    "profile.traceId",
    "resource.trace_id",
    "resource.traceId",
    "resource.trace.id",
  ];

  private static readonly SPAN_ID_KEYS: Array<string> = [
    "span_id",
    "spanId",
    "span.id",
    "profile.span_id",
    "profile.spanId",
    "resource.span_id",
    "resource.spanId",
    "resource.span.id",
  ];

  /*
   * A trace or span id of all zeros is the OTel convention for "unset".
   * Length sanity check rejects obvious junk (trace = 32 hex chars,
   * span = 16 hex chars, but agents occasionally emit shorter forms — we
   * only filter the all-zero case).
   */
  private static isEmptyHexId(value: string): boolean {
    if (!value) {
      return true;
    }
    const allZerosRegex: RegExp = /^0+$/;
    return allZerosRegex.test(value);
  }

  private static findCorrelationValue(
    source: Dictionary<unknown>,
    keys: Array<string>,
  ): string {
    for (const key of keys) {
      const raw: unknown = source[key];
      let candidate: string = "";
      if (typeof raw === "string") {
        candidate = raw;
      } else if (typeof raw === "number" || typeof raw === "bigint") {
        candidate = raw.toString();
      }
      if (candidate && !this.isEmptyHexId(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  /*
   * OTLP/JSON sends ids (trace/span and the 16-byte profile id) as hex
   * strings, OTLP/protobuf as base64 — Text.convertOtlpIdToHex tells
   * them apart so hex ids are never base64-decoded into garbage, which
   * silently broke trace<->profile correlation.
   */
  private static convertBase64ToHexSafe(value: string | undefined): string {
    return Text.convertOtlpIdToHex(value);
  }
}
