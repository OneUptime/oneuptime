import McpDelegationToken, {
  McpDelegationClaims,
} from "../../../../Server/Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "../../../../Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthSignedToken, {
  McpOAuthSignedTokenPurpose,
} from "../../../../Server/Utils/Mcp/McpOAuthSignedToken";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

// JSONWebToken.decode logs every token it refuses.
jest.mock("../../../../Server/Utils/Logger");

/*
 * The credential the MCP server presents to the OneUptime API for a client
 * that signed in with OAuth. The API believes what it says - who the member
 * is, which project, which grant, and whether the grant may write - so every
 * one of those has to be exactly what the MCP server signed, or nothing.
 *
 * The cases that matter most:
 *
 *   - a token that does not SAY it may write must not be treated as though it
 *     may (a missing or mistyped `w` is a refusal, never a default);
 *   - none of the claims can be altered, dropped or substituted;
 *   - the authorization-request ticket - the other token of the same format,
 *     which travels through the browser - can never be presented as one;
 *   - it is not a JWT, so it can never be replayed as a dashboard session.
 */

type DelegationTokenClass =
  typeof import("../../../../Server/Utils/Mcp/McpDelegationToken").default;

const DELEGATION_PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:api-delegation-token:v1",
  maxLength: 4096,
};

const TICKET_PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:authorization-request:v1",
  maxLength: 6000,
};

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

const USER_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const PROJECT_ID: string = "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f";
const GRANT_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT_ID: string = "https://claude.ai/oauth/claude-code-client-metadata";

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function claimsWith(
  overrides: Partial<McpDelegationClaims> = {},
): McpDelegationClaims {
  return {
    userId: new ObjectID(USER_ID),
    userEmail: new Email("member@example.com"),
    userName: "A Member",
    projectId: new ObjectID(PROJECT_ID),
    grantId: new ObjectID(GRANT_ID),
    clientId: CLIENT_ID,
    clientName: "Claude Code",
    canWrite: true,
    ...overrides,
  };
}

// The claim set exactly as sign() writes it.
function wireClaims(overrides: Record<string, unknown> = {}): JSONObject {
  return {
    u: USER_ID,
    e: "member@example.com",
    n: "A Member",
    p: PROJECT_ID,
    g: GRANT_ID,
    ci: CLIENT_ID,
    cn: "Claude Code",
    w: true,
    ...overrides,
  } as JSONObject;
}

function without(key: string): JSONObject {
  const claims: JSONObject = wireClaims();

  delete claims[key];

  return claims;
}

/*
 * A token carrying ANY claim set, genuinely signed under the delegation
 * label: what the MCP server would produce if it had a bug, and the only
 * way to reach the claim checks behind the signature check.
 */
function signRaw(
  claims: JSONObject,
  purpose: McpOAuthSignedTokenPurpose = DELEGATION_PURPOSE,
): string {
  const token: string | null = McpOAuthSignedToken.sign({
    purpose,
    claims,
    expiresInSeconds: 60,
    now: NOW,
  });

  if (!token) {
    throw new Error("expected a token to be minted");
  }

  return token;
}

function payloadOf(token: string): JSONObject {
  return JSON.parse(
    Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"),
  ) as JSONObject;
}

describe("McpDelegationToken: the header", () => {
  test("is x-oneuptime-mcp-delegation, in lower case (Node lower-cases header names)", () => {
    expect(McpDelegationToken.HEADER_NAME).toBe("x-oneuptime-mcp-delegation");
    expect(McpDelegationToken.HEADER_NAME).toBe(
      McpDelegationToken.HEADER_NAME.toLowerCase(),
    );
  });

  test("is not a header any other credential uses", () => {
    for (const other of ["apikey", "x-api-key", "authorization", "cookie"]) {
      expect(McpDelegationToken.HEADER_NAME).not.toBe(other);
    }
  });
});

