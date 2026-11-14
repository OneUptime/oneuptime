/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { setPageLanguage } from "../../../UI/Utils/PageLanguage";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { StyleRule, THEME_RULES, declaredValue } from "./ThemeStylesheet";

/*
 * A PERSIAN NUMBERED LIST COUNTS IN PERSIAN DIGITS (issue #7258).
 *
 * A page writes its numbers in the reader's digits, but a list the browser
 * numbers - Tailwind's list-decimal (the Markdown viewer's numbered lists,
 * the TestPage's methods, a runbook's steps) and the Markdown editor's own
 * numbered lists - counted "1. 2. 3." in Latin digits whatever the page's
 * language, beside Persian words and figures. Theme.css, which every
 * frontend loads, now counts them in the browser's persian counter style on
 * a Persian page (<html lang="fa">, Common/UI/Utils/PageLanguage): "۱. ۲.
 * ۳.". Arabic keeps decimal, as it writes Latin digits by choice.
 *
 * The browser's own reading - getComputedStyle's listStyleType on the
 * TestPage's methods list, in real Chromium - is held by E2E/TestPage
 * ("in Persian ..." and "in Arabic ...").
 */

const PERSIAN_SELECTORS: Array<string> = [
  "html:lang(fa) .list-decimal",
  "html:lang(fa) .oneuptime-wysiwyg ol",
];

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
  "utf8",
);

const MARKDOWN_EDITOR: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../UI/Components/Markdown.tsx/MarkdownEditor.tsx",
  ),
  "utf8",
);

// The Markdown editor's own rule for its numbered lists, as it writes it.
const EDITOR_NUMBERED_LIST_RULE: string =
  ".oneuptime-wysiwyg ol { list-style-type: decimal; }";

describe("Theme.css counts a Persian page's numbered lists in Persian digits", () => {
  test("each numbered list is counted in the persian counter style", () => {
    for (const selector of PERSIAN_SELECTORS) {
      expect(declaredValue(selector, "list-style-type")).toBe("persian");
    }
  });

  test("the rule reads <html lang>, and only Persian's", () => {
    const persianRules: Array<StyleRule> = THEME_RULES.filter(
      (rule: StyleRule): boolean => {
        return rule.declarations["list-style-type"] === "persian";
      },
    );

    expect(
      persianRules.map((rule: StyleRule): Array<string> => {
        return rule.selectors;
      }),
    ).toEqual([PERSIAN_SELECTORS]);
  });

  test("Arabic, which writes Latin digits by choice, keeps decimal: no rule counts its lists another way", () => {
    const arabicRules: Array<StyleRule> = THEME_RULES.filter(
      (rule: StyleRule): boolean => {
        return rule.selectors.some((selector: string): boolean => {
          return selector.includes(":lang(ar)");
        });
      },
    );

    for (const rule of arabicRules) {
      expect(rule.declarations["list-style-type"]).toBeUndefined();
    }
  });

  test("the editor's own decimal rule is still there, and the Persian rule outweighs it", () => {
    /*
     * The editor writes its lists' style in a <style> of its own; the
     * Persian rule names <html>, :lang() and the editor's class, so it
     * wins wherever the two are loaded.
     */
    expect(MARKDOWN_EDITOR).toContain(EDITOR_NUMBERED_LIST_RULE);
  });
});

describe("the browser applies it: a Persian page's list counts in Persian, another's does not", () => {
  const PERSIAN_RULE_TEXT: string = THEME_CSS.slice(
    THEME_CSS.indexOf(PERSIAN_SELECTORS[0]!),
    THEME_CSS.indexOf("}", THEME_CSS.indexOf(PERSIAN_SELECTORS[0]!)) + 1,
  );

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
  });

  // The list style each numbered list is drawn with, on a page in `language`.
  function listStylesIn(language: string): {
    viewer: string;
    editor: string;
    plain: string;
  } {
    const style: HTMLStyleElement = document.createElement("style");
    // Tailwind's own list-decimal, the editor's decimal rule, then Theme.css's.
    style.textContent = [
      ".list-decimal { list-style-type: decimal; }",
      EDITOR_NUMBERED_LIST_RULE,
      PERSIAN_RULE_TEXT,
    ].join("\n");
    document.head.appendChild(style);

    setPageLanguage(language, document.documentElement);

    document.body.innerHTML = [
      '<ol class="list-decimal" data-testid="viewer"><li>One</li></ol>',
      '<div class="oneuptime-wysiwyg"><ol data-testid="editor"><li>One</li></ol></div>',
      '<ol data-testid="plain"><li>One</li></ol>',
    ].join("");

    const styleOf: (testId: string) => string = (testId: string): string => {
      return window.getComputedStyle(
        document.querySelector(`[data-testid="${testId}"]`) as Element,
      ).listStyleType;
    };

    return {
      viewer: styleOf("viewer"),
      editor: styleOf("editor"),
      plain: styleOf("plain"),
    };
  }

  test("the rule text is the whole rule", () => {
    expect(PERSIAN_RULE_TEXT).toContain(PERSIAN_SELECTORS[1]!);
    expect(PERSIAN_RULE_TEXT).toContain("list-style-type: persian;");
  });

  test("fa: the viewer's and the editor's numbered lists count in Persian", () => {
    const styles: { viewer: string; editor: string; plain: string } =
      listStylesIn("fa");

    expect(styles.viewer).toBe("persian");
    expect(styles.editor).toBe("persian");
    // A list drawn without the numbered class is left as it is.
    expect(styles.plain).not.toBe("persian");
  });

  test.each(["ar", "en", "de", "ja"])(
    "%s: numbered lists stay decimal",
    (language: string) => {
      const styles: { viewer: string; editor: string; plain: string } =
        listStylesIn(language);

      expect(styles.viewer).toBe("decimal");
      expect(styles.editor).toBe("decimal");
    },
  );
});

describe("a Persian page says it is Persian", () => {
  test("the Dashboard offers Persian under the code the rule reads", () => {
    expect(SUPPORTED_DASHBOARD_LANGUAGE_CODES).toContain("fa");
  });

  test("<html lang> is fa on a Persian page, and the rule's :lang(fa) matches it", () => {
    const root: HTMLElement = document.createElement("html");

    setPageLanguage("fa", root);

    expect(root.getAttribute("lang")).toBe("fa");
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(root.matches(":lang(fa)")).toBe(true);
  });

  test("Arabic's page, read from the right too, is not matched", () => {
    for (const language of ["ar", "en", "de", "ko"]) {
      const root: HTMLElement = document.createElement("html");

      setPageLanguage(language, root);

      expect(root.matches(":lang(fa)")).toBe(false);
    }
  });
});
