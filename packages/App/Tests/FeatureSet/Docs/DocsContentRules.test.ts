import { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DOCS_CONTENT_RULES,
  DOCS_CORPUS,
  DocsContentRule,
  DocsCorpus,
  DocsKnownFailures,
  DocsReader,
  DocsRuleFailure,
  DocsRuleId,
  DocsRuleScope,
  NOTHING_CHANGED,
  checkRule,
  compareWithKnownFailures,
  formatFailure,
  knownFailingPages,
  languagesOfScope,
  ruleById,
  shapeOf,
} from "./DocsContentRules";
import {
  DOCS_LANGUAGES,
  DocsPageLink,
  TRANSLATED_LANGUAGES,
  decodeAnchor,
  parseDocsLink,
  scanMarkdown,
} from "./DocsContentSupport";
import { DOCS_KNOWN_FAILURES } from "./DocsKnownFailures";
import { describe, expect, it } from "@jest/globals";

/*
 * The content rules and their ratchet, proven on pages written here: each
 * rule reports what it is for - with the page, the line and what is wrong -
 * and nothing a correct page does. The ratchet fails on a page that breaks a
 * rule and is not a known failure, and on a known failure that passes now.
 * The known-failures list itself names only real rules and the languages
 * each rule reads, in an order a reader can scan. And the anchors this task
 * localized land on headings of the rendered translated pages.
 */

type Pages = Record<string, Record<string, string>>;

interface FakeDocs {
  pages: Pages;
  nav?: Array<NavGroup>;
  staticFiles?: Array<string>;
}

const FAKE_LANGUAGES: Array<string> = ["en", "de", "ja"];
const FIRST_TITLE: RegExp = /^#\s+(.+)$/;

// Lines of Markdown, as a page.
const md: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// One nav group per category, one link per English page, titled as the page.
const navOf: (pages: Pages) => Array<NavGroup> = (
  pages: Pages,
): Array<NavGroup> => {
  const groups: Map<string, NavGroup> = new Map();
  for (const [page, markdown] of Object.entries(pages["en"] || {})) {
    const category: string = page.split("/")[0]!;
    let group: NavGroup | undefined = groups.get(category);
    if (!group) {
      group = { title: category, section: "Get Started", links: [] };
      groups.set(category, group);
    }
    const title: RegExpMatchArray | null = (
      markdown.split("\n")[0] || ""
    ).match(FIRST_TITLE);
    group.links.push({
      title: title ? title[1]! : page,
      url: `/docs/${page}`,
    });
  }
  return Array.from(groups.values());
};

const docsOf: (fake: FakeDocs) => DocsReader = (fake: FakeDocs): DocsReader => {
  const corpus: DocsCorpus = {
    languages: FAKE_LANGUAGES,
    nav: fake.nav || navOf(fake.pages),
    listPages: (lang: string): Array<string> => {
      return Object.keys(fake.pages[lang] || {}).sort();
    },
    readPage: (lang: string, page: string): string => {
      const markdown: string | undefined = fake.pages[lang]?.[page];
      if (markdown === undefined) {
        throw new Error(`no page ${lang}/${page}`);
      }
      return markdown;
    },
    staticFileExists: (file: string): boolean => {
      return (fake.staticFiles || []).includes(file);
    },
    renderBody: DOCS_CORPUS.renderBody,
  };
  return new DocsReader(corpus);
};

// What a rule reports in a language, as the suites print it.
const failuresOf: (
  id: DocsRuleId,
  fake: FakeDocs,
  lang?: string,
) => Promise<Array<string>> = async (
  id: DocsRuleId,
  fake: FakeDocs,
  lang: string = "en",
): Promise<Array<string>> => {
  return (await ruleById(id).check(docsOf(fake), lang)).map(formatFailure);
};

// A page that keeps every rule.
const GOOD_PAGE: string = md(
  "# Website Monitor",
  "",
  "Checks a website.",
  "",
  "## Create a monitor",
  "",
  ":::steps",
  "### Open Monitors",
  "Go to **Monitors**.",
  "",
  "### Pick Website",
  "Choose **Website**.",
  ":::",
  "",
  ":::tabs",
  "@tab Docker Compose",
  "```bash",
  "docker compose up -d",
  "```",
  "@tab Kubernetes",
  "```bash",
  "helm install oneuptime oneuptime/oneuptime",
  "```",
  ":::",
  "",
  "> [!NOTE]",
  "> A note.",
  "",
  "See [Create a monitor](#create-a-monitor) and the [overview](/docs/monitor/index#what-it-checks).",
  "",
  "![Monitors](/docs/static/images/monitors.png)",
);

const MONITOR_INDEX: string = md(
  "# Monitors",
  "",
  "## What it checks",
  "",
  "Every check.",
);

