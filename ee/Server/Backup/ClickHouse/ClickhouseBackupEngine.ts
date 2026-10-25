import ClickhouseDatabase, {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  getClickhouseClusterName,
  getClickhouseDatabaseName,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { JSONObject } from "Common/Types/JSON";
import { getS3Target } from "../../AuditLogExport/Destinations/S3Destination";
import { getAzureBlobHost } from "../../AuditLogExport/Destinations/AzureBlobStorageDestination";
import { errorText, sleep } from "../Storage/BackupHttp";

/*
 * ClickHouse backs itself up: BACKUP DATABASE ... ON CLUSTER ... TO
 * S3(...) or AzureBlobStorage(...) writes the telemetry database straight
 * from ClickHouse to the storage, every shard's part of it, while ClickHouse
 * keeps taking inserts - each table as it was when its parts were read,
 * which is consistent per table (parts never change once written). Nothing
 * passes through OneUptime, so a backup of hundreds of gigabytes needs no
 * room on OneUptime's server. RESTORE reads it back the same way.
 *
 * Both run ASYNC with an id OneUptime picks (SETTINGS id = ...), and are
 * followed through system.backups on every replica (clusterAllReplicas),
 * whichever node the next query lands on. Credentials go into the
 * statement as string literals; ClickHouse hides them ([HIDDEN]) in
 * system.backups and its query log, and OneUptime never logs the statement.
 *
 * Restoring replaces the database: the current one is renamed aside (its
 * materialized views dropped at once - after a restart they would bind to
 * the restored tables by name and count every insert twice), the backup
 * is restored under the database's own name (so the Distributed tables'
 * own database argument stays right), and the one set aside is dropped
 * only once the restore succeeded; a failed restore puts it back.
 */

// How often a running backup or restore is asked how it is doing.
export const CLICKHOUSE_BACKUP_POLL_INTERVAL_IN_MS: number = 5000;

// A distributed DDL (RENAME, DROP ON CLUSTER) may take this long.
const CLICKHOUSE_DDL_REQUEST_TIMEOUT_IN_MS: number = 30 * 60 * 1000;

export enum ClickhouseBackupState {
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  // No replica knows the id: ClickHouse restarted, or it never started.
  Missing = "missing",
}

export interface ClickhouseBackupStatus {
  state: ClickhouseBackupState;
  error: string;
  fileCount: number;
  totalSizeInBytes: number;
  filesRead: number;
  bytesRead: number;
}

// One of ClickHouse's string literals: backslashes and quotes escaped.
export function clickhouseString(value: string): string {
  return `'${value.split("\\").join("\\\\").split("'").join("\\'")}'`;
}

// A database or cluster name as an identifier, quoted with backticks.
export function clickhouseIdentifier(value: string): string {
  return `\`${value.split("\\").join("\\\\").split("`").join("\\`")}\``;
}

/*
 * The engine clause of a BACKUP or RESTORE for a folder at the destination
 * - S3('<folder url>', '<key>', '<secret>'), or AzureBlobStorage(...) -
 * the same place OneUptime's own client reaches (getS3Target, the audit
 * log export's addressing). `endpointOverride` is for a test whose
 * ClickHouse reaches the storage at another address than the test does.
 */
export function getClickhouseBackupEngine(data: {
  settings: BackupDestinationSettings;
  folderKey: string;
  endpointOverride?: string | undefined;
}): string {
  const settings: BackupDestinationSettings = data.settings;

  if (settings.type === BackupDestinationType.AzureBlobStorage) {
    const accountName: string = BackupSettingsUtil.readConfigText(
      settings,
      "accountName",
    );
    const container: string = BackupSettingsUtil.readConfigText(
      settings,
      "container",
    );
    const serviceUrl: string =
      data.endpointOverride ||
      `https://${getAzureBlobHost({
        accountName,
        cloud: BackupSettingsUtil.readConfigText(settings, "cloud"),
      })}`;

    if (BackupSettingsUtil.usesAzureSasToken(settings)) {
      let sasToken: string = BackupSettingsUtil.readSecretText(
        settings,
        "sasToken",
      );

      while (sasToken.startsWith("?")) {
        sasToken = sasToken.slice(1);
      }

      const connection: string = `BlobEndpoint=${serviceUrl}/;SharedAccessSignature=${sasToken}`;

      return `AzureBlobStorage(${clickhouseString(connection)}, ${clickhouseString(container)}, ${clickhouseString(data.folderKey)})`;
    }

    return `AzureBlobStorage(${clickhouseString(serviceUrl)}, ${clickhouseString(container)}, ${clickhouseString(data.folderKey)}, ${clickhouseString(accountName)}, ${clickhouseString(BackupSettingsUtil.readSecretText(settings, "accountKey"))})`;
  }

  const endpoint: string =
    data.endpointOverride || BackupSettingsUtil.getS3Endpoint(settings) || "";
  const url: string = getS3Target({
    isAmazonS3:
      settings.type === BackupDestinationType.AmazonS3 &&
      !data.endpointOverride,
    endpoint,
    bucket: BackupSettingsUtil.readConfigText(settings, "bucket"),
    region: BackupSettingsUtil.getS3Region(settings),
    key: data.folderKey,
  }).url;

  return `S3(${clickhouseString(url)}, ${clickhouseString(BackupSettingsUtil.readConfigText(settings, "accessKeyId"))}, ${clickhouseString(BackupSettingsUtil.readSecretText(settings, "secretAccessKey"))})`;
}

/*
 * What ClickHouse said, in an operator's words: the error without its
 * stack trace, and for the failures people meet - the storage refused
 * ClickHouse's key, the bucket is not there, ClickHouse cannot reach the
 * storage, the user may not back up - what to change. ClickHouse makes the
 * connection to the storage itself, so its network must reach the storage
 * as well as OneUptime's.
 */
export function describeClickhouseBackupError(error: string): string {
  let text: string = error.trim();
  const stackAt: number = text.indexOf("Stack trace");

  if (stackAt > 0) {
    text = text.slice(0, stackAt).trim();
  }

  while (text.endsWith(",") || text.endsWith(".")) {
    text = text.slice(0, -1).trim();
  }

  const said: string = `ClickHouse said: ${text}.`;
  const lower: string = text.toLowerCase();

  if (lower.includes("backup_already_exists")) {
    return `A ClickHouse backup is already at this place in the storage. ${said}`;
  }

  if (lower.includes("backup_not_found")) {
    return `ClickHouse found no backup at this place in the storage. ${said}`;
  }

  if (
    lower.includes("access_denied") ||
    lower.includes("http response code: 403") ||
    lower.includes("authorizationpermissionmismatch") ||
    lower.includes("authenticationfailed")
  ) {
    if (lower.includes("not enough privileges")) {
      return `The ClickHouse user may not run BACKUP or RESTORE. Grant it BACKUP, and the S3 or AZURE source. ${said}`;
    }

    return `The storage refused ClickHouse's request: check that the key may read, write, list and delete in the bucket. ${said}`;
  }

  if (lower.includes("not enough privileges")) {
    return `The ClickHouse user may not run BACKUP or RESTORE. Grant it BACKUP, and the S3 or AZURE source. ${said}`;
  }

  if (
    lower.includes("bucket does not exist") ||
    lower.includes("nosuchbucket") ||
    lower.includes("containernotfound")
  ) {
    return `The bucket or container does not exist. ${said}`;
  }

  if (
    lower.includes("couldn't resolve") ||
    lower.includes("could not resolve") ||
    lower.includes("connection refused") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("no route to host")
  ) {
    return `ClickHouse could not reach the storage: ClickHouse connects to it itself, so its network must reach the storage too. ${said}`;
  }

  if (lower.includes("not enough space") || lower.includes("no space left")) {
    return `ClickHouse ran out of disk space. Free some, then try again. ${said}`;
  }

  return said;
}

function readNumber(row: JSONObject, key: string): number {
  const value: unknown = row[key];
  const number: number =
    typeof value === "number" ? value : Number(value as string);

  return Number.isFinite(number) ? number : 0;
}

/*
 * The state of one operation from the rows every replica reports for its
 * id: failed when any replica failed it, done when every replica is done,
 * running otherwise, missing when none knows it.
 */
export function aggregateClickhouseBackupRows(
  rows: Array<JSONObject>,
): ClickhouseBackupStatus {
  if (rows.length === 0) {
    return {
      state: ClickhouseBackupState.Missing,
      error: "",
      fileCount: 0,
      totalSizeInBytes: 0,
      filesRead: 0,
      bytesRead: 0,
    };
  }

  let state: ClickhouseBackupState = ClickhouseBackupState.Succeeded;
  let error: string = "";
  let fileCount: number = 0;
  let totalSizeInBytes: number = 0;
  let filesRead: number = 0;
  let bytesRead: number = 0;

  for (const row of rows) {
    const status: string = String(row["status"] || "");

    if (status.endsWith("_FAILED") || status.endsWith("_CANCELLED")) {
      state = ClickhouseBackupState.Failed;
      error = error || String(row["error"] || status);
    } else if (
      status !== "BACKUP_CREATED" &&
      status !== "RESTORED" &&
      state !== ClickhouseBackupState.Failed
    ) {
      state = ClickhouseBackupState.Running;
    }

    fileCount = Math.max(fileCount, readNumber(row, "num_files"));
    totalSizeInBytes = Math.max(
      totalSizeInBytes,
      readNumber(row, "total_size"),
    );
    filesRead = Math.max(filesRead, readNumber(row, "files_read"));
    bytesRead = Math.max(bytesRead, readNumber(row, "bytes_read"));
  }

  return { state, error, fileCount, totalSizeInBytes, filesRead, bytesRead };
}

export interface ClickhouseBackupEngineOptions {
  // The client the engine uses; defaults to a pool of its own on the "default" database.
  client?: ClickhouseClient | undefined;
  database?: string | undefined;
  cluster?: string | undefined;
  pollIntervalInMs?: number | undefined;
  // A test's ClickHouse reaching the storage at another address.
  endpointOverride?: string | undefined;
}

export default class ClickhouseBackupEngine {
  private client: ClickhouseClient | null;
  public readonly database: string;
  public readonly cluster: string;
  private readonly pollIntervalInMs: number;
  public readonly endpointOverride: string | undefined;

  public constructor(options: ClickhouseBackupEngineOptions = {}) {
    this.client = options.client || null;
    this.database = options.database || getClickhouseDatabaseName();
    this.cluster = options.cluster || getClickhouseClusterName();
    this.pollIntervalInMs =
      options.pollIntervalInMs || CLICKHOUSE_BACKUP_POLL_INTERVAL_IN_MS;
    this.endpointOverride = options.endpointOverride;
  }

  /*
   * A pool of its own, on the "default" database: a restore renames the
   * telemetry database away, and a client whose database is gone fails
   * every query. Its request timeout outlasts a slow distributed DDL.
   */
  private async getClient(): Promise<ClickhouseClient> {
    if (this.client) {
      return this.client;
    }

    const database: ClickhouseDatabase = new ClickhouseDatabase({
      ...ClickhouseAppInstance.getDatasourceOptions(),
      database: "default",
      request_timeout: CLICKHOUSE_DDL_REQUEST_TIMEOUT_IN_MS,
    });

    this.client = await database.connect(database.getDatasourceOptions());

    return this.client;
  }

  private async command(query: string): Promise<void> {
    const client: ClickhouseClient = await this.getClient();
    await client.command({ query });
  }

  private async rows(query: string): Promise<Array<JSONObject>> {
    const client: ClickhouseClient = await this.getClient();
    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({ query, format: "JSONEachRow" });

    return (await result.json()) as Array<JSONObject>;
  }

  private onCluster(): string {
    return ` ON CLUSTER ${clickhouseString(this.cluster)}`;
  }

  public async getServerVersion(): Promise<string> {
    const rows: Array<JSONObject> = await this.rows(
      "SELECT version() AS version",
    );

    return String(rows[0]?.["version"] || "");
  }

  // The telemetry database's size on disk, for the form and the restore dialog.
  public async getDatabaseSizeInBytes(database?: string): Promise<number> {
    const rows: Array<JSONObject> = await this.rows(
      `SELECT sum(bytes_on_disk) AS bytes FROM clusterAllReplicas(${clickhouseString(this.cluster)}, system.parts) WHERE active AND database = ${clickhouseString(database || this.database)}`,
    );

    return readNumber(rows[0] || {}, "bytes");
  }

  public async databaseExists(database: string): Promise<boolean> {
    const rows: Array<JSONObject> = await this.rows(
      `SELECT count() AS count FROM system.databases WHERE name = ${clickhouseString(database)}`,
    );

    return readNumber(rows[0] || {}, "count") > 0;
  }

  public async countTables(database: string): Promise<number> {
    const rows: Array<JSONObject> = await this.rows(
      `SELECT count() AS count FROM system.tables WHERE database = ${clickhouseString(database)}`,
    );

    return readNumber(rows[0] || {}, "count");
  }

  /*
   * Starts a backup of the telemetry database to a folder at the
   * destination and returns at once; waitFor follows it. A structure-only
   * backup (the destination test) writes the tables' definitions alone.
   */
  public async startBackup(data: {
    settings: BackupDestinationSettings;
    folderKey: string;
    id: string;
    structureOnly?: boolean | undefined;
  }): Promise<void> {
    const engine: string = getClickhouseBackupEngine({
      settings: data.settings,
      folderKey: data.folderKey,
      endpointOverride: this.endpointOverride,
    });

    await this.command(
      `BACKUP DATABASE ${clickhouseIdentifier(this.database)}${this.onCluster()} TO ${engine} SETTINGS id = ${clickhouseString(data.id)}${
        data.structureOnly ? ", structure_only = 1" : ""
      } ASYNC`,
    );
  }

  // Starts restoring a backup into the telemetry database (or `asDatabase`).
  public async startRestore(data: {
    settings: BackupDestinationSettings;
    folderKey: string;
    id: string;
    sourceDatabase: string;
    asDatabase?: string | undefined;
    structureOnly?: boolean | undefined;
  }): Promise<void> {
    const engine: string = getClickhouseBackupEngine({
      settings: data.settings,
      folderKey: data.folderKey,
      endpointOverride: this.endpointOverride,
    });
    const target: string =
      data.asDatabase && data.asDatabase !== data.sourceDatabase
        ? ` AS ${clickhouseIdentifier(data.asDatabase)}`
        : "";

    await this.command(
      `RESTORE DATABASE ${clickhouseIdentifier(data.sourceDatabase)}${target}${this.onCluster()} FROM ${engine} SETTINGS id = ${clickhouseString(data.id)}${
        data.structureOnly ? ", structure_only = 1" : ""
      } ASYNC`,
    );
  }

  public async getStatus(id: string): Promise<ClickhouseBackupStatus> {
    const rows: Array<JSONObject> = await this.rows(
      `SELECT status, error, num_files, total_size, files_read, bytes_read FROM clusterAllReplicas(${clickhouseString(this.cluster)}, system.backups) WHERE id = ${clickhouseString(id)}`,
    );

    return aggregateClickhouseBackupRows(rows);
  }

  /*
   * Waits until every replica is done with the operation, reporting how it
   * goes. Throws with ClickHouse's own words (describeClickhouseBackupError)
   * when it fails, and when no replica knows it any more (ClickHouse was
   * restarted while it ran). `shouldStop` is asked between polls; the
   * operation is then left to finish on its own.
   */
  public async waitFor(data: {
    id: string;
    onProgress?: ((status: ClickhouseBackupStatus) => void) | undefined;
    shouldStop?: (() => boolean) | undefined;
    missingGraceInMs?: number | undefined;
  }): Promise<ClickhouseBackupStatus> {
    const startedAt: number = Date.now();
    const missingGrace: number = data.missingGraceInMs ?? 30 * 1000;

    for (;;) {
      let status: ClickhouseBackupStatus;

      try {
        status = await this.getStatus(data.id);
      } catch (error) {
        throw new Error(
          `Could not ask ClickHouse how the backup is going: ${errorText(error)}.`,
        );
      }

      if (status.state === ClickhouseBackupState.Succeeded) {
        data.onProgress?.(status);
        return status;
      }

      if (status.state === ClickhouseBackupState.Failed) {
        throw new Error(describeClickhouseBackupError(status.error));
      }

      if (
        status.state === ClickhouseBackupState.Missing &&
        Date.now() - startedAt > missingGrace
      ) {
        throw new Error(
          "ClickHouse no longer knows this backup: it may have restarted while the backup ran. Try again.",
        );
      }

      data.onProgress?.(status);

      if (data.shouldStop?.()) {
        throw new Error("Stopped while ClickHouse was still working.");
      }

      await sleep(this.pollIntervalInMs);
    }
  }

  // RENAME DATABASE a TO b ON CLUSTER: every node at once.
  public async renameDatabase(from: string, to: string): Promise<void> {
    await this.command(
      `RENAME DATABASE ${clickhouseIdentifier(from)} TO ${clickhouseIdentifier(to)}${this.onCluster()}`,
    );
  }

  public async dropDatabase(database: string): Promise<void> {
    await this.command(
      `DROP DATABASE IF EXISTS ${clickhouseIdentifier(database)}${this.onCluster()} SYNC`,
    );
  }

  /*
   * Drops a database's materialized views. Run on the database a restore
   * sets aside, at once: its views name their source and target tables by
   * the original database's name, and once ClickHouse restarts they would
   * bind to the restored tables and write every insert into them a second
   * time. The views are derived; createMaterializedViews brings them back
   * if the database is ever put back.
   */
  public async dropMaterializedViews(database: string): Promise<number> {
    const rows: Array<JSONObject> = await this.rows(
      `SELECT name FROM system.tables WHERE database = ${clickhouseString(database)} AND engine = 'MaterializedView'`,
    );

    for (const row of rows) {
      await this.command(
        `DROP VIEW IF EXISTS ${clickhouseIdentifier(database)}.${clickhouseIdentifier(String(row["name"] || ""))}${this.onCluster()} SYNC`,
      );
    }

    return rows.length;
  }
}
