import fs from "fs";
import Path from "path";
import { AppleSymbolFile } from "../../../../Utils/Telemetry/AppleSymbols";
import { isMachOFile, readMachOSymbolFiles } from "./MachOSymbols";
import { ZipReadOptions, readZipEntries } from "./ZipArchive";

/*
 * THE SYMBOLS OF A TEAM'S dSYMs, WHEREVER THEY KEEP THEM (#9922).
 *
 * A dSYM is a bundle, MyApp.app.dSYM, whose Contents/Resources/DWARF folder
 * holds one Mach-O file named for its binary. Teams have bundles on disk (a
 * build folder, Xcode's archives), zips of them (an Xcode archive, App Store
 * Connect's "Download dSYMs", a CI artifact), or the DWARF file itself. This
 * finds the DWARF files in any of those and reads each with MachOSymbols. A
 * UUID found twice - one bundle zipped twice - is kept once.
 */

// Where a bundle keeps its DWARF file.
const DWARF_FOLDER: string = ".dSYM/Contents/Resources/DWARF/";

export interface DsymWalkLimits {
  // How many folders below the one given a walk goes.
  maxDepth: number;
  // The most files and folders a walk looks at.
  maxEntries: number;
}

export const DSYM_WALK_LIMITS: DsymWalkLimits = {
  maxDepth: 12,
  maxEntries: 100_000,
};

// Enough of a file to tell a zip and a Mach-O file from anything else.
const MAGIC_BYTES: number = 8;

// One fs.readSync reads at most about 2 GiB; a DWARF file can be larger.
const READ_CHUNK_BYTES: number = 1024 * 1024 * 1024;

// Whether the bytes start like a zip archive (an empty one too).
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

// Whether the bytes start like a Mach-O file: thin, either byte order, or universal.
export function isMachO(bytes: Uint8Array): boolean {
  return isMachOFile(bytes);
}

function toForwardSlashes(path: string): string {
  return path.split("\\").join("/");
}

// "MyApp" for "MyApp.app.dSYM/Contents/Resources/DWARF/MyApp".
function getLastSegment(path: string): string {
  const segments: Array<string> = toForwardSlashes(path)
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  return segments[segments.length - 1] || path;
}

/*
 * Whether a path is a bundle's DWARF file: directly in
 * <name>.dSYM/Contents/Resources/DWARF/, not hidden (the "._" files and
 * .DS_Store macOS leaves) and not under a zip's __MACOSX folder.
 */
function isDwarfPath(path: string): boolean {
  const normalized: string = toForwardSlashes(path);

  if (normalized.startsWith("__MACOSX/") || normalized.includes("/__MACOSX/")) {
    return false;
  }

  const folder: number = normalized.lastIndexOf(DWARF_FOLDER);

  if (folder <= 0 || normalized[folder - 1] === "/") {
    return false;
  }

  const fileName: string = normalized.slice(folder + DWARF_FOLDER.length);

  return (
    fileName.length > 0 && !fileName.includes("/") && !fileName.startsWith(".")
  );
}

function keepFirstOfEachUuid(
  files: Array<AppleSymbolFile>,
): Array<AppleSymbolFile> {
  const seen: Set<string> = new Set<string>();

  return files.filter((file: AppleSymbolFile): boolean => {
    if (seen.has(file.debugId)) {
      return false;
    }

    seen.add(file.debugId);

    return true;
  });
}

/*
 * The symbol files of a zip of dSYM bundles, or of one DWARF file. Throws
 * when the bytes are neither, and when a DWARF file in them cannot be read.
 * `zipLimits` bound what a zip may inflate to: the server, which reads
 * what anyone with a key sends, holds an upload to far less than the CLI
 * holds a team's own files.
 */
export function readDsymSymbolFilesFromBytes(
  bytes: Uint8Array,
  fileName: string,
  zipLimits: ZipReadOptions = {},
): Array<AppleSymbolFile> {
  if (isZip(bytes)) {
    const files: Array<AppleSymbolFile> = [];

    for (const entry of readZipEntries(bytes, zipLimits)) {
      if (isDwarfPath(entry.name)) {
        files.push(
          ...readMachOSymbolFiles(entry.read(), getLastSegment(entry.name)),
        );
      }
    }

    return keepFirstOfEachUuid(files);
  }

  if (isMachO(bytes)) {
    return keepFirstOfEachUuid(
      readMachOSymbolFiles(bytes, getLastSegment(fileName)),
    );
  }

  throw new Error(
    `${fileName} is neither a dSYM's DWARF file nor a zip of dSYMs.`,
  );
}

