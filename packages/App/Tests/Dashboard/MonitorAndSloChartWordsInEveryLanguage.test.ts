// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import AlertMetricType from "Common/Types/Alerts/AlertMetricType";
import IncidentMetricType from "Common/Types/Incident/IncidentMetricType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { getDatabaseMetricByMetricType } from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import { createTranslator, Translator } from "Common/Types/Translator";
import AlertMetricTypeUtil from "Common/Utils/Alerts/AlertMetricType";
import IncidentMetricTypeUtil from "Common/Utils/Incident/IncidentMetricType";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import SloMetricTypeUtil from "Common/Utils/Slo/SloMetricType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "Common/Tests/Helpers/DashboardLocales";
import { buildMonitorMetricQueryConfig } from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorMetricQueryConfig";
import {
  SLO_BURN_RATE_CHART_DESCRIPTION,
  buildSloAlertMetricQueryConfigs,
  buildSloIncidentMetricQueryConfigs,
  buildSloMetricQueryConfigs,
  getSloAlertMetricDescription,
  getSloIncidentMetricDescription,
  getSloMetricChartDescription,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import {
  asWrittenTokensMissing,
  fullStopsOf,
  numbersMissing,
} from "./DescriptionWordsKept";

/*
 * A MONITOR'S, AN INCIDENT'S, AN ALERT'S AND AN SLO'S CHARTS HAND THEIR
 * WORDS IN THE READER'S LANGUAGE (#8282).
 *
 * A chart draws its title, its legend and what it shows as it is handed
 * them, and the monitor's Metrics tab, its Incident and Alert Metrics and
 * the SLO Metrics page built them from English utilities
 * (MonitorMetricTypeUtil, IncidentMetricTypeUtil, AlertMetricTypeUtil,
 * SloMetricTypeUtil): "Response Time" read English under a German
 * heading. Each word is a key now (translationKey), looked up once where
 * the chart's query is built, and worded in every Dashboard language.
 *
 * A Database monitor's metric is named by its catalog, whose names are
 * another task's (#8353, #8354), and not held here. The line under every
 * other monitor's chart, what its metric is
 * (MonitorMetricTypeUtil.getDescriptionByMonitorMetricType), is a key too
 * (#8468): worded in every language, it keeps the numbers, protocol names
 * and states the English gives (TCP, IF-MIB, ESTABLISHED, "1-2%") and ends
 * a sentence where the English does.
 */

const PROJECT_ID: string = "0193c0de-5555-4aaa-8bbb-000000000001";
const SLO_ID: ObjectID = new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");

const english: Record<string, string> = readDashboardLocale("en");

// Every word a chart of these pages draws, in English, with where it is from.
function chartWords(): Map<string, string> {
  const words: Map<string, string> = new Map<string, string>();
  const add: (word: string, where: string) => void = (
    word: string,
    where: string,
  ): void => {
    if (word && !words.has(word)) {
      words.set(word, where);
    }
  };

  for (const monitorType of Object.values(MonitorType) as Array<MonitorType>) {
    for (const metric of MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
      monitorType,
    )) {
      if (getDatabaseMetricByMetricType(metric)) {
        continue;
      }

      add(
        MonitorMetricTypeUtil.getTitleByMonitorMetricType(metric, monitorType),
        `a ${monitorType} monitor's chart title`,
      );
      add(
        MonitorMetricTypeUtil.getLegendByMonitorMetricType(metric, monitorType),
        `a ${monitorType} monitor's chart legend`,
      );
      add(
        MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
          metric,
          monitorType,
        ),
        `the line under a ${monitorType} monitor's chart`,
      );
    }
  }

  for (const metric of IncidentMetricTypeUtil.getAllIncidentMetricTypes()) {
    add(
      IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric),
      "incident",
    );
    add(
      IncidentMetricTypeUtil.getLegendByIncidentMetricType(metric),
      "incident",
    );
    add(
      IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metric),
      "incident",
    );
    add(getSloIncidentMetricDescription(metric), "an SLO's incident chart");
  }

  for (const metric of AlertMetricTypeUtil.getAllAlertMetricTypes()) {
    add(AlertMetricTypeUtil.getTitleByAlertMetricType(metric), "alert");
    add(AlertMetricTypeUtil.getLegendByAlertMetricType(metric), "alert");
    add(AlertMetricTypeUtil.getDescriptionByAlertMetricType(metric), "alert");
    add(getSloAlertMetricDescription(metric), "an SLO's alert chart");
  }

  for (const metric of SloMetricTypeUtil.getAll()) {
    add(SloMetricTypeUtil.getTitle(metric), "SLO");
    add(SloMetricTypeUtil.getLegend(metric), "SLO");

    if (metric !== SloMetricType.BurnRate) {
      add(SloMetricTypeUtil.getDescription(metric), "SLO");
    }
  }

  add(SLO_BURN_RATE_CHART_DESCRIPTION.other, "the Burn Rate chart");
  add(`${SLO_BURN_RATE_CHART_DESCRIPTION.other}_one`, "the Burn Rate chart");

  for (const status of [
    SloStatus.Healthy,
    SloStatus.AtRisk,
    SloStatus.BudgetExhausted,
  ]) {
    add(status, "the SLO Status chart's axis");
  }

  return words;
}

