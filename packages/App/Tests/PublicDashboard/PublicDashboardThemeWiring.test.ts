/**
 * The wiring of a public dashboard's theme through the public dashboard app,
 * and of its Theme card on the dashboard's Branding page.
 *
 * Every piece is tested on its own: the theme module, the template before
 * and after its first script, the servers that render it, the client util,
 * the theme menu, the app's reading of the metadata and the card. What is
 * left is the app handing one piece to the next - and a break there leaves
 * no trace: the page loads, light, and nothing fails. So the app's entry,
 * its pages and the Branding page are read, the way the status page's
 * StatusPageThemeWiring.test.ts reads its app.
 *
 * Sources are stripped of comments and whitespace-squashed first, so a
 * comment cannot pass a test on its own, and prettier re-wrapping a line
 * cannot fail one.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

const PUBLIC_DASHBOARD_SRC: string = path.join(
  FEATURE_SET,
  "PublicDashboard",
  "src",
);

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

function squash(code: string): string {
  return withoutBlockComments(code)
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
}

function readCode(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(PUBLIC_DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

// Every .ts and .tsx file of the app the visitor's browser runs.
function clientFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      // The page servers' own code, which runs in Node.
      if (entry.name !== "Server") {
        files.push(...clientFiles(entryPath));
      }
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("the app's entry", () => {
  const entry: string = readCode("Index.tsx");

  test("loads the dark theme's stylesheet, as the dashboards and status pages do", () => {
    expect(entry).toContain('import "Common/UI/Styles/Theme.css";');
  });

  test("keeps the page in the theme the first script drew, before it renders anything", () => {
    const initialize: number = entry.indexOf(
      "DashboardThemeUtil.initialize();",
    );
    const render: number = entry.indexOf("ReactDOM.createRoot(");

    expect(initialize).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(initialize);
  });
});

describe("the app", () => {
  const app: string = readCode("App.tsx");

  test("draws the dashboard's own theme from its metadata, read the way the servers read it", () => {
    expect(app).toContain(
      "DashboardThemeUtil.setDashboardTheme( parseDashboardTheme(response.data[DASHBOARD_THEME_COLUMN]), );",
    );
  });

  test("draws it before it names the page, so the dashboard and its password prompt open in it", () => {
    const drawn: number = app.indexOf(
      "parseDashboardTheme(response.data[DASHBOARD_THEME_COLUMN])",
    );

    expect(drawn).toBeGreaterThan(-1);
    expect(app.indexOf("setDashboardName(name);")).toBeGreaterThan(drawn);
    expect(
      app.indexOf("PublicDashboardUtil.navigateToMasterPasswordPage()"),
    ).toBeGreaterThan(drawn);
  });

  test("follows the visitor on the pages that show no dashboard: Access Denied, not found, and no dashboard on the domain", () => {
    expect(
      app.split(
        "DashboardThemeUtil.setDashboardTheme(UNKNOWN_DASHBOARD_THEME);",
      ).length - 1,
    ).toBe(2);
    expect(app).toContain(
      "if (response.statusCode === 403 || response.statusCode === 404) { DashboardThemeUtil.setDashboardTheme(UNKNOWN_DASHBOARD_THEME); }",
    );
  });
});

describe("the dashboard's page", () => {
  const view: string = readCode(
    "Pages",
    "DashboardView",
    "DashboardViewPage.tsx",
  );

  test("offers the visitor's theme menu in the toolbar, between auto-refresh and Full Screen", () => {
    const refresh: number = view.indexOf("menuIcon={IconProp.Refresh}");
    const menu: number = view.indexOf("<ThemeMenu />");
    const fullScreen: number = view.indexOf('tooltip="Full Screen"');

    expect(view).toContain(
      'import ThemeMenu from "../../Components/ThemeMenu";',
    );
    expect(refresh).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(refresh);
    expect(fullScreen).toBeGreaterThan(menu);
  });

  /*
   * The logo on its plate, the light backdrop it has while the page is dark
   * - or, while it is dark, the dashboard's logo for the dark theme in its
   * place (LogoPlate's darkLogo), as a status page's header does.
   */
  test("puts the logo on its plate, and hands it the dark theme logo to draw instead while the page is dark", () => {
    expect(view).toContain(
      '<LogoPlate className="flex-shrink-0" darkLogo={ darkThemeLogoUrl ? ( <img src={darkThemeLogoUrl} alt={dashboardName} className="h-8 w-auto object-contain" /> ) : undefined } > {logoUrl ? ( <img src={logoUrl} alt={dashboardName} className="h-8 w-auto object-contain" /> ) : undefined} </LogoPlate>',
    );
    // Drawn when the dashboard has either logo.
    expect(view).toContain("{(logoUrl || darkThemeLogoUrl) && (");
    expect(view.split("<img").length - 1).toBe(2);
  });

  test("draws the page and the canvas on the dashboard's own grounds, which the dark theme remaps", () => {
    expect(view).toContain(
      'background: "var(--ou-background-primary, #f8f9fb)"',
    );
    expect(view).toContain(
      'style={{ background: "var(--ou-surface-primary, #ffffff)" }}',
    );
  });
});

