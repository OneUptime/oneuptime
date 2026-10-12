import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsContainerUse,
  DocsFence,
  DocsHeading,
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  drawnCreateButton,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import {
  PATH_SEPARATOR,
  PERSIAN_PATH_SEPARATOR,
  anchorInLanguage,
  drawnNetworkLabel,
  drawnPath,
} from "./NetworkDocsLabels";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul tasks 21 and 22: the Infrastructure Agents pages (the host
 * OpenTelemetry Collector, the Kubernetes agent and its cost observability,
 * the Docker, Podman, Proxmox, Ceph, Storage Array, Docker Swarm and VMware
 * agents, IoT devices, Databases, Queues and Serverless Functions) in every
 * docs language. Each translation says what the English page says:
 *
 *   - line for line: the same number of lines, with each heading, table row
 *     and code fence on the English one's line, so the two can be laid side
 *     by side and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code,
 *     tables (and the numbers in them), lists, steps, tabs and cards, and
 *     links that land on a heading in the reader's language;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - the product named the way that language's product draws it.
 *
 * "The way the product draws it", on these pages:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel), and a create button is
 *     drawn as its table draws it (drawnCreateButton).
 *   - A menu path is drawn segment by segment: one bold span with " → "
 *     between the segments, or, in Persian, a bold span per segment with
 *     " > " between them. A product opened from the Products menu, and its
 *     category there, are drawn as that menu draws them (navbar.items and
 *     navbar.categories), and a table's create button as the table draws
 *     it (drawnMenuPath).
 *   - What every Dashboard shows in English stays English: alert template
 *     names and labels with no locale key (SHOWN_IN_ENGLISH); so do
 *     permission names (PERMISSIONS), the labels of another product's
 *     console (OTHER_CONSOLES), messages the agents log (SERVER_MESSAGES)
 *     and names of products, components, setting values and answers
 *     (NAMES).
 *
 * The pages' own bold leads are PROSE_LEADS, and labels that are prose
 * where these pages use them are PROSE: a translation words both freely. A
 * new bold word on these English pages fails "know every bold word" until it
 * is in one of the lists.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const HOST: string = "telemetry/host-otel-collector";
const KUBERNETES: string = "telemetry/kubernetes-agent";
const COST: string = "telemetry/kubernetes-cost";
const DOCKER: string = "telemetry/docker-host";
const IOT: string = "telemetry/iot-devices";
const PODMAN: string = "telemetry/podman-host";
const PROXMOX: string = "telemetry/proxmox";
const CEPH: string = "telemetry/ceph";
const STORAGE_ARRAYS: string = "telemetry/storage-arrays";
const DOCKER_SWARM: string = "telemetry/docker-swarm";
const VMWARE: string = "telemetry/vmware";
const DATABASES: string = "telemetry/databases";
const QUEUES: string = "telemetry/queues";
const SERVERLESS: string = "telemetry/serverless-functions";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: HOST, navTitle: "Host OpenTelemetry Collector" },
  { page: KUBERNETES, navTitle: "Kubernetes Agent" },
  { page: COST, navTitle: "Kubernetes Cost Observability" },
  { page: DOCKER, navTitle: "Docker Agent" },
  { page: IOT, navTitle: "IoT Devices" },
  { page: PODMAN, navTitle: "Podman Agent" },
  { page: PROXMOX, navTitle: "Proxmox Agent" },
  // Docs overhaul task 22.
  { page: CEPH, navTitle: "Ceph Agent" },
  { page: STORAGE_ARRAYS, navTitle: "Storage Array Agent" },
  { page: DOCKER_SWARM, navTitle: "Docker Swarm Agent" },
  { page: VMWARE, navTitle: "VMware Agent" },
  { page: DATABASES, navTitle: "Databases" },
  { page: QUEUES, navTitle: "Queues" },
  { page: SERVERLESS, navTitle: "Serverless Functions" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  /*
   * The project switch the AI agent's upgrade note names, as it was named:
   * it no longer exists, so no locale has it.
   */
  [KUBERNETES]: ["Enable AI Command Execution", "Pilot"],
  // The dashboard template's name, from the template catalog.
  [COST]: ["Kubernetes Cost Dashboard"],
  // Alert template names: the templates are created with English names.
  [PROXMOX]: [
    "HA Resource in Error State",
    "Guest Down",
    "Guest Not Backed Up",
    "Replication Failing",
    "Node Offline",
    "Cluster Quorum at Risk",
  ],
  /*
   * The pod and container pages' link to a database (OPEN_DATABASE_LABEL),
   * a recommended monitor's template name, and two of the Overview's
   * engine charts, which their metric catalog titles in English.
   */
  [DATABASES]: [
    "Open database",
    "Engine Metrics Stopped",
    "Row operations",
    "Handler operations",
  ],
};

// Permission names, which the docs write as the product names them, in English.
const PERMISSIONS: Record<string, Array<string>> = {
  [KUBERNETES]: ["Edit Auto Remediation Rule"],
};

