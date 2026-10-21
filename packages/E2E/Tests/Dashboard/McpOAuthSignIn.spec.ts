import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIRequestContext,
  APIResponse,
  Browser,
  Locator,
  Page,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import crypto from "crypto";

/*
 * Signing an MCP client in to OneUptime with OAuth, the way a real client
 * does it, against a real stack:
 *
 *  1. The client calls a tool with no credential and is told, by a 401 and
 *     two discovery documents, where to send its user.
 *  2. It registers itself, and opens the authorization URL in the member's
 *     browser. The member sees the consent screen, chooses, and is sent back
 *     to the client with a code.
 *  3. The client exchanges the code and calls tools as the member - and what
 *     it holds is good for the MCP endpoint only.
 *  4. The member sees the client under Settings > MCP Server and disconnects
 *     it; the client is signed out at once.
 *  5. A client authorized as read only can read and cannot write.
 *
 * The "client" here is this file: plain HTTP for the client's side, the real
 * browser for the member's. The client's redirect URI is a loopback address
 * nothing listens on; the browser's navigation to it is answered by
 * Playwright, which is exactly where a native client's local listener sits.
 *
 * cd packages/E2E && HOST=localhost:18561 HTTP_PROTOCOL=http CI=1 \
 *   npx playwright test Tests/Dashboard/McpOAuthSignIn.spec.ts --retries=0
 */

test.describe.configure({ mode: "serial" });

const REDIRECT_URI: string = "http://127.0.0.1:33418/callback";
const CLIENT_NAME: string = `E2E MCP Client ${Date.now()}`;

const baseUrl: string = BASE_URL.toString().replace(/\/$/, "");
const mcpUrl: string = `${baseUrl}/mcp`;

interface AuthorizationServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

interface Pkce {
  verifier: string;
  challenge: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  scope: string;
}

interface ToolAnswer {
  status: number;
  wwwAuthenticate: string;
  result: Record<string, unknown> | null;
  isError: boolean;
}

type NewPkceFunction = () => Pkce;

const newPkce: NewPkceFunction = (): Pkce => {
  const verifier: string = crypto.randomBytes(48).toString("base64url");

  return {
    verifier,
    challenge: crypto
      .createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url"),
  };
};

type CallToolFunction = (data: {
  request: APIRequestContext;
  accessToken?: string | undefined;
  name: string;
  args?: Record<string, unknown> | undefined;
}) => Promise<ToolAnswer>;

// One MCP tools/call, as a client makes it.
const callTool: CallToolFunction = async (data: {
  request: APIRequestContext;
  accessToken?: string | undefined;
  name: string;
  args?: Record<string, unknown> | undefined;
}): Promise<ToolAnswer> => {
  const response: APIResponse = await data.request.post(mcpUrl, {
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(data.accessToken
        ? { authorization: `Bearer ${data.accessToken}` }
        : {}),
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: data.name, arguments: data.args || {} },
    },
  });

  let body: {
    result?: { structuredContent?: Record<string, unknown>; isError?: boolean };
  } = {};

  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return {
    status: response.status(),
    wwwAuthenticate: response.headers()["www-authenticate"] || "",
    result: body.result?.structuredContent || null,
    isError: Boolean(body.result?.isError),
  };
};

type AuthorizeUrlFunction = (data: {
  server: AuthorizationServer;
  clientId: string;
  pkce: Pkce;
  scope: string;
  state: string;
}) => string;

const authorizeUrl: AuthorizeUrlFunction = (data: {
  server: AuthorizationServer;
  clientId: string;
  pkce: Pkce;
  scope: string;
  state: string;
}): string => {
  const url: globalThis.URL = new globalThis.URL(
    data.server.authorizationEndpoint,
  );

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", data.clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge", data.pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", data.scope);
  url.searchParams.set("state", data.state);
  url.searchParams.set("resource", mcpUrl);

  return url.toString();
};

type AuthorizeInBrowserFunction = (data: {
  page: Page;
  url: string;
  projectId: string;
  access?: "read" | "write" | undefined;
}) => Promise<globalThis.URL>;

/*
 * The member's half: open the authorization URL, decide on the consent
 * screen, and land on the client's redirect URI. Returns that final address,
 * which is where the client reads its code from.
 */
