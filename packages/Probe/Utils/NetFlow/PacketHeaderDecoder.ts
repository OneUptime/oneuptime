import FlowBytes from "./FlowBytes";

/*
 * Reads who-talked-to-whom out of the first bytes of a sampled packet.
 *
 * sFlow does not send flow records: it sends the first bytes (typically
 * 128) of one packet in every N, exactly as they were on the wire. To turn
 * that into a flow, this walks the headers - Ethernet, up to two VLAN tags,
 * an MPLS label stack, then IPv4 or IPv6 (and IPv6's extension headers) -
 * to the transport ports. Anything it cannot place (ARP, a fragment's tail,
 * a header cut short) gives null or leaves the ports at 0; it never throws.
 */

export interface DecodedPacketHeader {
  sourceIpAddress: string;
  destinationIpAddress: string;
  protocolNumber: number;
  sourcePort: number;
  destinationPort: number;
  tcpFlags: number;
  tos: number;
  // Length of the IP packet, as its header states it.
  ipLength: number;
}

// sFlow header_protocol values (sFlow v5, sampled_header).
export const HEADER_PROTOCOL_ETHERNET: number = 1;
export const HEADER_PROTOCOL_IPV4: number = 11;
export const HEADER_PROTOCOL_IPV6: number = 12;

const ETHERTYPE_IPV4: number = 0x0800;
const ETHERTYPE_IPV6: number = 0x86dd;
const ETHERTYPE_VLAN: number = 0x8100;
const ETHERTYPE_QINQ: number = 0x88a8;
const ETHERTYPE_QINQ_LEGACY: number = 0x9100;
const ETHERTYPE_MPLS_UNICAST: number = 0x8847;
const ETHERTYPE_MPLS_MULTICAST: number = 0x8848;

const MAX_VLAN_TAGS: number = 2;
const MAX_MPLS_LABELS: number = 8;
const MAX_IPV6_EXTENSION_HEADERS: number = 8;

const PROTOCOL_TCP: number = 6;
const PROTOCOL_UDP: number = 17;
const PROTOCOL_DCCP: number = 33;
const PROTOCOL_SCTP: number = 132;

// IPv6 extension headers walked to reach the transport header.
const IPV6_HOP_BY_HOP: number = 0;
const IPV6_ROUTING: number = 43;
const IPV6_FRAGMENT: number = 44;
const IPV6_AUTHENTICATION: number = 51;
const IPV6_DESTINATION_OPTIONS: number = 60;

export default class PacketHeaderDecoder {
  public static decode(
    headerProtocol: number,
    header: Buffer,
  ): DecodedPacketHeader | null {
    if (headerProtocol === HEADER_PROTOCOL_ETHERNET) {
      return PacketHeaderDecoder.decodeEthernet(header);
    }

    if (headerProtocol === HEADER_PROTOCOL_IPV4) {
      return PacketHeaderDecoder.decodeIpV4(header, 0);
    }

    if (headerProtocol === HEADER_PROTOCOL_IPV6) {
      return PacketHeaderDecoder.decodeIpV6(header, 0);
    }

    return null;
  }

  private static decodeEthernet(header: Buffer): DecodedPacketHeader | null {
    if (header.length < 14) {
      return null;
    }

    let offset: number = 12;
    let etherType: number = header.readUInt16BE(offset);
    offset += 2;

    for (
      let tags: number = 0;
      tags < MAX_VLAN_TAGS &&
      (etherType === ETHERTYPE_VLAN ||
        etherType === ETHERTYPE_QINQ ||
        etherType === ETHERTYPE_QINQ_LEGACY);
      tags++
    ) {
      if (offset + 4 > header.length) {
        return null;
      }

      etherType = header.readUInt16BE(offset + 2);
      offset += 4;
    }

    if (
      etherType === ETHERTYPE_MPLS_UNICAST ||
      etherType === ETHERTYPE_MPLS_MULTICAST
    ) {
      // Skip labels to the bottom of the stack, then read the IP version.
      for (let labels: number = 0; labels < MAX_MPLS_LABELS; labels++) {
        if (offset + 4 > header.length) {
          return null;
        }

        const bottomOfStack: boolean = (header[offset + 2]! & 0x01) === 1;
        offset += 4;

        if (bottomOfStack) {
          if (offset >= header.length) {
            return null;
          }

          const ipVersion: number = header[offset]! >> 4;

          if (ipVersion === 4) {
            return PacketHeaderDecoder.decodeIpV4(header, offset);
          }

          if (ipVersion === 6) {
            return PacketHeaderDecoder.decodeIpV6(header, offset);
          }

          return null;
        }
      }

      return null;
    }

    if (etherType === ETHERTYPE_IPV4) {
      return PacketHeaderDecoder.decodeIpV4(header, offset);
    }

    if (etherType === ETHERTYPE_IPV6) {
      return PacketHeaderDecoder.decodeIpV6(header, offset);
    }

    return null;
  }

