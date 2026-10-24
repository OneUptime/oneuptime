import { Readable } from "stream";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BACKUP_CLICKHOUSE_FOLDER_NAME,
  BACKUP_ENCRYPTION_CHECK_TEXT,
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BACKUP_POSTGRES_FILE_NAME,
  BACKUP_POSTGRES_FORMAT,
  BackupManifest,
  BackupPostgresCounts,
  getBackupName,
} from "Common/Types/Backup/BackupManifest";
import {
  BackupRetentionDecision,
  selectBackupsToDelete,
} from "Common/Types/Backup/BackupRetention";
import {
  BACKUP_STEP_KEYS,
  BackupRunKind,
  BackupRunStatus,
  BackupStepKey,
} from "Common/Types/Backup/BackupRunTypes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  BACKUP_MANIFEST_CONTENT_TYPE,
  BACKUP_POSTGRES_CONTENT_TYPE,
  getBackupClickhouseFolderKey,
  getBackupClickhouseMetadataKey,
  getBackupFolderKey,
  getBackupManifestKey,
  getBackupPostgresKey,
} from "./BackupLayout";
import BackupRunRecorder, {
  BackupRunCancelledError,
  BackupRunIdentity,
} from "./BackupRunRecorder";
import ClickhouseBackupEngine, {
  ClickhouseBackupStatus,
} from "./ClickHouse/ClickhouseBackupEngine";
import PostgresBackupEngine, {
  PostgresServerInfo,
} from "./Postgres/PostgresBackupEngine";
import { pickPostgresToolSet } from "./Postgres/PostgresTools";
import { errorText } from "./Storage/BackupHttp";
import {
  BackupDownload,
  BackupListing,
  BackupObject,
  BackupStorage,
  BackupUploadResult,
  deleteBackupPrefix,
} from "./Storage/BackupStorage";
import BackupStorageFactory from "./Storage/BackupStorageFactory";

/*
 * One backup, step by step, as its BackupRun row shows it:
 *
 *   Check the destination   the storage answers, and the backup's folder is free
 *   Back up PostgreSQL      pg_dump, streamed into the storage (PostgresBackupEngine)
 *   Back up ClickHouse      ClickHouse's own BACKUP to the storage (ClickhouseBackupEngine)
 *   Check the backup        the files are there, at their size; pg_restore reads the dump
 *   Delete old backups      the ones older than the retention, never the newest good one
 *
 * then manifest.json, last, which makes it a backup a restore - or another
 * installation - can find. A run that fails or is cancelled deletes what it
 * wrote, so the destination only ever holds whole backups.
 */

export interface BackupRunnerDependencies {
  postgres?: PostgresBackupEngine | undefined;
  clickhouse?: ClickhouseBackupEngine | undefined;
  // The storage for the destination's settings (BackupStorageFactory by default).
  createStorage?: ((settings: BackupDestinationSettings) => BackupStorage) | undefined;
  now?: (() => Date) | undefined;
}

export interface BackupOutcome {
  manifest: BackupManifest;
  folderKey: string;
}

function sumSizes(listing: BackupListing): number {
  return listing.objects.reduce((total: number, object: BackupObject): number => {
    return total + object.sizeInBytes;
  }, 0);
}

export default class BackupRunner {
  private readonly postgres: PostgresBackupEngine;
  private readonly clickhouse: ClickhouseBackupEngine;
  private readonly createStorage: (settings: BackupDestinationSettings) => BackupStorage;
  private readonly now: () => Date;

