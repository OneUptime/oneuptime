import "@testing-library/jest-dom";
import {
  afterEach,
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
import { SpyInstance } from "jest-mock";
import path from "path";
import React from "react";
import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  ThemePreference,
} from "../../../Types/Theme/ThemePreference";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import {
  VIEW_SWITCH_ACTIVE_CLASS_NAME,
  VIEW_SWITCH_CLASS_NAME,
  VIEW_SWITCH_IDLE_CLASS_NAME,
} from "../../../UI/Components/ViewSwitch/ViewSwitch";
import {
  classesWithoutDarkTheme,
  colourClassesIn,
} from "../Styles/DarkThemeCoverage";

/*
 * The user menu's theme row (Header/IconDropdown/ThemeChoiceRow), in the
 * Dashboard's and the Admin Dashboard's menus: "Theme", and Light, Dark and
 * System as the product's view switch - icons that say their names to a
 * screen reader and in a tooltip, the one in use pressed. A pick is drawn at
 * once and kept in the browser; the row follows a pick made in another tab,
 * and System follows the device.
 *
 * The words are read from each app's own locale, by their English text: the
 * Dashboard's and the Admin Dashboard's locale files both hold them.
 */

let mockLocale: Record<string, unknown> = {};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (!value) {
            return value;
          }

          const translated: unknown = mockLocale[value];

          return typeof translated === "string" ? translated : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ThemeChoiceRow, {
  THEME_CHOICES,
  THEME_CHOICE_ROW_TEST_ID,
  THEME_CHOICE_ROW_TITLE,
  getThemeChoiceTestId,
} from "../../../UI/Components/Header/IconDropdown/ThemeChoiceRow";
import ThemeUtil from "../../../UI/Utils/Theme";

const FEATURE_SET: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const readLocale: (app: string, language: string) => Record<string, unknown> = (
  app: string,
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
};

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * Storage's string index signature makes @jest/globals type a spy on
 * Storage.prototype as never; spy through its method instead.
 */
interface StorageMethods {
  setItem: (key: string, value: string) => void;
}

const STORAGE_METHODS: StorageMethods =
  Storage.prototype as unknown as StorageMethods;

// The device's light / dark setting, as the page asks matchMedia for it.
type ChangeListener = () => void;

const device: { prefersDark: boolean; listeners: Array<ChangeListener> } = {
  prefersDark: false,
  listeners: [],
};

const setDevice: (prefersDark: boolean) => void = (
  prefersDark: boolean,
): void => {
  device.prefersDark = prefersDark;

  for (const listener of device.listeners) {
    listener();
  }
};

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    return {
      media: query,
      get matches(): boolean {
        return query === DARK_COLOR_SCHEME_MEDIA_QUERY && device.prefersDark;
      },
      addEventListener: (_type: string, listener: ChangeListener): void => {
        device.listeners.push(listener);
      },
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

const isPageDark: () => boolean = (): boolean => {
  return document.documentElement.classList.contains("dark");
};

const choice: (preference: ThemePreference) => HTMLElement = (
  preference: ThemePreference,
): HTMLElement => {
  return screen.getByTestId(getThemeChoiceTestId(preference));
};

const pressed: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("aria-pressed") === "true";
    })
    .map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || "";
    });
};

beforeEach(() => {
  mockLocale = {};
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  device.prefersDark = false;
  document.documentElement.removeAttribute("class");
  ThemeUtil.initialize();
});

afterEach(() => {
  cleanup();
});

describe("the row", () => {
  test("is called Theme, and offers Light, Dark and System, in that order, as a group named by its title", () => {
    render(<ThemeChoiceRow />);

    const row: HTMLElement = screen.getByTestId(THEME_CHOICE_ROW_TEST_ID);
    const group: HTMLElement = within(row).getByRole("group", {
      name: "Theme",
    });

    expect(
      within(group)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.getAttribute("aria-label") || "";
        }),
    ).toEqual(["Light", "Dark", "System"]);
    expect(THEME_CHOICE_ROW_TITLE).toBe("Theme");
  });

  test("says each choice's name in a tooltip too: the choices are icons", () => {
    render(<ThemeChoiceRow />);

    for (const preference of [
      ThemePreference.Light,
      ThemePreference.Dark,
      ThemePreference.System,
    ]) {
      expect(choice(preference)).toHaveAttribute(
        "title",
        THEME_CHOICES[preference].label,
      );
      expect(choice(preference)).toHaveTextContent("");
      expect(choice(preference).querySelector("svg")).not.toBeNull();
    }
  });

  test("draws the choices as the product's view switch: a grey track, the one in use raised", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize();
    render(<ThemeChoiceRow />);

    const group: HTMLElement = screen.getByRole("group", { name: "Theme" });

    expect(group).toHaveClass(...VIEW_SWITCH_CLASS_NAME.split(" "));
    expect(choice(ThemePreference.Dark)).toHaveClass(
      ...VIEW_SWITCH_ACTIVE_CLASS_NAME.split(" "),
    );

    for (const preference of [ThemePreference.Light, ThemePreference.System]) {
      expect(choice(preference)).toHaveClass(
        ...VIEW_SWITCH_IDLE_CLASS_NAME.split(" "),
      );
      expect(choice(preference)).not.toHaveClass("bg-white");
    }
  });

  test("draws every colour it uses in the dark theme too", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize();
    render(<ThemeChoiceRow />);

    const row: HTMLElement = screen.getByTestId(THEME_CHOICE_ROW_TEST_ID);
    const colours: Array<string> = colourClassesIn(row);

    expect(colours.length).toBeGreaterThan(4);
    expect(classesWithoutDarkTheme(colours)).toEqual([]);
  });
});

