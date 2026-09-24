import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Route refuses any value that starts with a scheme ("javascript:...", but
 * equally "bot123:ABC/sendMessage"), so a scheme can never reach a navigation
 * sink. URL.fromString stores a parsed path WITHOUT the "/" that separates it
 * from the authority, and handed that bare path to Route. So any URL whose
 * first path segment contains a ":" stopped parsing:
 *
 *   URL.fromString("https://api.telegram.org/bot123:ABC/sendMessage")
 *     => BadDataException "Invalid route: bot123:ABC/sendMessage"
 *
 * Telegram puts the bot token - always "<id>:<secret>" - in exactly that
 * segment. That broke the Telegram workflow component (and put the token in
 * the run log), every API component call to Telegram, and every sandboxed
 * axios call to Telegram, where the SSRF guard's parse failure surfaced as
 * "Request URL is not a valid URL".
 */

// Same shape as a real token: 10-digit bot id, 35-character secret.
const BOT_TOKEN: string = "8000000001:AAFakeFakeFakeFakeFakeFakeFake_-12345";
const TELEGRAM_URL: string = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

describe("URL.fromString - Telegram Bot API URLs", () => {
  test("parses the sendMessage URL instead of throwing Invalid route", () => {
    expect(() => {
      return URL.fromString(TELEGRAM_URL);
    }).not.toThrow();
  });

  test("round-trips to exactly the string that was parsed", () => {
    expect(URL.fromString(TELEGRAM_URL).toString()).toBe(TELEGRAM_URL);
  });

  test("puts the whole bot token in the path, not in the host or port", () => {
    const url: URL = URL.fromString(TELEGRAM_URL);

    expect(url.protocol).toBe(Protocol.HTTPS);
    expect(url.hostname.hostname).toBe("api.telegram.org");
    expect(url.hostname.port).toBeUndefined();
    expect(url.route.toString()).toBe(`/bot${BOT_TOKEN}/sendMessage`);
  });

  test("agrees with the WHATWG parser the HTTP client uses", () => {
    const whatwg: globalThis.URL = new globalThis.URL(TELEGRAM_URL);
    const url: URL = URL.fromString(TELEGRAM_URL);

    expect(url.hostname.hostname).toBe(whatwg.hostname);
    expect(url.route.toString()).toBe(whatwg.pathname);
    expect(url.toString()).toBe(whatwg.href);
  });

  test.each([
    "getMe",
    "sendMessage",
    "sendPhoto",
    "getUpdates",
    "setWebhook",
    "getWebhookInfo",
  ])("parses the %s method URL", (method: string) => {
    const raw: string = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

    expect(URL.fromString(raw).toString()).toBe(raw);
  });

  test("keeps query parameters on a Telegram URL", () => {
    const raw: string = `${TELEGRAM_URL}?chat_id=@mychannel&text=hello`;
    const url: URL = URL.fromString(raw);

    expect(url.route.toString()).toBe(`/bot${BOT_TOKEN}/sendMessage`);
    expect(url.getQueryParam("chat_id")).toBe("@mychannel");
    expect(url.getQueryParam("text")).toBe("hello");
    expect(url.toString()).toBe(raw);
  });

  test("keeps the file download path, whose token is not the first segment", () => {
    const raw: string = `https://api.telegram.org/file/bot${BOT_TOKEN}/photos/file_1.jpg`;

    expect(URL.fromString(raw).toString()).toBe(raw);
  });

  test("fromStringLenient returns a real URL, not a malformed placeholder", () => {
    const url: URL = URL.fromStringLenient(TELEGRAM_URL);

    expect(url.isMalformed()).toBe(false);
    expect(url.hostname.hostname).toBe("api.telegram.org");
    expect(url.toString()).toBe(TELEGRAM_URL);
  });

  test("survives fromURL, toJSON and fromJSON", () => {
    const url: URL = URL.fromString(TELEGRAM_URL);

    expect(URL.fromURL(url).toString()).toBe(TELEGRAM_URL);

    const revived: URL = URL.fromJSON(url.toJSON());
    expect(revived.isMalformed()).toBe(false);
    expect(revived.toString()).toBe(TELEGRAM_URL);
  });

  test("removeQueryString keeps the token path", () => {
    const url: URL = URL.fromString(`${TELEGRAM_URL}?chat_id=1`);

    expect(url.removeQueryString().toString()).toBe(TELEGRAM_URL);
  });

  test("addQueryParam appends to a Telegram URL", () => {
    const url: URL = URL.fromString(TELEGRAM_URL).addQueryParam(
      "chat_id",
      "@my channel",
      true,
    );

    expect(url.toString()).toBe(`${TELEGRAM_URL}?chat_id=%40my%20channel`);
  });

  test("getLastRoute reads the method and the token segment", () => {
    const url: URL = URL.fromString(TELEGRAM_URL);

    expect(url.getLastRoute()?.toString()).toBe("/sendMessage");
    expect(url.getLastRoute(1)?.toString()).toBe(`/bot${BOT_TOKEN}`);
  });
});

