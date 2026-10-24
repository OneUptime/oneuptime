import {
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
} from "Common/Types/Backup/BackupRunTypes";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Backups page says (Admin Dashboard > Settings > Backups), kept
 * free of React so the components and the tests read the same words. The
 * sentences are English keys of the Admin Dashboard's locale files, in every
 * language; the shared components translate them where they are shown.
 *
 * The destinations' own words (titles, fields, options) are the catalog's
 * (Common/Types/Backup/BackupDestinationCatalog), drawn as written there and
 * translated the same way.
 */

export const BackupsCopy: {
  // The page before anything is set up.
  heroTitle: string;
  heroDescription: string;
  heroScheduleTitle: string;
  heroScheduleText: string;
  heroRetentionTitle: string;
  heroRetentionText: string;
  heroRestoreTitle: string;
  heroRestoreText: string;
  setUpButton: string;
  docsLink: string;
  recommendedTitle: string;
  movingHint: string;
  // The status card.
  statusTitle: string;
  statusOn: string;
  statusOff: string;
  statusFailing: string;
  statusNoBackupYet: string;
  statusLocked: string;
  statusLockedText: string;
  lastBackup: string;
  lastBackupSize: string;
  nextBackup: string;
  nextBackupOff: string;
  backUpNowButton: string;
  backUpNowTooltip: string;
  turnOnButton: string;
  turnOnTooltip: string;
  turnOffAction: string;
  turnOffTooltip: string;
  findBackupsAction: string;
  findBackupsTooltip: string;
  foundNoBackups: string;
  backingUp: string;
  restoring: string;
  restoringPlain: string;
  stepOf: string;
  cancelButton: string;
  cancelTooltip: string;
  cancelRequested: string;
  viewStepsButton: string;
  queuedText: string;
  restoreRunningNote: string;
  lastFailedTitle: string;
  // The settings card.
  settingsTitle: string;
  settingsDescription: string;
  editButton: string;
  destinationLabel: string;
  scheduleLabel: string;
  retentionLabel: string;
  contentsLabel: string;
  contentsBoth: string;
  contentsPostgres: string;
  sizeNow: string;
  // The schedule, in words.
  scheduleAt: string;
  scheduleWeekly: string;
  // The backups table.
  backupsTitle: string;
  backupsDescription: string;
  backupsEmptyTitle: string;
  backupsEmptyDescription: string;
  backupColumn: string;
  contentsColumn: string;
  durationColumn: string;
  statusColumn: string;
  restoreAction: string;
  restoreActionTooltip: string;
  previousDestinationTooltip: string;
  previousDestinationNote: string;
  viewStepsAction: string;
  deleteAction: string;
  deleteTitle: string;
  deleteDescription: string;
  deletePreviousDescription: string;
  deleteNewestWarning: string;
  deleteButton: string;
  // The restores table.
  restoresTitle: string;
  restoresDescription: string;
  restoreColumn: string;
  fromBackupColumn: string;
  // The steps dialog.
  stepsTitleBackup: string;
  stepsTitleRestore: string;
  stepsStarted: string;
  stepsFinished: string;
  stepsTook: string;
  stepsWhere: string;
  stepsWritten: string;
  stepsRead: string;
  stepsSkipped: string;
  stepsWaiting: string;
  copyLocation: string;
  copyError: string;
  errorTitle: string;
  // The form.
  createTitle: string;
  createDescription: string;
  editTitle: string;
  editDescription: string;
  createButton: string;
  saveButton: string;
  destinationStep: string;
  connectionStep: string;
  scheduleStep: string;
  destinationField: string;
  destinationFieldDescription: string;
  frequencyField: string;
  frequencyFieldDescription: string;
  timeField: string;
  timeFieldDescription: string;
  timeOption: string;
  dayField: string;
  retentionField: string;
  retentionFieldDescription: string;
  clickhouseField: string;
  clickhouseFieldDescription: string;
  unchangedPlaceholder: string;
  setupGuide: string;
  // The destination test.
  testField: string;
  testButton: string;
  testHint: string;
  testRunning: string;
  testSucceeded: string;
  testFailed: string;
  testStorageCheck: string;
  testPostgresCheck: string;
  testClickhouseCheck: string;
  testChooseDestinationFirst: string;
  testFillSettingsFirst: string;
  testPasteCredentialsFirst: string;
  // The restore dialog.
  restoreTitle: string;
  restoreDescription: string;
  restoreChecking: string;
  restoreCannot: string;
  restoreWhatTitle: string;
  restorePostgresTitle: string;
  restorePostgresText: string;
  restorePostgresCounts: string;
  restorePostgresNow: string;
  restoreClickhouseTitle: string;
  restoreClickhouseText: string;
  restoreNotInBackup: string;
  restoreBackupFirstTitle: string;
  restoreBackupFirstText: string;
  restoreWithoutBackupWarning: string;
  restoreWhileRunningTitle: string;
  restoreWhileRunningText: string;
  restoreSignInText: string;
  restoreButton: string;
  restoreStarted: string;
  restoreChooseSomething: string;
  // License.
  licenseRequired: string;
  lapsedTitle: string;
  lapsedDescription: string;
  notIncludedTitle: string;
  notIncludedDescription: string;
  graceTitle: string;
  graceDescription: string;
  // Tools and database user.
  destinationErrorTitle: string;
  cannotRestoreTitle: string;
  cannotRestoreDescription: string;
  // General.
  loading: string;
  couldNotLoad: string;
  tryAgain: string;
  close: string;
  databasePostgres: string;
  databaseClickhouse: string;
  databasePostgresHint: string;
  databaseClickhouseHint: string;
} = {
  heroTitle: translationKey("Back up OneUptime"),
  heroDescription: translationKey(
    "Keep copies of OneUptime's data in storage you own: PostgreSQL holds your projects, monitors, incidents and users, ClickHouse your telemetry. Restore any backup in a few clicks.",
  ),
  heroScheduleTitle: translationKey("On a schedule"),
  heroScheduleText: translationKey(
    "Every day at 02:00 UTC, or as often as you need.",
  ),
  heroRetentionTitle: translationKey("Kept as long as you say"),
  heroRetentionText: translationKey(
    "30 days by default. Older backups are deleted for you.",
  ),
  heroRestoreTitle: translationKey("Restored safely"),
  heroRestoreText: translationKey(
    "The current data is backed up first, and OneUptime keeps running until the switch.",
  ),
  setUpButton: translationKey("Set up backups"),
  docsLink: translationKey("How backups work"),
  recommendedTitle: translationKey("Works with"),
  movingHint: translationKey(
    "Moving to a new server? Set up the destination your backups are in, and they show up here, ready to restore.",
  ),
  statusTitle: translationKey("Backups"),
  statusOn: translationKey("Backups are on"),
  statusOff: translationKey("Scheduled backups are off"),
  statusFailing: translationKey("The last backup failed"),
  statusNoBackupYet: translationKey("No backup yet"),
  statusLocked: translationKey("New backups are paused"),
  statusLockedText: translationKey(
    "They need a license that includes backups. Restoring and deleting backups still work.",
  ),
  lastBackup: translationKey("Last backup {{time}}"),
  lastBackupSize: translationKey("{{size}} in {{duration}}"),
  nextBackup: translationKey("Next backup {{time}}"),
  nextBackupOff: translationKey("Nothing runs until they are turned on again."),
  backUpNowButton: translationKey("Back up now"),
  backUpNowTooltip: translationKey(
    "Start a backup now, with the settings below.",
  ),
  turnOnButton: translationKey("Turn on"),
  turnOnTooltip: translationKey("Back up on the schedule again."),
  turnOffAction: translationKey("Turn off scheduled backups"),
  turnOffTooltip: translationKey(
    "Stop backing up on the schedule. Back up now still works, and no backup is deleted.",
  ),
  findBackupsAction: translationKey("Find backups"),
  findBackupsTooltip: translationKey(
    "Look for backups at the destination that this list does not show, such as another server's.",
  ),
  foundNoBackups: translationKey("Found no backups at the destination."),
  backingUp: translationKey("Backing up"),
  restoring: translationKey("Restoring the backup of {{time}}"),
  restoringPlain: translationKey("Restoring a backup"),
  stepOf: translationKey("Step {{number}} of {{total}}: {{step}}"),
  cancelButton: translationKey("Cancel"),
  cancelTooltip: translationKey(
    "Stop it. Nothing it wrote is kept, and nothing is changed.",
  ),
  cancelRequested: translationKey("Stopping…"),
  viewStepsButton: translationKey("View steps"),
  queuedText: translationKey("Starts within a minute."),
  restoreRunningNote: translationKey(
    "OneUptime keeps working on the current data until the switch-over, which takes a moment.",
  ),
  lastFailedTitle: translationKey("Why it failed"),
  settingsTitle: translationKey("Backup settings"),
  settingsDescription: translationKey(
    "Where backups go, how often they run and how long they are kept.",
  ),
  editButton: translationKey("Edit"),
  destinationLabel: translationKey("Destination"),
  scheduleLabel: translationKey("Schedule"),
  retentionLabel: translationKey("Kept for"),
  contentsLabel: translationKey("Backed up"),
  contentsBoth: translationKey("PostgreSQL and ClickHouse"),
  contentsPostgres: translationKey("PostgreSQL only"),
  sizeNow: translationKey("{{size}} now"),
  scheduleAt: translationKey("{{frequency}} at {{time}} UTC"),
  scheduleWeekly: translationKey("Every {{day}} at {{time}} UTC"),
  backupsTitle: translationKey("Backups"),
  backupsDescription: translationKey(
    "Every backup at the destination, newest first. Restore one to go back to it.",
  ),
  backupsEmptyTitle: translationKey("No backups yet"),
  backupsEmptyDescription: translationKey(
    "The first one runs on the schedule, or now with Back up now.",
  ),
  backupColumn: translationKey("Backup"),
  contentsColumn: translationKey("Contents"),
  durationColumn: translationKey("Took"),
  statusColumn: translationKey("Status"),
  restoreAction: translationKey("Restore"),
  restoreActionTooltip: translationKey(
    "Replace the current data with this backup's. You choose what, and confirm first.",
  ),
  previousDestinationTooltip: translationKey(
    "This backup is at a previous destination. Set that destination again to restore or delete it.",
  ),
  previousDestinationNote: translationKey("At a previous destination"),
  viewStepsAction: translationKey("View steps"),
  deleteAction: translationKey("Delete"),
  deleteTitle: translationKey("Delete the backup of {{time}}?"),
  deleteDescription: translationKey(
    "Its files are deleted from the destination. It cannot be restored afterwards.",
  ),
  deletePreviousDescription: translationKey(
    "It is removed from this list. Its files stay at the previous destination.",
  ),
  deleteNewestWarning: translationKey(
    "This is the newest backup that succeeded: until another one does, there is nothing newer to restore.",
  ),
  deleteButton: translationKey("Delete backup"),
  restoresTitle: translationKey("Restores"),
  restoresDescription: translationKey(
    "Every restore of a backup, newest first.",
  ),
  restoreColumn: translationKey("Restore"),
  fromBackupColumn: translationKey("Of the backup of"),
  stepsTitleBackup: translationKey("Backup of {{time}}"),
  stepsTitleRestore: translationKey("Restore of the backup of {{time}}"),
  stepsStarted: translationKey("Started {{time}}"),
  stepsFinished: translationKey("Finished {{time}}"),
  stepsTook: translationKey("Took {{duration}}"),
  stepsWhere: translationKey("Where"),
  stepsWritten: translationKey("{{size}} written"),
  stepsRead: translationKey("{{done}} of {{total}}"),
  stepsSkipped: translationKey("Skipped"),
  stepsWaiting: translationKey("Waiting"),
  copyLocation: translationKey("Copy location"),
  copyError: translationKey("Copy error"),
  errorTitle: translationKey("What went wrong"),
  createTitle: translationKey("Set up backups"),
  createDescription: translationKey(
    "Choose where backups go, test it, then say how often they run and how long they are kept.",
  ),
  editTitle: translationKey("Edit backup settings"),
  editDescription: translationKey(
    "Credentials stay unless you paste new ones. Backups already made stay where they are.",
  ),
  createButton: translationKey("Start backing up"),
  saveButton: translationKey("Save changes"),
  destinationStep: translationKey("Destination"),
  connectionStep: translationKey("Connection"),
  scheduleStep: translationKey("Schedule"),
  destinationField: translationKey("Where should backups go?"),
  destinationFieldDescription: translationKey(
    "Storage you own. OneUptime and ClickHouse both write to it.",
  ),
  frequencyField: translationKey("How often"),
  frequencyFieldDescription: translationKey(
    "Once a day suits most installations.",
  ),
  timeField: translationKey("At (UTC)"),
  timeFieldDescription: translationKey(
    "Choose a quiet hour. Every 6 or 12 hours count from it.",
  ),
  timeOption: translationKey("{{utc}} UTC ({{local}} your time)"),
  dayField: translationKey("On"),
  retentionField: translationKey("Keep backups for (days)"),
  retentionFieldDescription: translationKey(
    "Older backups are deleted after each new one, except the newest that succeeded.",
  ),
  clickhouseField: translationKey("Back up ClickHouse too"),
  clickhouseFieldDescription: translationKey(
    "Your logs, traces and metrics. It can be large. PostgreSQL is always backed up.",
  ),
  unchangedPlaceholder: translationKey("Unchanged"),
  setupGuide: translationKey("Setup guide"),
  testField: translationKey("Test before saving"),
  testButton: translationKey("Test the destination"),
  testHint: translationKey(
    "Writes, reads and deletes a small test file, and asks ClickHouse to do the same. Nothing is saved.",
  ),
  testRunning: translationKey("Testing…"),
  testSucceeded: translationKey("Everything a backup needs works."),
  testFailed: translationKey("Something a backup needs does not work yet."),
  testStorageCheck: translationKey("OneUptime can write here"),
  testPostgresCheck: translationKey("PostgreSQL can be backed up"),
  testClickhouseCheck: translationKey("ClickHouse can write here"),
  testChooseDestinationFirst: translationKey("Choose a destination first."),
  testFillSettingsFirst: translationKey(
    "Fill in the settings above to test them.",
  ),
  testPasteCredentialsFirst: translationKey(
    "Paste the credentials above to test them.",
  ),
  restoreTitle: translationKey("Restore the backup of {{time}}?"),
  restoreDescription: translationKey(
    "What you restore replaces the current data. Everything changed since this backup is lost.",
  ),
  restoreChecking: translationKey("Checking the backup…"),
  restoreCannot: translationKey("This backup cannot be restored"),
  restoreWhatTitle: translationKey("What to restore"),
  restorePostgresTitle: translationKey(
    "PostgreSQL: projects, monitors, incidents, users",
  ),
  restorePostgresText: translationKey(
    "Every setting and record goes back to {{time}}.",
  ),
  restorePostgresCounts: translationKey("The backup holds {{counts}}."),
  restorePostgresNow: translationKey("Now: {{counts}}."),
  restoreClickhouseTitle: translationKey("ClickHouse: logs, traces, metrics"),
  restoreClickhouseText: translationKey(
    "{{size}} of telemetry. Telemetry received since the backup is lost, and none is stored while it restores.",
  ),
  restoreNotInBackup: translationKey("Not in this backup."),
  restoreBackupFirstTitle: translationKey("Back up the current data first"),
  restoreBackupFirstText: translationKey(
    "Recommended: you can go back to it. It takes about as long as a backup.",
  ),
  restoreWithoutBackupWarning: translationKey(
    "Without a backup first, this restore cannot be undone.",
  ),
  restoreWhileRunningTitle: translationKey("While it restores"),
  restoreWhileRunningText: translationKey(
    "OneUptime keeps running on the current data, then switches to the restored data in a moment. Each step shows on this page.",
  ),
  restoreSignInText: translationKey(
    "You may be signed out afterwards: sign in with an account that is in the backup.",
  ),
  restoreButton: translationKey("Restore"),
  restoreStarted: translationKey(
    "The restore has started. Each step shows on this page.",
  ),
  restoreChooseSomething: translationKey("Choose what to restore."),
  licenseRequired: translationKey(
    "Needs a valid Enterprise license that includes backups.",
  ),
  lapsedTitle: translationKey(
    "Enterprise license required: no new backups are made.",
  ),
  lapsedDescription: translationKey(
    "Without a valid Enterprise license, scheduled backups stop. Your backups stay at the destination, and you can still restore and delete them. Activate a license to back up again.",
  ),
  notIncludedTitle: translationKey(
    "Your Enterprise license does not include backups: no new backups are made.",
  ),
  notIncludedDescription: translationKey(
    "The installed license leaves backups out. Your backups stay at the destination, and you can still restore and delete them.",
  ),
  graceTitle: translationKey(
    "No valid Enterprise license: backups stop when the trial or grace period ends.",
  ),
  graceDescription: translationKey(
    "Backups run during the trial or the grace period. When it ends, no new backups are made until a license is activated. Restoring always works.",
  ),
  destinationErrorTitle: translationKey("The backup settings need attention"),
  cannotRestoreTitle: translationKey("Restoring PostgreSQL needs one change"),
  cannotRestoreDescription: translationKey(
    "The database user {{user}} may not create databases, which a restore does. Run ALTER USER {{user}} CREATEDB; on PostgreSQL. Backups work as they are.",
  ),
  loading: translationKey("Loading…"),
  couldNotLoad: translationKey("Backups could not be loaded."),
  tryAgain: translationKey("Try again"),
  close: translationKey("Close"),
  databasePostgres: translationKey("PostgreSQL"),
  databaseClickhouse: translationKey("ClickHouse"),
  databasePostgresHint: translationKey("Configuration"),
  databaseClickhouseHint: translationKey("Telemetry"),
};

