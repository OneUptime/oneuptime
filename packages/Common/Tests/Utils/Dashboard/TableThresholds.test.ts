import { describe, expect, test } from "@jest/globals";
import {
  TableColumnThresholds,
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  TABLE_THRESHOLD_PERCENT_LOWER_IS_WORSE_PRESET,
  TABLE_THRESHOLD_PERCENT_PRESET,
  TableColumnDisplay,
  formatTableThreshold,
  formatTableValue,
  getTableColumnDisplay,
  getTableThresholdLevel,
  getTableThresholdPreset,
  isTableColumnPercent,
  isTableThresholdOrderReversed,
  isTableThresholdPreset,
  joinTableValueAndUnit,
  readTableColumnThresholds,
  readTableThresholdDirection,
  readTableThresholdNumber,
  readTableThresholdStyle,
  roundTableValue,
} from "../../../Utils/Dashboard/TableThresholds";

/*
 * A metric table's threshold colors (issue #5231), the rules alone: what a
 * stored threshold is read as, which level a value has reached, the scale a
 * column shows - and compares - its values in, and the thresholds a column
 * starts with. The widget and its settings are tested in
 * Tests/App/Dashboard/DashboardTableThresholds.test.tsx.
 */

const HIGHER: TableThresholdDirection = TableThresholdDirection.HigherIsWorse;
const LOWER: TableThresholdDirection = TableThresholdDirection.LowerIsWorse;
const WARNING: TableThresholdLevel = TableThresholdLevel.Warning;
const CRITICAL: TableThresholdLevel = TableThresholdLevel.Critical;

// The customer's example: normal below 80, warning from 80, critical from 90.
const CPU: TableColumnThresholds = {
  warning: 80,
  critical: 90,
  direction: HIGHER,
};

// Free disk space: a warning at 20% or less, critical at 10% or less.
const FREE_SPACE: TableColumnThresholds = {
  warning: 20,
  critical: 10,
  direction: LOWER,
};

function levelOf(
  value: number | null | undefined,
  thresholds: TableColumnThresholds | null | undefined,
): TableThresholdLevel | null {
  return getTableThresholdLevel({ value, thresholds });
}

describe("readTableThresholdNumber", () => {
  test.each([
    [80, 80],
    [0, 0],
    [-15.5, -15.5],
    [99.95, 99.95],
    [1e12, 1e12],
  ])("keeps the number %p", (stored: number, read: number) => {
    expect(readTableThresholdNumber(stored)).toBe(read);
  });

  test.each([
    ["80", 80],
    [" 90.5 ", 90.5],
    ["-20", -20],
    ["0", 0],
    ["1e3", 1000],
  ])(
    "reads the text %p as the number the API or Terraform meant",
    (stored: string, read: number) => {
      expect(readTableThresholdNumber(stored)).toBe(read);
    },
  );

  test.each([
    [""],
    ["   "],
    ["eighty"],
    ["80%"],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    ["Infinity"],
    [null],
    [undefined],
    [true],
    [{}],
    [[80]],
  ])("reads %p as no threshold at all", (stored: unknown) => {
    expect(readTableThresholdNumber(stored)).toBeUndefined();
  });
});

describe("readTableThresholdDirection", () => {
  test("lower is worse only when it says so", () => {
    expect(readTableThresholdDirection(LOWER)).toBe(LOWER);
  });

  test.each([[HIGHER], [undefined], [null], ["lower"], ["LOWERISWORSE"], [1]])(
    "anything else - %p - is higher is worse",
    (stored: unknown) => {
      expect(readTableThresholdDirection(stored)).toBe(HIGHER);
    },
  );
});

