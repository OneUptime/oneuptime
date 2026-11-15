// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ChartWordsOfSource,
  ChartWordsProblem,
  getChartWordsProblems,
  getChartWordTexts,
  readChartWords,
} from "../../Helpers/ChartWordsScan";

/*
 * A CHART'S WORDS ARE HANDED TO IT IN THE READER'S LANGUAGE (#8047).
 *
 * A page of metric charts hands each chart its title, description and
 * legend (metricAliasData), and the charts draw them exactly as handed:
 * nothing on the way looks them up. The Kubernetes resource pages, the
 * Docker, Podman, Proxmox, Docker Swarm, Ceph and OpenStack pages and a
 * network device's charts handed their English, so their chart titles and
 * legends read English in all 17 other languages, though the languages
 * word most of them (the Control Plane page was #7486).
 *
 * Every page that hands a chart a literal now either hands its queries
 * through chartWordsInReadersLanguage, once, where they go to the chart, or
 * looks each literal up where it writes it (`tx("CPU Utilization")`, as the
 * VMware pages do, and as a page whose descriptions are sentences built
 * around a name must) - never both, since a translation looked up again
 * can itself be an English key and read as the translation of the
 * translation (#7790). This reads every Dashboard source's syntax tree
 * (ChartWordsScan), so a page added later is held too.
 *
 * A monitor's, an incident's, an alert's and an SLO's charts take their
 * words from shared utilities that write them in English
 * (MonitorMetricTypeUtil, IncidentMetricTypeUtil, AlertMetricTypeUtil,
 * SloMetricTypeUtil), which the scan could not see: they read English in
 * every language (#8282). The scan reads a word from one of them as
 * English now, so those pages are held the same way.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

/*
 * Sources whose chart words never reach a chart, with why: what they hand
 * metricAliasData is read by a query, never drawn.
 */
const NOT_DRAWN: Record<string, string> = {
  "Components/NetworkDevice/DeviceLatencyTrend.tsx":
    "fetches its two series to draw a summary and sparklines of its own; the query's title and legend are never shown",
};

const SOURCE_FILE: RegExp = /\.tsx?$/;

function sourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

const SOURCES: Array<{ file: string; words: ChartWordsOfSource }> = sourceFiles(
  DASHBOARD_SRC,
)
  .filter((file: string): boolean => {
    return fs.readFileSync(file, "utf8").includes("metricAliasData");
  })
  .map((file: string) => {
    return {
      file: relative(file),
      words: readChartWords(file, fs.readFileSync(file, "utf8")),
    };
  });

function problemsOf(fileName: string, source: string): Array<string> {
  return getChartWordsProblems(readChartWords(fileName, source)).map(
    (problem: ChartWordsProblem): string => {
      return problem.problem;
    },
  );
}

