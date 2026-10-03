import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Settings > SSO / OIDC and Status page > SSO / OIDC are core pages in every
 * edition: single sign-on needs no Enterprise build, no license and no
 * Enterprise plugin. On OneUptime Cloud they are plan-gated (Scale), through
 * PlanGatedPage and isPlanFeatureEligible, which ask the plan only.
 *
 * The pages' rendered behaviour is covered against a real DOM in
 * Common/Tests/App/Dashboard/SsoPages.test.tsx and PlanGatedPage.test.tsx.
 * What is left is the wiring, asserted here as source text because the App
 * suite runs in plain Node (and in CI with ee/ deleted): none of the four
 * pages may reach the Enterprise plugin door, the ee license helpers or the
 * edition flag, and the URLs they print for identity providers must stay
 * byte for byte what customers configured.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped first: the files explain this behaviour in prose
 * that may name the very identifiers being matched.
 */
const stripComments: (raw: string) => string = (raw: string): string => {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
};

const readCode: (...relativeParts: Array<string>) => string = (
  ...relativeParts: Array<string>
): string => {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
};

interface SsoPage {
  name: string;
  file: Array<string>;
  // Template literals the page prints for the identity provider, verbatim.
  printedUrls: Array<string>;
  /*
   * How the page asks whether everyone must sign in with SSO: the project's
   * "Require SSO for Login" switch, which saves on flip and asks first
   * (Components/Project/RequireSsoForLoginCard), the status page's "Force
   * SSO for Login" card with its Edit dialog, or not at all (OIDC pages).
   */
  requireSso: "switch" | "card" | null;
}

const SSO_PAGES: Array<SsoPage> = [
  {
    name: "Settings > SSO",
    file: ["Pages", "Settings", "SSO.tsx"],
    printedUrls: [
      "`${HTTP_PROTOCOL}${HOST}/${props.currentProject?._id}/${showSingleSignOnUrlId}`",
      "`/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`",
      "`${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/sso`",
    ],
    requireSso: "switch",
  },
  {
    name: "Settings > OIDC",
    file: ["Pages", "Settings", "OIDC.tsx"],
    printedUrls: [
      "`/oidc-callback/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`",
      "`${HTTP_PROTOCOL}${HOST}/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`",
      "`${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/oidc`",
    ],
    requireSso: null,
  },
  {
    name: "Status page > SSO",
    file: ["Pages", "StatusPages", "View", "SSO.tsx"],
    printedUrls: [
      "`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showSingleSignOnUrlId}`",
      "`/status-page-idp-login/${modelId.toString()}/${showSingleSignOnUrlId}`",
      "`${STATUS_PAGE_URL.toString()}/${modelId}/sso`",
    ],
    requireSso: "card",
  },
  {
    name: "Status page > OIDC",
    file: ["Pages", "StatusPages", "View", "OIDC.tsx"],
    printedUrls: [
      "`/status-page-oidc-callback/${modelId.toString()}/${showOidcConfigId}`",
      "`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showOidcConfigId}`",
      "`${STATUS_PAGE_URL.toString()}/${modelId}/sso`",
    ],
    requireSso: null,
  },
];

/*
 * What would make a single sign-on page depend on the edition or the
 * license: the Enterprise plugin door and its shell, the self-hosted
 * edition check, the ee license and tighten-only helpers, a license request,
 * or the Enterprise Edition upsell.
 */
const ENTERPRISE_CONSTRUCTS: Array<[string, RegExp]> = [
  ["the Enterprise plugin door", /getDashboardPlugins|Enterprise\/Plugins/],
  ["the Enterprise plugin shell", /EnterprisePluginPage/],
  ["the enterprise eligibility rule", /isEnterpriseFeatureEligible/],
  ["the edition flag", /IS_ENTERPRISE_EDITION/],
  ["an ee import", /@oneuptime\/ee-|@oneuptime\/dashboard\/|\/ee\//],
  [
    "the ee license helpers",
    /useEnterpriseLicenseMode|EnterpriseLicenseBanner|EnterpriseLicenseMode|LicensedFeature|isEnterpriseConfigurationReadOnly/,
  ],
  [
    "the ee tighten-only helpers",
    /ReadOnlyActionsNotice|useDisableProviderAction|DisableProviderAction|ForceSsoSetting|getForceSsoDescription/,
  ],
  ["a license request", /global-config\/license/],
  [
    "the Enterprise Edition upsell",
    /EnterpriseFeatureUpgrade|Enterprise Edition|EnterpriseUpgradeReason/,
  ],
  ["a read-only mode", /isReadOnly/],
];

const enterpriseConstructsIn: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return ENTERPRISE_CONSTRUCTS.filter(([, pattern]: [string, RegExp]) => {
    return pattern.test(code);
  }).map(([name]: [string, RegExp]) => {
    return name;
  });
};

