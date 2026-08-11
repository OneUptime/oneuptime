import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Hostname used to validate with a character allowlist that happened to
 * include "/", "?", "#" and "@". Anything that stores a Hostname and later
 * interpolates it into a URL therefore inherited control of the host, port
 * AND path of the resulting request — which is how a status page subdomain of
 * "169.254.169.254/latest/meta-data/#" became a request to the cloud metadata
 * endpoint. These tests pin the structural rules that replaced it, and the
 * matching fix in URL.fromString, which used to leave a query string glued to
 * the host.
 */

describe("Hostname.isValid accepts real hosts", () => {
  const validHostnames: Array<string> = [
    "localhost",
    "localhost:5000",
    "example.com",
    "status.example.com",
    "deep.sub.domain.example.com",
    "example.com.",
    "EXAMPLE.com",
    "my-host.internal",
    "host_with_underscore.internal",
    "_dmarc.example.com",
    "1.2.3.4",
    "1.2.3.4:8080",
    "smtp.example.com:587",
    "[::1]",
    "[::1]:8080",
    "[2606:2800:220:1:248:1893:25c8:1946]:443",
    "::1",
    "2606:2800:220:1:248:1893:25c8:1946",
    // Userinfo is still accepted: it is already in customers' stored URLs.
    "user:token@hooks.example.com",
    "user@hooks.example.com",
    "user:token@hooks.example.com:8443",
  ];

  test.each(validHostnames)("accepts %s", (hostname: string) => {
    expect(Hostname.isValid(hostname)).toBe(true);
  });
});

describe("Hostname.isValid rejects smuggled paths, queries and fragments", () => {
  const invalidHostnames: Array<string> = [
    // The status page / dashboard subdomain injection.
    "169.254.169.254/latest/meta-data/#",
    "169.254.169.254/latest/meta-data/#.example.com",
    "example.com/../../etc/passwd",
    "example.com/path",
    "example.com?query=1",
    "example.com#fragment",
    "example.com:8080/path",
    // Junk the old character allowlist waved through.
    "example.com;evil",
    "example.com,evil",
    "exa mple.com",
    "undefined undefined",
    "localhost 5000",
    "",
    "   ",
    // A port that is not a port.
    "example.com:notaport",
    "example.com:80:90",
    // Hyphen placement.
    "-example.com",
    "example-.com",
    // Userinfo may not itself carry a path or a second authority.
    "user@evil.com/@example.com",
    "user@example.com?x=1",
  ];

  test.each(invalidHostnames)("rejects %s", (hostname: string) => {
    expect(Hostname.isValid(hostname)).toBe(false);
  });

  test("the constructor throws rather than storing a smuggled value", () => {
    expect(() => {
      return new Hostname("169.254.169.254/latest/meta-data/#");
    }).toThrow(BadDataException);
  });
});

describe("URL.fromString keeps the authority separate from the rest", () => {
  test("a query string on a path-less URL does not end up in the host", () => {
    const url: URL = URL.fromString("https://hooks.example.com?token=abc");

    expect(url.hostname.hostname).toBe("hooks.example.com");
    expect(url.getQueryParam("token")).toBe("abc");
  });

  test("a fragment on a path-less URL does not end up in the host", () => {
    const url: URL = URL.fromString("https://hooks.example.com#section");

    expect(url.hostname.hostname).toBe("hooks.example.com");
  });

  test("a path still parses as a route", () => {
    const url: URL = URL.fromString("https://hooks.example.com/a/b?x=1");

    expect(url.hostname.hostname).toBe("hooks.example.com");
    expect(url.route.toString()).toBe("a/b");
    expect(url.getQueryParam("x")).toBe("1");
    expect(url.toString()).toBe("https://hooks.example.com/a/b?x=1");
  });

  test("a host with a port survives", () => {
    const url: URL = URL.fromString("http://localhost:5000/api/test");

    expect(url.hostname.toString()).toBe("localhost:5000");
    expect(url.toString()).toBe("http://localhost:5000/api/test");
  });

  test("a mailto address is parsed as an email, not as a host", () => {
    const url: URL = URL.fromString("mailto:support@oneuptime.com");

    expect(url.email.toString()).toBe("support@oneuptime.com");
    expect(url.toString()).toBe("mailto:support@oneuptime.com");
  });

  test("a mailto address with a subject does not go through the host validator", () => {
    const url: URL = URL.fromString(
      "mailto:support@oneuptime.com?subject=Hello",
    );

    expect(url.email.toString()).toBe("support@oneuptime.com");
    expect(url.getQueryParam("subject")).toBe("Hello");
  });

  test("a webhook URL with basic-auth credentials still round-trips", () => {
    /*
     * These are already in customers' databases. Rejecting them here would
     * fail on read, not just on write.
     */
    const url: URL = URL.fromString("https://user:token@hooks.example.com/x");

    expect(url.hostname.hostname).toBe("user:token@hooks.example.com");
    expect(url.toString()).toBe("https://user:token@hooks.example.com/x");
  });
});
