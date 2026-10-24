import { AppVersion } from "Common/Server/EnvironmentConfig";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import Encryption from "Common/Server/Utils/Encryption";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import {
  BACKUP_ENCRYPTION_CHECK_TEXT,
  BackupManifest,
  BackupPostgresCounts,
  parseBackupManifest,
} from "Common/Types/Backup/BackupManifest";
import { BackupRunStatus } from "Common/Types/Backup/BackupRunTypes";
import { JSONObject } from "Common/Types/JSON";
import {
  BACKUP_MANIFEST_MAX_BYTES,
  getBackupClickhouseMetadataKey,
  getBackupManifestKey,
  getBackupPostgresKey,
} from "./BackupLayout";
import ClickhouseBackupEngine from "./ClickHouse/ClickhouseBackupEngine";
import PostgresBackupEngine, {
  PostgresServerInfo,
} from "./Postgres/PostgresBackupEngine";
import { pickPostgresToolSet } from "./Postgres/PostgresTools";
import { errorText } from "./Storage/BackupHttp";
import { BackupObject, BackupStorage } from "./Storage/BackupStorage";

/*
 * What a restore of a backup would replace, and whether it can: read
 * before anything is restored - by the restore dialog, so it says what
 * goes and what stays, and by the restore's first step, which refuses on
 * the same grounds.
 *
 *   problems   refuse the restore: the backup is not at this destination,
 *              its files or its manifest are missing, a newer OneUptime
 *              made it, the tools or the database user cannot restore it;
 *   warnings   allow it, with care: the backup's stored credentials were
 *              encrypted with another ENCRYPTION_SECRET, an older OneUptime
 *              made it (the restore upgrades it).
 *
 * Each has a code the dialog words in the reader's language, and an
 * English sentence for the API and the run's error.
 */

export enum RestoreIssueCode {
  PreviousDestination = "previous-destination",
  NotSucceeded = "not-succeeded",
  ManifestMissing = "manifest-missing",
  ManifestUnreadable = "manifest-unreadable",
  PostgresMissing = "postgres-missing",
  ClickhouseMissing = "clickhouse-missing",
  PostgresFileMissing = "postgres-file-missing",
  ClickhouseFileMissing = "clickhouse-file-missing",
  NewerVersion = "newer-version",
  OlderVersion = "older-version",
  ToolsMissing = "tools-missing",
  CannotCreateDatabases = "cannot-create-databases",
  EncryptionSecretDiffers = "encryption-secret-differs",
  EncryptionUnknown = "encryption-unknown",
}

export interface RestoreIssue {
  code: RestoreIssueCode;
  message: string;
}

export interface RestorePreview {
  backup: {
    id: string;
    name: string;
    startedAt: string;
    oneuptimeVersion: string;
    postgres: {
      sizeInBytes: number;
      serverVersion: string;
      counts: BackupPostgresCounts;
    } | null;
    clickhouse: { sizeInBytes: number; serverVersion: string } | null;
  };
  current: {
    oneuptimeVersion: string;
    postgres: {
      database: string;
      sizeInBytes: number;
      counts: BackupPostgresCounts;
    } | null;
    clickhouse: { database: string; sizeInBytes: number } | null;
  };
  problems: Array<RestoreIssue>;
  warnings: Array<RestoreIssue>;
  // The manifest, for the restore itself.
  manifest: BackupManifest | null;
}

// One part of a release number.
const VERSION_PART: RegExp = /^\d+$/;

/*
 * 14.0.88 against 14.0.90: -1, 0 or 1, or null when either is not a
 * release number (a development build says "unknown").
 */
export function compareOneUptimeVersions(a: string, b: string): number | null {
  const parse: (value: string) => Array<number> | null = (
    value: string,
  ): Array<number> | null => {
    const core: string = (value || "").trim().split("-")[0] || "";
    const parts: Array<number> = core.split(".").map((part: string): number => {
      return VERSION_PART.test(part) ? Number(part) : NaN;
    });

    return parts.length >= 2 &&
      parts.every((part: number): boolean => {
        return Number.isInteger(part);
      })
      ? parts
      : null;
  };

  const left: Array<number> | null = parse(a);
  const right: Array<number> | null = parse(b);

  if (!left || !right) {
    return null;
  }

  for (
    let index: number = 0;
    index < Math.max(left.length, right.length);
    index++
  ) {
    const difference: number = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }

  return 0;
}