const countOf: (code: string, needle: string) => number = (
  code: string,
  needle: string,
): number => {
  return code.split(needle).length - 1;
};

describe.each(SSO_PAGES)("$name page", (page: SsoPage) => {
  const code: string = readCode(...page.file);

  test("reaches nothing that depends on the edition or the license", () => {
    expect(enterpriseConstructsIn(code)).toEqual([]);
  });

  test("renders through the plan-only gate, with single sign-on's plan", () => {
    expect(code).toMatch(
      /import PlanGatedPage from "(\.\.\/)+Components\/Billing\/PlanGatedPage";/,
    );
    expect(code).toMatch(
      /import \{ SSO_REQUIRED_PLAN \} from "(\.\.\/)+Enterprise\/EnterpriseEligibility";/,
    );
    expect(code).toContain("<PlanGatedPage requiredPlan={SSO_REQUIRED_PLAN}");
    expect(countOf(code, "<PlanGatedPage")).toBe(1);
  });

  test("the provider table always offers create, edit and delete, and no extra row action", () => {
    expect(code).toContain("isDeleteable={true}");
    expect(code).toContain("isCreateable={true}");
    expect(code).toContain("isEditable={true}");
    expect(code).not.toMatch(/isCreateable=\{(?!true\})/);
    expect(code).not.toMatch(/isEditable=\{(?!true\})/);
    expect(code).not.toContain("refreshToggle");
    expect(code).not.toMatch(/title: "Disable/);
    // One row action: the configuration dialog.
    expect(countOf(code, "buttonStyleType: ButtonStyleType.NORMAL")).toBe(1);
  });

  test("requiring SSO is offered on the SAML pages only, and always changeable", () => {
    if (page.requireSso === null) {
      expect(code).not.toContain("requireSsoForLogin");
      expect(code).not.toContain("CardModelDetail");
      expect(code).not.toContain("RequireSsoForLoginCard");
      return;
    }

    if (page.requireSso === "switch") {
      /*
       * The project's switch, which saves on flip and asks before it locks
       * people out. Only the provider table has an Edit dialog now, and the
       * old card's "you you" typo is gone with it.
       */
      expect(code).toContain(
        'import RequireSsoForLoginCard from "../../Components/Project/RequireSsoForLoginCard";',
      );
      expect(code).toContain(
        "<RequireSsoForLoginCard projectId={ProjectUtil.getCurrentProjectId()!} />",
      );
      expect(countOf(code, "isEditable={true}")).toBe(1);
      expect(code).not.toContain("CardModelDetail");
      expect(code).not.toContain("requireSsoForLogin");
      expect(code).not.toContain("you you");
      return;
    }

    // The provider table's isEditable, and the card's.
    expect(countOf(code, "isEditable={true}")).toBe(2);
    expect(code).toContain('name="SSO Settings"');
    expect(code).toMatch(
      /description: "Please test SSO before you enable this feature\. If SSO is not tested properly then you will be locked out of the (project|status page)\."/,
    );
  });

  test("prints the identity provider URLs byte for byte", () => {
    for (const printedUrl of page.printedUrls) {
      expect(code).toContain(printedUrl);
    }
  });

  test("imports core Dashboard code by relative path", () => {
    expect(code).toMatch(/from "(\.\.\/)+PageComponentProps"/);
    expect(code).not.toContain('from "@oneuptime/');
  });
});

describe("the plan-only gate", () => {
  const GATE: string = readCode("Components", "Billing", "PlanGatedPage.tsx");
  const ELIGIBILITY: string = readCode(
    "Enterprise",
    "EnterpriseEligibility.ts",
  );

  test("asks the plan only, and shows the plan upsell", () => {
    expect(GATE).toContain("isPlanFeatureEligible(props.requiredPlan)");
    expect(GATE).toContain("reason={EnterpriseUpgradeReason.Plan}");
    expect(GATE).not.toContain("EnterpriseUpgradeReason.Edition");
    expect(GATE).not.toMatch(
      /isEnterpriseFeatureEligible|IS_ENTERPRISE_EDITION/,
    );
    expect(GATE).not.toMatch(/getDashboardPlugins|EnterprisePluginPage/);
  });

  test("decides on every render: no hook, no memo", () => {
    expect(GATE).not.toMatch(/\buse[A-Z]\w*\(/);
  });

  test("isPlanFeatureEligible lets every self-hosted install through before it looks at a plan, and never reads the edition", () => {
    const start: number = ELIGIBILITY.indexOf(
      "export const isPlanFeatureEligible",
    );

    expect(start).toBeGreaterThan(-1);

    const body: string = ELIGIBILITY.slice(start);

    expect(body).toContain("if (!BILLING_ENABLED) { return true; }");
    expect(body.indexOf("if (!BILLING_ENABLED)")).toBeLessThan(
      body.indexOf("isPlanAtLeast("),
    );
    expect(body).toContain(
      "return isPlanAtLeast(requiredPlan, getCurrentPlanOrNull());",
    );
    expect(body).not.toContain("IS_ENTERPRISE_EDITION");
    expect(ELIGIBILITY).toMatch(
      /export const SSO_REQUIRED_PLAN: EnterpriseRequiredPlan = PlanType\.Scale;/,
    );
  });
});

describe("routes and the plugin contract", () => {
  test("the Settings and status page routes render these core pages", () => {
    const settingsRoutes: string = readCode("Routes", "SettingsRoutes.tsx");
    const statusPagesRoutes: string = readCode(
      "Routes",
      "StatusPagesRoutes.tsx",
    );

    expect(settingsRoutes).toContain(
      'import SettingsSSO from "../Pages/Settings/SSO";',
    );
    expect(settingsRoutes).toContain(
      'import SettingsOIDC from "../Pages/Settings/OIDC";',
    );
    expect(settingsRoutes).toContain("<SettingsSSO {...props}");
    expect(settingsRoutes).toContain("<SettingsOIDC {...props}");
    expect(statusPagesRoutes).toContain(
      'import StatusPageViewSSO from "../Pages/StatusPages/View/SSO";',
    );
    expect(statusPagesRoutes).toContain(
      'import StatusPageViewOIDC from "../Pages/StatusPages/View/OIDC";',
    );
    expect(statusPagesRoutes).toContain("<StatusPageViewSSO {...props}");
    expect(statusPagesRoutes).toContain("<StatusPageViewOIDC {...props}");
  });

  test("the Enterprise plugin contract has no single sign-on screen", () => {
    const contract: string = readCode("Enterprise", "EnterprisePlugins.ts");

    for (const retiredKey of [
      "SettingsSSO",
      "SettingsOIDC",
      "StatusPageSSO",
      "StatusPageOIDC",
    ]) {
      expect(contract).not.toContain(retiredKey);
    }

    // The SCIM screens are still Enterprise plugins.
    expect(contract).toContain("SettingsSCIM:");
    expect(contract).toContain("StatusPageSCIM:");
  });
});

/*
 * Negative controls: the checks above would pass vacuously if they could not
 * see these constructs at all. These are the shapes the pages had while they
 * were Enterprise screens.
 */
describe("the checks themselves (negative controls)", () => {
  test.each([
    ["getDashboardPlugins().SettingsSSO", "the Enterprise plugin door"],
    ["<EnterprisePluginPage plugin={x} />", "the Enterprise plugin shell"],
    [
      "const ok = isEnterpriseFeatureEligible(IDENTITY_REQUIRED_PLAN);",
      "the enterprise eligibility rule",
    ],
    ["if (!IS_ENTERPRISE_EDITION) {}", "the edition flag"],
    [
      'import TeamsElement from "@oneuptime/dashboard/Components/Team/TeamsElement";',
      "an ee import",
    ],
    [
      "const mode = useEnterpriseLicenseMode(LicensedFeature.SSO);",
      "the ee license helpers",
    ],
    [
      'import useDisableProviderAction from "../../TightenOnly/UseDisableProviderAction";',
      "the ee tighten-only helpers",
    ],
    ['const url = "/api/global-config/license";', "a license request"],
    [
      '<EnterpriseFeatureUpgrade featureName="SAML Single Sign On" />',
      "the Enterprise Edition upsell",
    ],
    ["isCreateable={!isReadOnly}", "a read-only mode"],
  ])("flags %s", (source: string, construct: string) => {
    expect(enterpriseConstructsIn(stripComments(source))).toContain(construct);
  });

  test("does not flag what a core page legitimately imports", () => {
    expect(
      enterpriseConstructsIn(
        'import { SSO_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility"; import PlanGatedPage from "../../Components/Billing/PlanGatedPage";',
      ),
    ).toEqual([]);
  });

  test("reads code, not comments that name these constructs", () => {
    expect(
      enterpriseConstructsIn(
        stripComments(
          "/* The page no longer calls getDashboardPlugins(). */\n// nor IS_ENTERPRISE_EDITION\nconst a = 1;",
        ),
      ),
    ).toEqual([]);
  });
});
