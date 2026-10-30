import zlib from "zlib";
import DataConfidence, {
  isConfidentEnough,
} from "../../../../Types/DataSecurity/DataConfidence";
import BUILT_IN_DETECTORS from "../../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
  FieldClassifierOptions,
  MAX_FIELD_VALUES,
  toScannableValue,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import { CollectedField } from "../../../../Utils/DataSecurity/FieldCollector";
import { getHintedDataTypeIds } from "../../../../Utils/DataSecurity/FieldNameHints";
import { DataTypeTally } from "../../../../Utils/DataSecurity/FindingTally";
import {
  getObjectExtension,
  isGzipName,
} from "../../../../Utils/DataSecurity/PathPattern";
import {
  findSensitiveValues,
  MAX_SCANNED_TEXT_LENGTH,
  ScanDetector,
  TextMatch,
  TextScanOptions,
} from "../../../../Utils/DataSecurity/TextScanner";
import {
  ContentScanOptions,
  DataStoreLocationKind,
  LocationFindings,
} from "../DataSecurityScanTypes";
import { FingerprintAccumulator } from "../Fingerprint";
import { findPlaintextPasswordFields } from "../PasswordHashes";
import {
  getOfficeKind,
  OfficeKind,
  OfficeTable,
  OfficeText,
  readPresentation,
  readWordDocument,
  readWorkbook,
} from "./OfficeDocuments";
import {
  markupToText,
  readDelimited,
  readJson,
  readJsonLines,
  readKeyValue,
  readYaml,
  StructuredRead,
} from "./TextReaders";
import ZipReader, {
  decompressPrefix,
  isBufferTooLargeError,
  ZipError,
} from "./ZipReader";

/*
 * WHAT ONE OBJECT HOLDS: ITS FORMAT, ITS FIELDS, THE SENSITIVE DATA IN THEM.
 *
 * Given an object's name and its first bytes, this decides what the bytes
 * are and reads them that way:
 *
 *  - gzip (by its magic number, whatever the name) is inflated first,
 *    within MAX_DECOMPRESSED_BYTES;
 *  - DOCX, XLSX and PPTX are opened as the ZIP archives they are
 *    (ZipReader, OfficeDocuments);
 *  - images, Parquet, Avro, PDF and other binary formats - and anything
 *    with NUL bytes in it - are not read, and say so in a warning:
 *    "not scanned: Parquet is not supported yet";
 *  - text is decoded as UTF-8 (UTF-16 with a byte order mark), at most
 *    MAX_SCANNED_TEXT_LENGTH characters of it, and read by its extension or,
 *    without one, by how it starts: CSV and TSV by column, JSON and JSON
 *    lines by path, .env / .ini / .properties / TOML by key, YAML by key,
 *    XML and HTML as their text, keys and certificates (.pem, .key) and
 *    everything else - logs, notes - as free text.
 *
 * Structured data is classified field by field (FieldClassifier), so a
 * location is a field's path ("customers[].email", "Sheet1.SSN"); free
 * text is classified as a whole, its lines counted as records, and its
 * location is "" - the caller names the object. Every High match feeds
 * the scan's fingerprints; fields named for passwords are checked for
 * passwords kept as they are (PasswordHashes).
 *
 * Nothing here runs a regular expression over the text itself: the
 * engine's detectors read it in bounded windows (TextScanner), and the
 * readers walk it with loops and indexOf.
 */

export enum ContentFormat {
  Empty = "Empty",
  Csv = "CSV",
  Tsv = "TSV",
  Json = "JSON",
  JsonLines = "JSON lines",
  KeyValue = "Key-value",
  Yaml = "YAML",
  Xml = "XML",
  Html = "HTML",
  Word = "DOCX",
  Excel = "XLSX",
  PowerPoint = "PPTX",
  KeyFile = "Key file",
  Text = "Text",
  Unsupported = "Unsupported",
}

// The most bytes a compressed object is inflated to.
export const MAX_DECOMPRESSED_BYTES: number = 8 * 1024 * 1024;

// The most characters of text read from one object.
export const MAX_TEXT_LENGTH: number = MAX_SCANNED_TEXT_LENGTH;

// A text with more U+FFFD than this share of its characters is not text.
const MAX_REPLACEMENT_SHARE: number = 0.1;

