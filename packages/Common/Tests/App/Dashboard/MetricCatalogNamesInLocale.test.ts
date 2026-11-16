import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  CephMetricCategory,
  getAllCephMetricCategories,
  getAllCephMetrics,
  getCephMetricCategoryLabel,
} from "../../../Types/Monitor/CephMetricCatalog";
import {
  DatabaseMetricCategory,
  getAllDatabaseMetrics,
  getDatabaseMetricCategoryLabel,
  getDatabaseMetricCategoryOrder,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import {
  DockerMetricCategory,
  getAllDockerMetricCategories,
  getAllDockerMetrics,
  getDockerMetricCategoryLabel,
} from "../../../Types/Monitor/DockerMetricCatalog";
import {
  DockerSwarmMetricCategory,
  getAllDockerSwarmMetricCategories,
  getAllDockerSwarmMetrics,
  getDockerSwarmMetricCategoryLabel,
} from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import {
  getAllHostMetricCategories,
  getAllHostMetrics,
  getHostMetricCategoryLabel,
  HostMetricCategory,
} from "../../../Types/Monitor/HostMetricCatalog";
import {
  getAllIoTMetricCategories,
  getAllIoTMetrics,
  getIoTMetricCategoryLabel,
  IoTMetricCategory,
} from "../../../Types/Monitor/IotMetricCatalog";
import {
  getAllKubernetesMetricCategories,
  getAllKubernetesMetrics,
  getKubernetesMetricCategoryLabel,
  KubernetesMetricCategory,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  getAllPodmanMetricCategories,
  getAllPodmanMetrics,
  getPodmanMetricCategoryLabel,
  PodmanMetricCategory,
} from "../../../Types/Monitor/PodmanMetricCatalog";
import {
  getOpenStackMetricCategoryLabel,
  getAllOpenStackMetricCategories,
  OpenStackMetricCategory,
} from "../../../Types/Monitor/OpenStackMetricCatalog";
import {
  getAllProxmoxMetricCategories,
  getAllProxmoxMetrics,
  getProxmoxMetricCategoryLabel,
  ProxmoxMetricCategory,
} from "../../../Types/Monitor/ProxmoxMetricCatalog";
import {
  getAllVMwareMetricCategories,
  getAllVMwareMetrics,
  getVMwareMetricCategoryLabel,
  VMwareMetricCategory,
} from "../../../Types/Monitor/VMwareMetricCatalog";
import {
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
  getStorageArrayMetricCategoryLabel,
  StorageArrayMetricCategory,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  getMessageQueueBrokerMetricChartTitle,
  getMessageQueueBrokerMetricTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import { getDatabaseEngineMetricChartTitle } from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection";
import { getDatabaseMetricListCaption } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE CURATED METRICS' NAMES IN THE READER'S LANGUAGE.
 *
 * A database's engine charts and tiles, a queue's Broker health charts and
 * tiles, and the storage array, Proxmox and Ceph metric pickers drew their
 * catalogs' names in English in every language: the catalogs live in
 * Common/Types, which the Dashboard's extractor did not read. Each name is
 * a translationKey now, each catalog file a "keys" root, and every
 * language words them, with the unit words a chart title adds ("Buffer
 * pool size (pages)") and the words in brackets that tell two copies of a
 * metric apart ("JSON stream", "legacy names"). The Proxmox and Ceph
 * Insights pages' charts, keys already, are worded too. So are a Database
 * Health monitor's metric names, which its criteria's metric dropdown, its
 * summary and its charts drew in English, and the headings of its
 * summary's groups, the category's English value (#8354). And so are the
 * VMware, Kubernetes, Docker, Docker Swarm, Podman, host and IoT pickers'
 * names and the headings of their groups, which the dropdown drew as each
 * catalog's category identifier (#8353).
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

const CATALOG_FILES: ReadonlyArray<string> = [
  "packages/Common/Types/DatabaseServer/DatabaseServerMetricCatalog.ts",
  "packages/Common/Types/MessageQueue/MessageQueueMetricCatalog.ts",
  "packages/Common/Types/Monitor/StorageArrayMetricCatalog.ts",
  "packages/Common/Types/Monitor/ProxmoxMetricCatalog.ts",
  "packages/Common/Types/Monitor/CephMetricCatalog.ts",
  "packages/Common/Types/Monitor/DatabaseMetricCatalog.ts",
  "packages/Common/Types/Monitor/VMwareMetricCatalog.ts",
  "packages/Common/Types/Monitor/KubernetesMetricCatalog.ts",
  "packages/Common/Types/Monitor/DockerMetricCatalog.ts",
  "packages/Common/Types/Monitor/DockerSwarmMetricCatalog.ts",
  "packages/Common/Types/Monitor/PodmanMetricCatalog.ts",
  "packages/Common/Types/Monitor/HostMetricCatalog.ts",
  "packages/Common/Types/Monitor/IotMetricCatalog.ts",
];

// The Insights pages whose chart titles, lines and lines under them are keys.
const INSIGHTS_PAGES: ReadonlyArray<string> = [
  "src/Pages/Ceph/View/Insights.tsx",
  "src/Pages/Proxmox/View/Insights.tsx",
  "src/Pages/StorageArray/View/Insights.tsx",
];

const QUALIFIED_TITLE: RegExp = /^(.*\S)\s*\(([^()]+)\)$/;
const KIND_KEYS_AFTER_DIRECTORY: RegExp = /^"[^"]+",\s*kind: "keys"/;
// A unit said as a word ("connections"), not a symbol ("ms", "%").
const WORD_UNIT: RegExp = /^[a-z]{3,}$/;
const INSIGHTS_WORDS: RegExp =
  /\b(?:title|legend|description):\s*\n?\s*"([^"]+)"/g;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const ENGLISH: Record<string, unknown> = readJson(
  path.join(DASHBOARD, "src/Locales/en.json"),
) as Record<string, unknown>;
const SAME_EVERYWHERE: Set<string> = new Set<string>(
  readJson(path.join(DASHBOARD, "i18n/SameAsEnglish.json")) as Array<string>,
);

