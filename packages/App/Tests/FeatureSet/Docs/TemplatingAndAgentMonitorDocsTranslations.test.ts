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
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { getAllIoTAlertTemplates } from "Common/Types/Monitor/IotAlertTemplates";
import { getAllStorageArrayAlertTemplates } from "Common/Types/Monitor/StorageArrayAlertTemplates";
import { getAllVMwareAlertTemplates } from "Common/Types/Monitor/VMwareAlertTemplates";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 17a: Incident & Alert Templating, the Kubernetes agent's
 * Helm install, and the Storage Array, IoT Device and VMware monitors, in
 * every docs language. Each translation says what the English page says:
 *
 *   - line for line: the same number of lines, with each heading, table row
 *     and code fence on the English one's line, so a reader can lay the two
 *     side by side, and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code,
 *     tables, lists, steps and cards, and links that land on a heading in
 *     the reader's language;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - the product named the way that language's product draws it.
 *
 * "The way the product draws it" has these sources on these pages:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel). A menu path is drawn
 *     segment by segment, and a product in the Products menu by the menu's
 *     own title for it (its navbar.items key).
 *   - The template pickers show every template under its English name: the
 *     Dashboard has no key for any of them, so every translation keeps the
 *     names. Their severities and categories are drawn like labels.
 *   - The sensitivity options a criteria offers are written short ("**Low**
 *     (4σ)"); a translation names the start of the option the Dashboard
 *     draws, as on the other infrastructure monitor pages.
 *   - Names every Dashboard shows in English (no locale key) stay English
 *     (SHOWN_IN_ENGLISH), and so do the labels of other products' consoles,
 *     vSphere's and Purity's (OTHER_CONSOLES), and names of products and
 *     versions (NAMES).
 *
 * Bold words that are Dashboard labels only by coincidence are PROSE, with
 * why; the pages' own bold leads are PROSE_LEADS, which a translation words
 * freely. A new bold word on these English pages fails until it is in one
 * of the lists.
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

const TEMPLATING: string = "monitor/incident-alert-templating";
const KUBERNETES_AGENT: string = "monitor/kubernetes-agent";
const STORAGE: string = "monitor/storage-array-monitor";
const IOT: string = "monitor/iot-device-monitor";
const VMWARE: string = "monitor/vmware-monitor";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: TEMPLATING, navTitle: "Incident & Alert Templating" },
  { page: KUBERNETES_AGENT, navTitle: "Kubernetes Agent (Helm install)" },
  { page: STORAGE, navTitle: "Storage Array Monitor" },
  { page: IOT, navTitle: "IoT Device Monitor" },
  { page: VMWARE, navTitle: "VMware Monitor" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

const MONITOR_PAGES: Array<string> = [STORAGE, IOT, VMWARE];

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
 * locale has no key for them, by page.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [STORAGE]: [...FORM_NAMES, ...CRITERIA_NAMES],
  [IOT]: [
    ...FORM_NAMES,
    // A template's name, and the one check the criteria offer.
    "Device Offline",
    "Metric Value",
    ...CRITERIA_NAMES,
  ],
  [VMWARE]: [...FORM_NAMES, ...CRITERIA_NAMES],
};

/*
 * Labels of other products' consoles, which those consoles show in English:
 * vSphere's role and permission option, and Purity's built-in role.
 */
const OTHER_CONSOLES: Record<string, Array<string>> = {
  [STORAGE]: ["readonly"],
  [VMWARE]: ["Read-Only", "Propagate to children"],
};

// Names of products and versions, kept as written.
const NAMES: Record<string, Array<string>> = {
  [KUBERNETES_AGENT]: [
    "Helm 3",
    "EKS on EC2",
    "GKE Standard",
    "AKS",
    "GKE Autopilot",
    "EKS Fargate",
    "Linux 5.8",
    "Linux 5.10",
    "Python",
    ".NET",
  ],
  [TEMPLATING]: ["Slack", "Microsoft Teams"],
};

/*
 * The short sensitivity names the criteria tables write ("**Low** (4σ)"),
 * and the option the Dashboard draws for each.
 */
