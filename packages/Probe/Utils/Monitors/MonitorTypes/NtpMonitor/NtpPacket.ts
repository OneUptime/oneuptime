import crypto from "crypto";
import NtpMonitorUtil from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";

/*
 * The NTP packet as an SNTP client speaks it (RFC 4330, on RFC 5905's packet
 * format): build the 48-byte request, check that a datagram really is the
 * server's reply to it, and read the time out of the reply.
 *
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |LI | VN  |Mode |    Stratum    |     Poll      |   Precision   |   0
 * |                          Root Delay                           |   4
 * |                       Root Dispersion                         |   8
 * |                         Reference ID                          |  12
 * |                  Reference Timestamp (64 bits)                |  16
 * |                    Origin Timestamp (64 bits)                 |  24
 * |                   Receive Timestamp (64 bits)                 |  32
 * |                   Transmit Timestamp (64 bits)                |  40
 *
 * Pure: no sockets and no clock reads, so every rule here is tested on
 * byte fixtures.
 */

export const NTP_PACKET_LENGTH: number = 48;

// Seconds from the NTP epoch (1900-01-01) to the Unix epoch (1970-01-01).
export const NTP_TO_UNIX_EPOCH_SECONDS: number = 2208988800;

// The version this probe asks in. Servers answer in the version they are asked.
export const NTP_CLIENT_VERSION: number = 4;

export enum NtpMode {
  SymmetricActive = 1,
  SymmetricPassive = 2,
  Client = 3,
  Server = 4,
  Broadcast = 5,
  Control = 6,
  Private = 7,
}

const TWO_POW_32: number = 4294967296;
const TWO_POW_16: number = 65536;

/*
 * An NTP timestamp counts seconds in 32 bits, so the count wraps in 2036
 * (era 1). Every time this probe can meet is between 1968 and 2104: a
 * seconds field with its top bit set is from era 0 (1968-2036), one without
 * it from era 1 (2036-2104) - RFC 4330, section 3.
 */
const ERA_0_TOP_BIT: number = 0x80000000;

const TIMESTAMP_LENGTH: number = 8;

// Byte offsets of the fields above.
const ROOT_DELAY_OFFSET: number = 4;
const ROOT_DISPERSION_OFFSET: number = 8;
const REFERENCE_ID_OFFSET: number = 12;
const REFERENCE_TIMESTAMP_OFFSET: number = 16;
const ORIGIN_TIMESTAMP_OFFSET: number = 24;
const RECEIVE_TIMESTAMP_OFFSET: number = 32;
const TRANSMIT_TIMESTAMP_OFFSET: number = 40;

// A reply's header, as sent. Timestamps stay raw: zero is meaningful.
export interface NtpServerReply {
  leapIndicator: number;
  version: number;
  mode: number;
  stratum: number;
  // log2 of the poll interval in seconds, signed.
  poll: number;
  // log2 of the clock precision in seconds, signed.
  precision: number;
  rootDelayInMs: number;
  rootDispersionInMs: number;
  referenceIdBytes: Buffer;
  referenceTimestamp: Buffer;
  originTimestamp: Buffer;
  receiveTimestamp: Buffer;
  transmitTimestamp: Buffer;
}

export type NtpReplyCheck =
  | { isValid: true; reply: NtpServerReply }
  | { isValid: false; reason: string };

// What a valid reply says, read against the request it answers.
export interface NtpReplyFacts {
  version: number;
  leapIndicator: number;
  stratum: number;
  kissCode: string | undefined;
  referenceId: string;
  pollIntervalInSeconds: number;
  precisionInMs: number;
  // Undefined at stratum 0, where they describe no reference clock.
  rootDelayInMs: number | undefined;
  rootDispersionInMs: number | undefined;
  referenceTime: string | undefined;
  serverTime: string | undefined;
  /*
   * False when the reply carries no time of its own: a receive or transmit
   * timestamp that is zero, or that only echoes the request's (which is how
   * ntpd builds a kiss-o'-death). No offset is computed from such a reply.
   */
  hasUsableTime: boolean;
  clockOffsetInMs: number | undefined;
  roundTripDelayInMs: number | undefined;
  isSynchronized: boolean;
}

