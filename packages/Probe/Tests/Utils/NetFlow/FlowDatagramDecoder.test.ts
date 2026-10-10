import FlowDatagramDecoder, {
  FlowDatagramOutcome,
  FlowDatagramResult,
} from "../../../Utils/NetFlow/FlowDatagramDecoder";
import DecodedFlowRecord from "../../../Utils/NetFlow/DecodedFlowRecord";
import { MAX_SAMPLING_RATE } from "../../../Utils/NetFlow/TemplateFlowDecoder";
import {
  IE,
  IPFIX_EXPORT_TIME,
  IPV4_TEMPLATE,
  OptionsTemplateSpec,
  dataSet,
  encodeRecord,
  ipfixMessage,
  ipfixOptionsTemplateSet,
  ipfixTemplateSet,
  ipv4Record,
} from "./FlowFixtureBuilders";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import { describe, expect, test } from "@jest/globals";

/*
 * Whatever arrives on whatever port: the first bytes say which format it is,
 * the right decoder reads it, and what comes out is one shape - estimated
 * counts, the device's own address, folded client ports - or a clear "not
 * supported" / "not readable".
 */

const SOURCE: { address: string; port: number } = {
  address: "192.0.2.1",
  port: 50000,
};

const EXPORT_MS: number = IPFIX_EXPORT_TIME * 1000;

function v5Datagram(options?: { version?: number; sampling?: number }): Buffer {
  const buffer: Buffer = Buffer.alloc(24 + 48);
  buffer.writeUInt16BE(options?.version ?? 5, 0);
  buffer.writeUInt16BE(1, 2);
  buffer.writeUInt32BE(3600000, 4);
  buffer.writeUInt32BE(IPFIX_EXPORT_TIME, 8);
  buffer.writeUInt16BE(options?.sampling ?? 0, 22);
  // 10.0.0.5:51000 -> 198.51.100.20:443, TCP, 10 packets, 5000 bytes.
  Buffer.from([10, 0, 0, 5]).copy(buffer, 24);
  Buffer.from([198, 51, 100, 20]).copy(buffer, 28);
  buffer.writeUInt32BE(10, 24 + 16);
  buffer.writeUInt32BE(5000, 24 + 20);
  buffer.writeUInt32BE(3590000, 24 + 24);
  buffer.writeUInt32BE(3599000, 24 + 28);
  buffer.writeUInt16BE(51000, 24 + 32);
  buffer.writeUInt16BE(443, 24 + 34);
  buffer[24 + 38] = 6;
  return buffer;
}

function sflowHeaderOnly(version: number): Buffer {
  const buffer: Buffer = Buffer.alloc(28);
  buffer.writeUInt32BE(version, 0);
  buffer.writeUInt32BE(1, 4);
  return buffer;
}

function decoded(record: Partial<DecodedFlowRecord> = {}): DecodedFlowRecord {
  return {
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 2,
    packets: 3,
    octets: 300,
    flowStartAt: new Date(EXPORT_MS - 1000),
    flowEndAt: new Date(EXPORT_MS),
    sourcePort: 51000,
    destinationPort: 443,
    tcpFlags: 0x18,
    protocolNumber: 6,
    tos: 0,
    samplingRate: 1,
    ...record,
  };
}

