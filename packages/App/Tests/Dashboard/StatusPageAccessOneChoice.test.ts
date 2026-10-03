import StatusPageAccessCopy, {
  ACCESS_CHOICE_COPY,
  ACCESS_CONFIRMATION_COPY,
  StatusPageRequireSsoCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import {
  STATUS_PAGE_ACCESS_CHOICES,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who can see a status page is one choice, on its Security -> Access page:
 * anyone with the link, only people who sign in, or anyone with the
 * password (Components/StatusPage/StatusPageAccessCard).
 *
 * It was "Authentication Settings", the last of five Security entries, with
 * three cards: "Is Visible to Public" behind an Edit button, "Require
 * Master Password" behind a second one with the password behind a third
 * button, and the IP whitelist. A password switched on for a public page
 * did nothing, and one switched on with no password set protected nothing
 * either - while the status page app sent every visitor to a password
 * prompt nobody could pass. The status page's SSO page had a "Force SSO for
 * Login" card with an Edit dialog of its own.
 *
 * This holds the pages to the new shape as source text, so a page written
 * later cannot quietly bring a switch, a second place or the old words
 * back. The behaviour is tested in Common/Tests (StatusPageAccess*,
 * StatusPageRequireSsoCard, ChoiceRows, and at the server
 * StatusPageAccessChoice and StatusPageMasterPageAccess).
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
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

const ACCESS_PAGE: string = dashboardFile(
  "Pages",
  "StatusPages",
  "View",
  "AuthenticationSettings.tsx",
);

describe("the Access page", () => {
  const page: string = readSource(ACCESS_PAGE);

  test("opens on the one choice, then folds the IP allowlist under Advanced", () => {
    expect(page).toContain(
      "<StatusPageAccessCard statusPageId={modelId} /> <AdvancedPageSection",
    );
    expect(page.split("<CardModelDetail").length - 1).toBe(1);
    expect(page.indexOf("<AdvancedPageSection")).toBeLessThan(
      page.indexOf("<CardModelDetail"),
    );
    expect(page).toContain('name="Status Page > IP Allowlist"');
  });

  test("has no switch, no password button and no column of the choice", () => {
    for (const gone of [
      "FormFieldSchemaType.Toggle",
      "ModelFormModal",
      "isPublicStatusPage",
      "enableMasterPassword",
      "masterPassword",
      "Is Visible to Public",
      "Require Master Password",
      "Set Master Password",
      "Update Master Password",
      "IP Whitelist",
      "Authentication Settings",
    ]) {
      expect([gone, page.includes(gone)]).toEqual([gone, false]);
    }
  });

  test("the IP allowlist refuses lines the server cannot read", () => {
    expect(page).toContain("customValidation:");
    expect(page).toContain("getIpAllowlistProblem(");
  });
});

describe("one place for the choice", () => {
  /*
   * The status page columns a choice writes. Only the Access card writes
   * them (through the Common rule), and only these files name them: the
   * copy module (what it reads) and the Private Users page (which reads
   * them for its notice).
   */
  const ALLOWED: Array<string> = [
    "Components/StatusPage/StatusPageAccessCopy.ts",
    "Pages/StatusPages/View/PrivateUser.tsx",
  ];

  const files: Array<string> = sourceFilesUnder(DASHBOARD_SRC);

  test("the walk really reads the dashboard", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test.each(["isPublicStatusPage", "enableMasterPassword: true"])(
    "only the Access page's own files name %s",
    (column: string) => {
      const naming: Array<string> = files
        .filter((file: string): boolean => {
          return readSource(file).includes(column);
        })
        .map((file: string): string => {
          return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
        })
        .filter((file: string): boolean => {
          // A dashboard (not a status page) has a master password of its own.
          return !file.startsWith("Pages/Dashboards/");
        });

      expect(
        naming.filter((file: string): boolean => {
          return !ALLOWED.includes(file);
        }),
      ).toEqual([]);
    },
  );

  test("the card writes the changes the Common rule works out, never a column of its own", () => {
    const card: string = readSource(
      dashboardFile("Components", "StatusPage", "StatusPageAccessCard.tsx"),
    );

    expect(card).toContain(
      "getStatusPageAccessChanges({ from: page.state, to: data.to })",
    );
    expect(card).toContain("getStatusPageAccess(page.state)");
    expect(card).not.toContain("isPublicStatusPage: true");
    expect(card).not.toContain("isPublicStatusPage: false");
  });

  test("the Private Users notice follows the same rule", () => {
    const privateUsers: string = readSource(
      dashboardFile("Pages", "StatusPages", "View", "PrivateUser.tsx"),
    );

    expect(privateUsers).toContain(
      "getStatusPageAccess(getStatusPageAccessState(statusPage)) === StatusPageAccess.Password",
    );
    expect(privateUsers).toContain(
      "textOnRight={StatusPageAccessCopy.privateUsersPasswordNoticeAction}",
    );
    expect(privateUsers).toContain(
      "RouteMap[ PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS ] as Route",
    );
  });

  test("the server asks for the password by the same rule, in the read check and in the master-page answer", () => {
    const service: string = readSource(
      path.join(COMMON_ROOT, "Server", "Services", "StatusPageService.ts"),
    );
    const api: string = readSource(
      path.join(COMMON_ROOT, "Server", "API", "StatusPageAPI.ts"),
    );

    expect(service).toContain("isStatusPageMasterPasswordRequired({");
    expect(api).toContain(
      "item.enableMasterPassword = isStatusPageMasterPasswordRequired({",
    );
    expect(api).toContain("delete item.masterPassword;");
    expect(api).toContain("delete item.masterPasswordSalt;");
  });
});

describe("the status page menu, breadcrumbs and links", () => {
  test("Security opens on Access, at the old address", () => {
    const menu: string = readSource(
      dashboardFile("Pages", "StatusPages", "View", "SideMenu.tsx"),
    );

    const security: string = menu.slice(
      menu.indexOf('<SideMenuSection title="Security">'),
      menu.indexOf('<SideMenuSection title="AI">'),
    );

    const titles: Array<string> = Array.from(
      security.matchAll(/title: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual(["Access", "Private Users", "SSO", "OIDC", "SCIM"]);
    expect(security).toMatch(
      /title: "Access", to: RouteUtil\.populateRouteParams\( RouteMap\[ PageMap\.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS \] as Route,/,
    );
    expect(menu).not.toContain("Authentication Settings");
  });

  test("the breadcrumbs say Access", () => {
    const breadcrumbs: string = readSource(
      dashboardFile("Utils", "Breadcrumbs", "StatusPagesBreadcrumbs.ts"),
    );

    expect(breadcrumbs).toContain(
      'PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS, ["Project", "Status Pages", "View Status Page", "Access"],',
    );
    expect(breadcrumbs).not.toContain("Authentication Settings");
  });

  test("the MCP page sends readers to Access", () => {
    const mcp: string = readSource(
      dashboardFile("Pages", "StatusPages", "View", "Mcp.tsx"),
    );

    expect(mcp).toContain('translator.translateText("Access")');
    expect(mcp).not.toContain('"Authentication Settings"');
  });

  test("the SSO page's Require SSO for Login is the switch, with no Edit dialog", () => {
    const sso: string = readSource(
      dashboardFile("Pages", "StatusPages", "View", "SSO.tsx"),
    );

    expect(sso).toContain(
      "<StatusPageRequireSsoCard statusPageId={modelId} />",
    );
    expect(sso).not.toContain("CardModelDetail");
    expect(sso).not.toContain("Force SSO for Login");
    expect(sso).not.toContain("you you");
  });
});

describe("translations", () => {
  const strings: Array<string> = [
    StatusPageAccessCopy.cardTitle,
    StatusPageAccessCopy.cardDescription,
    StatusPageAccessCopy.privateUsers.other,
    `${StatusPageAccessCopy.privateUsers.other}_one`,
    StatusPageAccessCopy.ssoOn,
    StatusPageAccessCopy.ssoOff,
    StatusPageAccessCopy.oidcOn,
    StatusPageAccessCopy.oidcOff,
    StatusPageAccessCopy.ssoRequired,
    StatusPageAccessCopy.nobodyCanSignIn,
    StatusPageAccessCopy.nobodyCanSignInSsoRequired,
    StatusPageAccessCopy.addPrivateUsers,
    StatusPageAccessCopy.setUpSso,
    StatusPageAccessCopy.confirmNobodyCanSignIn,
    StatusPageAccessCopy.confirmPrivateUsersUsePassword,
    StatusPageAccessCopy.passwordFieldTitle,
    StatusPageAccessCopy.newPasswordFieldTitle,
    StatusPageAccessCopy.keepPasswordDescription,
    StatusPageAccessCopy.passwordPlaceholder,
    StatusPageAccessCopy.changePassword,
    StatusPageAccessCopy.changePasswordDescription,
    StatusPageAccessCopy.advancedDescription,
    StatusPageAccessCopy.advancedSummaryOpen,
    StatusPageAccessCopy.advancedSummaryConfigured,
    StatusPageAccessCopy.ipAllowlistTitle,
    StatusPageAccessCopy.ipAllowlistDescription,
    StatusPageAccessCopy.ipAllowlistEditButton,
    StatusPageAccessCopy.ipAllowlistFieldDescription,
    StatusPageAccessCopy.ipAllowlistEmpty,
    StatusPageAccessCopy.ipAllowlistNoAddress,
    StatusPageAccessCopy.ipAllowlistBlank,
    StatusPageAccessCopy.ipAllowlistInvalidEntry,
    StatusPageAccessCopy.privateUsersPasswordNotice,
    StatusPageAccessCopy.privateUsersPasswordNoticeAction,
    "Access",
    ...STATUS_PAGE_ACCESS_CHOICES.flatMap(
      (access: StatusPageAccess): Array<string> => {
        return [
          ACCESS_CHOICE_COPY[access].title,
          ACCESS_CHOICE_COPY[access].description,
          ACCESS_CONFIRMATION_COPY[access].title,
          ACCESS_CONFIRMATION_COPY[access].description,
          ACCESS_CONFIRMATION_COPY[access].submitButtonText,
        ];
      },
    ),
    ...Object.values(StatusPageRequireSsoCopy),
  ];

  const english: Record<string, unknown> = readLocale("en");

  // Words some languages write as English does ("Password" in Italian).
  const SAME_AS_ENGLISH_SOMEWHERE: Array<string> = [
    StatusPageAccessCopy.passwordFieldTitle,
  ];

  test("en.json has every string, as itself", () => {
    for (const text of strings) {
      const expected: string = text.endsWith("_one")
        ? StatusPageAccessCopy.privateUsers.one
        : text;

      expect([text, english[text]]).toEqual([text, expected]);
    }
  });

  test("the old wording's own keys are not kept for this page", () => {
    // A key written for the Access page's first wording, never on master.
    expect(
      english[
        "One IP address or CIDR range per line, IPv4 or IPv6, for example 203.0.113.7 or 10.0.0.0/8."
      ],
    ).toBeUndefined();
  });

  test.each(OTHER_LOCALES)("%s translates every one", (locale: string) => {
    const entries: Record<string, unknown> = readLocale(locale);

    for (const text of strings) {
      const value: unknown = entries[text];

      expect([text, typeof value]).toEqual([text, "string"]);

      if (!SAME_AS_ENGLISH_SOMEWHERE.includes(text)) {
        expect([text, value === english[text]]).toEqual([text, false]);
      }

      // Placeholders, and SSO and OIDC, keep their names.
      for (const kept of [
        "{{link}}",
        "{{count}}",
        "{{entry}}",
        "SSO",
        "OIDC",
      ]) {
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
