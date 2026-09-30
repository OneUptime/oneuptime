import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Settings > Global SSO / Global OIDC (the provider lists and one provider's
 * page) and the instance-wide "Require SSO for Login" toggle on Settings >
 * Authentication are Community Edition screens: plain core pages that every
 * edition bundles and renders the same way.
 *
 * Common/Tests/App/AdminDashboard renders them. This suite pins what a render
 * cannot see, from the source, in the App job (which runs with ee/ deleted):
 *
 *  - the pages import only core - React, react-i18next, Common/... and files
 *    inside the Admin Dashboard's own src - never ee/, the plugin door or the
 *    license helpers, and read no edition flag or license state;
 *  - nothing turns creating or editing off (no isCreateable/isEditable
 *    expression), and there is no row action standing in for editing;
 *  - the Enterprise shells and their upsell cards are gone, and the plugin
 *    contract has no key that could replace the pages;
 *  - App.tsx, PageMap, RouteMap and the settings side menu still reach them
 *    at the unchanged /admin/settings/global-sso and /global-oidc paths;
 *  - the URLs the provider pages print - configured in customers' identity
 *    providers - are built by the same template literals as before.
 *
 * Comments are stripped before any assertion, so prose that names a
 * retired construct cannot satisfy or break a check.
 */

const APP_ROOT: string = nodePath.join(__dirname, "../..");

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  APP_ROOT,
  "FeatureSet/AdminDashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function adminPath(relativePath: string): string {
  return nodePath.join(ADMIN_DASHBOARD_SRC, relativePath);
}

function readAdminSource(relativePath: string): string {
  return stripComments(fs.readFileSync(adminPath(relativePath), "utf8"));
}

interface PageFile {
  name: string;
  path: string;
}

const GLOBAL_PROVIDER_PAGES: Array<PageFile> = [
  { name: "Global SSO list", path: "Pages/Settings/GlobalSSO/Index.tsx" },
  { name: "Global SSO provider", path: "Pages/Settings/GlobalSSO/View.tsx" },
  { name: "Global OIDC list", path: "Pages/Settings/GlobalOIDC/Index.tsx" },
  { name: "Global OIDC provider", path: "Pages/Settings/GlobalOIDC/View.tsx" },
];

const AUTHENTICATION_PAGE: PageFile = {
  name: "Settings > Authentication",
  path: "Pages/Settings/Authentication/Index.tsx",
};

const COMMUNITY_PAGES: Array<PageFile> = [
  ...GLOBAL_PROVIDER_PAGES,
  AUTHENTICATION_PAGE,
];

// Every module specifier a source file imports.
function importSpecifiers(source: string): Array<string> {
  const specifiers: Array<string> = [];
  const pattern: RegExp = /\bfrom\s+"([^"]+)"|\bimport\s+"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push((match[1] || match[2])!);
    match = pattern.exec(source);
  }

  return specifiers;
}

/*
 * The imports of a file at `filePath` that reach outside core: anything but
 * React, react-i18next, Common/... and relative paths that stay inside the
 * Admin Dashboard's src.
 */
function nonCoreImports(filePath: string, source: string): Array<string> {
  return importSpecifiers(source).filter((specifier: string) => {
    if (
      specifier === "react" ||
      specifier === "react-i18next" ||
      specifier.startsWith("Common/")
    ) {
      return false;
    }

    if (specifier.startsWith(".")) {
      const resolved: string = nodePath.resolve(
        nodePath.dirname(filePath),
        specifier,
      );

      return !resolved.startsWith(ADMIN_DASHBOARD_SRC + nodePath.sep);
    }

    return true;
  });
}

// What gated, masked or replaced these pages. None may come back.
const RETIRED_CONSTRUCTS: Array<string> = [
  "getAdminDashboardPlugins",
  "EnterprisePluginPage",
  "EnterpriseFeatureUpgrade",
  "IS_ENTERPRISE_EDITION",
  "BILLING_ENABLED",
  "EnterpriseLicensePeriods",
  "ENTERPRISE_LICENSE_",
  "global-config/license",
  "@oneuptime/ee",
  "@oneuptime/admin-dashboard/",
  "EnterpriseLicenseBanner",
  "EnterpriseLicenseMode",
  "useEnterpriseLicenseMode",
  "LicensedFeature",
  "isEnterpriseConfigurationReadOnly",
  "ReadOnlyActionsNotice",
  "useDisableProviderAction",
  "DisableProviderCard",
  "DISABLE_PROJECT_ATTACHMENT_CONFIRMATION",
  "isReadOnly",
  "isRequireSsoForLoginEnforceable",
  "Upsell",
];

