import {
  ImportNote,
  ImportNoteKind,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../../Types/Translator";
import {
  ImportObject,
  arrayField,
  asObject,
  field,
  numberField,
  objectField,
  textField,
} from "../ImportValues";

/*
 * A GRAFANA PANEL'S UNIT AND THRESHOLDS, IN A ONEUPTIME WIDGET'S WORDS
 * (issue #7697).
 *
 * A widget names its unit the way OneUptime's metrics name theirs, and
 * scales a known one ("bytes" reads as 1.5 MB). Grafana's units are ids
 * ("bytes", "percentunit", "reqps"); each it has a OneUptime unit for is
 * written as that unit, and one whose values are in a larger unit
 * (kilobytes, minutes, a 0-1 fraction of percent) multiplies the query so
 * the widget shows what Grafana showed. A unit with no OneUptime unit is
 * left out, and said.
 */

export const UNIT_NOT_KEPT: string = translationKey(
  "Grafana's unit {{unit}} is not kept: the values are shown as numbers.",
);

export const THRESHOLDS_NOT_KEPT: string = translationKey(
  "Grafana colours its low values as the bad ones; OneUptime's warning and critical thresholds mark high values, so they are not set.",
);

export const PERCENTAGE_THRESHOLDS_NOT_KEPT: string = translationKey(
  "Grafana's thresholds are percentages of the range; OneUptime's are values, so they are not set.",
);

export interface ConvertedUnit {
  // The unit the widget names; "" for none.
  unit: string;
  // What the query's values are multiplied by to read in that unit.
  multiplyBy: number;
  note?: ImportNote | undefined;
}

// Grafana unit id -> OneUptime unit and the factor its values take.
const UNITS: ReadonlyMap<string, { unit: string; multiplyBy: number }> =
  new Map<string, { unit: string; multiplyBy: number }>([
    ["percent", { unit: "%", multiplyBy: 1 }],
    ["percentunit", { unit: "%", multiplyBy: 100 }],
    ["humidity", { unit: "%", multiplyBy: 1 }],
    ["bytes", { unit: "bytes", multiplyBy: 1 }],
    ["decbytes", { unit: "bytes", multiplyBy: 1 }],
    ["kbytes", { unit: "bytes", multiplyBy: 1024 }],
    ["deckbytes", { unit: "bytes", multiplyBy: 1000 }],
    ["mbytes", { unit: "bytes", multiplyBy: 1024 * 1024 }],
    ["decmbytes", { unit: "bytes", multiplyBy: 1000 * 1000 }],
    ["gbytes", { unit: "bytes", multiplyBy: 1024 * 1024 * 1024 }],
    ["decgbytes", { unit: "bytes", multiplyBy: 1000 * 1000 * 1000 }],
    ["tbytes", { unit: "bytes", multiplyBy: 1024 * 1024 * 1024 * 1024 }],
    ["dectbytes", { unit: "bytes", multiplyBy: 1e12 }],
    ["bits", { unit: "bits", multiplyBy: 1 }],
    ["decbits", { unit: "bits", multiplyBy: 1 }],
    ["Bps", { unit: "By/s", multiplyBy: 1 }],
    ["binBps", { unit: "By/s", multiplyBy: 1 }],
    ["KBs", { unit: "By/s", multiplyBy: 1000 }],
    ["KiBs", { unit: "By/s", multiplyBy: 1024 }],
    ["MBs", { unit: "By/s", multiplyBy: 1000 * 1000 }],
    ["MiBs", { unit: "By/s", multiplyBy: 1024 * 1024 }],
    ["bps", { unit: "bit/s", multiplyBy: 1 }],
    ["binbps", { unit: "bit/s", multiplyBy: 1 }],
    ["Kbits", { unit: "bit/s", multiplyBy: 1000 }],
    ["Mbits", { unit: "bit/s", multiplyBy: 1000 * 1000 }],
    ["ns", { unit: "ns", multiplyBy: 1 }],
    ["µs", { unit: "us", multiplyBy: 1 }],
    ["us", { unit: "us", multiplyBy: 1 }],
    ["ms", { unit: "ms", multiplyBy: 1 }],
    ["s", { unit: "s", multiplyBy: 1 }],
    ["dtdurations", { unit: "s", multiplyBy: 1 }],
    ["dtdhms", { unit: "s", multiplyBy: 1 }],
    ["m", { unit: "s", multiplyBy: 60 }],
    ["h", { unit: "s", multiplyBy: 3600 }],
    ["d", { unit: "s", multiplyBy: 86400 }],
    ["dtdurationms", { unit: "ms", multiplyBy: 1 }],
    ["reqps", { unit: "req/s", multiplyBy: 1 }],
    ["rps", { unit: "req/s", multiplyBy: 1 }],
    ["ops", { unit: "ops/s", multiplyBy: 1 }],
    ["iops", { unit: "io/s", multiplyBy: 1 }],
    ["wps", { unit: "writes/s", multiplyBy: 1 }],
    ["rpm", { unit: "req/min", multiplyBy: 1 }],
    ["opm", { unit: "ops/min", multiplyBy: 1 }],
    ["pps", { unit: "packets/s", multiplyBy: 1 }],
    ["eps", { unit: "events/s", multiplyBy: 1 }],
    ["mps", { unit: "messages/s", multiplyBy: 1 }],
    ["rotrpm", { unit: "rpm", multiplyBy: 1 }],
    ["rothz", { unit: "Hz", multiplyBy: 1 }],
    ["hertz", { unit: "Hz", multiplyBy: 1 }],
    ["celsius", { unit: "Cel", multiplyBy: 1 }],
    ["watt", { unit: "W", multiplyBy: 1 }],
    ["kwatt", { unit: "W", multiplyBy: 1000 }],
    ["volt", { unit: "V", multiplyBy: 1 }],
    ["amp", { unit: "A", multiplyBy: 1 }],
    ["currencyUSD", { unit: "USD", multiplyBy: 1 }],
    ["currencyEUR", { unit: "EUR", multiplyBy: 1 }],
    ["currencyGBP", { unit: "GBP", multiplyBy: 1 }],
  ]);

// Grafana's ids for a number with no unit.
const NO_UNIT: ReadonlySet<string> = new Set<string>([
  "",
  "none",
  "short",
  "locale",
  "sishort",
  "string",
  "dateTimeAsIso",
  "dateTimeAsSystem",
  "dateTimeFromNow",
]);

export const convertGrafanaUnit: (unit: string) => ConvertedUnit = (
  unit: string,
): ConvertedUnit => {
  const id: string = (unit || "").trim();

  if (NO_UNIT.has(id)) {
    return { unit: "", multiplyBy: 1 };
  }

  const known: { unit: string; multiplyBy: number } | undefined =
    UNITS.get(id);

  if (known) {
    return { ...known };
  }

  // A custom unit Grafana writes as "suffix:<text>": the text is the unit.
  if (id.startsWith("suffix:")) {
    return { unit: id.slice("suffix:".length).trim(), multiplyBy: 1 };
  }

  return {
    unit: "",
    multiplyBy: 1,
    note: {
      kind: ImportNoteKind.Approximation,
      text: UNIT_NOT_KEPT,
      values: { unit: id },
    },
  };
};

// A query whose values are multiplied so they read in the widget's unit.
export const scaleQuery: (promQL: string, multiplyBy: number) => string = (
  promQL: string,
  multiplyBy: number,
): string => {
  if (multiplyBy === 1 || !promQL) {
    return promQL;
  }

  return `${multiplyBy} * (${promQL})`;
};

// A panel's unit: the field defaults' (timeseries, stat), or a graph's axis.
export const getGrafanaPanelUnit: (panel: ImportObject) => string = (
  panel: ImportObject,
): string => {
  const defaults: ImportObject | undefined = objectField(
    objectField(panel, "fieldConfig"),
    "defaults",
  );
  const unit: string = textField(defaults, "unit");

  if (unit) {
    return unit;
  }

  // The old graph panel: its left axis' format.
  const yaxes: Array<unknown> = arrayField(panel, "yaxes");
  const left: ImportObject | undefined = asObject(yaxes[0]);
  const format: string = textField(left, "format");

  if (format) {
    return format;
  }

  // The old singlestat panel.
  return textField(panel, "format");
};

export interface ConvertedThresholds {
  warning?: number | undefined;
  critical?: number | undefined;
  note?: ImportNote | undefined;
}

enum ThresholdColor {
  Good = "Good",
  Warning = "Warning",
  Critical = "Critical",
}

const CRITICAL_COLORS: ReadonlyArray<string> = [
  "red",
  "#f2495c",
  "#e02f44",
  "#c4162a",
  "#d44a3a",
  "#bf1b00",
  "#ff7383",
];

const WARNING_COLORS: ReadonlyArray<string> = [
  "orange",
  "yellow",
  "#eab839",
  "#ff9830",
  "#fade2a",
  "#ffb357",
  "#f2cc0c",
  "#ef843c",
];

// A colour's red, green and blue, from #rgb, #rrggbb or rgb()/rgba().
const readRgb: (color: string) => [number, number, number] | undefined = (
  color: string,
): [number, number, number] | undefined => {
  const hex: RegExpMatchArray | null = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);

  if (hex) {
    const digits: string =
      hex[1]!.length === 3
        ? hex[1]!
            .split("")
            .map((digit: string): string => {
              return digit + digit;
            })
            .join("")
        : hex[1]!;

    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }

  const rgb: RegExpMatchArray | null = color.match(
    /^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/,
  );

  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
};

