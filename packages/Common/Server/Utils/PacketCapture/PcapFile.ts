import { isBase64Character } from "../../../Utils/Markdown/InlineImageDataUri";

/*
 * Reads the pcap files a probe's captures produce - the classic libpcap
 * format tcpdump writes with -w, which Wireshark opens as it is:
 *
 *   global header (24 bytes)   magic, version, time zone, snap length, link type
 *   then, per packet:
 *     record header (16 bytes) seconds, microseconds (or nanoseconds),
 *                              captured length, original length
 *     the captured bytes       `captured length` of them
 *
 * The magic number says the byte order the file was written in and whether
 * its timestamps are micro- or nanoseconds. Both sides use this file: the
 * probe cuts a capture at its size limit on a packet boundary (truncate),
 * and the server checks that what a probe uploaded is a pcap file and counts
 * its packets itself (inspect) rather than taking the probe's word for it.
 */

export const PCAP_GLOBAL_HEADER_LENGTH: number = 24;
export const PCAP_RECORD_HEADER_LENGTH: number = 16;

const MAGIC_MICROSECONDS: number = 0xa1b2c3d4;
const MAGIC_NANOSECONDS: number = 0xa1b23c4d;
const MAGIC_MICROSECONDS_SWAPPED: number = 0xd4c3b2a1;
const MAGIC_NANOSECONDS_SWAPPED: number = 0x4d3cb2a1;

/*
 * The largest packet a record may hold. libpcap's own snapshot maximum is
 * 262144 bytes; a record that says it holds more is not a packet but a
 * corrupt or forged file, and reading on from it would only find garbage.
 */
export const PCAP_MAX_RECORD_LENGTH: number = 262144;

const EQUALS_SIGN: number = 0x3d;

export interface PcapInspection {
  // Whether the buffer starts with a pcap global header.
  isPcap: boolean;
  // Whole packets, counted from the start.
  packetCount: number;
  /*
   * Bytes up to the end of the last whole packet - the header plus every
   * whole record. Shorter than the buffer when it ends part-way through a
   * record (the capture tool was stopped mid-write) or holds garbage.
   */
  wholeLength: number;
  // The link type the file declares (1 is Ethernet, 113 Linux "any").
  linkType: number | null;
}

export interface PcapTruncation {
  buffer: Buffer;
  packetCount: number;
}

type ReadNumber = (buffer: Buffer, offset: number) => number;

const readLittleEndian: ReadNumber = (
  buffer: Buffer,
  offset: number,
): number => {
  return buffer.readUInt32LE(offset);
};

const readBigEndian: ReadNumber = (buffer: Buffer, offset: number): number => {
  return buffer.readUInt32BE(offset);
};

export default class PcapFile {
  /*
   * How the file reads its numbers: in the byte order its magic number was
   * written in. Null when the buffer does not start with a pcap header.
   */
  private static getReader(buffer: Buffer): ReadNumber | null {
    if (buffer.length < PCAP_GLOBAL_HEADER_LENGTH) {
      return null;
    }

    const magic: number = buffer.readUInt32LE(0);

    if (magic === MAGIC_MICROSECONDS || magic === MAGIC_NANOSECONDS) {
      return readLittleEndian;
    }

    if (
      magic === MAGIC_MICROSECONDS_SWAPPED ||
      magic === MAGIC_NANOSECONDS_SWAPPED
    ) {
      return readBigEndian;
    }

    return null;
  }

  public static isPcap(buffer: Buffer): boolean {
    return PcapFile.getReader(buffer) !== null;
  }

  /*
   * The packets a buffer holds, walked record by record from the header.
   * Stops at the first record that does not fit - cut short, or saying it
   * holds more than any packet can - so a damaged tail is never counted.
   */
  public static inspect(buffer: Buffer): PcapInspection {
    const read: ReadNumber | null = PcapFile.getReader(buffer);

    if (!read) {
      return { isPcap: false, packetCount: 0, wholeLength: 0, linkType: null };
    }

    let offset: number = PCAP_GLOBAL_HEADER_LENGTH;
    let packetCount: number = 0;

    while (offset + PCAP_RECORD_HEADER_LENGTH <= buffer.length) {
      const capturedLength: number = read(buffer, offset + 8);

      if (capturedLength > PCAP_MAX_RECORD_LENGTH) {
        break;
      }

      const recordEnd: number =
        offset + PCAP_RECORD_HEADER_LENGTH + capturedLength;

      if (recordEnd > buffer.length) {
        break;
      }

      offset = recordEnd;
      packetCount++;
    }

    return {
      isPcap: true,
      packetCount: packetCount,
      wholeLength: offset,
      linkType: read(buffer, 20),
    };
  }

  /*
   * The bytes a probe's base64 upload stands for, or null when it is not
   * base64 in the standard alphabet (what Buffer.toString("base64") writes).
   * Buffer.from would skip any character it does not know and decode the
   * rest, so the text is checked first - with a loop, never a regular
   * expression: an upload is megabytes on one line (see AGENTS.md).
   */
  public static decodeBase64(text: string): Buffer | null {
    let end: number = text.length;

    for (
      let padding: number = 0;
      padding < 2 && end > 0 && text.charCodeAt(end - 1) === EQUALS_SIGN;
      padding++
    ) {
      end--;
    }

    if (end === 0 || text.length % 4 !== 0) {
      return null;
    }

    for (let index: number = 0; index < end; index++) {
      if (!isBase64Character(text.charCodeAt(index))) {
        return null;
      }
    }

    return Buffer.from(text, "base64");
  }

  /*
   * The file cut to at most `maxBytes`, at the end of the last whole packet
   * that fits, so it still opens in Wireshark - and with a half-written last
   * record dropped even when it is under the limit. A buffer that is not a
   * pcap file comes back empty.
   */
  public static truncate(buffer: Buffer, maxBytes: number): PcapTruncation {
    const read: ReadNumber | null = PcapFile.getReader(buffer);

    if (!read || maxBytes < PCAP_GLOBAL_HEADER_LENGTH) {
      return { buffer: Buffer.alloc(0), packetCount: 0 };
    }

    let offset: number = PCAP_GLOBAL_HEADER_LENGTH;
    let packetCount: number = 0;

    while (offset + PCAP_RECORD_HEADER_LENGTH <= buffer.length) {
      const capturedLength: number = read(buffer, offset + 8);

      if (capturedLength > PCAP_MAX_RECORD_LENGTH) {
        break;
      }

      const recordEnd: number =
        offset + PCAP_RECORD_HEADER_LENGTH + capturedLength;

      if (recordEnd > buffer.length || recordEnd > maxBytes) {
        break;
      }

      offset = recordEnd;
      packetCount++;
    }

    return {
      buffer: Buffer.from(buffer.subarray(0, offset)),
      packetCount: packetCount,
    };
  }
}
