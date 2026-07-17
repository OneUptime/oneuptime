import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import BadDataException from "Common/Types/Exception/BadDataException";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";
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

router.post(
  "/probe/network-flow",
  TelemetryIngestionDisabled.middleware,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawRecords: unknown = req.body["flowRecords"];

      if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("flowRecords not found in request body"),
        );
      }

      const probeIdAsString: string | undefined = req.body["probeId"] as
        | string
        | undefined;

      if (!probeIdAsString) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe ID not found on network flow request"),
        );
      }

      // Return response immediately — correlation and inserts happen after.
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      try {
        await processFlowRecords(
          new ObjectID(probeIdAsString),
          rawRecords as Array<JSONObject>,
        );
      } catch (err) {
        // The response is already sent — log instead of next(err).
        logger.error("Probe network flow ingest: error processing batch:");
        logger.error(err);
      }

      return;
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Correlates each flow to the NetworkDevices matching the EXPORTER's IP
 * (the router/switch that sent the NetFlow datagram — devices are matched
 * by probeId + hostname, the same match the syslog and SNMP trap paths
 * use) and writes the flow into the ClickHouse NetworkFlow table. On a
 * GLOBAL probe the same hostname can be registered by devices in several
 * projects, so the flow fans out to EVERY match (one row per device) —
 * the policy the trap path established — instead of landing in whichever
 * single project the database returns first. Flows whose exporter matches
 * no device polled by this probe are dropped — without a device there is
 * no project to attribute the flow to.
 */
async function processFlowRecords(
  probeId: ObjectID,
  rawRecords: Array<JSONObject>,
): Promise<void> {
  const deviceCache: Dictionary<Array<NetworkDevice>> = {};

  const rows: Array<JSONObject> = [];
  let unmatched: number = 0;
  let malformed: number = 0;

  const ingestedAt: Date = OneUptimeDate.getCurrentDate();

  for (const rawRecord of rawRecords) {
    try {
      const flowRecord: NetworkFlowRecord | null =
        deserializeFlowRecord(rawRecord);

      if (!flowRecord) {
        malformed++;
        continue;
      }

      const deviceCacheKey: string = flowRecord.exporterIpAddress;

      if (!(deviceCacheKey in deviceCache)) {
        deviceCache[deviceCacheKey] =
          await NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
            probeId: probeId,
            sourceIpAddress: flowRecord.exporterIpAddress,
          });
      }

      const devices: Array<NetworkDevice> = deviceCache[deviceCacheKey] || [];

      if (devices.length === 0) {
        unmatched++;
        continue;
      }

      for (const device of devices) {
        if (!device.id || !device.projectId) {
          continue;
        }

        rows.push({
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: OneUptimeDate.toClickhouseDateTime(ingestedAt),
          projectId: device.projectId.toString(),
          networkDeviceId: device.id.toString(),
          exporterIp: flowRecord.exporterIpAddress,
          srcIp: flowRecord.sourceIpAddress,
          dstIp: flowRecord.destinationIpAddress,
          srcPort: flowRecord.sourcePort,
          dstPort: flowRecord.destinationPort,
          protocol: flowRecord.protocolNumber,
          octets: flowRecord.octets,
          packets: flowRecord.packets,
          flowStartAt: OneUptimeDate.toClickhouseDateTime64(
            flowRecord.flowStartAt,
          ),
          flowEndAt: OneUptimeDate.toClickhouseDateTime64(flowRecord.flowEndAt),
          ingestedAt: OneUptimeDate.toClickhouseDateTime64(ingestedAt),
        } satisfies JSONObject);
      }
    } catch (processingError) {
      logger.error("Probe network flow ingest: error processing record:");
      logger.error(processingError);
    }
  }

  if (rows.length > 0) {
    await NetworkFlowService.insertJsonRows(rows);
  }

  logger.debug(
    `Probe network flow ingest: wrote ${rows.length} flow(s) for probe ${probeId.toString()} (${unmatched} flow(s) from unmatched exporters dropped, ${malformed} malformed).`,
  );
}

/*
 * Rebuilds a NetworkFlowRecord from the JSON the probe POSTed. Dates
 * arrive as ISO strings; unparseable timestamps fall back to now. Numeric
 * fields are validated and clamped to non-negative integers — a record
 * missing its addressing or counters is malformed and dropped.
 */
function deserializeFlowRecord(raw: JSONObject): NetworkFlowRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const exporterIpAddress: string = readTrimmedString(raw["exporterIpAddress"]);
  const sourceIpAddress: string = readTrimmedString(raw["sourceIpAddress"]);
  const destinationIpAddress: string = readTrimmedString(
    raw["destinationIpAddress"],
  );

  const sourcePort: number | null = readNonNegativeInteger(raw["sourcePort"]);
  const destinationPort: number | null = readNonNegativeInteger(
    raw["destinationPort"],
  );
  const protocolNumber: number | null = readNonNegativeInteger(
    raw["protocolNumber"],
  );
  const octets: number | null = readNonNegativeInteger(raw["octets"]);
  const packets: number | null = readNonNegativeInteger(raw["packets"]);

  if (
    !exporterIpAddress ||
    !sourceIpAddress ||
    !destinationIpAddress ||
    sourcePort === null ||
    destinationPort === null ||
    protocolNumber === null ||
    octets === null ||
    packets === null
  ) {
    return null;
  }

  const fallbackDate: Date = OneUptimeDate.getCurrentDate();
  const flowStartAt: Date = parseDateOrDefault(
    raw["flowStartAt"],
    fallbackDate,
  );
  const flowEndAt: Date = parseDateOrDefault(raw["flowEndAt"], flowStartAt);

  const inputInterfaceIndex: number | null = readNonNegativeInteger(
    raw["inputInterfaceIndex"],
  );
  const outputInterfaceIndex: number | null = readNonNegativeInteger(
    raw["outputInterfaceIndex"],
  );
  const tcpFlags: number | null = readNonNegativeInteger(raw["tcpFlags"]);
  const tos: number | null = readNonNegativeInteger(raw["tos"]);

  return {
    exporterIpAddress: exporterIpAddress,
    sourceIpAddress: sourceIpAddress,
    destinationIpAddress: destinationIpAddress,
    sourcePort: sourcePort,
    destinationPort: destinationPort,
    protocolNumber: protocolNumber,
    octets: octets,
    packets: packets,
    flowStartAt: flowStartAt,
    flowEndAt: flowEndAt,
    inputInterfaceIndex: inputInterfaceIndex ?? undefined,
    outputInterfaceIndex: outputInterfaceIndex ?? undefined,
    tcpFlags: tcpFlags ?? undefined,
    tos: tos ?? undefined,
  };
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed: number = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.trunc(parsed);
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

export default router;
