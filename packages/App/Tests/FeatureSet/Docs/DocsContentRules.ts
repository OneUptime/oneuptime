import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DOCS_LANGUAGES,
  DocsContainerUse,
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  STATIC_DIR,
  ScannedPage,
  decodeAnchor,
  listPages,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import fs from "fs";
import path from "path";

/*
 * The rules every docs page is held to, in every language, and the ratchet
 * that lets the docs overhaul tighten them page by page.
 *
 * Each rule reads the docs through a DocsCorpus - the real Content/ folder in
 * the content suites (DOCS_CORPUS), pages written in the test in the unit
 * suite - and returns what fails, page by page, with the line and what is
 * wrong. DocsContentIntegrity and DocsTranslations run the rules on the real
 * docs and compare what fails with DOCS_KNOWN_FAILURES
 * (DocsKnownFailures.ts): the pages that failed a rule when the rules were
 * committed, before the overhaul rewrote them. That list only shrinks:
 *
 *   - a page that fails a rule and is not on the list fails the suite: fix
 *     the page (the list never grows);
 *   - a page on the list that passes the rule now fails the suite too:
 *     delete its entry, so it can never fail again unnoticed.
 */

// A page as "category/page", e.g. "monitor/website-monitor".
export type DocsPage = string;

export interface DocsCorpus {
  // Every docs language, English first.
  languages: Array<string>;
  // The sidebar: its groups and their links.
  nav: Array<NavGroup>;
  // Every page written in a language, sorted.
  listPages: (lang: string) => Array<DocsPage>;
  // A page's Markdown, its title on the first line.
  readPage: (lang: string, page: DocsPage) => string;
  // Whether a file is served from /docs/static/ ("images/x.png").
  staticFileExists: (file: string) => boolean;
  // A page's body - everything after the title line - as the docs serve it.
  renderBody: (body: string, lang: string) => Promise<string>;
}

// The docs as they are served: Content/, Utils/Nav.ts and Static/.
export const DOCS_CORPUS: DocsCorpus = {
  languages: DOCS_LANGUAGES,
  nav: DocsNav,
  listPages: listPages,
  readPage: readPage,
  staticFileExists: (file: string): boolean => {
    return fs.existsSync(path.join(STATIC_DIR, file));
  },
  renderBody: (body: string, lang: string): Promise<string> => {
    return DocsRender.render(DocsPlaceholders.render(body, lang), {
      lang: lang,
      contentLang: lang,
    });
  },
};

// A corpus read once: every page is scanned at most once, whatever reads it.
export class DocsReader {
  public readonly corpus: DocsCorpus;
  private navPagesCache: Array<DocsPage> | null = null;
  private readonly pageSets: Map<string, Set<DocsPage>> = new Map();
  private readonly scans: Map<string, ScannedPage> = new Map();

  public constructor(corpus: DocsCorpus) {
    this.corpus = corpus;
  }

  public get translatedLanguages(): Array<string> {
    return this.corpus.languages.filter((lang: string): boolean => {
      return lang !== "en";
    });
  }

  // Every page the nav serves, in nav order.
  public navPages(): Array<DocsPage> {
    if (!this.navPagesCache) {
      this.navPagesCache = this.corpus.nav.flatMap(
        (group: NavGroup): Array<DocsPage> => {
          return group.links
            .filter((link: NavLink): boolean => {
              return link.url.startsWith("/docs/");
            })
            .map((link: NavLink): DocsPage => {
              return link.url.slice("/docs/".length);
            });
        },
      );
    }
    return this.navPagesCache;
  }

  public pages(lang: string): Array<DocsPage> {
    return this.corpus.listPages(lang);
  }

  public hasPage(lang: string, page: DocsPage): boolean {
    let pages: Set<DocsPage> | undefined = this.pageSets.get(lang);
    if (!pages) {
      pages = new Set(this.corpus.listPages(lang));
      this.pageSets.set(lang, pages);
    }
    return pages.has(page);
  }

  public scan(lang: string, page: DocsPage): ScannedPage {
    const key: string = `${lang}/${page}`;
    let scanned: ScannedPage | undefined = this.scans.get(key);
    if (!scanned) {
      scanned = scanMarkdown(this.corpus.readPage(lang, page));
      this.scans.set(key, scanned);
    }
    return scanned;
  }

  // The anchors a page's headings produce.
  public anchors(lang: string, page: DocsPage): Set<string> {
    return new Set(
      this.scan(lang, page).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      }),
    );
  }
}