// What a run's status reads as, and what it means.
export const BACKUP_RUN_STATUS_COPY: Record<
  BackupRunStatus,
  { title: string; description: string }
> = {
  [BackupRunStatus.Queued]: {
    title: translationKey("Waiting"),
    description: translationKey("It starts within a minute."),
  },
  [BackupRunStatus.Running]: {
    title: translationKey("Running"),
    description: translationKey("Open View steps to follow it."),
  },
  [BackupRunStatus.Succeeded]: {
    title: translationKey("Succeeded"),
    description: translationKey("Every step finished."),
  },
  [BackupRunStatus.Failed]: {
    title: translationKey("Failed"),
    description: translationKey(
      "A step failed. Open View steps to see which, and why.",
    ),
  },
  [BackupRunStatus.Cancelled]: {
    title: translationKey("Cancelled"),
    description: translationKey("Stopped by a master admin. Nothing was kept."),
  },
};

// What started a run, under its time.
export const BACKUP_RUN_TRIGGER_COPY: Record<BackupRunTrigger, string> = {
  [BackupRunTrigger.Scheduled]: translationKey("Scheduled"),
  [BackupRunTrigger.Manual]: translationKey("Started by hand"),
  [BackupRunTrigger.BeforeRestore]: translationKey("Before a restore"),
  [BackupRunTrigger.FoundAtDestination]: translationKey(
    "Found at the destination",
  ),
};