export default class NtpPacket {
  /*
   * A client request: leap indicator 0, version 4, mode 3, and every field
   * zero except the transmit timestamp, which the server copies into its
   * reply's origin timestamp.
   */
  public static createClientRequest(transmitTimestamp: Buffer): Buffer {
    if (transmitTimestamp.length !== TIMESTAMP_LENGTH) {
      throw new Error("An NTP transmit timestamp is 8 bytes long.");
    }

    const packet: Buffer = Buffer.alloc(NTP_PACKET_LENGTH);

    packet.writeUInt8((0 << 6) | (NTP_CLIENT_VERSION << 3) | NtpMode.Client, 0);
    transmitTimestamp.copy(packet, TRANSMIT_TIMESTAMP_OFFSET);

    return packet;
  }

  /*
   * The request's transmit timestamp: 64 random bits, not this probe's clock.
   *
   * The server only copies the field back (as the reply's origin timestamp),
   * so it does not have to be a time - and a random one is what lets the
   * probe tell its own reply from a stale one or a spoofed one, which would
   * have to guess all 64 bits. The probe keeps the real send time to itself
   * for the offset (draft-ietf-ntp-data-minimization recommends the same).
   * Never all zeros: a zero transmit timestamp means "not set".
   */
  public static createTransmitNonce(
    randomBytes: (size: number) => Buffer = crypto.randomBytes,
  ): Buffer {
    for (;;) {
      const nonce: Buffer = randomBytes(TIMESTAMP_LENGTH);

      if (!NtpPacket.isZeroTimestamp(nonce)) {
        return nonce;
      }
    }
  }

  // Reads a packet's fields. The packet must be at least 48 bytes long.
  public static parse(packet: Buffer): NtpServerReply {
    const firstByte: number = packet.readUInt8(0);

    return {
      leapIndicator: (firstByte >> 6) & 0x3,
      version: (firstByte >> 3) & 0x7,
      mode: firstByte & 0x7,
      stratum: packet.readUInt8(1),
      poll: packet.readInt8(2),
      precision: packet.readInt8(3),
      rootDelayInMs: NtpPacket.shortFormatToMs(
        packet.readUInt32BE(ROOT_DELAY_OFFSET),
      ),
      rootDispersionInMs: NtpPacket.shortFormatToMs(
        packet.readUInt32BE(ROOT_DISPERSION_OFFSET),
      ),
      referenceIdBytes: Buffer.from(
        packet.subarray(REFERENCE_ID_OFFSET, REFERENCE_ID_OFFSET + 4),
      ),
      referenceTimestamp: NtpPacket.readTimestamp(
        packet,
        REFERENCE_TIMESTAMP_OFFSET,
      ),
      originTimestamp: NtpPacket.readTimestamp(packet, ORIGIN_TIMESTAMP_OFFSET),
      receiveTimestamp: NtpPacket.readTimestamp(
        packet,
        RECEIVE_TIMESTAMP_OFFSET,
      ),
      transmitTimestamp: NtpPacket.readTimestamp(
        packet,
        TRANSMIT_TIMESTAMP_OFFSET,
      ),
    };
  }

  /*
   * Whether a datagram is the server's reply to the request that carried
   * `transmitNonce`. Anything else is ignored - the probe keeps waiting for
   * the real reply until its timeout - so that a late reply to an earlier
   * attempt, a packet from something that is not an NTP server, or a forged
   * one can never stand in for an answer:
   *
   *   - at least 48 bytes (extension fields and a MAC may follow; ignored),
   *   - mode 4, a server reply: not a client's or a broadcast packet,
   *   - version 1 to 4,
   *   - an origin timestamp equal to this request's transmit timestamp.
   */
  public static checkServerReply(data: {
    packet: Buffer;
    transmitNonce: Buffer;
  }): NtpReplyCheck {
    if (data.packet.length < NTP_PACKET_LENGTH) {
      return {
        isValid: false,
        reason: `a ${data.packet.length}-byte packet, shorter than an NTP packet (48 bytes)`,
      };
    }

    const reply: NtpServerReply = NtpPacket.parse(data.packet);

    if (reply.mode !== NtpMode.Server) {
      return {
        isValid: false,
        reason: `a packet in NTP mode ${reply.mode}, not a server reply (mode 4)`,
      };
    }

    if (reply.version < 1 || reply.version > NTP_CLIENT_VERSION) {
      return {
        isValid: false,
        reason: `a reply in NTP version ${reply.version}, which is not a version this probe reads`,
      };
    }

    if (!reply.originTimestamp.equals(data.transmitNonce)) {
      return {
        isValid: false,
        reason:
          "a reply to a different request (its origin timestamp does not match), so a stale or spoofed packet",
      };
    }

    return { isValid: true, reply: reply };
  }

