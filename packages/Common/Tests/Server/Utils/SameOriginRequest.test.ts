import SameOriginRequest, {
  BrowserRequestHeaders,
} from "../../../Server/Utils/SameOriginRequest";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * The rule behind the first check on the public incident form routes: which
 * requests a browser sent from a page that is not this instance's own. The
 * routes' own suites drive it over HTTP; this pins every branch of the rule,
 * and the origin it compares against.
 */

const INSTANCE_ORIGIN: string = "https://oneuptime.example.com";

function isForeign(
  headers: BrowserRequestHeaders & Record<string, string>,
  instanceOrigin: string | null = INSTANCE_ORIGIN,
): boolean {
  return SameOriginRequest.isForeignPageRequest({ headers, instanceOrigin });
}

describe("SameOriginRequest.isForeignPageRequest", () => {
  describe("a request with neither header", () => {
    /*
     * Curl or a server-side client - but also, over plain HTTP, another
     * site's <img> or link, which a browser sends with neither header. This
     * rule cannot tell them apart; a route that must know a GET came from
     * its own page asks for hasPageScriptHeader too (below).
     */
    it("passes, whether or not the instance has an origin configured", () => {
      expect(isForeign({})).toBe(false);
      expect(isForeign({}, null)).toBe(false);
      expect(isForeign({ "sec-fetch-site": "", origin: "" })).toBe(false);
    });
  });

  describe("Sec-Fetch-Site", () => {
    it.each(["same-origin", "none", "Same-Origin"])(
      "passes %s from a browser that sends no Origin (a same-origin read)",
      (value: string) => {
        expect(isForeign({ "sec-fetch-site": value })).toBe(false);
        expect(isForeign({ "sec-fetch-site": value }, null)).toBe(false);
      },
    );

    it.each(["cross-site", "same-site", "same-origin, cross-site", "sideways"])(
      "refuses %s, whatever the Origin says",
      (value: string) => {
        expect(isForeign({ "sec-fetch-site": value })).toBe(true);
        expect(
          isForeign({ "sec-fetch-site": value, origin: INSTANCE_ORIGIN }),
        ).toBe(true);
      },
    );

    it("refuses a header sent twice, even when both copies say same-origin", () => {
      expect(
        SameOriginRequest.isForeignPageRequest({
          headers: { "sec-fetch-site": ["same-origin", "same-origin"] },
          instanceOrigin: INSTANCE_ORIGIN,
        }),
      ).toBe(true);
    });

    it("reads an empty header as not sent, and goes on to the Origin", () => {
      expect(
        isForeign({ "sec-fetch-site": "", origin: "https://evil.example" }),
      ).toBe(true);
      expect(isForeign({ "sec-fetch-site": "", origin: INSTANCE_ORIGIN })).toBe(
        false,
      );
    });
  });

  describe("Origin", () => {
    it.each([
      [INSTANCE_ORIGIN],
      ["https://OneUptime.Example.COM"],
      ["https://oneuptime.example.com:443"],
    ])("passes this instance's own %s", (origin: string) => {
      expect(isForeign({ origin })).toBe(false);
      expect(isForeign({ "sec-fetch-site": "same-origin", origin })).toBe(
        false,
      );
    });

    it.each([
      ["another site", "https://evil.example"],
      [
        "a name that only starts like this instance's",
        "https://oneuptime.example.com.evil.example",
      ],
      [
        "a subdomain of this instance's host",
        "https://status.oneuptime.example.com",
      ],
      ["this host on another port", "https://oneuptime.example.com:8443"],
      ["this host over the other scheme", "http://oneuptime.example.com"],
      ["an opaque origin (a sandboxed frame)", "null"],
      ["something that is not a URL", "not a url"],
      ["a scheme that is not the web", "file://oneuptime.example.com"],
      ["a browser extension", "chrome-extension://abcdefghijklmnopabcdefghij"],
    ])("refuses %s", (_label: string, origin: string) => {
      expect(isForeign({ origin })).toBe(true);
    });

    it("refuses an Origin sent twice", () => {
      expect(
        SameOriginRequest.isForeignPageRequest({
          headers: { origin: [INSTANCE_ORIGIN, INSTANCE_ORIGIN] },
          instanceOrigin: INSTANCE_ORIGIN,
        }),
      ).toBe(true);
    });

    /*
     * The app answers for status pages on their owners' domains too, each
     * running its owner's JavaScript, and a browser calls such a page's
     * requests to this app "same-origin". So does a DNS-rebinding page whose
     * name was pointed at this server. Neither is this instance's own page.
     */
    it("refuses a page on another host that a browser calls same-origin", () => {
      expect(
        isForeign({
          "sec-fetch-site": "same-origin",
          origin: "https://status.customer.example",
        }),
      ).toBe(true);
      expect(isForeign({ origin: "http://rebound.attacker.example" })).toBe(
        true,
      );
    });

    it("refuses every Origin when the instance has no origin to compare it with", () => {
      expect(isForeign({ origin: INSTANCE_ORIGIN }, null)).toBe(true);
      expect(
        isForeign(
          { "sec-fetch-site": "same-origin", origin: INSTANCE_ORIGIN },
          null,
        ),
      ).toBe(true);
    });
  });

  describe("local and development hosts", () => {
    /*
     * HOST=localhost:18081 behind our nginx, which forwards the Host header
     * without the port: the rule compares the Origin with the configured
     * origin, never with the Host header, so the missing port costs nothing.
     */
    it("passes a host with a port, whatever Host header the proxy forwarded", () => {
      for (const headers of [
        { origin: "http://localhost:18081" },
        { origin: "http://localhost:18081", "sec-fetch-site": "same-origin" },
        { origin: "http://localhost:18081", host: "localhost" },
      ]) {
        expect(isForeign(headers, "http://localhost:18081")).toBe(false);
      }
    });

    it("refuses the same host name on another port", () => {
      expect(
        isForeign(
          { origin: "http://localhost:3000" },
          "http://localhost:18081",
        ),
      ).toBe(true);
      expect(
        isForeign({ origin: "http://localhost" }, "http://localhost:18081"),
      ).toBe(true);
    });

    it("compares IPv6 literal hosts", () => {
      expect(
        isForeign({ origin: "http://[::1]:3000" }, "http://[::1]:3000"),
      ).toBe(false);
      expect(
        isForeign({ origin: "http://[::2]:3000" }, "http://[::1]:3000"),
      ).toBe(true);
    });

    /*
     * The Host header names whatever host the browser went to - a rebinding
     * page's own name included - so it never vouches for an Origin.
     */
    it("never takes the Host header as the instance's", () => {
      expect(
        isForeign({
          origin: "http://rebound.attacker.example",
          host: "rebound.attacker.example",
        }),
      ).toBe(true);
    });
  });
});

