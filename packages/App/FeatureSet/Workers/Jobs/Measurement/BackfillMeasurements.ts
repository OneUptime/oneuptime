import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
  isExactTimestampOf,
  MeasurementBackfillCursor,
  MeasurementBackfillProgressWrite,
  MeasurementBackfillStoredCursor,
} from "Common/Server/Utils/Measurement/MeasurementBackfillProgress";
import MeasurementBackfillPage, {
  MeasurementBackfillPageAfter,
} from "Common/Server/Utils/Measurement/MeasurementBackfillPage";

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
 *      walk is in (createdAt, _id) order and the cursor is the last entity
 *      of a page, both columns of it (MeasurementBackfillPage), so every
 *      entity is visited once, and a page may end anywhere in a run of
 *      entities created at one moment. The cursor used to be the createdAt
 *      alone, read from inclusively (#8171): when more than a page of
 *      entities shared one - every row one transaction inserts gets the
 *      same now() - each page was the same page, and the walk stalled there
 *      for good, the measurement never finished. Its createdAt is kept to
 *      the microsecond, as Postgres keeps the entity's (#8388), so it places
 *      the next page exactly even once its entity is deleted for good.
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

// How a walk ended this tick, or a domain's walks.
enum WalkEnd {
  // Finished, stopped at the per-run page cap, refused (asked for again) or failed.
  Done = "Done",
  // Stopped at the tick's deadline, with what it got to saved (#8172).
  AtDeadline = "AtDeadline",
}

interface MeasurementBackfillState {
  _id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  backfillRequestedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
  backfillCursorId?: ObjectID | undefined;
}

interface DomainBackfill {
  domain: string;
  findMeasurements: () => Promise<Array<MeasurementBackfillState>>;
  /*
   * The cursors these measurements hold, each createdAt to the microsecond
   * (MeasurementBackfillProgress.readExactCursors): findMeasurements reads
   * it through TypeORM, to the millisecond.
   */
  readExactCursors: (
    measurementIds: Array<ObjectID>,
  ) => Promise<Map<string, MeasurementBackfillStoredCursor>>;
  /*
   * Writes how far a walk got, while the measurement's request is still the
   * one the walk began from: false when it was asked for again (or removed)
   * since, and nothing was written.
   */
  saveProgress: (data: MeasurementBackfillProgressWrite) => Promise<boolean>;
  // One page of the project's entities, after the cursor (MeasurementBackfillPage).
  findEntities: (data: {
    projectId: ObjectID;
    after?: MeasurementBackfillPageAfter | undefined;
  }) => Promise<Array<MeasurementBackfillCursor>>;
  recompute: (entityId: ObjectID) => Promise<void>;
}

/*
 * One tick, until its deadline: its time limit, or its lock lost (RunCron,
 * CronLock). It used to take none (#8172): a tick with many measurements to
 * work out - after FirstPagedAt or RewriteMeasurementPointsInTheirUnit asked
 * for every one again - ran far past its five minutes, went on walking after
 * CronLock gave its lock back, and the next tick walked the same
 * measurements beside it. Now it stops at the next measurement, page or
 * entity once the deadline passes, the cursor saved where it got to, and the
 * next tick carries on from there.
 */
RunCron(
  "Measurement:Backfill",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    for (const domain of buildDomains()) {
      if (
        deadline.hasPassed() ||
        (await runDomain({ domain: domain, deadline: deadline })) ===
          WalkEnd.AtDeadline
      ) {
        logger.info(
          `Measurement:Backfill stopped at its deadline (its time limit ran out, or it lost its lock) before it had worked out every measurement asked for; the next run carries on from where each walk got to.`,
        );
        return;
      }
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
            backfillCursorId: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      readExactCursors: async (
        measurementIds: Array<ObjectID>,
      ): Promise<Map<string, MeasurementBackfillStoredCursor>> => {
        return await MeasurementBackfillProgress.readExactCursors({
          service: IncidentMeasurementService,
          measurementIds: measurementIds,
        });
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
        after?: MeasurementBackfillPageAfter | undefined;
      }): Promise<Array<MeasurementBackfillCursor>> => {
        return await MeasurementBackfillPage.read({
          service: IncidentService,
          projectId: data.projectId,
          after: data.after,
          limit: PAGE_SIZE,
        });
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
            backfillCursorId: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      readExactCursors: async (
        measurementIds: Array<ObjectID>,
      ): Promise<Map<string, MeasurementBackfillStoredCursor>> => {
        return await MeasurementBackfillProgress.readExactCursors({
          service: AlertMeasurementService,
          measurementIds: measurementIds,
        });
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
        after?: MeasurementBackfillPageAfter | undefined;
      }): Promise<Array<MeasurementBackfillCursor>> => {
        return await MeasurementBackfillPage.read({
          service: AlertService,
          projectId: data.projectId,
          after: data.after,
          limit: PAGE_SIZE,
        });
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
            backfillCursorId: true,
          },
          sort: PENDING_MEASUREMENT_SORT,
          limit: PAGE_SIZE,
          skip: 0,
          props: { isRoot: true },
        })) as unknown as Array<MeasurementBackfillState>;
      },
      readExactCursors: async (
        measurementIds: Array<ObjectID>,
      ): Promise<Map<string, MeasurementBackfillStoredCursor>> => {
        return await MeasurementBackfillProgress.readExactCursors({
          service: ScheduledMaintenanceMeasurementService,
          measurementIds: measurementIds,
        });
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
        after?: MeasurementBackfillPageAfter | undefined;
      }): Promise<Array<MeasurementBackfillCursor>> => {
        return await MeasurementBackfillPage.read({
          service: ScheduledMaintenanceService,
          projectId: data.projectId,
          after: data.after,
          limit: PAGE_SIZE,
        });
      },
      recompute: async (entityId: ObjectID): Promise<void> => {
        await ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
          { scheduledMaintenanceId: entityId },
        );
      },
    },
  ];
};

