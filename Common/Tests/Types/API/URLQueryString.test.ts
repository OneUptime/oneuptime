import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";

/*
 * setParamsFromQueryString used to split each pair on EVERY "=" and keep
 * element [1], so everything past the second "=" was silently dropped:
 * "?jql=project = OPS" parsed to { jql: "project " } and went back out as
 * "?jql=project ". Nothing threw — the workflow API components run their URL
 * through URL.fromString before dispatching, so a Jira JQL search, an OData
 * $filter, or a base64 signature ran against a different query than the user
 * wrote and still reported success.
 */
describe("URL query string — a value that contains '='", () => {
  test("a raw Jira JQL search keeps its whole expression", () => {
    const url: URL = URL.fromString(
      'https://acme.atlassian.net/rest/api/3/search?jql=project = OPS AND labels = "urgent"',
    );

    expect(url.getQueryParam("jql")).toBe(
      'project = OPS AND labels = "urgent"',
    );
    expect(url.toString()).toBe(
      'https://acme.atlassian.net/rest/api/3/search?jql=project = OPS AND labels = "urgent"',
    );
  });

  test("a percent-encoded JQL search is passed through verbatim", () => {
    const url: URL = URL.fromString(
      "https://acme.atlassian.net/rest/api/3/search?jql=project%20%3D%20OPS&maxResults=50",
    );

    expect(url.params).toEqual({
      jql: "project%20%3D%20OPS",
      maxResults: "50",
    });
    expect(url.toString()).toBe(
      "https://acme.atlassian.net/rest/api/3/search?jql=project%20%3D%20OPS&maxResults=50",
    );
  });

  test("a Dataverse/OData $filter survives alongside other params", () => {
    const url: URL = URL.fromString(
      "https://org.crm.dynamics.com/api/data/v9.2/accounts?$filter=name eq 'a=b'&$top=10",
    );

    expect(url.getQueryParam("$filter")).toBe("name eq 'a=b'");
    expect(url.getQueryParam("$top")).toBe("10");
  });

  test("only the first '=' separates, however many follow", () => {
    const url: URL = URL.fromString("https://example.com/p?a=b=c=d");

    expect(url.params).toEqual({ a: "b=c=d" });
    expect(url.toString()).toBe("https://example.com/p?a=b=c=d");
  });

  test("a JSON value containing '=' is not truncated", () => {
    const url: URL = URL.fromString(
      'https://example.com/p?json={"where":"a=b"}&page=2',
    );

    expect(url.getQueryParam("json")).toBe('{"where":"a=b"}');
    expect(url.getQueryParam("page")).toBe("2");
  });

  test("every param after one containing '=' is still parsed", () => {
    const url: URL = URL.fromString(
      "https://example.com/p?first=x=y&second=2&third=z=w&fourth=4",
    );

    expect(url.params).toEqual({
      first: "x=y",
      second: "2",
      third: "z=w",
      fourth: "4",
    });
  });
});

describe("URL query string — base64 values with '=' padding", () => {
  test("a signature ending in '==' keeps both padding characters", () => {
    const url: URL = URL.fromString(
      "https://example.com/download?sig=YWJjZGVmZ2g==",
    );

    expect(url.getQueryParam("sig")).toBe("YWJjZGVmZ2g==");
    expect(url.toString()).toBe(
      "https://example.com/download?sig=YWJjZGVmZ2g==",
    );
  });

  test("a single '=' pad is kept", () => {
    const url: URL = URL.fromString(
      "https://example.com/download?sig=YWJjZGU=",
    );

    expect(url.getQueryParam("sig")).toBe("YWJjZGU=");
  });

  test("'==' padding does not swallow the params that follow it", () => {
    const url: URL = URL.fromString(
      "https://example.com/download?sig=YWJjZGVmZ2g==&expires=1735689600&key=abc",
    );

    expect(url.params).toEqual({
      sig: "YWJjZGVmZ2g==",
      expires: "1735689600",
      key: "abc",
    });
    expect(url.toString()).toBe(
      "https://example.com/download?sig=YWJjZGVmZ2g==&expires=1735689600&key=abc",
    );
  });
});

