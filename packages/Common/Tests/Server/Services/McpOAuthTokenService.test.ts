import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import McpOAuthTokenService, {
  IssuedMcpOAuthAuthorizationCode,
  IssuedMcpOAuthTokenPair,
  Service as McpOAuthTokenServiceClass,
} from "../../../Server/Services/McpOAuthTokenService";
import McpOAuthToken from "../../../Models/DatabaseModels/McpOAuthToken";
import McpOAuthSecret from "../../../Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthTokenType from "../../../Types/Mcp/McpOAuthTokenType";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { createHash } from "crypto";

/*
 * The codes, access tokens and refresh tokens of OAuth sign-in for the MCP
 * server. Three properties of this service are what the security of the whole
 * flow rests on, and each is pinned here against the database call it makes:
 *
 *   1. ONLY A DIGEST IS STORED. A secret is minted, handed to the caller, and
 *      what is written is its SHA-256. A database dump is not a set of tokens.
 *   2. A LOOKUP NEVER TRUSTS THE SHAPE OF WHAT IT IS GIVEN. Anything that is
 *      not exactly a secret of the kind asked for is refused before it costs
 *      a query - including a perfectly good secret of ANOTHER kind.
 *   3. SINGLE USE IS ONE STATEMENT. claim() is a compare-and-set on
 *      `consumedAt`, so two requests racing with one code cannot both win.
 *
 * No database: every DatabaseService method underneath is spied.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const GRANT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const TOKEN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

const SECONDS: number = 1000;
const FIVE_MINUTES_MS: number = 5 * 60 * SECONDS;
const ONE_HOUR_MS: number = 60 * 60 * SECONDS;
const THIRTY_DAYS_MS: number = 30 * 24 * 60 * 60 * SECONDS;

const CODE_CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT_URI: string = "http://127.0.0.1:53124/callback";

const AUTHORIZATION_CODE_PATTERN: RegExp = /^oumcp_ac_[A-Za-z0-9_-]{43}$/;
const ACCESS_TOKEN_PATTERN: RegExp = /^oumcp_at_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_PATTERN: RegExp = /^oumcp_rt_[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN: RegExp = /^[0-9a-f]{64}$/;

// An independent oracle: not McpOAuthSecret.hash, which is the code under test.
const sha256Hex: (value: string) => string = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

interface CreateCall {
  data: McpOAuthToken;
  props: Record<string, unknown>;
}

interface FindOneByCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

interface CompareAndSetCall {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
  skipUpdateDateColumn?: boolean;
}

/*
 * Every string reachable from a value, so "the secret is nowhere in what was
 * written" can be asserted about the whole row rather than about the columns
 * the test happens to know.
 */
const collectStrings: (value: unknown, seen?: Set<unknown>) => Array<string> = (
  value: unknown,
  seen: Set<unknown> = new Set<unknown>(),
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (!value || typeof value !== "object" || seen.has(value)) {
    return [];
  }

  seen.add(value);

  if (value instanceof Date) {
    return [value.toISOString()];
  }

  const strings: Array<string> = [];

  for (const key of Object.keys(value as Record<string, unknown>)) {
    strings.push(key);
    strings.push(
      ...collectStrings((value as Record<string, unknown>)[key], seen),
    );
  }

  return strings;
};

const expectSecretNotIn: (secret: string, written: unknown) => void = (
  secret: string,
  written: unknown,
): void => {
  const secretBody: string = secret.slice("oumcp_xx_".length);

  expect(secretBody).toHaveLength(43);

  for (const value of collectStrings(written)) {
    expect(value).not.toContain(secret);
    // Nor the random part on its own, with the prefix stripped.
    expect(value).not.toContain(secretBody);
  }
};

