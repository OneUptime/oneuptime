import Entities from "../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import {
  INVENTORY_OVERVIEW_GROUP_BY,
  INVENTORY_OVERVIEW_SELECT,
  InventoryOverviewCounts,
  readInventoryOverviewGroups,
} from "../../../Server/Services/InventoryItemService";
import {
  AggregateColumn,
  AggregateRow,
} from "../../../Server/Types/Database/AggregateBy";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import { InventoryLiveness } from "../../../Types/Telemetry/InventoryLiveness";
import {
  INVENTORY_SUMMARY_TILES,
  InventorySummaryTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";
import {
  DataSource,
  FindOptionsWhere,
  QueryRunner,
  SelectQueryBuilder,
} from "typeorm";

/*
 * The Inventory Overview's counts, run against Postgres and checked against
 * the lists they drill into.
 *
 * Every tile opens the Items list narrowed by its scope — a source facet, or
 * the source facet plus the Stale status facet — and the number on the tile
 * has to be the number of rows that list shows. The unit tests pin the SQL
 * text; only a real database can say the two queries select the same rows,
 * so each tile's count is compared here with the list query its scope
 * produces, over an estate built to sit on every boundary.
 *
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env loaded,
 * like InventoryStatusPostgres.test.ts. Tables live in a unique temporary
 * schema; production rows are never read or changed. A transaction freezes
 * CURRENT_TIMESTAMP so the boundary rows stay on their boundary.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("inventory overview counts against Postgres", () => {
  const schema: string = `inventory_overview_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let runner: QueryRunner;
  let now: Date;
  let counts: InventoryOverviewCounts;

  const MINUTE: number = 60_000;

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
    await database.query(`CREATE TABLE "${schema}"."InventoryItem" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "displayName" varchar NOT NULL,
      "entityType" varchar NOT NULL,
      "source" varchar,
      "firstSeenAt" timestamptz,
      "lastSeenAt" timestamptz,
      "isArchived" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz
    )`);
    runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    now = (await runner.query("SELECT CURRENT_TIMESTAMP AS now"))[0].now;

    // Discovered, on each side of both liveness boundaries.
    await seed(EntityType.Service, EntitySource.Discovered, 0);
    await seed(EntityType.Service, EntitySource.Discovered, 31 * MINUTE - 1);
    await seed(EntityType.Service, EntitySource.Discovered, 1441 * MINUTE - 1);
    await seed(EntityType.Service, EntitySource.Discovered, 1441 * MINUTE);
    await seed(EntityType.Host, EntitySource.Discovered, 3 * 1440 * MINUTE);
    await seed(EntityType.Host, EntitySource.Discovered, null);
    // Ancient timestamps that must never read as stale.
    await seed(EntityType.Host, EntitySource.Inventory, 365 * 1440 * MINUTE);
    await seed(EntityType.Host, EntitySource.Inventory, null);
    await seed(EntityType.ExternalService, EntitySource.Manual, 90 * 1440 * MINUTE);
    await seed(EntityType.Service, "some-future-source", 3 * 1440 * MINUTE);
    await seed("some.future.type", EntitySource.Discovered, 3 * 1440 * MINUTE);
    // Outside the Overview: archived, and another project's.
    await seed(EntityType.Service, EntitySource.Discovered, 3 * 1440 * MINUTE, {
      archived: true,
    });
    await seed(EntityType.Service, EntitySource.Manual, 0, {
      projectId: otherProjectId,
    });

    const scope: SelectQueryBuilder<InventoryItem> = runner.manager
      .createQueryBuilder(InventoryItem, "InventoryItem")
      .setFindOptions({ where: where() });

    // The same select/group shape DatabaseService.aggregateBy builds.
    const columns: Array<AggregateColumn> = [
      ...INVENTORY_OVERVIEW_GROUP_BY,
      ...INVENTORY_OVERVIEW_SELECT,
    ];
    scope.select(columns[0]!.expression, columns[0]!.alias);
    for (const column of columns.slice(1)) {
      scope.addSelect(column.expression, column.alias);
    }
    for (const column of INVENTORY_OVERVIEW_GROUP_BY) {
      scope.addGroupBy(column.expression);
    }

    counts = readInventoryOverviewGroups(
      (await scope.getRawMany()) as Array<AggregateRow>,
    );
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
    entityType: string,
    source: string | null,
    age: number | null,
    options: { archived?: boolean; projectId?: ObjectID } = {},
  ): Promise<void> {
    await runner.query(
      `INSERT INTO "${schema}"."InventoryItem" ("_id", "projectId", "displayName", "entityType", "source", "firstSeenAt", "lastSeenAt", "isArchived") VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
      [
        ObjectID.generate().toString(),
        (options.projectId || projectId).toString(),
        `${entityType} ${source}`,
        entityType,
        source,
        age === null ? null : new Date(now.getTime() - age),
        Boolean(options.archived),
      ],
    );
  }

  // The live Items list's base query, which the Overview's count shares.
  function where(
    query: Query<InventoryItem> = {},
  ): FindOptionsWhere<InventoryItem> {
    return QueryUtil.serializeQuery(InventoryItem, {
      projectId,
      isArchived: false,
      ...query,
    }) as unknown as FindOptionsWhere<InventoryItem>;
  }

  async function listCount(query: Query<InventoryItem>): Promise<number> {
    return runner.manager
      .getRepository(InventoryItem)
      .count({ where: where(query) });
  }

  // The query a tile's drill-down lands on: its scope, as the Items page's facets.
  function drillDownQuery(tile: InventorySummaryTile): Query<InventoryItem> {
    const query: Query<InventoryItem> = {};

    if (tile.scope.entityType) {
      query.entityType = new Includes([tile.scope.entityType]);
    }

    if (tile.scope.source) {
      query.source = new Includes([tile.scope.source]);
    }

    if (tile.scope.staleOnly) {
      query.inventoryStatus = new Includes([InventoryLiveness.Stale]);
    }

    return query;
  }

  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile counts exactly the rows its drill-down lists",
    async (tile: InventorySummaryTile) => {
      expect(counts[tile.countField]).toBe(
        await listCount(drillDownQuery(tile)),
      );
    },
  );

  test("the counts are the estate's, with archived and foreign rows left out", () => {
    // Pinned as numbers too, so a degenerate estate cannot pass the tiles above vacuously.
    expect(counts).toEqual({
      total: 11,
      discovered: 7,
      mirrored: 2,
      manual: 1,
      stale: 3,
      countsByType: {
        [EntityType.Service]: 5,
        [EntityType.Host]: 4,
        [EntityType.ExternalService]: 1,
        "some.future.type": 1,
      },
    });
  });

  test("each type's count is the rows the type facet lists", async () => {
    for (const [entityType, count] of Object.entries(counts.countsByType)) {
      expect(count).toBe(
        await listCount({ entityType: new Includes([entityType]) }),
      );
    }
  });

  test("the breakdown sums to the total", () => {
    expect(
      Object.values(counts.countsByType).reduce(
        (sum: number, count: number): number => {
          return sum + count;
        },
        0,
      ),
    ).toBe(counts.total);
  });
});
