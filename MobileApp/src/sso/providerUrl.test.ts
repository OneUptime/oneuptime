import {
  buildSsoLoginUrl,
  SsoProviderKind,
  SsoProviderTarget,
} from "./providerUrl";
import { describe, expect, test } from "@jest/globals";

/*
 * These URLs are the app's half of a contract with three Express routers:
 *
 *   /identity/sso/:projectId/:projectSsoId  - App/FeatureSet/Identity/API/SSO.ts
 *   /identity/global-sso/:globalSsoId       - .../API/GlobalSSO.ts
 *   /identity/global-oidc/:globalOidcId     - .../API/GlobalOIDC.ts
 *
 * Nothing type-checks that contract, and getting it wrong does not throw: the
 * browser simply opens, shows an error page or a 404, and the login dies
 * somewhere the app cannot see. So the paths are pinned as whole literals
 * rather than pattern-matched.
 *
 * `?mobile=true` is the single most load-bearing character sequence here. The
 * server reads it as `req.query["mobile"] === "true"` (an exact, case
 * sensitive string compare in App/FeatureSet/Identity/Utils/MobileSso.ts), and
 * it is the ONLY thing that makes the flow finish on `oneuptime://sso-callback`
 * instead of rendering the web dashboard. Drop it and the user logs in
 * successfully, in a browser sheet, and the app never hears about it.
 *
 * This file is platform-free by design, and the suite runs it twice (once
 * under jest-expo/ios, once under jest-expo/android) against the same literal
 * expectations - which is what proves the deep-link entry point is identical
 * on both handsets.
 */

const SERVER: string = "https://oneuptime.com";
const PROVIDER_ID: string = "6f0c7b2e-6a0f-4f0e-9b2e-1a2b3c4d5e6f";
const PROJECT_ID: string = "1b9d4c33-8f1a-4b21-9c0e-77aa55bb33cc";

/*
 * Query parsing is done by hand on purpose. `URL` and `URLSearchParams` are
 * polyfills in React Native, they differ between the two Jest presets' module
 * maps, and a test for a string builder should not depend on a parser that is
 * itself shimmed.
 */
function queryStringOf(url: string): string {
  const questionMark: number = url.indexOf("?");

  return questionMark === -1 ? "" : url.slice(questionMark + 1);
}

function queryParamsOf(url: string): Record<string, string> {
  const query: string = queryStringOf(url);

  if (query === "") {
    return {};
  }

  const params: Record<string, string> = {};

  for (const pair of query.split("&")) {
    const parts: Array<string> = pair.split("=");
    params[parts[0] ?? ""] = parts[1] ?? "";
  }

  return params;
}

/**
 * The path segments after the host, e.g.
 * `["identity", "global-sso", "<id>"]`. Used where the SHAPE of the path
 * matters - a global login that grew a project segment would still "contain"
 * everything the literal assertions look for.
 */