type RunDomainFunction = (data: {
  domain: DomainBackfill;
  deadline: JobDeadline;
}) => Promise<WalkEnd>;

// Walks a domain's measurements still to backfill, one after the other, until the deadline.
const runDomain: RunDomainFunction = async (data: {
  domain: DomainBackfill;
  deadline: JobDeadline;
}): Promise<WalkEnd> => {
  const { domain, deadline } = data;

  try {
    const measurements: Array<MeasurementBackfillState> = (
      await domain.findMeasurements()
    ).filter(isStillToWalk);

    const exactCursors: Map<string, MeasurementBackfillStoredCursor> =
      await readExactCursorsOf({
        domain: domain,
        measurements: measurements,
      });

    for (const measurement of measurements) {
      if (deadline.hasPassed()) {
        return WalkEnd.AtDeadline;
      }

      const end: WalkEnd = await runMeasurement({
        domain: domain,
        measurement: measurement,
        // Keyed by the id as Postgres writes a uuid: lowercase.
        storedCursor: exactCursors.get(
          measurement._id!.toString().toLowerCase(),
        ),
        deadline: deadline,
      });

      if (end === WalkEnd.AtDeadline) {
        return WalkEnd.AtDeadline;
      }
    }
  } catch (err) {
    logger.error(`Measurement:Backfill failed for ${domain.domain}`);
    logger.error(err);
  }

  return WalkEnd.Done;
};

type IsStillToWalkFunction = (measurement: MeasurementBackfillState) => boolean;

