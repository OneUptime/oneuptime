import Email from "../../../Types/Email";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";

/*
 * toString() never emitted the query string for a mailto: URL, so every
 * prefilled field of a mail link was silently dropped:
 * "mailto:a@b.com?subject=Hello&body=Hi" went back out as "mailto:a@b.com"
 * and the link opened on an empty draft.
 *
 * The parse was never the problem — `params` held { subject, body } all along.
 * The suffix was appended INSIDE the route-handling branch, and mailto skips
 * that branch on purpose (it has no authority to trim and no path to append),
 * so the query went with the route. mailto now returns early with the suffix
 * attached, the way the opaque tel:/sms: branch above it already did.
 */
describe("mailto query string — the prefilled fields survive toString", () => {
  test("a subject on its own reaches the output", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=Hello");

    expect(url.getQueryParam("subject")).toBe("Hello");
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });

  test("a subject and a body both reach the output", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=Hello&body=Hi");

    expect(url.params).toEqual({ subject: "Hello", body: "Hi" });
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello&body=Hi");
  });

  test("the parse was always right — only the output was lossy", () => {
    /*
     * Pins the exact shape of the bug rather than just its fix: params were
     * correct before the change and are asserted separately from toString, so
     * a regression that breaks only one of the two still shows which one.
     */
    const url: URL = URL.fromString("mailto:a@b.com?subject=Hello&body=Hi");

    expect(url.params).toEqual({ subject: "Hello", body: "Hi" });
    expect(url.toString()).not.toBe("mailto:a@b.com");
    expect(url.toString()).toContain("subject=Hello");
    expect(url.toString()).toContain("body=Hi");
  });

  test("cc and bcc survive alongside subject and body", () => {
    const url: URL = URL.fromString(
      "mailto:a@b.com?cc=c@d.com&bcc=e@f.com&subject=Hello&body=Hi",
    );

    expect(url.params).toEqual({
      cc: "c@d.com",
      bcc: "e@f.com",
      subject: "Hello",
      body: "Hi",
    });
    expect(url.toString()).toBe(
      "mailto:a@b.com?cc=c@d.com&bcc=e@f.com&subject=Hello&body=Hi",
    );
  });

  test("a mailto with no query gains no stray '?'", () => {
    const url: URL = URL.fromString("mailto:support@oneuptime.com");

    expect(url.toString()).toBe("mailto:support@oneuptime.com");
    expect(url.toString()).not.toContain("?");
  });
});

describe("mailto query string — a value that contains '='", () => {
  test("an '=' inside a subject is not truncated", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=a=b");

    expect(url.getQueryParam("subject")).toBe("a=b");
    expect(url.toString()).toBe("mailto:a@b.com?subject=a=b");
  });

  test("an '=' laden body keeps its whole expression", () => {
    const url: URL = URL.fromString(
      "mailto:ops@example.com?subject=Alert&body=filter: status = open AND team = ops",
    );

    expect(url.getQueryParam("body")).toBe(
      "filter: status = open AND team = ops",
    );
    expect(url.toString()).toBe(
      "mailto:ops@example.com?subject=Alert&body=filter: status = open AND team = ops",
    );
  });

  test("only the first '=' separates, however many follow", () => {
    const url: URL = URL.fromString("mailto:a@b.com?body=x=y=z");

    expect(url.params).toEqual({ body: "x=y=z" });
    expect(url.toString()).toBe("mailto:a@b.com?body=x=y=z");
  });

  test("'==' padding does not swallow the params that follow it", () => {
    const url: URL = URL.fromString(
      "mailto:a@b.com?ref=YWJjZGVmZ2g==&subject=Hello",
    );

    expect(url.params).toEqual({ ref: "YWJjZGVmZ2g==", subject: "Hello" });
    expect(url.toString()).toBe(
      "mailto:a@b.com?ref=YWJjZGVmZ2g==&subject=Hello",
    );
  });
});

describe("mailto query string — round trip is lossless", () => {
  const roundTripCases: Array<string> = [
    "mailto:a@b.com",
    "mailto:a@b.com?subject=Hello",
    "mailto:a@b.com?subject=Hello&body=Hi",
    "mailto:a@b.com?body=Hi&subject=Hello",
    "mailto:a@b.com?cc=c@d.com&bcc=e@f.com&subject=Hello&body=Hi",
    "mailto:a@b.com?subject=a=b",
    "mailto:a@b.com?body=x=y=z",
    "mailto:a@b.com?ref=YWJjZGVmZ2g==&subject=Hello",
    "mailto:a@b.com?subject=Hello%20World&body=Line%0A2",
    "mailto:a@b.com?subject=café ✓",
    "mailto:a@b.com?body=see?tab=1",
    "mailto:a@b.com?body=/a/b",
    "mailto:a@b.com?flag",
    "mailto:a+tag@b.com?subject=Hello",
    "mailto:first.last@sub.example.co.uk?subject=Hello",
    "mailto:support@oneuptime.com?subject=OneUptime%20Microsoft%20Teams%20Bot",
    "mailto:security@oneuptime.com?subject=Security%20documentation%20request",
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

  test("fromURL round trips a mailto with a query", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=Hello&body=Hi");

    expect(URL.fromURL(url).toString()).toBe(
      "mailto:a@b.com?subject=Hello&body=Hi",
    );
  });
});

