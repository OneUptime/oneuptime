import { JSONObject, JSONValue } from "../JSON";
import { BackupRunTrigger } from "./BackupRunTypes";

/*
 * What a backup is, written next to it at the destination as manifest.json
 * once everything else is there: which databases it holds, how big each is
 * and its checksum, which OneUptime and database versions made it, and what
 * a restore checks before it replaces anything.
 *
 * The manifest is the backup's own record. The run row in PostgreSQL says
 * the same, but the row goes back in time with every restore and is gone
 * with a lost server, while the manifest stays with the files: a new
 * installation pointed at the same bucket finds every backup by its
 * manifest (Find backups) and restores it.
 *
 * Every backup lives under <folder><name>/:
 *
 *   <name>/manifest.json      this file, last
 *   <name>/postgres.dump      pg_dump's custom format (pg_restore reads it)
 *   <name>/clickhouse/        ClickHouse's own BACKUP of the telemetry database
 */

export const BACKUP_MANIFEST_SCHEMA_VERSION: number = 1;

export const BACKUP_MANIFEST_FILE_NAME: string = "manifest.json";
export const BACKUP_POSTGRES_FILE_NAME: string = "postgres.dump";
export const BACKUP_CLICKHOUSE_FOLDER_NAME: string = "clickhouse/";

// pg_dump --format=custom.
export const BACKUP_POSTGRES_FORMAT: string = "pg_dump-custom";

// How many of the records people recognise a backup holds, for the restore dialog.
export interface BackupPostgresCounts {
  projects?: number | undefined;
  users?: number | undefined;
  monitors?: number | undefined;
  incidents?: number | undefined;
  statusPages?: number | undefined;
}

export interface BackupManifestPostgres {
  file: string;
  format: string;
  sizeInBytes: number;
  sha256: string;
  database: string;
  serverVersion: string;
  // The pg_dump that wrote it: a restore needs a pg_restore at least this new.
  toolVersion: string;
  // The newest schema migration the database had: what a restore upgrades from.
  lastMigration?: string | undefined;
  counts?: BackupPostgresCounts | undefined;
}

export interface BackupManifestClickhouse {
  folder: string;
  database: string;
  serverVersion: string;
  sizeInBytes: number;
  fileCount: number;
}

export interface BackupManifest {
  schemaVersion: number;
  backupId: string;
  name: string;
  trigger: BackupRunTrigger;
  startedAt: string;
  finishedAt: string;
  oneuptimeVersion: string;
  /*
   * A value encrypted with the installation's ENCRYPTION_SECRET: a restore
   * decrypts it to tell whether the stored credentials in the backup can be
   * read by the installation it restores into.
   */
  encryptionCheck?: string | undefined;
  postgres?: BackupManifestPostgres | undefined;
  clickhouse?: BackupManifestClickhouse | undefined;
}

// What encryptionCheck holds once decrypted.
export const BACKUP_ENCRYPTION_CHECK_TEXT: string =
  "oneuptime-backup-encryption-check";

const MAX_TEXT_LENGTH: number = 1000;

function readText(
  record: JSONObject,
  key: string,
  options: { required: boolean },
): string | undefined {
  const value: JSONValue | undefined = record[key];

  if (typeof value === "string" && value.length > 0) {
    return value.length > MAX_TEXT_LENGTH
      ? value.slice(0, MAX_TEXT_LENGTH)
      : value;
  }

  if (options.required) {
    throw new Error(`The manifest has no ${key}.`);
  }

  return undefined;
}

function readSize(record: JSONObject, key: string): number {
  const value: JSONValue | undefined = record[key];

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(`The manifest's ${key} is not a size.`);
  }

  return value;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

const SHA256_HEX_LENGTH: number = 64;

function isSha256Hex(value: string): boolean {
  if (value.length !== SHA256_HEX_LENGTH) {
    return false;
  }

  for (const char of value) {
    const isDigit: boolean = char >= "0" && char <= "9";
    const isHexLetter: boolean = char >= "a" && char <= "f";

    if (!isDigit && !isHexLetter) {
      return false;
    }
  }

  return true;
}

function readCounts(value: JSONValue | undefined): BackupPostgresCounts {
  const record: JSONObject | null = readObject(value);
  const counts: BackupPostgresCounts = {};

  if (!record) {
    return counts;
  }

  for (const key of [
    "projects",
    "users",
    "monitors",
    "incidents",
    "statusPages",
  ] as const) {
    const count: JSONValue | undefined = record[key];

    if (
      typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 0 &&
      Number.isFinite(count)
    ) {
      counts[key] = count;
    }
  }

  return counts;
}

function isTrigger(value: unknown): value is BackupRunTrigger {
  return (
    typeof value === "string" &&
    (Object.values(BackupRunTrigger) as Array<string>).includes(value)
  );
}

