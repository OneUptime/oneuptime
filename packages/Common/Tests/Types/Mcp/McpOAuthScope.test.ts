import McpOAuthScope, {
  McpOAuthScopeUtil,
  ParsedMcpOAuthScope,
} from "../../../Types/Mcp/McpOAuthScope";
import { describe, expect, test } from "@jest/globals";

/*
 * The scope vocabulary of the MCP authorization server.
 *
 * Two things here are security decisions rather than string handling, and the
 * tests are arranged around them:
 *
 *   - WRITE IMPLIES READ, and nothing implies write. A grant that carries
 *     `mcp:write` alone must keep reading (a client that steps up may ask for
 *     only the scope it was challenged with), while no combination of other
 *     scopes may ever be read as permission to change something.
 *   - A refresh may narrow a grant and never widen it (isSubset), so the
 *     comparison has to be right in both directions.
 *
 * The rest pins the wire format: the three scope strings are what clients
 * send and what a challenge names, and the canonical order is what makes two
 * grants with the same access carry the same stored string.
 */

const READ: McpOAuthScope = McpOAuthScope.Read;
const WRITE: McpOAuthScope = McpOAuthScope.Write;
const OFFLINE: McpOAuthScope = McpOAuthScope.OfflineAccess;

// Every combination of the three scopes, each in canonical order.
const ALL_COMBINATIONS: Array<Array<McpOAuthScope>> = [
  [],
  [READ],
  [WRITE],
  [OFFLINE],
  [READ, WRITE],
  [READ, OFFLINE],
  [WRITE, OFFLINE],
  [READ, WRITE, OFFLINE],
];

const NOT_STRINGS: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 42],
  ["a boolean", true],
  ["an array of scope names", ["mcp:read", "mcp:write"]],
  ["an object", { scope: "mcp:write" }],
];

const WELL_FORMED: Array<[string, string]> = [
  ["one scope", "mcp:read"],
  ["several scopes", "mcp:read mcp:write offline_access"],
  ["scopes this server does not issue", "openid profile email"],
  ["a URL-shaped scope", "https://example.com/auth/scope.read"],
  ["the lowest allowed character", "!"],
  ["the characters either side of the quote", "!#"],
  ["the characters either side of the backslash", "[]"],
  ["the highest allowed character", "~"],
];

const MALFORMED: Array<[string, string]> = [
  ["an empty string", ""],
  ["a single space", " "],
  ["a leading space", " mcp:read"],
  ["a trailing space", "mcp:read "],
  ["a double space between tokens", "mcp:read  mcp:write"],
  ["a double quote", 'mcp:"read"'],
  ["a backslash", "mcp:\\read"],
  ["a tab", "mcp:read\tmcp:write"],
  ["a newline", "mcp:read\nmcp:write"],
  ["a carriage return", "mcp:read\r"],
  ["a NUL", "mcp:read\x00"],
  ["DEL", "mcp:read\x7f"],
  ["a non-ASCII letter", "mcp:r\xe9ad"],
  ["a non-breaking space", "mcp:read\xa0mcp:write"],
];

// [label, scopes, canRead, canWrite]
const ACCESS_CASES: Array<[string, Array<McpOAuthScope>, boolean, boolean]> = [
  ["nothing", [], false, false],
  ["read", [READ], true, false],
  ["write alone", [WRITE], true, true],
  ["read and write", [READ, WRITE], true, true],
  ["offline_access alone", [OFFLINE], false, false],
  ["read and offline_access", [READ, OFFLINE], true, false],
  ["write and offline_access", [WRITE, OFFLINE], true, true],
];

describe("McpOAuthScope: the wire values", () => {
  test("are the strings clients send and challenges name", () => {
    expect(McpOAuthScope.Read).toBe("mcp:read");
    expect(McpOAuthScope.Write).toBe("mcp:write");
    expect(McpOAuthScope.OfflineAccess).toBe("offline_access");
  });

  test("there are exactly three scopes", () => {
    expect(Object.values(McpOAuthScope).sort()).toEqual(
      ["mcp:read", "mcp:write", "offline_access"].sort(),
    );
  });

  test("ACCESS_SCOPES is what a member is asked about: read and write, not offline_access", () => {
    expect(McpOAuthScopeUtil.ACCESS_SCOPES).toEqual([READ, WRITE]);
    expect(McpOAuthScopeUtil.ACCESS_SCOPES).not.toContain(OFFLINE);
  });

  test("ALL_SCOPES lists every scope in canonical order", () => {
    expect(McpOAuthScopeUtil.ALL_SCOPES).toEqual([READ, WRITE, OFFLINE]);
  });
});

