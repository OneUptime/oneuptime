import { describe, expect, test } from "@jest/globals";
import ClickhouseBackupEngine, {
  aggregateClickhouseBackupRows,
  clickhouseIdentifier,
  ClickhouseBackupState,
  ClickhouseBackupStatus,
  clickhouseString,
  describeClickhouseBackupError,
  getClickhouseBackupEngine,
} from "../../../Server/Backup/ClickHouse/ClickhouseBackupEngine";
import { ClickhouseClient } from "Common/Server/Infrastructure/ClickhouseDatabase";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import { AuditLogExportAzureAuthentication } from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import { JSONObject } from "Common/Types/JSON";
import { MINIO_SETTINGS } from "./Fakes/BackupTestBed";

/*
 * ClickHouse's half: the statements ClickHouse is sent - BACKUP and RESTORE
 * of the telemetry database on every node, to the same storage OneUptime
 * writes, by an id OneUptime picks, ASYNC - how their progress is read
 * from every replica, and what their errors say to an operator. Run on a
 * client that records every statement and answers the queries a test
 * gives it. (The opt-in end-to-end suite runs them on a real ClickHouse.)
 */

class RecordingClickhouse {
  public commands: Array<string> = [];
  public queries: Array<string> = [];
  public answers: Array<{ match: string; rows: Array<JSONObject> }> = [];

  public asClient(): ClickhouseClient {
    return {
      command: async (data: { query: string }): Promise<void> => {
        this.commands.push(data.query);
      },
      query: async (data: { query: string }) => {
        this.queries.push(data.query);

        const answer: { rows: Array<JSONObject> } | undefined =
          this.answers.find((candidate: { match: string }): boolean => {
            return data.query.includes(candidate.match);
          });

        return {
          json: async (): Promise<Array<JSONObject>> => {
            return answer?.rows || [];
          },
        };
      },
    } as unknown as ClickhouseClient;
  }
}

function engineWith(clickhouse: RecordingClickhouse): ClickhouseBackupEngine {
  return new ClickhouseBackupEngine({
    client: clickhouse.asClient(),
    database: "oneuptime",
    cluster: "oneuptime",
    pollIntervalInMs: 1,
  });
}

