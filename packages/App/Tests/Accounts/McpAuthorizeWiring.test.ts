import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import { KNOWN_DISPLAY_ERROR_CODES } from "../../FeatureSet/Accounts/src/Utils/McpAuthorize";
import { AccountsRoute, DashboardRoute } from "Common/ServiceRoute";
import McpOAuthPendingAuthorization, {
  MCP_AUTHORIZE_ROUTE,
} from "Common/UI/Utils/McpOAuthPendingAuthorization";

/*
 * ---------------------------------------------------------------------------
 * THE MCP CONSENT SCREEN, WIRED INTO EVERYTHING AROUND IT.
 *
 * /accounts/mcp-authorize is one page with four neighbours it has to agree
 * with, and each disagreement is silent:
 *
 *  - THE ROUTE. The authorization endpoint redirects the browser to a URL the
 *    SERVER builds (McpOAuthConfig.getConsentPageUrl) and the dashboard sends
 *    it back to one Common builds (McpOAuthPendingAuthorization). If the
 *    Accounts router registers a different path, both land on Accounts' own
 *    "page not found" and nobody can connect a client - with every unit test
 *    on either side still green.
 *  - THE THREE API URLS. The consent endpoints are mounted under /mcp/oauth,
 *    beside the rest of the authorization server, NOT under /api. The page's
 *    URL constants and the server's route table have to spell the same paths.
 *  - WHAT THE PAGE SENDS. `request`, `projectId` and `access` are read by name
 *    on the server, and `access` is one of two exact words.
 *  - THE WORDS. The page renders through i18next, which answers a missing key
 *    with the dotted path itself. A consent screen that says
 *    "mcpAuthorize.loopbackWarning" where the warning should be has not
 *    warned anybody. Two of the page's lookups are built at runtime
 *    (`errors.<code>` and `projectRefusal.<reason>`), so the keys they can
 *    reach are derived here rather than found by a search.
 *
 * THE LOCALES ARE CHECKED FOR SHAPE, NEVER FOR WORDING. All seventeen files
 * carry the section; what must hold in every one of them is that it has
 * exactly en.json's keys, in en.json's order, with en.json's placeholders. A
 * translator moving `{{clientName}}` within a sentence is expected; dropping
 * it prints the sentence without the client's name, and inventing one prints
 * the braces.
 *
 * Nothing is imported from the page: this suite is plain node with no React
 * renderer, and ApiPaths.ts reads Common/UI/Config, which reads `window` at
 * module load. The files are read off disk, comments stripped, exactly as
 * BackupCodeLoginWiring.test.ts does. The page is rendered for real in
 * Common/Tests/App/Accounts/McpAuthorizePage.test.tsx, which also resolves
 * the three URL constants to their final values. The one module that IS
 * loaded is the pending-request helper, for the route it builds: it touches
 * the browser only when it is called.
 * ---------------------------------------------------------------------------
 */

const REPO_PACKAGES: string = nodePath.join(__dirname, "..", "..", "..");

const ACCOUNTS_SRC: string = nodePath.join(
  REPO_PACKAGES,
  "App",
  "FeatureSet",
  "Accounts",
  "src",
);

const LOCALES_DIR: string = nodePath.join(ACCOUNTS_SRC, "Locales");

type ReadCodeFunction = (...segments: Array<string>) => string;

/*
 * Comments out, whitespace collapsed: the prose in these files describes the
 * very things asserted below, and prettier re-wraps the long declarations.
 */
