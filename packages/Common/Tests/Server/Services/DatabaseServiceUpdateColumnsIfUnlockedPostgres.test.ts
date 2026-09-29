import Entities from "../../../Models/DatabaseModels/Index";
import Service from "../../../Models/DatabaseModels/Service";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import logger from "../../../Server/Utils/Logger";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, QueryRunner } from "typeorm";

/*
 * `updateColumnsByIdIfUnlockedWithoutHooks` against a real Postgres: the
 * FOR UPDATE SKIP LOCKED write under every heartbeat (ResourceHeartbeat,
 * ServiceService, EntityRegistry) must YIELD to a writer that holds the row
 * - and must SAY it yielded, or no caller's retry path can run.
 *
 * It said "written" every time: TypeORM's postgres runner answers a bare
 * `UPDATE ... RETURNING` with [rows, rowCount], a non-empty array however
 * many rows were written. The unit suites fake `manager.query`, so only a
 * real driver shows it.
 *
 * Opt in with RUN_POSTGRES_UPDATE_IF_UNLOCKED_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The Service table's STRUCTURE is
 * cloned into a unique schema (search_path holds only that schema) that is
 * dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from UPDATE_IF_UNLOCKED_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from UPDATE_IF_UNLOCKED_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_UPDATE_IF_UNLOCKED_TESTS"] === "true"
    ? describe
    : describe.skip;

// A write that blocks instead of yielding fails within this, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

describePostgres(
  "updateColumnsByIdIfUnlockedWithoutHooks against Postgres",
  () => {
    const schema: string = `update_if_unlocked_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let service: DatabaseService<Service>;
    let cache: Map<string, string>;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["UPDATE_IF_UNLOCKED_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["UPDATE_IF_UNLOCKED_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["UPDATE_IF_UNLOCKED_TEST_DATABASE_NAME"] ||
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
      await database.query(
        `CREATE TABLE "${schema}"."Service" (LIKE public."Service" INCLUDING ALL)`,
      );
      // A fixture names only what the statement touches; the key stays NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'Service' AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."Service" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
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

      // Redis, modelled: SET NX only on an absent key, compare-and-claim on a change.
      cache = new Map<string, string>();
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            const full: string = `${namespace}:${key}`;
            if (cache.has(full)) {
              return false;
            }
            cache.set(full, value);
            return true;
          },
        );
      jest
        .spyOn(GlobalCache, "setStringIfChanged")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            const full: string = `${namespace}:${key}`;
            if (cache.get(full) === value) {
              return false;
            }
            cache.set(full, value);
            return true;
          },
        );
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (namespace: string, key: string) => {
          cache.delete(`${namespace}:${key}`);
        });
      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();

      service = new DatabaseService<Service>(Service);
      await database.query(`DELETE FROM "${schema}"."Service"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertService(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Service" ("_id", "name", "updatedAt") VALUES ($1, 'orders', $2)`,
        [id.toString(), new Date("2020-01-01T00:00:00.000Z")],
      );
      return id;
    }

    async function readService(id: ObjectID): Promise<{
      lastSeenAt: Date | null;
      serviceVersion: string | null;
      updatedAt: Date;
    }> {
      const rows: Array<{
        lastSeenAt: Date | null;
        serviceVersion: string | null;
        updatedAt: Date;
      }> = await database.query(
        `SELECT "lastSeenAt", "serviceVersion", "updatedAt" FROM "${schema}"."Service" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0]!;
    }

    // Another writer holding the row's lock until release() is called.
    async function holdRowLock(
      id: ObjectID,
    ): Promise<{ release: () => Promise<void> }> {
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT "_id" FROM "${schema}"."Service" WHERE "_id" = $1 FOR UPDATE`,
        [id.toString()],
      );
      return {
        release: async (): Promise<void> => {
          await holder.rollbackTransaction();
          await holder.release();
        },
      };
    }

    test("an unlocked row is written and reported written", async () => {
      const id: ObjectID = await insertService();
      const seenAt: Date = new Date("2026-09-24T12:00:00.000Z");

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: id,
          data: { lastSeenAt: seenAt, serviceVersion: "1.2.3" },
        }),
      ).resolves.toBe(true);

      const row: {
        lastSeenAt: Date | null;
        serviceVersion: string | null;
        updatedAt: Date;
      } = await readService(id);
      expect(row.lastSeenAt!.toISOString()).toBe(seenAt.toISOString());
      expect(row.serviceVersion).toBe("1.2.3");
      expect(row.updatedAt.getTime()).toBeGreaterThan(
        new Date("2020-01-01T00:00:00.000Z").getTime(),
      );
    });

    test("a row another writer holds is skipped at once, reported skipped, and left as it was", async () => {
      const id: ObjectID = await insertService();
      const lock: { release: () => Promise<void> } = await holdRowLock(id);

      let wrote: boolean | "blocked";
      const startedAt: number = Date.now();
      try {
        wrote = await Promise.race([
          service.updateColumnsByIdIfUnlockedWithoutHooks({
            id: id,
            data: { lastSeenAt: new Date(), serviceVersion: "9.9.9" },
          }),
          new Promise<"blocked">((resolve: (value: "blocked") => void) => {
            setTimeout(() => {
              resolve("blocked");
            }, LOCK_TIMEOUT_MS / 2);
          }),
        ]);
      } finally {
        await lock.release();
      }

      expect(wrote).toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS / 2);

      const row: {
        lastSeenAt: Date | null;
        serviceVersion: string | null;
        updatedAt: Date;
      } = await readService(id);
      expect(row.lastSeenAt).toBeNull();
      expect(row.serviceVersion).toBeNull();
    });

    test("once the lock is gone the same write lands", async () => {
      const id: ObjectID = await insertService();
      const lock: { release: () => Promise<void> } = await holdRowLock(id);

      const whileLocked: boolean =
        await service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: id,
          data: { serviceVersion: "2.0.0" },
        });
      await lock.release();
      const afterRelease: boolean =
        await service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: id,
          data: { serviceVersion: "2.0.0" },
        });

      expect([whileLocked, afterRelease]).toEqual([false, true]);
      expect((await readService(id)).serviceVersion).toBe("2.0.0");
    });

    test("a row that does not exist is reported not written", async () => {
      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: ObjectID.generate(),
          data: { lastSeenAt: new Date() },
        }),
      ).resolves.toBe(false);
    });

    test("skipUpdateDateColumn leaves updatedAt alone", async () => {
      const id: ObjectID = await insertService();

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: id,
          data: { lastSeenAt: new Date() },
          skipUpdateDateColumn: true,
        }),
      ).resolves.toBe(true);

      expect((await readService(id)).updatedAt.toISOString()).toBe(
        "2020-01-01T00:00:00.000Z",
      );
    });

    /*
     * The caller the fix exists for. A heartbeat whose enrichment write was
     * skipped releases its enrichment gates, so the next batch writes the
     * value instead of the window swallowing it; liveness, which the lock
     * holder is writing anyway, is not retried.
     */
    describe("through ResourceHeartbeat", () => {
      const NAMESPACE: string = "update-if-unlocked-test-last-seen";

      async function heartbeat(id: ObjectID, version: string): Promise<void> {
        await ResourceHeartbeat.write({
          service: service,
          id: id,
          cacheNamespace: NAMESPACE,
          throttleInSeconds: 60,
          liveness: { lastSeenAt: new Date() },
          metadata: { serviceVersion: version },
          fingerprint: version,
          describe: `service ${id.toString()}`,
        });
      }

      test("an enrichment write lost to a lock is retried by the next batch", async () => {
        const id: ObjectID = await insertService();
        const lock: { release: () => Promise<void> } = await holdRowLock(id);

        try {
          await heartbeat(id, "3.1.0");
        } finally {
          await lock.release();
        }

        // Skipped, so the enrichment gates were re-opened...
        expect((await readService(id)).serviceVersion).toBeNull();
        expect(cache.has(`${NAMESPACE}-fingerprint:${id.toString()}`)).toBe(
          false,
        );
        expect(cache.has(`${NAMESPACE}-write-window:${id.toString()}`)).toBe(
          false,
        );
        // ...while the liveness window stays claimed.
        expect(cache.has(`${NAMESPACE}:${id.toString()}`)).toBe(true);

        // ...and the next batch, unlocked, writes the version.
        await heartbeat(id, "3.1.0");

        expect((await readService(id)).serviceVersion).toBe("3.1.0");
      });

      test("a heartbeat that landed keeps its gates for the window", async () => {
        const id: ObjectID = await insertService();

        await heartbeat(id, "4.0.0");

        expect((await readService(id)).serviceVersion).toBe("4.0.0");
        expect(cache.has(`${NAMESPACE}-fingerprint:${id.toString()}`)).toBe(
          true,
        );
        expect(cache.has(`${NAMESPACE}-write-window:${id.toString()}`)).toBe(
          true,
        );
      });
    });
  },
);
