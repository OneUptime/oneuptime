import {
  QueryFilterRow,
  parseQuery,
  serializeQuery,
} from "../../../../UI/Components/Workflow/QueryFilterUtils";
import { describe, expect, test } from "@jest/globals";

describe("QueryFilterUtils.parseQuery", () => {
  test("empty value parses to no rows", () => {
    expect(parseQuery("")).toEqual([]);
  });

  test("infers the type of each equality value", () => {
    expect(parseQuery('{"name":"open","count":5,"active":true}')).toEqual([
      { field: "name", type: "text", value: "open" },
      { field: "count", type: "number", value: "5" },
      { field: "active", type: "boolean", value: "true" },
    ]);
  });

  test("returns null for operator objects, arrays, or invalid JSON", () => {
    expect(
      parseQuery('{"createdAt":{"_type":"GreaterThan","value":1}}'),
    ).toBeNull();
    expect(parseQuery('["a"]')).toBeNull();
    expect(parseQuery("{bad")).toBeNull();
  });
});

describe("QueryFilterUtils.serializeQuery", () => {
  test("keeps the JSON type of each value", () => {
    const rows: Array<QueryFilterRow> = [
      { field: "name", type: "text", value: "open" },
      { field: "count", type: "number", value: "5" },
      { field: "active", type: "boolean", value: "true" },
    ];
    const parsed: Record<string, unknown> = JSON.parse(serializeQuery(rows));
    expect(parsed).toEqual({ name: "open", count: 5, active: true });
    // Number stays a number, boolean stays a boolean.
    expect(typeof (parsed as { count: unknown }).count).toBe("number");
    expect(typeof (parsed as { active: unknown }).active).toBe("boolean");
  });

  test("drops rows with an empty field and serializes empty to ''", () => {
    expect(
      JSON.parse(
        serializeQuery([
          { field: "", type: "text", value: "x" },
          { field: "name", type: "text", value: "y" },
        ]),
      ),
    ).toEqual({ name: "y" });
    expect(serializeQuery([])).toBe("");
  });

  test("false / non-'true' boolean values serialize to false", () => {
    expect(
      JSON.parse(
        serializeQuery([{ field: "a", type: "boolean", value: "false" }]),
      ),
    ).toEqual({ a: false });
  });

  test("keeps a non-numeric string for a number-typed row (never writes NaN)", () => {
    expect(
      JSON.parse(
        serializeQuery([{ field: "n", type: "number", value: "abc" }]),
      ),
    ).toEqual({ n: "abc" });
  });

  test("round-trips a flat equality query to the same parsed value", () => {
    const original: string = '{"state":"open","count":3}';
    const rows: Array<QueryFilterRow> | null = parseQuery(original);
    expect(rows).not.toBeNull();
    expect(JSON.parse(serializeQuery(rows!))).toEqual(JSON.parse(original));
  });
});
