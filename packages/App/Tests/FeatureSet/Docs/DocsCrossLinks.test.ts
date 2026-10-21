import DocsNav, { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import { getDocsCategoryFirstPage } from "../../../FeatureSet/Docs/Utils/Redirects";
import {
  DOCS_LANGUAGES,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  NAV_PAGES,
  ScannedPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * The final pass of the docs overhaul (task 40) linked the pages the
 * overhaul added from the pages a reader is on when they need them, and gave
 * every page a way in besides the sidebar. These tests hold both:
 *
 *   - Every page of the nav but the docs' home is linked from another page.
 *     A page nothing links to is found only by someone who already knows to
 *     look in the sidebar; three were (the phone number allow list, Topology
 *     and Local Development).
 *   - The links the pass added are where a reader needs them, in English and
 *     in every translation, on the same line and in the same section as the
 *     English (the translations follow their English pages line for line).
 *   - /docs/installation, which opens its category's first page, opens the
 *     install guide, not the page about working on OneUptime's own code.
 */

// The page /docs opens: the nav's first page, the one page nothing needs to link to.
const DOCS_HOME: string = "introduction/getting-started";

// English pages by "category/page", for the inbound-link check.
type Pages = Record<string, string>;

// Every page of `nav` that no other page of `pages` links to.
function pagesWithNoWayIn(nav: Array<string>, pages: Pages): Array<string> {
  const linked: Set<string> = new Set();

  for (const [page, markdown] of Object.entries(pages)) {
    for (const link of scanMarkdown(markdown).links) {
      const target: DocsPageLink | null = parseDocsLink(link.target);

      if (target && target.page !== page) {
        linked.add(target.page);
      }
    }
  }

  return nav.filter((page: string): boolean => {
    return !linked.has(page);
  });
}

function englishPages(): Pages {
  const pages: Pages = {};

  for (const page of NAV_PAGES) {
    pages[page] = readPage("en", page);
  }

  return pages;
}

describe("every page of the docs has a way in besides the sidebar", () => {
  it("is checked on the nav's pages, and the docs' home is the nav's first page", () => {
    expect(NAV_PAGES.length).toBeGreaterThan(250);
    expect(NAV_PAGES[0]).toBe(DOCS_HOME);
  });

  it("links every page of the nav but the docs' home from another English page", () => {
    expect(pagesWithNoWayIn(NAV_PAGES, englishPages())).toEqual([DOCS_HOME]);
  });

  it("finds a page no other page links to, and does not count a page's links to itself", () => {
    const pages: Pages = {
      "a/one": "# One\n\nSee [Two](/docs/a/two) and [One](/docs/a/one#top).\n",
      "a/two":
        "# Two\n\nSee [Two](/docs/a/two) and [elsewhere](https://example.com).\n",
      "a/three":
        "# Three\n\n```bash\n# [One](/docs/a/one) in code is no link\n```\n",
    };

    expect(pagesWithNoWayIn(["a/one", "a/two", "a/three"], pages)).toEqual([
      "a/one",
      "a/three",
    ]);
  });

  it("counts a link with a language in it as a link to the page", () => {
    const pages: Pages = {
      "a/one": "# One\n\n[Two](/docs/de/a/two#abschnitt)\n",
      "a/two": "# Two\n\n[One](/docs/a/one)\n",
    };

    expect(pagesWithNoWayIn(["a/one", "a/two"], pages)).toEqual([]);
  });
});

interface CrossLink {
  // The page the link is on.
  page: string;
  // The "## " section it is in, as the English page titles it ("" for the lead).
  section: string;
  // The page it opens, and the anchor in the English page's link, if any.
  target: string;
  anchor?: string;
  // Why a reader there wants that page.
  why: string;
}

const CROSS_LINKS: ReadonlyArray<CrossLink> = [
  {
    page: "monitor/create-monitor",
    section: "Criteria",
    target: "monitor/criteria-and-statuses",
    why: "After how criteria are evaluated: everything a criteria holds, and the statuses",
  },
  {
    page: "monitor/create-monitor",
    section: "Starting from a template or a link",
    target: "monitor/criteria-and-statuses",
    why: "A card among the places to go next",
  },
  {
    page: "monitor/create-monitor",
    section: "Starting from a template or a link",
    target: "monitor/monitor-groups",
    why: "A card among the places to go next",
  },
  {
    page: "incidents/index",
    section: "",
    target: "incidents/episodes",
    why: "The overview's cards list the group's pages",
  },
  {
    page: "incidents/index",
    section: "",
    target: "incidents/postmortems",
    why: "The overview's cards list the group's pages",
  },
  {
    page: "incidents/index",
    section: "How it works",
    target: "incidents/postmortems",
    why: "Where the lifecycle says you can write a postmortem",
  },
  {
    page: "status-pages/index",
    section: "How it works",
    target: "scheduled-maintenance/index",
    why: "Maintenance events reach a page on the status pages they name",
  },
  {
    page: "status-pages/resources-and-groups",
    section: "Add a monitor",
    target: "monitor/monitor-groups",
    why: "Where it says to add a monitor group to show several checks as one row",
  },
  ...[
    {
      page: "telemetry/logs-explorer",
      tabs: "How the explorer narrows your logs",
      arrival: "What happens to logs as they arrive",
    },
    {
      page: "telemetry/traces-explorer",
      tabs: "Traces and spans",
      arrival: "What happens to spans as they arrive",
    },
  ].flatMap(
    (explorer: {
      page: string;
      tabs: string;
      arrival: string;
    }): Array<CrossLink> => {
      return [
        {
          page: explorer.page,
          section: explorer.tabs,
          target: "telemetry/ingestion-keys",
          why: "The Setup Guide tab sends with an ingestion key",
        },
        {
          page: explorer.page,
          section: explorer.arrival,
          target: "telemetry/data-retention",
          why: "How long a record is kept is decided as it arrives too",
        },
        {
          page: explorer.page,
          section: explorer.arrival,
          target: "telemetry/drop-filters-and-scrub-rules",
          anchor: "drop-or-sample-records",
          why: "The Drop Filters row",
        },
        {
          page: explorer.page,
          section: explorer.arrival,
          target: "telemetry/drop-filters-and-scrub-rules",
          anchor: "scrub-sensitive-data",
          why: "The Scrub Rules row",
        },
      ];
    },
  ),
  {
    page: "telemetry/open-telemetry",
    section: "How it works",
    target: "telemetry/drop-filters-and-scrub-rules",
    why: "What happens to data as it arrives",
  },
  {
    page: "telemetry/open-telemetry",
    section: "How it works",
    target: "telemetry/data-retention",
    why: "How long the rest is kept",
  },
  {
    page: "telemetry/open-telemetry",
    section: "Endpoints and limits",
    target: "telemetry/ingestion-keys",
    why: "After the key settings: Browser keys, rotating a key, every refusal",
  },
  {
    page: "on-call/index",
    section: "Troubleshooting",
    target: "on-call/phone-number-whitelist",
    why: "Someone was not paged: a phone that blocks unknown callers",
  },
  {
    page: "inventory/overview",
    section: "Relationships and topology",
    target: "telemetry/topology",
    why: "Inventory's Topology Map opens the Topology page",
  },
  {
    page: "installation/docker-compose",
    section: "",
    target: "installation/local-development",
    why: "For people who want to work on OneUptime's own code instead",
  },
];

// The "## " section a line is in: its heading's text, or "" before the first.
function sectionOf(scanned: ScannedPage, line: number): string {
  let section: string = "";

  for (const heading of scanned.headings) {
    if (heading.line > line) {
      break;
    }

    if (heading.level === 2) {
      section = heading.text;
    }
  }

  return section;
}

// The index of a line's "## " section among the page's sections (0: the lead).
function sectionIndexOf(scanned: ScannedPage, line: number): number {
  return scanned.headings.filter((heading: DocsHeading): boolean => {
    return heading.level === 2 && heading.line <= line;
  }).length;
}

// The page's links to the cross link's page (with its anchor, in English).
function linksTo(
  scanned: ScannedPage,
  crossLink: CrossLink,
  withAnchor: boolean,
): Array<DocsLink> {
  return scanned.links.filter((link: DocsLink): boolean => {
    const target: DocsPageLink | null = parseDocsLink(link.target);

    return (
      target !== null &&
      target.page === crossLink.target &&
      (!withAnchor || (target.anchor || undefined) === crossLink.anchor)
    );
  });
}

describe("the links the final pass added", () => {
  it("open pages of the nav, and each is listed once", () => {
    const seen: Set<string> = new Set();

    for (const crossLink of CROSS_LINKS) {
      expect(NAV_PAGES).toContain(crossLink.page);
      expect(NAV_PAGES).toContain(crossLink.target);

      const key: string = `${crossLink.page} ${crossLink.section} ${crossLink.target}#${crossLink.anchor || ""}`;

      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  describe.each(CROSS_LINKS)(
    "$page links $target in its section '$section' ($why)",
    (crossLink: CrossLink) => {
      const english: ScannedPage = scanMarkdown(readPage("en", crossLink.page));
      const englishLinks: Array<DocsLink> = linksTo(english, crossLink, true);

      it("in English", () => {
        expect(
          englishLinks
            .map((link: DocsLink): string => {
              return sectionOf(english, link.line);
            })
            .includes(crossLink.section),
        ).toBe(true);
      });

      it.each(
        DOCS_LANGUAGES.filter((lang: string): boolean => {
          return lang !== "en";
        }),
      )("in %s, on the English line, in the same section", (lang: string) => {
        const translated: ScannedPage = scanMarkdown(
          readPage(lang, crossLink.page),
        );
        // A translation's anchors are its own headings': the page is what is compared.
        const translatedLinks: Array<DocsLink> = linksTo(
          translated,
          crossLink,
          false,
        );

        for (const link of englishLinks) {
          if (sectionOf(english, link.line) !== crossLink.section) {
            continue;
          }

          expect({
            lang,
            line: link.line,
            linked: translatedLinks.some((candidate: DocsLink): boolean => {
              return candidate.line === link.line;
            }),
            section: sectionIndexOf(translated, link.line),
          }).toEqual({
            lang,
            line: link.line,
            linked: true,
            section: sectionIndexOf(english, link.line),
          });
        }
      });
    },
  );
});

describe("the Installation group", () => {
  const installation: NavGroup | undefined = DocsNav.find(
    (group: NavGroup): boolean => {
      return group.title === "Installation";
    },
  );
  const urls: Array<string> = (installation?.links || []).map(
    (link: { url: string }): string => {
      return link.url;
    },
  );

  it("opens with Docker Compose, so /docs/installation opens the install guide", () => {
    expect(urls[0]).toBe("/docs/installation/docker-compose");
    expect(getDocsCategoryFirstPage("installation")).toBe(
      "installation/docker-compose",
    );
  });

  it("lists Local Development, running OneUptime from source to work on it, last", () => {
    expect(urls[urls.length - 1]).toBe("/docs/installation/local-development");
    expect(readPage("en", "installation/local-development")).toContain(
      "Run OneUptime from source on your own computer to work on it.",
    );
  });
});
