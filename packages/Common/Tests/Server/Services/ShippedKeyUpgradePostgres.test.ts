import Entities from "../../../Models/DatabaseModels/Index";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProbeService from "../../../Server/Services/ProbeService";
import logger from "../../../Server/Utils/Logger";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * AN INSTALLATION THAT RAN ON THE KEYS THE REPOSITORY SHIPS, UPGRADED, AGAINST
 * A REAL, MIGRATED POSTGRES.
 *
 * A Docker Compose install that copied config.example.env as it is ran its
 * bundled global probes on the placeholder keys, and stored them: each probe
 * is a Probe row holding that key. A key the repository ships never
 * authenticates now, and npm start gives each a random key, so:
 *
 *   - a row holding a shipped key is refused even though the database would
 *     match it (ProbeService.verifyProbeKey);
 *   - the bundled probe coming back under its new key takes over its own
 *     row - the global probe of its name whose key is shipped - so its id,
 *     and every monitor assigned to it, stay; the other bundled probe's row
 *     is left alone, and a global probe whose key is the installation's own,
 *     or a project's own probe, is never taken over by a name.
 *
 * (The in-cluster Runner's global AI agent took its row over the same way
 * until global Runners took its work: the bundled global Runner's row has a
 * fixed id, kept from GLOBAL_RUNNER_KEY on every boot.)
 *
 * The unit suites stand the services in; only a real driver shows the rows
 * the queries really find and what the writes leave behind.
 *
 * Opt in with RUN_POSTGRES_SHIPPED_KEY_UPGRADE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The Probe table's STRUCTURE is
 * cloned into a unique schema that is dropped afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from SHIPPED_KEY_UPGRADE_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from SHIPPED_KEY_UPGRADE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SHIPPED_KEY_UPGRADE_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const PROBE_1_PLACEHOLDER: string =
  "probe-1-please-change-this-to-random-value";
const PROBE_2_PLACEHOLDER: string =
  "probe-2-please-change-this-to-random-value";

// What npm start writes into config.env: 64 random hex characters.
function generatedKey(): string {
  return `${ObjectID.generate().toString()}${ObjectID.generate().toString()}`.replace(
    DASHES,
    "",
  );
}

