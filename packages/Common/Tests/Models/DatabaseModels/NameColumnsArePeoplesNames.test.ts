import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { WidenThingNameColumns1808992530000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992530000-WidenThingNameColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";

/*
 * A NAME COLUMN IS A PERSON'S NAME; A THING'S NAME IS TEXT.
 *
 * TableColumnType.Name is the person's-name type: 50 characters, a Name
 * object in memory (first, middle and last name), and an object in the
 * API's schema - {"_type":"Name","value":"..."} - which the OpenAPI spec,
 * the MCP tools and the docs published. Thirty-one things' display names
 * (a cloud connection's, a probe's, an LLM provider's, a pipeline's, a
 * saved view's...) and a probe's description had it, so the API asked for
 * an object where everyone sends text, and held a probe's description to 50
 * characters. They are ShortText (a probe's description LongText) since
 * WidenThingNameColumns1808992530000.
 *
 * The rule, held here for every model: a column of the Name type is a
 * person's name, one of PERSON_NAME_COLUMNS with what it names. A new
 * display name is ShortText, as 208 other names are. And the thirty-two
 * columns moved off it stay text, as wide in the database as the API and
 * the forms let them be.
 */

type ModelType = { new (): BaseModel };

/*
 * The columns that hold a person's name, and whose name each is. A column
 * of the Name type that is not here is a thing's name typed as a person's:
 * make it ShortText.
 */
const PERSON_NAME_COLUMNS: Record<string, string> = {
  "User.name": "the person's own name",
  "Project.createdOwnerName": "the name of the person who created the project",
  "DeletedProject.projectCreatedByUserName":
    "the name of the person who created the deleted project",
  "DeletedProject.projectDeletedByUserName":
    "the name of the person who deleted the project",
};

// Every column moved off the Name type, and the text type it is now.
const RETYPED_COLUMNS: Record<string, TableColumnType> = {
  "AIAgent.name": TableColumnType.ShortText,
  "AuditLogExport.name": TableColumnType.ShortText,
  "CloudConnection.name": TableColumnType.ShortText,
  "ExternalMcpServer.name": TableColumnType.ShortText,
  "LogDropFilter.name": TableColumnType.ShortText,
  "ExceptionSavedView.name": TableColumnType.ShortText,
  "LlmObservabilityConnection.name": TableColumnType.ShortText,
  "LogPipeline.name": TableColumnType.ShortText,
  "LlmCostBudget.name": TableColumnType.ShortText,
  "MetricSavedView.name": TableColumnType.ShortText,
  "Probe.name": TableColumnType.ShortText,
  "Probe.description": TableColumnType.LongText,
  "LogSavedView.name": TableColumnType.ShortText,
  "LogRecordingRule.name": TableColumnType.ShortText,
  "SecurityEventConnection.name": TableColumnType.ShortText,
  "MetricRecordingRule.name": TableColumnType.ShortText,
  "TraceRecordingRule.name": TableColumnType.ShortText,
  "VideoCallConnection.name": TableColumnType.ShortText,
  "SecurityEventDestination.name": TableColumnType.ShortText,
  "SecurityPlaybook.name": TableColumnType.ShortText,
  "TraceSavedView.name": TableColumnType.ShortText,
  "TracePipelineProcessor.name": TableColumnType.ShortText,
  "TraceScrubRule.name": TableColumnType.ShortText,
  "TracePipeline.name": TableColumnType.ShortText,
  "LogPipelineProcessor.name": TableColumnType.ShortText,
  "LlmProvider.name": TableColumnType.ShortText,
  "LogScrubRule.name": TableColumnType.ShortText,
  "NetworkControllerConnection.name": TableColumnType.ShortText,
  "MetricPipelineRule.name": TableColumnType.ShortText,
  "SecurityPlaybookRun.playbookName": TableColumnType.ShortText,
  "ThreatIntelFeed.name": TableColumnType.ShortText,
  "TraceDropFilter.name": TableColumnType.ShortText,
};

function modelNamed(name: string): ModelType {
  const found: ModelType | undefined = (AllModelTypes as Array<ModelType>).find(
    (modelType: ModelType): boolean => {
      return modelType.name === name;
    },
  );

  if (!found) {
    throw new Error(`No database model is named ${name}`);
  }

  return found;
}

function columnArgs(modelType: ModelType, column: string): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs): boolean => {
      return candidate.target === modelType;
    })
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === column;
    });

  if (!args) {
    throw new Error(`${modelType.name}.${column} has no @Column`);
  }

  return args;
}

