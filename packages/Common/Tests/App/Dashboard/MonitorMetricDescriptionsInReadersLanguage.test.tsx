import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import CephMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMetricPicker";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import DockerMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMetricPicker";
import DockerSwarmMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMetricPicker";
import HostMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMetricPicker";
import IoTMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMetricPicker";
import KubernetesMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMetricPicker";
import OpenStackMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMetricPicker";
import PodmanMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMetricPicker";
import ProxmoxMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMetricPicker";
import XcpNgMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/XcpNgMonitor/XcpNgMetricPicker";
import StorageArrayMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMetricPicker";
import VMwareMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMetricPicker";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import { buildMonitorMetricQueryConfig } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorMetricQueryConfig";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { getAllCephMetrics } from "../../../Types/Monitor/CephMetricCatalog";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import DatabaseMonitorResponse from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getDatabaseMetricCategoryDescription,
  getDatabaseMetricCategoryOrder,
  getDatabaseMetricsForEngine,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import { getAllDockerMetrics } from "../../../Types/Monitor/DockerMetricCatalog";
import { getAllDockerSwarmMetrics } from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import { getAllHostMetrics } from "../../../Types/Monitor/HostMetricCatalog";
import { getAllIoTMetrics } from "../../../Types/Monitor/IotMetricCatalog";
import { getAllKubernetesMetrics } from "../../../Types/Monitor/KubernetesMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { getAllOpenStackMetrics } from "../../../Types/Monitor/OpenStackMetricCatalog";
import { getAllPodmanMetrics } from "../../../Types/Monitor/PodmanMetricCatalog";
import { getAllProxmoxMetrics } from "../../../Types/Monitor/ProxmoxMetricCatalog";
import { getAllXcpNgMetrics } from "../../../Types/Monitor/XcpNgMetricCatalog";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import { getAllStorageArrayMetrics } from "../../../Types/Monitor/StorageArrayMetricCatalog";
import { getAllVMwareMetrics } from "../../../Types/Monitor/VMwareMetricCatalog";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * WHAT A MONITOR'S METRIC IS, IN THE READER'S LANGUAGE (#8014).
 *
 * Every metric picker of a monitor's form says under its dropdown what the
 * chosen metric is, from its catalog, and a Database Health criteria says
 * it under its metric; a Database monitor's charts and the words under its
 * summary's groups say it too, and so does a metric a monitor stored, in the
 * metrics list. Each read the catalog's English in every language. Each
 * looks the description up now, once, where it draws it.
 *
 * Drawn here as the Dashboard sets its words up (its post-processors, which
 * set code apart in Arabic and Persian), in English, German, Arabic and
 * Persian from the Dashboard's own locale files: each line says the
 * locale's wording of its description - and so the English, until the
 * language words it (MonitorMetricDescriptionsInLocales holds which do).
 * Each is drawn again with a wording that is itself a key whose own wording
 * says TWICE: a line that looked its description up again would say it.
 */

const LINE_TEMPLATE: string = "{{description}} — Metric: {{metric}}";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

// A wording that is itself a key, and what it reads as when looked up again.
const TWICE: string = "TWICE";

// Each language's mark on a wording no locale has: a line then says the probe.
const PROBE_MARKS: Readonly<Record<string, string>> = {
  en: "EN› ",
  de: "DE› ",
  ar: "ع› ",
  fa: "ف› ",
};

interface CatalogMetric {
  id: string;
  description: string;
  metricName: string;
}

interface PickerCase {
  name: string;
  metrics: Array<CatalogMetric>;
  draw: (metricId: string) => ReactElement;
}

const doNothing: () => void = (): void => {};

const PICKERS: Array<PickerCase> = [
  {
    name: "Ceph",
    metrics: getAllCephMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <CephMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "Docker",
    metrics: getAllDockerMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <DockerMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Docker Swarm",
    metrics: getAllDockerSwarmMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <DockerSwarmMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Host",
    metrics: getAllHostMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <HostMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "IoT",
    metrics: getAllIoTMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <IoTMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "Kubernetes",
    metrics: getAllKubernetesMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <KubernetesMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "OpenStack",
    metrics: getAllOpenStackMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <OpenStackMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Podman",
    metrics: getAllPodmanMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <PodmanMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Proxmox",
    metrics: getAllProxmoxMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <ProxmoxMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "XCP-ng",
    metrics: getAllXcpNgMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <XcpNgMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "storage array",
    metrics: getAllStorageArrayMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <StorageArrayMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "VMware",
    metrics: getAllVMwareMetrics(),
    draw: (id: string): ReactElement => {
      return (
        <VMwareMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
];

/*
 * Three of each catalog's metrics: its first, the one it says most about,
 * and one whose description gives code, where it has one.
 */
const sampleOf: (metrics: Array<CatalogMetric>) => Array<CatalogMetric> = (
  metrics: Array<CatalogMetric>,
): Array<CatalogMetric> => {
  const longest: CatalogMetric = [...metrics].sort(
    (a: CatalogMetric, b: CatalogMetric): number => {
      return b.description.length - a.description.length;
    },
  )[0] as CatalogMetric;
  const withCode: CatalogMetric | undefined = metrics.find(
    (metric: CatalogMetric): boolean => {
      return metric.description.includes("`");
    },
  );

  return Array.from(
    new Set<CatalogMetric>(
      [metrics[0] as CatalogMetric, longest, withCode].filter(
        (metric: CatalogMetric | undefined): metric is CatalogMetric => {
          return Boolean(metric);
        },
      ),
    ),
  );
};

const DATABASE_METRICS: Array<DatabaseMetricDefinition> =
  getDatabaseMetricsForEngine(SqlDatabaseType.PostgreSQL);

const DATABASE_SAMPLE: Array<DatabaseMetricDefinition> = [
  DATABASE_METRICS[0] as DatabaseMetricDefinition,
  DATABASE_METRICS[
    Math.floor(DATABASE_METRICS.length / 2)
  ] as DatabaseMetricDefinition,
  DATABASE_METRICS[DATABASE_METRICS.length - 1] as DatabaseMetricDefinition,
];

const withoutBackticks: (text: string) => string = (text: string): string => {
  return text.split("`").join("");
};

const codeOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/`([^`]+)`/g), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
};

/*
 * Every text a sampled line draws: the probes give each a wording of its own.
 * What the server stores as a host, SNMP, NTP and SLO series' description (#8356).
 */
const STORED_SAMPLE: Array<string> = [
  "Total running processes on the server",
  "1-minute load average",
  "SNMP interface operational status (1 up, 0 down)",
  "CPU Usage (in %) of Server/VM",
  "NTP Is Synchronized status of this time server",
  "How fast the error budget is being spent, measured over the trailing 60 minutes. 1x spends the budget exactly over the compliance window; anything higher exhausts it early.",
];

const SAMPLED_TEXTS: Array<string> = Array.from(
  new Set<string>([
    ...STORED_SAMPLE,
    ...PICKERS.flatMap((picker: PickerCase): Array<string> => {
      return sampleOf(picker.metrics).map((metric: CatalogMetric): string => {
        return metric.description;
      });
    }),
    ...DATABASE_SAMPLE.map((metric: DatabaseMetricDefinition): string => {
      return metric.description;
    }),
    ...getDatabaseMetricCategoryOrder().map(
      (category: DatabaseMetricCategory): string => {
        return getDatabaseMetricCategoryDescription(category);
      },
    ),
  ]),
);

const probeOf: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  return `${PROBE_MARKS[language]}${text}`;
};

// The Dashboard's words for each language, read from its locale files.
const realWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return readDashboardLocale(language);
};

/*
 * The same words with each sampled text worded as its probe, and each probe
 * a key of its own that reads TWICE.
 */
const probedWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const words: Record<string, string> = { ...realWords(language) };

  for (const text of SAMPLED_TEXTS) {
    words[text] = probeOf(language, text);
    words[probeOf(language, text)] = TWICE;
  }

  return words;
};

const resourcesOf: (
  wordsOf: (language: string) => Record<string, string>,
) => Record<string, { translation: Record<string, string> }> = (
  wordsOf: (language: string) => Record<string, string>,
): Record<string, { translation: Record<string, string> }> => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: wordsOf(language) };
  }

  return resources;
};

// As the Dashboard sets i18next up (Utils/i18n.ts), with its words.
const dashboardI18n: i18n = createInstance();
// The same, with the sampled texts worded as probes.
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("ar");

  for (const [instance, wordsOf] of [
    [dashboardI18n, realWords],
    [probedI18n, probedWords],
  ] as Array<[i18n, (language: string) => Record<string, string>]>) {
    await instance
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: "en",
        fallbackLng: "en",
        postProcess: getTranslationPostProcess(),
        resources: resourcesOf(wordsOf),
        interpolation: { escapeValue: false },
      });
  }
});

afterEach(() => {
  cleanup();
});

const drawIn: (
  instance: i18n,
  language: string,
  element: ReactElement,
) => HTMLElement = (
  instance: i18n,
  language: string,
  element: ReactElement,
): HTMLElement => {
  void instance.changeLanguage(language);

  return render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>)
    .container;
};

// The line under a picker: the paragraph that names the metric as code.
const lineOf: (container: HTMLElement, metricName: string) => HTMLElement = (
  container: HTMLElement,
  metricName: string,
): HTMLElement => {
  const name: HTMLElement | undefined = Array.from(
    container.querySelectorAll("code"),
  ).find((code: HTMLElement): boolean => {
    return withoutIsolates(code.textContent || "") === metricName;
  });

  expect(name).toBeDefined();

  return (name as HTMLElement).closest("p") as HTMLElement;
};

/*
 * What a line shows, without the isolates' marks, and with plain spaces
 * where a worded text is drawn with no-break ones (between a number and
 * its unit, and around French punctuation: Types/NoBreakSpaces), as the
 * locale file writes it.
 */
const shownIn: (element: Element) => string = (element: Element): string => {
  return withoutIsolates(element.textContent || "")
    .split(NO_BREAK_SPACE)
    .join(" ")
    .split(NARROW_NO_BREAK_SPACE)
    .join(" ");
};

// What a language's line says, filled as the line fills it.
const expectedLine: (
  words: Record<string, string>,
  description: string,
  metricName: string,
) => string = (
  words: Record<string, string>,
  description: string,
  metricName: string,
): string => {
  return (words[LINE_TEMPLATE] || LINE_TEMPLATE)
    .replace(
      "{{description}}",
      withoutBackticks(words[description] || description),
    )
    .replace("{{metric}}", metricName);
};

describe.each(PICKERS)("the $name metric picker", (picker: PickerCase) => {
  const sample: Array<CatalogMetric> = sampleOf(picker.metrics);

  describe.each(LANGUAGES)("in %s", (language: string) => {
    test.each(
      sample.map((metric: CatalogMetric): [string, CatalogMetric] => {
        return [metric.id, metric];
      }),
    )(
      "says what %s is in the locale's words, its code drawn as code",
      (_id: string, metric: CatalogMetric) => {
        const words: Record<string, string> = realWords(language);
        const line: HTMLElement = lineOf(
          drawIn(dashboardI18n, language, picker.draw(metric.id)),
          metric.metricName,
        );

        expect(
          shownIn(line).startsWith(
            expectedLine(words, metric.description, metric.metricName),
          ),
        ).toBe(true);
        expect(line.textContent).not.toContain("`");

        // Each piece of code is a <code> of its own, read from the left.
        const drawnCode: Array<string> = Array.from(
          line.querySelectorAll("code"),
        ).map((code: Element): string => {
          return shownIn(code);
        });

        for (const code of codeOf(
          words[metric.description] || metric.description,
        )) {
          expect(drawnCode).toContain(code);
        }
      },
    );

    test.each(
      sample.map((metric: CatalogMetric): [string, CatalogMetric] => {
        return [metric.id, metric];
      }),
    )(
      "looks %s's description up once",
      (_id: string, metric: CatalogMetric) => {
        const line: HTMLElement = lineOf(
          drawIn(probedI18n, language, picker.draw(metric.id)),
          metric.metricName,
        );

        expect(shownIn(line)).toContain(
          withoutBackticks(probeOf(language, metric.description)),
        );
        expect(shownIn(line)).not.toContain(TWICE);
      },
    );
  });
});

