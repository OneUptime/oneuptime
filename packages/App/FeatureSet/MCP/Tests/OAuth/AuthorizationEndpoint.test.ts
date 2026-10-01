/**
 * The authorization endpoint over HTTP (GET and POST /mcp/oauth/authorize).
 *
 * Every answer is a redirect, and the question each test asks is WHERE:
 *
 *   the consent screen with a ticket   - the request is good
 *   the consent screen with an error   - the client or its redirect URI could
 *                                        not be verified
 *   the client's redirect URI          - the client is verified and something
 *                                        else is wrong
 *
 * The middle one is the open-redirect guard: until the redirect URI has been
 * matched against what the client registered, nothing the caller supplied may
 * decide where the browser is sent.
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

import OAuthTestHarness, {
  APP_404_MARKER,
  AuthorizeParameters,
  DEFAULT_REDIRECT_URI,
  HttpResult,
  RegisteredTestClient,
} from "./Helpers/OAuthTestHarness";
import AuthorizationRequest, {
  McpOAuthAuthorizationRequest,
} from "../../OAuth/AuthorizationRequest";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import logger from "Common/Server/Utils/Logger";

const CONSENT_PATH: string = "/accounts/mcp-authorize";
const ATTACKER_ORIGIN: string = "https://attacker.example";
const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/client.json";

describe("/mcp/oauth/authorize", () => {
  let harness: OAuthTestHarness;
  let client: RegisteredTestClient;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    harness.reset();
    jest.clearAllMocks();
    client = await harness.register();
  });

  // The consent screen, and nowhere else.
  function expectConsentPage(response: HttpResult): URL {
    expect(response.status).toBe(302);
    expect(response.location).not.toBeNull();

    const location: URL = response.location!;

    expect(location.origin).toBe(harness.origin);
    expect(location.pathname).toBe(CONSENT_PATH);

    return location;
  }

  function expectTicket(response: HttpResult): McpOAuthAuthorizationRequest {
    const location: URL = expectConsentPage(response);

    expect(Array.from(location.searchParams.keys())).toEqual(["request"]);

    const request: McpOAuthAuthorizationRequest | null =
      AuthorizationRequest.fromTicket(location.searchParams.get("request"));

    expect(request).not.toBeNull();

    return request!;
  }

  function expectDisplayError(response: HttpResult, code: string): void {
    const location: URL = expectConsentPage(response);

    // A code and nothing else: no text from the request reaches the page.
    expect(Array.from(location.searchParams.entries())).toEqual([
      ["error", code],
    ]);
  }

  function expectClientError(
    response: HttpResult,
    error: string,
    redirectUri: string = DEFAULT_REDIRECT_URI,
  ): URL {
    expect(response.status).toBe(302);

    const location: URL = response.location!;
    const expected: URL = new URL(redirectUri);

    expect(location.origin).toBe(expected.origin);
    expect(location.pathname).toBe(expected.pathname);
    expect(location.searchParams.get("error")).toBe(error);
    expect(
      (location.searchParams.get("error_description") || "").length,
    ).toBeGreaterThan(0);
    // RFC 9207: an error response names the issuer as well.
    expect(location.searchParams.get("iss")).toBe(harness.issuer);
    expect(location.searchParams.get("code")).toBeNull();

    return location;
  }

  describe("a good request", () => {
    it("goes to the consent screen with a ticket describing exactly what was checked", async () => {
      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        state: "af0ifjsldkj",
        scope: "mcp:read mcp:write",
        resource: harness.resource,
      });

      const request: McpOAuthAuthorizationRequest = expectTicket(response);

      expect(request).toEqual({
        clientId: client.clientId,
        clientKind: "registered",
        clientName: "Test MCP Client",
        redirectUri: DEFAULT_REDIRECT_URI,
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        state: "af0ifjsldkj",
        scopes: ["mcp:read", "mcp:write"],
        resource: harness.resource,
      });
    });

    it("may not be cached, and leaves no Referer behind", async () => {
      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("writes nothing: no grant and no code exist until a person approves", async () => {
      await harness.authorize({ clientId: client.clientId });

      expect(harness.store.count("grant")).toBe(0);
      expect(harness.store.count("token")).toBe(0);
    });

    it("needs nobody to be signed in", async () => {
      harness.signOut();

      expectTicket(await harness.authorize({ clientId: client.clientId }));
    });

    it("carries no state when the client sent none", async () => {
      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({ clientId: client.clientId }),
      );

      expect("state" in request).toBe(false);
    });

    it("accepts a request with no resource: there is only one it could mean", async () => {
      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({ clientId: client.clientId }),
      );

      expect(request.resource).toBe(harness.resource);
    });

    it.each([
      ["a trailing slash", "/mcp/"],
      ["no trailing slash", "/mcp"],
    ])(
      "accepts the resource written with %s",
      async (_label: string, path: string) => {
        const request: McpOAuthAuthorizationRequest = expectTicket(
          await harness.authorize({
            clientId: client.clientId,
            resource: `${harness.origin}${path}`,
          }),
        );

        // Whatever spelling arrived, the ticket carries the canonical one.
        expect(request.resource).toBe(harness.resource);
      },
    );

    it("is the same over POST with a form body", async () => {
      const response: HttpResult = await harness.request(
        "/mcp/oauth/authorize",
        {
          form: {
            response_type: "code",
            client_id: client.clientId,
            redirect_uri: DEFAULT_REDIRECT_URI,
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
            state: "posted",
            scope: "mcp:read",
          },
        },
      );

      const request: McpOAuthAuthorizationRequest = expectTicket(response);

      expect(request.state).toBe("posted");
      expect(request.scopes).toEqual(["mcp:read"]);
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("reads a POST from its body and never from its query string", async () => {
      // The query names a good request; the body names nothing.
      const url: string = harness.authorizeUrl({ clientId: client.clientId });

      const response: HttpResult = await harness.request(url, {
        form: { unrelated: "1" },
      });

      expectDisplayError(response, "missing_client_id");
    });
  });

  describe("what access is asked for", () => {
    async function scopesFor(
      scope: string | undefined,
    ): Promise<Array<string>> {
      return expectTicket(
        await harness.authorize({ clientId: client.clientId, scope }),
      ).scopes;
    }

    it("is read-only when the client names no scope", async () => {
      expect(await scopesFor(undefined)).toEqual(["mcp:read"]);
    });

    it("spells write out as read and write", async () => {
      expect(await scopesFor("mcp:write")).toEqual(["mcp:read", "mcp:write"]);
    });

    it("ignores scopes this server does not issue instead of refusing the request", async () => {
      expect(await scopesFor("openid profile email mcp:read")).toEqual([
        "mcp:read",
      ]);
    });

    it("is read-only when every scope named is one this server does not issue", async () => {
      expect(await scopesFor("openid profile")).toEqual(["mcp:read"]);
    });

    it("keeps offline_access, and still grants only read beside it", async () => {
      expect(await scopesFor("offline_access")).toEqual([
        "mcp:read",
        "offline_access",
      ]);
    });

    it("is written in one order however the client ordered it", async () => {
      expect(await scopesFor("offline_access mcp:write mcp:read")).toEqual([
        "mcp:read",
        "mcp:write",
        "offline_access",
      ]);
    });
  });

  describe("a client or redirect URI that cannot be verified (the open-redirect guard)", () => {
    it("never sends the browser to an unregistered redirect URI of a known client", async () => {
      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
        redirectUri: `${ATTACKER_ORIGIN}/steal`,
        state: "s",
      });

      expectDisplayError(response, "redirect_uri_mismatch");
      expect(response.headers.get("location")).not.toContain("attacker");
    });

    it("never sends the browser to the redirect URI of an unknown client", async () => {
      const response: HttpResult = await harness.authorize({
        clientId: "3b241101-e2bb-4255-8caf-4136c566a962",
        redirectUri: `${ATTACKER_ORIGIN}/steal`,
      });

      expectDisplayError(response, "unknown_client");
      expect(response.headers.get("location")).not.toContain("attacker");
    });

    it("never sends the browser to the redirect URI when everything else is wrong too", async () => {
      // A wrong redirect URI outranks every error that would be sent to it.
      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
        redirectUri: `${ATTACKER_ORIGIN}/steal`,
        responseType: "token",
        codeChallengeMethod: "plain",
        resource: "https://other.example/mcp",
      });

      expectDisplayError(response, "redirect_uri_mismatch");
    });

    it.each([
      ["a different path", "https://client.example/callback/../steal"],
      ["a sub-path", "https://client.example/callback/extra"],
      ["an added query", "https://client.example/callback?next=evil"],
      ["a different host", "https://client.example.attacker.example/callback"],
      ["a different scheme", "http://client.example/callback"],
      ["a different port", "https://client.example:8443/callback"],
      ["userinfo", "https://client.example@attacker.example/callback"],
      ["different letter case", "https://client.example/Callback"],
      ["a trailing slash", "https://client.example/callback/"],
    ])(
      "refuses a redirect URI that differs from the registered one by %s",
      async (_label: string, redirectUri: string) => {
        expectDisplayError(
          await harness.authorize({ clientId: client.clientId, redirectUri }),
          "redirect_uri_mismatch",
        );
      },
    );

    it("says so when there is no client id", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: client.clientId,
          extra: { client_id: undefined },
        }),
        "missing_client_id",
      );
    });

    it("treats a client id sent twice as not sent", async () => {
      const url: URL = new URL(
        harness.authorizeUrl({ clientId: client.clientId }),
      );

      url.searchParams.append("client_id", client.clientId);

      expectDisplayError(
        await harness.request(url.toString()),
        "missing_client_id",
      );
    });

    it.each([
      ["a word", "claude"],
      ["a URL that is not https", "http://client.example/client.json"],
      ["an https URL with no path", "https://client.example/"],
      ["an https URL with a fragment", `${DOCUMENT_CLIENT_ID}#x`],
    ])(
      "does not know a client id that is %s",
      async (_label: string, clientId: string) => {
        expectDisplayError(
          await harness.authorize({ clientId }),
          "unknown_client",
        );
      },
    );

    it("says so when there is no redirect URI, even for a client that registered only one", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: client.clientId,
          extra: { redirect_uri: undefined },
        }),
        "missing_redirect_uri",
      );
    });

    it("treats a redirect URI sent twice as not sent", async () => {
      const url: URL = new URL(
        harness.authorizeUrl({ clientId: client.clientId }),
      );

      url.searchParams.append("redirect_uri", `${ATTACKER_ORIGIN}/steal`);

      expectDisplayError(
        await harness.request(url.toString()),
        "missing_redirect_uri",
      );
    });

    it("checks the client before the redirect URI", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: "3b241101-e2bb-4255-8caf-4136c566a962",
          extra: { redirect_uri: undefined },
        }),
        "unknown_client",
      );
    });

    it("reports a database failure as a server error, and logs it", async () => {
      harness.store.intercept("client", "findOneById", (): void => {
        throw new Error("connection terminated unexpectedly");
      });

      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
      });

      /*
       * The client registered here, and it was this server that could not
       * read its own table: that is not "the client's metadata is invalid".
       */
      expectDisplayError(response, "server_error");
      expect(logger.error as jest.Mock).toHaveBeenCalled();
    });
  });

  describe("a client identified by a metadata document", () => {
    it("is resolved from its URL and marked as such in the ticket", async () => {
      harness.addMetadataDocumentClient({
        clientId: DOCUMENT_CLIENT_ID,
        clientName: "Document Client",
        clientUri: "https://client.example/",
      });

      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({ clientId: DOCUMENT_CLIENT_ID }),
      );

      expect(request.clientId).toBe(DOCUMENT_CLIENT_ID);
      expect(request.clientKind).toBe("metadata-document");
      expect(request.clientName).toBe("Document Client");
      expect(request.clientUri).toBe("https://client.example/");
    });

    it("is held to the redirect URIs in its document", async () => {
      harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });

      expectDisplayError(
        await harness.authorize({
          clientId: DOCUMENT_CLIENT_ID,
          redirectUri: `${ATTACKER_ORIGIN}/steal`,
        }),
        "redirect_uri_mismatch",
      );
    });

    it("is told apart from 'invalid' when the document could not be fetched", async () => {
      harness.failMetadataDocument(
        DOCUMENT_CLIENT_ID,
        new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The client metadata document could not be retrieved (HTTP 503).",
        ),
      );

      expectDisplayError(
        await harness.authorize({ clientId: DOCUMENT_CLIENT_ID }),
        "client_metadata_unavailable",
      );
    });

    it("is refused when the document is there but unusable", async () => {
      harness.failMetadataDocument(
        DOCUMENT_CLIENT_ID,
        new McpOAuthError(
          McpOAuthErrorCode.InvalidClientMetadata,
          "The client metadata document's client_id does not match the URL it was fetched from.",
        ),
      );

      const response: HttpResult = await harness.authorize({
        clientId: DOCUMENT_CLIENT_ID,
      });

      expectDisplayError(response, "client_metadata_invalid");
      // The reason stays on the server; only the code travels.
      expect(response.headers.get("location")).not.toContain("does%20not");
    });

    it("is an unknown client on an instance with metadata documents switched off", async () => {
      harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });
      harness.setClientIdMetadataDocumentEnabled(false);

      expectDisplayError(
        await harness.authorize({ clientId: DOCUMENT_CLIENT_ID }),
        "unknown_client",
      );
    });
  });

  describe("a loopback redirect URI", () => {
    let nativeClient: RegisteredTestClient;

    beforeEach(async () => {
      nativeClient = await harness.register({
        redirect_uris: ["http://127.0.0.1/callback"],
      });
    });

    it("matches on any port, because the client cannot know its port in advance", async () => {
      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({
          clientId: nativeClient.clientId,
          redirectUri: "http://127.0.0.1:53211/callback",
        }),
      );

      // The ticket carries the URI the client is actually listening on.
      expect(request.redirectUri).toBe("http://127.0.0.1:53211/callback");
    });

    it("still has to agree on the path", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: nativeClient.clientId,
          redirectUri: "http://127.0.0.1:53211/other",
        }),
        "redirect_uri_mismatch",
      );
    });

    it("does not treat localhost and 127.0.0.1 as the same host", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: nativeClient.clientId,
          redirectUri: "http://localhost:53211/callback",
        }),
        "redirect_uri_mismatch",
      );
    });

    it("relaxes the port for loopback only", async () => {
      expectDisplayError(
        await harness.authorize({
          clientId: client.clientId,
          redirectUri: "https://client.example:53211/callback",
        }),
        "redirect_uri_mismatch",
      );
    });
  });

  describe("a verified client with something else wrong", () => {
    it.each<[string, Partial<AuthorizeParameters>, string]>([
      [
        "no response_type",
        { extra: { response_type: undefined } },
        "invalid_request",
      ],
      [
        "a response_type this server does not offer",
        { responseType: "token" },
        "unsupported_response_type",
      ],
      [
        "no code_challenge",
        { extra: { code_challenge: undefined } },
        "invalid_request",
      ],
      [
        "no code_challenge_method (which would default to plain)",
        { extra: { code_challenge_method: undefined } },
        "invalid_request",
      ],
      [
        "the plain challenge method",
        { codeChallengeMethod: "plain" },
        "invalid_request",
      ],
      [
        "a challenge that is not 43 base64url characters",
        { codeChallenge: "too-short" },
        "invalid_request",
      ],
      [
        "a resource on another host",
        { resource: "https://other.example/mcp" },
        "invalid_target",
      ],
      [
        "a resource on another path",
        { resource: "REPLACED_WITH_ORIGIN/api" },
        "invalid_target",
      ],
      [
        "a scope that is not a scope list",
        { scope: 'mcp:read "quoted"' },
        "invalid_scope",
      ],
      [
        "a scope with two spaces in a row",
        { scope: "mcp:read  mcp:write" },
        "invalid_scope",
      ],
    ])(
      "sends %s to the client's redirect URI",
      async (
        _label: string,
        parameters: Partial<AuthorizeParameters>,
        error: string,
      ) => {
        const response: HttpResult = await harness.authorize({
          clientId: client.clientId,
          state: "client-state-123",
          ...parameters,
          ...(parameters.resource
            ? {
                resource: parameters.resource.replace(
                  "REPLACED_WITH_ORIGIN",
                  harness.origin,
                ),
              }
            : {}),
        });

        const location: URL = expectClientError(response, error);

        // The client finds which of its flows failed by this.
        expect(location.searchParams.get("state")).toBe("client-state-123");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      },
    );

    it("keeps the redirect URI's own query when it adds the error", async () => {
      const withQuery: RegisteredTestClient = await harness.register({
        redirect_uris: ["https://client.example/callback?tenant=acme"],
      });

      const location: URL = expectClientError(
        await harness.authorize({
          clientId: withQuery.clientId,
          redirectUri: "https://client.example/callback?tenant=acme",
          responseType: "token",
        }),
        "unsupported_response_type",
      );

      expect(location.searchParams.get("tenant")).toBe("acme");
    });

    it("sends a private-use scheme its error too", async () => {
      const desktop: RegisteredTestClient = await harness.register({
        redirect_uris: ["cursor://anysphere.cursor-retrieval/oauth/callback"],
      });

      const response: HttpResult = await harness.authorize({
        clientId: desktop.clientId,
        redirectUri: "cursor://anysphere.cursor-retrieval/oauth/callback",
        responseType: "token",
      });

      expect(response.status).toBe(302);
      expect(response.location!.protocol).toBe("cursor:");
      expect(response.location!.searchParams.get("error")).toBe(
        "unsupported_response_type",
      );
    });

    it("refuses a state longer than it can carry, without echoing it", async () => {
      const location: URL = expectClientError(
        await harness.authorize({
          clientId: client.clientId,
          state: "s".repeat(1025),
        }),
        "invalid_request",
      );

      expect(location.searchParams.get("state")).toBeNull();
    });

    it("accepts a state of exactly the longest length", async () => {
      const state: string = "s".repeat(1024);

      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({ clientId: client.clientId, state }),
      );

      expect(request.state).toBe(state);
    });

    it("refuses a state sent twice, and echoes neither", async () => {
      const url: URL = new URL(
        harness.authorizeUrl({ clientId: client.clientId, state: "one" }),
      );

      url.searchParams.append("state", "two");

      const location: URL = expectClientError(
        await harness.request(url.toString()),
        "invalid_request",
      );

      expect(location.searchParams.get("state")).toBeNull();
    });

    it("treats a response_type sent twice as not sent", async () => {
      const url: URL = new URL(
        harness.authorizeUrl({ clientId: client.clientId }),
      );

      url.searchParams.append("response_type", "code");

      expectClientError(
        await harness.request(url.toString()),
        "invalid_request",
      );
    });

    it("treats a code_challenge sent twice as not sent", async () => {
      const url: URL = new URL(
        harness.authorizeUrl({ clientId: client.clientId }),
      );

      url.searchParams.append(
        "code_challenge",
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      );

      expectClientError(
        await harness.request(url.toString()),
        "invalid_request",
      );
    });

    it("passes a state through byte for byte", async () => {
      const state: string = `a b+c/d=e&f?g#h%20${String.fromCodePoint(0xe9)}`;

      const request: McpOAuthAuthorizationRequest = expectTicket(
        await harness.authorize({ clientId: client.clientId, state }),
      );

      expect(request.state).toBe(state);
    });
  });

  describe("a request too large to carry to the consent screen", () => {
    it("is shown to the person instead of being sent on truncated", async () => {
      const longRedirectUri: string = `https://client.example/${"p".repeat(990)}`;
      const wideCharacter: string = String.fromCodePoint(0x4e2d);

      const bigClient: RegisteredTestClient = await harness.register({
        client_name: wideCharacter.repeat(100),
        redirect_uris: [longRedirectUri],
      });

      const response: HttpResult = await harness.authorize({
        clientId: bigClient.clientId,
        redirectUri: longRedirectUri,
        state: wideCharacter.repeat(1024),
      });

      expectDisplayError(response, "request_too_large");
    });
  });

  describe("rate limiting", () => {
    it("answers the three hundred and first request in a window with a plain 429", async () => {
      harness.prefillRateLimit("authorize", 300);

      const response: HttpResult = await harness.authorize({
        clientId: client.clientId,
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(response.text).toBe("Too many requests. Please try again later.");
      expect(
        Number(response.headers.get("retry-after")),
      ).toBeGreaterThanOrEqual(1);
      expect(response.headers.get("cache-control")).toBe("no-store");
      // Not a redirect: bouncing a flood through the consent screen moves the load.
      expect(response.location).toBeNull();
    });

    it("lets the three hundredth through", async () => {
      harness.prefillRateLimit("authorize", 299);

      expectTicket(await harness.authorize({ clientId: client.clientId }));
    });

    it("limits the POST form the same way", async () => {
      harness.prefillRateLimit("authorize", 300);

      const response: HttpResult = await harness.request(
        "/mcp/oauth/authorize",
        { form: { client_id: client.clientId } },
      );

      expect(response.status).toBe(429);
    });

    it("carries on unthrottled when Redis is down: an outage must not stop sign-in", async () => {
      harness.setRedisAvailable(false);

      expectTicket(await harness.authorize({ clientId: client.clientId }));
    });

    it("has its own budget, separate from registration's", async () => {
      harness.prefillRateLimit("register", 10_000);

      expectTicket(await harness.authorize({ clientId: client.clientId }));
    });
  });

  describe("when OAuth is switched off", () => {
    it("is the app's ordinary 404 for GET and POST", async () => {
      harness.setOAuthEnabled(false);

      const get: HttpResult = await harness.authorize({
        clientId: client.clientId,
      });
      const post: HttpResult = await harness.request("/mcp/oauth/authorize", {
        form: { client_id: client.clientId },
      });

      for (const response of [get, post]) {
        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
        expect(response.location).toBeNull();
      }
    });
  });
});
