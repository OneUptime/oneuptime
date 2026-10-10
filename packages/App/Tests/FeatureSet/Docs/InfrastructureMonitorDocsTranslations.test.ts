import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DocsHeading,
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  diagramSkeleton,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { getAllDockerAlertTemplates } from "Common/Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import { getAllHostAlertTemplates } from "Common/Types/Monitor/HostAlertTemplates";
import { getAllKubernetesAlertTemplates } from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  KubernetesMetricDefinition,
  getAllKubernetesMetrics,
} from "Common/Types/Monitor/KubernetesMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { getAllPodmanAlertTemplates } from "Common/Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "Common/Types/Monitor/ProxmoxAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 9: the infrastructure monitor pages - Server / VM,
 * Kubernetes, Docker, Host, Podman, Proxmox and Docker Swarm - in every docs
 * language. Each translation says what the English page says: the same
 * sections, steps, tables, lists, cards, code and diagrams, links that land
 * on a heading in the reader's language, a title that is the nav link's,
 * and the product named the way that language's product draws it.
 *
 * "The way the product draws it" has these sources on these pages:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel), as on the other monitor
 *     pages. Menu paths ("Products → Infrastructure → Docker → All Hosts")
 *     are drawn segment by segment; the product segment is the Products
 *     menu's own title for it (its navbar.items key), which differs from
 *     the flat key in Hindi ("Hosts").
 *   - The sensitivity options a criteria offers are written short on most
 *     pages ("**Low** (4σ)"). The Dashboard draws each as a whole option
 *     ("Low (4σ — egregious deviations only)"), so a translation names the
 *     start of that option as drawn, not the unrelated "Low" key.
 *   - The type picker's Docker Container and Podman Container, the tabs
 *     Quick Setup and Custom Metric, the Past 1 Minute and Past 365 Days
 *     windows, the criteria's conditions and window aggregates, the
 *     template names and the Kubernetes metric names have no Dashboard
 *     locale key: every language's Dashboard shows them in English, so
 *     every translation names them in English (SHOWN_IN_ENGLISH). When the
 *     Dashboard gains a key for one, a test below fails until the pages
 *     name it as drawn.
 *
 * The criteria names and the incident title a new monitor's default
 * criteria create are English in every project, so every translation quotes
 * them as created. Bold words that are Dashboard labels only by coincidence
 * are PROSE, with why; bold words that are neither labels nor shown in
 * English are the pages' own leads (PROSE_LEADS), which a translation words
 * freely.
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

