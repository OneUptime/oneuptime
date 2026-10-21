import McpOAuthSecret, {
  MCP_OAUTH_ACCESS_TOKEN_PREFIX,
  MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
  MCP_OAUTH_CLIENT_SECRET_PREFIX,
  MCP_OAUTH_REFRESH_TOKEN_PREFIX,
} from "../../../../Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthTokenType from "../../../../Types/Mcp/McpOAuthTokenType";
import ObjectID from "../../../../Types/ObjectID";
import crypto from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * The secrets the MCP authorization server issues: authorization codes,
 * access tokens, refresh tokens and client secrets.
 *
 * What is pinned here is what the rest of the feature leans on:
 *
 *   - the SHAPE, because the shape guard in front of every lookup refuses
 *     anything else before it costs a query, and a guard that is too loose is
 *     a lookup an anonymous caller can force;
 *   - the PREFIXES, because the MCP endpoint tells an OAuth access token from
 *     an API key by nothing else, and a token of one kind must never be
 *     accepted as another (a refresh token presented as an access token, an
 *     access token presented as an authorization code);
 *   - the HASH, because it is the only thing stored: change how it is computed
 *     and every outstanding credential stops resolving.
 */

const SAMPLE_COUNT: number = 200;

const BODY_LENGTH: number = 43;

const BASE64URL_BODY_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;
const HEX_DIGEST_PATTERN: RegExp = /^[0-9a-f]{64}$/;
const UPPER_HALF_OF_ALPHABET_PATTERN: RegExp = /[G-Zg-z]/;
const BASE64URL_ONLY_SYMBOLS_PATTERN: RegExp = /[-_]/;

const TOKEN_TYPES: Array<[McpOAuthTokenType, string]> = [
  [McpOAuthTokenType.AuthorizationCode, "oumcp_ac_"],
  [McpOAuthTokenType.AccessToken, "oumcp_at_"],
  [McpOAuthTokenType.RefreshToken, "oumcp_rt_"],
];

const NOT_STRINGS: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 12345],
  ["a boolean", true],
  ["an array holding a secret", ["placeholder"]],
  [
    "an object with a toString",
    {
      toString: (): string => {
        return "placeholder";
      },
    },
  ],
];

// A body that is valid on its own, for building secrets with a wrong prefix.
function validBody(): string {
  return crypto.randomBytes(32).toString("base64url");
}

describe("the prefixes", () => {
  test("are the documented, distinct strings", () => {
    expect(MCP_OAUTH_AUTHORIZATION_CODE_PREFIX).toBe("oumcp_ac_");
    expect(MCP_OAUTH_ACCESS_TOKEN_PREFIX).toBe("oumcp_at_");
    expect(MCP_OAUTH_REFRESH_TOKEN_PREFIX).toBe("oumcp_rt_");
    expect(MCP_OAUTH_CLIENT_SECRET_PREFIX).toBe("oumcp_cs_");

    expect(
      new Set<string>([
        MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
        MCP_OAUTH_ACCESS_TOKEN_PREFIX,
        MCP_OAUTH_REFRESH_TOKEN_PREFIX,
        MCP_OAUTH_CLIENT_SECRET_PREFIX,
      ]).size,
    ).toBe(4);
  });

  test("no prefix is the start of another, so one secret can only ever claim one kind", () => {
    const prefixes: Array<string> = [
      MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
      MCP_OAUTH_ACCESS_TOKEN_PREFIX,
      MCP_OAUTH_REFRESH_TOKEN_PREFIX,
      MCP_OAUTH_CLIENT_SECRET_PREFIX,
    ];

    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) {
          expect(a.startsWith(b)).toBe(false);
        }
      }
    }
  });

  test("there is a prefix for every token type, and only for those", () => {
    expect(Object.values(McpOAuthTokenType).sort()).toEqual(
      TOKEN_TYPES.map(([tokenType]: [McpOAuthTokenType, string]): string => {
        return tokenType;
      }).sort(),
    );
  });
});

