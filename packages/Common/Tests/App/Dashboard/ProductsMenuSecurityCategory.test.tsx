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
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  MoreMenuItem,
  isMoreMenuItemActive,
} from "../../../UI/Components/Navbar/NavBar";
import {
  CATEGORY_FOLDS_STORAGE_KEY,
  MenuCategory,
  groupItemsByCategory,
} from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import Navigation from "../../../UI/Utils/Navigation";
import ExploreProducts from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * Issue #5550: "Move Data Security and Security Events into different
 * category called Security". The products menu filed both under
 * Observability, beside Logs, Metrics and Traces. They are a category of
 * their own now, Security, right after Observability, so they are still
 * found where people looked for them.
 *
 * This reads the real catalog (useDashboardNavigationItems), mounts the
 * real nav bar and Home's Explore OneUptime card, and walks the real
 * Navigation to the products' own pages. react-i18next answers from the
 * real locale files, so the words asserted here are the words on the
 * screen, in every language the Dashboard ships.
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

// Every language the Dashboard ships, by its locale file.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const EN: LocaleData = readLocale("en");

let activeLocale: LocaleData = EN;
let activeLanguage: string = "en";

function useLanguage(code: string): void {
  activeLocale = readLocale(code);
  activeLanguage = code;
}

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

// What a nested key reads in the active language: the copy users see.
function copy(key: string): string {
  const value: string | undefined = lookupNested(activeLocale, key);
  if (!value) {
    throw new Error(`Missing locale key ${key} in ${activeLanguage}`);
  }
  return value;
}

