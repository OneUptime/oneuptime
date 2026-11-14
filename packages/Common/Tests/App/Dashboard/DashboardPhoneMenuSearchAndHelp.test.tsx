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
import getJestMockFunction, { MockFunction } from "../../MockType";
import Logo, {
  getLogoDestination,
  HEADER_LOGO_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Logo";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import {
  PHONE_MENU_HELP_ASK_TEST_ID,
  PHONE_MENU_HELP_LEARN_TEST_ID,
  PHONE_MENU_HELP_TEST_ID,
  PHONE_MENU_SEARCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/PhoneMenuEntries";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import { DOCS_URL } from "../../../UI/Config";
import {
  MOBILE_MENU_RECENT_TEST_ID,
  RECENT_PRODUCTS_SHOWN_ON_PHONE,
} from "../../../UI/Components/Navbar/NavBarMobileMenu";
import { RECENT_PRODUCTS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarRecentProducts";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The frame of every page, on a phone and at its top left (#6816).
 *
 *  - The logo was drawn as something to click and did nothing: it now goes
 *    to the project's Home, as a link (keyboard, middle click, a name).
 *  - Below 768 pixels the header leaves out Search and Help to keep its
 *    width, and the products menu is the phone's menu: there was no way to
 *    Search, the docs or support on a phone. The phone's menu now starts
 *    with Search and ends with Help (the header's own entries, the ways to
 *    learn first), and lists the products visited last, as the desktop
 *    products menu does. From 768 up the header draws Search and Help
 *    itself (#7037, DashboardHelpAtTabletWidths).
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const DOCS: string = DOCS_URL.toString();

const OPENED: Array<string> = [
  PageMap.TEAMS,
  PageMap.ALERTS,
  PageMap.LOGS,
  PageMap.MONITORS,
  PageMap.INCIDENTS,
  PageMap.KUBERNETES_CLUSTERS,
];

function navbar(): React.ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

function openPhoneMenu(): void {
  fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
}

function isMenuOpen(): boolean {
  return screen.queryByTestId(PHONE_MENU_SEARCH_TEST_ID) !== null;
}

function rowTitles(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("a, button")).map(
    (row: Element): string => {
      return row.textContent?.trim() || "";
    },
  );
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function listenTo(eventName: string): {
  calls: MockFunction;
  stop: () => void;
} {
  const calls: MockFunction = getJestMockFunction();
  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    calls(event.detail);
  };
  GlobalEvents.addEventListener(eventName, listener);
  return {
    calls,
    stop: (): void => {
      GlobalEvents.removeEventListener(eventName, listener);
    },
  };
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  window.localStorage.clear();
  setViewportWidth(MOBILE_WIDTH);
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

describe("the logo goes Home", () => {
  test("it is a link to the project's Home, named by the product's name, not a second link named Home", () => {
    render(<Logo />);

    const logo: HTMLElement = screen.getByTestId(HEADER_LOGO_TEST_ID);
    expect(logo.tagName).toBe("A");
    expect(logo).toHaveAttribute("href", routeFor(PageMap.HOME));
    expect(logo).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/home/`);
    expect(screen.getByRole("link", { name: "OneUptime" })).toBe(logo);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("a click opens Home in the app, without reloading the page", () => {
    render(<Logo />);

    fireEvent.click(screen.getByTestId(HEADER_LOGO_TEST_ID));

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route(`/dashboard/${PROJECT_ID}/home/`),
    );
  });

  test("it is reached with Tab: a link with an address, not an image with a click handler", () => {
    render(<Logo />);

    const logo: HTMLElement = screen.getByTestId(HEADER_LOGO_TEST_ID);
    logo.focus();
    expect(document.activeElement).toBe(logo);
    expect(logo.querySelector("img[role='button'], [onclick]")).toBeNull();
  });

  test("with no project selected, it goes to the Dashboard's start, which picks one", () => {
    goTo("/dashboard/welcome");

    expect(getLogoDestination().toString()).toBe("/dashboard");
  });

  test("in another project, it goes to that project's Home", () => {
    const other: string = "7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
    goTo(`/dashboard/${other}/monitors`);

    expect(getLogoDestination().toString()).toBe(`/dashboard/${other}/home/`);
  });
});

describe("Search and Help in the phone's menu", () => {
  test("the menu starts with Search, above Home, and ends with Help, below User Settings", () => {
    render(navbar());
    openPhoneMenu();

    const searchRow: HTMLElement = screen.getByTestId(
      PHONE_MENU_SEARCH_TEST_ID,
    );
    const help: HTMLElement = screen.getByTestId(PHONE_MENU_HELP_TEST_ID);
    const home: HTMLElement = screen.getByRole("link", { name: "Home" });
    const userSettings: HTMLElement = screen.getByRole("link", {
      name: "User Settings",
    });

    expect(searchRow).toHaveTextContent("Search");
    expect(follows(searchRow, home)).toBe(true);
    expect(follows(userSettings, help)).toBe(true);
    expect(within(help).getByRole("button", { name: "Help" })).toBeVisible();
  });

  test("Search closes the menu and opens Search over the page", () => {
    const toggled: { calls: MockFunction; stop: () => void } = listenTo(
      EventName.COMMAND_PALETTE_TOGGLE,
    );

    try {
      render(navbar());
      openPhoneMenu();
      fireEvent.click(screen.getByTestId(PHONE_MENU_SEARCH_TEST_ID));

      expect(toggled.calls).toHaveBeenCalledTimes(1);
      expect(isMenuOpen()).toBe(false);
    } finally {
      toggled.stop();
    }
  });

  test("Help starts folded, and opens to the ways to learn, then the ways to ask", () => {
    render(navbar());
    openPhoneMenu();

    const help: HTMLElement = screen.getByTestId(PHONE_MENU_HELP_TEST_ID);
    const toggle: HTMLElement = within(help).getByRole("button", {
      name: "Help",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Quickstart")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const learn: HTMLElement = screen.getByTestId(
      PHONE_MENU_HELP_LEARN_TEST_ID,
    );
    const ask: HTMLElement = screen.getByTestId(PHONE_MENU_HELP_ASK_TEST_ID);

    expect(rowTitles(learn)).toEqual([
      "Quickstart",
      "How OneUptime works",
      "Glossary",
      "Documentation",
    ]);
    expect(rowTitles(ask)).toEqual([
      "Support Email",
      "Chat on Slack",
      "Request Demo",
    ]);
    expect(follows(learn, ask)).toBe(true);
    // The ways to ask are set apart under a line, as in the header's Help.
    expect(ask.className).toContain("border-t");
  });

  test("the keyboard shortcuts are left out: a phone has no keys", () => {
    render(navbar());
    openPhoneMenu();
    fireEvent.click(
      within(screen.getByTestId(PHONE_MENU_HELP_TEST_ID)).getByRole("button", {
        name: "Help",
      }),
    );

    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });

  test("the docs open on this instance, in a new tab", () => {
    render(navbar());
    openPhoneMenu();
    fireEvent.click(
      within(screen.getByTestId(PHONE_MENU_HELP_TEST_ID)).getByRole("button", {
        name: "Help",
      }),
    );

    const quickstart: HTMLElement = screen
      .getByText("Quickstart")
      .closest("a") as HTMLElement;
    expect(quickstart).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/quickstart`,
    );
    expect(quickstart).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText("Glossary").closest("a") as HTMLElement,
    ).toHaveAttribute("href", `${DOCS}/en/introduction/glossary`);
  });

  test("How OneUptime works opens over the page, says it came from the phone's menu, and closes the menu", () => {
    const opened: { calls: MockFunction; stop: () => void } = listenTo(
      EventName.HOW_ONEUPTIME_WORKS_OPEN,
    );

    try {
      render(navbar());
      openPhoneMenu();
      fireEvent.click(
        within(screen.getByTestId(PHONE_MENU_HELP_TEST_ID)).getByRole(
          "button",
          { name: "Help" },
        ),
      );
      fireEvent.click(screen.getByText("How OneUptime works"));

      expect(opened.calls).toHaveBeenCalledWith({ from: "phone-menu" });
      expect(isMenuOpen()).toBe(false);
    } finally {
      opened.stop();
    }
  });

  test("in German, Search and Help say so in German, and the docs open in German", async () => {
    await translation.changeLanguage("de");
    render(navbar());
    openPhoneMenu();

    const searchRow: HTMLElement = screen.getByTestId(
      PHONE_MENU_SEARCH_TEST_ID,
    );
    const germanSearch: string = (
      germanLocale as unknown as { header: { search: string } }
    ).header.search;
    const germanHelp: string = (
      germanLocale as unknown as { help: { label: string } }
    ).help.label;
    expect(germanSearch).not.toBe("Search");
    expect(searchRow).toHaveTextContent(germanSearch);

    fireEvent.click(
      within(screen.getByTestId(PHONE_MENU_HELP_TEST_ID)).getByRole("button", {
        name: germanHelp,
      }),
    );

    const quickstart: HTMLElement = within(
      screen.getByTestId(PHONE_MENU_HELP_LEARN_TEST_ID),
    ).getAllByRole("link")[0]!;
    expect(quickstart).toHaveAttribute(
      "href",
      `${DOCS}/de/introduction/quickstart`,
    );
  });

  test("on a computer, the menu is the products dialog: no Search or Help rows are added, and the header keeps its own", () => {
    setViewportWidth(DESKTOP_WIDTH);
    render(navbar());

    expect(screen.queryByTestId("mobile-nav-toggle")).toBeNull();
    expect(screen.queryByTestId(PHONE_MENU_SEARCH_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(PHONE_MENU_HELP_TEST_ID)).toBeNull();
  });
});

describe("the products visited last, in the phone's menu", () => {
  function remember(pageMapKeys: Array<string>): void {
    window.localStorage.setItem(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify(
        pageMapKeys.map((key: string): string => {
          return routeFor(key);
        }),
      ),
    );
  }

  function recentHrefs(): Array<string | null> {
    return within(screen.getByTestId(MOBILE_MENU_RECENT_TEST_ID))
      .getAllByRole("link")
      .map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      });
  }

  test("lists the products opened last, the newest first, one a row, at most four", () => {
    remember(OPENED);
    render(navbar());
    openPhoneMenu();

    const recent: HTMLElement = screen.getByTestId(MOBILE_MENU_RECENT_TEST_ID);
    expect(recent).toHaveTextContent("Recently visited");
    expect(screen.getByRole("group", { name: "Recently visited" })).toBe(
      recent,
    );
    expect(RECENT_PRODUCTS_SHOWN_ON_PHONE).toBe(4);
    expect(recentHrefs()).toEqual(
      OPENED.slice(0, 4).map((key: string): string => {
        return routeFor(key);
      }),
    );
  });

  test("sits between Home and the categories of products", () => {
    remember(OPENED);
    render(navbar());
    openPhoneMenu();

    const recent: HTMLElement = screen.getByTestId(MOBILE_MENU_RECENT_TEST_ID);
    const home: HTMLElement = screen.getByRole("link", { name: "Home" });
    const firstCategory: HTMLElement = screen.getAllByRole("group")[1]!;

    expect(follows(home, recent)).toBe(true);
    expect(follows(recent, firstCategory)).toBe(true);
  });

  test("leaves out the product of the page the person is on", () => {
    remember(OPENED);
    goTo(routeFor(PageMap.TEAMS));
    render(navbar());
    openPhoneMenu();

    expect(recentHrefs()).not.toContain(routeFor(PageMap.TEAMS));
    expect(recentHrefs()).toHaveLength(4);
  });

  test("with nothing visited yet, there is no empty row", () => {
    render(navbar());
    openPhoneMenu();

    expect(screen.queryByTestId(MOBILE_MENU_RECENT_TEST_ID)).toBeNull();
  });

  test("a product picked from the row closes the menu", () => {
    remember(OPENED);
    render(navbar());
    openPhoneMenu();

    fireEvent.click(
      within(screen.getByTestId(MOBILE_MENU_RECENT_TEST_ID)).getAllByRole(
        "link",
      )[0]!,
    );

    expect(isMenuOpen()).toBe(false);
    expect(Navigation.navigate).toHaveBeenCalled();
  });
});