const WORDS: Map<string, string> = chartWords();

describe("every word these charts draw", () => {
  test("is read from the utilities, hundreds of charts' worth", () => {
    expect(WORDS.size).toBeGreaterThan(80);

    for (const word of [
      "Response Time",
      "DNS Lookup Time",
      "CPU Usage Percent",
      "Network Connections - Listening",
      "Incident Count",
      "Alert Duration",
      "Time to Resolve",
      "Burn Rate",
      "Error Budget Remaining Time",
      "The number of incidents created for this monitor over time.",
      "The average duration of alerts affecting this SLO.",
    ]) {
      expect({ word, read: WORDS.has(word) }).toEqual({ word, read: true });
    }
  });

  test("is a key of the Dashboard's English locale", () => {
    expect(
      Array.from(WORDS.keys()).filter((word: string): boolean => {
        return english[word] === undefined;
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)("is worded in %s", (language: string) => {
    expect(
      Array.from(WORDS.keys()).filter((word: string): boolean => {
        return !isWordedInDashboardLocale(word, language);
      }),
    ).toEqual([]);
  });

  test("a word put back to English is caught (control)", () => {
    const words: Record<string, string> = readDashboardLocale("it");
    const worded: string = words["DNS Lookup Time"] as string;

    words["DNS Lookup Time"] = "DNS Lookup Time";

    try {
      expect(isWordedInDashboardLocale("DNS Lookup Time", "it")).toBe(false);
    } finally {
      words["DNS Lookup Time"] = worded;
    }

    expect(isWordedInDashboardLocale("DNS Lookup Time", "it")).toBe(true);
  });

  test("the Burn Rate chart says what the catalog says, its window a count", () => {
    expect(
      createTranslator(undefined).translatePlural(
        SLO_BURN_RATE_CHART_DESCRIPTION,
        SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
      ),
    ).toBe(SloMetricTypeUtil.getDescription(SloMetricType.BurnRate));
    expect(getSloMetricChartDescription(SloMetricType.BurnRate)).toBe(
      SloMetricTypeUtil.getDescription(SloMetricType.BurnRate),
    );
  });
});

/*
 * A translator that words each English text as a probe, and each probe as
 * TWICE: a word looked up twice would say it.
 */
const PROBE: string = "DE› ";
const TWICE: string = "TWICE";

const probing: Translator = createTranslator(
  (text: string): string | undefined => {
    if (text.startsWith(PROBE)) {
      return TWICE;
    }

    return `${PROBE}${text}`;
  },
  "de",
);

function aliasWords(query: MetricQueryConfigData): Array<string> {
  return [
    query.metricAliasData?.title || "",
    query.metricAliasData?.legend || "",
    query.metricAliasData?.description || "",
  ].filter((word: string): boolean => {
    return Boolean(word);
  });
}

describe("a monitor's chart (buildMonitorMetricQueryConfig)", () => {
  const build: (
    monitorType: MonitorType,
    metric: MonitorMetricType,
    translator?: Translator,
  ) => MetricQueryConfigData = (
    monitorType: MonitorType,
    metric: MonitorMetricType,
    translator?: Translator,
  ): MetricQueryConfigData => {
    return buildMonitorMetricQueryConfig({
      monitorId: ObjectID.generate(),
      projectId: new ObjectID(PROJECT_ID),
      monitorType: monitorType,
      metric: metric,
      probes: [],
      translator: translator,
    });
  };

  test("hands its title and legend in German", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const query: MetricQueryConfigData = build(
      MonitorType.Website,
      MonitorMetricType.ResponseTime,
      dashboardTranslator("de"),
    );

    expect(query.metricAliasData?.title).toBe(german["Response Time"]);
    expect(query.metricAliasData?.legend).toBe(german["Response Time"]);
    expect(query.metricAliasData?.title).not.toBe("Response Time");
  });

  test.each(["de", "fa", "ar", "ja"])(
    "hands every Server metric's title in %s",
    (language: string) => {
      // As the Translator draws them: each figure held to its unit (#8770).
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      for (const metric of MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Server,
      )) {
        const englishTitle: string =
          MonitorMetricTypeUtil.getTitleByMonitorMetricType(
            metric,
            MonitorType.Server,
          );
        const query: MetricQueryConfigData = build(
          MonitorType.Server,
          metric,
          dashboardTranslator(language),
        );

        expect({ metric, title: query.metricAliasData?.title }).toEqual({
          metric,
          title: words[englishTitle],
        });
      }
    },
  );

  test("a Port monitor's connection time is worded as its own chart", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(
      build(
        MonitorType.Port,
        MonitorMetricType.ResponseTime,
        dashboardTranslator("de"),
      ).metricAliasData?.title,
    ).toBe(german["Total Connection Time (DNS + TCP)"]);
  });

  test("looks each word up once", () => {
    for (const [monitorType, metric] of [
      [MonitorType.Website, MonitorMetricType.ResponseTime],
      [MonitorType.Server, MonitorMetricType.CPUUsagePercent],
      [MonitorType.Ping, MonitorMetricType.PacketLossPercent],
      [MonitorType.NTP, MonitorMetricType.NtpClockOffset],
    ] as Array<[MonitorType, MonitorMetricType]>) {
      const query: MetricQueryConfigData = build(monitorType, metric, probing);

      for (const word of aliasWords(query)) {
        expect(word).not.toContain(TWICE);
        expect(word.startsWith(PROBE)).toBe(true);
      }
    }
  });

  test("a series named by its metric is named in the reader's words; a probe's, a disk's and an interface's as written", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const website: MetricQueryConfigData = build(
      MonitorType.Website,
      MonitorMetricType.ResponseTime,
      dashboardTranslator("de"),
    );

    // No probe to name it by: the metric names it.
    expect(website.getSeries!({ attributes: {} } as never).title).toBe(
      german["Response Time"],
    );

    const server: MetricQueryConfigData = build(
      MonitorType.Server,
      MonitorMetricType.DiskUsagePercent,
      dashboardTranslator("de"),
    );

    expect(
      server.getSeries!({ attributes: { diskPath: "/var" } } as never).title,
    ).toBe("/var");
    expect(
      server.getSeries!({ attributes: { interfaceName: "eth0" } } as never)
        .title,
    ).toBe("eth0");
    expect(server.getSeries!({ attributes: {} } as never).title).toBe(
      german["Disk Usage Percent"],
    );

    // Looked up once there too.
    expect(
      build(MonitorType.Server, MonitorMetricType.DiskUsagePercent, probing)
        .getSeries!({ attributes: {} } as never).title,
    ).toBe(`${PROBE}Disk Usage Percent`);
  });

  test("without a translator it reads English, as the server and a unit test get it", () => {
    const query: MetricQueryConfigData = build(
      MonitorType.Website,
      MonitorMetricType.ResponseTime,
    );

    expect(query.metricAliasData?.title).toBe("Response Time");
    expect(query.metricAliasData?.legend).toBe("Response Time");
    expect(query.getSeries!({ attributes: {} } as never).title).toBe(
      "Response Time",
    );
  });
});

