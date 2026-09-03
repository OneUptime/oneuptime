import OriginAllowList from "../../../Utils/Telemetry/OriginAllowList";
import { describe, expect, test } from "@jest/globals";

/*
 * OriginAllowList is the entire security boundary of a Browser telemetry
 * ingestion key. The key itself is published in page source on purpose; the
 * only thing stopping anyone who reads it from writing into the customer's
 * project is whether their page's Origin is on this list. So the exact shape
 * of `matches` is not a convenience - it is the authorization decision.
 *
 * Four properties are pinned here, because getting any of them wrong is
 * silently exploitable rather than loudly broken:
 *
 *   1. An EMPTY allowlist matches nothing. `matches` must never read empty as
 *      "allow anything". The two callers need opposite defaults (session
 *      replay treats empty as open, a Browser ingestion key treats it as
 *      closed), so that decision lives in the callers and this function only
 *      ever reports "this list matched nothing". If empty ever started
 *      answering true here, every Browser key with a cleared or misconfigured
 *      list would become the unscoped public credential this whole feature
 *      exists to retire.
 *
 *   2. The "*." wildcard names SUBDOMAINS and nothing else. The suffix keeps
 *      its leading dot, so "https://*.example.com" must not match
 *      "https://evilexample.com" - a domain an attacker can simply register.
 *      A length check keeps it off the bare apex too. Both are load-bearing.
 *
 *   3. Normalization is forgiving in exactly one direction: trim, lowercase,
 *      strip trailing slashes. It never drops a path, a port or a scheme,
 *      because each of those is part of the origin and dropping one widens
 *      the allowlist past what the customer wrote.
 *
 *   4. validateOriginPattern and matches must not drift. Anything the
 *      validator calls valid has to actually match the origins it plainly
 *      describes, and anything matches cannot express (a wildcard outside the
 *      first label, say) has to be refused at configuration time with a
 *      message a human can act on - otherwise a customer saves an entry that
 *      looks fine and loses production telemetry until someone reads this
 *      file. The sweep at the bottom enforces that pairing.
 */

interface ValidPatternCase {
  name: string;
  pattern: string;
  /*
   * An origin this pattern plainly describes. The sweep asserts both that the
   * validator accepts the pattern and that the matcher covers this origin
   * with it, so the two halves cannot drift apart.
   */
  coveredOrigin: string;
}

interface InvalidPatternCase {
  name: string;
  pattern: string;
  /*
   * A distinctive fragment of the message a customer reads in the Dashboard
   * form. Asserted so the reason stays specific to the mistake rather than
   * collapsing into a generic "invalid".
   */
  expectedMessageFragment: string;
}

/*
 * Every pattern the module's own accept table says is legal, paired with an
 * origin it must cover.
 */
const VALID_PATTERNS: Array<ValidPatternCase> = [
  {
    name: "an exact https origin",
    pattern: "https://app.example.com",
    coveredOrigin: "https://app.example.com",
  },
  {
    name: "an http origin",
    pattern: "http://app.example.com",
    coveredOrigin: "http://app.example.com",
  },
  {
    name: "an explicit port",
    pattern: "http://localhost:3000",
    coveredOrigin: "http://localhost:3000",
  },
  {
    name: "a bare localhost host",
    pattern: "http://localhost",
    coveredOrigin: "http://localhost",
  },
  {
    name: "an IPv4 literal host with a port",
    pattern: "http://127.0.0.1:8080",
    coveredOrigin: "http://127.0.0.1:8080",
  },
  {
    name: "a leading host wildcard",
    pattern: "https://*.example.com",
    coveredOrigin: "https://tenant.example.com",
  },
  {
    name: "a leading host wildcard with a port",
    pattern: "https://*.example.com:8443",
    coveredOrigin: "https://tenant.example.com:8443",
  },
  {
    name: "a wildcard over a single-label dev suffix",
    pattern: "http://*.localhost",
    coveredOrigin: "http://tenant.localhost",
  },
  {
    name: "one trailing slash",
    pattern: "https://app.example.com/",
    coveredOrigin: "https://app.example.com",
  },
  {
    name: "surrounding whitespace",
    pattern: "   https://padded.example.com   ",
    coveredOrigin: "https://padded.example.com",
  },
  {
    name: "an uppercase scheme and host",
    pattern: "HTTPS://APP.EXAMPLE.COM",
    coveredOrigin: "https://app.example.com",
  },
];

/*
 * Every pattern the module's own reject table refuses. One case per row, and
 * each asserts a specific, actionable message - see assertActionableMessage.
 */
