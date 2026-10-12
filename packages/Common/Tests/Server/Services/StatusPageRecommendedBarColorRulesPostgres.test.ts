import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageLabelRuleEngineService from "../../../Server/Services/StatusPageLabelRuleEngineService";
import StatusPageOwnerRuleEngineService from "../../../Server/Services/StatusPageOwnerRuleEngineService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY,
  getBarColorForUptimePercent,
  getRuleUptimePercent,
  isRecommendedHistoryChartBarColorRuleSet,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import { DataSource } from "typeorm";

/*
 * The recommended bar color rules a new status page starts with (issue
 * #486), made and read back through the real services and a migrated
 * Postgres.
 *
 * Opt in with RUN_POSTGRES_STATUS_PAGE_BAR_COLOR_RULES_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_STATUS_PAGE_BAR_COLOR_RULES_TESTS=true \
 *   STATUS_PAGE_BAR_COLOR_RULES_TEST_DATABASE_HOST=127.0.0.1 \
 *   STATUS_PAGE_BAR_COLOR_RULES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StatusPageRecommendedBarColorRulesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database.
 *
 * It runs in a uniquely named schema holding structure-only clones of the
 * tables involved (LIKE ... INCLUDING ALL), the rules table's foreign keys
 * copied from the migrated table's own definitions. No row is ever written
 * outside that schema, and the schema is dropped afterwards.
 *
 * What it pins down that the unit suite cannot: the rules come back from the
 * decimal and colour columns, in the order the status page reads them
 * (StatusPageAPI's overview query), as a set the dashboard still recognises
 * as the recommended one - and when one cannot be made, the ones made before
 * it are really gone.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_BAR_COLOR_RULES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "StatusPage",
  "StatusPageHistoryChartBarColorRule",
];

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

describePostgres(
  "the recommended bar color rules against a migrated Postgres",
  () => {
    const schema: string = `bar_color_rules_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["STATUS_PAGE_BAR_COLOR_RULES_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["STATUS_PAGE_BAR_COLOR_RULES_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["STATUS_PAGE_BAR_COLOR_RULES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      // Read before the clones exist, so they name tables without a schema.
      const foreignKeys: Array<ForeignKeyRow> = await database.query(
        `SELECT t.relname AS "table",
                c.conname AS "name",
                pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
          WHERE n.nspname = 'public'
            AND t.relname = 'StatusPageHistoryChartBarColorRule'
            AND r.relname = ANY($1)
            AND c.contype = 'f'
          ORDER BY c.conname`,
        [TABLES],
      );

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const foreignKey of foreignKeys) {
        await database.query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            /REFERENCES public\./g,
            "REFERENCES ",
          )}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      jest
        .spyOn(StatusPageHistoryChartBarColorRuleService, "onTriggerWorkflow")
        .mockResolvedValue();
      jest
        .spyOn(StatusPageHistoryChartBarColorRuleService, "onTriggerRealtime")
        .mockResolvedValue();
      jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);
      jest
        .spyOn(StatusPageLabelRuleEngineService, "applyRulesToStatusPage")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(StatusPageOwnerRuleEngineService, "applyRulesToStatusPage")
        .mockResolvedValue(undefined as never);
    });

    beforeEach(async () => {
      await database.query(
        [...TABLES]
          .reverse()
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
         VALUES ($1, 'Bar color rules test', $2, 1)`,
        [projectId.toString(), `bar-colors-${projectId.toString()}`],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedStatusPage(name: string): Promise<StatusPage> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "version")
         VALUES ($1, $2, $3, $4, 1)`,
        [id.toString(), projectId.toString(), name, `page-${id.toString()}`],
      );

      const page: StatusPage = new StatusPage();
      page.id = id;
      page.projectId = projectId;
      page.name = name;
      return page;
    }

    // As the public status page reads them for its overview (StatusPageAPI).
    async function rulesOf(
      statusPageId: ObjectID,
    ): Promise<Array<StatusPageHistoryChartBarColorRule>> {
      return await StatusPageHistoryChartBarColorRuleService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          _id: true,
          barColor: true,
          order: true,
          statusPageId: true,
          uptimePercentGreaterThanOrEqualTo: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: 100,
        props: {
          isRoot: true,
        },
      });
    }

    async function runSuccessHook(
      page: StatusPage,
      miscDataProps: JSONObject | undefined,
    ): Promise<void> {
      const onCreate: OnCreate<StatusPage> = {
        createBy: {
          data: page,
          props: { tenantId: projectId, userId: ObjectID.generate() },
          miscDataProps: miscDataProps,
        } as CreateBy<StatusPage>,
        carryForward: null,
      };

      await (
        StatusPageService as unknown as {
          onCreateSuccess: (
            onCreate: OnCreate<StatusPage>,
            createdItem: StatusPage,
          ) => Promise<StatusPage>;
        }
      ).onCreateSuccess(onCreate, page);
    }

    test("a page created with the flag reads back the recommended rules, in order", async () => {
      const page: StatusPage = await seedStatusPage("Public status");

      await runSuccessHook(page, {
        [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
      });

      const rules: Array<StatusPageHistoryChartBarColorRule> = await rulesOf(
        page.id!,
      );

      expect(
        rules.map((rule: StatusPageHistoryChartBarColorRule) => {
          return [
            getRuleUptimePercent(rule),
            rule.barColor?.toString(),
            Number(rule.order),
          ];
        }),
      ).toEqual([
        [100, "#22c55e", 1],
        [99, "#fde047", 2],
        [95, "#c2410c", 3],
        [0, "#7f1d1d", 4],
      ]);

      // As the dashboard reads them: still the recommended set.
      expect(isRecommendedHistoryChartBarColorRuleSet(rules)).toBe(true);

      // As the status page draws them: two minutes down is pale yellow.
      expect(
        getBarColorForUptimePercent(
          rules,
          ((86400 - 120) / 86400) * 100,
        )?.toString(),
      ).toBe("#fde047");
    });

    test("a page created without it has none, and the other page keeps its own", async () => {
      const withRules: StatusPage = await seedStatusPage("With rules");
      const withoutRules: StatusPage = await seedStatusPage("Without rules");

      await runSuccessHook(withRules, {
        [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
      });
      await runSuccessHook(withoutRules, undefined);

      expect(await rulesOf(withoutRules.id!)).toHaveLength(0);
      expect(await rulesOf(withRules.id!)).toHaveLength(4);
    });

    test("deleting the page takes its rules with it", async () => {
      const page: StatusPage = await seedStatusPage("Short lived");

      await runSuccessHook(page, {
        [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
      });

      expect(await rulesOf(page.id!)).toHaveLength(4);

      await database.query(
        `DELETE FROM "${schema}"."StatusPage" WHERE "_id" = $1`,
        [page.id!.toString()],
      );

      const left: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."StatusPageHistoryChartBarColorRule" WHERE "statusPageId" = $1`,
        [page.id!.toString()],
      );

      expect(Number(left[0]!.count)).toBe(0);
    });

    test("when one rule cannot be made, the ones made before it are removed from the table", async () => {
      const page: StatusPage = await seedStatusPage("Unlucky");

      const realCreate: typeof StatusPageHistoryChartBarColorRuleService.create =
        StatusPageHistoryChartBarColorRuleService.create.bind(
          StatusPageHistoryChartBarColorRuleService,
        );
      let attempts: number = 0;
      let madeBeforeTheFailure: number = -1;

      const createSpy: jest.SpyInstance = jest
        .spyOn(StatusPageHistoryChartBarColorRuleService, "create")
        .mockImplementation(
          async (
            createBy: CreateBy<StatusPageHistoryChartBarColorRule>,
          ): Promise<StatusPageHistoryChartBarColorRule> => {
            attempts++;

            if (attempts === 3) {
              madeBeforeTheFailure = (await rulesOf(page.id!)).length;
              throw new Error("database unavailable");
            }

            return await realCreate(createBy);
          },
        );
      const loggerSpy: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {});

      try {
        await runSuccessHook(page, {
          [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
        });
      } finally {
        createSpy.mockRestore();
        loggerSpy.mockRestore();
      }

      expect(attempts).toBe(3);
      // Two were in the table when the third failed, and are not now.
      expect(madeBeforeTheFailure).toBe(2);
      expect(await rulesOf(page.id!)).toHaveLength(0);
    });

    /*
     * The required-column check read 0 as missing, so the bottom rule of the
     * recommended list - and any rule someone made with 0 in the dashboard -
     * was refused as "uptimePercentGreaterThanOrEqualTo is required".
     */
    test("a rule for an uptime of at least 0% can be made, and reads back as 0", async () => {
      const page: StatusPage = await seedStatusPage("Catch all");

      const rule: StatusPageHistoryChartBarColorRule =
        new StatusPageHistoryChartBarColorRule();
      rule.projectId = projectId;
      rule.statusPageId = page.id!;
      rule.uptimePercentGreaterThanOrEqualTo = 0;
      rule.barColor = new Color("#7f1d1d");

      await StatusPageHistoryChartBarColorRuleService.create({
        data: rule,
        props: { isRoot: true },
      });

      const rules: Array<StatusPageHistoryChartBarColorRule> = await rulesOf(
        page.id!,
      );

      expect(rules).toHaveLength(1);
      expect(getRuleUptimePercent(rules[0]!)).toBe(0);
    });
  },
);