  public constructor(dependencies: BackupRunnerDependencies = {}) {
    this.postgres = dependencies.postgres || new PostgresBackupEngine();
    this.clickhouse = dependencies.clickhouse || new ClickhouseBackupEngine();
    this.createStorage =
      dependencies.createStorage ||
      ((settings: BackupDestinationSettings): BackupStorage => {
        return BackupStorageFactory.create(settings);
      });
    this.now =
      dependencies.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });
  }

  public getPostgresEngine(): PostgresBackupEngine {
    return this.postgres;
  }

  public getClickhouseEngine(): ClickhouseBackupEngine {
    return this.clickhouse;
  }

  public createStorageFor(settings: BackupDestinationSettings): BackupStorage {
    return this.createStorage(settings);
  }

  /*
   * Makes the backup a run row stands for. Never throws: the outcome is the
   * row's (succeeded, failed or cancelled), and a failure is handed to
   * onFailure (the notification). Answers the outcome for a restore that
   * took it first.
   */
  public async run(data: {
    run: BackupRun;
    signal?: AbortSignal | undefined;
    // A backup taken by a restore: its steps say so, and it deletes nothing old.
    isBeforeRestore?: boolean | undefined;
    onFailure?: ((error: string) => Promise<void>) | undefined;
  }): Promise<BackupOutcome | null> {
    const run: BackupRun = data.run;
    const identity: BackupRunIdentity = {
      id: run.id!,
      kind: BackupRunKind.Backup,
      trigger: run.trigger!,
      includesPostgres: run.includesPostgres !== false,
      includesClickhouse: run.includesClickhouse === true,
      createdByUserId: run.createdByUserId,
    };
    const recorder: BackupRunRecorder = new BackupRunRecorder({
      identity,
      stepKeys: BACKUP_STEP_KEYS,
      now: this.now,
    });

    let storage: BackupStorage | null = null;
    let folderKey: string | null = null;

    try {
      const setting: BackupSetting | null =
        await BackupSettingService.getSetting();

      if (!setting?.id) {
        throw new Error(
          "Backups are not set up. Set a destination in Settings > Backups.",
        );
      }

      const settings: BackupDestinationSettings =
        await BackupSettingService.getDestinationSettings(setting.id);
      const startedAt: Date = this.now();
      const name: string = getBackupName({
        startedAt,
        id: identity.id.toString(),
      });
      const folder: string = BackupSettingsUtil.getFolder(settings);

      storage = this.createStorage(settings);
      folderKey = getBackupFolderKey(folder, name);

      await recorder.start({
        startedAt,
        name,
        location: storage.describeKey(folderKey),
        destinationType: settings.type,
        destinationFingerprint:
          BackupSettingsUtil.getDestinationFingerprint(settings),
      });

      const outcome: BackupOutcome = await this.makeBackup({
        recorder,
        identity,
        settings,
        storage,
        folder,
        name,
        startedAt,
        retentionInDays: data.isBeforeRestore
          ? null
          : setting.retentionInDays || null,
        signal: data.signal,
      });

      await recorder.finish(BackupRunStatus.Succeeded, {
        manifest: outcome.manifest as unknown as JSONObject,
      });

      return outcome;
    } catch (error) {
      const isCancelled: boolean =
        error instanceof BackupRunCancelledError || Boolean(data.signal?.aborted);
      const message: string = isCancelled
        ? "The backup was cancelled. Nothing it wrote was kept."
        : errorText(error) + ".";

      // Whatever was written goes: the destination keeps whole backups only.
      if (storage && folderKey) {
        await deleteBackupPrefix({ storage, prefix: folderKey }).catch(
          (cleanupError: unknown) => {
            logger.warn(
              `Backups: could not delete the files a failed backup wrote under ${folderKey}: ${errorText(cleanupError)}`,
            );
          },
        );
      }

      await recorder.finish(
        isCancelled ? BackupRunStatus.Cancelled : BackupRunStatus.Failed,
        { error: message },
      );

      if (!isCancelled && data.onFailure) {
        await data.onFailure(message).catch((notifyError: unknown) => {
          logger.warn(
            `Backups: could not tell the master admins a backup failed: ${errorText(notifyError)}`,
          );
        });
      }

      return null;
    }
  }

  private async makeBackup(data: {
    recorder: BackupRunRecorder;
    identity: BackupRunIdentity;
    settings: BackupDestinationSettings;
    storage: BackupStorage;
    folder: string;
    name: string;
    startedAt: Date;
    retentionInDays: number | null;
    signal?: AbortSignal | undefined;
  }): Promise<BackupOutcome> {
    const { recorder, identity, settings, storage, folder, name } = data;
    const folderKey: string = getBackupFolderKey(folder, name);
    const cancelSignal: AbortController = new AbortController();

    const abortIfCancelled: () => Promise<void> = async (): Promise<void> => {
      if (data.signal?.aborted) {
        cancelSignal.abort();
        throw new BackupRunCancelledError();
      }

      if (await recorder.isCancelRequested()) {
        cancelSignal.abort();
        throw new BackupRunCancelledError();
      }
    };

    data.signal?.addEventListener(
      "abort",
      () => {
        cancelSignal.abort();
      },
      { once: true },
    );

    // What the steps learn, for the steps after them and the manifest.
    const state: {
      serverInfo: PostgresServerInfo | null;
      postgresResult: BackupUploadResult | null;
      postgresToolVersion: string;
      postgresServerVersion: string;
      counts: BackupPostgresCounts;
      lastMigration: string | null;
      clickhouseSize: number;
      clickhouseFileCount: number;
      clickhouseVersion: string;
    } = {
      serverInfo: null,
      postgresResult: null,
      postgresToolVersion: "",
      postgresServerVersion: "",
      counts: {},
      lastMigration: null,
      clickhouseSize: 0,
      clickhouseFileCount: 0,
      clickhouseVersion: "",
    };

    // Check the destination: it answers, and nothing is where this backup goes.
    await recorder.runStep(BackupStepKey.CheckDestination, async () => {
      const existing: BackupListing = await storage.list({ prefix: folderKey });

      if (existing.objects.length > 0) {
        throw new Error(
          `Something is already at ${storage.describeKey(folderKey)}. Nothing was overwritten.`,
        );
      }

      if (identity.includesPostgres) {
        const info: PostgresServerInfo = await this.postgres.getServerInfo();
        state.serverInfo = info;
        // Fails now, with what to do, when no pg_dump fits the server.
        pickPostgresToolSet({
          toolSets: await this.postgres.getToolSets(),
          serverMajor: info.major,
        });
      }

      return { value: undefined };
    });

    await abortIfCancelled();

    // Back up PostgreSQL.
    if (identity.includesPostgres) {
      await recorder.runStep(BackupStepKey.BackUpPostgres, async () => {
        const info: PostgresServerInfo =
          state.serverInfo || (await this.postgres.getServerInfo());
        const contents: {
          counts: BackupPostgresCounts;
          lastMigration: string | null;
        } = await this.postgres.getContents();
        state.counts = contents.counts;
        state.lastMigration = contents.lastMigration;

        recorder.progress(BackupStepKey.BackUpPostgres, {
          doneBytes: 0,
          totalBytes: info.sizeInBytes,
        });

        const dump: Awaited<ReturnType<PostgresBackupEngine["dump"]>> =
          await this.postgres.dump({
            signal: cancelSignal.signal,
            upload: async (source: Readable): Promise<BackupUploadResult> => {
              return await storage.upload({
                key: getBackupPostgresKey(folder, name),
                source,
                contentType: BACKUP_POSTGRES_CONTENT_TYPE,
                expectedSizeInBytes: info.sizeInBytes,
                signal: cancelSignal.signal,
                onProgress: (bytes: number): void => {
                  recorder.progress(BackupStepKey.BackUpPostgres, {
                    doneBytes: bytes,
                  });
                },
              });
            },
          });

        state.postgresResult = dump.result;
        state.postgresToolVersion = dump.toolVersion;
        state.postgresServerVersion = dump.serverVersion;

        recorder.progress(BackupStepKey.BackUpPostgres, {
          doneBytes: dump.result.sizeInBytes,
        });
        await recorder.update({ postgresSizeInBytes: dump.result.sizeInBytes });

        return { value: undefined };
      });
    } else {
      await recorder.skipStep(
        BackupStepKey.BackUpPostgres,
        "This backup does not hold PostgreSQL.",
      );
    }

    await abortIfCancelled();

    // Back up ClickHouse.
    if (identity.includesClickhouse) {
      await recorder.runStep(BackupStepKey.BackUpClickhouse, async () => {
        state.clickhouseVersion = await this.clickhouse.getServerVersion();

        const totalBytes: number =
          await this.clickhouse.getDatabaseSizeInBytes();
        const operationId: string = ObjectID.generate().toString();

        recorder.progress(BackupStepKey.BackUpClickhouse, {
          doneBytes: 0,
          totalBytes,
        });

        await this.clickhouse.startBackup({
          settings,
          folderKey: getBackupClickhouseFolderKey(folder, name),
          id: operationId,
        });

        await this.clickhouse.waitFor({
          id: operationId,
          onProgress: (status: ClickhouseBackupStatus): void => {
            recorder.progress(BackupStepKey.BackUpClickhouse, {
              ...(status.fileCount > 0 ? { doneFiles: status.fileCount } : {}),
              ...(status.totalSizeInBytes > 0
                ? { doneBytes: status.totalSizeInBytes }
                : {}),
            });
          },
        });

        // What is at the destination: the size the page shows and the manifest keeps.
        const written: BackupListing = await storage.list({
          prefix: getBackupClickhouseFolderKey(folder, name),
        });
        state.clickhouseSize = sumSizes(written);
        state.clickhouseFileCount = written.objects.length;

        recorder.progress(BackupStepKey.BackUpClickhouse, {
          doneBytes: state.clickhouseSize,
          doneFiles: state.clickhouseFileCount,
        });
        await recorder.update({ clickhouseSizeInBytes: state.clickhouseSize });

        return { value: undefined };
      });
    } else {
      await recorder.skipStep(
        BackupStepKey.BackUpClickhouse,
        "ClickHouse is not in the backups (Settings > Backups).",
      );
    }

    await abortIfCancelled();

    // Check the backup.
    await recorder.runStep(BackupStepKey.VerifyBackup, async () => {
      if (identity.includesPostgres && state.postgresResult) {
        const uploaded: BackupUploadResult = state.postgresResult;
        const stored: BackupObject | null = await storage.headObject(
          getBackupPostgresKey(folder, name),
        );

        if (!stored) {
          throw new Error(
            "The PostgreSQL dump is not at the destination after it was written.",
          );
        }

        if (stored.sizeInBytes !== uploaded.sizeInBytes) {
          throw new Error(
            `The PostgreSQL dump at the destination is ${stored.sizeInBytes} bytes; ${uploaded.sizeInBytes} were written.`,
          );
        }

        const download: BackupDownload = await storage.download(
          getBackupPostgresKey(folder, name),
        );
        const entries: number = await this.postgres.readArchiveContents({
          source: download.stream,
          archiveMajor: parseInt(state.postgresToolVersion, 10) || undefined,
        });

        if (entries === 0) {
          throw new Error("pg_restore read no tables in the PostgreSQL dump.");
        }
      }

      if (identity.includesClickhouse) {
        const metadata: BackupObject | null = await storage.headObject(
          getBackupClickhouseMetadataKey(folder, name),
        );

        if (!metadata) {
          throw new Error(
            "ClickHouse's own record of the backup (.backup) is not at the destination.",
          );
        }
      }

      return { value: undefined };
    });

    const manifest: BackupManifest = {
      schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      backupId: identity.id.toString(),
      name,
      trigger: identity.trigger,
      startedAt: data.startedAt.toISOString(),
      finishedAt: this.now().toISOString(),
      oneuptimeVersion: AppVersion,
    };

    try {
      manifest.encryptionCheck = await Encryption.encrypt(
        BACKUP_ENCRYPTION_CHECK_TEXT,
      );
    } catch {
      // A restore then cannot tell whether the stored credentials can be read.
    }

    if (identity.includesPostgres && state.postgresResult) {
      const uploaded: BackupUploadResult = state.postgresResult;
      manifest.postgres = {
        file: BACKUP_POSTGRES_FILE_NAME,
        format: BACKUP_POSTGRES_FORMAT,
        sizeInBytes: uploaded.sizeInBytes,
        sha256: uploaded.sha256,
        database: this.postgres.target.database,
        serverVersion: state.postgresServerVersion,
        toolVersion: state.postgresToolVersion,
        counts: state.counts,
        ...(state.lastMigration ? { lastMigration: state.lastMigration } : {}),
      };
    }

    if (identity.includesClickhouse) {
      manifest.clickhouse = {
        folder: BACKUP_CLICKHOUSE_FOLDER_NAME,
        database: this.clickhouse.database,
        serverVersion: state.clickhouseVersion,
        sizeInBytes: state.clickhouseSize,
        fileCount: state.clickhouseFileCount,
      };
    }

    // Last: a backup without its manifest is not one a restore lists.
    await storage.putObject({
      key: getBackupManifestKey(folder, name),
      body: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      contentType: BACKUP_MANIFEST_CONTENT_TYPE,
    });

    if (data.retentionInDays === null) {
      await recorder.skipStep(
        BackupStepKey.DeleteOldBackups,
        "A backup taken before a restore deletes nothing.",
      );
    } else {
      const retentionInDays: number = data.retentionInDays;

      await recorder.runStep(BackupStepKey.DeleteOldBackups, async () => {
        const deleted: number = await this.applyRetention({
          settings,
          storage,
          retentionInDays,
          justFinishedId: identity.id,
        });

        return {
          value: undefined,
          message:
            deleted === 0
              ? "No backup was older than the retention."
              : `Deleted ${deleted} backup${deleted === 1 ? "" : "s"} older than ${retentionInDays} day${retentionInDays === 1 ? "" : "s"}.`,
        };
      });
    }

    return { manifest, folderKey };
  }

  /*
   * Deletes the backups older than the retention (selectBackupsToDelete:
   * never the newest that succeeded, never one being made or restored),
   * files first, then the row. A backup at a previous destination has no
   * files OneUptime can reach any more: only its row goes. Answers how many
   * backups were deleted.
   */
  public async applyRetention(data: {
    settings: BackupDestinationSettings;
    storage: BackupStorage;
    retentionInDays: number;
    justFinishedId?: ObjectID | undefined;
  }): Promise<number> {
    const runs: Array<BackupRun> = await BackupRunService.findAllBy({
      query: {},
      select: {
        _id: true,
        kind: true,
        status: true,
        startedAt: true,
        createdAt: true,
        name: true,
        destinationFingerprint: true,
        restoredBackupRunId: true,
      },
      props: { isRoot: true },
    });

    const fingerprint: string = BackupSettingsUtil.getDestinationFingerprint(
      data.settings,
    );
    const protectedIds: Array<string> = runs
      .filter((run: BackupRun): boolean => {
        return (
          run.kind === BackupRunKind.Restore &&
          (run.status === BackupRunStatus.Queued ||
            run.status === BackupRunStatus.Running) &&
          Boolean(run.restoredBackupRunId)
        );
      })
      .map((run: BackupRun): string => {
        return run.restoredBackupRunId!.toString();
      });

    if (data.justFinishedId) {
      protectedIds.push(data.justFinishedId.toString());
    }

    const decision: BackupRetentionDecision = selectBackupsToDelete({
      backups: runs.map((run: BackupRun) => {
        return {
          id: run.id!.toString(),
          kind: run.kind!,
          status:
            data.justFinishedId &&
            run.id!.toString() === data.justFinishedId.toString()
              ? BackupRunStatus.Succeeded
              : run.status!,
          startedAt: new Date(run.startedAt || run.createdAt || this.now()),
        };
      }),
      retentionInDays: data.retentionInDays,
      now: this.now(),
      protectedIds,
    });

    const folder: string = BackupSettingsUtil.getFolder(data.settings);
    let deleted: number = 0;

    for (const id of decision.deleteIds) {
      const run: BackupRun | undefined = runs.find(
        (candidate: BackupRun): boolean => {
          return candidate.id!.toString() === id;
        },
      );

      if (!run) {
        continue;
      }

      if (run.name && run.destinationFingerprint === fingerprint) {
        await deleteBackupPrefix({
          storage: data.storage,
          prefix: getBackupFolderKey(folder, run.name),
        });
      }

      await BackupRunService.deleteOneById({
        id: run.id!,
        props: { isRoot: true },
      });

      if (run.status === BackupRunStatus.Succeeded) {
        deleted++;
      }
    }

    return deleted;
  }
}
