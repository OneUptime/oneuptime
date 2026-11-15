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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE ADMIN DASHBOARD'S BREADCRUMBS, ITS PRODUCTS MENU AND ITS TELEGRAM
 * SWITCH, IN THE READER'S LANGUAGE, LOOKED UP ONCE (#8075).
 *
 * - Breadcrumbs. The Admin Dashboard words its crumbs itself
 *   (t("breadcrumbs.settings")), and the trail and the browser tab looked
 *   each one up again: a translation that is itself an English key read as
 *   another word - the Admin Dashboard's Spanish says "Rojo" for "Red". Each
 *   crumb now says isTitleTranslated, and is drawn as given.
 * - The products menu. It drew every item's words as given, and the Admin
 *   Dashboard hands its menu over in English, so the menu read English in
 *   every language. It now looks an item's title, description and category
 *   up once, unless the item says they are translated (the Dashboard's).
 * - Settings > Telegram's "Poll Telegram for Messages" had no entry in the
 *   Admin Dashboard's locales, and read English in every language.
 *
 * These draw the real pages - Settings > Telegram with its real Page, and
 * the real nav bar - with the Admin Dashboard's own Spanish.
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

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

// With billing on the menu grows an entry; the rest of it is the same.
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

import AdminNavBar from "../../../../App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar";
import SettingsTelegram from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
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

const SPANISH: Locale = readAdminLocale("es");
const SPANISH_CRUMBS: Locale = SPANISH["breadcrumbs"] as Locale;

// A word the Admin Dashboard's Spanish also has as a key, and that key's word.
const ONCE: string = "Red";
const TWICE: string = "Rojo";

// The menu's entries, headings and descriptions, as the Admin Dashboard hands them.
const MENU_TITLES: Array<string> = [
  "Users",
  "Projects",
  "Telemetry Usage",
  "OneUptime Health",
  "Feedback",
  "Send Email",
  "Server Setup",
  "Settings",
];
const MENU_HEADINGS: Array<string> = [
  "Management",
  "Monitoring",
  "Tools",
  "Settings",
];
const MENU_DESCRIPTIONS: Array<string> = [
  "Manage all users across the instance.",
  "View and manage every project.",
  "How much telemetry each project sends, heaviest first.",
  "Live status, datastore capacity and queue backlogs.",
  "What people said was hard, and how each setup went.",
  "Send a broadcast email to all users.",
  "What this server still needs: email, HTTPS, sign-ups and more.",
  "Authentication, notifications, probes, AI, data retention and more.",
];

const POLL_FIELD: string = "Poll Telegram for Messages";

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

// Telegram, with nothing set up.
async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();

  return item;
}

