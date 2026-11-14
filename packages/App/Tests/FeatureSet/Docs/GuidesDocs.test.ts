import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { getDocsNavIcon } from "../../../FeatureSet/Docs/Utils/NavIcons";
import { getDocsCategoryFirstPage } from "../../../FeatureSet/Docs/Utils/Redirects";
import {
  DOCS_LANGUAGES,
  DocsContainerUse,
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
import { pathWithArrows } from "./DocsPageShape";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  toLatinDigits,
} from "./DocsTranslationChecks";
import {
  GETTING_STARTED_JOBS,
  GETTING_STARTED_PLACES,
} from "./GettingStartedPage";
import {
  DOCS_GUIDES,
  DocsGuide,
  GUIDE_OPENING,
  GUIDE_PICTURE_TITLE,
  GUIDE_SECTIONS,
  GUIDE_TABS,
  GUIDE_WORD_LIMIT,
  NEW_HERE_LEAD,
  guideUrl,
} from "./GuidesDocsPages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

/*
 * The repository's README. Its 16 translations keep its links line for line,
 * each in its own language (Tests/Ops/ReadmeFacts), so English is enough here.
 */
const README: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../../README.md"),
  "utf8",
);

// A Dashboard source file, read as text: its copy files load the browser's config.
function dashboardFile(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_DIR, relativePath), "utf8");
}

// The entry of a product in the products' explanations, from its key to its end.
function onboardingEntryOf(product: string): string {
  const source: string = dashboardFile(
    "Components/ProductOnboarding/ProductOnboardings.ts",
  );
  const start: number = source.indexOf(`[ProductKey.${product}]: {`);

  if (start === -1) {
    throw new Error(`No onboarding for ${product}`);
  }

  return source.slice(start, source.indexOf("\n  },", start));
}

/*
 * THE GUIDES (#6821): one page per job people come with, each followed
 * from its first line to its last, so nobody has to combine four reference
 * pages from three sections to get one thing done.
 *
 * Every guide has the same shape, so a reader who followed one knows where
 * everything is in the next:
 *
 *   # The job                          its nav title
 *   At the end of this guide, ...      what you will have, then a picture
 *   ## What you need                   Cloud and self-hosted as tabs where they differ
 *   ## Steps                           :::steps, one action each, no links out
 *   ## Check that it worked
 *   ## What can go wrong               :::details, one per problem
 *   ## What to do next                 :::cards
 *
 * Each guide names the Dashboard's buttons and pages in bold, as the
 * Dashboard draws them, in every language. These tests hold every guide in
 * GuidesDocsPages.ts to that, and to being where its job starts: Getting
 * Started's "What do you want to do?", the reference pages it replaces for
 * a newcomer, and the Quickstart.
 */

const GUIDES_GROUP: string = "Guides";
const ARROW: string = " → ";

// Every bold span, in order, as often as it appears.
function allBoldSpans(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(/\*\*([^*\n]+?)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

/*
 * How a language's Dashboard draws an English label, or a menu path of them,
 * with the arrows the language's pages draw between its steps: "←" beside a
 * Persian step (#7611).
 */
function drawnLabel(language: string, english: string): string {
  return pathWithArrows(
    english.split(ARROW).map((part: string): string => {
      return drawnDashboardLabel(language, part);
    }),
    language,
  );
}

// The lines of a "## " section, from its heading to the next "## ".
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`## ${heading}`);

  if (start === -1) {
    return "";
  }

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

// The "## " section at a place, in any language: the translations keep the order.
function sectionAt(markdown: string, place: number): string {
  const lines: Array<string> = markdown.split("\n");
  const starts: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.startsWith("## ") ? index : -1;
    })
    .filter((index: number): boolean => {
      return index !== -1;
    });
  const start: number | undefined = starts[place];

  if (start === undefined) {
    return "";
  }

  return lines.slice(start, starts[place + 1]).join("\n");
}