describe("readTableColumnThresholds", () => {
  test.each([
    [undefined],
    [null],
    ["80"],
    [80],
    [[80, 90]],
    [{}],
    [{ direction: LOWER }],
    [{ warning: "", critical: "  " }],
    [{ warning: "high", critical: Number.NaN }],
  ])("%p has no thresholds in force", (stored: unknown) => {
    expect(readTableColumnThresholds(stored)).toBeNull();
  });

  test("keeps both numbers and the direction", () => {
    expect(readTableColumnThresholds(FREE_SPACE)).toStrictEqual(FREE_SPACE);
  });

  test("a direction left out is higher is worse", () => {
    expect(
      readTableColumnThresholds({ warning: 80, critical: 90 }),
    ).toStrictEqual(CPU);
  });

  test("one threshold is enough, and the other is left out rather than undefined", () => {
    const warningOnly: TableColumnThresholds | null = readTableColumnThresholds(
      { warning: 80 },
    );
    const criticalOnly: TableColumnThresholds | null =
      readTableColumnThresholds({ critical: "90", direction: LOWER });

    expect(warningOnly).toStrictEqual({ warning: 80, direction: HIGHER });
    expect(Object.keys(warningOnly || {}).sort()).toEqual([
      "direction",
      "warning",
    ]);
    expect(criticalOnly).toStrictEqual({ critical: 90, direction: LOWER });
  });

  test("a threshold that is not a number is dropped, the other kept", () => {
    expect(
      readTableColumnThresholds({ warning: "a lot", critical: 95 }),
    ).toStrictEqual({ critical: 95, direction: HIGHER });
  });

  test("an unknown direction is read as higher is worse", () => {
    expect(
      readTableColumnThresholds({
        warning: 1,
        critical: 5,
        direction: "Sideways",
      }),
    ).toStrictEqual({ warning: 1, critical: 5, direction: HIGHER });
  });
});

describe("readTableThresholdStyle", () => {
  test("the whole cell only when it says so", () => {
    expect(readTableThresholdStyle(TableThresholdStyle.Background)).toBe(
      TableThresholdStyle.Background,
    );
  });

  test.each([
    [TableThresholdStyle.Text],
    [undefined],
    [null],
    ["background"],
    [{}],
  ])("%p colors the number", (stored: unknown) => {
    expect(readTableThresholdStyle(stored)).toBe(TableThresholdStyle.Text);
  });
});

describe("getTableThresholdLevel, higher is worse", () => {
  test.each([
    [0, null],
    [79, null],
    [79.999, null],
    [80, WARNING],
    [80.001, WARNING],
    [85, WARNING],
    [89.999, WARNING],
    [90, CRITICAL],
    [90.001, CRITICAL],
    [100, CRITICAL],
    [1e9, CRITICAL],
    [-5, null],
  ])(
    "%p is %p: a threshold is reached at its value",
    (value: number, level: TableThresholdLevel | null) => {
      expect(levelOf(value, CPU)).toBe(level);
    },
  );

  test("a direction left out is higher is worse", () => {
    expect(levelOf(85, { warning: 80, critical: 90 })).toBe(WARNING);
    expect(levelOf(95, { warning: 80, critical: 90 })).toBe(CRITICAL);
  });

  test("with only a warning, a value is a warning from it up and never critical", () => {
    expect(levelOf(79, { warning: 80 })).toBeNull();
    expect(levelOf(80, { warning: 80 })).toBe(WARNING);
    expect(levelOf(1000, { warning: 80 })).toBe(WARNING);
  });

  test("with only a critical, a value is critical from it up and never a warning", () => {
    expect(levelOf(89, { critical: 90 })).toBeNull();
    expect(levelOf(90, { critical: 90 })).toBe(CRITICAL);
  });

  test("a threshold of 0 is a threshold", () => {
    expect(levelOf(0, { critical: 0 })).toBe(CRITICAL);
    expect(levelOf(-0.1, { critical: 0 })).toBeNull();
  });

  test("negative thresholds compare as numbers", () => {
    expect(levelOf(-15, { warning: -20, critical: -10 })).toBe(WARNING);
    expect(levelOf(-10, { warning: -20, critical: -10 })).toBe(CRITICAL);
    expect(levelOf(-25, { warning: -20, critical: -10 })).toBeNull();
  });

  test("equal thresholds: critical wins", () => {
    expect(levelOf(80, { warning: 80, critical: 80 })).toBe(CRITICAL);
    expect(levelOf(79, { warning: 80, critical: 80 })).toBeNull();
  });

  test("critical below warning: critical wins from its value up, so nothing is a warning", () => {
    const reversed: TableColumnThresholds = { warning: 90, critical: 80 };

    expect(levelOf(79, reversed)).toBeNull();
    expect(levelOf(80, reversed)).toBe(CRITICAL);
    expect(levelOf(85, reversed)).toBe(CRITICAL);
    expect(levelOf(95, reversed)).toBe(CRITICAL);
  });

  test("thresholds stored as text compare as their numbers", () => {
    const stored: unknown = { warning: "80", critical: "90" };

    expect(levelOf(85, stored as TableColumnThresholds)).toBe(WARNING);
    expect(levelOf(90, stored as TableColumnThresholds)).toBe(CRITICAL);
  });
});