describePostgres(
  "an installation that ran on the shipped keys, upgraded, in Postgres",
  () => {
    const schema: string = `shipped_key_upgrade_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SHIPPED_KEY_UPGRADE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SHIPPED_KEY_UPGRADE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SHIPPED_KEY_UPGRADE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["Probe"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // A fixture names only the columns these reads and writes touch.
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

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // The probe auth cache is Redis: always a miss here, so Postgres decides.
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // Nor whom a probe coming back online is told to.
      jest
        .spyOn(ProbeService, "notifyOwnersOnStatusChange")
        .mockResolvedValue(undefined as never);

      for (const table of ["Probe"]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertProbe(data: {
      name: string;
      key: string;
      isGlobalProbe?: boolean;
      projectId?: ObjectID;
      lastAlive?: Date;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "key", "name", "slug", "isGlobalProbe", "projectId", "connectionStatus", "lastAlive", "shouldAutoEnableProbeOnNewMonitors")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          id.toString(),
          data.key,
          data.name,
          id.toString(),
          data.isGlobalProbe !== false,
          data.projectId ? data.projectId.toString() : null,
          ProbeConnectionStatus.Connected,
          data.lastAlive || OneUptimeDate.getSomeMinutesAgo(2),
        ],
      );
      return id;
    }

    async function probeKeyOf(id: ObjectID): Promise<string | null> {
      const rows: Array<{ key: string | null }> = await database.query(
        `SELECT "key" FROM "${schema}"."Probe" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0] ? rows[0].key : null;
    }

    // What the registration route does with the probe it takes over.
    async function takeOver(probe: Probe, newKey: string): Promise<void> {
      await ProbeService.updateOneById({
        id: probe.id!,
        data: {
          key: newKey,
          lastAlive: OneUptimeDate.getCurrentDate(),
          connectionStatus: ProbeConnectionStatus.Connected,
        },
        props: {
          isRoot: true,
        },
      });
    }

    describe("the bundled global probes", () => {
      test("a probe row holding a shipped key is refused, though the database holds exactly that pair", async () => {
        const probeId: ObjectID = await insertProbe({
          name: "Probe-1",
          key: PROBE_1_PLACEHOLDER,
        });

        const stored: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."Probe" WHERE "_id" = $1 AND "key" = $2`,
          [probeId.toString(), PROBE_1_PLACEHOLDER],
        );
        expect(stored).toHaveLength(1);

        await expect(
          ProbeService.verifyProbeKey({
            probeId,
            probeKey: PROBE_1_PLACEHOLDER,
          }),
        ).resolves.toBe(false);
      });

      test("coming back under its new key, a probe takes over its own row: same id, the new key authenticates, the old one never", async () => {
        const probe1: ObjectID = await insertProbe({
          name: "Probe-1",
          key: PROBE_1_PLACEHOLDER,
        });
        const probe2: ObjectID = await insertProbe({
          name: "Probe-2",
          key: PROBE_2_PLACEHOLDER,
        });
        const newKey: string = generatedKey();

        const found: Probe | null =
          await ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: newKey,
          });

        expect(found?.id?.toString()).toBe(probe1.toString());

        await takeOver(found!, newKey);

        expect(await probeKeyOf(probe1)).toBe(newKey);
        await expect(
          ProbeService.verifyProbeKey({ probeId: probe1, probeKey: newKey }),
        ).resolves.toBe(true);
        await expect(
          ProbeService.verifyProbeKey({
            probeId: probe1,
            probeKey: PROBE_1_PLACEHOLDER,
          }),
        ).resolves.toBe(false);

        // The other bundled probe's row is its own to take over.
        expect(await probeKeyOf(probe2)).toBe(PROBE_2_PLACEHOLDER);

        // One row per bundled probe, as before.
        const rows: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*)::text AS "count" FROM "${schema}"."Probe"`,
        );
        expect(rows[0]!.count).toBe("2");
      });

      test("once taken over, the same probe coming back again is found by its key, and nothing is taken over twice", async () => {
        const probe1: ObjectID = await insertProbe({
          name: "Probe-1",
          key: PROBE_1_PLACEHOLDER,
        });
        const newKey: string = generatedKey();

        await takeOver(
          (await ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: newKey,
          }))!,
          newKey,
        );

        // A replica of the same probe that raced the first one finds the row it holds.
        const again: Probe | null =
          await ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: newKey,
          });
        expect(again?.id?.toString()).toBe(probe1.toString());

        // A different key under the same name finds nothing left to take over.
        await expect(
          ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: generatedKey(),
          }),
        ).resolves.toBeNull();
      });

      test("a global probe whose key is the installation's own is never taken over by its name", async () => {
        const ownKey: string = generatedKey();
        const live: ObjectID = await insertProbe({
          name: "Probe-1",
          key: ownKey,
        });

        await expect(
          ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: generatedKey(),
          }),
        ).resolves.toBeNull();

        expect(await probeKeyOf(live)).toBe(ownKey);
      });

      test("a project's own probe of the same name is never taken over", async () => {
        await insertProbe({
          name: "Probe-1",
          key: PROBE_1_PLACEHOLDER,
          isGlobalProbe: false,
          projectId: ObjectID.generate(),
        });

        await expect(
          ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: generatedKey(),
          }),
        ).resolves.toBeNull();
      });

      test("the name is matched exactly", async () => {
        await insertProbe({ name: "Probe-1", key: PROBE_1_PLACEHOLDER });

        for (const name of ["probe-1", "Probe-1 ", "Probe", "Probe-10"]) {
          await expect(
            ProbeService.findGlobalProbeToTakeOver({
              name,
              presentedKey: generatedKey(),
            }),
          ).resolves.toBeNull();
        }
      });

      test("of a live global probe and dead ones of its name, takes over the dead one that reported in last", async () => {
        await insertProbe({
          name: "Probe-1",
          key: generatedKey(),
          lastAlive: OneUptimeDate.getCurrentDate(),
        });
        await insertProbe({
          name: "Probe-1",
          key: "secret",
          lastAlive: OneUptimeDate.getSomeDaysAgo(30),
        });
        const newest: ObjectID = await insertProbe({
          name: "Probe-1",
          key: PROBE_1_PLACEHOLDER,
          lastAlive: OneUptimeDate.getSomeMinutesAgo(10),
        });

        const found: Probe | null =
          await ProbeService.findGlobalProbeToTakeOver({
            name: "Probe-1",
            presentedKey: generatedKey(),
          });

        expect(found?.id?.toString()).toBe(newest.toString());
      });
    });
  },
);