// Whether this installation's ENCRYPTION_SECRET decrypts the backup's check value.
export async function readsBackupEncryption(
  encryptionCheck: string | undefined,
): Promise<boolean | null> {
  if (!encryptionCheck) {
    return null;
  }

  try {
    return (
      (await Encryption.decrypt(encryptionCheck)) ===
      BACKUP_ENCRYPTION_CHECK_TEXT
    );
  } catch {
    return false;
  }
}

export async function buildRestorePreview(data: {
  backupRun: BackupRun;
  settings: BackupDestinationSettings;
  storage: BackupStorage;
  postgres: PostgresBackupEngine;
  clickhouse: ClickhouseBackupEngine;
  includesPostgres: boolean;
  includesClickhouse: boolean;
  currentVersion?: string | undefined;
}): Promise<RestorePreview> {
  const run: BackupRun = data.backupRun;
  const folder: string = BackupSettingsUtil.getFolder(data.settings);
  const name: string = run.name || "";
  const problems: Array<RestoreIssue> = [];
  const warnings: Array<RestoreIssue> = [];
  const currentVersion: string = data.currentVersion ?? AppVersion;

  const preview: RestorePreview = {
    backup: {
      id: run.id?.toString() || "",
      name,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : "",
      oneuptimeVersion: "",
      postgres: null,
      clickhouse: null,
    },
    current: {
      oneuptimeVersion: currentVersion,
      postgres: null,
      clickhouse: null,
    },
    problems,
    warnings,
    manifest: null,
  };

  if (run.status !== BackupRunStatus.Succeeded) {
    problems.push({
      code: RestoreIssueCode.NotSucceeded,
      message: "Only a backup that succeeded can be restored.",
    });
    return preview;
  }

  if (
    run.destinationFingerprint !==
    BackupSettingsUtil.getDestinationFingerprint(data.settings)
  ) {
    problems.push({
      code: RestoreIssueCode.PreviousDestination,
      message:
        "This backup is at a previous destination. Set that destination again in Settings > Backups to restore it.",
    });
    return preview;
  }

  // The manifest: what the backup holds.
  let manifest: BackupManifest | null = null;

  try {
    const bytes: Buffer | null = await data.storage.readSmallObject(
      getBackupManifestKey(folder, name),
      BACKUP_MANIFEST_MAX_BYTES,
    );

    if (!bytes) {
      problems.push({
        code: RestoreIssueCode.ManifestMissing,
        message: `The backup's manifest is not at ${data.storage.describeKey(getBackupManifestKey(folder, name))}: the backup was deleted or moved.`,
      });
      return preview;
    }

    manifest = parseBackupManifest(bytes.toString("utf8"));
  } catch (error) {
    problems.push({
      code: RestoreIssueCode.ManifestUnreadable,
      message: `The backup's manifest could not be read: ${errorText(error)}.`,
    });
    return preview;
  }

  preview.manifest = manifest;
  preview.backup.oneuptimeVersion = manifest.oneuptimeVersion;
  preview.backup.postgres = manifest.postgres
    ? {
        sizeInBytes: manifest.postgres.sizeInBytes,
        serverVersion: manifest.postgres.serverVersion,
        counts: manifest.postgres.counts || {},
      }
    : null;
  preview.backup.clickhouse = manifest.clickhouse
    ? {
        sizeInBytes: manifest.clickhouse.sizeInBytes,
        serverVersion: manifest.clickhouse.serverVersion,
      }
    : null;

  const comparison: number | null = compareOneUptimeVersions(
    manifest.oneuptimeVersion,
    currentVersion,
  );

  if (comparison === 1) {
    problems.push({
      code: RestoreIssueCode.NewerVersion,
      message: `OneUptime ${manifest.oneuptimeVersion} made this backup, which is newer than this installation (${currentVersion}). Update OneUptime first, then restore.`,
    });
  } else if (comparison === -1) {
    warnings.push({
      code: RestoreIssueCode.OlderVersion,
      message: `OneUptime ${manifest.oneuptimeVersion} made this backup. The restore brings its data up to ${currentVersion}.`,
    });
  }

  // PostgreSQL.
  if (data.includesPostgres) {
    if (!manifest.postgres) {
      problems.push({
        code: RestoreIssueCode.PostgresMissing,
        message: "This backup holds no PostgreSQL.",
      });
    } else {
      const stored: BackupObject | null = await data.storage.headObject(
        getBackupPostgresKey(folder, name),
      );

      if (!stored || stored.sizeInBytes !== manifest.postgres.sizeInBytes) {
        problems.push({
          code: RestoreIssueCode.PostgresFileMissing,
          message: stored
            ? `The PostgreSQL dump at the destination is ${stored.sizeInBytes} bytes, not the ${manifest.postgres.sizeInBytes} the manifest names.`
            : "The PostgreSQL dump is not at the destination any more.",
        });
      }

      try {
        const info: PostgresServerInfo = await data.postgres.getServerInfo();
        const contents: Awaited<
          ReturnType<PostgresBackupEngine["getContents"]>
        > = await data.postgres.getContents();

        preview.current.postgres = {
          database: info.database,
          sizeInBytes: info.sizeInBytes,
          counts: contents.counts,
        };

        if (!info.isSuperuser && !info.canCreateDatabases) {
          problems.push({
            code: RestoreIssueCode.CannotCreateDatabases,
            message: `The database user ${info.user} may not create databases, which a restore needs: it restores into a new database beside the current one. Run ALTER USER ${info.user} CREATEDB; and try again.`,
          });
        }

        pickPostgresToolSet({
          toolSets: await data.postgres.getToolSets(),
          serverMajor: info.major,
          atLeastMajor:
            parseInt(manifest.postgres.toolVersion, 10) || undefined,
        });
      } catch (error) {
        problems.push({
          code: RestoreIssueCode.ToolsMissing,
          message: errorText(error) + ".",
        });
      }

      const reads: boolean | null = await readsBackupEncryption(
        manifest.encryptionCheck,
      );

      if (reads === false) {
        warnings.push({
          code: RestoreIssueCode.EncryptionSecretDiffers,
          message:
            "This backup was made with another ENCRYPTION_SECRET. The credentials stored in it (SMTP, API keys, integrations) cannot be read after the restore, unless you set ENCRYPTION_SECRET to the old value and restart OneUptime first.",
        });
      } else if (reads === null) {
        warnings.push({
          code: RestoreIssueCode.EncryptionUnknown,
          message:
            "The backup does not say which ENCRYPTION_SECRET it was made with. If it differs from this installation's, stored credentials cannot be read after the restore.",
        });
      }
    }
  }

  // ClickHouse.
  if (data.includesClickhouse) {
    if (!manifest.clickhouse) {
      problems.push({
        code: RestoreIssueCode.ClickhouseMissing,
        message: "This backup holds no ClickHouse.",
      });
    } else {
      const metadata: BackupObject | null = await data.storage.headObject(
        getBackupClickhouseMetadataKey(folder, name),
      );

      if (!metadata) {
        problems.push({
          code: RestoreIssueCode.ClickhouseFileMissing,
          message:
            "ClickHouse's part of the backup is not at the destination any more.",
        });
      }

      try {
        preview.current.clickhouse = {
          database: data.clickhouse.database,
          sizeInBytes: await data.clickhouse.getDatabaseSizeInBytes(),
        };
      } catch {
        // The dialog then names no size for the current telemetry.
      }
    }
  }

  return preview;
}

// The preview as the API answers it: the manifest is the server's own.
export function restorePreviewToJson(preview: RestorePreview): JSONObject {
  return {
    backup: preview.backup as unknown as JSONObject,
    current: preview.current as unknown as JSONObject,
    problems: preview.problems as unknown as JSONObject,
    warnings: preview.warnings as unknown as JSONObject,
  } as JSONObject;
}