const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(nodePath.join(REPO_PACKAGES, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

const appSource: string = readCode(
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "App.tsx",
);
const pageSource: string = readCode(
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Pages",
  "McpAuthorize.tsx",
);
const apiPathsSource: string = readCode(
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Utils",
  "ApiPaths.ts",
);
const oauthRoutesSource: string = readCode(
  "App",
  "FeatureSet",
  "MCP",
  "OAuth",
  "OAuthRoutes.ts",
);
const consentEndpointSource: string = readCode(
  "App",
  "FeatureSet",
  "MCP",
  "OAuth",
  "ConsentEndpoint.ts",
);
const serverConfigSource: string = readCode(
  "Common",
  "Server",
  "Utils",
  "Mcp",
  "McpOAuthConfig.ts",
);
const pendingAuthorizationSource: string = readCode(
  "Common",
  "UI",
  "Utils",
  "McpOAuthPendingAuthorization.ts",
);
const cookieNameSource: string = readCode("Common", "Types", "CookieName.ts");

type CountOccurrencesFunction = (source: string, needle: string) => number;

const countOccurrences: CountOccurrencesFunction = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

type DeclarationAfterFunction = (source: string, marker: string) => string;

// A flat `const X: T = ...;` statement, bounded by its semicolon.
const declarationAfter: DeclarationAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const endIndex: number = source.indexOf(";", markerIndex);

  if (endIndex === -1) {
    throw new Error(`Declaration is not terminated: ${marker}`);
  }

  return source.slice(markerIndex, endIndex + 1);
};

type MatchAllFunction = (
  source: string,
  pattern: RegExp,
) => Array<RegExpExecArray>;

const matchAll: MatchAllFunction = (
  source: string,
  pattern: RegExp,
): Array<RegExpExecArray> => {
  const matches: Array<RegExpExecArray> = [];
  const global: RegExp = new RegExp(pattern.source, "g");

  let match: RegExpExecArray | null = global.exec(source);

  while (match) {
    matches.push(match);
    match = global.exec(source);
  }

  return matches;
};

const CONSENT_PAGE_PATH: string = "/accounts/mcp-authorize";

// The name of the cookie a pending request waits in, as Common declares it.
const COOKIE_NAME_DECLARATION: RegExp =
  /const COOKIE_NAME: string = "([^"]+)";/;