describe("a Database Health criteria's metric line", () => {
  const drawCriteria: (metric: DatabaseMetricDefinition) => ReactElement = (
    metric: DatabaseMetricDefinition,
  ): ReactElement => {
    const step: MonitorStep = new MonitorStep();

    step.data = {
      ...(step.data || {}),
      databaseMonitor: {
        databaseType: SqlDatabaseType.PostgreSQL,
      },
    } as MonitorStep["data"];

    return (
      <CriteriaFilterElement
        monitorType={MonitorType.Database}
        monitorStep={step}
        value={{
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: 1,
          databaseMonitorOptions: { metricType: metric.metricType },
        }}
        onChange={doNothing}
      />
    );
  };

  const lineIn: (container: HTMLElement) => HTMLElement = (
    container: HTMLElement,
  ): HTMLElement => {
    const line: HTMLElement | null = container.querySelector(
      '[data-testid="database-metric-description"]',
    );

    expect(line).not.toBeNull();

    return line as HTMLElement;
  };

  describe.each(LANGUAGES)("in %s", (language: string) => {
    test.each(
      DATABASE_SAMPLE.map(
        (
          metric: DatabaseMetricDefinition,
        ): [string, DatabaseMetricDefinition] => {
          return [metric.id, metric];
        },
      ),
    )(
      "says what %s is in the locale's words",
      (_id: string, metric: DatabaseMetricDefinition) => {
        const words: Record<string, string> = realWords(language);
        const line: HTMLElement = lineIn(
          drawIn(dashboardI18n, language, drawCriteria(metric)),
        );

        expect(shownIn(line)).toBe(
          words[metric.description] || metric.description,
        );
      },
    );

    test.each(
      DATABASE_SAMPLE.map(
        (
          metric: DatabaseMetricDefinition,
        ): [string, DatabaseMetricDefinition] => {
          return [metric.id, metric];
        },
      ),
    )(
      "looks %s's description up once",
      (_id: string, metric: DatabaseMetricDefinition) => {
        const line: HTMLElement = lineIn(
          drawIn(probedI18n, language, drawCriteria(metric)),
        );

        expect(shownIn(line)).toBe(probeOf(language, metric.description));
      },
    );
  });
});