// Each step's name, in the order the steps dialog lists them.
export const BACKUP_STEP_COPY: Record<BackupStepKey, string> = {
  [BackupStepKey.CheckDestination]: translationKey("Check the destination"),
  [BackupStepKey.BackUpPostgres]: translationKey("Back up PostgreSQL"),
  [BackupStepKey.BackUpClickhouse]: translationKey("Back up ClickHouse"),
  [BackupStepKey.VerifyBackup]: translationKey("Check the backup"),
  [BackupStepKey.DeleteOldBackups]: translationKey("Delete old backups"),
  [BackupStepKey.CheckBackup]: translationKey("Check the backup"),
  [BackupStepKey.BackUpCurrentData]: translationKey("Back up the current data"),
  [BackupStepKey.RestorePostgres]: translationKey("Restore PostgreSQL"),
  [BackupStepKey.RestoreClickhouse]: translationKey("Restore ClickHouse"),
  [BackupStepKey.SwitchOver]: translationKey("Switch to the restored data"),
  [BackupStepKey.UpgradeRestoredData]: translationKey(
    "Bring the restored data up to date",
  ),
  [BackupStepKey.CleanUp]: translationKey("Clean up"),
};

export const BACKUP_FREQUENCY_COPY: Record<BackupFrequency, string> = {
  [BackupFrequency.EveryHour]: translationKey("Every hour"),
  [BackupFrequency.Every6Hours]: translationKey("Every 6 hours"),
  [BackupFrequency.Every12Hours]: translationKey("Every 12 hours"),
  [BackupFrequency.Daily]: translationKey("Every day"),
  [BackupFrequency.Weekly]: translationKey("Every week"),
};

