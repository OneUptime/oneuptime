import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import MeasurementMetricWriter from "../../../Server/Utils/Measurement/MeasurementMetricWriter";
import MonitorIncidentPause from "../../../Server/Utils/Monitor/MonitorIncidentPause";
import { fetchPerMonitorTimelines } from "../../../Server/Utils/Slo/SloMonitorTimelines";
import URL from "../../../Types/API/URL";
import {
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import SloUtil, { TimeSliResult } from "../../../Utils/Slo/SloUtil";
import { readStatusChangeNote } from "../../../Utils/Monitor/StatusChangeNotes";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT A MONITOR'S TIME COUNTS AS WHILE SCHEDULED MAINTENANCE PAUSES IT,
 * AGAINST POSTGRES (issue #11301).
 *
 * A scheduled maintenance event in progress pauses its monitors' checks
 * (Monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent). When
 * it puts them in a status of its own (Change Monitor Status to), that is
 * the status someone declared, and their time counts as it. When it puts
 * them in none, the status each keeps is only what its last check saw
 * before the pause, and it used to count for the whole event - a frozen
 * reading counted as up or down. That time is left out of uptime, status
 * pages and SLOs now, as #11141 leaves it out for an incident declared by
 * hand without a status: marked on the monitor's status timeline
 * (MonitorStatusTimeline.isMonitoringOff) from the start of the pause until
 * it ends or something puts a status on the monitor.
 *
 * The events start and end the way every start and end comes through: a
 * new row of the event's state timeline (the state timeline service's
 * onCreateSuccess), with real rows for the monitors, their status timelines,
 * the incidents declared by hand on them and the events. What is measured is
 * what each reader reads: the statement status pages read
 * (getMergedDowntimeSeconds), their day bars (getDailyUptimeAggregate), the
 * monitor's own uptime windows (getRollingUptimeTotals) and an SLO's SLI
 * (fetchPerMonitorTimelines, SloUtil.computeTimeSli).
 *
 * The real services run on real rows in a uniquely named schema holding
 * structure-only clones (LIKE ... INCLUDING ALL) of the tables they read and
 * write; the schema is dropped afterwards. Only the monitor's own update
 * hooks, the per-monitor lock (in memory), feed items, network sites,
 * measurements, chat channels and workflows are stubbed.
 *
 * Opt in with RUN_POSTGRES_MAINTENANCE_PAUSED_UPTIME_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MAINTENANCE_PAUSED_UPTIME_TESTS=true \
 *   MAINTENANCE_PAUSED_UPTIME_TEST_DATABASE_HOST=127.0.0.1 \
 *   MAINTENANCE_PAUSED_UPTIME_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MaintenancePausedTimeUptimePostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MAINTENANCE_PAUSED_UPTIME_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "MonitorStatus",
  "Monitor",
  "MonitorStatusTimeline",
  "IncidentState",
  "Incident",
  "IncidentMonitor",
  "ScheduledMaintenanceState",
  "ScheduledMaintenance",
  "ScheduledMaintenanceMonitor",
  "ScheduledMaintenanceStateTimeline",
  // An event is read with the network sites it holds too.
  "NetworkSite",
  "ScheduledMaintenanceNetworkSite",
  "DataMigrations",
];

const HOUR_MS: number = 60 * 60 * 1000;
const HOUR_SECONDS: number = 60 * 60;
// How far apart the database's clock and the test's may read one moment.
const SLACK_SECONDS: number = 30;

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
  createdItem: ScheduledMaintenanceStateTimeline,
) => Promise<ScheduledMaintenanceStateTimeline>;

type OnDeleteSuccessFunction = (
  onDelete: OnDelete<ScheduledMaintenance>,
  deletedItemIds: Array<ObjectID>,
) => Promise<OnDelete<ScheduledMaintenance>>;

interface TimelineRow {
  monitorStatusId: string;
  startsAt: Date;
  endsAt: Date | null;
  isMonitoringOff: boolean;
  rootCause: string | null;
}

function expectAbout(seconds: number, expected: number): void {
  expect(seconds).toBeGreaterThan(expected - SLACK_SECONDS);
  expect(seconds).toBeLessThan(expected + SLACK_SECONDS);
}

