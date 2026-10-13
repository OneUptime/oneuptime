import {
  afterEach,
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
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Home's "Explore OneUptime" card (Components/Home/ExploreProducts.tsx): the
 * products menu's own catalog laid out on Home, one category at a time, so
 * a team finds the products it has not used yet. It reads the very list the
 * products menu draws (useDashboardNavigationItems), so the two never drift
 * apart: same products, same words, same order. Project settings are left
 * out. react-i18next answers from the REAL locale files, nested keys
 * included, as the navigation catalog reads them.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const EN: LocaleData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as LocaleData;
const DE: LocaleData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as LocaleData;

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

const analyticsMock: MockFunction = getJestMockFunction();

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
            (typeof activeLocale[key] === "string"
              ? (activeLocale[key] as string)
              : undefined) ??
            (typeof options === "string" ? options : key)
          );
        },
        i18n: { language: activeLocale === DE ? "de" : "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return analyticsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import ExploreProducts, {
  getExploreCategories,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import {
  DashboardNavigationItems,
  useDashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import { MenuCategory } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

function catalog(): DashboardNavigationItems {
  return renderHook(() => {
    return useDashboardNavigationItems();
  }).result.current;
}

function settingsCategory(): string {
  return lookupNested(activeLocale, "navbar.categories.settings") || "";
}

function renderCard(): void {
  render(
    <MemoryRouter>
      <ExploreProducts projectId={PROJECT_ID} />
    </MemoryRouter>,
  );
}

function tabs(): Array<HTMLElement> {
  return screen.getAllByTestId("home-explore-tab");
}

function panelTitles(): Array<string> {
  return within(screen.getByTestId("home-explore-panel"))
    .getAllByTestId("home-explore-product")
    .map((element: HTMLElement): string => {
      return (
        element.querySelector(".truncate")?.textContent?.trim() ||
        element.textContent ||
        ""
      );
    });
}

beforeEach(() => {
  activeLocale = EN;
  currentProjectId = new ObjectID(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  analyticsMock.mockReset();
});

describe("the categories", () => {
  test("the products menu's categories, in its order, without project settings", () => {
    const expected: Array<string> = getExploreCategories({
      items: catalog().moreMenuItems,
      settingsCategory: settingsCategory(),
    }).map((category: MenuCategory): string => {
      return category.title;
    });

    renderCard();

    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(expected).not.toContain(settingsCategory());
    expect(
      tabs().map((tab: HTMLElement): string => {
        return (tab.firstChild?.textContent || "").trim();
      }),
    ).toEqual(expected);
    expect(expected[0]).toBe(
      lookupNested(EN, "navbar.categories.essentials"),
    );
  });

  test("every product but the settings pages is in exactly one category", () => {
    const items: Array<MoreMenuItem> = catalog().moreMenuItems;
    const categories: Array<MenuCategory> = getExploreCategories({
      items,
      settingsCategory: settingsCategory(),
    });
    const listed: Array<string> = categories.flatMap(
      (category: MenuCategory): Array<string> => {
        return category.items.map((item: MoreMenuItem): string => {
          return item.title;
        });
      },
    );
    const products: Array<string> = items
      .filter((item: MoreMenuItem): boolean => {
        return item.category !== settingsCategory();
      })
      .map((item: MoreMenuItem): string => {
        return item.title;
      });

    expect(listed).toEqual(products);
    expect(new Set(listed).size).toBe(listed.length);
  });

  test("each tab says how many products it holds", () => {
    const categories: Array<MenuCategory> = getExploreCategories({
      items: catalog().moreMenuItems,
      settingsCategory: settingsCategory(),
    });

    renderCard();

    tabs().forEach((tab: HTMLElement, index: number): void => {
      expect(tab).toHaveTextContent(String(categories[index]!.items.length));
    });
  });
});

describe("the panel", () => {
  test("opens on Essentials: Monitors, Incidents, Alerts and the rest of the core", () => {
    renderCard();

    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveAttribute("aria-selected", "false");
    expect(panelTitles().slice(0, 3)).toEqual([
      lookupNested(EN, "navbar.items.monitorsTitle"),
      lookupNested(EN, "navbar.items.incidentsTitle"),
      lookupNested(EN, "navbar.items.alertsTitle"),
    ]);
  });

  test("every product says what it is for and opens its product", () => {
    const essentials: MenuCategory = getExploreCategories({
      items: catalog().moreMenuItems,
      settingsCategory: settingsCategory(),
    })[0]!;

    renderCard();

    const cards: Array<HTMLElement> = within(
      screen.getByTestId("home-explore-panel"),
    ).getAllByTestId("home-explore-product");

    expect(cards).toHaveLength(essentials.items.length);
    cards.forEach((card: HTMLElement, index: number): void => {
      const item: MoreMenuItem = essentials.items[index]!;
      expect(card).toHaveTextContent(item.title);
      if (item.description) {
        expect(card).toHaveTextContent(item.description);
      }
      expect(card.closest("a")?.getAttribute("href")).toBe(
        item.route.toString(),
      );
      expect(item.route.toString()).toContain(PROJECT_ID);
    });
  });

  test("a tab shows its own products, and is recorded", () => {
    const categories: Array<MenuCategory> = getExploreCategories({
      items: catalog().moreMenuItems,
      settingsCategory: settingsCategory(),
    });

    renderCard();
    fireEvent.click(tabs()[1]!);

    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("home-explore-panel")).toHaveAttribute(
      "data-category",
      categories[1]!.title,
    );
    expect(panelTitles()).toEqual(
      categories[1]!.items.map((item: MoreMenuItem): string => {
        return item.title;
      }),
    );
    expect(analyticsMock).toHaveBeenCalledWith(
      "dashboard/home/explore-category",
      { projectId: PROJECT_ID, category: categories[1]!.title },
    );
  });

  test("opening a product is recorded", () => {
    renderCard();

    fireEvent.click(
      within(screen.getByTestId("home-explore-panel")).getAllByTestId(
        "home-explore-product",
      )[0]!,
    );

    expect(analyticsMock).toHaveBeenCalledWith(
      "dashboard/home/explore-product",
      {
        projectId: PROJECT_ID,
        product: lookupNested(EN, "navbar.items.monitorsTitle"),
      },
    );
  });

  test("the panel is labelled by its tab, as a tab list's panel is", () => {
    renderCard();

    const panel: HTMLElement = screen.getByTestId("home-explore-panel");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs()[0]!.id);
    expect(tabs()[0]).toHaveAttribute("aria-controls", panel.id);
  });
});

describe("the keyboard", () => {
  test("only the selected tab is a tab stop", () => {
    renderCard();

    expect(tabs()[0]).toHaveAttribute("tabindex", "0");
    for (const tab of tabs().slice(1)) {
      expect(tab).toHaveAttribute("tabindex", "-1");
    }
  });

  test("arrows walk the tabs and wrap; Home and End jump to the ends", () => {
    renderCard();
    const count: number = tabs().length;

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs()[1]);

    fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(tabs()[count - 1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[count - 1]!, { key: "ArrowRight" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[0]!, { key: "End" });
    expect(tabs()[count - 1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[count - 1]!, { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("in German", () => {
  test("the categories and products are the products menu's German words", () => {
    activeLocale = DE;
    renderCard();

    const essentials: string | undefined = lookupNested(
      DE,
      "navbar.categories.essentials",
    );
    expect(essentials).toBeDefined();
    expect(essentials).not.toBe(lookupNested(EN, "navbar.categories.essentials"));
    expect(tabs()[0]).toHaveTextContent(essentials!);
    expect(screen.getByTestId("home-explore-panel")).toHaveTextContent(
      lookupNested(DE, "navbar.items.incidentsTitle")!,
    );
  });
});