/*
 * A manifest read from the destination, checked as a restore relies on it:
 * a schema this release reads, the backup's id and name, and for each
 * database it holds a file, a size and (for PostgreSQL) a SHA-256. Throws
 * with what is wrong; a manifest of a newer schema is refused rather than
 * misread.
 */
export function parseBackupManifest(value: unknown): BackupManifest {
  let parsed: unknown = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("The manifest is not JSON.");
    }
  }

  const record: JSONObject | null = readObject(parsed as JSONValue);

  if (!record) {
    throw new Error("The manifest is not a JSON object.");
  }

  const schemaVersion: JSONValue | undefined = record["schemaVersion"];

  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new Error("The manifest has no schemaVersion.");
  }

  if (schemaVersion > BACKUP_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `The manifest was written by a newer OneUptime (schema ${schemaVersion}). Update OneUptime to restore it.`,
    );
  }

  const trigger: JSONValue | undefined = record["trigger"];

  const manifest: BackupManifest = {
    schemaVersion,
    backupId: readText(record, "backupId", { required: true })!,
    name: readText(record, "name", { required: true })!,
    trigger: isTrigger(trigger) ? trigger : BackupRunTrigger.Manual,
    startedAt: readText(record, "startedAt", { required: true })!,
    finishedAt: readText(record, "finishedAt", { required: true })!,
    oneuptimeVersion: readText(record, "oneuptimeVersion", {
      required: true,
    })!,
  };

  if (Number.isNaN(new Date(manifest.startedAt).getTime())) {
    throw new Error("The manifest's startedAt is not a date.");
  }

  const encryptionCheck: string | undefined = readText(
    record,
    "encryptionCheck",
    { required: false },
  );

  if (encryptionCheck) {
    manifest.encryptionCheck = encryptionCheck;
  }

  const postgres: JSONObject | null = readObject(record["postgres"]);

  if (postgres) {
    const sha256: string = readText(postgres, "sha256", { required: true })!;

    if (!isSha256Hex(sha256)) {
      throw new Error("The manifest's PostgreSQL checksum is not a SHA-256.");
    }

    manifest.postgres = {
      file: readText(postgres, "file", { required: true })!,
      format: readText(postgres, "format", { required: true })!,
      sizeInBytes: readSize(postgres, "sizeInBytes"),
      sha256,
      database: readText(postgres, "database", { required: true })!,
      serverVersion: readText(postgres, "serverVersion", { required: true })!,
      toolVersion: readText(postgres, "toolVersion", { required: true })!,
      counts: readCounts(postgres["counts"]),
    };

    const lastMigration: string | undefined = readText(
      postgres,
      "lastMigration",
      { required: false },
    );

    if (lastMigration) {
      manifest.postgres.lastMigration = lastMigration;
    }
  }

  const clickhouse: JSONObject | null = readObject(record["clickhouse"]);

  if (clickhouse) {
    manifest.clickhouse = {
      folder: readText(clickhouse, "folder", { required: true })!,
      database: readText(clickhouse, "database", { required: true })!,
      serverVersion: readText(clickhouse, "serverVersion", { required: true })!,
      sizeInBytes: readSize(clickhouse, "sizeInBytes"),
      fileCount: readSize(clickhouse, "fileCount"),
    };
  }

  if (!manifest.postgres && !manifest.clickhouse) {
    throw new Error("The manifest names no database.");
  }

  return manifest;
}

/*
 * A backup's folder name: its start time in UTC, to the second, then the
 * first eight characters of its id - so the destination lists backups
 * oldest first, and two backups started in one second never share a
 * folder. 2026-10-24 02:00:00 UTC -> 20261024T020000Z-3f2a9c1b.
 */
export function getBackupName(data: { startedAt: Date; id: string }): string {
  const date: Date = data.startedAt;
  const pad: (value: number) => string = (value: number): string => {
    return String(value).padStart(2, "0");
  };

  const stamp: string = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  const idPart: string = data.id
    .toLowerCase()
    .split("")
    .filter((char: string): boolean => {
      return (char >= "0" && char <= "9") || (char >= "a" && char <= "z");
    })
    .join("")
    .slice(0, 8);

  return `${stamp}-${idPart}`;
}

/*
 * Whether a folder name could be a backup's (getBackupName's shape): what
 * Find backups reads a manifest under, and nothing else in the bucket.
 */
export function isBackupName(value: string): boolean {
  if (value.length !== 25 || value.charAt(8) !== "T") {
    return false;
  }

  if (value.charAt(15) !== "Z" || value.charAt(16) !== "-") {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    if (index === 8 || index === 15 || index === 16) {
      continue;
    }

    const char: string = value.charAt(index);
    const isDigit: boolean = char >= "0" && char <= "9";
    const isLetter: boolean = char >= "a" && char <= "z";

    if (index < 15 ? !isDigit : !isDigit && !isLetter) {
      return false;
    }
  }

  return true;
}
