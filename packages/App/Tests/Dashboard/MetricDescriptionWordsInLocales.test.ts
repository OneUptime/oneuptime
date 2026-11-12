import {
  ExtractedString,
  SourceKind,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import {
  RUM_METRIC_DESCRIPTIONS,
  RUM_REPLAY_ACCESS_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import { SERVICE_METRIC_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ServiceMetricDescriptions";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions";
import { HOST_METRIC_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE (i) BESIDE A RESOURCE PAGE'S TILES, CHARTS AND COLUMNS READS IN THE
 * READER'S LANGUAGE (issue #6368).
 *
 * Every infrastructure and telemetry page explains its numbers in an (i)
 * tooltip beside a tile, chart or column title: a Kubernetes cluster and its
 * pods, hosts, vCenters, network devices and sites, IoT fleets, RUM
 * applications, services, serverless functions, Ceph, cloud, container
 * hosts, Swarm, OpenStack, Proxmox, storage arrays, a database's Overview
 * and engine metrics, a queue's Broker health. Most of those texts read
 * English in fifteen of the sixteen languages - a German page showed an
 * English tooltip beside a German title - and Arabic had none of them.
 *
 * Every text comes from the files below, as the extractor reads them: each
 * file of Components/MetricDescriptions (the folder is read, so a new file
 * is covered the day it lands), the Database Overview's own descriptions,
 * and the database engine and queue Broker health catalogs, whose titles and
 * unit words the tiles draw too. Each is a key of the English locale, and is
 * worded in all seventeen languages, or the same as English on purpose (the
 * global or the language's own same-as-English list). A worded text keeps
 * what a reader looks up or reads as written: its placeholders, the metric,
 * attribute and setting names, paths, product and protocol names and unit
 * symbols it names, every number and the % sign, the states the monitored
 * system prints (pod phases, the node condition Ready, log severities,
 * VMware's CPU Ready) and the values the page prints ("50+", "< 15s"), and
 * it ends as the English ends. A description added without its
 * translations, or without translationKey (which keeps it out of every
 * locale), fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);

const DESCRIPTIONS_DIRECTORY: string =
  "packages/App/FeatureSet/Dashboard/src/Components/MetricDescriptions";

const DATABASE_OVERVIEW_DESCRIPTIONS: string =
  "packages/App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricDescriptions.ts";

const DATABASE_CATALOG: string =
  "packages/Common/Types/DatabaseServer/DatabaseServerMetricCatalog.ts";

const QUEUE_CATALOG: string =
  "packages/Common/Types/MessageQueue/MessageQueueMetricCatalog.ts";

// The files whose every string is a description (read as the page reads them).
const DESCRIPTION_FILES: ReadonlyArray<string> = [
  ...fs
    .readdirSync(path.join(REPOSITORY_ROOT, DESCRIPTIONS_DIRECTORY))
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .sort()
    .map((name: string): string => {
      return `${DESCRIPTIONS_DIRECTORY}/${name}`;
    }),
  DATABASE_OVERVIEW_DESCRIPTIONS,
];

/*
 * The catalogs mark only their words (titles, descriptions, unit words):
 * metric names and attribute keys in them stay as written.
 */
const CATALOG_FILES: ReadonlyArray<string> = [DATABASE_CATALOG, QUEUE_CATALOG];

const LANGUAGES: ReadonlyArray<string> = [
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
  "ar",
];

type Locale = Record<string, unknown>;

function localeOf(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, `src/Locales/${language}.json`),
      "utf8",
    ),
  ) as Locale;
}

const ENGLISH: Locale = localeOf("en");

const LOCALES: ReadonlyMap<string, Locale> = new Map<string, Locale>(
  LANGUAGES.map((language: string): [string, Locale] => {
    return [language, localeOf(language)];
  }),
);

function wordsOf(language: string): Locale {
  return LOCALES.get(language) as Locale;
}

function scanOf(file: string, kind: SourceKind): SourceScanResult {
  return scanSourceText(
    file,
    fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    { kind },
  );
}

const SCANS: ReadonlyMap<string, SourceScanResult> = new Map<
  string,
  SourceScanResult
>([
  ...DESCRIPTION_FILES.map((file: string): [string, SourceScanResult] => {
    return [file, scanOf(file, "ui")];
  }),
  ...CATALOG_FILES.map((file: string): [string, SourceScanResult] => {
    return [file, scanOf(file, "keys")];
  }),
]);

function textsOf(file: string): Set<string> {
  return new Set<string>(
    (SCANS.get(file) as SourceScanResult).strings.map(
      (entry: ExtractedString): string => {
        return entry.text;
      },
    ),
  );
}

// Every string the tooltips and the catalogs' tiles draw, each once.
const WORDS: Array<string> = Array.from(
  new Set<string>(
    Array.from(SCANS.values()).flatMap(
      (scan: SourceScanResult): Array<string> => {
        return scan.strings.map((entry: ExtractedString): string => {
          return entry.text;
        });
      },
    ),
  ),
).sort();

/*
 * Every description a module of the folder (or the Database Overview's)
 * exports, as the page reads it at run time: each `*_DESCRIPTIONS` record's
 * values. Loaded by path, so a new file is loaded too.
 */
interface ExportedDescription {
  file: string;
  name: string;
  text: unknown;
}

function exportedDescriptionsOf(file: string): Array<ExportedDescription> {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const loaded: Record<string, unknown> = require(
    path.join(REPOSITORY_ROOT, file),
  ) as Record<string, unknown>;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const descriptions: Array<ExportedDescription> = [];

  for (const [exportName, value] of Object.entries(loaded)) {
    if (
      !exportName.endsWith("_DESCRIPTIONS") ||
      typeof value !== "object" ||
      value === null
    ) {
      continue;
    }

    for (const [key, text] of Object.entries(value)) {
      descriptions.push({ file, name: `${exportName}.${key}`, text });
    }
  }

  return descriptions;
}

const EXPORTED: ReadonlyMap<string, Array<ExportedDescription>> = new Map<
  string,
  Array<ExportedDescription>
>(
  DESCRIPTION_FILES.map(
    (file: string): [string, Array<ExportedDescription>] => {
      return [file, exportedDescriptionsOf(file)];
    },
  ),
);

/*
 * What a reading in English excuses as the same as English (LocaleStatus):
 * a text with no letters, the global list, the language's own list.
 */
const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function hasNoLetters(text: string): boolean {
  return !LETTER.test(text.replace(PLACEHOLDER, ""));
}

const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

function sameAsEnglishOf(language: string): Set<string> {
  return new Set<string>([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(readLocaleProgress(language)?.sameAsEnglish || []),
  ]);
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

/*
 * What a text names that a reader looks up or reads as written, in every
 * language: a metric or attribute name (k8s.pod.cpu.usage,
 * telemetry.sdk.language), a setting (max_connections, wsrep_desync), an
 * identifier (cpuCores, a camelCase field), a token with digits in it (p95,
 * HTTP2, V8), a path (/orders/:id), the products, protocols and standards
 * the pages are about, unit symbols the tiles print in Latin letters, and a
 * value the page prints in quotation marks ("50+").
 */
const DOTTED: RegExp = /(?<![\w.])[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+/g;
const SNAKE_CASE: RegExp = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const CAMEL_CASE: RegExp = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const LETTERS_AND_DIGITS: RegExp = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g;
const PATH_LIKE: RegExp = /(?<!\w)\/[\w/:*-]+[\w*]/g;
const QUOTED_VALUE: RegExp = /"([^"]+)"/g;
const NUMERIC_VALUE: RegExp = /^[\d+<>%.,\s]+$/;
const NOT_TOKENS: ReadonlySet<string> = new Set<string>(["e.g", "i.e", "etc"]);

const NAMES: ReadonlyArray<string> = [
  "OneUptime",
  "OpenTelemetry",
  "Kubernetes",
  "Docker",
  "Podman",
  "Proxmox",
  "Ceph",
  "OpenStack",
  "vCenter",
  "ESXi",
  "VMware",
  "Windows",
  "Linux",
  "macOS",
  "systemd",
  "kubelet",
  "kubectl",
  "Helm",
  "Prometheus",
  "JavaScript",
  "Node.js",
  ".NET",
  "Java",
  "JVM",
  "Python",
  "Go",
  "V8",
  "PostgreSQL",
  "MySQL",
  "MariaDB",
  "Galera",
  "Redis",
  "MongoDB",
  "WiredTiger",
  "SQL Server",
  "Oracle",
  "Elasticsearch",
  "OpenSearch",
  "Memcached",
  "ClickHouse",
  "Cassandra",
  "Kafka",
  "RabbitMQ",
  "NATS",
  "Pulsar",
  "RocketMQ",
  "ActiveMQ",
  "SQS",
  "SNS",
  "AWS",
  "Azure",
  "Lambda",
  "CloudWatch",
  "SNMP",
  "ICMP",
  "HTTP",
  "TCP",
  "UDP",
  "DNS",
  "TLS",
  "OTLP",
  "SDK",
  "SDKs",
  "LCP",
  "INP",
  "CLS",
  "FCP",
  "TTFB",
  "InnoDB",
  "WAL",
  "SGA",
  "PDB",
  "Nova",
  "Keystone",
  "Neutron",
  "Cinder",
  "Glance",
  "Swift",
  "Meraki",
  "OSProfiler",
  "rrweb",
  "Pyroscope",
  "eBPF",
  "FLUSH STATUS",
];

const UNIT_SYMBOLS: ReadonlyArray<string> = [
  "ms",
  "µs",
  "Gi",
  "GiB",
  "KiB",
  "Mi",
  "MiB",
  "TiB",
  "dBm",
  "Mbps",
  "Gbps",
  "MHz",
  "GHz",
  "IOPS",
  "bytes/s",
  "B/s",
];

// A name standing as a word of its own: not part of a longer word or name.
function standsAlone(token: string): RegExp {
  return new RegExp(`(?<![\\w.])${escapeRegExp(token)}(?!\\w)`);
}

const NAME_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ...NAMES,
  ...UNIT_SYMBOLS,
].map((token: string): [string, RegExp] => {
  return [token, standsAlone(token)];
});

interface AsWrittenToken {
  token: string;
  // The forms a translation may keep it in (a plural's singular, "SDK").
  forms: Array<string>;
}

function asWrittenIn(english: string): Array<AsWrittenToken> {
  const text: string = english.replace(PLACEHOLDER, " ");
  const tokens: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const pattern of [DOTTED, SNAKE_CASE, LETTERS_AND_DIGITS, PATH_LIKE]) {
    for (const match of text.match(pattern) || []) {
      if (!NOT_TOKENS.has(match)) {
        tokens.set(match, [match]);
      }
    }
  }

  // A camelCase name may lose its English plural "s" ("cpuCores").
  for (const match of text.match(CAMEL_CASE) || []) {
    tokens.set(
      match,
      match.endsWith("s") ? [match, match.slice(0, -1)] : [match],
    );
  }

  for (const [token, pattern] of NAME_PATTERNS) {
    if (pattern.test(text)) {
      tokens.set(token, token === "SDKs" ? [token, "SDK"] : [token]);
    }
  }

  for (const match of text.matchAll(QUOTED_VALUE)) {
    const quoted: string = match[1] as string;

    if (NUMERIC_VALUE.test(quoted)) {
      tokens.set(quoted, [quoted]);
    }
  }

  return Array.from(tokens.entries()).map(
    ([token, forms]: [string, Array<string>]): AsWrittenToken => {
      return { token, forms };
    },
  );
}

