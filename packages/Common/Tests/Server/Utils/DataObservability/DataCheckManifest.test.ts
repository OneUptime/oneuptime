import { describe, expect, test } from "@jest/globals";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import {
  DataCheckAlertCondition,
  DataCheckType,
} from "../../../../Types/DataObservability/DataCheckType";
import { JSONObject } from "../../../../Types/JSON";
import { getCheckChanges } from "../../../../Server/Utils/DataObservability/DataCheckApply";
import {
  DataCheckManifest,
  MAX_CHECKS_PER_MANIFEST,
  readDataCheckManifest,
} from "../../../../Server/Utils/DataObservability/DataCheckManifest";

/*
 * Checks written down in a repository, read strictly: a key nobody knows is a
 * mistake to say out loud, not a check that silently does less than it says.
 */

describe("reading the file", () => {
  test("every field a check can say", () => {
    const manifest: DataCheckManifest = readDataCheckManifest(`
checks:
  - name: Orders have a customer
    table: public.orders
    database: Orders database
    type: Orphan Count
    column: customer_id
    references: public.customers.id
    every: 15
    alert: { when: Above, threshold: 0 }
    description: A delete that did not cascade.
  - name: Emails look right
    table: public.customers
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
    enabled: false
`);

    expect(manifest.errors).toEqual([]);
    expect(manifest.checks[0]).toEqual({
      name: "Orders have a customer",
      table: "public.orders",
      database: "Orders database",
      checkType: DataCheckType.OrphanCount,
      columnName: "customer_id",
      segmentColumn: null,
      acceptedValues: null,
      formatPreset: null,
      pattern: null,
      referenceTableKey: "public.customers",
      referenceColumnName: "id",
      customSql: null,
      samplePercent: null,
      intervalInMinutes: 15,
      alertCondition: DataCheckAlertCondition.Above,
      alertThreshold: 0,
      description: "A delete that did not cascade.",
      isEnabled: true,
    });
    expect(manifest.checks[1]?.formatPreset).toBe("Email");
    expect(manifest.checks[1]?.samplePercent).toBe(10);
    expect(manifest.checks[1]?.isEnabled).toBe(false);
    // Unset, it runs as often as a check by default.
    expect(manifest.checks[1]?.intervalInMinutes).toBe(60);
  });

  test("a key nobody knows is a mistake", () => {
    const { errors }: DataCheckManifest = readDataCheckManifest(`
checks:
  - name: A
    table: t
    type: Row Count
    colum: total
`);

    expect(errors).toEqual(['Check 1: there is no key named "colum".']);
  });

  test.each([
    ["name", "checks:\n  - table: t\n    type: Row Count", "needs a name"],
    ["table", "checks:\n  - name: A\n    type: Row Count", "needs a table"],
    ["type", "checks:\n  - name: A\n    table: t\n    type: Nope", '"type"'],
    [
      "format",
      "checks:\n  - name: A\n    table: t\n    type: Row Count\n    format: Nope",
      '"format"',
    ],
    [
      "accepted values",
      "checks:\n  - name: A\n    table: t\n    type: Invalid Percent\n    accepted_values: paid",
      '"accepted_values"',
    ],
    [
      "references",
      "checks:\n  - name: A\n    table: t\n    type: Orphan Count\n    references: customers",
      '"references"',
    ],
    [
      "alert",
      "checks:\n  - name: A\n    table: t\n    type: Row Count\n    alert: { when: Sometimes }",
      '"alert"',
    ],
  ])("a bad %s says so", (_: string, text: string, expected: string) => {
    const { errors, checks }: DataCheckManifest = readDataCheckManifest(text);

    expect(errors.join(" ")).toContain(expected);
    expect(checks).toEqual([]);
  });

  test("the same check twice is a mistake", () => {
    const { errors }: DataCheckManifest = readDataCheckManifest(`
checks:
  - { name: A, table: t, type: Row Count }
  - { name: A, table: t, type: Row Count }
`);

    expect(errors).toEqual(['"A" is on t twice.']);
  });

  test("a file that is not one says why", () => {
    expect(readDataCheckManifest("").errors[0]).toContain("empty");
    expect(readDataCheckManifest(null).errors[0]).toContain("empty");
    expect(readDataCheckManifest("a: [").errors[0]).toContain("not YAML");
    expect(readDataCheckManifest("checks: 1").errors[0]).toContain(
      'list named "checks"',
    );
  });

  test("a file can make nothing but plain values", () => {
    expect(
      readDataCheckManifest("checks: !!js/function 'function () {}'").errors[0],
    ).toContain("not YAML");
  });

  test("too many checks are refused", () => {
    expect(
      readDataCheckManifest(
        `checks:\n${"  - { name: A, table: t, type: Row Count }\n".repeat(
          MAX_CHECKS_PER_MANIFEST + 1,
        )}`,
      ).errors[0],
    ).toContain(String(MAX_CHECKS_PER_MANIFEST));
  });
});

describe("what differs between a check and the file", () => {
  function check(values: Partial<DataCheck>): DataCheck {
    return values as unknown as DataCheck;
  }

  test("nothing, for the same values, however they are stored", () => {
    expect(
      getCheckChanges(
        check({ intervalInMinutes: 60, columnName: "a", samplePercent: 10 }),
        {
          intervalInMinutes: 60,
          columnName: "a",
          samplePercent: 10,
          customSql: null,
        } as unknown as JSONObject,
      ),
    ).toEqual({});
  });

  test("only what changed", () => {
    expect(
      getCheckChanges(check({ intervalInMinutes: 60, columnName: "a" }), {
        intervalInMinutes: 15,
        columnName: "a",
      }),
    ).toEqual({ intervalInMinutes: 15 });
  });

  test("a value the file removed", () => {
    expect(
      getCheckChanges(check({ columnName: "a" }), {
        columnName: null,
      } as unknown as JSONObject),
    ).toEqual({ columnName: null });
  });

  test("a number stored as text is that number", () => {
    expect(
      getCheckChanges(check({ samplePercent: "10" as unknown as number }), {
        samplePercent: 10,
      }),
    ).toEqual({});
  });
});