const SERVER: string = "monitor/server-monitor";
const KUBERNETES: string = "monitor/kubernetes-monitor";
const DOCKER: string = "monitor/docker-monitor";
const HOST: string = "monitor/host-monitor";
const PODMAN: string = "monitor/podman-monitor";
const PROXMOX: string = "monitor/proxmox-monitor";
const SWARM: string = "monitor/docker-swarm-monitor";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: SERVER, navTitle: "Server / VM Monitor" },
  { page: KUBERNETES, navTitle: "Kubernetes Monitor" },
  { page: DOCKER, navTitle: "Docker Monitor" },
  { page: HOST, navTitle: "Host Monitor" },
  { page: PODMAN, navTitle: "Podman Monitor" },
  { page: PROXMOX, navTitle: "Proxmox Monitor" },
  { page: SWARM, navTitle: "Docker Swarm Monitor" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The pages built on the same create steps, criteria and default criteria.
const TEMPLATE_PAGES: Array<string> = [DOCKER, HOST, PODMAN, PROXMOX, SWARM];

// The monitor types whose default criteria a page lists, by page.
const DEFAULT_CRITERIA_TYPES: Record<string, MonitorType> = {
  [DOCKER]: MonitorType.Docker,
  [HOST]: MonitorType.Host,
  [PODMAN]: MonitorType.Podman,
  [PROXMOX]: MonitorType.Proxmox,
  [SWARM]: MonitorType.DockerSwarm,
};

// The Quick Setup templates a page's template table lists, by page.
const TEMPLATE_NAMES: Record<string, () => Array<string>> = {
  [KUBERNETES]: (): Array<string> => {
    return getAllKubernetesAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
  [DOCKER]: (): Array<string> => {
    return getAllDockerAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
  [HOST]: (): Array<string> => {
    return getAllHostAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
  [PODMAN]: (): Array<string> => {
    return getAllPodmanAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
  [PROXMOX]: (): Array<string> => {
    return getAllProxmoxAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
  [SWARM]: (): Array<string> => {
    return getAllDockerSwarmAlertTemplates().map((t: { name: string }) => {
      return t.name;
    });
  },
};

const STATIC_CONDITIONS: Array<string> = [
  "Greater Than",
  "Less Than",
  "Greater Than Or Equal To",
  "Less Than Or Equal To",
  "Equal To",
];

const ANOMALY_CONDITIONS: Array<string> = [
  "Anomalously High",
  "Anomalously Low",
  "Anomalous",
];

// The window aggregates with no locale key; Average and Sum have one.
const UNKEYED_AGGREGATES: Array<string> = [
  "Maximum Value",
  "Minimum Value",
  "All Values",
  "Any Value",
];

// The If No Data options with no locale key; Trigger has one.
const UNKEYED_NO_DATA: Array<string> = ["Ignore", "Treat As Zero"];

// The step forms' tabs and windows with no locale key.
const FORM_NAMES: Array<string> = [
  "Quick Setup",
  "Custom Metric",
  "Past 1 Minute",
  "Past 365 Days",
];

const CRITERIA_NAMES: Array<string> = [
  ...UNKEYED_AGGREGATES,
  ...STATIC_CONDITIONS,
  ...ANOMALY_CONDITIONS,
  ...UNKEYED_NO_DATA,
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [SERVER]: [
    // The monitor type's title, and the criteria filter.
    "Server / VM",
    "Is Online",
    "All Values",
    "Any Value",
    ...UNKEYED_NO_DATA,
  ],
  [KUBERNETES]: [
    // Template names.
    "etcd No Leader",
    "API Server Request Saturation",
    "Scheduler Backlog",
    "CrashLoopBackOff Detection",
    "Pod Memory Saturating Container Limit",
    "Pod CPU Saturating Container Limit",
    "HPA Saturated at Max Replicas",
    "High Node CPU Utilization",
    ...FORM_NAMES,
    // The Custom Metric picker's metric names.
    "Pod CPU Usage",
    "Node CPU Usage",
    "Pod Phase (Code)",
    // What every rule checks.
    "Metric Value",
    ...STATIC_CONDITIONS,
    ...ANOMALY_CONDITIONS,
    ...UNKEYED_NO_DATA,
  ],
  [DOCKER]: [
    "Docker Container",
    ...FORM_NAMES,
    "Container Down (Low Uptime)",
    "High Container CPU Usage",
    ...CRITERIA_NAMES,
  ],
  [HOST]: [...FORM_NAMES, ...CRITERIA_NAMES],
  [PODMAN]: [
    "Podman Container",
    ...FORM_NAMES,
    "High Container Restart Count",
    "Container Restarted (Low Uptime)",
    "High Container CPU Usage",
    ...CRITERIA_NAMES,
  ],
  [PROXMOX]: [
    ...FORM_NAMES,
    "Guest Down",
    "Cluster Quorum at Risk",
    "High Guest CPU Usage",
    "Container Root Disk Near Full",
    "Guest Not Backed Up",
    "Replication Failing",
    "Node Offline",
    "HA Resource in Error State",
    ...CRITERIA_NAMES,
  ],
  [SWARM]: [...FORM_NAMES, "Task Down (Low Uptime)", ...CRITERIA_NAMES],
};

/*
 * The short sensitivity names the criteria tables write ("**Low** (4σ)"),
 * and the option the Dashboard draws for each. A translation names the
 * option's start as drawn: "**Niedrig** (4σ)".
 */
const SENSITIVITY_OPTIONS: Record<string, string> = {
  Low: "Low (4σ — egregious deviations only)",
  Medium: "Medium (3σ — recommended)",
  High: "High (2σ — noisier, very stable services)",
};

const SENSITIVITY_SHORT: Array<string> = Object.keys(SENSITIVITY_OPTIONS);

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  /*
   * "| **Agent** | ... |": the comparison table's row heads; "- **CPU** is
   * busy time": the template notes' leads, which name a template, not a
   * screen.
   */
  [HOST]: [
    "Agent",
    "Criteria",
    "Setup",
    "CPU",
    "Memory",
    "Filesystem",
    ...SENSITIVITY_SHORT,
  ],
  // "the replication **job** id": the word, stressed.
  [PROXMOX]: ["job", ...SENSITIVITY_SHORT],
  // The short sensitivity names, checked against the drawn option below.
  [DOCKER]: SENSITIVITY_SHORT,
  [PODMAN]: SENSITIVITY_SHORT,
  [SWARM]: SENSITIVITY_SHORT,
};

/*
 * The bold leads of the pages' own lists and sentences. They are neither
 * Dashboard labels nor shown in English, so a translation words them
 * freely; listing them makes a new bold name on these pages fail below
 * until it is put in SHOWN_IN_ENGLISH or here.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  // Windows' own program, named as that language's Windows names it.
  [SERVER]: ["Command Prompt"],
  [KUBERNETES]: ["formula", "sum"],
  [DOCKER]: [
    "Install the Docker Agent",
    "Check the host is registered.",
    "For container logs",
    "host's",
  ],
  [HOST]: [
    "Data",
    "Run an OpenTelemetry Collector on the host",
    "Turn on the utilization metrics.",
    "Check the host is registered.",
    "Load average",
    "Process count",
  ],
  [PODMAN]: [
    "Install the Podman Agent",
    "Check the host is registered.",
    "For container logs",
  ],
  [PROXMOX]: [
    "Install the Proxmox Agent",
    "Check the cluster is registered.",
    "Down templates use Minimum",
    "Ratio formulas",
    "Replication staleness",
    "successful",
    "attempt",
  ],
  [SWARM]: ["Install the Docker Swarm Agent", "Check the cluster is registered."],
};

const PATH_SEPARATOR: string = " → ";

/*
 * The Products menu's own titles for the products a path opens: the menu
 * draws each from its navbar.items key, not the flat label key.
 */
const PRODUCTS_MENU_KEYS: Record<string, string> = {
  Hosts: "hostsTitle",
  Kubernetes: "kubernetesTitle",
  Docker: "dockerTitle",
  "Docker Swarm": "dockerSwarmTitle",
  Podman: "podmanTitle",
  Proxmox: "proxmoxTitle",
};

const PRODUCTS: string = "Products";

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

// A rendered HTML tag, whose attributes may hold underscores of their own.
const HTML_TAG: RegExp = /<[^>]*>/g;

/*
 * A name written with underscores, as a metric is outside code in a
 * details title ("pve_network_receive_bytes"): CommonMark never reads an
 * underscore between two letters as emphasis, so it is the name, not a
 * marker left over.
 */
const UNDERSCORED_NAME: RegExp = /[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g;

// A table's delimiter row.
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;

/*
 * A number as a table states it: 85, 76.5, 0.9. A translation may write its
 * language's decimal mark: 76,5, or Persian ۷۶٫۵.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;

// Where a drawn sensitivity option's name ends: at its parenthesis.
const OPTION_DETAIL: RegExp = /\s*[(（].*$/;

const MONITOR_NAME: string = "Acme";

function englishPage(page: string): string {
  return readPage("en", page);
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR).map((segment: string): string => {
        return segment.trim();
      });
    })
    .filter((segments: Array<string>): boolean => {
      return segments.every((segment: string): boolean => {
        return isActionLabel(segment);
      });
    });
}

/*
 * A Products menu path's segment as that language draws it: the product
 * (after Products → Infrastructure) is the Products menu's own title for it.
 */
function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const key: string | undefined = PRODUCTS_MENU_KEYS[segment];

  if (language !== "en" && segments[0] === PRODUCTS && index === 2 && key) {
    const navbar: unknown = dashboardLocale(language)["navbar"];
    const items: unknown = (navbar as Record<string, unknown> | undefined)?.[
      "items"
    ];
    const title: unknown = (items as Record<string, unknown> | undefined)?.[
      key
    ];

    if (typeof title === "string" && title.trim()) {
      return title;
    }
  }

  return drawnActionLabel(language, segment);
}

function drawnPath(language: string, segments: Array<string>): string {
  return segments
    .map((_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    })
    .join(PATH_SEPARATOR);
}

// A sensitivity option's name as that language's Dashboard starts it.
function drawnSensitivity(language: string, short: string): string {
  return drawnActionLabel(
    language,
    SENSITIVITY_OPTIONS[short] as string,
  ).replace(OPTION_DETAIL, "");
}

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it: "**Not Equal To** / `200** in the offline one" leaves the code
 * open and swallows the rest of the line into it.
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

/*
 * A page as the docs route draws it, without its title line, and the
 * emphasis markers left in its text: a bold or italic span CommonMark did
 * not close. A bold span that ends in punctuation and runs straight into a
 * letter, as in "**タイムアウト（ミリ秒）**を", is not closed, and its
 * asterisks show. An underscore never closes inside a word, so "_之后_的"
 * shows both underscores.
 */
async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return html
    .replace(RENDERED_CODE, "")
    .split("\n")
    .map((line: string): string => {
      return line.replace(HTML_TAG, "");
    })
    .filter((line: string): boolean => {
      return (
        line.includes("**") || line.replace(UNDERSCORED_NAME, "").includes("_")
      );
    });
}

// The number of :::steps steps on a page: the H3s inside its steps blocks.
function stepCount(markdown: string): number {
  let inSteps: boolean = false;
  let inFence: boolean = false;
  let steps: number = 0;

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.trim() === ":::steps") {
      inSteps = true;
      continue;
    }

    if (inSteps && line.trim() === ":::") {
      inSteps = false;
      continue;
    }

    if (inSteps && line.startsWith("### ")) {
      steps++;
    }
  }

  return steps;
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

// Where the template table is among a page's tables: its header starts with "Template".
function templateTableIndex(page: string): number {
  return tables(englishPage(page)).findIndex(
    (table: Array<Array<string>>): boolean => {
      return table[0]?.[0] === "Template";
    },
  );
}

function numbersIn(text: string): Array<string> {
  return Array.from(
    toLatinDigits(text).replace(DECIMAL_MARK, "$1.$2").matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

/*
 * The criteria names and the incident title a new monitor of this type gets,
 * as the English pages quote them: "_monitor name_ is offline".
 */
function defaultCriteriaText(monitorType: MonitorType): Array<string> {
  const instances: Array<MonitorCriteriaInstance> =
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: MONITOR_NAME,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || [];

  const text: Array<string> = [];

  for (const instance of instances) {
    text.push(
      (instance.data?.name || "").replace(MONITOR_NAME, "_monitor name_"),
    );

    for (const incident of instance.data?.createIncidents
      ? instance.data.incidents
      : []) {
      text.push(`"${incident.title.replace(MONITOR_NAME, "_monitor name_")}"`);
    }
  }

  return text;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      PROSE,
      PROSE_LEADS,
      DEFAULT_CRITERIA_TYPES,
      TEMPLATE_NAMES,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of PROSE[page] as Array<string>) {
        expect({ page: page, label: label, ok: true }).toEqual({
          page: page,
          label: label,
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

      for (const name of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ page: page, name: name, bold: true, label: false }).toEqual({
          page: page,
          name: name,
          bold: labels.includes(name),
          label: isActionLabel(name),
        });
      }
    }
  });

  it("know every bold word on the English pages: a label, shown in English, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !(SHOWN_IN_ENGLISH[page] || []).includes(span) &&
            !(PROSE_LEADS[page] || []).includes(span)
          );
        },
      );

      expect({ page: page, unlisted: unlisted }).toEqual({
        page: page,
        unlisted: [],
      });
    }
  });

  it("list as leads only bold words the English page has", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page: page, lead: lead, found: true, label: false }).toEqual({
          page: page,
          lead: lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      const labels: number = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isActionLabel(label);
        },
      ).length;

      expect({ page: page, enough: labels >= 8 }).toEqual({
        page: page,
        enough: true,
      });
    }
  });

  it("know the sensitivity options as the criteria form draws them, and the pages that write them short", () => {
    for (const option of Object.values(SENSITIVITY_OPTIONS)) {
      expect(isActionLabel(option)).toBe(true);
    }

    for (const page of TEMPLATE_PAGES) {
      expect(englishPage(page)).toContain(
        "**Low** (4σ), **Medium** (3σ, the default) or **High** (2σ).",
      );
    }

    // The Kubernetes page names the whole option.
    for (const option of Object.values(SENSITIVITY_OPTIONS)) {
      expect(englishPage(KUBERNETES)).toContain(`**${option}**`);
    }
  });

  it("find the template tables and the default criteria where the pages have them", () => {
    for (const page of Object.keys(TEMPLATE_NAMES)) {
      expect(templateTableIndex(page)).toBeGreaterThanOrEqual(0);
    }

    for (const page of Object.keys(DEFAULT_CRITERIA_TYPES)) {
      for (const text of defaultCriteriaText(
        DEFAULT_CRITERIA_TYPES[page] as MonitorType,
      )) {
        expect({ page, text, quoted: true }).toEqual({
          page,
          text,
          quoted: englishPage(page).includes(text),
        });
      }
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
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each(PAGES)(
    "$page ends on a Next steps section of cards, after its Troubleshooting",
    (entry: TranslatedPage) => {
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);

      // Right before it, what to do when the monitor does not work.
      expect(scanned.headings[scanned.headings.length - 2]).toEqual(
        expect.objectContaining({ level: 2, text: "Troubleshooting" }),
      );
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(TEMPLATE_PAGES)(
    "%s says how many steps creating it takes, and has that many",
    (page: string) => {
      const english: string = englishPage(page);

      expect(stepCount(english)).toBe(6);
      expect(english).toContain("): Six steps in the dashboard.");
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
      expect(title).not.toBe(entry.navTitle);
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      const translated: ScannedPage = scanMarkdown(
        readPage(language, entry.page),
      );

      expect(translated.fences.map(comparableFence)).toEqual(
        scanMarkdown(english).fences.map(comparableFence),
      );
    });

    it("keeps every piece of inline code", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
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
        expect({ line: line, ascii: CARD_LINE.test(line) }).toEqual({
          line: line,
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
      const proseWords: Array<string> = PROSE[entry.page] || [];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isActionLabel(label) && !proseWords.includes(label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnActionLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnActionLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return drawnPath(language, segments);
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("names in English what every Dashboard shows in English", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (
        SHOWN_IN_ENGLISH[entry.page] || []
      ).filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("names each sensitivity by the start of the option the Dashboard draws", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = TEMPLATE_PAGES.includes(entry.page)
        ? SENSITIVITY_SHORT.map((short: string): string => {
            return drawnSensitivity(language, short);
          }).filter((drawn: string): boolean => {
            return !translated.includes(`**${drawn}**`);
          })
        : [];

      expect(missing).toEqual([]);
    });

    it("quotes the default criteria and their incident exactly as a new monitor creates them", () => {
      const monitorType: MonitorType | undefined =
        DEFAULT_CRITERIA_TYPES[entry.page];
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (
        monitorType ? defaultCriteriaText(monitorType) : []
      ).filter((text: string): boolean => {
        return !translated.includes(text.replace(/^"|"$/g, ""));
      });

      expect(missing).toEqual([]);
    });

    it("lists every template under the name the picker shows, with its numbers", () => {
      const names: Array<string> = TEMPLATE_NAMES[entry.page]
        ? (TEMPLATE_NAMES[entry.page] as () => Array<string>)()
        : [];

      if (names.length === 0) {
        return;
      }

      const index: number = templateTableIndex(entry.page);
      const englishTable: Array<Array<string>> = tables(english)[
        index
      ] as Array<Array<string>>;
      const translatedTable: Array<Array<string>> = tables(
        readPage(language, entry.page),
      )[index] as Array<Array<string>>;

      expect(
        translatedTable.slice(1).map((cells: Array<string>): string => {
          return cells[0] as string;
        }),
      ).toEqual(names);

      englishTable.slice(1).forEach((cells: Array<string>, row: number) => {
        expect({
          template: cells[0],
          numbers: numbersIn(
            (translatedTable[row + 1] as Array<string>).join(" | "),
          ),
        }).toEqual({ template: cells[0], numbers: numbersIn(cells.join(" | ")) });
      });
    });

    it("names each template's severity, and the Kubernetes categories, as the picker draws them", () => {
      const index: number = TEMPLATE_NAMES[entry.page]
        ? templateTableIndex(entry.page)
        : -1;

      if (index < 0) {
        return;
      }

      const englishTable: Array<Array<string>> = tables(english)[
        index
      ] as Array<Array<string>>;
      const translatedTable: Array<Array<string>> = tables(
        readPage(language, entry.page),
      )[index] as Array<Array<string>>;
      const severityColumn: number = englishTable[0]!.indexOf("Severity");
      const categoryColumn: number = englishTable[0]!.indexOf("Category");

      englishTable.slice(1).forEach((cells: Array<string>, row: number) => {
        const translatedCells: Array<string> = translatedTable[
          row + 1
        ] as Array<string>;

        expect(translatedCells[severityColumn]).toBe(
          drawnActionLabel(language, cells[severityColumn] as string),
        );

        if (categoryColumn >= 0) {
          expect(translatedCells[categoryColumn]).toBe(
            drawnActionLabel(language, cells[categoryColumn] as string),
          );
        }
      });
    });
  });

  it("keeps the Kubernetes metric names as the Custom Metric picker lists them", () => {
    const translated: string = readPage(language, KUBERNETES);

    for (const metric of getAllKubernetesMetrics()) {
      expect({
        metric: (metric as KubernetesMetricDefinition).friendlyName,
        kept: true,
      }).toEqual({
        metric: (metric as KubernetesMetricDefinition).friendlyName,
        kept: translated.includes(metric.friendlyName),
      });
    }
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add Products menu paths, short sensitivity names, template tables and
 * quoted default criteria.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Products → Infrastructure → Docker → All Hosts** and **Docker Host**";

    expect(menuPaths(markdown)).toEqual([
      ["Products", "Infrastructure", "Docker", "All Hosts"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Docker Host"]);
  });

  it("draw a Products menu path's product as the Products menu does, the rest as labels", () => {
    expect(
      drawnPath("hi", ["Products", "Infrastructure", "Hosts", "All Hosts"]),
    ).toBe(
      [
        drawnActionLabel("hi", "Products"),
        drawnActionLabel("hi", "Infrastructure"),
        "होस्ट्स",
        drawnActionLabel("hi", "All Hosts"),
      ].join(PATH_SEPARATOR),
    );
    // A label that is not a product after Products stays a label.
    expect(drawnPath("de", ["Products", "Infrastructure", "Docker"])).toBe(
      "Produkte → Infrastruktur → Docker",
    );
    expect(drawnPath("en", ["Products", "Infrastructure", "Hosts"])).toBe(
      "Products → Infrastructure → Hosts",
    );
  });

  it("name a sensitivity by the start of its drawn option, not the bare word's key", () => {
    expect(drawnSensitivity("de", "Low")).toBe("Niedrig");
    expect(drawnActionLabel("de", "Low")).toBe("Low");
    expect(drawnSensitivity("ja", "High")).toBe("高");
    expect(drawnSensitivity("en", "Medium")).toBe("Medium");
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string =
      "**Disk Path** / **Greater Than** / `85** in the offline one";
    const whole: string =
      "**Disk Path** / **Greater Than** / `85` in the offline one";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines(whole)).toEqual([]);
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("find asterisks the renderer leaves when a bold span runs into a letter", async () => {
    expect(
      await strayMarkers("# Title\n\n**低 (4σ)**を選びます。", "ja"),
    ).toHaveLength(1);
    expect(
      await strayMarkers("# Title\n\n**低** (4σ) を選びます。", "ja"),
    ).toEqual([]);
  });

  it("find underscores the renderer leaves when an italic span sits inside a word", async () => {
    expect(
      await strayMarkers("# Title\n\n名为_monitor name_的条件。", "zh-CN"),
    ).toHaveLength(1);
    expect(
      await strayMarkers(
        "# Title\n\n条件 “Check if _monitor name_ is offline”。",
        "zh-CN",
      ),
    ).toEqual([]);
    // A metric's name outside code keeps its underscores, and is no marker.
    expect(
      await strayMarkers(
        "# Title\n\n:::details pve_network_receive_bytes 只会增长\n正文。\n:::",
        "zh-CN",
      ),
    ).toEqual([]);
    expect(
      await strayMarkers(
        "# Title\n\n:::details pve_network_receive_bytes _只会_增长\n正文。\n:::",
        "zh-CN",
      ),
    ).toHaveLength(1);
  });

  it("count the steps of every :::steps block, and only those", () => {
    const markdown: string = [
      "# Page",
      ":::steps",
      "### One",
      "```bash",
      "### not a step",
      "```",
      "### Two",
      ":::",
      "### After the steps",
    ].join("\n");

    expect(stepCount(markdown)).toBe(2);
  });

  it("read a page's tables in order, and the numbers a row states", () => {
    const markdown: string = [
      "| Template | Severity |",
      "| --- | --- |",
      "| High CPU | Warning |",
      "",
      "```text",
      "| not | a table |",
      "```",
      "",
      "| Field | What |",
      "| --- | --- |",
      "| **Threshold** | Above ۷۶٫۵ |",
    ].join("\n");

    expect(tables(markdown)).toEqual([
      [
        ["Template", "Severity"],
        ["High CPU", "Warning"],
      ],
      [
        ["Field", "What"],
        ["**Threshold**", "Above ۷۶٫۵"],
      ],
    ]);
    expect(numbersIn("Above ۷۶٫۵ | past 5 minutes")).toEqual(["5", "76.5"]);
    expect(numbersIn("Bei oder unter 76,5 % | 28, 60 oder 90")).toEqual([
      "28",
      "60",
      "76.5",
      "90",
    ]);
    // A thousands separator is not a number the English table states.
    expect(numbersIn("Über 2.000")).toEqual(["2.000"]);
  });

  it("quote the criteria names and the incident a new Docker monitor creates", () => {
    expect(defaultCriteriaText(MonitorType.Docker)).toEqual([
      "Check if _monitor name_ is offline",
      '"_monitor name_ is offline"',
      "Check if _monitor name_ is online",
    ]);
  });

  it("compare a flowchart by its nodes and arrows, not its words", () => {
    const english: string = [
      "flowchart TB",
      '    agent["Infrastructure agent"] -->|"Report every 30 seconds"| oneuptime["OneUptime"]',
    ].join("\n");
    const translated: string = [
      "flowchart TB",
      '    agent["Infrastruktur-Agent"] -->|"Bericht alle 30 Sekunden"| oneuptime["OneUptime"]',
    ].join("\n");
    const rewired: string = [
      "flowchart TB",
      '    oneuptime["OneUptime"] -->|"Bericht alle 30 Sekunden"| agent["Infrastruktur-Agent"]',
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });
});
