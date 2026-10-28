import zlib from "zlib";

/*
 * THE FEW FILES OF AN OFFICE DOCUMENT A SCAN NEEDS, AND NOT ONE BYTE MORE.
 *
 * DOCX, XLSX and PPTX are ZIP archives of XML. A scan wants three or four
 * entries of one - word/document.xml, xl/sharedStrings.xml, the slides -
 * from bytes it does not trust: an archive can claim a million entries,
 * inflate a few kilobytes into gigabytes (a zip bomb), point many entries
 * at the same data, or lie about its sizes. So this reader is small and
 * holds everything to limits:
 *
 *  - It reads only the bytes it is given, every offset checked, and never
 *    past their end. A scan reads the first bytes of an object, so when the
 *    archive is cut short and its central directory (at the end) is
 *    missing, the entries are found by walking the local headers from the
 *    start instead - an Office file's main XML is near the front.
 *  - Stored and deflated entries only, inflated by zlib with
 *    maxOutputLength, so no entry can grow past its limit. An entry that is
 *    larger than the limit is read in part: its first compressed bytes, a
 *    prefix at a time, never more output than the limit.
 *  - Refused as a zip bomb: more entries than maxEntries, an entry that
 *    claims a ratio deflate cannot reach, one that inflates past the size
 *    it declares, and two entries that share their data.
 */

export interface ZipLimits {
  // The most entries an archive may list.
  maxEntries: number;
  // The most bytes one entry is inflated to.
  maxEntryBytes: number;
  // The most bytes all the entries read are inflated to, together.
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4096,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
};

// Deflate never inflates more than 1032 bytes from one compressed byte.
const MAX_DEFLATE_RATIO: number = 1032;

const LOCAL_HEADER_SIGNATURE: number = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE: number = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE: number = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE: number = 0x08074b50;

const LOCAL_HEADER_LENGTH: number = 30;
const CENTRAL_HEADER_LENGTH: number = 46;
const END_OF_CENTRAL_DIRECTORY_LENGTH: number = 22;
const MAX_COMMENT_LENGTH: number = 65535;

const METHOD_STORED: number = 0;
const METHOD_DEFLATED: number = 8;

const FLAG_ENCRYPTED: number = 0x1;
const FLAG_DATA_DESCRIPTOR: number = 0x8;
const FLAG_UTF8_NAME: number = 0x800;

const ZIP64_MARKER_32: number = 0xffffffff;
const ZIP64_MARKER_16: number = 0xffff;

// The longest entry name read.
const MAX_NAME_LENGTH: number = 1024;

// How far past a data descriptor the next local header is looked for.
const NEXT_HEADER_SEARCH: number = 32;

export class ZipError extends Error {
  public readonly isZipBomb: boolean;

  public constructor(message: string, isZipBomb: boolean = false) {
    super(message);
    this.isZipBomb = isZipBomb;
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  // As the archive declares them; -1 when no header says.
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipEntryData {
  data: Uint8Array;
  // The entry was cut: by the limits, or by the end of the bytes given.
  isPartial: boolean;
}

interface InflateOutcome {
  output: Buffer;
  consumed: number;
}

function isBufferTooLarge(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE")
  );
}

/*
 * Inflates raw deflate data to at most maxOutput bytes, reading a stream
 * that may be cut short. Throws a RangeError when the output would be
 * longer; reports how many compressed bytes the stream took.
 */
function inflateBounded(data: Uint8Array, maxOutput: number): InflateOutcome {
  const result: unknown = zlib.inflateRawSync(data, {
    maxOutputLength: Math.max(1, maxOutput),
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
    info: true,
  } as zlib.ZlibOptions);
  const outcome: { buffer: Buffer; engine: { bytesWritten?: number } } =
    result as { buffer: Buffer; engine: { bytesWritten?: number } };

  return {
    output: outcome.buffer,
    consumed:
      typeof outcome.engine.bytesWritten === "number"
        ? outcome.engine.bytesWritten
        : data.length,
  };
}

/*
 * The start of compressed data that inflates past maxOutput: the longest
 * prefix of it, doubled each try from one that cannot reach the limit,
 * that still inflates within it. `decompress` reads a prefix that may end
 * anywhere and throws a RangeError past maxOutput; each try costs at most
 * maxOutput, and the tries together about twice that.
 */
export function decompressPrefix(
  data: Uint8Array,
  maxOutput: number,
  decompress: (prefix: Uint8Array) => Buffer,
): Buffer {
  let prefix: number = Math.max(64, Math.floor(maxOutput / MAX_DEFLATE_RATIO));
  let best: Buffer = Buffer.alloc(0);

  for (;;) {
    const length: number = Math.min(prefix, data.length);

    try {
      best = decompress(data.subarray(0, length));
    } catch (error) {
      if (isBufferTooLarge(error)) {
        break;
      }

      throw error;
    }

    if (length >= data.length) {
      break;
    }

    prefix *= 2;
  }

  return best;
}

export function isBufferTooLargeError(error: unknown): boolean {
  return isBufferTooLarge(error);
}

function inflatePrefix(data: Uint8Array, maxOutput: number): Buffer {
  return decompressPrefix(data, maxOutput, (prefix: Uint8Array): Buffer => {
    return inflateBounded(prefix, maxOutput).output;
  });
}

export default class ZipReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly limits: ZipLimits;
  private readonly found: Array<ZipEntry>;
  private readonly fromLocalHeaders: boolean;
  private readonly readOffsets: Set<number> = new Set();
  private inflatedTotal: number = 0;

