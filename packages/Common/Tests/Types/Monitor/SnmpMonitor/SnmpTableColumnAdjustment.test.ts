import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableValueType,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  MAX_COLUMN_OFFSET_MAGNITUDE,
  MAX_COLUMN_SCALE_MAGNITUDE,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SnmpTableCriteria from "../../../../Server/Utils/Monitor/Criteria/SnmpTableCriteria";
import { FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import { describe, expect, it } from "@jest/globals";

/*
 * A column's numeric adjustment: what a value is multiplied by and what is
 * added to it before it is shown, charted and compared. Vendors keep values
 * in units of their own - ArubaOS doubles its transmit power, Aruba Instant
 * drops the noise floor's sign, Aerohive adds 256 to it - and without this
 * "noise floor above -80 dBm" would be true of every Aruba radio.
 */

const NOISE: string = "1.3.6.1.4.1.26928.1.1.1.2.1.5.1.3";
const POWER: string = "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1.4";

function column(overrides: Partial<SnmpTableColumn> = {}): SnmpTableColumn {
  return {
    oid: NOISE,
    name: "Noise Floor",
    unit: "dBm",
    role: SnmpTableColumnRole.NoiseFloor,
    ...overrides,
  };
}

function table(columns: Array<SnmpTableColumn>): SnmpTableDefinition {
  return {
    key: "wifi_radios",
    name: "Wi-Fi Radios",
    kind: SnmpTableKind.WifiRadio,
    columns: columns,
  };
}

function validate(columns: Array<SnmpTableColumn>): SnmpTableColumn {
  return SnmpTableListUtil.validateTable(table(columns), "Test")
    .columns[0] as SnmpTableColumn;
}

describe("a column's adjustment is kept, cleaned and refused on save", () => {
  it("keeps a scale and an offset", () => {
    const saved: SnmpTableColumn = validate([
      column({ scale: -1 }),
      column({ oid: POWER, name: "TX Power", scale: 0.5, offset: 3 }),
    ]);

    expect(saved.scale).toBe(-1);
    expect(saved.offset).toBeUndefined();

    const power: SnmpTableColumn = SnmpTableListUtil.validateTable(
      table([column({ oid: POWER, name: "TX Power", scale: 0.5, offset: 3 })]),
      "Test",
    ).columns[0]!;

    expect(power.scale).toBe(0.5);
    expect(power.offset).toBe(3);
  });

  it("drops an adjustment that changes nothing", () => {
    const saved: SnmpTableColumn = validate([column({ scale: 1, offset: 0 })]);

    expect("scale" in saved).toBe(false);
    expect("offset" in saved).toBe(false);
  });

  it("reads numbers sent as text, as an API client may send them", () => {
    const saved: SnmpTableColumn = validate([
      column({
        scale: "0.1" as unknown as number,
        offset: "-256" as unknown as number,
      }),
    ]);

    expect(saved.scale).toBe(0.1);
    expect(saved.offset).toBe(-256);
  });

  it.each([
    ["a scale of 0", { scale: 0 }, 'the scale of column "Noise Floor"'],
    [
      "a scale that is not a number",
      { scale: "half" as unknown as number },
      'the scale of column "Noise Floor"',
    ],
    [
      "a scale past the bound",
      { scale: MAX_COLUMN_SCALE_MAGNITUDE + 1 },
      'the scale of column "Noise Floor"',
    ],
    [
      "an offset that is not finite",
      { offset: Infinity },
      'the offset of column "Noise Floor"',
    ],
    [
      "an offset past the bound",
      { offset: -(MAX_COLUMN_OFFSET_MAGNITUDE + 1) },
      'the offset of column "Noise Floor"',
    ],
  ])(
    "refuses %s, naming the column and the table",
    (_: string, overrides: Partial<SnmpTableColumn>, message: string) => {
      expect(() => {
        return validate([column(overrides)]);
      }).toThrow(BadDataException);

      expect(() => {
        return validate([column(overrides)]);
      }).toThrow(message);

      expect(() => {
        return validate([column(overrides)]);
      }).toThrow('in table "Wi-Fi Radios"');
    },
  );

  it("drops a stored table with a broken adjustment at poll time, not the whole walk", () => {
    const resolved: Array<SnmpTableDefinition> =
      SnmpTableListUtil.resolveEffectiveTables({
        templateTables: [
          { ...table([column({ scale: 0 })]), key: "broken" },
          { ...table([column({ scale: -1 })]), key: "fine" },
        ],
        deviceTables: [],
      }).tables;

    expect(
      resolved.map((entry: SnmpTableDefinition) => {
        return entry.key;
      }),
    ).toEqual(["fine"]);
  });
});

describe("a cell reads the adjusted number", () => {
  it("negates the noise floor Aruba sends without its sign", () => {
    expect(SnmpTableListUtil.buildCell(column({ scale: -1 }), 94)).toEqual({
      raw: 94,
      display: "-94",
      numeric: -94,
    });
  });

  it("takes off the 256 Aerohive adds", () => {
    expect(SnmpTableListUtil.buildCell(column({ offset: -256 }), 161)).toEqual({
      raw: 161,
      display: "-95",
      numeric: -95,
    });
  });

  it("halves the transmit power ArubaOS sends doubled, keeping the half dBm", () => {
    expect(
      SnmpTableListUtil.buildCell(
        column({ oid: POWER, name: "TX Power", scale: 0.5 }),
        33,
      ),
    ).toEqual({ raw: 33, display: "16.5", numeric: 16.5 });
  });

  it("does not carry floating-point noise into the number or its text", () => {
    const cell: ReturnType<typeof SnmpTableListUtil.buildCell> =
      SnmpTableListUtil.buildCell(column({ scale: 0.1 }), 155);

    expect(cell.numeric).toBe(15.5);
    expect(cell.display).toBe("15.5");
  });

  it("applies the scale before the offset", () => {
    expect(
      SnmpTableListUtil.buildCell(column({ scale: 2, offset: -10 }), 7).numeric,
    ).toBe(4);
  });

  it("reads the number out of vendor text first, then adjusts it", () => {
    expect(
      SnmpTableListUtil.buildCell(column({ scale: -1 }), "94 dBm"),
    ).toEqual({ raw: "94 dBm", display: "-94", numeric: -94 });
  });

  it("shows a value label rather than the adjusted number", () => {
    expect(
      SnmpTableListUtil.buildCell(
        column({ scale: 20, valueLabels: { "4": "80 MHz wide" } }),
        4,
      ),
    ).toEqual({ raw: 4, display: "80 MHz wide", numeric: 80 });
  });

  it("leaves a value that is not a number as it came", () => {
    expect(SnmpTableListUtil.buildCell(column({ scale: -1 }), "n/a")).toEqual({
      raw: "n/a",
      display: "n/a",
    });
    expect(
      SnmpTableListUtil.buildCell(column({ scale: -1 }), undefined),
    ).toEqual({ raw: null, display: "" });
  });

  it("never adjusts a Text column, whose numbers are names", () => {
    expect(
      SnmpTableListUtil.buildCell(
        column({ scale: -1, valueType: SnmpTableValueType.Text }),
        94,
      ),
    ).toEqual({ raw: 94, display: "94" });
  });

  it("judges health on the raw value the agent sent, as the healthy values are written", () => {
    expect(
      SnmpTableListUtil.buildCell(
        column({ scale: 20, healthyValues: ["4"] }),
        4,
      ).isHealthy,
    ).toBe(true);
  });

  it("gives 0, never -0", () => {
    const cell: ReturnType<typeof SnmpTableListUtil.buildCell> =
      SnmpTableListUtil.buildCell(column({ scale: -1 }), 0);

    expect(Object.is(cell.numeric, 0)).toBe(true);
    expect(cell.display).toBe("0");
  });

  it("reads numbers as they come in a column without an adjustment", () => {
    expect(SnmpTableListUtil.buildCell(column(), 94)).toEqual({
      raw: 94,
      display: "94",
      numeric: 94,
    });
    expect(SnmpTableListUtil.hasAdjustment(column())).toBe(false);
    expect(SnmpTableListUtil.hasAdjustment(column({ scale: 1 }))).toBe(false);
    expect(SnmpTableListUtil.hasAdjustment(column({ offset: 0 }))).toBe(false);
    expect(SnmpTableListUtil.hasAdjustment(column({ scale: -1 }))).toBe(true);
    expect(SnmpTableListUtil.hasAdjustment(column({ offset: 2 }))).toBe(true);
  });
});

describe("criteria compare the adjusted number", () => {
  const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
    tables: [table([column({ scale: -1 })])],
    results: [
      {
        key: "wifi_radios",
        rows: [
          { index: "1", values: { [NOISE]: 94 } },
          { index: "2", values: { [NOISE]: 75 } },
        ],
      },
    ],
  })[0]!;

  it("finds the noisy radio with the threshold every vendor shares", () => {
    const noisy: Array<string> = snapshot.rows
      .filter((row: SnmpTableSnapshot["rows"][number]) => {
        return SnmpTableCriteria.isValueMatch({
          value: {
            raw: String(row.cells[NOISE]!.raw),
            display: row.cells[NOISE]!.display,
            numeric: row.cells[NOISE]!.numeric,
          },
          threshold: -80,
          filterType: FilterType.GreaterThan,
        });
      })
      .map((row: SnmpTableSnapshot["rows"][number]) => {
        return row.index;
      });

    expect(noisy).toEqual(["2"]);
  });

  it("matches Equal To on the adjusted number", () => {
    expect(
      SnmpTableCriteria.isValueMatch({
        value: { raw: "94", display: "-94", numeric: -94 },
        threshold: -94,
        filterType: FilterType.EqualTo,
      }),
    ).toBe(true);
  });
});
