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
import * as React from "react";
import { Location } from "react-router-dom";
import AdminNavBar from "../../../../App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar";
import { CATEGORY_FOLDS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import { RECENT_PRODUCTS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Pinned rather than read from the environment: with billing on, the menu
 * grows an Enterprise Licenses entry.
 */
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mocked;
});

/*
 * The Dashboard's products menu opens on Essentials and folds its other
 * sections. The Admin Dashboard shares the menu but has five entries in four
 * sections: there is nothing worth folding, so it names no sections to open
 * on and keeps every one of them open, as before.
 */

const ORIGINAL_WIDTH: number = window.innerWidth;

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1280,
  });
  Navigation.setLocation({
    pathname: "/admin/home",
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: ORIGINAL_WIDTH,
  });
});

describe("the Admin Dashboard menu", () => {
  test("lists every entry under plain headings, with nothing folded", () => {
    render(<AdminNavBar />);

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });

    expect(
      within(menu)
        .queryAllByRole("button")
        .filter((button: HTMLElement): boolean => {
          return button.hasAttribute("aria-expanded");
        }),
    ).toEqual([]);
    expect(
      within(menu)
        .getAllByRole("heading", { level: 3 })
        .map((heading: HTMLElement): string => {
          return heading.textContent ?? "";
        }),
    ).toEqual(["Management", "Monitoring", "Tools", "Settings"]);
    expect(
      within(menu)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.querySelector("span.truncate")?.textContent ?? "";
        }),
    ).toEqual([
      "Users",
      "Projects",
      "OneUptime Health",
      "Send Email",
      "Settings",
    ]);
  });

  test("a section folded in the Dashboard's menu stays open here", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Settings: false, Management: false }),
    );

    render(<AdminNavBar />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  /*
   * Every entry of this menu is on screen at once, so a Recently visited
   * row only drew the same cards a second time, above themselves (#4922's
   * follow-up). The menu has no such row, and keeps no list for one.
   */
  test("draws no Recently visited row, whatever the browser remembers", () => {
    window.localStorage.setItem(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify(["/admin/users", "/admin/projects", "/admin/settings"]),
    );

    render(<AdminNavBar />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });
    expect(within(menu).queryByRole("group", { name: /Recent/ })).toBeNull();
    expect(within(menu).queryByText("Recently visited")).toBeNull();
    // Each entry once.
    expect(within(menu).getAllByRole("option")).toHaveLength(5);
  });

  test("remembers no page it is on, and no entry opened from it", () => {
    Navigation.setLocation({
      pathname: "/admin/users",
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

    render(<AdminNavBar />);
    // On one of its pages, the bar's button is named after it.
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Products menu" })).getByRole(
        "link",
        { name: /Projects/ },
      ),
    );

    expect(window.localStorage.getItem(RECENT_PRODUCTS_STORAGE_KEY)).toBeNull();
  });
});
