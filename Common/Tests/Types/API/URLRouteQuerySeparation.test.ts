import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";

/*
 * fromString used to split the authority off on the FIRST "/" before the query
 * was ever separated, so a "/" inside a query VALUE was read as a path segment
 * on any URL that had no path of its own:
 *
 *   URL.fromString("https://example.com?next=/a/b").toString()
 *     => "https://example.com/a/b?next=/a/b"   <-- "/a/b" invented
 *
 * "https://example.com/p?next=/a/b" was fine, because the real path consumed
 * the split. The bug therefore hid behind every URL that happened to have a
 * path, which is most of them.
 *
 * It matters because Common/Server/Types/Workflow/Components/API/Utils.ts
 * validates the RAW string for SSRF and then dispatches URL.fromString(url):
 * a workflow author whose URL had no path and a "/" in a query value sent a
 * request to a path they never wrote.
 */

/*
 * The path this type would put on the wire, in the shape WHATWG reports it, so
 * the two parsers can be compared directly. An empty route means "no path",
 * which is "/" to WHATWG. Only meaningful for URLs without a fragment: a
 * fragment rides on the end of the route here (this type has no fragment
 * field) and WHATWG keeps it out of pathname.
 */
const pathOf: (url: URL) => string = (url: URL): string => {
  const route: string = url.route.toString();

  if (!route) {
    return "/";
  }

  return route.startsWith("/") ? route : "/" + route;
};

describe("URL route/query separation — '/' in a value, no path of its own", () => {
  test("no path is fabricated from the query value", () => {
    const url: URL = URL.fromString("https://example.com?next=/a/b");

    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("next")).toBe("/a/b");
    expect(url.toString()).toBe("https://example.com/?next=/a/b");
    expect(url.toString()).not.toBe("https://example.com/a/b?next=/a/b");
  });

  test("a deeply nested value contributes no path segments", () => {
    const url: URL = URL.fromString("https://example.com?next=/a/b/c/d/e");

    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("next")).toBe("/a/b/c/d/e");
    expect(url.toString()).toBe("https://example.com/?next=/a/b/c/d/e");
  });

  test("an absolute URL used as a value does not become the path", () => {
    const url: URL = URL.fromString(
      "https://auth.example.com?redirect=https://app.example.com/home",
    );

    expect(url.hostname.hostname).toBe("auth.example.com");
    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("redirect")).toBe("https://app.example.com/home");
    expect(url.toString()).toBe(
      "https://auth.example.com/?redirect=https://app.example.com/home",
    );
  });

  test("a value that is a single '/' invents nothing", () => {
    const url: URL = URL.fromString("https://example.com?next=/");

    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("next")).toBe("/");
    expect(url.toString()).toBe("https://example.com/?next=/");
  });

  test("params after the slash-bearing one are still parsed", () => {
    const url: URL = URL.fromString("https://example.com?next=/a/b&state=xyz");

    expect(url.params).toEqual({ next: "/a/b", state: "xyz" });
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com/?next=/a/b&state=xyz");
  });

  test("the slash-bearing param need not be the first one", () => {
    const url: URL = URL.fromString("https://example.com?state=xyz&next=/a/b");

    expect(url.params).toEqual({ state: "xyz", next: "/a/b" });
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com/?state=xyz&next=/a/b");
  });

  test("several values may carry slashes at once", () => {
    const url: URL = URL.fromString(
      "https://example.com?from=/x/y&to=/z/w&mode=copy",
    );

    expect(url.params).toEqual({ from: "/x/y", to: "/z/w", mode: "copy" });
    expect(url.route.toString()).toBe("");
  });

  test("a value-less param containing '/' invents no path", () => {
    const url: URL = URL.fromString("https://example.com?/a/b");

    expect(url.route.toString()).toBe("");
    expect(url.params).toEqual({ "/a/b": "" });
  });

  test("a port on the authority is kept and still gets no path", () => {
    const url: URL = URL.fromString("https://example.com:8080?next=/a/b");

    expect(url.hostname.hostname).toBe("example.com:8080");
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com:8080/?next=/a/b");
  });

  test("an http (not https) URL is fixed the same way", () => {
    const url: URL = URL.fromString("http://localhost:5000?next=/a/b");

    expect(url.protocol).toBe(Protocol.HTTP);
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("http://localhost:5000/?next=/a/b");
  });

  test("an encoded '%2F' was never affected and still is not", () => {
    const url: URL = URL.fromString("https://example.com?next=%2Fa%2Fb");

    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("next")).toBe("%2Fa%2Fb");
    expect(url.toString()).toBe("https://example.com/?next=%2Fa%2Fb");
  });
});

