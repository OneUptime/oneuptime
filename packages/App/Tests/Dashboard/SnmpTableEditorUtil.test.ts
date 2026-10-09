import SnmpTableEditorUtil from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableEditorUtil";
import {
  SnmpTableColumn,
  SnmpTableDefinition,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import { describe, expect, test } from "@jest/globals";

// A column's numeric adjustment, as a vendor template sets it.
type ColumnAdjustment = Pick<SnmpTableColumn, "scale" | "offset">;

/*
 * The text forms the SNMP table editor shows for structured values, and the
 * inline error it shows beside a table - the same refusal the server makes
 * on save, said while the operator is looking at the table.
 */

describe("SnmpTableEditorUtil value labels", () => {
  test("parses comma-separated raw=label pairs", () => {
    expect(
      SnmpTableEditorUtil.parseValueLabels(
        "0=inactive, 1=active,2 = partially active",
      ),
    ).toEqual({ "0": "inactive", "1": "active", "2": "partially active" });
  });

  test("ignores pairs without a raw value or a label, and returns undefined for none", () => {
    expect(SnmpTableEditorUtil.parseValueLabels("=x, 1=, 3=three")).toEqual({
      "3": "three",
    });
    expect(SnmpTableEditorUtil.parseValueLabels("")).toBeUndefined();
    expect(SnmpTableEditorUtil.parseValueLabels("nonsense")).toBeUndefined();
  });

  test("keeps everything after the first = in the label", () => {
    expect(SnmpTableEditorUtil.parseValueLabels("1=a=b")).toEqual({
      "1": "a=b",
    });
  });

  test("formats labels back the way they are typed", () => {
    expect(
      SnmpTableEditorUtil.formatValueLabels({ "0": "inactive", "1": "active" }),
    ).toBe("0=inactive, 1=active");
    expect(SnmpTableEditorUtil.formatValueLabels(undefined)).toBe("");
  });

  test("round-trips", () => {
    const labels: Record<string, string> = { ON: "On", OFF: "Off" };

    expect(
      SnmpTableEditorUtil.parseValueLabels(
        SnmpTableEditorUtil.formatValueLabels(labels),
      ),
    ).toEqual(labels);
  });
});

describe("SnmpTableEditorUtil lists", () => {
  test("splits on commas and drops blanks", () => {
    expect(SnmpTableEditorUtil.parseList(" 1, 3,, ")).toEqual(["1", "3"]);
    expect(SnmpTableEditorUtil.parseList("")).toEqual([]);
  });

  test("formats a list", () => {
    expect(SnmpTableEditorUtil.formatList(["1.3.6.1.1", "1.3.6.1.2"])).toBe(
      "1.3.6.1.1, 1.3.6.1.2",
    );
    expect(SnmpTableEditorUtil.formatList(undefined)).toBe("");
  });
});

describe("SnmpTableEditorUtil.getTableError", () => {
  function table(overrides: Partial<SnmpTableDefinition>): SnmpTableDefinition {
    return {
      key: "",
      name: "IPsec Tunnels",
      columns: [{ oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9", name: "Status" }],
      ...overrides,
    };
  }

  test("says nothing about a valid table", () => {
    expect(SnmpTableEditorUtil.getTableError(table({}))).toBeUndefined();
  });

  test("says nothing about a table that is still blank", () => {
    expect(
      SnmpTableEditorUtil.getTableError(
        table({ name: "", columns: [{ oid: "", name: "" }] }),
      ),
    ).toBeUndefined();
  });

  test("names a malformed column OID", () => {
    expect(
      SnmpTableEditorUtil.getTableError(
        table({ columns: [{ oid: "sfosIPSecVpnConnStatus", name: "Status" }] }),
      ),
    ).toContain('"sfosIPSecVpnConnStatus" is not a numeric OID');
  });

  test("reports what the server would refuse", () => {
    expect(SnmpTableEditorUtil.getTableError(table({ name: "" }))).toContain(
      "every table needs a name",
    );
    expect(
      SnmpTableEditorUtil.getTableError(
        table({ columns: [{ oid: "", name: "only a name" }] }),
      ),
    ).toContain("needs at least one column");
    expect(
      SnmpTableEditorUtil.getTableError(table({ maxRows: 100000 })),
    ).toContain("whole number from 1 to 250");
  });

  test("refuses a column adjustment the server would refuse", () => {
    expect(
      SnmpTableEditorUtil.getTableError(
        table({
          columns: [
            { oid: "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9", name: "x", scale: 0 },
          ],
        }),
      ),
    ).toContain('the scale of column "x"');
  });
});

/*
 * The vendor templates bring columns whose numbers are adjusted on read
 * (Aruba's noise floor, ArubaOS's transmit power, Aerohive's offset): the
 * editor shows the arithmetic under the column, so what the SNMP Tables tab
 * shows can be traced back to what snmpwalk prints.
 */
describe("SnmpTableEditorUtil column adjustments", () => {
  test.each([
    [{ scale: -1 }, "value × −1"],
    [{ scale: 0.5 }, "value × 0.5"],
    [{ scale: 20 }, "value × 20"],
    [{ offset: -256 }, "value − 256"],
    [{ offset: 3 }, "value + 3"],
    [{ scale: -1, offset: 3 }, "value × −1 + 3"],
    [{ scale: 0.1, offset: -10 }, "value × 0.1 − 10"],
  ])("%j reads as %s", (adjustment: ColumnAdjustment, formula: string) => {
    expect(
      SnmpTableEditorUtil.formatAdjustment({
        oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.6",
        name: "Noise Floor",
        ...adjustment,
      }),
    ).toBe(formula);
  });

  test("says nothing for a column that reads numbers as they come", () => {
    for (const adjustment of [{}, { scale: 1 }, { offset: 0 }]) {
      expect(
        SnmpTableEditorUtil.formatAdjustment({
          oid: "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.6",
          name: "Noise Floor",
          ...adjustment,
        }),
      ).toBeUndefined();
    }
  });
});