/*
 * The numbers a text says, as one language or another writes them: Persian
 * and Hindi digits read as 0-9, a thousands separator (2,000 / 2.000 /
 * 2 000) dropped and a decimal comma read as a point. An ordinal ("the 1st
 * of the month") may be worded instead.
 */
const DIGITS_OF_OTHER_SCRIPTS: ReadonlyArray<string> = [
  "۰۱۲۳۴۵۶۷۸۹",
  "٠١٢٣٤٥٦٧٨٩",
  "०१२३४५६७८९",
];

function withLatinDigits(text: string): string {
  let result: string = text;

  for (const digits of DIGITS_OF_OTHER_SCRIPTS) {
    for (let digit: number = 0; digit < 10; digit++) {
      result = result.split(digits[digit] as string).join(String(digit));
    }
  }

  return result;
}

/*
 * A thousands separator: a comma, a point, a space - plain, no-break (U+00A0),
 * narrow no-break (U+202F) or thin (U+2009) - or an apostrophe.
 */
const THOUSANDS_SEPARATOR: RegExp = new RegExp(
  "(?<=\\d)[,.\\u00a0\\u202f\\u2009 '\\u2019](?=\\d{3}(?!\\d))",
  "g",
);

function numbersIn(text: string): Array<string> {
  const plain: string = withLatinDigits(text)
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, " ")
    .replace(THOUSANDS_SEPARATOR, "");

  return (plain.match(/\d+(?:[.,]\d+)?/g) || []).map(
    (number: string): string => {
      return number.replace(",", ".");
    },
  );
}

