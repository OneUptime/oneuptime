import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * #4706: idx_attribute_values - a bloom filter over every attribute value of
 * LogItemV3 and SpanItemV3 - lets a search for one value skip the granules
 * that cannot hold it. Boot schema-sync adds the index DEFINITION to an
 * existing table; this migration builds it for the rows the table already
 * has, in the background, so searches over the days before the upgrade are
 * fast too.
 *
 * What is pinned:
 *
 *   - which tables, and that each is a model that declares the index;
 *   - the two statements per table: ADD INDEX IF NOT EXISTS with the model's
 *     own definition (the one CREATE TABLE and boot schema-sync write), then
 *     MATERIALIZE INDEX - both on the local storage table, ON CLUSTER, in
 *     that order, through the migration connection, the MATERIALIZE queued
 *     without waiting for it (mutations_sync = 0) and without touching the
 *     options every other migration shares;
 *   - a table that does not exist is skipped, every table is tried even
 *     after one fails, and then the migration fails naming it;
 *   - it is safe to run again, its rollback does nothing, it runs on the
 *     clustered schema instead of being baselined, and it is registered
 *     once, before the last slot.
 *
 * MaterializeAttributeValuesIndexClickhouse.test.ts runs it against a real
 * ClickHouse server.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock(
  "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil",
  () => {
    return {
      __esModule: true,
      default: { tableExists: jest.fn() },
    };
  },
);

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import {
  ATTRIBUTE_VALUES_INDEX_NAME,
  attributeValuesSkipIndex,
} from "Common/Types/AnalyticsDatabase/AttributeValueIndex";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import MaterializeAttributeValuesIndex, {
  ATTRIBUTE_VALUES_INDEX_MODELS,
  MaterializeInBackgroundOptions,
} from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;
type ModelType = { new (): AnalyticsBaseModel };

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const MIGRATION_NAME: string = "MaterializeAttributeValuesIndex";

const DEFINITION: string =
  "idx_attribute_values mapValues(attributes) TYPE bloom_filter(0.01) GRANULARITY 1";

const EXPECTED_STATEMENTS: Array<string> = [
  `ALTER TABLE LogItemV3Local ON CLUSTER 'oneuptime' ADD INDEX IF NOT EXISTS ${DEFINITION}`,
  "ALTER TABLE LogItemV3Local ON CLUSTER 'oneuptime' MATERIALIZE INDEX idx_attribute_values",
  `ALTER TABLE SpanItemV3Local ON CLUSTER 'oneuptime' ADD INDEX IF NOT EXISTS ${DEFINITION}`,
  "ALTER TABLE SpanItemV3Local ON CLUSTER 'oneuptime' MATERIALIZE INDEX idx_attribute_values",
];

const LOCAL_TABLE: RegExp = /Local$/;
const ADD_INDEX_STATEMENT: RegExp =
  /^ALTER TABLE \w+Local ON CLUSTER '[^']+' ADD INDEX IF NOT EXISTS idx_attribute_values mapValues\(attributes\) TYPE bloom_filter\(0\.01\) GRANULARITY 1$/;
const MATERIALIZE_STATEMENT: RegExp =
  /^ALTER TABLE \w+Local ON CLUSTER '[^']+' MATERIALIZE INDEX idx_attribute_values$/;
const DESTRUCTIVE: RegExp = /DROP|DELETE|CLEAR|MODIFY|UPDATE|SETTINGS/;

let savedClusterName: string | undefined;
let missingTables: Set<string>;
let failingStatements: Map<string, unknown>;
let events: Array<string>;
let infoSpy: MockSpy;
let warnSpy: MockSpy;
let errorSpy: MockSpy;

function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

function executedOptions(): Array<ClickhouseExecuteOptions> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[1] as ClickhouseExecuteOptions;
  });
}

// The local table an ALTER statement targets.
function tableOf(statement: string): string {
  return statement.split(" ")[2] || "";
}

function loggedMessages(spy: MockSpy): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return typeof call[0] === "string" ? call[0] : String(call[0]);
  });
}

