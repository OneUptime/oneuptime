import DecodedFlowRecord from "./DecodedFlowRecord";
import IpfixParser, { ParsedIpfixMessage } from "./IpfixParser";
import NetFlowV5Parser, {
  NetFlowV5Record,
  ParsedNetFlowV5Datagram,
} from "./NetFlowV5Parser";
import NetFlowV9Parser, { ParsedNetFlowV9Datagram } from "./NetFlowV9Parser";
import SFlowParser, { ParsedSFlowDatagram } from "./SFlowParser";
import TemplateFlowDecoder, { MAX_SAMPLING_RATE } from "./TemplateFlowDecoder";
import NetworkFlowApplicationUtil, {
  NetworkFlowPorts,
} from "Common/Types/NetFlow/NetworkFlowApplication";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";

/*
 * Every flow datagram a probe receives goes through here: whatever port it
 * arrived on, the first bytes say what it is - NetFlow v5, NetFlow v9,
 * IPFIX or sFlow - and the matching decoder reads it. What comes out is one
 * shape (NetworkFlowRecord) whatever came in:
 *
 *   - counts are estimates of the real traffic: a sampled record's bytes
 *     and packets are multiplied by its sampling rate;
 *   - the exporter is the device's own address when the datagram gives one
 *     (an sFlow agent, an IPFIX or v9 option record), else the address the
 *     datagram came from;
 *   - a client's ephemeral port is folded into 0
 *     (NetworkFlowApplicationUtil.foldEphemeralPort), so the probe can sum
 *     every connection to the same service into one record;
 *   - records that carry no traffic (no addresses, no bytes and no packets)
 *     are left out.
 *
 * The template state for NetFlow v9 and IPFIX is kept here, for the life of
 * the receiving socket.
 */

export enum FlowDatagramOutcome {
  Decoded = "decoded",
  // A flow format, but cut short or inconsistent: nothing (more) to read.
  Malformed = "malformed",
  // A flow format version the collector does not read (NetFlow v1/v7/v8, sFlow v2/v4).
  Unsupported = "unsupported",
}

export interface FlowDatagramResult {
  outcome: FlowDatagramOutcome;
  format: NetworkFlowFormat | null;
  // Who sent it: see the header comment.
  exporterAddress: string;
  records: Array<NetworkFlowRecord>;
  // What an unsupported datagram was, in words ("NetFlow v8").
  unsupportedFormat: string | null;
  // NetFlow v9 / IPFIX data that waits for its template.
  dataSetsWaitingForTemplate: number;
  // Records that decoded but carried no traffic.
  recordsWithoutTraffic: number;
}

const NETFLOW_V5_VERSION: number = 5;
const NETFLOW_V9_VERSION: number = 9;
const IPFIX_VERSION: number = 10;
const SFLOW_VERSION: number = 5;

// Old NetFlow versions some gear still offers; named so the collector can say so.
const UNSUPPORTED_NETFLOW_VERSIONS: ReadonlyArray<number> = [1, 6, 7, 8];
const UNSUPPORTED_SFLOW_VERSIONS: ReadonlyArray<number> = [2, 3, 4];

const IPV4_MAPPED_PREFIX: string = "::ffff:";

export default class FlowDatagramDecoder {
  private netFlowV9Parser: NetFlowV9Parser;
  private ipfixParser: IpfixParser;
  private now: () => number;

  public constructor(options?: { now?: (() => number) | undefined }) {
    this.now =
      options?.now ??
      ((): number => {
        return Date.now();
      });

    // One template state for both template-based formats.
    const templateDecoder: TemplateFlowDecoder = new TemplateFlowDecoder({
      now: this.now,
    });

    this.netFlowV9Parser = new NetFlowV9Parser({ decoder: templateDecoder });
    this.ipfixParser = new IpfixParser({ decoder: templateDecoder });
  }

