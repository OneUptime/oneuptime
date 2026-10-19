import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import {
  getSharedVisitorAddresses,
  SharedVisitorAddress,
  SharedVisitorAddressesReport,
} from "../../../Server/Utils/InstanceHealth/SharedVisitorAddresses";
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
 * Where people sign in from, read by the Health page's query against a real
 * Postgres (Utils/InstanceHealth/SharedVisitorAddresses): the private
 * network addresses several different people signed in from in the last 30
 * days, from the dashboard's sessions and status pages' private user
 * sessions alike. The unit suite's fake data source cannot show what the
 * SQL does with real rows: each person counted once however many sessions
 * they have, a dashboard user and a status page user who happen to share an
 * id still two people, removed sessions and old ones left out, a session
 * that never recorded its last activity dated by its creation.
 *
 * Opt in with RUN_POSTGRES_SHARED_VISITOR_ADDRESSES_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The UserSession and
 * StatusPagePrivateUserSession tables' STRUCTURE is cloned into a unique
 * schema (search_path holds only that schema), dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SHARED_VISITOR_ADDRESSES_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * SHARED_VISITOR_ADDRESSES_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SHARED_VISITOR_ADDRESSES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["UserSession", "StatusPagePrivateUserSession"];

const DASHES: RegExp = /-/g;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

