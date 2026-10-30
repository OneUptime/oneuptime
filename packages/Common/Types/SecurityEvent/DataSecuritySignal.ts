import { SECURITY_TELEMETRY_VENDOR_NAME } from "./SecurityTelemetrySource";

/*
 * DATA SECURITY'S SECURITY EVENTS: a change to a sensitive store, as
 * Security Operations reads it (detection and response for data).
 *
 * Data Security knows which buckets and databases hold Confidential or
 * Restricted data; the cloud's activity log says who changed a store's
 * policy, shared its snapshot or turned its encryption off. Together they
 * are a security event - "alice made the bucket of card numbers public" -
 * written by Server/Utils/DataSecurity/DataSecurityChangeSignals, which the
 * rule library's Data security rules read (DetectionRuleLibrary) and the
 * Rule Library tells a project sends by its product (DetectionRuleDataKind).
 *
 * Each event carries the vendor OneUptime, the product Data Security, the
 * signal under the key the other OneUptime sources use (oneuptime.signal),
 * the change as the activity log recorded it (under the change event's own
 * keys: oneuptime.cloud.operation, oneuptime.cloud.actor, cloud.*) and the
 * store as Data Security knows it (oneuptime.data_store.*).
 */

export const DATA_SECURITY_SIGNAL_VENDOR_NAME: string =
  SECURITY_TELEMETRY_VENDOR_NAME;
export const DATA_SECURITY_SIGNAL_PRODUCT_NAME: string = "Data Security";
// The service the events are attributed to, as "OneUptime Logs" is for logs.
export const DATA_SECURITY_SIGNAL_SERVICE_NAME: string =
  "OneUptime Data Security";

// What oneuptime.signal says of a change to a sensitive store.
export const DATA_SECURITY_STORE_CHANGE_SIGNAL: string =
  "data-security.store-change";

// What oneuptime.source says of every Data Security event.
export const DATA_SECURITY_SIGNAL_SOURCE: string = "data-security";

export const DATA_STORE_SIGNAL_ATTRIBUTES: {
  // "data-store:" and the store's key: the store's entity, which rules group on.
  readonly entity: string;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly sensitivity: string;
  readonly exposure: string;
  // The protection the change took away: one of DataStoreProtection.
  readonly protectionRemoved: string;
  // When the change happened, as the activity log says (ISO 8601).
  readonly changedAt: string;
} = {
  entity: "oneuptime.data_store.entity",
  id: "oneuptime.data_store.id",
  name: "oneuptime.data_store.name",
  kind: "oneuptime.data_store.kind",
  sensitivity: "oneuptime.data_store.sensitivity",
  exposure: "oneuptime.data_store.exposure",
  protectionRemoved: "oneuptime.data_store.protection_removed",
  changedAt: "oneuptime.change.time",
};

// A safeguard a change can take off a store.
export enum DataStoreProtection {
  Encryption = "encryption",
  Versioning = "versioning",
  AccessLogging = "access-logging",
}

/*
 * The operations each Data security rule of the library reads, by what
 * they do to a store. Every one is read from the cloud's changes, beside
 * the ones that make Data Security read a store again
 * (DataSecurityRunner's POSTURE_CHANGING_OPERATIONS).
 */

// What makes a bucket public: its policy, its ACL, its public access block.
export const DATA_STORE_PUBLIC_ACCESS_OPERATIONS: ReadonlyArray<string> = [
  "s3:PutBucketPolicy",
  "s3:PutBucketAcl",
  "s3:DeletePublicAccessBlock",
];

// What hands a database's copy to another account.
export const DATA_STORE_SNAPSHOT_SHARING_OPERATIONS: ReadonlyArray<string> = [
  "rds:ModifyDBSnapshotAttribute",
  "rds:ModifyDBClusterSnapshotAttribute",
  "rds:CopyDBSnapshot",
];

// What writes a database out, whole, to a bucket.
export const DATA_STORE_EXPORT_OPERATIONS: ReadonlyArray<string> = [
  "rds:StartExportTask",
];

/*
 * What can take a safeguard off: removing a bucket's encryption, and the
 * calls that turn versioning or access logging on or off - which way is
 * read from the store's configuration (DataSecurityChangeSignals).
 */
export const DATA_STORE_PROTECTION_OPERATIONS: Readonly<
  Record<string, DataStoreProtection>
> = {
  "s3:DeleteBucketEncryption": DataStoreProtection.Encryption,
  "s3:PutBucketVersioning": DataStoreProtection.Versioning,
  "s3:PutBucketLogging": DataStoreProtection.AccessLogging,
};

export const DATA_STORE_SIGNAL_OPERATIONS: ReadonlyArray<string> = [
  ...DATA_STORE_PUBLIC_ACCESS_OPERATIONS,
  ...DATA_STORE_SNAPSHOT_SHARING_OPERATIONS,
  ...DATA_STORE_EXPORT_OPERATIONS,
  ...Object.keys(DATA_STORE_PROTECTION_OPERATIONS),
];

export interface DataStoreChangeAttack {
  tactics: Array<string>;
  techniques: Array<string>;
}

/*
 * The MITRE ATT&CK tactics and techniques a change to a sensitive store
 * stands for (Types/SecurityEvent/MitreAttack): opening a bucket is Data
 * from Cloud Storage, handing a copy to another account Transfer Data to
 * Cloud Account; taking encryption off Weaken Encryption, versioning
 * Inhibit System Recovery, and access logging Disable or Modify Tools (what
 * Impair Defenses: Disable or Modify Cloud Logs became). Any other change
 * stands for nothing in particular.
 */
export function getDataStoreChangeAttack(data: {
  operation: string;
  protectionRemoved?: DataStoreProtection | undefined;
}): DataStoreChangeAttack {
  if (DATA_STORE_PUBLIC_ACCESS_OPERATIONS.includes(data.operation)) {
    return { tactics: ["TA0009"], techniques: ["T1530"] };
  }

  if (
    DATA_STORE_SNAPSHOT_SHARING_OPERATIONS.includes(data.operation) ||
    DATA_STORE_EXPORT_OPERATIONS.includes(data.operation)
  ) {
    return { tactics: ["TA0010"], techniques: ["T1537"] };
  }

  switch (data.protectionRemoved) {
    case DataStoreProtection.Encryption:
      return { tactics: ["TA0112"], techniques: ["T1600"] };
    case DataStoreProtection.Versioning:
      return { tactics: ["TA0040"], techniques: ["T1490"] };
    case DataStoreProtection.AccessLogging:
      return { tactics: ["TA0112"], techniques: ["T1685"] };
    default:
      return { tactics: [], techniques: [] };
  }
}