const authorizeInBrowser: AuthorizeInBrowserFunction = async (data: {
  page: Page;
  url: string;
  projectId: string;
  access?: "read" | "write" | undefined;
}): Promise<globalThis.URL> => {
  const page: Page = data.page;

  // Stands in for the client's loopback listener.
  await page.route(`${REDIRECT_URI}**`, async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body><p id='mcp-client-callback'>Connected.</p></body></html>",
    });
  });

  await page.goto(data.url, { waitUntil: "domcontentloaded" });

  const approve: Locator = page.getByTestId("mcp-authorize-approve");
  await expect(approve).toBeVisible({ timeout: 60000 });

  await page.getByTestId("mcp-authorize-project").selectOption(data.projectId);

  if (data.access) {
    await page.getByTestId(`mcp-authorize-access-${data.access}`).check();
  }

  await expect(approve).toBeEnabled({ timeout: 30000 });
  await approve.click();

  await expect(page.locator("#mcp-client-callback")).toBeVisible({
    timeout: 60000,
  });

  await page.unroute(`${REDIRECT_URI}**`);

  return new globalThis.URL(page.url());
};

type ExchangeCodeFunction = (data: {
  request: APIRequestContext;
  server: AuthorizationServer;
  clientId: string;
  code: string;
  verifier: string;
}) => Promise<Tokens>;

const exchangeCode: ExchangeCodeFunction = async (data: {
  request: APIRequestContext;
  server: AuthorizationServer;
  clientId: string;
  code: string;
  verifier: string;
}): Promise<Tokens> => {
  const response: APIResponse = await data.request.post(
    data.server.tokenEndpoint,
    {
      form: {
        grant_type: "authorization_code",
        code: data.code,
        code_verifier: data.verifier,
        client_id: data.clientId,
        redirect_uri: REDIRECT_URI,
      },
    },
  );

  expect(response.status()).toBe(200);

  const body: {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
  } = await response.json();

  expect(body.token_type).toBe("Bearer");

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    scope: body.scope,
  };
};

