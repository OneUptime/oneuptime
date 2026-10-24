import { Readable } from "stream";
import AnalyticsTableManagement from "App/FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";
import { ClickhouseMigrationInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import DatabaseDataSourceOptions from "Common/Server/Infrastructure/Postgres/DataSourceOptions";
import SchemaMigrationRunner from "Common/Server/Infrastructure/Postgres/SchemaMigrationRunner";
import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import logger from "Common/Server/Utils/Logger";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupManifest,
  BackupPostgresCounts,
} from "Common/Types/Backup/BackupManifest";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  RESTORE_STEP_KEYS,
} from "Common/Types/Backup/BackupRunTypes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { clearCachesAfterRestore } from "./BackupCaches";
import BackupCatalogSync from "./BackupCatalogSync";
import {
  getBackupClickhouseFolderKey,
  getBackupPostgresKey,
} from "./BackupLayout";
import BackupRunner, { BackupOutcome } from "./BackupRunner";
import BackupRunRecorder, {
  BackupRunCancelledError,
  BackupRunIdentity,
} from "./BackupRunRecorder";
import ClickhouseBackupEngine, {
  ClickhouseBackupStatus,
} from "./ClickHouse/ClickhouseBackupEngine";
import PostgresBackupEngine, {
  getSuffixedDatabaseName,
  PostgresServerInfo,
} from "./Postgres/PostgresBackupEngine";
import {
  buildRestorePreview,
  RestoreIssue,
  RestorePreview,
} from "./RestorePreview";
import { errorText } from "./Storage/BackupHttp";
import { BackupDownload, BackupStorage } from "./Storage/BackupStorage";

/*
 * One restore, step by step, as its BackupRun row shows it:
 *
 *   Check the backup            what it holds, that its files are there, that
 *                               this installation can restore it (RestorePreview)
 *   Back up the current data    a backup first, unless the master admin chose not to
 *   Restore PostgreSQL          into a new database beside the live one
 *   Restore ClickHouse          the live telemetry set aside, the backup's restored
 *   Switch over                 the restored PostgreSQL takes the live one's name
 *   Upgrade the restored data   schema migrations, ClickHouse's tables and views
 *   Clean up                    the data set aside goes once a backup of it exists
 *
 * Until ClickHouse is restored and PostgreSQL switched over, nothing
 * OneUptime uses has changed, and a failure, a cancel or a restart leaves
 * everything as it was. When ClickHouse or the switch fails, what was set
 * aside is put back. The run's runnerState says what was set up, so a run
 * that stops half way (the worker restarted) is undone by the next tick
 * (recoverInterrupted).
 */

// What a restore records in runnerState, as it sets each thing up.
export interface RestoreRunnerState {
  takeBackupFirst?: boolean | undefined;
  postgresRestoreDatabase?: string | undefined;
  postgresSetAsideDatabase?: string | undefined;
  postgresSwitched?: boolean | undefined;
  clickhouseSetAsideDatabase?: string | undefined;
  clickhouseRestored?: boolean | undefined;
  keptDatabases?: Array<string> | undefined;
}

export function readRestoreRunnerState(
  value: JSONObject | undefined | null,
): RestoreRunnerState {
  const state: RestoreRunnerState = {};

  if (!value || typeof value !== "object") {
    return state;
  }

  const text: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const item: JSONValue | undefined = value[key];
    return typeof item === "string" && item ? item : undefined;
  };

  state.takeBackupFirst = value["takeBackupFirst"] === true;

  const postgresRestoreDatabase: string | undefined = text(
    "postgresRestoreDatabase",
  );
  const postgresSetAsideDatabase: string | undefined = text(
    "postgresSetAsideDatabase",
  );
  const clickhouseSetAsideDatabase: string | undefined = text(
    "clickhouseSetAsideDatabase",
  );

  if (postgresRestoreDatabase) {
    state.postgresRestoreDatabase = postgresRestoreDatabase;
  }
  if (postgresSetAsideDatabase) {
    state.postgresSetAsideDatabase = postgresSetAsideDatabase;
  }
  if (clickhouseSetAsideDatabase) {
    state.clickhouseSetAsideDatabase = clickhouseSetAsideDatabase;
  }

  state.postgresSwitched = value["postgresSwitched"] === true;
  state.clickhouseRestored = value["clickhouseRestored"] === true;

  const kept: JSONValue | undefined = value["keptDatabases"];

  if (Array.isArray(kept)) {
    state.keptDatabases = kept.filter((item: JSONValue): boolean => {
      return typeof item === "string";
    }) as Array<string>;
  }

  return state;
}

