import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import {
  CARD_LINE,
  cardLines,
  cardTargets,
  navTitle,
} from "./DocsTranslationChecks";
import {
  GETTING_STARTED_JOBS,
  GETTING_STARTED_NEWCOMER_TARGETS,
  GETTING_STARTED_PAGE,
  GETTING_STARTED_PLACES,
  cardTargetsAt,
  exploreSections,
  foldedBlocks,
  pageSections,
  sectionAt,
} from "./GettingStartedPage";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS' FRONT DOOR CHOOSES A PATH (issue #6822).
 *
 * /docs opens Getting Started. It used to read like a sitemap: a paragraph,
 * six "Start here" cards, a diagram, a 40-card index of every group, an
 * 11-tool import table and a "what OneUptime replaces" table, about sixty
 * links. Now it asks first:
 *
 *   - "What do you want to do?": the eight jobs people come with (#6821),
 *     each one click from the page that answers it today - and from its
 *     guide once #6821 writes one (GETTING_STARTED_JOBS holds the list);
 *   - "New to OneUptime?": the Quickstart, Core Concepts, the Glossary and
 *     Which One Do I Use?, and the Self-Hosting Guide for who runs their
 *     own server;
 *   - "Coming from another tool": the import, with its tables folded;
 *   - and then the full index, every sidebar section folded, so every nav
 *     group is still one click away (DocsContentRules keeps that rule).
 *
 * Each translation says the same in its own words, to the same pages.
 */

const ENGLISH: string = readPage("en", GETTING_STARTED_PAGE);
const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const sectionTitle: (language: string, section: string) => string = (
  language: string,
  section: string,
): string => {
  const locale: { navSections: Record<string, string> } = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as { navSections: Record<string, string> };

  return locale.navSections[section] as string;
};

const NAV_URLS: Set<string> = new Set<string>(
  DocsNav.flatMap((group: NavGroup): Array<string> => {
    return group.links.map((link: NavLink): string => {
      return link.url;
    });
  }),
);

// The text of a card line: "[title](target): description" as its two parts.
const cardParts: (line: string) => { title: string; description: string } = (
  line: string,
): { title: string; description: string } => {
  const match: RegExpMatchArray | null = line.match(
    /^- \[([^\]]+)\]\([^)\s]+\): (.+)$/,
  );

  expect({ line, isCard: Boolean(match) }).toEqual({ line, isCard: true });

  return {
    title: (match as RegExpMatchArray)[1] as string,
    description: (match as RegExpMatchArray)[2] as string,
  };
};

// What comes before the first "## ": the title and what the page is.
const opening: (markdown: string) => string = (markdown: string): string => {
  return markdown.split("\n## ")[0] as string;
};

const SELF_HOSTING_GUIDE: string = "/docs/installation/self-hosting-guide";

