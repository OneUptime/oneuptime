import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import logger from "Common/Server/Utils/Logger";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupFrequency,
  getNextBackupAt,
} from "Common/Types/Backup/BackupSchedule";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStep,
  BackupStepStatus,
  readBackupSteps,
} from "Common/Types/Backup/BackupRunTypes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { getBackupFolderKey } from "./BackupLayout";
import BackupNotifications from "./BackupNotifications";
import BackupRunner from "./BackupRunner";
import RestoreRunner from "./RestoreRunner";
import { errorText } from "./Storage/BackupHttp";
import { deleteBackupPrefix } from "./Storage/BackupStorage";

/*
 * What runs backups: a tick every minute (Jobs/RunBackups) that, while it
 * holds the instance's one backup lock,
 *
 *   1. fails the runs whose worker stopped (no heartbeat for 3 minutes):
 *      a backup's files are deleted, a restore is undone as far as it can be;
 *   2. queues the scheduled backup once it is due (and moves the next one);
 *   3. starts the oldest queued run - a backup, or a restore - and keeps
 *      the lock until it is done.
 *
 * One run at a time, on the whole instance: the lock is in Valkey, held
 * (and refreshed) by the worker running it, and the heartbeat in
 * PostgreSQL says whether that worker is still alive. A run goes on in the
 * worker after the tick's job has returned, so a backup of any length
 * never meets the job's timeout; when the worker shuts down, the run is
 * stopped and failed, and its leftovers are cleaned up by the next tick.
 *
 * New backups need a license that includes backups; a restore never does.
 */

export const BACKUP_LOCK_NAMESPACE: string = "backups";
export const BACKUP_LOCK_KEY: string = "runner";
const LOCK_TIMEOUT_IN_MS: number = 60 * 1000;
const LOCK_REFRESH_INTERVAL_IN_MS: number = 20 * 1000;

// A running run whose heartbeat is older than this has lost its worker.
export const STALE_RUN_AFTER_IN_MS: number = 3 * 60 * 1000;

export const BACKUP_SHUTDOWN_HANDLER_NAME: string = "Backups";

// How long shutdown waits for a run to stop.
export const BACKUP_SHUTDOWN_WAIT_IN_MS: number = 8000;

export const BACKUP_LICENSE_REQUIRED_MESSAGE: string =
  "Backups need an Enterprise license that includes backups. Restoring and deleting backups still work.";

interface CurrentRun {
  runId: string;
  controller: AbortController;
  done: Promise<void>;
}

export interface BackupSchedulerDependencies {
  backupRunner?: BackupRunner | undefined;
  restoreRunner?: RestoreRunner | undefined;
  now?: (() => Date) | undefined;
  isBackupsActive?: (() => boolean) | undefined;
  // Takes the instance's backup lock, or answers null when another worker holds it.
  lock?: (() => Promise<{ release: () => Promise<void> } | null>) | undefined;
  notifyFailure?: typeof BackupNotifications.notifyFailure | undefined;
}

export default class BackupScheduler {
  private current: CurrentRun | null = null;
  private readonly backupRunner: BackupRunner;
  private readonly restoreRunner: RestoreRunner;
  private readonly now: () => Date;
  private readonly isBackupsActive: () => boolean;
  private readonly lock: () => Promise<{ release: () => Promise<void> } | null>;
  private readonly notifyFailure: typeof BackupNotifications.notifyFailure;

