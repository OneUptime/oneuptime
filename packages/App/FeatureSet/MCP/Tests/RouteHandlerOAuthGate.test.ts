/**
 * The gate in front of the MCP endpoint, as the route handler applies it.
 *
 * A refusal has to happen at the HTTP layer and BEFORE the MCP SDK runs: once
 * the SDK is executing a tool, anything the handler returns is wrapped in a
 * 200, and a 200 that says "please sign in" is, to a client, a tool that ran
 * and failed. So these tests look at the order of things - the challenge
 * comes before version and Accept negotiation, and no MCP server is even
 * constructed for a refused request - and then sweep the real tool list to
 * check that what the gate allows a read-only client agrees with what every
 * tool tells clients about itself.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

// The tools themselves are not under test; nothing here may reach the API.
jest.mock("../Services/OneUptimeApiService");
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

import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import OAuthTestHarness, {
  ConnectedClient,
  HttpResult,
  TestMember,
  TestProject,
  parseBearerChallenge,
} from "./OAuth/Helpers/OAuthTestHarness";
import * as MCPServer from "../Server/MCPServer";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { isHelperTool } from "../Tools/HelperTools";
import * as PublicStatusPageTools from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpToolInfo } from "../Types/McpTypes";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";

const SIGN_IN_REQUIRED: string =
  "Authentication is required for this tool. Sign in with OneUptime, or send a OneUptime API key in the x-api-key header.";

const INCIDENT_ID: string = "550e8400-e29b-41d4-a716-446655440000";

function toolCall(name: string, args: Record<string, unknown> = {}): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

describe("the MCP endpoint's sign-in gate", () => {
  let harness: OAuthTestHarness;
  let tools: Array<McpToolInfo>;
  let member: TestMember;
  let project: TestProject;
  let createServer: jest.SpyInstance;
  let publicTool: jest.SpyInstance;

  beforeAll(async () => {
    tools = generateAllTools();
    harness = await OAuthTestHarness.start({ tools });

    createServer = jest.spyOn(
      MCPServer,
      "createMCPServerInstance",
    ) as unknown as jest.SpyInstance;

    publicTool = jest
      .spyOn(PublicStatusPageTools, "handlePublicStatusPageTool")
      .mockResolvedValue(
        JSON.stringify({ success: true }),
      ) as unknown as jest.SpyInstance;
  });

  afterAll(async () => {
    createServer.mockRestore();
    publicTool.mockRestore();
    await harness.stop();
  });

  beforeEach(() => {
    harness.reset();
    jest.clearAllMocks();
    ({ member, project } = harness.addMemberWithProject());
  });

  afterEach(() => {
    harness.setOAuthEnabled(true);
  });

  describe("a refusal", () => {
    it("is a 401 with a JSON body, the Bearer challenge, and no caching", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.json).toEqual({
        error: "invalid_token",
        error_description: SIGN_IN_REQUIRED,
      });

      const header: string = response.headers.get("www-authenticate") || "";

      expect(header.startsWith("Bearer ")).toBe(true);
      expect(parseBearerChallenge(header)).toEqual({
        error: "invalid_token",
        error_description: SIGN_IN_REQUIRED,
        resource_metadata: `${harness.origin}/mcp/.well-known/oauth-protected-resource`,
        scope: "mcp:read mcp:write",
      });
    });

    it("points at a metadata document that is really there", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
      );

      const metadata: HttpResult = await harness.request(
        parseBearerChallenge(response.headers.get("www-authenticate"))[
          "resource_metadata"
        ]!,
      );

      expect(metadata.status).toBe(200);
      expect(metadata.json.resource).toBe(`${harness.origin}/mcp`);
    });

    it("can be read by a browser-based client: the challenge header is exposed, and the MCP headers are allowed", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        { Origin: "https://inspector.example" },
      );

      expect(response.status).toBe(401);
      expect(
        (
          response.headers.get("access-control-expose-headers") || ""
        ).toLowerCase(),
      ).toContain("www-authenticate");

      const allowed: string = (
        response.headers.get("access-control-allow-headers") || ""
      ).toLowerCase();

      expect(allowed).toContain("authorization");
      expect(allowed).toContain("x-api-key");
      expect(allowed).toContain("mcp-protocol-version");
    });

    it("exposes the challenge header on the preflight and on every other response too", async () => {
      const preflight: HttpResult = await harness.request("/mcp", {
        method: "OPTIONS",
      });
      const discovery: HttpResult = await harness.request("/mcp");

      for (const response of [preflight, discovery]) {
        expect(
          (
            response.headers.get("access-control-expose-headers") || ""
          ).toLowerCase(),
        ).toContain("www-authenticate");
      }
    });

    it("stops exposing the challenge header when OAuth is switched off: there is no challenge to read", async () => {
      harness.setOAuthEnabled(false);

      const preflight: HttpResult = await harness.request("/mcp", {
        method: "OPTIONS",
      });
      const discovery: HttpResult = await harness.request("/mcp");
      const call: HttpResult = await harness.mcp(toolCall("list_incidents"));

      for (const response of [preflight, discovery, call]) {
        expect(
          response.headers.get("access-control-expose-headers"),
        ).toBeNull();
        expect(response.headers.get("www-authenticate")).toBeNull();
      }
    });

    it("comes before the SDK: no MCP server is constructed for a request that is going to be refused", async () => {
      await harness.mcp(toolCall("list_incidents"));

      expect(createServer).not.toHaveBeenCalled();
    });

    it("constructs one for a request that is let through", async () => {
      await harness.mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      expect(createServer).toHaveBeenCalledTimes(1);
    });

    it("comes before protocol version negotiation: an unusable version is a 401 first, not a 400", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        { "mcp-protocol-version": "1999-01-01" },
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).not.toBeNull();
    });

    it("comes before Accept negotiation: an unacceptable Accept is a 401 first, not a 406", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        { Accept: "text/html" },
      );

      expect(response.status).toBe(401);
    });

    it("is given whatever protocol version the client speaks, including one newer than the SDK", async () => {
      for (const version of [...SUPPORTED_PROTOCOL_VERSIONS, "2026-07-28"]) {
        const response: HttpResult = await harness.mcp(
          toolCall("list_incidents"),
          { "mcp-protocol-version": version },
        );

        expect(response.status).toBe(401);
      }
    });

    it("never runs the tool", async () => {
      await harness.mcp(toolCall("list_incidents"));
      await harness.mcp(toolCall("create_incident", { title: "x" }));
      await harness.mcp(toolCall("oneuptime_whoami"));

      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        OneUptimeApiService.makeAuthenticatedApiCall as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("is a 403 - and still no MCP server - for a read-only client calling a tool that writes", async () => {
      const readOnly: ConnectedClient = await harness.connect({
        member,
        project,
        access: "read",
      });

      createServer.mockClear();

      const response: HttpResult = await harness.mcp(
        toolCall("create_incident", { title: "x" }),
        OAuthTestHarness.bearer(readOnly.accessToken),
      );

      expect(response.status).toBe(403);
      expect(
        parseBearerChallenge(response.headers.get("www-authenticate"))["error"],
      ).toBe("insufficient_scope");
      expect(response.json.error).toBe("insufficient_scope");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(createServer).not.toHaveBeenCalled();
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).not.toHaveBeenCalled();
    });
  });

  describe("what the gate reads off the request body", () => {
    it.each<[string, unknown]>([
      [
        "a tools/call with no params",
        { jsonrpc: "2.0", id: 1, method: "tools/call" },
      ],
      [
        "a tools/call whose name is not a string",
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 42 } },
      ],
      [
        "a method that only resembles tools/call",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "Tools/Call",
          params: { name: "list_incidents" },
        },
      ],
      ["an empty batch", []],
      ["a batch of things that are not messages", [1, "two", null]],
      ["an empty object", {}],
    ])(
      "does not challenge %s: there is no tool call in it to protect",
      async (_label: string, body: unknown) => {
        const response: HttpResult = await harness.mcp(body);

        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
        expect(response.headers.get("www-authenticate")).toBeNull();
      },
    );

    it("challenges a protected call sent as a notification (no id): it would still run", async () => {
      const response: HttpResult = await harness.mcp({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "list_incidents", arguments: {} },
      });

      expect(response.status).toBe(401);
    });

    it("challenges a protected call wherever it sits in a batch", async () => {
      const first: HttpResult = await harness.mcp([
        toolCall("list_incidents"),
        toolCall("oneuptime_help"),
      ]);
      const last: HttpResult = await harness.mcp([
        toolCall("oneuptime_help"),
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        toolCall("list_incidents"),
      ]);

      expect(first.status).toBe(401);
      expect(last.status).toBe(401);
    });

    it("treats a tool name as it is written: a differently cased name is an unknown tool, not a protected one", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("LIST_INCIDENTS"),
      );

      expect(response.status).toBe(200);
      expect(response.json.error.message).toContain("Unknown tool");
    });

    it("treats an empty x-api-key as no credential", async () => {
      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        { "x-api-key": "" },
      );

      expect(response.status).toBe(401);
    });
  });

  describe("one of this server's own secrets, put where a credential goes", () => {
    /*
     * The endpoint takes an API key or an access token. A refresh token, an
     * authorization code or a client secret presented there is a client that
     * has mixed its credentials up - and what it has sent is a secret worth
     * far more than an access token. It used to be handed on to the API as an
     * API key (which it could never be). It stops at the door instead.
     */
    const NOT_AN_ACCESS_TOKEN: string =
      "Only an access token can be used here. Refresh tokens, authorization codes and client secrets are for the token endpoint.";
    const API_KEY_HEADER_HOLDS_OAUTH_SECRET: string =
      "The x-api-key header is for a OneUptime API key. Send an OAuth access token in the Authorization header, as a Bearer token.";

    let connected: ConnectedClient;

    beforeEach(async () => {
      connected = await harness.connect({ member, project });
      createServer.mockClear();
    });

    async function unspentCode(): Promise<string> {
      return (await harness.approveForCode({ member, project })).code;
    }

    function expectStoppedAtTheDoor(
      response: HttpResult,
      secret: string,
      description: string,
    ): void {
      expect(response.status).toBe(401);
      expect(response.json).toEqual({
        error: "invalid_token",
        error_description: description,
      });

      const challenge: Record<string, string> = parseBearerChallenge(
        response.headers.get("www-authenticate"),
      );

      expect(challenge["error"]).toBe("invalid_token");
      expect(challenge["error_description"]).toBe(description);
      // A client that acts on the refusal is still told where to sign in.
      expect(challenge["resource_metadata"]).toBe(
        `${harness.origin}/mcp/.well-known/oauth-protected-resource`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");

      // It is not echoed back, no MCP server ran, and the API never saw it.
      expect(response.text).not.toContain(secret);
      expect(response.headers.get("www-authenticate")).not.toContain(secret);
      expect(createServer).not.toHaveBeenCalled();
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        OneUptimeApiService.makeAuthenticatedApiCall as jest.Mock,
      ).not.toHaveBeenCalled();
    }

    describe.each<[string, () => Promise<string>]>([
      [
        "a live refresh token",
        async (): Promise<string> => {
          return connected.refreshToken;
        },
      ],
      ["an unspent authorization code", unspentCode],
      [
        "a client secret",
        async (): Promise<string> => {
          return McpOAuthSecret.mintClientSecret();
        },
      ],
    ])("%s", (_name: string, secretOf: () => Promise<string>) => {
      it.each<[string, (secret: string) => Record<string, string>, string]>([
        [
          "as a Bearer token",
          (secret: string): Record<string, string> => {
            return { Authorization: `Bearer ${secret}` };
          },
          NOT_AN_ACCESS_TOKEN,
        ],
        [
          "as a bare Authorization value",
          (secret: string): Record<string, string> => {
            return { Authorization: secret };
          },
          NOT_AN_ACCESS_TOKEN,
        ],
        [
          "in x-api-key",
          (secret: string): Record<string, string> => {
            return { "x-api-key": secret };
          },
          API_KEY_HEADER_HOLDS_OAUTH_SECRET,
        ],
      ])(
        "is stopped at the door %s, and told which door it is",
        async (
          _where: string,
          headersFor: (secret: string) => Record<string, string>,
          description: string,
        ) => {
          const secret: string = await secretOf();

          createServer.mockClear();

          expectStoppedAtTheDoor(
            await harness.mcp(toolCall("list_incidents"), headersFor(secret)),
            secret,
            description,
          );
        },
      );
    });

    it("stops an access token in x-api-key too: that header carries API keys and nothing else", async () => {
      expectStoppedAtTheDoor(
        await harness.mcp(toolCall("list_incidents"), {
          "x-api-key": connected.accessToken,
        }),
        connected.accessToken,
        API_KEY_HEADER_HOLDS_OAUTH_SECRET,
      );
    });

    it("stops it even on a request that needs no identity: a bad token is a 401 whatever it was sent with", async () => {
      expectStoppedAtTheDoor(
        await harness.mcp(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          OAuthTestHarness.bearer(connected.refreshToken),
        ),
        connected.refreshToken,
        NOT_AN_ACCESS_TOKEN,
      );
    });

    it("still tells an access token that is no longer good that it is no longer good", async () => {
      harness.store.deleteGrant(connected.grantId);

      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(response.status).toBe(401);
      expect(response.json.error_description).toBe(
        "The access token is invalid, expired or has been revoked.",
      );
    });

    it("does not spend what was presented: the refresh token still refreshes", async () => {
      await harness.mcp(
        toolCall("list_incidents"),
        OAuthTestHarness.bearer(connected.refreshToken),
      );

      expect(
        (await harness.refresh(connected.clientId, connected.refreshToken))
          .status,
      ).toBe(200);
    });

    it("leaves an API key that merely resembles one alone", async () => {
      // The namespace is exact and lower case; this is somebody's key.
      const lookalike: string = connected.refreshToken.toUpperCase();

      const response: HttpResult = await harness.mcp(
        toolCall("list_incidents"),
        { "x-api-key": lookalike },
      );

      expect(response.status).toBe(200);
      expect(createServer).toHaveBeenCalledTimes(1);
    });

    it("is the API key it always was when OAuth is switched off: nothing is challenged", async () => {
      harness.setOAuthEnabled(false);

      for (const headers of [
        OAuthTestHarness.bearer(connected.refreshToken),
        { "x-api-key": connected.refreshToken },
        { "x-api-key": connected.accessToken },
      ]) {
        const response: HttpResult = await harness.mcp(
          toolCall("list_incidents"),
          headers,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("www-authenticate")).toBeNull();
      }
    });
  });

  describe("the discovery payload and the health check", () => {
    it("say where OAuth discovery starts when sign-in is available", async () => {
      const discovery: HttpResult = await harness.request("/mcp");
      const health: HttpResult = await harness.request("/mcp/health");

      for (const response of [discovery, health]) {
        expect(response.status).toBe(200);
        expect(response.json.oauth).toEqual({
          protectedResourceMetadata: `${harness.origin}/mcp/.well-known/oauth-protected-resource`,
        });
      }
    });

    it("are exactly what they were before sign-in existed when OAuth is switched off", async () => {
      harness.setOAuthEnabled(false);

      const discovery: HttpResult = await harness.request("/mcp");
      const health: HttpResult = await harness.request("/mcp/health");

      expect(Object.keys(discovery.json).sort()).toEqual([
        "latestProtocolVersion",
        "message",
        "name",
        "protocolVersions",
        "status",
      ]);
      expect(Object.keys(health.json).sort()).toEqual([
        "activeSessions",
        "latestProtocolVersion",
        "mode",
        "protocolVersions",
        "service",
        "status",
        "tools",
      ]);
    });

    it("need no credential either way", async () => {
      for (const isEnabled of [true, false]) {
        harness.setOAuthEnabled(isEnabled);

        expect((await harness.request("/mcp")).status).toBe(200);
        expect((await harness.request("/mcp/health")).status).toBe(200);
        expect((await harness.request("/mcp/tools")).status).toBe(200);
      }
    });
  });

  describe("every tool on the server", () => {
    /*
     * Clients auto-approve tools that say they are read-only (readOnlyHint).
     * The gate decides what a read-only CONNECTION may call from the tool's
     * operation. These must agree: a tool a client is told is safe to run
     * unattended has to be one a read-only client may run, and a tool that
     * changes something must never be reachable by one.
     */
    function isPublic(tool: McpToolInfo): boolean {
      return (
        isHelperTool(tool.name) ||
        PublicStatusPageTools.isPublicStatusPageTool(tool.name)
      );
    }

    function argumentsFor(tool: McpToolInfo): Record<string, unknown> {
      const required: Array<string> =
        (tool.inputSchema as { required?: Array<string> }).required || [];
      const args: Record<string, unknown> = {};

      for (const name of required) {
        args[name] = name.toLowerCase().endsWith("id") ? INCIDENT_ID : "x";
      }

      return args;
    }

    it("has more than a hundred tools, of every kind, to sweep", () => {
      expect(tools.length).toBeGreaterThan(100);
      expect(tools.some(isPublic)).toBe(true);
      expect(
        tools.some((tool: McpToolInfo): boolean => {
          return !isPublic(tool) && tool.annotations?.readOnlyHint === true;
        }),
      ).toBe(true);
      expect(
        tools.some((tool: McpToolInfo): boolean => {
          return tool.annotations?.readOnlyHint !== true;
        }),
      ).toBe(true);
    });

    it("is refused to nobody when it is public, and to everyone without a credential when it is not", async () => {
      const wrong: Array<string> = [];

      for (const tool of tools) {
        const response: HttpResult = await harness.mcp(
          toolCall(tool.name, argumentsFor(tool)),
        );
        const expected: number = isPublic(tool) ? 200 : 401;

        if (response.status !== expected) {
          wrong.push(`${tool.name}: ${response.status}, expected ${expected}`);
        }
      }

      expect(wrong).toEqual([]);
    });

    it("is open to a read-only client exactly when it tells clients it only reads", async () => {
      const readOnly: ConnectedClient = await harness.connect({
        member,
        project,
        access: "read",
      });
      const wrong: Array<string> = [];

      for (const tool of tools) {
        const response: HttpResult = await harness.mcp(
          toolCall(tool.name, argumentsFor(tool)),
          OAuthTestHarness.bearer(readOnly.accessToken),
        );

        const expected: number =
          isPublic(tool) || tool.annotations?.readOnlyHint === true ? 200 : 403;

        if (response.status !== expected) {
          wrong.push(`${tool.name}: ${response.status}, expected ${expected}`);
        }
      }

      expect(wrong).toEqual([]);
    });

    it("is open to a read-and-write client, whatever it does", async () => {
      const readWrite: ConnectedClient = await harness.connect({
        member,
        project,
        access: "write",
      });
      const wrong: Array<string> = [];

      for (const tool of tools) {
        const response: HttpResult = await harness.mcp(
          toolCall(tool.name, argumentsFor(tool)),
          OAuthTestHarness.bearer(readWrite.accessToken),
        );

        if (response.status !== 200) {
          wrong.push(`${tool.name}: ${response.status}`);
        }
      }

      expect(wrong).toEqual([]);
    });

    it("is open to an API key, whatever it does: a key is not scoped by the gate", async () => {
      const wrong: Array<string> = [];

      for (const tool of tools) {
        const response: HttpResult = await harness.mcp(
          toolCall(tool.name, argumentsFor(tool)),
          { "x-api-key": "any-api-key" },
        );

        if (response.status !== 200) {
          wrong.push(`${tool.name}: ${response.status}`);
        }
      }

      expect(wrong).toEqual([]);
    });
  });
});
