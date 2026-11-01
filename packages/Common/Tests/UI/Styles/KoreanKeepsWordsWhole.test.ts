/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import { setPageLanguage } from "../../../UI/Utils/PageLanguage";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { StyleRule, THEME_RULES, declaredValue } from "./ThemeStylesheet";

/*
 * KOREAN KEEPS ITS WORDS WHOLE.
 *
 * Korean puts spaces between its words, but a browser breaks Korean text
 * between any two syllables, as it breaks Chinese and Japanese, which have
 * none: a narrow tile drew 처리량 (throughput) as "처리" over "량", two
 * words. word-break: keep-all breaks Korean only between words, and it can
 * only apply once the page says it is Korean - which it does now, on
 * <html lang> (Common/UI/Utils/PageLanguage). Theme.css, which every
 * frontend loads, holds the rule.
 *
 * The geometry - each word on one line in a narrow box, in real Chromium -
 * is held by E2E/ReadingDirection ("Korean keeps its words whole").
 */

const KOREAN_RULE_SELECTOR: string = "html:lang(ko)";

describe("Theme.css keeps Korean words whole", () => {
  test("a Korean page breaks lines only between words", () => {
    expect(declaredValue(KOREAN_RULE_SELECTOR, "word-break")).toBe(
      "keep-all",
    );
  });

  test("a word too long for its line still breaks instead of running out of its box", () => {
    expect(declaredValue(KOREAN_RULE_SELECTOR, "overflow-wrap")).toBe(
      "break-word",
    );
  });

  test("the rule sits on <html> and is inherited, so an element's own word-break wins", () => {
    /*
     * On <html> only: a universal :lang(ko) rule would match every element
     * with a class's weight and override break-all where a table or an ID
     * asks for it. Inherited, any element's own class beats it.
     */
    const koreanRules: Array<StyleRule> = THEME_RULES.filter(
      (rule: StyleRule): boolean => {
        return rule.selectors.some((selector: string): boolean => {
          return selector.includes(":lang(ko)");
        });
      },
    );

    expect(
      koreanRules.map((rule: StyleRule): Array<string> => {
        return rule.selectors;
      }),
    ).toEqual([[KOREAN_RULE_SELECTOR]]);
  });

  test("Chinese and Japanese, which have no spaces between words, are never kept whole", () => {
    const keepAllSelectors: Array<string> = THEME_RULES.filter(
      (rule: StyleRule): boolean => {
        return rule.declarations["word-break"] === "keep-all";
      },
    ).flatMap((rule: StyleRule): Array<string> => {
      return rule.selectors;
    });

    expect(keepAllSelectors).toEqual([KOREAN_RULE_SELECTOR]);
  });
});

describe("a Korean page says it is Korean", () => {
  test("the Dashboard offers Korean under the code the rule reads", () => {
    expect(SUPPORTED_DASHBOARD_LANGUAGE_CODES).toContain("ko");
  });

  test("<html lang> is ko on a Korean page, and the rule matches it", () => {
    const root: HTMLElement = document.createElement("html");

    setPageLanguage("ko", root);

    expect(root.getAttribute("lang")).toBe("ko");
    expect(root.getAttribute("dir")).toBe("ltr");
    expect(root.matches(":lang(ko)")).toBe(true);
  });

  test("another language's page is not matched", () => {
    for (const language of ["en", "ja", "zh-CN", "zh-TW", "de", "fa"]) {
      const root: HTMLElement = document.createElement("html");

      setPageLanguage(language, root);

      expect(root.matches(":lang(ko)")).toBe(false);
    }
  });
});
