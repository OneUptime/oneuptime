import { describe, expect, test } from "@jest/globals";
import { READER_LANGUAGE_CODES } from "../../Types/ReaderLanguage";
import {
  getUserChosenLanguage,
  getUserWritingLanguage,
  normalizeUserLanguageToStore,
  UNSUPPORTED_USER_LANGUAGE_MESSAGE,
} from "../../Types/UserLanguage";

/*
 * A PERSON'S LANGUAGE (fu-i18n-larger): part of their account, picked on
 * User Profile or with the Dashboard's language menu. What a write stores,
 * what a person picked, and what OneUptime writes to them in.
 */

describe("what a write stores as a person's language", () => {
  test("each of the codes OneUptime writes in, as it is", () => {
    for (const code of READER_LANGUAGE_CODES) {
      expect([code, normalizeUserLanguageToStore(code)]).toEqual([code, code]);
    }
  });

  test("a regional tag as the language OneUptime writes it in", () => {
    expect(normalizeUserLanguageToStore("de-AT")).toBe("de");
    expect(normalizeUserLanguageToStore("pt-BR")).toBe("pt");
    expect(normalizeUserLanguageToStore("zh-HK")).toBe("zh-TW");
    expect(normalizeUserLanguageToStore("zh-Hant-TW")).toBe("zh-TW");
    expect(normalizeUserLanguageToStore("zh")).toBe("zh-CN");
    expect(normalizeUserLanguageToStore("nb-NO")).toBe("no");
    expect(normalizeUserLanguageToStore("  fr  ")).toBe("fr");
  });

  test("English is a choice of its own, kept as en", () => {
    expect(normalizeUserLanguageToStore("en")).toBe("en");
    expect(normalizeUserLanguageToStore("en-GB")).toBe("en");
  });

  test("nothing - null, undefined, an empty or blank value - is none", () => {
    expect(normalizeUserLanguageToStore(null)).toBeNull();
    expect(normalizeUserLanguageToStore(undefined)).toBeNull();
    expect(normalizeUserLanguageToStore("")).toBeNull();
    expect(normalizeUserLanguageToStore("   ")).toBeNull();
  });

  test("a language OneUptime does not write in, or not a text at all, is refused (undefined)", () => {
    expect(normalizeUserLanguageToStore("xx")).toBeUndefined();
    expect(normalizeUserLanguageToStore("klingon")).toBeUndefined();
    expect(normalizeUserLanguageToStore(42)).toBeUndefined();
    expect(normalizeUserLanguageToStore({ code: "de" })).toBeUndefined();
    expect(normalizeUserLanguageToStore(["de"])).toBeUndefined();
    expect(normalizeUserLanguageToStore(true)).toBeUndefined();
  });

  test("the refusal names every code a person can pick", () => {
    for (const code of READER_LANGUAGE_CODES) {
      expect(UNSUPPORTED_USER_LANGUAGE_MESSAGE).toContain(code);
    }

    expect(UNSUPPORTED_USER_LANGUAGE_MESSAGE).toContain(
      "Leave it empty to be written to in English.",
    );
  });
});

describe("the language a person picked, and the one they are written to in", () => {
  test("a picked language is theirs", () => {
    expect(getUserChosenLanguage({ language: "de" })).toBe("de");
    expect(getUserWritingLanguage({ language: "de" })).toBe("de");
    expect(getUserWritingLanguage({ language: "fa" })).toBe("fa");
    expect(getUserWritingLanguage({ language: "zh-TW" })).toBe("zh-TW");
  });

  test("English picked is English", () => {
    expect(getUserChosenLanguage({ language: "en" })).toBe("en");
    expect(getUserWritingLanguage({ language: "en" })).toBe("en");
  });

  test("none picked: nothing chosen, written to in English", () => {
    for (const user of [
      null,
      undefined,
      {},
      { language: null },
      { language: undefined },
      { language: "" },
    ]) {
      expect(getUserChosenLanguage(user)).toBe("");
      expect(getUserWritingLanguage(user)).toBe("en");
    }
  });

  test("a stored value OneUptime does not write in is no choice: English", () => {
    expect(getUserChosenLanguage({ language: "xx" })).toBe("");
    expect(getUserWritingLanguage({ language: "xx" })).toBe("en");
  });

  test("a stored regional tag reads as its language", () => {
    expect(getUserWritingLanguage({ language: " de-CH " })).toBe("de");
  });
});
