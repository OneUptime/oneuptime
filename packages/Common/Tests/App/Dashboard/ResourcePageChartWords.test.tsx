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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { withMeaningKeyAsItsWord } from "../../../Types/MeaningKeys";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import {
  getChartWordTexts,
  readChartWords,
} from "../../Helpers/ChartWordsScan";

/*
 * THE RESOURCE PAGES' CHARTS, IN THE READER'S LANGUAGE (#8047).
 *
 * A page of metric charts hands each chart its title, its description and
 * its legend, and the chart draws them as handed. The Kubernetes resource
 * pages ("CPU Utilization", "Pod Memory Usage" with legends "CPU" and
 * "Memory"), their Insights and Service Mesh pages, the Docker and Podman
 * hosts' Metrics, and the Proxmox, Docker Swarm and Ceph Insights handed
 * them English: a German node page read "CPU Utilization" under a German
 * description. They hand them the reader's words now - through
 * chartWordsInReadersLanguage, or each literal looked up where the page
 * writes it.
 *
 * This renders each page with the real locale files behind a real i18next
 * instance, every chart standing in as its words, opens every tab, and
 * reads every chart's title, description and legend in German and Arabic,
 * its metric and unit untouched, and English unchanged. The words are read
 * from the pages themselves (ChartWordsScan), so a chart added later is
 * held too; every word every resource page hands its charts is worded in
 * all 17 other languages, apart from the locale's own same-as-English
 * list.
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
                    data-testid="resource-chart"
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
      default: (props: { children: React.ReactNode }): ReactElement => {
        return <>{props.children}</>;
      },
      useEmbeddedMetricCardGroup: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          clusterIdentifier: "prod-eu",
          hostIdentifier: "docker-01",
          name: "Prod EU",
        });
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: () => {
        return "Could not load";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("80470000-0000-4000-8000-000000000001");
      },
      getLastParamAsString: () => {
        return "web";
      },
      getQueryStringByName: () => {
        return null;
      },
      navigate: () => {
        return undefined;
      },
      getCurrentRoute: () => {
        const { default: RouteType } = jest.requireActual(
          "../../../Types/API/Route",
        ) as { default: new (route: string) => unknown };
        return new RouteType("/dashboard/project/resource");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      fetchLatestK8sObject: () => {
        return Promise.resolve(null);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/useNodeAllocatableCpu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// The tabs that are not about charts.
for (const stub of [
  "KubernetesOverviewTab",
  "KubernetesYamlTab",
  "KubernetesLogsTab",
  "KubernetesContainersTab",
  "KubernetesEnvVarsTab",
  "KubernetesVolumeMountsTab",
]) {
  jest.mock(
    `../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/${stub}`,
    () => {
      return {
        __esModule: true,
        default: () => {
          return <div data-testid={`stub-${stub}`} />;
        },
      };
    },
  );
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesEventsTab" />;
      },
      useKubernetesEventsTab: () => {
        return {
          name: "Events",
          children: <div data-testid="stub-KubernetesEventsTab" />,
        };
      },
    };
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import NodeDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import PodDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail";
import ContainerDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ContainerDetail";
import DeploymentDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentDetail";
import StatefulSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSetDetail";
import DaemonSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSetDetail";
import JobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/JobDetail";
import CronJobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobDetail";
import NamespaceDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NamespaceDetail";
import DeploymentConfigDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentConfigDetail";
import KubernetesInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import ServiceMeshPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ServiceMesh";
import DockerMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Metrics";
import PodmanMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Metrics";
import ProxmoxInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Insights";
import DockerSwarmInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Insights";
import CephInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Insights";
import { withNoBreakSpaces } from "../../../Types/NoBreakSpaces";

const PAGE_PROPS: PageComponentProps = {} as unknown as PageComponentProps;

type LocaleTree = { [key: string]: string | LocaleTree };

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${language}.json`),
      "utf8",
    ),
  ) as LocaleTree;
}

// The words a language writes as English on purpose: its own list, and the shared one.
function sameAsEnglish(language: string): Set<string> {
  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "i18n/Progress", `${language}.json`),
      "utf8",
    ),
  ) as { sameAsEnglish?: Array<string> };
  const shared: Array<string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD, "i18n/SameAsEnglish.json"), "utf8"),
  ) as Array<string>;

  return new Set<string>([...(progress.sameAsEnglish || []), ...shared]);
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
    .queryAllByTestId("resource-chart")
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

async function settle(): Promise<void> {
  await act(async () => {
    for (let pass: number = 0; pass < 5; pass++) {
      await Promise.resolve();
    }
  });
}

// Every chart the page draws, opening each of its tabs in turn.
async function everyChart(
  Page: React.FunctionComponent<PageComponentProps>,
  instance: i18n,
): Promise<Array<ChartWords>> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <Page {...PAGE_PROPS} />
      </I18nextProvider>,
    );
  });
  await settle();

  const charts: Array<ChartWords> = [...chartsOnScreen()];
  const tabCount: number = screen.queryAllByRole("tab").length;

  for (let index: number = 0; index < tabCount; index++) {
    act(() => {
      fireEvent.click(screen.getAllByRole("tab")[index]!);
    });
    await settle();
    charts.push(...chartsOnScreen());
  }

  // A chart drawn on two tabs (or before the tabs) is one chart.
  const seen: Set<string> = new Set<string>();

  return charts.filter((chart: ChartWords): boolean => {
    const key: string = JSON.stringify(chart);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

interface PageGroup {
  name: string;
  pages: Array<{
    name: string;
    Page: React.FunctionComponent<PageComponentProps>;
    source: string;
    /*
     * The files beside it that build some of its charts, under src: their
     * words are the page's too.
     */
    helpers?: Array<string>;
  }>;
}