/*
 * The header only a page's own script can add to a request. What another
 * site can have a browser send without a script - an <img>, a link, a
 * frame, a no-cors fetch - never carries one, and over plain HTTP it carries
 * neither Origin nor Sec-Fetch-Site either, so isForeignPageRequest lets it
 * through: this is what tells such a GET from the page's own.
 */
describe("SameOriginRequest.hasPageScriptHeader", () => {
  const NAME: string = "x-oneuptime-incident-form";

  function hasHeader(
    headers: Record<string, string | Array<string> | undefined>,
    value: string = "1",
  ): boolean {
    return SameOriginRequest.hasPageScriptHeader({
      headers,
      name: NAME,
      value,
    });
  }

  it("passes a request carrying the header set to the value", () => {
    expect(hasHeader({ [NAME]: "1" })).toBe(true);
  });

  it.each([
    ["no header at all (an <img>, a link, a frame)", {}],
    ["the header left empty", { [NAME]: "" }],
    ["another value", { [NAME]: "0" }],
    ["the value with more to it", { [NAME]: "1; page" }],
    ["another header with the value", { "x-oneuptime-incident": "1" }],
  ])(
    "refuses %s",
    (_label: string, headers: Record<string, string | Array<string>>) => {
      expect(hasHeader(headers)).toBe(false);
    },
  );

  it("refuses the header sent twice, even with the value both times", () => {
    expect(hasHeader({ [NAME]: ["1", "1"] })).toBe(false);
  });

  it("reads the value as Node hands it over, surrounding spaces aside", () => {
    expect(hasHeader({ [NAME]: " 1 " })).toBe(true);
  });

  // A header that was not sent reads as empty: an empty value must not match it.
  it("matches nothing when the value it is asked for is empty", () => {
    expect(hasHeader({}, "")).toBe(false);
    expect(hasHeader({ [NAME]: "" }, "")).toBe(false);
  });
});

