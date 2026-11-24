import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE ADMIN DASHBOARD'S PAGE HEADINGS AND SIDE MENUS, IN THE READER'S
 * LANGUAGE, LOOKED UP ONCE (#8224, #8225).
 *
 * The Admin Dashboard words its headings (t("pages.settings.title")) and
 * its side menus (t("sideMenu.settingsTelegram")) itself, and Page,
 * SideMenuSection, SideMenuItem and the phone's menu summary each looked
 * the words up again: a translation that is itself an English key reads as
 * that key's word. Each now says isTitleTranslated, and is drawn as given.
 *
 * These draw the real Settings > Telegram page, the real Settings menu and
 * a user's menu with the Admin Dashboard's own Spanish, Dutch and Persian -
 * and then with a heading's or an entry's word made "Red", which each of
 * the three has as a key of its own: Spanish "Rojo", Dutch "Rood", Persian
 * "قرمز". Looked up once, it reads Red; twice, the colour.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RealSettingsSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu";
import SettingsTelegram from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index";
import UserSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/SideMenu";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import { SIDE_MENU_ITEM_TITLE_TEST_ID } from "../../../UI/Components/SideMenu/SideMenuEntryState";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";

const WAIT_FOR_TIMEOUT: number = 20000;

type Locale = Record<string, unknown>;

function readAdminLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Locale;
}

// The Settings menu as Settings/SideMenu draws it: its sections, its entries.
const SETTINGS_SECTIONS: Array<string> = [
  "basic",
  "settingsNotifications",
  "settingsSharedWithProjects",
  "settingsServer",
];
const SETTINGS_ENTRIES: Array<string> = [
  "settingsAuthentication",
  "settingsSso",
  "settingsProducts",
  // Where the server sends its people for help (#10864-#10866).
  "settingsHelpAndSupport",
  "settingsEmails",
  "settingsCallSms",
  "settingsWhatsapp",
  "settingsTelegram",
  "settingsPushNotifications",
  "settingsGlobalProbes",
  "settingsGlobalRunners",
  "settingsGlobalLlmProviders",
  "settingsDataRetention",
  "settingsIngestionBudgets",
  "settingsApiKey",
];

// A user's menu. Advanced's entry says what it deletes (#9216).
const USER_SECTIONS: Array<string> = ["basic", "advanced"];
const USER_ENTRIES: Array<string> = [
  "overview",
  "projects",
  "authentication",
  "settings",
  "deleteUser",
];

// A word each language has as a key of its own.
const ONCE: string = "Red";

const LANGUAGES: Array<string> = ["es", "nl", "fa"];

const TELEGRAM_PATH: string = "/admin/settings/telegram";
const USER_ID: string = "5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();

  return item;
}

async function inLanguage(language: string, locale: Locale): Promise<i18n> {
  const translation: i18n = createInstance();

  await translation.init({
    lng: language,
    fallbackLng: language,
    resources: { [language]: { translation: locale } },
    interpolation: { escapeValue: false },
  });

  return translation;
}

// A locale with some of its keyed words made Red.
function withRed(locale: Locale, group: string, keys: Array<string>): Locale {
  const words: Locale = { ...(locale[group] as Locale) };

  for (const key of keys) {
    words[key] = ONCE;
  }

  return { ...locale, [group]: words };
}

/*
 * A keyed word of a group, or - an entry the menu hands over in English -
 * the locale's word for that English.
 */
function wordOf(locale: Locale, group: string, key: string): string {
  const value: unknown = key.includes(" ")
    ? locale[key]
    : (locale[group] as Locale)[key];

  if (typeof value !== "string") {
    throw new Error(`No "${group}.${key}"`);
  }

  return value;
}

