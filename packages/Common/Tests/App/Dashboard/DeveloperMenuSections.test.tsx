import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import { matchRoutes } from "react-router-dom";
import Models from "../../../Models/DatabaseModels/Index";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import { getTerraformTypeName } from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { CLOSING_SECTION_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsMenuSection";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  allLinks,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * "Can we create a new page for terraform / infra as code in every resource
 * of the project ... Maybe this should all be in "Docs" section in the side
 * menu which should be collapsed by default. Maybe this should be on the
 * list page as well along with view page?" (the maintainer)
 *
 * Every resource's view menu in the Dashboard (a menu that takes the id of
 * the resource it belongs to) is found on disk and rendered. Each has a
 * Developer section, collapsed by default, with Terraform, API and AI
 * Assistants pages of its own resource, placed before the section that
 * holds its Delete page; or it is listed below, with the reason it has none.
 * Every list page that has Developer pages has them in its product menu,
 * every Developer page has a route, a route-file entry and breadcrumbs, and
 * every resource named in the registry is a real model in the public API.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Resource view menus with no Developer section, and why. Anything else that
 * takes a resource id gets one.
 */
const VIEW_MENUS_WITHOUT_DEVELOPER_PAGES: Readonly<Record<string, string>> = {
  "Pages/AIAgentTasks/View/SideMenu.tsx":
    "An AI agent's task run: the agent creates it, and it is not configuration anyone manages.",
  "Pages/AIInsights/View/SideMenu.tsx":
    "An AI insight is written by OneUptime AI; the API cannot create one, so there is nothing to manage as code.",
  "Pages/Exceptions/View/SideMenu.tsx":
    "An exception is grouped from telemetry, not set up by anyone.",
  "Pages/Users/View/SideMenu.tsx":
    "A project member: people are invited, not managed as a resource.",
  "Pages/StatusPages/View/AnnouncementSideMenu.tsx":
    "Rendered by no layout: an announcement's pages use Pages/StatusPages/AnnouncementSideMenu.tsx, which has the section.",
};

const RENDERS_SIDE_MENU: RegExp =
  /from\s+"Common\/UI\/Components\/SideMenu\/SideMenu"/;

// A resource's view menu takes the id of the resource it belongs to.
const TAKES_MODEL_ID: RegExp = /modelId:\s*ObjectID/;

function sourceFilesUnder(dir: string, extension: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(entryPath, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}

interface MenuModule {
  // Relative to Dashboard/src, e.g. "Pages/Workflow/View/SideMenu.tsx".
  name: string;
  file: string;
  isViewMenu: boolean;
}

const MENU_MODULES: ReadonlyArray<MenuModule> = sourceFilesUnder(
  DASHBOARD_SRC,
  ".tsx",
)
  .filter((file: string): boolean => {
    return (
      path.basename(file).endsWith("SideMenu.tsx") &&
      RENDERS_SIDE_MENU.test(fs.readFileSync(file, "utf8"))
    );
  })
  .map((file: string): MenuModule => {
    return {
      name: path.relative(DASHBOARD_SRC, file).split(path.sep).join("/"),
      file,
      isViewMenu: TAKES_MODEL_ID.test(fs.readFileSync(file, "utf8")),
    };
  })
  .sort((a: MenuModule, b: MenuModule): number => {
    return a.name.localeCompare(b.name);
  });

const VIEW_MENUS: ReadonlyArray<MenuModule> = MENU_MODULES.filter(
  (menu: MenuModule): boolean => {
    return menu.isViewMenu;
  },
);

const VIEW_MENUS_WITH_DEVELOPER_PAGES: ReadonlyArray<MenuModule> =
  VIEW_MENUS.filter((menu: MenuModule): boolean => {
    return !VIEW_MENUS_WITHOUT_DEVELOPER_PAGES[menu.name];
  });

const LIST_MENUS: ReadonlyArray<MenuModule> = MENU_MODULES.filter(
  (menu: MenuModule): boolean => {
    return !menu.isViewMenu;
  },
);

const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-000000000007");

const MENU_PROPS: Record<string, unknown> = {
  modelId: MODEL_ID,
  monitorType: MonitorType.Website,
};

const PROJECT_HOME: string = `/dashboard/${PROJECT_ID}`;

async function renderMenuModuleAt(
  menu: MenuModule,
  currentPath: string,
): Promise<void> {
  const MenuComponent: FunctionComponent<Record<string, unknown>> = (
    jest.requireActual(menu.file) as {
      default: FunctionComponent<Record<string, unknown>>;
    }
  ).default;

  goTo(currentPath);
  await renderMenu(<MenuComponent {...MENU_PROPS} />);
}

function developerHref(parent: DeveloperDocsParentPage, page: DeveloperDocsPageDefinition): string {
  return RouteUtil.populateRouteParams(
    RouteMap[getDeveloperDocsPageKey(parent.pageKey, page.type)] as Route,
    parent.scope === DeveloperDocsScope.View ? { modelId: MODEL_ID } : undefined,
  ).toString();
}

// The parent page a Developer section's links belong to, found from its first href.
function parentOfSection(links: Array<MenuLink>): DeveloperDocsParentPage | undefined {
  return DEVELOPER_DOCS_PARENT_PAGES.find(
    (parent: DeveloperDocsParentPage): boolean => {
      return (
        developerHref(parent, DEVELOPER_DOCS_PAGES[0] as DeveloperDocsPageDefinition) ===
        links[0]?.href
      );
    },
  );
}

function expectedSectionLinks(parent: DeveloperDocsParentPage): Array<MenuLink> {
  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): MenuLink => {
      return { title: page.title, href: developerHref(parent, page) };
    },
  );
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(PROJECT_HOME);
});