  /*
   * What a valid reply says. requestSentAtUnixMs and replyReceivedAtUnixMs
   * are the probe's clock (T1 and T4 of RFC 5905); the server's receive and
   * transmit timestamps are T2 and T3.
   */
  public static readReply(data: {
    reply: NtpServerReply;
    transmitNonce: Buffer;
    requestSentAtUnixMs: number;
    replyReceivedAtUnixMs: number;
  }): NtpReplyFacts {
    const reply: NtpServerReply = data.reply;

    const kissCode: string | undefined =
      reply.stratum === 0
        ? NtpPacket.decodeAscii(reply.referenceIdBytes)
        : undefined;

    const hasUsableTime: boolean =
      !NtpPacket.isZeroTimestamp(reply.receiveTimestamp) &&
      !NtpPacket.isZeroTimestamp(reply.transmitTimestamp) &&
      !reply.receiveTimestamp.equals(data.transmitNonce) &&
      !reply.transmitTimestamp.equals(data.transmitNonce);

    let clockOffsetInMs: number | undefined = undefined;
    let roundTripDelayInMs: number | undefined = undefined;
    let serverTime: string | undefined = undefined;

    if (hasUsableTime) {
      const receiveMs: number = NtpPacket.timestampToUnixMs(
        reply.receiveTimestamp,
      )!;
      const transmitMs: number = NtpPacket.timestampToUnixMs(
        reply.transmitTimestamp,
      )!;

      const exchange: { clockOffsetInMs: number; roundTripDelayInMs: number } =
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: data.requestSentAtUnixMs,
          serverReceivedAtMs: receiveMs,
          serverSentAtMs: transmitMs,
          replyReceivedAtMs: data.replyReceivedAtUnixMs,
        });