function goTo(pathname: string): void {
  window.history.pushState({}, "", pathname);
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderIn(
  translation: i18n,
  element: ReactElement,
): Promise<void> {
  await act(async () => {
    render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
  });

  await settle();
}

function menuTitles(): Array<string> {
  return screen
    .getAllByTestId(SIDE_MENU_ITEM_TITLE_TEST_ID)
    .map((title: HTMLElement): string => {
      return (title.textContent || "").trim();
    });
}

function sectionTitles(): Array<string> {
  return screen
    .getAllByRole("heading", { level: 6 })
    .map((heading: HTMLElement): string => {
      return (heading.textContent || "").trim();
    });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
  window.localStorage.clear();
  setViewportWidth(1280);

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(API, "fetch").mockImplementation(async (): Promise<unknown> => {
    return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setViewportWidth(1280);
});

describe.each(LANGUAGES)("the Admin Dashboard in %s", (language: string) => {
  const LOCALE: Locale = readAdminLocale(language);
  const TWICE: unknown = LOCALE[ONCE];
  const SETTINGS_TITLE: string = (
    (LOCALE["pages"] as Record<string, Locale>)["settings"] as Locale
  )["title"] as string;

  test("the words these cases lean on: Red is a key of its own, and its word is another", () => {
    expect(typeof TWICE).toBe("string");
    expect(TWICE).not.toBe(ONCE);
  });

  describe("Settings > Telegram's heading", () => {
    test("reads the Admin Dashboard's own word for it, never English", async () => {
      goTo(TELEGRAM_PATH);
      await renderIn(await inLanguage(language, LOCALE), <SettingsTelegram />);

      await waitFor(
        () => {
          expect(
            (
              screen.getByRole("heading", { level: 1 }).textContent || ""
            ).trim(),
          ).toBe(SETTINGS_TITLE);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(screen.queryByText("Admin Settings")).toBeNull();
    });

    test("a heading whose word is itself a key reads the page's word: Red, never its colour", async () => {
      const pages: Record<string, Locale> = LOCALE["pages"] as Record<
        string,
        Locale
      >;

      goTo(TELEGRAM_PATH);
      await renderIn(
        await inLanguage(language, {
          ...LOCALE,
          pages: { ...pages, settings: { ...pages["settings"], title: ONCE } },
        }),
        <SettingsTelegram />,
      );

      await waitFor(
        () => {
          expect(
            (
              screen.getByRole("heading", { level: 1 }).textContent || ""
            ).trim(),
          ).toBe(ONCE);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(document.body).not.toHaveTextContent(TWICE as string);
    });
  });

  describe("Settings' side menu", () => {
    test("names every entry and heads every section in the Admin Dashboard's own words", async () => {
      goTo(TELEGRAM_PATH);
      await renderIn(
        await inLanguage(language, LOCALE),
        <RealSettingsSideMenu />,
      );

      expect(menuTitles()).toEqual(
        SETTINGS_ENTRIES.map((key: string): string => {
          return wordOf(LOCALE, "sideMenu", key);
        }),
      );
      expect(sectionTitles()).toEqual(
        SETTINGS_SECTIONS.map((key: string): string => {
          return wordOf(LOCALE, "sideMenu", key);
        }),
      );
    });

    test("an entry and a section whose words are themselves keys read Red, never their colour", async () => {
      goTo(TELEGRAM_PATH);
      await renderIn(
        await inLanguage(
          language,
          withRed(LOCALE, "sideMenu", [
            "settingsTelegram",
            "settingsNotifications",
          ]),
        ),
        <RealSettingsSideMenu />,
      );

      expect(menuTitles()[SETTINGS_ENTRIES.indexOf("settingsTelegram")]).toBe(
        ONCE,
      );
      expect(
        sectionTitles()[SETTINGS_SECTIONS.indexOf("settingsNotifications")],
      ).toBe(ONCE);
      expect(document.body).not.toHaveTextContent(TWICE as string);
    });

    test("on a phone, its summary names the page once: Red, never its colour", async () => {
      setViewportWidth(375);
      goTo(TELEGRAM_PATH);
      await renderIn(
        await inLanguage(
          language,
          withRed(LOCALE, "sideMenu", [
            "settingsTelegram",
            "settingsNotifications",
          ]),
        ),
        <RealSettingsSideMenu />,
      );

      const summary: HTMLElement = within(
        screen.getByTestId("mobile-sidemenu-toggle"),
      ).getByRole("heading", { level: 3 });

      // Named like its section, the page is named alone.
      expect((summary.textContent || "").trim()).toBe(ONCE);
      expect(summary.querySelector("span[lang]")?.getAttribute("lang")).toBe(
        language,
      );
    });
  });

  describe("a user's side menu", () => {
    test("names every entry and heads every section in the Admin Dashboard's own words, once", async () => {
      goTo(`/admin/users/${USER_ID}`);
      await renderIn(
        await inLanguage(language, LOCALE),
        <UserSideMenu modelId={new ObjectID(USER_ID)} />,
      );

      expect(menuTitles()).toEqual(
        USER_ENTRIES.map((key: string): string => {
          return wordOf(LOCALE, "sideMenu", key);
        }),
      );
      expect(sectionTitles()).toEqual(
        USER_SECTIONS.map((key: string): string => {
          return wordOf(LOCALE, "sideMenu", key);
        }),
      );

      cleanup();

      await renderIn(
        await inLanguage(language, withRed(LOCALE, "sideMenu", ["overview"])),
        <UserSideMenu modelId={new ObjectID(USER_ID)} />,
      );

      expect(menuTitles()[0]).toBe(ONCE);
      expect(document.body).not.toHaveTextContent(TWICE as string);
    });
  });
});
