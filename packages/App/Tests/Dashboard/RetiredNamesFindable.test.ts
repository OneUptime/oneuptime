// UX rule: Docs/ux/README.md#names
import {
  buildPageSearchCommandDescriptors,
  getPageSearchCommandRanking,
  PageSearchCommandDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { getPageSearchAreas } from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import DocsSearch, {
  DocsSearchAnswer,
  DocsSearchResult,
} from "../../FeatureSet/Docs/Utils/DocsSearch";
import {
  DocsGlossaryEntry,
  parseGlossary,
} from "../../FeatureSet/Docs/Utils/Glossary";
import { RETIRED_NAMES, RetiredName } from "Common/Types/Docs/RetiredNames";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RETIRED NAME STILL FINDS WHAT IT NAMED (#6817: "searching an old name
 * still finds the page").
 *
 * RetiredNamesGuard keeps a retired name out of what people read. People
 * who learned it still type it, so for every retired name
 * (Common/Types/Docs/RetiredNames) this holds, through the real search of
 * each place:
 *
 *   - Search (Cmd/Ctrl+K) offers the page it named, by a keyword of that
 *     page (PageSearchIndex.ts), and the products menu finds the product by
 *     it (NavigationItems.tsx);
 *   - the glossary's term for it lists it under "Also called", or says what
 *     it is called now;
 *   - the docs' own search opens the page that covers it.
 *
 * A name retired later adds its line to FINDABLE: the test fails until it
 * does.
 */

jest.mock("../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

interface Findable {
  // What a person types into Search, and the page it should offer.
  search: { query: string; offers: string };
  // The products menu's entry that finds the product by its old name.
  productKeyword?: string | undefined;
  // What the glossary term says about it: the old name, or the new one.
  glossaryMentions: string;
  /*
   * What a person types into the docs' search, and a result it must give
   * among the first ten: the page, or the glossary term that says what the
   * thing is called now and links to it.
   */
  docs: { query: string; opens: string };
}

const FINDABLE: Record<string, Findable> = {
  "On-Call Duty": {
    search: { query: "on-call duty policies", offers: "On-Call Policies" },
    productKeyword: "on-call duty",
    glossaryMentions: "On-Call Duty",
    docs: { query: "on-call duty", opens: "/docs/en/on-call/index" },
  },
  "On Call": {
    search: { query: "user on call time", offers: "User On-Call Time" },
    glossaryMentions: "On Call",
    docs: {
      query: "user on call time",
      opens: "/docs/en/on-call/readiness#user-on-call-time",
    },
  },
  "On-Call Policy Schedule": {
    search: { query: "on-call policy schedule", offers: "On-Call Schedules" },
    glossaryMentions: "On-Call Policy Schedule",
    docs: {
      query: "on-call policy schedule",
      opens: "/docs/en/on-call/schedules",
    },
  },
  "Personal On-Call Rules": {
    search: { query: "personal on-call rules", offers: "How to Reach Me" },
    glossaryMentions: "Personal On-Call Rules",
    /*
     * The page no longer says its old name, and no single word of it is
     * the page's: the glossary term, which lists it under "Also called"
     * and links to the page, is what the old name finds.
     */
    docs: {
      query: "personal on-call rules",
      opens: "/docs/en/introduction/glossary#how-to-reach-me",
    },
  },
  "Project Settings > Notifications > Notification Settings": {
    search: {
      query: "notification settings sms",
      offers: "Notification Channels",
    },
    glossaryMentions: "Notification Channels",
    docs: {
      query: "notification settings balance",
      opens: "/docs/en/configuration/project-settings#notifications",
    },
  },
};

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);
const GLOSSARY_EN: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Content/en/introduction/glossary.md",
);

const PROJECT: string = "project-a";

// Every page Search offers, as the palette ranks them.
const PAGES: Array<PaletteCommand> = buildPageSearchCommandDescriptors({
  areas: getPageSearchAreas(),
  availability: {
    isBillingEnabled: true,
    isMonitorGroupsEnabled: true,
    canDeleteProject: true,
  },
  getRouteTemplate: (key: string): string => {
    return `/dashboard/:projectId/${key.toLowerCase()}`;
  },
  getRoutePath: (key: string): string => {
    return `/dashboard/${PROJECT}/${key.toLowerCase()}`;
  },
  getProductTitle: (): string | undefined => {
    return undefined;
  },
  translate: (text: string): string => {
    return text;
  },
  catalog: [],
}).map((descriptor: PageSearchCommandDescriptor): PaletteCommand => {
  return {
    id: descriptor.id,
    title: descriptor.title,
    titleAliases: descriptor.titleAliases,
    keywords: descriptor.keywords,
    breadcrumb: descriptor.breadcrumb,
    breadcrumbKeywords: descriptor.breadcrumbKeywords,
    category: descriptor.isAction ? "Actions" : "Pages",
    isSearchOnly: true,
    ...getPageSearchCommandRanking(descriptor),
    onSelect: (): void => {},
  };
});

function offered(query: string): Array<string> {
  return filterPaletteCommands(PAGES, query)
    .slice(0, 5)
    .map((match: PaletteCommandMatch): string => {
      return match.command.title;
    });
}

// The products menu's keywords of the product whose entry names this title key.
function productKeywords(titleKey: string): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Utils/NavigationItems.tsx"),
    "utf8",
  );
  // The entry's keywords follow its title.
  const start: number = source.indexOf(`t("${titleKey}"`);
  const keywords: RegExpMatchArray | null = source
    .slice(start)
    .match(/keywords:\s*\[([\s\S]*?)\]/);

  return (keywords?.[1] || "")
    .split(",")
    .map((keyword: string): string => {
      return keyword
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
        .trim()
        .replace(/^"|"$/g, "");
    })
    .filter(Boolean);
}

