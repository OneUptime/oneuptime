// UX rule: Docs/ux/README.md#in-every-language
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
import MonitorAlertMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorAlertMetrics";
import MonitorIncidentMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorIncidentMetrics";
import MonitorMetricsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorMetrics";
import SloAlertMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloAlertMetrics";
import SloIncidentMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloIncidentMetrics";
import SloMetricsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMetrics";
import {
  SLO_BURN_RATE_CHART_DESCRIPTION,
  getSloAlertMetricDescription,
  getSloIncidentMetricDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import AlertMetricTypeUtil from "../../../Utils/Alerts/AlertMetricType";
import IncidentMetricTypeUtil from "../../../Utils/Incident/IncidentMetricType";
import MonitorMetricTypeUtil from "../../../Utils/Monitor/MonitorMetricType";
import SloMetricTypeUtil from "../../../Utils/Slo/SloMetricType";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "../../../Utils/Slo/SloEvaluation";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A MONITOR'S, AN INCIDENT'S, AN ALERT'S AND AN SLO'S CHARTS, IN THE
 * READER'S LANGUAGE (#8282).
 *
 * A chart draws the title, the legend and the words under it that its page
 * hands it, as handed. The monitor's Metrics tab, its Incident and Alert
 * Metrics cards and the SLO Metrics page handed the English their metric
 * utilities write, so a German reader read "Response Time", "Incident
 * Count" and "Burn Rate" under German headings, and a Persian one read
 * English in a right-to-left page.
 *
 * Each hands them in the reader's language now, looked up once. The cards
 * are drawn as what they are handed, through i18next with the Dashboard's
 * own locale files: English, German, Persian and Arabic, and German
 * worded so that a word looked up twice would read TWICE.
 */

let mockMonitorType: MonitorType = MonitorType.Website;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          monitorType: mockMonitorType,
          monitorSteps: { data: { monitorStepsInstanceArray: [] } },
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

interface DrawnQuery {
  metricAliasData?: { title?: string; legend?: string; description?: string };
  metricQueryData: { filterData: { metricName?: string } };
  getSeries?: (data: unknown) => { title: string };
  yAxisValueFormatter?: (value: number) => string;
}

// The card, drawn as what it is handed: one line per chart.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mockReact: typeof React = require("react");

    return {
      __esModule: true,
      default: (props: { queryConfigs?: Array<DrawnQuery> }) => {
        return mockReact.createElement(
          "section",
          { "data-testid": "metric-card" },
          (props.queryConfigs || []).map((query: DrawnQuery) => {
            return mockReact.createElement("div", {
              key: query.metricQueryData.filterData.metricName,
              "data-testid": "chart",
              "data-metric": query.metricQueryData.filterData.metricName,
              "data-title": query.metricAliasData?.title || "",
              "data-legend": query.metricAliasData?.legend || "",
              "data-description": query.metricAliasData?.description || "",
              "data-series": query.getSeries
                ? query.getSeries({ attributes: {} }).title
                : "",
              "data-axis": query.yAxisValueFormatter
                ? query.yAxisValueFormatter(1)
                : "",
            });
          }),
        );
      },
    };
  },
);

const TWICE: string = "TWICE";
const PROBE: string = "DE› ";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const instances: Record<string, i18n> = {};

