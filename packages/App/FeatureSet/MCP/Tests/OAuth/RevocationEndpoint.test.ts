/**
 * Token revocation over HTTP (POST /mcp/oauth/revoke, RFC 7009).
 *
 * Revoking either token ends the whole authorization, and the answer is 200
 * whether or not the token meant anything - so most of these tests look past
 * the response to what is, and is not, still there afterwards.
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

// The tools themselves are not under test; nothing here may reach the API.
jest.mock("../../Services/OneUptimeApiService");
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
  ConnectedClient,
  HttpResult,
  RegisteredTestClient,
  TestMember,
  TestProject,
} from "./Helpers/OAuthTestHarness";
import { StoreCall } from "./Helpers/InMemoryOAuthStore";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";

const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/client.json";

describe("POST /mcp/oauth/revoke", () => {
  let harness: OAuthTestHarness;
  let member: TestMember;
  let project: TestProject;
  let connected: ConnectedClient;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    harness.reset();
    jest.clearAllMocks();
    ({ member, project } = harness.addMemberWithProject());
    connected = await harness.connect({
      member,
      project,
      clientName: "Claude Code",
    });
  });

  function revoke(
    token: string,
    extra: Record<string, string> = {},
  ): Promise<HttpResult> {
    return harness.revoke({
      client_id: connected.clientId,
      token,
      ...extra,
    });
  }

  async function isAccessTokenLive(accessToken: string): Promise<boolean> {
    const response: HttpResult = await harness.callTool(
      "list_incidents",
      {},
      OAuthTestHarness.bearer(accessToken),
    );

    if (response.status === 401) {
      return false;
    }

    expect(response.status).toBe(200);

    return true;
  }

  function expectDisconnected(): void {
    expect(harness.store.count("grant")).toBe(0);
    expect(harness.store.count("token")).toBe(0);
  }

  function expectStillConnected(): void {
    expect(harness.store.count("grant")).toBe(1);
    expect(harness.store.requireRow("grant", connected.grantId)).toBeDefined();
  }

  describe("revoking a token the client holds", () => {
    it.each([
      ["the refresh token", "refreshToken"],
      ["the access token", "accessToken"],
    ])(
      "given %s, ends the whole authorization: the grant and every token under it",
      async (_label: string, which: string) => {
        const token: string =
          which === "refreshToken"
            ? connected.refreshToken
            : connected.accessToken;

        const response: HttpResult = await revoke(token);

        expect(response.status).toBe(200);
        expect(response.json).toEqual({});

        expectDisconnected();

        // Neither half of the pair works any more.
        expect(await isAccessTokenLive(connected.accessToken)).toBe(false);

        const refresh: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(refresh.status).toBe(400);
        expect(refresh.json.error).toBe("invalid_grant");
      },
    );

    it("takes tokens issued by later refreshes with it", async () => {
      const rotated: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      await revoke(rotated.json.refresh_token);

      expectDisconnected();
      expect(await isAccessTokenLive(connected.accessToken)).toBe(false);
      expect(await isAccessTokenLive(rotated.json.access_token)).toBe(false);
    });

    it("works with a refresh token that was already rotated out: the client is still saying it is done", async () => {
      await harness.refresh(connected.clientId, connected.refreshToken);

      expect((await revoke(connected.refreshToken)).status).toBe(200);
      expectDisconnected();
    });

    it("works with an access token that has expired", async () => {
      harness.store.expire(
        "token",
        String(
          harness.store.requireTokenBySecret(connected.accessToken)["_id"],
        ),
        60,
      );

      expect((await revoke(connected.accessToken)).status).toBe(200);
      expectDisconnected();
    });

    it("does not need the hint, and is not misled by a wrong one", async () => {
      expect(
        (
          await revoke(connected.refreshToken, {
            token_type_hint: "access_token",
          })
        ).status,
      ).toBe(200);
      expectDisconnected();
    });

    it("is answered the same when asked twice", async () => {
      const first: HttpResult = await revoke(connected.refreshToken);
      const second: HttpResult = await revoke(connected.refreshToken);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.json).toEqual({});
    });

    it("leaves the client's other authorizations alone", async () => {
      const otherProject: TestProject = harness.addProject({ name: "Other" });

      harness.addMembership(member, otherProject);

      const second: ConnectedClient = await harness.connect({
        member,
        project: otherProject,
        client: {
          clientId: connected.clientId,
          redirectUri: connected.redirectUri,
        },
      });

      await revoke(connected.refreshToken);

      expect(harness.store.count("grant")).toBe(1);
      expect(await isAccessTokenLive(second.accessToken)).toBe(true);
      expect(await isAccessTokenLive(connected.accessToken)).toBe(false);
    });

    it("records the member, through this client, as who disconnected it", async () => {
      await revoke(connected.refreshToken);

      const deletes: Array<StoreCall> = harness.store.callsTo(
        "grant",
        "deleteOneBy",
      );

      expect(deletes).toHaveLength(1);

      const props: DatabaseCommonInteractionProps = deletes[0]!.input[
        "props"
      ] as DatabaseCommonInteractionProps;

      expect(props.isRoot).toBe(true);
      expect(props.userId?.toString()).toBe(member.id.toString());
      expect(props.userType).toBe(UserType.User);
      expect(props.tenantId?.toString()).toBe(project.id.toString());
      expect(props.mcpOAuthGrantId?.toString()).toBe(connected.grantId);
      expect(props.mcpClientName).toBe("Claude Code");

      // And it deleted exactly the grant the token belongs to.
      expect(
        String((deletes[0]!.input["query"] as Record<string, unknown>)["_id"]),
      ).toBe(connected.grantId);
    });
  });

  describe("a token that means nothing here", () => {
    it.each([
      [
        "a refresh token nobody issued",
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      ],
      [
        "an access token nobody issued",
        McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
      ],
      [
        "an authorization code",
        McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
      ],
      ["garbage", "not-a-token"],
      ["an API key", "3b241101-e2bb-4255-8caf-4136c566a962"],
    ])(
      "is answered 200 and changes nothing when it is %s",
      async (_label: string, token: string) => {
        const response: HttpResult = await revoke(token);

        expect(response.status).toBe(200);
        expect(response.json).toEqual({});

        expectStillConnected();
        expect(await isAccessTokenLive(connected.accessToken)).toBe(true);
        expect(harness.store.callsTo("grant", "deleteOneBy")).toHaveLength(0);
      },
    );

    it("is answered 200 and changes nothing when it belongs to another client", async () => {
      const other: RegisteredTestClient = await harness.register();

      for (const token of [connected.refreshToken, connected.accessToken]) {
        const response: HttpResult = await harness.revoke({
          client_id: other.clientId,
          token,
        });

        expect(response.status).toBe(200);
        expect(response.json).toEqual({});
      }

      expectStillConnected();
      expect(await isAccessTokenLive(connected.accessToken)).toBe(true);
    });

    it("cannot be used to find out whether a token is real: both answers are identical", async () => {
      const real: HttpResult = await harness.revoke({
        client_id: (await harness.register()).clientId,
        token: connected.refreshToken,
      });
      const fake: HttpResult = await revoke(
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      );

      expect(real.status).toBe(fake.status);
      expect(real.text).toBe(fake.text);
    });
  });

  describe("the request itself", () => {
    it("has to carry a token", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: connected.clientId,
      });

      expect(response.status).toBe(400);
      expect(response.json).toEqual({
        error: "invalid_request",
        error_description: "token is required.",
      });
      expectStillConnected();
    });

    it("treats a token sent twice as not sent", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: connected.clientId,
        token: [connected.refreshToken, connected.accessToken],
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
      expectStillConnected();
    });

    it("has to name a client", async () => {
      const response: HttpResult = await harness.revoke({
        token: connected.refreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expectStillConnected();
    });

    it("is refused for a client nobody registered", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: ObjectID.generate().toString(),
        token: connected.refreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expectStillConnected();
    });

    it("is a form, not JSON", async () => {
      const response: HttpResult = await harness.request("/mcp/oauth/revoke", {
        json: { client_id: connected.clientId, token: connected.refreshToken },
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expectStillConnected();
    });

    it("may never be cached, and can be read by a browser-based client", async () => {
      const response: HttpResult = await revoke(connected.refreshToken);

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("answers the preflight a browser sends first", async () => {
      const response: HttpResult = await harness.request("/mcp/oauth/revoke", {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("is only a POST", async () => {
      const response: HttpResult = await harness.request("/mcp/oauth/revoke");

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
    });

    it("answers too_many_requests past six hundred calls in a window, and revokes nothing", async () => {
      harness.prefillRateLimit("revoke", 600);

      const response: HttpResult = await revoke(connected.refreshToken);

      expect(response.status).toBe(429);
      expect(response.json.error).toBe("too_many_requests");
      expect(
        Number(response.headers.get("retry-after")),
      ).toBeGreaterThanOrEqual(1);
      expectStillConnected();
    });

    it("carries on when Redis is down: a client must always be able to sign out", async () => {
      harness.setRedisAvailable(false);

      expect((await revoke(connected.refreshToken)).status).toBe(200);
      expectDisconnected();
    });

    it("is the app's ordinary 404 when OAuth is switched off", async () => {
      harness.setOAuthEnabled(false);

      const response: HttpResult = await revoke(connected.refreshToken);

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
      expectStillConnected();
    });

    it("answers server_error when the grant cannot be deleted, and says nothing about why", async () => {
      harness.store.intercept("grant", "deleteOneBy", (): void => {
        throw new Error("deadlock detected");
      });

      const response: HttpResult = await revoke(connected.refreshToken);

      expect(response.status).toBe(500);
      expect(response.json.error).toBe("server_error");
      expect(response.text).not.toContain("deadlock");
    });
  });

  describe("a client that has a secret", () => {
    let confidential: RegisteredTestClient;
    let tokens: HttpResult;

    beforeEach(async () => {
      confidential = await harness.register({
        token_endpoint_auth_method: "client_secret_post",
      });

      const issued: {
        clientId: string;
        redirectUri: string;
        code: string;
        codeVerifier: string;
      } = await harness.approveForCode({
        member,
        project,
        client: confidential,
      });

      tokens = await harness.token({
        grant_type: "authorization_code",
        client_id: issued.clientId,
        client_secret: confidential.clientSecret!,
        code: issued.code,
        code_verifier: issued.codeVerifier,
      });

      expect(tokens.status).toBe(200);
    });

    it("cannot revoke without it: anyone can name a client id", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: confidential.clientId,
        token: tokens.json.refresh_token,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expect(await isAccessTokenLive(tokens.json.access_token)).toBe(true);
    });

    it("cannot revoke with the wrong one", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: confidential.clientId,
        client_secret: McpOAuthSecret.mintClientSecret(),
        token: tokens.json.refresh_token,
      });

      expect(response.status).toBe(401);
      expect(await isAccessTokenLive(tokens.json.access_token)).toBe(true);
    });

    it("revokes with its secret in the body", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: confidential.clientId,
        client_secret: confidential.clientSecret!,
        token: tokens.json.refresh_token,
      });

      expect(response.status).toBe(200);
      expect(await isAccessTokenLive(tokens.json.access_token)).toBe(false);
    });

    it("revokes with HTTP Basic", async () => {
      const response: HttpResult = await harness.revoke(
        { token: tokens.json.access_token },
        {
          Authorization: `Basic ${Buffer.from(
            `${confidential.clientId}:${confidential.clientSecret}`,
          ).toString("base64")}`,
        },
      );

      expect(response.status).toBe(200);
      expect(await isAccessTokenLive(tokens.json.access_token)).toBe(false);
    });

    it("authenticates before it looks at the token: a bad client learns nothing about a missing one", async () => {
      const response: HttpResult = await harness.revoke({
        client_id: confidential.clientId,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
    });
  });

  describe("a metadata document client", () => {
    it("revokes its own authorization the same way", async () => {
      const documentClient: { clientId: string; redirectUri: string } =
        harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });

      const documentConnection: ConnectedClient = await harness.connect({
        member,
        project,
        client: documentClient,
      });

      const response: HttpResult = await harness.revoke({
        client_id: DOCUMENT_CLIENT_ID,
        token: documentConnection.refreshToken,
      });

      expect(response.status).toBe(200);
      expect(await isAccessTokenLive(documentConnection.accessToken)).toBe(
        false,
      );

      // The registered client's connection is a different grant.
      expect(await isAccessTokenLive(connected.accessToken)).toBe(true);
    });
  });
});