describe("McpOAuthScopeUtil.parse", () => {
  test("splits a space-delimited string into the scopes this server issues", () => {
    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "mcp:read mcp:write offline_access",
    );

    expect(parsed.scopes).toEqual([READ, WRITE, OFFLINE]);
    expect(parsed.unknownScopes).toEqual([]);
  });

  test("returns the scopes in canonical order whatever order they were sent in", () => {
    expect(
      McpOAuthScopeUtil.parse("offline_access mcp:write mcp:read").scopes,
    ).toEqual([READ, WRITE, OFFLINE]);
    expect(McpOAuthScopeUtil.parse("mcp:write mcp:read").scopes).toEqual([
      READ,
      WRITE,
    ]);
  });

  test("does NOT add read to a write-only string: parse reports what was said", () => {
    expect(McpOAuthScopeUtil.parse("mcp:write").scopes).toEqual([WRITE]);
  });

  test("collapses duplicates", () => {
    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "mcp:read mcp:read mcp:write mcp:read openid openid",
    );

    expect(parsed.scopes).toEqual([READ, WRITE]);
    expect(parsed.unknownScopes).toEqual(["openid"]);
  });

  test("reports the scopes it does not issue separately, in the order sent", () => {
    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "profile mcp:read openid email",
    );

    expect(parsed.scopes).toEqual([READ]);
    expect(parsed.unknownScopes).toEqual(["profile", "openid", "email"]);
  });

  test("ignores the empty tokens that extra spaces produce", () => {
    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "  mcp:read   mcp:write  ",
    );

    expect(parsed.scopes).toEqual([READ, WRITE]);
    expect(parsed.unknownScopes).toEqual([]);
  });

  test("is no scopes at all for an empty or blank string", () => {
    expect(McpOAuthScopeUtil.parse("")).toEqual({
      scopes: [],
      unknownScopes: [],
    });
    expect(McpOAuthScopeUtil.parse("     ")).toEqual({
      scopes: [],
      unknownScopes: [],
    });
  });

  test.each(NOT_STRINGS)(
    "is no scopes at all for %s, and never throws",
    (_label: string, value: unknown) => {
      expect(McpOAuthScopeUtil.parse(value)).toEqual({
        scopes: [],
        unknownScopes: [],
      });
    },
  );

  test("matches a scope name exactly: case, prefix and suffix variants are unknown", () => {
    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "MCP:READ mcp:Write mcp:writes mcp:read: mcp: offline-access",
    );

    expect(parsed.scopes).toEqual([]);
    expect(parsed.unknownScopes).toEqual([
      "MCP:READ",
      "mcp:Write",
      "mcp:writes",
      "mcp:read:",
      "mcp:",
      "offline-access",
    ]);
  });

  test("only a space delimits: a tab or newline joins its neighbours into one unknown token", () => {
    const tabbed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "mcp:read\tmcp:write",
    );

    expect(tabbed.scopes).toEqual([]);
    expect(tabbed.unknownScopes).toEqual(["mcp:read\tmcp:write"]);

    const newlined: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
      "mcp:read\nmcp:write",
    );

    expect(newlined.scopes).toEqual([]);
    expect(McpOAuthScopeUtil.canWrite(newlined.scopes)).toBe(false);
  });

  test("hands back fresh arrays, so a caller cannot corrupt a later parse", () => {
    const first: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse("mcp:read");

    first.scopes.push(WRITE);
    first.unknownScopes.push("injected");

    expect(McpOAuthScopeUtil.parse("mcp:read")).toEqual({
      scopes: [READ],
      unknownScopes: [],
    });
  });
});

describe("McpOAuthScopeUtil.isWellFormed", () => {
  test.each(WELL_FORMED)("accepts %s", (_label: string, value: string) => {
    expect(McpOAuthScopeUtil.isWellFormed(value)).toBe(true);
  });

  test.each(MALFORMED)("refuses %s", (_label: string, value: string) => {
    expect(McpOAuthScopeUtil.isWellFormed(value)).toBe(false);
  });

  test("covers the whole RFC 6749 scope-token range and nothing outside it", () => {
    for (let code: number = 0; code <= 0xff; code++) {
      // The space is the delimiter, not a token character: "a b" is two tokens.
      if (code === 0x20) {
        continue;
      }

      const character: string = String.fromCharCode(code);
      const isScopeCharacter: boolean =
        code === 0x21 ||
        (code >= 0x23 && code <= 0x5b) ||
        (code >= 0x5d && code <= 0x7e);

      expect({
        code,
        wellFormed: McpOAuthScopeUtil.isWellFormed(`a${character}b`),
      }).toEqual({ code, wellFormed: isScopeCharacter });
    }
  });
});