describe("URL query string — a param with no value", () => {
  test("'?flag' is kept rather than dropped", () => {
    const url: URL = URL.fromString("https://example.com/p?flag");

    expect(url.params).toEqual({ flag: "" });
    expect(url.toString()).toBe("https://example.com/p?flag");
  });

  test("a bare flag does not hide the params around it", () => {
    const url: URL = URL.fromString("https://example.com/p?a=1&flag&b=2");

    expect(url.params).toEqual({ a: "1", flag: "", b: "2" });
    expect(url.toString()).toBe("https://example.com/p?a=1&flag&b=2");
  });

  test("several bare flags all survive, in order", () => {
    const url: URL = URL.fromString(
      "https://example.com/p?debug&verbose&trace",
    );

    expect(Object.keys(url.params)).toEqual(["debug", "verbose", "trace"]);
    expect(url.toString()).toBe("https://example.com/p?debug&verbose&trace");
  });

  test("a bare flag is present in params and re-emits without a trailing '='", () => {
    const url: URL = URL.fromString("https://example.com/p?flag");

    /*
     * hasOwnProperty, not a truthiness check: the whole point is that the key
     * exists while its value is "". Asserting only that the output lacks
     * "flag=" would also hold for the old behaviour, which dropped the param.
     */
    expect(Object.prototype.hasOwnProperty.call(url.params, "flag")).toBe(true);
    expect(url.toString()).toBe("https://example.com/p?flag");
    expect(url.toString()).not.toContain("flag=");
  });

  test("getQueryParam reports null for a value-less param", () => {
    /*
     * getQueryParam is `params[name] || null`, so an empty value reads as null
     * — "present but empty" is not distinguishable from "absent" through it.
     * Read `params` directly when that difference matters.
     */
    const url: URL = URL.fromString("https://example.com/p?flag");

    expect(url.getQueryParam("flag")).toBeNull();
    expect(url.params["flag"]).toBe("");
  });
});

describe("URL query string — '?' inside a value", () => {
  /*
   * fromString read the query with url.split("?")[1], which stopped at the
   * SECOND "?" and dropped the rest. RFC 3986 3.4 allows "?" inside a query.
   */
  test("a redirect target carrying its own query is not truncated", () => {
    const url: URL = URL.fromString(
      "https://auth.example.com/login?redirect=https://app.example.com/home?tab=1",
    );

    expect(url.getQueryParam("redirect")).toBe(
      "https://app.example.com/home?tab=1",
    );
    expect(url.toString()).toBe(
      "https://auth.example.com/login?redirect=https://app.example.com/home?tab=1",
    );
  });

  test("params after an embedded '?' are still parsed", () => {
    const url: URL = URL.fromString(
      "https://example.com/p?next=/a?b=c&state=xyz",
    );

    expect(url.params).toEqual({ next: "/a?b=c", state: "xyz" });
  });

  test("the route stops at the first '?' even when the value has one", () => {
    const url: URL = URL.fromString(
      "https://example.com/api/v1/items?next=/a?b=c",
    );

    expect(url.route.toString()).toBe("api/v1/items");
    expect(url.route.toString()).not.toContain("?");
  });
});

describe("URL query string — opaque schemes", () => {
  test("tel: keeps '=' inside a param value", () => {
    const url: URL = URL.fromString("tel:+15555550123?ref=a=b");

    expect(url.getQueryParam("ref")).toBe("a=b");
    expect(url.toString()).toBe("tel:+15555550123?ref=a=b");
  });

  test("sms: keeps an '=' laden body", () => {
    const url: URL = URL.fromString("sms:+15555550123?body=x=1&y=2");

    expect(url.params).toEqual({ body: "x=1", y: "2" });
    expect(url.toString()).toBe("sms:+15555550123?body=x=1&y=2");
  });
});

