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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo, setViewportWidth } from "./SideMenuHarness";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * THE PRODUCTS MENU'S SEARCH BOX, NAMED IN THE READER'S LANGUAGE, WITHOUT
 * ITS "…" (#7486).
 *
 * A screen reader names the products menu's search box by its label. The
 * box had none of its own: it was named by its placeholder, "Search
 * products…" with the "…" that prompts typing (read out as "dot dot dot",
 * or not at all), and where a menu gave no placeholder by "Search
 * products", a word the locales of twelve languages held in English. The
 * Dashboard names it "Search products" in the reader's language now, and
 * keeps the placeholder as it was.
 *
 * The other words of the header that a dozen languages held in English are
 * worded too: the products menu's own name (the dialog a screen reader
 * enters) and the notification bell's Mark all as read.
 *
 * This renders the Dashboard's real nav bar with the real locale files
 * behind a real i18next instance, opens the products menu and reads the
 * box's name, in every Dashboard language.
 */

const ASSET_DATA_URL: string = "data:image/svg+xml;base64,bG9nbw==";

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return ASSET_DATA_URL;
});

const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getList: async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      isStarted: (): boolean => {
        return false;
      },
      listenToModelEvent: () => {
        return () => {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "user-1";
          },
        };
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import DashboardNavbar, {
  PRODUCTS_SEARCH_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES: Record<string, string> = {
  Dashboard: path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  ),
  AdminDashboard: path.resolve(
    __dirname,
    "../../../../App/FeatureSet/AdminDashboard/src/Locales",
  ),
};

function readLocale(language: string, app: string = "Dashboard"): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES[app]!, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

function valueOf(locale: LocaleTree, key: string): string {
  if (typeof locale[key] === "string") {
    return locale[key] as string;
  }

  let node: string | LocaleTree | undefined = locale;

  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }

  if (typeof node !== "string") {
    throw new Error(`No ${key}`);
  }

  return node;
}

async function instanceFor(
  language: string,
  locale: LocaleTree = readLocale(language),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// The products menu opened from the Dashboard's nav bar, in a language.
async function openProductsMenu(
  instance: i18n,
  locale: LocaleTree,
): Promise<HTMLElement> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/dashboard/${PROJECT_ID}/home`]}>
        <I18nextProvider i18n={instance}>
          <DashboardNavbar show={true} />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });

  fireEvent.click(
    screen.getByRole("button", { name: valueOf(locale, "Products") }),
  );

  return screen.getByRole("dialog", {
    name: valueOf(locale, "Products menu"),
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setViewportWidth(1280);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  countMock.mockImplementation(async () => {
    return 0;
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("the products menu's search box in English", () => {
  test("is named Search products, without the placeholder's ellipsis", async () => {
    const english: LocaleTree = readLocale("en");
    const menu: HTMLElement = await openProductsMenu(
      await instanceFor("en"),
      english,
    );
    const box: HTMLElement = within(menu).getByRole("combobox");

    expect(PRODUCTS_SEARCH_LABEL).toBe("Search products");
    expect(box).toHaveAccessibleName("Search products");
    expect(box).toHaveAttribute(
      "placeholder",
      valueOf(english, "navbar.search.placeholder"),
    );
    expect(valueOf(english, "navbar.search.placeholder")).toBe(
      "Search products…",
    );
  });
});

describe("the check itself (negative control)", () => {
  test("Russian with the label put back to English: the box is named in English, and the check sees it", async () => {
    const russian: LocaleTree = readLocale("ru");
    russian["Search products"] = "Search products";

    const menu: HTMLElement = await openProductsMenu(
      await instanceFor("ru", russian),
      russian,
    );

    expect(within(menu).getByRole("combobox")).toHaveAccessibleName(
      "Search products",
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the products menu in %s",
  (language: string) => {
    test("its search box is named in the language, without an ellipsis, and prompts as before", async () => {
      const locale: LocaleTree = readLocale(language);
      const menu: HTMLElement = await openProductsMenu(
        await instanceFor(language),
        locale,
      );
      const box: HTMLElement = within(menu).getByRole("combobox");
      const label: string = valueOf(locale, "Search products");

      expect(box).toHaveAccessibleName(label);
      expect(label).not.toBe("Search products");
      expect(label).not.toMatch(/…|\.\.\./);
      expect(box).toHaveAttribute(
        "placeholder",
        valueOf(locale, "navbar.search.placeholder"),
      );
    });
  },
);

/*
 * The header's words a dozen languages held in English: the products menu's
 * name and the notification bell's Mark all as read, with the box's name.
 * Worded in every language, and in the Admin Dashboard's where it has them.
 */
const HEADER_WORDS: ReadonlyArray<string> = [
  "Products menu",
  "Mark all as read",
  "Search products",
];

describe("the header's words", () => {
  test.each([...DASHBOARD_LANGUAGES])(
    "are the Dashboard's own in %s",
    (language: string) => {
      const locale: LocaleTree = readLocale(language);

      expect(
        HEADER_WORDS.filter((key: string): boolean => {
          return valueOf(locale, key) === key;
        }),
      ).toEqual([]);
    },
  );

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "are the Admin Dashboard's own in %s, as the Dashboard words them",
    (language: string) => {
      const admin: LocaleTree = readLocale(language, "AdminDashboard");
      const dashboard: LocaleTree = readLocale(language);

      for (const key of HEADER_WORDS) {
        if (typeof admin[key] === "string") {
          expect({ key: key, word: admin[key] }).toEqual({
            key: key,
            word: valueOf(dashboard, key),
          });
        }
      }

      expect(admin["Products menu"]).not.toBe("Products menu");
    },
  );
});
