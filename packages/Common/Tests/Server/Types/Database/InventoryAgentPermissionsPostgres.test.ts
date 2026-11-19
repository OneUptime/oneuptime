import Entities from "../../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Query from "../../../../Types/BaseDatabase/Query";
import Includes from "../../../../Types/BaseDatabase/Includes";
import AndroidAgentPermissions, {
  ANDROID_AGENT_PERMISSIONS_ATTRIBUTE,
  AndroidAgentPermissionsStatus,
} from "../../../../Types/Host/AndroidAgentPermissions";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { DataSource, FindOptionsWhere, QueryRunner } from "typeorm";

/*
 * Inventory's Agent Permissions filter (#9967) against Postgres: the
 * `agentPermissionsStatus` virtual column says missing for a device whose
 * Android agent still lacks a grant, granted for one that lacks none, and
 * nothing for anything else, as the shared rule says
 * (Types/Host/AndroidAgentPermissions).
 *
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env loaded,
 * as InventoryStatusPostgres. Tables live in a unique temporary schema;
 * production rows are never read or changed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("inventory agent permissions facet against Postgres", () => {
  const schema: string = `inventory_grants_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const values: Record<string, unknown> = {};
  let database: DataSource;
  let runner: QueryRunner;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INVENTORY_FACET_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["INVENTORY_FACET_TEST_DATABASE_PORT"] || "5400"),
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
    // The physical columns these queries read; the status never exists on disk.
    await database.query(`CREATE TABLE "${schema}"."InventoryItem" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "displayName" varchar NOT NULL,
      "entityType" varchar NOT NULL,
      "source" varchar,
      "descriptiveAttributes" jsonb,
      "isArchived" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz
    )`);
    runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    for (const [name, value] of [
      ["kiosk-lacking-read-logs", "READ_LOGS"],
      [
        "kiosk-lacking-everything",
        "READ_LOGS READ_DROPBOX_DATA GET_USAGE_STATS",
      ],
      ["kiosk-lacking-usage-access", "GET_USAGE_STATS"],
      ["kiosk-granted", "none"],
      ["kiosk-granted-padded", " none "],
      ["kiosk-saying-nonsense", "READ_CONTACTS"],
      ["kiosk-with-commas", "READ_LOGS,GET_USAGE_STATS"],
    ] as Array<[string, JSONValue]>) {
      await seed(name, EntityType.Host, {
        [ANDROID_AGENT_PERMISSIONS_ATTRIBUTE]: value,
      });
    }

    await seed("server", EntityType.Host, { "os.type": "linux" });
    await seed("service", EntityType.Service, null);
  });

  afterAll(async () => {
    if (runner) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seed(
    name: string,
    entityType: EntityType,
    attributes: JSONObject | null,
  ): Promise<void> {
    values[name] = attributes?.[ANDROID_AGENT_PERMISSIONS_ATTRIBUTE];
    await runner.query(
      `INSERT INTO "${schema}"."InventoryItem" ("_id", "projectId", "displayName", "entityType", "source", "descriptiveAttributes") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ObjectID.generate().toString(),
        projectId.toString(),
        name,
        entityType,
        EntitySource.Discovered,
        attributes === null ? null : JSON.stringify(attributes),
      ],
    );
  }

  async function find(
    query: Query<InventoryItem> = {},
  ): Promise<Array<InventoryItem>> {
    return runner.manager.getRepository(InventoryItem).find({
      select: { _id: true, displayName: true, agentPermissionsStatus: true },
      where: QueryUtil.serializeQuery(InventoryItem, {
        projectId,
        isArchived: false,
        ...query,
      }) as unknown as FindOptionsWhere<InventoryItem>,
      order: { displayName: "ASC" },
    });
  }

  async function names(query: Query<InventoryItem>): Promise<Array<string>> {
    return (await find(query)).map((item: InventoryItem): string => {
      return item.displayName!;
    });
  }

  test("every row's status in SQL is the shared rule's", async () => {
    const rows: Array<InventoryItem> = await find();

    expect(rows).toHaveLength(9);
    for (const item of rows) {
      expect({
        name: item.displayName,
        status: item.agentPermissionsStatus ?? null,
      }).toEqual({
        name: item.displayName,
        status:
          AndroidAgentPermissions.getStatus(values[item.displayName!]) ?? null,
      });
    }
  });

  test("Missing lists the devices whose agent still lacks a grant", async () => {
    expect(
      await names({
        agentPermissionsStatus: new Includes([
          AndroidAgentPermissionsStatus.Missing,
        ]),
      }),
    ).toEqual([
      "kiosk-lacking-everything",
      "kiosk-lacking-read-logs",
      "kiosk-lacking-usage-access",
    ]);
  });

  test("All Granted lists the devices whose agent lacks none", async () => {
    expect(
      await names({
        agentPermissionsStatus: new Includes([
          AndroidAgentPermissionsStatus.Granted,
        ]),
      }),
    ).toEqual(["kiosk-granted", "kiosk-granted-padded"]);
  });

  test("a serialized API query applies the same filter", async () => {
    const serialized: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          agentPermissionsStatus: new Includes([
            AndroidAgentPermissionsStatus.Missing,
          ]),
        }),
      ),
    );

    expect(
      await names(
        JSONFunctions.deserialize(serialized) as Query<InventoryItem>,
      ),
    ).toEqual([
      "kiosk-lacking-everything",
      "kiosk-lacking-read-logs",
      "kiosk-lacking-usage-access",
    ]);
  });
});
