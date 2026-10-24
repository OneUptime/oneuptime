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

import BackupCatalogSync, {
  BackupCatalogSyncResult,
} from "../../../Server/Backup/BackupCatalogSync";
import { getBackupManifestKey } from "../../../Server/Backup/BackupLayout";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { BackupManifest } from "Common/Types/Backup/BackupManifest";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { StoredRow } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import {
  BackupTables,
  FOLDER,
  MINIO_FINGERPRINT,
  MINIO_SETTINGS,
  runRow,
  silenceLogger,
  succeededBackupRow,
  useBackupTables,
} from "./Fakes/BackupTestBed";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * Find backups: the destination's backups, read from their manifests, made
 * the rows of the Backups page - the backups a new server finds in the
 * bucket of the one it replaces, the ones a restore's older table does not
 * know, and none for a backup that is no longer there.
 */

const FIRST_ID: string = "1a2b3c4d-0000-4000-8000-000000000001";
const SECOND_ID: string = "1a2b3c4d-0000-4000-8000-000000000002";

function manifestFor(data: {
  id: string;
  name: string;
  trigger?: BackupRunTrigger | undefined;
}): BackupManifest {
  return {
    schemaVersion: 1,
    backupId: data.id,
    name: data.name,
    trigger: data.trigger || BackupRunTrigger.Scheduled,
    startedAt: `${data.name.slice(0, 4)}-${data.name.slice(4, 6)}-${data.name.slice(6, 8)}T02:00:00.000Z`,
    finishedAt: `${data.name.slice(0, 4)}-${data.name.slice(4, 6)}-${data.name.slice(6, 8)}T02:00:06.000Z`,
    oneuptimeVersion: "14.0.90",
    postgres: {
      file: "postgres.dump",
      format: "pg_dump-custom",
      sizeInBytes: 4300000,
      sha256: "b".repeat(64),
      database: "oneuptimedb",
      serverVersion: "16.4",
      toolVersion: "16.4",
      counts: { projects: 3 },
    },
    clickhouse: {
      folder: "clickhouse/",
      database: "oneuptime",
      serverVersion: "25.3.2.39",
      sizeInBytes: 2200000,
      fileCount: 410,
    },
  };
}

