import { describe, expect, test } from "@jest/globals";
import FieldCollector, {
  CollectedField,
  DEFAULT_FIELD_COLLECTOR_LIMITS,
} from "../../../Utils/DataSecurity/FieldCollector";

/*
 * RECORDS, TURNED INTO FIELDS AND THEIR VALUES.
 *
 * Every leaf lands under the dotted path that leads to it, array positions
 * folded into "[]", and everything is bounded: fields, values per field,
 * depth and the length of a value.
 */

function fieldsOf(collector: FieldCollector): Record<string, Array<unknown>> {
  const fields: Record<string, Array<unknown>> = {};

  for (const field of collector.getFields()) {
    fields[field.path] = field.values;
  }

  return fields;
}

describe("FieldCollector", () => {
  test("gathers each leaf under its dotted path, arrays folded into []", () => {
    const collector: FieldCollector = new FieldCollector();
    const created: Date = new Date(Date.UTC(2026, 9, 27));

    collector.addRecord({
      user: {
        email: "jane@acme.io",
        tags: ["vip", "beta"],
        orders: [{ id: 1, card: "4242" }, { id: 2 }],
      },
      created,
      deleted: null,
      active: true,
    });
    collector.addRecord({
      user: { email: "john@acme.io", orders: [{ id: 3 }] },
    });

    expect(collector.records).toBe(2);
    expect(fieldsOf(collector)).toEqual({
      "user.email": ["jane@acme.io", "john@acme.io"],
      "user.tags[]": ["vip", "beta"],
      "user.orders[].id": [1, 2, 3],
      "user.orders[].card": ["4242"],
      created: [created],
      deleted: [null],
      active: [true],
    });
  });

  test("names a record that is a value, or an array of them, by itself", () => {
    const collector: FieldCollector = new FieldCollector();

    collector.addRecord("a line of a log");
    collector.addRecord([1, 2]);
    collector.addRecord({ deep: { a: 1 } }, "row");
    collector.addValue("flat.column", "v");

    expect(fieldsOf(collector)).toEqual({
      value: ["a line of a log"],
      "[]": [1, 2],
      "row.deep.a": [1],
      "flat.column": ["v"],
    });
  });

  test("keeps the order fields were first seen in", () => {
    const collector: FieldCollector = new FieldCollector();

    collector.addRecord({ b: 1, a: 1 });
    collector.addRecord({ c: 1, a: 2 });

    expect(
      collector.getFields().map((field: CollectedField) => {
        return field.path;
      }),
    ).toEqual(["b", "a", "c"]);
  });

  test("has the default limits a scan relies on", () => {
    expect(DEFAULT_FIELD_COLLECTOR_LIMITS).toEqual({
      maxFields: 500,
      maxValuesPerField: 200,
      maxDepth: 12,
      maxValueLength: 16_384,
    });
  });

  test("keeps at most maxFields fields, and values of the ones it keeps", () => {
    const collector: FieldCollector = new FieldCollector({ maxFields: 2 });

    collector.addRecord({ a: 1, b: 2, c: 3 });
    collector.addRecord({ a: 4, d: 5 });

    expect(fieldsOf(collector)).toEqual({ a: [1, 4], b: [2] });
  });

  test("keeps at most maxValuesPerField values of a field, and items of an array", () => {
    const collector: FieldCollector = new FieldCollector({
      maxValuesPerField: 2,
    });

    collector.addRecord({ a: "x", list: [1, 2, 3, 4] });
    collector.addRecord({ a: "y" });
    collector.addRecord({ a: "z" });

    expect(fieldsOf(collector)).toEqual({ a: ["x", "y"], "list[]": [1, 2] });
  });

  test("follows a record no deeper than maxDepth", () => {
    const collector: FieldCollector = new FieldCollector({ maxDepth: 2 });

    collector.addRecord({ top: 1, a: { b: 2, c: { d: 3 } }, list: [[1], 2] });

    expect(fieldsOf(collector)).toEqual({
      top: [1],
      "a.b": [2],
      "list[]": [2],
    });
  });

  test("cuts a string to maxValueLength, and leaves other values as they are", () => {
    const collector: FieldCollector = new FieldCollector({ maxValueLength: 5 });

    collector.addRecord({ text: "1234567", number: 1234567 });
    collector.addValue("flat", "abcdefgh");

    expect(fieldsOf(collector)).toEqual({
      text: ["12345"],
      number: [1234567],
      flat: ["abcde"],
    });
  });

  test("stays within its bounds on a record wider and deeper than any scan should follow", () => {
    const wide: Record<string, unknown> = {};

    for (let index: number = 0; index < 5_000; index++) {
      wide[`field${index}`] = index;
    }

    let deep: Record<string, unknown> = { leaf: "bottom" };

    for (let level: number = 0; level < 10_000; level++) {
      deep = { next: deep };
    }

    const collector: FieldCollector = new FieldCollector();

    collector.addRecord(wide);
    collector.addRecord(deep);

    expect(collector.getFields()).toHaveLength(
      DEFAULT_FIELD_COLLECTOR_LIMITS.maxFields,
    );
  });
});
