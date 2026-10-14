import Entities from "../../../Models/DatabaseModels/Index";
import { MonitorFeedEventType } from "../../../Models/DatabaseModels/MonitorFeed";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSiteStatusTimelineService, {
  NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE,
} from "../../../Server/Services/NetworkSiteStatusTimelineService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DeleteManyBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/DeleteManyBaseModel";
import { RunReturnType } from "../../../Server/Types/Workflow/ComponentCode";
import StateTimelineRowsKept, {
  BoundRowsKept,
} from "../../../Server/Utils/Database/StateTimelineRowsKept";
import logger from "../../../Server/Utils/Logger";
import {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  ONLY_STATUS_EVENT_MESSAGE,
} from "../../../Utils/Monitor/MonitorStatusEventDelete";
import MonitorStatusTimelineReconciler, {
  RESTORE_GRACE_PERIOD_IN_MINUTES,
  RESTORED_STATUS_EVENT_ROOT_CAUSE,
  RestoreMissingStatusTimelinesResult,
} from "../../../Server/Utils/Monitor/MonitorStatusTimelineReconciler";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import {
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource, Logger as QueryLogger } from "typeorm";

/*
 * A DELETE BY QUERY OF A STATE TIMELINE LEAVES WHAT READERS STILL DRAW,
 * AGAINST POSTGRES.
 *
 * A status page paints a monitor gray wherever its status timeline has no
 * row: OneUptime Cloud's old retention purge (every row whose start was 120
 * days old, December 2023 to March 2025) emptied the timeline of every
 * monitor that had been Operational for that long, and turned it gray for
 * good. These run the services' real paths on real rows:
 *
 *   - OneUptime's own purge (hardDeleteBy and deleteBy as root, the
 *     retention job's call and loop): each monitor keeps its current status
 *     and every row that covers part of the last 90 days - a monitor up for
 *     a year keeps its one row, one that changed 20 days ago keeps the row
 *     before the change - while history over before that goes, other
 *     projects' rows included only as the query says;
 *   - a window smaller than the rows kept: the loop still reaches every row
 *     it may take, in a statement count that does not grow with monitors;
 *   - a workflow's Delete Many, as the project admin a step acts as: the
 *     same rows stay, and the run's log says how many and why;
 *   - one event deleted by its id: the event before it runs on over its
 *     time, with no overlap; the only event, and the oldest one while it
 *     covers part of the last 90 days, are refused;
 *   - the readers after a purge: the status page's day buckets, the merged
 *     downtime of a group and the overview's rolling windows read the same,
 *     and a one-row monitor is covered all day, every day;
 *   - the condition itself, at its boundaries: an open row, a closed row
 *     ending just before and just after the oldest moment kept, ties, an
 *     orphaned open row, a row deleted before;
 *   - the network site status timeline, the same way, and refusing one
 *     event by its id that a delete by query would keep;
 *   - incident, alert, scheduled maintenance and episode state timelines:
 *     each record keeps its current state;
 *   - the repair of monitors already emptied: their current status recorded
 *     again, from the last status change their feed records, once, however
 *     many runs at the same time.
 *
 * Opt in with RUN_POSTGRES_STATE_TIMELINE_KEEP_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_STATE_TIMELINE_KEEP_TESTS=true \
 *   STATE_TIMELINE_KEEP_TEST_DATABASE_HOST=127.0.0.1 \
 *   STATE_TIMELINE_KEEP_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StateTimelineRowsKeptPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions, and the foreign keys between them, are copied from
 * public into a uniquely named schema that is dropped afterwards; every row
 * is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_STATE_TIMELINE_KEEP_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * The incident-like timelines are cloned without their records: no foreign
 * key is copied to a table that is not, so their rows name records by any
 * id, and what a purge keeps is all that is asked.
 */
const TABLES: Array<string> = [
  "Project",
  "MonitorStatus",
  "Monitor",
  "MonitorStatusTimeline",
  "MonitorFeed",
  "NetworkSite",
  "NetworkSiteStatusTimeline",
  "IncidentStateTimeline",
  "AlertStateTimeline",
  "ScheduledMaintenanceStateTimeline",
  "IncidentEpisodeStateTimeline",
  "AlertEpisodeStateTimeline",
];

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

interface EventRow {
  _id: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

interface IncidentLikeTimeline {
  tableName: string;
  service: DatabaseService<any>;
  parentColumn: string;
  stateColumn: string;
}

const INCIDENT_LIKE_TIMELINES: Array<IncidentLikeTimeline> = [
  {
    tableName: "IncidentStateTimeline",
    service: IncidentStateTimelineService,
    parentColumn: "incidentId",
    stateColumn: "incidentStateId",
  },
  {
    tableName: "AlertStateTimeline",
    service: AlertStateTimelineService,
    parentColumn: "alertId",
    stateColumn: "alertStateId",
  },
  {
    tableName: "ScheduledMaintenanceStateTimeline",
    service: ScheduledMaintenanceStateTimelineService,
    parentColumn: "scheduledMaintenanceId",
    stateColumn: "scheduledMaintenanceStateId",
  },
  {
    tableName: "IncidentEpisodeStateTimeline",
    service: IncidentEpisodeStateTimelineService,
    parentColumn: "incidentEpisodeId",
    stateColumn: "incidentStateId",
  },
  {
    tableName: "AlertEpisodeStateTimeline",
    service: AlertEpisodeStateTimelineService,
    parentColumn: "alertEpisodeId",
    stateColumn: "alertStateId",
  },
];

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Ends a purge loop that does not end, instead of hanging the suite.
const MAX_PURGE_CALLS: number = 50;

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(Date.now() - days * DAY_IN_MS);
};

const sorted: (ids: Array<string>) => Array<string> = (
  ids: Array<string>,
): Array<string> => {
  return [...ids].sort();
};

function tenantPermission(
  projectId: ObjectID,
  permission: Permission,
): UserTenantAccessPermission {
  return {
    projectId: projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
}

// A project admin, as a person in the Dashboard or an API key acts.
function projectAdmin(projectId: string): DatabaseCommonInteractionProps {
  const project: ObjectID = new ObjectID(projectId);

  return {
    tenantId: project,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId]: tenantPermission(project, Permission.ProjectAdmin),
    },
  };
}