export interface DocsRuleFailure {
  page: DocsPage;
  lang: string;
  // The line it is on, when it is on one.
  line?: number | undefined;
  // What is wrong, for whoever fixes it.
  detail: string;
}

/*
 * Which languages a rule reads: every language, every translation, or
 * English alone (what only the English page decides: the nav, code
 * languages, heading order - a translation keeps English's shape).
 */
export type DocsRuleScope = "every-language" | "translations" | "english";

export type DocsRuleSuite = "content" | "translations";

export type DocsRuleId =
  | "navHasPages"
  | "pagesInNav"
  | "noStrayTranslations"
  | "titleMatchesNav"
  | "title"
  | "components"
  | "codeClosed"
  | "pageLinks"
  | "inPageAnchors"
  | "images"
  | "noRelativeLinks"
  | "rendered"
  | "uniqueHeadings"
  | "codeLanguage"
  | "headingLevels"
  | "relativeDocsLinks"
  | "gettingStartedReachesGroups"
  | "translated"
  | "sameShape";

export interface DocsContentRule {
  id: DocsRuleId;
  // What every page does, as the test says it.
  title: string;
  scope: DocsRuleScope;
  // The suite that runs it: DocsContentIntegrity or DocsTranslations.
  suite: DocsRuleSuite;
  check: (
    docs: DocsReader,
    lang: string,
  ) => Array<DocsRuleFailure> | Promise<Array<DocsRuleFailure>>;
}

// The languages a rule of this scope reads.
export const languagesOfScope: (
  docs: DocsReader,
  scope: DocsRuleScope,
) => Array<string> = (
  docs: DocsReader,
  scope: DocsRuleScope,
): Array<string> => {
  if (scope === "english") {
    return ["en"];
  }
  if (scope === "translations") {
    return docs.translatedLanguages;
  }
  return [...docs.corpus.languages];
};

const TITLE_LINE: RegExp = /^#\s+\S/;
const TITLE_MARKER: RegExp = /^#\s+/;
const EXTERNAL_URL: RegExp = /^https?:\/\//;
const RELATIVE_OR_FILE_LINK: RegExp =
  /^(?:\.{1,2}\/|[a-z0-9-]+\/[a-z0-9-]+\.md\b)/i;
