import BackupRunService from "Common/Server/Services/BackupRunService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import User from "Common/Models/DatabaseModels/User";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStep,
  BackupStepKey,
  BackupStepProgress,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * A run as it goes: its steps, their progress, its outcome - kept in memory
 * and written to its BackupRun row as they change, so the Backups page shows
 * every step while it runs. Progress is written at most every few seconds;
 * a step's start and end, and the run's end, at once. A heartbeat every 15
 * seconds says the worker is alive (a run whose heartbeat stops is failed by
 * the next tick, BackupScheduler.recoverStaleRuns).
 *
 * A restore switches PostgreSQL to the backup's data, where this run's row
 * does not exist (the backup was taken before it): reattach() writes the
 * row again, with everything it holds, before the run carries on. A write
 * that fails (the moment of the switch) is tried again with the next one.
 */

const PROGRESS_WRITE_INTERVAL_IN_MS: number = 3000;
export const HEARTBEAT_INTERVAL_IN_MS: number = 15 * 1000;

// What the recorder writes to the row, beyond its steps.
export interface BackupRunFields {
  status?: BackupRunStatus | undefined;
  startedAt?: Date | undefined;
  finishedAt?: Date | undefined;
  name?: string | undefined;
  location?: string | undefined;
  destinationType?: BackupDestinationType | undefined;
  destinationFingerprint?: string | undefined;
  postgresSizeInBytes?: number | undefined;
  clickhouseSizeInBytes?: number | undefined;
  manifest?: JSONObject | undefined;
  runnerState?: JSONObject | undefined;
  error?: string | undefined;
  safetyBackupRunId?: ObjectID | undefined;
}

export interface BackupRunIdentity {
  id: ObjectID;
  kind: BackupRunKind;
  trigger: BackupRunTrigger;
  includesPostgres: boolean;
  includesClickhouse: boolean;
  createdByUserId?: ObjectID | undefined;
  restoredBackupRunId?: ObjectID | undefined;
}

export class BackupRunCancelledError extends Error {
  public constructor() {
    super("Cancelled by a master admin.");
    this.name = "BackupRunCancelledError";
  }
}

export default class BackupRunRecorder {
  public readonly identity: BackupRunIdentity;
  private readonly steps: Array<BackupStep>;
  private readonly fields: BackupRunFields = {};
  private lastProgressWriteAt: number = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();
  private cancelCheckedAt: number = 0;
  private cancelRequested: boolean = false;
  private readonly now: () => Date;