describe("McpOAuthScopeUtil.sort and toString", () => {
  test("sort puts scopes in canonical order: read, write, offline_access", () => {
    expect(McpOAuthScopeUtil.sort([OFFLINE, WRITE, READ])).toEqual([
      READ,
      WRITE,
      OFFLINE,
    ]);
    expect(McpOAuthScopeUtil.sort([WRITE, OFFLINE])).toEqual([WRITE, OFFLINE]);
    expect(McpOAuthScopeUtil.sort([OFFLINE, READ])).toEqual([READ, OFFLINE]);
  });

  test("sort collapses duplicates and adds nothing", () => {
    expect(McpOAuthScopeUtil.sort([WRITE, WRITE, WRITE])).toEqual([WRITE]);
    expect(McpOAuthScopeUtil.sort([])).toEqual([]);
  });

  test("sort leaves its input untouched", () => {
    const input: Array<McpOAuthScope> = [OFFLINE, READ];

    McpOAuthScopeUtil.sort(input);

    expect(input).toEqual([OFFLINE, READ]);
  });

  test("toString is the canonical space-delimited string, the same for any input order", () => {
    expect(McpOAuthScopeUtil.toString([WRITE, READ])).toBe(
      "mcp:read mcp:write",
    );
    expect(McpOAuthScopeUtil.toString([READ, WRITE])).toBe(
      "mcp:read mcp:write",
    );
    expect(McpOAuthScopeUtil.toString([OFFLINE, WRITE, READ])).toBe(
      "mcp:read mcp:write offline_access",
    );
    expect(McpOAuthScopeUtil.toString([READ])).toBe("mcp:read");
    expect(McpOAuthScopeUtil.toString([])).toBe("");
  });

  test("toString and parse round trip", () => {
    for (const scopes of ALL_COMBINATIONS) {
      expect(
        McpOAuthScopeUtil.parse(McpOAuthScopeUtil.toString(scopes)).scopes,
      ).toEqual(scopes);
    }
  });
});

describe("McpOAuthScopeUtil.normalize", () => {
  test("spells write out as read and write", () => {
    expect(McpOAuthScopeUtil.normalize([WRITE])).toEqual([READ, WRITE]);
    expect(McpOAuthScopeUtil.normalize([WRITE, OFFLINE])).toEqual([
      READ,
      WRITE,
      OFFLINE,
    ]);
  });

  test("leaves read and write as they are, in canonical order", () => {
    expect(McpOAuthScopeUtil.normalize([WRITE, READ])).toEqual([READ, WRITE]);
  });

  test("NEVER invents write", () => {
    expect(McpOAuthScopeUtil.normalize([READ])).toEqual([READ]);
    expect(McpOAuthScopeUtil.normalize([READ, OFFLINE])).toEqual([
      READ,
      OFFLINE,
    ]);
    expect(McpOAuthScopeUtil.normalize([OFFLINE])).toEqual([OFFLINE]);
    expect(McpOAuthScopeUtil.normalize([])).toEqual([]);

    for (const scopes of ALL_COMBINATIONS) {
      // Write comes out of normalize exactly when it went in.
      expect(
        McpOAuthScopeUtil.canWrite(McpOAuthScopeUtil.normalize(scopes)),
      ).toBe(scopes.includes(WRITE));
    }
  });

  test("does not invent read either when neither access scope was given", () => {
    expect(McpOAuthScopeUtil.normalize([OFFLINE])).not.toContain(READ);
  });

  test("does not add read twice", () => {
    expect(McpOAuthScopeUtil.normalize([READ, WRITE, READ])).toEqual([
      READ,
      WRITE,
    ]);
  });

  test("leaves its input untouched", () => {
    const input: Array<McpOAuthScope> = [WRITE];

    McpOAuthScopeUtil.normalize(input);

    expect(input).toEqual([WRITE]);
  });
});

describe("McpOAuthScopeUtil.canRead and canWrite", () => {
  test.each(ACCESS_CASES)(
    "%s",
    (
      _label: string,
      scopes: Array<McpOAuthScope>,
      canRead: boolean,
      canWrite: boolean,
    ) => {
      expect(McpOAuthScopeUtil.canRead(scopes)).toBe(canRead);
      expect(McpOAuthScopeUtil.canWrite(scopes)).toBe(canWrite);
    },
  );

  test("write is the only thing that grants write", () => {
    const withoutWrite: Array<Array<McpOAuthScope>> = [
      [],
      [READ],
      [OFFLINE],
      [READ, OFFLINE],
    ];

    for (const scopes of withoutWrite) {
      expect(McpOAuthScopeUtil.canWrite(scopes)).toBe(false);
    }
  });
});

