/**
 * The token endpoint over HTTP (POST /mcp/oauth/token): a code exchanged for
 * tokens, and a refresh token exchanged for the next pair.
 *
 * Nearly everything here is about "single use" being true, and about what a
 * failed exchange is allowed to leave behind. Each test drives the real
 * endpoint and then looks at the rows: which were written, which were spent,
 * which are gone.
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
import {
  StoreOperation,
  StoreRow,
  StoreTable,
} from "./Helpers/InMemoryOAuthStore";
import McpOAuthError, { McpOAuthErrorCode } from "../../OAuth/McpOAuthError";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import logger from "Common/Server/Utils/Logger";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;
const THIRTY_DAYS_IN_MS: number = 30 * 24 * 60 * 60 * 1000;

const INVALID_CODE: string =
  "The authorization code is invalid, expired or has already been used.";
const INVALID_REFRESH_TOKEN: string =
  "The refresh token is invalid, expired or has been revoked.";

const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/client.json";
const BASIC_CHALLENGE: string = 'Basic realm="OneUptime MCP", charset="UTF-8"';

function basic(clientId: string, clientSecret: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString("base64")}`,
  };
}

describe("POST /mcp/oauth/token", () => {
  let harness: OAuthTestHarness;
  let member: TestMember;
  let project: TestProject;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(() => {
    harness.reset();
    jest.clearAllMocks();
    ({ member, project } = harness.addMemberWithProject());
  });

  async function issueCode(
    options: {
      access?: "read" | "write" | undefined;
      scope?: string | undefined;
      client?: { clientId: string; redirectUri: string } | undefined;
      member?: TestMember | undefined;
      project?: TestProject | undefined;
    } = {},
  ): Promise<IssuedCode> {
    return await harness.approveForCode({
      member: options.member || member,
      project: options.project || project,
      access: options.access,
      scope: options.scope,
      client: options.client,
    });
  }

  // The exchange a well-behaved client makes; `overrides` bends one thing.
  function exchange(
    issued: IssuedCode,
    overrides: Record<string, string | undefined> = {},
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    const form: Record<string, string> = {};

    const values: Record<string, string | undefined> = {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: issued.codeVerifier,
      redirect_uri: issued.redirectUri,
      ...overrides,
    };

    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) {
        form[name] = value;
      }
    }

    return harness.token(form, headers);
  }

  function connect(
    options: {
      access?: "read" | "write" | undefined;
      scope?: string | undefined;
      client?: { clientId: string; redirectUri: string } | undefined;
      member?: TestMember | undefined;
      project?: TestProject | undefined;
    } = {},
  ): Promise<ConnectedClient> {
    return harness.connect({
      member: options.member || member,
      project: options.project || project,
      access: options.access,
      scope: options.scope,
      client: options.client,
    });
  }

  // Whether the MCP endpoint still accepts an access token.
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

  function expectInvalidGrant(response: HttpResult, description: string): void {
    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: "invalid_grant",
      error_description: description,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }

  function expectNoTokensIssued(): void {
    expect(
      harness.store.rows("token").filter((row: StoreRow): boolean => {
        return row["tokenType"] !== McpOAuthTokenType.AuthorizationCode;
      }),
    ).toEqual([]);
  }

  describe("exchanging an authorization code", () => {
    it("answers with a bearer access token, a refresh token, how long the first lasts and what was granted", async () => {
      const issued: IssuedCode = await issueCode();

      const response: HttpResult = await exchange(issued);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(Object.keys(response.json).sort()).toEqual([
        "access_token",
        "expires_in",
        "refresh_token",
        "scope",
        "token_type",
      ]);
      expect(response.json.token_type).toBe("Bearer");
      expect(response.json.expires_in).toBe(3600);
      expect(response.json.scope).toBe("mcp:read mcp:write");
      expect(
        McpOAuthSecret.isValidShape(
          response.json.access_token,
          McpOAuthTokenType.AccessToken,
        ),
      ).toBe(true);
      expect(
        McpOAuthSecret.isValidShape(
          response.json.refresh_token,
          McpOAuthTokenType.RefreshToken,
        ),
      ).toBe(true);
    });

    it("may never be cached, and can be read by a browser-based client", async () => {
      const response: HttpResult = await exchange(await issueCode());

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("states the scope the member GRANTED, which can be less than the client asked for", async () => {
      const response: HttpResult = await exchange(
        await issueCode({ scope: "mcp:read mcp:write", access: "read" }),
      );

      expect(response.status).toBe(200);
      expect(response.json.scope).toBe("mcp:read");
    });

    it("activates the grant and makes it last as long as the refresh token it just issued", async () => {
      const issued: IssuedCode = await issueCode();

      expect(harness.store.onlyGrant()["activatedAt"]).toBeUndefined();

      const before: number = Date.now();
      const response: HttpResult = await exchange(issued);
      const grant: StoreRow = harness.store.onlyGrant();

      expect(grant["activatedAt"]).toBeInstanceOf(Date);
      expect((grant["activatedAt"] as Date).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );

      const refreshRow: StoreRow = harness.store.requireTokenBySecret(
        response.json.refresh_token,
      );

      expect((grant["expiresAt"] as Date).getTime()).toBe(
        (refreshRow["expiresAt"] as Date).getTime(),
      );

      const lastsForMs: number =
        (grant["expiresAt"] as Date).getTime() - before;

      expect(lastsForMs).toBeGreaterThan(THIRTY_DAYS_IN_MS - 5000);
      expect(lastsForMs).toBeLessThanOrEqual(THIRTY_DAYS_IN_MS + 5000);
    });

    it("stores the tokens as digests, an hour and thirty days out, and marks the code spent", async () => {
      const issued: IssuedCode = await issueCode();
      const before: number = Date.now();
      const response: HttpResult = await exchange(issued);

      const grantId: string = String(harness.store.onlyGrant()["_id"]);
      const codeRow: StoreRow = harness.store.requireTokenBySecret(issued.code);
      const accessRow: StoreRow = harness.store.requireTokenBySecret(
        response.json.access_token,
      );
      const refreshRow: StoreRow = harness.store.requireTokenBySecret(
        response.json.refresh_token,
      );

      expect(harness.store.tokensOfGrant(grantId)).toHaveLength(3);

      expect(codeRow["consumedAt"]).toBeInstanceOf(Date);

      expect(accessRow["tokenType"]).toBe(McpOAuthTokenType.AccessToken);
      expect(accessRow["consumedAt"]).toBeUndefined();
      expect(
        (accessRow["expiresAt"] as Date).getTime() - before,
      ).toBeGreaterThan(ONE_HOUR_IN_MS - 5000);
      expect(
        (accessRow["expiresAt"] as Date).getTime() - before,
      ).toBeLessThanOrEqual(ONE_HOUR_IN_MS + 5000);

      expect(refreshRow["tokenType"]).toBe(McpOAuthTokenType.RefreshToken);
      expect(refreshRow["consumedAt"]).toBeUndefined();

      const stored: string = JSON.stringify(harness.store.rows("token"));

      expect(stored).not.toContain(response.json.access_token);
      expect(stored).not.toContain(response.json.refresh_token);
    });

    it("issues an access token the MCP endpoint accepts", async () => {
      const response: HttpResult = await exchange(await issueCode());

      expect(await isAccessTokenLive(response.json.access_token)).toBe(true);
    });

    it("does not need the redirect URI repeated (OAuth 2.1): PKCE does that job", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        redirect_uri: undefined,
      });

      expect(response.status).toBe(200);
    });

    it("accepts a resource that names this MCP server", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        resource: harness.resource,
      });

      expect(response.status).toBe(200);
    });

    it("refuses a resource that names another server, without spending the code", async () => {
      const issued: IssuedCode = await issueCode();

      const refused: HttpResult = await exchange(issued, {
        resource: "https://other.example/mcp",
      });

      expect(refused.status).toBe(400);
      expect(refused.json.error).toBe("invalid_target");
      expect(refused.json.error_description).toBe(
        `The resource must be ${harness.resource}.`,
      );

      expect((await exchange(issued)).status).toBe(200);
    });
  });

  describe("a code that is no good", () => {
    it("is refused for the wrong verifier - and that was its one attempt", async () => {
      const issued: IssuedCode = await issueCode();

      expectInvalidGrant(
        await exchange(issued, {
          code_verifier: OAuthTestHarness.pkce().codeVerifier,
        }),
        INVALID_CODE,
      );

      // The grant that would have been activated is gone, and its code with it.
      expect(harness.store.count("grant")).toBe(0);
      expect(harness.store.count("token")).toBe(0);

      // Even the right verifier is too late now.
      expectInvalidGrant(await exchange(issued), INVALID_CODE);
    });

    it("is refused for a verifier that is not a verifier at all", async () => {
      const issued: IssuedCode = await issueCode();

      expectInvalidGrant(
        await exchange(issued, { code_verifier: "short" }),
        INVALID_CODE,
      );
      expect(harness.store.count("grant")).toBe(0);
    });

    it("is not looked at when the verifier is missing: that is a malformed request, and the code survives it", async () => {
      const issued: IssuedCode = await issueCode();

      const response: HttpResult = await exchange(issued, {
        code_verifier: undefined,
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
      expect(response.json.error_description).toContain("code_verifier");

      expect((await exchange(issued)).status).toBe(200);
    });

    it("is a malformed request when the code itself is missing", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        code: undefined,
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
      expect(response.json.error_description).toContain("code");
    });

    it("is refused for a redirect URI other than the one it was delivered to, and is spent", async () => {
      const issued: IssuedCode = await issueCode();

      expectInvalidGrant(
        await exchange(issued, {
          redirect_uri: "https://client.example/other",
        }),
        INVALID_CODE,
      );
      expect(harness.store.count("grant")).toBe(0);

      expectInvalidGrant(await exchange(issued), INVALID_CODE);
    });

    it("is refused for another client - which must NOT be able to burn it", async () => {
      const issued: IssuedCode = await issueCode();
      const other: RegisteredTestClient = await harness.register();

      expectInvalidGrant(
        await exchange(issued, { client_id: other.clientId }),
        INVALID_CODE,
      );

      // Still pending, still unspent.
      expect(harness.store.count("grant")).toBe(1);
      expect(
        harness.store.requireTokenBySecret(issued.code)["consumedAt"],
      ).toBeUndefined();

      // The client it was issued to is unaffected.
      expect((await exchange(issued)).status).toBe(200);
    });

    it("is refused for a client nobody registered, as invalid_client, and is not burned", async () => {
      const issued: IssuedCode = await issueCode();

      const response: HttpResult = await exchange(issued, {
        client_id: ObjectID.generate().toString(),
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");

      expect((await exchange(issued)).status).toBe(200);
    });

    it("is refused when no client is named at all", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        client_id: undefined,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
    });

    it("is refused once it has expired", async () => {
      const issued: IssuedCode = await issueCode();

      harness.store.expire(
        "token",
        String(harness.store.requireTokenBySecret(issued.code)["_id"]),
        1,
      );

      expectInvalidGrant(await exchange(issued), INVALID_CODE);
      expectNoTokensIssued();
      expect(harness.store.onlyGrant()["activatedAt"]).toBeUndefined();
    });

    it("is refused when it was never issued", async () => {
      const issued: IssuedCode = await issueCode();

      expectInvalidGrant(
        await exchange(issued, {
          code: McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
        }),
        INVALID_CODE,
      );

      // Somebody else's guess does nothing to the real one.
      expect((await exchange(issued)).status).toBe(200);
    });

    it.each([
      ["garbage", "not-a-code"],
      ["a code with the body cut short", "oumcp_ac_tooshort"],
      [
        "an access token presented as a code",
        McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
      ],
      [
        "a refresh token presented as a code",
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      ],
      ["a SQL-looking string", "' OR 1=1 --"],
    ])(
      "is refused without a database lookup when it is %s",
      async (_label: string, code: string) => {
        const issued: IssuedCode = await issueCode();

        harness.store.calls = [];

        expectInvalidGrant(await exchange(issued, { code }), INVALID_CODE);
        expect(harness.store.callsTo("token", "findOneBy")).toHaveLength(0);
      },
    );

    it("presented a second time takes everything the first exchange issued with it", async () => {
      const issued: IssuedCode = await issueCode();
      const first: HttpResult = await exchange(issued);

      expect(first.status).toBe(200);
      expect(await isAccessTokenLive(first.json.access_token)).toBe(true);

      // The replay: either the client repeating itself, or a second holder.
      expectInvalidGrant(await exchange(issued), INVALID_CODE);

      expect(harness.store.count("grant")).toBe(0);
      expect(harness.store.count("token")).toBe(0);
      expect(await isAccessTokenLive(first.json.access_token)).toBe(false);

      expectInvalidGrant(
        await harness.refresh(issued.clientId, first.json.refresh_token),
        INVALID_REFRESH_TOKEN,
      );

      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("a spent authorization code was presented"),
      );
    });

    it("presented a second time WITHOUT the verifier still takes the grant: the replay is the signal", async () => {
      const issued: IssuedCode = await issueCode();
      const first: HttpResult = await exchange(issued);

      expectInvalidGrant(
        await exchange(issued, {
          code_verifier: OAuthTestHarness.pkce().codeVerifier,
        }),
        INVALID_CODE,
      );

      expect(harness.store.count("grant")).toBe(0);
      expect(await isAccessTokenLive(first.json.access_token)).toBe(false);
    });

    it("presented a second time by ANOTHER client takes nothing: only its own client can trip the alarm", async () => {
      const issued: IssuedCode = await issueCode();
      const first: HttpResult = await exchange(issued);
      const other: RegisteredTestClient = await harness.register();

      expectInvalidGrant(
        await exchange(issued, { client_id: other.clientId }),
        INVALID_CODE,
      );

      expect(harness.store.count("grant")).toBe(1);
      expect(await isAccessTokenLive(first.json.access_token)).toBe(true);
    });
  });

  describe("two exchanges of one code at the same moment", () => {
    it("never yields two sets of tokens, and never leaves a usable set behind a refused one", async () => {
      const issued: IssuedCode = await issueCode();

      const responses: Array<HttpResult> = await Promise.all([
        exchange(issued),
        exchange(issued),
      ]);

      const succeeded: Array<HttpResult> = responses.filter(
        (response: HttpResult): boolean => {
          return response.status === 200;
        },
      );
      const refused: Array<HttpResult> = responses.filter(
        (response: HttpResult): boolean => {
          return response.json?.error === "invalid_grant";
        },
      );

      expect(succeeded.length).toBeLessThanOrEqual(1);
      expect(refused.length).toBeGreaterThanOrEqual(1);

      /*
       * The code was presented twice, so whatever it issued is revoked: no
       * access token from this code may still open the MCP endpoint.
       */
      for (const response of succeeded) {
        expect(await isAccessTokenLive(response.json.access_token)).toBe(false);
      }

      expect(harness.store.count("grant")).toBe(0);
      expect(harness.store.count("token")).toBe(0);
    });

    /*
     * The request that loses the race for the code revokes the grant, and can
     * do so while the winner is still issuing its tokens: the winner's insert
     * then meets a grant that is gone. That used to surface as a 500. It is
     * the replay answer instead - the code was presented twice, so nothing
     * issued from it survives - and neither request is told the server broke.
     */
    it("never answers a doubly presented code with a server error", async () => {
      const issued: IssuedCode = await issueCode();

      const responses: Array<HttpResult> = await Promise.all([
        exchange(issued),
        exchange(issued),
      ]);

      for (const response of responses) {
        expect(response.status).toBeLessThan(500);

        if (response.status !== 200) {
          expect(response.status).toBe(400);
          expect(response.json.error).toBe("invalid_grant");
        }
      }

      // At most one was handed tokens, and those tokens open nothing.
      const succeeded: Array<HttpResult> = responses.filter(
        (response: HttpResult): boolean => {
          return response.status === 200;
        },
      );

      expect(succeeded.length).toBeLessThanOrEqual(1);

      for (const response of succeeded) {
        expect(await isAccessTokenLive(response.json.access_token)).toBe(false);
      }
    });

    it.each([[3], [8]])(
      "never answers %i simultaneous exchanges of one code with a server error",
      async (count: number) => {
        const issued: IssuedCode = await issueCode();

        const responses: Array<HttpResult> = await Promise.all(
          Array.from({ length: count }, (): Promise<HttpResult> => {
            return exchange(issued);
          }),
        );

        expect(
          responses.filter((response: HttpResult): boolean => {
            return response.status >= 500;
          }),
        ).toEqual([]);

        expect(
          responses.filter((response: HttpResult): boolean => {
            return response.status === 200;
          }).length,
        ).toBeLessThanOrEqual(1);

        expect(harness.store.count("grant")).toBe(0);
        expect(harness.store.count("token")).toBe(0);
      },
    );
  });

  describe("a grant taken away while its tokens are being issued", () => {
    /*
     * A member pressing Disconnect, or a second presentation of the same
     * credential, can remove the grant between a request's checks and its
     * writes. The pair being issued then has nothing to belong to. That is
     * not this server breaking: it is answered the way any other unusable
     * credential is, and nothing issued for it works afterwards.
     */

    interface Removal {
      wasRemoved: () => boolean;
    }

    // Removes the only grant the first time the store is about to do this.
    function removeGrantBefore(
      table: StoreTable,
      operation: StoreOperation,
    ): Removal {
      const grantId: string = String(harness.store.onlyGrant()["_id"]);
      let removed: boolean = false;

      harness.store.intercept(table, operation, (): void => {
        if (!removed) {
          removed = true;
          harness.store.deleteGrant(grantId);
        }
      });

      return {
        wasRemoved: (): boolean => {
          return removed;
        },
      };
    }

    function expectServerError(response: HttpResult): void {
      expect(response.status).toBe(500);
      expect(response.json).toEqual({
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected error.",
      });
    }

    describe("during a code exchange", () => {
      it("answers invalid_grant when the grant goes before the tokens are written", async () => {
        const issued: IssuedCode = await issueCode();
        const removal: Removal = removeGrantBefore("token", "create");

        const response: HttpResult = await exchange(issued);

        expect(removal.wasRemoved()).toBe(true);
        expectInvalidGrant(response, INVALID_CODE);
        expect(harness.store.count("token")).toBe(0);
        // Nothing went wrong on this side, so nothing is logged as if it had.
        expect(logger.error as jest.Mock).not.toHaveBeenCalled();
      });

      it("answers invalid_grant, and hands over nothing, when the grant goes after the tokens are written", async () => {
        const issued: IssuedCode = await issueCode();

        // Activating the grant is its first write once the tokens are in.
        const removal: Removal = removeGrantBefore(
          "grant",
          "updateColumnsByIdWithoutHooks",
        );

        const response: HttpResult = await exchange(issued);

        expect(removal.wasRemoved()).toBe(true);
        expectInvalidGrant(response, INVALID_CODE);
        expect("access_token" in response.json).toBe(false);
        expect("refresh_token" in response.json).toBe(false);
        expect(harness.store.count("token")).toBe(0);
      });

      it("is still a server error when the tokens cannot be written and the grant is there", async () => {
        const issued: IssuedCode = await issueCode();

        harness.store.intercept("token", "create", (): void => {
          throw new Error("canceling statement due to statement timeout");
        });

        const response: HttpResult = await exchange(issued);

        expectServerError(response);
        expect(response.text).not.toContain("statement timeout");
        expect(harness.store.count("grant")).toBe(1);
        expectNoTokensIssued();
        expect(logger.error as jest.Mock).toHaveBeenCalled();
      });

      it("is still a server error when the grant cannot be activated and is there", async () => {
        const issued: IssuedCode = await issueCode();

        harness.store.intercept(
          "grant",
          "updateColumnsByIdWithoutHooks",
          (): void => {
            throw new Error("canceling statement due to statement timeout");
          },
        );

        const response: HttpResult = await exchange(issued);

        expectServerError(response);
        expect("access_token" in response.json).toBe(false);

        /*
         * The pair was written, but the grant it belongs to never went live:
         * it opens nothing, and lapses with the code it came from.
         */
        expect(harness.store.onlyGrant()["activatedAt"]).toBeUndefined();

        const written: StoreRow | undefined = harness.store
          .rows("token")
          .find((row: StoreRow): boolean => {
            return row["tokenType"] === McpOAuthTokenType.AccessToken;
          });

        expect(written).toBeDefined();
      });
    });

    describe("during a refresh", () => {
      let connected: ConnectedClient;

      beforeEach(async () => {
        connected = await connect();
      });

      it("answers invalid_grant when the grant goes before the new pair is written", async () => {
        const removal: Removal = removeGrantBefore("token", "create");

        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(removal.wasRemoved()).toBe(true);
        expectInvalidGrant(response, INVALID_REFRESH_TOKEN);
        expect(harness.store.count("token")).toBe(0);
        expect(logger.error as jest.Mock).not.toHaveBeenCalled();
      });

      it("answers invalid_grant, and hands over nothing, when the grant goes after the new pair is written", async () => {
        // Sliding the grant's expiry is its only write during a refresh.
        const removal: Removal = removeGrantBefore(
          "grant",
          "updateColumnsByIdWithoutHooks",
        );

        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(removal.wasRemoved()).toBe(true);
        expectInvalidGrant(response, INVALID_REFRESH_TOKEN);
        expect("access_token" in response.json).toBe(false);
        expect(harness.store.count("token")).toBe(0);

        harness.store.clearInterceptors();

        expect(await isAccessTokenLive(connected.accessToken)).toBe(false);
      });

      it("is still a server error when the new pair cannot be written and the grant is there - and the same refresh token works on the retry", async () => {
        harness.store.intercept("token", "create", (): void => {
          throw new Error("canceling statement due to statement timeout");
        });

        const failed: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expectServerError(failed);
        expect(harness.store.count("grant")).toBe(1);

        // The database is back. A server fault cost the client nothing.
        harness.store.clearInterceptors();

        const retried: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(retried.status).toBe(200);
        expect(await isAccessTokenLive(retried.json.access_token)).toBe(true);
        expect(harness.store.count("grant")).toBe(1);
      });
    });
  });

  describe("the request itself", () => {
    it("has to name a grant type", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        grant_type: undefined,
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
    });

    it.each([
      ["client_credentials"],
      ["password"],
      ["implicit"],
      ["AUTHORIZATION_CODE"],
    ])("does not offer the %s grant", async (grantType: string) => {
      const response: HttpResult = await exchange(await issueCode(), {
        grant_type: grantType,
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("unsupported_grant_type");
    });

    it("is a form, not JSON: a JSON body is read as no parameters at all", async () => {
      const issued: IssuedCode = await issueCode();

      const response: HttpResult = await harness.request("/mcp/oauth/token", {
        json: {
          grant_type: "authorization_code",
          client_id: issued.clientId,
          code: issued.code,
          code_verifier: issued.codeVerifier,
        },
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");

      // And the code was not touched.
      expect((await exchange(issued)).status).toBe(200);
    });

    it("treats a parameter sent twice as not sent", async () => {
      const issued: IssuedCode = await issueCode();

      const response: HttpResult = await harness.token({
        grant_type: "authorization_code",
        client_id: issued.clientId,
        code: [issued.code, issued.code],
        code_verifier: issued.codeVerifier,
      });

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
    });

    it("is only a POST", async () => {
      const response: HttpResult = await harness.request("/mcp/oauth/token");

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);
    });

    it("answers the preflight a browser sends first", async () => {
      const response: HttpResult = await harness.request("/mcp/oauth/token", {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("is the app's ordinary 404 when OAuth is switched off, and spends nothing", async () => {
      const issued: IssuedCode = await issueCode();

      harness.setOAuthEnabled(false);

      const response: HttpResult = await exchange(issued);

      expect(response.status).toBe(404);
      expect(response.json.marker).toBe(APP_404_MARKER);

      harness.setOAuthEnabled(true);

      expect((await exchange(issued)).status).toBe(200);
    });

    it("answers too_many_requests past twelve hundred exchanges in a window, and spends nothing", async () => {
      const issued: IssuedCode = await issueCode();

      harness.prefillRateLimit("token", 1200);

      const response: HttpResult = await exchange(issued);

      expect(response.status).toBe(429);
      expect(response.json).toEqual({
        error: "too_many_requests",
        error_description: "Too many requests. Please try again later.",
      });
      expect(
        Number(response.headers.get("retry-after")),
      ).toBeGreaterThanOrEqual(1);
      expect(
        harness.store.requireTokenBySecret(issued.code)["consumedAt"],
      ).toBeUndefined();
    });

    it("carries on unthrottled when Redis is down: connected clients must keep refreshing", async () => {
      const issued: IssuedCode = await issueCode();

      harness.setRedisAvailable(false);

      expect((await exchange(issued)).status).toBe(200);
    });
  });

  describe("a client that has a secret", () => {
    let confidential: RegisteredTestClient;
    let issued: IssuedCode;

    beforeEach(async () => {
      confidential = await harness.register({
        token_endpoint_auth_method: "client_secret_post",
      });
      issued = await issueCode({ client: confidential });
    });

    it("is refused without it, and the code is not burned", async () => {
      const response: HttpResult = await exchange(issued);

      expect(response.status).toBe(401);
      expect(response.json).toEqual({
        error: "invalid_client",
        error_description: "Client authentication failed.",
      });
      // It did not try HTTP Basic, so it is not told to.
      expect(response.headers.get("www-authenticate")).toBeNull();

      expect(
        (
          await exchange(issued, {
            client_secret: confidential.clientSecret!,
          })
        ).status,
      ).toBe(200);
    });

    it("is refused with the wrong secret", async () => {
      const response: HttpResult = await exchange(issued, {
        client_secret: McpOAuthSecret.mintClientSecret(),
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expectNoTokensIssued();
    });

    it("is refused with another client's secret", async () => {
      const other: RegisteredTestClient = await harness.register({
        token_endpoint_auth_method: "client_secret_post",
      });

      const response: HttpResult = await exchange(issued, {
        client_secret: other.clientSecret!,
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
    });

    it("is accepted with its secret in the form body", async () => {
      expect(
        (
          await exchange(issued, {
            client_secret: confidential.clientSecret!,
          })
        ).status,
      ).toBe(200);
    });

    it("is accepted with HTTP Basic, with or without the client id repeated in the body", async () => {
      const first: HttpResult = await exchange(
        issued,
        {},
        basic(confidential.clientId, confidential.clientSecret!),
      );

      expect(first.status).toBe(200);

      const second: HttpResult = await exchange(
        await issueCode({ client: confidential }),
        { client_id: undefined },
        basic(confidential.clientId, confidential.clientSecret!),
      );

      expect(second.status).toBe(200);
    });

    it("is told to use Basic again when its Basic credentials are wrong (RFC 6749 section 5.2)", async () => {
      const response: HttpResult = await exchange(
        issued,
        {},
        basic(confidential.clientId, McpOAuthSecret.mintClientSecret()),
      );

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("invalid_client");
      expect(response.headers.get("www-authenticate")).toBe(BASIC_CHALLENGE);
    });

    it.each([
      ["not base64", "Basic !!!not-base64!!!"],
      [
        "no colon",
        `Basic ${Buffer.from("just-a-client-id").toString("base64")}`,
      ],
      [
        "an empty client id",
        `Basic ${Buffer.from(":secret").toString("base64")}`,
      ],
      [
        "a broken percent-escape",
        `Basic ${Buffer.from("%E0%A4%A:secret").toString("base64")}`,
      ],
      ["nothing but padding", "Basic =="],
    ])(
      "is told so when its Basic header is %s",
      async (_label: string, authorization: string) => {
        const response: HttpResult = await exchange(
          issued,
          {},
          { Authorization: authorization },
        );

        expect(response.status).toBe(401);
        expect(response.json.error).toBe("invalid_client");
        expect(response.headers.get("www-authenticate")).toBe(BASIC_CHALLENGE);
        expectNoTokensIssued();
      },
    );

    it("may not authenticate two ways at once", async () => {
      const response: HttpResult = await exchange(
        issued,
        { client_secret: confidential.clientSecret! },
        basic(confidential.clientId, confidential.clientSecret!),
      );

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
    });

    it("may not name one client in the header and another in the body", async () => {
      const other: RegisteredTestClient = await harness.register();

      const response: HttpResult = await exchange(
        issued,
        { client_id: other.clientId },
        basic(confidential.clientId, confidential.clientSecret!),
      );

      expect(response.status).toBe(400);
      expect(response.json.error).toBe("invalid_request");
    });

    it("ignores an Authorization header that is not Basic: a bearer token is not client authentication", async () => {
      const response: HttpResult = await exchange(
        issued,
        { client_secret: confidential.clientSecret! },
        { Authorization: "Bearer something" },
      );

      expect(response.status).toBe(200);
    });

    it("has to present it to refresh as well", async () => {
      const tokens: HttpResult = await exchange(issued, {
        client_secret: confidential.clientSecret!,
      });

      const withoutSecret: HttpResult = await harness.refresh(
        confidential.clientId,
        tokens.json.refresh_token,
      );

      expect(withoutSecret.status).toBe(401);
      expect(withoutSecret.json.error).toBe("invalid_client");

      // The failed attempt did not spend the refresh token.
      const withSecret: HttpResult = await harness.refresh(
        confidential.clientId,
        tokens.json.refresh_token,
        { client_secret: confidential.clientSecret! },
      );

      expect(withSecret.status).toBe(200);
    });
  });

  describe("a public client", () => {
    it("needs no secret, and one it sends anyway is not looked at", async () => {
      const response: HttpResult = await exchange(await issueCode(), {
        client_secret: "whatever",
      });

      expect(response.status).toBe(200);
    });

    it("identified by a metadata document exchanges its code the same way", async () => {
      const documentClient: { clientId: string; redirectUri: string } =
        harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });

      const response: HttpResult = await exchange(
        await issueCode({ client: documentClient }),
      );

      expect(response.status).toBe(200);
      expect(harness.store.onlyGrant()["clientId"]).toBe(DOCUMENT_CLIENT_ID);
    });

    it("is told to try again, not to give up its tokens, when its metadata document cannot be read right now", async () => {
      const documentClient: { clientId: string; redirectUri: string } =
        harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });
      const tokens: ConnectedClient = await connect({ client: documentClient });

      // The document host goes away.
      harness.failMetadataDocument(
        DOCUMENT_CLIENT_ID,
        new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The client metadata document could not be retrieved (HTTP 503).",
        ),
      );

      const response: HttpResult = await harness.refresh(
        DOCUMENT_CLIENT_ID,
        tokens.refreshToken,
      );

      expect(response.status).toBe(503);
      expect(response.json.error).toBe("temporarily_unavailable");
    });
  });

  describe("what changed between the member approving and the client collecting", () => {
    async function expectRefusedAndDiscarded(
      issued: IssuedCode,
    ): Promise<void> {
      expectInvalidGrant(await exchange(issued), INVALID_CODE);

      // The half-made grant is removed rather than left to expire.
      expect(harness.store.count("grant")).toBe(0);
      expect(harness.store.count("token")).toBe(0);
    }

    it("the member was blocked", async () => {
      const issued: IssuedCode = await issueCode();

      harness.blockUser(member);

      await expectRefusedAndDiscarded(issued);
    });

    it("the member's account was deleted", async () => {
      const issued: IssuedCode = await issueCode();

      harness.deleteMember(member);

      await expectRefusedAndDiscarded(issued);
    });

    it("the member was removed from the project", async () => {
      const issued: IssuedCode = await issueCode();

      harness.removeMembership(member, project);

      await expectRefusedAndDiscarded(issued);
    });

    it("an administrator blocked the member's team from connecting clients", async () => {
      const issued: IssuedCode = await issueCode();

      harness.blockFromConnectingClients(member, project);

      await expectRefusedAndDiscarded(issued);
    });

    it("the project started requiring SSO, which this approval was not made under", async () => {
      const issued: IssuedCode = await issueCode();

      harness.setProjectSso(project, { required: true });

      await expectRefusedAndDiscarded(issued);
    });

    it("the SSO sign-in the approval was made under has lapsed", async () => {
      harness.setProjectSso(project, { required: true });
      harness.signIn(member, {
        cookies: harness.projectSsoCookie(member, project, {
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
      });

      const issued: IssuedCode = await issueCode();

      harness.store.patch("grant", String(harness.store.onlyGrant()["_id"]), {
        ssoExpiresAt: new Date(Date.now() - 1000),
      });

      await expectRefusedAndDiscarded(issued);
    });

    it("nothing changed, and an SSO-required project's client collects its tokens", async () => {
      harness.setProjectSso(project, { required: true });
      harness.signIn(member, {
        cookies: harness.projectSsoCookie(member, project, {
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
      });

      expect((await exchange(await issueCode())).status).toBe(200);
    });

    it("the plan was downgraded: the plan gates CONNECTING, so a client already approved still collects", async () => {
      const issued: IssuedCode = await issueCode();

      harness.setProjectPlan(project, "none");

      expect((await exchange(issued)).status).toBe(200);
    });
  });

  describe("a registered client that connects again", () => {
    it("replaces the grant it held for the same member and project", async () => {
      const client: RegisteredTestClient = await harness.register();
      const first: ConnectedClient = await connect({ client });
      const second: ConnectedClient = await connect({ client });

      expect(harness.store.count("grant")).toBe(1);
      expect(String(harness.store.onlyGrant()["_id"])).toBe(second.grantId);

      expect(await isAccessTokenLive(first.accessToken)).toBe(false);
      expect(await isAccessTokenLive(second.accessToken)).toBe(true);
    });

    it("keeps the grant it holds for another project", async () => {
      const otherProject: TestProject = harness.addProject({ name: "Other" });

      harness.addMembership(member, otherProject);

      const client: RegisteredTestClient = await harness.register();
      const first: ConnectedClient = await connect({ client });
      const second: ConnectedClient = await connect({
        client,
        project: otherProject,
      });

      expect(harness.store.count("grant")).toBe(2);
      expect(await isAccessTokenLive(first.accessToken)).toBe(true);
      expect(await isAccessTokenLive(second.accessToken)).toBe(true);
    });

    it("keeps the grant another member gave it", async () => {
      const colleague: TestMember = harness.addMember();

      harness.addMembership(colleague, project);

      const client: RegisteredTestClient = await harness.register();
      const first: ConnectedClient = await connect({ client });
      const second: ConnectedClient = await connect({
        client,
        member: colleague,
      });

      expect(harness.store.count("grant")).toBe(2);
      expect(await isAccessTokenLive(first.accessToken)).toBe(true);
      expect(await isAccessTokenLive(second.accessToken)).toBe(true);
    });

    /*
     * Replacing the earlier grant is housekeeping. By the time it runs the
     * code is spent and the new grant is live, so a failure there must not
     * cost the client the tokens it has just been issued - that would leave
     * the member looking at a connection nobody holds the tokens for.
     */
    it("still hands over the new tokens when the earlier grant cannot be removed", async () => {
      const client: RegisteredTestClient = await harness.register();
      const first: ConnectedClient = await connect({ client });

      harness.store.intercept("grant", "deleteBy", (): void => {
        throw new Error("canceling statement due to statement timeout");
      });

      const response: HttpResult = await exchange(await issueCode({ client }));

      expect(response.status).toBe(200);
      expect(await isAccessTokenLive(response.json.access_token)).toBe(true);
      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        "MCP OAuth: could not remove a client's earlier grants.",
      );

      // What could not be removed is still what it was: a grant that works.
      expect(harness.store.count("grant")).toBe(2);
      expect(await isAccessTokenLive(first.accessToken)).toBe(true);
    });

    it("does not replace anything when the new code turns out to be no good", async () => {
      const client: RegisteredTestClient = await harness.register();
      const first: ConnectedClient = await connect({ client });
      const issued: IssuedCode = await issueCode({ client });

      expectInvalidGrant(
        await exchange(issued, {
          code_verifier: OAuthTestHarness.pkce().codeVerifier,
        }),
        INVALID_CODE,
      );

      expect(await isAccessTokenLive(first.accessToken)).toBe(true);
    });

    it("leaves a different client's grant for the same member and project alone", async () => {
      const first: ConnectedClient = await connect();
      const second: ConnectedClient = await connect();

      expect(first.clientId).not.toBe(second.clientId);
      expect(harness.store.count("grant")).toBe(2);
      expect(await isAccessTokenLive(first.accessToken)).toBe(true);
    });
  });

  describe("a metadata document client that connects again", () => {
    it("keeps its earlier grant: one client id is shared by every installation of the client", async () => {
      const documentClient: { clientId: string; redirectUri: string } =
        harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });

      const laptop: ConnectedClient = await connect({ client: documentClient });
      const desktop: ConnectedClient = await connect({
        client: documentClient,
      });

      expect(harness.store.count("grant")).toBe(2);
      expect(await isAccessTokenLive(laptop.accessToken)).toBe(true);
      expect(await isAccessTokenLive(desktop.accessToken)).toBe(true);
    });
  });

  describe("refreshing", () => {
    let connected: ConnectedClient;

    beforeEach(async () => {
      connected = await connect();
    });

    it("answers with a new pair in the same shape, for the same scope", async () => {
      const response: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      expect(response.status).toBe(200);
      expect(Object.keys(response.json).sort()).toEqual([
        "access_token",
        "expires_in",
        "refresh_token",
        "scope",
        "token_type",
      ]);
      expect(response.json.token_type).toBe("Bearer");
      expect(response.json.expires_in).toBe(3600);
      expect(response.json.scope).toBe("mcp:read mcp:write");
      expect(response.json.access_token).not.toBe(connected.accessToken);
      expect(response.json.refresh_token).not.toBe(connected.refreshToken);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("rotates: the refresh token that was used is spent", async () => {
      await harness.refresh(connected.clientId, connected.refreshToken);

      expect(
        harness.store.requireTokenBySecret(connected.refreshToken)[
          "consumedAt"
        ],
      ).toBeInstanceOf(Date);
    });

    it("leaves the previous access token good until its own expiry", async () => {
      const response: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      expect(await isAccessTokenLive(connected.accessToken)).toBe(true);
      expect(await isAccessTokenLive(response.json.access_token)).toBe(true);
    });

    it("keeps the scope a read-only grant was given", async () => {
      const readOnly: ConnectedClient = await connect({ access: "read" });

      const response: HttpResult = await harness.refresh(
        readOnly.clientId,
        readOnly.refreshToken,
      );

      expect(response.json.scope).toBe("mcp:read");
    });

    it("slides the grant's expiry out to the new refresh token's", async () => {
      const tomorrow: Date = new Date(Date.now() + 24 * 60 * 60 * 1000);

      harness.store.patch("grant", connected.grantId, { expiresAt: tomorrow });

      const before: number = Date.now();
      const response: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      const grant: StoreRow = harness.store.requireRow(
        "grant",
        connected.grantId,
      );
      const refreshRow: StoreRow = harness.store.requireTokenBySecret(
        response.json.refresh_token,
      );

      expect((grant["expiresAt"] as Date).getTime()).toBe(
        (refreshRow["expiresAt"] as Date).getTime(),
      );
      expect((grant["expiresAt"] as Date).getTime() - before).toBeGreaterThan(
        THIRTY_DAYS_IN_MS - 5000,
      );
    });

    it("can be done again and again, each time with the newest token", async () => {
      let refreshToken: string = connected.refreshToken;

      for (let round: number = 0; round < 5; round++) {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          refreshToken,
        );

        expect(response.status).toBe(200);

        refreshToken = response.json.refresh_token;
      }

      expect(harness.store.count("grant")).toBe(1);
    });

    describe("a refresh token presented again", () => {
      it("inside the grace period gets a pair of its own: a retry is not a theft", async () => {
        const first: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );
        const retry: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(first.status).toBe(200);
        expect(retry.status).toBe(200);
        expect(retry.json.access_token).not.toBe(first.json.access_token);
        expect(retry.json.refresh_token).not.toBe(first.json.refresh_token);

        expect(harness.store.count("grant")).toBe(1);
        expect(await isAccessTokenLive(first.json.access_token)).toBe(true);
        expect(await isAccessTokenLive(retry.json.access_token)).toBe(true);
      });

      it("fifty-nine seconds later is still inside it", async () => {
        await harness.refresh(connected.clientId, connected.refreshToken);

        harness.store.patch(
          "token",
          String(
            harness.store.requireTokenBySecret(connected.refreshToken)["_id"],
          ),
          { consumedAt: new Date(Date.now() - 59 * 1000) },
        );

        expect(
          (await harness.refresh(connected.clientId, connected.refreshToken))
            .status,
        ).toBe(200);
      });

      it("after the grace period takes the whole grant, the newest tokens included", async () => {
        const rotated: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        harness.store.patch(
          "token",
          String(
            harness.store.requireTokenBySecret(connected.refreshToken)["_id"],
          ),
          { consumedAt: new Date(Date.now() - 61 * 1000) },
        );

        expectInvalidGrant(
          await harness.refresh(connected.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );

        expect(harness.store.count("grant")).toBe(0);
        expect(harness.store.count("token")).toBe(0);

        // Both holders are signed out: the thief's copy and the client's.
        expect(await isAccessTokenLive(rotated.json.access_token)).toBe(false);
        expect(await isAccessTokenLive(connected.accessToken)).toBe(false);
        expectInvalidGrant(
          await harness.refresh(connected.clientId, rotated.json.refresh_token),
          INVALID_REFRESH_TOKEN,
        );

        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          expect.stringContaining("a spent refresh token was presented"),
        );
      });

      it("after the grace period by ANOTHER client takes nothing", async () => {
        const rotated: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );
        const other: RegisteredTestClient = await harness.register();

        harness.store.patch(
          "token",
          String(
            harness.store.requireTokenBySecret(connected.refreshToken)["_id"],
          ),
          { consumedAt: new Date(Date.now() - 61 * 1000) },
        );

        expectInvalidGrant(
          await harness.refresh(other.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );

        expect(harness.store.count("grant")).toBe(1);
        expect(await isAccessTokenLive(rotated.json.access_token)).toBe(true);
      });

      it("twice at the same moment answers both, and the grant survives", async () => {
        const responses: Array<HttpResult> = await Promise.all([
          harness.refresh(connected.clientId, connected.refreshToken),
          harness.refresh(connected.clientId, connected.refreshToken),
        ]);

        expect(
          responses.map((response: HttpResult): number => {
            return response.status;
          }),
        ).toEqual([200, 200]);
        expect(responses[0]!.json.refresh_token).not.toBe(
          responses[1]!.json.refresh_token,
        );
        expect(harness.store.count("grant")).toBe(1);
      });
    });

    describe("a refresh token that is no good", () => {
      it("is refused once it has expired, without revoking anything", async () => {
        harness.store.expire(
          "token",
          String(
            harness.store.requireTokenBySecret(connected.refreshToken)["_id"],
          ),
          1,
        );

        expectInvalidGrant(
          await harness.refresh(connected.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );
        expect(harness.store.count("grant")).toBe(1);
      });

      it("is refused once its grant has expired from disuse", async () => {
        harness.store.expire("grant", connected.grantId, 1);

        expectInvalidGrant(
          await harness.refresh(connected.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );
      });

      it("is refused for another client, which can neither use it nor spend it", async () => {
        const other: RegisteredTestClient = await harness.register();

        expectInvalidGrant(
          await harness.refresh(other.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );

        expect(
          harness.store.requireTokenBySecret(connected.refreshToken)[
            "consumedAt"
          ],
        ).toBeUndefined();

        expect(
          (await harness.refresh(connected.clientId, connected.refreshToken))
            .status,
        ).toBe(200);
      });

      it("is refused when it was never issued", async () => {
        expectInvalidGrant(
          await harness.refresh(
            connected.clientId,
            McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
          ),
          INVALID_REFRESH_TOKEN,
        );
      });

      it.each([
        ["garbage", "not-a-token"],
        ["the access token, presented as a refresh token", "ACCESS"],
        [
          "an authorization code",
          McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
        ],
      ])("is refused when it is %s", async (_label: string, value: string) => {
        expectInvalidGrant(
          await harness.refresh(
            connected.clientId,
            value === "ACCESS" ? connected.accessToken : value,
          ),
          INVALID_REFRESH_TOKEN,
        );

        // The real one still works.
        expect(
          (await harness.refresh(connected.clientId, connected.refreshToken))
            .status,
        ).toBe(200);
      });

      it("is a malformed request when it is missing", async () => {
        const response: HttpResult = await harness.token({
          grant_type: "refresh_token",
          client_id: connected.clientId,
        });

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_request");
      });

      it("is refused after the grant was disconnected", async () => {
        harness.store.deleteGrant(connected.grantId);

        expectInvalidGrant(
          await harness.refresh(connected.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );
      });

      it("is refused for a resource that names another server, and is not spent", async () => {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
          { resource: "https://other.example/mcp" },
        );

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_target");
        expect(
          harness.store.requireTokenBySecret(connected.refreshToken)[
            "consumedAt"
          ],
        ).toBeUndefined();
      });
    });

    describe("asking for a scope", () => {
      it("accepts the scope it already has", async () => {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
          { scope: "mcp:read mcp:write" },
        );

        expect(response.status).toBe(200);
        expect(response.json.scope).toBe("mcp:read mcp:write");
      });

      it("accepts a narrower one", async () => {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
          { scope: "mcp:read" },
        );

        expect(response.status).toBe(200);
      });

      it("accepts scopes this server does not issue, which ask for nothing", async () => {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
          { scope: "openid profile" },
        );

        expect(response.status).toBe(200);
      });

      it("refuses a wider one - stepping up goes through the consent screen - and does not spend the token", async () => {
        const readOnly: ConnectedClient = await connect({ access: "read" });

        const response: HttpResult = await harness.refresh(
          readOnly.clientId,
          readOnly.refreshToken,
          { scope: "mcp:read mcp:write" },
        );

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_scope");
        expect(
          harness.store.requireTokenBySecret(readOnly.refreshToken)[
            "consumedAt"
          ],
        ).toBeUndefined();

        // Asking for what it has still works afterwards.
        const retry: HttpResult = await harness.refresh(
          readOnly.clientId,
          readOnly.refreshToken,
        );

        expect(retry.status).toBe(200);
        expect(retry.json.scope).toBe("mcp:read");
      });

      it("refuses write alone for a read-only grant: write is wider, however it is spelled", async () => {
        const readOnly: ConnectedClient = await connect({ access: "read" });

        const response: HttpResult = await harness.refresh(
          readOnly.clientId,
          readOnly.refreshToken,
          { scope: "mcp:write" },
        );

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_scope");
      });

      it.each([
        ["two spaces in a row", "mcp:read  mcp:write"],
        ["a quote", 'mcp:read "x"'],
        ["a backslash", "mcp:read\\"],
      ])("refuses a scope with %s", async (_label: string, scope: string) => {
        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
          { scope },
        );

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_scope");
      });

      it("refuses a scope sent twice", async () => {
        const response: HttpResult = await harness.token({
          grant_type: "refresh_token",
          client_id: connected.clientId,
          refresh_token: connected.refreshToken,
          scope: ["mcp:read", "mcp:write"],
        });

        expect(response.status).toBe(400);
        expect(response.json.error).toBe("invalid_scope");
      });
    });

    describe("when the grant may no longer be used", () => {
      it("is refused for a blocked member WITHOUT spending the token, so it works again once they are unblocked", async () => {
        harness.blockUser(member);

        expectInvalidGrant(
          await harness.refresh(connected.clientId, connected.refreshToken),
          INVALID_REFRESH_TOKEN,
        );

        expect(
          harness.store.requireTokenBySecret(connected.refreshToken)[
            "consumedAt"
          ],
        ).toBeUndefined();
        expect(harness.store.count("grant")).toBe(1);

        harness.unblockUser(member);

        expect(
          (await harness.refresh(connected.clientId, connected.refreshToken))
            .status,
        ).toBe(200);
      });

      it.each<[string, () => void]>([
        [
          "the member left the project",
          (): void => {
            harness.removeMembership(member, project);
          },
        ],
        [
          "the member's team was blocked from connecting clients",
          (): void => {
            harness.blockFromConnectingClients(member, project);
          },
        ],
        [
          "the member's account was deleted",
          (): void => {
            harness.deleteMember(member);
          },
        ],
        [
          "the project started requiring SSO",
          (): void => {
            harness.setProjectSso(project, { required: true });
          },
        ],
        [
          "the instance started requiring SSO",
          (): void => {
            harness.setGlobalSsoRequired(true);
          },
        ],
      ])(
        "is refused when %s, and no tokens are issued",
        async (_label: string, change: () => void) => {
          const tokensBefore: number = harness.store.count("token");

          change();

          expectInvalidGrant(
            await harness.refresh(connected.clientId, connected.refreshToken),
            INVALID_REFRESH_TOKEN,
          );

          expect(harness.store.count("token")).toBe(tokensBefore);
          expect(
            harness.store.requireTokenBySecret(connected.refreshToken)[
              "consumedAt"
            ],
          ).toBeUndefined();
        },
      );

      it("is answered server_error, with the token unspent, when whether it may be used cannot be found out", async () => {
        (
          jest.spyOn(
            AccessTokenService,
            "getUserTenantAccessPermission",
          ) as unknown as jest.Mock
        ).mockImplementationOnce(async (): Promise<never> => {
          throw new Error("connection terminated unexpectedly");
        });

        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(response.status).toBe(500);
        expect(response.json.error).toBe("server_error");
        expect(response.text).not.toContain("connection terminated");

        // A database blip is not a replay: the same token works on the retry.
        expect(
          harness.store.requireTokenBySecret(connected.refreshToken)[
            "consumedAt"
          ],
        ).toBeUndefined();
        expect(
          (await harness.refresh(connected.clientId, connected.refreshToken))
            .status,
        ).toBe(200);
      });

      it("is refused when OAuth is switched off, as the app's ordinary 404", async () => {
        harness.setOAuthEnabled(false);

        const response: HttpResult = await harness.refresh(
          connected.clientId,
          connected.refreshToken,
        );

        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
      });
    });
  });

  describe("recording that a registered client is still in use", () => {
    it("writes nothing for a client seen within the last day", async () => {
      const connected: ConnectedClient = await connect();

      await harness.refresh(connected.clientId, connected.refreshToken);

      expect(
        harness.store.callsTo("client", "updateColumnsByIdWithoutHooks"),
      ).toHaveLength(0);
    });

    it("writes once for a client last seen more than a day ago", async () => {
      const connected: ConnectedClient = await connect();
      const twoDaysAgo: Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      harness.store.patch("client", connected.clientId, {
        lastUsedAt: twoDaysAgo,
      });

      const before: number = Date.now();
      const first: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      await harness.refresh(connected.clientId, first.json.refresh_token);

      expect(
        harness.store.callsTo("client", "updateColumnsByIdWithoutHooks"),
      ).toHaveLength(1);
      expect(
        (
          harness.store.requireRow("client", connected.clientId)[
            "lastUsedAt"
          ] as Date
        ).getTime(),
      ).toBeGreaterThanOrEqual(before - 1000);
    });

    it("never fails the exchange it rides along with", async () => {
      const connected: ConnectedClient = await connect();

      harness.store.patch("client", connected.clientId, {
        lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      harness.store.intercept(
        "client",
        "updateColumnsByIdWithoutHooks",
        (): void => {
          throw new Error("could not serialize access");
        },
      );

      const response: HttpResult = await harness.refresh(
        connected.clientId,
        connected.refreshToken,
      );

      expect(response.status).toBe(200);
      expect(typeof response.json.access_token).toBe("string");
    });

    it("has nothing to record for a metadata document client, which has no row", async () => {
      const documentClient: { clientId: string; redirectUri: string } =
        harness.addMetadataDocumentClient({ clientId: DOCUMENT_CLIENT_ID });
      const connected: ConnectedClient = await connect({
        client: documentClient,
      });

      await harness.refresh(connected.clientId, connected.refreshToken);

      expect(harness.store.count("client")).toBe(0);
      expect(
        harness.store.callsTo("client", "updateColumnsByIdWithoutHooks"),
      ).toHaveLength(0);
    });
  });

  describe("when the database fails mid-exchange", () => {
    it("answers server_error and gives away nothing about why", async () => {
      const issued: IssuedCode = await issueCode();

      harness.store.intercept("token", "findOneBy", (): void => {
        throw new Error("canceling statement due to statement timeout");
      });

      const response: HttpResult = await exchange(issued);

      expect(response.status).toBe(500);
      expect(response.json).toEqual({
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected error.",
      });
      expect(logger.error as jest.Mock).toHaveBeenCalled();
    });
  });
});