// What comes before the first "## ": the title, the opening and the picture.
function openingOf(markdown: string): string {
  return markdown.split("\n## ")[0] as string;
}

/*
 * The links a reader could leave by: a picture of the screen is not one
 * (#6823 puts a screenshot under a step's heading), a link to a page is.
 */
function linksOutOf(markdown: string): Array<DocsLink> {
  return scanMarkdown(markdown).links.filter((link: DocsLink): boolean => {
    return !link.isImage;
  });
}

function h2s(markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .headings.filter((heading: DocsHeading): boolean => {
      return heading.level === 2;
    })
    .map((heading: DocsHeading): string => {
      return heading.text;
    });
}

const WORD_CHARACTER: RegExp = /\w/;
// A digit, then a separator before exactly three more digits: "1,000".
const THOUSANDS_SEPARATOR: RegExp = /(\d)[.,\s](?=\d{3}(?!\d))/g;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;

/*
 * A screenshot's alt text (#6823) stands in for the picture a reader looks
 * at, not for words they read through: it is left out of the guide's length.
 */
const SCREENSHOT: RegExp = /!\[(?:\\.|[^\]\\])*\]\(screen:[^)]*\)/g;

function wordsOf(markdown: string): number {
  return prose(markdown.replace(SCREENSHOT, ""))
    .split(/\s+/)
    .filter((word: string): boolean => {
      return WORD_CHARACTER.test(word);
    }).length;
}

// The docs pages a piece of a page links to, without anchors.
function pagesLinked(markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .links.map((link: DocsLink): DocsPageLink | null => {
      return parseDocsLink(link.target);
    })
    .filter((target: DocsPageLink | null): target is DocsPageLink => {
      return target !== null;
    })
    .map((target: DocsPageLink): string => {
      return target.page;
    });
}

const guidesGroup: NavGroup | undefined = DocsNav.find((group: NavGroup) => {
  return group.title === GUIDES_GROUP;
});

