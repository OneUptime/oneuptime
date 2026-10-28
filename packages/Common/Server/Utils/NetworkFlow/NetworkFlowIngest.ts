import NetworkFlowDeviceMatcher, {
  FlowExporterAttribution,
  FlowProbe,
} from "./NetworkFlowDeviceMatcher";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import NetworkFlowFormat, {
  NetworkFlowFormatUtil,
} from "../../../Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "../../../Types/NetFlow/NetworkFlowRecord";
import ObjectID from "../../../Types/ObjectID";
import { normalizeReverseDnsName } from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";

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

/*
 * Names one request may carry: one per address of its records at most (two
 * addresses a record, MAX_RECORDS_PER_REQUEST records), and far fewer in
 * practice - a probe names only the addresses it has looked up.
 */
export const MAX_ADDRESS_NAMES_PER_REQUEST: number = 20000;

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
  /*
   * The DNS names a probe sent with its records (issue #5340), by address
   * written one way: { "10.0.0.5": "web-1.corp.example" }. A probe looked
   * them up on its own network and kept only names that point back to
   * their address; here each is checked again as any outside text is - an
   * address that is one, a name a DNS name can be (normalizeReverseDnsName:
   * no spaces, markup or control characters, at most 253 characters, not
   * the address restated) - and anything else is dropped, never the batch.
   * A probe older than the lookups sends none.
   */
  public static readAddressNames(value: unknown): Map<string, string> {
    const names: Map<string, string> = new Map();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return names;
    }

    for (const [address, name] of Object.entries(value as JSONObject)) {
      if (names.size >= MAX_ADDRESS_NAMES_PER_REQUEST) {
        break;
      }

      const canonical: string | null =
        NetworkAddressBlockUtil.canonicalAddress(address);
      const normalized: string | undefined = normalizeReverseDnsName(name);

      if (canonical && normalized) {
        names.set(canonical, normalized);
      }
    }

    return names;
  }

  /*
   * The names a probe may give (issue #5340). A global probe of a hosted
   * instance (BILLING_ENABLED: every sign-up shares it) names public
   * addresses only - it never looks a private one up, and a private
   * address's name from it would be a name from OneUptime's own network,
   * not the customer's - so any other name it sends is dropped. Every
   * other probe's names are kept: a project's probe, and a self-hosted
   * instance's own global probe, run in the network their names are of.
   */
  public static namesTheProbeMayGive(data: {
    names: Map<string, string>;
    probe: FlowProbe;
    isBillingEnabled: boolean;
  }): Map<string, string> {
    if (data.probe.projectId || !data.isBillingEnabled) {
      return data.names;
    }

    const kept: Map<string, string> = new Map();

    for (const [address, name] of Array.from(data.names.entries())) {
      if (getSecurityAddressScope(address) === SecurityAddressScope.Public) {
        kept.set(address, name);
      }
    }

    return kept;
  }

  // The name a probe sent for a record's address ('' when none).
  public static nameOf(
    names: Map<string, string> | undefined,
    address: string,
  ): string {
    if (!names || names.size === 0) {
      return "";
    }

    const canonical: string | null =
      NetworkAddressBlockUtil.canonicalAddress(address);

    return (canonical && names.get(canonical)) || "";
  }

  public static async buildRows(data: {
    probe: FlowProbe;
    rawRecords: Array<unknown>;
    ingestedAt: Date;
    attribute?: AttributeExporterFunction | undefined;
    // The DNS names the probe sent with the records (readAddressNames).
    addressNames?: Map<string, string> | undefined;
    // This instance's BILLING_ENABLED (namesTheProbeMayGive); tests pass it.
    isBillingEnabled?: boolean | undefined;
  }): Promise<FlowIngestResult> {
    const attribute: AttributeExporterFunction =
      data.attribute ||
      ((probe: FlowProbe, exporterAddress: string) => {
        return NetworkFlowDeviceMatcher.attribute(probe, exporterAddress);
      });

    const addressNames: Map<string, string> | undefined = data.addressNames
      ? NetworkFlowIngest.namesTheProbeMayGive({
          names: data.addressNames,
          probe: data.probe,
          isBillingEnabled:
            data.isBillingEnabled === undefined
              ? IsBillingEnabled
              : data.isBillingEnabled,
        })
      : undefined;

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
              addressNames: addressNames,
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
            addressNames: addressNames,
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
    addressNames?: Map<string, string> | undefined;
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
      srcName: NetworkFlowIngest.nameOf(
        data.addressNames,
        record.sourceIpAddress,
      ),
      dstName: NetworkFlowIngest.nameOf(
        data.addressNames,
        record.destinationIpAddress,
      ),
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
