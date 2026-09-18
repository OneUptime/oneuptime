import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * "tel:" and "sms:" are opaque schemes: what follows the colon is a phone
 * number, not an authority. Before they were known to the parser, a status
 * page footer link of "tel:3136361710" fell through to the https default,
 * was read as host "tel" + port "3136361710", and toString() normalised it
 * on save into "https://tel:3136361710/". These tests pin the parse, the
 * round-trip, and the rule that nothing in an opaque payload may look like an
 * authority or a path.
 */

describe("URL — tel: and sms: are parsed as opaque schemes", () => {
  const validTelUrls: Array<[string, string]> = [
    // [input, expected opaque value]
    ["tel:+13136361710", "+13136361710"],
    ["tel:3136361710", "3136361710"],
    ["tel:+1-313-636-1710", "+1-313-636-1710"],
    ["tel:+1.313.636.1710", "+1.313.636.1710"],
    // RFC 3966 allows a number to open on a visual separator.
    ["tel:(313)636-1710", "(313)636-1710"],
    ["tel:+1(313)636-1710", "+1(313)636-1710"],
    ["tel:-5550123", "-5550123"],
    ["tel:911", "911"],
    ["tel:+442071838750", "+442071838750"],
    // RFC 3966 parameters.
    ["tel:3136361710;phone-context=+1", "3136361710;phone-context=+1"],
    ["tel:+13136361710;ext=42", "+13136361710;ext=42"],
  ];

  test.each(validTelUrls)(
    "parses %s as a tel: URL with no hostname",
    (input: string, expectedValue: string) => {
      const url: URL = URL.fromString(input);

      expect(url.protocol).toBe(Protocol.TEL);
      expect(url.opaqueValue).toBe(expectedValue);
      expect(url.isMalformed()).toBe(false);
      // An opaque URL has no authority — nothing can read a host off it.
      expect(url.hostname).toBeUndefined();
    },
  );

  test.each(validTelUrls)(
    "round-trips %s unchanged through toString()",
    (input: string) => {
      expect(URL.fromString(input).toString()).toBe(input);
    },
  );

  test("parses sms: the same way", () => {
    const url: URL = URL.fromString("sms:+15555550123");

    expect(url.protocol).toBe(Protocol.SMS);
    expect(url.opaqueValue).toBe("+15555550123");
    expect(url.toString()).toBe("sms:+15555550123");
  });

  test("sms: accepts several comma-separated recipients", () => {
    const url: URL = URL.fromString("sms:+15555550123,+15555550124");

    expect(url.opaqueValue).toBe("+15555550123,+15555550124");
    expect(url.toString()).toBe("sms:+15555550123,+15555550124");
  });

  test("sms: keeps a body query string", () => {
    const url: URL = URL.fromString("sms:+15555550123?body=hello");

    expect(url.protocol).toBe(Protocol.SMS);
    expect(url.opaqueValue).toBe("+15555550123");
    expect(url.getQueryParam("body")).toBe("hello");
    expect(url.toString()).toBe("sms:+15555550123?body=hello");
  });

  test("scheme match is case-insensitive, per RFC 3986", () => {
    expect(URL.fromString("TEL:+13136361710").protocol).toBe(Protocol.TEL);
    expect(URL.fromString("Tel:+13136361710").opaqueValue).toBe("+13136361710");
    expect(URL.fromString("SMS:+15555550123").protocol).toBe(Protocol.SMS);
  });

  test("isOpaqueProtocol identifies exactly tel: and sms:", () => {
    expect(URL.isOpaqueProtocol(Protocol.TEL)).toBe(true);
    expect(URL.isOpaqueProtocol(Protocol.SMS)).toBe(true);
    expect(URL.isOpaqueProtocol(Protocol.HTTPS)).toBe(false);
    expect(URL.isOpaqueProtocol(Protocol.HTTP)).toBe(false);
    expect(URL.isOpaqueProtocol(Protocol.MAIL)).toBe(false);
    expect(URL.isOpaqueProtocol(Protocol.WS)).toBe(false);
    expect(URL.isOpaqueProtocol(Protocol.WSS)).toBe(false);
    expect(URL.isOpaqueProtocol(Protocol.MONGO_DB)).toBe(false);
  });

  test("the constructor also takes the opaque path", () => {
    const url: URL = new URL(Protocol.TEL, "+13136361710");

    expect(url.opaqueValue).toBe("+13136361710");
    expect(url.hostname).toBeUndefined();
    expect(url.toString()).toBe("tel:+13136361710");
  });

  test("isHttps() is false for an opaque URL", () => {
    expect(URL.fromString("tel:+13136361710").isHttps()).toBe(false);
    expect(URL.fromString("sms:+15555550123").isHttps()).toBe(false);
  });
});

/*
 * The regression this whole change exists for: the value a customer typed
 * must survive a save/read cycle instead of being rewritten into a bogus
 * https URL that a later, stricter Hostname validator then refuses to read.
 */