describe("URL route/query separation — a real path is untouched", () => {
  test("a one-segment path survives a slash-bearing value", () => {
    const url: URL = URL.fromString("https://example.com/p?next=/a/b");

    expect(url.route.toString()).toBe("p");
    expect(url.getQueryParam("next")).toBe("/a/b");
    expect(url.toString()).toBe("https://example.com/p?next=/a/b");
  });

  test("a deep path survives a slash-bearing value", () => {
    const url: URL = URL.fromString(
      "https://example.com/api/v1/items?next=/a/b",
    );

    expect(url.route.toString()).toBe("api/v1/items");
    expect(url.route.toString()).not.toContain("?");
    expect(url.toString()).toBe("https://example.com/api/v1/items?next=/a/b");
  });

  test("a trailing slash on the path is preserved", () => {
    const url: URL = URL.fromString("https://example.com/p/?next=/a/b");

    expect(url.route.toString()).toBe("p/");
    expect(url.toString()).toBe("https://example.com/p/?next=/a/b");
  });

  test("a path with no query at all is unchanged", () => {
    const url: URL = URL.fromString("https://example.com/a/b/c");

    expect(url.route.toString()).toBe("a/b/c");
    expect(url.params).toEqual({});
    expect(url.toString()).toBe("https://example.com/a/b/c");
  });

  test("the path stops at the first '?', whatever the value holds", () => {
    const url: URL = URL.fromString(
      "https://example.com/api/v1/items?next=/a/b&other=/c/d",
    );

    expect(url.route.toString()).toBe("api/v1/items");
  });
});

describe("URL route/query separation — '/' in a value plus an embedded '?'", () => {
  test("a path-less URL keeps the whole value and gains no path", () => {
    const url: URL = URL.fromString("https://example.com?next=/a?b=c");

    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("next")).toBe("/a?b=c");
    expect(url.toString()).toBe("https://example.com/?next=/a?b=c");
  });

  test("a redirect target carrying its own query is not turned into a path", () => {
    const url: URL = URL.fromString(
      "https://auth.example.com?redirect=https://app.example.com/home?tab=1",
    );

    expect(url.hostname.hostname).toBe("auth.example.com");
    expect(url.route.toString()).toBe("");
    expect(url.getQueryParam("redirect")).toBe(
      "https://app.example.com/home?tab=1",
    );
    expect(url.toString()).toBe(
      "https://auth.example.com/?redirect=https://app.example.com/home?tab=1",
    );
  });

  test("params after the embedded '?' are still parsed on a path-less URL", () => {
    const url: URL = URL.fromString("https://example.com?next=/a?b=c&state=x");

    expect(url.params).toEqual({ next: "/a?b=c", state: "x" });
    expect(url.route.toString()).toBe("");
  });

  test("the same shape with a real path keeps the path and the value", () => {
    const url: URL = URL.fromString(
      "https://auth.example.com/login?redirect=https://app.example.com/home?tab=1&state=x",
    );

    expect(url.route.toString()).toBe("login");
    expect(url.getQueryParam("redirect")).toBe(
      "https://app.example.com/home?tab=1",
    );
    expect(url.getQueryParam("state")).toBe("x");
  });
});

/*
 * The authority was already cut at "?" and "#" before this change, so the host
 * never moved - the fabricated path was a path bug, not a host bypass. These
 * pin that: the workflow SSRF check reads the host off the RAW string with the
 * WHATWG parser, and both parsers agree on the host for every shape here. What
 * used to diverge between them was the PATH, which is what the request line
 * carried.
 */