  public constructor(dependencies: BackupSchedulerDependencies = {}) {
    this.backupRunner = dependencies.backupRunner || new BackupRunner();
    this.restoreRunner =
      dependencies.restoreRunner ||
      new RestoreRunner({ backupRunner: this.backupRunner });
    this.now =
      dependencies.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });
    this.isBackupsActive =
      dependencies.isBackupsActive ||
      ((): boolean => {
        return EnterpriseEdition.isFeatureActive(EnterpriseFeature.Backups);
      });
    this.lock = dependencies.lock || BackupScheduler.takeLock;
    this.notifyFailure =
      dependencies.notifyFailure ||
      ((...args: Parameters<typeof BackupNotifications.notifyFailure>) => {
        return BackupNotifications.notifyFailure(...args);
      });
  }

  private static async takeLock(): Promise<{
    release: () => Promise<void>;
  } | null> {
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: BACKUP_LOCK_KEY,
        namespace: BACKUP_LOCK_NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: LOCK_REFRESH_INTERVAL_IN_MS,
        onLockLost: (error: Error): void => {
          logger.warn(
            `Backups: the backup lock was lost (${error.message}); the run goes on, and the heartbeat keeps others from starting one.`,
          );
        },
      });
    } catch {
      return null;
    }

    return {
      release: async (): Promise<void> => {
        await Semaphore.release(mutex).catch(() => {
          // Already expired.
        });
      },
    };
  }

  public getCurrentRunId(): string | null {
    return this.current?.runId || null;
  }

  // Waits for the run this process is running, if any (tests, shutdown).
  public async waitForCurrentRun(): Promise<void> {
    await this.current?.done;
  }

  public async tick(): Promise<void> {
    if (this.current) {
      return;
    }

    const lock: { release: () => Promise<void> } | null = await this.lock();

    if (!lock) {
      return;
    }

    let handedOff: boolean = false;

    try {
      await this.recoverStaleRuns();
      await this.queueScheduledBackup();

      const next: BackupRun | null = await this.claimNextRun();

      if (next) {
        this.start(next, lock);
        handedOff = true;
      }
    } catch (error) {
      logger.error(`Backups: the tick failed: ${errorText(error)}`);
    } finally {
      if (!handedOff) {
        await lock.release();
      }
    }
  }

  /*
   * Runs that say they are running, and whose worker stopped saying it is
   * alive: failed, with their leftovers removed (a backup's files) or
   * undone (a restore's databases).
   */
  public async recoverStaleRuns(): Promise<number> {
    const running: Array<BackupRun> = await BackupRunService.findAllBy({
      query: { status: BackupRunStatus.Running },
      select: {
        _id: true,
        kind: true,
        trigger: true,
        name: true,
        startedAt: true,
        heartbeatAt: true,
        destinationFingerprint: true,
        location: true,
        runnerState: true,
        steps: true,
      },
      props: { isRoot: true },
    });

    const now: Date = this.now();
    let recovered: number = 0;

    for (const run of running) {
      if (this.current && run.id?.toString() === this.current.runId) {
        continue;
      }

      const lastSign: Date | undefined = run.heartbeatAt || run.startedAt;

      if (
        lastSign &&
        now.getTime() - new Date(lastSign).getTime() < STALE_RUN_AFTER_IN_MS
      ) {
        continue;
      }

      let message: string;

      try {
        message =
          run.kind === BackupRunKind.Restore
            ? await this.restoreRunner.recoverInterrupted(run)
            : await this.cleanUpInterruptedBackup(run);
      } catch (error) {
        message = `OneUptime stopped while this ran, and cleaning up after it failed: ${errorText(error)}.`;
      }

      // The step it was on failed; the ones after it never ran.
      const steps: Array<BackupStep> = readBackupSteps(run.steps).map(
        (step: BackupStep): BackupStep => {
          if (step.status === BackupStepStatus.Running) {
            return { ...step, status: BackupStepStatus.Failed };
          }

          if (step.status === BackupStepStatus.Pending) {
            return { ...step, status: BackupStepStatus.Skipped };
          }

          return step;
        },
      );

      await BackupRunService.updateOneById({
        id: run.id!,
        data: {
          status: BackupRunStatus.Failed,
          finishedAt: now,
          error: message,
          steps: JSON.parse(JSON.stringify(steps)),
        } as never,
        props: { isRoot: true },
      });

      await this.notifyFailure({
        kind: run.kind || BackupRunKind.Backup,
        trigger: run.trigger || BackupRunTrigger.Manual,
        error: message,
        location: run.location,
        startedAt: run.startedAt,
      }).catch((error: unknown) => {
        logger.warn(
          `Backups: could not tell the master admins: ${errorText(error)}`,
        );
      });

      recovered++;
    }

    return recovered;
  }

  private async cleanUpInterruptedBackup(run: BackupRun): Promise<string> {
    const setting: BackupSetting | null =
      await BackupSettingService.getSetting();

    if (setting?.id && run.name) {
      const settings: BackupDestinationSettings =
        await BackupSettingService.getDestinationSettings(setting.id);

      if (
        BackupSettingsUtil.getDestinationFingerprint(settings) ===
        run.destinationFingerprint
      ) {
        await deleteBackupPrefix({
          storage: this.backupRunner.createStorageFor(settings),
          prefix: getBackupFolderKey(
            BackupSettingsUtil.getFolder(settings),
            run.name,
          ),
        });
      }
    }

    return "OneUptime stopped while this backup ran (it may have been restarted). What it had written was deleted; the next backup runs on the schedule.";
  }

  /*
   * The scheduled backup, once it is due: queued (unless a run is already
   * waiting or running), and the next one moved on. Nothing happens while
   * backups are off, or while the license does not include them.
   */
  public async queueScheduledBackup(): Promise<BackupRun | null> {
    const setting: BackupSetting | null =
      await BackupSettingService.getSetting();

    if (!setting?.id || setting.isEnabled === false) {
      return null;
    }

    if (!this.isBackupsActive()) {
      return null;
    }

    const now: Date = this.now();
    const schedule: {
      frequency: BackupFrequency;
      timeOfDay: string;
      dayOfWeek: number;
    } = {
      frequency: setting.frequency || BackupFrequency.Daily,
      timeOfDay: setting.timeOfDay || "02:00",
      dayOfWeek: setting.dayOfWeek ?? 0,
    };

    if (!setting.nextBackupAt) {
      await BackupSettingService.updateOneById({
        id: setting.id,
        data: { nextBackupAt: getNextBackupAt(schedule, now) },
        props: { isRoot: true },
      });
      return null;
    }

    if (new Date(setting.nextBackupAt).getTime() > now.getTime()) {
      return null;
    }

    const active: number = (
      await BackupRunService.countBy({
        query: { status: BackupRunStatus.Queued },
        props: { isRoot: true },
      })
    ).toNumber();
    const running: number = (
      await BackupRunService.countBy({
        query: { status: BackupRunStatus.Running },
        props: { isRoot: true },
      })
    ).toNumber();

    await BackupSettingService.updateOneById({
      id: setting.id,
      data: { nextBackupAt: getNextBackupAt(schedule, now) },
      props: { isRoot: true },
    });

    if (active + running > 0) {
      logger.info(
        "Backups: the scheduled backup is due while another run is queued or running; it waits for the next time.",
      );
      return null;
    }

    const run: BackupRun = new BackupRun();
    run.kind = BackupRunKind.Backup;
    run.trigger = BackupRunTrigger.Scheduled;
    run.status = BackupRunStatus.Queued;
    run.includesPostgres = true;
    run.includesClickhouse = setting.includesClickhouse !== false;

    return await BackupRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  /*
   * The oldest queued run, unless one is running. A queued backup that the
   * license no longer allows is cancelled with that reason.
   */
  public async claimNextRun(): Promise<BackupRun | null> {
    const running: number = (
      await BackupRunService.countBy({
        query: { status: BackupRunStatus.Running },
        props: { isRoot: true },
      })
    ).toNumber();

    if (running > 0) {
      return null;
    }

    for (;;) {
      const next: BackupRun | null = await BackupRunService.findOneBy({
        query: { status: BackupRunStatus.Queued },
        select: {
          _id: true,
          kind: true,
          trigger: true,
          status: true,
          includesPostgres: true,
          includesClickhouse: true,
          createdByUserId: true,
          restoredBackupRunId: true,
          runnerState: true,
          cancelRequestedAt: true,
          createdAt: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });

      if (!next) {
        return null;
      }

      const refusal: string | null = next.cancelRequestedAt
        ? "Cancelled by a master admin before it started."
        : next.kind === BackupRunKind.Backup && !this.isBackupsActive()
          ? BACKUP_LICENSE_REQUIRED_MESSAGE
          : null;

      if (!refusal) {
        return next;
      }

      await BackupRunService.updateOneById({
        id: next.id!,
        data: {
          status: next.cancelRequestedAt
            ? BackupRunStatus.Cancelled
            : BackupRunStatus.Failed,
          finishedAt: this.now(),
          error: refusal,
        },
        props: { isRoot: true },
      });
    }
  }

  private start(run: BackupRun, lock: { release: () => Promise<void> }): void {
    const controller: AbortController = new AbortController();
    const runId: string = run.id!.toString();

    /*
     * One handler for the process (a name registers once): it stops the run
     * going on at shutdown, whichever it is, and gives it a few seconds to
     * stop the tools and abandon its uploads; the next tick cleans up the rest.
     */
    GracefulShutdown.registerHandler(
      BACKUP_SHUTDOWN_HANDLER_NAME,
      ShutdownPriority.Workers,
      async (): Promise<void> => {
        const current: CurrentRun | null = this.current;

        if (!current) {
          return;
        }

        current.controller.abort();

        await Promise.race([
          current.done,
          new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, BACKUP_SHUTDOWN_WAIT_IN_MS).unref();
          }),
        ]);
      },
    );

    const execute: () => Promise<void> = async (): Promise<void> => {
      if (run.kind === BackupRunKind.Restore) {
        await this.restoreRunner.run({
          run,
          signal: controller.signal,
          onFailure: async (error: string): Promise<void> => {
            await this.notifyFailure({
              kind: BackupRunKind.Restore,
              trigger: run.trigger || BackupRunTrigger.Manual,
              error,
            });
          },
        });
        return;
      }

      const outcome: Awaited<ReturnType<BackupRunner["run"]>> =
        await this.backupRunner.run({
          run,
          signal: controller.signal,
          onFailure: async (error: string): Promise<void> => {
            await this.notifyFailure({
              kind: BackupRunKind.Backup,
              trigger: run.trigger || BackupRunTrigger.Manual,
              error,
            });
          },
        });

      if (outcome) {
        await BackupNotifications.clearFailureNotification().catch(() => {
          // Told at the next failure anyway.
        });
      }
    };

    const done: Promise<void> = execute()
      .catch((error: unknown) => {
        logger.error(`Backups: run ${runId} stopped: ${errorText(error)}`);
      })
      .finally(async () => {
        this.current = null;
        await lock.release();
      });

    this.current = { runId, controller, done };
  }

  // Queues a backup now (Back up now), unless a run is already waiting or running.
  public static async queueManualBackup(data: {
    createdByUserId?: ObjectID | undefined;
    includesClickhouse: boolean;
  }): Promise<BackupRun> {
    const run: BackupRun = new BackupRun();
    run.kind = BackupRunKind.Backup;
    run.trigger = BackupRunTrigger.Manual;
    run.status = BackupRunStatus.Queued;
    run.includesPostgres = true;
    run.includesClickhouse = data.includesClickhouse;

    if (data.createdByUserId) {
      run.createdByUserId = data.createdByUserId;
    }

    return await BackupRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }
}

// The scheduler of this process: the job's tick and the API's routes share it.
export const backupScheduler: BackupScheduler = new BackupScheduler();
