import Entities from "../../../Models/DatabaseModels/Index";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import Encryption from "../../../Server/Utils/Encryption";
import Search from "../../../Types/BaseDatabase/Search";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { mockRouter } from "../API/Helpers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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

/*
 * Opt in with RUN_POSTGRES_TWILIO_TOKEN_TESTS=true and a migrated database.
 * Only the table definitions are cloned from public into a schema of this
 * suite's own; every row is synthetic and dropped at the end. The model,
 * DatabaseService's encrypt/decrypt, BaseAPI's routes and the permission
 * layer run unchanged against real Postgres.
 *
 * WHAT IT PROVES
 *
 *   - The auth token is stored encrypted: the raw column holds ciphertext,
 *     never the token, and two configs with the same token hold different
 *     ciphertext (non-deterministic). An owner's read decrypts it back.
 *   - A caller who may not read the token cannot filter or sort it into a
 *     value: the WHERE and ORDER BY run against ciphertext, so an equality
 *     or a substring search for the plaintext never matches and reveals
 *     nothing.
 *   - A token written before the column was encrypted (legacy plaintext)
 *     still reads back as itself: the read tolerates the window before the
 *     backfill runs.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TWILIO_TOKEN_TESTS"] === "true"
    ? describe
    : describe.skip;

type MockedFn = ReturnType<typeof jest.fn>;

describePostgres("Twilio auth token encryption on Postgres", () => {
  const schema: string = `twilio_token_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const TOKEN: string = "0123456789abcdef0123456789abcdef";
  const SID: string = "AC0123456789abcdef0123456789abcde";
  let database: DataSource;
  let props: DatabaseCommonInteractionProps;

  function owner(): DatabaseCommonInteractionProps {
    return {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId,
      }),
      ...ON_HIGHEST_PLAN,
    };
  }

  function viewer(): DatabaseCommonInteractionProps {
    return {
      ...customDomainCaller({ permissions: [Permission.Viewer], projectId }),
      ...ON_HIGHEST_PLAN,
    };
  }

  async function rawToken(id: ObjectID): Promise<string | null> {
    const rows: Array<{ twilioAuthToken: string | null }> =
      (await database.query(
        `SELECT "twilioAuthToken" FROM "${schema}"."ProjectCallSMSConfig" WHERE "_id" = $1`,
        [id.toString()],
      )) as Array<{ twilioAuthToken: string | null }>;
    return rows[0] ? rows[0].twilioAuthToken : null;
  }

  async function createConfig(name: string): Promise<ObjectID> {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    config.projectId = projectId;
    config.name = name;
    config.twilioAccountSID = SID;
    config.twilioAuthToken = TOKEN;
    const created: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: config,
        props: { isRoot: true },
      });
    return created.id!;
  }

  async function list(body: JSONObject): Promise<{
    rows: Array<ProjectCallSMSConfig>;
    error: string | undefined;
  }> {
    const sendArray: MockedFn =
      Response.sendEntityArrayResponse as unknown as MockedFn;
    /*
     * Clear the recorded calls so this list reads its own response, not an
     * earlier test's (spies persist until afterAll's restoreAllMocks).
     */
    sendArray.mockClear();
    const req: ExpressRequest = {
      params: {},
      query: { skip: "0", limit: "50" },
      headers: {},
      body: JSONFunctions.serialize(body),
    } as unknown as ExpressRequest;
    const next: MockedFn = jest.fn();
    await mockRouter
      .match("POST", "/call-sms-config/get-list")
      .handlerFunction(
        req,
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );
    const error: Error | undefined = next.mock.calls[0]?.[0] as
      | Error
      | undefined;
    const lastCall: Array<unknown> | undefined =
      sendArray.mock.calls[sendArray.mock.calls.length - 1];
    const rows: Array<ProjectCallSMSConfig> =
      (lastCall?.[2] as Array<ProjectCallSMSConfig>) || [];
    return { rows, error: error?.message };
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TWILIO_TOKEN_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TWILIO_TOKEN_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TWILIO_TOKEN_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["Project", "ProjectCallSMSConfig"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(Response, "sendEntityArrayResponse")
      .mockImplementation(() => {});
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
        return props;
      });

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id","name","slug","version") VALUES ($1,'P',$2,1)`,
      [projectId.toString(), `p-${projectId.toString()}`],
    );

    mockRouter.routes.length = 0;
    new BaseAPI(ProjectCallSMSConfig, ProjectCallSMSConfigService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."ProjectCallSMSConfig"`);
    props = owner();
  });

  test("a created config stores the token encrypted, never in the clear", async () => {
    const id: ObjectID = await createConfig("A");
    const stored: string | null = await rawToken(id);
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(TOKEN);
    expect(Encryption.looksEncrypted(stored as string)).toBe(true);
    // Decrypting the stored ciphertext gives the token back.
    expect(await Encryption.decrypt(stored as string)).toBe(TOKEN);
  });

  test("two configs with the same token store different ciphertext", async () => {
    const a: ObjectID = await createConfig("A");
    const b: ObjectID = await createConfig("B");
    const storedA: string | null = await rawToken(a);
    const storedB: string | null = await rawToken(b);
    expect(storedA).not.toBe(storedB);
    expect(await Encryption.decrypt(storedA as string)).toBe(TOKEN);
    expect(await Encryption.decrypt(storedB as string)).toBe(TOKEN);
  });

  test("an owner reads the token back decrypted through the API", async () => {
    await createConfig("A");
    props = owner();
    const { rows, error } = await list({
      query: {},
      select: { name: true, twilioAuthToken: true },
    });
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.twilioAuthToken).toBe(TOKEN);
  });

  test("a viewer filtering by the plaintext token matches nothing: the WHERE runs on ciphertext", async () => {
    await createConfig("A");
    /*
     * A viewer may read the config rows but not the token column; even a role
     * that could read it gains no oracle, because the stored value is
     * ciphertext. Prove it as an owner (who passes the column check) so the
     * query reaches Postgres: an equality on the plaintext finds nothing.
     */
    props = owner();
    const equality: {
      rows: Array<ProjectCallSMSConfig>;
      error: string | undefined;
    } = await list({
      query: { twilioAuthToken: TOKEN },
      select: { name: true },
    });
    expect(equality.error).toBeUndefined();
    expect(equality.rows).toHaveLength(0);

    const substring: {
      rows: Array<ProjectCallSMSConfig>;
      error: string | undefined;
    } = await list({
      query: { twilioAuthToken: new Search("0123") },
      select: { name: true },
    });
    expect(substring.error).toBeUndefined();
    expect(substring.rows).toHaveLength(0);

    // And the viewer is refused the filter outright (no reads of the column).
    props = viewer();
    const refused: {
      rows: Array<ProjectCallSMSConfig>;
      error: string | undefined;
    } = await list({
      query: { twilioAuthToken: TOKEN },
      select: { name: true },
    });
    expect(refused.error).toContain(
      "do not have permissions to query on - twilioAuthToken",
    );
  });

  test("sorting a plain list by the token runs against ciphertext and does not error", async () => {
    await createConfig("A");
    await createConfig("B");
    props = owner();
    const { rows, error } = await list({
      query: {},
      select: { name: true },
      sort: { twilioAuthToken: "Ascending" },
    });
    expect(error).toBeUndefined();
    /*
     * Both rows come back; their order is the order of ciphertext, which
     * carries nothing about the token.
     */
    expect(rows).toHaveLength(2);
  });

  test("a token written as legacy plaintext still reads back as itself (upgrade window)", async () => {
    const legacyId: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."ProjectCallSMSConfig" ("_id","projectId","name","slug","twilioAccountSID","twilioAuthToken","version") VALUES ($1,$2,'Legacy',$3,$4,$5,1)`,
      [
        legacyId.toString(),
        projectId.toString(),
        `legacy-${legacyId.toString()}`,
        SID,
        TOKEN,
      ],
    );
    // Stored as plaintext, not our ciphertext.
    expect(
      Encryption.looksEncrypted((await rawToken(legacyId)) as string),
    ).toBe(false);
    props = owner();
    const { rows, error } = await list({
      query: {},
      select: { name: true, twilioAuthToken: true },
    });
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(1);
    // Read path hands back the not-yet-encrypted value untouched.
    expect(rows[0]!.twilioAuthToken).toBe(TOKEN);
  });
});
