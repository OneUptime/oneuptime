import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnCreateButton,
  drawnDashboardLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  PATH_SEPARATOR,
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  diagramLabelLines,
  inlineCode,
  labelLineWidth,
  listItemCount,
  navTitle,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { anchorInLanguage } from "./NetworkDocsLabels";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 24a, the AI Observability pages: AI / LLM
 * Observability, AI Coding Assistants, Claude Code, Cursor and OpenAI Codex,
 * in every docs language. Each translation says what the English page says:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so the two
 *     can be laid side by side and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows, with labels short
 *     enough for the 590px docs column), inline code (the attribute, metric
 *     and variable names the pages are about), tables and the numbers in
 *     their rows, lists, steps, tabs and cards, and links that land on a
 *     heading in the reader's language;
 *   - a title that is the nav link's, in that language's docs locale.
 *
 * And it names the Dashboard the way that language's Dashboard draws it,
 * Persian included:
 *
 *   - A bold label is drawnDashboardLabel; a table's create button is
 *     drawnCreateButton (CREATE_BUTTONS).
 *   - A product opened from the Products menu (AI / LLM, Traces, Logs,
 *     Metrics, Project Settings) is drawn from the menu's own key
 *     (MENU_ITEM_KEYS), which some languages word differently from the flat
 *     key of the same English text.
 *   - A menu path is drawn segment by segment: one bold span with " → "
 *     between the segments, as the other telemetry pages write it; Persian,
 *     written right to left, writes a bold span per segment with " > "
 *     between them, as the other Persian pages do.
 *
 * What every Dashboard shows in English stays English: the monitor status a
 * project is created with (RECORD_NAMES), keyboard keys (KEYS), the names of
 * products and libraries (NAMES), and Cursor's own dashboard (OTHER_CONSOLES).
 * Bold words that are a Dashboard label only by coincidence are PROSE, and
 * the pages' own bold leads are PROSE_LEADS: a translation words both freely.
 * A new bold word on these English pages fails "know every bold word" until
 * it is in one of the lists.
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

export const LLM: string = "telemetry/ai-llm-observability";
export const ASSISTANTS: string = "telemetry/ai-coding-assistants";
export const CLAUDE_CODE: string = "telemetry/claude-code";
export const CURSOR: string = "telemetry/cursor";
export const CODEX: string = "telemetry/openai-codex";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: LLM, navTitle: "AI / LLM Observability" },
  { page: ASSISTANTS, navTitle: "AI Coding Assistants" },
  { page: CLAUDE_CODE, navTitle: "Claude Code" },
  { page: CURSOR, navTitle: "Cursor" },
  { page: CODEX, navTitle: "OpenAI Codex" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Each page's diagrams fit the 590px docs column, measured in a browser with
 * the docs' own font, in every language: their label lines are broken
 * (<br/>) to be no wider than this, counting a Chinese, Japanese or Korean
 * character twice. A label put back on one line runs its diagram off the
 * column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [LLM]: 26,
  [ASSISTANTS]: 32,
  [CLAUDE_CODE]: 22,
  [CURSOR]: 22,
  [CODEX]: 22,
};

/*
 * Products the pages open from the Products menu, by the key the menu draws
 * them with. Some languages word a menu item differently from the flat key
 * of the same English text: the Italian menu reads "AI / LLM" where the
 * product's page title reads "IA / LLM".
 */
const MENU_ITEM_KEYS: Record<string, string> = {
  "AI / LLM": "navbar.items.llmObservabilityTitle",
  Traces: "navbar.items.tracesTitle",
  Logs: "navbar.items.logsTitle",
  Metrics: "navbar.items.metricsTitle",
  "Project Settings": "navbar.items.projectSettingsTitle",
};

// The menu the product's paths start from.
const PRODUCTS_MENU: string = "Products";

// Bold words that name a product opened from the Products menu.
const MENU_ITEMS: Record<string, Array<string>> = {
  [CLAUDE_CODE]: ["Metrics"],
  [CURSOR]: ["Logs", "Metrics"],
  [CODEX]: ["Logs"],
};

// A table's create button, drawn as translateCreateAction draws it.
const CREATE_BUTTONS: Record<string, Array<string>> = {
  [LLM]: ["Create LLM Cost Budget"],
  [CURSOR]: ["Create Ingestion Key"],
};

