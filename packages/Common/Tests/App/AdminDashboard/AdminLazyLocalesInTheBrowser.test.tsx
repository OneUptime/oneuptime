import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  chooseDropdownOption,
  getShownDropdownValue,
} from "../../DropdownPicks";
import type { i18n as I18nInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES } from "../../../Types/AdminDashboard/AdminDashboardLanguage";
import LanguageSwitcher from "../../../../App/FeatureSet/AdminDashboard/src/Components/LanguageSwitcher/LanguageSwitcher";
import { setCodeApartInSentence } from "../../../Types/CodeInSentence";

/*
 * THE ADMIN DASHBOARD LOADS ITS READER'S LANGUAGE, AND A SWITCH LOADS THE
 * NEXT ONE (#8146).
 *
 * The Admin Dashboard's real Utils/i18n.ts, loaded as a browser loads it,
 * in a fresh module registry, for a reader of each language: English is
 * there from the start, the reader's language is fetched - one chunk, the
 * loader asked once - and no other language is. The language menu's
 * switch fetches the new language before it shows it, and keeps the one
 * already fetched. The loader is the real one (I18nLocaleLoader), wrapped
 * to count what it is asked for.
 *
 * The browser's language detector is installed only with the frontends,
 * and Common's tests stand it in with one that always says English
 * (Tests/__mocks__). Here it is a stand-in that detects as the Admin's
 * options tell it to: the language kept in the browser, then the
 * browser's, each through the Admin's convertDetectedLanguage; and it keeps
 * the language shown.
 */

jest.setTimeout(120000);

interface DetectionOptions {
  order: Array<string>;
  lookupLocalStorage: string;
  caches: Array<string>;
  convertDetectedLanguage: (language: string) => string;
}

class BrowserLanguageDetector {
  public static type: string = "languageDetector";

  private options: DetectionOptions | null = null;

  public init(
    _services: unknown,
    options: DetectionOptions,
    i18nOptions: { detection?: DetectionOptions },
  ): void {
    this.options = i18nOptions.detection || options;
  }

  public detect(): Array<string> {
    const options: DetectionOptions = this.options as DetectionOptions;
    const found: Array<string> = [];

    for (const lookup of options.order) {
      if (lookup === "localStorage") {
        const kept: string | null = window.localStorage.getItem(
          options.lookupLocalStorage,
        );

        if (kept) {
          found.push(kept);
        }
      } else if (lookup === "navigator") {
        found.push(...window.navigator.languages);
      }
    }

    return found.map(options.convertDetectedLanguage);
  }

  public cacheUserLanguage(language: string): void {
    const options: DetectionOptions = this.options as DetectionOptions;

    if (options.caches.includes("localStorage")) {
      window.localStorage.setItem(options.lookupLocalStorage, language);
    }
  }
}

const ADMIN_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src",
);

const I18N_MODULE: string = path.join(ADMIN_SRC, "Utils", "i18n.ts");
const LOADER_MODULE: string = path.join(
  ADMIN_SRC,
  "Utils",
  "I18nLocaleLoader.ts",
);
const SWITCH_MODULE: string = path.join(
  ADMIN_SRC,
  "Utils",
  "AdminDashboardLanguageSwitch.ts",
);

