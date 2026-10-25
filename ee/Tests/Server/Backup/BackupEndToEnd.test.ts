import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import BackupCatalogSync from "../../../Server/Backup/BackupCatalogSync";
import {
  BackupTestResult,
  testBackupDestination,
} from "../../../Server/Backup/BackupDestinationTest";
import BackupRunner from "../../../Server/Backup/BackupRunner";
import RestoreRunner from "../../../Server/Backup/RestoreRunner";
import BackupStorageFactory from "../../../Server/Backup/Storage/BackupStorageFactory";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import PostgresAdminConnection, {
  PostgresAdminClient,
  PostgresRow,
} from "Common/Server/Infrastructure/Postgres/PostgresAdminConnection";
import Redis from "Common/Server/Infrastructure/Redis";
import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";

/*
 * A REAL BACKUP AND A REAL RESTORE, END TO END: the production runner on a
 * migrated PostgreSQL, a ClickHouse with OneUptime's telemetry tables, and
 * an S3-compatible storage (MinIO) - the destination tested, a backup
 * made, the live data changed, the backup found again, and restored, the
 * current data backed up first - then the databases read back.
 *
 * Opt in with RUN_BACKUP_END_TO_END_TESTS=true, with the app's own
 * DATABASE_*, CLICKHOUSE_* and VALKEY_* settings pointing at throwaway
 * servers (the restore replaces their data), the PostgreSQL tools on the
 * path or in BACKUP_POSTGRES_BIN_DIR, and the storage in
 * BACKUP_END_TO_END_S3_ENDPOINT (reachable by OneUptime and by ClickHouse
 * alike), BACKUP_END_TO_END_S3_BUCKET, BACKUP_END_TO_END_S3_ACCESS_KEY_ID
 * and BACKUP_END_TO_END_S3_SECRET_ACCESS_KEY:
 *
 *   node node_modules/.bin/jest Tests/Server/Backup/BackupEndToEnd.test.ts \
 *     --selectProjects server --runInBand --forceExit
 *
 * CI has no ClickHouse and storage pair a backup can be made between, so
 * this runs where those servers are; PostgreSQL's half runs in CI on its
 * own (PostgresBackupEnginePostgres).
 */
const describeEndToEnd: typeof describe.skip =
  process.env["RUN_BACKUP_END_TO_END_TESTS"] === "true"
    ? describe
    : describe.skip;

async function telemetryRows(): Promise<number> {
  const result: Awaited<
    ReturnType<
      NonNullable<
        ReturnType<typeof ClickhouseAppInstance.getDataSource>
      >["query"]
    >
  > = await ClickhouseAppInstance.getDataSource()!.query({
    query: "SELECT count() AS rows FROM LogItemV3",
    format: "JSONEachRow",
  });

  return Number(
    ((await result.json()) as Array<{ rows: string }>)[0]?.rows || 0,
  );
}

