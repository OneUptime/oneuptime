import { isUtf8 } from "buffer";
import zlib from "zlib";

/*
 * THE FILES OF A ZIP ARCHIVE, READ ONE AT A TIME (#9922).
 *
 * Teams ship dSYMs zipped: an Xcode archive's dSYMs folder, App Store
 * Connect's "Download dSYMs", a CI artifact. This lists an archive's files
 * from its central directory (ZIP64 too) and reads each only when asked:
 * stored or deflated, its size and checksum checked.
 *
 * The archive is not trusted. Every offset is checked against the bytes
 * given before it is read; an entry is refused when it says, or turns out,
 * to be larger than maxEntryBytes - zlib is told to stop there, so a
 * deflate bomb never inflates past it - and reads stop once they add up
 * to maxTotalBytes.
 */

export interface ZipEntry {
  // The entry's path in the archive: "MyApp.app.dSYM/Contents/Info.plist".
  name: string;
  // The size the archive gives for the entry's uncompressed bytes.
  uncompressedSize: number;
  /*
   * The entry's bytes, read and checked on each call. A stored entry's are a
   * view into the archive's bytes. Throws when the entry cannot be read, or
   * would pass a limit.
   */
  read: () => Uint8Array;
}

export interface ZipReadOptions {
  // The most bytes one entry may hold uncompressed: 512 MiB unless given.
  maxEntryBytes?: number;
  // The most bytes all reads together may return: 2 GiB unless given.
  maxTotalBytes?: number;
}

export const DEFAULT_MAX_ZIP_ENTRY_BYTES: number = 512 * 1024 * 1024;
export const DEFAULT_MAX_ZIP_TOTAL_BYTES: number = 2 * 1024 * 1024 * 1024;

// The most entries an archive may list.
export const MAX_ZIP_ENTRIES: number = 1_000_000;

const END_SIGNATURE: number = 0x06054b50;
const END_LENGTH: number = 22;
const MAX_COMMENT_LENGTH: number = 65_535;
const ZIP64_LOCATOR_SIGNATURE: number = 0x07064b50;
const ZIP64_LOCATOR_LENGTH: number = 20;
const ZIP64_END_SIGNATURE: number = 0x06064b50;
const ZIP64_END_LENGTH: number = 56;
const CENTRAL_SIGNATURE: number = 0x02014b50;
const CENTRAL_LENGTH: number = 46;
const LOCAL_SIGNATURE: number = 0x04034b50;
const LOCAL_LENGTH: number = 30;
const ZIP64_EXTRA_FIELD: number = 0x0001;
const ZIP64_MARKER: number = 0xffffffff;

const FLAG_ENCRYPTED: number = 0x0001;
const FLAG_UTF8_NAME: number = 0x0800;

const METHOD_STORED: number = 0;
const METHOD_DEFLATED: number = 8;

const TWO_TO_THE_32: number = 4294967296;

interface ZipLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

// What the reads of one archive have returned so far.
interface ReadTally {
  totalBytes: number;
}