describe("getTableThresholdLevel, lower is worse", () => {
  test.each([
    [100, null],
    [20.001, null],
    [20, WARNING],
    [15, WARNING],
    [10.001, WARNING],
    [10, CRITICAL],
    [0, CRITICAL],
    [-1, CRITICAL],
  ])(
    "%p is %p: reached at or below the threshold",
    (value: number, level: TableThresholdLevel | null) => {
      expect(levelOf(value, FREE_SPACE)).toBe(level);
    },
  );

  test("with only a warning, every value at or below it is a warning", () => {
    expect(levelOf(21, { warning: 20, direction: LOWER })).toBeNull();
    expect(levelOf(0, { warning: 20, direction: LOWER })).toBe(WARNING);
  });

  test("critical above warning: critical wins from its value down", () => {
    const reversed: TableColumnThresholds = {
      warning: 10,
      critical: 20,
      direction: LOWER,
    };

    expect(levelOf(25, reversed)).toBeNull();
    expect(levelOf(20, reversed)).toBe(CRITICAL);
    expect(levelOf(5, reversed)).toBe(CRITICAL);
  });

  test("availability: a warning under 99.9, critical under 99", () => {
    const availability: TableColumnThresholds = {
      warning: 99.9,
      critical: 99,
      direction: LOWER,
    };

    expect(levelOf(99.95, availability)).toBeNull();
    expect(levelOf(99.9, availability)).toBe(WARNING);
    expect(levelOf(99.5, availability)).toBe(WARNING);
    expect(levelOf(99, availability)).toBe(CRITICAL);
  });
});

describe("getTableThresholdLevel, nothing to compare", () => {
  test.each([
    [undefined],
    [null],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
  ])("a missing value - %p - is never colored", (value: unknown) => {
    expect(levelOf(value as number, CPU)).toBeNull();
    expect(levelOf(value as number, FREE_SPACE)).toBeNull();
  });

  test.each([
    [undefined],
    [null],
    [{}],
    [{ direction: LOWER }],
    [{ warning: "", critical: "" }],
  ])("a column without thresholds - %p - colors nothing", (stored: unknown) => {
    for (const value of [-1e9, 0, 50, 80, 90, 1e9]) {
      expect(levelOf(value, stored as TableColumnThresholds)).toBeNull();
    }
  });
});

describe("isTableThresholdOrderReversed", () => {
  test("higher is worse wants critical at or above warning", () => {
    expect(isTableThresholdOrderReversed(CPU)).toBe(false);
    expect(isTableThresholdOrderReversed({ warning: 90, critical: 80 })).toBe(
      true,
    );
  });

  test("lower is worse wants critical at or below warning", () => {
    expect(isTableThresholdOrderReversed(FREE_SPACE)).toBe(false);
    expect(
      isTableThresholdOrderReversed({
        warning: 10,
        critical: 20,
        direction: LOWER,
      }),
    ).toBe(true);
  });

  test.each([
    [{ warning: 80, critical: 80 }],
    [{ warning: 80 }],
    [{ critical: 90 }],
    [{ critical: 5, direction: LOWER }],
    [{}],
    [null],
    [undefined],
  ])("%p is never reversed", (thresholds: unknown) => {
    expect(
      isTableThresholdOrderReversed(thresholds as TableColumnThresholds),
    ).toBe(false);
  });
});

