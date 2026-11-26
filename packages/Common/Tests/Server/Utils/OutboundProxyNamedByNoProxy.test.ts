import OutboundProxy from "../../../Server/Utils/OutboundProxy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * OutboundProxy.isNamedByNoProxy: whether a NO_PROXY value names a URL's
 * host, read as getProxyFor reads it (proxy-from-env's reading and axios's
 * own). The synthetic runtime's egress proxy uses it to send a monitor's
 * browser through the one outbound proxy it was always sent through, apart
 * from the hosts NO_PROXY names (GHSA-9rx7-vwfj-whp7).
 */

const VARIABLES: Array<string> = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
];

describe("OutboundProxy.isNamedByNoProxy", () => {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  beforeEach(() => {
    for (const name of VARIABLES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      const value: string | undefined = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  test.each([
    { url: "https://api.example.com/", noProxy: ".example.com", named: true },
    { url: "https://example.com/", noProxy: "example.com", named: true },
    { url: "https://api.example.org/", noProxy: ".example.com", named: false },
    { url: "https://evil-example.com/", noProxy: ".example.com", named: false },
    { url: "https://intranet:8443/", noProxy: "intranet:8443", named: true },
    { url: "https://intranet:9443/", noProxy: "intranet:8443", named: false },
    { url: "http://10.1.2.3/", noProxy: "10.0.0.0/8", named: true },
    { url: "http://11.1.2.3/", noProxy: "10.0.0.0/8", named: false },
    { url: "http://[fd00::5]/", noProxy: "fd00::/8", named: true },
    { url: "http://127.0.0.1/", noProxy: "localhost", named: true },
    { url: "https://anything.test/", noProxy: "*", named: true },
    {
      url: "https://synthetic-runtime.oneuptime.invalid/",
      noProxy: "synthetic-runtime.oneuptime.invalid,.internal",
      named: true,
    },
    {
      url: "https://db.internal/",
      noProxy: "a.test b.test, .internal",
      named: true,
    },
    { url: "https://example.com/", noProxy: "", named: false },
  ])(
    "$noProxy names $url: $named",
    ({
      url,
      noProxy,
      named,
    }: {
      url: string;
      noProxy: string;
      named: boolean;
    }) => {
      expect(OutboundProxy.isNamedByNoProxy(new URL(url), noProxy)).toBe(named);
    },
  );

  test("reads the value it is given, not the environment's", () => {
    process.env["NO_PROXY"] = ".example.com";
    process.env["no_proxy"] = ".example.com";

    expect(
      OutboundProxy.isNamedByNoProxy(new URL("https://api.example.com/"), ""),
    ).toBe(false);
    expect(
      OutboundProxy.isNamedByNoProxy(
        new URL("https://api.example.org/"),
        ".example.org",
      ),
    ).toBe(true);
  });

  test("reads the environment's NO_PROXY when given none", () => {
    process.env["no_proxy"] = ".example.com";

    expect(
      OutboundProxy.isNamedByNoProxy(new URL("https://api.example.com/")),
    ).toBe(true);
    expect(
      OutboundProxy.isNamedByNoProxy(new URL("https://api.example.org/")),
    ).toBe(false);
  });

  test("answers as getProxyFor does whenever a proxy is set", () => {
    process.env["HTTP_PROXY"] = "http://proxy.test:3128";
    process.env["HTTPS_PROXY"] = "http://proxy.test:3128";

    const noProxyValues: Array<string> = [
      ".example.com",
      "example.com:8443",
      "10.0.0.0/8",
      "localhost",
      "*.svc.cluster.local",
      "*",
    ];
    const urls: Array<string> = [
      "https://example.com/",
      "https://example.com:8443/",
      "https://api.example.com/",
      "http://10.20.30.40/",
      "http://127.0.0.1:8080/",
      "http://localhost/",
      "https://api.default.svc.cluster.local/",
      "https://public.test/",
    ];

    for (const noProxy of noProxyValues) {
      process.env["NO_PROXY"] = noProxy;
      for (const url of urls) {
        expect({
          noProxy,
          url,
          named: OutboundProxy.isNamedByNoProxy(new URL(url), noProxy),
        }).toEqual({
          noProxy,
          url,
          named: OutboundProxy.getProxyFor(new URL(url)) === null,
        });
      }
    }
  });
});