describe("McpOAuthSecret.mint", () => {
  test.each(TOKEN_TYPES)(
    "a %s is its prefix followed by 43 base64url characters",
    (tokenType: McpOAuthTokenType, prefix: string) => {
      for (let i: number = 0; i < SAMPLE_COUNT; i++) {
        const secret: string = McpOAuthSecret.mint(tokenType);

        expect(secret.startsWith(prefix)).toBe(true);
        expect(secret).toHaveLength(prefix.length + BODY_LENGTH);
        expect(secret.slice(prefix.length)).toMatch(BASE64URL_BODY_PATTERN);
      }
    },
  );

  test.each(TOKEN_TYPES)(
    "a %s carries exactly 32 random bytes (256 bits)",
    (tokenType: McpOAuthTokenType, prefix: string) => {
      const body: string = McpOAuthSecret.mint(tokenType).slice(prefix.length);

      expect(Buffer.from(body, "base64url")).toHaveLength(32);
    },
  );

  test.each(TOKEN_TYPES)(
    "a %s never carries base64 padding or the standard-alphabet symbols",
    (tokenType: McpOAuthTokenType) => {
      for (let i: number = 0; i < SAMPLE_COUNT; i++) {
        const secret: string = McpOAuthSecret.mint(tokenType);

        expect(secret).not.toContain("=");
        expect(secret).not.toContain("+");
        expect(secret).not.toContain("/");
      }
    },
  );

  test("is unique across many mints of every type", () => {
    const secrets: Set<string> = new Set<string>();

    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      for (const [tokenType] of TOKEN_TYPES) {
        secrets.add(McpOAuthSecret.mint(tokenType));
      }

      secrets.add(McpOAuthSecret.mintClientSecret());
    }

    expect(secrets.size).toBe(SAMPLE_COUNT * (TOKEN_TYPES.length + 1));
  });

  test("uses the whole base64url alphabet (not hex)", () => {
    /*
     * A regression guard against the mint being "simplified" to hex: hex
     * would still fill 43 characters if the byte count were adjusted, but it
     * never produces a letter beyond F, nor '-' or '_'.
     */
    const joined: string = Array.from({ length: SAMPLE_COUNT }, (): string => {
      return McpOAuthSecret.mint(McpOAuthTokenType.AccessToken).slice(
        MCP_OAUTH_ACCESS_TOKEN_PREFIX.length,
      );
    }).join("");

    expect(joined).toMatch(UPPER_HALF_OF_ALPHABET_PATTERN);
    expect(joined).toMatch(BASE64URL_ONLY_SYMBOLS_PATTERN);
  });

  test("a client secret is its prefix followed by 43 base64url characters", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      const secret: string = McpOAuthSecret.mintClientSecret();

      expect(secret.startsWith("oumcp_cs_")).toBe(true);
      expect(secret).toHaveLength("oumcp_cs_".length + BODY_LENGTH);
      expect(secret.slice("oumcp_cs_".length)).toMatch(BASE64URL_BODY_PATTERN);
    }
  });
});

