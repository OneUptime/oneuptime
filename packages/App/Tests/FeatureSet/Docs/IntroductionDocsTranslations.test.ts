import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  ScannedPage,
  hasPage,
  parseDocsLink,
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
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 5: the Introduction group - Getting Started, the
 * Quickstart, Core Concepts, Home Page & Shortcuts and Your Account - in
 * every docs language. Each translation says what the English page says:
 * the same sections, tables, lists, cards and diagrams, links that land on a
 * heading in the reader's language, a title that is the nav link's, and the
 * product named the way that language's product draws it.
 *
 * "The way the product draws it" has four sources on these pages:
 *
 *   - A bold Dashboard label (DocsDashboardLabels) is its value in that
 *     language's Dashboard locale, Persian included, as on the on-call,
 *     runbook, workflow and OpenTelemetry pages (drawnActionLabel, which
 *     also fills "Create {{itemName}}" and "Edit {{itemName}}"). Menu paths
 *     ("A → B → C") are drawn segment by segment.
 *   - The user menu (Profile is a flat key; Admin Settings, Dark theme,
 *     Light theme and Log out are the Dashboard's userProfile.* keys) and
 *     the sign-in page (the Accounts app's own locale) are read from where
 *     those screens read them (USER_MENU_LABELS, SIGN_IN_LABELS).
 *   - Bold words that are Dashboard labels only by coincidence - a concept
 *     introduced in prose, a list item's lead - are PROSE, with why.
 *   - Getting Started's section headings are the docs' own sidebar section
 *     titles (Docs/Locales navSections), in sidebar order.
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

const GETTING_STARTED: string = "introduction/getting-started";
const QUICKSTART: string = "introduction/quickstart";
const CORE_CONCEPTS: string = "introduction/core-concepts";
const HOME: string = "introduction/home";
const YOUR_ACCOUNT: string = "introduction/your-account";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: GETTING_STARTED, navTitle: "Getting Started" },
  { page: QUICKSTART, navTitle: "Quickstart" },
  { page: CORE_CONCEPTS, navTitle: "Core Concepts" },
  { page: HOME, navTitle: "Home Page & Shortcuts" },
  { page: YOUR_ACCOUNT, navTitle: "Your Account" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them: a concept introduced in a sentence ("A **project**
 * holds everything"), which a translation words as its grammar needs.
 */
const PROSE: Record<string, Array<string>> = {
  // "An **incident** is a problem that affects your users."
  [GETTING_STARTED]: ["incident", "alert"],
  [CORE_CONCEPTS]: [
    // Each concept, bolded where it is first explained.
    "project",
    "teams",
    "monitor",
    "criteria",
    "episode",
    "on-call policy",
    "on-call schedule",
    "status page",
    "subscribers",
    "Scheduled maintenance",
    "Telemetry",
    "Labels",
    "Owners",
  ],
};

/*
 * The user menu at the top right: its items are the Dashboard's
 * userProfile.* keys (Components/Header/UserProfile.tsx), not flat labels.
 */
const USER_MENU_LABELS: Record<string, string> = {
  "Admin Settings": "adminSettings",
  "Dark theme": "darkTheme",
  "Light theme": "lightTheme",
  "Log out": "logOut",
};

/*
 * The sign-in page is the Accounts app, with a locale of its own
 * (Accounts/src/Locales): login.* keys, by their English text.
 */
const SIGN_IN_LABELS: Record<string, Array<string>> = {
  "Sign in with a passkey": ["login", "passkey", "signIn"],
  "Forgot password?": ["login", "forgotPassword"],
  "Lost access to your authenticator?": ["login", "twoFactor", "lostAccess"],
};

const ACCOUNTS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Accounts/src/Locales",
);

const DOCS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

function accountsLabel(language: string, keys: Array<string>): string {
  let value: unknown = JSON.parse(
    fs.readFileSync(path.join(ACCOUNTS_LOCALES_DIR, `${language}.json`), "utf8"),
  ) as unknown;

  for (const key of keys) {
    value = (value as Record<string, unknown>)[key];
  }

  return value as string;
}

function userMenuLabel(language: string, key: string): string {
  const userProfile: Record<string, string> = dashboardLocale(language)[
    "userProfile"
  ] as Record<string, string>;

  return userProfile[key] as string;
}

// A docs sidebar section's title in a language (Docs/Locales navSections).
function sectionTitle(language: string, section: string): string {
  const locale: { navSections: Record<string, string> } = JSON.parse(
    fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${language}.json`), "utf8"),
  ) as { navSections: Record<string, string> };

  return locale.navSections[section] as string;
}

const PATH_SEPARATOR: string = " → ";

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

// The headings of a page under the "## " heading at an index, up to the next.
function subheadingsOf(
  scanned: ScannedPage,
  sectionIndex: number,
): Array<DocsHeading> {
  const sections: Array<DocsHeading> = scanned.headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.level === 2;
    },
  );
  const start: DocsHeading = sections[sectionIndex] as DocsHeading;
  const end: DocsHeading | undefined = sections[sectionIndex + 1];

  return scanned.headings.filter((heading: DocsHeading): boolean => {
    return (
      heading.level === 3 &&
      heading.line > start.line &&
      (end === undefined || heading.line < end.line)
    );
  });
}

// The index of the English "## " heading with this text.
function englishSectionIndex(page: string, text: string): number {
  const index: number = scanMarkdown(englishPage(page))
    .headings.filter((heading: DocsHeading): boolean => {
      return heading.level === 2;
    })
    .findIndex((heading: DocsHeading): boolean => {
      return heading.text === text;
    });

  expect({ page: page, section: text, found: index >= 0 }).toEqual({
    page: page,
    section: text,
    found: true,
  });

  return index;
}

// The nav groups a page links into, by title.
function groupsLinkedFrom(markdown: string): Set<string> {
  const pages: Set<string> = new Set(
    scanMarkdown(markdown)
      .links.map((link: { target: string }): string | null => {
        return parseDocsLink(link.target)?.page || null;
      })
      .filter((page: string | null): page is string => {
        return page !== null;
      }),
  );

  return new Set(
    DocsNav.filter((group: NavGroup): boolean => {
      return group.links.some((link: NavLink): boolean => {
        return pages.has(link.url.replace(/^\/docs\//, ""));
      });
    }).map((group: NavGroup): string => {
      return group.title;
    }),
  );
}

describe("the lists this test keeps", () => {
  it("name only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      expect(PAGE_NAMES).toContain(page);

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

  it("name user menu and sign-in labels the English Your Account page bolds, and nothing the Dashboard has as a flat label", () => {
    const labels: Array<string> = boldLabels(englishPage(YOUR_ACCOUNT));

    for (const label of [
      ...Object.keys(USER_MENU_LABELS),
      ...Object.keys(SIGN_IN_LABELS),
    ]) {
      expect({ label: label, bold: labels.includes(label) }).toEqual({
        label: label,
        bold: true,
      });
      expect({ label: label, flat: isActionLabel(label) }).toEqual({
        label: label,
        flat: false,
      });
    }

    for (const [label, key] of Object.entries(USER_MENU_LABELS)) {
      expect(userMenuLabel("en", key)).toBe(label);
    }

    for (const [label, keys] of Object.entries(SIGN_IN_LABELS)) {
      expect(accountsLabel("en", keys)).toBe(label);
    }
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      const labels: number = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isActionLabel(label);
        },
      ).length;

      // Getting Started names two controls; the others dozens.
      const enough: number = page === GETTING_STARTED ? 2 : 15;

      expect({ page: page, enough: labels >= enough }).toEqual({
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
    "$page ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

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

  it("Getting Started explores the docs section by section, in sidebar order, after Get Started", () => {
    const scanned: ScannedPage = scanMarkdown(englishPage(GETTING_STARTED));
    const explore: Array<string> = subheadingsOf(
      scanned,
      englishSectionIndex(GETTING_STARTED, "Explore the docs"),
    ).map((heading: DocsHeading): string => {
      return heading.text;
    });

    expect(explore).toEqual(
      DocsNavSections.filter((section: string): boolean => {
        return section !== "Get Started";
      }),
    );
  });

  it("Getting Started's cards under each section open only that section's pages", () => {
    const markdown: string = englishPage(GETTING_STARTED);
    const lines: Array<string> = markdown.split("\n");
    let section: string | null = null;
    let checked: number = 0;

    for (const line of lines) {
      if (line.startsWith("## ")) {
        section = null;
      }

      if (line.startsWith("### ") && DocsNavSections.includes(line.slice(4))) {
        section = line.slice(4);
        continue;
      }

      if (!section || !CARD_LINE.test(line)) {
        continue;
      }

      const page: string = (cardTargets([line])[0] as string).replace(
        /^\/docs\//,
        "",
      );
      const group: NavGroup | undefined = DocsNav.find(
        (candidate: NavGroup): boolean => {
          return candidate.links.some((link: NavLink): boolean => {
            return link.url === `/docs/${page}`;
          });
        },
      );

      expect({ line: line, section: group?.section }).toEqual({
        line: line,
        section: section,
      });
      checked++;
    }

    expect(checked).toBeGreaterThan(20);
  });
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
        scanMarkdown(translated).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: DocsHeading) => {
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
  });

  describe("Getting Started", () => {
    it("explores the docs under this language's sidebar section titles, in order", () => {
      const scanned: ScannedPage = scanMarkdown(
        readPage(language, GETTING_STARTED),
      );
      const explore: Array<string> = subheadingsOf(
        scanned,
        englishSectionIndex(GETTING_STARTED, "Explore the docs"),
      ).map((heading: DocsHeading): string => {
        return heading.text;
      });

      expect(explore).toEqual(
        DocsNavSections.filter((section: string): boolean => {
          return section !== "Get Started";
        }).map((section: string): string => {
          return sectionTitle(language, section);
        }),
      );
    });

    it("links into every nav group, as the English page does", () => {
      expect(
        Array.from(groupsLinkedFrom(readPage(language, GETTING_STARTED))),
      ).toEqual(Array.from(groupsLinkedFrom(englishPage(GETTING_STARTED))));
      expect(groupsLinkedFrom(englishPage(GETTING_STARTED)).size).toBe(
        DocsNav.filter((group: NavGroup): boolean => {
          return group.links.some((link: NavLink): boolean => {
            return link.url.startsWith("/docs/");
          });
        }).length,
      );
    });
  });

  describe("Your Account", () => {
    it("names the user menu's items as this language's Dashboard draws them", () => {
      const translated: string = readPage(language, YOUR_ACCOUNT);

      for (const [english, key] of Object.entries(USER_MENU_LABELS)) {
        const drawn: string = userMenuLabel(language, key);

        expect({ english: english, drawn: drawn, ok: true }).toEqual({
          english: english,
          drawn: drawn,
          ok: translated.includes(`**${drawn}**`),
        });
      }
    });

    it("names the sign-in page's links as this language's sign-in page draws them", () => {
      const translated: string = readPage(language, YOUR_ACCOUNT);

      for (const [english, keys] of Object.entries(SIGN_IN_LABELS)) {
        const drawn: string = accountsLabel(language, keys);

        expect({ english: english, drawn: drawn, ok: true }).toEqual({
          english: english,
          drawn: drawn,
          ok: translated.includes(`**${drawn}**`),
        });
      }
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add menu paths, a page's sub-sections and the nav groups it reaches.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Project Settings → Telemetry & APM → Ingestion Keys** and **Enable AI**";

    expect(menuPaths(markdown)).toEqual([
      ["Project Settings", "Telemetry & APM", "Ingestion Keys"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Enable AI"]);
  });

  it("read the sub-sections of one section only", () => {
    const scanned: ScannedPage = scanMarkdown(
      [
        "# Page",
        "## First",
        "### A",
        "### B",
        "## Second",
        "### C",
        "## Third",
      ].join("\n"),
    );

    expect(
      subheadingsOf(scanned, 0).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(["A", "B"]);
    expect(
      subheadingsOf(scanned, 1).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(["C"]);
    expect(subheadingsOf(scanned, 2)).toEqual([]);
  });

  it("find the nav groups a page reaches, from its links", () => {
    const groups: Set<string> = groupsLinkedFrom(
      [
        "[One](/docs/monitor/create-monitor)",
        "[Two](/docs/monitor/website-monitor#criteria)",
        "[Three](/docs/de/incidents/index)",
        "[Elsewhere](https://example.com)",
      ].join("\n"),
    );

    expect(Array.from(groups)).toEqual(["Monitor", "Incidents"]);
  });

  it("compare a flowchart by its ids and arrows, not its words", () => {
    const english: string = [
      "flowchart TB",
      '    monitor["Website monitor"] -->|"site is down"| incident["Incident"]',
    ].join("\n");
    const translated: string = [
      "flowchart TB",
      '    monitor["Website-Monitor"] -->|"Website ist down"| incident["Vorfall"]',
    ].join("\n");
    const rewired: string = [
      "flowchart TB",
      '    incident["Website-Monitor"] -->|"Website ist down"| monitor["Vorfall"]',
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });
});