describePostgres("where people sign in from, against Postgres", () => {
  const schema: string = `shared_visitor_addresses_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const now: Date = new Date("2026-10-19T12:00:00.000Z");
  const daysAgo: (days: number) => Date = (days: number): Date => {
    return new Date(now.getTime() - days * DAY_IN_MS);
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SHARED_VISITOR_ADDRESSES_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["SHARED_VISITOR_ADDRESSES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SHARED_VISITOR_ADDRESSES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the query reads; ids stay NOT NULL.
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
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function signIn(data: {
    person: ObjectID;
    address: string | null;
    lastActiveDaysAgo?: number | null;
    createdDaysAgo?: number;
    deleted?: boolean;
    revoked?: boolean;
    statusPage?: boolean;
  }): Promise<void> {
    const created: Date = daysAgo(data.createdDaysAgo ?? 1);
    const lastActive: Date | null =
      data.lastActiveDaysAgo === null
        ? null
        : daysAgo(data.lastActiveDaysAgo ?? data.createdDaysAgo ?? 1);

    if (data.statusPage) {
      await database.query(
        `INSERT INTO "${schema}"."StatusPagePrivateUserSession"
          ("_id", "statusPagePrivateUserId", "ipAddress", "lastActiveAt", "createdAt", "deletedAt", "isRevoked", "version")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [
          ObjectID.generate().toString(),
          data.person.toString(),
          data.address,
          lastActive,
          created,
          data.deleted ? now : null,
          Boolean(data.revoked),
        ],
      );

      return;
    }

    await database.query(
      `INSERT INTO "${schema}"."UserSession"
        ("_id", "userId", "ipAddress", "lastActiveAt", "createdAt", "deletedAt", "isRevoked", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [
        ObjectID.generate().toString(),
        data.person.toString(),
        data.address,
        lastActive,
        created,
        data.deleted ? now : null,
        Boolean(data.revoked),
      ],
    );
  }

  const shared: (
    report: SharedVisitorAddressesReport,
  ) => Array<[string, number]> = (
    report: SharedVisitorAddressesReport,
  ): Array<[string, number]> => {
    return report.addresses.map(
      (address: SharedVisitorAddress): [string, number] => {
        return [address.address, address.people];
      },
    );
  };

  test("reports a private address several people signed in from, each counted once", async () => {
    const alice: ObjectID = ObjectID.generate();
    const bob: ObjectID = ObjectID.generate();
    const carol: ObjectID = ObjectID.generate();

    // Alice signed in three times, on three devices: still one person.
    await signIn({ person: alice, address: "172.18.0.1" });
    await signIn({ person: alice, address: "172.18.0.1", createdDaysAgo: 3 });
    await signIn({ person: alice, address: "172.18.0.1", createdDaysAgo: 9 });
    await signIn({ person: bob, address: "172.18.0.1", createdDaysAgo: 2 });
    await signIn({ person: carol, address: "172.18.0.1", createdDaysAgo: 4 });

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now });

    expect(report.checked).toBe(true);
    expect(shared(report)).toEqual([["172.18.0.1", 3]]);
    expect(report.addresses[0]?.lastSeenAt).toBe(daysAgo(1).toISOString());
  });

  test("counts status pages' private users with the dashboard's, and a shared id as two people", async () => {
    const sameId: ObjectID = ObjectID.generate();

    await signIn({ person: sameId, address: "10.244.1.1" });
    await signIn({ person: sameId, address: "10.244.1.1", statusPage: true });
    await signIn({
      person: ObjectID.generate(),
      address: "10.244.1.1",
      statusPage: true,
    });

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([
      ["10.244.1.1", 3],
    ]);
  });

  test("says nothing where each person has an address of their own", async () => {
    await signIn({ person: ObjectID.generate(), address: "192.168.1.10" });
    await signIn({ person: ObjectID.generate(), address: "192.168.1.11" });
    await signIn({ person: ObjectID.generate(), address: "192.168.1.12" });

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now });

    expect(report.checked).toBe(true);
    expect(report.addresses).toEqual([]);
  });

  test("leaves out a public address many people share", async () => {
    for (let index: number = 0; index < 4; index++) {
      await signIn({ person: ObjectID.generate(), address: "203.0.113.7" });
    }

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([]);
  });

  test("leaves out sign-ins from before the 30 days, and removed sessions", async () => {
    const recent: ObjectID = ObjectID.generate();

    await signIn({ person: recent, address: "172.18.0.1" });
    await signIn({
      person: ObjectID.generate(),
      address: "172.18.0.1",
      createdDaysAgo: 45,
    });
    await signIn({
      person: ObjectID.generate(),
      address: "172.18.0.1",
      deleted: true,
    });
    await signIn({
      person: ObjectID.generate(),
      address: "172.18.0.1",
      statusPage: true,
      createdDaysAgo: 31,
    });

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([]);

    // One more person within the window makes two.
    await signIn({
      person: ObjectID.generate(),
      address: "172.18.0.1",
      createdDaysAgo: 29,
    });

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([
      ["172.18.0.1", 2],
    ]);
  });

  test("dates a session by its last activity, and by its creation when it never recorded one", async () => {
    // Created long ago, active yesterday: in the window.
    await signIn({
      person: ObjectID.generate(),
      address: "10.0.0.5",
      createdDaysAgo: 90,
      lastActiveDaysAgo: 1,
    });
    // No last activity, created this week: in the window.
    await signIn({
      person: ObjectID.generate(),
      address: "10.0.0.5",
      createdDaysAgo: 3,
      lastActiveDaysAgo: null,
    });
    // No last activity, created long ago: out.
    await signIn({
      person: ObjectID.generate(),
      address: "10.0.0.5",
      createdDaysAgo: 60,
      lastActiveDaysAgo: null,
    });

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([
      ["10.0.0.5", 2],
    ]);
  });

  test("a revoked session still says where somebody signed in from; a session with no address says nothing", async () => {
    await signIn({
      person: ObjectID.generate(),
      address: "fdf9:9ef6:88c2::1",
      revoked: true,
    });
    await signIn({ person: ObjectID.generate(), address: "fdf9:9ef6:88c2::1" });
    await signIn({ person: ObjectID.generate(), address: null });
    await signIn({ person: ObjectID.generate(), address: null });

    expect(shared(await getSharedVisitorAddresses({ now }))).toEqual([
      ["fdf9:9ef6:88c2::1", 2],
    ]);
  });

  test("lists the most shared first, five at most, and counts them all", async () => {
    const addresses: Array<[string, number]> = [
      ["10.244.1.1", 6],
      ["10.244.2.1", 5],
      ["10.244.3.1", 4],
      ["10.244.4.1", 3],
      ["10.244.5.1", 2],
      ["10.244.6.1", 2],
      ["198.51.100.4", 9],
    ];

    for (const [address, people] of addresses) {
      for (let index: number = 0; index < people; index++) {
        await signIn({ person: ObjectID.generate(), address });
      }
    }

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now });

    expect(report.addressCount).toBe(6);
    expect(shared(report)).toEqual([
      ["10.244.1.1", 6],
      ["10.244.2.1", 5],
      ["10.244.3.1", 4],
      ["10.244.4.1", 3],
      ["10.244.5.1", 2],
    ]);
  });
});