// German, each chart word worded as a probe, and each probe a word of its own.
function probedGerman(): Record<string, string> {
  const words: Record<string, string> = { ...readDashboardLocale("de") };
  const english: Array<string> = [];

  for (const metric of IncidentMetricTypeUtil.getAllIncidentMetricTypes()) {
    english.push(
      IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric),
      IncidentMetricTypeUtil.getLegendByIncidentMetricType(metric),
      IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metric),
      getSloIncidentMetricDescription(metric),
    );
  }

  for (const metric of AlertMetricTypeUtil.getAllAlertMetricTypes()) {
    english.push(
      AlertMetricTypeUtil.getTitleByAlertMetricType(metric),
      AlertMetricTypeUtil.getLegendByAlertMetricType(metric),
      AlertMetricTypeUtil.getDescriptionByAlertMetricType(metric),
      getSloAlertMetricDescription(metric),
    );
  }

  for (const metric of SloMetricTypeUtil.getAll()) {
    english.push(
      SloMetricTypeUtil.getTitle(metric),
      SloMetricTypeUtil.getLegend(metric),
      SloMetricTypeUtil.getDescription(metric),
    );
  }

  for (const metric of MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
    MonitorType.Website,
  )) {
    english.push(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        metric,
        MonitorType.Website,
      ),
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        metric,
        MonitorType.Website,
      ),
    );
  }

  english.push("At Risk");

  for (const word of english) {
    words[word] = `${PROBE}${word}`;
    words[`${PROBE}${word}`] = TWICE;
  }

  return words;
}