describe("SameOriginRequest.getInstanceOrigin", () => {
  /*
   * HOST and HTTP_PROTOCOL are read once, when EnvironmentConfig loads, so
   * each case loads a fresh copy of the module under its own environment.
   */
  function instanceOriginFor(env: {
    host: string | undefined;
    httpProtocol: string;
  }): string | null {
    const previousHost: string | undefined = process.env["HOST"];
    const previousProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    if (env.host === undefined) {
      delete process.env["HOST"];
    } else {
      process.env["HOST"] = env.host;
    }

    process.env["HTTP_PROTOCOL"] = env.httpProtocol;

    let instanceOrigin: string | null = null;

    try {
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        /* eslint-disable @typescript-eslint/no-require-imports */
        const isolated: typeof SameOriginRequest =
          require("../../../Server/Utils/SameOriginRequest").default;
        /* eslint-enable @typescript-eslint/no-require-imports */
        /* eslint-enable @typescript-eslint/no-var-requires */

        instanceOrigin = isolated.getInstanceOrigin();
      });
    } finally {
      if (previousHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = previousHost;
      }

      if (previousProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = previousProtocol;
      }
    }

    return instanceOrigin;
  }

  it.each([
    ["oneuptime.example.com", "https", "https://oneuptime.example.com"],
    ["localhost", "http", "http://localhost"],
    ["localhost:18081", "http", "http://localhost:18081"],
    // A default port is dropped, as a browser drops it from an Origin.
    ["localhost:80", "http", "http://localhost"],
    ["OneUptime.Example.com:443", "https", "https://oneuptime.example.com"],
    [
      "oneuptime.example.com:8443",
      "https",
      "https://oneuptime.example.com:8443",
    ],
  ])(
    "reads HOST=%s with HTTP_PROTOCOL=%s as %s",
    (host: string, httpProtocol: string, expected: string) => {
      expect(instanceOriginFor({ host, httpProtocol })).toBe(expected);
    },
  );

  it("has no origin when HOST is not set", () => {
    expect(instanceOriginFor({ host: undefined, httpProtocol: "https" })).toBe(
      null,
    );
    expect(instanceOriginFor({ host: "", httpProtocol: "https" })).toBe(null);
  });

  /*
   * The same origin the passkey sign-in compares a browser's Origin with
   * (new URL(HTTP_PROTOCOL + HOST).origin), so one instance never has two
   * ideas of its own address.
   */
  it("is the origin the dashboard's own API address is built from", () => {
    expect(
      instanceOriginFor({
        host: "oneuptime.example.com",
        httpProtocol: "https",
      }),
    ).toBe(new URL("https://oneuptime.example.com").origin);
  });
});

describe("SameOriginRequest.isJsonContentType", () => {
  it.each([
    "application/json",
    "application/json; charset=utf-8",
    // What the form page's API client sends.
    "application/json;charset=UTF-8",
    "Application/JSON",
    " application/json ;charset=UTF-8",
  ])("takes %s", (value: string) => {
    expect(SameOriginRequest.isJsonContentType(value)).toBe(true);
  });

  /*
   * The first three are what another site's page can have a browser send
   * with no preflight - an HTML form's kinds.
   */
  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=----form",
    "text/plain",
    "text/plain; charset=application/json",
    "application/jsonp",
    "application/json-patch+json",
  ])("refuses %s", (value: string) => {
    expect(SameOriginRequest.isJsonContentType(value)).toBe(false);
  });

  it("refuses a request that names no type", () => {
    expect(SameOriginRequest.isJsonContentType(undefined)).toBe(false);
    expect(SameOriginRequest.isJsonContentType("")).toBe(false);
  });
});
