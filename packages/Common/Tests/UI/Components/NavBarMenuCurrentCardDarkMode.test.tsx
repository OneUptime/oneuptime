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
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import { RECENT_PRODUCTS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import Navigation from "../../../UI/Utils/Navigation";
import { StyleRule, THEME_RULES } from "../Styles/ThemeStylesheet";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
      };
    },
  };
});

/*
 * The products menu in the dark theme: the card of the page the user is
 * on, beside the keyboard cursor's card.
 *
 * The light theme draws the cursor's card with bg-indigo-50 and
 * border-indigo-300, and the current page's with a faint bg-indigo-50/40
 * and border-indigo-100. Theme.css's general rules gave both pairs the same
 * dark wash and edge, so in the dark theme two cards looked chosen. That
 * was rare while the menu opened on the current page's product; since it
 * opens on the Recently visited row, the current page's card shows beside
 * the cursor's whenever it is on screen (an Essentials product's page).
 * A rule keyed on the option's aria-current keeps it faint, as in the light
 * theme. The cascade in a real browser: E2E/NavigationSearch/RecentProducts.spec.ts.
 */

const CURRENT_CARD_SELECTOR: string =
  '[role="option"][aria-current="page"] > a[class~="bg-indigo-50/40"]';

function ruleWhere(
  matches: (selectors: Array<string>) => boolean,
  property: string,
): StyleRule {
  const rule: StyleRule | undefined = THEME_RULES.filter(
    (candidate: StyleRule): boolean => {
      return (
        matches(candidate.selectors) &&
        candidate.declarations[property] !== undefined
      );
    },
  ).pop();

  if (!rule) {
    throw new Error(`Theme.css has no rule for that, setting ${property}.`);
  }

  return rule;
}

// rgb(49 46 129 / 35%) -> [49, 46, 129] and 0.35.
function channelsOf(color: string): { rgb: string; alpha: number } {
  const open: number = color.indexOf("(");
  const slash: number = color.indexOf("/");
  const close: number = color.lastIndexOf(")");
  expect(color.startsWith("rgb(")).toBe(true);
  expect(slash).toBeGreaterThan(open);
  const alphaText: string = color.slice(slash + 1, close).trim();
  expect(alphaText.endsWith("%")).toBe(true);

  return {
    rgb: color.slice(open + 1, slash).trim(),
    alpha: Number(alphaText.slice(0, -1)) / 100,
  };
}

// The dark rule for the current page's card.
function currentRule(property: string): StyleRule {
  return ruleWhere((selectors: Array<string>): boolean => {
    return selectors.includes(`html.dark ${CURRENT_CARD_SELECTOR}`);
  }, property);
}

// The general dark wash of bg-indigo-50 (the cursor's card) and its kin.
function cursorWash(): StyleRule {
  return ruleWhere((selectors: Array<string>): boolean => {
    return (
      selectors.includes(".bg-indigo-100") &&
      selectors.some((selector: string): boolean => {
        return selector.endsWith(".bg-indigo-50");
      })
    );
  }, "background-color");
}

// The general dark edge of border-indigo-300 (the cursor's card) and its kin.
function cursorEdge(): StyleRule {
  return ruleWhere((selectors: Array<string>): boolean => {
    return selectors.includes(".border-indigo-300");
  }, "border-color");
}

describe("Theme.css: the products menu's current page card in the dark theme", () => {
  test("it is the cursor's indigo, at well under half its wash", () => {
    const current: { rgb: string; alpha: number } = channelsOf(
      currentRule("background-color").declarations["background-color"]!,
    );
    const cursor: { rgb: string; alpha: number } = channelsOf(
      cursorWash().declarations["background-color"]!,
    );

    expect(current.rgb).toBe(cursor.rgb);
    expect(current.alpha).toBeGreaterThan(0);
    expect(current.alpha).toBeLessThanOrEqual(cursor.alpha / 2);
  });

  test("its edge is fainter than the cursor's, and still there", () => {
    const current: { rgb: string; alpha: number } = channelsOf(
      currentRule("border-color").declarations["border-color"]!,
    );
    const cursor: { rgb: string; alpha: number } = channelsOf(
      cursorEdge().declarations["border-color"]!,
    );

    expect(current.rgb).toBe(cursor.rgb);
    expect(current.alpha).toBeGreaterThan(0);
    expect(current.alpha).toBeLessThanOrEqual(cursor.alpha / 2);
  });
});