describe("every retired name says how it is still found", () => {
  test("each one has a line here, and nothing here is not retired", () => {
    expect(Object.keys(FINDABLE).sort()).toEqual(
      RETIRED_NAMES.map((retired: RetiredName): string => {
        return retired.name;
      }).sort(),
    );
  });
});

describe("Search (Cmd/Ctrl+K) finds the page by its old name", () => {
  test.each(Object.entries(FINDABLE))(
    "%s",
    (_name: string, findable: Findable) => {
      expect(offered(findable.search.query)).toContain(findable.search.offers);
    },
  );

  test("a query nothing names offers nothing, so a find above means something", () => {
    expect(offered("zzqx retired name")).toEqual([]);
  });

  test("the products menu finds On-Call by its old name", () => {
    expect(productKeywords("navbar.items.onCallDutyTitle")).toContain(
      FINDABLE["On-Call Duty"]!.productKeyword,
    );
  });
});

describe("the glossary keeps the old name, or says what it is called now", () => {
  const english: string = fs.readFileSync(GLOSSARY_EN, "utf8");
  const entries: Array<DocsGlossaryEntry> =
    parseGlossary(english, english, "en") || [];

  test.each(
    RETIRED_NAMES.map((retired: RetiredName): [string, GlossaryTerm] => {
      return [retired.name, retired.glossaryTerm];
    }),
  )("%s, under its term %s", (name: string, term: GlossaryTerm) => {
    const entry: DocsGlossaryEntry | undefined = entries.find(
      (candidate: DocsGlossaryEntry): boolean => {
        return candidate.id === term;
      },
    );
    const mentions: string = FINDABLE[name]!.glossaryMentions;

    expect(entry).toBeDefined();
    expect(
      [...entry!.alsoCalled, entry!.definition].some(
        (text: string): boolean => {
          return text.toLowerCase().includes(mentions.toLowerCase());
        },
      ),
    ).toBe(true);
  });
});

describe("the docs' own search opens the page by its old name", () => {
  test.each(Object.entries(FINDABLE))(
    "%s",
    async (_name: string, findable: Findable) => {
      const answer: DocsSearchAnswer = await DocsSearch.search({
        query: findable.docs.query,
        language: "en",
        limit: 10,
      });

      expect(
        answer.results.some((result: DocsSearchResult): boolean => {
          return result.url.includes(findable.docs.opens);
        }),
      ).toBe(true);
    },
    600000,
  );

  test("a glossary term an old name finds links to the page it names", () => {
    const english: string = fs.readFileSync(GLOSSARY_EN, "utf8");
    const entries: Array<DocsGlossaryEntry> =
      parseGlossary(english, english, "en") || [];
    const anchors: Array<string> = Object.values(FINDABLE)
      .map((findable: Findable): string => {
        return findable.docs.opens.split("/introduction/glossary#")[1] || "";
      })
      .filter(Boolean);

    expect(anchors).toEqual(["how-to-reach-me"]);

    for (const anchor of anchors) {
      const entry: DocsGlossaryEntry | undefined = entries.find(
        (candidate: DocsGlossaryEntry): boolean => {
          return candidate.anchor === anchor;
        },
      );

      expect(
        entry?.links.map((link: { url: string }): string => {
          return link.url;
        }),
      ).toContain("/docs/en/notifications/on-call-rules");
    }
  });
});