afterEach(() => {
  cleanup();
});

describe("every resource's view menu has a Developer section", () => {
  test.each(
    VIEW_MENUS_WITH_DEVELOPER_PAGES.map(
      (menu: MenuModule): [string, MenuModule] => {
        return [menu.name, menu];
      },
    ),
  )(
    "%s: collapsed, with its own resource's Terraform, API and AI Assistants pages",
    async (_name: string, menu: MenuModule) => {
      await renderMenuModuleAt(menu, PROJECT_HOME);

      const titles: Array<string> = sectionTitlesInOrder();
      expect(titles).toContain(DEVELOPER_DOCS_SECTION_TITLE);

      const links: Array<MenuLink> = linksIn(DEVELOPER_DOCS_SECTION_TITLE);
      const parent: DeveloperDocsParentPage | undefined =
        parentOfSection(links);

      expect({ menu: menu.name, scope: parent?.scope }).toEqual({
        menu: menu.name,
        scope: DeveloperDocsScope.View,
      });
      expect(links).toEqual(expectedSectionLinks(parent!));

      // The pages are this resource's: their parent is one of the menu's own pages.
      const parentHref: string = RouteUtil.populateRouteParams(
        RouteMap[parent!.pageKey] as Route,
        { modelId: MODEL_ID },
      ).toString();
      const otherHrefs: Array<string> = allLinks()
        .filter((link: MenuLink): boolean => {
          return !links.includes(link);
        })
        .map((link: MenuLink): string => {
          return link.href;
        });
      expect(otherHrefs).toContain(parentHref);

      // Collapsed on the menu's first page...
      expect(isExpanded(DEVELOPER_DOCS_SECTION_TITLE)).toBe(false);
      expect(sectionBody(DEVELOPER_DOCS_SECTION_TITLE)).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );

      // ...and before the section that closes the menu, so Delete stays last.
      const index: number = titles.indexOf(DEVELOPER_DOCS_SECTION_TITLE);
      const after: Array<string> = titles.slice(index + 1);
      expect({ menu: menu.name, after }).toEqual({
        menu: menu.name,
        after: after.filter((title: string): boolean => {
          return CLOSING_SECTION_TITLES.includes(title);
        }),
      });
    },
  );

  test.each(
    VIEW_MENUS_WITH_DEVELOPER_PAGES.map(
      (menu: MenuModule): [string, MenuModule] => {
        return [menu.name, menu];
      },
    ),
  )("%s: the section is open on each of its pages", async (_name: string, menu: MenuModule) => {
    await renderMenuModuleAt(menu, PROJECT_HOME);
    const hrefs: Array<string> = linksIn(DEVELOPER_DOCS_SECTION_TITLE).map(
      (link: MenuLink): string => {
        return link.href;
      },
    );
    cleanup();

    for (const href of hrefs) {
      await renderMenuModuleAt(menu, href);
      expect({ href, expanded: isExpanded(DEVELOPER_DOCS_SECTION_TITLE) }).toEqual({
        href,
        expanded: true,
      });
      cleanup();
    }
  });

  test("the menus without one are real menus, each with a reason", () => {
    for (const name of Object.keys(VIEW_MENUS_WITHOUT_DEVELOPER_PAGES)) {
      expect(
        VIEW_MENUS.map((menu: MenuModule): string => {
          return menu.name;
        }),
      ).toContain(name);
      expect(VIEW_MENUS_WITHOUT_DEVELOPER_PAGES[name]?.length).toBeGreaterThan(20);
    }
  });

  test("the sweep finds the view menus", () => {
    expect(
      VIEW_MENUS_WITH_DEVELOPER_PAGES.map((menu: MenuModule): string => {
        return menu.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Pages/Workflow/View/SideMenu.tsx",
        "Pages/Monitor/View/SideMenu.tsx",
        "Pages/StatusPages/View/SideMenu.tsx",
        "Pages/Incidents/View/SideMenu.tsx",
        "Pages/Alerts/View/SideMenu.tsx",
        "Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx",
        "Pages/ScheduledMaintenanceEvents/View/SideMenu.tsx",
        "Pages/Teams/View/SideMenu.tsx",
      ]),
    );
    expect(VIEW_MENUS_WITH_DEVELOPER_PAGES.length).toBeGreaterThanOrEqual(35);
  });
});

