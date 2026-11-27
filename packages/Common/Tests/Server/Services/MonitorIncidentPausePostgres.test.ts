import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import MonitorIncidentPause from "../../../Server/Utils/Monitor/MonitorIncidentPause";
import URL from "../../../Types/API/URL";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * WHICH INCIDENTS PAUSE A MONITOR, AGAINST POSTGRES (issue #11141).
 *
 * An incident declared by hand pauses the checks of the monitors it lists
 * while it is open (Monitor.disableActiveMonitoringBecauseOfManualIncident),
 * and the pause is worked out from the incidents on the monitor
 * (MonitorIncidentPause): open, declared by hand, holding their monitors
 * (Incident.holdsMonitors not false - null for an incident from before it
 * was recorded) and pausing monitoring (Incident.pauseMonitoring), on a
 * monitor not set to keep monitoring during incidents.
 *
 * The question used to be "is another open incident declared by hand on
 * it", which counted a reopened incident - one that holds nothing, so never
 * paused the monitor and never gives it back. Resolving the incident that
 * did pause it then left the monitor paused for good. The first describe
 * shows that on these rows with the old question, kept below as it was.
 *
 * Paused time counts as the status a pausing incident put the monitor in;
 * paused by incidents that put it in none, the monitor's last check is all
 * its status says, so the time is left out of uptime, status pages and SLOs
 * (MonitorStatusTimeline.isMonitoringOff), as time with monitoring off is
 * (#6480). The last describe measures that with the statement status pages
 * read (getMergedDowntimeSeconds).
 *
 * The real services run on real rows in a uniquely named schema holding
 * structure-only clones (LIKE ... INCLUDING ALL: the migrated defaults
 * included) of the tables they read and write; the schema is dropped
 * afterwards. Only the monitor's own update hooks, the per-monitor lock (in
 * memory), feed items, network sites and workflows are stubbed.
 *
 * Opt in with RUN_POSTGRES_MONITOR_INCIDENT_PAUSE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITOR_INCIDENT_PAUSE_TESTS=true \
 *   MONITOR_INCIDENT_PAUSE_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_INCIDENT_PAUSE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorIncidentPausePostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_INCIDENT_PAUSE_TESTS"] === "true"
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
  "DataMigrations",
];

const HOUR_MS: number = 60 * 60 * 1000;