describe("a Database monitor's summary, under each group of metrics", () => {
  const RESPONSE: ProbeMonitorResponse = {
    isOnline: true,
    probeId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date(),
    databaseMonitorResponse: {
      isOnline: true,
      responseTimeInMs: 12,
      failureCause: "",
      metrics: {},
      collectedGroups: Object.values(DatabaseMetricGroup),
      unavailableGroups: [],
      connectionError: null,
    } as DatabaseMonitorResponse,
  } as unknown as ProbeMonitorResponse;

  test.each(LANGUAGES)(
    "%s says what each group holds, looked up once",
    (language: string) => {
      const descriptions: Array<string> = getDatabaseMetricCategoryOrder().map(
        (category: DatabaseMetricCategory): string => {
          return getDatabaseMetricCategoryDescription(category);
        },
      );
      const words: Record<string, string> = realWords(language);
      const shown: string = shownIn(
        drawIn(
          dashboardI18n,
          language,
          <DatabaseMonitorView probeMonitorResponse={RESPONSE} />,
        ),
      );

      for (const description of descriptions) {
        expect(shown).toContain(words[description] || description);
      }

      cleanup();

      const probed: string = shownIn(
        drawIn(
          probedI18n,
          language,
          <DatabaseMonitorView probeMonitorResponse={RESPONSE} />,
        ),
      );

      for (const description of descriptions) {
        expect(probed).toContain(probeOf(language, description));
      }

      expect(probed).not.toContain(TWICE);
    },
  );
});