describe("McpOAuthSecret.hash", () => {
  test("is the lowercase 64-character hex SHA-256", () => {
    const digest: string = McpOAuthSecret.hash(
      McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
    );

    expect(digest).toHaveLength(64);
    expect(digest).toMatch(HEX_DIGEST_PATTERN);
  });

  test("matches a known SHA-256 vector, unkeyed", () => {
    // NIST's "abc" vector: an HMAC, a salt or a pepper would all change it.
    expect(McpOAuthSecret.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("is of the WHOLE secret, prefix included", () => {
    const secret: string = McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken);
    const body: string = secret.slice(MCP_OAUTH_REFRESH_TOKEN_PREFIX.length);

    expect(McpOAuthSecret.hash(secret)).toBe(
      crypto.createHash("sha256").update(secret, "utf8").digest("hex"),
    );
    expect(McpOAuthSecret.hash(secret)).not.toBe(
      crypto.createHash("sha256").update(body, "utf8").digest("hex"),
    );
  });

  test("is deterministic: the same secret always hashes to the same row key", () => {
    const secret: string = McpOAuthSecret.mint(
      McpOAuthTokenType.AuthorizationCode,
    );

    expect(McpOAuthSecret.hash(secret)).toBe(McpOAuthSecret.hash(secret));
  });

  test("the same body under two prefixes hashes to two different digests", () => {
    const body: string = validBody();

    expect(
      McpOAuthSecret.hash(`${MCP_OAUTH_ACCESS_TOKEN_PREFIX}${body}`),
    ).not.toBe(McpOAuthSecret.hash(`${MCP_OAUTH_REFRESH_TOKEN_PREFIX}${body}`));
  });

  test("different secrets hash differently", () => {
    const digests: Set<string> = new Set<string>();

    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      digests.add(
        McpOAuthSecret.hash(McpOAuthSecret.mint(McpOAuthTokenType.AccessToken)),
      );
    }

    expect(digests.size).toBe(SAMPLE_COUNT);
  });

  test("never contains the secret it was made from", () => {
    const secret: string = McpOAuthSecret.mint(McpOAuthTokenType.AccessToken);
    const digest: string = McpOAuthSecret.hash(secret);

    expect(digest).not.toContain(secret);
    expect(digest).not.toContain("oumcp_");
  });
});

describe("McpOAuthSecret.isValidShape", () => {
  test.each(TOKEN_TYPES)(
    "accepts every minted %s",
    (tokenType: McpOAuthTokenType) => {
      for (let i: number = 0; i < SAMPLE_COUNT; i++) {
        expect(
          McpOAuthSecret.isValidShape(
            McpOAuthSecret.mint(tokenType),
            tokenType,
          ),
        ).toBe(true);
      }
    },
  );

  test("refuses every type presented as every other type", () => {
    for (const [mintedAs] of TOKEN_TYPES) {
      const secret: string = McpOAuthSecret.mint(mintedAs);

      for (const [presentedAs] of TOKEN_TYPES) {
        expect({
          mintedAs,
          presentedAs,
          valid: McpOAuthSecret.isValidShape(secret, presentedAs),
        }).toEqual({
          mintedAs,
          presentedAs,
          valid: mintedAs === presentedAs,
        });
      }
    }
  });

  test.each(TOKEN_TYPES)(
    "refuses a client secret presented as a %s",
    (tokenType: McpOAuthTokenType) => {
      expect(
        McpOAuthSecret.isValidShape(
          McpOAuthSecret.mintClientSecret(),
          tokenType,
        ),
      ).toBe(false);
    },
  );

  test.each(TOKEN_TYPES)(
    "refuses a %s with the right body and the wrong prefix",
    (tokenType: McpOAuthTokenType, prefix: string) => {
      const body: string = validBody();

      expect(McpOAuthSecret.isValidShape(`${prefix}${body}`, tokenType)).toBe(
        true,
      );

      const wrongPrefixes: Array<string> = [
        "",
        "oumcp_",
        "oumcp_xx_",
        prefix.toUpperCase(),
        prefix.replace("_", "-"),
        `x${prefix}`,
        `${prefix}${prefix}`,
        "Bearer ",
      ];

      for (const wrongPrefix of wrongPrefixes) {
        expect({
          wrongPrefix,
          valid: McpOAuthSecret.isValidShape(
            `${wrongPrefix}${body}`,
            tokenType,
          ),
        }).toEqual({ wrongPrefix, valid: false });
      }
    },
  );

  test.each(TOKEN_TYPES)(
    "refuses a %s whose body is the wrong length",
    (tokenType: McpOAuthTokenType, prefix: string) => {
      const body: string = validBody();

      expect(
        McpOAuthSecret.isValidShape(`${prefix}${body.slice(1)}`, tokenType),
      ).toBe(false);
      expect(McpOAuthSecret.isValidShape(`${prefix}${body}A`, tokenType)).toBe(
        false,
      );
      expect(McpOAuthSecret.isValidShape(prefix, tokenType)).toBe(false);
      expect(
        McpOAuthSecret.isValidShape(`${prefix}${body}${body}`, tokenType),
      ).toBe(false);
    },
  );

  test.each(TOKEN_TYPES)(
    "refuses a %s containing padding, standard-alphabet symbols or anything else foreign",
    (tokenType: McpOAuthTokenType, prefix: string) => {
      const body: string = validBody();

      const foreignCharacters: Array<string> = [
        "=",
        "+",
        "/",
        " ",
        ".",
        "%",
        "'",
        "\x00",
        "\n",
        "\xe9",
      ];

      for (const character of foreignCharacters) {
        // Same length as a real body, one character swapped.
        const swapped: string = `${body.slice(0, 20)}${character}${body.slice(21)}`;

        expect(swapped).toHaveLength(BODY_LENGTH);
        expect({
          character,
          valid: McpOAuthSecret.isValidShape(`${prefix}${swapped}`, tokenType),
        }).toEqual({ character, valid: false });
      }
    },
  );

  test.each(TOKEN_TYPES)(
    "refuses a %s with anything before or after it, including a trailing newline",
    (tokenType: McpOAuthTokenType) => {
      const secret: string = McpOAuthSecret.mint(tokenType);

      for (const wrapped of [
        ` ${secret}`,
        `${secret} `,
        `${secret}\n`,
        `\n${secret}`,
        `${secret}\r\n`,
        `${secret}\x00`,
        `Bearer ${secret}`,
        `${secret},${secret}`,
      ]) {
        expect(McpOAuthSecret.isValidShape(wrapped, tokenType)).toBe(false);
      }
    },
  );

  test.each(NOT_STRINGS)(
    "refuses %s for every token type without throwing",
    (_label: string, value: unknown) => {
      for (const [tokenType] of TOKEN_TYPES) {
        expect(McpOAuthSecret.isValidShape(value, tokenType)).toBe(false);
      }
    },
  );

  test("refuses the empty string", () => {
    for (const [tokenType] of TOKEN_TYPES) {
      expect(McpOAuthSecret.isValidShape("", tokenType)).toBe(false);
    }
  });

  test("refuses an array holding a real secret (a repeated form parameter)", () => {
    const secret: string = McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken);

    expect(
      McpOAuthSecret.isValidShape([secret], McpOAuthTokenType.RefreshToken),
    ).toBe(false);
  });
});