describe("what is in use", () => {
  test("is System in a browser where nobody picked", () => {
    render(<ThemeChoiceRow />);

    expect(pressed()).toEqual(["System"]);
    expect(screen.getByTestId(THEME_CHOICE_ROW_TEST_ID)).toHaveAttribute(
      "data-theme-preference",
      "system",
    );
  });

  test.each([
    [ThemePreference.Light, "Light"],
    [ThemePreference.Dark, "Dark"],
    [ThemePreference.System, "System"],
  ])("is the pick the browser kept: %s", (kept: string, name: string) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, kept);
    render(<ThemeChoiceRow />);

    expect(pressed()).toEqual([name]);
  });
});

describe("picking", () => {
  test("draws the page at once, keeps the pick in the browser, and leaves the menu open", () => {
    render(<ThemeChoiceRow />);

    fireEvent.click(choice(ThemePreference.Dark));
    expect(isPageDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(pressed()).toEqual(["Dark"]);
    // Still on screen: the person sees the page in the theme and can change it again.
    expect(screen.getByTestId(THEME_CHOICE_ROW_TEST_ID)).toBeInTheDocument();

    fireEvent.click(choice(ThemePreference.Light));
    expect(isPageDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(pressed()).toEqual(["Light"]);
  });

  test("System follows the device from then on, as it changes", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Light);
    ThemeUtil.initialize();
    device.prefersDark = true;
    render(<ThemeChoiceRow />);

    expect(isPageDark()).toBe(false);

    fireEvent.click(choice(ThemePreference.System));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(isPageDark()).toBe(true);

    act(() => {
      setDevice(false);
    });
    expect(isPageDark()).toBe(false);
    expect(pressed()).toEqual(["System"]);
  });

  test("the one in use, pressed again, changes nothing", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize();
    render(<ThemeChoiceRow />);

    const setItem: SpyInstance<(key: string, value: string) => void> =
      jest.spyOn(STORAGE_METHODS, "setItem");

    try {
      fireEvent.click(choice(ThemePreference.Dark));
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  test("follows a pick made in another tab", () => {
    render(<ThemeChoiceRow />);

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: ThemePreference.Dark,
        }),
      );
    });

    expect(pressed()).toEqual(["Dark"]);
    expect(isPageDark()).toBe(true);
  });
});

describe("its words", () => {
  test.each(LANGUAGES)(
    "are in the Dashboard's and the Admin Dashboard's %s locale, worded alike",
    (language: string) => {
      const dashboard: Record<string, unknown> = readLocale(
        "Dashboard",
        language,
      );
      const admin: Record<string, unknown> = readLocale(
        "AdminDashboard",
        language,
      );

      for (const word of [
        THEME_CHOICE_ROW_TITLE,
        THEME_CHOICES[ThemePreference.Light].label,
        THEME_CHOICES[ThemePreference.Dark].label,
        THEME_CHOICES[ThemePreference.System].label,
      ]) {
        expect({ word, dashboard: typeof dashboard[word] }).toEqual({
          word,
          dashboard: "string",
        });
        expect({ word, admin: admin[word] }).toEqual({
          word,
          admin: dashboard[word],
        });
      }
    },
  );

  test("are drawn in the reader's language", () => {
    mockLocale = readLocale("Dashboard", "de");
    render(<ThemeChoiceRow />);

    expect(screen.getByRole("group", { name: "Design" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button").map((button: HTMLElement): string => {
        return button.getAttribute("aria-label") || "";
      }),
    ).toEqual(["Hell", "Dunkel", "System"]);
    expect(choice(ThemePreference.Dark)).toHaveAttribute("title", "Dunkel");
  });

  test("are drawn in the Admin Dashboard's Persian too", () => {
    mockLocale = readLocale("AdminDashboard", "fa");
    render(<ThemeChoiceRow />);

    expect(screen.getByRole("group", { name: "پوسته" })).toBeInTheDocument();
    expect(choice(ThemePreference.System)).toHaveAttribute(
      "aria-label",
      "سیستم",
    );
  });
});
