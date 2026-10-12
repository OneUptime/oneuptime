import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  And,
  DataSource,
  Equal,
  FindOperator,
  In,
  MoreThanOrEqual,
  Raw,
} from "typeorm";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import BillingInvoice from "../../../Models/DatabaseModels/BillingInvoice";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  getDecimalDatabaseTransformer,
  readDecimalColumnValue,
} from "../../../Types/Database/DecimalColumnTransformer";
import Decimal from "../../../Types/Decimal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  ModelSchema,
  ModelSchemaType,
} from "../../../Utils/Schema/ModelSchema";

/*
 * Issue #4719: a status page's bar color rule came back from the API as
 *
 *   "uptimePercentGreaterThanOrEqualTo": "100"
 *
 * - a string, for a field the OpenAPI spec declares a number. Postgres keeps
 * a decimal as `numeric`, and node-postgres hands every numeric value back
 * as text (it can hold more digits than a JavaScript number); the column had
 * no transformer to turn the text back into a number, so the model held the
 * text and the API answered it. The Terraform provider read the string as
 * null, and every apply of the rule failed with "Provider produced
 * inconsistent result after apply".
 *
 * node-postgres does the same for bigint (int8). So this pins, for every
 * column of every model that Postgres hands back as text:
 *
 *   - TypeORM's own hydration - PostgresDriver.prepareHydratedValue, what a
 *     find runs on every row - turns the text into the number it spells
 *     (into a Decimal, for the columns whose model type is Decimal);
 *   - the API answers that number as a JSON number;
 *   - the API's OpenAPI spec says `number` for it, so the two agree.
 *
 * A new decimal or bigint column without a transformer fails here, by name.
 * Metadata only: no database connection anywhere (the Postgres half of this
 * is Tests/Server/Services/DecimalColumnsPostgres.test.ts).
 */

// Postgres column types node-postgres hands back as text.
const DECIMAL_TYPES: Array<string> = ["decimal", "numeric"];
const BIGINT_TYPES: Array<string> = ["bigint", "int8"];

interface TextColumn {
  label: string;
  entity: EntityMetadata;
  column: ColumnMetadata;
  modelType: new () => BaseModel;
}

let dataSource: DataSource;

