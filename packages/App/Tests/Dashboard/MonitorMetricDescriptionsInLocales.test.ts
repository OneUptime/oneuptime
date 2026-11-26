// UX rule: Docs/ux/README.md#in-every-language
import {
  ExtractedString,
  scanSourceText,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import {
  asWrittenTokensMissing,
  DIGITS_ARABIC_DOES_NOT_WRITE,
  fullStopsOf,
  hasNoLetters,
  numbersMissing,
  placeholdersOf,
  sharedEnding,
} from "./DescriptionWordsKept";
import { getAllCephMetrics } from "Common/Types/Monitor/CephMetricCatalog";
import {
  DatabaseMetricCategory,
  getAllDatabaseMetrics,
  getDatabaseMetricCategoryDescription,
  getDatabaseMetricCategoryOrder,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import { getAllDockerMetrics } from "Common/Types/Monitor/DockerMetricCatalog";
import { getAllDockerSwarmMetrics } from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import { getAllHostMetrics } from "Common/Types/Monitor/HostMetricCatalog";
import { getAllIoTMetrics } from "Common/Types/Monitor/IotMetricCatalog";
import { getAllKubernetesMetrics } from "Common/Types/Monitor/KubernetesMetricCatalog";
import { getAllOpenStackMetrics } from "Common/Types/Monitor/OpenStackMetricCatalog";
import { getAllPodmanMetrics } from "Common/Types/Monitor/PodmanMetricCatalog";
import { getAllProxmoxMetrics } from "Common/Types/Monitor/ProxmoxMetricCatalog";
import { getAllStorageArrayMetrics } from "Common/Types/Monitor/StorageArrayMetricCatalog";
import { getAllVMwareMetrics } from "Common/Types/Monitor/VMwareMetricCatalog";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT EACH MONITOR METRIC IS, IN THE READER'S LANGUAGE (#8014).
 *
 * The line under every metric picker of a monitor's form says what the
 * chosen metric is, from its catalog (Common/Types/Monitor/*MetricCatalog):
 * the VMware, OpenStack, Kubernetes, Docker, Podman, Docker Swarm, host, IoT,
 * Proxmox, Ceph and storage array pickers, a Database Health criteria's line,
 * and a Database monitor's charts and the metric it stores. Not one of the
 * 591 descriptions was a key - eight catalogs were never read by the
 * extractor, the other four marked only their names, and the OpenStack
 * catalog glued seventy of them together at run time - so every one read
 * English in every language.
 *
 * Each catalog is a keys root now, and every description a literal it marks
 * (translationKey), as the Database catalog's words under each of its groups
 * and the OpenStack catalog's Octavia names are. This holds every one of
 * them to being a key of the English locale, worded in every Dashboard
 * language (WORDED_LANGUAGES: each language joined it in the change that
 * worded its last one, and none can leave it), and, in every language, to
 * keeping what a reader types or reads as written: the code between its
 * backticks, which the pickers draw as code (MetricPickerDescription), each
 * piece exactly and as often; the metric, attribute and setting names, the
 * products, protocols and unit symbols it gives; the values the monitored
 * system prints (ACTIVE, Synced, "1 = Ready"); every number and % sign; and
 * its closing full stop. The OpenStack catalog's three notes - how to turn a
 * series on, and where libvirt's or Ceilometer's figures come from - read
 * the same after every description they end.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);
const MONITOR_TYPES: string = "packages/Common/Types/Monitor";

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

/*
 * The languages that word every text below: all of the Dashboard's, since
 * Hindi worded its last one. A change that leaves any text English again,
 * or adds a language without wording them, fails.
 */
const WORDED_LANGUAGES: ReadonlyArray<string> = LANGUAGES;

interface CatalogMetric {
  id: string;
  friendlyName: string;
  description: string;
}

interface Catalog {
  file: string;
  metrics: Array<CatalogMetric>;
  /*
   * The files that hold its words, when the catalog file does not: the
   * storage array catalog reads each platform's own (#11000).
   */
  wordFiles?: Array<string>;
}

// Every file under a directory of the repository, by its repository path.
function filesUnder(directory: string): Array<string> {
  return fs
    .readdirSync(path.join(REPOSITORY_ROOT, directory), { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const child: string = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return filesUnder(child);
      }
      return entry.name.endsWith(".ts") ? [child] : [];
    })
    .sort();
}

const CATALOGS: ReadonlyArray<Catalog> = [
  { file: "CephMetricCatalog.ts", metrics: getAllCephMetrics() },
  { file: "DatabaseMetricCatalog.ts", metrics: getAllDatabaseMetrics() },
  { file: "DockerMetricCatalog.ts", metrics: getAllDockerMetrics() },
  {
    file: "DockerSwarmMetricCatalog.ts",
    metrics: getAllDockerSwarmMetrics(),
  },
  { file: "HostMetricCatalog.ts", metrics: getAllHostMetrics() },
  { file: "IotMetricCatalog.ts", metrics: getAllIoTMetrics() },
  { file: "KubernetesMetricCatalog.ts", metrics: getAllKubernetesMetrics() },
  { file: "OpenStackMetricCatalog.ts", metrics: getAllOpenStackMetrics() },
  { file: "PodmanMetricCatalog.ts", metrics: getAllPodmanMetrics() },
  { file: "ProxmoxMetricCatalog.ts", metrics: getAllProxmoxMetrics() },
  {
    file: "StorageArrayMetricCatalog.ts",
    metrics: getAllStorageArrayMetrics(),
    wordFiles: filesUnder("packages/Common/Types/StorageArray/Platforms"),
  },
  { file: "VMwareMetricCatalog.ts", metrics: getAllVMwareMetrics() },
];

const repositoryPathOf: (catalog: Catalog) => string = (
  catalog: Catalog,
): string => {
  return `${MONITOR_TYPES}/${catalog.file}`;
};

// The words under each of the Database catalog's groups.
const DATABASE_GROUP_DESCRIPTIONS: Array<string> =
  getDatabaseMetricCategoryOrder().map(
    (category: DatabaseMetricCategory): string => {
      return getDatabaseMetricCategoryDescription(category);
    },
  );

/*
 * The OpenStack catalog's Octavia names, glued from a scope and a phrase at
 * run time until #8014 and so no key: no other guard holds the OpenStack
 * names in every language yet.
 */
const OCTAVIA_SERIES: RegExp = /^openstack_loadbalancer_(listener_)?stats_/;

const OCTAVIA_NAMES: Array<string> = getAllOpenStackMetrics()
  .filter((metric: { metricName: string }): boolean => {
    return OCTAVIA_SERIES.test(metric.metricName);
  })
  .map((metric: CatalogMetric): string => {
    return metric.friendlyName;
  });

const unique: (texts: Array<string>) => Array<string> = (
  texts: Array<string>,
): Array<string> => {
  return Array.from(new Set<string>(texts));
};

const DESCRIPTIONS: Array<string> = unique(
  CATALOGS.flatMap((catalog: Catalog): Array<string> => {
    return catalog.metrics.map((metric: CatalogMetric): string => {
      return metric.description;
    });
  }),
);

// Every text this suite holds, each once.
const TEXTS: Array<string> = unique([
  ...DESCRIPTIONS,
  ...DATABASE_GROUP_DESCRIPTIONS,
  ...OCTAVIA_NAMES,
]);

type Locale = Record<string, unknown>;

const readJson: (file: string) => unknown = (file: string): unknown => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const localeOf: (language: string) => Locale = (language: string): Locale => {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Locale;
};

const ENGLISH: Locale = localeOf("en");

const LOCALES: ReadonlyMap<string, Locale> = new Map<string, Locale>(
  LANGUAGES.map((language: string): [string, Locale] => {
    return [language, localeOf(language)];
  }),
);

const wordsOf: (language: string) => Locale = (language: string): Locale => {
  return LOCALES.get(language) as Locale;
};

const wordingOf: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  return String(wordsOf(language)[text]);
};

const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

const sameAsEnglishOf: (language: string) => Set<string> = (
  language: string,
): Set<string> => {
  return new Set<string>([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(readLocaleProgress(language)?.sameAsEnglish || []),
  ]);
};

// The texts a locale leaves English, not on its same-as-English lists.
const textsLeftEnglish: (
  words: Locale,
  sameAsEnglish: Set<string>,
) => Array<string> = (
  words: Locale,
  sameAsEnglish: Set<string>,
): Array<string> => {
  return TEXTS.filter((text: string): boolean => {
    const worded: unknown = words[text];

    return (
      typeof worded !== "string" ||
      (worded === text && !hasNoLetters(text) && !sameAsEnglish.has(text))
    );
  });
};

const leftEnglishIn: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return textsLeftEnglish(wordsOf(language), sameAsEnglishOf(language));
};

