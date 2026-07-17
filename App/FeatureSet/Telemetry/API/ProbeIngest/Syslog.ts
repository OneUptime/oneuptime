import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import LogPipelineService, {
  LoadedPipeline,
} from "../../Services/LogPipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../Services/LogDropFilterService";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import BadDataException from "Common/Types/Exception/BadDataException";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import LogSeverity from "Common/Types/Log/LogSeverity";
import SyslogMessage from "Common/Types/Syslog/SyslogMessage";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import LogService from "Common/Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

// Telemetry service name used when a matched device has no name set.
const DEFAULT_SERVICE_NAME: string = "network-devices";

const SYSLOG_FACILITY_LABELS: Array<string> = [
  "kernel",
  "user",
  "mail",
  "system",
  "security",
  "syslogd",
  "line_printer",
  "network_news",
  "uucp",
  "clock",
  "security2",
  "ftp",
  "ntp",
  "log_audit",
  "log_alert",
  "clock2",
  "local0",
  "local1",
  "local2",
  "local3",
  "local4",
  "local5",
  "local6",
  "local7",
];

const SYSLOG_SEVERITY_LABELS: Array<string> = [
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "informational",
  "debug",
];

/*
 * Syslog severity (RFC 5424 numerical codes 0-7) → OTel log severity. Same
 * mapping the HTTP syslog ingest uses (SyslogIngestService): 0-1 → Fatal,
 * 2-3 → Error, 4 → Warning, 5-6 → Information, 7 → Debug. The numbers sit
 * inside the OTLP range for each severity text, so text and number agree.
 */
const SYSLOG_TO_OTEL_SEVERITY: Dictionary<{
  number: number;
  text: LogSeverity;
}> = {
  "0": { number: 23, text: LogSeverity.Fatal },
  "1": { number: 23, text: LogSeverity.Fatal },
  "2": { number: 19, text: LogSeverity.Error },
  "3": { number: 19, text: LogSeverity.Error },
  "4": { number: 13, text: LogSeverity.Warning },
  "5": { number: 9, text: LogSeverity.Information },
  "6": { number: 9, text: LogSeverity.Information },
  "7": { number: 5, text: LogSeverity.Debug },
};

/*
 * Per-project log-processing rules (drop filters, scrub rules, pipelines),
 * loaded once per project per batch so probe-forwarded syslog goes through
 * the same processing stage as the OTLP and HTTP-syslog paths.
 */
interface LogProcessingContext {
  pipelines: Array<LoadedPipeline>;
  dropFilters: Array<LoadedLogDropFilter>;
  scrubRules: Awaited<ReturnType<typeof LogScrubRuleService.loadScrubRules>>;
}

