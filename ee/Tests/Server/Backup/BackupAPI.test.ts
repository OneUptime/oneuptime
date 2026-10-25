import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import BackupAPI, {
  BACKUP_ALREADY_RUNNING_MESSAGE,
  BackupApiHandlers,
  RESTORE_CONFIRMATION_WORD,
} from "../../../Server/Backup/API/BackupAPI";
import {
  getBackupManifestKey,
  getBackupPostgresKey,
} from "../../../Server/Backup/BackupLayout";
import BackupRunner from "../../../Server/Backup/BackupRunner";
import {
  backupScheduler,
  BACKUP_LICENSE_REQUIRED_MESSAGE,
} from "../../../Server/Backup/BackupScheduler";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { StoredRow } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import {
  ADMIN_USER_ID,
  BACKUP_SECRET,
  BackupTables,
  FOLDER,
  MINIO_FINGERPRINT,
  runRow,
  SETTING_ID,
  silenceLogger,
  succeededBackupRow,
  useBackupTables,
} from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * What the Backups page asks of the server beyond its rows - every route a
 * master admin's, and the license asked only where it decides: testing a
 * destination and making new backups need one that includes backups;
 * restoring, deleting, finding and reading never do. The handlers on the
 * real services (rows in memory), the runner's engines and storage faked;
 * the routes as express holds them.
 */

const BACKUP_ID: string = "6ba7b811-9dad-41d1-80b4-00c04fd43101";
const BACKUP_NAME: string = "20261023T020000Z-6ba7b811";

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: new ObjectID(ADMIN_USER_ID),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as unknown as DatabaseCommonInteractionProps;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
}

function routesOf(router: ExpressRouter): Array<RouteLayer["route"]> {
  return (router as unknown as { stack: Array<RouteLayer> }).stack
    .filter((layer: RouteLayer): boolean => {
      return Boolean(layer.route);
    })
    .map((layer: RouteLayer) => {
      return layer.route;
    });
}