// The pieces of code a text gives between backticks, sorted.
const codeIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/`([^`]*)`/g), (match: RegExpMatchArray) => {
    return match[1] as string;
  }).sort();
};

const backtickCount: (text: string) => number = (text: string): number => {
  return text.split("`").length - 1;
};

/*
 * What a description names that a reader reads as written, in every
 * language, besides the metric, attribute and setting names and the paths
 * DescriptionWordsKept finds by their shape: the products and services the
 * catalogs are about, the protocols, standards and acronyms that are the
 * same in every language, unit symbols, and the values the monitored system
 * prints - OpenStack's statuses, Galera's states, Kubernetes' conditions.
 */
const NAMES: ReadonlyArray<string> = [
  // Products, services and their parts.
  "OneUptime",
  "Kubernetes",
  "kubelet",
  "kubeletstats",
  "etcd",
  "Swarm",
  "Proxmox",
  "Proxmox VE",
  "Ceph",
  "Quincy",
  "CRUSH",
  "OpenStack",
  "Nova",
  "Neutron",
  "Cinder",
  "Glance",
  "Keystone",
  "Swift",
  "Octavia",
  "Designate",
  "Ironic",
  "Heat",
  "Magnum",
  "Manila",
  "Trove",
  "Barbican",
  "Placement",
  "Ceilometer",
  "Gnocchi",
  "CloudKitty",
  "libvirt",
  "QEMU",
  "OVN",
  "Northbound",
  "Southbound",
  "Open vSwitch",
  "OpenFlow",
  "Geneve",
  "HAProxy",
  "RabbitMQ",
  "Memcached",
  "MariaDB",
  "Galera",
  "Primary",
  "PostgreSQL",
  "MySQL",
  "InnoDB",
  "MyISAM",
  "LOCK TABLES",
  "SQL Server",
  "VMware",
  "VMware Tools",
  "vCenter",
  "vSphere",
  "vSAN",
  "ESXi",
  "Pure",
  "FlashArray",
  "FlashBlade",
  "ActiveCluster",
  "ActiveDR",
  "Unix",
  // Protocols, standards and acronyms every language writes so.
  "CPU",
  "VCPU",
  "API",
  "IP",
  "IPsec",
  "IKE",
  "VPN",
  "DHCP",
  "TLS",
  "HTTP",
  "RBAC",
  "HPA",
  "CFS",
  "OSD",
  "OSDs",
  "PGs",
  "WAL",
  "PLE",
  "SAN",
  "NVRAM",
  "SFP",
  "Ethernet",
  "Fibre Channel",
  "IOPS",
  // A kubelet setting, beside kube-reserved.
  "system-reserved",
  // Unit symbols.
  "MHz",
  "MiB",
  "GiB",
  "KiB",
  "ms",
  "µs",
  "dBm",
  // What the monitored system prints.
  "ACTIVE",
  "BUILD",
  "ERROR",
  "DOWN",
  "ONLINE",
  "DEGRADED",
  "OFFLINE",
  "MASTER",
  "BACKUP",
  "STANDALONE",
  "PENDING",
  "Synced",
  "Joined",
  "Donor",
  "Desynced",
  "Joining",
  "Ready",
  "NotReady",
  "OOMKilled",
  "MemoryPressure",
  "DiskPressure",
  "PIDPressure",
];