describe("Getting Started, in English", () => {
  it("opens on what OneUptime is, then asks what you want to do before anything else", () => {
    expect(scanMarkdown(opening(ENGLISH)).links).toEqual([]);
    expect(cardLines(opening(ENGLISH))).toEqual([]);
    expect(
      pageSections(ENGLISH).map((section: { heading: string }): string => {
        return section.heading;
      }),
    ).toEqual([
      "What do you want to do?",
      "New to OneUptime?",
      "Coming from another tool",
      "How OneUptime fits together",
      "Explore the docs",
      "Next steps",
    ]);
  });

  it("offers the eight jobs of #6821, in its order, each opening the page that answers it today", () => {
    const lines: Array<string> = cardLines(
      sectionAt(ENGLISH, GETTING_STARTED_PLACES.jobs),
    );

    expect(
      lines.map((line: string): string => {
        return cardParts(line).title;
      }),
    ).toEqual(
      GETTING_STARTED_JOBS.map((job: { job: string }): string => {
        return job.job;
      }),
    );
    expect(cardTargets(lines)).toEqual(
      GETTING_STARTED_JOBS.map((job: { target: string }): string => {
        return job.target;
      }),
    );

    for (const job of GETTING_STARTED_JOBS) {
      expect({ target: job.target, inNav: NAV_URLS.has(job.target) }).toEqual({
        target: job.target,
        inNav: true,
      });
    }
  });

  it("says each job in a sentence a newcomer reads in one glance", () => {
    for (const line of cardLines(
      sectionAt(ENGLISH, GETTING_STARTED_PLACES.jobs),
    )) {
      const { title, description } = cardParts(line);

      expect({ title, short: title.length <= 60 }).toEqual({
        title,
        short: true,
      });
      expect({
        description,
        oneSentence:
          description.length <= 100 &&
          description.endsWith(".") &&
          description.split(". ").length === 1,
      }).toEqual({ description, oneSentence: true });
    }
  });

  it("then offers a newcomer the Quickstart, Core Concepts, the Glossary and Which One Do I Use?, and the Self-Hosting Guide", () => {
    const newcomers: string = sectionAt(
      ENGLISH,
      GETTING_STARTED_PLACES.newcomers,
    );

    expect(cardTargets(cardLines(newcomers))).toEqual(
      GETTING_STARTED_NEWCOMER_TARGETS,
    );
    expect(newcomers).toContain(`[Self-Hosting Guide](${SELF_HOSTING_GUIDE})`);
    // A sentence, not a card: the Installation card under Self-Hosting is the guide's one card.
    expect(cardTargets(cardLines(newcomers))).not.toContain(SELF_HOSTING_GUIDE);
    expect(
      cardTargets(cardLines(ENGLISH)).filter((target: string): boolean => {
        return target === SELF_HOSTING_GUIDE;
      }),
    ).toHaveLength(1);
  });

  it("keeps the first screen short: a dozen cards before anything is folded", () => {
    const firstScreen: string = pageSections(ENGLISH)
      .slice(0, GETTING_STARTED_PLACES.comingFrom + 1)
      .map((section: { body: string }): string => {
        return section.body;
      })
      .join("\n");
    const outsideFolds: string = firstScreen
      .split("\n")
      .filter((line: string): boolean => {
        return !line.startsWith("|");
      })
      .join("\n");

    expect(
      cardLines(sectionAt(ENGLISH, GETTING_STARTED_PLACES.jobs)).length +
        cardLines(sectionAt(ENGLISH, GETTING_STARTED_PLACES.newcomers)).length,
    ).toBe(12);
    // The import's two tables are folded, so their rows wait for a click.
    expect(
      foldedBlocks(sectionAt(ENGLISH, GETTING_STARTED_PLACES.comingFrom)).map(
        (block: { title: string }): string => {
          return block.title;
        },
      ),
    ).toEqual(["The eleven tools it imports from", "What OneUptime replaces"]);
    expect(scanMarkdown(outsideFolds).links.length).toBeLessThanOrEqual(14);
  });

  it("folds the full index, one sidebar section to a fold, so every section is one click away", () => {
    const sections: Array<{ title: string; targets: Array<string> }> =
      exploreSections(ENGLISH, GETTING_STARTED_PLACES.explore);

    expect(
      sections.map((section: { title: string }): string => {
        return section.title;
      }),
    ).toEqual(
      DocsNavSections.filter((section: string): boolean => {
        return section !== "Get Started";
      }),
    );

    for (const section of sections) {
      expect({
        title: section.title,
        cards: section.targets.length > 0,
      }).toEqual({ title: section.title, cards: true });
    }

    // No headings under Explore: a fold's title is its section.
    expect(
      sectionAt(ENGLISH, GETTING_STARTED_PLACES.explore)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("#");
        }),
    ).toEqual([]);
  });

  it("still reaches every nav group, the jobs and the folds together", () => {
    const linked: Set<string> = new Set<string>(
      cardTargets(cardLines(ENGLISH)),
    );

    for (const group of DocsNav) {
      const pages: Array<string> = group.links
        .map((link: NavLink): string => {
          return link.url;
        })
        .filter((url: string): boolean => {
          return url.startsWith("/docs/");
        });

      if (pages.length === 0) {
        continue;
      }

      expect({
        group: group.title,
        reached:
          pages.some((url: string): boolean => {
            return linked.has(url);
          }) ||
          scanMarkdown(ENGLISH).links.some(
            (link: { target: string }): boolean => {
              return pages.includes(link.target);
            },
          ),
      }).toEqual({ group: group.title, reached: true });
    }
  });

  /*
   * #6821's signpost: Server / VM monitors can no longer be created, so the
   * Infrastructure monitors card opens the Host monitor.
   */
  it("opens Infrastructure monitors at a monitor people can still create", () => {
    const monitoring: Array<string> = exploreSections(
      ENGLISH,
      GETTING_STARTED_PLACES.explore,
    )[0]!.targets;

    expect(monitoring).toContain("/docs/monitor/host-monitor");
    expect(monitoring).not.toContain("/docs/monitor/server-monitor");
  });
});

