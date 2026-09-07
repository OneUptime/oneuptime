import Entities from "../../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Query from "../../../../Types/BaseDatabase/Query";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  InventoryLiveness,
  getInventoryLivenessState,
} from "../../../../Types/Telemetry/InventoryLiveness";
import { DataSource, FindOptionsWhere, QueryRunner } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env loaded.
 * Tables live in a unique temporary schema; production rows are never read
 * or changed. A transaction freezes CURRENT_TIMESTAMP for exact boundaries.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("inventory status facets against Postgres", () => {
  const schema: string = `inventory_facets_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const ids: Record<string, string> = {};
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
    /*
     * A standalone temporary table lets this suite run on an empty Postgres
     * instance too. Its columns are the physical inventory columns used by
     * these queries; the status itself must never exist on disk.
     */
    await database.query(`CREATE TABLE "${schema}"."InventoryItem" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "displayName" varchar NOT NULL,
      "entityType" varchar NOT NULL,
      "source" varchar,
      "lastSeenAt" timestamptz,
      "isArchived" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz
    )`);
    runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    now = (await runner.query("SELECT CURRENT_TIMESTAMP AS now"))[0].now;

    for (const [name, age] of [
      ["live-future", -60_000],
      ["live-now", 0],
      ["live-upper-boundary", 31 * 60_000 - 1],
      ["recent-lower-boundary", 31 * 60_000],
      ["recent-upper-boundary", 1441 * 60_000 - 1],
      ["stale-lower-boundary", 1441 * 60_000],
      ["stale-old", 3 * 1440 * 60_000],
    ] as Array<[string, number]>) {
      await seed(name, EntitySource.Discovered, age);
    }
    await seed("never-seen", EntitySource.Discovered, null);
    await seed("manual-old", EntitySource.Manual, 365 * 1440 * 60_000);
    await seed("mirrored-no-heartbeat", EntitySource.Inventory, null);
    await seed("unknown-source", "unknown", 365 * 1440 * 60_000);
    await seed("missing-source", null, null);
    await seed("archived-stale", EntitySource.Discovered, 3000 * 60_000, {
      archived: true,
    });
    await seed("foreign-stale", EntitySource.Discovered, 3000 * 60_000, {
      projectId: otherProjectId,
    });
    await seed("host-stale", EntitySource.Discovered, 3000 * 60_000, {
      entityType: EntityType.Host,
    });
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
    source: string | null,
    age: number | null,
    options: {
      archived?: boolean;
      projectId?: ObjectID;
      entityType?: EntityType;
    } = {},
  ): Promise<void> {
    const id: string = ObjectID.generate().toString();
    ids[name] = id;
    await runner.query(
      `INSERT INTO "InventoryItem" ("_id", "projectId", "displayName", "entityType", "source", "lastSeenAt", "isArchived") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        (options.projectId || projectId).toString(),
        name,
        options.entityType || EntityType.Service,
        source,
        age === null ? null : new Date(now.getTime() - age),
        Boolean(options.archived),
      ],
    );
  }

  function where(
    query: Query<InventoryItem> = {},
  ): FindOptionsWhere<InventoryItem> {
    return QueryUtil.serializeQuery(InventoryItem, {
      projectId,
      isArchived: false,
      ...query,
    }) as unknown as FindOptionsWhere<InventoryItem>;
  }

  async function find(
    query: Query<InventoryItem> = {},
  ): Promise<Array<InventoryItem>> {
    return runner.manager.getRepository(InventoryItem).find({
      select: {
        _id: true,
        displayName: true,
        source: true,
        lastSeenAt: true,
        inventoryStatus: true,
      },
      where: where(query),
      order: { displayName: "ASC" },
    });
  }

  async function names(query: Query<InventoryItem>): Promise<Array<string>> {
    return (await find(query)).map((item: InventoryItem): string => {
      return item.displayName!;
    });
  }

  test("every SQL classification matches the shared badge rule at exact boundaries", async () => {
    const rows: Array<InventoryItem> = await find();
    expect(rows).toHaveLength(13);
    for (const item of rows) {
      expect({ name: item.displayName, status: item.inventoryStatus }).toEqual({
        name: item.displayName,
        status: getInventoryLivenessState({
          source: item.source,
          lastSeenAt: item.lastSeenAt,
          now,
        }),
      });
    }
  });

  test.each([
    [
      InventoryLiveness.Live,
      ["live-future", "live-now", "live-upper-boundary"],
    ],
    [
      InventoryLiveness.Recent,
      ["recent-lower-boundary", "recent-upper-boundary"],
    ],
    [
      InventoryLiveness.Stale,
      ["host-stale", "stale-lower-boundary", "stale-old"],
    ],
    [InventoryLiveness.Never, ["never-seen"]],
    [
      InventoryLiveness.NotTracked,
      [
        "manual-old",
        "mirrored-no-heartbeat",
        "missing-source",
        "unknown-source",
      ],
    ],
  ] as Array<[InventoryLiveness, Array<string>]>)(
    "%s selects precisely the matching rows",
    async (status: InventoryLiveness, expected: Array<string>) => {
      expect(await names({ inventoryStatus: new Includes([status]) })).toEqual(
        expected,
      );
    },
  );

  test("multiple statuses are a union and negation is its complement including untracked rows", async () => {
    const selected: Array<string> = await names({
      inventoryStatus: new Includes([
        InventoryLiveness.Stale,
        InventoryLiveness.Never,
      ]),
    });
    expect(selected).toEqual([
      "host-stale",
      "never-seen",
      "stale-lower-boundary",
      "stale-old",
    ]);
    const excluded: Array<string> = await names({
      inventoryStatus: new IncludesNone([
        InventoryLiveness.Stale,
        InventoryLiveness.Never,
      ]),
    });
    expect(excluded).toHaveLength(9);
    expect(excluded).toEqual(
      expect.arrayContaining(["manual-old", "missing-source"]),
    );
    expect(new Set([...selected, ...excluded])).toEqual(
      new Set(await names({})),
    );
    expect(
      selected.filter((name: string): boolean => {
        return excluded.includes(name);
      }),
    ).toEqual([]);
  });

  test("status preserves type and source filters", async () => {
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        entityType: new Includes([EntityType.Host]),
      }),
    ).toEqual(["host-stale"]);
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        source: EntitySource.Manual,
      }),
    ).toEqual([]);
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.NotTracked]),
        source: EntitySource.Manual,
      }),
    ).toEqual(["manual-old"]);
  });

  test("last seen dates intersect status without overwriting it", async () => {
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        lastSeenAt: new LessThan(
          new Date(now.getTime() - 3500 * 60_000).toISOString(),
        ),
      }),
    ).toEqual(["stale-old"]);
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Live]),
        lastSeenAt: new LessThan(
          new Date(now.getTime() - 60 * 60_000).toISOString(),
        ),
      }),
    ).toEqual([]);
  });

  test("status preserves explicit ids, project isolation and archived views", async () => {
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        _id: ids["stale-old"]!,
      }),
    ).toEqual(["stale-old"]);
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        _id: ids["foreign-stale"]!,
      }),
    ).toEqual([]);
    expect(
      await names({
        inventoryStatus: new Includes([InventoryLiveness.Stale]),
        isArchived: true,
      }),
    ).toEqual(["archived-stale"]);
  });

  test("count and pagination use the same status predicate", async () => {
    const [rows, count]: [Array<InventoryItem>, number] = await runner.manager
      .getRepository(InventoryItem)
      .findAndCount({
        select: { _id: true, displayName: true },
        where: where({
          inventoryStatus: new Includes([
            InventoryLiveness.Live,
            InventoryLiveness.Recent,
          ]),
        }),
        order: { displayName: "ASC" },
        skip: 2,
        take: 2,
      });
    expect(count).toBe(5);
    expect(
      rows.map((item: InventoryItem): string => {
        return item.displayName!;
      }),
    ).toEqual(["live-upper-boundary", "recent-lower-boundary"]);
  });

  test("a serialized API query applies the same status filter", async () => {
    const serialized: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          inventoryStatus: new Includes([
            InventoryLiveness.Never,
            InventoryLiveness.Recent,
          ]),
          entityType: new Includes([EntityType.Service]),
        }),
      ),
    );
    expect(
      await names(
        JSONFunctions.deserialize(serialized) as Query<InventoryItem>,
      ),
    ).toEqual(["never-seen", "recent-lower-boundary", "recent-upper-boundary"]);
  });

  test("the empty schema needs no physical status column", async () => {
    const columns: Array<{ column_name: string }> = await runner.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'InventoryItem'",
      [schema],
    );
    expect(
      columns.map((column: { column_name: string }): string => {
        return column.column_name;
      }),
    ).not.toContain("inventoryStatus");
    expect(
      await names({ inventoryStatus: new Includes([InventoryLiveness.Never]) }),
    ).toEqual(["never-seen"]);
  });
});