function pathSegmentsOf(url: string): Array<string> {
  const withoutQuery: string = url.split("?")[0]!;
  const withoutScheme: string = withoutQuery.replace(/^[a-z]+:\/\//, "");
  const firstSlash: number = withoutScheme.indexOf("/");

  if (firstSlash === -1) {
    return [];
  }

  return withoutScheme.slice(firstSlash + 1).split("/");
}

const ALL_KINDS: Array<[string, SsoProviderTarget]> = [
  [
    "project",
    { kind: "project", providerId: PROVIDER_ID, projectId: PROJECT_ID },
  ],
  ["global-sso", { kind: "global-sso", providerId: PROVIDER_ID }],
  ["global-oidc", { kind: "global-oidc", providerId: PROVIDER_ID }],
];

describe("A project login carries the project in the path", () => {
  test("hits /identity/sso/<projectId>/<providerId>", () => {
    expect(buildSsoLoginUrl(SERVER, ALL_KINDS[0]![1])).toBe(
      `${SERVER}/identity/sso/${PROJECT_ID}/${PROVIDER_ID}?mobile=true`,
    );
  });

  test("puts the project id before the provider id, not after", () => {
    /*
     * Both ids are opaque uuids of the same shape, so swapping them produces a
     * URL that looks perfectly plausible and 404s (or worse, matches a real
     * project the user can see) only once the browser is already open. The
     * router reads them positionally: /sso/:projectId/:projectSsoId.
     */
    const segments: Array<string> = pathSegmentsOf(
      buildSsoLoginUrl(SERVER, {
        kind: "project",
        providerId: PROVIDER_ID,
        projectId: PROJECT_ID,
      }),
    );

    expect(segments).toEqual(["identity", "sso", PROJECT_ID, PROVIDER_ID]);
  });

  test("does not route a project login through a global router", () => {
    const url: string = buildSsoLoginUrl(SERVER, {
      kind: "project",
      providerId: PROVIDER_ID,
      projectId: PROJECT_ID,
    });

    expect(url).not.toContain("global-sso");
    expect(url).not.toContain("global-oidc");
  });

  test("passes both ids through verbatim", () => {
    /*
     * ObjectIDs are uuids and need no escaping, but they must not be
     * lower-cased, trimmed or otherwise "helped" either - the server looks
     * them up as an exact id.
     */
    const url: string = buildSsoLoginUrl(SERVER, {
      kind: "project",
      providerId: "AAAA-bbbb-CCCC",
      projectId: "DDDD-eeee-FFFF",
    });

    expect(url).toBe(
      `${SERVER}/identity/sso/DDDD-eeee-FFFF/AAAA-bbbb-CCCC?mobile=true`,
    );
  });
});

describe("A project login without a project id fails loudly", () => {
  /*
   * The alternative - and what the three inlined template literals this module
   * replaced used to do - is emitting `/identity/sso/undefined/<id>`. That is a
   * well-formed URL, so the auth browser opens, the server rejects an id it
   * cannot parse, and the user is shown a server error page for what is
   * actually an app bug. Throwing keeps the failure where it was caused.
   */
  test("throws when projectId is missing entirely", () => {
    expect(() => {
      return buildSsoLoginUrl(SERVER, {
        kind: "project",
        providerId: PROVIDER_ID,
      });
    }).toThrow(/projectId/);
  });

  test("throws when projectId is explicitly undefined", () => {
    expect(() => {
      return buildSsoLoginUrl(SERVER, {
        kind: "project",
        providerId: PROVIDER_ID,
        projectId: undefined,
      });
    }).toThrow(/projectId/);
  });

  test("throws on an empty-string projectId", () => {
    /*
     * The realistic one: a screen that reads the id out of navigation params
     * or storage before it has loaded hands over "" rather than undefined.
     * `/identity/sso//<providerId>` would collapse a path segment and match a
     * different route shape entirely.
     */
    expect(() => {
      return buildSsoLoginUrl(SERVER, {
        kind: "project",
        providerId: PROVIDER_ID,
        projectId: "",
      });
    }).toThrow(/projectId/);
  });

  test("throws an Error, so a caller's catch block sees a message", () => {
    expect(() => {
      return buildSsoLoginUrl(SERVER, {
        kind: "project",
        providerId: PROVIDER_ID,
        projectId: "",
      });
    }).toThrow(Error);
  });
});

describe("A global login has no project segment at all", () => {
  test("global SAML hits /identity/global-sso/<providerId>", () => {
    expect(
      buildSsoLoginUrl(SERVER, {
        kind: "global-sso",
        providerId: PROVIDER_ID,
      }),
    ).toBe(`${SERVER}/identity/global-sso/${PROVIDER_ID}?mobile=true`);
  });

  test("global OIDC hits /identity/global-oidc/<providerId>", () => {
    expect(
      buildSsoLoginUrl(SERVER, {
        kind: "global-oidc",
        providerId: PROVIDER_ID,
      }),
    ).toBe(`${SERVER}/identity/global-oidc/${PROVIDER_ID}?mobile=true`);
  });

  test("the two global kinds are not interchangeable", () => {
    /*
     * They are served by two separate routers, and discovery does not return a
     * type field - the app decides from `kind` alone. Sending an OIDC provider
     * id to the SAML router looks like an unknown provider, i.e. a login that
     * fails for a reason nobody can explain.
     */
    const samlUrl: string = buildSsoLoginUrl(SERVER, {
      kind: "global-sso",
      providerId: PROVIDER_ID,
    });
    const oidcUrl: string = buildSsoLoginUrl(SERVER, {
      kind: "global-oidc",
      providerId: PROVIDER_ID,
    });

    expect(samlUrl).not.toBe(oidcUrl);
    expect(samlUrl).not.toContain("global-oidc");
    expect(oidcUrl).not.toContain("global-sso");
  });

  test.each([
    ["global-sso", "global-sso"],
    ["global-oidc", "global-oidc"],
  ] as Array<[SsoProviderKind, string]>)(
    "a %s URL is exactly three path segments",
    (kind: SsoProviderKind, segment: string): void => {
      expect(
        pathSegmentsOf(
          buildSsoLoginUrl(SERVER, { kind: kind, providerId: PROVIDER_ID }),
        ),
      ).toEqual(["identity", segment, PROVIDER_ID]);
    },
  );

  test.each([
    ["global-sso", "global-sso"],
    ["global-oidc", "global-oidc"],
  ] as Array<[SsoProviderKind, string]>)(
    "a %s URL ignores a projectId that is passed anyway",
    (kind: SsoProviderKind, segment: string): void => {
      /*
       * SSOProviderSelectScreen builds one target for a mixed list and passes
       * `projectId` for project providers only - but a caller that always
       * passes the currently-open project must not turn an instance-wide login
       * into a project-scoped one. A leaked id here would grant a token for the
       * wrong scope, silently.
       */
      const url: string = buildSsoLoginUrl(SERVER, {
        kind: kind,
        providerId: PROVIDER_ID,
        projectId: "project-that-must-not-leak",
      });

      expect(url).toBe(
        `${SERVER}/identity/${segment}/${PROVIDER_ID}?mobile=true`,
      );
      expect(url).not.toContain("project-that-must-not-leak");
      expect(pathSegmentsOf(url)).toHaveLength(3);
    },
  );
});

describe("Every kind is flagged as a mobile login", () => {
  test.each(ALL_KINDS)(
    "a %s login sets mobile=true",
    (_label: string, target: SsoProviderTarget): void => {
      /*
       * Asserted through a parse rather than a substring: `?mobile=truthy` or
       * `?not-mobile=true` both "contain" mobile=true as text, and the server
       * compares the parsed value with ===.
       */
      expect(queryParamsOf(buildSsoLoginUrl(SERVER, target))["mobile"]).toBe(
        "true",
      );
    },
  );

  test.each(ALL_KINDS)(
    "a %s login sends mobile as its only query param",
    (_label: string, target: SsoProviderTarget): void => {
      expect(queryStringOf(buildSsoLoginUrl(SERVER, target))).toBe(
        "mobile=true",
      );
    },
  );

  test.each(ALL_KINDS)(
    "a %s login spells the flag in lower case",
    (_label: string, target: SsoProviderTarget): void => {
      /*
       * `Mobile=True` would be dropped on the floor by the server's exact
       * compare, and the flow would end on the web dashboard with the app
       * still sitting on its spinner.
       */
      const url: string = buildSsoLoginUrl(SERVER, target);

      expect(url.endsWith("?mobile=true")).toBe(true);
    },
  );
});

describe("The server URL is normalised before the path is appended", () => {
  test.each(ALL_KINDS)(
    "a single trailing slash does not double up for a %s login",
    (_label: string, target: SsoProviderTarget): void => {
      expect(buildSsoLoginUrl(`${SERVER}/`, target)).toBe(
        buildSsoLoginUrl(SERVER, target),
      );
    },
  );

  test("several trailing slashes are all removed", () => {
    /*
     * A user typing their self-hosted address into the server URL screen is
     * the source of these. `https://host//identity/...` is not equivalent to
     * `https://host/identity/...` for every reverse proxy in front of
     * OneUptime, and a proxy that 404s here breaks login only for the people
     * who typed the slash.
     */
    expect(
      buildSsoLoginUrl(`${SERVER}///`, {
        kind: "global-sso",
        providerId: PROVIDER_ID,
      }),
    ).toBe(`${SERVER}/identity/global-sso/${PROVIDER_ID}?mobile=true`);
  });

  test.each(ALL_KINDS)(
    "a normalised %s URL contains no empty path segment",
    (_label: string, target: SsoProviderTarget): void => {
      const url: string = buildSsoLoginUrl(`${SERVER}//`, target);

      expect(url.replace(/^[a-z]+:\/\//, "")).not.toContain("//");
      expect(pathSegmentsOf(url)).not.toContain("");
    },
  );

  test("the scheme's own double slash survives normalisation", () => {
    const url: string = buildSsoLoginUrl(SERVER, {
      kind: "global-oidc",
      providerId: PROVIDER_ID,
    });

    expect(url.startsWith("https://")).toBe(true);
  });

  test("a self-hosted host with a port keeps the port", () => {
    /*
     * The dev/self-hosted shape: http, an IP, and a port. Losing or mangling
     * the port sends the login to a host that is not listening.
     */
    expect(
      buildSsoLoginUrl("http://192.168.1.10:3002", {
        kind: "global-sso",
        providerId: PROVIDER_ID,
      }),
    ).toBe(
      `http://192.168.1.10:3002/identity/global-sso/${PROVIDER_ID}?mobile=true`,
    );
  });

  test("a host with a port AND a trailing slash is still normalised", () => {
    expect(
      buildSsoLoginUrl("http://192.168.1.10:3002/", {
        kind: "project",
        providerId: PROVIDER_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(
      `http://192.168.1.10:3002/identity/sso/${PROJECT_ID}/${PROVIDER_ID}?mobile=true`,
    );
  });

  test("a bare host with no path or port works", () => {
    expect(
      buildSsoLoginUrl("https://oneuptime.example.com", {
        kind: "global-oidc",
        providerId: PROVIDER_ID,
      }),
    ).toBe(
      `https://oneuptime.example.com/identity/global-oidc/${PROVIDER_ID}?mobile=true`,
    );
  });

  test("a server hosted under a sub-path keeps that prefix", () => {
    /*
     * Self-hosted installs behind a path-routing proxy. The prefix is part of
     * the server URL the user entered, so it has to survive in front of
     * /identity - only the trailing slash is the app's business.
     */
    expect(
      buildSsoLoginUrl("https://intranet.example.com/oneuptime/", {
        kind: "global-sso",
        providerId: PROVIDER_ID,
      }),
    ).toBe(
      `https://intranet.example.com/oneuptime/identity/global-sso/${PROVIDER_ID}?mobile=true`,
    );
  });

  test("normalisation never eats a character of the host itself", () => {
    /*
     * The regex is anchored to the end of the string; a greedier one would
     * quietly truncate hosts. Asserted on a host ending in a letter that the
     * scheme also contains, which is where a sloppy replace shows up.
     */
    expect(
      buildSsoLoginUrl("https://https-example.https", {
        kind: "global-sso",
        providerId: PROVIDER_ID,
      }),
    ).toBe(
      `https://https-example.https/identity/global-sso/${PROVIDER_ID}?mobile=true`,
    );
  });
});
