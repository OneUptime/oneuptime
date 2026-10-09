import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsFence,
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { dashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  diagramSkeleton,
  inlineCode,
  listItemCount,
  navTitle,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * The six incident pages are translated into every docs language, and each
 * translation says what the English page says: the same sections, tables,
 * lists, code and diagrams, links that land on a heading in the reader's
 * language, a title that is the nav link's, and the dashboard named the way
 * that language's Dashboard draws it.
 *
 * "The way the Dashboard draws it" is the rule a reader can check against
 * the screen: a bold label on the English page that is a Dashboard label
 * (DocsDashboardLabels) is, on the translated page, its value in that
 * language's Dashboard locale - or English, where the locale has none. A
 * menu path is that, segment by segment. The few bold names that stay in
 * English on purpose (KEPT_IN_ENGLISH) and the few bold words that are prose
 * rather than a control (PROSE) are listed with why.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface IncidentPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const PAGES: ReadonlyArray<IncidentPage> = [
  { page: "incidents/index", navTitle: "Incidents Overview" },
  { page: "incidents/declaring-incidents", navTitle: "Declaring an Incident" },
  {
    page: "incidents/states-and-severities",
    navTitle: "Incident States & Severities",
  },
  {
    page: "incidents/notes-owners-and-feed",
    navTitle: "Incident Notes, Owners & Feed",
  },
  { page: "incidents/linked-alerts", navTitle: "Linked Alerts" },
  { page: "incidents/settings", navTitle: "Incident Settings & Automation" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: IncidentPage): string => {
  return entry.page;
});

/*
 * Bold names the translations keep in English, on purpose, by page: the
 * product shows them in English whatever the language, or they are names
 * people give rather than labels.
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  "incidents/declaring-incidents": [
    // The workflow step's setting: the workflow docs name it in English.
    "Incident Template",
  ],
  "incidents/states-and-severities": [
    // Custom states a project might add: names people give.
    "Investigating",
    "Closed",
    // Permission names, as a custom role lists them.
    "Create Incident State Timeline",
    "Create Alert Internal Note",
    "Create Alert Episode Internal Note",
    "Create Incident Episode Internal Note",
  ],
  "incidents/notes-owners-and-feed": [
    // The Slack and Microsoft Teams modal, which is not translated.
    "Note",
    // The workflow step's setting.
    "Incident Template",
  ],
  "incidents/linked-alerts": [
    // Permission names, and the permission group they are in.
    "Create Alert State Timeline",
    "Edit Alert",
    "Create Incident Alert",
  ],
  "incidents/settings": [
    // The workflow builder's trigger panel, which is not translated.
    "OneUptime resources",
    "Incident",
    "Popular",
    "Add Trigger",
    "Success",
    // The workflow step's setting.
    "Incident Template",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them - a key term, a feed category, a verb in a
 * table - so a translation words them as prose.
 */
const PROSE: Record<string, Array<string>> = {
  "incidents/index": [
    "State timeline",
    "Incident severity",
    "Incident",
    "Owner",
  ],
  "incidents/states-and-severities": [
    "State timeline",
    "Automatically",
    // The subscriber email's row, quoted as the email shows it.
    "Status",
  ],
  "incidents/notes-owners-and-feed": ["Automation", "People", "Notifications"],
  "incidents/linked-alerts": [
    // The severities every project starts with, quoted by their names.
    "High",
    "Low",
  ],
  "incidents/settings": ["Rename", "name", "resolved", "Add"],
};

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MENU_PATH: RegExp = /\*\*([^*\n]+? → [^*\n]+?)\*\*/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

// Every bold span that is not a menu path, once each, in order.
function boldLabels(markdown: string): Array<string> {
  const labels: Array<string> = [];

  for (const match of Array.from(markdown.matchAll(BOLD))) {
    const label: string = (match[1] as string).trim();

    if (!label.includes("→") && !labels.includes(label)) {
      labels.push(label);
    }
  }

  return labels;
}

// Every bold menu path whose segments are all Dashboard labels, once each.
function menuPaths(markdown: string): Array<Array<string>> {
  const paths: Array<Array<string>> = [];

  for (const match of Array.from(markdown.matchAll(MENU_PATH))) {
    const segments: Array<string> = (match[1] as string)
      .split("→")
      .map((segment: string): string => {
        return segment.trim();
      });

    if (
      segments.every((segment: string): boolean => {
        return isDashboardLabel(segment);
      }) &&
      !paths.some((known: Array<string>): boolean => {
        return known.join("→") === segments.join("→");
      })
    ) {
      paths.push(segments);
    }
  }

  return paths;
}

// A Dashboard template with its placeholder filled, as this language draws it.
function filled(language: string, template: string, value: string): string {
  return dashboardLabel(language, template).replace(/\{\{\s*\w+\s*\}\}/, value);
}

describe("the lists this test keeps", () => {
  it("name only bold Dashboard labels the English page has", () => {
    for (const [lists, kind] of [
      [KEPT_IN_ENGLISH, "kept"],
      [PROSE, "prose"],
    ] as Array<[Record<string, Array<string>>, string]>) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);

        const labels: Array<string> = boldLabels(englishPage(page));

        for (const label of lists[page] as Array<string>) {
          expect({ kind: kind, page: page, label: label, ok: true }).toEqual({
            kind: kind,
            page: page,
            label: label,
            ok: labels.includes(label) && isDashboardLabel(label),
          });
        }
      }
    }
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      const labels: Array<string> = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isDashboardLabel(label);
        },
      );

      expect({ page: page, many: labels.length > 40 }).toEqual({
        page: page,
        many: true,
      });
    }

    expect(
      PAGE_NAMES.reduce((total: number, page: string): number => {
        return total + menuPaths(englishPage(page)).length;
      }, 0),
    ).toBeGreaterThan(40);
  });
});