describe("getTableColumnDisplay: the scale thresholds are typed in", () => {
  test("a usage metric sent as a fraction of 1 shows as a percent, x100", () => {
    expect(
      getTableColumnDisplay({
        metricUnit: "1",
        metricName: "system.cpu.utilization",
      }),
    ).toStrictEqual({ unit: "%", factor: 100 });
    expect(
      getTableColumnDisplay({
        metricUnit: " 1 ",
        metricName: "system.filesystem.utilization",
      }),
    ).toStrictEqual({ unit: "%", factor: 100 });
    expect(
      getTableColumnDisplay({
        metricUnit: "1",
        metricName: "node_memory_usage_ratio",
      }),
    ).toStrictEqual({ unit: "%", factor: 100 });
  });

  test("a percent typed for a fraction is shown x100 too, as the percent it is", () => {
    expect(
      getTableColumnDisplay({
        columnUnit: "%",
        metricUnit: "1",
        metricName: "system.memory.utilization",
      }),
    ).toStrictEqual({ unit: "%", factor: 100 });
    expect(
      getTableColumnDisplay({
        columnUnit: "percent",
        metricUnit: "1",
        metricName: "system.memory.utilization",
      }),
    ).toStrictEqual({ unit: "percent", factor: 100 });
  });

  test("another unit typed for a fraction is shown as stored", () => {
    expect(
      getTableColumnDisplay({
        columnUnit: "ratio",
        metricUnit: "1",
        metricName: "system.cpu.utilization",
      }),
    ).toStrictEqual({ unit: "ratio", factor: 1 });
  });

  test("a metric that is already a percent is never multiplied again", () => {
    expect(
      getTableColumnDisplay({
        metricUnit: "%",
        metricName: "container.memory.percent",
      }),
    ).toStrictEqual({ unit: "%", factor: 1 });
  });

  test("the kubelet's CPU 'utilization' in cores is not a fraction", () => {
    expect(
      getTableColumnDisplay({
        metricUnit: "1",
        metricName: "k8s.node.cpu.utilization",
      }),
    ).toStrictEqual({ unit: undefined, factor: 1 });
  });

  test("any other unit 1 is a plain number, with no unit written", () => {
    expect(
      getTableColumnDisplay({
        metricUnit: "1",
        metricName: "system.processes.count",
      }),
    ).toStrictEqual({ unit: undefined, factor: 1 });
  });

  test("the metric's own unit when the Unit is Auto, blank or spaces", () => {
    for (const columnUnit of [undefined, "", "   "]) {
      expect(
        getTableColumnDisplay({
          columnUnit,
          metricUnit: "ms",
          metricName: "http.server.duration",
        }),
      ).toStrictEqual({ unit: "ms", factor: 1 });
    }
  });

  test("the Unit as typed wins over the metric's own", () => {
    expect(
      getTableColumnDisplay({
        columnUnit: " s ",
        metricUnit: "ms",
        metricName: "http.server.duration",
      }),
    ).toStrictEqual({ unit: "s", factor: 1 });
  });

  test("no unit anywhere is no unit", () => {
    expect(getTableColumnDisplay({})).toStrictEqual({
      unit: undefined,
      factor: 1,
    });
  });

  test("a formula column shows its Unit as typed, never x100", () => {
    expect(getTableColumnDisplay({ columnUnit: "%" })).toStrictEqual({
      unit: "%",
      factor: 1,
    });
    expect(getTableColumnDisplay({ columnUnit: "" })).toStrictEqual({
      unit: undefined,
      factor: 1,
    });
  });
});

describe("percent against fraction: thresholds read the percent the cell shows", () => {
  const cpu: TableColumnDisplay = getTableColumnDisplay({
    metricUnit: "1",
    metricName: "system.cpu.utilization",
  });

  function cellLevel(
    stored: number,
    decimals: number,
  ): TableThresholdLevel | null {
    return levelOf(roundTableValue(stored * cpu.factor, decimals), CPU);
  }

  test.each([
    [0.79, null],
    [0.8, WARNING],
    [0.85, WARNING],
    [0.9, CRITICAL],
    [0.93, CRITICAL],
    [1, CRITICAL],
  ])(
    "a fraction of %p is compared as its percent",
    (stored: number, level: TableThresholdLevel | null) => {
      expect(cellLevel(stored, 2)).toBe(level);
    },
  );

  test("0.29 x 100 is 28.999999999999996 in floating point, and still reaches 29", () => {
    expect(0.29 * 100).toBeLessThan(29);
    expect(levelOf(roundTableValue(0.29 * 100, 2), { warning: 29 })).toBe(
      WARNING,
    );
    expect(roundTableValue(0.57 * 100, 2)).toBe(57);
  });

  test("a cell that says 80% is at a warning of 80, whatever it rounds from", () => {
    expect(formatTableValue({ value: 79.6, decimals: 0, unit: "%" })).toBe(
      "80%",
    );
    expect(cellLevel(0.796, 0)).toBe(WARNING);
    expect(cellLevel(0.796, 1)).toBeNull();
  });

  test("the fraction's own number is never compared", () => {
    // A fraction of 0.93 against thresholds of 80 and 90 would be normal.
    expect(levelOf(0.93, CPU)).toBeNull();
    expect(cellLevel(0.93, 2)).toBe(CRITICAL);
  });
});

