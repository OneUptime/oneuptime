import DashboardSharingCopy, {
  DASHBOARD_ACCESS_CHOICE_COPY,
  DASHBOARD_ACCESS_CONFIRMATION_COPY,
  REMOVE_PASSWORD_CONFIRMATION_COPY,
  SHARE_WITH_PASSWORD_CONFIRMATION_COPY,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import IpAllowlistCopy from "../../FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistCopy";
import {
  DASHBOARD_ACCESS_CHOICES,
  DashboardAccess,
} from "Common/Types/Dashboard/DashboardAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who can view a dashboard is one choice, on its Sharing page: only people
 * in this project, anyone with the link, or anyone with the link and a
 * password (Components/Dashboard/Sharing/DashboardSharingCard). The page is
 * in the dashboard's Basic menu section and on its own ⋯ menu (Share).
 *
 * It was "Authentication", folded away under Advanced, with three cards
 * for one question: "Is Visible to Public" behind an Edit button, "Require
 * Master Password" behind a second one with the password behind a third
 * button, and the IP whitelist - plus a fourth card for the public link.
 * Switching the password on before setting one locked every visitor out.
 *
 * This holds the pages to the new shape as source text, so a page written
 * later cannot quietly bring a switch, a second place or the old words
 * back. The behaviour is tested in Common/Tests (DashboardAccess,
 * DashboardSharingCard, DashboardSharingPage, DashboardSharingEntryPoints,
 * and at the server DashboardAccessChoice, DashboardSharingPublicRoutes,
 * PublicDashboardAccess and PublicDashboardLinkAnswers).
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const PUBLIC_DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "PublicDashboard",
  "src",
);
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function dashboardFile(...parts: Array<string>): string {
  return path.join(DASHBOARD_SRC, ...parts);
}

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

function sourceFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      files.push(...sourceFilesUnder(entryPath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const VIEW_DIR: string = dashboardFile("Pages", "Dashboards", "View");
const SHARING_PAGE: string = path.join(VIEW_DIR, "Sharing.tsx");
const SHARING_DIR: string = dashboardFile("Components", "Dashboard", "Sharing");

describe("the Sharing page", () => {
  const page: string = readSource(SHARING_PAGE);

  test("opens on the one choice, then folds the IP allowlist under Advanced", () => {
    expect(page).toContain(
      "<DashboardSharingCard dashboardId={modelId} /> <AdvancedPageSection",
    );
    expect(page.split("<CardModelDetail").length - 1).toBe(1);
    expect(page.indexOf("<AdvancedPageSection")).toBeLessThan(
      page.indexOf("<CardModelDetail"),
    );
    expect(page.indexOf("</AdvancedPageSection>")).toBeGreaterThan(
      page.indexOf("<CardModelDetail"),
    );
    expect(page).toContain('name="Dashboard > IP Allowlist"');
  });

  test("has no switch, no password button, no column of the choice and none of the old words", () => {
    for (const gone of [
      "FormFieldSchemaType.Toggle",
      "ModelFormModal",
      "isPublicDashboard",
      "enableMasterPassword",
      "masterPassword",
      "DashboardPreviewLink",
      "Is Visible to Public",
      "Require Master Password",
      "Set Master Password",
      "Update Master Password",
      "Master Password",
      "IP Whitelist",
      "Authentication Settings",
      "Dashboard Preview URL",
    ]) {
      expect([gone, page.includes(gone)]).toEqual([gone, false]);
    }
  });

  test("the IP allowlist refuses lines the server cannot read, by the rules the status page shares", () => {
    expect(page).toContain("customValidation:");
    expect(page).toContain("getIpAllowlistProblem(");
    expect(page).toContain(
      'from "../../../Components/IpAllowlist/IpAllowlistCopy"',
    );
  });

  test("the old page and the preview link card are gone", () => {
    expect(
      fs.existsSync(path.join(VIEW_DIR, "AuthenticationSettings.tsx")),
    ).toBe(false);
    expect(fs.existsSync(path.join(VIEW_DIR, "DashboardPreviewLink.tsx"))).toBe(
      false,
    );
  });

  test("the route serves it at the old address", () => {
    const routes: string = readSource(
      dashboardFile("Routes", "DashboardRoutes.tsx"),
    );

    expect(routes).toContain(
      'import DashboardViewSharing from "../Pages/Dashboards/View/Sharing";',
    );
    expect(routes).toMatch(
      /path=\{RouteUtil\.getLastPathForKey\( PageMap\.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS, \)\} element=\{ <DashboardViewSharing/,
    );
    expect(routes).not.toContain("AuthenticationSettings");

    const routeMap: string = readSource(dashboardFile("Utils", "RouteMap.ts"));

    expect(routeMap).toContain(
      "[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS]: `${RouteParams.ModelID}/authentication-settings`",
    );
  });
});

describe("one place for the choice", () => {
  /*
   * A dashboard column a choice writes, named in the dashboard app as a
   * column - a key set to a value, or a property read. (The widgets'
   * isPublicDashboard() asks whether they are drawn on the public viewer,
   * which is something else.)
   */
  const NAMES_THE_COLUMN: RegExp =
    /isPublicDashboard: (true|false)|\.isPublicDashboard\b/;

  const files: Array<string> = sourceFilesUnder(DASHBOARD_SRC);

  test("the walk really reads the dashboard", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("only the Sharing card's own files name isPublicDashboard", () => {
    const naming: Array<string> = files
      .filter((file: string): boolean => {
        return NAMES_THE_COLUMN.test(readSource(file));
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
      });

    expect(naming).toEqual([
      "Components/Dashboard/Sharing/DashboardSharingCopy.ts",
    ]);
  });

  test("the card writes the changes the Common rule works out, never a column of its own", () => {
    const card: string = readSource(
      path.join(SHARING_DIR, "DashboardSharingCard.tsx"),
    );

    expect(card).toContain(
      "getDashboardAccessChanges({ from: state, to: data.to })",
    );
    expect(card).toContain("getDashboardAccess(state)");
    expect(card).toContain("isDashboardLockedWithoutPassword(state)");
    expect(card).toContain("<ChoiceRows<DashboardAccess>");
    expect(card).not.toContain("isPublicDashboard: true");
    expect(card).not.toContain("isPublicDashboard: false");
    expect(card).not.toContain("enableMasterPassword: true");
    expect(card).not.toContain("enableMasterPassword: false");
  });

  test("the server asks for the password by the same rule, in the read check, the password route and the metadata answer", () => {
    /*
     * The public link's one decision (who a visitor is to it), which every
     * public dashboard route makes before it reads what it sends.
     */
    const policy: string = readSource(
      path.join(
        COMMON_ROOT,
        "Server",
        "Utils",
        "Dashboard",
        "PublicDashboardAccess.ts",
      ),
    );
    const service: string = readSource(
      path.join(COMMON_ROOT, "Server", "Services", "DashboardService.ts"),
    );
    const api: string = readSource(
      path.join(COMMON_ROOT, "Server", "API", "DashboardAPI.ts"),
    );

    expect(policy).toContain("isDashboardMasterPasswordRequired(accessState)");
    expect(policy).toContain("isDashboardLockedWithoutPassword(accessState)");
    expect(policy).toContain("!isDashboardPublic(accessState)");
    expect(policy).not.toContain("dashboard.isPublicDashboard &&");

    // The read check is that decision, never a flag of its own.
    expect(service).toContain("PublicDashboardAccessPolicy.decide({");
    expect(service).not.toContain("dashboard.isPublicDashboard &&");
    expect(service).not.toContain("isDashboardPublic(");

    // The metadata answer says what the decision worked out...
    expect(api).toContain(
      "enableMasterPassword: access.isMasterPasswordRequired",
    );
    // ...and the password route asks the decision first, then the rule.
    expect(api).toContain("PublicDashboardAccessPolicy.decide({ dashboard,");
    expect(api).toContain(
      "!isDashboardMasterPasswordRequired(accessState) || isDashboardLockedWithoutPassword(accessState)",
    );
    expect(api).not.toContain("isDashboardPublic(");
  });

  test("so does the public dashboard app's first load", () => {
    const app: string = readSource(path.join(PUBLIC_DASHBOARD_SRC, "App.tsx"));

    expect(app).toContain(
      "PublicDashboardUtil.setRequiresMasterPassword( isDashboardMasterPasswordRequired({",
    );
    expect(app).not.toContain("isPublic && enableMasterPassword");
  });
});

describe("the dashboard's menu, breadcrumbs and ⋯ menu", () => {
  test("Basic holds Sharing, at the old address; Advanced holds no Authentication", () => {
    const menu: string = readSource(path.join(VIEW_DIR, "SideMenu.tsx"));

    const basic: string = menu.slice(
      menu.indexOf('<SideMenuSection title="Basic">'),
      menu.indexOf('<SideMenuSection title="Owners">'),
    );

    const titles: Array<string> = Array.from(
      basic.matchAll(/title: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual(["Dashboard", "Overview", "Sharing"]);
    expect(basic).toMatch(
      /title: "Sharing", to: RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS\] as Route, \{ modelId: props\.modelId \}, \), \}\} icon=\{IconProp\.Share\}/,
    );
    expect(menu).not.toContain('title: "Authentication"');
    expect(
      menu.split("PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS").length - 1,
    ).toBe(1);
  });

  test("the breadcrumbs say Sharing", () => {
    const breadcrumbs: string = readSource(
      dashboardFile("Utils", "Breadcrumbs", "DashboardBreadCrumbs.ts"),
    );

    expect(breadcrumbs).toContain(
      'PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS, ["Project", "Dashboards", "View Dashboard", "Sharing"],',
    );
  });

  test("the dashboard's ⋯ menu has Share, which its page points at Sharing", () => {
    const toolbar: string = readSource(
      dashboardFile(
        "Components",
        "Dashboard",
        "Toolbar",
        "DashboardToolbar.tsx",
      ),
    );

    expect(toolbar).toContain(
      '<MoreMenuItem text={"Share"} icon={IconProp.Share} key={"share"} onClick={props.onShareClick} />',
    );

    const view: string = readSource(
      dashboardFile("Components", "Dashboard", "DashboardView.tsx"),
    );

    expect(view).toContain("onShareClick={props.onShareClick}");

    const index: string = readSource(path.join(VIEW_DIR, "Index.tsx"));

    expect(index).toContain(
      "onShareClick={() => { Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route, { modelId }, ), ); }}",
    );
  });
});

describe("translations", () => {
  const strings: Array<string> = [
    // The page's name in the menu and breadcrumbs, and the ⋯ menu's item.
    "Sharing",
    "Share",
    ...Object.values(DashboardSharingCopy),
    ...DASHBOARD_ACCESS_CHOICES.flatMap(
      (access: DashboardAccess): Array<string> => {
        return [
          DASHBOARD_ACCESS_CHOICE_COPY[access].title,
          DASHBOARD_ACCESS_CHOICE_COPY[access].description,
          DASHBOARD_ACCESS_CONFIRMATION_COPY[access].title,
          DASHBOARD_ACCESS_CONFIRMATION_COPY[access].description,
          DASHBOARD_ACCESS_CONFIRMATION_COPY[access].submitButtonText,
        ];
      },
    ),
    ...Object.values(SHARE_WITH_PASSWORD_CONFIRMATION_COPY),
    ...Object.values(REMOVE_PASSWORD_CONFIRMATION_COPY),
    ...Object.values(IpAllowlistCopy),
  ];

  const english: Record<string, unknown> = readLocale("en");

  // Words some languages write as English does ("Password" in Italian).
  const SAME_AS_ENGLISH_SOMEWHERE: Array<string> = [
    DashboardSharingCopy.passwordFieldTitle,
  ];

  test("the strings are all there to check", () => {
    expect(strings.length).toBeGreaterThan(40);
  });

  test("en.json has every string, as itself", () => {
    for (const text of strings) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test("the dashboard's button is its own words: 'Make Public' agrees with a page in French, Spanish and Portuguese", () => {
    expect(
      DASHBOARD_ACCESS_CONFIRMATION_COPY[DashboardAccess.AnyoneWithLink]
        .submitButtonText,
    ).toBe("Share Publicly");
  });

  test.each(OTHER_LOCALES)("%s translates every one", (locale: string) => {
    const entries: Record<string, unknown> = readLocale(locale);

    for (const text of strings) {
      const value: unknown = entries[text];

      expect([text, typeof value]).toEqual([text, "string"]);

      if (!SAME_AS_ENGLISH_SOMEWHERE.includes(text)) {
        expect([text, value === english[text]]).toEqual([text, false]);
      }

      // Placeholders, OneUptime and IP keep their names.
      for (const kept of ["{{entry}}", "OneUptime", "IP"]) {
        if (text.includes(kept)) {
          expect([text, (value as string).includes(kept)]).toEqual([
            text,
            true,
          ]);
        }
      }
    }
  });
});