describe("McpOAuthTokenService", () => {
  let createSpy: SpyInstance;
  let findOneBySpy: SpyInstance;
  let compareAndSetSpy: SpyInstance;

  const createCalls: () => Array<CreateCall> = (): Array<CreateCall> => {
    return createSpy.mock.calls.map((call: Array<unknown>): CreateCall => {
      return call[0] as CreateCall;
    });
  };

  beforeEach(() => {
    createSpy = getJestSpyOn(McpOAuthTokenService, "create").mockImplementation(
      async (createBy: CreateCall): Promise<McpOAuthToken> => {
        return createBy.data;
      },
    );
    findOneBySpy = getJestSpyOn(
      McpOAuthTokenService,
      "findOneBy",
    ).mockResolvedValue(null);
    compareAndSetSpy = getJestSpyOn(
      McpOAuthTokenService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("issueAuthorizationCode", () => {
    const issue: () => Promise<IssuedMcpOAuthAuthorizationCode> =
      async (): Promise<IssuedMcpOAuthAuthorizationCode> => {
        return await McpOAuthTokenService.issueAuthorizationCode({
          grantId: GRANT_ID,
          codeChallenge: CODE_CHALLENGE,
          redirectUri: REDIRECT_URI,
          now: NOW,
        });
      };

    test("hands back a code of the documented shape", async () => {
      const issued: IssuedMcpOAuthAuthorizationCode = await issue();

      expect(issued.code).toMatch(AUTHORIZATION_CODE_PATTERN);
    });

    test("writes exactly one row, and it holds the code's SHA-256, never the code", async () => {
      const issued: IssuedMcpOAuthAuthorizationCode = await issue();

      expect(createSpy).toHaveBeenCalledTimes(1);

      const row: McpOAuthToken = createCalls()[0]!.data;

      expect(row.tokenHash).toBe(sha256Hex(issued.code));
      expect(row.tokenHash).toMatch(SHA256_HEX_PATTERN);
      expectSecretNotIn(issued.code, createSpy.mock.calls);
    });

    test("the row is an authorization code for the grant, with the challenge and the redirect URI it was issued for", async () => {
      await issue();

      const row: McpOAuthToken = createCalls()[0]!.data;

      expect(row).toBeInstanceOf(McpOAuthToken);
      expect(row.tokenType).toBe(McpOAuthTokenType.AuthorizationCode);
      expect(row.mcpOAuthGrantId?.toString()).toBe(GRANT_ID.toString());
      expect(row.codeChallenge).toBe(CODE_CHALLENGE);
      expect(row.redirectUri).toBe(REDIRECT_URI);
    });

    test("a code lives five minutes from `now`, on the row and in the answer", async () => {
      const issued: IssuedMcpOAuthAuthorizationCode = await issue();
      const row: McpOAuthToken = createCalls()[0]!.data;

      expect(issued.expiresAt.getTime()).toBe(NOW.getTime() + FIVE_MINUTES_MS);
      expect(row.expiresAt?.getTime()).toBe(NOW.getTime() + FIVE_MINUTES_MS);
    });

    test("a new code is unconsumed: consumedAt is left unset for the database to hold as NULL", async () => {
      await issue();

      expect(createCalls()[0]!.data.consumedAt).toBeUndefined();
    });

    test("is written as root - nothing can create a token through the API", async () => {
      await issue();

      expect(createCalls()[0]!.props).toEqual({ isRoot: true });
    });

    test("without `now`, the expiry is five minutes from the current time", async () => {
      const before: number = Date.now();

      const issued: IssuedMcpOAuthAuthorizationCode =
        await McpOAuthTokenService.issueAuthorizationCode({
          grantId: GRANT_ID,
          codeChallenge: CODE_CHALLENGE,
          redirectUri: REDIRECT_URI,
        });

      const after: number = Date.now();

      expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + FIVE_MINUTES_MS,
      );
      expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
        after + FIVE_MINUTES_MS,
      );
    });

    test("two codes for the same grant are different secrets with different digests", async () => {
      const first: IssuedMcpOAuthAuthorizationCode = await issue();
      const second: IssuedMcpOAuthAuthorizationCode = await issue();

      expect(first.code).not.toBe(second.code);
      expect(createCalls()[0]!.data.tokenHash).not.toBe(
        createCalls()[1]!.data.tokenHash,
      );
    });

    test("a failed write issues nothing: the error reaches the caller", async () => {
      createSpy.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(issue()).rejects.toThrow("database unavailable");
    });
  });

  describe("issueTokenPair", () => {
    const issue: () => Promise<IssuedMcpOAuthTokenPair> =
      async (): Promise<IssuedMcpOAuthTokenPair> => {
        return await McpOAuthTokenService.issueTokenPair({
          grantId: GRANT_ID,
          now: NOW,
        });
      };

    test("hands back an access token and a refresh token of the documented shapes", async () => {
      const issued: IssuedMcpOAuthTokenPair = await issue();

      expect(issued.accessToken).toMatch(ACCESS_TOKEN_PATTERN);
      expect(issued.refreshToken).toMatch(REFRESH_TOKEN_PATTERN);
      expect(issued.accessToken.slice(9)).not.toBe(
        issued.refreshToken.slice(9),
      );
    });

    test("writes two rows - the access token, then the refresh token - each holding only a digest", async () => {
      const issued: IssuedMcpOAuthTokenPair = await issue();

      expect(createSpy).toHaveBeenCalledTimes(2);

      const accessRow: McpOAuthToken = createCalls()[0]!.data;
      const refreshRow: McpOAuthToken = createCalls()[1]!.data;

      expect(accessRow.tokenType).toBe(McpOAuthTokenType.AccessToken);
      expect(accessRow.tokenHash).toBe(sha256Hex(issued.accessToken));

      expect(refreshRow.tokenType).toBe(McpOAuthTokenType.RefreshToken);
      expect(refreshRow.tokenHash).toBe(sha256Hex(issued.refreshToken));

      expectSecretNotIn(issued.accessToken, createSpy.mock.calls);
      expectSecretNotIn(issued.refreshToken, createSpy.mock.calls);
    });

    test("both rows belong to the grant, and neither carries a code's challenge or redirect URI", async () => {
      await issue();

      for (const call of createCalls()) {
        expect(call.data).toBeInstanceOf(McpOAuthToken);
        expect(call.data.mcpOAuthGrantId?.toString()).toBe(GRANT_ID.toString());
        expect(call.data.codeChallenge).toBeUndefined();
        expect(call.data.redirectUri).toBeUndefined();
        expect(call.data.consumedAt).toBeUndefined();
        expect(call.props).toEqual({ isRoot: true });
      }
    });

    test("an access token lives one hour and a refresh token thirty days, from `now`", async () => {
      const issued: IssuedMcpOAuthTokenPair = await issue();

      expect(issued.accessTokenExpiresAt.getTime()).toBe(
        NOW.getTime() + ONE_HOUR_MS,
      );
      expect(issued.refreshTokenExpiresAt.getTime()).toBe(
        NOW.getTime() + THIRTY_DAYS_MS,
      );

      expect(createCalls()[0]!.data.expiresAt?.getTime()).toBe(
        NOW.getTime() + ONE_HOUR_MS,
      );
      expect(createCalls()[1]!.data.expiresAt?.getTime()).toBe(
        NOW.getTime() + THIRTY_DAYS_MS,
      );
    });

    test("every pair is new: refreshing never reissues a secret", async () => {
      const first: IssuedMcpOAuthTokenPair = await issue();
      const second: IssuedMcpOAuthTokenPair = await issue();

      expect(first.accessToken).not.toBe(second.accessToken);
      expect(first.refreshToken).not.toBe(second.refreshToken);

      const hashes: Array<string | undefined> = createCalls().map(
        (call: CreateCall): string | undefined => {
          return call.data.tokenHash;
        },
      );

      expect(new Set(hashes).size).toBe(4);
    });

    test("if the access token cannot be written, no refresh token is written and nothing is returned", async () => {
      createSpy.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(issue()).rejects.toThrow("database unavailable");
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test("if the refresh token cannot be written, the caller gets the error rather than half a pair", async () => {
      createSpy
        .mockImplementationOnce(
          async (createBy: CreateCall): Promise<McpOAuthToken> => {
            return createBy.data;
          },
        )
        .mockRejectedValueOnce(new Error("database unavailable"));

      await expect(issue()).rejects.toThrow("database unavailable");
    });

    test("without `now`, the expiries are measured from the current time", async () => {
      const before: number = Date.now();

      const issued: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: GRANT_ID });

      const after: number = Date.now();

      expect(issued.accessTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
        before + ONE_HOUR_MS,
      );
      expect(issued.accessTokenExpiresAt.getTime()).toBeLessThanOrEqual(
        after + ONE_HOUR_MS,
      );
      expect(issued.refreshTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
        before + THIRTY_DAYS_MS,
      );
      expect(issued.refreshTokenExpiresAt.getTime()).toBeLessThanOrEqual(
        after + THIRTY_DAYS_MS,
      );
    });
  });

  describe("findBySecret", () => {
    const code: string = McpOAuthSecret.mint(
      McpOAuthTokenType.AuthorizationCode,
    );
    const accessToken: string = McpOAuthSecret.mint(
      McpOAuthTokenType.AccessToken,
    );
    const refreshToken: string = McpOAuthSecret.mint(
      McpOAuthTokenType.RefreshToken,
    );

    const secretOfType: Record<McpOAuthTokenType, string> = {
      [McpOAuthTokenType.AuthorizationCode]: code,
      [McpOAuthTokenType.AccessToken]: accessToken,
      [McpOAuthTokenType.RefreshToken]: refreshToken,
    };

    const ALL_TYPES: Array<McpOAuthTokenType> = [
      McpOAuthTokenType.AuthorizationCode,
      McpOAuthTokenType.AccessToken,
      McpOAuthTokenType.RefreshToken,
    ];

    test.each(ALL_TYPES)(
      "a well-formed %s is looked up by its digest AND its type",
      async (tokenType: McpOAuthTokenType) => {
        const secret: string = secretOfType[tokenType];

        await McpOAuthTokenService.findBySecret({ secret, tokenType });

        expect(findOneBySpy).toHaveBeenCalledTimes(1);

        const call: FindOneByCall = findOneBySpy.mock
          .calls[0]![0] as FindOneByCall;

        expect(call.query).toEqual({
          tokenHash: sha256Hex(secret),
          tokenType,
        });
        expect(call.props).toEqual({ isRoot: true });
        expectSecretNotIn(secret, findOneBySpy.mock.calls);
      },
    );

    /*
     * Every pairing of "a real secret of one kind" with "asked for as another
     * kind". The prefix is what tells them apart, and it is what stops an
     * access token being redeemed as a refresh token, or a code being used as
     * a bearer credential.
     */
    const crossTypeCases: Array<[McpOAuthTokenType, McpOAuthTokenType]> =
      ALL_TYPES.flatMap(
        (
          presented: McpOAuthTokenType,
        ): Array<[McpOAuthTokenType, McpOAuthTokenType]> => {
          return ALL_TYPES.filter((askedFor: McpOAuthTokenType): boolean => {
            return askedFor !== presented;
          }).map(
            (
              askedFor: McpOAuthTokenType,
            ): [McpOAuthTokenType, McpOAuthTokenType] => {
              return [presented, askedFor];
            },
          );
        },
      );

    test.each(crossTypeCases)(
      "a real %s presented as a %s is refused without a query",
      async (presented: McpOAuthTokenType, askedFor: McpOAuthTokenType) => {
        await expect(
          McpOAuthTokenService.findBySecret({
            secret: secretOfType[presented],
            tokenType: askedFor,
          }),
        ).resolves.toBeNull();

        expect(findOneBySpy).not.toHaveBeenCalled();
      },
    );

    const malformedSecrets: Array<[string, unknown]> = [
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["a number", 12345],
      ["an object", { secret: accessToken }],
      ["an array holding a real token", [accessToken]],
      ["a UUID (an API key)", "5f1c2b9e-8d3a-4c7b-9e2f-1a2b3c4d5e6f"],
      ["the prefix alone", "oumcp_at_"],
      ["one character short", accessToken.slice(0, -1)],
      ["one character long", `${accessToken}A`],
      ["a trailing newline", `${accessToken}\n`],
      ["leading whitespace", ` ${accessToken}`],
      ["a Bearer prefix left on", `Bearer ${accessToken}`],
      ["a character outside base64url", `${accessToken.slice(0, -1)}+`],
      ["padding", `${accessToken.slice(0, -1)}=`],
      ["the prefix in upper case", accessToken.toUpperCase()],
      ["an unknown secret kind", `oumcp_zz_${accessToken.slice(9)}`],
      ["a client secret", McpOAuthSecret.mintClientSecret()],
    ];

    test.each(malformedSecrets)(
      "%s never reaches the database",
      async (_label: string, secret: unknown) => {
        await expect(
          McpOAuthTokenService.findBySecret({
            secret,
            tokenType: McpOAuthTokenType.AccessToken,
          }),
        ).resolves.toBeNull();

        expect(findOneBySpy).not.toHaveBeenCalled();
      },
    );

    test("reads back what the caller needs to tell 'never existed' from 'expired' from 'already used'", async () => {
      await McpOAuthTokenService.findBySecret({
        secret: code,
        tokenType: McpOAuthTokenType.AuthorizationCode,
      });

      const call: FindOneByCall = findOneBySpy.mock
        .calls[0]![0] as FindOneByCall;

      expect(call.select).toEqual({
        _id: true,
        mcpOAuthGrantId: true,
        tokenType: true,
        expiresAt: true,
        consumedAt: true,
        codeChallenge: true,
        redirectUri: true,
      });

      // The digest is the lookup key; it is never read back out.
      expect(call.select).not.toHaveProperty("tokenHash");
    });

    test("does NOT filter out expired or consumed rows: that is the caller's decision, and replay detection depends on finding them", async () => {
      const spent: McpOAuthToken = new McpOAuthToken();
      spent._id = TOKEN_ID.toString();
      spent.expiresAt = new Date(NOW.getTime() - ONE_HOUR_MS);
      spent.consumedAt = new Date(NOW.getTime() - 2 * ONE_HOUR_MS);

      findOneBySpy.mockResolvedValue(spent);

      await expect(
        McpOAuthTokenService.findBySecret({
          secret: refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        }),
      ).resolves.toBe(spent);

      const call: FindOneByCall = findOneBySpy.mock
        .calls[0]![0] as FindOneByCall;

      expect(Object.keys(call.query).sort()).toEqual([
        "tokenHash",
        "tokenType",
      ]);
    });

    test("an unknown but well-formed secret is null", async () => {
      await expect(
        McpOAuthTokenService.findBySecret({
          secret: accessToken,
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).resolves.toBeNull();

      expect(findOneBySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("claim", () => {
    test("is a compare-and-set of consumedAt from NULL to `now`, on that one row", async () => {
      await McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW });

      expect(compareAndSetSpy).toHaveBeenCalledTimes(1);

      const call: CompareAndSetCall = compareAndSetSpy.mock
        .calls[0]![0] as CompareAndSetCall;

      expect(call.id.toString()).toBe(TOKEN_ID.toString());
      expect(call.data).toEqual({ consumedAt: NOW });
      // The guard: the write only happens while the row is still unconsumed.
      expect(call.expectedData).toEqual({ consumedAt: null });
      expect(Object.keys(call.expectedData)).toEqual(["consumedAt"]);
    });

    test("is true for the caller whose write landed", async () => {
      compareAndSetSpy.mockResolvedValue(true);

      await expect(
        McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW }),
      ).resolves.toBe(true);
    });

    test("is false for the caller who arrived second", async () => {
      compareAndSetSpy.mockResolvedValue(false);

      await expect(
        McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW }),
      ).resolves.toBe(false);
    });

    test("of two racing claims exactly one is told yes", async () => {
      let isConsumed: boolean = false;

      compareAndSetSpy.mockImplementation(async (): Promise<boolean> => {
        if (isConsumed) {
          return false;
        }

        isConsumed = true;
        return true;
      });

      const results: Array<boolean> = await Promise.all([
        McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW }),
        McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW }),
      ]);

      expect(
        results.filter((won: boolean): boolean => {
          return won;
        }),
      ).toHaveLength(1);
    });

    test("does not use a read followed by a write: nothing but the compare-and-set runs", async () => {
      const findOneByIdSpy: SpyInstance = getJestSpyOn(
        McpOAuthTokenService,
        "findOneById",
      ).mockResolvedValue(null);
      const updateSpy: SpyInstance = getJestSpyOn(
        McpOAuthTokenService,
        "updateColumnsByIdWithoutHooks",
      ).mockResolvedValue(undefined);

      await McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW });

      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test("leaves updatedAt alone", async () => {
      await McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW });

      const call: CompareAndSetCall = compareAndSetSpy.mock
        .calls[0]![0] as CompareAndSetCall;

      expect(call.skipUpdateDateColumn).toBe(true);
    });

    test("without `now`, consumedAt is the current time", async () => {
      const before: number = Date.now();

      await McpOAuthTokenService.claim({ tokenId: TOKEN_ID });

      const after: number = Date.now();
      const call: CompareAndSetCall = compareAndSetSpy.mock
        .calls[0]![0] as CompareAndSetCall;
      const consumedAt: number = (call.data["consumedAt"] as Date).getTime();

      expect(consumedAt).toBeGreaterThanOrEqual(before);
      expect(consumedAt).toBeLessThanOrEqual(after);
    });

    test("a failing write is an error, never a silent 'yes' or 'no'", async () => {
      compareAndSetSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthTokenService.claim({ tokenId: TOKEN_ID, now: NOW }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("isExpired", () => {
    const tokenExpiringAt: (expiresAt: Date | undefined) => McpOAuthToken = (
      expiresAt: Date | undefined,
    ): McpOAuthToken => {
      const token: McpOAuthToken = new McpOAuthToken();

      if (expiresAt) {
        token.expiresAt = expiresAt;
      }

      return token;
    };

    test("a token with no expiry is expired - never 'good for ever'", () => {
      expect(
        McpOAuthTokenServiceClass.isExpired(tokenExpiringAt(undefined), NOW),
      ).toBe(true);
    });

    test("a token is expired AT its expiry instant, not only after it", () => {
      expect(
        McpOAuthTokenServiceClass.isExpired(
          tokenExpiringAt(new Date(NOW.getTime())),
          NOW,
        ),
      ).toBe(true);
    });

    test("a token is good until the millisecond before its expiry", () => {
      expect(
        McpOAuthTokenServiceClass.isExpired(
          tokenExpiringAt(new Date(NOW.getTime() + 1)),
          NOW,
        ),
      ).toBe(false);
    });

    test("a token past its expiry is expired", () => {
      expect(
        McpOAuthTokenServiceClass.isExpired(
          tokenExpiringAt(new Date(NOW.getTime() - 1)),
          NOW,
        ),
      ).toBe(true);
    });

    test("an expiry that came back from the database as a string is read as a date", () => {
      const token: McpOAuthToken = new McpOAuthToken();

      (token as unknown as { expiresAt: string }).expiresAt = new Date(
        NOW.getTime() + ONE_HOUR_MS,
      ).toISOString();

      expect(McpOAuthTokenServiceClass.isExpired(token, NOW)).toBe(false);
      expect(
        McpOAuthTokenServiceClass.isExpired(
          token,
          new Date(NOW.getTime() + ONE_HOUR_MS),
        ),
      ).toBe(true);
    });

    test("without `now`, it is measured against the current time", () => {
      expect(
        McpOAuthTokenServiceClass.isExpired(
          tokenExpiringAt(new Date(Date.now() + ONE_HOUR_MS)),
        ),
      ).toBe(false);
      expect(
        McpOAuthTokenServiceClass.isExpired(
          tokenExpiringAt(new Date(Date.now() - ONE_HOUR_MS)),
        ),
      ).toBe(true);
    });
  });

  describe("retention", () => {
    test("expired tokens are swept by their expiry, a day after it passes", () => {
      expect(McpOAuthTokenService.hardDeleteItemByColumnName).toBe("expiresAt");
      expect(McpOAuthTokenService.hardDeleteItemsOlderThanDays).toBe(1);
      expect(McpOAuthTokenServiceClass.EXPIRED_TOKEN_RETENTION_IN_DAYS).toBe(1);
    });

    test("a spent code or refresh token outlives its expiry, so presenting it again can still be recognised", () => {
      /*
       * Replay detection finds the consumed row by its digest. A sweep that
       * ran AT expiry would delete the evidence at the same moment the
       * secret stopped working.
       */
      expect(
        McpOAuthTokenService.hardDeleteItemsOlderThanDays,
      ).toBeGreaterThanOrEqual(1);
    });

    test("the service is bound to the McpOAuthToken model", () => {
      expect(McpOAuthTokenService.modelType).toBe(McpOAuthToken);
    });
  });
});
