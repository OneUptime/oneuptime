/*
 * HOW MANY POSTGRES STATEMENTS ONE MONITOR RESULT COSTS.
 *
 * A probe result is the hottest recurring path in OneUptime: a large install
 * evaluates thousands a minute, each one under its monitor's lock, each on a
 * pooled connection. Every statement it issues is paid for every result, so
 * the count is pinned here, per kind of result:
 *
 *   - a healthy result, one probe and three;
 *   - a result that changes the monitor's status and opens nothing;
 *   - a result that opens an incident and an alert;
 *   - the healthy result that auto-resolves them, and the one after it.
 *
 * monitorResource runs for real against a migrated Postgres, with the
 * statements it issues counted off the DataSource's logger. Stubbed are what
 * needs another server - the per-monitor lock and the caches (Redis, kept in
 * memory here), the metric and log writers (ClickHouse), the criteria
 * evaluator (native isolated-vm, here a verdict the result carries) - and
 * the writes that create a record or move its state, which are counted
 * apart: they are the same however the result is processed, and their hooks
 * (feeds, notifications, on-call) would otherwise be most of the count. So
 * is the read of what a monitor was linked to by hand, made once a record
 * is really created: a dozen reads in parallel of tables this suite does not
 * clone, which link nothing here.
 *
 * Opt in with RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS=true against a
 * Postgres migrated to head, e.g. the Postgres Schema Drift workflow's
 * database (.github/workflows/postgres-schema-drift.yaml runs it):
 *
 *   RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS=true \
 *   MONITOR_RESULT_PATH_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_RESULT_PATH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Monitor/MonitorResultStatementsPostgres.test.ts
 *
 * MONITOR_RESULT_STATEMENTS_PRINT=true prints every statement counted. The
 * tables' STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards; every row is synthetic.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

import Entities from "../../../../Models/DatabaseModels/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS"] === "true"
    ? describe
    : describe.skip;

const PRINT_STATEMENTS: boolean =
  process.env["MONITOR_RESULT_STATEMENTS_PRINT"] === "true";

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

// Cloning the tables and loading every entity takes a while on a busy runner.
const SETUP_TIMEOUT_MS: number = 5 * 60 * 1000;
const TEST_TIMEOUT_MS: number = 2 * 60 * 1000;

const DASHES: RegExp = /-/g;

/*
 * The most statements each kind of result may issue, its record writes
 * apart. A change that takes a statement out lowers its number here; one
 * that needs another says why, here.
 *
 * Main before this work issued, counted the same way: healthy 8 (three
 * probes too), a status change 11, opening an incident and an alert 13, a
 * result while they are open 9, the one that resolves them 14.
 */
const MOST_STATEMENTS: Readonly<Record<string, number>> = {
  healthy: 7,
  statusChange: 10,
  opening: 12,
  whileOpen: 8,
  resolving: 13,
};

// A statement that reads a probe's whole lastMonitoringLog out.
const READS_WHOLE_LAST_MONITORING_LOG: RegExp = /"lastMonitoringLog"\s+AS\b/;

// Transaction control is not a statement of its own for this count.
const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

const BASE_TABLES: Array<string> = [
  "Project",
  "Probe",
  "Monitor",
  "MonitorProbe",
  "MonitorStatus",
  "MonitorStatusTimeline",
  "Incident",
  "IncidentState",
  "IncidentSeverity",
  "IncidentStateTimeline",
  "Alert",
  "AlertState",
  "AlertSeverity",
  "AlertStateTimeline",
  "ScheduledMaintenance",
  "ScheduledMaintenanceState",
];

/*
 * The relations the result path reads with its records: their junction
 * tables and the tables they join to are cloned too, so each read is the
 * one production makes.
 */
const RELATIONS_READ: Array<{
  entity: typeof Monitor | typeof Incident;
  relation: string;
}> = [
  { entity: Monitor, relation: "labels" },
  { entity: Monitor, relation: "dependsOnMonitors" },
  { entity: Monitor, relation: "suppressAlertsWhenParentMonitorStatuses" },
  { entity: Incident, relation: "monitors" },
];

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<string> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

enum Verdict {
  Online = "online",
  Degraded = "degraded",
  Offline = "offline",
}

interface MonitorFixture {
  id: ObjectID;
  stepId: ObjectID;
  probeIds: Array<ObjectID>;
  criteriaIdByVerdict: Record<Verdict, string>;
}

