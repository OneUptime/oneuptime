import PacketHeaderDecoder, {
  DecodedPacketHeader,
  HEADER_PROTOCOL_ETHERNET,
  HEADER_PROTOCOL_IPV4,
  HEADER_PROTOCOL_IPV6,
} from "../../../Utils/NetFlow/PacketHeaderDecoder";
import { ipv4Bytes, ipv6Bytes } from "./FlowFixtureBuilders";
import { describe, expect, test } from "@jest/globals";

/*
 * The first bytes of a sampled packet, read down to the transport ports - and
 * everything that can stop that walk early without throwing: a cut-short
 * header, a fragment, a frame that is not IP at all.
 */

function ipv4Header(options?: {
  protocol?: number;
  optionsBytes?: number;
  fragmentOffset?: number;
  version?: number;
}): Buffer {
  const optionsBytes: number = options?.optionsBytes ?? 0;
  const header: Buffer = Buffer.alloc(20 + optionsBytes);
  header[0] = ((options?.version ?? 4) << 4) | ((20 + optionsBytes) / 4);
  header.writeUInt16BE(20 + optionsBytes + 8, 2);
  header.writeUInt16BE(options?.fragmentOffset ?? 0, 6);
  header[9] = options?.protocol ?? 17;
  ipv4Bytes("192.0.2.1").copy(header, 12);
  ipv4Bytes("192.0.2.2").copy(header, 16);
  return header;
}

function ports(sourcePort: number, destinationPort: number): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeUInt16BE(sourcePort, 0);
  buffer.writeUInt16BE(destinationPort, 2);
  return buffer;
}

describe("PacketHeaderDecoder", () => {
  test("a sampled raw IPv4 header (no Ethernet) is read directly", () => {
    const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
      HEADER_PROTOCOL_IPV4,
      Buffer.concat([ipv4Header(), ports(53, 33333)]),
    );

    expect(decoded).toMatchObject({
      sourceIpAddress: "192.0.2.1",
      destinationIpAddress: "192.0.2.2",
      protocolNumber: 17,
      sourcePort: 53,
      destinationPort: 33333,
      ipLength: 28,
    });
  });

  test("a sampled raw IPv6 header is read directly", () => {
    const header: Buffer = Buffer.alloc(40);
    header.writeUInt32BE(0x60000000, 0);
    header.writeUInt16BE(8, 4);
    header[6] = 17;
    ipv6Bytes("2001:db8::1").copy(header, 8);
    ipv6Bytes("2001:db8::2").copy(header, 24);

    const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
      HEADER_PROTOCOL_IPV6,
      Buffer.concat([header, ports(5353, 5353)]),
    );

    expect(decoded).toMatchObject({
      sourceIpAddress: "2001:db8::1",
      destinationIpAddress: "2001:db8::2",
      protocolNumber: 17,
      sourcePort: 5353,
      destinationPort: 5353,
      ipLength: 48,
    });
  });

  test("IPv4 options (a header longer than 20 bytes) do not hide the ports", () => {
    const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
      HEADER_PROTOCOL_IPV4,
      Buffer.concat([ipv4Header({ optionsBytes: 8 }), ports(1234, 80)]),
    );

    expect(decoded!.sourcePort).toBe(1234);
    expect(decoded!.destinationPort).toBe(80);
  });

  test("an IPv4 fragment past the first carries no ports", () => {
    const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
      HEADER_PROTOCOL_IPV4,
      Buffer.concat([ipv4Header({ fragmentOffset: 185 }), ports(1234, 80)]),
    );

    expect(decoded!.protocolNumber).toBe(17);
    expect(decoded!.sourcePort).toBe(0);
    expect(decoded!.destinationPort).toBe(0);
  });

  test("a header cut short before the ports keeps the addresses", () => {
    const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
      HEADER_PROTOCOL_IPV4,
      Buffer.concat([ipv4Header({ protocol: 6 }), Buffer.from([1, 2])]),
    );

    expect(decoded!.sourceIpAddress).toBe("192.0.2.1");
    expect(decoded!.sourcePort).toBe(0);
  });

  test("protocols without ports (ICMP, GRE) leave them at 0", () => {
    for (const protocol of [1, 47, 50]) {
      const decoded: DecodedPacketHeader | null = PacketHeaderDecoder.decode(
        HEADER_PROTOCOL_IPV4,
        Buffer.concat([ipv4Header({ protocol: protocol }), ports(8, 0)]),
      );

      expect(decoded!.protocolNumber).toBe(protocol);
      expect(decoded!.sourcePort).toBe(0);
      expect(decoded!.destinationPort).toBe(0);
    }
  });

  test("what is not IP, or too short to be anything, is null", () => {
    // Too short for an Ethernet header.
    expect(
      PacketHeaderDecoder.decode(HEADER_PROTOCOL_ETHERNET, Buffer.alloc(10)),
    ).toBeNull();

    // An Ethernet frame carrying ARP.
    const arp: Buffer = Buffer.alloc(14 + 28);
    arp.writeUInt16BE(0x0806, 12);
    expect(PacketHeaderDecoder.decode(HEADER_PROTOCOL_ETHERNET, arp)).toBeNull();

    // An IPv4 header that says it is version 6.
    expect(
      PacketHeaderDecoder.decode(
        HEADER_PROTOCOL_IPV4,
        ipv4Header({ version: 6 }),
      ),
    ).toBeNull();

    // A cut-short IPv4 header.
    expect(
      PacketHeaderDecoder.decode(HEADER_PROTOCOL_IPV4, Buffer.alloc(12)),
    ).toBeNull();

    // A header protocol sFlow defines but nobody samples (FDDI = 4).
    expect(PacketHeaderDecoder.decode(4, Buffer.alloc(64))).toBeNull();
  });

  test("a VLAN tag cut off mid-way is null, not a misread", () => {
    const frame: Buffer = Buffer.alloc(16);
    frame.writeUInt16BE(0x8100, 12);

    expect(PacketHeaderDecoder.decode(HEADER_PROTOCOL_ETHERNET, frame)).toBeNull();
  });
});