function locale(language: string): Record<string, unknown> {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Record<string, unknown>;
}

function keptAsWritten(language: string): Set<string> {
  return new Set<string>(
    (
      readJson(path.join(DASHBOARD, `i18n/Progress/${language}.json`)) as {
        sameAsEnglish?: Array<string>;
      }
    ).sameAsEnglish || [],
  );
}

function translatorFor(language: string): Translator {
  const words: Record<string, unknown> = locale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

// A catalog title, or the two keys a composed one is made of.
function titleKeys(title: string): Array<string> {
  if (ENGLISH[title] === title) {
    return [title];
  }

  const qualified: RegExpMatchArray | null = title.match(QUALIFIED_TITLE);

  return qualified ? [qualified[1] as string, qualified[2] as string] : [title];
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values));
}

const DATABASE_TITLES: Array<string> = unique(
  DATABASE_SERVER_METRICS.map(
    (definition: DatabaseServerMetricDefinition): string => {
      return definition.title;
    },
  ),
);

const QUEUE_TITLE_KEYS: Array<string> = unique(
  MESSAGE_QUEUE_METRICS.flatMap(
    (descriptor: MessageQueueMetricDescriptor): Array<string> => {
      return titleKeys(descriptor.title);
    },
  ),
);

// The unit words a gauge's chart title adds in brackets ("connections", "messages").
const UNIT_WORDS: Array<string> = unique(
  [
    ...DATABASE_SERVER_METRICS.map(
      (definition: DatabaseServerMetricDefinition): string => {
        return definition.unit;
      },
    ),
    ...MESSAGE_QUEUE_METRICS.map(
      (descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.unit;
      },
    ),
  ].filter((unit: string): boolean => {
    return WORD_UNIT.test(unit) && !["bytes", "fraction"].includes(unit);
  }),
);