describe("FlowDatagramDecoder: which format", () => {
  test("NetFlow v5 is read as NetFlow v5, scaled by its header's sampling interval", () => {
    const result: FlowDatagramResult = new FlowDatagramDecoder().decode(
      v5Datagram({ sampling: (1 << 14) | 100 }),
      SOURCE,
    );

    expect(result.outcome).toBe(FlowDatagramOutcome.Decoded);
    expect(result.format).toBe(NetworkFlowFormat.NetFlowV5);
    expect(result.exporterAddress).toBe("192.0.2.1");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.samplingRate).toBe(100);
    expect(result.records[0]!.packets).toBe(1000);
    expect(result.records[0]!.octets).toBe(500000);
    // The client's ephemeral port is folded; HTTPS stays.
    expect(result.records[0]!.sourcePort).toBe(0);
    expect(result.records[0]!.destinationPort).toBe(443);
  });

  test("IPFIX is read as IPFIX, and keeps its template state across datagrams", () => {
    const decoder: FlowDatagramDecoder = new FlowDatagramDecoder();

    const templates: FlowDatagramResult = decoder.decode(
      ipfixMessage([ipfixTemplateSet([IPV4_TEMPLATE])]),
      SOURCE,
    );
    expect(templates.outcome).toBe(FlowDatagramOutcome.Decoded);
    expect(templates.format).toBe(NetworkFlowFormat.Ipfix);
    expect(templates.records).toHaveLength(0);

    const data: FlowDatagramResult = decoder.decode(
      ipfixMessage([
        dataSet(256, [
          ipv4Record({
            source: "10.0.0.5",
            destination: "10.0.0.53",
            sourcePort: 53001,
            destinationPort: 53,
            protocol: 17,
            octets: 120,
            packets: 2,
            startMs: EXPORT_MS - 500,
            endMs: EXPORT_MS - 400,
          }),
        ]),
      ]),
      SOURCE,
    );

    expect(data.records).toHaveLength(1);
    expect(data.records[0]!.flowFormat).toBe(NetworkFlowFormat.Ipfix);
    expect(data.records[0]!.destinationPort).toBe(53);
    expect(data.records[0]!.sourcePort).toBe(0);
  });

  test("an IPFIX exporter that names its own address is known by it, not by the NAT in front of it", () => {
    const decoder: FlowDatagramDecoder = new FlowDatagramDecoder();
    const options: OptionsTemplateSpec = {
      templateId: 800,
      scopeFieldCount: 1,
      fields: [
        { id: IE.exporterIPv4Address, length: 4 },
        { id: IE.meteringProcessId, length: 4 },
      ],
    };

    const result: FlowDatagramResult = decoder.decode(
      ipfixMessage([
        ipfixOptionsTemplateSet([options]),
        dataSet(800, [encodeRecord(options.fields, ["10.255.0.7", 1])]),
        ipfixTemplateSet([IPV4_TEMPLATE]),
        dataSet(256, [
          ipv4Record({
            source: "10.0.0.5",
            destination: "10.0.0.6",
            sourcePort: 1,
            destinationPort: 2,
            protocol: 17,
            octets: 10,
            packets: 1,
            startMs: EXPORT_MS,
            endMs: EXPORT_MS,
          }),
        ]),
      ]),
      { address: "203.0.113.50", port: 1 },
    );

    expect(result.exporterAddress).toBe("10.255.0.7");
    expect(result.records[0]!.exporterIpAddress).toBe("10.255.0.7");
  });

  test.each([1, 6, 7, 8])(
    "NetFlow v%i is named as not supported",
    (version: number) => {
      const result: FlowDatagramResult = new FlowDatagramDecoder().decode(
        v5Datagram({ version: version }),
        SOURCE,
      );

      expect(result.outcome).toBe(FlowDatagramOutcome.Unsupported);
      expect(result.unsupportedFormat).toBe(`NetFlow v${version}`);
      expect(result.records).toHaveLength(0);
    },
  );

  test.each([2, 4])(
    "sFlow v%i is named as not supported",
    (version: number) => {
      const result: FlowDatagramResult = new FlowDatagramDecoder().decode(
        sflowHeaderOnly(version),
        SOURCE,
      );

      expect(result.outcome).toBe(FlowDatagramOutcome.Unsupported);
      expect(result.unsupportedFormat).toBe(`sFlow v${version}`);
    },
  );

  test("anything else - empty, too short, another protocol on the port - is unreadable", () => {
    const decoder: FlowDatagramDecoder = new FlowDatagramDecoder();

    for (const datagram of [
      Buffer.alloc(0),
      Buffer.from([0, 5]),
      Buffer.from("GET / HTTP/1.1\r\n\r\n"),
      Buffer.from([0, 0, 0, 99, 0, 0, 0, 1]),
      // A v5 header whose record count does not match its length.
      v5Datagram().subarray(0, 40),
    ]) {
      const result: FlowDatagramResult = decoder.decode(datagram, SOURCE);

      expect(result.outcome).toBe(FlowDatagramOutcome.Malformed);
      expect(result.records).toHaveLength(0);
    }
  });

  test("an sFlow agent that reports 0.0.0.0 is known by where it sends from", () => {
    const datagram: Buffer = Buffer.alloc(28);
    datagram.writeUInt32BE(5, 0);
    datagram.writeUInt32BE(1, 4);
    // agent 0.0.0.0, no samples.

    const result: FlowDatagramResult = new FlowDatagramDecoder().decode(
      datagram,
      { address: "10.20.30.40", port: 6343 },
    );

    expect(result.format).toBe(NetworkFlowFormat.SFlow);
    expect(result.exporterAddress).toBe("10.20.30.40");
  });
});

