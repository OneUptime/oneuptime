/**
 * Request gate tests.
 *
 * The gate decides, before the MCP SDK sees a request, who is calling and
 * whether the request may reach the tools. Three things are pinned:
 *
 *   - which credential a request carries - and that a value shaped like an
 *     OAuth access token is only ever tried as one;
 *   - what each tool needs from its caller, checked against the real tool
 *     registry so that "read-only" means the same thing here as it does in
 *     the hints the server advertises;
 *   - which requests are refused, with which status - lazily, so connecting,
 *     listing tools and the public tools never ask anybody to sign in.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";

jest.mock("../../Utils/MCPLogger");
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

import AccessTokenAuthenticator from "../../OAuth/AccessTokenAuthenticator";
import { BearerChallenge } from "../../OAuth/BearerChallenge";
import RequestGate, {
  CredentialResolution,
  McpToolAccess,
} from "../../OAuth/RequestGate";
import { generateAllTools } from "../../Tools/ToolGenerator";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialType,
} from "../../Types/McpCredential";
import { McpToolInfo } from "../../Types/McpTypes";
import ModelType from "../../Types/ModelType";
import OneUptimeOperation from "../../Types/OneUptimeOperation";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import { ExpressRequest } from "Common/Server/Utils/Express";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import { McpOAuthPrincipal } from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

const API_KEY: string = "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90";
const ACCESS_TOKEN: string = McpOAuthSecret.mint(McpOAuthTokenType.AccessToken);

const SIGN_IN_REQUIRED: string =
  "Authentication is required for this tool. Sign in with OneUptime, or send a OneUptime API key in the x-api-key header.";
const API_KEY_HEADER_HOLDS_OAUTH_SECRET: string =
  "The x-api-key header is for a OneUptime API key. Send an OAuth access token in the Authorization header, as a Bearer token.";
const NOT_AN_ACCESS_TOKEN: string =
  "Only an access token can be used here. Refresh tokens, authorization codes and client secrets are for the token endpoint.";
const INVALID_TOKEN: string =
  "The access token is invalid, expired or has been revoked.";
const READ_ONLY: string =
  "This connection was authorized as read-only, and this tool makes changes. Authorize again and allow read and write access to use it.";

function tool(name: string, operation: OneUptimeOperation): McpToolInfo {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
    modelName: "Incident",
    operation,
    modelType: ModelType.Database,
    singularName: "Incident",
    pluralName: "Incidents",
    tableName: "Incident",
    apiPath: "/incident",
  };
}

const TOOLS: Array<McpToolInfo> = [
  tool("create_incident", OneUptimeOperation.Create),
  tool("get_incident", OneUptimeOperation.Read),
  tool("list_incidents", OneUptimeOperation.List),
  tool("count_incidents", OneUptimeOperation.Count),
  tool("update_incident", OneUptimeOperation.Update),
  tool("delete_incident", OneUptimeOperation.Delete),
];

function request(headers: Record<string, unknown>): ExpressRequest {
  return { headers } as unknown as ExpressRequest;
}

function principal(scopes: Array<McpOAuthScope>): McpOAuthPrincipal {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = "22222222-2222-4222-8222-222222222222";
  grant.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
  grant.clientId = "https://client.example/oauth/metadata.json";
  grant.name = "Example Client";

  return {
    grant,
    user: {
      id: new ObjectID("33333333-3333-4333-8333-333333333333"),
      email: new Email("member@example.com"),
      name: "A Member",
      isMasterAdmin: false,
    },
    scopes,
  };
}

const NOBODY: McpCredential = McpCredentialUtil.none();
const WITH_API_KEY: McpCredential = McpCredentialUtil.fromApiKey(API_KEY);
const READ_ONLY_CLIENT: McpCredential = McpCredentialUtil.fromPrincipal(
  principal([McpOAuthScope.Read]),
);
const READ_WRITE_CLIENT: McpCredential = McpCredentialUtil.fromPrincipal(
  principal([McpOAuthScope.Read, McpOAuthScope.Write]),
);

function call(name: unknown, id: number = 1): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} },
  };
}

function challengeFor(
  body: unknown,
  credential: McpCredential,
  tools: Array<McpToolInfo> = TOOLS,
): BearerChallenge | null {
  return RequestGate.getChallenge({ body, tools, credential });
}

// What the MCP SDK's own client reads out of a challenge.
function readBySdk(
  challenge: BearerChallenge,
): ReturnType<typeof extractWWWAuthenticateParams> {
  return extractWWWAuthenticateParams(
    new Response(null, {
      status: challenge.statusCode,
      headers: { "WWW-Authenticate": challenge.headerValue },
    }),
  );
}

describe("RequestGate", () => {
  let enabledSpy: jest.SpyInstance;
  let authenticateSpy: jest.SpyInstance;

  beforeEach(() => {
    enabledSpy = jest.spyOn(
      McpOAuthConfig,
      "isEnabled",
    ) as unknown as jest.SpyInstance;
    enabledSpy.mockReturnValue(true);

    authenticateSpy = jest.spyOn(
      AccessTokenAuthenticator,
      "authenticate",
    ) as unknown as jest.SpyInstance;
    authenticateSpy.mockResolvedValue({ isAuthenticated: false });
  });

  afterEach(() => {
    enabledSpy.mockRestore();
    authenticateSpy.mockRestore();
  });

  describe("resolveCredential", () => {
    async function credentialOf(
      headers: Record<string, unknown>,
    ): Promise<McpCredential> {
      const resolution: CredentialResolution =
        await RequestGate.resolveCredential(request(headers));

      if (!("credential" in resolution)) {
        throw new Error("Expected a credential, got a challenge.");
      }

      return resolution.credential;
    }

    it("is nobody when the request carries no credential", async () => {
      expect(await credentialOf({})).toEqual({ type: McpCredentialType.None });
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    it("reads x-api-key as an API key", async () => {
      expect(await credentialOf({ "x-api-key": API_KEY })).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: API_KEY,
      });
    });

    it("reads a Bearer value that is not an access token as an API key", async () => {
      expect(
        await credentialOf({ authorization: `Bearer ${API_KEY}` }),
      ).toEqual({ type: McpCredentialType.ApiKey, apiKey: API_KEY });
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["lower case", `bearer ${API_KEY}`],
      ["upper case", `BEARER ${API_KEY}`],
      ["mixed case", `BeArEr ${API_KEY}`],
      ["extra spaces", `Bearer    ${API_KEY}   `],
    ])(
      "accepts the Bearer scheme in %s",
      async (_name: string, authorization: string) => {
        expect(await credentialOf({ authorization })).toEqual({
          type: McpCredentialType.ApiKey,
          apiKey: API_KEY,
        });
      },
    );

    it("reads an Authorization value with no scheme as the API key itself", async () => {
      expect(await credentialOf({ authorization: API_KEY })).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: API_KEY,
      });
    });

    it("prefers x-api-key to the Authorization header", async () => {
      expect(
        await credentialOf({
          "x-api-key": API_KEY,
          authorization: "Bearer another-key",
        }),
      ).toEqual({ type: McpCredentialType.ApiKey, apiKey: API_KEY });
    });

    it("prefers x-api-key even to an OAuth access token, and never checks the token", async () => {
      expect(
        await credentialOf({
          "x-api-key": API_KEY,
          authorization: `Bearer ${ACCESS_TOKEN}`,
        }),
      ).toEqual({ type: McpCredentialType.ApiKey, apiKey: API_KEY });
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    /*
     * x-api-key carries API keys and nothing else. An access token put there
     * is not looked up as a token (the header does not carry those), and it
     * is not handed to the API as a key either: it is refused, with the
     * challenge that tells a client where its token belongs.
     */
    it("refuses an OAuth access token in x-api-key without looking it up", async () => {
      authenticateSpy.mockResolvedValue({
        isAuthenticated: true,
        principal: principal([McpOAuthScope.Read, McpOAuthScope.Write]),
      });

      const resolution: CredentialResolution =
        await RequestGate.resolveCredential(
          request({ "x-api-key": ACCESS_TOKEN }),
        );

      expect("credential" in resolution).toBe(false);

      const challenge: BearerChallenge = (
        resolution as { challenge: BearerChallenge }
      ).challenge;

      expect(challenge.statusCode).toBe(401);
      expect(challenge.body.error).toBe("invalid_token");
      // The token may be perfectly good: it is told where to send it.
      expect(challenge.body.error_description).toBe(
        API_KEY_HEADER_HOLDS_OAUTH_SECRET,
      );
      expect(challenge.headerValue).toContain(
        `error_description="${API_KEY_HEADER_HOLDS_OAUTH_SECRET}"`,
      );
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    it("refuses it there even beside a good token in the Authorization header", async () => {
      authenticateSpy.mockResolvedValue({
        isAuthenticated: true,
        principal: principal([McpOAuthScope.Read, McpOAuthScope.Write]),
      });

      const resolution: CredentialResolution =
        await RequestGate.resolveCredential(
          request({
            "x-api-key": ACCESS_TOKEN,
            authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        );

      // x-api-key is read first, and what it holds decides the request.
      expect("challenge" in resolution).toBe(true);
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    it("reads x-api-key as an API key, whatever it looks like, when OAuth is switched off", async () => {
      enabledSpy.mockReturnValue(false);

      expect(await credentialOf({ "x-api-key": ACCESS_TOKEN })).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: ACCESS_TOKEN,
      });
      expect(authenticateSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["empty", ""],
      ["repeated", [API_KEY, "another-key"]],
    ])(
      "falls back to the Authorization header when x-api-key is %s",
      async (_name: string, apiKeyHeader: unknown) => {
        expect(
          await credentialOf({
            "x-api-key": apiKeyHeader,
            authorization: "Bearer from-authorization",
          }),
        ).toEqual({
          type: McpCredentialType.ApiKey,
          apiKey: "from-authorization",
        });
      },
    );

    it.each([
      ["empty", ""],
      ["repeated", [`Bearer ${API_KEY}`, "Bearer other"]],
    ])(
      "is nobody when the Authorization header is %s",
      async (_name: string, authorization: unknown) => {
        expect(await credentialOf({ authorization })).toEqual({
          type: McpCredentialType.None,
        });
      },
    );

    describe("an OAuth access token", () => {
      it("is authenticated, and the request acts as its principal", async () => {
        const signedIn: McpOAuthPrincipal = principal([
          McpOAuthScope.Read,
          McpOAuthScope.Write,
        ]);

        authenticateSpy.mockResolvedValue({
          isAuthenticated: true,
          principal: signedIn,
        });

        const credential: McpCredential = await credentialOf({
          authorization: `Bearer ${ACCESS_TOKEN}`,
        });

        expect(authenticateSpy).toHaveBeenCalledTimes(1);
        expect(authenticateSpy).toHaveBeenCalledWith(ACCESS_TOKEN);
        expect(credential).toEqual({
          type: McpCredentialType.OAuth,
          principal: signedIn,
        });
      });

      it("is recognised without the Bearer scheme, too", async () => {
        await RequestGate.resolveCredential(
          request({ authorization: ACCESS_TOKEN }),
        );

        expect(authenticateSpy).toHaveBeenCalledWith(ACCESS_TOKEN);
      });

      it("is answered 401 with a challenge when it does not check out", async () => {
        const resolution: CredentialResolution =
          await RequestGate.resolveCredential(
            request({ authorization: `Bearer ${ACCESS_TOKEN}` }),
          );

        expect("challenge" in resolution).toBe(true);
        expect("credential" in resolution).toBe(false);

        const challenge: BearerChallenge = (
          resolution as { challenge: BearerChallenge }
        ).challenge;

        expect(challenge.statusCode).toBe(401);
        expect(challenge.body).toEqual({
          error: "invalid_token",
          error_description: INVALID_TOKEN,
        });
        expect(challenge.headerValue.startsWith("Bearer ")).toBe(true);
      });

      it("is never retried as an API key when it does not check out", async () => {
        /*
         * Handed on as an API key, a dead token would come back as a tool
         * error inside a 200, and the client would never refresh it.
         */
        const resolution: CredentialResolution =
          await RequestGate.resolveCredential(
            request({ authorization: `Bearer ${ACCESS_TOKEN}` }),
          );

        expect(resolution).not.toHaveProperty("credential");
      });

      it.each([
        ["cut short", ACCESS_TOKEN.slice(0, 20)],
        ["with characters added", `${ACCESS_TOKEN}xyz`],
        ["with only its prefix left", "oumcp_at_"],
        ["with something else after the prefix", "oumcp_at_!!! not a token"],
      ])(
        "is still treated as an OAuth token when it arrives %s",
        async (_name: string, mangled: string) => {
          const resolution: CredentialResolution =
            await RequestGate.resolveCredential(
              request({ authorization: `Bearer ${mangled}` }),
            );

          expect(authenticateSpy).toHaveBeenCalledWith(mangled);
          expect("challenge" in resolution).toBe(true);
        },
      );

      /*
       * One of this server's own secrets that is not an access token: a
       * client that has mixed its credentials up. It is not an access token,
       * so it is never looked up as one - and it is not an API key either, so
       * it is never handed on to the API as one. A long-lived secret has no
       * business travelling any further than the door.
       */
      describe.each([
        [
          "a refresh token",
          McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
        ],
        [
          "an authorization code",
          McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
        ],
        ["a client secret", McpOAuthSecret.mintClientSecret()],
      ])("%s where the credential goes", (_name: string, value: string) => {
        it.each([
          ["as a Bearer token", { authorization: `Bearer ${value}` }],
          ["as a bare Authorization value", { authorization: value }],
          ["in x-api-key", { "x-api-key": value }],
        ])(
          "is refused with a challenge %s, and goes no further",
          async (_where: string, headers: Record<string, string>) => {
            const resolution: CredentialResolution =
              await RequestGate.resolveCredential(request(headers));

            expect("challenge" in resolution).toBe(true);
            expect("credential" in resolution).toBe(false);

            const challenge: BearerChallenge = (
              resolution as { challenge: BearerChallenge }
            ).challenge;

            expect(challenge.statusCode).toBe(401);
            expect(challenge.body.error).toBe("invalid_token");
            // It is told which door it came to, not that a token "expired".
            expect(challenge.body.error_description).toBe(
              "x-api-key" in headers
                ? API_KEY_HEADER_HOLDS_OAUTH_SECRET
                : NOT_AN_ACCESS_TOKEN,
            );
            // The secret is not echoed back in the refusal.
            expect(JSON.stringify(challenge)).not.toContain(value);
            // Not an access token: never looked up as one.
            expect(authenticateSpy).not.toHaveBeenCalled();
          },
        );

        it("is the API key it always was when OAuth is switched off", async () => {
          enabledSpy.mockReturnValue(false);

          expect(
            await credentialOf({ authorization: `Bearer ${value}` }),
          ).toEqual({ type: McpCredentialType.ApiKey, apiKey: value });
          expect(await credentialOf({ "x-api-key": value })).toEqual({
            type: McpCredentialType.ApiKey,
            apiKey: value,
          });
        });
      });

      it("takes a value that only resembles the namespace for an API key", async () => {
        // The namespace is exact and lower case; this is somebody's key.
        const lookalike: string = ACCESS_TOKEN.toUpperCase();

        expect(
          await credentialOf({ authorization: `Bearer ${lookalike}` }),
        ).toEqual({ type: McpCredentialType.ApiKey, apiKey: lookalike });
        expect(authenticateSpy).not.toHaveBeenCalled();
      });

      it("lets a failure to check the token surface as a failure, not as a challenge", async () => {
        authenticateSpy.mockRejectedValue(new Error("database is down"));

        await expect(
          RequestGate.resolveCredential(
            request({ authorization: `Bearer ${ACCESS_TOKEN}` }),
          ),
        ).rejects.toThrow("database is down");
      });

      it("is passed on as an API key when OAuth is switched off", async () => {
        enabledSpy.mockReturnValue(false);

        // There are no access tokens then; the API refuses the value.
        expect(
          await credentialOf({ authorization: `Bearer ${ACCESS_TOKEN}` }),
        ).toEqual({ type: McpCredentialType.ApiKey, apiKey: ACCESS_TOKEN });
        expect(authenticateSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("getToolAccess", () => {
    it.each(["oneuptime_help", "oneuptime_list_resources"])(
      "needs no identity for the helper tool %s",
      (name: string) => {
        expect(RequestGate.getToolAccess(name, TOOLS)).toBe(
          McpToolAccess.Public,
        );
      },
    );

    it.each([
      "get_public_status_page_overview",
      "get_public_status_page_incidents",
      "get_public_status_page_scheduled_maintenance",
      "get_public_status_page_announcements",
    ])(
      "needs no identity for the public status page tool %s",
      (name: string) => {
        expect(RequestGate.getToolAccess(name, TOOLS)).toBe(
          McpToolAccess.Public,
        );
      },
    );

    it("needs read for oneuptime_whoami, the one workflow tool that only reads", () => {
      expect(RequestGate.getToolAccess("oneuptime_whoami", TOOLS)).toBe(
        McpToolAccess.Read,
      );
    });

    it.each([
      "acknowledge_incident",
      "resolve_incident",
      "acknowledge_alert",
      "resolve_alert",
      "add_incident_note",
      "add_alert_note",
    ])("needs write for the workflow tool %s", (name: string) => {
      expect(RequestGate.getToolAccess(name, TOOLS)).toBe(McpToolAccess.Write);
    });

    it.each([
      ["get_incident", McpToolAccess.Read],
      ["list_incidents", McpToolAccess.Read],
      ["count_incidents", McpToolAccess.Read],
      ["create_incident", McpToolAccess.Write],
      ["update_incident", McpToolAccess.Write],
      ["delete_incident", McpToolAccess.Write],
    ])(
      "classifies the generated tool %s as %s, by its operation",
      (name: string, expected: McpToolAccess) => {
        expect(RequestGate.getToolAccess(name, TOOLS)).toBe(expected);
      },
    );

    it("classifies by operation, not by what the tool happens to be called", () => {
      const misleading: Array<McpToolInfo> = [
        tool("get_everything_and_delete_it", OneUptimeOperation.Delete),
        tool("delete_nothing", OneUptimeOperation.Read),
      ];

      expect(
        RequestGate.getToolAccess("get_everything_and_delete_it", misleading),
      ).toBe(McpToolAccess.Write);
      expect(RequestGate.getToolAccess("delete_nothing", misleading)).toBe(
        McpToolAccess.Read,
      );
    });

    it.each([
      ["a name that is not a tool", "no_such_tool"],
      ["an empty name", ""],
      ["a real name in another letter case", "Create_Incident"],
      ["a real name with a space after it", "create_incident "],
    ])(
      "treats %s as public: there is nothing to protect",
      (_name: string, toolName: string) => {
        expect(RequestGate.getToolAccess(toolName, TOOLS)).toBe(
          McpToolAccess.Public,
        );
      },
    );

    it("needs nothing from a tool list to classify the built-in tools", () => {
      expect(RequestGate.getToolAccess("oneuptime_help", [])).toBe(
        McpToolAccess.Public,
      );
      expect(RequestGate.getToolAccess("oneuptime_whoami", [])).toBe(
        McpToolAccess.Read,
      );
      expect(RequestGate.getToolAccess("resolve_incident", [])).toBe(
        McpToolAccess.Write,
      );
    });

    describe("against the real tool registry", () => {
      const registry: Array<McpToolInfo> = generateAllTools();

      const WRITE_OPERATIONS: Array<OneUptimeOperation> = [
        OneUptimeOperation.Create,
        OneUptimeOperation.Update,
        OneUptimeOperation.Delete,
      ];

      it("has a registry to check", () => {
        expect(registry.length).toBeGreaterThan(100);
      });

      it("lets a read-only connection run exactly the tools that are advertised as read-only", () => {
        const disagreements: Array<string> = [];

        for (const registered of registry) {
          const access: McpToolAccess = RequestGate.getToolAccess(
            registered.name,
            registry,
          );
          const advertisedReadOnly: boolean =
            registered.annotations?.readOnlyHint === true;

          if ((access !== McpToolAccess.Write) !== advertisedReadOnly) {
            disagreements.push(
              `${registered.name}: gate=${access}, readOnlyHint=${String(registered.annotations?.readOnlyHint)}`,
            );
          }
        }

        expect(disagreements).toEqual([]);
      });

      it("requires write for every tool the server's own write policy calls a write", () => {
        const letThrough: Array<string> = registry
          .filter((registered: McpToolInfo): boolean => {
            return (
              WRITE_OPERATIONS.includes(registered.operation) ||
              registered.annotations?.readOnlyHint === false
            );
          })
          .filter((registered: McpToolInfo): boolean => {
            return (
              RequestGate.getToolAccess(registered.name, registry) !==
              McpToolAccess.Write
            );
          })
          .map((registered: McpToolInfo): string => {
            return registered.name;
          });

        expect(letThrough).toEqual([]);
      });

      it("requires an identity for everything except the six public tools", () => {
        const publicTools: Array<string> = registry
          .filter((registered: McpToolInfo): boolean => {
            return (
              RequestGate.getToolAccess(registered.name, registry) ===
              McpToolAccess.Public
            );
          })
          .map((registered: McpToolInfo): string => {
            return registered.name;
          })
          .sort();

        expect(publicTools).toEqual([
          "get_public_status_page_announcements",
          "get_public_status_page_incidents",
          "get_public_status_page_overview",
          "get_public_status_page_scheduled_maintenance",
          "oneuptime_help",
          "oneuptime_list_resources",
        ]);
      });

      it("requires write for every delete tool there is", () => {
        const deleteTools: Array<McpToolInfo> = registry.filter(
          (registered: McpToolInfo): boolean => {
            return registered.operation === OneUptimeOperation.Delete;
          },
        );

        expect(deleteTools.length).toBeGreaterThan(10);

        for (const registered of deleteTools) {
          expect(RequestGate.getToolAccess(registered.name, registry)).toBe(
            McpToolAccess.Write,
          );
        }
      });

      it("lets the telemetry tools through with read", () => {
        for (const name of ["list_logs", "count_logs", "list_spans"]) {
          expect(RequestGate.getToolAccess(name, registry)).toBe(
            McpToolAccess.Read,
          );
        }
      });
    });
  });

  describe("getChallenge", () => {
    describe("requests that are never challenged", () => {
      it.each([
        [
          "initialize",
          { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        ],
        ["tools/list", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
        ["ping", { jsonrpc: "2.0", id: 1, method: "ping" }],
        [
          "a notification",
          { jsonrpc: "2.0", method: "notifications/initialized" },
        ],
        ["resources/list", { jsonrpc: "2.0", id: 1, method: "resources/list" }],
      ])(
        "lets %s through with no credential",
        (_name: string, body: unknown) => {
          expect(challengeFor(body, NOBODY)).toBeNull();
        },
      );

      it.each([
        "oneuptime_help",
        "oneuptime_list_resources",
        "get_public_status_page_overview",
        "get_public_status_page_incidents",
        "get_public_status_page_scheduled_maintenance",
        "get_public_status_page_announcements",
      ])(
        "lets a call to the public tool %s through with no credential",
        (name: string) => {
          expect(challengeFor(call(name), NOBODY)).toBeNull();
        },
      );

      it("lets a call to a tool that does not exist through, for the SDK to answer", () => {
        expect(challengeFor(call("no_such_tool"), NOBODY)).toBeNull();
      });

      it.each([
        ["undefined", undefined],
        ["null", null],
        ["a string", "tools/call"],
        ["a number", 42],
        ["an empty object", {}],
        ["an empty batch", []],
        ["a batch of junk", [null, 5, "tools/call", [], true]],
        ["a method that is not a string", { method: 5 }],
        [
          "tools/call with no params",
          { jsonrpc: "2.0", id: 1, method: "tools/call" },
        ],
        ["tools/call with null params", { method: "tools/call", params: null }],
        [
          "tools/call with no name",
          { method: "tools/call", params: { arguments: {} } },
        ],
        ["tools/call with a name that is a number", call(42)],
        ["tools/call with a name that is an array", call(["create_incident"])],
        [
          "tools/call with a name that is an object",
          call({ name: "create_incident" }),
        ],
        [
          "the method in another letter case",
          { method: "Tools/Call", params: { name: "create_incident" } },
        ],
      ])(
        "lets a body that is %s through, for the SDK to answer",
        (_name: string, body: unknown) => {
          expect(challengeFor(body, NOBODY)).toBeNull();
        },
      );
    });

    describe("a call that needs an identity, with none", () => {
      it.each([
        "get_incident",
        "list_incidents",
        "count_incidents",
        "create_incident",
        "update_incident",
        "delete_incident",
        "oneuptime_whoami",
        "acknowledge_incident",
        "add_alert_note",
      ])("is answered 401 for %s", (name: string) => {
        const challenge: BearerChallenge | null = challengeFor(
          call(name),
          NOBODY,
        );

        expect(challenge).not.toBeNull();
        expect(challenge!.statusCode).toBe(401);
        expect(challenge!.body).toEqual({
          error: "invalid_token",
          error_description: SIGN_IN_REQUIRED,
        });
      });

      it("is 401, not 403, even for a tool that writes: who comes before what", () => {
        expect(challengeFor(call("delete_incident"), NOBODY)!.statusCode).toBe(
          401,
        );
      });

      it("carries a challenge the MCP SDK client can act on", () => {
        const parsed: ReturnType<typeof extractWWWAuthenticateParams> =
          readBySdk(challengeFor(call("list_incidents"), NOBODY)!);

        expect(parsed.resourceMetadataUrl?.toString()).toBe(
          McpOAuthConfig.getProtectedResourceMetadataUrl(),
        );
        expect(parsed.scope).toBe("mcp:read mcp:write");
        expect(parsed.error).toBe("invalid_token");
      });
    });

    describe("a call made with an API key", () => {
      it.each([
        "get_incident",
        "list_incidents",
        "create_incident",
        "update_incident",
        "delete_incident",
        "oneuptime_whoami",
        "resolve_incident",
        "oneuptime_help",
      ])("is never challenged: %s", (name: string) => {
        expect(challengeFor(call(name), WITH_API_KEY)).toBeNull();
      });

      it("is not challenged whatever the key is worth: the API decides that", () => {
        expect(
          challengeFor(
            call("delete_incident"),
            McpCredentialUtil.fromApiKey("not-a-real-key"),
          ),
        ).toBeNull();
      });
    });

    describe("a call made by a client that signed in", () => {
      it.each([
        "get_incident",
        "list_incidents",
        "count_incidents",
        "oneuptime_whoami",
        "oneuptime_help",
        "get_public_status_page_overview",
      ])("lets a read-only client call %s", (name: string) => {
        expect(challengeFor(call(name), READ_ONLY_CLIENT)).toBeNull();
      });

      it.each([
        "create_incident",
        "update_incident",
        "delete_incident",
        "acknowledge_incident",
        "resolve_incident",
        "acknowledge_alert",
        "resolve_alert",
        "add_incident_note",
        "add_alert_note",
      ])("answers 403 when a read-only client calls %s", (name: string) => {
        const challenge: BearerChallenge | null = challengeFor(
          call(name),
          READ_ONLY_CLIENT,
        );

        expect(challenge).not.toBeNull();
        expect(challenge!.statusCode).toBe(403);
        expect(challenge!.body).toEqual({
          error: "insufficient_scope",
          error_description: READ_ONLY,
        });
      });

      it("carries a step-up challenge the MCP SDK client can act on", () => {
        const parsed: ReturnType<typeof extractWWWAuthenticateParams> =
          readBySdk(challengeFor(call("create_incident"), READ_ONLY_CLIENT)!);

        expect(parsed.resourceMetadataUrl?.toString()).toBe(
          McpOAuthConfig.getProtectedResourceMetadataUrl(),
        );
        expect(parsed.scope).toBe("mcp:read mcp:write");
        expect(parsed.error).toBe("insufficient_scope");
      });

      it.each([
        "get_incident",
        "create_incident",
        "update_incident",
        "delete_incident",
        "resolve_incident",
        "add_incident_note",
        "oneuptime_whoami",
      ])("lets a read-and-write client call %s", (name: string) => {
        expect(challengeFor(call(name), READ_WRITE_CLIENT)).toBeNull();
      });

      it("treats write alone as read and write", () => {
        const writeOnly: McpCredential = McpCredentialUtil.fromPrincipal(
          principal([McpOAuthScope.Write]),
        );

        expect(challengeFor(call("list_incidents"), writeOnly)).toBeNull();
        expect(challengeFor(call("delete_incident"), writeOnly)).toBeNull();
      });

      it("does not let offline_access stand in for write", () => {
        const offline: McpCredential = McpCredentialUtil.fromPrincipal(
          principal([McpOAuthScope.Read, McpOAuthScope.OfflineAccess]),
        );

        expect(challengeFor(call("list_incidents"), offline)).toBeNull();
        expect(challengeFor(call("create_incident"), offline)!.statusCode).toBe(
          403,
        );
      });

      it("withholds only write from a client whose grant names no access scope", () => {
        const noScopes: McpCredential = McpCredentialUtil.fromPrincipal(
          principal([]),
        );

        expect(challengeFor(call("list_incidents"), noScopes)).toBeNull();
        expect(
          challengeFor(call("create_incident"), noScopes)!.statusCode,
        ).toBe(403);
      });
    });

    describe("a batch", () => {
      it("is let through when nothing in it needs an identity", () => {
        expect(
          challengeFor(
            [
              { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
              { jsonrpc: "2.0", id: 2, method: "tools/list" },
              call("oneuptime_help", 3),
            ],
            NOBODY,
          ),
        ).toBeNull();
      });

      it("is answered 401 when any call in it needs an identity", () => {
        const challenge: BearerChallenge | null = challengeFor(
          [call("oneuptime_help", 1), call("list_incidents", 2)],
          NOBODY,
        );

        expect(challenge!.statusCode).toBe(401);
      });

      it("finds the protected call wherever it is in the batch", () => {
        expect(
          challengeFor(
            [
              call("list_incidents", 1),
              call("oneuptime_help", 2),
              { jsonrpc: "2.0", id: 3, method: "tools/list" },
            ],
            NOBODY,
          )!.statusCode,
        ).toBe(401);
        expect(
          challengeFor(
            [
              null,
              "junk",
              { jsonrpc: "2.0", id: 1, method: "tools/list" },
              call("oneuptime_help", 2),
              call("delete_incident", 3),
            ],
            NOBODY,
          )!.statusCode,
        ).toBe(401);
      });

      it("is answered 403 when a read-only client mixes a read with a write", () => {
        const challenge: BearerChallenge | null = challengeFor(
          [call("list_incidents", 1), call("create_incident", 2)],
          READ_ONLY_CLIENT,
        );

        expect(challenge!.statusCode).toBe(403);
        expect(challenge!.body.error).toBe("insufficient_scope");
      });

      it("is let through for a read-only client when every call only reads", () => {
        expect(
          challengeFor(
            [
              call("list_incidents", 1),
              call("count_incidents", 2),
              call("oneuptime_whoami", 3),
              call("oneuptime_help", 4),
            ],
            READ_ONLY_CLIENT,
          ),
        ).toBeNull();
      });

      it("reports a missing identity ahead of a missing scope", () => {
        // A read and a write, from nobody: 401, because nothing else can be decided yet.
        expect(
          challengeFor(
            [call("list_incidents", 1), call("delete_incident", 2)],
            NOBODY,
          )!.statusCode,
        ).toBe(401);
      });

      it("is let through for a read-and-write client whatever is in it", () => {
        expect(
          challengeFor(
            [
              call("list_incidents", 1),
              call("create_incident", 2),
              call("delete_incident", 3),
              call("resolve_incident", 4),
            ],
            READ_WRITE_CLIENT,
          ),
        ).toBeNull();
      });
    });

    describe("with OAuth switched off", () => {
      beforeEach(() => {
        enabledSpy.mockReturnValue(false);
      });

      it.each([
        ["nobody calling a read tool", call("list_incidents"), NOBODY],
        ["nobody calling a write tool", call("delete_incident"), NOBODY],
        ["nobody calling a workflow tool", call("resolve_incident"), NOBODY],
        [
          "nobody sending a batch",
          [call("list_incidents", 1), call("delete_incident", 2)],
          NOBODY,
        ],
        ["an API key", call("delete_incident"), WITH_API_KEY],
        ["a read-only credential", call("delete_incident"), READ_ONLY_CLIENT],
      ])(
        "challenges nothing: %s",
        (_name: string, body: unknown, credential: McpCredential) => {
          /*
           * The call gets the in-band "API key is required" result it got
           * before OAuth existed.
           */
          expect(challengeFor(body, credential)).toBeNull();
        },
      );
    });

    it("builds a fresh answer for each request", () => {
      const first: BearerChallenge | null = challengeFor(
        call("list_incidents"),
        NOBODY,
      );
      const second: BearerChallenge | null = challengeFor(
        call("list_incidents"),
        NOBODY,
      );

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });
  });

  describe("the descriptions a client is shown", () => {
    it("cannot be mistaken for challenge parameters by a client's parser", () => {
      /*
       * The SDK finds `scope=` and `resource_metadata=` by searching the
       * whole header, description included. None of the wording may contain
       * one of those names followed by an equals sign.
       */
      const challenges: Array<BearerChallenge> = [
        challengeFor(call("list_incidents"), NOBODY)!,
        challengeFor(call("create_incident"), READ_ONLY_CLIENT)!,
      ];

      for (const challenge of challenges) {
        expect(challenge.body.error_description).not.toContain("=");
        expect(readBySdk(challenge).scope).toBe("mcp:read mcp:write");
      }
    });
  });
});
