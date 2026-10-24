import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import ObjectID from "Common/Types/ObjectID";
import { getBackupTestFolderKey } from "./BackupLayout";
import ClickhouseBackupEngine from "./ClickHouse/ClickhouseBackupEngine";
import PostgresBackupEngine, {
  PostgresServerInfo,
} from "./Postgres/PostgresBackupEngine";
import { pickPostgresToolSet, PostgresToolSet } from "./Postgres/PostgresTools";
import { errorText } from "./Storage/BackupHttp";
import {
  BackupListing,
  BackupObject,
  BackupStorage,
  deleteBackupPrefix,
} from "./Storage/BackupStorage";

/*
 * "Test the destination", before anything is saved: everything a backup
 * will do, done once, small, and removed again.
 *
 *   storage      OneUptime writes a test file under the folder, reads it
 *                back, lists the folder and deletes it - the four things a
 *                backup's key must be allowed to do;
 *   postgres     pg_dump fits this PostgreSQL server (and whether the user
 *                may create the database a restore needs);
 *   clickhouse   ClickHouse writes a test backup of the telemetry database's
 *                table definitions alone (structure_only: no data) to the
 *                same storage, from its own network, which is then removed.
 *
 * Each check says what it did or what to change; the test passes when all
 * of them do.
 */

export enum BackupTestCheckKey {
  Storage = "storage",
  Postgres = "postgres",
  Clickhouse = "clickhouse",
}

export interface BackupTestCheck {
  key: BackupTestCheckKey;
  isSuccessful: boolean;
  message: string;
}

export interface BackupTestResult {
  isSuccessful: boolean;
  checks: Array<BackupTestCheck>;
}

export const BACKUP_TEST_FILE_NAME: string = "oneuptime-backup-test.txt";

const CLICKHOUSE_TEST_TIMEOUT_IN_MS: number = 2 * 60 * 1000;

async function checkStorage(data: {
  storage: BackupStorage;
  folderKey: string;
}): Promise<BackupTestCheck> {
  const key: string = `${data.folderKey}${BACKUP_TEST_FILE_NAME}`;
  const body: Buffer = Buffer.from(
    `OneUptime wrote this file to check it can back up here. It is deleted right away; if it is still here, delete it.\n${new Date().toISOString()}\n`,
    "utf8",
  );

  try {
    await data.storage.putObject({ key, body, contentType: "text/plain" });

    const read: Buffer | null = await data.storage.readSmallObject(
      key,
      64 * 1024,
    );

    if (!read || !read.equals(body)) {
      throw new Error(
        `The test file read back from ${data.storage.describeKey(key)} is not the one written.`,
      );
    }

    const listing: BackupListing = await data.storage.list({
      prefix: data.folderKey,
    });

    if (
      !listing.objects.some((object: BackupObject): boolean => {
        return object.key === key;
      })
    ) {
      throw new Error(
        `The test file was written, but listing ${data.storage.describeKey(data.folderKey)} does not show it.`,
      );
    }

    await data.storage.deleteObject(key);

    return {
      key: BackupTestCheckKey.Storage,
      isSuccessful: true,
      message: `OneUptime wrote, read, listed and deleted a test file at ${data.storage.describeKey(data.folderKey)}.`,
    };
  } catch (error) {
    await data.storage.deleteObject(key).catch(() => {
      // The file may never have been written.
    });

    return {
      key: BackupTestCheckKey.Storage,
      isSuccessful: false,
      message: errorText(error) + ".",
    };
  }
}

async function checkPostgres(
  postgres: PostgresBackupEngine,
): Promise<BackupTestCheck> {
  try {
    const info: PostgresServerInfo = await postgres.getServerInfo();
    const tools: PostgresToolSet = pickPostgresToolSet({
      toolSets: await postgres.getToolSets(),
      serverMajor: info.major,
    });
    const restoreNote: string =
      info.isSuperuser || info.canCreateDatabases
        ? ""
        : ` Restoring needs one more thing: the database user ${info.user} may not create databases (ALTER USER ${info.user} CREATEDB;).`;

    return {
      key: BackupTestCheckKey.Postgres,
      isSuccessful: true,
      message: `pg_dump ${tools.version} is ready for PostgreSQL ${info.version}.${restoreNote}`,
    };
  } catch (error) {
    return {
      key: BackupTestCheckKey.Postgres,
      isSuccessful: false,
      message: errorText(error) + ".",
    };
  }
}

async function checkClickhouse(data: {
  clickhouse: ClickhouseBackupEngine;
  settings: BackupDestinationSettings;
  storage: BackupStorage;
  folderKey: string;
}): Promise<BackupTestCheck> {
  const folderKey: string = `${data.folderKey}clickhouse/`;
  const id: string = ObjectID.generate().toString();
  const startedAt: number = Date.now();

  try {
    await data.clickhouse.startBackup({
      settings: data.settings,
      folderKey,
      id,
      structureOnly: true,
    });

    await data.clickhouse.waitFor({
      id,
      shouldStop: (): boolean => {
        return Date.now() - startedAt > CLICKHOUSE_TEST_TIMEOUT_IN_MS;
      },
    });

    return {
      key: BackupTestCheckKey.Clickhouse,
      isSuccessful: true,
      message: `ClickHouse wrote a test backup (its tables' definitions, no data) to ${data.storage.describeKey(folderKey)}, then it was removed.`,
    };
  } catch (error) {
    return {
      key: BackupTestCheckKey.Clickhouse,
      isSuccessful: false,
      message: errorText(error) + ".",
    };
  }
}

export async function testBackupDestination(data: {
  settings: BackupDestinationSettings;
  storage: BackupStorage;
  postgres: PostgresBackupEngine;
  clickhouse: ClickhouseBackupEngine;
  includesClickhouse: boolean;
}): Promise<BackupTestResult> {
  const folderKey: string = getBackupTestFolderKey(
    BackupSettingsUtil.getFolder(data.settings),
    ObjectID.generate().toString(),
  );

  const checks: Array<BackupTestCheck> = [];
  const storageCheck: BackupTestCheck = await checkStorage({
    storage: data.storage,
    folderKey,
  });

  checks.push(storageCheck);
  checks.push(await checkPostgres(data.postgres));

  if (data.includesClickhouse && storageCheck.isSuccessful) {
    checks.push(
      await checkClickhouse({
        clickhouse: data.clickhouse,
        settings: data.settings,
        storage: data.storage,
        folderKey,
      }),
    );
  }

  // Whatever the test wrote goes, whichever check stopped it.
  if (storageCheck.isSuccessful) {
    await deleteBackupPrefix({ storage: data.storage, prefix: folderKey }).catch(
      () => {
        // Its folder says what it is; the storage check already passed.
      },
    );
  }

  return {
    isSuccessful: checks.every((check: BackupTestCheck): boolean => {
      return check.isSuccessful;
    }),
    checks,
  };
}