/*
 * Answers react-i18next from the real locale files, both ways the Dashboard
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
        i18n: { language: activeLanguage },
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
    key: "products-menu-security-category",
  });
}

// The address a route pattern stands for, with every parameter filled in.
function addressOf(pattern: string): string {
  return pattern
    .replace(":projectId", PROJECT_ID)
    .replace(/:[A-Za-z]+/g, RECORD_ID);
}

// Every page the Dashboard routes to under /dashboard/:projectId/<area>.
function pagesUnder(area: string): Array<string> {
  return Object.values(RouteMap)
    .map((route: Route): string => {
      return route.toString();
    })
    .filter((pattern: string): boolean => {
      return (
        (pattern === `/dashboard/:projectId/${area}` ||
          pattern.startsWith(`/dashboard/:projectId/${area}/`)) &&
        !pattern.endsWith("/*")
      );
    });
}

function readCatalog(): DashboardNavigationItems {
  return renderHook(() => {
    return useDashboardNavigationItems();
  }).result.current;
}

function titlesIn(
  catalog: DashboardNavigationItems,
  category: string,
): Array<string> {
  return catalog.moreMenuItems
    .filter((item: MoreMenuItem): boolean => {
      return item.category === category;
    })
    .map((item: MoreMenuItem): string => {
      return item.title;
    });
}

function categoryNames(catalog: DashboardNavigationItems): Array<string> {
  return groupItemsByCategory(catalog.moreMenuItems).map(
    (category: MenuCategory): string => {
      return category.title;
    },
  );
}

function itemTitled(
  catalog: DashboardNavigationItems,
  title: string,
): MoreMenuItem {
  const item: MoreMenuItem | undefined = catalog.moreMenuItems.find(
    (candidate: MoreMenuItem): boolean => {
      return candidate.title === title;
    },
  );
  if (!item) {
    throw new Error(`No product titled ${title}`);
  }
  return item;
}

function productsMenu(): HTMLElement {
  // The dialog's name is translated like everything else in it.
  return screen.getByRole("dialog", {
    name: String(activeLocale["Products menu"] ?? "Products menu"),
  });
}

// The rows that open and fold a category of the menu, top to bottom.
function categoryRows(): Array<HTMLElement> {
  return within(productsMenu())
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });
}

function categoryRow(name: string): HTMLElement {
  return within(productsMenu()).getByRole("button", { name: name });
}

// The button after "Home /": the current product, or "Products" for none.
function productButton(): HTMLElement {
  const nav: HTMLElement = screen.getByTestId("nav-children");
  const buttons: Array<HTMLElement> = within(nav).getAllByRole("button");
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

function openProductsMenu(pathname: string): void {
  goTo(pathname);
  render(<DashboardNavbar show={true} />);
  fireEvent.click(productButton());
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

// A product's title, as its card in the menu draws it.
function optionTitle(option: HTMLElement): string {
  return option.querySelector(".truncate")?.textContent || "";
}

// The products the menu lists under a category's heading, as drawn.
function productsUnderHeading(name: string): Array<HTMLElement> {
  const heading: HTMLElement | undefined = Array.from(
    within(productsMenu()).getByRole("listbox").querySelectorAll("h3"),
  ).find((candidate: HTMLHeadingElement): boolean => {
    return candidate.textContent === name;
  });
  if (!heading) {
    throw new Error(`No category headed ${name}`);
  }
  const group: HTMLElement = heading.closest('[role="group"]') as HTMLElement;
  return within(group).getAllByRole("option");
}

function search(query: string): void {
  fireEvent.change(within(productsMenu()).getByRole("combobox"), {
    target: { value: query },
  });
}

// The headings the menu shows, top to bottom.
function headingsShown(): Array<string> {
  return Array.from(
    within(productsMenu()).getByRole("listbox").querySelectorAll("h3"),
  ).map((heading: HTMLHeadingElement): string => {
    return heading.textContent || "";
  });
}

const HOME: string = `/dashboard/${PROJECT_ID}/home/`;

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  useLanguage("en");
  setViewportWidth(1440);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  setViewportWidth(ORIGINAL_INNER_WIDTH);
  (Navigation as unknown as { location: unknown }).location = undefined;
});

describe("the Security category, in the catalog", () => {
  test("files Security Events and Data Security under Security, and nothing else", () => {
    const catalog: DashboardNavigationItems = readCatalog();

    expect(titlesIn(catalog, "Security")).toEqual([
      "Security Events",
      "Data Security",
    ]);
    expect(itemTitled(catalog, "Security Events").category).toBe("Security");
    expect(itemTitled(catalog, "Data Security").category).toBe("Security");
  });

  test("comes right after Observability and before AI", () => {
    const names: Array<string> = categoryNames(readCatalog());

    expect(names.indexOf("Security")).toBeGreaterThan(0);
    expect(names.indexOf("Security")).toBe(names.indexOf("Observability") + 1);
    expect(names[names.indexOf("Security") + 1]).toBe("AI");
    expect(names).toEqual([
      "Essentials",
      "Observability",
      "Security",
      "AI",
      "Code",
      "Resources",
      "Infrastructure",
      "Cloud",
      "Dashboards & Automation",
      "Settings",
    ]);
  });

  test("its products follow each other in the list, so the category is drawn once", () => {
    const items: Array<MoreMenuItem> = readCatalog().moreMenuItems;
    const security: Array<number> = items
      .map((item: MoreMenuItem, index: number): number => {
        return item.category === "Security" ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    expect(security).toHaveLength(2);
    expect(security[1]).toBe(security[0]! + 1);
    expect(items[security[0]! - 1]!.category).toBe("Observability");
  });

  test("leaves Observability what you watch your systems with", () => {
    const catalog: DashboardNavigationItems = readCatalog();

    expect(titlesIn(catalog, "Observability")).toEqual([
      "Logs",
      "Metrics",
      "Traces",
      "Profiles",
      "Exceptions",
      "AI / LLM",
      "Data Observability",
      "Topology",
    ]);
    expect(titlesIn(catalog, "Observability")).not.toContain("Security Events");
    expect(titlesIn(catalog, "Observability")).not.toContain("Data Security");
  });

  test("moved the two products and lost none: 47 products, each listed once", () => {
    const titles: Array<string> = readCatalog().moreMenuItems.map(
      (item: MoreMenuItem): string => {
        return item.title;
      },
    );

    // 45 when #5592 moved them; Data Observability (#5647) is the 46th, OpenStack (#5676) the 47th.
    expect(titles).toHaveLength(47);
    expect(new Set(titles).size).toBe(47);
  });

  test("folds like every category but Essentials: the menu does not open on it", () => {
    const catalog: DashboardNavigationItems = readCatalog();

    expect(catalog.moreMenuCategoriesOpenByDefault).toEqual(["Essentials"]);
    expect(catalog.moreMenuCategoriesOpenByDefault).not.toContain("Security");
  });

  test("each product still opens on its overview and stays lit on every page of its own", () => {
    const catalog: DashboardNavigationItems = readCatalog();
    const securityEvents: MoreMenuItem = itemTitled(catalog, "Security Events");
    const dataSecurity: MoreMenuItem = itemTitled(catalog, "Data Security");

    expect(securityEvents.route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/overview`,
    );
    expect(securityEvents.activeRoute?.toString()).toBe(
      RouteMap[PageMap.SECURITY_EVENTS]!.toString(),
    );
    expect(dataSecurity.route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/data-security/overview`,
    );
    expect(dataSecurity.activeRoute?.toString()).toBe(
      RouteMap[PageMap.DATA_SECURITY]!.toString(),
    );
  });

  test("keeps each product's words, icon and colour", () => {
    const catalog: DashboardNavigationItems = readCatalog();
    const securityEvents: MoreMenuItem = itemTitled(catalog, "Security Events");
    const dataSecurity: MoreMenuItem = itemTitled(catalog, "Data Security");

    expect(securityEvents.description).toBe(
      copy("navbar.items.securityEventsDescription"),
    );
    expect(securityEvents.icon).toBe(IconProp.ShieldExclamation);
    expect(securityEvents.iconColor).toBe("rose");
    expect(securityEvents.keywords).toEqual(
      expect.arrayContaining(["siem", "soar", "security cases"]),
    );

    expect(dataSecurity.description).toBe(
      copy("navbar.items.dataSecurityDescription"),
    );
    expect(dataSecurity.icon).toBe(IconProp.ShieldCheck);
    expect(dataSecurity.iconColor).toBe("violet");
    expect(dataSecurity.keywords).toEqual(
      expect.arrayContaining(["dspm", "pii", "sensitive data"]),
    );
  });
});

describe("the Security category, in the products menu", () => {
  test("is a folded row right after Observability", () => {
    openProductsMenu(HOME);

    const names: Array<string> = categoryRows().map(
      (row: HTMLElement): string => {
        return row.textContent || "";
      },
    );

    expect(names.indexOf("Security")).toBe(names.indexOf("Observability") + 1);
    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "false");
    expect(categoryRow("Observability")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("its folded row names both products and says how many", () => {
    openProductsMenu(HOME);

    expect(categoryRow("Security")).toHaveAccessibleDescription(
      "2 products Security Events, Data Security",
    );
    expect(categoryRow("Observability")).toHaveAccessibleDescription(
      "8 products Logs, Metrics, Traces, Profiles, Exceptions, AI / LLM, Data Observability, Topology",
    );
  });

  test("while it is folded, neither product is drawn as a card", () => {
    openProductsMenu(HOME);

    const titles: Array<string> = within(productsMenu())
      .queryAllByRole("option")
      .map(optionTitle);

    expect(titles).not.toContain("Security Events");
    expect(titles).not.toContain("Data Security");
  });

  test("one click opens it on Security Events and Data Security, each saying what it does", () => {
    openProductsMenu(HOME);

    fireEvent.click(categoryRow("Security"));

    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "true");
    const options: Array<HTMLElement> = productsUnderHeading("Security");
    expect(options.map(optionTitle)).toEqual([
      "Security Events",
      "Data Security",
    ]);
    expect(options[0]).toHaveTextContent(
      copy("navbar.items.securityEventsDescription"),
    );
    expect(options[1]).toHaveTextContent(
      copy("navbar.items.dataSecurityDescription"),
    );
    // Observability stays folded: opening one row opens only that one.
    expect(categoryRow("Observability")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("each card links to its product's overview", () => {
    openProductsMenu(HOME);
    fireEvent.click(categoryRow("Security"));

    const [securityEvents, dataSecurity] = productsUnderHeading("Security");

    expect(within(securityEvents!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/overview`,
    );
    expect(within(dataSecurity!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/data-security/overview`,
    );
  });

  test("opening Observability no longer shows either security product", () => {
    openProductsMenu(HOME);

    fireEvent.click(categoryRow("Observability"));

    const titles: Array<string> =
      productsUnderHeading("Observability").map(optionTitle);
    expect(titles).toEqual([
      "Logs",
      "Metrics",
      "Traces",
      "Profiles",
      "Exceptions",
      "AI / LLM",
      "Data Observability",
      "Topology",
    ]);
    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    ["siem", "Security Events"],
    ["soar", "Security Events"],
    ["security cases", "Security Events"],
    ["mitre", "Security Events"],
    ["dspm", "Data Security"],
    ["gdpr", "Data Security"],
    ["data classification", "Data Security"],
  ])(
    "searching %p finds %s under the Security heading, though the row is folded",
    (query: string, title: string) => {
      openProductsMenu(HOME);
      expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "false");

      search(query);

      const options: Array<HTMLElement> =
        within(productsMenu()).getAllByRole("option");
      expect(options.map(optionTitle)).toEqual([title]);
      expect(headingsShown()).toEqual(["Security"]);
    },
  );

  test("searching 'security' finds both products, together under Security", () => {
    openProductsMenu(HOME);

    search("security");

    expect(productsUnderHeading("Security").map(optionTitle)).toEqual([
      "Security Events",
      "Data Security",
    ]);
    expect(headingsShown()).not.toContain("Observability");
  });

  test("opening the row is remembered on the browser, as for the other folded rows", () => {
    openProductsMenu(HOME);
    fireEvent.click(categoryRow("Security"));

    expect(
      JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)!),
    ).toEqual({ Security: true });

    cleanup();
    openProductsMenu(HOME);

    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "true");
    expect(productsUnderHeading("Security").map(optionTitle)).toEqual([
      "Security Events",
      "Data Security",
    ]);
  });

  test("folding it again is remembered too", () => {
    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify({ Security: true }),
    );
    openProductsMenu(HOME);
    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(categoryRow("Security"));

    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "false");
    expect(
      JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)!),
    ).toEqual({ Security: false });
  });
});

describe("on a page of a security product", () => {
  test.each([
    [`/dashboard/${PROJECT_ID}/security-events/overview`, "Security Events"],
    [`/dashboard/${PROJECT_ID}/security-events/cases`, "Security Events"],
    [
      `/dashboard/${PROJECT_ID}/security-events/cases/${RECORD_ID}`,
      "Security Events",
    ],
    [`/dashboard/${PROJECT_ID}/data-security/overview`, "Data Security"],
    [`/dashboard/${PROJECT_ID}/data-security/stores`, "Data Security"],
    [
      `/dashboard/${PROJECT_ID}/data-security/stores/${RECORD_ID}`,
      "Data Security",
    ],
  ])(
    "on %s the nav bar names %s, and the menu opens Security on it",
    (pathname: string, title: string) => {
      openProductsMenu(pathname);

      expect(productButton()).toHaveTextContent(title);
      expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "true");
      // Only the category of the page you are on opens by itself.
      expect(categoryRow("Observability")).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      const current: Array<HTMLElement> = within(productsMenu())
        .getAllByRole("option")
        .filter((option: HTMLElement): boolean => {
          return option.getAttribute("aria-current") === "page";
        });
      expect(current.map(optionTitle)).toEqual([title]);
      expect(productsUnderHeading("Security")).toContain(current[0]);
    },
  );

  test("the sweep sees the products' pages", () => {
    // A broken filter must not pass by finding nothing to check.
    expect(pagesUnder("security-events").length).toBeGreaterThan(30);
    expect(pagesUnder("data-security").length).toBeGreaterThan(15);
  });

  test.each([
    ["security-events", "Security Events"],
    ["data-security", "Data Security"],
  ])(
    "every page under /%s lights %s, a product of the Security category, and nothing else",
    (area: string, title: string) => {
      const catalog: DashboardNavigationItems = readCatalog();

      for (const pattern of pagesUnder(area)) {
        goTo(addressOf(pattern));

        const lit: Array<MoreMenuItem> = catalog.moreMenuItems.filter(
          (item: MoreMenuItem): boolean => {
            return isMoreMenuItemActive(item);
          },
        );

        expect({
          pattern: pattern,
          lit: lit.map((item: MoreMenuItem): string => {
            return `${item.category} / ${item.title}`;
          }),
        }).toEqual({ pattern: pattern, lit: [`Security / ${title}`] });
      }
    },
  );

  test("a page of Observability opens Observability, not Security", () => {
    openProductsMenu(`/dashboard/${PROJECT_ID}/logs`);

    expect(categoryRow("Observability")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(categoryRow("Security")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Home's Explore OneUptime card", () => {
  function renderCard(): void {
    goTo(HOME);
    render(
      <MemoryRouter>
        <ExploreProducts projectId={PROJECT_ID} />
      </MemoryRouter>,
    );
  }

  function tabs(): Array<HTMLElement> {
    return screen.getAllByTestId("home-explore-tab");
  }

  function tabName(tab: HTMLElement): string {
    return (tab.firstChild?.textContent || "").trim();
  }

  function securityTab(): HTMLElement {
    const tab: HTMLElement | undefined = tabs().find(
      (candidate: HTMLElement): boolean => {
        return tabName(candidate) === "Security";
      },
    );
    if (!tab) {
      throw new Error("No Security tab");
    }
    return tab;
  }

  test("has a Security tab right after Observability, counting two products", () => {
    renderCard();

    const names: Array<string> = tabs().map(tabName);
    expect(names.indexOf("Security")).toBe(names.indexOf("Observability") + 1);
    expect(securityTab()).toHaveTextContent(/^Security2$/);
    expect(
      tabs().find((tab: HTMLElement): boolean => {
        return tabName(tab) === "Observability";
      }),
    ).toHaveTextContent(/^Observability8$/);
  });

  test("the Security tab lists Security Events and Data Security, linking to their overviews", () => {
    renderCard();

    fireEvent.click(securityTab());

    const panel: HTMLElement = screen.getByTestId("home-explore-panel");
    expect(securityTab()).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("data-category", "Security");
    expect(panel).toHaveAttribute("aria-labelledby", securityTab().id);
    expect(
      within(panel)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return link.getAttribute("href") || "";
        }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/security-events/overview`,
      `/dashboard/${PROJECT_ID}/data-security/overview`,
    ]);
    expect(panel).toHaveTextContent("Security Events");
    expect(panel).toHaveTextContent("Data Security");
    expect(panel).not.toHaveTextContent("Logs");
  });
});

describe("in every language the Dashboard ships", () => {
  test("the sweep sees every language", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test.each(LANGUAGES)(
    "%s files both security products under its Security category, right after Observability",
    (code: string) => {
      useLanguage(code);
      const catalog: DashboardNavigationItems = readCatalog();
      const security: string = copy("navbar.categories.security");
      const observability: string = copy("navbar.categories.observability");

      expect(titlesIn(catalog, security)).toEqual([
        copy("navbar.items.securityEventsTitle"),
        copy("navbar.items.dataSecurityTitle"),
      ]);
      expect(titlesIn(catalog, observability)).toHaveLength(8);

      const names: Array<string> = categoryNames(catalog);
      expect(names.indexOf(security)).toBe(names.indexOf(observability) + 1);
      expect(new Set(names).size).toBe(names.length);
    },
  );

  test.each(LANGUAGES)(
    "%s names the category with the Dashboard's own word for Security, apart from every other category",
    (code: string) => {
      const locale: LocaleData = readLocale(code);
      const categories: Record<string, string> = (
        locale["navbar"] as { categories: Record<string, string> }
      ).categories;
      const security: string | undefined = categories["security"];

      expect(security?.trim()).toBeTruthy();
      expect(security).toBe(locale["Security"]);
      expect(
        Object.entries(categories).filter(
          ([key, name]: [string, string]): boolean => {
            return key !== "security" && name === security;
          },
        ),
      ).toEqual([]);
      if (code !== "en") {
        expect(security).not.toBe("Security");
      }
    },
  );

  test("in German the row reads Sicherheit and opens on the German products", () => {
    useLanguage("de");
    openProductsMenu(HOME);

    const row: HTMLElement = categoryRow("Sicherheit");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveAccessibleDescription(
      /Sicherheitsereignisse, Datensicherheit$/,
    );
    expect(
      within(productsMenu()).queryByRole("button", { name: "Security" }),
    ).toBeNull();

    fireEvent.click(row);

    expect(productsUnderHeading("Sicherheit").map(optionTitle)).toEqual([
      "Sicherheitsereignisse",
      "Datensicherheit",
    ]);
  });

  test("in Japanese a Security Events page opens the Japanese Security row", () => {
    useLanguage("ja");
    openProductsMenu(`/dashboard/${PROJECT_ID}/security-events/overview`);

    expect(productButton()).toHaveTextContent("セキュリティイベント");
    expect(categoryRow("セキュリティ")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(productsUnderHeading("セキュリティ").map(optionTitle)).toEqual([
      "セキュリティイベント",
      "データセキュリティ",
    ]);
  });
});