beforeAll(async () => {
  /*
   * A data source that never connects: building its metadata is all
   * TypeORM needs to hydrate a value the way it hydrates a row. The method
   * is protected; initialize() would build it the same way, then connect.
   */
  dataSource = new DataSource({
    type: "postgres",
    entities: Models,
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

function columnsOfType(types: Array<string>): Array<TextColumn> {
  const found: Array<TextColumn> = [];

  for (const modelType of Models) {
    const entity: EntityMetadata = dataSource.getMetadata(modelType);

    for (const column of entity.columns) {
      if (!types.includes(String(column.type).toLowerCase())) {
        continue;
      }

      found.push({
        label: `${entity.tableName}.${column.propertyName}`,
        entity,
        column,
        modelType: modelType as new () => BaseModel,
      });
    }
  }

  return found;
}

// What TypeORM makes of a value Postgres handed back, for this column.
function hydrate(textColumn: TextColumn, value: unknown): unknown {
  return dataSource.driver.prepareHydratedValue(value, textColumn.column);
}

// The number a hydrated value holds: a number, or a Decimal's number.
function numberIn(value: unknown): unknown {
  return value instanceof Decimal ? value.value : value;
}

// The JSON the API answers for a record holding this value in this column.
function apiJsonFor(textColumn: TextColumn, value: unknown): JSONObject {
  const model: BaseModel = new textColumn.modelType();
  (model as unknown as Record<string, unknown>)[
    textColumn.column.propertyName
  ] = value;

  // Through the wire, as Response.sendEntityResponse sends it.
  return JSON.parse(
    JSON.stringify(BaseModel.toJSON(model, textColumn.modelType)),
  ) as JSONObject;
}

// Whether the API answers this column at all: through a CRUD route, to a role.
function isServedByTheApi(textColumn: TextColumn): boolean {
  const model: BaseModel = new textColumn.modelType();
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(textColumn.column.propertyName);

  return Boolean(
    model.crudApiPath && accessControl && accessControl.read.length > 0,
  );
}

// Whether the published API reference (and so the Terraform provider) has it.
function isInTheOpenApiSpec(textColumn: TextColumn): boolean {
  const model: BaseModel = new textColumn.modelType();

  return isServedByTheApi(textColumn) && Boolean(model.enableDocumentation);
}

function openApiPropertyOf(
  textColumn: TextColumn,
  getSchema: (data: { modelType: new () => BaseModel }) => ModelSchemaType,
): JSONObject | undefined {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();
  registry.register("Schema", getSchema({ modelType: textColumn.modelType }));

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  const schema: JSONObject = (
    (document["components"] as JSONObject)["schemas"] as JSONObject
  )["Schema"] as JSONObject;

  return ((schema["properties"] || {}) as JSONObject)[
    textColumn.column.propertyName
  ] as JSONObject | undefined;
}

describe("the text Postgres hands back for a decimal, as a number", () => {
  test.each([
    ["100", 100],
    ["100.00", 100],
    ["99.65", 99.65],
    ["99.650", 99.65],
    ["0", 0],
    ["0.00", 0],
    ["-12.5", -12.5],
    ["0.0000003", 0.0000003],
    ["1234567.891", 1234567.891],
    ["9007199254740991", 9007199254740991],
    [" 99.65 ", 99.65],
  ])("%j reads as %p", (text: string, expected: number) => {
    expect(readDecimalColumnValue(text)).toBe(expected);
  });

  /*
   * A numeric can hold more digits than a JavaScript number: the nearest
   * one is what the API can answer, and all it ever writes (request bodies
   * are JSON, read into JavaScript numbers).
   */
  test("more digits than a JavaScript number keeps read as the nearest number", () => {
    expect(readDecimalColumnValue("0.12345678901234567890")).toBe(
      0.12345678901234568,
    );
    expect(readDecimalColumnValue("99.930555555555555555555")).toBe(
      99.93055555555556,
    );
  });

  test.each([
    ["NaN"],
    ["Infinity"],
    ["-Infinity"],
    [""],
    ["   "],
    ["abc"],
    ["12abc"],
  ])("%j spells no finite number, so it reads as null", (text: string) => {
    expect(readDecimalColumnValue(text)).toBeNull();
  });

  test("a number stays the number it is; null, undefined and anything else read as null", () => {
    expect(readDecimalColumnValue(42.5)).toBe(42.5);
    expect(readDecimalColumnValue(0)).toBe(0);
    expect(readDecimalColumnValue(Number.NaN)).toBeNull();
    expect(readDecimalColumnValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readDecimalColumnValue(null)).toBeNull();
    expect(readDecimalColumnValue(undefined)).toBeNull();
    expect(readDecimalColumnValue({ value: 1 })).toBeNull();
    expect(readDecimalColumnValue(true)).toBeNull();
  });
});

describe("getDecimalDatabaseTransformer", () => {
  const transformer: ValueTransformer = getDecimalDatabaseTransformer();

  test("reads what Postgres hands back as the number it spells", () => {
    expect(transformer.from("99.65")).toBe(99.65);
    expect(transformer.from("100.00")).toBe(100);
    expect(transformer.from(null)).toBeNull();
  });

  /*
   * TypeORM writes DEFAULT for a column whose value is still undefined
   * after the transformer, and NULL for null: folding undefined into null
   * would silently skip a column default (BigIntColumnTransformer).
   */
  test("leaves undefined undefined, so a column default still applies", () => {
    expect(transformer.to(undefined)).toBeUndefined();
    expect(transformer.to(null)).toBeNull();
  });

  test("hands numbers and numeric text to the driver as they came", () => {
    expect(transformer.to(99.65)).toBe(99.65);
    expect(transformer.to(0)).toBe(0);
    expect(transformer.to("99.65")).toBe("99.65");
  });

  // String(NaN) is 'NaN', which a numeric column would store as a value.
  test("writes a number that is not finite as null, never as 'NaN'", () => {
    expect(transformer.to(Number.NaN)).toBeNull();
    expect(transformer.to(Number.POSITIVE_INFINITY)).toBeNull();
    expect(transformer.to(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  /*
   * A find hands the transformer each value of a query operator, and an
   * And()/Or() hands it the child operators themselves
   * (FindOperator.transformValue): they have to come out as they went in.
   */
  test("leaves query operators and raw SQL as they were", () => {
    const atLeast: FindOperator<number> = MoreThanOrEqual(99.65);
    atLeast.transformValue(transformer);
    expect(atLeast.value).toBe(99.65);

    const oneOf: FindOperator<number> = In([99, 99.65]);
    oneOf.transformValue(transformer);
    expect(oneOf.value).toEqual([99, 99.65]);

    const equal: FindOperator<number> = Equal(100);
    const raw: FindOperator<unknown> = Raw((alias: string): string => {
      return `${alias} IS NOT NULL`;
    });
    const both: FindOperator<unknown> = And(equal, raw);
    both.transformValue(transformer);
    const children: Array<unknown> = both.value as unknown as Array<unknown>;
    expect(children[0]).toBe(equal);
    expect(children[1]).toBe(raw);
    expect(equal.value).toBe(100);

    const sql: () => string = (): string => {
      return "NOW()";
    };
    expect(transformer.to(sql)).toBe(sql);
  });
});

describe("every decimal column of every model", () => {
  test("is found, the two that had no transformer among them", () => {
    const labels: Array<string> = columnsOfType(DECIMAL_TYPES).map(
      (textColumn: TextColumn): string => {
        return textColumn.label;
      },
    );

    // A floor, so a broken lookup cannot pass by finding nothing.
    expect(labels.length).toBeGreaterThanOrEqual(50);
    expect(labels).toContain(
      "StatusPageHistoryChartBarColorRule.uptimePercentGreaterThanOrEqualTo",
    );
    expect(labels).toContain("BillingInvoice.amount");
  });

  test("has a transformer", () => {
    const withoutOne: Array<string> = columnsOfType(DECIMAL_TYPES)
      .filter((textColumn: TextColumn): boolean => {
        return !textColumn.column.transformer;
      })
      .map((textColumn: TextColumn): string => {
        return textColumn.label;
      });

    // Give it getDecimalDatabaseTransformer() (Types/Database).
    expect(withoutOne).toEqual([]);
  });

  test("reads the text Postgres hands back as the number it spells", () => {
    const misread: Array<string> = [];

    for (const textColumn of columnsOfType(DECIMAL_TYPES)) {
      for (const [text, expected] of [
        ["99.65", 99.65],
        ["100.00", 100],
        ["0", 0],
      ] as Array<[string, number]>) {
        const hydrated: unknown = numberIn(hydrate(textColumn, text));

        if (typeof hydrated !== "number" || hydrated !== expected) {
          misread.push(
            `${textColumn.label}: ${JSON.stringify(text)} read as ${JSON.stringify(hydrated)}`,
          );
        }
      }
    }

    expect(misread).toEqual([]);
  });

  test("reads NULL as null, not as a number", () => {
    const misread: Array<string> = [];

    for (const textColumn of columnsOfType(DECIMAL_TYPES)) {
      const hydrated: unknown = hydrate(textColumn, null);

      if (hydrated !== null && hydrated !== undefined) {
        misread.push(`${textColumn.label}: NULL read as ${String(hydrated)}`);
      }
    }

    expect(misread).toEqual([]);
  });
});

describe("every bigint column of every model", () => {
  test("is found", () => {
    expect(columnsOfType(BIGINT_TYPES).length).toBeGreaterThanOrEqual(30);
  });

  test("reads the text Postgres hands back as the number it spells", () => {
    const misread: Array<string> = [];

    for (const textColumn of columnsOfType(BIGINT_TYPES)) {
      for (const [text, expected] of [
        ["9007199254740991", 9007199254740991],
        ["1073741824", 1073741824],
        ["0", 0],
      ] as Array<[string, number]>) {
        const hydrated: unknown = numberIn(hydrate(textColumn, text));

        if (typeof hydrated !== "number" || hydrated !== expected) {
          misread.push(
            `${textColumn.label}: ${JSON.stringify(text)} read as ${JSON.stringify(hydrated)}`,
          );
        }
      }
    }

    expect(misread).toEqual([]);
  });
});

describe("the decimal and bigint numbers the API answers", () => {
  function servedColumns(): Array<TextColumn> {
    return [
      ...columnsOfType(DECIMAL_TYPES),
      ...columnsOfType(BIGINT_TYPES),
    ].filter(isServedByTheApi);
  }

  test("are found, the reported one among them", () => {
    const labels: Array<string> = servedColumns().map(
      (textColumn: TextColumn): string => {
        return textColumn.label;
      },
    );

    expect(labels.length).toBeGreaterThanOrEqual(30);
    expect(labels).toContain(
      "StatusPageHistoryChartBarColorRule.uptimePercentGreaterThanOrEqualTo",
    );
    expect(labels).toContain("BillingInvoice.amount");
  });

  /*
   * A column whose model type is Decimal (the usage billing figures, which
   * only the dashboard reads) is answered as OneUptime's Decimal wrapper,
   * {_type: "Decimal", value}, which the dashboard reads back into a
   * Decimal. Every other one is a plain JSON number.
   */
  test("go out as JSON numbers, not as the text Postgres handed back", () => {
    const notNumbers: Array<string> = [];

    for (const textColumn of servedColumns()) {
      const isDecimal: boolean = DECIMAL_TYPES.includes(
        String(textColumn.column.type).toLowerCase(),
      );
      const text: string = isDecimal ? "99.65" : "1073741824";
      const expected: number = isDecimal ? 99.65 : 1073741824;

      const hydrated: unknown = hydrate(textColumn, text);
      const answered: JSONValue = apiJsonFor(textColumn, hydrated)[
        textColumn.column.propertyName
      ] as JSONValue;

      const expectedAnswer: JSONValue =
        hydrated instanceof Decimal
          ? { _type: "Decimal", value: String(expected) }
          : expected;

      if (JSON.stringify(answered) !== JSON.stringify(expectedAnswer)) {
        notNumbers.push(
          `${textColumn.label}: answered ${JSON.stringify(answered)}`,
        );
      }
    }

    expect(notNumbers).toEqual([]);
  });

  test("only the usage billing figures are answered as Decimal wrappers, and the published reference has neither", () => {
    const wrapped: Array<TextColumn> = servedColumns().filter(
      (textColumn: TextColumn): boolean => {
        return hydrate(textColumn, "1") instanceof Decimal;
      },
    );

    expect(
      wrapped
        .map((textColumn: TextColumn): string => {
          return textColumn.label;
        })
        .sort(),
    ).toEqual([
      "TelemetryUsageBilling.dataIngestedInGB",
      "TelemetryUsageBilling.totalCostInUSD",
    ]);
    expect(wrapped.filter(isInTheOpenApiSpec)).toEqual([]);
  });

  test("are numbers in the OpenAPI spec the API reference and the Terraform provider are generated from", () => {
    const notNumbers: Array<string> = [];
    const checked: Array<string> = [];

    for (const textColumn of servedColumns().filter(isInTheOpenApiSpec)) {
      for (const getSchema of [
        ModelSchema.getModelSchema.bind(ModelSchema),
        ModelSchema.getReadModelSchema.bind(ModelSchema),
      ]) {
        const property: JSONObject | undefined = openApiPropertyOf(
          textColumn,
          getSchema,
        );

        if (!property || property["type"] !== "number") {
          notNumbers.push(
            `${textColumn.label}: ${JSON.stringify(property?.["type"])}`,
          );
        }
      }

      checked.push(textColumn.label);
    }

    expect(notNumbers).toEqual([]);
    expect(checked).toContain(
      "StatusPageHistoryChartBarColorRule.uptimePercentGreaterThanOrEqualTo",
    );
    // Not in the published reference: the dashboard reads it.
    expect(checked).not.toContain("BillingInvoice.amount");
  });
});

describe("the two decimal columns that had no transformer", () => {
  function textColumn(
    modelType: new () => BaseModel,
    propertyName: string,
  ): TextColumn {
    const entity: EntityMetadata = dataSource.getMetadata(modelType);
    const column: ColumnMetadata | undefined =
      entity.findColumnWithPropertyName(propertyName);

    if (!column) {
      throw new Error(`${entity.tableName}.${propertyName} has no column`);
    }

    return {
      label: `${entity.tableName}.${propertyName}`,
      entity,
      column,
      modelType,
    };
  }

  test("a status page bar color rule's uptime percent is answered as the number it was written as", () => {
    const uptime: TextColumn = textColumn(
      StatusPageHistoryChartBarColorRule,
      "uptimePercentGreaterThanOrEqualTo",
    );

    // The reporter's rule, as Postgres hands it back: "100".
    expect(apiJsonFor(uptime, hydrate(uptime, "100"))).toEqual({
      uptimePercentGreaterThanOrEqualTo: 100,
    });
    expect(apiJsonFor(uptime, hydrate(uptime, "99.65"))).toEqual({
      uptimePercentGreaterThanOrEqualTo: 99.65,
    });
    // As the dashboard's form wrote it.
    expect(apiJsonFor(uptime, hydrate(uptime, "99.00"))).toEqual({
      uptimePercentGreaterThanOrEqualTo: 99,
    });
  });

  test("an invoice's amount is answered as a number", () => {
    const amount: TextColumn = textColumn(BillingInvoice, "amount");

    expect(apiJsonFor(amount, hydrate(amount, "2900"))).toEqual({
      amount: 2900,
    });
  });
});
