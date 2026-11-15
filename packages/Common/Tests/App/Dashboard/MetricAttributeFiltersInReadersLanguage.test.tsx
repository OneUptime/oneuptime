// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
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
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A METRIC QUERY'S FILTERS, SAID IN THE READER'S LANGUAGE (#7931).
 *
 * A metric query's attribute filters are summed up twice: as chips under
 * the query ("Filtered by: http.route matches /api/*") and in a chart's
 * details dialog. Both drew the operator's English symbol between the key
 * and the value, so a German query card said "matches" under a form that
 * said "stimmt überein", and a Persian one an English word in the middle
 * of a right-to-left line. They say each filter as one sentence now
 * (DictionaryFilterSentence), the key and the value as typed; the chip's
 * remove button says which filter it removes in the same words, and the
 * collapsed query counts its filters and group-bys in the reader's plural
 * forms.
 *
 * Rendered through i18next with the Dashboard's own locale files.
 */

// The metric picker under the query is not what this is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-query" });
      },
    };
  },
);

// The chart measures its parent, which jsdom cannot do: its details are under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

import MetricQueryConfig from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig";
import ChartGroup, {
  ChartType,
} from "../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { ComponentProps as LineChartProps } from "../../../UI/Components/Charts/Line/LineChart";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { getListSeparator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const RENDERED: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: { [code]: { translation: readDashboardLocale(code) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

// A query filtered three ways: a glob, a list, and an empty attribute.
function filteredQuery(): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: "http.server.request.duration",
        aggegationType: MetricsAggregationType.Avg,
        attributes: {
          "http.route": new Wildcard(["/api/*"]),
          "http.method": new Includes(["GET", "POST"]),
          "user.id": new IsNull(),
        },
      },
      groupByAttributeKeys: ["service.name"],
    },
  } as unknown as MetricQueryConfigData;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return values[name] ?? whole;
    },
  );
}

// The three filters as the reader's language says them.
function expectedSentences(code: string): Array<string> {
  const words: Record<string, string> = readDashboardLocale(code);

  return [
    fill(words["{{field}} matches {{value}}"]!, {
      field: "http.route",
      value: "/api/*",
    }),
    fill(words["{{field}} is any of: {{value}}"]!, {
      field: "http.method",
      value: `GET${getListSeparator(code)}POST`,
    }),
    fill(words["{{field}} is empty"]!, { field: "user.id" }),
  ];
}

function renderQuery(code: string): void {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={languages[code] as i18n}>
      <MetricQueryConfig
        data={filteredQuery()}
        onChange={() => {
          return undefined;
        }}
        metricTypes={[]}
        telemetryAttributes={[]}
        hideCard={true}
      />
    </I18nextProvider>,
  );
}

function texts(testId: string): Array<string> {
  return screen.getAllByTestId(testId).map((element: HTMLElement): string => {
    return withoutIsolateMarks(element.textContent || "");
  });
}

describe("a metric query's filter chips", () => {
  test("in English they read as before, the operators in words", () => {
    renderQuery("en");

    expect(texts("metric-query-attribute-chip")).toEqual([
      "http.route matches /api/*",
      "http.method is any of: GET, POST",
      "user.id is empty",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s each chip is the language's sentence, never the English operator",
    (code: string) => {
      renderQuery(code);

      const chips: Array<string> = texts("metric-query-attribute-chip");

      expect(chips).toEqual(expectedSentences(code));

      for (const chip of chips) {
        expect(chip).not.toMatch(/\b(matches|is any of|is empty)\b/);
      }
    },
  );

  test.each(["de", "fa", "ar"])(
    "in %s a chip's remove button names its filter in the same words",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);

      renderQuery(code);

      const sentence: string = expectedSentences(code)[0]!;
      const labels: Array<string> = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-testid='metric-query-attribute-chip'] + button",
        ),
      ).map((button: HTMLElement): string => {
        return withoutIsolateMarks(button.getAttribute("aria-label") || "");
      });

      expect(labels[0]).toBe(
        fill(words["Remove filter {{filter}}"]!, { filter: sentence }),
      );
      expect(labels[0]).not.toContain("Remove filter");
    },
  );

  test("in fa the key and the value read as typed, each set apart", () => {
    renderQuery("fa");

    const chip: HTMLElement = screen.getAllByTestId(
      "metric-query-attribute-chip",
    )[0]!;

    expect(
      Array.from(chip.querySelectorAll<HTMLElement>("bdi")).map(
        (isolate: HTMLElement): Array<string | null> => {
          return [isolate.textContent, isolate.getAttribute("dir")];
        },
      ),
    ).toEqual([
      ["http.route", "ltr"],
      ["/api/*", "ltr"],
    ]);
  });

  test.each(["en", "de", "fa"])(
    "in %s the collapsed query counts its filters and group-bys in the language",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);

      renderQuery(code);

      act(() => {
        fireEvent.click(
          screen.getByRole("button", {
            name: words["Collapse query"] || "Collapse query",
          }),
        );
      });

      const header: string = withoutIsolateMarks(
        document.body.textContent || "",
      );

      expect(header).toContain(
        fill(words["{{count}} filters"]!, {
          count: new Intl.NumberFormat(code === "fa" ? "fa" : code).format(3),
        }),
      );
      expect(header).toContain(
        fill(words["{{count}} group-bys_one"] || "{{count}} group-by", {
          count: new Intl.NumberFormat(code === "fa" ? "fa" : code).format(1),
        }),
      );
    },
  );
});

describe("a metric chart's details", () => {
  function renderDetails(code: string): void {
    if (code === "fa" || code === "ar") {
      document.documentElement.setAttribute("dir", "rtl");
    }

    render(
      <I18nextProvider i18n={languages[code] as i18n}>
        <ChartGroup
          charts={[
            {
              id: "duration",
              title: "http.server.request.duration",
              type: ChartType.LINE,
              props: {} as unknown as LineChartProps,
              metricInfo: {
                metricName: "http.server.request.duration",
                aggregationType: "Avg",
                attributes: filteredQuery().metricQueryData.filterData
                  .attributes as Record<string, unknown>,
              },
            },
          ]}
        />
      </I18nextProvider>,
    );

    const words: Record<string, string> = readDashboardLocale(code);

    act(() => {
      fireEvent.click(
        document.querySelector<HTMLElement>(
          `button[title="${words["View metric details"] || "View metric details"}"]`,
        )!,
      );
    });
  }

  test("in English each filter reads as one sentence, its operator in words", () => {
    renderDetails("en");

    expect(texts("metric-info-attribute")).toEqual([
      "http.route matches /api/*",
      "http.method is any of: GET, POST",
      "user.id is empty",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s each filter is the language's sentence, never the English operator",
    (code: string) => {
      renderDetails(code);

      expect(texts("metric-info-attribute")).toEqual(expectedSentences(code));
    },
  );
});