const MARKDOWN_FILE_LINK: RegExp = /\.md(?:#|$)/;
const ABSOLUTE_DOCS_LINK: RegExp =
  /^https?:\/\/(?:www\.)?oneuptime\.com\/docs\//;
const QUERY_OR_HASH: RegExp = /[?#]/;
const NOT_A_WORD: RegExp = /[^a-z0-9]+/;
const PLURAL_ENDING: RegExp = /(?:es|s)$/;
// Code samples, inline code and diagrams: raw syntax inside them is content.
const RENDERED_CODE: RegExp =
  /<pre>[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<div class="mermaid">[\s\S]*?<\/div>/g;
const RAW_SYNTAX: Array<[RegExp, string]> = [
  [/(?:^|>)\s*:::/m, "a raw ':::' line"],
  [/(?:^|>)\s*@tab\b/m, "a raw '@tab' line"],
  [
    /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER|INFO)\]/,
    "a raw '[!NOTE]' marker",
  ],
  [/\{\{[A-Z][A-Z0-9_]*\}\}/, "an unfilled {{PLACEHOLDER}}"],
];

const GETTING_STARTED: DocsPage = "introduction/getting-started";

// The words of a title that say what it is about: "Monitors" -> "monitor".
const titleWords: (text: string) => Set<string> = (
  text: string,
): Set<string> => {
  return new Set(
    text
      .toLowerCase()
      .split(NOT_A_WORD)
      .filter((word: string): boolean => {
        return word.length > 1 && word !== "the" && word !== "and";
      })
      .map((word: string): string => {
        return word.replace(PLURAL_ENDING, "");
      }),
  );
};

/*
 * What a translation shares with its English page: its sections, code,
 * components, callouts, placeholders, the pages it links to and its images.
 */
export interface DocsPageShape {
  headings: Array<number>;
  fences: Array<string>;
  components: Array<string>;
  alerts: Array<string>;
  placeholders: Array<string>;
  pageLinks: Array<string>;
  images: Array<string>;
}

export const shapeOf: (scanned: ScannedPage) => DocsPageShape = (
  scanned: ScannedPage,
): DocsPageShape => {
  return {
    headings: scanned.headings.map((heading: DocsHeading): number => {
      return heading.level;
    }),
    fences: scanned.fences.map((fence: DocsFence): string => {
      return fence.lang || "(none)";
    }),
    components: scanned.containers.map((use: DocsContainerUse): string => {
      if (use.name === "tabs") {
        return `tabs(${use.tabs.length})`;
      }
      if (use.name === "steps") {
        return `steps(${use.steps})`;
      }
      return use.name;
    }),
    alerts: scanned.alerts,
    placeholders: Array.from(new Set(scanned.placeholders)).sort(),
    pageLinks: Array.from(
      new Set(
        scanned.links
          .map((link: DocsLink): DocsPageLink | null => {
            return link.isImage ? null : parseDocsLink(link.target);
          })
          .filter((target: DocsPageLink | null): target is DocsPageLink => {
            return target !== null;
          })
          .map((target: DocsPageLink): string => {
            return target.page;
          }),
      ),
    ).sort(),
    images: scanned.links
      .filter((link: DocsLink): boolean => {
        return link.isImage;
      })
      .map((link: DocsLink): string => {
        return link.target;
      }),
  };
};

// A link from a page into a docs page, and the page and anchor it names.
interface DocsLinkToPage {
  link: DocsLink;
  target: DocsPageLink;
}

const docsLinksOf: (scanned: ScannedPage) => Array<DocsLinkToPage> = (
  scanned: ScannedPage,
): Array<DocsLinkToPage> => {
  const found: Array<DocsLinkToPage> = [];
  for (const link of scanned.links) {
    const target: DocsPageLink | null = parseDocsLink(link.target);
    if (target) {
      found.push({ link: link, target: target });
    }
  }
  return found;
};

export const DOCS_CONTENT_RULES: Array<DocsContentRule> = [
  {
    id: "navHasPages",
    title: "has an English page for every page the nav lists",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      return docs
        .navPages()
        .filter((page: DocsPage): boolean => {
          return !docs.hasPage("en", page);
        })
        .map((page: DocsPage): DocsRuleFailure => {
          return {
            page: page,
            lang: "en",
            detail: `the nav links to /docs/${page}, and there is no Content/en/${page}.md`,
          };
        });
    },
  },
  {
    id: "pagesInNav",
    title: "lists every English page, so none is unreachable",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      const listed: Set<DocsPage> = new Set(docs.navPages());
      return docs
        .pages("en")
        .filter((page: DocsPage): boolean => {
          return !listed.has(page);
        })
        .map((page: DocsPage): DocsRuleFailure => {
          return {
            page: page,
            lang: "en",
            detail: `is not in Utils/Nav.ts, so /docs/${page} is a 404`,
          };
        });
    },
  },
  {
    id: "noStrayTranslations",
    title: "has no page without an English one",
    scope: "translations",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      return docs
        .pages(lang)
        .filter((page: DocsPage): boolean => {
          return !docs.hasPage("en", page);
        })
        .map((page: DocsPage): DocsRuleFailure => {
          return {
            page: page,
            lang: lang,
            detail: `has no English page, so it is never served`,
          };
        });
    },
  },
  {
    id: "titleMatchesNav",
    title: "titles each English page as its nav link does, or close to it",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const group of docs.corpus.nav) {
        for (const link of group.links) {
          if (!link.url.startsWith("/docs/")) {
            continue;
          }
          const page: DocsPage = link.url.slice("/docs/".length);
          if (!docs.hasPage("en", page)) {
            continue;
          }
          const firstLine: string = docs.scan("en", page).lines[0] || "";
          // A page without a title line fails "title"; there is nothing to compare.
          if (!TITLE_LINE.test(firstLine)) {
            continue;
          }
          const title: string = firstLine.replace(TITLE_MARKER, "").trim();

          /*
           * The nav's title is shown above the page; the file's first line
           * is what the raw Markdown and llms.txt show. They do not have to
           * be the same words, but they must be about the same thing: the
           * page's title shares a word with its nav link or its group (a
           * link titled "Overview" is about its group).
           */
          const navWords: Set<string> = new Set([
            ...titleWords(link.title),
            ...titleWords(group.title),
          ]);
          const shared: boolean = Array.from(titleWords(title)).some(
            (word: string): boolean => {
              return navWords.has(word);
            },
          );

          if (!shared && navWords.size > 0) {
            failures.push({
              page: page,
              lang: "en",
              line: 1,
              detail: `is titled "${title}", and its nav link "${link.title}" (in ${group.title})`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "title",
    title: "start with their title, and have only that one",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        const scanned: ScannedPage = docs.scan(lang, page);

        if (!TITLE_LINE.test(scanned.lines[0] || "")) {
          failures.push({
            page: page,
            lang: lang,
            line: 1,
            detail: `does not start with "# Title"`,
          });
        }

        for (const heading of scanned.headings) {
          if (heading.level === 1 && heading.line !== 1) {
            failures.push({
              page: page,
              lang: lang,
              line: heading.line,
              detail: `has a second "# " title`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "components",
    title: "write every component so the renderer reads it",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      return docs
        .pages(lang)
        .flatMap((page: DocsPage): Array<DocsRuleFailure> => {
          return docs
            .scan(lang, page)
            .containerProblems.map(
              (problem: { line: number; problem: string }): DocsRuleFailure => {
                return {
                  page: page,
                  lang: lang,
                  line: problem.line,
                  detail: problem.problem,
                };
              },
            );
        });
    },
  },
  {
    id: "codeClosed",
    title: "close every code sample",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      return docs
        .pages(lang)
        .filter((page: DocsPage): boolean => {
          return docs.scan(lang, page).unclosedFence;
        })
        .map((page: DocsPage): DocsRuleFailure => {
          return {
            page: page,
            lang: lang,
            detail:
              "opens a code sample it never closes, so the rest of the page is shown as code",
          };
        });
    },
  },
  {
    id: "pageLinks",
    title: "link only to pages that exist, and to anchors those pages have",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const navPages: Set<DocsPage> = new Set(docs.navPages());
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        for (const { link, target } of docsLinksOf(docs.scan(lang, page))) {
          if (!navPages.has(target.page)) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (no such page)`,
            });
            continue;
          }

          if (target.anchor === null || target.anchor === "") {
            continue;
          }

          /*
           * Anchors come from headings, and a translated heading has a
           * translated anchor: a link is checked against the copy of the
           * page the reader lands on - this language's, or English when the
           * page is not translated yet.
           */
          const landing: string = docs.hasPage(lang, target.page) ? lang : "en";

          if (
            docs.hasPage(landing, target.page) &&
            !docs.anchors(landing, target.page).has(target.anchor)
          ) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (the ${landing} page has no heading with that anchor)`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "inPageAnchors",
    title: "link to anchors on the same page that exist",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        const anchors: Set<string> = docs.anchors(lang, page);

        for (const link of docs.scan(lang, page).links) {
          if (
            link.target.startsWith("#") &&
            !anchors.has(decodeAnchor(link.target.slice(1)))
          ) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (no heading on this page has that anchor)`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "images",
    title: "show only images that exist",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        for (const link of docs.scan(lang, page).links) {
          if (!link.isImage || EXTERNAL_URL.test(link.target)) {
            continue;
          }

          if (!link.target.startsWith("/docs/static/")) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (images are served from /docs/static/images/)`,
            });
            continue;
          }

          const file: string =
            link.target.slice("/docs/static/".length).split(QUERY_OR_HASH)[0] ||
            "";

          if (!docs.corpus.staticFileExists(file)) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (no such file in Static/)`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "noRelativeLinks",
    title: "do not link to Markdown files or relative paths",
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        for (const link of docs.scan(lang, page).links) {
          if (
            RELATIVE_OR_FILE_LINK.test(link.target) ||
            (MARKDOWN_FILE_LINK.test(link.target) &&
              !EXTERNAL_URL.test(link.target))
          ) {
            failures.push({
              page: page,
              lang: lang,
              line: link.line,
              detail: `-> ${link.target} (link as /docs/<category>/<page>)`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "rendered",
    title: "render with every component drawn and nothing left as raw syntax",
    scope: "every-language",
    suite: "content",
    check: async (
      docs: DocsReader,
      lang: string,
    ): Promise<Array<DocsRuleFailure>> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        const body: string = docs.scan(lang, page).lines.slice(1).join("\n");
        const html: string = await docs.corpus.renderBody(body, lang);
        const outsideCode: string = html.replace(RENDERED_CODE, "");

        for (const [pattern, what] of RAW_SYNTAX) {
          if (pattern.test(outsideCode)) {
            failures.push({
              page: page,
              lang: lang,
              detail: `shows ${what} to the reader`,
            });
          }
        }
      }

      return failures;
    },
  },
  {
    id: "uniqueHeadings",
    title: "never give two headings the same anchor",
    // A translated heading has a translated anchor: each language is read on its own.
    scope: "every-language",
    suite: "content",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages(lang)) {
        const seen: Map<string, number> = new Map();

        for (const heading of docs.scan(lang, page).headings) {
          /*
           * The title on the first line is not part of the page's body: the
           * docs show the nav link's title above the page instead, with no
           * anchor. A section may share its words.
           */
          if (heading.line === 1) {
            continue;
          }
          const previous: number | undefined = seen.get(heading.slug);
          if (previous !== undefined) {
            failures.push({
              page: page,
              lang: lang,
              line: heading.line,
              detail: `"${heading.text}" has the anchor #${heading.slug} of line ${previous}, so links to it land on line ${previous}`,
            });
          } else {
            seen.set(heading.slug, heading.line);
          }
        }
      }

      return failures;
    },
  },
  {
    id: "codeLanguage",
    title: "declare the language of every code sample",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      return docs
        .pages("en")
        .flatMap((page: DocsPage): Array<DocsRuleFailure> => {
          return docs
            .scan("en", page)
            .fences.filter((fence: DocsFence): boolean => {
              return !fence.lang;
            })
            .map((fence: DocsFence): DocsRuleFailure => {
              return {
                page: page,
                lang: "en",
                line: fence.line,
                detail:
                  "opens a code sample without a language (```bash, ```yaml, ```text...)",
              };
            });
        });
    },
  },
  {
    id: "headingLevels",
    title: "do not skip a heading level",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages("en")) {
        // The body starts under the page's title, which the docs show as an h1.
        let previous: number = 1;
        for (const heading of docs.scan("en", page).headings) {
          if (heading.line === 1) {
            continue;
          }
          if (heading.level > previous + 1) {
            failures.push({
              page: page,
              lang: "en",
              line: heading.line,
              detail: `"${heading.text}" is an h${heading.level} under an h${previous}`,
            });
          }
          previous = heading.level;
        }
      }

      return failures;
    },
  },
  {
    id: "relativeDocsLinks",
    title: "link to the docs relatively, so links work on self-hosted installs",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      return docs
        .pages("en")
        .flatMap((page: DocsPage): Array<DocsRuleFailure> => {
          return docs
            .scan("en", page)
            .links.filter((link: DocsLink): boolean => {
              return ABSOLUTE_DOCS_LINK.test(link.target);
            })
            .map((link: DocsLink): DocsRuleFailure => {
              return {
                page: page,
                lang: "en",
                line: link.line,
                detail: `-> ${link.target} (link as /docs/<category>/<page>)`,
              };
            });
        });
    },
  },
  {
    id: "gettingStartedReachesGroups",
    title: "reach every nav group from the Getting Started page",
    scope: "english",
    suite: "content",
    check: (docs: DocsReader): Array<DocsRuleFailure> => {
      if (!docs.hasPage("en", GETTING_STARTED)) {
        return [];
      }

      const linked: Set<DocsPage> = new Set(
        docsLinksOf(docs.scan("en", GETTING_STARTED)).map(
          (found: DocsLinkToPage): DocsPage => {
            return found.target.page;
          },
        ),
      );

      return docs.corpus.nav
        .filter((group: NavGroup): boolean => {
          return !group.links.some((link: NavLink): boolean => {
            return linked.has(link.url.slice("/docs/".length));
          });
        })
        .map((group: NavGroup): DocsRuleFailure => {
          return {
            page: GETTING_STARTED,
            lang: "en",
            detail: `links to no page of the nav group "${group.title}"`,
          };
        });
    },
  },
  {
    id: "translated",
    title: "have every page the English docs have",
    scope: "translations",
    suite: "translations",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      return docs
        .pages("en")
        .filter((page: DocsPage): boolean => {
          return !docs.hasPage(lang, page);
        })
        .map((page: DocsPage): DocsRuleFailure => {
          return {
            page: page,
            lang: lang,
            detail: `has no ${lang} translation, so it is served in English`,
          };
        });
    },
  },
  {
    id: "sameShape",
    title:
      "keep each page's shape: sections, code, components, callouts, links and images",
    scope: "translations",
    suite: "translations",
    check: (docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
      const failures: Array<DocsRuleFailure> = [];

      for (const page of docs.pages("en")) {
        if (!docs.hasPage(lang, page)) {
          continue;
        }

        const english: DocsPageShape = shapeOf(docs.scan("en", page));
        const translated: DocsPageShape = shapeOf(docs.scan(lang, page));

        for (const key of Object.keys(english) as Array<keyof DocsPageShape>) {
          const theirs: string = JSON.stringify(english[key]);
          const ours: string = JSON.stringify(translated[key]);

          if (theirs !== ours) {
            failures.push({
              page: page,
              lang: lang,
              detail: `${key}: English ${theirs}, ${lang} ${ours}`,
            });
          }
        }
      }

      return failures;
    },
  },
];

