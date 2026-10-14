import { NETWORK_EVENT_ALERT_TEMPLATE_COPY } from "../../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventAlertTemplateCopy";
import {
  NETWORK_EVENT_COPY,
  NETWORK_EVENT_KIND_TITLES,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventCopy";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  DocsLink,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnActionLabel, isActionLabel } from "./DocsDashboardLabels";
import {
  boldLabels,
  lineShape,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import {
  anchorProblems,
  boldSpans,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { anchorInLanguage } from "./NetworkDocsLabels";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventDefinition,
} from "Common/Types/NetworkEvent/NetworkEventType";
import { describe, expect, it } from "@jest/globals";

/*
 * The Network Events page in every docs language (#4728). Each translation
 * says what the English page says:
 *
 *   - line for line: the same number of lines, with each heading, table
 *     row and code fence on the English one's line, so the two can be laid
 *     side by side and a later English edit shows where it lands;
 *   - on each line, the inline code of the English line (attribute names,
 *     event names, settings, commands) and every number it states in
 *     digits - a port, a limit, a number of minutes;
 *   - the same code blocks, word for word: they are what a person pastes
 *     into a device;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - the product named the way that language's product draws it.
 *
 * "The way the product draws it", on this page:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel), on the line the English
 *     page names it.
 *   - An event's title, its kind and an alert's title, in the tables, are
 *     the Dashboard's too: the Events page lists events under those words.
 *   - What other products' consoles show in English stays English: the
 *     Sophos Firewall's, UniFi Network's and cnMaestro's labels
 *     (OTHER_CONSOLES), and a criteria name the Dashboard has no locale key
 *     for (SHOWN_IN_ENGLISH).
 *
 * The page's own bold leads are PROSE_LEADS, which a translation words
 * freely. A new bold word on the English page fails "know every bold word"
 * until it is a Dashboard label or in one of the lists.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE: string = "monitor/network-events";
const NAV_TITLE: string = "Network Events (Syslog and SNMP Traps)";
const ENGLISH: string = readPage("en", PAGE);

/*
 * Labels of other products' consoles, which those consoles show in
 * English, by the section that walks through the console.
 */
const OTHER_CONSOLES: Record<string, Array<string>> = {
  "### Sophos Firewall": [
    "System services",
    "Log settings",
    "Syslog servers",
    "Add",
    "Information",
    "SD-WAN",
  ],
  "### Ubiquiti UniFi": ["Integration", "System Logging / SIEM", "SIEM Server"],
  "### Cambium Networks": ["Info"],
};

const OTHER_CONSOLE_LABELS: Array<string> =
  Object.values(OTHER_CONSOLES).flat();

// A criteria name: the criteria form's Filter Type options have no locale key.
const SHOWN_IN_ENGLISH: Array<string> = ["SNMP Trap Received (Trap OID)"];

/*
 * The bold leads of the page's own steps and lists: neither Dashboard
 * labels nor shown in English, so a translation words them freely.
 */
const PROSE_LEADS: Array<string> = [
  "Use a probe on the device's network.",
  "Let syslog reach the probe.",
  "Set the probe as the device's syslog server.",
  "Check the device's address.",
  "Syslog over TLS",
  "Sharing parsers between projects.",
  "Events from SNMP traps other than the four standard ones.",
  "Cambium cnMatrix switches, Aruba mobility controllers and FortiGate in CEF mode.",
  "A live tail.",
  "Is the probe receiving anything?",
  "Firewalls and Docker.",
  "The probe's log.",
  "A global probe.",
  "Messages arrive, but no events.",
];

// The page's tables, in the order it has them.
enum PageTable {
  Vendors = 0,
  Events = 1,
  Attributes = 2,
  Settings = 3,
  Alerts = 4,
}

const FENCE_LINE: RegExp = /^\s*```/;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const NUMBER: RegExp = /\d+/g;
// A line that starts a list item, a table row, a heading, a component, an image or a quote.
const NOT_PARAGRAPH_TEXT: RegExp = /^\s*(?:[-*>|#:@]|\d+\.|!\[)/;
// The two places the Events page is found, as the first one is written.
const MENU_ARROW: string = " -> ";

// Whether a bold word of the English page is drawn as the Dashboard draws it.
function isDrawn(label: string): boolean {
  return (
    isActionLabel(label) &&
    !OTHER_CONSOLE_LABELS.includes(label) &&
    !SHOWN_IN_ENGLISH.includes(label)
  );
}

// A page's lines outside its code blocks; a line inside one reads as empty.
function proseLines(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;

      return "";
    }

    return inFence ? "" : line;
  });
}

// The inline code of one line, sorted.
function codeOf(line: string): Array<string> {
  return Array.from(line.matchAll(INLINE_CODE_SPAN))
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

// The numbers a line states in digits, in any language's digits.
function numbersOf(line: string): Array<string> {
  return Array.from(toLatinDigits(line).matchAll(NUMBER)).map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

// The numbers of `wanted` that `given` does not have, counting repeats.
function missingNumbers(
  wanted: Array<string>,
  given: Array<string>,
): Array<string> {
  const left: Array<string> = [...given];

  return wanted.filter((value: string): boolean => {
    const at: number = left.indexOf(value);

    if (at < 0) {
      return true;
    }

    left.splice(at, 1);

    return false;
  });
}

// The docs pages a line links to, without their anchors, in order.
function linkedPagesByLine(markdown: string): Record<number, Array<string>> {
  const byLine: Record<number, Array<string>> = {};

  for (const link of scanMarkdown(markdown).links) {
    const docsLink: DocsLink = link;
    const target: string = docsLink.target.split("#")[0] as string;

    (byLine[docsLink.line] = byLine[docsLink.line] || []).push(target);
  }

  return byLine;
}

// Whether a line is a paragraph's text, which a paragraph's next line would wrap.
function isParagraphText(line: string): boolean {
  return line.trim().length > 0 && !NOT_PARAGRAPH_TEXT.test(line);
}

function tableOf(markdown: string, table: PageTable): Array<Array<string>> {
  return (tables(markdown)[table] as Array<Array<string>>).slice(1);
}

function columnOf(
  markdown: string,
  table: PageTable,
  column: number,
): Array<string> {
  return tableOf(markdown, table).map((row: Array<string>): string => {
    return row[column] as string;
  });
}

// The section of the English page under a heading: its lines to the next heading.
function englishSection(heading: string): string {
  const lines: Array<string> = ENGLISH.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return index > start && line.startsWith("#");
    },
  );

  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

describe("the lists this test keeps", () => {
  const english: Array<string> = boldLabels(ENGLISH);

  it("name only bold words the English page has", () => {
    for (const name of [
      ...OTHER_CONSOLE_LABELS,
      ...SHOWN_IN_ENGLISH,
      ...PROSE_LEADS,
    ]) {
      expect({ name, bold: english.includes(name) }).toEqual({
        name,
        bold: true,
      });
    }
  });

  it("know every bold word on the English page: a Dashboard label, another console's, shown in English, or a lead", () => {
    const unlisted: Array<string> = english.filter((span: string): boolean => {
      return (
        !isDrawn(span) &&
        !OTHER_CONSOLE_LABELS.includes(span) &&
        !SHOWN_IN_ENGLISH.includes(span) &&
        !PROSE_LEADS.includes(span)
      );
    });

    expect(unlisted).toEqual([]);
  });

  /*
   * A name the Dashboard shows in English today and translates tomorrow
   * fails here: then every translation names it as drawn, and it leaves the
   * list.
   */
  it("keep in English only what the Dashboard has no label for, and call a lead only what is no label", () => {
    for (const name of [...SHOWN_IN_ENGLISH, ...PROSE_LEADS]) {
      expect({ name, label: isActionLabel(name) }).toEqual({
        name,
        label: false,
      });
    }
  });

  it("name another console's labels only in the section that walks through that console", () => {
    for (const [heading, labels] of Object.entries(OTHER_CONSOLES)) {
      const here: Array<string> = boldSpans(englishSection(heading));
      const elsewhere: Array<string> = boldSpans(
        ENGLISH.split(englishSection(heading)).join(""),
      );

      for (const label of labels) {
        expect({
          heading,
          label,
          here: here.includes(label),
          elsewhere: elsewhere.includes(label),
        }).toEqual({ heading, label, here: true, elsewhere: false });
      }
    }
  });
});

describe("the English page", () => {
  it("is titled as its nav link", () => {
    expect(ENGLISH.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
    expect(navTitle("en", NAV_TITLE)).toBe(NAV_TITLE);
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(ENGLISH)).toEqual([]);
  });

  it("writes every paragraph on one line, so a translation can match it line for line", () => {
    const lines: Array<string> = prose(ENGLISH).split("\n");
    const wrapped: Array<string> = lines.filter(
      (line: string, index: number): boolean => {
        return isParagraphText(line) && isParagraphText(lines[index + 1] || "");
      },
    );

    expect(wrapped).toEqual([]);
  });

  it("names the events, their kinds and the alerts in its tables as the Dashboard does", () => {
    expect(columnOf(ENGLISH, PageTable.Events, 0)).toEqual(
      NETWORK_EVENT_DEFINITIONS.map(
        (definition: NetworkEventDefinition): string => {
          return NETWORK_EVENT_COPY[definition.type].title;
        },
      ),
    );
    expect(columnOf(ENGLISH, PageTable.Alerts, 0)).toEqual(
      NetworkEventAlertTemplates.getFeatured().map(
        (template: NetworkEventAlertTemplate): string => {
          return NETWORK_EVENT_ALERT_TEMPLATE_COPY[
            template.id as NetworkEventAlertTemplateId
          ].title;
        },
      ),
    );

    for (const title of [
      ...columnOf(ENGLISH, PageTable.Events, 0),
      ...columnOf(ENGLISH, PageTable.Events, 2),
      ...columnOf(ENGLISH, PageTable.Alerts, 0),
    ]) {
      expect({ title, label: isActionLabel(title) }).toEqual({
        title,
        label: true,
      });
    }
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  const translated: string = hasPage(language, PAGE)
    ? readPage(language, PAGE)
    : "";
  const englishLines: Array<string> = proseLines(ENGLISH);
  const translatedLines: Array<string> = proseLines(translated);

  function draw(label: string): string {
    return drawnActionLabel(language, label);
  }

  it("is translated, under the nav link's title", () => {
    const title: string = navTitle(language, NAV_TITLE);

    expect(hasPage(language, PAGE)).toBe(true);
    expect(translated).not.toEqual(ENGLISH);
    expect(typeof title).toBe("string");
    expect(title).not.toBe(NAV_TITLE);
    expect(translated.split("\n")[0]).toBe(`# ${title}`);
  });

  it("lies line for line beside the English page: headings, table rows and fences on the same lines", () => {
    expect(lineShape(translated)).toEqual(lineShape(ENGLISH));
  });

  it("keeps every code block word for word", () => {
    expect(scanMarkdown(translated).fences.map(comparableFence)).toEqual(
      scanMarkdown(ENGLISH).fences.map(comparableFence),
    );
  });

  it("keeps every piece of inline code, on the line the English page has it", () => {
    const moved: Array<number> = [];

    englishLines.forEach((line: string, index: number): void => {
      if (
        codeOf(line).join("\n") !==
        codeOf(translatedLines[index] || "").join("\n")
      ) {
        moved.push(index + 1);
      }
    });

    expect(moved).toEqual([]);
    expect(inlineCode(translated)).toEqual(inlineCode(ENGLISH));
  });

  it("states every number the English line states: ports, limits, minutes and days", () => {
    const lost: Array<string> = [];

    englishLines.forEach((line: string, index: number): void => {
      const missing: Array<string> = missingNumbers(
        numbersOf(line),
        numbersOf(translatedLines[index] || ""),
      );

      if (missing.length > 0) {
        lost.push(`line ${index + 1}: ${missing.join(", ")}`);
      }
    });

    expect(lost).toEqual([]);
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(translated)).toEqual([]);
  });

  it("draws every bold span, with no asterisks or underscores left on the page", async () => {
    expect(await strayMarkers(translated, language)).toEqual([]);
  });

  it("has the English page's headings, tables and list items", () => {
    expect(
      scanMarkdown(translated).headings.map((heading: DocsHeading): number => {
        return heading.level;
      }),
    ).toEqual(
      scanMarkdown(ENGLISH).headings.map((heading: DocsHeading): number => {
        return heading.level;
      }),
    );
    expect(tableShape(translated)).toEqual(tableShape(ENGLISH));
    expect(listItemCount(translated)).toBe(listItemCount(ENGLISH));
  });

  it("links to the pages the English page links to, from the same lines", () => {
    expect(linkedPagesByLine(translated)).toEqual(linkedPagesByLine(ENGLISH));
  });

  it("links only to anchors that are headings of the page they open", () => {
    expect(anchorProblems(language, PAGE)).toEqual([]);
  });

  it("names every Dashboard label the English page names, on its line, as this language's Dashboard draws it", () => {
    const missing: Array<string> = [];

    englishLines.forEach((line: string, index: number): void => {
      for (const label of boldSpans(line).filter(isDrawn)) {
        if (!(translatedLines[index] || "").includes(`**${draw(label)}**`)) {
          missing.push(`line ${index + 1}: ${label} -> ${draw(label)}`);
        }
      }
    });

    expect(missing).toEqual([]);
  });

  it("gives the way to the network's Events page as its Dashboard draws the menu", () => {
    expect(ENGLISH).toContain(`**Network**${MENU_ARROW}**Events**`);
    expect(translated).toContain(
      `**${draw("Network")}**${MENU_ARROW}**${draw("Events")}**`,
    );
  });

  it("keeps in English what other consoles, and every Dashboard, show in English, on its line", () => {
    const missing: Array<string> = [];

    englishLines.forEach((line: string, index: number): void => {
      for (const name of boldSpans(line).filter((span: string): boolean => {
        return (
          OTHER_CONSOLE_LABELS.includes(span) || SHOWN_IN_ENGLISH.includes(span)
        );
      })) {
        if (!(translatedLines[index] || "").includes(`**${name}**`)) {
          missing.push(`line ${index + 1}: ${name}`);
        }
      }
    });

    expect(missing).toEqual([]);
  });

  it("lists the makers and their products as written, with as many kinds of event each", () => {
    const english: Array<Array<string>> = tableOf(ENGLISH, PageTable.Vendors);
    const rows: Array<Array<string>> = tableOf(translated, PageTable.Vendors);

    english.forEach((row: Array<string>, index: number): void => {
      const mine: Array<string> = rows[index] || [];
      // The last row is the parser no maker owns: its words are translated.
      const isNamed: boolean = index < english.length - 1;

      expect({
        row: index,
        maker: isNamed ? mine[0] : undefined,
        products: isNamed ? mine[1] : undefined,
        fields: mine[3],
      }).toEqual({
        row: index,
        maker: isNamed ? row[0] : undefined,
        products: isNamed ? row[1] : undefined,
        fields: row[3],
      });
      expect((mine[2] || "").trim().length).toBeGreaterThan(0);
    });
  });

  it("names every event, and its kind, as this language's Events page does", () => {
    expect(tableOf(translated, PageTable.Events)).toEqual(
      tableOf(ENGLISH, PageTable.Events).map(
        (row: Array<string>, index: number): Array<string> => {
          const definition: NetworkEventDefinition = NETWORK_EVENT_DEFINITIONS[
            index
          ] as NetworkEventDefinition;

          return [
            draw(NETWORK_EVENT_COPY[definition.type].title),
            row[1] as string,
            draw(NETWORK_EVENT_KIND_TITLES[definition.kind]),
            row[3] as string,
          ];
        },
      ),
    );
  });

  it("names every alert as this language's Events page does", () => {
    expect(columnOf(translated, PageTable.Alerts, 0)).toEqual(
      columnOf(ENGLISH, PageTable.Alerts, 0).map(draw),
    );
  });

  it("keeps the attributes and the settings as written", () => {
    // Two attributes share a row: the comma between them is the language's.
    expect(columnOf(translated, PageTable.Attributes, 0).map(codeOf)).toEqual(
      columnOf(ENGLISH, PageTable.Attributes, 0).map(codeOf),
    );
    expect(columnOf(translated, PageTable.Settings, 0)).toEqual(
      columnOf(ENGLISH, PageTable.Settings, 0),
    );
    expect(columnOf(translated, PageTable.Settings, 2)).toEqual(
      columnOf(ENGLISH, PageTable.Settings, 2),
    );
  });

  describe("links into this page from other pages", () => {
    it.each([
      { from: "telemetry/log-pipelines", anchor: "your-own-events" },
      { from: "monitor/logs-monitor", anchor: null },
      { from: "monitor/network-vendor-guides", anchor: null },
      { from: "monitor/network-device-monitor", anchor: null },
      { from: "probe/custom-probe", anchor: null },
      { from: "telemetry/syslog", anchor: null },
    ])(
      "$from links here, to the heading the English link means",
      (link: { from: string; anchor: string | null }) => {
        const anchor: string | null = link.anchor
          ? anchorInLanguage(language, PAGE, link.anchor)
          : null;
        const target: string = `](/docs/${PAGE}${anchor ? `#${anchor}` : ""})`;

        if (link.anchor) {
          expect(anchor).not.toBeNull();
          expect(readPage("en", link.from)).toContain(
            `](/docs/${PAGE}#${link.anchor})`,
          );
        } else {
          expect(readPage("en", link.from)).toContain(`](/docs/${PAGE})`);
        }

        expect(readPage(language, link.from)).toContain(target);
      },
    );
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks,
 * DocsPageShape); this page adds what holds a translation to its English
 * line: the inline code and the numbers of each line.
 */
describe("the helpers, on this page's shapes", () => {
  it("read a line's inline code, and nothing inside a code block", () => {
    const page: string = [
      "Port `5140`, or `514`.",
      "```text",
      "logging host `not-inline`",
      "```",
      "After `it`.",
    ].join("\n");

    expect(proseLines(page).map(codeOf)).toEqual([
      ["`5140`", "`514`"],
      [],
      [],
      [],
      ["`it`"],
    ]);
  });

  it("find a number a translation lost or changed, and allow one it spells in digits", () => {
    const english: Array<string> = numbersOf(
      "more than 5 minutes old, up to 7 days back, more than 5 minutes away",
    );

    expect(english).toEqual(["5", "7", "5"]);
    // Persian digits read as the same numbers.
    expect(
      missingNumbers(english, numbersOf("بیش از ۵ دقیقه، تا ۷ روز، ۵ دقیقه")),
    ).toEqual([]);
    // "Two places" written as "2 か所" adds a number, and loses none.
    expect(
      missingNumbers(numbersOf("in two places"), numbersOf("2 か所")),
    ).toEqual([]);
    // A port mistyped, and a repeat dropped.
    expect(missingNumbers(["5140"], numbersOf("Port 5410"))).toEqual(["5140"]);
    expect(missingNumbers(english, numbersOf("5 Minuten, 7 Tage"))).toEqual([
      "5",
    ]);
  });

  it("tell a Dashboard label from another console's label that happens to be one", () => {
    expect(isDrawn("Events")).toBe(true);
    expect(isDrawn("Create alert for this event")).toBe(true);
    // The Sophos console's own "Add", though the Dashboard has an "Add" too.
    expect(OTHER_CONSOLE_LABELS).toContain("Add");
    expect(isDrawn("Add")).toBe(false);
    expect(isDrawn("A live tail.")).toBe(false);
  });

  it("read the pages a line links to, without their anchors", () => {
    const page: string = [
      "# Title",
      "",
      "See [Alerts](#alerts) and [Logs monitor](/docs/monitor/logs-monitor#resolved-by-a-log).",
    ].join("\n");

    expect(linkedPagesByLine(page)).toEqual({
      3: ["", "/docs/monitor/logs-monitor"],
    });
  });
});