describe("FlowDatagramDecoder.normalize", () => {
  test("multiplies bytes and packets by the sampling rate, and keeps the rate", () => {
    const record: NetworkFlowRecord | null = FlowDatagramDecoder.normalize(
      decoded({ samplingRate: 1000, packets: 1, octets: 1500 }),
      NetworkFlowFormat.SFlow,
      "10.0.0.1",
    );

    expect(record).toMatchObject({
      exporterIpAddress: "10.0.0.1",
      flowFormat: NetworkFlowFormat.SFlow,
      samplingRate: 1000,
      packets: 1000,
      octets: 1500000,
      flowCount: 1,
    });
  });

  test("a rate past the maximum is held to it; one below 2 is every packet", () => {
    expect(
      FlowDatagramDecoder.normalize(
        decoded({ samplingRate: MAX_SAMPLING_RATE * 4 }),
        NetworkFlowFormat.Ipfix,
        "10.0.0.1",
      )!.samplingRate,
    ).toBe(MAX_SAMPLING_RATE);

    for (const rate of [0, 1, -5, Number.NaN]) {
      expect(
        FlowDatagramDecoder.normalize(
          decoded({ samplingRate: rate }),
          NetworkFlowFormat.Ipfix,
          "10.0.0.1",
        )!.samplingRate,
      ).toBe(1);
    }
  });

  test("records with no traffic, or no addresses, are left out", () => {
    expect(
      FlowDatagramDecoder.normalize(
        decoded({ octets: 0, packets: 0 }),
        NetworkFlowFormat.NetFlowV9,
        "10.0.0.1",
      ),
    ).toBeNull();

    expect(
      FlowDatagramDecoder.normalize(
        decoded({
          sourceIpAddress: "0.0.0.0",
          destinationIpAddress: "0.0.0.0",
        }),
        NetworkFlowFormat.NetFlowV9,
        "10.0.0.1",
      ),
    ).toBeNull();

    expect(
      FlowDatagramDecoder.normalize(
        decoded({ sourceIpAddress: "::", destinationIpAddress: "::" }),
        NetworkFlowFormat.Ipfix,
        "10.0.0.1",
      ),
    ).toBeNull();

    // One side known is still a flow (a broadcast's source, say).
    expect(
      FlowDatagramDecoder.normalize(
        decoded({ destinationIpAddress: "0.0.0.0" }),
        NetworkFlowFormat.Ipfix,
        "10.0.0.1",
      ),
    ).not.toBeNull();
  });

  test("an IPv4 address written as IPv4-mapped IPv6 is the IPv4 address", () => {
    const record: NetworkFlowRecord | null = FlowDatagramDecoder.normalize(
      decoded({ sourceIpAddress: "::ffff:10.0.0.5" }),
      NetworkFlowFormat.Ipfix,
      "10.0.0.1",
    );

    expect(record!.sourceIpAddress).toBe("10.0.0.5");
    expect(FlowDatagramDecoder.normalizeAddress("::FFFF:192.0.2.9")).toBe(
      "192.0.2.9",
    );
    expect(FlowDatagramDecoder.normalizeAddress("::ffff:not-an-ip")).toBe(
      "::ffff:not-an-ip",
    );
  });

  test("ports are folded for client-to-service traffic and kept otherwise", () => {
    const toService: NetworkFlowRecord | null = FlowDatagramDecoder.normalize(
      decoded({ sourcePort: 51000, destinationPort: 443 }),
      NetworkFlowFormat.NetFlowV9,
      "10.0.0.1",
    );
    expect([toService!.sourcePort, toService!.destinationPort]).toEqual([
      0, 443,
    ]);

    const peers: NetworkFlowRecord | null = FlowDatagramDecoder.normalize(
      decoded({ sourcePort: 5000, destinationPort: 5001, protocolNumber: 17 }),
      NetworkFlowFormat.NetFlowV9,
      "10.0.0.1",
    );
    expect([peers!.sourcePort, peers!.destinationPort]).toEqual([5000, 5001]);
  });
});