describe("the SLO Metrics page's charts", () => {
  test.each(["de", "fa", "ar"])(
    "hand each word in %s, the Status axis too",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const translator: Translator = dashboardTranslator(language);
      const queries: Array<MetricQueryConfigData> = buildSloMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        metrics: SloMetricTypeUtil.getAll(),
        translator: translator,
      });

      for (const query of queries) {
        const metric: SloMetricType = query.metricQueryData.filterData
          .metricName as SloMetricType;

        expect(query.metricAliasData?.title).toBe(
          words[SloMetricTypeUtil.getTitle(metric)],
        );
        expect(query.metricAliasData?.legend).toBe(
          words[SloMetricTypeUtil.getLegend(metric)],
        );
        expect(query.metricAliasData?.description).toBe(
          metric === SloMetricType.BurnRate
            ? translator.translatePlural(
                SLO_BURN_RATE_CHART_DESCRIPTION,
                SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
              )
            : words[SloMetricTypeUtil.getDescription(metric)],
        );
      }

      const status: MetricQueryConfigData = queries.find(
        (query: MetricQueryConfigData): boolean => {
          return (
            query.metricQueryData.filterData.metricName === SloMetricType.Status
          );
        },
      )!;

      expect(status.yAxisValueFormatter!(0)).toBe(words["Healthy"]);
      expect(status.yAxisValueFormatter!(1)).toBe(words["At Risk"]);
      expect(status.yAxisValueFormatter!(2)).toBe(words["Budget Exhausted"]);
      // A value with no state keeps its number.
      expect(status.yAxisValueFormatter!(7)).toBe("7");
    },
  );

  test("the Burn Rate chart says its window in the language's own words", () => {
    const burn: MetricQueryConfigData = buildSloMetricQueryConfigs({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
      metrics: [SloMetricType.BurnRate],
      translator: dashboardTranslator("de"),
    })[0]!;

    expect(burn.metricAliasData?.description).toContain(
      `${SLO_CURRENT_BURN_RATE_WINDOW_MINUTES}\u00A0Minuten`,
    );
    expect(burn.metricAliasData?.description).not.toContain("minutes");
  });

  test("an SLO's incident and alert charts hand their words in Persian", () => {
    const words: Record<string, string> = readDashboardLocale("fa");
    const translator: Translator = dashboardTranslator("fa");

    for (const query of buildSloIncidentMetricQueryConfigs({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
      translator: translator,
    })) {
      const metric: IncidentMetricType = query.metricQueryData.filterData
        .metricName as IncidentMetricType;

      expect(query.metricAliasData?.title).toBe(
        words[IncidentMetricTypeUtil.getTitleByIncidentMetricType(metric)],
      );
      expect(query.metricAliasData?.legend).toBe(
        words[IncidentMetricTypeUtil.getLegendByIncidentMetricType(metric)],
      );
      expect(query.metricAliasData?.description).toBe(
        words[getSloIncidentMetricDescription(metric)],
      );
    }

    for (const query of buildSloAlertMetricQueryConfigs({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
      translator: translator,
    })) {
      const metric: AlertMetricType = query.metricQueryData.filterData
        .metricName as AlertMetricType;

      expect(query.metricAliasData?.title).toBe(
        words[AlertMetricTypeUtil.getTitleByAlertMetricType(metric)],
      );
      expect(query.metricAliasData?.description).toBe(
        words[getSloAlertMetricDescription(metric)],
      );
    }
  });

  test("looks each word up once", () => {
    const queries: Array<MetricQueryConfigData> = [
      ...buildSloMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        metrics: SloMetricTypeUtil.getAll().filter(
          (metric: SloMetricType): boolean => {
            return metric !== SloMetricType.BurnRate;
          },
        ),
        translator: probing,
      }),
      ...buildSloIncidentMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        translator: probing,
      }),
      ...buildSloAlertMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        translator: probing,
      }),
    ];

    expect(queries.length).toBeGreaterThan(10);

    for (const query of queries) {
      for (const word of aliasWords(query)) {
        expect(word).not.toContain(TWICE);
        expect(word.startsWith(PROBE)).toBe(true);
      }
    }
  });
});