  private constructor(data: { bytes: Uint8Array; limits: ZipLimits }) {
    this.bytes = data.bytes;
    this.view = new DataView(
      data.bytes.buffer,
      data.bytes.byteOffset,
      data.bytes.byteLength,
    );
    this.limits = data.limits;

    const fromDirectory: Array<ZipEntry> | null = this.readCentralDirectory();

    this.fromLocalHeaders = fromDirectory === null;
    this.found = fromDirectory || this.walkLocalHeaders();
  }

  // Whether the bytes start like a ZIP archive.
  public static isZip(bytes: Uint8Array): boolean {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06))
    );
  }

  /*
   * Opens an archive. Throws a ZipError when the bytes are not one, or
   * list more entries than the limit allows.
   */
  public static open(
    bytes: Uint8Array,
    limits: Partial<ZipLimits> = {},
  ): ZipReader {
    if (!ZipReader.isZip(bytes)) {
      throw new ZipError("The content is not a ZIP archive.");
    }

    return new ZipReader({
      bytes,
      limits: { ...DEFAULT_ZIP_LIMITS, ...limits },
    });
  }

  public get entries(): ReadonlyArray<ZipEntry> {
    return this.found;
  }

  /*
   * Whether the entries came from the local headers because the central
   * directory was not in the bytes given: the archive was cut short.
   */
  public get isTruncated(): boolean {
    return this.fromLocalHeaders;
  }

  public find(name: string): ZipEntry | undefined {
    return this.found.find((entry: ZipEntry) => {
      return entry.name === name;
    });
  }

  /*
   * One entry's bytes, inflated within the limits. Throws a ZipError for an
   * entry that cannot be read (encrypted, an unknown method) and for one
   * that is a zip bomb.
   */
  public read(entry: ZipEntry): ZipEntryData {
    if (entry.flags & FLAG_ENCRYPTED) {
      throw new ZipError(`${entry.name} is encrypted.`);
    }

    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
      throw new ZipError(
        `${entry.name} uses compression method ${entry.method}, which is not supported.`,
      );
    }

    if (this.readOffsets.has(entry.localHeaderOffset)) {
      throw new ZipError(
        `${entry.name} shares its data with another entry: the archive is a zip bomb.`,
        true,
      );
    }

    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > MAX_DEFLATE_RATIO
    ) {
      throw new ZipError(
        `${entry.name} claims to inflate ${Math.round(
          entry.uncompressedSize / entry.compressedSize,
        )} times its size, more than deflate can: the archive is a zip bomb.`,
        true,
      );
    }

    const remaining: number = this.limits.maxTotalBytes - this.inflatedTotal;

    if (remaining <= 0) {
      return { data: new Uint8Array(0), isPartial: true };
    }

    const dataStart: number = this.getDataStart(entry);
    const declaredEnd: number =
      entry.compressedSize >= 0
        ? dataStart + entry.compressedSize
        : this.bytes.length;
    const end: number = Math.min(declaredEnd, this.bytes.length);
    const compressed: Uint8Array = this.bytes.subarray(dataStart, end);
    const cutByBytes: boolean = declaredEnd > this.bytes.length;
    const limit: number = Math.min(this.limits.maxEntryBytes, remaining);

    this.readOffsets.add(entry.localHeaderOffset);

    let data: Uint8Array;
    let isPartial: boolean = cutByBytes;

    if (entry.method === METHOD_STORED) {
      data = compressed.subarray(0, Math.min(compressed.length, limit));
      isPartial = isPartial || compressed.length > limit;
    } else {
      const declaredFits: boolean =
        entry.uncompressedSize >= 0 && entry.uncompressedSize <= limit;
      const outputLimit: number = declaredFits
        ? Math.max(entry.uncompressedSize, 1)
        : limit;

      try {
        data = inflateBounded(compressed, outputLimit).output;
      } catch (error) {
        if (!isBufferTooLarge(error)) {
          throw new ZipError(`${entry.name} could not be inflated.`);
        }

        if (declaredFits) {
          throw new ZipError(
            `${entry.name} inflates past the ${entry.uncompressedSize} bytes it declares: the archive is a zip bomb.`,
            true,
          );
        }

        data = inflatePrefix(compressed, limit);
        isPartial = true;
      }

      if (!declaredFits && entry.uncompressedSize > limit) {
        isPartial = true;
      }
    }

    this.inflatedTotal += data.length;

    return { data, isPartial };
  }

  // One entry's text, as UTF-8, or null when the archive has no such entry.
  public readText(name: string): { text: string; isPartial: boolean } | null {
    const entry: ZipEntry | undefined = this.find(name);

    if (!entry) {
      return null;
    }

    const read: ZipEntryData = this.read(entry);

    return {
      text: Buffer.from(
        read.data.buffer,
        read.data.byteOffset,
        read.data.byteLength,
      ).toString("utf8"),
      isPartial: read.isPartial,
    };
  }

  private readUInt16(offset: number): number {
    return offset + 2 <= this.bytes.length
      ? this.view.getUint16(offset, true)
      : -1;
  }

  private readUInt32(offset: number): number {
    return offset + 4 <= this.bytes.length
      ? this.view.getUint32(offset, true)
      : -1;
  }

  private readName(offset: number, length: number, flags: number): string {
    const end: number = Math.min(
      offset + Math.min(length, MAX_NAME_LENGTH),
      this.bytes.length,
    );
    const raw: Buffer = Buffer.from(
      this.bytes.buffer,
      this.bytes.byteOffset + offset,
      Math.max(0, end - offset),
    );

    return raw.toString(flags & FLAG_UTF8_NAME ? "utf8" : "latin1");
  }

  // Where an entry's data starts, from its local header.
  private getDataStart(entry: ZipEntry): number {
    const offset: number = entry.localHeaderOffset;

    if (this.readUInt32(offset) !== LOCAL_HEADER_SIGNATURE) {
      throw new ZipError(`${entry.name} has no local header.`);
    }

    const nameLength: number = this.readUInt16(offset + 26);
    const extraLength: number = this.readUInt16(offset + 28);

    if (nameLength < 0 || extraLength < 0) {
      throw new ZipError(`${entry.name} has a cut local header.`);
    }

    return Math.min(
      offset + LOCAL_HEADER_LENGTH + nameLength + extraLength,
      this.bytes.length,
    );
  }

  private findEndOfCentralDirectory(): number {
    const last: number = this.bytes.length - END_OF_CENTRAL_DIRECTORY_LENGTH;
    const first: number = Math.max(0, last - MAX_COMMENT_LENGTH);

    for (let offset: number = last; offset >= first; offset--) {
      if (
        this.bytes[offset] === 0x50 &&
        this.bytes[offset + 1] === 0x4b &&
        this.bytes[offset + 2] === 0x05 &&
        this.bytes[offset + 3] === 0x06 &&
        this.readUInt32(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE
      ) {
        const commentLength: number = this.readUInt16(offset + 20);

        if (
          offset + END_OF_CENTRAL_DIRECTORY_LENGTH + commentLength <=
          this.bytes.length
        ) {
          return offset;
        }
      }
    }

    return -1;
  }

  /*
   * The entries the central directory lists, or null when the bytes given
   * do not hold it (the archive was cut short, or is ZIP64).
   */
  private readCentralDirectory(): Array<ZipEntry> | null {
    const end: number = this.findEndOfCentralDirectory();

    if (end < 0) {
      return null;
    }

    const totalEntries: number = this.readUInt16(end + 10);
    const directorySize: number = this.readUInt32(end + 12);
    const directoryOffset: number = this.readUInt32(end + 16);

    if (
      totalEntries === ZIP64_MARKER_16 ||
      directoryOffset === ZIP64_MARKER_32 ||
      directorySize === ZIP64_MARKER_32
    ) {
      return null;
    }

    if (totalEntries > this.limits.maxEntries) {
      throw new ZipError(
        `The archive lists ${totalEntries} entries, more than the ${this.limits.maxEntries} a scan reads: it is refused as a zip bomb.`,
        true,
      );
    }

    if (directoryOffset < 0 || directoryOffset + directorySize > end) {
      return null;
    }

    const entries: Array<ZipEntry> = [];
    let offset: number = directoryOffset;

    for (let index: number = 0; index < totalEntries; index++) {
      if (
        offset + CENTRAL_HEADER_LENGTH > end ||
        this.readUInt32(offset) !== CENTRAL_HEADER_SIGNATURE
      ) {
        return null;
      }

      const flags: number = this.readUInt16(offset + 8);
      const method: number = this.readUInt16(offset + 10);
      const compressedSize: number = this.readUInt32(offset + 20);
      const uncompressedSize: number = this.readUInt32(offset + 24);
      const nameLength: number = this.readUInt16(offset + 28);
      const extraLength: number = this.readUInt16(offset + 30);
      const commentLength: number = this.readUInt16(offset + 32);
      const localHeaderOffset: number = this.readUInt32(offset + 42);

      if (
        compressedSize === ZIP64_MARKER_32 ||
        uncompressedSize === ZIP64_MARKER_32 ||
        localHeaderOffset === ZIP64_MARKER_32
      ) {
        return null;
      }

      entries.push({
        name: this.readName(offset + CENTRAL_HEADER_LENGTH, nameLength, flags),
        method,
        flags,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset +=
        CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength;
    }

    return entries;
  }

  // Where the next local header starts, at or just after `from`, or -1.
  private findNextLocalHeader(from: number): number {
    const last: number = Math.min(
      from + NEXT_HEADER_SEARCH,
      this.bytes.length - 4,
    );

    for (let offset: number = from; offset <= last; offset++) {
      const signature: number = this.readUInt32(offset);

      if (
        signature === LOCAL_HEADER_SIGNATURE ||
        signature === CENTRAL_HEADER_SIGNATURE
      ) {
        return offset;
      }
    }

    return -1;
  }

  /*
   * The entries of an archive whose central directory is not in the bytes
   * given, from its local headers in order. An entry whose size only a
   * data descriptor says is measured by inflating it; the walk stops at
   * the first entry it cannot get past.
   */
  private walkLocalHeaders(): Array<ZipEntry> {
    const entries: Array<ZipEntry> = [];
    let offset: number = 0;

    while (
      offset + LOCAL_HEADER_LENGTH <= this.bytes.length &&
      this.readUInt32(offset) === LOCAL_HEADER_SIGNATURE
    ) {
      if (entries.length >= this.limits.maxEntries) {
        throw new ZipError(
          `The archive holds more than the ${this.limits.maxEntries} entries a scan reads: it is refused as a zip bomb.`,
          true,
        );
      }

      const flags: number = this.readUInt16(offset + 6);
      const method: number = this.readUInt16(offset + 8);
      const nameLength: number = this.readUInt16(offset + 26);
      const extraLength: number = this.readUInt16(offset + 28);
      const dataStart: number =
        offset + LOCAL_HEADER_LENGTH + nameLength + extraLength;
      let compressedSize: number = this.readUInt32(offset + 18);
      let uncompressedSize: number = this.readUInt32(offset + 22);
      const sizeIsInDescriptor: boolean =
        (flags & FLAG_DATA_DESCRIPTOR) !== 0 && compressedSize === 0;

      if (dataStart > this.bytes.length) {
        break;
      }

      if (sizeIsInDescriptor) {
        compressedSize = -1;
        uncompressedSize = -1;
      }

      const entry: ZipEntry = {
        name: this.readName(offset + LOCAL_HEADER_LENGTH, nameLength, flags),
        method,
        flags,
        compressedSize,
        uncompressedSize,
        localHeaderOffset: offset,
      };

      entries.push(entry);

      let dataEnd: number;

      if (!sizeIsInDescriptor) {
        dataEnd = dataStart + compressedSize;
      } else if (method === METHOD_DEFLATED && !(flags & FLAG_ENCRYPTED)) {
        let measured: InflateOutcome;

        try {
          measured = inflateBounded(
            this.bytes.subarray(dataStart),
            this.limits.maxEntryBytes,
          );
        } catch {
          // Too large or broken to measure: nothing after it can be found.
          break;
        }

        dataEnd = dataStart + measured.consumed;

        // Measured whole, unless the stream ran to the end of the bytes.
        if (dataEnd < this.bytes.length) {
          entry.compressedSize = measured.consumed;
          entry.uncompressedSize = measured.output.length;
        }
      } else {
        break;
      }

      if (dataEnd >= this.bytes.length) {
        break;
      }

      let next: number = dataEnd;

      if (flags & FLAG_DATA_DESCRIPTOR) {
        next +=
          this.readUInt32(dataEnd) === DATA_DESCRIPTOR_SIGNATURE ? 16 : 12;
      }

      const header: number = this.findNextLocalHeader(Math.max(dataEnd, next));

      if (header < 0 || this.readUInt32(header) !== LOCAL_HEADER_SIGNATURE) {
        break;
      }

      offset = header;
    }

    return entries;
  }
}
