import { afterEach, describe, expect, test } from "@jest/globals";
import ValueFormatter, { FormattedValue } from "../../Utils/ValueFormatter";
import {
  formatTableThreshold,
  formatTableValue,
  joinTableValueAndUnit,
} from "../../Utils/Dashboard/TableThresholds";
import MetricValueFormatter from "../../Utils/Monitor/MetricValueFormatter";
import { toGsm7Text } from "../../Utils/Sms/Gsm7Text";
import { describeDetectionOverflow } from "../../Utils/SecurityEvent/DetectionOverflow";
import TableColumnsToCsv from "../../UI/Utils/TableColumnsToCsv";
import {
  formatUnitAmount,
  getUnitAmountParts,
  IntlTextPart,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import { escapeRegExp } from "../../Utils/RegExpEscape";
import { formatFileSize } from "../../Types/File/FileSize";
import {
  describeWebVitalThresholds,
  formatWebVitalThreshold,
} from "../../Types/Rum/WebVitals";
import InstallationHealthUtil from "../../Types/InstallationHealth/InstallationHealth";
import { formatDatabaseHealthBytes } from "../../Types/DatabaseServer/DatabaseHealth";
import {
  formatTelemetryIngestionBudgetGB,
  formatTelemetryIngestionBudgetMBPerSecond,
  getTelemetryIngestionBudgetValueProblem,
  TelemetryIngestionBudgetValueKind,
} from "../../Types/Telemetry/TelemetryIngestionBudget";
import NtpMonitorUtil from "../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import { PacketCaptureLimitsUtil } from "../../Types/PacketCapture/PacketCaptureLimits";
import { createTranslator, Translator } from "../../Types/Translator";
import { formatK8sResourceValue } from "../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceQuantity";
import {
  formatOpenStackBytes,
  formatOpenStackChartBytes,
} from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackFigures";
import { formatBytes } from "../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import ProfileUtil from "../../../App/FeatureSet/Dashboard/src/Utils/ProfileUtil";

/*
 * A FIGURE AND A UNIT HELD IN A VARIABLE STAY ON ONE LINE (#8457).
 *
 * #8303 held every figure code joins to a unit written in the template
 * (`${size}\u00A0MB`). The formatters that hold the unit in a variable or
 * a property - the charts' and tables' ValueFormatter, a table's cells, an
 * alert's metric values, the Kubernetes, OpenStack and telemetry sizes, a
 * profile's samples - and the figures Common/Types writes for pages (a
 * file's size, a web vital's limits, an installation's or a database's
 * health, an ingestion budget, an NTP reading, a capture's limits) still
 * joined them with a plain space, so a narrow cell, tooltip or line could
 * end with "12.5" and start the next with "MB".
 *
 * Each is read here in English, German, French, Arabic and Persian: the
 * figure is held to its unit by a space no line breaks at, a unit's symbol
 * and a unit ValueFormatter names in words alike ("2 hours", "6,91
 * Stunden", as DateLanguage holds every amount Intl writes, #8456). A word
 * that counts something in a sentence ("2,340 groups") keeps the plain
 * space any word has, and so does text a machine or another file reads: a
 * CSV, a text message's GSM-7.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "ar", "fa"];

// A space a line may break at (Types/NoBreakSpaces).
const BREAKING_SPACE: string = "[ \\u2000-\\u2006\\u2008-\\u200A\\u205F]";

// A space no line breaks at: the no-break space, and French's narrow one.
const HOLDING_SPACE: RegExp = /[\u00A0\u202F]/;

const MARKS: RegExp = /[\u200E\u200F\u061C\u2066-\u2069]/g;

// A figure in any of the five languages' digits.
const FIGURE: string = "[\\p{Nd}][\\p{Nd}.,\\u066B\\u066C\\u060C]*";

/*
 * Whether `text` writes a figure, then a space a line breaks at, then
 * `unit`: the break this file is about.
 */
const breaksBefore: (text: string, unit: string) => boolean = (
  text: string,
  unit: string,
): boolean => {
  return new RegExp(
    `${FIGURE}${BREAKING_SPACE}+${escapeRegExp(unit)}`,
    "u",
  ).test(text.replace(MARKS, ""));
};

// `text` with its no-break spaces as the plain ones they stand for.
const plain: (text: string) => string = (text: string): string => {
  return text.replace(/[\u00A0\u202F]/g, " ");
};

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("ValueFormatter, which writes every chart's and table's figures", () => {
  const SYMBOLS: ReadonlyArray<[number, string, string]> = [
    [1536, "By", "KB"],
    [1500000, "By/s", "MB/s"],
    [5, "ms", "ms"],
    [0.0000015, "s", "µs"],
    [23.5, "Cel", "°C"],
    [50, "Hz", "Hz"],
    [230, "V", "V"],
    [100, "req/s", "req/s"],
    [12, "ug/m3", "ug/m3"],
    [101.3, "kPa", "kPa"],
  ];

  test.each(LANGUAGES)(
    "%s: a unit's symbol is held to its figure on every chart and table",
    (language: string) => {
      for (const [value, unit, symbol] of SYMBOLS) {
        const written: string = ValueFormatter.formatValue(value, unit, {
          language,
        });

        expect({
          unit,
          written,
          breaks: breaksBefore(written, symbol),
        }).toEqual({ unit, written, breaks: false });
        expect(written).toMatch(HOLDING_SPACE);
      }
    },
  );

  test("English writes exactly what it wrote, with the no-break space", () => {
    expect(ValueFormatter.formatValue(1536, "By")).toBe("1.54\u00A0KB");
    expect(ValueFormatter.formatValue(1500, "ms")).toBe("1.5\u00A0sec");
    expect(ValueFormatter.formatValue(90, "s")).toBe("1.5\u00A0min");
    expect(ValueFormatter.formatValue(1500000, "By/s")).toBe("1.5\u00A0MB/s");
    expect(ValueFormatter.formatValue(23.5, "Cel")).toBe("23.5\u00A0°C");
    expect(ValueFormatter.formatValue(5000, "widgets")).toBe("5K\u00A0widgets");
  });

  test("German, French, Arabic and Persian write their own figures, held the same way", () => {
    expect(ValueFormatter.formatValue(1536, "By", { language: "de" })).toBe(
      "1,54\u00A0KB",
    );
    expect(ValueFormatter.formatValue(1536, "By", { language: "fr" })).toBe(
      "1,54\u00A0KB",
    );
    expect(ValueFormatter.formatValue(1536, "By", { language: "ar" })).toBe(
      "1.54\u00A0KB",
    );
    expect(ValueFormatter.formatValue(1536, "By", { language: "fa" })).toBe(
      "۱٫۵۴\u00A0KB",
    );
  });

  test.each(LANGUAGES)(
    "%s: a minute's and a second's short form stays on its figure's line, as English's min and sec do",
    (language: string) => {
      for (const [value, unit] of [
        [120, "sec"],
        [1.5, "s"],
        [0, "seconds"],
      ] as Array<[number, string]>) {
        const parts: FormattedValue = ValueFormatter.formatValueInParts(
          value,
          unit,
          { language },
        );

        expect({
          written: parts.formatted,
          breaks: breaksBefore(parts.formatted, parts.unit),
        }).toEqual({
          written: parts.formatted,
          breaks: false,
        });
      }
    },
  );

  test("a span of time in words is held to its figure too, as DateLanguage holds Intl's", () => {
    expect(ValueFormatter.formatValue(7200, "seconds")).toBe("2\u00A0hours");
    expect(ValueFormatter.formatValue(259200, "seconds")).toBe("3\u00A0days");
    expect(ValueFormatter.formatValue(2, "h")).toBe("2\u00A0hours");

    const german: FormattedValue = ValueFormatter.formatValueInParts(
      24876,
      "s",
      { language: "de" },
    );

    expect(german.unit).toBe("Stunden");
    expect(german.formatted).toBe("6,91\u00A0Stunden");

    for (const language of LANGUAGES) {
      for (const [value, unit] of [
        [24876, "s"],
        [259200, "seconds"],
      ] as Array<[number, string]>) {
        const parts: FormattedValue = ValueFormatter.formatValueInParts(
          value,
          unit,
          { language },
        );

        expect({
          language,
          written: parts.formatted,
          breaks: breaksBefore(parts.formatted, parts.unit),
        }).toEqual({ language, written: parts.formatted, breaks: false });
      }
    }
  });

  test("a unit's name is held as its symbol would be; negative control: a percent, a rate of nothing and no unit have no space", () => {
    expect(ValueFormatter.formatValue(300, "K")).toBe("300\u00A0Kelvin");
    expect(
      ValueFormatter.formatValue(300, "K", {
        unitName: (): string => {
          return "Kelvin";
        },
      }),
    ).toBe("300\u00A0Kelvin");
    expect(ValueFormatter.formatValue(42, "%")).toBe("42.00%");
    expect(ValueFormatter.formatValue(5, "1/s")).toBe("5/s");
    expect(ValueFormatter.formatValue(5, "")).toBe("5");
    expect(ValueFormatter.formatValue(5, "{packets}")).toBe("5");
  });

  test("the compact style a Value tile draws holds its symbol too, in every language", () => {
    for (const language of LANGUAGES) {
      const parts: FormattedValue = ValueFormatter.formatValueCompact(
        3600,
        "seconds",
        { language },
      );

      expect(parts.unit).toBe("h");
      expect(breaksBefore(parts.formatted, "h")).toBe(false);
    }
  });

  test("a widget that draws the figure and the unit apart still sees the unit set apart", () => {
    expect(
      ValueFormatter.isUnitSetApart(
        ValueFormatter.formatValueInParts(1536, "By"),
      ),
    ).toBe(true);
    expect(
      ValueFormatter.isUnitSetApart(
        ValueFormatter.formatValueInParts(7200, "seconds"),
      ),
    ).toBe(true);
    // Negative control: a percent follows its figure with no space.
    expect(
      ValueFormatter.isUnitSetApart(ValueFormatter.formatValueInParts(42, "%")),
    ).toBe(false);
  });
});

describe("DateLanguage's amount of a unit, in the compact notation a scaled figure takes", () => {
  test.each(LANGUAGES)(
    "%s: a thousand and a half minutes in the language's scale, the unit held to it",
    (language: string) => {
      const compact: string | null = formatUnitAmount({
        value: 1500,
        unit: "minute",
        locale: language,
        unitDisplay: "short",
        notation: "compact",
        maximumFractionDigits: 2,
      });
      const standard: string | null = formatUnitAmount({
        value: 1500,
        unit: "minute",
        locale: language,
        unitDisplay: "short",
        maximumFractionDigits: 2,
      });

      expect(compact).not.toBeNull();
      // Negative control: the two notations are cached apart.
      expect(compact).not.toBe(standard);

      const parts: Array<IntlTextPart> = getUnitAmountParts({
        value: 1500,
        unit: "minute",
        locale: language,
        unitDisplay: "short",
        notation: "compact",
        maximumFractionDigits: 2,
      })!;
      const unitAt: number = parts.findIndex((part: IntlTextPart): boolean => {
        return part.type === "unit";
      });
      const before: IntlTextPart | undefined = parts[unitAt - 1];

      expect(unitAt).toBeGreaterThan(0);
      if (before && before.type === "literal") {
        expect(before.value).not.toMatch(new RegExp(BREAKING_SPACE));
      }
    },
  );

  test("English: the scale letter, then the unit held to it", () => {
    expect(
      formatUnitAmount({
        value: 1500,
        unit: "minute",
        locale: "en",
        unitDisplay: "short",
        notation: "compact",
        maximumFractionDigits: 2,
      }),
    ).toBe("1.5K\u00A0min");
  });
});

describe("a dashboard table's cells and thresholds", () => {
  test.each(LANGUAGES)(
    "%s: a cell's figure is held to its column's unit",
    (language: string) => {
      setDateDisplayLanguage(language);

      for (const unit of ["ms", "req/s", "GB", "connections"]) {
        const cell: string = formatTableValue({
          value: 1234.5,
          decimals: 1,
          unit,
        });
        const threshold: string = formatTableThreshold({
          threshold: 0.5,
          unit,
        });

        expect(breaksBefore(cell, unit)).toBe(false);
        expect(cell).toMatch(new RegExp(`\\u00A0${unit.replace("/", "\\/")}$`));
        expect(breaksBefore(threshold, unit)).toBe(false);
      }
    },
  );

  test("negative control: a percent, a degree and a per-mille sign still follow the figure with no space", () => {
    expect(joinTableValueAndUnit("93", "%")).toBe("93%");
    expect(joinTableValueAndUnit("21", "°")).toBe("21°");
    expect(joinTableValueAndUnit("4", "‰")).toBe("4‰");
    expect(joinTableValueAndUnit("4", undefined)).toBe("4");
  });
});

describe("an alert's and an incident's metric values (MetricValueFormatter)", () => {
  test("a scaled value and a labelled one are held to their unit", () => {
    expect(MetricValueFormatter.format({ value: 1073741824, unit: "By" })).toBe(
      "1.07\u00A0GB",
    );
    expect(MetricValueFormatter.format({ value: 1500, unit: "ms" })).toBe(
      "1.5\u00A0sec",
    );
    expect(MetricValueFormatter.format({ value: 95, unit: "Cel" })).toBe(
      "95\u00A0°C",
    );
    expect(MetricValueFormatter.format({ value: 1234567, unit: "cores" })).toBe(
      "1234567\u00A0cores",
    );
  });

  test("a text message still goes out in GSM-7: the no-break space is a space there", () => {
    const value: string = MetricValueFormatter.format({
      value: 1073741824,
      unit: "By",
    });

    expect(toGsm7Text(`Memory at ${value}`)).toBe("Memory at 1.07 GB");
  });

  test("negative control: a value with no dimension is left bare", () => {
    expect(MetricValueFormatter.format({ value: 1500 })).toBe("1500");
    expect(MetricValueFormatter.format({ value: 87.5, unit: "%" })).toBe(
      "87.50%",
    );
  });
});

describe("the figures Common/Types writes for a page", () => {
  test.each(LANGUAGES)(
    "%s: a file's size, from bytes to megabytes",
    (language: string) => {
      for (const [bytes, unit] of [
        [640, "B"],
        [48213, "KB"],
        [2516582, "MB"],
      ] as Array<[number, string]>) {
        const size: string = formatFileSize(bytes, { language });

        expect({ size, breaks: breaksBefore(size, unit) }).toEqual({
          size,
          breaks: false,
        });
        expect(size).toContain(`\u00A0${unit}`);
      }
    },
  );

  test("a web vital's limits, in its tooltip", () => {
    expect(formatWebVitalThreshold(800, "ms")).toBe("800\u00A0ms");
    expect(formatWebVitalThreshold(2500, "ms")).toBe("2.5\u00A0s");
    expect(
      describeWebVitalThresholds({
        unit: "ms",
        thresholds: { warn: 2500, danger: 4000 },
      }),
    ).toBe("Good below 2.5\u00A0s; poor at 4\u00A0s or more.");
    // Negative control: a score has no unit.
    expect(formatWebVitalThreshold(0.1, "score")).toBe("0.1");
  });

  test("an installation's disks and a database's sizes, put into a translated sentence as values", () => {
    expect(InstallationHealthUtil.formatBytes(512 * 1000 * 1000)).toBe(
      "512\u00A0MB",
    );
    expect(InstallationHealthUtil.formatBytes(8.4 * 1000 * 1000 * 1000)).toBe(
      "8.4\u00A0GB",
    );
    expect(InstallationHealthUtil.formatBytes(-1)).toBe("0\u00A0MB");
    expect(formatDatabaseHealthBytes(1_250_000_000)).toBe("1.2\u00A0GB");
    expect(formatDatabaseHealthBytes(512)).toBe("512\u00A0B");
  });

  test("an ingestion budget, in the form's refusal and the owners' email", () => {
    expect(formatTelemetryIngestionBudgetGB(1.5 * 1024 ** 3)).toBe(
      "1.5\u00A0GB",
    );
    expect(formatTelemetryIngestionBudgetMBPerSecond(5 * 1024 * 1024)).toBe(
      "5\u00A0MB per second",
    );
    expect(
      getTelemetryIngestionBudgetValueProblem({
        value: 0,
        kind: TelemetryIngestionBudgetValueKind.DailyBudget,
        allowZero: false,
      }),
    ).toContain("more than 0\u00A0GB per day");
    // Negative control: no figure before the unit, nothing to hold.
    expect(
      getTelemetryIngestionBudgetValueProblem({
        value: "many",
        kind: TelemetryIngestionBudgetValueKind.RateLimit,
        allowZero: false,
      }),
    ).toBe("A rate limit must be a number of MB per second.");
  });

  /*
   * An NTP check's figures are stored in its root cause and read back
   * exactly (RootCauseFacts), which draws them in the reader's words, held:
   * the stored text keeps its plain space, and still reads back.
   */
  test("negative control: an NTP reading is stored with its plain space, and read back", () => {
    expect(NtpMonitorUtil.formatMilliseconds(12.34)).toBe("12.3 ms");
    expect(NtpMonitorUtil.describeClockOffset(-1532.4)).toBe(
      "1,532 ms behind the probe",
    );
    // Negative control: no figure, no unit.
    expect(NtpMonitorUtil.describeClockOffset(0)).toBe(
      "in step with the probe",
    );
  });

  test("a capture's limits, in the form's refusal", () => {
    expect(
      PacketCaptureLimitsUtil.check({
        requested: { maxFileSizeInMB: 500 },
      }).error,
    ).toBe("A capture file is at most 25\u00A0MB.");
    expect(
      PacketCaptureLimitsUtil.check({
        requested: { maxFileSizeInMB: 0 },
      }).error,
    ).toBe("A capture file is at least 1\u00A0MB.");
  });
});

describe("the Dashboard's sizes, in the reader's language", () => {
  const translators: Record<string, Translator> = {};

  for (const language of LANGUAGES) {
    translators[language] = createTranslator(undefined, language);
  }

  test.each(LANGUAGES)(
    "%s: a container's memory request names its size held to its unit",
    (language: string) => {
      const written: string = formatK8sResourceValue(
        "memory",
        "1536Mi",
        translators[language]!,
      );

      expect(written.startsWith("1536Mi (")).toBe(true);
      expect(breaksBefore(written, "GB")).toBe(false);
      expect(written).toContain("\u00A0GB");
    },
  );

  test.each(LANGUAGES)(
    "%s: OpenStack's sizes, on a page and on a chart",
    (language: string) => {
      for (const write of [
        (bytes: number): string => {
          return formatOpenStackBytes(bytes, { language });
        },
        (bytes: number): string => {
          setDateDisplayLanguage(language);
          return formatOpenStackChartBytes(bytes);
        },
      ]) {
        const size: string = write(6 * 1024 ** 4);

        expect({ size, breaks: breaksBefore(size, "TiB") }).toEqual({
          size,
          breaks: false,
        });
        expect(size).toContain("\u00A0TiB");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a telemetry tile's size, in the reader's digits",
    (language: string) => {
      const size: string = formatBytes(1536, translators[language]!);

      expect(breaksBefore(size, "KiB")).toBe(false);
      expect(size).toContain("\u00A0KiB");
    },
  );

  test("a profile's sample in a unit of its own", () => {
    expect(ProfileUtil.formatProfileValue(12, "goroutines")).toBe(
      "12\u00A0goroutines",
    );
    expect(ProfileUtil.formatProfileValue(3, "microseconds")).toBe(
      "3\u00A0microseconds",
    );
  });
});

describe("negative controls: what is words, or read by a machine, keeps its plain space", () => {
  test("a detection's overflow counts its groups in words", () => {
    const sentence: string = describeDetectionOverflow({
      kind: "rule",
      matched: 2340,
      moreThanRead: false,
      opened: 100,
      findingsWritten: true,
    });

    expect(sentence).toContain("matched 2,340 groups.");
    expect(sentence).not.toContain("\u00A0");
  });

  test("a CSV writes the plain space a spreadsheet splits a figure from its unit at", () => {
    for (const language of LANGUAGES) {
      const size: string = formatOpenStackBytes(480 * 1024 ** 3, { language });

      expect(TableColumnsToCsv.withPlainSpaces(size)).toBe(plain(size));
      expect(TableColumnsToCsv.withPlainSpaces(size)).not.toContain("\u00A0");
    }
  });

  test("the helper of this file catches the break it is for", () => {
    expect(breaksBefore("12.5 MB", "MB")).toBe(true);
    expect(breaksBefore("۱٫۵ KB", "KB")).toBe(true);
    expect(breaksBefore("12.5\u00A0MB", "MB")).toBe(false);
    expect(breaksBefore("12,5\u202FMB", "MB")).toBe(false);
    expect(breaksBefore("2 hours", "MB")).toBe(false);
  });
});