function describeCounts(counts: BackupPostgresCounts): string {
  const parts: Array<string> = [];
  const add: (count: number | undefined, one: string, many: string) => void = (
    count: number | undefined,
    one: string,
    many: string,
  ): void => {
    if (count !== undefined) {
      parts.push(`${count} ${count === 1 ? one : many}`);
    }
  };

  add(counts.projects, "project", "projects");
  add(counts.users, "user", "users");
  add(counts.monitors, "monitor", "monitors");
  add(counts.statusPages, "status page", "status pages");

  return parts.join(", ");
}

export interface RestoreRunnerDependencies {
  backupRunner?: BackupRunner | undefined;
  // Brings a restored PostgreSQL up to this release: the names of the migrations it ran.
  migratePostgres?: (() => Promise<Array<string>>) | undefined;
  // Brings a restored ClickHouse's tables and views up to this release.
  reconcileClickhouse?: (() => Promise<void>) | undefined;
  clearCaches?: (() => Promise<number>) | undefined;
  now?: (() => Date) | undefined;
}

export default class RestoreRunner {
  private readonly backupRunner: BackupRunner;
  private readonly postgres: PostgresBackupEngine;
  private readonly clickhouse: ClickhouseBackupEngine;
  private readonly migratePostgres: () => Promise<Array<string>>;
  private readonly reconcileClickhouse: () => Promise<void>;
  private readonly clearCaches: () => Promise<number>;
  private readonly now: () => Date;