describe("the Guides group", () => {
  it("comes right after Introduction, in Get Started, so the sidebar opens on it", () => {
    const titles: Array<string> = DocsNav.map((group: NavGroup): string => {
      return group.title;
    });

    expect(titles.indexOf(GUIDES_GROUP)).toBe(
      titles.indexOf("Introduction") + 1,
    );
    expect(guidesGroup?.section).toBe("Get Started");
    expect(getDocsNavIcon(GUIDES_GROUP)).toContain("M3 21v-4");
  });

  it("lists every guide, in the order of the jobs on Getting Started, each marked as a guide", () => {
    const links: Array<NavLink> = guidesGroup?.links || [];
    const jobOrder: Array<string> = GETTING_STARTED_JOBS.map(
      (job: { job: string }): string => {
        return job.job;
      },
    );

    expect(
      links.map((link: NavLink): string => {
        return link.url;
      }),
    ).toEqual(DOCS_GUIDES.map(guideUrl));

    for (const link of links) {
      expect({ url: link.url, isGuide: link.isGuide }).toEqual({
        url: link.url,
        isGuide: true,
      });
    }

    const places: Array<number> = DOCS_GUIDES.map(
      (guide: DocsGuide): number => {
        return jobOrder.indexOf(guide.job);
      },
    );

    expect(places).not.toContain(-1);
    expect(
      [...places].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(places);
  });

  it("opens the first guide at /docs/guides, and holds guides only", () => {
    expect(getDocsCategoryFirstPage("guides")).toBe(DOCS_GUIDES[0]!.page);

    for (const page of NAV_PAGES) {
      expect({
        page,
        inGuides:
          page.startsWith("guides/") &&
          !DOCS_GUIDES.some((guide: DocsGuide): boolean => {
            return guide.page === page;
          }),
      }).toEqual({ page, inGuides: false });
    }
  });
});

describe.each(DOCS_GUIDES)("$navTitle, in English", (guide: DocsGuide) => {
  const markdown: string = readPage("en", guide.page);

  it("is titled as its nav link, and is in the Guides group", () => {
    expect(markdown.split("\n")[0]).toBe(`# ${guide.navTitle}`);
    expect(guidesGroup?.links).toContainEqual({
      title: guide.navTitle,
      url: guideUrl(guide),
      isGuide: true,
    });
  });

  it("opens with what you will have at the end, then a picture of it", () => {
    const opening: string = openingOf(markdown);
    const lines: Array<string> = opening.split("\n");
    const fences: Array<DocsFence> = scanMarkdown(opening).fences;

    expect(lines[2]?.startsWith(GUIDE_OPENING)).toBe(true);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.lang).toBe("mermaid");
    expect(fences[0]!.info).toContain(`title="${GUIDE_PICTURE_TITLE}"`);
    // Nothing else to choose from before the first step: no cards, no links.
    expect(cardLines(opening)).toEqual([]);
    expect(linksOutOf(opening)).toEqual([]);
  });

  it("has the guides' sections, in their order", () => {
    expect(h2s(markdown)).toEqual(GUIDE_SECTIONS);
  });

  it("walks one list of steps, each a heading, with no link to read in the middle", () => {
    const steps: string = sectionOf(markdown, "Steps");
    const containers: Array<DocsContainerUse> = scanMarkdown(steps).containers;
    const stepHeadings: Array<DocsHeading> = scanMarkdown(
      steps,
    ).headings.filter((heading: DocsHeading): boolean => {
      return heading.level === 3;
    });

    expect(
      containers.map((use: DocsContainerUse): string => {
        return use.name;
      }),
    ).toEqual(["steps"]);
    expect(containers[0]!.steps).toBe(stepHeadings.length);
    expect(stepHeadings.length).toBeGreaterThanOrEqual(4);
    expect(linksOutOf(steps)).toEqual([]);
    // Steps are the only third-level headings: the rest of a guide is flat.
    expect(
      scanMarkdown(markdown).headings.filter((heading: DocsHeading) => {
        return heading.level === 3;
      }),
    ).toHaveLength(stepHeadings.length);
  });

  it("starts every step with the place to go or the thing to do, never with a link to another page", () => {
    const steps: string = sectionOf(markdown, "Steps");

    for (const line of steps.split("\n")) {
      if (line.startsWith("### ")) {
        expect({ line, short: line.length <= 60 }).toEqual({
          line,
          short: true,
        });
      }
    }
  });

  it("lists what can go wrong as one fold per problem, and ends on two to four next steps", () => {
    const wrong: string = sectionOf(markdown, "What can go wrong");
    const next: string = sectionOf(markdown, "What to do next");
    const folds: Array<string> = scanMarkdown(wrong).containers.map(
      (use: DocsContainerUse): string => {
        return use.name;
      },
    );

    expect(folds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(folds)).toEqual(new Set(["details"]));
    expect(cardLines(next).length).toBeGreaterThanOrEqual(2);
    expect(cardLines(next).length).toBeLessThanOrEqual(4);
    for (const line of cardLines(next)) {
      expect({ line, card: CARD_LINE.test(line) }).toEqual({
        line,
        card: true,
      });
    }
  });

  it("shows Cloud and self-hosting as the same two tabs wherever they differ", () => {
    for (const use of scanMarkdown(markdown).containers) {
      if (use.name === "tabs") {
        expect(use.tabs).toEqual(GUIDE_TABS);
      }
    }
  });

  it("is read in one sitting", () => {
    expect(wordsOf(markdown)).toBeLessThan(GUIDE_WORD_LIMIT);
  });

  it("names in bold only the Dashboard's own words, each as the Dashboard draws it", () => {
    const bold: Array<string> = allBoldSpans(markdown);

    expect(
      bold.filter((span: string): boolean => {
        return !guide.dashboardLabels.includes(span);
      }),
    ).toEqual([]);
    for (const label of guide.dashboardLabels) {
      expect({ label, used: bold.includes(label) }).toEqual({
        label,
        used: true,
      });

      for (const part of label.split(ARROW)) {
        expect({ part, isDashboardLabel: isDashboardLabel(part) }).toEqual({
          part,
          isDashboardLabel: true,
        });
      }
    }
  });

  it("links only to pages in the nav, and to headings they have", () => {
    for (const link of scanMarkdown(markdown).links) {
      /*
       * A screenshot (#6823) is a picture, not a link: the content rules
       * hold it to a shot that exists (DocsContentRules' images).
       */
      if (link.target.startsWith("#") || link.isImage) {
        continue;
      }

      const target: DocsPageLink | null = parseDocsLink(link.target);

      expect({ link: link.target, docs: target !== null }).toEqual({
        link: link.target,
        docs: true,
      });
      expect({
        link: link.target,
        inNav: NAV_PAGES.includes(target!.page),
      }).toEqual({ link: link.target, inNav: true });
      if (target!.anchor) {
        expect({
          link: link.target,
          heading: anchorsOf("en", target!.page).has(target!.anchor),
        }).toEqual({ link: link.target, heading: true });
      }
    }
    expect(anchorProblems("en", guide.page)).toEqual([]);
  });
});

