import escapeRegExp from "Common/Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY WAY A PERSON SIGNS IN TO ONEUPTIME, AND WHAT EACH DOES WHILE THE
 * WHOLE SERVER REQUIRES SINGLE SIGN-ON (#6116).
 *
 * Require SSO to Sign In (Admin Dashboard > Settings > Single Sign-On) makes
 * single sign-on the way in for everyone but master admins. Every way a
 * person signs in, or gets a session, is below with what it does then, and
 * the suites that drive it:
 *
 *   - a password (POST /identity/login: the sign-in page, and the master
 *     admins' /accounts/admin-login) and its second steps (an authenticator
 *     code, a security key, a backup code, a forced enrolment): refused,
 *     but for master admins;
 *   - a sign-in link: none is mailed, and one mailed before signs nobody
 *     in, but master admins;
 *   - a passkey, and the mobile app's passkey exchange: refused, but for
 *     master admins;
 *   - signing up, and claiming an invitation with a password: refused for
 *     everyone - an invited person signs in with SSO;
 *   - Continue with Google, Sign in with Microsoft and sign-in from Vercel:
 *     refused for everyone (master admins are asked for their password on
 *     these anyway);
 *   - single sign-on itself - a project's SAML or OpenID Connect provider,
 *     the server's own, in a browser or the mobile app: the way in;
 *   - renewing a session (POST /identity/refresh-token): renewed. Whether a
 *     session signed in with SSO is asked on every project request
 *     (UserAuthorization), so one that did not opens no project; a master
 *     admin signs all of those out at once from the Require SSO card;
 *   - a password reset and an address's verification: no session is handed
 *     out. A reset stays open - it is how a master admin who forgot their
 *     password gets back in - and a reset password still signs nobody else
 *     in;
 *   - an MCP client's OAuth grant: approved from a signed-in browser, and
 *     held to the SSO sign-in it was approved under, the server's
 *     requirement included (McpOAuthSso);
 *   - a private status page's readers: not OneUptime accounts, so the
 *     server's rule is not theirs - a status page requires SSO of its
 *     readers on its own;
 *   - API keys: let in. They are no person signing in, but a credential a
 *     project's admin made, scoped to that project and to the permissions
 *     given to it, which the admin revokes on their own; requiring SSO for
 *     them would break every integration while protecting no sign-in.
 *
 * This suite holds the code to that list: every call in the server that
 * mints a person's session, renews one or signs its token is in a file
 * below, as many times as listed, and every suite named exists. A new way
 * in fails here until it is decided, and pinned, for a server that
 * requires SSO.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const SCANNED_DIRECTORIES: Array<string> = [
  "packages/App/FeatureSet",
  "packages/Common/Server",
  "ee/Server",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Accounts",
  "AdminDashboard",
  "Dashboard",
  "StatusPage",
  "PublicDashboard",
  "Docs",
  "Home",
]);

// What mints, renews or signs a person's session.
const MINTING_CALLS: Array<string> = [
  "UserSessionService.createSession(",
  "UserSessionService.renewSessionWithNewRefreshToken(",
  "finalizeUserLogin(",
  "JSONWebToken.signUserLoginToken(",
  "CookieUtil.setUserCookie(",
  "StatusPagePrivateUserSessionService.createSession(",
  "StatusPagePrivateUserSessionService.renewSessionWithNewRefreshToken(",
];

interface WayIn {
  // The way in, as a person meets it.
  way: string;
  // What it does while the whole server requires SSO.
  whileSsoIsRequired: string;
  // The suites that drive it so, from the repository's root.
  pinnedBy: Array<string>;
}

interface MintingFile {
  // How many times the file makes each call.
  calls: Record<string, number>;
  ways: Array<WayIn>;
}

const IDENTITY_TESTS: string = "packages/App/Tests/FeatureSet/Identity";