export const ruleById: (id: DocsRuleId) => DocsContentRule = (
  id: DocsRuleId,
): DocsContentRule => {
  const rule: DocsContentRule | undefined = DOCS_CONTENT_RULES.find(
    (candidate: DocsContentRule): boolean => {
      return candidate.id === id;
    },
  );
  if (!rule) {
    throw new Error(`No docs content rule "${id}"`);
  }
  return rule;
};

/*
 * The pages that failed each rule when the rules were committed, and the
 * languages they failed it in: page -> rule -> languages.
 */
export type DocsKnownFailures = Record<
  DocsPage,
  Partial<Record<DocsRuleId, Array<string>>>
>;

export interface DocsRatchetReport {
  // Fails the rule and is not a known failure: fix the page.
  newFailures: Array<string>;
  // A known failure that passes now: delete it from the list.
  nowPassing: Array<string>;
}

// The pages the list says fail a rule in a language.
export const knownFailingPages: (
  known: DocsKnownFailures,
  ruleId: DocsRuleId,
  lang: string,
) => Set<DocsPage> = (
  known: DocsKnownFailures,
  ruleId: DocsRuleId,
  lang: string,
): Set<DocsPage> => {
  const pages: Set<DocsPage> = new Set();
  for (const [page, rules] of Object.entries(known)) {
    if ((rules[ruleId] || []).includes(lang)) {
      pages.add(page);
    }
  }
  return pages;
};

