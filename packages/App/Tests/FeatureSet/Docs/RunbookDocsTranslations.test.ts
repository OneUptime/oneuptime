import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
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
  prose,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * The seven Runbooks pages - the overview, authoring, rules, running, the
 * Runner (agents) guide, credentials and configuration & safety - are
 * translated into every docs language, and each translation says what the
 * English page says: the same sections, tables, lists, code and diagrams,
 * links that land on a heading in the reader's language, a title that is
 * the nav link's, and the Dashboard named the way that language's Dashboard
 * draws it - Persian included, as on the on-call pages (drawnDashboardLabel).
 *
 * Two kinds of text are quoted rather than translated, and are held to that
 * here: what the server writes - a failed step's error, an API refusal -
 * which the product shows in English whatever the reader's language
 * (SERVER_MESSAGES), and what the Dashboard words itself, which a
 * translation quotes in its Dashboard's words (DASHBOARD_MESSAGES).
 *
 * The bold names that stay English on purpose (KEPT_IN_ENGLISH) and the bold
 * words that are prose rather than a control (PROSE) are listed with why.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface RunbookPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const PAGES: ReadonlyArray<RunbookPage> = [
  { page: "runbooks/index", navTitle: "Runbooks Overview" },
  { page: "runbooks/authoring", navTitle: "Authoring a Runbook" },
  { page: "runbooks/rules", navTitle: "Runbook Rules" },
  { page: "runbooks/running", navTitle: "Running a Runbook" },
  { page: "runbooks/agents", navTitle: "Runbook Agents" },
  { page: "runbooks/credentials", navTitle: "Runbook Credentials" },
  {
    page: "runbooks/configuration",
    navTitle: "Runbook Configuration & Safety",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: RunbookPage): string => {
  return entry.page;
});

/*
 * The step types, as the Steps editor's picker and the execution page draw
 * them: in English, whatever the reader's language (STEP_TYPE_META and
 * STEP_TYPE_LABEL render them untranslated).
 */
const STEP_TYPE_NAMES: Array<string> = [
  "Manual",
  "JavaScript",
  "HTTP request",
  "Bash",
  "SSH",
  "Kubernetes",
  "AI",
];

/*
 * Bold names the translations keep in English, on purpose, by page: the
 * product shows them in English whatever the language.
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  // The step types table: the editor and the execution page name them in English.
  "runbooks/index": STEP_TYPE_NAMES,
  "runbooks/running": [
    // A permission's name, as a custom role's permission list shows it.
    "Create Runbook Execution",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them: the terms the overview defines, the kinds of
 * event a rule starts on, and a product named in a sentence.
 */
const PROSE: Record<string, Array<string>> = {
  "runbooks/index": [
    // The "Key concepts" table: terms, defined in the reader's words.
    "Runbook",
    "Step",
    "Runbook Rule",
    "Execution",
    "Snapshot",
    "Runner",
    "Credential",
    "Secret",
    // "Monitors open incidents and alerts": the product, in a sentence.
    "Monitors",
  ],
  "runbooks/rules": [
    // "when an incident, alert, or scheduled maintenance event is created"
    "incident",
    "alert",
    "scheduled maintenance event",
    // The rule's match criteria, as the anatomy table describes them.
    "Conditions",
  ],
};

/*
 * What the server writes, quoted on these pages: the product shows it as
 * written, in English, in every language - a failed step's error on the
 * execution page, an API refusal. RunbookDocsFacts holds each to the code.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  "runbooks/running": [
    "Bash step is missing a Runner. Pick one under Runbooks → Runners.",
    "No runbook agent picked up this step before the wait window expired.",
  ],
  "runbooks/agents": [
    "No runbook agent picked up this step before the wait window expired.",
    "The runbook agent stopped responding while this step was running.",
    "No capability is enabled",
  ],
  "runbooks/rules": [
    "Alert Severities can only be used by alert runbook rules.",
  ],
};

/*
 * What the Dashboard itself says, quoted on these pages: a translation
 * quotes it in its Dashboard's words.
 */
const DASHBOARD_MESSAGES: Record<string, Array<string>> = {
  "runbooks/running": [
    "You do not have permission to start runbook executions in this project.",
  ],
  "runbooks/agents": ["You do not have permission to view this Runner's key"],
};

const PATH_SEPARATOR: string = " → ";

function englishPage(page: string): string {
  return readPage("en", page);
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(markdown).filter((span: string): boolean => {
    return !span.includes("→");
  });
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(markdown)
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split("→").map((segment: string): string => {
        return segment.trim();
      });
    })
    .filter((segments: Array<string>): boolean => {
      return segments.every((segment: string): boolean => {
        return isDashboardLabel(segment);
      });
    });
}

