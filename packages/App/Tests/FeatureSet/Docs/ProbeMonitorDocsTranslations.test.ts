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
  drawnActionLabel,
  drawnDashboardLabel,
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
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 6: Creating a Monitor, Monitor Templates and the five
 * probe checks most monitors start as - Website, API, Ping, IP and Port - in
 * every docs language. Each translation says what the English page says: the
 * same sections, steps, tables, lists, cards, code and diagrams, links that
 * land on a heading in the reader's language, a title that is the nav
 * link's, and the product named the way that language's product draws it.
 *
 * "The way the product draws it" has three sources on these pages:
 *
 *   - A bold Dashboard label (DocsDashboardLabels) is its value in that
 *     language's Dashboard locale, Persian included, as on the on-call,
 *     runbook, workflow and introduction pages (drawnActionLabel). Menu
 *     paths ("A → B → C") are drawn segment by segment.
 *   - The criteria filters and their conditions (Is Online, Greater Than,
 *     Evaluates To True), the HTTP methods, two template sync field names
 *     and a few more have no Dashboard locale key at all: every language's
 *     Dashboard shows them in English, so every translation names them in
 *     English (SHOWN_IN_ENGLISH). When the Dashboard gains a key for one, a
 *     test below fails until the pages name it as drawn.
 *   - The request headers' Add button is drawn from the "Add {{itemName}}"
 *     template around an item name that has no translation
 *     (TEMPLATED_LABELS).
 *
 * Bold words that are Dashboard labels only by coincidence - a list item's
 * lead, a keyboard key - are PROSE, with why.
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