  private static decodeIpV4(
    header: Buffer,
    offset: number,
  ): DecodedPacketHeader | null {
    if (offset + 20 > header.length || header[offset]! >> 4 !== 4) {
      return null;
    }

    const headerLength: number = (header[offset]! & 0x0f) * 4;

    if (headerLength < 20) {
      return null;
    }

    const fragmentOffset: number = header.readUInt16BE(offset + 6) & 0x1fff;

    const decoded: DecodedPacketHeader = {
      sourceIpAddress: FlowBytes.readIpV4(header, offset + 12),
      destinationIpAddress: FlowBytes.readIpV4(header, offset + 16),
      protocolNumber: header[offset + 9]!,
      sourcePort: 0,
      destinationPort: 0,
      tcpFlags: 0,
      tos: header[offset + 1]!,
      ipLength: header.readUInt16BE(offset + 2),
    };

    // Only the first fragment carries the transport header.
    if (fragmentOffset === 0) {
      PacketHeaderDecoder.readTransport(header, offset + headerLength, decoded);
    }

    return decoded;
  }

  private static decodeIpV6(
    header: Buffer,
    offset: number,
  ): DecodedPacketHeader | null {
    if (offset + 40 > header.length || header[offset]! >> 4 !== 6) {
      return null;
    }

    // Traffic class: the 8 bits after the version nibble.
    const trafficClass: number =
      ((header[offset]! & 0x0f) << 4) | (header[offset + 1]! >> 4);

    const decoded: DecodedPacketHeader = {
      sourceIpAddress: FlowBytes.readIpV6(header, offset + 8),
      destinationIpAddress: FlowBytes.readIpV6(header, offset + 24),
      protocolNumber: header[offset + 6]!,
      sourcePort: 0,
      destinationPort: 0,
      tcpFlags: 0,
      tos: trafficClass,
      ipLength: 40 + header.readUInt16BE(offset + 4),
    };

    let nextHeader: number = header[offset + 6]!;
    let nextOffset: number = offset + 40;

    for (
      let walked: number = 0;
      walked < MAX_IPV6_EXTENSION_HEADERS;
      walked++
    ) {
      if (
        nextHeader !== IPV6_HOP_BY_HOP &&
        nextHeader !== IPV6_ROUTING &&
        nextHeader !== IPV6_FRAGMENT &&
        nextHeader !== IPV6_AUTHENTICATION &&
        nextHeader !== IPV6_DESTINATION_OPTIONS
      ) {
        break;
      }

      if (nextOffset + 8 > header.length) {
        // The transport header is past what was sampled.
        decoded.protocolNumber = nextHeader;
        return decoded;
      }

      const followingHeader: number = header[nextOffset]!;
      let extensionLength: number;

      if (nextHeader === IPV6_FRAGMENT) {
        // A fragment past the first carries no transport header.
        const fragmentOffset: number = header.readUInt16BE(nextOffset + 2) >> 3;

        if (fragmentOffset !== 0) {
          decoded.protocolNumber = followingHeader;
          return decoded;
        }

        extensionLength = 8;
      } else if (nextHeader === IPV6_AUTHENTICATION) {
        extensionLength = (header[nextOffset + 1]! + 2) * 4;
      } else {
        extensionLength = (header[nextOffset + 1]! + 1) * 8;
      }

      nextHeader = followingHeader;
      nextOffset += extensionLength;
    }

    decoded.protocolNumber = nextHeader;
    PacketHeaderDecoder.readTransport(header, nextOffset, decoded);

    return decoded;
  }

  private static readTransport(
    header: Buffer,
    offset: number,
    decoded: DecodedPacketHeader,
  ): void {
    const protocol: number = decoded.protocolNumber;

    if (
      protocol !== PROTOCOL_TCP &&
      protocol !== PROTOCOL_UDP &&
      protocol !== PROTOCOL_DCCP &&
      protocol !== PROTOCOL_SCTP
    ) {
      return;
    }

    if (offset + 4 > header.length) {
      return;
    }

    decoded.sourcePort = header.readUInt16BE(offset);
    decoded.destinationPort = header.readUInt16BE(offset + 2);

    if (protocol === PROTOCOL_TCP && offset + 14 <= header.length) {
      decoded.tcpFlags = header[offset + 13]!;
    }
  }
}
