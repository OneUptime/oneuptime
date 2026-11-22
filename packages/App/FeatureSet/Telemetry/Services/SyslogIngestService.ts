import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryBatch } from "Common/Server/Utils/PatternWorkScope";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { EventLoopBudget } from "Common/Server/Utils/EventLoop";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import OTelIngestService, {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import LogService from "Common/Server/Services/LogService";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import OtelIngestBaseService from "./OtelIngestBaseService";
import SyslogQueueService from "./Queue/SyslogQueueService";
import LogPipelineService, { LoadedPipeline } from "./LogPipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "./LogDropFilterService";
import LogScrubRuleService from "./LogScrubRuleService";
import SecurityAddressVaultWriter, {
  SecurityAddressVaultBatch,
} from "Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter";
import { TELEMETRY_LOG_FLUSH_BATCH_SIZE } from "../Config";
import {
  ParsedSyslogMessage,
  ParsedSyslogStructuredData,
  parseSyslogMessage,
} from "../Utils/SyslogParser";
import NetworkEventAttribute from "Common/Types/NetworkEvent/NetworkEventAttribute";
import SyslogAttribute from "Common/Types/Syslog/SyslogAttribute";
import {
  getNetworkEventName,
  markNetworkEvent,
} from "Common/Utils/NetworkEvent/NetworkEventLog";
import SyslogEventNormalizer, {
  NormalizedSyslogMessage,
} from "Common/Utils/Syslog/SyslogEventNormalizer";
import { syslogStructuredDataAttributeKey } from "Common/Utils/Syslog/SyslogMessageParser";
import SyslogRawCopies from "Common/Utils/Syslog/SyslogRawCopies";
import { SyslogParserId } from "Common/Utils/Syslog/SyslogVendorParser";
import {
  SYSLOG_FACILITY_LABELS,
  SYSLOG_SEVERITY_LABELS,
  SYSLOG_TO_OTEL_SEVERITY,
  isSyslogSeverity,
} from "Common/Utils/Syslog/SyslogSeverity";
import SyslogDeviceMatcher, {
  SyslogDeviceAttribution,
} from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter, {
  FanInSubmitResult,
  pushObservedAck,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryIngestAttribution from "Common/Server/Utils/Telemetry/TelemetryIngestAttribution";
import { measureTelemetryIngestRequest } from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetHttp";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

class SyslogStorageFlushError extends Error {
  public constructor(error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);
    super(`Failed to flush syslog logs to ClickHouse: ${message}`);
    this.name = "SyslogStorageFlushError";

    if (error instanceof Error && error.stack) {
      this.stack = `${this.stack}\nCaused by: ${error.stack}`;
    }
  }
}

export default class SyslogIngestService extends OtelIngestBaseService {
  // One copy of what a priority means, for every way syslog arrives.
  private static readonly SYSLOG_FACILITY_LABELS: ReadonlyArray<string> =
    SYSLOG_FACILITY_LABELS;

  private static readonly SYSLOG_SEVERITY_LABELS: ReadonlyArray<string> =
    SYSLOG_SEVERITY_LABELS;

  private static readonly DEFAULT_SERVICE_NAME: string = "Syslog";

  private static readonly SYSLOG_TO_OTEL_SEVERITY: Readonly<
    Dictionary<{
      number: number;
      text: LogSeverity;
    }>
  > = SYSLOG_TO_OTEL_SEVERITY;

  @CaptureSpan()
  public static async ingestSyslog(
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
       * The size the worker shares the batch out at over its teams' and
       * labels' budgets and the usage metrics (#10102): what the request
       * path counted, read before the body is reshaped below. Only for a
       * project that needs it; two set lookups for any other.
       */
      const ingestBytes: number | undefined =
        await TelemetryIngestAttribution.getRequestBytesToShare({
          projectId: (req as TelemetryRequest).projectId,
          charge: (req as TelemetryRequest).telemetryIngestionBudgetCharge,
          measure: () => {
            return measureTelemetryIngestRequest({
              req: req,
              surface: TelemetryIngestSurface.Syslog,
            });
          },
        });

      const messages: Array<string> = this.normalizeMessages(req.body);

      if (messages.length === 0) {
        throw new BadRequestException("No syslog messages found in request.");
      }

      if (ingestBytes !== undefined) {
        (req as TelemetryRequest).telemetryIngestBytes = ingestBytes;
      }

      req.body = {
        messages,
      } satisfies JSONObject;

      /*
       * Acknowledge only after queue admission, as the OTLP endpoints do.
       * This answered 200 first and queued after, so messages the queue then
       * refused were lost behind a success; a relay retries a 503. The queue
       * service logs the failure; the sender is told nothing of the backend
       * or its payload.
       */
      try {
        await SyslogQueueService.addSyslogIngestJob(req as TelemetryRequest);
      } catch {
        return Response.sendCustomResponse(
          req,
          res,
          503,
          { message: "Telemetry queue unavailable. Please retry." },
          {},
        );
      }

      Response.sendEmptySuccessResponse(req, res);

      return;
    } catch (error) {
      return next(error);
    }
  }

  @CaptureSpan()
  public static async processSyslogFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processSyslogAsync(req);
  }

  @CaptureSpan()
  @TelemetryBatch()
  private static async processSyslogAsync(req: ExpressRequest): Promise<void> {
    /*
     * Durability acks from the fan-in writer, one per submitted batch. The
     * job only completes once every ack has resolved (ack-after-flush), so
     * a payload whose rows never landed fails and is retried by BullMQ.
     * Declared outside the try so the catch can settle them — an error
     * thrown mid-processing must not leave rejected acks unobserved.
     */
    const pendingAcks: Array<Promise<void>> = [];

    try {
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const messages: Array<string> = this.extractMessagesFromRequest(req.body);

      if (messages.length === 0) {
        logger.warn("Syslog ingest: no messages to process.");
        return;
      }

      const dbLogs: Array<JSONObject> = [];
      /*
       * By the service name a line gives (its header's, APP-NAME or
       * HOSTNAME): a Map, which answers only for the names put in it. A
       * plain object answered "constructor", "toString" or "__proto__"
       * with what every object inherits, so the lookup was skipped, the
       * row could not be built, and the line was not stored.
       */
      const serviceCache: Map<string, TelemetryServiceMetadata> = new Map();
      let processed: number = 0;

      // Whose lines these are: null for most projects (#10102).
      const attribution: TelemetryIngestAttribution | null =
        (req as TelemetryRequest).telemetryIngestAttribution || null;

      /*
       * Load pipelines, drop filters, and scrub rules once per batch so
       * syslog-ingested logs go through the same processing stage as the
       * OTLP path (OtelLogsIngestService.processLogsAsync). Without this,
       * configured LogPipelines / drop filters / scrub rules are silently
       * bypassed for syslog — the most common log source for many
       * deployments. A load failure is logged and swallowed so a config
       * lookup error can never fail ingest.
       */
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
        logger.error(
          "Syslog ingest: error loading pipelines/drop filters/scrub rules:",
        );
        logger.error(loadError);
      }

      /*
       * The addresses this batch's IP Address Hash rules hide, kept for
       * Security Events' address vault when Security Events reads the
       * project's logs (#10395), and written after the batch's logs.
       */
      const addressVault: SecurityAddressVaultBatch | null =
        await SecurityAddressVaultWriter.startBatch({
          projectId: projectId,
          signal: "log",
          scrubRules: loadedScrubRules,
        });

      /*
       * Handed back by the time the work took, not every so many messages:
       * a message's work grows with its scrub rules and what they read
       * (Common/Server/Utils/EventLoop.ts).
       */
      const eventLoopBudget: EventLoopBudget = new EventLoopBudget();

      for (const rawMessage of messages) {
        try {
          if (eventLoopBudget.isSpent()) {
            await eventLoopBudget.handBack();
          }

          const parsed: ParsedSyslogMessage | null =
            parseSyslogMessage(rawMessage);

          if (!parsed) {
            logger.warn(
              `Syslog ingest: unable to parse message: ${rawMessage}`,
            );
            continue;
          }

          const serviceName: string = this.resolveServiceName(req, parsed);

          let serviceMetadata: TelemetryServiceMetadata | undefined =
            serviceCache.get(serviceName);

          if (!serviceMetadata) {
            serviceMetadata = await OTelIngestService.telemetryServiceFromName({
              serviceName,
              projectId,
            });
            serviceCache.set(serviceName, serviceMetadata);
          }

          /*
           * Whose line this is (TelemetryIngestAttribution, #10102): offered
           * with its service, line by line - a service already offered adds
           * the line to its count. A used-up budget of its team or a label
           * drops its lines, and the rest of the batch is stored.
           */
          if (
            attribution &&
            !(await attribution.admitResource({
              primaryEntityId: serviceMetadata.primaryEntityId,
              primaryEntityType: serviceMetadata.primaryEntityType,
              name: serviceName,
              records: 1,
            }))
          ) {
            continue;
          }

          /*
           * What the message itself says: whose format it is, its fields,
           * and whether it is something that happened on the network - and
           * the network device it names, if the project has it.
           */
          const read: {
            normalized: NormalizedSyslogMessage;
            device: SyslogDeviceAttribution | null;
          } = await this.readVendorMessage(projectId, parsed);

          const severityInfo: { number: number; text: LogSeverity } =
            this.mapSeverity(
              // A line without a priority may still say how serious it is.
              parsed.severity === undefined &&
                isSyslogSeverity(read.normalized.severity)
                ? read.normalized.severity
                : parsed.severity,
            );

          const timestamp: Date =
            parsed.timestamp || OneUptimeDate.getCurrentDate();
          const ingestionDate: Date = OneUptimeDate.getCurrentDate();

          const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
            // What the line says first: it never replaces what ingest knows.
            ...read.normalized.attributes,
            ...this.buildDeviceAttributes(read.device),
            ...this.buildAttributes({
              parsed,
              primaryEntityId: serviceMetadata.primaryEntityId,
              serviceName,
            }),
          };

          /*
           * Which device an event is about, in words: its name here, else
           * the name it gives itself. Only on what already is a network
           * event: a server's sshd line carries an event's name without
           * being one (see readVendorMessage), and must stay that way.
           */
          const eventDevice: string =
            read.device?.device.name ||
            read.normalized.identity.hostname ||
            read.normalized.headerHostname ||
            "";

          if (getNetworkEventName(attributes as JSONObject) !== null) {
            markNetworkEvent(attributes as JSONObject, {
              device: eventDevice,
            });
          }

          const retentionDays: number = resolveTelemetryRetentionInDays({
            pillar: "logs",
            bucketKey: severityInfo.text,
            serviceConfig: serviceMetadata.serviceRetentionConfig,
            serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
            projectConfig: serviceMetadata.projectRetentionConfig,
            projectRetentionInDays: serviceMetadata.projectRetentionInDays,
          });
          const retentionDate: Date = OneUptimeDate.addRemoveDurationInDays(
            ingestionDate,
            retentionDays,
          );

          let logRow: JSONObject = {
            _id: ObjectID.generateTimeOrdered().toString(),
            createdAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
            projectId: projectId.toString(),
            primaryEntityId: serviceMetadata.primaryEntityId.toString(),
            primaryEntityType: serviceMetadata.primaryEntityType,
            entityKeys: serviceMetadata.entityKeys || [],
            // serviceEntityKey from the resolved service; '' for the rest.
            ...getScalarEntityKeyColumns(serviceMetadata),
            time: OneUptimeDate.toClickhouseDateTime64(timestamp),
            timeUnixNano: Math.trunc(
              OneUptimeDate.toUnixNano(timestamp),
            ).toString(),
            severityNumber: severityInfo.number,
            severityText: severityInfo.text,
            attributes,
            attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
            traceId: "",
            spanId: "",
            body: parsed.message,
            retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
          } satisfies JSONObject;

          /*
           * Apply the same log-processing stage as the OTLP path, in the
           * same order: drop filter (skip the row entirely), then sensitive
           * data scrubbing, then pipeline processors. Each guarded on a
           * non-empty rule set so projects with none configured pay no cost.
           */
          if (
            loadedDropFilters.length > 0 &&
            LogDropFilterService.shouldDropLog(logRow, loadedDropFilters)
          ) {
            continue;
          }

          /*
           * The line's raw copies, syslog.raw and syslog.structured.raw,
           * are put together again from what the rules left of its parts,
           * before a pipeline reads them (Common/Utils/Syslog/
           * SyslogRawCopies, #9039).
           */
          if (loadedScrubRules.length > 0) {
            logRow = SyslogRawCopies.scrubLog({
              logRow: logRow,
              line: parsed,
              scrub: (row: JSONObject): JSONObject => {
                return LogScrubRuleService.scrubLog(
                  row,
                  loadedScrubRules,
                  addressVault,
                );
              },
            });
          }

          if (loadedPipelines.length > 0) {
            logRow = LogPipelineService.processLog(logRow, loadedPipelines);
          }

          /*
           * An event a pipeline named, on the log of a network device, is a
           * network event like a built-in one. Other syslog - a server's -
           * keeps whatever its pipelines file under the same key.
           */
          if (
            read.device &&
            markNetworkEvent(logRow["attributes"] as JSONObject | undefined, {
              device: eventDevice,
            })
          ) {
            logRow["attributeKeys"] = TelemetryUtil.getAttributeKeys(
              logRow["attributes"] as JSONObject,
            );
          }

          dbLogs.push(logRow);
          processed++;

          if (dbLogs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE) {
            await this.submitLogsBuffer(dbLogs, pendingAcks);
          }
        } catch (processingError) {
          if (processingError instanceof SyslogStorageFlushError) {
            throw processingError;
          }

          logger.error("Syslog ingest: error processing message");
          logger.error(processingError);
          logger.error(`Syslog message: ${rawMessage}`);
        }
      }

      // The batch's attribution, counted in one round trip (#10102).
      await attribution?.settle();

      await this.submitLogsBuffer(dbLogs, pendingAcks, true);

      /*
       * Ack-after-flush: wait for every fan-in batch containing this
       * job's rows to durably land in ClickHouse before the job is
       * allowed to succeed. A rejected ack (batch definitively failed
       * after the writer's own retries) fails the job so BullMQ
       * re-processes the payload.
       */
      await Promise.all(pendingAcks);

      // The logs are stored: their hashed addresses go to the vault, on their own.
      addressVault?.write();

      if (attribution && attribution.getDroppedResourceCount() > 0) {
        logger.debug(
          `Syslog ingest: dropped the lines of ${attribution.getDroppedResourceCount()} service(s) for project ${projectId.toString()}: a team or label budget is used up.`,
        );
      }

      if (processed === 0 && !attribution?.getDroppedResourceCount()) {
        logger.warn("Syslog ingest: no valid messages processed");
      } else {
        logger.debug(
          `Syslog ingest: processed ${processed} messages for project ${projectId.toString()}`,
        );
      }

      dbLogs.length = 0;

      try {
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Syslog ingest: error during memory cleanup");
        logger.error(cleanupError);
      }
    } catch (error) {
      /*
       * Settle all outstanding write acks before rethrowing: an error
       * thrown mid-processing (message parse failure, lost body, ...) must
       * not leave still-pending ack promises to reject unobserved later.
       * The original error stays the one reported to BullMQ.
       */
      await Promise.allSettled(pendingAcks);

      logger.error(
        "Syslog ingest: critical error",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  /*
   * A message's vendor fields and event, and the network device of the
   * project it names. A relay posts for many devices from one address, so
   * here the device is found by what the message says: a MAC address, a
   * serial number, an address, or a host name exactly one device has. A
   * format with no mark of its own is read again once its device, and so
   * who made it, is known.
   *
   * This endpoint is also where servers send their syslog, and a server
   * writes the same sshd and kernel lines an access point does. Such a
   * line is a network event only on the log of a network device: from any
   * other host it keeps its fields and the event's name, without the
   * domain that would list a server's failed logins among what happened
   * on the network. A line in a network vendor's own format can only have
   * come from network equipment, and is an event wherever it came from.
   *
   * Nothing here may fail a message: a lookup that errors leaves it
   * without a device.
   */
  private static async readVendorMessage(
    projectId: ObjectID,
    parsed: ParsedSyslogMessage,
  ): Promise<{
    normalized: NormalizedSyslogMessage;
    device: SyslogDeviceAttribution | null;
  }> {
    let normalized: NormalizedSyslogMessage =
      SyslogEventNormalizer.normalizeParsed(parsed);
    let device: SyslogDeviceAttribution | null = null;

    try {
      device = await SyslogDeviceMatcher.findDeviceInProject(projectId, {
        identity: normalized.identity,
        headerHostname: normalized.headerHostname,
      });
    } catch (matchError) {
      logger.error("Syslog ingest: error matching a message to a device:");
      logger.error(matchError);
    }

    if (device && !normalized.parserId && device.device.vendorText) {
      normalized = SyslogEventNormalizer.normalizeParsed(parsed, {
        deviceVendor: device.device.vendorText,
      });
    }

    if (!device && normalized.parserId === SyslogParserId.Linux) {
      const attributes: Record<string, string> = { ...normalized.attributes };

      delete attributes[NetworkEventAttribute.Domain];

      normalized = { ...normalized, attributes: attributes };
    }

    return { normalized: normalized, device: device };
  }

  // The attributes that put a log on its network device's pages.
  private static buildDeviceAttributes(
    device: SyslogDeviceAttribution | null,
  ): Dictionary<AttributeType> {
    if (!device) {
      return {};
    }

    const attributes: Dictionary<AttributeType> = {
      "networkDevice.id": device.device.id.toString(),
      [SyslogAttribute.MatchedBy]: device.matchedBy,
    };

    if (device.device.name) {
      attributes["networkDevice.name"] = device.device.name;
    }

    return attributes;
  }

  private static resolveServiceName(
    req: ExpressRequest,
    parsed: ParsedSyslogMessage,
  ): string {
    const headerServiceName: string = this.getServiceNameFromHeaders(req, "");

    if (headerServiceName) {
      return headerServiceName;
    }

    if (parsed.appName && parsed.appName.trim()) {
      return parsed.appName.trim();
    }

    if (parsed.hostname && parsed.hostname.trim()) {
      return parsed.hostname.trim();
    }

    return SyslogIngestService.DEFAULT_SERVICE_NAME;
  }

  private static buildAttributes(data: {
    parsed: ParsedSyslogMessage;
    primaryEntityId: ObjectID;
    serviceName: string;
  }): Dictionary<AttributeType | Array<AttributeType>> {
    const { parsed } = data;

    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
        serviceId: data.primaryEntityId,
        serviceName: data.serviceName,
      }),
      [SyslogAttribute.Raw]: parsed.raw,
    };

    if (parsed.hostname) {
      attributes[SyslogAttribute.Hostname] = parsed.hostname;
    }

    if (parsed.appName) {
      attributes[SyslogAttribute.AppName] = parsed.appName;
    }

    if (parsed.procId) {
      attributes[SyslogAttribute.ProcessId] = parsed.procId;
    }

    if (parsed.msgId) {
      attributes[SyslogAttribute.MessageId] = parsed.msgId;
    }

    if (parsed.version !== undefined) {
      attributes[SyslogAttribute.Version] = parsed.version;
    }

    if (parsed.priority !== undefined) {
      attributes[SyslogAttribute.Priority] = parsed.priority;
    }

    if (parsed.severity !== undefined) {
      attributes[SyslogAttribute.SeverityCode] = parsed.severity;
      attributes[SyslogAttribute.SeverityName] = this.getSeverityLabel(
        parsed.severity,
      );
    }

    if (parsed.facility !== undefined) {
      attributes[SyslogAttribute.FacilityCode] = parsed.facility;
      attributes[SyslogAttribute.FacilityName] = this.getFacilityLabel(
        parsed.facility,
      );
    }

    if (parsed.structuredDataRaw) {
      attributes[SyslogAttribute.StructuredRaw] = parsed.structuredDataRaw;
    }

    if (parsed.structuredData) {
      this.appendStructuredDataAttributes(attributes, parsed.structuredData);
    }

    return attributes;
  }

  private static appendStructuredDataAttributes(
    attributes: Dictionary<AttributeType | Array<AttributeType>>,
    structuredData: ParsedSyslogStructuredData,
  ): void {
    for (const [sdId, params] of Object.entries(structuredData)) {
      for (const [key, value] of Object.entries(params)) {
        attributes[syslogStructuredDataAttributeKey(sdId, key)] = value;
      }
    }
  }

  private static getSeverityLabel(severity: number): string {
    if (
      severity >= 0 &&
      severity < SyslogIngestService.SYSLOG_SEVERITY_LABELS.length
    ) {
      return SyslogIngestService.SYSLOG_SEVERITY_LABELS[severity]!;
    }

    return "unknown";
  }

  private static getFacilityLabel(facility: number): string {
    if (
      facility >= 0 &&
      facility < SyslogIngestService.SYSLOG_FACILITY_LABELS.length
    ) {
      return SyslogIngestService.SYSLOG_FACILITY_LABELS[facility]!;
    }

    return "unknown";
  }

  private static mapSeverity(severity?: number | undefined): {
    number: number;
    text: LogSeverity;
  } {
    if (severity === undefined || severity === null) {
      return { number: 0, text: LogSeverity.Unspecified };
    }

    const key: string = severity.toString();

    if (this.SYSLOG_TO_OTEL_SEVERITY[key]) {
      return this.SYSLOG_TO_OTEL_SEVERITY[key]!;
    }

    return { number: 0, text: LogSeverity.Unspecified };
  }

  /*
   * Hand accumulated log rows to the shared fan-in writer, which batches
   * them ACROSS jobs and inserts through a small per-pod concurrency gate
   * (see TelemetryFanInWriter). Awaiting this method is only the writer's
   * acceptance/backpressure gate — durability acks land in `pendingAcks`
   * and MUST be awaited before the job completes (ack-after-flush).
   */
  private static async submitLogsBuffer(
    logs: Array<JSONObject>,
    pendingAcks: Array<Promise<void>>,
    force: boolean = false,
  ): Promise<void> {
    while (
      logs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE ||
      (force && logs.length > 0)
    ) {
      const batch: Array<JSONObject> = logs.splice(
        0,
        Math.min(logs.length, TELEMETRY_LOG_FLUSH_BATCH_SIZE),
      );

      if (batch.length === 0) {
        continue;
      }

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        LogService,
        batch,
      );
      pushObservedAck(pendingAcks, submission.flushed, (error: Error) => {
        return new SyslogStorageFlushError(error);
      });
    }
  }

  private static extractMessagesFromRequest(body: unknown): Array<string> {
    if (!body || typeof body !== "object") {
      return [];
    }

    const payload: JSONObject = body as JSONObject;
    const messages: unknown = payload["messages"];

    if (Array.isArray(messages)) {
      return messages
        .map((item: unknown) => {
          if (typeof item === "string") {
            return item;
          }

          if (item === null || item === undefined) {
            return "";
          }

          return String(item);
        })
        .filter((item: string | undefined): item is string => {
          return Boolean(item && item.trim());
        });
    }

    if (typeof messages === "string") {
      return this.normalizeMessages(messages);
    }

    return [];
  }

  private static normalizeMessages(payload: unknown): Array<string> {
    if (!payload) {
      return [];
    }

    if (typeof payload === "string") {
      return payload
        .split(/\r?\n/)
        .map((line: string) => {
          return line.trim();
        })
        .filter((line: string) => {
          return line.length > 0;
        });
    }

    if (Buffer.isBuffer(payload)) {
      return this.normalizeMessages(payload.toString("utf-8"));
    }

    if (Array.isArray(payload)) {
      const results: Array<string> = [];
      for (const item of payload) {
        results.push(...this.normalizeMessages(item));
      }
      return results;
    }

    if (typeof payload === "object") {
      const obj: JSONObject = payload as JSONObject;

      if (Array.isArray(obj["messages"])) {
        return this.normalizeMessages(obj["messages"]);
      }

      if (typeof obj["message"] === "string") {
        return this.normalizeMessages(obj["message"]);
      }

      if (Array.isArray(obj["syslog"])) {
        return this.normalizeMessages(obj["syslog"]);
      }

      if (typeof obj["syslog"] === "string") {
        return this.normalizeMessages(obj["syslog"]);
      }
    }

    return [];
  }
}