const AMAZON: BackupDestinationSettings = {
  type: BackupDestinationType.AmazonS3,
  provider: BackupProvider.AmazonS3,
  config: {
    bucket: "acme-backups",
    region: "eu-west-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  },
  secrets: { secretAccessKey: "it's\\a'secret" },
};

describe("the statements ClickHouse is sent", () => {
  test("a backup of the telemetry database on every node, to S3, by OneUptime's id, ASYNC", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();

    await engineWith(clickhouse).startBackup({
      settings: MINIO_SETTINGS,
      folderKey: "prod/20261024T020000Z-3f2a9c1b/clickhouse/",
      id: "3f2a9c1b-0000-4000-8000-000000000001",
    });

    expect(clickhouse.commands).toEqual([
      "BACKUP DATABASE `oneuptime` ON CLUSTER 'oneuptime' TO S3('http://10.0.0.5:9000/oneuptime-backups/prod/20261024T020000Z-3f2a9c1b/clickhouse/', 'backup-key', 'minio-secret-key-0123456789') SETTINGS id = '3f2a9c1b-0000-4000-8000-000000000001' ASYNC",
    ]);
  });

  test("the destination test's backup is of the tables' definitions alone", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();

    await engineWith(clickhouse).startBackup({
      settings: MINIO_SETTINGS,
      folderKey: "prod/oneuptime-backup-test/x/clickhouse/",
      id: "id-1",
      structureOnly: true,
    });

    expect(clickhouse.commands[0]).toContain(
      "SETTINGS id = 'id-1', structure_only = 1 ASYNC",
    );
  });

  test("a restore under another name reads the backup's database AS it, on every node", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();

    await engineWith(clickhouse).startRestore({
      settings: MINIO_SETTINGS,
      folderKey: "prod/b/clickhouse/",
      id: "id-2",
      sourceDatabase: "oneuptime",
      asDatabase: "oneuptime_restore_check_3f2a9c1b",
      structureOnly: true,
    });

    expect(clickhouse.commands).toEqual([
      "RESTORE DATABASE `oneuptime` AS `oneuptime_restore_check_3f2a9c1b` ON CLUSTER 'oneuptime' FROM S3('http://10.0.0.5:9000/oneuptime-backups/prod/b/clickhouse/', 'backup-key', 'minio-secret-key-0123456789') SETTINGS id = 'id-2', structure_only = 1 ASYNC",
    ]);
  });

  test("a restore under the database's own name says no AS", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();

    await engineWith(clickhouse).startRestore({
      settings: MINIO_SETTINGS,
      folderKey: "prod/b/clickhouse/",
      id: "id-3",
      sourceDatabase: "oneuptime",
      asDatabase: "oneuptime",
    });

    expect(clickhouse.commands[0]).toMatch(
      /^RESTORE DATABASE `oneuptime` ON CLUSTER/,
    );
  });

  test("renames and drops on every node; drops wait for the drop (SYNC)", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    const engine: ClickhouseBackupEngine = engineWith(clickhouse);

    await engine.renameDatabase(
      "oneuptime",
      "oneuptime_before_restore_3f2a9c1b",
    );
    await engine.dropDatabase("oneuptime_before_restore_3f2a9c1b");

    expect(clickhouse.commands).toEqual([
      "RENAME DATABASE `oneuptime` TO `oneuptime_before_restore_3f2a9c1b` ON CLUSTER 'oneuptime'",
      "DROP DATABASE IF EXISTS `oneuptime_before_restore_3f2a9c1b` ON CLUSTER 'oneuptime' SYNC",
    ]);
  });

  test("drops every materialized view of a database it sets aside, and only those", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    clickhouse.answers.push({
      match: "engine = 'MaterializedView'",
      rows: [{ name: "LogMetricsMV" }, { name: "SpanMetrics`MV" }],
    });

    expect(
      await engineWith(clickhouse).dropMaterializedViews(
        "oneuptime_before_restore_1",
      ),
    ).toBe(2);
    expect(clickhouse.queries[0]).toBe(
      "SELECT name FROM system.tables WHERE database = 'oneuptime_before_restore_1' AND engine = 'MaterializedView'",
    );
    expect(clickhouse.commands).toEqual([
      "DROP VIEW IF EXISTS `oneuptime_before_restore_1`.`LogMetricsMV` ON CLUSTER 'oneuptime' SYNC",
      "DROP VIEW IF EXISTS `oneuptime_before_restore_1`.`SpanMetrics\\`MV` ON CLUSTER 'oneuptime' SYNC",
    ]);
  });

  test("reads the database's size on every replica's active parts", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    clickhouse.answers.push({
      match: "system.parts",
      rows: [{ bytes: "123456789" }],
    });

    expect(await engineWith(clickhouse).getDatabaseSizeInBytes()).toBe(
      123456789,
    );
    expect(clickhouse.queries[0]).toBe(
      "SELECT sum(bytes_on_disk) AS bytes FROM clusterAllReplicas('oneuptime', system.parts) WHERE active AND database = 'oneuptime'",
    );
  });
});

