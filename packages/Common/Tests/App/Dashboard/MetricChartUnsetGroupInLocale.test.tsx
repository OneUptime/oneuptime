import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
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
import fs from "fs";
import path from "path";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { Chart } from "../../../UI/Components/Charts/ChartGroup/ChartGroup";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A METRIC CHART'S GROUP WITH NO VALUE, IN THE READER'S LANGUAGE (#7523).
 *
 * A chart grouped by an attribute named a series whose attribute holds
 * nothing "service.name=(unset)", in English on every board: its legend
 * chip, its tooltip and its series menu read "(unset)" beside a German
 * board's words, as a Table widget's group did before #7091. The reader
 * reads their own word now - "(nicht gesetzt)", "(تنظیم‌نشده)" - while the
 * series' name keeps "(unset)": it is what a color pin is stored by and
 * what narrows a click on the series to the is-empty filter.
 *
 * MetricCharts is rendered for real here; only the chart group it hands
 * its charts to is a stand-in that keeps what it was handed and draws the
 * series controls (the legend chips), as the real one does.
 */

const chartGroupCharts: Array<Array<Chart>> = [];

jest.mock("../../../UI/Components/Charts/ChartGroup/ChartGroup", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Charts/ChartGroup/ChartGroup",
  ) as Record<string, unknown>;
  const ReactInMock: typeof React = jest.requireActual("react");

  return {
    ...actual,
    __esModule: true,
    default: (props: { charts: Array<Chart> }) => {
      chartGroupCharts.push(props.charts);
      return ReactInMock.createElement(
        "div",
        { "data-testid": "chart-group" },
        props.charts.map((chart: Chart) => {
          return ReactInMock.createElement(
            "div",
            { key: chart.id },
            chart.seriesControls || null,
          );
        }),
      );
    },
  };
});

const fetchExemplarsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: (...args: Array<unknown>) => {
          fetchExemplarsMock(...args);
          return new Promise(() => {
            // Never settles: exemplars are not what this suite reads.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
      },
    };
  },
);

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import SeriesGroupColorSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesGroupColorSelector";
import {
  getSeriesGroupValue,
  getSeriesGroupValueForReader,
  getSeriesGroupValueFromReader,
  getSeriesNameForReader,
  isSeriesFoundBySearch,
  UNSET_GROUP_VALUE,
  withSeriesNamesForReader,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesNameForReader";
import { parseSeriesLabels } from "../../../../App/FeatureSet/Dashboard/src/Utils/MetricSeriesInvestigation";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricSeriesScope from "../../../Utils/Metrics/MetricSeriesScope";

const WINDOW_START: Date = new Date("2026-11-12T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-12T11:00:00.000Z");
const WINDOW_MS: number = WINDOW_END.getTime() - WINDOW_START.getTime();

const GROUP_KEY: string = "service.name";
const UNSET_SERIES: string = `${GROUP_KEY}=(unset)`;
const API_SERIES: string = `${GROUP_KEY}=checkout-api`;
const PIN_COLOR: string = "#dc2626";

function words(language: string): Record<string, string> {
  return readDashboardLocale(language);
}

// "(unset)" as `language`'s Dashboard words it.
function unsetWordIn(language: string): string {
  return words(language)["(unset)"] as string;
}

function buildViewData(
  overrides: Partial<MetricQueryConfigData> = {},
): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a", legend: "Requests" },
        metricQueryData: {
          filterData: {
            metricName: "http.server.request.count",
            attributes: {},
            aggegationType: MetricsAggregationType.Sum,
          },
          groupByAttributeKeys: [GROUP_KEY],
        },
        ...overrides,
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

/*
 * Two groups, one a sample with no service.name: the series a host's
 * metrics give when some points carry the attribute and some do not.
 */
function buildResult(offsetMs: number = 0): AggregatedResult {
  const at: (minute: number) => Date = (minute: number): Date => {
    return new Date(WINDOW_START.getTime() + minute * 60_000 - offsetMs);
  };

  return {
    data: [
      { timestamp: at(10), value: 40, attributes: { [GROUP_KEY]: "" } },
      { timestamp: at(30), value: 70, attributes: {} },
      {
        timestamp: at(10),
        value: 12,
        attributes: { [GROUP_KEY]: "checkout-api" },
      },
      {
        timestamp: at(30),
        value: 18,
        attributes: { [GROUP_KEY]: "checkout-api" },
      },
    ],
    truncated: false,
  } as unknown as AggregatedResult;
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// The charts MetricCharts last handed its chart group.
function lastCharts(): Array<Chart> {
  const charts: Array<Chart> | undefined =
    chartGroupCharts[chartGroupCharts.length - 1];

  expect(charts).toBeDefined();

  return charts as Array<Chart>;
}

function drawnSeriesNames(): Array<string> {
  return lastCharts()[0]!.props.data.map((series: SeriesPoint): string => {
    return series.seriesName;
  });
}

// The legend's chips: each one's name, as the reader reads it.
function chipNames(): Array<string> {
  return Array.from(document.querySelectorAll("button[aria-pressed] bdi"))
    .map((element: Element): string => {
      return (element.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text.startsWith(`${GROUP_KEY}=`);
    });
}

function chipButtonOf(readerName: string): HTMLElement {
  const button: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>("button[aria-pressed]"),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").includes(readerName);
  });

  expect(button).toBeDefined();

  return button as HTMLElement;
}

// The color the chip's dot is drawn in, when the chart was handed one.
function chipDotColor(readerName: string): string {
  const dot: HTMLElement | null =
    chipButtonOf(readerName).querySelector("span[aria-hidden]");

  return dot?.style.backgroundColor || "";
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
  chartGroupCharts.length = 0;
  fetchExemplarsMock.mockReset();
  window.localStorage.clear();
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a group's value, as its series is named and pinned", () => {
  test("nothing - undefined, null or an empty string - is (unset), on every board", () => {
    expect(UNSET_GROUP_VALUE).toBe("(unset)");
    expect(UNSET_GROUP_VALUE).toBe(MetricSeriesScope.UnsetLabelDisplayValue);
    expect(getSeriesGroupValue(undefined)).toBe("(unset)");
    expect(getSeriesGroupValue(null)).toBe("(unset)");
    expect(getSeriesGroupValue("")).toBe("(unset)");
  });

  test("a value is its own: a name, a number, a boolean, a space", () => {
    expect(getSeriesGroupValue("checkout-api")).toBe("checkout-api");
    expect(getSeriesGroupValue(0)).toBe("0");
    expect(getSeriesGroupValue(false)).toBe("false");
    expect(getSeriesGroupValue(" ")).toBe(" ");
  });
});

