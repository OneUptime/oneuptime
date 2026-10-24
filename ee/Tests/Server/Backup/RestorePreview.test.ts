import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  getBackupClickhouseMetadataKey,
  getBackupManifestKey,
  getBackupPostgresKey,
} from "../../../Server/Backup/BackupLayout";
import {
  buildRestorePreview,
  compareOneUptimeVersions,
  RestoreIssue,
  RestoreIssueCode,
  RestorePreview,
  restorePreviewToJson,
} from "../../../Server/Backup/RestorePreview";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import Encryption from "Common/Server/Utils/Encryption";
import {
  BACKUP_ENCRYPTION_CHECK_TEXT,
  BackupManifest,
} from "Common/Types/Backup/BackupManifest";
import {
  BackupRunStatus,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";
import ObjectID from "Common/Types/ObjectID";
import {
  FOLDER,
  MINIO_FINGERPRINT,
  MINIO_SETTINGS,
  silenceLogger,
} from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * What the restore dialog says before anything is restored - and what the
 * restore's first step refuses on: each problem that keeps a restore from
 * running, each warning that lets it run with care, with the code the
 * dialog words in the reader's language and an English sentence.
 */

const NAME: string = "20261024T020000Z-3f2a9c1b";
const DUMP: Buffer = Buffer.from('PGDMP{"Project":[]}', "utf8");

function codes(issues: Array<RestoreIssue>): Array<string> {
  return issues.map((issue: RestoreIssue): string => {
    return issue.code;
  });
}

describe("buildRestorePreview", () => {
  let storage: MemoryBackupStorage;
  let postgres: FakePostgresEngine;
  let clickhouse: FakeClickhouseEngine;
  let manifest: BackupManifest;

  beforeEach(async () => {
    silenceLogger();
    storage = new MemoryBackupStorage();
    postgres = new FakePostgresEngine();
    clickhouse = new FakeClickhouseEngine(storage);

    manifest = {
      schemaVersion: 1,
      backupId: "3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293",
      name: NAME,
      trigger: BackupRunTrigger.Scheduled,
      startedAt: "2026-10-24T02:00:00.000Z",
      finishedAt: "2026-10-24T02:00:06.000Z",
      oneuptimeVersion: "14.0.90",
      encryptionCheck: await Encryption.encrypt(BACKUP_ENCRYPTION_CHECK_TEXT),
      postgres: {
        file: "postgres.dump",
        format: "pg_dump-custom",
        sizeInBytes: DUMP.length,
        sha256: "a".repeat(64),
        database: "oneuptimedb",
        serverVersion: "16.4",
        toolVersion: "16.4",
        counts: { projects: 3, users: 12, monitors: 140, statusPages: 2 },
      },
      clickhouse: {
        folder: "clickhouse/",
        database: "oneuptime",
        serverVersion: "25.3.2.39",
        sizeInBytes: 2200000,
        fileCount: 410,
      },
    };

    writeManifest();
    storage.write(getBackupPostgresKey(FOLDER, NAME), DUMP);
    storage.write(getBackupClickhouseMetadataKey(FOLDER, NAME), "{}");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function writeManifest(): void {
    storage.write(getBackupManifestKey(FOLDER, NAME), JSON.stringify(manifest));
  }

  function backupRun(overrides: Partial<BackupRun> = {}): BackupRun {
    const run: BackupRun = new BackupRun(
      new ObjectID("3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293"),
    );
    run.status = BackupRunStatus.Succeeded;
    run.name = NAME;
    run.startedAt = new Date("2026-10-24T02:00:00.000Z");
    run.destinationFingerprint = MINIO_FINGERPRINT;
    Object.assign(run, overrides);
    return run;
  }

  async function preview(
    data: {
      run?: BackupRun | undefined;
      includesPostgres?: boolean | undefined;
      includesClickhouse?: boolean | undefined;
      currentVersion?: string | undefined;
    } = {},
  ): Promise<RestorePreview> {
    return await buildRestorePreview({
      backupRun: data.run || backupRun(),
      settings: MINIO_SETTINGS,
      storage,
      postgres: postgres.asEngine(),
      clickhouse: clickhouse.asEngine(),
      includesPostgres: data.includesPostgres ?? true,
      includesClickhouse: data.includesClickhouse ?? true,
      currentVersion: data.currentVersion ?? "14.0.90",
    });
  }

  test("a whole backup of this version has no problem: what it holds, and what is there now", async () => {
    const answer: RestorePreview = await preview();

    expect(answer.problems).toEqual([]);
    expect(answer.warnings).toEqual([]);
    expect(answer.backup).toEqual({
      id: "3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293",
      name: NAME,
      startedAt: "2026-10-24T02:00:00.000Z",
      oneuptimeVersion: "14.0.90",
      postgres: {
        sizeInBytes: DUMP.length,
        serverVersion: "16.4",
        counts: { projects: 3, users: 12, monitors: 140, statusPages: 2 },
      },
      clickhouse: { sizeInBytes: 2200000, serverVersion: "25.3.2.39" },
    });
    expect(answer.current).toEqual({
      oneuptimeVersion: "14.0.90",
      postgres: {
        database: "oneuptimedb",
        sizeInBytes: 12 * 1024 * 1024,
        counts: { projects: 2, users: 1, monitors: 3, statusPages: 1 },
      },
      clickhouse: { database: "oneuptime", sizeInBytes: 2000000 },
    });
    expect(answer.manifest?.name).toBe(NAME);
  });

  test("the API's answer leaves the manifest out", async () => {
    expect(Object.keys(restorePreviewToJson(await preview())).sort()).toEqual([
      "backup",
      "current",
      "problems",
      "warnings",
    ]);
  });

  test.each<[string, Partial<BackupRun>, RestoreIssueCode]>([
    [
      "a backup that failed",
      { status: BackupRunStatus.Failed },
      RestoreIssueCode.NotSucceeded,
    ],
    [
      "a backup still running",
      { status: BackupRunStatus.Running },
      RestoreIssueCode.NotSucceeded,
    ],
    [
      "a backup at a previous destination",
      { destinationFingerprint: "another-destination" },
      RestoreIssueCode.PreviousDestination,
    ],
  ])(
    "%s cannot be restored",
    async (
      _case: string,
      overrides: Partial<BackupRun>,
      code: RestoreIssueCode,
    ) => {
      const answer: RestorePreview = await preview({
        run: backupRun(overrides),
      });

      expect(codes(answer.problems)).toEqual([code]);
      // Nothing at the destination was read.
      expect(storage.calls).toEqual([]);
    },
  );

  test("a backup whose manifest is gone cannot be restored, and the dialog says where it looked", async () => {
    storage.objects.delete(getBackupManifestKey(FOLDER, NAME));

    const answer: RestorePreview = await preview();

    expect(codes(answer.problems)).toEqual([RestoreIssueCode.ManifestMissing]);
    expect(answer.problems[0]!.message).toBe(
      `The backup's manifest is not at memory://backups/${FOLDER}${NAME}/manifest.json: the backup was deleted or moved.`,
    );
  });

  test("a manifest it cannot read cannot be restored", async () => {
    storage.write(getBackupManifestKey(FOLDER, NAME), "{not json");

    expect(codes((await preview()).problems)).toEqual([
      RestoreIssueCode.ManifestUnreadable,
    ]);
  });

  test("a backup a newer OneUptime made cannot be restored until OneUptime is updated", async () => {
    manifest.oneuptimeVersion = "15.0.1";
    writeManifest();

    const answer: RestorePreview = await preview({ currentVersion: "14.0.90" });

    expect(codes(answer.problems)).toEqual([RestoreIssueCode.NewerVersion]);
    expect(answer.problems[0]!.message).toBe(
      "OneUptime 15.0.1 made this backup, which is newer than this installation (14.0.90). Update OneUptime first, then restore.",
    );
  });

  test("a backup an older OneUptime made can be restored, with a warning that it is brought up to date", async () => {
    manifest.oneuptimeVersion = "14.0.12";
    writeManifest();

    const answer: RestorePreview = await preview();

    expect(answer.problems).toEqual([]);
    expect(codes(answer.warnings)).toEqual([RestoreIssueCode.OlderVersion]);
  });

  test("a development build compares with nothing: no version issue", async () => {
    const answer: RestorePreview = await preview({ currentVersion: "unknown" });

    expect(answer.problems).toEqual([]);
    expect(answer.warnings).toEqual([]);
  });

  test("a dump that is gone, or not its size any more, cannot be restored", async () => {
    storage.write(
      getBackupPostgresKey(FOLDER, NAME),
      Buffer.concat([DUMP, DUMP]),
    );

    expect((await preview()).problems).toEqual([
      {
        code: RestoreIssueCode.PostgresFileMissing,
        message: `The PostgreSQL dump at the destination is ${DUMP.length * 2} bytes, not the ${DUMP.length} the manifest names.`,
      },
    ]);

    storage.objects.delete(getBackupPostgresKey(FOLDER, NAME));

    expect((await preview()).problems).toEqual([
      {
        code: RestoreIssueCode.PostgresFileMissing,
        message: "The PostgreSQL dump is not at the destination any more.",
      },
    ]);
  });

  test("ClickHouse's part gone cannot be restored, but PostgreSQL alone still can", async () => {
    storage.objects.delete(getBackupClickhouseMetadataKey(FOLDER, NAME));

    expect(codes((await preview()).problems)).toEqual([
      RestoreIssueCode.ClickhouseFileMissing,
    ]);
    expect((await preview({ includesClickhouse: false })).problems).toEqual([]);
  });

  test("asking for what the backup does not hold is a problem", async () => {
    delete manifest.clickhouse;
    writeManifest();

    expect(codes((await preview()).problems)).toEqual([
      RestoreIssueCode.ClickhouseMissing,
    ]);
  });

  test("a database user that may not create databases cannot restore PostgreSQL, and is told the statement", async () => {
    postgres.serverInfo = {
      ...postgres.serverInfo,
      user: "oneuptime",
      isSuperuser: false,
      canCreateDatabases: false,
    };

    expect((await preview()).problems).toEqual([
      {
        code: RestoreIssueCode.CannotCreateDatabases,
        message:
          "The database user oneuptime may not create databases, which a restore needs: it restores into a new database beside the current one. Run ALTER USER oneuptime CREATEDB; and try again.",
      },
    ]);
  });

  test("without a pg_restore that reads the backup, PostgreSQL cannot be restored: the tools' own sentence", async () => {
    manifest.postgres!.toolVersion = "18.1";
    writeManifest();

    const answer: RestorePreview = await preview();

    expect(codes(answer.problems)).toEqual([RestoreIssueCode.ToolsMissing]);
    expect(answer.problems[0]!.message).toBe(
      "PostgreSQL 18 needs pg_dump 18 or newer, and the newest here is 16.4. Update OneUptime, or set BACKUP_POSTGRES_BIN_DIR to newer PostgreSQL client tools.",
    );
  });

  test("a backup made with another ENCRYPTION_SECRET can be restored, with what that means", async () => {
    manifest.encryptionCheck = "U2FsdGVkX19vdGhlcnNlY3JldA==";
    writeManifest();

    const answer: RestorePreview = await preview();

    expect(answer.problems).toEqual([]);
    expect(codes(answer.warnings)).toEqual([
      RestoreIssueCode.EncryptionSecretDiffers,
    ]);
  });

  test("a backup that does not say which ENCRYPTION_SECRET made it is restored with a warning", async () => {
    delete manifest.encryptionCheck;
    writeManifest();

    expect(codes((await preview()).warnings)).toEqual([
      RestoreIssueCode.EncryptionUnknown,
    ]);
  });

  test("ClickHouse alone reads nothing of PostgreSQL", async () => {
    const answer: RestorePreview = await preview({ includesPostgres: false });

    expect(answer.problems).toEqual([]);
    expect(answer.current.postgres).toBeNull();
    expect(postgres.calls).toEqual([]);
  });
});

describe("compareOneUptimeVersions", () => {
  test.each<[string, string, number | null]>([
    ["14.0.88", "14.0.90", -1],
    ["14.0.90", "14.0.90", 0],
    ["14.1.0", "14.0.90", 1],
    ["15.0.0", "14.9.9", 1],
    ["14.0", "14.0.0", 0],
    ["14.0.90-rc.1", "14.0.90", 0],
    ["unknown", "14.0.90", null],
    ["14.0.90", "", null],
    ["14", "14.0.0", null],
    ["14.x.1", "14.0.1", null],
  ])("%s against %s is %p", (a: string, b: string, expected: number | null) => {
    expect(compareOneUptimeVersions(a, b)).toBe(expected);
  });
});
