import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GuidedSetupRun";
import ObjectID from "../../Types/ObjectID";
import {
  GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS,
  GuidedSetupKey,
  GuidedSetupRunChange,
  GuidedSetupRunResources,
  GuidedSetupRunState,
  GuidedSetupRunValues,
  applyGuidedSetupRunChange,
  isEmptyGuidedSetupRunChange,
  readGuidedSetupRunResources,
  readGuidedSetupRunValues,
} from "../../Types/GuidedSetup/GuidedSetupRun";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { EntityManager } from "typeorm";

// Whose run: one person's, in one project, of one setup.
export interface GuidedSetupRunCaller {
  projectId: ObjectID;
  userId: ObjectID;
  setup: GuidedSetupKey;
}

interface RunRow {
  values?: unknown;
  resources?: unknown;
  revision?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}

const toIso: (value: unknown) => string = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? new Date(value).toISOString() : "";
};

const toRevision: (value: unknown) => number = (value: unknown): number => {
  const revision: number = Number(value);

  return Number.isFinite(revision) && revision > 0 ? revision : 0;
};

const isEmptyRun: (data: {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
}) => boolean = (data: {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
}): boolean => {
  return (
    Object.keys(data.values).length === 0 &&
    Object.keys(data.resources).length === 0
  );
};

/*
 * A GUIDED SETUP'S RUN, ON THE SERVER (#7253): one per project, person and
 * setup (Models/DatabaseModels/GuidedSetupRun). Only GuidedSetupRunAPI calls
 * it, for the caller's own run, so it reads and writes as OneUptime.
 *
 *   - getRun: the run, or null when there is none;
 *   - changeRun: a change merged in name by name
 *     (Types/GuidedSetup/GuidedSetupRun's applyGuidedSetupRunChange), under a
 *     lock on the run's row, so a device saving at the same moment waits and
 *     then reads this change with its own: neither is lost. A run left with
 *     nothing in it is deleted, as one forgotten is;
 *   - forgetRun: deleted, to start afresh.
 *
 * Every write is raw SQL on the one table, so no hook runs: a run has no
 * hooks, and is no project change for the audit log (AuditLogCoverage lists
 * it as a record of a run). A run nobody changed for
 * GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS days goes in the daily purge
 * (HardDelete:HardDeleteOlderItemsInDatabase), on every installation.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "updatedAt",
      GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS,
    );
  }

  @CaptureSpan()
  public async getRun(
    caller: GuidedSetupRunCaller,
  ): Promise<GuidedSetupRunState | null> {
    const rows: Array<RunRow> = await this.getRepository().manager.query(
      `SELECT "values", "resources", "revision", "updatedAt" FROM "GuidedSetupRun" WHERE "projectId" = $1 AND "userId" = $2 AND "setup" = $3 AND "deletedAt" IS NULL LIMIT 1`,
      [caller.projectId.toString(), caller.userId.toString(), caller.setup],
    );

    return this.toState(rows[0]);
  }

  /*
   * Merges the change into the caller's run, making it when there is none,
   * and answers the run as it now stands (null when the change left nothing
   * in it). A change that names nothing changes nothing.
   */
  @CaptureSpan()
  public async changeRun(
    caller: GuidedSetupRunCaller,
    change: GuidedSetupRunChange,
  ): Promise<GuidedSetupRunState | null> {
    if (isEmptyGuidedSetupRunChange(change)) {
      return await this.getRun(caller);
    }

    const keys: Array<string> = [
      caller.projectId.toString(),
      caller.userId.toString(),
      caller.setup,
    ];

    return await this.getRepository().manager.transaction(
      async (manager: EntityManager): Promise<GuidedSetupRunState | null> => {
        /*
         * The row exists before it is locked, so two devices making the
         * first change at once lock the same row, one after the other.
         */
        await manager.query(
          `INSERT INTO "GuidedSetupRun" ("projectId", "userId", "setup", "values", "resources", "revision", "version") VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, 0, 1) ON CONFLICT ("projectId", "userId", "setup") DO NOTHING`,
          keys,
        );

        const rows: Array<RunRow> = await manager.query(
          `SELECT "values", "resources", "revision", "deletedAt" FROM "GuidedSetupRun" WHERE "projectId" = $1 AND "userId" = $2 AND "setup" = $3 FOR UPDATE`,
          keys,
        );

        const row: RunRow | undefined = rows[0];
        // A row deleted but not yet purged holds a run that was forgotten.
        const isKept: boolean = Boolean(row) && !row!.deletedAt;
        const merged: {
          values: GuidedSetupRunValues;
          resources: GuidedSetupRunResources;
        } = applyGuidedSetupRunChange({
          values: isKept ? readGuidedSetupRunValues(row!.values) : {},
          resources: isKept ? readGuidedSetupRunResources(row!.resources) : {},
          change: change,
          now: new Date(),
        });

        if (isEmptyRun(merged)) {
          await manager.query(
            `DELETE FROM "GuidedSetupRun" WHERE "projectId" = $1 AND "userId" = $2 AND "setup" = $3`,
            keys,
          );

          return null;
        }

        const revision: number = (isKept ? toRevision(row!.revision) : 0) + 1;

        const updated: Array<RunRow> = await manager.query(
          `UPDATE "GuidedSetupRun" SET "values" = $4::jsonb, "resources" = $5::jsonb, "revision" = $6, "updatedAt" = now(), "deletedAt" = NULL, "version" = "version" + 1 WHERE "projectId" = $1 AND "userId" = $2 AND "setup" = $3 RETURNING "values", "resources", "revision", "updatedAt"`,
          [
            ...keys,
            JSON.stringify(merged.values),
            JSON.stringify(merged.resources),
            revision,
          ],
        );

        return this.toState(this.firstReturned(updated));
      },
    );
  }

  // Deletes the caller's run: the next one starts afresh.
  @CaptureSpan()
  public async forgetRun(caller: GuidedSetupRunCaller): Promise<void> {
    await this.getRepository().manager.query(
      `DELETE FROM "GuidedSetupRun" WHERE "projectId" = $1 AND "userId" = $2 AND "setup" = $3`,
      [caller.projectId.toString(), caller.userId.toString(), caller.setup],
    );
  }

  /*
   * An UPDATE ... RETURNING answers its rows, or, through some drivers,
   * its rows and the count beside them.
   */
  private firstReturned(result: unknown): RunRow | undefined {
    if (!Array.isArray(result)) {
      return undefined;
    }

    if (Array.isArray(result[0])) {
      return (result[0] as Array<RunRow>)[0];
    }

    return result[0] as RunRow | undefined;
  }

  private toState(row: RunRow | undefined): GuidedSetupRunState | null {
    if (!row) {
      return null;
    }

    const state: GuidedSetupRunState = {
      values: readGuidedSetupRunValues(row.values),
      resources: readGuidedSetupRunResources(row.resources),
      revision: toRevision(row.revision),
      updatedAt: toIso(row.updatedAt),
    };

    return isEmptyRun(state) ? null : state;
  }
}

export default new Service();
