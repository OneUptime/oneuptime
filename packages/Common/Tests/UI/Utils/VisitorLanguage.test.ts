import { afterEach, describe, expect, test } from "@jest/globals";
import i18n from "i18next";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import {
  getBrowserLanguages,
  getVisitorLanguage,
  startVisitorTranslation,
  toSupportedLanguage,
} from "../../../UI/Utils/VisitorLanguage";

/*
 * The language a page's visitor reads when the page offers no way to pick
 * one - a public dashboard: the first of the browser's languages the page
 * has words for, as the browser lists them, and English otherwise. Mapped
 * the way every frontend maps a browser's language tag (its own
 * Utils/i18n's convertDetectedLanguage): Traditional and Simplified Chinese
 * from every tag a browser writes them with, and a regional variant to its
 * language.
 */

const ALL: ReadonlyArray<string> = SUPPORTED_DASHBOARD_LANGUAGE_CODES;

const setBrowserLanguages: (
  languages: Array<string> | undefined,
  language?: string,
) => void = (languages: Array<string> | undefined, language?: string): void => {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: (): Array<string> | undefined => {
      return languages;
    },
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    get: (): string => {
      return language ?? languages?.[0] ?? "";
    },
  });
};

afterEach(() => {
  setBrowserLanguages(["en-US"]);
});

describe("toSupportedLanguage", () => {
  test.each<[string, string]>([
    ["de", "de"],
    ["de-AT", "de"],
    ["DE-ch", "de"],
    ["pt_BR", "pt"],
    ["fa-IR", "fa"],
    ["zh", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh_CN", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-tw", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-MO", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
  ])("%s is %s", (tag: string, language: string) => {
    expect(toSupportedLanguage(tag, ALL)).toBe(language);
  });

  test.each<[string | null | undefined]>([
    ["xx"],
    ["xx-YY"],
    ["nb-NO"],
    [""],
    [null],
    [undefined],
  ])("%s is none of them", (tag: string | null | undefined) => {
    expect(toSupportedLanguage(tag, ALL)).toBe("");
  });

  test("only what the page has words for: Chinese is none when it has none", () => {
    expect(toSupportedLanguage("zh-TW", ["en", "de"])).toBe("");
    expect(toSupportedLanguage("zh", ["en", "de"])).toBe("");
    expect(toSupportedLanguage("de-AT", ["en", "de"])).toBe("de");
  });
});

describe("getVisitorLanguage", () => {
  test("the first of the browser's languages the page speaks", () => {
    expect(getVisitorLanguage(["xx-YY", "ko-KR", "de"], ALL)).toBe("ko");
  });

  test("English when it speaks none of them, or the browser lists none", () => {
    expect(getVisitorLanguage(["xx", "yy"], ALL)).toBe("en");
    expect(getVisitorLanguage([], ALL)).toBe("en");
  });
});

describe("getBrowserLanguages", () => {
  test("the browser's list, in its order", () => {
    setBrowserLanguages(["fr-CA", "en"]);

    expect(getBrowserLanguages()).toEqual(["fr-CA", "en"]);
  });

  test("its one language when it lists none", () => {
    setBrowserLanguages([], "ja-JP");

    expect(getBrowserLanguages()).toEqual(["ja-JP"]);
  });

  test("nothing when it says nothing", () => {
    setBrowserLanguages(undefined, "");

    expect(getBrowserLanguages()).toEqual([]);
  });
});

describe("startVisitorTranslation", () => {
  test("starts the page's translation in the visitor's language, with English to fall back on", async () => {
    setBrowserLanguages(["fa-IR", "en-US"]);

    const language: string = startVisitorTranslation({
      en: { "You're offline": "You're offline", Loading: "Loading" },
      fa: { "You're offline": "شما آفلاین هستید" },
    });

    expect(language).toBe("fa");

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(i18n.language).toBe("fa");
    expect(i18n.t("You're offline")).toBe("شما آفلاین هستید");
    // A word it has no Persian for: English, never the key's path.
    expect(i18n.t("Loading")).toBe("Loading");
    // Keys are whole sentences: a dot or a colon in one is part of it.
    expect(i18n.t("Done. Next: reload")).toBe("Done. Next: reload");
  });
});
