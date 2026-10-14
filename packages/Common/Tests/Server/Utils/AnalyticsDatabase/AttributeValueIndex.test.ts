import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import Log from "../../../../Models/AnalyticsModels/Log";
import MutableMetric from "../../../../Models/AnalyticsModels/MutableMetric";
import Span from "../../../../Models/AnalyticsModels/Span";
import {
  ATTRIBUTE_VALUES_INDEX_NAME,
  attributeValuesSkipIndex,
} from "../../../../Types/AnalyticsDatabase/AttributeValueIndex";
import AnalyticsTableColumn, {
  SkipIndex,
  SkipIndexExpression,
  SkipIndexType,
} from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * idx_attribute_values (#4706): a bloom filter over `mapValues(attributes)`
 * on LogItemV3 and SpanItemV3, so a search for one attribute value skips the
 * granules that cannot hold it. This suite pins the definition, how the
 * schema generator writes it - the same in CREATE TABLE (a fresh install)
 * and in ADD INDEX (boot schema-sync on an existing one) - and which tables
 * carry it. AttributeValueIndexClickhouse (App) shows what ClickHouse does
 * with it.
 */

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const INDEX_DEFINITION: string =
  "idx_attribute_values mapValues(attributes) TYPE bloom_filter(0.01) GRANULARITY 1";

type ModelType = { new (): AnalyticsBaseModel };

function generatorFor(
  modelType: ModelType,
): StatementGenerator<AnalyticsBaseModel> {
  return new StatementGenerator<AnalyticsBaseModel>({
    modelType: modelType,
    database: ClickhouseAppInstance,
  });
}

function attributesColumn(model: AnalyticsBaseModel): AnalyticsTableColumn {
  const column: AnalyticsTableColumn | null =
    model.getTableColumn("attributes");

  if (!column) {
    throw new Error(`${model.tableName} has no attributes column`);
  }

  return column;
}

// A statement's SQL with its {pN:Identifier} names put back in place.
function sqlOf(statement: Statement): string {
  let sql: string = statement.query;

  for (const [name, value] of Object.entries(statement.query_params)) {
    sql = sql.split(`{${name}:Identifier}`).join(String(value));
  }

  return sql;
}

function column(data: {
  key: string;
  type: TableColumnType;
  required: boolean;
  skipIndex?: SkipIndex | undefined;
}): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: data.key,
    title: data.key,
    description: data.key,
    required: data.required,
    type: data.type,
    skipIndex: data.skipIndex,
  });
}

