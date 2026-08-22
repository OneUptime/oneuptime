import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import JSONFunctions from "../../../../Types/JSONFunctions";
import { JSONObject } from "../../../../Types/JSON";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  buildDictionaryValue,
  detectOperatorFromValue,
} from "../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { describe, expect, test } from "@jest/globals";

/*
 * A numeric attribute filter travels a long way before it becomes SQL:
 * the user types a threshold into the Dictionary filter form, that string
 * is turned into a comparison wrapper by buildDictionaryValue, the wrapper
 * is serialized over the API, the server deserializes it, and
 * StatementGenerator finally binds it as a ClickHouse query parameter.
 *
 * Every hop in that chain has to keep the value fractional. The form
 * builds the wrapper with `Number(input)`, so `0.5` is a threshold a user
 * can genuinely produce — and the map-attribute predicate already casts
 * the stored value with toFloat64OrNull, so only the bound parameter type
 * ever constrained it. These tests walk the whole chain rather than any
 * single hop, because a regression at any one of them silently reduces to
 * "the query fails at runtime" for the user.
 */

class AttributeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<attribute-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        new AnalyticsTableColumn({
          key: "_id",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.ObjectID,
        }),
        new AnalyticsTableColumn({
          key: "attributes",
          title: "<title>",
          description: "<description>",
          required: true,
          defaultValue: {},
          type: TableColumnType.MapStringString,
        }),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

function whereStatementFor(value: unknown): Statement {
  const generator: StatementGenerator<AttributeModel> =
    new StatementGenerator<AttributeModel>({
      modelType: AttributeModel,
      database: ClickhouseAppInstance,
    });

  return generator.toWhereStatement({
    attributes: { duration: value },
  } as any);
}

/**
 * Push a value through the JSON round trip the API boundary performs, so
 * the test exercises the deserialized wrapper the server actually sees
 * rather than the instance the form happened to build in-process.
 */
function overTheWire(value: DictionaryEntryValue): unknown {
  const serialized: JSONObject = JSON.parse(
    JSON.stringify({ value: value }),
  ) as JSONObject;

  return JSONFunctions.deserializeValue(serialized["value"] as JSONObject);
}

describe("fractional attribute thresholds, form to SQL", () => {
  const operatorCases: Array<{
    operator: DictionaryFilterOperator;
    sqlOperator: string;
    wrapperType: unknown;
  }> = [
    {
      operator: DictionaryFilterOperator.GreaterThan,
      sqlOperator: ">",
      wrapperType: GreaterThan,
    },
    {
      operator: DictionaryFilterOperator.GreaterThanOrEqual,
      sqlOperator: ">=",
      wrapperType: GreaterThanOrEqual,
    },
    {
      operator: DictionaryFilterOperator.LessThan,
      sqlOperator: "<",
      wrapperType: LessThan,
    },
    {
      operator: DictionaryFilterOperator.LessThanOrEqual,
      sqlOperator: "<=",
      wrapperType: LessThanOrEqual,
    },
  ];

  test.each(operatorCases)(
    "$operator: a typed 0.5 reaches ClickHouse as a Double parameter",
    ({
      operator,
      sqlOperator,
      wrapperType,
    }: {
      operator: DictionaryFilterOperator;
      sqlOperator: string;
      wrapperType: unknown;
    }) => {
      // 1. What the filter form builds from the user's keystrokes.
      const built: DictionaryEntryValue = buildDictionaryValue({
        operator: operator,
        rawValue: "0.5",
      });

      expect(built).toBeInstanceOf(wrapperType as never);
      expect((built as GreaterThan<number>).value).toBe(0.5);

      // 2. What the server receives after the API round trip.
      const received: unknown = overTheWire(built);

      expect(received).toBeInstanceOf(wrapperType as never);
      expect((received as GreaterThan<number>).value).toBe(0.5);

      // 3. What ClickHouse is finally asked to run.
      const statement: Statement = whereStatementFor(received);

      expect(statement.query).toBe(
        `AND toFloat64OrNull({p0:Identifier}[{p1:String}]) ${sqlOperator} {p2:Double}`,
      );
      expect(statement.query_params).toStrictEqual({
        p0: "attributes",
        p1: "duration",
        p2: 0.5,
      });
    },
  );

  test("the threshold is never inlined into the SQL text", () => {
    const statement: Statement = whereStatementFor(
      overTheWire(
        buildDictionaryValue({
          operator: DictionaryFilterOperator.GreaterThan,
          rawValue: "0.5",
        }),
      ),
    );

    expect(statement.query).not.toContain("0.5");
    expect(statement.query).not.toContain("duration");
  });

  test("a saved fractional filter reopens in the form with its value intact", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.GreaterThanOrEqual,
      rawValue: "0.5",
    });

    /*
     * Saved views persist the serialized wrapper; reopening the filter row
     * has to recover both the operator and the fractional text, otherwise
     * the user sees their threshold silently rewritten.
     */
    const reopened: {
      operator: DictionaryFilterOperator;
      rawValue: string;
    } = detectOperatorFromValue(
      JSON.parse(JSON.stringify(built)) as JSONObject,
    );

    expect(reopened.operator).toBe(DictionaryFilterOperator.GreaterThanOrEqual);
    expect(reopened.rawValue).toBe("0.5");
  });

  test.each([
    ["0.5", 0.5],
    ["0.001", 0.001],
    ["-12.75", -12.75],
    ["3.14159265", 3.14159265],
    ["1024", 1024],
    ["3000000000", 3000000000],
  ])(
    "a typed %s binds as %p without truncation",
    (typed: string, expected: number) => {
      const statement: Statement = whereStatementFor(
        overTheWire(
          buildDictionaryValue({
            operator: DictionaryFilterOperator.GreaterThan,
            rawValue: typed,
          }),
        ),
      );

      expect(statement.query).toContain("{p2:Double}");
      expect(statement.query_params["p2"]).toBe(expected);
    },
  );
});