async function migrationError(): Promise<Error> {
  try {
    await new MaterializeAttributeValuesIndex().migrate();
  } catch (err) {
    return err as Error;
  }

  throw new Error("expected the migration to fail");
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  missingTables = new Set<string>();
  failingStatements = new Map<string, unknown>();
  events = [];

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(
    async (statement: unknown): Promise<void> => {
      const text: string = statement as string;
      events.push(
        `${text.includes("MATERIALIZE") ? "materialize" : "add"} ${tableOf(text)}`,
      );

      for (const [fragment, error] of failingStatements.entries()) {
        if (text.includes(fragment)) {
          throw error;
        }
      }
    },
  );

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(
    async (table: unknown): Promise<boolean> => {
      events.push(`exists ${table as string}`);
      return !missingTables.has(table as string);
    },
  );

  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  infoSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("MaterializeAttributeValuesIndex", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: MaterializeAttributeValuesIndex =
        new MaterializeAttributeValuesIndex();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      // The runner records it by this name: renaming it would run it again.
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      /*
       * The analytics schema is always a cluster, and the runner records a
       * migration that opts out as executed without running it - which
       * would leave every existing install searching its older rows unindexed.
       */
      expect(new MaterializeAttributeValuesIndex().runsInClusterMode()).toBe(
        true,
      );
    });

    test("builds the index on exactly the log and span tables", () => {
      expect(
        ATTRIBUTE_VALUES_INDEX_MODELS.map((modelType: ModelType): string => {
          return new modelType().tableName;
        }),
      ).toEqual(["LogItemV3", "SpanItemV3"]);
    });

    test("the tables it builds on are exactly the tables whose models declare the index", () => {
      const declaring: Array<string> = AnalyticsModels.map(
        (modelType: ModelType): AnalyticsBaseModel => {
          return new modelType();
        },
      )
        .filter((model: AnalyticsBaseModel): boolean => {
          return Boolean(
            MaterializeAttributeValuesIndex.getIndexedColumn(model),
          );
        })
        .map((model: AnalyticsBaseModel): string => {
          return model.tableName;
        });

      expect(declaring).toEqual(["LogItemV3", "SpanItemV3"]);
    });

    test.each([
      ["Log", Log],
      ["Span", Span],
    ])(
      "%s declares the index on its attributes column",
      (_label: string, modelType: ModelType) => {
        const column: AnalyticsTableColumn | undefined =
          MaterializeAttributeValuesIndex.getIndexedColumn(new modelType());

        expect(column?.key).toBe("attributes");
        expect(column?.skipIndex).toEqual(attributeValuesSkipIndex());
      },
    );
  });

  describe("the statements", () => {
    test("add the definition if it is missing, then queue its build, table by table", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
      expect(events).toEqual([
        "exists LogItemV3Local",
        "add LogItemV3Local",
        "materialize LogItemV3Local",
        "exists SpanItemV3Local",
        "add SpanItemV3Local",
        "materialize SpanItemV3Local",
      ]);
    });

    test("add the very definition CREATE TABLE and boot schema-sync write", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      for (const modelType of [Log, Span]) {
        const model: AnalyticsBaseModel = new modelType();
        const definition: string = StatementGenerator.toSkipIndexDefinition(
          MaterializeAttributeValuesIndex.getIndexedColumn(model)!,
        );

        expect(definition).toBe(DEFINITION);
        expect(executedStatements()).toContain(
          MaterializeAttributeValuesIndex.getAddIndexStatement(
            model,
            MaterializeAttributeValuesIndex.getIndexedColumn(model)!,
          ),
        );
        expect(executedStatements()).toContain(
          MaterializeAttributeValuesIndex.getMaterializeStatement(model),
        );
      }
    });

    test("target the local storage tables, never the Distributed ones the app writes through", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      for (const statement of executedStatements()) {
        expect(tableOf(statement)).toMatch(LOCAL_TABLE);
        expect(statement).not.toContain("ALTER TABLE LogItemV3 ");
        expect(statement).not.toContain("ALTER TABLE SpanItemV3 ");
      }
    });

    test("add and build the index and nothing else: nothing dropped, deleted, cleared or modified", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      const [addLog, materializeLog, addSpan, materializeSpan] =
        executedStatements();

      expect(addLog).toMatch(ADD_INDEX_STATEMENT);
      expect(addSpan).toMatch(ADD_INDEX_STATEMENT);
      expect(materializeLog).toMatch(MATERIALIZE_STATEMENT);
      expect(materializeSpan).toMatch(MATERIALIZE_STATEMENT);

      for (const statement of executedStatements()) {
        expect(statement).not.toMatch(DESTRUCTIVE);
        // A whole table: a partition clause would leave the others unindexed.
        expect(statement).not.toContain("IN PARTITION");
      }
    });

    test("name the cluster from CLICKHOUSE_CLUSTER_NAME", async () => {
      process.env[CLUSTER_ENV_KEY] = "ext_cluster";

      await new MaterializeAttributeValuesIndex().migrate();

      for (const statement of executedStatements()) {
        expect(statement).toContain(" ON CLUSTER 'ext_cluster' ");
      }
    });

    test("add the definition through the migration connection, as every migration does", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      const options: Array<ClickhouseExecuteOptions> = executedOptions();

      expect(options[0]).toBe(MigrationExecuteOptions);
      expect(options[2]).toBe(MigrationExecuteOptions);
    });

    test("queue the build and return: mutations_sync = 0, on the migration connection", async () => {
      await new MaterializeAttributeValuesIndex().migrate();

      const options: Array<ClickhouseExecuteOptions> = executedOptions();

      expect(options[1]).toBe(MaterializeInBackgroundOptions);
      expect(options[3]).toBe(MaterializeInBackgroundOptions);
      expect(MaterializeInBackgroundOptions.useMigrationConnection).toBe(true);
      expect(
        MaterializeInBackgroundOptions.clickhouseSettings?.mutations_sync,
      ).toBe("0");
    });

    test("keep every other setting of the migration connection", () => {
      expect(MaterializeInBackgroundOptions.clickhouseSettings).toEqual({
        ...MigrationExecuteOptions.clickhouseSettings,
        mutations_sync: "0",
      });
      // The shared options are not changed for every other migration.
      expect(
        MigrationExecuteOptions.clickhouseSettings?.mutations_sync,
      ).toBeUndefined();
    });
  });

  describe("when something is missing or fails", () => {
    test("a table that does not exist yet is skipped: it is created with the index", async () => {
      missingTables.add("LogItemV3Local");

      await new MaterializeAttributeValuesIndex().migrate();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS.slice(2));
      expect(loggedMessages(infoSpy)).toContain(
        "MaterializeAttributeValuesIndex: LogItemV3Local does not exist; nothing to build.",
      );
    });

    test("no table at all: nothing runs and nothing fails", async () => {
      missingTables.add("LogItemV3Local");
      missingTables.add("SpanItemV3Local");

      await new MaterializeAttributeValuesIndex().migrate();

      expect(executedStatements()).toEqual([]);
    });

    test("a definition that cannot be added is not built over, and the migration fails naming the table", async () => {
      failingStatements.set(
        "LogItemV3Local ON CLUSTER 'oneuptime' ADD INDEX",
        new Error("Code: 159. Watching task is executing longer than ..."),
      );

      const error: Error = await migrationError();

      // The log table's build was never queued; the span table still was.
      expect(executedStatements()).toEqual([
        EXPECTED_STATEMENTS[0],
        EXPECTED_STATEMENTS[2],
        EXPECTED_STATEMENTS[3],
      ]);
      expect(error.message).toContain("LogItemV3Local");
      expect(error.message).toContain("Watching task is executing longer");
      expect(error.message).not.toContain("SpanItemV3Local");
    });

    test("every table is tried before the migration fails, so the runner retries only what failed", async () => {
      failingStatements.set(
        "LogItemV3Local ON CLUSTER 'oneuptime' MATERIALIZE",
        new Error("log table busy"),
      );
      failingStatements.set(
        "SpanItemV3Local ON CLUSTER 'oneuptime' MATERIALIZE",
        "span table busy",
      );

      const error: Error = await migrationError();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
      expect(error.message).toBe(
        "MaterializeAttributeValuesIndex: could not build idx_attribute_values on LogItemV3Local: log table busy; SpanItemV3Local: span table busy",
      );
      expect(loggedMessages(errorSpy)).toContain(
        "MaterializeAttributeValuesIndex: failed on LogItemV3Local:",
      );
    });

    test("a failed existence check counts as a failure of that table, not of the rest", async () => {
      migrationUtil.tableExists.mockImplementation(
        async (table: unknown): Promise<boolean> => {
          if (table === "LogItemV3Local") {
            throw new Error("cannot reach the server");
          }

          return true;
        },
      );

      const error: Error = await migrationError();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS.slice(2));
      expect(error.message).toContain(
        "LogItemV3Local: cannot reach the server",
      );
    });

    test("a model that no longer declares the index is skipped with a warning", async () => {
      const original: Array<ModelType> = [...ATTRIBUTE_VALUES_INDEX_MODELS];

      class LogWithoutIndex extends Log {
        public constructor() {
          super();
          this.tableColumns = this.tableColumns.filter(
            (column: AnalyticsTableColumn): boolean => {
              return column.skipIndex?.name !== ATTRIBUTE_VALUES_INDEX_NAME;
            },
          );
        }
      }

      ATTRIBUTE_VALUES_INDEX_MODELS.splice(0, 1, LogWithoutIndex);

      try {
        await new MaterializeAttributeValuesIndex().migrate();
      } finally {
        ATTRIBUTE_VALUES_INDEX_MODELS.splice(
          0,
          ATTRIBUTE_VALUES_INDEX_MODELS.length,
          ...original,
        );
      }

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS.slice(2));
      expect(loggedMessages(warnSpy)).toContain(
        "MaterializeAttributeValuesIndex: LogItemV3 does not declare idx_attribute_values; skipping.",
      );
    });
  });

  describe("running it again, and rolling it back", () => {
    test("is safe to run again: the same statements, which add nothing and read nothing twice", async () => {
      await new MaterializeAttributeValuesIndex().migrate();
      await new MaterializeAttributeValuesIndex().migrate();

      expect(executedStatements()).toEqual([
        ...EXPECTED_STATEMENTS,
        ...EXPECTED_STATEMENTS,
      ]);
    });

    test("rollback drops nothing: the index is what keeps the searches fast", async () => {
      await expect(
        new MaterializeAttributeValuesIndex().rollback(),
      ).resolves.toBeUndefined();

      expect(metricService.execute).not.toHaveBeenCalled();
    });

    test("is registered exactly once, before the MCP client columns that keep the last slot", () => {
      const index: string = fs
        .readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "..",
            "FeatureSet",
            "Workers",
            "DataMigrations",
            "Index.ts",
          ),
          "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      const registered: Array<string> = Array.from(
        index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });
});
