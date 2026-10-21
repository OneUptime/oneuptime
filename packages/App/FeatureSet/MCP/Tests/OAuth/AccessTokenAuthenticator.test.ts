/**
 * Access token authentication tests.
 *
 * The MCP endpoint as an OAuth resource server: is this bearer value a token
 * this server issued, that has not lapsed, under a grant that may still be
 * used? Every way the answer can be "no" is pinned to the same answer - not
 * authenticated - and to how early it stops, so that a value which cannot be
 * a token costs nothing and a refused one never touches the grant.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

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

import AccessTokenAuthenticator, {
  AccessTokenAuthentication,
} from "../../OAuth/AccessTokenAuthenticator";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import McpOAuthGrantService from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService from "Common/Server/Services/McpOAuthTokenService";
import logger from "Common/Server/Utils/Logger";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthGrantAccess, {
  McpOAuthGrantRefusal,
  McpOAuthPrincipal,
} from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const ONE_HOUR_IN_MS: number = 60 * 60 * 1000;

const ACCESS_TOKEN: string = McpOAuthSecret.mint(McpOAuthTokenType.AccessToken);

const TOKEN_ID: string = "11111111-1111-4111-8111-111111111111";
const GRANT_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";

function tokenRow(overrides?: Partial<McpOAuthToken>): McpOAuthToken {
  const row: McpOAuthToken = new McpOAuthToken();

  row._id = TOKEN_ID;
  row.mcpOAuthGrantId = new ObjectID(GRANT_ID);
  row.tokenType = McpOAuthTokenType.AccessToken;
  row.expiresAt = new Date(NOW.getTime() + ONE_HOUR_IN_MS);

  Object.assign(row, overrides || {});

  return row;
}

function grantRow(): McpOAuthGrant {
  const row: McpOAuthGrant = new McpOAuthGrant();

  row._id = GRANT_ID;
  row.userId = new ObjectID(USER_ID);
  row.projectId = new ObjectID(PROJECT_ID);
  row.clientId = "https://client.example/oauth/metadata.json";
  row.name = "Example Client";
  row.scope = "mcp:read mcp:write";
  row.activatedAt = new Date(NOW.getTime() - ONE_HOUR_IN_MS);
  row.expiresAt = new Date(NOW.getTime() + 24 * ONE_HOUR_IN_MS);

  return row;
}

function principalFor(grant: McpOAuthGrant): McpOAuthPrincipal {
  return {
    grant,
    user: {
      id: new ObjectID(USER_ID),
      email: new Email("member@example.com"),
      name: "A Member",
      isMasterAdmin: false,
    },
    scopes: [McpOAuthScope.Read, McpOAuthScope.Write],
  };
}

describe("AccessTokenAuthenticator", () => {
  let enabledSpy: jest.SpyInstance;
  let findBySecretSpy: jest.SpyInstance;
  let findGrantSpy: jest.SpyInstance;
  let touchSpy: jest.SpyInstance;
  let evaluateSpy: jest.SpyInstance;

  let grant: McpOAuthGrant;
  let principal: McpOAuthPrincipal;

  beforeEach(() => {
    grant = grantRow();
    principal = principalFor(grant);

    (logger.debug as unknown as jest.Mock).mockClear();

    enabledSpy = jest.spyOn(
      McpOAuthConfig,
      "isEnabled",
    ) as unknown as jest.SpyInstance;
    enabledSpy.mockReturnValue(true);

    findBySecretSpy = jest.spyOn(
      McpOAuthTokenService,
      "findBySecret",
    ) as unknown as jest.SpyInstance;
    findBySecretSpy.mockResolvedValue(tokenRow());

    findGrantSpy = jest.spyOn(
      McpOAuthGrantService,
      "findGrant",
    ) as unknown as jest.SpyInstance;
    findGrantSpy.mockResolvedValue(grant);

    touchSpy = jest.spyOn(
      McpOAuthGrantService,
      "touchLastUsed",
    ) as unknown as jest.SpyInstance;
    touchSpy.mockResolvedValue(undefined);

    evaluateSpy = jest.spyOn(
      McpOAuthGrantAccess,
      "evaluate",
    ) as unknown as jest.SpyInstance;
    evaluateSpy.mockResolvedValue({ isAllowed: true, principal });
  });

  afterEach(() => {
    enabledSpy.mockRestore();
    findBySecretSpy.mockRestore();
    findGrantSpy.mockRestore();
    touchSpy.mockRestore();
    evaluateSpy.mockRestore();
  });

  describe("a good token", () => {
    it("authenticates as the principal the grant stands for", async () => {
      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: true, principal });
      expect((result as { principal: McpOAuthPrincipal }).principal).toBe(
        principal,
      );
    });

    it("looks the token up as an access token, and as nothing else", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(findBySecretSpy).toHaveBeenCalledTimes(1);
      expect(findBySecretSpy).toHaveBeenCalledWith({
        secret: ACCESS_TOKEN,
        tokenType: McpOAuthTokenType.AccessToken,
      });
    });

    it("reads the grant the token was issued under", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(findGrantSpy).toHaveBeenCalledTimes(1);
      expect((findGrantSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        GRANT_ID,
      );
    });

    it("asks whether the grant may still be used, on every request", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      // Nothing about the answer is cached.
      expect(findBySecretSpy).toHaveBeenCalledTimes(2);
      expect(findGrantSpy).toHaveBeenCalledTimes(2);
      expect(evaluateSpy).toHaveBeenCalledTimes(2);
      expect(evaluateSpy).toHaveBeenCalledWith({ grant, now: NOW });
    });

    it("leaves the activation requirement at its default: a pending grant is refused", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      const argument: Record<string, unknown> = evaluateSpy.mock
        .calls[0]![0] as Record<string, unknown>;

      // Only the code exchange may pass `requireActivated: false`.
      expect("requireActivated" in argument).toBe(false);
    });

    it("records that the grant was used", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(touchSpy).toHaveBeenCalledTimes(1);
      expect(touchSpy).toHaveBeenCalledWith(grant, NOW);
    });

    it("does not wait for that write", async () => {
      // A write that never finishes must not hold the request up.
      touchSpy.mockReturnValue(
        new Promise<void>((): void => {
          // Never settles.
        }),
      );

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result.isAuthenticated).toBe(true);
    });

    it("is not failed by that write failing", async () => {
      const failed: Promise<void> = Promise.reject(new Error("write failed"));

      // Observed here so the rejection is not reported as unhandled.
      failed.catch((): void => {});
      touchSpy.mockReturnValue(failed);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result.isAuthenticated).toBe(true);
    });

    it("uses the real clock when it is not given one", async () => {
      findBySecretSpy.mockResolvedValue(
        tokenRow({ expiresAt: new Date(Date.now() + ONE_HOUR_IN_MS) }),
      );

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN);

      expect(result.isAuthenticated).toBe(true);
      expect(evaluateSpy).toHaveBeenCalledWith({ grant, now: undefined });
    });
  });

  describe("OAuth switched off", () => {
    it("authenticates nobody and looks nothing up", async () => {
      enabledSpy.mockReturnValue(false);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
      expect(findBySecretSpy).not.toHaveBeenCalled();
      expect(findGrantSpy).not.toHaveBeenCalled();
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(touchSpy).not.toHaveBeenCalled();
    });
  });

  describe("a token that is not there", () => {
    it("is refused, and no grant is read", async () => {
      findBySecretSpy.mockResolvedValue(null);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
      expect(findGrantSpy).not.toHaveBeenCalled();
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(touchSpy).not.toHaveBeenCalled();
    });

    it("is refused when its row names no grant", async () => {
      const orphan: McpOAuthToken = tokenRow();

      delete orphan.mcpOAuthGrantId;
      findBySecretSpy.mockResolvedValue(orphan);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
      expect(findGrantSpy).not.toHaveBeenCalled();
    });
  });

  describe("a value that could not be an access token", () => {
    let findOneBySpy: jest.SpyInstance;

    beforeEach(() => {
      // The real lookup, with only the database behind it replaced.
      findBySecretSpy.mockRestore();
      findOneBySpy = jest.spyOn(
        McpOAuthTokenService,
        "findOneBy",
      ) as unknown as jest.SpyInstance;
      findOneBySpy.mockResolvedValue(tokenRow());
    });

    afterEach(() => {
      findOneBySpy.mockRestore();
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["a number", 12345],
      ["an array holding a token", [ACCESS_TOKEN]],
      ["an object", { token: ACCESS_TOKEN }],
      ["an API key", "8b2f6d1e-5c1a-4f0b-9f3e-2d7a6c4b1e90"],
      ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJl"],
      ["only the prefix", "oumcp_at_"],
      ["a token cut short", ACCESS_TOKEN.slice(0, -1)],
      ["a token with a character added", `${ACCESS_TOKEN}A`],
      ["a token with a trailing newline", `${ACCESS_TOKEN}\n`],
      ["a token with a space in front", ` ${ACCESS_TOKEN}`],
      ["a token in upper case", ACCESS_TOKEN.toUpperCase()],
      ["a refresh token", McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken)],
      [
        "an authorization code",
        McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
      ],
      ["a client secret", McpOAuthSecret.mintClientSecret()],
    ])(
      "refuses %s without asking the database",
      async (_name: string, value: unknown) => {
        const result: AccessTokenAuthentication =
          await AccessTokenAuthenticator.authenticate(value, NOW);

        expect(result).toEqual({ isAuthenticated: false });
        expect(findOneBySpy).not.toHaveBeenCalled();
        expect(findGrantSpy).not.toHaveBeenCalled();
      },
    );

    it("looks a well-shaped token up by its digest, never by the token itself", async () => {
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(findOneBySpy).toHaveBeenCalledTimes(1);

      const lookup: { query: Record<string, unknown> } = findOneBySpy.mock
        .calls[0]![0] as { query: Record<string, unknown> };

      expect(lookup.query).toEqual({
        tokenHash: McpOAuthSecret.hash(ACCESS_TOKEN),
        tokenType: McpOAuthTokenType.AccessToken,
      });
      expect(JSON.stringify(lookup)).not.toContain(ACCESS_TOKEN);
    });
  });

  describe("a token that has lapsed", () => {
    it("is refused, and no grant is read", async () => {
      findBySecretSpy.mockResolvedValue(
        tokenRow({ expiresAt: new Date(NOW.getTime() - 1) }),
      );

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
      expect(findGrantSpy).not.toHaveBeenCalled();
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(touchSpy).not.toHaveBeenCalled();
    });

    it("lapses at its expiry, not a moment after", async () => {
      const expiresAt: Date = new Date(NOW.getTime() + ONE_HOUR_IN_MS);

      findBySecretSpy.mockResolvedValue(tokenRow({ expiresAt }));

      expect(
        (
          await AccessTokenAuthenticator.authenticate(
            ACCESS_TOKEN,
            new Date(expiresAt.getTime() - 1),
          )
        ).isAuthenticated,
      ).toBe(true);
      expect(
        (await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, expiresAt))
          .isAuthenticated,
      ).toBe(false);
      expect(
        (
          await AccessTokenAuthenticator.authenticate(
            ACCESS_TOKEN,
            new Date(expiresAt.getTime() + 1),
          )
        ).isAuthenticated,
      ).toBe(false);
    });

    it("is refused when its row has no expiry at all", async () => {
      const row: McpOAuthToken = tokenRow();

      delete row.expiresAt;
      findBySecretSpy.mockResolvedValue(row);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
    });

    it("judges expiry by the clock it was handed", async () => {
      const lapsedByTheRealClock: McpOAuthToken = tokenRow({
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      });

      findBySecretSpy.mockResolvedValue(lapsedByTheRealClock);

      expect(
        (
          await AccessTokenAuthenticator.authenticate(
            ACCESS_TOKEN,
            new Date("2019-12-31T23:59:59.000Z"),
          )
        ).isAuthenticated,
      ).toBe(true);
    });
  });

  describe("a grant that is gone or may not be used", () => {
    it("is refused when the grant was revoked", async () => {
      findGrantSpy.mockResolvedValue(null);

      const result: AccessTokenAuthentication =
        await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      expect(result).toEqual({ isAuthenticated: false });
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(touchSpy).not.toHaveBeenCalled();
    });

    it.each(Object.values(McpOAuthGrantRefusal))(
      "is refused when the grant is refused as %s",
      async (refusal: McpOAuthGrantRefusal) => {
        evaluateSpy.mockResolvedValue({ isAllowed: false, refusal });

        const result: AccessTokenAuthentication =
          await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

        // The same answer whatever the reason: the caller only holds a string.
        expect(result).toEqual({ isAuthenticated: false });
        expect("principal" in result).toBe(false);
        // A refused request is not "use" of the grant.
        expect(touchSpy).not.toHaveBeenCalled();
      },
    );

    it("lets a failure to find out surface as a failure, not as a refusal", async () => {
      /*
       * "This provider is not allowed" and "we could not ask" are different
       * answers; a database blip must not sign a client out.
       */
      evaluateSpy.mockRejectedValue(new Error("database is down"));

      await expect(
        AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW),
      ).rejects.toThrow("database is down");
    });
  });

  describe("what goes to the log", () => {
    it("says why a token was refused, and never the token", async () => {
      findBySecretSpy.mockResolvedValue(null);
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      findBySecretSpy.mockResolvedValue(
        tokenRow({ expiresAt: new Date(NOW.getTime() - 1) }),
      );
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      findBySecretSpy.mockResolvedValue(tokenRow());
      findGrantSpy.mockResolvedValue(null);
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      findGrantSpy.mockResolvedValue(grant);
      evaluateSpy.mockResolvedValue({
        isAllowed: false,
        refusal: McpOAuthGrantRefusal.SsoRequired,
      });
      await AccessTokenAuthenticator.authenticate(ACCESS_TOKEN, NOW);

      const lines: Array<string> = (
        logger.debug as unknown as jest.Mock
      ).mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      });

      expect(lines).toEqual([
        "MCP OAuth: access token refused (unknown token).",
        "MCP OAuth: access token refused (expired).",
        "MCP OAuth: access token refused (grant revoked).",
        "MCP OAuth: access token refused (sso-required).",
      ]);

      for (const line of lines) {
        expect(line).not.toContain(ACCESS_TOKEN);
        expect(line).not.toContain("oumcp_at_");
      }
    });
  });
});