const GROUPS: Array<PageGroup> = [
  {
    name: "Kubernetes resources",
    pages: [
      {
        name: "node",
        Page: NodeDetailPage,
        source: "Kubernetes/View/NodeDetail.tsx",
        // Its disk charts (#9645), built as a claim's are.
        helpers: ["Pages/Kubernetes/Utils/KubernetesNodeDiskCharts.ts"],
      },
      {
        name: "pod",
        Page: PodDetailPage,
        source: "Kubernetes/View/PodDetail.tsx",
      },
      {
        name: "container",
        Page: ContainerDetailPage,
        source: "Kubernetes/View/ContainerDetail.tsx",
      },
      {
        name: "deployment",
        Page: DeploymentDetailPage,
        source: "Kubernetes/View/DeploymentDetail.tsx",
      },
      {
        name: "statefulset",
        Page: StatefulSetDetailPage,
        source: "Kubernetes/View/StatefulSetDetail.tsx",
      },
      {
        name: "daemonset",
        Page: DaemonSetDetailPage,
        source: "Kubernetes/View/DaemonSetDetail.tsx",
      },
      {
        name: "job",
        Page: JobDetailPage,
        source: "Kubernetes/View/JobDetail.tsx",
      },
      {
        name: "cronjob",
        Page: CronJobDetailPage,
        source: "Kubernetes/View/CronJobDetail.tsx",
      },
      {
        name: "namespace",
        Page: NamespaceDetailPage,
        source: "Kubernetes/View/NamespaceDetail.tsx",
      },
      {
        name: "deploymentconfig",
        Page: DeploymentConfigDetailPage,
        source: "Kubernetes/View/DeploymentConfigDetail.tsx",
      },
    ],
  },
  {
    name: "Kubernetes clusters",
    pages: [
      {
        name: "insights",
        Page: KubernetesInsightsPage,
        source: "Kubernetes/View/Insights.tsx",
      },
      {
        name: "service mesh",
        Page: ServiceMeshPage,
        source: "Kubernetes/View/ServiceMesh.tsx",
      },
    ],
  },
  {
    name: "Docker and Podman",
    pages: [
      {
        name: "docker",
        Page: DockerMetricsPage,
        source: "Docker/View/Metrics.tsx",
      },
      {
        name: "podman",
        Page: PodmanMetricsPage,
        source: "Podman/View/Metrics.tsx",
      },
    ],
  },
  {
    name: "Proxmox, Docker Swarm and Ceph",
    pages: [
      {
        name: "proxmox",
        Page: ProxmoxInsightsPage,
        source: "Proxmox/View/Insights.tsx",
      },
      {
        name: "docker swarm",
        Page: DockerSwarmInsightsPage,
        source: "DockerSwarm/View/Insights.tsx",
      },
      {
        name: "ceph",
        Page: CephInsightsPage,
        source: "Ceph/View/Insights.tsx",
      },
    ],
  },
];

