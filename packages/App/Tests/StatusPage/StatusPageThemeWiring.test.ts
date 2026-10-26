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
  // The pages shown on their own, without the page's header.
  const PAGES_WITH_LOGO: Array<string> = [
    "Pages/Accounts/Login.tsx",
    "Pages/Accounts/SSO.tsx",
    "Pages/Accounts/ForgotPassword.tsx",
    "Pages/Accounts/ResetPassword.tsx",
    "Pages/Accounts/MasterPassword.tsx",
    "Pages/Subscribe/Unsubscribe.tsx",
  ];

  const theme: string = readCode("Utils", "StatusPageTheme.ts");
  const plate: string = readCode("Components", "Logo", "LogoPlate.tsx");
  const pageLogo: string = readCode("Components", "Logo", "PageLogo.tsx");

  test("is plated on every page a visitor can see dark: Dark, one that follows the device, and any in the Dashboard's preview", () => {
    expect(plate).toContain("StatusPageThemeUtil.canBeDarkForVisitor(theme)");
    expect(plate).not.toContain("doesStatusPageThemeFollowDevice");
    expect(theme).toContain(
      "return canStatusPageThemeBeDark(theme) || StatusPageThemeUtil.isPreview();",
    );
    expect(theme).toContain("return StatusPageUtil.isPreviewPage();");
  });

  test("gives way to the logo made for the dark theme while the page is dark, with no backdrop", () => {
    const dark: number = plate.indexOf(
      "if (colorScheme === STATUS_PAGE_DARK_SCHEME && props.darkLogo) {",
    );
    const plated: number = plate.indexOf("[LOGO_PLATE_ATTRIBUTE]");

    expect(dark).toBeGreaterThan(-1);
    // Returned before the backdrop is considered.
    expect(plated).toBeGreaterThan(dark);
    expect(plate.slice(dark, plated)).toContain("{props.darkLogo} </div> );");
  });

  test("sits in a LogoPlate wherever the app draws it: the header and every page shown on its own", () => {
    const header: string = readCode("Components", "Header", "Header.tsx");

    expect(header).toContain("<LogoPlate");
    expect(header).toContain("darkLogo={ props.darkLogo ? (");
    expect(pageLogo).toContain("<LogoPlate");

    for (const file of PAGES_WITH_LOGO) {
      const code: string = readCode(...file.split("/"));

      expect([file, code.includes("<PageLogo")]).toEqual([file, true]);
      // Both of the page's logos: each page hands over the two ids.
      expect([
        file,
        code.includes("darkThemeLogoFileId={props.darkThemeLogoFileId}"),
      ]).toEqual([file, true]);
    }
  });

  test("no page draws the logo's image outside one", () => {
    for (const file of PAGES_WITH_LOGO) {
      const code: string = readCode(...file.split("/"));

      // The pages draw no image of their own: PageLogo does.
      expect([file, code.includes("<img")]).toEqual([file, false]);
    }

    const plateStart: number = pageLogo.indexOf("<LogoPlate");
    const plateEnd: number = pageLogo.indexOf("</LogoPlate>");
    const images: Array<number> = [];
    let at: number = pageLogo.indexOf("<img");

    while (at >= 0) {
      images.push(at);
      at = pageLogo.indexOf("<img", at + 1);
    }

    // The logo, and the one for the dark theme.
    expect(images).toHaveLength(2);

    for (const image of images) {
      expect(image > plateStart && plateStart > -1 && plateEnd > image).toBe(
        true,
      );
    }

    expect(pageLogo).toContain('route: "dark-theme-logo"');
    expect(pageLogo).toContain('route: "logo"');
  });

  test("is read with the page: the master page hands the header both logos, and the app every page both ids", () => {
    const masterPage: string = readCode(
      "Components",
      "MasterPage",
      "MasterPage.tsx",
    );
    const app: string = readCode("App.tsx");

    expect(masterPage).toContain('"statusPage.darkThemeLogoFile"');
    expect(masterPage).toContain("logo={logo} darkLogo={darkLogo}");

    const count: (code: string, text: string) => number = (
      code: string,
      text: string,
    ): number => {
      return code.split(text).length - 1;
    };

    const logos: number = count(
      app,
      "logoFileId={new ObjectID(statusPageLogoFileId)}",
    );

    expect(logos).toBeGreaterThan(5);
    expect(
      count(
        app,
        "darkThemeLogoFileId={new ObjectID(statusPageDarkThemeLogoFileId)}",
      ),
    ).toBe(logos);
  });
});

describe("the footer's switch", () => {
  const footer: string = readCode("Components", "Footer", "Footer.tsx");

  test("sits beside the language switcher in one footer entry, and is drawn only on a page that follows the visitor's device, or in the Dashboard's preview", () => {
    // One entry on every page, centred on a phone like the footer's others.
    expect(footer).toContain("className={FOOTER_VISITOR_CONTROLS_CLASS_NAME}");
    expect(footer).toContain(
      "<LanguageSwitcher enabledLanguages={props.enabledLanguages || null} /> <ThemeSwitch />",
    );

    // The switch decides for itself: nothing at all on a Light or Dark page.
    const themeSwitch: string = readCode(
      "Components",
      "ThemeSwitch",
      "ThemeSwitch.tsx",
    );

    expect(themeSwitch).toContain(
      "if (!StatusPageThemeUtil.canVisitorSwitch(theme)) { return <></>; }",
    );

    const theme: string = readCode("Utils", "StatusPageTheme.ts");

    expect(theme).toContain(
      "return ( doesStatusPageThemeFollowDevice(theme) || StatusPageThemeUtil.isPreview() );",
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