const readLocale: (code: string) => Record<string, unknown> = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(ADMIN_SRC, "Locales", `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const setBrowserLanguages: (languages: Array<string>) => void = (
  languages: Array<string>,
): void => {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: (): Array<string> => {
      return languages;
    },
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    get: (): string => {
      return languages[0] || "en";
    },
  });
};

interface LoadedAdmin {
  i18n: I18nInstance;
  ready: Promise<void>;
  // Each language the loader was asked for, in order.
  asked: Array<string>;
  switchLanguage: (i18n: I18nInstance, language: string) => Promise<void>;
}

// The Admin's i18n module, fresh, for a reader whose browser asks for `languages`.
const loadAdmin: (data: {
  languages: Array<string>;
  stored?: string;
}) => LoadedAdmin = (data: {
  languages: Array<string>;
  stored?: string;
}): LoadedAdmin => {
  window.localStorage.clear();

  if (data.stored) {
    window.localStorage.setItem("oneuptimeLang", data.stored);
  }

  setBrowserLanguages(data.languages);

  const asked: Array<string> = [];
  let loaded: LoadedAdmin | null = null;

  jest.isolateModules(() => {
    jest.doMock("i18next-browser-languagedetector", () => {
      return { __esModule: true, default: BrowserLanguageDetector };
    });
    jest.doMock(LOADER_MODULE, () => {
      const actual: {
        loadLocaleResource: (code: string) => Promise<unknown>;
      } = jest.requireActual(LOADER_MODULE) as {
        loadLocaleResource: (code: string) => Promise<unknown>;
      };

      return {
        ...actual,
        loadLocaleResource: (code: string): Promise<unknown> => {
          asked.push(code);
          return actual.loadLocaleResource(code);
        },
      };
    });

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const i18nModule: {
      default: I18nInstance;
      i18nReady: Promise<void>;
    } = require(I18N_MODULE);
    const switchModule: {
      switchAdminDashboardLanguage: LoadedAdmin["switchLanguage"];
    } = require(SWITCH_MODULE);
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    loaded = {
      i18n: i18nModule.default,
      ready: i18nModule.i18nReady,
      asked,
      switchLanguage: switchModule.switchAdminDashboardLanguage,
    };
  });

  return loaded!;
};

// The languages whose words the instance holds.
const languagesHeld: (i18n: I18nInstance) => Array<string> = (
  i18n: I18nInstance,
): Array<string> => {
  return SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES.filter(
    (code: string): boolean => {
      return i18n.hasResourceBundle(code, "translation");
    },
  ).sort();
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  jest.dontMock(LOADER_MODULE);
  jest.dontMock("i18next-browser-languagedetector");
});

describe("a reader's first page", () => {
  test("in English: nothing is fetched, English is there", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["en-US", "en"] });

    await admin.ready;

    expect(admin.i18n.language).toBe("en");
    expect(admin.asked).toEqual([]);
    expect(languagesHeld(admin.i18n)).toEqual(["en"]);
    expect(
      admin.i18n.t("By Question", {
        keySeparator: false,
        nsSeparator: false,
      }),
    ).toBe("By Question");
  });

  test.each(
    SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )(
    "in %s: that language alone is fetched, once, and read from the first frame",
    async (code: string) => {
      const admin: LoadedAdmin = loadAdmin({ languages: [code] });

      await admin.ready;

      expect(admin.i18n.language).toBe(code);
      expect(admin.asked).toEqual([code]);
      expect(languagesHeld(admin.i18n)).toEqual(["en", code].sort());
      expect(
        admin.i18n.t("By Question", {
          defaultValue: "By Question",
          keySeparator: false,
          nsSeparator: false,
        }),
      ).toBe(readLocale(code)["By Question"]);
    },
  );

  test("the language a person picked before, kept in the browser, wins over the browser's", async () => {
    const admin: LoadedAdmin = loadAdmin({
      languages: ["de-DE", "de"],
      stored: "fa",
    });

    await admin.ready;

    expect(admin.i18n.language).toBe("fa");
    expect(admin.asked).toEqual(["fa"]);
    expect(languagesHeld(admin.i18n)).toEqual(["en", "fa"]);
  });

  test("a legacy Chinese pick, zh, reads Simplified Chinese and fetches it", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["en"], stored: "zh" });

    await admin.ready;

    expect(admin.i18n.language).toBe("zh-CN");
    expect(admin.asked).toEqual(["zh-CN"]);
  });

  test("a language the Admin does not speak fetches nothing, and reads English", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["tlh", "xx-YY"] });

    await admin.ready;

    expect(admin.asked).toEqual([]);
    expect(languagesHeld(admin.i18n)).toEqual(["en"]);
    expect(
      admin.i18n.t("What People Said", {
        defaultValue: "What People Said",
        keySeparator: false,
        nsSeparator: false,
      }),
    ).toBe("What People Said");
  });

  /*
   * The rules that set code apart in a sentence read from the right came
   * with every language in the entry chunk. They come with an Arabic or
   * Persian chunk now: an Arabic page's first sentence that names code is
   * set apart all the same.
   */
  test("in Arabic, a sentence that names code is set apart from the first frame", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["ar"] });

    await admin.ready;

    const sentence: string = "أضف --help إلى أي أمر.";

    admin.i18n.addResourceBundle(
      "ar",
      "translation",
      { probe: sentence },
      true,
      true,
    );

    expect(admin.i18n.t("probe", { nsSeparator: false })).toBe(
      setCodeApartInSentence(sentence, "ar"),
    );
  });
});

describe("a switch of language", () => {
  test("fetches the new language before it shows it, and keeps the one fetched before", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["de"] });

    await admin.ready;

    expect(admin.asked).toEqual(["de"]);

    await admin.switchLanguage(admin.i18n, "fa");

    expect(admin.i18n.language).toBe("fa");
    expect(admin.asked).toEqual(["de", "fa"]);
    expect(languagesHeld(admin.i18n)).toEqual(["de", "en", "fa"]);
    expect(
      admin.i18n.t("By Question", {
        defaultValue: "By Question",
        keySeparator: false,
        nsSeparator: false,
      }),
    ).toBe(readLocale("fa")["By Question"]);
    // The pick is kept for the next page load.
    expect(window.localStorage.getItem("oneuptimeLang")).toBe("fa");

    // Back to German: nothing fetched again.
    await admin.switchLanguage(admin.i18n, "de");

    expect(admin.asked).toEqual(["de", "fa"]);
    expect(admin.i18n.language).toBe("de");
  });

  test("to English, nothing is fetched", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["ja"] });

    await admin.ready;
    await admin.switchLanguage(admin.i18n, "en");

    expect(admin.asked).toEqual(["ja"]);
    expect(admin.i18n.language).toBe("en");
  });

  test("the language menu fetches the picked language, then the page reads it", async () => {
    const admin: LoadedAdmin = loadAdmin({ languages: ["en"] });

    await admin.ready;

    /*
     * The real menu, drawn with the test's own React: it switches the
     * instance it is handed (I18nextProvider), the fresh one above.
     */
    render(
      <I18nextProvider i18n={admin.i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );

    // The menu is the shared Dropdown: each language by its own name.
    const menu: HTMLElement = screen.getByRole("combobox");

    expect(getShownDropdownValue(menu)).toBe("English");

    chooseDropdownOption(menu, "Deutsch");

    await waitFor(() => {
      expect(admin.i18n.language).toBe("de");
    });

    expect(admin.asked).toEqual(["de"]);
    expect(getShownDropdownValue(screen.getByRole("combobox"))).toBe("Deutsch");
    expect(languagesHeld(admin.i18n)).toEqual(["de", "en"]);
  });
});