describe("mailto query string — degenerate segments", () => {
  test("a trailing '?' produces no params and no '?'", () => {
    const url: URL = URL.fromString("mailto:a@b.com?");

    expect(url.params).toEqual({});
    expect(url.toString()).toBe("mailto:a@b.com");
  });

  test("a value-less param is kept and re-emits bare", () => {
    const url: URL = URL.fromString("mailto:a@b.com?flag");

    expect(url.params).toEqual({ flag: "" });
    expect(url.toString()).toBe("mailto:a@b.com?flag");
    expect(url.toString()).not.toContain("flag=");
  });

  test("an explicitly empty subject re-emits bare", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=");

    expect(url.params).toEqual({ subject: "" });
    expect(url.toString()).toBe("mailto:a@b.com?subject");
  });

  test("a later duplicate key wins", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=one&subject=two");

    expect(url.getQueryParam("subject")).toBe("two");
    expect(url.toString()).toBe("mailto:a@b.com?subject=two");
  });

  test("a '?' inside a body is not truncated", () => {
    /*
     * The address is taken from everything before the FIRST "?", and the query
     * is everything after it — so a body that carries its own "?" survives.
     */
    const url: URL = URL.fromString("mailto:a@b.com?body=see?tab=1");

    expect(url.getQueryParam("body")).toBe("see?tab=1");
    expect(url.toString()).toBe("mailto:a@b.com?body=see?tab=1");
  });

  test("a '/' inside a body does not fabricate a route", () => {
    /*
     * Unlike a path-less https URL, whose authority is split off at the first
     * "/" before the query is separated, a mailto never reaches that code:
     * fromString takes its address from url.split("?")[0].
     */
    const url: URL = URL.fromString("mailto:a@b.com?body=/a/b");

    expect(url.getQueryParam("body")).toBe("/a/b");
    expect(url.route.toString()).toBe("");
    expect(url.toString()).toBe("mailto:a@b.com?body=/a/b");
  });

  test("a unicode subject is passed through untouched", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=café ✓");

    expect(url.getQueryParam("subject")).toBe("café ✓");
    expect(url.toString()).toBe("mailto:a@b.com?subject=café ✓");
  });

  test("a percent-encoded subject and body are passed through verbatim", () => {
    const url: URL = URL.fromString(
      "mailto:a@b.com?subject=Hello%20World&body=Line%0A2",
    );

    expect(url.params).toEqual({
      subject: "Hello%20World",
      body: "Line%0A2",
    });
    expect(url.toString()).toBe(
      "mailto:a@b.com?subject=Hello%20World&body=Line%0A2",
    );
  });

  test("a pair with no key is dropped", () => {
    const url: URL = URL.fromString("mailto:a@b.com?=novalue&subject=Hello");

    expect(url.params).toEqual({ subject: "Hello" });
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });
});

describe("mailto query string — the address is still an Email", () => {
  test("the email is readable with a query present", () => {
    const url: URL = URL.fromString("mailto:support@oneuptime.com?subject=Hi");

    expect(url.email.toString()).toBe("support@oneuptime.com");
    expect(url.protocol).toBe(Protocol.MAIL);
    expect(url.toString()).toBe("mailto:support@oneuptime.com?subject=Hi");
  });

  test("a plus-addressed recipient keeps its tag", () => {
    const url: URL = URL.fromString("mailto:a+tag@b.com?subject=Hello");

    expect(url.email.toString()).toBe("a+tag@b.com");
    expect(url.toString()).toBe("mailto:a+tag@b.com?subject=Hello");
  });

  test("an upper-case scheme is normalised and keeps its query", () => {
    const url: URL = URL.fromString("MAILTO:a@b.com?subject=Hello");

    expect(url.email.toString()).toBe("a@b.com");
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });

  test("a mailto payload that is not an email still keeps its query", () => {
    /*
     * "notanemail" fails Email.isValid, so the constructor stores it as a
     * hostname and `email` is never set. The guard has to catch this case on
     * the "mailto:" prefix rather than on `email`, or the query would be lost
     * again for exactly these values.
     */
    const url: URL = URL.fromString("mailto:notanemail?subject=Hello");

    expect(url.email).toBeUndefined();
    expect(url.hostname.toString()).toBe("notanemail");
    expect(url.toString()).toBe("mailto:notanemail?subject=Hello");
  });
});

