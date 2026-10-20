import McpSignIn, {
  McpSignInSettings,
  clearMcpSignInCachesForTests,
} from "../../../../../Server/Utils/AI/Mcp/McpSignIn";
import McpClientError from "../../../../../Server/Utils/AI/Mcp/McpClientError";
import ExternalMcpServerAuthType from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import FakeMcpServer, {
  FakeMcpOAuth,
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * How OneUptime signs in to an external MCP server: the headers of each
 * Authentication, and OAuth client credentials against a real token
 * endpoint - the standard client authentication first, the other one when
 * it is refused, a token kept until it is about to expire, and every value
 * that must never be shown listed for the client to redact.
 */

let fake: FakeMcpServer | null = null;

beforeEach(() => {
  clearMcpSignInCachesForTests();
});

afterEach(async () => {
  if (fake) {
    await fake.stop();
    fake = null;
  }
});

async function startTokenServer(oauth: FakeMcpOAuth): Promise<FakeMcpServer> {
  fake = await FakeMcpServer.start({ oauth });
  return fake;
}

function oauthSettings(
  server: FakeMcpServer,
  overrides: Partial<NonNullable<McpSignInSettings["oauth"]>> = {},
): McpSignInSettings {
  return {
    authType: ExternalMcpServerAuthType.OAuthClientCredentials,
    oauth: {
      tokenUrl: server.url("/oauth/token"),
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      ...overrides,
    },
  };
}

function tokenRequests(
  server: FakeMcpServer,
): Array<{ authorization: string; form: URLSearchParams }> {
  return server.requests
    .filter((request: { path: string }): boolean => {
      return request.path === "/oauth/token";
    })
    .map((request: { headers: Record<string, unknown>; body: string }) => {
      return {
        authorization: String(request.headers["authorization"] || ""),
        form: new URLSearchParams(request.body),
      };
    });
}

describe("McpSignIn headers", () => {
  test("None signs in with no header", async () => {
    const signIn: McpSignIn = new McpSignIn({
      settings: { authType: ExternalMcpServerAuthType.None },
      cacheKey: "a",
    });

    expect(await signIn.getHeaders()).toEqual({});
    expect(signIn.getSecretValues()).toEqual([]);
  });

  test("a bearer token goes in Authorization, and is a secret", async () => {
    const signIn: McpSignIn = new McpSignIn({
      settings: {
        authType: ExternalMcpServerAuthType.BearerToken,
        bearerToken: "ghp_token123",
      },
      cacheKey: "a",
    });

    expect(await signIn.getHeaders()).toEqual({
      Authorization: "Bearer ghp_token123",
    });
    expect(signIn.getSecretValues()).toEqual(["ghp_token123"]);
  });

  test("headers go as saved, trimmed, and every value is a secret", async () => {
    const signIn: McpSignIn = new McpSignIn({
      settings: {
        authType: ExternalMcpServerAuthType.Headers,
        headers: {
          "DD-API-KEY": " api-key-1 ",
          "DD-APPLICATION-KEY": "app-key-2",
          Ignored: 7,
        },
      },
      cacheKey: "a",
    });

    expect(await signIn.getHeaders()).toEqual({
      "DD-API-KEY": "api-key-1",
      "DD-APPLICATION-KEY": "app-key-2",
    });
    expect(signIn.getSecretValues()).toEqual(["api-key-1", "app-key-2"]);
  });

  test("a token saved for another Authentication is never sent", async () => {
    const signIn: McpSignIn = new McpSignIn({
      settings: {
        authType: ExternalMcpServerAuthType.None,
        bearerToken: "left-behind",
      },
      cacheKey: "a",
    });

    expect(await signIn.getHeaders()).toEqual({});
  });
});

describe("McpSignIn with OAuth client credentials", () => {
  test("asks the token URL with HTTP Basic first and sends the token as a bearer token", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "both",
      expiresIn: 3600,
    });
    const signIn: McpSignIn = new McpSignIn({
      settings: oauthSettings(server, {
        scope: "api://mcp/.default",
        audience: "https://mcp.example.com",
      }),
      cacheKey: "server-1:digest",
      transport: new LocalMcpHttpTransport(),
    });

    expect(await signIn.getHeaders()).toEqual({
      Authorization: "Bearer token-1",
    });

    const requests: Array<{ authorization: string; form: URLSearchParams }> =
      tokenRequests(server);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.authorization.startsWith("Basic ")).toBe(true);
    expect(requests[0]!.form.get("grant_type")).toBe("client_credentials");
    expect(requests[0]!.form.get("scope")).toBe("api://mcp/.default");
    expect(requests[0]!.form.get("audience")).toBe("https://mcp.example.com");
    // Basic carries the secret, so the body does not.
    expect(requests[0]!.form.get("client_secret")).toBeNull();
    expect(signIn.getSecretValues()).toEqual(
      expect.arrayContaining(["secret:with:colons", "token-1"]),
    );
  });

  test("keeps the token until shortly before it expires, then asks again", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "basic",
      expiresIn: 600,
    });
    let nowMs: number = 1_000_000;
    const signIn: McpSignIn = new McpSignIn({
      settings: oauthSettings(server),
      cacheKey: "server-1:digest",
      transport: new LocalMcpHttpTransport(),
      now: (): number => {
        return nowMs;
      },
    });

    await signIn.getHeaders();
    await signIn.getHeaders();
    nowMs += 500 * 1000;
    expect(await signIn.getHeaders()).toEqual({
      Authorization: "Bearer token-1",
    });
    expect(tokenRequests(server)).toHaveLength(1);

    // Inside the last minute: a new token.
    nowMs += 50 * 1000;
    expect(await signIn.getHeaders()).toEqual({
      Authorization: "Bearer token-2",
    });
    expect(tokenRequests(server)).toHaveLength(2);
  });

  test("a token that says nothing about expiry is kept five minutes", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "both",
    });
    let nowMs: number = 0;
    const signIn: McpSignIn = new McpSignIn({
      settings: oauthSettings(server),
      cacheKey: "k",
      transport: new LocalMcpHttpTransport(),
      now: (): number => {
        return nowMs;
      },
    });

    await signIn.getHeaders();
    nowMs += 3 * 60 * 1000;
    await signIn.getHeaders();
    expect(tokenRequests(server)).toHaveLength(1);

    nowMs += 2 * 60 * 1000;
    await signIn.getHeaders();
    expect(tokenRequests(server)).toHaveLength(2);
  });

  test("a token URL that refuses HTTP Basic gets the credentials in the body, and is remembered", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "post",
    });

    const first: McpSignIn = new McpSignIn({
      settings: oauthSettings(server),
      cacheKey: "server-1:a",
      transport: new LocalMcpHttpTransport(),
    });

    expect(await first.getHeaders()).toEqual({
      Authorization: "Bearer token-1",
    });

    const requests: Array<{ authorization: string; form: URLSearchParams }> =
      tokenRequests(server);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.authorization.startsWith("Basic ")).toBe(true);
    expect(requests[1]!.authorization).toBe("");
    expect(requests[1]!.form.get("client_id")).toBe("client-1");
    expect(requests[1]!.form.get("client_secret")).toBe("secret:with:colons");

    // Another server on the same token URL asks the way that worked.
    const second: McpSignIn = new McpSignIn({
      settings: oauthSettings(server),
      cacheKey: "server-2:a",
      transport: new LocalMcpHttpTransport(),
    });

    await second.getHeaders();

    expect(tokenRequests(server)).toHaveLength(3);
    expect(tokenRequests(server)[2]!.authorization).toBe("");
  });

  test("credentials refused both ways fail as TokenRequestFailed, with no secret in the message", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "the-right-secret",
      accepts: "both",
    });
    const signIn: McpSignIn = new McpSignIn({
      settings: oauthSettings(server, { clientSecret: "a-wrong-secret" }),
      cacheKey: "k",
      transport: new LocalMcpHttpTransport(),
    });

    let error: unknown = null;

    try {
      await signIn.getHeaders();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(McpClientError);
    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.TokenRequestFailed,
    );
    expect((error as McpClientError).message).toBe(
      "The token URL refused the client ID and secret (HTTP 401, invalid_client).",
    );
    expect(tokenRequests(server)).toHaveLength(2);
  });

  test("forgetting the token asks for a new one", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "both",
      expiresIn: 3600,
    });
    const signIn: McpSignIn = new McpSignIn({
      settings: oauthSettings(server),
      cacheKey: "k",
      transport: new LocalMcpHttpTransport(),
    });

    await signIn.getHeaders();
    signIn.forgetAccessToken();

    expect(await signIn.getHeaders()).toEqual({
      Authorization: "Bearer token-2",
    });
  });

  test("tokens are kept per server and settings", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "client-1",
      clientSecret: "secret:with:colons",
      accepts: "both",
      expiresIn: 3600,
    });

    for (const cacheKey of ["server-1:x", "server-2:x", "server-1:y"]) {
      await new McpSignIn({
        settings: oauthSettings(server),
        cacheKey,
        transport: new LocalMcpHttpTransport(),
      }).getHeaders();
    }

    expect(tokenRequests(server)).toHaveLength(3);
  });

  test("settings without a token URL, client ID or secret are refused before anything is sent", async () => {
    const signIn: McpSignIn = new McpSignIn({
      settings: {
        authType: ExternalMcpServerAuthType.OAuthClientCredentials,
        oauth: { tokenUrl: "", clientId: "x", clientSecret: "y" },
      },
      cacheKey: "k",
      transport: new LocalMcpHttpTransport(),
    });

    await expect(signIn.getHeaders()).rejects.toThrow(
      "OAuth client credentials need a token URL, a client ID and a client secret.",
    );
  });

  test("a token URL that cannot be reached fails as TokenRequestFailed", async () => {
    const server: FakeMcpServer = await startTokenServer({
      clientId: "a",
      clientSecret: "b",
      accepts: "both",
    });
    const url: string = server.url("/oauth/token");
    await server.stop();
    fake = null;

    const signIn: McpSignIn = new McpSignIn({
      settings: {
        authType: ExternalMcpServerAuthType.OAuthClientCredentials,
        oauth: { tokenUrl: url, clientId: "a", clientSecret: "b" },
      },
      cacheKey: "k",
      transport: new LocalMcpHttpTransport(),
    });

    let error: unknown = null;

    try {
      await signIn.getHeaders();
    } catch (caught) {
      error = caught;
    }

    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.TokenRequestFailed,
    );
    expect((error as McpClientError).message).toContain(
      "The token URL could not be reached",
    );
  });
});
