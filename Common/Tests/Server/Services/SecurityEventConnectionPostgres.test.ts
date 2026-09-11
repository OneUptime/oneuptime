import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { AddSecurityEventConnection1792400000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1792400000000-AddSecurityEventConnection";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";
import SecurityEventConnectorType from "../../../Types/SecurityEvent/SecurityEventConnectorType";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Opt in against local development Postgres. The suite creates a unique schema
 * and applies the feature migration there, so it exercises TypeORM, encryption,
 * optimistic checkpoint writes, and update hooks without touching project data.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SECURITY_EVENT_CONNECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const INITIAL_CREDENTIALS: string = JSON.stringify({
  accessKeyId: "AKIAINTEGRATION",
  secretAccessKey: "first-secret",
});
const ROTATED_CREDENTIALS: string = JSON.stringify({
  accessKeyId: "AKIAINTEGRATION",
  secretAccessKey: "rotated-secret",
});
const CHECKPOINT: string = JSON.stringify({
  version: 1,
  nextStart: "2026-09-11T12:00:00.000Z",
});

interface StoredConnection {
  credentialJson: string;
  cursor: string | null;
  isEnabled: boolean;
  pollIntervalInMinutes: number;
  sourceFingerprint: string;
  sourceGeneration: number;
}

jest.setTimeout(180_000);

describePostgres("SecurityEventConnection persistence against Postgres", () => {
  const schema: string = `security_event_connection_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async (): Promise<void> => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SECURITY_EVENT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["SECURITY_EVENT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Project" ("_id" uuid PRIMARY KEY)`,
    );
    await database.query(
      `CREATE TABLE "${schema}"."User" ("_id" uuid PRIMARY KEY)`,
    );
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await new AddSecurityEventConnection1792400000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id") VALUES ($1)`,
      [PROJECT_ID.toString()],
    );
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function stored(id: ObjectID): Promise<StoredConnection> {
    const rows: Array<StoredConnection> = await database.query(
      `SELECT "credentialJson", "cursor", "isEnabled", "pollIntervalInMinutes", "sourceFingerprint", "sourceGeneration"
       FROM "${schema}"."SecurityEventConnection" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  async function loaded(id: ObjectID): Promise<SecurityEventConnection> {
    const item: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id,
        select: {
          _id: true,
          projectId: true,
          provider: true,
          configuration: true,
          credentialJson: true,
          sourceGeneration: true,
          cursor: true,
          version: true,
        },
        props: { isRoot: true },
      });
    if (!item) {
      throw new Error("Persisted security event connection was not found.");
    }
    return item;
  }

  test("encrypts secrets and checkpoints while preserving identity on rotation", async () => {
    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection.name = "Postgres integration Security Hub";
    connection.projectId = PROJECT_ID;
    connection.provider = SecurityEventConnectorType.AwsSecurityHub;
    connection.configuration = { region: "us-east-1" };
    connection.credentialJson = INITIAL_CREDENTIALS;
    const created: SecurityEventConnection =
      await SecurityEventConnectionService.create({
        data: connection,
        props: { isRoot: true, tenantId: PROJECT_ID },
      });
    const connectionId: ObjectID = created.id!;
    expect(created.credentialJson).toBeUndefined();
    expect(created.cursor).toBeUndefined();
    expect(created.sourceFingerprint).toBeUndefined();
    expect(created.sourceGeneration).toBeUndefined();
    const createdRow: StoredConnection = await stored(connectionId);
    expect(createdRow.credentialJson).not.toBe(INITIAL_CREDENTIALS);
    expect(createdRow.credentialJson).not.toContain("first-secret");
    expect(createdRow.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(createdRow.sourceGeneration).toBe(1);
    expect(createdRow.isEnabled).toBe(true);
    expect(createdRow.pollIntervalInMinutes).toBe(5);
    expect((await loaded(connectionId)).credentialJson).toBe(
      INITIAL_CREDENTIALS,
    );

    const current: SecurityEventConnection = await loaded(connectionId);
    await expect(
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id: connectionId,
        expectedVersion: current.version!,
        checkpoint: {
          cursor: CHECKPOINT,
          lastPolledAt: new Date("2026-09-11T12:00:00.000Z"),
          lastPollResult: { complete: true } as JSONObject,
          lastError: null,
        },
      }),
    ).resolves.toBe(1);
    const checkpointRow: StoredConnection = await stored(connectionId);
    expect(checkpointRow.cursor).not.toBe(CHECKPOINT);
    expect(checkpointRow.cursor).not.toContain("nextStart");
    expect((await loaded(connectionId)).cursor).toBe(CHECKPOINT);

    await SecurityEventConnectionService.updateOneById({
      id: connectionId,
      data: { credentialJson: ROTATED_CREDENTIALS },
      props: { isRoot: true },
    });
    const rotatedRow: StoredConnection = await stored(connectionId);
    expect(rotatedRow.credentialJson).not.toBe(ROTATED_CREDENTIALS);
    expect(rotatedRow.cursor).toBeNull();
    expect(rotatedRow.sourceGeneration).toBe(1);
    expect((await loaded(connectionId)).credentialJson).toBe(
      ROTATED_CREDENTIALS,
    );

    const afterRotation: SecurityEventConnection = await loaded(connectionId);
    await expect(
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id: connectionId,
        expectedVersion: afterRotation.version!,
        checkpoint: {
          cursor: CHECKPOINT,
          lastPolledAt: new Date("2026-09-11T12:05:00.000Z"),
          lastPollResult: { complete: true } as JSONObject,
          lastError: null,
        },
      }),
    ).resolves.toBe(1);
    const beforeUnchangedEdit: StoredConnection = await stored(connectionId);
    const unchangedConfigurationUpdate: PartialEntity<SecurityEventConnection> =
      {
        configuration: { region: "us-east-1" },
      } as unknown as PartialEntity<SecurityEventConnection>;
    await SecurityEventConnectionService.updateOneById({
      id: connectionId,
      data: unchangedConfigurationUpdate,
      props: { isRoot: true },
    });
    expect(await stored(connectionId)).toMatchObject({
      cursor: beforeUnchangedEdit.cursor,
      sourceFingerprint: beforeUnchangedEdit.sourceFingerprint,
      sourceGeneration: 1,
    });

    const versionBeforeRepoint: number = (await loaded(connectionId)).version!;
    const configurationUpdate: PartialEntity<SecurityEventConnection> = {
      configuration: { region: "eu-west-2" },
    } as unknown as PartialEntity<SecurityEventConnection>;
    await SecurityEventConnectionService.updateOneById({
      id: connectionId,
      data: configurationUpdate,
      props: { isRoot: true },
    });
    expect(await stored(connectionId)).toMatchObject({
      cursor: null,
      sourceGeneration: 2,
    });
    await expect(
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id: connectionId,
        expectedVersion: versionBeforeRepoint,
        checkpoint: {
          cursor: CHECKPOINT,
          lastPolledAt: new Date("2026-09-11T12:10:00.000Z"),
          lastPollResult: { complete: true } as JSONObject,
          lastError: null,
        },
      }),
    ).resolves.toBe(0);
    expect((await stored(connectionId)).cursor).toBeNull();
  });
});