describe("URL — tel: is no longer mangled into an https URL", () => {
  test("tel:3136361710 does not become https://tel:3136361710/", () => {
    const url: URL = URL.fromString("tel:3136361710");

    expect(url.toString()).toBe("tel:3136361710");
    expect(url.toString()).not.toBe("https://tel:3136361710/");
    expect(url.protocol).not.toBe(Protocol.HTTPS);
  });

  test("the value survives the database round-trip", () => {
    const transformer: {
      to: (value: unknown) => unknown;
      from: (value: unknown) => unknown;
    } = URL.getDatabaseTransformer() as {
      to: (value: unknown) => unknown;
      from: (value: unknown) => unknown;
    };

    const stored: unknown = transformer.to(URL.fromString("tel:3136361710"));
    expect(stored).toBe("tel:3136361710");

    const readBack: URL = transformer.from(stored) as URL;
    expect(readBack.toString()).toBe("tel:3136361710");
    expect(readBack.isMalformed()).toBe(false);
  });

  test("the value survives the JSON round-trip to the browser", () => {
    const url: URL = URL.fromString("tel:+13136361710");
    const revived: URL = URL.fromJSON(url.toJSON());

    expect(revived.toString()).toBe("tel:+13136361710");
    expect(revived.protocol).toBe(Protocol.TEL);
    expect(revived.isMalformed()).toBe(false);
  });
});

describe("URL — an opaque payload may not smuggle an authority or path", () => {
  const invalidOpaquePayloads: Array<string> = [
    // Empty.
    "tel:",
    "sms:",
    // Not a number at all.
    "tel:abc",
    "tel:not-a-phone",
    // Path traversal / a path of any kind.
    "tel:../../etc/passwd",
    "tel:1/../../admin",
    "tel:+1555/path",
    // An authority smuggled behind the number.
    "tel:1@evil.example.com",
    "tel:+15555550123@169.254.169.254",
    "sms:1@evil.example.com",
    // A fragment.
    "tel:1#fragment",
    "tel:+15555550123#.office.com",
    // Whitespace.
    "tel:555 0123",
    "tel: ",
    // Separators only, with no digit anywhere.
    "tel:(",
    "tel:()-.",
    "tel:+",
    // Protocol-relative smuggling.
    "tel://evil.example.com",
    "sms://evil.example.com",
  ];

  test.each(invalidOpaquePayloads)("rejects %s", (input: string) => {
    expect(() => {
      return URL.fromString(input);
    }).toThrow(BadDataException);
  });

  test("rejects a payload longer than 256 characters", () => {
    expect(() => {
      return URL.fromString("tel:+" + "1".repeat(300));
    }).toThrow(BadDataException);
  });

  test("rejects a parameter that is not a well-formed key=value", () => {
    expect(() => {
      return URL.fromString("tel:+15555550123;evil=a/b");
    }).toThrow(BadDataException);
    expect(() => {
      return URL.fromString("tel:+15555550123;a@b");
    }).toThrow(BadDataException);
  });

  test("the error names the offending value", () => {
    expect(() => {
      return URL.fromString("tel:abc");
    }).toThrow("Phone number abc is not in valid format.");
  });

  /*
   * A dotted quad is a syntactically valid local number, so it parses — but it
   * stays a tel: URL with no hostname, so it can never become the target of an
   * HTTP request the way "https://169.254.169.254" would.
   */
  test("a dotted quad stays a tel: URL and exposes no host", () => {
    const url: URL = URL.fromString("tel:169.254.169.254");

    expect(url.protocol).toBe(Protocol.TEL);
    expect(url.hostname).toBeUndefined();
    expect(url.toString()).toBe("tel:169.254.169.254");
  });
});

describe("URL — adding opaque schemes did not disturb the existing ones", () => {
  const untouched: Array<[string, Protocol]> = [
    ["https://example.com/api/test", Protocol.HTTPS],
    ["http://example.com/api/test", Protocol.HTTP],
    ["ws://localhost:5000/api/test", Protocol.WS],
    ["wss://localhost:5000/api/test", Protocol.WSS],
    ["mongodb://localhost:27017/test", Protocol.MONGO_DB],
    ["mailto:support@example.com", Protocol.MAIL],
  ];

  test.each(untouched)(
    "%s still parses as %s",
    (input: string, expected: Protocol) => {
      const url: URL = URL.fromString(input);
      expect(url.protocol).toBe(expected);
      expect(url.opaqueValue).toBe("");
    },
  );

  test.each(untouched)("%s still round-trips", (input: string) => {
    expect(URL.fromString(input).toString()).toBe(input);
  });

  test("query strings on http URLs are unaffected", () => {
    const url: URL = URL.fromString("https://example.com/api?a=1&b=2");
    expect(url.getQueryParam("a")).toBe("1");
    expect(url.getQueryParam("b")).toBe("2");
    expect(url.toString()).toBe("https://example.com/api?a=1&b=2");
  });

  /*
   * "telephone.example.com" starts with "tel" but is not the tel: scheme —
   * prefix matching must be on "tel:", not "tel".
   */
  test("a host that merely starts with tel is not treated as a tel: URL", () => {
    const url: URL = URL.fromString("https://telephone.example.com/x");
    expect(url.protocol).toBe(Protocol.HTTPS);
    expect(url.hostname.toString()).toBe("telephone.example.com");
  });
});