describe("the rules, on pages written here", () => {
  it("pass a page that keeps every rule, in every language it reads", async () => {
    const fake: FakeDocs = {
      pages: {
        en: {
          "monitor/website-monitor": GOOD_PAGE,
          "monitor/index": MONITOR_INDEX,
          "introduction/getting-started": md(
            "# Getting Started",
            "",
            "## Where to go",
            "",
            "[Monitors](/docs/monitor/index), [this page](/docs/introduction/getting-started).",
          ),
        },
        de: {
          "monitor/website-monitor": GOOD_PAGE,
          "monitor/index": MONITOR_INDEX,
          "introduction/getting-started": md(
            "# Erste Schritte",
            "",
            "## Wohin",
            "",
            "[Monitore](/docs/monitor/index), [diese Seite](/docs/introduction/getting-started).",
          ),
        },
        ja: {
          "monitor/website-monitor": GOOD_PAGE,
          "monitor/index": MONITOR_INDEX,
          "introduction/getting-started": md(
            "# はじめに",
            "",
            "## 次に読む",
            "",
            "[モニター](/docs/monitor/index)、[このページ](/docs/introduction/getting-started)。",
          ),
        },
      },
      staticFiles: ["images/monitors.png"],
    };
    const docs: DocsReader = docsOf(fake);
    const reported: Array<string> = [];

    for (const rule of DOCS_CONTENT_RULES) {
      for (const lang of languagesOfScope(docs, rule.scope)) {
        for (const failure of await rule.check(docs, lang)) {
          reported.push(`${rule.id} ${lang} ${formatFailure(failure)}`);
        }
      }
    }

    expect(reported).toEqual([]);
  });

  describe("navHasPages", () => {
    it("reports a nav link to a page with no English file", async () => {
      expect(
        await failuresOf("navHasPages", {
          pages: { en: { "monitor/index": MONITOR_INDEX } },
          nav: [
            {
              title: "Monitor",
              section: "Monitoring",
              links: [
                { title: "Monitors", url: "/docs/monitor/index" },
                { title: "Ghost", url: "/docs/monitor/ghost" },
                // Not a docs page: never read as one.
                { title: "Status", url: "https://status.oneuptime.com" },
              ],
            },
          ],
        }),
      ).toEqual([
        "monitor/ghost the nav links to /docs/monitor/ghost, and there is no Content/en/monitor/ghost.md",
      ]);
    });
  });

  describe("pagesInNav", () => {
    it("reports an English page the nav does not list", async () => {
      expect(
        await failuresOf("pagesInNav", {
          pages: {
            en: {
              "monitor/index": MONITOR_INDEX,
              "monitor/orphan": md("# Orphan"),
            },
          },
          nav: [
            {
              title: "Monitor",
              section: "Monitoring",
              links: [{ title: "Monitors", url: "/docs/monitor/index" }],
            },
          ],
        }),
      ).toEqual([
        "monitor/orphan is not in Utils/Nav.ts, so /docs/monitor/orphan is a 404",
      ]);
    });
  });

  describe("noStrayTranslations", () => {
    it("reports a translated page with no English page, in its language", async () => {
      const fake: FakeDocs = {
        pages: {
          en: { "monitor/index": MONITOR_INDEX },
          de: {
            "monitor/index": MONITOR_INDEX,
            "monitor/stray": md("# Verirrt"),
          },
        },
      };

      expect(await failuresOf("noStrayTranslations", fake, "de")).toEqual([
        "monitor/stray has no English page, so it is never served",
      ]);
      expect(await failuresOf("noStrayTranslations", fake, "ja")).toEqual([]);
    });
  });

  describe("titleMatchesNav", () => {
    const navFor: (linkTitle: string, groupTitle: string) => Array<NavGroup> = (
      linkTitle: string,
      groupTitle: string,
    ): Array<NavGroup> => {
      return [
        {
          title: groupTitle,
          section: "Monitoring",
          links: [{ title: linkTitle, url: "/docs/monitor/website-monitor" }],
        },
      ];
    };

    it.each([
      ["Websites", "Website Monitor", "Monitor"],
      ["Website Monitors", "Websites", "Monitors"],
      ["On-Call Policies", "Escalation Policy", "On Call"],
      ["Statuses", "Status", "Incidents"],
      ["Status Pages", "Page", "Status Pages"],
    ])(
      'passes "%s" under the nav link "%s" (%s): they share a word, singular or plural',
      async (title: string, linkTitle: string, groupTitle: string) => {
        expect(
          await failuresOf("titleMatchesNav", {
            pages: { en: { "monitor/website-monitor": md("# " + title) } },
            nav: navFor(linkTitle, groupTitle),
          }),
        ).toEqual([]);
      },
    );

    it("passes a title that shares a word with the link's group (an 'Overview' link)", async () => {
      expect(
        await failuresOf("titleMatchesNav", {
          pages: { en: { "monitor/website-monitor": md("# Status Pages") } },
          nav: navFor("Overview", "Status Pages"),
        }),
      ).toEqual([]);
    });

    it("reports a title about something else, on line 1", async () => {
      expect(
        await failuresOf("titleMatchesNav", {
          pages: { en: { "monitor/website-monitor": md("# Billing") } },
          nav: navFor("Website Monitor", "Monitor"),
        }),
      ).toEqual([
        'monitor/website-monitor:1 is titled "Billing", and its nav link "Website Monitor" (in Monitor)',
      ]);
    });

    it("leaves a page without a title line to the title rule", async () => {
      const fake: FakeDocs = {
        pages: { en: { "monitor/website-monitor": md("### Billing") } },
        nav: navFor("Website Monitor", "Monitor"),
      };

      expect(await failuresOf("titleMatchesNav", fake)).toEqual([]);
      expect(await failuresOf("title", fake)).toEqual([
        'monitor/website-monitor:1 does not start with "# Title"',
      ]);
    });
  });

  describe("title", () => {
    it("reports a page whose first line is not '# Title', in any language", async () => {
      const fake: FakeDocs = {
        pages: {
          en: { "a/one": md("## Not a title", "", "Text.") },
          de: { "a/one": md("", "# Titel") },
        },
      };

      expect(await failuresOf("title", fake)).toEqual([
        'a/one:1 does not start with "# Title"',
      ]);
      // Line 1 is stripped from the page, so line 2's title shows in the body: a second h1.
      expect(await failuresOf("title", fake, "de")).toEqual([
        'a/one:1 does not start with "# Title"',
        'a/one:2 has a second "# " title',
      ]);
    });

    it("reports a second '# ' heading, but not a '#' line inside code", async () => {
      expect(
        await failuresOf("title", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                "",
                "```bash",
                "# a shell comment",
                "```",
                "",
                "# Another title",
              ),
            },
          },
        }),
      ).toEqual(['a/one:7 has a second "# " title']);
    });
  });

  describe("components", () => {
    it("reports unknown, unclosed, stray and indented components, with their lines", async () => {
      expect(
        await failuresOf("components", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                ":::stepz",
                "text",
                ":::",
                ":::",
                "@tab Lost",
                ":::tabs",
                "@tab Only one",
                ":::",
                "    :::note",
                ":::",
                ":::details Never closed",
              ),
            },
          },
        }),
      ).toEqual([
        'a/one:2 ":::stepz" is not a component (known: steps, tabs, cards, details, note, tip, info, important, warning, caution, danger)',
        'a/one:5 ":::" closes nothing',
        'a/one:6 "@tab Lost" is not directly inside a :::tabs',
        'a/one:10 ":::note" is indented 4 spaces; components are only read at the start of a line (up to 3 spaces)',
        'a/one:12 ":::details" is never closed',
        'a/one:7 ":::tabs" has 1 tab(s); a tab set needs at least two',
      ]);
    });

    it("ignores ':::' and '@tab' inside a code sample", async () => {
      expect(
        await failuresOf("components", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                "````markdown",
                ":::tabs",
                "@tab One",
                "```bash",
                "ls",
                "```",
                "````",
              ),
            },
          },
        }),
      ).toEqual([]);
    });
  });

  describe("codeClosed", () => {
    it("reports a code sample that is never closed", async () => {
      expect(
        await failuresOf("codeClosed", {
          pages: {
            en: {
              "a/one": md("# One", "```bash", "ls"),
              "a/two": md(
                "# Two",
                "````markdown",
                "```bash",
                "ls",
                "```",
                "````",
              ),
            },
          },
        }),
      ).toEqual([
        "a/one opens a code sample it never closes, so the rest of the page is shown as code",
      ]);
    });
  });

  describe("pageLinks", () => {
    const fake: FakeDocs = {
      pages: {
        en: {
          "a/one": md("# One", "", "## Setup"),
          "a/two": md(
            "# Two",
            "",
            "[setup](/docs/a/one#setup), [missing](/docs/a/one#teardown), [nowhere](/docs/a/none).",
            "`[in code](/docs/a/none)` is not a link.",
            "[def]: /docs/a/one#gone",
          ),
          "a/three": md("# Three", "", "## Setup"),
        },
        de: {
          "a/one": md("# Eins", "", "## Einrichtung"),
          "a/two": md(
            "# Zwei",
            "",
            "[alt](/docs/a/one#setup), [neu](/docs/a/one#einrichtung), [englisch](/docs/a/three#setup).",
          ),
        },
      },
    };

    it("reports links to pages the nav does not list, and anchors their pages lack", async () => {
      expect(await failuresOf("pageLinks", fake)).toEqual([
        "a/two:3 -> /docs/a/one#teardown (the en page has no heading with that anchor)",
        "a/two:3 -> /docs/a/none (no such page)",
        "a/two:5 -> /docs/a/one#gone (the en page has no heading with that anchor)",
      ]);
    });

    it("checks a translation's link against the copy the reader lands on", async () => {
      /*
       * de has its own copy of a/one, with a translated anchor; a/three is
       * not translated, so the reader lands on English, with its anchor.
       */
      expect(await failuresOf("pageLinks", fake, "de")).toEqual([
        "a/two:3 -> /docs/a/one#setup (the de page has no heading with that anchor)",
      ]);
    });

    it("reports a link to a page's title: line 1 is shown from the nav, with no anchor", async () => {
      expect(
        await failuresOf("pageLinks", {
          pages: {
            en: {
              "a/one": md("# Monitors", "", "## Setup"),
              "a/two": md("# Two", "", "[title](/docs/a/one#monitors)"),
            },
          },
        }),
      ).toEqual([
        "a/two:3 -> /docs/a/one#monitors (the en page has no heading with that anchor)",
      ]);
    });
  });

  describe("inPageAnchors", () => {
    it("reports a link to the page's own title, which has no anchor", async () => {
      expect(
        await failuresOf("inPageAnchors", {
          pages: {
            en: { "a/one": md("# Monitors", "", "[top](#monitors)") },
          },
        }),
      ).toEqual([
        "a/one:3 -> #monitors (no heading on this page has that anchor)",
      ]);
    });

    it("reports an #anchor no heading of the page has, encoded or not", async () => {
      expect(
        await failuresOf(
          "inPageAnchors",
          {
            pages: {
              en: { "a/one": md("# One") },
              ja: {
                "a/one": md(
                  "# 一",
                  "",
                  "## 設定",
                  "",
                  "[設定](#設定) [encoded](#%E8%A8%AD%E5%AE%9A) [missing](#teardown) [malformed](#100%)",
                ),
              },
            },
          },
          "ja",
        ),
      ).toEqual([
        "a/one:5 -> #teardown (no heading on this page has that anchor)",
        "a/one:5 -> #100% (no heading on this page has that anchor)",
      ]);
    });
  });

  describe("images", () => {
    it("reports images that are missing or not served from /docs/static/", async () => {
      expect(
        await failuresOf("images", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                "![ok](/docs/static/images/ok.png)",
                "![ok too](/docs/static/images/ok.png?v=2)",
                "![gone](/docs/static/images/gone.png)",
                "![relative](images/ok.png)",
                "![external](https://example.com/x.png)",
                "[not an image](/docs/static/images/gone.png)",
              ),
            },
          },
          staticFiles: ["images/ok.png"],
        }),
      ).toEqual([
        "a/one:4 -> /docs/static/images/gone.png (no such file in Static/)",
        "a/one:5 -> images/ok.png (images are served from /docs/static/images/)",
      ]);
    });
  });

  describe("noRelativeLinks", () => {
    it("reports links to Markdown files and relative paths, not to docs pages or other sites", async () => {
      expect(
        await failuresOf("noRelativeLinks", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                "[a](./authentication.md) [b](../cli/index) [c](monitor/website-monitor.md)",
                "[d](/docs/monitor/website-monitor.md#x) [e](/docs/monitor/website-monitor)",
                "[f](https://github.com/OneUptime/oneuptime/blob/master/README.md)",
              ),
            },
          },
        }),
      ).toEqual([
        "a/one:2 -> ./authentication.md (link as /docs/<category>/<page>)",
        "a/one:2 -> ../cli/index (link as /docs/<category>/<page>)",
        "a/one:2 -> monitor/website-monitor.md (link as /docs/<category>/<page>)",
        "a/one:3 -> /docs/monitor/website-monitor.md#x (link as /docs/<category>/<page>)",
      ]);
    });
  });

  describe("rendered", () => {
    it("reports raw component syntax, a raw callout marker and an unfilled placeholder", async () => {
      expect(
        await failuresOf("rendered", {
          pages: {
            en: {
              "a/unknown": md("# Unknown", "", ":::stepz", "Text.", ":::"),
              "a/marker": md("# Marker", "", "[!NOTE] Not in a quote."),
              "a/placeholder": md(
                "# Placeholder",
                "",
                "Allow {{NOT_A_TOKEN}}.",
              ),
              "a/tab": md("# Tab", "", "@tab Lost"),
            },
          },
        }),
      ).toEqual([
        "a/marker shows a raw '[!NOTE]' marker to the reader",
        "a/placeholder shows an unfilled {{PLACEHOLDER}} to the reader",
        "a/tab shows a raw '@tab' line to the reader",
        "a/unknown shows a raw ':::' line to the reader",
      ]);
    });

    it("passes components, callouts and filled placeholders, and syntax shown as code", async () => {
      expect(
        await failuresOf("rendered", {
          pages: {
            en: {
              "a/one": md(
                GOOD_PAGE,
                "",
                "Our addresses: {{IP_WHITELIST}}",
                "",
                "Write `:::steps` and `> [!NOTE]` like this:",
                "",
                "````markdown",
                ":::tabs",
                "@tab One",
                "{{NOT_A_TOKEN}}",
                ":::",
                "````",
              ),
            },
          },
        }),
      ).toEqual([]);
    });
  });

  describe("uniqueHeadings", () => {
    it("reports a heading whose anchor an earlier heading has, in each language", async () => {
      const fake: FakeDocs = {
        pages: {
          en: {
            "a/one": md(
              "# Setup",
              "",
              "## Setup",
              "",
              "## Cloud",
              "",
              "### Cloud",
            ),
          },
          de: {
            "a/one": md(
              "# Einrichtung",
              "",
              "## Einrichtung",
              "",
              "## Wolke",
              "",
              "### Cloud",
            ),
          },
        },
      };

      // The title on line 1 is not in the page body: "## Setup" does not repeat it.
      expect(await failuresOf("uniqueHeadings", fake)).toEqual([
        'a/one:7 "Cloud" has the anchor #cloud of line 5, so links to it land on line 5',
      ]);
      expect(await failuresOf("uniqueHeadings", fake, "de")).toEqual([]);
    });

    it("compares anchors, not the words: punctuation and case do not make a heading unique", async () => {
      expect(
        await failuresOf("uniqueHeadings", {
          pages: { en: { "a/one": md("# One", "## Set up!", "## set up") } },
        }),
      ).toEqual([
        'a/one:3 "set up" has the anchor #set-up of line 2, so links to it land on line 2',
      ]);
    });
  });

  describe("codeLanguage", () => {
    it("reports an English code sample without a language, not a translation's", async () => {
      const fake: FakeDocs = {
        pages: {
          en: {
            "a/one": md("# One", "```", "ls", "```", "```bash", "ls", "```"),
          },
          de: { "a/one": md("# Eins", "```", "ls", "```") },
        },
      };

      expect(await failuresOf("codeLanguage", fake)).toEqual([
        "a/one:2 opens a code sample without a language (```bash, ```yaml, ```text...)",
      ]);
      // English alone decides: a translation keeps English's languages (sameShape).
      expect(ruleById("codeLanguage").scope).toBe("english");
    });
  });

  describe("headingLevels", () => {
    it("reports a heading more than one level below the one before it", async () => {
      expect(
        await failuresOf("headingLevels", {
          pages: {
            en: {
              "a/one": md("# One", "## A", "#### Too deep", "## B", "### C"),
              "a/two": md("# Two", "### Under the title"),
            },
          },
        }),
      ).toEqual([
        'a/one:3 "Too deep" is an h4 under an h2',
        'a/two:2 "Under the title" is an h3 under an h1',
      ]);
    });

    it("reads the body under the page's title: line 1 is never shown as a heading", async () => {
      // Line 1 is stripped from the page; its body starts under the docs' own h1.
      expect(
        await failuresOf("headingLevels", {
          pages: { en: { "a/one": md("### Not a title", "## A", "### B") } },
        }),
      ).toEqual([]);
    });
  });

  describe("relativeDocsLinks", () => {
    it("reports links to the docs on oneuptime.com", async () => {
      expect(
        await failuresOf("relativeDocsLinks", {
          pages: {
            en: {
              "a/one": md(
                "# One",
                "[a](https://oneuptime.com/docs/monitor/index) [b](https://www.oneuptime.com/docs/a/b)",
                "[c](/docs/monitor/index) [d](https://oneuptime.com/pricing)",
              ),
            },
          },
        }),
      ).toEqual([
        "a/one:2 -> https://oneuptime.com/docs/monitor/index (link as /docs/<category>/<page>)",
        "a/one:2 -> https://www.oneuptime.com/docs/a/b (link as /docs/<category>/<page>)",
      ]);
    });
  });

  describe("gettingStartedReachesGroups", () => {
    const nav: Array<NavGroup> = [
      {
        title: "Introduction",
        section: "Get Started",
        links: [
          {
            title: "Getting Started",
            url: "/docs/introduction/getting-started",
          },
        ],
      },
      {
        title: "Monitor",
        section: "Monitoring",
        links: [
          { title: "Monitors", url: "/docs/monitor/index" },
          { title: "Website", url: "/docs/monitor/website-monitor" },
        ],
      },
      {
        title: "Status Pages",
        section: "Incident Response",
        links: [{ title: "Overview", url: "/docs/status-pages/index" }],
      },
    ];

    it("reports each nav group Getting Started links into no page of", async () => {
      expect(
        await failuresOf("gettingStartedReachesGroups", {
          pages: {
            en: {
              "introduction/getting-started": md(
                "# Getting Started",
                "[Website monitors](/docs/monitor/website-monitor#create-a-monitor)",
              ),
            },
          },
          nav: nav,
        }),
      ).toEqual([
        'introduction/getting-started links to no page of the nav group "Introduction"',
        'introduction/getting-started links to no page of the nav group "Status Pages"',
      ]);
    });

    it("passes when it links into every group, and reports nothing without the page", async () => {
      expect(
        await failuresOf("gettingStartedReachesGroups", {
          pages: {
            en: {
              "introduction/getting-started": md(
                "# Getting Started",
                "[here](/docs/introduction/getting-started) [monitors](/docs/monitor/index) [status](/docs/status-pages/index)",
              ),
            },
          },
          nav: nav,
        }),
      ).toEqual([]);
      expect(
        await failuresOf("gettingStartedReachesGroups", {
          pages: { en: { "monitor/index": MONITOR_INDEX } },
          nav: nav,
        }),
      ).toEqual([]);
    });
  });

  describe("translated", () => {
    it("reports each English page a language lacks", async () => {
      const fake: FakeDocs = {
        pages: {
          en: { "a/one": md("# One"), "a/two": md("# Two") },
          de: { "a/one": md("# Eins"), "a/two": md("# Zwei") },
          ja: { "a/one": md("# 一") },
        },
      };

      expect(await failuresOf("translated", fake, "de")).toEqual([]);
      expect(await failuresOf("translated", fake, "ja")).toEqual([
        "a/two has no ja translation, so it is served in English",
      ]);
    });
  });

  describe("sameShape", () => {
    const ENGLISH: string = md(
      "# One",
      "## Install",
      ":::tabs",
      "@tab Docker Compose",
      "```bash",
      "docker compose up -d",
      "```",
      "@tab Kubernetes",
      "```yaml",
      "replicas: 1",
      "```",
      ":::",
      "> [!WARNING]",
      "> Back up first. Allow {{IP_WHITELIST}}.",
      "See [two](/docs/a/two#x) and [two again](/docs/a/two).",
      "![Screen](/docs/static/images/screen.png)",
    );

    const shapeDrift: (translation: string) => Promise<Array<string>> = (
      translation: string,
    ): Promise<Array<string>> => {
      return failuresOf(
        "sameShape",
        {
          pages: {
            en: { "a/one": ENGLISH, "a/two": md("# Two") },
            de: { "a/one": translation },
          },
        },
        "de",
      );
    };

    it("passes a translation that says it in other words, with the same shape", async () => {
      expect(
        await shapeDrift(
          md(
            "# Eins",
            "## Installieren",
            ":::tabs",
            "@tab Docker Compose",
            "```bash",
            "docker compose up -d",
            "```",
            "@tab Kubernetes",
            "```yaml",
            "replicas: 1",
            "```",
            ":::",
            "> [!WARNING]",
            "> Zuerst sichern. {{IP_WHITELIST}} erlauben.",
            "Siehe [zwei](/docs/a/two#y).",
            "![Bildschirm](/docs/static/images/screen.png)",
          ),
        ),
      ).toEqual([]);
    });

    it("reports each part that differs: sections, code, components, callouts, placeholders, links, images", async () => {
      expect(
        await shapeDrift(
          md(
            "# Eins",
            "## Installieren",
            "### Extra",
            ":::tabs",
            "@tab Docker Compose",
            "```sh",
            "docker compose up -d",
            "```",
            "@tab Kubernetes",
            "```yaml",
            "replicas: 1",
            "```",
            "@tab Helm",
            "Text.",
            ":::",
            "> [!NOTE]",
            "> Zuerst sichern.",
            "![Bildschirm](/docs/static/images/screen-de.png)",
          ),
        ),
      ).toEqual([
        "a/one headings: English [1,2], de [1,2,3]",
        'a/one fences: English ["bash","yaml"], de ["sh","yaml"]',
        'a/one components: English ["tabs(2)"], de ["tabs(3)"]',
        'a/one alerts: English ["WARNING"], de ["NOTE"]',
        'a/one placeholders: English ["IP_WHITELIST"], de []',
        'a/one pageLinks: English ["a/two"], de []',
        'a/one images: English ["/docs/static/images/screen.png"], de ["/docs/static/images/screen-de.png"]',
      ]);
    });

    it("reads steps by their count, and ignores a page with no translation", async () => {
      const steps: (count: number) => string = (count: number): string => {
        const lines: Array<string> = ["# One", ":::steps"];
        for (let step: number = 1; step <= count; step++) {
          lines.push(`### Step ${step}`, "Do it.");
        }
        lines.push(":::");
        return md(...lines);
      };

      expect(shapeOf(scanMarkdown(steps(3))).components).toEqual(["steps(3)"]);
      expect(
        await failuresOf(
          "sameShape",
          {
            pages: {
              en: { "a/one": steps(3), "a/two": md("# Two") },
              de: { "a/one": steps(2) },
            },
          },
          "de",
        ),
      ).toEqual([
        "a/one headings: English [1,3,3,3], de [1,3,3]",
        'a/one components: English ["steps(3)"], de ["steps(2)"]',
      ]);
    });
  });
});

