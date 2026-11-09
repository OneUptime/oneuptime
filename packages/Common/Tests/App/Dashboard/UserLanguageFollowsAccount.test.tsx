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
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import i18next, { i18n as I18n } from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * THE DASHBOARD FOLLOWS THE LANGUAGE A PERSON PICKED, ON EVERY BROWSER
 * (fu-i18n-larger).
 *
 * A person's language is part of their account (Types/UserLanguage). The
 * Dashboard starts in it once the page is up (UserLanguageInit), User
 * Profile's save switches to it at once, and a pick in the language menu
 * switches the page and is saved to the account - the language their
 * on-call pages are written in. A person who picked none is left in the
 * language the page shows, as before.
 *
 * The components and the switch are the real ones, with the shipped
 * Dashboard locales; the account's language is stubbed (UserLanguageUtil
 * has its own suite), and so is the Dashboard's i18n setup, which only
 * lists the languages to the menu here.
 */

jest.mock("../../../UI/Utils/UserLanguage", () => {
  return {
    __esModule: true,
    default: {
      readSignedInUserLanguage: jest.fn(),
      saveSignedInUserLanguage: jest.fn(),
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/i18n", () => {
  const languages: { SUPPORTED_DASHBOARD_LANGUAGES: unknown } =
    jest.requireActual("../../../Types/Dashboard/DashboardLanguage") as {
      SUPPORTED_DASHBOARD_LANGUAGES: unknown;
    };

  return {
    __esModule: true,
    SUPPORTED_LANGUAGES: languages.SUPPORTED_DASHBOARD_LANGUAGES,
  };
});

import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import UserLanguageUtil from "../../../UI/Utils/UserLanguage";
import LanguageSwitcher from "../../../../App/FeatureSet/Dashboard/src/Components/LanguageSwitcher/LanguageSwitcher";
import UserLanguageInit from "../../../../App/FeatureSet/Dashboard/src/Components/UserLanguage/UserLanguageInit";
import {
  getUserLanguageLabelOfCode,
  USER_LANGUAGE_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserLanguage/UserLanguageOptions";
import {
  followUserLanguage,
  getDashboardLanguage,
  switchDashboardLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardLanguageSwitch";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (locale: string) => Record<string, unknown> = (
  locale: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const account: {
  readSignedInUserLanguage: Mock<() => Promise<string>>;
  saveSignedInUserLanguage: Mock<(language: string) => Promise<boolean>>;
} = UserLanguageUtil as unknown as {
  readSignedInUserLanguage: Mock<() => Promise<string>>;
  saveSignedInUserLanguage: Mock<(language: string) => Promise<boolean>>;
};

// An i18next stand-in that records what a switch asks of it, in order.
interface RecordingI18n {
  i18n: I18n;
  calls: Array<string>;
}

const recordingI18n: (
  shows: { resolvedLanguage?: string; language?: string },
  options?: { loadFails?: boolean },
) => RecordingI18n = (
  shows: { resolvedLanguage?: string; language?: string },
  options: { loadFails?: boolean } = {},
): RecordingI18n => {
  const calls: Array<string> = [];
  const i18n: Record<string, unknown> = {
    ...shows,
    loadLanguages: async (language: string): Promise<void> => {
      calls.push(`load ${language}`);

      if (options.loadFails) {
        throw new Error("chunk failed to load");
      }
    },
    changeLanguage: async (language: string): Promise<void> => {
      calls.push(`change ${language}`);
    },
  };

  return { i18n: i18n as unknown as I18n, calls: calls };
};

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

beforeEach(async () => {
  account.readSignedInUserLanguage.mockReset();
  account.saveSignedInUserLanguage.mockReset();
  account.readSignedInUserLanguage.mockResolvedValue("");
  account.saveSignedInUserLanguage.mockResolvedValue(true);

  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("followUserLanguage", () => {
  test("a language the page does not show yet: its bundle is loaded, then the page switches", async () => {
    const recording: RecordingI18n = recordingI18n({
      resolvedLanguage: "en",
      language: "en",
    });

    await expect(followUserLanguage(recording.i18n, "de")).resolves.toBe(true);
    expect(recording.calls).toEqual(["load de", "change de"]);
  });

  test("none picked: the page is left in the language it shows", async () => {
    const recording: RecordingI18n = recordingI18n({ language: "fr" });

    await expect(followUserLanguage(recording.i18n, "")).resolves.toBe(false);
    expect(recording.calls).toEqual([]);
  });

  test("the language the page shows already: nothing to do", async () => {
    const recording: RecordingI18n = recordingI18n({
      resolvedLanguage: "de",
      language: "de-AT",
    });

    await expect(followUserLanguage(recording.i18n, "de")).resolves.toBe(false);
    expect(recording.calls).toEqual([]);
  });

  test("a bundle that cannot be fetched still switches: English fills what it misses", async () => {
    const recording: RecordingI18n = recordingI18n(
      { resolvedLanguage: "en" },
      { loadFails: true },
    );

    await switchDashboardLanguage(recording.i18n, "ja");

    expect(recording.calls).toEqual(["load ja", "change ja"]);
  });

  test("the language the page shows: the one it resolved to, else the one asked for, else English", () => {
    expect(
      getDashboardLanguage(
        recordingI18n({ resolvedLanguage: "de", language: "de-AT" }).i18n,
      ),
    ).toBe("de");
    expect(getDashboardLanguage(recordingI18n({ language: "fr" }).i18n)).toBe(
      "fr",
    );
    expect(getDashboardLanguage(recordingI18n({}).i18n)).toBe("en");
  });
});

describe("UserLanguageInit", () => {
  test("starts the Dashboard in the person's own language", async () => {
    account.readSignedInUserLanguage.mockResolvedValue("de");

    render(<UserLanguageInit />);

    await waitFor(() => {
      expect(i18next.language).toBe("de");
    });
    expect(account.readSignedInUserLanguage).toHaveBeenCalledTimes(1);
  });

  test("a person who picked none: the page stays in the language it shows", async () => {
    const change: SpyInstance<typeof i18next.changeLanguage> = jest.spyOn(
      i18next,
      "changeLanguage",
    );

    render(<UserLanguageInit />);
    await settle();

    expect(account.readSignedInUserLanguage).toHaveBeenCalledTimes(1);
    expect(change).not.toHaveBeenCalled();
    expect(i18next.language).toBe("en");
  });

  test("reads the account once for the page, not on every render", async () => {
    account.readSignedInUserLanguage.mockResolvedValue("de");

    const view: ReturnType<typeof render> = render(<UserLanguageInit />);

    view.rerender(<UserLanguageInit />);
    view.rerender(<UserLanguageInit />);
    await settle();

    expect(account.readSignedInUserLanguage).toHaveBeenCalledTimes(1);
  });

  test("the language menu shows the language the account switched the page to", async () => {
    account.readSignedInUserLanguage.mockResolvedValue("de");

    render(
      <>
        <UserLanguageInit />
        <LanguageSwitcher />
      </>,
    );

    const menu: HTMLSelectElement = screen.getByRole(
      "combobox",
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(menu.value).toBe("de");
    });
    // Switched by the account, so nothing to save back to it.
    expect(account.saveSignedInUserLanguage).not.toHaveBeenCalled();
  });
});

describe("the language menu", () => {
  test("a pick switches the page first, then is saved to the person's account", async () => {
    let shownWhenSaved: string = "";

    account.saveSignedInUserLanguage.mockImplementation(
      async (): Promise<boolean> => {
        shownWhenSaved = i18next.language;
        return true;
      },
    );

    render(<LanguageSwitcher />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "de" },
    });

    await waitFor(() => {
      expect(account.saveSignedInUserLanguage).toHaveBeenCalledWith("de");
    });
    expect(account.saveSignedInUserLanguage).toHaveBeenCalledTimes(1);
    expect(shownWhenSaved).toBe("de");
    expect(i18next.language).toBe("de");
  });

  test("a pick that cannot be saved - signed out, or offline - still shows the page in it", async () => {
    account.saveSignedInUserLanguage.mockResolvedValue(false);

    render(<LanguageSwitcher />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "de" },
    });

    await waitFor(() => {
      expect(account.saveSignedInUserLanguage).toHaveBeenCalledWith("de");
    });
    await settle();

    expect(i18next.language).toBe("de");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "de",
    );
  });
});

describe("User Profile's Language", () => {
  test("offers every language OneUptime writes a page in, by its code", () => {
    expect(
      USER_LANGUAGE_OPTIONS.map((option: { value: unknown }): string => {
        return String(option.value);
      }),
    ).toEqual([...READER_LANGUAGE_CODES]);
  });

  test("names each in its own words, then in English when that differs", () => {
    expect(getUserLanguageLabelOfCode("de")).toBe("Deutsch (German)");
    expect(getUserLanguageLabelOfCode("ja")).toBe("日本語 (Japanese)");
    expect(getUserLanguageLabelOfCode("en")).toBe("English");
  });

  test("a stored code OneUptime does not write in is shown as it is, never hidden", () => {
    expect(getUserLanguageLabelOfCode("xx")).toBe("xx");
  });
});
