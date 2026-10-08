import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DOCS_LANGUAGES,
  DocsContainerProblem,
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  NAV_PAGES,
  STATIC_DIR,
  ScannedPage,
  anchorsOf,
  hasPage,
  listPages,
  parseDocsLink,
  readPage,
  scanPage,
} from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every page in every language, held to the rules a reader relies on:
 *
 *   - the nav and the files agree: every page the nav lists exists, and every
 *     page that exists is listed (a page outside the nav is a 404);
 *   - a page has one title, on its first line;
 *   - components are written so the renderer reads them - known names,
 *     closed, tabs inside a tab set - and nothing is left on the page as
 *     raw ":::" text;
 *   - every link to another docs page, every #anchor and every image leads
 *     somewhere;
 *   - every code sample is closed, and in English declares its language.
 *
 * A failure names the language, the page and the line.
 */

const UNKNOWN_LANGUAGE_FENCES_ALLOWED: Array<string> = [];

const TITLE_LINE: RegExp = /^#\s+\S/;
const EXTERNAL_URL: RegExp = /^https?:\/\//;
const RELATIVE_OR_FILE_LINK: RegExp =
  /^(?:\.{1,2}\/|[a-z0-9-]+\/[a-z0-9-]+\.md\b)/i;
const MARKDOWN_FILE_LINK: RegExp = /\.md(?:#|$)/;
const ABSOLUTE_DOCS_LINK: RegExp =
  /^https?:\/\/(?:www\.)?oneuptime\.com\/docs\//;

const GENERIC_TITLES_ALLOWED: Array<string> = [];

describe("the nav and the files", () => {
  it("has an English page for every page the nav lists", () => {
    const missing: Array<string> = NAV_PAGES.filter((page: string): boolean => {
      return !hasPage("en", page);
    });

    expect(missing).toEqual([]);
  });

  it("lists every English page, so none is unreachable", () => {
    const listed: Set<string> = new Set(NAV_PAGES);
    const orphans: Array<string> = listPages("en").filter(
      (page: string): boolean => {
        return !listed.has(page);
      },
    );

    expect(orphans).toEqual([]);
  });

  it.each(
    DOCS_LANGUAGES.filter((lang: string): boolean => {
      return lang !== "en";
    }),
  )("has no %s page without an English one", (lang: string) => {
    const strays: Array<string> = listPages(lang).filter(
      (page: string): boolean => {
        return !hasPage("en", page);
      },
    );

    expect(strays).toEqual([]);
  });

  it("titles each English page as its nav link does, or close to it", () => {
    const mismatched: Array<string> = [];

    for (const group of DocsNav) {
      for (const link of group.links) {
        if (!link.url.startsWith("/docs/")) {
          continue;
        }
        const page: string = link.url.slice("/docs/".length);
        const firstLine: string = readPage("en", page).split("\n")[0] || "";
        const title: string = firstLine.replace(/^#\s+/, "").trim();

        if (!title || GENERIC_TITLES_ALLOWED.includes(page)) {
          continue;
        }

        /*
         * The nav's title is shown above the page; the file's first line is
         * what the raw Markdown and llms.txt show. They do not have to be
         * the same words, but they must be about the same thing: the page's
         * title has to share a word with its nav link or its group (a link
         * titled "Overview" is about its group).
         */
        const words: (text: string) => Set<string> = (
          text: string,
        ): Set<string> => {
          return new Set(
            text
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((word: string): boolean => {
                return word.length > 1 && word !== "the" && word !== "and";
              })
              .map((word: string): string => {
                return word.replace(/(?:es|s)$/, "");
              }),
          );
        };
        const navWords: Set<string> = new Set([
          ...words(link.title),
          ...words(group.title),
        ]);
        const shared: boolean = Array.from(words(title)).some(
          (word: string): boolean => {
            return navWords.has(word);
          },
        );

        if (!shared && navWords.size > 0) {
          mismatched.push(`${page}: nav "${link.title}" / page "${title}"`);
        }
      }
    }

    expect(mismatched).toEqual([]);
  });
});

describe.each(DOCS_LANGUAGES)("%s pages", (lang: string) => {
  const pages: Array<string> = listPages(lang);

  it("start with their title, and have only that one", () => {
    const problems: Array<string> = [];

    for (const page of pages) {
      const scanned: ScannedPage = scanPage(lang, page);
      const first: string = scanned.lines[0] || "";

      if (!TITLE_LINE.test(first)) {
        problems.push(`${page}:1 does not start with "# Title"`);
      }

      for (const heading of scanned.headings) {
        if (heading.level === 1 && heading.line !== 1) {
          problems.push(`${page}:${heading.line} has a second "# " title`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("write every component so the renderer reads it", () => {
    const problems: Array<string> = [];

    for (const page of pages) {
      for (const problem of scanPage(lang, page).containerProblems) {
        problems.push(
          `${page}:${(problem as DocsContainerProblem).line} ${problem.problem}`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it("close every code sample", () => {
    const unclosed: Array<string> = pages.filter((page: string): boolean => {
      return scanPage(lang, page).unclosedFence;
    });

    expect(unclosed).toEqual([]);
  });

  it("link only to pages that exist, and to anchors those pages have", () => {
    const broken: Array<string> = [];

    for (const page of pages) {
      for (const link of scanPage(lang, page).links) {
        const target: DocsPageLink | null = parseDocsLink(
          (link as DocsLink).target,
        );

        if (!target) {
          continue;
        }

        const where: string = `${page}:${link.line} -> ${link.target}`;

        if (!NAV_PAGES.includes(target.page)) {
          broken.push(`${where} (no such page)`);
          continue;
        }

        if (target.anchor === null || target.anchor === "") {
          continue;
        }

        /*
         * Anchors come from headings, and a translated heading has a
         * translated anchor: a link is checked against the copy of the
         * page the reader will land on - this language's, or English when
         * the page is not translated yet.
         */
        const landing: string = hasPage(lang, target.page) ? lang : "en";

        if (!anchorsOf(landing, target.page).has(target.anchor)) {
          broken.push(`${where} (no heading with that anchor in ${landing})`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it("link to anchors on the same page that exist", () => {
    const broken: Array<string> = [];

    for (const page of pages) {
      const anchors: Set<string> = anchorsOf(lang, page);

      for (const link of scanPage(lang, page).links) {
        if (!link.target.startsWith("#")) {
          continue;
        }
        const anchor: string = decodeURIComponent(link.target.slice(1));
        if (!anchors.has(anchor)) {
          broken.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it("show only images that exist", () => {
    const missing: Array<string> = [];

    for (const page of pages) {
      for (const link of scanPage(lang, page).links) {
        if (!link.isImage || EXTERNAL_URL.test(link.target)) {
          continue;
        }

        if (!link.target.startsWith("/docs/static/")) {
          missing.push(
            `${page}:${link.line} -> ${link.target} (images are served from /docs/static/images/)`,
          );
          continue;
        }

        const file: string = path.join(
          STATIC_DIR,
          link.target.slice("/docs/static/".length).split(/[?#]/)[0]!,
        );

        if (!fs.existsSync(file)) {
          missing.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("do not link to Markdown files or relative paths", () => {
    const wrong: Array<string> = [];

    for (const page of pages) {
      for (const link of scanPage(lang, page).links) {
        if (
          RELATIVE_OR_FILE_LINK.test(link.target) ||
          (MARKDOWN_FILE_LINK.test(link.target) &&
            !EXTERNAL_URL.test(link.target))
        ) {
          wrong.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it("render with every component drawn and nothing left as raw syntax", async () => {
    const leftovers: Array<string> = [];

    for (const page of pages) {
      const body: string = readPage(lang, page).split("\n").slice(1).join("\n");
      const html: string = await DocsRender.render(
        DocsPlaceholders.render(body, lang),
        { lang: lang, contentLang: lang },
      );

      const outsideCode: string = html.replace(
        /<pre>[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<div class="mermaid">[\s\S]*?<\/div>/g,
        "",
      );

      for (const [pattern, what] of [
        [/(?:^|>)\s*:::/m, "a raw ':::' line"],
        [/(?:^|>)\s*@tab\b/m, "a raw '@tab' line"],
        [
          /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER|INFO)\]/,
          "a raw '[!NOTE]' marker",
        ],
        [/\{\{[A-Z][A-Z0-9_]*\}\}/, "an unfilled {{PLACEHOLDER}}"],
      ] as Array<[RegExp, string]>) {
        if (pattern.test(outsideCode)) {
          leftovers.push(`${page}: ${what}`);
        }
      }
    }

    expect(leftovers).toEqual([]);
  });
});

describe("English pages", () => {
  const pages: Array<string> = listPages("en");

  it("declare the language of every code sample", () => {
    const bare: Array<string> = [];

    for (const page of pages) {
      if (UNKNOWN_LANGUAGE_FENCES_ALLOWED.includes(page)) {
        continue;
      }
      for (const fence of scanPage("en", page).fences) {
        if (!(fence as DocsFence).lang) {
          bare.push(`${page}:${fence.line}`);
        }
      }
    }

    expect(bare).toEqual([]);
  });

  it("never give two headings the same anchor", () => {
    const duplicates: Array<string> = [];

    for (const page of pages) {
      const seen: Map<string, number> = new Map();
      for (const heading of scanPage("en", page).headings) {
        const previous: number | undefined = seen.get(
          (heading as DocsHeading).slug,
        );
        if (previous !== undefined) {
          duplicates.push(
            `${page}:${heading.line} "${heading.text}" repeats the anchor of line ${previous}`,
          );
        } else {
          seen.set(heading.slug, heading.line);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("do not skip a heading level", () => {
    const skips: Array<string> = [];

    for (const page of pages) {
      let previous: number = 1;
      for (const heading of scanPage("en", page).headings) {
        if (heading.level > previous + 1) {
          skips.push(
            `${page}:${heading.line} "${heading.text}" is h${heading.level} under h${previous}`,
          );
        }
        previous = heading.level;
      }
    }

    expect(skips).toEqual([]);
  });

  it("link to the docs relatively, so links work on self-hosted installs", () => {
    const absolute: Array<string> = [];

    for (const page of pages) {
      for (const link of scanPage("en", page).links) {
        if (ABSOLUTE_DOCS_LINK.test(link.target)) {
          absolute.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(absolute).toEqual([]);
  });

  it("reach every nav group from the Getting Started page", () => {
    const linked: Set<string> = new Set(
      scanPage("en", "introduction/getting-started")
        .links.map((link: DocsLink): DocsPageLink | null => {
          return parseDocsLink(link.target);
        })
        .filter((target: DocsPageLink | null): boolean => {
          return target !== null;
        })
        .map((target: DocsPageLink | null): string => {
          return target!.page;
        }),
    );

    const unreached: Array<string> = DocsNav.filter(
      (group: NavGroup): boolean => {
        return !group.links.some((link: NavLink): boolean => {
          return linked.has(link.url.replace("/docs/", ""));
        });
      },
    ).map((group: NavGroup): string => {
      return group.title;
    });

    expect(unreached).toEqual([]);
  });
});
