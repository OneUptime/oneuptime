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
import {
  DashboardNavigationItems,
  useDashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import { CATEGORY_LIST_COLUMNS } from "../../../UI/Components/Navbar/NavBarCategoryToggle";
import { categoryOf } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Dashboard's products menu draws each category as a row of one list,
 * Essentials first. A row heads the products under it and is not one of
 * them, so it is drawn without an icon: its name, what it holds, how many
 * and a chevron. Only the products carry icons. These hold the desktop menu
 * and the phone menu to that, with the Dashboard's own catalog.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

// Every category, as the menu's rows: Essentials, open, then the folded ones.
const CATEGORIES: Array<string> = [
  "Essentials",
  "Observability",
  "AI",
  "Code",
  "Resources",
  "Infrastructure",
  "Dashboards & Automation",
  "Settings",
];

function withTranslation(element: React.ReactElement): React.ReactElement {
  return <I18nextProvider i18n={translation}>{element}</I18nextProvider>;
}

// The Dashboard's catalog, as the navbar reads it.
function catalog(): DashboardNavigationItems {
  let items: DashboardNavigationItems | undefined = undefined;

  const Probe: () => null = (): null => {
    items = useDashboardNavigationItems();
    return null;
  };

  const { unmount } = render(withTranslation(<Probe />));
  unmount();
  expect(items).toBeDefined();
  return items!;
}

// A category's row: the element its button's ::after covers.
function rowOf(scope: HTMLElement, category: string): HTMLElement {
  return within(scope)
    .getByRole("button", { name: category })
    .closest("div.relative") as HTMLElement;
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the Dashboard's catalog", () => {
  test("groups its products into the categories, Essentials first and open", () => {
    const items: DashboardNavigationItems = catalog();

    expect(Array.from(new Set(items.moreMenuItems.map(categoryOf)))).toEqual(
      CATEGORIES,
    );
    expect(items.moreMenuCategoriesOpenByDefault).toEqual(["Essentials"]);
  });

  test("chooses no icon for a category", () => {
    expect(Object.keys(catalog())).toEqual([
      "navItems",
      "moreMenuItems",
      "moreMenuCategoriesOpenByDefault",
      "rightElement",
    ]);
  });
});

describe("the desktop products menu", () => {
  test("draws every category as a row of one list, with no icon: the chevron is its only glyph", () => {
    setViewportWidth(DESKTOP_WIDTH);
    render(withTranslation(<DashboardNavbar show={true} />));
    fireEvent.click(screen.getByRole("button", { name: "Products" }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });
    const lists: Array<HTMLElement> = Array.from(
      dialog.querySelectorAll<HTMLElement>("div"),
    ).filter((element: HTMLElement): boolean => {
      return CATEGORY_LIST_COLUMNS.split(" ").every(
        (token: string): boolean => {
          return element.classList.contains(token);
        },
      );
    });

    expect(lists).toHaveLength(1);
    for (const category of CATEGORIES) {
      const row: HTMLElement = rowOf(dialog, category);

      expect(lists[0]).toContainElement(row);
      expect([category, row.querySelectorAll("svg").length]).toEqual([
        category,
        1,
      ]);
      // The name comes first: nothing is drawn before it.
      expect([category, row.firstElementChild?.tagName]).toEqual([
        category,
        "H3",
      ]);
    }
  });

  test("the essentials' products, open under their row, keep their icons", () => {
    setViewportWidth(DESKTOP_WIDTH);
    render(withTranslation(<DashboardNavbar show={true} />));
    fireEvent.click(screen.getByRole("button", { name: "Products" }));

    const essentials: HTMLElement = screen.getByRole("group", {
      name: "Essentials",
    });
    const monitors: HTMLElement = within(essentials).getByRole("link", {
      name: /Monitors/,
    });

    expect(monitors.querySelector("svg")).not.toBeNull();
  });
});

describe("the phone menu", () => {
  test("draws every category's row with no icon before its name", () => {
    setViewportWidth(MOBILE_WIDTH);
    render(withTranslation(<DashboardNavbar show={true} />));
    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));

    const menu: HTMLElement = screen
      .getByRole("link", { name: "Home" })
      .closest("nav") as HTMLElement;

    for (const category of CATEGORIES) {
      const heading: HTMLElement = within(menu).getByRole("heading", {
        level: 3,
        name: category,
      });

      expect([category, heading.querySelector("svg")]).toEqual([
        category,
        null,
      ]);
      expect([
        category,
        rowOf(menu, category).querySelectorAll("svg").length,
      ]).toEqual([category, 1]);
    }

    // The products under the open Essentials keep theirs.
    expect(
      within(menu).getByRole("link", { name: "Monitors" }).querySelector("svg"),
    ).not.toBeNull();
  });
});