async function hasTable(name: string): Promise<boolean> {
  return await PostgresAdminConnection.withClient(
    PostgresAdminConnection.getAppTarget(),
    async (client: PostgresAdminClient): Promise<boolean> => {
      const rows: Array<PostgresRow> = await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public."${name}"`],
      );
      return rows[0]?.["present"] === true;
    },
  );
}

describeEndToEnd("a backup and a restore, end to end", () => {
  const folder: string = `e2e-${Date.now()}/`;
  let settings: BackupDestinationSettings;
  let backup: BackupRun;
  const runner: BackupRunner = new BackupRunner();

  beforeAll(async () => {
    await PostgresAppInstance.connect();
    await Redis.connect();
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    await BackupRunService.deleteBy({
      query: {},
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
    });
    await BackupSettingService.deleteBy({
      query: {},
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    const setting: BackupSetting = new BackupSetting();
    setting.destinationType = BackupDestinationType.S3Compatible;
    setting.destinationProvider = BackupProvider.MinIO;
    setting.config = {
      endpoint: process.env["BACKUP_END_TO_END_S3_ENDPOINT"] || "",
      bucket: process.env["BACKUP_END_TO_END_S3_BUCKET"] || "oneuptime-backups",
      accessKeyId: process.env["BACKUP_END_TO_END_S3_ACCESS_KEY_ID"] || "",
      folder,
    };
    setting.secrets = JSON.stringify({
      secretAccessKey:
        process.env["BACKUP_END_TO_END_S3_SECRET_ACCESS_KEY"] || "",
    });
    setting.includesClickhouse = true;

    const created: BackupSetting = await BackupSettingService.create({
      data: setting,
      props: { isRoot: true },
    });

    settings = await BackupSettingService.getDestinationSettings(created.id!);
  }, 120000);

  afterAll(async () => {
    await PostgresAppInstance.disconnect().catch(() => {
      return undefined;
    });
    await Redis.disconnect().catch(() => {
      return undefined;
    });
    await ClickhouseAppInstance.disconnect().catch(() => {
      return undefined;
    });
  });

  test("the destination test passes for OneUptime, pg_dump and ClickHouse", async () => {
    const result: BackupTestResult = await testBackupDestination({
      settings,
      storage: BackupStorageFactory.create(settings),
      postgres: runner.getPostgresEngine(),
      clickhouse: runner.getClickhouseEngine(),
      includesClickhouse: true,
    });

    expect(result).toEqual(expect.objectContaining({ isSuccessful: true }));
  }, 300000);

  test("a backup of PostgreSQL and ClickHouse succeeds, every step done", async () => {
    const run: BackupRun = new BackupRun();
    run.kind = BackupRunKind.Backup;
    run.trigger = BackupRunTrigger.Manual;
    run.status = BackupRunStatus.Queued;
    run.includesPostgres = true;
    run.includesClickhouse = true;
    backup = await BackupRunService.create({
      data: run,
      props: { isRoot: true },
    });

    expect(await runner.run({ run: backup })).not.toBeNull();

    const row: BackupRun | null = await BackupRunService.findOneById({
      id: backup.id!,
      select: {
        status: true,
        postgresSizeInBytes: true,
        clickhouseSizeInBytes: true,
      },
      props: { isRoot: true },
    });

    expect(row?.status).toBe(BackupRunStatus.Succeeded);
    expect(row?.postgresSizeInBytes).toBeGreaterThan(0);
    expect(row?.clickhouseSizeInBytes).toBeGreaterThan(0);
  }, 900000);

  test("a restore after the data moved on takes it back to the backup, after backing it up", async () => {
    const rowsAtBackup: number = await telemetryRows();

    await PostgresAdminConnection.withClient(
      PostgresAdminConnection.getAppTarget(),
      async (client: PostgresAdminClient) => {
        await client.query(
          'CREATE TABLE IF NOT EXISTS "MadeAfterTheBackup" (id int)',
        );
      },
    );
    await ClickhouseAppInstance.getDataSource()!.command({
      query:
        "INSERT INTO LogItemV3 (projectId, primaryEntityId, time, timeUnixNano, severityText, severityNumber, attributes, body, retentionDate, _id, createdAt) SELECT 'p1', 'svc1', now64(9) - number, toUInt64(now()) * 1000000000, 'Error', 17, map('k','v'), concat('after the backup ', toString(number)), now() + INTERVAL 30 DAY, toString(generateUUIDv4()), now() FROM numbers(5)",
    });

    expect(await telemetryRows()).toBe(rowsAtBackup + 5);
    expect(
      (
        await BackupCatalogSync.sync({
          settings,
          storage: BackupStorageFactory.create(settings),
        })
      ).found,
    ).toBeGreaterThanOrEqual(1);

    const restore: BackupRun = new BackupRun();
    restore.kind = BackupRunKind.Restore;
    restore.trigger = BackupRunTrigger.Manual;
    restore.status = BackupRunStatus.Queued;
    restore.includesPostgres = true;
    restore.includesClickhouse = true;
    restore.restoredBackupRunId = backup.id!;
    restore.runnerState = { takeBackupFirst: true };

    const restoreRow: BackupRun = await BackupRunService.create({
      data: restore,
      props: { isRoot: true },
    });

    expect(
      await new RestoreRunner({ backupRunner: runner }).run({
        run: restoreRow,
      }),
    ).toBe(true);

    expect(await hasTable("MadeAfterTheBackup")).toBe(false);
    expect(await telemetryRows()).toBe(rowsAtBackup);

    const runs: Array<BackupRun> = await BackupRunService.findAllBy({
      query: {},
      select: { _id: true, kind: true, trigger: true, status: true },
      props: { isRoot: true },
    });

    expect(
      runs.some((run: BackupRun): boolean => {
        return (
          run.trigger === BackupRunTrigger.BeforeRestore &&
          run.status === BackupRunStatus.Succeeded
        );
      }),
    ).toBe(true);
    expect(
      runs.find((run: BackupRun): boolean => {
        return run.id?.toString() === restoreRow.id?.toString();
      })?.status,
    ).toBe(BackupRunStatus.Succeeded);
  }, 1800000);
});
