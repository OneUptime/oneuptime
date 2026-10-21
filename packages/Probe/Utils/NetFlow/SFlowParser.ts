import DecodedFlowRecord from "./DecodedFlowRecord";
import FlowBytes from "./FlowBytes";
import PacketHeaderDecoder, {
  DecodedPacketHeader,
} from "./PacketHeaderDecoder";

/*
 * sFlow version 5 (sflow.org/sflow_version_5.txt), what Arista, most
 * data-centre and campus switches, and many routers export.
 *
 * sFlow is a different animal from NetFlow: the device does not build flow
 * records, it SAMPLES - one packet in every N, chosen at random - and sends
 * the first bytes of that packet with N. One sampled packet therefore
 * stands for N packets, and its length times N for the bytes they carried;
 * the collector turns each sample into a flow record of exactly that
 * estimate. Interface counter samples (which SNMP polling already covers)
 * are counted and passed over.
 *
 * Everything is XDR: 4-byte big-endian words, opaque data padded to a
 * multiple of 4. The datagram names its AGENT - the address the device
 * calls itself - which identifies the device even when a NAT sits between
 * it and the probe. Stateless: one instance can parse anything. Malformed
 * input never throws; a sample that runs past the datagram ends the walk.
 */

export const SFLOW_VERSION: number = 5;

const AGENT_ADDRESS_IPV4: number = 1;
const AGENT_ADDRESS_IPV6: number = 2;

// sample_type and flow_format: enterprise (top 20 bits) and format (low 12).
const STANDARD_ENTERPRISE: number = 0;
const SAMPLE_FLOW: number = 1;
const SAMPLE_COUNTERS: number = 2;
const SAMPLE_FLOW_EXPANDED: number = 3;
const SAMPLE_COUNTERS_EXPANDED: number = 4;

const FLOW_RECORD_RAW_HEADER: number = 1;
const FLOW_RECORD_IPV4: number = 3;
const FLOW_RECORD_IPV6: number = 4;

// An interface value of all ones (in its 30 bits) means "not known".
const INTERFACE_UNKNOWN: number = 0x3fffffff;

// Bounds that no real datagram comes near: a garbage count cannot loop long.
const MAX_SAMPLES_PER_DATAGRAM: number = 1024;
const MAX_RECORDS_PER_SAMPLE: number = 64;

export interface SFlowHeader {
  version: number;
  // The address the device gives for itself.
  agentAddress: string;
  subAgentId: number;
  sequenceNumber: number;
  // Milliseconds since the device booted.
  uptimeMs: number;
  sampleCount: number;
}

export interface ParsedSFlowDatagram {
  header: SFlowHeader;
  records: Array<DecodedFlowRecord>;
  flowSamples: number;
  counterSamples: number;
  // Flow samples with no IP packet in them (ARP, other protocols).
  samplesWithoutIp: number;
  // Samples of a kind this parser does not read (vendor formats).
  unknownSamples: number;
  isMalformed: boolean;
}

interface FlowSampleFields {
  samplingRate: number;
  inputInterfaceIndex: number;
  outputInterfaceIndex: number;
}