// The Dashboard labels a page names, minus the ones kept or worded as prose.
function checkedLabels(page: string): Array<string> {
  const kept: Array<string> = KEPT_IN_ENGLISH[page] || [];
  const proseWords: Array<string> = PROSE[page] || [];

  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return (
      isDashboardLabel(label) &&
      !kept.includes(label) &&
      !proseWords.includes(label)
    );
  });
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
      counts[page] = checkedLabels(page).length;
    }

    // The configuration page is a reference of keys; every other page names dozens.
    expect(counts["runbooks/configuration"]).toBeGreaterThanOrEqual(2);

    for (const page of PAGE_NAMES) {
      if (page !== "runbooks/configuration") {
        expect({ page: page, many: (counts[page] as number) >= 20 }).toEqual({
          page: page,
          many: true,
        });
      }
    }

    expect(
      PAGE_NAMES.reduce((total: number, page: string): number => {
        return total + menuPaths(englishPage(page)).length;
      }, 0),
    ).toBeGreaterThanOrEqual(10);
  });

  it("quote messages the English pages quote", () => {
    for (const lists of [SERVER_MESSAGES, DASHBOARD_MESSAGES]) {
      for (const page of Object.keys(lists)) {
        for (const message of lists[page] as Array<string>) {
          expect({ page, message, quoted: true }).toEqual({
            page,
            message,
            quoted: englishPage(page).includes(message),
          });
        }
      }
    }
  });

  it("tell the Dashboard's own messages from the server's", () => {
    // The Dashboard has a translation key for each of its messages ...
    for (const page of Object.keys(DASHBOARD_MESSAGES)) {
      for (const message of DASHBOARD_MESSAGES[page] as Array<string>) {
        expect({ message, isLabel: isDashboardLabel(message) }).toEqual({
          message,
          isLabel: true,
        });
      }
    }

    // ... and none for what the server writes, which no language translates.
    for (const page of Object.keys(SERVER_MESSAGES)) {
      for (const message of SERVER_MESSAGES[page] as Array<string>) {
        expect({ message, isLabel: isDashboardLabel(message) }).toEqual({
          message,
          isLabel: false,
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: RunbookPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it("name the step types the way the editor draws them", () => {
    const overview: string = englishPage("runbooks/index");

    for (const name of STEP_TYPE_NAMES) {
      expect(overview).toContain(`| **${name}** |`);
    }
  });
});

describe.each(LANGUAGES)("%s runbook pages", (language: string) => {
  describe.each(PAGES)("$page", (entry: RunbookPage) => {
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

      expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english)));
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = checkedLabels(entry.page)
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
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
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

    it("quotes what the server writes as the server writes it, in English", () => {
      const translated: string = prose(readPage(language, entry.page));

      for (const message of SERVER_MESSAGES[entry.page] || []) {
        expect({ message, quoted: translated.includes(message) }).toEqual({
          message,
          quoted: true,
        });
      }
    });

    it("quotes what the Dashboard says in this language's Dashboard words", () => {
      const translated: string = readPage(language, entry.page);

      for (const message of DASHBOARD_MESSAGES[entry.page] || []) {
        const drawn: string = drawnDashboardLabel(language, message);

        expect({ message, drawn, quoted: translated.includes(drawn) }).toEqual({
          message,
          drawn,
          quoted: true,
        });
      }
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add a state diagram, and menu paths written with arrows.
 */
describe("the comparisons, on these pages' diagrams and paths", () => {
  it("compare a state diagram by its states and transitions, not its words", () => {
    const english: string = [
      "stateDiagram-v2",
      '    state "Waiting for you" as WaitingForManualStep',
      "    [*] --> Scheduled: run started",
      "    Scheduled --> Running: a Worker picks it up",
    ].join("\n");
    const translated: string = [
      "stateDiagram-v2",
      '    state "Wartet auf Sie" as WaitingForManualStep',
      "    [*] --> Scheduled: Lauf gestartet",
      "    Scheduled --> Running: ein Worker übernimmt ihn",
    ].join("\n");
    const rewired: string = [
      "stateDiagram-v2",
      '    state "Wartet auf Sie" as WaitingForManualStep',
      "    [*] --> Running: Lauf gestartet",
      "    Scheduled --> Running: ein Worker übernimmt ihn",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });

  it("compare a sequence diagram's loop by its block, not its label", () => {
    const english: string = [
      "sequenceDiagram",
      "    participant R as Runner",
      "    loop Every 10 seconds while it runs",
      "        R->>O: Renew the lease",
      "    end",
    ].join("\n");
    const translated: string = [
      "sequenceDiagram",
      "    participant R as Runner",
      "    loop Alle 10 Sekunden, solange er läuft",
      "        R->>O: Das Lease erneuern",
      "    end",
    ].join("\n");
    // The loop taken out: the build changed.
    const unlooped: string = [
      "sequenceDiagram",
      "    participant R as Runner",
      "        R->>O: Das Lease erneuern",
      "    end",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(unlooped)).not.toBe(diagramSkeleton(english));

    // A flowchart is never read that way: a node id "loop" keeps its line.
    expect(diagramSkeleton("flowchart TB\n    loop --> done")).toBe(
      "flowchart TB\n    loop --> done",
    );
  });

  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Runbooks → Runners → Credentials**, **Runbooks › Runners** and **Run Now**";

    expect(menuPaths(markdown)).toEqual([
      ["Runbooks", "Runners", "Credentials"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Runbooks › Runners", "Run Now"]);
  });

  it("draw a path in the reader's language, segment by segment", () => {
    expect(
      ["Runbooks", "Runners", "Credentials"]
        .map((segment: string): string => {
          return drawnDashboardLabel("de", segment);
        })
        .join(PATH_SEPARATOR),
    ).toBe(
      [
        drawnDashboardLabel("de", "Runbooks"),
        drawnDashboardLabel("de", "Runners"),
        drawnDashboardLabel("de", "Credentials"),
      ].join(" → "),
    );
  });
});