// What the restore dialog says about each problem or warning the server names (RestoreIssueCode).
export const RESTORE_ISSUE_COPY: Record<string, string> = {
  "previous-destination": translationKey(
    "This backup is at a previous destination. Set that destination again to restore it.",
  ),
  "not-succeeded": translationKey(
    "Only a backup that succeeded can be restored.",
  ),
  "manifest-missing": translationKey(
    "The backup is no longer at the destination: it was deleted or moved.",
  ),
  "manifest-unreadable": translationKey(
    "The backup's manifest at the destination could not be read.",
  ),
  "postgres-missing": translationKey("This backup holds no PostgreSQL."),
  "clickhouse-missing": translationKey("This backup holds no ClickHouse."),
  "postgres-file-missing": translationKey(
    "The PostgreSQL part of the backup is missing or changed at the destination.",
  ),
  "clickhouse-file-missing": translationKey(
    "The ClickHouse part of the backup is missing at the destination.",
  ),
  "newer-version": translationKey(
    "A newer version of OneUptime made this backup. Update OneUptime first, then restore it.",
  ),
  "older-version": translationKey(
    "An older version of OneUptime made this backup. The restore brings its data up to this version.",
  ),
  "tools-missing": translationKey(
    "This server cannot restore PostgreSQL yet. The details below say why.",
  ),
  "cannot-create-databases": translationKey(
    "The database user may not create databases, which a restore does. Give it CREATEDB, then try again.",
  ),
  "encryption-secret-differs": translationKey(
    "This backup was made with another ENCRYPTION_SECRET. Credentials stored in it cannot be read after the restore unless you set the old ENCRYPTION_SECRET first.",
  ),
  "encryption-unknown": translationKey(
    "The backup does not say which ENCRYPTION_SECRET made it. If it was another one, stored credentials cannot be read after the restore.",
  ),
};

