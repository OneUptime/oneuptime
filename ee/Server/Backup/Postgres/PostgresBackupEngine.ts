import { createHash, Hash } from "crypto";
import { PassThrough, Readable, Transform, TransformCallback } from "stream";
import PostgresAdminConnection, {
  PostgresAdminClient,
  PostgresConnectionTarget,
  PostgresRow,
} from "Common/Server/Infrastructure/Postgres/PostgresAdminConnection";
import { BackupPostgresCounts } from "Common/Types/Backup/BackupManifest";
import { errorText, sleep } from "../Storage/BackupHttp";
import { BackupUploadResult } from "../Storage/BackupStorage";
import {
  buildPostgresToolEnvironment,
  findPostgresToolSets,
  getPostgresMajor,
  getToolProcessBaseEnvironment,
  pickPostgresToolSet,
  PostgresToolEnvironment,
  PostgresToolSet,
  StartedTool,
  startPostgresTool,
  summarizeToolError,
  ToolRun,
} from "./PostgresTools";

/*
 * PostgreSQL's half of a backup and a restore.
 *
 * A backup is one pg_dump in its custom format, streamed from pg_dump's
 * stdout straight into the storage's multipart upload: nothing is written
 * to the server's disk, whatever the database's size. pg_dump reads the
 * whole database in one transaction (REPEATABLE READ), so the dump is the
 * database as it was at one moment while OneUptime keeps running. The
 * upload is only finished once pg_dump has exited cleanly: a dump that
 * fails half way never becomes a file at the destination.
 *
 * A restore never touches the live database until the end: the backup is
 * streamed into pg_restore, into a new database beside it (with no owner
 * or privilege statements of its own, so it belongs to OneUptime's user),
 * checked, and only then switched in - the live database renamed aside,
 * the restored one renamed to its name - in a moment, with connections to
 * it refused and the open ones ended for that moment. OneUptime keeps
 * working on the current data while the restore runs, and reconnects to the
 * restored data right after the switch. The user needs CREATEDB (OneUptime's
 * bundled PostgreSQL connects as a superuser, which has it).
 */

// What pg_dump waits for a table's lock before giving up, in ms.
const DUMP_LOCK_WAIT_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// How long the switch waits for the connections it ended to go.
const SWITCH_CONNECTIONS_WAIT_IN_MS: number = 15 * 1000;

export interface PostgresServerInfo {
  versionNum: number;
  major: number;
  version: string;
  database: string;
  sizeInBytes: number;
  user: string;
  isSuperuser: boolean;
  canCreateDatabases: boolean;
  owner: string;
  encoding: string;
}

function readNumber(row: PostgresRow | undefined, key: string): number {
  const value: unknown = row?.[key];
  const number: number =
    typeof value === "number" ? value : Number(String(value ?? ""));

  return Number.isFinite(number) ? number : 0;
}

function readText(row: PostgresRow | undefined, key: string): string {
  const value: unknown = row?.[key];

  return value === null || value === undefined ? "" : String(value);
}

/*
 * A database name with a suffix, cut to PostgreSQL's 63-byte limit on the
 * original's side: oneuptimedb -> oneuptimedb_restore_3f2a9c1b.
 */
export function getSuffixedDatabaseName(base: string, suffix: string): string {
  const maxBaseLength: number = 63 - suffix.length;
  let name: string = base;

  while (Buffer.byteLength(name, "utf8") > maxBaseLength) {
    name = name.slice(0, -1);
  }

  return `${name}${suffix}`;
}

// A stream that passes bytes through, taking their SHA-256 and counting them.
export class HashingStream extends Transform {
  private readonly hash: Hash = createHash("sha256");
  public bytes: number = 0;
  private digestValue: string | null = null;
  private readonly onBytes: ((bytes: number) => void) | undefined;

  public constructor(onBytes?: ((bytes: number) => void) | undefined) {
    super();
    this.onBytes = onBytes;
  }