describe("a Database monitor's chart, on its Metrics tab", () => {
  const metric: DatabaseMetricDefinition =
    DATABASE_SAMPLE[1] as DatabaseMetricDefinition;

  const descriptionWith: (translator?: Translator) => string = (
    translator?: Translator,
  ): string => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      monitorType: MonitorType.Database,
      metric: metric.metricType,
      probes: [],
      translator: translator,
    });

    return config.metricAliasData?.description || "";
  };

  const translatorOf: (
    words: Record<string, string>,
    language: string,
  ) => Translator = (
    words: Record<string, string>,
    language: string,
  ): Translator => {
    return createTranslator((text: string): string | undefined => {
      return words[text];
    }, language);
  };

  test("says the catalog's English with no translator, as the server gets it", () => {
    expect(descriptionWith()).toBe(metric.description);
  });

  test.each(LANGUAGES)(
    "says the description in the reader's words in %s, looked up once",
    (language: string) => {
      const words: Record<string, string> = realWords(language);

      expect(descriptionWith(translatorOf(words, language))).toBe(
        words[metric.description] || metric.description,
      );
      expect(
        descriptionWith(translatorOf(probedWords(language), language)),
      ).toBe(probeOf(language, metric.description));
    },
  );

  test("a probe's own series reads its English description whatever the reader's language", () => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      monitorType: MonitorType.Database,
      metric: DATABASE_SAMPLE[0]!.metricType,
      probes: [],
      translator: translatorOf({}, "de"),
    });

    expect(config.metricAliasData?.description).toBe(
      DATABASE_SAMPLE[0]!.description,
    );
  });
});

