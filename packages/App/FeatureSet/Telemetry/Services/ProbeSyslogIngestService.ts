import LogPipelineService, { LoadedPipeline } from "./LogPipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "./LogDropFilterService";
import LogScrubRuleService from "./LogScrubRuleService";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SyslogAttribute, {
  SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX,
  SyslogDeviceMatchKind,
} from "Common/Types/Syslog/SyslogAttribute";
import SyslogMessage, {
  MAX_SYSLOG_RAW_LENGTH,
} from "Common/Types/Syslog/SyslogMessage";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import NetworkEventAttribute from "Common/Types/NetworkEvent/NetworkEventAttribute";
import { markNetworkEvent } from "Common/Utils/NetworkEvent/NetworkEventLog";
import SyslogEventNormalizer, {
  NormalizedSyslogMessage,
} from "Common/Utils/Syslog/SyslogEventNormalizer";
import {
  ParsedSyslogMessage,
  ParsedSyslogStructuredData,
  SyslogHeaderFormat,
  getSyslogHeaderFormat,
  parseSyslogMessage,
  sanitizeSyslogAttributeKey,
} from "Common/Utils/Syslog/SyslogMessageParser";
import {
  DEFAULT_SYSLOG_FACILITY,
  DEFAULT_SYSLOG_SEVERITY,
  LogSeverityOfSyslog,
  getSyslogFacilityLabel,
  getSyslogSeverityLabel,
  isSyslogSeverity,
  mapSyslogSeverity,
} from "Common/Utils/Syslog/SyslogSeverity";
import LogService from "Common/Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { FlowProbe } from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import SyslogDeviceMatcher, {
  SyslogAttribution,
  SyslogDevice,
} from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import logger from "Common/Server/Utils/Logger";

/*
 * THE SYSLOG A PROBE FORWARDS, MADE INTO LOGS.
 *
 * A probe listens for syslog where the devices are and forwards what it
 * hears in batches. For each message this:
 *
 *   1. reads it - the header with the one reader every syslog path shares,
 *      then what the message itself says: whose format it is, its fields,
 *      and whether it is something that happened on the network
 *      (SyslogEventNormalizer);
 *   2. finds whose it is (SyslogDeviceMatcher): the device at the address it
 *      came from, the device a controller sent it for, or - on a project's
 *      own probe - nobody yet;
 *   3. writes one log per device, in that device's project, under a
 *      telemetry service named after the device, through the same drop
 *      filters, scrub rules and pipelines as every other log.
 *
 * A message that is nobody's is kept for the probe's project under the
 * shared service, marked `syslog.unmatched`, the way traps and flow records
 * from an address that is no device yet are kept; a global probe has no
 * project to keep it for, and it is dropped.
 */

// Telemetry service of a device with no name, and of messages from no device.
export const DEFAULT_SERVICE_NAME: string = "network-devices";

/*
 * How far a device's clock may be from the server's before its timestamp
 * is not believed. An RFC 3164 timestamp names no time zone and no year, so
 * a device set to local time, or with a clock nobody set, writes a time
 * hours or years off - and a log stored under it is outside every "last
 * five minutes" a monitor or a person looks at.
 */
export const MAX_DEVICE_CLOCK_SKEW_IN_MS: number = 5 * 60 * 1000;

/*
 * How old a timestamp that DOES name its time zone (RFC 5424) may be. A
 * sender that buffers while its link is down sends true, old times, and
 * they are kept; a clock that reads 1970 is not that.
 */
export const MAX_BUFFERED_MESSAGE_AGE_IN_MS: number = 7 * 24 * 60 * 60 * 1000;

interface LogProcessingContext {
  pipelines: Array<LoadedPipeline>;
  dropFilters: Array<LoadedLogDropFilter>;
  scrubRules: Awaited<ReturnType<typeof LogScrubRuleService.loadScrubRules>>;
}