// The monitor status every project is created with: a record, named in English.
const RECORD_NAMES: Record<string, Array<string>> = {
  [LLM]: ["Degraded"],
};

// The replay's keyboard keys.
const KEYS: Record<string, Array<string>> = {
  [LLM]: ["K", "J", "←", "L", "→"],
};

// Names of products, tools and libraries, kept as written.
const NAMES: Record<string, Array<string>> = {
  [LLM]: ["OpenLLMetry", "OpenInference", "Vercel AI SDK"],
  [ASSISTANTS]: [
    "Amazon Bedrock",
    "Azure OpenAI",
    "Windsurf",
    "Gemini CLI",
    "Claude Code",
    "Cursor",
  ],
  [CODEX]: ["OpenTelemetry", "OpenLLMetry", "OpenInference", "OpenAI Agents SDK"],
};

// Labels and paths of Cursor's own dashboard, which is in English.
const OTHER_CONSOLES: Record<string, Array<string>> = {
  [CURSOR]: [
    "Team Settings → OpenTelemetry Export",
    "Test connection",
    "Enable",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them: a signal, a kind of telemetry, a default.
 */
const PROSE: Record<string, Array<string>> = {
  [ASSISTANTS]: ["On"],
  [CLAUDE_CODE]: ["Activity", "Events"],
  [CODEX]: ["Spans", "Metrics"],
};

// The pages' own bold leads: a translation words them freely.
const PROSE_LEADS: Record<string, Array<string>> = {
  [LLM]: ["GenAI semantic conventions"],
  [ASSISTANTS]: [
    "who uses which tool, on which models, and what each person and each team spends",
    "JetBrains AI Assistant and Junie",
    "Every key is also read with a `resource.` prefix.",
    "The Usage tab shows a person's email when the call has one, and the id otherwise.",
    "Identity is read only from AI calls.",
    "Log records are not read for identity.",
    "`gemini_cli.token.usage` is left out on purpose.",
    "Only input and output tokens are counted.",
    "if the same project receives GenAI spans with cost, the coding assistants' spend does not show.",
    "Use LiteLLM with one virtual key per employee.",
    "A gateway sees only traffic sent through it.",
    "A gateway sees the model call, not the agent.",
    "No vendor admin or billing connectors.",
    "Cost is an estimate unless a tool reports it.",
    "Identity on log records is not read.",
    "Cursor's `cursor.user.email` is not read yet",
    "Codex spans name no model",
    "Tools change fast.",
    "Copilot and Codex",
    "A LiteLLM gateway",
  ],
  [CLAUDE_CODE]: [
    "Cost and tokens",
    "Edit decisions",
    "The employee is `user.email`.",
    "Other sign-ins send no email.",
    "`user.id` is not a person.",
    "Teams and cost centres",
    "The metrics fill in for spans; they are never added to them.",
    "A row from metrics carries cost only.",
  ],
  [CURSOR]: [
    "Cursor's Enterprise plan.",
    "An endpoint Cursor can reach from the internet.",
    "Cursor names a person by `cursor.user.id`, an integer only Cursor can turn into a name, and often leaves it out for cloud agents.",
    "if the same project receives GenAI spans with cost, Cursor's spend does not show.",
    "Metrics are sent at most once.",
    "Logs are sent at least once",
    "There is no ordering.",
    "Nothing is backfilled.",
    "Disabling or deleting a destination drops data in flight.",
  ],
  [CODEX]: ["Log records"],
};

interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
}

/*
 * Links into these pages, from other pages and from each other: in every
 * language they name the heading in the English section's place.
 */
const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    from: "monitor/traces-monitor",
    to: LLM,
    anchor: "get-told-when-the-ai-answers-badly",
  },
  {
    from: LLM,
    to: ASSISTANTS,
    anchor: "employee-and-team-attribution",
  },
  {
    from: ASSISTANTS,
    to: LLM,
    anchor: "spans-come-first-metrics-fill-in",
  },
  {
    from: CLAUDE_CODE,
    to: LLM,
    anchor: "spans-come-first-metrics-fill-in",
  },
  {
    from: CURSOR,
    to: LLM,
    anchor: "spans-come-first-metrics-fill-in",
  },
  {
    from: CURSOR,
    to: ASSISTANTS,
    anchor: "employee-and-team-attribution",
  },
  {
    from: CODEX,
    to: LLM,
    anchor: "spans-come-first-metrics-fill-in",
  },
  {
    from: LLM,
    to: "telemetry/open-telemetry",
    anchor: "create-an-ingestion-key",
  },
];

