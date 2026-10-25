import { createHash } from "crypto";
import { Readable } from "stream";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import { BackupPostgresCounts } from "Common/Types/Backup/BackupManifest";
import ClickhouseBackupEngine, {
  ClickhouseBackupState,
  ClickhouseBackupStatus,
} from "../../../../Server/Backup/ClickHouse/ClickhouseBackupEngine";
import PostgresBackupEngine, {
  PostgresServerInfo,
} from "../../../../Server/Backup/Postgres/PostgresBackupEngine";
import { PostgresToolSet } from "../../../../Server/Backup/Postgres/PostgresTools";
import { BackupUploadResult } from "../../../../Server/Backup/Storage/BackupStorage";
import MemoryBackupStorage from "./MemoryBackupStorage";

/*
 * The two databases a backup copies, as models a test can look into: a
 * PostgreSQL server of named databases (each a set of tables of rows) and
 * a ClickHouse server of named databases (rows and materialized views),
 * behind the engines' own methods - so the runner's suites follow a
 * backup and a restore through every step and then ask what the databases
 * hold, without pg_dump or ClickHouse. The engines' real behaviour is held
 * by their own suites (ClickhouseBackupEngine, the Postgres suite).
 *
 * A dump is the database as JSON (behind pg_dump's PGDMP magic); ClickHouse
 * "writes" a backup to the storage itself, as it does: its parts and its
 * .backup record. Not a test file itself.
 */

export type PostgresTables = Record<string, Array<Record<string, unknown>>>;

const DUMP_MAGIC: string = "PGDMP";

export class FakePostgresEngine {
  public readonly target: { database: string };
  public databases: Map<string, PostgresTables> = new Map<
    string,
    PostgresTables
  >();
  public serverInfo: PostgresServerInfo;
  public toolSets: Array<PostgresToolSet> = [
    {
      directory: "/usr/libexec/postgresql16",
      major: 16,
      version: "16.4",
      pgDump: "/usr/libexec/postgresql16/pg_dump",
      pgRestore: "/usr/libexec/postgresql16/pg_restore",
    },
  ];
  // Throws this from the next call of a method.
  public failures: Map<string, Error> = new Map<string, Error>();
  public readonly calls: Array<string> = [];
  // Bytes pg_dump writes before it fails, when it fails half way.
  public dumpFailsAfterBytes: number | null = null;

  public constructor(database: string = "oneuptimedb") {
    this.target = { database };
    this.databases.set(database, {
      Project: [{ name: "Acme" }, { name: "Globex" }],
      User: [{ email: "ada@example.com" }],
      Monitor: [{ name: "Home page" }, { name: "API" }, { name: "Checkout" }],
      StatusPage: [{ name: "Status" }],
      migrations: [{ name: "AddBackups1807400000000" }],
    });
    this.serverInfo = {
      versionNum: 160004,
      major: 16,
      version: "16.4",
      database,
      sizeInBytes: 12 * 1024 * 1024,
      user: "postgres",
      isSuperuser: true,
      canCreateDatabases: true,
      owner: "postgres",
      encoding: "UTF8",
    };
  }