describe("BackupCatalogSync", () => {
  let tables: BackupTables;
  let storage: MemoryBackupStorage;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);
    tables = useBackupTables();
    storage = new MemoryBackupStorage();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function putBackup(manifest: BackupManifest): void {
    storage.write(
      getBackupManifestKey(FOLDER, manifest.name),
      JSON.stringify(manifest),
    );
    storage.write(`${FOLDER}${manifest.name}/postgres.dump`, "PGDMP");
  }

  async function sync(): Promise<BackupCatalogSyncResult> {
    return await BackupCatalogSync.sync({ settings: MINIO_SETTINGS, storage });
  }

  test("a new server finds the backups in its predecessor's bucket, ready to restore", async () => {
    putBackup(manifestFor({ id: FIRST_ID, name: "20261023T020000Z-1a2b3c4d" }));
    putBackup(
      manifestFor({
        id: SECOND_ID,
        name: "20261024T020000Z-1a2b3c4d",
        trigger: BackupRunTrigger.Manual,
      }),
    );

    expect(await sync()).toEqual({
      found: 2,
      added: 2,
      updated: 0,
      removed: 0,
      unreadable: [],
    });

    const first: StoredRow = tables.runs.get(FIRST_ID)!;

    expect(first).toEqual(
      expect.objectContaining({
        kind: BackupRunKind.Backup,
        status: BackupRunStatus.Succeeded,
        trigger: BackupRunTrigger.Scheduled,
        name: "20261023T020000Z-1a2b3c4d",
        includesPostgres: true,
        includesClickhouse: true,
        postgresSizeInBytes: 4300000,
        clickhouseSizeInBytes: 2200000,
        destinationFingerprint: MINIO_FINGERPRINT,
        location: `memory://backups/${FOLDER}20261023T020000Z-1a2b3c4d/`,
      }),
    );
    expect(new Date(first["startedAt"] as Date).toISOString()).toBe(
      "2026-10-23T02:00:00.000Z",
    );
    expect(tables.runs.get(SECOND_ID)!["trigger"]).toBe(
      BackupRunTrigger.Manual,
    );
  });

  test("finding again adds nothing twice", async () => {
    putBackup(manifestFor({ id: FIRST_ID, name: "20261023T020000Z-1a2b3c4d" }));

    await sync();
    expect(await sync()).toEqual({
      found: 1,
      added: 0,
      updated: 0,
      removed: 0,
      unreadable: [],
    });
    expect(tables.runs.rows).toHaveLength(1);
  });

  test("after a restore, the backup the old table still shows as running reads as the backup it became", async () => {
    tables.runs.rows.push(
      runRow({
        _id: FIRST_ID,
        status: BackupRunStatus.Running,
        name: "20261023T020000Z-1a2b3c4d",
        destinationFingerprint: MINIO_FINGERPRINT,
      }),
    );
    putBackup(manifestFor({ id: FIRST_ID, name: "20261023T020000Z-1a2b3c4d" }));

    expect((await sync()).updated).toBe(1);
    expect(tables.runs.get(FIRST_ID)!["status"]).toBe(
      BackupRunStatus.Succeeded,
    );
    expect(tables.runs.get(FIRST_ID)!["error"] ?? null).toBeNull();
  });

  test("a backup moved here from a previous destination is at this one now", async () => {
    tables.runs.rows.push(
      succeededBackupRow({
        id: FIRST_ID,
        startedAt: new Date("2026-10-23T02:00:00.000Z"),
        name: "20261023T020000Z-1a2b3c4d",
        overrides: { destinationFingerprint: "the-old-bucket" },
      }),
    );
    putBackup(manifestFor({ id: FIRST_ID, name: "20261023T020000Z-1a2b3c4d" }));

    expect((await sync()).updated).toBe(1);
    expect(tables.runs.get(FIRST_ID)!["destinationFingerprint"]).toBe(
      MINIO_FINGERPRINT,
    );
  });

  test("a backup no longer at this destination goes from the list; one at a previous destination stays", async () => {
    tables.runs.rows.push(
      succeededBackupRow({
        id: FIRST_ID,
        startedAt: new Date("2026-10-20T02:00:00.000Z"),
        name: "20261020T020000Z-1a2b3c4d",
      }),
      succeededBackupRow({
        id: SECOND_ID,
        startedAt: new Date("2026-09-20T02:00:00.000Z"),
        name: "20260920T020000Z-1a2b3c4d",
        overrides: { destinationFingerprint: "the-old-bucket" },
      }),
    );

    expect((await sync()).removed).toBe(1);
    expect(tables.runs.get(FIRST_ID)).toBeUndefined();
    expect(tables.runs.get(SECOND_ID)).toBeDefined();
  });

  test("a failed or running backup is never removed for having no folder", async () => {
    tables.runs.rows.push(
      runRow({
        _id: FIRST_ID,
        status: BackupRunStatus.Failed,
        name: "20261020T020000Z-1a2b3c4d",
        destinationFingerprint: MINIO_FINGERPRINT,
      }),
      runRow({
        _id: SECOND_ID,
        status: BackupRunStatus.Running,
        name: "20261024T020000Z-1a2b3c4d",
        destinationFingerprint: MINIO_FINGERPRINT,
      }),
    );

    expect((await sync()).removed).toBe(0);
    expect(tables.runs.rows).toHaveLength(2);
  });

  test("restores are never touched", async () => {
    tables.runs.rows.push(
      runRow({
        _id: FIRST_ID,
        kind: BackupRunKind.Restore,
        status: BackupRunStatus.Succeeded,
        name: "20261020T020000Z-1a2b3c4d",
        destinationFingerprint: MINIO_FINGERPRINT,
      }),
    );

    expect((await sync()).removed).toBe(0);
    expect(tables.runs.get(FIRST_ID)).toBeDefined();
  });

  test("a folder whose manifest is not written yet is a backup still being made: skipped", async () => {
    storage.write(`${FOLDER}20261024T020000Z-1a2b3c4d/postgres.dump`, "PGDMP");

    expect(await sync()).toEqual({
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      unreadable: [],
    });
  });

  test("a manifest it cannot read is reported, and its row is kept", async () => {
    tables.runs.rows.push(
      succeededBackupRow({
        id: FIRST_ID,
        startedAt: new Date("2026-10-23T02:00:00.000Z"),
        name: "20261023T020000Z-1a2b3c4d",
      }),
    );
    storage.write(
      getBackupManifestKey(FOLDER, "20261023T020000Z-1a2b3c4d"),
      "{",
    );

    expect(await sync()).toEqual({
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      unreadable: ["20261023T020000Z-1a2b3c4d"],
    });
    expect(tables.runs.get(FIRST_ID)).toBeDefined();
  });

  test("folders that are not backups' are not read", async () => {
    storage.write(
      `${FOLDER}oneuptime-backup-test/abc/oneuptime-backup-test.txt`,
      "x",
    );
    storage.write(
      `${FOLDER}notes/manifest.json`,
      JSON.stringify(manifestFor({ id: FIRST_ID, name: "notes" })),
    );

    expect((await sync()).found).toBe(0);
    expect(
      storage.calls.filter((call: string): boolean => {
        return call.startsWith("read ");
      }),
    ).toEqual([]);
  });

  test("a manifest whose id is not a UUID gets an id of its own", async () => {
    putBackup(
      manifestFor({ id: "not-a-uuid", name: "20261023T020000Z-notauuid" }),
    );

    expect((await sync()).added).toBe(1);
    expect(String(tables.runs.rows[0]!["_id"])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