/*
 * A value a description gives after an equals sign ("1 = Pending",
 * "0 = NotReady", "1 = True") or in a list of them a filter takes
 * ("used | available", "receive|transmit", '"true" | "false"'), and an
 * environment variable (OPENSTACK_COLLECT_QUOTAS=true): what a monitor's
 * filter is typed with, kept as written.
 */
const VALUE_AFTER_EQUALS: RegExp = /[=]\s*([A-Z][A-Za-z]*)\b/g;
const VALUE_LIST: RegExp = /"?[a-z][a-z_]*"?(?:\s*\|\s*"?[a-z][a-z_]*"?)+/g;
const UPPER_SNAKE_CASE: RegExp = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
/*
 * A service's own process or a series' head, as OpenStack, OVN, Kubernetes
 * and the rest spell them (nova-compute, ovn-controller, kube-reserved,
 * nova-quota_cores) - not an English compound such as "powered-on".
 */
const PROCESS_NAME: RegExp =
  /(?<![\w.-])(?:nova|neutron|cinder|glance|keystone|heat|magnum|manila|trove|octavia|ironic|designate|barbican|gnocchi|ovn|ovs|openstack|kube)-[a-z0-9_-]*[a-z0-9_]/g;

const printedValuesIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const words: string = text.replace(/`[^`]*`/g, " ");

  return unique([
    ...Array.from(
      words.matchAll(VALUE_AFTER_EQUALS),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
    ...(words.match(VALUE_LIST) || []).flatMap(
      (list: string): Array<string> => {
        return list.split("|").map((value: string): string => {
          return value.trim().replace(/^"|"$/g, "");
        });
      },
    ),
    ...(words.match(UPPER_SNAKE_CASE) || []),
    ...(words.match(PROCESS_NAME) || []),
  ]);
};

const keptAsWrittenMissing: (
  english: string,
  worded: string,
) => Array<string> = (english: string, worded: string): Array<string> => {
  const codeless: (text: string) => string = (text: string): string => {
    return text.replace(/`[^`]*`/g, " ");
  };

  // What the code between backticks gives is the code check's to hold.
  return unique([
    ...asWrittenTokensMissing(codeless(english), codeless(worded), NAMES),
    ...printedValuesIn(english).filter((value: string): boolean => {
      return !codeless(worded).includes(value);
    }),
  ]);
};