  public override _transform(
    chunk: Buffer,
    _encoding: string,
    callback: TransformCallback,
  ): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.onBytes?.(this.bytes);
    callback(null, chunk);
  }

  public digest(): string {
    if (this.digestValue === null) {
      this.digestValue = this.hash.digest("hex");
    }

    return this.digestValue;
  }
}

export interface PostgresBackupEngineOptions {
  target?: PostgresConnectionTarget | undefined;
  // A test seam: the tools to use instead of the ones found on this server.
  toolSets?: Array<PostgresToolSet> | undefined;
  // The database the switch runs on: postgres, else template1.
  maintenanceDatabases?: Array<string> | undefined;
}

export default class PostgresBackupEngine {
  public readonly target: PostgresConnectionTarget;
  private toolSets: Array<PostgresToolSet> | null;
  private readonly maintenanceDatabases: Array<string>;

  public constructor(options: PostgresBackupEngineOptions = {}) {
    this.target = options.target || PostgresAdminConnection.getAppTarget();
    this.toolSets = options.toolSets || null;
    this.maintenanceDatabases = options.maintenanceDatabases || [
      "postgres",
      "template1",
    ];
  }

  public async getToolSets(): Promise<Array<PostgresToolSet>> {
    if (!this.toolSets) {
      this.toolSets = await findPostgresToolSets();
    }

    return this.toolSets;
  }

  private async withDatabase<T>(
    database: string,
    run: (client: PostgresAdminClient) => Promise<T>,
  ): Promise<T> {
    return await PostgresAdminConnection.withClient(
      PostgresAdminConnection.onDatabase(this.target, database),
      run,
    );
  }