const PICKER_NAMES: Array<string> = unique(
  [
    ...getAllStorageArrayMetrics(),
    ...getAllProxmoxMetrics(),
    ...getAllCephMetrics(),
    ...getAllDatabaseMetrics(),
    ...getAllVMwareMetrics(),
    ...getAllKubernetesMetrics(),
    ...getAllDockerMetrics(),
    ...getAllDockerSwarmMetrics(),
    ...getAllPodmanMetrics(),
    ...getAllHostMetrics(),
    ...getAllIoTMetrics(),
  ].map((metric: { friendlyName: string }): string => {
    return metric.friendlyName;
  }),
);

// The headings the eleven pickers draw over their groups (#8353, #8653).
const PICKER_GROUP_HEADINGS: Array<string> = unique([
  ...getAllVMwareMetricCategories().map(
    (category: VMwareMetricCategory): string => {
      return getVMwareMetricCategoryLabel(category);
    },
  ),
  ...getAllKubernetesMetricCategories().map(
    (category: KubernetesMetricCategory): string => {
      return getKubernetesMetricCategoryLabel(category);
    },
  ),
  ...getAllDockerMetricCategories().map(
    (category: DockerMetricCategory): string => {
      return getDockerMetricCategoryLabel(category);
    },
  ),
  ...getAllDockerSwarmMetricCategories().map(
    (category: DockerSwarmMetricCategory): string => {
      return getDockerSwarmMetricCategoryLabel(category);
    },
  ),
  ...getAllPodmanMetricCategories().map(
    (category: PodmanMetricCategory): string => {
      return getPodmanMetricCategoryLabel(category);
    },
  ),
  ...getAllHostMetricCategories().map(
    (category: HostMetricCategory): string => {
      return getHostMetricCategoryLabel(category);
    },
  ),
  ...getAllIoTMetricCategories().map((category: IoTMetricCategory): string => {
    return getIoTMetricCategoryLabel(category);
  }),
  ...getAllStorageArrayMetricCategories().map(
    (category: StorageArrayMetricCategory): string => {
      return getStorageArrayMetricCategoryLabel(category);
    },
  ),
  ...getAllProxmoxMetricCategories().map(
    (category: ProxmoxMetricCategory): string => {
      return getProxmoxMetricCategoryLabel(category);
    },
  ),
  ...getAllCephMetricCategories().map(
    (category: CephMetricCategory): string => {
      return getCephMetricCategoryLabel(category);
    },
  ),
  ...getAllOpenStackMetricCategories().map(
    (category: OpenStackMetricCategory): string => {
      return getOpenStackMetricCategoryLabel(category);
    },
  ),
]);

// The headings of a Database monitor's summary groups and Metrics tab cards.
const DATABASE_GROUP_HEADINGS: Array<string> = unique(
  getDatabaseMetricCategoryOrder().map(
    (category: DatabaseMetricCategory): string => {
      return getDatabaseMetricCategoryLabel(category);
    },
  ),
);

function insightsWords(): Array<string> {
  const words: Array<string> = [];

  for (const page of INSIGHTS_PAGES) {
    const text: string = fs.readFileSync(path.join(DASHBOARD, page), "utf8");

    for (const match of text.matchAll(INSIGHTS_WORDS)) {
      words.push(match[1] as string);
    }
  }

  return unique(words);
}

const ALL_KEYS: Array<string> = unique([
  ...DATABASE_TITLES,
  ...QUEUE_TITLE_KEYS,
  ...UNIT_WORDS,
  ...PICKER_NAMES,
  ...DATABASE_GROUP_HEADINGS,
  ...PICKER_GROUP_HEADINGS,
  ...insightsWords(),
]);

