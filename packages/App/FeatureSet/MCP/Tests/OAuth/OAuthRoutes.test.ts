/**
 * The routes of the MCP authorization server, as mounted on the app.
 *
 * Discovery is how a client that knows nothing but the MCP URL finds
 * everything else, so the two documents are checked on every path they are
 * served at, against the schema the MCP SDK's own client validates them
 * with, and for the one property that makes them trustworthy: every URL in
 * them comes from configuration, never from the request.
 *
 * The other half is the kill switch. With OAuth switched off not one of these
 * routes may answer - each falls through to the app's ordinary 404.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  /*
   * Only the logger itself is silenced. The module's other exports stay real:
   * the API's error responder calls one of them on every refusal.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import OAuthTestHarness, {
  APP_404_MARKER,
  HttpResult,
  RegisteredTestClient,
} from "./Helpers/OAuthTestHarness";
import logger from "Common/Server/Utils/Logger";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";

const PROTECTED_RESOURCE_PATHS: Array<string> = [
  "/mcp/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-protected-resource",
];

const AUTHORIZATION_SERVER_PATHS: Array<string> = [
  "/.well-known/oauth-authorization-server/mcp",
  "/mcp/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server",
];

const DISCOVERY_PATHS: Array<string> = [
  ...PROTECTED_RESOURCE_PATHS,
  ...AUTHORIZATION_SERVER_PATHS,
];

// Every route the authorization server mounts: [method, path].
const ALL_OAUTH_ROUTES: Array<[string, string]> = [
  ...DISCOVERY_PATHS.map((path: string): [string, string] => {
    return ["GET", path];
  }),
  ...DISCOVERY_PATHS.map((path: string): [string, string] => {
    return ["OPTIONS", path];
  }),
  ["GET", "/mcp/oauth/authorize"],
  ["POST", "/mcp/oauth/authorize"],
  ["POST", "/mcp/oauth/token"],
  ["OPTIONS", "/mcp/oauth/token"],
  ["POST", "/mcp/oauth/register"],
  ["OPTIONS", "/mcp/oauth/register"],
  ["POST", "/mcp/oauth/revoke"],
  ["OPTIONS", "/mcp/oauth/revoke"],
  ["POST", "/mcp/oauth/consent/details"],
  ["POST", "/mcp/oauth/consent/approve"],
  ["POST", "/mcp/oauth/consent/deny"],
];

describe("MCP OAuth routes", () => {
  let harness: OAuthTestHarness;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(() => {
    harness.reset();
    jest.clearAllMocks();
  });

  describe("protected resource metadata (RFC 9728)", () => {
    it.each(PROTECTED_RESOURCE_PATHS)(
      "is served at %s",
      async (path: string) => {
        const response: HttpResult = await harness.request(path);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(response.json).toEqual({
          resource: `${harness.origin}/mcp`,
          authorization_servers: [`${harness.origin}/mcp`],
          scopes_supported: ["mcp:read", "mcp:write"],
          bearer_methods_supported: ["header"],
          resource_name: "OneUptime MCP Server",
          resource_documentation: `${harness.origin}/docs/ai/mcp-server`,
        });
      },
    );

    it("is a document the MCP SDK's client accepts", async () => {
      const response: HttpResult = await harness.request(
        PROTECTED_RESOURCE_PATHS[0]!,
      );

      expect(
        OAuthProtectedResourceMetadataSchema.safeParse(response.json).success,
      ).toBe(true);
    });

    it("does not list offline_access: it is not something this resource requires", async () => {
      const response: HttpResult = await harness.request(
        PROTECTED_RESOURCE_PATHS[0]!,
      );

      expect(response.json.scopes_supported).not.toContain("offline_access");
    });

    it("is the same document on every path", async () => {
      const bodies: Array<string> = [];

      for (const path of PROTECTED_RESOURCE_PATHS) {
        bodies.push((await harness.request(path)).text);
      }

      expect(new Set(bodies).size).toBe(1);
    });
  });

  describe("authorization server metadata (RFC 8414)", () => {
    it.each(AUTHORIZATION_SERVER_PATHS)(
      "is served at %s",
      async (path: string) => {
        const response: HttpResult = await harness.request(path);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(response.json).toEqual({
          issuer: `${harness.origin}/mcp`,
          authorization_endpoint: `${harness.origin}/mcp/oauth/authorize`,
          token_endpoint: `${harness.origin}/mcp/oauth/token`,
          registration_endpoint: `${harness.origin}/mcp/oauth/register`,
          revocation_endpoint: `${harness.origin}/mcp/oauth/revoke`,
          scopes_supported: ["mcp:read", "mcp:write", "offline_access"],
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
            "client_secret_basic",
          ],
          revocation_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
            "client_secret_basic",
          ],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
          service_documentation: `${harness.origin}/docs/ai/mcp-server`,
          client_id_metadata_document_supported: true,
        });
      },
    );

    it("is a document the MCP SDK's client accepts", async () => {
      const response: HttpResult = await harness.request(
        AUTHORIZATION_SERVER_PATHS[0]!,
      );

      expect(OAuthMetadataSchema.safeParse(response.json).success).toBe(true);
    });

    it("names the same issuer the protected resource metadata points at", async () => {
      const resource: HttpResult = await harness.request(
        PROTECTED_RESOURCE_PATHS[0]!,
      );
      const server: HttpResult = await harness.request(
        AUTHORIZATION_SERVER_PATHS[0]!,
      );

      expect(resource.json.authorization_servers).toEqual([server.json.issuer]);
    });

    it("lists 'none' first: nearly every MCP client is public, and some only use a metadata document when they see it", async () => {
      const response: HttpResult = await harness.request(
        AUTHORIZATION_SERVER_PATHS[0]!,
      );

      expect(response.json.token_endpoint_auth_methods_supported[0]).toBe(
        "none",
      );
    });

    it("stops advertising metadata documents on an instance that cannot fetch them", async () => {
      harness.setClientIdMetadataDocumentEnabled(false);

      const response: HttpResult = await harness.request(
        AUTHORIZATION_SERVER_PATHS[0]!,
      );

      expect(response.status).toBe(200);
      expect("client_id_metadata_document_supported" in response.json).toBe(
        false,
      );
      // Registration is what such a client falls back to; it is still offered.
      expect(response.json.registration_endpoint).toBe(
        `${harness.origin}/mcp/oauth/register`,
      );
    });

    it("names endpoints that actually answer", async () => {
      const metadata: any = (
        await harness.request(AUTHORIZATION_SERVER_PATHS[0]!)
      ).json;

      const authorization: HttpResult = await harness.request(
        metadata.authorization_endpoint,
      );
      const token: HttpResult = await harness.request(metadata.token_endpoint, {
        form: {},
      });
      const registration: HttpResult = await harness.request(
        metadata.registration_endpoint,
        { json: {} },
      );
      const revocation: HttpResult = await harness.request(
        metadata.revocation_endpoint,
        { form: {} },
      );

      // Each answers in its own way; none is the app's 404.
      expect(authorization.status).toBe(302);
      expect(token.json.error).toBe("invalid_request");
      expect(registration.json.error).toBe("invalid_redirect_uri");
      expect(revocation.json.error).toBe("invalid_client");
    });

    it("is not OpenID Connect: the OIDC discovery paths a client also probes are plain 404s", async () => {
      for (const path of [
        "/.well-known/openid-configuration/mcp",
        "/mcp/.well-known/openid-configuration",
        "/.well-known/openid-configuration",
      ]) {
        const response: HttpResult = await harness.request(path);

        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
      }
    });
  });

  describe("both documents", () => {
    it.each(DISCOVERY_PATHS)(
      "may be cached for five minutes and read from any origin (%s)",
      async (path: string) => {
        const response: HttpResult = await harness.request(path, {
          headers: { Origin: "https://inspector.example" },
        });

        expect(response.headers.get("cache-control")).toBe(
          "public, max-age=300",
        );
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
      },
    );

    it.each(DISCOVERY_PATHS)(
      "answer the preflight a browser sends first (%s)",
      async (path: string) => {
        const response: HttpResult = await harness.request(path, {
          method: "OPTIONS",
          headers: {
            Origin: "https://inspector.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "mcp-protocol-version",
          },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("access-control-allow-methods")).toContain(
          "GET",
        );
        // The SDK sends this header with every discovery request.
        expect(
          (
            response.headers.get("access-control-allow-headers") || ""
          ).toLowerCase(),
        ).toContain("mcp-protocol-version");
      },
    );

    it.each(DISCOVERY_PATHS)(
      "build every URL from configuration, whatever host the request names (%s)",
      async (path: string) => {
        const response: {
          status: number;
          text: string;
        } = await harness.rawRequest({
          method: "GET",
          path,
          headers: {
            Host: "attacker.example",
            "X-Forwarded-Host": "attacker.example",
            "X-Forwarded-Proto": "https",
            Forwarded: "host=attacker.example;proto=https",
          },
        });

        expect(response.status).toBe(200);
        expect(response.text).not.toContain("attacker.example");
        expect(response.text).toContain(harness.origin);
      },
    );

    it("need no credentials and write nothing", async () => {
      for (const path of DISCOVERY_PATHS) {
        expect((await harness.request(path)).status).toBe(200);
      }

      expect(harness.store.calls).toEqual([]);
      // Nor are they rate limited: a client reads them on every connection.
      expect(harness.rateLimitKeys()).toEqual([]);
    });

    it("are only a GET", async () => {
      for (const path of DISCOVERY_PATHS) {
        const response: HttpResult = await harness.request(path, {
          json: {},
        });

        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
      }
    });
  });

  describe("when OAuth is switched off (DISABLE_MCP_OAUTH)", () => {
    beforeEach(() => {
      harness.setOAuthEnabled(false);
    });

    it.each(ALL_OAUTH_ROUTES)(
      "%s %s is the app's ordinary 404",
      async (method: string, path: string) => {
        const response: HttpResult = await harness.request(path, {
          method,
          ...(method === "POST"
            ? { headers: { "Content-Type": "application/json" }, body: "{}" }
            : {}),
        });

        expect(response.status).toBe(404);
        expect(response.json).toEqual({ marker: APP_404_MARKER, path });

        // Nothing of the authorization server shows through.
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect(response.headers.get("www-authenticate")).toBeNull();
      },
    );

    it("does not even count the request against a rate limit, or read a row", async () => {
      for (const [method, path] of ALL_OAUTH_ROUTES) {
        await harness.request(path, { method });
      }

      expect(harness.rateLimitKeys()).toEqual([]);
      expect(harness.store.calls).toEqual([]);
    });

    it("does not parse a body it is not going to read: an oversized one is still just a 404", async () => {
      const response: HttpResult = await harness.request(
        "/mcp/oauth/register",
        { json: { padding: "x".repeat(200 * 1024) } },
      );

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
    });

    it("comes back the moment it is switched on again", async () => {
      harness.setOAuthEnabled(true);

      for (const path of DISCOVERY_PATHS) {
        expect((await harness.request(path)).status).toBe(200);
      }
    });
  });

  describe("request bodies", () => {
    it.each([
      ["/mcp/oauth/token"],
      ["/mcp/oauth/revoke"],
      ["/mcp/oauth/authorize"],
    ])("refuses a form over 64 KB at %s", async (path: string) => {
      const response: HttpResult = await harness.request(path, {
        form: { padding: "x".repeat(70 * 1024) },
      });

      expect(response.status).toBe(413);
    });

    it.each([
      ["/mcp/oauth/register"],
      ["/mcp/oauth/consent/details"],
      ["/mcp/oauth/consent/approve"],
      ["/mcp/oauth/consent/deny"],
    ])("refuses JSON over 64 KB at %s", async (path: string) => {
      const response: HttpResult = await harness.request(path, {
        json: { padding: "x".repeat(70 * 1024) },
      });

      expect(response.status).toBe(413);
    });
  });

  describe("paths that are not routes", () => {
    it.each([
      ["GET", "/mcp/oauth"],
      ["GET", "/mcp/oauth/"],
      ["GET", "/mcp/oauth/userinfo"],
      ["POST", "/mcp/oauth/introspect"],
      ["GET", "/mcp/oauth/consent"],
      ["POST", "/mcp/oauth/consent/unknown"],
      ["DELETE", "/mcp/oauth/token"],
      ["PUT", "/mcp/oauth/register"],
    ])("%s %s is the app's 404", async (method: string, path: string) => {
      const response: HttpResult = await harness.request(path, { method });

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
    });
  });

  describe("a handler that fails unexpectedly", () => {
    it("answers an OAuth error document, with the cause in the log and not in the response", async () => {
      const client: RegisteredTestClient = await harness.register();

      harness.store.intercept("token", "findOneBy", (): void => {
        throw new Error(
          "password authentication failed for user postgres at db.internal",
        );
      });

      const response: HttpResult = await harness.refresh(
        client.clientId,
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      );

      expect(response.status).toBe(500);
      expect(response.json).toEqual({
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected error.",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.text).not.toContain("postgres");
      expect(response.text).not.toContain("db.internal");
      expect(logger.error as jest.Mock).toHaveBeenCalled();
    });

    /*
     * `invalid_client` is the one answer that makes an MCP client throw away
     * its registration and its tokens. A database failure while looking a
     * REGISTERED client up says nothing about the client, so it is never
     * answered that way: a Postgres blip during a refresh would otherwise
     * sign every connected client out.
     */
    it("says server_error, not invalid_client, when it could not look the client up", async () => {
      const client: RegisteredTestClient = await harness.register();

      harness.store.intercept("client", "findOneById", (): void => {
        throw new Error("connection terminated unexpectedly");
      });

      const response: HttpResult = await harness.refresh(
        client.clientId,
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      );

      expect(response.status).toBe(500);
      expect(response.json).toEqual({
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected error.",
      });
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.text).not.toContain("connection terminated");
      expect(logger.error as jest.Mock).toHaveBeenCalled();
    });

    it("says the same at the revocation endpoint, which authenticates the client the same way", async () => {
      const client: RegisteredTestClient = await harness.register();

      harness.store.intercept("client", "findOneById", (): void => {
        throw new Error("connection terminated unexpectedly");
      });

      const response: HttpResult = await harness.revoke({
        client_id: client.clientId,
        token: McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      });

      expect(response.status).toBe(500);
      expect(response.json.error).toBe("server_error");
      expect(response.text).not.toContain("connection terminated");
      expect(logger.error as jest.Mock).toHaveBeenCalled();
    });

    it("is still invalid_client when the lookup answered, and the answer was no", async () => {
      const response: HttpResult = await harness.refresh(
        "a-client-nobody-registered",
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      );

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
    });
  });
});