export default class SFlowParser {
  /*
   * Parses one sFlow datagram, received at `receivedAtMs` (sFlow carries no
   * wall clock: a sample is a packet seen just now). Null when the buffer
   * cannot be an sFlow v5 datagram.
   */
  public static parse(
    datagram: Buffer,
    receivedAtMs: number = Date.now(),
  ): ParsedSFlowDatagram | null {
    if (!datagram || datagram.length < 28) {
      return null;
    }

    if (datagram.readUInt32BE(0) !== SFLOW_VERSION) {
      return null;
    }

    const addressType: number = datagram.readUInt32BE(4);
    let offset: number = 8;
    let agentAddress: string;

    if (addressType === AGENT_ADDRESS_IPV4) {
      agentAddress = FlowBytes.readIpV4(datagram, offset);
      offset += 4;
    } else if (addressType === AGENT_ADDRESS_IPV6) {
      if (datagram.length < offset + 16 + 16) {
        return null;
      }

      agentAddress = FlowBytes.readIpV6(datagram, offset);
      offset += 16;
    } else {
      return null;
    }

    if (offset + 16 > datagram.length) {
      return null;
    }

    const header: SFlowHeader = {
      version: SFLOW_VERSION,
      agentAddress: agentAddress,
      subAgentId: datagram.readUInt32BE(offset),
      sequenceNumber: datagram.readUInt32BE(offset + 4),
      uptimeMs: datagram.readUInt32BE(offset + 8),
      sampleCount: datagram.readUInt32BE(offset + 12),
    };

    offset += 16;

    const parsed: ParsedSFlowDatagram = {
      header: header,
      records: [],
      flowSamples: 0,
      counterSamples: 0,
      samplesWithoutIp: 0,
      unknownSamples: 0,
      isMalformed: false,
    };

    const sampleCount: number = Math.min(
      header.sampleCount,
      MAX_SAMPLES_PER_DATAGRAM,
    );

    for (let i: number = 0; i < sampleCount; i++) {
      if (offset + 8 > datagram.length) {
        parsed.isMalformed = true;
        break;
      }

      const sampleType: number = datagram.readUInt32BE(offset);
      const sampleLength: number = datagram.readUInt32BE(offset + 4);
      const sampleStart: number = offset + 8;
      const sampleEnd: number = sampleStart + sampleLength;

      if (sampleEnd > datagram.length) {
        parsed.isMalformed = true;
        break;
      }

      const enterprise: number = sampleType >>> 12;
      const format: number = sampleType & 0xfff;

      if (
        enterprise === STANDARD_ENTERPRISE &&
        (format === SAMPLE_FLOW || format === SAMPLE_FLOW_EXPANDED)
      ) {
        parsed.flowSamples++;

        const record: DecodedFlowRecord | null | "malformed" =
          SFlowParser.parseFlowSample(
            datagram,
            sampleStart,
            sampleEnd,
            format === SAMPLE_FLOW_EXPANDED,
            receivedAtMs,
          );

        if (record === "malformed") {
          parsed.isMalformed = true;
        } else if (record) {
          parsed.records.push(record);
        } else {
          parsed.samplesWithoutIp++;
        }
      } else if (
        enterprise === STANDARD_ENTERPRISE &&
        (format === SAMPLE_COUNTERS || format === SAMPLE_COUNTERS_EXPANDED)
      ) {
        parsed.counterSamples++;
      } else {
        parsed.unknownSamples++;
      }

      offset = sampleEnd;
    }

    return parsed;
  }