describe("the metric catalogs' names are keys", () => {
  test("each catalog file is a keys root of the extractor", () => {
    const extractor: string = fs.readFileSync(
      path.join(DASHBOARD, "scripts/i18n/ExtractStrings.ts"),
      "utf8",
    );

    for (const file of CATALOG_FILES) {
      const at: number = extractor.indexOf(`"${file}"`);

      expect({ file, listed: at >= 0 }).toEqual({ file, listed: true });
      // Its entry reads only the names the file marks.
      expect(extractor.slice(at, at + file.length + 40)).toMatch(
        KIND_KEYS_AFTER_DIRECTORY,
      );
    }
  });

  test("every name, unit word and qualifier is a key of the English locale", () => {
    const missing: Array<string> = ALL_KEYS.filter((key: string): boolean => {
      return ENGLISH[key] !== key;
    });

    expect(missing).toEqual([]);
    // The names are many: a regression that empties a list would pass otherwise.
    expect(DATABASE_TITLES.length).toBeGreaterThan(50);
    expect(QUEUE_TITLE_KEYS.length).toBeGreaterThan(40);
    expect(PICKER_NAMES.length).toBeGreaterThan(250);
    expect(PICKER_NAMES).toEqual(
      expect.arrayContaining([
        "Datacenter Cluster Count",
        "Pod Network I/O (Cumulative, Both Directions)",
        "Load Average (1m)",
        "Device Up",
      ]),
    );
    /*
     * A heading is a key that says the group, never the category's
     * identifier: Control Plane, Block I/O; and the host's Load is its
     * load averages, never the verb "Load" the key would read as.
     */
    expect(PICKER_GROUP_HEADINGS).toEqual(
      expect.arrayContaining(["Control Plane", "Block I/O", "Load Average"]),
    );
    expect(PICKER_GROUP_HEADINGS).not.toEqual(
      expect.arrayContaining(["ControlPlane"]),
    );
    expect(PICKER_GROUP_HEADINGS).not.toEqual(
      expect.arrayContaining(["BlockIO"]),
    );
    expect(PICKER_GROUP_HEADINGS).not.toEqual(expect.arrayContaining(["Load"]));
    // The storage array, Proxmox, Ceph and OpenStack pickers' too (#8653).
    expect(PICKER_GROUP_HEADINGS).toEqual(
      expect.arrayContaining([
        "Array Health",
        "Guest",
        "PG",
        "OVN and Open vSwitch",
        "Key Manager",
      ]),
    );
    expect(PICKER_NAMES).toEqual(
      expect.arrayContaining(["Replication Lag (Bytes)", "TempDB Free Space"]),
    );
    /*
     * Each group's heading is a key that says the group's English name, as
     * the docs' headings do; "Cache and I/O" was no key at all.
     */
    expect(DATABASE_GROUP_HEADINGS).toEqual(
      getDatabaseMetricCategoryOrder().map(
        (category: DatabaseMetricCategory): string => {
          return category;
        },
      ),
    );
    expect(QUEUE_TITLE_KEYS).toEqual(
      expect.arrayContaining(["JSON stream", "legacy names"]),
    );
    expect(UNIT_WORDS).toEqual(
      expect.arrayContaining(["connections", "pages", "messages"]),
    );
  });

  test.each(LANGUAGES)(
    "%s words every name, unit word, qualifier and Insights chart, or keeps one as written on purpose",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const kept: Set<string> = keptAsWritten(language);
      const english: Array<string> = ALL_KEYS.filter((key: string): boolean => {
        return (
          words[key] === ENGLISH[key] &&
          !SAME_EVERYWHERE.has(key) &&
          !kept.has(key)
        );
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );
});

function queueDescriptor(
  system: string,
  metricName: string,
): MessageQueueMetricDescriptor {
  const found: MessageQueueMetricDescriptor | undefined =
    MESSAGE_QUEUE_METRICS.find(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return (
          descriptor.system === system && descriptor.metricName === metricName
        );
      },
    );

  expect(found).toBeDefined();

  return found as MessageQueueMetricDescriptor;
}

function databaseDefinition(title: string): DatabaseServerMetricDefinition {
  const found: DatabaseServerMetricDefinition | undefined =
    DATABASE_SERVER_METRICS.find(
      (definition: DatabaseServerMetricDefinition): boolean => {
        return definition.title === title;
      },
    );

  expect(found).toBeDefined();

  return found as DatabaseServerMetricDefinition;
}

describe("a queue's Broker health draws its titles in the reader's language", () => {
  const german: Translator = translatorFor("de");
  const english: Translator = translatorFor("en");

  test("English reads as the catalog writes it", () => {
    expect(
      getMessageQueueBrokerMetricChartTitle(
        queueDescriptor("activemq", "activemq.message.current"),
        english,
      ),
    ).toBe("Queue size (legacy names, messages)");
    expect(
      getMessageQueueBrokerMetricTitle(
        queueDescriptor("aws_sqs", "approximatenumberofmessagesvisible"),
        english,
      ),
    ).toBe("Messages visible (JSON stream)");
  });

  test("a title, its unit word and its qualifier are each said in German", () => {
    const words: Record<string, unknown> = locale("de");
    const legacy: MessageQueueMetricDescriptor = queueDescriptor(
      "activemq",
      "activemq.message.current",
    );

    expect(getMessageQueueBrokerMetricChartTitle(legacy, german)).toBe(
      `${words["Queue size"]} (${words["legacy names"]}, ${words["messages"]})`,
    );
    expect(
      getMessageQueueBrokerMetricTitle(
        queueDescriptor("aws_sqs", "approximatenumberofmessagesvisible"),
        german,
      ),
    ).toBe(`${words["Messages visible"]} (${words["JSON stream"]})`);
    // A tile's title is the catalog's key in German.
    expect(
      getMessageQueueBrokerMetricTitle(
        queueDescriptor("kafka", "kafka.consumer_group.lag_sum"),
        german,
      ),
    ).toBe(words["Consumer lag"]);
  });

  test("a counter's chart says per second in the reader's words", () => {
    const counter: MessageQueueMetricDescriptor | undefined =
      MESSAGE_QUEUE_METRICS.find(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return (
            descriptor.kind === "counter" &&
            !QUALIFIED_TITLE.test(descriptor.title)
          );
        },
      );

    expect(counter).toBeDefined();
    expect(
      getMessageQueueBrokerMetricChartTitle(
        counter as MessageQueueMetricDescriptor,
        german,
      ),
    ).toBe(
      `${locale("de")[(counter as MessageQueueMetricDescriptor).title]} (pro Sekunde)`,
    );
  });
});