/*
 * Labels of another product's console, which the page names as that
 * console does: the Proxmox web UI, the vSphere Client, the FlashArray GUI
 * and Azure's role names.
 */
const OTHER_CONSOLES: Record<string, Array<string>> = {
  [PROXMOX]: [
    "Add",
    "Privilege Separation",
    "API Token Permission",
    "User Permission",
  ],
  [VMWARE]: ["Read-Only", "Add", "Permissions", "Propagate to children"],
  [STORAGE_ARRAYS]: [
    "readonly",
    "Users",
    "Create User…",
    "Create API Token…",
    "Expires In",
  ],
  [SERVERLESS]: ["Key Vault Secrets User"],
  // A CloudWatch Metric Stream's output formats, and Azure's and Google Cloud's roles.
  [QUEUES]: [
    "OpenTelemetry 1.0",
    "JSON",
    "Monitoring Reader",
    "Monitoring Viewer",
  ],
};

// What an agent writes to its log, quoted as it is written.
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [KUBERNETES]: [
    '"This OneUptime server does not have the Kubernetes AI agent API"',
  ],
};

/*
 * Names kept as written: platforms, components, products, the ⋯ menu, the
 * values of a setting, an answer to a prompt, and operating systems.
 */
const NAMES: Record<string, Array<string>> = {
  [HOST]: ["Linux:", "Windows:", "macOS:"],
  [KUBERNETES]: [
    "EKS on EC2",
    "GKE Standard",
    "AKS",
    "GKE Autopilot",
    "EKS Fargate",
    "etcd",
    "CoreDNS",
    "kube-proxy",
    "Cilium",
    "istiod",
    "⋯",
    "ask-for-approval",
    "automatic",
    "bypass-approval",
  ],
  [COST]: ["OpenCost"],
  [PROXMOX]: ["PVEAuditor", "n"],
  [VMWARE]: ["vCenter Server"],
  [STORAGE_ARRAYS]: [
    "Pure Storage FlashArray",
    "Pure Storage FlashBlade",
    "Everpure",
  ],
  [DATABASES]: [
    "PostgreSQL",
    "MySQL / MariaDB",
    "SQL Server",
    "Oracle",
    "Redis / Valkey / KeyDB / Dragonfly",
    "MongoDB",
    "Elasticsearch / OpenSearch",
    "Memcached",
    "Docker / Podman",
    "Database Agent",
  ],
  [QUEUES]: [
    "Azure Service Bus",
    "Azure Event Hubs",
    "JMS",
    "Apache ActiveMQ",
    "Google Cloud Pub/Sub",
    "RabbitMQ.Client",
    "MassTransit",
    "Confluent.Kafka",
    "BullMQ",
    "Kafka",
  ],
  [SERVERLESS]: [
    "C# (isolated worker)",
    "JavaScript / TypeScript",
    "Java",
    "Python",
    "PowerShell",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * these pages use them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  // "The agent is **on by default** and **read-only**": the stress.
  [KUBERNETES]: ["read-only"],
  // "It is **read-only** unless you set ...": the stress.
  [CEPH]: ["read-only"],
  [VMWARE]: ["read-only"],
  [DATABASES]: ["read-only"],
  // The third of the three containers, "**AI agent**: oneuptime-docker-swarm-ai-agent".
  [DOCKER_SWARM]: ["AI agent", "read-only"],
  // "the identity also holds the **namespace**": the stress.
  [QUEUES]: ["namespace"],
  // The two concepts the page defines, "**Fleet**: a group of devices".
  [IOT]: ["Fleet", "Device"],
};

/*
 * The bold leads of the pages' own lists and sentences: neither Dashboard
 * labels nor shown in English, so a translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [HOST]: ["AI investigations are on by default."],
  [KUBERNETES]: [
    "AI investigations are on by default.",
    "You get whole traces, not fragments.",
    "Your metric-based monitors do not move.",
    "Your span-based monitors do.",
    "The scheduler",
    "the controller manager",
    "A request and its calls form one trace.",
    "A call to a service on another node starts a new trace",
    "Work that no request started stands alone.",
    "Database servers usually stand alone.",
    "on by default",
    "What the write access amounts to.",
    "A refusal that clears on its own",
    "A refusal that needs you",
    "eBPF span metrics have new names.",
    "Self-hosted OneUptime: upgrade the OneUptime server first.",
    "The upgrade adds a pod that pulls `docker.io/oneuptime/kubernetes-ai-agent`.",
    "At the receiver",
    "At the filter processor",
    "At the sampler",
    "The kernel is too old, or has no BTF.",
    "Privileged pods are refused.",
    "`debugfs` or `tracefs` is not mounted on the host.",
  ],
  [COST]: ["A small Prometheus", "The cost poller", "A cost metrics scrape"],
  [DOCKER]: [
    "AI investigations are on by default",
    "AI investigations are on by default.",
  ],
  [IOT]: ["With the ingestion key", "With a credential per device"],
  [PODMAN]: [
    "AI investigations are on by default",
    "AI investigations are on by default.",
  ],
  [PROXMOX]: ["AI investigations are on by default."],
  [CEPH]: [
    "Every mgr, every 30 seconds.",
    "`honor_labels: true`.",
    "`ceph-exporter` (Reef 18.2 and later).",
    "`node_exporter`.",
    "AI investigations are on by default.",
    "Its own Ceph client is the hard limit.",
  ],
  [DOCKER_SWARM]: [
    "Collector",
    "Inventory poller",
    "manager",
    "AI investigations are on by default.",
    "must run on a manager node",
  ],
  [VMWARE]: [
    "standalone ESXi host",
    "without",
    "resource attributes",
    "datapoint attributes",
    "only for powered-on VMs",
    "whole collection at a time",
    "AI investigations are on by default.",
    "The vSphere role is the hard limit.",
    "not",
  ],
  [STORAGE_ARRAYS]: [
    "without an expiry",
    "Purity//FA 6.7.0 and later",
    "One scrape job per endpoint, each read as often as it is worth.",
    "Every job labels its series `scrape_endpoint: <endpoint>`.",
    "Per-volume and per-host latency keeps three dimensions.",
    "The API token is a Bearer token.",
    "No `send_batch_max_size`.",
    "datapoint labels",
  ],
  [SERVERLESS]: [
    "yes",
    "Function App",
    "one Serverless Function per Function App",
    "C# in-process apps",
    "Log streaming",
    "error rate",
  ],
  [DATABASES]: [
    "Application traces",
    "family",
    "Created from traces",
    "created",
    "Clusters and host lists.",
    "Operator and chart labels first",
    "Container images otherwise",
    "no",
    "One agent monitors one database server.",
    "applications",
    "AI investigations are on by default.",
    "The login is the hard limit",
    "Every batch must name the server.",
    "Keep `service.name` off the resource.",
    "Name the server your applications use.",
    "One owner.",
    "Adding or removing an alias is an edit.",
    "Merging two databases that are one server.",
    "Canonical forms.",
    "SQL Server named instances.",
    "Local-only names never identify a database.",
    "Names that only resolve inside one network",
    "Calls from Kubernetes carry their cluster.",
    "Naming the cluster yourself.",
    "Engine-agnostic.",
    "Discovered endpoints move on.",
    "By id.",
    "By endpoint.",
    "Archive to dismiss.",
    "archive",
    "Databases created for a client's port.",
    "Automatic archiving.",
    "Restoring.",
    "Retention.",
    "receiver batches that do not name their server are ignored",
  ],
  [QUEUES]: [
    "Application traces",
    "Broker metrics",
    "The system",
    "The destination",
    "The direction",
    "created",
    "system",
    "destination",
    "JMS and ActiveMQ are one family.",
    "SERVER spans",
    "Destinations marked temporary or anonymous",
    "Placeholders instrumentations report instead of a name",
    "Generated and reply destinations",
    "SNS text messages and mobile push",
    "Names that cannot be one queue",
    "UUIDs are templated.",
    "Archive to dismiss.",
    "archive",
    "Automatic archiving.",
    "Restoring.",
    "Azure Service Bus and Event Hubs",
    "Amazon SQS and SNS",
    "Polling CloudWatch",
    "Leave `stats` unset.",
    "Late metrics",
    "Streaming",
    "From the queue's page.",
    "Counters.",
    "By hand",
    "Late metrics.",
    "Same-named destinations on two clusters or accounts are one queue.",
    "Kafka clients on Event Hubs are Kafka.",
    "Service Bus spans without a namespace host key apart.",
    "RabbitMQ spans usually name exchanges; the broker's metrics name queues.",
    "Pub/Sub publishers name topics; subscribers name subscriptions.",
    "Pulsar's per-consumer series are left out of charts",
    "Azure Storage Queues have no per-queue metrics.",
    "RocketMQ's retry and system topics are not filtered out of broker metrics.",
  ],
};

// Create buttons, drawn as their table draws them.
const CREATE_BUTTONS: Array<string> = [
  "Create Dashboard",
  "Create Database",
  "Create Queue",
];

// Tab labels are names (platforms, presets, install methods), the same in every language.
const TAB_LINE: RegExp = /^@tab\s+(.+)$/;

const ONLY_CODE: RegExp = /^`[^`]+`$/;
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
/*
 * A number as a table states it: 85, 76.5, 32,768. A translation may write
 * its language's decimal mark or digit group: 76,5, ۷۶٫۵, 32 768, 32.768.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const DIGIT_GROUP: RegExp = /(\d)[\s\u00a0\u202f.,'\u066c](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,\u066b](\d)/g;

// A line that starts a list item, a table row, a heading, a component, an image or a quote.
const NOT_PARAGRAPH_TEXT: RegExp = /^\s*(?:[-*>|#:@]|\d+\.|!\[)/;

function englishPage(page: string): string {
  return readPage("en", page);
}

// Whether a line is a paragraph's text, which a paragraph's next line would wrap.
function isParagraphText(line: string): boolean {
  return line.trim().length > 0 && !NOT_PARAGRAPH_TEXT.test(line);
}

function isPath(span: string): boolean {
  return span.includes(PATH_SEPARATOR);
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !isPath(span);
  });
}

// The bold spans of a page that are a path of labels.
function menuPaths(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter(isPath);
}

function segmentsOf(path: string): Array<string> {
  return path.split(PATH_SEPARATOR).map((segment: string): string => {
    return segment.trim();
  });
}

function listed(
  lists: Record<string, Array<string>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

// Whether a bold English label is named by the drawn label of a translation.
function isDrawnLabel(english: string): boolean {
  return isActionLabel(english) || CREATE_BUTTONS.includes(english);
}

// What a page in a language writes, in bold, for a label the English page writes in bold.
function drawnLabel(language: string, english: string): string {
  if (CREATE_BUTTONS.includes(english)) {
    return drawnCreateButton(language, english);
  }

  return drawnActionLabel(language, english);
}

/*
 * The Products menu: a product in it, and the product's category there,
 * are drawn from the Dashboard's navbar.items and navbar.categories keys
 * (Utils/NavigationItems), which can differ from the flat key of the same
 * English words: Dutch draws the Resources category "Bronnen", Russian the
 * Databases product "Базы данных", and every language draws Storage Arrays
 * in English there.
 */
const PRODUCTS_MENU: string = "Products";

type NavbarGroup = "categories" | "items";

// The navbar keys of a group, by the English title they hold.
function navbarKeys(group: NavbarGroup): Record<string, string> {
  const navbar: Record<string, Record<string, string>> = dashboardLocale("en")[
    "navbar"
  ] as Record<string, Record<string, string>>;
  const keys: Record<string, string> = {};

  for (const [key, title] of Object.entries(navbar[group] || {})) {
    if (group === "items" && !key.endsWith("Title")) {
      continue;
    }

    keys[title] = keys[title] || key;
  }

  return keys;
}

const MENU_CATEGORY_KEYS: Record<string, string> = navbarKeys("categories");
const MENU_ITEM_KEYS: Record<string, string> = navbarKeys("items");

// A navbar key's value in a language, or null when the locale has none.
function navbarValue(
  language: string,
  group: NavbarGroup,
  key: string,
): string | null {
  const navbar: Record<string, Record<string, unknown>> | undefined =
    dashboardLocale(language)["navbar"] as
      | Record<string, Record<string, unknown>>
      | undefined;
  const value: unknown = navbar?.[group]?.[key];

  return typeof value === "string" && value.trim() ? value : null;
}

/*
 * One segment of a menu path as a language draws it: a create button as
 * its table draws it, a Products menu category and product as that menu
 * draws them, and every other segment as the flat locale key.
 */
function drawnMenuSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;

  if (CREATE_BUTTONS.includes(segment)) {
    return drawnCreateButton(language, segment);
  }

  if (segments[0] === PRODUCTS_MENU && index > 0) {
    const categoryKey: string | undefined = MENU_CATEGORY_KEYS[segment];

    if (index === 1 && categoryKey) {
      return (
        navbarValue(language, "categories", categoryKey) ||
        drawnNetworkLabel(language, segment)
      );
    }

    const productIndex: number = MENU_CATEGORY_KEYS[segments[1] as string]
      ? 2
      : 1;
    const itemKey: string | undefined = MENU_ITEM_KEYS[segment];

    if (index === productIndex && itemKey) {
      return (
        navbarValue(language, "items", itemKey) ||
        drawnNetworkLabel(language, segment)
      );
    }
  }

  return drawnNetworkLabel(language, segment);
}