const isStillToWalk: IsStillToWalkFunction = (
  measurement: MeasurementBackfillState,
): boolean => {
  /*
   * A row read without its request has nothing to hold the walk's writes
   * to: written anyway, they could land over an edit's.
   */
  if (
    !measurement._id ||
    !measurement.projectId ||
    !measurement.backfillRequestedAt
  ) {
    return false;
  }

  /*
   * A definition edited mid-backfill re-stamps backfillRequestedAt and
   * clears the cursor, so comparing the two is what stops a finished run
   * from being redone on every tick while still catching a re-request.
   */
  return !(
    measurement.backfillCompletedAt &&
    OneUptimeDate.fromString(measurement.backfillCompletedAt).getTime() >=
      OneUptimeDate.fromString(measurement.backfillRequestedAt).getTime()
  );
};

type ReadExactCursorsOfFunction = (data: {
  domain: DomainBackfill;
  measurements: Array<MeasurementBackfillState>;
}) => Promise<Map<string, MeasurementBackfillStoredCursor>>;

/*
 * The cursors of the measurements to walk, to the microsecond (#8388), in
 * one read: only those holding a cursor with both its columns. Should the
 * read fail, each walk goes on from its cursor as findMeasurements read it,
 * to the millisecond, as it did before: a few records read again at worst,
 * never a walk left undone.
 */
const readExactCursorsOf: ReadExactCursorsOfFunction = async (data: {
  domain: DomainBackfill;
  measurements: Array<MeasurementBackfillState>;
}): Promise<Map<string, MeasurementBackfillStoredCursor>> => {
  const measurementIds: Array<ObjectID> = data.measurements
    .filter((measurement: MeasurementBackfillState): boolean => {
      return Boolean(
        measurement.backfillCursorCreatedAt && measurement.backfillCursorId,
      );
    })
    .map((measurement: MeasurementBackfillState): ObjectID => {
      return measurement._id!;
    });

  if (measurementIds.length === 0) {
    return new Map<string, MeasurementBackfillStoredCursor>();
  }

  try {
    return await data.domain.readExactCursors(measurementIds);
  } catch (err) {
    logger.warn(
      `Measurement:Backfill could not read the ${data.domain.domain} measurements' cursors to the microsecond; their walks go on from the cursors to the millisecond`,
    );
    logger.warn(err);

    return new Map<string, MeasurementBackfillStoredCursor>();
  }
};

type RunMeasurementFunction = (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
  storedCursor?: MeasurementBackfillStoredCursor | undefined;
  deadline: JobDeadline;
}) => Promise<WalkEnd>;

/*
 * One measurement's walk for this tick: page after page, up to the per-run
 * cap, until its deadline. A deadline that passes between pages stops the
 * walk before the next page is read; one that passes in the middle of a
 * page stops it before the next entity, and the walk saves where it got to
 * - the last entity it worked out, held to the request like every write -
 * so the next tick goes on right after it, neither working any entity out
 * again nor passing one over. An entity being worked out when the deadline
 * passes is finished first: work in flight is not cut off half way.
 */