describe("a database's engine charts draw their titles in the reader's language", () => {
  test("a gauge's unit word is said with its title", () => {
    const bufferPool: DatabaseServerMetricDefinition =
      databaseDefinition("Buffer pool size");

    expect(getDatabaseEngineMetricChartTitle(bufferPool)).toBe(
      "Buffer pool size (pages)",
    );
    expect(
      getDatabaseEngineMetricChartTitle(bufferPool, translatorFor("de")),
    ).toBe("Buffer-Pool-Größe (Seiten)");
    expect(
      getDatabaseEngineMetricChartTitle(bufferPool, translatorFor("ja")),
    ).toBe(`${locale("ja")["Buffer pool size"]} (${locale("ja")["pages"]})`);
  });

  test("a Metrics row's caption names its breakdown in English as before", () => {
    const pinned: DatabaseServerMetricDefinition | undefined =
      DATABASE_SERVER_METRICS.find(
        (definition: DatabaseServerMetricDefinition): boolean => {
          return (
            Object.keys(definition.attributes || {}).length > 0 &&
            definition.kind === "gauge" &&
            definition.seriesCombine === "sum"
          );
        },
      );

    expect(pinned).toBeDefined();
    expect(
      getDatabaseMetricListCaption(pinned as DatabaseServerMetricDefinition),
    ).toBe(
      `${(pinned as DatabaseServerMetricDefinition).title}, total of series`,
    );
  });
});