  // The maintenance database the switch connects to: the first that opens.
  private async withMaintenanceDatabase<T>(
    run: (client: PostgresAdminClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown = null;

    for (const database of this.maintenanceDatabases) {
      try {
        return await this.withDatabase(database, run);
      } catch (error) {
        lastError = error;

        if (!errorText(error).includes("does not exist")) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  public async getServerInfo(): Promise<PostgresServerInfo> {
    return await this.withDatabase(
      this.target.database,
      async (client: PostgresAdminClient): Promise<PostgresServerInfo> => {
        const rows: Array<PostgresRow> = await client.query(
          `SELECT current_setting('server_version_num')::int AS version_num,
                  current_setting('server_version') AS version,
                  current_database() AS database,
                  pg_database_size(current_database()) AS size,
                  current_user AS user_name,
                  r.rolsuper AS is_superuser,
                  r.rolcreatedb AS can_create_databases,
                  pg_get_userbyid(d.datdba) AS owner,
                  pg_encoding_to_char(d.encoding) AS encoding
             FROM pg_roles r, pg_database d
            WHERE r.rolname = current_user AND d.datname = current_database()`,
        );
        const row: PostgresRow | undefined = rows[0];
        const versionNum: number = readNumber(row, "version_num");

        return {
          versionNum,
          major: getPostgresMajor(versionNum),
          version: readText(row, "version").split(" ")[0] || "",
          database: readText(row, "database"),
          sizeInBytes: readNumber(row, "size"),
          user: readText(row, "user_name"),
          isSuperuser: row?.["is_superuser"] === true,
          canCreateDatabases: row?.["can_create_databases"] === true,
          owner: readText(row, "owner"),
          encoding: readText(row, "encoding") || "UTF8",
        };
      },
    );
  }

  /*
   * How many of the records people recognise a database holds - what the
   * restore dialog says a backup has - and the newest schema migration it
   * ran. A table the database does not have counts nothing.
   */
  public async getContents(database?: string): Promise<{
    counts: BackupPostgresCounts;
    lastMigration: string | null;
  }> {
    return await this.withDatabase(
      database || this.target.database,
      async (
        client: PostgresAdminClient,
      ): Promise<{
        counts: BackupPostgresCounts;
        lastMigration: string | null;
      }> => {
        const count: (
          table: string,
          where: string,
        ) => Promise<number | undefined> = async (
          table: string,
          where: string,
        ): Promise<number | undefined> => {
          const exists: Array<PostgresRow> = await client.query(
            "SELECT to_regclass($1) IS NOT NULL AS present",
            [`public."${table}"`],
          );

          if (exists[0]?.["present"] !== true) {
            return undefined;
          }

          const rows: Array<PostgresRow> = await client.query(
            `SELECT count(*) AS count FROM public.${PostgresAdminConnection.quoteIdentifier(table)}${where}`,
          );

          return readNumber(rows[0], "count");
        };

        const notDeleted: string = ` WHERE "deletedAt" IS NULL`;
        const counts: BackupPostgresCounts = {};
        const projects: number | undefined = await count("Project", notDeleted);
        const users: number | undefined = await count("User", notDeleted);
        const monitors: number | undefined = await count("Monitor", notDeleted);
        const statusPages: number | undefined = await count(
          "StatusPage",
          notDeleted,
        );

        if (projects !== undefined) {
          counts.projects = projects;
        }
        if (users !== undefined) {
          counts.users = users;
        }
        if (monitors !== undefined) {
          counts.monitors = monitors;
        }
        if (statusPages !== undefined) {
          counts.statusPages = statusPages;
        }

        let lastMigration: string | null = null;
        const hasMigrations: Array<PostgresRow> = await client.query(
          "SELECT to_regclass('public.migrations') IS NOT NULL AS present",
        );

        if (hasMigrations[0]?.["present"] === true) {
          const rows: Array<PostgresRow> = await client.query(
            "SELECT name FROM public.migrations ORDER BY timestamp DESC, id DESC LIMIT 1",
          );
          lastMigration = readText(rows[0], "name") || null;
        }

        return { counts, lastMigration };
      },
    );
  }

  /*
   * Dumps the database into `upload`. The upload reads pg_dump's output as
   * it comes and is held open until pg_dump has exited: on success it ends
   * and the upload finishes; on failure the stream errors, so the upload
   * is abandoned and nothing half-written stays.
   */
  public async dump(data: {
    upload: (source: Readable) => Promise<BackupUploadResult>;
    signal?: AbortSignal | undefined;
  }): Promise<{
    result: BackupUploadResult;
    toolVersion: string;
    serverVersion: string;
    serverInfo: PostgresServerInfo;
  }> {
    const serverInfo: PostgresServerInfo = await this.getServerInfo();
    const tools: PostgresToolSet = pickPostgresToolSet({
      toolSets: await this.getToolSets(),
      serverMajor: serverInfo.major,
    });
    const environment: PostgresToolEnvironment = buildPostgresToolEnvironment(
      this.target,
    );

    try {
      const tool: StartedTool = startPostgresTool({
        binary: tools.pgDump,
        args: [
          "--format=custom",
          "--compress=6",
          "--no-password",
          `--lock-wait-timeout=${DUMP_LOCK_WAIT_TIMEOUT_IN_MS}`,
        ],
        env: environment.env,
        stdin: "ignore",
        stdout: "pipe",
        signal: data.signal,
      });

      // Held open until pg_dump has said how it went.
      const gated: PassThrough = new PassThrough();
      tool.stdout!.pipe(gated, { end: false });

      const exited: Promise<ToolRun> = tool.done.then((run: ToolRun) => {
        if (run.exitCode === 0) {
          gated.end();
        } else {
          gated.destroy(
            new Error(
              `pg_dump failed: ${summarizeToolError(run.stderr) || `it stopped (${run.signal || `exit code ${run.exitCode}`})`}.`,
            ),
          );
        }

        return run;
      });

      let result: BackupUploadResult;

      try {
        result = await data.upload(gated);
      } catch (error) {
        /*
         * Whichever failed first: pg_dump (its error reached the upload
         * through the stream) or the storage (pg_dump is stopped here).
         */
        tool.process.kill("SIGTERM");
        await exited;
        throw error;
      }

      await exited;

      return {
        result,
        toolVersion: tools.version,
        serverVersion: serverInfo.version,
        serverInfo,
      };
    } finally {
      environment.cleanUp();
    }
  }

  /*
   * Reads an archive's table of contents with pg_restore --list from a
   * stream: the check that a backup at the destination is a pg_dump archive
   * pg_restore can read. The table of contents is at the start, so only
   * that is read; the stream is closed as soon as pg_restore is done.
   * Answers how many entries it lists.
   */
  public async readArchiveContents(data: {
    source: Readable;
    archiveMajor?: number | undefined;
  }): Promise<number> {
    const serverInfo: PostgresServerInfo = await this.getServerInfo();
    const tools: PostgresToolSet = pickPostgresToolSet({
      toolSets: await this.getToolSets(),
      serverMajor: serverInfo.major,
      atLeastMajor: data.archiveMajor,
    });

    // --list reads the archive alone: no connection, so no connection settings.
    const tool: StartedTool = startPostgresTool({
      binary: tools.pgRestore,
      args: ["--list"],
      env: getToolProcessBaseEnvironment(),
      stdin: "pipe",
      stdout: "pipe",
    });

    let listing: string = "";

    tool.stdout!.on("data", (chunk: Buffer) => {
      if (listing.length < 4 * 1024 * 1024) {
        listing += chunk.toString("utf8");
      }
    });

    // pg_restore stops reading once the contents are listed: that is no error.
    tool.stdin!.on("error", () => {
      data.source.destroy();
    });
    data.source.on("error", () => {
      tool.stdin!.destroy();
    });
    data.source.pipe(tool.stdin!);

    const run: ToolRun = await tool.done;
    data.source.destroy();

    if (run.exitCode !== 0) {
      throw new Error(
        `pg_restore could not read the backup: ${summarizeToolError(run.stderr) || `exit code ${run.exitCode}`}.`,
      );
    }

    return listing.split("\n").filter((line: string): boolean => {
      const trimmed: string = line.trim();

      return Boolean(trimmed) && !trimmed.startsWith(";");
    }).length;
  }

  public async databaseExists(name: string): Promise<boolean> {
    return await this.withMaintenanceDatabase(
      async (client: PostgresAdminClient): Promise<boolean> => {
        const rows: Array<PostgresRow> = await client.query(
          "SELECT 1 AS present FROM pg_database WHERE datname = $1",
          [name],
        );

        return rows.length > 0;
      },
    );
  }

  // A new, empty database for a restore, with the live one's encoding.
  public async createDatabase(data: {
    name: string;
    encoding: string;
  }): Promise<void> {
    await this.withMaintenanceDatabase(
      async (client: PostgresAdminClient): Promise<void> => {
        await client.query(
          `CREATE DATABASE ${PostgresAdminConnection.quoteIdentifier(data.name)} WITH TEMPLATE template0 ENCODING '${data.encoding.split("'").join("''")}'`,
        );
      },
    );
  }

  // Drops a database the backups made, ending anything still connected to it.
  public async dropDatabase(name: string): Promise<void> {
    await this.withMaintenanceDatabase(
      async (client: PostgresAdminClient): Promise<void> => {
        await client.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [name],
        );
        await client.query(
          `DROP DATABASE IF EXISTS ${PostgresAdminConnection.quoteIdentifier(name)}`,
        );
      },
    );
  }

  /*
   * Streams an archive into pg_restore, into `database` (a new, empty one),
   * taking the archive's SHA-256 on the way. pg_restore writes no owner and
   * no privileges of the backup's own (the restored database belongs to
   * OneUptime's user), and stops at the first error. Answers the SHA-256 and
   * how many bytes it read.
   */
  public async restoreInto(data: {
    database: string;
    source: Readable;
    archiveMajor?: number | undefined;
    onProgress?: ((bytes: number) => void) | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<{ sha256: string; bytes: number }> {
    const serverInfo: PostgresServerInfo = await this.getServerInfo();
    const tools: PostgresToolSet = pickPostgresToolSet({
      toolSets: await this.getToolSets(),
      serverMajor: serverInfo.major,
      atLeastMajor: data.archiveMajor,
    });
    const environment: PostgresToolEnvironment = buildPostgresToolEnvironment(
      PostgresAdminConnection.onDatabase(this.target, data.database),
    );

    try {
      const tool: StartedTool = startPostgresTool({
        binary: tools.pgRestore,
        args: [
          `--dbname=${data.database}`,
          "--no-password",
          "--no-owner",
          "--no-acl",
          "--no-comments",
          "--no-publications",
          "--no-subscriptions",
          "--no-security-labels",
          "--exit-on-error",
        ],
        env: environment.env,
        stdin: "pipe",
        stdout: "ignore",
        signal: data.signal,
      });

      const hashing: HashingStream = new HashingStream(data.onProgress);
      let sourceError: unknown = null;

      data.source.on("error", (error: unknown) => {
        sourceError = sourceError || error;
        tool.stdin!.destroy();
      });
      tool.stdin!.on("error", () => {
        // pg_restore stopped reading: its exit says why.
        data.source.destroy();
      });

      data.source.pipe(hashing).pipe(tool.stdin!);

      const run: ToolRun = await tool.done;

      if (sourceError) {
        throw new Error(
          `The backup could not be read from the storage: ${errorText(sourceError)}.`,
        );
      }

      if (run.exitCode !== 0) {
        throw new Error(
          `pg_restore failed: ${summarizeToolError(run.stderr) || `it stopped (${run.signal || `exit code ${run.exitCode}`})`}.`,
        );
      }

      return { sha256: hashing.digest(), bytes: hashing.bytes };
    } finally {
      environment.cleanUp();
    }
  }

  /*
   * Puts the restored database in the live one's place: connections to the
   * live database are refused and the open ones ended (OneUptime's pools
   * reconnect a moment later), the live database is renamed aside, and the
   * restored one takes its name. If anything fails half way, the live
   * database gets its name back and takes connections again. Runs on the
   * maintenance database: neither database may have a connection of ours.
   */
  public async switchOver(data: {
    live: string;
    restored: string;
    setAside: string;
  }): Promise<void> {
    await this.withMaintenanceDatabase(
      async (client: PostgresAdminClient): Promise<void> => {
        const quote: (name: string) => string =
          PostgresAdminConnection.quoteIdentifier;
        let isLiveRenamed: boolean = false;

        try {
          await client.query(
            `ALTER DATABASE ${quote(data.live)} WITH ALLOW_CONNECTIONS false`,
          );

          const deadline: number = Date.now() + SWITCH_CONNECTIONS_WAIT_IN_MS;

          for (;;) {
            await client.query(
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ANY($1) AND pid <> pg_backend_pid()",
              [[data.live, data.restored]],
            );

            const rows: Array<PostgresRow> = await client.query(
              "SELECT count(*) AS count FROM pg_stat_activity WHERE datname = ANY($1) AND pid <> pg_backend_pid()",
              [[data.live, data.restored]],
            );

            if (readNumber(rows[0], "count") === 0) {
              break;
            }

            if (Date.now() > deadline) {
              throw new Error(
                `Connections to ${data.live} did not close within ${SWITCH_CONNECTIONS_WAIT_IN_MS / 1000} seconds.`,
              );
            }

            await sleep(250);
          }

          await client.query(
            `ALTER DATABASE ${quote(data.live)} RENAME TO ${quote(data.setAside)}`,
          );
          isLiveRenamed = true;

          await client.query(
            `ALTER DATABASE ${quote(data.restored)} RENAME TO ${quote(data.live)}`,
          );

          await client.query(
            `ALTER DATABASE ${quote(data.setAside)} WITH ALLOW_CONNECTIONS true`,
          );
        } catch (error) {
          // Put the live database back as it was.
          try {
            if (isLiveRenamed) {
              await client.query(
                `ALTER DATABASE ${quote(data.setAside)} RENAME TO ${quote(data.live)}`,
              );
            }

            await client.query(
              `ALTER DATABASE ${quote(data.live)} WITH ALLOW_CONNECTIONS true`,
            );
          } catch {
            // The original error says what happened; the run's error says what to check.
          }

          throw new Error(
            `Could not switch to the restored database: ${errorText(error)}. The current database was kept.`,
          );
        }
      },
    );
  }
}
