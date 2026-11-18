// RunCron registers a repeatable BullMQ job when the job module is imported.
jest.mock("../../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import {
  ServerAlertSenders,
  tellMasterAdmins,
} from "../../../../../App/FeatureSet/Workers/Jobs/ServerAlerts/TellMasterAdmins";
import { AddServerAlerts1809183400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183400000-AddServerAlerts";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import logger from "../../../../Server/Utils/Logger";
import ServerSendingStatus from "../../../../Server/Utils/ServerSending/ServerSendingStatus";
import Phone from "../../../../Types/Phone";
import ObjectID from "../../../../Types/ObjectID";
import {
  ServerAlertCondition,
  ServerAlertSubject,
} from "../../../../Types/ServerSending/ServerAlerts";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../../Types/ServerSending/ServerSendingStatus";
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
import { DataSource, QueryRunner, Repository } from "typeorm";

/*
 * THE AddServerAlerts MIGRATION, AND THE JOB THAT READS AND WRITES ITS
 * COLUMNS, AGAINST A REAL POSTGRES (#6879).
 *
 * GlobalConfig is cloned from public into a uniquely named schema - so the
 * source's row is never read or modified - and put back as it was before
 * the migration, without its three columns; up() then runs there. What it
 * pins:
 *
 *   - additive and nullable: three columns, no default, and the row a
 *     server already has keeps every value it had, the new columns null -
 *     a server nobody chose for yet;
 *   - the job on that row, through GlobalConfigService as it runs: its
 *     first look writes only where things stand and tells nobody; email
 *     that then fails is told by push and SMS, never by email, and what it
 *     told is written; a run after that tells nothing more and writes
 *     nothing;
 *   - the number a master admin gives is stored as a phone number;
 *   - down() drops the columns again, and up() adds them back.
 *
 * Opt in with RUN_POSTGRES_SERVER_ALERTS_TESTS=true and the normal database
 * credentials; SERVER_ALERTS_TEST_DATABASE_HOST / _PORT / _NAME point it at
 * a database other than the local development one, already migrated.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SERVER_ALERTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const COLUMNS: Array<string> = [
  "serverAlertPhoneNumber",
  "isServerAlertPushOn",
  "serverAlertState",
];

const NOW: Date = new Date("2026-11-18T10:00:00.000Z");

function standing(
  states: Partial<Record<ServerSendingChannel, ServerSendingState>> = {},
): ServerSendingStatusAnswer {
  return {
    channels: [
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ].map((channel: ServerSendingChannel): ServerChannelStatus => {
      return {
        channel: channel,
        state: states[channel] || ServerSendingState.Working,
      } as ServerChannelStatus;
    }),
    globalProbes: { total: 2, reporting: 2 },
  };
}

describePostgres("AddServerAlerts against Postgres", () => {
  const schema: string = `server_alerts_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const zeroId: string = ObjectID.getZeroObjectID().toString();
  let database: DataSource;
  let models: DataSource;

  const connection: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  } = {
    host: process.env["SERVER_ALERTS_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["SERVER_ALERTS_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["SERVER_ALERTS_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
  };

  const sent: Array<string> = [];

  const senders: ServerAlertSenders = {
    push: async (): Promise<boolean> => {
      sent.push("push");
      return true;
    },
    sms: async (data: { to: Phone }): Promise<boolean> => {
      sent.push(`sms:${data.to.toString()}`);
      return true;
    },
    email: async (): Promise<boolean> => {
      sent.push("email");
      return true;
    },
  };

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function columnsOf(): Promise<
    Array<{
      column_name: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  > {
    return await database.query(
      `SELECT column_name, udt_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'GlobalConfig' AND column_name = ANY($2)
       ORDER BY column_name`,
      [schema, COLUMNS],
    );
  }

  async function storedRow(): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "disableSignup", "serverAlertPhoneNumber", "isServerAlertPushOn", "serverAlertState", "updatedAt"
         FROM "${schema}"."GlobalConfig" WHERE "_id" = $1`,
      [zeroId],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...connection,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."GlobalConfig" (LIKE public."GlobalConfig" INCLUDING ALL)`,
    );

    // The table as it was BEFORE the migration, whether or not the source has run it.
    for (const column of COLUMNS) {
      await database.query(
        `ALTER TABLE "${schema}"."GlobalConfig" DROP COLUMN IF EXISTS "${column}"`,
      );
    }

    // The one settings row a server has, with a setting on it.
    await database.query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "disableSignup", "version")
       VALUES ($1, true, 1)`,
      [zeroId],
    );

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddServerAlerts1809183400000().up(queryRunner);
    });

    // The model, on the migrated copy: how GlobalConfigService reads and writes it.
    models = new DataSource({
      type: "postgres",
      ...connection,
      schema: schema,
      entities: [GlobalConfig],
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await models.initialize();
  });

  afterAll(async () => {
    if (models?.isInitialized) {
      await models.destroy();
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    sent.length = 0;

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(models);

    for (const silenced of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds three nullable columns with no default", async () => {
    expect(await columnsOf()).toEqual([
      {
        column_name: "isServerAlertPushOn",
        udt_name: "bool",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "serverAlertPhoneNumber",
        udt_name: "varchar",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "serverAlertState",
        udt_name: "jsonb",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });

  test("the row the server had keeps its values, the new columns null", async () => {
    expect(await storedRow()).toMatchObject({
      disableSignup: true,
      serverAlertPhoneNumber: null,
      isServerAlertPushOn: null,
      serverAlertState: null,
    });
  });

  test("the job: its first look tells nobody, email that then fails is told by push and SMS, and nothing more after", async () => {
    // A number a master admin gave, through the model as the settings form saves it.
    const repository: Repository<GlobalConfig> =
      models.getRepository(GlobalConfig);

    await repository.update(
      { _id: zeroId } as never,
      { serverAlertPhoneNumber: new Phone("+15550100") } as never,
    );

    expect((await storedRow())["serverAlertPhoneNumber"]).toBe("+15550100");

    const getAnswer: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServerSendingStatus,
      "getAnswer",
    );

    getAnswer.mockResolvedValue(standing() as never);
    await tellMasterAdmins({ now: NOW, senders });

    expect(sent).toEqual([]);
    expect(
      ((await storedRow())["serverAlertState"] as Record<string, unknown>)[
        ServerAlertSubject.Email
      ],
    ).toMatchObject({ told: ServerAlertCondition.Working });

    getAnswer.mockResolvedValue(
      standing({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
      }) as never,
    );
    await tellMasterAdmins({
      now: new Date(NOW.getTime() + 5 * 60 * 1000),
      senders,
    });

    expect(sent).toEqual(["push", "sms:+15550100"]);

    const told: Record<string, unknown> = await storedRow();

    expect(
      (told["serverAlertState"] as Record<string, unknown>)[
        ServerAlertSubject.Email
      ],
    ).toMatchObject({
      told: ServerAlertCondition.Failing,
      toldAt: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
    });

    // Still failing five minutes on: nothing sent, nothing written.
    sent.length = 0;
    await tellMasterAdmins({
      now: new Date(NOW.getTime() + 10 * 60 * 1000),
      senders,
    });

    expect(sent).toEqual([]);
    expect((await storedRow())["updatedAt"]).toEqual(told["updatedAt"]);
  });

  test("down() drops the columns again, and up() adds them back", async () => {
    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddServerAlerts1809183400000().down(queryRunner);
    });

    expect(await columnsOf()).toEqual([]);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddServerAlerts1809183400000().up(queryRunner);
    });

    expect(await columnsOf()).toHaveLength(3);
  });
});