// What a threshold's colour says: red is critical, orange and yellow a warning.
const readThresholdColor: (color: string) => ThresholdColor = (
  color: string,
): ThresholdColor => {
  const value: string = (color || "").trim().toLowerCase();

  if (
    CRITICAL_COLORS.some((name: string): boolean => {
      return value === name || value.endsWith(`-${name}`);
    })
  ) {
    return ThresholdColor.Critical;
  }

  if (
    WARNING_COLORS.some((name: string): boolean => {
      return value === name || value.endsWith(`-${name}`);
    })
  ) {
    return ThresholdColor.Warning;
  }

  const rgb: [number, number, number] | undefined = readRgb(value);

  if (rgb) {
    const [red, green, blue] = rgb;

    if (red >= 170 && green < 110 && blue < 110) {
      return ThresholdColor.Critical;
    }

    if (red >= 170 && green >= 110 && blue < 110) {
      return ThresholdColor.Warning;
    }
  }

  return ThresholdColor.Good;
};

/*
 * An old singlestat's thresholds ("80,90") and the colours it paints the
 * three ranges with: the warning and the critical value, when the ranges
 * go from good to bad as the value rises.
 */
export const convertGrafanaLegacyThresholds: (data: {
  panel: ImportObject;
  multiplyBy: number;
}) => ConvertedThresholds = (data: {
  panel: ImportObject;
  multiplyBy: number;
}): ConvertedThresholds => {
  const values: Array<number> = textField(data.panel, "thresholds")
    .split(",")
    .map((value: string): number => {
      return Number(value.trim());
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    });
  const colors: Array<ThresholdColor> = arrayField(data.panel, "colors").map(
    (color: unknown): ThresholdColor => {
      return readThresholdColor(typeof color === "string" ? color : "");
    },
  );

  if (values.length === 0 || colors.length < values.length + 1) {
    return {};
  }

  const lowIsBad: boolean =
    colors[0] !== ThresholdColor.Good ||
    colors.slice(1).some((color: ThresholdColor, index: number): boolean => {
      return color === ThresholdColor.Good && colors[index] !== ThresholdColor.Good;
    });

  if (lowIsBad) {
    return {
      note: { kind: ImportNoteKind.Approximation, text: THRESHOLDS_NOT_KEPT },
    };
  }

  const at: (color: ThresholdColor) => number | undefined = (
    color: ThresholdColor,
  ): number | undefined => {
    const index: number = colors.findIndex(
      (candidate: ThresholdColor, position: number): boolean => {
        return position > 0 && candidate === color;
      },
    );
    const value: number | undefined = index > 0 ? values[index - 1] : undefined;
    return value === undefined ? undefined : value * data.multiplyBy;
  };

  return {
    warning: at(ThresholdColor.Warning),
    critical: at(ThresholdColor.Critical),
  };
};

