// UX rule: Docs/ux/README.md#finding-a-page
import {
  buildPageSearchCommandDescriptors,
  englishOfIndexName,
  getPageSearchCommandRanking,
  PageSearchCommandDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getPageSearchAreas,
  PageSearchArea,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MEANING_KEYS,
  withMeaningKeyAsItsWord,
} from "Common/Types/MeaningKeys";
import { Translator } from "Common/Types/Translator";
import { dashboardTranslator } from "Common/Tests/Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * SEARCH FINDS A PAGE BY THE WORDS IT SHOWS, NEVER BY A NOTE TO TRANSLATORS
 * (#8830).
 *
 * Search's index names each page by its locale key, and searches the
 * English behind a translated name so English finds the page in any
 * language. A key that names its meaning is not that English: the Logs,
 * Metrics, Traces and Exceptions explorers' tab is "Insights (explorer
 * analytics)", which English draws as "Insights" (Common/Types/
 * MeaningKeys, #8629). Searched as written, "analytics" and "explorer
 * analytics" listed the four tabs first, in every language, for words no
 * one ever reads on the page. Each English name Search searches is now the
 * English the Dashboard draws, as Ask AI's page catalog reads it (#8817).
 */

const AREAS: Array<PageSearchArea> = getPageSearchAreas();

const TAB_KEY: string = "Insights (explorer analytics)";

const EXPLORER_TABS: ReadonlyArray<{ area: string; page: PageMap }> = [
  { area: "Logs", page: PageMap.LOGS_INSIGHTS },
  { area: "Metrics", page: PageMap.METRICS_INSIGHTS },
  { area: "Traces", page: PageMap.TRACES_INSIGHTS },
  { area: "Exceptions", page: PageMap.EXCEPTIONS_OVERVIEW },
];

const routeOf: (key: string) => string = (key: string): string => {
  return `/dashboard/:projectId/${key.toLowerCase()}`;
};

