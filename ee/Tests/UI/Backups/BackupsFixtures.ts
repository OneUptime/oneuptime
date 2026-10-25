import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStep,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { BackupsOverview } from "../../../AdminDashboard/Backups/BackupsApi";

/*
 * The instance the Backups page tests read: its one backup setting (MinIO),
 * what /backup/overview says of it, and backup runs as BackupRun rows - with
 * the model API's reads answered from them the way the server's would be
 * (a query by kind and status, newest or oldest first, a limit).
 */

export const SETTING_ID: string = "77777777-7777-4777-8777-777777777777";
export const FINGERPRINT: string =
  "s3-compatible:minio.acme.internal:9000/oneuptime-backups/prod/";
export const LOCATION: string =
  "s3://oneuptime-backups/prod/ at https://minio.acme.internal:9000";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * HOUR);
}

export function savedSetting(
  fields: Partial<Record<string, unknown>> = {},
): BackupSetting {
  const setting: BackupSetting = new BackupSetting();
  setting.id = new ObjectID(SETTING_ID);
  setting.destinationType = BackupDestinationType.S3Compatible;
  setting.destinationProvider = BackupProvider.MinIO;
  setting.config = {
    endpoint: "https://minio.acme.internal:9000",
    bucket: "oneuptime-backups",
    accessKeyId: "backup-writer",
    folder: "prod/",
  };
  setting.isEnabled = true;
  setting.frequency = BackupFrequency.Daily;
  setting.timeOfDay = "02:00";
  setting.dayOfWeek = 0;
  setting.retentionInDays = 30;
  setting.includesClickhouse = true;

  for (const key of Object.keys(fields)) {
    (setting as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return setting;
}

export function overviewOf(
  fields: Partial<BackupsOverview> = {},
): BackupsOverview {
  return {
    isSetUp: true,
    isActive: true,
    isAvailable: true,
    nextBackupAt: hoursFromNow(14).toISOString(),
    location: LOCATION,
    destinationFingerprint: FINGERPRINT,
    destinationError: null,
    postgres: {
      version: "16.4",
      sizeInBytes: 41 * 1024 ** 2,
      database: "oneuptimedb",
      canRestore: true,
      user: "postgres",
    },
    clickhouse: {
      version: "25.3",
      sizeInBytes: 2.2 * 1024 ** 3,
      database: "oneuptime",
    },
    ...fields,
  };
}

// Nothing set up: no destination, nothing to say of one.
export function emptyOverview(
  fields: Partial<BackupsOverview> = {},
): BackupsOverview {
  return overviewOf({
    isSetUp: false,
    nextBackupAt: null,
    location: null,
    destinationFingerprint: null,
    ...fields,
  });
}

export function step(
  key: BackupStepKey,
  status: BackupStepStatus,
  fields: Partial<BackupStep> = {},
): BackupStep {
  return { key, status, ...fields };
}

export function backupRun(
  id: string,
  fields: Partial<Record<string, unknown>> = {},
): BackupRun {
  const run: BackupRun = new BackupRun();
  const startedAt: Date = (fields["startedAt"] as Date) || minutesAgo(120);

  run.id = new ObjectID(id);
  run.kind = BackupRunKind.Backup;
  run.trigger = BackupRunTrigger.Scheduled;
  run.status = BackupRunStatus.Succeeded;
  run.name = `oneuptime-backup-${id.slice(0, 8)}`;
  run.location = `${LOCATION.split(" ")[0]}oneuptime-backup-${id.slice(0, 8)}/`;
  run.startedAt = startedAt;
  run.createdAt = startedAt;
  run.finishedAt = new Date(startedAt.getTime() + 4 * MINUTE);
  run.includesPostgres = true;
  run.includesClickhouse = true;
  run.postgresSizeInBytes = 41 * 1024 ** 2;
  run.clickhouseSizeInBytes = 2 * 1024 ** 2;
  run.destinationFingerprint = FINGERPRINT;
  run.steps = [
    step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
    step(BackupStepKey.BackUpPostgres, BackupStepStatus.Succeeded),
    step(BackupStepKey.BackUpClickhouse, BackupStepStatus.Succeeded),
    step(BackupStepKey.VerifyBackup, BackupStepStatus.Succeeded),
    step(BackupStepKey.DeleteOldBackups, BackupStepStatus.Succeeded),
  ] as unknown as JSONArray;

  for (const key of Object.keys(fields)) {
    (run as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return run;
}

function valueOf(run: BackupRun, key: string): unknown {
  return (run as unknown as Record<string, unknown>)[key];
}

// Whether a row answers a model API query: equal values, or one of an Includes.
export function matchesQuery(
  run: BackupRun,
  query: Record<string, unknown>,
): boolean {
  return Object.keys(query).every((key: string): boolean => {
    const expected: unknown = query[key];

    if (expected instanceof Includes) {
      return (expected.values as Array<unknown>).includes(valueOf(run, key));
    }

    return valueOf(run, key) === expected;
  });
}

export function sortRuns(
  runs: Array<BackupRun>,
  sort: Record<string, unknown> | undefined,
): Array<BackupRun> {
  const entry: [string, unknown] | undefined = Object.entries(sort || {})[0];

  if (!entry) {
    return runs;
  }

  const [key, order] = entry;
  const time: (run: BackupRun) => number = (run: BackupRun): number => {
    const value: unknown = valueOf(run, key);
    return value ? new Date(value as Date).getTime() : 0;
  };

  return [...runs].sort((a: BackupRun, b: BackupRun): number => {
    return order === SortOrder.Descending
      ? time(b) - time(a)
      : time(a) - time(b);
  });
}

export function bodyOf(value: unknown): JSONObject {
  return (value || {}) as JSONObject;
}