  public decode(
    datagram: Buffer,
    source: { address: string; port: number },
  ): FlowDatagramResult {
    const sourceAddress: string = FlowDatagramDecoder.normalizeAddress(
      source.address,
    );

    const result: FlowDatagramResult = {
      outcome: FlowDatagramOutcome.Malformed,
      format: null,
      exporterAddress: sourceAddress,
      records: [],
      unsupportedFormat: null,
      dataSetsWaitingForTemplate: 0,
      recordsWithoutTraffic: 0,
    };

    if (!datagram || datagram.length < 4) {
      return result;
    }

    const firstWord: number = datagram.readUInt16BE(0);

    if (firstWord === NETFLOW_V5_VERSION) {
      result.format = NetworkFlowFormat.NetFlowV5;

      const parsed: ParsedNetFlowV5Datagram | null =
        NetFlowV5Parser.parse(datagram);

      if (!parsed) {
        return result;
      }

      this.addRecords(
        result,
        parsed.records.map((record: NetFlowV5Record): DecodedFlowRecord => {
          return record;
        }),
      );
      result.outcome = FlowDatagramOutcome.Decoded;
      return result;
    }

    if (firstWord === NETFLOW_V9_VERSION) {
      result.format = NetworkFlowFormat.NetFlowV9;

      const parsed: ParsedNetFlowV9Datagram | null = this.netFlowV9Parser.parse(
        datagram,
        sourceAddress,
        source.port,
      );

      if (!parsed) {
        return result;
      }

      if (parsed.exporterAddress) {
        result.exporterAddress = parsed.exporterAddress;
      }

      result.dataSetsWaitingForTemplate =
        parsed.dataFlowSetsSkippedForUnknownTemplate;
      this.addRecords(result, parsed.records);
      result.outcome =
        parsed.isMalformed && parsed.records.length === 0
          ? FlowDatagramOutcome.Malformed
          : FlowDatagramOutcome.Decoded;
      return result;
    }

    if (firstWord === IPFIX_VERSION) {
      result.format = NetworkFlowFormat.Ipfix;

      const parsed: ParsedIpfixMessage | null = this.ipfixParser.parse(
        datagram,
        sourceAddress,
        source.port,
      );

      if (!parsed) {
        return result;
      }

      if (parsed.exporterAddress) {
        result.exporterAddress = parsed.exporterAddress;
      }

      result.dataSetsWaitingForTemplate = parsed.dataSetsWaitingForTemplate;
      this.addRecords(result, parsed.records);
      result.outcome =
        parsed.isMalformed && parsed.records.length === 0
          ? FlowDatagramOutcome.Malformed
          : FlowDatagramOutcome.Decoded;
      return result;
    }

    /*
     * sFlow's version is a 32-bit word, so its first two bytes are zero -
     * which no NetFlow version is.
     */
    if (firstWord === 0) {
      const sflowVersion: number = datagram.readUInt32BE(0);

      if (sflowVersion === SFLOW_VERSION) {
        result.format = NetworkFlowFormat.SFlow;

        const parsed: ParsedSFlowDatagram | null = SFlowParser.parse(
          datagram,
          this.now(),
        );

        if (!parsed) {
          return result;
        }

        result.exporterAddress = FlowDatagramDecoder.normalizeAddress(
          parsed.header.agentAddress,
        );

        // An agent that reports 0.0.0.0 is known by where it sends from.
        if (
          result.exporterAddress === "0.0.0.0" ||
          result.exporterAddress === "::"
        ) {
          result.exporterAddress = sourceAddress;
        }

        this.addRecords(result, parsed.records);
        result.outcome =
          parsed.isMalformed && parsed.records.length === 0
            ? FlowDatagramOutcome.Malformed
            : FlowDatagramOutcome.Decoded;
        return result;
      }

      if (UNSUPPORTED_SFLOW_VERSIONS.includes(sflowVersion)) {
        result.outcome = FlowDatagramOutcome.Unsupported;
        result.unsupportedFormat = `sFlow v${sflowVersion}`;
      }

      return result;
    }

    if (UNSUPPORTED_NETFLOW_VERSIONS.includes(firstWord)) {
      result.outcome = FlowDatagramOutcome.Unsupported;
      result.unsupportedFormat = `NetFlow v${firstWord}`;
    }

    return result;
  }

