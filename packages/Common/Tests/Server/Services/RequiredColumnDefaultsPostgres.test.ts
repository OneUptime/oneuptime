import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import {
  REQUIRED_COLUMN_DEFAULTS,
  RequiredColumnDefaultsContract,
  defaultedColumnsOf,
} from "../../Helpers/RequiredColumnDefaults";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * Issue #5158 on a migrated Postgres: a create that leaves out a required
 * column the API reference gives a default is stored with that default.
 *
 * Opt in with RUN_POSTGRES_REQUIRED_COLUMN_DEFAULTS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_REQUIRED_COLUMN_DEFAULTS_TESTS=true \
 *   REQUIRED_COLUMN_DEFAULTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   REQUIRED_COLUMN_DEFAULTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... \
 *   npx jest Tests/Server/Services/RequiredColumnDefaultsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database.
 *
 * DatabaseService.checkRequiredFields lets such a column be left out only
 * when it is flagged isDefaultValueColumn: the INSERT then leaves it out,
 * and the promise the API reference makes is only kept if the migrated
 * column's DEFAULT is the declared one. So, against the real database:
 *
 *   - every required column with a declared default, of every model, has
 *     that DEFAULT in the migrated schema (information_schema);
 *   - each of the 29 columns the issue was one of is left out of a create
 *     through its model's service, and the row it writes holds the default;
 *   - a threat intel feed and a detection rule, created through their hooks
 *     as the Dashboard sends them - no isEnabled - are stored switched on.
 *
 * The tables are cloned structure-only (LIKE ... INCLUDING ALL: columns,
 * defaults, indexes, no foreign keys) into a uniquely named schema that is
 * dropped afterwards. Workflows and realtime events, the only side effects
 * of a create outside Postgres, are stubbed.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_REQUIRED_COLUMN_DEFAULTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const SIGMA_YAML: string = [
  "title: Failed logon burst",
  "detection:",
  "  selection:",
  "    className: Authentication",
  "  condition: selection",
].join("\n");

const TABLES: Array<string> = Array.from(
  new Set<string>(
    REQUIRED_COLUMN_DEFAULTS.map(
      (contract: RequiredColumnDefaultsContract): string => {
        return new contract.modelType().tableName!;
      },
    ),
  ),
);

// A value of the column's kind, for a required column the test is not about.
function valueFor(column: string, metadata: TableColumnMetadata): unknown {
  switch (metadata.type) {
    case TableColumnType.ObjectID:
      return ObjectID.generate();
    case TableColumnType.Email:
      return new Email("feeds@example.com");
    case TableColumnType.JSON:
      return {};
    case TableColumnType.MonitorType:
      return "Ping";
    case TableColumnType.Name:
    case TableColumnType.ShortText:
    case TableColumnType.LongText:
    case TableColumnType.VeryLongText:
    case TableColumnType.Description:
      return `${column} of issue 5158`;
    default:
      throw new Error(
        `No test value for a required ${metadata.type} column (${column}).`,
      );
  }
}

/*
 * Columns NOT NULL in Postgres that the model does not mark required,
 * because the service's own hooks fill them in (a recording rule's output
 * metric from its name, a static variable's content check): the test
 * creates without those hooks, so it gives them.
 */
const FILLED_IN_BY_HOOKS: Record<string, Record<string, unknown>> = {
  LogRecordingRule: { outputMetricName: "issue.5158.log.metric" },
  MetricRecordingRule: { outputMetricName: "issue.5158.metric" },
  TraceRecordingRule: { outputMetricName: "issue.5158.trace.metric" },
  WorkflowVariable: { content: "issue 5158" },
};

/*
 * A model with every required column given but the ones under test - and
 * its slug, which the create makes from its name.
 */
function createdWithout(
  modelType: DatabaseBaseModelType,
  leftOut: Array<string>,
): DatabaseBaseModel {
  const model: DatabaseBaseModel = new modelType();

  Object.assign(model, FILLED_IN_BY_HOOKS[modelType.name] || {});

  for (const column of model.getRequiredColumns().columns) {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);

    if (
      leftOut.includes(column) ||
      metadata.isDefaultValueColumn ||
      metadata.type === TableColumnType.Slug ||
      metadata.type === TableColumnType.Entity
    ) {
      continue;
    }

    (model as unknown as Record<string, unknown>)[column] = valueFor(
      column,
      metadata,
    );
  }

  return model;
}

// A raw SQL literal default without its quotes and cast: 'All'::character varying is All.
function sqlLiteralValue(sql: string): string {
  const closingQuote: number = sql.lastIndexOf("'");
  const rest: string = sql.slice(closingQuote + 1);

  if (
    !sql.startsWith("'") ||
    closingQuote < 1 ||
    (rest !== "" && !rest.startsWith("::"))
  ) {
    return sql;
  }

  return sql.slice(1, closingQuote).split("''").join("'");
}

function asComparableText(value: unknown): string {
  const isJson: boolean =
    Array.isArray(value) ||
    (typeof value === "object" &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype);

  return isJson ? JSON.stringify(value) : String(value);
}

