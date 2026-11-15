import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import MonitorMetricsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorMetrics";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
  getDatabaseMetricsForEngine,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import ObjectID from "../../../Types/ObjectID";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "../../../Utils/Monitor/MonitorMetricType";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A DATABASE MONITOR'S METRICS TAB, IN THE READER'S LANGUAGE (#8014).
 *
 * Each card of charts is a group of the monitor's metrics, and each chart
 * says under its title what its metric is. A Database monitor's charts said
 * their catalog's description in English in every language: the tab hands
 * each chart its description, and the chart draws it as handed. The tab
 * looks it up now, once, where it builds the chart's query
 * (buildMonitorMetricQueryConfig). A group's title and the words under it go
 * to the card in English, for the card to look up once: the tab looked the
 * title up as well, so a translation that is itself a key read as another
 * word.
 *
 * The card is drawn here as what it is handed. Every description and every
 * metric name of the catalog is worded in German as a probe, and every
 * probe, and every group title's German, is a key of its own that reads
 * TWICE: a description, a chart's title or a card's title looked up twice
 * would say it. A chart's title and legend are its metric's name, a key
 * since #8354, looked up where its query is built, once.
 */

const TWICE: string = "TWICE";

const PROBE: string = "DE› ";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          monitorType: "Database",
          monitorSteps: {
            data: {
              monitorStepsInstanceArray: [
                { data: { databaseMonitor: { databaseType: "PostgreSQL" } } },
              ],
            },
          },
        });
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

// The card, drawn as what it is handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mockReact: typeof React = require("react");

    return {
      __esModule: true,
      default: (props: {
        title?: string;
        description?: string;
        queryConfigs?: Array<{
          metricAliasData?: {
            title?: string;
            description?: string;
            legend?: string;
          };
          metricQueryData: { filterData: { metricName?: string } };
        }>;
      }) => {
        return mockReact.createElement(
          "section",
          {
            "data-testid": "metric-card",
            "data-title": props.title,
            "data-description": props.description,
          },
          (props.queryConfigs || []).map(
            (query: {
              metricAliasData?: {
                title?: string;
                description?: string;
                legend?: string;
              };
              metricQueryData: { filterData: { metricName?: string } };
            }) => {
              return mockReact.createElement(
                "p",
                {
                  key: query.metricQueryData.filterData.metricName,
                  "data-testid": "chart-description",
                  "data-metric": query.metricQueryData.filterData.metricName,
                  "data-chart-title": query.metricAliasData?.title,
                  "data-legend": query.metricAliasData?.legend,
                },
                query.metricAliasData?.description || "",
              );
            },
          ),
        );
      },
    };
  },
);

const CATEGORIES: Array<MonitorMetricCategory> =
  MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
    MonitorType.Database,
    SqlDatabaseType.PostgreSQL,
  );

const DESCRIPTIONS: Array<string> = getDatabaseMetricsForEngine(
  SqlDatabaseType.PostgreSQL,
).map((metric: DatabaseMetricDefinition): string => {
  return metric.description;
});

// Each chart's title and legend: its metric's name, a key since #8354.
const NAMES: Array<string> = getDatabaseMetricsForEngine(
  SqlDatabaseType.PostgreSQL,
).map((metric: DatabaseMetricDefinition): string => {
  return metric.friendlyName;
});

const german: Record<string, string> = readDashboardLocale("de");

// German as the Dashboard words it, with each description worded as a probe.
const probedGerman: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const words: Record<string, string> = { ...german };

  for (const text of [...DESCRIPTIONS, ...NAMES]) {
    words[text] = `${PROBE}${text}`;
    words[`${PROBE}${text}`] = TWICE;
  }

  for (const category of CATEGORIES) {
    const worded: string | undefined = german[category.title];

    if (worded && worded !== category.title) {
      words[worded] = TWICE;
    }
  }

  return words;
};

const instance: i18n = createInstance();

beforeAll(async () => {
  await instance.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: probedGerman() },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

const drawTab: () => Promise<Array<HTMLElement>> = async (): Promise<
  Array<HTMLElement>
> => {
  render(
    <I18nextProvider i18n={instance}>
      <MonitorMetricsElement monitorId={ObjectID.generate()} />
    </I18nextProvider>,
  );

  return screen.findAllByTestId("metric-card");
};

describe("a Database monitor's Metrics tab", () => {
  test("draws a card for each group of the engine's metrics", async () => {
    const cards: Array<HTMLElement> = await drawTab();

    expect(CATEGORIES.length).toBeGreaterThan(3);
    expect(cards.length).toBe(CATEGORIES.length);
  });

  test("hands each chart its metric's description in the reader's words, looked up once", async () => {
    await drawTab();

    const charts: Array<HTMLElement> =
      screen.getAllByTestId("chart-description");
    let fromTheCatalog: number = 0;

    for (const chart of charts) {
      const metric: DatabaseMetricDefinition | null =
        getDatabaseMetricByMetricType(
          chart.getAttribute("data-metric") as never,
        );

      expect(chart.textContent).not.toContain(TWICE);

      if (metric) {
        fromTheCatalog++;
        expect(chart.textContent).toBe(`${PROBE}${metric.description}`);
      }
    }

    expect(fromTheCatalog).toBeGreaterThan(20);
  });

  test("names each chart, and its legend, by its metric in the reader's words, looked up once (#8354)", async () => {
    await drawTab();

    const charts: Array<HTMLElement> =
      screen.getAllByTestId("chart-description");
    let fromTheCatalog: number = 0;

    for (const chart of charts) {
      const metric: DatabaseMetricDefinition | null =
        getDatabaseMetricByMetricType(
          chart.getAttribute("data-metric") as never,
        );

      expect(chart.getAttribute("data-chart-title")).not.toContain(TWICE);
      expect(chart.getAttribute("data-legend")).not.toContain(TWICE);

      if (metric) {
        fromTheCatalog++;
        expect(chart.getAttribute("data-chart-title")).toBe(
          `${PROBE}${metric.friendlyName}`,
        );
        expect(chart.getAttribute("data-legend")).toBe(
          `${PROBE}${metric.friendlyName}`,
        );
      }
    }

    expect(fromTheCatalog).toBeGreaterThan(20);
  });

  test("hands each card its group's title and words in English, for the card to look up once", async () => {
    const cards: Array<HTMLElement> = await drawTab();

    expect(
      cards.map((card: HTMLElement): string | null => {
        return card.getAttribute("data-title");
      }),
    ).toEqual(
      CATEGORIES.map((category: MonitorMetricCategory): string => {
        return category.title;
      }),
    );
    expect(
      cards.map((card: HTMLElement): string | null => {
        return card.getAttribute("data-description");
      }),
    ).toEqual(
      CATEGORIES.map((category: MonitorMetricCategory): string => {
        return category.description;
      }),
    );
  });
});
