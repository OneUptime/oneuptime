import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
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
  escapeRegExp,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { pathWithArrows } from "./DocsPageShape";
import {
  defaultCriteriaNamesAsWritten,
  defaultTitlesAsQuoted,
  isQuotedIn,
} from "./DocsDefaultTitles";
import { getAllDockerAlertTemplates } from "Common/Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import { getAllHostAlertTemplates } from "Common/Types/Monitor/HostAlertTemplates";
import { getAllKubernetesAlertTemplates } from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  KubernetesMetricCategory,
  KubernetesMetricDefinition,
  getAllKubernetesMetricCategories,
  getAllKubernetesMetrics,
  getKubernetesMetricCategoryLabel,
} from "Common/Types/Monitor/KubernetesMetricCatalog";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { getAllPodmanAlertTemplates } from "Common/Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "Common/Types/Monitor/ProxmoxAlertTemplates";
import {
  ProxmoxMetricCategory,
  getAllProxmoxMetricCategories,
  getProxmoxMetricCategoryLabel,
} from "Common/Types/Monitor/ProxmoxMetricCatalog";
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
 *   - The tab Custom Metric under More fields, the Past 1 Minute and Past
 *     365 Days windows, the If No Data options Ignore and Treat As Zero,
 *     the template names and the Kubernetes metric names have no Dashboard
 *     locale key: every language's Dashboard shows them in English, so
 *     every translation names them in English (SHOWN_IN_ENGLISH). When the
 *     Dashboard gains a key for one, a test below fails until the pages
 *     name it as drawn. The static conditions (Greater Than, Equal To)
 *     gained theirs in adc8421a1b, and the criteria's checks (Is Online,
 *     Metric Value), anomaly conditions and window aggregates (All Values,
 *     Maximum Value) theirs in 31eadaee92e, worded in every language in
 *     f155e8e0998: they are labels now, drawn like any other
 *     (DocsCriteriaConditions holds every page to the conditions).
 *
 * The criteria names and the incident title a new monitor's default
 * criteria create are written with the reader's translator, so every
 * translation names them in its Dashboard's words, with the monitor's name
 * as an italic placeholder in the reader's words, and quotes the title
 * (DocsDefaultTitles, #8526). Bold words that are Dashboard labels only by coincidence
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

// The templates a page's template table lists, by page.
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

// The If No Data options with no locale key; Trigger has one.
const UNKEYED_NO_DATA: Array<string> = ["Ignore", "Treat As Zero"];

// The step forms' tab and windows with no locale key.
const FORM_NAMES: Array<string> = [
  "Custom Metric",
  "Past 1 Minute",
  "Past 365 Days",
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [SERVER]: [...UNKEYED_NO_DATA],
  [KUBERNETES]: [
    // Template names.
    "Cluster Stopped Reporting",
    "Job Failures",
    "etcd No Leader",
    "API Server Request Saturation",
    "Scheduler Backlog",
    "CrashLoopBackOff Detection",
    "Pod Memory Saturating Container Limit",
    "Pod CPU Saturating Container Limit",
    "HPA Saturated at Max Replicas",
    "High Node CPU Utilization",
    "High Node CPU Request Commitment",
    "High Node Memory Request Commitment",
    "High Node Disk Usage",
    "Node Image Disk Almost Full",
    "Cluster Daily Cost Over Budget",
    "Namespace Daily Cost Over Budget",
    "High Idle Spend",
    ...FORM_NAMES,
    // What a rule does when its window has no data.
    ...UNKEYED_NO_DATA,
  ],
  [DOCKER]: [
    ...FORM_NAMES,
    "Host Stopped Reporting",
    "Container Restart Loop",
    "Container CPU Throttling",
    "Container Restarted (Low Uptime)",
    "High Container CPU Usage",
    ...UNKEYED_NO_DATA,
  ],
  [HOST]: [
    ...FORM_NAMES,
    "Host Stopped Reporting",
    "Host Restarted",
    "Systemd Unit Failed",
    ...UNKEYED_NO_DATA,
  ],
  [PODMAN]: [
    ...FORM_NAMES,
    "Host Stopped Reporting",
    "Container Restart Loop",
    "Container Restarted (Low Uptime)",
    "High Container CPU Usage",
    ...UNKEYED_NO_DATA,
  ],
  [PROXMOX]: [
    ...FORM_NAMES,
    "Cluster Stopped Reporting",
    "Guest Down",
    "Cluster Quorum at Risk",
    "High Guest CPU Usage",
    "Container Root Disk Near Full",
    "Guest Not Backed Up",
    "Replication Failing",
    "Node Offline",
    "HA Resource in Error State",
    "Node Restarted",
    "Storage Unavailable",
    "Backup Running Too Long",
    ...UNKEYED_NO_DATA,
  ],
  [SWARM]: [
    ...FORM_NAMES,
    "Cluster Stopped Reporting",
    "Node Not Ready",
    "Service Replicas Mismatch",
    "Task Down (Low Uptime)",
    ...UNKEYED_NO_DATA,
  ],
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
   * "| **Agent** | ... |": the comparison table's row heads (Data is a
   * label too since #5233, the Rule Library's Data filter); "- **CPU** is
   * busy time": the template notes' leads, which name a template, not a
   * screen.
   */
  [HOST]: [
    "Agent",
    "Criteria",
    "Data",
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
    "Run an OpenTelemetry Collector on the host",
    "Turn on the utilization metrics.",
    "Check the host is registered.",
    "Load average",
    "Process count",
    // The swap and inodes templates' notes: "- **Swap** is used swap ...".
    "Swap",
    "Inodes",
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
  [SWARM]: [
    "Install the Docker Swarm Agent",
    "Check the cluster is registered.",
  ],
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

// A menu path as a page in a language writes it, its arrows pointing on.
function drawnPath(language: string, segments: Array<string>): string {
  return pathWithArrows(
    segments.map((_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    }),
    language,
  );
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
 * The criteria names and the incident title a new monitor of this type gets
 * in this language, as the pages write them (#8526): the names as they are,
 * the title quoted - "Check if _monitor name_ is offline" and
 * "_monitor name_ is offline" in English, „_Monitorname_ ist offline“ in
 * German.
 */
interface DefaultCriteriaText {
  names: Array<string>;
  titles: Array<string>;
}

function defaultCriteriaText(
  monitorType: MonitorType,
  language: string,
): DefaultCriteriaText {
  return {
    names: defaultCriteriaNamesAsWritten(monitorType, language),
    titles: defaultTitlesAsQuoted(monitorType, language),
  };
}

// Whether a page names each default criteria and quotes each title.
function missingDefaultCriteriaText(
  markdown: string,
  text: DefaultCriteriaText,
): Array<string> {
  return [
    ...text.names.filter((name: string): boolean => {
      return !markdown.includes(name);
    }),
    ...text.titles.filter((title: string): boolean => {
      return !isQuotedIn(markdown, title);
    }),
  ];
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
      expect({
        page,
        missing: missingDefaultCriteriaText(
          englishPage(page),
          defaultCriteriaText(
            DEFAULT_CRITERIA_TYPES[page] as MonitorType,
            "en",
          ),
        ),
      }).toEqual({ page, missing: [] });
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

    it("names the default criteria and quotes their incident as a new monitor in this language creates them", () => {
      const monitorType: MonitorType | undefined =
        DEFAULT_CRITERIA_TYPES[entry.page];

      if (!monitorType) {
        return;
      }

      const translated: string = readPage(language, entry.page);

      expect(
        missingDefaultCriteriaText(
          translated,
          defaultCriteriaText(monitorType, language),
        ),
      ).toEqual([]);

      // And none in English, which this language words otherwise (#8526).
      const english: DefaultCriteriaText = defaultCriteriaText(
        monitorType,
        "en",
      );

      expect(
        [...english.names, ...english.titles].filter(
          (text: string): boolean => {
            return translated.includes(text);
          },
        ),
      ).toEqual([]);
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
        }).toEqual({
          template: cells[0],
          numbers: numbersIn(cells.join(" | ")),
        });
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

  /*
   * The Custom Metric picker draws each name in the reader's words since the
   * catalog's names are keys (#8353): the metric table and the names the page
   * quotes in bold say it as the picker does, and the English name is gone.
   */
  it("names the Kubernetes metrics as the Custom Metric picker draws them", () => {
    const translated: string = readPage(language, KUBERNETES);
    const english: Array<string> = [];
    // A template's name the template picker shows as written, a metric's name too.
    const templateNames: Array<string> = (
      TEMPLATE_NAMES[KUBERNETES] as () => Array<string>
    )();

    for (const metric of getAllKubernetesMetrics()) {
      const name: string = (metric as KubernetesMetricDefinition).friendlyName;
      const drawn: string = drawnActionLabel(language, name);

      expect({ metric: name, drawn, named: true }).toEqual({
        metric: name,
        drawn,
        named: translated.includes(drawn),
      });

      if (
        drawn !== name &&
        !templateNames.includes(name) &&
        new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`).test(
          translated.replace(/`[^`\n]*`/g, " "),
        )
      ) {
        english.push(name);
      }
    }

    expect(english).toEqual([]);
  });

  it("heads each group of the Kubernetes metric table as the picker heads it", () => {
    const englishLines: Array<string> = englishPage(KUBERNETES).split("\n");
    const lines: Array<string> = readPage(language, KUBERNETES).split("\n");
    const header: number = englishLines.indexOf("| Category | Metrics |");

    expect(header).toBeGreaterThan(0);

    getAllKubernetesMetricCategories().forEach(
      (category: KubernetesMetricCategory, index: number) => {
        const cell: string = (
          (lines[header + 2 + index] as string).split("|")[1] as string
        ).trim();

        expect({ category, cell }).toEqual({
          category,
          cell: drawnActionLabel(
            language,
            getKubernetesMetricCategoryLabel(category),
          ),
        });
      },
    );
  });

  /*
   * What the restarts and Job failures increases carry, and what a Workload
   * scope watches: said where the English page says it, with the same
   * names, code and links.
   */
  it("says what a Workload scope watches, under the scope table, as the English page does", () => {
    for (const markdown of [
      englishPage(KUBERNETES),
      readPage(language, KUBERNETES),
    ]) {
      const between: Array<string> = afterScopeTable(markdown);

      expect({ language, paragraphs: between.length }).toEqual({
        language,
        paragraphs: 1,
      });
      // The names of the workloads stay as Kubernetes writes them.
      for (const name of ["Deployment", "ReplicaSet", "Job"]) {
        expect(between[0]).toContain(name);
      }
    }
  });

  /*
   * Proxmox's page lists the catalog under one heading per group of its
   * Custom Metric picker, in the picker's order. The picker heads its
   * groups in the reader's words since the catalog's categories are keys
   * (#8653), so each heading says it as the picker does.
   */
  it("heads each table of Proxmox's metrics as the Custom Metric picker heads its group", () => {
    const english: Array<DocsHeading> = scanMarkdown(
      englishPage(PROXMOX),
    ).headings;
    const translated: Array<DocsHeading> = scanMarkdown(
      readPage(language, PROXMOX),
    ).headings;
    const start: number = english.findIndex((heading: DocsHeading): boolean => {
      return heading.level === 2 && heading.text === "Collected Metrics";
    });

    expect(start).toBeGreaterThan(-1);
    expect(translated.length).toBe(english.length);

    getAllProxmoxMetricCategories().forEach(
      (category: ProxmoxMetricCategory, index: number) => {
        const label: string = getProxmoxMetricCategoryLabel(category);

        expect(english[start + 1 + index]?.text).toBe(label);
        expect({
          category,
          heading: translated[start + 1 + index]?.text,
        }).toEqual({ category, heading: drawnActionLabel(language, label) });
      },
    );
  });

  it("says the increases carry what the counts carry, naming each count, as the English page does", () => {
    // The line that names the increase, in the page's own words for it (#8353).
    const note: (markdown: string, increase: string) => string = (
      markdown: string,
      increase: string,
    ): string => {
      return (
        markdown.split("\n").find((line: string): boolean => {
          return line.includes(`**${increase}**`);
        }) || ""
      );
    };
    const english: string = note(
      englishPage(KUBERNETES),
      "Job Failed Pods (Increase)",
    );
    const translated: string = note(
      readPage(language, KUBERNETES),
      drawnActionLabel(language, "Job Failed Pods (Increase)"),
    );

    for (const count of ["Container Restarts", "Job Failed Pods"]) {
      const name: string = `**${drawnActionLabel(language, count)}**`;

      expect({ name, times: occurrences(translated, name) }).toEqual({
        name,
        times: occurrences(english, `**${count}**`),
      });
    }
    expect(occurrences(english, "**Container Restarts**")).toBe(2);
    expect(occurrences(english, "**Job Failed Pods**")).toBe(2);
  });

  it("says in the troubleshooting entries what a monitor scoped to a workload needs, as the English page does", () => {
    for (const [code, mentions] of [
      [
        "`k8s.container.restarts.increase`",
        "](/docs/monitor/kubernetes-agent#",
      ],
      ["`k8s.job.failed_pods.increase`", "CronJob"],
    ] as Array<[string, string]>) {
      const english: string = troubleshootingEntry(
        englishPage(KUBERNETES),
        code,
      );
      const translated: string = troubleshootingEntry(
        readPage(language, KUBERNETES),
        code,
      );

      expect({
        code,
        mentions,
        times: occurrences(translated, mentions),
      }).toEqual({
        code,
        mentions,
        times: occurrences(english, mentions),
      });
      expect(occurrences(translated, code)).toBe(occurrences(english, code));
    }
  });
});

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/*
 * The paragraphs between the Resource scope table - the one table whose
 * Cluster row has no filter, a dash - and the heading after it.
 */
function afterScopeTable(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const clusterRow: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("| ") && line.endsWith(" | — |");
  });
  expect(clusterRow).toBeGreaterThan(-1);
  let at: number = clusterRow;

  while (at < lines.length && (lines[at] as string).startsWith("| ")) {
    at++;
  }

  const paragraphs: Array<string> = [];

  for (; at < lines.length; at++) {
    const line: string = lines[at] as string;

    if (line.startsWith("#")) {
      break;
    }
    if (line.trim()) {
      paragraphs.push(line);
    }
  }

  return paragraphs;
}

// The :::details troubleshooting entry that names `code` and the allowlist.
function troubleshootingEntry(markdown: string, code: string): string {
  return (
    markdown
      .split(":::details ")
      .slice(1)
      .map((entry: string): string => {
        return entry.substring(0, entry.indexOf("\n:::"));
      })
      .find((entry: string): boolean => {
        return (
          entry.includes(code) && entry.includes("`filters.metrics.include`")
        );
      }) || ""
  );
}

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
    const hindiMenu: Record<string, unknown> = (
      dashboardLocale("hi")["navbar"] as { items: Record<string, unknown> }
    ).items;

    /*
     * The menu's item is read from navbar.items: Hindi's said होस्ट्स over
     * a page titled होस्ट until #8229 made the menu say its page's title.
     */
    expect(
      drawnPath("hi", ["Products", "Infrastructure", "Hosts", "All Hosts"]),
    ).toBe(
      [
        drawnActionLabel("hi", "Products"),
        drawnActionLabel("hi", "Infrastructure"),
        hindiMenu["hostsTitle"],
        drawnActionLabel("hi", "All Hosts"),
      ].join(PATH_SEPARATOR),
    );
    expect(hindiMenu["hostsTitle"]).toBe("होस्ट");
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
    // The bare word has its own key too, which reads the same.
    expect(drawnActionLabel("de", "Low")).toBe("Niedrig");
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
        "# Title\n\n条件 “检查 _监视器名称_ 是否离线”。",
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

  it("quote the criteria names and the incident a new Docker monitor creates, in the reader's words (#8526)", () => {
    expect(defaultCriteriaText(MonitorType.Docker, "en")).toEqual({
      names: [
        "Check if _monitor name_ is offline",
        "Check if _monitor name_ is online",
      ],
      titles: ["_monitor name_ is offline"],
    });
    expect(defaultCriteriaText(MonitorType.Docker, "de")).toEqual({
      names: [
        "Prüfen, ob _Monitorname_ offline ist",
        "Prüfen, ob _Monitorname_ online ist",
      ],
      titles: ["_Monitorname_ ist offline"],
    });
    // The English row the German page had before #8526 misses all three.
    expect(
      missingDefaultCriteriaText(
        "| 1 | Check if _monitor name_ is offline | Keine Daten | Meldet den Vorfall „_monitor name_ is offline“. |\n| 2 | Check if _monitor name_ is online | Daten | — |",
        defaultCriteriaText(MonitorType.Docker, "de"),
      ),
    ).toHaveLength(3);
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
