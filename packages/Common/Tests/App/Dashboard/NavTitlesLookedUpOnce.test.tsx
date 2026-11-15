import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { NAVBAR_PINNED_ITEM_TEST_ID } from "../../../UI/Components/Navbar/NavBar";
import { rememberRecentProductRoute } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import Navigation from "../../../UI/Utils/Navigation";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * THE DASHBOARD'S NAV SAYS A PRODUCT'S NAME AS ITS LANGUAGE DOES (#7790).
 *
 * The Dashboard words its products itself (t("navbar.items.networkTitle")),
 * and the nav bar looked each name up again: in the bar, in a pinned
 * product's name and hover tip, and in the phone's menu. Where a
 * translation is itself an English key the reader saw the translation of
 * the translation: Spanish says "Red" for Network and "Rojo" for "Red", so
 * Network read "Rojo"; Dutch Home ("Start") read "Starten", Italian Logs
 * ("Log") and Queues ("Code") "Registro" and "Codice", German Profiles
 * ("Profile") "Profil". The products menu's own words - its footer, its
 * line for no results, its keyboard hint and its Recently visited row -
 * were looked up again the same way.
 *
 * Now the Dashboard says its words are in the reader's language already
 * (isTitleTranslated on each product, the isMoreMenu…Translated flags), and
 * the nav draws them as given. Here, with the Dashboard's own locale files,
 * every place a product is named reads its name, never the second lookup.
 */

type Locale = Record<string, unknown>;

// What a nested key reads in a language's file: the word the Dashboard says.
function wordIn(language: string, key: string): string {
  let cursor: unknown = readDashboardLocale(language);

  for (const part of key.split(".")) {
    cursor = (cursor as Locale)[part];
  }

  if (typeof cursor !== "string") {
    throw new Error(`No ${key} in ${language}`);
  }

  return cursor;
}

// What a word reads looked up again, as a shared component looks it up.
function lookedUpAgain(language: string, text: string): string {
  return i18next.t(text, {
    lng: language,
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

interface ProductName {
  language: string;
  key: string;
  product: ProductKey;
  page: string;
  // The Dashboard's word, and what it read looked up again.
  once: string;
  twice: string;
}

const PRODUCT_NAMES: Array<ProductName> = [
  {
    language: "es",
    key: "navbar.items.networkTitle",
    product: ProductKey.Network,
    page: PageMap.NETWORK_OVERVIEW,
    once: "Red",
    twice: "Rojo",
  },
  {
    language: "it",
    key: "navbar.items.logsTitle",
    product: ProductKey.Logs,
    page: PageMap.LOGS,
    once: "Log",
    twice: "Registro",
  },
  {
    language: "it",
    key: "navbar.items.queuesTitle",
    product: ProductKey.Queues,
    page: PageMap.MESSAGE_QUEUES,
    once: "Code",
    twice: "Codice",
  },
  {
    language: "de",
    key: "navbar.items.performanceProfilesTitle",
    product: ProductKey.Profiles,
    page: PageMap.PROFILES,
    once: "Profile",
    twice: "Profil",
  },
];

// The products menu's words, the Dashboard's own.
const MENU_WORD_KEYS: Array<string> = [
  "navbar.moreFooter.title",
  "navbar.moreFooter.description",
  "navbar.search.placeholder",
  "navbar.search.noResults",
  "navbar.search.hint",
  "navbar.search.recent",
];

// What each of them reads looked up again, in this test's Spanish.
const MENU_WORD_TWICE: string = "Rojo";

const ORIGINAL_WIDTH: number = window.innerWidth;

function given(extra: Partial<ProjectProductsAnswer>): void {
  ProjectProducts.setAnswer(PROJECT_ID, {
    ...getEmptyProjectProductsAnswer(),
    ...extra,
  });
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderNavBar(language: string, pathname: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  goTo(pathname);
  render(<DashboardNavbar show={true} />);
  await settle();
}

// The button after "Home /": the product the page belongs to.
function productButton(): HTMLElement {
  const buttons: Array<HTMLElement> = within(
    screen.getByTestId("nav-children"),
  ).getAllByRole("button");

  expect(buttons).toHaveLength(1);

  return buttons[0]!;
}

// Every link to an address, wherever the nav draws one: its words.
function linksTo(route: string): Array<string> {
  return Array.from(document.body.querySelectorAll("a"))
    .filter((link: HTMLAnchorElement): boolean => {
      return link.getAttribute("href") === route;
    })
    .map((link: HTMLAnchorElement): string => {
      return (link.textContent || "").trim();
    });
}

// The phone's nav, with the page's name and the menu's toggle.
function compactNav(): HTMLElement {
  return screen.getByTestId("mobile-nav-toggle").closest("nav") as HTMLElement;
}

function openPhoneMenu(): void {
  fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
}

/*
 * Every text a reader can see or hear: names, hover tips, placeholders,
 * and every line of text with nothing else in it.
 */
function drawnTexts(container: HTMLElement): Array<string> {
  const texts: Array<string> = [];

  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const value: string | null = element.getAttribute(attribute);

      if (value) {
        texts.push(value);
      }
    }

    if (element.children.length === 0) {
      const text: string = (element.textContent || "").trim();

      if (text) {
        texts.push(text);
      }
    }
  }

  return texts;
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  const spanish: Locale = { ...readDashboardLocale("es") };

  for (const key of MENU_WORD_KEYS) {
    spanish[wordIn("es", key)] = MENU_WORD_TWICE;
  }

  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: spanish },
      nl: { translation: readDashboardLocale("nl") },
      it: { translation: readDashboardLocale("it") },
      de: { translation: readDashboardLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  ProjectProducts.reset();
  // Never the network: each test hands the store its answer.
  ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
    return ProjectProducts.getState(PROJECT_ID).answer;
  });
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest.spyOn(ProductEvents, "send").mockImplementation((() => {}) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("a product's name that is another English key, looked up again", () => {
  test.each(PRODUCT_NAMES)(
    "$language: the Dashboard's $once reads $twice",
    (name: ProductName) => {
      expect(wordIn(name.language, name.key)).toBe(name.once);
      expect(lookedUpAgain(name.language, name.once)).toBe(name.twice);
    },
  );

  test("nl: the Dashboard's Start, its Home, reads Starten", () => {
    expect(wordIn("nl", "navbar.home")).toBe("Start");
    expect(lookedUpAgain("nl", "Start")).toBe("Starten");
  });
});

describe("the nav bar names a product as the Dashboard words it", () => {
  test.each(PRODUCT_NAMES)(
    "$language: on its page and pinned, $once, never $twice",
    async (name: ProductName) => {
      given({ pinned: [name.product] });
      await renderNavBar(name.language, routeFor(name.page));

      // The product the page belongs to, after "Home /".
      expect(productButton().textContent?.trim()).toBe(name.once);

      // Pinned beside it: its name, its hover tip and what a reader hears.
      const pinned: HTMLElement = screen.getByTestId(
        NAVBAR_PINNED_ITEM_TEST_ID,
      );

      expect(pinned.textContent?.trim()).toBe(name.once);
      expect(pinned).toHaveAttribute("title", name.once);
      expect(pinned).toHaveAttribute("aria-label", name.once);
      expect(drawnTexts(document.body)).not.toContain(name.twice);
    },
  );

  test.each(PRODUCT_NAMES)(
    "$language: on a phone, on its page and in the menu, $once, never $twice",
    async (name: ProductName) => {
      setViewportWidth(MOBILE_WIDTH);
      given({ pinned: [name.product] });
      await renderNavBar(name.language, routeFor(name.page));

      const pageName: HTMLElement = compactNav().querySelector(
        "a",
      ) as HTMLElement;

      expect(pageName.textContent?.trim()).toBe(name.once);

      openPhoneMenu();
      await settle();

      // Pinned at the top, and under its category.
      const rows: Array<string> = linksTo(routeFor(name.page));

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows).toEqual(
        rows.map((): string => {
          return name.once;
        }),
      );
    },
  );

  test("nl: Home reads Start - in the bar, and on a phone - never Starten", async () => {
    const home: string = routeFor(PageMap.HOME);

    await renderNavBar("nl", home);

    expect(linksTo(home)).toEqual(["Start"]);
    expect(drawnTexts(document.body)).not.toContain("Starten");
    cleanup();

    setViewportWidth(MOBILE_WIDTH);
    await renderNavBar("nl", home);

    expect(
      (compactNav().querySelector("a") as HTMLElement).textContent?.trim(),
    ).toBe("Start");

    openPhoneMenu();
    await settle();

    expect(linksTo(home)).toEqual(["Start"]);
    expect(drawnTexts(document.body)).not.toContain("Starten");
  });
});

describe("the products menu says its words as the Dashboard words them", () => {
  test("es: its search, its footer, its keyboard hint, its recent row and its line for no results", async () => {
    rememberRecentProductRoute(routeFor(PageMap.LOGS));
    await renderNavBar("es", routeFor(PageMap.NETWORK_OVERVIEW));

    fireEvent.click(productButton());
    await settle();

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: lookedUpAgain("es", "Products menu"),
    });

    expect(within(menu).getByRole("combobox")).toHaveAttribute(
      "placeholder",
      wordIn("es", "navbar.search.placeholder"),
    );
    expect(
      within(menu).getByText(wordIn("es", "navbar.moreFooter.title")),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText(wordIn("es", "navbar.moreFooter.description")),
    ).toBeInTheDocument();
    expect(
      within(menu).getByLabelText(wordIn("es", "navbar.search.hint")),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText(wordIn("es", "navbar.search.recent")),
    ).toBeInTheDocument();
    expect(drawnTexts(menu)).not.toContain(MENU_WORD_TWICE);

    fireEvent.change(within(menu).getByRole("combobox"), {
      target: { value: "zzzz no such product" },
    });
    await settle();

    expect(
      within(menu).getByText(wordIn("es", "navbar.search.noResults")),
    ).toBeInTheDocument();
    expect(drawnTexts(menu)).not.toContain(MENU_WORD_TWICE);
  });

  test("es: on a phone, its recent row", async () => {
    setViewportWidth(MOBILE_WIDTH);
    rememberRecentProductRoute(routeFor(PageMap.LOGS));
    await renderNavBar("es", routeFor(PageMap.NETWORK_OVERVIEW));

    openPhoneMenu();
    await settle();

    expect(
      screen.getByText(wordIn("es", "navbar.search.recent")),
    ).toBeInTheDocument();
    expect(drawnTexts(document.body)).not.toContain(MENU_WORD_TWICE);
  });
});