// A number with trailing decimal zeros is the same number (12.0 is 12).
function withoutTrailingZeros(number: string): string {
  return number.includes(".") ? number.replace(/\.?0+$/, "") : number;
}

function saysNumber(numbers: Array<string>, number: string): boolean {
  const wanted: string = withoutTrailingZeros(number);

  return numbers.some((said: string): boolean => {
    return withoutTrailingZeros(said) === wanted;
  });
}

// A full stop as each language writes one.
const FULL_STOPS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ja: ["。", "."],
  "zh-CN": ["。", "."],
  "zh-TW": ["。", "."],
  hi: ["।", "."],
};

function fullStopsOf(language: string): ReadonlyArray<string> {
  return FULL_STOPS[language] || ["."];
}

/*
 * The states the monitored system prints and the page shows as written,
 * and the values the page prints, which a text quotes.
 */
const PRINTED_AS_WRITTEN: ReadonlyArray<{
  name: string;
  english: string;
  keep: ReadonlyArray<string>;
}> = [
  {
    name: "a cluster's Pod health: the pod phases its legend draws",
    english: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podHealth,
    keep: ["Running", "Succeeded", "Pending", "Failed"],
  },
  {
    name: "a cluster's Nodes Not Ready: the node condition kubectl prints",
    english: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.nodesNotReady,
    keep: ["Ready"],
  },
  {
    name: "a cluster's Nodes: the node condition kubectl prints",
    english: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.nodes,
    keep: ["Ready"],
  },
  {
    name: "a service's Logs chart: the log severities",
    english: SERVICE_METRIC_DESCRIPTIONS.logsChart,
    keep: ["Error", "Fatal"],
  },
  {
    name: "a RUM application's Logs chart: the log severities",
    english: RUM_METRIC_DESCRIPTIONS.logsChart,
    keep: ["Error", "Fatal"],
  },
  {
    name: "a vCenter's VM CPU Ready tile: VMware's metric",
    english: VMWARE_METRIC_DESCRIPTIONS.overviewVmCpuReady,
    keep: ["CPU Ready"],
  },
  {
    name: "a vCenter's VM CPU Ready chart: VMware's metric",
    english: VMWARE_METRIC_DESCRIPTIONS.overviewVmCpuReadyChart,
    keep: ["CPU Ready"],
  },
  {
    name: "a vCenter's top VMs by CPU Ready: VMware's metric",
    english: VMWARE_METRIC_DESCRIPTIONS.topVmsByCpuReady,
    keep: ["CPU Ready"],
  },
  {
    name: "a RUM application's Sessions recorded tile: the value it prints",
    english: RUM_METRIC_DESCRIPTIONS.sessionsRecorded,
    keep: ["50+"],
  },
  {
    name: "a replay's Watched column: the value it prints",
    english: RUM_REPLAY_ACCESS_METRIC_DESCRIPTIONS.watched,
    keep: ["< 15s"],
  },
  /*
   * #6731: a systemd unit's kind, which the Systemd Units list and a
   * unit's page show as systemd writes it (Components/Host/SystemdUnitKind).
   */
  {
    name: "a systemd unit's Unit Type tile: the kinds as systemd writes them",
    english: HOST_METRIC_DESCRIPTIONS.unitType,
    keep: ["service", "socket", "timer", "mount", "target"],
  },
  {
    name: "the Systemd Units list's Type column: the kinds as systemd writes them",
    english: HOST_METRIC_DESCRIPTIONS.unitListType,
    keep: ["service", "timer"],
  },
];