function product(title: string, category: string, path: string): MoreMenuItem {
  return {
    title,
    description: `${title} does its job.`,
    route: new Route(path),
    icon: IconProp.Cube,
    category,
  };
}

const CATALOG: Array<MoreMenuItem> = [
  product("Monitors", "Essentials", "/p/monitors"),
  product("Incidents", "Essentials", "/p/incidents"),
  product("Alerts", "Essentials", "/p/alerts"),
  product("Logs", "Observability", "/p/logs"),
  product("Traces", "Observability", "/p/traces"),
  product("Teams", "Settings", "/p/teams"),
];

function goTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
}

function linkOf(option: HTMLElement): HTMLElement {
  return within(option).getByRole("link");
}

function optionTitled(title: string): HTMLElement {
  return screen.getAllByRole("option").find((option: HTMLElement): boolean => {
    return option.querySelector("span.truncate")?.textContent === title;
  })!;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe.each([
  ["the Dashboard's menu, which folds", ["Essentials"]],
  ["a menu that shows every category", undefined],
])(
  "the rule reaches the current page's card, in %s",
  (_kind: string, categoriesOpenByDefault: Array<string> | undefined) => {
    function renderMenu(): void {
      render(
        <NavBarMenuModal
          items={CATALOG}
          categoriesOpenByDefault={categoriesOpenByDefault}
          onClose={() => {}}
        />,
      );
    }

    test("on an Essentials product's page, it marks that card and not the cursor's", () => {
      window.localStorage.setItem(
        RECENT_PRODUCTS_STORAGE_KEY,
        JSON.stringify(["/p/logs", "/p/teams"]),
      );
      goTo("/p/monitors/7");

      renderMenu();

      /*
       * A menu that shows every category has no Recently visited row (only
       * a menu that folds draws one), so it opens on the page's own card:
       * there the pointer takes the cursor to Logs.
       */
      if (!categoriesOpenByDefault) {
        fireEvent.mouseMove(optionTitled("Logs"));
      }

      // One card is the current page, for screen readers too.
      const current: Array<HTMLElement> = screen
        .getAllByRole("option")
        .filter((option: HTMLElement): boolean => {
          return option.getAttribute("aria-current") === "page";
        });
      expect(current).toEqual([optionTitled("Monitors")]);

      // The cursor is on Logs: the Recently visited row's first card.
      const cursor: HTMLElement = screen.getByRole("option", {
        selected: true,
      });
      expect(cursor.querySelector("span.truncate")).toHaveTextContent("Logs");
      expect(cursor).not.toHaveAttribute("aria-current");

      expect(linkOf(current[0]!)).toHaveClass(
        "border-indigo-100",
        "bg-indigo-50/40",
      );
      expect(linkOf(cursor)).toHaveClass("border-indigo-300", "bg-indigo-50");
      expect(linkOf(current[0]!).matches(CURRENT_CARD_SELECTOR)).toBe(true);
      expect(linkOf(cursor).matches(CURRENT_CARD_SELECTOR)).toBe(false);
    });

    test("with the cursor on it, it is drawn as the cursor's card and stays the current page", () => {
      goTo("/p/monitors/7");

      renderMenu();

      // Nothing remembered: the menu opens on the current page's product.
      const monitors: HTMLElement = optionTitled("Monitors");
      expect(monitors).toHaveAttribute("aria-selected", "true");
      expect(monitors).toHaveAttribute("aria-current", "page");
      expect(linkOf(monitors)).toHaveClass("bg-indigo-50", "border-indigo-300");
      expect(linkOf(monitors).matches(CURRENT_CARD_SELECTOR)).toBe(false);

      // The pointer moves to another card: Monitors goes back to faint.
      fireEvent.mouseMove(optionTitled("Incidents"));

      expect(monitors).toHaveAttribute("aria-selected", "false");
      expect(monitors).toHaveAttribute("aria-current", "page");
      expect(linkOf(monitors).matches(CURRENT_CARD_SELECTOR)).toBe(true);
    });

    test("on Home, no card is the current page", () => {
      window.localStorage.setItem(
        RECENT_PRODUCTS_STORAGE_KEY,
        JSON.stringify(["/p/logs"]),
      );
      goTo("/p/home");

      renderMenu();

      expect(
        screen.getAllByRole("option").filter((option: HTMLElement) => {
          return option.hasAttribute("aria-current");
        }),
      ).toEqual([]);
      expect(document.querySelectorAll(CURRENT_CARD_SELECTOR)).toHaveLength(0);
    });
  },
);