// A menu path as a page in a language writes it.
function drawnMenuPath(language: string, segments: Array<string>): string {
  const drawn: Array<string> = segments.map(
    (_segment: string, index: number): string => {
      return drawnMenuSegment(language, segments, index);
    },
  );

  if (language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
}

// The labels a page keeps as the English page writes them.
function keptAsWritten(page: string): Array<string> {
  return [
    ...listed(PROSE, page),
    ...listed(OTHER_CONSOLES, page),
    ...listed(NAMES, page),
    ...listed(PERMISSIONS, page),
    ...listed(SHOWN_IN_ENGLISH, page),
    ...listed(SERVER_MESSAGES, page),
  ];
}

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it.
 */
function unbalancedLines(markdown: string): Array<string> {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      const ticks: number = line.split("`").length - 1;
      const outsideCode: string = line.replace(INLINE_CODE_SPAN, "");
      const stars: number = outsideCode.split("**").length - 1;

      return ticks % 2 !== 0 || stars % 2 !== 0;
    });
}

// The number of :::steps steps on a page: the H3s inside its steps blocks.
function stepCount(markdown: string): number {
  let depth: number = 0;
  let inFence: boolean = false;
  let steps: number = 0;
  const open: Array<string> = [];

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const trimmed: string = line.trim();

    if (trimmed.startsWith(":::") && trimmed !== ":::") {
      open.push(trimmed.slice(3).split(/\s/)[0] as string);
      depth += trimmed === ":::steps" ? 1 : 0;
      continue;
    }

    if (trimmed === ":::") {
      const closed: string | undefined = open.pop();
      depth -= closed === "steps" ? 1 : 0;
      continue;
    }

    if (depth > 0 && line.startsWith("### ")) {
      steps++;
    }
  }

  return steps;
}