describe("product menus have a Developer section for their resource", () => {
  test("every list page with Developer pages has them in exactly one product menu, last and collapsed", async () => {
    const found: Array<string> = [];

    for (const menu of LIST_MENUS) {
      await renderMenuModuleAt(menu, PROJECT_HOME);

      const titles: Array<string> = sectionTitlesInOrder();

      if (!titles.includes(DEVELOPER_DOCS_SECTION_TITLE)) {
        cleanup();
        continue;
      }

      const links: Array<MenuLink> = linksIn(DEVELOPER_DOCS_SECTION_TITLE);
      const parent: DeveloperDocsParentPage | undefined =
        parentOfSection(links);

      expect({ menu: menu.name, scope: parent?.scope }).toEqual({
        menu: menu.name,
        scope: DeveloperDocsScope.List,
      });
      expect(links).toEqual(expectedSectionLinks(parent!));
      expect({ menu: menu.name, last: titles[titles.length - 1] }).toEqual({
        menu: menu.name,
        last: DEVELOPER_DOCS_SECTION_TITLE,
      });
      expect(isExpanded(DEVELOPER_DOCS_SECTION_TITLE)).toBe(false);

      found.push(parent!.pageKey);
      cleanup();
    }

    expect(found.sort()).toEqual(
      DEVELOPER_DOCS_PARENT_PAGES.filter(
        (parent: DeveloperDocsParentPage): boolean => {
          return parent.scope === DeveloperDocsScope.List;
        },
      )
        .map((parent: DeveloperDocsParentPage): string => {
          return parent.pageKey;
        })
        .sort(),
    );
  });
});

describe("the registry", () => {
  test("names real models that are in the public API, one parent page per scope", () => {
    const seen: Set<string> = new Set<string>();

    for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
      const modelType: DatabaseBaseModelType | undefined = Models.find(
        (candidate: DatabaseBaseModelType): boolean => {
          return new candidate().tableName === parent.tableName;
        },
      );

      expect({ parent: parent.pageKey, model: Boolean(modelType) }).toEqual({
        parent: parent.pageKey,
        model: true,
      });
      expect(getTerraformTypeName(modelType!)).not.toBeNull();

      const key: string = `${parent.tableName}:${parent.scope}`;
      expect({ key, duplicate: seen.has(key) }).toEqual({
        key,
        duplicate: false,
      });
      seen.add(key);
    }
  });

  test("every resource with a list page has a view page too", () => {
    for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
      if (parent.scope !== DeveloperDocsScope.List) {
        continue;
      }

      expect(
        DEVELOPER_DOCS_PARENT_PAGES.some(
          (candidate: DeveloperDocsParentPage): boolean => {
            return (
              candidate.tableName === parent.tableName &&
              candidate.scope === DeveloperDocsScope.View
            );
          },
        ),
      ).toBe(true);
    }
  });
});

