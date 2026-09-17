import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import IncidentMeasurementService from "Common/Server/Services/IncidentMeasurementService";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import AlertMeasurementService from "Common/Server/Services/AlertMeasurementService";
import AlertMeasurementValueService from "Common/Server/Services/AlertMeasurementValueService";
import ScheduledMaintenanceMeasurementService from "Common/Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceMeasurementValueService from "Common/Server/Services/ScheduledMaintenanceMeasurementValueService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";

/*
 * Fills in measurement values for entities that already existed when a
 * measurement was defined.
 *
 * Without this, creating "Time to Detect" leaves it blank on every closed
 * incident forever: the recompute fires on state changes, and a resolved
 * incident will never have another one. The settings page would show a
 * measurement that looks like it works and produces nothing.
 *
 * Two properties keep this from being an outage:
 *
 *   1. It walks Postgres only. Rewriting ClickHouse history would mean one
 *      full metric refresh per historical entity -- a semaphore, a config
 *      read and a ClickHouse read-plus-insert each -- which on a large
 *      project is a migration in name and an outage in effect. Charts fill
 *      forward from the definition's creation instead, and an individual
 *      entity picks up its metric point on its next state change.
 *
 *   2. It stores a CURSOR, not a boolean, so a worker restart resumes from
 *      the last committed page rather than starting the project over. The
 *      cursor is inclusive: entities sharing the boundary timestamp are
 *      recomputed again rather than risking a skip, which costs nothing
 *      because the recompute is a total function of current data.
 */

const PAGE_SIZE: number = 500;

// Bounds one project's share of a tick so a large project cannot starve others.
const MAX_PAGES_PER_RUN: number = 10;

interface MeasurementBackfillState {
  _id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  backfillRequestedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
}

interface EntityRow {
  _id?: ObjectID | undefined;
  createdAt?: Date | undefined;
}

interface DomainBackfill {
  domain: string;
  findMeasurements: () => Promise<Array<MeasurementBackfillState>>;
  saveProgress: (data: {
    measurementId: ObjectID;
    cursorCreatedAt?: Date | undefined;
    completedAt?: Date | undefined;
  }) => Promise<void>;
  findEntities: (data: {
    projectId: ObjectID;
    after?: Date | undefined;
  }) => Promise<Array<EntityRow>>;
  recompute: (entityId: ObjectID) => Promise<void>;
}

RunCron(
  "Measurement:Backfill",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    for (const domain of buildDomains()) {
      await runDomain(domain);
    }
  },
);

type BuildDomainsFunction = () => Array<DomainBackfill>;