const INVALID_PATTERNS: Array<InvalidPatternCase> = [
  {
    name: "an empty string",
    pattern: "",
    expectedMessageFragment: "empty",
  },
  {
    name: "whitespace only",
    pattern: "    ",
    expectedMessageFragment: "empty",
  },
  {
    name: "no scheme",
    pattern: "app.example.com",
    expectedMessageFragment: "https://",
  },
  {
    name: "an ftp scheme",
    pattern: "ftp://example.com",
    expectedMessageFragment: "scheme",
  },
  {
    name: "a websocket scheme",
    pattern: "ws://example.com",
    expectedMessageFragment: "scheme",
  },
  {
    name: "userinfo in the authority",
    pattern: "https://user@example.com",
    expectedMessageFragment: "username",
  },
  {
    name: "a path",
    pattern: "https://example.com/x",
    expectedMessageFragment: "path",
  },
  {
    name: "a query string",
    pattern: "https://example.com?a=b",
    expectedMessageFragment: "query",
  },
  {
    name: "a fragment",
    pattern: "https://example.com#frag",
    expectedMessageFragment: "fragment",
  },
  {
    name: "two trailing slashes",
    pattern: "https://example.com//",
    expectedMessageFragment: "path",
  },
  {
    name: "a bare wildcard host",
    pattern: "https://*",
    expectedMessageFragment: "wildcard",
  },
  {
    name: "a wildcard with no suffix",
    pattern: "https://*.",
    expectedMessageFragment: "wildcard",
  },
  {
    name: "a wildcard outside the first label",
    pattern: "https://a.*.example.com",
    expectedMessageFragment: "wildcard",
  },
  {
    name: "a wildcard not followed by a dot",
    pattern: "https://*example.com",
    expectedMessageFragment: "wildcard",
  },
  {
    name: "interior whitespace",
    pattern: "https://exa mple.com",
    expectedMessageFragment: "spaces",
  },
  {
    name: "port 0",
    pattern: "https://example.com:0",
    expectedMessageFragment: "port",
  },
  {
    name: "port 70000",
    pattern: "https://example.com:70000",
    expectedMessageFragment: "port",
  },
  {
    name: "a non-numeric port",
    pattern: "https://example.com:abc",
    expectedMessageFragment: "port",
  },
  {
    name: "an empty host label",
    pattern: "https://example..com",
    expectedMessageFragment: "empty part",
  },
  {
    name: "a host label starting with a hyphen",
    pattern: "https://-example.com",
    expectedMessageFragment: '"-"',
  },
  {
    name: "a host label ending with a hyphen",
    pattern: "https://example-.com",
    expectedMessageFragment: '"-"',
  },
  {
    name: "an illegal host character",
    pattern: "https://exa_mple.com",
    expectedMessageFragment: "not valid in a host name",
  },
];

/*
 * A rejection message is shown verbatim to a customer trying to save an
 * allowlist entry, so a bare "invalid" is a bug even though it is
 * technically a non-empty string. Every message has to name the problem.
 */