describe("every Developer page has a route and breadcrumbs", () => {
  const routes: Array<{ path: string }> = RouteUtil.getRoutes();

  const pages: Array<[string, DeveloperDocsParentPage, DeveloperDocsPageDefinition]> =
    DEVELOPER_DOCS_PARENT_PAGES.flatMap(
      (
        parent: DeveloperDocsParentPage,
      ): Array<[string, DeveloperDocsParentPage, DeveloperDocsPageDefinition]> => {
        return DEVELOPER_DOCS_PAGES.map(
          (
            page: DeveloperDocsPageDefinition,
          ): [string, DeveloperDocsParentPage, DeveloperDocsPageDefinition] => {
            return [getDeveloperDocsPageKey(parent.pageKey, page.type), parent, page];
          },
        );
      },
    );

  type BreadcrumbsFunction = (path: string) => Array<Link> | undefined;

  const breadcrumbFunctions: Array<BreadcrumbsFunction> = [
    ...sourceFilesUnder(path.join(DASHBOARD_SRC, "Utils", "Breadcrumbs"), ".ts"),
    ...sourceFilesUnder(path.join(DASHBOARD_SRC, "Pages"), "Breadcrumbs.ts"),
  ].flatMap((file: string): Array<BreadcrumbsFunction> => {
    const exported: Record<string, unknown> = jest.requireActual(file) as Record<
      string,
      unknown
    >;

    return Object.keys(exported)
      .filter((name: string): boolean => {
        return /^get\w*Bread[cC]rumbs$/.test(name);
      })
      .map((name: string): BreadcrumbsFunction => {
        return exported[name] as BreadcrumbsFunction;
      });
  });

  test.each(pages)(
    "%s",
    (key: string, parent: DeveloperDocsParentPage, page: DeveloperDocsPageDefinition) => {
      const route: Route | undefined = RouteMap[key];
      expect(route?.toString()).toBe(
        `${(RouteMap[parent.pageKey] as Route).toString()}/developer/${page.type}`,
      );

      // The route table resolves the page's own URL to the page, not to a neighbour.
      const url: string = RouteUtil.populateRouteParams(route as Route, {
        modelId: MODEL_ID,
      }).toString();
      expect(matchRoutes(routes, url)?.[0]?.route.path).toBe(route!.toString());

      const trails: Array<Array<Link>> = breadcrumbFunctions
        .map((getBreadcrumbs: BreadcrumbsFunction): Array<Link> | undefined => {
          return getBreadcrumbs(route!.toString());
        })
        .filter((trail: Array<Link> | undefined): trail is Array<Link> => {
          return Boolean(trail);
        });

      expect({ key, hasBreadcrumbs: trails.length > 0 }).toEqual({
        key,
        hasBreadcrumbs: true,
      });
      expect(trails[0]![trails[0]!.length - 1]?.title).toBe(page.title);
    },
  );
});

describe("every route file shows the Developer pages it has", () => {
  const ROUTE_CALL: RegExp =
    /getDeveloperDocsRoutes\(\{\s*modelType:\s*(\w+),\s*scope:\s*DeveloperDocsScope\.(List|View),/g;

  test("each parent page's routes are in exactly one route file", () => {
    const declared: Array<string> = [];

    for (const file of sourceFilesUnder(path.join(DASHBOARD_SRC, "Routes"), ".tsx")) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(ROUTE_CALL)) {
        const identifier: string = match[1] as string;
        const scope: string = (match[2] as string).toLowerCase();
        const imported: RegExpMatchArray | null = source.match(
          new RegExp(
            `import ${identifier} from "Common/Models/DatabaseModels/(\\w+)";`,
          ),
        );

        expect({ file, identifier, imported: Boolean(imported) }).toEqual({
          file,
          identifier,
          imported: true,
        });
        declared.push(`${imported![1]}:${scope}`);
      }
    }

    expect(declared.sort()).toEqual(
      DEVELOPER_DOCS_PARENT_PAGES.map(
        (parent: DeveloperDocsParentPage): string => {
          return `${parent.tableName}:${parent.scope}`;
        },
      ).sort(),
    );
  });
});