describe("URL.fromString - any first path segment containing a ':'", () => {
  test.each([
    ["an id:secret pair", "https://example.com/abc:def"],
    ["a URN", "https://example.com/urn:uuid:6e8bc430-9c3a-11d9-9669"],
    ["a trailing slash", "https://example.com/bot1:abc/"],
    ["a single segment", "https://example.com/bot1:abc"],
    ["a port", "https://example.com:8443/bot1:abc/sendMessage"],
    ["userinfo", "https://user:pw@example.com/bot1:abc/sendMessage"],
    ["plain http", "http://example.com/bot1:abc/sendMessage"],
    ["a fragment", "https://example.com/bot1:abc/sendMessage#top"],
    ["a query", "https://example.com/bot1:abc/sendMessage?a=1&b=2"],
    ["a dotted scheme-like name", "https://example.com/a.b+c-d:e/f"],
  ])("parses and round-trips a path with %s", (_label: string, raw: string) => {
    const url: URL = URL.fromString(raw);

    expect(url.toString()).toBe(raw);
  });

  test("an uppercase scheme on the URL is normalised, the path is kept", () => {
    const url: URL = URL.fromString(
      "HTTPS://api.telegram.org/bot1:abc/sendMessage",
    );

    expect(url.toString()).toBe(
      "https://api.telegram.org/bot1:abc/sendMessage",
    );
  });

  test("a path that merely looks like a dangerous scheme stays a path", () => {
    /*
     * Before Route refused scheme-like values this parsed to a route of
     * "javascript:alert(1)" - a value that is a live href on its own. It now
     * keeps its "/", so the Route is a same-origin path and can never be
     * mistaken for a scheme by anything that renders it.
     */
    const url: URL = URL.fromString("https://example.com/javascript:alert(1)");
    const route: string = url.route.toString();

    expect(url.hostname.hostname).toBe("example.com");
    expect(route).toBe("/javascript:alert(1)");
    expect(route.startsWith("/")).toBe(true);
    expect(Route.hasSchemePrefix(route)).toBe(false);
    expect(url.toString()).toBe("https://example.com/javascript:alert(1)");
  });

  test.each([
    "https://example.com/bot1:abc/sendMessage",
    "https://example.com/mailto:someone@example.com",
    "https://example.com/data:text/plain,hi",
    "https://example.com/urn:isbn:0451450523",
  ])("the route of %s is never itself scheme-like", (raw: string) => {
    expect(Route.hasSchemePrefix(URL.fromString(raw).route.toString())).toBe(
      false,
    );
  });

  test("the host is still read off the authority, never off the path", () => {
    // The ":" in the path must not be mistaken for a host:port separator.
    const url: URL = URL.fromString("https://10.0.0.5/bot1:80/sendMessage");

    expect(url.hostname.hostname).toBe("10.0.0.5");
    expect(url.hostname.port).toBeUndefined();
  });
});

