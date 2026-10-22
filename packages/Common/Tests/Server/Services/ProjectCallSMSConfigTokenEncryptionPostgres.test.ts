import Entities from "../../../Models/DatabaseModels/Index";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Encryption from "../../../Server/Utils/Encryption";
import { PROJECT_TWILIO_CONFIG_SELECT } from "../../../Server/Utils/TwilioConfigSelect";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import Phone from "../../../Types/Phone";
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
 *   - A status page's subscriber SMS read the page's Twilio config THROUGH
 *     the page (a relation), and get the token decrypted - the token itself,
 *     never the ciphertext the database holds, which Twilio would refuse.
 *     And the numbers its SMS go out from: a config's Twilio SMS Phone
 *     Numbers (a column of its own) come back through the page with the
 *     rest, so a Singapore page's SMS go out from its mobile number.
 *   - A caller who may read a status page but not a credential of the
 *     config it names cannot filter the page by that credential: neither
 *     the Twilio token nor the SMTP password (stored as written) answers a
 *     guess through the relation, while a filter on a column the relation
 *     may show still works.
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
  const SMTP_PASSWORD: string = "s3cret-smtp-password";
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

  function callerWith(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      ...customDomainCaller({ permissions, projectId }),
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
    return await listRoute<ProjectCallSMSConfig>(
      "/call-sms-config/get-list",
      body,
    );
  }

  async function listStatusPages(body: JSONObject): Promise<{
    rows: Array<StatusPage>;
    error: string | undefined;
  }> {
    return await listRoute<StatusPage>("/status-page/get-list", body);
  }

  /*
   * A get-list through BaseAPI, the body serialized as a client sends it
   * (operators as {_type, value}), so the route deserializes it as it does
   * a real request.
   */
  async function listRoute<T>(
    route: string,
    body: JSONObject,
  ): Promise<{
    rows: Array<T>;
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
      .match("POST", route)
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
    const rows: Array<T> = (lastCall?.[2] as Array<T>) || [];
    return { rows, error: error?.message };
  }

  // A config a status page can send SMS through: SID, token and a number.
  async function createSendingConfig(): Promise<ObjectID> {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    config.projectId = projectId;
    config.name = "Production Twilio";
    config.twilioAccountSID = SID;
    config.twilioAuthToken = TOKEN;
    config.twilioPrimaryPhoneNumber = new Phone("+15551234567");
    const created: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: config,
        props: { isRoot: true },
      });
    return created.id!;
  }

  // An SMTP config, its password stored as written (that column is not encrypted).
  async function createSmtpConfig(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."ProjectSMTPConfig" ("_id","projectId","name","slug","version","fromEmail","fromName","hostname","port","username","password") VALUES ($1,$2,'Mail',$3,1,'alerts@example.com','Alerts','smtp.example.com',587,'mailer',$4)`,
      [
        id.toString(),
        projectId.toString(),
        `mail-${id.toString()}`,
        SMTP_PASSWORD,
      ],
    );
    return id;
  }

  async function createStatusPage(data: {
    callSmsConfigId?: ObjectID | undefined;
    smtpConfigId?: ObjectID | undefined;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."StatusPage" ("_id","projectId","name","slug","version","callSmsConfigId","smtpConfigId") VALUES ($1,$2,'Status',$3,1,$4,$5)`,
      [
        id.toString(),
        projectId.toString(),
        `status-${id.toString()}`,
        data.callSmsConfigId ? data.callSmsConfigId.toString() : null,
        data.smtpConfigId ? data.smtpConfigId.toString() : null,
      ],
    );
    return id;
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
    for (const table of [
      "Project",
      "ProjectCallSMSConfig",
      "ProjectSMTPConfig",
      "File",
      "StatusPage",
    ]) {
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
    new BaseAPI(StatusPage, StatusPageService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."StatusPage"`);
    await database.query(`DELETE FROM "${schema}"."ProjectSMTPConfig"`);
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

  describe("a status page's Twilio config, read through the page", () => {
    test("the subscriber notifications get the token itself, decrypted, to send with", async () => {
      const configId: ObjectID = await createSendingConfig();
      const statusPageId: ObjectID = await createStatusPage({
        callSmsConfigId: configId,
      });

      // Stored encrypted, as every config's token now is.
      expect(
        Encryption.looksEncrypted((await rawToken(configId)) as string),
      ).toBe(true);

      /*
       * Every status page SMS - incidents, notes, maintenance,
       * announcements, episodes, postmortems, reports - finds its pages
       * and their Twilio config here, the config joined into the page.
       */
      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          statusPageId,
        ]);

      expect(statusPages).toHaveLength(1);
      expect(statusPages[0]!.callSmsConfig?.twilioAuthToken).toBe(TOKEN);
      expect(statusPages[0]!.callSmsConfig?.twilioAccountSID).toBe(SID);

      // What the senders hand the SMS service: the token, never ciphertext.
      const twilioConfig: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(
          statusPages[0]!.callSmsConfig,
        );
      expect(twilioConfig?.authToken).toBe(TOKEN);
      expect(twilioConfig?.accountSid).toBe(SID);
      // A config without SMS numbers sends SMS from the numbers calls do.
      expect(twilioConfig?.smsPhoneNumbers).toBeUndefined();
    });

    test("a config's SMS numbers are stored, and read back through the page with the rest", async () => {
      const configId: ObjectID = await createSendingConfig();

      await ProjectCallSMSConfigService.updateOneById({
        id: configId,
        data: {
          twilioPrimaryPhoneNumber: new Phone("+6561234567"),
          twilioSmsPhoneNumbers: "+6581234567, +447700900123",
        },
        props: { isRoot: true },
      });

      const statusPageId: ObjectID = await createStatusPage({
        callSmsConfigId: configId,
      });

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          statusPageId,
        ]);

      expect(statusPages[0]!.callSmsConfig?.twilioSmsPhoneNumbers).toBe(
        "+6581234567, +447700900123",
      );

      const twilioConfig: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(
          statusPages[0]!.callSmsConfig,
        );

      expect(twilioConfig?.primaryPhoneNumber?.toString()).toBe("+6561234567");
      expect(
        (twilioConfig?.smsPhoneNumbers || []).map((phone: Phone): string => {
          return phone.toString();
        }),
      ).toEqual(["+6581234567", "+447700900123"]);
      expect(twilioConfig?.authToken).toBe(TOKEN);
    });

    test("a list of SMS numbers that is not one is refused on real Postgres, and nothing changes", async () => {
      const configId: ObjectID = await createSendingConfig();

      await expect(
        ProjectCallSMSConfigService.updateOneById({
          id: configId,
          data: { twilioSmsPhoneNumbers: "+6581234567, mobile" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow('"mobile" is not a phone number.');

      const rows: Array<{ twilioSmsPhoneNumbers: string | null }> =
        (await database.query(
          `SELECT "twilioSmsPhoneNumbers" FROM "${schema}"."ProjectCallSMSConfig" WHERE "_id" = $1`,
          [configId.toString()],
        )) as Array<{ twilioSmsPhoneNumbers: string | null }>;

      expect(rows[0]!.twilioSmsPhoneNumbers).toBeNull();
    });

    test("the confirmation SMS a new subscriber gets reads the token decrypted too", async () => {
      const configId: ObjectID = await createSendingConfig();
      const statusPageId: ObjectID = await createStatusPage({
        callSmsConfigId: configId,
      });

      // The read StatusPageSubscriberService makes for 'You have subscribed'.
      const statusPage: StatusPage | null = await StatusPageService.findOneBy({
        query: { _id: statusPageId.toString() },
        select: {
          callSmsConfig: PROJECT_TWILIO_CONFIG_SELECT,
        },
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(statusPage?.callSmsConfig?.twilioAuthToken).toBe(TOKEN);
      expect(
        ProjectCallSMSConfigService.toTwilioConfig(statusPage!.callSmsConfig)
          ?.authToken,
      ).toBe(TOKEN);
    });

    test("a token still stored as legacy plaintext reads as itself through the page (upgrade window)", async () => {
      const legacyId: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."ProjectCallSMSConfig" ("_id","projectId","name","slug","twilioAccountSID","twilioAuthToken","twilioPrimaryPhoneNumber","version") VALUES ($1,$2,'Legacy',$3,$4,$5,'+15551234567',1)`,
        [
          legacyId.toString(),
          projectId.toString(),
          `legacy-${legacyId.toString()}`,
          SID,
          TOKEN,
        ],
      );
      const statusPageId: ObjectID = await createStatusPage({
        callSmsConfigId: legacyId,
      });

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          statusPageId,
        ]);

      expect(statusPages[0]!.callSmsConfig?.twilioAuthToken).toBe(TOKEN);
    });
  });

  describe("filtering status pages by a credential of the config they name", () => {
    test("a viewer is refused a filter on the Twilio token through the page", async () => {
      const configId: ObjectID = await createSendingConfig();
      await createStatusPage({ callSmsConfigId: configId });

      for (const permissions of [
        [Permission.Viewer],
        [Permission.ProjectMember],
        [Permission.StatusPageViewer],
        [Permission.StatusPageAdmin],
      ]) {
        props = callerWith(permissions);
        const { rows, error } = await listStatusPages({
          query: {
            callSmsConfig: { twilioAuthToken: new StartsWith(TOKEN[0]!) },
          },
          select: { name: true },
        });

        expect(error).toBe(
          "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through callSmsConfig. You need one of these permissions: Project Owner, Project Admin, Read Call and SMS.",
        );
        expect(rows).toHaveLength(0);
      }
    });

    test("a viewer is refused a filter on the SMTP password through the page", async () => {
      const smtpConfigId: ObjectID = await createSmtpConfig();
      await createStatusPage({ smtpConfigId });

      for (const permissions of [
        [Permission.Viewer],
        [Permission.ProjectMember],
        [Permission.StatusPageViewer],
      ]) {
        props = callerWith(permissions);

        for (const guess of [
          new StartsWith(SMTP_PASSWORD.slice(0, 1)),
          new Search(SMTP_PASSWORD.slice(1, 4)),
          SMTP_PASSWORD,
        ]) {
          const { rows, error } = await listStatusPages({
            query: { smtpConfig: { password: guess } },
            select: { name: true },
          });

          expect(error).toContain(
            "You do not have permissions to query on - password of SMTP Config through smtpConfig.",
          );
          expect(rows).toHaveLength(0);
        }
      }
    });

    test("an owner's filter through the page reaches Postgres, and the token's ciphertext answers no guess", async () => {
      const configId: ObjectID = await createSendingConfig();
      await createStatusPage({ callSmsConfigId: configId });

      props = owner();
      const { rows, error } = await listStatusPages({
        query: {
          callSmsConfig: { twilioAuthToken: new StartsWith(TOKEN.slice(0, 4)) },
        },
        select: { name: true },
      });

      expect(error).toBeUndefined();
      expect(rows).toHaveLength(0);
    });

    test("a filter on a column the relation may show still works for a viewer", async () => {
      const configId: ObjectID = await createSendingConfig();
      const statusPageId: ObjectID = await createStatusPage({
        callSmsConfigId: configId,
      });
      // A page with no config, which the filter must leave out.
      await createStatusPage({});

      props = viewer();
      const { rows, error } = await listStatusPages({
        query: { callSmsConfig: { name: new Search("Production") } },
        select: { name: true },
      });

      expect(error).toBeUndefined();
      expect(
        rows.map((row: StatusPage): string => {
          return row.id!.toString();
        }),
      ).toEqual([statusPageId.toString()]);
    });
  });
});