describe("McpOAuthScopeUtil.satisfies", () => {
  test("anything satisfies an empty requirement", () => {
    expect(McpOAuthScopeUtil.satisfies([], [])).toBe(true);
    expect(McpOAuthScopeUtil.satisfies([READ], [])).toBe(true);
  });

  test("a write-only grant satisfies read (write implies read)", () => {
    expect(McpOAuthScopeUtil.satisfies([WRITE], [READ])).toBe(true);
    expect(McpOAuthScopeUtil.satisfies([WRITE], [READ, WRITE])).toBe(true);
  });

  test("read NEVER satisfies write", () => {
    expect(McpOAuthScopeUtil.satisfies([READ], [WRITE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([READ], [READ, WRITE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([READ, OFFLINE], [WRITE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([OFFLINE], [WRITE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([], [WRITE])).toBe(false);
  });

  test("nothing satisfies read except read or write", () => {
    expect(McpOAuthScopeUtil.satisfies([], [READ])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([OFFLINE], [READ])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([READ], [READ])).toBe(true);
  });

  test("offline_access needs offline_access: read and write do not imply it", () => {
    expect(McpOAuthScopeUtil.satisfies([READ, WRITE], [OFFLINE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([WRITE], [OFFLINE])).toBe(false);
    expect(McpOAuthScopeUtil.satisfies([OFFLINE], [OFFLINE])).toBe(true);
    expect(
      McpOAuthScopeUtil.satisfies([READ, WRITE, OFFLINE], [READ, OFFLINE]),
    ).toBe(true);
  });

  test("every required scope has to be covered, not just one of them", () => {
    expect(McpOAuthScopeUtil.satisfies([READ, OFFLINE], [READ, WRITE])).toBe(
      false,
    );
    expect(McpOAuthScopeUtil.satisfies([WRITE], [WRITE, OFFLINE])).toBe(false);
    expect(
      McpOAuthScopeUtil.satisfies([READ, WRITE, OFFLINE], [READ, WRITE]),
    ).toBe(true);
  });
});

describe("McpOAuthScopeUtil.isSubset (what a refresh may ask for)", () => {
  test("a refresh may ask for the same access", () => {
    expect(McpOAuthScopeUtil.isSubset([READ], [READ])).toBe(true);
    expect(McpOAuthScopeUtil.isSubset([READ, WRITE], [READ, WRITE])).toBe(true);
  });

  test("a refresh may narrow: read out of a read-and-write grant", () => {
    expect(McpOAuthScopeUtil.isSubset([READ], [READ, WRITE])).toBe(true);
    expect(McpOAuthScopeUtil.isSubset([], [READ, WRITE])).toBe(true);
  });

  test("a refresh may NEVER widen a read-only grant to write", () => {
    expect(McpOAuthScopeUtil.isSubset([WRITE], [READ])).toBe(false);
    expect(McpOAuthScopeUtil.isSubset([READ, WRITE], [READ])).toBe(false);
    expect(McpOAuthScopeUtil.isSubset([WRITE], [READ, OFFLINE])).toBe(false);
    expect(McpOAuthScopeUtil.isSubset([WRITE], [])).toBe(false);
  });

  test("asking for read out of a write-only grant is not widening", () => {
    expect(McpOAuthScopeUtil.isSubset([READ], [WRITE])).toBe(true);
  });

  test("offline_access cannot be added by a refresh that was not granted it", () => {
    expect(McpOAuthScopeUtil.isSubset([READ, OFFLINE], [READ])).toBe(false);
    expect(McpOAuthScopeUtil.isSubset([READ, OFFLINE], [READ, OFFLINE])).toBe(
      true,
    );
  });

  test("is satisfies() with the arguments the other way round", () => {
    for (const candidate of ALL_COMBINATIONS) {
      for (const granted of ALL_COMBINATIONS) {
        expect(McpOAuthScopeUtil.isSubset(candidate, granted)).toBe(
          McpOAuthScopeUtil.satisfies(granted, candidate),
        );
      }
    }
  });

  test("what a stored grant string covers is decided after normalizing nothing: the raw scopes are compared", () => {
    /*
     * A grant stores "mcp:read mcp:write" for a client that asked for write
     * (normalize runs before it is stored), and the refresh request is parsed
     * raw. Both spellings of the same access have to be accepted.
     */
    const granted: Array<McpOAuthScope> =
      McpOAuthScopeUtil.parse("mcp:read mcp:write").scopes;

    expect(
      McpOAuthScopeUtil.isSubset(
        McpOAuthScopeUtil.parse("mcp:write").scopes,
        granted,
      ),
    ).toBe(true);
    expect(
      McpOAuthScopeUtil.isSubset(
        McpOAuthScopeUtil.parse("mcp:write mcp:read").scopes,
        granted,
      ),
    ).toBe(true);
  });
});