describe("URL route/query separation — the host never moved", () => {
  const hostCases: Array<string> = [
    "https://example.com?next=/a/b",
    "https://example.com?redirect=https://evil.example.net/x",
    "https://example.com?next=/a?b=c",
    "https://example.com/p?next=/a/b",
    "https://example.com?next=/a/b&state=x",
  ];

  test.each(hostCases)("the host of %s is example.com", (raw: string) => {
    expect(URL.fromString(raw).hostname.hostname).toBe("example.com");
    expect(new globalThis.URL(raw).host).toBe("example.com");
  });

  test("a value naming another host does not become the host", () => {
    const url: URL = URL.fromString(
      "https://example.com?redirect=https://169.254.169.254/latest/meta-data",
    );

    expect(url.hostname.hostname).toBe("example.com");
    expect(url.toString()).toContain("https://example.com/?redirect=");
  });

  test.each(hostCases)(
    "the path of %s now agrees with the WHATWG parser",
    (raw: string) => {
      expect(pathOf(URL.fromString(raw))).toBe(
        new globalThis.URL(raw).pathname,
      );
    },
  );

  test("the path used to diverge from what SSRF validation saw", () => {
    /*
     * The exact divergence the fix closes, stated as the two parsers seeing
     * the same request line: WHATWG (which the SSRF check uses) reads "/" for
     * a path-less URL, and this type used to read "/a/b".
     */
    const raw: string = "https://example.com?next=/a/b";

    expect(new globalThis.URL(raw).pathname).toBe("/");
    expect(pathOf(URL.fromString(raw))).toBe("/");
    expect(pathOf(URL.fromString(raw))).not.toBe("/a/b");
  });

  test("userinfo in the authority is still carried whole", () => {
    const url: URL = URL.fromString("https://user:pw@example.com?next=/a/b");

    expect(url.hostname.hostname).toBe("user:pw@example.com");
    expect(url.route.toString()).toBe("");
  });
});

/*
 * A fragment is not a field on this type; it rides on the end of the route.
 * Cutting the route at "#" as well as "?" - without carrying the fragment
 * across - would have silently dropped it, so these pin that it survives.
 */
describe("URL route/query separation — fragments survive", () => {
  test("a fragment after a path is kept", () => {
    const url: URL = URL.fromString("https://example.com/docs#section");

    expect(url.route.toString()).toBe("docs#section");
    expect(url.toString()).toBe("https://example.com/docs#section");
  });

  test("a fragment on a path-less URL is no longer dropped", () => {
    const url: URL = URL.fromString("https://example.com#section");

    expect(url.hostname.hostname).toBe("example.com");
    expect(url.route.toString()).toBe("#section");
    expect(url.toString()).toBe("https://example.com/#section");
  });

  test("a '/' inside a fragment no longer fabricates a path", () => {
    /*
     * The fragment-side twin of the query bug: "#a/b" used to split as a path
     * and come back out as "https://example.com/b", losing the fragment and
     * inventing a path in one step.
     */
    const url: URL = URL.fromString("https://example.com#a/b");

    expect(url.route.toString()).toBe("#a/b");
    expect(url.toString()).toBe("https://example.com/#a/b");
    expect(url.toString()).not.toBe("https://example.com/b");
  });

  test("a fragment coexists with a slash-bearing query value", () => {
    const url: URL = URL.fromString("https://example.com/p?next=/a/b#frag");

    expect(url.route.toString()).toBe("p");
    expect(url.getQueryParam("next")).toBe("/a/b#frag");
    expect(url.toString()).toBe("https://example.com/p?next=/a/b#frag");
  });

  test("a fragment before the query keeps both halves", () => {
    const url: URL = URL.fromString("https://example.com/p#frag?x=1");

    expect(url.route.toString()).toBe("p#frag");
    expect(url.getQueryParam("x")).toBe("1");
    expect(url.toString()).toBe("https://example.com/p#frag?x=1");
  });
});