function split(key: string): { model: string; column: string } {
  const [model, column] = key.split(".") as [string, string];
  return { model, column };
}

// Every column of every model typed TableColumnType.Name, as Model.column.
function nameTypedColumns(): Array<string> {
  const found: Array<string> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (metadata?.type === TableColumnType.Name) {
        found.push(`${modelType.name}.${column}`);
      }
    }
  }

  return found.sort();
}

// A model's create schema as the OpenAPI spec publishes it.
function publishedCreateSchema(modelType: ModelType): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "Schema",
    ModelSchema.getCreateModelSchema({ modelType: modelType }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
}

function publishedProperty(modelType: ModelType, column: string): JSONObject {
  const schema: JSONObject = publishedCreateSchema(modelType);
  const properties: JSONObject = (schema["properties"] || {}) as JSONObject;

  return properties[column] as JSONObject;
}

function recordQueries(): {
  runner: QueryRunner;
  sql: () => Array<string>;
} {
  const query: jest.Mock = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  return {
    runner: { query } as unknown as QueryRunner,
    sql: (): Array<string> => {
      return query.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      });
    },
  };
}

describe("a Name column holds a person's name", () => {
  test("every column of the Name type is a person's name", () => {
    expect(nameTypedColumns()).toEqual(Object.keys(PERSON_NAME_COLUMNS).sort());
  });

  test("each says whose name it holds", () => {
    for (const [key, whose] of Object.entries(PERSON_NAME_COLUMNS)) {
      expect({ key, whose: whose.length > 0 }).toEqual({ key, whose: true });
      expect(whose).toMatch(/person/);
    }
  });

  test("a person's name is the Name type's 50 characters in the database", () => {
    for (const key of Object.keys(PERSON_NAME_COLUMNS)) {
      const { model, column } = split(key);
      const args: ColumnMetadataArgs = columnArgs(modelNamed(model), column);

      expect({
        key,
        type: args.options.type,
        length: args.options.length,
      }).toEqual({
        key,
        type: ColumnType.Name,
        length: ColumnLength.Name,
      });
    }
  });

  test("the API still describes a user's name as the Name object", () => {
    const property: JSONObject = publishedProperty(modelNamed("User"), "name");

    expect(property["type"]).toBe("object");
    expect(JSON.stringify(property)).toContain('"Name"');
  });
});