describe("a series' name, as its reader reads it", () => {
  test("every Dashboard language words (unset) its own way", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({ language, word: unsetWordIn(language) }).not.toEqual({
        language,
        word: "(unset)",
      });
    }
  });

  test("an English board reads (unset), as it always did, and gets the same name back", () => {
    const english: Translator = dashboardTranslator("en");

    expect(getSeriesNameForReader(UNSET_SERIES, english)).toBe(UNSET_SERIES);
  });

  test.each(["de", "fa", "ar"])(
    "a %s board reads its own word for (unset), and only for it",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const word: string = unsetWordIn(language);

      expect(getSeriesNameForReader(UNSET_SERIES, translator)).toBe(
        `${GROUP_KEY}=${word}`,
      );
      expect(getSeriesNameForReader(API_SERIES, translator)).toBe(API_SERIES);
    },
  );

  test("German and Persian, as their files word it", () => {
    expect(
      getSeriesNameForReader(UNSET_SERIES, dashboardTranslator("de")),
    ).toBe("service.name=(nicht gesetzt)");
    expect(
      getSeriesNameForReader(UNSET_SERIES, dashboardTranslator("fa")),
    ).toBe("service.name=(تنظیم‌نشده)");
  });

  test("every segment of a name grouped by several keys, an overlay's label before it and the previous period's mark after it", () => {
    const de: Translator = dashboardTranslator("de");
    const word: string = unsetWordIn("de");

    expect(
      getSeriesNameForReader("service.name=(unset), host.name=(unset)", de),
    ).toBe(`service.name=${word}, host.name=${word}`);
    expect(
      getSeriesNameForReader("service.name=api, host.name=(unset)", de),
    ).toBe(`service.name=api, host.name=${word}`);
    expect(getSeriesNameForReader("Requests: service.name=(unset)", de)).toBe(
      `Requests: service.name=${word}`,
    );
    expect(getSeriesNameForReader("service.name=(unset) (b)", de)).toBe(
      `service.name=${word} (b)`,
    );
    expect(getSeriesNameForReader("service.name=(unset) (previous)", de)).toBe(
      `service.name=${word} (previous)`,
    );
  });

  test("a value that only holds the word is a value: written as it was", () => {
    const de: Translator = dashboardTranslator("de");

    for (const name of [
      "service.name=(unset)-shadow",
      "service.name=x(unset)",
      "service.name=(unset)x, host.name=a",
      "(unset)",
      "",
    ]) {
      expect(getSeriesNameForReader(name, de)).toBe(name);
    }
  });

  test("the reader's word stands as it is written, even with a $ in it", () => {
    const dollar: Translator = {
      ...dashboardTranslator("de"),
      translateText: (text: string | undefined): string | undefined => {
        return text === "(unset)" ? "($& leer $1)" : text;
      },
    };

    expect(getSeriesNameForReader(UNSET_SERIES, dollar)).toBe(
      "service.name=($& leer $1)",
    );
  });

  test("a group's value alone: the reader's word for (unset), and back", () => {
    const fa: Translator = dashboardTranslator("fa");
    const word: string = unsetWordIn("fa");

    expect(getSeriesGroupValueForReader("(unset)", fa)).toBe(word);
    expect(getSeriesGroupValueForReader("checkout-api", fa)).toBe(
      "checkout-api",
    );
    expect(getSeriesGroupValueFromReader(word, fa)).toBe("(unset)");
    expect(getSeriesGroupValueFromReader("(unset)", fa)).toBe("(unset)");
    expect(getSeriesGroupValueFromReader("checkout-api", fa)).toBe(
      "checkout-api",
    );
    // English's word is "(unset)" itself.
    expect(
      getSeriesGroupValueFromReader("(unset)", dashboardTranslator("en")),
    ).toBe("(unset)");
  });

  test("a search finds a series by its name and by the reader's word", () => {
    const de: Translator = dashboardTranslator("de");

    expect(isSeriesFoundBySearch(UNSET_SERIES, "nicht gesetzt", de)).toBe(true);
    expect(isSeriesFoundBySearch(UNSET_SERIES, "NICHT", de)).toBe(true);
    expect(isSeriesFoundBySearch(UNSET_SERIES, "(unset)", de)).toBe(true);
    expect(isSeriesFoundBySearch(API_SERIES, "nicht gesetzt", de)).toBe(false);
    expect(isSeriesFoundBySearch(API_SERIES, "  ", de)).toBe(true);
  });

  test("the series a chart draws: renamed copies, the same array when no name changes", () => {
    const de: Translator = dashboardTranslator("de");
    const series: Array<SeriesPoint> = [
      { seriesName: UNSET_SERIES, data: [] },
      { seriesName: API_SERIES, data: [] },
    ];
    const named: Array<SeriesPoint> = withSeriesNamesForReader(series, de);

    expect(named).not.toBe(series);
    expect(named[0]!.seriesName).toBe(`${GROUP_KEY}=${unsetWordIn("de")}`);
    expect(named[0]!.data).toBe(series[0]!.data);
    expect(named[1]).toBe(series[1]);
    // The series themselves keep their names.
    expect(series[0]!.seriesName).toBe(UNSET_SERIES);

    expect(withSeriesNamesForReader(series, dashboardTranslator("en"))).toBe(
      series,
    );
    expect(withSeriesNamesForReader([series[1]!], de)).toEqual([series[1]]);
  });

  test("a click on the series still narrows to the is-empty filter: its name parses back to an empty label", () => {
    expect(
      parseSeriesLabels({ seriesName: UNSET_SERIES, groupByKeys: [GROUP_KEY] }),
    ).toEqual({ [GROUP_KEY]: "" });

    // The reader's word is no label the parser knows: it never reaches a filter.
    expect(
      parseSeriesLabels({
        seriesName: getSeriesNameForReader(
          UNSET_SERIES,
          dashboardTranslator("de"),
        ),
        groupByKeys: [GROUP_KEY],
      }),
    ).toEqual({ [GROUP_KEY]: "(nicht gesetzt)" });
  });

  test("the series menu's scope summary says the reader's word, (unset) when it is given none", () => {
    const queryConfigs: Array<MetricQueryConfigData> =
      buildViewData().queryConfigs;

    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: { [GROUP_KEY]: "" },
      }),
    ).toBe("service.name = (unset)");
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: { [GROUP_KEY]: "" },
        unsetLabel: unsetWordIn("de"),
      }),
    ).toBe("service.name = (nicht gesetzt)");
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: { [GROUP_KEY]: "api" },
        unsetLabel: unsetWordIn("de"),
      }),
    ).toBe("service.name = api");
  });
});