function retiredConstructsIn(source: string): Array<string> {
  return RETIRED_CONSTRUCTS.filter((construct: string) => {
    return source.includes(construct);
  });
}

// The value of every `prop={...}` in a source, e.g. isCreateable={true} -> "true".
function propValues(source: string, prop: string): Array<string> {
  const values: Array<string> = [];
  const pattern: RegExp = new RegExp(`\\b${prop}=\\{([^}]*)\\}`, "g");

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    values.push(match[1]!.trim());
    match = pattern.exec(source);
  }

  return values;
}

describe("the Global SSO / OIDC pages and Require SSO are core pages", () => {
  test.each(COMMUNITY_PAGES)("$name imports only core", (page: PageFile) => {
    const source: string = readAdminSource(page.path);

    expect(importSpecifiers(source).length).toBeGreaterThan(5);
    expect(nonCoreImports(adminPath(page.path), source)).toEqual([]);
  });

  test.each(COMMUNITY_PAGES)(
    "$name has no edition, plugin, license or read-only construct",
    (page: PageFile) => {
      expect(retiredConstructsIn(readAdminSource(page.path))).toEqual([]);
    },
  );

  test.each(GLOBAL_PROVIDER_PAGES)(
    "$name: creating and editing are never switched off, and no row action stands in for them",
    (page: PageFile) => {
      const source: string = readAdminSource(page.path);

      expect(propValues(source, "isCreateable").length).toBeGreaterThan(0);

      for (const value of propValues(source, "isCreateable")) {
        expect(value).toBe("true");
      }

      for (const prop of ["isEditable", "isDeleteable", "isViewable"]) {
        for (const value of propValues(source, prop)) {
          expect({
            prop,
            value,
            literal: ["true", "false"].includes(value),
          }).toEqual({ prop, value, literal: true });
        }
      }

      expect(source).not.toContain("actionButtons=");
      expect(source).not.toContain("refreshToggle=");
      expect(source).not.toContain("refresher=");
      expect(source).not.toContain("onItemLoaded");
    },
  );

  test("the provider pages edit their configuration and attachments in place", () => {
    for (const path of [
      "Pages/Settings/GlobalSSO/View.tsx",
      "Pages/Settings/GlobalOIDC/View.tsx",
    ]) {
      const source: string = readAdminSource(path);

      // The configuration card, then the attached-projects table.
      expect(propValues(source, "isEditable")).toEqual(["true", "false"]);
      expect(propValues(source, "isCreateable")).toEqual(["true"]);
      expect(propValues(source, "isDeleteable")).toEqual(["true"]);
      expect(source).toContain("<ModelDelete");
    }

    for (const path of [
      "Pages/Settings/GlobalSSO/Index.tsx",
      "Pages/Settings/GlobalOIDC/Index.tsx",
    ]) {
      const source: string = readAdminSource(path);

      // Providers are opened (and edited) on their own page, as always.
      expect(propValues(source, "isCreateable")).toEqual(["true"]);
      expect(propValues(source, "isViewable")).toEqual(["true"]);
      expect(propValues(source, "isEditable")).toEqual(["false"]);
      expect(propValues(source, "isDeleteable")).toEqual(["false"]);
    }
  });

  test("the Enterprise shells' upsell cards are gone", () => {
    for (const upsell of [
      "Pages/Settings/GlobalSSO/GlobalSSOUpsell.tsx",
      "Pages/Settings/GlobalOIDC/GlobalOIDCUpsell.tsx",
    ]) {
      expect({ upsell, exists: fs.existsSync(adminPath(upsell)) }).toEqual({
        upsell,
        exists: false,
      });
    }

    expect(
      fs.readdirSync(adminPath("Pages/Settings/GlobalSSO")).sort(),
    ).toEqual(["Index.tsx", "View.tsx"]);
    expect(
      fs.readdirSync(adminPath("Pages/Settings/GlobalOIDC")).sort(),
    ).toEqual(["Index.tsx", "View.tsx"]);
  });

  test("the plugin contract has no key that could replace them", () => {
    const contract: string = readAdminSource("Enterprise/EnterprisePlugins.ts");

    expect(contract).not.toMatch(/\bGlobal(?:SSO|OIDC)(?:List|View)\b/);
    // The contract itself is still there, for Health, licenses and the license manager.
    expect(contract).toContain("HealthOverview?: EnterprisePluginComponent");
    expect(contract).toContain("LicenseManager: true,");
  });
});