interface EntryRecord {
  bytes: Uint8Array;
  view: DataView;
  limits: ZipLimits;
  tally: ReadTally;
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface Zip64Sizes {
  uncompressedSize: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function corrupt(what: string): Error {
  return new Error(`This zip file is corrupt: ${what}.`);
}

/*
 * A 64-bit value as a number: exact to 2^53, and past it still larger than
 * any buffer, which is all an offset or a size needs.
 */
function readUInt64(view: DataView, offset: number): number {
  return (
    view.getUint32(offset + 4, true) * TWO_TO_THE_32 +
    view.getUint32(offset, true)
  );
}

function getLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/*
 * The files an archive lists, in its order, directories left out. Nothing
 * is inflated until an entry's read() is called. Throws when the bytes are
 * not a zip file, or its central directory is cut short or corrupt.
 */
export function readZipEntries(
  bytes: Uint8Array,
  options: ZipReadOptions = {},
): Array<ZipEntry> {
  const view: DataView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const end: number = findEndOfCentralDirectory(bytes, view);

  if (end < 0) {
    throw new Error("This file is not a zip file.");
  }

  let entryCount: number = view.getUint16(end + 10, true);
  let directorySize: number = view.getUint32(end + 12, true);
  let directoryOffset: number = view.getUint32(end + 16, true);
  // Where the central directory must end: at the record that describes it.
  let directoryLimit: number = end;
  const locator: number = end - ZIP64_LOCATOR_LENGTH;

  if (
    locator >= 0 &&
    view.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE
  ) {
    const zip64End: number = readUInt64(view, locator + 8);

    if (
      zip64End + ZIP64_END_LENGTH > locator ||
      view.getUint32(zip64End, true) !== ZIP64_END_SIGNATURE
    ) {
      throw corrupt("its ZIP64 end of central directory record is missing");
    }

    entryCount = readUInt64(view, zip64End + 32);
    directorySize = readUInt64(view, zip64End + 40);
    directoryOffset = readUInt64(view, zip64End + 48);
    directoryLimit = zip64End;
  }

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(
      `This zip file lists ${entryCount} entries, more than the ${MAX_ZIP_ENTRIES} OneUptime reads.`,
    );
  }

  if (directoryOffset + directorySize > directoryLimit) {
    throw corrupt("its central directory runs past where it should end");
  }

  const limits: ZipLimits = {
    maxEntryBytes: getLimit(options.maxEntryBytes, DEFAULT_MAX_ZIP_ENTRY_BYTES),
    maxTotalBytes: getLimit(options.maxTotalBytes, DEFAULT_MAX_ZIP_TOTAL_BYTES),
  };
  const tally: ReadTally = { totalBytes: 0 };
  const directoryEnd: number = directoryOffset + directorySize;
  const entries: Array<ZipEntry> = [];
  let offset: number = directoryOffset;

  for (let index: number = 0; index < entryCount; index++) {
    const header: number = offset;
    const place: string = `entry ${index + 1} of its ${entryCount}`;

    if (
      header + CENTRAL_LENGTH > directoryEnd ||
      view.getUint32(header, true) !== CENTRAL_SIGNATURE
    ) {
      throw corrupt(`${place} is missing from its central directory`);
    }

    const flags: number = view.getUint16(header + 8, true);
    const nameStart: number = header + CENTRAL_LENGTH;
    const extraStart: number = nameStart + view.getUint16(header + 28, true);
    const extraEnd: number = extraStart + view.getUint16(header + 30, true);

    offset = extraEnd + view.getUint16(header + 32, true);

    if (offset > directoryEnd) {
      throw corrupt(`${place} runs past the end of its central directory`);
    }

    const name: string = decodeName(
      bytes.subarray(nameStart, extraStart),
      flags,
    );
    const sizes: Zip64Sizes | null = readSizes({
      view,
      header,
      extraStart,
      extraEnd,
    });

    if (!sizes) {
      throw corrupt(`${name} is missing the ZIP64 sizes its entry needs`);
    }

    if (name.endsWith("/")) {
      continue;
    }

    entries.push(
      createEntry({
        bytes,
        view,
        limits,
        tally,
        name,
        flags,
        method: view.getUint16(header + 10, true),
        crc: view.getUint32(header + 16, true),
        compressedSize: sizes.compressedSize,
        uncompressedSize: sizes.uncompressedSize,
        localHeaderOffset: sizes.localHeaderOffset,
      }),
    );
  }

  return entries;
}

/*
 * The end of central directory record: the last one in the final 65,557
 * bytes (the record and the longest comment), preferring one whose comment
 * ends where the bytes do. -1 when there is none.
 */
function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const last: number = bytes.length - END_LENGTH;
  const first: number = Math.max(0, last - MAX_COMMENT_LENGTH);
  let fitting: number = -1;

  for (let offset: number = last; offset >= first; offset--) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      view.getUint32(offset, true) !== END_SIGNATURE
    ) {
      continue;
    }

    const commentEnd: number =
      offset + END_LENGTH + view.getUint16(offset + 20, true);

    if (commentEnd === bytes.length) {
      return offset;
    }

    if (commentEnd < bytes.length && fitting < 0) {
      fitting = offset;
    }
  }

  return fitting;
}

// Names are UTF-8 when flagged so, or when they read as UTF-8 (macOS's zip).
function decodeName(name: Uint8Array, flags: number): string {
  const text: Buffer = Buffer.from(
    name.buffer,
    name.byteOffset,
    name.byteLength,
  );

  return (flags & FLAG_UTF8_NAME) !== 0 || isUtf8(text)
    ? text.toString("utf8")
    : text.toString("latin1");
}

/*
 * A central directory entry's sizes and local header offset, from its ZIP64
 * extra field (0x0001) where the entry says 0xffffffff. Null when one it
 * needs is not there.
 */