describe("URL route/query separation — round trip is lossless", () => {
  const roundTripCases: Array<string> = [
    "https://example.com/?next=/a/b",
    "https://example.com/?next=/a/b/c/d/e",
    "https://example.com/?next=/",
    "https://example.com/?next=/a/b&state=xyz",
    "https://example.com/?state=xyz&next=/a/b",
    "https://example.com/?next=/a?b=c",
    "https://example.com/?next=/a?b=c&state=x",
    "https://example.com/?redirect=https://app.example.com/home",
    "https://example.com/?redirect=https://app.example.com/home?tab=1",
    "https://example.com:8080/?next=/a/b",
    "http://localhost:5000/?next=/a/b",
    "https://example.com/p?next=/a/b",
    "https://example.com/p/?next=/a/b",
    "https://example.com/api/v1/items?next=/a/b",
    "https://example.com/api/v1/items?next=/a/b&other=/c/d",
    "https://auth.example.com/login?redirect=https://app.example.com/home?tab=1&state=x",
    "https://example.com/docs#section",
    "https://example.com/#section",
    "https://example.com/#a/b",
    "https://example.com/p?next=/a/b#frag",
    "https://example.com/p#frag?x=1",
  ];

  test.each(roundTripCases)(
    "URL.fromString(%s).toString() returns it unchanged",
    (original: string) => {
      expect(URL.fromString(original).toString()).toBe(original);
    },
  );

  test.each(roundTripCases)(
    "a second parse of %s is stable",
    (original: string) => {
      const once: string = URL.fromString(original).toString();

      expect(URL.fromString(once).toString()).toBe(once);
    },
  );

  test.each(roundTripCases)(
    "fromURL re-parses %s unchanged",
    (original: string) => {
      expect(URL.fromURL(URL.fromString(original)).toString()).toBe(original);
    },
  );

  /*
   * An authority with no path re-serializes with the "/" RFC 3986 6.2.3 makes
   * equivalent to an empty path - "https://example.com" has always come back
   * as "https://example.com/", with or without a query. That normalization
   * predates this change and is why the round-trip list above spells the "/"
   * out; parsing either form twice is stable.
   */
  const normalizedCases: Array<[string, string]> = [
    ["https://example.com?next=/a/b", "https://example.com/?next=/a/b"],
    ["https://example.com?next=/a?b=c", "https://example.com/?next=/a?b=c"],
    ["https://example.com#section", "https://example.com/#section"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com?token=x", "https://example.com/?token=x"],
  ];

  test.each(normalizedCases)(
    "%s re-serializes as %s and then holds still",
    (original: string, normalized: string) => {
      expect(URL.fromString(original).toString()).toBe(normalized);
      expect(URL.fromString(normalized).toString()).toBe(normalized);
    },
  );
});

/*
 * The workflow "API Get (JSON)" and "API Delete (JSON)" components hand the
 * author's URL to URL.fromString and dispatch whatever comes back, so these
 * are the strings that used to go out to the wrong path.
 */
describe("URL route/query separation — the workflow API component path", () => {
  const componentUrls: Array<string> = [
    "https://hooks.example.com/?target=/deploy/rollback",
    "https://api.example.com/?path=/v1/incidents&limit=50",
    "https://example.com/?callback=https://oneuptime.com/api/webhook",
    "https://api.example.com/v1/incidents?callback=/done",
  ];

  test.each(componentUrls)(
    "a component URL is dispatched unchanged: %s",
    (componentUrl: string) => {
      expect(URL.fromString(componentUrl).toString()).toBe(componentUrl);
    },
  );

  test("a path-less component URL is no longer dispatched to an invented path", () => {
    const dispatched: string = URL.fromString(
      "https://hooks.example.com?target=/deploy/rollback",
    ).toString();

    expect(dispatched).not.toBe(
      "https://hooks.example.com/deploy/rollback?target=/deploy/rollback",
    );
    expect(dispatched).toBe(
      "https://hooks.example.com/?target=/deploy/rollback",
    );
  });
});

describe("URL route/query separation — other entry points agree", () => {
  test("the constructor produces the same URL as the parser", () => {
    const constructed: URL = new URL(
      Protocol.HTTPS,
      new Hostname("example.com"),
      new Route(""),
      "next=/a/b",
    );

    expect(constructed.toString()).toBe("https://example.com/?next=/a/b");
    expect(constructed.toString()).toBe(
      URL.fromString("https://example.com?next=/a/b").toString(),
    );
  });

  test("fromStringLenient parses the fixed shape rather than falling back", () => {
    const url: URL = URL.fromStringLenient("https://example.com?next=/a/b");

    expect(url.isMalformed()).toBe(false);
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com/?next=/a/b");
  });

  test("removeQueryString leaves no fabricated path behind", () => {
    const url: URL = URL.fromString(
      "https://example.com?next=/a/b",
    ).removeQueryString();

    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com/");
  });

  test("toJSON/fromJSON round trip a slash-bearing value", () => {
    const url: URL = URL.fromString("https://example.com?next=/a/b");

    expect(URL.fromJSON(url.toJSON()).toString()).toBe(
      "https://example.com/?next=/a/b",
    );
  });

  test("addQueryParam on a path-less URL adds no path", () => {
    const url: URL = URL.fromString("https://example.com").addQueryParam(
      "next",
      "/a/b",
    );

    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("https://example.com/?next=/a/b");
  });
});