/*
 * What each line is, where it matters for laying a translation beside its
 * English page: a heading of a level, a table row, a fence, or text.
 */
function lineShape(markdown: string): Array<string> {
  return markdown.split("\n").map((line: string): string => {
    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (FENCE_LINE.test(line)) {
      return "```";
    }

    if (heading) {
      return heading[1] as string;
    }

    if (line.startsWith("|")) {
      return "|";
    }

    return "";
  });
}

// Every table of a page, in order, as rows of trimmed cells (header first).
function tables(markdown: string): Array<Array<Array<string>>> {
  const found: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of prose(markdown).split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }

    if (!current) {
      current = [];
      found.push(current);
    }

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    current.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return found;
}

function numbersIn(text: string): Array<string> {
  return Array.from(
    toLatinDigits(text)
      .replace(DIGIT_GROUP, "$1$2")
      .replace(DECIMAL_MARK, "$1.$2")
      .matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

function tabLabels(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(TAB_LINE);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    });
}

function containersOf(markdown: string): Array<string> {
  return scanMarkdown(markdown).containers.map(
    (container: DocsContainerUse): string => {
      return container.name;
    },
  );
}

function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
}

/*
 * Links into these pages from other pages, translated before them: in every
 * language they name the heading in the English section's place.
 */
