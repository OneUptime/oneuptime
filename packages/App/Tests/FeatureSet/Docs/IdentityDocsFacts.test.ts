import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import SSOUtil from "../../../FeatureSet/Identity/Utils/SSO";
import RequireSsoForLoginSwitchCopy from "../../../FeatureSet/Dashboard/src/Components/Project/RequireSsoForLoginSwitchCopy";
import {
  REQUIRE_SSO_COPY,
  SSO_PAGE_COPY,
} from "../../../FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import URL from "Common/Types/API/URL";
import {
  MASTER_ADMIN_SIGN_IN_PATH,
  SSO_REQUIRED_SIGN_IN_MESSAGE,
} from "Common/Types/SSO/SignInMethods";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { getTableColumn } from "Common/Types/Database/TableColumn";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { JSONObject } from "Common/Types/JSON";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import zlib from "zlib";

/*
 * Docs overhaul task 13: what the Permission Reference, SSO, Global SSO,
 * SCIM and IP Addresses pages say, held to the code that does it. The
 * translations are held to these pages by IdentityDocsTranslations; the
 * provider forms (SamlScimProviderDocs, OidcProviderDocs), turning providers
 * off (SsoProviderChangesDocs, GlobalSsoProviderChangesDocs), plans and
 * licences (PlanCutoffCredentialsDocs, PlanGatedConfigRemovableDocs,
 * LicensePeriodClaims) and the teams a provider grants
 * (SsoProviderTeamGrantDocs) have suites of their own. This one holds the
 * rest: who may do what, where each screen is and what it is called, what
 * the sign-in flows do, and where an instance's IP list comes from.
 *
 * The SCIM server and its pages are in ee/, which App CI does not always
 * check out: what they say is checked when the files are there.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");

const REFERENCE: string = "permissions/reference";
const SSO: string = "identity/sso";
const GLOBAL_SSO: string = "identity/global-sso";
const SCIM: string = "identity/scim";
const IP_ADDRESSES: string = "configuration/ip-addresses";

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";
const IDENTITY: string = "packages/App/FeatureSet/Identity";

const SOURCES: Record<string, string> = {
  teamPermissionTable: `${DASHBOARD}/Components/Team/TeamPermissionTable.tsx`,
  apiKeyPermissionTable: `${DASHBOARD}/Components/ApiKey/ApiKeyPermissionTable.tsx`,
  teamSideMenu: `${DASHBOARD}/Pages/Teams/View/SideMenu.tsx`,
  teamPermissionsPage: `${DASHBOARD}/Pages/Teams/View/Permissions.tsx`,
  apiKeyPage: `${DASHBOARD}/Pages/Settings/APIKeyView.tsx`,
  roleCards: `${DASHBOARD}/Components/Permission/RoleCardSelectOptions.ts`,
  docsPermissionTables:
    "packages/App/FeatureSet/Docs/Utils/PermissionsTable.ts",
  ssoApi: `${IDENTITY}/API/SSO.ts`,
  oidcApi: `${IDENTITY}/API/OIDC.ts`,
  // How Sign in with SSO finds a project's providers: by the email's domain.
  ssoDiscovery: "packages/Common/Server/Utils/ProjectSsoDiscovery.ts",
  ssoUtil: `${IDENTITY}/Utils/SSO.ts`,
  ssoOneTimeUse: `${IDENTITY}/Utils/SamlAssertionOneTimeUse.ts`,
  ssoServiceProvider: `${IDENTITY}/Utils/SamlServiceProvider.ts`,
  globalSsoApi: `${IDENTITY}/API/GlobalSSO.ts`,
  statusPageSsoApi: `${IDENTITY}/API/StatusPageSSO.ts`,
  oidcUtil: `${IDENTITY}/Utils/OIDC.ts`,
  ssoConfirmation: `${IDENTITY}/Utils/ProjectSsoSignInConfirmation.ts`,
  ssoGate: `${IDENTITY}/Utils/ProjectSsoSignInGate.ts`,
  ssoIdentityBinding: `${IDENTITY}/Utils/ProjectSsoIdentityBinding.ts`,
  ssoConsent: "packages/Common/Server/Services/UserProjectSsoConsentService.ts",
  projectSsoPage: `${DASHBOARD}/Pages/Settings/SSO.tsx`,
  // On the SSO page, under its SAML providers.
  projectOidcProviders: `${DASHBOARD}/Components/Sso/ProjectOidcProviders.tsx`,
  // What the SSO page calls its providers, and its SSO sign-in link's card.
  projectSsoCopy: `${DASHBOARD}/Components/Sso/ProjectSsoCopy.ts`,
  projectSsoSignInLinkCard: `${DASHBOARD}/Components/Sso/ProjectSsoSignInLinkCard.tsx`,
  // The notice over the providers, and their Domains column (#9918).
  ssoProvidersNotice: `${DASHBOARD}/Components/Sso/SsoProvidersNotOfferedNotice.tsx`,
  ssoProviderDomains: `${DASHBOARD}/Components/Sso/SsoProviderDomains.ts`,
  // The upgrade's backfill of the providers' domains (#9918).
  ssoDomainBackfill:
    "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809186620000-BackfillSsoProviderDomains.ts",
  schemaMigrations:
    "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
  // The page the SSO sign-in link opens, and its path.
  accountsApp: "packages/App/FeatureSet/Accounts/src/App.tsx",
  projectSsoSignInPage:
    "packages/App/FeatureSet/Accounts/src/Pages/LoginWithProjectSso.tsx",
  signInMethods: "packages/Common/Types/SSO/SignInMethods.ts",
  movedPagePaths: `${DASHBOARD}/Routes/MovedPagePaths.ts`,
  settingsRoutes: `${DASHBOARD}/Routes/SettingsRoutes.tsx`,
  providerPickPage: `${DASHBOARD}/Pages/Onboarding/SSO.tsx`,
  dashboardRoutes: `${DASHBOARD}/Utils/RouteMap.ts`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  statusPageSideMenu: `${DASHBOARD}/Pages/StatusPages/View/SideMenu.tsx`,
  userMenu: `${DASHBOARD}/Components/Header/UserProfile.tsx`,
  adminNavBar: `${ADMIN_DASHBOARD}/Components/NavBar/NavBar.tsx`,
  adminSettingsSideMenu: `${ADMIN_DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  adminAuthenticationPage: `${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`,
  // The providers, SAML then OIDC, and Require SSO to Sign In under them.
  adminSsoPage: `${ADMIN_DASHBOARD}/Pages/Settings/SSO/Index.tsx`,
  adminSsoCopy: `${ADMIN_DASHBOARD}/Pages/Settings/SSO/SsoSettingsCopy.ts`,
  adminLocaleEn: `${ADMIN_DASHBOARD}/Locales/en.json`,
  globalSsoView: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalSSO/View.tsx`,
  globalOidcView: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalOIDC/View.tsx`,
  providerFields: "packages/Common/UI/Components/Sso/SsoProviderFormFields.ts",
  samlFields: "packages/Common/UI/Components/Sso/SamlProviderFormFields.ts",
  oidcFields: "packages/Common/UI/Components/Sso/OidcProviderFormFields.ts",
  modelTable: "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
  serviceRoutes: "packages/Common/ServiceRoute.ts",
  uiConfig: "packages/Common/UI/Config.ts",
  serverApis: "packages/Common/Server/API/Index.ts",
  environmentConfig: "packages/Common/Server/EnvironmentConfig.ts",
  helmValues: "HelmChart/Public/oneuptime/values.yaml",
  helmHelpers: "HelmChart/Public/oneuptime/templates/_helpers.tpl",
  composeBase: "docker-compose.base.yml",
  compose: "docker-compose.yml",
};

// The ee/ files: checked when the checkout has them.
const EE_SOURCES: Record<string, string> = {
  scimApi: "ee/Server/Identity/API/SCIM.ts",
  statusPageScimApi: "ee/Server/Identity/API/StatusPageSCIM.ts",
  scimUtils: "ee/Server/Identity/Utils/SCIMUtils.ts",
  scimOAuth: "ee/Server/Identity/Utils/SCIMOAuth.ts",
  scimOAuthToken: "ee/Server/Identity/API/SCIMOAuthToken.ts",
  scimClientCredentials:
    "ee/Dashboard/Identity/Components/ScimOAuthClientCredentials.tsx",
  projectScimPage: "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
  statusPageScimPage: "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx",
  projectScimLogs:
    "ee/Dashboard/Identity/Components/SCIMLogs/ProjectSCIMLogsTable.tsx",
  statusPageScimLogs:
    "ee/Dashboard/Identity/Components/SCIMLogs/StatusPageSCIMLogsTable.tsx",
  scimBearerTokenCopy: "ee/Dashboard/Identity/ScimBearerTokenCopy.ts",
};

// A role's level: the last word of its title.
const ROLE_LEVEL: RegExp = / (Admin|Member|Viewer)$/;

/*
 * The link of a project's SSO page (#9918): the project's SSO sign-in link,
 * the Accounts app's /sso/<project id> page.
 */
const SSO_TEST_LINK: RegExp =
  /return URL\.fromString\(ACCOUNTS_URL\.toString\(\)\)\s*\.addRoute\(getProjectSsoSignInRoute\(projectId\)\)/;

/*
 * The global provider's two questions, both in the form's More fields
 * section, each followed by the column it writes, registered unseen.
 */