describe("McpOAuthSecret.isValidClientSecretShape", () => {
  test("accepts every minted client secret", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      expect(
        McpOAuthSecret.isValidClientSecretShape(
          McpOAuthSecret.mintClientSecret(),
        ),
      ).toBe(true);
    }
  });

  test.each(TOKEN_TYPES)(
    "refuses a %s presented as a client secret",
    (tokenType: McpOAuthTokenType) => {
      expect(
        McpOAuthSecret.isValidClientSecretShape(McpOAuthSecret.mint(tokenType)),
      ).toBe(false);
    },
  );

  test("refuses the wrong length, a wrong prefix and surrounding characters", () => {
    const secret: string = McpOAuthSecret.mintClientSecret();
    const body: string = secret.slice(MCP_OAUTH_CLIENT_SECRET_PREFIX.length);

    expect(McpOAuthSecret.isValidClientSecretShape(secret.slice(0, -1))).toBe(
      false,
    );
    expect(McpOAuthSecret.isValidClientSecretShape(`${secret}A`)).toBe(false);
    expect(McpOAuthSecret.isValidClientSecretShape(body)).toBe(false);
    expect(McpOAuthSecret.isValidClientSecretShape(`OUMCP_CS_${body}`)).toBe(
      false,
    );
    expect(McpOAuthSecret.isValidClientSecretShape(`${secret}\n`)).toBe(false);
    expect(McpOAuthSecret.isValidClientSecretShape(` ${secret}`)).toBe(false);
    expect(McpOAuthSecret.isValidClientSecretShape("")).toBe(false);
  });

  test.each(NOT_STRINGS)(
    "refuses %s without throwing",
    (_label: string, value: unknown) => {
      expect(McpOAuthSecret.isValidClientSecretShape(value)).toBe(false);
    },
  );
});