/*
 * The two sentences that end a database engine description (the catalog's
 * comment, held word for word by DatabaseServerMetricCatalog.test). Each is
 * worded once per language and reads the same after every description it
 * ends.
 */
const ENGINE_NOTES: ReadonlyArray<{ note: string; keep: Array<string> }> = [
  {
    note: "Off by default in the collector's receiver; the Database Agent switches it on, and your own collector has to enable it too.",
    keep: [],
  },
  {
    note: "The receiver does not report it: the Database Agent reads it with SQL, and your own collector has to enable the same sqlquery receiver.",
    keep: ["SQL", "sqlquery"],
  },
];

function sharedEnding(texts: Array<string>): string {
  if (texts.length === 0) {
    return "";
  }

  let ending: string = texts[0] as string;

  for (const text of texts.slice(1)) {
    let length: number = 0;

    while (
      length < ending.length &&
      length < text.length &&
      ending[ending.length - 1 - length] === text[text.length - 1 - length]
    ) {
      length++;
    }

    ending = ending.slice(ending.length - length);
  }

  return ending;
}

const DIGITS_ARABIC_DOES_NOT_WRITE: RegExp = /[٠-٩۰-۹]/;

/*
 * A catalog unit the value formatter writes itself ("12 MB", "3.2 s",
 * "45%"), not a word a tile puts after its value: left unmarked, as written.
 */