  private addRecords(
    result: FlowDatagramResult,
    records: Array<DecodedFlowRecord>,
  ): void {
    for (const record of records) {
      const normalized: NetworkFlowRecord | null =
        FlowDatagramDecoder.normalize(
          record,
          result.format!,
          result.exporterAddress,
        );

      if (normalized) {
        result.records.push(normalized);
      } else {
        result.recordsWithoutTraffic++;
      }
    }
  }

  /*
   * A decoded record as the server takes it, or null when it carries no
   * traffic to show.
   */
  public static normalize(
    record: DecodedFlowRecord,
    format: NetworkFlowFormat,
    exporterAddress: string,
  ): NetworkFlowRecord | null {
    const sourceIpAddress: string = FlowDatagramDecoder.normalizeAddress(
      record.sourceIpAddress,
    );
    const destinationIpAddress: string = FlowDatagramDecoder.normalizeAddress(
      record.destinationIpAddress,
    );

    if (
      FlowDatagramDecoder.isUnspecified(sourceIpAddress) &&
      FlowDatagramDecoder.isUnspecified(destinationIpAddress)
    ) {
      return null;
    }

    if (record.octets <= 0 && record.packets <= 0) {
      return null;
    }

    const samplingRate: number =
      Number.isFinite(record.samplingRate) && record.samplingRate > 1
        ? Math.min(Math.round(record.samplingRate), MAX_SAMPLING_RATE)
        : 1;

    const ports: NetworkFlowPorts =
      NetworkFlowApplicationUtil.foldEphemeralPort(
        record.protocolNumber,
        record.sourcePort,
        record.destinationPort,
      );

    return {
      exporterIpAddress: exporterAddress,
      sourceIpAddress: sourceIpAddress,
      destinationIpAddress: destinationIpAddress,
      sourcePort: ports.sourcePort,
      destinationPort: ports.destinationPort,
      protocolNumber: record.protocolNumber,
      octets: Math.max(0, record.octets) * samplingRate,
      packets: Math.max(0, record.packets) * samplingRate,
      flowStartAt: record.flowStartAt,
      flowEndAt: record.flowEndAt,
      inputInterfaceIndex: record.inputInterfaceIndex,
      outputInterfaceIndex: record.outputInterfaceIndex,
      tcpFlags: record.tcpFlags,
      tos: record.tos,
      flowFormat: format,
      samplingRate: samplingRate,
      flowCount: 1,
    };
  }

  /*
   * An IPv4 address that reached an IPv6 socket, or an exporter field, as
   * "::ffff:10.0.0.1" is the IPv4 address: devices are registered by it.
   */
  public static normalizeAddress(address: string): string {
    const trimmed: string = (address || "").trim().toLowerCase();

    if (trimmed.startsWith(IPV4_MAPPED_PREFIX)) {
      const tail: string = trimmed.substring(IPV4_MAPPED_PREFIX.length);

      if (FlowDatagramDecoder.isIpV4(tail)) {
        return tail;
      }
    }

    return trimmed;
  }

  private static isIpV4(value: string): boolean {
    const parts: Array<string> = value.split(".");

    return (
      parts.length === 4 &&
      parts.every((part: string): boolean => {
        const octet: number = Number(part);
        return (
          part !== "" && Number.isInteger(octet) && octet >= 0 && octet <= 255
        );
      })
    );
  }

  private static isUnspecified(address: string): boolean {
    return address === "0.0.0.0" || address === "::" || address === "";
  }
}