const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    // A node the native push reports offline.
    from: "monitor/proxmox-monitor",
    to: PROXMOX,
    anchor: "when-a-node-stops-reporting",
  },
  {
    from: "monitor/kubernetes-agent",
    to: KUBERNETES,
    anchor: "filtering-by-log-severity",
  },
  {
    // The aiAgent.enabled row of the chart's common options.
    from: "monitor/kubernetes-agent",
    to: KUBERNETES,
    anchor: "kubernetes-ai-agent",
  },
  {
    from: "monitor/iot-device-monitor",
    to: IOT,
    anchor: "sending-metrics-via-mqtt",
  },
  { from: "monitor/iot-device-monitor", to: IOT, anchor: "metric-conventions" },
  {
    // The upgrade notes' Kubernetes AI agent upgrade.
    from: "installation/upgrading",
    to: KUBERNETES,
    anchor: "upgrading-the-agent",
  },
  // Docs overhaul task 22.
  {
    // The probe-collected vCenter needs the same read-only user.
    from: "telemetry/vmware-agentless",
    to: VMWARE,
    anchor: "create-the-read-only-vsphere-user",
  },
  {
    // Where a VMware monitor's data starts flowing.
    from: "monitor/vmware-monitor",
    to: VMWARE,
    anchor: "verify-the-installation",
  },
  { from: "ai/infrastructure-ai-agents", to: DOCKER_SWARM, anchor: "ai-agent" },
  { from: "ai/infrastructure-ai-agents", to: VMWARE, anchor: "ai-agent" },
  { from: "ai/infrastructure-ai-agents", to: CEPH, anchor: "ai-agent" },
  { from: "ai/infrastructure-ai-agents", to: DATABASES, anchor: "ai-agent" },
  {
    // A Database Health monitor's alerts land on the database.
    from: "monitor/database-health-monitor",
    to: DATABASES,
    anchor: "alerts-on-a-database",
  },
  { from: "monitor/sql-monitor", to: DATABASES, anchor: "alerts-on-a-database" },
  {
    // Service Bus-triggered functions.
    from: QUEUES,
    to: SERVERLESS,
    anchor: "azure-functions",
  },
];

interface ColumnWideDiagram {
  page: string;
  // Its place among the page's diagrams.
  diagram: number;
  title: string;
  widestLine: number;
}

/*
 * Diagrams that fill the 590px docs column, and fit it in every language
 * only with their labels broken into short lines. Each is held to the widest
 * label line measured to fit, in a browser, in every language, counting a
 * Chinese, Japanese or Korean character twice: a label put back on one line
 * runs its diagram off the column.
 */
const COLUMN_WIDE_DIAGRAMS: ReadonlyArray<ColumnWideDiagram> = [
  {
    page: KUBERNETES,
    diagram: 0,
    title: "From your cluster to OneUptime",
    widestLine: 26,
  },
  {
    page: IOT,
    diagram: 0,
    title: "From your devices to a fleet in OneUptime",
    widestLine: 26,
  },
];

const DIAGRAM_LABEL: RegExp = /"([^"]*)"/g;
const LABEL_BREAK: string = "<br/>";
const WIDE_CHARACTER: RegExp = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

function diagramsOf(markdown: string): Array<DocsFence> {
  return scanMarkdown(markdown).fences.filter((fence: DocsFence): boolean => {
    return fence.lang === "mermaid";
  });
}

