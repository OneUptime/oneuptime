import NetworkFlowDeviceMatcher, {
  FlowExporterAttribution,
  FlowProbe,
} from "./NetworkFlowDeviceMatcher";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import NetworkFlowFormat, {
  NetworkFlowFormatUtil,
} from "../../../Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "../../../Types/NetFlow/NetworkFlowRecord";
import ObjectID from "../../../Types/ObjectID";

/*
 * Turning what a probe's flow collector forwards into NetworkFlow rows.
 *
 * Every field is checked: a probe is trusted to be ours, not to be
 * correct, and an older probe sends fewer fields (no format, rate or
 * count) - those read as what that probe could decode (NetFlow v5 or v9),
 * every packet counted, one record per row. A record missing its addresses
 * or counters is dropped as malformed.
 */

// The largest sampling rate a probe may claim (its own bound).
export const MAX_FLOW_SAMPLING_RATE: number = 16777216;

// A probe never sums more records than this into one row in a few seconds.
export const MAX_FLOW_COUNT: number = 1_000_000_000;

// Longest address text a row keeps (an IPv6 address is at most 45).
const MAX_ADDRESS_LENGTH: number = 64;

export interface FlowIngestResult {
  rows: Array<JSONObject>;
  // Flows from exporters nobody could be found for, on a global probe.
  droppedUnmatched: number;
  malformed: number;
  // Rows kept for a project because the exporter is no device of it yet.
  unmatchedKept: number;
}

export type AttributeExporterFunction = (
  probe: FlowProbe,
  exporterAddress: string,
) => Promise<FlowExporterAttribution>;

export default class NetworkFlowIngest {
  public static async buildRows(data: {
    probe: FlowProbe;
    rawRecords: Array<unknown>;
    ingestedAt: Date;
    attribute?: AttributeExporterFunction | undefined;
  }): Promise<FlowIngestResult> {
    const attribute: AttributeExporterFunction =
      data.attribute ||
      ((probe: FlowProbe, exporterAddress: string) => {
        return NetworkFlowDeviceMatcher.attribute(probe, exporterAddress);
      });

    const attributions: Map<string, FlowExporterAttribution> = new Map();
    const result: FlowIngestResult = {
      rows: [],
      droppedUnmatched: 0,
      malformed: 0,
      unmatchedKept: 0,
    };

    for (const raw of data.rawRecords) {
      const record: NetworkFlowRecord | null =
        NetworkFlowIngest.deserializeFlowRecord(raw, data.ingestedAt);

      if (!record) {
        result.malformed++;
        continue;
      }

      let attribution: FlowExporterAttribution | undefined = attributions.get(
        record.exporterIpAddress,
      );

      if (!attribution) {
        attribution = await attribute(data.probe, record.exporterIpAddress);
        attributions.set(record.exporterIpAddress, attribution);
      }

      if (attribution.devices.length > 0) {
        for (const device of attribution.devices) {
          result.rows.push(
            NetworkFlowIngest.toRow({
              record: record,
              projectId: device.projectId,
              networkDeviceId: device.networkDeviceId,
              probeId: data.probe.id,
              ingestedAt: data.ingestedAt,
            }),
          );
        }
        continue;
      }

      if (attribution.unmatchedProjectId) {
        /*
         * Kept for the project, its ID standing in for the device's: the
         * project's bucket, which project-wide readers see and the Traffic
         * pages turn into "add this device".
         */
        result.rows.push(
          NetworkFlowIngest.toRow({
            record: record,
            projectId: attribution.unmatchedProjectId,
            networkDeviceId: attribution.unmatchedProjectId,
            probeId: data.probe.id,
            ingestedAt: data.ingestedAt,
          }),
        );
        result.unmatchedKept++;
        continue;
      }

      result.droppedUnmatched++;
    }

    return result;
  }

