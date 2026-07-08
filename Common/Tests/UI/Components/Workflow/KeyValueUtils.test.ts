import {
  KeyValueRow,
  parseKeyValue,
  serializeKeyValue,
} from "../../../../UI/Components/Workflow/KeyValueUtils";
import { describe, expect, test } from "@jest/globals";

describe("KeyValueUtils.parseKeyValue", () => {
  test("empty value parses to no rows", () => {
    expect(parseKeyValue("")).toEqual([]);
    expect(parseKeyValue("   ")).toEqual([]);
  });

  test("a flat object parses to rows", () => {
    expect(
      parseKeyValue('{"Authorization":"Bearer x","Accept":"application/json"}'),
    ).toEqual([
      { key: "Authorization", value: "Bearer x" },
      { key: "Accept", value: "application/json" },
    ]);
  });

  test("keeps a {{ token }} inside a value verbatim", () => {
    expect(
      parseKeyValue('{"Authorization":"Bearer {{local.variables.token}}"}'),
    ).toEqual([
      { key: "Authorization", value: "Bearer {{local.variables.token}}" },
    ]);
  });

  test("coerces non-string scalar values to strings", () => {
    expect(parseKeyValue('{"Retries":3,"Enabled":true}')).toEqual([
      { key: "Retries", value: "3" },
      { key: "Enabled", value: "true" },
    ]);
  });

  test("returns null for invalid JSON, arrays, or nested objects", () => {
    expect(parseKeyValue("{not json")).toBeNull();
    expect(parseKeyValue('["a","b"]')).toBeNull();
    expect(parseKeyValue('{"nested":{"a":1}}')).toBeNull();
  });
});

describe("KeyValueUtils.serializeKeyValue", () => {
  test("serializes rows to a JSON object string", () => {
    const rows: Array<KeyValueRow> = [
      { key: "Authorization", value: "Bearer x" },
      { key: "Accept", value: "application/json" },
    ];
    expect(JSON.parse(serializeKeyValue(rows))).toEqual({
      Authorization: "Bearer x",
      Accept: "application/json",
    });
  });

  test("drops rows with an empty key", () => {
    const rows: Array<KeyValueRow> = [
      { key: "", value: "ignored" },
      { key: "Accept", value: "application/json" },
    ];
    expect(JSON.parse(serializeKeyValue(rows))).toEqual({
      Accept: "application/json",
    });
  });

  test("serializes to an empty string when there are no real entries", () => {
    expect(serializeKeyValue([])).toBe("");
    expect(serializeKeyValue([{ key: "  ", value: "x" }])).toBe("");
  });

  test("round-trips a flat object to the same parsed value", () => {
    const original: string = '{"A":"1","B":"two"}';
    const rows: Array<KeyValueRow> | null = parseKeyValue(original);
    expect(rows).not.toBeNull();
    expect(JSON.parse(serializeKeyValue(rows!))).toEqual(JSON.parse(original));
  });
});