const runMeasurement: RunMeasurementFunction = async (data: {
  domain: DomainBackfill;
  measurement: MeasurementBackfillState;
  storedCursor?: MeasurementBackfillStoredCursor | undefined;
  deadline: JobDeadline;
}): Promise<WalkEnd> => {
  const { domain, measurement, deadline } = data;

  /*
   * The request this walk is for, as it was read. Every write below is held
   * to it, so an edit made while the walk runs is never written over: the
   * walk stops at its next write.
   */
  const requestedAt: Date = OneUptimeDate.fromString(
    measurement.backfillRequestedAt!,
  );

  /*
   * Where the walk got to. A cursor saved before the walk kept the id
   * (#8171) has none: its page reads from that createdAt on, inclusive, as
   * the walk used to, and the cursor it saves has both.
   */
  let cursor: MeasurementBackfillPageAfter | undefined =
    measurement.backfillCursorCreatedAt
      ? getStartingCursor({
          createdAt: OneUptimeDate.fromString(
            measurement.backfillCursorCreatedAt,
          ),
          id: measurement.backfillCursorId
            ? new ObjectID(measurement.backfillCursorId.toString())
            : undefined,
          stored: data.storedCursor,
        })
      : undefined;

  for (let page: number = 0; page < MAX_PAGES_PER_RUN; page++) {
    // Past the deadline, no page is read: the cursor saved stands.
    if (deadline.hasPassed()) {
      return WalkEnd.AtDeadline;
    }

    const entities: Array<MeasurementBackfillCursor> =
      await domain.findEntities({
        projectId: measurement.projectId!,
        after: cursor,
      });

    // The last entity of this page worked out so far.
    let workedOut: MeasurementBackfillCursor | undefined = undefined;

    for (const entity of entities) {
      if (deadline.hasPassed()) {
        /*
         * Where the walk got to in the page, so the next tick goes on right
         * after it. Nothing worked out on this page yet: the cursor saved
         * after the page before stands.
         */
        if (workedOut) {
          const isSaved: boolean = await domain.saveProgress({
            measurementId: measurement._id!,
            requestedAt: requestedAt,
            cursor: workedOut,
          });

          if (!isSaved) {
            logAskedForAgain({ domain: domain, measurement: measurement });
          }
        }

        return WalkEnd.AtDeadline;
      }

      try {
        await domain.recompute(entity.id);
      } catch (err) {
        /*
         * One unreadable entity must not stall the cursor behind it, or the
         * whole project stops converging on a single bad row.
         */
        logger.error(err);
      }

      workedOut = entity;
    }

    // The last entity of the page: where the next page starts.
    const last: MeasurementBackfillCursor | undefined =
      entities[entities.length - 1];

    /*
     * A page short of full is the end of the project: its completion is
     * written even past the deadline, since the page is worked out.
     */
    if (!last || entities.length < PAGE_SIZE) {
      const isCompleted: boolean = await domain.saveProgress({
        measurementId: measurement._id!,
        requestedAt: requestedAt,
        cursor: last,
        completedAt: OneUptimeDate.getCurrentDate(),
      });

      if (!isCompleted) {
        logAskedForAgain({ domain: domain, measurement: measurement });
      }

      return WalkEnd.Done;
    }

    /*
     * A full page: the next starts after its last entity. Each page starts
     * after the one before it, so the walk moves on through any run of
     * entities that share one createdAt, however long, and a page may end
     * anywhere in it.
     */
    cursor = last;

    const isSaved: boolean = await domain.saveProgress({
      measurementId: measurement._id!,
      requestedAt: requestedAt,
      cursor: last,
    });

    if (!isSaved) {
      logAskedForAgain({ domain: domain, measurement: measurement });
      return WalkEnd.Done;
    }
  }

  // The per-run page cap: the next tick goes on from the cursor saved.
  return WalkEnd.Done;
};

type GetStartingCursorFunction = (data: {
  createdAt: Date;
  id?: ObjectID | undefined;
  stored?: MeasurementBackfillStoredCursor | undefined;
}) => MeasurementBackfillPageAfter;

/*
 * The cursor a walk starts after, as findMeasurements read it, with its
 * createdAt to the microsecond when the cursor read so (readExactCursors) is
 * that same cursor: the same entity, the same millisecond. Another - the
 * cursor moved on or was cleared between the two reads - is not mixed in:
 * one entity's createdAt with another's id would start the walk in the
 * wrong place. The walk then goes on from the millisecond, as before #8388.
 */
const getStartingCursor: GetStartingCursorFunction = (data: {
  createdAt: Date;
  id?: ObjectID | undefined;
  stored?: MeasurementBackfillStoredCursor | undefined;
}): MeasurementBackfillPageAfter => {
  const isSameCursor: boolean = Boolean(
    data.id &&
      data.stored &&
      data.stored.id === data.id.toString().toLowerCase() &&
      isExactTimestampOf(data.stored.exactCreatedAt, data.createdAt),
  );

  return {
    createdAt: data.createdAt,
    exactCreatedAt: isSameCursor ? data.stored!.exactCreatedAt : undefined,
    id: data.id,
  };
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