/*
 * The notes the OpenStack catalog ends a description with, each worded once
 * per language and the same after every description it ends.
 */
const OPENSTACK_NOTES: ReadonlyArray<{ note: RegExp; keep: Array<string> }> = [
  {
    note: / Off by default: delete the --disable-metric=[a-z_-]+ line from the exporter to turn it on\.$/,
    keep: ["--disable-metric="],
  },
  {
    note: / Off by default: run the agent's install\.sh with OPENSTACK_COLLECT_QUOTAS=true to read it once an hour\.$/,
    keep: ["install.sh", "OPENSTACK_COLLECT_QUOTAS=true"],
  },
  {
    note: / Reported only where libvirt's or Ceilometer's exporter is read\.$/,
    keep: ["libvirt", "Ceilometer"],
  },
];

describe("a monitor metric catalog's descriptions are keys", () => {
  test("every monitor metric catalog in Types/Monitor is held here", () => {
    expect(
      fs
        .readdirSync(path.join(REPOSITORY_ROOT, MONITOR_TYPES))
        .filter((name: string): boolean => {
          return name.endsWith("MetricCatalog.ts");
        })
        .sort(),
    ).toEqual(
      CATALOGS.map((catalog: Catalog): string => {
        return catalog.file;
      }).sort(),
    );
  });

  test("each catalog is a keys root of the extractor: only what it marks is read", () => {
    for (const catalog of CATALOGS) {
      const root: SourceRoot | undefined = SOURCE_ROOTS.find(
        (candidate: SourceRoot): boolean => {
          return candidate.directory === repositoryPathOf(catalog);
        },
      );

      expect({ file: catalog.file, kind: root?.kind }).toEqual({
        file: catalog.file,
        kind: "keys",
      });
    }
  });

  test("every description, group description and Octavia name is a literal its catalog marks", () => {
    const unmarked: Array<string> = [];

    for (const catalog of CATALOGS) {
      const files: Array<string> = catalog.wordFiles || [
        repositoryPathOf(catalog),
      ];
      const marked: Set<string> = new Set<string>(
        files.flatMap((file: string): Array<string> => {
          return scanSourceText(
            file,
            fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
            { kind: "keys" },
          ).strings.map((entry: ExtractedString): string => {
            return entry.text;
          });
        }),
      );
      const texts: Array<string> = catalog.metrics.map(
        (metric: CatalogMetric): string => {
          return metric.description;
        },
      );

      if (catalog.file === "DatabaseMetricCatalog.ts") {
        texts.push(...DATABASE_GROUP_DESCRIPTIONS);
      }

      if (catalog.file === "OpenStackMetricCatalog.ts") {
        // Every OpenStack name, the Octavia ones among them.
        texts.push(
          ...catalog.metrics.map((metric: CatalogMetric): string => {
            return metric.friendlyName;
          }),
        );
      }

      for (const text of texts) {
        if (!marked.has(text)) {
          unmarked.push(`${catalog.file}: ${text}`);
        }
      }
    }

    // A description glued together at run time is no literal, and fails here.
    expect(unmarked).toEqual([]);
  });

  test("they are many, and the English locale holds every one", () => {
    expect(
      CATALOGS.reduce((count: number, catalog: Catalog): number => {
        return count + catalog.metrics.length;
      }, 0),
    ).toBeGreaterThan(580);
    expect(DESCRIPTIONS.length).toBeGreaterThan(570);
    expect(DATABASE_GROUP_DESCRIPTIONS.length).toBe(8);
    expect(OCTAVIA_NAMES.length).toBe(10);

    expect(
      TEXTS.filter((text: string): boolean => {
        return ENGLISH[text] !== text;
      }),
    ).toEqual([]);
  });

  test("every name this suite keeps as written is one a description gives", () => {
    expect(
      NAMES.filter((name: string): boolean => {
        return !DESCRIPTIONS.some((text: string): boolean => {
          return asWrittenTokensMissing(text, "", [name]).includes(name);
        });
      }),
    ).toEqual([]);
  });
});