  public constructor(data: {
    identity: BackupRunIdentity;
    stepKeys: ReadonlyArray<BackupStepKey>;
    now?: (() => Date) | undefined;
  }) {
    this.identity = data.identity;
    this.steps = data.stepKeys.map((key: BackupStepKey): BackupStep => {
      return { key, status: BackupStepStatus.Pending };
    });
    this.now =
      data.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });
  }

  public getSteps(): Array<BackupStep> {
    return this.steps.map((step: BackupStep): BackupStep => {
      return {
        ...step,
        ...(step.progress ? { progress: { ...step.progress } } : {}),
      };
    });
  }

  public getFields(): BackupRunFields {
    return { ...this.fields };
  }

  private getStep(key: BackupStepKey): BackupStep {
    const step: BackupStep | undefined = this.steps.find(
      (candidate: BackupStep): boolean => {
        return candidate.key === key;
      },
    );

    if (!step) {
      throw new Error(`The run has no step ${key}.`);
    }

    return step;
  }

  private stepsAsJson(): JSONArray {
    return JSON.parse(JSON.stringify(this.steps)) as JSONArray;
  }

  // Writes what changed. Never throws: a run goes on when its row cannot be written for a moment.
  private write(data: BackupRunFields): Promise<void> {
    Object.assign(this.fields, data);

    const write: () => Promise<void> = async (): Promise<void> => {
      try {
        await BackupRunService.updateOneById({
          id: this.identity.id,
          data: {
            ...(data as Partial<BackupRun>),
            steps: this.stepsAsJson(),
            heartbeatAt: this.now(),
          } as never,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.warn(
          `Backups: could not record the progress of run ${this.identity.id.toString()}; it is written with the next update.`,
        );
        logger.debug(error);
      }
    };

    this.pendingWrite = this.pendingWrite.then(write, write);

    return this.pendingWrite;
  }

  public async start(fields: BackupRunFields = {}): Promise<void> {
    await this.write({
      ...fields,
      status: BackupRunStatus.Running,
      startedAt: this.fields.startedAt || this.now(),
    });

    this.heartbeat = setInterval(() => {
      void this.write({});
    }, HEARTBEAT_INTERVAL_IN_MS);
    this.heartbeat.unref?.();
  }

  public async update(fields: BackupRunFields): Promise<void> {
    await this.write(fields);
  }

  public async startStep(key: BackupStepKey, message?: string): Promise<void> {
    const step: BackupStep = this.getStep(key);
    step.status = BackupStepStatus.Running;
    step.startedAt = this.now().toISOString();
    delete step.finishedAt;

    if (message) {
      step.message = message;
    }

    await this.write({});
  }

  // Progress of the running step: written at most every few seconds.
  public progress(
    key: BackupStepKey,
    progress: BackupStepProgress,
    message?: string,
  ): void {
    const step: BackupStep = this.getStep(key);
    step.progress = { ...(step.progress || {}), ...progress };

    if (message) {
      step.message = message;
    }

    const now: number = Date.now();

    if (now - this.lastProgressWriteAt >= PROGRESS_WRITE_INTERVAL_IN_MS) {
      this.lastProgressWriteAt = now;
      void this.write({});
    }
  }

  public async finishStep(
    key: BackupStepKey,
    status:
      | BackupStepStatus.Succeeded
      | BackupStepStatus.Failed
      | BackupStepStatus.Skipped,
    message?: string,
  ): Promise<void> {
    const step: BackupStep = this.getStep(key);
    step.status = status;
    step.finishedAt = this.now().toISOString();

    if (!step.startedAt && status !== BackupStepStatus.Skipped) {
      step.startedAt = step.finishedAt;
    }

    if (message) {
      step.message = message;
    }

    await this.write({});
  }

  public async skipStep(key: BackupStepKey, message: string): Promise<void> {
    await this.finishStep(key, BackupStepStatus.Skipped, message);
  }

  /*
   * Runs one step: started, then succeeded with what `run` answers, or
   * failed with its error (which is thrown on).
   */
  public async runStep<T>(
    key: BackupStepKey,
    run: () => Promise<{ value: T; message?: string | undefined }>,
    startMessage?: string,
  ): Promise<T> {
    await this.startStep(key, startMessage);

    try {
      const outcome: { value: T; message?: string | undefined } = await run();
      await this.finishStep(key, BackupStepStatus.Succeeded, outcome.message);
      return outcome.value;
    } catch (error) {
      await this.finishStep(
        key,
        BackupStepStatus.Failed,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  // Steps still pending when the run stops are skipped, so none reads as waiting.
  private skipPendingSteps(): void {
    for (const step of this.steps) {
      if (step.status === BackupStepStatus.Pending) {
        step.status = BackupStepStatus.Skipped;
      }

      if (step.status === BackupStepStatus.Running) {
        step.status = BackupStepStatus.Failed;
        step.finishedAt = this.now().toISOString();
      }
    }
  }

  public async finish(
    status:
      | BackupRunStatus.Succeeded
      | BackupRunStatus.Failed
      | BackupRunStatus.Cancelled,
    fields: BackupRunFields = {},
  ): Promise<void> {
    this.stopHeartbeat();
    this.skipPendingSteps();

    await this.write({ ...fields, status, finishedAt: this.now() });
  }

  public stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /*
   * Whether a master admin asked to cancel the run (Cancel, which sets
   * cancelRequestedAt): read at most every 5 seconds.
   */
  public async isCancelRequested(): Promise<boolean> {
    if (this.cancelRequested) {
      return true;
    }

    if (Date.now() - this.cancelCheckedAt < 5000) {
      return false;
    }

    this.cancelCheckedAt = Date.now();

    try {
      const row: BackupRun | null = await BackupRunService.findOneById({
        id: this.identity.id,
        select: { cancelRequestedAt: true },
        props: { isRoot: true },
      });

      this.cancelRequested = Boolean(row?.cancelRequestedAt);
    } catch {
      // Asked again with the next check.
    }

    return this.cancelRequested;
  }

  public async throwIfCancelled(): Promise<void> {
    if (await this.isCancelRequested()) {
      throw new BackupRunCancelledError();
    }
  }

  /*
   * Writes the run's row again where it does not exist: after a restore
   * switched PostgreSQL to the backup's data. The master admin who started
   * it keeps it only if the restored data knows them.
   */
  public async reattach(): Promise<void> {
    await this.pendingWrite;

    const existing: BackupRun | null = await BackupRunService.findOneById({
      id: this.identity.id,
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      await this.write({});
      return;
    }

    let createdByUserId: ObjectID | undefined = this.identity.createdByUserId;

    if (createdByUserId) {
      const user: User | null = await UserService.findOneById({
        id: createdByUserId,
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!user) {
        createdByUserId = undefined;
      }
    }

    const row: BackupRun = new BackupRun();
    row.id = this.identity.id;
    row.kind = this.identity.kind;
    row.trigger = this.identity.trigger;
    row.includesPostgres = this.identity.includesPostgres;
    row.includesClickhouse = this.identity.includesClickhouse;

    if (createdByUserId) {
      row.createdByUserId = createdByUserId;
    }

    if (this.identity.restoredBackupRunId) {
      row.restoredBackupRunId = this.identity.restoredBackupRunId;
    }

    Object.assign(row, this.fields);
    row.steps = this.stepsAsJson();
    row.heartbeatAt = this.now();

    await BackupRunService.create({ data: row, props: { isRoot: true } });
  }
}