const GLOBAL_QUESTIONS_FOLDED: RegExp =
  /withGlobalAccessSwitches\s*\?\s*\[\s*getSsoProviderSignUpChoiceField<TEntity>\(\{[^}]*collapsibleSection: advancedSection,\s*\}\),\s*getSsoProviderSignUpColumnField<TEntity>\(\{[^}]*\}\),\s*getSsoProviderReachChoiceField<TEntity>\(\{[^}]*collapsibleSection: advancedSection,\s*\}\),\s*getSsoProviderReachColumnField<TEntity>\(/;

/*
 * A SCIM page shows a new connection's bearer token once, as the create
 * answered it (#9012: no read holds it), and opens the dialog with its URLs
 * once the token is copied.
 */
const SCIM_TOKEN_ON_CREATE: RegExp =
  /onCreateSuccess=\{[\s\S]{0,200}?modalType === ModalType\.Create[\s\S]{0,200}?getBearerTokenShownOnCreate\(\s*item\.bearerToken,?\s*\)[\s\S]{0,200}?setShownOnceToken\(token\)/;
const SCIM_DIALOG_AFTER_TOKEN: RegExp =
  /<ShownOnceSecretModal[\s\S]{0,800}?onDone=\{[\s\S]{0,400}?setShowSCIMUrlId\(created\.id\.toString\(\)\)/;

function readSource(key: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[key]!), "utf8");
}

function hasEe(): boolean {
  return Object.values(EE_SOURCES).every((file: string): boolean => {
    return fs.existsSync(path.join(REPO_DIR, file));
  });
}

function readEe(key: string): string {
  return fs.readFileSync(path.join(REPO_DIR, EE_SOURCES[key]!), "utf8");
}

function english(page: string): string {
  return readPage("en", page);
}

function titleOf(permission: Permission): string {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (candidate: PermissionProps): boolean => {
        return candidate.permission === permission;
      },
    );

  return props?.title || "";
}

function titlesOf(permissions: Array<Permission>): Array<string> {
  return permissions.map(titleOf).sort();
}

// A table row of a page, by the text of its first cell.
function tableRow(markdown: string, firstCell: string): Array<string> {
  const line: string | undefined = markdown.split("\n").find((row: string) => {
    return (
      row.startsWith(`| ${firstCell} |`) || row.startsWith(`| ${firstCell} `)
    );
  });

  expect({ firstCell, found: Boolean(line) }).toEqual({
    firstCell,
    found: true,
  });

  return (line as string)
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The text a translationKey("...") constant holds in a source file.
function translationKeyText(source: string, constant: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(
      `export const ${escapeRegExp(constant)}: string = translationKey\\(\\s*"([^"]+)"`,
    ),
  );

  expect({ constant, found: Boolean(match) }).toEqual({
    constant,
    found: true,
  });

  return (match as RegExpMatchArray)[1] as string;
}

function defaultOf(model: BaseModel, column: string): unknown {
  return getTableColumn(model, column)?.defaultValue;
}

function updatePermissionsOf(
  model: BaseModel,
  column: string,
): Array<Permission> {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  return (access?.update || []) as Array<Permission>;
}

function readPermissionsOf(
  model: BaseModel,
  column: string,
): Array<Permission> {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  return (access?.read || []) as Array<Permission>;
}

/*
 * The routes a router file declares, as "METHOD /path" relative to its SCIM
 * base, with the record id written {id} as the docs write it.
 */
function scimRoutes(source: string, base: RegExp): Array<string> {
  const routes: Array<string> = [];
  const declared: RegExp = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;

  for (const match of source.matchAll(declared)) {
    const routePath: string = match[2] as string;

    if (!base.test(routePath)) {
      continue;
    }

    routes.push(
      `${(match[1] as string).toUpperCase()} ${routePath
        .replace(base, "")
        .replace(/:(userId|groupId)\b/g, "{id}")}`,
    );
  }

  return routes.sort();
}

/*
 * The SCIM API reference table, as "METHOD /path" per row, and the rows the
 * table marks as project SCIM only.
 */