// A message as it is read: the header's fields, and the text after them.
export interface ReadProbeSyslogMessage {
  sourceIpAddress: string;
  facility: number;
  severity: number;
  // False when the line had no priority: facility and severity are assumed.
  hasPriority: boolean;
  timestamp: Date;
  receivedAt: Date;
  headerFormat: SyslogHeaderFormat | null;
  hostname?: string | undefined;
  appName?: string | undefined;
  procId?: string | undefined;
  msgId?: string | undefined;
  structuredDataRaw?: string | undefined;
  structuredData?: ParsedSyslogStructuredData | undefined;
  // The log body.
  message: string;
  // Everything after the header, when that is more than the body.
  content?: string | undefined;
}

export interface ResolvedLogTime {
  time: Date;
  // The device's own time, when the log is not stored under it.
  deviceTime: Date | null;
}

export interface ProbeSyslogIngestResult {
  // Log rows written.
  written: number;
  // Messages from an address that is no device, kept for the probe's project.
  keptUnmatched: number;
  // Messages from an address that is no device, with no project to keep them.
  droppedUnmatched: number;
  // Messages that could not be read.
  malformed: number;
  // Rows a drop filter discarded.
  droppedByFilter: number;
}

function parseDateOrDefault(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string" && value) {
    const parsed: Date = new Date(value);

    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return fallback;
}

function trimmedOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default class ProbeSyslogIngestService {
  public static async processSyslogMessages(
    probeId: ObjectID,
    rawMessages: Array<JSONObject>,
  ): Promise<ProbeSyslogIngestResult> {
    const result: ProbeSyslogIngestResult = {
      written: 0,
      keptUnmatched: 0,
      droppedUnmatched: 0,
      malformed: 0,
      droppedByFilter: 0,
    };

    const serviceCache: Dictionary<TelemetryServiceMetadata> = {};
    const processingContextCache: Dictionary<LogProcessingContext> = {};
    const dbLogs: Array<JSONObject> = [];

    let probe: FlowProbe | null = null;

    try {
      probe = await SyslogDeviceMatcher.getProbe(probeId);
    } catch (probeError) {
      logger.error("Probe syslog ingest: error reading the probe:");
      logger.error(probeError);
    }

    /*
     * A probe row that cannot be read still has its devices: they are
     * found by the probe's id alone. Only "kept for the probe's project"
     * needs the row.
     */
    const matcherProbe: FlowProbe = probe || { id: probeId, projectId: null };

    for (const rawMessage of rawMessages) {
      try {
        const syslogMessage: SyslogMessage | null =
          ProbeSyslogIngestService.deserializeSyslogMessage(rawMessage);

        if (!syslogMessage) {
          result.malformed++;
          continue;
        }

        const read: ReadProbeSyslogMessage =
          ProbeSyslogIngestService.readMessage(syslogMessage);

        const normalized: NormalizedSyslogMessage =
          SyslogEventNormalizer.normalize({
            message: read.message,
            content: read.content,
            hostname: read.hostname,
            appName: read.appName,
          });

        const attribution: SyslogAttribution =
          await SyslogDeviceMatcher.attribute(matcherProbe, {
            sourceIpAddress: read.sourceIpAddress,
            identity: normalized.identity,
            headerHostname: normalized.headerHostname,
          });

        if (attribution.devices.length === 0) {
          if (!attribution.unmatchedProjectId) {
            result.droppedUnmatched++;
            continue;
          }

          /*
           * An open port hears more than syslog. Text with no priority
           * that no vendor parser knows, from an address that is no
           * device, has nothing that says it is a log: it is not kept.
           */
          if (!read.hasPriority && !normalized.parserId) {
            result.droppedUnmatched++;
            continue;
          }

          const row: JSONObject | null =
            await ProbeSyslogIngestService.buildLogRow({
              read: read,
              normalized: normalized,
              probeId: probeId,
              projectId: attribution.unmatchedProjectId,
              device: null,
              relay: null,
              matchedBy: null,
              serviceCache: serviceCache,
              processingContextCache: processingContextCache,
            });

          if (row) {
            dbLogs.push(row);
            result.keptUnmatched++;
          } else {
            result.droppedByFilter++;
          }

          continue;
        }

        for (const target of attribution.devices) {
          /*
           * A format with no mark of its own is read again now that the
           * device, and so who made it, is known.
           */
          const normalizedForDevice: NormalizedSyslogMessage =
            !normalized.parserId && target.device.vendorText
              ? SyslogEventNormalizer.normalize(
                  {
                    message: read.message,
                    content: read.content,
                    hostname: read.hostname,
                    appName: read.appName,
                  },
                  { deviceVendor: target.device.vendorText },
                )
              : normalized;

          const row: JSONObject | null =
            await ProbeSyslogIngestService.buildLogRow({
              read: read,
              normalized: normalizedForDevice,
              probeId: probeId,
              projectId: target.device.projectId,
              device: target.device,
              relay: target.relay,
              matchedBy: target.matchedBy,
              serviceCache: serviceCache,
              processingContextCache: processingContextCache,
            });

          if (row) {
            dbLogs.push(row);
          } else {
            result.droppedByFilter++;
          }
        }
      } catch (processingError) {
        logger.error("Probe syslog ingest: error processing message:");
        logger.error(processingError);
      }
    }

    if (dbLogs.length > 0) {
      await LogService.insertJsonRows(dbLogs);
    }

    result.written = dbLogs.length;

    logger.debug(
      `Probe syslog ingest: wrote ${result.written} log(s) for probe ${probeId.toString()} (${result.keptUnmatched} from addresses that are no device yet, ${result.droppedUnmatched} dropped with no project to keep them, ${result.malformed} malformed, ${result.droppedByFilter} dropped by a filter).`,
    );

    return result;
  }

  /*
   * Rebuilds a SyslogMessage from the JSON the probe POSTed. Dates arrive
   * as ISO strings; a missing or unparseable timestamp falls back to
   * receivedAt, and a missing receivedAt falls back to now.
   */
  public static deserializeSyslogMessage(
    raw: JSONObject | null | undefined,
  ): SyslogMessage | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const sourceIpAddress: string =
      typeof raw["sourceIpAddress"] === "string"
        ? raw["sourceIpAddress"].trim()
        : "";

    const facility: number = Number(raw["facility"]);
    const severity: number = Number(raw["severity"]);

    if (
      !sourceIpAddress ||
      typeof raw["message"] !== "string" ||
      raw["facility"] === null ||
      raw["severity"] === null ||
      isNaN(facility) ||
      isNaN(severity)
    ) {
      return null;
    }

    const receivedAt: Date = parseDateOrDefault(
      raw["receivedAt"],
      OneUptimeDate.getCurrentDate(),
    );

    const message: SyslogMessage = {
      sourceIpAddress: sourceIpAddress,
      facility: facility,
      severity: severity,
      timestamp: parseDateOrDefault(raw["timestamp"], receivedAt),
      hostname: trimmedOrUndefined(raw["hostname"]),
      appName: trimmedOrUndefined(raw["appName"]),
      message: raw["message"],
      receivedAt: receivedAt,
    };

    if (typeof raw["raw"] === "string" && raw["raw"].trim()) {
      message.raw = raw["raw"].slice(0, MAX_SYSLOG_RAW_LENGTH);
    }

    return message;
  }

  /*
   * A message's header and text. A probe that sends the line as it arrived
   * has it read here, by the reader the HTTP syslog path uses, so both keep
   * the same fields (structured data, process and message id) and vendor
   * parsers get the text with its tag. An older probe sends what it read
   * itself, and that is used as it is.
   *
   * The time is the probe's reading either way: an RFC 3164 timestamp has
   * no zone, and the probe sits where the device does.
   */
  public static readMessage(message: SyslogMessage): ReadProbeSyslogMessage {
    const parsed: ParsedSyslogMessage | null = message.raw
      ? parseSyslogMessage(message.raw)
      : null;

    if (!parsed) {
      const read: ReadProbeSyslogMessage = {
        sourceIpAddress: message.sourceIpAddress,
        facility: message.facility,
        severity: message.severity,
        hasPriority: true,
        timestamp: message.timestamp,
        receivedAt: message.receivedAt,
        headerFormat: null,
        hostname: message.hostname,
        appName: message.appName,
        message: message.message,
      };

      /*
       * The probe split "tag: text" into the app name and the message; a
       * vendor whose format starts at the tag needs them together again.
       */
      if (message.appName) {
        read.content = `${message.appName}: ${message.message}`;
      }

      return read;
    }

    const hasPriority: boolean =
      parsed.priority !== undefined &&
      parsed.facility !== undefined &&
      parsed.severity !== undefined;

    return {
      sourceIpAddress: message.sourceIpAddress,
      facility: hasPriority ? parsed.facility! : DEFAULT_SYSLOG_FACILITY,
      severity: hasPriority ? parsed.severity! : DEFAULT_SYSLOG_SEVERITY,
      hasPriority: hasPriority,
      timestamp: message.timestamp,
      receivedAt: message.receivedAt,
      headerFormat: getSyslogHeaderFormat(parsed),
      hostname: parsed.hostname,
      appName: parsed.appName,
      procId: parsed.procId,
      msgId: parsed.msgId,
      structuredDataRaw: parsed.structuredDataRaw,
      structuredData: parsed.structuredData,
      message: parsed.message,
      content: parsed.content,
    };
  }

  /*
   * The time a log is stored under.
   *
   * A message that arrives as it is written - the device's time and the
   * probe's agree to within five minutes - is stored at the time the probe
   * received it. The probe's clock is one clock for every device it
   * hears; it has milliseconds where most devices' timestamps have whole
   * seconds; and it runs in the order things arrived. So a link that goes
   * down and comes back within a second is stored in that order, and a
   * device whose clock is four minutes behind does not file its events
   * where a monitor's last five minutes are about to move on from.
   *
   * A message older than that was held back before it was sent: a sender
   * that buffered while its link was down. Its own time is the only record
   * of when it happened, and is believed when it names its zone (RFC 5424)
   * and is no older than a buffer can be.
   *
   * Anything else is a clock that cannot be believed - hours off with no
   * zone (a device in another time zone), in the future, or older than a
   * week. The log is stored at the time it was received, and the device's
   * time is kept beside it.
   *
   * The time it was received is the probe's, unless the probe's own clock
   * disagrees with the server's: then it is the server's.
   */
  public static resolveLogTime(data: {
    timestamp: Date;
    receivedAt: Date;
    headerFormat: SyslogHeaderFormat | null;
    now: Date;
  }): ResolvedLogTime {
    const now: number = data.now.getTime();
    const deviceTime: number = data.timestamp.getTime();

    const received: Date =
      Math.abs(data.receivedAt.getTime() - now) <= MAX_DEVICE_CLOCK_SKEW_IN_MS
        ? data.receivedAt
        : data.now;

    // The probe had no time to read: the timestamp IS the time it received.
    if (deviceTime === data.receivedAt.getTime()) {
      return { time: received, deviceTime: null };
    }

    const behind: number = received.getTime() - deviceTime;

    if (Math.abs(behind) <= MAX_DEVICE_CLOCK_SKEW_IN_MS) {
      return { time: received, deviceTime: null };
    }

    if (
      data.headerFormat === SyslogHeaderFormat.Rfc5424 &&
      behind > 0 &&
      behind <= MAX_BUFFERED_MESSAGE_AGE_IN_MS
    ) {
      return { time: data.timestamp, deviceTime: null };
    }

    return { time: received, deviceTime: data.timestamp };
  }

  /*
   * The log row of one message for one device (or, with no device, for
   * the project that keeps it), after drop filters, scrub rules and
   * pipelines. Null when a drop filter discards it.
   */
  private static async buildLogRow(data: {
    read: ReadProbeSyslogMessage;
    normalized: NormalizedSyslogMessage;
    probeId: ObjectID;
    projectId: ObjectID;
    device: SyslogDevice | null;
    relay: SyslogDevice | null;
    matchedBy: SyslogDeviceMatchKind | null;
    serviceCache: Dictionary<TelemetryServiceMetadata>;
    processingContextCache: Dictionary<LogProcessingContext>;
  }): Promise<JSONObject | null> {
    const read: ReadProbeSyslogMessage = data.read;
    const projectId: ObjectID = data.projectId;
    const serviceName: string = data.device?.name || DEFAULT_SERVICE_NAME;
    const serviceCacheKey: string = `${projectId.toString()}:${serviceName}`;

    if (!data.serviceCache[serviceCacheKey]) {
      data.serviceCache[serviceCacheKey] =
        await OTelIngestService.telemetryServiceFromName({
          serviceName: serviceName,
          projectId: projectId,
        });
    }

    const serviceMetadata: TelemetryServiceMetadata =
      data.serviceCache[serviceCacheKey]!;

    /*
     * A line without a priority says nothing about its severity itself;
     * a vendor's format may (RouterOS's topics, a CEF severity).
     */
    const severity: number =
      !read.hasPriority && isSyslogSeverity(data.normalized.severity)
        ? data.normalized.severity
        : read.severity;

    const severityInfo: LogSeverityOfSyslog = mapSyslogSeverity(severity);
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();

    const logTime: ResolvedLogTime = ProbeSyslogIngestService.resolveLogTime({
      timestamp: read.timestamp,
      receivedAt: read.receivedAt,
      headerFormat: read.headerFormat,
      now: ingestionDate,
    });

    const attributes: Dictionary<AttributeType | Array<AttributeType>> =
      ProbeSyslogIngestService.buildAttributes({
        read: read,
        severity: severity,
        normalized: data.normalized,
        probeId: data.probeId,
        device: data.device,
        relay: data.relay,
        matchedBy: data.matchedBy,
        serviceMetadata: serviceMetadata,
        serviceName: serviceName,
        deviceTime: logTime.deviceTime,
      });

    /*
     * Which device an event is about, in words: its name here, else the
     * name it gives itself, else its address. Set on every event, so one
     * device's can be told from another's - and alerted on apart - before
     * the device has been added.
     */
    const eventDevice: string =
      data.device?.name ||
      data.normalized.identity.hostname ||
      data.normalized.headerHostname ||
      read.sourceIpAddress;

    markNetworkEvent(attributes as JSONObject, { device: eventDevice });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "logs",
      bucketKey: severityInfo.text,
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
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
      ...getScalarEntityKeyColumns(serviceMetadata),
      time: OneUptimeDate.toClickhouseDateTime64(logTime.time),
      timeUnixNano: Math.trunc(
        OneUptimeDate.toUnixNano(logTime.time),
      ).toString(),
      severityNumber: severityInfo.number,
      severityText: severityInfo.text,
      attributes: attributes,
      attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
      traceId: "",
      spanId: "",
      body: read.message,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    } satisfies JSONObject;

    /*
     * Same log-processing stage as the OTLP / HTTP-syslog paths, in the
     * same order: drop filter (skip the row entirely), then sensitive
     * data scrubbing, then pipeline processors. What the parsers read is
     * already on the row, so a filter, a scrub rule and a pipeline can all
     * use it - and a pipeline can name an event the parsers do not know.
     */
    const processingContext: LogProcessingContext =
      await ProbeSyslogIngestService.getLogProcessingContext(
        projectId,
        data.processingContextCache,
      );

    if (
      processingContext.dropFilters.length > 0 &&
      LogDropFilterService.shouldDropLog(logRow, processingContext.dropFilters)
    ) {
      return null;
    }

    if (processingContext.scrubRules.length > 0) {
      logRow = LogScrubRuleService.scrubLog(
        logRow,
        processingContext.scrubRules,
      );
    }

    if (processingContext.pipelines.length > 0) {
      logRow = LogPipelineService.processLog(
        logRow,
        processingContext.pipelines,
      );
    }

    // An event a pipeline named is a network event like a built-in one.
    const finalAttributes: JSONObject | undefined = logRow["attributes"] as
      | JSONObject
      | undefined;

    if (markNetworkEvent(finalAttributes, { device: eventDevice })) {
      logRow["attributeKeys"] = TelemetryUtil.getAttributeKeys(finalAttributes);
    }

    return logRow;
  }

  private static buildAttributes(data: {
    read: ReadProbeSyslogMessage;
    severity: number;
    normalized: NormalizedSyslogMessage;
    probeId: ObjectID;
    device: SyslogDevice | null;
    relay: SyslogDevice | null;
    matchedBy: SyslogDeviceMatchKind | null;
    serviceMetadata: TelemetryServiceMetadata;
    serviceName: string;
    deviceTime: Date | null;
  }): Dictionary<AttributeType | Array<AttributeType>> {
    const read: ReadProbeSyslogMessage = data.read;

    /*
     * What the message says goes in first, and what ingest knows goes in
     * over it: nothing a line carries can replace where it came from or
     * which device it was matched to.
     */
    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      ...data.normalized.attributes,
    };

    if (read.structuredDataRaw) {
      attributes[SyslogAttribute.StructuredRaw] = read.structuredDataRaw;
    }

    for (const [sdId, params] of Object.entries(read.structuredData || {})) {
      for (const [key, value] of Object.entries(params)) {
        attributes[
          `${SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX}${sanitizeSyslogAttributeKey(sdId)}.${sanitizeSyslogAttributeKey(key)}`
        ] = value;
      }
    }

    Object.assign(
      attributes,
      TelemetryUtil.getAttributesForServiceIdAndServiceName({
        serviceId: data.serviceMetadata.primaryEntityId,
        serviceName: data.serviceName,
      }),
    );

    attributes[SyslogAttribute.SourceIp] = read.sourceIpAddress;
    attributes[SyslogAttribute.FacilityCode] = read.facility;
    attributes[SyslogAttribute.FacilityName] = getSyslogFacilityLabel(
      read.facility,
    );
    attributes[SyslogAttribute.SeverityCode] = data.severity;
    attributes[SyslogAttribute.SeverityName] = getSyslogSeverityLabel(
      data.severity,
    );
    attributes["probe.id"] = data.probeId.toString();

    if (read.hostname) {
      attributes[SyslogAttribute.Hostname] = read.hostname;
    }

    if (read.appName) {
      attributes[SyslogAttribute.AppName] = read.appName;
    }

    if (read.procId) {
      attributes[SyslogAttribute.ProcessId] = read.procId;
    }

    if (read.msgId) {
      attributes[SyslogAttribute.MessageId] = read.msgId;
    }

    if (data.deviceTime) {
      attributes[SyslogAttribute.DeviceTime] = data.deviceTime.toISOString();
    }

    // Whatever the message said under these names, ingest decides them.
    for (const key of [
      "networkDevice.id",
      "networkDevice.name",
      NetworkEventAttribute.Device,
      SyslogAttribute.MatchedBy,
      SyslogAttribute.RelayId,
      SyslogAttribute.RelayName,
      SyslogAttribute.Unmatched,
    ]) {
      delete attributes[key];
    }

    if (!data.device) {
      attributes[SyslogAttribute.Unmatched] = true;

      return attributes;
    }

    attributes["networkDevice.id"] = data.device.id.toString();

    if (data.device.name) {
      attributes["networkDevice.name"] = data.device.name;
    }

    if (
      data.matchedBy &&
      data.matchedBy !== SyslogDeviceMatchKind.SourceAddress
    ) {
      attributes[SyslogAttribute.MatchedBy] = data.matchedBy;
    }

    if (data.relay) {
      attributes[SyslogAttribute.RelayId] = data.relay.id.toString();

      if (data.relay.name) {
        attributes[SyslogAttribute.RelayName] = data.relay.name;
      }
    }

    return attributes;
  }

  /*
   * Per-project log-processing rules (drop filters, scrub rules,
   * pipelines), loaded once per project per batch so probe-forwarded
   * syslog goes through the same processing stage as the OTLP and
   * HTTP-syslog paths.
   */
  private static async getLogProcessingContext(
    projectId: ObjectID,
    cache: Dictionary<LogProcessingContext>,
  ): Promise<LogProcessingContext> {
    const cacheKey: string = projectId.toString();

    if (cache[cacheKey]) {
      return cache[cacheKey]!;
    }

    let context: LogProcessingContext = {
      pipelines: [],
      dropFilters: [],
      scrubRules: [],
    };

    try {
      context = {
        pipelines: await LogPipelineService.loadPipelines(projectId),
        dropFilters: await LogDropFilterService.loadDropFilters(projectId),
        scrubRules: await LogScrubRuleService.loadScrubRules(projectId),
      };
    } catch (loadError) {
      // A config lookup error must never fail ingest.
      logger.error(
        "Probe syslog ingest: error loading pipelines/drop filters/scrub rules:",
      );
      logger.error(loadError);
    }

    cache[cacheKey] = context;

    return context;
  }
}
