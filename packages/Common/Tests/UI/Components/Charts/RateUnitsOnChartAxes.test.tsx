// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import { createTranslator, Translator } from "../../../../Types/Translator";
import { getUnitNameInLanguage } from "../../../../UI/Components/Charts/Utils/UnitNames";
import {
  getTickTextLength,
  getYAxisWidthInPx,
  Y_AXIS_MAX_WIDTH_IN_PX,
  Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX,
  Y_AXIS_TICK_PADDING_IN_PX,
  Y_AXIS_WIDTH_IN_PX,
} from "../../../../UI/Components/Charts/Utils/YAxisWidth";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";

/*
 * A CHART'S RATE UNIT, AS A CHART WRITES IT (#8049).
 *
 * A metric chart whose unit is a rate the formatter cannot scale - a page's
 * "req/s" or "resp/s" (the Kubernetes Control Plane's API Server Request
 * Rate and CoreDNS's responses), an exporter's "{request}/s" - wrote the
 * unit out in words on every y-axis tick and in its legend value: "100 req
 * per Second". Too wide for the 64px axis, each tick broke over two lines
 * ("80 req per" / "Second") and the top one was cut at the card's edge;
 * "Second" was English, capitalised mid-phrase, in every language; and the
 * unit chip above said it a third way ("req/秒" in Japanese).
 *
 * Now a rate keeps its slash wherever a value is written ("100 req/s", as
 * "1.5 MB/s" always was), its words stay where there is room for them, in
 * the reader's language (the unit chip, the metric's details), and the
 * value axis is as wide as its widest tick, so no tick wraps or is cut.
 */

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart",
  () => {
    return {
      __esModule: true,
      LineChart: (props: { yAxisWidth?: number }): ReactElement => {
        return (
          <div
            data-testid="chart-library"
            data-y-axis-width={props.yAxisWidth}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart",
  () => {
    return {
      __esModule: true,
      BarChart: (props: { yAxisWidth?: number }): ReactElement => {
        return (
          <div
            data-testid="chart-library"
            data-y-axis-width={props.yAxisWidth}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart",
  () => {
    return {
      __esModule: true,
      AreaChart: (props: { yAxisWidth?: number }): ReactElement => {
        return (
          <div
            data-testid="chart-library"
            data-y-axis-width={props.yAxisWidth}
          />
        );
      },
    };
  },
);

import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

async function translatorFor(language: string): Promise<Translator> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return createTranslator((text: string): string | undefined => {
    if (!instance.exists(text)) {
      return undefined;
    }

    return instance.t(text, { defaultValue: text }) as string;
  }, language);
}

const PERSIAN_DIGITS: RegExp = /[۰-۹]/;
const LATIN_DIGITS: RegExp = /[0-9]/;

afterEach(() => {
  cleanup();
});

describe("a rate, written on a chart's axis, legend and tooltip", () => {
  test("the page's own rates keep their slash: 100 req/s, 85.7 resp/s", () => {
    expect(ValueFormatter.formatValue(100, "req/s")).toBe("100\u00A0req/s");
    expect(ValueFormatter.formatValue(85.7, "req/s")).toBe("85.7\u00A0req/s");
    expect(ValueFormatter.formatValue(12, "resp/s")).toBe("12\u00A0resp/s");
    // A thousand and more is shortened as every count is.
    expect(ValueFormatter.formatValue(1850, "req/s")).toBe("1.85K\u00A0req/s");
  });

  test("regression: the words 'per Second' are never written into a value", () => {
    for (const unit of [
      "req/s",
      "resp/s",
      "requests/s",
      "{request}/s",
      "{packets}/s",
      "1/s",
      "ops/min",
      "ug/m3",
      "%/s",
      "KiBy/s",
      "events/h",
    ]) {
      for (const value of [0, 0.5, 12, 100, 1850, 2500000]) {
        const written: string = ValueFormatter.formatValue(value, unit);

        expect(written).not.toMatch(/ per /);
        expect(written).not.toMatch(/Second|Minute|Hour/);
        expect(written).toContain("/");
      }
    }
  });

  test("an exporter's annotation reads as its word, a count per second as /s", () => {
    expect(ValueFormatter.formatValue(5, "{request}/s")).toBe(
      "5\u00A0request/s",
    );
    expect(ValueFormatter.formatValue(5, "1/s")).toBe("5/s");
    expect(ValueFormatter.formatValue(12, "ug/m3")).toBe("12\u00A0ug/m3");
    expect(ValueFormatter.formatValue(4, "KiBy/s")).toBe("4\u00A0KiB/s");
    expect(ValueFormatter.formatValue(30, "ops/min")).toBe("30\u00A0ops/min");
  });

  test("what already read well reads as it did: a byte rate is scaled", () => {
    expect(ValueFormatter.formatValue(1500000, "By/s")).toBe("1.5\u00A0MB/s");
    expect(ValueFormatter.formatValue(2000, "bytes/s")).toBe("2\u00A0KB/s");
    expect(ValueFormatter.formatValue(1500, "ms/s")).toBe("1.5\u00A0sec/s");
    expect(ValueFormatter.formatValue(42, "{thread}")).toBe("42");
    // A unit with a symbol is written by it, never its English name (#8284).
    expect(ValueFormatter.formatValue(23.5, "Cel")).toBe("23.5\u00A0°C");
  });

  test("the number and the unit, apart: the unit is the rate's symbol", () => {
    expect(ValueFormatter.formatValueInParts(100, "req/s")).toEqual({
      value: "100",
      unit: "req/s",
      formatted: "100\u00A0req/s",
    });
    expect(ValueFormatter.formatValueInParts(5, "1/s")).toEqual({
      value: "5",
      unit: "/s",
      formatted: "5/s",
    });
    expect(
      ValueFormatter.isUnitSetApart(
        ValueFormatter.formatValueInParts(100, "req/s"),
      ),
    ).toBe(true);
    expect(
      ValueFormatter.isUnitSetApart(
        ValueFormatter.formatValueInParts(5, "1/s"),
      ),
    ).toBe(false);
  });

  test("a value tile writes the same symbol", () => {
    expect(ValueFormatter.formatValueCompact(100, "req/s").formatted).toBe(
      "100\u00A0req/s",
    );
    expect(ValueFormatter.formatValueCompact(5, "{request}/s").formatted).toBe(
      "5\u00A0request/s",
    );
    expect(ValueFormatter.getCompactUnit("{request}/s")).toBe("request/s");
    expect(ValueFormatter.getCompactUnit("1/s")).toBe("/s");
  });

  test("in German, the figure in German's digits and the unit as written", () => {
    expect(ValueFormatter.formatValue(85.7, "req/s", { language: "de" })).toBe(
      "85,7\u00A0req/s",
    );
    expect(ValueFormatter.formatValue(100, "req/s", { language: "de" })).toBe(
      "100\u00A0req/s",
    );
    expect(ValueFormatter.formatValue(5, "1/s", { language: "de" })).toBe(
      "5/s",
    );
  });

  test("in Persian, the reader's digits and no Latin digit", () => {
    const written: string = ValueFormatter.formatValue(85.7, "req/s", {
      language: "fa",
    });

    expect(written).toMatch(PERSIAN_DIGITS);
    expect(written).not.toMatch(LATIN_DIGITS);
    expect(written.endsWith("\u00A0req/s")).toBe(true);
  });
});

describe("where there is room, the rate keeps its words, in the reader's language", () => {
  test("the unit chip names it in words: English as it always has", async () => {
    // The formatter still names it so for the chip and the details.
    expect(ValueFormatter.getReadableUnit("req/s")).toBe("req per Second");
    expect(getUnitNameInLanguage("By/s", await translatorFor("en"))).toBe(
      "Bytes per Second",
    );
  });

  test("German and Russian word the period, never 'Second'", async () => {
    const german: string = getUnitNameInLanguage(
      "req/s",
      await translatorFor("de"),
    );
    const russian: string = getUnitNameInLanguage(
      "req/s",
      await translatorFor("ru"),
    );

    expect(german).toContain("req");
    expect(german).not.toContain("Second");
    expect(russian).toContain("req");
    expect(russian).not.toContain("Second");
  });
});

describe("the value axis, as wide as its widest tick (getYAxisWidthInPx)", () => {
  function series(values: Array<number>): Array<SeriesPoint> {
    return [
      {
        seriesName: "Requests",
        data: values.map((value: number, index: number) => {
          return { x: new Date(Date.UTC(2026, 10, 15, 12, index)), y: value };
        }),
      },
    ];
  }

  function rate(unit: string): (value: number) => string {
    return (value: number): string => {
      return ValueFormatter.formatValue(value, unit);
    };
  }

  function widthFor(text: string): number {
    return Math.ceil(
      getTickTextLength(text) * Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX +
        Y_AXIS_TICK_PADDING_IN_PX,
    );
  }

  test("a chart whose ticks fit keeps the 64 pixels every chart had", () => {
    expect(
      getYAxisWidthInPx({
        data: series([12, 52.75, 80]),
        formatter: rate("%"),
      }),
    ).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(
      getYAxisWidthInPx({
        data: series([1500, 2_000_000]),
        formatter: rate("By"),
      }),
    ).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(getYAxisWidthInPx({ data: series([1, 2, 3]) })).toBe(
      Y_AXIS_WIDTH_IN_PX,
    );
  });

  test("an API server's request rate gets room for its widest tick", () => {
    const width: number = getYAxisWidthInPx({
      data: series([900, 1200, 1850]),
      formatter: rate("req/s"),
    });

    expect(width).toBeGreaterThanOrEqual(widthFor("1.85K\u00A0req/s"));
    // The round tick the axis may step to above the data, too.
    expect(width).toBeGreaterThanOrEqual(widthFor("10K req/s"));
    expect(width).toBeGreaterThan(Y_AXIS_WIDTH_IN_PX);
  });

  test("85.7 can be drawn as a 100 tick: the axis has room for it", () => {
    expect(
      getYAxisWidthInPx({
        data: series([10, 85.7]),
        formatter: rate("resp/s"),
      }),
    ).toBeGreaterThanOrEqual(widthFor("100 resp/s"));
  });

  test("negative values and the axis' own bounds count", () => {
    expect(
      getYAxisWidthInPx({
        data: series([-1850, 20]),
        formatter: rate("req/s"),
      }),
    ).toBeGreaterThanOrEqual(widthFor("-1.85K req/s"));
    expect(
      getYAxisWidthInPx({
        data: series([1, 2]),
        formatter: rate("req/s"),
        max: 25000,
      }),
    ).toBeGreaterThanOrEqual(widthFor("25K req/s"));
    expect(
      getYAxisWidthInPx({ data: series([1]), min: "auto", max: "auto" }),
    ).toBe(Y_AXIS_WIDTH_IN_PX);
  });

  test("never wider than its cap, whatever a label says", () => {
    expect(
      getYAxisWidthInPx({
        data: series([1, 2]),
        formatter: (): string => {
          return "a tick label far too long for any axis to hold";
        },
      }),
    ).toBe(Y_AXIS_MAX_WIDTH_IN_PX);
  });

  test("no data, no finite value, or a formatter that throws: the plain axis", () => {
    expect(getYAxisWidthInPx({ data: [] })).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(getYAxisWidthInPx({ data: undefined })).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(
      getYAxisWidthInPx({ data: series([NaN, Infinity, -Infinity]) }),
    ).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(
      getYAxisWidthInPx({
        data: series([5]),
        formatter: (): string => {
          throw new Error("no");
        },
      }),
    ).toBe(Y_AXIS_WIDTH_IN_PX);
  });

  test("a character is a character: Persian digits and CJK count once each", () => {
    expect(getTickTextLength("۱۰۰ req/s")).toBe(9);
    expect(getTickTextLength("100 req/秒")).toBe(9);
  });
});

describe("the line, bar and area charts hand the library that width", () => {
  const X_AXIS: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: new Date(Date.UTC(2026, 10, 15, 12, 0)),
      max: new Date(Date.UTC(2026, 10, 15, 12, 30)),
      aggregateType: XAxisAggregateType.Average,
    },
  };

  function yAxis(unit: string): YAxis {
    return {
      legend: unit,
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, unit);
        },
      },
    };
  }

  const DATA: Array<SeriesPoint> = [
    {
      seriesName: "Requests",
      data: [
        { x: new Date(Date.UTC(2026, 10, 15, 12, 1)), y: 900 },
        { x: new Date(Date.UTC(2026, 10, 15, 12, 2)), y: 1850 },
      ],
    },
  ];

  function widthDrawn(): number {
    return Number(
      screen.getByTestId("chart-library").getAttribute("data-y-axis-width"),
    );
  }

  test.each([
    ["line", LineChartElement],
    ["bar", BarChartElement],
    ["area", AreaChartElement],
  ])(
    "a %s chart of a request rate gets a wider axis; of a share, the 64 pixels",
    (_name: string, Chart: unknown) => {
      const Element: React.FunctionComponent<Record<string, unknown>> =
        Chart as React.FunctionComponent<Record<string, unknown>>;

      render(
        <Element
          data={DATA}
          xAxis={X_AXIS}
          yAxis={yAxis("req/s")}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid="rate"
        />,
      );
      expect(widthDrawn()).toBe(
        getYAxisWidthInPx({
          data: DATA,
          formatter: yAxis("req/s").options.formatter,
          min: 0,
          max: "auto",
        }),
      );
      expect(widthDrawn()).toBeGreaterThan(Y_AXIS_WIDTH_IN_PX);
      cleanup();

      render(
        <Element
          data={[
            {
              seriesName: "CPU",
              data: [{ x: new Date(Date.UTC(2026, 10, 15, 12, 1)), y: 42 }],
            },
          ]}
          xAxis={X_AXIS}
          yAxis={yAxis("%")}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid="share"
        />,
      );
      expect(widthDrawn()).toBe(Y_AXIS_WIDTH_IN_PX);
    },
  );
});
