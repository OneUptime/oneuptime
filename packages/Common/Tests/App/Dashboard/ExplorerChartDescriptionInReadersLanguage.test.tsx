// UX rule: Docs/ux/README.md#in-every-language
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
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { Chart } from "../../../UI/Components/Charts/ChartGroup/ChartGroup";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A CHART THE METRICS EXPLORER BUILDS FROM A METRIC DESCRIBES IT IN THE
 * READER'S LANGUAGE (#8572).
 *
 * Picking a metric, the explorer copies the metric's own description into
 * the chart it builds. Since #8356 a monitor's series stores a key of
 * OneUptime's as its description, which every language words, and the
 * metrics list draws it in the reader's words - but the chart drew its
 * copy as handed, so a German reader who charted "1-minute load average"
 * read that line in English under the chart.
 *
 * The copy is marked now (MetricAliasData.isMetricTypeDescription), and the
 * chart and the alias editor look a marked description up once, where they
 * draw it. The configuration keeps the stored English, so a saved chart
 * reads in each reader's language. A description a person typed is theirs,
 * drawn as written even when it is a key, and so is a metric's own
 * description that no locale holds (the telemetry's own words).
 *
 * MetricCharts is drawn for real, in English, German and Persian from the
 * Dashboard's own locale files; only the chart group it hands its charts
 * to is a stand-in that keeps what it was handed. Then again with the
 * description worded as a probe that is itself a key reading TWICE: a line
 * looked up twice would say it.
 */

const chartGroupCharts: Array<Array<Chart>> = [];

jest.mock("../../../UI/Components/Charts/ChartGroup/ChartGroup", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Charts/ChartGroup/ChartGroup",
  ) as Record<string, unknown>;
  const ReactInMock: typeof React = jest.requireActual("react") as typeof React;

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
            "p",
            { key: chart.id, "data-testid": "chart-description" },
            chart.description || "",
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

import MetricAlias from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricAlias";
import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import { getChartDescriptionText } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/ChartDescription";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricAliasData from "../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fa"];
const READERS: ReadonlyArray<string> = ["de", "fa"];

// What the server stores as the description of a host monitor's series (#8356).
const LOAD_AVERAGE: string = "1-minute load average";
const SWAP_USAGE: string = "Swap memory usage percentage";
// What an app's own telemetry says its metric is: no locale holds it.
const TELEMETRY_OWN: string =
  "Requests the checkout service answered, counted by its own exporter.";
const TYPED: string = "Load on the build host, watched during releases";

const TWICE: string = "TWICE";

const PROBE_MARKS: Readonly<Record<string, string>> = {
  en: "EN› ",
  de: "DE› ",
  fa: "ف› ",
};

const WINDOW_START: Date = new Date("2026-11-12T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-12T11:00:00.000Z");

function probeOf(language: string, text: string): string {
  return `${PROBE_MARKS[language]}${text}`;
}

function probedWords(language: string): Record<string, string> {
  const words: Record<string, string> = { ...readDashboardLocale(language) };

  for (const text of [LOAD_AVERAGE, SWAP_USAGE]) {
    words[text] = probeOf(language, text);
    words[probeOf(language, text)] = TWICE;
  }

  return words;
}

function translatorOf(
  words: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return Object.prototype.hasOwnProperty.call(words, text)
      ? words[text]
      : undefined;
  }, language);
}

function wordOf(language: string, text: string): string {
  return readDashboardLocale(language)[text] || text;
}

const dashboardI18n: i18n = createInstance();
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  for (const [instance, wordsOf] of [
    [dashboardI18n, readDashboardLocale],
    [probedI18n, probedWords],
  ] as Array<[i18n, (language: string) => Record<string, string>]>) {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = { translation: wordsOf(language) };
    }

    await instance.init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  }
});

