import {
  getRequestHost,
  normalizeRequestHost,
} from "../../../Server/Utils/RequestHost";
import { normalizeStatusPageRequestHost } from "../../../Server/Utils/StatusPageCustomizationAccess";
import SameOriginRequest, {
  BrowserRequestHeaders,
} from "../../../Server/Utils/SameOriginRequest";
import { describe, expect, it } from "@jest/globals";

/*
 * The host a request was sent to (Server/Utils/RequestHost): the name the
 * browser connected to, read from the request's own Host header - never
 * X-Forwarded-Host, which a caller writes and several ingress locations pass
 * on. A form's own domain answers with the form of that name, and counts the
 * request under it, by this; a status page's custom domain decides by it
 * whether its owner's code may run.
 *
 * And the rule the form's routes on its own domain hold a browser to
 * (SameOriginRequest.isForeignPageRequestToHost): only a page on that very
 * host may call them.
 */

describe("normalizeRequestHost", () => {
  it.each([
    ["report.acme.com", "report.acme.com"],
    ["Report.ACME.com", "report.acme.com"],
    ["report.acme.com:443", "report.acme.com"],
    ["  report.acme.com  ", "report.acme.com"],
    // The fully qualified spelling is the same host.
    ["report.acme.com.", "report.acme.com"],
    ["report.acme.com.:8443", "report.acme.com"],
    ["localhost:3000", "localhost"],
    ["10.0.0.5:8080", "10.0.0.5"],
  ])("reads %j as %j", (raw: string, host: string) => {
    expect(normalizeRequestHost(raw)).toBe(host);
  });

  it.each([
    ["nothing", undefined],
    ["an empty header", ""],
    ["spaces", "   "],
    ["user information", "user@report.acme.com"],
    ["two hosts", "report.acme.com,evil.example"],
    ["a path", "report.acme.com/admin"],
    ["a query", "report.acme.com?x=1"],
    ["a fragment", "report.acme.com#top"],
    ["a space inside", "report acme.com"],
  ])("refuses %s", (_label: string, raw: string | undefined) => {
    expect(normalizeRequestHost(raw)).toBeNull();
  });

  it("is the rule a status page's custom domain is judged by, too", () => {
    for (const raw of [
      "Status.Acme.com:443",
      "status.acme.com.",
      "user@status.acme.com",
      "",
    ]) {
      expect(normalizeStatusPageRequestHost(raw)).toBe(
        normalizeRequestHost(raw),
      );
    }
  });
});

describe("getRequestHost", () => {
  it("reads the request's own Host header", () => {
    expect(getRequestHost({ headers: { host: "Report.Acme.com:443" } })).toBe(
      "report.acme.com",
    );
  });

  it("never X-Forwarded-Host, which a caller writes", () => {
    expect(
      getRequestHost({
        headers: {
          host: "status.acme.com",
          "x-forwarded-host": "report.acme.com",
        },
      }),
    ).toBe("status.acme.com");

    expect(
      getRequestHost({ headers: { "x-forwarded-host": "report.acme.com" } }),
    ).toBeNull();
  });

  it("a Host sent twice is no one host", () => {
    expect(
      getRequestHost({
        headers: { host: ["report.acme.com", "evil.example"] },
      }),
    ).toBeNull();
  });

  it("a request with no headers has no host", () => {
    expect(getRequestHost({})).toBeNull();
    expect(getRequestHost({ headers: {} })).toBeNull();
  });
});

describe("SameOriginRequest.isForeignPageRequestToHost", () => {
  const HOST: string = "report.acme.com";

  function isForeign(
    headers: BrowserRequestHeaders & Record<string, string>,
    hostname: string | null = HOST,
  ): boolean {
    return SameOriginRequest.isForeignPageRequestToHost({
      headers,
      hostname,
    });
  }

  it("lets through a request with neither header: curl, a server", () => {
    expect(isForeign({})).toBe(false);
    expect(isForeign({}, null)).toBe(false);
  });

  it.each([
    ["the domain's own page", "https://report.acme.com"],
    ["the page over plain HTTP", "http://report.acme.com"],
    ["the page at another port", "https://report.acme.com:8443"],
    ["the page, in capitals", "https://REPORT.acme.com"],
  ])("lets through %s", (_label: string, origin: string) => {
    expect(isForeign({ origin })).toBe(false);
    expect(isForeign({ origin, "sec-fetch-site": "same-origin" })).toBe(false);
  });

  it.each([
    ["another site's page", "https://evil.example"],
    ["another subdomain of the customer's own", "https://status.acme.com"],
    ["the customer's root domain", "https://acme.com"],
    ["OneUptime's own domain", "https://oneuptime.example.com"],
    ["a page that hides its origin", "null"],
    ["an origin that is no origin", "not a url"],
  ])("refuses %s", (_label: string, origin: string) => {
    expect(isForeign({ origin })).toBe(true);
  });

  it.each(["cross-site", "same-site", "sideways"])(
    "refuses Sec-Fetch-Site %s, whatever the Origin says",
    (value: string) => {
      expect(isForeign({ "sec-fetch-site": value })).toBe(true);
      expect(
        isForeign({
          "sec-fetch-site": value,
          origin: "https://report.acme.com",
        }),
      ).toBe(true);
    },
  );

  it("lets through Sec-Fetch-Site same-origin and none", () => {
    expect(isForeign({ "sec-fetch-site": "same-origin" })).toBe(false);
    expect(isForeign({ "sec-fetch-site": "none" })).toBe(false);
  });

  it("with no host to compare, refuses a request that names a page", () => {
    expect(isForeign({ origin: "https://report.acme.com" }, null)).toBe(true);
  });
});