describe.each(LANGUAGES)("Getting Started in %s", (language: string) => {
  const translated: string = readPage(language, GETTING_STARTED_PAGE);

  it("asks the same questions in the same order", () => {
    expect(pageSections(translated)).toHaveLength(pageSections(ENGLISH).length);
    expect(cardLines(opening(translated))).toEqual([]);
  });

  it("offers the same eight jobs, to the same pages, in its own words", () => {
    const lines: Array<string> = cardLines(
      sectionAt(translated, GETTING_STARTED_PLACES.jobs),
    );
    const english: Array<string> = cardLines(
      sectionAt(ENGLISH, GETTING_STARTED_PLACES.jobs),
    );

    expect(cardTargets(lines)).toEqual(cardTargets(english));

    lines.forEach((line: string, place: number): void => {
      expect(CARD_LINE.test(line)).toBe(true);
      const theirs: { title: string; description: string } = cardParts(line);
      const ours: { title: string; description: string } = cardParts(
        english[place] as string,
      );

      expect({ place, translated: theirs.title !== ours.title }).toEqual({
        place,
        translated: true,
      });
      expect({
        place,
        translated: theirs.description !== ours.description,
      }).toEqual({ place, translated: true });
    });

    expect(pageSections(translated)[0]!.heading).not.toBe(
      pageSections(ENGLISH)[0]!.heading,
    );
  });

  it("offers a newcomer the same pages, and the Self-Hosting Guide under this language's name", () => {
    const newcomers: string = sectionAt(
      translated,
      GETTING_STARTED_PLACES.newcomers,
    );

    expect(cardTargetsAt(translated, GETTING_STARTED_PLACES.newcomers)).toEqual(
      GETTING_STARTED_NEWCOMER_TARGETS,
    );
    expect(newcomers).toContain(
      `[${navTitle(language, "Self-Hosting Guide")}](${SELF_HOSTING_GUIDE})`,
    );
    expect(newcomers).not.toContain("Running OneUptime on your own servers?");
  });

  it("folds the import's tables under titles of its own", () => {
    const folds: Array<{ title: string }> = foldedBlocks(
      sectionAt(translated, GETTING_STARTED_PLACES.comingFrom),
    );
    const english: Array<{ title: string }> = foldedBlocks(
      sectionAt(ENGLISH, GETTING_STARTED_PLACES.comingFrom),
    );

    expect(folds).toHaveLength(english.length);
    folds.forEach((fold: { title: string }, place: number): void => {
      expect(fold.title).not.toBe(english[place]!.title);
      expect(fold.title.trim()).not.toBe("");
    });
  });

  it("folds the full index under this language's sidebar section titles, each to the same pages", () => {
    const theirs: Array<{ title: string; targets: Array<string> }> =
      exploreSections(translated, GETTING_STARTED_PLACES.explore);
    const ours: Array<{ title: string; targets: Array<string> }> =
      exploreSections(ENGLISH, GETTING_STARTED_PLACES.explore);

    expect(
      theirs.map((section: { title: string }): string => {
        return section.title;
      }),
    ).toEqual(
      DocsNavSections.filter((section: string): boolean => {
        return section !== "Get Started";
      }).map((section: string): string => {
        return sectionTitle(language, section);
      }),
    );
    expect(
      theirs.map((section: { targets: Array<string> }): Array<string> => {
        return section.targets;
      }),
    ).toEqual(
      ours.map((section: { targets: Array<string> }): Array<string> => {
        return section.targets;
      }),
    );
  });
});