const FORMATTER_UNITS: ReadonlySet<string> = new Set<string>([
  "%",
  "bytes",
  "fraction",
  "ms",
  "ops/s",
  "s",
]);

function mustBeMarked(text: string, isUnit: boolean): boolean {
  return Boolean(text) && !(isUnit && FORMATTER_UNITS.has(text));
}

/*
 * A queue metric's title that tells two copies of one metric apart is
 * "<title> (<qualifier>)", each part a key of its own, which
 * getMessageQueueBrokerMetricTitle words as "{{title}} ({{qualifier}})" in
 * the reader's language and order: "Queue size (legacy names)".
 */
const QUALIFIED_TITLE: RegExp = /^(.+) \((.+)\)$/;

function isMarkedTitle(title: string, marked: Set<string>): boolean {
  if (marked.has(title)) {
    return true;
  }

  const qualified: RegExpMatchArray | null = title.match(QUALIFIED_TITLE);

  return Boolean(
    qualified &&
      marked.has(qualified[1] as string) &&
      marked.has(qualified[2] as string),
  );
}

describe("the (i) descriptions beside resource pages' tiles, charts and columns", () => {
  test("the extractor reads every description, catalog title and unit word, and none is drawn as written", () => {
    expect(DESCRIPTION_FILES.length).toBeGreaterThanOrEqual(19);
    expect(WORDS.length).toBeGreaterThan(900);

    for (const text of [
      // A host's CPU tile.
      "Share of CPU time across all cores spent running programs and the operating system, averaged over the last 5 minutes of the range. 100% means every core was busy; on ranges over 12 hours or with no recent data, it is usually the whole-range average.",
      // A database's Calling services tile.
      "How many different services sent at least one query to this database in the selected range. The Calling services table below lists the busiest ten.",
      // A database engine metric, its title and its unit word.
      "The configured max_connections limit.",
      "Max connections",
      "connections",
      // A queue's Broker health metric and its title.
      "Messages a consumer group has not yet committed on this topic, added up across its partitions. With several consumer groups, the one furthest behind is shown; a group appears only once it has committed an offset on the topic.",
      "Consumer lag",
    ]) {
      expect({ text, read: WORDS.includes(text) }).toEqual({
        text,
        read: true,
      });
    }

    // Nothing glued from pieces or written into a page unlooked-up.
    for (const [file, scan] of SCANS) {
      expect({ file, hardcoded: scan.hardcoded }).toEqual({
        file,
        hardcoded: [],
      });
    }
  });

  test("every description a file exports is marked as a key, so the locales hold it", () => {
    let exported: number = 0;

    for (const file of DESCRIPTION_FILES) {
      const descriptions: Array<ExportedDescription> = EXPORTED.get(
        file,
      ) as Array<ExportedDescription>;
      const marked: Set<string> = textsOf(file);

      // Every file of the folder says what some page's numbers mean.
      expect({ file, exports: descriptions.length > 0 }).toEqual({
        file,
        exports: true,
      });

      for (const description of descriptions) {
        exported++;
        expect({
          name: description.name,
          isText: typeof description.text === "string",
          marked: marked.has(String(description.text)),
        }).toEqual({ name: description.name, isText: true, marked: true });
      }
    }

    expect(exported).toBeGreaterThan(600);
  });

  test("every catalog metric's title, description and unit word is marked as a key", () => {
    const databaseWords: Set<string> = textsOf(DATABASE_CATALOG);
    const queueWords: Set<string> = textsOf(QUEUE_CATALOG);
    let formatterUnits: number = 0;

    expect(DATABASE_SERVER_METRICS.length).toBeGreaterThan(60);
    expect(MESSAGE_QUEUE_METRICS.length).toBeGreaterThan(50);

    for (const metric of DATABASE_SERVER_METRICS) {
      const definition: DatabaseServerMetricDefinition = metric;

      for (const [text, isUnit] of [
        [definition.title, false],
        [definition.description, false],
        [definition.unit, true],
      ] as Array<[string, boolean]>) {
        if (!mustBeMarked(text, isUnit)) {
          formatterUnits += isUnit ? 1 : 0;
          continue;
        }

        expect({
          metric: `${definition.system} ${definition.metricName}`,
          text,
          marked: databaseWords.has(text),
        }).toEqual({
          metric: `${definition.system} ${definition.metricName}`,
          text,
          marked: true,
        });
      }
    }

    for (const metric of MESSAGE_QUEUE_METRICS) {
      const descriptor: MessageQueueMetricDescriptor = metric;

      for (const [text, isUnit] of [
        [descriptor.title, false],
        [descriptor.description, false],
        [descriptor.unit, true],
      ] as Array<[string, boolean]>) {
        if (!mustBeMarked(text, isUnit)) {
          formatterUnits += isUnit ? 1 : 0;
          continue;
        }

        expect({
          metric: `${descriptor.system} ${descriptor.metricName}`,
          text,
          marked:
            text === descriptor.title
              ? isMarkedTitle(text, queueWords)
              : queueWords.has(text),
        }).toEqual({
          metric: `${descriptor.system} ${descriptor.metricName}`,
          text,
          marked: true,
        });
      }
    }

    // Byte sizes, durations and shares the formatter writes ("12 MB").
    expect(formatterUnits).toBeGreaterThan(10);
  });

  test("are every one a key of the English locale", () => {
    for (const text of WORDS) {
      expect({ text, key: ENGLISH[text] }).toEqual({ text, key: text });
    }
  });

  test.each(LANGUAGES)(
    "%s words every one of them, or keeps it as English on purpose",
    (language: string) => {
      const words: Locale = wordsOf(language);
      const sameAsEnglish: Set<string> = sameAsEnglishOf(language);
      const english: Array<string> = WORDS.filter((text: string): boolean => {
        const worded: unknown = words[text];

        if (typeof worded !== "string") {
          return true;
        }

        return (
          worded === text && !hasNoLetters(text) && !sameAsEnglish.has(text)
        );
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)("%s keeps every placeholder", (language: string) => {
    const words: Locale = wordsOf(language);

    for (const text of WORDS) {
      expect({
        language,
        text,
        placeholders: placeholdersOf(String(words[text])),
      }).toEqual({ language, text, placeholders: placeholdersOf(text) });
    }
  });

  test.each(LANGUAGES)(
    "%s keeps the metric, attribute, setting and product names, paths and unit symbols a text names as written",
    (language: string) => {
      const words: Locale = wordsOf(language);
      let checked: number = 0;

      for (const text of WORDS) {
        const worded: string = String(words[text]);
        const tokens: Array<AsWrittenToken> = asWrittenIn(text);
        checked += tokens.length;

        const missing: Array<string> = tokens
          .filter((token: AsWrittenToken): boolean => {
            return !token.forms.some((form: string): boolean => {
              return worded.includes(form);
            });
          })
          .map((token: AsWrittenToken): string => {
            return token.token;
          });

        expect({ language, text, missing }).toEqual({
          language,
          text,
          missing: [],
        });
      }

      // Hundreds of names: k8s.pod.cpu.usage, max_connections, p95, Kafka.
      expect(checked).toBeGreaterThan(300);
    },
  );

  test.each(LANGUAGES)(
    "%s says every number a text says, and keeps its % sign",
    (language: string) => {
      const words: Locale = wordsOf(language);

      for (const text of WORDS) {
        const worded: string = String(words[text]);
        const said: Array<string> = numbersIn(worded);
        const missing: Array<string> = numbersIn(text).filter(
          (number: string): boolean => {
            return !saysNumber(said, number);
          },
        );

        expect({ language, text, missing }).toEqual({
          language,
          text,
          missing: [],
        });

        if (text.includes("%")) {
          expect({
            language,
            text,
            percent: worded.replace(/٪/g, "%").includes("%"),
          }).toEqual({ language, text, percent: true });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s ends a sentence where the English does",
    (language: string) => {
      const words: Locale = wordsOf(language);
      const stops: ReadonlyArray<string> = fullStopsOf(language);

      for (const text of WORDS) {
        if (!text.endsWith(".")) {
          continue;
        }

        const worded: string = String(words[text]).trimEnd();

        expect({
          language,
          text,
          endsWithAFullStop: stops.some((stop: string): boolean => {
            return worded.endsWith(stop);
          }),
        }).toEqual({ language, text, endsWithAFullStop: true });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s quotes the states the system prints and the values the page prints as written",
    (language: string) => {
      const words: Locale = wordsOf(language);

      for (const quoted of PRINTED_AS_WRITTEN) {
        // The description still quotes them in English.
        for (const state of quoted.keep) {
          expect({ name: quoted.name, state, quoted: quoted.english }).toEqual({
            name: quoted.name,
            state,
            quoted: expect.stringContaining(state),
          });
        }

        const worded: string = String(words[quoted.english]);

        for (const state of quoted.keep) {
          expect({
            language,
            name: quoted.name,
            state,
            kept: worded.includes(state),
          }).toEqual({ language, name: quoted.name, state, kept: true });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s words each of a database engine description's two closing notes once, the same after every description",
    (language: string) => {
      const words: Locale = wordsOf(language);
      const engineDescriptions: Array<string> = DATABASE_SERVER_METRICS.map(
        (metric: DatabaseServerMetricDefinition): string => {
          return metric.description;
        },
      );

      for (const { note, keep } of ENGINE_NOTES) {
        const noted: Array<string> = Array.from(
          new Set<string>(
            engineDescriptions.filter((description: string): boolean => {
              return description.endsWith(` ${note}`);
            }),
          ),
        );

        // Several descriptions end with each note.
        expect({ note, noted: noted.length >= 3 }).toEqual({
          note,
          noted: true,
        });

        const ending: string = sharedEnding(
          noted.map((description: string): string => {
            return String(words[description]);
          }),
        );

        /*
         * The note's wording, at the end of each: never shorter than a
         * Chinese clause, and holding what it names as written.
         */
        expect({ language, note, ending: ending.length >= 40 }).toEqual({
          language,
          note,
          ending: true,
        });

        for (const token of keep) {
          expect({
            language,
            note,
            token,
            kept: ending.includes(token),
          }).toEqual({ language, note, token, kept: true });
        }
      }
    },
  );

  test("Arabic writes Latin digits, as ARABIC.md chooses", () => {
    const words: Locale = wordsOf("ar");

    for (const text of WORDS) {
      expect({
        text,
        otherDigits: DIGITS_ARABIC_DOES_NOT_WRITE.test(String(words[text])),
      }).toEqual({ text, otherDigits: false });
    }
  });
});

describe("the checks the descriptions are held to", () => {
  /*
   * The rules above are this suite's own, so they are proven here on texts
   * that break them: a check that passes everything would let a description
   * through English, or without its metric name, in silence.
   */
  test("names as written: metric, attribute, setting and product names, paths, unit symbols and printed values", () => {
    const tokens: Array<string> = asWrittenIn(
      'Bytes from k8s.pod.network.io and max_connections, by cpuCores, p95, /orders/:id, Kafka and SDKs, in ms; the tile shows "50+".',
    ).map((token: AsWrittenToken): string => {
      return token.token;
    });

    for (const token of [
      "k8s.pod.network.io",
      "max_connections",
      "cpuCores",
      "p95",
      "/orders/:id",
      "Kafka",
      "SDKs",
      "ms",
      "50+",
    ]) {
      expect({ token, found: tokens.includes(token) }).toEqual({
        token,
        found: true,
      });
    }

    // A placeholder, "e.g." and a word that only contains a name are not names.
    expect(
      asWrittenIn("Set {{count}} e.g. Gooey widgets, Javascripts.").map(
        (token: AsWrittenToken): string => {
          return token.token;
        },
      ),
    ).toEqual([]);

    // A plural camelCase name may lose its "s"; "SDKs" may read "SDK".
    expect(asWrittenIn("cpuCores")).toEqual([
      { token: "cpuCores", forms: ["cpuCores", "cpuCore"] },
    ]);
    expect(asWrittenIn("the SDKs")).toEqual([
      { token: "SDKs", forms: ["SDKs", "SDK"] },
    ]);
  });

  test("numbers: every script's digits, separators and decimal commas", () => {
    const NARROW_NO_BREAK_SPACE: string = String.fromCharCode(0x202f);
    const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);

    expect(numbersIn("Amber past 85% and red past 95%, 2,000 samples")).toEqual(
      ["85", "95", "2000"],
    );
    // German writes 2.000 and 0,5; Persian ۸۵ and ۲٫۵; Hindi ८५.
    expect(numbersIn("2.000 Proben, 0,5 s")).toEqual(["2000", "0.5"]);
    expect(numbersIn("۸۵٪ و ۲٫۵")).toEqual(["85", "2.5"]);
    expect(numbersIn("८५%")).toEqual(["85"]);
    // A thin or narrow no-break space between thousands.
    expect(
      numbersIn(`2${NARROW_NO_BREAK_SPACE}000 et 2${NO_BREAK_SPACE}000`),
    ).toEqual(["2000", "2000"]);
    // An ordinal may be worded instead.
    expect(numbersIn("the 1st of each month")).toEqual([]);

    expect(saysNumber(["12.0"], "12")).toBe(true);
    expect(saysNumber(["2.50"], "2.5")).toBe(true);
    expect(saysNumber(["100"], "10")).toBe(false);
    expect(saysNumber(["85"], "95")).toBe(false);
  });

  test("the shared ending of the noted descriptions is their note", () => {
    expect(
      sharedEnding(["Eins. Gleich am Ende.", "Zwei. Gleich am Ende."]),
    ).toBe(". Gleich am Ende.");
    expect(sharedEnding(["abc", "xyz"])).toBe("");
    expect(sharedEnding([])).toBe("");
  });

  test("a text the language left English, or worded without its names, is caught", () => {
    const text: string =
      "Share of CPU time spent in k8s.pod.cpu.usage, averaged over 5 minutes.";

    // Left English, and not excused.
    expect(hasNoLetters(text)).toBe(false);
    expect(hasNoLetters("{{count}} / {{total}}")).toBe(true);

    // Worded without its metric name or its number.
    const worded: string = "Anteil der CPU-Zeit, gemittelt über Minuten.";
    expect(
      asWrittenIn(text).filter((token: AsWrittenToken): boolean => {
        return !token.forms.some((form: string): boolean => {
          return worded.includes(form);
        });
      }),
    ).toEqual([
      { token: "k8s.pod.cpu.usage", forms: ["k8s.pod.cpu.usage"] },
      { token: "k8s", forms: ["k8s"] },
    ]);
    expect(saysNumber(numbersIn(worded), "5")).toBe(false);
  });
});