/*
 * The symbol files at a path, for the CLI: a folder is searched for dSYM
 * bundles (it may be one), a file is read as a zip of dSYMs or a DWARF
 * file. Throws when the path does not exist, when a file is neither, and
 * when a DWARF file cannot be read.
 */
export function readDsymSymbolFilesFromPath(
  path: string,
): Array<AppleSymbolFile> {
  if (statPath(path).isDirectory()) {
    const files: Array<AppleSymbolFile> = [];

    for (const dwarfFile of findDwarfFiles(path)) {
      files.push(
        ...readMachOSymbolFiles(
          readFileBytes(dwarfFile),
          Path.basename(dwarfFile),
        ),
      );
    }

    return keepFirstOfEachUuid(files);
  }

  // Told apart by their first bytes, so a large file of anything else is never read whole.
  const start: Uint8Array = readFileStart(path, MAGIC_BYTES);

  if (!isZip(start) && !isMachO(start)) {
    throw new Error(
      `${path} is neither a dSYM's DWARF file nor a zip of dSYMs.`,
    );
  }

  return readDsymSymbolFilesFromBytes(readFileBytes(path), path);
}

/*
 * The DWARF files of the dSYM bundles in a folder (or of the bundle it is),
 * as absolute paths, in name order. Folders more than maxDepth below it are
 * not looked in, symbolic links to folders are not followed, and a folder
 * holding more than maxEntries files and folders is refused.
 */
export function findDwarfFiles(
  directory: string,
  limits: DsymWalkLimits = DSYM_WALK_LIMITS,
): Array<string> {
  const root: string = Path.resolve(directory);
  const found: Array<string> = [];
  let seen: number = 0;

  const walk: (folder: string, depth: number) => void = (
    folder: string,
    depth: number,
  ): void => {
    let entries: Array<fs.Dirent>;

    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch (error: unknown) {
      // A folder below the one given that cannot be read is passed over.
      if (folder === root) {
        throw error;
      }

      return;
    }

    entries.sort((a: fs.Dirent, b: fs.Dirent): number => {
      if (a.name === b.name) {
        return 0;
      }

      return a.name < b.name ? -1 : 1;
    });

    for (const entry of entries) {
      seen++;

      if (seen > limits.maxEntries) {
        throw new Error(
          `${directory} holds more than ${limits.maxEntries} files and folders: point at a folder of dSYMs, an Xcode archive or a zip of dSYMs instead.`,
        );
      }

      const path: string = Path.join(folder, entry.name);

      if (entry.isDirectory()) {
        if (depth < limits.maxDepth) {
          walk(path, depth + 1);
        }

        continue;
      }

      if (isDwarfPath(path) && (entry.isFile() || isLinkToFile(entry, path))) {
        found.push(path);
      }
    }
  };

  walk(root, 0);

  return found;
}

function isLinkToFile(entry: fs.Dirent, path: string): boolean {
  if (!entry.isSymbolicLink()) {
    return false;
  }

  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

function statPath(path: string): fs.Stats {
  try {
    return fs.statSync(path);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new Error(`${path} does not exist.`);
    }

    throw error;
  }
}

function readFileStart(path: string, length: number): Uint8Array {
  const descriptor: number = fs.openSync(path, "r");

  try {
    const bytes: Buffer = Buffer.alloc(length);

    return bytes.subarray(0, fs.readSync(descriptor, bytes, 0, length, 0));
  } finally {
    fs.closeSync(descriptor);
  }
}

// A whole file, in parts: fs.readFileSync refuses files over 2 GiB.
function readFileBytes(path: string): Uint8Array {
  const descriptor: number = fs.openSync(path, "r");

  try {
    const size: number = fs.fstatSync(descriptor).size;
    const bytes: Buffer = Buffer.allocUnsafe(size);
    let filled: number = 0;

    while (filled < size) {
      const read: number = fs.readSync(
        descriptor,
        bytes,
        filled,
        Math.min(READ_CHUNK_BYTES, size - filled),
        filled,
      );

      if (read === 0) {
        break;
      }

      filled += read;
    }

    return bytes.subarray(0, filled);
  } finally {
    fs.closeSync(descriptor);
  }
}
