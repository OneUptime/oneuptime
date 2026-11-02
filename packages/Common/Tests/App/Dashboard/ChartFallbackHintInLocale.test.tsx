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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * EVERY WORD A CHART SAYS ABOUT ITS FALLBACK IS EVERY LANGUAGE'S OWN.
 *
 * While the Kubernetes dashboard's restarts chart draws the running count
 * (an older agent sends no restarts per interval), a line under its title
 * says why and links the agent's upgrade: "Older Kubernetes agents send only
 * the running restart count. Upgrade the agent". The hint is stored in the
 * dashboard, in English, as the template wrote it, and looked up when the
 * chart draws it. A query's settings say what its chart draws instead: "When
 * this query has no data in the time range, the chart shows {{metricName}}
 * instead."
 *
 * Read from the Dashboard's locale files themselves, so a key that loses its
 * translation, keeps the English or loses its placeholder is caught; and
 * drawn by the real Chart widget in German, Japanese and Persian, so the
 * stored English is what the reader never sees.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          "chart",
        );
      },
    };
  },
);

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import {
  DASHBOARD_TEMPLATE_FALLBACK_HINTS,
  KUBERNETES_RESTARTS_FALLBACK_HINT,
} from "../../../Types/Dashboard/DashboardTemplateFallbackHints";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { MetricQueryFallbackHint } from "../../../Types/Metrics/MetricQueryFallback";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const HINT_TEXT: string = KUBERNETES_RESTARTS_FALLBACK_HINT.text;
const HINT_LINK_TEXT: string = KUBERNETES_RESTARTS_FALLBACK_HINT.linkText!;

// The query settings' line under a query that has a fallback.
const QUERY_NOTE: string =
  "When this query has no data in the time range, the chart shows {{metricName}} instead.";

const FALLBACK_WORDS: Array<string> = [HINT_TEXT, HINT_LINK_TEXT, QUERY_NOTE];

// The language's other link to an agent's upgrade, whose verb this one uses.
const UPGRADE_AN_AGENT: string = "Upgrade the {{agentName}}";

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("a chart's fallback words in English", () => {
  test("every word is an English key of its own", () => {
    for (const word of FALLBACK_WORDS) {
      expect(ENGLISH[word]).toBe(word);
    }
  });

  test("every hint a template ships is made of keys", () => {
    expect(DASHBOARD_TEMPLATE_FALLBACK_HINTS.length).toBeGreaterThan(0);

    for (const hint of DASHBOARD_TEMPLATE_FALLBACK_HINTS) {
      expect(ENGLISH[hint.text]).toBe(hint.text);
      expect(ENGLISH[hint.linkText!]).toBe(hint.linkText);
    }
  });
});

describe.each(LANGUAGES)(
  "a chart's fallback words in %s",
  (language: string) => {
    const locale: Record<string, string> = LOCALES[language]!;

    test("every word is the language's own, not the English", () => {
      const english: Array<string> = FALLBACK_WORDS.filter(
        (word: string): boolean => {
          return !locale[word] || locale[word] === word;
        },
      );

      expect(english).toEqual([]);
    });

    test("every hint a template ships reads in the language", () => {
      for (const hint of DASHBOARD_TEMPLATE_FALLBACK_HINTS) {
        expect(locale[hint.text]).toBeTruthy();
        expect(locale[hint.text]).not.toBe(hint.text);
        expect(locale[hint.linkText!]).toBeTruthy();
        expect(locale[hint.linkText!]).not.toBe(hint.linkText);
      }
    });

    test("the hint names Kubernetes as written, and ends as a sentence does", () => {
      const hint: string = locale[HINT_TEXT]!;

      expect(hint).toContain("Kubernetes");
      expect(hint).toMatch(/[.。।]$/u);
    });

    test("the link says upgrade as the language's other agent upgrade links do", () => {
      const verb: string = locale[UPGRADE_AN_AGENT]!.replace(
        "{{agentName}}",
        "",
      ).trim();

      expect(verb.length).toBeGreaterThan(0);
      expect(locale[HINT_LINK_TEXT]!.toLocaleLowerCase()).toContain(
        verb.toLocaleLowerCase(),
      );
    });

    test("the query settings' line keeps the metric's place exactly once", () => {
      const note: string = locale[QUERY_NOTE]!;

      expect(note.split("{{metricName}}")).toHaveLength(2);
      expect(note).not.toContain("{{metricName}}}");
    });
  },
);