const assertActionableMessage: (message: string | null) => void = (
  message: string | null,
): void => {
  expect(typeof message).toBe("string");

  const text: string = String(message);

  expect(text.trim().length).toBeGreaterThan(0);

  const bare: string = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");

  expect(bare).not.toBe("invalid");
  expect(bare).not.toBe("invalid origin");
  expect(bare).not.toBe("invalid origin pattern");
  expect(bare).not.toBe("error");

  // Real guidance is a sentence, not a word.
  expect(text.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
};

describe("OriginAllowList.normalizeOrigin", () => {
  test("trims surrounding whitespace", () => {
    expect(
      OriginAllowList.normalizeOrigin("   https://app.example.com   "),
    ).toBe("https://app.example.com");
  });

  test("lowercases the scheme and the host", () => {
    expect(OriginAllowList.normalizeOrigin("HTTPS://APP.EXAMPLE.COM")).toBe(
      "https://app.example.com",
    );
  });

  test("strips a single trailing slash", () => {
    expect(OriginAllowList.normalizeOrigin("https://app.example.com/")).toBe(
      "https://app.example.com",
    );
  });

  test("strips every trailing slash, not just one", () => {
    expect(OriginAllowList.normalizeOrigin("https://app.example.com///")).toBe(
      "https://app.example.com",
    );
  });

  test("returns an empty string for a blank input", () => {
    expect(OriginAllowList.normalizeOrigin("")).toBe("");
  });

  test("returns an empty string for whitespace only", () => {
    expect(OriginAllowList.normalizeOrigin("   \t\n  ")).toBe("");
  });

  test("leaves an already-normal origin unchanged", () => {
    expect(OriginAllowList.normalizeOrigin("https://app.example.com")).toBe(
      "https://app.example.com",
    );
  });

  test("handles mixed whitespace around an uppercase origin with a trailing slash", () => {
    expect(
      OriginAllowList.normalizeOrigin("\t  HTTPS://App.Example.COM/  \n"),
    ).toBe("https://app.example.com");
  });

  test("keeps the port, which is part of the origin", () => {
    expect(
      OriginAllowList.normalizeOrigin("HTTPS://App.Example.com:8443/"),
    ).toBe("https://app.example.com:8443");
  });

  test("returns an empty string for a non-string input rather than throwing", () => {
    expect(
      OriginAllowList.normalizeOrigin(undefined as unknown as string),
    ).toBe("");
  });
});

describe("OriginAllowList.matches - origins that are allowed", () => {
  test("an exact origin matches its own allowlist entry", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "https://app.example.com",
      ]),
    ).toBe(true);
  });

  test("matching is case-insensitive on the origin side", () => {
    expect(
      OriginAllowList.matches("HTTPS://APP.EXAMPLE.COM", [
        "https://app.example.com",
      ]),
    ).toBe(true);
  });

  test("matching is case-insensitive on the allowlist side", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "HTTPS://APP.EXAMPLE.COM",
      ]),
    ).toBe(true);
  });

  test("a whitespace-padded allowlist entry still matches", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "   https://app.example.com  ",
      ]),
    ).toBe(true);
  });

  test("an origin whose port equals the entry's port is allowed", () => {
    expect(
      OriginAllowList.matches("https://app.example.com:8443", [
        "https://app.example.com:8443",
      ]),
    ).toBe(true);
  });

  test("a wildcard entry covers a one-label subdomain", () => {
    expect(
      OriginAllowList.matches("https://a.example.com", [
        "https://*.example.com",
      ]),
    ).toBe(true);
  });

  test("a wildcard entry covers a deeper subdomain", () => {
    expect(
      OriginAllowList.matches("https://a.b.example.com", [
        "https://*.example.com",
      ]),
    ).toBe(true);
  });

  test("a wildcard entry with a port covers a subdomain on that port", () => {
    expect(
      OriginAllowList.matches("https://a.example.com:8443", [
        "https://*.example.com:8443",
      ]),
    ).toBe(true);
  });

  test("a trailing slash on the allowlist entry does not stop a slashless origin from matching", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "https://app.example.com/",
      ]),
    ).toBe(true);
  });

  test("a trailing slash on the origin does not stop a slashless allowlist entry from matching", () => {
    expect(
      OriginAllowList.matches("https://app.example.com/", [
        "https://app.example.com",
      ]),
    ).toBe(true);
  });

  test("a match anywhere in a multi-entry allowlist is enough", () => {
    expect(
      OriginAllowList.matches("https://c.example.com", [
        "https://a.example.com",
        "   ",
        "https://c.example.com",
      ]),
    ).toBe(true);
  });
});

