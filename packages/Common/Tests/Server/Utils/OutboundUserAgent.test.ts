import OutboundUserAgent, {
  OUTBOUND_USER_AGENT_HEADER_NAME,
  OUTBOUND_USER_AGENT_PRODUCT,
  OUTBOUND_USER_AGENT_URL,
} from "../../../Server/Utils/OutboundUserAgent";
import Dictionary from "../../../Types/Dictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * The outbound identity contract. Two things matter to the servers on the
 * far end of a threat-intel feed or a data source: that the UA names this
 * product (so it can be allowlisted rather than blocked as an anonymous
 * HTTP library — issue #3555), and that whatever a deployment put in
 * APP_VERSION can never turn a header into two headers.
 */

// OneUptime, an optional /version, then the URL comment. Nothing else.
const USER_AGENT_FORMAT: RegExp =
  /^OneUptime(?:\/[A-Za-z0-9._+-]+)? \(\+https:\/\/oneuptime\.com\)$/;

describe("OutboundUserAgent.build — format", () => {
  test("a known version renders as product/version plus the URL comment", () => {
    expect(OutboundUserAgent.build("8.0.1234")).toBe(
      "OneUptime/8.0.1234 (+https://oneuptime.com)",
    );
  });

  test("every build output matches the RFC 9110 product + comment shape", () => {
    const versions: Array<string | undefined> = [
      "8.0.1234",
      "1.0.0-rc.1+build.5",
      undefined,
      "",
      "   ",
      "unknown",
      "!!!",
    ];

    for (const version of versions) {
      expect(OutboundUserAgent.build(version)).toMatch(USER_AGENT_FORMAT);
    }
  });

  test("semver prerelease and build metadata survive intact", () => {
    expect(OutboundUserAgent.build("1.0.0-rc.1+build.5")).toBe(
      "OneUptime/1.0.0-rc.1+build.5 (+https://oneuptime.com)",
    );
  });

  test("surrounding whitespace on the version is trimmed, not embedded", () => {
    expect(OutboundUserAgent.build("  7.1.2  ")).toBe(
      "OneUptime/7.1.2 (+https://oneuptime.com)",
    );
  });

  test("an unset version drops the version rather than printing one", () => {
    const expected: string = "OneUptime (+https://oneuptime.com)";

    expect(OutboundUserAgent.build(undefined)).toBe(expected);
    expect(OutboundUserAgent.build("")).toBe(expected);
    expect(OutboundUserAgent.build("   ")).toBe(expected);
  });

  test('the "unknown" APP_VERSION sentinel never reaches the wire, in any casing', () => {
    const expected: string = "OneUptime (+https://oneuptime.com)";

    expect(OutboundUserAgent.build("unknown")).toBe(expected);
    expect(OutboundUserAgent.build("Unknown")).toBe(expected);
    expect(OutboundUserAgent.build("UNKNOWN")).toBe(expected);
    expect(OutboundUserAgent.build("  unknown  ")).toBe(expected);
  });

  test("a version made only of disallowed characters degrades to the bare product", () => {
    expect(OutboundUserAgent.build('()<>@,;:\\"/[]?={} \t')).toBe(
      "OneUptime (+https://oneuptime.com)",
    );
  });

  test("the composed string uses the exported product and URL constants", () => {
    const userAgent: string = OutboundUserAgent.build("2.0.0");

    expect(userAgent.startsWith(`${OUTBOUND_USER_AGENT_PRODUCT}/`)).toBe(true);
    expect(userAgent).toContain(`(+${OUTBOUND_USER_AGENT_URL})`);
  });

  test("it never identifies as a bare HTTP library", () => {
    expect(OutboundUserAgent.build("8.0.1234").toLowerCase()).not.toContain(
      "axios",
    );
  });
});

describe("OutboundUserAgent.sanitizeVersion — header safety", () => {
  test("CR, LF and other header-injection characters are stripped", () => {
    const injected: string = "1.0\r\nX-Injected: yes";

    expect(OutboundUserAgent.sanitizeVersion(injected)).toBe(
      "1.0X-Injectedyes",
    );

    const userAgent: string = OutboundUserAgent.build(injected);
    expect(userAgent).not.toContain("\r");
    expect(userAgent).not.toContain("\n");
    expect(userAgent.split("\n")).toHaveLength(1);
    expect(userAgent).toMatch(USER_AGENT_FORMAT);
  });

  test("a null byte and control characters cannot survive into the header", () => {
    const userAgent: string = OutboundUserAgent.build("1.0\u0000\u0007\u007F");

    expect(userAgent).toBe("OneUptime/1.0 (+https://oneuptime.com)");
  });

  test("spaces inside the version are removed so the token stays one token", () => {
    expect(OutboundUserAgent.build("8.0 (evil comment)")).toBe(
      "OneUptime/8.0evilcomment (+https://oneuptime.com)",
    );
  });

  test("an absurdly long version is capped at 64 characters", () => {
    const sanitized: string = OutboundUserAgent.sanitizeVersion(
      "9".repeat(500),
    );

    expect(sanitized).toHaveLength(64);
    expect(OutboundUserAgent.build("9".repeat(500))).toMatch(USER_AGENT_FORMAT);
  });

  test("the cap counts sanitized characters, not raw input", () => {
    // 200 spaces between two digits: only the digits survive the filter.
    expect(OutboundUserAgent.sanitizeVersion(`1${" ".repeat(200)}2`)).toBe(
      "12",
    );
  });

  test("every character it keeps is an RFC 9110 token character", () => {
    const sanitized: string = OutboundUserAgent.sanitizeVersion(
      "aZ0._+-/\\|`~!@#$%^&*(){}[]<>?,;:'\"= \t\r\n",
    );

    expect(sanitized).toBe("aZ0._+-");
  });
});

describe("OutboundUserAgent.get — this instance's identity", () => {
  test("matches the documented shape and names the product", () => {
    const userAgent: string = OutboundUserAgent.get();

    expect(userAgent).toMatch(USER_AGENT_FORMAT);
    expect(userAgent.startsWith(OUTBOUND_USER_AGENT_PRODUCT)).toBe(true);
  });

  test("is never axios' default, which is the whole point", () => {
    expect(OutboundUserAgent.get().toLowerCase()).not.toContain("axios");
  });

  test("is a single-line, non-empty header value", () => {
    const userAgent: string = OutboundUserAgent.get();

    expect(userAgent.trim()).not.toBe("");
    expect(userAgent).not.toMatch(/[\r\n]/);
  });
});

describe("OutboundUserAgent.hasUserAgent", () => {
  test("no headers at all counts as absent", () => {
    expect(OutboundUserAgent.hasUserAgent(undefined)).toBe(false);
    expect(OutboundUserAgent.hasUserAgent({})).toBe(false);
  });

  test("finds the header whatever its casing", () => {
    expect(OutboundUserAgent.hasUserAgent({ "User-Agent": "mine" })).toBe(true);
    expect(OutboundUserAgent.hasUserAgent({ "user-agent": "mine" })).toBe(true);
    expect(OutboundUserAgent.hasUserAgent({ "USER-AGENT": "mine" })).toBe(true);
    expect(OutboundUserAgent.hasUserAgent({ "uSeR-aGeNt": "mine" })).toBe(true);
  });

  test("a blank value counts as absent — an empty UA is no UA", () => {
    expect(OutboundUserAgent.hasUserAgent({ "User-Agent": "" })).toBe(false);
    expect(OutboundUserAgent.hasUserAgent({ "user-agent": "   " })).toBe(false);
  });

  test("a header that merely contains the name does not count", () => {
    expect(OutboundUserAgent.hasUserAgent({ "X-User-Agent": "mine" })).toBe(
      false,
    );
    expect(OutboundUserAgent.hasUserAgent({ "User-Agent-Hint": "mine" })).toBe(
      false,
    );
  });
});

describe("OutboundUserAgent.withDefault", () => {
  test("adds the User-Agent when the caller sent none", () => {
    expect(OutboundUserAgent.withDefault(undefined)).toEqual({
      [OUTBOUND_USER_AGENT_HEADER_NAME]: OutboundUserAgent.get(),
    });
    expect(OutboundUserAgent.withDefault({})).toEqual({
      [OUTBOUND_USER_AGENT_HEADER_NAME]: OutboundUserAgent.get(),
    });
  });

  test("keeps every other header the caller set", () => {
    const headers: Dictionary<string> = OutboundUserAgent.withDefault({
      Accept: "application/taxii+json;version=2.1",
      Authorization: "Bearer secret-token",
    });

    expect(headers["Accept"]).toBe("application/taxii+json;version=2.1");
    expect(headers["Authorization"]).toBe("Bearer secret-token");
    expect(headers[OUTBOUND_USER_AGENT_HEADER_NAME]).toBe(
      OutboundUserAgent.get(),
    );
  });

  test("an explicit User-Agent wins and is not duplicated", () => {
    const headers: Dictionary<string> = OutboundUserAgent.withDefault({
      "User-Agent": "AcmeSOC/3.1 (soc@acme.example)",
    });

    expect(headers).toEqual({ "User-Agent": "AcmeSOC/3.1 (soc@acme.example)" });
  });

  test("an explicit lowercase user-agent wins without a second casing being added", () => {
    const headers: Dictionary<string> = OutboundUserAgent.withDefault({
      "user-agent": "AcmeSOC/3.1",
    });

    expect(headers).toEqual({ "user-agent": "AcmeSOC/3.1" });
    expect(Object.keys(headers)).toHaveLength(1);
  });

  test("a blank User-Agent is replaced rather than left beside ours", () => {
    const headers: Dictionary<string> = OutboundUserAgent.withDefault({
      "user-agent": "  ",
      Accept: "application/json",
    });

    const userAgentKeys: Array<string> = Object.keys(headers).filter(
      (key: string): boolean => {
        return key.toLowerCase() === "user-agent";
      },
    );

    expect(userAgentKeys).toEqual(["User-Agent"]);
    expect(headers["User-Agent"]).toBe(OutboundUserAgent.get());
    expect(headers["Accept"]).toBe("application/json");
  });

  test("the caller's dictionary is never mutated", () => {
    const original: Dictionary<string> = { Accept: "application/json" };

    OutboundUserAgent.withDefault(original);

    expect(original).toEqual({ Accept: "application/json" });
  });

  test("the value it adds is this instance's User-Agent, not a library default", () => {
    const headers: Dictionary<string> = OutboundUserAgent.withDefault({});

    expect(headers[OUTBOUND_USER_AGENT_HEADER_NAME]).toMatch(USER_AGENT_FORMAT);
    expect(
      (headers[OUTBOUND_USER_AGENT_HEADER_NAME] as string).toLowerCase(),
    ).not.toContain("axios");
  });
});
