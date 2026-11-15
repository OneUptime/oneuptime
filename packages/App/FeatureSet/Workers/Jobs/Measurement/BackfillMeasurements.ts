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
import MeasurementBackfillProgress, {
  MeasurementBackfillProgressWrite,
} from "Common/Server/Utils/Measurement/MeasurementBackfillProgress";

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
 *
 * And one keeps it right when a measurement is edited while it is walked:
 * every write of a walk - each page's cursor and the completion stamp - is
 * held to the request the walk began from (MeasurementBackfillProgress). An
 * edit stamps a new request and clears the cursor and the completion; the
 * walk's next write is then refused, the walk stops, and the next tick works
 * the new definition out from the beginning. Written as plain updates, the
 * walk wrote over the edit: it stamped completion, and the history was never
 * worked out again, or saved its cursor, and the new walk resumed part way.
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
  /*
   * Writes how far a walk got, while the measurement's request is still the
   * one the walk began from: false when it was asked for again (or removed)
   * since, and nothing was written.
   */
  saveProgress: (data: MeasurementBackfillProgressWrite) => Promise<boolean>;
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

/*
 * The measurements still to backfill: requested, and not finished since.
 *
 * Every request stamps backfillRequestedAt and clears backfillCompletedAt
 * (the measurement services on create and on a definition edit, and
 * FirstPagedAt's re-request), and a finished run stamps backfillCompletedAt,
 * so "not finished" is backfillCompletedAt IS NULL. The read used to ask
 * only for backfillRequestedAt IS NOT NULL - every measurement ever
 * backfilled - and skip the finished ones after reading them: once 500 had
 * finished, the 500 it read could all be finished ones, and a new request
 * was never reached.
 */
const buildPendingMeasurementQuery: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return {
    backfillRequestedAt: QueryHelper.notNull(),
    backfillCompletedAt: QueryHelper.isNull(),
  };
};

// Oldest request first, so a request is never left behind newer ones.
const PENDING_MEASUREMENT_SORT: Record<string, SortOrder> = {
  backfillRequestedAt: SortOrder.Ascending,
  _id: SortOrder.Ascending,
};

type BuildDomainsFunction = () => Array<DomainBackfill>;

const buildDomains: BuildDomainsFunction = (): Array<DomainBackfill> => {
  return [
    {
      domain: "Incident",
      findMeasurements: async (): Promise<Array<MeasurementBackfillState>> => {
        return (await IncidentMeasurementService.findBy({
          query: buildPendingMeasurementQuery(),
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (
        data: MeasurementBackfillProgressWrite,
      ): Promise<boolean> => {
        return await MeasurementBackfillProgress.save({
          service: IncidentMeasurementService,
          write: data,
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
          query: buildPendingMeasurementQuery(),
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (
        data: MeasurementBackfillProgressWrite,
      ): Promise<boolean> => {
        return await MeasurementBackfillProgress.save({
          service: AlertMeasurementService,
          write: data,
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
          query: buildPendingMeasurementQuery(),
          select: {
            _id: true,
            projectId: true,
            backfillRequestedAt: true,
            backfillCompletedAt: true,
            backfillCursorCreatedAt: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      saveProgress: async (
        data: MeasurementBackfillProgressWrite,
      ): Promise<boolean> => {
        return await MeasurementBackfillProgress.save({
          service: ScheduledMaintenanceMeasurementService,
          write: data,
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

type RunDomainFunction = (domain: DomainBackfill) => Promise<void>;

const runDomain: RunDomainFunction = async (
  domain: DomainBackfill,
): Promise<void> => {
  try {
    const measurements: Array<MeasurementBackfillState> =
      await domain.findMeasurements();

    for (const measurement of measurements) {
      /*
       * A row read without its request has nothing to hold the walk's
       * writes to: written anyway, they could land over an edit's.
       */
      if (
        !measurement._id ||
        !measurement.projectId ||
        !measurement.backfillRequestedAt
      ) {
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

  /*
   * The request this walk is for, as it was read. Every write below is held
   * to it, so an edit made while the walk runs is never written over: the
   * walk stops at its next write.
   */
  const requestedAt: Date = OneUptimeDate.fromString(
    measurement.backfillRequestedAt!,
  );

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
      const isCompleted: boolean = await domain.saveProgress({
        measurementId: measurement._id!,
        requestedAt: requestedAt,
        cursorCreatedAt: lastCreatedAt,
        completedAt: OneUptimeDate.getCurrentDate(),
      });

      if (!isCompleted) {
        logAskedForAgain({ domain: domain, measurement: measurement });
      }

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

    const isSaved: boolean = await domain.saveProgress({
      measurementId: measurement._id!,
      requestedAt: requestedAt,
      cursorCreatedAt: cursor,
    });

    if (!isSaved) {
      logAskedForAgain({ domain: domain, measurement: measurement });
      return;
    }
  }
};

type LogAskedForAgainFunction = (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
}) => void;

/*
 * A walk whose write was refused: the measurement was asked for again while
 * it was walked - its definition edited - or removed. The walk's progress is
 * not written, and the next tick walks the new request from the beginning.
 */
const logAskedForAgain: LogAskedForAgainFunction = (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
}): void => {
  logger.info(
    `Measurement:Backfill stopped walking ${data.domain.domain} measurement ${data.measurement._id?.toString()}: it was asked for again or removed while it was walked, so the next run starts it over from the beginning`,
  );
};
