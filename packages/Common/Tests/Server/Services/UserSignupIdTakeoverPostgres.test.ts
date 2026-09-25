import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import User from "../../../Models/DatabaseModels/User";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import UserService from "../../../Server/Services/UserService";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return { getUserMiddleware: jest.fn() };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { getCurrentPlan: jest.fn(), countBy: jest.fn() };
});
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * A signup that names another user's id, against a real, migrated User table.
 *
 * /signup used to deserialize the whole request body into the new User and
 * create it as root. `fromJSON` copies `_id` (and maps `id` onto it),
 * DatabaseService.create only refuses a supplied id on non-root creates, and
 * TypeORM's save() UPDATEs the row an entity's id names instead of inserting.
 * So `{ _id: <victim>, email: <attacker>, password: <attacker's> }` rewrote the
 * victim's row in place, and the attacker signed in to the victim's account.
 *
 * The route now builds the user from an allow-list (App's SignupUser), and
 * UserService.createUserOnSignup refuses a user that already has an id. What
 * only a database can show is that the refusal leaves the victim's row exactly
 * as it was -- and, in the last test, that the hazard it guards against is
 * real, so this suite cannot pass against a harness that could never see it.
 *
 * Opt in with RUN_POSTGRES_SIGNUP_ID_TESTS=true and config.env; point it at a
 * migrated database with SIGNUP_ID_TEST_DATABASE_HOST/PORT/NAME (default
 * localhost:5400; the Postgres Schema Drift job runs it). Only the table
 * definition is copied from public, into an isolated schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SIGNUP_ID_TESTS"] === "true"
    ? describe
    : describe.skip;

type UserRow = {
  _id: string;
  email: string;
  password: string;
  passwordSalt: string | null;
  name: string;
  isEmailVerified: boolean;
};

describePostgres("signup cannot take over an existing user by id", () => {
  const schema: string = `signup_id_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  const readRow: (id: string) => Promise<UserRow | null> = async (
    id: string,
  ): Promise<UserRow | null> => {
    const rows: Array<UserRow> = await database.query(
      `SELECT "_id", "email", "password", "passwordSalt", "name", "isEmailVerified" FROM "${schema}"."User" WHERE "_id" = $1`,
      [id],
    );

    return rows[0] || null;
  };

  const countRows: () => Promise<number> = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."User"`,
    );

    return Number(rows[0]!.count);
  };

  const createVictim: () => Promise<UserRow> = async (): Promise<UserRow> => {
    const victim: User = new User();
    victim.email = new Email(
      `victim-${ObjectID.generate().toString()}@example.com`,
    );
    victim.name = new Name("Victim");
    victim.password = new HashedString("Victim-Password-1!");
    victim.isEmailVerified = true;

    const saved: User = await UserService.create({
      data: victim,
      props: { isRoot: true },
    });

    return (await readRow(saved.id!.toString()))!;
  };

  // Exactly what /signup used to hand to createUserOnSignup.
  const signupUserFromBody: (body: JSONObject) => User = (
    body: JSONObject,
  ): User => {
    const user: User = BaseModel.fromJSON(body, User) as User;
    user.password = new HashedString("Attacker-Password-1!");
    user.isMasterAdmin = false;
    user.isEmailVerified = false;
    return user;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SIGNUP_ID_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["SIGNUP_ID_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SIGNUP_ID_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."User" (LIKE public."User" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    /*
     * A self-hosted signup (billing off, as in CI) serializes through a Redis
     * mutex. There is no Redis here and only one signup at a time, so a
     * no-op lock is faithful.
     */
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    jest.restoreAllMocks();
  });

  test("a signup carrying the victim's _id is refused and the victim's row is untouched", async () => {
    const victim: UserRow = await createVictim();
    const rowsBefore: number = await countRows();

    await expect(
      UserService.createUserOnSignup({
        user: signupUserFromBody({
          _id: victim._id,
          email: "attacker-underscore-id@example.com",
          name: "Attacker",
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("An id cannot be supplied when signing up.");

    expect(await readRow(victim._id)).toEqual(victim);
    expect(await countRows()).toBe(rowsBefore);
  });

  test("a signup carrying the victim's id as `id` is refused the same way", async () => {
    const victim: UserRow = await createVictim();
    const rowsBefore: number = await countRows();

    await expect(
      UserService.createUserOnSignup({
        user: signupUserFromBody({
          id: victim._id,
          email: "attacker-plain-id@example.com",
          name: "Attacker",
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("An id cannot be supplied when signing up.");

    expect(await readRow(victim._id)).toEqual(victim);
    expect(await countRows()).toBe(rowsBefore);
  });

  test("an ordinary signup still inserts a new row beside the existing one", async () => {
    const victim: UserRow = await createVictim();
    const rowsBefore: number = await countRows();

    const created: User = await UserService.createUserOnSignup({
      user: signupUserFromBody({
        email: "ordinary-signup@example.com",
        name: "Ordinary",
      }),
      props: { isRoot: true },
    });

    expect(created.id!.toString()).not.toBe(victim._id);
    expect((await readRow(created.id!.toString()))?.email).toBe(
      "ordinary-signup@example.com",
    );
    expect(await readRow(victim._id)).toEqual(victim);
    expect(await countRows()).toBe(rowsBefore + 1);
  });

  test("the hazard is real: a root create carrying an existing _id rewrites that row", async () => {
    /*
     * Keeps the suite honest. This is the write the old signup made, straight
     * to DatabaseService.create, which exempts root from its supplied-id
     * check. If this stopped overwriting the victim, the tests above would
     * pass whether or not createUserOnSignup refused anything.
     */
    const victim: UserRow = await createVictim();
    const rowsBefore: number = await countRows();

    await UserService.create({
      data: signupUserFromBody({
        _id: victim._id,
        email: "attacker-direct-create@example.com",
        name: "Attacker",
      }),
      props: { isRoot: true },
    });

    const after: UserRow | null = await readRow(victim._id);

    expect(after?.email).toBe("attacker-direct-create@example.com");
    expect(after?.name).toBe("Attacker");
    expect(after?.password).not.toBe(victim.password);
    expect(await countRows()).toBe(rowsBefore);
  });
});
