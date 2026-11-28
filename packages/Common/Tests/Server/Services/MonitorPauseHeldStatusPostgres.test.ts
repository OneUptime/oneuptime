import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
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
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MonitorIncidentPause from "../../../Server/Utils/Monitor/MonitorIncidentPause";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import { readStatusChangeNote } from "../../../Utils/Monitor/StatusChangeNotes";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
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
 * WHICH STATUS A MONITOR SEVERAL PAUSES HOLD IS IN, AGAINST POSTGRES
 * (issue #11432).
 *
 * Incidents declared by hand (#11141) and scheduled maintenance events
 * (#11301) pause a monitor and can each put it in a status of their own
 * (Change Monitor Status to). Several can hold one monitor at once. The
 * monitor is in the most severe status they set - the one furthest down the
 * project's list of monitor statuses - and when one lets go, or starts, the
 * monitor is in the most severe status of what holds it from there.
 *
 * Each pause used to leave its own status behind. Two incidents, INC-1 in
 * Major Outage and INC-2 (declared later) in Degraded: declaring INC-2 put
 * the monitor in Degraded while INC-1 still said Major Outage, and resolving
 * INC-2 left it Degraded until INC-1 was resolved too. Two maintenance
 * events: the end of the one that started last left the monitor in its
 * status while the other still held the monitor.
 *
 * The first describe drives every combination of two pauses - two
 * incidents, two events, an incident and an event either way, each with
 * Degraded, Major Outage or no status - started one after the other and let
 * go in each order, then drawn sequences of three and four, starts and
 * releases interleaved. After every step the monitor's status, its pause
 * flags and whether its time is left out of uptime are held to a model of
 * the rule written apart from the code. On the code before #11432 most of
 * these sequences end in the wrong status; the suite lists each wrong step.
 * The describes after it name the cases, with the Status Timeline's notes,
 * and the edits that change what a pause sets.
 *
 * Every start and every release comes through the services' own paths: an
 * incident declared (IncidentService's status change on create, then its
 * pause), resolved (markMonitorsActiveForMonitoring) or edited; an event
 * moving into Ongoing and Ended (the state timeline's onCreateSuccess), or
 * edited. The real services run on real rows in a uniquely named schema
 * holding structure-only clones (LIKE ... INCLUDING ALL) of the tables they
 * read and write; the schema is dropped afterwards. Only the monitor's own
 * update hooks, the per-monitor lock (in memory), feed items, network
 * sites, measurements, chat channels and workflows are stubbed.
 *
 * Opt in with RUN_POSTGRES_MONITOR_PAUSE_HELD_STATUS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITOR_PAUSE_HELD_STATUS_TESTS=true \
 *   MONITOR_PAUSE_HELD_STATUS_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_PAUSE_HELD_STATUS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorPauseHeldStatusPostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_PAUSE_HELD_STATUS_TESTS"] === "true"
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

/*
 * The project's list of monitor statuses, healthiest first: its Order. The
 * monitor's own checks last saw it Operational.
 */
type StatusName =
  | "Operational"
  | "Degraded"
  | "Under Maintenance"
  | "Partial Outage"
  | "Major Outage";

const STATUS_ORDER: Array<StatusName> = [
  "Operational",
  "Degraded",
  "Under Maintenance",
  "Partial Outage",
  "Major Outage",
];

type PauseKind = "incident" | "maintenance";

// A pause of a monitor: an incident declared by hand or an event, with its status or none.
interface PausePlan {
  kind: PauseKind;
  status: StatusName | null;
}

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
  createdItem: ScheduledMaintenanceStateTimeline,
) => Promise<ScheduledMaintenanceStateTimeline>;

interface TimelineRow {
  monitorStatusId: string;
  isMonitoringOff: boolean;
  rootCause: string | null;
}

interface MonitorRow {
  statusId: string;
  incident: boolean;
  maintenance: boolean;
}

function expectAbout(seconds: number, expected: number): void {
  expect(seconds).toBeGreaterThan(expected - SLACK_SECONDS);
  expect(seconds).toBeLessThan(expected + SLACK_SECONDS);
}

/*
 * THE MODEL: the rule as the issue states it, written apart from the code.
 * A monitor several pauses hold is in the most severe status they set. A
 * pause that starts with a status puts the monitor in it unless a more
 * severe one holds it; one that lets go leaves the monitor in the most
 * severe status of what still holds it - and when that sets none, does what
 * a release did before (#11301): the monitor keeps its status while another
 * pause of the same kind still holds it (another incident open on it, or
 * another event in progress), and goes back to operational otherwise.
 */
class HeldStatusModel {
  public holders: Array<{ key: number; plan: PausePlan }> = [];
  public status: StatusName = "Operational";

  public start(key: number, plan: PausePlan): void {
    this.holders.push({ key: key, plan: plan });

    const held: StatusName | null = this.heldStatus();

    if (plan.status && held) {
      this.status = held;
    }
  }

  public release(key: number): void {
    const released: PausePlan = this.holders.find(
      (holder: { key: number }): boolean => {
        return holder.key === key;
      },
    )!.plan;

    this.holders = this.holders.filter((holder: { key: number }): boolean => {
      return holder.key !== key;
    });

    const held: StatusName | null = this.heldStatus();

    if (held) {
      this.status = held;
      return;
    }

    const isAnotherOfItsKindHolding: boolean = this.holders.some(
      (holder: { plan: PausePlan }): boolean => {
        return holder.plan.kind === released.kind;
      },
    );

    if (!isAnotherOfItsKindHolding) {
      this.status = "Operational";
    }
  }

  public heldStatus(): StatusName | null {
    let held: StatusName | null = null;

    for (const holder of this.holders) {
      const status: StatusName | null = holder.plan.status;

      if (
        status &&
        (!held || STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(held))
      ) {
        held = status;
      }
    }

    return held;
  }

  public isPausedByIncident(): boolean {
    return this.holders.some((holder: { plan: PausePlan }): boolean => {
      return holder.plan.kind === "incident";
    });
  }

  public isPausedForMaintenance(): boolean {
    return this.holders.some((holder: { plan: PausePlan }): boolean => {
      return holder.plan.kind === "maintenance";
    });
  }

  // Left out of uptime while something holds it and none of it sets a status.
  public isLeftOut(): boolean {
    return this.holders.length > 0 && this.heldStatus() === null;
  }
}

function describePlan(plan: PausePlan): string {
  return `${plan.kind === "incident" ? "incident" : "event"} (${plan.status || "no status"})`;
}

describePostgres(
  "Which status a monitor several pauses hold is in, on a migrated Postgres",
  () => {
    const schema: string = `pause_held_status_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let held: Set<string>;

    // A project of its own per test: the states a project has are kept per process.
    let projectId: ObjectID;
    let statusIds: Record<StatusName, ObjectID>;
    let identifiedStateId: ObjectID;
    let resolvedStateId: ObjectID;
    let scheduledStateId: ObjectID;
    let ongoingStateId: ObjectID;
    let endedStateId: ObjectID;
    let nextRecordNumber: number;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_PAUSE_HELD_STATUS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_PAUSE_HELD_STATUS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_PAUSE_HELD_STATUS_TEST_DATABASE_NAME"] ||
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
      nextRecordNumber = 1;
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
       VALUES ($1, 'Pause held status test', $2, 1)`,
        [projectId.toString(), `pause-held-status-${projectId.toString()}`],
      );

      statusIds = {} as Record<StatusName, ObjectID>;

      for (const [priority, name] of STATUS_ORDER.entries()) {
        statusIds[name] = await seedMonitorStatus({
          name: name,
          priority: priority,
          isOperationalState: name === "Operational",
          isOfflineState: name === "Major Outage",
        });
      }

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
      endedStateId = await seedRecordState("ScheduledMaintenanceState", {
        name: "Ended",
        order: 3,
        flag: "isEndedState",
      });
      await seedRecordState("ScheduledMaintenanceState", {
        name: "Completed",
        order: 4,
        flag: "isResolvedState",
      });
    }

    async function seedMonitorStatus(data: {
      name: string;
      priority: number;
      isOperationalState?: boolean;
      isOfflineState?: boolean;
      createdAt?: Date;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "MonitorStatus"
       ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState", "createdAt", "version")
       VALUES ($1, $2, $3, $4, '#000000', $5, $6, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          data.name,
          `${data.name.toLowerCase().replace(/ /g, "-")}-${id.toString()}`,
          data.priority,
          Boolean(data.isOperationalState),
          Boolean(data.isOfflineState),
          data.createdAt || new Date(Date.now() - 30 * 24 * HOUR_MS),
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

    // A monitor its last check saw in a status, this long ago.
    async function seedMonitor(
      data: { statusId?: ObjectID; sinceMs?: number } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const statusId: ObjectID = data.statusId || statusIds["Operational"];

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

    /*
     * An incident declared by hand, as IncidentService.onCreateSuccess runs
     * it: its monitors put in its status, if it has one, then paused.
     */
    async function declareIncident(data: {
      monitorIds: Array<ObjectID>;
      status?: StatusName | null | undefined;
      pauseMonitoring?: boolean | undefined;
    }): Promise<{ id: ObjectID; name: string }> {
      const id: ObjectID = ObjectID.generate();
      const number: number = nextRecordNumber++;
      const statusId: ObjectID | null = data.status
        ? statusIds[data.status]
        : null;

      await database.query(
        `INSERT INTO "Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "isCreatedAutomatically",
        "holdsMonitors", "pauseMonitoring", "changeMonitorStatusToId", "incidentNumber", "incidentNumberWithPrefix", "version")
       VALUES ($1, $2, 'Checkout is failing', $3, $4, $5, false, true, $6, $7, $8, $9, 1)`,
        [
          id.toString(),
          projectId.toString(),
          `incident-${id.toString()}`,
          identifiedStateId.toString(),
          ObjectID.generate().toString(),
          data.pauseMonitoring !== false,
          statusId?.toString() || null,
          number,
          `INC-${number}`,
        ],
      );

      for (const monitorId of data.monitorIds) {
        await database.query(
          `INSERT INTO "IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [id.toString(), monitorId.toString()],
        );
      }

      if (statusId) {
        const createdItem: Incident = new Incident(id);
        createdItem.projectId = projectId;
        createdItem.incidentNumber = number;
        createdItem.incidentNumberWithPrefix = `INC-${number}`;
        createdItem.changeMonitorStatusToId = statusId;
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

      await IncidentService.disableActiveMonitoringIfManualIncident(id);

      return { id: id, name: `INC-${number}` };
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

    // An event that names the monitors, still scheduled.
    async function seedEvent(data: {
      monitorIds: Array<ObjectID>;
      status?: StatusName | null | undefined;
    }): Promise<{ id: ObjectID; name: string }> {
      const id: ObjectID = ObjectID.generate();
      const number: number = nextRecordNumber++;

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
          data.status ? statusIds[data.status].toString() : null,
          number,
          `SM-${number}`,
        ],
      );

      for (const monitorId of data.monitorIds) {
        await database.query(
          `INSERT INTO "ScheduledMaintenanceMonitor" ("scheduledMaintenanceId", "monitorId") VALUES ($1, $2)`,
          [id.toString(), monitorId.toString()],
        );
      }

      return { id: id, name: `SM-${number}` };
    }

    /*
     * The event moves into a state, as every move does: a new row of its
     * state timeline, whose onCreateSuccess starts or ends what the state
     * says.
     */
    async function moveEventInto(
      eventId: ObjectID,
      stateId: ObjectID,
    ): Promise<void> {
      const row: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      row.id = ObjectID.generate();
      row.projectId = projectId;
      row.scheduledMaintenanceId = eventId;
      row.scheduledMaintenanceStateId = stateId;
      row.startsAt = new Date();

      await database.query(
        `INSERT INTO "ScheduledMaintenanceStateTimeline"
       ("_id", "projectId", "scheduledMaintenanceId", "scheduledMaintenanceStateId", "startsAt", "version")
       VALUES ($1, $2, $3, $4, $5, 1)`,
        [
          row.id.toString(),
          projectId.toString(),
          eventId.toString(),
          stateId.toString(),
          row.startsAt,
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

    async function startEvent(data: {
      monitorIds: Array<ObjectID>;
      status?: StatusName | null | undefined;
    }): Promise<{ id: ObjectID; name: string }> {
      const event: { id: ObjectID; name: string } = await seedEvent(data);
      await moveEventInto(event.id, ongoingStateId);
      return event;
    }

    async function endEvent(eventId: ObjectID): Promise<void> {
      await moveEventInto(eventId, endedStateId);
    }

    async function monitorRow(monitorId: ObjectID): Promise<MonitorRow> {
      const rows: Array<MonitorRow> = await database.query(
        `SELECT "currentMonitorStatusId"::text AS "statusId",
                "disableActiveMonitoringBecauseOfManualIncident" AS "incident",
                "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" AS "maintenance"
           FROM "Monitor" WHERE "_id" = $1`,
        [monitorId.toString()],
      );
      return rows[0]!;
    }

    async function timeline(monitorId: ObjectID): Promise<Array<TimelineRow>> {
      return database.query(
        `SELECT "monitorStatusId"::text AS "monitorStatusId", "isMonitoringOff", "rootCause"
         FROM "MonitorStatusTimeline" WHERE "monitorId" = $1
        ORDER BY "startsAt" ASC, "endsAt" ASC NULLS LAST`,
        [monitorId.toString()],
      );
    }

    async function latest(monitorId: ObjectID): Promise<TimelineRow> {
      const rows: Array<TimelineRow> = await timeline(monitorId);
      return rows[rows.length - 1]!;
    }

    function nameOf(statusId: string): string {
      return (
        STATUS_ORDER.find((name: StatusName): boolean => {
          return statusIds[name].toString() === statusId;
        }) || statusId
      );
    }

    async function statusOf(monitorId: ObjectID): Promise<string> {
      return nameOf((await monitorRow(monitorId)).statusId);
    }

    function incidentLink(incident: { id: ObjectID; name: string }): string {
      return `[${incident.name}](https://oneuptime.example/incidents/${incident.id.toString()})`;
    }

    function eventLink(event: { id: ObjectID; name: string }): string {
      return `[${event.name}](https://oneuptime.example/scheduled-maintenance/${event.id.toString()})`;
    }

    /*
     * THE ENGINE. Runs one sequence of starts and releases on a monitor of
     * its own through the services, and after every step holds the monitor
     * to the model: its status (on the monitor and on its newest status
     * event), its two pause flags, and whether its time is left out of
     * uptime. Returns every step that differs, so a run on code that gets
     * the rule wrong lists them all.
     */
    async function runSequence(data: {
      plans: Array<PausePlan>;
      steps: Array<{ action: "start" | "release"; index: number }>;
    }): Promise<Array<string>> {
      const monitorId: ObjectID = await seedMonitor();
      const model: HeldStatusModel = new HeldStatusModel();
      const live: Map<number, { id: ObjectID; name: string }> = new Map();
      const wrong: Array<string> = [];

      const sequence: string = data.steps
        .map((step: { action: string; index: number }): string => {
          return `${step.action} ${describePlan(data.plans[step.index]!)}#${step.index + 1}`;
        })
        .join(", ");

      for (const [stepNumber, step] of data.steps.entries()) {
        const plan: PausePlan = data.plans[step.index]!;

        if (step.action === "start") {
          live.set(
            step.index,
            plan.kind === "incident"
              ? await declareIncident({
                  monitorIds: [monitorId],
                  status: plan.status,
                })
              : await startEvent({
                  monitorIds: [monitorId],
                  status: plan.status,
                }),
          );
          model.start(step.index, plan);
        } else {
          const record: { id: ObjectID } = live.get(step.index)!;

          if (plan.kind === "incident") {
            await resolveIncident(record.id, [monitorId]);
          } else {
            await endEvent(record.id);
          }

          model.release(step.index);
        }

        const row: MonitorRow = await monitorRow(monitorId);
        const newest: TimelineRow = await latest(monitorId);
        const at: string = `[${sequence}] after step ${stepNumber + 1} (${step.action} #${step.index + 1})`;

        if (nameOf(row.statusId) !== model.status) {
          wrong.push(
            `${at}: the monitor is ${nameOf(row.statusId)}, not ${model.status}`,
          );
        }

        if (newest.monitorStatusId !== row.statusId) {
          wrong.push(
            `${at}: the newest status event is ${nameOf(newest.monitorStatusId)}, the monitor ${nameOf(row.statusId)}`,
          );
        }

        if (row.incident !== model.isPausedByIncident()) {
          wrong.push(
            `${at}: paused by an incident is ${row.incident}, not ${model.isPausedByIncident()}`,
          );
        }

        if (row.maintenance !== model.isPausedForMaintenance()) {
          wrong.push(
            `${at}: paused for maintenance is ${row.maintenance}, not ${model.isPausedForMaintenance()}`,
          );
        }

        if (newest.isMonitoringOff !== model.isLeftOut()) {
          wrong.push(
            `${at}: its time left out of uptime is ${newest.isMonitoringOff}, not ${model.isLeftOut()}`,
          );
        }
      }

      return wrong;
    }

    const TWO_PAUSE_STATUSES: Array<StatusName | null> = [
      "Degraded",
      "Major Outage",
      null,
    ];

    describe("every combination of overlapping pauses, released in each order", () => {
      test.each([
        ["two incidents declared by hand", "incident", "incident"],
        ["two maintenance events", "maintenance", "maintenance"],
        ["an incident, then maintenance", "incident", "maintenance"],
        ["maintenance, then an incident", "maintenance", "incident"],
      ] as Array<[string, PauseKind, PauseKind]>)(
        "%s: each with Degraded, Major Outage or no status, let go in each order",
        async (_label: string, firstKind: PauseKind, secondKind: PauseKind) => {
          const wrong: Array<string> = [];
          let sequences: number = 0;

          for (const firstStatus of TWO_PAUSE_STATUSES) {
            for (const secondStatus of TWO_PAUSE_STATUSES) {
              for (const releaseOrder of [
                [0, 1],
                [1, 0],
              ]) {
                sequences++;
                wrong.push(
                  ...(await runSequence({
                    plans: [
                      { kind: firstKind, status: firstStatus },
                      { kind: secondKind, status: secondStatus },
                    ],
                    steps: [
                      { action: "start", index: 0 },
                      { action: "start", index: 1 },
                      ...releaseOrder.map((index: number) => {
                        return { action: "release" as const, index: index };
                      }),
                    ],
                  })),
                );
              }
            }
          }

          expect(sequences).toBe(18);
          expect(wrong).toEqual([]);
        },
      );

      /*
       * Three and four pauses of either kind, with any of the statuses or
       * none, started and let go in drawn orders - releases between
       * starts too - from fixed seeds.
       */
      test.each([
        [3, 11432, 40],
        [4, 114320, 16],
      ])(
        "%i pauses at once, drawn from seed %i (%i sequences)",
        async (pauseCount: number, seed: number, sequenceCount: number) => {
          const random: SeededRandom = seededRandom(seed);
          const statuses: Array<StatusName | null> = [
            "Degraded",
            "Under Maintenance",
            "Partial Outage",
            "Major Outage",
            null,
          ];
          const wrong: Array<string> = [];

          for (let draw: number = 0; draw < sequenceCount; draw++) {
            const plans: Array<PausePlan> = [];

            for (let index: number = 0; index < pauseCount; index++) {
              plans.push({
                kind: random(2) === 0 ? "incident" : "maintenance",
                status: statuses[random(statuses.length)]!,
              });
            }

            // Any order where each pause starts before it is let go.
            const steps: Array<{
              action: "start" | "release";
              index: number;
            }> = [];
            const notStarted: Array<number> = plans.map(
              (_plan: PausePlan, index: number): number => {
                return index;
              },
            );
            const running: Array<number> = [];

            while (notStarted.length > 0 || running.length > 0) {
              const isStart: boolean =
                running.length === 0 ||
                (notStarted.length > 0 && random(3) !== 0);

              if (isStart) {
                const index: number = notStarted.splice(
                  random(notStarted.length),
                  1,
                )[0]!;
                running.push(index);
                steps.push({ action: "start", index: index });
              } else {
                const index: number = running.splice(
                  random(running.length),
                  1,
                )[0]!;
                steps.push({ action: "release", index: index });
              }
            }

            wrong.push(...(await runSequence({ plans: plans, steps: steps })));
          }

          expect(wrong).toEqual([]);
        },
      );
    });

    describe("two incidents declared by hand, each with a status", () => {
      // The issue's example.
      test("INC-1 in Major Outage, INC-2 in Degraded: the monitor stays in Major Outage while INC-1 holds it, whichever is resolved first", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const first: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        // Declaring the lesser one used to put the monitor in Degraded.
        const second: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Degraded",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");
        expect(await timeline(monitorId)).toHaveLength(2);

        // Resolving INC-2 used to leave the monitor in INC-2's Degraded.
        await resolveIncident(second.id, [monitorId]);
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Major Outage"].toString(),
          incident: true,
          maintenance: false,
        });
        expect(await timeline(monitorId)).toHaveLength(2);

        await resolveIncident(first.id, [monitorId]);
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Operational"].toString(),
          incident: false,
          maintenance: false,
        });
      });

      test("resolving the more severe one first puts the monitor in the other's status, with a note that names it", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const first: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        const second: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Degraded",
        });

        await resolveIncident(first.id, [monitorId]);

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Degraded"].toString(),
          incident: true,
          maintenance: false,
        });

        const newest: TimelineRow = await latest(monitorId);
        expect(newest.isMonitoringOff).toBe(false);
        expect(newest.rootCause).toBe(
          `${incidentLink(second)} is still open, so the monitor is in the status it puts it in.`,
        );
        // The Dashboard reads it as its note, in the reader's language.
        expect(readStatusChangeNote(newest.rootCause!)?.values).toEqual({
          incident: incidentLink(second),
        });

        await resolveIncident(second.id, [monitorId]);
        expect(await statusOf(monitorId)).toBe("Operational");
      });

      test("a more severe incident declared later shows at once, and the earlier one's status comes back when it is resolved", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({ monitorIds: [monitorId], status: "Degraded" });
        const severe: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        await resolveIncident(severe.id, [monitorId]);
        expect(await statusOf(monitorId)).toBe("Degraded");
      });

      test("an incident's status counts in uptime for as long as it is the most severe holding the monitor", async () => {
        const monitorId: ObjectID = await seedMonitor({
          sinceMs: 3 * HOUR_MS,
        });

        await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        await declareIncident({ monitorIds: [monitorId], status: "Degraded" });

        // Operational for an hour, then two hours with both open.
        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "MonitorStatusTimeline" WHERE "monitorId" = $1 ORDER BY "startsAt" DESC`,
          [monitorId.toString()],
        );
        expect(rows).toHaveLength(2);
        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "startsAt" = $2 WHERE "_id" = $1`,
          [rows[0]!._id, new Date(Date.now() - 2 * HOUR_MS)],
        );
        await database.query(
          `UPDATE "MonitorStatusTimeline" SET "endsAt" = $2 WHERE "_id" = $1`,
          [rows[1]!._id, new Date(Date.now() - 2 * HOUR_MS)],
        );

        // Two hours down: the Major Outage the open INC-1 still declares.
        const totals: MergedDowntimeTotals =
          await MonitorStatusTimelineService.getMergedDowntimeSeconds({
            monitorIds: [monitorId],
            downtimeMonitorStatusIds: [statusIds["Major Outage"]],
            startDate: new Date(Date.now() - 3 * HOUR_MS),
            endDate: new Date(),
          });
        expectAbout(totals.coveredSeconds, 3 * HOUR_SECONDS);
        expectAbout(totals.downtimeSeconds, 2 * HOUR_SECONDS);
      });

      test("with an incident that sets no status still open, the monitor keeps its status as before: an incident is still open on it", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({ monitorIds: [monitorId] });
        const withStatus: { id: ObjectID; name: string } =
          await declareIncident({
            monitorIds: [monitorId],
            status: "Partial Outage",
          });
        expect(await statusOf(monitorId)).toBe("Partial Outage");

        await resolveIncident(withStatus.id, [monitorId]);

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Partial Outage"].toString(),
          incident: true,
          maintenance: false,
        });
        // Nothing still pausing it sets a status: its time is left out.
        expect((await latest(monitorId)).isMonitoringOff).toBe(true);
      });
    });

    describe("two maintenance events, each with a status", () => {
      test("the end of the more severe event puts the monitor in the other's status, with the note", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const lesser: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        const severe: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        expect(await statusOf(monitorId)).toBe("Partial Outage");

        // The end of the one that started last used to leave its status.
        await endEvent(severe.id);

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Under Maintenance"].toString(),
          incident: false,
          maintenance: true,
        });
        const newest: TimelineRow = await latest(monitorId);
        expect(newest.rootCause).toBe(
          `Scheduled maintenance (${eventLink(lesser)}) is still in progress, so the monitor is in the status it puts it in.`,
        );
        expect(newest.isMonitoringOff).toBe(false);

        await endEvent(lesser.id);
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Operational"].toString(),
          incident: false,
          maintenance: false,
        });
      });

      test("the end of the lesser event changes nothing: the more severe still holds the monitor", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const severe: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        // Starting the lesser one used to put the monitor in its status.
        const lesser: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        expect(await statusOf(monitorId)).toBe("Partial Outage");

        await endEvent(lesser.id);
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Partial Outage"].toString(),
          incident: false,
          maintenance: true,
        });
        expect(await timeline(monitorId)).toHaveLength(2);

        await endEvent(severe.id);
        expect(await statusOf(monitorId)).toBe("Operational");
      });

      /*
       * When nothing still holding the monitor sets a status, a release
       * does what it did before (#11301): another event still in progress
       * keeps the monitor in the status it has, its time left out.
       */
      test("one ends while the other, with no status, still runs: the monitor keeps its status, its time left out, as before", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const withStatus: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        const withoutStatus: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
        });

        await endEvent(withStatus.id);

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Under Maintenance"].toString(),
          incident: false,
          maintenance: true,
        });
        const newest: TimelineRow = await latest(monitorId);
        expect(newest.isMonitoringOff).toBe(true);
        expect(newest.rootCause).toBe(
          `Monitoring is paused by scheduled maintenance (${eventLink(withoutStatus)}), with no status set for this monitor. Nothing checks the monitor until the maintenance ends, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`,
        );
      });
    });

    describe("incidents and maintenance together", () => {
      test("an outage incident open when maintenance starts: the incident's more severe status stays, and stays when the event ends", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const incident: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        await endEvent(event.id);
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Major Outage"].toString(),
          incident: true,
          maintenance: false,
        });

        // Resolved while the event still ran, it would be Under Maintenance; resolved now, operational.
        await resolveIncident(incident.id, [monitorId]);
        expect(await statusOf(monitorId)).toBe("Operational");
      });

      test("maintenance more severe than the incident open on its monitor shows, and the incident's status comes back when it ends", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const incident: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Degraded",
        });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        expect(await statusOf(monitorId)).toBe("Partial Outage");

        await endEvent(event.id);
        expect(await statusOf(monitorId)).toBe("Degraded");
        expect((await latest(monitorId)).rootCause).toBe(
          `${incidentLink(incident)} is still open, so the monitor is in the status it puts it in.`,
        );
      });

      test("three at once: the note says which of what still pauses the monitor sets the most severe status", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({ monitorIds: [monitorId], status: "Degraded" });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        const severe: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        await resolveIncident(severe.id, [monitorId]);

        expect(await statusOf(monitorId)).toBe("Under Maintenance");
        expect((await latest(monitorId)).rootCause).toBe(
          `Of what still pauses this monitor, scheduled maintenance (${eventLink(event)}) puts it in the most severe status, so the monitor is in that status.`,
        );
      });

      /*
       * An incident with Pause Monitoring off holds nothing: what pauses the
       * monitor decides its status while it does. Put on it, the
       * incident's status would only be taken back the moment the pause
       * was worked out again - two status changes, owners told of both.
       */
      test("an incident with Pause Monitoring off holds nothing: its status goes on a monitor only while nothing pausing it sets one", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });
        await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
          pauseMonitoring: false,
        });
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Under Maintenance"].toString(),
          incident: false,
          maintenance: true,
        });
        // Not even for a moment: no row was written and taken back.
        expect(await timeline(monitorId)).toHaveLength(2);

        // Maintenance that sets no status: the incident's status goes on it.
        const other: ObjectID = await seedMonitor();
        await startEvent({ monitorIds: [other] });
        await declareIncident({
          monitorIds: [other],
          status: "Degraded",
          pauseMonitoring: false,
        });
        expect(await statusOf(other)).toBe("Degraded");
        // Its time is still left out, as before: what pauses it sets no status.
        expect((await latest(other)).isMonitoringOff).toBe(true);
      });

      test("each monitor of one incident or event takes what holds it, on its own", async () => {
        const quiet: ObjectID = await seedMonitor();
        const heldWorse: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [heldWorse],
          status: "Major Outage",
        });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [quiet, heldWorse],
          status: "Under Maintenance",
        });

        expect(await statusOf(quiet)).toBe("Under Maintenance");
        expect(await statusOf(heldWorse)).toBe("Major Outage");

        await endEvent(event.id);
        expect(await statusOf(quiet)).toBe("Operational");
        expect(await statusOf(heldWorse)).toBe("Major Outage");
      });
    });

    describe("a change to what a pause sets", () => {
      async function editIncidentStatus(
        incident: { id: ObjectID; name: string },
        from: StatusName,
        to: StatusName,
      ): Promise<void> {
        await database.query(
          `UPDATE "Incident" SET "changeMonitorStatusToId" = $2 WHERE "_id" = $1`,
          [incident.id.toString(), statusIds[to].toString()],
        );

        // What IncidentService.onUpdateSuccess does with the edit, once it is written.
        await (
          IncidentService as unknown as {
            updateMonitorsForIncidentEdit: (data: {
              projectId: ObjectID;
              incidentId: ObjectID;
              incidentNumberDisplay: string;
              carryForward: unknown;
              props: { isRoot: boolean };
            }) => Promise<boolean>;
          }
        ).updateMonitorsForIncidentEdit({
          projectId: projectId,
          incidentId: incident.id,
          incidentNumberDisplay: incident.name,
          carryForward: {
            monitorsRemoved: [],
            monitorsAdded: [],
            holdsMonitorsBeforeUpdate: true,
            oldChangeMonitorStatusIdTo: statusIds[from],
            newMonitorChangeStatusIdTo: statusIds[to],
            isChangeMonitorStatusToCleared: false,
          },
          props: { isRoot: true },
        });
      }

      test("an incident edited to a lesser status: the monitor goes to the most severe of what still holds it", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const first: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        const second: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        await editIncidentStatus(first, "Major Outage", "Degraded");

        expect(await statusOf(monitorId)).toBe("Partial Outage");
        expect((await latest(monitorId)).rootCause).toBe(
          `Of what still pauses this monitor, ${incidentLink(second)} puts it in the most severe status, so the monitor is in that status.`,
        );

        // Edited back up, it is the most severe again.
        await editIncidentStatus(first, "Degraded", "Major Outage");
        expect(await statusOf(monitorId)).toBe("Major Outage");
      });

      test("an incident's status taken away: the other's shows, or, with none, the monitor keeps its status and its time is left out", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const first: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        await declareIncident({ monitorIds: [monitorId], status: "Degraded" });

        await database.query(
          `UPDATE "Incident" SET "changeMonitorStatusToId" = NULL WHERE "_id" = $1`,
          [first.id.toString()],
        );
        // What IncidentService.onUpdateSuccess does once the status is cleared.
        await IncidentService.disableActiveMonitoringIfManualIncident(first.id);

        expect(await statusOf(monitorId)).toBe("Degraded");
        expect((await latest(monitorId)).isMonitoringOff).toBe(false);

        const alone: ObjectID = await seedMonitor();
        const only: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [alone],
          status: "Partial Outage",
        });
        await database.query(
          `UPDATE "Incident" SET "changeMonitorStatusToId" = NULL WHERE "_id" = $1`,
          [only.id.toString()],
        );
        await IncidentService.disableActiveMonitoringIfManualIncident(only.id);

        expect(await statusOf(alone)).toBe("Partial Outage");
        expect((await latest(alone)).isMonitoringOff).toBe(true);
      });

      test("Pause Monitoring switched off on the incident holding the monitor in the most severe status: the next one's shows", async () => {
        const monitorId: ObjectID = await seedMonitor();

        const first: { id: ObjectID; name: string } = await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });

        await database.query(
          `UPDATE "Incident" SET "pauseMonitoring" = false WHERE "_id" = $1`,
          [first.id.toString()],
        );
        await IncidentService.disableActiveMonitoringIfManualIncident(first.id);

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Under Maintenance"].toString(),
          incident: false,
          maintenance: true,
        });

        // Switched back on, it holds the monitor in its status again.
        await database.query(
          `UPDATE "Incident" SET "pauseMonitoring" = true WHERE "_id" = $1`,
          [first.id.toString()],
        );
        await IncidentService.disableActiveMonitoringIfManualIncident(first.id);
        expect(await statusOf(monitorId)).toBe("Major Outage");
      });

      test("Keep monitoring during incidents turned on: maintenance's status shows, and turned off again the incident's", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });

        // What MonitorService.onUpdateSuccess does once the switch is saved.
        await database.query(
          `UPDATE "Monitor" SET "keepMonitoringDuringIncidents" = true WHERE "_id" = $1`,
          [monitorId.toString()],
        );
        await MonitorIncidentPause.syncMonitors({
          projectId: projectId,
          monitorIds: [monitorId],
          putInHeldStatus: true,
        });
        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Under Maintenance"].toString(),
          incident: false,
          maintenance: true,
        });

        await database.query(
          `UPDATE "Monitor" SET "keepMonitoringDuringIncidents" = false WHERE "_id" = $1`,
          [monitorId.toString()],
        );
        await MonitorIncidentPause.syncMonitors({
          projectId: projectId,
          monitorIds: [monitorId],
          putInHeldStatus: true,
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");
      });

      test("an event's status changed while it runs: lowered below an incident's, the incident's shows; raised, the event's", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        expect(await statusOf(monitorId)).toBe("Major Outage");

        const changeEventStatus: (status: StatusName) => Promise<void> = async (
          status: StatusName,
        ): Promise<void> => {
          await database.query(
            `UPDATE "ScheduledMaintenance" SET "changeMonitorStatusToId" = $2 WHERE "_id" = $1`,
            [event.id.toString(), statusIds[status].toString()],
          );
          // What ScheduledMaintenanceService.onUpdateSuccess does with the edit.
          await (
            ScheduledMaintenanceService as unknown as {
              applyMonitorStatusToStartedEvent: (data: {
                scheduledMaintenanceId: ObjectID;
                projectId: ObjectID;
                monitorStatusId: string | null;
              }) => Promise<void>;
            }
          ).applyMonitorStatusToStartedEvent({
            scheduledMaintenanceId: event.id,
            projectId: projectId,
            monitorStatusId: statusIds[status].toString(),
          });
        };

        await changeEventStatus("Under Maintenance");
        expect(await statusOf(monitorId)).toBe("Partial Outage");

        await changeEventStatus("Major Outage");
        expect(await statusOf(monitorId)).toBe("Major Outage");
      });

      test("a monitor added to an event in progress while an incident holds it in a more severe status keeps that status", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const otherMonitorId: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        const event: { id: ObjectID; name: string } = await startEvent({
          monitorIds: [otherMonitorId],
          status: "Under Maintenance",
        });

        await database.query(
          `INSERT INTO "ScheduledMaintenanceMonitor" ("scheduledMaintenanceId", "monitorId") VALUES ($1, $2)`,
          [event.id.toString(), monitorId.toString()],
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
          scheduledMaintenanceId: event.id,
          projectId: projectId,
          monitorIds: [monitorId],
          changeMonitorStatusToId: statusIds["Under Maintenance"],
        });

        expect(await monitorRow(monitorId)).toEqual({
          statusId: statusIds["Major Outage"].toString(),
          incident: true,
          maintenance: true,
        });
      });
    });

    describe("the order of the project's statuses decides", () => {
      test("two statuses at one Order: the one created later is further down the list, so it wins", async () => {
        const monitorId: ObjectID = await seedMonitor();
        const tied: ObjectID = await seedMonitorStatus({
          name: "Partial Outage, newer",
          priority: 3,
          createdAt: new Date(),
        });

        await declareIncident({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        const event: { id: ObjectID; name: string } = await seedEvent({
          monitorIds: [monitorId],
        });
        await database.query(
          `UPDATE "ScheduledMaintenance" SET "changeMonitorStatusToId" = $2 WHERE "_id" = $1`,
          [event.id.toString(), tied.toString()],
        );
        await moveEventInto(event.id, ongoingStateId);

        expect((await monitorRow(monitorId)).statusId).toBe(tied.toString());
      });

      test("a status moved down the list wins from the next change on", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [monitorId],
          status: "Partial Outage",
        });
        // The project puts Under Maintenance after Major Outage.
        await database.query(
          `UPDATE "MonitorStatus" SET "priority" = 9 WHERE "_id" = $1`,
          [statusIds["Under Maintenance"].toString()],
        );
        await startEvent({
          monitorIds: [monitorId],
          status: "Under Maintenance",
        });

        expect(await statusOf(monitorId)).toBe("Under Maintenance");
      });
    });

    describe("working it out again", () => {
      test("writes nothing more: no status event, no mark", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({
          monitorIds: [monitorId],
          status: "Major Outage",
        });
        await startEvent({ monitorIds: [monitorId], status: "Degraded" });
        await declareIncident({ monitorIds: [monitorId] });

        const before: Array<TimelineRow> = await timeline(monitorId);

        for (let attempt: number = 0; attempt < 3; attempt++) {
          await MonitorIncidentPause.syncMonitors({
            projectId: projectId,
            monitorIds: [monitorId],
            putInHeldStatus: true,
          });
        }

        expect(await timeline(monitorId)).toEqual(before);
      });

      test("a data migration works the pauses out without changing a status", async () => {
        const monitorId: ObjectID = await seedMonitor();

        await declareIncident({ monitorIds: [monitorId], status: "Degraded" });

        // A status left behind by an older OneUptime.
        await database.query(
          `UPDATE "Monitor" SET "currentMonitorStatusId" = $2 WHERE "_id" = $1`,
          [monitorId.toString(), statusIds["Under Maintenance"].toString()],
        );
        const before: Array<TimelineRow> = await timeline(monitorId);

        await MonitorIncidentPause.syncMonitors({
          projectId: projectId,
          monitorIds: [monitorId],
        });

        expect(await timeline(monitorId)).toEqual(before);
        expect(await statusOf(monitorId)).toBe("Under Maintenance");
      });
    });
  },
);