export const formatFailure: (failure: DocsRuleFailure) => string = (
  failure: DocsRuleFailure,
): string => {
  const where: string =
    failure.line === undefined
      ? failure.page
      : `${failure.page}:${failure.line}`;
  return `${where} ${failure.detail}`;
};

/*
 * A rule's failures in one language, against the list: what fails and is
 * not on it, and what is on it and passes now. Both must be empty.
 */
export const compareWithKnownFailures: (
  rule: DocsContentRule,
  lang: string,
  failures: Array<DocsRuleFailure>,
  known: DocsKnownFailures,
) => DocsRatchetReport = (
  rule: DocsContentRule,
  lang: string,
  failures: Array<DocsRuleFailure>,
  known: DocsKnownFailures,
): DocsRatchetReport => {
  const listed: Set<DocsPage> = knownFailingPages(known, rule.id, lang);
  const failing: Set<DocsPage> = new Set(
    failures.map((failure: DocsRuleFailure): DocsPage => {
      return failure.page;
    }),
  );

  const newFailures: Array<string> = failures
    .filter((failure: DocsRuleFailure): boolean => {
      return !listed.has(failure.page);
    })
    .map(formatFailure);

  const nowPassing: Array<string> = Array.from(listed)
    .filter((page: DocsPage): boolean => {
      return !failing.has(page);
    })
    .sort()
    .map((page: DocsPage): string => {
      return rule.scope === "english"
        ? `${page} passes "${rule.id}" now: delete "${rule.id}" from its entry in DocsKnownFailures.ts`
        : `${page} passes "${rule.id}" in ${lang} now: delete "${lang}" from its "${rule.id}" languages in DocsKnownFailures.ts`;
    });

  return { newFailures: newFailures, nowPassing: nowPassing };
};

/*
 * Runs a rule in one language and compares it with the list: the report the
 * content suites expect to be empty.
 */
export const checkRule: (
  docs: DocsReader,
  rule: DocsContentRule,
  lang: string,
  known: DocsKnownFailures,
) => Promise<DocsRatchetReport> = async (
  docs: DocsReader,
  rule: DocsContentRule,
  lang: string,
  known: DocsKnownFailures,
): Promise<DocsRatchetReport> => {
  return compareWithKnownFailures(
    rule,
    lang,
    await rule.check(docs, lang),
    known,
  );
};

export const NOTHING_CHANGED: DocsRatchetReport = {
  newFailures: [],
  nowPassing: [],
};
