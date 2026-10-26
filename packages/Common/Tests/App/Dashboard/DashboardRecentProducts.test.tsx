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
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import { RECENT_PRODUCTS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Dashboard's products menu, with its real navbar, catalog and English
 * words: the "Recently visited" row shows six products.
 *
 * The maintainer's screenshot showed Teams, Project Settings and Users on
 * one row, and Alerts alone under it, with the note: "Suggestion to expand
 * this list to 6, since you have the real-estate and 4 items shown now take
 * up 2 rows anyway." The rules: Tests/UI/Components/NavBarRecentProducts.test.ts;
 * the menu: Tests/UI/Components/NavBarMenuRecentProducts.test.tsx; a real
 * browser's layout: E2E/NavigationSearch/RecentProducts.spec.ts.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const OTHER_PROJECT_ID: string = "7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

/*
 * Products opened from the menu one after another, the newest first, with
 * the names the Dashboard gives them.
 */
const OPENED: Array<[string, string]> = [
  [PageMap.TEAMS, "Teams"],
  [PageMap.SETTINGS, "Project Settings"],
  [PageMap.USERS, "Users"],
  [PageMap.ALERTS, "Alerts"],
  [PageMap.LOGS, "Logs"],
  [PageMap.KUBERNETES_CLUSTERS, "Kubernetes"],
  [PageMap.MONITORS, "Monitors"],
  [PageMap.INCIDENTS, "Incidents"],
];

function titles(entries: Array<[string, string]>): Array<string> {
  return entries.map(([, title]: [string, string]): string => {
    return title;
  });
}

function routes(entries: Array<[string, string]>): Array<string> {
  return entries.map(([pageMapKey]: [string, string]): string => {
    return routeFor(pageMapKey);
  });
}

// The same page in another of the user's projects.
function inOtherProject(pageMapKey: string): string {
  return routeFor(pageMapKey).replace(PROJECT_ID, OTHER_PROJECT_ID);
}

function remember(routeList: Array<string>): void {
  window.localStorage.setItem(
    RECENT_PRODUCTS_STORAGE_KEY,
    JSON.stringify(routeList),
  );
}

function stored(): Array<string> {
  return JSON.parse(
    window.localStorage.getItem(RECENT_PRODUCTS_STORAGE_KEY) ?? "[]",
  ) as Array<string>;
}

function navbar(): React.ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

/*
 * The top bar's button that opens the menu: "Products" on Home, the name
 * of the product on one of its pages.
 */
function openProducts(buttonName: string = "Products"): void {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  expect(screen.getByRole("dialog", { name: "Products menu" })).toBeVisible();
}

// A product's card in the menu, found by where it leads.
function productLink(pageMapKey: string): HTMLElement {
  const href: string = routeFor(pageMapKey);
  const link: HTMLElement | undefined = within(screen.getByRole("listbox"))
    .queryAllByRole("link")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("href") === href;
    });

  if (!link) {
    throw new Error(`The menu does not show the product at ${href}.`);
  }

  return link;
}

function recentRow(name: string = "Recently visited"): HTMLElement {
  return screen.getByRole("group", { name });
}

function recentTitles(name: string = "Recently visited"): Array<string> {
  return within(recentRow(name))
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.querySelector("span.truncate")?.textContent ?? "";
    });
}

function recentHrefs(): Array<string | null> {
  return within(recentRow())
    .getAllByRole("link")
    .map((link: HTMLElement): string | null => {
      return link.getAttribute("href");
    });
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      fr: { translation: frenchLocale },
    },
    interpolation: { escapeValue: false },
  });
});

