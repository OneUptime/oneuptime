import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { MoreMenuItem, NavItem } from "../../../UI/Components/Navbar/NavBar";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  goTo,
  linksIn,
  PROJECT_ID,
  renderMenu,
  sectionTitlesInOrder,
} from "./SideMenuHarness";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import { slugifyPaletteCommandId } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * Search (Cmd/Ctrl+K) must find every page a menu links to, by the name the
 * menu gives it, and say where it lives the way the menu does.
 *
 * Search reads its pages from PageSearchIndex.ts, because the menus are
 * React components that load data as they draw. This keeps the two in step:
 * every side menu of the Dashboard is found on disk and drawn for real, and
 * for each page it links to (one that needs no record id) the real palette
 * is opened and the page's menu title typed into it. The page must be among
 * the results, under its menu title, with the menu's section in its
 * breadcrumb.
 *
 * Nothing is listed per menu: a page added to any menu is checked the day
 * it is written, and fails here until PageSearchIndex.ts has it.
 */

jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");

  // The Dashboard's English: nested keys resolve to their words.
  const english: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const translate: (key: string, defaultValue?: unknown) => string = (
    key: string,
    defaultValue?: unknown,
  ): string => {
    if (typeof english[key] === "string") {
      return english[key] as string;
    }

    let value: unknown = english;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        value = undefined;
        break;
      }

      value = (value as Record<string, unknown>)[part];
    }

    if (typeof value === "string") {
      return value;
    }

    return typeof defaultValue === "string" ? defaultValue : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

// Billing pages exist where billing is on: draw them, so they are checked too.
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...actual };

  Object.defineProperty(config, "BILLING_ENABLED", {
    enumerable: true,
    value: true,
  });

  return config;
});

// Badge counts and the palette's record search: nothing open, no network.
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

/*
 * Menu pages Search does not offer, and why. A page here is checked to be
 * left out, so this list cannot go stale.
 */
const PAGES_SEARCH_LEAVES_OUT: Readonly<Partial<Record<PageMap, string>>> = {
  /*
   * "Connect Slack or Teams": shown while a project has no chat tool yet.
   * Search offers Project Settings > Slack and Microsoft Teams, where a
   * workspace is connected, and each product's own Slack and Microsoft
   * Teams pages instead.
   */
  [PageMap.MONITORS_WORKSPACE_CONNECTIONS]: "connect a chat tool",
  [PageMap.INCIDENTS_WORKSPACE_CONNECTIONS]: "connect a chat tool",
  [PageMap.ALERTS_WORKSPACE_CONNECTIONS]: "connect a chat tool",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS]:
    "connect a chat tool",
  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTIONS]: "connect a chat tool",
};

/*
 * Menus whose pages Search reaches through another menu, and why.
 */
const MENUS_SEARCH_LEAVES_OUT: Readonly<Record<string, string>> = {
  /*
   * Home's lists (Active Incidents, Not Operational, Ongoing...) are the
   * products' own pages, which Search offers under each product.
   */
  "Pages/Home/SideMenu.tsx": "Home lists the products' own pages",
};

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

// A menu module renders the shared SideMenu (an item component only imports SideMenuItem).
const RENDERS_SIDE_MENU: RegExp =
  /from\s+"Common\/UI\/Components\/SideMenu\/SideMenu"/;

function sideMenuFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sideMenuFilesUnder(entryPath));
    } else if (
      entry.name.endsWith("SideMenu.tsx") &&
      RENDERS_SIDE_MENU.test(fs.readFileSync(entryPath, "utf8"))
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

const MENU_FILES: Array<string> = sideMenuFilesUnder(DASHBOARD_SRC).sort();

// A record's id: a link that carries it is a record's page, not searchable.
const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-000000000004");

interface MenuPageLink {
  menu: string;
  section: string;
  title: string;
  href: string;
}

// Every RouteMap key, by the path it opens in this project.
function getPageKeysByPath(): Map<string, Array<string>> {
  const byPath: Map<string, Array<string>> = new Map();

  for (const key of Object.keys(RouteMap)) {
    const routePath: string = RouteUtil.populateRouteParams(
      RouteMap[key] as Route,
    ).toString();

    byPath.set(routePath, [...(byPath.get(routePath) || []), key]);
  }

  return byPath;
}

// The links of every menu, drawn inside the project.
async function readMenuPageLinks(): Promise<Array<MenuPageLink>> {
  const links: Array<MenuPageLink> = [];

  for (const file of MENU_FILES) {
    const menu: string = path
      .relative(DASHBOARD_SRC, file)
      .split(path.sep)
      .join("/");

    if (MENUS_SEARCH_LEAVES_OUT[menu]) {
      continue;
    }

    const MenuComponent: FunctionComponent<Record<string, unknown>> = (
      jest.requireActual(file) as {
        default: FunctionComponent<Record<string, unknown>>;
      }
    ).default;

    goTo(`/dashboard/${PROJECT_ID}`);

    await renderMenu(
      <MenuComponent
        modelId={MODEL_ID}
        monitorType={MonitorType.Website}
        project={{ isFeatureFlagMonitorGroupsEnabled: true }}
      />,
    );

    for (const section of sectionTitlesInOrder()) {
      for (const link of linksIn(section)) {
        if (link.href.includes(MODEL_ID.toString())) {
          continue;
        }

        links.push({ menu, section, title: link.title, href: link.href });
      }
    }

    cleanup();
  }

  return links;
}

let catalog: DashboardNavigationItems | null = null;

const ReadCatalog: FunctionComponent = (): ReactElement => {
  catalog = useDashboardNavigationItems();
  return <></>;
};

// The products the palette lists, by the path they open: their option ids.
function getProductOptionIdsByPath(): Map<string, string> {
  render(<ReadCatalog />);
  const items: DashboardNavigationItems = catalog!;
  cleanup();

  const byPath: Map<string, string> = new Map();

  for (const item of [
    ...items.navItems,
    ...items.moreMenuItems,
    items.rightElement,
  ] as Array<NavItem | MoreMenuItem>) {
    byPath.set(
      item.route.toString(),
      `command-palette-option-${slugifyPaletteCommandId(
        "nav",
        (item.activeRoute || item.route).toString(),
      )}`,
    );
  }

  return byPath;
}

let menuLinks: Array<MenuPageLink> = [];
let pageKeysByPath: Map<string, Array<string>> = new Map();
let productOptionIdsByPath: Map<string, string> = new Map();

beforeAll(async () => {
  goTo(`/dashboard/${PROJECT_ID}`);
  menuLinks = await readMenuPageLinks();
  pageKeysByPath = getPageKeysByPath();
  productOptionIdsByPath = getProductOptionIdsByPath();
}, 300000);

afterAll(() => {
  cleanup();
});

// The page's key in RouteMap, from the path a menu link opens.
function getPageKeys(link: MenuPageLink): Array<string> {
  const pathOnly: string = link.href.split("?")[0] || "";
  return pageKeysByPath.get(pathOnly) || [];
}

function getQueryString(link: MenuPageLink): string {
  const at: number = link.href.indexOf("?");
  return at === -1 ? "" : link.href.slice(at);
}

// The rows that would open this link: its page, or its product.
function getCandidateOptionIds(link: MenuPageLink): Array<string> {
  const candidates: Array<string> = getPageKeys(link).map(
    (key: string): string => {
      return `command-palette-option-${slugifyPaletteCommandId(
        "page",
        (RouteMap[key] as Route).toString() + getQueryString(link),
      )}`;
    },
  );

  const productOptionId: string | undefined = productOptionIdsByPath.get(
    link.href,
  );

  if (productOptionId) {
    candidates.push(productOptionId);
  }

  return candidates;
}

function isLeftOut(link: MenuPageLink): boolean {
  return getPageKeys(link).some((key: string): boolean => {
    return Boolean(PAGES_SEARCH_LEAVES_OUT[key as PageMap]);
  });
}

function openPalette(): void {
  cleanup();
  goTo(`/dashboard/${PROJECT_ID}/home`);
  // The project as the dashboard stores it: with monitor groups turned on.
  window.localStorage.setItem(
    `project_${PROJECT_ID}`,
    JSON.stringify({ _id: PROJECT_ID, isFeatureFlagMonitorGroupsEnabled: true }),
  );
  render(<DashboardCommandPalette />);
  act((): void => {
    GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
  });
}

function typeQuery(query: string): void {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: query },
  });
}

