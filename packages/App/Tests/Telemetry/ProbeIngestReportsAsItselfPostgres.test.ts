/*
 * A probe reports as itself, end to end against Postgres.
 *
 * A probe authenticates every request with its id and key
 * (ProbeAuthorization), and the request is then the authenticated probe's
 * and nobody else's. A check result is recorded under that probe's own
 * MonitorProbe row, only for a monitor it was handed, and a monitor test's
 * result only on a test handed to it - whatever ids the result's own body
 * names. A result that names another probe is refused at the door, and a
 * result for a monitor the probe does not check changes nothing: not the
 * monitor's stored probe results, not its metrics, logs or criteria, not
 * its status.
 *
 * The whole path is the real one: an HTTP request to the probe ingest
 * router on a real Express app, the real probe-auth middleware and
 * ProbeService (the key checked by Postgres), the real telemetry queue
 * service (Queue.addJob is where the job leaves for Redis, and the job is
 * read back the way Redis hands it over: as JSON), the real queue worker,
 * MonitorResource and the MonitorProbe / MonitorTest SQL. Stubbed are only
 * what needs another server - the per-monitor Redis lock, the ClickHouse
 * metric and log writers, the probe auth cache - and the criteria
 * evaluator (native isolated-vm), which records what it is asked to judge.
 * The first status change the pipeline makes is recorded and stops it
 * there: reaching it is the proof a result could change the monitor.
 *
 * Opt in with RUN_POSTGRES_PROBE_INGEST_IDENTITY_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check
 * (.github/workflows/postgres-schema-drift.yaml runs it). The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from PROBE_INGEST_IDENTITY_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from PROBE_INGEST_IDENTITY_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */

// The criteria evaluator loads the native isolated-vm addon; it records.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

// The per-monitor lock lives in Redis.
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