// How a Persian page joins the bold segments of a menu path.
const PERSIAN_PATH_SEPARATOR: string = " > ";

const ONLY_CODE: RegExp = /^`[^`]+`$/;
/*
 * A number as a table states it: 5, 1.5. A translation may write its
 * language's decimal mark or digit group.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// \s takes the no-break spaces French and others group digits with.
const DIGIT_GROUP: RegExp = /(\d)[\s.,'٬](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(lists: Record<string, Array<string>>, page: string): Array<string> {
  return lists[page] || [];
}

// A value of a locale file by its dotted key, or null.
function nestedValue(locale: Record<string, unknown>, key: string): string | null {
  let value: unknown = locale;

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  return typeof value === "string" && value.trim() ? value : null;
}

// How the Products menu draws one of its items in a language.
export function drawnMenuItem(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const key: string | undefined = MENU_ITEM_KEYS[english];

  if (!key) {
    throw new Error(`Not a Products menu item: ${english}`);
  }

  return nestedValue(dashboardLocale(language), key) || english;
}

/*
 * A segment of a menu path as a language draws it: a product opened from
 * the Products menu (the first segment, or the one after "Products") from
 * the menu's key, every other segment as a label.
 */
function drawnSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const fromMenu: boolean =
    MENU_ITEM_KEYS[segment] !== undefined &&
    (index === 0 || segments[index - 1] === PRODUCTS_MENU);

  return fromMenu
    ? drawnMenuItem(language, segment)
    : drawnDashboardLabel(language, segment);
}

// A menu path as a page in a language writes it.
export function drawnPath(language: string, segments: Array<string>): string {
  const drawn: Array<string> = segments.map(
    (_segment: string, index: number): string => {
      return drawnSegment(language, segments, index);
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

// Bold words a translation keeps exactly as the English page writes them.
function keptAsWritten(page: string): Array<string> {
  return [
    ...listed(RECORD_NAMES, page),
    ...listed(KEYS, page),
    ...listed(NAMES, page),
    ...listed(OTHER_CONSOLES, page),
  ];
}

// Every bold English word a list accounts for, on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    keptAsWritten(page).includes(span) ||
    listed(MENU_ITEMS, page).includes(span) ||
    listed(CREATE_BUTTONS, page).includes(span) ||
    listed(PROSE, page).includes(span) ||
    listed(PROSE_LEADS, page).includes(span)
  );
}

/*
 * The Dashboard labels a page names that drawnDashboardLabel draws: every
 * bold label but the ones a list draws, keeps or frees.
 */
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return isActionLabel(label) && !accountedFor(page, label);
  });
}

// The menu paths a page names, but another console's.
function dashboardPaths(page: string): Array<Array<string>> {
  return boldPaths(englishPage(page)).filter(
    (segments: Array<string>): boolean => {
      return !listed(OTHER_CONSOLES, page).includes(
        segments.join(PATH_SEPARATOR),
      );
    },
  );
}

/*
 * Every bold label, create button, menu item and menu path of the English
 * page, as the English page writes it and as a page in the language must:
 * [English bold, drawn bold]. A Persian path is one bold span per segment.
 */
function englishBoldDrawings(
  language: string,
  page: string,
): Array<[string, string]> {
  return [
    ...dashboardLabels(page).map((label: string): [string, string] => {
      return [`**${label}**`, `**${drawnDashboardLabel(language, label)}**`];
    }),
    ...listed(CREATE_BUTTONS, page).map((button: string): [string, string] => {
      return [`**${button}**`, `**${drawnCreateButton(language, button)}**`];
    }),
    ...listed(MENU_ITEMS, page).map((item: string): [string, string] => {
      return [`**${item}**`, `**${drawnMenuItem(language, item)}**`];
    }),
    ...dashboardPaths(page).map(
      (segments: Array<string>): [string, string] => {
        return [drawnPath("en", segments), drawnPath(language, segments)];
      },
    ),
  ];
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

// The widest line of any label of the page's diagrams, in this language.
function widestDiagramLine(language: string, page: string): number {
  return Math.max(
    ...scanMarkdown(readPage(language, page))
      .fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      })
      .flatMap((fence: { code: string }): Array<string> => {
        return diagramLabelLines(fence.code);
      })
      .map(labelLineWidth),
  );
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      MENU_ITEMS,
      CREATE_BUTTONS,
      RECORD_NAMES,
      KEYS,
      NAMES,
      OTHER_CONSOLES,
      PROSE,
      PROSE_LEADS,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("know every bold word on the English pages: a label, a path, a name or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isActionLabel(span) && !accountedFor(page, span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list only bold words the English pages have", () => {
    for (const page of PAGE_NAMES) {
      const english: Array<string> = [
        ...boldLabels(englishPage(page)),
        ...boldPaths(englishPage(page)).map(
          (segments: Array<string>): string => {
            return segments.join(PATH_SEPARATOR);
          },
        ),
      ];
      const stale: Array<string> = [
        ...keptAsWritten(page),
        ...listed(MENU_ITEMS, page),
        ...listed(CREATE_BUTTONS, page),
        ...listed(PROSE, page),
        ...listed(PROSE_LEADS, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("call prose only words the Dashboard has as a label, and leads only words it has not", () => {
    for (const page of PAGE_NAMES) {
      for (const word of listed(PROSE, page)) {
        expect({ page, word, label: isActionLabel(word) }).toEqual({
          page,
          word,
          label: true,
        });
      }

      for (const lead of listed(PROSE_LEADS, page)) {
        expect({ page, lead, label: isActionLabel(lead) }).toEqual({
          page,
          lead,
          label: false,
        });
      }
    }
  });

  it("draw the menu items from keys the English Dashboard has, as the English pages write them", () => {
    for (const [english, key] of Object.entries(MENU_ITEM_KEYS)) {
      expect({ key, drawn: nestedValue(dashboardLocale("en"), key) }).toEqual({
        key,
        drawn: english,
      });
    }

    for (const page of PAGE_NAMES) {
      for (const item of listed(MENU_ITEMS, page)) {
        expect(MENU_ITEM_KEYS[item]).toBeDefined();
      }
    }
  });

  it("draw the create buttons and the record names the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const button of listed(CREATE_BUTTONS, page)) {
        expect(drawnCreateButton("en", button)).toBe(button);
      }
    }

    // A status the project is created with: a key of the locale, and still kept.
    expect(isActionLabel("Degraded")).toBe(true);
  });

  it("name links that the pages really have, to headings the English pages really have", () => {
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
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const firstSection: number = markdown.indexOf("\n## ");
      const opening: Array<string> = cardLines(markdown.slice(0, firstSection));

      expect(opening.length).toBeGreaterThanOrEqual(3);

      for (const line of opening) {
        expect(line).toMatch(/^- \[[^\]]+\]\(#[^)]+\): /);
      }

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      // Two blocks of cards: the opening one and Next steps.
      expect(markdown.split(":::cards").length - 1).toBe(2);
      expect(
        cardLines(markdown.slice(markdown.lastIndexOf("\n## Next steps\n")))
          .length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: TranslatedPage) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  it.each(PAGES)(
    "$page has no two headings with the same anchor",
    (entry: TranslatedPage) => {
      const slugs: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      });

      expect(slugs.length).toBe(new Set(slugs).size);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
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

    it("lies line for line beside the English page: headings, table rows, fences, components and tabs on the same lines", () => {
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

    it("breaks its diagrams' labels into lines short enough for the 590px docs column", () => {
      const widest: number = widestDiagramLine(language, entry.page);

      expect({
        widest: widest,
        fits: widest <= (WIDEST_DIAGRAM_LINE[entry.page] as number),
      }).toEqual({ widest: widest, fits: true });
    });

    it("keeps every piece of inline code: the attributes, metrics, variables and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels, which are product names", () => {
      expect(tabLabels(readPage(language, entry.page))).toEqual(
        tabLabels(english),
      );
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
      const missing: Array<string> = [
        ...dashboardLabels(entry.page).map((label: string): string => {
          return drawnDashboardLabel(language, label);
        }),
        ...listed(CREATE_BUTTONS, entry.page).map((button: string): string => {
          return drawnCreateButton(language, button);
        }),
        ...listed(MENU_ITEMS, entry.page).map((item: string): string => {
          return drawnMenuItem(language, item);
        }),
      ].filter((drawn: string): boolean => {
        return !translated.includes(`**${drawn}**`);
      });

      expect(missing).toEqual([]);
    });

    it("leaves no label, button, menu item or path in English where this language's Dashboard draws it otherwise", () => {
      const translated: string = readPage(language, entry.page);
      const drawnHere: Array<[string, string]> = englishBoldDrawings(
        language,
        entry.page,
      );
      /*
       * A word this page writes in bold on purpose: drawn so, kept as
       * written, or a segment of a Persian path, which is bold on its own.
       */
      const meant: Set<string> = new Set([
        ...drawnHere.map((drawing: [string, string]): string => {
          return drawing[1];
        }),
        ...keptAsWritten(entry.page).map((name: string): string => {
          return `**${name}**`;
        }),
        ...(language === "fa"
          ? dashboardPaths(entry.page).flatMap(
              (segments: Array<string>): Array<string> => {
                return segments.map((_segment: string, index: number): string => {
                  return `**${drawnSegment(language, segments, index)}**`;
                });
              },
            )
          : []),
      ]);
      const leftover: Array<string> = drawnHere
        .filter((drawing: [string, string]): boolean => {
          const [englishBold, drawnBold] = drawing;

          return (
            englishBold !== drawnBold &&
            !meant.has(englishBold) &&
            translated.includes(englishBold)
          );
        })
        .map((drawing: [string, string]): string => {
          return drawing[0];
        });

      expect(leftover).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = dashboardPaths(entry.page)
        .map((segments: Array<string>): string => {
          return drawnPath(language, segments);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what every Dashboard and Cursor's console show in English, and names, as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptAsWritten(entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);
    });
  });

  describe("links into these pages", () => {
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

describe("the helpers, on these pages' shapes", () => {
  it("draw a Products menu item from the menu's key, which can differ from the flat key", () => {
    expect(drawnMenuItem("en", "AI / LLM")).toBe("AI / LLM");
    expect(drawnMenuItem("it", "AI / LLM")).toBe(
      nestedValue(dashboardLocale("it"), "navbar.items.llmObservabilityTitle"),
    );
    expect(() => {
      return drawnMenuItem("de", "Usage");
    }).toThrow();
  });

  it("draw a path in one bold span, a menu item where the Products menu opens it, and a span per segment in Persian", () => {
    const segments: Array<string> = ["Products", "AI / LLM", "Usage"];

    expect(drawnPath("en", segments)).toBe("**Products → AI / LLM → Usage**");
    expect(drawnPath("de", segments)).toBe(
      `**${[
        drawnDashboardLabel("de", "Products"),
        drawnMenuItem("de", "AI / LLM"),
        drawnDashboardLabel("de", "Usage"),
      ].join(PATH_SEPARATOR)}**`,
    );
    expect(drawnPath("fa", ["Traces", "Settings"])).toBe(
      `**${drawnMenuItem("fa", "Traces")}** > **${drawnDashboardLabel("fa", "Settings")}**`,
    );
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("More than 5% of answers in 15 minutes")).toEqual([
      "15",
      "5",
    ]);
    expect(numbersIn("بیش از ۵٪ پاسخ‌ها در ۱۵ دقیقه")).toEqual(["15", "5"]);
    expect(numbersIn("`1740000`, 29 minutes")).toEqual(["1740000", "29"]);
    expect(numbersIn("10 000 Tokens, 1,5 s")).toEqual(["1.5", "10000"]);
  });

  it("read a diagram's label lines as it breaks them, and count a CJK character twice", () => {
    expect(
      diagramLabelLines(
        'flowchart TB\n    app["Your app\'s GenAI<br/>instrumentation"] -->|"Spans over OTLP"| ingest["OneUptime ingest"]',
      ),
    ).toEqual([
      "Your app's GenAI",
      "instrumentation",
      "Spans over OTLP",
      "OneUptime ingest",
    ]);
    expect(labelLineWidth("会话")).toBe(4);
  });
});
