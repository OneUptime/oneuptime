import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  MoreMenuItem,
  NavItem,
  isMoreMenuItemActive,
} from "../../../UI/Components/Navbar/NavBar";
import Navigation from "../../../UI/Utils/Navigation";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * "OneUptime is really complicated to use." Part of knowing where you are is
 * the nav bar: after Home it names the product the page belongs to, the
 * products menu marks that product and opens its category, and User Settings
 * lights up on its own pages. It got that wrong on whole areas:
 *
 *  - every page of Project Settings read "Products", as if the user were
 *    nowhere: its route is `/dashboard/:projectId/settings/`, and the trailing
 *    slash counted as one more segment the page had to have;
 *  - User Settings lit up on Notification Methods alone, the page it opens on;
 *  - Inventory's Archived, Documentation and Settings pages, and every page of
 *    Monitor Groups (which share the Monitors side menu), read "Products".
 *
 * This walks every page the Dashboard routes to, with the real Navigation and
 * the real catalog, and then reads the nav bar the way a user does. A page
 * added under a product without keeping its name in the bar fails here.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

function lookupNested(data: LocaleData, key: string): string | undefined {
  let cursor: unknown = data;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

// What a nested key reads in the active locale: the copy users see.
function copy(key: string): string {
  const value: string | undefined = lookupNested(activeLocale, key);
  if (!value) {
    throw new Error(`Missing locale key ${key}`);
  }
  return value;
}

/*
 * Answers react-i18next from the real locale files, both ways the dashboard
 * looks text up: t("a.b.c", default) for nested keys, and
 * t(text, { keySeparator: false, defaultValue }) for the flat English-text
 * keys behind useTranslateValue.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (
            options &&
            typeof options === "object" &&
            (options as { keySeparator?: unknown }).keySeparator === false
          ) {
            const flat: unknown = activeLocale[key];
            return typeof flat === "string"
              ? flat
              : (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return (
            lookupNested(activeLocale, key) ??
            (typeof options === "string" ? options : key)
          );
        },
      };
    },
  };
});

const PROJECT_ID: string = "65f00000000000000000aaaa";
const RECORD_ID: string = "65f00000000000000000bbbb";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      // Read when a route is filled in, long after the imports have run.
      getCurrentProjectId: () => {
        return new ObjectID(PROJECT_ID);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: () => {
        return undefined;
      },
    },
  };
});

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname: pathname,
    search: "",
    hash: "",
    state: null,
    key: "nav-bar-current-product",
  });
}

// The address a route pattern stands for, with every parameter filled in.
function addressOf(pattern: string): string {
  return pattern
    .replace(":projectId", PROJECT_ID)
    .replace(/:[A-Za-z]+/g, RECORD_ID);
}

/*
 * Every page of a project the Dashboard routes to, by PageMap key. Patterns
 * ending in `/*` only mount the routers of the pages below them.
 */
interface ProjectPage {
  key: string;
  pattern: string;
}

const PROJECT_PAGES: Array<ProjectPage> = Object.entries(RouteMap)
  .map(([key, route]: [string, Route]): ProjectPage => {
    return { key, pattern: route.toString() };
  })
  .filter((page: ProjectPage): boolean => {
    return (
      (page.pattern === "/dashboard/:projectId" ||
        page.pattern.startsWith("/dashboard/:projectId/")) &&
      !page.pattern.endsWith("/*")
    );
  });

function pagesUnder(area: string): Array<ProjectPage> {
  return PROJECT_PAGES.filter((page: ProjectPage): boolean => {
    return (
      page.pattern === `/dashboard/:projectId/${area}` ||
      page.pattern.startsWith(`/dashboard/:projectId/${area}/`)
    );
  });
}

/*
 * The pages of a project that belong to no product, so the bar rightly names
 * none: Home and the lists its tiles open (Home is its own item, left of the
 * products), the project's address itself (it sends the user to Home), the
 * SSO sign-in page (it hides the nav bar) and three addresses no page is
 * mounted at any more.
 */
const PAGES_OF_NO_PRODUCT: Array<string> = [
  PageMap.INIT_PROJECT,
  PageMap.PROJECT_SSO,
  PageMap.HOME,
  PageMap.HOME_ACTIVE_INCIDENTS,
  PageMap.HOME_ACTIVE_ALERTS,
  PageMap.HOME_ACTIVE_EPISODES,
  PageMap.HOME_ACTIVE_INCIDENT_EPISODES,
  PageMap.HOME_NOT_OPERATIONAL_MONITORS,
  PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
  PageMap.AUTOMATION_SCRIPTS,
  PageMap.REPORTS,
  PageMap.ERROR_TRACKER,
];

// The catalog the nav bar is built from, read through the real hook.
let catalog: DashboardNavigationItems | null = null;

const CatalogProbe: React.FunctionComponent = (): React.ReactElement => {
  catalog = useDashboardNavigationItems();
  return <></>;
};

function readCatalog(): DashboardNavigationItems {
  render(<CatalogProbe />);
  cleanup();
  return catalog!;
}

interface WhereTheBarSaysWeAre {
  products: Array<string>;
  userSettings: boolean;
}

function whereTheBarSaysWeAre(
  items: DashboardNavigationItems,
  page: ProjectPage,
): WhereTheBarSaysWeAre {
  goTo(addressOf(page.pattern));

  const rightElement: NavItem = items.rightElement;

  return {
    products: items.moreMenuItems
      .filter((item: MoreMenuItem): boolean => {
        return isMoreMenuItemActive(item);
      })
      .map((item: MoreMenuItem): string => {
        return item.title;
      }),
    userSettings: Navigation.isStartWith(
      (rightElement.activeRoute || rightElement.route) as Route,
    ),
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  activeLocale = EN;
  setViewportWidth(1440);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  setViewportWidth(ORIGINAL_INNER_WIDTH);
  (Navigation as unknown as { location: unknown }).location = undefined;
});

describe("every page of a project names where it is", () => {
  test("the sweep sees the whole Dashboard", () => {
    // A broken filter must not pass by finding nothing to check.
    expect(PROJECT_PAGES.length).toBeGreaterThan(1000);
    expect(pagesUnder("settings").length).toBeGreaterThan(25);
    expect(pagesUnder("user-settings").length).toBeGreaterThan(10);
    expect(pagesUnder("inventory").length).toBeGreaterThan(10);
    expect(pagesUnder("monitor-groups").length).toBeGreaterThan(5);
  });

  test("no page lights two products at once", () => {
    const items: DashboardNavigationItems = readCatalog();

    const lightingTwo: Array<string> = PROJECT_PAGES.filter(
      (page: ProjectPage): boolean => {
        return whereTheBarSaysWeAre(items, page).products.length > 1;
      },
    ).map((page: ProjectPage): string => {
      return page.pattern;
    });

    expect(lightingTwo).toEqual([]);
  });

  test("every page lights its product or User Settings, unless it belongs to no product", () => {
    const items: DashboardNavigationItems = readCatalog();

    const namingNothing: Array<string> = PROJECT_PAGES.filter(
      (page: ProjectPage): boolean => {
        const where: WhereTheBarSaysWeAre = whereTheBarSaysWeAre(items, page);
        return where.products.length === 0 && !where.userSettings;
      },
    )
      .map((page: ProjectPage): string => {
        return page.key;
      })
      .sort();

    expect(namingNothing).toEqual([...PAGES_OF_NO_PRODUCT].sort());
  });

  test("the pages of no product really light nothing, and Home is not a product", () => {
    const items: DashboardNavigationItems = readCatalog();

    for (const key of PAGES_OF_NO_PRODUCT) {
      const where: WhereTheBarSaysWeAre = whereTheBarSaysWeAre(items, {
        key,
        pattern: RouteMap[key]!.toString(),
      });
      expect({ key, ...where }).toEqual({
        key,
        products: [],
        userSettings: false,
      });
    }
  });

  test.each([
    ["settings", "navbar.items.projectSettingsTitle"],
    ["inventory", "navbar.items.inventoryTitle"],
    ["monitor-groups", "navbar.items.monitorsTitle"],
    ["monitors", "navbar.items.monitorsTitle"],
  ])(
    "every page under /%s lights exactly the one product it belongs to",
    (area: string, titleKey: string) => {
      const items: DashboardNavigationItems = readCatalog();

      for (const page of pagesUnder(area)) {
        expect({
          page: page.pattern,
          ...whereTheBarSaysWeAre(items, page),
        }).toEqual({
          page: page.pattern,
          products: [copy(titleKey)],
          userSettings: false,
        });
      }
    },
  );

  test("every page of User Settings lights User Settings, and no product", () => {
    const items: DashboardNavigationItems = readCatalog();

    for (const page of pagesUnder("user-settings")) {
      expect({
        page: page.pattern,
        ...whereTheBarSaysWeAre(items, page),
      }).toEqual({
        page: page.pattern,
        products: [],
        userSettings: true,
      });
    }
  });

  test("User Settings still opens on Notification Methods", () => {
    const items: DashboardNavigationItems = readCatalog();

    expect(items.rightElement.route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
    );
  });

  test("Inventory still opens on its Overview, and Monitors on the monitor list", () => {
    const items: DashboardNavigationItems = readCatalog();

    const routeOf: (titleKey: string) => string = (
      titleKey: string,
    ): string => {
      return items.moreMenuItems
        .find((item: MoreMenuItem): boolean => {
          return item.title === copy(titleKey);
        })!
        .route.toString();
    };

    expect(routeOf("navbar.items.inventoryTitle")).toBe(
      `/dashboard/${PROJECT_ID}/inventory/overview`,
    );
    expect(routeOf("navbar.items.monitorsTitle")).toBe(
      `/dashboard/${PROJECT_ID}/monitors`,
    );
    expect(routeOf("navbar.items.projectSettingsTitle")).toBe(
      `/dashboard/${PROJECT_ID}/settings/`,
    );
  });
});

// The button after "Home /": the current product, or "Products" for none.
function productButton(): HTMLElement {
  const nav: HTMLElement = screen.getByTestId("nav-children");
  const buttons: Array<HTMLElement> = within(nav).getAllByRole("button");
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

function renderNavBarAt(pathname: string): void {
  goTo(pathname);
  render(<DashboardNavbar show={true} />);
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe("what the nav bar reads, on the pages it used to get wrong", () => {
  test.each([
    `/dashboard/${PROJECT_ID}/settings`,
    `/dashboard/${PROJECT_ID}/settings/`,
    `/dashboard/${PROJECT_ID}/settings/labels`,
    `/dashboard/${PROJECT_ID}/settings/api-keys/${RECORD_ID}`,
    `/dashboard/${PROJECT_ID}/settings/danger-zone`,
  ])("on %s it reads Project Settings, not Products", (pathname: string) => {
    renderNavBarAt(pathname);

    expect(productButton()).toHaveTextContent(
      copy("navbar.items.projectSettingsTitle"),
    );
    expect(productButton()).not.toHaveTextContent(String(EN["Products"]));
  });

  test.each([
    [`/dashboard/${PROJECT_ID}/inventory/documentation`, "inventoryTitle"],
    [`/dashboard/${PROJECT_ID}/inventory/archived`, "inventoryTitle"],
    [`/dashboard/${PROJECT_ID}/monitor-groups`, "monitorsTitle"],
    [`/dashboard/${PROJECT_ID}/monitor-groups/${RECORD_ID}`, "monitorsTitle"],
  ])("on %s it names its product", (pathname: string, titleKey: string) => {
    renderNavBarAt(pathname);

    expect(productButton()).toHaveTextContent(copy(`navbar.items.${titleKey}`));
  });

  test("on a page of no product it still offers Products", () => {
    renderNavBarAt(`/dashboard/${PROJECT_ID}/home/`);

    expect(productButton()).toHaveTextContent(String(EN["Products"]));
  });

  test("in German, Settings reads Projekteinstellungen", () => {
    activeLocale = DE;
    renderNavBarAt(`/dashboard/${PROJECT_ID}/settings/labels`);

    expect(productButton()).toHaveTextContent(
      String(lookupNested(DE, "navbar.items.projectSettingsTitle")),
    );
    expect(productButton()).not.toHaveTextContent(String(DE["Products"]));
  });

  test.each([
    "notification-methods",
    "on-call-rules",
    "notification-settings",
    "email-preferences",
    `on-call-logs/${RECORD_ID}`,
  ])(
    "User Settings is the current page on user-settings/%s",
    (page: string) => {
      renderNavBarAt(`/dashboard/${PROJECT_ID}/user-settings/${page}`);

      const userSettings: HTMLElement = screen.getByRole("link", {
        name: copy("navbar.userSettings"),
      });
      expect(userSettings).toHaveAttribute("aria-current", "page");
      expect(userSettings).toHaveClass("bg-gray-100", "text-gray-900");
    },
  );

  test("User Settings is not the current page anywhere else", () => {
    renderNavBarAt(`/dashboard/${PROJECT_ID}/settings/labels`);

    const userSettings: HTMLElement = screen.getByRole("link", {
      name: copy("navbar.userSettings"),
    });
    expect(userSettings).not.toHaveAttribute("aria-current");
    expect(userSettings).not.toHaveClass("bg-gray-100");
  });

  test("Home is the current page on Home, and only there", () => {
    renderNavBarAt(`/dashboard/${PROJECT_ID}/home/`);
    expect(
      screen.getByRole("link", { name: copy("navbar.home") }),
    ).toHaveAttribute("aria-current", "page");
    cleanup();

    renderNavBarAt(`/dashboard/${PROJECT_ID}/settings/labels`);
    expect(
      screen.getByRole("link", { name: copy("navbar.home") }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("the products menu, opened from a page of Project Settings", () => {
  function productsMenu(): HTMLElement {
    return screen.getByRole("dialog", {
      name: String(activeLocale["Products menu"] ?? "Products menu"),
    });
  }

  test("marks Project Settings as where the user is, with its category open", () => {
    renderNavBarAt(`/dashboard/${PROJECT_ID}/settings/labels`);
    fireEvent.click(productButton());
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const settingsCategory: HTMLElement = within(productsMenu()).getByRole(
      "button",
      { name: copy("navbar.categories.settings") },
    );
    expect(settingsCategory).toHaveAttribute("aria-expanded", "true");

    const current: Array<HTMLElement> = within(productsMenu())
      .getAllByRole("option")
      .filter((option: HTMLElement): boolean => {
        return option.getAttribute("aria-current") === "page";
      });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(
      copy("navbar.items.projectSettingsTitle"),
    );
  });
});

describe("on a phone, the compact nav names the product too", () => {
  test.each([
    [
      `/dashboard/${PROJECT_ID}/settings/labels`,
      "navbar.items.projectSettingsTitle",
    ],
    [
      `/dashboard/${PROJECT_ID}/user-settings/on-call-rules`,
      "navbar.userSettings",
    ],
    [
      `/dashboard/${PROJECT_ID}/monitor-groups/${RECORD_ID}`,
      "navbar.items.monitorsTitle",
    ],
  ])(
    "on %s it reads its own name, not Home",
    (pathname: string, key: string) => {
      setViewportWidth(375);
      renderNavBarAt(pathname);

      const toggle: HTMLElement = screen.getByTestId("mobile-nav-toggle");
      const compactNav: HTMLElement = toggle.closest("nav") as HTMLElement;

      expect(compactNav).toHaveTextContent(copy(key));
      expect(compactNav).not.toHaveTextContent(copy("navbar.home"));
    },
  );
});
