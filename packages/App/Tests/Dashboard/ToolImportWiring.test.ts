/*
 * The page's API module reads the browser's config and API clients when it
 * loads. Nothing here calls anything, so they are empty stand-ins.
 */
jest.mock("Common/UI/Config", () => {
  return { __esModule: true, APP_API_URL: "", DOCS_URL: "" };
});
jest.mock("Common/UI/Utils/API/API", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: {} };
});

import {
  buildPageSearchCommandDescriptors,
  getPageSearchCommandRanking,
  getPageSearchIndexEntries,
  PageSearchCommandDescriptor,
  PageSearchIndexEntry,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getPageSearchAreas,
  PageSearchArea,
  PageSearchPage,
  PageSearchSection,
  TOOL_IMPORT_FOUND_ONLY_BY_WHOLE_NAME,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import { TOOL_IMPORT_ROUTES } from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportApi";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Project Settings > Advanced > Import from another tool is one page reached
 * four ways - the Settings side menu, its URL, the breadcrumb and Cmd+K - and it talks
 * to one API that a worker finishes the work of. The App suite runs in a
 * plain Node environment with no renderer, so nothing else notices a route
 * never registered, a menu entry that 404s, a search that cannot find the
 * page by a tool's name, or a call the page makes to a path the server does
 * not serve. These read the sources, the way the other *Wiring tests do.
 */

const APP_DIR: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_DIR: string = path.join(APP_DIR, "..", "Common");

const PAGE_ID: string = "SETTINGS_IMPORT_FROM_TOOL";
const PAGE_TITLE: string = "Import from another tool";

const WHITESPACE: RegExp = /\s+/g;
const NOT_A_LETTER: RegExp = /[^a-z]+/;
// 'title: "Labels"' - a section's or a link's title, as a side menu writes it.
const MENU_TITLE: RegExp = /title: "([^"]+)"/g;
const RUN_ID: string = "run-id";

/*
 * Tools Search finds only by their whole name (the tests below hold each one
 * to its reason): "incident.io" offers the import from it, "incident" never
 * does (#7034). A tool added later is found by any start of its name unless
 * it is listed here.
 */
const FOUND_ONLY_BY_WHOLE_NAME: Set<ToolImportSource> =
  new Set<ToolImportSource>([ToolImportSource.IncidentIo]);

const SEARCH_AREAS: Array<PageSearchArea> = getPageSearchAreas();
const SEARCH_ENTRIES: Array<PageSearchIndexEntry> =
  getPageSearchIndexEntries(SEARCH_AREAS);

// The Dashboard's German words, keyed by the English text, as Search reads them.
const GERMAN: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "de.json"), "utf8"),
) as Record<string, unknown>;

type TranslateFunction = (text: string) => string;

// Search's pages, as Cmd+K lists them (DashboardCommandPalette) in a language.
function searchPagesIn(translate: TranslateFunction): Array<PaletteCommand> {
  return buildPageSearchCommandDescriptors({
    areas: SEARCH_AREAS,
    availability: {
      isBillingEnabled: true,
      isMonitorGroupsEnabled: true,
      canDeleteProject: true,
    },
    getRouteTemplate: (key: string): string => {
      return `/dashboard/:projectId/${key.toLowerCase()}`;
    },
    getRoutePath: (key: string): string => {
      return `/dashboard/project/${key.toLowerCase()}`;
    },
    getProductTitle: (): undefined => {
      return undefined;
    },
    translate,
    catalog: [],
  }).map((descriptor: PageSearchCommandDescriptor): PaletteCommand => {
    return {
      id: descriptor.id,
      title: descriptor.title,
      titleAliases: descriptor.titleAliases,
      keywords: descriptor.keywords,
      breadcrumb: descriptor.breadcrumb,
      breadcrumbKeywords: descriptor.breadcrumbKeywords,
      category: "Pages",
      // Ranked as the palette ranks it (DashboardCommandPalette).
      ...getPageSearchCommandRanking(descriptor),
      onSelect: (): void => {},
    };
  });
}

