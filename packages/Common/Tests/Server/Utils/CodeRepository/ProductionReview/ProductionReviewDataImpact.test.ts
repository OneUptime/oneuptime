import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProductionReviewDataImpact, {
  buildColumnQueryStatement,
  columnPattern,
  isDbtModelPath,
  isMigrationPath,
  PullRequestDataChange,
  readAddedText,
  readDataChanges,
  readSqlChanges,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewDataImpact";
import ProductionReviewComposer, {
  describeDataUse,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer";
import { CodeHostChangedFile } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import DataAssetService from "../../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../../Server/Services/DataAssetUsageService";
import DataAssetLineageService from "../../../../../Server/Services/DataAssetLineageService";
import DataProductService from "../../../../../Server/Services/DataProductService";
import SpanService from "../../../../../Server/Services/SpanService";
import DataTableDashboards from "../../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAsset from "../../../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../../../Models/DatabaseModels/DataAssetUsage";
import DataAssetLineage from "../../../../../Models/DatabaseModels/DataAssetLineage";
import DataProduct from "../../../../../Models/DatabaseModels/DataProduct";
import Team from "../../../../../Models/DatabaseModels/Team";
import {
  ProductionReviewDataChange,
  ProductionReviewDataImpactJSON,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewUtil,
} from "../../../../../Types/CodeRepository/ProductionReview";
import { DataAssetAccessKind } from "../../../../../Types/DataObservability/DataAssetUsage";
import ObjectID from "../../../../../Types/ObjectID";
import { emptyReport, PROJECT_ID } from "./ProductionReviewFixtures";

/*
 * A migration that drops or renames a column breaks whatever reads it. The
 * review reads what the pull request's migrations and dbt models change -
 * never their down step - and names the services, tables and data products
 * that depend on each watched table it changes.
 */

function file(
  filename: string,
  added: Array<string>,
  status: string = "added",
): CodeHostChangedFile {
  return {
    filename,
    status,
    additions: added.length,
    deletions: 0,
    patch: `@@ -0,0 +1,${added.length} @@\n${added
      .map((line: string): string => {
        return `+${line}`;
      })
      .join("\n")}`,
  };
}

function kinds(
  changes: Array<Omit<PullRequestDataChange, "path">>,
): Array<string> {
  return changes.map((found: Omit<PullRequestDataChange, "path">): string => {
    return [
      found.change,
      found.schema ? `${found.schema}.${found.table}` : found.table,
      found.column || "",
      found.newName || "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

describe("which files are read", () => {
  test("SQL files and migrations; dbt models apart; never an undo or down file", () => {
    expect(isMigrationPath("db/migrations/20261104_drop_total.sql")).toBe(true);
    expect(isMigrationPath("schema/V12__orders.sql")).toBe(true);
    expect(isMigrationPath("db/migrate/20261104120000_remove_total.rb")).toBe(
      true,
    );
    expect(isMigrationPath("app/migrations/0042_remove_total.py")).toBe(true);
    expect(isMigrationPath("alembic/versions/abc123_drop.py")).toBe(true);
    expect(
      isMigrationPath(
        "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1808992200000-AddDataReconciliations.ts",
      ),
    ).toBe(true);
    expect(isMigrationPath("src/services/orders.ts")).toBe(false);
    expect(isMigrationPath("schema/U12__orders.sql")).toBe(false);
    expect(isMigrationPath("migrations/000012_orders.down.sql")).toBe(false);
    expect(isMigrationPath("analytics/models/marts/orders.sql")).toBe(false);
    expect(isDbtModelPath("analytics/models/marts/orders.sql")).toBe(true);
    expect(isDbtModelPath("analytics/macros/cents.sql")).toBe(false);
  });

  test("only the lines a patch adds", () => {
    expect(
      readAddedText(
        "@@ -1,3 +1,3 @@\n ALTER TABLE a ADD b int;\n-ALTER TABLE a DROP c;\n+ALTER TABLE a DROP d;\n+++ not a line",
      ),
    ).toBe("ALTER TABLE a DROP d;");
  });
});

describe("SQL", () => {
  test("PostgreSQL's columns dropped, renamed and retyped, quoted or not", () => {
    expect(
      kinds(
        readSqlChanges(`
          ALTER TABLE "public"."orders" DROP COLUMN "total", RENAME COLUMN status TO state;
          ALTER TABLE ONLY public.orders ALTER COLUMN amount TYPE numeric(12, 2);
          ALTER TABLE IF EXISTS customers RENAME TO clients;
        `),
      ),
    ).toEqual([
      "DropColumn public.orders total",
      "RenameColumn public.orders status state",
      "AlterColumn public.orders amount",
      "RenameTable customers clients",
    ]);
  });

  test("MySQL's MODIFY and CHANGE, SQL Server's ALTER COLUMN, and DROP TABLE", () => {
    expect(
      kinds(
        readSqlChanges(`
          ALTER TABLE \`shop\`.\`orders\` MODIFY COLUMN note VARCHAR(500), CHANGE total amount DECIMAL(10,2);
          ALTER TABLE [dbo].[orders] ALTER COLUMN [status] NVARCHAR(20);
          DROP TABLE IF EXISTS legacy_orders, old_carts;
        `),
      ),
    ).toEqual([
      "AlterColumn shop.orders note",
      "RenameColumn shop.orders total amount",
      "AlterColumn dbo.orders status",
      "DropTable legacy_orders",
      "DropTable old_carts",
    ]);
  });

  test("a constraint, an index or a default is no column, and comments say nothing", () => {
    expect(
      readSqlChanges(`
        -- ALTER TABLE orders DROP COLUMN total;
        /* DROP TABLE orders; */
        ALTER TABLE orders DROP CONSTRAINT orders_pkey, ALTER COLUMN total SET NOT NULL, ALTER COLUMN total DROP DEFAULT;
      `),
    ).toEqual([]);
  });
});

describe("migrations of each framework", () => {
  test("a TypeORM migration's up step, never its down step", () => {
    expect(
      kinds(
        readDataChanges([
          file("Postgres/SchemaMigrations/1808992200000-DropTotal.ts", [
            "export class DropTotal implements MigrationInterface {",
            "  public async up(queryRunner: QueryRunner): Promise<void> {",
            '    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "total"`);',
            "  }",
            "  public async down(queryRunner: QueryRunner): Promise<void> {",
            '    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "amount"`);',
            "  }",
            "}",
          ]),
        ]),
      ),
    ).toEqual(["DropColumn orders total"]);
  });

  test("Rails, before def down", () => {
    expect(
      kinds(
        readDataChanges([
          file("db/migrate/20261104120000_cleanup.rb", [
            "class Cleanup < ActiveRecord::Migration[7.1]",
            "  def up",
            "    remove_column :orders, :total, :integer",
            "    remove_columns :orders, :coupon, :note, type: :string",
            "    rename_column :orders, :status, :state",
            "    drop_table :legacy_orders",
            "  end",
            "  def down",
            "    remove_column :orders, :state",
            "  end",
            "end",
          ]),
        ]),
      ),
    ).toEqual([
      "DropColumn orders total",
      "DropColumn orders coupon",
      "DropColumn orders note",
      "RenameColumn orders status state",
      "DropTable legacy_orders",
    ]);
  });

  test("Alembic's upgrade and Django's operations", () => {
    expect(
      kinds(
        readDataChanges([
          file("alembic/versions/abc123_cleanup.py", [
            "def upgrade():",
            "    op.drop_column('orders', 'total')",
            "    op.alter_column('orders', 'status', new_column_name='state')",
            "def downgrade():",
            "    op.drop_column('orders', 'state')",
          ]),
          file("shop/migrations/0042_cleanup.py", [
            "operations = [",
            "    migrations.RemoveField(model_name='order', name='coupon'),",
            "]",
          ]),
        ]),
      ),
    ).toEqual([
      "DropColumn orders total",
      "RenameColumn orders status state",
      "DropColumn order coupon",
    ]);
  });

  test("Sequelize and Knex", () => {
    expect(
      kinds(
        readDataChanges([
          file("migrations/20261104-cleanup.js", [
            "module.exports = {",
            "  up: async (queryInterface) => {",
            "    await queryInterface.removeColumn('orders', 'total');",
            "    await queryInterface.renameTable('carts', 'baskets');",
            "  },",
            "  down: async (queryInterface) => {",
            "    await queryInterface.removeColumn('orders', 'amount');",
            "  },",
            "};",
          ]),
        ]),
      ),
    ).toEqual(["DropColumn orders total", "RenameTable carts baskets"]);
  });

  test("a dbt model changed; a removed migration, or a file of code, changes nothing", () => {
    expect(
      kinds(
        readDataChanges([
          file(
            "analytics/models/marts/orders_daily.sql",
            ["select 1"],
            "modified",
          ),
          file("db/migrations/001.sql", ["DROP TABLE orders;"], "removed"),
          file("src/orders.ts", ["// ALTER TABLE orders DROP COLUMN total"]),
        ]),
      ),
    ).toEqual(["ChangeModel orders_daily"]);
  });
});

describe("what depends on a watched table", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ORDERS: DataAsset = (() => {
    const asset: DataAsset = new DataAsset();

    asset._id = ObjectID.generate().toString();
    asset.name = "orders";
    asset.schemaName = "public";
    asset.assetKey = "public.orders";
    asset.dataStoreName = "Orders DB";

    return asset;
  })();

  function usage(
    serviceName: string,
    accessKind: DataAssetAccessKind,
    serviceId: ObjectID = ObjectID.generate(),
  ): DataAssetUsage {
    const row: DataAssetUsage = new DataAssetUsage();

    row.serviceId = serviceId;
    row.serviceName = serviceName;
    row.accessKind = accessKind;
    row.callCount = 10;
    row.lastSeenAt = new Date("2026-11-04T09:00:00.000Z");

    return row;
  }

  test("a dropped column names the services whose queries read it, the tables built from it and its data products", async () => {
    const checkoutId: ObjectID = ObjectID.generate();
    const downstream: DataAssetLineage = new DataAssetLineage();
    const daily: DataAsset = new DataAsset();
    const product: DataProduct = new DataProduct();
    const team: Team = new Team();

    downstream.downstreamDataAssetId = ObjectID.generate();
    daily.assetKey = "analytics.orders_daily";
    downstream.downstreamDataAsset = daily;
    team.name = "Data Team";
    product._id = ObjectID.generate().toString();
    product.name = "Revenue";
    product.ownerTeam = team;

    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([ORDERS]);
    jest
      .spyOn(DataAssetUsageService, "findBy")
      .mockResolvedValue([
        usage("billing-worker", DataAssetAccessKind.Write),
        usage("checkout-api", DataAssetAccessKind.Read, checkoutId),
        usage("checkout-api", DataAssetAccessKind.Write, checkoutId),
      ]);
    jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([downstream]);
    jest.spyOn(DataProductService, "findBy").mockResolvedValue([product]);
    jest.spyOn(DataTableDashboards, "find").mockResolvedValue([]);
    jest.spyOn(SpanService, "executeQuery").mockResolvedValue({
      json: async () => {
        return {
          data: [{ serviceId: checkoutId.toString(), queryCount: "1240" }],
        };
      },
    } as never);

    const impacts: Array<ProductionReviewDataImpactJSON> =
      await ProductionReviewDataImpact.find({
        projectId: new ObjectID(PROJECT_ID),
        files: [
          file("db/migrations/20261104_drop_total.sql", [
            "ALTER TABLE public.orders DROP COLUMN total;",
          ]),
        ],
        serviceIds: [],
        now: new Date("2026-11-04T10:00:00.000Z"),
      });

    expect(impacts).toEqual([
      {
        dataAssetId: ORDERS.id!.toString(),
        table: "public.orders",
        storeName: "Orders DB",
        change: ProductionReviewDataChange.DropColumn,
        column: "total",
        path: "db/migrations/20261104_drop_total.sql",
        services: [
          {
            serviceId: checkoutId.toString(),
            name: "checkout-api",
            reads: true,
            writes: true,
            columnQueryCount: 1240,
            lastSeenAt: "2026-11-04T09:00:00.000Z",
          },
          expect.objectContaining({
            name: "billing-worker",
            reads: false,
            writes: true,
          }),
        ],
        downstreamTables: [
          {
            dataAssetId: downstream.downstreamDataAssetId!.toString(),
            table: "analytics.orders_daily",
          },
        ],
        downstreamCount: 1,
        dashboards: [],
        dataProducts: [
          {
            dataProductId: product.id!.toString(),
            name: "Revenue",
            owner: "Data Team",
          },
        ],
      },
    ]);

    // The pull request's comment names the service that reads the column.
    const report: ProductionReviewReport = {
      ...emptyReport(),
      dataImpact: impacts,
    };
    const comment: string = ProductionReviewComposer.compose({
      report,
      posting: ProductionReviewPosting.Review,
      reviewUrl: "https://oneuptime.com/dashboard/x/code/tasks/y",
      dashboardUrl: "https://oneuptime.com/dashboard",
      projectId: PROJECT_ID,
      productName: "OneUptime",
      reviewCommand: "@oneuptime production review",
      updatesOnPush: true,
      isPublicRepository: false,
    });

    expect(ProductionReviewUtil.hasSignal(report)).toBe(true);
    expect(comment).toContain("**Data this change touches**");
    expect(comment).toContain(
      "Drops column `total` of `public.orders` in `db/migrations/20261104_drop_total.sql`",
    );
    expect(comment).toContain(
      "**checkout-api** (names the column in 1,240 queries of the last day)",
    );
    expect(comment).toContain(
      "1 table is built from it (`analytics.orders_daily`)",
    );
    expect(comment).toContain(
      "part of data product **Revenue** (owned by Data Team)",
    );
    expect(ProductionReviewComposer.summarize(report)).toBe(
      "Production review: 1 watched table changed in or around the changed code.",
    );
  });

  test("a name several databases hold is narrowed to the ones the repository's services use", async () => {
    const other: DataAsset = new DataAsset();
    const serviceId: ObjectID = ObjectID.generate();
    const used: DataAssetUsage = new DataAssetUsage();

    other._id = ObjectID.generate().toString();
    other.name = "orders";
    other.schemaName = "public";
    used.dataAssetId = ORDERS.id!;

    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([other, ORDERS]);
    jest.spyOn(DataAssetUsageService, "findBy").mockResolvedValue([used]);

    const tables: Array<DataAsset> =
      await ProductionReviewDataImpact.findTables({
        projectId: new ObjectID(PROJECT_ID),
        change: {
          change: ProductionReviewDataChange.DropTable,
          schema: null,
          table: "orders",
          column: null,
          newName: null,
          path: "x.sql",
        },
        serviceIds: [serviceId.toString()],
      });

    expect(tables).toEqual([ORDERS]);
  });

  test("a Django model's table is named only when one table fits", async () => {
    const shopOrder: DataAsset = new DataAsset();
    const billingOrder: DataAsset = new DataAsset();

    shopOrder._id = ObjectID.generate().toString();
    shopOrder.name = "shop_order";
    billingOrder._id = ObjectID.generate().toString();
    billingOrder.name = "billing_order";

    jest
      .spyOn(DataAssetService, "findBy")
      .mockResolvedValueOnce([shopOrder])
      .mockResolvedValueOnce([shopOrder, billingOrder]);

    const change: PullRequestDataChange = {
      change: ProductionReviewDataChange.DropColumn,
      schema: null,
      table: "order",
      column: "coupon",
      newName: null,
      path: "shop/migrations/0042.py",
      isModelName: true,
    };

    expect(
      await ProductionReviewDataImpact.findTables({
        projectId: new ObjectID(PROJECT_ID),
        change,
        serviceIds: [],
      }),
    ).toEqual([shopOrder]);
    expect(
      await ProductionReviewDataImpact.findTables({
        projectId: new ObjectID(PROJECT_ID),
        change,
        serviceIds: [],
      }),
    ).toEqual([]);
  });

  test("a service's use in words, and the column found as a whole word", () => {
    expect(describeDataUse({ name: "a", reads: true, writes: false })).toBe(
      "reads it",
    );
    expect(describeDataUse({ name: "a", reads: true, writes: true })).toBe(
      "reads and writes it",
    );
    expect(columnPattern("total$")).toBe("(?i)\\btotal\\$\\b");

    const sql: string = buildColumnQueryStatement({
      projectId: new ObjectID(PROJECT_ID),
      serviceIds: ["s1"],
      table: "orders",
      column: "total",
      since: new Date("2026-11-03T10:00:00.000Z"),
    }).query;

    expect(sql).toContain("attributes['db.query.text']");
    expect(sql).toContain("positionCaseInsensitive(statementText,");
    expect(sql).toContain("match(statementText,");
  });
});
