import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * EVERY SAML REPLY URL HOLDS A RESPONSE TO ITS OWN PROVIDER, AND USES IT ONCE.
 *
 * SamlSignInRoutes.test.ts runs the three SAML Reply URLs that exist today.
 * This guard reads the source, so the rule also holds for the next one:
 *
 *   - whatever verifies a SAML response passes SSOUtil.getSamlResponseFromXML
 *     the Entity ID and Reply URL of the provider the route is for, built by
 *     SamlServiceProviders for that kind of provider;
 *   - it claims the assertion (SamlAssertionOneTimeUse.claim, with its own
 *     provider kind) after the issuer check and before anyone is looked up;
 *   - the sign-in it starts asks the identity provider for those same two
 *     values, from the same builder - no route spells the URLs out itself;
 *   - and the Dashboard and Admin Dashboard still show admins those values in
 *     the shape the builder makes them. An identity provider writes back what
 *     it was given; if the screens and the server disagreed, every sign-in
 *     through every provider would be refused.
 * ---------------------------------------------------------------------------
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const IDENTITY_DIR: string = path.join(PACKAGES_DIR, "App/FeatureSet/Identity");
const API_DIR: string = path.join(IDENTITY_DIR, "API");

interface SamlRoute {
  file: string;
  builder: string;
  providerKind: string;
  // The provider record the route's lookup found, which the use is kept under.
  storedProviderId: string;
  // What the route looks the signing-in person up with.
  firstLookup: string;
  // The route that starts a sign-in, and the one the IdP posts to.
  startRoute: string;
  replyRoute: string;
}

const SAML_ROUTES: Array<SamlRoute> = [
  {
    file: "SSO.ts",
    builder: "SamlServiceProviders.forProjectSso(",
    providerKind: "SamlProviderKind.ProjectSso",
    storedProviderId: "projectSSO.id!",
    firstLookup: "UserService.findOneBy(",
    startRoute: '"/sso/:projectId/:projectSsoId"',
    replyRoute: '"/idp-login/:projectId/:projectSsoId"',
  },
  {
    file: "GlobalSSO.ts",
    builder: "SamlServiceProviders.forGlobalSso(",
    providerKind: "SamlProviderKind.GlobalSso",
    storedProviderId: "globalSso.id!",
    firstLookup: "GlobalSSOProjectService.findBy(",
    startRoute: '"/global-sso/:globalSsoId"',
    replyRoute: '"/global-idp-login/:globalSsoId"',
  },
  {
    file: "StatusPageSSO.ts",
    builder: "SamlServiceProviders.forStatusPageSso(",
    providerKind: "SamlProviderKind.StatusPageSso",
    storedProviderId: "statusPageSSO.id!",
    firstLookup: "StatusPagePrivateUserService.findOneBy(",
    startRoute: '"/status-page-sso/:statusPageId/:statusPageSsoId"',
    replyRoute: '"/status-page-idp-login/:statusPageId/:statusPageSsoId"',
  },
];

// A select whose first column is the record's own id.
const SELECT_STARTS_WITH_ID: RegExp = /^_id: true,/;

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

// Every .ts file under a folder.
function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

// The text between `start` and the next `end` after it.
function between(text: string, start: string, end: string): string {
  const from: number = text.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = text.indexOf(end, from + start.length);

  return text.substring(from, to < 0 ? text.length : to);
}

describe("SAML responses are verified only where this guard knows of", () => {
  test("getSamlResponseFromXML is called by the three SAML Reply URLs and nothing else", () => {
    const callers: Array<string> = [];

    const roots: Array<string> = [
      path.join(PACKAGES_DIR, "App/FeatureSet"),
      path.join(PACKAGES_DIR, "Common/Server"),
    ];

    const eeServer: string = path.join(PACKAGES_DIR, "..", "ee", "Server");

    if (fs.existsSync(path.join(PACKAGES_DIR, "..", "ee"))) {
      roots.push(eeServer);
    }

    for (const root of roots) {
      if (!fs.existsSync(root)) {
        continue;
      }

      for (const file of sourceFiles(root)) {
        if (file.includes(`${path.sep}node_modules${path.sep}`)) {
          continue;
        }

        if (read(file).includes(".getSamlResponseFromXML(")) {
          callers.push(path.relative(PACKAGES_DIR, file));
        }
      }
    }

    expect(callers.sort()).toEqual(
      SAML_ROUTES.map((route: SamlRoute): string => {
        return path.join("App/FeatureSet/Identity/API", route.file);
      })
        .concat([path.join("App/FeatureSet/Identity/Utils", "SSO.ts")])
        .sort(),
    );
  });

  test("every route a SAML response is posted to is one of the three", () => {
    const replyRoutes: Array<string> = [];

    for (const file of sourceFiles(API_DIR)) {
      const source: string = read(file);
      let at: number = source.indexOf("router.post(");

      while (at >= 0) {
        const call: string = source.substring(at, at + 200);

        if (call.includes("idp-login")) {
          replyRoutes.push(
            `${path.basename(file)} ${call.split("\n")[1]!.trim()}`,
          );
        }

        at = source.indexOf("router.post(", at + 1);
      }
    }

    expect(replyRoutes.sort()).toEqual(
      SAML_ROUTES.map((route: SamlRoute): string => {
        return `${route.file} ${route.replyRoute},`;
      }).sort(),
    );
  });
});