// Every line of every node and link label, as the diagram breaks them.
function labelLines(diagram: string): Array<string> {
  return Array.from(diagram.matchAll(DIAGRAM_LABEL)).flatMap(
    (match: RegExpMatchArray): Array<string> => {
      return (match[1] as string).split(LABEL_BREAK);
    },
  );
}

function lineWidth(line: string): number {
  return Array.from(line).reduce((width: number, character: string): number => {
    return width + (WIDE_CHARACTER.test(character) ? 2 : 1);
  }, 0);
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      PERMISSIONS,
      OTHER_CONSOLES,
      SERVER_MESSAGES,
      NAMES,
      PROSE,
      PROSE_LEADS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of listed(PROSE, page)) {
        expect({ page, label, ok: true }).toEqual({
          page,
          label,
          ok: labels.includes(label) && isActionLabel(label),
        });
      }
    }
  });

  /*
   * A name the Dashboard shows in English today and translates tomorrow
   * fails here: then every translation names it as drawn, and it leaves the
   * list.
   */
  it("keep in English only bold names the Dashboard has no translation for", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of listed(SHOWN_IN_ENGLISH, page)) {
        expect({ page, name, bold: true, label: false }).toEqual({
          page,
          name,
          bold: labels.includes(name),
          label: isDrawnLabel(name),
        });
      }
    }
  });

  it("list permissions, other consoles' labels, messages and names the English pages really make bold", () => {
    for (const lists of [PERMISSIONS, OTHER_CONSOLES, SERVER_MESSAGES, NAMES]) {
      for (const page of Object.keys(lists)) {
        const spans: Array<string> = boldSpans(prose(englishPage(page)));

        for (const name of listed(lists, page)) {
          expect({ page, name, bold: spans.includes(name) }).toEqual({
            page,
            name,
            bold: true,
          });
        }
      }
    }
  });

  it("know every bold word on the English pages: a label, shown in English, a permission, another console's, a message, a name, prose or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isDrawnLabel(span) &&
            !keptAsWritten(page).includes(span) &&
            !listed(PROSE_LEADS, page).includes(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list as leads only bold words the English page has, that are no Dashboard label", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of listed(PROSE_LEADS, page)) {
        expect({ page, lead, found: true, label: false }).toEqual({
          page,
          lead,
          found: spans.includes(lead),
          label: isDrawnLabel(lead),
        });
      }
    }
  });

  it("know every path on the English pages as a path of Dashboard labels", () => {
    for (const page of PAGE_NAMES) {
      const unknown: Array<string> = menuPaths(englishPage(page)).filter(
        (path: string): boolean => {
          return !segmentsOf(path).every(isDrawnLabel);
        },
      );

      expect({ page, unknown }).toEqual({ page, unknown: [] });
    }
  });

  it("name links that the English pages really have, to headings the English pages really have", () => {
    for (const link of LINKS_INTO_THESE_PAGES) {
      expect({
        link,
        linked: englishPage(link.from).includes(
          `](/docs/${link.to}#${link.anchor})`,
        ),
        heading: anchorInLanguage("en", link.to, link.anchor),
      }).toEqual({ link, linked: true, heading: link.anchor });
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: TranslatedPage) => {
      const diagrams: Array<DocsFence> = diagramsOf(englishPage(entry.page));

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each(PAGES)(
    "$page opens on cards and ends on a Next steps section of cards, after its Troubleshooting",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const scanned: ScannedPage = scanMarkdown(markdown);
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;
      const firstHeadingLine: number = (sections(markdown)[0] as DocsHeading)
        .line;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(
        markdown.split("\n").slice(0, firstHeadingLine).join("\n"),
      ).toContain(":::cards");
      expect(
        scanned.headings
          .filter((heading: DocsHeading): boolean => {
            return heading.level === 2;
          })
          .map((heading: DocsHeading): string => {
            return heading.text;
          })
          .slice(-2),
      ).toEqual(["Troubleshooting", "Next steps"]);
      expect(
        cardLines(markdown.slice(markdown.lastIndexOf("## Next steps"))),
      ).not.toHaveLength(0);
    },
  );

  it.each(PAGES)(
    "$page installs or sends with steps, and says how it works first",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);

      expect(stepCount(markdown)).toBeGreaterThanOrEqual(2);
      expect(
        sections(markdown)
          .filter((heading: DocsHeading): boolean => {
            return heading.level === 2;
          })
          .map((heading: DocsHeading): string => {
            return heading.text;
          })[0],
      ).toBe("How it works");
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page writes every paragraph on one line, so a translation can match it line for line",
    (entry: TranslatedPage) => {
      const wrapped: Array<string> = [];
      const lines: Array<string> = prose(englishPage(entry.page)).split("\n");

      lines.forEach((line: string, index: number): void => {
        if (isParagraphText(line) && isParagraphText(lines[index + 1] || "")) {
          wrapped.push(line);
        }
      });

      expect(wrapped).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page names the Dashboard's screens with the Dashboard's own words",
    (entry: TranslatedPage) => {
      // Every bold label that is not kept as written is a Dashboard label.
      const labels: Array<string> = boldLabels(englishPage(entry.page)).filter(
        (span: string): boolean => {
          return (
            !keptAsWritten(entry.page).includes(span) &&
            !listed(PROSE_LEADS, entry.page).includes(span)
          );
        },
      );

      for (const label of labels) {
        expect({ label, drawn: isDrawnLabel(label) }).toEqual({
          label,
          drawn: true,
        });
      }
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(PAGES)("$page", (entry: TranslatedPage) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("lies line for line beside the English page: headings, table rows and fences on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the components, and the tab labels, which are names", () => {
      const translated: string = readPage(language, entry.page);

      expect(containersOf(translated)).toEqual(containersOf(english));
      expect(tabLabels(translated)).toEqual(tabLabels(english));
    });

    it("keeps the code in the first column of every table, row by row, and the numbers of every row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          const translatedRow: Array<string> =
            translated[index]?.[rowIndex] || [];

          expect({
            table: index,
            row: rowIndex,
            code: ONLY_CODE.test(row[0] as string)
              ? translatedRow[0]
              : undefined,
            numbers: numbersIn(translatedRow.join(" | ")),
          }).toEqual({
            table: index,
            row: rowIndex,
            code: ONLY_CODE.test(row[0] as string) ? row[0] : undefined,
            numbers: numbersIn(row.join(" | ")),
          });
        });
      });
    });

    it("closes every bold and code span it opens", () => {
      expect(unbalancedLines(readPage(language, entry.page))).toEqual([]);
    });

    it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
      expect(
        await strayMarkers(readPage(language, entry.page), language),
      ).toEqual([]);
    });

    it("has the English page's headings, steps, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      );
      expect(stepCount(translated)).toBe(stepCount(english));
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
      const translated: Array<string> = cardLines(
        readPage(language, entry.page),
      );

      expect(translated.length).toBe(cardLines(english).length);

      for (const line of translated) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }

      expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english)));
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isDrawnLabel(label) && !keptAsWritten(entry.page).includes(label)
          );
        })
        .filter((label: string): boolean => {
          return !translated.includes(`**${drawnLabel(language, label)}**`);
        })
        .map((label: string): string => {
          return `${label} -> ${drawnLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((path: string): string => {
          return drawnMenuPath(language, segmentsOf(path));
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what every Dashboard shows in English, other consoles' labels, messages and names, as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(SHOWN_IN_ENGLISH, entry.page),
        ...listed(PERMISSIONS, entry.page),
        ...listed(OTHER_CONSOLES, entry.page),
        ...listed(SERVER_MESSAGES, entry.page),
        ...listed(NAMES, entry.page),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });
  });

  describe("links into these pages from other pages", () => {
    it.each(LINKS_INTO_THESE_PAGES)(
      "$from links to the heading of $to it means ($anchor)",
      (link: LinkIntoPage) => {
        if (!hasPage(language, link.from)) {
          return;
        }

        const anchor: string | null = anchorInLanguage(
          language,
          link.to,
          link.anchor,
        );

        expect(anchor).not.toBeNull();
        expect(readPage(language, link.from)).toContain(
          `](/docs/${link.to}#${anchor})`,
        );
      },
    );
  });
});