function shownOptionIds(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.getAttribute("data-testid") || "";
  });
}

describe("Search finds every page the side menus link to", () => {
  test("the sweep reads the menus: a few hundred pages, from forty menus and more", () => {
    expect(MENU_FILES.length).toBeGreaterThanOrEqual(40);
    expect(menuLinks.length).toBeGreaterThanOrEqual(300);
    // Pages of Project Settings the maintainer asked for are among them.
    expect(
      menuLinks.map((link: MenuPageLink): string => {
        return link.title;
      }),
    ).toEqual(
      expect.arrayContaining([
        "API Keys",
        "Danger Zone",
        "On-Call Schedules",
        "On-Call Policies",
        "Billing",
      ]),
    );
  });

  test("every menu link opens a page RouteMap knows", () => {
    const unknown: Array<string> = menuLinks
      .filter((link: MenuPageLink): boolean => {
        return getPageKeys(link).length === 0;
      })
      .map((link: MenuPageLink): string => {
        return `${link.menu} > ${link.section} > ${link.title}: ${link.href}`;
      });

    expect(unknown).toEqual([]);
  });

  test("typing a page's menu title finds it, named and placed the way the menu shows it", () => {
    openPalette();

    const problems: Array<string> = [];

    for (const link of menuLinks) {
      if (isLeftOut(link)) {
        continue;
      }

      typeQuery(link.title);

      const shown: Array<string> = shownOptionIds();
      const optionId: string | undefined = getCandidateOptionIds(link).find(
        (candidate: string): boolean => {
          return shown.includes(candidate);
        },
      );

      const where: string = `${link.menu} > ${link.section} > ${link.title}`;

      if (!optionId) {
        problems.push(`${where}: not found by its title`);
        continue;
      }

      const option: HTMLElement = screen.getByTestId(optionId);

      if (!option.textContent?.includes(link.title)) {
        problems.push(`${where}: shown as "${option.textContent}"`);
        continue;
      }

      // A product row has no breadcrumb: it is the product itself.
      const breadcrumb: HTMLElement | null = screen.queryByTestId(
        `${optionId}-breadcrumb`,
      );

      if (!breadcrumb) {
        continue;
      }

      /*
       * The menu's section is named in the breadcrumb, unless it only
       * repeats the product's or the page's own name.
       */
      const crumbs: string = breadcrumb.textContent || "";
      const repeatsAName: boolean =
        link.section === link.title || crumbs.startsWith(link.section);

      if (!repeatsAName && !crumbs.includes(link.section)) {
        problems.push(`${where}: breadcrumb "${crumbs}" leaves out the section`);
      }
    }

    expect(problems).toEqual([]);
  }, 300000);

  test("the pages Search leaves out are still in a menu, so the list cannot go stale", () => {
    const keysInMenus: Set<string> = new Set<string>();

    for (const link of menuLinks) {
      for (const key of getPageKeys(link)) {
        keysInMenus.add(key);
      }
    }

    const stale: Array<string> = Object.keys(PAGES_SEARCH_LEAVES_OUT).filter(
      (key: string): boolean => {
        return !keysInMenus.has(key);
      },
    );

    expect(stale).toEqual([]);

    for (const menu of Object.keys(MENUS_SEARCH_LEAVES_OUT)) {
      expect(fs.existsSync(path.join(DASHBOARD_SRC, menu))).toBe(true);
    }
  });

  test("the pages Search leaves out are really left out", () => {
    openPalette();

    for (const link of menuLinks.filter(isLeftOut)) {
      typeQuery(link.title);

      const shown: Array<string> = shownOptionIds();

      for (const candidate of getCandidateOptionIds(link)) {
        expect({ link: link.href, shown: shown.includes(candidate) }).toEqual({
          link: link.href,
          shown: false,
        });
      }
    }
  }, 300000);
});