const CREATE_MONITOR: string = "monitor/create-monitor";
const MONITOR_TEMPLATES: string = "monitor/monitor-templates";
const WEBSITE_MONITOR: string = "monitor/website-monitor";
const API_MONITOR: string = "monitor/api-monitor";
const PING_MONITOR: string = "monitor/ping-monitor";
const IP_MONITOR: string = "monitor/ip-monitor";
const PORT_MONITOR: string = "monitor/port-monitor";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: CREATE_MONITOR, navTitle: "Creating a Monitor" },
  { page: MONITOR_TEMPLATES, navTitle: "Monitor Templates" },
  { page: WEBSITE_MONITOR, navTitle: "Website Monitor" },
  { page: API_MONITOR, navTitle: "API Monitor" },
  { page: PING_MONITOR, navTitle: "Ping Monitor" },
  { page: IP_MONITOR, navTitle: "IP Monitor" },
  { page: PORT_MONITOR, navTitle: "Port Monitor" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The five probe check pages, which share their criteria sections.
const PROBE_CHECK_PAGES: Array<string> = [
  WEBSITE_MONITOR,
  API_MONITOR,
  PING_MONITOR,
  IP_MONITOR,
  PORT_MONITOR,
];

/*
 * The criteria filters, their conditions and the over-time aggregates the
 * criteria form offers without a locale key (CheckOn, FilterType,
 * EvaluateOverTimeType and NoDataPolicy values), on every probe check page
 * that names them.
 */
const CRITERIA_NAMES_IN_ENGLISH: Array<string> = [
  "Is Online",
  "Greater Than",
  "Less Than",
  "Greater Than Or Equal To",
  "Less Than Or Equal To",
  "Is Request Timeout",
  "Maximum Value",
  "Minimum Value",
  "All Values",
  "Any Value",
  "Ignore",
  "Treat As Zero",
];

// The HTTP criteria the Website and API monitors add.
const HTTP_CRITERIA_IN_ENGLISH: Array<string> = [
  "Equal To",
  "Not Equal To",
  "Not Contains",
  "Response Header",
  "Response Header Value",
  "JavaScript Expression",
  "Evaluates To True",
];

// The ping measurements Ping and IP monitors add.
const PING_CRITERIA_IN_ENGLISH: Array<string> = [
  "Packet Loss (in %)",
  "Jitter (in ms)",
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [MONITOR_TEMPLATES]: [
    /*
     * The sync button with its count is built in English
     * (MonitorTemplatesView), so no language translates it.
     */
    "Sync Criteria to 3 Linked Monitors",
    // Template sync settings' field names (MonitorTemplateSyncField).
    "Monitor destination",
    "Request headers",
  ],
  [WEBSITE_MONITOR]: [...CRITERIA_NAMES_IN_ENGLISH, ...HTTP_CRITERIA_IN_ENGLISH],
  [API_MONITOR]: [
    ...CRITERIA_NAMES_IN_ENGLISH,
    ...HTTP_CRITERIA_IN_ENGLISH,
    // The API Request Type's options: HTTP methods.
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
  ],
  [PING_MONITOR]: [...CRITERIA_NAMES_IN_ENGLISH, ...PING_CRITERIA_IN_ENGLISH],
  [IP_MONITOR]: [
    ...CRITERIA_NAMES_IN_ENGLISH,
    ...PING_CRITERIA_IN_ENGLISH,
    // The type picker's IP card and the category it sits in.
    "IP",
    "Basic Monitoring",
  ],
  [PORT_MONITOR]: [
    ...CRITERIA_NAMES_IN_ENGLISH,
    "Port DNS Lookup Time (in ms)",
    "Port TCP Connect Time (in ms)",
  ],
};

/*
 * Buttons drawn from a Dashboard template around a name the locale does not
 * translate: the request headers' Add button is "Add {{itemName}}" with
 * "Request Header" (MonitorStep's DictionaryOfStrings), which German draws
 * "Request Header hinzufügen".
 */
const TEMPLATED_LABELS: Record<
  string,
  Array<{ english: string; template: string; itemName: string }>
> = {
  [API_MONITOR]: [
    {
      english: "Add Request Header",
      template: "Add {{itemName}}",
      itemName: "Request Header",
    },
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const ONLINE_LEAD: string =
  // "- **Online** — the website answers": the online criteria's lead word. No screen calls it Online.
  "Online";

const PROSE: Record<string, Array<string>> = {
  // "**Enter** picks the first match": the keyboard's key, not a control.
  [CREATE_MONITOR]: ["Enter"],
  [WEBSITE_MONITOR]: [ONLINE_LEAD],
  [API_MONITOR]: [ONLINE_LEAD],
  [PING_MONITOR]: [ONLINE_LEAD],
  [IP_MONITOR]: [ONLINE_LEAD],
  [PORT_MONITOR]: [ONLINE_LEAD],
};

const PATH_SEPARATOR: string = " → ";

// The prose leads of "Before you begin": "A role that can create monitors".
const BEFORE_YOU_BEGIN_LEAD: RegExp = /^A (role|probe) /;

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

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

// A Dashboard template filled with an English name, as this language draws it.
function filled(language: string, template: string, itemName: string): string {
  return drawnDashboardLabel(language, template).replace(
    "{{itemName}}",
    itemName,
  );
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
 * asterisks left in its text: a bold span CommonMark did not close. A span
 * that ends in punctuation and runs straight into a letter, as in
 * "**リクエストタイムアウト（秒）**を", is not closed, and its asterisks show.
 */
async function strayAsterisks(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return html
    .replace(RENDERED_CODE, "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes("**");
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

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [SHOWN_IN_ENGLISH, TEMPLATED_LABELS, PROSE]) {
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

  it("know every bold criteria name the probe check pages show in English", () => {
    for (const page of PROBE_CHECK_PAGES) {
      const english: string = englishPage(page);
      const unlisted: Array<string> = boldLabels(english).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !(SHOWN_IN_ENGLISH[page] as Array<string>).includes(span) &&
            // Prose leads ("A role that can create monitors"), not names.
            !BEFORE_YOU_BEGIN_LEAD.test(span) &&
            ![
              "Credentials as monitor secrets.",
              "Add Request Header",
              "DNS lookup",
              "TCP connect",
              "5",
            ].includes(span)
          );
        },
      );

      expect({ page: page, unlisted: unlisted }).toEqual({
        page: page,
        unlisted: [],
      });
    }
  });

  it("draw the templated buttons from the English page's bold text", () => {
    for (const page of Object.keys(TEMPLATED_LABELS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const entry of TEMPLATED_LABELS[page]!) {
        expect(labels).toContain(entry.english);
        expect(filled("en", entry.template, entry.itemName)).toBe(
          entry.english,
        );
        // The item has no translation: that is why it is drawn this way.
        expect(isActionLabel(entry.itemName)).toBe(false);
        expect(isActionLabel(entry.english)).toBe(false);
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

      expect({ page: page, enough: labels >= 20 }).toEqual({
        page: page,
        enough: true,
      });
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

  it.each(
    PAGES.filter((entry: TranslatedPage): boolean => {
      // Creating a Monitor ends on its last step's section, which holds the cards.
      return entry.page !== CREATE_MONITOR;
    }),
  )("$page ends on a Next steps section of cards", (entry: TranslatedPage) => {
    const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
    const last: DocsHeading = scanned.headings[
      scanned.headings.length - 1
    ] as DocsHeading;

    expect(last).toEqual(expect.objectContaining({ level: 2 }));
    expect(last.text).toBe("Next steps");
    expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
  });

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PROBE_CHECK_PAGES)(
    "%s says how many steps creating it takes, and has that many",
    (page: string) => {
      const english: string = englishPage(page);
      const steps: number = stepCount(english);

      expect(steps).toBe(6);
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

    it("draws every bold span as bold, with no asterisks left on the page", async () => {
      expect(
        await strayAsterisks(readPage(language, entry.page), language),
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
          return segments
            .map((segment: string): string => {
              return drawnActionLabel(language, segment);
            })
            .join(PATH_SEPARATOR);
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

    it("names the templated buttons as this language fills their template", () => {
      const translated: string = readPage(language, entry.page);

      for (const templated of TEMPLATED_LABELS[entry.page] || []) {
        const drawn: string = filled(
          language,
          templated.template,
          templated.itemName,
        );

        expect({ drawn: drawn, found: true }).toEqual({
          drawn: drawn,
          found: translated.includes(`**${drawn}**`),
        });
      }
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add menu paths with arrows, numbered steps and templated buttons.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Monitors → Settings → Templates** and **Create Monitor Template**";

    expect(menuPaths(markdown)).toEqual([["Monitors", "Settings", "Templates"]]);
    expect(boldLabels(markdown)).toEqual(["Create Monitor Template"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string =
      "**Response Status Code** / **Not Equal To** / `200** in the offline one";
    const whole: string =
      "**Response Status Code** / **Not Equal To** / `200` in the offline one";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines(whole)).toEqual([]);
    // Asterisks inside code are code, not bold.
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("find asterisks the renderer leaves when a bold span runs into a letter", async () => {
    expect(
      await strayAsterisks(
        "# Title\n\n**リクエストタイムアウト（秒）**を設定します。",
        "ja",
      ),
    ).toHaveLength(1);
    expect(
      await strayAsterisks(
        "# Title\n\n**リクエストタイムアウト（秒）** を設定します。",
        "ja",
      ),
    ).toEqual([]);
  });

  it("count the steps of every :::steps block, and only those", () => {
    const markdown: string = [
      "# Page",
      "## Create it",
      ":::steps",
      "### One",
      "```bash",
      "### not a step",
      "```",
      "### Two",
      ":::",
      "### After the steps",
      ":::steps",
      "### Three",
      ":::",
    ].join("\n");

    expect(stepCount(markdown)).toBe(3);
  });

  it("fill a template around an untranslated name, as German draws it", () => {
    expect(filled("en", "Add {{itemName}}", "Request Header")).toBe(
      "Add Request Header",
    );
    expect(filled("de", "Add {{itemName}}", "Request Header")).toBe(
      "Request Header hinzufügen",
    );
  });

  it("compare a sequence diagram by its participants and arrows, not its words", () => {
    const english: string = [
      "sequenceDiagram",
      "    participant P as Probe",
      "    P->>A: Request with your method, headers and body",
    ].join("\n");
    const translated: string = [
      "sequenceDiagram",
      "    participant P as Sonde",
      "    P->>A: Anfrage mit Ihrer Methode, Ihren Headern und Ihrem Body",
    ].join("\n");
    const rewired: string = [
      "sequenceDiagram",
      "    participant P as Sonde",
      "    A->>P: Anfrage mit Ihrer Methode, Ihren Headern und Ihrem Body",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });
});