describe("a grouped metric chart, drawn", () => {
  function drawChart(
    overrides: Partial<React.ComponentProps<typeof MetricCharts>> = {},
  ): void {
    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={[buildResult()]}
        metricTypes={[]}
        {...overrides}
      />,
    );
  }

  test("on an English board the legend and the chart say (unset), as they always did", () => {
    drawChart();

    expect(chipNames()).toContain(UNSET_SERIES);
    expect(drawnSeriesNames()).toContain(UNSET_SERIES);
    expect(drawnSeriesNames()).toContain(API_SERIES);
  });

  test.each(["de", "fa", "ar"])(
    "on a %s board the legend's chip and the chart's line say the reader's word",
    async (language: string) => {
      await inLanguage(language);
      drawChart();

      const readerName: string = `${GROUP_KEY}=${unsetWordIn(language)}`;

      expect(chipNames()).toContain(readerName);
      expect(chipNames()).not.toContain(UNSET_SERIES);
      expect(drawnSeriesNames()).toContain(readerName);
      expect(drawnSeriesNames()).not.toContain(UNSET_SERIES);
      // A name the group gave is drawn as it is.
      expect(drawnSeriesNames()).toContain(API_SERIES);

      // The chip's hover and its Investigate button say it too.
      expect(chipButtonOf(readerName).getAttribute("title")).toContain(
        readerName,
      );
      expect(
        screen.getByRole("button", {
          name: new RegExp(readerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          expanded: false,
        }),
      ).toBeInTheDocument();
    },
  );

  test("the chart follows the reader when they change language", async () => {
    drawChart();
    expect(chipNames()).toContain(UNSET_SERIES);

    await inLanguage("de");
    expect(chipNames()).toContain("service.name=(nicht gesetzt)");
    expect(drawnSeriesNames()).toContain("service.name=(nicht gesetzt)");

    await inLanguage("en");
    expect(chipNames()).toContain(UNSET_SERIES);
  });

  /*
   * The pin is stored by the English "(unset)" segment. Were the stored
   * key translated, the pin would match nothing once the reader's
   * language changed, and the line would fall back to the palette.
   */
  test.each(["en", "de", "fa"])(
    "a color pin made on the unset group still colors it on a %s board",
    async (language: string) => {
      await inLanguage(language);
      drawChart({
        metricViewData: buildViewData({
          colorsByGroup: { [UNSET_SERIES]: PIN_COLOR },
        }),
      });

      const chart: Chart = lastCharts()[0]!;
      const unsetIndex: number = chart.props.data.findIndex(
        (series: SeriesPoint): boolean => {
          return series.seriesName.startsWith(`${GROUP_KEY}=(`);
        },
      );

      expect(unsetIndex).toBeGreaterThanOrEqual(0);
      expect(chart.props.colors?.[unsetIndex]).toBe(PIN_COLOR);
      expect(chart.props.colors?.[1 - unsetIndex]).not.toBe(PIN_COLOR);
      expect(
        chipDotColor(
          `${GROUP_KEY}=${language === "en" ? "(unset)" : unsetWordIn(language)}`,
        ),
      ).toBe("rgb(220, 38, 38)");
    },
  );

  test("a pin keyed by the reader's word would match nothing: the key stays English", async () => {
    await inLanguage("de");
    drawChart({
      metricViewData: buildViewData({
        colorsByGroup: {
          [`${GROUP_KEY}=${unsetWordIn("de")}`]: PIN_COLOR,
        },
      }),
    });

    expect(lastCharts()[0]!.props.colors || []).not.toContain(PIN_COLOR);
  });

  test("hiding the unset series from its chip hides the line on every board", async () => {
    await inLanguage("de");
    drawChart();

    fireEvent.click(chipButtonOf("service.name=(nicht gesetzt)"));

    expect(drawnSeriesNames()).toEqual([API_SERIES]);
    expect(chipButtonOf("service.name=(nicht gesetzt)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("its series menu names the series in the reader's words, and Filter to this series narrows to is empty", async () => {
    await inLanguage("de");

    const onQueryConfigsChange: MockFunction = getJestMockFunction();

    drawChart({ onQueryConfigsChange: onQueryConfigsChange as never });

    fireEvent.click(
      screen.getByRole("button", {
        name: /service\.name=\(nicht gesetzt\)/,
        expanded: false,
      }),
    );

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveTextContent("service.name=(nicht gesetzt)");
    expect(menu).not.toHaveTextContent("(unset)");
    expect(menu).toHaveTextContent("service.name = (nicht gesetzt)");

    fireEvent.click(
      screen.getByText(
        dashboardTranslator("de").translateText(
          "Filter to this series",
        ) as string,
      ),
    );

    expect(onQueryConfigsChange).toHaveBeenCalledTimes(1);

    const queryConfigs: Array<MetricQueryConfigData> = onQueryConfigsChange.mock
      .calls[0]![0] as Array<MetricQueryConfigData>;
    const attributes: Record<string, unknown> = queryConfigs[0]!.metricQueryData
      .filterData.attributes as Record<string, unknown>;

    expect(attributes[GROUP_KEY]).toBeInstanceOf(IsNull);
  });

  test("a moment's values come back keyed by the names drawn, and are listed in the reader's words", async () => {
    await inLanguage("de");
    drawChart();

    const chart: Chart = lastCharts()[0]!;
    const readerName: string = "service.name=(nicht gesetzt)";

    act(() => {
      chart.props.onBucketClick?.(
        new Date(WINDOW_START.getTime() + 10 * 60_000),
        new Date(WINDOW_START.getTime() + 11 * 60_000),
        { [readerName]: 40, [API_SERIES]: 12 },
      );
    });

    const inspector: HTMLElement = screen.getByRole("dialog");

    expect(inspector).toHaveTextContent(readerName);
    expect(inspector).toHaveTextContent(API_SERIES);
    expect(inspector).not.toHaveTextContent("(unset)");
  });

  test("a search for the reader's word finds the unset series", async () => {
    await inLanguage("de");
    drawChart({
      metricResults: [
        {
          ...buildResult(),
          data: [
            ...buildResult().data,
            ...["a", "b", "c"].map((name: string) => {
              return {
                timestamp: new Date(WINDOW_START.getTime() + 600_000),
                value: 3,
                attributes: { [GROUP_KEY]: name },
              };
            }),
          ],
        } as unknown as AggregatedResult,
      ],
    });

    const search: HTMLInputElement | null =
      document.querySelector<HTMLInputElement>(
        "input[type='text'], input[type='search']",
      );

    expect(search).not.toBeNull();

    fireEvent.change(search as HTMLInputElement, {
      target: { value: "nicht gesetzt" },
    });

    expect(drawnSeriesNames()).toEqual(["service.name=(nicht gesetzt)"]);
  });

  test("a previous period's twin of the unset series is named in the reader's word too", async () => {
    await inLanguage("de");
    drawChart({
      metricResultsPrevious: [buildResult(WINDOW_MS)],
      compareOffsetMs: WINDOW_MS,
    });

    const chart: Chart = lastCharts()[0]!;
    const ghosts: Array<string> =
      (chart.props as { ghostSeriesNames?: Array<string> }).ghostSeriesNames ||
      [];

    expect(ghosts).toContain("service.name=(nicht gesetzt) (previous)");
    expect(
      ghosts.every((ghost: string): boolean => {
        return drawnSeriesNames().includes(ghost);
      }),
    ).toBe(true);
  });
});

describe("the series color editor's empty group", () => {
  function drawEditor(
    value: Record<string, string>,
    onChange: (colorsByGroup: Record<string, string>) => void = (): void => {
      // Not read here.
    },
  ): HTMLElement {
    return render(
      <SeriesGroupColorSelector
        groupByKeys={[GROUP_KEY]}
        valueSuggestions={{ [GROUP_KEY]: ["checkout-api"] }}
        loadingKeys={[]}
        value={value}
        onChange={onChange}
      />,
    ).container;
  }

  function offered(container: HTMLElement): Array<string> {
    return Array.from(container.querySelectorAll("datalist option")).map(
      (option: Element): string => {
        return option.getAttribute("value") || "";
      },
    );
  }

  test("an English board offers (unset), as it always did", () => {
    expect(offered(drawEditor({}))).toEqual(["(unset)", "checkout-api"]);
  });

  test.each(["de", "fa"])(
    "a %s board offers the reader's word, and pins it as (unset)",
    async (language: string) => {
      await inLanguage(language);

      const onChange: MockFunction = getJestMockFunction();
      const container: HTMLElement = drawEditor({}, onChange as never);
      const word: string = unsetWordIn(language);

      expect(offered(container)).toEqual([word, "checkout-api"]);

      const input: HTMLInputElement = container.querySelector(
        "input[list]",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: word } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(
        Object.keys(onChange.mock.calls[0]![0] as Record<string, unknown>),
      ).toEqual([UNSET_SERIES]);
    },
  );

  test("a pin on the empty group is drawn in the reader's word, and kept as it was stored", async () => {
    await inLanguage("de");

    const onChange: MockFunction = getJestMockFunction();
    const container: HTMLElement = drawEditor(
      { [UNSET_SERIES]: PIN_COLOR },
      onChange as never,
    );

    expect(container).toHaveTextContent("(nicht gesetzt)");
    expect(container).not.toHaveTextContent("(unset)");
    // Already pinned, so no longer offered.
    expect(offered(container)).toEqual(["checkout-api"]);

    const remove: HTMLElement = screen.getByRole("button", {
      name: /\(nicht gesetzt\)/,
    });

    fireEvent.click(remove);

    expect(onChange).toHaveBeenCalledWith({});
  });

  test("a value typed as it is stored, (unset), is pinned as it is on a German board too", async () => {
    await inLanguage("de");

    const onChange: MockFunction = getJestMockFunction();
    const container: HTMLElement = drawEditor({}, onChange as never);
    const input: HTMLInputElement = container.querySelector(
      "input[list]",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "(unset)" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      Object.keys(onChange.mock.calls[0]![0] as Record<string, unknown>),
    ).toEqual([UNSET_SERIES]);
  });
});

describe("the metric charts' source", () => {
  const METRICS_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Metrics",
  );

  // The code alone: what a comment says is not drawn.
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  test.each(["MetricCharts.tsx", "SeriesGroupColorSelector.tsx"])(
    "%s writes no (unset) of its own: the name comes from SeriesNameForReader",
    (file: string) => {
      const code: string = withoutComments(
        fs.readFileSync(path.join(METRICS_DIR, file), "utf8"),
      );

      expect(code).not.toContain('"(unset)"');
      expect(code).toContain("SeriesNameForReader");
    },
  );
});