const WAYS_IN: Record<string, MintingFile> = {
  "packages/App/FeatureSet/Identity/API/Authentication.ts": {
    calls: {
      // Once, in finalizeUserLogin, which every sign-in below ends in.
      "UserSessionService.createSession(": 1,
      // Passkey, the mobile passkey exchange, sign-up and login().
      "finalizeUserLogin(": 4,
      // The renewal, POST /refresh-token.
      "UserSessionService.renewSessionWithNewRefreshToken(": 1,
      "JSONWebToken.signUserLoginToken(": 2,
      "CookieUtil.setUserCookie(": 2,
    },
    ways: [
      {
        way: "A password, at the sign-in page or the master admins' /accounts/admin-login",
        whileSsoIsRequired: "Refused, but for master admins",
        pinnedBy: [`${IDENTITY_TESTS}/SsoRequiredSignInRoutes.test.ts`],
      },
      {
        way: "A second step: an authenticator code, a security key, a backup code, a forced enrolment",
        whileSsoIsRequired:
          "Refused, but for master admins, before its proof is checked",
        pinnedBy: [`${IDENTITY_TESTS}/SsoRequiredSignInRoutes.test.ts`],
      },
      {
        way: "A sign-in link",
        whileSsoIsRequired:
          "None is mailed, and one mailed before signs nobody in, but master admins",
        pinnedBy: [`${IDENTITY_TESTS}/MagicLinkLogin.test.ts`],
      },
      {
        way: "A passkey, and the mobile app's passkey exchange",
        whileSsoIsRequired: "Refused, but for master admins",
        pinnedBy: [`${IDENTITY_TESTS}/SsoRequiredSignInRoutes.test.ts`],
      },
      {
        way: "Signing up, and claiming an invitation with a password",
        whileSsoIsRequired: "Refused for everyone",
        pinnedBy: [`${IDENTITY_TESTS}/SsoRequiredSignInRoutes.test.ts`],
      },
      {
        way: "A password reset, and an address's verification",
        whileSsoIsRequired:
          "No session is handed out; a reset password still signs only a master admin in",
        pinnedBy: [`${IDENTITY_TESTS}/SsoRequiredSignInRoutes.test.ts`],
      },
      {
        way: "Renewing a session",
        whileSsoIsRequired:
          "Renewed; one that did not sign in with SSO opens no project, and a master admin signs those out",
        pinnedBy: [
          `${IDENTITY_TESTS}/SessionLengthRefresh.test.ts`,
          "packages/Common/Tests/Server/Services/UserSessionsWithoutSso.test.ts",
          "packages/Common/Tests/Server/API/GlobalConfigSessionsWithoutSsoRoutes.test.ts",
        ],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/Utils/ProviderSignIn.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
    },
    ways: [
      {
        way: "Continue with Google, Sign in with Microsoft",
        whileSsoIsRequired: "Refused for everyone",
        pinnedBy: [
          "packages/Common/Tests/App/Identity/GoogleSignInAPI.test.ts",
          "packages/Common/Tests/App/Identity/MicrosoftSignInAPI.test.ts",
        ],
      },
    ],
  },
  "ee/Server/CloudMarketplace/API/VercelSignIn.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
    },
    ways: [
      {
        way: "Sign-in from Vercel",
        whileSsoIsRequired:
          "Refused for everyone, before Vercel is asked anything",
        pinnedBy: [
          "ee/Tests/Server/CloudMarketplace/API/VercelSignInAPI.test.ts",
        ],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/API/SSO.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
      // The access token the mobile app is handed.
      "JSONWebToken.signUserLoginToken(": 1,
    },
    ways: [
      {
        way: "A project's SAML provider",
        whileSsoIsRequired: "The way in",
        pinnedBy: [`${IDENTITY_TESTS}/SamlSignInRoutes.test.ts`],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/API/OIDC.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
      // The access token the mobile app is handed.
      "JSONWebToken.signUserLoginToken(": 1,
    },
    ways: [
      {
        way: "A project's OpenID Connect provider",
        whileSsoIsRequired: "The way in",
        pinnedBy: [`${IDENTITY_TESTS}/OIDC.test.ts`],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/API/GlobalSSO.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
      // The access token the mobile app is handed.
      "JSONWebToken.signUserLoginToken(": 1,
    },
    ways: [
      {
        way: "The server's own SAML provider, in a browser or the mobile app",
        whileSsoIsRequired: "The way in",
        pinnedBy: [`${IDENTITY_TESTS}/MobileSso.test.ts`],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/API/GlobalOIDC.ts": {
    calls: {
      "UserSessionService.createSession(": 1,
      "CookieUtil.setUserCookie(": 1,
      // The access token the mobile app is handed.
      "JSONWebToken.signUserLoginToken(": 1,
    },
    ways: [
      {
        way: "The server's own OpenID Connect provider, in a browser or the mobile app",
        whileSsoIsRequired: "The way in",
        pinnedBy: [`${IDENTITY_TESTS}/MobileSso.test.ts`],
      },
    ],
  },
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts": {
    calls: {
      "StatusPagePrivateUserSessionService.createSession(": 1,
      "StatusPagePrivateUserSessionService.renewSessionWithNewRefreshToken(": 1,
    },
    ways: [
      {
        way: "A private status page's reader",
        whileSsoIsRequired:
          "Not a OneUptime account: the status page's own SSO rule applies",
        pinnedBy: [`${IDENTITY_TESTS}/StatusPageSsoEnforcement.test.ts`],
      },
    ],
  },
  "packages/Common/Server/Utils/Cookie.ts": {
    calls: {
      // The token setUserCookie writes, for every way in above.
      "JSONWebToken.signUserLoginToken(": 1,
    },
    ways: [],
  },
};

// Not a session at all, and decided: what a request with one does.
const NOT_A_SIGN_IN: Array<WayIn> = [
  {
    way: "An API key",
    whileSsoIsRequired:
      "Let in: no person signing in, but a project's own credential",
    pinnedBy: [
      "packages/Common/Tests/Server/Middleware/ProjectAuthorizationApiKeyMiddleware.test.ts",
    ],
  },
  {
    way: "An MCP client's OAuth grant",
    whileSsoIsRequired:
      "Held to the SSO sign-in it was approved under, the server's requirement included",
    pinnedBy: ["packages/Common/Tests/Server/Utils/Mcp/McpOAuthSso.test.ts"],
  },
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        files.push(...sourceFilesUnder(full));
      }
      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// Comments out, so a sentence naming a call is no call.
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// How many times `call` is made: a name of its own, not the end of a longer one.
function countOf(code: string, call: string): number {
  return (
    code.match(new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(call)}`, "g")) || []
  ).length;
}

// Every file that makes one of the calls, and how many times it makes each.
function scanMintingCalls(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {};

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFilesUnder(
      path.join(REPOSITORY_ROOT, directory),
    )) {
      const code: string = codeOf(fs.readFileSync(file, "utf8"));
      const calls: Record<string, number> = {};

      for (const call of MINTING_CALLS) {
        const count: number = countOf(code, call);

        if (count > 0) {
          calls[call] = count;
        }
      }

      if (Object.keys(calls).length > 0) {
        found[path.relative(REPOSITORY_ROOT, file)] = calls;
      }
    }
  }

  return found;
}

// The files of the list there are in this checkout (ee/ may be moved aside).
function listedInThisCheckout(): Record<string, Record<string, number>> {
  const listed: Record<string, Record<string, number>> = {};

  for (const [file, entry] of Object.entries(WAYS_IN)) {
    if (fs.existsSync(path.join(REPOSITORY_ROOT, file))) {
      listed[file] = entry.calls;
    }
  }

  return listed;
}

describe("every way into OneUptime is decided for a server that requires SSO", () => {
  test("every call that mints, renews or signs a person's session is listed, as many times as it is made", () => {
    expect(scanMintingCalls()).toEqual(listedInThisCheckout());
  });

  test("every way in says what it does while SSO is required, and is pinned by a suite that exists", () => {
    const ways: Array<WayIn> = [
      ...Object.entries(WAYS_IN)
        .filter(([file]: [string, MintingFile]): boolean => {
          return fs.existsSync(path.join(REPOSITORY_ROOT, file));
        })
        .flatMap(([, entry]: [string, MintingFile]): Array<WayIn> => {
          return entry.ways;
        }),
      ...NOT_A_SIGN_IN,
    ];

    for (const way of ways) {
      expect(way.whileSsoIsRequired.length).toBeGreaterThan(0);

      for (const suite of way.pinnedBy) {
        // An Enterprise suite is pinned where ee/ is checked out.
        if (
          suite.startsWith("ee/") &&
          !fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))
        ) {
          continue;
        }

        expect({
          way: way.way,
          suite,
          exists: fs.existsSync(path.join(REPOSITORY_ROOT, suite)),
        }).toEqual({
          way: way.way,
          suite,
          exists: true,
        });
      }
    }
  });

  test("the scan sees a call it was not told about (negative control)", () => {
    const code: string = codeOf(
      "const a = await UserSessionService.createSession({});\n// UserSessionService.createSession( in a comment\nawait StatusPagePrivateUserSessionService.createSession({});\n",
    );

    expect(countOf(code, "UserSessionService.createSession(")).toBe(1);
    expect(
      countOf(code, "StatusPagePrivateUserSessionService.createSession("),
    ).toBe(1);
  });

  test("every non-SSO sign-in a password, link or passkey makes asks the rule, in the file the list names", () => {
    const authentication: string = codeOf(
      fs.readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/App/FeatureSet/Identity/API/Authentication.ts",
        ),
        "utf8",
      ),
    );

    // The passkey, the mobile exchange and login() - every stage - assert it; sign-up asks its own.
    expect(
      countOf(authentication, "SsoRequiredSignIn.assertNonSsoSignInAllowed("),
    ).toBe(3);
    expect(
      countOf(authentication, "SsoRequiredSignIn.assertSignUpAllowed("),
    ).toBe(1);
    // A sign-in link is mailed only to whom the rule lets sign in.
    expect(
      countOf(authentication, "SsoRequiredSignIn.isNonSsoSignInRefused("),
    ).toBe(1);
  });
});
