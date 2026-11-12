import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getNumberLocale,
  writeDigitsInLocale,
} from "../../../Types/DateLanguage";
import escapeRegExp from "../../../Utils/RegExpEscape";
import {
  ResourceShowcase,
  ShowcaseFeature,
  ShowcaseRow,
  ShowcaseStat,
  formatShowcaseFigure,
  isShowcaseFigure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import { ProductOnboarding } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboarding";
import { PRODUCT_ONBOARDINGS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import CEPH_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephClusterShowcase";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudEnvironmentShowcase";
import CLOUD_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudShowcase";
import DATABASE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseShowcase";
import DOCKER_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DockerHostShowcase";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterShowcase";
import HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostShowcase";
import IOT_FLEET_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTFleetShowcase";
import KUBERNETES_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesClusterShowcase";
import MESSAGE_QUEUE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueShowcase";
import OPENSTACK_CLOUD_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCloudShowcase";
import PODMAN_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Podman/PodmanHostShowcase";
import PROXMOX_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxClusterShowcase";
import RUM_APPLICATION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumApplicationShowcase";
import SERVERLESS_FUNCTION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessFunctionShowcase";
import STORAGE_ARRAY_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayShowcase";
import VMWARE_VCENTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareVCenterShowcase";

/*
 * THE NUMBERS IN AN EXAMPLE'S SENTENCES, IN THE READER'S LANGUAGE (#6535).
 *
 * A product's example writes its tiles' numbers the reader's way
 * (formatShowcaseFigure, ShowcaseFiguresInLocale). Its sentences hold
 * numbers too - a row's detail, the example's subtitle, the alert it
 * raised: "Consumer · 48,210 behind", "Producer · 1.82M published" - and
 * those are translations, each language's own text. They kept the English
 * way of writing a number: a German row read "48,210 im Rückstand" (forty
 * eight point two one) under a tile reading "1,82 Mio.", a Persian one
 * Latin digits beside its Persian tiles.
 *
 * Each language now writes them as its tiles do, and this suite holds every
 * shipped language to it:
 *
 *   - every number in every sentence an example draws is listed below, by
 *     kind: a count ("48,210", "2.0" keeps its decimal), a percent, a large
 *     count abbreviated ("1.82M"), a clock ("02:00"), a negative ("-61");
 *   - every language writes each one as Intl writes it for that language:
 *     "48.210" in German, "۴۸٬۲۱۰" in Persian, "1,82 Mio." and "182万";
 *   - nothing else in a translation is a number but the codes the English
 *     names, drawn as written ("esx-03", "Ubuntu 24.04", "p95").
 *
 * Arabic says some small counts as words ("منطقتان", two regions), as its
 * grammar wants (WRITTEN_AS_A_WORD). A unit in a sentence ("TB", "ms",
 * "minutes") is left as each translator wrote it.
 */

interface SentenceNumber {
  // As the English sentence writes it: "48,210", "1.82M", "02:00", "-61".
  english: string;
  // As `language` writes it.
  write: (language: string) => string;
  // What must come right after it, as a pattern: a percent sign.
  after: (language: string) => string;
}

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// Every language the Dashboard ships besides English, whose keys these are.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const LOCALES: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>(
  ["en", ...LANGUAGES].map(
    (language: string): [string, Record<string, string>] => {
      return [language, readLocale(language)];
    },
  ),
);

function localeOf(language: string): Record<string, string> {
  return LOCALES.get(language) || {};
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = localeOf(language);

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

// The decimals an English number writes: "2.0" one, "1.42" two, "48,210" none.
const ENGLISH_DECIMALS_PATTERN: RegExp = /\.(\d+)$/;

// Not a number's own neighbour: a digit, or a decimal or thousands sign.
const NUMBER_SIGNS: string = "\\p{Nd}.,\u066B\u066C";
const NUMBER_BEFORE: string = `(?<![${NUMBER_SIGNS}])`;
const NUMBER_AFTER: string = `(?!\\p{Nd}|[.,\u066B\u066C]\\p{Nd})`;

// A run of digits a sentence holds: "48,210", "22.04", "1:9092", "۴۸٬۲۱۰".
const DIGIT_RUN_PATTERN: RegExp = /\p{Nd}+(?:[.,:\u066B\u066C]\p{Nd}+)*/gu;

const PERSIAN_PERCENT_SIGN: string = "\u066A";

// A percent sign after its number, as each translator spaced it.
const PERCENT_SIGN_AFTER: string = "\\s?%";

// Arabic says a negative signal strength with its word for minus: "سالب 61".
const ARABIC_MINUS_WORD: string = "\u0633\u0627\u0644\u0628\\s";
const MINUS_SIGN_BEFORE: string = "[-\u2212]";

function writeCount(value: number, decimals: number, language: string): string {
  return new Intl.NumberFormat(getNumberLocale(language), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function decimalsOf(english: string): number {
  const fraction: RegExpExecArray | null =
    ENGLISH_DECIMALS_PATTERN.exec(english);

  return fraction ? (fraction[1] || "").length : 0;
}

const NOTHING_AFTER: (language: string) => string = (): string => {
  return "";
};

// A count, or a reading with decimals: "48,210", "3.8", "2.0".
function count(english: string, value: number): SentenceNumber {
  return {
    english,
    write: (language: string): string => {
      return writeCount(value, decimalsOf(english), language);
    },
    after: NOTHING_AFTER,
  };
}

// A percent: its number the language's way, Persian's own sign after it.
function percent(english: string, value: number): SentenceNumber {
  return {
    english,
    write: (language: string): string => {
      return writeCount(value, decimalsOf(english), language);
    },
    after: (language: string): string => {
      return language === "fa" ? PERSIAN_PERCENT_SIGN : PERCENT_SIGN_AFTER;
    },
  };
}

// A large count abbreviated as the example's tiles abbreviate it: "1.82M".
function abbreviated(english: string, value: number): SentenceNumber {
  return {
    english,
    write: (language: string): string => {
      return formatShowcaseFigure(
        { abbreviated: value },
        translatorFor(language),
      );
    },
    after: NOTHING_AFTER,
  };
}

// A clock, "02:00", in the digits the language writes.
function clock(english: string): SentenceNumber {
  return {
    english,
    write: (language: string): string => {
      return writeDigitsInLocale(english, language);
    },
    after: NOTHING_AFTER,
  };
}

/*
 * A negative reading, "-61": its number the language's way after a minus
 * sign, or after Arabic's word for minus.
 */
function negative(english: string, value: number): SentenceNumber {
  return {
    english,
    write: (language: string): string => {
      return writeCount(Math.abs(value), decimalsOf(english), language);
    },
    after: NOTHING_AFTER,
  };
}

const BEFORE_NEGATIVE: Map<string, string> = new Map<string, string>([
  ["ar", ARABIC_MINUS_WORD],
]);

function isNegative(number: SentenceNumber): boolean {
  return number.english.startsWith("-");
}

/*
 * Every number of every sentence an example draws, by its English key. A
 * number that is part of a name, a version or a code ("Reef 18.2.4",
 * "esx-03", "p95") is no number to write: it is drawn as written.
 */
const SENTENCE_NUMBERS: Record<string, Array<SentenceNumber>> = {
  "Reef 18.2.4 · 12 OSDs · 3 monitors · 8 pools": [
    count("12", 12),
    count("3", 3),
    count("8", 8),
  ],
  "node-01 · ssd · 2.1 of 3.8 TB": [count("2.1", 2.1), count("3.8", 3.8)],
  "node-03 · ssd · 2.4 of 3.8 TB": [count("2.4", 2.4), count("3.8", 3.8)],
  "node-01 · ssd · 1.9 of 3.8 TB": [count("1.9", 1.9), count("3.8", 3.8)],
  "node-02 · ssd · 2.0 of 3.8 TB": [count("2.0", 2), count("3.8", 3.8)],
  "osd.7 on node-03 is down, and 34 placement groups are degraded.": [
    count("34", 34),
  ],
  "AWS · 12 running tasks": [count("12", 12)],
  "Task · 52% CPU · 512 MB": [percent("52", 52), count("512", 512)],
  "Task · last seen 18 minutes ago": [count("18", 18)],
  "Task · 31% CPU · 380 MB": [percent("31", 31), count("380", 380)],
  "Task · 44% CPU · 610 MB": [percent("44", 44), count("610", 610)],
  "AWS · 248 resources": [count("248", 248)],
  "Last 30 days": [count("30", 30)],
  "RDS instance · CPU at 41%": [percent("41", 41)],
  "Load balancer · 6% of requests failed": [percent("6", 6)],
  "SQS queue · oldest message waiting 2 hours": [count("2", 2)],
  "0.4 s behind the primary": [count("0.4", 0.4)],
  "191 of 200 in use": [count("191", 191), count("200", 200)],
  "1.9k per second": [abbreviated("1.9k", 1900)],
  "412 GB": [count("412", 412)],
  "orders-pg is using 95% of max_connections. An alert was opened.": [
    percent("95", 95),
  ],
  "23 containers · Ubuntu 24.04": [count("23", 23)],
  "acme/worker:2.3.1 · 5 restarts": [count("5", 5)],
  "worker-queue restarted 5 times in 15 minutes.": [
    count("5", 5),
    count("15", 15),
  ],
  "Inventory within 5 minutes": [count("5", 5)],
  "3 managers · 2 workers · Docker 27.3.1": [count("3", 3), count("2", 2)],
  "Replicated · 4 of 4 running": [count("4", 4)],
  "Replicated · 2 of 3 running": [count("2", 2), count("3", 3)],
  "Replicated · 6 of 6 running": [count("6", 6)],
  "Global · 5 of 5 running": [count("5", 5)],
  "Ubuntu 22.04 · amd64 · 8 cores · 32 GB": [count("8", 8), count("32", 32)],
  "ext4 · 1.42 of 2 TB": [count("1.42", 1.42), count("2", 2)],
  "xfs · 460 of 500 GB": [count("460", 460), count("500", 500)],
  "ext4 · 61 of 120 GB": [count("61", 61), count("120", 120)],
  "ext4 · 0.4 of 1 GB": [count("0.4", 0.4), count("1", 1)],
  "/var/lib/postgresql on prod-app-01 is 92% full.": [percent("92", 92)],
  "40 devices · MQTT": [count("40", 40)],
  "87% battery · -61 dBm": [percent("87", 87), negative("-61", -61)],
  "Last seen 42 minutes ago": [count("42", 42)],
  "79% battery · -70 dBm": [percent("79", 79), negative("-70", -70)],
  "12 nodes · 248 pods · 9 namespaces": [
    count("12", 12),
    count("248", 248),
    count("9", 9),
  ],
  "Pod · production · 14 restarts": [count("14", 14)],
  "orders-sync has restarted 14 times. The on-call engineer was paged.": [
    count("14", 14),
  ],
  "14 messaging systems": [count("14", 14)],
  "Producer · 1.82M published": [abbreviated("1.82M", 1_820_000)],
  "Consumer · 48,210 behind": [count("48,210", 48_210)],
  "Consumer · 1.79M consumed": [abbreviated("1.79M", 1_790_000)],
  "fulfillment-worker is 48,210 messages behind on orders.": [
    count("48,210", 48_210),
  ],
  "2 regions · 48 hypervisors · 1,204 instances": [
    count("2", 2),
    count("48", 48),
    count("1,204", 1204),
  ],
  "14 containers · RHEL 9.4": [count("14", 14)],
  "acme/reports:1.8 · 93% memory": [percent("93", 93)],
  "report-builder has used 93% of its memory for 5 minutes.": [
    percent("93", 93),
    count("5", 5),
  ],
  "Last 24 hours": [count("24", 24)],
  "Last 7 days": [count("7", 7)],
  "Secondary on-call, after 10 minutes": [count("10", 10)],
  "Engineering manager, after 20 minutes": [count("20", 20)],
  "Last 90 days": [count("90", 90)],
  "Sunday, 02:00 to 04:00": [clock("02:00"), clock("04:00")],
  "Pick its monitors and a target, such as 99.9%": [percent("99.9", 99.9)],
  "Target 99.9% over 30 days": [percent("99.9", 99.9), count("30", 30)],
  "Database connections stayed above 90% for 5 minutes.": [
    percent("90", 90),
    count("5", 5),
  ],
  "Disk will be full in about 6 days": [count("6", 6)],
  "Proxmox VE 8.2.4 · 3 nodes · 44 guests": [count("3", 3), count("44", 44)],
  "INP 120 ms": [count("120", 120)],
  "INP 540 ms": [count("540", 540)],
  "INP 168 ms": [count("168", 168)],
  "INP 190 ms": [count("190", 190)],
  "The average INP of storefront-web rose to 512 ms.": [count("512", 512)],
  "Invocation · 182 ms": [count("182", 182)],
  "Invocation · 3.9 s": [count("3.9", 3.9)],
  "Invocation · 41 ms": [count("41", 41)],
  "Invocation · 96 ms": [count("96", 96)],
  "Purity//FA 6.7.3 · 48 volumes · 12 hosts": [
    count("48", 48),
    count("12", 12),
  ],
  "Drive · 3.8 TB": [count("3.8", 3.8)],
  "Collected every 2 minutes": [count("2", 2)],
  "The fullest datastore at a glance, with warnings at 80% and 90%.": [
    percent("80", 80),
    percent("90", 90),
  ],
  "2 clusters · 8 ESXi hosts · 156 VMs": [
    count("2", 2),
    count("8", 8),
    count("156", 156),
  ],
  "VM · esx-03 · CPU ready 12.4%": [percent("12.4", 12.4)],
  "analytics-etl-02 waited for a CPU 12.4% of the time on esx-03.": [
    percent("12.4", 12.4),
  ],
};

// The sentences whose digits are all a name's, a version's or a code's.
const CODES_ONLY: Array<string> = [
  "Requests, error rate and p95 latency for each app, CPU and memory for its instances.",
  "EC2 instance · could be a size smaller",
  "Queries, error rate and p95 latency, as the apps that call each database see them.",
  "PostgreSQL 16.4 · Kubernetes · prod-us-east",
  "p95 latency",
  "A billing_worker task stopped running on worker-2.",
  "Load (1m)",
  "sensor-017 in building-a-sensors stopped reporting.",
  "Every service that publishes to a queue or consumes from it, with its own counts, errors and p95.",
  "Messages published and consumed, errors and p95 processing time, over time.",
  "Apache Kafka · kafka-1:9092",
  "p95 processing",
  "compute-07 · RegionOne",
  "Instance · payments · compute-03",
  "compute-01 · RegionTwo",
  "storage-01 · RegionOne",
  "Run one agent per cluster with a read-only API token, or use Proxmox VE 9's native push. Nodes, guests, storage, backups and replication show up on their own.",
  "VM 101 · pve1",
  "VM 105 · pve3 · starts on boot",
  "VM 102 · pve2",
  "LXC 201 · pve3",
  "ci-runner (VM 105) stopped on pve3, though it is set to start on boot.",
  "p95 load time",
  "Page load time (p95)",
  "Invocations, error rate and p95 duration for every function, over time.",
  "aws_lambda · us-east-1 · nodejs 20",
  "p95 duration",
  "CH0.BAY7 on fa-prod-01 has failed.",
  "VM · esx-01",
  "VM · esx-02",
  "VM · esx-04",
];

// A number a language says as a word: [key, language, the English number].
const WRITTEN_AS_A_WORD: Array<[string, string, string]> = [
  ["SQS queue · oldest message waiting 2 hours", "ar", "2"],
  ["worker-queue restarted 5 times in 15 minutes.", "ar", "5"],
  ["2 regions · 48 hypervisors · 1,204 instances", "ar", "2"],
  ["Collected every 2 minutes", "ar", "2"],
  ["2 clusters · 8 ESXi hosts · 156 VMs", "ar", "2"],
];

/*
 * A number a language writes where the English says a word, in the
 * language's own digits as its other numbers: Japanese counts "one agent"
 * as "1 つ", Korean says "secondary" as "2차". [key, language, the number].
 */
const WRITTEN_AS_A_NUMBER: Array<[string, string, number]> = [
  ["EC2 instance · could be a size smaller", "ja", 1],
  [
    "Run one agent per cluster with a read-only API token, or use Proxmox VE 9's native push. Nodes, guests, storage, backups and replication show up on their own.",
    "ja",
    1,
  ],
  ["Secondary on-call, after 10 minutes", "ko", 2],
];

// The pattern that finds `number` in a sentence of `language`.
function patternOf(number: SentenceNumber, language: string): RegExp {
  const before: string = isNegative(number)
    ? BEFORE_NEGATIVE.get(language) || MINUS_SIGN_BEFORE
    : NUMBER_BEFORE;

  return new RegExp(
    `${before}${escapeRegExp(number.write(language))}${number.after(
      language,
    )}${NUMBER_AFTER}`,
    "gu",
  );
}

// The English number's own pattern in its key.
function englishPatternOf(number: SentenceNumber): RegExp {
  return new RegExp(
    `${NUMBER_BEFORE}${escapeRegExp(number.english)}${NUMBER_AFTER}`,
    "gu",
  );
}

function isWrittenAsAWord(
  key: string,
  language: string,
  number: SentenceNumber,
): boolean {
  return WRITTEN_AS_A_WORD.some(
    ([wordKey, wordLanguage, english]: [string, string, string]): boolean => {
      return (
        wordKey === key &&
        wordLanguage === language &&
        english === number.english
      );
    },
  );
}

function digitRuns(text: string): Array<string> {
  return (text.match(DIGIT_RUN_PATTERN) || []).sort();
}

// The digits left in the English key once its numbers are taken out: codes.
function getEnglishCodes(key: string): Array<string> {
  let left: string = key;

  for (const number of SENTENCE_NUMBERS[key] || []) {
    left = left.replace(englishPatternOf(number), " ");
  }

  return digitRuns(left);
}

/*
 * What is wrong with `language`'s `sentence` for the English `key`: a
 * number not written the language's way, or one written another way.
 */
function getSentenceProblems(
  key: string,
  language: string,
  sentence: string,
): Array<string> {
  const problems: Array<string> = [];
  let left: string = sentence;

  const numbers: Array<SentenceNumber> = [
    ...(SENTENCE_NUMBERS[key] || []),
    ...WRITTEN_AS_A_NUMBER.filter(
      ([numberKey, numberLanguage]: [string, string, number]): boolean => {
        return numberKey === key && numberLanguage === language;
      },
    ).map(([, , value]: [string, string, number]): SentenceNumber => {
      return count(String(value), value);
    }),
  ];

  for (const number of numbers) {
    if (isWrittenAsAWord(key, language, number)) {
      continue;
    }

    const pattern: RegExp = patternOf(number, language);

    if (!pattern.test(left)) {
      problems.push(
        `${language} ${JSON.stringify(sentence)}: no ${JSON.stringify(
          number.write(language),
        )} for ${number.english}`,
      );
    }

    left = left.replace(patternOf(number, language), " ");
  }

  const codes: Array<string> = getEnglishCodes(key);
  const others: Array<string> = digitRuns(left);

  if (JSON.stringify(others) !== JSON.stringify(codes)) {
    problems.push(
      `${language} ${JSON.stringify(sentence)}: numbers ${JSON.stringify(
        others,
      )}, but only the codes ${JSON.stringify(codes)} are written as text`,
    );
  }

  return problems;
}

// The words a showcase draws, each an English translation key.
function getDrawnWords(showcase: ResourceShowcase): Array<string> {
  return [
    showcase.eyebrow,
    showcase.title,
    showcase.description,
    ...showcase.highlights,
    ...(showcase.steps || []),
    ...showcase.features.flatMap((feature: ShowcaseFeature): Array<string> => {
      return [feature.title, feature.description];
    }),
    showcase.preview.subtitle,
    ...(showcase.preview.badge ? [showcase.preview.badge] : []),
    ...(showcase.preview.description ? [showcase.preview.description] : []),
    ...showcase.preview.stats.map((stat: ShowcaseStat): string => {
      return stat.label;
    }),
    showcase.preview.chart.label,
    ...(showcase.preview.chart.range ? [showcase.preview.chart.range] : []),
    ...showcase.preview.rows.flatMap((row: ShowcaseRow): Array<string> => {
      return isShowcaseFigure(row.statusText)
        ? [row.detail]
        : [row.detail, row.statusText];
    }),
    ...(showcase.preview.alert
      ? [showcase.preview.alert.title, showcase.preview.alert.description]
      : []),
  ];
}

const SHOWCASES: Array<ResourceShowcase> = [
  ...Object.values(PRODUCT_ONBOARDINGS).map(
    (onboarding: ProductOnboarding): ResourceShowcase => {
      return onboarding.showcase;
    },
  ),
  CEPH_CLUSTER_SHOWCASE,
  CLOUD_ENVIRONMENT_SHOWCASE,
  CLOUD_SHOWCASE,
  DATABASE_SHOWCASE,
  DOCKER_HOST_SHOWCASE,
  DOCKER_SWARM_CLUSTER_SHOWCASE,
  HOST_SHOWCASE,
  IOT_FLEET_SHOWCASE,
  KUBERNETES_CLUSTER_SHOWCASE,
  MESSAGE_QUEUE_SHOWCASE,
  OPENSTACK_CLOUD_SHOWCASE,
  PODMAN_HOST_SHOWCASE,
  PROXMOX_CLUSTER_SHOWCASE,
  RUM_APPLICATION_SHOWCASE,
  SERVERLESS_FUNCTION_SHOWCASE,
  STORAGE_ARRAY_SHOWCASE,
  VMWARE_VCENTER_SHOWCASE,
];

const DIGIT_PATTERN: RegExp = /\d/;

// A container image, "postgres:16": a name no language translates.
const IMAGE_NAME_PATTERN: RegExp = /^[a-z0-9./-]+:[a-z0-9.-]+$/;

const DRAWN_WITH_DIGITS: Array<string> = [
  ...new Set<string>(
    SHOWCASES.flatMap((showcase: ResourceShowcase): Array<string> => {
      return getDrawnWords(showcase);
    }).filter((word: string): boolean => {
      return DIGIT_PATTERN.test(word);
    }),
  ),
].sort();

// The English keys among them: a sentence each language translates.
const TRANSLATED_WITH_DIGITS: Array<string> = DRAWN_WITH_DIGITS.filter(
  (word: string): boolean => {
    return localeOf("en")[word] !== undefined;
  },
);

const LISTED: Array<string> = [
  ...Object.keys(SENTENCE_NUMBERS),
  ...CODES_ONLY,
].sort();

describe("the list of an example's sentence numbers is the whole of them", () => {
  test("every sentence an example draws with a digit is listed, and every listed one is drawn", () => {
    expect(TRANSLATED_WITH_DIGITS.length).toBeGreaterThan(100);
    expect(LISTED).toEqual(TRANSLATED_WITH_DIGITS);
  });

  test("what an example draws with a digit and no locale holds is an image's name, drawn as written", () => {
    const untranslated: Array<string> = DRAWN_WITH_DIGITS.filter(
      (word: string): boolean => {
        return !TRANSLATED_WITH_DIGITS.includes(word);
      },
    );

    expect(untranslated).toContain("postgres:16");
    for (const word of untranslated) {
      expect({ word, image: IMAGE_NAME_PATTERN.test(word) }).toEqual({
        word,
        image: true,
      });
    }
  });

  test("each English number is in its sentence as listed, and is no code", () => {
    for (const [key, numbers] of Object.entries(SENTENCE_NUMBERS)) {
      expect({ key, numbers: numbers.length }).not.toEqual({
        key,
        numbers: 0,
      });

      for (const number of numbers) {
        expect({
          key,
          number: number.english,
          found: englishPatternOf(number).test(key),
        }).toEqual({ key, number: number.english, found: true });
      }
    }

    for (const key of CODES_ONLY) {
      expect(SENTENCE_NUMBERS[key]).toBeUndefined();
    }
  });

  test("every language's sentence is in its locale file", () => {
    const missing: Array<string> = [];

    for (const language of LANGUAGES) {
      for (const key of LISTED) {
        if (!localeOf(language)[key]) {
          missing.push(`${language}: ${key}`);
        }
      }
    }

    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);
    expect(missing).toEqual([]);
  });
});

describe("each language writes an example's sentence numbers its own way", () => {
  test.each(LANGUAGES)(
    "%s: every number as the language writes it, and no other number but a code",
    (language: string) => {
      const problems: Array<string> = [];

      for (const key of LISTED) {
        const sentence: string | undefined = localeOf(language)[key];

        if (sentence) {
          problems.push(...getSentenceProblems(key, language, sentence));
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("German writes the point between thousands and the comma as its decimal sign", () => {
    const german: Record<string, string> = localeOf("de");

    expect(german["Consumer · 48,210 behind"]).toContain("48.210");
    expect(german["Consumer · 48,210 behind"]).not.toContain("48,210");
    expect(german["node-02 · ssd · 2.0 of 3.8 TB"]).toContain("2,0");
    expect(german["node-02 · ssd · 2.0 of 3.8 TB"]).toContain("3,8");
    expect(german["Target 99.9% over 30 days"]).toContain("99,9");
  });

  test("a large count reads as the tiles beside it abbreviate it", () => {
    expect(localeOf("de")["Producer · 1.82M published"]).toContain(
      formatShowcaseFigure({ abbreviated: 1_820_000 }, translatorFor("de")),
    );
    expect(localeOf("ja")["Producer · 1.82M published"]).toContain("182万");
    expect(localeOf("fa")["Producer · 1.82M published"]).toContain(
      formatShowcaseFigure({ abbreviated: 1_820_000 }, translatorFor("fa")),
    );
  });

  test("Persian writes its own digits, its own percent sign and its own clock", () => {
    const persian: Record<string, string> = localeOf("fa");

    expect(persian["Task · 52% CPU · 512 MB"]).toContain("۵۲٪");
    expect(persian["Task · 52% CPU · 512 MB"]).toContain("۵۱۲");
    expect(persian["Sunday, 02:00 to 04:00"]).toContain("۰۲:۰۰");
    expect(persian["Consumer · 48,210 behind"]).toContain("۴۸٬۲۱۰");
    // A code stays as the software writes it.
    expect(persian["VM · esx-03 · CPU ready 12.4%"]).toContain("esx-03");
    expect(persian["VM · esx-03 · CPU ready 12.4%"]).toContain("۱۲٫۴٪");
  });

  test("a sentence's count is the one the tiles write: the product's own formatter", () => {
    const mismatches: Array<string> = [];

    for (const language of LANGUAGES) {
      const translator: Translator = translatorFor(language);

      for (const numbers of Object.values(SENTENCE_NUMBERS)) {
        for (const number of numbers) {
          const value: number = Number(number.english.replace(/,/g, ""));

          if (
            !Number.isInteger(value) ||
            decimalsOf(number.english) > 0 ||
            isNegative(number)
          ) {
            continue;
          }

          if (number.write(language) !== translator.formatNumber(value)) {
            mismatches.push(
              `${language} ${number.english}: ${number.write(
                language,
              )} != ${translator.formatNumber(value)}`,
            );
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe("the check finds a number written the English way", () => {
  test("a German thousands comma, a Persian Latin digit and a changed code are each found", () => {
    expect(
      getSentenceProblems(
        "Consumer · 48,210 behind",
        "de",
        "Consumer · 48,210 im Rückstand",
      ).length,
    ).toBe(2);
    expect(
      getSentenceProblems(
        "Consumer · 48,210 behind",
        "de",
        "Consumer · 48.210 im Rückstand",
      ),
    ).toEqual([]);
    expect(
      getSentenceProblems(
        "Task · 52% CPU · 512 MB",
        "fa",
        "تسک · 52% CPU · ۵۱۲ MB",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      getSentenceProblems(
        "VM · esx-03 · CPU ready 12.4%",
        "fa",
        "VM · esx-۰۳ · CPU ready ۱۲٫۴٪",
      ).length,
    ).toBe(1);
    expect(
      getSentenceProblems(
        "Sunday, 02:00 to 04:00",
        "fa",
        "یکشنبه، 02:00 تا ۰۴:۰۰",
      ).length,
    ).toBeGreaterThan(0);
  });

  test("a percent keeps its sign, and a negative its minus", () => {
    expect(
      getSentenceProblems(
        "RDS instance · CPU at 41%",
        "de",
        "RDS · CPU bei 41",
      ),
    ).not.toEqual([]);
    expect(
      getSentenceProblems("87% battery · -61 dBm", "de", "87% Akku · 61 dBm"),
    ).not.toEqual([]);
    expect(
      getSentenceProblems("87% battery · -61 dBm", "de", "87 % Akku · -61 dBm"),
    ).toEqual([]);
  });

  test("a number Arabic says as a word is no number left over; written as digits it would be one", () => {
    const arabic: string =
      localeOf("ar")["SQS queue · oldest message waiting 2 hours"] || "";

    expect(
      getSentenceProblems(
        "SQS queue · oldest message waiting 2 hours",
        "ar",
        arabic,
      ),
    ).toEqual([]);
    expect(
      getSentenceProblems(
        "SQS queue · oldest message waiting 2 hours",
        "ar",
        `${arabic} 2`,
      ),
    ).not.toEqual([]);
  });
});
