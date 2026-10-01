import { MCP_AUTHORIZE_ROUTE } from "../../../../UI/Utils/McpOAuthPendingAuthorization";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The fixed points of the MCP authorization server: where it lives, how long
 * what it hands out lasts, and the two switches an operator has.
 *
 * Every URL here ends up in a discovery document, a challenge or a redirect,
 * and a token is bound to the resource URL - so they are pinned exactly, for
 * more than one deployment shape. `isThisResource` is the audience check on
 * every token and every grant: the matrix below is the list of things that
 * must and must not count as "this MCP server".
 *
 * The module reads its configuration once, when it is loaded, so each case
 * loads its own copy under the environment it is about.
 */

type ConfigClass =
  typeof import("../../../../Server/Utils/Mcp/McpOAuthConfig").default;

interface Environment {
  HOST?: string | undefined;
  HTTP_PROTOCOL?: string | undefined;
  DISABLE_MCP_OAUTH?: string | undefined;
  DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS?: string | undefined;
}

const ENVIRONMENT_KEYS: Array<keyof Environment> = [
  "HOST",
  "HTTP_PROTOCOL",
  "DISABLE_MCP_OAUTH",
  "DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS",
];

/*
 * Loads McpOAuthConfig - and the EnvironmentConfig beneath it - fresh, with
 * exactly the given values for the four variables it depends on (a key left
 * out is unset), then puts the process environment back.
 */