/*
 * Drawn: the restarts chart of a dashboard made from the Kubernetes
 * template, in a window where the agent sent only the running count.
 */
const COMPONENT_ID: ObjectID = new ObjectID(
  "44444444-1111-4111-8111-444444444444",
);

const OLDER_AGENT_WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-31T06:00:00.000Z"),
  new Date("2026-10-31T07:00:00.000Z"),
);

function storedRestartsChart(): DashboardChartComponent {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Kubernetes,
  );
  const chart: DashboardBaseComponent | undefined = config?.components.find(
    (component: DashboardBaseComponent): boolean => {
      return (
        component.componentType === DashboardComponentType.Chart &&
        Boolean(
          (
            (component.arguments as Record<string, unknown>)[
              "metricQueryConfig"
            ] as MetricQueryConfigData | undefined
          )?.fallback,
        )
      );
    },
  );

  if (!chart) {
    throw new Error("The Kubernetes template has no chart with a fallback");
  }

  return JSON.parse(JSON.stringify(chart)) as DashboardChartComponent;
}

function renderRestartsChart(): void {
  const props: DashboardBaseComponentProps = {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "restarts-chart",
    onComponentUpdate: (): void => {
      // Not written back here.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: {
      _type: ObjectType.DashboardViewConfig,
      components: [],
      heightInDashboardUnits: 60,
    },
    dashboardStartAndEndDate: {
      range: TimeRange.CUSTOM,
      startAndEndDate: OLDER_AGENT_WINDOW,
    },
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
  } as DashboardBaseComponentProps;

  render(
    <DashboardChartComponentElement
      {...props}
      component={storedRestartsChart()}
    />,
  );
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: ENGLISH },
  };

  for (const language of ["de", "ja", "fa"]) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  fetchResultsMock.mockReset();
  // An older agent: no increase in the window, only the running count.
  fetchResultsMock.mockImplementation(
    (args: unknown): Promise<Array<AggregatedResult>> => {
      const data: MetricViewData = (args as { metricViewData: MetricViewData })
        .metricViewData;

      return Promise.resolve(
        data.queryConfigs.map(
          (config: MetricQueryConfigData): AggregatedResult => {
            return config.metricQueryData.filterData.metricName ===
              "k8s.container.restarts"
              ? {
                  data: [
                    {
                      timestamp: new Date("2026-10-31T06:10:00.000Z"),
                      value: 3,
                    },
                  ],
                }
              : { data: [] };
          },
        ),
      );
    },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe.each(["de", "ja", "fa"])(
  "the restarts chart drawing the running count in %s",
  (language: string) => {
    test("says why, and links the upgrade, in the reader's language", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      renderRestartsChart();

      await waitFor(() => {
        expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
      });

      const hint: MetricQueryFallbackHint = KUBERNETES_RESTARTS_FALLBACK_HINT;
      const locale: Record<string, string> = LOCALES[language]!;

      expect(screen.getByTestId("chart-fallback-hint")).toHaveTextContent(
        `${locale[hint.text]} ${locale[hint.linkText!]}`,
      );
      expect(screen.queryByText(hint.text)).toBeNull();
      expect(
        screen.getByRole("link", { name: locale[hint.linkText!]! }),
      ).toHaveAttribute("href", hint.linkUrl);
    });
  },
);

test("the same chart reads in English for an English reader", async () => {
  renderRestartsChart();

  await waitFor(() => {
    expect(screen.getByTestId("chart-fallback-hint")).toBeInTheDocument();
  });

  expect(screen.getByTestId("chart-fallback-hint")).toHaveTextContent(
    `${HINT_TEXT} ${HINT_LINK_TEXT}`,
  );
});