function documentedScimRoutes(): {
  all: Array<string>;
  projectOnly: Array<string>;
} {
  const markdown: string = english(SCIM);
  const section: string = markdown.slice(
    markdown.indexOf("## SCIM API reference"),
    markdown.indexOf("What `/ServiceProviderConfig` reports"),
  );
  const all: Array<string> = [];
  const projectOnly: Array<string> = [];

  for (const line of section.split("\n")) {
    const cells: Array<string> = line
      .split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });

    const endpoint: RegExpMatchArray | null = (cells[0] || "").match(
      /^`(\/[^`]+)`$/,
    );

    if (!endpoint) {
      continue;
    }

    for (const method of (cells[1] || "").split(",")) {
      const route: string = `${method.trim()} ${endpoint[1]}`;

      all.push(route);

      if ((cells[2] || "").includes("(Project SCIM only)")) {
        projectOnly.push(route);
      }
    }
  }

  return { all: all.sort(), projectOnly: projectOnly.sort() };
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      handle: (req: unknown, res: unknown) => void;
    }>;
  };
}

interface StubResponse {
  statusCode: number;
  body: JSONObject | undefined;
  status: (code: number) => StubResponse;
  send: (body: JSONObject) => void;
}

// What GET /ip-whitelist answers, read with IP_WHITELIST set to `value`.
function ipWhitelistResponse(value: string | undefined): {
  handlers: number;
  response: StubResponse;
} {
  const saved: string | undefined = process.env["IP_WHITELIST"];
  const response: StubResponse = {
    statusCode: 0,
    body: undefined,
    status: (code: number): StubResponse => {
      response.statusCode = code;
      return response;
    },
    send: (body: JSONObject): void => {
      response.body = body;
    },
  };
  let handlers: number = 0;

  try {
    if (value === undefined) {
      delete process.env["IP_WHITELIST"];
    } else {
      process.env["IP_WHITELIST"] = value;
    }

    jest.isolateModules(() => {
      const api: {
        default: { init: () => { stack: Array<RouteLayer> } };
      } = jest.requireActual("Common/Server/API/IPWhitelistAPI") as {
        default: { init: () => { stack: Array<RouteLayer> } };
      };
      const layer: RouteLayer | undefined = api.default
        .init()
        .stack.find((candidate: RouteLayer): boolean => {
          return (
            candidate.route?.path === "/ip-whitelist" &&
            Boolean(candidate.route.methods["get"])
          );
        });

      expect(layer?.route).toBeDefined();

      handlers = layer!.route!.stack.length;
      layer!.route!.stack[handlers - 1]!.handle({ query: {} }, response);
    });
  } finally {
    if (saved === undefined) {
      delete process.env["IP_WHITELIST"];
    } else {
      process.env["IP_WHITELIST"] = saved;
    }
  }

  return { handlers, response };
}

describe("the Permission Reference", () => {
  const roles: Array<PermissionProps> =
    PermissionHelper.getRolePermissionProps();

  it("names the four roles that reach the whole project: the roles of the Project group", () => {
    const wholeProject: Array<string> = roles
      .filter((role: PermissionProps): boolean => {
        return role.group === PermissionGroup.Project;
      })
      .map((role: PermissionProps): string => {
        return role.title;
      })
      .sort();

    expect(wholeProject).toEqual([
      "Project Admin",
      "Project Member",
      "Project Owner",
      "Viewer",
    ]);
    expect(english(REFERENCE)).toContain(
      "Four of them reach the whole project: Project Owner, Project Admin, Project Member and Viewer.",
    );
  });

  it("says every other role covers one product area at Admin, Member or Viewer level", () => {
    const others: Array<string> = roles
      .filter((role: PermissionProps): boolean => {
        return role.group !== PermissionGroup.Project;
      })
      .map((role: PermissionProps): string => {
        return role.title;
      });

    expect(others.length).toBeGreaterThan(0);

    for (const title of others) {
      expect({ title, level: true }).toEqual({
        title,
        level: ROLE_LEVEL.test(title),
      });
    }

    expect(english(REFERENCE)).toContain(
      "Each of the others covers one product area, such as incidents or monitors, at Admin, Member or Viewer level.",
    );
  });

  it("says Add Role and Add Permission are on a team's Permissions page and on an API key's page", () => {
    for (const key of ["teamPermissionTable", "apiKeyPermissionTable"]) {
      const source: string = readSource(key);

      expect({ key, addRole: source.includes('title: "Add Role"') }).toEqual({
        key,
        addRole: true,
      });
      expect({
        key,
        addPermission: source.includes('title: "Add Permission"'),
      }).toEqual({ key, addPermission: true });
    }

    expect(readSource("teamSideMenu")).toContain('title: "Permissions"');
    expect(readSource("teamPermissionsPage")).toContain("<TeamPermissionTable");
    expect(readSource("apiKeyPage")).toContain("<ApiKeyPermissionTable");

    const page: string = english(REFERENCE);

    expect(page).toContain(
      "These are what **Add Role** offers on a team's **Permissions** page and on an API key's page.",
    );
    expect(page).toContain(
      "These are what **Add Permission** offers, for a team or an API key, when a role is broader than you need.",
    );
  });

  it("lists the roles Add Role offers, from the same list the tables are built from", () => {
    expect(readSource("roleCards")).toContain(
      "PermissionHelper.getRolePermissionProps()",
    );
    expect(readSource("docsPermissionTables")).toMatch(
      /permissions: getRolePermissionProps\(\)/,
    );
  });
});

describe("the SSO guide", () => {
  it("says OneUptime Cloud confirms a first sign-in through the project's own SAML or OIDC provider from the mailbox, with a link that works 24 hours", () => {
    const confirmation: string = readSource("ssoConfirmation");

    expect(confirmation).toContain(
      "export const PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS: number = 24;",
    );
    // Billing on is OneUptime Cloud; a self-hosted install signs people in straight away.
    expect(confirmation).toMatch(
      /public static isRequired\(\): boolean \{\s*return IsBillingEnabled;\s*\}/,
    );

    // Both callbacks ask the gate (#9824), which asks whether to confirm.
    expect(readSource("ssoGate")).toContain(
      "ProjectSsoSignInConfirmation.isRequired()",
    );

    for (const [key, kind] of [
      ["ssoApi", "ProjectSsoKind.SAML"],
      ["oidcApi", "ProjectSsoKind.OIDC"],
    ] as Array<[string, string]>) {
      const source: string = readSource(key);

      expect({
        key,
        asks: source.includes("ProjectSsoSignInGate.decide("),
      }).toEqual({
        key,
        asks: true,
      });
      expect({ key, kind: source.includes(kind) }).toEqual({ key, kind: true });
    }

    const page: string = english(SSO);

    expect(page).toContain(
      "On OneUptime Cloud, the first time someone signs in to the project with one of its SAML or OIDC providers, OneUptime emails them a link instead of signing them in.",
    );
    expect(page).toContain("The link works for 24 hours.");
    expect(page).toContain(
      "Self-hosted installations sign people in straight away.",
    );
  });

  it("says the confirmation holds once per project, until the person leaves it", () => {
    // A consent counts only while its owner is a member of the project.
    expect(readSource("ssoConsent")).toMatch(
      /public async hasConsent[\s\S]*?ProjectMembership\.userIdWhileMember\(/,
    );
    expect(english(SSO)).toContain(
      "This happens once per project, and again if they leave the project and come back.",
    );
  });

  it("quotes the messages the SAML sign-in answers with, as the server words them", () => {
    const server: string =
      readSource("ssoApi") +
      readSource("ssoUtil") +
      readSource("ssoOneTimeUse");
    const page: string = english(SSO);

    for (const message of [
      "SSO Config not found",
      "No teams added.",
      "Issuer URL does not match",
      "Encrypted SAML Responses are not supported",
      "SAML response did not include a valid email address",
      "SAML Audience does not match",
      "SAML Recipient does not match",
      "SAML response has expired",
      "SAML response was already used",
    ]) {
      expect({ message, sent: server.includes(`"${message}`) }).toEqual({
        message,
        sent: true,
      });
      expect({
        message,
        quoted: page.includes(`:::details "${message}"`),
      }).toEqual({
        message,
        quoted: true,
      });
    }
  });

  it("explains each message by what the server checks", () => {
    const ssoApi: string = readSource("ssoApi");

    // Only a provider that is on is found.
    expect(ssoApi).toMatch(
      /isEnabled: true,[\s\S]{0,400}?if \(!projectSSO\) \{[\s\S]{0,200}?"SSO Config not found"/,
    );
    // A newcomer with a provider that has no teams to put them in.
    expect(ssoApi).toMatch(
      /if \(teamMemberCount\.toNumber\(\) === 0\) \{[\s\S]{0,200}?projectSSO\.teams\.length === 0[\s\S]{0,300}?title: "No teams added\."/,
    );
    expect(readSource("oidcApi")).toContain('title: "No teams added."');

    const page: string = english(SSO);

    expect(page).toContain(
      "The provider is switched off, or the link is for a provider that no longer exists.",
    );
    expect(page).toContain(
      "The person is not in the project yet, and the provider has no **Teams** to add them to.",
    );
  });

  /*
   * Who a response is for and when it may be used: the rows of the table of
   * what OneUptime reads, held to SSOUtil (SamlResponseConditions.test.ts
   * runs every rule) and to the one-time use the Reply URLs claim.
   */
  it("says what a SAML response is held to, as the server holds it", () => {
    expect(SSOUtil.MAX_ASSERTION_AGE_IN_MS).toBe(10 * 60 * 1000);
    expect(SSOUtil.CLOCK_SKEW_IN_MS).toBe(3 * 60 * 1000);

    const util: string = readSource("ssoUtil");

    expect(util).toContain("SSOUtil.assertAudienceIsThisProvider(");
    expect(util).toContain("SSOUtil.getBearerConfirmationsForThisProvider(");
    expect(util).toContain("SSOUtil.assertDestinationIsThisProvider(");
    expect(util).toContain('"NotOnOrAfter"');
    expect(util).toContain('"NotBefore"');

    const page: string = english(SSO);

    for (const row of [
      "| Audience | Must be the provider's **Identifier (Entity ID)**. A response your IdP made for another application is refused. |",
      "| Recipient and Destination | Must be the provider's **Reply URL**, the address the response was sent to. |",
      "| `NotBefore` and `NotOnOrAfter` | The response is accepted only while they allow it, and no later than 10 minutes after it was issued, with 3 minutes of leeway for clocks that disagree. |",
    ]) {
      expect({ row, stated: page.includes(row) }).toEqual({
        row,
        stated: true,
      });
    }
  });

  it("says each response signs someone in once, at every SAML Reply URL", () => {
    for (const key of ["ssoApi", "globalSsoApi", "statusPageSsoApi"]) {
      expect({
        key,
        claims: readSource(key).includes("SamlAssertionOneTimeUse.claim("),
      }).toEqual({ key, claims: true });
    }

    expect(readSource("ssoOneTimeUse")).toContain(
      "GlobalCache.setStringIfNotExists(",
    );
    expect(english(SSO)).toContain(
      "Each response signs someone in once. Sent again, for example by going back in the browser after signing in, it is refused: sign in again.",
    );
    expect(english(GLOBAL_SSO)).toContain(
      "Each response from your identity provider signs someone in once, and only within minutes of being issued",
    );
  });

  it("says an identity provider that names OneUptime's address alone as the entity ID keeps working", () => {
    // The Entity ID the screens showed before May 2024, still accepted.
    expect(readSource("ssoServiceProvider")).toContain(
      "serverAddress: SamlServiceProviders.getServerAddress(),",
    );
    expect(readSource("ssoUtil")).toContain("serviceProvider.serverAddress,");
    expect(english(SSO)).toContain(
      "An IdP set up with OneUptime's address alone as the entity ID, such as `https://oneuptime.com`, keeps working.",
    );
  });

  it("reads the name from the attributes the guide names", () => {
    const util: string = readSource("ssoUtil");

    for (const attribute of [
      '"displayName"',
      '"http://schemas.microsoft.com/identity/claims/displayname"',
      '"firstName"',
      '"lastName"',
      '"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"',
      '"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"',
    ]) {
      expect({ attribute, read: util.includes(attribute) }).toEqual({
        attribute,
        read: true,
      });
    }

    expect(english(SSO)).toContain(
      "| Name attributes | The person's name, used when OneUptime creates their account: a display name (`displayName`, or `http://schemas.microsoft.com/identity/claims/displayname`), or a first and last name (`firstName` and `lastName`, or the `givenname` and `surname` claims Microsoft Entra ID sends by default). Optional. |",
    );
  });

  it("says a sign-in is linked to the object ID Microsoft Entra ID sends, and a later one as someone else is refused", () => {
    expect(readSource("ssoUtil")).toContain(
      '"http://schemas.microsoft.com/identity/claims/objectidentifier"',
    );

    const api: string = readSource("ssoApi");

    expect(api).toContain("ProjectSsoIdentityBinding.isBoundToAnotherPerson(");
    expect(api).toContain("ProjectSsoIdentityBinding.bindOrRefuse(");
    expect(readSource("ssoIdentityBinding")).toContain(
      'PROJECT_SSO_IDENTITY_MISMATCH_TITLE: string =\n  "This account is linked to someone else.";',
    );

    const page: string = english(SSO);

    expect(page).toContain(
      "| `http://schemas.microsoft.com/identity/claims/objectidentifier` | The person's object ID, which Microsoft Entra ID sends by default. The first sign-in through the provider links the account to it, and a later sign-in that names the account's email address with another object ID is refused. Optional. |",
    );
    expect(page).toContain(
      ':::details "This account is linked to someone else."',
    );
  });

  it("says OneUptime does not sign its sign-in requests, so Keycloak must not require a client signature", () => {
    const url: URL = SSOUtil.createSAMLRequestUrl({
      acsUrl: URL.fromString(
        "https://oneuptime.example.com/identity/idp-login/a/b",
      ),
      signOnUrl: URL.fromString("https://idp.example.com/sso"),
      issuerUrl: URL.fromString("https://oneuptime.example.com/a/b"),
    });
    const query: URLSearchParams = new URLSearchParams(
      url.toString().split("?")[1] || "",
    );

    expect(Array.from(query.keys())).toEqual(["SAMLRequest"]);

    const request: string = zlib
      .inflateRawSync(Buffer.from(query.get("SAMLRequest") || "", "base64"))
      .toString("utf8");

    expect(request).toContain("<samlp:AuthnRequest");
    expect(request).not.toMatch(/Signature/);
    expect(english(SSO)).toContain(
      "turn off **Client signature required** (in **Signing keys config**): OneUptime does not sign its sign-in requests",
    );
  });

  it("says the OIDC app signs in with the authorization code flow and PKCE", () => {
    const oidc: string = readSource("oidcUtil");

    expect(oidc).toContain('response_types: ["code"]');
    expect(oidc).toContain('code_challenge_method: "S256"');
    expect(oidc).toContain("code_verifier: data.codeVerifier");
    expect(english(SSO)).toContain(
      "Register an app (an OIDC client) with your identity provider that may use the authorization code flow with PKCE",
    );
  });

  /*
   * Sign in with SSO finds a project's providers by an email's domain, from
   * the verified domains each provider lists, and never reads an account
   * (#9824).
   */
  it("says Sign in with SSO offers a provider by the verified domains it lists, never by an account, as the routes do", () => {
    const page: string = english(SSO);
    const discovery: string = readSource("ssoDiscovery");

    expect(page).toContain("\n## Domains\n");
    expect(page).toContain(
      "**Sign in with SSO** asks for an email address and offers the providers that serve the address's domain. It reads no account: an address with an account in your project and one with no account at all get the same answer, so the page says nothing about who has an account.",
    );
    expect(page).toContain(
      "1. Add your domain under **Project Settings** > **Advanced** > **Domains**, click **Verify Domain** on its row, and add the TXT record it shows to the domain's DNS.",
    );
    expect(page).toContain(
      "2. Edit the provider, and pick the domain under **Domains** on the **Sign-in** step. Only the project's verified domains are listed.",
    );
    expect(page).toContain(
      "The domain must match exactly: `acme.com` does not cover `eu.acme.com`",
    );
    expect(page).toContain(
      "A provider that lists no verified domain is offered to nobody there.",
    );

    // Both routes ask the one lookup, which reads verified domains alone.
    expect(readSource("ssoApi")).toContain(
      "await ProjectSsoDiscovery.findSamlProviders(email);",
    );
    expect(readSource("oidcApi")).toContain(
      "await ProjectSsoDiscovery.findOidcProviders(email);",
    );
    expect(discovery).toMatch(
      /domain: QueryHelper\.findWithSameText\(domain\),\s*isVerified: true,/,
    );
    expect(discovery).toMatch(/isEnabled: true,/);
    expect(discovery).not.toMatch(/UserService|TeamMemberService/);

    // The form offers only the project's verified domains, on Sign-in.
    expect(readSource("providerFields")).toMatch(
      /field: \{ domains: true \}[\s\S]{0,400}?query: \{ isVerified: true \}/,
    );
    for (const key of ["projectSsoPage", "projectOidcProviders"]) {
      expect({
        key,
        asks: readSource(key).includes("withDomains: true,"),
      }).toEqual({ key, asks: true });
    }

    // Domains is under Advanced in Project Settings, as the page says.
    expect(readSource("settingsSideMenu")).toMatch(
      /title: "Advanced",[\s\S]{0,400}?title: "Domains",/,
    );
  });

  it("says a new provider starts switched off", () => {
    for (const model of [new ProjectSSO(), new ProjectOIDC()]) {
      expect({
        model: model.tableName,
        on: defaultOf(model, "isEnabled"),
      }).toEqual({
        model: model.tableName,
        on: false,
      });
    }

    expect(english(SSO)).toContain(
      "A new provider starts switched off. Once your IdP has these two values, edit the provider and turn **Enabled** on",
    );
  });

  it("names who may add a provider, and the plan it needs, as the models do", () => {
    const page: string = english(SSO);

    for (const [model, sentence] of [
      [
        new ProjectSSO(),
        "You need permission to add SSO providers — **Project Owner**, **Project Admin** or **Create Project SSO** — and, on OneUptime Cloud, the **Scale** plan.",
      ],
      [
        new ProjectOIDC(),
        "You need permission to add OIDC providers (**Project Owner**, **Project Admin** or **Create Project OIDC**) and, on OneUptime Cloud, the **Scale** plan.",
      ],
    ] as Array<[BaseModel, string]>) {
      const named: Array<string> = Array.from(
        sentence.matchAll(/\*\*([^*]+)\*\*/g),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .filter((name: string): boolean => {
          return name !== "Scale";
        })
        .sort();

      expect(titlesOf(model.getCreatePermissions())).toEqual(named);
      expect(model.createBillingPlan).toBe(PlanType.Scale);
      expect(page).toContain(sentence);
    }
  });

  /*
   * The project's SSO page names its two lists for what they hold, as a
   * status page's lists do: Add SAML Provider and Add OIDC Provider, where
   * they read Create SSO and Create OIDC after the models.
   */
  it("names the SSO page's buttons as the page draws them", () => {
    const copy: string = readSource("projectSsoCopy");
    const page: string = readSource("projectSsoPage");
    const oidc: string = readSource("projectOidcProviders");

    for (const [source, key, noun, button] of [
      [page, "samlProvider", "SAML Provider", "Add SAML Provider"],
      [oidc, "oidcProvider", "OIDC Provider", "Add OIDC Provider"],
    ] as Array<[string, string, string, string]>) {
      expect(copy).toContain(`${key}: translationKey("${noun}")`);
      expect(source).toContain(`singularName={ProjectSsoCopy.${key}}`);
      expect(source).toContain('createVerb="Add"');
      expect({ button, named: english(SSO).includes(`**${button}**`) }).toEqual(
        { button, named: true },
      );
    }

    expect(english(SSO)).not.toContain("**Create SSO**");
    expect(english(SSO)).not.toContain("**Create OIDC**");
    expect(readSource("modelTable")).toContain(
      'Add: translationKey("Add {{itemName}}")',
    );
  });

  it("names the create buttons after the models", () => {
    for (const [model, page] of [[new ProjectSCIM(), SCIM]] as Array<
      [BaseModel, string]
    >) {
      const button: string = `Create ${model.singularName}`;

      expect({
        button,
        named: english(page).includes(`**${button}**`),
      }).toEqual({
        button,
        named: true,
      });
    }

    expect(readSource("modelTable")).toContain(
      'Create: translationKey("Create {{itemName}}")',
    );
  });

  it("says the SSO sign-in link opens the project's providers, one of which you pick", () => {
    // One link, on the SSO page, for its SAML and OIDC providers alike.
    expect(SSO_TEST_LINK.test(readSource("projectSsoSignInLinkCard"))).toBe(
      true,
    );
    expect(readSource("projectSsoPage")).toContain("<ProjectSsoSignInLinkCard");
    expect(readSource("projectOidcProviders")).not.toContain("testUrl");
    // The card the docs name: it was Test Single Sign On (SSO) (#9918).
    expect(readSource("projectSsoCopy")).toContain(
      'signInLinkTitle: translationKey("SSO Sign-in Link")',
    );
    expect(readSource("projectSsoSignInLinkCard")).toContain(
      "<Card title={ProjectSsoCopy.signInLinkTitle}>",
    );
    expect(english(SSO)).toContain(
      "6. Open the link in the **SSO Sign-in Link** card and pick the provider, to sign in through it before you require SSO for the project.",
    );
    expect(english(SSO)).not.toContain("Test Single Sign On (SSO)");

    // The link is the Accounts app's /sso/<project id> page.
    expect(readSource("signInMethods")).toContain(
      'export const PROJECT_SSO_SIGN_IN_PATH: string = "/accounts/sso/:projectId";',
    );
    expect(readSource("signInMethods")).toContain(
      "return `/sso/${encodeURIComponent(projectId.toString())}`;",
    );
    expect(readSource("accountsApp")).toContain(
      "path={PROJECT_SSO_SIGN_IN_PATH}",
    );

    const picker: string = readSource("projectSsoSignInPage");

    /*
     * One list from the identity server: the project's own providers and
     * the global ones that sign people in to it, by the project's id alone.
     */
    expect(readSource("signInMethods")).toContain(
      'export const PROJECT_SIGN_IN_METHODS_ROUTE: string = "/project-sign-in-methods";',
    );
    expect(picker).toContain("getProjectSignInMethodsApiUrl(projectId)");
    // No address asked, and no lookup by one.
    expect(picker).not.toContain("FormFieldSchemaType.Email");
    expect(picker).not.toContain("SERVICE_PROVIDER_LOGIN");
    expect(english(SSO)).toContain(
      "Open the link in the **SSO Sign-in Link** card and pick the provider on the page it opens.",
    );

    // A project that requires SSO still sends its people to the Dashboard's page.
    expect(readSource("dashboardRoutes")).toContain(
      "[PageMap.PROJECT_SSO]: new Route(`/dashboard/${RouteParams.ProjectID}/sso`)",
    );
    expect(readSource("providerPickPage")).toContain(
      'description="Choose an SSO provider to sign in to this project."',
    );
  });

  /*
   * What the upgrade gave the providers set up before domains existed, what
   * the SSO page says of a provider found by nobody's email, and the link
   * for people on other domains (#9918) - as the backfill, the notice and
   * the card do.
   */
  it("says what the upgrade gave existing providers, what the page says of one found by no email, and what the link is for", () => {
    const page: string = english(SSO);

    expect(page).toContain(
      "Providers set up before domains existed were given their project's verified domains when OneUptime was upgraded: every domain the project had verified, unless another project had verified it too. Pick such a domain yourself if it is yours. A domain that was added but never verified was given to no provider.",
    );

    const backfill: string = readSource("ssoDomainBackfill");

    expect(readSource("schemaMigrations")).toContain(
      "BackfillSsoProviderDomains1809186620000,",
    );
    expect(backfill).toContain('"Domain"."isVerified" = true');
    expect(backfill).toContain('"VerifiedName"."projectCount" = 1');
    expect(backfill).toContain(
      'NOT EXISTS (SELECT 1 FROM "${table.joinTable}" AS "Listed"',
    );

    expect(page).toContain(
      "Its **Domains** column says **No verified domain**, and a notice above your providers names it and says what to do. While the project has no verified domain, the notice's **Verify a Domain** opens **Domains**.",
    );
    expect(readSource("projectSsoCopy")).toContain(
      'noVerifiedDomain: translationKey("No verified domain")',
    );
    expect(readSource("projectSsoCopy")).toContain(
      'verifyDomainAction: translationKey("Verify a Domain")',
    );
    expect(readSource("projectSsoCopy")).toContain(
      'domainsColumn: translationKey("Domains")',
    );
    expect(readSource("ssoProvidersNotice")).toContain(
      "RouteMap[PageMap.SETTINGS_DOMAINS]",
    );
    // Only providers that are on are named.
    expect(readSource("ssoProviderDomains")).toContain(
      "return provider.isEnabled === true && !isFoundByEmail(provider);",
    );

    expect(page).toContain(
      "Share your project's SSO sign-in link with them: copy it from the **SSO Sign-in Link** card under your providers. It lists the project's providers and asks for no email address, so it says nothing about who has an account.",
    );
    expect(readSource("projectSsoSignInLinkCard")).toContain(
      "<CopyTextButton textToBeCopied={signInLink} />",
    );
  });

  it("names the project's Require SSO to Sign In switch and its confirm button, under the providers", () => {
    expect(RequireSsoForLoginSwitchCopy.switchTitle).toBe(
      "Require SSO to Sign In",
    );
    expect(RequireSsoForLoginSwitchCopy.requireConfirmButton).toBe(
      "Require SSO",
    );

    const settingsPage: string = readSource("projectSsoPage");

    expect(settingsPage.indexOf("<ProjectSsoSignInLinkCard")).toBeGreaterThan(
      0,
    );
    expect(settingsPage.indexOf("<RequireSsoForLoginCard")).toBeGreaterThan(
      settingsPage.indexOf("<ProjectSsoSignInLinkCard"),
    );

    const page: string = english(SSO);

    expect(page).toContain(
      "use the **Require SSO to Sign In** switch on **Project Settings** > **Security** > **SSO**, under your providers:",
    );
    expect(page).toContain(
      "Click **Require SSO** to confirm. The switch saves straight away; there is no separate Save button.",
    );
  });

  it("names who may change Require SSO to Sign In, and that requiring it needs Scale", () => {
    expect(
      titlesOf(updatePermissionsOf(new Project(), "requireSsoForLogin")),
    ).toEqual(
      titlesOf([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProject,
      ]),
    );
    expect(titleOf(Permission.EditProject)).toBe("Edit Project");
    expect(
      new Project().getColumnBillingAccessControl("requireSsoForLogin").update,
    ).toBe(PlanType.Scale);

    const page: string = english(SSO);

    expect(page).toContain(
      "Project Owners, Project Admins and members with the **Edit Project** permission can change it",
    );
    expect(page).toContain(
      "On OneUptime Cloud, requiring SSO needs the **Scale** plan",
    );
  });

  it("finds the server-wide switch on the Admin Dashboard's Single Sign-On page, as it is named there", () => {
    expect(REQUIRE_SSO_COPY.switchTitle).toBe("Require SSO to Sign In");
    expect(REQUIRE_SSO_COPY.cardTitle).toBe("Require SSO");
    expect(REQUIRE_SSO_COPY.confirmButton).toBe("Require SSO");
    expect(readSource("adminSsoPage")).toContain('column="requireSsoForLogin"');
    // Not on Settings > Authentication any more.
    expect(readSource("adminAuthenticationPage")).not.toContain(
      'column="requireSsoForLogin"',
    );
    expect(readSource("adminSettingsSideMenu")).toMatch(
      /title: t\("sideMenu\.settingsSso"\),\s*(?:isTitleTranslated: true,\s*)?to: RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.SETTINGS_SSO\]/,
    );

    for (const page of [SSO, GLOBAL_SSO]) {
      expect({
        page,
        path: english(page).includes(
          "**Admin** > **Settings** > **Single Sign-On**",
        ),
      }).toEqual({ page, path: true });
    }

    expect(english(GLOBAL_SSO)).toContain(
      "the **Require SSO** card at the bottom of **Admin** > **Settings** > **Single Sign-On** has a **Require SSO to Sign In** switch",
    );
  });

  it("finds Single Sign-On and SCIM under Security on a status page, and SSO and SCIM in a project's settings", () => {
    const status: string = readSource("statusPageSideMenu");
    const statusSecurity: string = status.slice(
      status.indexOf('<SideMenuSection title="Security">'),
    );
    /*
     * A status page's SAML and OIDC providers are one Single Sign-On page,
     * a tab each (#9130), where they were two entries, SSO and OIDC.
     */
    const sso: number = statusSecurity.indexOf('title: "Single Sign-On"');
    const scim: number = statusSecurity.indexOf('title: "SCIM"');

    expect(status).toContain('<SideMenuSection title="Security">');
    expect(sso >= 0 && sso < scim).toBe(true);
    expect(statusSecurity.slice(0, scim)).not.toContain('title: "OIDC"');

    /*
     * A project's OpenID Connect providers are on its SSO page, under the
     * SAML ones; the old OIDC address forwards there.
     */
    const settings: string = readSource("settingsSideMenu");
    const settingsSecurity: string = settings.slice(
      settings.indexOf('title: "Security",'),
    );
    const projectSso: number = settingsSecurity.indexOf('title: "SSO"');
    const projectScim: number = settingsSecurity.indexOf('title: "SCIM"');

    expect(settings).toContain('title: "Security",');
    expect(projectSso >= 0 && projectSso < projectScim).toBe(true);
    expect(settingsSecurity.slice(0, projectScim)).not.toContain(
      'title: "OIDC"',
    );
    expect(readSource("projectSsoPage")).toContain("<ProjectOidcProviders");
    expect(readSource("movedPagePaths")).toContain(
      'export const MOVED_OIDC_SETTINGS_PATH: string = "oidc";',
    );
    expect(readSource("settingsRoutes")).toMatch(
      /path=\{MOVED_OIDC_SETTINGS_PATH\}\s*element=\{<MovedPageRedirect pageMap=\{PageMap\.SETTINGS_SSO\} \/>\}/,
    );

    expect(english(SSO)).toContain(
      "Navigate to **Project Settings** > **Security** > **SSO**",
    );
    expect(english(SSO)).toContain(
      "2. In OneUptime, go to **Project Settings** > **Security** > **SSO**. Under the SAML providers, click **Add OIDC Provider**.",
    );
    expect(english(SCIM)).toContain("Navigate to **Security** > **SCIM**");
  });
});