beforeAll(async () => {
  for (const code of [...LANGUAGES, "probed"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code === "probed" ? "de" : code,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [code === "probed" ? "de" : code]: {
          translation:
            code === "probed" ? probedGerman() : readDashboardLocale(code),
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  mockMonitorType = MonitorType.Website;
});

function drawIn(code: string, element: React.ReactElement): void {
  render(
    <I18nextProvider i18n={instances[code] as i18n}>{element}</I18nextProvider>,
  );
}

interface Chart {
  metric: string;
  title: string;
  legend: string;
  description: string;
  series: string;
  axis: string;
}

async function charts(): Promise<Array<Chart>> {
  const drawn: Array<HTMLElement> = await screen.findAllByTestId("chart");

  return drawn.map((chart: HTMLElement): Chart => {
    return {
      metric: chart.getAttribute("data-metric") || "",
      title: chart.getAttribute("data-title") || "",
      legend: chart.getAttribute("data-legend") || "",
      description: chart.getAttribute("data-description") || "",
      series: chart.getAttribute("data-series") || "",
      axis: chart.getAttribute("data-axis") || "",
    };
  });
}

// The language's word for an English text, as the page draws it.
function wordIn(code: string, english: string): string {
  return dashboardTranslator(code).translateText(english) || english;
}

const MONITOR_ID: ObjectID = ObjectID.generate();
const SLO_ID: ObjectID = ObjectID.generate();

describe("a monitor's Incident Metrics and Alert Metrics", () => {
  test.each(LANGUAGES)(
    "the incident charts hand their words in %s",
    async (code: string) => {
      drawIn(code, <MonitorIncidentMetrics monitorId={MONITOR_ID} />);

      const drawn: Array<Chart> = await charts();

      expect(
        drawn.map((chart: Chart) => {
          return chart.metric;
        }),
      ).toEqual(IncidentMetricTypeUtil.getAllIncidentMetricTypes());

      for (const chart of drawn) {
        const metric: IncidentMetricType = chart.metric as IncidentMetricType;

        expect(chart).toEqual(
          expect.objectContaining({
            title: wordIn(
              code,
              IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric),
            ),
            legend: wordIn(
              code,
              IncidentMetricTypeUtil.getLegendByIncidentMetricType(metric),
            ),
            description: wordIn(
              code,
              IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metric),
            ),
          }),
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "the alert charts hand their words in %s",
    async (code: string) => {
      drawIn(code, <MonitorAlertMetrics monitorId={MONITOR_ID} />);

      for (const chart of await charts()) {
        const metric: AlertMetricType = chart.metric as AlertMetricType;

        expect(chart.title).toBe(
          wordIn(code, AlertMetricTypeUtil.getTitleByAlertMetricType(metric)),
        );
        expect(chart.legend).toBe(
          wordIn(code, AlertMetricTypeUtil.getLegendByAlertMetricType(metric)),
        );
        expect(chart.description).toBe(
          wordIn(
            code,
            AlertMetricTypeUtil.getDescriptionByAlertMetricType(metric),
          ),
        );
      }
    },
  );

  test.each(["de", "fa", "ar"])(
    "in %s no chart word reads English",
    async (code: string) => {
      drawIn(code, <MonitorIncidentMetrics monitorId={MONITOR_ID} />);

      for (const chart of await charts()) {
        const metric: IncidentMetricType = chart.metric as IncidentMetricType;

        expect(chart.title).not.toBe(
          IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric),
        );
        expect(chart.description).not.toBe(
          IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metric),
        );
      }
    },
  );

  test("German reads Anzahl der Vorfälle, and each word is looked up once", async () => {
    drawIn("de", <MonitorIncidentMetrics monitorId={MONITOR_ID} />);

    expect(
      (await charts()).find((chart: Chart): boolean => {
        return chart.metric === IncidentMetricType.IncidentCount;
      })?.title,
    ).toBe("Anzahl der Vorfälle");

    cleanup();
    drawIn("probed", <MonitorAlertMetrics monitorId={MONITOR_ID} />);

    for (const chart of await charts()) {
      for (const word of [chart.title, chart.legend, chart.description]) {
        expect(word).not.toContain(TWICE);
        expect(word.startsWith(PROBE)).toBe(true);
      }
    }
  });
});

describe("a monitor's Metrics tab", () => {
  test.each(LANGUAGES)(
    "a website monitor's charts hand their titles, legends and series in %s",
    async (code: string) => {
      drawIn(code, <MonitorMetricsElement monitorId={MONITOR_ID} />);

      const drawn: Array<Chart> = await charts();

      expect(
        drawn.map((chart: Chart) => {
          return chart.metric;
        }),
      ).toContain(MonitorMetricType.ResponseTime);

      for (const chart of drawn) {
        const title: string = wordIn(
          code,
          MonitorMetricTypeUtil.getTitleByMonitorMetricType(
            chart.metric as MonitorMetricType,
            MonitorType.Website,
          ),
        );

        expect(chart.title).toBe(title);
        expect(chart.legend).toBe(title);
        // A series no probe names is named by its metric.
        expect(chart.series).toBe(title);
        // The line under the title says what the metric is (#8468).
        expect(chart.description).toBe(
          wordIn(
            code,
            MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
              chart.metric as MonitorMetricType,
              MonitorType.Website,
            ),
          ),
        );
      }
    },
  );

  test("German says what a website monitor's DNS lookup time is, under its chart", async () => {
    drawIn("de", <MonitorMetricsElement monitorId={MONITOR_ID} />);

    expect(
      (await charts()).find((chart: Chart): boolean => {
        return chart.metric === MonitorMetricType.DnsLookupTime;
      })?.description,
    ).toBe(
      "Zeit für das Auflösen des Hostnamens in eine IP-Adresse. Spitzen hier deuten auf den DNS-Anbieter hin, nicht auf den überwachten Dienst.",
    );
  });

  test("German reads Antwortzeit over a website monitor's chart", async () => {
    drawIn("de", <MonitorMetricsElement monitorId={MONITOR_ID} />);

    expect(
      (await charts()).find((chart: Chart): boolean => {
        return chart.metric === MonitorMetricType.ResponseTime;
      })?.title,
    ).toBe("Antwortzeit");
  });

  test.each(["fa", "ar"])(
    "a server monitor's charts read %s, each one",
    async (code: string) => {
      mockMonitorType = MonitorType.Server;
      drawIn(code, <MonitorMetricsElement monitorId={MONITOR_ID} />);

      const drawn: Array<Chart> = await charts();

      expect(drawn.length).toBeGreaterThan(20);

      for (const chart of drawn) {
        const english: string =
          MonitorMetricTypeUtil.getTitleByMonitorMetricType(
            chart.metric as MonitorMetricType,
            MonitorType.Server,
          );

        expect({ metric: chart.metric, title: chart.title }).toEqual({
          metric: chart.metric,
          title: readDashboardLocale(code)[english],
        });
        expect(chart.title).not.toBe(english);

        const englishDescription: string =
          MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
            chart.metric as MonitorMetricType,
            MonitorType.Server,
          );

        expect({
          metric: chart.metric,
          description: chart.description,
        }).toEqual({
          metric: chart.metric,
          description: readDashboardLocale(code)[englishDescription],
        });
        expect(chart.description).not.toBe(englishDescription);
      }
    },
  );

  test("each word is looked up once", async () => {
    drawIn("probed", <MonitorMetricsElement monitorId={MONITOR_ID} />);

    for (const chart of await charts()) {
      for (const word of [
        chart.title,
        chart.legend,
        chart.series,
        chart.description,
      ]) {
        expect(word).not.toContain(TWICE);
        expect(word.startsWith(PROBE)).toBe(true);
      }
    }
  });
});

