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
 * The Dashboard's products menu draws each category as a row of one list,
 * Essentials first, with an icon of its own: one that names the whole
 * category, chosen in the Dashboard's catalog (NavigationItems.tsx) by the
 * same translated name its products carry. A name that drifts from the
 * items' - or a category added without an icon - fails quietly: the row just
 * gets the menu's generic icon. These hold the catalog to giving every
 * category a distinct icon that Icon can draw, and the desktop menu and the
 * phone menu to drawing it.
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

const EXPECTED_ICONS: Record<string, IconProp> = {
  Essentials: IconProp.Star,
  Observability: IconProp.PresentationChartLine,
  AI: IconProp.Sparkles,
  Code: IconProp.Code,
  Resources: IconProp.Layers,
  Infrastructure: IconProp.ServerStack,
  "Dashboards & Automation": IconProp.Layout,
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

// Each command of an svg path and how many numbers it takes.
const PATH_ARGUMENTS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

// What separates a path's numbers, starts a command, and is one number.
const PATH_SEPARATOR: RegExp = /[\s,]/;
const PATH_COMMAND: RegExp = /[a-zA-Z]/;
const PATH_NUMBER: RegExp = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/*
 * A path's drawing, whatever notation it is written in: "M1 2 3 4" is
 * "M1 2L3 4", "-.5" is "-0.5", and the arc flags of "a4 4 0 00-3 3" are
 * "a4 4 0 0 0-3 3". Two icons can be written apart and draw the same thing.
 */
function canonicalPath(d: string): string {
  const parts: Array<string> = [];
  let at: number = 0;
  let command: string = "";
  let index: number = 0;

  const skipSeparators: () => void = (): void => {
    while (at < d.length && PATH_SEPARATOR.test(d[at]!)) {
      at++;
    }
  };

  while (true) {
    skipSeparators();
    if (at >= d.length) {
      break;
    }

    const char: string = d[at]!;

    if (PATH_COMMAND.test(char)) {
      command = char;
      index = 0;
      // "z" and "Z" both close the path.
      parts.push(command === "z" ? "Z" : command);
      at++;
      continue;
    }

    const lower: string = command.toLowerCase();
    const count: number = PATH_ARGUMENTS[lower]!;

    if (index > 0 && index % count === 0) {
      // The command repeats; after a moveto, it repeats as a lineto.
      if (lower === "m") {
        command = command === "m" ? "l" : "L";
      }
      parts.push(command);
    }

    const position: number = index % count;

    if (lower === "a" && (position === 3 || position === 4)) {
      // An arc's flags are one digit each, often written run together.
      parts.push(char);
      at++;
    } else {
      const match: RegExpExecArray | null = PATH_NUMBER.exec(d.slice(at));
      expect(match).not.toBeNull();
      parts.push(String(Number(match![0])));
      at += match![0].length;
    }

    index++;
  }

  return parts.join(" ");
}

// What <Icon icon={icon} /> draws, in any notation: see canonicalPath.
function drawingOf(icon: IconProp): string {
  return glyphOf(icon).replace(
    /\sd="([^"]*)"/g,
    (_whole: string, d: string): string => {
      return ` d="${canonicalPath(d)}"`;
    },
  );
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