describe("a thing's name is text", () => {
  test("every column moved off the Name type is the text type it should be", () => {
    for (const [key, type] of Object.entries(RETYPED_COLUMNS)) {
      const { model, column } = split(key);
      const metadata: TableColumnMetadata = new (modelNamed(
        model,
      ))().getTableColumnMetadata(column);

      expect({ key, type: metadata.type }).toEqual({ key, type });
    }
  });

  test("none of them is a person's name too", () => {
    for (const key of Object.keys(RETYPED_COLUMNS)) {
      expect(PERSON_NAME_COLUMNS[key]).toBeUndefined();
    }
  });

  test("the database holds as much as the API and the forms allow", () => {
    for (const [key, type] of Object.entries(RETYPED_COLUMNS)) {
      const { model, column } = split(key);
      const args: ColumnMetadataArgs = columnArgs(modelNamed(model), column);
      const width: number | undefined = getMaxLengthFromTableColumnType(type);

      expect({
        key,
        type: args.options.type,
        length: args.options.length,
      }).toEqual({
        key,
        type:
          type === TableColumnType.LongText
            ? ColumnType.LongText
            : ColumnType.ShortText,
        length: width,
      });
    }

    // A name holds 100 characters, a probe's description 500.
    expect(getMaxLengthFromTableColumnType(TableColumnType.ShortText)).toBe(
      100,
    );
    expect(getMaxLengthFromTableColumnType(TableColumnType.LongText)).toBe(500);
  });

  test("the API describes each as plain text, never the Name object", () => {
    const notAskedFor: Array<string> = [];

    for (const key of Object.keys(RETYPED_COLUMNS)) {
      const { model, column } = split(key);
      const property: JSONObject | undefined = publishedProperty(
        modelNamed(model),
        column,
      );

      // A column the create schema leaves out is not asked for at all.
      if (!property) {
        notAskedFor.push(key);
        continue;
      }

      expect({ key, type: property["type"] }).toEqual({ key, type: "string" });
      expect({ key, schema: JSON.stringify(property) }).not.toEqual({
        key,
        schema: expect.stringContaining('"_type"'),
      });
    }

    /*
     * Only a playbook run's copy of its playbook's name is left out: the
     * server writes it when the run starts, nobody creates it.
     */
    expect(notAskedFor).toEqual(["SecurityPlaybookRun.playbookName"]);

    // The connection a cloud account is read by is created with a name.
    expect(
      publishedProperty(modelNamed("CloudConnection"), "name")["type"],
    ).toBe("string");
  });
});

describe("WidenThingNameColumns1808992530000", () => {
  const migration: MigrationInterface =
    new WidenThingNameColumns1808992530000();

  // "Model.column" -> its table, as the migration names them.
  const expectedTables: Array<{
    table: string;
    column: string;
    width: number;
  }> = Object.entries(RETYPED_COLUMNS).map(
    ([key, type]: [string, TableColumnType]) => {
      const { model, column } = split(key);
      return {
        table: model,
        column,
        width: getMaxLengthFromTableColumnType(type)!,
      };
    },
  );

  test("is registered, after the migrations master had", () => {
    const names: Array<string> = SchemaMigrations.map(
      (entry: { name: string }): string => {
        return entry.name;
      },
    );
    const index: number = names.indexOf("WidenThingNameColumns1808992530000");

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddDataWarehouseSpend1808992400000"),
    );
    expect(
      names.indexOf("AddDataWarehouseSpend1808992400000"),
    ).toBeGreaterThan(-1);
  });

  test("up() widens every retyped column in place, keeping every value", async () => {
    const { runner, sql } = recordQueries();
    await migration.up(runner);

    expect(sql().slice().sort()).toEqual(
      expectedTables
        .map((entry: { table: string; column: string; width: number }) => {
          return `ALTER TABLE "${entry.table}" ALTER COLUMN "${entry.column}" TYPE character varying(${entry.width})`;
        })
        .sort(),
    );

    for (const statement of sql()) {
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("DELETE");
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain(" ADD ");
    }
  });

  test("down() cuts a longer value to fit before it narrows, so the revert cannot fail", async () => {
    const { runner, sql } = recordQueries();
    await migration.down(runner);

    const statements: Array<string> = sql();

    expect(statements.length).toBe(expectedTables.length * 2);

    for (const entry of expectedTables) {
      const cut: string = `UPDATE "${entry.table}" SET "${entry.column}" = LEFT("${entry.column}", 50) WHERE LENGTH("${entry.column}") > 50`;
      const narrow: string = `ALTER TABLE "${entry.table}" ALTER COLUMN "${entry.column}" TYPE character varying(50)`;

      expect(statements).toContain(cut);
      expect(statements).toContain(narrow);
      // Each column is cut before it is narrowed.
      expect(statements.indexOf(cut)).toBeLessThan(statements.indexOf(narrow));
    }
  });
});