describe("the Backup API", () => {
  let tables: BackupTables;
  let storage: MemoryBackupStorage;
  let postgres: FakePostgresEngine;
  let clickhouse: FakeClickhouseEngine;
  let storageSettings: Array<BackupDestinationSettings>;
  let savedRunner: BackupRunner;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);
    jest.spyOn(backupScheduler, "tick").mockResolvedValue(undefined);

    tables = useBackupTables();
    storage = new MemoryBackupStorage();
    postgres = new FakePostgresEngine();
    clickhouse = new FakeClickhouseEngine(storage);
    storageSettings = [];

    savedRunner = BackupApiHandlers.runner;
    BackupApiHandlers.runner = new BackupRunner({
      postgres: postgres.asEngine(),
      clickhouse: clickhouse.asEngine(),
      createStorage: (settings: BackupDestinationSettings) => {
        storageSettings.push(settings);
        return storage;
      },
    });
  });

  afterEach(() => {
    BackupApiHandlers.runner = savedRunner;
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function seedBackup(overrides: StoredRow = {}): StoredRow {
    const row: StoredRow = succeededBackupRow({
      id: BACKUP_ID,
      startedAt: new Date("2026-10-23T02:00:00.000Z"),
      name: BACKUP_NAME,
      overrides,
    });
    tables.runs.rows.push(row);
    return row;
  }

  async function writeBackupFiles(): Promise<void> {
    const dump: Buffer = Buffer.from(
      `PGDMP${JSON.stringify(postgres.live())}`,
      "utf8",
    );

    storage.write(getBackupPostgresKey(FOLDER, BACKUP_NAME), dump);
    storage.write(`${FOLDER}${BACKUP_NAME}/clickhouse/.backup`, "{}");
    storage.write(
      getBackupManifestKey(FOLDER, BACKUP_NAME),
      JSON.stringify({
        schemaVersion: 1,
        backupId: BACKUP_ID,
        name: BACKUP_NAME,
        trigger: "scheduled",
        startedAt: "2026-10-23T02:00:00.000Z",
        finishedAt: "2026-10-23T02:00:06.000Z",
        oneuptimeVersion: "unknown",
        postgres: {
          file: "postgres.dump",
          format: "pg_dump-custom",
          sizeInBytes: dump.length,
          sha256: "c".repeat(64),
          database: "oneuptimedb",
          serverVersion: "16.4",
          toolVersion: "16.4",
          counts: { projects: 2 },
        },
        clickhouse: {
          folder: "clickhouse/",
          database: "oneuptime",
          serverVersion: "25.3.2.39",
          sizeInBytes: 2,
          fileCount: 1,
        },
      }),
    );
  }

  describe("its routes", () => {
    test("are the eight the page uses, and nothing else", () => {
      expect(
        routesOf(BackupAPI).map((route: RouteLayer["route"]): string => {
          return `${Object.keys(route!.methods).join(",").toUpperCase()} ${route!.path}`;
        }),
      ).toEqual([
        "POST /backup/test",
        "GET /backup/overview",
        "POST /backup/run-now",
        "POST /backup/restore-preview",
        "POST /backup/restore",
        "POST /backup/cancel",
        "POST /backup/delete",
        "POST /backup/find",
      ]);
    });

    test.each(
      routesOf(BackupAPI).map((route: RouteLayer["route"]) => {
        return [route!.path, route] as [string, RouteLayer["route"]];
      }),
    )(
      "%s is a master admin's: it checks that before anything else",
      (_path: string, route: RouteLayer["route"]) => {
        const handlers: Array<unknown> = route!.stack.map(
          (layer: { handle: unknown }): unknown => {
            return layer.handle;
          },
        );

        expect(handlers[0]).toBe(
          MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
        );
        expect(handlers[1]).toBe(UserMiddleware.getUserMiddleware);
        expect(handlers).toHaveLength(3);
      },
    );
  });

  describe("POST /backup/test", () => {
    const MINIO_BODY: JSONObject = {
      destinationType: "s3-compatible",
      destinationProvider: "minio",
      config: {
        endpoint: "http://10.0.0.6:9000",
        bucket: "new-backups",
        accessKeyId: "new-key",
      },
      secrets: { secretAccessKey: "typed-in-the-form" },
    };

    test("tests settings never saved, and answers each check", async () => {
      const answer: JSONObject = await BackupApiHandlers.test({
        body: MINIO_BODY,
      });

      expect(answer["isSuccessful"]).toBe(true);
      expect(
        (answer["checks"] as Array<JSONObject>).map((check: JSONObject) => {
          return check["key"];
        }),
      ).toEqual(["storage", "postgres", "clickhouse"]);
      expect(storageSettings[0]!.secrets).toEqual({
        secretAccessKey: "typed-in-the-form",
      });
      // Nothing was saved.
      expect(tables.settings.updates).toEqual([]);
    });

    test("an edit's test runs on the stored credential where the form left it blank", async () => {
      await BackupApiHandlers.test({
        body: {
          settingId: SETTING_ID,
          config: {
            endpoint: "http://10.0.0.5:9000",
            bucket: "oneuptime-backups",
            accessKeyId: "backup-key",
            folder: "staging/",
          },
          secrets: { secretAccessKey: "" },
        },
      });

      expect(storageSettings[0]!.config["folder"]).toBe("staging/");
      expect(storageSettings[0]!.secrets).toEqual({
        secretAccessKey: BACKUP_SECRET,
      });
    });

    test("without ClickHouse in the backups, ClickHouse is not tested", async () => {
      const answer: JSONObject = await BackupApiHandlers.test({
        body: { ...MINIO_BODY, includesClickhouse: false },
      });

      expect(answer["checks"] as Array<JSONObject>).toHaveLength(2);
    });

    test("settings a save would refuse are refused, naming the field", async () => {
      await expect(
        BackupApiHandlers.test({
          body: {
            ...MINIO_BODY,
            config: { ...(MINIO_BODY["config"] as JSONObject), bucket: "a/b" },
          },
        }),
      ).rejects.toThrow(
        "Bucket must be a bucket name, without slashes or spaces.",
      );
    });

    test("needs a license that includes backups", async () => {
      installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);

      await expect(
        BackupApiHandlers.test({ body: MINIO_BODY }),
      ).rejects.toThrow();
      expect(storageSettings).toEqual([]);
    });
  });

  describe("GET /backup/overview", () => {
    test("says whether backups are set up, where they go, when the next runs, and what the databases are", async () => {
      const overview: JSONObject = await BackupApiHandlers.overview();

      expect(overview).toEqual(
        expect.objectContaining({
          isSetUp: true,
          isActive: true,
          isAvailable: true,
          nextBackupAt: "2026-10-25T02:00:00.000Z",
          destinationFingerprint: MINIO_FINGERPRINT,
          location: `memory://backups/${FOLDER}`,
          postgres: {
            version: "16.4",
            sizeInBytes: 12 * 1024 * 1024,
            database: "oneuptimedb",
            canRestore: true,
            user: "postgres",
          },
          clickhouse: {
            version: "25.3.2.39",
            sizeInBytes: 2000000,
            database: "oneuptime",
          },
        }),
      );
      expect(JSON.stringify(overview)).not.toContain(BACKUP_SECRET);
    });

    test("before anything is set up, says so", async () => {
      tables.settings.rows.length = 0;

      expect(await BackupApiHandlers.overview()).toEqual(
        expect.objectContaining({ isSetUp: false, nextBackupAt: null }),
      );
    });

    test("says when the database user may not create the database a restore needs", async () => {
      postgres.serverInfo = {
        ...postgres.serverInfo,
        user: "oneuptime",
        isSuperuser: false,
        canCreateDatabases: false,
      };

      expect(
        ((await BackupApiHandlers.overview())["postgres"] as JSONObject)[
          "canRestore"
        ],
      ).toBe(false);
    });

    test("a database it cannot read says why, and the rest is still answered", async () => {
      clickhouse.failures.set(
        "getServerVersion",
        new Error("connect ECONNREFUSED 10.0.0.9:8123"),
      );

      const overview: JSONObject = await BackupApiHandlers.overview();

      expect(overview["clickhouse"]).toEqual({
        error: "connect ECONNREFUSED 10.0.0.9:8123.",
      });
      expect(overview["isSetUp"]).toBe(true);
    });

    test("with the license lapsed: still answered, and says new backups are not available", async () => {
      installFakeEnterpriseModuleWithFeatures([]);

      expect(await BackupApiHandlers.overview()).toEqual(
        expect.objectContaining({ isSetUp: true, isAvailable: false }),
      );
    });
  });

  describe("POST /backup/run-now", () => {
    test("queues a manual backup for the master admin who asked, as the settings say", async () => {
      tables.settings.rows[0]!["includesClickhouse"] = false;

      const answer: JSONObject = await BackupApiHandlers.runNow({
        props: MASTER_ADMIN,
      });
      const row: StoredRow = tables.runs.get(String(answer["backupRunId"]))!;

      expect(row).toEqual(
        expect.objectContaining({
          kind: BackupRunKind.Backup,
          trigger: BackupRunTrigger.Manual,
          status: BackupRunStatus.Queued,
          includesClickhouse: false,
        }),
      );
      expect(String(row["createdByUserId"])).toBe(ADMIN_USER_ID);
      expect(backupScheduler.tick).toHaveBeenCalled();
    });

    test("refuses while another backup or restore is waiting or running", async () => {
      tables.runs.rows.push(runRow({ status: BackupRunStatus.Running }));

      await expect(
        BackupApiHandlers.runNow({ props: MASTER_ADMIN }),
      ).rejects.toThrow(BACKUP_ALREADY_RUNNING_MESSAGE);
    });

    test("refuses before backups are set up", async () => {
      tables.settings.rows.length = 0;

      await expect(
        BackupApiHandlers.runNow({ props: MASTER_ADMIN }),
      ).rejects.toThrow(
        "Backups are not set up yet. Choose a destination first.",
      );
    });

    test("refuses without a license that includes backups, saying restoring still works", async () => {
      installFakeEnterpriseModuleWithFeatures([]);

      await expect(
        BackupApiHandlers.runNow({ props: MASTER_ADMIN }),
      ).rejects.toThrow(BACKUP_LICENSE_REQUIRED_MESSAGE);
      expect(tables.runs.rows).toEqual([]);
    });
  });

  describe("POST /backup/restore", () => {
    beforeEach(async () => {
      seedBackup();
      await writeBackupFiles();
    });

    test("queues a restore of what was chosen, with the backup of the current data first", async () => {
      const answer: JSONObject = await BackupApiHandlers.restore({
        body: {
          backupRunId: BACKUP_ID,
          includesPostgres: true,
          includesClickhouse: true,
          takeBackupFirst: true,
          confirmation: "restore",
        },
        props: MASTER_ADMIN,
      });
      const row: StoredRow = tables.runs.get(String(answer["backupRunId"]))!;

      expect(row).toEqual(
        expect.objectContaining({
          kind: BackupRunKind.Restore,
          trigger: BackupRunTrigger.Manual,
          status: BackupRunStatus.Queued,
          includesPostgres: true,
          includesClickhouse: true,
          runnerState: { takeBackupFirst: true },
        }),
      );
      expect(String(row["restoredBackupRunId"])).toBe(BACKUP_ID);
      expect(String(row["createdByUserId"])).toBe(ADMIN_USER_ID);
    });

    test("ClickHouse is restored only when asked; a backup first unless declined", async () => {
      const answer: JSONObject = await BackupApiHandlers.restore({
        body: {
          backupRunId: BACKUP_ID,
          takeBackupFirst: false,
          confirmation: " Restore ",
        },
        props: MASTER_ADMIN,
      });

      expect(tables.runs.get(String(answer["backupRunId"]))).toEqual(
        expect.objectContaining({
          includesPostgres: true,
          includesClickhouse: false,
          runnerState: { takeBackupFirst: false },
        }),
      );
    });

    test.each([undefined, "", "yes", "restor"])(
      "waits for the word: %p is refused",
      async (confirmation: string | undefined) => {
        await expect(
          BackupApiHandlers.restore({
            body: { backupRunId: BACKUP_ID, confirmation } as JSONObject,
            props: MASTER_ADMIN,
          }),
        ).rejects.toThrow(
          `Type ${RESTORE_CONFIRMATION_WORD} to confirm the restore.`,
        );
        expect(tables.runs.rows).toHaveLength(1);
      },
    );

    test("refuses when nothing is chosen", async () => {
      await expect(
        BackupApiHandlers.restore({
          body: {
            backupRunId: BACKUP_ID,
            includesPostgres: false,
            includesClickhouse: false,
            confirmation: "restore",
          },
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow(
        "Choose what to restore: PostgreSQL, ClickHouse or both.",
      );
    });

    test("refuses a backup the check finds a problem with, saying what it is", async () => {
      storage.objects.delete(getBackupManifestKey(FOLDER, BACKUP_NAME));

      await expect(
        BackupApiHandlers.restore({
          body: { backupRunId: BACKUP_ID, confirmation: "restore" },
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow("The backup's manifest is not at");
    });

    test("refuses while another run is waiting or running", async () => {
      tables.runs.rows.push(runRow({ status: BackupRunStatus.Queued }));

      await expect(
        BackupApiHandlers.restore({
          body: { backupRunId: BACKUP_ID, confirmation: "restore" },
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow(BACKUP_ALREADY_RUNNING_MESSAGE);
    });

    test("refuses a restore of a restore", async () => {
      tables.runs.rows[0]!["kind"] = BackupRunKind.Restore;

      await expect(
        BackupApiHandlers.restore({
          body: { backupRunId: BACKUP_ID, confirmation: "restore" },
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow("Only a backup can be restored.");
    });

    test("needs no license: an installation always gets its own data back", async () => {
      installFakeEnterpriseModuleWithFeatures([]);

      await expect(
        BackupApiHandlers.restore({
          body: { backupRunId: BACKUP_ID, confirmation: "restore" },
          props: MASTER_ADMIN,
        }),
      ).resolves.toEqual({ backupRunId: expect.any(String) });
    });

    test("the preview answers what the dialog shows, and never the manifest", async () => {
      const preview: JSONObject = await BackupApiHandlers.restorePreview({
        body: {
          backupRunId: BACKUP_ID,
          includesPostgres: true,
          includesClickhouse: true,
        },
      });

      expect(Object.keys(preview).sort()).toEqual([
        "backup",
        "current",
        "problems",
        "warnings",
      ]);
      expect((preview["backup"] as JSONObject)["name"]).toBe(BACKUP_NAME);
    });

    test("a backup id that is not one is refused as such", async () => {
      await expect(
        BackupApiHandlers.restorePreview({ body: { backupRunId: "../etc" } }),
      ).rejects.toThrow("A valid backup ID is required.");
    });
  });

  describe("POST /backup/cancel", () => {
    test("a queued run is cancelled at once", async () => {
      tables.runs.rows.push(runRow({ _id: BACKUP_ID }));

      expect(
        await BackupApiHandlers.cancel({ body: { backupRunId: BACKUP_ID } }),
      ).toEqual({ isCancelled: true });
      expect(tables.runs.get(BACKUP_ID)).toEqual(
        expect.objectContaining({
          status: BackupRunStatus.Cancelled,
          error: "Cancelled by a master admin before it started.",
        }),
      );
    });

    test("a running backup is asked to stop, and stops at its next step", async () => {
      tables.runs.rows.push(
        runRow({ _id: BACKUP_ID, status: BackupRunStatus.Running }),
      );

      expect(
        await BackupApiHandlers.cancel({ body: { backupRunId: BACKUP_ID } }),
      ).toEqual({ isCancelled: false, isCancelRequested: true });
      expect(tables.runs.get(BACKUP_ID)!["cancelRequestedAt"]).toBeDefined();
      expect(tables.runs.get(BACKUP_ID)!["status"]).toBe(
        BackupRunStatus.Running,
      );
    });

    test("a restore already replacing the data cannot be stopped half way", async () => {
      tables.runs.rows.push(
        runRow({
          _id: BACKUP_ID,
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Running,
          steps: [
            {
              key: BackupStepKey.CheckBackup,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.BackUpCurrentData,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.RestorePostgres,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.RestoreClickhouse,
              status: BackupStepStatus.Running,
            },
          ],
        }),
      );

      await expect(
        BackupApiHandlers.cancel({ body: { backupRunId: BACKUP_ID } }),
      ).rejects.toThrow(
        "This restore is already replacing the data, and stopping now would leave it half done. It finishes on its own.",
      );
    });

    test("a restore still restoring beside the live data can be stopped", async () => {
      tables.runs.rows.push(
        runRow({
          _id: BACKUP_ID,
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Running,
          steps: [
            {
              key: BackupStepKey.CheckBackup,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.RestorePostgres,
              status: BackupStepStatus.Running,
            },
          ],
        }),
      );

      await expect(
        BackupApiHandlers.cancel({ body: { backupRunId: BACKUP_ID } }),
      ).resolves.toEqual({ isCancelled: false, isCancelRequested: true });
    });

    test("a finished run is not cancelled", async () => {
      seedBackup();

      await expect(
        BackupApiHandlers.cancel({ body: { backupRunId: BACKUP_ID } }),
      ).rejects.toThrow("It has already finished.");
    });
  });

  describe("POST /backup/delete", () => {
    test("deletes a backup's files at the destination, then its row", async () => {
      seedBackup();
      await writeBackupFiles();

      expect(
        await BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).toEqual({ deletedFiles: 3 });
      expect(storage.keysUnder(`${FOLDER}${BACKUP_NAME}/`)).toEqual([]);
      expect(tables.runs.get(BACKUP_ID)).toBeUndefined();
    });

    test("a backup at a previous destination loses its row, and its files there are not touched", async () => {
      seedBackup({ destinationFingerprint: "the-old-bucket" });
      await writeBackupFiles();

      expect(
        await BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).toEqual({ deletedFiles: 0 });
      expect(storage.keysUnder(`${FOLDER}${BACKUP_NAME}/`)).toHaveLength(3);
      expect(tables.runs.get(BACKUP_ID)).toBeUndefined();
    });

    test("refuses a backup still running, and one a restore is reading", async () => {
      seedBackup({ status: BackupRunStatus.Running });

      await expect(
        BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).rejects.toThrow("It is still queued or running. Cancel it first.");

      tables.runs.rows[0]!["status"] = BackupRunStatus.Succeeded;
      tables.runs.rows.push(
        runRow({
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Running,
          restoredBackupRunId: BACKUP_ID,
        }),
      );

      await expect(
        BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).rejects.toThrow("A restore is reading this backup right now.");
    });

    test("needs no license", async () => {
      installFakeEnterpriseModuleWithFeatures([]);
      seedBackup();

      await expect(
        BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).resolves.toEqual({ deletedFiles: 0 });
    });

    test("a backup that is gone already says so", async () => {
      await expect(
        BackupApiHandlers.delete({ body: { backupRunId: BACKUP_ID } }),
      ).rejects.toThrow("That backup no longer exists.");
    });
  });

  test("POST /backup/find lists the destination's backups, and needs no license", async () => {
    installFakeEnterpriseModuleWithFeatures([]);
    await writeBackupFiles();

    expect(await BackupApiHandlers.find()).toEqual({
      found: 1,
      added: 1,
      updated: 0,
      removed: 0,
      unreadable: [],
    });
    expect(tables.runs.get(BACKUP_ID)).toEqual(
      expect.objectContaining({
        status: BackupRunStatus.Succeeded,
        name: BACKUP_NAME,
      }),
    );
  });

  test("a restore queued through the API carries its backup's id as a BackupRun reference", async () => {
    seedBackup();
    await writeBackupFiles();

    const answer: JSONObject = await BackupApiHandlers.restore({
      body: { backupRunId: BACKUP_ID, confirmation: "restore" },
      props: MASTER_ADMIN,
    });
    const restore: BackupRun | null = await (
      await import("Common/Server/Services/BackupRunService")
    ).default.findOneById({
      id: new ObjectID(String(answer["backupRunId"])),
      select: { restoredBackupRunId: true },
      props: { isRoot: true },
    });

    expect(restore?.restoredBackupRunId?.toString()).toBe(BACKUP_ID);
  });
});