const SENSITIVITY_OPTIONS: Record<string, string> = {
  Low: "Low (4σ — egregious deviations only)",
  Medium: "Medium (3σ — recommended)",
  High: "High (2σ — noisier, very stable services)",
};

const SENSITIVITY_SHORT: Array<string> = Object.keys(SENSITIVITY_OPTIONS);

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them.
 */
const PROSE: Record<string, Array<string>> = {
  /*
   * "- **Email**: each description...": the lead of the email channel's
   * item; "by ping **or** SNMP": the word, stressed.
   */
  [TEMPLATING]: ["Email", "or"],
  /*
   * "**Filter** is the label filter...": the metric table's column; "capacity
   * templates **Max** of its own utilization": the aggregation, as the
   * tables write it.
   */
  [STORAGE]: ["Filter", "Max", ...SENSITIVITY_SHORT],
  [IOT]: SENSITIVITY_SHORT,
  [VMWARE]: SENSITIVITY_SHORT,
};

/*
 * The bold leads of the pages' own lists and sentences: neither Dashboard
 * labels nor shown in English, so a translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [TEMPLATING]: [
    "The title is plain text.",
    "The description and remediation notes are Markdown.",
    "A grouped monitor fills in each incident for its own series.",
    "The incident's or alert's page",
    "SMS, phone calls, push notifications, WhatsApp and Telegram",
    "last segment",
    "walk's",
    "`isOnline` is the only variable above that a ping-only device fills in",
  ],
  [KUBERNETES_AGENT]: [
    "An ingestion key.",
    "A name for the cluster",
    "Outbound HTTPS",
    "Tailer image version.",
    "Severity filtering.",
    "This is off by default.",
    "desynchronizes",
    "Off by default.",
    "JSON log line",
    "Any other log line",
    "inside the process",
    ".NET apps are the most exposed:",
    "Only JSON lines get a `trace_id`.",
    "Buffered output breaks the link",
    "Profiling is off by default:",
    "eBPF span metrics have new names.",
    "The kernel is too old, or has no BTF.",
    "Privileged pods are refused.",
    "OBI runs, but no traces arrive.",
  ],
  [STORAGE]: [
    "Install the Storage Array Agent",
    "Check the array is registered.",
    "one",
    "`dimension`",
    "`space`",
    "label",
    "Max above 0 fires and 0 recovers",
    "every",
    "Open alerts and hardware states use Max",
    "Every per-object template groups by the object's own label",
    "Latency templates use Avg",
    "Hardware Component Unhealthy uses Min",
    "A volume is slow:",
    "The array is filling up:",
    "A host runs on one controller:",
    "A FlashBlade file system is almost full:",
  ],
  [IOT]: [
    "Get your devices reporting.",
    "Check the fleet is registered.",
    "Register the devices you expect",
    "Device Offline reads 30 minutes",
    "High Temperature uses Max",
    "High CPU Usage compares a ratio:",
    "The gateway reports it",
    "MQTT Last Will",
    "The device is registered",
  ],
  [VMWARE]: [
    "The VMware Agent",
    "A probe",
    "Collect the vCenter's metrics",
    "Check the vCenter is registered.",
    "and",
    "resource attributes",
    "past 15 minutes",
    "Utilization templates use Avg:",
    "Latency templates use Max:",
    "Count and state templates use Max",
    "Every template groups by the object's own identity attribute",
    "Thresholds are pinned to their unit",
    "microseconds",
    "A host is saturated:",
    "A datastore is filling up:",
    "A cluster lost a host:",
    "Fewer VMs run than expected:",
    "A VM is being host-swapped:",
  ],
};

const PATH_SEPARATOR: string = " → ";

/*
 * The Products menu's own titles for the products a path opens: the menu
 * draws each from its navbar.items key, not the flat label key.
 */
const PRODUCTS_MENU_KEYS: Record<string, string> = {
  Kubernetes: "kubernetesTitle",
  Traces: "tracesTitle",
  "Performance Profiles": "performanceProfilesTitle",
  "Storage Arrays": "storageArraysTitle",
  IoT: "iotTitle",
  VMware: "vmwareTitle",
};

const PRODUCTS: string = "Products";
const INFRASTRUCTURE: string = "Infrastructure";

