import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { ScannedPage, hasPage, readPage, scanMarkdown } from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
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
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * The six On Call pages - escalation rules, the schedule timeline, on-call
 * schedules, calendar feeds, the incoming call policy and the phone number
 * whitelist - are translated into every docs language, and each translation
 * says what the English page says: the same sections, tables, lists, code
 * and diagrams, links that land on a heading in the reader's language, a
 * title that is the nav link's, and the dashboard named the way that
 * language's Dashboard draws it.
 *
 * "The way the Dashboard draws it" is the rule a reader can check against
 * the screen: a bold label on the English page that is a Dashboard label
 * (DocsDashboardLabels) is, on the translated page, its value in that
 * language's Dashboard locale - or English, where the locale has none. On
 * these pages that holds for Persian too, as the on-call pages always had it
 * (drawnDashboardLabel). The bold names that stay English on purpose
 * (KEPT_IN_ENGLISH) and the bold words that are prose, or another app's
 * button, rather than a OneUptime control (PROSE) are listed with why.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface OnCallPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const PAGES: ReadonlyArray<OnCallPage> = [
  { page: "on-call/schedule-timeline", navTitle: "Schedule Timeline" },
  { page: "on-call/escalation-rules", navTitle: "Escalation Rules" },
  { page: "on-call/schedules", navTitle: "On-Call Schedules" },
  { page: "on-call/calendar-feeds", navTitle: "Calendar Feeds" },
  { page: "on-call/incoming-call-policy", navTitle: "Incoming Call Policy" },
  {
    page: "on-call/phone-number-whitelist",
    navTitle: "Phone Number Whitelist",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: OnCallPage): string => {
  return entry.page;
});

/*
 * Bold names the translations keep in English, on purpose, by page: the
 * product shows them in English whatever the language.
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  "on-call/calendar-feeds": [
    // The OneUptime mobile app, which is not translated.
    "Copy https link",
  ],
  "on-call/incoming-call-policy": [
    // The workflow builder: its trigger's fields and its ports, which are not translated.
    "Ended At",
    "Caller Phone Number",
    "Routing Phone Number",
    "Status",
    "Yes",
    // Role names, as a custom role's permission list shows them.
    "Project Admin",
    "Project Member",
    "Viewer",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them, or name another app's control - Google
 * Calendar's, Outlook's, Apple's, iOS's - which the translation names the way
 * that app does in the language.
 */
const PROSE: Record<string, Array<string>> = {
  "on-call/escalation-rules": [
    // A kind of responder in a table, and a rule name somebody chose.
    "on-call schedule",
    "Managers",
  ],
  "on-call/calendar-feeds": [
    // Google Calendar's, Outlook's, Apple Calendar's and iOS's own controls.
    "Add",
    "Import",
    "File",
    "New",
    "Auto-refresh",
    "Location",
    "Add Account",
    "Other",
    "Automatically",
    "View",
    // The mobile app's tab and the iPhone's Settings app.
    "On-Call",
    "Settings",
    // Emphasis, and the name of a permission level in a sentence.
    "project",
    "Edit",
  ],
};

/*
 * A menu path written as one bold span: "**A > B > C**". Each segment is the
 * language's Dashboard label. Persian is the one exception: its pages write
 * the Notification Settings path as its status page subscribers page does,
 * in English (NotificationChannelsWhoCanDocs holds the two to each other).
 */
const PATH_SEPARATOR: string = " > ";
const PATHS_KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  fa: ["Project Settings > Notifications > Notification Settings"],
};

function englishPage(page: string): string {
  return readPage("en", page);
}

// The bold spans of a page that are one Dashboard label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(markdown).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(markdown)
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
        return isDashboardLabel(segment);
      });
    });
}