async function spanish(locale: Locale = SPANISH): Promise<i18n> {
  const translation: i18n = createInstance();

  await translation.init({
    lng: "es",
    fallbackLng: "es",
    resources: { es: { translation: locale } },
    interpolation: { escapeValue: false },
  });

  return translation;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function word(key: string): string {
  const value: unknown = SPANISH[key];

  if (typeof value !== "string") {
    throw new Error(`The Admin Dashboard's Spanish has no "${key}"`);
  }

  return value;
}

// Each crumb of the trail, as it reads.
function crumbs(): Array<string> {
  return Array.from(document.body.querySelectorAll("li.breadcrumb-item")).map(
    (crumb: Element): string => {
      return (crumb.textContent || "").trim();
    },
  );
}

async function renderTelegram(translation: i18n): Promise<void> {
  Navigation.setLocation({
    pathname: "/admin/settings/telegram",
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  render(
    <I18nextProvider i18n={translation}>
      <SettingsTelegram />
    </I18nextProvider>,
  );

  await settle();
}

async function openMenu(translation: i18n): Promise<HTMLElement> {
  Navigation.setLocation({
    pathname: "/admin/home",
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  render(
    <I18nextProvider i18n={translation}>
      <AdminNavBar />
    </I18nextProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: word("Menu") }));

  return screen.getByRole("dialog", {
    name:
      (translation.t("Products menu", {
        keySeparator: false,
        nsSeparator: false,
        defaultValue: "Products menu",
      }) as string) || "Products menu",
  });
}

// A card's title and description, as the menu draws them.
function cards(menu: HTMLElement): Array<[string, string]> {
  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): [string, string] => {
      return [
        (option.querySelector("span.truncate")?.textContent || "").trim(),
        (option.querySelector("p.text-xs")?.textContent || "").trim(),
      ];
    });
}

function headings(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("heading", { level: 3 })
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

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(API, "fetch").mockImplementation(async (): Promise<unknown> => {
    return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("the words these cases lean on", () => {
  test("the Admin Dashboard's Spanish says Rojo for Red, and has words of its own for the menu and the Telegram switch", () => {
    expect(SPANISH[ONCE]).toBe(TWICE);

    for (const english of [
      ...MENU_TITLES,
      ...MENU_HEADINGS,
      ...MENU_DESCRIPTIONS,
      POLL_FIELD,
    ]) {
      expect({ english, spanish: word(english) }).not.toEqual({
        english,
        spanish: english,
      });
    }
  });
});

describe("Settings > Telegram's trail, in Spanish", () => {
  test("reads the Admin Dashboard's own Spanish crumbs", async () => {
    await renderTelegram(await spanish());

    await waitFor(
      () => {
        expect(crumbs()).toEqual([
          SPANISH_CRUMBS["adminDashboard"],
          SPANISH_CRUMBS["settings"],
          SPANISH_CRUMBS["telegram"],
        ]);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("a crumb whose Spanish is itself a key reads the page's word, in the trail and in the browser tab: Red, never Rojo", async () => {
    await renderTelegram(
      await spanish({
        ...SPANISH,
        breadcrumbs: { ...SPANISH_CRUMBS, settings: ONCE },
      }),
    );

    await waitFor(
      () => {
        expect(crumbs()[1]).toBe(ONCE);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(crumbs()).not.toContain(TWICE);
    expect(document.title).toContain(` - ${ONCE} - `);
    expect(document.title).not.toContain(TWICE);
  });
});

describe("Settings > Telegram's Poll Telegram for Messages, in Spanish", () => {
  test("its detail card names the switch in Spanish, never English", async () => {
    await renderTelegram(await spanish());

    await waitFor(
      () => {
        expect(screen.getAllByText(word(POLL_FIELD)).length).toBeGreaterThan(0);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(screen.queryByText(POLL_FIELD)).toBeNull();
  });
});

describe("the Admin Dashboard's products menu, in Spanish", () => {
  test("names every entry, describes it and heads its section in Spanish", async () => {
    const menu: HTMLElement = await openMenu(await spanish());

    expect(cards(menu)).toEqual(
      MENU_TITLES.map((title: string, index: number): [string, string] => {
        return [word(title), word(MENU_DESCRIPTIONS[index]!)];
      }),
    );
    expect(headings(menu)).toEqual(
      MENU_HEADINGS.map((heading: string): string => {
        return word(heading);
      }),
    );

    // Not one English entry, description or heading is left.
    for (const english of [
      ...MENU_TITLES,
      ...MENU_HEADINGS,
      ...MENU_DESCRIPTIONS,
    ]) {
      expect(within(menu).queryByText(english)).toBeNull();
    }
  });

  test("an entry is found by its Spanish name, and still by its English one", async () => {
    const translation: i18n = await spanish();
    const menu: HTMLElement = await openMenu(translation);
    const search: HTMLElement = within(menu).getByRole("combobox");

    const found: () => Array<string> = (): Array<string> => {
      return cards(menu).map((card: [string, string]): string => {
        return card[0];
      });
    };

    // Its name, and every entry whose Spanish description says it.
    fireEvent.change(search, {
      target: { value: word("Users").toLowerCase() },
    });

    expect(found()).toContain(word("Users"));
    expect(found()).not.toContain(word("Projects"));

    fireEvent.change(search, { target: { value: "users" } });

    expect(found()).toContain(word("Users"));
    expect(found()).not.toContain(word("Projects"));
  });

  test("each entry's words are looked up once: an entry whose Spanish is itself a key reads Red, never Rojo", async () => {
    const menu: HTMLElement = await openMenu(
      await spanish({
        ...SPANISH,
        Users: ONCE,
        "Manage all users across the instance.": ONCE,
        Management: ONCE,
      }),
    );

    expect(cards(menu)[0]).toEqual([ONCE, ONCE]);
    expect(headings(menu)[0]).toBe(ONCE);
    expect(within(menu).queryByText(TWICE)).toBeNull();
  });
});