function loadConfig(environment: Environment): ConfigClass {
  const saved: Environment = {};

  for (const key of ENVIRONMENT_KEYS) {
    saved[key] = process.env[key];
  }

  let loaded: ConfigClass | null = null;

  try {
    for (const key of ENVIRONMENT_KEYS) {
      const value: string | undefined = environment[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    jest.isolateModules((): void => {
      loaded = (
        jest.requireActual("../../../../Server/Utils/Mcp/McpOAuthConfig") as {
          default: ConfigClass;
        }
      ).default;
    });
  } finally {
    for (const key of ENVIRONMENT_KEYS) {
      const value: string | undefined = saved[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  if (!loaded) {
    throw new Error("McpOAuthConfig did not load");
  }

  return loaded;
}

const HOSTED: Environment = {
  HOST: "oneuptime.example.com",
  HTTP_PROTOCOL: "https",
};

const ORIGIN: string = "https://oneuptime.example.com";

describe("McpOAuthConfig: lifetimes", () => {
  const config: ConfigClass = loadConfig(HOSTED);

  test("an authorization code lasts five minutes", () => {
    expect(config.AUTHORIZATION_CODE_TTL_SECONDS).toBe(300);
  });

  test("an access token lasts one hour", () => {
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
  });

  test("a refresh token lasts thirty days", () => {
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(2592000);
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  test("a spent refresh token may be presented again for sixty seconds", () => {
    expect(config.REFRESH_TOKEN_REUSE_GRACE_SECONDS).toBe(60);
  });

  test("an authorization request stays valid for ten minutes", () => {
    expect(config.AUTHORIZATION_REQUEST_TTL_SECONDS).toBe(600);
  });

  test("a delegation token lasts sixty seconds", () => {
    expect(config.DELEGATION_TOKEN_TTL_SECONDS).toBe(60);
  });

  test("the lifetimes are ordered the way the flow needs them to be", () => {
    // A code is collected well within the time a person has to approve it.
    expect(config.AUTHORIZATION_CODE_TTL_SECONDS).toBeLessThanOrEqual(
      config.AUTHORIZATION_REQUEST_TTL_SECONDS,
    );
    // An access token is short-lived next to the refresh token behind it.
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBeLessThan(
      config.REFRESH_TOKEN_TTL_SECONDS,
    );
    // The reuse grace is a retry window, not a second lifetime.
    expect(config.REFRESH_TOKEN_REUSE_GRACE_SECONDS).toBeLessThan(
      config.ACCESS_TOKEN_TTL_SECONDS,
    );
    // The internal credential dies long before the token it stands in for.
    expect(config.DELEGATION_TOKEN_TTL_SECONDS).toBeLessThan(
      config.ACCESS_TOKEN_TTL_SECONDS,
    );
  });
});

describe("McpOAuthConfig: URLs, on an https instance", () => {
  const config: ConfigClass = loadConfig(HOSTED);

  test("the origin is HTTP_PROTOCOL and HOST", () => {
    expect(config.getOrigin()).toBe(ORIGIN);
  });

  test("the issuer and the resource are the same URL: <origin>/mcp", () => {
    expect(config.getIssuer()).toBe(`${ORIGIN}/mcp`);
    expect(config.getResource()).toBe(`${ORIGIN}/mcp`);
    expect(config.getIssuer()).toBe(config.getResource());
  });

  test("neither the issuer nor the resource ends in a slash", () => {
    expect(config.getIssuer().endsWith("/")).toBe(false);
    expect(config.getResource().endsWith("/")).toBe(false);
  });

  test("the four OAuth endpoints sit under /mcp/oauth", () => {
    expect(config.getAuthorizationEndpoint()).toBe(
      `${ORIGIN}/mcp/oauth/authorize`,
    );
    expect(config.getTokenEndpoint()).toBe(`${ORIGIN}/mcp/oauth/token`);
    expect(config.getRegistrationEndpoint()).toBe(
      `${ORIGIN}/mcp/oauth/register`,
    );
    expect(config.getRevocationEndpoint()).toBe(`${ORIGIN}/mcp/oauth/revoke`);
  });

  test("every OAuth endpoint is beneath the issuer, so /mcp is the only path that has to route", () => {
    for (const endpoint of [
      config.getAuthorizationEndpoint(),
      config.getTokenEndpoint(),
      config.getRegistrationEndpoint(),
      config.getRevocationEndpoint(),
      config.getProtectedResourceMetadataUrl(),
    ]) {
      expect(endpoint.startsWith(`${config.getIssuer()}/`)).toBe(true);
    }
  });

  test("the protected resource metadata a challenge points at is the copy under /mcp", () => {
    expect(config.getProtectedResourceMetadataUrl()).toBe(
      `${ORIGIN}/mcp/.well-known/oauth-protected-resource`,
    );
  });

  test("the consent page is /accounts/mcp-authorize - the same route the UI resumes to", () => {
    expect(config.getConsentPageUrl()).toBe(`${ORIGIN}/accounts/mcp-authorize`);
    expect(config.getConsentPageUrl()).toBe(`${ORIGIN}${MCP_AUTHORIZE_ROUTE}`);
  });

  test("the documentation URL is the MCP server page", () => {
    expect(config.getDocumentationUrl()).toBe(`${ORIGIN}/docs/ai/mcp-server`);
  });

  test("every URL is absolute, on the configured origin, with no query or fragment", () => {
    for (const value of [
      config.getOrigin(),
      config.getIssuer(),
      config.getResource(),
      config.getAuthorizationEndpoint(),
      config.getTokenEndpoint(),
      config.getRegistrationEndpoint(),
      config.getRevocationEndpoint(),
      config.getProtectedResourceMetadataUrl(),
      config.getConsentPageUrl(),
      config.getDocumentationUrl(),
    ]) {
      const parsed: URL = new URL(value);

      expect(parsed.origin).toBe(ORIGIN);
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
      expect(value).not.toContain("?");
      expect(value).not.toContain("#");
    }
  });

  test("no URL is built from a request: the getters take no arguments", () => {
    /*
     * An issuer that followed the Host header would let whoever controls a
     * hostname pointed at this instance mint metadata naming their own
     * endpoints. A getter that grew a parameter is how that would start.
     */
    const getters: Array<(...args: Array<unknown>) => unknown> = [
      config.getOrigin,
      config.getIssuer,
      config.getResource,
      config.getAuthorizationEndpoint,
      config.getTokenEndpoint,
      config.getRegistrationEndpoint,
      config.getRevocationEndpoint,
      config.getProtectedResourceMetadataUrl,
      config.getConsentPageUrl,
      config.getDocumentationUrl,
    ];

    for (const getter of getters) {
      expect(getter).toHaveLength(0);
    }
  });
});

describe("McpOAuthConfig: URLs, on other deployment shapes", () => {
  test("a plain http instance gets http URLs", () => {
    const config: ConfigClass = loadConfig({
      HOST: "oneuptime.internal",
      HTTP_PROTOCOL: "http",
    });

    expect(config.getOrigin()).toBe("http://oneuptime.internal");
    expect(config.getIssuer()).toBe("http://oneuptime.internal/mcp");
    expect(config.getTokenEndpoint()).toBe(
      "http://oneuptime.internal/mcp/oauth/token",
    );
  });

  test("an unset HTTP_PROTOCOL means http, as it does everywhere else", () => {
    const config: ConfigClass = loadConfig({ HOST: "oneuptime.internal" });

    expect(config.getOrigin()).toBe("http://oneuptime.internal");
  });

  test("a HOST with a port keeps the port in every URL", () => {
    const config: ConfigClass = loadConfig({
      HOST: "localhost:3002",
      HTTP_PROTOCOL: "http",
    });

    expect(config.getOrigin()).toBe("http://localhost:3002");
    expect(config.getResource()).toBe("http://localhost:3002/mcp");
    expect(config.getAuthorizationEndpoint()).toBe(
      "http://localhost:3002/mcp/oauth/authorize",
    );
    expect(config.getProtectedResourceMetadataUrl()).toBe(
      "http://localhost:3002/mcp/.well-known/oauth-protected-resource",
    );
    expect(config.getConsentPageUrl()).toBe(
      "http://localhost:3002/accounts/mcp-authorize",
    );
  });

  test("with no HOST at all the origin falls back to https://oneuptime.com", () => {
    for (const environment of [
      {},
      { HOST: "" },
      { HTTP_PROTOCOL: "http" },
      { HOST: "", HTTP_PROTOCOL: "https" },
    ]) {
      const config: ConfigClass = loadConfig(environment);

      expect(config.getOrigin()).toBe("https://oneuptime.com");
      expect(config.getIssuer()).toBe("https://oneuptime.com/mcp");
      expect(config.getResource()).toBe("https://oneuptime.com/mcp");
      expect(config.isThisResource("https://oneuptime.com/mcp")).toBe(true);
    }
  });
});

describe("McpOAuthConfig: the two switches", () => {
  test("both features are on when neither variable is set", () => {
    const config: ConfigClass = loadConfig(HOSTED);

    expect(config.isEnabled()).toBe(true);
    expect(config.isClientIdMetadataDocumentEnabled()).toBe(true);
  });

  test('DISABLE_MCP_OAUTH="true" turns OAuth off', () => {
    const config: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH: "true",
    });

    expect(config.isEnabled()).toBe(false);
  });

  test('DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS="true" turns metadata documents off', () => {
    const config: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS: "true",
    });

    expect(config.isClientIdMetadataDocumentEnabled()).toBe(false);
  });

  test("the switches are independent of each other", () => {
    const oauthOff: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH: "true",
    });

    expect(oauthOff.isEnabled()).toBe(false);
    expect(oauthOff.isClientIdMetadataDocumentEnabled()).toBe(true);

    const documentsOff: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS: "true",
    });

    expect(documentsOff.isEnabled()).toBe(true);
    expect(documentsOff.isClientIdMetadataDocumentEnabled()).toBe(false);

    const bothOff: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH: "true",
      DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS: "true",
    });

    expect(bothOff.isEnabled()).toBe(false);
    expect(bothOff.isClientIdMetadataDocumentEnabled()).toBe(false);
  });

  const NOT_TRUE: Array<[string, string]> = [
    ["false", "false"],
    ["an empty string", ""],
    ["TRUE", "TRUE"],
    ["True", "True"],
    ["1", "1"],
    ["yes", "yes"],
    ["on", "on"],
    ["true with a leading space", " true"],
    ["true with a trailing space", "true "],
  ];

  test.each(NOT_TRUE)(
    'only the exact string "true" disables: %s leaves OAuth on',
    (_label: string, value: string) => {
      const config: ConfigClass = loadConfig({
        ...HOSTED,
        DISABLE_MCP_OAUTH: value,
      });

      expect(config.isEnabled()).toBe(true);
    },
  );

  test.each(NOT_TRUE)(
    'only the exact string "true" disables: %s leaves metadata documents on',
    (_label: string, value: string) => {
      const config: ConfigClass = loadConfig({
        ...HOSTED,
        DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS: value,
      });

      expect(config.isClientIdMetadataDocumentEnabled()).toBe(true);
    },
  );

  test("switching OAuth off does not move any URL", () => {
    const on: ConfigClass = loadConfig(HOSTED);
    const off: ConfigClass = loadConfig({
      ...HOSTED,
      DISABLE_MCP_OAUTH: "true",
    });

    expect(off.getIssuer()).toBe(on.getIssuer());
    expect(off.getResource()).toBe(on.getResource());
    expect(off.isThisResource(on.getResource())).toBe(true);
  });
});

