import {
  buildPageSearchCommandDescriptors,
  fillPageSearchTitle,
  PageSearchAvailability,
  PageSearchCommandDescriptor,
  PALETTE_LIST_CREATE_ACTIONS,
  PaletteListCreateAction,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { getPageSearchAreas } from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import RouteMap from "../../FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import { isDashboardRouteTemplate } from "../../FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import Route from "Common/Types/API/Route";
import { CREATE_FORM_QUERY_STRING } from "Common/Types/CreateFormAddress";
import DashboardPageFinder, {
  AI_DASHBOARD_PAGES,
  AIDashboardPage,
  AIDashboardPageKind,
} from "Common/Server/Utils/AI/Docs/DashboardPageFinder";
import {
  MEANING_KEYS,
  withMeaningKeyAsItsWord,
} from "Common/Types/MeaningKeys";
import { createTranslator, Translator } from "Common/Types/Translator";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI'S LIST OF THE DASHBOARD'S PAGES IS SEARCH'S OWN (issue #6828).
 *
 * find_dashboard_page reads Common's DashboardPages.json, which the server
 * can read without the Dashboard's code. It is generated here from the page
 * index Search reads (PageSearchIndex.ts, held to the menus and RouteMap by
 * their own suites), so a page Search offers is a page Ask AI can send
 * someone to, under the same name, and nothing else. Run this suite with
 * UPDATE_AI_DASHBOARD_PAGES=1 to write the file again after the index
 * changes.
 *
 * The index names its pages by their locale keys, and a key that names its
 * meaning is not its English: the explorers' tab is "Insights (explorer
 * analytics)", which English draws as "Insights" (Common/Types/MeaningKeys,
 * #8629). The catalog is the model's, so it is written in the English the
 * Dashboard draws, and such a key is kept in titleKey for the "Go to ..."
 * button alone. Written with the key as its title, the model read the note
 * to translators, and "Traces Insights" ranked the tab third (#8817).
 */

/*
 * RouteMap fills in the current project from the browser's address
 * (Common/UI/Utils/Project); these read its route templates only.
 */
jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

const CATALOG_PATH: string = path.resolve(
  __dirname,
  "../../../Common/Server/Utils/AI/Docs/DashboardPages.json",
);

const PROJECT_PLACEHOLDER: string = "__project__";

const getTemplate: (key: string) => string | undefined = (
  key: string,
): string | undefined => {
  const route: Route | undefined = RouteMap[key];
  return route ? route.toString() : undefined;
};

const describeIndex: (
  availability: PageSearchAvailability,
) => Array<PageSearchCommandDescriptor> = (
  availability: PageSearchAvailability,
): Array<PageSearchCommandDescriptor> => {
  return buildPageSearchCommandDescriptors({
    areas: getPageSearchAreas(),
    availability,
    getRouteTemplate: getTemplate,
    getRoutePath: (key: string): string | undefined => {
      return getTemplate(key)?.replace(":projectId", PROJECT_PLACEHOLDER);
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    // The index's own keys: each is read below as English draws it.
    translate: (text: string): string => {
      return text;
    },
    catalog: [],
  });
};

interface TitledByKey {
  title: string;
  titleKey?: string;
  titleValues?: Record<string, string>;
}

/*
 * A page's title as the model reads it, from the key the index names it
 * by: the English the Dashboard draws ("Insights"), and the key itself
 * only where it is not that English ("Insights (explorer analytics)"),
 * for the button and the chip that draw it in the reader's language. A
 * template keeps what fills it too: "Import from {{tool}}" with { tool:
 * "PagerDuty" } is "Import from PagerDuty" to the model (#8834).
 */
const titledByKey: (
  key: string,
  values?: Record<string, string> | undefined,
) => TitledByKey = (
  key: string,
  values?: Record<string, string> | undefined,
): TitledByKey => {
  const title: string = fillPageSearchTitle(
    withMeaningKeyAsItsWord(key),
    values,
  );

  if (title === key) {
    return { title };
  }

  return values && Object.keys(values).length > 0
    ? { title, titleKey: key, titleValues: { ...values } }
    : { title, titleKey: key };
};

// Texts the model reads, as English draws them: where a page is, its other names.
const asEnglishDraws: (keys: ReadonlyArray<string>) => Array<string> = (
  keys: ReadonlyArray<string>,
): Array<string> => {
  return keys.map(withMeaningKeyAsItsWord);
};

// What the catalog should hold: every page Search offers everyone, and the billing pages marked.
const deriveCatalog: () => Array<AIDashboardPage> =
  (): Array<AIDashboardPage> => {
    const everyone: Array<PageSearchCommandDescriptor> = describeIndex({
      isBillingEnabled: false,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    });
    const withBilling: Array<PageSearchCommandDescriptor> = describeIndex({
      isBillingEnabled: true,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    });
    const offeredToEveryone: Set<string> = new Set<string>(
      everyone.map((descriptor: PageSearchCommandDescriptor): string => {
        return descriptor.id;
      }),
    );

    return withBilling.map(
      (descriptor: PageSearchCommandDescriptor): AIDashboardPage => {
        return {
          ...titledByKey(descriptor.titleKey, descriptor.titleValues),
          where: asEnglishDraws(descriptor.breadcrumb),
          ...(descriptor.keywords.length > 0
            ? { keywords: asEnglishDraws(descriptor.keywords) }
            : {}),
          path: descriptor.routePath.replace(PROJECT_PLACEHOLDER, ":projectId"),
          kind: descriptor.isAction
            ? AIDashboardPageKind.Action
            : descriptor.isSetting
              ? AIDashboardPageKind.Setting
              : AIDashboardPageKind.Page,
          ...(offeredToEveryone.has(descriptor.id) ? {} : { billing: true }),
        };
      },
    );
  };

/*
 * The pages Search's own actions open to create something (Declare
 * Incident, Create Monitor: DashboardCommandPalette's actions), which the
 * page index leaves to them. The first thing a newcomer asks how to do.
 */
const CREATE_PAGES: Array<{
  title: string;
  where: Array<string>;
  keywords: Array<string>;
  page: PageMap;
}> = [
  {
    title: "Declare Incident",
    where: ["Incidents"],
    keywords: ["create incident", "new incident", "report outage"],
    page: PageMap.INCIDENT_CREATE,
  },
  {
    title: "Create Monitor",
    where: ["Monitors"],
    keywords: ["new monitor", "add monitor", "uptime check", "website check"],
    page: PageMap.MONITOR_CREATE,
  },
  {
    title: "Create Alert",
    where: ["Alerts"],
    keywords: ["new alert", "add alert"],
    page: PageMap.ALERT_CREATE,
  },
  /*
   * Named as its page's own button and the docs name it, a key every
   * language words: Search's action says "Create Scheduled Maintenance"
   * under a nested key no flat lookup reads (#8834), which still finds it.
   */
  {
    title: "Create Maintenance Event",
    where: ["Scheduled Maintenance"],
    keywords: [
      "create scheduled maintenance",
      "schedule maintenance",
      "new maintenance",
      "downtime window",
      "planned maintenance",
    ],
    page: PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
  },
  {
    title: "Create Announcement",
    where: ["Status Pages"],
    keywords: ["new announcement", "status page announcement", "post update"],
    page: PageMap.ANNOUNCEMENT_CREATE,
  },
];

/*
 * The lists' create forms Search opens (#7035): Create Status Page, Create
 * On-Call Policy, Create On-Call Schedule, Create Dashboard, Create Workflow
 * and Invite User, each its list's address with ?create=1, which opens the
 * form as the list's Create button does. Read from Search's own list
 * (PALETTE_LIST_CREATE_ACTIONS), so the two never part.
 */
const LIST_CREATE_PAGES: Array<AIDashboardPage> =
  PALETTE_LIST_CREATE_ACTIONS.map(
    (action: PaletteListCreateAction): AIDashboardPage => {
      return {
        ...titledByKey(action.title),
        where: asEnglishDraws(action.where),
        keywords: asEnglishDraws(action.keywords),
        path: `${getTemplate(action.page)!}${CREATE_FORM_QUERY_STRING}`,
        kind: AIDashboardPageKind.Action,
      };
    },
  );

const DERIVED: Array<AIDashboardPage> = [
  ...CREATE_PAGES.map(
    (createPage: {
      title: string;
      where: Array<string>;
      keywords: Array<string>;
      page: PageMap;
    }): AIDashboardPage => {
      return {
        ...titledByKey(createPage.title),
        where: asEnglishDraws(createPage.where),
        keywords: asEnglishDraws(createPage.keywords),
        path: getTemplate(createPage.page)!,
        kind: AIDashboardPageKind.Action,
      };
    },
  ),
  ...LIST_CREATE_PAGES,
  ...deriveCatalog(),
];

if (process.env["UPDATE_AI_DASHBOARD_PAGES"] === "1") {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(DERIVED, null, 2)}\n`);
}

const routeOf: (page: AIDashboardPage) => string = (
  page: AIDashboardPage,
): string => {
  return page.path.split(/[?#]/)[0]!;
};

describe("Ask AI's catalog of the Dashboard's pages", () => {
  test("is the page index Search reads, as generated from it (run with UPDATE_AI_DASHBOARD_PAGES=1 to write it again)", () => {
    expect(AI_DASHBOARD_PAGES.length).toBeGreaterThan(300);
    expect(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))).toEqual(DERIVED);
  });

  test("every page in it opens one of the Dashboard's own routes, in the project, and nothing a route still waits a value for", () => {
    const templates: Set<string> = new Set<string>(
      Object.values(RouteMap).map((route: Route): string => {
        return route.toString();
      }),
    );

    for (const page of AI_DASHBOARD_PAGES) {
      expect(templates.has(routeOf(page))).toBe(true);
      expect(isDashboardRouteTemplate(page.path)).toBe(true);
      expect(routeOf(page).replace(":projectId", "")).not.toContain(":");
    }
  });

  test("marks the pages only OneUptime Cloud's billing shows, and offers them nowhere else", () => {
    const billing: Array<AIDashboardPage> = AI_DASHBOARD_PAGES.filter(
      (page: AIDashboardPage): boolean => {
        return Boolean(page.billing);
      },
    );

    expect(billing.length).toBeGreaterThan(0);

    for (const page of billing) {
      const found: Array<AIDashboardPage> = DashboardPageFinder.find({
        query: `${page.where.join(" ")} ${page.title}`,
        limit: 50,
        isBillingEnabled: false,
      });
      expect(found).not.toContain(page);
    }
  });

  test("leaves out what only some may do, and pages behind a project's flag", () => {
    const titles: Array<string> = AI_DASHBOARD_PAGES.map(
      (page: AIDashboardPage): string => {
        return page.title;
      },
    );

    /*
     * The action is left out. Its page, named for it since #9134, is a
     * page anyone may open: it says why the button is locked.
     */
    expect(
      titles.filter((title: string): boolean => {
        return title === "Delete Project";
      }),
    ).toHaveLength(1);
    expect(
      AI_DASHBOARD_PAGES.filter((page: AIDashboardPage): boolean => {
        return page.title === "Delete Project";
      }).map((page: AIDashboardPage): string => {
        return page.kind;
      }),
    ).toEqual(["page"]);
    expect(
      AI_DASHBOARD_PAGES.filter((page: AIDashboardPage): boolean => {
        return page.path.includes("monitor-groups");
      }),
    ).toEqual([]);
  });

  test("finds each of the pages a newcomer asks about by the name the menus give it", () => {
    const expectations: Array<{ query: string; path: string }> = [
      {
        query: "Create Monitor",
        path: "/dashboard/:projectId/monitors/create",
      },
      {
        query: "Notification Methods",
        path: "/dashboard/:projectId/user-settings/notification-methods",
      },
      {
        query: "Phone Numbers for SMS Notifications",
        path: "/dashboard/:projectId/user-settings/notification-methods",
      },
      {
        query: "Declare Incident",
        path: "/dashboard/:projectId/incidents/create",
      },
      { query: "API Keys", path: "/dashboard/:projectId/settings/api-keys" },
      {
        query: "On-Call Policies",
        path: "/dashboard/:projectId/on-call-duty/policies",
      },
      { query: "Status Pages", path: "/dashboard/:projectId/status-pages" },
      // As its page's own button and the docs name it, and as Search's action does (#8834).
      {
        query: "Create Maintenance Event",
        path: "/dashboard/:projectId/scheduled-maintenance-events/create",
      },
      {
        query: "Create Scheduled Maintenance",
        path: "/dashboard/:projectId/scheduled-maintenance-events/create",
      },
      {
        query: "Import from PagerDuty",
        path: "/dashboard/:projectId/settings/import",
      },
    ];

    for (const expectation of expectations) {
      const found: Array<AIDashboardPage> = DashboardPageFinder.find({
        query: expectation.query,
        limit: 1,
        isBillingEnabled: true,
      });
      expect(found[0]?.path.split("?")[0]).toBe(expectation.path);
    }
  });

  /*
   * Ask AI's "how do I create a status page?" ends with a button that opens
   * the form itself (#7035): the list with ?create=1, for each list Search
   * opens a create form on.
   */
  test("finds each list's create form by its name, and opens it on its list with ?create=1", () => {
    const expectations: Array<{ query: string; path: string }> = [
      {
        query: "Create Status Page",
        path: "/dashboard/:projectId/status-pages?create=1",
      },
      {
        query: "Create On-Call Policy",
        path: "/dashboard/:projectId/on-call-duty/policies?create=1",
      },
      {
        query: "Create On-Call Schedule",
        path: "/dashboard/:projectId/on-call-duty/schedules?create=1",
      },
      {
        query: "Create Dashboard",
        path: "/dashboard/:projectId/dashboards?create=1",
      },
      {
        query: "Create Workflow",
        path: "/dashboard/:projectId/workflows?create=1",
      },
      {
        query: "Invite User",
        path: "/dashboard/:projectId/users?create=1",
      },
    ];

    for (const expectation of expectations) {
      expect({
        query: expectation.query,
        path: DashboardPageFinder.find({
          query: expectation.query,
          limit: 1,
          isBillingEnabled: true,
        })[0]?.path,
      }).toEqual(expectation);
    }

    // The lists themselves are still found by their names.
    expect(
      DashboardPageFinder.find({
        query: "Status Pages",
        limit: 1,
        isBillingEnabled: true,
      })[0]?.path,
    ).toBe("/dashboard/:projectId/status-pages");
  });

  /*
   * Search offers the import from incident.io by its whole name (#7034), so
   * Ask AI can send someone there too. Incidents' own words still find
   * Incidents' pages: the import is never the page asked for by them.
   */
  test("finds the import from incident.io by the tool's name, and Incidents' pages by Incidents' words", () => {
    for (const query of ["Import from incident.io", "incident.io"]) {
      expect(
        DashboardPageFinder.find({
          query,
          limit: 1,
          isBillingEnabled: true,
        })[0]?.path,
      ).toBe(
        "/dashboard/:projectId/settings/import?from=search&tool=IncidentIo",
      );
    }

    for (const query of ["incidents", "incident", "Incidents"]) {
      expect({
        query,
        first: DashboardPageFinder.find({
          query,
          limit: 1,
          isBillingEnabled: true,
        })[0]?.title,
      }).toEqual({ query, first: expect.not.stringMatching(/^Import from/) });
    }
  });
});

/*
 * WHAT THE MODEL READS IS THE ENGLISH THE DASHBOARD DRAWS (#8817).
 *
 * A page's title, where it is and its other names are what
 * find_dashboard_page searches and tells the model (DocsTools): each is
 * read here by an English translator over the Dashboard's own en.json, as
 * the Dashboard draws English, and must read as itself. A locale key that
 * English draws otherwise - a key that names its meaning, read as its word
 * (MeaningKeys), or a key whose English value is other words - is a text
 * the model would read as the reader never sees it.
 */

const ENGLISH_WORDS: Record<string, string> = readDashboardLocale("en");

const ENGLISH: Translator = createTranslator(
  (text: string): string | undefined => {
    return Object.prototype.hasOwnProperty.call(ENGLISH_WORDS, text)
      ? ENGLISH_WORDS[text]
      : undefined;
  },
  "en",
);

const MEANING_KEY_SET: ReadonlySet<string> = new Set<string>(MEANING_KEYS);

interface ModelReadText {
  field: "title" | "where" | "keywords";
  text: string;
}

// Every text of a page the model reads, or the finder searches it by.
const modelReadTextsOf: (page: AIDashboardPage) => Array<ModelReadText> = (
  page: AIDashboardPage,
): Array<ModelReadText> => {
  return [
    { field: "title", text: page.title },
    ...page.where.map((text: string): ModelReadText => {
      return { field: "where", text };
    }),
    ...(page.keywords || []).map((text: string): ModelReadText => {
      return { field: "keywords", text };
    }),
  ];
};

/*
 * Each text of `pages` the model reads that English draws as other words,
 * as "<path> <field>: <text> -> <English>", and each titleKey that is not
 * a key English draws as its page's title.
 */
const findTextsNotAsEnglishDraws: (
  pages: ReadonlyArray<AIDashboardPage>,
  english: Translator,
) => Array<string> = (
  pages: ReadonlyArray<AIDashboardPage>,
  english: Translator,
): Array<string> => {
  const findings: Array<string> = [];

  for (const page of pages) {
    for (const { field, text } of modelReadTextsOf(page)) {
      const drawn: string | undefined = english.translateText(text);

      if (MEANING_KEY_SET.has(text) || drawn !== text) {
        findings.push(`${page.path} ${field}: ${text} -> ${drawn}`);
      }
    }

    if (page.titleKey !== undefined) {
      // A template, filled with what fills it (#8834).
      const drawn: string | undefined = page.titleValues
        ? english.translateTemplate(page.titleKey, page.titleValues)
        : english.translateText(page.titleKey);

      if (page.titleKey === page.title || drawn !== page.title) {
        findings.push(
          `${page.path} titleKey: ${page.titleKey} -> ${drawn}, not its title ${page.title}`,
        );
      }
    }
  }

  return findings;
};

const TAB_KEY: string = "Insights (explorer analytics)";

interface ExplorerInsights {
  area: string;
  // The explorer's tab that counts and charts what came in.
  tab: string;
  // OneUptime AI's findings, in the same section.
  aiInsights: string;
}

const EXPLORER_INSIGHTS: ReadonlyArray<ExplorerInsights> = [
  {
    area: "Logs",
    tab: "/dashboard/:projectId/logs/insights",
    aiInsights: "/dashboard/:projectId/logs/ai/insights",
  },
  {
    area: "Metrics",
    tab: "/dashboard/:projectId/metrics/insights",
    aiInsights: "/dashboard/:projectId/metrics/ai/insights",
  },
  {
    area: "Traces",
    tab: "/dashboard/:projectId/traces/insights",
    aiInsights: "/dashboard/:projectId/traces/ai/insights",
  },
  {
    area: "Exceptions",
    tab: "/dashboard/:projectId/exceptions/overview",
    aiInsights: "/dashboard/:projectId/exceptions/ai/insights",
  },
];

const pageAt: (pathOfPage: string) => AIDashboardPage = (
  pathOfPage: string,
): AIDashboardPage => {
  const page: AIDashboardPage | undefined = AI_DASHBOARD_PAGES.find(
    (candidate: AIDashboardPage): boolean => {
      return candidate.path === pathOfPage;
    },
  );

  if (!page) {
    throw new Error(`No page of the catalog opens ${pathOfPage}`);
  }

  return page;
};

const pathsFoundFor: (query: string, limit: number) => Array<string> = (
  query: string,
  limit: number,
): Array<string> => {
  return DashboardPageFinder.find({
    query,
    limit,
    isBillingEnabled: true,
  }).map((page: AIDashboardPage): string => {
    return page.path;
  });
};

describe("what the model reads of the catalog is the English the Dashboard draws (#8817)", () => {
  test("no title, place or other name of a page is a locale key English draws as other words", () => {
    expect(findTextsNotAsEnglishDraws(AI_DASHBOARD_PAGES, ENGLISH)).toEqual([]);
  });

  test("nor is any text the generator writes, so writing the file again keeps it so", () => {
    expect(findTextsNotAsEnglishDraws(DERIVED, ENGLISH)).toEqual([]);
  });

  test("no text the model reads holds a note to translators", () => {
    const notes: Array<string> = MEANING_KEYS.map((key: string): string => {
      return key.slice(withMeaningKeyAsItsWord(key).length).trim();
    });

    expect(notes).toContain("(explorer analytics)");

    const withANote: Array<string> = AI_DASHBOARD_PAGES.flatMap(
      (page: AIDashboardPage): Array<string> => {
        return modelReadTextsOf(page)
          .filter(({ text }: ModelReadText): boolean => {
            return notes.some((note: string): boolean => {
              return text.includes(note);
            });
          })
          .map(({ text }: ModelReadText): string => {
            return `${page.path}: ${text}`;
          });
      },
    );

    expect(withANote).toEqual([]);
  });

  test("the guard finds a key read as its word, wherever the model would read it, and a key whose English is other words", () => {
    const page: AIDashboardPage = {
      title: "Insights",
      where: ["Logs"],
      path: "/dashboard/:projectId/logs/insights",
      kind: AIDashboardPageKind.Page,
    };
    const renamed: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Retired Name" ? "Current Name" : text;
      },
      "en",
    );

    expect(findTextsNotAsEnglishDraws([page], ENGLISH)).toEqual([]);
    expect(
      findTextsNotAsEnglishDraws([{ ...page, title: TAB_KEY }], ENGLISH),
    ).toEqual([`${page.path} title: ${TAB_KEY} -> Insights`]);
    expect(
      findTextsNotAsEnglishDraws(
        [{ ...page, where: ["Data Observability", "Table (database object)"] }],
        ENGLISH,
      ),
    ).toEqual([`${page.path} where: Table (database object) -> Table`]);
    expect(
      findTextsNotAsEnglishDraws(
        [{ ...page, keywords: ["View (database object)", "log patterns"] }],
        ENGLISH,
      ),
    ).toEqual([`${page.path} keywords: View (database object) -> View`]);
    expect(
      findTextsNotAsEnglishDraws([{ ...page, title: "Retired Name" }], renamed),
    ).toEqual([`${page.path} title: Retired Name -> Current Name`]);
  });

  test("the guard finds a titleKey that is no key of the page's title", () => {
    const page: AIDashboardPage = {
      title: "Insights",
      titleKey: TAB_KEY,
      where: ["Logs"],
      path: "/dashboard/:projectId/logs/insights",
      kind: AIDashboardPageKind.Page,
    };

    expect(findTextsNotAsEnglishDraws([page], ENGLISH)).toEqual([]);
    expect(
      findTextsNotAsEnglishDraws(
        [{ ...page, titleKey: "Table (database object)" }],
        ENGLISH,
      ),
    ).toEqual([
      `${page.path} titleKey: Table (database object) -> Table, not its title Insights`,
    ]);
    expect(
      findTextsNotAsEnglishDraws([{ ...page, titleKey: "Insights" }], ENGLISH),
    ).toEqual([
      `${page.path} titleKey: Insights -> Insights, not its title Insights`,
    ]);
  });

  test("a titleKey is a key of the Dashboard's locales that names its meaning, or a template its titleValues fill, kept only where it is not the title", () => {
    const keyed: Array<AIDashboardPage> = AI_DASHBOARD_PAGES.filter(
      (page: AIDashboardPage): boolean => {
        return page.titleKey !== undefined;
      },
    );

    expect(keyed.length).toBeGreaterThan(0);

    for (const page of keyed) {
      expect(Object.keys(ENGLISH_WORDS)).toContain(page.titleKey);
      expect(page.titleKey).not.toBe(page.title);

      if (page.titleValues) {
        expect(page.titleKey).toMatch(/\{\{\w+\}\}/);
        expect(fillPageSearchTitle(page.titleKey!, page.titleValues)).toBe(
          page.title,
        );
      } else {
        expect(MEANING_KEY_SET.has(page.titleKey!)).toBe(true);
        expect(withMeaningKeyAsItsWord(page.titleKey!)).toBe(page.title);
      }
    }

    // No page keeps values without a template to fill.
    expect(
      AI_DASHBOARD_PAGES.filter((page: AIDashboardPage): boolean => {
        return page.titleValues !== undefined && page.titleKey === undefined;
      }),
    ).toEqual([]);
  });

  test.each(EXPLORER_INSIGHTS)(
    "the $area explorer's Insights tab is titled Insights for the model, with the tab's own key for its button",
    (explorer: ExplorerInsights) => {
      expect(pageAt(explorer.tab)).toEqual(
        expect.objectContaining({
          title: "Insights",
          titleKey: TAB_KEY,
          where: [explorer.area],
          kind: AIDashboardPageKind.Page,
        }),
      );
    },
  );

  test.each(EXPLORER_INSIGHTS)(
    "OneUptime AI's own $area Insights page keeps the bare Insights, as its key and its English",
    (explorer: ExplorerInsights) => {
      const page: AIDashboardPage = pageAt(explorer.aiInsights);

      expect(page.title).toBe("Insights");
      expect(page.titleKey).toBeUndefined();
      expect(page.where).toEqual([explorer.area, "AI"]);
    },
  );

  test.each(EXPLORER_INSIGHTS)(
    "\"$area Insights\" finds its section's AI Insights page, then the explorer's tab, second, as before #8629",
    (explorer: ExplorerInsights) => {
      expect(pathsFoundFor(`${explorer.area} Insights`, 2)).toEqual([
        explorer.aiInsights,
        explorer.tab,
      ]);
    },
  );

  test("\"Traces Insights\" ranks the Traces explorer's tab second again, not third behind Exceptions' AI Insights", () => {
    const found: Array<string> = pathsFoundFor("Traces Insights", 5);

    expect(found.indexOf("/dashboard/:projectId/traces/insights")).toBe(1);
    expect(found.indexOf("/dashboard/:projectId/exceptions/ai/insights")).toBe(
      2,
    );
  });

  test("the tab's other names still find it first", () => {
    expect(pathsFoundFor("top errors", 1)).toEqual([
      "/dashboard/:projectId/logs/insights",
    ]);
    expect(pathsFoundFor("log patterns", 1)).toEqual([
      "/dashboard/:projectId/logs/insights",
    ]);
    expect(pathsFoundFor("error trends", 1)).toEqual([
      "/dashboard/:projectId/exceptions/overview",
    ]);
  });

  test("the note to translators finds nothing: no page is found by words no one reads", () => {
    for (const query of ["explorer analytics", "analytics"]) {
      const found: Array<string> = pathsFoundFor(query, 10);

      for (const explorer of EXPLORER_INSIGHTS) {
        expect(found).not.toContain(explorer.tab);
      }
    }
  });

  test("the generator reads a key that names its meaning as its word, and keeps the key", () => {
    expect(titledByKey(TAB_KEY)).toEqual({
      title: "Insights",
      titleKey: TAB_KEY,
    });
    expect(titledByKey("Notification Methods")).toEqual({
      title: "Notification Methods",
    });
    // A bracket that is part of the name is no meaning key: read whole.
    expect(titledByKey("OpenID Connect (OIDC)")).toEqual({
      title: "OpenID Connect (OIDC)",
    });
    // A template: filled for the model, kept with its values for the button (#8834).
    expect(titledByKey("Import from {{tool}}", { tool: "PagerDuty" })).toEqual({
      title: "Import from PagerDuty",
      titleKey: "Import from {{tool}}",
      titleValues: { tool: "PagerDuty" },
    });
    expect(titledByKey("Import from {{tool}}", {})).toEqual({
      title: "Import from {{tool}}",
    });
    expect(
      asEnglishDraws(["Data Observability", "Table (database object)"]),
    ).toEqual(["Data Observability", "Table"]);
  });

  test("every page Search's index titles by a meaning key or a template is written with its English title and that key, and only those keep a key", () => {
    const keyedInIndex: Array<{ path: string; key: string }> = describeIndex({
      isBillingEnabled: true,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    })
      .filter((descriptor: PageSearchCommandDescriptor): boolean => {
        return (
          MEANING_KEY_SET.has(descriptor.titleKey) ||
          descriptor.titleValues !== undefined
        );
      })
      .map(
        (
          descriptor: PageSearchCommandDescriptor,
        ): { path: string; key: string } => {
          return {
            path: descriptor.routePath.replace(
              PROJECT_PLACEHOLDER,
              ":projectId",
            ),
            key: descriptor.titleKey,
          };
        },
      );

    // The four explorers' tabs are among them (#8629).
    expect(
      keyedInIndex.map((entry: { path: string }): string => {
        return entry.path;
      }),
    ).toEqual(
      expect.arrayContaining(
        EXPLORER_INSIGHTS.map((explorer: ExplorerInsights): string => {
          return explorer.tab;
        }),
      ),
    );

    expect(
      DERIVED.filter((page: AIDashboardPage): boolean => {
        return page.titleKey !== undefined;
      }).map((page: AIDashboardPage): { path: string; key: string } => {
        return { path: page.path, key: page.titleKey! };
      }),
    ).toEqual(keyedInIndex);

    for (const page of DERIVED) {
      if (page.titleKey !== undefined) {
        expect(page.title).toBe(
          fillPageSearchTitle(
            withMeaningKeyAsItsWord(page.titleKey),
            page.titleValues,
          ),
        );
      }
    }
  });
});

/*
 * EVERY PAGE OF THE CATALOG CAN BE CITED (#8829), AND ITS CHIP SAID IN THE
 * READER'S LANGUAGE (#8831).
 *
 * find_dashboard_page's citation opens the first page it finds, and two
 * pages may share a name in one area: no name alone put the Traces or
 * Metrics explorer's Insights tab first. Asked by a page's title and its
 * place, as a result gives them, the tool finds only the pages there - so
 * every page of the catalog is the first of the call that names it so.
 *
 * The chip names the page by its place and name, each looked up by the key
 * the Dashboard's menus use: the catalog's places, and its titleKey or
 * title. A place keeps no key of its own, so none may be a key that names
 * its meaning; and each is a key the Dashboard's locales word.
 */

describe("every page of the catalog can be cited, and named in the reader's language (#8829, #8831)", () => {
  test("each is the first page found by its title and its place, as a result gives them", () => {
    const missed: Array<string> = AI_DASHBOARD_PAGES.filter(
      (page: AIDashboardPage): boolean => {
        const found: AIDashboardPage | undefined = DashboardPageFinder.find({
          query: page.title,
          place: page.where.join(" > "),
          limit: 1,
          isBillingEnabled: true,
        })[0];

        return found !== page;
      },
    ).map((page: AIDashboardPage): string => {
      return `${page.where.join(" > ")} > ${page.title} (${page.path})`;
    });

    expect(missed).toEqual([]);
  });

  test("no two pages share both a title and a place, so a title and a place name one page", () => {
    const named: Map<string, number> = new Map<string, number>();

    for (const page of AI_DASHBOARD_PAGES) {
      const name: string = `${page.where.join(" > ")} > ${page.title}`;
      named.set(name, (named.get(name) || 0) + 1);
    }

    expect(
      [...named.entries()].filter((entry: [string, number]): boolean => {
        return entry[1] > 1;
      }),
    ).toEqual([]);
  });

  test.each(EXPLORER_INSIGHTS)(
    "the $area explorer's Insights tab is cited by Insights in $area, and OneUptime AI's by Insights in $area > AI",
    (explorer: ExplorerInsights) => {
      const cite: (place: string) => string | undefined = (
        place: string,
      ): string | undefined => {
        return DashboardPageFinder.find({
          query: "Insights",
          place,
          limit: 1,
          isBillingEnabled: true,
        })[0]?.path;
      };

      expect(cite(explorer.area)).toBe(explorer.tab);
      expect(cite(`${explorer.area} > AI`)).toBe(explorer.aiInsights);
    },
  );

  test("no place in Search's index is a key that names its meaning: a place keeps no key of its own beside it", () => {
    const keyedPlaces: Array<string> = describeIndex({
      isBillingEnabled: true,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    }).flatMap((descriptor: PageSearchCommandDescriptor): Array<string> => {
      return descriptor.breadcrumb.filter((name: string): boolean => {
        return MEANING_KEY_SET.has(name);
      });
    });

    expect(keyedPlaces).toEqual([]);
  });

  test("every name a page's button and chip draw is a key the Dashboard's locales hold: none is drawn as English it cannot look up (#8834)", () => {
    const unknown: Set<string> = new Set<string>();

    for (const page of [...AI_DASHBOARD_PAGES, ...DERIVED]) {
      for (const name of [...page.where, page.titleKey ?? page.title]) {
        if (!Object.prototype.hasOwnProperty.call(ENGLISH_WORDS, name)) {
          unknown.add(name);
        }
      }
    }

    expect([...unknown]).toEqual([]);
  });
});