describe.each(LANGUAGES)("%s incident pages", (language: string) => {
  describe.each(PAGES)("$page", (entry: IncidentPage) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
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

    it("has the English page's headings, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: { level: number }) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: { level: number }) => {
          return heading.level;
        }),
      );
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

      expect(cardTargets(translated)).toEqual(
        cardTargets(cardLines(english)),
      );
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const kept: Array<string> = KEPT_IN_ENGLISH[entry.page] || [];
      const proseWords: Array<string> = PROSE[entry.page] || [];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isDashboardLabel(label) &&
            !kept.includes(label) &&
            !proseWords.includes(label)
          );
        })
        .filter((label: string): boolean => {
          return !translated.includes(`**${dashboardLabel(language, label)}**`);
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return segments
            .map((segment: string): string => {
              return dashboardLabel(language, segment);
            })
            .join(" → ");
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English the names the product shows in English", () => {
      const translated: string = readPage(language, entry.page);

      for (const name of KEPT_IN_ENGLISH[entry.page] || []) {
        expect({
          name: name,
          kept: translated.includes(`**${name}**`),
        }).toEqual({ name: name, kept: true });
      }
    });
  });

  describe("the states page", () => {
    const page: string = readPage(language, "incidents/states-and-severities");

    it("names a custom state's confirmation and the stat tiles as the Dashboard fills them in", () => {
      for (const label of [
        filled(language, "Mark Incident as {{state}}", "`<state name>`"),
        filled(language, "Mark as {{state}}", "`<state name>`"),
        filled(language, "Mark Incident as {{state}}", "…"),
        // The tiles name the state as the project stored it.
        filled(language, "{{stateName}} in", "Acknowledged"),
        filled(language, "{{stateName}} in", "Resolved"),
      ]) {
        expect({ label: label, named: page.includes(`**${label}**`) }).toEqual({
          label: label,
          named: true,
        });
      }
    });

    it("lists the named colors of a state's color field, in the picker's order", () => {
      const row: string =
        page.split("\n").find((line: string): boolean => {
          return line.startsWith(`| **${dashboardLabel(language, "Color")}**`);
        }) || "";
      let from: number = 0;

      expect(row).not.toBe("");

      for (const color of [
        "Red",
        "Orange",
        "Lime",
        "Green",
        "Teal",
        "Blue",
        "Indigo",
        "Purple",
        "Magenta",
        "Pink",
      ]) {
        const at: number = row.indexOf(dashboardLabel(language, color), from);

        expect({ color: color, inOrder: at >= from }).toEqual({
          color: color,
          inOrder: true,
        });
        from = at + 1;
      }
    });
  });

  describe("the settings page", () => {
    const page: string = readPage(language, "incidents/settings");

    it("quotes the empty template list as the Dashboard words it", () => {
      const empty: string = dashboardLabel(
        language,
        "No incident templates found.",
      ).replace(/[.。।]$/, "");

      expect(page).toContain(`**${empty}**`);
    });

    it("marks a value its dropdown no longer offers as the Dashboard does, in the running text", () => {
      const label: string = dashboardLabel(language, "No longer an option");
      // Mid-sentence, so lower-case its first letter only: German keeps "Option".
      const marker: string =
        label.charAt(0).toLocaleLowerCase(language) + label.slice(1);

      expect(page.split(`_${marker}_`).length - 1).toBe(2);
    });
  });
});

/*
 * The helpers above are what every test leans on: each must catch the
 * break it is there for.
 */
describe("the comparisons", () => {
  it("compare a diagram by how it is built: a translated label passes, a rewired arrow fails", () => {
    const english: string = 'flowchart TB\n    a["Start"] -->|go| b["End"]';
    const translated: string =
      'flowchart TB\n    a["शुरू"] -->|"चलो"| b["अंत"]';
    const rewired: string = 'flowchart TB\n    a["शुरू"] -->|"चलो"| a["अंत"]';

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });

  it("hold every other code block to the English one exactly", () => {
    const fence: (code: string) => DocsFence = (code: string): DocsFence => {
      return { info: "bash", lang: "bash", code: code, line: 1 };
    };

    expect(comparableFence(fence("curl -X POST a"))).not.toBe(
      comparableFence(fence("curl -X POST b")),
    );
  });

  it("refuse a full-width colon after a card's link, which the cards parser keeps", () => {
    expect(CARD_LINE.test("- [事件](/docs/incidents/index): 說明")).toBe(true);
    expect(CARD_LINE.test("- [事件](/docs/incidents/index)：說明")).toBe(false);
  });

  it("count inline code as a multiset, outside code blocks", () => {
    expect(inlineCode("a `x` b `y` c `x`")).toEqual(["x", "x", "y"]);
    expect(inlineCode("```bash\n`not this`\n```\n`this`")).toEqual(["this"]);
  });

  it("read the rows of each table", () => {
    expect(
      tableShape("| a |\n| - |\n| 1 |\n| 2 |\n\ntext\n| b |\n| - |\n| 3 |"),
    ).toEqual([2, 1]);
  });
});