// Search's results in a language, as the palette builds them (DashboardCommandPalette).
const describeIn: (
  translator: Translator,
  areas?: ReadonlyArray<PageSearchArea>,
) => Array<PageSearchCommandDescriptor> = (
  translator: Translator,
  areas: ReadonlyArray<PageSearchArea> = AREAS,
): Array<PageSearchCommandDescriptor> => {
  return buildPageSearchCommandDescriptors({
    areas,
    availability: {
      isBillingEnabled: true,
      isMonitorGroupsEnabled: true,
      canDeleteProject: true,
    },
    getRouteTemplate: routeOf,
    getRoutePath: (key: string): string => {
      return routeOf(key).replace(":projectId", "project-a");
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    translate: (text: string): string => {
      return translator.translateText(text) || text;
    },
    catalog: [],
  });
};

const toCommands: (
  descriptors: Array<PageSearchCommandDescriptor>,
) => Array<PaletteCommand> = (
  descriptors: Array<PageSearchCommandDescriptor>,
): Array<PaletteCommand> => {
  return descriptors.map(
    (descriptor: PageSearchCommandDescriptor): PaletteCommand => {
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
    },
  );
};

// The route paths Search offers for `query`, best first.
const found: (
  query: string,
  descriptors: Array<PageSearchCommandDescriptor>,
) => Array<string> = (
  query: string,
  descriptors: Array<PageSearchCommandDescriptor>,
): Array<string> => {
  const byId: Map<string, string> = new Map<string, string>(
    descriptors.map((descriptor: PageSearchCommandDescriptor) => {
      return [descriptor.id, descriptor.routePath];
    }),
  );

  return filterPaletteCommands(toCommands(descriptors), query).map(
    (match: PaletteCommandMatch): string => {
      return byId.get(match.command.id) || "";
    },
  );
};

const tabPath: (page: PageMap) => string = (page: PageMap): string => {
  return routeOf(page).replace(":projectId", "project-a");
};

const LANGUAGES: ReadonlyArray<string> = ["en", "es", "de", "ja"];

const DESCRIPTORS: Map<string, Array<PageSearchCommandDescriptor>> = new Map(
  LANGUAGES.map((language: string) => {
    return [language, describeIn(dashboardTranslator(language))];
  }),
);

const descriptorsIn: (
  language: string,
) => Array<PageSearchCommandDescriptor> = (
  language: string,
): Array<PageSearchCommandDescriptor> => {
  return DESCRIPTORS.get(language)!;
};

const tabIn: (
  language: string,
  page: PageMap,
) => PageSearchCommandDescriptor = (
  language: string,
  page: PageMap,
): PageSearchCommandDescriptor => {
  return descriptorsIn(language).find(
    (descriptor: PageSearchCommandDescriptor): boolean => {
      return descriptor.routePath === tabPath(page) && !descriptor.isSetting;
    },
  )!;
};

// Every text Search searches a result by and never shows.
const searchedNotShown: (
  descriptor: PageSearchCommandDescriptor,
) => Array<string> = (
  descriptor: PageSearchCommandDescriptor,
): Array<string> => {
  return [...descriptor.titleAliases, ...descriptor.breadcrumbKeywords];
};

const NOTES: ReadonlyArray<string> = MEANING_KEYS.map((key: string): string => {
  return key.slice(withMeaningKeyAsItsWord(key).length).trim();
});

describe("englishOfIndexName", () => {
  test("reads a key that names its meaning as its word, and any other name as it is", () => {
    expect(englishOfIndexName(TAB_KEY)).toBe("Insights");
    expect(englishOfIndexName("Table (database object)")).toBe("Table");
    expect(englishOfIndexName("Insights")).toBe("Insights");
    expect(englishOfIndexName("OpenID Connect (OIDC)")).toBe(
      "OpenID Connect (OIDC)",
    );
  });
});

describe("what Search searches and never shows is the English the Dashboard draws (#8830)", () => {
  test.each(LANGUAGES)(
    "in %s no English alias or place it searches is a key that names its meaning, nor holds a note to translators",
    (language: string) => {
      const leaks: Array<string> = descriptorsIn(language).flatMap(
        (descriptor: PageSearchCommandDescriptor): Array<string> => {
          return searchedNotShown(descriptor)
            .filter((text: string): boolean => {
              return (
                MEANING_KEYS.includes(text) ||
                NOTES.some((note: string): boolean => {
                  return text.includes(note);
                })
              );
            })
            .map((text: string): string => {
              return `${descriptor.routePath}: ${text}`;
            });
        },
      );

      expect(leaks).toEqual([]);
    },
  );

  test.each(EXPLORER_TABS)(
    "in English the $area tab reads Insights, and searches no other English behind it",
    (explorer: { area: string; page: PageMap }) => {
      const tab: PageSearchCommandDescriptor = tabIn("en", explorer.page);

      expect(tab.title).toBe("Insights");
      expect(tab.titleAliases).toEqual([]);
      expect(tab.breadcrumbKeywords).toEqual([explorer.area]);
    },
  );

  test.each(EXPLORER_TABS)(
    "in Spanish the $area tab reads Análisis, and English finds it by Insights",
    (explorer: { area: string; page: PageMap }) => {
      const tab: PageSearchCommandDescriptor = tabIn("es", explorer.page);

      expect(tab.title).toBe("Análisis");
      expect(tab.titleAliases).toEqual(["Insights"]);
    },
  );

  test.each(LANGUAGES)(
    'in %s "explorer analytics" and "analytics" find none of the four tabs',
    (language: string) => {
      for (const query of ["explorer analytics", "analytics"]) {
        const results: Array<string> = found(query, descriptorsIn(language));

        for (const explorer of EXPLORER_TABS) {
          expect(results).not.toContain(tabPath(explorer.page));
        }
      }
    },
  );

  test.each(LANGUAGES)(
    'in %s "insights" still finds every tab, and "logs insights" the Logs tab first',
    (language: string) => {
      const results: Array<string> = found("insights", descriptorsIn(language));

      for (const explorer of EXPLORER_TABS) {
        expect(results).toContain(tabPath(explorer.page));
      }

      expect(found("logs insights", descriptorsIn(language))[0]).toBe(
        tabPath(PageMap.LOGS_INSIGHTS),
      );
    },
  );

  test('"log explorer" finds the Logs viewer first, and no Insights tab by the note\'s "explorer"', () => {
    const results: Array<string> = found("log explorer", descriptorsIn("en"));

    expect(results[0]).toBe(tabPath(PageMap.LOGS));
    expect(results).not.toContain(tabPath(PageMap.LOGS_INSIGHTS));
  });

  test("an action and a setting on a page named by such a key search its word as their place, and their own English", () => {
    const area: PageSearchArea = {
      id: "example",
      title: "Data Observability",
      icon: IconProp.Database,
      iconColor: "text-gray-500",
      sections: [
        {
          title: "Table (database object)",
          pages: [
            {
              page: PageMap.LOGS_INSIGHTS,
              title: "View (database object)",
              actions: [
                {
                  id: "example-change",
                  title: "Change (schema change)",
                },
              ],
              settings: ["Test (environment)"],
            },
          ],
        },
      ],
    };
    const english: Array<PageSearchCommandDescriptor> = describeIn(
      dashboardTranslator("en"),
      [area],
    );

    expect(
      english.map((descriptor: PageSearchCommandDescriptor) => {
        return {
          title: descriptor.title,
          titleAliases: descriptor.titleAliases,
          breadcrumbKeywords: descriptor.breadcrumbKeywords,
        };
      }),
    ).toEqual([
      {
        title: "View",
        titleAliases: [],
        breadcrumbKeywords: ["Data Observability", "Table"],
      },
      {
        title: "Change",
        titleAliases: [],
        breadcrumbKeywords: ["Data Observability", "Table", "View"],
      },
      {
        title: "Test",
        titleAliases: [],
        breadcrumbKeywords: ["Data Observability", "Table", "View"],
      },
    ]);

    // Shown in German, searched by the English the Dashboard draws.
    for (const descriptor of describeIn(dashboardTranslator("de"), [area])) {
      for (const text of searchedNotShown(descriptor)) {
        expect(MEANING_KEYS).not.toContain(text);
      }
    }
  });
});
