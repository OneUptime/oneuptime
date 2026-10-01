/**
 * Interoperability with the real MCP SDK client.
 *
 * Every other test in this directory plays the client itself, which proves
 * the server does what this codebase thinks an MCP client needs. This one
 * hands the job to @modelcontextprotocol/sdk's own Client, transport and
 * OAuth implementation - the code Claude Code, the MCP Inspector and most
 * third-party clients are built on - and only plays the BROWSER: it opens the
 * authorization URL the SDK produces, approves on the consent endpoint as the
 * signed-in member, and hands the code back.
 *
 * So what is checked is that the SDK, told nothing but the MCP URL, can
 * discover, register, authorize, call a tool, refresh on its own when its
 * token expires, and notice when it has been disconnected.
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

import {
  OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import OAuthTestHarness, {
  HttpResult,
  TestMember,
  TestProject,
} from "./Helpers/OAuthTestHarness";
import FakeOneUptimeApi, {
  DELEGATION_HEADER,
} from "./Helpers/FakeOneUptimeApi";
import { StoreRow } from "./Helpers/InMemoryOAuthStore";
import OneUptimeApiService from "../../Services/OneUptimeApiService";
import { generateAllTools } from "../../Tools/ToolGenerator";
import McpDelegationToken, {
  McpDelegationClaims,
} from "Common/Server/Utils/Mcp/McpDelegationToken";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

const REDIRECT_URL: string = "http://localhost:53999/callback";
const INCIDENT_ID: string = "550e8400-e29b-41d4-a716-446655440000";

/*
 * The storage an MCP client application gives the SDK: where it keeps its
 * registration, its tokens and its PKCE verifier, and how it "opens the
 * browser". Here all of it is memory, and opening the browser just records
 * the URL for the test to visit.
 */
class InMemoryOAuthClientProvider implements OAuthClientProvider {
  public authorizationUrls: Array<URL> = [];
  public invalidations: Array<string> = [];
  public savedTokenHistory: Array<OAuthTokens> = [];

  /*
   * Set by a client that publishes a Client ID Metadata Document: the URL
   * the SDK uses as its client id when the server says it supports that.
   */
  public clientMetadataUrl?: string;

  public constructor(clientMetadataUrl?: string | undefined) {
    if (clientMetadataUrl) {
      this.clientMetadataUrl = clientMetadataUrl;
    }
  }

  private clientInfo: OAuthClientInformationMixed | undefined = undefined;
  private currentTokens: OAuthTokens | undefined = undefined;
  private verifier: string | undefined = undefined;

  public get redirectUrl(): string {
    return REDIRECT_URL;
  }

  public get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "SDK Interop Client",
      redirect_uris: [REDIRECT_URL],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  public state(): string {
    return "sdk-state-1";
  }

  public clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  public saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): void {
    this.clientInfo = clientInformation;
  }

  public tokens(): OAuthTokens | undefined {
    return this.currentTokens;
  }

  public saveTokens(tokens: OAuthTokens): void {
    this.currentTokens = tokens;
    this.savedTokenHistory.push(tokens);
  }

  public redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrls.push(authorizationUrl);
  }

  public saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  public codeVerifier(): string {
    if (!this.verifier) {
      throw new Error("No code verifier was saved.");
    }

    return this.verifier;
  }

  public invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    this.invalidations.push(scope);

    if (scope === "all" || scope === "tokens") {
      this.currentTokens = undefined;
    }

    if (scope === "all" || scope === "client") {
      this.clientInfo = undefined;
    }

    if (scope === "all" || scope === "verifier") {
      this.verifier = undefined;
    }
  }
}

