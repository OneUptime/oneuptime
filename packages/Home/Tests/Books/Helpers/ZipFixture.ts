import zlib from "zlib";
import { crc32 } from "../../../Utils/Books/Zip";

/*
 * Builds ZIP archives byte by byte for the book tests, including deliberately
 * broken ones: every field the reader validates can be overridden.
 */

export interface ZipFixtureEntry {
  name: string;
  data: string | Buffer;
  method?: "store" | "deflate";
  // Overrides, to produce archives that lie about their contents.
  crc32?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  compressionMethod?: number;
  flags?: number;
  localSignature?: number;
  localHeaderOffset?: number;
}

export interface ZipFixtureOptions {
  comment?: string;
  entryCount?: number;
  diskNumber?: number;
  centralDirectoryOffset?: number;
  centralDirectorySize?: number;
}

const DOS_DATE_1980: number = 0x21;

export const createZip: (
  entries: Array<ZipFixtureEntry>,
  options?: ZipFixtureOptions,
) => Buffer = (
  entries: Array<ZipFixtureEntry>,
  options: ZipFixtureOptions = {},
): Buffer => {
  const localParts: Array<Buffer> = [];
  const centralParts: Array<Buffer> = [];
  let offset: number = 0;

  for (const entry of entries) {
    const data: Buffer = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf-8");
    const method: number =
      entry.compressionMethod ?? (entry.method === "store" ? 0 : 8);
    const compressed: Buffer =
      entry.method === "store" ? data : zlib.deflateRawSync(data);
    const name: Buffer = Buffer.from(entry.name, "utf-8");
    const checksum: number = entry.crc32 ?? crc32(data);
    const compressedSize: number = entry.compressedSize ?? compressed.length;
    const uncompressedSize: number = entry.uncompressedSize ?? data.length;
    const flags: number = entry.flags ?? 0;

    const local: Buffer = Buffer.alloc(30);
    local.writeUInt32LE(entry.localSignature ?? 0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central: Buffer = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.localHeaderOffset ?? offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory: Buffer = Buffer.concat(centralParts);
  const comment: Buffer = Buffer.from(options.comment || "", "utf-8");
  const end: Buffer = Buffer.alloc(22);
  const count: number = options.entryCount ?? entries.length;

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.diskNumber ?? 0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(
    options.centralDirectorySize ?? centralDirectory.length,
    12,
  );
  end.writeUInt32LE(options.centralDirectoryOffset ?? offset, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...localParts, centralDirectory, end, comment]);
};
