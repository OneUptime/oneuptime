import zlib from "zlib";

/*
 * A small, bounded ZIP reader for EPUB files.
 *
 * An EPUB is a ZIP archive, and the books page only needs to read a few dozen
 * small XHTML entries out of one. Pulling in a general-purpose archive library
 * for that would add a dependency to the marketing site. This reader supports
 * exactly what EPUB packaging uses (stored and deflated entries, no ZIP64, no
 * encryption) and refuses everything else, and it treats the archive as
 * untrusted: every offset is bounds-checked, every entry has a size ceiling,
 * inflation is capped, and CRC-32 is verified.
 */

const END_OF_CENTRAL_DIRECTORY_SIGNATURE: number = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE: number = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE: number = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIZE: number = 22;
const CENTRAL_DIRECTORY_HEADER_SIZE: number = 46;
const LOCAL_FILE_HEADER_SIZE: number = 30;
const MAX_COMMENT_LENGTH: number = 0xffff;

const COMPRESSION_STORED: number = 0;
const COMPRESSION_DEFLATE: number = 8;
const FLAG_ENCRYPTED: number = 0x1;

export interface ZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 8 * 1024 * 1024,
};

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  flags: number;
}

export class ZipError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

let crcTable: Uint32Array | null = null;

const getCrcTable: () => Uint32Array = (): Uint32Array => {
  if (crcTable) {
    return crcTable;
  }

  const table: Uint32Array = new Uint32Array(256);

  for (let index: number = 0; index < 256; index++) {
    let value: number = index;

    for (let bit: number = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  crcTable = table;
  return table;
};

export const crc32: (data: Uint8Array) => number = (
  data: Uint8Array,
): number => {
  const table: Uint32Array = getCrcTable();
  let crc: number = 0xffffffff;

  for (let index: number = 0; index < data.length; index++) {
    crc = table[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

/*
 * Entry names are only used as lookup keys, never as file-system paths, but
 * normalising them keeps lookups predictable: forward slashes, no leading
 * slash, and no "." or ".." segments.
 */
export const normalizeZipPath: (path: string) => string | null = (
  path: string,
): string | null => {
  const segments: Array<string> = [];

  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
};

export default class ZipArchive {
  private readonly buffer: Buffer;
  private readonly limits: ZipLimits;
  private readonly entries: Map<string, ZipEntry>;

  public constructor(buffer: Buffer, limits: Partial<ZipLimits> = {}) {
    this.buffer = buffer;
    this.limits = { ...DEFAULT_ZIP_LIMITS, ...limits };

    if (buffer.length > this.limits.maxArchiveBytes) {
      throw new ZipError(
        `Archive is ${buffer.length} bytes, above the ${this.limits.maxArchiveBytes} byte limit.`,
      );
    }

    this.entries = this.readCentralDirectory();
  }

  public list(): Array<ZipEntry> {
    return [...this.entries.values()];
  }

  public has(name: string): boolean {
    const normalized: string | null = normalizeZipPath(name);
    return normalized !== null && this.entries.has(normalized);
  }

  public read(name: string): Buffer | null {
    const normalized: string | null = normalizeZipPath(name);
    const entry: ZipEntry | undefined =
      normalized === null ? undefined : this.entries.get(normalized);

    if (!entry) {
      return null;
    }

    return this.extract(entry);
  }

  public readText(name: string): string | null {
    const data: Buffer | null = this.read(name);

    if (!data) {
      return null;
    }

    const text: string = data.toString("utf-8");

    // Strip a UTF-8 byte order mark, which some EPUB tools emit.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  private findEndOfCentralDirectory(): number {
    const buffer: Buffer = this.buffer;
    const lowestStart: number = Math.max(
      0,
      buffer.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_COMMENT_LENGTH,
    );

    for (
      let offset: number = buffer.length - END_OF_CENTRAL_DIRECTORY_SIZE;
      offset >= lowestStart;
      offset--
    ) {
      if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        return offset;
      }
    }

    throw new ZipError("Not a ZIP archive: no end of central directory.");
  }

  private readCentralDirectory(): Map<string, ZipEntry> {
    const buffer: Buffer = this.buffer;

    if (buffer.length < END_OF_CENTRAL_DIRECTORY_SIZE) {
      throw new ZipError("Not a ZIP archive: too short.");
    }

    const endOffset: number = this.findEndOfCentralDirectory();
    const diskNumber: number = buffer.readUInt16LE(endOffset + 4);
    const entryCount: number = buffer.readUInt16LE(endOffset + 10);
    const directorySize: number = buffer.readUInt32LE(endOffset + 12);
    const directoryOffset: number = buffer.readUInt32LE(endOffset + 16);

    if (diskNumber !== 0) {
      throw new ZipError("Multi-disk ZIP archives are not supported.");
    }

    if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
      throw new ZipError("ZIP64 archives are not supported.");
    }

    if (entryCount > this.limits.maxEntries) {
      throw new ZipError(
        `Archive has ${entryCount} entries, above the ${this.limits.maxEntries} entry limit.`,
      );
    }

    if (directoryOffset + directorySize > endOffset) {
      throw new ZipError("Central directory lies outside the archive.");
    }

    const entries: Map<string, ZipEntry> = new Map<string, ZipEntry>();
    let offset: number = directoryOffset;

    for (let index: number = 0; index < entryCount; index++) {
      if (offset + CENTRAL_DIRECTORY_HEADER_SIZE > endOffset) {
        throw new ZipError("Central directory is truncated.");
      }

      if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new ZipError("Central directory entry has a bad signature.");
      }

      const flags: number = buffer.readUInt16LE(offset + 8);
      const compressionMethod: number = buffer.readUInt16LE(offset + 10);
      const crc: number = buffer.readUInt32LE(offset + 16);
      const compressedSize: number = buffer.readUInt32LE(offset + 20);
      const uncompressedSize: number = buffer.readUInt32LE(offset + 24);
      const nameLength: number = buffer.readUInt16LE(offset + 28);
      const extraLength: number = buffer.readUInt16LE(offset + 30);
      const commentLength: number = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset: number = buffer.readUInt32LE(offset + 42);
      const nameStart: number = offset + CENTRAL_DIRECTORY_HEADER_SIZE;
      const nextOffset: number =
        nameStart + nameLength + extraLength + commentLength;

      if (nextOffset > endOffset) {
        throw new ZipError("Central directory entry is truncated.");
      }

      const rawName: string = buffer.toString(
        "utf-8",
        nameStart,
        nameStart + nameLength,
      );
      const name: string | null = normalizeZipPath(rawName);

      // Directories carry no data; entries that escape the root are ignored.
      if (name && !rawName.endsWith("/") && !entries.has(name)) {
        entries.set(name, {
          name,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          crc32: crc,
          localHeaderOffset,
          flags,
        });
      }

      offset = nextOffset;
    }

    return entries;
  }

  private extract(entry: ZipEntry): Buffer {
    const buffer: Buffer = this.buffer;

    if (entry.flags & FLAG_ENCRYPTED) {
      throw new ZipError(`Entry "${entry.name}" is encrypted.`);
    }

    if (entry.uncompressedSize > this.limits.maxEntryBytes) {
      throw new ZipError(
        `Entry "${entry.name}" is ${entry.uncompressedSize} bytes, above the ${this.limits.maxEntryBytes} byte limit.`,
      );
    }

    const headerOffset: number = entry.localHeaderOffset;

    if (headerOffset + LOCAL_FILE_HEADER_SIZE > buffer.length) {
      throw new ZipError(`Entry "${entry.name}" has no local header.`);
    }

    if (buffer.readUInt32LE(headerOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new ZipError(`Entry "${entry.name}" has a bad local header.`);
    }

    const nameLength: number = buffer.readUInt16LE(headerOffset + 26);
    const extraLength: number = buffer.readUInt16LE(headerOffset + 28);
    const dataStart: number =
      headerOffset + LOCAL_FILE_HEADER_SIZE + nameLength + extraLength;
    const dataEnd: number = dataStart + entry.compressedSize;

    if (dataEnd > buffer.length) {
      throw new ZipError(`Entry "${entry.name}" is truncated.`);
    }

    const compressed: Buffer = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;

    if (entry.compressionMethod === COMPRESSION_STORED) {
      data = Buffer.from(compressed);
    } else if (entry.compressionMethod === COMPRESSION_DEFLATE) {
      try {
        data = zlib.inflateRawSync(compressed, {
          // One byte of headroom lets an understated size be detected below.
          maxOutputLength: entry.uncompressedSize + 1,
        });
      } catch {
        throw new ZipError(`Entry "${entry.name}" could not be inflated.`);
      }
    } else {
      throw new ZipError(
        `Entry "${entry.name}" uses unsupported compression method ${entry.compressionMethod}.`,
      );
    }

    if (data.length !== entry.uncompressedSize) {
      throw new ZipError(`Entry "${entry.name}" has the wrong size.`);
    }

    if (crc32(data) !== entry.crc32) {
      throw new ZipError(`Entry "${entry.name}" failed its CRC-32 check.`);
    }

    return data;
  }
}