describe("the MCP SDK's own client, against this server", () => {
  let harness: OAuthTestHarness;
  let member: TestMember;
  let project: TestProject;

  let provider: InMemoryOAuthClientProvider;
  let transport: StreamableHTTPClientTransport;
  let client: Client;

  const api: FakeOneUptimeApi = new FakeOneUptimeApi();

  beforeAll(async () => {
    harness = await OAuthTestHarness.start({ tools: generateAllTools() });
    OneUptimeApiService.initialize({ url: "https://api.oneuptime.test" });
    api.install();
  });

  afterAll(async () => {
    api.uninstall();
    await harness.stop();
  });

  beforeEach(async () => {
    harness.reset();
    jest.clearAllMocks();
    api.reset();
    api.rowsFor = (): Array<JSONObject> => {
      return [{ _id: INCIDENT_ID, title: "Database is down" }];
    };
    ({ member, project } = harness.addMemberWithProject({
      projectName: "Acme Production",
    }));

    provider = new InMemoryOAuthClientProvider();
    transport = new StreamableHTTPClientTransport(
      new URL(`${harness.origin}/mcp`),
      { authProvider: provider },
    );
    client = new Client({ name: "sdk-interop-test", version: "1.0.0" });

    /*
     * Cast for the same reason RouteHandler casts its transport: the SDK's
     * optional properties and this project's exactOptionalPropertyTypes.
     */
    await client.connect(transport as Parameters<typeof client.connect>[0]);
  });

  afterEach(async () => {
    await client.close();
  });

  // The person at the consent screen: opens the URL, approves, returns the code.
  async function approveInBrowser(
    authorizationUrl: URL,
    access: "read" | "write" = "write",
  ): Promise<{ code: string; callback: URL }> {
    const toConsent: HttpResult = await harness.request(
      authorizationUrl.toString(),
    );

    expect(toConsent.status).toBe(302);
    expect(toConsent.location!.pathname).toBe("/accounts/mcp-authorize");

    harness.signIn(member);

    const approval: HttpResult = await harness.consent("approve", {
      request: toConsent.location!.searchParams.get("request"),
      projectId: project.id.toString(),
      access,
    });

    expect(approval.status).toBe(200);

    const callback: URL = new URL(approval.json.redirectUrl);

    return { code: callback.searchParams.get("code")!, callback };
  }

  // Runs the SDK up to the point where it holds tokens.
  async function signInWithSdk(
    access: "read" | "write" = "write",
  ): Promise<void> {
    await expect(
      client.callTool({ name: "list_incidents", arguments: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const { code } = await approveInBrowser(
      provider.authorizationUrls[provider.authorizationUrls.length - 1]!,
      access,
    );

    await transport.finishAuth(code);
  }

  function textOf(result: unknown): any {
    const content: Array<{ type: string; text: string }> = (
      result as { content: Array<{ type: string; text: string }> }
    ).content;

    return JSON.parse(content[0]!.text);
  }

  it("connects, lists the tools and calls a public tool before anyone has signed in", async () => {
    const tools: { tools: Array<{ name: string }> } = await client.listTools();

    expect(
      tools.tools.map((tool: { name: string }): string => {
        return tool.name;
      }),
    ).toEqual(expect.arrayContaining(["list_incidents", "oneuptime_help"]));

    const help: unknown = await client.callTool({
      name: "oneuptime_help",
      arguments: {},
    });

    expect((help as { isError?: boolean }).isError).toBeFalsy();

    // Nothing was registered, nobody was asked to sign in.
    expect(provider.authorizationUrls).toEqual([]);
    expect(harness.store.count("client")).toBe(0);
  });

  it("discovers the authorization server from the 401, registers itself and asks to open the right URL", async () => {
    await expect(
      client.callTool({ name: "list_incidents", arguments: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // It registered through Dynamic Client Registration, as a public client.
    expect(harness.store.count("client")).toBe(1);

    const registration: OAuthClientInformationMixed =
      provider.clientInformation()!;
    const row: StoreRow = harness.store.requireRow(
      "client",
      registration.client_id,
    );

    expect(ObjectID.isValidUUID(registration.client_id)).toBe(true);
    expect(registration.client_secret).toBeUndefined();
    expect(row["clientName"]).toBe("SDK Interop Client");
    expect(row["redirectUris"]).toEqual([REDIRECT_URL]);
    expect(row["tokenEndpointAuthMethod"]).toBe("none");

    // And it built the authorization URL from the discovered metadata.
    expect(provider.authorizationUrls).toHaveLength(1);

    const url: URL = provider.authorizationUrls[0]!;

    expect(`${url.origin}${url.pathname}`).toBe(
      `${harness.origin}/mcp/oauth/authorize`,
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(registration.client_id);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URL);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(url.searchParams.get("state")).toBe("sdk-state-1");
    // The scope the challenge named, and the resource the metadata named.
    expect(url.searchParams.get("scope")).toBe("mcp:read mcp:write");
    expect(url.searchParams.get("resource")).toBe(`${harness.origin}/mcp`);
  });

  it("is handed back a callback its own checks accept: the state it sent and the issuer it discovered", async () => {
    await expect(
      client.callTool({ name: "list_incidents", arguments: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const { callback } = await approveInBrowser(provider.authorizationUrls[0]!);

    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URL);
    expect(callback.searchParams.get("state")).toBe("sdk-state-1");
    expect(callback.searchParams.get("iss")).toBe(`${harness.origin}/mcp`);
  });

  it("exchanges the code, then calls the protected tool as the member who approved", async () => {
    await signInWithSdk();

    const tokens: OAuthTokens = provider.tokens()!;

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("mcp:read mcp:write");
    expect(
      McpOAuthSecret.isValidShape(
        tokens.access_token,
        McpOAuthTokenType.AccessToken,
      ),
    ).toBe(true);
    expect(
      McpOAuthSecret.isValidShape(
        tokens.refresh_token,
        McpOAuthTokenType.RefreshToken,
      ),
    ).toBe(true);

    const result: unknown = await client.callTool({
      name: "list_incidents",
      arguments: {},
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(textOf(result).success).toBe(true);
    expect(textOf(result).data[0].title).toBe("Database is down");

    // The API saw the member, through a delegation token - not the SDK's token.
    expect(api.calls).toHaveLength(1);

    const claims: McpDelegationClaims | null = McpDelegationToken.verify(
      api.calls[0]!.headers[DELEGATION_HEADER],
    );

    expect(claims!.userId.toString()).toBe(member.id.toString());
    expect(claims!.projectId.toString()).toBe(project.id.toString());
    expect(claims!.clientName).toBe("SDK Interop Client");
    expect(JSON.stringify(api.calls)).not.toContain(tokens.access_token);
  });

  it("can write once its user has allowed it", async () => {
    await signInWithSdk("write");

    const result: unknown = await client.callTool({
      name: "create_incident",
      arguments: { title: "Database is down" },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(
      McpDelegationToken.verify(api.calls[0]!.headers[DELEGATION_HEADER])!
        .canWrite,
    ).toBe(true);
  });

  it("refreshes by itself when its access token has expired, without asking anyone", async () => {
    await signInWithSdk();

    const first: OAuthTokens = provider.tokens()!;

    harness.store.expire(
      "token",
      String(harness.store.requireTokenBySecret(first.access_token)["_id"]),
      1,
    );

    const result: unknown = await client.callTool({
      name: "list_incidents",
      arguments: {},
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();

    const second: OAuthTokens = provider.tokens()!;

    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // One authorization, ever; the refresh was silent.
    expect(provider.authorizationUrls).toHaveLength(1);
    expect(provider.invalidations).toEqual([]);

    // The refresh token it used is spent on the server.
    expect(
      harness.store.requireTokenBySecret(first.refresh_token!)["consumedAt"],
    ).toBeInstanceOf(Date);
  });

  it("keeps working across several expiries in a row", async () => {
    await signInWithSdk();

    for (let round: number = 0; round < 3; round++) {
      harness.store.expire(
        "token",
        String(
          harness.store.requireTokenBySecret(provider.tokens()!.access_token)[
            "_id"
          ],
        ),
        1,
      );

      const result: unknown = await client.callTool({
        name: "list_incidents",
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
    }

    expect(provider.authorizationUrls).toHaveLength(1);
    expect(harness.store.count("grant")).toBe(1);
  });

  it("notices it was disconnected: it drops its tokens and asks to sign in again", async () => {
    await signInWithSdk();

    const tokens: OAuthTokens = provider.tokens()!;

    // The member presses Disconnect in OneUptime.
    harness.store.deleteGrant(
      String(
        harness.store.requireTokenBySecret(tokens.access_token)[
          "mcpOAuthGrantId"
        ],
      ),
    );

    await expect(
      client.callTool({ name: "list_incidents", arguments: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    /*
     * The 401 made it try its refresh token; `invalid_grant` made it discard
     * its tokens (and only its tokens - its registration is still good) and
     * start a fresh authorization.
     */
    expect(provider.invalidations).toEqual(["tokens"]);
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toBeDefined();
    expect(provider.authorizationUrls).toHaveLength(2);
    expect(harness.store.count("client")).toBe(1);

    // And signing in again works.
    const { code } = await approveInBrowser(provider.authorizationUrls[1]!);

    await transport.finishAuth(code);

    const result: unknown = await client.callTool({
      name: "list_incidents",
      arguments: {},
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
  });

  it("notices a revocation made through the revocation endpoint the same way", async () => {
    await signInWithSdk();

    const tokens: OAuthTokens = provider.tokens()!;

    const revoked: HttpResult = await harness.revoke({
      client_id: provider.clientInformation()!.client_id,
      token: tokens.refresh_token!,
    });

    expect(revoked.status).toBe(200);

    await expect(
      client.callTool({ name: "list_incidents", arguments: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(provider.invalidations).toEqual(["tokens"]);
  });

  it("is refused a write tool with a clear error when its user allowed read only, and can still read", async () => {
    await signInWithSdk("read");

    expect(provider.tokens()!.scope).toBe("mcp:read");

    /*
     * The 403 names the scope to ask for. Holding a refresh token, the SDK
     * answers it by refreshing - which cannot widen a grant - and then gives
     * up cleanly rather than looping.
     */
    let failure: unknown = undefined;

    try {
      await client.callTool({
        name: "create_incident",
        arguments: { title: "x" },
      });
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(StreamableHTTPError);
    expect((failure as StreamableHTTPError).code).toBe(403);
    expect(api.calls).toEqual([]);

    // Its connection is intact: the grant, and its ability to read.
    expect(harness.store.count("grant")).toBe(1);

    const result: unknown = await client.callTool({
      name: "list_incidents",
      arguments: {},
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(
      McpDelegationToken.verify(
        api.calls[api.calls.length - 1]!.headers[DELEGATION_HEADER],
      )!.canWrite,
    ).toBe(false);
  });

  it("reuses its registration for a second sign-in instead of registering again", async () => {
    await signInWithSdk();

    harness.store.deleteGrant(String(harness.store.onlyGrant()["_id"]));

    await signInWithSdk();

    expect(harness.store.count("client")).toBe(1);
    expect(harness.store.count("grant")).toBe(1);
  });

  /*
   * `invalid_client` is the one answer that makes the SDK throw away BOTH its
   * tokens and its registration. A server that cannot read its own client
   * table during a refresh therefore must not say it: a moment of database
   * trouble would sign the client out and leave a second registration
   * behind. A server fault costs the client nothing it holds.
   */
  it("keeps its registration and its tokens through a moment of database trouble on the server", async () => {
    await signInWithSdk();

    const registeredAs: string = provider.clientInformation()!.client_id;

    harness.store.expire(
      "token",
      String(
        harness.store.requireTokenBySecret(provider.tokens()!.access_token)[
          "_id"
        ],
      ),
      1,
    );

    // The client lookup fails once, while the SDK is refreshing.
    let failures: number = 0;

    harness.store.intercept("client", "findOneById", (): void => {
      if (failures === 0) {
        failures++;
        throw new Error("connection terminated unexpectedly");
      }
    });

    // Whatever this call does, it must not cost the client its credentials.
    await client
      .callTool({ name: "list_incidents", arguments: {} })
      .catch((): undefined => {
        return undefined;
      });

    expect(failures).toBe(1);
    expect(provider.invalidations).not.toContain("all");
    expect(provider.invalidations).not.toContain("client");
    expect(provider.clientInformation()?.client_id).toBe(registeredAs);
    expect(harness.store.count("client")).toBe(1);

    // And once the database is back, it carries on without anybody signing in.
    const result: unknown = await client.callTool({
      name: "list_incidents",
      arguments: {},
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(harness.store.count("grant")).toBe(1);
  });

  describe("a client that publishes a Client ID Metadata Document", () => {
    const DOCUMENT_URL: string = "https://client.example/oauth/client.json";

    // Replaces the default client with one whose provider names a document.
    async function useDocumentClient(): Promise<void> {
      await client.close();

      provider = new InMemoryOAuthClientProvider(DOCUMENT_URL);
      transport = new StreamableHTTPClientTransport(
        new URL(`${harness.origin}/mcp`),
        { authProvider: provider },
      );
      client = new Client({ name: "sdk-interop-test", version: "1.0.0" });

      await client.connect(transport as Parameters<typeof client.connect>[0]);
    }

    it("uses the document URL as its client id and registers nothing, because the server says it supports that", async () => {
      harness.addMetadataDocumentClient({
        clientId: DOCUMENT_URL,
        clientName: "Document Client",
        redirectUris: [REDIRECT_URL],
      });

      await useDocumentClient();
      await signInWithSdk();

      expect(harness.store.count("client")).toBe(0);
      expect(provider.clientInformation()!.client_id).toBe(DOCUMENT_URL);
      expect(provider.authorizationUrls[0]!.searchParams.get("client_id")).toBe(
        DOCUMENT_URL,
      );
      expect(harness.store.onlyGrant()["clientId"]).toBe(DOCUMENT_URL);
      expect(harness.store.onlyGrant()["name"]).toBe("Document Client");

      const result: unknown = await client.callTool({
        name: "list_incidents",
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
    });

    it("refreshes as that client too", async () => {
      harness.addMetadataDocumentClient({
        clientId: DOCUMENT_URL,
        redirectUris: [REDIRECT_URL],
      });

      await useDocumentClient();
      await signInWithSdk();

      const first: OAuthTokens = provider.tokens()!;

      harness.store.expire(
        "token",
        String(harness.store.requireTokenBySecret(first.access_token)["_id"]),
        1,
      );

      const result: unknown = await client.callTool({
        name: "list_incidents",
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
      expect(provider.tokens()!.access_token).not.toBe(first.access_token);
    });

    it("falls back to registering itself on an instance with metadata documents switched off", async () => {
      harness.setClientIdMetadataDocumentEnabled(false);

      await useDocumentClient();
      await signInWithSdk();

      // The server stopped advertising support, so the SDK registered instead.
      expect(harness.store.count("client")).toBe(1);
      expect(provider.clientInformation()!.client_id).not.toBe(DOCUMENT_URL);
      expect(
        ObjectID.isValidUUID(provider.clientInformation()!.client_id),
      ).toBe(true);

      const result: unknown = await client.callTool({
        name: "list_incidents",
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
    });
  });
});