describe("the detector (ChartWordsScan), on small pages", () => {
  const ENGLISH_ALIAS: string = `
    const query = {
      metricAliasData: {
        metricVariable: "cpu",
        title: "CPU Utilization",
        description: "",
        legend: "CPU",
        legendUnit: "%",
      },
    };
    const page = <EmbeddedMetricCard queryConfigs={[query]} />;
  `;

  test("negative control: an English title and legend handed as written are found", () => {
    expect(problemsOf("Page.tsx", ENGLISH_ALIAS)).toHaveLength(2);
    expect(problemsOf("Page.tsx", ENGLISH_ALIAS)[0]).toContain(
      '"CPU Utilization" is handed to the chart in English',
    );
  });

  test("the same page handing its queries through the helper is sound", () => {
    expect(
      problemsOf(
        "Page.tsx",
        ENGLISH_ALIAS.replace(
          "queryConfigs={[query]}",
          "queryConfigs={chartWordsInReadersLanguage([query], translator)}",
        ),
      ),
    ).toEqual([]);
  });

  test("a page that looks each literal up where it writes it is sound", () => {
    expect(
      problemsOf(
        "Page.tsx",
        ENGLISH_ALIAS.replace(
          'title: "CPU Utilization"',
          'title: tx("CPU Utilization")',
        ).replace('legend: "CPU"', 'legend: translator.translateText("CPU")'),
      ),
    ).toEqual([]);
  });

  test("negative control: a word looked up by hand and again by the helper is found", () => {
    const twice: Array<string> = problemsOf(
      "Page.tsx",
      ENGLISH_ALIAS.replace(
        'title: "CPU Utilization"',
        'title: tx("CPU Utilization")',
      ).replace(
        "queryConfigs={[query]}",
        "queryConfigs={chartWordsInReadersLanguage([query], translator)}",
      ),
    );

    expect(twice).toHaveLength(1);
    expect(twice[0]).toContain("looked up here and again");
  });

  const SPECS: string = `
    function buildQuery(spec) {
      return {
        metricAliasData: {
          metricVariable: spec.variable,
          title: spec.title,
          description: spec.description,
          legend: spec.legend,
          legendUnit: spec.legendUnit,
        },
      };
    }
    const queries = [
      buildQuery({ variable: "keys", title: "Total Keys", description: "Keys in etcd.", legend: "Keys", legendUnit: "", metricName: "etcd_keys" }),
    ];
    const page = <EmbeddedMetricCard queryConfigs={queries} />;
  `;

  test("negative control: a spec's English that reaches the chart as written is found", () => {
    expect(problemsOf("Page.tsx", SPECS)).toHaveLength(3);
  });

  test("a spec handed through the helper, or looked up by its builder, is sound", () => {
    expect(
      problemsOf(
        "Page.tsx",
        SPECS.replace(
          "queryConfigs={queries}",
          "queryConfigs={chartWordsInReadersLanguage(queries, translator)}",
        ),
      ),
    ).toEqual([]);
    expect(
      problemsOf(
        "Page.tsx",
        SPECS.replace(
          "title: spec.title,",
          "title: translator.translateText(spec.title) || spec.title,",
        ).replace(
          "legend: spec.legend,",
          "legend: translator.translateText(spec.legend) || spec.legend,",
        ),
      ),
    ).toEqual([]);
  });

  test("negative control: a word marked as a key (translationKey) is still English, and is found", () => {
    const marked: string = SPECS.replace(
      'title: "Total Keys"',
      'title: translationKey("Total Keys")',
    );

    expect(problemsOf("Page.tsx", marked)).toHaveLength(3);
    expect(getChartWordTexts(readChartWords("Page.tsx", marked))).toContain(
      "Total Keys",
    );
  });

  test("an empty title is no word; a card's own title is no chart's", () => {
    expect(
      problemsOf(
        "Page.tsx",
        `const query = { metricAliasData: { title: "", description: "", legend: "" } };
         const card = { title: "Node Metrics", description: "Charts." };`,
      ),
    ).toEqual([]);
  });

  test("the words it reads: the literals, and what is looked up", () => {
    expect(
      getChartWordTexts(
        readChartWords(
          "Page.tsx",
          ENGLISH_ALIAS.replace('legend: "CPU"', 'legend: tx("Processor")'),
        ),
      ),
    ).toEqual(["CPU Utilization", "Processor"]);
  });
});

