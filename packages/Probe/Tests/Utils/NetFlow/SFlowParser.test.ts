import SFlowParser, {
  ParsedSFlowDatagram,
} from "../../../Utils/NetFlow/SFlowParser";
import DecodedFlowRecord from "../../../Utils/NetFlow/DecodedFlowRecord";
import { ipv4Bytes, ipv6Bytes } from "./FlowFixtureBuilders";
import { describe, expect, test } from "@jest/globals";

/*
 * sFlow v5 as switches send it: datagrams of flow samples (the first bytes of
 * one packet in N), counter samples, and vendor samples, each a typed,
 * length-prefixed XDR structure. These are built the way Arista EOS, Juniper
 * and host sFlow agents lay them out; the real-exporter fixtures
 * (RealExporterFixtures.test.ts) cover pmacct's.
 */

const RECEIVED_AT_MS: number = Date.UTC(2026, 0, 1, 12, 0, 0);

function word(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function padded(bytes: Buffer): Buffer {
  const padding: number = (4 - (bytes.length % 4)) % 4;
  return Buffer.concat([bytes, Buffer.alloc(padding)]);
}

function structure(format: number, body: Buffer): Buffer {
  return Buffer.concat([word(format), word(body.length), body]);
}

function rawHeaderRecord(
  frame: Buffer,
  options?: { frameLength?: number; headerProtocol?: number },
): Buffer {
  return structure(
    1,
    Buffer.concat([
      word(options?.headerProtocol ?? 1), // ETHERNET-ISO88023
      word(options?.frameLength ?? frame.length + 4), // with FCS
      word(4), // stripped
      word(frame.length),
      padded(frame),
    ]),
  );
}

function ipv4SummaryRecord(data: {
  length: number;
  protocol: number;
  source: string;
  destination: string;
  sourcePort: number;
  destinationPort: number;
  tcpFlags: number;
  tos: number;
}): Buffer {
  return structure(
    3,
    Buffer.concat([
      word(data.length),
      word(data.protocol),
      ipv4Bytes(data.source),
      ipv4Bytes(data.destination),
      word(data.sourcePort),
      word(data.destinationPort),
      word(data.tcpFlags),
      word(data.tos),
    ]),
  );
}

function ipv6SummaryRecord(data: {
  length: number;
  protocol: number;
  source: string;
  destination: string;
  sourcePort: number;
  destinationPort: number;
}): Buffer {
  return structure(
    4,
    Buffer.concat([
      word(data.length),
      word(data.protocol),
      ipv6Bytes(data.source),
      ipv6Bytes(data.destination),
      word(data.sourcePort),
      word(data.destinationPort),
      word(0),
      word(0),
    ]),
  );
}

// An extended switch record (VLANs): read past, never a flow on its own.
function extendedSwitchRecord(): Buffer {
  return structure(1001, Buffer.concat([word(10), word(0), word(20), word(0)]));
}

function flowSample(
  records: Array<Buffer>,
  options?: { rate?: number; input?: number; output?: number },
): Buffer {
  return structure(
    1,
    Buffer.concat([
      word(1), // sequence
      word(0x00000003), // source id: ifIndex 3
      word(options?.rate ?? 1024),
      word(4096), // sample pool
      word(0), // drops
      word(options?.input ?? 3),
      word(options?.output ?? 7),
      word(records.length),
      ...records,
    ]),
  );
}

function expandedFlowSample(
  records: Array<Buffer>,
  options: {
    rate: number;
    inputFormat: number;
    inputValue: number;
    outputFormat: number;
    outputValue: number;
  },
): Buffer {
  return structure(
    3,
    Buffer.concat([
      word(1),
      word(0),
      word(3),
      word(options.rate),
      word(4096),
      word(0),
      word(options.inputFormat),
      word(options.inputValue),
      word(options.outputFormat),
      word(options.outputValue),
      word(records.length),
      ...records,
    ]),
  );
}

function counterSample(): Buffer {
  // A generic interface counter record (0,1) inside a counter sample (0,2).
  const counters: Buffer = structure(1, Buffer.alloc(88));
  return structure(2, Buffer.concat([word(1), word(3), word(1), counters]));
}

function datagram(
  samples: Array<Buffer>,
  options?: { agent?: string; sampleCount?: number },
): Buffer {
  const agent: string = options?.agent ?? "192.0.2.10";
  const isIpv6: boolean = agent.includes(":");

  return Buffer.concat([
    word(5),
    word(isIpv6 ? 2 : 1),
    isIpv6 ? ipv6Bytes(agent) : ipv4Bytes(agent),
    word(1), // sub agent
    word(42), // sequence
    word(123456), // uptime
    word(options?.sampleCount ?? samples.length),
    ...samples,
  ]);
}

// ---- Frames ------------------------------------------------------------------

function ethernet(
  etherType: number,
  payload: Buffer,
  vlans: Array<number> = [],
): Buffer {
  const header: Buffer = Buffer.alloc(12);
  header.fill(0x02);
  const tags: Array<Buffer> = vlans.map((vlan: number, index: number) => {
    const tag: Buffer = Buffer.alloc(4);
    tag.writeUInt16BE(index === 0 && vlans.length > 1 ? 0x88a8 : 0x8100, 0);
    tag.writeUInt16BE(vlan, 2);
    return tag;
  });
  const type: Buffer = Buffer.alloc(2);
  type.writeUInt16BE(etherType, 0);

  // Each tag's TPID sits where the next header's type would be.
  if (tags.length > 0) {
    return Buffer.concat([header, ...tags, type, payload]);
  }

  return Buffer.concat([header, type, payload]);
}

function ipv4Packet(data: {
  source: string;
  destination: string;
  protocol: number;
  payload: Buffer;
  tos?: number;
  fragmentOffset?: number;
}): Buffer {
  const header: Buffer = Buffer.alloc(20);
  header[0] = 0x45;
  header[1] = data.tos ?? 0;
  header.writeUInt16BE(20 + data.payload.length, 2);
  header.writeUInt16BE(data.fragmentOffset ?? 0, 6);
  header[8] = 64;
  header[9] = data.protocol;
  ipv4Bytes(data.source).copy(header, 12);
  ipv4Bytes(data.destination).copy(header, 16);
  return Buffer.concat([header, data.payload]);
}

function tcpSegment(
  sourcePort: number,
  destinationPort: number,
  flags: number,
): Buffer {
  const segment: Buffer = Buffer.alloc(20);
  segment.writeUInt16BE(sourcePort, 0);
  segment.writeUInt16BE(destinationPort, 2);
  segment[12] = 0x50;
  segment[13] = flags;
  return segment;
}

function udpDatagram(sourcePort: number, destinationPort: number): Buffer {
  const header: Buffer = Buffer.alloc(8);
  header.writeUInt16BE(sourcePort, 0);
  header.writeUInt16BE(destinationPort, 2);
  header.writeUInt16BE(8, 4);
  return header;
}

function ipv6Packet(data: {
  source: string;
  destination: string;
  nextHeader: number;
  payload: Buffer;
}): Buffer {
  const header: Buffer = Buffer.alloc(40);
  header.writeUInt32BE(0x6a000000, 0); // traffic class 0xa0
  header.writeUInt16BE(data.payload.length, 4);
  header[6] = data.nextHeader;
  header[7] = 64;
  ipv6Bytes(data.source).copy(header, 8);
  ipv6Bytes(data.destination).copy(header, 24);
  return Buffer.concat([header, data.payload]);
}

function parse(buffer: Buffer): ParsedSFlowDatagram {
  const parsed: ParsedSFlowDatagram | null = SFlowParser.parse(
    buffer,
    RECEIVED_AT_MS,
  );
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("SFlowParser", () => {
  test("a sampled Ethernet/IPv4/TCP header becomes one flow: N packets of the frame's length", () => {
    const frame: Buffer = ethernet(
      0x0800,
      ipv4Packet({
        source: "10.1.1.1",
        destination: "10.2.2.2",
        protocol: 6,
        tos: 0x28,
        payload: tcpSegment(51000, 443, 0x18),
      }),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([
        flowSample([rawHeaderRecord(frame, { frameLength: 1518 })], {
          rate: 2048,
          input: 3,
          output: 7,
        }),
      ]),
    );

    expect(parsed.header.agentAddress).toBe("192.0.2.10");
    expect(parsed.header.subAgentId).toBe(1);
    expect(parsed.header.sequenceNumber).toBe(42);
    expect(parsed.header.uptimeMs).toBe(123456);
    expect(parsed.flowSamples).toBe(1);
    expect(parsed.records).toHaveLength(1);

    const record: DecodedFlowRecord = parsed.records[0]!;
    expect(record.sourceIpAddress).toBe("10.1.1.1");
    expect(record.destinationIpAddress).toBe("10.2.2.2");
    expect(record.protocolNumber).toBe(6);
    expect(record.sourcePort).toBe(51000);
    expect(record.destinationPort).toBe(443);
    expect(record.tcpFlags).toBe(0x18);
    expect(record.tos).toBe(0x28);
    // One sampled packet, of the frame's full length; the rate scales later.
    expect(record.packets).toBe(1);
    expect(record.octets).toBe(1518);
    expect(record.samplingRate).toBe(2048);
    expect(record.inputInterfaceIndex).toBe(3);
    expect(record.outputInterfaceIndex).toBe(7);
    expect(record.flowStartAt.getTime()).toBe(RECEIVED_AT_MS);
    expect(record.flowEndAt.getTime()).toBe(RECEIVED_AT_MS);
  });

  test("802.1Q and QinQ tags are stepped over", () => {
    for (const vlans of [[20], [100, 20]]) {
      const frame: Buffer = ethernet(
        0x0800,
        ipv4Packet({
          source: "10.0.10.7",
          destination: "10.0.20.8",
          protocol: 17,
          payload: udpDatagram(5000, 5001),
        }),
        vlans,
      );

      const parsed: ParsedSFlowDatagram = parse(
        datagram([flowSample([rawHeaderRecord(frame)])]),
      );

      expect(parsed.records[0]!.sourceIpAddress).toBe("10.0.10.7");
      expect(parsed.records[0]!.destinationPort).toBe(5001);
    }
  });

  test("an MPLS label stack is stepped over to the IP packet under it", () => {
    const labels: Buffer = Buffer.alloc(8);
    labels.writeUInt32BE((1000 << 12) | (0 << 8) | 64, 0); // not bottom
    labels.writeUInt32BE((2000 << 12) | (1 << 8) | 64, 4); // bottom of stack

    const frame: Buffer = ethernet(
      0x8847,
      Buffer.concat([
        labels,
        ipv4Packet({
          source: "172.16.0.1",
          destination: "172.16.0.2",
          protocol: 6,
          payload: tcpSegment(179, 40000, 0x10),
        }),
      ]),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([flowSample([rawHeaderRecord(frame)])]),
    );

    expect(parsed.records[0]!.sourceIpAddress).toBe("172.16.0.1");
    expect(parsed.records[0]!.sourcePort).toBe(179);
  });

  test("IPv6 extension headers are walked to the transport header", () => {
    // Hop-by-hop options (8 bytes), then a FIRST fragment header, then TCP.
    const hopByHop: Buffer = Buffer.alloc(8);
    hopByHop[0] = 44; // next: fragment
    hopByHop[1] = 0; // (0 + 1) * 8 bytes
    const fragment: Buffer = Buffer.alloc(8);
    fragment[0] = 6; // next: TCP
    fragment.writeUInt16BE(0x0001, 2); // offset 0, more fragments

    const frame: Buffer = ethernet(
      0x86dd,
      ipv6Packet({
        source: "2001:db8:10::5",
        destination: "2001:db8:20::443",
        nextHeader: 0,
        payload: Buffer.concat([
          hopByHop,
          fragment,
          tcpSegment(41000, 443, 0x02),
        ]),
      }),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([flowSample([rawHeaderRecord(frame)])]),
    );

    const record: DecodedFlowRecord = parsed.records[0]!;
    expect(record.sourceIpAddress).toBe("2001:db8:10::5");
    expect(record.destinationIpAddress).toBe("2001:db8:20::443");
    expect(record.protocolNumber).toBe(6);
    expect(record.sourcePort).toBe(41000);
    expect(record.destinationPort).toBe(443);
    expect(record.tcpFlags).toBe(0x02);
    expect(record.tos).toBe(0xa0);
  });

  test("a later IPv6 fragment carries no ports; its protocol still counts", () => {
    const fragment: Buffer = Buffer.alloc(8);
    fragment[0] = 17;
    fragment.writeUInt16BE(185 << 3, 2); // offset 1480 bytes

    const frame: Buffer = ethernet(
      0x86dd,
      ipv6Packet({
        source: "2001:db8::1",
        destination: "2001:db8::2",
        nextHeader: 44,
        payload: Buffer.concat([fragment, Buffer.alloc(16)]),
      }),
    );

    const record: DecodedFlowRecord = parse(
      datagram([flowSample([rawHeaderRecord(frame)])]),
    ).records[0]!;

    expect(record.protocolNumber).toBe(17);
    expect(record.sourcePort).toBe(0);
    expect(record.destinationPort).toBe(0);
  });

  test("the IPv4 and IPv6 summary records work where no header was sampled", () => {
    const parsed: ParsedSFlowDatagram = parse(
      datagram([
        flowSample(
          [
            extendedSwitchRecord(),
            ipv4SummaryRecord({
              length: 1400,
              protocol: 6,
              source: "10.0.0.1",
              destination: "10.0.0.2",
              sourcePort: 443,
              destinationPort: 50000,
              tcpFlags: 0x10,
              tos: 0,
            }),
          ],
          { rate: 512 },
        ),
        flowSample(
          [
            ipv6SummaryRecord({
              length: 1200,
              protocol: 17,
              source: "2001:db8::a",
              destination: "2001:db8::b",
              sourcePort: 53,
              destinationPort: 33000,
            }),
          ],
          { rate: 512 },
        ),
      ]),
    );

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]!.octets).toBe(1400);
    expect(parsed.records[0]!.sourcePort).toBe(443);
    expect(parsed.records[0]!.tcpFlags).toBe(0x10);
    expect(parsed.records[1]!.sourceIpAddress).toBe("2001:db8::a");
    expect(parsed.records[1]!.octets).toBe(1200);
    expect(parsed.records[1]!.samplingRate).toBe(512);
  });

  test("an expanded flow sample reads its interfaces from format and value words", () => {
    const frame: Buffer = ethernet(
      0x0800,
      ipv4Packet({
        source: "10.0.0.1",
        destination: "10.0.0.2",
        protocol: 17,
        payload: udpDatagram(123, 123),
      }),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([
        expandedFlowSample([rawHeaderRecord(frame)], {
          rate: 4096,
          inputFormat: 0,
          inputValue: 0x12345,
          outputFormat: 0,
          outputValue: 0x23456,
        }),
      ]),
    );

    expect(parsed.records[0]!.samplingRate).toBe(4096);
    expect(parsed.records[0]!.inputInterfaceIndex).toBe(0x12345);
    expect(parsed.records[0]!.outputInterfaceIndex).toBe(0x23456);
  });

  test("an interface that is unknown, a discard or several interfaces is not one ifIndex", () => {
    const frame: Buffer = ethernet(
      0x0800,
      ipv4Packet({
        source: "10.0.0.1",
        destination: "10.0.0.2",
        protocol: 1,
        payload: Buffer.alloc(8),
      }),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([
        // Unknown input, discarded output (format 1, reason 0x102).
        flowSample([rawHeaderRecord(frame)], {
          input: 0x3fffffff,
          output: (1 << 30) | 0x102,
        }),
        // Sent out of 3 interfaces (format 2).
        flowSample([rawHeaderRecord(frame)], {
          input: 5,
          output: (2 << 30) | 3,
        }),
      ]),
    );

    expect(parsed.records[0]!.inputInterfaceIndex).toBe(0);
    expect(parsed.records[0]!.outputInterfaceIndex).toBe(0);
    expect(parsed.records[1]!.inputInterfaceIndex).toBe(5);
    expect(parsed.records[1]!.outputInterfaceIndex).toBe(0);
  });

  test("counter samples and vendor samples are counted and passed over", () => {
    const frame: Buffer = ethernet(
      0x0800,
      ipv4Packet({
        source: "10.0.0.1",
        destination: "10.0.0.2",
        protocol: 6,
        payload: tcpSegment(1, 2, 0),
      }),
    );

    const parsed: ParsedSFlowDatagram = parse(
      datagram([
        counterSample(),
        structure((4413 << 12) | 5, Buffer.alloc(12)), // a vendor's sample
        flowSample([rawHeaderRecord(frame)]),
      ]),
    );

    expect(parsed.counterSamples).toBe(1);
    expect(parsed.unknownSamples).toBe(1);
    expect(parsed.flowSamples).toBe(1);
    expect(parsed.records).toHaveLength(1);
  });

  test("a sampled packet that is not IP (ARP) is counted, not turned into a flow", () => {
    const arp: Buffer = ethernet(0x0806, Buffer.alloc(28));

    const parsed: ParsedSFlowDatagram = parse(
      datagram([flowSample([rawHeaderRecord(arp)])]),
    );

    expect(parsed.flowSamples).toBe(1);
    expect(parsed.samplesWithoutIp).toBe(1);
    expect(parsed.records).toHaveLength(0);
  });

  test("an agent with an IPv6 address is named by it", () => {
    const parsed: ParsedSFlowDatagram = parse(
      datagram([], { agent: "2001:db8:ffff::1" }),
    );

    expect(parsed.header.agentAddress).toBe("2001:db8:ffff::1");
  });

  test("returns null for what cannot be an sFlow v5 datagram", () => {
    expect(SFlowParser.parse(Buffer.alloc(0))).toBeNull();
    expect(SFlowParser.parse(Buffer.alloc(27))).toBeNull();

    const version4: Buffer = datagram([]);
    version4.writeUInt32BE(4, 0);
    expect(SFlowParser.parse(version4)).toBeNull();

    const badAddressType: Buffer = datagram([]);
    badAddressType.writeUInt32BE(7, 4);
    expect(SFlowParser.parse(badAddressType)).toBeNull();
  });

  test("a sample that runs past the datagram ends the walk; the samples before it stay", () => {
    const frame: Buffer = ethernet(
      0x0800,
      ipv4Packet({
        source: "10.0.0.1",
        destination: "10.0.0.2",
        protocol: 6,
        payload: tcpSegment(1, 2, 0),
      }),
    );
    const whole: Buffer = datagram([
      flowSample([rawHeaderRecord(frame)]),
      flowSample([rawHeaderRecord(frame)]),
    ]);

    const parsed: ParsedSFlowDatagram = parse(
      whole.subarray(0, whole.length - 12),
    );

    expect(parsed.isMalformed).toBe(true);
    expect(parsed.records).toHaveLength(1);
  });

  test("a sample count no datagram could hold does not make the walk loop", () => {
    const parsed: ParsedSFlowDatagram = parse(
      datagram([], { sampleCount: 0xffffffff }),
    );

    expect(parsed.records).toHaveLength(0);
    expect(parsed.isMalformed).toBe(true);
  });

  test("a flow record whose header length runs past the record is not read", () => {
    const record: Buffer = structure(
      1,
      Buffer.concat([word(1), word(64), word(4), word(4000), Buffer.alloc(8)]),
    );

    const parsed: ParsedSFlowDatagram = parse(datagram([flowSample([record])]));

    expect(parsed.records).toHaveLength(0);
    expect(parsed.samplesWithoutIp).toBe(1);
  });
});