describe("the pages stay reachable at their unchanged paths", () => {
  const appSource: string = readAdminSource("App.tsx");
  const routeMapSource: string = readAdminSource("Utils/RouteMap.ts");
  const pageMapSource: string = readAdminSource("Utils/PageMap.ts");
  const sideMenuSource: string = readAdminSource("Pages/Settings/SideMenu.tsx");

  test.each([
    [
      "SettingsGlobalSSO",
      "./Pages/Settings/GlobalSSO/Index",
      "SETTINGS_GLOBAL_SSO",
    ],
    [
      "SettingsGlobalSSOView",
      "./Pages/Settings/GlobalSSO/View",
      "SETTINGS_GLOBAL_SSO_VIEW",
    ],
    [
      "SettingsGlobalOIDC",
      "./Pages/Settings/GlobalOIDC/Index",
      "SETTINGS_GLOBAL_OIDC",
    ],
    [
      "SettingsGlobalOIDCView",
      "./Pages/Settings/GlobalOIDC/View",
      "SETTINGS_GLOBAL_OIDC_VIEW",
    ],
  ])(
    "App.tsx imports %s from %s and routes PageMap.%s to it",
    (component: string, modulePath: string, pageKey: string) => {
      expect(appSource).toContain(`import ${component} from "${modulePath}";`);
      expect(appSource).toMatch(
        new RegExp(
          `path=\\{RouteMap\\[PageMap\\.${pageKey}\\]\\?\\.toString\\(\\) \\|\\| ""\\}\\s*element=\\{<${component} />\\}`,
        ),
      );
      expect(pageMapSource).toContain(`${pageKey} = "${pageKey}",`);
    },
  );

  test("RouteMap keeps the four /admin/settings paths", () => {
    expect(routeMapSource).toContain(
      "[PageMap.SETTINGS_GLOBAL_SSO]: new Route(`/admin/settings/global-sso`)",
    );
    expect(routeMapSource).toMatch(
      /\[PageMap\.SETTINGS_GLOBAL_SSO_VIEW\]: new Route\(\s*`\/admin\/settings\/global-sso\/\$\{RouteParams\.ModelID\}`/,
    );
    expect(routeMapSource).toContain(
      "[PageMap.SETTINGS_GLOBAL_OIDC]: new Route(`/admin/settings/global-oidc`)",
    );
    expect(routeMapSource).toMatch(
      /\[PageMap\.SETTINGS_GLOBAL_OIDC_VIEW\]: new Route\(\s*`\/admin\/settings\/global-oidc\/\$\{RouteParams\.ModelID\}`/,
    );
  });

  test("the settings side menu links both lists", () => {
    expect(sideMenuSource).toMatch(
      /title: "Global SSO",\s*to: RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.SETTINGS_GLOBAL_SSO\] as Route,/,
    );
    expect(sideMenuSource).toMatch(
      /title: "Global OIDC",\s*to: RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.SETTINGS_GLOBAL_OIDC\] as Route,/,
    );
  });

  test("Settings > Authentication renders the Require SSO toggle unconditionally", () => {
    const source: string = readAdminSource(AUTHENTICATION_PAGE.path);

    // The card sits directly in the page, not behind a condition.
    expect(source).toMatch(/\/>\s*<CardModelDetail\s+name="SSO Settings"/);
    expect(source).toContain("requireSsoForLogin: true,");
    expect(source).toContain('id: "model-detail-sso-settings"');
    expect(source).not.toContain('from "Common/UI/Components/Card/Card"');
  });
});

