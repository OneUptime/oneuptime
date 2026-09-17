import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "../../../Types/StatusPage/StatusPageLanguage";
import { describe, expect, test } from "@jest/globals";

describe("SUPPORTED_STATUS_PAGE_LANGUAGES", () => {
  test("registers Persian (fa) with its native and English names", () => {
    const persian: StatusPageLanguage | undefined =
      SUPPORTED_STATUS_PAGE_LANGUAGES.find((language: StatusPageLanguage) => {
        return language.code === "fa";
      });

    expect(persian).toEqual({
      code: "fa",
      nativeName: "فارسی",
      englishName: "Persian",
    });
  });

  test("includes fa in the derived language-code list", () => {
    expect(SUPPORTED_STATUS_PAGE_LANGUAGE_CODES).toContain("fa");
  });

  test("does not change the default language", () => {
    expect(DEFAULT_STATUS_PAGE_LANGUAGE).toBe("en");
  });

  test("every supported language has a unique, non-blank code", () => {
    const codes: Array<string> = SUPPORTED_STATUS_PAGE_LANGUAGES.map(
      (language: StatusPageLanguage) => {
        return language.code;
      },
    );

    for (const code of codes) {
      expect(code.trim().length).toBeGreaterThan(0);
    }

    expect(new Set<string>(codes).size).toBe(codes.length);
  });
});