const CSV_EXTENSIONS: ReadonlySet<string> = new Set(["csv"]);
const TSV_EXTENSIONS: ReadonlySet<string> = new Set(["tsv", "tab"]);
const JSON_EXTENSIONS: ReadonlySet<string> = new Set([
  "json",
  "geojson",
  "har",
  "ipynb",
  "webmanifest",
]);
const JSON_LINES_EXTENSIONS: ReadonlySet<string> = new Set([
  "ndjson",
  "jsonl",
  "ldjson",
  "jsonlines",
]);
const KEY_VALUE_EXTENSIONS: ReadonlySet<string> = new Set([
  "env",
  "ini",
  "cfg",
  "conf",
  "cnf",
  "properties",
  "toml",
]);
const YAML_EXTENSIONS: ReadonlySet<string> = new Set(["yaml", "yml"]);
const XML_EXTENSIONS: ReadonlySet<string> = new Set([
  "xml",
  "svg",
  "rss",
  "atom",
  "plist",
  "xsd",
  "wsdl",
]);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(["html", "htm", "xhtml"]);

// Text that is only text, never sniffed: "[2026-10-27] ..." is a log line.
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "log",
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "out",
  "err",
  "trace",
]);

// Keys and certificates, read as text: a private key block is a finding.
const KEY_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "pem",
  "key",
  "crt",
  "cer",
  "csr",
  "pub",
  "ppk",
  "asc",
  "p8",
]);

// Key stores in binary: a private key container, found by its name.
const KEY_STORE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["p12", "PKCS #12 key store"],
  ["pfx", "PKCS #12 key store"],
  ["jks", "Java key store"],
  ["keystore", "Java key store"],
  ["bks", "Bouncy Castle key store"],
]);

// Names that are key-value files whatever their extension.
const KEY_VALUE_NAMES: ReadonlySet<string> = new Set([
  "credentials",
  ".npmrc",
  ".pypirc",
  ".pgpass",
  ".my.cnf",
  ".s3cfg",
]);

interface BinarySignature {
  format: string;
  bytes: ReadonlyArray<number>;
  offset?: number;
}

