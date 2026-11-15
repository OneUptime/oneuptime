import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import GaugeWidgetView, {
  GAUGE_BOUNDS_TEST_ID,
  GAUGE_VALUE_TEST_ID,
  GaugeWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeWidgetView";
import ValueWidgetView, {
  VALUE_WIDGET_NUMBER_TEST_ID,
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import ValueFormatter from "../../../Utils/ValueFormatter";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A GAUGE'S AND A VALUE WIDGET'S UNIT AND SCALE, IN THE READER'S LANGUAGE
 * (#7518).
 *
 * PR #7413 wrote the two widgets' numbers in the reader's digits and left
 * the unit beside them English: a German Gauge on a duration read "6,91
 * hours", a Persian one "۶٫۹۱ hours", a request rate "12,5 per Second",
 * and a Value widget's big count kept English's scale letter after the
 * reader's digits, "۱۵٫۳K". The unit is the reader's now - "6,91 Stunden",
 * "۶٫۹۱ ساعت", "۲۳۰ ولت" - and a big number is written in their
 * own short scale: "15.300", "1,2 Mio.", "۱۵٫۳ هزار", "1.53万". The symbols
 * every language writes alike (%, MB/s, °C) stay as they are, and an
 * English board reads exactly as it did.
 */

const NBSP: string = String.fromCharCode(0xa0);
const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
// English's words for a unit, as the formatter named them.
const ENGLISH_UNIT_WORD: RegExp = /\b(hours|days|per Second|per Minute)\b/;

const HOURS: number = 6.91 * 3600;

const baseGaugeProps: GaugeWidgetViewProps = {
  widthInPx: 400,
  heightInPx: 260,
  componentId: "gauge-units-in-locale",
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: HOURS,
  noDataMessage: "No data for this query",
  isConfigured: true,
  setupTitle: "Gauge",
  setupMessage: "Click to configure this gauge",
  title: "Uptime",
  rawUnit: "s",
  metricName: "",
  minValue: 0,
  maxValue: 86400,
  warningThreshold: undefined,
  criticalThreshold: undefined,
};

function valueProps(
  overrides: Partial<ValueWidgetViewProps> = {},
): ValueWidgetViewProps {
  return {
    widthInPx: 480,
    heightInPx: 320,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 15300,
    points: [],
    trend: null,
    noDataMessage: "No data for the selected time range",
    isConfigured: true,
    setupTitle: "Value Widget",
    setupMessage: "Click to configure a metric",
    title: "Requests",
    rawUnit: "1",
    metricName: "",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
    ...overrides,
  };
}

function words(language: string): Record<string, string> {
  return readDashboardLocale(language);
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function renderGauge(overrides: Partial<GaugeWidgetViewProps> = {}): void {
  render(<GaugeWidgetView {...baseGaugeProps} {...overrides} />);
}

// The gauge's centre: its number, and its unit in a smaller span.
function gaugeCentre(): { value: string; unit: string; gap: string } {
  const centre: HTMLElement = screen.getByTestId(GAUGE_VALUE_TEST_ID);
  const unit: HTMLElement | null = centre.querySelector("span");

  return {
    value: centre.firstChild?.textContent || "",
    unit: unit?.textContent || "",
    gap: unit?.style.marginInlineStart || "",
  };
}

function gaugeBounds(): Array<string> {
  return Array.from(
    screen.getByTestId(GAUGE_BOUNDS_TEST_ID).querySelectorAll("span"),
  ).map((bound: Element): string => {
    return bound.textContent || "";
  });
}

function valueNumber(): HTMLElement {
  return screen.getByTestId(VALUE_WIDGET_NUMBER_TEST_ID);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("a Gauge on a span of time", () => {
  test("on an English board, as it always read", () => {
    renderGauge();

    expect(gaugeCentre()).toEqual({
      value: "6.91",
      unit: "hours",
      gap: "0.15em",
    });
    expect(gaugeBounds()).toEqual(["0 sec", "1 days"]);
  });

  test("on a German board: German's words, in the form the number takes", async () => {
    await inLanguage("de");
    renderGauge();

    expect(gaugeCentre()).toEqual({
      value: "6,91",
      unit: "Stunden",
      gap: "0.15em",
    });
    expect(gaugeBounds()).toEqual(["0 Sek.", "1 Tag"]);
  });

  test("on a Persian board: Persian words and digits, nothing Latin", async () => {
    await inLanguage("fa");
    renderGauge();

    expect(gaugeCentre()).toEqual({
      value: "۶٫۹۱",
      unit: "ساعت",
      gap: "0.15em",
    });

    for (const text of [
      gaugeCentre().value,
      gaugeCentre().unit,
      ...gaugeBounds(),
    ]) {
      expect(text).not.toMatch(LATIN_DIGIT);
      expect(text).not.toMatch(LATIN_LETTER);
    }

    // In the board's own letters: no dir of its own.
    expect(screen.getByTestId(GAUGE_VALUE_TEST_ID)).not.toHaveAttribute("dir");
  });

  test("on an Arabic board: Arabic's words, Latin digits", async () => {
    await inLanguage("ar");
    renderGauge();

    expect(gaugeCentre()).toEqual({
      value: "6.91",
      unit: "ساعة",
      gap: "0.15em",
    });
    expect(screen.getByTestId(GAUGE_VALUE_TEST_ID)).not.toHaveAttribute("dir");
  });

  test("on a Chinese board, the unit is set against its number, as Chinese sets it", async () => {
    await inLanguage("zh-CN");
    renderGauge();

    expect(gaugeCentre()).toEqual({ value: "6.91", unit: "小时", gap: "0" });
  });

  test("the gauge follows the reader when they change language", async () => {
    renderGauge();
    expect(gaugeCentre().unit).toBe("hours");

    await inLanguage("de");
    expect(gaugeCentre().unit).toBe("Stunden");

    await inLanguage("fa");
    expect(gaugeCentre().unit).toBe("ساعت");

    await inLanguage("en");
    expect(gaugeCentre().unit).toBe("hours");
  });
});

/*
 * A unit with a symbol ("Hz", "V") reads by its symbol beside the number,
 * as "ms" and "MB" always have, in every language: the same as the chart
 * beside the Gauge writes it (#8284). A unit the formatter names in words
 * and has no symbol for ("Kelvin") reads in the reader's words; a rate
 * keeps the slash a chart writes it with (#8049): "12,5/s", "۱۲٫۵/s".
 */
describe("a Gauge on a unit with a symbol, one named in words, and a rate", () => {
  const RATE: Partial<GaugeWidgetViewProps> = {
    value: 12.5,
    rawUnit: "1/s",
    minValue: 0,
    maxValue: 100,
  };

  test.each([
    ["en", "50", "Hz"],
    ["de", "50", "Hz"],
    ["fa", "۵۰", "Hz"],
    ["ar", "50", "Hz"],
  ])(
    "on a %s board a frequency reads %s %s",
    async (language: string, value: string, unit: string) => {
      await inLanguage(language);
      renderGauge({ value: 50, rawUnit: "Hz", minValue: 0, maxValue: 100 });

      expect(gaugeCentre().value).toBe(value);
      expect(gaugeCentre().unit).toBe(unit);
    },
  );

  test("on a Persian board, a voltage in Persian's digits and its symbol", async () => {
    await inLanguage("fa");
    renderGauge({ value: 230, rawUnit: "V", minValue: 0, maxValue: 400 });

    expect(gaugeCentre()).toEqual({ value: "۲۳۰", unit: "V", gap: "0.15em" });
  });

  test.each([
    ["en", "300", "Kelvin"],
    ["fa", "۳۰۰", "کلوین"],
  ])(
    "on a %s board a unit with no symbol reads in the reader's words: %s %s",
    async (language: string, value: string, unit: string) => {
      await inLanguage(language);
      renderGauge({ value: 300, rawUnit: "K", minValue: 0, maxValue: 400 });

      expect(gaugeCentre().value).toBe(value);
      expect(gaugeCentre().unit).toBe(unit);
    },
  );

  test.each([
    ["en", "12.5"],
    ["de", "12,5"],
    ["fa", "۱۲٫۵"],
    ["ar", "12.5"],
  ])(
    "on a %s board a rate of a count keeps its slash: %s/s",
    async (language: string, value: string) => {
      await inLanguage(language);
      renderGauge(RATE);

      expect(gaugeCentre()).toEqual({ value: value, unit: "/s", gap: "0" });
    },
  );

  test("a rate in bytes keeps its symbol on every board", async () => {
    for (const language of ["de", "fa", "ar"]) {
      await inLanguage(language);
      renderGauge({ value: 1960000, rawUnit: "By/s", maxValue: 5000000 });

      expect({ language, unit: gaugeCentre().unit }).toEqual({
        language,
        unit: "MB/s",
      });
      cleanup();
    }
  });
});

describe("no English unit word on a Gauge, in any Dashboard language", () => {
  test.each([
    [HOURS, "s"],
    [2 * 86400, "s"],
    [12.5, "1/s"],
    [3 * 60, "s"],
  ])("%d %s", async (value: number, rawUnit: string) => {
    for (const language of DASHBOARD_LANGUAGES) {
      await inLanguage(language);
      renderGauge({ value, rawUnit, minValue: 0, maxValue: 3 * 86400 });

      const centre: string = screen.getByTestId(GAUGE_VALUE_TEST_ID)
        .textContent as string;

      expect({
        language,
        centre,
        english: ENGLISH_UNIT_WORD.test(centre),
      }).toEqual({ language, centre, english: false });
      cleanup();
    }
  });
});

describe("a Value widget's big number, in the reader's own scale", () => {
  test("on an English board, with English's letter, as it always read", () => {
    render(<ValueWidgetView {...valueProps()} />);

    expect(valueNumber().textContent).toBe("15.3K");
  });

  test.each([
    ["de", 15300, "15.300"],
    ["de", 1200000, `1,2${NBSP}Mio.`],
    ["fa", 15300, `۱۵٫۳${NBSP}هزار`],
    ["fa", 1200000, `۱٫۲${NBSP}میلیون`],
    ["ar", 1200000, `1.2${NBSP}مليون`],
    ["ja", 15300, "1.53万"],
    ["ru", 15300, `15,3${NBSP}тыс.`],
  ])(
    "on a %s board %d reads %s",
    async (language: string, value: number, written: string) => {
      await inLanguage(language);
      render(<ValueWidgetView {...valueProps({ value })} />);

      expect(valueNumber().textContent).toBe(written);
      expect(valueNumber()).toHaveAttribute("title", written);
    },
  );

  test("on a Persian board no Latin letter or digit is left in it", async () => {
    await inLanguage("fa");

    for (const value of [1234, 15300, 1.2e6, 119.25e9]) {
      render(<ValueWidgetView {...valueProps({ value })} />);

      expect(valueNumber().textContent).not.toMatch(LATIN_DIGIT);
      expect(valueNumber().textContent).not.toMatch(LATIN_LETTER);
      cleanup();
    }
  });

  test("a value with a unit symbol: the reader's scale, the symbol beside it", async () => {
    await inLanguage("de");
    render(
      <ValueWidgetView {...valueProps({ value: 1960000, rawUnit: "By/s" })} />,
    );

    expect(valueNumber().textContent).toBe("1,96 MB/s");
  });

  test("its time unit keeps its symbol, which every language reads", async () => {
    await inLanguage("de");
    render(<ValueWidgetView {...valueProps({ value: HOURS, rawUnit: "s" })} />);

    expect(valueNumber().textContent).toBe("6,91 h");
  });

  test("the widget follows the reader when they change language", async () => {
    render(<ValueWidgetView {...valueProps()} />);
    expect(valueNumber().textContent).toBe("15.3K");

    await inLanguage("de");
    expect(valueNumber().textContent).toBe("15.300");

    await inLanguage("en");
    expect(valueNumber().textContent).toBe("15.3K");
  });

  test("every Dashboard language writes the number as the formatter writes it for that language", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      await inLanguage(language);
      render(<ValueWidgetView {...valueProps({ value: 1.2e6 })} />);

      expect({ language, written: valueNumber().textContent }).toEqual({
        language,
        written: ValueFormatter.formatValueCompact(1.2e6, "1", { language })
          .formatted,
      });
      cleanup();
    }
  });
});

describe("the words", () => {
  test("a rate with no numerator is worded in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        worded: isWordedInDashboardLocale("per {{denominator}}", language),
      }).toEqual({ language, worded: true });
    }

    // Negative control: a key no locale words.
    expect(isWordedInDashboardLocale("per {{nothing}} at all", "de")).toBe(
      false,
    );
  });

  test("its German is German", () => {
    expect(words("de")["per {{denominator}}"]).toBe("pro {{denominator}}");
  });

  test("both widgets hand the formatter the reader's options, not a bare language", () => {
    const COMPONENTS_DIR: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
    );

    for (const file of ["GaugeWidgetView.tsx", "ValueWidgetView.tsx"]) {
      const source: string = fs.readFileSync(
        path.join(COMPONENTS_DIR, file),
        "utf8",
      );

      expect(source).toContain("getValueFormatterOptionsForReader");
      expect(source).not.toContain("{ metricName, language }");
    }
  });
});
