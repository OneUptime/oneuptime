/*
 * `npm run backup` TELLS THE SERVER IT RAN (#7026).
 *
 * On the Community Edition a server's backups are `npm run backup`
 * (backup.sh, on the Docker Compose server): a pg_dump of PostgreSQL into
 * the Backups folder. The server used to know nothing of it, so the setup
 * checklist's Backups item was only the admin's word ("This server is
 * backed up"). Now the script tells the server each time it runs, through
 * Scripts/Install/BackupScriptRun.js, and the item is measured, as the
 * Enterprise Edition's scheduled backups are: "Backed up with npm run
 * backup", "Failing: the last backup failed on ...", or out of date.
 *
 * What is recorded is what the checklist needs and nothing else: when the
 * server was told (the run had just finished), whether pg_dump succeeded,
 * and the size of the dump it wrote. Never a path, a host or a credential.
 * One record, GlobalConfig.backupScriptLastRun, replaced by every run.
 *
 * Who may tell it: only the server's operator. The script presents the
 * server's own cluster key (ONEUPTIME_SECRET, from config.env) to the
 * ingress on that same server, POST /api/admin/health/backup-run, behind
 * ClusterKeyAuthorization, as `npm run doctor` asks the server how it is.
 * No session and no API key is taken there: a project's member, an outsider
 * and a master admin's browser are all refused. A master admin says a server
 * is backed up some other way on the checklist itself.
 *
 * Pure, with no Node or browser APIs: the server, the checklist's rules and
 * their tests read it.
 */

// Where the script tells the server, under the app's /api/admin/health.
export const BACKUP_SCRIPT_RUN_PATH: string = "/backup-run";

// The whole address, as the script calls it on the server's own ingress.
export const BACKUP_SCRIPT_RUN_URL_PATH: string = `/api/admin/health${BACKUP_SCRIPT_RUN_PATH}`;

// One run of `npm run backup`, as the server keeps it.
export interface BackupScriptRun {
  // When the server was told, as an ISO date: the run had just finished.
  at: string;
  // Whether pg_dump finished and wrote a dump that is not empty.
  succeeded: boolean;
  // The size of the dump it wrote, when it said; never for a failed run.
  sizeInBytes: number | null;
}

// What the script sends: how the run went. The server keeps the time itself.
export interface BackupScriptCheckIn {
  succeeded: boolean;
  sizeInBytes: number | null;
}

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

// A size that is one: a whole number of bytes, from 0 up.
const readSize: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }

  return value;
};

/*
 * What a request to the route carries, or null when it is not a check-in:
 * `succeeded` must be true or false; a size that is not a whole number of
 * bytes is left out, and so is any size of a run that failed. Nothing else
 * the body holds is read.
 */
export const readBackupScriptCheckIn: (
  body: unknown,
) => BackupScriptCheckIn | null = (
  body: unknown,
): BackupScriptCheckIn | null => {
  if (!isObject(body) || typeof body["succeeded"] !== "boolean") {
    return null;
  }

  const succeeded: boolean = body["succeeded"];

  return {
    succeeded: succeeded,
    sizeInBytes: succeeded ? readSize(body["sizeInBytes"]) : null,
  };
};

/*
 * The run the server kept (GlobalConfig.backupScriptLastRun), read whole, or
 * null when there is none or it is not one: a server that has never been
 * told, and one upgraded from before the script told it.
 */
export const readBackupScriptRun: (value: unknown) => BackupScriptRun | null = (
  value: unknown,
): BackupScriptRun | null => {
  if (!isObject(value) || typeof value["succeeded"] !== "boolean") {
    return null;
  }

  const at: unknown = value["at"];

  if (typeof at !== "string") {
    return null;
  }

  const date: Date = new Date(at);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const succeeded: boolean = value["succeeded"];

  return {
    at: date.toISOString(),
    succeeded: succeeded,
    sizeInBytes: succeeded ? readSize(value["sizeInBytes"]) : null,
  };
};

// The run to keep for a check-in the server was handed at `now`.
export const toBackupScriptRun: (data: {
  checkIn: BackupScriptCheckIn;
  now: Date;
}) => BackupScriptRun = (data: {
  checkIn: BackupScriptCheckIn;
  now: Date;
}): BackupScriptRun => {
  return {
    at: data.now.toISOString(),
    succeeded: data.checkIn.succeeded,
    sizeInBytes: data.checkIn.succeeded ? data.checkIn.sizeInBytes : null,
  };
};