describe("the Dashboard's Recently visited products", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/home`);
    await translation.changeLanguage("en");
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
    setViewportWidth(ORIGINAL_WIDTH);
  });

  test("on Home, the menu shows the six products opened last, the newest first", () => {
    remember(routes(OPENED));
    render(navbar());

    openProducts();

    expect(
      screen.getByRole("heading", { level: 3, name: "Recently visited" }),
    ).toBeVisible();
    expect(recentTitles()).toEqual(titles(OPENED.slice(0, 6)));
    expect(recentHrefs()).toEqual(routes(OPENED.slice(0, 6)));
    // Every card leads into this project.
    for (const href of recentHrefs()) {
      expect(href).toContain(PROJECT_ID);
    }
  });

  test("on Project Settings, it is left out and the row still shows six", () => {
    remember(routes(OPENED));
    goTo(routeFor(PageMap.SETTINGS));
    render(navbar());

    openProducts("Project Settings");

    expect(recentTitles()).toEqual([
      "Teams",
      "Users",
      "Alerts",
      "Logs",
      "Kubernetes",
      "Monitors",
    ]);
  });

  test("the maintainer's four, with three more opened before them: two full rows of three", () => {
    // The four in the screenshot, after Monitors, Incidents and Logs.
    remember(
      routes([
        [PageMap.TEAMS, "Teams"],
        [PageMap.SETTINGS, "Project Settings"],
        [PageMap.USERS, "Users"],
        [PageMap.ALERTS, "Alerts"],
        [PageMap.MONITORS, "Monitors"],
        [PageMap.INCIDENTS, "Incidents"],
        [PageMap.LOGS, "Logs"],
      ]),
    );
    goTo(routeFor(PageMap.TEAMS));
    render(navbar());

    openProducts("Teams");

    expect(recentTitles()).toEqual([
      "Project Settings",
      "Users",
      "Alerts",
      "Monitors",
      "Incidents",
      "Logs",
    ]);
    const grid: HTMLElement = within(recentRow()).getAllByRole("option")[0]!
      .parentElement as HTMLElement;
    expect(grid).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3");
  });

  test("a list remembered before the row grew still shows, all five on Home", () => {
    remember(routes(OPENED.slice(0, 5)));
    render(navbar());

    openProducts();

    expect(recentTitles()).toEqual(titles(OPENED.slice(0, 5)));
  });

  test("another project's products and the Admin Dashboard's pages are not shown here, and are kept", () => {
    const remembered: Array<string> = [
      inOtherProject(PageMap.STATUS_PAGES),
      routeFor(PageMap.TEAMS),
      "/admin/users",
      routeFor(PageMap.SETTINGS),
      inOtherProject(PageMap.TRACES),
      routeFor(PageMap.USERS),
      routeFor(PageMap.ALERTS),
      "/admin/settings",
      routeFor(PageMap.LOGS),
      inOtherProject(PageMap.METRICS),
      routeFor(PageMap.KUBERNETES_CLUSTERS),
      routeFor(PageMap.MONITORS),
    ];
    remember(remembered);
    render(navbar());
    openProducts();

    expect(recentTitles()).toEqual(titles(OPENED.slice(0, 6)));

    // Opening one of them puts it first, and the rest stay remembered.
    fireEvent.click(within(recentRow()).getByRole("link", { name: /^Alerts/ }));

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route(routeFor(PageMap.ALERTS)),
    );
    expect(stored()).toEqual([
      routeFor(PageMap.ALERTS),
      ...remembered.filter((route: string): boolean => {
        return route !== routeFor(PageMap.ALERTS);
      }),
    ]);
  });

  test("in the other project, the row shows that project's products", () => {
    remember([
      inOtherProject(PageMap.STATUS_PAGES),
      routeFor(PageMap.TEAMS),
      inOtherProject(PageMap.TRACES),
      routeFor(PageMap.USERS),
      inOtherProject(PageMap.METRICS),
    ]);
    goTo(`/dashboard/${OTHER_PROJECT_ID}/home`);
    render(navbar());

    openProducts();

    expect(recentTitles()).toEqual(["Status Pages", "Traces", "Metrics"]);
    for (const href of recentHrefs()) {
      expect(href).toContain(OTHER_PROJECT_ID);
    }
  });

  test("seven products opened from the menu, one after another, leave the six before the last", () => {
    const opened: Array<[string, string]> = [...OPENED.slice(0, 7)].reverse();
    const view: ReturnType<typeof render> = render(navbar());
    // On Home the button says Products; on a product's page, its name.
    let topBarButton: string = "Products";

    for (const [pageMapKey, title] of opened) {
      openProducts(topBarButton);
      // Search finds it by name (and others by what they do), then a click.
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: title },
      });
      fireEvent.click(productLink(pageMapKey));
      expect(Navigation.navigate).toHaveBeenLastCalledWith(
        new Route(routeFor(pageMapKey)),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      // The app follows the link: the top bar now names the product.
      goTo(routeFor(pageMapKey));
      view.rerender(navbar());
      topBarButton = title;
    }

    // On Teams, the last one opened.
    openProducts("Teams");

    expect(recentTitles()).toEqual([
      "Project Settings",
      "Users",
      "Alerts",
      "Logs",
      "Kubernetes",
      "Monitors",
    ]);
  });

  test("in French, the row has the French name and its cards the French titles", async () => {
    remember(routes(OPENED));
    render(navbar());
    openProducts();

    await act(async () => {
      await translation.changeLanguage("fr");
    });

    const label: string = (
      frenchLocale as unknown as { navbar: { search: { recent: string } } }
    ).navbar.search.recent;
    expect(label).not.toBe("Recently visited");
    expect(recentTitles(label)).toHaveLength(6);
    expect(recentTitles(label)[0]).toBe("Équipes");
    expect(recentTitles(label)[1]).toBe("Paramètres du projet");
  });
});

/*
 * A product counts as visited however it was reached: a Home tile, Search,
 * a link in a notification, the back button or a typed address - not only
 * a pick in the products menu (#4922's follow-up). The navbar is drawn on
 * every page, so it remembers the product of each page it is drawn on.
 */
describe("a product reached without the products menu", () => {
  /*
   * A record's page. Built when a test runs, not when the file loads: the
   * project id comes from the address bar.
   */
  const incidentPage: () => string = (): string => {
    return `${routeFor(PageMap.INCIDENTS)}/0b5f4f5e-3c3a-4f0e-9a51-2f9c7f0d2a11`;
  };
  const monitorPage: () => string = (): string => {
    return `${routeFor(PageMap.MONITORS)}/3c1e9a2b-8d4f-4c6e-a1b2-c3d4e5f60718`;
  };

  beforeEach(async () => {
    window.localStorage.clear();
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/home`);
    await translation.changeLanguage("en");
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
    setViewportWidth(ORIGINAL_WIDTH);
  });

  // The app moves to a page: the navbar is drawn again there.
  function arriveAt(
    view: ReturnType<typeof render>,
    path: string,
  ): ReturnType<typeof render> {
    goTo(path);
    view.rerender(navbar());
    return view;
  }

  test("is remembered when one of its pages opens, a record's page too", () => {
    const view: ReturnType<typeof render> = render(navbar());
    expect(stored()).toEqual([]);

    arriveAt(view, monitorPage());
    expect(stored()).toEqual([routeFor(PageMap.MONITORS)]);

    arriveAt(view, incidentPage());
    expect(stored()).toEqual([
      routeFor(PageMap.INCIDENTS),
      routeFor(PageMap.MONITORS),
    ]);
  });

  test("Home is no product: arriving there remembers nothing", () => {
    const view: ReturnType<typeof render> = render(navbar());

    arriveAt(view, routeFor(PageMap.LOGS));
    arriveAt(view, `/dashboard/${PROJECT_ID}/home`);

    expect(stored()).toEqual([routeFor(PageMap.LOGS)]);
  });

  test("moving between a product's own pages adds nothing", () => {
    const view: ReturnType<typeof render> = render(navbar());

    arriveAt(view, routeFor(PageMap.MONITORS));
    arriveAt(view, monitorPage());
    arriveAt(view, `${monitorPage()}/criteria`);

    expect(stored()).toEqual([routeFor(PageMap.MONITORS)]);
  });

  test("coming back to a product puts it first again, once", () => {
    const view: ReturnType<typeof render> = render(navbar());

    for (const pageMapKey of [
      PageMap.MONITORS,
      PageMap.INCIDENTS,
      PageMap.LOGS,
      PageMap.MONITORS,
    ]) {
      arriveAt(view, routeFor(pageMapKey));
    }

    expect(stored()).toEqual([
      routeFor(PageMap.MONITORS),
      routeFor(PageMap.LOGS),
      routeFor(PageMap.INCIDENTS),
    ]);
  });

  test("the products visited that way fill the Recently visited row", () => {
    const view: ReturnType<typeof render> = render(navbar());

    // A Home tile, Search and a link in an email, say.
    arriveAt(view, routeFor(PageMap.STATUS_PAGES));
    arriveAt(view, routeFor(PageMap.TRACES));
    arriveAt(view, incidentPage());
    arriveAt(view, `/dashboard/${PROJECT_ID}/home`);

    openProducts();

    expect(recentTitles()).toEqual(["Incidents", "Traces", "Status Pages"]);
  });

  test("the page's own product is still left out of the row", () => {
    const view: ReturnType<typeof render> = render(navbar());

    arriveAt(view, routeFor(PageMap.TRACES));
    arriveAt(view, incidentPage());

    openProducts("Incidents");

    expect(recentTitles()).toEqual(["Traces"]);
  });

  test("a browser that refuses storage still draws the navbar on every page", () => {
    const storage: { setItem: (key: string, value: string) => void } =
      Storage.prototype as unknown as {
        setItem: (key: string, value: string) => void;
      };
    jest.spyOn(storage, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });

    const view: ReturnType<typeof render> = render(navbar());
    arriveAt(view, routeFor(PageMap.MONITORS));

    expect(screen.getByRole("button", { name: "Monitors" })).toBeVisible();
  });
});
