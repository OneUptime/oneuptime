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
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import {
  CATEGORY_LIST_COLUMNS,
  DEFAULT_CATEGORY_ICON,
} from "../../../UI/Components/Navbar/NavBarCategoryToggle";
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
 * The Dashboard's products menu draws each folded category as a row of one
 * list, with an icon of its own: one that names the whole category, chosen
 * in the Dashboard's catalog (NavigationItems.tsx) by the same translated
 * name its products carry. A name that drifts from the items' - or a
 * category added without an icon - fails quietly: the row just gets the
 * menu's generic icon. These hold the catalog to giving every folded
 * category a distinct icon that Icon can draw, and the desktop menu and the
 * phone menu to drawing it.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const FOLDED: Array<string> = [
  "Observability",
  "AI",
  "Code",
  "Resources",
  "Infrastructure",
  "Dashboards & Automation",
  "Settings",
];

const EXPECTED_ICONS: Record<string, IconProp> = {
  Observability: IconProp.PresentationChartLine,
  AI: IconProp.Sparkles,
  Code: IconProp.Code,
  Resources: IconProp.Layers,
  Infrastructure: IconProp.ServerStack,
  "Dashboards & Automation": IconProp.Automation,
  Settings: IconProp.Cog8Tooth,
};

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

// What <Icon icon={icon} /> draws, or "" when it draws nothing.
function glyphOf(icon: IconProp): string {
  const { container, unmount } = render(<Icon icon={icon} />);
  const markup: string = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return markup;
}

// The glyph a category's row draws for it: the first svg in its row.
function drawnIcon(scope: HTMLElement, category: string): string {
  const row: HTMLElement = within(scope)
    .getByRole("button", { name: category })
    .closest("div.relative") as HTMLElement;
  return row.querySelector("svg")!.innerHTML;
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

describe("the Dashboard's catalog gives every folded category an icon", () => {
  test("one for each category but the ones that are always open, by the names the items carry", () => {
    const items: DashboardNavigationItems = catalog();
    const folded: Array<string> = Array.from(
      new Set(items.moreMenuItems.map(categoryOf)),
    ).filter((category: string): boolean => {
      return !items.moreMenuCategoriesAlwaysOpen.includes(category);
    });

    expect(folded).toEqual(FOLDED);
    expect(Object.keys(items.moreMenuCategoryIcons).sort()).toEqual(
      [...folded].sort(),
    );
  });

  test("each is the icon chosen for it", () => {
    expect(catalog().moreMenuCategoryIcons).toEqual(EXPECTED_ICONS);
  });

  test("no two categories are drawn alike, and none with the menu's generic icon", () => {
    // By what is drawn: two IconProp names can draw the same glyph.
    const glyphs: Array<string> = Object.values(
      catalog().moreMenuCategoryIcons,
    ).map(glyphOf);

    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(glyphs).not.toContain(glyphOf(DEFAULT_CATEGORY_ICON));
  });

  test("Icon draws every one of them", () => {
    for (const [category, icon] of Object.entries(
      catalog().moreMenuCategoryIcons,
    )) {
      expect([category, glyphOf(icon).length > 0]).toEqual([category, true]);
    }
  });

  test("no category is drawn as a product it holds is, so the row names the whole category", () => {
    const items: DashboardNavigationItems = catalog();

    for (const [category, icon] of Object.entries(
      items.moreMenuCategoryIcons,
    )) {
      const productGlyphs: Array<string> = items.moreMenuItems
        .filter((item: MoreMenuItem): boolean => {
          return categoryOf(item) === category;
        })
        .map((item: MoreMenuItem): string => {
          return glyphOf(item.icon);
        });

      expect(productGlyphs.length).toBeGreaterThan(0);
      expect([category, productGlyphs.includes(glyphOf(icon))]).toEqual([
        category,
        false,
      ]);
    }
  });

  test("the essentials, which never fold, have no row and so no icon", () => {
    const items: DashboardNavigationItems = catalog();

    for (const category of items.moreMenuCategoriesAlwaysOpen) {
      expect(items.moreMenuCategoryIcons[category]).toBeUndefined();
    }
  });
});

describe("the desktop products menu draws them", () => {
  test("every folded category is a row of one list, drawn with its icon", () => {
    setViewportWidth(DESKTOP_WIDTH);
    render(withTranslation(<DashboardNavbar show={true} />));
    fireEvent.click(screen.getByRole("button", { name: "Products" }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });
    const lists: Array<HTMLElement> = Array.from(
      dialog.querySelectorAll<HTMLElement>("div"),
    ).filter((element: HTMLElement): boolean => {
      return element.classList.contains(CATEGORY_LIST_COLUMNS);
    });

    expect(lists).toHaveLength(1);
    for (const category of FOLDED) {
      expect(lists[0]).toContainElement(
        within(dialog).getByRole("button", { name: category }),
      );
      expect([category, drawnIcon(dialog, category)]).toEqual([
        category,
        glyphOf(EXPECTED_ICONS[category]!),
      ]);
    }
  });

  test("a translated menu finds the icons by the translated names", async () => {
    const french: i18n = createInstance();
    await french.use(initReactI18next).init({
      lng: "fr",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        fr: {
          translation: {
            navbar: {
              categories: { infrastructure: "Infrastructure (FR)" },
            },
          },
        },
      },
      interpolation: { escapeValue: false },
    });

    setViewportWidth(DESKTOP_WIDTH);
    render(
      <I18nextProvider i18n={french}>
        <DashboardNavbar show={true} />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Products" }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });

    expect(drawnIcon(dialog, "Infrastructure (FR)")).toBe(
      glyphOf(IconProp.ServerStack),
    );
  });
});

describe("the phone menu draws them", () => {
  test("every folded category's row is drawn with its icon, before its name", () => {
    setViewportWidth(MOBILE_WIDTH);
    render(withTranslation(<DashboardNavbar show={true} />));
    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));

    const menu: HTMLElement = screen
      .getByRole("link", { name: "Home" })
      .closest("nav") as HTMLElement;

    for (const category of FOLDED) {
      const heading: HTMLElement = within(menu).getByRole("heading", {
        level: 3,
        name: category,
      });

      expect([category, heading.querySelector("svg")!.innerHTML]).toEqual([
        category,
        glyphOf(EXPECTED_ICONS[category]!),
      ]);
      expect([category, drawnIcon(menu, category)]).toEqual([
        category,
        glyphOf(EXPECTED_ICONS[category]!),
      ]);
    }
  });
});