describePostgres(
  "What a monitor's time counts as while scheduled maintenance pauses it, on a migrated Postgres",
  () => {
    const schema: string = `maintenance_uptime_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let held: Set<string>;

    // A project of its own per test: the states a project has are kept per process.
    let projectId: ObjectID;
    let operationalStatusId: ObjectID;
    let offlineStatusId: ObjectID;
    let underMaintenanceStatusId: ObjectID;
    let identifiedStateId: ObjectID;
    let resolvedStateId: ObjectID;
    let scheduledStateId: ObjectID;
    let ongoingStateId: ObjectID;
    let verifyingStateId: ObjectID;
    let endedStateId: ObjectID;
    let completedStateId: ObjectID;
    let nextEventNumber: number;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MAINTENANCE_PAUSED_UPTIME_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MAINTENANCE_PAUSED_UPTIME_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MAINTENANCE_PAUSED_UPTIME_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    beforeEach(async () => {
      jest.restoreAllMocks();

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database as never,
      );

      held = new Set<string>();

      getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<{ name: string }> => {
        const name: string = `${data.namespace}-${data.key}`;

        if (held.has(name)) {
          throw new SemaphoreLockTimeoutError(`Acquire mutex ${name} timeout`);
        }

        held.add(name);
        return { name: name };
      }) as never);

      getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
        name: string;
      }): Promise<void> => {
        held.delete(mutex.name);
      }) as never);

      stubProjectDirectory({});
      stubReadableParents();

      // The monitor's own update hooks are about other writes.
      getJestSpyOn(
        MonitorService as never,
        "onBeforeUpdate",
      ).mockImplementation((async (updateBy: unknown) => {
        return { updateBy: updateBy, carryForward: null };
      }) as never);
      getJestSpyOn(
        MonitorService as never,
        "onUpdateSuccess",
      ).mockImplementation((async (onUpdate: unknown) => {
        return onUpdate;
      }) as never);

      // What a status change leads to once the lock is given back.
      getJestSpyOn(
        MonitorStatusTimelineService as never,
        "bridgeCurrentStatusToNetworkSites",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        MonitorStatusTimelineService as never,
        "createStatusChangeFeedItem",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      ).mockImplementation((async (
        _projectId: ObjectID,
        incidentId: ObjectID,
      ): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.example/incidents/${incidentId.toString()}`,
        );
      }) as never);
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      ).mockImplementation((async (
        _projectId: ObjectID,
        scheduledMaintenanceId: ObjectID,
      ): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.example/scheduled-maintenance/${scheduledMaintenanceId.toString()}`,
        );
      }) as never);

      // What an event's state change leads to besides its monitors.
      getJestSpyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        ScheduledMaintenanceMeasurementValueService,
        "recomputeForScheduledMaintenance",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        WorkspaceNotificationRuleService,
        "archiveWorkspaceChannels",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        ScheduledMaintenanceStateTimelineService,
        "recomputeNetworkSiteRollups",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        ScheduledMaintenanceService,
        "updateOneById",
      ).mockResolvedValue(undefined as never);

      // The event's current state follows its timeline: the column itself.
      getJestSpyOn(
        ScheduledMaintenanceService,
        "updateOneBy",
      ).mockImplementation((async (updateBy: {
        query: { _id: string };
        data: { currentScheduledMaintenanceStateId: ObjectID };
      }): Promise<number> => {
        await database.query(
          `UPDATE "ScheduledMaintenance" SET "currentScheduledMaintenanceStateId" = $2 WHERE "_id" = $1`,
          [
            updateBy.query._id.toString(),
            updateBy.data.currentScheduledMaintenanceStateId.toString(),
          ],
        );
        return 1;
      }) as never);

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      projectId = ObjectID.generate();
      nextEventNumber = 1;
      await seedProject();
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedProject(): Promise<void> {
      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "version")
       VALUES ($1, 'Maintenance uptime test', $2, 1)`,
        [projectId.toString(), `maintenance-uptime-${projectId.toString()}`],
      );

      operationalStatusId = await seedMonitorStatus({
        name: "Operational",
        priority: 0,
        isOperationalState: true,
      });
      underMaintenanceStatusId = await seedMonitorStatus({
        name: "Under Maintenance",
        priority: 1,
      });
      offlineStatusId = await seedMonitorStatus({
        name: "Offline",
        priority: 2,
        isOfflineState: true,
      });

      identifiedStateId = await seedRecordState("IncidentState", {
        name: "Identified",
        order: 1,
        flag: "isCreatedState",
      });
      resolvedStateId = await seedRecordState("IncidentState", {
        name: "Resolved",
        order: 3,
        flag: "isResolvedState",
      });

      scheduledStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Scheduled",
        order: 1,
        flag: "isScheduledState",
      });
      ongoingStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Ongoing",
        order: 2,
        flag: "isOngoingState",
      });
      // A state of the project's own, between Ongoing and Ended: in progress.
      verifyingStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Verifying",
        order: 3,
      });
      endedStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Ended",
        order: 4,
        flag: "isEndedState",
      });
      completedStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Completed",
        order: 5,
        flag: "isResolvedState",
      });
    }

    async function seedMonitorStatus(data: {
      name: string;
      priority: number;
      isOperationalState?: boolean;
      isOfflineState?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "MonitorStatus"
       ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState", "version")
       VALUES ($1, $2, $3, $4, '#000000', $5, $6, $7, 1)`,
        [
          id.toString(),
          projectId.toString(),
          data.name,
          `${data.name.toLowerCase().replace(/ /g, "-")}-${id.toString()}`,
          data.priority,
          Boolean(data.isOperationalState),
          Boolean(data.isOfflineState),
        ],
      );
      return id;
    }

    async function seedRecordState(
      table: "IncidentState" | "ScheduledMaintenanceState",
      data: { name: string; order: number; flag?: string },
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const columns: Array<string> = [
        `"_id"`,
        `"projectId"`,
        `"name"`,
        `"slug"`,
        `"color"`,
        `"order"`,
        `"version"`,
      ];
      const values: Array<unknown> = [
        id.toString(),
        projectId.toString(),
        data.name,
        `${data.name.toLowerCase()}-${id.toString()}`,
        "#000000",
        data.order,
        1,
      ];

      if (data.flag) {
        columns.push(`"${data.flag}"`);
        values.push(true);
      }

      await database.query(
        `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${values
          .map((_value: unknown, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        values,
      );

      return id;
    }

    // A monitor in a status from its last check, this long ago.
    async function seedMonitor(
      data: {
        statusId?: ObjectID;
        sinceMs?: number;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const statusId: ObjectID = data.statusId || offlineStatusId;

      await database.query(
        `INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version")
       VALUES ($1, $2, 'Checkout API', $3, 'API', $4, 1)`,
        [
          id.toString(),
          projectId.toString(),
          `checkout-api-${id.toString()}`,
          statusId.toString(),
        ],
      );

      await database.query(
        `INSERT INTO "MonitorStatusTimeline"
       ("_id", "projectId", "monitorId", "monitorStatusId", "startsAt", "isMonitoringOff", "isOwnerNotified", "version")
       VALUES ($1, $2, $3, $4, $5, false, true, 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          id.toString(),
          statusId.toString(),
          new Date(Date.now() - (data.sinceMs ?? 3 * HOUR_MS)),
        ],
      );

      return id;
    }

    // An event that names the monitors, still scheduled.
    async function seedEvent(data: {
      monitorIds: Array<ObjectID>;
      changeMonitorStatusToId?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const eventNumber: number = nextEventNumber++;

      await database.query(
        `INSERT INTO "ScheduledMaintenance"
       ("_id", "projectId", "title", "slug", "currentScheduledMaintenanceStateId", "startsAt", "endsAt",
        "changeMonitorStatusToId", "scheduledMaintenanceNumber", "scheduledMaintenanceNumberWithPrefix", "version")
       VALUES ($1, $2, 'Database upgrade', $3, $4, $5, $6, $7, $8, $9, 1)`,
        [
          id.toString(),
          projectId.toString(),
          `database-upgrade-${id.toString()}`,
          scheduledStateId.toString(),
          new Date(),
          new Date(Date.now() + 2 * HOUR_MS),
          data.changeMonitorStatusToId?.toString() || null,
          eventNumber,
          `SM-${eventNumber}`,
        ],
      );

      for (const monitorId of data.monitorIds) {
        await database.query(
          `INSERT INTO "ScheduledMaintenanceMonitor" ("scheduledMaintenanceId", "monitorId") VALUES ($1, $2)`,
          [id.toString(), monitorId.toString()],
        );
      }

      return id;
    }

    /*
     * The event moves into a state, as every move does: a new row of its
     * state timeline, whose onCreateSuccess starts or ends what the state
     * says. `filledInBetween` is a row slipped in back in the timeline,
     * between two others, as the API can: it has an end, the start of the
     * row after.
     */
    async function moveEventInto(
      eventId: ObjectID,
      stateId: ObjectID,
      filledInBetween?: { startsAt: Date; endsAt: Date },
    ): Promise<void> {
      const row: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      row.id = ObjectID.generate();
      row.projectId = projectId;
      row.scheduledMaintenanceId = eventId;
      row.scheduledMaintenanceStateId = stateId;
      row.startsAt = filledInBetween?.startsAt || new Date();

      if (filledInBetween) {
        row.endsAt = filledInBetween.endsAt;
      }

      await database.query(
        `INSERT INTO "ScheduledMaintenanceStateTimeline"
       ("_id", "projectId", "scheduledMaintenanceId", "scheduledMaintenanceStateId", "startsAt", "endsAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          row.id.toString(),
          projectId.toString(),
          eventId.toString(),
          stateId.toString(),
          row.startsAt,
          row.endsAt || null,
        ],
      );

      await (
        ScheduledMaintenanceStateTimelineService as unknown as {
          onCreateSuccess: OnCreateSuccessFunction;
        }
      ).onCreateSuccess(
        {
          createBy: {
            data: row,
            props: { isRoot: true },
          },
          carryForward: {
            statusTimelineBeforeThisStatus: null,
            statusTimelineAfterThisStatus: null,
            publicNote: undefined,
            mutex: null,
          },
        },
        row,
      );
    }

    async function seedIncident(data: {
      monitorIds: Array<ObjectID>;
      changeMonitorStatusToId?: ObjectID;
      incidentNumber: number;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "isCreatedAutomatically",
        "holdsMonitors", "changeMonitorStatusToId", "incidentNumber", "incidentNumberWithPrefix", "version")
       VALUES ($1, $2, 'Checkout is failing', $3, $4, $5, false, true, $6, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          `incident-${id.toString()}`,
          identifiedStateId.toString(),
          ObjectID.generate().toString(),
          data.changeMonitorStatusToId?.toString() || null,
          data.incidentNumber,
          `INC-${data.incidentNumber}`,
        ],
      );

      for (const monitorId of data.monitorIds) {
        await database.query(
          `INSERT INTO "IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [id.toString(), monitorId.toString()],
        );
      }

      return id;
    }

    /*
     * An incident declared by hand, as IncidentService.onCreateSuccess runs
     * it: the monitors in its status, if it has one, then paused.
     */
    async function declareIncident(data: {
      monitorIds: Array<ObjectID>;
      changeMonitorStatusToId?: ObjectID;
      incidentNumber: number;
    }): Promise<ObjectID> {
      const incidentId: ObjectID = await seedIncident(data);

      if (data.changeMonitorStatusToId) {
        // IncidentService's own step: the status, where nothing holds the monitor in a more severe one.
        const createdItem: Incident = new Incident(incidentId);
        createdItem.projectId = projectId;
        createdItem.incidentNumber = data.incidentNumber;
        createdItem.incidentNumberWithPrefix = `INC-${data.incidentNumber}`;
        createdItem.changeMonitorStatusToId = data.changeMonitorStatusToId;
        createdItem.monitors = data.monitorIds.map(
          (monitorId: ObjectID): Monitor => {
            return new Monitor(monitorId);
          },
        );

        await (
          IncidentService as unknown as {
            handleMonitorStatusChangeAsync: (
              createdItem: Incident,
              onCreate: OnCreate<Incident>,
            ) => Promise<void>;
          }
        ).handleMonitorStatusChangeAsync(createdItem, {
          createBy: { data: createdItem, props: { isRoot: true } },
          carryForward: null,
        } as unknown as OnCreate<Incident>);
      }

      await IncidentService.disableActiveMonitoringIfManualIncident(incidentId);

      return incidentId;
    }

    // An incident resolved, as IncidentStateTimelineService gives its monitors back.
    async function resolveIncident(
      incidentId: ObjectID,
      monitorIds: Array<ObjectID>,
    ): Promise<void> {
      await database.query(
        `UPDATE "Incident" SET "currentIncidentStateId" = $2 WHERE "_id" = $1`,
        [incidentId.toString(), resolvedStateId.toString()],
      );

      await IncidentService.markMonitorsActiveForMonitoring(
        projectId,
        monitorIds.map((monitorId: ObjectID): Monitor => {
          return new Monitor(monitorId);
        }),
      );
    }

    async function pauseFlags(
      monitorId: ObjectID,
    ): Promise<{ maintenance: boolean; incident: boolean; statusId: string }> {
      const rows: Array<{
        maintenance: boolean;
        incident: boolean;
        statusId: string;
      }> = await database.query(
        `SELECT "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" AS "maintenance",
                "disableActiveMonitoringBecauseOfManualIncident" AS "incident",
                "currentMonitorStatusId"::text AS "statusId"
           FROM "Monitor" WHERE "_id" = $1`,
        [monitorId.toString()],
      );
      return rows[0]!;
    }

    async function timeline(monitorId: ObjectID): Promise<Array<TimelineRow>> {
      return database.query(
        `SELECT "monitorStatusId"::text AS "monitorStatusId", "startsAt", "endsAt", "isMonitoringOff", "rootCause"
         FROM "MonitorStatusTimeline" WHERE "monitorId" = $1
        ORDER BY "startsAt" ASC, "endsAt" ASC NULLS LAST`,
        [monitorId.toString()],
      );
    }

    /*
     * The rows from the newest back, moved so the newest starts this long
     * ago and each one before it ends where the next starts: the time a test
     * says passed between its steps, which run within a second.
     */
    async function backdate(
      monitorId: ObjectID,
      agoMsNewestFirst: Array<number>,
    ): Promise<void> {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "MonitorStatusTimeline"
          WHERE "monitorId" = $1 ORDER BY "startsAt" DESC, "endsAt" DESC NULLS FIRST`,
        [monitorId.toString()],
      );

      for (let index: number = 0; index < agoMsNewestFirst.length; index++) {
        const at: Date = new Date(Date.now() - agoMsNewestFirst[index]!);

        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "startsAt" = $2 WHERE "_id" = $1`,
          [rows[index]!._id, at],
        );

        if (rows[index + 1]) {
          await database.query(
            `UPDATE "MonitorStatusTimeline" SET "endsAt" = $2 WHERE "_id" = $1`,
            [rows[index + 1]!._id, at],
          );
        }
      }
    }

    async function statusPageTotals(
      monitorIds: Array<ObjectID>,
      hours: number,
    ): Promise<MergedDowntimeTotals> {
      return MonitorStatusTimelineService.getMergedDowntimeSeconds({
        monitorIds: monitorIds,
        downtimeMonitorStatusIds: [offlineStatusId],
        startDate: new Date(Date.now() - hours * HOUR_MS),
        endDate: new Date(),
      });
    }

    async function uptimeWindow(
      monitorId: ObjectID,
      hours: number,
    ): Promise<MonitorUptimeWindowTotal> {
      const totals: Array<MonitorUptimeWindowTotal> =
        await MonitorStatusTimelineService.getRollingUptimeTotals({
          monitorId: monitorId,
          windows: [
            {
              key: MonitorUptimeWindowKey.Last24Hours,
              startDate: new Date(Date.now() - hours * HOUR_MS),
            },
          ],
          endDate: new Date(),
        });

      return totals[0]!;
    }

    function secondsIn(
      window: MonitorUptimeWindowTotal,
      statusId: ObjectID,
    ): number {
      return window.statusDurations
        .filter((duration: { monitorStatusId: ObjectID }): boolean => {
          return duration.monitorStatusId.toString() === statusId.toString();
        })
        .reduce((sum: number, duration: { seconds: number }): number => {
          return sum + duration.seconds;
        }, 0);
    }

    async function monitoringOffSecondsOfTheDay(
      monitorId: ObjectID,
      hours: number,
    ): Promise<number> {
      const aggregate: UptimeDailyAggregate =
        await MonitorStatusTimelineService.getDailyUptimeAggregate({
          monitorIds: [monitorId],
          startDate: new Date(Date.now() - hours * HOUR_MS),
          endDate: new Date(),
        });

      return aggregate.monitors
        .flatMap(
          (monitor: MonitorUptimeDailyAggregate): Array<UptimeDayBucket> => {
            return monitor.buckets;
          },
        )
        .reduce((sum: number, bucket: UptimeDayBucket): number => {
          return sum + (bucket.monitoringOffSeconds || 0);
        }, 0);
    }

    async function sloSli(
      monitorIds: Array<ObjectID>,
      hours: number,
    ): Promise<TimeSliResult> {
      const windowStart: Date = new Date(Date.now() - hours * HOUR_MS);
      const windowEnd: Date = new Date();
      const offline: MonitorStatus = new MonitorStatus(offlineStatusId);

      return SloUtil.computeTimeSli({
        perMonitorTimelines: await fetchPerMonitorTimelines({
          projectId: projectId,
          monitorIds: monitorIds,
          windowStart: windowStart,
          windowEnd: windowEnd,
        }),
        downtimeStatuses: [offline],
        window: { startDate: windowStart, endDate: windowEnd },
        mode: SloMultiMonitorMode.AnyDown,
      });
    }

    describe("an event that sets no status", () => {
      test("its start pauses the monitor and marks its time left out, in the status the last check saw", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: true,
          incident: false,
          statusId: offlineStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        // The status it kept, as its last check saw it.
        expect(rows[1]!.monitorStatusId).toBe(offlineStatusId.toString());
        expect(rows[1]!.isMonitoringOff).toBe(true);
        expect(rows[1]!.rootCause).toBe(
          `Monitoring is paused by scheduled maintenance ([SM-1](https://oneuptime.example/scheduled-maintenance/${eventId.toString()})), with no status set for this monitor. Nothing checks the monitor until the maintenance ends, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`,
        );
        // The Dashboard reads it as its note, in the reader's language.
        expect(readStatusChangeNote(rows[1]!.rootCause!)?.values).toEqual({
          events: `[SM-1](https://oneuptime.example/scheduled-maintenance/${eventId.toString()})`,
        });
      });

      test("status pages, the day bars, the monitor's uptime and SLOs leave the paused time out", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        // Offline for an hour from its checks, then two paused.
        await backdate(monitorId, [2 * HOUR_MS, 3 * HOUR_MS]);

        // Status pages: only the hour its checks saw it Offline.
        const page: MergedDowntimeTotals = await statusPageTotals(
          [monitorId],
          3,
        );
        expectAbout(page.coveredSeconds, HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, HOUR_SECONDS);

        // The day bars hold the paused time as time with monitoring off.
        expectAbout(
          await monitoringOffSecondsOfTheDay(monitorId, 3),
          2 * HOUR_SECONDS,
        );

        // The monitor's own uptime windows: measured over the checked hour.
        const window: MonitorUptimeWindowTotal = await uptimeWindow(
          monitorId,
          3,
        );
        expectAbout(window.coveredSeconds, HOUR_SECONDS);
        expectAbout(secondsIn(window, offlineStatusId), HOUR_SECONDS);

        // An SLO neither spends its budget on the paused time nor counts it good.
        const sli: TimeSliResult = await sloSli([monitorId], 3);
        expectAbout(sli.totalSeconds, HOUR_SECONDS);
        expectAbout(sli.badSeconds, HOUR_SECONDS);
      });

      test("an Operational monitor's paused time is not counted as up either", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        await backdate(monitorId, [2 * HOUR_MS, 3 * HOUR_MS]);

        const window: MonitorUptimeWindowTotal = await uptimeWindow(
          monitorId,
          3,
        );
        expectAbout(window.coveredSeconds, HOUR_SECONDS);
        expectAbout(secondsIn(window, operationalStatusId), HOUR_SECONDS);

        const sli: TimeSliResult = await sloSli([monitorId], 3);
        expectAbout(sli.totalSeconds, HOUR_SECONDS);
        expect(sli.badSeconds).toBe(0);
      });

      test("its end gives the monitor back: operational, and its time counts again from there", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        await backdate(monitorId, [2 * HOUR_MS, 3 * HOUR_MS]);

        await moveEventInto(eventId, endedStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.monitorStatusId).toBe(operationalStatusId.toString());
        expect(rows[2]!.isMonitoringOff).toBe(false);

        // Back for an hour, operational.
        await backdate(monitorId, [HOUR_MS, 3 * HOUR_MS, 4 * HOUR_MS]);

        const page: MergedDowntimeTotals = await statusPageTotals(
          [monitorId],
          4,
        );
        expectAbout(page.coveredSeconds, 2 * HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, HOUR_SECONDS);
      });

      test("ended while already operational, a row of its own ends the time left out", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        await moveEventInto(eventId, endedStateId);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.monitorStatusId).toBe(operationalStatusId.toString());
        expect(rows[2]!.isMonitoringOff).toBe(false);
        expect(rows[2]!.rootCause).toBe(
          "Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.",
        );
      });

      test("moving on from Ongoing into a state of the project's own in progress starts nothing again, and its time stays left out", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        await moveEventInto(eventId, verifyingStateId);

        expect((await pauseFlags(monitorId)).maintenance).toBe(true);
        expect(await timeline(monitorId)).toHaveLength(2);

        // Ended from there, it lets go as from Ongoing.
        await moveEventInto(eventId, completedStateId);

        expect((await pauseFlags(monitorId)).maintenance).toBe(false);
        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.isMonitoringOff).toBe(false);
      });

      test("deleting the event in progress gives the monitor back as its end does", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);

        const deleted: ScheduledMaintenance = new ScheduledMaintenance(eventId);
        deleted.projectId = projectId;
        deleted.monitors = [new Monitor(monitorId)];

        await database.query(
          `DELETE FROM "ScheduledMaintenanceMonitor" WHERE "scheduledMaintenanceId" = $1`,
          [eventId.toString()],
        );
        await database.query(
          `DELETE FROM "ScheduledMaintenance" WHERE "_id" = $1`,
          [eventId.toString()],
        );

        // What else a delete sweeps up: the event's measurement points.
        getJestSpyOn(
          ScheduledMaintenanceMeasurementService,
          "getMetricNamesForProject",
        ).mockResolvedValue([] as never);
        getJestSpyOn(MeasurementMetricWriter, "tombstoneAll").mockResolvedValue(
          undefined as never,
        );

        await (
          ScheduledMaintenanceService as unknown as {
            onDeleteSuccess: OnDeleteSuccessFunction;
          }
        ).onDeleteSuccess(
          {
            deleteBy: {
              query: { _id: eventId.toString() },
              props: { isRoot: true },
            },
            carryForward: {
              scheduledMaintenanceEvents: [deleted],
              publicNoteApproval: undefined,
            },
          } as unknown as OnDelete<ScheduledMaintenance>,
          [eventId],
        );

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
      });

      test("working its monitors out again writes nothing more", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);

        for (let attempt: number = 0; attempt < 3; attempt++) {
          await MonitorIncidentPause.syncMonitors({
            projectId: projectId,
            monitorIds: [monitorId],
          });
        }

        expect(await timeline(monitorId)).toHaveLength(2);
      });

      test("an event in progress before the upgrade is worked out from the upgrade on, its earlier time counting as it did", async () => {
        const monitorId: ObjectID = await seedMonitor({
          sinceMs: 3 * HOUR_MS,
        });
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        // Started an hour ago by an older OneUptime: the flag, and no mark.
        await database.query(
          `UPDATE "Monitor" SET "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = true WHERE "_id" = $1`,
          [monitorId.toString()],
        );
        await database.query(
          `UPDATE "ScheduledMaintenance" SET "currentScheduledMaintenanceStateId" = $2 WHERE "_id" = $1`,
          [eventId.toString(), ongoingStateId.toString()],
        );

        // What the upgrade's data migration does to each such monitor.
        await MonitorIncidentPause.syncMonitors({
          projectId: projectId,
          monitorIds: [monitorId],
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.isMonitoringOff).toBe(true);

        // The upgrade an hour ago: the three hours before it count as they did.
        await backdate(monitorId, [HOUR_MS, 4 * HOUR_MS]);

        const page: MergedDowntimeTotals = await statusPageTotals(
          [monitorId],
          4,
        );
        expectAbout(page.coveredSeconds, 3 * HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, 3 * HOUR_SECONDS);
      });
    });

    describe("an event that sets a status", () => {
      test("its start puts the monitor in that status, which counts: nothing is left out", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        await moveEventInto(eventId, ongoingStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: true,
          incident: false,
          statusId: underMaintenanceStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.monitorStatusId).toBe(
          underMaintenanceStatusId.toString(),
        );
        expect(rows[1]!.isMonitoringOff).toBe(false);

        await backdate(monitorId, [2 * HOUR_MS, 3 * HOUR_MS]);

        // Every hour counts: Offline, then Under Maintenance, not a downtime status.
        const page: MergedDowntimeTotals = await statusPageTotals(
          [monitorId],
          3,
        );
        expectAbout(page.coveredSeconds, 3 * HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, HOUR_SECONDS);

        const window: MonitorUptimeWindowTotal = await uptimeWindow(
          monitorId,
          3,
        );
        expectAbout(
          secondsIn(window, underMaintenanceStatusId),
          2 * HOUR_SECONDS,
        );

        const sli: TimeSliResult = await sloSli([monitorId], 3);
        expectAbout(sli.totalSeconds, 3 * HOUR_SECONDS);
        expectAbout(sli.badSeconds, HOUR_SECONDS);
        expect(await monitoringOffSecondsOfTheDay(monitorId, 3)).toBe(0);
      });

      test("a monitor already in the event's status, its time left out before, counts again from the start", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: underMaintenanceStatusId,
        });

        // Paused by an incident that set no status: left out.
        await declareIncident({ monitorIds: [monitorId], incidentNumber: 21 });
        expect((await timeline(monitorId))[1]!.isMonitoringOff).toBe(true);

        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        await moveEventInto(eventId, ongoingStateId);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.isMonitoringOff).toBe(false);
        expect(rows[2]!.rootCause).toBe(
          `Scheduled maintenance ([SM-1](https://oneuptime.example/scheduled-maintenance/${eventId.toString()})) puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`,
        );
      });

      test("its end puts the monitor back to operational, as before", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        await moveEventInto(eventId, ongoingStateId);
        await moveEventInto(eventId, endedStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(
          rows.map((row: TimelineRow): [string, boolean] => {
            return [row.monitorStatusId, row.isMonitoringOff];
          }),
        ).toEqual([
          [offlineStatusId.toString(), false],
          [underMaintenanceStatusId.toString(), false],
          [operationalStatusId.toString(), false],
        ]);
      });
    });

    describe("a state filled in back in an event's timeline", () => {
      test("an Ongoing row filled in once the event is over pauses nothing: the monitor's time keeps counting", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        await moveEventInto(eventId, ongoingStateId);
        await moveEventInto(eventId, endedStateId);

        const before: Array<TimelineRow> = await timeline(monitorId);

        await moveEventInto(eventId, ongoingStateId, {
          startsAt: new Date(Date.now() - 30 * 60 * 1000),
          endsAt: new Date(Date.now() - 10 * 60 * 1000),
        });

        // It used to pause the monitor for good, in the event's status.
        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
        expect(await timeline(monitorId)).toEqual(before);
      });

      test("an Ended row filled in once the event is over gives nothing back: the status the monitor's checks set since stays", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);
        await moveEventInto(eventId, endedStateId);

        // Its checks find it offline again after the event.
        await MonitorService.changeMonitorStatus(
          projectId,
          [monitorId],
          offlineStatusId,
          true,
          "The API did not respond.",
          undefined,
          { isRoot: true },
        );

        const before: Array<TimelineRow> = await timeline(monitorId);
        expect(before[before.length - 1]!.monitorStatusId).toBe(
          offlineStatusId.toString(),
        );

        await moveEventInto(eventId, endedStateId, {
          startsAt: new Date(Date.now() - 30 * 60 * 1000),
          endsAt: new Date(Date.now() - 10 * 60 * 1000),
        });

        // It used to put the monitor back to operational over that.
        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: offlineStatusId.toString(),
        });
        expect(await timeline(monitorId)).toEqual(before);
      });

      test("an Ended row filled in while the event is in progress lets go of nothing: its time stays left out", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(eventId, ongoingStateId);

        const before: Array<TimelineRow> = await timeline(monitorId);

        await moveEventInto(eventId, endedStateId, {
          startsAt: new Date(Date.now() - 30 * 60 * 1000),
          endsAt: new Date(Date.now() - 10 * 60 * 1000),
        });

        // It used to release the monitor, back to operational.
        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: true,
          incident: false,
          statusId: offlineStatusId.toString(),
        });
        expect(await timeline(monitorId)).toEqual(before);
        expect(before[before.length - 1]!.isMonitoringOff).toBe(true);
      });
    });

    describe("two events at once", () => {
      test("one with a status and one without: counted while the one with a status holds it, left out once only the other does", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const withStatus: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });
        const withoutStatus: ObjectID = await seedEvent({
          monitorIds: [monitorId],
        });

        await moveEventInto(withStatus, ongoingStateId);
        await moveEventInto(withoutStatus, ongoingStateId);

        // One of them puts it in a status: counted.
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.isMonitoringOff).toBe(false);

        // The one with a status ends: the other still holds it, with none.
        await moveEventInto(withStatus, endedStateId);

        expect((await pauseFlags(monitorId)).maintenance).toBe(true);
        rows = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.monitorStatusId).toBe(
          underMaintenanceStatusId.toString(),
        );
        expect(rows[2]!.isMonitoringOff).toBe(true);
        expect(rows[2]!.rootCause).toContain(
          `Monitoring is paused by scheduled maintenance ([SM-2](`,
        );

        // The last one ends: back, counted.
        await moveEventInto(withoutStatus, endedStateId);

        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          operationalStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
        expect((await pauseFlags(monitorId)).maintenance).toBe(false);
      });

      test("two without a status name both", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const first: ObjectID = await seedEvent({ monitorIds: [monitorId] });
        const second: ObjectID = await seedEvent({ monitorIds: [monitorId] });

        await moveEventInto(first, ongoingStateId);
        await moveEventInto(second, ongoingStateId);

        // Marked once, by the first start; the second changes nothing.
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.isMonitoringOff).toBe(true);

        await moveEventInto(first, endedStateId);

        // Still held by the second: still left out, nothing written.
        rows = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect((await pauseFlags(monitorId)).maintenance).toBe(true);

        // Worked out again now, it names the one still holding it.
        expect(
          await MonitorIncidentPause.getUptimeRootCause(
            (await MonitorIncidentPause.syncPause({
              projectId: projectId,
              monitorId: monitorId,
            }))!,
          ),
        ).toContain(
          `scheduled maintenance ([SM-2](https://oneuptime.example/scheduled-maintenance/${second.toString()}))`,
        );
      });
    });

    describe("an incident declared by hand and maintenance at once", () => {
      test("an incident with no status, then maintenance with none: left out throughout, named for both", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          incidentNumber: 31,
        });

        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });
        await moveEventInto(eventId, ongoingStateId);

        // Left out since the incident paused it; nothing new to mark.
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.isMonitoringOff).toBe(true);

        expect(
          await MonitorIncidentPause.getUptimeRootCause(
            (await MonitorIncidentPause.syncPause({
              projectId: projectId,
              monitorId: monitorId,
            }))!,
          ),
        ).toBe(
          `Monitoring is paused by [INC-31](https://oneuptime.example/incidents/${incidentId.toString()}), declared by hand, and by scheduled maintenance ([SM-1](https://oneuptime.example/scheduled-maintenance/${eventId.toString()})), with no status set for this monitor. Nothing checks the monitor until both are over, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`,
        );

        // The incident resolved while the event runs: still left out.
        await resolveIncident(incidentId, [monitorId]);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: true,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(true);
        expect(rows[rows.length - 1]!.rootCause).toContain(
          "Monitoring is paused by scheduled maintenance ([SM-1](",
        );

        // The event ends: counted again.
        await moveEventInto(eventId, endedStateId);

        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
      });

      test("an incident that sets a status, then maintenance with none: counted as the incident's status", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        await declareIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 32,
        });

        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });
        await moveEventInto(eventId, ongoingStateId);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(
          rows.map((row: TimelineRow): [string, boolean] => {
            return [row.monitorStatusId, row.isMonitoringOff];
          }),
        ).toEqual([
          [operationalStatusId.toString(), false],
          [offlineStatusId.toString(), false],
        ]);

        await backdate(monitorId, [2 * HOUR_MS, 3 * HOUR_MS]);

        // Two hours Offline, as the incident declared.
        const page: MergedDowntimeTotals = await statusPageTotals(
          [monitorId],
          3,
        );
        expectAbout(page.coveredSeconds, 3 * HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, 2 * HOUR_SECONDS);
      });

      /*
       * The event's end used to put the monitor back to operational even
       * while the incident still said it was down: green on its status
       * pages, counted as up, until the incident was resolved. And its start
       * put the monitor in Under Maintenance over the incident's Offline:
       * a monitor several hold is in the most severe status they set
       * (#11432), so it stays Offline throughout.
       */
      test("the event starts and ends while that incident is still open: the monitor stays in the incident's more severe status, never operational", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 33,
        });

        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });
        await moveEventInto(eventId, ongoingStateId);

        expect((await pauseFlags(monitorId)).statusId).toBe(
          offlineStatusId.toString(),
        );

        await moveEventInto(eventId, endedStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: true,
          statusId: offlineStatusId.toString(),
        });

        // Offline from the incident on, counted: no row of its own since.
        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(
          rows.map((row: TimelineRow): [string, boolean] => {
            return [row.monitorStatusId, row.isMonitoringOff];
          }),
        ).toEqual([
          [operationalStatusId.toString(), false],
          [offlineStatusId.toString(), false],
        ]);

        // Resolved: operational, as before.
        await resolveIncident(incidentId, [monitorId]);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
      });

      test("the event, more severe than the incident open on its monitor, ends: the monitor goes back to the incident's status, not to operational", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        // The project puts Under Maintenance after Offline in its list.
        await database.query(
          `UPDATE "MonitorStatus" SET "priority" = 5 WHERE "_id" = $1`,
          [underMaintenanceStatusId.toString()],
        );

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 38,
        });

        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });
        await moveEventInto(eventId, ongoingStateId);

        expect((await pauseFlags(monitorId)).statusId).toBe(
          underMaintenanceStatusId.toString(),
        );

        await moveEventInto(eventId, endedStateId);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: true,
          statusId: offlineStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
        expect(rows[rows.length - 1]!.rootCause).toBe(
          `[INC-38](https://oneuptime.example/incidents/${incidentId.toString()}) is still open, so the monitor is in the status it puts it in.`,
        );
      });

      test("maintenance with a status, then an incident with none: counted as the maintenance's status, and left out once the event ends", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });
        await moveEventInto(eventId, ongoingStateId);

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          incidentNumber: 34,
        });

        // The event puts it in a status: nothing is left out.
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(
          rows.map((row: TimelineRow): boolean => {
            return row.isMonitoringOff;
          }),
        ).toEqual([false, false]);

        await moveEventInto(eventId, endedStateId);

        // Operational, as an end always gives back, and left out from there.
        rows = await timeline(monitorId);
        expect(rows[rows.length - 2]!.monitorStatusId).toBe(
          operationalStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          operationalStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(true);
        expect(rows[rows.length - 1]!.rootCause).toContain(
          `Monitoring is paused by [INC-34](https://oneuptime.example/incidents/${incidentId.toString()}), declared by hand without a status for this monitor.`,
        );

        await resolveIncident(incidentId, [monitorId]);

        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
      });

      /*
       * Resolving an incident used to put the monitor back to operational
       * even while maintenance with a status of its own still held it, for
       * the rest of the event.
       */
      test("an incident with a status resolved while maintenance with one still runs: back in the maintenance's status", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        const eventId: ObjectID = await seedEvent({
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });
        await moveEventInto(eventId, ongoingStateId);

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 35,
        });

        expect((await pauseFlags(monitorId)).statusId).toBe(
          offlineStatusId.toString(),
        );

        await resolveIncident(incidentId, [monitorId]);

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: true,
          incident: false,
          statusId: underMaintenanceStatusId.toString(),
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          underMaintenanceStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
        expect(rows[rows.length - 1]!.rootCause).toBe(
          `Scheduled maintenance ([SM-1](https://oneuptime.example/scheduled-maintenance/${eventId.toString()})) is still in progress, so the monitor is in the status it puts it in.`,
        );

        // The event ends: operational.
        await moveEventInto(eventId, endedStateId);

        expect((await pauseFlags(monitorId)).statusId).toBe(
          operationalStatusId.toString(),
        );
      });

      test("an incident with a status resolved while maintenance with none still runs: operational, and its time left out until the event ends", async () => {
        const monitorId: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        const eventId: ObjectID = await seedEvent({ monitorIds: [monitorId] });
        await moveEventInto(eventId, ongoingStateId);

        const incidentId: ObjectID = await declareIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 36,
        });

        // The incident puts it in its status: counted from there.
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          offlineStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);

        await resolveIncident(incidentId, [monitorId]);

        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          operationalStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(true);
        expect((await pauseFlags(monitorId)).maintenance).toBe(true);
      });

      test("monitors of one event each count as what pauses them says", async () => {
        const quiet: ObjectID = await seedMonitor();
        const declared: ObjectID = await seedMonitor({
          statusId: operationalStatusId,
        });

        await declareIncident({
          monitorIds: [declared],
          changeMonitorStatusToId: offlineStatusId,
          incidentNumber: 37,
        });

        const eventId: ObjectID = await seedEvent({
          monitorIds: [quiet, declared],
        });
        await moveEventInto(eventId, ongoingStateId);

        expect((await timeline(quiet))[1]!.isMonitoringOff).toBe(true);
        expect(
          (await timeline(declared)).map((row: TimelineRow): boolean => {
            return row.isMonitoringOff;
          }),
        ).toEqual([false, false]);

        // A status page of both: only the declared monitor's time while paused.
        await backdate(quiet, [2 * HOUR_MS, 3 * HOUR_MS]);
        await backdate(declared, [2 * HOUR_MS, 3 * HOUR_MS]);

        const page: MergedDowntimeTotals = await statusPageTotals(
          [quiet, declared],
          3,
        );
        expectAbout(page.coveredSeconds, 3 * HOUR_SECONDS);
        expectAbout(page.downtimeSeconds, 3 * HOUR_SECONDS);
      });
    });

    describe("monitors added to an event in progress, and taken off it", () => {
      test("one added while an event with no status runs is paused and its time left out; taken off, it is given back", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const otherMonitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({
          monitorIds: [otherMonitorId],
        });

        await moveEventInto(eventId, ongoingStateId);

        // The edit attaches it: the row, then what the edit does.
        await database.query(
          `INSERT INTO "ScheduledMaintenanceMonitor" ("scheduledMaintenanceId", "monitorId") VALUES ($1, $2)`,
          [eventId.toString(), monitorId.toString()],
        );
        await (
          ScheduledMaintenanceService as unknown as {
            holdMonitorsAttachedToEvent: (data: {
              scheduledMaintenanceId: ObjectID;
              projectId: ObjectID;
              monitorIds: Array<ObjectID>;
              changeMonitorStatusToId: ObjectID | undefined;
            }) => Promise<void>;
          }
        ).holdMonitorsAttachedToEvent({
          scheduledMaintenanceId: eventId,
          projectId: projectId,
          monitorIds: [monitorId],
          changeMonitorStatusToId: undefined,
        });

        expect((await pauseFlags(monitorId)).maintenance).toBe(true);
        let rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.isMonitoringOff).toBe(true);

        // The edit detaches it again.
        await database.query(
          `DELETE FROM "ScheduledMaintenanceMonitor" WHERE "scheduledMaintenanceId" = $1 AND "monitorId" = $2`,
          [eventId.toString(), monitorId.toString()],
        );
        await (
          ScheduledMaintenanceService as unknown as {
            restoreMonitorsDetachedFromEvent: (data: {
              scheduledMaintenanceId: ObjectID;
              projectId: ObjectID;
              monitorIds: Array<ObjectID>;
            }) => Promise<void>;
          }
        ).restoreMonitorsDetachedFromEvent({
          scheduledMaintenanceId: eventId,
          projectId: projectId,
          monitorIds: [monitorId],
        });

        expect(await pauseFlags(monitorId)).toEqual({
          maintenance: false,
          incident: false,
          statusId: operationalStatusId.toString(),
        });
        rows = await timeline(monitorId);
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
        // The other monitor is still held, its time still left out.
        expect((await pauseFlags(otherMonitorId)).maintenance).toBe(true);
        expect((await timeline(otherMonitorId))[1]!.isMonitoringOff).toBe(true);
      });

      test("one added while an event with a status runs takes that status, which counts", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const eventId: ObjectID = await seedEvent({
          monitorIds: [],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        await moveEventInto(eventId, ongoingStateId);

        await database.query(
          `INSERT INTO "ScheduledMaintenanceMonitor" ("scheduledMaintenanceId", "monitorId") VALUES ($1, $2)`,
          [eventId.toString(), monitorId.toString()],
        );
        await (
          ScheduledMaintenanceService as unknown as {
            holdMonitorsAttachedToEvent: (data: {
              scheduledMaintenanceId: ObjectID;
              projectId: ObjectID;
              monitorIds: Array<ObjectID>;
              changeMonitorStatusToId: ObjectID | undefined;
            }) => Promise<void>;
          }
        ).holdMonitorsAttachedToEvent({
          scheduledMaintenanceId: eventId,
          projectId: projectId,
          monitorIds: [monitorId],
          changeMonitorStatusToId: underMaintenanceStatusId,
        });

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(
          rows.map((row: TimelineRow): [string, boolean] => {
            return [row.monitorStatusId, row.isMonitoringOff];
          }),
        ).toEqual([
          [offlineStatusId.toString(), false],
          [underMaintenanceStatusId.toString(), false],
        ]);
      });
    });
  },
);