describePostgres("statements one monitor result costs (Postgres)", () => {
  const schema: string = `monitor_result_statements_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  const statementLog: StatementLog = new StatementLog();
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();

  const operationalStatusId: ObjectID = ObjectID.generate();
  const degradedStatusId: ObjectID = ObjectID.generate();
  const offlineStatusId: ObjectID = ObjectID.generate();

  const incidentCreatedStateId: ObjectID = ObjectID.generate();
  const incidentAcknowledgedStateId: ObjectID = ObjectID.generate();
  const incidentResolvedStateId: ObjectID = ObjectID.generate();
  const incidentSeverityId: ObjectID = ObjectID.generate();

  const alertCreatedStateId: ObjectID = ObjectID.generate();
  const alertAcknowledgedStateId: ObjectID = ObjectID.generate();
  const alertResolvedStateId: ObjectID = ObjectID.generate();
  const alertSeverityId: ObjectID = ObjectID.generate();

  // The record writes, counted apart (see the header).
  const recordWrites: Array<string> = [];

  // The in-memory stand-in for Redis.
  const cache: Map<string, string> = new Map<string, string>();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["query"],
      logger: statementLog,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    const tables: Set<string> = new Set<string>(BASE_TABLES);

    for (const read of RELATIONS_READ) {
      const relation: RelationMetadata | undefined = database
        .getMetadata(read.entity)
        .findRelationWithPropertyPath(read.relation);

      expect(relation?.junctionEntityMetadata).toBeTruthy();

      tables.add(relation!.junctionEntityMetadata!.tableName);
      tables.add(relation!.inverseEntityMetadata.tableName);
    }

    for (const table of tables) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the path reads; keys stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints t
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = t.constraint_name
              AND k.table_schema = t.table_schema
             WHERE t.constraint_type = 'PRIMARY KEY'
               AND t.table_schema = c.table_schema
               AND k.table_name = c.table_name
               AND k.column_name = c.column_name
           )`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    await seedProject();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Read once per server and cached in production.
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);

    stubCache();
    stubRecordWrites();

    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockImplementation(async (): Promise<SeriesResolvedResourceIds> => {
        recordWrites.push("linked resources");
        return (
          MonitorResourceContextUtil as unknown as {
            emptyContext: () => SeriesResolvedResourceIds;
          }
        ).emptyContext();
      });

    (Semaphore.lock as jest.Mock).mockResolvedValue({} as never);
    (Semaphore.release as jest.Mock).mockResolvedValue(undefined as never);

    // The verdict a result carries decides the criteria it meets.
    (
      MonitorCriteriaEvaluator.processMonitorStep as jest.Mock
    ).mockImplementation((async (input: {
      dataToProcess: JSONObject;
      monitorStep: MonitorStep;
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      const verdict: string = String(input.dataToProcess["verdict"] || "");

      const criteria: MonitorCriteriaInstance | undefined = (
        input.monitorStep.data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray || []
      ).find((instance: MonitorCriteriaInstance) => {
        return instance.data?.name === verdict;
      });

      if (!criteria) {
        return input.probeApiIngestResponse;
      }

      return {
        ...input.probeApiIngestResponse,
        criteriaMetId: criteria.data!.id,
        rootCause: `The check is ${verdict}.`,
      };
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    statementLog.isCounting = false;
  });

  // Redis, in memory: the calls the result path makes.
  function stubCache(): void {
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return cache.get(`${namespace}-${key}`) ?? null;
      });

    jest
      .spyOn(GlobalCache, "getStrings")
      .mockImplementation(async (namespace: string, keys: Array<string>) => {
        return keys.map((key: string) => {
          return cache.get(`${namespace}-${key}`) ?? null;
        });
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          cache.set(`${namespace}-${key}`, value);
        },
      );

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          if (cache.has(`${namespace}-${key}`)) {
            return false;
          }

          cache.set(`${namespace}-${key}`, value);
          return true;
        },
      );

    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (namespace: string, key: string) => {
        cache.delete(`${namespace}-${key}`);
      });
  }

  /*
   * Runs a record write with counting off, so the count is the result
   * path's own.
   */
  async function uncounted<T>(
    description: string,
    write: () => Promise<T>,
  ): Promise<T> {
    const wasCounting: boolean = statementLog.isCounting;
    statementLog.isCounting = false;

    try {
      recordWrites.push(description);
      return await write();
    } finally {
      statementLog.isCounting = wasCounting;
    }
  }

  function stubRecordWrites(): void {
    jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation((async (
        createBy: CreateBy<MonitorStatusTimeline>,
      ): Promise<MonitorStatusTimeline> => {
        return await uncounted("monitor status timeline", async () => {
          const timeline: MonitorStatusTimeline = createBy.data;
          timeline.id = ObjectID.generate();

          await database.query(
            `INSERT INTO "MonitorStatusTimeline" ("_id", "projectId", "monitorId", "monitorStatusId", "startsAt", "createdAt", "updatedAt", "version")
             VALUES ($1, $2, $3, $4, now(), now(), now(), 1)`,
            [
              timeline.id.toString(),
              timeline.projectId!.toString(),
              timeline.monitorId!.toString(),
              timeline.monitorStatusId!.toString(),
            ],
          );

          await database.query(
            `UPDATE "Monitor" SET "currentMonitorStatusId" = $1 WHERE "_id" = $2`,
            [
              timeline.monitorStatusId!.toString(),
              timeline.monitorId!.toString(),
            ],
          );

          return timeline;
        });
      }) as never);

    jest.spyOn(IncidentService, "create").mockImplementation((async (
      createBy: CreateBy<Incident>,
    ): Promise<Incident> => {
      return await uncounted("incident", async () => {
        const incident: Incident = createBy.data;
        incident.id = ObjectID.generate();
        incident.incidentNumber = 1;

        await database.query(
          `INSERT INTO "Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "createdCriteriaId", "createdIncidentTemplateId", "isCreatedAutomatically", "createdAt", "updatedAt", "version")
             VALUES ($1::uuid, $2, $3, $1::text, $4, $5, $6, $7, true, now(), now(), 1)`,
          [
            incident.id.toString(),
            incident.projectId!.toString(),
            incident.title,
            incidentCreatedStateId.toString(),
            incident.incidentSeverityId!.toString(),
            incident.createdCriteriaId || null,
            incident.createdIncidentTemplateId || null,
          ],
        );

        for (const monitor of incident.monitors || []) {
          await database.query(
            `INSERT INTO "IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
            [incident.id.toString(), monitor.id!.toString()],
          );
        }

        return incident;
      });
    }) as never);

    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation((async (
        createBy: CreateBy<IncidentStateTimeline>,
      ): Promise<IncidentStateTimeline> => {
        return await uncounted("incident state", async () => {
          await database.query(
            `UPDATE "Incident" SET "currentIncidentStateId" = $1 WHERE "_id" = $2`,
            [
              createBy.data.incidentStateId!.toString(),
              createBy.data.incidentId!.toString(),
            ],
          );

          return createBy.data;
        });
      }) as never);

    jest.spyOn(AlertService, "create").mockImplementation((async (
      createBy: CreateBy<Alert>,
    ): Promise<Alert> => {
      return await uncounted("alert", async () => {
        const alert: Alert = createBy.data;
        alert.id = ObjectID.generate();
        alert.alertNumber = 1;

        await database.query(
          `INSERT INTO "Alert" ("_id", "projectId", "title", "monitorId", "currentAlertStateId", "alertSeverityId", "createdCriteriaId", "isCreatedAutomatically", "createdAt", "updatedAt", "version")
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), now(), 1)`,
          [
            alert.id.toString(),
            alert.projectId!.toString(),
            alert.title,
            (alert.monitorId || alert.monitor?.id)!.toString(),
            alertCreatedStateId.toString(),
            alert.alertSeverityId!.toString(),
            alert.createdCriteriaId || null,
          ],
        );

        return alert;
      });
    }) as never);

    jest.spyOn(AlertStateTimelineService, "create").mockImplementation((async (
      createBy: CreateBy<AlertStateTimeline>,
    ): Promise<AlertStateTimeline> => {
      return await uncounted("alert state", async () => {
        await database.query(
          `UPDATE "Alert" SET "currentAlertStateId" = $1 WHERE "_id" = $2`,
          [
            createBy.data.alertStateId!.toString(),
            createBy.data.alertId!.toString(),
          ],
        );

        return createBy.data;
      });
    }) as never);
  }

  async function seedProject(): Promise<void> {
    await database.query(
      `INSERT INTO "Project" ("_id", "name", "slug", "isBlocked") VALUES ($1::uuid, 'Statements', $1::text, false)`,
      [projectId.toString()],
    );

    const statuses: Array<[ObjectID, string, number, boolean]> = [
      [operationalStatusId, "Operational", 1, true],
      [degradedStatusId, "Degraded", 2, false],
      [offlineStatusId, "Offline", 3, false],
    ];

    for (const [id, name, priority, isOperational] of statuses) {
      await database.query(
        `INSERT INTO "MonitorStatus" ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState")
         VALUES ($1::uuid, $2, $3, $1::text, '#000000', $4, $5, $6)`,
        [
          id.toString(),
          projectId.toString(),
          name,
          priority,
          isOperational,
          name === "Offline",
        ],
      );
    }

    for (const [table, created, acknowledged, resolved] of [
      [
        "IncidentState",
        incidentCreatedStateId,
        incidentAcknowledgedStateId,
        incidentResolvedStateId,
      ],
      [
        "AlertState",
        alertCreatedStateId,
        alertAcknowledgedStateId,
        alertResolvedStateId,
      ],
    ] as Array<[string, ObjectID, ObjectID, ObjectID]>) {
      const states: Array<[ObjectID, string, number]> = [
        [created, "Created", 1],
        [acknowledged, "Acknowledged", 2],
        [resolved, "Resolved", 3],
      ];

      for (const [id, name, order] of states) {
        await database.query(
          `INSERT INTO "${table}" ("_id", "projectId", "name", "color", "order", "isCreatedState", "isAcknowledgedState", "isResolvedState", "createdAt", "updatedAt", "version")
           VALUES ($1::uuid, $2, $3, '#000000', $4, $5, $6, $7, now(), now(), 1)`,
          [
            id.toString(),
            projectId.toString(),
            name,
            order,
            name === "Created",
            name === "Acknowledged",
            name === "Resolved",
          ],
        );
      }
    }

    for (const [table, id] of [
      ["IncidentSeverity", incidentSeverityId],
      ["AlertSeverity", alertSeverityId],
    ] as Array<[string, ObjectID]>) {
      await database.query(
        `INSERT INTO "${table}" ("_id", "projectId", "name", "slug", "color", "order", "createdAt", "updatedAt", "version")
         VALUES ($1::uuid, $2, 'Critical', $1::text, '#000000', 1, now(), now(), 1)`,
        [id.toString(), projectId.toString()],
      );
    }
  }

  function criteria(data: {
    id: string;
    verdict: Verdict;
    monitorStatusId: ObjectID;
    opensRecords: boolean;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data!.id = data.id;
    instance.data!.name = data.verdict;
    instance.data!.changeMonitorStatus = true;
    instance.data!.monitorStatusId = data.monitorStatusId;
    instance.data!.createIncidents = data.opensRecords;
    instance.data!.createAlerts = data.opensRecords;

    if (data.opensRecords) {
      instance.data!.incidents = [
        {
          id: ObjectID.generate().toString(),
          title: "The monitor is offline",
          description: "It stopped answering.",
          incidentSeverityId: incidentSeverityId,
          autoResolveIncident: true,
        },
      ];

      instance.data!.alerts = [
        {
          id: ObjectID.generate().toString(),
          title: "The monitor is offline",
          description: "It stopped answering.",
          alertSeverityId: alertSeverityId,
          autoResolveAlert: true,
        },
      ];
    }

    return instance;
  }

  async function seedMonitor(data: {
    probeCount: number;
  }): Promise<MonitorFixture> {
    const fixture: MonitorFixture = {
      id: ObjectID.generate(),
      stepId: ObjectID.generate(),
      probeIds: [],
      criteriaIdByVerdict: {
        [Verdict.Online]: ObjectID.generate().toString(),
        [Verdict.Degraded]: ObjectID.generate().toString(),
        [Verdict.Offline]: ObjectID.generate().toString(),
      },
    };

    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = {
      monitorCriteriaInstanceArray: [
        criteria({
          id: fixture.criteriaIdByVerdict[Verdict.Offline],
          verdict: Verdict.Offline,
          monitorStatusId: offlineStatusId,
          opensRecords: true,
        }),
        criteria({
          id: fixture.criteriaIdByVerdict[Verdict.Degraded],
          verdict: Verdict.Degraded,
          monitorStatusId: degradedStatusId,
          opensRecords: false,
        }),
        criteria({
          id: fixture.criteriaIdByVerdict[Verdict.Online],
          verdict: Verdict.Online,
          monitorStatusId: operationalStatusId,
          opensRecords: false,
        }),
      ],
    };

    const step: MonitorStep = new MonitorStep();
    step.id = fixture.stepId;
    step.data!.id = fixture.stepId.toString();
    step.data!.monitorCriteria = monitorCriteria;

    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: operationalStatusId,
    };

    await database.query(
      `INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "monitorSteps", "monitoringInterval", "currentMonitorStatusId", "createdAt", "updatedAt", "version")
       VALUES ($1::uuid, $2, 'Checkout', $1::text, $3, $4::jsonb, '* * * * *', $5, now(), now(), 1)`,
      [
        fixture.id.toString(),
        projectId.toString(),
        MonitorType.Ping,
        JSON.stringify(monitorSteps.toJSON()),
        operationalStatusId.toString(),
      ],
    );

    for (let index: number = 0; index < data.probeCount; index++) {
      const probeId: ObjectID = ObjectID.generate();
      fixture.probeIds.push(probeId);

      await database.query(
        `INSERT INTO "Probe" ("_id", "projectId", "key", "name", "slug", "isGlobalProbe", "connectionStatus", "createdAt", "updatedAt", "version")
         VALUES ($1::uuid, $2, $3, $4, $1::text, false, 'connected', now(), now(), 1)`,
        [
          probeId.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          `Probe ${index + 1}`,
        ],
      );

      // The other probes have reported healthy for this step already.
      const lastMonitoringLog: JSONObject | null =
        index === 0
          ? null
          : {
              [fixture.stepId.toString()]: JSON.parse(
                JSON.stringify(
                  result({
                    monitor: fixture,
                    probeId: probeId,
                    verdict: Verdict.Online,
                  }),
                ),
              ),
            };

      await database.query(
        `INSERT INTO "MonitorProbe" ("_id", "projectId", "monitorId", "probeId", "isEnabled", "lastMonitoringLog", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, true, $5::jsonb, now(), now(), 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          fixture.id.toString(),
          probeId.toString(),
          lastMonitoringLog ? JSON.stringify(lastMonitoringLog) : null,
        ],
      );
    }

    return fixture;
  }

  function result(data: {
    monitor: MonitorFixture;
    probeId?: ObjectID | undefined;
    verdict: Verdict;
  }): ProbeMonitorResponse {
    return {
      projectId: projectId,
      monitorId: data.monitor.id,
      probeId: data.probeId || data.monitor.probeIds[0]!,
      monitorStepId: data.monitor.stepId,
      isOnline: data.verdict !== Verdict.Offline,
      responseTimeInMs: 42,
      failureCause: data.verdict === Verdict.Offline ? "Timed out" : "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
      verdict: data.verdict,
    } as unknown as ProbeMonitorResponse;
  }

  // The statements one result issues, and what it decided.
  async function countStatements(data: {
    monitor: MonitorFixture;
    verdict: Verdict;
    label: string;
  }): Promise<{ statements: Array<string>; response: ProbeApiIngestResponse }> {
    statementLog.statements = [];
    recordWrites.length = 0;
    statementLog.isCounting = true;

    let response: ProbeApiIngestResponse;

    try {
      const probeResult: ProbeMonitorResponse = result({
        monitor: data.monitor,
        verdict: data.verdict,
      });

      response = await MonitorResourceUtil.monitorResource(probeResult, {
        reportingProbeId: probeResult.probeId,
      });
    } finally {
      statementLog.isCounting = false;
    }

    const statements: Array<string> = [...statementLog.statements];

    if (PRINT_STATEMENTS) {
      // eslint-disable-next-line no-console
      console.log(
        `${data.label}: ${statements.length} statements (record writes apart: ${recordWrites.join(", ") || "none"})\n` +
          statements
            .map((statement: string, index: number) => {
              return `  ${index + 1}. ${statement.replace(/\s+/g, " ").slice(0, 400)}`;
            })
            .join("\n"),
      );
    }

    return { statements, response };
  }

  async function currentStatusOf(monitor: MonitorFixture): Promise<string> {
    const rows: Array<{ currentMonitorStatusId: string }> =
      await database.query(
        `SELECT "currentMonitorStatusId" FROM "Monitor" WHERE "_id" = $1`,
        [monitor.id.toString()],
      );

    return rows[0]!.currentMonitorStatusId;
  }

  async function openRecordsOf(
    monitor: MonitorFixture,
  ): Promise<{ incidents: number; alerts: number }> {
    const incidents: Array<{ count: string }> = await database.query(
      `SELECT count(*) FROM "Incident" i JOIN "IncidentMonitor" im ON im."incidentId" = i."_id"
       WHERE im."monitorId" = $1 AND i."currentIncidentStateId" <> $2`,
      [monitor.id.toString(), incidentResolvedStateId.toString()],
    );

    const alerts: Array<{ count: string }> = await database.query(
      `SELECT count(*) FROM "Alert" WHERE "monitorId" = $1 AND "currentAlertStateId" <> $2`,
      [monitor.id.toString(), alertResolvedStateId.toString()],
    );

    return {
      incidents: Number(incidents[0]!.count),
      alerts: Number(alerts[0]!.count),
    };
  }

  test(
    "a healthy result from the monitor's only probe",
    async () => {
      const monitor: MonitorFixture = await seedMonitor({ probeCount: 1 });

      // The first result after a deploy warms what is kept per server.
      await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy, one probe (first)",
      });

      const { statements } = await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy, one probe",
      });

      expect(await currentStatusOf(monitor)).toBe(
        operationalStatusId.toString(),
      );
      expect(statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["healthy"]!,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a healthy result from one of three probes",
    async () => {
      const monitor: MonitorFixture = await seedMonitor({ probeCount: 3 });

      await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy, three probes (first)",
      });

      const { statements } = await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy, three probes",
      });

      expect(statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["healthy"]!,
      );

      // The probe rows: one statement stores the result and reads the others.
      expect(
        statements.filter((statement: string) => {
          return statement.includes('"MonitorProbe"');
        }),
      ).toHaveLength(1);

      // No probe's whole lastMonitoringLog is read out, only the step judged.
      expect(
        statements.filter((statement: string) => {
          return READS_WHOLE_LAST_MONITORING_LOG.test(statement);
        }),
      ).toEqual([]);

      // What the other probes reported is kept, and this result added.
      const stored: Array<{ probeId: string; lastMonitoringLog: JSONObject }> =
        await database.query(
          `SELECT "probeId", "lastMonitoringLog" FROM "MonitorProbe" WHERE "monitorId" = $1`,
          [monitor.id.toString()],
        );

      expect(stored).toHaveLength(3);

      for (const row of stored) {
        expect(
          (row.lastMonitoringLog[monitor.stepId.toString()] as JSONObject)[
            "verdict"
          ],
        ).toBe(Verdict.Online);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a result that changes the monitor's status and opens nothing",
    async () => {
      const monitor: MonitorFixture = await seedMonitor({ probeCount: 1 });

      await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "status change (warm-up)",
      });

      const { statements } = await countStatements({
        monitor,
        verdict: Verdict.Degraded,
        label: "status change, no records",
      });

      expect(await currentStatusOf(monitor)).toBe(degradedStatusId.toString());
      expect(await openRecordsOf(monitor)).toEqual({ incidents: 0, alerts: 0 });
      expect(statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["statusChange"]!,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a result that opens an incident and an alert, then the results that resolve them",
    async () => {
      const monitor: MonitorFixture = await seedMonitor({ probeCount: 1 });

      await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "records (warm-up)",
      });

      const opening: { statements: Array<string> } = await countStatements({
        monitor,
        verdict: Verdict.Offline,
        label: "opens an incident and an alert",
      });

      expect(await currentStatusOf(monitor)).toBe(offlineStatusId.toString());
      expect(await openRecordsOf(monitor)).toEqual({ incidents: 1, alerts: 1 });

      const stillDown: { statements: Array<string> } = await countStatements({
        monitor,
        verdict: Verdict.Offline,
        label: "still offline, records open",
      });

      expect(await openRecordsOf(monitor)).toEqual({ incidents: 1, alerts: 1 });

      const resolving: { statements: Array<string> } = await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "auto-resolves them",
      });

      expect(await currentStatusOf(monitor)).toBe(
        operationalStatusId.toString(),
      );
      expect(await openRecordsOf(monitor)).toEqual({ incidents: 0, alerts: 0 });

      const after: { statements: Array<string> } = await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy after the resolve",
      });

      const steady: { statements: Array<string> } = await countStatements({
        monitor,
        verdict: Verdict.Online,
        label: "healthy, steady again",
      });

      expect(opening.statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["opening"]!,
      );
      expect(stillDown.statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["whileOpen"]!,
      );
      expect(resolving.statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["resolving"]!,
      );
      expect(after.statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["healthy"]!,
      );
      expect(steady.statements.length).toBeLessThanOrEqual(
        MOST_STATEMENTS["healthy"]!,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