describe.each(
  DOCS_GUIDES.flatMap((guide: DocsGuide) => {
    return TRANSLATED_LANGUAGES.map((language: string) => {
      return { guide, language };
    });
  }),
)(
  "$guide.navTitle in $language",
  ({ guide, language }: { guide: DocsGuide; language: string }) => {
    const english: string = readPage("en", guide.page);
    const translated: string = hasPage(language, guide.page)
      ? readPage(language, guide.page)
      : "";

    it("is translated, under the nav link's title in this language", () => {
      expect(hasPage(language, guide.page)).toBe(true);
      expect(translated).not.toEqual(english);
      expect(navTitle(language, guide.navTitle)).toBeTruthy();
      expect(navTitle(language, guide.navTitle)).not.toBe(guide.navTitle);
      expect(translated.split("\n")[0]).toBe(
        `# ${navTitle(language, guide.navTitle)}`,
      );
    });

    it("keeps the English page line for line: headings, steps, tabs, folds, lists, code and the picture", () => {
      const ours: ReturnType<typeof scanMarkdown> = scanMarkdown(english);
      const theirs: ReturnType<typeof scanMarkdown> = scanMarkdown(translated);

      expect(translated.split("\n")).toHaveLength(english.split("\n").length);
      expect(
        theirs.headings.map((heading: DocsHeading): string => {
          return `${heading.level}@${heading.line}`;
        }),
      ).toEqual(
        ours.headings.map((heading: DocsHeading): string => {
          return `${heading.level}@${heading.line}`;
        }),
      );
      expect(
        theirs.containers.map((use: DocsContainerUse) => {
          return [use.name, use.line, use.tabs.length, use.steps];
        }),
      ).toEqual(
        ours.containers.map((use: DocsContainerUse) => {
          return [use.name, use.line, use.tabs.length, use.steps];
        }),
      );
      expect(theirs.fences.map(comparableFence)).toEqual(
        ours.fences.map(comparableFence),
      );
      expect(inlineCode(translated)).toEqual(inlineCode(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
      expect(theirs.alerts).toEqual(ours.alerts);
    });

    it("keeps OneUptime Cloud's name on its tab, and translates the other", () => {
      const tabs: Array<Array<string>> = scanMarkdown(translated)
        .containers.filter((use: DocsContainerUse): boolean => {
          return use.name === "tabs";
        })
        .map((use: DocsContainerUse): Array<string> => {
          return use.tabs;
        });

      for (const labels of tabs) {
        expect(labels[0]).toBe(GUIDE_TABS[0]);
        expect(labels[1]?.trim()).toBeTruthy();
      }
    });

    it("links to the pages the English links to, and writes its cards with an ASCII ': '", () => {
      const cards: Array<string> = cardLines(translated);

      expect(pagesLinked(translated).sort()).toEqual(
        pagesLinked(english).sort(),
      );
      expect(cardTargets(cards)).toEqual(cardTargets(cardLines(english)));
      for (const line of cards) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }
      expect(anchorProblems(language, guide.page)).toEqual([]);
    });

    it("names every Dashboard word as this language's Dashboard draws it, as often as the English does", () => {
      const bold: Array<string> = allBoldSpans(translated);
      const missing: Array<string> = guide.dashboardLabels
        .map((label: string): string => {
          return drawnLabel(language, label);
        })
        .filter((drawn: string): boolean => {
          return !bold.includes(drawn);
        });

      expect(missing).toEqual([]);
      expect(bold).toHaveLength(allBoldSpans(english).length);
    });

    it("keeps the numbers the English gives, amounts as the product writes them", () => {
      /*
       * A thousands separator is the language's own ("1,000", "1.000",
       * "1 000", where \s covers the no-break spaces); an amount keeps the
       * product's "1.00 USD" in every language, as
       * formatProjectBalanceAmount writes it.
       */
      const numbers: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (
          toLatinDigits(prose(text))
            .replace(THOUSANDS_SEPARATOR, "$1")
            .match(NUMBER) || []
        ).sort();
      };

      expect(numbers(translated)).toEqual(numbers(english));
    });
  },
);