describe("McpOAuthConfig.isThisResource", () => {
  const config: ConfigClass = loadConfig(HOSTED);

  const ACCEPTED: Array<[string, string]> = [
    ["the resource exactly", "https://oneuptime.example.com/mcp"],
    ["a trailing slash", "https://oneuptime.example.com/mcp/"],
    ["an upper-case scheme", "HTTPS://oneuptime.example.com/mcp"],
    ["an upper-case host", "https://ONEUPTIME.EXAMPLE.COM/mcp"],
    ["a mixed-case scheme and host", "HttpS://OneUptime.Example.Com/mcp"],
    ["the default port spelled out", "https://oneuptime.example.com:443/mcp"],
    [
      "the default port and a trailing slash",
      "https://oneuptime.example.com:443/mcp/",
    ],
  ];

  test.each(ACCEPTED)("accepts %s", (_label: string, value: string) => {
    expect(config.isThisResource(value)).toBe(true);
  });

  test("accepts what getResource returns", () => {
    expect(config.isThisResource(config.getResource())).toBe(true);
  });

  const REFUSED: Array<[string, string]> = [
    ["another host", "https://evil.example.com/mcp"],
    ["a subdomain", "https://mcp.oneuptime.example.com/mcp"],
    ["a parent domain", "https://example.com/mcp"],
    [
      "the host as a prefix of another",
      "https://oneuptime.example.com.evil.test/mcp",
    ],
    ["the host with a trailing dot", "https://oneuptime.example.com./mcp"],
    ["another scheme", "http://oneuptime.example.com/mcp"],
    ["a non-web scheme", "ftp://oneuptime.example.com/mcp"],
    ["another port", "https://oneuptime.example.com:8443/mcp"],
    ["the other scheme's default port", "https://oneuptime.example.com:80/mcp"],
    ["a longer path segment", "https://oneuptime.example.com/mcp2"],
    ["a path beneath it", "https://oneuptime.example.com/mcp/x"],
    [
      "an OAuth endpoint beneath it",
      "https://oneuptime.example.com/mcp/oauth/token",
    ],
    ["the root path", "https://oneuptime.example.com/"],
    ["no path", "https://oneuptime.example.com"],
    ["a path above it", "https://oneuptime.example.com/api/mcp"],
    ["the path in another case", "https://oneuptime.example.com/MCP"],
    ["two trailing slashes", "https://oneuptime.example.com/mcp//"],
    ["a percent-encoded path", "https://oneuptime.example.com/%6Dcp"],
    ["a query", "https://oneuptime.example.com/mcp?tenant=1"],
    ["an empty query", "https://oneuptime.example.com/mcp?"],
    [
      "a query after a trailing slash",
      "https://oneuptime.example.com/mcp/?a=b",
    ],
    ["a fragment", "https://oneuptime.example.com/mcp#section"],
    ["an empty fragment", "https://oneuptime.example.com/mcp#"],
    ["a user name", "https://user@oneuptime.example.com/mcp"],
    [
      "a user name and password",
      "https://user:secret@oneuptime.example.com/mcp",
    ],
    [
      "the real host as the user name of another",
      "https://oneuptime.example.com@evil.example.com/mcp",
    ],
    ["a relative path", "/mcp"],
    ["a scheme-less host", "oneuptime.example.com/mcp"],
    ["a protocol-relative URL", "//oneuptime.example.com/mcp"],
    ["something that is not a URL", "not a url"],
    ["an empty string", ""],
    ["a javascript URL", "javascript:alert(1)"],
  ];

  test.each(REFUSED)("refuses %s", (_label: string, value: string) => {
    expect(config.isThisResource(value)).toBe(false);
  });

  const NOT_STRINGS: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an object", { href: "https://oneuptime.example.com/mcp" }],
    ["an array holding the resource", ["https://oneuptime.example.com/mcp"]],
    ["a URL object", new URL("https://oneuptime.example.com/mcp")],
  ];

  test.each(NOT_STRINGS)(
    "refuses %s without throwing",
    (_label: string, value: unknown) => {
      expect(() => {
        return config.isThisResource(value);
      }).not.toThrow();
      expect(config.isThisResource(value)).toBe(false);
    },
  );

  test("on an instance with a port in HOST, the port has to match", () => {
    const local: ConfigClass = loadConfig({
      HOST: "localhost:3002",
      HTTP_PROTOCOL: "http",
    });

    expect(local.isThisResource("http://localhost:3002/mcp")).toBe(true);
    expect(local.isThisResource("http://localhost:3002/mcp/")).toBe(true);
    expect(local.isThisResource("http://LOCALHOST:3002/mcp")).toBe(true);

    expect(local.isThisResource("http://localhost/mcp")).toBe(false);
    expect(local.isThisResource("http://localhost:3003/mcp")).toBe(false);
    expect(local.isThisResource("https://localhost:3002/mcp")).toBe(false);
    expect(local.isThisResource("http://127.0.0.1:3002/mcp")).toBe(false);
  });

  test("on a plain http instance, http's default port is the one that may be spelled out", () => {
    const plain: ConfigClass = loadConfig({
      HOST: "oneuptime.internal",
      HTTP_PROTOCOL: "http",
    });

    expect(plain.isThisResource("http://oneuptime.internal/mcp")).toBe(true);
    expect(plain.isThisResource("http://oneuptime.internal:80/mcp")).toBe(true);
    expect(plain.isThisResource("http://oneuptime.internal:443/mcp")).toBe(
      false,
    );
    expect(plain.isThisResource("https://oneuptime.internal/mcp")).toBe(false);
  });

  test("a grant made out to one hostname is not good on another", () => {
    /*
     * The resource follows HOST, so moving an instance to a new hostname
     * invalidates the grants made out to the old one - on purpose.
     */
    const before: ConfigClass = loadConfig({
      HOST: "old.example.com",
      HTTP_PROTOCOL: "https",
    });
    const after: ConfigClass = loadConfig({
      HOST: "new.example.com",
      HTTP_PROTOCOL: "https",
    });

    expect(after.isThisResource(before.getResource())).toBe(false);
    expect(before.isThisResource(after.getResource())).toBe(false);
    expect(after.isThisResource(after.getResource())).toBe(true);
  });
});