describe("the diagrams that fill the docs column", () => {
  it.each(COLUMN_WIDE_DIAGRAMS)(
    "are the ones the list names: $page diagram $diagram is '$title'",
    (entry: ColumnWideDiagram) => {
      const diagram: DocsFence = diagramsOf(englishPage(entry.page))[
        entry.diagram
      ] as DocsFence;

      expect(diagram.info).toContain(`title="${entry.title}"`);
    },
  );

  describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s",
    (language: string) => {
      it.each(COLUMN_WIDE_DIAGRAMS)(
        "breaks the labels of '$title' into lines no wider than $widestLine",
        (entry: ColumnWideDiagram) => {
          const diagram: DocsFence = diagramsOf(readPage(language, entry.page))[
            entry.diagram
          ] as DocsFence;
          const tooWide: Array<string> = labelLines(diagram.code).filter(
            (line: string): boolean => {
              return lineWidth(line) > entry.widestLine;
            },
          );

          expect(tooWide).toEqual([]);
        },
      );
    },
  );
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); this suite
 * adds line-for-line shape, menu paths in two scripts, create buttons, steps
 * inside other components, and the width of a diagram's label lines.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label, and draw it in one bold span, or one per segment in Persian", () => {
    const markdown: string =
      "**Products → Infrastructure → Hosts** and **Agent Version**";

    expect(menuPaths(markdown)).toEqual(["Products → Infrastructure → Hosts"]);
    expect(boldLabels(markdown)).toEqual(["Agent Version"]);
    expect(drawnPath("fa", ["Products", "Infrastructure"])).toBe(
      `**${drawnActionLabel("fa", "Products")}**${PERSIAN_PATH_SEPARATOR}**${drawnActionLabel("fa", "Infrastructure")}**`,
    );
    expect(drawnPath("en", ["Products", "Infrastructure"])).toBe(
      "**Products → Infrastructure**",
    );
  });

  it("draw a Products menu path as that menu draws it, and a create button in a path as its table does", () => {
    // The category and the product, from navbar.categories and navbar.items.
    expect(drawnMenuPath("nl", ["Products", "Resources", "Databases"])).toBe(
      `**${drawnActionLabel("nl", "Products")} → ${navbarValue("nl", "categories", "resources")} → ${navbarValue("nl", "items", "databasesTitle")}**`,
    );
    expect(navbarValue("nl", "categories", "resources")).toBe("Bronnen");
    expect(drawnMenuPath("ru", ["Products", "Resources", "Databases"])).toContain(
      "Базы данных",
    );
    // Storage Arrays is drawn in English in the menu, whatever the flat key says.
    expect(
      drawnMenuPath("de", ["Products", "Infrastructure", "Storage Arrays"]),
    ).toBe("**Produkte → Infrastruktur → Storage Arrays**");
    // Past the product, the flat keys: the product's own side menu.
    expect(
      drawnMenuPath("de", [
        "Products",
        "Infrastructure",
        "Storage Arrays",
        "All Storage Arrays",
      ]),
    ).toBe(
      `**Produkte → Infrastruktur → Storage Arrays → ${drawnActionLabel("de", "All Storage Arrays")}**`,
    );
    // A path that does not start at the Products menu reads the flat keys.
    expect(drawnMenuPath("ru", ["Databases", "Create Database"])).toBe(
      `**${drawnActionLabel("ru", "Databases")} → ${drawnCreateButton("ru", "Create Database")}**`,
    );
    expect(drawnMenuPath("fa", ["Products", "Resources", "Queues"])).toBe(
      `**${drawnActionLabel("fa", "Products")}**${PERSIAN_PATH_SEPARATOR}**${navbarValue("fa", "categories", "resources")}**${PERSIAN_PATH_SEPARATOR}**${navbarValue("fa", "items", "queuesTitle")}**`,
    );
    expect(drawnMenuPath("en", ["Products", "Resources", "Queues"])).toBe(
      "**Products → Resources → Queues**",
    );
  });

  it("draw a create button as its table draws it, and a label from the locale", () => {
    expect(drawnLabel("en", "Create Dashboard")).toBe("Create Dashboard");
    expect(drawnLabel("de", "Create Dashboard")).toBe(
      drawnCreateButton("de", "Create Dashboard"),
    );
    expect(drawnLabel("de", "Agent Version")).toBe(
      drawnActionLabel("de", "Agent Version"),
    );
  });

  it("lay a translation beside its English page by what each line is", () => {
    const page: string = ["# Title", "", "| A | B |", "| --- | --- |"].join(
      "\n",
    );
    const shifted: string = [
      "# Titel",
      "",
      "",
      "| A | B |",
      "| --- | --- |",
    ].join("\n");

    expect(lineShape(page)).toEqual(["#", "", "|", "|"]);
    expect(lineShape(shifted)).not.toEqual(lineShape(page));
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("Every 30 seconds, about 6,000 datapoints")).toEqual([
      "30",
      "6000",
    ]);
    expect(numbersIn("alle 30 Sekunden, etwa 6.000 Datenpunkte")).toEqual([
      "30",
      "6000",
    ]);
    expect(numbersIn("هر ۳۰ ثانیه")).toEqual(["30"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string = "**Agent Version** / `release** on the host";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("count the steps of every :::steps block, also when tabs sit inside a step, and only those", () => {
    const markdown: string = [
      "# Page",
      ":::steps",
      "### One",
      ":::tabs",
      "@tab Linux",
      "```bash",
      "### not a step",
      "```",
      ":::",
      "### Two",
      ":::",
      "### After the steps",
    ].join("\n");

    expect(stepCount(markdown)).toBe(2);
  });

  it("read the tab labels of a page", () => {
    expect(
      tabLabels(
        [":::tabs", "@tab Docker CLI", "x", "@tab Docker Compose", ":::"].join(
          "\n",
        ),
      ),
    ).toEqual(["Docker CLI", "Docker Compose"]);
  });

  it("read a diagram's label lines, and count a Chinese, Japanese or Korean character twice", () => {
    const diagram: string = [
      "flowchart TB",
      '    nodes["Every Linux node:<br/>node collector, eBPF"]',
      '    nodes -->|"logs, metrics,<br/>traces"| oneuptime',
      '    ai["Kubernetes AI 代理"]',
    ].join("\n");

    expect(labelLines(diagram)).toEqual([
      "Every Linux node:",
      "node collector, eBPF",
      "logs, metrics,",
      "traces",
      "Kubernetes AI 代理",
    ]);
    expect(lineWidth("Every Linux node:")).toBe(17);
    expect(lineWidth("Kubernetes AI 代理")).toBe(18);
    expect(lineWidth("ノード")).toBe(6);
  });
});
