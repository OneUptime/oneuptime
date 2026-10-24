/*
 * Where an Audit Log Export sends the audit log (AuditLogExport.destinationType).
 * Fixed once an export is created. The catalog says what each one asks for
 * (AuditLogExportDestinationCatalog); the Enterprise Edition's exporter holds
 * the code that writes to it.
 *
 * File destinations get one compressed NDJSON file per batch; a stream
 * receives batches of entries as they are recorded.
 */
enum AuditLogExportDestinationType {
  AmazonS3 = "s3",
  // MinIO, Cloudflare R2, Backblaze B2, Wasabi and other storage with an S3 API.
  S3Compatible = "s3-compatible",
  GoogleCloudStorage = "google-cloud-storage",
  AzureBlobStorage = "azure-blob-storage",
  // An HTTPS endpoint of your own, a log shipper or a SIEM's HTTP intake.
  Webhook = "webhook",
  // A syslog receiver over TLS or TCP (RFC 5424).
  Syslog = "syslog",
}

export default AuditLogExportDestinationType;

// The recommended destinations, in the order the form offers them.
export const AllAuditLogExportDestinationTypes: ReadonlyArray<AuditLogExportDestinationType> =
  [
    AuditLogExportDestinationType.AmazonS3,
    AuditLogExportDestinationType.S3Compatible,
    AuditLogExportDestinationType.GoogleCloudStorage,
    AuditLogExportDestinationType.AzureBlobStorage,
    AuditLogExportDestinationType.Webhook,
    AuditLogExportDestinationType.Syslog,
  ];

export function isAuditLogExportDestinationType(
  value: unknown,
): value is AuditLogExportDestinationType {
  return (
    typeof value === "string" &&
    (AllAuditLogExportDestinationTypes as ReadonlyArray<string>).includes(value)
  );
}
