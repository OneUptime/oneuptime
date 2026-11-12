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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import GaugeWidgetView, {
  GAUGE_BOUNDS_TEST_ID,
  GaugeWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeWidgetView";
import ValueWidgetView, {
  TREND_TEST_ID,
  ValueWidgetViewProps,
  writeValueWidgetTrendPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import ValueFormatter, { FormattedValue } from "../../../Utils/ValueFormatter";
import {
  getMeanOfValues,
  getValueWidgetTrend,
  ValueWidgetPoint,
} from "../../../Utils/Dashboard/ValueWidgetSeries";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A GAUGE'S AND A VALUE WIDGET'S NUMBERS, IN THE READER'S LANGUAGE (#7094).
 *
 * Both drew their numbers with Latin digits and a point on every board -
 * "73.40%" on a Persian board, beside an SLO tile that wrote "۹۹٫۹٪", and
 * "73.4" where German writes "73,4". Each number is written the way the
 * reader's language writes it now: the Gauge's centre, its thresholds'
 * ticks and its bounds; the Value widget's number, its tooltip and its
 * trend. "73,40 %" in German, "۷۳٫۴۰٪" in Persian, Latin digits in
 * Arabic. An English board reads exactly as it did.
 */

const NBSP: string = String.fromCharCode(0xa0);
const LATIN_DIGIT: RegExp = /[0-9]/;
// A digit that is not a Latin one: Persian's, Arabic-Indic, any other.
const OTHER_DIGIT: RegExp = /(?![0-9])\p{Nd}/u;

const baseGaugeProps: GaugeWidgetViewProps = {
  widthInPx: 400,
  heightInPx: 260,
  componentId: "gauge-in-locale",
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: 73.4,
  noDataMessage: "No data for this query",
  isConfigured: true,
  setupTitle: "Gauge",
  setupMessage: "Click to configure this gauge",
  title: "CPU",
  rawUnit: "%",
  metricName: "",
  minValue: 0,
  maxValue: 100,
  warningThreshold: 50,
  criticalThreshold: 80,
};

const HOUR_MS: number = 60 * 60 * 1000;
const WEEK_START_MS: number = Date.UTC(2026, 10, 2, 10, 0, 0);

function weekOf(
  firstHalf: number,
  secondHalf: number,
): Array<ValueWidgetPoint> {
  return Array.from({ length: 168 }, (_unused: unknown, hour: number) => {
    return {
      timestamp: new Date(WEEK_START_MS + hour * HOUR_MS),
      value: hour < 84 ? firstHalf : secondHalf,
    };
  });
}

function valueProps(
  overrides: Partial<ValueWidgetViewProps> = {},
): ValueWidgetViewProps {
  const points: Array<ValueWidgetPoint> = weekOf(100, 112.5);

  return {
    widthInPx: 480,
    heightInPx: 320,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 73.4,
    points: points,
    trend: getValueWidgetTrend({
      points: points,
      reduce: getMeanOfValues,
      windowStart: new Date(WEEK_START_MS),
      windowEnd: new Date(WEEK_START_MS + 168 * HOUR_MS),
      bucketWidthMs: HOUR_MS,
    }),
    noDataMessage: "No data for the selected time range",
    isConfigured: true,
    setupTitle: "Value Widget",
    setupMessage: "Click to configure a metric",
    title: "CPU",
    rawUnit: "%",
    metricName: "",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
    ...overrides,
  };
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
  const centre: HTMLElement = document.querySelector(
    "div.font-bold.tabular-nums",
  ) as HTMLElement;
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

// The labels on the threshold ticks (SVG <title>s of their <line>s).
function tickLabels(): Array<string> {
  return Array.from(document.querySelectorAll("line > title")).map(
    (title: Element): string => {
      return title.textContent || "";
    },
  );
}

// The Value widget's big number, its unit inside it.
function valueNumber(): HTMLElement {
  return document.querySelector("div.tabular-nums.truncate") as HTMLElement;
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

describe("the Gauge's numbers", () => {
  test("on an English board, as they always were", () => {
    renderGauge();

    expect(gaugeCentre()).toEqual({ value: "73.40", unit: "%", gap: "0" });
    expect(gaugeBounds()).toEqual(["0.00%", "100.00%"]);
    expect(tickLabels()).toEqual(["50.00%", "80.00%"]);
  });

  test("on a German board: a decimal comma, and the percent sign set apart", async () => {
    await inLanguage("de");
    renderGauge();

    expect(gaugeCentre()).toEqual({
      value: "73,40",
      unit: "%",
      gap: "0.15em",
    });
    expect(gaugeBounds()).toEqual([`0,00${NBSP}%`, `100,00${NBSP}%`]);
    expect(tickLabels()).toEqual([`50,00${NBSP}%`, `80,00${NBSP}%`]);
  });

  test("on a Persian board: Persian digits everywhere, the bounds still under the arc's two ends", async () => {
    await inLanguage("fa");
    renderGauge();

    expect(gaugeCentre()).toEqual({ value: "۷۳٫۴۰", unit: "٪", gap: "0" });
    expect(gaugeBounds()).toEqual(["۰٫۰۰٪", "۱۰۰٫۰۰٪"]);
    expect(tickLabels()).toEqual(["۵۰٫۰۰٪", "۸۰٫۰۰٪"]);

    for (const text of [
      gaugeCentre().value,
      gaugeCentre().unit,
      ...gaugeBounds(),
      ...tickLabels(),
    ]) {
      expect(text).not.toMatch(LATIN_DIGIT);
    }

    // Laid out left to right, as the arc fills, on every board.
    expect(screen.getByTestId(GAUGE_BOUNDS_TEST_ID)).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("on an Arabic board: the Latin digits Arabic pages write", async () => {
    await inLanguage("ar");
    renderGauge();

    const centre: { value: string; unit: string; gap: string } = gaugeCentre();

    expect(centre.value).toBe("73.40");
    expect(centre.unit).toContain("%");
    expect(centre.gap).toBe("0");

    for (const text of [centre.value, ...gaugeBounds(), ...tickLabels()]) {
      expect(text).not.toMatch(OTHER_DIGIT);
    }
  });

  test("a unit's number is the reader's, the unit's words as they were", async () => {
    await inLanguage("de");
    renderGauge({
      value: 1536,
      rawUnit: "By",
      minValue: 0,
      maxValue: 4096,
      warningThreshold: undefined,
      criticalThreshold: undefined,
    });

    expect(gaugeCentre()).toEqual({
      value: "1,54",
      unit: "KB",
      gap: "0.15em",
    });
    expect(gaugeBounds()).toEqual(["0 B", "4,1 KB"]);
  });

  test("a fraction metric reads as a percentage in the reader's language", async () => {
    await inLanguage("fa");
    renderGauge({
      value: 0.25,
      rawUnit: "1",
      metricName: "system.cpu.utilization",
      warningThreshold: undefined,
      criticalThreshold: undefined,
    });

    expect(gaugeCentre()).toEqual({ value: "۲۵٫۰۰", unit: "٪", gap: "0" });
  });

  test("the gauge follows the reader when they change language", async () => {
    renderGauge();
    expect(gaugeCentre().value).toBe("73.40");

    await inLanguage("de");
    expect(gaugeCentre().value).toBe("73,40");

    await inLanguage("fa");
    expect(gaugeCentre().value).toBe("۷۳٫۴۰");
  });

  test("every Dashboard language writes the gauge's numbers as the formatter writes them for it", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      await inLanguage(language);
      renderGauge();

      const parts: FormattedValue = ValueFormatter.formatValueInParts(
        73.4,
        "%",
        { language },
      );

      expect({ language, centre: gaugeCentre().value }).toEqual({
        language,
        centre: parts.value,
      });
      expect(gaugeCentre().gap).toBe(
        ValueFormatter.isUnitSetApart(parts) ? "0.15em" : "0",
      );
      cleanup();
    }
  });
});

describe("the Value widget's numbers", () => {
  test("on an English board, as they always were", () => {
    render(<ValueWidgetView {...valueProps()} />);

    expect(valueNumber().textContent).toBe("73.40%");
    expect(valueNumber()).toHaveAttribute("title", "73.40%");
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveTextContent("12.5%");
  });

  test("on a German board: a decimal comma, the percent sign set apart, and the trend German too", async () => {
    await inLanguage("de");
    render(<ValueWidgetView {...valueProps()} />);

    expect(valueNumber().firstChild?.textContent).toBe("73,40");
    expect(valueNumber().querySelector("span")?.textContent).toBe(" %");
    expect(valueNumber()).toHaveAttribute("title", `73,40${NBSP}%`);
    expect(
      screen.getByTestId(TREND_TEST_ID).querySelector(".tabular-nums")
        ?.textContent,
    ).toBe(`12,5${NBSP}%`);
  });

  test("on a Persian board: Persian digits in the number, its tooltip and its trend", async () => {
    await inLanguage("fa");
    render(<ValueWidgetView {...valueProps()} />);

    expect(valueNumber().textContent).toBe("۷۳٫۴۰٪");
    expect(valueNumber()).toHaveAttribute("title", "۷۳٫۴۰٪");
    expect(valueNumber().textContent).not.toMatch(LATIN_DIGIT);

    const trend: HTMLElement = screen.getByTestId(TREND_TEST_ID);

    expect(trend.querySelector(".tabular-nums")?.textContent).toBe("۱۲٫۵٪");
    expect(trend.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("on an Arabic board: Latin digits, the percent sign as Arabic sets it", async () => {
    await inLanguage("ar");
    render(<ValueWidgetView {...valueProps()} />);

    expect(valueNumber().firstChild?.textContent).toBe("73.40");
    expect(valueNumber().textContent).not.toMatch(OTHER_DIGIT);
    expect(valueNumber().textContent).toContain("%");
  });

  test("a value with a unit symbol: the reader's number, the symbol beside it", async () => {
    await inLanguage("de");
    render(
      <ValueWidgetView {...valueProps({ value: 23.5, rawUnit: "Cel" })} />,
    );

    expect(valueNumber().textContent).toBe("23,5 °C");
  });

  test("hideUnit keeps the reader's number alone", async () => {
    await inLanguage("fa");
    render(
      <ValueWidgetView
        {...valueProps({ value: 23.5, rawUnit: "Cel", hideUnit: true })}
      />,
    );

    expect(valueNumber().textContent).toBe("۲۳٫۵");
  });

  test("the widget follows the reader when they change language", async () => {
    render(<ValueWidgetView {...valueProps()} />);
    expect(valueNumber().textContent).toBe("73.40%");

    await inLanguage("fa");
    expect(valueNumber().textContent).toBe("۷۳٫۴۰٪");

    await inLanguage("en");
    expect(valueNumber().textContent).toBe("73.40%");
  });
});

describe("writeValueWidgetTrendPercent", () => {
  test("rounds to a tenth and drops a zero tenth, in English as before", () => {
    const english: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("en");

    expect(writeValueWidgetTrendPercent(12.5, english)).toBe("12.5%");
    expect(writeValueWidgetTrendPercent(25, english)).toBe("25%");
    expect(writeValueWidgetTrendPercent(-25, english)).toBe("25%");
    expect(writeValueWidgetTrendPercent(0, english)).toBe("0%");
  });

  test("in the reader's language: German sets the sign apart, Persian writes its own digits", () => {
    expect(writeValueWidgetTrendPercent(12.5, dashboardTranslator("de"))).toBe(
      `12,5${NBSP}%`,
    );
    expect(writeValueWidgetTrendPercent(-25, dashboardTranslator("de"))).toBe(
      `25${NBSP}%`,
    );
    expect(writeValueWidgetTrendPercent(12.5, dashboardTranslator("fa"))).toBe(
      "۱۲٫۵٪",
    );
  });
});
