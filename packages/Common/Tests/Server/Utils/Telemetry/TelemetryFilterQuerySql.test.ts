import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  buildTelemetryFilterCondition,
  getFilterRowColumns,
  toLikePattern,
} from "../../../../Server/Utils/Telemetry/TelemetryFilterQuerySql";
import { TelemetryFieldSignal } from "../../../../Types/Telemetry/TelemetryFieldReaders";
import {
  TelemetryFilterExpression,
  parseTelemetryFilterQuery,
} from "../../../../Utils/Telemetry/TelemetryFilterQuery";

/*
 * A DROP FILTER'S QUERY AS A CLICKHOUSE CONDITION (#10436).
 *
 * Each part of the query is read the way ingest reads it (the real-server
 * test, DropFilterCountClickhouseIntegration, counts rows both ways); this
 * holds the statement's shape: every value and key bound as a parameter,
 * a column only by the table's own name, and each operator as the engine
 * means it.
 */

function conditionOf(
  query: string,
  signal: TelemetryFieldSignal = "log",
): Statement {
  const expr: TelemetryFilterExpression | null =
    parseTelemetryFilterQuery(query);

  expect(expr).not.toBeNull();

  return buildTelemetryFilterCondition({
    signal,
    expr: expr as TelemetryFilterExpression,
  });
}

function paramsOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the row's own columns", () => {
  test("are the table's, less the stamps only a stored record gets", () => {
    const columns: Array<string> = Array.from(
      getFilterRowColumns("log").keys(),
    );

    expect(columns).toEqual(
      expect.arrayContaining(["severityText", "body", "primaryEntityId"]),
    );
    expect(columns).not.toEqual(expect.arrayContaining(["_id"]));
    expect(columns).not.toContain("createdAt");
    expect(columns).not.toContain("retentionDate");
    expect(Array.from(getFilterRowColumns("trace").keys())).toEqual(
      expect.arrayContaining(["name", "kind", "statusCode", "isEntrySpan"]),
    );
  });
});

describe("each operator, as the engine means it", () => {
  test("= and != compare the text exactly, the value bound", () => {
    const equals: Statement = conditionOf("severityText = 'Debug'");

    expect(equals.query).toBe("(toString(severityText) = {p0:String})");
    expect(paramsOf(equals)).toEqual(["Debug"]);
    expect(conditionOf("severityText != 'Debug'").query).toBe(
      "(toString(severityText) != {p0:String})",
    );
  });

  test("LIKE without % holds the text anywhere, in any case", () => {
    const statement: Statement = conditionOf("severityText LIKE 'deb'");

    expect(statement.query).toBe(
      "(positionCaseInsensitiveUTF8(toString(severityText), {p0:String}) > 0)",
    );
    expect(paramsOf(statement)).toEqual(["deb"]);
  });

  test("LIKE with % is the whole value against the pattern, for RE2, every other character itself", () => {
    expect(conditionOf("severityText LIKE 'D%'").query).toBe(
      "match(toString(severityText), {p0:String})",
    );
    expect(toLikePattern("GET /api/%")).toBe("(?i)^GET /api/.*$");
    expect(toLikePattern("a_b%")).toBe("(?i)^a.b.*$");
    expect(toLikePattern("(1+1).%")).toBe("(?i)^\\(1\\+1\\)\\..*$");
  });

  test("IN is one of the list, exactly; an empty list matches nothing", () => {
    const statement: Statement = conditionOf(
      "severityText IN ('Debug', 'Trace')",
    );

    expect(statement.query).toBe(
      "has({p0:Array(String)}, toString(severityText))",
    );
    expect(paramsOf(statement)).toEqual([["Debug", "Trace"]]);
    expect(conditionOf("severityText IN ()").query).toBe("0");
  });

  test("AND, OR and NOT group as written", () => {
    expect(
      conditionOf(
        "NOT (severityText = 'Debug' OR severityText = 'Trace') AND severityText LIKE 'x'",
      ).query,
    ).toBe(
      "((NOT ((toString(severityText) = {p0:String}) OR (toString(severityText) = {p1:String}))) AND (positionCaseInsensitiveUTF8(toString(severityText), {p2:String}) > 0))",
    );
  });

  test("a log's body can hold no value: then it is read as the attribute body, as the engine reads it", () => {
    expect(conditionOf("body LIKE 'x'").query).toBe(
      "(positionCaseInsensitiveUTF8(ifNull(toString(body), if(mapContains(attributes, {p0:String}), attributes[{p1:String}], attributes[{p2:String}])), {p3:String}) > 0)",
    );
  });
});

describe("fields", () => {
  test("attributes.<key> is its own key, else resource.<key>, the keys bound", () => {
    const statement: Statement = conditionOf("attributes.http.route = '/x'");

    expect(statement.query).toBe(
      "(if(mapContains(attributes, {p0:String}), attributes[{p1:String}], attributes[{p2:String}]) = {p3:String})",
    );
    expect(paramsOf(statement)).toEqual([
      "http.route",
      "http.route",
      "resource.http.route",
      "/x",
    ]);
  });

  test("a field the row has no column of is the attribute of that name", () => {
    expect(paramsOf(conditionOf("env = 'prod'"))).toEqual([
      "env",
      "env",
      "resource.env",
      "prod",
    ]);
  });

  test("a column that can hold no value is read as the attribute when it holds none", () => {
    // A span's name is Nullable: a NULL name reads as the attribute "name".
    expect(conditionOf("name = 'GET /'", "trace").query).toBe(
      "(ifNull(toString(name), if(mapContains(attributes, {p0:String}), attributes[{p1:String}], attributes[{p2:String}])) = {p3:String})",
    );
  });

  test("a list reads as its items joined by commas; the attributes map as an object", () => {
    expect(conditionOf("attributeKeys = 'a,b'").query).toBe(
      "(arrayStringConcat(attributeKeys, ',') = {p0:String})",
    );
    expect(conditionOf("attributes = 'x'").query).toBe(
      "('[object Object]' = {p0:String})",
    );
  });

  test("nothing a person writes reaches the SQL but as a parameter", () => {
    const statement: Statement = buildTelemetryFilterCondition({
      signal: "log",
      expr: {
        type: "or",
        left: {
          type: "comparison",
          field: "attributes.x']); DROP TABLE Log; --",
          operator: "=",
          value: "y",
        },
        right: {
          type: "comparison",
          field: "severityText",
          operator: "LIKE",
          value: "%' OR 1=1 --%",
        },
      } as TelemetryFilterExpression,
    });

    expect(statement.query).not.toContain("DROP TABLE");
    expect(statement.query).not.toContain("1=1");
    expect(paramsOf(statement)).toEqual(
      expect.arrayContaining(["x']); DROP TABLE Log; --"]),
    );
  });
});
