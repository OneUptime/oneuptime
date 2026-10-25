import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import UserService from "Common/Server/Services/UserService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import logger from "Common/Server/Utils/Logger";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStep,
  BackupStepKey,
  readBackupSteps,
} from "Common/Types/Backup/BackupRunTypes";
import ObjectID from "Common/Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";

/*
 * What the backups' suites share: the instance's backup settings and runs
 * (and its users, which a restore's row is written back for) in memory
 * behind the real services, one MinIO destination, and readings of a run's
 * row as the Backups page reads it. Not a test file itself.
 */

export const SETTING_ID: string = "4ba7b811-9dad-41d1-80b4-00c04fd43101";
export const ADMIN_USER_ID: string = "4ba7b812-9dad-41d1-80b4-00c04fd43101";
export const BACKUP_SECRET: string = "minio-secret-key-0123456789";

export const MINIO_CONFIG: Record<string, string> = {
  endpoint: "http://10.0.0.5:9000",
  bucket: "oneuptime-backups",
  accessKeyId: "backup-key",
  folder: "prod/",
};

export const MINIO_SETTINGS: BackupDestinationSettings = {
  type: BackupDestinationType.S3Compatible,
  provider: BackupProvider.MinIO,
  config: { ...MINIO_CONFIG },
  secrets: { secretAccessKey: BACKUP_SECRET },
};

export const MINIO_FINGERPRINT: string =
  BackupSettingsUtil.getDestinationFingerprint(MINIO_SETTINGS);

// Where a backup's files are, under the destination's folder.
export const FOLDER: string = "prod/";

export interface BackupTables {
  settings: InMemoryTable;
  runs: InMemoryTable;
  users: InMemoryTable;
}

export function silenceLogger(): void {
  for (const silenced of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }
}

export function settingRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: SETTING_ID,
    destinationType: BackupDestinationType.S3Compatible,
    destinationProvider: BackupProvider.MinIO,
    config: { ...MINIO_CONFIG },
    secrets: JSON.stringify({ secretAccessKey: BACKUP_SECRET }),
    isEnabled: true,
    frequency: BackupFrequency.Daily,
    timeOfDay: "02:00",
    dayOfWeek: 0,
    retentionInDays: 30,
    includesClickhouse: true,
    nextBackupAt: new Date("2026-10-25T02:00:00.000Z"),
    lastFailureNotifiedAt: null,
    version: 1,
    ...overrides,
  };
}

export function useBackupTables(
  options: {
    setting?: StoredRow | null | undefined;
    runs?: Array<StoredRow> | undefined;
  } = {},
): BackupTables {
  return {
    settings: useInMemoryTable(
      BackupSettingService,
      options.setting === null ? [] : [options.setting || settingRow()],
    ),
    runs: useInMemoryTable(BackupRunService, options.runs || []),
    users: useInMemoryTable(UserService, [
      { _id: ADMIN_USER_ID, email: "admin@example.com", version: 1 },
    ]),
  };
}

export function runRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: ObjectID.generate().toString(),
    kind: BackupRunKind.Backup,
    trigger: BackupRunTrigger.Manual,
    status: BackupRunStatus.Queued,
    includesPostgres: true,
    includesClickhouse: true,
    createdAt: new Date("2026-10-24T11:59:00.000Z"),
    version: 1,
    ...overrides,
  };
}

// A backup that succeeded at the MinIO destination, started `startedAt`.
export function succeededBackupRow(data: {
  startedAt: Date;
  name: string;
  id?: string | undefined;
  overrides?: StoredRow | undefined;
}): StoredRow {
  return runRow({
    _id: data.id || ObjectID.generate().toString(),
    trigger: BackupRunTrigger.Scheduled,
    status: BackupRunStatus.Succeeded,
    name: data.name,
    startedAt: data.startedAt,
    finishedAt: new Date(data.startedAt.getTime() + 6000),
    createdAt: data.startedAt,
    destinationType: BackupDestinationType.S3Compatible,
    destinationFingerprint: MINIO_FINGERPRINT,
    location: `memory://backups/${FOLDER}${data.name}/`,
    ...(data.overrides || {}),
  });
}

export function stepsOf(row: StoredRow | undefined): Array<BackupStep> {
  return readBackupSteps(row?.["steps"]);
}

// "check-destination: succeeded", in the order the page lists them.
export function stepStatuses(row: StoredRow | undefined): Array<string> {
  return stepsOf(row).map((step: BackupStep): string => {
    return `${step.key}: ${step.status}`;
  });
}

export function stepOf(
  row: StoredRow | undefined,
  key: BackupStepKey,
): BackupStep | undefined {
  return stepsOf(row).find((step: BackupStep): boolean => {
    return step.key === key;
  });
}