/*
 * The sentences that change with a count: plain { one, other } literals, so
 * the locale files hold each under the "other" sentence's key (and "_one"
 * for the one form).
 */
export const BACKUP_PLURALS: {
  days: PluralTemplate;
  projects: PluralTemplate;
  users: PluralTemplate;
  monitors: PluralTemplate;
  statusPages: PluralTemplate;
  files: PluralTemplate;
  found: PluralTemplate;
  added: PluralTemplate;
} = {
  days: { one: "{{count}} day", other: "{{count}} days" },
  projects: { one: "{{count}} project", other: "{{count}} projects" },
  users: { one: "{{count}} user", other: "{{count}} users" },
  monitors: { one: "{{count}} monitor", other: "{{count}} monitors" },
  statusPages: {
    one: "{{count}} status page",
    other: "{{count}} status pages",
  },
  files: { one: "{{count}} file", other: "{{count}} files" },
  found: {
    one: "Found {{count}} backup at the destination.",
    other: "Found {{count}} backups at the destination.",
  },
  added: {
    one: "{{count}} was new to this list.",
    other: "{{count}} were new to this list.",
  },
};

// Test ids.
export const BACKUP_RUNS_TABLE_ID: string = "backup-runs-table";
export const RESTORE_RUNS_TABLE_ID: string = "restore-runs-table";