describe("the SLO Metrics page", () => {
  test.each(LANGUAGES)(
    "the SLO's charts hand their words in %s, the Status axis too",
    async (code: string) => {
      const translator: ReturnType<typeof dashboardTranslator> =
        dashboardTranslator(code);

      drawIn(code, <SloMetricsElement sloId={SLO_ID} />);

      const drawn: Array<Chart> = await charts();

      expect(
        drawn
          .map((chart: Chart) => {
            return chart.metric;
          })
          .sort(),
      ).toEqual([...SloMetricTypeUtil.getAll()].sort());

      for (const chart of drawn) {
        const metric: SloMetricType = chart.metric as SloMetricType;

        expect(chart.title).toBe(
          wordIn(code, SloMetricTypeUtil.getTitle(metric)),
        );
        expect(chart.legend).toBe(
          wordIn(code, SloMetricTypeUtil.getLegend(metric)),
        );
        expect(chart.description).toBe(
          metric === SloMetricType.BurnRate
            ? translator.translatePlural(
                SLO_BURN_RATE_CHART_DESCRIPTION,
                SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
              )
            : wordIn(code, SloMetricTypeUtil.getDescription(metric)),
        );

        if (metric === SloMetricType.Status) {
          expect(chart.axis).toBe(wordIn(code, "At Risk"));
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "an SLO's incident and alert charts hand their words in %s",
    async (code: string) => {
      drawIn(
        code,
        <>
          <SloIncidentMetrics sloId={SLO_ID} />
          <SloAlertMetrics sloId={SLO_ID} />
        </>,
      );

      const drawn: Array<Chart> = await charts();

      expect(drawn).toHaveLength(8);

      for (const chart of drawn.slice(0, 4)) {
        const metric: IncidentMetricType = chart.metric as IncidentMetricType;

        expect(chart.title).toBe(
          wordIn(
            code,
            IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric),
          ),
        );
        expect(chart.description).toBe(
          wordIn(code, getSloIncidentMetricDescription(metric)),
        );
      }

      for (const chart of drawn.slice(4)) {
        const metric: AlertMetricType = chart.metric as AlertMetricType;

        expect(chart.title).toBe(
          wordIn(code, AlertMetricTypeUtil.getTitleByAlertMetricType(metric)),
        );
        expect(chart.description).toBe(
          wordIn(code, getSloAlertMetricDescription(metric)),
        );
      }
    },
  );

  test("each word is looked up once", async () => {
    drawIn(
      "probed",
      <>
        <SloMetricsElement sloId={SLO_ID} />
        <SloIncidentMetrics sloId={SLO_ID} />
        <SloAlertMetrics sloId={SLO_ID} />
      </>,
    );

    const drawn: Array<Chart> = await charts();

    expect(drawn.length).toBeGreaterThan(12);

    for (const chart of drawn) {
      const words: Array<string> = [chart.title, chart.legend];

      // The Burn Rate chart's sentence is a plural of its own, not probed.
      if (chart.metric !== SloMetricType.BurnRate) {
        words.push(chart.description);
      }

      if (chart.axis) {
        words.push(chart.axis);
      }

      for (const word of words) {
        expect(word).not.toContain(TWICE);
        expect(word.startsWith(PROBE)).toBe(true);
      }
    }
  });
});
