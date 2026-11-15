import { describe, expect, test } from "@jest/globals";
import ValueFormatter from "../../Utils/ValueFormatter";
import { getTickTextLength } from "../../UI/Components/Charts/Utils/YAxisWidth";

/*
 * A UNIT WITH A SYMBOL IS WRITTEN BY IT BESIDE ITS VALUE (#8284).
 *
 * ValueFormatter wrote a unit no threshold table scales by its English
 * name on every value - "23,5 Celsius" on a German axis, "۲۳٫۵ Celsius" on
 * a Persian one, "98.6 Fahrenheit" as the widest tick on the axis. Its
 * symbol now, as "ms", "MB/s" and "%" always were, in every language; the
 * name in words stays in the unit chip and the metric's details.
 */
const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const SYMBOLS: Array<[string, string]> = [
  ["Cel", "°C"],
  ["[degF]", "°F"],
  ["Hz", "Hz"],
  ["kHz", "kHz"],
  ["MHz", "MHz"],
  ["GHz", "GHz"],
  ["V", "V"],
  ["W", "W"],
  ["kW", "kW"],
  ["J", "J"],
  ["A", "A"],
  ["KiBy", "KiB"],
  ["MiBy", "MiB"],
  ["GiBy", "GiB"],
  ["KBy", "kB"],
  ["kbit", "kbit"],
];

describe("a unit with a symbol, beside its value", () => {
  test.each(SYMBOLS)(
    "%s is written %s, never its English name, in every language",
    (unit: string, symbol: string) => {
      for (const language of LANGUAGES) {
        const formatted: string = ValueFormatter.formatValue(23.5, unit, {
          language: language,
        });
        const english: string = ValueFormatter.getReadableUnit(unit);

        // Held to its figure by a no-break space (#8457).
        expect(formatted.endsWith(`\u00A0${symbol}`)).toBe(true);
        expect(formatted).not.toContain(english);
      }
    },
  );

  test("the figure beside it is the reader's", () => {
    expect(ValueFormatter.formatValue(23.5, "Cel")).toBe("23.5\u00A0°C");
    expect(ValueFormatter.formatValue(23.5, "Cel", { language: "de" })).toBe(
      "23,5\u00A0°C",
    );
    expect(ValueFormatter.formatValue(23.5, "Cel", { language: "fa" })).toBe(
      "۲۳٫۵\u00A0°C",
    );
    expect(ValueFormatter.formatValue(23.5, "Cel", { language: "ar" })).toBe(
      "23.5\u00A0°C",
    );
    expect(ValueFormatter.formatValue(98.6, "[degF]")).toBe("98.6\u00A0°F");
    expect(ValueFormatter.formatValue(230, "V", { language: "fa" })).toBe(
      "۲۳۰\u00A0V",
    );
  });

  test("the tick is short: 98.6 °F is seven characters, not fifteen", () => {
    expect(getTickTextLength(ValueFormatter.formatValue(98.6, "[degF]"))).toBe(
      7,
    );
  });

  test("a span in minutes, hours or days reads as the seconds table writes one, in the reader's words", () => {
    expect(ValueFormatter.formatValue(2, "h")).toBe("2 hours");
    expect(ValueFormatter.formatValue(2, "hours")).toBe("2 hours");
    expect(ValueFormatter.formatValue(5, "min")).toBe("5\u00A0min");
    expect(ValueFormatter.formatValue(3, "d")).toBe("3 days");
    expect(ValueFormatter.formatValue(2, "h", { language: "de" })).toBe(
      "2 Stunden",
    );
    expect(ValueFormatter.formatValue(5, "min", { language: "de" })).toBe(
      "5\u00A0Min.",
    );
    expect(ValueFormatter.formatValue(2, "h", { language: "fa" })).not.toMatch(
      /[0-9]|hours/,
    );
  });

  test("the unit chip still names the unit in words", () => {
    expect(ValueFormatter.getReadableUnit("Cel")).toBe("Celsius");
    expect(ValueFormatter.getReadableUnit("Hz")).toBe("Hertz");
    expect(ValueFormatter.getCompactUnit("Cel")).toBe("°C");
  });

  test("a unit with no symbol keeps its name: the reader's, when the caller names it", () => {
    // UCUM's "a" is a year (an annum), never an ampere; "K" sits too near "300K".
    expect(ValueFormatter.formatValue(3, "a")).toBe("3 Amperes");
    expect(ValueFormatter.formatValue(300, "K")).toBe("300 Kelvin");
    expect(
      ValueFormatter.formatValue(300, "K", {
        language: "de",
        unitName: (): string => {
          return "Kelvin (de)";
        },
      }),
    ).toBe("300 Kelvin (de)");
    expect(ValueFormatter.formatValue(5, "widgets")).toBe("5\u00A0widgets");
  });

  test("a caller that names units cannot turn a symbol back into a word", () => {
    expect(
      ValueFormatter.formatValue(50, "Hz", {
        language: "fa",
        unitName: (): string => {
          return "هرتز";
        },
      }),
    ).toBe("۵۰\u00A0Hz");
  });

  test("what already read well reads as it did", () => {
    expect(ValueFormatter.formatValue(1500000, "By/s")).toBe("1.5\u00A0MB/s");
    expect(ValueFormatter.formatValue(42, "ms")).toBe("42\u00A0ms");
    expect(ValueFormatter.formatValue(25, "%")).toBe("25.00%");
    expect(ValueFormatter.formatValue(100, "req/s")).toBe("100\u00A0req/s");
    expect(ValueFormatter.formatValue(42, "{thread}")).toBe("42");
  });
});