/*
 * Every source whose charts the issue found English, for the words test:
 * the rendered pages above and those this suite does not render.
 */
const WORDED_SOURCES: Array<string> = [
  ...GROUPS.flatMap((group: PageGroup): Array<string> => {
    return group.pages.flatMap(
      (page: { source: string; helpers?: Array<string> }): Array<string> => {
        return [`Pages/${page.source}`, ...(page.helpers || [])];
      },
    );
  }),
  "Pages/Kubernetes/View/ControlPlane.tsx",
  "Pages/Docker/View/ContainerDetail.tsx",
  "Pages/Podman/View/ContainerDetail.tsx",
  "Pages/Proxmox/View/NodeDetail.tsx",
  "Pages/Proxmox/View/GuestDetail.tsx",
  "Pages/Proxmox/View/StorageDetail.tsx",
  "Pages/OpenStack/View/ControlPlaneDependency.tsx",
  "Pages/OpenStack/View/HypervisorDetail.tsx",
  "Pages/OpenStack/View/NetworkDetail.tsx",
  "Pages/OpenStack/View/RouterDetail.tsx",
  "Pages/OpenStack/View/StoragePoolDetail.tsx",
  "Pages/OpenStack/View/VolumeDetail.tsx",
  "Components/OpenStack/Part/OpenStackLoadBalancerTraffic.tsx",
  "Components/OpenStack/Part/OpenStackInstanceUsage.tsx",
  "Components/OpenStack/Part/OpenStackServiceOverview.tsx",
  "Pages/IoT/View/DeviceDetail.tsx",
  "Components/NetworkDevice/DeviceHealthCharts.tsx",
];

function wordsOf(relative: string): Array<string> {
  const file: string = path.join(DASHBOARD, "src", relative);

  return getChartWordTexts(readChartWords(file, fs.readFileSync(file, "utf8")));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
});