beforeEach(() => {
  chartGroupCharts.length = 0;
  fetchExemplarsMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// The alias the explorer writes when a person picks the host's load average.
function pickedAlias(
  overrides: Partial<MetricAliasData> = {},
): MetricAliasData {
  return {
    metricVariable: "a",
    title: MonitorMetricType.LoadAverage1Min,
    description: LOAD_AVERAGE,
    isMetricTypeDescription: true,
    legend: MonitorMetricType.LoadAverage1Min,
    legendUnit: "",
    ...overrides,
  };
}

function viewDataOf(alias: MetricAliasData): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: alias,
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.LoadAverage1Min,
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
          groupByAttributeKeys: [],
        },
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

function resultOf(): AggregatedResult {
  return {
    data: [
      {
        timestamp: new Date("2026-11-12T10:10:00.000Z"),
        value: 0.4,
        attributes: {},
      },
      {
        timestamp: new Date("2026-11-12T10:30:00.000Z"),
        value: 0.7,
        attributes: {},
      },
    ],
    truncated: false,
  } as unknown as AggregatedResult;
}

// The description the explorer's chart hands its chart group, and draws.
async function drawnDescription(
  instance: i18n,
  language: string,
  alias: MetricAliasData,
): Promise<string> {
  await act(async () => {
    await instance.changeLanguage(language);
  });

  render(
    <I18nextProvider i18n={instance}>
      <MetricCharts
        metricViewData={viewDataOf(alias)}
        metricResults={[resultOf()]}
        metricTypes={[]}
      />
    </I18nextProvider>,
  );

  const charts: Array<Chart> | undefined =
    chartGroupCharts[chartGroupCharts.length - 1];

  expect(charts).toBeDefined();
  expect((charts as Array<Chart>).length).toBe(1);

  const handed: string = (charts as Array<Chart>)[0]!.description || "";

  expect(screen.getByTestId("chart-description")).toHaveTextContent(handed);

  return handed;
}

describe("the stored descriptions the explorer copies are worded", () => {
  test.each(READERS)(
    "%s words the host's load average and swap usage",
    (language: string) => {
      for (const text of [LOAD_AVERAGE, SWAP_USAGE]) {
        expect({ text, worded: wordOf(language, text) !== text }).toEqual({
          text,
          worded: true,
        });
      }
    },
  );
});

describe("a chart's description, as its reader reads it (getChartDescriptionText)", () => {
  test.each(READERS)(
    "in %s a metric's own description that is a key reads in the reader's words",
    (language: string) => {
      const translator: Translator = translatorOf(
        readDashboardLocale(language),
        language,
      );

      expect(getChartDescriptionText(pickedAlias(), translator)).toBe(
        wordOf(language, LOAD_AVERAGE),
      );
      expect(
        getChartDescriptionText(
          pickedAlias({ description: SWAP_USAGE }),
          translator,
        ),
      ).toBe(wordOf(language, SWAP_USAGE));
    },
  );

  test.each(READERS)(
    "in %s a metric's own description that no locale holds reads as written",
    (language: string) => {
      const translator: Translator = translatorOf(
        readDashboardLocale(language),
        language,
      );

      expect(
        getChartDescriptionText(
          pickedAlias({ description: TELEMETRY_OWN }),
          translator,
        ),
      ).toBe(TELEMETRY_OWN);
    },
  );

  test.each(READERS)(
    "in %s a description a person typed reads as written, even one that is a key",
    (language: string) => {
      const translator: Translator = translatorOf(
        readDashboardLocale(language),
        language,
      );

      expect(
        getChartDescriptionText(
          pickedAlias({ description: TYPED, isMetricTypeDescription: false }),
          translator,
        ),
      ).toBe(TYPED);
      expect(
        getChartDescriptionText(
          pickedAlias({ isMetricTypeDescription: false }),
          translator,
        ),
      ).toBe(LOAD_AVERAGE);
      // A chart saved before the mark existed carries none: as written.
      expect(
        getChartDescriptionText(
          pickedAlias({ isMetricTypeDescription: undefined }),
          translator,
        ),
      ).toBe(LOAD_AVERAGE);
    },
  );

  test("no description reads as nothing", () => {
    const translator: Translator = translatorOf(
      readDashboardLocale("de"),
      "de",
    );

    expect(getChartDescriptionText(undefined, translator)).toBe("");
    expect(
      getChartDescriptionText(
        pickedAlias({ description: undefined }),
        translator,
      ),
    ).toBe("");
    expect(
      getChartDescriptionText(pickedAlias({ description: "" }), translator),
    ).toBe("");
  });

  test.each(READERS)(
    "in %s a description is looked up once",
    (language: string) => {
      const translator: Translator = translatorOf(
        probedWords(language),
        language,
      );

      expect(getChartDescriptionText(pickedAlias(), translator)).toBe(
        probeOf(language, LOAD_AVERAGE),
      );
    },
  );
});

describe("the explorer's chart (MetricCharts)", () => {
  test("on an English board a chart built from a host series says the stored description", async () => {
    expect(await drawnDescription(dashboardI18n, "en", pickedAlias())).toBe(
      LOAD_AVERAGE,
    );
  });

  test.each(READERS)(
    "on a %s board a chart built from a host series says its description in the reader's words",
    async (language: string) => {
      const alias: MetricAliasData = pickedAlias();
      const drawn: string = await drawnDescription(
        dashboardI18n,
        language,
        alias,
      );

      expect(drawn).toBe(wordOf(language, LOAD_AVERAGE));
      expect(drawn).not.toBe(LOAD_AVERAGE);
      // The chart's configuration keeps the stored English and its mark.
      expect(alias.description).toBe(LOAD_AVERAGE);
      expect(alias.isMetricTypeDescription).toBe(true);
    },
  );

  test.each(READERS)(
    "on a %s board a description a person typed is drawn as written",
    async (language: string) => {
      expect(
        await drawnDescription(
          dashboardI18n,
          language,
          pickedAlias({ description: TYPED, isMetricTypeDescription: false }),
        ),
      ).toBe(TYPED);
      cleanup();
      // Typed in the words of a key, it is still the person's.
      expect(
        await drawnDescription(
          dashboardI18n,
          language,
          pickedAlias({ isMetricTypeDescription: false }),
        ),
      ).toBe(LOAD_AVERAGE);
    },
  );

  test.each(READERS)(
    "on a %s board the telemetry's own description is drawn as written",
    async (language: string) => {
      expect(
        await drawnDescription(
          dashboardI18n,
          language,
          pickedAlias({ description: TELEMETRY_OWN }),
        ),
      ).toBe(TELEMETRY_OWN);
    },
  );

  test.each(LANGUAGES)(
    "in %s looks the description up once",
    async (language: string) => {
      const drawn: string = await drawnDescription(
        probedI18n,
        language,
        pickedAlias(),
      );

      expect(drawn).toBe(probeOf(language, LOAD_AVERAGE));
      expect(drawn).not.toContain(TWICE);
    },
  );
});

describe("the explorer's alias editor (MetricAlias)", () => {
  function drawEditor(
    instance: i18n,
    alias: MetricAliasData,
    onDataChanged: MockFunction,
  ): void {
    render(
      <I18nextProvider i18n={instance}>
        <MetricAlias
          data={alias}
          isFormula={false}
          onDataChanged={
            onDataChanged as unknown as (data: MetricAliasData) => void
          }
        />
      </I18nextProvider>,
    );
  }

  function lastChange(onDataChanged: MockFunction): MetricAliasData {
    const calls: Array<Array<unknown>> = onDataChanged.mock.calls;
    return calls[calls.length - 1]?.[0] as MetricAliasData;
  }

  test.each(READERS)(
    "in %s shows a metric's own description in the reader's words, and changes nothing",
    async (language: string) => {
      const onDataChanged: MockFunction = getJestMockFunction();

      await act(async () => {
        await dashboardI18n.changeLanguage(language);
      });
      drawEditor(dashboardI18n, pickedAlias(), onDataChanged);

      expect(
        screen.getByDisplayValue(wordOf(language, LOAD_AVERAGE)),
      ).toBeInTheDocument();
      expect(screen.queryByDisplayValue(LOAD_AVERAGE)).toBeNull();
      expect(onDataChanged).not.toHaveBeenCalled();
    },
  );

  test.each(READERS)(
    "in %s a typed description is the person's own: stored as typed, unmarked",
    async (language: string) => {
      const onDataChanged: MockFunction = getJestMockFunction();

      await act(async () => {
        await dashboardI18n.changeLanguage(language);
      });
      drawEditor(dashboardI18n, pickedAlias(), onDataChanged);

      fireEvent.change(
        screen.getByDisplayValue(wordOf(language, LOAD_AVERAGE)),
        {
          target: { value: TYPED },
        },
      );

      expect(lastChange(onDataChanged).description).toBe(TYPED);
      expect(lastChange(onDataChanged).isMetricTypeDescription).toBe(false);
    },
  );

  test.each(READERS)(
    "in %s changing the title keeps the metric's own description in English, marked",
    async (language: string) => {
      const onDataChanged: MockFunction = getJestMockFunction();

      await act(async () => {
        await dashboardI18n.changeLanguage(language);
      });
      drawEditor(dashboardI18n, pickedAlias(), onDataChanged);

      // The title's field comes first; the legend's says the same name.
      fireEvent.change(
        screen.getAllByDisplayValue(
          MonitorMetricType.LoadAverage1Min,
        )[0] as HTMLElement,
        { target: { value: "Build host load" } },
      );

      expect(lastChange(onDataChanged).title).toBe("Build host load");
      expect(lastChange(onDataChanged).description).toBe(LOAD_AVERAGE);
      expect(lastChange(onDataChanged).isMetricTypeDescription).toBe(true);
    },
  );

  test.each(READERS)(
    "in %s a description a person typed is shown as written",
    async (language: string) => {
      const onDataChanged: MockFunction = getJestMockFunction();

      await act(async () => {
        await dashboardI18n.changeLanguage(language);
      });
      drawEditor(
        dashboardI18n,
        pickedAlias({ isMetricTypeDescription: false }),
        onDataChanged,
      );

      expect(screen.getByDisplayValue(LOAD_AVERAGE)).toBeInTheDocument();
    },
  );

  test.each(READERS)(
    "in %s looks the description up once",
    async (language: string) => {
      const onDataChanged: MockFunction = getJestMockFunction();

      await act(async () => {
        await probedI18n.changeLanguage(language);
      });
      drawEditor(probedI18n, pickedAlias(), onDataChanged);

      expect(
        screen.getByDisplayValue(probeOf(language, LOAD_AVERAGE)),
      ).toBeInTheDocument();
      expect(screen.queryByDisplayValue(TWICE)).toBeNull();
    },
  );
});