describe("McpOAuthSecret.looksLikeAccessToken", () => {
  test("is true for every minted access token", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      expect(
        McpOAuthSecret.looksLikeAccessToken(
          McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
        ),
      ).toBe(true);
    }
  });

  test("goes by the prefix alone, on purpose: a mangled access token is still an attempt at one", () => {
    /*
     * This is what gets a truncated or corrupted token answered 401 with a
     * challenge (so the client refreshes) instead of being forwarded as an
     * API key that can never match.
     */
    expect(McpOAuthSecret.looksLikeAccessToken("oumcp_at_")).toBe(true);
    expect(McpOAuthSecret.looksLikeAccessToken("oumcp_at_truncated")).toBe(
      true,
    );
    expect(
      McpOAuthSecret.looksLikeAccessToken(
        `${McpOAuthSecret.mint(McpOAuthTokenType.AccessToken)}trailing-garbage`,
      ),
    ).toBe(true);
    expect(
      McpOAuthSecret.isValidShape(
        "oumcp_at_truncated",
        McpOAuthTokenType.AccessToken,
      ),
    ).toBe(false);
  });

  test("is false for the other kinds of secret", () => {
    expect(
      McpOAuthSecret.looksLikeAccessToken(
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      ),
    ).toBe(false);
    expect(
      McpOAuthSecret.looksLikeAccessToken(
        McpOAuthSecret.mint(McpOAuthTokenType.AuthorizationCode),
      ),
    ).toBe(false);
    expect(
      McpOAuthSecret.looksLikeAccessToken(McpOAuthSecret.mintClientSecret()),
    ).toBe(false);
  });

  test("a UUID - which is what an API key is - never looks like an access token", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      expect(
        McpOAuthSecret.looksLikeAccessToken(ObjectID.generate().toString()),
      ).toBe(false);
      expect(McpOAuthSecret.looksLikeAccessToken(crypto.randomUUID())).toBe(
        false,
      );
    }

    // No UUID can ever start with the prefix: 'o' is not a hex digit.
    expect(MCP_OAUTH_ACCESS_TOKEN_PREFIX[0]).toBe("o");
  });

  test("the prefix has to be at the very start, in its exact case", () => {
    const token: string = McpOAuthSecret.mint(McpOAuthTokenType.AccessToken);

    expect(McpOAuthSecret.looksLikeAccessToken(` ${token}`)).toBe(false);
    expect(McpOAuthSecret.looksLikeAccessToken(`Bearer ${token}`)).toBe(false);
    expect(McpOAuthSecret.looksLikeAccessToken(token.toUpperCase())).toBe(
      false,
    );
    expect(McpOAuthSecret.looksLikeAccessToken("OUMCP_AT_abc")).toBe(false);
    expect(McpOAuthSecret.looksLikeAccessToken("oumcp_at")).toBe(false);
    expect(McpOAuthSecret.looksLikeAccessToken("")).toBe(false);
  });

  test.each(NOT_STRINGS)(
    "is false for %s without throwing",
    (_label: string, value: unknown) => {
      expect(McpOAuthSecret.looksLikeAccessToken(value)).toBe(false);
    },
  );

  test("is false for an array holding an access token (a repeated header)", () => {
    expect(
      McpOAuthSecret.looksLikeAccessToken([
        McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
      ]),
    ).toBe(false);
  });
});

describe("McpOAuthSecret.looksLikeIssuedSecret", () => {
  /*
   * What the MCP endpoint asks before it hands a credential on to the API as
   * an API key: is this one of the secrets this server issued? If it is, it
   * is not an API key, and a refresh token or a client secret must not travel
   * any further than the door it was wrongly presented at.
   */
  test("is true for every kind of secret this server mints", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      for (const [tokenType] of TOKEN_TYPES) {
        expect(
          McpOAuthSecret.looksLikeIssuedSecret(McpOAuthSecret.mint(tokenType)),
        ).toBe(true);
      }

      expect(
        McpOAuthSecret.looksLikeIssuedSecret(McpOAuthSecret.mintClientSecret()),
      ).toBe(true);
    }
  });

  test("covers every prefix there is, so a new kind of secret cannot be left out", () => {
    for (const prefix of [
      MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
      MCP_OAUTH_ACCESS_TOKEN_PREFIX,
      MCP_OAUTH_REFRESH_TOKEN_PREFIX,
      MCP_OAUTH_CLIENT_SECRET_PREFIX,
    ]) {
      expect(McpOAuthSecret.looksLikeIssuedSecret(prefix)).toBe(true);
      expect(
        McpOAuthSecret.looksLikeIssuedSecret(`${prefix}${validBody()}`),
      ).toBe(true);
    }
  });

  test("is true wherever looksLikeAccessToken is: an access token is one of them", () => {
    for (const value of [
      McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
      "oumcp_at_",
      "oumcp_at_truncated",
    ]) {
      expect(McpOAuthSecret.looksLikeAccessToken(value)).toBe(true);
      expect(McpOAuthSecret.looksLikeIssuedSecret(value)).toBe(true);
    }
  });

  test("goes by the namespace alone: a mangled secret, or a kind not invented yet, is still not an API key", () => {
    expect(McpOAuthSecret.looksLikeIssuedSecret("oumcp_")).toBe(true);
    expect(McpOAuthSecret.looksLikeIssuedSecret("oumcp_rt_truncated")).toBe(
      true,
    );
    expect(
      McpOAuthSecret.looksLikeIssuedSecret(
        `${McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken)}trailing-garbage`,
      ),
    ).toBe(true);
    expect(
      McpOAuthSecret.looksLikeIssuedSecret("oumcp_zz_a-kind-not-invented-yet"),
    ).toBe(true);
  });

  test("a UUID - which is what an API key is - is never one", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      expect(
        McpOAuthSecret.looksLikeIssuedSecret(ObjectID.generate().toString()),
      ).toBe(false);
      expect(McpOAuthSecret.looksLikeIssuedSecret(crypto.randomUUID())).toBe(
        false,
      );
    }
  });

  test("the namespace has to be at the very start, in its exact case", () => {
    const token: string = McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken);

    expect(McpOAuthSecret.looksLikeIssuedSecret(` ${token}`)).toBe(false);
    expect(McpOAuthSecret.looksLikeIssuedSecret(`Bearer ${token}`)).toBe(false);
    expect(McpOAuthSecret.looksLikeIssuedSecret(token.toUpperCase())).toBe(
      false,
    );
    expect(McpOAuthSecret.looksLikeIssuedSecret("OUMCP_rt_abc")).toBe(false);
    expect(McpOAuthSecret.looksLikeIssuedSecret("oumcp")).toBe(false);
    expect(McpOAuthSecret.looksLikeIssuedSecret("oumcprt_abc")).toBe(false);
    expect(McpOAuthSecret.looksLikeIssuedSecret("")).toBe(false);
  });

  test.each(NOT_STRINGS)(
    "is false for %s without throwing",
    (_label: string, value: unknown) => {
      expect(McpOAuthSecret.looksLikeIssuedSecret(value)).toBe(false);
    },
  );

  test("is false for an array holding a secret (a repeated header)", () => {
    expect(
      McpOAuthSecret.looksLikeIssuedSecret([
        McpOAuthSecret.mint(McpOAuthTokenType.RefreshToken),
      ]),
    ).toBe(false);
  });
});