describe("idx_attribute_values", () => {
  const originalCluster: string | undefined = process.env[CLUSTER_ENV_KEY];

  afterEach(() => {
    if (originalCluster === undefined) {
      delete process.env[CLUSTER_ENV_KEY];
    } else {
      process.env[CLUSTER_ENV_KEY] = originalCluster;
    }
  });

  describe("the definition", () => {
    test("is a bloom filter over the attribute values, one filter per granule", () => {
      expect(attributeValuesSkipIndex()).toEqual({
        name: "idx_attribute_values",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
        expression: SkipIndexExpression.MapValues,
      });
      expect(ATTRIBUTE_VALUES_INDEX_NAME).toBe("idx_attribute_values");
    });

    test("every model gets its own object, so one schema can never change another's", () => {
      const first: SkipIndex = attributeValuesSkipIndex();
      const second: SkipIndex = attributeValuesSkipIndex();

      expect(first).not.toBe(second);
      expect(first.params).not.toBe(second.params);
      expect(attributesColumn(new Log()).skipIndex).not.toBe(
        attributesColumn(new Span()).skipIndex,
      );
    });
  });

  describe("which tables carry it", () => {
    test.each([
      ["Log", Log, "LogItemV3"],
      ["Span", Span, "SpanItemV3"],
    ])(
      "%s declares it on its attributes column",
      (_label: string, modelType: ModelType, tableName: string) => {
        const model: AnalyticsBaseModel = new modelType();

        expect(model.tableName).toBe(tableName);
        expect(attributesColumn(model).type).toBe(
          TableColumnType.MapStringString,
        );
        expect(attributesColumn(model).skipIndex).toEqual(
          attributeValuesSkipIndex(),
        );
      },
    );

    test("no other table does: each new one is a decision (AttributeValueIndex says why these two)", () => {
      const declaring: Array<string> = [...AnalyticsModels, MutableMetric]
        .map((modelType: ModelType): AnalyticsBaseModel => {
          return new modelType();
        })
        .filter((model: AnalyticsBaseModel): boolean => {
          return model.tableColumns.some(
            (tableColumn: AnalyticsTableColumn): boolean => {
              return (
                tableColumn.skipIndex?.name === ATTRIBUTE_VALUES_INDEX_NAME ||
                tableColumn.skipIndex?.expression ===
                  SkipIndexExpression.MapValues
              );
            },
          );
        })
        .map((model: AnalyticsBaseModel): string => {
          return model.tableName;
        })
        .sort();

      expect(declaring).toEqual(["LogItemV3", "SpanItemV3"]);
    });

    test("the key index the value index sits beside is still there", () => {
      for (const modelType of [Log, Span]) {
        const keys: AnalyticsTableColumn | null = new modelType().getTableColumn(
          "attributeKeys",
        );

        expect(keys?.skipIndex?.name).toBe("idx_attribute_keys");
      }
    });
  });

  describe("how the schema generator writes it", () => {
    test.each([
      ["Log", Log, "LogItemV3Local"],
      ["Span", Span, "SpanItemV3Local"],
    ])(
      "a fresh %s table is created with it",
      (_label: string, modelType: ModelType, localTable: string) => {
        delete process.env[CLUSTER_ENV_KEY];

        const create: string = sqlOf(
          generatorFor(modelType).toTableCreateStatement(),
        );

        expect(create).toContain(`CREATE TABLE IF NOT EXISTS oneuptime.${localTable}`);
        expect(create).toContain(`, INDEX ${INDEX_DEFINITION}`);
      },
    );

    test.each([
      ["Log", Log, "LogItemV3Local"],
      ["Span", Span, "SpanItemV3Local"],
    ])(
      "an existing %s table gets the same definition, ON CLUSTER and only if missing",
      (_label: string, modelType: ModelType, localTable: string) => {
        delete process.env[CLUSTER_ENV_KEY];

        const model: AnalyticsBaseModel = new modelType();
        const statement: Statement | null = generatorFor(
          modelType,
        ).toAddSkipIndexStatement(attributesColumn(model));

        expect(statement).not.toBeNull();
        expect(sqlOf(statement!)).toBe(
          `ALTER TABLE oneuptime.${localTable} ON CLUSTER 'oneuptime' ADD INDEX IF NOT EXISTS ${INDEX_DEFINITION}`,
        );
      },
    );

    test("CREATE TABLE and ADD INDEX share one definition, so fresh and upgraded installs match", () => {
      const model: Log = new Log();
      const definition: string = StatementGenerator.toSkipIndexDefinition(
        attributesColumn(model),
      );

      expect(definition).toBe(INDEX_DEFINITION);
      expect(sqlOf(generatorFor(Log).toTableCreateStatement())).toContain(
        `INDEX ${definition}`,
      );
      expect(
        sqlOf(generatorFor(Log).toAddSkipIndexStatement(attributesColumn(model))!),
      ).toContain(`ADD INDEX IF NOT EXISTS ${definition}`);
    });

    test("the cluster name follows CLICKHOUSE_CLUSTER_NAME like every other schema ALTER", () => {
      process.env[CLUSTER_ENV_KEY] = "ext_cluster";

      expect(
        sqlOf(
          generatorFor(Log).toAddSkipIndexStatement(
            attributesColumn(new Log()),
          )!,
        ),
      ).toContain("LogItemV3Local ON CLUSTER 'ext_cluster' ADD INDEX");
    });
  });

  describe("StatementGenerator.toSkipIndexExpression", () => {
    test("mapValues() of a Map(String, String) column", () => {
      expect(
        StatementGenerator.toSkipIndexExpression(
          column({
            key: "labels",
            type: TableColumnType.MapStringString,
            required: true,
            skipIndex: { ...attributeValuesSkipIndex(), name: "idx_labels" },
          }),
        ),
      ).toBe("mapValues(labels)");
    });

    test("refuses mapValues() of a column that is not a map", () => {
      expect(() => {
        return StatementGenerator.toSkipIndexExpression(
          column({
            key: "body",
            type: TableColumnType.Text,
            required: true,
            skipIndex: attributeValuesSkipIndex(),
          }),
        );
      }).toThrow(BadDataException);
    });

    test("refuses an expression it does not know", () => {
      expect(() => {
        return StatementGenerator.toSkipIndexExpression(
          column({
            key: "attributes",
            type: TableColumnType.MapStringString,
            required: true,
            skipIndex: {
              ...attributeValuesSkipIndex(),
              expression: "lower" as unknown as SkipIndexExpression,
            },
          }),
        );
      }).toThrow(BadDataException);
    });

    test("refuses a column without a skip index", () => {
      expect(() => {
        return StatementGenerator.toSkipIndexExpression(
          column({
            key: "attributes",
            type: TableColumnType.MapStringString,
            required: true,
          }),
        );
      }).toThrow(BadDataException);
    });

    test("without an expression: the column itself, as before", () => {
      expect(
        StatementGenerator.toSkipIndexExpression(
          column({
            key: "traceId",
            type: TableColumnType.Text,
            required: false,
            skipIndex: {
              name: "idx_trace_id",
              type: SkipIndexType.BloomFilter,
              params: [0.01],
              granularity: 1,
            },
          }),
        ),
      ).toBe("traceId");
    });

    test.each([[SkipIndexType.TokenBF], [SkipIndexType.NgramBF]])(
      "%s over a Nullable column is still wrapped in assumeNotNull()",
      (type: SkipIndexType) => {
        expect(
          StatementGenerator.toSkipIndexExpression(
            column({
              key: "body",
              type: TableColumnType.Text,
              required: false,
              skipIndex: {
                name: "idx_body",
                type: type,
                params: [10240, 3, 0],
                granularity: 4,
              },
            }),
          ),
        ).toBe("assumeNotNull(body)");
      },
    );

    test("the body index of a fresh Log table is unchanged", () => {
      expect(sqlOf(generatorFor(Log).toTableCreateStatement())).toContain(
        "INDEX idx_body assumeNotNull(body) TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4",
      );
    });
  });
});