describe("every word the resource pages hand their charts", () => {
  const english: LocaleTree = readLocale("en");
  const words: Array<string> = Array.from(
    new Set(WORDED_SOURCES.flatMap(wordsOf)),
  );

  test("is read from the pages: every page hands some", () => {
    for (const source of WORDED_SOURCES) {
      expect([source, wordsOf(source).length > 0]).toEqual([source, true]);
    }
    expect(words.length).toBeGreaterThan(300);
  });

  test("is a key of en.json, as the extraction finds it", () => {
    expect(
      words.filter((word: string): boolean => {
        return english[word] !== word;
      }),
    ).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "is worded in %s, apart from the language's own same-as-English list",
    (language: string) => {
      const locale: LocaleTree = readLocale(language);
      const stated: Set<string> = sameAsEnglish(language);

      expect(
        words.filter((word: string): boolean => {
          return locale[word] === word && !stated.has(word);
        }),
      ).toEqual([]);
    },
  );

  test("the words the issue saw English are the languages' own now", () => {
    for (const language of ["de", "ar", "ru", "ja"]) {
      const locale: LocaleTree = readLocale(language);

      for (const word of [
        "CPU Utilization",
        "Memory Usage",
        "Memory",
        "Container CPU Utilization",
        "Pod Memory Usage",
      ]) {
        expect([language, word, locale[word] !== word]).toEqual([
          language,
          word,
          true,
        ]);
      }
    }
  });
});

describe.each(
  GROUPS.map((group: PageGroup): [string, PageGroup] => {
    return [group.name, group];
  }),
)("%s, drawn", (_name: string, group: PageGroup) => {
  test.each(
    group.pages.map(
      (
        page: PageGroup["pages"][number],
      ): [string, PageGroup["pages"][number]] => {
        return [page.name, page];
      },
    ),
  )(
    "the %s page: English as the page wrote it; German and Arabic in their words, metric and unit untouched",
    async (_page: string, page: PageGroup["pages"][number]) => {
      /*
       * Each word the page wrote, by the English it draws: a key that names
       * its meaning, "Free (storage space)", draws its word, "Free".
       */
      const pageWords: Map<string, string> = new Map<string, string>(
        [
          ...wordsOf(`Pages/${page.source}`),
          ...(page.helpers || []).flatMap(wordsOf),
        ].map((word: string): [string, string] => {
          return [withMeaningKeyAsItsWord(word), word];
        }),
      );
      const englishCharts: Array<ChartWords> = await everyChart(
        page.Page,
        await instanceFor("en"),
      );
      cleanup();

      expect(englishCharts.length).toBeGreaterThan(0);

      // In English, each title and legend is a word the page wrote.
      for (const chart of englishCharts) {
        expect([chart.metric, pageWords.has(chart.title)]).toEqual([
          chart.metric,
          true,
        ]);
        if (chart.legend) {
          expect([chart.metric, pageWords.has(chart.legend)]).toEqual([
            chart.metric,
            true,
          ]);
        }
      }

      for (const language of ["de", "ar"]) {
        const locale: LocaleTree = readLocale(language);
        const charts: Array<ChartWords> = await everyChart(
          page.Page,
          await instanceFor(language),
        );
        cleanup();

        expect(charts).toHaveLength(englishCharts.length);

        charts.forEach((chart: ChartWords, index: number) => {
          const original: ChartWords = englishCharts[index]!;
          const worded: (english: string) => string = (
            english: string,
          ): string => {
            // Looked up by the key the page wrote, which a meaning names.
            const key: string = pageWords.get(english) || english;
            const value: string | LocaleTree | undefined = locale[key];

            // As the page draws it: each number with its unit (NoBreakSpaces).
            return typeof value === "string" && value !== key
              ? withNoBreakSpaces(value, key, language)
              : english;
          };

          expect({
            language,
            metric: chart.metric,
            unit: chart.unit,
            title: chart.title,
            legend: chart.legend,
          }).toEqual({
            language,
            metric: original.metric,
            unit: original.unit,
            title: worded(original.title),
            legend: worded(original.legend),
          });

          /*
           * A description that is a key reads in the language; one built
           * around a name with translateTemplate was already its own.
           */
          if (typeof readLocale("en")[original.description] === "string") {
            expect(chart.description).toBe(worded(original.description));
          }
        });

        // And the issue's own example is no longer English here.
        const words: Array<string> = charts.map((chart: ChartWords): string => {
          return chart.title;
        });
        expect(words).not.toContain("CPU Utilization");
        expect(words).not.toContain("Memory Usage");
      }
    },
  );
});

describe("negative control", () => {
  test("with German's CPU Utilization put back to English, the node's CPU chart reads English", async () => {
    const german: LocaleTree = readLocale("de");
    german["CPU Utilization"] = "CPU Utilization";

    const charts: Array<ChartWords> = await everyChart(
      NodeDetailPage,
      await instanceFor("de", german),
    );

    expect(
      charts.find((chart: ChartWords): boolean => {
        return chart.metric === "k8s.node.cpu.utilization";
      })?.title,
    ).toBe("CPU Utilization");
  });
});
