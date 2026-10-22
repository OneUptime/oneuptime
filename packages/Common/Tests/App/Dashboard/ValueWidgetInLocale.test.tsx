import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ValueWidgetView, {
  TREND_DETAILS_TEST_ID,
  TREND_TEST_ID,
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import {
  getMeanOfValues,
  getValueWidgetTrend,
  ValueWidgetPoint,
  ValueWidgetTrend,
} from "../../../Utils/Dashboard/ValueWidgetSeries";

/*
 * The Value widget's own words in the reader's language, from the shipped
 * locale files: the trend's sentence (the arrow's accessible name and its
 * tooltip's first line), the tooltip's halves, "from 0", and the setup and
 * no-data states the hosts hand over in English. German, and Persian, which
 * writes its digits its own way.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

const HOUR_MS: number = 60 * 60 * 1000;
const WEEK_START_MS: number = Date.UTC(2026, 9, 15, 10, 0, 0);

function weekOf(firstHalf: number, secondHalf: number): Array<ValueWidgetPoint> {
  return Array.from({ length: 168 }, (_unused: unknown, hour: number) => {
    return {
      timestamp: new Date(WEEK_START_MS + hour * HOUR_MS),
      value: hour < 84 ? firstHalf : secondHalf,
    };
  });
}

function trendOf(points: Array<ValueWidgetPoint>): ValueWidgetTrend {
  return getValueWidgetTrend({
    points: points,
    reduce: getMeanOfValues,
    windowStart: new Date(WEEK_START_MS),
    windowEnd: new Date(WEEK_START_MS + 168 * HOUR_MS),
    bucketWidthMs: HOUR_MS,
  })!;
}

function viewProps(
  firstHalf: number,
  secondHalf: number,
): ValueWidgetViewProps {
  const points: Array<ValueWidgetPoint> = weekOf(firstHalf, secondHalf);

  return {
    widthInPx: 480,
    heightInPx: 320,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 42,
    points: points,
    trend: trendOf(points),
    noDataMessage: "No data for the selected time range",
    isConfigured: true,
    setupTitle: "Value Widget",
    setupMessage: "Click to configure metric",
    title: "Orders",
    rawUnit: "",
    metricName: "orders.count",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
  };
}

async function openTooltip(): Promise<HTMLElement> {
  jest.useFakeTimers();
  fireEvent.mouseEnter(screen.getByTestId(TREND_TEST_ID));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  return screen.getByTestId(TREND_DETAILS_TEST_ID);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: DE }, fa: { translation: FA } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await act(async () => {
    await i18next.changeLanguage("de");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the Value widget in German", () => {
  test("says which way the number moved, and against what", async () => {
    render(<ValueWidgetView {...viewProps(100, 125)} />);

    expect(screen.getByTestId(TREND_TEST_ID)).toHaveAccessibleName(
      "25% mehr als in der ersten Hälfte des Zeitraums",
    );

    const details: HTMLElement = await openTooltip();

    expect(details).toHaveTextContent(
      "25% mehr als in der ersten Hälfte des Zeitraums",
    );
    expect(details).toHaveTextContent("Erste Hälfte");
    expect(details).toHaveTextContent("Zweite Hälfte");
  });

  test("a fall, a flat week and a rise from nothing", () => {
    const { rerender } = render(
      <ValueWidgetView {...viewProps(400, 300)} />,
    );

    expect(screen.getByTestId(TREND_TEST_ID)).toHaveAccessibleName(
      "25% weniger als in der ersten Hälfte des Zeitraums",
    );

    rerender(<ValueWidgetView {...viewProps(42, 42)} />);
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveAccessibleName(
      "Etwa gleich wie in der ersten Hälfte des Zeitraums",
    );

    rerender(<ValueWidgetView {...viewProps(0, 9)} />);
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveAccessibleName(
      "Von 0 in der ersten Hälfte des Zeitraums gestiegen",
    );
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveTextContent("↑von 0");
  });

  test("the setup prompt and the no-data state the hosts hand over in English", () => {
    const { rerender } = render(
      <ValueWidgetView
        {...viewProps(1, 2)}
        isConfigured={false}
        title={undefined}
      />,
    );

    expect(screen.getByText("Wert-Widget")).toBeInTheDocument();
    expect(
      screen.getByText("Klicken, um eine Metrik zu konfigurieren"),
    ).toBeInTheDocument();

    rerender(<ValueWidgetView {...viewProps(1, 2)} value={null} />);

    expect(
      screen.getByText("Keine Daten für den ausgewählten Zeitraum"),
    ).toBeInTheDocument();
  });

  test("a message a connector wrote is shown as it wrote it", () => {
    render(
      <ValueWidgetView
        {...viewProps(1, 2)}
        value={null}
        noDataMessage="PromQL parse error at char 4"
      />,
    );

    expect(
      screen.getByText("PromQL parse error at char 4"),
    ).toBeInTheDocument();
  });
});

describe("the Value widget in Persian", () => {
  test("a rise from nothing reads 'from ۰' with Persian digits", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    render(<ValueWidgetView {...viewProps(0, 9)} />);

    expect(screen.getByTestId(TREND_TEST_ID)).toHaveTextContent("↑از ۰");
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveAccessibleName(
      "افزایش از ۰ در نیمهٔ اول بازه زمانی",
    );

    const details: HTMLElement = await openTooltip();

    expect(details).toHaveTextContent("نیمهٔ اول");
    expect(details).toHaveTextContent("نیمهٔ دوم");
  });
});
