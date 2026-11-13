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
  /*
   * What a person types into Search, and the page it should offer: by its
   * title, or by its breadcrumb and title ("Profiles › Overview") where
   * the title alone is every product's.
   */
  search: { query: string; offers: string };
  /*
   * The products menu's entry, by its title's key, that finds the product
   * by its old name.
   */
  product?: { titleKey: string; keyword: string } | undefined;
  // What the glossary term says about it: the old name, or the new one.
  glossaryMentions: string;
  /*
   * What a person types into the docs' search, and a result it must give
   * among the first ten: the page, or the glossary term that says what the
   * thing is called now and links to the page (`linksTo`).
   */
  docs: { query: string; opens: string; linksTo?: string | undefined };
}

const FINDABLE: Record<string, Findable> = {
  "On-Call Duty": {
    search: { query: "on-call duty policies", offers: "On-Call Policies" },
    product: {
      titleKey: "navbar.items.onCallDutyTitle",
      keyword: "on-call duty",
    },
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
      linksTo: "/docs/en/notifications/on-call-rules",
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
  "Performance Profiles": {
    search: { query: "performance profiles", offers: "Profiles › Overview" },
    product: {
      titleKey: "navbar.items.performanceProfilesTitle",
      keyword: "performance profiles",
    },
    glossaryMentions: "Performance Profiles",
    // The page no longer says "performance": its glossary term is found.
    docs: {
      query: "performance profiles",
      opens: "/docs/en/introduction/glossary#profiles",
      linksTo: "/docs/en/telemetry/profiles",
    },
  },
  Profiler: {
    search: { query: "profiler", offers: "Profiles › Overview" },
    product: {
      titleKey: "navbar.items.performanceProfilesTitle",
      keyword: "profiler",
    },
    glossaryMentions: "Profiler",
    docs: { query: "profiler", opens: "/docs/en/telemetry/profiles" },
  },
  "Continuous Profiling": {
    search: { query: "continuous profiling", offers: "Profiles › Overview" },
    product: {
      titleKey: "navbar.items.performanceProfilesTitle",
      keyword: "continuous profiling",
    },
    glossaryMentions: "Continuous Profiling",
    docs: {
      query: "continuous profiling",
      opens: "/docs/en/telemetry/profiles",
    },
  },
  "Exception Tracking": {
    search: { query: "exception tracking", offers: "Exceptions" },
    product: {
      titleKey: "navbar.items.exceptionsTitle",
      keyword: "exception tracking",
    },
    glossaryMentions: "Exception Tracking",
    // The page no longer says "tracking": its glossary term is found.
    docs: {
      query: "exception tracking",
      opens: "/docs/en/introduction/glossary#exception",
      linksTo: "/docs/en/telemetry/exceptions",
    },
  },
  /*
   * A monitor's Criteria are a page of each monitor, which Search does not
   * list: the old name offers the monitors, one click from it.
   */
  "Monitor Criteria": {
    search: { query: "monitor criteria", offers: "All Monitors" },
    glossaryMentions: "Monitor Criteria",
    docs: {
      query: "monitor criteria",
      opens: "/docs/en/monitor/criteria-and-statuses",
    },
  },
  "Telemetry Ingestion Key": {
    search: { query: "telemetry ingestion keys", offers: "Ingestion Keys" },
    glossaryMentions: "Telemetry Ingestion Key",
    docs: {
      query: "telemetry ingestion key",
      opens: "/docs/en/telemetry/ingestion-keys",
    },
  },
  "Service Catalog": {
    search: { query: "service catalog", offers: "All Services" },
    product: {
      titleKey: "navbar.items.servicesTitle",
      keyword: "service catalog",
    },
    glossaryMentions: "Service Catalog",
    docs: { query: "service catalog", opens: "/docs/en/telemetry/services" },
  },
  "Telemetry Service": {
    search: { query: "telemetry services", offers: "All Services" },
    product: {
      titleKey: "navbar.items.servicesTitle",
      keyword: "telemetry services",
    },
    glossaryMentions: "Telemetry Service",
    docs: { query: "telemetry service", opens: "/docs/en/telemetry/services" },
  },
  "Scheduled Maintenance Event": {
    search: {
      query: "scheduled maintenance events",
      offers: "All Maintenance Events",
    },
    product: {
      titleKey: "navbar.items.scheduledMaintenanceTitle",
      keyword: "scheduled maintenance events",
    },
    glossaryMentions: "Scheduled Maintenance Event",
    docs: {
      query: "scheduled maintenance event",
      opens: "/docs/en/scheduled-maintenance/index",
    },
  },
  "Scheduled Event": {
    search: { query: "scheduled events", offers: "All Maintenance Events" },
    product: {
      titleKey: "navbar.items.scheduledMaintenanceTitle",
      keyword: "scheduled events",
    },
    glossaryMentions: "Scheduled Event",
    docs: {
      query: "scheduled event",
      opens: "/docs/en/scheduled-maintenance/index",
    },
  },
  /*
   * The page of an event's states, not another name of the event: the
   * glossary's term says the states are maintenance states.
   */
  "Event State": {
    search: { query: "event state", offers: "Maintenance State" },
    glossaryMentions: "Maintenance State",
    docs: {
      query: "event state",
      opens: "/docs/en/scheduled-maintenance/states",
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

// The first five results, each by its title and by its breadcrumb and title.
function offered(query: string): Array<string> {
  return filterPaletteCommands(PAGES, query)
    .slice(0, 5)
    .flatMap((match: PaletteCommandMatch): Array<string> => {
      return [
        match.command.title,
        [...(match.command.breadcrumb || []), match.command.title].join(" › "),
      ];
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

  test.each(
    Object.entries(FINDABLE).filter(
      ([, findable]: [string, Findable]): boolean => {
        return Boolean(findable.product);
      },
    ),
  )(
    "the products menu finds the product %s named",
    (_name: string, findable: Findable) => {
      expect(productKeywords(findable.product!.titleKey)).toContain(
        findable.product!.keyword,
      );
    },
  );

  test("a product's keywords are read from its own entry", () => {
    expect(productKeywords("navbar.items.exceptionsTitle")).toContain(
      "stack traces",
    );
    expect(productKeywords("navbar.items.exceptionsTitle")).not.toContain(
      "flame graph",
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
    /*
     * The old name itself is one of the term's other names: its definition
     * may use the same words as ordinary English ("sent by a profiler"),
     * which says nothing about the Profiler. A term that says what the
     * thing is called now may say it in its definition.
     */
    const where: Array<string> =
      mentions === name
        ? entry?.alsoCalled || []
        : [...(entry?.alsoCalled || []), entry?.definition || ""];

    expect(entry).toBeDefined();
    expect({
      name,
      found: where.some((text: string): boolean => {
        return text.toLowerCase().includes(mentions.toLowerCase());
      }),
    }).toEqual({ name, found: true });
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
    const terms: Array<Findable["docs"]> = Object.values(FINDABLE)
      .map((findable: Findable): Findable["docs"] => {
        return findable.docs;
      })
      .filter((docs: Findable["docs"]): boolean => {
        return docs.opens.includes("/introduction/glossary#");
      });

    expect(
      terms.map((docs: Findable["docs"]): string => {
        return docs.opens.split("/introduction/glossary#")[1] || "";
      }),
    ).toEqual(["how-to-reach-me", "profiles", "exception"]);

    for (const docs of terms) {
      const anchor: string = docs.opens.split("/introduction/glossary#")[1]!;
      const entry: DocsGlossaryEntry | undefined = entries.find(
        (candidate: DocsGlossaryEntry): boolean => {
          return candidate.anchor === anchor;
        },
      );

      expect(docs.linksTo).toBeDefined();
      expect(
        entry?.links.map((link: { url: string }): string => {
          return link.url;
        }),
      ).toContain(docs.linksTo);
    }
  });

  test("a docs result found in a glossary term says which page it stands for", () => {
    for (const findable of Object.values(FINDABLE)) {
      expect({
        opens: findable.docs.opens,
        linksTo: Boolean(findable.docs.linksTo),
      }).toEqual({
        opens: findable.docs.opens,
        linksTo: findable.docs.opens.includes("/introduction/glossary#"),
      });
    }
  });
});