describePostgres(
  "a delete by query of a state timeline leaves what readers still draw, on Postgres",
  () => {
    const schema: string = `state_timeline_keep_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    // The statements sent while a count runs (counted), or null.
    let statements: Array<string> | null = null;

    const queryCounter: QueryLogger = {
      logQuery: (sql: string): void => {
        statements?.push(sql);
      },
      logQueryError: (): void => {
        return undefined;
      },
      logQuerySlow: (): void => {
        return undefined;
      },
      logSchemaBuild: (): void => {
        return undefined;
      },
      logMigration: (): void => {
        return undefined;
      },
      log: (): void => {
        return undefined;
      },
    };

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    // What a call sent, statement by statement.
    const counted: <T>(
      work: () => Promise<T>,
    ) => Promise<{ result: T; statements: Array<string> }> = async <T>(
      work: () => Promise<T>,
    ): Promise<{ result: T; statements: Array<string> }> => {
      const sent: Array<string> = [];
      statements = sent;

      try {
        return { result: await work(), statements: sent };
      } finally {
        statements = null;
      }
    };

    const addProject: () => Promise<string> = async (): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1)`,
        [id, `Keep ${id}`, `keep-${id}`],
      );

      return id;
    };

    const addStatus: (data: {
      projectId: string;
      name: string;
      isOperationalState?: boolean | undefined;
      isOfflineState?: boolean | undefined;
    }) => Promise<string> = async (data: {
      projectId: string;
      name: string;
      isOperationalState?: boolean | undefined;
      isOfflineState?: boolean | undefined;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState", "version") VALUES ($1, $2, $3, $4, '#00ff00', 1, $5, $6, 1)`,
        [
          id,
          data.projectId,
          data.name,
          `${data.name.toLowerCase()}-${id}`,
          Boolean(data.isOperationalState),
          Boolean(data.isOfflineState),
        ],
      );

      return id;
    };

    interface Project {
      projectId: string;
      operational: string;
      offline: string;
      degraded: string;
    }

    const addProjectWithStatuses: () => Promise<Project> =
      async (): Promise<Project> => {
        const projectId: string = await addProject();

        return {
          projectId: projectId,
          operational: await addStatus({
            projectId,
            name: "Operational",
            isOperationalState: true,
          }),
          offline: await addStatus({
            projectId,
            name: "Offline",
            isOfflineState: true,
          }),
          degraded: await addStatus({ projectId, name: "Degraded" }),
        };
      };

    const addMonitor: (data: {
      projectId: string;
      currentMonitorStatusId: string;
      createdAt?: Date | undefined;
      deletedAt?: Date | undefined;
    }) => Promise<string> = async (data: {
      projectId: string;
      currentMonitorStatusId: string;
      createdAt?: Date | undefined;
      deletedAt?: Date | undefined;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "createdAt", "deletedAt", "version") VALUES ($1, $2, $3, $4, 'Manual', $5, $6, $7, 1)`,
        [
          id,
          data.projectId,
          `Monitor ${id}`,
          `monitor-${id}`,
          data.currentMonitorStatusId,
          data.createdAt || daysAgo(400),
          data.deletedAt || null,
        ],
      );

      return id;
    };

    // One status event of a monitor; endsAt null is open.
    const addEvent: (data: {
      projectId: string;
      monitorId: string;
      statusId: string;
      startsAt: Date | null;
      endsAt: Date | null;
      deletedAt?: Date | undefined;
    }) => Promise<string> = async (data: {
      projectId: string;
      monitorId: string;
      statusId: string;
      startsAt: Date | null;
      endsAt: Date | null;
      deletedAt?: Date | undefined;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt", "deletedAt", "isOwnerNotified", "version") VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 1)`,
        [
          id,
          data.projectId,
          data.monitorId,
          data.statusId,
          data.startsAt,
          data.endsAt,
          data.deletedAt || null,
        ],
      );

      return id;
    };

    /*
     * A monitor and its timeline, one event per span: [start, end) in days
     * ago, the last one open unless it says where it ends.
     */
    const addMonitorWithTimeline: (data: {
      project: Project;
      spans: Array<{ statusId: string; from: number; to: number | null }>;
    }) => Promise<{
      monitorId: string;
      eventIds: Array<string>;
    }> = async (data: {
      project: Project;
      spans: Array<{ statusId: string; from: number; to: number | null }>;
    }): Promise<{ monitorId: string; eventIds: Array<string> }> => {
      const last: { statusId: string } = data.spans[data.spans.length - 1]!;

      const monitorId: string = await addMonitor({
        projectId: data.project.projectId,
        currentMonitorStatusId: last.statusId,
      });

      const eventIds: Array<string> = [];

      for (const span of data.spans) {
        eventIds.push(
          await addEvent({
            projectId: data.project.projectId,
            monitorId: monitorId,
            statusId: span.statusId,
            startsAt: daysAgo(span.from),
            endsAt: span.to === null ? null : daysAgo(span.to),
          }),
        );
      }

      return { monitorId, eventIds };
    };

    // A monitor's live events, oldest first.
    const eventsOf: (monitorId: string) => Promise<Array<EventRow>> = async (
      monitorId: string,
    ): Promise<Array<EventRow>> => {
      return await query(
        `SELECT "_id", "startsAt", "endsAt" FROM "${schema}"."MonitorStatusTimeline" WHERE "monitorId" = $1 AND "deletedAt" IS NULL ORDER BY "startsAt" ASC, "endsAt" ASC NULLS LAST`,
        [monitorId],
      );
    };

    const eventIdsOf: (monitorId: string) => Promise<Array<string>> = async (
      monitorId: string,
    ): Promise<Array<string>> => {
      return (await eventsOf(monitorId)).map((row: EventRow): string => {
        return String(row._id);
      });
    };

    // The ids of a table's rows, deleted ones included.
    const idsIn: (table: string) => Promise<Set<string>> = async (
      table: string,
    ): Promise<Set<string>> => {
      const rows: Array<{ _id: string }> = await query(
        `SELECT "_id" FROM "${schema}"."${table}"`,
      );

      return new Set<string>(
        rows.map((row: { _id: string }): string => {
          return String(row._id);
        }),
      );
    };

    // OneUptime's retention purge, as HardDeleteOlderItemsInDatabase calls it.
    const purgeOlderThan: (
      service: DatabaseService<any>,
      column: string,
      days: number,
      limit?: number,
    ) => Promise<number> = async (
      service: DatabaseService<any>,
      column: string,
      days: number,
      limit: number = LIMIT_MAX,
    ): Promise<number> => {
      return await service.hardDeleteBy({
        query: {
          [column]: QueryHelper.lessThan(daysAgo(days)),
        },
        props: {
          isRoot: true,
        },
        limit: limit,
        skip: 0,
      });
    };

    // The job's loop: the call again, until a call removes nothing.
    const untilDone: (
      call: () => Promise<number>,
    ) => Promise<Array<number>> = async (
      call: () => Promise<number>,
    ): Promise<Array<number>> => {
      const removed: Array<number> = [];
      let deletedCount: number = 0;

      do {
        if (removed.length === MAX_PURGE_CALLS) {
          throw new Error(
            `The purge loop did not end after ${MAX_PURGE_CALLS} calls: ${removed.join(", ")}`,
          );
        }

        deletedCount = await call();
        removed.push(deletedCount);
      } while (deletedCount > 0);

      return removed;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["STATE_TIMELINE_KEEP_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["STATE_TIMELINE_KEEP_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["STATE_TIMELINE_KEEP_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
        logger: queryCounter,
      });
      await database.initialize();

      /*
       * The migrated foreign keys between the cloned tables, read before the
       * clones exist, so their definitions name the referenced tables
       * without a schema - and so resolve to the clones once copied.
       */
      const foreignKeys: Array<ForeignKeyRow> = await query(
        `SELECT t.relname AS "table",
                c.conname AS "name",
                pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
          WHERE n.nspname = 'public'
            AND c.contype = 'f'
            AND t.relname = ANY($1)
            AND r.relname = ANY($1)
          ORDER BY t.relname, c.conname`,
        [TABLES],
      );

      await query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const foreignKey of foreignKeys) {
        await query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            /REFERENCES public\./g,
            "REFERENCES ",
          )}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> = await query(
        "SELECT current_schema()",
      );
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const table of [...TABLES].reverse()) {
        await query(`DELETE FROM "${schema}"."${table}"`);
      }

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      for (const silenced of ["debug", "info", "warn"]) {
        getJestSpyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }

      // No workflow service, status page cache or network rollup is running here.
      for (const service of [
        MonitorStatusTimelineService,
        NetworkSiteStatusTimelineService,
        MonitorService,
        ...INCIDENT_LIKE_TIMELINES.map((timeline: IncidentLikeTimeline) => {
          return timeline.service;
        }),
      ]) {
        getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
      }

      getJestSpyOn(StatusPageOverviewCache, "afterDelete").mockResolvedValue(
        undefined,
      );
      getJestSpyOn(
        NetworkSiteService,
        "onMonitorStatusChanged",
      ).mockResolvedValue(undefined);
    });

    describe("OneUptime's own retention purge of monitor status events", () => {
      test("keeps the one row of a monitor operational for a year, which the old 120 day purge deleted", async () => {
        const project: Project = await addProjectWithStatuses();
        const upForAYear: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([0]);

        expect(await eventIdsOf(upForAYear.monitorId)).toEqual(
          upForAYear.eventIds,
        );
      });

      test("keeps the row before a change inside the last 90 days, so the bars before it stay green", async () => {
        const project: Project = await addProjectWithStatuses();

        // Operational for a year, Offline for a day 20 days ago, Operational since.
        const changedLately: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 365, to: 20 },
              { statusId: project.offline, from: 20, to: 19 },
              { statusId: project.operational, from: 19, to: null },
            ],
          });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([0]);

        expect(await eventIdsOf(changedLately.monitorId)).toEqual(
          changedLately.eventIds,
        );
      });

      test("takes the history that ended before the last 90 days, and nothing after it", async () => {
        const project: Project = await addProjectWithStatuses();

        const longHistory: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 400, to: 300 },
              { statusId: project.degraded, from: 300, to: 200 },
              { statusId: project.operational, from: 200, to: 100 },
              { statusId: project.offline, from: 100, to: null },
            ],
          });

        // Three rows started more than 120 days ago and all three ended before the last 90 days.
        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([3, 0]);

        expect(await eventIdsOf(longHistory.monitorId)).toEqual([
          longHistory.eventIds[3]!,
        ]);
      });

      test("keeps the row in effect 90 days ago, which a purge by start would take", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.offline, from: 300, to: 200 },
              // Started 200 days ago and ran until 60 days ago: it covers days 90 to 60.
              { statusId: project.operational, from: 200, to: 60 },
              { statusId: project.degraded, from: 60, to: null },
            ],
          });

        expect(
          await untilDone(() => {
            return purgeOlderThan(MonitorStatusTimelineService, "startsAt", 30);
          }),
        ).toEqual([1, 0]);

        expect(await eventIdsOf(monitor.monitorId)).toEqual(
          monitor.eventIds.slice(1),
        );
      });

      test("never takes a monitor's newest row, even one closed long ago", async () => {
        const project: Project = await addProjectWithStatuses();

        // A closed newest row, as an API write can leave: the monitor's only row.
        const closedNewest: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 300, to: 250 }],
          });

        const closedNewestAfterHistory: {
          monitorId: string;
          eventIds: Array<string>;
        } = await addMonitorWithTimeline({
          project,
          spans: [
            { statusId: project.offline, from: 500, to: 400 },
            { statusId: project.operational, from: 400, to: 350 },
          ],
        });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([1, 0]);

        expect(await eventIdsOf(closedNewest.monitorId)).toEqual(
          closedNewest.eventIds,
        );
        expect(await eventIdsOf(closedNewestAfterHistory.monitorId)).toEqual([
          closedNewestAfterHistory.eventIds[1]!,
        ]);
      });

      test("takes an orphaned open row the next row superseded long ago, and keeps one superseded lately", async () => {
        const project: Project = await addProjectWithStatuses();
        const monitorId: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
        });

        // Two racing writers left an open row behind; every reader caps it at the next row's start.
        const supersededLongAgo: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.offline,
          startsAt: daysAgo(500),
          endsAt: null,
        });
        const coversTheLast90Days: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.degraded,
          startsAt: daysAgo(400),
          endsAt: null,
        });
        const current: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.operational,
          startsAt: daysAgo(10),
          endsAt: null,
        });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([1, 0]);

        expect(await eventIdsOf(monitorId)).toEqual([
          coversTheLast90Days,
          current,
        ]);
        expect(
          (await idsIn("MonitorStatusTimeline")).has(supersededLongAgo),
        ).toBe(false);
      });

      test("on a tie at the newest start, keeps the open row and takes the zero-length one", async () => {
        const project: Project = await addProjectWithStatuses();
        const monitorId: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
        });

        const tieStart: Date = daysAgo(200);

        // closePrecedingStatusTimeline closes the old row at zero length on a backfill tie.
        const zeroLength: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.offline,
          startsAt: tieStart,
          endsAt: tieStart,
        });
        const open: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.operational,
          startsAt: tieStart,
          endsAt: null,
        });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([1, 0]);

        expect(await eventIdsOf(monitorId)).toEqual([open]);
        expect((await idsIn("MonitorStatusTimeline")).has(zeroLength)).toBe(
          false,
        );
      });

      test("purges rows deleted before, as the soft delete sweep does, and a deleted row keeps no other row", async () => {
        const project: Project = await addProjectWithStatuses();
        const monitorId: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
        });

        const live: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.operational,
          startsAt: daysAgo(300),
          endsAt: null,
        });
        // Deleted 40 days ago and newer than the live row: no reader sees it.
        const deletedBefore: string = await addEvent({
          projectId: project.projectId,
          monitorId,
          statusId: project.offline,
          startsAt: daysAgo(100),
          endsAt: null,
          deletedAt: daysAgo(40),
        });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "deletedAt",
              30,
            );
          }),
        ).toEqual([1, 0]);

        const left: Set<string> = await idsIn("MonitorStatusTimeline");
        expect(left.has(deletedBefore)).toBe(false);
        expect(left.has(live)).toBe(true);
      });

      test("deleteBy, as OneUptime, leaves the same rows hardDeleteBy does", async () => {
        const project: Project = await addProjectWithStatuses();

        const upForAYear: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });
        const longHistory: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 400, to: 300 },
              { statusId: project.degraded, from: 300, to: 60 },
              { statusId: project.operational, from: 60, to: null },
            ],
          });

        expect(
          await untilDone(() => {
            return MonitorStatusTimelineService.deleteBy({
              query: {
                startsAt: QueryHelper.lessThan(daysAgo(120)),
              },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            });
          }),
        ).toEqual([1, 0]);

        expect(await eventIdsOf(upForAYear.monitorId)).toEqual(
          upForAYear.eventIds,
        );
        expect(await eventIdsOf(longHistory.monitorId)).toEqual(
          longHistory.eventIds.slice(1),
        );
      });

      test("takes only the project the query names: another project's old rows stay", async () => {
        const project: Project = await addProjectWithStatuses();
        const otherProject: Project = await addProjectWithStatuses();

        const spans: (p: Project) => Array<{
          statusId: string;
          from: number;
          to: number | null;
        }> = (p: Project) => {
          return [
            { statusId: p.operational, from: 400, to: 300 },
            { statusId: p.offline, from: 300, to: null },
          ];
        };

        const ours: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({ project, spans: spans(project) });
        const theirs: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project: otherProject,
            spans: spans(otherProject),
          });

        await MonitorStatusTimelineService.deleteBy({
          query: {
            projectId: new ObjectID(project.projectId),
            startsAt: QueryHelper.lessThan(daysAgo(120)),
          },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        });

        expect(await eventIdsOf(ours.monitorId)).toEqual([ours.eventIds[1]!]);
        expect(await eventIdsOf(theirs.monitorId)).toEqual(theirs.eventIds);
      });
    });

    describe("many monitors and a small window", () => {
      test("the loop still reaches every row it may take, and a call's statements do not grow with the monitors", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitors: Array<{ monitorId: string; eventIds: Array<string> }> =
          [];

        // 30 monitors: three rows over long ago, a row in effect 90 days ago, and the current one.
        for (let index: number = 0; index < 30; index++) {
          monitors.push(
            await addMonitorWithTimeline({
              project,
              spans: [
                { statusId: project.operational, from: 500 + index, to: 450 },
                { statusId: project.offline, from: 450, to: 400 },
                { statusId: project.operational, from: 400, to: 350 },
                // Started 350 days ago - matched by the purge - and still in effect 80 days ago.
                { statusId: project.degraded, from: 350, to: 80 },
                { statusId: project.operational, from: 80, to: null },
              ],
            }),
          );
        }

        /*
         * A window of 10, smaller than the 30 rows the purge matches and must
         * keep: those never take a place in it, so every call removes 10.
         */
        const calls: Array<{ result: number; statements: Array<string> }> = [];

        do {
          if (calls.length === MAX_PURGE_CALLS) {
            throw new Error("The purge loop did not end.");
          }

          calls.push(
            await counted(() => {
              return purgeOlderThan(
                MonitorStatusTimelineService,
                "startsAt",
                120,
                10,
              );
            }),
          );
        } while (calls[calls.length - 1]!.result > 0);

        expect(
          calls.map((call: { result: number }): number => {
            return call.result;
          }),
        ).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 0]);

        for (const monitor of monitors) {
          expect(await eventIdsOf(monitor.monitorId)).toEqual(
            monitor.eventIds.slice(3),
          );
        }

        // One read and one DELETE a call, whatever the number of monitors.
        const statementCounts: Set<number> = new Set<number>(
          calls.slice(0, -1).map((call: { statements: Array<string> }) => {
            return call.statements.length;
          }),
        );
        expect(statementCounts.size).toBe(1);
        expect(Array.from(statementCounts)[0]!).toBeLessThanOrEqual(6);
      });
    });

    describe("a workflow's Delete Many, as the project admin a step acts as", () => {
      test("takes the history that is over, leaves the rest, and says in the run's log how many stayed and why", async () => {
        const project: Project = await addProjectWithStatuses();

        const upForAYear: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });
        const longHistory: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 400, to: 300 },
              { statusId: project.degraded, from: 300, to: 200 },
              { statusId: project.operational, from: 200, to: 20 },
              { statusId: project.offline, from: 20, to: null },
            ],
          });

        const logs: Array<string> = [];
        const component: DeleteManyBaseModel<MonitorStatusTimeline> =
          new DeleteManyBaseModel<MonitorStatusTimeline>(
            MonitorStatusTimelineService,
          );

        // Delete every status event that started more than 30 days ago, up to 100.
        const result: RunReturnType = await component.run(
          {
            query: JSONFunctions.serialize({
              startsAt: new LessThan(daysAgo(30)),
            }),
            limit: 100,
          },
          {
            log: (item: unknown): void => {
              logs.push(String(item));
            },
            workflowLogId: ObjectID.generate(),
            workflowId: ObjectID.generate(),
            workflowName: "Clean up status history",
            projectId: new ObjectID(project.projectId),
            onError: (exception: Exception): Exception => {
              return exception;
            },
            executeWorkflow: async (): Promise<void> => {},
          },
        );

        expect(result.executePort?.id).toBe("success");
        expect(result.returnValues["items-deleted"]).toBe(2);

        expect(await eventIdsOf(upForAYear.monitorId)).toEqual(
          upForAYear.eventIds,
        );
        expect(await eventIdsOf(longHistory.monitorId)).toEqual(
          longHistory.eventIds.slice(2),
        );

        // The year-long row and the row before the change 20 days ago matched and stayed.
        expect(logs).toEqual([
          "Deleted 2 Monitor Status Event(s).",
          "Kept 2 Monitor Status Events, because some always stay: each monitor's current status, and every status event that covers part of the last 90 days, so status pages never show a monitor gray. To delete one particular Monitor Status Event, query it by its ID.",
        ]);
      });

      test("a teammate's delete of every event of a monitor leaves its current status and its last 90 days", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 400, to: 300 },
              { statusId: project.offline, from: 300, to: 50 },
              { statusId: project.operational, from: 50, to: null },
            ],
          });

        const removed: number = await MonitorStatusTimelineService.deleteBy({
          query: {
            monitorId: new ObjectID(monitor.monitorId),
          },
          props: projectAdmin(project.projectId),
          limit: 100,
          skip: 0,
        });

        expect(removed).toBe(1);
        expect(await eventIdsOf(monitor.monitorId)).toEqual(
          monitor.eventIds.slice(1),
        );

        // What the run's log counts: the rows the same query still names that stay.
        expect(
          await MonitorStatusTimelineService.countRowsKeptOnDeleteByQuery({
            query: {
              monitorId: new ObjectID(monitor.monitorId),
            },
            props: projectAdmin(project.projectId),
          }),
        ).toBe(2);
      });
    });

    describe("one status event deleted by its id", () => {
      test("in the middle: the event before it runs on to the next one's start, which stays where it was", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 10, to: 3 },
              { statusId: project.offline, from: 3, to: 2 },
              { statusId: project.operational, from: 2, to: null },
            ],
          });

        const before: Array<EventRow> = await eventsOf(monitor.monitorId);

        await MonitorStatusTimelineService.deleteOneById({
          id: new ObjectID(monitor.eventIds[1]!),
          props: projectAdmin(project.projectId),
        });

        const after: Array<EventRow> = await eventsOf(monitor.monitorId);

        expect(
          after.map((row: EventRow): string => {
            return String(row._id);
          }),
        ).toEqual([monitor.eventIds[0]!, monitor.eventIds[2]!]);

        // No overlap: the first runs up to where the last one starts, and the last one has not moved.
        expect(new Date(after[0]!.endsAt!).getTime()).toBe(
          new Date(before[2]!.startsAt!).getTime(),
        );
        expect(new Date(after[1]!.startsAt!).getTime()).toBe(
          new Date(before[2]!.startsAt!).getTime(),
        );
        expect(after[1]!.endsAt).toBeNull();
      });

      test("the newest: the event before it is the current status again, on the monitor too", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 10, to: 1 },
              { statusId: project.offline, from: 1, to: null },
            ],
          });

        await MonitorStatusTimelineService.deleteOneById({
          id: new ObjectID(monitor.eventIds[1]!),
          props: projectAdmin(project.projectId),
        });

        const after: Array<EventRow> = await eventsOf(monitor.monitorId);
        expect(
          after.map((row: EventRow): string => {
            return String(row._id);
          }),
        ).toEqual([monitor.eventIds[0]!]);
        expect(after[0]!.endsAt).toBeNull();

        const monitors: Array<{ currentMonitorStatusId: string }> = await query(
          `SELECT "currentMonitorStatusId" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
          [monitor.monitorId],
        );
        expect(String(monitors[0]!.currentMonitorStatusId)).toBe(
          project.operational,
        );
      });

      test("the only one: refused, and nothing changes", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });

        await expect(
          MonitorStatusTimelineService.deleteOneById({
            id: new ObjectID(monitor.eventIds[0]!),
            props: projectAdmin(project.projectId),
          }),
        ).rejects.toThrow(ONLY_STATUS_EVENT_MESSAGE);

        expect(await eventIdsOf(monitor.monitorId)).toEqual(monitor.eventIds);
      });

      test("the oldest, while it covers part of the last 90 days: refused, and nothing changes", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 365, to: 20 },
              { statusId: project.offline, from: 20, to: null },
            ],
          });

        await expect(
          MonitorStatusTimelineService.deleteOneById({
            id: new ObjectID(monitor.eventIds[0]!),
            props: projectAdmin(project.projectId),
          }),
        ).rejects.toThrow(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE);

        expect(await eventIdsOf(monitor.monitorId)).toEqual(monitor.eventIds);
      });

      test("the oldest, over before the last 90 days: deleted, and no other event moves", async () => {
        const project: Project = await addProjectWithStatuses();

        const monitor: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 365, to: 100 },
              { statusId: project.offline, from: 100, to: null },
            ],
          });

        const before: Array<EventRow> = await eventsOf(monitor.monitorId);

        await MonitorStatusTimelineService.deleteOneById({
          id: new ObjectID(monitor.eventIds[0]!),
          props: projectAdmin(project.projectId),
        });

        const after: Array<EventRow> = await eventsOf(monitor.monitorId);
        expect(after).toEqual([before[1]!]);
      });
    });

    describe("what the readers show after a purge", () => {
      test("the day buckets, a group's merged downtime and the rolling windows read the same, and a one-row monitor is covered every day", async () => {
        const project: Project = await addProjectWithStatuses();

        const upForAYear: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });
        const changedLately: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [
              { statusId: project.operational, from: 400, to: 300 },
              { statusId: project.offline, from: 300, to: 200 },
              { statusId: project.operational, from: 200, to: 20 },
              { statusId: project.offline, from: 20, to: 19 },
              { statusId: project.operational, from: 19, to: null },
            ],
          });

        const monitorIds: Array<ObjectID> = [
          new ObjectID(upForAYear.monitorId),
          new ObjectID(changedLately.monitorId),
        ];

        // One window for both reads, so they are read alike.
        const endDate: Date = new Date();
        const startDate: Date = daysAgo(89);

        const read: () => Promise<{
          aggregate: UptimeDailyAggregate;
          merged: MergedDowntimeTotals;
          rolling: Array<MonitorUptimeWindowTotal>;
        }> = async () => {
          return {
            aggregate:
              await MonitorStatusTimelineService.getDailyUptimeAggregate({
                monitorIds: monitorIds,
                startDate: startDate,
                endDate: endDate,
                timezone: "UTC",
              }),
            merged: await MonitorStatusTimelineService.getMergedDowntimeSeconds(
              {
                monitorIds: monitorIds,
                downtimeMonitorStatusIds: [project.offline],
                startDate: startDate,
                endDate: endDate,
              },
            ),
            rolling: await MonitorStatusTimelineService.getRollingUptimeTotals({
              monitorId: new ObjectID(changedLately.monitorId),
              windows: [
                {
                  key: MonitorUptimeWindowKey.Last24Hours,
                  startDate: new Date(endDate.getTime() - DAY_IN_MS),
                },
                {
                  key: MonitorUptimeWindowKey.Last30Days,
                  startDate: new Date(endDate.getTime() - 30 * DAY_IN_MS),
                },
              ],
              endDate: endDate,
            }),
          };
        };

        // The day buckets' coverage, a day's seconds apart from "now".
        const coverage: (aggregate: UptimeDailyAggregate) => Array<string> = (
          aggregate: UptimeDailyAggregate,
        ): Array<string> => {
          return aggregate.monitors.flatMap(
            (monitor: MonitorUptimeDailyAggregate) => {
              return monitor.buckets
                .slice(0, -1)
                .map((bucket: UptimeDayBucket) => {
                  return `${monitor.monitorId.toString()} ${bucket.bucketStart.toISOString()} ${Math.round(bucket.coveredSeconds)}/${bucket.daySeconds}`;
                });
            },
          );
        };

        const before: {
          aggregate: UptimeDailyAggregate;
          merged: MergedDowntimeTotals;
          rolling: Array<MonitorUptimeWindowTotal>;
        } = await read();

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              MonitorStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([2, 0]);

        const after: {
          aggregate: UptimeDailyAggregate;
          merged: MergedDowntimeTotals;
          rolling: Array<MonitorUptimeWindowTotal>;
        } = await read();

        // Every whole day of both monitors is covered, before the purge and after it.
        for (const line of coverage(after.aggregate)) {
          const [covered, day] = line.split(" ")[2]!.split("/");
          expect(Number(covered)).toBe(Number(day));
        }
        expect(coverage(after.aggregate)).toEqual(coverage(before.aggregate));

        expect(after.merged.downtimeSeconds).toBeCloseTo(
          before.merged.downtimeSeconds,
          0,
        );
        expect(after.merged.coveredSeconds).toBeCloseTo(
          before.merged.coveredSeconds,
          0,
        );
        // The Offline day 20 days ago is still downtime.
        expect(after.merged.downtimeSeconds).toBeGreaterThan(86000);

        expect(
          after.rolling.map((window: MonitorUptimeWindowTotal) => {
            return Math.round(window.coveredSeconds);
          }),
        ).toEqual(
          before.rolling.map((window: MonitorUptimeWindowTotal) => {
            return Math.round(window.coveredSeconds);
          }),
        );
      });
    });

    describe("the condition itself, at its boundaries", () => {
      test("keeps exactly the rows a reader of the last 90 days needs, read by Postgres", async () => {
        const project: Project = await addProjectWithStatuses();
        const monitorId: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
        });

        const now: Date = new Date();
        const keptFrom: Date = new Date(now.getTime() - 90 * DAY_IN_MS);
        const justBefore: Date = new Date(keptFrom.getTime() - 1000);
        const justAfter: Date = new Date(keptFrom.getTime() + 1000);

        const add: (
          startsAt: Date | null,
          endsAt: Date | null,
          deletedAt?: Date,
        ) => Promise<string> = (
          startsAt: Date | null,
          endsAt: Date | null,
          deletedAt?: Date,
        ): Promise<string> => {
          return addEvent({
            projectId: project.projectId,
            monitorId,
            statusId: project.operational,
            startsAt,
            endsAt,
            deletedAt,
          });
        };

        const endsJustBefore: string = await add(daysAgo(200), justBefore);
        const endsAtTheBoundary: string = await add(justBefore, keptFrom);
        const endsJustAfter: string = await add(keptFrom, justAfter);
        const orphanSupersededInside: string = await add(justAfter, null);
        const noStart: string = await add(null, null);
        const deleted: string = await add(daysAgo(30), daysAgo(20), daysAgo(1));
        const current: string = await add(daysAgo(10), null);

        const rule: BoundRowsKept = StateTimelineRowsKept.forTable(
          "MonitorStatusTimeline",
          {
            now: (): Date => {
              return now;
            },
          },
        ).bind();

        // The bound parameters, positionally, for a raw statement.
        const names: Array<string> = Object.keys(rule.parameters);
        let sql: string = rule.sqlForRowKept('"t"');
        names.forEach((name: string, index: number) => {
          sql = sql.split(`:${name}`).join(`$${index + 2}`);
        });

        const kept: Array<{ _id: string }> = await query(
          `SELECT "_id" FROM "${schema}"."MonitorStatusTimeline" AS "t" WHERE "t"."monitorId" = $1 AND ${sql}`,
          [
            monitorId,
            ...names.map((name: string) => {
              return rule.parameters[name];
            }),
          ],
        );

        expect(
          sorted(
            kept.map((row: { _id: string }): string => {
              return String(row._id);
            }),
          ),
        ).toEqual(
          sorted([endsJustAfter, orphanSupersededInside, noStart, current]),
        );

        // Over before the kept history: taken. Deleted before: never kept.
        expect(
          [endsJustBefore, endsAtTheBoundary, deleted].some((id: string) => {
            return kept
              .map((row: { _id: string }): string => {
                return String(row._id);
              })
              .includes(id);
          }),
        ).toBe(false);
      });
    });

    describe("the network site status timeline", () => {
      const addSite: (projectId: string) => Promise<string> = async (
        projectId: string,
      ): Promise<string> => {
        const id: string = ObjectID.generate().toString();

        await query(
          `INSERT INTO "${schema}"."NetworkSite" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, $3, $4, 1)`,
          [id, projectId, `Site ${id}`, `site-${id}`],
        );

        return id;
      };

      const addSiteEvent: (data: {
        projectId: string;
        siteId: string;
        statusId: string;
        from: number;
        to: number | null;
      }) => Promise<string> = async (data: {
        projectId: string;
        siteId: string;
        statusId: string;
        from: number;
        to: number | null;
      }): Promise<string> => {
        const id: string = ObjectID.generate().toString();

        await query(
          `INSERT INTO "${schema}"."NetworkSiteStatusTimeline" ("_id", "projectId", "siteId", "monitorStatusId", "startsAt", "endsAt", "version") VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [
            id,
            data.projectId,
            data.siteId,
            data.statusId,
            daysAgo(data.from),
            data.to === null ? null : daysAgo(data.to),
          ],
        );

        return id;
      };

      test("a purge keeps each site's current status and its last 90 days; one event by its id is held to the same rule", async () => {
        const project: Project = await addProjectWithStatuses();
        const siteId: string = await addSite(project.projectId);

        const over: string = await addSiteEvent({
          projectId: project.projectId,
          siteId,
          statusId: project.offline,
          from: 400,
          to: 300,
        });
        const alsoOver: string = await addSiteEvent({
          projectId: project.projectId,
          siteId,
          statusId: project.operational,
          from: 300,
          to: 200,
        });
        const inEffect: string = await addSiteEvent({
          projectId: project.projectId,
          siteId,
          statusId: project.offline,
          from: 200,
          to: 30,
        });
        const current: string = await addSiteEvent({
          projectId: project.projectId,
          siteId,
          statusId: project.operational,
          from: 30,
          to: null,
        });

        // One event by its id: refused while a delete by query would keep it.
        await expect(
          NetworkSiteStatusTimelineService.deleteOneById({
            id: new ObjectID(inEffect),
            props: projectAdmin(project.projectId),
          }),
        ).rejects.toThrow(NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE);
        await expect(
          NetworkSiteStatusTimelineService.deleteOneById({
            id: new ObjectID(current),
            props: projectAdmin(project.projectId),
          }),
        ).rejects.toThrow(NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE);

        // And deleted when it is over.
        await NetworkSiteStatusTimelineService.deleteOneById({
          id: new ObjectID(over),
          props: projectAdmin(project.projectId),
        });

        expect(
          await untilDone(() => {
            return purgeOlderThan(
              NetworkSiteStatusTimelineService,
              "startsAt",
              120,
            );
          }),
        ).toEqual([1, 0]);

        const left: Set<string> = await idsIn("NetworkSiteStatusTimeline");
        expect([
          left.has(over),
          left.has(alsoOver),
          left.has(inEffect),
          left.has(current),
        ]).toEqual([false, false, true, true]);
      });
    });

    describe.each(INCIDENT_LIKE_TIMELINES)(
      "$tableName",
      (timeline: IncidentLikeTimeline) => {
        const addEntry: (data: {
          projectId: string;
          parentId: string;
          startsAt: Date;
          endsAt: Date | null;
        }) => Promise<string> = async (data: {
          projectId: string;
          parentId: string;
          startsAt: Date;
          endsAt: Date | null;
        }): Promise<string> => {
          const id: string = ObjectID.generate().toString();

          await query(
            `INSERT INTO "${schema}"."${timeline.tableName}" ("_id", "projectId", "${timeline.parentColumn}", "${timeline.stateColumn}", "startsAt", "endsAt", "createdAt", "version") VALUES ($1, $2, $3, $4, $5, $6, $5, 1)`,
            [
              id,
              data.projectId,
              data.parentId,
              ObjectID.generate().toString(),
              data.startsAt,
              data.endsAt,
            ],
          );

          return id;
        };

        test("the 3 year purge, and a delete of every entry, keep each record's current state", async () => {
          const projectId: string = await addProject();
          const oldRecord: string = ObjectID.generate().toString();
          const otherRecord: string = ObjectID.generate().toString();

          const created: string = await addEntry({
            projectId,
            parentId: oldRecord,
            startsAt: daysAgo(1500),
            endsAt: daysAgo(1400),
          });
          const acknowledged: string = await addEntry({
            projectId,
            parentId: oldRecord,
            startsAt: daysAgo(1400),
            endsAt: daysAgo(1300),
          });
          const resolved: string = await addEntry({
            projectId,
            parentId: oldRecord,
            startsAt: daysAgo(1300),
            endsAt: null,
          });
          const onlyEntry: string = await addEntry({
            projectId,
            parentId: otherRecord,
            startsAt: daysAgo(1200),
            endsAt: null,
          });

          for (const column of ["startsAt", "createdAt"]) {
            await untilDone(() => {
              return purgeOlderThan(timeline.service, column, 3 * 365);
            });
          }

          let left: Set<string> = await idsIn(timeline.tableName);
          expect([
            left.has(created),
            left.has(acknowledged),
            left.has(resolved),
            left.has(onlyEntry),
          ]).toEqual([false, false, true, true]);

          // A delete of every entry of a record, as OneUptime: the current one stays.
          await timeline.service.deleteBy({
            query: { [timeline.parentColumn]: new ObjectID(otherRecord) },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          });

          left = await idsIn(timeline.tableName);
          expect(left.has(onlyEntry)).toBe(true);
        });
      },
    );

    describe("monitors left with no status timeline", () => {
      const addFeedItem: (data: {
        projectId: string;
        monitorId: string;
        postedAt: Date;
        type: MonitorFeedEventType;
      }) => Promise<void> = async (data: {
        projectId: string;
        monitorId: string;
        postedAt: Date;
        type: MonitorFeedEventType;
      }): Promise<void> => {
        await query(
          `INSERT INTO "${schema}"."MonitorFeed" ("_id", "projectId", "monitorId", "monitorFeedEventType", "feedInfoInMarkdown", "displayColor", "postedAt", "version") VALUES ($1, $2, $3, $4, 'Changed', '#000000', $5, 1)`,
          [
            ObjectID.generate().toString(),
            data.projectId,
            data.monitorId,
            data.type,
            data.postedAt,
          ],
        );
      };

      test("get their current status back as one open row, from their last recorded change, once", async () => {
        const project: Project = await addProjectWithStatuses();
        const otherProject: Project = await addProjectWithStatuses();

        // Emptied by the old purge: Operational, last changed 200 days ago.
        const emptied: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
          createdAt: daysAgo(700),
        });
        await addFeedItem({
          projectId: project.projectId,
          monitorId: emptied,
          postedAt: daysAgo(200),
          type: MonitorFeedEventType.MonitorStatusChanged,
        });
        // A newer feed item of another kind says nothing about its status.
        await addFeedItem({
          projectId: project.projectId,
          monitorId: emptied,
          postedAt: daysAgo(5),
          type: "OwnerUserAdded" as MonitorFeedEventType,
        });

        // Never got its first row, and no feed: from when it was created.
        const neverWritten: Date = daysAgo(30);
        const firstRowLost: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.offline,
          createdAt: neverWritten,
        });

        // Left alone: too new, deleted, has a row, a status of another project.
        const tooNew: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
          createdAt: new Date(
            Date.now() - (RESTORE_GRACE_PERIOD_IN_MINUTES - 5) * 60 * 1000,
          ),
        });
        const deletedMonitor: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.operational,
          deletedAt: daysAgo(1),
        });
        const hasARow: { monitorId: string; eventIds: Array<string> } =
          await addMonitorWithTimeline({
            project,
            spans: [{ statusId: project.operational, from: 365, to: null }],
          });
        const foreignStatus: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: otherProject.operational,
        });

        // Only a row deleted before: no status a reader sees.
        const onlyDeletedRows: string = await addMonitor({
          projectId: project.projectId,
          currentMonitorStatusId: project.degraded,
        });
        await addEvent({
          projectId: project.projectId,
          monitorId: onlyDeletedRows,
          statusId: project.degraded,
          startsAt: daysAgo(50),
          endsAt: null,
          deletedAt: daysAgo(2),
        });

        // Two runs at once, as two workers starting together.
        const runs: Array<RestoreMissingStatusTimelinesResult> =
          await Promise.all([
            MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({}),
            MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({}),
          ]);

        const restoredIds: Array<string> = runs.flatMap(
          (run: RestoreMissingStatusTimelinesResult) => {
            return run.restoredMonitorIds.map((id: ObjectID) => {
              return id.toString();
            });
          },
        );
        expect(sorted(restoredIds)).toEqual(
          sorted([emptied, firstRowLost, onlyDeletedRows]),
        );

        const rowOf: (monitorId: string) => Promise<Array<JSONObject>> = (
          monitorId: string,
        ): Promise<Array<JSONObject>> => {
          return query(
            `SELECT "monitorStatusId", "startsAt", "endsAt", "rootCause", "isOwnerNotified" FROM "${schema}"."MonitorStatusTimeline" WHERE "monitorId" = $1 AND "deletedAt" IS NULL`,
            [monitorId],
          );
        };

        const emptiedRows: Array<JSONObject> = await rowOf(emptied);
        expect(emptiedRows.length).toBe(1);
        expect(String(emptiedRows[0]!["monitorStatusId"])).toBe(
          project.operational,
        );
        expect(emptiedRows[0]!["endsAt"]).toBeNull();
        expect(emptiedRows[0]!["rootCause"]).toBe(
          RESTORED_STATUS_EVENT_ROOT_CAUSE,
        );
        expect(emptiedRows[0]!["isOwnerNotified"]).toBe(true);
        expect(
          Math.abs(
            new Date(emptiedRows[0]!["startsAt"] as string).getTime() -
              daysAgo(200).getTime(),
          ),
        ).toBeLessThan(60 * 1000);

        const firstRowLostRows: Array<JSONObject> = await rowOf(firstRowLost);
        expect(firstRowLostRows.length).toBe(1);
        expect(String(firstRowLostRows[0]!["monitorStatusId"])).toBe(
          project.offline,
        );
        expect(
          new Date(firstRowLostRows[0]!["startsAt"] as string).getTime(),
        ).toBe(neverWritten.getTime());

        for (const leftAlone of [tooNew, deletedMonitor, foreignStatus]) {
          expect(await rowOf(leftAlone)).toEqual([]);
        }
        expect(await eventIdsOf(hasARow.monitorId)).toEqual(hasARow.eventIds);

        // A second run restores nothing.
        expect(
          (
            await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines(
              {},
            )
          ).restored,
        ).toBe(0);

        // And the restored monitor is covered every day of the last 90 on the status page.
        const aggregate: UptimeDailyAggregate =
          await MonitorStatusTimelineService.getDailyUptimeAggregate({
            monitorIds: [new ObjectID(emptied)],
            startDate: daysAgo(89),
            endDate: new Date(),
            timezone: "UTC",
          });

        const buckets: Array<UptimeDayBucket> =
          aggregate.monitors[0]!.buckets.slice(0, -1);
        expect(buckets.length).toBeGreaterThan(80);
        for (const bucket of buckets) {
          expect(Math.round(bucket.coveredSeconds)).toBe(bucket.daySeconds);
        }
      });
    });
  },
);
