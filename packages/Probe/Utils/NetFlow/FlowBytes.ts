/*
 * Reading the numbers and addresses flow export formats put on the wire.
 * Everything in NetFlow, IPFIX and sFlow is big-endian. Every reader here
 * is bounds-checked by its caller: a reader is only ever pointed at bytes
 * the caller already knows are inside the buffer.
 */

// Seconds between the NTP epoch (1900) and the Unix epoch (1970).
const NTP_TO_UNIX_EPOCH_SECONDS: number = 2208988800;

export default class FlowBytes {
  /*
   * A big-endian unsigned integer of any width a template declares (1-8
   * bytes): counters are 4 bytes on most exporters and 8 on busy links,
   * interface indexes 2 or 4. Buffer.readUIntBE stops at 6 bytes, so 7 and
   * 8 byte values are read as a high and a low half. Values past 2^53 lose
   * precision, but that is more than 9 PB in one flow - nothing exports
   * that. Any other width reads as 0.
   */
  public static readUnsigned(
    buffer: Buffer,
    offset: number,
    length: number,
  ): number {
    if (length <= 0 || length > 8 || offset + length > buffer.length) {
      return 0;
    }

    if (length <= 6) {
      return buffer.readUIntBE(offset, length);
    }

    const highLength: number = length - 4;
    const high: number = buffer.readUIntBE(offset, highLength);
    const low: number = buffer.readUInt32BE(offset + highLength);

    return high * 0x100000000 + low;
  }

  public static readIpV4(buffer: Buffer, offset: number): string {
    return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${
      buffer[offset + 3]
    }`;
  }

  /*
   * A 16-byte IPv6 address in the standard text form (RFC 5952): lowercase
   * hex groups without leading zeros, the longest run of two or more zero
   * groups written "::" (the leftmost one on a tie).
   */
  public static readIpV6(buffer: Buffer, offset: number): string {
    const groups: Array<number> = [];

    for (let i: number = 0; i < 8; i++) {
      groups.push(buffer.readUInt16BE(offset + i * 2));
    }

    let bestRunStart: number = -1;
    let bestRunLength: number = 0;
    let runStart: number = -1;
    let runLength: number = 0;

    for (let i: number = 0; i < groups.length; i++) {
      if (groups[i] === 0) {
        if (runStart === -1) {
          runStart = i;
          runLength = 0;
        }
        runLength++;
        if (runLength > bestRunLength) {
          bestRunStart = runStart;
          bestRunLength = runLength;
        }
      } else {
        runStart = -1;
        runLength = 0;
      }
    }

    const hexGroups: Array<string> = groups.map((group: number): string => {
      return group.toString(16);
    });

    if (bestRunLength < 2) {
      return hexGroups.join(":");
    }

    const beforeRun: string = hexGroups.slice(0, bestRunStart).join(":");
    const afterRun: string = hexGroups
      .slice(bestRunStart + bestRunLength)
      .join(":");

    return `${beforeRun}::${afterRun}`;
  }

  /*
   * An IPFIX dateTimeMicroseconds / dateTimeNanoseconds value: an NTP
   * timestamp - 32 bits of seconds since 1900 and 32 bits of fraction - as
   * milliseconds since the Unix epoch.
   */
  public static readNtpTimestampMs(buffer: Buffer, offset: number): number {
    if (offset + 8 > buffer.length) {
      return 0;
    }

    const seconds: number = buffer.readUInt32BE(offset);
    const fraction: number = buffer.readUInt32BE(offset + 4);

    return (
      (seconds - NTP_TO_UNIX_EPOCH_SECONDS) * 1000 +
      Math.floor((fraction / 0x100000000) * 1000)
    );
  }
}
