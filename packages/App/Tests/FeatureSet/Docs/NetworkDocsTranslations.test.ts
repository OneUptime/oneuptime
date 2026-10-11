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
import { drawnActionLabel, isActionLabel } from "./DocsDashboardLabels";
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
  FILLED_TEMPLATES,
  LABELS_WITH_A_TAIL,
  LabelTail,
  NETWORK_DEVICE_PAGE,
  NETWORK_SITES_PAGE,
  NETWORK_VENDOR_GUIDES_PAGE,
  PATH_SEPARATOR,
  PERSIAN_PATH_SEPARATOR,
  VERDICT_HEADLINES,
  anchorInLanguage,
  drawnNetworkLabel,
  drawnPath,
  drawnStart,
  isVerdict,
} from "./NetworkDocsLabels";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 17b: the Network Device Monitor, Network Sites and
 * Network Vendor Guides pages in every docs language. Each translation says
 * what the English page says:
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
 *     locale, Persian included (NetworkDocsLabels.drawnNetworkLabel). A few
 *     are drawn from a longer string and named by its start: the Bound
 *     monitor option, the vendor template switch, Import Selected, the
 *     Target Prefix field and the table editor's placeholders.
 *   - A menu path is drawn segment by segment: one bold span with " → "
 *     between the segments, or, in Persian, a bold span per segment with
 *     " > " between them.
 *   - The Overview's verdicts are quoted as the Overview words them, with a
 *     number in them, in any plural form the locale has.
 *   - What every Dashboard shows in English stays English: criteria names
 *     (the criteria form has no locale key for them), records the product
 *     creates with English names, and labels with no locale key
 *     (SHOWN_IN_ENGLISH); so do permission names (PERMISSIONS), the labels
 *     of other products' consoles (OTHER_CONSOLES) and names of products,
 *     vendors and vendor templates (NAMES).
 *
 * The pages' own bold leads are PROSE_LEADS, which a translation words
 * freely. A new bold word on these English pages fails "know every bold
 * word" until it is in one of the lists.
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

const DEVICE: string = NETWORK_DEVICE_PAGE;
const SITES: string = NETWORK_SITES_PAGE;
const VENDORS: string = NETWORK_VENDOR_GUIDES_PAGE;

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: DEVICE, navTitle: "Network Device Monitor" },
  { page: SITES, navTitle: "Network Sites (Health Rollup & Uptime)" },
  {
    page: VENDORS,
    navTitle: "Network Vendor Guides (Sophos, Extreme, Cambium)",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [DEVICE]: [
    // Criteria names: the criteria form's Filter Type options.
    "SNMP OID Value",
    "SNMP OID Exists",
    "SNMP Table Row Is Unhealthy",
    "SNMP Transceiver Reading",
    "SNMP Trap Received (Trap OID)",
    "SNMP Trap Varbind Value",
    // A criteria as the form shows it: a template column, a filter type, a number.
    "Noise Floor Greater Than -80",
    // Review Results' label for a host found without a name.
    "No name found",
    // The template and the policy the recommended policy creates, named in English.
    "Network device alert pack (recommended)",
    "Alert on every device",
  ],
  // The Health Rollup card's second policy has no locale key.
  [SITES]: ["Percentage of devices down"],
  [VENDORS]: [
    // Criteria the recommended alerts create, named after their tables.
    "IPsec Tunnels: row unhealthy",
    "Fabric Adjacencies (IS-IS): row unhealthy",
    // Criteria names and filter types.
    "SNMP Table Row Is Unhealthy",
    "SNMP Interface Is Down",
    "SNMP Interface Utilization (in %)",
    "SNMP Trap Received (Trap OID)",
    "SNMP Trap Varbind Value",
    "SNMP Table Value",
    "Log Count",
    "Greater Than",
  ],
};

// Permission names, which the docs write as the product names them, in English.
const PERMISSIONS: Record<string, Array<string>> = {
  [DEVICE]: ["Create Network Device Diagnostic"],
};

/*
 * Labels and paths of other products' consoles, which those consoles show
 * in English: the Sophos Firewall's and cnMaestro's.
 */
const OTHER_CONSOLES: Record<string, Array<string>> = {
  [VENDORS]: [
    "Administration → SNMP",
    "System services → Log settings",
    "Event",
    "SD-WAN",
    "Configuration → Wi-Fi Profiles → AP Groups → Management → SNMP",
  ],
};