  public constructor(dependencies: RestoreRunnerDependencies = {}) {
    this.backupRunner = dependencies.backupRunner || new BackupRunner();
    this.postgres = this.backupRunner.getPostgresEngine();
    this.clickhouse = this.backupRunner.getClickhouseEngine();
    this.migratePostgres =
      dependencies.migratePostgres ||
      (async (): Promise<Array<string>> => {
        return await SchemaMigrationRunner.runPendingMigrations(
          DatabaseDataSourceOptions,
        );
      });
    this.reconcileClickhouse =
      dependencies.reconcileClickhouse ||
      (async (): Promise<void> => {
        if (!ClickhouseMigrationInstance.isConnected()) {
          await ClickhouseMigrationInstance.connect(
            ClickhouseMigrationInstance.getDatasourceOptions(),
          );
        }

        await AnalyticsTableManagement.createTables();
        await AnalyticsTableManagement.createMaterializedViews();
      });
    this.clearCaches =
      dependencies.clearCaches ||
      (async (): Promise<number> => {
        return await clearCachesAfterRestore();
      });
    this.now =
      dependencies.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });
  }

  private static issuesText(issues: Array<RestoreIssue>): string {
    return issues
      .map((issue: RestoreIssue): string => {
        return issue.message;
      })
      .join(" ");
  }

  /*
   * Restores the backup a restore row names. Never throws: the outcome is
   * the row's, and a failure is handed to onFailure (the notification).
   */
  public async run(data: {
    run: BackupRun;
    signal?: AbortSignal | undefined;
    onFailure?: ((error: string) => Promise<void>) | undefined;
  }): Promise<boolean> {
    const run: BackupRun = data.run;
    const identity: BackupRunIdentity = {
      id: run.id!,
      kind: BackupRunKind.Restore,
      trigger: run.trigger || BackupRunTrigger.Manual,
      includesPostgres: run.includesPostgres !== false,
      includesClickhouse: run.includesClickhouse === true,
      createdByUserId: run.createdByUserId,
      restoredBackupRunId: run.restoredBackupRunId,
    };
    const recorder: BackupRunRecorder = new BackupRunRecorder({
      identity,
      stepKeys: RESTORE_STEP_KEYS,
      now: this.now,
    });
    const state: RestoreRunnerState = readRestoreRunnerState(run.runnerState);

    const saveState: () => Promise<void> = async (): Promise<void> => {
      await recorder.update({
        runnerState: JSON.parse(JSON.stringify(state)) as JSONObject,
      });
    };

    // Until ClickHouse or PostgreSQL is touched, a cancel or a stop undoes nothing.
    let pastTheLiveData: boolean = false;
    let storage: BackupStorage | null = null;
    let settings: BackupDestinationSettings | null = null;

    const throwIfCancelled: () => Promise<void> = async (): Promise<void> => {
      if (pastTheLiveData) {
        return;
      }

      if (data.signal?.aborted || (await recorder.isCancelRequested())) {
        throw new BackupRunCancelledError();
      }
    };

    try {
      await recorder.start({ runnerState: state as unknown as JSONObject });

      const backupRun: BackupRun | null = run.restoredBackupRunId
        ? await BackupRunService.findOneById({
            id: run.restoredBackupRunId,
            select: {
              _id: true,
              status: true,
              name: true,
              startedAt: true,
              destinationFingerprint: true,
              includesPostgres: true,
              includesClickhouse: true,
            },
            props: { isRoot: true },
          })
        : null;

      if (!backupRun?.name) {
        throw new Error("The backup to restore no longer exists.");
      }

      const setting: BackupSetting | null =
        await BackupSettingService.getSetting();

      if (!setting?.id) {
        throw new Error(
          "Backups are not set up: set the destination the backup is at in Settings > Backups.",
        );
      }

      settings = await BackupSettingService.getDestinationSettings(setting.id);
      storage = this.backupRunner.createStorageFor(settings);

      const activeSettings: BackupDestinationSettings = settings;
      const activeStorage: BackupStorage = storage;
      const folder: string = BackupSettingsUtil.getFolder(activeSettings);
      const name: string = backupRun.name;

      // Check the backup.
      const manifest: BackupManifest = await recorder.runStep(
        BackupStepKey.CheckBackup,
        async () => {
          const preview: RestorePreview = await buildRestorePreview({
            backupRun,
            settings: activeSettings,
            storage: activeStorage,
            postgres: this.postgres,
            clickhouse: this.clickhouse,
            includesPostgres: identity.includesPostgres,
            includesClickhouse: identity.includesClickhouse,
          });

          if (preview.problems.length > 0 || !preview.manifest) {
            throw new Error(RestoreRunner.issuesText(preview.problems));
          }

          await recorder.update({
            manifest: preview.manifest as unknown as JSONObject,
            name,
            location: activeStorage.describeKey(`${folder}${name}/`),
            destinationType: activeSettings.type,
            destinationFingerprint:
              BackupSettingsUtil.getDestinationFingerprint(activeSettings),
          });

          return {
            value: preview.manifest,
            message: preview.warnings.length
              ? RestoreRunner.issuesText(preview.warnings)
              : undefined,
          };
        },
      );

      await throwIfCancelled();

      // Back up the current data.
      let safetyBackup: BackupOutcome | null = null;

      if (state.takeBackupFirst) {
        safetyBackup = await recorder.runStep(
          BackupStepKey.BackUpCurrentData,
          async () => {
            const backup: BackupRun = new BackupRun();
            backup.kind = BackupRunKind.Backup;
            backup.trigger = BackupRunTrigger.BeforeRestore;
            backup.status = BackupRunStatus.Queued;
            backup.includesPostgres = identity.includesPostgres;
            backup.includesClickhouse = identity.includesClickhouse;

            if (identity.createdByUserId) {
              backup.createdByUserId = identity.createdByUserId;
            }

            const created: BackupRun = await BackupRunService.create({
              data: backup,
              props: { isRoot: true },
            });

            await recorder.update({ safetyBackupRunId: created.id! });

            const outcome: BackupOutcome | null = await this.backupRunner.run({
              run: created,
              signal: data.signal,
              isBeforeRestore: true,
            });

            if (!outcome) {
              const failed: BackupRun | null =
                await BackupRunService.findOneById({
                  id: created.id!,
                  select: { error: true },
                  props: { isRoot: true },
                });

              throw new Error(
                `The backup of the current data failed, so nothing was restored: ${failed?.error || "see that backup's steps"}`,
              );
            }

            return { value: outcome };
          },
        );
      } else {
        await recorder.skipStep(
          BackupStepKey.BackUpCurrentData,
          "Skipped by the master admin who started the restore.",
        );
      }

      await throwIfCancelled();

      const short: string = identity.id
        .toString()
        .split("-")
        .join("")
        .slice(0, 8);

      // Restore PostgreSQL, beside the live database.
      let postgresInfo: PostgresServerInfo | null = null;

      if (identity.includesPostgres && manifest.postgres) {
        const postgresManifest: NonNullable<BackupManifest["postgres"]> =
          manifest.postgres;

        postgresInfo = await recorder.runStep(
          BackupStepKey.RestorePostgres,
          async () => {
            const info: PostgresServerInfo =
              await this.postgres.getServerInfo();
            const restoreDatabase: string = getSuffixedDatabaseName(
              info.database,
              `_restore_${short}`,
            );

            state.postgresRestoreDatabase = restoreDatabase;
            await saveState();

            if (await this.postgres.databaseExists(restoreDatabase)) {
              await this.postgres.dropDatabase(restoreDatabase);
            }

            await this.postgres.createDatabase({
              name: restoreDatabase,
              encoding: info.encoding,
            });

            recorder.progress(BackupStepKey.RestorePostgres, {
              doneBytes: 0,
              totalBytes: postgresManifest.sizeInBytes,
            });

            const download: BackupDownload = await activeStorage.download(
              getBackupPostgresKey(folder, name),
            );
            const restored: { sha256: string; bytes: number } =
              await this.postgres.restoreInto({
                database: restoreDatabase,
                source: download.stream as Readable,
                archiveMajor:
                  parseInt(postgresManifest.toolVersion, 10) || undefined,
                onProgress: (bytes: number): void => {
                  recorder.progress(BackupStepKey.RestorePostgres, {
                    doneBytes: bytes,
                  });
                },
              });

            if (restored.sha256 !== postgresManifest.sha256) {
              throw new Error(
                "The PostgreSQL dump at the destination does not match the checksum it was written with: it changed, or was damaged, after the backup. Nothing was restored.",
              );
            }

            const contents: Awaited<
              ReturnType<PostgresBackupEngine["getContents"]>
            > = await this.postgres.getContents(restoreDatabase);

            return {
              value: info,
              message: describeCounts(contents.counts) || undefined,
            };
          },
        );
      } else {
        await recorder.skipStep(
          BackupStepKey.RestorePostgres,
          "PostgreSQL is not restored.",
        );
      }

      await throwIfCancelled();

      // Restore ClickHouse: from here on the live data changes.
      pastTheLiveData = true;

      if (identity.includesClickhouse && manifest.clickhouse) {
        const clickhouseManifest: NonNullable<BackupManifest["clickhouse"]> =
          manifest.clickhouse;

        await recorder.runStep(BackupStepKey.RestoreClickhouse, async () => {
          const live: string = this.clickhouse.database;
          const setAside: string = `${live}_before_restore_${short}`;
          const checkDatabase: string = `${live}_restore_check_${short}`;
          const folderKey: string = getBackupClickhouseFolderKey(folder, name);

          // ClickHouse can read the backup: its tables, without their data, beside the live ones.
          const checkId: string = ObjectID.generate().toString();
          await this.clickhouse.dropDatabase(checkDatabase);
          await this.clickhouse.startRestore({
            settings: activeSettings,
            folderKey,
            id: checkId,
            sourceDatabase: clickhouseManifest.database,
            asDatabase: checkDatabase,
            structureOnly: true,
          });
          await this.clickhouse.waitFor({ id: checkId });
          await this.clickhouse.dropDatabase(checkDatabase);

          state.clickhouseSetAsideDatabase = setAside;
          await saveState();

          await this.clickhouse.renameDatabase(live, setAside);
          await this.clickhouse.dropMaterializedViews(setAside);

          if (await this.clickhouse.databaseExists(live)) {
            // Something made the database again in the meantime (a booting worker).
            if ((await this.clickhouse.countTables(live)) > 0) {
              throw new Error(
                `ClickHouse's ${live} database was created again while the restore ran.`,
              );
            }

            await this.clickhouse.dropDatabase(live);
          }

          const restoreId: string = ObjectID.generate().toString();

          recorder.progress(BackupStepKey.RestoreClickhouse, {
            doneBytes: 0,
            totalBytes: clickhouseManifest.sizeInBytes,
            totalFiles: clickhouseManifest.fileCount,
          });

          await this.clickhouse.startRestore({
            settings: activeSettings,
            folderKey,
            id: restoreId,
            sourceDatabase: clickhouseManifest.database,
            asDatabase: live,
          });

          await this.clickhouse.waitFor({
            id: restoreId,
            onProgress: (status: ClickhouseBackupStatus): void => {
              recorder.progress(BackupStepKey.RestoreClickhouse, {
                ...(status.bytesRead > 0
                  ? { doneBytes: status.bytesRead }
                  : {}),
                ...(status.filesRead > 0
                  ? { doneFiles: status.filesRead }
                  : {}),
              });
            },
          });

          state.clickhouseRestored = true;
          await saveState();

          return { value: undefined };
        });
      } else {
        await recorder.skipStep(
          BackupStepKey.RestoreClickhouse,
          "ClickHouse is not restored.",
        );
      }

      // Switch over to the restored PostgreSQL.
      if (
        identity.includesPostgres &&
        postgresInfo &&
        state.postgresRestoreDatabase
      ) {
        const info: PostgresServerInfo = postgresInfo;
        const restoreDatabase: string = state.postgresRestoreDatabase;

        await recorder.runStep(BackupStepKey.SwitchOver, async () => {
          const setAside: string = getSuffixedDatabaseName(
            info.database,
            `_before_restore_${short}`,
          );

          state.postgresSetAsideDatabase = setAside;
          await saveState();

          await this.postgres.switchOver({
            live: info.database,
            restored: restoreDatabase,
            setAside,
          });

          state.postgresSwitched = true;

          // The live database is the backup's now: this run's row is written there again.
          await recorder.reattach();
          await saveState();

          return { value: undefined };
        });
      } else {
        await recorder.skipStep(
          BackupStepKey.SwitchOver,
          "Only ClickHouse was restored: nothing to switch.",
        );
      }

      // Upgrade the restored data.
      await recorder.runStep(BackupStepKey.UpgradeRestoredData, async () => {
        const notes: Array<string> = [];

        if (state.postgresSwitched) {
          const applied: Array<string> = await this.migratePostgres();
          notes.push(
            applied.length === 0
              ? "PostgreSQL was up to date."
              : `Applied ${applied.length} schema migration${applied.length === 1 ? "" : "s"} to PostgreSQL.`,
          );

          const cleared: number = await this.clearCaches();
          notes.push(
            `Cleared ${cleared} cached permission${cleared === 1 ? "" : "s"}.`,
          );
        }

        if (state.clickhouseRestored) {
          await this.reconcileClickhouse();
          notes.push("ClickHouse's tables and views are up to date.");
        }

        // The backups at the destination, as the restored data should know them.
        try {
          await BackupCatalogSync.sync({
            settings: activeSettings,
            storage: activeStorage,
          });
        } catch (error) {
          notes.push(
            `The list of backups could not be refreshed: ${errorText(error)}. Use Find backups.`,
          );
        }

        return { value: undefined, message: notes.join(" ") };
      });

      // Clean up.
      await recorder.runStep(BackupStepKey.CleanUp, async () => {
        const kept: Array<string> = [];
        const canDrop: boolean = Boolean(safetyBackup);

        if (state.postgresSetAsideDatabase) {
          if (canDrop) {
            await this.postgres.dropDatabase(state.postgresSetAsideDatabase);
          } else {
            kept.push(state.postgresSetAsideDatabase);
          }
        }

        if (state.clickhouseSetAsideDatabase && state.clickhouseRestored) {
          if (canDrop) {
            await this.clickhouse.dropDatabase(
              state.clickhouseSetAsideDatabase,
            );
          } else {
            kept.push(state.clickhouseSetAsideDatabase);
          }
        }

        state.keptDatabases = kept;
        await saveState();

        return {
          value: undefined,
          message:
            kept.length > 0
              ? `Kept the data from before the restore, as no backup of it was taken: ${kept.join(", ")}. Drop it once you no longer need it.`
              : undefined,
        };
      });

      await recorder.finish(BackupRunStatus.Succeeded);
      return true;
    } catch (error) {
      const isCancelled: boolean = error instanceof BackupRunCancelledError;
      const undone: Array<string> = await this.undo({ state }).catch(
        (undoError: unknown): Array<string> => {
          return [
            `Putting the data back failed too: ${errorText(undoError)}. Check the databases by hand.`,
          ];
        },
      );
      const message: string = [
        isCancelled
          ? "The restore was cancelled. Nothing was changed."
          : `${errorText(error)}.`,
        ...undone,
      ].join(" ");

      await recorder.finish(
        isCancelled ? BackupRunStatus.Cancelled : BackupRunStatus.Failed,
        {
          error: message,
          runnerState: JSON.parse(JSON.stringify(state)) as JSONObject,
        },
      );

      if (!isCancelled && data.onFailure) {
        await data.onFailure(message).catch((notifyError: unknown) => {
          logger.warn(
            `Backups: could not tell the master admins a restore failed: ${errorText(notifyError)}`,
          );
        });
      }

      return false;
    }
  }

  /*
   * Puts back what a restore that did not finish set up: the database it
   * restored PostgreSQL into goes (unless it was switched in), and the
   * ClickHouse data set aside comes back (the restored one goes, and the
   * views come back). Answers what it did, in sentences for the run's
   * error. Once PostgreSQL is switched over, the restore is what is live:
   * nothing is undone.
   */
  public async undo(data: {
    state: RestoreRunnerState;
  }): Promise<Array<string>> {
    const state: RestoreRunnerState = data.state;
    const done: Array<string> = [];

    if (state.postgresSwitched) {
      return done;
    }

    if (state.clickhouseSetAsideDatabase) {
      const live: string = this.clickhouse.database;

      if (
        await this.clickhouse.databaseExists(state.clickhouseSetAsideDatabase)
      ) {
        await this.clickhouse.dropDatabase(live);
        await this.clickhouse.renameDatabase(
          state.clickhouseSetAsideDatabase,
          live,
        );
        await this.reconcileClickhouse();
        done.push("ClickHouse's data from before the restore was put back.");
      }

      delete state.clickhouseSetAsideDatabase;
      state.clickhouseRestored = false;
    }

    if (state.postgresRestoreDatabase) {
      await this.postgres.dropDatabase(state.postgresRestoreDatabase);
      delete state.postgresRestoreDatabase;
    }

    return done;
  }

  /*
   * A restore whose worker stopped (its heartbeat did): undone as far as
   * it can be, then failed with what happened.
   */
  public async recoverInterrupted(run: BackupRun): Promise<string> {
    const state: RestoreRunnerState = readRestoreRunnerState(run.runnerState);
    const undone: Array<string> = await this.undo({ state });

    if (state.postgresSwitched) {
      return "OneUptime stopped after the restored PostgreSQL was switched in; the rest of the restore did not run. Restart OneUptime so it brings the restored data up to this version.";
    }

    return [
      "OneUptime stopped while the restore ran (it may have been restarted). Nothing was changed.",
      ...undone,
    ].join(" ");
  }
}
