import {
  BACKUP_CLICKHOUSE_FOLDER_NAME,
  BACKUP_MANIFEST_FILE_NAME,
  BACKUP_POSTGRES_FILE_NAME,
} from "Common/Types/Backup/BackupManifest";

/*
 * Where each backup's files are under the destination's folder:
 *
 *   <folder><name>/manifest.json
 *   <folder><name>/postgres.dump
 *   <folder><name>/clickhouse/...
 *
 * and where the destination test writes (and removes) its own:
 *
 *   <folder>oneuptime-backup-test/<id>...
 */

export const BACKUP_TEST_FOLDER_NAME: string = "oneuptime-backup-test/";

export const BACKUP_POSTGRES_CONTENT_TYPE: string = "application/octet-stream";
export const BACKUP_MANIFEST_CONTENT_TYPE: string = "application/json";

// The most a manifest may hold when it is read back.
export const BACKUP_MANIFEST_MAX_BYTES: number = 1024 * 1024;

export function getBackupFolderKey(folder: string, name: string): string {
  return `${folder}${name}/`;
}

export function getBackupPostgresKey(folder: string, name: string): string {
  return `${getBackupFolderKey(folder, name)}${BACKUP_POSTGRES_FILE_NAME}`;
}

export function getBackupClickhouseFolderKey(
  folder: string,
  name: string,
): string {
  return `${getBackupFolderKey(folder, name)}${BACKUP_CLICKHOUSE_FOLDER_NAME}`;
}

// ClickHouse's own record of a backup: written last, so a backup with it is whole.
export function getBackupClickhouseMetadataKey(
  folder: string,
  name: string,
): string {
  return `${getBackupClickhouseFolderKey(folder, name)}.backup`;
}

export function getBackupManifestKey(folder: string, name: string): string {
  return `${getBackupFolderKey(folder, name)}${BACKUP_MANIFEST_FILE_NAME}`;
}

export function getBackupTestFolderKey(folder: string, id: string): string {
  return `${folder}${BACKUP_TEST_FOLDER_NAME}${id}/`;
}