describe("where ClickHouse writes", () => {
  test("Amazon S3: the bucket's own host in the region", () => {
    expect(
      getClickhouseBackupEngine({
        settings: AMAZON,
        folderKey: "oneuptime/backups/b/clickhouse/",
      }),
    ).toBe(
      "S3('https://acme-backups.s3.eu-west-1.amazonaws.com/oneuptime/backups/b/clickhouse/', 'AKIAIOSFODNN7EXAMPLE', 'it\\'s\\\\a\\'secret')",
    );
  });

  test("Google Cloud Storage: its XML API, with the HMAC key", () => {
    expect(
      getClickhouseBackupEngine({
        settings: {
          type: BackupDestinationType.GoogleCloudStorage,
          provider: BackupProvider.GoogleCloudStorage,
          config: { bucket: "acme_backups", accessKeyId: "GOOG1E" },
          secrets: { secretAccessKey: "hmac-secret" },
        },
        folderKey: "f/",
      }),
    ).toBe(
      "S3('https://storage.googleapis.com/acme_backups/f/', 'GOOG1E', 'hmac-secret')",
    );
  });

  test("Azure with a SAS token: a connection string naming the blob service", () => {
    expect(
      getClickhouseBackupEngine({
        settings: {
          type: BackupDestinationType.AzureBlobStorage,
          provider: BackupProvider.AzureBlobStorage,
          config: {
            accountName: "acmebackups",
            container: "oneuptime-backups",
            authentication: AuditLogExportAzureAuthentication.SasToken,
          },
          secrets: { sasToken: "?sv=2022&sp=racwdl&sig=abc" },
        },
        folderKey: "f/b/clickhouse/",
      }),
    ).toBe(
      "AzureBlobStorage('BlobEndpoint=https://acmebackups.blob.core.windows.net/;SharedAccessSignature=sv=2022&sp=racwdl&sig=abc', 'oneuptime-backups', 'f/b/clickhouse/')",
    );
  });

  test("Azure with an access key, in Azure China", () => {
    expect(
      getClickhouseBackupEngine({
        settings: {
          type: BackupDestinationType.AzureBlobStorage,
          provider: BackupProvider.AzureBlobStorage,
          config: {
            accountName: "acmebackups",
            container: "oneuptime-backups",
            authentication: AuditLogExportAzureAuthentication.AccessKey,
            cloud: "china",
          },
          secrets: { accountKey: "a2V5" },
        },
        folderKey: "f/",
      }),
    ).toBe(
      "AzureBlobStorage('https://acmebackups.blob.core.chinacloudapi.cn', 'oneuptime-backups', 'f/', 'acmebackups', 'a2V5')",
    );
  });

  test("a test's ClickHouse that reaches the storage at another address", () => {
    expect(
      getClickhouseBackupEngine({
        settings: AMAZON,
        folderKey: "f/",
        endpointOverride: "http://minio:9000",
      }),
    ).toMatch(/^S3\('http:\/\/minio:9000\/acme-backups\/f\/'/);
  });

  test("string literals and identifiers cannot be broken out of", () => {
    expect(clickhouseString("a'b\\c")).toBe("'a\\'b\\\\c'");
    expect(clickhouseIdentifier("db`; DROP")).toBe("`db\\`; DROP`");
  });
});

describe("following a backup on every replica", () => {
  const row: (status: string, extra?: JSONObject) => JSONObject = (
    status: string,
    extra: JSONObject = {},
  ): JSONObject => {
    return {
      status,
      error: "",
      num_files: 0,
      total_size: 0,
      files_read: 0,
      bytes_read: 0,
      ...extra,
    };
  };

  test("done when every replica is done; running while one is not", () => {
    expect(
      aggregateClickhouseBackupRows([
        row("BACKUP_CREATED", { num_files: "410", total_size: "2200000" }),
        row("BACKUP_CREATED", { num_files: "400", total_size: "2100000" }),
      ]),
    ).toEqual({
      state: ClickhouseBackupState.Succeeded,
      error: "",
      fileCount: 410,
      totalSizeInBytes: 2200000,
      filesRead: 0,
      bytesRead: 0,
    });
    expect(
      aggregateClickhouseBackupRows([
        row("BACKUP_CREATED"),
        row("CREATING_BACKUP"),
      ]).state,
    ).toBe(ClickhouseBackupState.Running);
    expect(
      aggregateClickhouseBackupRows([row("RESTORED"), row("RESTORED")]).state,
    ).toBe(ClickhouseBackupState.Succeeded);
  });

  test("failed when any replica failed or cancelled it, with that replica's error", () => {
    expect(
      aggregateClickhouseBackupRows([
        row("CREATING_BACKUP"),
        row("BACKUP_FAILED", { error: "Code: 499. S3 error" }),
      ]),
    ).toEqual(
      expect.objectContaining({
        state: ClickhouseBackupState.Failed,
        error: "Code: 499. S3 error",
      }),
    );
    expect(
      aggregateClickhouseBackupRows([row("RESTORE_CANCELLED")]).state,
    ).toBe(ClickhouseBackupState.Failed);
  });

  test("missing when no replica knows the id", () => {
    expect(aggregateClickhouseBackupRows([]).state).toBe(
      ClickhouseBackupState.Missing,
    );
  });

  test("waitFor reports progress until it is done, asking every replica by id", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    const progress: Array<number> = [];
    let polls: number = 0;

    const client: ClickhouseClient = {
      command: async (): Promise<void> => {
        return undefined;
      },
      query: async (data: { query: string }) => {
        clickhouse.queries.push(data.query);
        polls++;

        return {
          json: async (): Promise<Array<JSONObject>> => {
            return polls < 3
              ? [row("CREATING_BACKUP", { num_files: polls * 10 })]
              : [row("BACKUP_CREATED", { num_files: 30 })];
          },
        };
      },
    } as unknown as ClickhouseClient;

    const status: ClickhouseBackupStatus = await new ClickhouseBackupEngine({
      client,
      database: "oneuptime",
      cluster: "oneuptime",
      pollIntervalInMs: 1,
    }).waitFor({
      id: "id-9",
      onProgress: (value: ClickhouseBackupStatus): void => {
        progress.push(value.fileCount);
      },
    });

    expect(status.state).toBe(ClickhouseBackupState.Succeeded);
    expect(progress).toEqual([10, 20, 30]);
    expect(clickhouse.queries[0]).toBe(
      "SELECT status, error, num_files, total_size, files_read, bytes_read FROM clusterAllReplicas('oneuptime', system.backups) WHERE id = 'id-9'",
    );
  });

  test("waitFor throws ClickHouse's words when it fails", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    clickhouse.answers.push({
      match: "system.backups",
      rows: [
        row("BACKUP_FAILED", {
          error:
            "Code: 499. DB::Exception: The specified bucket does not exist. (S3_ERROR) (version 25.3.2.39 (official build)). Stack trace:\n0. ...",
        }),
      ],
    });

    await expect(
      engineWith(clickhouse).waitFor({ id: "id-1" }),
    ).rejects.toThrow(
      "The bucket or container does not exist. ClickHouse said: Code: 499. DB::Exception: The specified bucket does not exist. (S3_ERROR) (version 25.3.2.39 (official build)).",
    );
  });

  test("waitFor gives up on an id no replica knows, once a grace period has passed", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();

    await expect(
      engineWith(clickhouse).waitFor({ id: "gone", missingGraceInMs: 5 }),
    ).rejects.toThrow(
      "ClickHouse no longer knows this backup: it may have restarted while the backup ran. Try again.",
    );
  });

  test("waitFor stops when it is told to, and leaves ClickHouse to finish", async () => {
    const clickhouse: RecordingClickhouse = new RecordingClickhouse();
    clickhouse.answers.push({
      match: "system.backups",
      rows: [row("CREATING_BACKUP")],
    });

    await expect(
      engineWith(clickhouse).waitFor({
        id: "id-1",
        shouldStop: (): boolean => {
          return true;
        },
      }),
    ).rejects.toThrow("Stopped while ClickHouse was still working.");
  });
});