const SEARCH_PAGES: Array<PaletteCommand> = searchPagesIn(
  (text: string): string => {
    return text;
  },
);

// The same pages for a reader who has the Dashboard in German.
const GERMAN_SEARCH_PAGES: Array<PaletteCommand> = searchPagesIn(
  (text: string): string => {
    const german: unknown = GERMAN[text];

    return typeof german === "string" && german ? german : text;
  },
);

// The first page Search lists for the query, with where it lives.
function firstFound(
  query: string,
  pages: Array<PaletteCommand> = SEARCH_PAGES,
): string {
  const match: PaletteCommandMatch | undefined = filterPaletteCommands(
    pages,
    query,
  )[0];

  return match
    ? `${match.command.title} — ${(match.command.breadcrumb || []).join(" › ")}`
    : "";
}

/*
 * Whitespace squashed, so a check does not depend on how a line wraps.
 * Comments are kept: route strings such as `/incidents/*` would read as one.
 */
function readCode(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8").replace(WHITESPACE, " ");
}

function readDashboard(relativePath: string): string {
  return readCode(path.join(DASHBOARD_SRC, ...relativePath.split("/")));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

// The titles a stretch of a side menu's source writes, in order.
function titlesIn(source: string): Array<string> {
  return Array.from(source.matchAll(MENU_TITLE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The titles of a Search section's pages, in order.
function pageTitlesOf(section: PageSearchSection | undefined): Array<string> {
  return (section?.pages || []).map((page: PageSearchPage): string => {
    return page.title;
  });
}

describe("the page is reachable", () => {
  test("it has a page id, and its path sits under Project Settings", () => {
    const routeMap: string = readDashboard("Utils/RouteMap.ts");

    expect(readDashboard("Utils/PageMap.ts")).toContain(
      `${PAGE_ID} = "${PAGE_ID}"`,
    );
    expect(
      between(routeMap, "export const SettingsRoutePath", "export const "),
    ).toContain(`[PageMap.${PAGE_ID}]: "import"`);
    expect(
      between(routeMap, `[PageMap.${PAGE_ID}]: new Route(`, "),"),
    ).toContain(
      `\`/dashboard/\${RouteParams.ProjectID}/settings/\${ SettingsRoutePath[PageMap.${PAGE_ID}] }\``,
    );
  });

  test("the settings router loads the page lazily and registers it under its route", () => {
    const routes: string = readDashboard("Routes/SettingsRoutes.tsx");

    expect(routes).toContain('import("../Pages/Settings/ImportFromTool")');
    expect(routes).toContain(
      `path={RouteUtil.getLastPathForKey(PageMap.${PAGE_ID})}`,
    );
    expect(routes).toContain(
      `pageRoute={RouteMap[PageMap.${PAGE_ID}] as Route}`,
    );
  });

  test("it has a breadcrumb", () => {
    expect(
      between(
        readDashboard("Utils/Breadcrumbs/SettingsBreadcrumbs.ts"),
        `BuildBreadcrumbLinksByTitles(PageMap.${PAGE_ID}, [`,
        "])",
      ),
    ).toContain(`"Project", "Settings", "${PAGE_TITLE}",`);
  });

  /*
   * "This should be in the advanced section in the side menu." (the
   * maintainer). A project brings its team over once, when it starts, so
   * the page waits in Advanced - folded until it is opened, and open by
   * itself on the page - last, after the settings people come back to.
   * Basic keeps the project itself and its labels.
   */
  test("the Settings side menu lists it last under Advanced, with its icon, and no longer under Basic", () => {
    const menu: string = readDashboard("Pages/Settings/SideMenu.tsx");
    const basic: string = between(menu, 'title: "Basic"', 'title: "Workspace"');
    const advanced: string = between(
      menu,
      'title: "Advanced"',
      'title: "Security"',
    );

    // Products, the products the project shows, joined Basic (#6814).
    expect(titlesIn(basic)).toEqual(["Basic", "Project", "Products", "Labels"]);
    expect(basic).not.toContain(`PageMap.${PAGE_ID}]`);

    expect(titlesIn(advanced)).toEqual([
      "Advanced",
      "Domains",
      "API Keys",
      PAGE_TITLE,
    ]);

    /*
     * Its own entry, up to where the section's items end: the route and the
     * icon it had in Basic, and nothing after it.
     */
    const entry: string = between(advanced, `title: "${PAGE_TITLE}"`, "], },");

    expect(titlesIn(entry)).toEqual([PAGE_TITLE]);
    expect(entry).toContain(`RouteMap[PageMap.${PAGE_ID}] as Route`);
    expect(entry.endsWith("icon: IconProp.InboxArrowDown, }, ")).toBe(true);
  });

  /*
   * The menu draws a title on one line and ends what does not fit with an
   * ellipsis (192px beside the icon on a desktop). German puts the verb
   * last, so "Aus einem anderen Tool importieren" (258px in the marked row)
   * lost the verb: "Aus einem anderen Tool ...", the only language whose cut
   * took the action away. German names the page with the noun instead, as
   * the import's own German text does ("Der Import aus {{tool}} ist
   * abgeschlossen"), and fits; its docs write the label the same way
   * (ProjectSettingsMenuPathsDocs holds each language's docs to its
   * Dashboard's words).
   */
  test("German names the page so the menu shows it whole: 'Import aus anderem Tool'", () => {
    expect(GERMAN[PAGE_TITLE]).toBe("Import aus anderem Tool");
    expect(GERMAN["The import from {{tool}} is done"]).toBe(
      "Der Import aus {{tool}} ist abgeschlossen",
    );
  });

  /*
   * Search reads a page by its title in the reader's language, its English
   * title and its (English) keywords. With the Dashboard in German, the
   * words someone moving over types still open the page first: the noun on
   * the menu, "import" (German and English alike), a tool's name.
   */
  test("with the Dashboard in German, Search still opens it first for the words someone moving over types", () => {
    for (const query of [
      "import",
      "import aus anderem tool",
      "anderem tool",
      "import from another tool",
      "migration",
    ]) {
      expect({ query, first: firstFound(query, GERMAN_SEARCH_PAGES) }).toEqual({
        query,
        first: "Import aus anderem Tool — Projekteinstellungen › Erweitert",
      });
    }

    // A tool's name finds the import from that tool, in German too (#6809).
    for (const [query, tool] of [
      ["opsgenie", "Opsgenie"],
      ["pagerduty", "PagerDuty"],
      ["uptime kuma", "Uptime Kuma"],
      ["import from pagerduty", "PagerDuty"],
      ["import aus pagerduty", "PagerDuty"],
    ] as Array<[string, string]>) {
      expect({ query, first: firstFound(query, GERMAN_SEARCH_PAGES) }).toEqual({
        query,
        first: `Import aus ${tool} — Projekteinstellungen › Erweitert › Import aus anderem Tool`,
      });
    }
  });

  test("the page is linked from one place in the menu, and Advanced is not told to stay open for it", () => {
    const menu: string = readDashboard("Pages/Settings/SideMenu.tsx");

    expect(menu.split(`RouteMap[PageMap.${PAGE_ID}]`)).toHaveLength(2);
    // Advanced folds by its title (SideMenuSectionState), and opens by itself on its pages.
    expect(
      between(menu, 'title: "Advanced"', "items:").includes("defaultCollapsed"),
    ).toBe(false);
  });

  test("Cmd+K lists it last under Project Settings > Advanced, as the side menu does, and no longer under Basic", () => {
    const entry: PageSearchIndexEntry | undefined = SEARCH_ENTRIES.find(
      (candidate: PageSearchIndexEntry): boolean => {
        return candidate.page.page === PAGE_ID;
      },
    );

    expect(entry?.page.title).toBe(PAGE_TITLE);
    expect(entry?.area.id).toBe("project-settings");
    expect(entry?.section.title).toBe("Advanced");
    expect(pageTitlesOf(entry?.section)).toEqual([
      "Domains",
      "API Keys",
      PAGE_TITLE,
    ]);

    const basic: PageSearchSection | undefined = SEARCH_AREAS.find(
      (area: PageSearchArea): boolean => {
        return area.id === "project-settings";
      },
    )?.sections.find((section: PageSearchSection): boolean => {
      return section.title === "Basic";
    });

    expect(pageTitlesOf(basic)).toEqual(["Project", "Products", "Labels"]);
    expect(
      SEARCH_ENTRIES.filter((candidate: PageSearchIndexEntry): boolean => {
        return candidate.page.page === PAGE_ID;
      }),
    ).toHaveLength(1);
  });

  test("its breadcrumb names the page, as every other Advanced page's does", () => {
    const breadcrumbs: string = readDashboard(
      "Utils/Breadcrumbs/SettingsBreadcrumbs.ts",
    );

    for (const [page, title] of [
      ["SETTINGS_DOMAINS", "Domains"],
      ["SETTINGS_APIKEYS", "API Keys"],
      [PAGE_ID, PAGE_TITLE],
    ] as Array<[string, string]>) {
      const opening: string = `BuildBreadcrumbLinksByTitles(PageMap.${page}, [`;

      expect({
        page,
        titles: between(breadcrumbs, opening, "])")
          .slice(opening.length)
          .trim(),
      }).toEqual({ page, titles: `"Project", "Settings", "${title}",` });
    }
  });

  test("Cmd+K opens it first for the words someone moving over types", () => {
    for (const query of [
      "import",
      "migrate",
      "migration",
      "move to oneuptime",
    ]) {
      expect({ query, first: firstFound(query) }).toEqual({
        query,
        first: `${PAGE_TITLE} — Project Settings › Advanced`,
      });
    }
  });

  /*
   * "Search finds it by the tool's name" (#6809): typing the tool a team is
   * leaving offers "Import from PagerDuty" first, on the importer's page,
   * and the page itself right after it.
   */
  test("Cmd+K offers 'Import from <tool>' first for each tool's name, incident.io's too", () => {
    for (const source of AllToolImportSources) {
      const title: string = getToolImportSourceDefinition(source).title;

      for (const query of [
        title,
        title.toLowerCase(),
        `import from ${title}`,
      ]) {
        expect({ query, first: firstFound(query) }).toEqual({
          query,
          first: `Import from ${title} — Project Settings › Advanced › ${PAGE_TITLE}`,
        });
      }
    }
  });

  /*
   * The tools' names start like words OneUptime's own pages go by: "pager"
   * (On-Call Policies), "uptime" (the website guided setup). Those still
   * open OneUptime's own pages first; the import from a tool comes after
   * them.
   */
  test("a word that starts a tool's name but that OneUptime's own pages go by still opens those pages first", () => {
    expect(firstFound("pager")).toMatch(/^On-Call Policies — /);

    for (const query of ["pag", "status", "on call", "oncall", "on-call"]) {
      expect({ query, first: firstFound(query) }).toEqual({
        query,
        first: expect.not.stringMatching(/^Import from /),
      });
    }

    /*
     * "uptime" is a keyword of the website guided setup (#6804), found by
     * what people come to do: it opens first, and the imports from
     * UptimeRobot and Uptime Kuma, which it no longer names alone, come
     * right after it.
     */
    expect(
      filterPaletteCommands(SEARCH_PAGES, "uptime")
        .slice(0, 3)
        .map((match: PaletteCommandMatch): string => {
          return match.command.title;
        }),
    ).toEqual([
      "Know when my website or API is down",
      "Import from UptimeRobot",
      "Import from Uptime Kuma",
    ]);
  });

  test("a word no page of OneUptime's own goes by, but a tool's name starts with, finds the imports from those tools, as it found the importer before", () => {
    expect(firstFound("ping")).toBe(
      `Import from Pingdom — Project Settings › Advanced › ${PAGE_TITLE}`,
    );
  });

  test("a tool's other names find the import from it", () => {
    for (const [query, tool] of [
      ["victorops", "Splunk On-Call"],
      ["grafana irm", "Grafana OnCall"],
      ["uptime robot", "UptimeRobot"],
      ["betterstack", "Better Stack"],
      ["statuspage.io", "Atlassian Statuspage"],
    ] as Array<[string, string]>) {
      expect({ query, first: firstFound(query) }).toEqual({
        query,
        first: `Import from ${tool} — Project Settings › Advanced › ${PAGE_TITLE}`,
      });
    }
  });

  test("each 'Import from <tool>' opens the importer on that tool's connect step, saying it came from Search", () => {
    const descriptors: Array<PageSearchCommandDescriptor> =
      buildPageSearchCommandDescriptors({
        areas: SEARCH_AREAS,
        availability: {
          isBillingEnabled: true,
          isMonitorGroupsEnabled: true,
          canDeleteProject: true,
        },
        getRouteTemplate: (key: string): string => {
          return `/dashboard/:projectId/${key.toLowerCase()}`;
        },
        getRoutePath: (key: string): string => {
          return `/dashboard/project/${key.toLowerCase()}`;
        },
        getProductTitle: (): undefined => {
          return undefined;
        },
        translate: (text: string): string => {
          return text;
        },
        catalog: [],
      }).filter((descriptor: PageSearchCommandDescriptor): boolean => {
        return (
          descriptor.title.startsWith("Import from ") && descriptor.isAction
        );
      });

    // Every tool, incident.io too (#7034).
    const expected: Array<ToolImportSource> = AllToolImportSources;

    expect(
      descriptors.map((descriptor: PageSearchCommandDescriptor) => {
        return [descriptor.title, descriptor.routePath, descriptor.icon];
      }),
    ).toEqual(
      expected.map((source: ToolImportSource) => {
        return [
          `Import from ${getToolImportSourceDefinition(source).title}`,
          `/dashboard/project/${PAGE_ID.toLowerCase()}?from=search&tool=${source}`,
          "InboxArrowDown",
        ];
      }),
    );
    // Each remembered by Search's recents under an id of its own.
    expect(
      new Set(
        descriptors.map((descriptor: PageSearchCommandDescriptor) => {
          return descriptor.id;
        }),
      ).size,
    ).toBe(expected.length);
  });

  /*
   * incident.io's name starts with Incidents' word, so its import is found
   * only by its whole name (#7034): "incident.io", written any way, offers
   * it first; "incident" and "incidents" still open Incidents' own pages,
   * and never list it at all.
   */
  test("Search holds exactly these tools to their whole name", () => {
    expect(new Set(TOOL_IMPORT_FOUND_ONLY_BY_WHOLE_NAME)).toEqual(
      FOUND_ONLY_BY_WHOLE_NAME,
    );
  });

  test("'incident.io', 'incidentio' and other near-exact forms offer 'Import from incident.io' first", () => {
    for (const query of [
      "incident.io",
      "incidentio",
      "incident io",
      "Incident.IO",
      " incident.io ",
      "incident-io",
      "import from incident.io",
      "import incident.io",
      "incident.io import",
    ]) {
      expect({ query, first: firstFound(query) }).toEqual({
        query,
        first: `Import from incident.io — Project Settings › Advanced › ${PAGE_TITLE}`,
      });
    }

    // In German too, by the tool's own name.
    expect(firstFound("incident.io", GERMAN_SEARCH_PAGES)).toBe(
      "Import aus incident.io — Projekteinstellungen › Erweitert › Import aus anderem Tool",
    );
  });

  test("'incident', 'incidents' and the rest of Incidents' words never list the import, so Incidents' pages come first", () => {
    for (const query of [
      "incident",
      "incidents",
      "Incident",
      "inc",
      "incident settings",
      "incident custom fields",
      "incidnet",
      "incident i",
      "incident.i",
      "incidentio2",
    ]) {
      const titles: Array<string> = filterPaletteCommands(
        SEARCH_PAGES,
        query,
      ).map((match: PaletteCommandMatch): string => {
        return match.command.title;
      });

      expect({
        query,
        listsTheImport: titles.includes("Import from incident.io"),
      }).toEqual({ query, listsTheImport: false });
    }

    expect(firstFound("incident settings")).not.toContain("Import from");
    expect(firstFound("incident")).not.toContain("Import from");
    expect(firstFound("incidents")).not.toContain("Import from");
  });

  test("the importer's own words still open the importer, not the import from incident.io", () => {
    expect(firstFound("import")).toBe(
      `${PAGE_TITLE} — Project Settings › Advanced`,
    );
  });

  /*
   * A tool is held to its whole name only when another product's pages
   * start with its first word: "incident.io" would otherwise come before
   * Incidents' pages for "incident settings", and for the "incidnet" typo
   * Getting Started promises opens Incidents. Each name listed has to be
   * one of those, so no tool gives up being found by the start of its name
   * for nothing.
   */
  test("a tool is found only by its whole name only when another product's pages start with its first word", () => {
    for (const source of FOUND_ONLY_BY_WHOLE_NAME) {
      const firstWord: string = getToolImportSourceDefinition(source)
        .title.toLowerCase()
        .split(NOT_A_LETTER)[0]!;

      expect({
        source,
        clashes: SEARCH_ENTRIES.some((entry: PageSearchIndexEntry): boolean => {
          return (
            entry.area.id !== "project-settings" &&
            entry.page.title.toLowerCase().startsWith(firstWord)
          );
        }),
      }).toEqual({ source, clashes: true });
    }
  });
});

describe("the page and the server agree", () => {
  const api: string = readCode(
    path.join(COMMON_DIR, "Server", "API", "ToolImportAPI.ts"),
  );

  function serves(method: "get" | "post", route: string): boolean {
    return api.includes(`router.${method}( "${route}",`);
  }

  test("every call the page makes is a route the import API serves, by the same method", () => {
    const toServerRoute: (route: string) => string = (
      route: string,
    ): string => {
      return route.replace(RUN_ID, ":runId");
    };

    expect(serves("get", TOOL_IMPORT_ROUTES.runs)).toBe(true);
    expect(serves("post", TOOL_IMPORT_ROUTES.read)).toBe(true);
    // An uptime tool's file (Uptime Kuma) is read from an upload.
    expect(serves("post", TOOL_IMPORT_ROUTES.upload)).toBe(true);
    expect(serves("get", toServerRoute(TOOL_IMPORT_ROUTES.run(RUN_ID)))).toBe(
      true,
    );
    expect(
      serves("post", toServerRoute(TOOL_IMPORT_ROUTES.start(RUN_ID))),
    ).toBe(true);
    expect(
      serves("post", toServerRoute(TOOL_IMPORT_ROUTES.cancel(RUN_ID))),
    ).toBe(true);
    // The check itself tells a served route from one that is not.
    expect(serves("post", TOOL_IMPORT_ROUTES.runs)).toBe(false);
  });

  test("a run id is escaped into the path, never pasted", () => {
    expect(TOOL_IMPORT_ROUTES.run("a/../b")).toBe(
      "/tool-import/run/a%2F..%2Fb",
    );
  });

  test("the API is mounted, and the worker runs the import and sweeps stale ones", () => {
    const baseApi: string = readCode(
      path.join(APP_DIR, "FeatureSet", "BaseAPI", "Index.ts"),
    );
    const workers: string = readCode(
      path.join(APP_DIR, "FeatureSet", "Workers", "Index.ts"),
    );

    expect(baseApi).toContain(
      'import ToolImportAPI from "Common/Server/API/ToolImportAPI";',
    );
    expect(baseApi).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, ToolImportAPI);",
    );
    expect(workers).toContain('import "./Jobs/ToolImport/RunToolImport";');
    expect(workers).toContain(
      'import "./Jobs/ToolImport/SweepStaleToolImports";',
    );
  });
});