/*
 * A panel's thresholds as a widget's warning and critical values: the
 * first orange or yellow step is the warning, the first red one the
 * critical, when they mark values above a good one, as a OneUptime widget's
 * do. Thresholds that colour low values bad, or percentages of the range,
 * are not set, and said.
 */
export const convertGrafanaThresholds: (data: {
  panel: ImportObject;
  multiplyBy: number;
}) => ConvertedThresholds = (data: {
  panel: ImportObject;
  multiplyBy: number;
}): ConvertedThresholds => {
  const defaults: ImportObject | undefined = objectField(
    objectField(data.panel, "fieldConfig"),
    "defaults",
  );
  const thresholds: ImportObject | undefined = objectField(
    defaults,
    "thresholds",
  );

  if (!thresholds) {
    return {};
  }

  const steps: Array<{ color: ThresholdColor; value: number | undefined }> =
    arrayField(thresholds, "steps")
      .map(asObject)
      .filter((step: ImportObject | undefined): boolean => {
        return Boolean(step);
      })
      .map((step: ImportObject | undefined) => {
        return {
          color: readThresholdColor(textField(step, "color")),
          value: numberField(step, "value"),
        };
      });

  if (steps.length < 2) {
    return {};
  }

  const marked: boolean = steps.some(
    (step: { color: ThresholdColor; value: number | undefined }): boolean => {
      return step.color !== ThresholdColor.Good;
    },
  );

  if (!marked) {
    return {};
  }

  if (textField(thresholds, "mode") === "percentage") {
    return {
      note: {
        kind: ImportNoteKind.Approximation,
        text: PERCENTAGE_THRESHOLDS_NOT_KEPT,
      },
    };
  }

  // The base step (no value) bad, or a good one above a bad one: low is bad.
  const base: { color: ThresholdColor; value: number | undefined } = steps[0]!;
  let seenBad: boolean = base.color !== ThresholdColor.Good;
  let lowIsBad: boolean = seenBad;

  for (const step of steps.slice(1)) {
    if (step.color === ThresholdColor.Good && seenBad) {
      lowIsBad = true;
    }

    if (step.color !== ThresholdColor.Good) {
      seenBad = true;
    }
  }

  if (lowIsBad) {
    return {
      note: { kind: ImportNoteKind.Approximation, text: THRESHOLDS_NOT_KEPT },
    };
  }

  const firstOf: (color: ThresholdColor) => number | undefined = (
    color: ThresholdColor,
  ): number | undefined => {
    const step: { color: ThresholdColor; value: number | undefined } | undefined =
      steps.slice(1).find(
        (candidate: {
          color: ThresholdColor;
          value: number | undefined;
        }): boolean => {
          return candidate.color === color && candidate.value !== undefined;
        },
      );

    return step?.value === undefined ? undefined : step.value * data.multiplyBy;
  };

  return {
    warning: firstOf(ThresholdColor.Warning),
    critical: firstOf(ThresholdColor.Critical),
  };
};

// A field's min or max from the panel's defaults, in the widget's unit.
export const getGrafanaFieldNumber: (data: {
  panel: ImportObject;
  name: "min" | "max";
  multiplyBy: number;
}) => number | undefined = (data: {
  panel: ImportObject;
  name: "min" | "max";
  multiplyBy: number;
}): number | undefined => {
  const defaults: ImportObject | undefined = objectField(
    objectField(data.panel, "fieldConfig"),
    "defaults",
  );
  const value: number | undefined = numberField(defaults, data.name);

  if (value === undefined) {
    return undefined;
  }

  return field(defaults, data.name) === null ? undefined : value * data.multiplyBy;
};