describe("what ClickHouse's errors say", () => {
  test.each<[string, string]>([
    [
      "Code: 499. DB::Exception: Access Denied. HTTP response code: 403. (S3_ERROR)",
      "The storage refused ClickHouse's request: check that the key may read, write, list and delete in the bucket.",
    ],
    [
      "Code: 497. DB::Exception: oneuptime: Not enough privileges. To execute this query, it's necessary to have the grant BACKUP ON oneuptime.*. (ACCESS_DENIED)",
      "The ClickHouse user may not run BACKUP or RESTORE. Grant it BACKUP, and the S3 or AZURE source.",
    ],
    [
      "Code: 1000. DB::Exception: Couldn't resolve host minio. (POCO_EXCEPTION)",
      "ClickHouse could not reach the storage: ClickHouse connects to it itself, so its network must reach the storage too.",
    ],
    [
      "Code: 598. DB::Exception: Backup S3('...') already exists. (BACKUP_ALREADY_EXISTS)",
      "A ClickHouse backup is already at this place in the storage.",
    ],
    [
      "Code: 243. DB::Exception: Cannot reserve 1.00 MiB, not enough space. (NOT_ENOUGH_SPACE)",
      "ClickHouse ran out of disk space. Free some, then try again.",
    ],
  ])("%s", (error: string, advice: string) => {
    const described: string = describeClickhouseBackupError(error);

    expect(described.startsWith(advice)).toBe(true);
    expect(described).toContain("ClickHouse said:");
  });

  test("anything else is ClickHouse's own words, without the stack trace", () => {
    expect(
      describeClickhouseBackupError(
        "Code: 1. DB::Exception: Something new.\nStack trace:\n0. x",
      ),
    ).toBe("ClickHouse said: Code: 1. DB::Exception: Something new.");
  });
});