// A Dashboard template with its placeholders filled, as this language draws it.
function filled(
  language: string,
  template: string,
  values: Record<string, string>,
): string {
  let text: string = drawnDashboardLabel(language, template);

  for (const key of Object.keys(values)) {
    text = text.replace(`{{${key}}}`, values[key] as string);
  }

  return text;
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
    const counts: Record<string, number> = {};

    for (const page of PAGE_NAMES) {
      counts[page] = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isDashboardLabel(label);
        },
      ).length;
    }

    // The short whitelist page names a handful; every other page dozens.
    expect(counts["on-call/phone-number-whitelist"]).toBeGreaterThanOrEqual(5);

    for (const page of PAGE_NAMES) {
      if (page !== "on-call/phone-number-whitelist") {
        expect({ page: page, many: (counts[page] as number) >= 20 }).toEqual({
          page: page,
          many: true,
        });
      }
    }
  });

  it("know the one path Persian keeps in English, and that it is on these pages", () => {
    const paths: Array<string> = PAGE_NAMES.flatMap(
      (page: string): Array<string> => {
        return menuPaths(englishPage(page)).map(
          (segments: Array<string>): string => {
            return segments.join(PATH_SEPARATOR);
          },
        );
      },
    );

    for (const kept of PATHS_KEPT_IN_ENGLISH["fa"] as Array<string>) {
      expect(paths).toContain(kept);
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)(
    "$page is titled as its nav link",
    (entry: OnCallPage) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );
});

describe.each(LANGUAGES)("%s on-call pages", (language: string) => {
  describe.each(PAGES)("$page", (entry: OnCallPage) => {
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
          return !translated.includes(
            `**${drawnDashboardLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnDashboardLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const keptPaths: Array<string> = PATHS_KEPT_IN_ENGLISH[language] || [];
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          const path: string = segments.join(PATH_SEPARATOR);

          if (keptPaths.includes(path)) {
            return path;
          }

          return segments
            .map((segment: string): string => {
              return drawnDashboardLabel(language, segment);
            })
            .join(PATH_SEPARATOR);
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

    it("keeps the names the server gives - Level N, Layer N - as the server writes them", () => {
      const translated: string = readPage(language, entry.page);

      for (const name of ["Level 1", "Level 2", "Level 3", "Layer 1"]) {
        const inEnglish: number = english.split(`**${name}**`).length;
        const inTranslation: number = translated.split(`**${name}**`).length;

        expect({ name: name, count: inTranslation }).toEqual({
          name: name,
          count: inEnglish,
        });
      }
    });
  });

  describe("the calendar feeds page", () => {
    const page: string = readPage(language, "on-call/calendar-feeds");

    it("quotes the status line Google's fetch leaves, as the Dashboard words it", () => {
      const statusLine: string = filled(
        language,
        "Last fetched {{when}} by {{client}}",
        { when: "…", client: "Google Calendar" },
      );

      expect(page).toContain(`**${statusLine}**`);
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add a sequence diagram, whose participants a translation may alias.
 */
describe("the comparisons, on these pages' diagrams", () => {
  it("compare a sequence diagram by its participants and arrows, not its words", () => {
    const english: string = [
      "sequenceDiagram",
      "    participant Caller",
      "    Caller->>Twilio: Dials the number",
      "    Note over Twilio,Caller: Nobody answers",
    ].join("\n");
    const translated: string = [
      "sequenceDiagram",
      "    participant Caller as Anrufer",
      "    Caller->>Twilio: Wählt die Nummer",
      "    Note over Twilio,Caller: Niemand nimmt ab",
    ].join("\n");
    const rewired: string = [
      "sequenceDiagram",
      "    participant Caller as Anrufer",
      "    Twilio->>Caller: Wählt die Nummer",
      "    Note over Twilio,Caller: Niemand nimmt ab",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });

  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Project Settings > Notifications > Notification Settings** and **Escalation Rules**";

    expect(menuPaths(markdown)).toEqual([
      ["Project Settings", "Notifications", "Notification Settings"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Escalation Rules"]);
  });

  it("fill a Dashboard template as the language draws it", () => {
    expect(
      filled("en", "Last fetched {{when}} by {{client}}", {
        when: "…",
        client: "Google Calendar",
      }),
    ).toBe("Last fetched … by Google Calendar");
  });
});