describe("OriginAllowList.matches - origins that are refused", () => {
  /*
   * The security-critical one. An empty list must report "nothing matched",
   * never "everything matches" - the Browser ingest path relies on this to
   * refuse a key whose allowlist was cleared.
   */
  test("an empty allowlist allows nothing, and is never read as allow-anything", () => {
    expect(OriginAllowList.matches("https://app.example.com", [])).toBe(false);
  });

  test("an allowlist of only blank strings allows nothing", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", ["", "   ", "\t"]),
    ).toBe(false);
  });

  test("an undefined origin is refused", () => {
    expect(
      OriginAllowList.matches(undefined, ["https://app.example.com"]),
    ).toBe(false);
  });

  test("a null origin is refused", () => {
    expect(OriginAllowList.matches(null, ["https://app.example.com"])).toBe(
      false,
    );
  });

  test("a blank origin is refused", () => {
    expect(OriginAllowList.matches("", ["https://app.example.com"])).toBe(
      false,
    );
  });

  test("a whitespace-only origin is refused", () => {
    expect(OriginAllowList.matches("   \t ", ["https://app.example.com"])).toBe(
      false,
    );
  });

  test("http does not match an https entry - there is no scheme wildcard", () => {
    expect(
      OriginAllowList.matches("http://app.example.com", [
        "https://app.example.com",
      ]),
    ).toBe(false);
  });

  test("https does not match an http entry", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "http://app.example.com",
      ]),
    ).toBe(false);
  });

  test("a different port is a different origin", () => {
    expect(
      OriginAllowList.matches("https://app.example.com:8443", [
        "https://app.example.com:9443",
      ]),
    ).toBe(false);
  });

  test("an origin with no port does not match an entry that pins :443", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        "https://app.example.com:443",
      ]),
    ).toBe(false);
  });

  test("an origin on :443 does not match a portless entry", () => {
    expect(
      OriginAllowList.matches("https://app.example.com:443", [
        "https://app.example.com",
      ]),
    ).toBe(false);
  });

  test("a different host is refused", () => {
    expect(
      OriginAllowList.matches("https://other.example.com", [
        "https://app.example.com",
      ]),
    ).toBe(false);
  });

  /*
   * A wildcard names subdomains. The customer who wrote "*.example.com" did
   * not list the apex, and the length check in matches is what keeps it out.
   */
  test("a wildcard entry does not match the bare apex domain", () => {
    expect(
      OriginAllowList.matches("https://example.com", ["https://*.example.com"]),
    ).toBe(false);
  });

  /*
   * THE case this module exists for: the suffix keeps its leading dot, so a
   * domain an attacker can register cannot ride in on a customer's wildcard.
   */
  test("a wildcard entry does not match an attacker-registrable lookalike domain", () => {
    expect(
      OriginAllowList.matches("https://evilexample.com", [
        "https://*.example.com",
      ]),
    ).toBe(false);
  });

  test("a wildcard entry does not match a lookalike domain that has a subdomain of its own", () => {
    expect(
      OriginAllowList.matches("https://a.evilexample.com", [
        "https://*.example.com",
      ]),
    ).toBe(false);
  });

  test("a wildcard entry does not relax the scheme", () => {
    expect(
      OriginAllowList.matches("http://a.example.com", [
        "https://*.example.com",
      ]),
    ).toBe(false);
  });

  test("a wildcard entry does not relax the port", () => {
    expect(
      OriginAllowList.matches("https://a.example.com", [
        "https://*.example.com:8443",
      ]),
    ).toBe(false);
  });

  test("an origin carrying a path is refused - normalization never strips a path", () => {
    expect(
      OriginAllowList.matches("https://app.example.com/dashboard", [
        "https://app.example.com",
      ]),
    ).toBe(false);
  });

  test("an origin carrying a path is refused by a wildcard entry too", () => {
    expect(
      OriginAllowList.matches("https://a.example.com/dashboard", [
        "https://*.example.com",
      ]),
    ).toBe(false);
  });

  test("non-string allowlist entries are skipped rather than matched or thrown on", () => {
    expect(
      OriginAllowList.matches("https://app.example.com", [
        null as unknown as string,
        123 as unknown as string,
      ]),
    ).toBe(false);
  });
});

describe("OriginAllowList.validateOriginPattern - accepted patterns", () => {
  for (const validCase of VALID_PATTERNS) {
    test(`accepts ${validCase.name}`, () => {
      expect(
        OriginAllowList.validateOriginPattern(validCase.pattern),
      ).toBeNull();
    });
  }
});

describe("OriginAllowList.validateOriginPattern - rejected patterns", () => {
  for (const invalidCase of INVALID_PATTERNS) {
    test(`rejects ${invalidCase.name} with a reason a customer can act on`, () => {
      const message: string | null = OriginAllowList.validateOriginPattern(
        invalidCase.pattern,
      );

      expect(message).not.toBeNull();
      assertActionableMessage(message);
      expect(String(message).toLowerCase()).toContain(
        invalidCase.expectedMessageFragment.toLowerCase(),
      );
    });
  }

  test("rejects a non-string pattern rather than throwing", () => {
    const message: string | null = OriginAllowList.validateOriginPattern(
      undefined as unknown as string,
    );

    expect(message).not.toBeNull();
    assertActionableMessage(message);
  });
});

/*
 * The anti-drift sweep. A pattern the validator blesses has to be a pattern
 * the matcher can actually honour; if these two ever disagree, a customer
 * saves an entry the form called good and then loses telemetry with no error
 * anywhere.
 */
describe("OriginAllowList validator and matcher agree", () => {
  for (const validCase of VALID_PATTERNS) {
    test(`${validCase.name} both validates and matches the origin it describes`, () => {
      expect(
        OriginAllowList.validateOriginPattern(validCase.pattern),
      ).toBeNull();
      expect(
        OriginAllowList.matches(validCase.coveredOrigin, [validCase.pattern]),
      ).toBe(true);
    });
  }
});