describe("the ratchet", () => {
  // A rule that reports what it is given.
  const ruleReporting: (
    id: DocsRuleId,
    scope: DocsRuleScope,
    failures: Array<DocsRuleFailure>,
  ) => DocsContentRule = (
    id: DocsRuleId,
    scope: DocsRuleScope,
    failures: Array<DocsRuleFailure>,
  ): DocsContentRule => {
    return {
      id: id,
      title: "a rule",
      scope: scope,
      suite: "content",
      check: (_docs: DocsReader, lang: string): Array<DocsRuleFailure> => {
        return failures.filter((failure: DocsRuleFailure): boolean => {
          return failure.lang === lang;
        });
      },
    };
  };

  const BROKEN_IN_DE: Array<DocsRuleFailure> = [
    { page: "a/one", lang: "de", line: 3, detail: "is broken" },
    { page: "a/one", lang: "de", line: 9, detail: "is broken again" },
    { page: "a/two", lang: "de", detail: "is broken too" },
  ];

  it("changes nothing when nothing fails and nothing is listed", () => {
    expect(
      compareWithKnownFailures(
        ruleReporting("components", "every-language", []),
        "de",
        [],
        {},
      ),
    ).toEqual(NOTHING_CHANGED);
  });

  it("reports every failure of a page that is not listed, with its line", () => {
    expect(
      compareWithKnownFailures(
        ruleReporting("components", "every-language", BROKEN_IN_DE),
        "de",
        BROKEN_IN_DE,
        { "a/two": { components: ["de"] } },
      ),
    ).toEqual({
      newFailures: ["a/one:3 is broken", "a/one:9 is broken again"],
      nowPassing: [],
    });
  });

  it("tolerates a listed page, however many failures it has, in the languages listed", () => {
    expect(
      compareWithKnownFailures(
        ruleReporting("components", "every-language", BROKEN_IN_DE),
        "de",
        BROKEN_IN_DE,
        {
          "a/one": { components: ["de", "fr"] },
          "a/two": { components: ["de"] },
        },
      ),
    ).toEqual(NOTHING_CHANGED);
  });

  it("does not let a page listed in one language, or for one rule, fail another", () => {
    expect(
      compareWithKnownFailures(
        ruleReporting("components", "every-language", BROKEN_IN_DE),
        "de",
        BROKEN_IN_DE,
        {
          "a/one": { components: ["fr"], images: ["de"] },
          "a/two": { components: ["de"] },
        },
      ).newFailures,
    ).toEqual(["a/one:3 is broken", "a/one:9 is broken again"]);
  });

  it("names a listed page that passes now, and what to delete", () => {
    const known: DocsKnownFailures = {
      "a/one": { components: ["de", "fr"] },
      "a/two": { components: ["de"] },
      "a/zero": { components: ["fr"] },
    };
    const rule: DocsContentRule = ruleReporting(
      "components",
      "every-language",
      BROKEN_IN_DE,
    );

    expect(compareWithKnownFailures(rule, "fr", [], known)).toEqual({
      newFailures: [],
      nowPassing: [
        'a/one passes "components" in fr now: delete "fr" from its "components" languages in DocsKnownFailures.ts',
        'a/zero passes "components" in fr now: delete "fr" from its "components" languages in DocsKnownFailures.ts',
      ],
    });
  });

  it("names the rule to delete for a rule English alone decides", () => {
    expect(
      compareWithKnownFailures(
        ruleReporting("codeLanguage", "english", []),
        "en",
        [],
        { "a/one": { codeLanguage: ["en"] } },
      ),
    ).toEqual({
      newFailures: [],
      nowPassing: [
        'a/one passes "codeLanguage" now: delete "codeLanguage" from its entry in DocsKnownFailures.ts',
      ],
    });
  });

  it("finds the pages listed for a rule in a language", () => {
    const known: DocsKnownFailures = {
      "a/one": { components: ["de", "fr"], images: ["de"] },
      "a/two": { components: ["fr"] },
    };

    expect(Array.from(knownFailingPages(known, "components", "fr"))).toEqual([
      "a/one",
      "a/two",
    ]);
    expect(Array.from(knownFailingPages(known, "images", "fr"))).toEqual([]);
  });

  it("runs a real rule, synchronous or not, and compares it with the list", async () => {
    const before: DocsReader = docsOf({
      pages: { en: { "a/one": md("# One", "```", "ls", "```") } },
    });
    const fixed: DocsReader = docsOf({
      pages: { en: { "a/one": md("# One", "```bash", "ls", "```") } },
    });
    const known: DocsKnownFailures = { "a/one": { codeLanguage: ["en"] } };

    expect(
      await checkRule(before, ruleById("codeLanguage"), "en", known),
    ).toEqual(NOTHING_CHANGED);
    expect(
      await checkRule(fixed, ruleById("codeLanguage"), "en", known),
    ).toEqual({
      newFailures: [],
      nowPassing: [
        'a/one passes "codeLanguage" now: delete "codeLanguage" from its entry in DocsKnownFailures.ts',
      ],
    });
    expect(await checkRule(before, ruleById("codeLanguage"), "en", {})).toEqual(
      {
        newFailures: [
          "a/one:2 opens a code sample without a language (```bash, ```yaml, ```text...)",
        ],
        nowPassing: [],
      },
    );

    // "rendered" is asynchronous: it renders the page.
    const unrendered: DocsReader = docsOf({
      pages: { en: { "a/one": md("# One", "", ":::stepz", "Text.", ":::") } },
    });
    expect(
      await checkRule(unrendered, ruleById("rendered"), "en", {
        "a/one": { rendered: ["en"] },
      }),
    ).toEqual(NOTHING_CHANGED);
  });
});