describe("McpOAuthSecret.isHashEqual", () => {
  test("is true for the same digest", () => {
    const digest: string = McpOAuthSecret.hash(
      McpOAuthSecret.mintClientSecret(),
    );

    expect(McpOAuthSecret.isHashEqual(digest, digest)).toBe(true);
    expect(McpOAuthSecret.isHashEqual(digest, `${digest}`)).toBe(true);
  });

  test("is false for two different digests of the same length", () => {
    const a: string = McpOAuthSecret.hash(McpOAuthSecret.mintClientSecret());
    const b: string = McpOAuthSecret.hash(McpOAuthSecret.mintClientSecret());

    expect(a).toHaveLength(b.length);
    expect(McpOAuthSecret.isHashEqual(a, b)).toBe(false);
  });

  test("is false when a single character differs, wherever it is", () => {
    const digest: string = McpOAuthSecret.hash("some-secret");

    for (const index of [0, 31, 63]) {
      const flipped: string = `${digest.slice(0, index)}${
        digest[index] === "0" ? "1" : "0"
      }${digest.slice(index + 1)}`;

      expect(flipped).toHaveLength(digest.length);
      expect(McpOAuthSecret.isHashEqual(digest, flipped)).toBe(false);
      expect(McpOAuthSecret.isHashEqual(flipped, digest)).toBe(false);
    }
  });

  test("is false, and does not throw, when the lengths differ", () => {
    const digest: string = McpOAuthSecret.hash("some-secret");

    expect(() => {
      return McpOAuthSecret.isHashEqual(digest, digest.slice(0, 63));
    }).not.toThrow();

    expect(McpOAuthSecret.isHashEqual(digest, digest.slice(0, 63))).toBe(false);
    expect(McpOAuthSecret.isHashEqual(digest.slice(0, 63), digest)).toBe(false);
    expect(McpOAuthSecret.isHashEqual(digest, `${digest}0`)).toBe(false);
    expect(McpOAuthSecret.isHashEqual(digest, "")).toBe(false);
    expect(McpOAuthSecret.isHashEqual("", digest)).toBe(false);
  });

  test("a prefix of the digest is not the digest", () => {
    const digest: string = McpOAuthSecret.hash("some-secret");

    expect(McpOAuthSecret.isHashEqual(digest.slice(0, 32), digest)).toBe(false);
  });

  test("compares bytes, so characters of different widths never throw", () => {
    // Same number of characters, different number of bytes.
    expect(() => {
      return McpOAuthSecret.isHashEqual("abc\xe9", "abcd");
    }).not.toThrow();
    expect(McpOAuthSecret.isHashEqual("abc\xe9", "abcd")).toBe(false);
    expect(McpOAuthSecret.isHashEqual("abc\xe9", "abc\xe9")).toBe(true);
  });
});