describe("URL query string — round trip is lossless", () => {
  const roundTripCases: Array<string> = [
    "https://example.com/path",
    "https://example.com/path?a=1",
    "https://example.com/path?a=1&b=2&c=3",
    'https://acme.atlassian.net/rest/api/3/search?jql=project = OPS AND labels = "urgent"',
    "https://acme.atlassian.net/rest/api/3/search?jql=project%20%3D%20OPS&maxResults=50",
    "https://org.crm.dynamics.com/api/data/v9.2/accounts?$filter=name eq 'acme'&$top=10",
    "https://example.com/download?sig=YWJjZGVmZ2g==",
    "https://example.com/download?sig=YWJjZGVmZ2g==&expires=1735689600",
    "https://example.com/p?a=b=c=d",
    "https://example.com/p?flag",
    "https://example.com/p?a=1&flag&b=2",
    "https://example.com/p?debug&verbose&trace",
    "https://auth.example.com/login?redirect=https://app.example.com/home?tab=1",
    'https://example.com/p?json={"where":"a=b"}&page=2',
    "https://example.com/p?q=a%3Db",
    "http://localhost:5000/api/test?a=1&b=x=y",
    "tel:+15555550123?ref=a=b",
    "sms:+15555550123?body=x=1&y=2",
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

  test("fromURL round trips a query containing '='", () => {
    const url: URL = URL.fromString("https://example.com/p?sig=abc==&flag");

    expect(URL.fromURL(url).toString()).toBe(
      "https://example.com/p?sig=abc==&flag",
    );
  });
});

describe("URL query string — degenerate segments", () => {
  test("a pair with no key is dropped", () => {
    const url: URL = URL.fromString("https://example.com/p?=novalue");

    expect(url.params).toEqual({});
    expect(url.toString()).toBe("https://example.com/p");
  });

  test("an empty segment between two params is skipped", () => {
    const url: URL = URL.fromString("https://example.com/p?a=1&&b=2");

    expect(url.params).toEqual({ a: "1", b: "2" });
  });

  test("a trailing '?' produces no params", () => {
    const url: URL = URL.fromString("https://example.com/p?");

    expect(url.params).toEqual({});
    expect(url.toString()).toBe("https://example.com/p");
  });

  test("an explicitly empty value reads as empty and re-emits bare", () => {
    const url: URL = URL.fromString("https://example.com/p?a=");

    expect(url.params).toEqual({ a: "" });
    expect(url.toString()).toBe("https://example.com/p?a");
  });

  test("a later duplicate key wins", () => {
    const url: URL = URL.fromString("https://example.com/p?a=1&a=2");

    expect(url.getQueryParam("a")).toBe("2");
  });

  test("a later duplicate wins even when the last occurrence is value-less", () => {
    const url: URL = URL.fromString("https://example.com/p?a=1&a");

    expect(url.params).toEqual({ a: "" });
    expect(url.toString()).toBe("https://example.com/p?a");
  });

  test("a value made only of '=' characters is kept after the first", () => {
    const url: URL = URL.fromString("https://example.com/p?a===");

    expect(url.getQueryParam("a")).toBe("==");
    expect(url.toString()).toBe("https://example.com/p?a===");
  });

  test("a unicode value is passed through untouched", () => {
    const url: URL = URL.fromString("https://example.com/p?name=café&tick=✓");

    expect(url.params).toEqual({ name: "café", tick: "✓" });
    expect(url.toString()).toBe("https://example.com/p?name=café&tick=✓");
  });

  test("a long value containing many '=' is kept whole", () => {
    const value: string = "a=".repeat(500) + "end";
    const url: URL = URL.fromString(`https://example.com/p?data=${value}`);

    expect(url.getQueryParam("data")).toBe(value);
    expect(url.getQueryParam("data")).toHaveLength(1003);
  });

  test("a '__proto__' key does not pollute Object.prototype", () => {
    /*
     * _params is a plain object, so assigning to a "__proto__" key invokes the
     * Object.prototype setter, which ignores a string value: the param is
     * neither stored nor able to pollute anything. Same as before this change
     * — pinned here because the parser now accepts more of the query string.
     */
    const url: URL = URL.fromString(
      "https://example.com/p?a=1&__proto__=polluted&b=2",
    );

    expect(url.params).toEqual({ a: "1", b: "2" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  test("a URL with no query has no params", () => {
    const url: URL = URL.fromString("https://example.com/a/b/c");

    expect(url.params).toEqual({});
    expect(url.toString()).toBe("https://example.com/a/b/c");
  });
});

describe("URL query string — constructed rather than parsed", () => {
  test("the constructor parses a query string the same way", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("example.com"),
      new Route("/search"),
      "jql=project = OPS&flag",
    );

    expect(url.params).toEqual({ jql: "project = OPS", flag: "" });
    expect(url.toString()).toBe(
      "https://example.com/search?jql=project = OPS&flag",
    );
  });

  test("addQueryParam stores a value containing '=' unchanged", () => {
    const url: URL = URL.fromString("https://example.com/p").addQueryParam(
      "sig",
      "YWJjZGU=",
    );

    expect(url.getQueryParam("sig")).toBe("YWJjZGU=");
    expect(url.toString()).toBe("https://example.com/p?sig=YWJjZGU=");
  });

  test("addQueryParam with encode still round trips", () => {
    const url: URL = URL.fromString("https://example.com/p").addQueryParam(
      "jql",
      "project = OPS",
      true,
    );

    expect(url.getQueryParam("jql")).toBe("project%20%3D%20OPS");
    expect(URL.fromString(url.toString()).getQueryParam("jql")).toBe(
      "project%20%3D%20OPS",
    );
  });

  test("addQueryParams merges without disturbing an '=' laden value", () => {
    const url: URL = URL.fromString(
      "https://example.com/p?sig=abc==",
    ).addQueryParams({ page: "2" });

    expect(url.params).toEqual({ sig: "abc==", page: "2" });
    expect(url.toString()).toBe("https://example.com/p?sig=abc==&page=2");
  });
});

/*
 * Round-tripping is lossless for the cases above, but not universally, and the
 * two gaps below are older than this change — both predate it and neither is
 * reachable from the Jira/OData/signed-URL shapes it set out to fix, which all
 * carry a path and string keys. They are pinned so the round-trip guarantee is
 * not read as broader than it is; if either is fixed later, these tests are the
 * ones that should change.
 */
describe("URL query string — known round-trip limitations", () => {
  test("an integer-like key is hoisted to the front on re-serialization", () => {
    /*
     * queryStringSuffix walks Object.keys(), and JavaScript orders canonical
     * integer keys first, ascending, ahead of insertion-ordered string keys.
     * Preserving author order would mean holding params in something other
     * than the public `params: Dictionary<string>` object.
     */
    const url: URL = URL.fromString("https://example.com/p?b=1&1=x&a=2");

    expect(url.params).toEqual({ b: "1", "1": "x", a: "2" });
    expect(url.toString()).toBe("https://example.com/p?1=x&b=1&a=2");
  });

  test("a '/' in a value fabricates a path when the URL has no path", () => {
    /*
     * fromString splits the authority off on the first "/" before the query is
     * ever separated, so a "/" inside a query value is read as a path segment.
     * Only bites a URL with no path of its own; "…/p?next=/a/b" is fine.
     */
    const url: URL = URL.fromString("https://example.com?next=/a/b");

    expect(url.getQueryParam("next")).toBe("/a/b");
    expect(url.toString()).toBe("https://example.com/a/b?next=/a/b");
  });

  test("but a '/' in a value is harmless once the URL has a path", () => {
    const original: string = "https://example.com/p?next=/a/b";

    expect(URL.fromString(original).toString()).toBe(original);
  });
});

/*
 * The workflow "API Get (JSON)" and "API Delete (JSON)" components hand the
 * user's URL to URL.fromString before dispatching the request, so whatever
 * that call returns is literally what goes on the wire.
 */
describe("URL query string — the workflow API component path", () => {
  const componentUrls: Array<string> = [
    'https://acme.atlassian.net/rest/api/3/search?jql=project = OPS AND status = "In Progress"',
    "https://org.crm.dynamics.com/api/data/v9.2/accounts?$filter=name eq 'acme'",
    "https://storage.example.com/blob?sig=c2lnbmF0dXJl==&se=2030-01-01",
  ];

  test.each(componentUrls)(
    "a component URL is dispatched unchanged: %s",
    (componentUrl: string) => {
      expect(URL.fromString(componentUrl).toString()).toBe(componentUrl);
    },
  );

  test("a JQL query is no longer cut at the first operator", () => {
    const dispatched: string = URL.fromString(
      "https://acme.atlassian.net/rest/api/3/search?jql=project = OPS",
    ).toString();

    expect(dispatched).not.toBe(
      "https://acme.atlassian.net/rest/api/3/search?jql=project ",
    );
    expect(dispatched).toContain("OPS");
  });
});