// Names of vendors, products and vendor templates, kept as written.
const NAMES: Record<string, Array<string>> = {
  [DEVICE]: [
    "Cambium",
    "Ubiquiti UniFi",
    "HPE Aruba Instant",
    "HPE Aruba Mobility Controller",
    "Extreme IQ Engine",
    "Extreme Wireless Controller",
    "TP-Link Omada",
    "Juniper Mist",
  ],
  [VENDORS]: [
    "Sophos Firewall (SFOS / XGS)",
    "Extreme Networks EXOS / Switch Engine",
    "Extreme Networks Fabric Engine / VOSS",
    "Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH)",
    "Cambium Networks cnMatrix",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them.
 */
const PROSE: Record<string, Array<string>> = {};

/*
 * The bold leads of the pages' own lists and sentences: neither Dashboard
 * labels nor shown in English, so a translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [DEVICE]: [
    "A probe that can reach the device.",
    "SNMP, for more than ping.",
    "Traps, syslog and flows.",
    "adjust",
    "Who may run a rule.",
    "Register everything, add credentials where you can.",
    "Set monitoring defaults on your sites.",
    "Prefer credential profiles to per-device credentials, and SNMPv3 to v2c.",
    "Discover, then import.",
    "Write a fleet's alerting down as a policy.",
    "Register devices by the address they send traps from",
    "Keep interface walking on for switches and routers, and turn on Collect Connected Endpoints on each site's switches and router.",
    "Reserve the bound-monitor override for gear a probe cannot reach.",
  ],
  [VENDORS]: ["Port health.", "Path quality.", "Traffic."],
};

// The Overview's verdict table: under this heading of the English page.
const OVERVIEW_HEADING: string = "## The Network Overview";

// Tab labels are protocol names, the same in every language.
const TAB_LINE: RegExp = /^@tab\s+(.+)$/;

const ONLY_CODE: RegExp = /^`[^`]+`$/;
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const BOLD_CELL: RegExp = /^\*\*([^*]+)\*\*$/;
/*
 * A number as a table states it: 85, 76.5, 32,768. A translation may write
 * its language's decimal mark or digit group: 76,5, ۷۶٫۵, 32 768, 32.768.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const DIGIT_GROUP: RegExp = /(\d)[\s\u00a0\u202f.,'\u066c](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;

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
  return (
    isActionLabel(english) ||
    Boolean(LABELS_WITH_A_TAIL[english]) ||
    Boolean(FILLED_TEMPLATES[english])
  );
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

// The table under a heading of the English page: its index among the page's tables.
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
    // Who may run a network rule: the auto import rules section.
    from: "configuration/run-rules-now",
    to: DEVICE,
    anchor: "importing-automatically-with-auto-import-rules",
  },
  {
    // The variables a ping-only poll fills in.
    from: "monitor/incident-alert-templating",
    to: DEVICE,
    anchor: "what-a-poll-actually-does",
  },
  {
    from: SITES,
    to: DEVICE,
    anchor: "snmp-credentials-and-credential-profiles",
  },
  { from: VENDORS, to: DEVICE, anchor: "snmp-tables" },
  { from: VENDORS, to: DEVICE, anchor: "recommended-alert-pack" },
  { from: VENDORS, to: DEVICE, anchor: "alert-policies" },
  { from: VENDORS, to: DEVICE, anchor: "supported-wi-fi-vendors" },
  { from: DEVICE, to: SITES, anchor: "monitoring-defaults" },
];

interface ColumnWideDiagram {
  page: string;
  // Its place among the page's diagrams.
  diagram: number;
  title: string;
  widestLine: number;
}

/*
 * Three diagrams fill the 590px docs column, and fit it in every language
 * only with their labels broken into short lines. Each is held to the widest
 * label line measured to fit, in a browser, in every language, counting a
 * Chinese, Japanese or Korean character twice: a label put back on one line
 * runs its diagram off the column.
 */
const COLUMN_WIDE_DIAGRAMS: ReadonlyArray<ColumnWideDiagram> = [
  {
    page: DEVICE,
    diagram: 0,
    title: "How a network device is watched",
    widestLine: 28,
  },
  {
    page: DEVICE,
    diagram: 1,
    title: "Which credentials a walk uses",
    widestLine: 24,
  },
  {
    page: SITES,
    diagram: 0,
    title: "Health rolls up the site tree",
    widestLine: 14,
  },
];

const DIAGRAM_LABEL: RegExp = /"([^"]*)"/g;
const LABEL_BREAK: string = "<br/>";
const WIDE_CHARACTER: RegExp = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

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

  it("list permissions, other consoles' labels and names the English pages really make bold", () => {
    for (const lists of [PERMISSIONS, OTHER_CONSOLES, NAMES]) {
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

  it("know every bold word on the English pages: a label, a verdict, shown in English, a permission, another console's, a name, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isDrawnLabel(span) &&
            !VERDICT_HEADLINES[span] &&
            !listed(SHOWN_IN_ENGLISH, page).includes(span) &&
            !listed(PERMISSIONS, page).includes(span) &&
            !listed(OTHER_CONSOLES, page).includes(span) &&
            !listed(NAMES, page).includes(span) &&
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

  it("know every path on the English pages as a path of Dashboard labels, or another console's", () => {
    for (const page of PAGE_NAMES) {
      const unknown: Array<string> = menuPaths(englishPage(page)).filter(
        (path: string): boolean => {
          return (
            !listed(OTHER_CONSOLES, page).includes(path) &&
            !segmentsOf(path).every(isDrawnLabel)
          );
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

  it("quote every verdict of the Overview table, and only those", () => {
    const index: number = tableIndexUnder(DEVICE, OVERVIEW_HEADING);
    const table: Array<Array<string>> = tables(englishPage(DEVICE))[
      index
    ] as Array<Array<string>>;

    expect(
      table.slice(1).map((cells: Array<string>): string => {
        return (cells[0] as string).replace(BOLD_CELL, "$1");
      }),
    ).toEqual(Object.keys(VERDICT_HEADLINES));
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

    it("keeps the components, and the tab labels, which are protocol names", () => {
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
      const keptAsWritten: Array<string> = [
        ...listed(PROSE, entry.page),
        ...listed(OTHER_CONSOLES, entry.page),
        ...listed(NAMES, entry.page),
        ...listed(PERMISSIONS, entry.page),
        ...listed(SHOWN_IN_ENGLISH, entry.page),
      ];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isDrawnLabel(label) && !keptAsWritten.includes(label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnNetworkLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnNetworkLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .filter((path: string): boolean => {
          return !listed(OTHER_CONSOLES, entry.page).includes(path);
        })
        .map((path: string): string => {
          return drawnPath(language, segmentsOf(path));
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what every Dashboard, and other consoles, show in English, and names, as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(SHOWN_IN_ENGLISH, entry.page),
        ...listed(PERMISSIONS, entry.page),
        ...listed(OTHER_CONSOLES, entry.page),
        ...listed(NAMES, entry.page),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });
  });

  it("quotes the Overview's verdicts as this language's Overview words them, in the same order", () => {
    const index: number = tableIndexUnder(DEVICE, OVERVIEW_HEADING);
    const table: Array<Array<string>> = tables(readPage(language, DEVICE))[
      index
    ] as Array<Array<string>>;
    const quoted: Array<string> = table
      .slice(1)
      .map((cells: Array<string>): string => {
        return toLatinDigits(
          (cells[0] as string).replace(BOLD_CELL, "$1").trim(),
        );
      });

    expect(
      Object.keys(VERDICT_HEADLINES).map(
        (verdict: string, row: number): boolean => {
          return isVerdict(language, verdict, quoted[row] as string);
        },
      ),
    ).toEqual(
      Object.keys(VERDICT_HEADLINES).map((): boolean => {
        return true;
      }),
    );
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
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add line-for-line shape, menu paths in two scripts, labels drawn from a
 * longer string, the Overview's verdicts, links into them, and the width of
 * a diagram's label lines.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label, and draw it in one bold span, or one per segment in Persian", () => {
    const markdown: string =
      "**Network → Settings → Device Roles** and **Add Device**";

    expect(menuPaths(markdown)).toEqual(["Network → Settings → Device Roles"]);
    expect(boldLabels(markdown)).toEqual(["Add Device"]);
    expect(drawnPath("de", ["Network", "Settings", "Device Roles"])).toBe(
      `**${[
        drawnActionLabel("de", "Network"),
        drawnActionLabel("de", "Settings"),
        drawnActionLabel("de", "Device Roles"),
      ].join(PATH_SEPARATOR)}**`,
    );
    expect(drawnPath("fa", ["Network", "Settings"])).toBe(
      `**${drawnActionLabel("fa", "Network")}**${PERSIAN_PATH_SEPARATOR}**${drawnActionLabel("fa", "Settings")}**`,
    );
    expect(drawnPath("en", ["Network", "Map"])).toBe("**Network → Map**");
  });

  it("name a label drawn from a longer string by its start", () => {
    expect(drawnNetworkLabel("en", "Bound monitor")).toBe("Bound monitor");
    expect(drawnNetworkLabel("de", "Bound monitor")).toBe(
      drawnActionLabel(
        "de",
        "Bound monitor — an existing monitor's status is this device's status (override)",
      ).split(" — ")[0],
    );
    expect(
      drawnStart("es", {
        key: "Bound monitor — an existing monitor's status is this device's status (override)",
        tail: LabelTail.Explanation,
      }),
    ).toBe("Monitor vinculado");
    expect(drawnNetworkLabel("ja", "Target Prefix")).not.toContain("（");
    expect(drawnNetworkLabel("ja", "Import Selected")).not.toContain("count");
    expect(
      drawnNetworkLabel(
        "zh-CN",
        "Apply each SNMP host's vendor template on its first poll (recommended)",
      ),
    ).not.toContain("—");
    expect(drawnNetworkLabel("ja", "Uptime (24h)")).toContain("24");
  });

  it("read a verdict with any number, in the language's plural forms", () => {
    expect(isVerdict("en", "3 devices are down", "3 devices are down")).toBe(
      true,
    );
    expect(isVerdict("en", "3 devices are down", "1 device is down")).toBe(
      true,
    );
    expect(
      isVerdict("en", "3 devices are down", "3 sites need attention"),
    ).toBe(false);
    expect(
      isVerdict("en", "All 40 devices are up", "All 12 devices are up"),
    ).toBe(true);
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
    expect(numbersIn("At most 32,768 addresses")).toEqual(["32768"]);
    expect(numbersIn("Höchstens 32.768 Adressen")).toEqual(["32768"]);
    expect(numbersIn("au plus 32 768 adresses")).toEqual(["32768"]);
    expect(numbersIn("حداکثر ۳۲٬۷۶۸ نشانی")).toEqual(["32768"]);
    expect(numbersIn("Über 0,9 | 76,5")).toEqual(["0.9", "76.5"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string = "**Probe** / `161** on the device";

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

  it("read the tab labels of a page", () => {
    expect(
      tabLabels(
        [":::tabs", "@tab SNMPv3", "x", "@tab SNMP v2c", ":::"].join("\n"),
      ),
    ).toEqual(["SNMPv3", "SNMP v2c"]);
  });

  it("read a diagram's label lines, and count a Chinese, Japanese or Korean character twice", () => {
    const diagram: string = [
      "flowchart TB",
      '    Data["Status, metrics,<br/>interfaces, map"]',
      '    Probe -->|"Ping,<br/>every poll"| Device',
      '    Site{"站点上有<br/>默认配置文件吗？"}',
      "    Data --> Monitor",
    ].join("\n");

    expect(labelLines(diagram)).toEqual([
      "Status, metrics,",
      "interfaces, map",
      "Ping,",
      "every poll",
      "站点上有",
      "默认配置文件吗？",
    ]);
    expect(lineWidth("Status, metrics,")).toBe(16);
    expect(lineWidth("站点上有")).toBe(8);
    expect(lineWidth("默认配置文件吗？")).toBe(16);
    expect(lineWidth("ネットワーク")).toBe(12);
    expect(lineWidth("디바이스")).toBe(8);
    expect(lineWidth("Устройства")).toBe(10);
    // The label the device diagram had on one line, which ran it off the column.
    expect(lineWidth("Status, metrics, interfaces, map")).toBeGreaterThan(
      (COLUMN_WIDE_DIAGRAMS[0] as ColumnWideDiagram).widestLine,
    );
  });
});