describe("the Global SSO guide", () => {
  it("opens the Admin Dashboard from Admin Settings in a master admin's user menu", () => {
    expect(readSource("userMenu")).toMatch(
      /User\.isMasterAdmin\(\) \?\s*\(\s*<IconDropdownItem\s*title=\{t\("userProfile\.adminSettings"\)\}[\s\S]{0,200}?Navigation\.navigate\(ADMIN_DASHBOARD_URL\)/,
    );
    expect(english(GLOBAL_SSO)).toContain(
      "Sign in as a master admin and open the Admin Dashboard with **Admin Settings** in your user menu.",
    );
  });

  it("goes to Settings > Single Sign-On, as the Admin Dashboard's menus name it", () => {
    expect(readSource("adminNavBar")).toMatch(
      /title: "Settings",[\s\S]{0,200}?RouteMap\[PageMap\.SETTINGS\]/,
    );

    // One page for both kinds of provider: no Global SSO or Global OIDC entry.
    const sideMenu: string = readSource("adminSettingsSideMenu");

    expect(sideMenu).toContain('title: t("sideMenu.settingsSso")');
    expect(sideMenu).not.toMatch(/title: "Global (SSO|OIDC)"/);

    const locale: {
      sideMenu: Record<string, string>;
      breadcrumbs: Record<string, string>;
    } = JSON.parse(readSource("adminLocaleEn")) as {
      sideMenu: Record<string, string>;
      breadcrumbs: Record<string, string>;
    };

    expect(locale.sideMenu["settingsSso"]).toBe("Single Sign-On");

    const page: string = english(GLOBAL_SSO);

    expect(page).toContain("Then go to **Settings** > **Single Sign-On**.");
    // In the order the page draws them.
    expect(page).toContain(
      "It lists the instance's SAML providers, then its OpenID Connect providers, and ends with the **Require SSO** card.",
    );

    const source: string = readSource("adminSsoPage");
    const saml: number = source.indexOf("<ModelTable<GlobalSSO>");
    const oidc: number = source.indexOf("<ModelTable<GlobalOIDC>");
    const requireSso: number = source.indexOf("<ModelSwitchCard<GlobalConfig>");

    expect(saml).toBeGreaterThan(0);
    expect(oidc).toBeGreaterThan(saml);
    expect(requireSso).toBeGreaterThan(oidc);
  });

  it("names the Single Sign-On page's buttons and row actions as it draws them", () => {
    const source: string = readSource("adminSsoPage");
    const page: string = english(GLOBAL_SSO);

    for (const [noun, button] of [
      [SSO_PAGE_COPY.samlProvider, "Add SAML Provider"],
      [SSO_PAGE_COPY.oidcProvider, "Add OIDC Provider"],
    ] as Array<[string, string]>) {
      expect(`Add ${noun}`).toBe(button);
      expect({
        button,
        named: page.includes(`- Click **${button}**.`),
      }).toEqual({ button, named: true });
    }

    expect(source).toContain("singularName={SSO_PAGE_COPY.samlProvider}");
    expect(source).toContain("singularName={SSO_PAGE_COPY.oidcProvider}");
    expect(source.split('createVerb="Add"').length - 1).toBe(2);
    expect(page).not.toMatch(/\*\*Create Global (SSO|OIDC)\*\*/);

    /*
     * Each row: Test Sign-in. A provider is turned on and off on its own
     * page, as the steps say (RowActionsAudit keeps the switch out of the
     * rows: turning one off ends every sign-in it gave).
     */
    expect(source).not.toContain("rowSwitch=");
    expect(page).not.toContain("**Enable**");
    expect(SSO_PAGE_COPY.testSignIn).toBe("Test Sign-in");
    expect(source.split("title: SSO_PAGE_COPY.testSignIn,").length - 1).toBe(2);
    expect(page).toContain(
      "**Test Sign-in** in the provider's row on **Single Sign-On** starts the same sign-in in a new tab.",
    );
    // The card above the switch says to test first, by that name.
    expect(REQUIRE_SSO_COPY.cardDescription).toContain(
      SSO_PAGE_COPY.testSignIn,
    );
  });

  it("says what requiring SSO for the whole instance does to the sign-in page, and where master admins sign in", () => {
    const page: string = english(GLOBAL_SSO);

    expect(MASTER_ADMIN_SIGN_IN_PATH).toBe("/accounts/admin-login");
    expect(page).toContain(
      `Master admins sign in with their password at \`${MASTER_ADMIN_SIGN_IN_PATH}\`, which the sign-in page does not link to.`,
    );
    expect(REQUIRE_SSO_COPY.masterAdminAddressLabel).toBe(
      "Master admin sign-in",
    );
    expect(page).toContain("under the switch, as **Master admin sign-in**");
    expect(readSource("adminSsoPage")).toContain(
      "label: REQUIRE_SSO_COPY.masterAdminAddressLabel,",
    );

    // The refusal, quoted as the server sends it.
    expect(page).toContain(`with "${SSO_REQUIRED_SIGN_IN_MESSAGE}"`);
    expect(page).toContain(`:::details "${SSO_REQUIRED_SIGN_IN_MESSAGE}"`);

    expect(page).toContain(
      "The sign-in page offers only SSO: a button for each global provider that is on, and no password, passkey, emailed link, Google or Microsoft sign-in, or sign-up.",
    );
    expect(page).toContain(
      "They land on the project's single sign-on page, which offers the project's own providers and the global providers that sign people in to it.",
    );
  });

  it("says which sign-in settings people other than master admins keep while the whole instance requires SSO, as the server refuses them (#9688)", () => {
    const page: string = english(GLOBAL_SSO);
    const repo: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
    };
    const assertion: string = "SsoManagedSignIn.assertMayChangeLocalSignIn(";

    /*
     * The rule is the instance's own Require SSO, which exempts master
     * admins - asked before the projects' rule (#9763), and never of a
     * master admin.
     */
    const rule: string = repo(
      "packages/Common/Server/Utils/SsoManagedSignIn.ts",
    );

    expect(rule).toContain("if (account.isMasterAdmin === true) {");
    expect(rule).toContain("await SsoRequiredSignIn.isNonSsoSignInRefused({");
    expect(rule).toContain("managedBy: SsoManagedBy.Server,");

    /*
     * Every write it names asks first: a password and two-factor
     * authentication, an authenticator app (and its first code), a passkey
     * or security key, and backup codes.
     */
    for (const file of [
      "packages/Common/Server/Services/UserService.ts",
      "packages/Common/Server/Services/UserTotpAuthService.ts",
      "packages/Common/Server/API/UserTotpAuthAPI.ts",
      "packages/Common/Server/Services/UserWebAuthnService.ts",
      "packages/Common/Server/API/UserTwoFactorBackupCodeAPI.ts",
    ]) {
      expect({ file, asks: repo(file).includes(assertion) }).toEqual({
        file,
        asks: true,
      });
    }

    // Forgot password mails such an account no link.
    expect(repo(`${IDENTITY}/API/Authentication.ts`)).toContain(
      "SsoManagedSignIn.isManagedBySsoFor(",
    );

    // User Profile: no Security section, and the providers on Overview.
    expect(
      repo(`${DASHBOARD}/Pages/Global/UserProfile/SideMenu.tsx`),
    ).toContain("!props.signInManagement.isManagedBySso");
    expect(repo(`${DASHBOARD}/Pages/Global/UserProfile/Index.tsx`)).toContain(
      "<SsoManagedSignInNotice",
    );

    expect(page).toContain(
      "- People other than master admins cannot set a password, a passkey, a security key, an authenticator app, backup codes or two-factor authentication, and a password reset emails them no link.",
    );
    expect(page).toContain(
      "Their **User Profile** has no **Security** section, and its **Overview** names the providers they sign in with. What they set up before stays saved but unused until the requirement is turned off.",
    );
  });

  it("says what Clear Sign-In Settings clears, for whom, and that it cannot be undone, as the server and the Admin Dashboard do (#9762)", () => {
    const page: string = english(GLOBAL_SSO);
    const repo: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
    };
    const clearing: string = repo(
      "packages/Common/Server/Utils/LocalSignInClearing.ts",
    );
    const adminEnglish: Record<string, unknown> = JSON.parse(
      repo("packages/App/FeatureSet/AdminDashboard/src/Locales/en.json"),
    ) as Record<string, unknown>;
    const authenticationWords: Record<string, string> = (
      adminEnglish["pages"] as Record<string, Record<string, string>>
    )["userAuthentication"]!;

    // The card's button, and the user page's card and button, by their words.
    expect(adminEnglish["Clear Sign-In Settings"]).toBe(
      "Clear Sign-In Settings",
    );
    expect(authenticationWords["clearSignInCardTitle"]).toBe(
      "Clear Sign-In Settings",
    );
    expect(authenticationWords["clearSignInButton"]).toBe(
      "Clear Sign-In Settings",
    );

    // Everyone the requirement covers: never a master admin, only while it is on.
    expect(clearing).toContain('"person"."isMasterAdmin" = false');
    expect(clearing).toContain(
      "if (!(await SsoRequiredSignIn.isSsoRequired())) {",
    );

    // What goes: password, keys, apps, codes, the switch, and non-SSO sessions.
    for (const write of [
      "password: null!",
      "enableTwoFactorAuth: false",
      "await UserTotpAuthService.deleteBy({",
      "await UserWebAuthnService.deleteBy({",
      "await UserTwoFactorBackupCodeService.deleteBy({",
      "UserSessionService.endSessionsOfPeopleSignedInWithoutSso(",
      "AuditLogService.recordSignInSettingsCleared(",
    ]) {
      expect({ write, found: clearing.includes(write) }).toEqual({
        write,
        found: true,
      });
    }

    // One person: never your own, and a master admin's only when confirmed.
    expect(clearing).toContain(
      "throw new BadDataException(CLEAR_OWN_SIGN_IN_MESSAGE);",
    );
    expect(clearing).toContain(
      "if (isMasterAdmin && !data.isMasterAdminConfirmed) {",
    );

    // Each person cleared is emailed (#9818), in the background.
    expect(clearing).toContain("void SignInSettingsClearedEmail.notify(");

    expect(page).toContain(
      "- The **Require SSO** card says how many of them still have a password or two-factor authentication saved, which would sign them in again if SSO stopped being required. **Clear Sign-In Settings** deletes their passwords, passkeys, security keys, authenticator apps and backup codes, turns two-factor authentication off and ends the sessions they signed in to without SSO, after asking. It cannot be undone, master admins keep theirs, each person's projects record it in their audit logs, and each person is emailed what was removed and how they sign in now.",
    );
    expect(page).toContain(
      "- On a person's **Authentication** page in **Users**, **Clear Sign-In Settings** does the same for that one person, and **Set Password** and **Send Password Reset Link** say that a password will not sign them in. You cannot clear your own there, and clearing another master admin's asks you to confirm they are one.",
    );
  });

  it("states the rule for Manage Sign-In with SSO, with each case, as the server and the project's switch decide it (#9763)", () => {
    const page: string = english(SSO);
    const repo: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
    };
    const rule: string = repo(
      "packages/Common/Server/Utils/SsoManagedSignIn.ts",
    );
    const switchCopy: string = repo(
      `${DASHBOARD}/Components/Project/ManageSignInWithSsoSwitchCopy.ts`,
    );

    // The switch's name, as the card draws it.
    expect(switchCopy).toContain(
      'switchTitle: translationKey("Manage Sign-In with SSO")',
    );
    expect(page).toContain("### Managing your people's sign-in with SSO");
    expect(page).toContain(
      "a second switch under it, **Manage Sign-In with SSO**",
    );

    /*
     * Every project, an invitation included (TeamMember rows of any state),
     * requires SSO and has the switch on; none means not managed.
     */
    expect(rule).toContain(
      "project.requireSsoForLogin === true &&\n          project.manageSignInWithSso === true",
    );
    expect(rule).toContain("projects.otherProjects.length === 0");
    expect(rule).not.toContain("hasAcceptedInvitation");
    expect(page).toContain(
      "Someone's sign-in is managed by SSO when every project they belong to, including any project they are invited to, requires SSO and has **Manage Sign-In with SSO** on.",
    );

    // Each case the issue named.
    expect(page).toContain(
      "- **Someone in a project that does not manage sign-in**: as soon as they are a member of, or invited to, a project that does not require SSO, or does not have **Manage Sign-In with SSO** on, they get their settings back, and their **User Profile** names that project as the reason.",
    );
    expect(page).toContain("- **Projects with different providers**:");
    expect(page).toContain(
      "- **Master admins** always keep their own settings.",
    );
    expect(page).toContain("- **What people set up before** is kept");

    // No sign-in changes: the projects' rule refuses settings, not sign-ins.
    expect(page).toContain(
      "Nothing about signing in changes: their password still signs them in to OneUptime, and your project asks for SSO as before.",
    );
  });

  it("states who a project's owners may clear, what counts as their organization, and who never is cleared, as the server decides it (#9820)", () => {
    const page: string = english(SSO);
    const repo: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
    };
    const rule: string = repo(
      "packages/Common/Server/Utils/ProjectSignInClearing.ts",
    );
    const routes: string = repo("packages/Common/Server/API/ProjectAPI.ts");
    const cardCopy: string = repo(
      `${DASHBOARD}/Components/Project/ProjectSavedSignInSettingsCopy.ts`,
    );

    expect(page).toContain("### Clearing what your people saved before");

    // The card's button, by its words, as the Admin Dashboard's is named.
    expect(cardCopy).toContain(
      'clearButton: translationKey("Clear Sign-In Settings")',
    );
    expect(page).toContain(
      "While **Manage Sign-In with SSO** is on, the Project Owners see under it how many of the project's people still have a password or two-factor authentication saved in OneUptime. **Clear Sign-In Settings** deletes",
    );

    // The organization is the projects the owner owns: every project of the person.
    expect(rule).toContain("[Permission.ProjectOwner]");
    expect(rule).toContain(
      "person.projectIds.every((projectId: ObjectID): boolean => {",
    );
    expect(rule).toContain("return managing.has(key) && owned.has(key);");
    expect(page).toContain(
      "Your organization is the projects you own: someone is cleared only when every project they belong to, including any project they are invited to, is one you are a **Project Owner** of and has **Manage Sign-In with SSO** on.",
    );

    // Members of this project only: an invitation has not joined.
    expect(rule).toContain("hasAcceptedInvitation: true,");
    expect(page).toContain(
      "- someone only invited to your project, who has not joined it yet;",
    );

    // Never a master admin, never the owner.
    expect(rule).toContain("isMasterAdminIncluded: false,");
    expect(page).toContain(
      "- master admins, and you: change your own in your **User Profile**.",
    );

    // Emailed, audit-logged as the owner's, session-only and owners only.
    expect(rule).toContain("void SignInSettingsClearedEmail.notify(");
    expect(rule).toContain("clearedByUserId: data.ownerUserId,");
    expect(routes).toContain(
      "CommonAPI.assertAuthenticatedProjectMember(props)",
    );
    expect(page).toContain(
      "Each person cleared is emailed what was removed and that they sign in with SSO now, and your projects' audit logs record the clear as yours. Only a **Project Owner** can clear, signed in to the Dashboard: never with an API key.",
    );
  });

  it("names the Admin Dashboard's Settings and Single Sign-On by the words its menus look up, which agree in every language", () => {
    const locales: string = path.join(
      PACKAGES_DIR,
      "App/FeatureSet/AdminDashboard/src/Locales",
    );

    for (const file of fs.readdirSync(locales)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(locales, file), "utf8"),
      ) as Record<string, unknown>;
      const navbar: Record<string, string> = (locale["navbar"] || {}) as Record<
        string,
        string
      >;
      const sideMenu: Record<string, string> = (locale["sideMenu"] ||
        {}) as Record<string, string>;

      // The nav bar looks its item up whole; the docs read the menus' keys.
      expect({ file, settings: locale["Settings"] }).toEqual({
        file,
        settings: navbar["settings"],
      });
      // The page reads the same in the side menu and in its breadcrumb.
      const breadcrumbs: Record<string, string> = (locale["breadcrumbs"] ||
        {}) as Record<string, string>;

      expect({ file, singleSignOn: breadcrumbs["singleSignOn"] }).toEqual({
        file,
        singleSignOn: sideMenu["settingsSso"],
      });
    }
  });

  it("says saving a new provider opens its page", () => {
    for (const view of [
      "SETTINGS_GLOBAL_SSO_VIEW",
      "SETTINGS_GLOBAL_OIDC_VIEW",
    ]) {
      expect({
        view,
        opens: new RegExp(
          `onCreateSuccess=\\{[\\s\\S]{0,300}?modalType === ModalType\\.Create[\\s\\S]{0,200}?RouteMap\\[PageMap\\.${view}\\]`,
        ).test(readSource("adminSsoPage")),
      }).toEqual({ view, opens: true });
    }

    expect(english(GLOBAL_SSO)).toContain("Saving opens the provider's page.");
  });

  it("names the provider page's cards, fields and buttons as the page draws them", () => {
    const saml: string = readSource("globalSsoView");
    const oidc: string = readSource("globalOidcView");

    for (const [source, text] of [
      [saml, 'title={"Identity Provider URLs"}'],
      [saml, "ACS URL (Assertion Consumer Service / Reply URL):"],
      [saml, "Issuer (Entity ID):"],
      [saml, 'title={"Test this SSO provider"}'],
      [saml, 'editButtonText={"Edit Configuration"}'],
      [saml, 'title: "Attached Projects"'],
      [oidc, 'title={"Identity Provider URL"}'],
      [oidc, "Redirect URI (Callback URL):"],
      [oidc, 'title={"Test this OIDC provider"}'],
      [oidc, 'editButtonText={"Edit Configuration"}'],
      [oidc, 'title: "Attached Projects"'],
    ] as Array<[string, string]>) {
      expect({ text, drawn: source.includes(text) }).toEqual({
        text,
        drawn: true,
      });
    }

    const page: string = english(GLOBAL_SSO);

    for (const label of [
      "Identity Provider URLs",
      "ACS URL (Assertion Consumer Service / Reply URL)",
      "Issuer (Entity ID)",
      "Test this SSO provider",
      "Edit Configuration",
      "Attached Projects",
      "Identity Provider URL",
      "Redirect URI (Callback URL)",
      "Test this OIDC provider",
    ]) {
      expect({ label, named: page.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }
  });

  it("says a new global provider starts switched off", () => {
    for (const model of [new GlobalSSO(), new GlobalOIDC()]) {
      expect({
        model: model.tableName,
        on: defaultOf(model, "isEnabled"),
      }).toEqual({
        model: model.tableName,
        on: false,
      });
    }

    expect(english(GLOBAL_SSO)).toContain(
      "A new provider starts switched off. Click **Edit Configuration** on the provider's page and turn **Enabled** on.",
    );
  });

  /*
   * "Disable Sign Up with SSO" and "Restrict to Attached Projects" were two
   * switches; the form asks them as two questions, each starting on its
   * first answer - off, as the columns start - written into those columns.
   */
  it("says both questions start on their first answer, folded under More fields", () => {
    for (const model of [new GlobalSSO(), new GlobalOIDC()]) {
      for (const column of [
        "disableSignUpWithSso",
        "restrictToAttachedProjects",
      ]) {
        expect({
          model: model.tableName,
          column,
          on: defaultOf(model, column),
        }).toEqual({
          model: model.tableName,
          column,
          on: false,
        });
      }
    }

    for (const key of ["samlFields", "oidcFields"]) {
      expect({
        key,
        folded: GLOBAL_QUESTIONS_FOLDED.test(readSource(key)),
      }).toEqual({ key, folded: true });
    }

    expect(english(GLOBAL_SSO)).toContain(
      "Two questions on the provider change this, folded under **More fields**. Each starts on its first answer:",
    );
  });

  it("names each question and its answers in the words the form gives them, the first answer first", () => {
    const fields: string = readSource("providerFields");
    const page: string = english(GLOBAL_SSO);

    const signUp: string = translationKeyText(
      fields,
      "SSO_GLOBAL_SIGN_UP_TITLE",
    );
    const reach: string = translationKeyText(fields, "SSO_GLOBAL_REACH_TITLE");

    // The answers, in the order the form offers them: off first.
    const answersOf: (constant: string) => Array<string> = (
      constant: string,
    ): Array<string> => {
      const start: number = fields.indexOf(`export const ${constant}`);
      const block: string = fields.slice(start, fields.indexOf("];", start));

      return [...block.matchAll(/title: translationKey\("([^"]+)"\)/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      );
    };

    const signUpAnswers: Array<string> = answersOf(
      "SSO_GLOBAL_SIGN_UP_CHOICES",
    );
    const reachAnswers: Array<string> = answersOf("SSO_GLOBAL_REACH_CHOICES");

    expect(signUpAnswers).toEqual([
      "Get one on their first sign-in",
      "Must be invited first",
    ]);
    expect(reachAnswers).toEqual(["Every project", "Attached projects only"]);

    const [, signUpRow] = tableRow(page, `**${signUp}**`) as [string, string];
    const [, reachRow] = tableRow(page, `**${reach}**`) as [string, string];

    for (const [row, answers] of [
      [signUpRow, signUpAnswers],
      [reachRow, reachAnswers],
    ] as Array<[string, Array<string>]>) {
      expect(row.indexOf(`**${answers[0]}**:`)).toBe(0);
      expect(row.indexOf(`**${answers[1]}**:`)).toBeGreaterThan(0);
    }

    // What restricting does, as the restriction always said it.
    expect(reachRow).toContain(
      "signing in with this provider meets SSO enforcement only in its attached projects, so people already signed in can lose access to the others.",
    );
    // A newcomer gets an account only when there is a project to put them in.
    expect(signUpRow).toContain(
      "with none attached, they must be invited first",
    );
    expect(readSource("globalSsoApi")).toContain(
      "Boolean(globalSso.disableSignUpWithSso) || isDefaultAllMode;",
    );

    // The troubleshooting names the answer that turns people away.
    expect(page).toContain(`**${signUp}** is set to **${signUpAnswers[1]}**`);
    expect(page).toContain(`**${reach}** is set to **${reachAnswers[1]}**`);
    expect(page).not.toMatch(
      /Disable Sign Up with SSO|Restrict to Attached Projects/,
    );
  });
});

describe("the SCIM guide", () => {
  it("says only a project owner adds or changes a connection, or resets its bearer token, and nobody reads one back", () => {
    const scim: ProjectSCIM = new ProjectSCIM();

    expect(titlesOf(scim.getCreatePermissions())).toEqual(["Project Owner"]);
    expect(titlesOf(scim.getUpdatePermissions())).toEqual(["Project Owner"]);
    // Kept as its hash (#9012): no one reads it, a project owner included.
    expect(titlesOf(readPermissionsOf(scim, "bearerToken"))).toEqual([]);
    expect(
      titlesOf(readPermissionsOf(new StatusPageSCIM(), "bearerToken")),
    ).toEqual([]);
    expect(getTableColumn(scim, "bearerToken")?.presentedKey).toBe(true);
    expect(titlesOf(updatePermissionsOf(scim, "bearerToken"))).toEqual([
      "Project Owner",
    ]);
    expect(english(SCIM)).toContain(
      "Only a Project Owner can add or change a project's SCIM connection, or reset its bearer token",
    );
    expect(english(SCIM)).toContain(
      "Nobody can read a bearer token back, a Project Owner included: OneUptime keeps only its hash.",
    );
  });

  it("says the switches start on, on and off", () => {
    const project: ProjectSCIM = new ProjectSCIM();
    const statusPage: StatusPageSCIM = new StatusPageSCIM();

    expect(defaultOf(project, "autoProvisionUsers")).toBe(true);
    expect(defaultOf(project, "autoDeprovisionUsers")).toBe(true);
    expect(defaultOf(project, "enablePushGroups")).toBe(false);
    expect(defaultOf(statusPage, "autoProvisionUsers")).toBe(true);
    expect(defaultOf(statusPage, "autoDeprovisionUsers")).toBe(true);

    const page: string = english(SCIM);

    expect(page).toContain(
      "are on, and **Enable Push Groups** is off. Change them there if you need to",
    );
    expect(page).toContain(
      "(delete private users when they're unassigned in your IdP) are on. Change them there if you need to",
    );
  });

  it("says SCIM needs the Scale plan, for a project and for a status page", () => {
    expect(new ProjectSCIM().createBillingPlan).toBe(PlanType.Scale);
    expect(new StatusPageSCIM().createBillingPlan).toBe(PlanType.Scale);
    expect(english(SCIM)).toContain(
      "On OneUptime Cloud it is available on the **Scale** plan and above.",
    );
  });

  it("gives the base URLs under the identity route the dialogs draw them on", () => {
    expect(readSource("serviceRoutes")).toContain(
      'export const IdentityRoute: Route = new Route("/identity");',
    );
    expect(readSource("uiConfig")).toMatch(
      /export const IDENTITY_URL: URL = new URL\([\s\S]{0,200}?new Route\(IdentityRoute\.toString\(\)\)/,
    );

    const page: string = english(SCIM);

    expect(page).toContain(
      "`https://oneuptime.com/identity/scim/v2/<scim-id>`",
    );
    expect(page).toContain(
      "`https://oneuptime.com/identity/status-page-scim/v2/<scim-id>`",
    );

    if (!hasEe()) {
      return;
    }

    expect(readEe("projectScimPage")).toContain(
      "{IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}",
    );
    expect(readEe("statusPageScimPage")).toMatch(
      /\{IDENTITY_URL\.toString\(\)\}\/status-page-scim\/v2\/\s*\{showSCIMUrlId\}/,
    );
  });

  it("says saving a connection shows its token once, then the dialog with its URL, and names the row's buttons and the Logs tab", () => {
    const page: string = english(SCIM);

    expect(page).toContain(
      "Save. OneUptime shows the connection's **Bearer Token** once: copy it before you click **Done**, since OneUptime keeps only its hash and no page shows it again. The dialog with the **SCIM Base URL** for your IdP configuration opens next",
    );
    expect(page).toContain(
      "The bearer token is not shown again: if you no longer have it, or it has leaked, **Reset Bearer Token** makes a new one, shown once the same way, and the old one stops working at once.",
    );

    for (const label of [
      "View SCIM URLs",
      "Reset Bearer Token",
      "Show SCIM Endpoint URLs",
      "Logs",
      "View Details",
    ]) {
      expect({ label, named: page.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }

    if (!hasEe()) {
      return;
    }

    for (const key of ["projectScimPage", "statusPageScimPage"]) {
      expect({
        key,
        token: SCIM_TOKEN_ON_CREATE.test(readEe(key)),
        opens: SCIM_DIALOG_AFTER_TOKEN.test(readEe(key)),
        logs: readEe(key).includes('name: "Logs"'),
        reset: readEe(key).includes('title: "Reset Bearer Token"'),
      }).toEqual({ key, token: true, opens: true, logs: true, reset: true });
    }

    // The dialog that shows the token once closes with Done, as the page says.
    expect(readEe("scimBearerTokenCopy")).toContain(
      'done: translationKey("Done")',
    );

    expect(readEe("projectScimPage")).toContain('title: "View SCIM URLs"');
    expect(readEe("statusPageScimPage")).toContain(
      'title: "Show SCIM Endpoint URLs"',
    );
    expect(readEe("projectScimLogs")).toContain('title: "View Details"');
    expect(readEe("statusPageScimLogs")).toContain('title: "View Details"');
  });

  it("lists the endpoints and methods the SCIM servers serve, groups for projects only", () => {
    const documented: { all: Array<string>; projectOnly: Array<string> } =
      documentedScimRoutes();

    expect(documented.all.length).toBeGreaterThan(0);
    expect(documented.projectOnly).toEqual([
      "DELETE /Groups/{id}",
      "GET /Groups",
      "GET /Groups/{id}",
      "PATCH /Groups/{id}",
      "POST /Groups",
      "PUT /Groups/{id}",
    ]);

    if (!hasEe()) {
      return;
    }

    expect(
      scimRoutes(readEe("scimApi"), /^\/scim\/v2\/:projectScimId/),
    ).toEqual(documented.all);
    expect(
      scimRoutes(
        readEe("statusPageScimApi"),
        /^\/status-page-scim\/v2\/:statusPageScimId/,
      ),
    ).toEqual(
      documented.all.filter((route: string): boolean => {
        return !documented.projectOnly.includes(route);
      }),
    );
  });

  it("says what /ServiceProviderConfig reports", () => {
    const markdown: string = english(SCIM);
    const page: string = markdown.slice(
      markdown.indexOf("What `/ServiceProviderConfig` reports"),
    );

    expect(tableRow(page, "PATCH")[1]).toBe("Yes");
    expect(tableRow(page, "Bulk")[1]).toBe(
      "Yes, up to 1,000 operations and 1 MB per request",
    );
    expect(tableRow(page, "Filter")[1]).toBe("Yes, up to 200 results");
    expect(tableRow(page, "Sort")[1]).toBe("No");
    expect(tableRow(page, "Change password")[1]).toBe("No");
    expect(tableRow(page, "ETag")[1]).toBe("No");
    expect(tableRow(page, "Authentication")[1]).toBe(
      "HTTP Bearer token, or an OAuth 2.0 access token",
    );

    if (!hasEe()) {
      return;
    }

    const config: string = readEe("scimUtils");
    const body: string = config.slice(
      config.indexOf("generateServiceProviderConfig"),
      config.indexOf("authenticationSchemes"),
    );

    expect(body).toMatch(/patch: \{\s*supported: true,/);
    expect(body).toMatch(
      /bulk: \{\s*supported: true,\s*maxOperations: 1000,\s*maxPayloadSize: 1048576,/,
    );
    expect(body).toMatch(
      /filter: \{\s*supported: true,\s*maxResults: SCIM_MAX_PAGE_SIZE,/,
    );
    expect(config).toContain("export const SCIM_MAX_PAGE_SIZE: number = 200;");
    expect(body).toMatch(/changePassword: \{\s*supported: false,/);
    expect(body).toMatch(/sort: \{\s*supported: false,/);
    expect(body).toMatch(/etag: \{\s*supported: false,/);
    expect(config).toMatch(
      /authenticationSchemes: \[\s*\{\s*type: "httpbearer",[\s\S]*?\},\s*\{\s*type: "oauthbearertoken",/,
    );
  });

  it("gives the token endpoint of OAuth 2.0 client credentials, its grant, and how long tokens and secrets work", () => {
    const page: string = english(SCIM);

    expect(page).toContain(
      "it is `https://oneuptime.com/identity/scim/oauth/token` for every connection on OneUptime Cloud. It takes the `client_credentials` grant, with the client ID and secret sent with HTTP Basic authentication or in the form, and answers an access token that works for an hour (`expires_in` of `3600`).",
    );
    expect(page).toContain(
      "- **Token Endpoint**: where your identity provider gets its access tokens. It is the same for every connection: `https://oneuptime.com/identity/scim/oauth/token` on OneUptime Cloud.",
    );
    expect(page).toContain(
      "OneUptime keeps only a hash of it and cannot show it again. It works for a year.",
    );
    expect(page).toContain(
      "The secret before it keeps working until it expires or you click **Delete Previous Secret**",
    );

    expect(readSource("serviceRoutes")).toContain(
      'export const IdentityRoute: Route = new Route("/identity");',
    );

    if (!hasEe()) {
      return;
    }

    expect(readEe("scimOAuthToken")).toContain(
      'export const SCIM_TOKEN_ROUTE: string = "/scim/oauth/token";',
    );
    expect(readEe("scimOAuthToken")).toContain(
      'const GRANT_TYPE_CLIENT_CREDENTIALS: string = "client_credentials";',
    );

    const oauth: string = readEe("scimOAuth");

    expect(oauth).toContain(
      "export const SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS: number = 60 * 60;",
    );
    expect(oauth).toContain(
      "export const SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS: number = 365;",
    );
    expect(readEe("scimClientCredentials")).toContain(
      "`${IDENTITY_URL.toString()}/scim/oauth/token`",
    );
  });
});

describe("the IP Addresses page", () => {
  it("serves the list as JSON, with no API key, one trimmed address per entry", () => {
    const { handlers, response } = ipWhitelistResponse(
      " 203.0.113.1, 203.0.113.2 ,",
    );

    // The route's own handler and nothing before it: no key is asked for.
    expect(handlers).toBe(1);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ipWhitelist: ["203.0.113.1", "203.0.113.2"],
    });
    expect(readSource("serverApis")).toContain(
      'app.use([`/${data.appName}`, "/"], IPWhitelistAPI.init());',
    );

    const page: string = english(IP_ADDRESSES);

    expect(page).toContain(
      "The same list is served as JSON, with no API key needed",
    );
    expect(page).toContain(
      "`ipWhitelist` is an array with one address per entry.",
    );
    expect(page).toContain("curl -s https://oneuptime.com/ip-whitelist");
  });

  it("answers an empty array when nothing is set", () => {
    expect(ipWhitelistResponse(undefined).response.body).toEqual({
      ipWhitelist: [],
    });
    expect(english(IP_ADDRESSES)).toContain(
      "the endpoint returns an empty `ipWhitelist` array",
    );
  });

  it("reads the instance's IP_WHITELIST, a comma-separated list the Helm chart sets from ipWhitelist", () => {
    expect(readSource("environmentConfig")).toContain(
      'export const IpWhitelist: string = process.env["IP_WHITELIST"] || "";',
    );
    expect(readSource("helmValues")).toMatch(/^ipWhitelist:/m);
    expect(readSource("helmHelpers")).toContain(
      '- name: IP_WHITELIST\n  value: {{ default "" $.Values.ipWhitelist | quote }}',
    );

    const page: string = english(IP_ADDRESSES);

    expect(page).toContain(
      "show the addresses in the instance's `IP_WHITELIST` setting, a comma-separated list.",
    );
    expect(page).toContain("Set the Helm chart's `ipWhitelist` value:");
  });

  it("says config.env does not reach the app, so Docker Compose takes it from an override of the app service", () => {
    // Neither the app's environment nor the shared runtime variables pass it on.
    expect(readSource("composeBase")).not.toContain("IP_WHITELIST");
    expect(readSource("compose")).not.toContain("IP_WHITELIST");
    expect(readSource("compose")).toMatch(/^ {2}app:\n/m);

    const page: string = english(IP_ADDRESSES);

    expect(page).toContain(
      "`config.env` does not pass it on to the app. Add it to the environment of the `app` service in a `docker-compose.override.yml` next to `docker-compose.yml`, then start OneUptime again:",
    );
    expect(page).toContain(
      'services:\n  app:\n    environment:\n      IP_WHITELIST: "203.0.113.1,203.0.113.2"',
    );
  });
});