describe.each(SAML_ROUTES)("$file", (route: SamlRoute) => {
  const source: string = read(path.join(API_DIR, route.file));

  test("verifies the response for this route's own provider", () => {
    const verification: string = between(
      source,
      "SSOUtil.getSamlResponseFromXML(",
      ");",
    );

    expect(verification).toContain(route.builder);
  });

  test("claims the assertion, for this kind of provider, after the issuer check and before anyone is looked up", () => {
    const verifiedAt: number = source.indexOf(
      "SSOUtil.getSamlResponseFromXML(",
    );
    const issuerCheckAt: number = source.indexOf(
      '"Issuer URL does not match"',
      verifiedAt,
    );
    const claimAt: number = source.indexOf(
      "SamlAssertionOneTimeUse.claim(",
      verifiedAt,
    );
    const lookupAt: number = source.indexOf(route.firstLookup, verifiedAt);

    expect(verifiedAt).toBeGreaterThan(0);
    expect(issuerCheckAt).toBeGreaterThan(verifiedAt);
    expect(claimAt).toBeGreaterThan(issuerCheckAt);
    expect(lookupAt).toBeGreaterThan(claimAt);

    expect(between(source, "SamlAssertionOneTimeUse.claim(", "});")).toContain(
      `providerKind: ${route.providerKind},`,
    );

    // Exactly once.
    expect(source.split("SamlAssertionOneTimeUse.claim(").length).toBe(2);
  });

  /*
   * A Reply URL can spell its ids in more than one way that finds the same
   * provider (upper case, no hyphens, braces: Postgres reads them all as
   * the same uuid). The use is kept under the provider record the lookup
   * found, so that however the URL was written there is one record per
   * provider - never under the URL's own text.
   */
  test("keeps the use under the provider record its lookup found, not the URL's spelling of the id", () => {
    const claim: string = between(
      source,
      "SamlAssertionOneTimeUse.claim(",
      "});",
    );

    expect(claim).toContain(`providerId: ${route.storedProviderId},`);
    expect(claim).not.toContain("req.params");
  });

  test("reads the provider record's id in the lookup that finds it for a response", () => {
    const verifiedAt: number = source.indexOf(
      "SSOUtil.getSamlResponseFromXML(",
    );
    const lookupAt: number = source.lastIndexOf("findOneBy({", verifiedAt);

    expect(lookupAt).toBeGreaterThan(0);

    const select: string = between(
      source.substring(lookupAt, verifiedAt),
      "select: {",
      "}",
    );

    // The record's own id, not only a relation's (teams: { _id: true }).
    expect(select.substring("select: {".length).trim()).toMatch(
      SELECT_STARTS_WITH_ID,
    );
  });

  test("starts a sign-in with the Entity ID and Reply URL from the same builder", () => {
    const start: string = between(source, route.startRoute, "router.");

    expect(start).toContain(route.builder);
    expect(start).toContain("acsUrl: URL.fromString(serviceProvider.replyUrl)");
    expect(start).toContain(
      "issuerUrl: URL.fromString(serviceProvider.entityId)",
    );
  });

  test("spells out no SAML address itself", () => {
    expect(source).not.toContain("${HttpProtocol}${Host}");
    expect(source).not.toContain("idp-login/${");
  });
});

describe("the Dashboards show admins the values a response is held to", () => {
  /*
   * These are the expressions each screen renders. SamlServiceProviders
   * builds the same values from the same HOST and HTTP_PROTOCOL; a change to
   * either side has to be made to both, with a plan for every identity
   * provider configured from the old screen.
   */
  test.each([
    [
      "App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx",
      [
        "{`${HTTP_PROTOCOL}${HOST}/${props.currentProject?._id}/${showSingleSignOnUrlId}`}",
        "`/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`",
        "URL.fromString(IDENTITY_URL.toString()).addRoute(",
      ],
    ],
    [
      "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO.tsx",
      [
        "{`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showSingleSignOnUrlId}`}",
        "`/status-page-idp-login/${modelId.toString()}/${showSingleSignOnUrlId}`",
        "URL.fromString(IDENTITY_URL.toString()).addRoute(",
      ],
    ],
    [
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View.tsx",
      [
        "const acsURL: string = `${HTTP_PROTOCOL}${HOST}/identity/global-idp-login/${modelId.toString()}`;",
        "const issuerURL: string = `${HTTP_PROTOCOL}${HOST}/global-sso/${modelId.toString()}`;",
      ],
    ],
  ])("%s", (file: string, expressions: Array<string>) => {
    const screen: string = read(path.join(PACKAGES_DIR, file));

    for (const expression of expressions) {
      expect({ expression, shown: screen.includes(expression) }).toEqual({
        expression,
        shown: true,
      });
    }
  });

  test("the builder makes them from the same pieces", () => {
    const builder: string = read(
      path.join(IDENTITY_DIR, "Utils/SamlServiceProvider.ts"),
    );

    for (const piece of [
      "return `${HttpProtocol}${Host}`;",
      "`${SamlServiceProviders.getServerAddress()}${IdentityRoute.toString()}`",
      "entityId: `${SamlServiceProviders.getServerAddress()}/${projectId}/${projectSsoId}`",
      "replyUrl: `${SamlServiceProviders.getIdentityAddress()}/idp-login/${projectId}/${projectSsoId}`",
      "entityId: `${SamlServiceProviders.getServerAddress()}/${statusPageId}/${statusPageSsoId}`",
      "replyUrl: `${SamlServiceProviders.getIdentityAddress()}/status-page-idp-login/${statusPageId}/${statusPageSsoId}`",
      "entityId: `${SamlServiceProviders.getServerAddress()}/global-sso/${globalSsoId}`",
      "replyUrl: `${SamlServiceProviders.getIdentityAddress()}/global-idp-login/${globalSsoId}`",
    ]) {
      expect({ piece, built: builder.includes(piece) }).toEqual({
        piece,
        built: true,
      });
    }
  });
});
