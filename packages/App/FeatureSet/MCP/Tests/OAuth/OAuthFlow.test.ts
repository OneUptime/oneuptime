/**
 * Whole journeys through the MCP endpoint and its authorization server, over
 * HTTP, with the real tool list.
 *
 * The other files in this directory test one endpoint each. These follow a
 * client from "here is a URL" to a tool call that reaches the OneUptime API,
 * and then through everything that can end the connection - and they check
 * the property the whole design turns on: the client's access token is
 * accepted by the MCP endpoint and NEVER forwarded; what the API is shown is
 * a short-lived delegation token naming the member, the project and the grant.
 *
 * The API itself is not running here. Common's API client is intercepted at
 * its three static methods, so every request the MCP server would have made
 * is captured with its headers.
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
jest.mock("../../Utils/MCPLogger");

import OAuthTestHarness, {
  ConnectedClient,
  HttpResult,
  PkcePair,
  TestMember,
  TestProject,
  parseBearerChallenge,
} from "./Helpers/OAuthTestHarness";
import FakeOneUptimeApi, {
  DELEGATION_HEADER,
  FakeApiCall,
} from "./Helpers/FakeOneUptimeApi";
import { StoreRow } from "./Helpers/InMemoryOAuthStore";
import OneUptimeApiService from "../../Services/OneUptimeApiService";
import * as PublicStatusPageTools from "../../Tools/PublicStatusPageTools";
import { generateAllTools } from "../../Tools/ToolGenerator";
import { McpToolInfo } from "../../Types/McpTypes";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import McpDelegationToken, {
  McpDelegationClaims,
} from "Common/Server/Utils/Mcp/McpDelegationToken";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";

const API_ORIGIN: string = "https://api.oneuptime.test";
const VALID_API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const INCIDENT_ID: string = "550e8400-e29b-41d4-a716-446655440000";

const SIGN_IN_REQUIRED: string =
  "Authentication is required for this tool. Sign in with OneUptime, or send a OneUptime API key in the x-api-key header.";
const INVALID_TOKEN: string =
  "The access token is invalid, expired or has been revoked.";
const READ_ONLY: string =
  "This connection was authorized as read-only, and this tool makes changes. Authorize again and allow read and write access to use it.";

describe("MCP OAuth, end to end", () => {
  let harness: OAuthTestHarness;
  let tools: Array<McpToolInfo>;
  let member: TestMember;
  let project: TestProject;

  const api: FakeOneUptimeApi = new FakeOneUptimeApi();
  let publicTool: jest.SpyInstance;

  beforeAll(async () => {
    tools = generateAllTools();
    harness = await OAuthTestHarness.start({ tools });
    OneUptimeApiService.initialize({ url: API_ORIGIN });

    api.install();

    // A public tool's own fetches are not what these tests are about.
    publicTool = jest
      .spyOn(PublicStatusPageTools, "handlePublicStatusPageTool")
      .mockResolvedValue(
        JSON.stringify({ success: true, status: "Operational" }),
      ) as unknown as jest.SpyInstance;
  });

  afterAll(async () => {
    publicTool.mockRestore();
    api.uninstall();
    await harness.stop();
  });

  beforeEach(() => {
    harness.reset();
    jest.clearAllMocks();
    ({ member, project } = harness.addMemberWithProject({
      projectName: "Acme Production",
    }));

    api.reset();
    api.acceptedApiKeys = [VALID_API_KEY];
    api.rowsFor = (path: string): Array<JSONObject> => {
      return path.endsWith("/project/get-list")
        ? [{ _id: project.id.toString(), name: project.name }]
        : [{ _id: INCIDENT_ID, name: "Acknowledged" }];
    };
  });

  afterEach(() => {
    harness.setOAuthEnabled(true);
  });

  function connect(
    options: {
      access?: "read" | "write" | undefined;
      member?: TestMember | undefined;
      project?: TestProject | undefined;
    } = {},
  ): Promise<ConnectedClient> {
    return harness.connect({
      member: options.member || member,
      project: options.project || project,
      access: options.access,
      clientName: "Claude Code",
    });
  }

  // The text payload of a tools/call result, parsed.
  function toolPayload(response: HttpResult): any {
    expect(response.json?.error).toBeUndefined();
    expect(response.json?.result).toBeDefined();

    return JSON.parse(response.json.result.content[0].text);
  }

  function expectChallenge(
    response: HttpResult,
    expected: { status: number; error: string; description: string },
  ): void {
    expect(response.status).toBe(expected.status);

    const header: string | null = response.headers.get("www-authenticate");

    expect(header).not.toBeNull();
    expect(header!.startsWith("Bearer ")).toBe(true);
    expect(parseBearerChallenge(header)).toEqual({
      error: expected.error,
      error_description: expected.description,
      resource_metadata: `${harness.origin}/mcp/.well-known/oauth-protected-resource`,
      scope: "mcp:read mcp:write",
    });

    expect(response.json).toEqual({
      error: expected.error,
      error_description: expected.description,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");

    // A browser-based client can only act on a header it is allowed to read.
    expect(
      (
        response.headers.get("access-control-expose-headers") || ""
      ).toLowerCase(),
    ).toContain("www-authenticate");
  }

  function expectUnauthorized(response: HttpResult): void {
    expectChallenge(response, {
      status: 401,
      error: "invalid_token",
      description: INVALID_TOKEN,
    });
  }

  describe("a client that knows nothing but the URL", () => {
    it("is told to sign in, finds the authorization server, signs its user in and calls the tool", async () => {
      // 1. The first call to a tool that needs an identity is refused.
      const refused: HttpResult = await harness.callTool("list_incidents", {});

      expectChallenge(refused, {
        status: 401,
        error: "invalid_token",
        description: SIGN_IN_REQUIRED,
      });
      expect(api.calls).toEqual([]);

      // 2. The challenge says where discovery starts.
      const resourceMetadataUrl: string = parseBearerChallenge(
        refused.headers.get("www-authenticate"),
      )["resource_metadata"]!;

      const resourceMetadata: any = (await harness.request(resourceMetadataUrl))
        .json;

      expect(resourceMetadata.resource).toBe(`${harness.origin}/mcp`);

      // 3. From the issuer, the authorization server's endpoints (RFC 8414).
      const issuer: URL = new URL(resourceMetadata.authorization_servers[0]);
      const serverMetadata: any = (
        await harness.request(
          `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`,
        )
      ).json;

      expect(serverMetadata.issuer).toBe(issuer.toString());

      // 4. The client introduces itself.
      const registration: HttpResult = await harness.request(
        serverMetadata.registration_endpoint,
        {
          json: {
            client_name: "Claude Code",
            redirect_uris: ["http://localhost/callback"],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          },
        },
      );

      expect(registration.status).toBe(201);

      const clientId: string = registration.json.client_id;

      // 5. It opens the browser at the authorization endpoint.
      const pkce: PkcePair = OAuthTestHarness.pkce();
      const authorizationUrl: URL = new URL(
        serverMetadata.authorization_endpoint,
      );

      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", clientId);
      authorizationUrl.searchParams.set(
        "redirect_uri",
        "http://localhost:51234/callback",
      );
      authorizationUrl.searchParams.set("code_challenge", pkce.codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("state", "xyz-state");
      authorizationUrl.searchParams.set(
        "scope",
        parseBearerChallenge(refused.headers.get("www-authenticate"))["scope"]!,
      );
      authorizationUrl.searchParams.set("resource", resourceMetadata.resource);

      const toConsent: HttpResult = await harness.request(
        authorizationUrl.toString(),
      );

      expect(toConsent.status).toBe(302);
      expect(toConsent.location!.pathname).toBe("/accounts/mcp-authorize");

      const ticket: string = toConsent.location!.searchParams.get("request")!;

      // 6. The member, signed in, sees who is asking and for what.
      harness.signIn(member);

      const details: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(details.json.client.name).toBe("Claude Code");
      expect(details.json.client.isLoopbackRedirect).toBe(true);
      expect(details.json.requestedAccess).toBe("write");
      expect(details.json.projects).toEqual([
        {
          id: project.id.toString(),
          name: "Acme Production",
          isEligible: true,
          refusal: null,
        },
      ]);

      // 7. They approve; the browser is sent back to the client with a code.
      const approval: HttpResult = await harness.consent("approve", {
        request: ticket,
        projectId: project.id.toString(),
        access: "write",
      });

      const callback: URL = new URL(approval.json.redirectUrl);

      expect(callback.origin).toBe("http://localhost:51234");
      expect(callback.searchParams.get("state")).toBe("xyz-state");
      // RFC 9207: the client checks the answer came from the issuer it asked.
      expect(callback.searchParams.get("iss")).toBe(serverMetadata.issuer);

      // 8. The client exchanges the code.
      const tokens: HttpResult = await harness.request(
        serverMetadata.token_endpoint,
        {
          form: {
            grant_type: "authorization_code",
            client_id: clientId,
            code: callback.searchParams.get("code")!,
            code_verifier: pkce.codeVerifier,
            redirect_uri: "http://localhost:51234/callback",
            resource: resourceMetadata.resource,
          },
        },
      );

      expect(tokens.status).toBe(200);
      expect(tokens.json.scope).toBe("mcp:read mcp:write");

      // 9. The same call, with the token, reaches the API as the member.
      const answered: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(tokens.json.access_token),
      );

      expect(answered.status).toBe(200);
      expect(toolPayload(answered).success).toBe(true);

      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]!.method).toBe("POST");
      expect(api.calls[0]!.url).toBe(`${API_ORIGIN}/api/incident/get-list`);

      const claims: McpDelegationClaims | null = McpDelegationToken.verify(
        api.calls[0]!.headers[DELEGATION_HEADER],
      );

      expect(claims).not.toBeNull();
      expect(claims!.userId.toString()).toBe(member.id.toString());
      expect(claims!.userEmail.toString()).toBe(member.email);
      expect(claims!.userName).toBe(member.name);
      expect(claims!.projectId.toString()).toBe(project.id.toString());
      expect(claims!.grantId.toString()).toBe(
        String(harness.store.onlyGrant()["_id"]),
      );
      expect(claims!.clientId).toBe(clientId);
      expect(claims!.clientName).toBe("Claude Code");
      expect(claims!.canWrite).toBe(true);

      // 10. An hour later it refreshes, and carries on with the new token.
      const refreshed: HttpResult = await harness.request(
        serverMetadata.token_endpoint,
        {
          form: {
            grant_type: "refresh_token",
            client_id: clientId,
            refresh_token: tokens.json.refresh_token,
          },
        },
      );

      expect(refreshed.status).toBe(200);
      expect(
        (
          await harness.callTool(
            "list_incidents",
            {},
            OAuthTestHarness.bearer(refreshed.json.access_token),
          )
        ).status,
      ).toBe(200);

      // 11. The user disconnects the server in the client: it revokes.
      const revoked: HttpResult = await harness.request(
        serverMetadata.revocation_endpoint,
        {
          form: { client_id: clientId, token: refreshed.json.refresh_token },
        },
      );

      expect(revoked.status).toBe(200);

      for (const accessToken of [
        tokens.json.access_token,
        refreshed.json.access_token,
      ]) {
        expectUnauthorized(
          await harness.callTool(
            "list_incidents",
            {},
            OAuthTestHarness.bearer(accessToken),
          ),
        );
      }
    });
  });

  describe("what the API is shown", () => {
    it("is a delegation token and nothing else: never the access token, never an API key header", async () => {
      const connected: ConnectedClient = await connect();

      await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(api.calls).toHaveLength(1);

      const headers: Record<string, string> = api.calls[0]!.headers;

      expect(Object.keys(headers).sort()).toEqual(
        ["Accept", "Content-Type", DELEGATION_HEADER].sort(),
      );
      expect(JSON.stringify(api.calls[0])).not.toContain(connected.accessToken);
      expect(JSON.stringify(api.calls[0])).not.toContain(
        connected.refreshToken,
      );
    });

    it("is good for a minute, and is not a JWT the API would take for a session", async () => {
      const connected: ConnectedClient = await connect();

      await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      const token: string = api.calls[0]!.headers[DELEGATION_HEADER]!;

      expect(token.startsWith("v1.")).toBe(true);
      expect(token.split(".")).toHaveLength(3);

      const envelope: { i: number; x: number } = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
      );

      expect(envelope.x - envelope.i).toBe(60 * 1000);

      // Still valid in 59 seconds, not in 61.
      expect(
        McpDelegationToken.verify(token, new Date(envelope.i + 59 * 1000)),
      ).not.toBeNull();
      expect(
        McpDelegationToken.verify(token, new Date(envelope.i + 61 * 1000)),
      ).toBeNull();
    });

    it("is minted for every API call a tool makes", async () => {
      const connected: ConnectedClient = await connect();

      const response: HttpResult = await harness.callTool(
        "acknowledge_incident",
        { incidentId: INCIDENT_ID },
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(response.status).toBe(200);
      expect(toolPayload(response).success).toBe(true);

      /*
       * The state lookup, the incident's current state (one already
       * acknowledged is not moved back), then the timeline entry.
       */
      expect(
        api.calls.map((call: FakeApiCall): string => {
          return call.path;
        }),
      ).toEqual([
        "/api/incident-state/get-list",
        "/api/incident/get-list",
        "/api/incident-state-timeline",
      ]);

      for (const call of api.calls) {
        expect(
          McpDelegationToken.verify(call.headers[DELEGATION_HEADER]),
        ).not.toBeNull();
        expect("APIKey" in call.headers).toBe(false);
      }
    });

    it("names the project of the grant, whatever project the member also belongs to", async () => {
      const otherProject: TestProject = harness.addProject({ name: "Other" });

      harness.addMembership(member, otherProject);

      const connected: ConnectedClient = await connect({
        project: otherProject,
      });

      await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(
        McpDelegationToken.verify(
          api.calls[0]!.headers[DELEGATION_HEADER],
        )!.projectId.toString(),
      ).toBe(otherProject.id.toString());
    });

    it("names a master admin like any other member: there is no admin claim to carry", async () => {
      const admin: TestMember = harness.addMember({ isMasterAdmin: true });

      harness.addMembership(admin, project);

      const connected: ConnectedClient = await connect({ member: admin });

      await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      const token: string = api.calls[0]!.headers[DELEGATION_HEADER]!;
      const envelope: { c: Record<string, unknown> } = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
      );

      expect(Object.keys(envelope.c).sort()).toEqual(
        ["ci", "cn", "e", "g", "n", "p", "u", "w"].sort(),
      );
      expect(JSON.stringify(envelope.c).toLowerCase()).not.toContain("admin");
    });
  });

  describe("a client its user authorized as read-only", () => {
    let readOnly: ConnectedClient;

    beforeEach(async () => {
      readOnly = await connect({ access: "read" });
    });

    function call(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<HttpResult> {
      return harness.callTool(
        name,
        args,
        OAuthTestHarness.bearer(readOnly.accessToken),
      );
    }

    it.each([["list_incidents"], ["count_incidents"]])(
      "may call %s, and tells the API the grant cannot write",
      async (tool: string) => {
        const response: HttpResult = await call(tool);

        expect(response.status).toBe(200);
        expect(api.calls).toHaveLength(1);
        expect(
          McpDelegationToken.verify(api.calls[0]!.headers[DELEGATION_HEADER])!
            .canWrite,
        ).toBe(false);
      },
    );

    it("may read one record", async () => {
      const response: HttpResult = await call("get_incident", {
        id: INCIDENT_ID,
      });

      expect(response.status).toBe(200);
      expect(api.calls[0]!.path).toBe(`/api/incident/${INCIDENT_ID}/get-item`);
    });

    it.each<[string, Record<string, unknown>]>([
      ["create_incident", { title: "x" }],
      ["update_incident", { id: INCIDENT_ID, title: "y" }],
      ["delete_incident", { id: INCIDENT_ID }],
      ["acknowledge_incident", { incidentId: INCIDENT_ID }],
      ["resolve_incident", { incidentId: INCIDENT_ID }],
      ["acknowledge_alert", { alertId: INCIDENT_ID }],
      ["resolve_alert", { alertId: INCIDENT_ID }],
      ["add_incident_note", { incidentId: INCIDENT_ID, note: "n" }],
      ["add_alert_note", { alertId: INCIDENT_ID, note: "n" }],
    ])(
      "is refused %s with 403 insufficient_scope - which is what lets it ask for more - and the API hears nothing",
      async (tool: string, args: Record<string, unknown>) => {
        expectChallenge(await call(tool, args), {
          status: 403,
          error: "insufficient_scope",
          description: READ_ONLY,
        });
        expect(api.calls).toEqual([]);
      },
    );

    it("is refused a batch that contains one write, whole", async () => {
      const response: HttpResult = await harness.mcp(
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "list_incidents", arguments: {} },
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "create_incident", arguments: { title: "x" } },
          },
        ],
        OAuthTestHarness.bearer(readOnly.accessToken),
      );

      expect(response.status).toBe(403);
      expect(api.calls).toEqual([]);
    });

    it("learns from whoami that it is read-only", async () => {
      const response: HttpResult = await call("oneuptime_whoami");

      expect(response.status).toBe(200);

      const payload: any = toolPayload(response);

      expect(payload.authentication).toBe("oauth");
      expect(payload.access).toBe("read-only");
      expect(payload.signedInAs).toEqual({
        email: member.email,
        name: member.name,
      });
      expect(payload.client).toBe("Claude Code");
      expect(payload.message).toContain("read-only");
    });

    it("can do what was refused once its user authorizes read and write", async () => {
      const upgraded: ConnectedClient = await harness.connect({
        member,
        project,
        access: "write",
        client: {
          clientId: readOnly.clientId,
          redirectUri: readOnly.redirectUri,
        },
      });

      const response: HttpResult = await harness.callTool(
        "create_incident",
        { title: "Database is down" },
        OAuthTestHarness.bearer(upgraded.accessToken),
      );

      expect(response.status).toBe(200);
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]!.path).toBe("/api/incident");
      expect(
        McpDelegationToken.verify(api.calls[0]!.headers[DELEGATION_HEADER])!
          .canWrite,
      ).toBe(true);

      // The read-only grant it replaced is gone with its token.
      expectUnauthorized(await call("list_incidents"));
    });

    it("cannot refresh its way to write access", async () => {
      const response: HttpResult = await harness.refresh(
        readOnly.clientId,
        readOnly.refreshToken,
        { scope: "mcp:read mcp:write" },
      );

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_scope");
    });
  });

  describe("what never needs a credential", () => {
    it("initialize", async () => {
      const response: HttpResult = await harness.mcp({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.1" },
        },
      });

      expect(response.status).toBe(200);
      expect(response.json.result.serverInfo.name).toBe("oneuptime-mcp");
      expect(response.headers.get("www-authenticate")).toBeNull();
    });

    it("the initialized notification", async () => {
      const response: HttpResult = await harness.mcp({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      expect(response.status).toBe(202);
    });

    it("tools/list, which lists the protected tools too: a client browses before anyone signs in", async () => {
      const response: HttpResult = await harness.mcp({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(response.status).toBe(200);

      const names: Array<string> = response.json.result.tools.map(
        (tool: { name: string }): string => {
          return tool.name;
        },
      );

      expect(names).toEqual(
        expect.arrayContaining([
          "list_incidents",
          "create_incident",
          "acknowledge_incident",
          "oneuptime_whoami",
          "oneuptime_help",
          "get_public_status_page_overview",
        ]),
      );
    });

    it.each<[string, Record<string, unknown>]>([
      ["oneuptime_help", {}],
      ["oneuptime_list_resources", {}],
      [
        "get_public_status_page_overview",
        { statusPageIdOrDomain: "status.example.com" },
      ],
      [
        "get_public_status_page_incidents",
        { statusPageIdOrDomain: "status.example.com" },
      ],
      [
        "get_public_status_page_scheduled_maintenance",
        { statusPageIdOrDomain: "status.example.com" },
      ],
      [
        "get_public_status_page_announcements",
        { statusPageIdOrDomain: "status.example.com" },
      ],
    ])(
      "the public tool %s",
      async (tool: string, args: Record<string, unknown>) => {
        const response: HttpResult = await harness.callTool(tool, args);

        expect(response.status).toBe(200);
        expect(response.headers.get("www-authenticate")).toBeNull();
        expect(response.json.result.isError).toBeFalsy();
      },
    );

    it("a call to a tool that does not exist: the answer is 'unknown tool', not a sign-in prompt", async () => {
      const response: HttpResult = await harness.callTool("no_such_tool", {});

      expect(response.status).toBe(200);
      expect(response.headers.get("www-authenticate")).toBeNull();
      // A JSON-RPC error from the SDK, which is where "no such tool" belongs.
      expect(response.json.error.message).toContain(
        "Unknown tool: no_such_tool",
      );
    });

    it("the public tools, even when a batch asks for several", async () => {
      const response: HttpResult = await harness.mcp([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "oneuptime_help", arguments: {} },
        },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);

      expect(response.status).toBe(200);
    });
  });

  describe("what does need one", () => {
    it.each<[string, Record<string, unknown>]>([
      ["list_incidents", {}],
      ["count_incidents", {}],
      ["get_incident", { id: INCIDENT_ID }],
      ["create_incident", { title: "x" }],
      ["delete_incident", { id: INCIDENT_ID }],
      ["acknowledge_incident", { incidentId: INCIDENT_ID }],
      ["oneuptime_whoami", {}],
      ["list_logs", {}],
    ])(
      "%s, called with nothing, is a 401 challenge and never reaches the API",
      async (tool: string, args: Record<string, unknown>) => {
        expectChallenge(await harness.callTool(tool, args), {
          status: 401,
          error: "invalid_token",
          description: SIGN_IN_REQUIRED,
        });
        expect(api.calls).toEqual([]);
      },
    );

    it("a batch with one protected call in it is challenged whole", async () => {
      const response: HttpResult = await harness.mcp([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_incidents", arguments: {} },
        },
      ]);

      expect(response.status).toBe(401);
      expect(api.calls).toEqual([]);
    });

    it("no identity is reported before too little scope: 401 for a write tool called with nothing", async () => {
      expect(
        (await harness.callTool("create_incident", { title: "x" })).status,
      ).toBe(401);
    });

    it("the challenge is answered before the protocol version is even looked at", async () => {
      // A version this server cannot speak would otherwise be a 400.
      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        { "mcp-protocol-version": "1999-01-01" },
      );

      expect(response.status).toBe(401);
    });
  });

  describe("an access token that is no good", () => {
    it("is refused once it has expired, and the client carries on after refreshing", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.expire(
        "token",
        String(
          harness.store.requireTokenBySecret(connected.accessToken)["_id"],
        ),
        1,
      );

      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        ),
      );
      expect(api.calls).toEqual([]);

      const refreshed: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(refreshed.json.access_token),
      );

      expect(response.status).toBe(200);
      expect(api.calls).toHaveLength(1);
    });

    it("is refused when nobody issued it", async () => {
      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(
            McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
          ),
        ),
      );
      expect(api.calls).toEqual([]);
    });

    it("is refused when it is mangled - and is NOT retried as an API key", async () => {
      const connected: ConnectedClient = await connect();

      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken.slice(0, -4)),
        ),
      );

      // Had it fallen through to the API key path, the API would have been asked.
      expect(api.calls).toEqual([]);
    });

    it("is refused even for a public tool: a bad credential is never quietly ignored", async () => {
      const response: HttpResult = await harness.callTool(
        "oneuptime_help",
        {},
        OAuthTestHarness.bearer(
          McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
        ),
      );

      expectUnauthorized(response);
    });

    it("is refused once its grant is disconnected", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.deleteGrant(connected.grantId);

      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        ),
      );
      expect(api.calls).toEqual([]);
    });

    it("is refused once its grant has expired from disuse", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.expire("grant", connected.grantId, 1);

      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        ),
      );
    });

    it("is refused at an instance that has since moved to another hostname", async () => {
      const connected: ConnectedClient = await connect();

      // What the grant looks like when HOST is no longer the host it was made for.
      harness.store.patch("grant", connected.grantId, {
        resource: "https://old-hostname.example/mcp",
      });

      expectUnauthorized(
        await harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        ),
      );
    });

    it("is not what a refresh token is: the MCP endpoint does not accept one as a sign-in", async () => {
      const connected: ConnectedClient = await connect();

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.refreshToken),
      );

      /*
       * It is not an access token, and it is not an API key either: it is
       * refused at the door with a challenge, and never reaches the API - a
       * refresh token is a long-lived secret and is not passed along.
       */
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'error="invalid_token"',
      );
      expect(api.calls).toEqual([]);

      // Presenting it there did not spend it: it still refreshes.
      const refreshed: HttpResult = await harness.token({
        grant_type: "refresh_token",
        refresh_token: connected.refreshToken,
        client_id: connected.clientId,
      });

      expect(refreshed.status).toBe(200);
    });
  });

  describe("when the server cannot find out whether a token is good", () => {
    /*
     * A 401 makes a client throw its token away and refresh; a failed
     * refresh makes it ask its user to sign in again. So "the database did
     * not answer" must never be reported as "the token is no good".
     */
    it("answers 500, not a challenge, when the token lookup fails", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.intercept("token", "findOneBy", (): void => {
        throw new Error("connection terminated unexpectedly");
      });

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(api.calls).toEqual([]);

      // The same token works once the database is back.
      harness.store.clearInterceptors();

      expect(
        (
          await harness.callTool(
            "list_incidents",
            {},
            OAuthTestHarness.bearer(connected.accessToken),
          )
        ).status,
      ).toBe(200);
    });

    it("answers 500, not a challenge, when the member's standing cannot be read", async () => {
      const connected: ConnectedClient = await connect();

      (
        jest.spyOn(
          AccessTokenService,
          "getUserTenantAccessPermission",
        ) as unknown as jest.Mock
      ).mockImplementationOnce(async (): Promise<never> => {
        throw new Error("connection terminated unexpectedly");
      });

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(api.calls).toEqual([]);
    });
  });

  describe("what ends a connection, on the very next call", () => {
    let connected: ConnectedClient;

    beforeEach(async () => {
      connected = await connect();
    });

    function callAsClient(): Promise<HttpResult> {
      return harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(connected.accessToken),
      );
    }

    it("the member is blocked - and it resumes when they are unblocked", async () => {
      expect((await callAsClient()).status).toBe(200);

      harness.blockUser(member);

      expectUnauthorized(await callAsClient());

      harness.unblockUser(member);

      expect((await callAsClient()).status).toBe(200);
    });

    it("the member leaves the project", async () => {
      harness.removeMembership(member, project);

      expectUnauthorized(await callAsClient());
      expect(api.calls).toEqual([]);
    });

    it("an administrator blocks the member's team from connecting clients", async () => {
      harness.blockFromConnectingClients(member, project);

      expectUnauthorized(await callAsClient());
    });

    it("the project starts requiring SSO, which this grant was not approved under", async () => {
      harness.setProjectSso(project, { required: true });

      expectUnauthorized(await callAsClient());
    });

    it("the instance starts requiring SSO", async () => {
      harness.setGlobalSsoRequired(true);

      expectUnauthorized(await callAsClient());
    });

    it("someone presses Disconnect", async () => {
      harness.store.deleteGrant(connected.grantId);

      expectUnauthorized(await callAsClient());
    });

    it("the instance switches OAuth off: the token is then just a string that is not an API key", async () => {
      harness.setOAuthEnabled(false);

      const response: HttpResult = await callAsClient();

      expect(response.status).toBe(200);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.json.result.isError).toBe(true);
      // It went to the API as a key, which refused it; nothing was delegated.
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]!.headers["APIKey"]).toBe(connected.accessToken);
      expect(DELEGATION_HEADER in api.calls[0]!.headers).toBe(false);
    });
  });

  describe("a grant approved under SSO", () => {
    it("works while the SSO sign-in is current, and stops when it lapses", async () => {
      harness.setProjectSso(project, { required: true });
      harness.signIn(member, {
        cookies: harness.projectSsoCookie(member, project, {
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
      });

      const connected: ConnectedClient = await connect();

      const call: () => Promise<HttpResult> = (): Promise<HttpResult> => {
        return harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        );
      };

      expect((await call()).status).toBe(200);

      harness.store.patch("grant", connected.grantId, {
        ssoExpiresAt: new Date(Date.now() - 1000),
      });

      expectUnauthorized(await call());

      // Refreshing does not get around it either.
      const refresh: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      expect(refresh.status).toBe(400);
      expect(refresh.json.error).toBe("invalid_grant");
    });
  });

  describe("recording when a client was last used", () => {
    it("stamps the grant on its first call and not again for five minutes", async () => {
      const connected: ConnectedClient = await connect();

      const call: () => Promise<HttpResult> = (): Promise<HttpResult> => {
        return harness.callTool(
          "list_incidents",
          {},
          OAuthTestHarness.bearer(connected.accessToken),
        );
      };

      expect(
        harness.store.requireRow("grant", connected.grantId)["lastUsedAt"],
      ).toBeUndefined();

      await call();
      // The write is fire-and-forget; give it its turn.
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 20);
      });

      const grant: StoreRow = harness.store.requireRow(
        "grant",
        connected.grantId,
      );
      const firstStamp: Date = grant["lastUsedAt"] as Date;

      expect(firstStamp).toBeInstanceOf(Date);

      await call();
      await call();
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 20);
      });

      expect(
        (
          harness.store.requireRow("grant", connected.grantId)[
            "lastUsedAt"
          ] as Date
        ).getTime(),
      ).toBe(firstStamp.getTime());

      // Six minutes on, it is written again.
      harness.store.patch("grant", connected.grantId, {
        lastUsedAt: new Date(Date.now() - 6 * 60 * 1000),
      });

      await call();
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 20);
      });

      expect(
        (
          harness.store.requireRow("grant", connected.grantId)[
            "lastUsedAt"
          ] as Date
        ).getTime(),
      ).toBeGreaterThan(Date.now() - 60 * 1000);
    });
  });

  describe.each([
    ["with OAuth enabled", true],
    ["with OAuth switched off", false],
  ])("an API key, %s", (_label: string, isOAuthEnabled: boolean) => {
    beforeEach(() => {
      harness.setOAuthEnabled(isOAuthEnabled);
    });

    it.each<[string, Record<string, string>]>([
      ["the x-api-key header", { "x-api-key": VALID_API_KEY }],
      [
        "a Bearer Authorization header",
        { Authorization: `Bearer ${VALID_API_KEY}` },
      ],
      [
        "a lower-case bearer scheme",
        { Authorization: `bearer ${VALID_API_KEY}` },
      ],
      ["a bare Authorization header", { Authorization: VALID_API_KEY }],
    ])(
      "in %s is forwarded to the API as it came, and nothing is delegated",
      async (_where: string, headers: Record<string, string>) => {
        const response: HttpResult = await harness.callTool(
          "list_incidents",
          {},
          headers,
        );

        expect(response.status).toBe(200);
        expect(toolPayload(response).success).toBe(true);

        expect(api.calls).toHaveLength(1);
        expect(api.calls[0]!.headers["APIKey"]).toBe(VALID_API_KEY);
        expect(DELEGATION_HEADER in api.calls[0]!.headers).toBe(false);
      },
    );

    it("is never challenged, even when the API refuses it: the refusal is a tool result the agent can read", async () => {
      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        { "x-api-key": "a-key-the-api-does-not-know" },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.json.result.isError).toBe(true);

      const payload: any = JSON.parse(response.json.result.content[0].text);

      expect(payload.statusCode).toBe(401);
      expect(payload.suggestion).toContain("API key");
    });

    it("may run a tool that writes: a key is not scoped here, its permissions are the API's business", async () => {
      const response: HttpResult = await harness.callTool(
        "create_incident",
        { title: "Database is down" },
        { "x-api-key": VALID_API_KEY },
      );

      expect(response.status).toBe(200);
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]!.headers["APIKey"]).toBe(VALID_API_KEY);
    });

    it("answers whoami as an API key always has", async () => {
      const payload: any = toolPayload(
        await harness.callTool(
          "oneuptime_whoami",
          {},
          { "x-api-key": VALID_API_KEY },
        ),
      );

      expect(payload.success).toBe(true);
      expect("authentication" in payload).toBe(false);
      expect("signedInAs" in payload).toBe(false);
    });
  });

  describe("an API key and an access token on one request", () => {
    it("is an API key request: x-api-key wins, and the token is not even looked up", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.calls = [];

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        {
          "x-api-key": VALID_API_KEY,
          ...OAuthTestHarness.bearer(connected.accessToken),
        },
      );

      expect(response.status).toBe(200);
      expect(api.calls[0]!.headers["APIKey"]).toBe(VALID_API_KEY);
      expect(DELEGATION_HEADER in api.calls[0]!.headers).toBe(false);
      expect(harness.store.callsTo("token", "findOneBy")).toHaveLength(0);
    });
  });

  describe("with OAuth switched off", () => {
    beforeEach(() => {
      harness.setOAuthEnabled(false);
    });

    it("answers a protected call that has no credential the way it always did: an in-band tool error, HTTP 200", async () => {
      const response: HttpResult = await harness.callTool("list_incidents", {});

      expect(response.status).toBe(200);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.json.result.isError).toBe(true);
      expect(response.json.result.content[0].text).toMatch(
        /API key is required/i,
      );
      expect(api.calls).toEqual([]);
    });

    it("says the same for a workflow tool", async () => {
      const response: HttpResult = await harness.callTool(
        "oneuptime_whoami",
        {},
      );

      expect(response.status).toBe(200);
      expect(response.json.result.isError).toBe(true);
      expect(response.json.result.content[0].text).toMatch(
        /API key is required/i,
      );
    });

    it("treats a bearer that looks like an access token as the API key it is not: no lookup, no challenge", async () => {
      const lookalike: string = McpOAuthSecret.mint(
        McpOAuthTokenType.AccessToken,
      );

      const response: HttpResult = await harness.callTool(
        "list_incidents",
        {},
        OAuthTestHarness.bearer(lookalike),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.json.result.isError).toBe(true);
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0]!.headers["APIKey"]).toBe(lookalike);
      expect(harness.store.calls).toEqual([]);
    });

    it("still serves the public tools and the tool list", async () => {
      expect((await harness.callTool("oneuptime_help", {})).status).toBe(200);
      expect(
        (await harness.mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
          .status,
      ).toBe(200);
    });
  });
});