describe("a metric a monitor stored, in the metrics list", () => {
  const metric: DatabaseMetricDefinition =
    DATABASE_SAMPLE[2] as DatabaseMetricDefinition;

  const rowIn: (
    instance: i18n,
    language: string,
    description: string,
  ) => string = (
    instance: i18n,
    language: string,
    description: string,
  ): string => {
    const container: HTMLElement = drawIn(
      instance,
      language,
      <MetricRow
        metric={
          {
            name: metric.metricType,
            unit: metric.unit,
            description: description,
          } as MetricType
        }
        sparklinePoints={[]}
        lastValue={3}
      />,
    );
    const shown: Element | null = container.querySelector("p bdi");

    expect(shown).not.toBeNull();

    return shownIn(shown as Element);
  };

  test.each(LANGUAGES)(
    "%s says the catalog's description in the reader's words, looked up once",
    (language: string) => {
      const words: Record<string, string> = realWords(language);

      expect(rowIn(dashboardI18n, language, metric.description)).toBe(
        words[metric.description] || metric.description,
      );

      cleanup();

      expect(rowIn(probedI18n, language, metric.description)).toBe(
        probeOf(language, metric.description),
      );
    },
  );

  /*
   * What the server stores as a host, SNMP, NTP, probe or SLO series'
   * description (#8356): written out whole and a key, so the row words it
   * once in the reader's language.
   */
  test.each(LANGUAGES)(
    "%s says what the server stored for a host, SNMP, NTP and SLO series in the reader's words",
    (language: string) => {
      const words: Record<string, string> = realWords(language);

      for (const stored of STORED_SAMPLE) {
        const shown: string = rowIn(dashboardI18n, language, stored);

        expect({ stored, shown }).toEqual({
          stored,
          shown: words[stored] || stored,
        });

        if (language !== "en") {
          expect({ stored, worded: shown !== stored }).toEqual({
            stored,
            worded: true,
          });
        }

        cleanup();

        expect(rowIn(probedI18n, language, stored)).toBe(
          probeOf(language, stored),
        );

        cleanup();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s draws a provider's own description as the provider wrote it",
    (language: string) => {
      const provided: string = "Count of active messages in a Queue/Topic.";

      expect(rowIn(dashboardI18n, language, provided)).toBe(provided);
    },
  );
});