describe.each(DOCS_LANGUAGES)("the guides in %s", (language: string) => {
  /*
   * The docs remember a reader's tab by its label, and open the same tab on
   * the next page: one pair of labels in every guide of a language carries
   * "Self-hosted" from one guide to the next.
   */
  it("label Cloud and self-hosting alike in every guide", () => {
    const pairs: Set<string> = new Set(
      DOCS_GUIDES.flatMap((guide: DocsGuide): Array<string> => {
        return scanMarkdown(readPage(language, guide.page))
          .containers.filter((use: DocsContainerUse): boolean => {
            return use.name === "tabs";
          })
          .map((use: DocsContainerUse): string => {
            return use.tabs.join(" | ");
          });
      }),
    );

    expect(pairs.size).toBe(1);
  });
});

/*
 * The Quickstart stays the fifteen-minute tour, and sends each job on to its
 * guide. Its first screen also offers the import, for whoever comes from
 * another tool (#7031): the Getting Started half of that shipped with #6822.
 */
describe.each(DOCS_LANGUAGES)("the Quickstart in %s", (language: string) => {
  it("offers the import from another tool on its first screen, at Getting Started's section on it", () => {
    const opening: string = openingOf(
      readPage(language, "introduction/quickstart"),
    );
    const comingFrom: DocsHeading | undefined = scanMarkdown(
      readPage(language, "introduction/getting-started"),
    ).headings.filter((heading: DocsHeading): boolean => {
      return heading.level === 2;
    })[GETTING_STARTED_PLACES.comingFrom];
    const links: Array<DocsPageLink | null> = scanMarkdown(opening).links.map(
      (link: DocsLink): DocsPageLink | null => {
        return parseDocsLink(link.target);
      },
    );

    expect(comingFrom).toBeDefined();
    expect(links).toContainEqual({
      page: "introduction/getting-started",
      anchor: comingFrom!.slug,
    });
    if (language === "en") {
      expect(opening).toContain("Coming from another tool? [Import it](");
    }
  });
});

/*
 * Two pages describe the Kubernetes agent, in two sections (#6821 item 7).
 * Each says in its first lines which one the reader wants, and links the
 * other: the Helm install step by step, or the full reference.
 */