const buildDomains: BuildDomainsFunction = (): Array<DomainBackfill> => {
  return [
    {
      domain: "Incident",
      findMeasurements: async (): Promise<Array<MeasurementBackfillState>> => {
        return (await IncidentMeasurementService.findBy({
          query: { backfillRequestedAt: QueryHelper.notNull() },
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (data: {
        measurementId: ObjectID;
        cursorCreatedAt?: Date | undefined;
        completedAt?: Date | undefined;
      }): Promise<void> => {
        await IncidentMeasurementService.updateOneById({
          id: data.measurementId,
          data: buildProgressPatch(data),
          props: { isRoot: true },
        });
      },
      findEntities: async (data: {
        projectId: ObjectID;
        after?: Date | undefined;
      }): Promise<Array<EntityRow>> => {
        return (await IncidentService.findBy({
          query: buildEntityQuery(data),
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Ascending },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<EntityRow>;
      },
      recompute: async (entityId: ObjectID): Promise<void> => {
        await IncidentMeasurementValueService.recomputeForIncident({
          incidentId: entityId,
        });
      },
    },
    {
      domain: "Alert",
      findMeasurements: async (): Promise<Array<MeasurementBackfillState>> => {
        return (await AlertMeasurementService.findBy({
          query: { backfillRequestedAt: QueryHelper.notNull() },
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (data: {
        measurementId: ObjectID;
        cursorCreatedAt?: Date | undefined;
        completedAt?: Date | undefined;
      }): Promise<void> => {
        await AlertMeasurementService.updateOneById({
          id: data.measurementId,
          data: buildProgressPatch(data),
          props: { isRoot: true },
        });
      },
      findEntities: async (data: {
        projectId: ObjectID;
        after?: Date | undefined;
      }): Promise<Array<EntityRow>> => {
        return (await AlertService.findBy({
          query: buildEntityQuery(data),
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Ascending },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<EntityRow>;
      },
      recompute: async (entityId: ObjectID): Promise<void> => {
        await AlertMeasurementValueService.recomputeForAlert({
          alertId: entityId,
        });
      },
    },
    {
      domain: "ScheduledMaintenance",
      findMeasurements: async (): Promise<Array<MeasurementBackfillState>> => {
        return (await ScheduledMaintenanceMeasurementService.findBy({
          query: { backfillRequestedAt: QueryHelper.notNull() },
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (data: {
        measurementId: ObjectID;
        cursorCreatedAt?: Date | undefined;
        completedAt?: Date | undefined;
      }): Promise<void> => {
        await ScheduledMaintenanceMeasurementService.updateOneById({
          id: data.measurementId,
          data: buildProgressPatch(data),
          props: { isRoot: true },
        });
      },
      findEntities: async (data: {
        projectId: ObjectID;
        after?: Date | undefined;
      }): Promise<Array<EntityRow>> => {
        return (await ScheduledMaintenanceService.findBy({
          query: buildEntityQuery(data),
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Ascending },
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<EntityRow>;
      },
      recompute: async (entityId: ObjectID): Promise<void> => {
        await ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
          { scheduledMaintenanceId: entityId },
        );
      },
    },
  ];
};

type BuildEntityQueryFunction = (data: {
  projectId: ObjectID;
  after?: Date | undefined;
}) => Record<string, unknown>;

const buildEntityQuery: BuildEntityQueryFunction = (data: {
  projectId: ObjectID;
  after?: Date | undefined;
}): Record<string, unknown> => {
  const query: Record<string, unknown> = { projectId: data.projectId };

  if (data.after) {
    query["createdAt"] = QueryHelper.greaterThanEqualTo(data.after);
  }

  return query;
};

type BuildProgressPatchFunction = (data: {
  cursorCreatedAt?: Date | undefined;
  completedAt?: Date | undefined;
}) => Record<string, unknown>;

const buildProgressPatch: BuildProgressPatchFunction = (data: {
  cursorCreatedAt?: Date | undefined;
  completedAt?: Date | undefined;
}): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};

  if (data.cursorCreatedAt) {
    patch["backfillCursorCreatedAt"] = data.cursorCreatedAt;
  }

  if (data.completedAt) {
    patch["backfillCompletedAt"] = data.completedAt;
  }

  return patch;
};

type RunDomainFunction = (domain: DomainBackfill) => Promise<void>;

const runDomain: RunDomainFunction = async (
  domain: DomainBackfill,
): Promise<void> => {
  try {
    const measurements: Array<MeasurementBackfillState> =
      await domain.findMeasurements();

    for (const measurement of measurements) {
      if (!measurement._id || !measurement.projectId) {
        continue;
      }

      /*
       * A definition edited mid-backfill re-stamps backfillRequestedAt and
       * clears the cursor, so comparing the two is what stops a finished run
       * from being redone on every tick while still catching a re-request.
       */
      if (
        measurement.backfillCompletedAt &&
        measurement.backfillRequestedAt &&
        OneUptimeDate.fromString(measurement.backfillCompletedAt).getTime() >=
          OneUptimeDate.fromString(measurement.backfillRequestedAt).getTime()
      ) {
        continue;
      }

      await runMeasurement({ domain: domain, measurement: measurement });
    }
  } catch (err) {
    logger.error(`Measurement:Backfill failed for ${domain.domain}`);
    logger.error(err);
  }
};

type RunMeasurementFunction = (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
}) => Promise<void>;

const runMeasurement: RunMeasurementFunction = async (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
}): Promise<void> => {
  const { domain, measurement } = data;

  let cursor: Date | undefined = measurement.backfillCursorCreatedAt;

  for (let page: number = 0; page < MAX_PAGES_PER_RUN; page++) {
    const entities: Array<EntityRow> = await domain.findEntities({
      projectId: measurement.projectId!,
      after: cursor,
    });

    for (const entity of entities) {
      if (!entity._id) {
        continue;
      }

      try {
        await domain.recompute(entity._id);
      } catch (err) {
        /*
         * One unreadable entity must not stall the cursor behind it, or the
         * whole project stops converging on a single bad row.
         */
        logger.error(err);
      }
    }

    const lastCreatedAt: Date | undefined =
      entities[entities.length - 1]?.createdAt;

    if (entities.length < PAGE_SIZE) {
      await domain.saveProgress({
        measurementId: measurement._id!,
        cursorCreatedAt: lastCreatedAt,
        completedAt: OneUptimeDate.getCurrentDate(),
      });

      return;
    }

    /*
     * A full page that did not advance the timestamp means more than
     * PAGE_SIZE entities share one createdAt. Paging again would return the
     * same rows for ever, so stop and let the next tick retry rather than
     * spin.
     */
    if (
      !lastCreatedAt ||
      (cursor &&
        OneUptimeDate.fromString(lastCreatedAt).getTime() ===
          OneUptimeDate.fromString(cursor).getTime())
    ) {
      logger.warn(
        `Measurement:Backfill stalled for ${domain.domain} measurement ${measurement._id?.toString()}: more than ${PAGE_SIZE} rows share one createdAt`,
      );

      return;
    }

    cursor = lastCreatedAt;

    await domain.saveProgress({
      measurementId: measurement._id!,
      cursorCreatedAt: cursor,
    });
  }
};
