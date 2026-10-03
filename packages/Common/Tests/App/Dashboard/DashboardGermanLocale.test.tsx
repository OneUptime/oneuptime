import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DashboardKeyboardShortcuts from "../../../../App/FeatureSet/Dashboard/src/Components/KeyboardShortcuts/DashboardKeyboardShortcuts";
import MonitorManualGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorManualGuideCard";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Dashboard in German, read from the real locale files.
 *
 * Every string asserted below was English in de.json until the German
 * translation pass filled the file in. Three kinds of lookup are covered:
 *
 *  - nested keys read with t("a.b") (the products menu and the keyboard
 *    shortcuts dialog),
 *  - flat keys a Common component looks up for the Dashboard (the Card's
 *    title and description),
 *  - and the default-separator configuration the Dashboard's own i18next
 *    instance uses (Utils/i18n.ts), so a flat key that looked like a path
 *    would show up here as English.
 *
 * The instance reaches the components through I18nextProvider only, so no
 * other suite in this worker sees German.
 */

const german: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000007",
);

/*
 * English source key → the German de.json ships for it. A test at the end
 * keeps these copies honest against the file.
 */
const PRODUCTS_MENU_GERMAN: Array<[string, string]> = [
  ["navbar.items.securityEventsTitle", "Sicherheitsereignisse"],
  [
    "navbar.items.securityEventsDescription",
    "SIEM-Signale, korreliert mit Ihren Observability-Daten.",
  ],
  ["navbar.items.networkTitle", "Netzwerk"],
  [
    "navbar.items.networkDescription",
    "Überwachen Sie Netzwerkgeräte per SNMP und gruppieren Sie sie nach Standorten.",
  ],
  ["navbar.items.llmObservabilityTitle", "KI / LLM"],
];

const SHORTCUTS_GERMAN: Array<[string, string]> = [
  ["keyboardShortcuts.title", "Tastenkürzel"],
  [
    "keyboardShortcuts.description",
    "Arbeiten Sie schneller, ohne die Tastatur zu verlassen.",
  ],
  ["keyboardShortcuts.groups.general", "Allgemein"],
  ["keyboardShortcuts.groups.goTo", "Gehe zu"],
  ["keyboardShortcuts.commandPalette", "Befehlspalette öffnen"],
  ["keyboardShortcuts.searchList", "Liste auf dieser Seite durchsuchen"],
  ["keyboardShortcuts.dismiss", "Dialog oder Bereich schließen"],
];

const CARD_GERMAN: Array<[string, string]> = [
  ["Manual monitor", "Manueller Monitor"],
  [
    "Status is set by people, not by checks.",
    "Der Status wird von Personen festgelegt, nicht durch Prüfungen.",
  ],
];

type LocaleFile = Record<string, unknown>;

/*
 * A key as the locale files hold it: flat when the file has it flat, and
 * otherwise as a path through the nested objects.
 */
const readKey: (locale: LocaleFile, key: string) => unknown = (
  locale: LocaleFile,
  key: string,
): unknown => {
  if (key in locale) {
    return locale[key];
  }

  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }

  return node;
};

const withGerman: (children: ReactElement) => ReactElement = (
  children: ReactElement,
): ReactElement => {
  return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  // The Dashboard's own configuration (Utils/i18n.ts): default separators.
  await german.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterAll(() => {
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the products menu in German", () => {
  test("names and describes the products in German", () => {
    render(withGerman(<DashboardNavbar show={true} />));

    fireEvent.click(screen.getByRole("button", { name: "Produkte" }));

    const menu: HTMLElement = screen.getByRole("dialog");

    /*
     * The menu opens on Essentials and folds the other sections to one line
     * each. These products sit in two of them, named in German as well:
     * open those the way a user would.
     */
    for (const section of ["Observability", "Infrastruktur"]) {
      const toggle: HTMLElement = within(menu).getByRole("button", {
        name: section,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
    }
    expect(
      within(menu).queryByRole("button", { name: "Infrastructure" }),
    ).toBeNull();

    for (const [, value] of PRODUCTS_MENU_GERMAN) {
      expect(within(menu).getAllByText(value).length).toBeGreaterThan(0);
    }

    expect(within(menu).queryByText("Security Events")).toBeNull();
    expect(
      within(menu).queryByText(
        "SIEM signals correlated with your observability data.",
      ),
    ).toBeNull();
  });
});

describe("the keyboard shortcuts dialog in German", () => {
  test("titles, groups and shortcuts read in German", () => {
    render(withGerman(<DashboardKeyboardShortcuts />));

    act(() => {
      GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
    });

    const dialog: HTMLElement = screen.getByRole("dialog");

    for (const [, value] of SHORTCUTS_GERMAN) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }

    expect(within(dialog).queryByText("Keyboard shortcuts")).toBeNull();
    expect(within(dialog).queryByText("Open the command palette")).toBeNull();
  });
});

describe("a Dashboard card in German", () => {
  test("the manual monitor card's title and description are German", () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toString()}`);

    render(withGerman(<MonitorManualGuideCard monitorId={MONITOR_ID} />));

    for (const [, value] of CARD_GERMAN) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }

    expect(screen.queryByText("Manual monitor")).toBeNull();
    expect(
      screen.queryByText("Status is set by people, not by checks."),
    ).toBeNull();
  });
});

describe("the German above is the German de.json ships", () => {
  const all: Array<[string, string]> = [
    ...PRODUCTS_MENU_GERMAN,
    ...SHORTCUTS_GERMAN,
    ...CARD_GERMAN,
  ];

  test.each(all)("%s", (key: string, value: string) => {
    const shipped: unknown = readKey(germanLocale as LocaleFile, key);
    const english: unknown = readKey(englishLocale as LocaleFile, key);

    expect(typeof english).toBe("string");
    expect(shipped).toBe(value);
    expect(shipped).not.toBe(english);
  });
});