describe("the detector, on a word a shared utility writes in English (#8282)", () => {
  const UTILITY_ALIAS: string = `
    const queries = [];
    for (const metricType of IncidentMetricTypeUtil.getAllIncidentMetricTypes()) {
      queries.push({
        metricAliasData: {
          metricVariable: metricType,
          title: IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType),
          description: IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(metricType),
          legend: IncidentMetricTypeUtil.getLegendByIncidentMetricType(metricType),
          legendUnit: "s",
        },
      });
    }
    const card = <EmbeddedMetricCard queryConfigs={queries} />;
  `;

  test("negative control: the monitor's Incident Metrics as they were, handing the utility's English, are found", () => {
    const problems: Array<string> = problemsOf("Page.tsx", UTILITY_ALIAS);

    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain(
      "title from IncidentMetricTypeUtil.getTitleByIncidentMetricType() is handed to the chart in English",
    );
  });

  test("handed through the helper, the same page is sound", () => {
    expect(
      problemsOf(
        "Page.tsx",
        UTILITY_ALIAS.replace(
          "queryConfigs={queries}",
          "queryConfigs={chartWordsInReadersLanguage(queries, translator)}",
        ),
      ),
    ).toEqual([]);
  });

  test("a builder that looks each utility word up where it writes it is sound", () => {
    expect(
      problemsOf(
        "Builder.ts",
        `const query = {
          metricAliasData: {
            title: translateChartWord(SloMetricTypeUtil.getTitle(metricType), translator),
            description: getSloMetricChartDescription(metricType, translator),
            legend: translateChartWord(SloMetricTypeUtil.getLegend(metricType), translator),
          },
        };`,
      ),
    ).toEqual([]);
  });

  test("negative control: a builder's word looked up and handed through the helper as well is found", () => {
    const twice: Array<string> = problemsOf(
      "Page.tsx",
      `const query = {
        metricAliasData: {
          title: translateChartWord(MonitorMetricTypeUtil.getTitleByMonitorMetricType(metric), translator),
          legend: "",
        },
      };
      const card = <EmbeddedMetricCard queryConfigs={chartWordsInReadersLanguage([query], translator)} />;`,
    );

    expect(twice).toHaveLength(1);
    expect(twice[0]).toContain("looked up here and again");
  });

  test("the SLO page's own incident and alert sentences read as English too", () => {
    expect(
      problemsOf(
        "Builder.ts",
        `const query = { metricAliasData: { title: "", description: getSloIncidentMetricDescription(metricType), legend: "" } };`,
      ),
    ).toHaveLength(1);
  });

  test("a utility word is no literal: its text stays out of the page's words", () => {
    expect(
      getChartWordTexts(readChartWords("Page.tsx", UTILITY_ALIAS)),
    ).toEqual([]);
  });
});

describe("every Dashboard page hands its charts their words in the reader's language", () => {
  test("the scan reads the pages the issue found English", () => {
    const files: Array<string> = SOURCES.map(
      (source: { file: string }): string => {
        return source.file;
      },
    );

    for (const page of [
      "Pages/Kubernetes/View/NodeDetail.tsx",
      "Pages/Kubernetes/View/PodDetail.tsx",
      "Pages/Kubernetes/View/ServiceMesh.tsx",
      "Pages/Kubernetes/View/ControlPlane.tsx",
      "Pages/Docker/View/Metrics.tsx",
      "Pages/Proxmox/View/NodeDetail.tsx",
      "Pages/DockerSwarm/View/Insights.tsx",
      "Pages/OpenStack/View/ControlPlaneDependency.tsx",
    ]) {
      expect(files).toContain(page);
    }

    /*
     * And the pages that take their words from a shared utility: the
     * monitor's Metrics tab and its Incident and Alert Metrics, and the SLO
     * Metrics page (#8282).
     */
    for (const page of [
      "Components/Monitor/MonitorMetricQueryConfig.ts",
      "Components/Monitor/MonitorIncidentMetrics.tsx",
      "Components/Monitor/MonitorAlertMetrics.tsx",
      "Components/Slo/SloMetricsQueryConfig.ts",
    ]) {
      expect(files).toContain(page);
    }

    const fromUtilities: number = SOURCES.reduce(
      (count: number, source: { words: ChartWordsOfSource }): number => {
        return (
          count +
          source.words.words.filter(
            (word: { source?: string | undefined }): boolean => {
              return Boolean(word.source);
            },
          ).length
        );
      },
      0,
    );
    expect(fromUtilities).toBeGreaterThanOrEqual(6);

    // And it finds their words: hundreds of them.
    const words: number = SOURCES.reduce(
      (count: number, source: { words: ChartWordsOfSource }): number => {
        return count + getChartWordTexts(source.words).length;
      },
      0,
    );
    expect(words).toBeGreaterThan(300);
  });

  test("no page hands a chart English, and none looks a word up twice", () => {
    const problems: Array<string> = [];

    for (const source of SOURCES) {
      if (NOT_DRAWN[source.file]) {
        continue;
      }

      for (const problem of getChartWordsProblems(source.words)) {
        problems.push(`${source.file}:${problem.line} ${problem.problem}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("every listed exception still hands its queries English, with a reason", () => {
    for (const [file, reason] of Object.entries(NOT_DRAWN)) {
      const source: { file: string; words: ChartWordsOfSource } | undefined =
        SOURCES.find((one: { file: string }): boolean => {
          return one.file === file;
        });

      expect(source).toBeDefined();
      expect(getChartWordsProblems(source!.words).length).toBeGreaterThan(0);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
