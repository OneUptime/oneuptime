import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as RawOperator;
}

const CRITERIA_ALIAS: string = '"StatusPageMonitorRule"."criteria"';

describe("QueryHelper.jsonArrayObjectsContainAnyArrayValue", () => {
  it("renders a guarded jsonb membership predicate", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsContainAnyArrayValue({
        arrayKey: "filters",
        discriminatorKey: "field",
        discriminatorValue: "monitorLabels",
        valueArrayKey: "value",
        values: [
          new ObjectID("11111111-1111-4111-8111-111111111111"),
          "22222222-2222-4222-8222-222222222222",
        ],
      }),
    );

    const sql: string = operator.getSql(CRITERIA_ALIAS);

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");
    expect(sql).toContain("EXISTS (SELECT 1 FROM jsonb_array_elements(");
    expect(sql).toContain("jsonb_array_elements_text(");
    expect(sql).toContain("jsonb_typeof(");
    expect(sql).toContain("ELSE '[]'::jsonb END");
    expect(sql).toContain("= ANY(CAST(:");
    expect(sql).toContain("AS text[]))");
  });

  it("binds every document key, discriminator, and value instead of interpolating user data", () => {
    const maliciousValue: string =
      "11111111-1111-4111-8111-111111111111'); DROP TABLE Label; --";
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsContainAnyArrayValue({
        arrayKey: "filters' unsafe",
        discriminatorKey: "field' unsafe",
        discriminatorValue: "monitorLabels' unsafe",
        valueArrayKey: "value' unsafe",
        values: [maliciousValue],
      }),
    );

    const sql: string = operator.getSql(CRITERIA_ALIAS);
    const parameters: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    );

    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(5);
    expect(parameters).toContain("filters' unsafe");
    expect(parameters).toContain("field' unsafe");
    expect(parameters).toContain("monitorLabels' unsafe");
    expect(parameters).toContain("value' unsafe");
    expect(parameters).toContainEqual([maliciousValue]);
    expect(sql).not.toContain("unsafe");
    expect(sql).not.toContain("DROP TABLE");
  });

  it("deduplicates ids before binding them as one text-array parameter", () => {
    const id: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsContainAnyArrayValue({
        arrayKey: "filters",
        discriminatorKey: "field",
        discriminatorValue: "monitorLabels",
        valueArrayKey: "value",
        values: [id, id.toString(), id],
      }),
    );

    const boundArrays: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    ).filter((value: unknown): boolean => {
      return Array.isArray(value);
    });

    expect(boundArrays).toEqual([[id.toString()]]);
  });

  it("returns an always-false predicate for an empty value list", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsContainAnyArrayValue({
        arrayKey: "filters",
        discriminatorKey: "field",
        discriminatorValue: "monitorLabels",
        valueArrayKey: "value",
        values: [],
      }),
    );

    expect(operator.getSql(CRITERIA_ALIAS)).toBe("TRUE = FALSE");
    expect(operator.objectLiteralParameters).toEqual({});
  });

  it("rejects more unique values than a bounded database read can produce", () => {
    const values: Array<string> = Array.from(
      { length: LIMIT_MAX + 1 },
      (_value: unknown, index: number): string => {
        return `label-${index}`;
      },
    );

    expect(() => {
      QueryHelper.jsonArrayObjectsContainAnyArrayValue({
        arrayKey: "filters",
        discriminatorKey: "field",
        discriminatorValue: "monitorLabels",
        valueArrayKey: "value",
        values: values,
      });
    }).toThrow(`cannot bind more than ${LIMIT_MAX} unique values`);
  });
});