function readSizes(data: {
  view: DataView;
  header: number;
  extraStart: number;
  extraEnd: number;
}): Zip64Sizes | null {
  const view: DataView = data.view;
  const sizes: Zip64Sizes = {
    compressedSize: view.getUint32(data.header + 20, true),
    uncompressedSize: view.getUint32(data.header + 24, true),
    localHeaderOffset: view.getUint32(data.header + 42, true),
  };
  const needsUncompressed: boolean = sizes.uncompressedSize === ZIP64_MARKER;
  const needsCompressed: boolean = sizes.compressedSize === ZIP64_MARKER;
  const needsOffset: boolean = sizes.localHeaderOffset === ZIP64_MARKER;

  if (!needsUncompressed && !needsCompressed && !needsOffset) {
    return sizes;
  }

  let field: number = data.extraStart;

  while (field + 4 <= data.extraEnd) {
    const id: number = view.getUint16(field, true);
    const fieldEnd: number = field + 4 + view.getUint16(field + 2, true);

    if (fieldEnd > data.extraEnd) {
      return null;
    }

    if (id === ZIP64_EXTRA_FIELD) {
      // The values the entry marks, in this order, and only those.
      let value: number = field + 4;

      if (needsUncompressed) {
        if (value + 8 > fieldEnd) {
          return null;
        }
        sizes.uncompressedSize = readUInt64(view, value);
        value += 8;
      }

      if (needsCompressed) {
        if (value + 8 > fieldEnd) {
          return null;
        }
        sizes.compressedSize = readUInt64(view, value);
        value += 8;
      }

      if (needsOffset) {
        if (value + 8 > fieldEnd) {
          return null;
        }
        sizes.localHeaderOffset = readUInt64(view, value);
      }

      return sizes;
    }

    field = fieldEnd;
  }

  return null;
}

function createEntry(record: EntryRecord): ZipEntry {
  return {
    name: record.name,
    uncompressedSize: record.uncompressedSize,
    read: (): Uint8Array => {
      return readEntry(record);
    },
  };
}

function readEntry(entry: EntryRecord): Uint8Array {
  const name: string = entry.name;
  const limits: ZipLimits = entry.limits;

  if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
    throw new Error(
      `${name} is encrypted; OneUptime reads only zip files without a password.`,
    );
  }

  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
    throw new Error(
      `${name} is compressed with method ${entry.method}; OneUptime reads only stored and deflated zip entries.`,
    );
  }

  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new Error(
      `${name} is ${entry.uncompressedSize} bytes uncompressed, more than the ${limits.maxEntryBytes} OneUptime reads from one zip entry.`,
    );
  }

  if (entry.tally.totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
    throw new Error(
      `${name} would take this zip file past ${limits.maxTotalBytes} bytes uncompressed, more than OneUptime reads from one zip file.`,
    );
  }

  const bytes: Uint8Array = entry.bytes;
  const view: DataView = entry.view;
  const header: number = entry.localHeaderOffset;

  if (
    header + LOCAL_LENGTH > bytes.length ||
    view.getUint32(header, true) !== LOCAL_SIGNATURE
  ) {
    throw corrupt(`${name} has no local header`);
  }

  const dataStart: number =
    header +
    LOCAL_LENGTH +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true);

  if (dataStart + entry.compressedSize > bytes.length) {
    throw new Error(
      `This zip file is truncated: ${name} runs past the end of the file.`,
    );
  }

  const compressed: Uint8Array = bytes.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );
  let data: Uint8Array;

  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw corrupt(
        `${name} is stored as ${entry.compressedSize} bytes but says it holds ${entry.uncompressedSize}`,
      );
    }

    data = compressed;
  } else {
    data = inflate(compressed, name, entry.uncompressedSize);
  }

  if (zlib.crc32(data) >>> 0 !== entry.crc) {
    throw corrupt(`${name}'s checksum does not match its bytes`);
  }

  entry.tally.totalBytes += data.length;

  return data;
}

/*
 * Inflates to exactly the size the entry gives: zlib stops as soon as the
 * output would be larger, so a deflate bomb costs no more than that.
 */
function inflate(compressed: Uint8Array, name: string, size: number): Buffer {
  let data: Buffer;

  try {
    data = zlib.inflateRawSync(compressed, {
      maxOutputLength: Math.max(1, size),
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new Error(
        `${name} inflates past the ${size} bytes it says it holds: the zip file is corrupt or a zip bomb.`,
      );
    }

    throw corrupt(`${name} cannot be inflated`);
  }

  if (data.length !== size) {
    throw corrupt(
      `${name} inflates to ${data.length} bytes, not the ${size} it says it holds`,
    );
  }

  return data;
}