test.describe("MCP server: signing a client in with OAuth", () => {
  let page: Page;
  let projectId: string;
  let server: AuthorizationServer;
  let clientId: string;
  let tokens: Tokens;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    /*
     * On a billing install, Growth: connecting an MCP client is gated on the
     * same plan as API keys (McpOAuthGrant's create), and the consent screen
     * would list a Free project as not available.
     */
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "MCP OAuth",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("a client with no credential is told where to sign in", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(120000);

    // Connecting and browsing need nobody to sign in.
    const help: ToolAnswer = await callTool({
      request,
      name: "oneuptime_help",
    });
    expect(help.status).toBe(200);

    // A tool that needs an identity is refused at the HTTP layer.
    const refused: ToolAnswer = await callTool({
      request,
      name: "oneuptime_whoami",
    });

    expect(refused.status).toBe(401);
    expect(refused.wwwAuthenticate).toContain('error="invalid_token"');
    expect(refused.wwwAuthenticate).toContain('scope="mcp:read mcp:write"');

    const metadataUrlPattern: RegExp = /resource_metadata="([^"]+)"/;
    const resourceMetadataUrl: string | undefined =
      (refused.wwwAuthenticate.match(metadataUrlPattern) || [])[1];

    expect(resourceMetadataUrl).toBe(
      `${mcpUrl}/.well-known/oauth-protected-resource`,
    );

    const resourceMetadata: {
      resource: string;
      authorization_servers: Array<string>;
    } = await (await request.get(resourceMetadataUrl as string)).json();

    expect(resourceMetadata.resource).toBe(mcpUrl);
    expect(resourceMetadata.authorization_servers).toEqual([mcpUrl]);

    // RFC 8414: an issuer with a path puts its document under the origin.
    const serverMetadataResponse: APIResponse = await request.get(
      `${baseUrl}/.well-known/oauth-authorization-server/mcp`,
    );

    expect(serverMetadataResponse.status()).toBe(200);

    const serverMetadata: {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: Array<string>;
    } = await serverMetadataResponse.json();

    expect(serverMetadata.issuer).toBe(mcpUrl);
    expect(serverMetadata.code_challenge_methods_supported).toEqual(["S256"]);

    server = {
      authorizationEndpoint: serverMetadata.authorization_endpoint,
      tokenEndpoint: serverMetadata.token_endpoint,
      registrationEndpoint: serverMetadata.registration_endpoint,
    };

    const registration: APIResponse = await request.post(
      server.registrationEndpoint,
      {
        data: {
          client_name: CLIENT_NAME,
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
      },
    );

    expect(registration.status()).toBe(201);

    const registered: { client_id: string; client_secret?: string } =
      await registration.json();

    expect(registered.client_secret).toBeUndefined();
    clientId = registered.client_id;
  });

  test("the member approves the client on the consent screen", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(240000);

    const pkce: Pkce = newPkce();

    const url: string = authorizeUrl({
      server,
      clientId,
      pkce,
      scope: "mcp:read mcp:write",
      state: "e2e-state-1",
    });

    // What the member is shown before deciding.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mcp-authorize-approve")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("mcp-authorize-subtitle")).toContainText(
      CLIENT_NAME,
    );
    await expect(
      page.getByTestId("mcp-authorize-redirect-target"),
    ).toContainText("127.0.0.1:33418");
    await expect(
      page.getByTestId("mcp-authorize-loopback-warning"),
    ).toBeVisible();
    // The client asked to write, so both levels are offered.
    await expect(page.getByTestId("mcp-authorize-access-write")).toBeChecked();
    await expect(page.getByTestId("mcp-authorize-access-read")).toBeVisible();

    const callback: globalThis.URL = await authorizeInBrowser({
      page,
      url,
      projectId,
    });

    expect(callback.searchParams.get("state")).toBe("e2e-state-1");
    expect(callback.searchParams.get("iss")).toBe(mcpUrl);

    const code: string = callback.searchParams.get("code") || "";
    expect(code.startsWith("oumcp_ac_")).toBe(true);

    tokens = await exchangeCode({
      request,
      server,
      clientId,
      code,
      verifier: pkce.verifier,
    });

    expect(tokens.scope).toBe("mcp:read mcp:write");

    // A code is good once.
    const replay: APIResponse = await request.post(server.tokenEndpoint, {
      form: {
        grant_type: "authorization_code",
        code,
        code_verifier: pkce.verifier,
        client_id: clientId,
      },
    });

    expect(replay.status()).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
  });

  test("a replayed code ends the connection it created", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(240000);

    // The replay above revoked the grant: the tokens it issued are dead.
    const afterReplay: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "oneuptime_whoami",
    });

    expect(afterReplay.status).toBe(401);

    // So the member connects the client again.
    const pkce: Pkce = newPkce();

    const callback: globalThis.URL = await authorizeInBrowser({
      page,
      url: authorizeUrl({
        server,
        clientId,
        pkce,
        scope: "mcp:read mcp:write",
        state: "e2e-state-2",
      }),
      projectId,
    });

    tokens = await exchangeCode({
      request,
      server,
      clientId,
      code: callback.searchParams.get("code") || "",
      verifier: pkce.verifier,
    });
  });

  test("the client works as the member, in the project they chose", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(180000);

    const who: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "oneuptime_whoami",
    });

    expect(who.status).toBe(200);
    expect(who.result?.["authentication"]).toBe("oauth");
    expect(who.result?.["client"]).toBe(CLIENT_NAME);
    expect(who.result?.["access"]).toBe("read-and-write");
    expect(
      (who.result?.["projects"] as Array<{ projectId: string }>).map(
        (project: { projectId: string }): string => {
          return project.projectId;
        },
      ),
    ).toEqual([projectId]);

    const labelName: string = `e2e-mcp-label-${Date.now()}`;

    const created: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "create_label",
      args: { name: labelName, color: "#2563eb" },
    });

    expect(created.status).toBe(200);
    expect(created.isError).toBe(false);

    const listed: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "list_labels",
      args: { query: { name: labelName } },
    });

    expect(listed.result?.["returnedCount"]).toBe(1);
  });

  test("what the client holds is good for the MCP endpoint and nothing else", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(120000);

    const asBearer: APIResponse = await request.post(
      `${baseUrl}/api/label/get-list`,
      {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          tenantid: projectId,
        },
        data: { query: {}, select: { name: true } },
      },
    );

    expect(asBearer.status()).not.toBe(200);

    const asApiKey: APIResponse = await request.post(
      `${baseUrl}/api/label/get-list`,
      {
        headers: { apikey: tokens.accessToken, tenantid: projectId },
        data: { query: {}, select: { name: true } },
      },
    );

    expect(asApiKey.status()).not.toBe(200);
  });

  test("a refresh token put where the credential goes is refused at the MCP endpoint, not passed on", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(120000);

    /*
     * A client that mixes its credentials up sends the long-lived one. It is
     * neither an access token nor an API key, so it stops at the door with
     * the challenge a bad token gets - in either header a credential can be
     * sent in - instead of travelling on to the API as a key.
     */
    for (const headers of [
      { authorization: `Bearer ${tokens.refreshToken}` },
      { "x-api-key": tokens.refreshToken },
      // An access token is a credential, but not in the API key header.
      { "x-api-key": tokens.accessToken },
    ]) {
      const response: APIResponse = await request.post(mcpUrl, {
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...headers,
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "oneuptime_whoami", arguments: {} },
        },
      });

      expect(response.status()).toBe(401);
      expect(response.headers()["www-authenticate"]).toContain(
        'error="invalid_token"',
      );
      expect(await response.text()).not.toContain(tokens.refreshToken);
    }

    // Where it belongs, the access token is as good as it was.
    const stillSignedIn: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "oneuptime_whoami",
    });

    expect(stillSignedIn.status).toBe(200);
    expect(stillSignedIn.isError).toBe(false);
  });

  test("the member sees the client in Settings and disconnects it", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(240000);

    await gotoProjectPage({
      page,
      projectId,
      url: URL.fromString(BASE_URL.toString())
        .addRoute(`/dashboard/${projectId}/settings/mcp-server`)
        .toString(),
      ready: page.getByText("Connected MCP Clients", { exact: true }),
    });

    const row: Locator = page.locator("tr", { hasText: CLIENT_NAME });

    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row).toContainText("Read and write");

    await row.getByRole("button", { name: "Disconnect" }).click();

    const modal: Locator = page.getByTestId("modal");

    await expect(modal).toBeVisible({ timeout: 30000 });
    await expect(modal).toContainText("Disconnect MCP Client");
    await expect(modal).toContainText(CLIENT_NAME);

    await page.getByTestId("modal-footer-submit-button").click();

    await expect(row).toHaveCount(0, { timeout: 30000 });

    const afterDisconnect: ToolAnswer = await callTool({
      request,
      accessToken: tokens.accessToken,
      name: "oneuptime_whoami",
    });

    expect(afterDisconnect.status).toBe(401);

    const refresh: APIResponse = await request.post(server.tokenEndpoint, {
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId,
      },
    });

    expect(refresh.status()).toBe(400);
    expect((await refresh.json()).error).toBe("invalid_grant");
  });

  test("a client the member authorized as read only cannot write", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    test.setTimeout(240000);

    const pkce: Pkce = newPkce();

    const callback: globalThis.URL = await authorizeInBrowser({
      page,
      url: authorizeUrl({
        server,
        clientId,
        pkce,
        scope: "mcp:read mcp:write",
        state: "e2e-state-3",
      }),
      projectId,
      access: "read",
    });

    const readOnly: Tokens = await exchangeCode({
      request,
      server,
      clientId,
      code: callback.searchParams.get("code") || "",
      verifier: pkce.verifier,
    });

    // The answer says what was granted, not what was asked for.
    expect(readOnly.scope).toBe("mcp:read");

    const read: ToolAnswer = await callTool({
      request,
      accessToken: readOnly.accessToken,
      name: "list_labels",
    });

    expect(read.status).toBe(200);
    expect(read.isError).toBe(false);

    const blockedName: string = `e2e-read-only-${Date.now()}`;

    const write: ToolAnswer = await callTool({
      request,
      accessToken: readOnly.accessToken,
      name: "create_label",
      args: { name: blockedName, color: "#dc2626" },
    });

    expect(write.status).toBe(403);
    expect(write.wwwAuthenticate).toContain('error="insufficient_scope"');

    const after: ToolAnswer = await callTool({
      request,
      accessToken: readOnly.accessToken,
      name: "list_labels",
      args: { query: { name: blockedName } },
    });

    expect(after.result?.["returnedCount"]).toBe(0);
  });
});
