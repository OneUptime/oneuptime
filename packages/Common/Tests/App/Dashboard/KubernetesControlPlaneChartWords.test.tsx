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
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { Translator } from "../../../Types/Translator";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE KUBERNETES CONTROL PLANE'S CHARTS, IN THE READER'S LANGUAGE (#7486).
 *
 * A page of metric charts hands each chart its title, its description and
 * its legend, and the chart draws them as written. The Control Plane page
 * handed them the English, so its every chart - etcd's Total Keys and its
 * Keys legend among them - read English in every language, though the
 * languages word them. It hands them the reader's words now
 * (chartWordsInReadersLanguage), as the Ceph and VMware pages do.
 *
 * This renders the page with the real locale files behind a real i18next
 * instance, each chart standing in as its words, opens every tab, and reads
 * each chart's title, description and legend in every Dashboard language.
 * The words come from the page itself, so a chart added to it is held too.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        queryConfigs?: Array<MetricQueryConfigData>;
      }): ReactElement => {
        return (
          <div>
            {(props.queryConfigs || []).map(
              (query: MetricQueryConfigData, index: number) => {
                return (
                  <div
                    key={index}
                    data-testid="control-plane-chart"
                    data-metric={query.metricQueryData.filterData.metricName}
                  >
                    <span data-part="title">
                      {query.metricAliasData?.title}
                    </span>
                    <span data-part="description">
                      {query.metricAliasData?.description}
                    </span>
                    <span data-part="legend">
                      {query.metricAliasData?.legend}
                    </span>
                    <span data-part="unit">
                      {query.metricAliasData?.legendUnit}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCardGroup",
  () => {
    return {
      __esModule: true,
      default: (props: { children: ReactNode }): ReactElement => {
        return <>{props.children}</>;
      },
    };
  },
);

import KubernetesClusterControlPlane from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ControlPlane";
import { chartWordsInReadersLanguage } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesChartWords";

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const PAGE_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ControlPlane.tsx",
);

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

async function instanceFor(
  language: string,
  locale: LocaleTree = readLocale(language),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface ChartWords {
  metric: string;
  title: string;
  description: string;
  legend: string;
  unit: string;
}

function chartsOnScreen(): Array<ChartWords> {
  return screen
    .getAllByTestId("control-plane-chart")
    .map((chart: HTMLElement): ChartWords => {
      const part: (name: string) => string = (name: string): string => {
        return chart.querySelector(`[data-part="${name}"]`)?.textContent || "";
      };

      return {
        metric: chart.getAttribute("data-metric") || "",
        title: part("title"),
        description: part("description"),
        legend: part("legend"),
        unit: part("unit"),
      };
    });
}

// Every tab's charts, opening each tab in turn.
async function everyChart(instance: i18n): Promise<Array<ChartWords>> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <KubernetesClusterControlPlane {...({} as never)} />
      </I18nextProvider>,
    );
  });

  const charts: Array<ChartWords> = [];
  const tabCount: number = screen.getAllByRole("tab").length;

  for (let index: number = 0; index < tabCount; index++) {
    act(() => {
      fireEvent.click(screen.getAllByRole("tab")[index]!);
    });
    charts.push(...chartsOnScreen());
  }

  return charts;
}

/*
 * The chart words a language writes as English does, with why. Every other
 * chart word is the language's own.
 */
const SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  it: {
    Timestamp:
      "Italian writes timestamp as English does (Microsoft's and Apple's Italian help say timestamp)",
  },
};

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.clusterIdentifier = "prod-eu";

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("b7000000-0000-4000-8000-0000000000d1"));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(cluster as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a chart's words, looked up (chartWordsInReadersLanguage)", () => {
  const translator: Translator = {
    translateText: (text: string | undefined): string | undefined => {
      return (
        { "Total Keys": "Всего ключей", Keys: "Ключи" } as Record<
          string,
          string
        >
      )[text || ""];
    },
  } as unknown as Translator;

  const query: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "etcd_keys",
      title: "Total Keys",
      description: "Total number of keys stored in etcd.",
      legend: "Keys",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: { metricName: "etcd_debugging_mvcc_keys_total" },
    },
  } as unknown as MetricQueryConfigData;

  test("words what the language has, keeps the English where it has nothing", () => {
    const [worded] = chartWordsInReadersLanguage([query], translator);

    expect(worded!.metricAliasData).toEqual({
      metricVariable: "etcd_keys",
      title: "Всего ключей",
      description: "Total number of keys stored in etcd.",
      legend: "Ключи",
      legendUnit: "",
    });
  });

  test("leaves the query, its variable and its unit as they are, and the page's own config unchanged", () => {
    const [worded] = chartWordsInReadersLanguage([query], translator);

    expect(worded!.metricQueryData).toBe(query.metricQueryData);
    expect(query.metricAliasData!.title).toBe("Total Keys");
  });

  test("a chart with no words of its own is handed on as it is", () => {
    const bare: MetricQueryConfigData = {
      metricQueryData: query.metricQueryData,
    } as MetricQueryConfigData;

    expect(chartWordsInReadersLanguage([bare], translator)[0]).toBe(bare);
  });
});