describe("URL.fromString - paths that already parsed are unchanged", () => {
  /*
   * The leading "/" is only kept when dropping it would make the path read as
   * a scheme. Every other path keeps the bare representation it always had,
   * so nothing that read url.route before this change sees a different value.
   */
  test.each([
    ["https://example.com/api/v1/items", "api/v1/items"],
    ["https://example.com/docs#section", "docs#section"],
    ["https://example.com#section", "#section"],
    ["https://example.com/p/", "p/"],
    ["https://vision.googleapis.com/v1/images:annotate", "v1/images:annotate"],
    ["https://example.com/api/:resourceId", "api/:resourceId"],
    ["https://example.com/1:2/x", "1:2/x"],
    [
      "https://example.com/_matrix/client/v3/rooms/!r:m.org",
      "_matrix/client/v3/rooms/!r:m.org",
    ],
    ["https://example.com/:leading-colon", ":leading-colon"],
    ["https://example.com/events?at=12:30", "events"],
    ["https://example.com", ""],
    ["https://example.com/", ""],
  ])("%s keeps route %s", (raw: string, expectedRoute: string) => {
    expect(URL.fromString(raw).route.toString()).toBe(expectedRoute);
  });
});

describe("URL.fromString - '~' in a path", () => {
  /*
   * "~" is an RFC 3986 unreserved character, but Route's character allowlist
   * left it out, so "https://example.com/~user" could not be parsed - and the
   * sandboxed axios bridge refused it as "Request URL is not a valid URL".
   */
  test.each([
    "https://example.com/~user/hook",
    "https://example.com/files/~backup",
    "https://example.com/a~b/c",
    "https://example.com/path?x=~y",
  ])("parses and round-trips %s", (raw: string) => {
    expect(URL.fromString(raw).toString()).toBe(raw);
  });
});

describe("URL.addRoute with a scheme-like segment", () => {
  test("appends a string segment that starts with a token", () => {
    const url: URL = URL.fromString("https://api.telegram.org").addRoute(
      `bot${BOT_TOKEN}/sendMessage`,
    );

    expect(url.toString()).toBe(TELEGRAM_URL);
  });

  test("appends the same segment given with its leading slash", () => {
    const url: URL = URL.fromString("https://api.telegram.org").addRoute(
      `/bot${BOT_TOKEN}/sendMessage`,
    );

    expect(url.toString()).toBe(TELEGRAM_URL);
  });

  test("appends a method to a URL that already ends in the token", () => {
    const url: URL = URL.fromString(
      `https://api.telegram.org/bot${BOT_TOKEN}`,
    ).addRoute("sendMessage");

    expect(url.toString()).toBe(TELEGRAM_URL);
  });

  test("appends to a URL built from the constructor", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("api.telegram.org"),
    ).addRoute(`bot${BOT_TOKEN}/sendMessage`);

    expect(url.toString()).toBe(TELEGRAM_URL);
  });

  test("still behaves as before for an ordinary segment", () => {
    expect(
      URL.fromString("https://example.com/api").addRoute("v1/items").toString(),
    ).toBe("https://example.com/api/v1/items");
    expect(
      URL.fromString("https://example.com/api").addRoute("/v1").toString(),
    ).toBe("https://example.com/api/v1");
  });

  test("still refuses characters no route may contain", () => {
    expect(() => {
      URL.fromString("https://example.com").addRoute("a b");
    }).toThrowError(BadDataException);
  });
});

describe("URL.fromString - the scheme checks are not loosened", () => {
  test.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/bot1:abc/sendMessage",
  ])("still refuses %s", (raw: string) => {
    expect(() => {
      return URL.fromString(raw);
    }).toThrowError(BadDataException);
  });

  test("a bare scheme-like Route is still refused on its own", () => {
    expect(() => {
      return new Route(`bot${BOT_TOKEN}/sendMessage`);
    }).toThrowError(BadDataException);
  });
});