  /*
   * One flow sample: its sampling rate and interfaces, then its flow
   * records, of which the first that names an IP packet becomes the flow -
   * the sampled header when there is one, else the IPv4 / IPv6 summary.
   */
  private static parseFlowSample(
    datagram: Buffer,
    start: number,
    end: number,
    isExpanded: boolean,
    receivedAtMs: number,
  ): DecodedFlowRecord | null | "malformed" {
    const fixedLength: number = isExpanded ? 44 : 32;

    if (start + fixedLength > end) {
      return "malformed";
    }

    let fields: FlowSampleFields;
    let recordCount: number;
    let offset: number;

    if (isExpanded) {
      /*
       * sequence, source id type, source id index, rate, pool, drops,
       * input format, input value, output format, output value, records.
       */
      fields = {
        samplingRate: datagram.readUInt32BE(start + 12),
        inputInterfaceIndex: SFlowParser.readExpandedInterface(
          datagram.readUInt32BE(start + 24),
          datagram.readUInt32BE(start + 28),
        ),
        outputInterfaceIndex: SFlowParser.readExpandedInterface(
          datagram.readUInt32BE(start + 32),
          datagram.readUInt32BE(start + 36),
        ),
      };
      recordCount = datagram.readUInt32BE(start + 40);
      offset = start + 44;
    } else {
      // sequence, source id, rate, pool, drops, input, output, records.
      fields = {
        samplingRate: datagram.readUInt32BE(start + 8),
        inputInterfaceIndex: SFlowParser.readCompactInterface(
          datagram.readUInt32BE(start + 20),
        ),
        outputInterfaceIndex: SFlowParser.readCompactInterface(
          datagram.readUInt32BE(start + 24),
        ),
      };
      recordCount = datagram.readUInt32BE(start + 28);
      offset = start + 32;
    }

    let summary: DecodedPacketHeader | null = null;
    let frameLength: number | null = null;

    for (
      let i: number = 0;
      i < Math.min(recordCount, MAX_RECORDS_PER_SAMPLE);
      i++
    ) {
      if (offset + 8 > end) {
        return "malformed";
      }

      const recordFormat: number = datagram.readUInt32BE(offset);
      const recordLength: number = datagram.readUInt32BE(offset + 4);
      const recordStart: number = offset + 8;
      const recordEnd: number = recordStart + recordLength;

      if (recordEnd > end) {
        return "malformed";
      }

      const enterprise: number = recordFormat >>> 12;
      const format: number = recordFormat & 0xfff;

      if (enterprise === STANDARD_ENTERPRISE && summary === null) {
        if (format === FLOW_RECORD_RAW_HEADER && recordLength >= 16) {
          const headerProtocol: number = datagram.readUInt32BE(recordStart);
          const length: number = datagram.readUInt32BE(recordStart + 4);
          const headerLength: number = datagram.readUInt32BE(recordStart + 12);

          if (recordStart + 16 + headerLength <= recordEnd) {
            const decoded: DecodedPacketHeader | null =
              PacketHeaderDecoder.decode(
                headerProtocol,
                datagram.subarray(
                  recordStart + 16,
                  recordStart + 16 + headerLength,
                ),
              );

            if (decoded) {
              summary = decoded;
              frameLength = length;
            }
          }
        } else if (format === FLOW_RECORD_IPV4 && recordLength >= 32) {
          summary = {
            sourceIpAddress: FlowBytes.readIpV4(datagram, recordStart + 8),
            destinationIpAddress: FlowBytes.readIpV4(
              datagram,
              recordStart + 12,
            ),
            protocolNumber: datagram.readUInt32BE(recordStart + 4),
            sourcePort: datagram.readUInt32BE(recordStart + 16) & 0xffff,
            destinationPort: datagram.readUInt32BE(recordStart + 20) & 0xffff,
            tcpFlags: datagram.readUInt32BE(recordStart + 24) & 0xff,
            tos: datagram.readUInt32BE(recordStart + 28) & 0xff,
            ipLength: datagram.readUInt32BE(recordStart),
          };
          frameLength = summary.ipLength;
        } else if (format === FLOW_RECORD_IPV6 && recordLength >= 56) {
          summary = {
            sourceIpAddress: FlowBytes.readIpV6(datagram, recordStart + 8),
            destinationIpAddress: FlowBytes.readIpV6(
              datagram,
              recordStart + 24,
            ),
            protocolNumber: datagram.readUInt32BE(recordStart + 4),
            sourcePort: datagram.readUInt32BE(recordStart + 40) & 0xffff,
            destinationPort: datagram.readUInt32BE(recordStart + 44) & 0xffff,
            tcpFlags: datagram.readUInt32BE(recordStart + 48) & 0xff,
            tos: datagram.readUInt32BE(recordStart + 52) & 0xff,
            ipLength: datagram.readUInt32BE(recordStart),
          };
          frameLength = summary.ipLength;
        }
      }

      offset = recordEnd;
    }

    if (!summary) {
      return null;
    }

    const receivedAt: Date = new Date(receivedAtMs);

    return {
      sourceIpAddress: summary.sourceIpAddress,
      destinationIpAddress: summary.destinationIpAddress,
      inputInterfaceIndex: fields.inputInterfaceIndex,
      outputInterfaceIndex: fields.outputInterfaceIndex,
      // One sampled packet; the normalizer multiplies by the rate.
      packets: 1,
      octets: frameLength ?? summary.ipLength,
      flowStartAt: receivedAt,
      flowEndAt: new Date(receivedAtMs),
      sourcePort: summary.sourcePort,
      destinationPort: summary.destinationPort,
      tcpFlags: summary.tcpFlags,
      protocolNumber: summary.protocolNumber,
      tos: summary.tos,
      samplingRate: fields.samplingRate > 0 ? fields.samplingRate : 1,
    };
  }

  /*
   * A compact flow sample packs an interface as 2 bits of format and 30 of
   * value: format 0 is an ifIndex; 1 means the packet was discarded and 2
   * that it went out of several interfaces - neither is one interface.
   */
  private static readCompactInterface(value: number): number {
    const format: number = value >>> 30;
    const index: number = value & 0x3fffffff;

    if (format !== 0 || index === INTERFACE_UNKNOWN) {
      return 0;
    }

    return index;
  }

  private static readExpandedInterface(format: number, value: number): number {
    if (format !== 0 || value === INTERFACE_UNKNOWN) {
      return 0;
    }

    return value;
  }
}