/*
 * What each monitor's chart says its metric is (#8468): every one of the
 * other monitor types' descriptions, and a Port monitor's own response
 * time, held to what a reader types or reads as written.
 */
const DESCRIPTION_NAMES: ReadonlyArray<string> = [
  "TCP",
  "DNS",
  "IP",
  "TLS",
  "ICMP",
  "VoIP",
  "IF-MIB",
  "SFP",
  "CPU",
  "VM",
  "NIC",
  "GPS",
  "JavaScript",
  "Port",
  "ntpd",
  "iowait",
  "ESTABLISHED",
  "LISTEN",
];

const DESCRIPTIONS: Array<string> = Array.from(
  new Set<string>(
    (Object.values(MonitorType) as Array<MonitorType>).flatMap(
      (monitorType: MonitorType): Array<string> => {
        return MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
          monitorType,
        )
          .filter((metric: MonitorMetricType): boolean => {
            return !getDatabaseMetricByMetricType(metric);
          })
          .map((metric: MonitorMetricType): string => {
            return MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
              metric,
              monitorType,
            );
          })
          .filter((description: string): boolean => {
            return description !== "";
          });
      },
    ),
  ),
);

const DROPPED: string =
  "Anteil der Echo-Anfragen ohne Antwort. Verlust über 1% ist schlecht.";