describe("roundTableValue", () => {
  test.each([
    [93.456, 2, 93.46],
    [93.454, 2, 93.45],
    [79.6, 0, 80],
    [12.3456, 3, 12.346],
    [5, 2, 5],
    [-2.345, 1, -2.3],
  ])(
    "%p at %p decimals is %p",
    (value: number, decimals: number, rounded: number) => {
      expect(roundTableValue(value, decimals)).toBe(rounded);
    },
  );

  test("negative or broken decimals round to whole numbers", () => {
    expect(roundTableValue(12.7, -3)).toBe(13);
    expect(roundTableValue(12.7, Number.NaN)).toBe(13);
  });

  test("more than 20 decimals is 20", () => {
    expect(roundTableValue(1 / 3, 50)).toBe(roundTableValue(1 / 3, 20));
  });
});

describe("isTableColumnPercent and getTableThresholdPreset", () => {
  test.each([["%"], ["percent"], ["Percentage"], ["pct"]])(
    "a %p column starts at 80 and 90, higher is worse",
    (unit: string) => {
      const display: TableColumnDisplay = { unit, factor: 1 };

      expect(isTableColumnPercent(display)).toBe(true);
      expect(getTableThresholdPreset(display)).toStrictEqual({
        warning: TABLE_THRESHOLD_PERCENT_PRESET.warning,
        critical: TABLE_THRESHOLD_PERCENT_PRESET.critical,
        direction: HIGHER,
      });
    },
  );

  test("the percent preset is the customer's example: warning at 80, critical at 90", () => {
    expect(TABLE_THRESHOLD_PERCENT_PRESET).toStrictEqual({
      warning: 80,
      critical: 90,
    });
  });

  test("a fraction shown as a percent starts at 80 and 90 too", () => {
    expect(
      getTableThresholdPreset(
        getTableColumnDisplay({
          metricUnit: "1",
          metricName: "system.cpu.utilization",
        }),
      ),
    ).toStrictEqual(CPU);
  });

  test.each([["ms"], ["By"], ["requests"], [undefined]])(
    "a %p column starts with no numbers: only its reader knows its scale",
    (unit: string | undefined) => {
      const display: TableColumnDisplay = { unit, factor: 1 };

      expect(isTableColumnPercent(display)).toBe(false);
      expect(getTableThresholdPreset(display)).toStrictEqual({
        direction: HIGHER,
      });
      expect(
        readTableColumnThresholds(getTableThresholdPreset(display)),
      ).toBeNull();
    },
  );

  test("asked for lower is worse, a percent column starts at 20 and 10, the mirror of 80 and 90", () => {
    expect(TABLE_THRESHOLD_PERCENT_LOWER_IS_WORSE_PRESET).toStrictEqual({
      warning: 20,
      critical: 10,
    });
    expect(
      getTableThresholdPreset({ unit: "%", factor: 1 }, LOWER),
    ).toStrictEqual({ warning: 20, critical: 10, direction: LOWER });
    // The mirror of the higher-is-worse preset, in what is left.
    expect(100 - TABLE_THRESHOLD_PERCENT_PRESET.warning).toBe(
      TABLE_THRESHOLD_PERCENT_LOWER_IS_WORSE_PRESET.warning,
    );
    expect(100 - TABLE_THRESHOLD_PERCENT_PRESET.critical).toBe(
      TABLE_THRESHOLD_PERCENT_LOWER_IS_WORSE_PRESET.critical,
    );
  });

  test("each direction's preset is in order: it never says critical is on the wrong side", () => {
    for (const direction of [HIGHER, LOWER]) {
      const preset: TableColumnThresholds = getTableThresholdPreset(
        { unit: "%", factor: 1 },
        direction,
      );

      expect({
        direction,
        reversed: isTableThresholdOrderReversed(preset),
      }).toStrictEqual({ direction, reversed: false });
    }
  });

  test("lower is worse on another unit still starts with no numbers, only its direction", () => {
    expect(
      getTableThresholdPreset({ unit: "ms", factor: 1 }, LOWER),
    ).toStrictEqual({ direction: LOWER });
  });

  test("an unknown direction asked for is higher is worse, as a stored one is read", () => {
    expect(
      getTableThresholdPreset(
        { unit: "%", factor: 1 },
        "Sideways" as unknown as TableThresholdDirection,
      ),
    ).toStrictEqual({ warning: 80, critical: 90, direction: HIGHER });
  });
});