describePostgres(
  "Which incidents pause a monitor, on a migrated Postgres",
  () => {
    const schema: string = `incident_pause_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let held: Set<string>;

    // A project of its own per test: the states a project has are kept per process.
    let projectId: ObjectID;
    let operationalStatusId: ObjectID;
    let offlineStatusId: ObjectID;
    let identifiedStateId: ObjectID;
    let acknowledgedStateId: ObjectID;
    let resolvedStateId: ObjectID;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_INCIDENT_PAUSE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_INCIDENT_PAUSE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_INCIDENT_PAUSE_TEST_DATABASE_NAME"] ||
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

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      projectId = ObjectID.generate();
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
       VALUES ($1, 'Incident pause test', $2, 1)`,
        [projectId.toString(), `incident-pause-${projectId.toString()}`],
      );

      operationalStatusId = await seedMonitorStatus({
        name: "Operational",
        priority: 0,
        isOperationalState: true,
      });
      offlineStatusId = await seedMonitorStatus({
        name: "Offline",
        priority: 2,
        isOfflineState: true,
      });

      identifiedStateId = await seedIncidentState({
        name: "Identified",
        order: 1,
        isCreatedState: true,
      });
      acknowledgedStateId = await seedIncidentState({
        name: "Acknowledged",
        order: 2,
        isAcknowledgedState: true,
      });
      resolvedStateId = await seedIncidentState({
        name: "Resolved",
        order: 3,
        isResolvedState: true,
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
          `${data.name.toLowerCase()}-${id.toString()}`,
          data.priority,
          Boolean(data.isOperationalState),
          Boolean(data.isOfflineState),
        ],
      );
      return id;
    }

    async function seedIncidentState(data: {
      name: string;
      order: number;
      isCreatedState?: boolean;
      isAcknowledgedState?: boolean;
      isResolvedState?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "IncidentState"
       ("_id", "projectId", "name", "slug", "color", "order", "isCreatedState", "isAcknowledgedState", "isResolvedState", "version")
       VALUES ($1, $2, $3, $4, '#000000', $5, $6, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          data.name,
          `${data.name.toLowerCase()}-${id.toString()}`,
          data.order,
          Boolean(data.isCreatedState),
          Boolean(data.isAcknowledgedState),
          Boolean(data.isResolvedState),
        ],
      );
      return id;
    }

    async function seedMonitor(
      data: {
        keepMonitoringDuringIncidents?: boolean;
        isPausedByIncident?: boolean;
        // Offline, from its last check this long ago.
        offlineSinceMs?: number;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const columns: Array<string> = [
        `"_id"`,
        `"projectId"`,
        `"name"`,
        `"slug"`,
        `"monitorType"`,
        `"currentMonitorStatusId"`,
        `"disableActiveMonitoringBecauseOfManualIncident"`,
        `"version"`,
      ];
      const values: Array<unknown> = [
        id.toString(),
        projectId.toString(),
        "Webhooks",
        `webhooks-${id.toString()}`,
        "Incoming Request",
        offlineStatusId.toString(),
        Boolean(data.isPausedByIncident),
        1,
      ];

      // Left out unless the test sets it: the migrated default is what is read.
      if (data.keepMonitoringDuringIncidents !== undefined) {
        columns.push(`"keepMonitoringDuringIncidents"`);
        values.push(data.keepMonitoringDuringIncidents);
      }

      await database.query(
        `INSERT INTO "Monitor" (${columns.join(", ")})
       VALUES (${values
         .map((_value: unknown, index: number): string => {
           return `$${index + 1}`;
         })
         .join(", ")})`,
        values,
      );

      // Offline since its last check: the status a pause keeps.
      await database.query(
        `INSERT INTO "MonitorStatusTimeline"
       ("_id", "projectId", "monitorId", "monitorStatusId", "startsAt", "isMonitoringOff", "isOwnerNotified", "version")
       VALUES ($1, $2, $3, $4, $5, false, true, 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          id.toString(),
          offlineStatusId.toString(),
          new Date(Date.now() - (data.offlineSinceMs ?? 2 * HOUR_MS)),
        ],
      );

      return id;
    }

    async function seedIncident(data: {
      monitorIds: Array<ObjectID>;
      stateId?: ObjectID;
      isCreatedAutomatically?: boolean;
      // Undefined leaves the column NULL: an incident from before it was recorded.
      holdsMonitors?: boolean | null;
      // Undefined leaves the column to its migrated default.
      pauseMonitoring?: boolean;
      changeMonitorStatusToId?: ObjectID;
      incidentNumber?: number;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const columns: Array<string> = [
        `"_id"`,
        `"projectId"`,
        `"title"`,
        `"slug"`,
        `"currentIncidentStateId"`,
        `"incidentSeverityId"`,
        `"isCreatedAutomatically"`,
        `"holdsMonitors"`,
        `"changeMonitorStatusToId"`,
        `"incidentNumber"`,
        `"incidentNumberWithPrefix"`,
        `"version"`,
      ];
      const values: Array<unknown> = [
        id.toString(),
        (data.project || projectId).toString(),
        "Payments webhooks are failing",
        `incident-${id.toString()}`,
        (data.stateId || identifiedStateId).toString(),
        ObjectID.generate().toString(),
        Boolean(data.isCreatedAutomatically),
        data.holdsMonitors === undefined ? true : data.holdsMonitors,
        data.changeMonitorStatusToId?.toString() || null,
        data.incidentNumber ?? 12,
        `INC-${data.incidentNumber ?? 12}`,
        1,
      ];

      if (data.pauseMonitoring !== undefined) {
        columns.push(`"pauseMonitoring"`);
        values.push(data.pauseMonitoring);
      }

      await database.query(
        `INSERT INTO "Incident" (${columns.join(", ")})
       VALUES (${values
         .map((_value: unknown, index: number): string => {
           return `$${index + 1}`;
         })
         .join(", ")})`,
        values,
      );

      for (const monitorId of data.monitorIds) {
        await database.query(
          `INSERT INTO "IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [id.toString(), monitorId.toString()],
        );
      }

      return id;
    }

    async function moveIncidentTo(
      incidentId: ObjectID,
      stateId: ObjectID,
      holdsMonitors?: boolean,
    ): Promise<void> {
      await database.query(
        `UPDATE "Incident" SET "currentIncidentStateId" = $2${
          holdsMonitors === undefined
            ? ""
            : `, "holdsMonitors" = ${holdsMonitors}`
        } WHERE "_id" = $1`,
        [incidentId.toString(), stateId.toString()],
      );
    }

    async function isPaused(monitorId: ObjectID): Promise<boolean> {
      const rows: Array<{ paused: boolean }> = await database.query(
        `SELECT "disableActiveMonitoringBecauseOfManualIncident" AS "paused" FROM "Monitor" WHERE "_id" = $1`,
        [monitorId.toString()],
      );
      return rows[0]!.paused;
    }

    interface TimelineRow {
      monitorStatusId: string;
      startsAt: Date;
      endsAt: Date | null;
      isMonitoringOff: boolean;
      rootCause: string | null;
    }

    async function timeline(monitorId: ObjectID): Promise<Array<TimelineRow>> {
      return database.query(
        `SELECT "monitorStatusId", "startsAt", "endsAt", "isMonitoringOff", "rootCause"
         FROM "MonitorStatusTimeline" WHERE "monitorId" = $1
        ORDER BY "startsAt" ASC, "endsAt" ASC NULLS LAST`,
        [monitorId.toString()],
      );
    }

    async function pausingIds(monitorId: ObjectID): Promise<Array<string>> {
      return (
        await MonitorIncidentPause.findIncidentsPausing({
          projectId: projectId,
          monitorId: monitorId,
        })
      )
        .map((incident: Incident): string => {
          return incident.id!.toString().toLowerCase();
        })
        .sort();
    }

    /*
     * The question the resolve used to ask before it gave a monitor back,
     * word for word (IncidentService.doesMonitorHasMoreActiveManualIncidents
     * before #11141): any open incident declared by hand on it.
     */
    async function oldQuestionCount(monitorId: ObjectID): Promise<number> {
      const count: PositiveNumber = await IncidentService.countBy({
        query: {
          monitors: QueryHelper.inRelationArray([monitorId]),
          currentIncidentStateId: QueryHelper.any(
            await IncidentStateService.getUnresolvedIncidentStateIds(projectId),
          ),
          isCreatedAutomatically: false,
        },
        props: {
          isRoot: true,
        },
      });

      return count.toNumber();
    }

    describe("the migration", () => {
      test("adds Keep Monitoring During Incidents off and Pause Monitoring on, so nothing changes for what is stored", async () => {
        const columns: Array<{
          table_name: string;
          column_name: string;
          is_nullable: string;
          column_default: string | null;
          data_type: string;
        }> = await database.query(
          `SELECT table_name, column_name, is_nullable, column_default, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND ((table_name = 'Monitor' AND column_name = 'keepMonitoringDuringIncidents')
              OR (table_name = 'Incident' AND column_name = 'pauseMonitoring'))
          ORDER BY table_name`,
        );

        expect(columns).toEqual([
          {
            table_name: "Incident",
            column_name: "pauseMonitoring",
            is_nullable: "NO",
            column_default: "true",
            data_type: "boolean",
          },
          {
            table_name: "Monitor",
            column_name: "keepMonitoringDuringIncidents",
            is_nullable: "NO",
            column_default: "false",
            data_type: "boolean",
          },
        ]);
      });

      test("a monitor and an incident written without the new columns read their defaults", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
        });

        const monitor: Monitor | null = await MonitorService.findOneById({
          id: monitorId,
          select: { keepMonitoringDuringIncidents: true },
          props: { isRoot: true },
        });
        const incident: Incident | null = await IncidentService.findOneById({
          id: incidentId,
          select: { pauseMonitoring: true },
          props: { isRoot: true },
        });

        expect(monitor?.keepMonitoringDuringIncidents).toBe(false);
        expect(incident?.pauseMonitoring).toBe(true);
      });
    });

    describe("findIncidentsPausing", () => {
      test("an open incident declared by hand that lists the monitor pauses it, in any open state", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const identified: ObjectID = await seedIncident({
          monitorIds: [monitorId],
        });
        const acknowledged: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          stateId: acknowledgedStateId,
          incidentNumber: 13,
        });

        expect(await pausingIds(monitorId)).toEqual(
          [identified, acknowledged]
            .map((id: ObjectID): string => {
              return id.toString().toLowerCase();
            })
            .sort(),
        );
      });

      test("one from before Holds Monitors was recorded (NULL) pauses it, as it always did", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const legacy: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          holdsMonitors: null,
        });

        expect(await pausingIds(monitorId)).toEqual([
          legacy.toString().toLowerCase(),
        ]);
      });

      test("none of these pause it: resolved, declared by OneUptime, holding nothing, Pause Monitoring off, another monitor's, another project's", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const otherMonitorId: ObjectID = await seedMonitor();

        await seedIncident({
          monitorIds: [monitorId],
          stateId: resolvedStateId,
        });
        await seedIncident({
          monitorIds: [monitorId],
          isCreatedAutomatically: true,
        });
        // Reopened: open again, holding nothing since its resolve gave its monitors back.
        await seedIncident({ monitorIds: [monitorId], holdsMonitors: false });
        await seedIncident({ monitorIds: [monitorId], pauseMonitoring: false });
        await seedIncident({ monitorIds: [otherMonitorId] });
        await seedIncident({
          monitorIds: [monitorId],
          project: ObjectID.generate(),
        });

        expect(await pausingIds(monitorId)).toEqual([]);
      });

      test("the old question counted the reopened incident, which holds nothing (#11141)", async () => {
        const monitorId: ObjectID = await seedMonitor();
        await seedIncident({ monitorIds: [monitorId], holdsMonitors: false });

        expect(await oldQuestionCount(monitorId)).toBe(1);
        expect(await pausingIds(monitorId)).toEqual([]);
      });
    });

    describe("syncPause writes what the incidents say", () => {
      test("paused while an open incident declared by hand pauses it, resumed once it is resolved", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
        });

        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(true);

        await moveIncidentTo(incidentId, resolvedStateId, false);

        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(false);
      });

      test("a monitor set to keep monitoring during incidents is never paused, and is resumed if it was", async () => {
        const monitorId: ObjectID = await seedMonitor({
          keepMonitoringDuringIncidents: true,
          isPausedByIncident: true,
        });
        await seedIncident({ monitorIds: [monitorId] });

        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(false);

        // Switched off again while the incident is open: paused at once.
        await database.query(
          `UPDATE "Monitor" SET "keepMonitoringDuringIncidents" = false WHERE "_id" = $1`,
          [monitorId.toString()],
        );
        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(true);
      });

      test("an incident declared with Pause Monitoring off leaves its monitor checked, and switched on pauses it", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          pauseMonitoring: false,
        });

        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(false);

        await database.query(
          `UPDATE "Incident" SET "pauseMonitoring" = true WHERE "_id" = $1`,
          [incidentId.toString()],
        );
        await MonitorIncidentPause.syncPause({
          projectId: projectId,
          monitorId: monitorId,
        });
        expect(await isPaused(monitorId)).toBe(true);
      });
    });

    describe("resolving gives the monitor back (IncidentService.markMonitorsActiveForMonitoring)", () => {
      test("a reopened incident no longer keeps the monitor paused after the incident that paused it is resolved (#11141)", async () => {
        const monitorId: ObjectID = await seedMonitor({
          isPausedByIncident: true,
        });

        // A, declared by hand: paused the monitor.
        const pausing: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          incidentNumber: 21,
        });
        // B: resolved once, so it gave its monitors back, and reopened since.
        await seedIncident({
          monitorIds: [monitorId],
          holdsMonitors: false,
          incidentNumber: 22,
        });

        await moveIncidentTo(pausing, resolvedStateId);
        await IncidentService.markMonitorsActiveForMonitoring(projectId, [
          new Monitor(monitorId),
        ]);

        /*
         * Before #11141 the resolve asked whether another open incident
         * declared by hand was on the monitor - B is - and left it paused.
         * B's own resolve gives back nothing (it holds nothing), so nothing
         * would ever have resumed it.
         */
        expect(await isPaused(monitorId)).toBe(false);

        // B is still open on it, so its status is left to its checks.
        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          offlineStatusId.toString(),
        );
      });

      test("one that another pausing incident still holds stays paused, in the status it holds", async () => {
        const monitorId: ObjectID = await seedMonitor({
          isPausedByIncident: true,
        });
        const first: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          incidentNumber: 31,
        });
        await seedIncident({ monitorIds: [monitorId], incidentNumber: 32 });

        await moveIncidentTo(first, resolvedStateId);
        await IncidentService.markMonitorsActiveForMonitoring(projectId, [
          new Monitor(monitorId),
        ]);

        expect(await isPaused(monitorId)).toBe(true);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          offlineStatusId.toString(),
        );
      });

      test("the last pausing incident's resolve resumes it and returns it to operational", async () => {
        const monitorId: ObjectID = await seedMonitor({
          isPausedByIncident: true,
        });
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
        });

        await moveIncidentTo(incidentId, resolvedStateId);
        await IncidentService.markMonitorsActiveForMonitoring(projectId, [
          new Monitor(monitorId),
        ]);

        expect(await isPaused(monitorId)).toBe(false);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows[rows.length - 1]!.monitorStatusId).toBe(
          operationalStatusId.toString(),
        );
        expect(rows[rows.length - 1]!.isMonitoringOff).toBe(false);
      });
    });

    describe("what paused time counts as", () => {
      // Moves the newest status event this far into the past, as if that much time had passed.
      async function backdateNewest(
        monitorId: ObjectID,
        agoMs: number,
      ): Promise<void> {
        const rows: Array<{ _id: string; startsAt: Date }> =
          await database.query(
            `SELECT "_id", "startsAt" FROM "MonitorStatusTimeline"
          WHERE "monitorId" = $1 ORDER BY "startsAt" DESC LIMIT 2`,
            [monitorId.toString()],
          );
        const at: Date = new Date(Date.now() - agoMs);

        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "startsAt" = $2 WHERE "_id" = $1`,
          [rows[0]!._id, at],
        );
        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "endsAt" = $2 WHERE "_id" = $1`,
          [rows[1]!._id, at],
        );
      }

      async function downtimeOverLastHours(
        monitorId: ObjectID,
        hours: number,
      ): Promise<MergedDowntimeTotals> {
        return MonitorStatusTimelineService.getMergedDowntimeSeconds({
          monitorIds: [monitorId],
          downtimeMonitorStatusIds: [offlineStatusId],
          startDate: new Date(Date.now() - hours * HOUR_MS),
          endDate: new Date(),
        });
      }

      test("paused by an incident that sets no status, the time is left out: its status is only what the last check saw", async () => {
        const monitorId: ObjectID = await seedMonitor({
          offlineSinceMs: 3 * HOUR_MS,
        });
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          incidentNumber: 41,
        });

        // What declaring it runs (IncidentService.onCreateSuccess).
        await IncidentService.disableActiveMonitoringIfManualIncident(
          incidentId,
        );

        expect(await isPaused(monitorId)).toBe(true);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.monitorStatusId).toBe(offlineStatusId.toString());
        expect(rows[1]!.isMonitoringOff).toBe(true);
        expect(rows[1]!.rootCause).toContain(
          "Monitoring is paused by [INC-41](",
        );
        expect(rows[1]!.rootCause).toContain(
          "declared by hand without a status for this monitor",
        );

        // Two of its three Offline hours were paused.
        await backdateNewest(monitorId, 2 * HOUR_MS);

        const totals: MergedDowntimeTotals = await downtimeOverLastHours(
          monitorId,
          3,
        );

        // Only the hour its checks saw it Offline counts, covered and down.
        expect(totals.coveredSeconds).toBeGreaterThan(3590);
        expect(totals.coveredSeconds).toBeLessThan(3610);
        expect(totals.downtimeSeconds).toBeGreaterThan(3590);
        expect(totals.downtimeSeconds).toBeLessThan(3610);
      });

      test("paused by an incident that puts the monitor in its status, the time counts as that status", async () => {
        const monitorId: ObjectID = await seedMonitor({
          offlineSinceMs: 3 * HOUR_MS,
        });
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          changeMonitorStatusToId: offlineStatusId,
        });

        await IncidentService.disableActiveMonitoringIfManualIncident(
          incidentId,
        );

        expect(await isPaused(monitorId)).toBe(true);

        // Nothing marks the time: it counts, as the status the incident declared.
        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(1);

        const totals: MergedDowntimeTotals = await downtimeOverLastHours(
          monitorId,
          3,
        );
        expect(totals.downtimeSeconds).toBeGreaterThan(3 * 3600 - 10);
      });

      test("the time left out ends when the incident is resolved: from there the monitor's time counts again", async () => {
        const monitorId: ObjectID = await seedMonitor({
          offlineSinceMs: 3 * HOUR_MS,
        });
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
        });

        await IncidentService.disableActiveMonitoringIfManualIncident(
          incidentId,
        );
        await backdateNewest(monitorId, 2 * HOUR_MS);

        await moveIncidentTo(incidentId, resolvedStateId);
        await IncidentService.markMonitorsActiveForMonitoring(projectId, [
          new Monitor(monitorId),
        ]);

        expect(await isPaused(monitorId)).toBe(false);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.monitorStatusId).toBe(operationalStatusId.toString());
        expect(rows[2]!.isMonitoringOff).toBe(false);

        // The Offline hour before the pause still counts; the paused two do not.
        const totals: MergedDowntimeTotals = await downtimeOverLastHours(
          monitorId,
          3,
        );
        expect(totals.downtimeSeconds).toBeGreaterThan(3590);
        expect(totals.downtimeSeconds).toBeLessThan(3610);
      });

      test("resumed while already operational, a row of its own ends the time left out", async () => {
        const monitorId: ObjectID = await seedMonitor();
        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "monitorStatusId" = $2 WHERE "monitorId" = $1`,
          [monitorId.toString(), operationalStatusId.toString()],
        );
        const incidentId: ObjectID = await seedIncident({
          monitorIds: [monitorId],
          incidentNumber: 51,
        });

        await MonitorIncidentPause.syncMonitors({
          projectId: projectId,
          monitorIds: [monitorId],
        });
        expect((await timeline(monitorId))[1]!.isMonitoringOff).toBe(true);

        await moveIncidentTo(incidentId, resolvedStateId);
        await IncidentService.markMonitorsActiveForMonitoring(projectId, [
          new Monitor(monitorId),
        ]);

        const rows: Array<TimelineRow> = await timeline(monitorId);
        expect(rows).toHaveLength(3);
        expect(rows[2]!.monitorStatusId).toBe(operationalStatusId.toString());
        expect(rows[2]!.isMonitoringOff).toBe(false);
        expect(rows[2]!.rootCause).toBe(
          "Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.",
        );
      });

      test("working the monitor out again writes nothing more", async () => {
        const monitorId: ObjectID = await seedMonitor();
        await seedIncident({ monitorIds: [monitorId] });

        for (let attempt: number = 0; attempt < 3; attempt++) {
          await MonitorIncidentPause.syncMonitors({
            projectId: projectId,
            monitorIds: [monitorId],
          });
        }

        expect(await timeline(monitorId)).toHaveLength(2);
        expect(await isPaused(monitorId)).toBe(true);
      });
    });
  },
);