describe("each language words them", () => {
  test("the languages that word every one are the ones listed", () => {
    const wordingAll: Array<string> = LANGUAGES.filter(
      (language: string): boolean => {
        return leftEnglishIn(language).length === 0;
      },
    );

    expect(wordingAll).toEqual(
      LANGUAGES.filter((language: string): boolean => {
        return WORDED_LANGUAGES.includes(language);
      }),
    );
  });

  test.each(LANGUAGES)(
    "%s keeps every placeholder and every piece of code as written, each as often",
    (language: string) => {
      const broken: Array<string> = TEXTS.filter((text: string): boolean => {
        const worded: string = wordingOf(language, text);

        return (
          JSON.stringify(placeholdersOf(worded)) !==
            JSON.stringify(placeholdersOf(text)) ||
          backtickCount(worded) !== backtickCount(text) ||
          JSON.stringify(codeIn(worded)) !== JSON.stringify(codeIn(text))
        );
      });

      expect({ language, broken }).toEqual({ language, broken: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the names, unit symbols and printed values a description gives",
    (language: string) => {
      const missing: Array<{ text: string; missing: Array<string> }> = [];

      for (const text of TEXTS) {
        const lost: Array<string> = keptAsWrittenMissing(
          text,
          wordingOf(language, text),
        );

        if (lost.length > 0) {
          missing.push({ text, missing: lost });
        }
      }

      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s says every number a description says, and keeps its % sign",
    (language: string) => {
      const missing: Array<{ text: string; missing: Array<string> }> = [];

      for (const text of TEXTS) {
        const worded: string = wordingOf(language, text);
        const lost: Array<string> = numbersMissing(
          text.replace(/`[^`]*`/g, " "),
          worded.replace(/`[^`]*`/g, " "),
        );

        if (text.includes("%") && !worded.replace(/٪/g, "%").includes("%")) {
          lost.push("%");
        }

        if (lost.length > 0) {
          missing.push({ text, missing: lost });
        }
      }

      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s ends a sentence where the English does",
    (language: string) => {
      const stops: ReadonlyArray<string> = fullStopsOf(language);

      expect({
        language,
        unended: TEXTS.filter((text: string): boolean => {
          const worded: string = wordingOf(language, text).trimEnd();

          return (
            text.endsWith(".") &&
            !stops.some((stop: string): boolean => {
              return worded.endsWith(stop);
            })
          );
        }),
      }).toEqual({ language, unended: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s words each of the OpenStack catalog's notes the same after every description it ends",
    (language: string) => {
      for (const { note, keep } of OPENSTACK_NOTES) {
        const noted: Array<string> = DESCRIPTIONS.filter(
          (text: string): boolean => {
            return note.test(text);
          },
        );

        // Several descriptions end with each note.
        expect({ note: note.source, noted: noted.length >= 3 }).toEqual({
          note: note.source,
          noted: true,
        });

        /*
         * The off-by-default note names each series' own line, so its
         * shared ending starts after the line.
         */
        const ending: string = sharedEnding(
          noted.map((text: string): string => {
            return wordingOf(language, text);
          }),
        );

        expect({
          language,
          note: note.source,
          ending: ending.length >= 10,
        }).toEqual({
          language,
          note: note.source,
          ending: true,
        });

        for (const text of noted) {
          for (const token of keep) {
            expect({
              language,
              text,
              token,
              kept: wordingOf(language, text).includes(token),
            }).toEqual({ language, text, token, kept: true });
          }
        }
      }
    },
  );

  test("Arabic writes Latin digits, as ARABIC.md chooses", () => {
    expect(
      TEXTS.filter((text: string): boolean => {
        return DIGITS_ARABIC_DOES_NOT_WRITE.test(wordingOf("ar", text));
      }),
    ).toEqual([]);
  });
});

describe("the checks the descriptions are held to", () => {
  /*
   * The rules above are this suite's own, so they are proven here on
   * wordings that break them: a check that passes everything would let a
   * description through English, or without its code, in silence.
   */
  const VMWARE_HOSTS: string =
    'Number of ESXi hosts in the cluster, fanned out by the `effective` datapoint attribute ("true" | "false" — stored as strings). A host is not effective while it is in maintenance mode, disconnected or unresponsive, so `effective = false` above 0 means the cluster is running short of a host.';

  test("the VMware description the negative controls word is in the catalog", () => {
    expect(DESCRIPTIONS).toContain(VMWARE_HOSTS);
  });

  test("a wording that drops, rewords or repeats a piece of code is caught", () => {
    expect(codeIn(VMWARE_HOSTS)).toEqual(["effective", "effective = false"]);

    for (const worded of [
      // The attribute's name translated.
      'Anzahl der ESXi-Hosts im Cluster, aufgefächert nach dem Datenpunkt-Attribut `wirksam` ("true" | "false"). `effective = false` über 0 heißt, dem Cluster fehlt ein Host.',
      // A backtick lost.
      'Anzahl der ESXi-Hosts im Cluster, aufgefächert nach dem Datenpunkt-Attribut `effective ("true" | "false"). `effective = false` über 0 heißt, dem Cluster fehlt ein Host.',
      // A piece said twice.
      'Anzahl der ESXi-Hosts, nach `effective` ("true" | "false"). `effective` und `effective = false` über 0 heißt, dem Cluster fehlt ein Host.',
    ]) {
      expect(
        backtickCount(worded) === backtickCount(VMWARE_HOSTS) &&
          JSON.stringify(codeIn(worded)) ===
            JSON.stringify(codeIn(VMWARE_HOSTS)),
      ).toBe(false);
    }
  });

  test("a wording that translates a printed value, a product or a unit is caught", () => {
    expect(printedValuesIn(VMWARE_HOSTS)).toEqual(["true", "false"]);
    expect(
      keptAsWrittenMissing(
        VMWARE_HOSTS,
        'Anzahl der ESXi-Hosts im Cluster nach `effective` ("wahr" | "falsch"). `effective = false` über 0 heißt, dem Cluster fehlt ein Host.',
      ),
    ).toEqual(["true", "false"]);
    expect(
      printedValuesIn(
        "Fanned out by `direction` (receive|transmit); 1 = Ready, 0 = NotReady. Read by nova-compute, not powered-on, with OPENSTACK_COLLECT_QUOTAS=true.",
      ),
    ).toEqual([
      "Ready",
      "NotReady",
      "receive",
      "transmit",
      "OPENSTACK_COLLECT_QUOTAS",
      "nova-compute",
    ]);
    expect(
      keptAsWrittenMissing(
        "The pod's phase as a numeric code (1 = Pending, 2 = Running). Read Galera's Synced state from vCenter in MHz.",
        "Die Phase des Pods (1 = Ausstehend, 2 = Running). Galeras Zustand Synchron aus dem vCenter in MHz.",
      ),
    ).toEqual(["Synced", "Pending"]);
    expect(
      keptAsWrittenMissing(
        "Total CPU available to the datacenter across every ESXi host, in MHz.",
        "Gesamte CPU des Rechenzentrums über alle ESXi-Hosts, in Megahertz.",
      ),
    ).toEqual(["MHz"]);
    // Names a code piece gives are the code check's, not this one's.
    expect(
      keptAsWrittenMissing(
        "Filter `status = red` for vSAN.",
        "Filtern Sie `status = red` für vSAN.",
      ),
    ).toEqual([]);
  });

  test("a wording that loses a number or the % sign is caught", () => {
    expect(
      numbersMissing(
        "The pod's memory usage divided by its limit, as a ratio (0 to 1) - 0.93 means 93%.",
        "Der Speicher des Pods geteilt durch sein Limit, als Verhältnis - 0,93 heißt 93 Prozent.",
      ),
    ).toEqual(["0", "1"]);
  });

  test("a locale that leaves one English, or loses one, is caught, unless it says it reads so", () => {
    const text: string = TEXTS[0] as string;
    const worded: Locale = {};

    for (const each of TEXTS) {
      worded[each] = `«${each}»`;
    }

    expect(textsLeftEnglish(worded, new Set<string>())).toEqual([]);
    expect(
      textsLeftEnglish({ ...worded, [text]: text }, new Set<string>()),
    ).toEqual([text]);

    const lost: Locale = { ...worded };
    delete lost[text];

    expect(textsLeftEnglish(lost, new Set<string>())).toEqual([text]);
    // Kept as English on purpose, on the language's list.
    expect(
      textsLeftEnglish({ ...worded, [text]: text }, new Set<string>([text])),
    ).toEqual([]);
  });
});