describe("the pages that show no dashboard", () => {
  test.each([
    ["not found", ["Pages", "NotFound", "NotFound.tsx"]],
    ["Access Denied", ["Pages", "Forbidden", "Forbidden.tsx"]],
  ])(
    "%s is drawn on the page's own ground, with its code in a colour the dark theme remaps",
    (_page: string, parts: Array<string>) => {
      const page: string = readCode(...parts);

      expect(page).not.toMatch(/\bbg-(white|gray-50)\b/);
      expect(page).toContain("style={{ color: ERROR_CODE_COLOR }}");
      expect(page).not.toContain("text-gray-300");
    },
  );

  test("the code's colour is a theme colour: the light page's grey, a dark slate on the dark one", () => {
    expect(readCode("Pages", "NotFound", "NotFound.tsx")).toContain(
      'export const ERROR_CODE_COLOR: string = "var(--ou-border-strong, #d1d5db)";',
    );
  });
});

describe("every colour the app writes itself", () => {
  /*
   * The dark theme remaps Tailwind's classes (Common/UI/Styles/Theme.css),
   * never a colour written in a style: one of those stays light on the dark
   * page. So a colour the app writes is a theme colour - a var(--ou-...)
   * with the light page's colour as its fallback.
   */
  const COLOR: RegExp = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

  /*
   * A whole string that is one var(--ou-...) and its fallback - which may
   * hold one bracketed colour of its own, as a shadow's rgba(...) does.
   * Each part ends where the next begins, so a long string is read once.
   */
  const THEME_COLOUR: RegExp =
    /^["'`]var\(--ou-[a-z0-9-]+, [^()]*(?:\([^()]*\)[^()]*)?\)["'`]$/;

  test("is the fallback of a theme colour, in every file of the app", () => {
    const loose: Array<string> = [];
    let colours: number = 0;

    for (const file of clientFiles(PUBLIC_DASHBOARD_SRC)) {
      const code: string = squash(fs.readFileSync(file, "utf8"));
      const strings: Array<string> =
        code.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) || [];

      for (const literal of strings) {
        if (!COLOR.test(literal)) {
          continue;
        }

        colours += 1;

        if (!THEME_COLOUR.test(literal)) {
          loose.push(
            `${path.relative(PUBLIC_DASHBOARD_SRC, file)}: ${literal}`,
          );
        }
      }
    }

    expect(loose).toEqual([]);
    // The page, its header's shadow, the canvas and the error pages' code.
    expect(colours).toBeGreaterThanOrEqual(4);
  });
});

describe("the dashboard's Branding page", () => {
  const branding: string = squash(
    fs.readFileSync(
      path.join(
        FEATURE_SET,
        "Dashboard",
        "src",
        "Pages",
        "Dashboards",
        "View",
        "Branding.tsx",
      ),
      "utf8",
    ),
  );

  test("holds the Theme card right under the logo, before the favicon, as a status page's Branding page does", () => {
    const logo: number = branding.indexOf('name="Dashboard > Branding > Logo"');
    const theme: number = branding.indexOf(
      "<DashboardThemeCard dashboardId={modelId} />",
    );
    const favicon: number = branding.indexOf(
      'name="Dashboard > Branding > Favicon"',
    );

    expect(logo).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(logo);
    expect(favicon).toBeGreaterThan(theme);
    expect(branding.split("<DashboardThemeCard").length - 1).toBe(1);
  });
});
