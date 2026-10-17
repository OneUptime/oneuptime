/**
 * The wiring of a status page's theme through the status page app.
 *
 * Every piece is tested on its own: the theme module, the template before and
 * after its first script, the servers that render it, the client util and the
 * components. What is left is the app handing one piece to the next - and a
 * break there leaves no trace: the page loads, light, and nothing fails. So
 * the app's entry, its master page and its pages are read, the way
 * SearchEngineIndexingWiring.test.ts reads the renderers.
 *
 * Sources are stripped of comments and whitespace-squashed first, so a
 * comment cannot pass a test on its own, and prettier re-wrapping a line
 * cannot fail one.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "StatusPage",
  "src",
);

const LOCALES_DIR: string = path.join(STATUS_PAGE_SRC, "Locales");

const LANGUAGES: Array<string> = [
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
 * Each block comment, from its opener to the next closer, as one space. Read
 * with indexOf, one pass over the code: a pattern that searched for the end
 * of every opener would take time growing with the square of the file.
 */
function withoutBlockComments(code: string): string {
  const parts: Array<string> = [];
  let at: number = 0;
  let open: number = code.indexOf("/*");

  while (open >= 0) {
    const close: number = code.indexOf("*/", open + 2);

    if (close < 0) {
      break;
    }

    parts.push(code.slice(at, open));
    at = close + 2;
    open = code.indexOf("/*", at);
  }

  parts.push(code.slice(at));

  return parts.join(" ");
}

function readCode(...relativeParts: Array<string>): string {
  return withoutBlockComments(
    fs.readFileSync(path.join(STATUS_PAGE_SRC, ...relativeParts), "utf8"),
  )
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the app's entry", () => {
  const entry: string = readCode("Index.tsx");

  test("loads the dark theme's stylesheet, as the dashboards do", () => {
    expect(entry).toContain('import "Common/UI/Styles/Theme.css";');
  });

  test("keeps the page in the theme the first script drew, before it renders anything", () => {
    const initialize: number = entry.indexOf(
      "StatusPageThemeUtil.initialize();",
    );
    const render: number = entry.indexOf("ReactDOM.createRoot(");

    expect(initialize).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(initialize);
  });
});

describe("the master page", () => {
  const masterPage: string = readCode(
    "Components",
    "MasterPage",
    "MasterPage.tsx",
  );

  test("applies the page's own theme from its settings, read the way the servers read it", () => {
    expect(masterPage).toContain(
      "StatusPageThemeUtil.setPageTheme(parseStatusPageTheme(statusPage.theme));",
    );
    expect(masterPage).toContain(
      'import { parseStatusPageTheme } from "Common/Types/StatusPage/StatusPageTheme";',
    );
  });

  test("applies it as soon as the page is read, before the pages are drawn", () => {
    const read: number = masterPage.indexOf("setStatusPage(statusPage);");
    const applied: number = masterPage.indexOf(
      "StatusPageThemeUtil.setPageTheme(",
    );
    const loaded: number = masterPage.indexOf(
      "props.onLoadComplete(response.data);",
    );

    expect(read).toBeGreaterThan(-1);
    expect(applied).toBeGreaterThan(read);
    expect(loaded).toBeGreaterThan(applied);
  });
});

describe("the page's logo", () => {
  test("sits in a LogoPlate wherever the app draws it: the header and every page shown on its own", () => {
    const drawsLogo: Array<[string, string]> = [
      ["Components/Header/Header.tsx", "<LogoPlate"],
      ["Pages/Accounts/Login.tsx", "<LogoPlate"],
      ["Pages/Accounts/SSO.tsx", "<LogoPlate"],
      ["Pages/Accounts/ForgotPassword.tsx", "<LogoPlate"],
      ["Pages/Accounts/ResetPassword.tsx", "<LogoPlate"],
      ["Pages/Accounts/MasterPassword.tsx", "<LogoPlate"],
      ["Pages/Subscribe/Unsubscribe.tsx", "<LogoPlate"],
    ];

    for (const [file, plate] of drawsLogo) {
      const code: string = readCode(...file.split("/"));

      expect([file, code.includes(plate)]).toEqual([file, true]);
    }
  });

  test("no page draws the logo's image outside one", () => {
    const pagesWithLogo: Array<string> = [
      "Pages/Accounts/Login.tsx",
      "Pages/Accounts/SSO.tsx",
      "Pages/Accounts/ForgotPassword.tsx",
      "Pages/Accounts/ResetPassword.tsx",
      "Pages/Accounts/MasterPassword.tsx",
      "Pages/Subscribe/Unsubscribe.tsx",
    ];

    for (const file of pagesWithLogo) {
      const code: string = readCode(...file.split("/"));
      const image: number = code.indexOf("src={logoUrl}");
      const plate: number = code.lastIndexOf("<LogoPlate", image);
      const plateEnd: number = code.indexOf("</LogoPlate>", plate);

      expect([file, image > plate && plate > -1 && plateEnd > image]).toEqual([
        file,
        true,
      ]);
    }
  });
});

describe("the footer's switch", () => {
  const footer: string = readCode("Components", "Footer", "Footer.tsx");

  test("is offered only on a page that follows the visitor's device, beside the language switcher", () => {
    expect(footer).toContain("doesStatusPageThemeFollowDevice(theme) ?");
    expect(footer).toContain(
      "<LanguageSwitcher enabledLanguages={props.enabledLanguages || null} /> <ThemeSwitch />",
    );
  });

  test("is named in every language the status page speaks", () => {
    const english: Record<string, unknown> = readLocale("en");
    const englishTheme: Record<string, string> = english["theme"] as Record<
      string,
      string
    >;

    expect(englishTheme).toEqual({
      switchToDark: "Switch to dark theme",
      switchToLight: "Switch to light theme",
    });

    for (const language of LANGUAGES) {
      const theme: Record<string, string> = readLocale(language)[
        "theme"
      ] as Record<string, string>;

      for (const key of ["switchToDark", "switchToLight"]) {
        expect([language, key, typeof theme?.[key]]).toEqual([
          language,
          key,
          "string",
        ]);
        expect([language, key, theme[key] === englishTheme[key]]).toEqual([
          language,
          key,
          false,
        ]);
      }

      // Two different sentences: one is not the other with a word swapped back.
      expect(theme["switchToDark"]).not.toBe(theme["switchToLight"]);
    }
  });

  test("the switch reads its names from those keys", () => {
    const themeSwitch: string = readCode(
      "Components",
      "ThemeSwitch",
      "ThemeSwitch.tsx",
    );

    expect(themeSwitch).toContain('t("theme.switchToLight")');
    expect(themeSwitch).toContain('t("theme.switchToDark")');
  });
});
