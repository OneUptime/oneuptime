import Entities from "../../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Query from "../../../../Types/BaseDatabase/Query";
import Includes from "../../../../Types/BaseDatabase/Includes";
import AndroidSecurityPatch, {
  ANDROID_SECURITY_PATCH_ATTRIBUTE,
  AndroidSecurityPatchStatus,
} from "../../../../Types/Host/AndroidSecurityPatch";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { DataSource, FindOptionsWhere, QueryRunner } from "typeorm";

/*
 * Inventory's Security Patch Level filter (#9965) against Postgres: the
 * `securityPatchStatus` virtual column says out of date for an Android
 * device whose patch level is more than 90 days old, by the database's UTC
 * day, and agrees with the rule the column and the alert template read
 * (Types/Host/AndroidSecurityPatch) on every row, at the boundary too.
 *
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env loaded,
 * as InventoryStatusPostgres. Tables live in a unique temporary schema;
 * production rows are never read or changed. A transaction freezes
 * CURRENT_TIMESTAMP for exact boundaries.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

const MILLIS_PER_DAY: number = 24 * 60 * 60 * 1000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describePostgres("inventory security patch facet against Postgres", () => {
  const schema: string = `inventory_patch_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const levels: Record<string, unknown> = {};
  let database: DataSource;
  let runner: QueryRunner;
  let now: Date;

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
    now = (await runner.query("SELECT CURRENT_TIMESTAMP AS now"))[0].now;

    const today: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const daysAgo: (days: number) => string = (days: number): string => {
      return utcDay(new Date(today - days * MILLIS_PER_DAY));
    };

    for (const [name, level] of [
      ["patched-today", daysAgo(0)],
      ["patched-89-days-ago", daysAgo(89)],
      ["patched-90-days-ago", daysAgo(90)],
      ["patched-91-days-ago", daysAgo(91)],
      ["patched-two-years-ago", daysAgo(730)],
      ["patched-in-the-future", daysAgo(-30)],
      ["level-not-a-date", "unknown"],
      ["level-without-zeros", "2024-6-5"],
      ["level-a-number", 20240605],
      ["level-empty", ""],
    ] as Array<[string, unknown]>) {
      await seed(name, EntityType.Host, {
        [ANDROID_SECURITY_PATCH_ATTRIBUTE]: level,
      });
    }

    await seed("server-without-level", EntityType.Host, { "os.type": "linux" });
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
    levels[name] = attributes?.[ANDROID_SECURITY_PATCH_ATTRIBUTE];
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
      select: { _id: true, displayName: true, securityPatchStatus: true },
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

  test("every row's status in SQL is the shared rule's, at the 90-day boundary too", async () => {
    const rows: Array<InventoryItem> = await find();

    expect(rows).toHaveLength(12);
    for (const item of rows) {
      expect({
        name: item.displayName,
        status: item.securityPatchStatus ?? null,
      }).toEqual({
        name: item.displayName,
        status:
          AndroidSecurityPatch.getStatus(levels[item.displayName!], now) ??
          null,
      });
    }
  });

  test("Out of Date lists the devices patched more than 90 days ago, and nothing else", async () => {
    expect(
      await names({
        securityPatchStatus: new Includes([
          AndroidSecurityPatchStatus.OutOfDate,
        ]),
      }),
    ).toEqual(["patched-91-days-ago", "patched-two-years-ago"]);
  });

  test("Up to Date lists the devices patched within 90 days, a level dated ahead of the clock among them", async () => {
    expect(
      await names({
        securityPatchStatus: new Includes([
          AndroidSecurityPatchStatus.UpToDate,
        ]),
      }),
    ).toEqual([
      "patched-89-days-ago",
      "patched-90-days-ago",
      "patched-in-the-future",
      "patched-today",
    ]);
  });

  test("an item with no patch level, or one that is no date, is in neither", async () => {
    const statuses: Array<InventoryItem> = await find();
    const withoutStatus: Array<string> = statuses
      .filter((item: InventoryItem): boolean => {
        return !item.securityPatchStatus;
      })
      .map((item: InventoryItem): string => {
        return item.displayName!;
      });

    expect(withoutStatus).toEqual([
      "level-a-number",
      "level-empty",
      "level-not-a-date",
      "level-without-zeros",
      "server-without-level",
      "service",
    ]);
  });

  test("a serialized API query applies the same filter", async () => {
    const serialized: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          securityPatchStatus: new Includes([
            AndroidSecurityPatchStatus.OutOfDate,
          ]),
          entityType: new Includes([EntityType.Host]),
        }),
      ),
    );

    expect(
      await names(
        JSONFunctions.deserialize(serialized) as Query<InventoryItem>,
      ),
    ).toEqual(["patched-91-days-ago", "patched-two-years-ago"]);
  });

  test("the status needs no physical column", async () => {
    const columns: Array<{ column_name: string }> = await runner.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'InventoryItem'",
      [schema],
    );

    expect(
      columns.map((column: { column_name: string }): string => {
        return column.column_name;
      }),
    ).not.toContain("securityPatchStatus");
  });
});