describe("the URLs the provider pages print", () => {
  test("Global SSO: the ACS URL and the test link under /identity, the Issuer without it", () => {
    const source: string = readAdminSource("Pages/Settings/GlobalSSO/View.tsx");

    expect(source).toContain(
      "const acsURL: string = `${HTTP_PROTOCOL}${HOST}/identity/global-idp-login/${modelId.toString()}`;",
    );
    expect(source).toContain(
      "const issuerURL: string = `${HTTP_PROTOCOL}${HOST}/global-sso/${modelId.toString()}`;",
    );
    expect(source).toMatch(
      /const testLoginURL: URL = URL\.fromURL\(IDENTITY_URL\)\.addRoute\(\s*new Route\(`\/global-sso\/\$\{modelId\.toString\(\)\}`\),\s*\);/,
    );
  });

  test("Global OIDC: the redirect URI and the test link under /identity", () => {
    const source: string = readAdminSource(
      "Pages/Settings/GlobalOIDC/View.tsx",
    );

    expect(source).toContain(
      "const redirectURI: string = `${HTTP_PROTOCOL}${HOST}/identity/global-oidc-callback/${modelId.toString()}`;",
    );
    expect(source).toMatch(
      /const testLoginURL: URL = URL\.fromURL\(IDENTITY_URL\)\.addRoute\(\s*new Route\(`\/global-oidc\/\$\{modelId\.toString\(\)\}`\),\s*\);/,
    );
  });
});

/*
 * The checks above only prove something if they fail on the code this change
 * replaced: the ee pages (license banner, read-only mode, Disable action),
 * the Enterprise shells and the Community card in place of the toggle.
 */
describe("the checks catch the retired pages (negative controls)", () => {
  const eePage: string = `import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import EnterpriseLicenseBanner from "../../../../Dashboard/SSO/License/EnterpriseLicenseBanner";
import useDisableProviderAction from "../../../../Dashboard/SSO/TightenOnly/UseDisableProviderAction";
const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);
<ModelTable isCreateable={!isReadOnly} actionButtons={[disableAction.actionButton]} />`;

  const shell: string = `import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../../Enterprise/Plugins";
import GlobalSSOUpsell from "./GlobalSSOUpsell";`;

  const communityCard: string = `import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
{isRequireSsoForLoginEnforceable() ? <CardModelDetail name="SSO Settings" /> : <Card />}`;

  test("an import from ee/ or through the ee specifier is caught", () => {
    expect(
      nonCoreImports(adminPath("Pages/Settings/GlobalSSO/Index.tsx"), eePage),
    ).toEqual([
      "@oneuptime/admin-dashboard/Utils/ModelAPI",
      "../../../../Dashboard/SSO/License/EnterpriseLicenseBanner",
      "../../../../Dashboard/SSO/TightenOnly/UseDisableProviderAction",
    ]);
    // ...while the Admin Dashboard's own files pass.
    expect(
      nonCoreImports(
        adminPath("Pages/Settings/GlobalSSO/Index.tsx"),
        `import AdminModelAPI from "../../../Utils/ModelAPI";
import DashboardSideMenu from "../SideMenu";`,
      ),
    ).toEqual([]);
  });

  test("the license, read-only and shell constructs are caught", () => {
    expect(retiredConstructsIn(eePage)).toEqual(
      expect.arrayContaining([
        "@oneuptime/admin-dashboard/",
        "EnterpriseLicenseBanner",
        "isEnterpriseConfigurationReadOnly",
        "useDisableProviderAction",
        "isReadOnly",
      ]),
    );
    expect(retiredConstructsIn(shell)).toEqual(
      expect.arrayContaining([
        "getAdminDashboardPlugins",
        "EnterprisePluginPage",
        "Upsell",
      ]),
    );
    expect(retiredConstructsIn(communityCard)).toEqual(
      expect.arrayContaining([
        "IS_ENTERPRISE_EDITION",
        "BILLING_ENABLED",
        "isRequireSsoForLoginEnforceable",
      ]),
    );
  });

  test("an isCreateable that follows the license is caught", () => {
    expect(propValues(eePage, "isCreateable")).toEqual(["!isReadOnly"]);
    expect(eePage).toContain("actionButtons=");
  });
});
