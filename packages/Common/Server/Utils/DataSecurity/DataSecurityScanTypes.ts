import { JSONObject } from "../../../Types/JSON";
import { FieldClassification } from "../../../Utils/DataSecurity/FieldClassifier";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";

/*
 * WHAT EVERY CONTENT SCAN TAKES AND RETURNS.
 *
 * A content scan - of a bucket, a warehouse dataset, a database, or a
 * service's telemetry - reads within limits and returns findings by
 * location, never values: each location's field classifications
 * (FieldClassifier.ts), the names of what it read, how much, and what it
 * could not do. The scan job writes DataStoreFinding and DataSecurityScan
 * rows from it (DataSecurityFindingWriter.ts). Scanners for every kind of
 * store return this one shape, so the writer and the checks never care
 * which scanner ran.
 */

export enum DataStoreLocationKind {
  // A database or warehouse column: schema.table.column.
  Column = "Column",
  // A field of JSON, NDJSON, CSV or a document: a dotted path.
  Field = "Field",
  // Objects of one path pattern in a bucket, read as text: exports/*/users-*.csv.
  Object = "Object",
  // A telemetry attribute: attributes.user.email.
  Attribute = "Attribute",
  // A log body, an exception message or stack trace, a prompt.
  Body = "Body",
  // Free text with no field structure.
  Text = "Text",
}

export interface LocationFindings {
  location: string;
  locationKind: DataStoreLocationKind;
  classifications: Array<FieldClassification>;
}

export interface ContentScanLimits {
  maxObjects: number;
  maxBytesPerObject: number;
  maxBytesTotal: number;
  maxRowsPerTable: number;
  maxTables: number;
  // When the scan must stop, whatever is left.
  deadline: Date;
}

export interface ContentScanOptions {
  limits: ContentScanLimits;
  // The project's custom data types, compiled.
  customDetectors: Array<ScanDetector>;
  // Name hints of custom data types.
  extraHints: Array<{ dataTypeId: string; hints: Array<string> }>;
  disabledDataTypeIds: Set<string>;
  allowedValues: Set<string>;
  // Path prefixes, tables or keys to skip.
  exclusions: Array<string>;
  // What the last scan of this store left, for an incremental scan.
  previousState?: JSONObject | undefined;
  /*
   * The keyed hash fingerprints use (Fingerprint.ts): one secret per
   * project, so two projects' fingerprints can never be compared.
   */
  fingerprintKey: string;
}

export interface ContentScanResult {
  locations: Array<LocationFindings>;
  // Names of what was read: objects, tables, services. Never contents.
  readLog: Array<string>;
  objectsRead: number;
  rowsRead: number;
  bytesRead: number;
  warnings: Array<string>;
  // b-bit MinHash fingerprints by data type (Fingerprint.ts).
  fingerprints: Record<string, Array<number>>;
  // Password fields whose values are not password hashes.
  plaintextPasswordFields: Array<string>;
  // Rows or records with at least one sensitive value, scaled to the store.
  estimatedRecords?: number | undefined;
  // Every object or table that should have been read was read.
  isComplete: boolean;
  // What the next scan needs to skip what has not changed.
  nextState?: JSONObject | undefined;
}

// The most entries a scan's read log keeps.
export const MAX_READ_LOG_ENTRIES: number = 200;

export function emptyContentScanResult(): ContentScanResult {
  return {
    locations: [],
    readLog: [],
    objectsRead: 0,
    rowsRead: 0,
    bytesRead: 0,
    warnings: [],
    fingerprints: {},
    plaintextPasswordFields: [],
    isComplete: true,
  };
}