  public static toRow(data: {
    record: NetworkFlowRecord;
    projectId: ObjectID;
    networkDeviceId: ObjectID;
    probeId: ObjectID;
    ingestedAt: Date;
  }): JSONObject {
    const record: NetworkFlowRecord = data.record;

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(data.ingestedAt),
      projectId: data.projectId.toString(),
      networkDeviceId: data.networkDeviceId.toString(),
      probeId: data.probeId.toString(),
      exporterIp: record.exporterIpAddress,
      srcIp: record.sourceIpAddress,
      dstIp: record.destinationIpAddress,
      srcPort: record.sourcePort,
      dstPort: record.destinationPort,
      protocol: record.protocolNumber,
      inputInterfaceIndex: record.inputInterfaceIndex ?? 0,
      outputInterfaceIndex: record.outputInterfaceIndex ?? 0,
      octets: record.octets,
      packets: record.packets,
      flowFormat: record.flowFormat || "",
      samplingRate: record.samplingRate ?? 1,
      flowCount: record.flowCount ?? 1,
      flowStartAt: OneUptimeDate.toClickhouseDateTime64(record.flowStartAt),
      flowEndAt: OneUptimeDate.toClickhouseDateTime64(record.flowEndAt),
      ingestedAt: OneUptimeDate.toClickhouseDateTime64(data.ingestedAt),
    };
  }

  /*
   * A NetworkFlowRecord rebuilt from the JSON a probe POSTed, or null when
   * it is not one. Dates arrive as ISO strings; one that does not parse is
   * the ingest time. A flow time far in the future is the ingest time too:
   * a device clock running ahead must not put traffic where no range ever
   * reaches it.
   */
  public static deserializeFlowRecord(
    raw: unknown,
    ingestedAt: Date,
  ): NetworkFlowRecord | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const value: JSONObject = raw as JSONObject;

    const exporterIpAddress: string = NetworkFlowIngest.readAddress(
      value["exporterIpAddress"],
    );
    const sourceIpAddress: string = NetworkFlowIngest.readAddress(
      value["sourceIpAddress"],
    );
    const destinationIpAddress: string = NetworkFlowIngest.readAddress(
      value["destinationIpAddress"],
    );

    const sourcePort: number | null = NetworkFlowIngest.readInteger(
      value["sourcePort"],
      65535,
    );
    const destinationPort: number | null = NetworkFlowIngest.readInteger(
      value["destinationPort"],
      65535,
    );
    const protocolNumber: number | null = NetworkFlowIngest.readInteger(
      value["protocolNumber"],
      255,
    );
    const octets: number | null = NetworkFlowIngest.readInteger(
      value["octets"],
      Number.MAX_SAFE_INTEGER,
    );
    const packets: number | null = NetworkFlowIngest.readInteger(
      value["packets"],
      Number.MAX_SAFE_INTEGER,
    );

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

    const latestMs: number = ingestedAt.getTime() + 5 * 60 * 1000;
    const flowStartAt: Date = NetworkFlowIngest.readDate(
      value["flowStartAt"],
      ingestedAt,
      latestMs,
    );
    const flowEndAt: Date = NetworkFlowIngest.readDate(
      value["flowEndAt"],
      flowStartAt,
      latestMs,
    );

    const flowFormat: NetworkFlowFormat | null = NetworkFlowFormatUtil.parse(
      value["flowFormat"],
    );

    const samplingRate: number | null = NetworkFlowIngest.readInteger(
      value["samplingRate"],
      MAX_FLOW_SAMPLING_RATE,
    );

    const flowCount: number | null = NetworkFlowIngest.readInteger(
      value["flowCount"],
      MAX_FLOW_COUNT,
    );

    const record: NetworkFlowRecord = {
      exporterIpAddress: exporterIpAddress,
      sourceIpAddress: sourceIpAddress,
      destinationIpAddress: destinationIpAddress,
      sourcePort: sourcePort,
      destinationPort: destinationPort,
      protocolNumber: protocolNumber,
      octets: octets,
      packets: packets,
      flowStartAt: flowStartAt,
      flowEndAt:
        flowEndAt.getTime() < flowStartAt.getTime() ? flowStartAt : flowEndAt,
      inputInterfaceIndex:
        NetworkFlowIngest.readInteger(
          value["inputInterfaceIndex"],
          0xffffffff,
        ) ?? 0,
      outputInterfaceIndex:
        NetworkFlowIngest.readInteger(
          value["outputInterfaceIndex"],
          0xffffffff,
        ) ?? 0,
      tcpFlags: NetworkFlowIngest.readInteger(value["tcpFlags"], 0xffff) ?? 0,
      tos: NetworkFlowIngest.readInteger(value["tos"], 255) ?? 0,
      samplingRate: samplingRate && samplingRate >= 1 ? samplingRate : 1,
      flowCount: flowCount && flowCount >= 1 ? flowCount : 1,
    };

    if (flowFormat) {
      record.flowFormat = flowFormat;
    }

    return record;
  }

  private static readAddress(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    const trimmed: string = value.trim();

    return trimmed.length <= MAX_ADDRESS_LENGTH ? trimmed : "";
  }

  // A whole number from 0 to max, or null for anything else.
  private static readInteger(value: unknown, max: number): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed: number = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
      return null;
    }

    return Math.trunc(parsed);
  }

  private static readDate(
    value: unknown,
    fallback: Date,
    latestMs: number,
  ): Date {
    let parsed: Date | null = null;

    if (value instanceof Date) {
      parsed = value;
    } else if (typeof value === "string" && value) {
      const candidate: Date = new Date(value);

      if (!isNaN(candidate.getTime())) {
        parsed = candidate;
      }
    }

    if (!parsed || parsed.getTime() > latestMs || parsed.getTime() < 0) {
      return fallback;
    }

    return parsed;
  }
}