describe("the page's chart words", () => {
  const source: string = fs.readFileSync(PAGE_SOURCE, "utf8");
  const words: Array<string> = Array.from(
    source.matchAll(/\b(?:title|description|legend):\s*"((?:[^"\\]|\\.)*)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
  const english: LocaleTree = readLocale("en");

  test("are all in en.json, as the extraction finds them", () => {
    expect(words.length).toBeGreaterThan(100);

    expect(
      words.filter((word: string): boolean => {
        return english[word] !== word;
      }),
    ).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "are worded in %s, apart from the stated ones",
    (language: string) => {
      const locale: LocaleTree = readLocale(language);
      const stated: Record<string, string> = SAME_AS_ENGLISH[language] || {};

      expect(
        Array.from(new Set(words)).filter((word: string): boolean => {
          return locale[word] === word && !stated[word];
        }),
      ).toEqual([]);

      for (const word of Object.keys(stated)) {
        expect(words).toContain(word);
        expect(locale[word]).toBe(word);
      }
    },
  );
});

describe("the page, drawn", () => {
  test("in English: every chart as the page wrote it", async () => {
    const charts: Array<ChartWords> = await everyChart(await instanceFor("en"));

    expect(charts.length).toBeGreaterThan(30);
    expect(
      charts.find((chart: ChartWords): boolean => {
        return chart.title === "Total Keys";
      }),
    ).toEqual({
      metric: "etcd_debugging_mvcc_keys_total",
      title: "Total Keys",
      description: "Total number of keys stored in etcd.",
      legend: "Keys",
      unit: "",
    });
  });

  test("negative control: with Russian's Keys put back to English, the Keys legend reads English", async () => {
    const russian: LocaleTree = readLocale("ru");
    russian["Keys"] = "Keys";

    const charts: Array<ChartWords> = await everyChart(
      await instanceFor("ru", russian),
    );

    expect(
      charts.filter((chart: ChartWords): boolean => {
        return chart.legend === "Keys";
      }),
    ).toHaveLength(1);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "in %s: every chart's title, description and legend in the language, its metric and unit as they are",
    async (language: string) => {
      const locale: LocaleTree = readLocale(language);

      const englishCharts: Array<ChartWords> = await everyChart(
        await instanceFor("en"),
      );
      cleanup();
      const charts: Array<ChartWords> = await everyChart(
        await instanceFor(language),
      );

      expect(charts).toHaveLength(englishCharts.length);

      charts.forEach((chart: ChartWords, index: number) => {
        const english: ChartWords = englishCharts[index]!;

        expect(chart).toEqual({
          metric: english.metric,
          title: locale[english.title],
          description: locale[english.description],
          legend: locale[english.legend],
          unit: english.unit,
        });
      });

      // The words the issue found English: etcd's Total Keys and its Keys legend.
      const totalKeys: ChartWords = charts.find(
        (chart: ChartWords): boolean => {
          return chart.metric === "etcd_debugging_mvcc_keys_total";
        },
      )!;
      expect(totalKeys.title).not.toBe("Total Keys");
      expect(totalKeys.legend).not.toBe("Keys");
    },
  );
});
