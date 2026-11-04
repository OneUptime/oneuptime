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
  withoutSqlComments,
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
import { fastestRun } from "../../../../Helpers/FastestRun";
import { emptyReport, PROJECT_ID } from "./ProductionReviewFixtures";

/*
 * A migration that drops or renames a column breaks whatever reads it. The
 * review reads what the pull request's migrations and dbt models change -
 * never their down step - and names the services, tables and data products
 * that depend on each watched table it changes. All of it is text the pull
 * request's author wrote, so the last block holds each reader to time in
 * line with it.
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

  test("a dbt model is a .sql file inside a folder named models, with a name before its .sql", () => {
    expect(isDbtModelPath("models/orders.sql")).toBe(true);
    expect(isDbtModelPath("analytics/Models/marts/Orders.SQL")).toBe(true);
    expect(isDbtModelPath("analytics/models/a/.sql")).toBe(true);
    // The first models folder leaves the most after it.
    expect(isDbtModelPath("analytics/models/b/models/.sql")).toBe(true);
    expect(isDbtModelPath("analytics/models/.sql")).toBe(false);
    expect(isDbtModelPath("analytics/notmodels/orders.sql")).toBe(false);
    expect(isDbtModelPath("analytics/models/orders.sql.bak")).toBe(false);
    expect(isDbtModelPath("analytics/models/macros/cents.sql")).toBe(false);
    // A folder starts the path or follows a "/": never a line break.
    expect(isDbtModelPath("x\n/models/orders.sql")).toBe(true);
    expect(isDbtModelPath("x\nmodels/orders.sql")).toBe(false);
    expect(isDbtModelPath("analytics/models/a\nb.sql")).toBe(false);
  });

  test("an undo file is Flyway's U<version>__ file by its own name, or a .down.sql", () => {
    expect(isMigrationPath("flyway/U12__drop_orders.sql")).toBe(false);
    expect(isMigrationPath("flyway/u12__drop_orders.SQL")).toBe(false);
    expect(isMigrationPath("U1__orders.sql")).toBe(false);
    expect(isMigrationPath("migrations/000012_orders.down.sql")).toBe(false);
    expect(isMigrationPath("flyway/V12__orders.sql")).toBe(true);
    expect(isMigrationPath("flyway/U12_drop_orders.sql")).toBe(true);
    expect(isMigrationPath("flyway/U__drop_orders.sql")).toBe(true);
    expect(isMigrationPath("migrations/U12__/drop_orders.sql")).toBe(true);
    expect(isMigrationPath("migrations/000012_orders.up.sql")).toBe(true);
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

  test("a block comment ends at its first close, on its line or a later one", () => {
    expect(
      kinds(
        readSqlChanges(
          [
            "/* ALTER TABLE orders DROP COLUMN amount; */ ALTER TABLE orders DROP COLUMN total; /**/",
            "/* DROP TABLE carts;",
            "   still the comment */ -- DROP TABLE baskets;",
            "DROP TABLE legacy_orders; /*/ DROP TABLE notes; */",
          ].join("\n"),
        ),
      ),
    ).toEqual(["DropColumn orders total", "DropTable legacy_orders"]);

    // Each comment is a space; one left open stays, as it was written.
    expect(withoutSqlComments("a/*b*/c--d\ne/**/f/*/g*/h/*i")).toBe(
      "a c \ne f h/*i",
    );
  });

  test("names as long as databases make them, in each kind of quotes", () => {
    // PostgreSQL's longest name, then SQL Server's, then MySQL's.
    const table: string = "o".repeat(63);
    const column: string = "t".repeat(128);
    const status: string = "s".repeat(128);
    const state: string = "u".repeat(64);

    expect(
      kinds(
        readSqlChanges(
          `ALTER TABLE "${table}" DROP COLUMN "${column}", RENAME COLUMN [${status}] TO \`${state}\`;`,
        ),
      ),
    ).toEqual([
      `DropColumn ${table} ${column}`,
      `RenameColumn ${table} ${status} ${state}`,
    ]);
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

  test("Rails calls with or without parentheses, spaced, or over several lines", () => {
    expect(
      kinds(
        readDataChanges([
          file("db/migrate/20261104120000_calls.rb", [
            "class Calls < ActiveRecord::Migration[7.1]",
            "  def change",
            "    remove_column( :orders , :total )",
            '    remove_column("orders", "coupon", :string)',
            "    remove_columns(:orders, :note, :memo)",
            '    rename_column ("orders", "status", "state")',
            "    rename_column(",
            "      :carts,",
            "      :owner,",
            "      :customer",
            "    )",
            "    change_column(:orders, :amount, :decimal)",
            "    drop_table(:legacy_orders)",
            "    rename_table\t(:carts, :baskets)",
            "  end",
            "end",
          ]),
        ]),
      ),
    ).toEqual([
      "DropColumn orders total",
      "DropColumn orders coupon",
      "DropColumn orders note",
      "DropColumn orders memo",
      "RenameColumn orders status state",
      "RenameColumn carts owner customer",
      "AlterColumn orders amount",
      "DropTable legacy_orders",
      "RenameTable carts baskets",
    ]);
  });

  test("Alembic's alter_column with parentheses among its arguments, or over several lines", () => {
    expect(
      kinds(
        readDataChanges([
          file("alembic/versions/abc124_amounts.py", [
            "def upgrade():",
            "    op.alter_column('orders', 'amount', type_=sa.Numeric(12, 2))",
            "    op.alter_column(",
            '        "orders",',
            '        "status",',
            '        new_column_name="state",',
            "    )",
            "    op.alter_column('orders', 'note', nullable=False)",
          ]),
        ]),
      ),
    ).toEqual([
      "AlterColumn orders amount",
      "RenameColumn orders status state",
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

describe("time in line with what the author wrote", () => {
  /*
   * A pull request's migrations and file names are text its author wrote,
   * so each reader takes time in line with it: 400,000 characters of the
   * shapes that made the first patterns slow (Rails' remove_column took
   * 13.9 s on one 100,000-character line of tabs) within two seconds. The
   * fastest of up to three attempts counts, as it would have run on a usual
   * runner when every attempt overran on a slow one (Tests/Helpers/FastestRun).
   */
  const LENGTH: number = 400000;

  function timeOf(work: () => void): number {
    return fastestRun({ run: work, limitInMs: 2000 }).inMs;
  }

  // LENGTH characters: the start, the unit again and again, the end.
  function longText(start: string, unit: string, end: string = ""): string {
    const count: number = Math.ceil(
      (LENGTH - start.length - end.length) / unit.length,
    );

    return `${start}${unit.repeat(count)}${end}`;
  }

  test.each([
    ["remove_column"],
    ["remove_columns"],
    ["rename_column"],
    ["change_column"],
    ["drop_table"],
    ["rename_table"],
  ])("Rails' %s before 400,000 tabs", (call: string) => {
    const migration: CodeHostChangedFile = file(
      "db/migrate/20261104120000_tabs.rb",
      [longText(call, "\t", "-")],
    );

    expect(
      timeOf(() => {
        readDataChanges([migration]);
      }),
    ).toBeLessThan(2000);
  });

  test("Alembic's alter_column called again and again, never closed", () => {
    const migration: CodeHostChangedFile = file(
      "alembic/versions/abc125_open.py",
      [longText("", "op.alter_column('orders', 'total', ")],
    );

    expect(
      timeOf(() => {
        readDataChanges([migration]);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    ["ALTER TABLE before a bracket never closed", "ALTER TABLE ["],
    ["ALTER TABLE before a schema's bracket never closed", "ALTER TABLE a.["],
    ["DROP TABLE before a bracket never closed", "DROP TABLE ["],
    ["block comments opened and never closed", "/* "],
  ])("SQL: %s, again and again", (_shape: string, unit: string) => {
    const migration: CodeHostChangedFile = file(
      "db/migrations/20261104_open.sql",
      [longText("", unit)],
    );

    expect(
      timeOf(() => {
        readDataChanges([migration]);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    ["models folders, and no .sql at its end", longText("", "/models/", "x")],
    ["underscores in a file's name", longText("U1", "__", "x")],
  ])(
    "a file's path of 400,000 characters: %s",
    (_shape: string, path: string) => {
      const migration: CodeHostChangedFile = file(path, ["DROP TABLE orders;"]);

      expect(
        timeOf(() => {
          readDataChanges([migration]);
        }),
      ).toBeLessThan(2000);
    },
  );
});