      clockOffsetInMs = exchange.clockOffsetInMs;
      roundTripDelayInMs = exchange.roundTripDelayInMs;
      serverTime = NtpPacket.toIsoString(transmitMs);
    }

    const referenceMs: number | undefined = NtpPacket.timestampToUnixMs(
      reply.referenceTimestamp,
    );

    /*
     * Stratum 0 is a kiss-o'-death, or a server that does not know its own
     * state. Its root delay and dispersion describe no reference clock -
     * a kiss usually sends zeros - so they are not reported: a 0 ms error
     * bound would read as a perfect clock on the chart and to a criteria.
     */
    const hasReference: boolean = reply.stratum !== 0;

    return {
      version: reply.version,
      leapIndicator: reply.leapIndicator,
      stratum: reply.stratum,
      kissCode: kissCode,
      referenceId: NtpPacket.decodeReferenceId(
        reply.referenceIdBytes,
        reply.stratum,
      ),
      pollIntervalInSeconds: Math.pow(2, reply.poll),
      precisionInMs: Math.pow(2, reply.precision) * 1000,
      rootDelayInMs: hasReference ? reply.rootDelayInMs : undefined,
      rootDispersionInMs: hasReference ? reply.rootDispersionInMs : undefined,
      referenceTime:
        referenceMs === undefined
          ? undefined
          : NtpPacket.toIsoString(referenceMs),
      serverTime: serverTime,
      hasUsableTime: hasUsableTime,
      clockOffsetInMs: clockOffsetInMs,
      roundTripDelayInMs: roundTripDelayInMs,
      isSynchronized: NtpMonitorUtil.isSynchronized({
        stratum: reply.stratum,
        leapIndicator: reply.leapIndicator,
        hasUsableTime: hasUsableTime,
      }),
    };
  }

  /*
   * The clock offset and round-trip delay of one exchange (RFC 5905, section
   * 8), in milliseconds:
   *
   *   offset = ((T2 - T1) + (T3 - T4)) / 2
   *   delay  = (T4 - T1) - (T3 - T2)
   *
   * A positive offset means the server's clock is ahead of the probe's. The
   * offset assumes the request and the reply took equally long, so a path
   * that is much slower one way skews it by up to half the round trip.
   * A delay below zero is an artifact of the server's own clock precision
   * and is reported as zero.
   */
  public static computeClockOffsetAndDelay(data: {
    requestSentAtMs: number;
    serverReceivedAtMs: number;
    serverSentAtMs: number;
    replyReceivedAtMs: number;
  }): { clockOffsetInMs: number; roundTripDelayInMs: number } {
    const clockOffsetInMs: number =
      (data.serverReceivedAtMs -
        data.requestSentAtMs +
        (data.serverSentAtMs - data.replyReceivedAtMs)) /
      2;

    const roundTripDelayInMs: number =
      data.replyReceivedAtMs -
      data.requestSentAtMs -
      (data.serverSentAtMs - data.serverReceivedAtMs);

    return {
      clockOffsetInMs: clockOffsetInMs,
      roundTripDelayInMs: Math.max(0, roundTripDelayInMs),
    };
  }

  public static isZeroTimestamp(timestamp: Buffer): boolean {
    return timestamp.every((byte: number): boolean => {
      return byte === 0;
    });
  }

  // An NTP timestamp as Unix milliseconds, or undefined when it is zero (unset).
  public static timestampToUnixMs(timestamp: Buffer): number | undefined {
    const seconds: number = timestamp.readUInt32BE(0);
    const fraction: number = timestamp.readUInt32BE(4);

    if (seconds === 0 && fraction === 0) {
      return undefined;
    }

    const secondsSinceNtpEpoch: number =
      seconds >= ERA_0_TOP_BIT ? seconds : seconds + TWO_POW_32;

    return (
      (secondsSinceNtpEpoch - NTP_TO_UNIX_EPOCH_SECONDS) * 1000 +
      (fraction * 1000) / TWO_POW_32
    );
  }

  // Unix milliseconds as an NTP timestamp, wrapping into era 1 after 2036.
  public static unixMsToTimestamp(unixMs: number): Buffer {
    const wholeSeconds: number = Math.floor(unixMs / 1000);
    const fractionOfSecond: number = (unixMs - wholeSeconds * 1000) / 1000;

    const seconds: number =
      (((wholeSeconds + NTP_TO_UNIX_EPOCH_SECONDS) % TWO_POW_32) + TWO_POW_32) %
      TWO_POW_32;

    const fraction: number = Math.min(
      TWO_POW_32 - 1,
      Math.round(fractionOfSecond * TWO_POW_32),
    );

    const timestamp: Buffer = Buffer.alloc(TIMESTAMP_LENGTH);
    timestamp.writeUInt32BE(seconds, 0);
    timestamp.writeUInt32BE(fraction, 4);

    return timestamp;
  }

  // The 32-bit "NTP short format" (16.16 seconds) in milliseconds.
  public static shortFormatToMs(value: number): number {
    return (value / TWO_POW_16) * 1000;
  }

  // Milliseconds as the 32-bit NTP short format, for building replies.
  public static msToShortFormat(valueInMs: number): number {
    return Math.min(
      TWO_POW_32 - 1,
      Math.max(0, Math.round((valueInMs / 1000) * TWO_POW_16)),
    );
  }

  /*
   * The reference id as an operator reads it: a source name ("GPS", "PPS",
   * "NIST") at stratum 0 and 1, where it is four ASCII characters, and the
   * upstream server's address ("192.0.2.1") from stratum 2 on. An IPv6
   * upstream is a hash there, shown the same way ntpq shows it. Empty when
   * the server sent zeros.
   */
  public static decodeReferenceId(bytes: Buffer, stratum: number): string {
    if (bytes.length < 4 || NtpPacket.isZeroTimestamp(bytes)) {
      return "";
    }

    if (stratum <= 1 || stratum > 15) {
      const ascii: string | undefined = NtpPacket.decodeAscii(bytes);

      if (ascii) {
        return ascii;
      }
    }

    return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
  }

  /*
   * Up to four printable ASCII characters, padded with NULs at the end:
   * a stratum 1 source or a kiss code. Undefined when the bytes are not that.
   */
  public static decodeAscii(bytes: Buffer): string | undefined {
    let end: number = Math.min(4, bytes.length);

    while (end > 0 && bytes[end - 1] === 0) {
      end--;
    }

    if (end === 0) {
      return undefined;
    }

    for (let index: number = 0; index < end; index++) {
      const code: number = bytes[index]!;

      if (code < 0x20 || code > 0x7e) {
        return undefined;
      }
    }

    const text: string = bytes.subarray(0, end).toString("ascii").trim();

    return text || undefined;
  }

  private static readTimestamp(packet: Buffer, offset: number): Buffer {
    return Buffer.from(packet.subarray(offset, offset + TIMESTAMP_LENGTH));
  }

  private static toIsoString(unixMs: number): string | undefined {
    const date: Date = new Date(unixMs);

    return isNaN(date.getTime()) ? undefined : date.toISOString();
  }
}