// The magic numbers of formats that are not text.
const BINARY_SIGNATURES: ReadonlyArray<BinarySignature> = [
  { format: "PNG image", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: "JPEG image", bytes: [0xff, 0xd8, 0xff] },
  { format: "GIF image", bytes: [0x47, 0x49, 0x46, 0x38] },
  { format: "WebP image", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { format: "TIFF image", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { format: "TIFF image", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { format: "PDF", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { format: "Parquet", bytes: [0x50, 0x41, 0x52, 0x31] },
  { format: "Avro", bytes: [0x4f, 0x62, 0x6a, 0x01] },
  { format: "ORC", bytes: [0x4f, 0x52, 0x43] },
  { format: "Arrow", bytes: [0x41, 0x52, 0x52, 0x4f, 0x57, 0x31] },
  {
    format: "SQLite database",
    bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66],
  },
  {
    format: "Office 97-2003 document",
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  { format: "bzip2", bytes: [0x42, 0x5a, 0x68] },
  { format: "xz", bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { format: "Zstandard", bytes: [0x28, 0xb5, 0x2f, 0xfd] },
  { format: "7z archive", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { format: "RAR archive", bytes: [0x52, 0x61, 0x72, 0x21] },
  { format: "ELF executable", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { format: "WebAssembly", bytes: [0x00, 0x61, 0x73, 0x6d] },
  { format: "MP4 video", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { format: "Ogg media", bytes: [0x4f, 0x67, 0x67, 0x53] },
  { format: "FLAC audio", bytes: [0x66, 0x4c, 0x61, 0x43] },
  { format: "MP3 audio", bytes: [0x49, 0x44, 0x33] },
  { format: "Java class file", bytes: [0xca, 0xfe, 0xba, 0xbe] },
];

export interface ClassifyContentInput {
  // The object's name: its extension says how it is read.
  name: string;
  // Its first bytes, as read.
  bytes: Uint8Array;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
  // The bytes are the start of a longer object, so its last record is cut.
  isTruncated?: boolean | undefined;
}

export interface ContentClassification {
  format: ContentFormat;
  locations: Array<LocationFindings>;
  // How many records the content holds: rows, lines, documents.
  recordCount: number;
  // How many of them hold a sensitive value, by a confident finding.
  recordsWithSensitive: number;
  // Fields named for passwords whose values are not hashes.
  plaintextPasswordFields: Array<string>;
  warnings: Array<string>;
}

interface ScanSettings {
  fieldOptions: FieldClassifierOptions;
  textOptions: TextScanOptions;
}

const SETTINGS: WeakMap<ContentScanOptions, ScanSettings> = new WeakMap();

/*
 * What the engine is given for a scan's options, made once per scan: the
 * built-in detectors with the project's custom ones after them (the engine
 * runs only the detectors it is given), and what the project turned off or
 * allowed.
 */
function getScanSettings(options: ContentScanOptions): ScanSettings {
  let settings: ScanSettings | undefined = SETTINGS.get(options);

  if (!settings) {
    const detectors: ReadonlyArray<ScanDetector> | undefined =
      options.customDetectors.length > 0
        ? [...BUILT_IN_DETECTORS, ...options.customDetectors]
        : undefined;

    settings = {
      fieldOptions: {
        detectors,
        disabledDataTypeIds: options.disabledDataTypeIds,
        allowedValues: options.allowedValues,
        extraHints: options.extraHints,
      },
      textOptions: {
        detectors,
        disabledDataTypeIds: options.disabledDataTypeIds,
        allowedValues: options.allowedValues,
      },
    };

    SETTINGS.set(options, settings);
  }

  return settings;
}

export function getFieldClassifierOptions(
  options: ContentScanOptions,
): FieldClassifierOptions {
  return getScanSettings(options).fieldOptions;
}

// Whether text holds a value the scan would report with some confidence.
export function holdsSensitiveValue(
  text: string,
  options: ContentScanOptions,
): boolean {
  return findSensitiveValues(
    text.slice(0, MAX_TEXT_LENGTH),
    getScanSettings(options).textOptions,
  ).some((match: TextMatch) => {
    return !match.isTestValue && isConfidentEnough(match.confidence);
  });
}

/*
 * The share of records a confident finding covers, as the number of them:
 * at least one when anything was found at all.
 */
function recordsCovered(records: number, share: number): number {
  if (records <= 0 || share <= 0) {
    return 0;
  }

  return Math.min(records, Math.max(1, Math.round(records * share)));
}

/*
 * FIELDS: classified one at a time.
 */
export interface FieldsClassification {
  locations: Array<LocationFindings>;
  plaintextPasswordFields: Array<string>;
  /*
   * The largest share of one field's values (empty ones included) that a
   * confident, real finding covers: how many records hold sensitive data,
   * at the least.
   */
  sensitiveShare: number;
}

/*
 * The values of a field that holds a type with High confidence, for the
 * fingerprints. A field's confidence is its own evidence - most of its
 * values are that type, and often its name says so - so every real value
 * of the type in it is a High match, though a bare SSN in a cell would be
 * Medium in free text. They are found again with the name hints
 * classifyField used, since it keeps only counts.
 */
function fingerprintField(data: {
  field: CollectedField;
  dataTypeIds: Set<string>;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
}): void {
  const hinted: Set<string> = getHintedDataTypeIds(
    data.field.path,
    data.options.extraHints,
  );

  for (const disabled of data.options.disabledDataTypeIds) {
    hinted.delete(disabled);
  }

  const scanOptions: TextScanOptions = {
    ...getScanSettings(data.options).textOptions,
    hintedDataTypeIds: hinted,
  };

  for (const raw of data.field.values.slice(0, MAX_FIELD_VALUES)) {
    const value: string | null = toScannableValue(raw);

    if (value === null) {
      continue;
    }

    for (const match of findSensitiveValues(value, scanOptions)) {
      if (data.dataTypeIds.has(match.dataTypeId) && !match.isTestValue) {
        data.fingerprints.add(
          match.dataTypeId,
          match.normalized,
          DataConfidence.High,
        );
      }
    }
  }
}

export function classifyCollectedFields(data: {
  fields: Array<CollectedField>;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
  locationKind: DataStoreLocationKind;
}): FieldsClassification {
  const fieldOptions: FieldClassifierOptions = getFieldClassifierOptions(
    data.options,
  );
  const locations: Array<LocationFindings> = [];
  let sensitiveShare: number = 0;

  for (const field of data.fields) {
    if (field.values.length === 0) {
      continue;
    }

    const classifications: Array<FieldClassification> = classifyField(
      field.path,
      field.values,
      fieldOptions,
    );

    if (classifications.length === 0) {
      continue;
    }

    locations.push({
      location: field.path,
      locationKind: data.locationKind,
      classifications,
    });

    const highTypes: Set<string> = new Set();

    for (const classification of classifications) {
      if (classification.matchCount === 0) {
        continue;
      }

      if (isConfidentEnough(classification.confidence)) {
        sensitiveShare = Math.max(
          sensitiveShare,
          Math.min(1, classification.valuesWithMatch / field.values.length),
        );
      }

      if (
        classification.confidence === DataConfidence.High &&
        !classification.foundByName
      ) {
        highTypes.add(classification.dataTypeId);
      }
    }

    if (highTypes.size > 0) {
      fingerprintField({
        field,
        dataTypeIds: highTypes,
        options: data.options,
        fingerprints: data.fingerprints,
      });
    }
  }

  return {
    locations,
    plaintextPasswordFields: findPlaintextPasswordFields(data.fields),
    sensitiveShare,
  };
}

/*
 * FREE TEXT: classified as a whole, its lines the records.
 */
export interface FreeTextClassification {
  classifications: Array<FieldClassification>;
  // Lines that hold anything, and those holding a confident, real finding.
  lines: number;
  linesWithSensitive: number;
}

function countNonEmptyLines(text: string): number {
  let lines: number = 0;
  let hasContent: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === 10) {
      if (hasContent) {
        lines++;
      }

      hasContent = false;
    } else if (code !== 32 && code !== 9 && code !== 13) {
      hasContent = true;
    }
  }

  return hasContent ? lines + 1 : lines;
}

/*
 * The findings of a text with no fields: one per data type, keeping the
 * confidence each match earned on its own (a field's share of matches
 * means nothing in a log), with the lines that held each as its values.
 */
export function classifyFreeText(
  text: string,
  options: ContentScanOptions,
  fingerprints: FingerprintAccumulator,
): FreeTextClassification {
  const bounded: string =
    text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
  const lines: number = countNonEmptyLines(bounded);

  if (lines === 0) {
    return { classifications: [], lines: 0, linesWithSensitive: 0 };
  }

  const matches: Array<TextMatch> = findSensitiveValues(
    bounded,
    getScanSettings(options).textOptions,
  );
  const tallies: Map<string, DataTypeTally> = new Map();
  const lastLineOf: Map<string, number> = new Map();
  const linesOf: Map<string, number> = new Map();
  let line: number = 0;
  let position: number = 0;
  let lastSensitiveLine: number = -1;
  let linesWithSensitive: number = 0;

  for (const match of matches) {
    // The line the match starts on, counted from the last one.
    for (;;) {
      const lineFeed: number = bounded.indexOf("\n", position);

      if (lineFeed < 0 || lineFeed >= match.start) {
        break;
      }

      line++;
      position = lineFeed + 1;
    }

    let tally: DataTypeTally | undefined = tallies.get(match.dataTypeId);

    if (!tally) {
      tally = new DataTypeTally(match.dataTypeId);
      tallies.set(match.dataTypeId, tally);
    }

    tally.add({
      normalized: match.normalized,
      confidence: match.confidence,
      isTestValue: match.isTestValue,
      raw: bounded.slice(match.start, match.end),
    });

    if (match.isTestValue) {
      continue;
    }

    if (lastLineOf.get(match.dataTypeId) !== line) {
      lastLineOf.set(match.dataTypeId, line);
      linesOf.set(match.dataTypeId, (linesOf.get(match.dataTypeId) || 0) + 1);
    }

    fingerprints.addMatch(match);

    if (isConfidentEnough(match.confidence) && lastSensitiveLine !== line) {
      lastSensitiveLine = line;
      linesWithSensitive++;
    }
  }

  const classifications: Array<FieldClassification> = [];

  for (const tally of tallies.values()) {
    const withMatch: number = Math.min(
      lines,
      linesOf.get(tally.dataTypeId) || 0,
    );

    classifications.push({
      ...tally.toJSON(),
      matchRatio: withMatch / lines,
      valueCount: lines,
      valuesWithMatch: withMatch,
      isFreeText: true,
      nameHinted: false,
      foundByName: false,
    });
  }

  return {
    classifications,
    lines,
    linesWithSensitive: Math.min(lines, linesWithSensitive),
  };
}

/*
 * READING THE BYTES.
 */
function emptyClassification(
  format: ContentFormat,
  warnings: Array<string> = [],
): ContentClassification {
  return {
    format,
    locations: [],
    recordCount: 0,
    recordsWithSensitive: 0,
    plaintextPasswordFields: [],
    warnings,
  };
}

function notSupported(format: string): ContentClassification {
  return emptyClassification(ContentFormat.Unsupported, [
    `not scanned: ${format} is not supported yet`,
  ]);
}

function startsWith(
  bytes: Uint8Array,
  signature: ReadonlyArray<number>,
  offset: number = 0,
): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  for (let index: number = 0; index < signature.length; index++) {
    if (bytes[offset + index] !== signature[index]) {
      return false;
    }
  }

  return true;
}

export function isGzipData(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && startsWith(bytes, [0x1f, 0x8b, 0x08]);
}

function isPrintableAscii(code: number): boolean {
  return code >= 0x20 && code < 0x7f;
}

// A control character (not a tab or a line break) in the first bytes.
function hasControlBytes(bytes: Uint8Array): boolean {
  const end: number = Math.min(bytes.length, 512);

  for (let index: number = 0; index < end; index++) {
    const code: number = bytes[index]!;

    if (code < 0x09 || (code > 0x0d && code < 0x20) || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/*
 * The binary format the bytes start with, by its magic number, or null. A
 * short magic number that is also text ("ORC", "BZh", "PAR1") counts only
 * with control bytes after it, so a CSV whose first cell is "ORC" is text.
 */
export function getBinaryFormat(bytes: Uint8Array): string | null {
  for (const signature of BINARY_SIGNATURES) {
    if (!startsWith(bytes, signature.bytes, signature.offset || 0)) {
      continue;
    }

    const looksLikeText: boolean =
      signature.bytes.length < 5 &&
      !signature.offset &&
      signature.bytes.every(isPrintableAscii);

    if (looksLikeText && !hasControlBytes(bytes)) {
      continue;
    }

    return signature.format;
  }

  return null;
}

/*
 * Gzip, inflated to at most MAX_DECOMPRESSED_BYTES: a stream that would
 * inflate further is read in part (decompressPrefix), and one cut short -
 * the first bytes of a large object - gives what it holds so far.
 */
export function gunzipBounded(bytes: Uint8Array): {
  data: Buffer;
  isPartial: boolean;
} {
  const options: zlib.ZlibOptions = {
    maxOutputLength: MAX_DECOMPRESSED_BYTES,
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
  };

  try {
    return { data: zlib.gunzipSync(bytes, options), isPartial: false };
  } catch (error) {
    if (!isBufferTooLargeError(error)) {
      throw error;
    }
  }

  return {
    data: decompressPrefix(
      bytes,
      MAX_DECOMPRESSED_BYTES,
      (prefix: Uint8Array): Buffer => {
        return zlib.gunzipSync(prefix, options);
      },
    ),
    isPartial: true,
  };
}

/*
 * Bytes as text: UTF-8, or UTF-16 after its byte order mark, at most
 * MAX_TEXT_LENGTH characters. Null for bytes that are not text: a NUL byte,
 * or more replacement characters than text has.
 */
export function decodeText(
  bytes: Uint8Array,
): { text: string; isCut: boolean } | null {
  const buffer: Buffer = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );

  const isUtf16Le: boolean = startsWith(bytes, [0xff, 0xfe]);
  const isUtf16Be: boolean = startsWith(bytes, [0xfe, 0xff]);

  if (isUtf16Le || isUtf16Be) {
    const length: number = Math.min(buffer.length - 2, MAX_TEXT_LENGTH * 2);
    const body: Buffer = Buffer.from(
      buffer.subarray(2, 2 + length - (length % 2)),
    );

    if (isUtf16Be) {
      body.swap16();
    }

    return {
      text: body.toString("utf16le"),
      isCut: buffer.length - 2 > length,
    };
  }

  const length: number = Math.min(buffer.length, MAX_TEXT_LENGTH);

  for (let index: number = 0; index < length; index++) {
    if (buffer[index] === 0) {
      return null;
    }
  }

  let text: string = buffer.toString("utf8", 0, length);

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const sample: number = Math.min(text.length, 65_536);
  let replacements: number = 0;

  for (let index: number = 0; index < sample; index++) {
    if (text.charCodeAt(index) === 0xfffd) {
      replacements++;
    }
  }

  if (sample > 0 && replacements / sample > MAX_REPLACEMENT_SHARE) {
    return null;
  }

  return { text, isCut: buffer.length > length };
}

function getBaseName(name: string): string {
  const base: string = name.slice(name.lastIndexOf("/") + 1).toLowerCase();

  return isGzipName(base) ? base.slice(0, -3) : base;
}

// A key store in binary: reported by its name, as a container of keys.
function keyStoreFinding(label: string): ContentClassification {
  return {
    format: ContentFormat.KeyFile,
    locations: [
      {
        location: "",
        locationKind: DataStoreLocationKind.Text,
        classifications: [
          {
            dataTypeId: "private-key",
            matchCount: 1,
            testValueCount: 0,
            confidence: DataConfidence.Medium,
            maskedSamples: [`(${label})`],
            distinctValues: 1,
            distinctValuesCapped: false,
            matchRatio: 1,
            valueCount: 1,
            valuesWithMatch: 1,
            isFreeText: false,
            nameHinted: true,
            foundByName: true,
          },
        ],
      },
    ],
    recordCount: 1,
    recordsWithSensitive: 1,
    plaintextPasswordFields: [],
    warnings: [],
  };
}

/*
 * Free text as a classification: its lines are records, or - for a
 * document - the document is.
 */
function freeTextClassification(data: {
  format: ContentFormat;
  text: string;
  isDocument: boolean;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
  warnings: Array<string>;
  isCut?: boolean | undefined;
}): ContentClassification {
  /*
   * The last line of a cut object is cut too - unless it is the only line,
   * when its start is all there is to read.
   */
  const lastLineFeed: number = data.isCut ? data.text.lastIndexOf("\n") : -1;
  const text: string =
    lastLineFeed > 0 ? data.text.slice(0, lastLineFeed) : data.text;
  const result: FreeTextClassification = classifyFreeText(
    text,
    data.options,
    data.fingerprints,
  );

  return {
    format: data.format,
    locations:
      result.classifications.length > 0
        ? [
            {
              location: "",
              locationKind: DataStoreLocationKind.Text,
              classifications: result.classifications,
            },
          ]
        : [],
    recordCount: data.isDocument ? (result.lines > 0 ? 1 : 0) : result.lines,
    recordsWithSensitive: data.isDocument
      ? result.linesWithSensitive > 0
        ? 1
        : 0
      : result.linesWithSensitive,
    plaintextPasswordFields: [],
    warnings: data.warnings,
  };
}

// Fields read from structured text, classified, and any text left over.
function structuredClassification(data: {
  format: ContentFormat;
  read: StructuredRead;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
  warnings: Array<string>;
}): ContentClassification {
  const fields: FieldsClassification = classifyCollectedFields({
    fields: data.read.collector.getFields(),
    options: data.options,
    fingerprints: data.fingerprints,
    locationKind: DataStoreLocationKind.Field,
  });
  const locations: Array<LocationFindings> = fields.locations;
  let recordsWithSensitive: number = recordsCovered(
    data.read.records,
    fields.sensitiveShare,
  );

  if (data.read.leftoverText.trim().length > 0) {
    const leftover: FreeTextClassification = classifyFreeText(
      data.read.leftoverText,
      data.options,
      data.fingerprints,
    );

    if (leftover.classifications.length > 0) {
      locations.push({
        location: "",
        locationKind: DataStoreLocationKind.Text,
        classifications: leftover.classifications,
      });
    }

    if (leftover.linesWithSensitive > 0) {
      recordsWithSensitive = Math.max(
        recordsWithSensitive,
        Math.min(Math.max(data.read.records, 1), leftover.linesWithSensitive),
      );
    }
  }

  return {
    format: data.format,
    locations,
    recordCount: data.read.records,
    recordsWithSensitive,
    plaintextPasswordFields: fields.plaintextPasswordFields,
    warnings: data.warnings,
  };
}

function classifyOfficeDocument(data: {
  bytes: Uint8Array;
  extension: string;
  options: ContentScanOptions;
  fingerprints: FingerprintAccumulator;
  warnings: Array<string>;
}): ContentClassification {
  let zip: ZipReader;

  try {
    zip = ZipReader.open(data.bytes);
  } catch (error) {
    return emptyClassification(ContentFormat.Unsupported, [
      ...data.warnings,
      describeZipRefusal(error),
    ]);
  }

  const kind: OfficeKind | null = getOfficeKind(zip, data.extension);

  if (!kind) {
    return notSupported("a ZIP archive");
  }

  try {
    if (kind === OfficeKind.Excel) {
      const table: OfficeTable = readWorkbook(zip, (text: string): boolean => {
        return holdsSensitiveValue(text, data.options);
      });

      return structuredClassification({
        format: ContentFormat.Excel,
        read: {
          collector: table.collector,
          records: table.records,
          leftoverText: "",
          isStructured: true,
        },
        options: data.options,
        fingerprints: data.fingerprints,
        warnings: [...data.warnings, ...table.warnings],
      });
    }

    const document: OfficeText =
      kind === OfficeKind.Word ? readWordDocument(zip) : readPresentation(zip);

    return freeTextClassification({
      format:
        kind === OfficeKind.Word
          ? ContentFormat.Word
          : ContentFormat.PowerPoint,
      text: document.text,
      isDocument: true,
      options: data.options,
      fingerprints: data.fingerprints,
      warnings: [...data.warnings, ...document.warnings],
    });
  } catch (error) {
    return emptyClassification(ContentFormat.Unsupported, [
      ...data.warnings,
      describeZipRefusal(error),
    ]);
  }
}

// Why an archive was not read, for the scan's warnings.
function describeZipRefusal(error: unknown): string {
  if (error instanceof ZipError && error.isZipBomb) {
    return `not scanned: refused as a zip bomb (${error.message})`;
  }

  return `not scanned: the ZIP archive could not be read${
    error instanceof ZipError ? ` (${error.message})` : ""
  }`;
}

// The format text is read as: by its extension, else by how it starts.
function getTextFormat(
  extension: string,
  baseName: string,
  text: string,
): ContentFormat {
  if (CSV_EXTENSIONS.has(extension)) {
    return ContentFormat.Csv;
  }

  if (TSV_EXTENSIONS.has(extension)) {
    return ContentFormat.Tsv;
  }

  if (JSON_EXTENSIONS.has(extension)) {
    return ContentFormat.Json;
  }

  if (JSON_LINES_EXTENSIONS.has(extension)) {
    return ContentFormat.JsonLines;
  }

  if (YAML_EXTENSIONS.has(extension)) {
    return ContentFormat.Yaml;
  }

  if (XML_EXTENSIONS.has(extension)) {
    return ContentFormat.Xml;
  }

  if (HTML_EXTENSIONS.has(extension)) {
    return ContentFormat.Html;
  }

  if (KEY_FILE_EXTENSIONS.has(extension)) {
    return ContentFormat.KeyFile;
  }

  if (
    KEY_VALUE_EXTENSIONS.has(extension) ||
    baseName === ".env" ||
    baseName.startsWith(".env.") ||
    KEY_VALUE_NAMES.has(baseName)
  ) {
    return ContentFormat.KeyValue;
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return ContentFormat.Text;
  }

  // No extension that says: by how the text starts.
  const start: string = text.slice(0, 256).trimStart();
  const lowerStart: string = start.slice(0, 32).toLowerCase();

  // Read as JSON only when it is whole JSON or JSON lines (classifyContent).
  if (start.startsWith("{") || start.startsWith("[")) {
    return ContentFormat.Json;
  }

  if (lowerStart.startsWith("<?xml")) {
    return ContentFormat.Xml;
  }

  if (
    lowerStart.startsWith("<!doctype html") ||
    lowerStart.startsWith("<html")
  ) {
    return ContentFormat.Html;
  }

  return ContentFormat.Text;
}

export function classifyContent(
  data: ClassifyContentInput,
): ContentClassification {
  const warnings: Array<string> = [];
  let bytes: Uint8Array = data.bytes;
  let isTruncated: boolean = Boolean(data.isTruncated);

  if (bytes.length === 0) {
    return emptyClassification(ContentFormat.Empty);
  }

  if (isGzipData(bytes)) {
    try {
      const inflated: { data: Buffer; isPartial: boolean } =
        gunzipBounded(bytes);

      bytes = inflated.data;

      if (inflated.isPartial) {
        isTruncated = true;
        warnings.push(
          `read in part: it inflates past ${MAX_DECOMPRESSED_BYTES} bytes`,
        );
      }
    } catch {
      return emptyClassification(ContentFormat.Unsupported, [
        "not scanned: the gzip data could not be inflated",
      ]);
    }

    if (bytes.length === 0) {
      return emptyClassification(ContentFormat.Empty, warnings);
    }
  }

  const extension: string = getObjectExtension(data.name);
  const baseName: string = getBaseName(data.name);

  if (ZipReader.isZip(bytes)) {
    return classifyOfficeDocument({
      bytes,
      extension,
      options: data.options,
      fingerprints: data.fingerprints,
      warnings,
    });
  }

  const keyStore: string | undefined = KEY_STORE_EXTENSIONS.get(extension);
  const binaryFormat: string | null = getBinaryFormat(bytes);

  if (binaryFormat) {
    return keyStore ? keyStoreFinding(keyStore) : notSupported(binaryFormat);
  }

  const decoded: { text: string; isCut: boolean } | null = decodeText(bytes);

  if (!decoded) {
    return keyStore
      ? keyStoreFinding(keyStore)
      : notSupported("binary content");
  }

  const text: string = decoded.text;
  const isCut: boolean = isTruncated || decoded.isCut;
  const format: ContentFormat = getTextFormat(extension, baseName, text);
  const common: {
    options: ContentScanOptions;
    fingerprints: FingerprintAccumulator;
    warnings: Array<string>;
  } = { options: data.options, fingerprints: data.fingerprints, warnings };

  const isSensitive: (value: string) => boolean = (value: string): boolean => {
    return holdsSensitiveValue(value, data.options);
  };

  let read: StructuredRead | null = null;

  switch (format) {
    case ContentFormat.Csv:
    case ContentFormat.Tsv:
      read = readDelimited({
        text,
        delimiter: format === ContentFormat.Csv ? "," : "\t",
        isTruncated: isCut,
        isSensitive,
      });
      break;
    case ContentFormat.Json:
      /*
       * Text that only starts like JSON - "[2026-10-27 10:00] ..." - is
       * read as JSON only when it parses; a .json file cut short is walked
       * as far as it goes.
       */
      read = readJson({
        text,
        isTruncated: isCut,
        wholeOnly: !JSON_EXTENSIONS.has(extension),
      });
      break;
    case ContentFormat.JsonLines:
      read = readJsonLines({ text, isTruncated: isCut });
      break;
    case ContentFormat.KeyValue:
      read = readKeyValue({ text, isTruncated: isCut });
      break;
    case ContentFormat.Yaml:
      read = readYaml({ text, isTruncated: isCut });
      break;
    case ContentFormat.Xml:
    case ContentFormat.Html:
      return freeTextClassification({
        ...common,
        format,
        text: markupToText(text, format === ContentFormat.Xml ? "xml" : "html"),
        isDocument: true,
      });
    case ContentFormat.KeyFile:
      return freeTextClassification({
        ...common,
        format,
        text,
        isDocument: true,
      });
    default:
      break;
  }

  if (read && read.isStructured) {
    return structuredClassification({ ...common, format, read });
  }

  // Text no structured reading claimed - logs, notes - as free text.
  return freeTextClassification({
    ...common,
    format: ContentFormat.Text,
    text,
    isDocument: false,
    isCut,
  });
}