describe("the rules table", () => {
  it("names each rule once, and runs it in one of the two content suites", () => {
    const ids: Array<DocsRuleId> = DOCS_CONTENT_RULES.map(
      (rule: DocsContentRule): DocsRuleId => {
        return rule.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of DOCS_CONTENT_RULES) {
      expect(["content", "translations"]).toContain(rule.suite);
      expect(rule.title.length).toBeGreaterThan(10);
    }
    // DocsTranslations runs what compares a translation with its English page.
    expect(
      DOCS_CONTENT_RULES.filter((rule: DocsContentRule): boolean => {
        return rule.suite === "translations";
      }).map((rule: DocsContentRule): DocsRuleId => {
        return rule.id;
      }),
    ).toEqual(["translated", "sameShape"]);
  });

  it("reads English alone, every translation or every language, as its scope says", () => {
    const docs: DocsReader = docsOf({ pages: { en: {} } });

    expect(languagesOfScope(docs, "english")).toEqual(["en"]);
    expect(languagesOfScope(docs, "translations")).toEqual(["de", "ja"]);
    expect(languagesOfScope(docs, "every-language")).toEqual(FAKE_LANGUAGES);
    expect(() => {
      return ruleById("noSuchRule" as DocsRuleId);
    }).toThrow('No docs content rule "noSuchRule"');
  });
});

describe("the known-failures list", () => {
  const entries: Array<[string, Partial<Record<DocsRuleId, Array<string>>>]> =
    Object.entries(DOCS_KNOWN_FAILURES);
  const ruleOrder: Array<DocsRuleId> = DOCS_CONTENT_RULES.map(
    (rule: DocsContentRule): DocsRuleId => {
      return rule.id;
    },
  );

  it("lists pages in alphabetical order, each with at least one rule", () => {
    const pages: Array<string> = entries.map(
      (entry: [string, Partial<Record<DocsRuleId, Array<string>>>]): string => {
        return entry[0];
      },
    );

    expect(pages).toEqual([...pages].sort());
    expect(
      entries
        .filter(
          (
            entry: [string, Partial<Record<DocsRuleId, Array<string>>>],
          ): boolean => {
            return Object.keys(entry[1]).length === 0;
          },
        )
        .map(
          (
            entry: [string, Partial<Record<DocsRuleId, Array<string>>>],
          ): string => {
            return entry[0];
          },
        ),
    ).toEqual([]);
  });

  it("names only rules there are, in the order of the rules table", () => {
    const problems: Array<string> = [];

    for (const [page, rules] of entries) {
      const ids: Array<string> = Object.keys(rules);
      const unknown: Array<string> = ids.filter((id: string): boolean => {
        return !ruleOrder.includes(id as DocsRuleId);
      });
      if (unknown.length > 0) {
        problems.push(`${page}: no rule ${unknown.join(", ")}`);
        continue;
      }
      const ordered: Array<string> = [...ids].sort(
        (a: string, b: string): number => {
          return (
            ruleOrder.indexOf(a as DocsRuleId) -
            ruleOrder.indexOf(b as DocsRuleId)
          );
        },
      );
      if (ordered.join() !== ids.join()) {
        problems.push(
          `${page}: ${ids.join(", ")} (order: ${ordered.join(", ")})`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it("lists each rule's languages from the languages it reads, in the docs' order, once each", () => {
    const docs: DocsReader = new DocsReader(DOCS_CORPUS);
    const problems: Array<string> = [];

    for (const [page, rules] of entries) {
      for (const [id, languages] of Object.entries(rules) as Array<
        [DocsRuleId, Array<string>]
      >) {
        const readable: Array<string> = languagesOfScope(
          docs,
          ruleById(id).scope,
        );
        const where: string = `${page} ${id} [${languages.join(", ")}]`;

        if (languages.length === 0) {
          problems.push(`${where}: no languages`);
        }
        for (const lang of languages) {
          if (!readable.includes(lang)) {
            problems.push(`${where}: "${id}" does not read ${lang}`);
          }
        }
        if (new Set(languages).size !== languages.length) {
          problems.push(`${where}: a language twice`);
        }
        const inOrder: Array<string> = readable.filter(
          (lang: string): boolean => {
            return languages.includes(lang);
          },
        );
        if (inOrder.join() !== languages.join()) {
          problems.push(`${where}: write them as ${inOrder.join(", ")}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("uses the languages the docs serve", () => {
    expect(DOCS_LANGUAGES[0]).toBe("en");
    expect(TRANSLATED_LANGUAGES).toEqual(DOCS_LANGUAGES.slice(1));
    expect(TRANSLATED_LANGUAGES).toHaveLength(16);
  });
});

describe("anchors, as the docs render them", () => {
  /*
   * pageLinks and inPageAnchors accept an anchor when a heading of the page
   * the reader lands on has it, computed from the Markdown. Every anchor they
   * accept is an id of that page as the docs render it, in every language -
   * among them the 17 links docs:localize-anchors pointed at translated
   * headings (the PagerDuty page's link to the Integrations overview in 16
   * languages, the Persian session replay page's link to Browser Setup).
   */
  const docs: DocsReader = new DocsReader(DOCS_CORPUS);
  const HEADING_ID: RegExp = /<h[1-6] id="([^"]+)"/g;
  const rendered: Map<string, Promise<Set<string>>> = new Map();

  const renderedIds: (lang: string, page: string) => Promise<Set<string>> = (
    lang: string,
    page: string,
  ): Promise<Set<string>> => {
    const key: string = `${lang}/${page}`;
    let ids: Promise<Set<string>> | undefined = rendered.get(key);
    if (!ids) {
      const body: string = docs.scan(lang, page).lines.slice(1).join("\n");
      ids = DOCS_CORPUS.renderBody(body, lang).then(
        (html: string): Set<string> => {
          const found: Set<string> = new Set();
          for (const match of html.matchAll(HEADING_ID)) {
            found.add(match[1]!);
          }
          return found;
        },
      );
      rendered.set(key, ids);
    }
    return ids;
  };

  it.each(DOCS_LANGUAGES)(
    "%s: every anchor the rules accept is a heading id of the rendered page",
    async (lang: string) => {
      const notRendered: Array<string> = [];
      let accepted: number = 0;

      for (const page of docs.pages(lang)) {
        for (const link of docs.scan(lang, page).links) {
          const target: DocsPageLink | null = link.target.startsWith("#")
            ? { page: page, anchor: decodeAnchor(link.target.slice(1)) }
            : parseDocsLink(link.target);
          if (!target || !target.anchor) {
            continue;
          }
          const landing: string = docs.hasPage(lang, target.page) ? lang : "en";
          if (
            !docs.hasPage(landing, target.page) ||
            !docs.anchors(landing, target.page).has(target.anchor)
          ) {
            // The rules report this link; it is not accepted.
            continue;
          }
          accepted++;
          if (!(await renderedIds(landing, target.page)).has(target.anchor)) {
            notRendered.push(`${page}:${link.line} -> ${link.target}`);
          }
        }
      }

      expect(notRendered).toEqual([]);
      expect(accepted).toBeGreaterThan(0);
    },
  );
});

describe("reading docs links", () => {
  it("decodes an anchor, and keeps one that is not valid percent-encoding as written", () => {
    expect(decodeAnchor("%E8%A8%AD%E5%AE%9A")).toBe("設定");
    expect(decodeAnchor("100%")).toBe("100%");
    expect(parseDocsLink("/docs/a/b#100%")).toEqual({
      page: "a/b",
      anchor: "100%",
    });
    expect(parseDocsLink("/docs/a/b#%E8%A8%AD")).toEqual({
      page: "a/b",
      anchor: "設",
    });
    expect(parseDocsLink("/docs/a/b")).toEqual({ page: "a/b", anchor: null });
    expect(parseDocsLink("/docs/static/images/x.png")).toBeNull();
    expect(parseDocsLink("https://oneuptime.com/docs/a/b")).toBeNull();
  });
});
