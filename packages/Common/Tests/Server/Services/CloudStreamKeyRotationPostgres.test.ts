import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CloudStreamKeys from "../../../Server/Utils/CloudConnection/CloudStreamKeys";
import logger from "../../../Server/Utils/Logger";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_MAX_PREVIOUS_KEYS,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CloudStreamKeyHashes,
  getLiveCloudStreamKeyHashes,
  readCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../Types/ObjectID";
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
import { DataSource } from "typeorm";

/*
 * A CLOUD CONNECTION'S STREAM KEYS, MADE AT THE SAME MOMENT, AGAINST
 * POSTGRES (CloudConnectionService.createStreamKey; the
 * AddCloudConnectionStreams migration's jsonb streamKeyHashes).
 *
 * The unit suite (CloudConnectionStreamKeyRace) holds the rotation to an
 * in-memory row. This one runs it against the real column: each creation
 * reads the row through the service, and all of them are held at their
 * read until every one has read, then write - a compare-and-set statement
 * whose "IS NOT DISTINCT FROM" compares jsonb by value - so Postgres alone
 * decides which writes land.
 *
 *   - two keys made at once both work afterwards, the first written the
 *     replaced key that works a day more;
 *   - five at once keep the newest four, the limit of three replaced keys;
 *   - the stored hashes, written by hand with their keys in another order
 *     and spaced out, still match the read they were rotated from;
 *   - a connection that never streamed (NULL) takes its first key.
 *
 * Opt in with RUN_POSTGRES_CLOUD_STREAM_KEY_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The CloudConnection table is cloned
 * (its STRUCTURE) into a unique schema, the only one on the search_path,
 * and dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from CLOUD_STREAM_KEY_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from CLOUD_STREAM_KEY_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CLOUD_STREAM_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

describePostgres("a connection's stream keys made at once, on Postgres", () => {
  const schema: string = `cloud_stream_keys_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  const connectionId: ObjectID = ObjectID.generate();
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CLOUD_STREAM_KEY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CLOUD_STREAM_KEY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_STREAM_KEY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // Room for every creation to hold its own connection at once.
      extra: { options: `-c search_path=${schema}`, max: 12 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."CloudConnection" (LIKE public."CloudConnection" INCLUDING ALL)`,
    );

    // The fixture names only what the rotation reads; the id stays NOT NULL.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'CloudConnection'
       AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema],
    );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."CloudConnection" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
    // The column the rotation compares is jsonb: compared by value.
    expect(
      (
        await database.query(
          `SELECT data_type FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'CloudConnection'
           AND column_name = 'streamKeyHashes'`,
          [schema],
        )
      )[0].data_type,
    ).toBe("jsonb");
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
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(`DELETE FROM "${schema}"."CloudConnection"`);
    await database.query(
      `INSERT INTO "${schema}"."CloudConnection" ("_id", "name", "provider", "version")
       VALUES ($1, 'Production AWS', $2, 1)`,
      [connectionId.toString(), CloudProvider.AWS],
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Every creation reads the row as the service reads it, then waits until
   * `readers` have read: their writes then race in Postgres.
   */
  function raceAtTheRead(readers: number): void {
    const findOneById: typeof CloudConnectionService.findOneById =
      CloudConnectionService.findOneById.bind(CloudConnectionService);
    let waiting: Array<() => void> = [];
    let isHolding: boolean = true;

    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation((async (
        ...args: Parameters<typeof CloudConnectionService.findOneById>
      ) => {
        const read: CloudConnection | null = await findOneById(...args);

        if (isHolding) {
          await new Promise<void>((resolve: () => void) => {
            waiting.push(resolve);

            if (waiting.length >= readers) {
              isHolding = false;
              const released: Array<() => void> = waiting;
              waiting = [];
              released.forEach((release: () => void) => {
                release();
              });
            }
          });
        }

        return read;
      }) as never);
  }

  async function makeKey(now: Date = NOW): Promise<string> {
    return (await CloudConnectionService.createStreamKey({ connectionId, now }))
      .streamKey;
  }

  async function storedHashes(): Promise<CloudStreamKeyHashes> {
    const rows: Array<{ streamKeyHashes: unknown }> = await database.query(
      `SELECT "streamKeyHashes" FROM "${schema}"."CloudConnection" WHERE "_id" = $1`,
      [connectionId.toString()],
    );

    return readCloudStreamKeyHashes(rows[0]!.streamKeyHashes);
  }

  async function works(key: string, at: Date = NOW): Promise<boolean> {
    return CloudStreamKeys.matchesAny(
      key,
      getLiveCloudStreamKeyHashes({ hashes: await storedHashes(), now: at }),
    );
  }

  test("a connection that never streamed takes its first key over its NULL hashes", async () => {
    const key: string = await makeKey();

    expect(await works(key)).toBe(true);
    expect((await storedHashes()).previous).toBeUndefined();

    const rows: Array<{ streamKeyCreatedAt: Date }> = await database.query(
      `SELECT "streamKeyCreatedAt" FROM "${schema}"."CloudConnection" WHERE "_id" = $1`,
      [connectionId.toString()],
    );
    expect(new Date(rows[0]!.streamKeyCreatedAt).toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("two keys made at once: both work, the first written replaced and working a day more", async () => {
    raceAtTheRead(2);

    const [first, second] = await Promise.all([makeKey(), makeKey()]);
    const hashes: CloudStreamKeyHashes = await storedHashes();

    expect(await works(first)).toBe(true);
    expect(await works(second)).toBe(true);
    expect(hashes.previous).toHaveLength(1);
    expect(Date.parse(hashes.previous![0]!.expiresAt) - NOW.getTime()).toBe(
      CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
    );
    expect(
      [first, second].map((key: string) => {
        return CloudStreamKeys.hash(key);
      }),
    ).toEqual(
      expect.arrayContaining([hashes.current!.hash, hashes.previous![0]!.hash]),
    );
  });

  test("five keys made at once keep the newest four: the limit of three replaced keys holds", async () => {
    raceAtTheRead(5);

    const keys: Array<string> = await Promise.all(
      [0, 1, 2, 3, 4].map(() => {
        return makeKey();
      }),
    );
    const working: Array<boolean> = await Promise.all(
      keys.map((key: string) => {
        return works(key);
      }),
    );

    expect(
      working.filter((isWorking: boolean) => {
        return isWorking;
      }),
    ).toHaveLength(1 + CLOUD_STREAM_MAX_PREVIOUS_KEYS);
    expect((await storedHashes()).previous).toHaveLength(
      CLOUD_STREAM_MAX_PREVIOUS_KEYS,
    );
  });

  test("hashes stored with their keys in another order are still the ones the rotation was made from", async () => {
    const streaming: string = CloudStreamKeys.generate(connectionId).key;
    // Written by hand: keys in another order, spaced out, as jsonb keeps neither.
    await database.query(
      `UPDATE "${schema}"."CloudConnection" SET "streamKeyHashes" = $1::jsonb WHERE "_id" = $2`,
      [
        `{ "current" : { "createdAt": "${new Date(
          NOW.getTime() - 60_000,
        ).toISOString()}", "hash": "${CloudStreamKeys.hash(streaming)}" } }`,
        connectionId.toString(),
      ],
    );

    const key: string = await makeKey();

    expect(await works(key)).toBe(true);
    expect(await works(streaming)).toBe(true);
  });
});