// Metrics and monitor logs are written to ClickHouse.
jest.mock("Common/Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

// The first status change a result makes: recorded, and the run stops there.
jest.mock("Common/Server/Utils/Monitor/MonitorStatusTimeline", () => {
  return {
    __esModule: true,
    default: {
      updateMonitorStatusTimeline: jest.fn(),
    },
  };
});

import ProbeIngestAPI from "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import { processProbeFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import {
  ProbeIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import Entities from "Common/Models/DatabaseModels/Index";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Queue from "Common/Server/Infrastructure/Queue";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "Common/Server/Utils/Monitor/MonitorMetricUtil";
import MonitorStatusTimelineUtil from "Common/Server/Utils/Monitor/MonitorStatusTimeline";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import { DataSource } from "Common/node_modules/typeorm";
import { RelationMetadata } from "Common/node_modules/typeorm/metadata/RelationMetadata";
import http from "http";
import { AddressInfo } from "net";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROBE_INGEST_IDENTITY_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const BASE_TABLES: Array<string> = [
  "Project",
  "Probe",
  "Monitor",
  "MonitorProbe",
  "MonitorTest",
];

/*
 * The relations MonitorResource reads with the monitor (labels, the
 * monitors it depends on, the parent statuses that silence it): their
 * junction tables and the tables they join to are cloned too, so the
 * monitor is loaded exactly as in production.
 */
const MONITOR_RELATIONS_READ: Array<string> = [
  "labels",
  "dependsOnMonitors",
  "suppressAlertsWhenParentMonitorStatuses",
];

const DASHES: RegExp = /-/g;

// What a probe of this build declares on every request.
const PROBE_CAPABILITIES: Array<string> = ["networkDevicePing", "snmpTables"];

// The failure cause that makes the recording evaluator report a criteria met.
const OUTAGE: string = "Connection refused";

// Thrown by the recorded status change, so the pipeline stops right there.
class StatusChangeReached extends Error {
  public constructor() {
    super("The pipeline reached the monitor's status change.");
  }
}

interface ProbeFixture {
  id: ObjectID;
  key: string;
  projectId: ObjectID | null;
}

interface MonitorFixture {
  id: ObjectID;
  projectId: ObjectID;
  stepId: ObjectID;
  criteriaId: string;
}

interface HttpResult {
  status: number;
  body: JSONObject;
}

interface JobOutcome {
  job: ProbeIngestJobData;
  error: Error | null;
}

describePostgres("a probe reports as itself (Postgres)", () => {
  const schema: string = `probe_ingest_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;
  let server: http.Server;
  let port: number = 0;

  // Jobs the real queue service handed to Queue.addJob, as Redis returns them.
  let queuedJobs: Array<JSONObject> = [];

  const evaluated: Array<{ monitorId: string; data: JSONObject }> = [];
  const metricsSaved: Array<string> = [];
  const logsSaved: Array<string> = [];
  const statusChanges: Array<{ monitorId: string; rootCause: string }> = [];

  // Project A: the probe's own. Project B: someone else's.
  const projectA: ObjectID = ObjectID.generate();
  const projectB: ObjectID = ObjectID.generate();

  const probeA: ProbeFixture = {
    id: ObjectID.generate(),
    key: ObjectID.generate().toString(),
    projectId: projectA,
  };

  const probeB: ProbeFixture = {
    id: ObjectID.generate(),
    key: ObjectID.generate().toString(),
    projectId: projectB,
  };

  // A global probe: OneUptime's own, serving every project.
  const globalProbe: ProbeFixture = {
    id: ObjectID.generate(),
    key: ObjectID.generate().toString(),
    projectId: null,
  };

  const monitorA: MonitorFixture = makeMonitorFixture(projectA);
  const monitorB: MonitorFixture = makeMonitorFixture(projectB);
  const incomingRequestMonitorB: MonitorFixture = makeMonitorFixture(projectB);

  // Monitor tests: one handed to probe A, one to the global probe.
  const testOfProbeA: ObjectID = ObjectID.generate();
  const testOfGlobalProbe: ObjectID = ObjectID.generate();

  function makeMonitorFixture(projectId: ObjectID): MonitorFixture {
    return {
      id: ObjectID.generate(),
      projectId: projectId,
      stepId: ObjectID.generate(),
      criteriaId: ObjectID.generate().toString(),
    };
  }

  function stepsOf(monitor: MonitorFixture): MonitorSteps {
    const criteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();
    criteriaInstance.data!.id = monitor.criteriaId;
    criteriaInstance.data!.name = "Offline";

    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = {
      monitorCriteriaInstanceArray: [criteriaInstance],
    };

    const step: MonitorStep = new MonitorStep();
    step.id = monitor.stepId;
    step.data!.id = monitor.stepId.toString();
    step.data!.monitorCriteria = monitorCriteria;

    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: undefined,
    };

    return monitorSteps;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PROBE_INGEST_IDENTITY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROBE_INGEST_IDENTITY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROBE_INGEST_IDENTITY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    const tables: Set<string> = new Set<string>(BASE_TABLES);

    for (const relationName of MONITOR_RELATIONS_READ) {
      const relation: RelationMetadata | undefined = database
        .getMetadata(Monitor)
        .findRelationWithPropertyPath(relationName);

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

    // The probe ingest routes, mounted where the App mounts them.
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson({ limit: "10mb" }));
    app.use("/probe-ingest", ProbeIngestAPI);
    app.use(
      (
        err: Exception,
        req: ExpressRequest,
        res: ExpressResponse,
        _next: NextFunction,
      ): void => {
        Response.sendErrorResponse(req, res, err);
      },
    );

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // The probe auth cache misses: every key is checked against Postgres.
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
    jest.spyOn(ProbeService, "updateLastAlive").mockResolvedValue(undefined);

    // Read once per server and cached; each test starts from the database.
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    queuedJobs = [];
    evaluated.length = 0;
    metricsSaved.length = 0;
    logsSaved.length = 0;
    statusChanges.length = 0;

    jest
      .spyOn(Queue, "addJob")
      .mockImplementation(
        async (
          _queueName: unknown,
          _jobId: unknown,
          _jobName: unknown,
          data: JSONObject,
        ): Promise<never> => {
          // What a worker reads back from Redis is the job as JSON.
          queuedJobs.push(JSON.parse(JSON.stringify(data)) as JSONObject);
          return undefined as never;
        },
      );

    (Semaphore.lock as jest.Mock).mockResolvedValue({});
    (Semaphore.release as jest.Mock).mockResolvedValue(undefined);

    (MonitorMetricUtil.saveMonitorMetrics as jest.Mock).mockImplementation(
      async (input: { monitorId: ObjectID }): Promise<void> => {
        metricsSaved.push(input.monitorId.toString());
      },
    );

    (MonitorLogUtil.saveMonitorLog as jest.Mock).mockImplementation(
      (input: { monitorId: ObjectID }): void => {
        logsSaved.push(input.monitorId.toString());
      },
    );

    /*
     * The recording evaluator: a result whose check failed meets the
     * monitor's one criteria, as an "Offline" criteria would.
     */
    (
      MonitorCriteriaEvaluator.processMonitorStep as jest.Mock
    ).mockImplementation(
      async (input: {
        dataToProcess: JSONObject;
        monitor: Monitor;
        monitorStep: MonitorStep;
        probeApiIngestResponse: ProbeApiIngestResponse;
      }): Promise<ProbeApiIngestResponse> => {
        evaluated.push({
          monitorId: input.monitor.id!.toString(),
          data: input.dataToProcess,
        });

        if (input.dataToProcess["failureCause"] === OUTAGE) {
          return {
            ...input.probeApiIngestResponse,
            criteriaMetId:
              input.monitorStep.data?.monitorCriteria.data
                ?.monitorCriteriaInstanceArray[0]?.data?.id,
            rootCause: OUTAGE,
          };
        }

        return input.probeApiIngestResponse;
      },
    );

    (
      MonitorStatusTimelineUtil.updateMonitorStatusTimeline as jest.Mock
    ).mockImplementation(
      async (input: {
        monitor: Monitor;
        rootCause: string;
      }): Promise<never> => {
        statusChanges.push({
          monitorId: input.monitor.id!.toString(),
          rootCause: input.rootCause,
        });
        throw new StatusChangeReached();
      },
    );

    for (const table of [...BASE_TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject(projectA, "Project A");
    await insertProject(projectB, "Project B");

    await insertProbe(probeA, "A's probe");
    await insertProbe(probeB, "B's probe");
    await insertProbe(globalProbe, "Global probe");

    await insertMonitor(monitorA, MonitorType.Website);
    await insertMonitor(monitorB, MonitorType.Website);
    await insertMonitor(incomingRequestMonitorB, MonitorType.IncomingRequest);

    // Each project's monitor runs on its own probe and the global probe.
    await insertMonitorProbe(monitorA, probeA);
    await insertMonitorProbe(monitorA, globalProbe);
    await insertMonitorProbe(monitorB, probeB);
    await insertMonitorProbe(monitorB, globalProbe);

    await insertMonitorTest(testOfProbeA, projectA, probeA);
    await insertMonitorTest(testOfGlobalProbe, projectB, globalProbe);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertProject(id: ObjectID, name: string): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "isBlocked")
       VALUES ($1, $2, $3, false)`,
      [id.toString(), name, id.toString()],
    );
  }

  async function insertProbe(probe: ProbeFixture, name: string): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe"
         ("_id", "projectId", "key", "name", "slug", "isGlobalProbe", "connectionStatus")
       VALUES ($1, $2, $3, $4, $5, $6, 'connected')`,
      [
        probe.id.toString(),
        probe.projectId ? probe.projectId.toString() : null,
        probe.key,
        name,
        probe.id.toString(),
        !probe.projectId,
      ],
    );
  }

  async function insertMonitor(
    monitor: MonitorFixture,
    monitorType: MonitorType,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Monitor"
         ("_id", "projectId", "name", "slug", "monitorType", "monitorSteps", "monitoringInterval")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, '* * * * *')`,
      [
        monitor.id.toString(),
        monitor.projectId.toString(),
        `${monitorType} monitor`,
        monitor.id.toString(),
        monitorType,
        JSON.stringify(stepsOf(monitor).toJSON()),
      ],
    );
  }

  async function insertMonitorProbe(
    monitor: MonitorFixture,
    probe: ProbeFixture,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."MonitorProbe"
         ("_id", "projectId", "monitorId", "probeId", "isEnabled")
       VALUES ($1, $2, $3, $4, true)`,
      [
        ObjectID.generate().toString(),
        monitor.projectId.toString(),
        monitor.id.toString(),
        probe.id.toString(),
      ],
    );
  }

  async function insertMonitorTest(
    id: ObjectID,
    projectId: ObjectID,
    probe: ProbeFixture,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."MonitorTest"
         ("_id", "projectId", "monitorType", "probeId", "isInQueue")
       VALUES ($1, $2, $3, $4, false)`,
      [
        id.toString(),
        projectId.toString(),
        MonitorType.Website,
        probe.id.toString(),
      ],
    );
  }

  // The probe results stored for a monitor, by probe id.
  async function storedResults(
    monitor: MonitorFixture,
  ): Promise<Record<string, JSONObject | null>> {
    const rows: Array<{ probeId: string; lastMonitoringLog: JSONObject }> =
      await database.query(
        `SELECT "probeId", "lastMonitoringLog" FROM "${schema}"."MonitorProbe"
         WHERE "monitorId" = $1`,
        [monitor.id.toString()],
      );

    const results: Record<string, JSONObject | null> = {};

    for (const row of rows) {
      results[row.probeId] = row.lastMonitoringLog || null;
    }

    return results;
  }

  async function storedTestResult(id: ObjectID): Promise<JSONObject | null> {
    const rows: Array<{ monitorStepProbeResponse: JSONObject | null }> =
      await database.query(
        `SELECT "monitorStepProbeResponse" FROM "${schema}"."MonitorTest"
         WHERE "_id" = $1`,
        [id.toString()],
      );

    return rows[0]?.monitorStepProbeResponse || null;
  }

  async function storedIncomingRequest(
    monitor: MonitorFixture,
  ): Promise<JSONObject | null> {
    const rows: Array<{ incomingMonitorRequest: JSONObject | null }> =
      await database.query(
        `SELECT "incomingMonitorRequest" FROM "${schema}"."Monitor"
         WHERE "_id" = $1`,
        [monitor.id.toString()],
      );

    return rows[0]?.incomingMonitorRequest || null;
  }

  /*
   * A check result as a probe puts it on the wire: ids in their serialized
   * form, the way JSON.stringify writes an ObjectID.
   */
  function checkResult(input: {
    monitor: MonitorFixture;
    namedProbe?: ObjectID | undefined;
    failureCause?: string | undefined;
    extra?: JSONObject | undefined;
  }): JSONObject {
    const result: JSONObject = {
      monitorId: input.monitor.id,
      projectId: input.monitor.projectId,
      monitorStepId: input.monitor.stepId,
      isOnline: !input.failureCause,
      responseTimeInMs: 99999,
      failureCause: input.failureCause || "",
      monitoredAt: new Date(),
      ...(input.namedProbe ? { probeId: input.namedProbe } : {}),
      ...(input.extra || {}),
    };

    return JSON.parse(JSON.stringify(result)) as JSONObject;
  }

  // The body the probe sends: its credentials beside what it reports.
  function probeBody(probe: ProbeFixture, extra: JSONObject): JSONObject {
    return {
      probeKey: probe.key,
      probeId: probe.id.toString(),
      probeCapabilities: PROBE_CAPABILITIES,
      ...extra,
    };
  }

  async function post(path: string, body: JSONObject): Promise<HttpResult> {
    const result: HttpResult = await new Promise<HttpResult>(
      (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
        const payload: string = JSON.stringify(body);

        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: "/probe-ingest" + path,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            response.on("end", () => {
              const text: string = Buffer.concat(chunks).toString("utf8");
              let parsed: JSONObject = {};

              try {
                parsed = text ? (JSON.parse(text) as JSONObject) : {};
              } catch {
                parsed = { raw: text };
              }

              resolve({ status: response.statusCode || 0, body: parsed });
            });
          },
        );

        request.on("error", reject);
        request.write(payload);
        request.end();
      },
    );

    // The route answers first and queues after; let the queue call land.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    return result;
  }

  // Runs every queued probe job the way the telemetry worker dispatches it.
  async function runQueuedJobs(): Promise<Array<JobOutcome>> {
    const outcomes: Array<JobOutcome> = [];
    const jobs: Array<JSONObject> = queuedJobs;
    queuedJobs = [];

    for (const job of jobs) {
      expect(job["type"]).toBe(TelemetryType.ProbeIngest);

      const probeIngest: ProbeIngestJobData = job[
        "probeIngest"
      ] as unknown as ProbeIngestJobData;

      try {
        await processProbeFromQueue(probeIngest);
        outcomes.push({ job: probeIngest, error: null });
      } catch (err) {
        outcomes.push({ job: probeIngest, error: err as Error });
      }
    }

    return outcomes;
  }

  function resultFor(
    stored: Record<string, JSONObject | null>,
    probe: ProbeFixture,
    monitor: MonitorFixture,
  ): JSONObject | undefined {
    return (stored[probe.id.toString()] || {})[monitor.stepId.toString()] as
      | JSONObject
      | undefined;
  }

  test("a probe's result for a monitor it checks lands under its own row", async () => {
    const answer: HttpResult = await post(
      "/probe/response/ingest",
      probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorA,
          namedProbe: probeA.id,
        }),
      }),
    );

    expect(answer.status).toBe(200);
    expect(answer.body["result"]).toBe("processing");

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.error).toBeNull();

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorA);

    expect(resultFor(stored, probeA, monitorA)).toBeTruthy();
    expect(resultFor(stored, probeA, monitorA)!["responseTimeInMs"]).toBe(
      99999,
    );
    expect(resultFor(stored, globalProbe, monitorA)).toBeUndefined();

    expect(
      evaluated.map((e: { monitorId: string }) => {
        return e.monitorId;
      }),
    ).toEqual([monitorA.id.toString()]);
    expect(metricsSaved).toEqual([monitorA.id.toString()]);
  });

  test("a global probe's result lands for a monitor of any project that runs on it", async () => {
    const answer: HttpResult = await post(
      "/probe/response/ingest",
      probeBody(globalProbe, {
        probeMonitorResponse: checkResult({
          monitor: monitorB,
          namedProbe: globalProbe.id,
        }),
      }),
    );

    expect(answer.status).toBe(200);
    expect((await runQueuedJobs())[0]!.error).toBeNull();

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(resultFor(stored, globalProbe, monitorB)).toBeTruthy();
    expect(resultFor(stored, probeB, monitorB)).toBeUndefined();
  });

  test("a result that names another probe is refused at the door, and changes nothing", async () => {
    for (const impersonated of [globalProbe, probeB]) {
      const answer: HttpResult = await post(
        "/probe/response/ingest",
        probeBody(probeA, {
          probeMonitorResponse: checkResult({
            monitor: monitorB,
            namedProbe: impersonated.id,
            failureCause: OUTAGE,
          }),
        }),
      );

      expect(answer.status).toBe(400);
    }

    expect(queuedJobs).toHaveLength(0);
    expect(await runQueuedJobs()).toHaveLength(0);

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(stored[globalProbe.id.toString()]).toBeNull();
    expect(stored[probeB.id.toString()]).toBeNull();

    expect(evaluated).toHaveLength(0);
    expect(metricsSaved).toHaveLength(0);
    expect(logsSaved).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
  });

  test("a result naming no probe is the sending probe's: refused for a monitor it does not check", async () => {
    const answer: HttpResult = await post(
      "/probe/response/ingest",
      probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorB,
          failureCause: OUTAGE,
        }),
      }),
    );

    // Accepted for processing: whose monitor it is, is Postgres's answer.
    expect(answer.status).toBe(200);

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.error).toBeInstanceOf(BadDataException);
    expect(outcomes[0]!.error).not.toBeInstanceOf(StatusChangeReached);

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(stored[globalProbe.id.toString()]).toBeNull();
    expect(stored[probeB.id.toString()]).toBeNull();

    expect(evaluated).toHaveLength(0);
    expect(metricsSaved).toHaveLength(0);
    expect(logsSaved).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
  });

  test("a result for a monitor no probe checks is refused, and its stored request is untouched", async () => {
    const answer: HttpResult = await post(
      "/probe/response/ingest",
      probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: incomingRequestMonitorB,
          namedProbe: probeA.id,
          extra: {
            // What an Incoming Request monitor stores as its last request.
            incomingRequestReceivedAt: new Date().toISOString(),
            requestBody: { status: "all good" },
            requestHeaders: {},
            requestMethod: "POST",
          },
        }),
      }),
    );

    expect(answer.status).toBe(200);

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.error).toBeInstanceOf(BadDataException);

    expect(await storedIncomingRequest(incomingRequestMonitorB)).toBeNull();
    expect(evaluated).toHaveLength(0);
    expect(metricsSaved).toHaveLength(0);
    expect(logsSaved).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
  });

  test("a job queued the older way (the whole request body) is held to the probe that sent it", async () => {
    /*
     * What the route used to queue: the request body as it came, the
     * probe's key with it. The probe that authenticated is its top-level
     * probeId; the result inside names another.
     */
    const legacyJob: ProbeIngestJobData = JSON.parse(
      JSON.stringify({
        jobType: "probe-response",
        ingestionTimestamp: new Date(),
        probeMonitorResponse: probeBody(probeA, {
          probeMonitorResponse: checkResult({
            monitor: monitorB,
            namedProbe: globalProbe.id,
            failureCause: OUTAGE,
          }),
        }),
      }),
    ) as ProbeIngestJobData;

    await expect(processProbeFromQueue(legacyJob)).rejects.toBeInstanceOf(
      BadDataException,
    );

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(stored[globalProbe.id.toString()]).toBeNull();
    expect(evaluated).toHaveLength(0);
    expect(statusChanges).toHaveLength(0);
  });

  test("a job queued the older way still lands for the probe that sent it", async () => {
    const legacyJob: ProbeIngestJobData = JSON.parse(
      JSON.stringify({
        jobType: "probe-response",
        ingestionTimestamp: new Date(),
        probeMonitorResponse: probeBody(probeA, {
          probeMonitorResponse: checkResult({
            monitor: monitorA,
            namedProbe: probeA.id,
          }),
        }),
      }),
    ) as ProbeIngestJobData;

    await processProbeFromQueue(legacyJob);

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorA);

    expect(resultFor(stored, probeA, monitorA)).toBeTruthy();
  });

  test("results that reach agreement change the status of the monitor they are for, and only from its own probes", async () => {
    // B's two probes both report the outage: the monitor's status changes.
    for (const probe of [probeB, globalProbe]) {
      const answer: HttpResult = await post(
        "/probe/response/ingest",
        probeBody(probe, {
          probeMonitorResponse: checkResult({
            monitor: monitorB,
            namedProbe: probe.id,
            failureCause: OUTAGE,
          }),
        }),
      );

      expect(answer.status).toBe(200);
    }

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.error).toBeNull();
    // The second result completes the agreement and changes the status.
    expect(outcomes[1]!.error).toBeInstanceOf(StatusChangeReached);
    expect(statusChanges).toEqual([
      { monitorId: monitorB.id.toString(), rootCause: expect.any(String) },
    ]);
  });

  test("a request that is no probe's - no key, or a probe that does not exist - is refused", async () => {
    const withoutKey: JSONObject = probeBody(probeA, {
      probeMonitorResponse: checkResult({
        monitor: monitorA,
        namedProbe: probeA.id,
      }),
    });
    delete withoutKey["probeKey"];

    const noKey: HttpResult = await post("/probe/response/ingest", withoutKey);

    expect(noKey.status).toBe(400);
    expect(noKey.body["message"]).toBe("ProbeId or ProbeKey is missing");

    const unknownProbe: HttpResult = await post("/probe/response/ingest", {
      ...probeBody(probeA, {
        probeMonitorResponse: checkResult({ monitor: monitorA }),
      }),
      probeId: ObjectID.generate().toString(),
    });

    expect(unknownProbe.status).toBe(400);
    expect(unknownProbe.body["message"]).toBe("Invalid Probe ID or Probe Key");

    expect(queuedJobs).toHaveLength(0);
    expect(await storedResults(monitorA)).toEqual({
      [probeA.id.toString()]: null,
      [globalProbe.id.toString()]: null,
    });
  });

  test("a global probe reports for the monitors of every project that run on it", async () => {
    for (const monitor of [monitorA, monitorB]) {
      const answer: HttpResult = await post(
        "/probe/response/ingest",
        probeBody(globalProbe, {
          // As every probe sends it: naming itself.
          probeMonitorResponse: checkResult({
            monitor: monitor,
            namedProbe: globalProbe.id,
          }),
        }),
      );

      expect(answer.status).toBe(200);
    }

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(
      outcomes.map((outcome: JobOutcome) => {
        return outcome.error;
      }),
    ).toEqual([null, null]);

    expect(
      resultFor(await storedResults(monitorA), globalProbe, monitorA),
    ).toBeTruthy();
    expect(
      resultFor(await storedResults(monitorB), globalProbe, monitorB),
    ).toBeTruthy();
  });

  test("a wrong key is refused before anything is read or queued", async () => {
    const answer: HttpResult = await post("/probe/response/ingest", {
      ...probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorA,
          namedProbe: probeA.id,
        }),
      }),
      probeKey: probeB.key,
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("Invalid Probe ID or Probe Key");
    expect(queuedJobs).toHaveLength(0);
  });

  test("a monitor test's result lands only on a test handed to the probe that sends it", async () => {
    // A's probe answers the global probe's test (in project B).
    const forged: HttpResult = await post(
      `/probe/response/monitor-test-ingest/${testOfGlobalProbe.toString()}`,
      probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorB,
          namedProbe: probeA.id,
          failureCause: OUTAGE,
        }),
      }),
    );

    expect(forged.status).toBe(200);

    const forgedOutcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(forgedOutcomes).toHaveLength(1);
    expect(forgedOutcomes[0]!.error).toBeInstanceOf(BadDataException);
    expect(await storedTestResult(testOfGlobalProbe)).toBeNull();

    // The global probe answers its own test: the result is stored.
    const own: HttpResult = await post(
      `/probe/response/monitor-test-ingest/${testOfGlobalProbe.toString()}`,
      probeBody(globalProbe, {
        probeMonitorResponse: checkResult({
          monitor: monitorB,
          namedProbe: globalProbe.id,
        }),
      }),
    );

    expect(own.status).toBe(200);
    expect((await runQueuedJobs())[0]!.error).toBeNull();

    const stored: JSONObject | null = await storedTestResult(testOfGlobalProbe);

    expect(stored).toBeTruthy();
    expect(Object.keys(stored!)).toEqual([monitorB.stepId.toString()]);
    expect(await storedTestResult(testOfProbeA)).toBeNull();
  });

  test("a monitor test's result that names another probe is refused at the door", async () => {
    const answer: HttpResult = await post(
      `/probe/response/monitor-test-ingest/${testOfGlobalProbe.toString()}`,
      probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorB,
          namedProbe: globalProbe.id,
        }),
      }),
    );

    expect(answer.status).toBe(400);
    expect(queuedJobs).toHaveLength(0);
    expect(await storedTestResult(testOfGlobalProbe)).toBeNull();
  });

  test("another probe named in any spelling - upper-cased, padded, as JSON writes an ObjectID - is refused at the door", async () => {
    const spellings: Array<unknown> = [];

    for (const impersonated of [globalProbe, probeB]) {
      const id: string = impersonated.id.toString();

      spellings.push(
        id.toUpperCase(),
        `  ${id}  `,
        { _type: "ObjectID", value: id.toUpperCase() },
        [id],
      );
    }

    for (const spelling of spellings) {
      const answer: HttpResult = await post(
        "/probe/response/ingest",
        probeBody(probeA, {
          probeMonitorResponse: checkResult({
            monitor: monitorB,
            failureCause: OUTAGE,
            extra: { probeId: spelling as JSONObject },
          }),
        }),
      );

      expect({ spelling, status: answer.status }).toEqual({
        spelling,
        status: 400,
      });
    }

    expect(queuedJobs).toHaveLength(0);

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(stored[globalProbe.id.toString()]).toBeNull();
    expect(stored[probeB.id.toString()]).toBeNull();
    expect(evaluated).toHaveLength(0);
  });

  test("a probe named only behind __proto__ names nobody: the result is the sender's", async () => {
    /*
     * JSON.parse keeps "__proto__" as a key of its own; spread into the
     * result it stays one, and the body carries it as written.
     */
    const hidden: JSONObject = JSON.parse(
      `{"__proto__":{"probeId":"${globalProbe.id.toString()}"}}`,
    ) as JSONObject;

    for (const monitor of [monitorA, monitorB]) {
      const answer: HttpResult = await post(
        "/probe/response/ingest",
        probeBody(probeA, {
          probeMonitorResponse: checkResult({
            monitor: monitor,
            failureCause: OUTAGE,
            extra: hidden,
          }),
        }),
      );

      expect(answer.status).toBe(200);
    }

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    // A's own monitor: stored under A's own row, not the global probe's.
    expect(outcomes[0]!.error).toBeNull();

    const storedA: Record<string, JSONObject | null> =
      await storedResults(monitorA);

    expect(resultFor(storedA, probeA, monitorA)).toBeTruthy();
    expect(storedA[globalProbe.id.toString()]).toBeNull();

    // B's monitor, which A's probe does not check: refused, nothing stored.
    expect(outcomes[1]!.error).toBeInstanceOf(BadDataException);

    const storedB: Record<string, JSONObject | null> =
      await storedResults(monitorB);

    expect(storedB[globalProbe.id.toString()]).toBeNull();
    expect(storedB[probeB.id.toString()]).toBeNull();

    expect(
      evaluated.map((e: { monitorId: string }) => {
        return e.monitorId;
      }),
    ).toEqual([monitorA.id.toString()]);
  });

  test("a probe that sends its id upper-cased reports as itself, under its own row", async () => {
    const answer: HttpResult = await post("/probe/response/ingest", {
      ...probeBody(probeA, {
        probeMonitorResponse: checkResult({
          monitor: monitorA,
          extra: { probeId: probeA.id.toString().toUpperCase() },
        }),
      }),
      probeId: probeA.id.toString().toUpperCase(),
    });

    expect(answer.status).toBe(200);

    const outcomes: Array<JobOutcome> = await runQueuedJobs();

    expect(outcomes[0]!.error).toBeNull();
    // Queued as the one id Postgres stores.
    expect(
      (outcomes[0]!.job.probeMonitorResponse as JSONObject)["probeId"],
    ).toBe(probeA.id.toString());

    const stored: Record<string, JSONObject | null> =
      await storedResults(monitorA);

    expect(resultFor(stored, probeA, monitorA)).toBeTruthy();
    expect(resultFor(stored, probeA, monitorA)!["probeId"]).toEqual({
      _type: "ObjectID",
      value: probeA.id.toString(),
    });
  });

  test("a rotated key stops working at once, whatever case the probe's id is sent in", async () => {
    // The auth cache as Redis keeps it: what one request writes, the next reads.
    const cache: Map<string, string> = new Map<string, string>();

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return cache.get(`${namespace}::${key}`) ?? null;
        },
      );

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          cache.set(`${namespace}::${key}`, value);
        },
      );

    const upperCasedBody: () => JSONObject = (): JSONObject => {
      return {
        ...probeBody(probeA, {
          probeMonitorResponse: checkResult({ monitor: monitorA }),
        }),
        probeId: probeA.id.toString().toUpperCase(),
      };
    };

    // Accepted, and cached, while the key is good.
    expect(
      (await post("/probe/response/ingest", upperCasedBody())).status,
    ).toBe(200);

    // A's owner rotates the key: the row changes and the cache is revoked.
    await database.query(
      `UPDATE "${schema}"."Probe" SET "key" = $1 WHERE "_id" = $2`,
      [ObjectID.generate().toString(), probeA.id.toString()],
    );
    await ProbeService.invalidateProbeAuthCache([probeA.id]);

    const afterRotation: HttpResult = await post(
      "/probe/response/ingest",
      upperCasedBody(),
    );

    expect(afterRotation.status).toBe(400);
    expect(afterRotation.body["message"]).toBe("Invalid Probe ID or Probe Key");
  });
});
