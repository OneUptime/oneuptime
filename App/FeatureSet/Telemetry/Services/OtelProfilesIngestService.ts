import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import OneUptimeDate from "Common/Types/Date";
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
      const batch: Array<JSONObject> = profiles.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await ProfileService.insertJsonRows(batch);
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
      const batch: Array<JSONObject> = samples.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await ProfileSampleService.insertJsonRows(batch);
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

      req.body = req.body?.toJSON ? req.body.toJSON() : req.body;

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
      const resourceProfiles: JSONArray = req.body[
        "resourceProfiles"
      ] as JSONArray;

      if (!resourceProfiles || !Array.isArray(resourceProfiles)) {
        logger.error(
          "Invalid resourceProfiles format in request body",
          getLogAttributesFromRequest(req as RequestLike),
        );
        throw new BadRequestException("Invalid resourceProfiles format");
      }

      const dbProfiles: Array<JSONObject> = [];
      const dbSamples: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalProfilesProcessed: number = 0;

      let resourceProfileCounter: number = 0;
      for (const resourceProfile of resourceProfiles) {
        try {
          if (resourceProfileCounter % 25 === 0) {
            await Promise.resolve();
          }
          resourceProfileCounter++;

          const serviceName: string = await this.getServiceNameFromAttributes(
            req,
            ((resourceProfile["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [],
          );

          if (!serviceDictionary[serviceName]) {
            const service: {
              serviceId: ObjectID;
              dataRententionInDays: number;
            } = await OTelIngestService.telemetryServiceFromName({
              serviceName: serviceName,
              projectId: (req as TelemetryRequest).projectId,
            });

            serviceDictionary[serviceName] = {
              serviceName: serviceName,
              serviceId: service.serviceId,
              dataRententionInDays: service.dataRententionInDays,
            };
          }

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
              serviceId: serviceDictionary[serviceName]!.serviceId!,
              serviceName: serviceName,
            }),
            ...TelemetryUtil.getAttributes({
              items:
                ((resourceProfile["resource"] as JSONObject)?.[
                  "attributes"
                ] as JSONArray) || [],
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
                await Promise.resolve();
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
              for (const profileContainer of profileContainers) {
                try {
                  if (profileCounter % 100 === 0) {
                    await Promise.resolve();
                  }
                  profileCounter++;

                  const projectId: ObjectID = (req as TelemetryRequest)
                    .projectId;
                  const serviceId: ObjectID =
                    serviceDictionary[serviceName]!.serviceId!;
                  const dataRetentionInDays: number =
                    serviceDictionary[serviceName]!.dataRententionInDays;

                  const profileId: string =
                    this.convertBase64ToHexSafe(
                      (profileContainer as JSONObject)["profileId"] as
                        | string
                        | undefined,
                    ) || ObjectID.generate().toString();

                  const startTime: ParsedUnixNano = this.safeParseUnixNano(
                    (profileContainer as JSONObject)["startTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "profile startTimeUnixNano",
                  );

                  const endTime: ParsedUnixNano = this.safeParseUnixNano(
                    (profileContainer as JSONObject)["endTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "profile endTimeUnixNano",
                  );

                  const durationNano: number = Math.max(
                    0,
                    Math.trunc(endTime.unixNano - startTime.unixNano),
                  );

                  // Container-level attributes
                  const containerAttributes: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items:
                        ((profileContainer as JSONObject)[
                          "attributes"
                        ] as JSONArray) || [],
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

                  const profile: JSONObject | undefined = (
                    profileContainer as JSONObject
                  )["profile"] as JSONObject | undefined;

                  const originalPayloadFormat: string =
                    ((profileContainer as JSONObject)[
                      "originalPayloadFormat"
                    ] as string) || "";

                  // Extract sample types from the profile
                  let profileType: string = "unknown";
                  let unit: string = "unknown";
                  let periodType: string = "";
                  let period: number = 0;
                  let sampleCount: number = 0;

                  if (profile) {
                    const stringTable: Array<string> =
                      (profile["stringTable"] as Array<string>) || [];

                    // Extract sample type from first sample_type entry
                    const sampleTypes: JSONArray =
                      (profile["sampleType"] as JSONArray) || [];
                    if (sampleTypes.length > 0) {
                      const firstSampleType: JSONObject =
                        sampleTypes[0] as JSONObject;
                      const typeIndex: number =
                        (firstSampleType["type"] as number) || 0;
                      const unitIndex: number =
                        (firstSampleType["unit"] as number) || 0;

                      if (stringTable[typeIndex]) {
                        profileType = stringTable[typeIndex]!;
                      }
                      if (stringTable[unitIndex]) {
                        unit = stringTable[unitIndex]!;
                      }
                    }

                    // Extract period type
                    const periodTypeObj: JSONObject | undefined = profile[
                      "periodType"
                    ] as JSONObject | undefined;
                    if (periodTypeObj) {
                      const periodTypeIndex: number =
                        (periodTypeObj["type"] as number) || 0;
                      if (stringTable[periodTypeIndex]) {
                        periodType = stringTable[periodTypeIndex]!;
                      }
                    }
                    period = (profile["period"] as number) || 0;

                    // Process samples
                    const samples: JSONArray =
                      (profile["sample"] as JSONArray) || [];
                    sampleCount = samples.length;

                    // Build dictionary tables for denormalization
                    const functionTable: JSONArray =
                      (profile["functionTable"] as JSONArray) || [];
                    const locationTable: JSONArray =
                      (profile["locationTable"] as JSONArray) || [];
                    const linkTable: JSONArray =
                      (profile["linkTable"] as JSONArray) || [];
                    const stackTable: JSONArray =
                      (profile["stackTable"] as JSONArray) || [];
                    const attributeTable: JSONArray =
                      (profile["attributeTable"] as JSONArray) || [];

                    let firstSampleTraceId: string = "";
                    let firstSampleSpanId: string = "";

                    let sampleCounter: number = 0;
                    for (const sample of samples) {
                      try {
                        if (sampleCounter % 200 === 0) {
                          await Promise.resolve();
                        }
                        sampleCounter++;

                        const sampleObj: JSONObject = sample as JSONObject;

                        // Resolve the stack frames
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

                        // Compute stacktrace hash
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
                        if (
                          linkIndexRaw !== undefined &&
                          linkIndexRaw !== null
                        ) {
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

                        // Extract sample value (first value from values array)
                        const values: Array<number | string> =
                          (sampleObj["value"] as Array<number | string>) || [];
                        let sampleValue: number = 0;
                        if (values.length > 0) {
                          sampleValue =
                            typeof values[0] === "string"
                              ? parseInt(values[0]!, 10) || 0
                              : (values[0] as number) || 0;
                        }

                        // Extract sample timestamp
                        const timestamps: Array<number | string> =
                          (sampleObj["timestampsUnixNano"] as Array<
                            number | string
                          >) || [];
                        let sampleTime: ParsedUnixNano = startTime;
                        if (timestamps.length > 0) {
                          sampleTime = this.safeParseUnixNano(
                            timestamps[0] as string | number,
                            "sample timestampsUnixNano",
                          );
                        }

                        // Resolve sample-level labels from attribute_indices
                        const sampleLabels: Dictionary<string> = {};
                        const sampleAttributeIndices: Array<number> =
                          (sampleObj["attributeIndices"] as Array<number>) ||
                          [];
                        for (const attrIdx of sampleAttributeIndices) {
                          if (attrIdx >= 0 && attrIdx < attributeTable.length) {
                            const attr: JSONObject = attributeTable[
                              attrIdx
                            ] as JSONObject;
                            const key: string = (attr["key"] as string) || "";
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
                          serviceId: serviceId,
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
                          dataRetentionInDays: dataRetentionInDays,
                        });

                        dbSamples.push(sampleRow);

                        if (
                          dbSamples.length >=
                          TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE
                        ) {
                          await this.flushSamplesBuffer(dbSamples);
                        }
                      } catch (sampleError) {
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
                        const link: JSONObject = linkTable[
                          linkIdx
                        ] as JSONObject;
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
                      serviceId: serviceId,
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
                      dataRetentionInDays: dataRetentionInDays,
                    });

                    dbProfiles.push(profileRow);
                    totalProfilesProcessed++;

                    if (
                      dbProfiles.length >= TELEMETRY_PROFILE_FLUSH_BATCH_SIZE
                    ) {
                      await this.flushProfilesBuffer(dbProfiles);
                    }
                  }
                } catch (profileError) {
                  logger.error("Error processing individual profile:");
                  logger.error(profileError);
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope profile:");
              logger.error(scopeError);
            }
          }
        } catch (resourceError) {
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
      const lines: JSONArray = (location["line"] as JSONArray) || [];

      // Resolve frame type from location type_index
      let locFrameType: string = "unknown";
      const typeIndex: number | undefined = location["typeIndex"] as
        | number
        | undefined;
      if (typeIndex !== undefined && typeIndex >= 0) {
        // type_index refers to attribute_table entry with key "profile.frame.type"
        if (typeIndex < data.attributeTable.length) {
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
            const nameIndex: number = (func["name"] as number) || 0;
            const fileIndex: number = (func["filename"] as number) || 0;

            if (nameIndex >= 0 && nameIndex < data.stringTable.length) {
              functionName = data.stringTable[nameIndex] || "<unknown>";
            }
            if (fileIndex >= 0 && fileIndex < data.stringTable.length) {
              fileName = data.stringTable[fileIndex] || "";
            }
          }

          lineNumber = (line["line"] as number) || 0;

          let frame: string = functionName;
          if (fileName) {
            frame += `@${fileName}`;
          }
          if (lineNumber > 0) {
            frame += `:${lineNumber}`;
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
    serviceId: ObjectID;
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
    dataRetentionInDays: number;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      data.dataRetentionInDays || 15,
    );

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
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
    serviceId: ObjectID;
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
    dataRetentionInDays: number;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      data.dataRetentionInDays || 15,
    );

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
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

  private static convertBase64ToHexSafe(value: string | undefined): string {
    if (!value) {
      return "";
    }

    try {
      return Text.convertBase64ToHex(value);
    } catch {
      return "";
    }
  }
}