describe("the Dashboard's catalog gives every category an icon", () => {
  test("one for each category, the essentials too, by the names the items carry", () => {
    const items: DashboardNavigationItems = catalog();
    const categories: Array<string> = Array.from(
      new Set(items.moreMenuItems.map(categoryOf)),
    );

    expect(categories).toEqual(CATEGORIES);
    expect(Object.keys(items.moreMenuCategoryIcons).sort()).toEqual(
      [...categories].sort(),
    );
  });

  test("each is the icon chosen for it", () => {
    expect(catalog().moreMenuCategoryIcons).toEqual(EXPECTED_ICONS);
  });

  test("drawings are compared by what they draw, not by how the path is written", () => {
    // Brain is the sparkles, written in another notation.
    expect(glyphOf(IconProp.Brain)).not.toBe(glyphOf(IconProp.Sparkles));
    expect(drawingOf(IconProp.Brain)).toBe(drawingOf(IconProp.Sparkles));
    // Automation is the processor chip.
    expect(drawingOf(IconProp.Automation)).toBe(drawingOf(IconProp.CPUChip));
    // And different icons stay different.
    expect(drawingOf(IconProp.Cog8Tooth)).not.toBe(
      drawingOf(IconProp.Settings),
    );
    expect(canonicalPath("M1 2 3 4")).toBe(canonicalPath("M1,2L3,4"));
    expect(canonicalPath("a4.5 4.5 0 00-3.09 3")).toBe(
      canonicalPath("a4.5 4.5 0 0 0 -3.09 3"),
    );
    expect(canonicalPath("l-.5 .25")).toBe(canonicalPath("l-0.5 0.25"));
    expect(canonicalPath("M1 2h3z")).toBe(canonicalPath("M1 2h3Z"));
    expect(canonicalPath("M1 2 3 4")).not.toBe(canonicalPath("M1 2 3 5"));
  });

  test("no two categories are drawn alike, and none with the menu's generic icon", () => {
    // By what is drawn: two IconProp names can draw the same glyph.
    const drawings: Array<string> = Object.values(
      catalog().moreMenuCategoryIcons,
    ).map(drawingOf);

    expect(new Set(drawings).size).toBe(drawings.length);
    expect(drawings).not.toContain(drawingOf(DEFAULT_CATEGORY_ICON));
  });

  test("Icon draws every one of them", () => {
    for (const [category, icon] of Object.entries(
      catalog().moreMenuCategoryIcons,
    )) {
      expect([category, glyphOf(icon).length > 0]).toEqual([category, true]);
    }
  });

  test("no category is drawn as a product it holds is", () => {
    const items: DashboardNavigationItems = catalog();

    for (const [category, icon] of Object.entries(
      items.moreMenuCategoryIcons,
    )) {
      const held: Array<string> = items.moreMenuItems
        .filter((item: MoreMenuItem): boolean => {
          return categoryOf(item) === category;
        })
        .map((item: MoreMenuItem): string => {
          return drawingOf(item.icon);
        });

      expect(held.length).toBeGreaterThan(0);
      expect([category, held.includes(drawingOf(icon))]).toEqual([
        category,
        false,
      ]);
    }
  });

  test("no category is drawn as any product in the menu is, but AI, whose sparkles mark AI across the app", () => {
    const items: DashboardNavigationItems = catalog();
    // Every product's drawing, whichever category it is in.
    const products: Map<string, Array<string>> = new Map();
    for (const item of items.moreMenuItems) {
      const drawing: string = drawingOf(item.icon);
      products.set(drawing, [...(products.get(drawing) || []), item.title]);
    }

    expect(products.size).toBeGreaterThan(20);
    for (const [category, icon] of Object.entries(
      items.moreMenuCategoryIcons,
    )) {
      expect([category, products.get(drawingOf(icon))]).toEqual([
        category,
        // The AI / LLM product, in Observability, wears the same mark.
        category === "AI" ? ["AI / LLM"] : undefined,
      ]);
    }
  });

  test("the essentials, which the menu opens on, are a row with an icon of their own too", () => {
    const items: DashboardNavigationItems = catalog();

    expect(items.moreMenuCategoriesOpenByDefault).toEqual(["Essentials"]);
    for (const category of items.moreMenuCategoriesOpenByDefault) {
      expect([category, items.moreMenuCategoryIcons[category]]).toEqual([
        category,
        IconProp.Star,
      ]);
    }
  });
});

describe("the desktop products menu draws them", () => {
  test("every category is a row of one list, drawn with its icon", () => {
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
  test("every category's row is drawn with its icon, before its name", () => {
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