// The template tables, by page, with the picker's templates in order.
const TEMPLATE_TABLES: Record<
  string,
  { heading: string; names: () => Array<string> }
> = {
  [IOT]: {
    heading: "## Pre-built Alert Templates",
    names: (): Array<string> => {
      return getAllIoTAlertTemplates().map((t: { name: string }) => {
        return t.name;
      });
    },
  },
  [VMWARE]: {
    heading: "## Pre-built Alert Templates",
    names: (): Array<string> => {
      return getAllVMwareAlertTemplates().map((t: { name: string }) => {
        return t.name;
      });
    },
  },
};

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const ONLY_CODE: RegExp = /^`[^`]+`$/;
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
// Where a drawn sensitivity option's name ends: at its parenthesis.
const OPTION_DETAIL: RegExp = /\s*[(（].*$/;
/*
 * A number as a table states it: 85, 76.5, 20 000. A translation may write
 * its language's decimal mark or digit group: 76,5, ۷۶٫۵, 20 000.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;
const DIGIT_GROUP: RegExp = /(\d)[\s\u00a0\u202f.](\d{3})(?!\d)/g;

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
    });
}

/*
 * A menu path's segment as that language draws it: a product in the
 * Products menu is the menu's own title for it.
 */
function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const key: string | undefined = PRODUCTS_MENU_KEYS[segment];
  const productIndex: number = segments[1] === INFRASTRUCTURE ? 2 : 1;

  if (
    language !== "en" &&
    segments[0] === PRODUCTS &&
    index === productIndex &&
    key
  ) {
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

// The table under a heading of the English page: the index among the page's tables.
function tableIndexUnder(page: string, heading: string): number {
  const english: string = englishPage(page);
  const at: number = english.indexOf(`\n${heading}\n`);

  expect(at).toBeGreaterThan(0);

  return tables(english.slice(0, at)).length;
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

function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

/*
 * The anchor of the heading of a page in a language that sits where the
 * English page's heading with this anchor sits.
 */
function anchorInLanguage(
  language: string,
  page: string,
  englishAnchor: string,
): string | null {
  const english: Array<DocsHeading> = sections(englishPage(page));
  const index: number = english.findIndex((heading: DocsHeading): boolean => {
    return heading.slug === englishAnchor;
  });

  if (index < 0) {
    return null;
  }

  return sections(readPage(language, page))[index]?.slug || null;
}

interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
  // How many links of the page name that heading.
  count: number;
}

/*
 * Links into the templating page from pages translated before it: they
 * name the heading in the English section's place, in every language.
 */
const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    // The Screenshots paragraph and the Next steps card.
    from: "monitor/synthetic-monitor",
    to: TEMPLATING,
    anchor: "showing-a-screenshot",
    count: 2,
  },
  {
    // The Criteria paragraph.
    from: "monitor/synthetic-monitor",
    to: TEMPLATING,
    anchor: "synthetic-monitors",
    count: 1,
  },
  {
    // Images in messages: the screenshot a description can carry.
    from: "self-hosted/slack-integration",
    to: TEMPLATING,
    anchor: "showing-a-screenshot",
    count: 1,
  },
];

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      OTHER_CONSOLES,
      NAMES,
      PROSE,
      PROSE_LEADS,
      TEMPLATE_TABLES,
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

      for (const name of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, bold: true, label: false }).toEqual({
          page,
          name,
          bold: labels.includes(name),
          label: isActionLabel(name),
        });
      }
    }
  });

  it("list other consoles' labels and names the English pages really make bold", () => {
    for (const lists of [OTHER_CONSOLES, NAMES]) {
      for (const page of Object.keys(lists)) {
        const labels: Array<string> = boldLabels(englishPage(page));

        for (const name of lists[page] as Array<string>) {
          expect({ page, name, bold: labels.includes(name) }).toEqual({
            page,
            name,
            bold: true,
          });
        }
      }
    }
  });

  it("know every bold word on the English pages: a label, shown in English, a name, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !(SHOWN_IN_ENGLISH[page] || []).includes(span) &&
            !(OTHER_CONSOLES[page] || []).includes(span) &&
            !(NAMES[page] || []).includes(span) &&
            !(PROSE_LEADS[page] || []).includes(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list as leads only bold words the English page has, that are no Dashboard label", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page, lead, found: true, label: false }).toEqual({
          page,
          lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("know the sensitivity options as the criteria form draws them, and the pages that write them short", () => {
    for (const option of Object.values(SENSITIVITY_OPTIONS)) {
      expect(isActionLabel(option)).toBe(true);
    }

    for (const page of MONITOR_PAGES) {
      expect(englishPage(page)).toContain(
        "**Low** (4σ), **Medium** (3σ, the default) or **High** (2σ).",
      );
    }
  });

  it("name links that the English pages really have, to headings the English pages really have", () => {
    for (const link of LINKS_INTO_THESE_PAGES) {
      expect({
        link,
        linked:
          englishPage(link.from).split(`](/docs/${link.to}#${link.anchor})`)
            .length - 1,
        heading: anchorInLanguage("en", link.to, link.anchor),
      }).toEqual({ link, linked: link.count, heading: link.anchor });
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

  it.each(MONITOR_PAGES)(
    "%s says how many steps creating it takes, and has that many",
    (page: string) => {
      expect(stepCount(englishPage(page))).toBe(6);
      expect(englishPage(page)).toContain("): Six steps in the dashboard.");
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

    it("keeps the code in the first column of every table, row by row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          if (rowIndex > 0 && ONLY_CODE.test(row[0] as string)) {
            expect({
              table: index,
              row: rowIndex,
              cell: translated[index]?.[rowIndex]?.[0],
            }).toEqual({
              table: index,
              row: rowIndex,
              cell: row[0],
            });
          }
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
      const proseWords: Array<string> = PROSE[entry.page] || [];
      const keptWords: Array<string> = [
        ...(OTHER_CONSOLES[entry.page] || []),
        ...(NAMES[entry.page] || []),
      ];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isActionLabel(label) &&
            !proseWords.includes(label) &&
            !keptWords.includes(label)
          );
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

    it("keeps in English what every Dashboard, and other consoles, show in English, and names as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...(SHOWN_IN_ENGLISH[entry.page] || []),
        ...(OTHER_CONSOLES[entry.page] || []),
        ...(NAMES[entry.page] || []),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("names each sensitivity by the start of the option the Dashboard draws", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = MONITOR_PAGES.includes(entry.page)
        ? SENSITIVITY_SHORT.map((short: string): string => {
            return drawnSensitivity(language, short);
          }).filter((drawn: string): boolean => {
            return !translated.includes(`**${drawn}**`);
          })
        : [];

      expect(missing).toEqual([]);
    });

    it("quotes the default criteria and their incident exactly as a new monitor creates them", () => {
      if (!MONITOR_PAGES.includes(entry.page)) {
        return;
      }

      const translated: string = readPage(language, entry.page);

      for (const text of [
        "Check if _monitor name_ is offline",
        "Check if _monitor name_ is online",
        "_monitor name_ is offline",
      ]) {
        expect({ text, quoted: translated.includes(text) }).toEqual({
          text,
          quoted: true,
        });
      }
    });

    it("lists every template under the name the picker shows, with its numbers, severity and category as drawn", () => {
      const templates:
        | { heading: string; names: () => Array<string> }
        | undefined = TEMPLATE_TABLES[entry.page];

      if (!templates) {
        return;
      }

      const index: number = tableIndexUnder(entry.page, templates.heading);
      const englishTable: Array<Array<string>> = tables(english)[
        index
      ] as Array<Array<string>>;
      const translatedTable: Array<Array<string>> = tables(
        readPage(language, entry.page),
      )[index] as Array<Array<string>>;
      const header: Array<string> = englishTable[0] as Array<string>;

      expect(
        translatedTable.slice(1).map((cells: Array<string>): string => {
          return cells[0] as string;
        }),
      ).toEqual(templates.names());

      englishTable.slice(1).forEach((cells: Array<string>, row: number) => {
        const translatedCells: Array<string> = translatedTable[
          row + 1
        ] as Array<string>;

        expect({
          template: cells[0],
          numbers: numbersIn(translatedCells.join(" | ")),
          severity: translatedCells[header.indexOf("Severity")],
          category: translatedCells[header.indexOf("Category")],
        }).toEqual({
          template: cells[0],
          numbers: numbersIn(cells.join(" | ")),
          severity: drawnActionLabel(
            language,
            cells[header.indexOf("Severity")] as string,
          ),
          category: drawnActionLabel(
            language,
            cells[header.indexOf("Category")] as string,
          ),
        });
      });
    });
  });

  it("the storage array tables keep every template's name, numbers, severity and category as drawn", () => {
    const english: string = englishPage(STORAGE);
    const translated: string = readPage(language, STORAGE);

    for (const heading of ["### FlashArray", "### FlashBlade"]) {
      const index: number = tableIndexUnder(STORAGE, heading);
      const englishTable: Array<Array<string>> = tables(english)[
        index
      ] as Array<Array<string>>;
      const translatedTable: Array<Array<string>> = tables(translated)[
        index
      ] as Array<Array<string>>;

      englishTable.slice(1).forEach((cells: Array<string>, row: number) => {
        const translatedCells: Array<string> = translatedTable[
          row + 1
        ] as Array<string>;

        expect({
          name: translatedCells[0],
          numbers: numbersIn(translatedCells.join(" | ")),
          category: translatedCells[1],
          severity: translatedCells[2],
        }).toEqual({
          name: cells[0],
          numbers: numbersIn(cells.join(" | ")),
          category: drawnActionLabel(language, cells[1] as string),
          severity: drawnActionLabel(language, cells[2] as string),
        });
      });
    }

    expect(getAllStorageArrayAlertTemplates().length).toBeGreaterThan(0);
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
        expect(
          readPage(language, link.from).split(`](/docs/${link.to}#${anchor})`)
            .length - 1,
        ).toBe(link.count);
      },
    );
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add line-for-line shape, menu paths, short sensitivity names, template
 * tables and links into them from other pages.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label, and draw a Products menu product by the menu's own title", () => {
    const markdown: string =
      "**Products → Infrastructure → Storage Arrays → All Storage Arrays** and **Products → Traces** and **Storage Array**";

    expect(menuPaths(markdown)).toEqual([
      ["Products", "Infrastructure", "Storage Arrays", "All Storage Arrays"],
      ["Products", "Traces"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Storage Array"]);
    // The Products menu draws "Storage Arrays" from its own key, not the flat one.
    expect(
      drawnPath("de", ["Products", "Infrastructure", "Storage Arrays"]),
    ).toBe(
      [
        drawnActionLabel("de", "Products"),
        drawnActionLabel("de", "Infrastructure"),
        (
          (dashboardLocale("de")["navbar"] as Record<string, unknown>)[
            "items"
          ] as Record<string, string>
        )["storageArraysTitle"],
      ].join(PATH_SEPARATOR),
    );
    expect(drawnPath("en", ["Products", "Traces"])).toBe("Products → Traces");
  });

  it("lay a translation beside its English page by what each line is", () => {
    const englishPage: string = [
      "# Title",
      "",
      "| A | B |",
      "| --- | --- |",
      "```bash",
      "x",
      "```",
    ].join("\n");
    const shifted: string = [
      "# Titel",
      "",
      "",
      "| A | B |",
      "| --- | --- |",
      "```bash",
      "x",
      "```",
    ].join("\n");

    expect(lineShape(englishPage)).toEqual([
      "#",
      "",
      "|",
      "|",
      "```",
      "",
      "```",
    ]);
    expect(lineShape(shifted)).not.toEqual(lineShape(englishPage));
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("Above 20 000 µs | At or below 18 000")).toEqual([
      "18000",
      "20000",
    ]);
    expect(numbersIn("بالای ۲۰ ۰۰۰ | ۰٫۹")).toEqual(["0.9", "20000"]);
    expect(numbersIn("Über 0,9 | 76,5")).toEqual(["0.9", "76.5"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string = "**Threshold** / `85** in the offline one";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
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

  it("name a sensitivity by the start of its drawn option", () => {
    expect(drawnSensitivity("de", "Low")).toBe("Niedrig");
    expect(drawnSensitivity("en", "Medium")).toBe("Medium");
  });
});
