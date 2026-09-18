import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * An unrecognised scheme used to be swallowed: the prefix loop did not match,
 * the protocol stayed at its https default, and the remainder was read as an
 * authority. That is how "tel:3136361710" became the stored value
 * "https://tel:3136361710/" — a URL nobody typed, with a host of "tel".
 *
 * The write side now refuses a scheme it cannot represent and says which one,
 * instead of quietly rewriting the value into something else.
 */

describe("URL — an unsupported scheme is refused, not rewritten", () => {
  const unsupportedSchemes: Array<string> = [
    "ftp://files.example.com/x",
    "file:///etc/passwd",
    "gopher://example.com/1",
    "ldap://example.com/x",
    "smb://example.com/share",
    "chrome://settings",
    "mongodb+srv://cluster.example.com/db",
  ];

  test.each(unsupportedSchemes)("rejects %s", (input: string) => {
    expect(() => {
      return URL.fromString(input);
    }).toThrow(BadDataException);
  });

  test("the error names the offending scheme", () => {
    expect(() => {
      return URL.fromString("ftp://files.example.com/x");
    }).toThrow("URL scheme ftp: is not supported.");
  });

  /*
   * These are dangerous in an href, so they are refused even without the "//"
   * authority marker.
   */
  const dangerousSchemes: Array<string> = [
    "javascript:alert(1)",
    "javascript:alert('xss')",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/plain,hello",
    "vbscript:msgbox(1)",
    "file:/etc/passwd",
    "blob:https://example.com/uuid",
  ];

  test.each(dangerousSchemes)("rejects %s", (input: string) => {
    expect(() => {
      return URL.fromString(input);
    }).toThrow(BadDataException);
  });

  /*
   * The specific hole this closes: a scheme whose remainder happens to look
   * like a valid host:port used to sail through and be silently rewritten.
   */
  test("an unsupported scheme with a port-shaped remainder is refused", () => {
    expect(() => {
      return URL.fromString("javascript:12345");
    }).toThrow(BadDataException);
  });

  test("no unsupported scheme is silently rewritten to https", () => {
    for (const input of [...unsupportedSchemes, ...dangerousSchemes]) {
      let rewritten: string | null = null;

      try {
        rewritten = URL.fromString(input).toString();
      } catch {
        // Refused, which is the point.
      }

      expect(rewritten).toBeNull();
    }
  });
});

describe("URL — scheme rejection does not catch things that are not schemes", () => {
  /*
   * "example.com:8080/hook" has no scheme — that colon separates a host from a
   * port. A regex alone cannot tell the two apart, so the rule keys on the
   * "//" authority marker, which a host:port never has.
   */
  const schemeLessValues: Array<[string, string]> = [
    ["example.com:8080/hook", "example.com:8080"],
    ["localhost:5000", "localhost:5000"],
    ["example.com", "example.com"],
    ["status.example.com/path", "status.example.com"],
  ];

  test.each(schemeLessValues)(
    "%s is still parsed as a host, not a scheme",
    (input: string, expectedHost: string) => {
      const url: URL = URL.fromString(input);

      expect(url.protocol).toBe(Protocol.HTTPS);
      expect(url.hostname.toString()).toBe(expectedHost);
    },
  );

  test("every supported scheme still parses", () => {
    const supported: Array<[string, Protocol]> = [
      ["https://example.com/x", Protocol.HTTPS],
      ["http://example.com/x", Protocol.HTTP],
      ["ws://example.com/x", Protocol.WS],
      ["wss://example.com/x", Protocol.WSS],
      ["mongodb://example.com/db", Protocol.MONGO_DB],
      ["mailto:support@example.com", Protocol.MAIL],
      ["tel:+13136361710", Protocol.TEL],
      ["sms:+15555550123", Protocol.SMS],
    ];

    for (const [input, expected] of supported) {
      expect(URL.fromString(input).protocol).toBe(expected);
    }
  });
});

/*
 * The read side is unaffected: a value already sitting in the database with an
 * unsupported scheme still comes back, flagged, rather than failing the query
 * that touched it.
 */
describe("URL — reads still tolerate an unsupported scheme already stored", () => {
  test("fromStringLenient keeps a stored ftp:// link readable", () => {
    const url: URL = URL.fromStringLenient("ftp://files.example.com/x");

    expect(url.isMalformed()).toBe(true);
    expect(url.toString()).toBe("ftp://files.example.com/x");
  });

  test("but it can never be written back", () => {
    const transformer: {
      to: (value: unknown) => unknown;
    } = URL.getDatabaseTransformer() as { to: (value: unknown) => unknown };

    expect(() => {
      return transformer.to(URL.fromStringLenient("ftp://files.example.com/x"));
    }).toThrow(BadDataException);
  });
});