describe("McpDelegationToken: round trip", () => {
  test("verify returns every claim that was signed", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);
    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      token,
      NOW,
    );

    expect(verified).not.toBeNull();
    expect(verified!.userId.toString()).toBe(USER_ID);
    expect(verified!.userEmail.toString()).toBe("member@example.com");
    expect(verified!.userName).toBe("A Member");
    expect(verified!.projectId.toString()).toBe(PROJECT_ID);
    expect(verified!.grantId.toString()).toBe(GRANT_ID);
    expect(verified!.clientId).toBe(CLIENT_ID);
    expect(verified!.clientName).toBe("Claude Code");
    expect(verified!.canWrite).toBe(true);
  });

  test("hands back typed values, not strings", () => {
    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      McpDelegationToken.sign(claimsWith(), NOW),
      NOW,
    );

    expect(verified!.userId).toBeInstanceOf(ObjectID);
    expect(verified!.projectId).toBeInstanceOf(ObjectID);
    expect(verified!.grantId).toBeInstanceOf(ObjectID);
    expect(verified!.userEmail).toBeInstanceOf(Email);
    expect(typeof verified!.canWrite).toBe("boolean");
  });

  test("a read-only grant round trips as read-only", () => {
    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      McpDelegationToken.sign(claimsWith({ canWrite: false }), NOW),
      NOW,
    );

    expect(verified).not.toBeNull();
    expect(verified!.canWrite).toBe(false);
  });

  test("a read-and-write grant round trips as read-and-write", () => {
    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      McpDelegationToken.sign(claimsWith({ canWrite: true }), NOW),
      NOW,
    );

    expect(verified!.canWrite).toBe(true);
  });

  test("the three ids are not interchangeable: each comes back in its own field", () => {
    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      McpDelegationToken.sign(claimsWith(), NOW),
      NOW,
    );

    expect(
      new Set<string>([
        verified!.userId.toString(),
        verified!.projectId.toString(),
        verified!.grantId.toString(),
      ]).size,
    ).toBe(3);
    expect(verified!.userId.toString()).not.toBe(PROJECT_ID);
    expect(verified!.projectId.toString()).not.toBe(GRANT_ID);
  });

  test("a registered client's UUID client id, an empty user name and an empty client name all round trip", () => {
    const registeredClientId: string = ObjectID.generate().toString();

    const verified: McpDelegationClaims | null = McpDelegationToken.verify(
      McpDelegationToken.sign(
        claimsWith({
          clientId: registeredClientId,
          userName: "",
          clientName: "",
        }),
        NOW,
      ),
      NOW,
    );

    expect(verified).not.toBeNull();
    expect(verified!.clientId).toBe(registeredClientId);
    expect(verified!.userName).toBe("");
    expect(verified!.clientName).toBe("");
  });

  test("uses the current time when none is given", () => {
    expect(
      McpDelegationToken.verify(McpDelegationToken.sign(claimsWith())),
    ).not.toBeNull();
  });
});

describe("McpDelegationToken: what is written on the wire", () => {
  test("the claim set is exactly these eight short keys", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);

    expect(payloadOf(token)["c"]).toEqual(wireClaims());
  });

  test("carries no permissions and no master-admin flag", () => {
    const claims: JSONObject = payloadOf(
      McpDelegationToken.sign(claimsWith(), NOW),
    )["c"] as JSONObject;

    expect(Object.keys(claims).sort()).toEqual(
      ["u", "e", "n", "p", "g", "ci", "cn", "w"].sort(),
    );

    const serialized: string = JSON.stringify(claims).toLowerCase();

    expect(serialized).not.toContain("masteradmin");
    expect(serialized).not.toContain("permission");
    expect(serialized).not.toContain("isroot");
  });

  test("is signed under the delegation label and lives for the configured sixty seconds", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);
    const envelope: JSONObject = payloadOf(token);

    expect(McpOAuthConfig.DELEGATION_TOKEN_TTL_SECONDS).toBe(60);
    expect(envelope["i"]).toBe(NOW.getTime());
    expect(envelope["x"]).toBe(NOW.getTime() + 60 * 1000);

    expect(
      McpOAuthSignedToken.verify({
        purpose: DELEGATION_PURPOSE,
        token,
        now: NOW,
      }),
    ).toEqual(wireClaims());
  });

  test("only the boolean true is written as writable", () => {
    const notTrue: Array<unknown> = [false, "true", 1, {}, [], null, undefined];

    for (const value of notTrue) {
      const token: string = McpDelegationToken.sign(
        claimsWith({ canWrite: value as boolean }),
        NOW,
      );

      expect({ value, w: (payloadOf(token)["c"] as JSONObject)["w"] }).toEqual({
        value,
        w: false,
      });
      expect(McpDelegationToken.verify(token, NOW)!.canWrite).toBe(false);
    }
  });
});