describePostgres(
  "required columns with a default, on a migrated Postgres (issue #5158)",
  () => {
    const schema: string = `defaults_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;
    let database: DataSource;

    async function storedRow(
      tableName: string,
      id: ObjectID,
    ): Promise<Record<string, unknown>> {
      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT * FROM "${schema}"."${tableName}" WHERE "_id" = $1`,
        [id.toString()],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["REQUIRED_COLUMN_DEFAULTS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["REQUIRED_COLUMN_DEFAULTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["REQUIRED_COLUMN_DEFAULTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });

      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const contract of REQUIRED_COLUMN_DEFAULTS) {
        jest
          .spyOn(contract.service as never, "onTriggerRealtime" as never)
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(contract.service as never, "onTriggerWorkflow" as never)
          .mockResolvedValue(undefined as never);
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("every required column the API reference gives a default has that DEFAULT in the migrated schema", async () => {
      const declared: Array<{ table: string; column: string; value: string }> =
        [];

      for (const modelType of Entities as Array<DatabaseBaseModelType>) {
        const model: DatabaseBaseModel = new modelType();

        if (!model.tableName) {
          continue;
        }

        for (const column of model.getTableColumns().columns) {
          const metadata: TableColumnMetadata =
            model.getTableColumnMetadata(column);

          if (
            metadata.required &&
            metadata.defaultValue !== undefined &&
            metadata.defaultValue !== null
          ) {
            declared.push({
              table: model.tableName,
              column: column,
              value: asComparableText(metadata.defaultValue),
            });
          }
        }
      }

      const migrated: Array<{
        table_name: string;
        column_name: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      const defaults: Map<string, string | null> = new Map<
        string,
        string | null
      >(
        migrated.map(
          (row: {
            table_name: string;
            column_name: string;
            column_default: string | null;
          }): [string, string | null] => {
            return [`${row.table_name}.${row.column_name}`, row.column_default];
          },
        ),
      );

      const otherwise: Array<string> = declared
        .filter((entry: { table: string; column: string; value: string }) => {
          const stored: string | null | undefined = defaults.get(
            `${entry.table}.${entry.column}`,
          );

          return (
            stored === undefined ||
            stored === null ||
            sqlLiteralValue(stored) !== entry.value
          );
        })
        .map((entry: { table: string; column: string; value: string }) => {
          return `${entry.table}.${entry.column}: declared ${entry.value}, migrated ${String(
            defaults.get(`${entry.table}.${entry.column}`),
          )}`;
        });

      expect(declared.length).toBeGreaterThan(500);
      expect(otherwise).toEqual([]);
    });

    describe.each(
      REQUIRED_COLUMN_DEFAULTS.map(
        (
          contract: RequiredColumnDefaultsContract,
        ): [string, RequiredColumnDefaultsContract] => {
          return [contract.modelType.name, contract];
        },
      ),
    )("%s", (_name: string, contract: RequiredColumnDefaultsContract) => {
      test(`created through its service without ${contract.defaults
        .map((entry: [string, unknown]): string => {
          return entry[0];
        })
        .join(", ")}, the row holds the defaults`, async () => {
        const service: {
          create: (createBy: {
            data: DatabaseBaseModel;
            props: { isRoot: boolean; ignoreHooks: boolean };
          }) => Promise<DatabaseBaseModel>;
        } = contract.service as never;

        const created: DatabaseBaseModel = await service.create({
          data: createdWithout(
            contract.modelType,
            defaultedColumnsOf(contract),
          ),
          // The create pipeline without the service's own hooks: what is under test is the INSERT.
          props: { isRoot: true, ignoreHooks: true },
        });

        const row: Record<string, unknown> = await storedRow(
          new contract.modelType().tableName!,
          created.id!,
        );

        for (const [column, value] of contract.defaults) {
          expect({ [column]: row[column] }).toEqual({ [column]: value });
        }
      });
    });

    test("a threat intel feed created as the Dashboard sends it - no isEnabled - is stored switched on", async () => {
      const feed: ThreatIntelFeed = new ThreatIntelFeed();
      feed.projectId = ObjectID.generate();
      feed.name = "Corporate MISP";
      feed.apiRootUrl = "https://taxii.example.com/api1/";
      feed.collectionId = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";
      feed.pollIntervalInMinutes = 60;
      feed.minimumConfidence = 0;
      feed.shouldCreateCase = true;
      feed.shouldCreateAlert = true;
      feed.shouldCreateIncident = false;
      feed.shouldWriteDetectionFinding = true;

      const created: ThreatIntelFeed = await ThreatIntelFeedService.create({
        data: feed,
        props: { isRoot: true },
      });

      const row: Record<string, unknown> = await storedRow(
        new ThreatIntelFeed().tableName!,
        created.id!,
      );

      expect(row["isEnabled"]).toBe(true);
      expect(row["pollIntervalInMinutes"]).toBe(60);
      expect(row["name"]).toBe("Corporate MISP");
    });

    test("a detection rule created as the Dashboard sends it - no isEnabled - is stored switched on", async () => {
      const rule: DetectionRule = new DetectionRule();
      rule.projectId = ObjectID.generate();
      rule.name = "Failed logon burst";
      rule.sigmaRuleYaml = SIGMA_YAML;
      rule.evaluationIntervalInMinutes = 5;
      rule.matchCountThreshold = 1;
      rule.shouldCreateCase = true;
      rule.shouldCreateAlert = false;
      rule.shouldCreateIncident = false;
      rule.shouldWriteDetectionFinding = true;

      const created: DetectionRule = await DetectionRuleService.create({
        data: rule,
        props: { isRoot: true },
      });

      const row: Record<string, unknown> = await storedRow(
        new DetectionRule().tableName!,
        created.id!,
      );

      expect(row["isEnabled"]).toBe(true);
      expect(row["evaluationIntervalInMinutes"]).toBe(5);
      expect(row["shouldCreateAlert"]).toBe(false);
    });
  },
);