describe("mailto query string — constructed rather than parsed", () => {
  test("the constructor takes a query alongside an Email", () => {
    const url: URL = new URL(
      Protocol.MAIL,
      new Email("a@b.com"),
      undefined,
      "subject=Hello&body=Hi",
    );

    expect(url.params).toEqual({ subject: "Hello", body: "Hi" });
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello&body=Hi");
  });

  test("the constructor takes a query alongside a string address", () => {
    const url: URL = new URL(
      Protocol.MAIL,
      "a@b.com",
      undefined,
      "subject=Hello",
    );

    expect(url.email.toString()).toBe("a@b.com");
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });

  test("addQueryParam prefills a mailto that had no query", () => {
    const url: URL = URL.fromString("mailto:a@b.com").addQueryParam(
      "subject",
      "Hello",
    );

    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });

  test("addQueryParam with encode still round trips", () => {
    const url: URL = URL.fromString("mailto:a@b.com").addQueryParam(
      "subject",
      "Hello World",
      true,
    );

    expect(url.getQueryParam("subject")).toBe("Hello%20World");
    expect(URL.fromString(url.toString()).getQueryParam("subject")).toBe(
      "Hello%20World",
    );
  });

  test("addQueryParams merges a body into an existing subject", () => {
    const url: URL = URL.fromString(
      "mailto:a@b.com?subject=Hello",
    ).addQueryParams({ body: "Hi" });

    expect(url.params).toEqual({ subject: "Hello", body: "Hi" });
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello&body=Hi");
  });

  test("removeQueryString strips the prefilled fields back off", () => {
    const url: URL = URL.fromString(
      "mailto:a@b.com?subject=Hello&body=Hi",
    ).removeQueryString();

    expect(url.params).toEqual({});
    expect(url.toString()).toBe("mailto:a@b.com");
  });
});

describe("mailto query string — crossing the wire", () => {
  test("toJSON carries the query", () => {
    const url: URL = URL.fromString("mailto:a@b.com?subject=Hello&body=Hi");

    expect(url.toJSON()).toEqual({
      _type: "URL",
      value: "mailto:a@b.com?subject=Hello&body=Hi",
    });
  });

  test("fromJSON restores a mailto with its query intact", () => {
    const url: URL = URL.fromJSON(
      URL.fromString("mailto:a@b.com?subject=Hello&body=Hi").toJSON(),
    );

    expect(url.getQueryParam("subject")).toBe("Hello");
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello&body=Hi");
  });

  test("a mailto with a query is not treated as malformed", () => {
    const url: URL = URL.fromStringLenient("mailto:a@b.com?subject=Hello");

    expect(url.isMalformed()).toBe(false);
    expect(url.toString()).toBe("mailto:a@b.com?subject=Hello");
  });
});

/*
 * The fix returns early for mailto instead of widening the branch that builds
 * the route, so the branch itself moved. These pin the shapes that go through
 * it — every one of them held before the change and must still hold.
 */
describe("mailto query string — every other scheme is unaffected", () => {
  const untouchedCases: Array<string> = [
    "https://example.com/a/b?x=1",
    "https://example.com/path",
    "http://localhost:5000/api/test?a=1",
    "wss://example.com/socket?a=1",
    "mongodb://example.com/db?a=1",
    "https://user:token@hooks.example.com/x",
    "https://example.com/p?flag",
    "https://example.com/p?a=b=c=d",
    "tel:+15555550123?ref=a=b",
    "sms:+15555550123?body=x=1&y=2",
  ];

  test.each(untouchedCases)("%s still round trips", (original: string) => {
    expect(URL.fromString(original).toString()).toBe(original);
  });

  test("a path-less https URL still gains its trailing slash", () => {
    expect(URL.fromString("https://example.com").toString()).toBe(
      "https://example.com/",
    );
  });

  test("a route given with a leading slash is not doubled", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("example.com"),
      new Route("/a/b"),
      "x=1",
    );

    expect(url.toString()).toBe("https://example.com/a/b?x=1");
  });

  test("a route given without a leading slash still gets one", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("example.com"),
      new Route("a/b"),
      "x=1",
    );

    expect(url.toString()).toBe("https://example.com/a/b?x=1");
  });

  test("an empty route still renders as a bare slash", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("example.com"),
      new Route(""),
      "x=1",
    );

    expect(url.toString()).toBe("https://example.com/?x=1");
  });

  test("a malformed URL is still echoed back raw", () => {
    expect(URL.fromStringLenient("https://tel:1234567890/").toString()).toBe(
      "https://tel:1234567890/",
    );
  });
});