// Any request helper other than post (API.getFriendlyMessage is not one).
const OTHER_API_REQUEST: RegExp = /\bAPI\.(get|put|delete|patch|fetch)[<(]/;

describe("the consent screen's route", () => {
  test("is registered in the Accounts router", () => {
    expect(appSource).toMatch(
      /<Route path="\/accounts\/mcp-authorize" element=\{<McpAuthorizePage \/>\} \/>/,
    );

    // One registration; a second with another element would shadow it.
    expect(countOccurrences(appSource, `path="${CONSENT_PAGE_PATH}"`)).toBe(1);
  });

  test("is matched before the not-found catch-all", () => {
    const routeIndex: number = appSource.indexOf(`path="${CONSENT_PAGE_PATH}"`);
    const catchAllIndex: number = appSource.indexOf('<Route path="*"');

    expect(routeIndex).toBeGreaterThan(-1);
    expect(catchAllIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeLessThan(catchAllIndex);
  });

  test("the page is lazy-loaded, like every other Accounts page", () => {
    expect(appSource).toMatch(
      /const McpAuthorizePage: React\.LazyExoticComponent<\(\) => JSX\.Element> = lazy\( ?\(\) => \{ return import\("\.\/Pages\/McpAuthorize"\); \}, ?\);/,
    );

    /*
     * A static import would put the consent screen - and everything it pulls
     * in - into the bundle every sign-in page loads.
     */
    expect(appSource).not.toMatch(
      /import [^;]* from "\.\/Pages\/McpAuthorize"/,
    );
    expect(appSource).not.toMatch(/import [^;]* from "\.\/Pages\/[A-Za-z]+";/);
  });

  test("is the path the server sends the browser to", () => {
    /*
     * The authorization endpoint redirects to getConsentPageUrl(); the path
     * half of that URL is written once on the server and once in the router.
     */
    expect(serverConfigSource).toMatch(
      /getConsentPageUrl\(\): string \{ return `\$\{McpOAuthConfig\.getOrigin\(\)\}\/accounts\/mcp-authorize`; \}/,
    );
  });

  test("is the path the dashboard sends the browser back to after a sign-in", () => {
    const ticket: string = `v1.cGF5bG9hZA.${"s".repeat(43)}`;

    expect(MCP_AUTHORIZE_ROUTE).toBe(CONSENT_PAGE_PATH);
    expect(
      McpOAuthPendingAuthorization.getConsentRoute(ticket).toString(),
    ).toBe(`${CONSENT_PAGE_PATH}?request=${ticket}`);

    // Built on the Accounts app's own base path, like the router's entries.
    expect(AccountsRoute.toString()).toBe("/accounts");
    expect(CONSENT_PAGE_PATH.startsWith(`${AccountsRoute.toString()}/`)).toBe(
      true,
    );
  });

  test("the page reads the request from the query parameter those two write", () => {
    expect(pageSource).toContain('Navigation.getQueryStringByName("request")');
    expect(pageSource).toContain('Navigation.getQueryStringByName("error")');

    // And the server writes the same two names onto the consent page URL.
    const authorizationRequestSource: string = readCode(
      "App",
      "FeatureSet",
      "MCP",
      "OAuth",
      "AuthorizationRequest.ts",
    );

    expect(authorizationRequestSource).toContain(
      'url.searchParams.set("request", ticket)',
    );
    expect(authorizationRequestSource).toContain(
      'url.searchParams.set("error", code)',
    );
  });
});

describe("the request survives a sign-in", () => {
  test("the page remembers it before asking the server anything", () => {
    /*
     * The first call is what finds out there is no session, and the API
     * client is already on its way to the sign-in page by the time it
     * answers. A request remembered after that is remembered too late.
     */
    const rememberIndex: number = pageSource.indexOf(
      "McpOAuthPendingAuthorization.remember(request)",
    );
    const loadIndex: number = pageSource.indexOf("loadDetails(request)");

    expect(rememberIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeGreaterThan(-1);
    expect(rememberIndex).toBeLessThan(loadIndex);
  });

  test("the cookie it waits in is not one the sign-out sweep removes", () => {
    /*
     * Being sent to the sign-in page logs the visitor out, which removes
     * exactly the cookies named in the CookieName enum. The pending request
     * has to outlive that, so its name must never be added there.
     */
    const cookieName: RegExpExecArray | null = COOKIE_NAME_DECLARATION.exec(
      pendingAuthorizationSource,
    );

    expect(cookieName).not.toBeNull();
    expect(cookieName![1]).toBe("oneuptime-mcp-oauth-pending-request");
    expect(cookieNameSource).not.toContain(cookieName![1]!);
    expect(cookieNameSource).not.toMatch(/mcp/i);
  });

  test("the cookie is the dashboard's: written for the path its only reader is served under", () => {
    /*
     * The page writes the cookie but is not where it is read. On the way to
     * the sign-in page the browser calls the identity endpoints, and the
     * server answers those by clearing every cookie the request carried - so
     * a cookie for "/" is gone before anybody signs in. One for the
     * dashboard's path is never sent to them, and the dashboard is exactly
     * where the request is picked up (Dashboard/src/App.tsx, through
     * Utils/McpAuthorizationResume).
     */
    expect(DashboardRoute.toString()).toBe("/dashboard");

    expect(pendingAuthorizationSource).toContain(
      "const COOKIE_PATH: string = DashboardRoute.toString();",
    );

    // Written and removed with that path, and with no other.
    expect(countOccurrences(pendingAuthorizationSource, "path:")).toBe(2);
    expect(
      countOccurrences(pendingAuthorizationSource, "path: COOKIE_PATH"),
    ).toBe(2);
    expect(pendingAuthorizationSource).not.toContain('path: "/"');
  });
});

describe("the consent screen's API calls", () => {
  test("the server mounts the consent endpoints under /mcp/oauth/consent", () => {
    expect(oauthRoutesSource).toContain(
      'export const MCP_OAUTH_PATH: string = "/mcp/oauth";',
    );
    expect(oauthRoutesSource).toContain(
      "export const MCP_OAUTH_CONSENT_PATH: string = `${MCP_OAUTH_PATH}/consent`;",
    );

    for (const action of ["details", "approve", "deny"]) {
      expect(oauthRoutesSource).toMatch(
        new RegExp(
          `app\\.post\\( ?\`\\$\\{MCP_OAUTH_CONSENT_PATH\\}/${action}\`, \\.\\.\\.consent, ConsentEndpoint\\.${action},? ?\\)`,
        ),
      );
    }
  });

  test("the page's URLs are built on the same base path, off the API's own origin", () => {
    const base: string = declarationAfter(
      apiPathsSource,
      "const MCP_OAUTH_CONSENT_URL",
    );

    expect(base).toMatch(
      /const MCP_OAUTH_CONSENT_URL: URL = new URL\( ?APP_API_URL\.protocol, APP_API_URL\.hostname, new Route\("\/mcp\/oauth\/consent"\),? ?\);/,
    );

    /*
     * NOT `URL.fromURL(APP_API_URL)`: that carries the API's /api route with
     * it, and /api/mcp/oauth/consent is a path nothing serves.
     */
    expect(base).not.toContain("URL.fromURL(APP_API_URL)");
    expect(base).not.toContain("IDENTITY_URL");
    expect(base).not.toContain('"/api');
  });

  test.each([
    ["MCP_OAUTH_CONSENT_DETAILS_API_URL", "/details"],
    ["MCP_OAUTH_CONSENT_APPROVE_API_URL", "/approve"],
    ["MCP_OAUTH_CONSENT_DENY_API_URL", "/deny"],
  ])("%s adds %s to that base", (constant: string, route: string) => {
    const declaration: string = declarationAfter(
      apiPathsSource,
      `export const ${constant}`,
    );

    expect(declaration).toBe(
      `export const ${constant}: URL = URL.fromURL( MCP_OAUTH_CONSENT_URL, ).addRoute(new Route("${route}"));`,
    );
    expect(countOccurrences(apiPathsSource, `new Route("${route}")`)).toBe(1);
  });

  test("the page imports all three and posts to each", () => {
    expect(pageSource).toMatch(
      /import \{ MCP_OAUTH_CONSENT_APPROVE_API_URL, MCP_OAUTH_CONSENT_DENY_API_URL, MCP_OAUTH_CONSENT_DETAILS_API_URL, \} from "\.\.\/Utils\/ApiPaths";/,
    );

    expect(pageSource).toContain(
      "url: URL.fromURL(MCP_OAUTH_CONSENT_DETAILS_API_URL)",
    );
    expect(pageSource).toMatch(
      /decision === "approve" \? MCP_OAUTH_CONSENT_APPROVE_API_URL : MCP_OAUTH_CONSENT_DENY_API_URL/,
    );

    // Two requests in the page: load, and decide. Nothing else leaves it.
    expect(countOccurrences(pageSource, "API.post<JSONObject>(")).toBe(2);
    expect(countOccurrences(pageSource, "API.post")).toBe(2);
    expect(pageSource).not.toMatch(OTHER_API_REQUEST);
    expect(pageSource).not.toContain("fetch(");
    expect(pageSource).not.toContain("XMLHttpRequest");
  });

  test("the fields the page sends are the fields the server reads", () => {
    expect(pageSource).toContain("data: { request }");
    expect(pageSource).toMatch(
      /decision === "approve" \? \{ request: ticket, projectId, access \} : \{ request: ticket \}/,
    );

    for (const field of ["request", "projectId", "access"]) {
      expect(consentEndpointSource).toContain(
        `(req.body as JSONObject)?.["${field}"]`,
      );
    }
  });

  test("the two access levels are the server's two words", () => {
    const pageUtilSource: string = readCode(
      "App",
      "FeatureSet",
      "Accounts",
      "src",
      "Utils",
      "McpAuthorize.ts",
    );

    expect(pageUtilSource).toContain(
      'export type McpConsentAccess = "read" | "write";',
    );
    expect(consentEndpointSource).toMatch(
      /export enum ConsentAccessLevel \{ ReadOnly = "read", ReadAndWrite = "write", \}/,
    );
  });

  test("the page navigates with the address the server answered, and only after checking it", () => {
    const checkIndex: number = pageSource.indexOf(
      "McpAuthorizeUtil.isSafeRedirectUrl(redirectUrl)",
    );
    const assignIndex: number = pageSource.indexOf(
      "window.location.assign(redirectUrl)",
    );

    expect(pageSource).toContain(
      'const redirectUrl: unknown = response.data["redirectUrl"];',
    );
    expect(checkIndex).toBeGreaterThan(-1);
    expect(assignIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(assignIndex);

    // The one navigation off this page, and it is not built from the URL bar.
    expect(countOccurrences(pageSource, "window.location")).toBe(1);
    expect(pageSource).not.toContain("location.href");
    expect(pageSource).not.toContain("window.open");
    expect(pageSource).not.toContain("dangerouslySetInnerHTML");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE WORDS
 * ---------------------------------------------------------------------------
 */

const SECTION: string = "mcpAuthorize";

const ALL_LOCALES: Array<string> = [
  "da",
  "de",
  "en",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const localeCache: Map<string, Record<string, unknown>> = new Map<
  string,
  Record<string, unknown>
>();

type ReadLocaleFunction = (code: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  code: string,
): Record<string, unknown> => {
  const cached: Record<string, unknown> | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const parsed: Record<string, unknown> = JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;

  localeCache.set(code, parsed);

  return parsed;
};

type FlattenFunction = (
  node: unknown,
  prefix: string,
) => Array<[string, unknown]>;

/*
 * Leaf paths and their values, in file order. JSON.parse keeps the order the
 * keys were written in, which is what lets "same order as en.json" be
 * checked at all.
 */
const flatten: FlattenFunction = (
  node: unknown,
  prefix: string,
): Array<[string, unknown]> => {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return [[prefix, node]];
  }

  const leaves: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    leaves.push(...flatten(value, prefix ? `${prefix}.${key}` : key));
  }

  return leaves;
};

type SectionLeavesFunction = (code: string) => Array<[string, unknown]>;

const sectionLeaves: SectionLeavesFunction = (
  code: string,
): Array<[string, unknown]> => {
  return flatten(readLocale(code)[SECTION], "");
};

type SectionKeysFunction = (code: string) => Array<string>;

const sectionKeys: SectionKeysFunction = (code: string): Array<string> => {
  return sectionLeaves(code).map((leaf: [string, unknown]): string => {
    return leaf[0];
  });
};

const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/;

type PlaceholdersFunction = (value: unknown) => Array<string>;

const placeholdersOf: PlaceholdersFunction = (
  value: unknown,
): Array<string> => {
  if (typeof value !== "string") {
    return [];
  }

  return matchAll(value, PLACEHOLDER)
    .map((match: RegExpExecArray): string => {
      return match[1]!;
    })
    .sort();
};

/*
 * `t("mcpAuthorize.key")` and `t("mcpAuthorize.key", { a: ..., b: ... })`,
 * with the names of the values the page passes.
 */
const STATIC_LOOKUP: RegExp =
  /\bt\(\s*"mcpAuthorize\.([A-Za-z0-9_.-]+)"\s*(?:,\s*\{([^{}]*)\})?\s*,?\s*\)/;

// t(`mcpAuthorize.<family>.${...}`, { a: ... })
const FAMILY_LOOKUP: RegExp =
  /\bt\(\s*`mcpAuthorize\.([A-Za-z]+)\.\$\{[^`]*`\s*(?:,\s*\{([^{}]*)\})?\s*,?\s*\)/;

const OPTION_NAME: RegExp = /([A-Za-z_][A-Za-z0-9_]*)\s*:/;

type OptionNamesFunction = (options: string | undefined) => Array<string>;

const optionNames: OptionNamesFunction = (
  options: string | undefined,
): Array<string> => {
  return matchAll(options || "", OPTION_NAME)
    .map((match: RegExpExecArray): string => {
      return match[1]!;
    })
    .sort();
};

interface PageLookups {
  // key (relative to the section) -> names of the values passed with it
  staticKeys: Map<string, Array<string>>;
  // family (e.g. "errors") -> names of the values passed with it
  families: Map<string, Array<string>>;
}

type PageLookupsFunction = () => PageLookups;

const pageLookups: PageLookupsFunction = (): PageLookups => {
  const staticKeys: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const families: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const match of matchAll(pageSource, STATIC_LOOKUP)) {
    staticKeys.set(match[1]!, optionNames(match[2]));
  }

  for (const match of matchAll(pageSource, FAMILY_LOOKUP)) {
    families.set(match[1]!, optionNames(match[2]));
  }

  return { staticKeys, families };
};

// Every error code the page can end up asking the locale for.
type ReachableErrorCodesFunction = () => Array<string>;

const reachableErrorCodes: ReachableErrorCodesFunction = (): Array<string> => {
  const codes: Set<string> = new Set<string>(KNOWN_DISPLAY_ERROR_CODES);

  // The codes the page sets itself: `{ kind: "error", code: "..." }`.
  for (const match of matchAll(
    pageSource,
    /kind: "error", code: "([a-z_]+)"/,
  )) {
    codes.add(match[1]!);
  }

  return [...codes].sort();
};

const PROJECT_REFUSALS: Array<string> = [
  "blocked",
  "not-a-member",
  "plan",
  "sso",
];

describe("the keys the consent screen asks for", () => {
  test("the scan found the page's lookups", () => {
    /*
     * Paired with every assertion below: a pattern that stopped matching
     * would let "every key the page uses exists" pass over an empty list.
     */
    const lookups: PageLookups = pageLookups();

    expect(lookups.staticKeys.size).toBeGreaterThanOrEqual(25);
    expect([...lookups.families.keys()].sort()).toEqual([
      "errors",
      "projectRefusal",
    ]);

    // Every lookup on the page was understood by one of the two patterns.
    expect(countOccurrences(pageSource, '"mcpAuthorize.')).toBe(
      matchAll(pageSource, STATIC_LOOKUP).length,
    );
    expect(countOccurrences(pageSource, "`mcpAuthorize.")).toBe(
      matchAll(pageSource, FAMILY_LOOKUP).length,
    );
  });

  test("the page sets three error codes of its own, and wraps the URL's in the allow-list", () => {
    /*
     * "missing_request" and "framed" are the page's own verdicts and are in
     * no allow-list: neither can be put on the screen through the address.
     */
    expect(reachableErrorCodes()).toEqual(
      [...KNOWN_DISPLAY_ERROR_CODES, "framed", "missing_request"].sort(),
    );
    expect(KNOWN_DISPLAY_ERROR_CODES).not.toContain("framed");
    expect(KNOWN_DISPLAY_ERROR_CODES).not.toContain("missing_request");

    /*
     * The code from `?error=` reaches the locale lookup only through
     * toDisplayErrorCode. Without it, a link's author chooses the key - and
     * i18next prints a key it cannot find, so they would choose the text too.
     */
    expect(pageSource).toContain(
      "code: McpAuthorizeUtil.toDisplayErrorCode(errorCode)",
    );
    expect(countOccurrences(pageSource, "errorCode")).toBe(3);
  });

  test("a project's refusal reaches the locale lookup only through its allow-list", () => {
    expect(pageSource).toContain(
      "`mcpAuthorize.projectRefusal.${McpAuthorizeUtil.toProjectRefusalKey(project.refusal)}`",
    );
    expect(countOccurrences(pageSource, "project.refusal")).toBe(1);
  });

  test("every key the page asks for is in en.json", () => {
    const english: Set<string> = new Set<string>(sectionKeys("en"));
    const lookups: PageLookups = pageLookups();
    const missing: Array<string> = [];

    for (const key of lookups.staticKeys.keys()) {
      if (!english.has(key)) {
        missing.push(key);
      }
    }

    for (const code of reachableErrorCodes()) {
      if (!english.has(`errors.${code}`)) {
        missing.push(`errors.${code}`);
      }
    }

    for (const refusal of PROJECT_REFUSALS) {
      if (!english.has(`projectRefusal.${refusal}`)) {
        missing.push(`projectRefusal.${refusal}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("en.json carries no key the page never asks for", () => {
    /*
     * The section exists only to be rendered by this page. A key nothing
     * asks for is copy sixteen translators will be asked to translate for
     * nobody - and usually the fingerprint of a rename done on one side.
     */
    const lookups: PageLookups = pageLookups();
    const asked: Set<string> = new Set<string>([
      ...lookups.staticKeys.keys(),
      ...reachableErrorCodes().map((code: string): string => {
        return `errors.${code}`;
      }),
      ...PROJECT_REFUSALS.map((refusal: string): string => {
        return `projectRefusal.${refusal}`;
      }),
    ]);

    expect(
      sectionKeys("en").filter((key: string): boolean => {
        return !asked.has(key);
      }),
    ).toEqual([]);
  });

  test("each English string interpolates exactly the values the page passes with it", () => {
    /*
     * A placeholder the page does not fill is printed with its braces; a
     * value the string never uses is a sentence missing the client's name,
     * the project's name or the address it is about.
     */
    const lookups: PageLookups = pageLookups();
    const problems: Array<string> = [];

    for (const [key, value] of sectionLeaves("en")) {
      const family: string | undefined = key.includes(".")
        ? key.split(".")[0]
        : undefined;

      const passed: Array<string> | undefined = family
        ? lookups.families.get(family)
        : lookups.staticKeys.get(key);

      if (
        JSON.stringify(placeholdersOf(value)) !== JSON.stringify(passed || [])
      ) {
        problems.push(
          `${key}: string uses [${placeholdersOf(value).join(", ")}], page passes [${(passed || []).join(", ")}]`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("the strings that name something are the ones expected to", () => {
    // The derived check above, pinned for the five that carry a value.
    const english: Map<string, unknown> = new Map<string, unknown>(
      sectionLeaves("en"),
    );

    expect(placeholdersOf(english.get("wantsAccess"))).toEqual(["clientName"]);
    expect(placeholdersOf(english.get("redirecting"))).toEqual(["clientName"]);
    expect(placeholdersOf(english.get("redirectToHost"))).toEqual(["target"]);
    expect(placeholdersOf(english.get("redirectToThisDevice"))).toEqual([
      "target",
    ]);
    expect(placeholdersOf(english.get("signedInAs"))).toEqual(["email"]);

    for (const refusal of PROJECT_REFUSALS) {
      expect(placeholdersOf(english.get(`projectRefusal.${refusal}`))).toEqual([
        "name",
      ]);
    }
  });
});

describe("the consent screen's section in every locale", () => {
  test("all seventeen locale files are being looked at", () => {
    expect(
      fs
        .readdirSync(LOCALES_DIR)
        .filter((fileName: string): boolean => {
          return fileName.endsWith(".json");
        })
        .sort(),
    ).toEqual(
      ALL_LOCALES.map((code: string): string => {
        return `${code}.json`;
      }).sort(),
    );
  });

  test("en.json's section is not empty, so the comparisons below are not vacuous", () => {
    expect(sectionKeys("en").length).toBeGreaterThanOrEqual(40);
  });

  test.each(ALL_LOCALES)(
    "%s.json has the section, as an object",
    (code: string) => {
      const section: unknown = readLocale(code)[SECTION];

      expect(typeof section).toBe("object");
      expect(section).not.toBeNull();
      expect(Array.isArray(section)).toBe(false);
    },
  );

  test.each(ALL_LOCALES)(
    "%s.json has exactly en.json's keys, in en.json's order",
    (code: string) => {
      expect(sectionKeys(code)).toEqual(sectionKeys("en"));
    },
  );

  test.each(ALL_LOCALES)(
    "%s.json has a non-empty string for every key",
    (code: string) => {
      const problems: Array<string> = [];

      for (const [key, value] of sectionLeaves(code)) {
        if (typeof value !== "string") {
          problems.push(`${key} is not a string`);
          continue;
        }

        if (value.trim().length === 0) {
          problems.push(`${key} is blank`);
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(ALL_LOCALES)(
    "%s.json interpolates the same values as en.json, key for key",
    (code: string) => {
      const english: Map<string, unknown> = new Map<string, unknown>(
        sectionLeaves("en"),
      );
      const problems: Array<string> = [];

      for (const [key, value] of sectionLeaves(code)) {
        const expected: Array<string> = placeholdersOf(english.get(key));
        const actual: Array<string> = placeholdersOf(value);

        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          problems.push(
            `${key}: has [${actual.join(", ")}], en.json has [${expected.join(", ")}]`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(ALL_LOCALES)(
    "%s.json has wording for every error code and every refusal",
    (code: string) => {
      const keys: Set<string> = new Set<string>(sectionKeys(code));
      const missing: Array<string> = [];

      for (const errorCode of reachableErrorCodes()) {
        if (!keys.has(`errors.${errorCode}`)) {
          missing.push(`errors.${errorCode}`);
        }
      }

      for (const refusal of PROJECT_REFUSALS) {
        if (!keys.has(`projectRefusal.${refusal}`)) {
          missing.push(`projectRefusal.${refusal}`);
        }
      }

      expect(missing).toEqual([]);
    },
  );

  test.each(ALL_LOCALES)(
    "%s.json keeps markup out of the section",
    (code: string) => {
      /*
       * Every one of these strings is rendered as text. A tag in one would
       * be shown to the member literally, angle brackets and all.
       */
      const TAG: RegExp = /<\/?[A-Za-z][^>]*>/;
      const problems: Array<string> = [];

      for (const [key, value] of sectionLeaves(code)) {
        if (typeof value === "string" && TAG.test(value)) {
          problems.push(key);
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