describe("isTableThresholdPreset", () => {
  const PERCENT: TableColumnDisplay = { unit: "%", factor: 1 };
  const MILLISECONDS: TableColumnDisplay = { unit: "ms", factor: 1 };

  test("a percent column's 80 and 90, higher is worse, are its preset", () => {
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 80, critical: 90, direction: HIGHER },
        display: PERCENT,
      }),
    ).toBe(true);
    // Left out, the direction is higher is worse.
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 80, critical: 90 },
        display: PERCENT,
      }),
    ).toBe(true);
  });

  test("20 and 10 are the preset when lower is worse, and only then", () => {
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 20, critical: 10, direction: LOWER },
        display: PERCENT,
      }),
    ).toBe(true);
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 20, critical: 10, direction: HIGHER },
        display: PERCENT,
      }),
    ).toBe(false);
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 80, critical: 90, direction: LOWER },
        display: PERCENT,
      }),
    ).toBe(false);
  });

  test("a number someone typed, or cleared, is not the preset", () => {
    for (const thresholds of [
      { warning: 80, critical: 95, direction: HIGHER },
      { warning: 75, critical: 90, direction: HIGHER },
      { warning: 80, direction: HIGHER },
      { critical: 90, direction: HIGHER },
      { direction: HIGHER },
    ]) {
      expect({
        thresholds,
        isPreset: isTableThresholdPreset({ thresholds, display: PERCENT }),
      }).toStrictEqual({ thresholds, isPreset: false });
    }
  });

  test("the preset written as text by the API or Terraform is still the preset", () => {
    expect(
      isTableThresholdPreset({
        thresholds: {
          warning: "80",
          critical: " 90 ",
        } as unknown as TableColumnThresholds,
        display: PERCENT,
      }),
    ).toBe(true);
  });

  test("another unit's preset is no numbers at all", () => {
    expect(
      isTableThresholdPreset({
        thresholds: { direction: HIGHER },
        display: MILLISECONDS,
      }),
    ).toBe(true);
    expect(
      isTableThresholdPreset({
        thresholds: { warning: 250, direction: HIGHER },
        display: MILLISECONDS,
      }),
    ).toBe(false);
  });

  test("thresholds that are off are no preset", () => {
    expect(
      isTableThresholdPreset({ thresholds: undefined, display: PERCENT }),
    ).toBe(false);
    expect(isTableThresholdPreset({ thresholds: null, display: PERCENT })).toBe(
      false,
    );
  });
});

describe("joinTableValueAndUnit, formatTableValue and formatTableThreshold", () => {
  test("a percent, a degree and a per-mille sign follow the number with no space", () => {
    expect(joinTableValueAndUnit("93", "%")).toBe("93%");
    expect(joinTableValueAndUnit("21", "°")).toBe("21°");
    expect(joinTableValueAndUnit("4", "‰")).toBe("4‰");
  });

  test("any other unit after a space, and no unit as the number alone", () => {
    expect(joinTableValueAndUnit("12.5", "ms")).toBe("12.5 ms");
    expect(joinTableValueAndUnit("12.5", undefined)).toBe("12.5");
    expect(joinTableValueAndUnit("12.5", "")).toBe("12.5");
  });

  test("a value is written with its column's decimals", () => {
    expect(formatTableValue({ value: 93.456, decimals: 2, unit: "%" })).toBe(
      "93.46%",
    );
    expect(formatTableValue({ value: 93, decimals: 2, unit: "%" })).toBe(
      "93.00%",
    );
    expect(formatTableValue({ value: 12.5, decimals: 0, unit: "ms" })).toBe(
      (13).toLocaleString(undefined) + " ms",
    );
    expect(formatTableValue({ value: 7, decimals: 1, unit: undefined })).toBe(
      "7.0",
    );
  });

  test("a threshold is written as typed, with no trailing zeros", () => {
    expect(formatTableThreshold({ threshold: 80, unit: "%" })).toBe("80%");
    expect(formatTableThreshold({ threshold: 99.95, unit: "%" })).toBe(
      "99.95%",
    );
    expect(formatTableThreshold({ threshold: 0.5, unit: "s" })).toBe("0.5 s");
    expect(formatTableThreshold({ threshold: -20, unit: "°" })).toBe("-20°");
    expect(formatTableThreshold({ threshold: 1 / 3, unit: undefined })).toBe(
      "0.333333",
    );
  });
});
