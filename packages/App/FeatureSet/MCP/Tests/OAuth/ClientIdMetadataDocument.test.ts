/**
 * Client ID Metadata Document tests.
 *
 * Reading a client's metadata document is an outbound request to an address
 * chosen by whoever opens the authorization URL, before anybody has signed
 * in. These pin the two halves of that: which client ids are document URLs at
 * all, and that the fetch is made as locked down as the file says it is -
 * strict egress policy, pinned connection, no redirects, no proxy, bounded
 * time and size - with what it learns cached, failures included.
 *
 * No request leaves the process: the egress guard and the HTTP client are
 * both replaced.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import http from "http";
import https from "https";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
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

import ClientIdMetadataDocument, {
  MAX_CLIENT_ID_URL_LENGTH,
} from "../../OAuth/ClientIdMetadataDocument";
import {
  McpOAuthClientKind,
  ResolvedMcpOAuthClient,
} from "../../OAuth/ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import {
  CLAUDE,
  CLAUDE_CODE,
  REAL_WORLD_CLIENTS,
  RealWorldClientFixture,
} from "./RealWorldClientFixtures";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

const CLIENT_ID: string = "https://client.example/oauth/metadata.json";
const OTHER_CLIENT_ID: string = "https://other.example/oauth/metadata.json";

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

const UNAVAILABLE_DESCRIPTION: string =
  "The client metadata document could not be retrieved.";

function documentFor(
  clientId: string,
  overrides?: Record<string, unknown>,
): JSONObject {
  return {
    client_id: clientId,
    client_name: "Example Client",
    client_uri: "https://client.example/",
    redirect_uris: [
      "https://client.example/callback",
      "http://127.0.0.1/callback",
    ],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...overrides,
  } as JSONObject;
}

function okResponse(
  document: unknown,
  headers?: Headers,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    document as JSONObject,
    headers || {},
  );
}

async function captureRejection(
  promise: Promise<unknown>,
): Promise<McpOAuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof McpOAuthError) {
      return err;
    }

    throw err;
  }

  throw new Error("Expected the promise to reject with an McpOAuthError.");
}

interface RequestOptionsSeen {
  url: { toString: () => string };
  headers: Record<string, string>;
  options: {
    doNotFollowRedirects: boolean;
    disableProxy: boolean;
    timeout: number;
    totalTimeoutInMs: number;
    maxContentLength: number;
    httpAgent: unknown;
    httpsAgent: unknown;
    dispatchUrl: string;
  };
}

describe("ClientIdMetadataDocument", () => {
  describe("isMetadataDocumentUrl", () => {
    it.each([
      ["a document path", "https://client.example/oauth/metadata.json"],
      ["a single path segment", "https://client.example/client"],
      ["a port", "https://client.example:8443/a/b/c"],
      ["a query string", "https://client.example/metadata?version=2"],
      [
        "Claude Code's published id",
        "https://claude.ai/oauth/claude-code-client-metadata",
      ],
      ["a dot-file segment", "https://client.example/.well-known/client.json"],
      ["dots inside a segment", "https://client.example/a.b/c..d/v1.0"],
      ["three dots as a segment", "https://client.example/.../client"],
      ["a trailing slash after a segment", "https://client.example/client/"],
    ])("accepts an https URL with %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(true);
    });

    it.each(REAL_WORLD_CLIENTS)(
      "accepts the client id $name publishes",
      (fixture: RealWorldClientFixture) => {
        expect(
          ClientIdMetadataDocument.isMetadataDocumentUrl(fixture.clientId),
        ).toBe(true);
      },
    );

    it("accepts the three real client ids by name, so a rule change that drops one is seen", () => {
      for (const clientId of [
        "https://vscode.dev/oauth/client-metadata.json",
        "https://claude.ai/oauth/mcp-oauth-client-metadata",
        "https://claude.ai/oauth/claude-code-client-metadata",
      ]) {
        expect(ClientIdMetadataDocument.isMetadataDocumentUrl(clientId)).toBe(
          true,
        );
      }
    });

    it("does not judge where the host leads: the fetch does that", () => {
      // Shape only. These are refused by the egress guard when resolved.
      expect(
        ClientIdMetadataDocument.isMetadataDocumentUrl(
          "https://127.0.0.1/metadata.json",
        ),
      ).toBe(true);
      expect(
        ClientIdMetadataDocument.isMetadataDocumentUrl(
          "https://localhost/metadata.json",
        ),
      ).toBe(true);
    });

    it.each([
      ["plain http", "http://client.example/oauth/metadata.json"],
      ["an upper-case scheme", "HTTPS://client.example/oauth/metadata.json"],
      ["another scheme", "ftp://client.example/oauth/metadata.json"],
      ["a private-use scheme", "cursor://client.example/metadata.json"],
      ["no scheme", "client.example/oauth/metadata.json"],
      ["a scheme-relative URL", "//client.example/oauth/metadata.json"],
      ["https with no host", "https://"],
      ["a UUID", "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90"],
      ["an empty string", ""],
    ])("refuses %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it.each([
      ["no path at all", "https://client.example"],
      ["only the root path", "https://client.example/"],
      ["only a query", "https://client.example/?client=1"],
      ["only a query and no slash", "https://client.example?client=1"],
    ])("refuses an origin with %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it.each([
      ["a fragment", "https://client.example/metadata.json#section"],
      ["an empty fragment", "https://client.example/metadata.json#"],
      ["a fragment after a query", "https://client.example/metadata?x=1#y"],
    ])("refuses %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it.each([
      ["a user and password", "https://user:pass@client.example/metadata.json"],
      ["a user alone", "https://user@client.example/metadata.json"],
      ["an empty user and a password", "https://:pass@client.example/metadata"],
    ])("refuses credentials: %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it.each([
      ["a single-dot segment", "https://client.example/./metadata.json"],
      ["a double-dot segment", "https://client.example/a/../metadata.json"],
      ["a trailing single dot", "https://client.example/a/."],
      ["a trailing double dot", "https://client.example/a/.."],
      ["a leading double dot", "https://client.example/../metadata.json"],
      ["an encoded single dot", "https://client.example/%2e/metadata.json"],
      ["an encoded double dot", "https://client.example/a/%2e%2e/metadata"],
      ["an upper-case encoded dot", "https://client.example/a/%2E%2E/metadata"],
      ["a half-encoded double dot", "https://client.example/a/.%2e/metadata"],
      ["the other half encoded", "https://client.example/a/%2E./metadata"],
    ])("refuses %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it("judges dot segments on the path only, not on the query", () => {
      expect(
        ClientIdMetadataDocument.isMetadataDocumentUrl(
          "https://client.example/metadata.json?next=/a/../b",
        ),
      ).toBe(true);
    });

    it.each([
      ["a space", "https://client.example/meta data.json"],
      ["a trailing space", "https://client.example/metadata.json "],
      ["a leading space", " https://client.example/metadata.json"],
      ["a tab", "https://client.example/meta\tdata.json"],
      ["a trailing newline", "https://client.example/metadata.json\n"],
      ["a NUL", "https://client.example/metadata.json\x00"],
      ["a non-ASCII path", "https://client.example/caf\xe9.json"],
      ["a non-ASCII host", "https://cli\xebnt.example/metadata.json"],
    ])("refuses %s", (_name: string, value: string) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });

    it("holds the length limit at 500 characters", () => {
      const prefix: string = "https://client.example/";
      const atLimit: string = `${prefix}${"a".repeat(MAX_CLIENT_ID_URL_LENGTH - prefix.length)}`;

      expect(MAX_CLIENT_ID_URL_LENGTH).toBe(500);
      expect(atLimit).toHaveLength(500);
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(atLimit)).toBe(
        true,
      );
      expect(
        ClientIdMetadataDocument.isMetadataDocumentUrl(`${atLimit}a`),
      ).toBe(false);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 443],
      ["a boolean", true],
      ["an object", { href: CLIENT_ID }],
      ["an array", [CLIENT_ID]],
    ])("refuses %s", (_name: string, value: unknown) => {
      expect(ClientIdMetadataDocument.isMetadataDocumentUrl(value)).toBe(false);
    });
  });

  describe("resolve", () => {
    let guardSpy: jest.SpyInstance;
    let getSpy: jest.SpyInstance;
    let cacheSetSpy: jest.SpyInstance;
    let dateNowSpy: jest.SpyInstance;

    let now: number = 0;

    const pinnedHttpAgent: http.Agent = new http.Agent();
    const pinnedHttpsAgent: https.Agent = new https.Agent();

    /*
     * What the guard hands back as "the URL that was validated". It differs
     * from the raw client id on purpose, so a request dispatched to it can
     * only have taken it from the guard.
     */
    const VALIDATED_HREF: string = `${CLIENT_ID}?validated=1`;

    function requestSeen(callIndex: number = 0): RequestOptionsSeen {
      return getSpy.mock.calls[callIndex]![0] as RequestOptionsSeen;
    }

    // The TTL of the most recent cache write.
    function lastCacheTtl(): number {
      const calls: Array<Array<unknown>> = cacheSetSpy.mock.calls;

      return calls[calls.length - 1]![2] as number;
    }

    beforeEach(() => {
      ClientIdMetadataDocument.clearCache();
      (logger.warn as unknown as jest.Mock).mockClear();

      now = 1_800_000_000_000;
      dateNowSpy = jest.spyOn(Date, "now").mockImplementation((): number => {
        return now;
      }) as unknown as jest.SpyInstance;

      guardSpy = jest.spyOn(
        DataSourceEgressGuard,
        "assertUrlAllowedAndPin",
      ) as unknown as jest.SpyInstance;

      guardSpy.mockImplementation(async (): Promise<unknown> => {
        return {
          url: new URL(VALIDATED_HREF),
          addresses: [{ address: "93.184.216.34", family: 4 }],
          httpAgent: pinnedHttpAgent,
          httpsAgent: pinnedHttpsAgent,
        };
      });

      getSpy = jest.spyOn(API, "get") as unknown as jest.SpyInstance;

      getSpy.mockImplementation(
        async (options: RequestOptionsSeen): Promise<unknown> => {
          return okResponse(documentFor(options.url.toString()));
        },
      );

      cacheSetSpy = jest.spyOn(
        InMemoryTTLCache.prototype,
        "set",
      ) as unknown as jest.SpyInstance;
    });

    afterEach(() => {
      guardSpy.mockRestore();
      getSpy.mockRestore();
      cacheSetSpy.mockRestore();
      dateNowSpy.mockRestore();
      ClientIdMetadataDocument.clearCache();
    });

    it("returns the client the document describes", async () => {
      const client: ResolvedMcpOAuthClient =
        await ClientIdMetadataDocument.resolve(CLIENT_ID);

      expect(client).toEqual({
        clientId: CLIENT_ID,
        kind: McpOAuthClientKind.MetadataDocument,
        clientName: "Example Client",
        clientUri: "https://client.example/",
        redirectUris: [
          "https://client.example/callback",
          "http://127.0.0.1/callback",
        ],
        tokenEndpointAuthMethod: "none",
      });

      // A document client is public and has no row: nothing to authenticate with.
      expect("clientSecretHash" in client).toBe(false);
      expect("lastUsedAt" in client).toBe(false);
    });

    it("checks the URL against the strictest egress policy, whatever the install allows", async () => {
      await ClientIdMetadataDocument.resolve(CLIENT_ID);

      expect(guardSpy).toHaveBeenCalledTimes(1);
      expect(guardSpy).toHaveBeenCalledWith(CLIENT_ID, {
        blockPrivateAddresses: true,
        targetLabel: "Client ID metadata document URL",
        includeResolvedAddressInError: false,
      });
    });

    it("checks before it fetches", async () => {
      await ClientIdMetadataDocument.resolve(CLIENT_ID);

      expect(guardSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        getSpy.mock.invocationCallOrder[0]!,
      );
    });

    it("makes one locked-down request: no redirects, no proxy, five seconds, 64 KB", async () => {
      await ClientIdMetadataDocument.resolve(CLIENT_ID);

      expect(getSpy).toHaveBeenCalledTimes(1);

      const request: RequestOptionsSeen = requestSeen();

      expect(request.url.toString()).toBe(CLIENT_ID);
      expect(request.headers).toEqual({ Accept: "application/json" });
      expect(request.options.doNotFollowRedirects).toBe(true);
      expect(request.options.disableProxy).toBe(true);
      expect(request.options.timeout).toBe(5000);
      expect(request.options.totalTimeoutInMs).toBe(5000);
      expect(request.options.maxContentLength).toBe(64 * 1024);
    });

    it("pins the connection to the addresses the guard checked", async () => {
      await ClientIdMetadataDocument.resolve(CLIENT_ID);

      const request: RequestOptionsSeen = requestSeen();

      expect(request.options.httpAgent).toBe(pinnedHttpAgent);
      expect(request.options.httpsAgent).toBe(pinnedHttpsAgent);
      // The URL that was validated, not a second reading of the client id.
      expect(request.options.dispatchUrl).toBe(VALIDATED_HREF);
    });

    it("makes no request when the guard refuses, and does not pass on why", async () => {
      guardSpy.mockRejectedValue(
        new BadDataException(
          "Client ID metadata document URL host internal-billing.corp resolves to a private address (10.0.0.5), which is not allowed.",
        ),
      );

      const error: McpOAuthError = await captureRejection(
        ClientIdMetadataDocument.resolve(CLIENT_ID),
      );

      expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
      expect(error.getStatusCode()).toBe(503);
      expect(error.description).toBe(UNAVAILABLE_DESCRIPTION);
      expect(error.description).not.toContain("10.0.0.5");
      expect(error.description).not.toContain("private");
      expect(error.description).not.toContain("internal-billing");
      expect(getSpy).not.toHaveBeenCalled();
    });

    it("logs an unexpected failure by host only", async () => {
      const cause: Error = new Error("getaddrinfo ENOTFOUND client.example");

      guardSpy.mockRejectedValue(cause);

      await captureRejection(
        ClientIdMetadataDocument.resolve(`${CLIENT_ID}?token=secret-in-query`),
      );

      const warn: jest.Mock = logger.warn as unknown as jest.Mock;

      expect(warn).toHaveBeenCalledWith(
        "MCP OAuth: could not read the client metadata document of client.example.",
      );
      expect(warn).toHaveBeenCalledWith(cause);

      for (const call of warn.mock.calls) {
        expect(String(call[0])).not.toContain("secret-in-query");
      }
    });

    it.each([
      ["404", 404],
      ["500", 500],
      ["403", 403],
    ])(
      "treats an error response (%s) as unavailable",
      async (_name: string, statusCode: number) => {
        getSpy.mockResolvedValue(
          new HTTPErrorResponse(statusCode, { message: "nope" }, {}),
        );

        const error: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
        expect(error.description).toBe(
          `The client metadata document could not be retrieved (HTTP ${statusCode}).`,
        );
      },
    );

    it.each([
      ["a redirect that was not followed", 302],
      ["a permanent redirect", 301],
      ["no content", 204],
      ["created", 201],
    ])(
      "treats %s as unavailable: only a 200 is a document",
      async (_name: string, statusCode: number) => {
        getSpy.mockResolvedValue(
          new HTTPResponse<JSONObject>(statusCode, documentFor(CLIENT_ID), {
            location: "https://evil.example/metadata.json",
          }),
        );

        const error: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
        expect(error.description).toBe(
          `The client metadata document could not be retrieved (HTTP ${statusCode}).`,
        );
        // One request: the redirect target is never asked.
        expect(getSpy).toHaveBeenCalledTimes(1);
      },
    );

    it("treats a request that throws as unavailable", async () => {
      getSpy.mockRejectedValue(new Error("socket hang up"));

      const error: McpOAuthError = await captureRejection(
        ClientIdMetadataDocument.resolve(CLIENT_ID),
      );

      expect(error.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
      expect(error.description).toBe(UNAVAILABLE_DESCRIPTION);
      expect(error.description).not.toContain("socket");
    });

    it.each([
      [
        "names another URL as its client_id",
        documentFor(OTHER_CLIENT_ID),
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "has no client_id",
        documentFor(CLIENT_ID, { client_id: undefined }),
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "carries a client secret",
        documentFor(CLIENT_ID, { client_secret: "s3cret" }),
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "asks to authenticate with a secret",
        documentFor(CLIENT_ID, {
          token_endpoint_auth_method: "client_secret_basic",
        }),
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "is a JSON array",
        [documentFor(CLIENT_ID)],
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "is not JSON at all",
        "<html><body>Not found</body></html>",
        McpOAuthErrorCode.InvalidClientMetadata,
      ],
      [
        "lists no redirect URIs",
        documentFor(CLIENT_ID, { redirect_uris: [] }),
        McpOAuthErrorCode.InvalidRedirectUri,
      ],
      [
        "lists a redirect URI that may not be registered",
        documentFor(CLIENT_ID, {
          redirect_uris: ["http://client.example/callback"],
        }),
        McpOAuthErrorCode.InvalidRedirectUri,
      ],
    ])(
      "refuses a document that %s",
      async (_name: string, document: unknown, code: McpOAuthErrorCode) => {
        getSpy.mockResolvedValue(okResponse(document));

        const error: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(error.code).toBe(code);
        expect(error.code).not.toBe(McpOAuthErrorCode.TemporarilyUnavailable);
      },
    );

    describe("the documents real MCP clients publish", () => {
      it.each(REAL_WORLD_CLIENTS)(
        "resolves $name from the document served at its client id",
        async (fixture: RealWorldClientFixture) => {
          getSpy.mockResolvedValue(
            okResponse(fixture.document, {
              "content-type": "application/json",
              "cache-control": "public, max-age=3600",
            }),
          );

          const client: ResolvedMcpOAuthClient =
            await ClientIdMetadataDocument.resolve(fixture.clientId);

          expect(client).toEqual({
            clientId: fixture.clientId,
            kind: McpOAuthClientKind.MetadataDocument,
            clientName: fixture.expected.clientName,
            clientUri: fixture.expected.clientUri,
            redirectUris: fixture.expected.redirectUris,
            tokenEndpointAuthMethod: "none",
          });
          expect(guardSpy).toHaveBeenCalledWith(
            fixture.clientId,
            expect.objectContaining({ blockPrivateAddresses: true }),
          );
          expect(requestSeen().url.toString()).toBe(fixture.clientId);
        },
      );

      it.each(REAL_WORLD_CLIENTS)(
        "refuses $name's document when another URL serves it",
        async (fixture: RealWorldClientFixture) => {
          getSpy.mockResolvedValue(okResponse(fixture.document));

          const error: McpOAuthError = await captureRejection(
            ClientIdMetadataDocument.resolve(
              "https://evil.example/oauth/client-metadata.json",
            ),
          );

          expect(error.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        },
      );

      it("keeps the two Claude clients apart, though one host serves both", async () => {
        getSpy.mockImplementation(
          async (options: RequestOptionsSeen): Promise<unknown> => {
            return okResponse(
              options.url.toString() === CLAUDE.clientId
                ? CLAUDE.document
                : CLAUDE_CODE.document,
            );
          },
        );

        const claude: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLAUDE.clientId);
        const claudeCode: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLAUDE_CODE.clientId);

        expect(claude.clientName).toBe("Claude");
        expect(claude.redirectUris).toEqual([
          "https://claude.ai/api/mcp/auth_callback",
        ]);
        expect(claudeCode.clientName).toBe("Claude Code");
        expect(claudeCode.redirectUris).toEqual([
          "http://localhost/callback",
          "http://127.0.0.1/callback",
        ]);
        expect(getSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe("caching", () => {
      it("does not fetch a document it already holds", async () => {
        const first: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);
        const second: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(second).toEqual(first);
        expect(guardSpy).toHaveBeenCalledTimes(1);
        expect(getSpy).toHaveBeenCalledTimes(1);
      });

      it("caches each client id separately", async () => {
        const first: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);
        const other: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(OTHER_CLIENT_ID);

        expect(first.clientId).toBe(CLIENT_ID);
        expect(other.clientId).toBe(OTHER_CLIENT_ID);
        expect(getSpy).toHaveBeenCalledTimes(2);

        await ClientIdMetadataDocument.resolve(CLIENT_ID);
        await ClientIdMetadataDocument.resolve(OTHER_CLIENT_ID);

        expect(getSpy).toHaveBeenCalledTimes(2);
      });

      it("hands out a copy, so a caller cannot edit what is cached", async () => {
        const first: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);

        first.redirectUris.push("https://evil.example/callback");
        first.clientName = "Tampered";

        const second: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(second.clientName).toBe("Example Client");
        expect(second.redirectUris).toEqual([
          "https://client.example/callback",
          "http://127.0.0.1/callback",
        ]);
      });

      it("fetches again once clearCache has been called", async () => {
        await ClientIdMetadataDocument.resolve(CLIENT_ID);
        ClientIdMetadataDocument.clearCache();
        await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(getSpy).toHaveBeenCalledTimes(2);
      });

      it("trusts a document for fifteen minutes by default, then reads it again", async () => {
        await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(lastCacheTtl()).toBe(15 * MINUTE_IN_MS);

        now += 15 * MINUTE_IN_MS;
        await ClientIdMetadataDocument.resolve(CLIENT_ID);
        expect(getSpy).toHaveBeenCalledTimes(1);

        now += 1;
        await ClientIdMetadataDocument.resolve(CLIENT_ID);
        expect(getSpy).toHaveBeenCalledTimes(2);
      });

      it("picks up a changed document after the cache lapses", async () => {
        await ClientIdMetadataDocument.resolve(CLIENT_ID);

        getSpy.mockResolvedValue(
          okResponse(
            documentFor(CLIENT_ID, {
              client_name: "Renamed Client",
              redirect_uris: ["https://client.example/new-callback"],
            }),
          ),
        );

        // Still the old one while it is cached.
        expect(
          (await ClientIdMetadataDocument.resolve(CLIENT_ID)).clientName,
        ).toBe("Example Client");

        now += 15 * MINUTE_IN_MS + 1;

        const refreshed: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(refreshed.clientName).toBe("Renamed Client");
        expect(refreshed.redirectUris).toEqual([
          "https://client.example/new-callback",
        ]);
      });

      it("replays a failure without asking again", async () => {
        getSpy.mockResolvedValue(new HTTPErrorResponse(404, {}, {}));

        const first: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );
        const second: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(second.code).toBe(first.code);
        expect(second.description).toBe(first.description);
        expect(guardSpy).toHaveBeenCalledTimes(1);
        expect(getSpy).toHaveBeenCalledTimes(1);
      });

      it("replays a refusal by the guard without resolving the host again", async () => {
        guardSpy.mockRejectedValue(new BadDataException("not allowed"));

        await captureRejection(ClientIdMetadataDocument.resolve(CLIENT_ID));

        const second: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(second.code).toBe(McpOAuthErrorCode.TemporarilyUnavailable);
        expect(second.description).toBe(UNAVAILABLE_DESCRIPTION);
        expect(guardSpy).toHaveBeenCalledTimes(1);
      });

      it("replays an invalid document with its own error code", async () => {
        getSpy.mockResolvedValue(okResponse(documentFor(OTHER_CLIENT_ID)));

        const first: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );
        const second: McpOAuthError = await captureRejection(
          ClientIdMetadataDocument.resolve(CLIENT_ID),
        );

        expect(first.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(second.code).toBe(McpOAuthErrorCode.InvalidClientMetadata);
        expect(second.description).toBe(first.description);
        expect(getSpy).toHaveBeenCalledTimes(1);
      });

      it("remembers a failure for one minute, then tries again", async () => {
        getSpy.mockResolvedValueOnce(new HTTPErrorResponse(503, {}, {}));

        await captureRejection(ClientIdMetadataDocument.resolve(CLIENT_ID));

        expect(lastCacheTtl()).toBe(MINUTE_IN_MS);

        now += MINUTE_IN_MS;
        await captureRejection(ClientIdMetadataDocument.resolve(CLIENT_ID));
        expect(getSpy).toHaveBeenCalledTimes(1);

        // Past the minute: asked again, and this time the document is there.
        now += 1;

        const client: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(client.clientName).toBe("Example Client");
        expect(getSpy).toHaveBeenCalledTimes(2);
      });

      it("does not let a failure for one client id affect another", async () => {
        getSpy.mockResolvedValueOnce(new HTTPErrorResponse(404, {}, {}));

        await captureRejection(ClientIdMetadataDocument.resolve(CLIENT_ID));

        const other: ResolvedMcpOAuthClient =
          await ClientIdMetadataDocument.resolve(OTHER_CLIENT_ID);

        expect(other.clientId).toBe(OTHER_CLIENT_ID);
      });
    });

    describe("how long a document is trusted", () => {
      it.each([
        ["no Cache-Control header", {}, 15 * MINUTE_IN_MS],
        [
          "max-age inside the bounds",
          { "cache-control": "max-age=3600" },
          HOUR_IN_MS,
        ],
        [
          "max-age among other directives",
          { "cache-control": "public, max-age=3600" },
          HOUR_IN_MS,
        ],
        [
          "max-age before other directives",
          { "cache-control": "max-age=3600, must-revalidate" },
          HOUR_IN_MS,
        ],
        [
          "an upper-case directive",
          { "cache-control": "MAX-AGE=3600" },
          HOUR_IN_MS,
        ],
        [
          "spaces around the equals sign",
          { "cache-control": "max-age = 3600" },
          HOUR_IN_MS,
        ],
        [
          "max-age exactly at the lower bound",
          { "cache-control": "max-age=300" },
          5 * MINUTE_IN_MS,
        ],
        [
          "max-age exactly at the upper bound",
          { "cache-control": "max-age=86400" },
          24 * HOUR_IN_MS,
        ],
        [
          "max-age below the lower bound",
          { "cache-control": "max-age=60" },
          5 * MINUTE_IN_MS,
        ],
        ["max-age of zero", { "cache-control": "max-age=0" }, 5 * MINUTE_IN_MS],
        [
          "max-age above the upper bound",
          { "cache-control": "max-age=604800" },
          24 * HOUR_IN_MS,
        ],
        [
          "an enormous max-age",
          { "cache-control": "max-age=999999999" },
          24 * HOUR_IN_MS,
        ],
        ["no-store", { "cache-control": "no-store" }, 15 * MINUTE_IN_MS],
        [
          "only s-maxage",
          { "cache-control": "s-maxage=3600" },
          15 * MINUTE_IN_MS,
        ],
        [
          "a directive that merely ends in max-age",
          { "cache-control": "x-max-age=3600" },
          15 * MINUTE_IN_MS,
        ],
        [
          "a max-age that is not a number",
          { "cache-control": "max-age=soon" },
          15 * MINUTE_IN_MS,
        ],
        [
          "a negative max-age",
          { "cache-control": "max-age=-3600" },
          15 * MINUTE_IN_MS,
        ],
        [
          "a max-age with a fraction",
          { "cache-control": "max-age=3600.5" },
          15 * MINUTE_IN_MS,
        ],
        [
          "a max-age too long to be a real number of seconds",
          { "cache-control": "max-age=12345678901" },
          15 * MINUTE_IN_MS,
        ],
        ["an empty header", { "cache-control": "" }, 15 * MINUTE_IN_MS],
      ])(
        "with %s",
        async (_name: string, headers: Headers, expectedTtlInMs: number) => {
          getSpy.mockResolvedValue(okResponse(documentFor(CLIENT_ID), headers));

          await ClientIdMetadataDocument.resolve(CLIENT_ID);

          expect(lastCacheTtl()).toBe(expectedTtlInMs);
        },
      );

      it("ignores a Cache-Control header that is not a single string", async () => {
        getSpy.mockResolvedValue(
          okResponse(documentFor(CLIENT_ID), {
            "cache-control": ["max-age=3600"],
          } as unknown as Headers),
        );

        await ClientIdMetadataDocument.resolve(CLIENT_ID);

        expect(lastCacheTtl()).toBe(15 * MINUTE_IN_MS);
      });
    });
  });
});
