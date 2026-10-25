/*
 * Where the instance's backups are stored (BackupSetting.destinationType):
 * the storage protocol OneUptime and ClickHouse write to. The recommended
 * destinations the form offers (Cloudflare R2, Backblaze B2, Wasabi,
 * MinIO...) are providers of one of these - see BackupDestinationCatalog.
 *
 * The values are the audit log export's for the same storage
 * (AuditLogExportDestinationType), so one bucket's settings read alike in
 * both places.
 */
enum BackupDestinationType {
  AmazonS3 = "s3",
  // MinIO, Cloudflare R2, Backblaze B2, Wasabi and any other storage with an S3 API.
  S3Compatible = "s3-compatible",
  // Through Cloud Storage's S3-compatible XML API, signed with an HMAC key.
  GoogleCloudStorage = "google-cloud-storage",
  AzureBlobStorage = "azure-blob-storage",
}

export default BackupDestinationType;

export const AllBackupDestinationTypes: ReadonlyArray<BackupDestinationType> = [
  BackupDestinationType.AmazonS3,
  BackupDestinationType.S3Compatible,
  BackupDestinationType.GoogleCloudStorage,
  BackupDestinationType.AzureBlobStorage,
];

export function isBackupDestinationType(
  value: unknown,
): value is BackupDestinationType {
  return (
    typeof value === "string" &&
    (AllBackupDestinationTypes as ReadonlyArray<string>).includes(value)
  );
}

// The destinations ClickHouse and OneUptime reach through the S3 API.
export function isS3ProtocolBackupDestination(
  type: BackupDestinationType | string | undefined | null,
): boolean {
  return (
    type === BackupDestinationType.AmazonS3 ||
    type === BackupDestinationType.S3Compatible ||
    type === BackupDestinationType.GoogleCloudStorage
  );
}