  private failIfAsked(method: string): void {
    this.calls.push(method);
    const failure: Error | undefined = this.failures.get(method);

    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  public asEngine(): PostgresBackupEngine {
    return this as unknown as PostgresBackupEngine;
  }

  public live(): PostgresTables {
    return this.databases.get(this.target.database)!;
  }

  public async getServerInfo(): Promise<PostgresServerInfo> {
    this.failIfAsked("getServerInfo");
    return { ...this.serverInfo };
  }

  public async getToolSets(): Promise<Array<PostgresToolSet>> {
    this.failIfAsked("getToolSets");
    return this.toolSets;
  }

  public async getContents(database?: string): Promise<{
    counts: BackupPostgresCounts;
    lastMigration: string | null;
  }> {
    this.failIfAsked("getContents");

    const tables: PostgresTables =
      this.databases.get(database || this.target.database) || {};
    const counts: BackupPostgresCounts = {};

    if (tables["Project"]) {
      counts.projects = tables["Project"].length;
    }
    if (tables["User"]) {
      counts.users = tables["User"].length;
    }
    if (tables["Monitor"]) {
      counts.monitors = tables["Monitor"].length;
    }
    if (tables["StatusPage"]) {
      counts.statusPages = tables["StatusPage"].length;
    }

    const migrations: Array<Record<string, unknown>> =
      tables["migrations"] || [];

    return {
      counts,
      lastMigration: migrations.length
        ? String(migrations[migrations.length - 1]!["name"])
        : null,
    };
  }

  public async dump(data: {
    upload: (source: Readable) => Promise<BackupUploadResult>;
    signal?: AbortSignal | undefined;
  }): Promise<{
    result: BackupUploadResult;
    toolVersion: string;
    serverVersion: string;
    serverInfo: PostgresServerInfo;
  }> {
    this.failIfAsked("dump");

    const archive: Buffer = Buffer.from(
      `${DUMP_MAGIC}${JSON.stringify(this.live())}`,
      "utf8",
    );
    const failAfter: number | null = this.dumpFailsAfterBytes;

    const source: Readable = new Readable({
      read(): void {
        if (failAfter !== null) {
          this.push(archive.subarray(0, failAfter));
          this.destroy(
            new Error(
              "pg_dump failed: pg_dump: error: query failed: SSL connection has been closed unexpectedly.",
            ),
          );
          return;
        }

        this.push(archive);
        this.push(null);
      },
    });

    const result: BackupUploadResult = await data.upload(source);

    return {
      result,
      toolVersion: "16.4",
      serverVersion: this.serverInfo.version,
      serverInfo: { ...this.serverInfo },
    };
  }

  public async readArchiveContents(data: {
    source: Readable;
    archiveMajor?: number | undefined;
  }): Promise<number> {
    this.failIfAsked("readArchiveContents");

    const bytes: Buffer = await readAll(data.source);
    const text: string = bytes.toString("utf8");

    if (!text.startsWith(DUMP_MAGIC)) {
      throw new Error(
        "pg_restore could not read the backup: pg_restore: error: input file does not appear to be a valid archive.",
      );
    }

    return Object.keys(JSON.parse(text.slice(DUMP_MAGIC.length))).length;
  }

  public async databaseExists(name: string): Promise<boolean> {
    this.failIfAsked("databaseExists");
    return this.databases.has(name);
  }

  public async createDatabase(data: {
    name: string;
    encoding: string;
  }): Promise<void> {
    this.failIfAsked("createDatabase");

    if (this.databases.has(data.name)) {
      throw new Error(`database "${data.name}" already exists`);
    }

    this.databases.set(data.name, {});
  }

  public async dropDatabase(name: string): Promise<void> {
    this.failIfAsked("dropDatabase");
    this.databases.delete(name);
  }

  public async restoreInto(data: {
    database: string;
    source: Readable;
    archiveMajor?: number | undefined;
    onProgress?: ((bytes: number) => void) | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<{ sha256: string; bytes: number }> {
    this.failIfAsked("restoreInto");

    const bytes: Buffer = await readAll(data.source);
    data.onProgress?.(bytes.length);

    const text: string = bytes.toString("utf8");

    if (!text.startsWith(DUMP_MAGIC)) {
      throw new Error(
        "pg_restore failed: pg_restore: error: input file does not appear to be a valid archive.",
      );
    }

    this.databases.set(
      data.database,
      JSON.parse(text.slice(DUMP_MAGIC.length)) as PostgresTables,
    );

    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
  }

  public async switchOver(data: {
    live: string;
    restored: string;
    setAside: string;
  }): Promise<void> {
    this.failIfAsked("switchOver");

    const live: PostgresTables | undefined = this.databases.get(data.live);
    const restored: PostgresTables | undefined = this.databases.get(
      data.restored,
    );

    if (!live || !restored) {
      throw new Error(
        `Could not switch to the restored database: database "${!live ? data.live : data.restored}" does not exist. The current database was kept.`,
      );
    }

    this.databases.delete(data.live);
    this.databases.delete(data.restored);
    this.databases.set(data.setAside, live);
    this.databases.set(data.live, restored);
  }
}

export interface ClickhouseDatabaseModel {
  rows: number;
  views: number;
  tables: number;
}

export class FakeClickhouseEngine {
  public readonly database: string;
  public readonly cluster: string = "oneuptime";
  public databases: Map<string, ClickhouseDatabaseModel> = new Map<
    string,
    ClickhouseDatabaseModel
  >();
  public operations: Map<string, ClickhouseBackupStatus> = new Map<
    string,
    ClickhouseBackupStatus
  >();
  public failures: Map<string, Error> = new Map<string, Error>();
  public readonly calls: Array<string> = [];
  // The next operation started ends with this ClickHouse error.
  public nextOperationError: string | null = null;
  private readonly storage: MemoryBackupStorage;

  public constructor(
    storage: MemoryBackupStorage,
    database: string = "oneuptime",
  ) {
    this.storage = storage;
    this.database = database;
    this.databases.set(database, { rows: 100000, views: 3, tables: 20 });
  }

  public asEngine(): ClickhouseBackupEngine {
    return this as unknown as ClickhouseBackupEngine;
  }

  private failIfAsked(method: string): void {
    this.calls.push(method);
    const failure: Error | undefined = this.failures.get(method);

    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  private finish(id: string, status: Partial<ClickhouseBackupStatus>): void {
    const error: string | null = this.nextOperationError;
    this.nextOperationError = null;

    this.operations.set(id, {
      state: error
        ? ClickhouseBackupState.Failed
        : ClickhouseBackupState.Succeeded,
      error: error || "",
      fileCount: 0,
      totalSizeInBytes: 0,
      filesRead: 0,
      bytesRead: 0,
      ...status,
    });
  }

  public async getServerVersion(): Promise<string> {
    this.failIfAsked("getServerVersion");
    return "25.3.2.39";
  }

  public async getDatabaseSizeInBytes(database?: string): Promise<number> {
    this.failIfAsked("getDatabaseSizeInBytes");
    return (this.databases.get(database || this.database)?.rows || 0) * 20;
  }

  public async databaseExists(database: string): Promise<boolean> {
    this.failIfAsked("databaseExists");
    return this.databases.has(database);
  }

  public async countTables(database: string): Promise<number> {
    this.failIfAsked("countTables");
    return this.databases.get(database)?.tables || 0;
  }

  public async startBackup(data: {
    settings: BackupDestinationSettings;
    folderKey: string;
    id: string;
    structureOnly?: boolean | undefined;
  }): Promise<void> {
    this.failIfAsked("startBackup");

    const model: ClickhouseDatabaseModel = this.databases.get(this.database)!;
    const willFail: boolean = Boolean(this.nextOperationError);

    if (!willFail) {
      const rows: number = data.structureOnly ? 0 : model.rows;
      this.storage.write(
        `${data.folderKey}data/parts.bin`,
        Buffer.alloc(Math.max(1, Math.floor(rows / 1000)), 7),
      );
      this.storage.write(
        `${data.folderKey}.backup`,
        JSON.stringify({ database: this.database, rows, tables: model.tables }),
      );
    }

    this.finish(data.id, { fileCount: 2, totalSizeInBytes: model.rows * 20 });
  }

  public async startRestore(data: {
    settings: BackupDestinationSettings;
    folderKey: string;
    id: string;
    sourceDatabase: string;
    asDatabase?: string | undefined;
    structureOnly?: boolean | undefined;
  }): Promise<void> {
    this.failIfAsked("startRestore");

    const target: string = data.asDatabase || data.sourceDatabase;
    const record: Buffer | null = await this.storage.readSmallObject(
      `${data.folderKey}.backup`,
      1024 * 1024,
    );

    if (!record) {
      this.nextOperationError =
        this.nextOperationError ||
        "Code: 598. DB::Exception: Backup not found (BACKUP_NOT_FOUND)";
    }

    if (!this.nextOperationError) {
      const backup: { rows: number; tables: number } = JSON.parse(
        record!.toString("utf8"),
      ) as { rows: number; tables: number };

      if (this.databases.has(target) && !data.structureOnly) {
        this.nextOperationError = `Code: 82. DB::Exception: Database ${target} already exists (DATABASE_ALREADY_EXISTS)`;
      } else {
        this.databases.set(target, {
          rows: data.structureOnly ? 0 : backup.rows,
          views: data.structureOnly ? 0 : 3,
          tables: backup.tables,
        });
      }
    }

    this.finish(data.id, { filesRead: 2, bytesRead: 2000 });
  }

  public async waitFor(data: {
    id: string;
    onProgress?: ((status: ClickhouseBackupStatus) => void) | undefined;
    shouldStop?: (() => boolean) | undefined;
  }): Promise<ClickhouseBackupStatus> {
    this.failIfAsked("waitFor");

    const status: ClickhouseBackupStatus | undefined = this.operations.get(
      data.id,
    );

    if (!status) {
      throw new Error(
        "ClickHouse no longer knows this backup: it may have restarted while the backup ran. Try again.",
      );
    }

    if (status.state === ClickhouseBackupState.Failed) {
      throw new Error(`ClickHouse said: ${status.error}.`);
    }

    data.onProgress?.(status);

    return status;
  }

  public async renameDatabase(from: string, to: string): Promise<void> {
    this.failIfAsked("renameDatabase");

    const model: ClickhouseDatabaseModel | undefined = this.databases.get(from);

    if (!model) {
      throw new Error(`Database ${from} does not exist (UNKNOWN_DATABASE)`);
    }

    if (this.databases.has(to)) {
      throw new Error(
        `Database ${to} already exists (DATABASE_ALREADY_EXISTS)`,
      );
    }

    this.databases.delete(from);
    this.databases.set(to, model);
  }

  public async dropDatabase(database: string): Promise<void> {
    this.failIfAsked("dropDatabase");
    this.databases.delete(database);
  }

  public async dropMaterializedViews(database: string): Promise<number> {
    this.failIfAsked("dropMaterializedViews");

    const model: ClickhouseDatabaseModel | undefined =
      this.databases.get(database);
    const views: number = model?.views || 0;

    if (model) {
      model.views = 0;
    }

    return views;
  }
}

async function readAll(source: Readable): Promise<Buffer> {
  const chunks: Array<Buffer> = [];

  for await (const chunk of source) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return Buffer.concat(chunks);
}
