import EncryptProjectCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptProjectCredentials";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
import Entities from "Common/Models/DatabaseModels/Index";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { ProjectCredentialsEncryptedColumns1809182300000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182300000-ProjectCredentialsEncryptedColumns";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "Common/Server/Utils/Mail/ProjectSmtpConfigSelect";
import EmailServer from "Common/Types/Email/EmailServer";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * A PROJECT'S CREDENTIALS THROUGH THE UPGRADE THAT ENCRYPTS THEM, ON A REAL
 * POSTGRES (#8989).
 *
 * On the tables as they were before the upgrade - the SMTP password a
 * varchar(500), the webhook signing secret a varchar(100) - with every
 * credential stored as written, the upgrade runs as it does: the schema
 * migration (1809182300000-ProjectCredentialsEncryptedColumns), then the
 * EncryptProjectCredentials data migration, and a day later the
 * CredentialsAtRest:EncryptInPlace job's pass (#9266). Every reader reads
 * through the real services all along:
 *
 *   - before any of it, after the schema migration, after the data
 *     migration and after the job, every credential reads as written - a
 *     status page's SMTP config through its relation included - and
 *     toEmailServer hands the mail service the password and client secret
 *     as written;
 *   - the schema migration and the data migration keep every value as
 *     written - what a server of the release before reads while the upgrade
 *     rolls out; the job leaves only ciphertext, which decrypts to the value
 *     written - a 500-character password included, which only the widened
 *     column holds encrypted;
 *   - a second run changes nothing, byte for byte; two runs at once encrypt
 *     each value once;
 *   - a credential saved through a service afterwards is stored encrypted.
 *
 * Opt in with RUN_POSTGRES_PROJECT_CREDENTIALS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The tables' STRUCTURE
 * is cloned into a unique schema (search_path holds only that schema),
 * dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROJECT_CREDENTIALS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * PROJECT_CREDENTIALS_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROJECT_CREDENTIALS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "ProjectSMTPConfig",
  "StatusPage",
  "WorkspaceProjectAuthToken",
  "WorkspaceUserAuthToken",
  "UserWebhook",
  "CodeRepository",
];

const PROJECT_ID: string = "89890000-0000-4000-8000-0000000000f1";
const USER_ID: string = "89890000-0000-4000-8000-0000000000f2";
const PASSWORD_CONFIG_ID: string = "89890000-0000-4000-8000-0000000000a1";
const OAUTH_CONFIG_ID: string = "89890000-0000-4000-8000-0000000000a2";
const STATUS_PAGE_ID: string = "89890000-0000-4000-8000-0000000000b1";
const SLACK_ID: string = "89890000-0000-4000-8000-0000000000c1";
const USER_LINK_ID: string = "89890000-0000-4000-8000-0000000000c2";
const WEBHOOK_ID: string = "89890000-0000-4000-8000-0000000000d1";
const REPOSITORY_ID: string = "89890000-0000-4000-8000-0000000000e1";

// Each as written: the password as long as its column took, spaces kept.
const PASSWORD: string = ` ${"p".repeat(498)} `;
const CLIENT_SECRET: string = `-----BEGIN PRIVATE KEY-----\n${"k".repeat(1600)}\n-----END PRIVATE KEY-----\n`;
const SLACK_TOKEN: string = "xoxb-0000000001-0000000002-slackbottoken";
const SLACK_USER_TOKEN: string = "xoxp-0000000003-0000000004-slackusertoken";
const SIGNING_SECRET: string = `s${"e".repeat(98)}t`;
const REPOSITORY_SECRET: string = "a repository webhook secret";

// Where each credential is, and what it holds as written.
const STORED: Array<{
  table: string;
  id: string;
  column: string;
  written: string;
}> = [
  {
    table: "ProjectSMTPConfig",
    id: PASSWORD_CONFIG_ID,
    column: "password",
    written: PASSWORD,
  },
  {
    table: "ProjectSMTPConfig",
    id: OAUTH_CONFIG_ID,
    column: "clientSecret",
    written: CLIENT_SECRET,
  },
  {
    table: "WorkspaceProjectAuthToken",
    id: SLACK_ID,
    column: "authToken",
    written: SLACK_TOKEN,
  },
  {
    table: "WorkspaceUserAuthToken",
    id: USER_LINK_ID,
    column: "authToken",
    written: SLACK_USER_TOKEN,
  },
  {
    table: "UserWebhook",
    id: WEBHOOK_ID,
    column: "secret",
    written: SIGNING_SECRET,
  },
  {
    table: "CodeRepository",
    id: REPOSITORY_ID,
    column: "secretToken",
    written: REPOSITORY_SECRET,
  },
];

interface ReadThroughServices {
  password: string | undefined;
  clientSecret: string | undefined;
  emailServerPassword: string | undefined;
  emailServerClientSecret: string | undefined;
  statusPagePassword: string | undefined;
  slackToken: string | undefined;
  slackUserToken: string | undefined;
  signingSecret: string | undefined;
  repositorySecret: string | undefined;
}

const AS_WRITTEN: ReadThroughServices = {
  password: PASSWORD,
  clientSecret: CLIENT_SECRET,
  emailServerPassword: PASSWORD,
  emailServerClientSecret: CLIENT_SECRET,
  statusPagePassword: PASSWORD,
  slackToken: SLACK_TOKEN,
  slackUserToken: SLACK_USER_TOKEN,
  signingSecret: SIGNING_SECRET,
  repositorySecret: REPOSITORY_SECRET,
};

describePostgres(
  "a project's credentials through their upgrade (Postgres)",
  () => {
    const schema: string = `project_credentials_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    async function withRunner(
      work: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await work(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    async function stored(
      table: string,
      id: string,
      column: string,
    ): Promise<string | null> {
      const rows: Array<Record<string, string | null>> = await database.query(
        `SELECT "${column}" AS "value" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );

      return rows[0]!["value"] ?? null;
    }

    async function storedValues(): Promise<Array<string | null>> {
      const values: Array<string | null> = [];

      for (const credential of STORED) {
        values.push(
          await stored(credential.table, credential.id, credential.column),
        );
      }

      return values;
    }

    async function columnType(table: string, column: string): Promise<string> {
      const rows: Array<{ data_type: string; max: number | null }> =
        await database.query(
          `SELECT data_type, character_maximum_length AS "max" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schema, table, column],
        );

      return rows[0]!.max
        ? `${rows[0]!.data_type}(${rows[0]!.max})`
        : rows[0]!.data_type;
    }

    // Every reader, through the services, as the senders read.
    async function readThroughServices(): Promise<ReadThroughServices> {
      const passwordConfig: ProjectSmtpConfig | null =
        await ProjectSmtpConfigService.findOneById({
          id: new ObjectID(PASSWORD_CONFIG_ID),
          select: PROJECT_SMTP_CONFIG_SEND_SELECT,
          props: { isRoot: true },
        });
      const oauthConfig: ProjectSmtpConfig | null =
        await ProjectSmtpConfigService.findOneById({
          id: new ObjectID(OAUTH_CONFIG_ID),
          select: PROJECT_SMTP_CONFIG_SEND_SELECT,
          props: { isRoot: true },
        });
      const page: StatusPage | null = await StatusPageService.findOneById({
        id: new ObjectID(STATUS_PAGE_ID),
        select: { _id: true, smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT },
        props: { isRoot: true },
      });
      const slack: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: new ObjectID(PROJECT_ID),
          workspaceType: WorkspaceType.Slack,
        });
      const slackUser: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.getUserAuth({
          projectId: new ObjectID(PROJECT_ID),
          userId: new ObjectID(USER_ID),
          workspaceType: WorkspaceType.Slack,
        });
      const webhook: UserWebhook | null = await UserWebhookService.findOneById({
        id: new ObjectID(WEBHOOK_ID),
        select: { secret: true },
        props: { isRoot: true },
      });
      const repository: CodeRepository | null =
        await CodeRepositoryService.findOneById({
          id: new ObjectID(REPOSITORY_ID),
          select: { secretToken: true },
          props: { isRoot: true },
        });

      const passwordServer: EmailServer | undefined =
        ProjectSmtpConfigService.toEmailServer(passwordConfig!);
      const oauthServer: EmailServer | undefined =
        ProjectSmtpConfigService.toEmailServer(oauthConfig!);

      return {
        password: passwordConfig?.password,
        clientSecret: oauthConfig?.clientSecret,
        emailServerPassword: passwordServer?.password,
        emailServerClientSecret: oauthServer?.clientSecret,
        statusPagePassword: page?.smtpConfig?.password,
        slackToken: slack?.authToken,
        slackUserToken: slackUser?.authToken,
        signingSecret: webhook?.secret,
        repositorySecret: repository?.secretToken,
      };
    }

    // The schema migration, unless a test before this one ran it.
    async function upgradeSchema(): Promise<void> {
      if ((await columnType("ProjectSMTPConfig", "password")) === "text") {
        return;
      }

      await withRunner(async (queryRunner: QueryRunner) => {
        await new ProjectCredentialsEncryptedColumns1809182300000().up(
          queryRunner,
        );
      });
    }

    async function seedAsWritten(): Promise<void> {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await database.query(
        `INSERT INTO "${schema}"."ProjectSMTPConfig" ("_id", "version", "projectId", "name", "slug", "hostname", "port", "username", "password", "fromEmail", "fromName", "transportType", "authType") VALUES ($1, 1, $2, 'Mail server', $3, 'smtp.example.com', 587, 'alerts@example.com', $4, 'alerts@example.com', 'Alerts', 'SMTP', 'Username and Password')`,
        [
          PASSWORD_CONFIG_ID,
          PROJECT_ID,
          `mail-${PASSWORD_CONFIG_ID}`,
          PASSWORD,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."ProjectSMTPConfig" ("_id", "version", "projectId", "name", "slug", "hostname", "port", "username", "fromEmail", "fromName", "transportType", "authType", "oauthProviderType", "clientId", "clientSecret", "tokenUrl", "scope") VALUES ($1, 1, $2, 'Google Workspace', $3, 'smtp.gmail.com', 587, 'alerts@example.com', 'alerts@example.com', 'Alerts', 'SMTP', 'OAuth', 'JWT Bearer', 'alerts@example.iam.example.com', $4, 'https://oauth2.googleapis.com/token', 'https://mail.google.com/')`,
        [
          OAUTH_CONFIG_ID,
          PROJECT_ID,
          `google-${OAUTH_CONFIG_ID}`,
          CLIENT_SECRET,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."StatusPage" ("_id", "version", "projectId", "name", "slug", "smtpConfigId") VALUES ($1, 1, $2, 'Status', $3, $4)`,
        [
          STATUS_PAGE_ID,
          PROJECT_ID,
          `status-${STATUS_PAGE_ID}`,
          PASSWORD_CONFIG_ID,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."WorkspaceProjectAuthToken" ("_id", "version", "projectId", "authToken", "workspaceType", "workspaceProjectId", "miscData") VALUES ($1, 1, $2, $3, 'Slack', 'T0000000001', '{"teamId":"T0000000001","teamName":"Example","botUserId":"B1"}')`,
        [SLACK_ID, PROJECT_ID, SLACK_TOKEN],
      );
      await database.query(
        `INSERT INTO "${schema}"."WorkspaceUserAuthToken" ("_id", "version", "projectId", "userId", "authToken", "workspaceType", "workspaceUserId", "miscData") VALUES ($1, 1, $2, $3, $4, 'Slack', 'U0000000001', '{"userId":"U0000000001"}')`,
        [USER_LINK_ID, PROJECT_ID, USER_ID, SLACK_USER_TOKEN],
      );
      await database.query(
        `INSERT INTO "${schema}"."UserWebhook" ("_id", "version", "projectId", "userId", "name", "webhookUrl", "secret") VALUES ($1, 1, $2, $3, 'My endpoint', 'https://hooks.example.com/oneuptime', $4)`,
        [WEBHOOK_ID, PROJECT_ID, USER_ID, SIGNING_SECRET],
      );
      await database.query(
        `INSERT INTO "${schema}"."CodeRepository" ("_id", "version", "projectId", "name", "slug", "repositoryHostedAt", "organizationName", "repositoryName", "secretToken") VALUES ($1, 1, $2, 'example/service', $3, 'GitHub', 'example', 'service', $4)`,
        [
          REPOSITORY_ID,
          PROJECT_ID,
          `repository-${REPOSITORY_ID}`,
          REPOSITORY_SECRET,
        ],
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROJECT_CREDENTIALS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROJECT_CREDENTIALS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROJECT_CREDENTIALS_TEST_DATABASE_NAME"] ||
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

      // The tables as they were before the upgrade.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new ProjectCredentialsEncryptedColumns1809182300000().down(
          queryRunner,
        );
      });
    }, 120000);

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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the upgrade: every credential reads as written before, between and after, and is stored encrypted at the end", async () => {
      await seedAsWritten();

      // Before the upgrade, on the old columns.
      expect(await columnType("ProjectSMTPConfig", "password")).toBe(
        "character varying(500)",
      );
      expect(await columnType("UserWebhook", "secret")).toBe(
        "character varying(100)",
      );
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // The schema migration keeps every value.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new ProjectCredentialsEncryptedColumns1809182300000().up(
          queryRunner,
        );
      });

      expect(await columnType("ProjectSMTPConfig", "password")).toBe("text");
      expect(await columnType("UserWebhook", "secret")).toBe("text");
      expect(await storedValues()).toEqual(
        STORED.map((credential: (typeof STORED)[number]): string => {
          return credential.written;
        }),
      );
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      /*
       * The data migration changes nothing: a server of the release before,
       * still running while the upgrade rolls out, reads every credential as
       * stored, as written.
       */
      await new EncryptProjectCredentials().migrate();

      expect(await storedValues()).toEqual(
        STORED.map((credential: (typeof STORED)[number]): string => {
          return credential.written;
        }),
      );
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // A day later, the job leaves only ciphertext, of the values written.
      await encryptInPlaceADayLater(new EncryptProjectCredentials().name);

      for (const credential of STORED) {
        const value: string | null = await stored(
          credential.table,
          credential.id,
          credential.column,
        );

        expect([
          credential.column,
          Encryption.looksEncrypted(String(value)),
        ]).toEqual([credential.column, true]);
        expect(await Encryption.decrypt(String(value))).toBe(
          credential.written,
        );
      }

      // A 500-character password, stored as 704 characters: only text holds it.
      expect(
        String(
          await stored("ProjectSMTPConfig", PASSWORD_CONFIG_ID, "password"),
        ).length,
      ).toBe(704);

      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // Run again, nothing changes, byte for byte.
      const afterOne: Array<string | null> = await storedValues();

      await new EncryptProjectCredentials().migrate();
      await encryptInPlaceADayLater(new EncryptProjectCredentials().name);

      expect(await storedValues()).toEqual(afterOne);
    });

    test("two runs at once encrypt each value once", async () => {
      await upgradeSchema();
      await seedAsWritten();

      await Promise.all([
        encryptInPlaceADayLater(new EncryptProjectCredentials().name),
        encryptInPlaceADayLater(new EncryptProjectCredentials().name),
      ]);

      for (const credential of STORED) {
        const value: string | null = await stored(
          credential.table,
          credential.id,
          credential.column,
        );

        // Once: one decryption gives the value written, not another ciphertext.
        expect(await Encryption.decrypt(String(value))).toBe(
          credential.written,
        );
      }

      expect(await readThroughServices()).toEqual(AS_WRITTEN);
    });

    test("a credential saved through a service after the upgrade is stored encrypted, and read as saved", async () => {
      await upgradeSchema();
      await seedAsWritten();
      await new EncryptProjectCredentials().migrate();
      await encryptInPlaceADayLater(new EncryptProjectCredentials().name);

      await ProjectSmtpConfigService.updateOneById({
        id: new ObjectID(PASSWORD_CONFIG_ID),
        data: { password: "a password set after the upgrade" },
        props: { isRoot: true },
      });

      const value: string | null = await stored(
        "ProjectSMTPConfig",
        PASSWORD_CONFIG_ID,
        "password",
      );

      expect(Encryption.looksEncrypted(String(value))).toBe(true);
      expect(await Encryption.decrypt(String(value))).toBe(
        "a password set after the upgrade",
      );
      expect((await readThroughServices()).password).toBe(
        "a password set after the upgrade",
      );
    });
  },
);