describe("McpDelegationToken: lifetime", () => {
  test("is good for sixty seconds and not a millisecond longer", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);

    expect(McpDelegationToken.verify(token, at(0))).not.toBeNull();
    expect(
      McpDelegationToken.verify(token, at(59 * 1000 + 999)),
    ).not.toBeNull();
    expect(McpDelegationToken.verify(token, at(60 * 1000))).toBeNull();
    expect(McpDelegationToken.verify(token, at(61 * 1000))).toBeNull();
    expect(McpDelegationToken.verify(token, at(60 * 60 * 1000))).toBeNull();
  });
});

describe("McpDelegationToken.verify: correctly signed, wrong claims", () => {
  test("the forging helper is sound: the full claim set verifies", () => {
    expect(
      McpDelegationToken.verify(signRaw(wireClaims()), NOW),
    ).not.toBeNull();
  });

  describe("the write flag", () => {
    test("a token with NO write flag is refused - it must not default to writable", () => {
      expect(McpDelegationToken.verify(signRaw(without("w")), NOW)).toBeNull();
    });

    const MISTYPED_WRITE_FLAGS: Array<[string, unknown]> = [
      ['the string "true"', "true"],
      ['the string "false"', "false"],
      ["the number 1", 1],
      ["the number 0", 0],
      ["null", null],
      ["an object", {}],
      ["an array", [true]],
    ];

    test.each(MISTYPED_WRITE_FLAGS)(
      "a write flag that is %s is refused, not coerced",
      (_label: string, value: unknown) => {
        expect(
          McpDelegationToken.verify(signRaw(wireClaims({ w: value })), NOW),
        ).toBeNull();
      },
    );

    test("false is a valid flag: the token verifies as read-only", () => {
      const verified: McpDelegationClaims | null = McpDelegationToken.verify(
        signRaw(wireClaims({ w: false })),
        NOW,
      );

      expect(verified).not.toBeNull();
      expect(verified!.canWrite).toBe(false);
    });

    test("flipping a read-only token to writable in the payload breaks its signature", () => {
      const readOnly: string = McpDelegationToken.sign(
        claimsWith({ canWrite: false }),
        NOW,
      );
      const envelope: JSONObject = payloadOf(readOnly);

      (envelope["c"] as JSONObject)["w"] = true;

      const rewritten: string = Buffer.from(
        JSON.stringify(envelope),
        "utf8",
      ).toString("base64url");

      expect(
        McpDelegationToken.verify(
          `v1.${rewritten}.${readOnly.split(".")[2] as string}`,
          NOW,
        ),
      ).toBeNull();

      // The original still says what it said.
      expect(McpDelegationToken.verify(readOnly, NOW)!.canWrite).toBe(false);
    });
  });

  describe("the ids", () => {
    const ID_KEYS: Array<[string, string]> = [
      ["user id", "u"],
      ["project id", "p"],
      ["grant id", "g"],
    ];

    const NOT_UUIDS: Array<unknown> = [
      "not-a-uuid",
      "",
      "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1", // one character short
      "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e ", // trailing space
      "5f8b9c0de1a24b3c8d5e6f7a8b9c0d1e", // no dashes
      '\'; DROP TABLE "User"; --',
      42,
      null,
      true,
      { _type: "ObjectID", value: USER_ID },
      [USER_ID],
    ];

    test.each(ID_KEYS)(
      "a missing %s is refused",
      (_label: string, key: string) => {
        expect(
          McpDelegationToken.verify(signRaw(without(key)), NOW),
        ).toBeNull();
      },
    );

    test.each(ID_KEYS)(
      "a %s that is not a UUID string is refused",
      (_label: string, key: string) => {
        for (const value of NOT_UUIDS) {
          expect({
            value,
            verified: McpDelegationToken.verify(
              signRaw(wireClaims({ [key]: value })),
              NOW,
            ),
          }).toEqual({ value, verified: null });
        }
      },
    );
  });

  describe("the email", () => {
    const NOT_EMAILS: Array<unknown> = [
      "not-an-email",
      "",
      "member@",
      "@example.com",
      "member@localhost",
      42,
      null,
      true,
      { _type: "Email", value: "member@example.com" },
      ["member@example.com"],
    ];

    test("a missing email is refused", () => {
      expect(McpDelegationToken.verify(signRaw(without("e")), NOW)).toBeNull();
    });

    test("an email that is not a valid address string is refused", () => {
      for (const value of NOT_EMAILS) {
        expect({
          value,
          verified: McpDelegationToken.verify(
            signRaw(wireClaims({ e: value })),
            NOW,
          ),
        }).toEqual({ value, verified: null });
      }
    });
  });

  describe("the names and the client id", () => {
    test("a missing user name, client id or client name is refused", () => {
      for (const key of ["n", "ci", "cn"]) {
        expect({
          key,
          verified: McpDelegationToken.verify(signRaw(without(key)), NOW),
        }).toEqual({ key, verified: null });
      }
    });

    test("an EMPTY client id is refused", () => {
      expect(
        McpDelegationToken.verify(signRaw(wireClaims({ ci: "" })), NOW),
      ).toBeNull();
    });

    test("a user name, client id or client name that is not a string is refused", () => {
      for (const key of ["n", "ci", "cn"]) {
        for (const value of [42, null, true, {}, ["x"]]) {
          expect({
            key,
            value,
            verified: McpDelegationToken.verify(
              signRaw(wireClaims({ [key]: value })),
              NOW,
            ),
          }).toEqual({ key, value, verified: null });
        }
      }
    });
  });

  test("an empty claim set is refused", () => {
    expect(McpDelegationToken.verify(signRaw({}), NOW)).toBeNull();
  });

  test("claims under the names a session JWT uses are refused", () => {
    expect(
      McpDelegationToken.verify(
        signRaw({
          userId: USER_ID,
          email: "member@example.com",
          name: "A Member",
          projectId: PROJECT_ID,
          isMasterAdmin: true,
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("McpDelegationToken: only a delegation token is one", () => {
  test("an authorization-request ticket carrying the same claims is NOT a delegation token", () => {
    /*
     * The ticket travels through the member's browser. If it verified here,
     * anyone holding a ticket could call the API as whoever it named.
     */
    const ticket: string = signRaw(wireClaims(), TICKET_PURPOSE);

    expect(
      McpOAuthSignedToken.verify({
        purpose: TICKET_PURPOSE,
        token: ticket,
        now: NOW,
      }),
    ).toEqual(wireClaims());

    expect(McpDelegationToken.verify(ticket, NOW)).toBeNull();
  });

  test("a delegation token is not an authorization-request ticket", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);

    expect(
      McpOAuthSignedToken.verify({
        purpose: TICKET_PURPOSE,
        token,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a token signed under any other label is refused", () => {
    for (const label of [
      "oneuptime:mcp:oauth:api-delegation-token:v2",
      "oneuptime:mcp:oauth:api-delegation-token",
      "",
    ]) {
      expect(
        McpDelegationToken.verify(
          signRaw(wireClaims(), { keyDerivationLabel: label, maxLength: 4096 }),
          NOW,
        ),
      ).toBeNull();
    }
  });

  test("a token minted on an instance with a different EncryptionSecret is refused", () => {
    let other: DelegationTokenClass | null = null;

    jest.isolateModules((): void => {
      jest.doMock("../../../../Server/EnvironmentConfig", (): unknown => {
        return {
          ...(jest.requireActual(
            "../../../../Server/EnvironmentConfig",
          ) as Record<string, unknown>),
          EncryptionSecret: new ObjectID("another-instances-secret"),
        };
      });

      other = (
        jest.requireActual(
          "../../../../Server/Utils/Mcp/McpDelegationToken",
        ) as {
          default: DelegationTokenClass;
        }
      ).default;
    });

    jest.dontMock("../../../../Server/EnvironmentConfig");

    const foreign: string = (other as unknown as DelegationTokenClass).sign(
      claimsWith(),
      NOW,
    );

    expect(
      (other as unknown as DelegationTokenClass).verify(foreign, NOW),
    ).not.toBeNull();
    expect(McpDelegationToken.verify(foreign, NOW)).toBeNull();
  });
});

describe("McpDelegationToken is never a JWT, in either direction", () => {
  test("it is refused as a dashboard session", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);

    expect(() => {
      return JSONWebToken.decode(token);
    }).toThrow("AccessToken is invalid or expired");
    expect(token.startsWith("eyJ")).toBe(false);
  });

  test("a real session JWT for the same member is not a delegation token", () => {
    const sessionToken: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: new ObjectID(USER_ID),
        email: new Email("member@example.com"),
        name: new Name("A Member"),
        timezone: null,
        isMasterAdmin: false,
        isGlobalLogin: true,
        sessionId: ObjectID.generate(),
      },
      expiresInSeconds: 900,
    });

    expect(McpDelegationToken.verify(sessionToken)).toBeNull();
  });

  test("a JWT signed with EncryptionSecret that carries the delegation claims is not one either", () => {
    const lookalike: string = JSONWebToken.signJsonPayload(wireClaims(), 60);

    expect(McpDelegationToken.verify(lookalike)).toBeNull();
  });
});

describe("McpDelegationToken.verify: things that are not tokens", () => {
  const NOT_TOKENS: Array<[string, unknown]> = [
    ["undefined (no header)", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { token: "v1.a.b" }],
    ["an API key", "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"],
    ["an OAuth access token", `oumcp_at_${"A".repeat(43)}`],
    ["garbage in the right shape", `v1.e30.${"A".repeat(43)}`],
  ];

  test.each(NOT_TOKENS)(
    "%s is null, and does not throw",
    (_label: string, value: unknown) => {
      expect(() => {
        return McpDelegationToken.verify(value, NOW);
      }).not.toThrow();
      expect(McpDelegationToken.verify(value, NOW)).toBeNull();
    },
  );

  test("a header sent twice (an array of valid tokens) is refused", () => {
    const token: string = McpDelegationToken.sign(claimsWith(), NOW);

    expect(McpDelegationToken.verify([token, token], NOW)).toBeNull();
    expect(McpDelegationToken.verify([token], NOW)).toBeNull();
  });
});

describe("McpDelegationToken.sign", () => {
  test("throws rather than hand back a token that would not verify", () => {
    // Far past the 4096-character cap of the purpose.
    expect(() => {
      return McpDelegationToken.sign(
        claimsWith({ clientName: "x".repeat(5000) }),
        NOW,
      );
    }).toThrow("MCP delegation token could not be created.");
  });

  test("fits the largest values the columns can hold", () => {
    // A client id is at most 500 characters and a name 100.
    const token: string = McpDelegationToken.sign(
      claimsWith({
        clientId: `https://example.com/${"a".repeat(480)}`,
        clientName: "n".repeat(100),
        userName: "u".repeat(100),
        userEmail: new Email(`${"m".repeat(60)}@${"d".repeat(60)}.example.com`),
      }),
      NOW,
    );

    expect(token.length).toBeLessThanOrEqual(4096);
    expect(McpDelegationToken.verify(token, NOW)).not.toBeNull();
  });
});