describe("what each monitor's chart says its metric is (#8468)", () => {
  test("is read for every monitor type, a Port monitor's response time its own", () => {
    expect(DESCRIPTIONS.length).toBeGreaterThan(45);

    for (const description of DESCRIPTIONS) {
      expect({ description, held: WORDS.has(description) }).toEqual({
        description,
        held: true,
      });
    }

    const port: string =
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Port,
      );

    expect(DESCRIPTIONS).toContain(port);
    expect(port).not.toBe(
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Website,
      ),
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps each description's numbers, names and states as written, and its full stop",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const stops: ReadonlyArray<string> = fullStopsOf(language);
      const broken: Array<{ description: string; lost: Array<string> }> = [];

      for (const description of DESCRIPTIONS) {
        const worded: string = words[description] as string;
        const lost: Array<string> = [
          ...asWrittenTokensMissing(description, worded, DESCRIPTION_NAMES),
          ...numbersMissing(description, worded),
        ];

        if (
          description.endsWith(".") &&
          !stops.some((stop: string): boolean => {
            return worded.trimEnd().endsWith(stop);
          })
        ) {
          lost.push("its full stop");
        }

        if (lost.length > 0) {
          broken.push({ description, lost });
        }
      }

      expect({ language, broken }).toEqual({ language, broken: [] });
    },
  );

  test("a wording that drops a protocol or a number is caught (control)", () => {
    const description: string =
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.PacketLossPercent,
      );

    expect(
      asWrittenTokensMissing(description, DROPPED, DESCRIPTION_NAMES),
    ).toEqual(["ICMP"]);
    expect(numbersMissing(description, DROPPED)).toEqual(["2"]);
  });
});
