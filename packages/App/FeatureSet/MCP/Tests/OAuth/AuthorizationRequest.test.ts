/**
 * Authorization request tests.
 *
 * Three things are pinned here.
 *
 * The two stages, and who hears about a failure in each: until the client and
 * its redirect URI are verified a problem is shown to the PERSON (as a code,
 * on OneUptime's own page); after that it is the CLIENT's to hear about, as an
 * OAuth error.
 *
 * What a request has to contain: PKCE with S256 and nothing weaker, this MCP
 * server as its resource, and scopes that are read leniently.
 *
 * And the ticket that carries the checked request through the browser: that
 * it round-trips every field, lapses, cannot be altered, and is not
 * interchangeable with the other token signed from the same secret.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import fs from "fs";
import path from "path";

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

import AuthorizationRequest, {
  AuthorizationDisplayError,
  AuthorizationDisplayErrorCode,
  MAX_STATE_LENGTH,
  McpOAuthAuthorizationRequest,
} from "../../OAuth/AuthorizationRequest";
import {
  McpOAuthClientKind,
  ResolvedMcpOAuthClient,
} from "../../OAuth/ClientMetadata";
import ClientResolver from "../../OAuth/ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import McpDelegationToken from "Common/Server/Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthSignedToken from "Common/Server/Utils/Mcp/McpOAuthSignedToken";
import Email from "Common/Types/Email";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";
import McpOAuthPendingAuthorization from "Common/UI/Utils/McpOAuthPendingAuthorization";

const REGISTERED_CLIENT_ID: string = "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90";
const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/metadata.json";
const REDIRECT_URI: string = "https://client.example/callback";
const LOOPBACK_REDIRECT_URI: string = "http://127.0.0.1/callback";

// RFC 7636 appendix B.
const CODE_CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const TEN_MINUTES_IN_MS: number = 10 * 60 * 1000;
const FIVE_MINUTES_IN_MS: number = 5 * 60 * 1000;

const TICKET_SHAPE: RegExp = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

function registeredClient(
  overrides?: Partial<ResolvedMcpOAuthClient>,
): ResolvedMcpOAuthClient {
  return {
    clientId: REGISTERED_CLIENT_ID,
    kind: McpOAuthClientKind.Registered,
    clientName: "Example Client",
    redirectUris: [REDIRECT_URI, LOOPBACK_REDIRECT_URI],
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
    ...overrides,
  };
}

function validParameters(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    response_type: "code",
    client_id: REGISTERED_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    ...overrides,
  };
}

function without(
  parameters: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...parameters };

  delete copy[name];

  return copy;
}

function parse(
  parameters: Record<string, unknown>,
  client?: ResolvedMcpOAuthClient,
): McpOAuthAuthorizationRequest {
  return AuthorizationRequest.parse({
    parameters,
    client: client || registeredClient(),
    redirectUri: REDIRECT_URI,
  });
}

function captureOAuthError(action: () => unknown): McpOAuthError {
  try {
    action();
  } catch (err) {
    if (err instanceof McpOAuthError) {
      return err;
    }

    throw err;
  }

  throw new Error("Expected an McpOAuthError to be thrown.");
}

async function captureDisplayError(
  promise: Promise<unknown>,
): Promise<AuthorizationDisplayError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthorizationDisplayError) {
      return err;
    }

    throw err;
  }

  throw new Error("Expected an AuthorizationDisplayError to be thrown.");
}

function fullRequest(
  overrides?: Partial<McpOAuthAuthorizationRequest>,
): McpOAuthAuthorizationRequest {
  return {
    clientId: DOCUMENT_CLIENT_ID,
    clientKind: McpOAuthClientKind.MetadataDocument,
    clientName: "Example Client",
    clientUri: "https://client.example/",
    redirectUri: REDIRECT_URI,
    codeChallenge: CODE_CHALLENGE,
    state: "state-123",
    scopes: [
      McpOAuthScope.Read,
      McpOAuthScope.Write,
      McpOAuthScope.OfflineAccess,
    ],
    resource: McpOAuthConfig.getResource(),
    ...overrides,
  };
}

// A ticket with the same signature scheme but hand-picked claims.
function ticketWithClaims(claims: Record<string, unknown>): string {
  const ticket: string | null = McpOAuthSignedToken.sign({
    purpose: {
      keyDerivationLabel: "oneuptime:mcp:oauth:authorization-request:v1",
      maxLength: 6000,
    },
    claims: claims as never,
    expiresInSeconds: 600,
    now: NOW,
  });

  if (!ticket) {
    throw new Error("Could not sign the test ticket.");
  }

  return ticket;
}

function validClaims(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ci: REGISTERED_CLIENT_ID,
    ck: "registered",
    cn: "Example Client",
    ru: REDIRECT_URI,
    cc: CODE_CHALLENGE,
    sc: "mcp:read",
    rs: McpOAuthConfig.getResource(),
    ...overrides,
  };
}

describe("AuthorizationRequest", () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(
      ClientResolver,
      "resolve",
    ) as unknown as jest.SpyInstance;
    resolveSpy.mockResolvedValue(registeredClient());
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  describe("AuthorizationDisplayError", () => {
    it("carries a code and nothing a link's author could have written", () => {
      const error: AuthorizationDisplayError = new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.UnknownClient,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("AuthorizationDisplayError");
      expect(error.code).toBe("unknown_client");
      expect(error.message).toBe("unknown_client");
    });

    it("uses the codes the consent page has wording for", () => {
      const codes: Array<string> = Object.values(AuthorizationDisplayErrorCode);

      expect(codes).toEqual([
        "oauth_disabled",
        "missing_client_id",
        "unknown_client",
        "client_metadata_unavailable",
        "client_metadata_invalid",
        "missing_redirect_uri",
        "redirect_uri_mismatch",
        "request_too_large",
        "server_error",
      ]);

      /*
       * The page shows fixed wording per code and falls back to a generic
       * error for a code it does not know, so a code missing from its list
       * would silently lose its explanation.
       */
      const consentPageUtil: string = fs.readFileSync(
        path.join(__dirname, "../../../Accounts/src/Utils/McpAuthorize.ts"),
        "utf8",
      );

      for (const code of codes) {
        expect(consentPageUtil).toContain(`"${code}"`);
      }
    });
  });

  describe("resolveClientAndRedirectUri (stage one: shown to the person)", () => {
    it("returns the client and the redirect URI that was asked for", async () => {
      const result: { client: ResolvedMcpOAuthClient; redirectUri: string } =
        await AuthorizationRequest.resolveClientAndRedirectUri(
          validParameters(),
        );

      expect(resolveSpy).toHaveBeenCalledWith(REGISTERED_CLIENT_ID);
      expect(result.client).toEqual(registeredClient());
      expect(result.redirectUri).toBe(REDIRECT_URI);
    });

    it("returns the redirect URI as requested, port included, for a loopback match", async () => {
      const requested: string = "http://127.0.0.1:53817/callback";

      const result: { client: ResolvedMcpOAuthClient; redirectUri: string } =
        await AuthorizationRequest.resolveClientAndRedirectUri(
          validParameters({ redirect_uri: requested }),
        );

      // The code is delivered to the port the client is listening on.
      expect(result.redirectUri).toBe(requested);
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["repeated", [REGISTERED_CLIENT_ID, REGISTERED_CLIENT_ID]],
      ["a number", 42],
      ["null", null],
    ])(
      "says missing_client_id when client_id is %s, without looking anything up",
      async (_name: string, value: unknown) => {
        const error: AuthorizationDisplayError = await captureDisplayError(
          AuthorizationRequest.resolveClientAndRedirectUri(
            validParameters({ client_id: value }),
          ),
        );

        expect(error.code).toBe(AuthorizationDisplayErrorCode.MissingClientId);
        expect(resolveSpy).not.toHaveBeenCalled();
      },
    );

    it("says unknown_client when there is no such client", async () => {
      resolveSpy.mockResolvedValue(null);

      const error: AuthorizationDisplayError = await captureDisplayError(
        AuthorizationRequest.resolveClientAndRedirectUri(validParameters()),
      );

      expect(error.code).toBe(AuthorizationDisplayErrorCode.UnknownClient);
    });

    it("says unknown_client before it says anything about the redirect URI", async () => {
      resolveSpy.mockResolvedValue(null);

      const error: AuthorizationDisplayError = await captureDisplayError(
        AuthorizationRequest.resolveClientAndRedirectUri(
          without(validParameters(), "redirect_uri"),
        ),
      );

      expect(error.code).toBe(AuthorizationDisplayErrorCode.UnknownClient);
    });

    it("says client_metadata_unavailable when the document could not be read", async () => {
      resolveSpy.mockRejectedValue(
        new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The client metadata document could not be retrieved (HTTP 503).",
        ),
      );

      const error: AuthorizationDisplayError = await captureDisplayError(
        AuthorizationRequest.resolveClientAndRedirectUri(
          validParameters({ client_id: DOCUMENT_CLIENT_ID }),
        ),
      );

      expect(error.code).toBe(
        AuthorizationDisplayErrorCode.ClientMetadataUnavailable,
      );
    });

    it.each([
      [
        "names another client",
        new McpOAuthError(McpOAuthErrorCode.InvalidClientMetadata, "mismatch"),
      ],
      [
        "lists an unusable redirect URI",
        new McpOAuthError(McpOAuthErrorCode.InvalidRedirectUri, "bad uri"),
      ],
    ])(
      "says client_metadata_invalid when the document %s",
      async (_name: string, cause: Error) => {
        resolveSpy.mockRejectedValue(cause);

        const error: AuthorizationDisplayError = await captureDisplayError(
          AuthorizationRequest.resolveClientAndRedirectUri(
            validParameters({ client_id: DOCUMENT_CLIENT_ID }),
          ),
        );

        expect(error.code).toBe(
          AuthorizationDisplayErrorCode.ClientMetadataInvalid,
        );
        // A code only: none of the cause travels with it.
        expect(error.message).toBe("client_metadata_invalid");
      },
    );

    it("does not blame the client when the lookup itself fails", async () => {
      /*
       * "The database could not be asked" is not "the client's description
       * of itself is invalid". The failure goes up as it is, so the endpoint
       * can log it and show "something went wrong on our side" instead of
       * telling a person their client is broken.
       */
      const cause: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");

      resolveSpy.mockRejectedValue(cause);

      let thrown: unknown;

      try {
        await AuthorizationRequest.resolveClientAndRedirectUri(
          validParameters({ client_id: DOCUMENT_CLIENT_ID }),
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBe(cause);
      expect(thrown).not.toBeInstanceOf(AuthorizationDisplayError);
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["repeated", [REDIRECT_URI, "https://evil.example/callback"]],
      ["a number", 1],
    ])(
      "says missing_redirect_uri when redirect_uri is %s",
      async (_name: string, value: unknown) => {
        const error: AuthorizationDisplayError = await captureDisplayError(
          AuthorizationRequest.resolveClientAndRedirectUri(
            validParameters({ redirect_uri: value }),
          ),
        );

        expect(error.code).toBe(
          AuthorizationDisplayErrorCode.MissingRedirectUri,
        );
      },
    );

    it("requires redirect_uri even from a client that registered only one", async () => {
      resolveSpy.mockResolvedValue(
        registeredClient({ redirectUris: [REDIRECT_URI] }),
      );

      const error: AuthorizationDisplayError = await captureDisplayError(
        AuthorizationRequest.resolveClientAndRedirectUri(
          without(validParameters(), "redirect_uri"),
        ),
      );

      expect(error.code).toBe(AuthorizationDisplayErrorCode.MissingRedirectUri);
    });

    it.each([
      ["another site", "https://evil.example/callback"],
      ["another path on the same host", "https://client.example/other"],
      ["the registered URI with a query added", `${REDIRECT_URI}?next=evil`],
      ["a loopback host that was not registered", "http://localhost/callback"],
      ["a javascript: URI", "javascript:alert(1)"],
      ["the registered URI with a trailing space", `${REDIRECT_URI} `],
    ])(
      "says redirect_uri_mismatch for %s",
      async (_name: string, value: string) => {
        const error: AuthorizationDisplayError = await captureDisplayError(
          AuthorizationRequest.resolveClientAndRedirectUri(
            validParameters({ redirect_uri: value }),
          ),
        );

        expect(error.code).toBe(
          AuthorizationDisplayErrorCode.RedirectUriMismatch,
        );
      },
    );

    it("says redirect_uri_mismatch for a client with no redirect URIs at all", async () => {
      resolveSpy.mockResolvedValue(registeredClient({ redirectUris: [] }));

      const error: AuthorizationDisplayError = await captureDisplayError(
        AuthorizationRequest.resolveClientAndRedirectUri(validParameters()),
      );

      expect(error.code).toBe(
        AuthorizationDisplayErrorCode.RedirectUriMismatch,
      );
    });

    it("does not look at anything beyond the client and where to send it", async () => {
      // Everything else is wrong; none of it is this stage's business.
      const result: { client: ResolvedMcpOAuthClient; redirectUri: string } =
        await AuthorizationRequest.resolveClientAndRedirectUri({
          client_id: REGISTERED_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: "token",
          scope: 'bad"scope',
        });

      expect(result.redirectUri).toBe(REDIRECT_URI);
    });
  });

  describe("parse (stage two: reported to the client)", () => {
    it("returns the checked request", () => {
      const request: McpOAuthAuthorizationRequest = parse(
        validParameters({
          state: "state-123",
          scope: "mcp:read mcp:write",
          resource: McpOAuthConfig.getResource(),
        }),
        registeredClient({ clientUri: "https://client.example/" }),
      );

      expect(request).toEqual({
        clientId: REGISTERED_CLIENT_ID,
        clientKind: McpOAuthClientKind.Registered,
        clientName: "Example Client",
        clientUri: "https://client.example/",
        redirectUri: REDIRECT_URI,
        codeChallenge: CODE_CHALLENGE,
        state: "state-123",
        scopes: [McpOAuthScope.Read, McpOAuthScope.Write],
        resource: McpOAuthConfig.getResource(),
      });
    });

    it("leaves out what the request and the client do not have", () => {
      const request: McpOAuthAuthorizationRequest = parse(validParameters());

      expect("state" in request).toBe(false);
      expect("clientUri" in request).toBe(false);
      expect(request.scopes).toEqual([McpOAuthScope.Read]);
    });

    it("takes the client's identity from the verified client, not from the request", () => {
      const request: McpOAuthAuthorizationRequest = parse(
        validParameters({
          client_id: "11111111-1111-1111-1111-111111111111",
          client_name: "OneUptime Official",
          client_uri: "https://oneuptime.com/",
          redirect_uri: "https://evil.example/callback",
        }),
        registeredClient({
          clientId: DOCUMENT_CLIENT_ID,
          kind: McpOAuthClientKind.MetadataDocument,
        }),
      );

      expect(request.clientId).toBe(DOCUMENT_CLIENT_ID);
      expect(request.clientKind).toBe(McpOAuthClientKind.MetadataDocument);
      expect(request.clientName).toBe("Example Client");
      expect(request.redirectUri).toBe(REDIRECT_URI);
      expect("clientUri" in request).toBe(false);
    });

    describe("response_type", () => {
      it.each([
        ["missing", undefined],
        ["empty", ""],
        ["repeated", ["code", "code"]],
      ])(
        "is invalid_request when response_type is %s",
        (_name: string, value: unknown) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return parse(validParameters({ response_type: value }));
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
          expect(error.description).toBe('response_type must be "code".');
        },
      );

      it.each(["token", "id_token", "code token", "CODE", "code "])(
        "is unsupported_response_type for %s",
        (value: string) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return parse(validParameters({ response_type: value }));
          });

          expect(error.code).toBe(McpOAuthErrorCode.UnsupportedResponseType);
          expect(error.description).toBe('response_type must be "code".');
        },
      );
    });

    describe("PKCE", () => {
      it.each([
        ["missing", undefined],
        ["empty", ""],
        ["repeated", [CODE_CHALLENGE, CODE_CHALLENGE]],
      ])(
        "refuses a request whose code_challenge is %s",
        (_name: string, value: unknown) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return parse(validParameters({ code_challenge: value }));
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
          expect(error.description).toBe(
            "code_challenge is required: this server requires PKCE.",
          );
        },
      );

      it.each([
        ["missing (RFC 7636 would default it to plain)", undefined],
        ["plain", "plain"],
        ["lower-case s256", "s256"],
        ["another algorithm", "S512"],
        ["empty", ""],
        ["repeated", ["S256", "S256"]],
        ["padded", "S256 "],
      ])(
        "refuses a code_challenge_method that is %s",
        (_name: string, value: unknown) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return parse(validParameters({ code_challenge_method: value }));
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
          expect(error.description).toBe(
            'code_challenge_method must be "S256".',
          );
        },
      );

      it.each([
        ["too short", CODE_CHALLENGE.slice(0, 42)],
        ["too long", `${CODE_CHALLENGE}A`],
        ["standard base64", `${CODE_CHALLENGE.slice(0, 42)}+`],
        ["padded", `${CODE_CHALLENGE.slice(0, 42)}=`],
        ["a plain verifier of another length", "a".repeat(64)],
      ])(
        "refuses a code_challenge that is %s",
        (_name: string, value: string) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return parse(validParameters({ code_challenge: value }));
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
          expect(error.description).toBe(
            "code_challenge is not a valid S256 challenge (43 base64url characters).",
          );
        },
      );
    });

    describe("resource (RFC 8707)", () => {
      it("is optional, and the request is for this MCP server either way", () => {
        expect(parse(validParameters()).resource).toBe(
          McpOAuthConfig.getResource(),
        );
        expect(
          parse(validParameters({ resource: McpOAuthConfig.getResource() }))
            .resource,
        ).toBe(McpOAuthConfig.getResource());
      });

      it("accepts this server written with a trailing slash, and stores the canonical form", () => {
        expect(
          parse(
            validParameters({ resource: `${McpOAuthConfig.getResource()}/` }),
          ).resource,
        ).toBe(McpOAuthConfig.getResource());
      });

      it.each([
        ["another host", "https://evil.example/mcp"],
        ["this origin without the /mcp path", McpOAuthConfig.getOrigin()],
        ["another path on this origin", `${McpOAuthConfig.getOrigin()}/api`],
        ["a deeper path", `${McpOAuthConfig.getResource()}/oauth/token`],
        ["a query", `${McpOAuthConfig.getResource()}?x=1`],
        ["a fragment", `${McpOAuthConfig.getResource()}#x`],
        ["not a URL", "mcp"],
      ])("is invalid_target for %s", (_name: string, value: string) => {
        const error: McpOAuthError = captureOAuthError(() => {
          return parse(validParameters({ resource: value }));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidTarget);
        expect(error.description).toBe(
          `The resource must be ${McpOAuthConfig.getResource()}.`,
        );
      });

      it("never lets a repeated resource choose where the grant is for", () => {
        const request: McpOAuthAuthorizationRequest = parse(
          validParameters({
            resource: ["https://evil.example/mcp", "https://other.example/mcp"],
          }),
        );

        expect(request.resource).toBe(McpOAuthConfig.getResource());
      });
    });

    describe("state", () => {
      it("carries the client's state through untouched", () => {
        const state: string = 'aB3-_.~ +/=&%20?#"<>';

        expect(parse(validParameters({ state })).state).toBe(state);
      });

      it("keeps an empty state as an empty state", () => {
        const request: McpOAuthAuthorizationRequest = parse(
          validParameters({ state: "" }),
        );

        expect("state" in request).toBe(true);
        expect(request.state).toBe("");
      });

      it("holds the limit at 1024 characters", () => {
        expect(MAX_STATE_LENGTH).toBe(1024);
        expect(
          parse(validParameters({ state: "s".repeat(1024) })).state,
        ).toHaveLength(1024);

        const error: McpOAuthError = captureOAuthError(() => {
          return parse(validParameters({ state: "s".repeat(1025) }));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
        expect(error.description).toBe(
          "state must be a single value of at most 1024 characters.",
        );
      });

      it.each([
        ["repeated", ["a", "b"]],
        ["a number", 7],
        ["an object", { a: 1 }],
        ["null", null],
      ])("refuses a state that is %s", (_name: string, value: unknown) => {
        const error: McpOAuthError = captureOAuthError(() => {
          return parse(validParameters({ state: value }));
        });

        expect(error.code).toBe(McpOAuthErrorCode.InvalidRequest);
      });

      it("reports an unusable state ahead of every other problem", () => {
        const error: McpOAuthError = captureOAuthError(() => {
          return parse({ state: ["a", "b"] });
        });

        expect(error.description).toContain("state");
      });
    });

    describe("readState", () => {
      it("reads the state on its own, so it can be echoed with an error", () => {
        expect(AuthorizationRequest.readState({ state: "xyz" })).toBe("xyz");
        expect(AuthorizationRequest.readState({})).toBeUndefined();
        expect(AuthorizationRequest.readState({ state: "" })).toBe("");
      });

      it("throws for a state that cannot be echoed", () => {
        expect(
          captureOAuthError(() => {
            return AuthorizationRequest.readState({ state: "s".repeat(1025) });
          }).code,
        ).toBe(McpOAuthErrorCode.InvalidRequest);
        expect(
          captureOAuthError(() => {
            return AuthorizationRequest.readState({ state: ["a", "b"] });
          }).code,
        ).toBe(McpOAuthErrorCode.InvalidRequest);
      });
    });

    describe("scope", () => {
      it.each([
        ["no scope at all", undefined, [McpOAuthScope.Read]],
        ["an empty scope", "", [McpOAuthScope.Read]],
        ["read", "mcp:read", [McpOAuthScope.Read]],
        [
          "write alone, which implies read",
          "mcp:write",
          [McpOAuthScope.Read, McpOAuthScope.Write],
        ],
        [
          "read and write",
          "mcp:read mcp:write",
          [McpOAuthScope.Read, McpOAuthScope.Write],
        ],
        [
          "write before read",
          "mcp:write mcp:read",
          [McpOAuthScope.Read, McpOAuthScope.Write],
        ],
        ["a scope named twice", "mcp:read mcp:read", [McpOAuthScope.Read]],
        [
          "read with offline_access",
          "mcp:read offline_access",
          [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        ],
        [
          "offline_access before write",
          "offline_access mcp:write",
          [
            McpOAuthScope.Read,
            McpOAuthScope.Write,
            McpOAuthScope.OfflineAccess,
          ],
        ],
        [
          "offline_access alone",
          "offline_access",
          [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        ],
        [
          "only scopes this server does not issue",
          "openid profile email",
          [McpOAuthScope.Read],
        ],
        [
          "unknown scopes beside read",
          "openid mcp:read profile",
          [McpOAuthScope.Read],
        ],
        [
          "unknown scopes beside write",
          "openid mcp:write",
          [McpOAuthScope.Read, McpOAuthScope.Write],
        ],
        [
          "unknown scopes beside offline_access",
          "openid offline_access",
          [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        ],
        [
          "a scope that only looks like write",
          "mcp:write:all MCP:WRITE mcp:admin",
          [McpOAuthScope.Read],
        ],
      ])(
        "reads %s",
        (_name: string, scope: unknown, expected: Array<McpOAuthScope>) => {
          expect(AuthorizationRequest.readScopes({ scope })).toEqual(expected);
          expect(parse(validParameters({ scope })).scopes).toEqual(expected);
        },
      );

      it("never grants write that was not asked for", () => {
        for (const scope of [
          undefined,
          "",
          "mcp:read",
          "offline_access",
          "openid",
          "write",
          "mcp:writes",
          "mcp:read offline_access openid",
        ]) {
          expect(AuthorizationRequest.readScopes({ scope })).not.toContain(
            McpOAuthScope.Write,
          );
        }
      });

      it.each([
        ["repeated", ["mcp:read", "mcp:write"]],
        ["a number", 5],
        ["an object", { read: true }],
        ["null", null],
        ["separated by two spaces", "mcp:read  mcp:write"],
        ["padded in front", " mcp:read"],
        ["padded behind", "mcp:read "],
        ["separated by a comma and a space", "mcp:read, mcp:write\x00"],
        ["separated by a tab", "mcp:read\tmcp:write"],
        ["separated by a newline", "mcp:read\nmcp:write"],
        ["holding a double quote", 'mcp:read "mcp:write"'],
        ["holding a backslash", "mcp:read mcp\\write"],
        ["holding a non-ASCII character", "mcp:read caf\xe9"],
      ])(
        "is invalid_scope when scope is %s",
        (_name: string, scope: unknown) => {
          const error: McpOAuthError = captureOAuthError(() => {
            return AuthorizationRequest.readScopes({ scope });
          });

          expect(error.code).toBe(McpOAuthErrorCode.InvalidScope);
          expect(error.description).toBe(
            "scope must be a space-delimited list of scope names.",
          );

          expect(
            captureOAuthError(() => {
              return parse(validParameters({ scope }));
            }).code,
          ).toBe(McpOAuthErrorCode.InvalidScope);
        },
      );
    });
  });

  describe("the ticket", () => {
    it("round-trips every field of a request", () => {
      const request: McpOAuthAuthorizationRequest = fullRequest();
      const ticket: string = AuthorizationRequest.toTicket(request, NOW);

      expect(TICKET_SHAPE.test(ticket)).toBe(true);
      expect(AuthorizationRequest.fromTicket(ticket, NOW)).toEqual(request);
    });

    it("round-trips a request with no state and no client URI", () => {
      const request: McpOAuthAuthorizationRequest = fullRequest({
        clientId: REGISTERED_CLIENT_ID,
        clientKind: McpOAuthClientKind.Registered,
        scopes: [McpOAuthScope.Read],
      });

      delete request.state;
      delete request.clientUri;

      const restored: McpOAuthAuthorizationRequest | null =
        AuthorizationRequest.fromTicket(
          AuthorizationRequest.toTicket(request, NOW),
          NOW,
        );

      expect(restored).toEqual(request);
      expect("state" in restored!).toBe(false);
      expect("clientUri" in restored!).toBe(false);
    });

    it("round-trips an empty state as an empty state", () => {
      const restored: McpOAuthAuthorizationRequest | null =
        AuthorizationRequest.fromTicket(
          AuthorizationRequest.toTicket(fullRequest({ state: "" }), NOW),
          NOW,
        );

      expect("state" in restored!).toBe(true);
      expect(restored!.state).toBe("");
    });

    it("round-trips awkward characters exactly", () => {
      const request: McpOAuthAuthorizationRequest = fullRequest({
        clientName: `Caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x6771)} ${String.fromCodePoint(0x1f600)} "quoted" \\ </script>`,
        state: "a b&c=d#e?f%20g+h/i\\j\"k'l",
        redirectUri: "https://client.example/callback?tenant=1&x=%2F",
      });

      expect(
        AuthorizationRequest.fromTicket(
          AuthorizationRequest.toTicket(request, NOW),
          NOW,
        ),
      ).toEqual(request);
    });

    it("lasts ten minutes and not a millisecond longer", () => {
      const ticket: string = AuthorizationRequest.toTicket(fullRequest(), NOW);

      expect(McpOAuthConfig.AUTHORIZATION_REQUEST_TTL_SECONDS).toBe(600);
      expect(
        AuthorizationRequest.fromTicket(
          ticket,
          new Date(NOW.getTime() + TEN_MINUTES_IN_MS - 1),
        ),
      ).not.toBeNull();
      expect(
        AuthorizationRequest.fromTicket(
          ticket,
          new Date(NOW.getTime() + TEN_MINUTES_IN_MS),
        ),
      ).toBeNull();
      expect(
        AuthorizationRequest.fromTicket(
          ticket,
          new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        ),
      ).toBeNull();
    });

    it("tolerates five minutes of clock disagreement between servers, and no more", () => {
      const ticket: string = AuthorizationRequest.toTicket(fullRequest(), NOW);

      expect(
        AuthorizationRequest.fromTicket(
          ticket,
          new Date(NOW.getTime() - FIVE_MINUTES_IN_MS),
        ),
      ).not.toBeNull();
      expect(
        AuthorizationRequest.fromTicket(
          ticket,
          new Date(NOW.getTime() - FIVE_MINUTES_IN_MS - 1),
        ),
      ).toBeNull();
    });

    it("uses the real clock when it is not given one", () => {
      const ticket: string = AuthorizationRequest.toTicket(fullRequest());

      expect(AuthorizationRequest.fromTicket(ticket)).toEqual(fullRequest());
    });

    it("refuses a ticket whose payload was changed", () => {
      const ticket: string = AuthorizationRequest.toTicket(
        fullRequest({ scopes: [McpOAuthScope.Read] }),
        NOW,
      );
      const parts: Array<string> = ticket.split(".");

      // The same request, edited to ask for write.
      const payload: Record<string, unknown> = JSON.parse(
        Buffer.from(parts[1]!, "base64url").toString("utf8"),
      );

      (payload["c"] as Record<string, unknown>)["sc"] = "mcp:read mcp:write";

      const forged: string = [
        parts[0],
        Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
        parts[2],
      ].join(".");

      expect(AuthorizationRequest.fromTicket(forged, NOW)).toBeNull();
    });

    it("refuses a ticket whose redirect URI was swapped", () => {
      const ticket: string = AuthorizationRequest.toTicket(fullRequest(), NOW);
      const parts: Array<string> = ticket.split(".");
      const payload: Record<string, unknown> = JSON.parse(
        Buffer.from(parts[1]!, "base64url").toString("utf8"),
      );

      (payload["c"] as Record<string, unknown>)["ru"] =
        "https://evil.example/callback";

      const forged: string = [
        parts[0],
        Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
        parts[2],
      ].join(".");

      expect(AuthorizationRequest.fromTicket(forged, NOW)).toBeNull();
    });

    it("refuses a ticket whose signature was changed", () => {
      const ticket: string = AuthorizationRequest.toTicket(fullRequest(), NOW);
      const last: string = ticket.charAt(ticket.length - 1);
      const forged: string = `${ticket.slice(0, -1)}${last === "A" ? "B" : "A"}`;

      expect(AuthorizationRequest.fromTicket(forged, NOW)).toBeNull();
    });

    it("refuses one ticket's payload under another ticket's signature", () => {
      const read: Array<string> = AuthorizationRequest.toTicket(
        fullRequest({ scopes: [McpOAuthScope.Read] }),
        NOW,
      ).split(".");
      const write: Array<string> = AuthorizationRequest.toTicket(
        fullRequest({ scopes: [McpOAuthScope.Read, McpOAuthScope.Write] }),
        NOW,
      ).split(".");

      expect(
        AuthorizationRequest.fromTicket(
          [read[0], write[1], read[2]].join("."),
          NOW,
        ),
      ).toBeNull();
    });

    it("is not interchangeable with the delegation token signed from the same secret", () => {
      const delegationToken: string = McpDelegationToken.sign(
        {
          userId: ObjectID.generate(),
          userEmail: new Email("member@example.com"),
          userName: "A Member",
          projectId: ObjectID.generate(),
          grantId: ObjectID.generate(),
          clientId: REGISTERED_CLIENT_ID,
          clientName: "Example Client",
          canWrite: true,
        },
        NOW,
      );

      // Same format, different key: neither verifies as the other.
      expect(TICKET_SHAPE.test(delegationToken)).toBe(true);
      expect(AuthorizationRequest.fromTicket(delegationToken, NOW)).toBeNull();
      expect(
        McpDelegationToken.verify(
          AuthorizationRequest.toTicket(fullRequest(), NOW),
          NOW,
        ),
      ).toBeNull();
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["a number", 12345],
      ["an object", { request: "v1.a.b" }],
      ["an array", ["v1.a.b"]],
      ["words", "not a ticket"],
      ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJl"],
      [
        "the right shape and no meaning",
        `v1.${"A".repeat(40)}.${"A".repeat(43)}`,
      ],
      ["something enormous", `v1.${"A".repeat(20000)}.${"A".repeat(43)}`],
    ])("is null, without throwing, for %s", (_name: string, value: unknown) => {
      expect(AuthorizationRequest.fromTicket(value, NOW)).toBeNull();
    });

    it("fits an ordinary client's request with the longest state allowed", () => {
      const request: McpOAuthAuthorizationRequest = fullRequest({
        state: "s".repeat(MAX_STATE_LENGTH),
      });

      const ticket: string = AuthorizationRequest.toTicket(request, NOW);

      expect(AuthorizationRequest.fromTicket(ticket, NOW)).toEqual(request);
      expect(McpOAuthPendingAuthorization.isTicket(ticket)).toBe(true);
    });

    it("never issues a ticket the consent page would turn away", () => {
      /*
       * The consent page checks the ticket in its URL with
       * McpOAuthPendingAuthorization.isTicket before it does anything else.
       * A request this file accepts has to pass that check, or be refused
       * here as too large - otherwise a client that sent a valid request
       * lands on a page saying its link is broken.
       */
      const clientId: string = `https://client.example/${"a".repeat(477)}`;
      const redirectUri: string = `https://client.example/${"b".repeat(1001)}`;

      expect(clientId).toHaveLength(500);
      expect(redirectUri).toHaveLength(1024);

      const turnedAway: Array<number> = [];

      for (const stateLength of [0, 128, 256, 512, 768, MAX_STATE_LENGTH]) {
        const request: McpOAuthAuthorizationRequest = fullRequest({
          clientId,
          clientName: "n".repeat(100),
          clientUri: `https://client.example/${"c".repeat(477)}`,
          redirectUri,
          state: "s".repeat(stateLength),
        });

        let ticket: string | null = null;

        try {
          ticket = AuthorizationRequest.toTicket(request, NOW);
        } catch (err) {
          expect(err).toBeInstanceOf(AuthorizationDisplayError);
          expect((err as AuthorizationDisplayError).code).toBe(
            AuthorizationDisplayErrorCode.RequestTooLarge,
          );
        }

        if (ticket === null) {
          continue;
        }

        // Read before the check: isTicket is a type guard and narrows it away.
        const ticketLength: number = ticket.length;

        if (!McpOAuthPendingAuthorization.isTicket(ticket)) {
          turnedAway.push(ticketLength);
        }
      }

      expect(turnedAway).toEqual([]);
    });

    it("says request_too_large, to the person, for a request that cannot be carried", () => {
      /*
       * Every field at its own limit, with 1024 characters of state that
       * each take three bytes in the ticket: more than a ticket may hold.
       */
      const request: McpOAuthAuthorizationRequest = fullRequest({
        clientId: `https://client.example/${"a".repeat(477)}`,
        redirectUri: `https://client.example/${"b".repeat(1001)}`,
        state: String.fromCodePoint(0x6771).repeat(MAX_STATE_LENGTH),
      });

      let caught: unknown = null;

      try {
        AuthorizationRequest.toTicket(request, NOW);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthorizationDisplayError);
      expect((caught as AuthorizationDisplayError).code).toBe(
        AuthorizationDisplayErrorCode.RequestTooLarge,
      );
    });

    describe("fromTicket reads a validly signed ticket defensively", () => {
      it("reads a well-formed set of claims", () => {
        expect(
          AuthorizationRequest.fromTicket(ticketWithClaims(validClaims()), NOW),
        ).toEqual({
          clientId: REGISTERED_CLIENT_ID,
          clientKind: McpOAuthClientKind.Registered,
          clientName: "Example Client",
          redirectUri: REDIRECT_URI,
          codeChallenge: CODE_CHALLENGE,
          scopes: [McpOAuthScope.Read],
          resource: McpOAuthConfig.getResource(),
        });
      });

      it.each([
        ["no client id", { ci: undefined }],
        ["an empty client id", { ci: "" }],
        ["a client id that is not a string", { ci: 42 }],
        ["no client name", { cn: undefined }],
        ["a client name that is not a string", { cn: ["x"] }],
        ["no redirect URI", { ru: undefined }],
        ["an empty redirect URI", { ru: "" }],
        ["a redirect URI that is not a string", { ru: { href: REDIRECT_URI } }],
        ["no code challenge", { cc: undefined }],
        ["a code challenge that is not a string", { cc: 1 }],
        ["no scope", { sc: undefined }],
        ["a scope that is not a string", { sc: ["mcp:read"] }],
        ["no resource", { rs: undefined }],
        ["a resource that is not a string", { rs: 1 }],
        ["no client kind", { ck: undefined }],
        ["a client kind this server does not have", { ck: "trusted" }],
        ["a client kind in another letter case", { ck: "Registered" }],
        ["a state that is not a string", { st: 123 }],
        ["a null state", { st: null }],
      ])(
        "is null for a ticket with %s",
        (_name: string, bad: Record<string, unknown>) => {
          expect(
            AuthorizationRequest.fromTicket(
              ticketWithClaims(validClaims(bad)),
              NOW,
            ),
          ).toBeNull();
        },
      );

      it("drops a client URI that is not a non-empty string rather than refusing the ticket", () => {
        for (const value of ["", 42, null, ["https://client.example/"]]) {
          const request: McpOAuthAuthorizationRequest | null =
            AuthorizationRequest.fromTicket(
              ticketWithClaims(validClaims({ cu: value })),
              NOW,
            );

          expect(request).not.toBeNull();
          expect("clientUri" in request!).toBe(false);
        }
      });

      it("reads only the scopes this server issues out of the ticket", () => {
        const request: McpOAuthAuthorizationRequest | null =
          AuthorizationRequest.fromTicket(
            ticketWithClaims(
              validClaims({ sc: "mcp:read admin mcp:write root" }),
            ),
            NOW,
          );

        expect(request!.scopes).toEqual([
          McpOAuthScope.Read,
          McpOAuthScope.Write,
        ]);
      });

      it("does not accept a ticket signed for another purpose under the same format", () => {
        const other: string | null = McpOAuthSignedToken.sign({
          purpose: {
            keyDerivationLabel: "oneuptime:mcp:oauth:something-else:v1",
            maxLength: 6000,
          },
          claims: validClaims() as never,
          expiresInSeconds: 600,
          now: NOW,
        });

        expect(other).not.toBeNull();
        expect(AuthorizationRequest.fromTicket(other, NOW)).toBeNull();
      });
    });
  });

  describe("redirects", () => {
    describe("buildSuccessRedirect", () => {
      it("sends the code, the client's state and this issuer", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildSuccessRedirect({
            request: fullRequest(),
            code: "oumcp_ac_example",
          }),
        );

        expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
        expect(url.searchParams.get("code")).toBe("oumcp_ac_example");
        expect(url.searchParams.get("state")).toBe("state-123");
        expect(url.searchParams.get("iss")).toBe(McpOAuthConfig.getIssuer());
        expect([...url.searchParams.keys()].sort()).toEqual([
          "code",
          "iss",
          "state",
        ]);
      });

      it("sends no state when the client sent none", () => {
        const request: McpOAuthAuthorizationRequest = fullRequest();

        delete request.state;

        const url: URL = new URL(
          AuthorizationRequest.buildSuccessRedirect({ request, code: "c" }),
        );

        expect(url.searchParams.has("state")).toBe(false);
        expect(url.searchParams.get("iss")).toBe(McpOAuthConfig.getIssuer());
      });

      it("echoes the state exactly, whatever is in it", () => {
        const state: string = 'a b&code=stolen#frag?x=%20+/\\"';
        const url: URL = new URL(
          AuthorizationRequest.buildSuccessRedirect({
            request: fullRequest({ state }),
            code: "real",
          }),
        );

        expect(url.searchParams.get("state")).toBe(state);
        expect(url.searchParams.getAll("code")).toEqual(["real"]);
        expect(url.hash).toBe("");
      });

      it("keeps the query the redirect URI was registered with", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildSuccessRedirect({
            request: fullRequest({
              redirectUri: "https://client.example/callback?tenant=7",
            }),
            code: "c",
          }),
        );

        expect(url.searchParams.get("tenant")).toBe("7");
        expect(url.searchParams.get("code")).toBe("c");
      });

      it("delivers to the loopback port the client asked for", () => {
        const redirect: string = AuthorizationRequest.buildSuccessRedirect({
          request: fullRequest({
            redirectUri: "http://127.0.0.1:53817/callback",
          }),
          code: "c",
        });

        expect(redirect.startsWith("http://127.0.0.1:53817/callback?")).toBe(
          true,
        );
      });

      it("delivers to a private-use scheme", () => {
        const redirect: string = AuthorizationRequest.buildSuccessRedirect({
          request: fullRequest({
            redirectUri: "cursor://anysphere.cursor-retrieval/oauth/callback",
          }),
          code: "c",
        });

        expect(
          redirect.startsWith(
            "cursor://anysphere.cursor-retrieval/oauth/callback?code=c",
          ),
        ).toBe(true);
      });
    });

    describe("buildErrorRedirect", () => {
      it("sends the error, its description, the state and this issuer", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildErrorRedirect({
            redirectUri: REDIRECT_URI,
            state: "state-123",
            error: new McpOAuthError(
              McpOAuthErrorCode.AccessDenied,
              "The request was denied.",
            ),
          }),
        );

        expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
        expect(url.searchParams.get("error")).toBe("access_denied");
        expect(url.searchParams.get("error_description")).toBe(
          "The request was denied.",
        );
        expect(url.searchParams.get("state")).toBe("state-123");
        expect(url.searchParams.get("iss")).toBe(McpOAuthConfig.getIssuer());
        expect(url.searchParams.has("code")).toBe(false);
      });

      it("sends no state when there is none to echo", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildErrorRedirect({
            redirectUri: REDIRECT_URI,
            error: new McpOAuthError(McpOAuthErrorCode.InvalidScope, "bad"),
          }),
        );

        expect(url.searchParams.has("state")).toBe(false);
        expect(url.searchParams.get("error")).toBe("invalid_scope");
        expect(url.searchParams.get("iss")).toBe(McpOAuthConfig.getIssuer());
      });

      it("keeps the registered query and encodes the description", () => {
        const description: string = 'response_type must be "code". & more #1';
        const url: URL = new URL(
          AuthorizationRequest.buildErrorRedirect({
            redirectUri: "https://client.example/callback?tenant=7",
            state: undefined,
            error: new McpOAuthError(
              McpOAuthErrorCode.InvalidRequest,
              description,
            ),
          }),
        );

        expect(url.searchParams.get("tenant")).toBe("7");
        expect(url.searchParams.get("error_description")).toBe(description);
        expect(url.hash).toBe("");
      });
    });

    describe("the consent page", () => {
      it("is reached with an error code, and only a code", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildDisplayErrorUrl(
            AuthorizationDisplayErrorCode.RedirectUriMismatch,
          ),
        );

        expect(`${url.origin}${url.pathname}`).toBe(
          McpOAuthConfig.getConsentPageUrl(),
        );
        expect(url.pathname).toBe("/accounts/mcp-authorize");
        expect([...url.searchParams.keys()]).toEqual(["error"]);
        expect(url.searchParams.get("error")).toBe("redirect_uri_mismatch");
      });

      it("is reached with the ticket, and only the ticket", () => {
        const ticket: string = AuthorizationRequest.toTicket(
          fullRequest(),
          NOW,
        );
        const url: URL = new URL(
          AuthorizationRequest.buildConsentPageUrl(ticket),
        );

        expect(`${url.origin}${url.pathname}`).toBe(
          McpOAuthConfig.getConsentPageUrl(),
        );
        expect([...url.searchParams.keys()]).toEqual(["request"]);
        expect(url.searchParams.get("request")).toBe(ticket);
      });

      it("is on this instance's own origin, never on one the request named", () => {
        const url: URL = new URL(
          AuthorizationRequest.buildConsentPageUrl(
            AuthorizationRequest.toTicket(
              fullRequest({ redirectUri: "https://evil.example/callback" }),
              NOW,
            ),
          ),
        );

        expect(url.origin).toBe(new URL(McpOAuthConfig.getOrigin()).origin);
      });
    });
  });
});