router.post(
  "/probe/syslog",
  TelemetryIngestionDisabled.middleware,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawMessages: unknown = req.body["syslogMessages"];

      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("syslogMessages not found in request body"),
        );
      }

      const probeIdAsString: string | undefined = req.body["probeId"] as
        | string
        | undefined;

      if (!probeIdAsString) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe ID not found on syslog request"),
        );
      }

      // Return response immediately — correlation and log writes happen after.
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      try {
        await processSyslogMessages(
          new ObjectID(probeIdAsString),
          rawMessages as Array<JSONObject>,
        );
      } catch (err) {
        // The response is already sent — log instead of next(err).
        logger.error("Probe syslog ingest: error processing batch:");
        logger.error(err);
      }

      return;
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Correlates each message to the NetworkDevices matching its source IP and
 * writes it into the telemetry Logs pipeline. On a GLOBAL probe the same
 * hostname can be registered by devices in several projects, so a message
 * fans out to EVERY match (one log row per device, in that device's
 * project with that project's pipelines and retention) — the policy the
 * trap path established — instead of landing in whichever single project
 * the database returns first. Messages whose source IP matches no device
 * polled by this probe are dropped — without a device there is no project
 * to attribute the log to.
 */
async function processSyslogMessages(
  probeId: ObjectID,
  rawMessages: Array<JSONObject>,
): Promise<void> {
  const deviceCache: Dictionary<Array<NetworkDevice>> = {};
  const serviceCache: Dictionary<TelemetryServiceMetadata> = {};
  const processingContextCache: Dictionary<LogProcessingContext> = {};

  const dbLogs: Array<JSONObject> = [];
  let unmatched: number = 0;
  let malformed: number = 0;

  for (const rawMessage of rawMessages) {
    try {
      const syslogMessage: SyslogMessage | null =
        deserializeSyslogMessage(rawMessage);

      if (!syslogMessage) {
        malformed++;
        continue;
      }

      const deviceCacheKey: string = syslogMessage.sourceIpAddress;

      if (!(deviceCacheKey in deviceCache)) {
        deviceCache[deviceCacheKey] = await findDevicesForSource(
          probeId,
          syslogMessage.sourceIpAddress,
        );
      }

      const devices: Array<NetworkDevice> = deviceCache[deviceCacheKey] || [];

      if (devices.length === 0) {
        unmatched++;
        continue;
      }

      const severityInfo: { number: number; text: LogSeverity } = mapSeverity(
        syslogMessage.severity,
      );

      const ingestionDate: Date = OneUptimeDate.getCurrentDate();

      for (const device of devices) {
        if (!device.id || !device.projectId) {
          continue;
        }

        const projectId: ObjectID = device.projectId;
        const serviceName: string = device.name?.trim() || DEFAULT_SERVICE_NAME;
        const serviceCacheKey: string = `${projectId.toString()}:${serviceName}`;

        if (!serviceCache[serviceCacheKey]) {
          serviceCache[serviceCacheKey] =
            await OTelIngestService.telemetryServiceFromName({
              serviceName: serviceName,
              projectId: projectId,
            });
        }

        const serviceMetadata: TelemetryServiceMetadata =
          serviceCache[serviceCacheKey]!;

        const attributes: Dictionary<AttributeType | Array<AttributeType>> =
          buildAttributes({
            syslogMessage: syslogMessage,
            device: device,
            probeId: probeId,
            serviceMetadata: serviceMetadata,
            serviceName: serviceName,
          });

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
          time: OneUptimeDate.toClickhouseDateTime64(syslogMessage.timestamp),
          timeUnixNano: Math.trunc(
            OneUptimeDate.toUnixNano(syslogMessage.timestamp),
          ).toString(),
          severityNumber: severityInfo.number,
          severityText: severityInfo.text,
          attributes: attributes,
          attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
          traceId: "",
          spanId: "",
          body: syslogMessage.message,
          retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
        } satisfies JSONObject;

        /*
         * Same log-processing stage as the OTLP / HTTP-syslog paths, in the
         * same order: drop filter (skip the row entirely), then sensitive
         * data scrubbing, then pipeline processors.
         */
        const processingContext: LogProcessingContext =
          await getLogProcessingContext(projectId, processingContextCache);

        if (
          processingContext.dropFilters.length > 0 &&
          LogDropFilterService.shouldDropLog(
            logRow,
            processingContext.dropFilters,
          )
        ) {
          continue;
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

        dbLogs.push(logRow);
      }
    } catch (processingError) {
      logger.error("Probe syslog ingest: error processing message:");
      logger.error(processingError);
    }
  }

  if (dbLogs.length > 0) {
    await LogService.insertJsonRows(dbLogs);
  }

  logger.debug(
    `Probe syslog ingest: wrote ${dbLogs.length} log(s) for probe ${probeId.toString()} (${unmatched} message(s) from unmatched sources dropped, ${malformed} malformed).`,
  );
}

/*
 * Correlates a syslog source IP to NetworkDevices: devices polled by the
 * probe that received the message whose hostname equals the datagram's
 * source address — the same match the SNMP trap path uses
 * (NetworkDeviceHydrationUtil.findDevicesByProbeAndSource). Replicated here
 * rather than reused because this path also needs the device name for log
 * attribution.
 */
async function findDevicesForSource(
  probeId: ObjectID,
  sourceIpAddress: string,
): Promise<Array<NetworkDevice>> {
  return NetworkDeviceService.findBy({
    query: {
      probeId: probeId,
      hostname: sourceIpAddress,
    },
    select: {
      _id: true,
      projectId: true,
      name: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });
}

async function getLogProcessingContext(
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

/*
 * Rebuilds a SyslogMessage from the JSON the probe POSTed. Dates arrive as
 * ISO strings; a missing or unparseable timestamp falls back to receivedAt,
 * and a missing receivedAt falls back to now.
 */
function deserializeSyslogMessage(raw: JSONObject): SyslogMessage | null {
  if (!raw || typeof raw !== "object") {
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
    isNaN(facility) ||
    isNaN(severity)
  ) {
    return null;
  }

  const receivedAt: Date = parseDateOrDefault(
    raw["receivedAt"],
    OneUptimeDate.getCurrentDate(),
  );

  const timestamp: Date = parseDateOrDefault(raw["timestamp"], receivedAt);

  const hostname: string | undefined =
    typeof raw["hostname"] === "string" && raw["hostname"].trim()
      ? raw["hostname"].trim()
      : undefined;

  const appName: string | undefined =
    typeof raw["appName"] === "string" && raw["appName"].trim()
      ? raw["appName"].trim()
      : undefined;

  return {
    sourceIpAddress: sourceIpAddress,
    facility: facility,
    severity: severity,
    timestamp: timestamp,
    hostname: hostname,
    appName: appName,
    message: raw["message"],
    receivedAt: receivedAt,
  };
}

function parseDateOrDefault(value: unknown, fallback: Date): Date {
  if (value instanceof Date) {
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

function buildAttributes(data: {
  syslogMessage: SyslogMessage;
  device: NetworkDevice;
  probeId: ObjectID;
  serviceMetadata: TelemetryServiceMetadata;
  serviceName: string;
}): Dictionary<AttributeType | Array<AttributeType>> {
  const syslogMessage: SyslogMessage = data.syslogMessage;

  const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
    ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
      serviceId: data.serviceMetadata.primaryEntityId,
      serviceName: data.serviceName,
    }),
    "syslog.sourceIp": syslogMessage.sourceIpAddress,
    "syslog.facility.code": syslogMessage.facility,
    "syslog.facility.name": getFacilityLabel(syslogMessage.facility),
    "syslog.severity.code": syslogMessage.severity,
    "syslog.severity.name": getSeverityLabel(syslogMessage.severity),
    "probe.id": data.probeId.toString(),
  };

  if (syslogMessage.hostname) {
    attributes["syslog.hostname"] = syslogMessage.hostname;
  }

  if (syslogMessage.appName) {
    attributes["syslog.appName"] = syslogMessage.appName;
  }

  if (data.device.id) {
    attributes["networkDevice.id"] = data.device.id.toString();
  }

  if (data.device.name) {
    attributes["networkDevice.name"] = data.device.name;
  }

  return attributes;
}

function getSeverityLabel(severity: number): string {
  if (severity >= 0 && severity < SYSLOG_SEVERITY_LABELS.length) {
    return SYSLOG_SEVERITY_LABELS[severity]!;
  }

  return "unknown";
}

function getFacilityLabel(facility: number): string {
  if (facility >= 0 && facility < SYSLOG_FACILITY_LABELS.length) {
    return SYSLOG_FACILITY_LABELS[facility]!;
  }

  return "unknown";
}

function mapSeverity(severity: number): {
  number: number;
  text: LogSeverity;
} {
  const mapped: { number: number; text: LogSeverity } | undefined =
    SYSLOG_TO_OTEL_SEVERITY[severity.toString()];

  if (mapped) {
    return mapped;
  }

  return { number: 0, text: LogSeverity.Unspecified };
}

export default router;