describe.each(DOCS_LANGUAGES)(
  "the two Kubernetes agent pages in %s",
  (language: string) => {
    const pairs: Array<{ page: string; other: string }> = [
      { page: "monitor/kubernetes-agent", other: "telemetry/kubernetes-agent" },
      { page: "telemetry/kubernetes-agent", other: "monitor/kubernetes-agent" },
    ];

    it.each(pairs)(
      "$page says which page the reader wants, and links $other",
      ({ page, other }: { page: string; other: string }) => {
        const opening: string = openingOf(readPage(language, page));
        const note: Array<string> = opening
          .split("\n")
          .filter((line: string): boolean => {
            return line.startsWith(">");
          });

        expect(scanMarkdown(opening).alerts).toEqual(["NOTE"]);
        expect(note[0]).toBe("> [!NOTE]");
        expect(pagesLinked(note.join("\n"))).toEqual([other]);
        // The note is the first thing under the opening paragraph.
        expect(opening.split("\n").indexOf("> [!NOTE]")).toBe(4);
      },
    );
  },
);

describe.each(DOCS_GUIDES)(
  "where people meet $navTitle",
  (guide: DocsGuide) => {
    it("is its job's card on Getting Started", () => {
      expect(
        GETTING_STARTED_JOBS.find((job: { job: string }): boolean => {
          return job.job === guide.job;
        })?.target,
      ).toBe(guideUrl(guide));
    });

    it("is linked from its product's explanation: the empty list and How it works", () => {
      expect(guide.products.length).toBeGreaterThan(0);

      for (const product of guide.products) {
        expect({
          product,
          links: onboardingEntryOf(product).includes(
            `guideRoute: docs("${guide.page}"),`,
          ),
        }).toEqual({ product, links: true });
      }
    });

    it("is linked from its guided setup, beside the progress line", () => {
      if (!guide.guidedSetup) {
        return;
      }

      const copy: string = dashboardFile(guide.guidedSetup.copyFile);
      const page: string = dashboardFile(guide.guidedSetup.pageFile);

      expect(copy.replace(/\s+/g, " ")).toContain(
        `export const ${guide.guidedSetup.constant}: string = "${guideUrl(guide)}";`,
      );
      expect(page).toContain(`guideDocsPath={${guide.guidedSetup.constant}}`);
    });

    it("is linked from the README, by its title, on the line that lists the guides", () => {
      const line: string | undefined = README.split("\n").find(
        (entry: string): boolean => {
          return entry.startsWith("Step-by-step guides ");
        },
      );

      expect(line).toContain(
        `[${guide.navTitle}](https://oneuptime.com${guideUrl(guide)})`,
      );
    });

    it.each(DOCS_LANGUAGES)(
      "is what each reference page it replaces offers a newcomer first, in %s",
      (language: string) => {
        for (const page of guide.referencePages) {
          const opening: string = openingOf(readPage(language, page));
          const tip: Array<string> = opening
            .split("\n")
            .filter((line: string): boolean => {
              return line.startsWith(">");
            });

          expect({ page, alerts: scanMarkdown(opening).alerts }).toEqual({
            page,
            alerts: ["TIP"],
          });
          expect({ page, linksGuide: pagesLinked(tip.join("\n")) }).toEqual({
            page,
            linksGuide: [guide.page],
          });
          expect(tip.join("\n")).toContain(
            `[${language === "en" ? guide.navTitle : navTitle(language, guide.navTitle)}](${guideUrl(guide)})`,
          );

          if (language === "en") {
            expect(tip).toEqual([
              "> [!TIP]",
              `> ${NEW_HERE_LEAD} [${guide.navTitle}](${guideUrl(guide)}).`,
            ]);
          }
        }
      },
    );

    it.each(DOCS_LANGUAGES)(
      "ends its Quickstart section with a link to it, in %s",
      (language: string) => {
        if (!guide.quickstartSection) {
          return;
        }

        const english: string = readPage("en", "introduction/quickstart");
        const place: number = h2s(english).indexOf(guide.quickstartSection);
        const section: Array<string> = sectionAt(
          readPage(language, "introduction/quickstart"),
          place,
        )
          .trimEnd()
          .split("\n");

        expect(place).toBeGreaterThan(-1);
        expect(pagesLinked(section[section.length - 1] as string)).toEqual([
          guide.page,
        ]);
      },
    );
  },
);
