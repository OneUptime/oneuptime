// First: REGISTER_PROBE_KEY is read once, when EnvironmentConfig is first imported.
import { UPGRADE_SUITE_REGISTER_PROBE_KEY } from "./Helpers/ShippedKeyUpgradeRegisterKey";
import ProbeRegisterAPI from "../../FeatureSet/Telemetry/API/ProbeIngest/Register";
import ProbeIngestAPI from "../../FeatureSet/Telemetry/API/ProbeIngest/Probe";
import ProbeMonitorAPI from "../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
import Entities from "Common/Models/DatabaseModels/Index";
import { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
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
import Response from "Common/Server/Utils/Response";
import URL from "Common/Types/API/URL";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";
import http from "http";
import { AddressInfo } from "net";

/*
 * AN INSTALLATION'S BUNDLED GLOBAL PROBE, UPGRADED FROM THE KEY THE
 * REPOSITORY SHIPS, END TO END AGAINST POSTGRES.
 *
 * A Docker Compose install that copied config.example.env as it is ran its
 * bundled probe on the placeholder GLOBAL_PROBE_1_KEY, and its monitors were
 * assigned to that probe (MonitorProbe rows naming its id). A shipped key
 * never authenticates now, and npm start gives the probe a random key. The
 * probe registers under it on its next start, and:
 *
 *   - it gets its own id back - it takes over the global probe of its name
 *     whose key is a shipped value - so the monitors assigned to it are
 *     handed to it under the new key, with no gap and no second probe;
 *   - the shipped key it ran on is refused from then on;
 *   - a global probe of the same name whose key is the installation's own
 *     keeps its row and its monitors: a newcomer under another key is a
 *     probe of its own;
 *   - a registration key the repository ships registers nothing.
 *
 * The whole path is the real one: HTTP requests to the probe ingest routers
 * (registration, heartbeat, monitor list) on a real Express app, the real
 * probe-auth middleware and ProbeService, and the real SQL. Stubbed are only
 * what needs another server - the probe auth cache (Redis) - and the project
 * plan lookup.
 *
 * Opt in with RUN_POSTGRES_PROBE_SHIPPED_KEY_UPGRADE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' STRUCTURE is
 * cloned into a unique schema, dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROBE_SHIPPED_KEY_UPGRADE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from PROBE_SHIPPED_KEY_UPGRADE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROBE_SHIPPED_KEY_UPGRADE_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = ["Project", "Probe", "Monitor", "MonitorProbe"];

const PROBE_1_PLACEHOLDER: string =
  "probe-1-please-change-this-to-random-value";
const PROBE_2_PLACEHOLDER: string =
  "probe-2-please-change-this-to-random-value";

interface HttpResult {
  status: number;
  body: JSONObject;
}

// What npm start writes into config.env: 64 random hex characters.
function generatedKey(): string {
  return `${ObjectID.generate().toString()}${ObjectID.generate().toString()}`.replace(
    DASHES,
    "",
  );
}

function apiMonitorSteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(URL.fromString("https://status.example.com/api"));

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  return steps;
}

describePostgres(
  "a bundled global probe upgraded from a shipped key (Postgres)",
  () => {
    const schema: string = `probe_key_upgrade_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    let server: http.Server;
    let port: number = 0;

    const projectId: ObjectID = ObjectID.generate();

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROBE_SHIPPED_KEY_UPGRADE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PROBE_SHIPPED_KEY_UPGRADE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROBE_SHIPPED_KEY_UPGRADE_TEST_DATABASE_NAME"] ||
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

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // A fixture names only the columns the path reads.
      const columns: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
          [schema],
        );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      const app: ExpressApplication = createExpressApp();
      app.use(ExpressJson({ limit: "10mb" }));
      app.use("/probe-ingest", ProbeRegisterAPI);
      app.use("/probe-ingest", ProbeIngestAPI);
      app.use("/probe-ingest", ProbeMonitorAPI);
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
      // The refusals below are logged at error level; quiet, as the rest.
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // The probe auth cache and the liveness throttle are Redis.
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
      jest
        .spyOn(ProbeService, "updateLastAlive")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ProbeService, "notifyOwnersOnStatusChange")
        .mockResolvedValue(undefined as never);
      jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      for (const table of [...TABLES].reverse()) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "isBlocked") VALUES ($1, 'A project', $2, false)`,
        [projectId.toString(), projectId.toString()],
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function post(path: string, body: JSONObject): Promise<HttpResult> {
      return await new Promise(
        (
          resolve: (result: HttpResult) => void,
          reject: (error: Error) => void,
        ) => {
          const payload: string = JSON.stringify(body);
          const request: http.ClientRequest = http.request(
            {
              host: "127.0.0.1",
              port: port,
              path: path,
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
                resolve({
                  status: response.statusCode || 0,
                  body: text ? (JSON.parse(text) as JSONObject) : {},
                });
              });
            },
          );
          request.on("error", reject);
          request.write(payload);
          request.end();
        },
      );
    }

    async function insertGlobalProbe(data: {
      name: string;
      key: string;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "key", "name", "slug", "isGlobalProbe", "shouldAutoEnableProbeOnNewMonitors", "connectionStatus", "lastAlive")
        VALUES ($1, $2, $3, $4, true, true, $5, now() - interval '3 minutes')`,
        [
          id.toString(),
          data.key,
          data.name,
          id.toString(),
          ProbeConnectionStatus.Connected,
        ],
      );
      return id;
    }

    // A monitor of the project, assigned to the probe as it was before the upgrade.
    async function assignMonitorTo(probeId: ObjectID): Promise<ObjectID> {
      const monitorId: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "name", "slug", "monitorType", "monitorSteps", "monitoringInterval")
        VALUES ($1, $2, 'Public API', $3, 'API', $4::jsonb, '* * * * *')`,
        [
          monitorId.toString(),
          projectId.toString(),
          monitorId.toString(),
          JSON.stringify(apiMonitorSteps().toJSON()),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorProbe" ("_id", "projectId", "monitorId", "probeId", "isEnabled")
        VALUES ($1, $2, $3, $4, true)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          monitorId.toString(),
          probeId.toString(),
        ],
      );
      return monitorId;
    }

    async function register(data: {
      probeKey: string;
      probeName: string;
      registerProbeKey?: string;
    }): Promise<HttpResult> {
      return await post("/probe-ingest/register", {
        registerProbeKey:
          data.registerProbeKey || UPGRADE_SUITE_REGISTER_PROBE_KEY,
        probeKey: data.probeKey,
        probeName: data.probeName,
        probeDescription: "Global probe to monitor oneuptime resources",
      });
    }

    async function monitorsListedTo(
      probeId: ObjectID,
      probeKey: string,
    ): Promise<HttpResult> {
      return await post("/probe-ingest/monitor/list", {
        probeId: probeId.toString(),
        probeKey: probeKey,
        limit: 10,
      });
    }

    function idsIn(result: HttpResult): Array<string> {
      return ((result.body["data"] as Array<JSONObject>) || []).map(
        (monitor: JSONObject) => {
          return (monitor["_id"] as string) || "";
        },
      );
    }

    async function probeRows(): Promise<
      Array<{ _id: string; key: string; name: string }>
    > {
      return await database.query(
        `SELECT "_id", "key", "name" FROM "${schema}"."Probe" ORDER BY "name", "_id"`,
      );
    }

    test("the bundled probe comes back under its new key with its own id, and its monitors are handed to it", async () => {
      const probe1: ObjectID = await insertGlobalProbe({
        name: "Probe-1",
        key: PROBE_1_PLACEHOLDER,
      });
      const monitorId: ObjectID = await assignMonitorTo(probe1);
      const newKey: string = generatedKey();

      const registered: HttpResult = await register({
        probeKey: newKey,
        probeName: "Probe-1",
      });

      expect(registered.status).toBe(200);
      expect(registered.body["_id"]).toBe(probe1.toString());

      const heartbeat: HttpResult = await post("/probe-ingest/alive", {
        probeId: probe1.toString(),
        probeKey: newKey,
      });
      expect(heartbeat.status).toBe(200);

      const listed: HttpResult = await monitorsListedTo(probe1, newKey);
      expect(listed.status).toBe(200);
      expect(idsIn(listed)).toEqual([monitorId.toString()]);

      // Still one bundled probe, now under its new key.
      expect(await probeRows()).toEqual([
        { _id: probe1.toString(), key: newKey, name: "Probe-1" },
      ]);
    });

    test("the shipped key the probe ran on is refused from then on, before and after the upgrade", async () => {
      const probe1: ObjectID = await insertGlobalProbe({
        name: "Probe-1",
        key: PROBE_1_PLACEHOLDER,
      });
      await assignMonitorTo(probe1);

      const before: HttpResult = await monitorsListedTo(
        probe1,
        PROBE_1_PLACEHOLDER,
      );
      expect(before.status).toBe(400);
      expect(before.body["message"]).toBe("Invalid Probe ID or Probe Key");

      await register({ probeKey: generatedKey(), probeName: "Probe-1" });

      const after: HttpResult = await monitorsListedTo(
        probe1,
        PROBE_1_PLACEHOLDER,
      );
      expect(after.status).toBe(400);
      expect(idsIn(after)).toEqual([]);
    });

    test("each bundled probe takes over its own row, by its name", async () => {
      const probe1: ObjectID = await insertGlobalProbe({
        name: "Probe-1",
        key: PROBE_1_PLACEHOLDER,
      });
      const probe2: ObjectID = await insertGlobalProbe({
        name: "Probe-2",
        key: PROBE_2_PLACEHOLDER,
      });
      const monitorOf1: ObjectID = await assignMonitorTo(probe1);
      const monitorOf2: ObjectID = await assignMonitorTo(probe2);
      const key1: string = generatedKey();
      const key2: string = generatedKey();

      expect(
        (await register({ probeKey: key2, probeName: "Probe-2" })).body["_id"],
      ).toBe(probe2.toString());
      expect(
        (await register({ probeKey: key1, probeName: "Probe-1" })).body["_id"],
      ).toBe(probe1.toString());

      expect(idsIn(await monitorsListedTo(probe1, key1))).toEqual([
        monitorOf1.toString(),
      ]);
      expect(idsIn(await monitorsListedTo(probe2, key2))).toEqual([
        monitorOf2.toString(),
      ]);

      // A key opens only its own probe.
      expect((await monitorsListedTo(probe1, key2)).status).toBe(400);
    });

    test("a global probe of the same name whose key is the installation's own keeps its row and its monitors", async () => {
      const ownKey: string = generatedKey();
      const live: ObjectID = await insertGlobalProbe({
        name: "Probe-1",
        key: ownKey,
      });
      const monitorId: ObjectID = await assignMonitorTo(live);
      const otherKey: string = generatedKey();

      const newcomer: HttpResult = await register({
        probeKey: otherKey,
        probeName: "Probe-1",
      });

      expect(newcomer.status).toBe(200);
      expect(newcomer.body["message"]).toBe("Probe registered successfully");
      expect(newcomer.body["_id"]).not.toBe(live.toString());

      expect(idsIn(await monitorsListedTo(live, ownKey))).toEqual([
        monitorId.toString(),
      ]);
      expect((await monitorsListedTo(live, otherKey)).status).toBe(400);
    });

    test("a registration key the repository ships registers nothing and takes nothing over", async () => {
      const probe1: ObjectID = await insertGlobalProbe({
        name: "Probe-1",
        key: PROBE_1_PLACEHOLDER,
      });

      for (const registerProbeKey of [
        "please-change-this-to-random-value",
        "secret",
      ]) {
        const refused: HttpResult = await register({
          registerProbeKey,
          probeKey: generatedKey(),
          probeName: "Probe-1",
        });

        expect(refused.status).toBe(400);
      }

      expect(await probeRows()).toEqual([
        { _id: probe1.toString(), key: PROBE_1_PLACEHOLDER, name: "Probe-1" },
      ]);
    });
  },
);
