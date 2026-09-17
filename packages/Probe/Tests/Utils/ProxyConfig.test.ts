import URL from "Common/Types/API/URL";
import Protocol from "Common/Types/API/Protocol";
import Hostname from "Common/Types/API/Hostname";
import Route from "Common/Types/API/Route";

/*
 * ProxyConfig reads HTTP_PROXY_URL / HTTPS_PROXY_URL / NO_PROXY from
 * ../Config at import time, so the config module is mocked and the module
 * under test is re-imported per scenario with jest.isolateModules(). That is
 * also why ProxyConfig's `isConfigured` latch does not leak between tests.
 *
 * The behaviour worth pinning here is the NO_PROXY matching: the file has
 * ~300 lines of host/port/subdomain/scheme parsing with no coverage, and
 * getting it wrong means either leaking internal traffic through an external
 * proxy or failing to reach an internal host at all.
 */

const HTTP_PROXY: string = "http://proxy.internal:3128";
const HTTPS_PROXY: string = "http://proxy.internal:3129";

interface ProxyConfigModule {
  configure: () => void;
  isProxyConfigured: () => boolean;
  getHttpProxyUrl: () => string | null;
  getHttpsProxyUrl: () => string | null;
  getHttpProxyAgent: (targetUrl?: URL | string) => unknown;
  getHttpsProxyAgent: (targetUrl?: URL | string) => unknown;
  getRequestProxyAgents: (
    targetUrl: URL | string,
    options?: {
      rejectUnauthorized?: boolean;
      cert?: string;
      key?: string;
      passphrase?: string;
    },
  ) => { httpAgent?: unknown; httpsAgent?: unknown };
}

type LoadProxyConfigFunction = (config: {
  httpProxyUrl?: string | null;
  httpsProxyUrl?: string | null;
  noProxy?: Array<string>;
  configure?: boolean;
}) => ProxyConfigModule;

/*
 * Loads a fresh ProxyConfig bound to the given config values. `configure`
 * defaults to true because almost every behaviour below only applies once the
 * proxy has actually been configured.
 */
const loadProxyConfig: LoadProxyConfigFunction = (config: {
  httpProxyUrl?: string | null;
  httpsProxyUrl?: string | null;
  noProxy?: Array<string>;
  configure?: boolean;
}): ProxyConfigModule => {
  let loaded: ProxyConfigModule | null = null;

  jest.isolateModules(() => {
    jest.doMock("../../Config", () => {
      return {
        __esModule: true,
        HTTP_PROXY_URL:
          config.httpProxyUrl === undefined ? null : config.httpProxyUrl,
        HTTPS_PROXY_URL:
          config.httpsProxyUrl === undefined ? null : config.httpsProxyUrl,
        NO_PROXY: config.noProxy || [],
      };
    });

    /*
     * A synchronous require is the only way to pick up the mocked ../Config
     * inside isolateModules; a static import would have been hoisted above
     * jest.doMock and bound to the real config.
     */
    /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    loaded = require("../../Utils/ProxyConfig").default as ProxyConfigModule;
  });

  const proxyConfig: ProxyConfigModule = loaded!;

  if (config.configure !== false) {
    proxyConfig.configure();
  }

  return proxyConfig;
};

type MakeUrlFunction = (data: {
  protocol: Protocol;
  hostname: string;
  route?: string;
}) => URL;

const makeUrl: MakeUrlFunction = (data: {
  protocol: Protocol;
  hostname: string;
  route?: string;
}): URL => {
  return new URL(
    data.protocol,
    new Hostname(data.hostname),
    data.route ? new Route(data.route) : undefined,
  );
};

describe("ProxyConfig", () => {
  afterEach(() => {
    jest.resetModules();
  });

  describe("configure / isProxyConfigured", () => {
    test("should not be configured when no proxy urls are set", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({});

      expect(proxyConfig.isProxyConfigured()).toBe(false);
      expect(proxyConfig.getHttpProxyUrl()).toBeNull();
      expect(proxyConfig.getHttpsProxyUrl()).toBeNull();
    });

    test("should be configured once a proxy url is set", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        httpsProxyUrl: HTTPS_PROXY,
      });

      expect(proxyConfig.isProxyConfigured()).toBe(true);
      expect(proxyConfig.getHttpProxyUrl()).toEqual(HTTP_PROXY);
      expect(proxyConfig.getHttpsProxyUrl()).toEqual(HTTPS_PROXY);
    });

    test("should report not configured until configure() runs", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        configure: false,
      });

      expect(proxyConfig.isProxyConfigured()).toBe(false);

      proxyConfig.configure();

      expect(proxyConfig.isProxyConfigured()).toBe(true);
    });

    test("should be safe to call configure more than once", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
      });

      const firstAgent: unknown = proxyConfig.getHttpProxyAgent();
      proxyConfig.configure();

      // The latch means the cached agent is reused, not rebuilt.
      expect(proxyConfig.getHttpProxyAgent()).toBe(firstAgent);
    });
  });

  describe("getRequestProxyAgents", () => {
    test("should return no agents when no proxy is configured", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({});

      expect(proxyConfig.getRequestProxyAgents("https://example.com")).toEqual(
        {},
      );
    });

    test("should return the cached agents for a normal request", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        httpsProxyUrl: HTTPS_PROXY,
      });

      const agents: { httpAgent?: unknown; httpsAgent?: unknown } =
        proxyConfig.getRequestProxyAgents("https://example.com");

      expect(agents.httpAgent).toBe(proxyConfig.getHttpProxyAgent());
      expect(agents.httpsAgent).toBe(proxyConfig.getHttpsProxyAgent());
    });

    test("should build fresh agents when rejectUnauthorized is false", () => {
      /*
       * The cached agents fixed their TLS options at construction, so opting
       * in to untrusted certificates must not reuse them.
       */
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        httpsProxyUrl: HTTPS_PROXY,
      });

      const agents: { httpAgent?: unknown; httpsAgent?: unknown } =
        proxyConfig.getRequestProxyAgents("https://example.com", {
          rejectUnauthorized: false,
        });

      expect(agents.httpsAgent).toBeDefined();
      expect(agents.httpsAgent).not.toBe(proxyConfig.getHttpsProxyAgent());
      expect(agents.httpAgent).not.toBe(proxyConfig.getHttpProxyAgent());
    });

    test("should build fresh agents when a client certificate is supplied", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpsProxyUrl: HTTPS_PROXY,
      });

      const agents: { httpsAgent?: unknown } =
        proxyConfig.getRequestProxyAgents("https://example.com", {
          cert: "cert-pem",
          key: "key-pem",
          passphrase: "secret",
        });

      expect(agents.httpsAgent).toBeDefined();
      expect(agents.httpsAgent).not.toBe(proxyConfig.getHttpsProxyAgent());
    });

    test("should ignore a certificate supplied without its key", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpsProxyUrl: HTTPS_PROXY,
      });

      const agents: { httpsAgent?: unknown } =
        proxyConfig.getRequestProxyAgents("https://example.com", {
          cert: "cert-pem",
        });

      // Incomplete client cert means the cached agent is still correct.
      expect(agents.httpsAgent).toBe(proxyConfig.getHttpsProxyAgent());
    });

    test("should return no agents for a NO_PROXY target", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        httpsProxyUrl: HTTPS_PROXY,
        noProxy: ["internal.example.com"],
      });

      expect(
        proxyConfig.getRequestProxyAgents("https://internal.example.com"),
      ).toEqual({});
    });
  });

  describe("NO_PROXY matching", () => {
    type BypassesFunction = (data: {
      noProxy: Array<string>;
      target: URL | string;
    }) => boolean;

    /*
     * A target bypasses the proxy when no agent is handed back for it, which
     * is the observable effect of shouldBypassProxy (a private method).
     */
    const bypasses: BypassesFunction = (data: {
      noProxy: Array<string>;
      target: URL | string;
    }): boolean => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpProxyUrl: HTTP_PROXY,
        httpsProxyUrl: HTTPS_PROXY,
        noProxy: data.noProxy,
      });

      return proxyConfig.getHttpsProxyAgent(data.target) === null;
    };

    test("should match an exact hostname", () => {
      expect(
        bypasses({
          noProxy: ["internal.example.com"],
          target: "https://internal.example.com/path",
        }),
      ).toBe(true);
    });

    test("should not match a different hostname", () => {
      expect(
        bypasses({
          noProxy: ["internal.example.com"],
          target: "https://external.example.com",
        }),
      ).toBe(false);
    });

    test("should be case insensitive", () => {
      expect(
        bypasses({
          noProxy: ["Internal.Example.COM"],
          target: "https://INTERNAL.example.com",
        }),
      ).toBe(true);
    });

    test("should bypass everything for '*'", () => {
      expect(
        bypasses({ noProxy: ["*"], target: "https://anything.example.com" }),
      ).toBe(true);
    });

    test("should match subdomains for a leading dot", () => {
      expect(
        bypasses({
          noProxy: [".example.com"],
          target: "https://a.example.com",
        }),
      ).toBe(true);
      // The apex itself matches too.
      expect(
        bypasses({ noProxy: [".example.com"], target: "https://example.com" }),
      ).toBe(true);
    });

    test("should match subdomains for a leading wildcard", () => {
      expect(
        bypasses({
          noProxy: ["*.example.com"],
          target: "https://deep.nested.example.com",
        }),
      ).toBe(true);
    });

    test("should not treat a suffix as a subdomain match", () => {
      // "notexample.com" must not match "*.example.com".
      expect(
        bypasses({
          noProxy: ["*.example.com"],
          target: "https://notexample.com",
        }),
      ).toBe(false);
    });

    test("should not match a bare hostname pattern against a subdomain", () => {
      expect(
        bypasses({ noProxy: ["example.com"], target: "https://a.example.com" }),
      ).toBe(false);
    });

    test("should honour a port in the pattern", () => {
      expect(
        bypasses({
          noProxy: ["internal.example.com:8443"],
          target: "https://internal.example.com:8443",
        }),
      ).toBe(true);

      expect(
        bypasses({
          noProxy: ["internal.example.com:8443"],
          target: "https://internal.example.com:9443",
        }),
      ).toBe(false);
    });

    test("should match a pattern port against the scheme's default port", () => {
      /*
       * The target has no explicit port, so the effective port comes from the
       * scheme: 443 for https, 80 for http.
       */
      expect(
        bypasses({
          noProxy: ["internal.example.com:443"],
          target: "https://internal.example.com",
        }),
      ).toBe(true);

      expect(
        bypasses({
          noProxy: ["internal.example.com:80"],
          target: "http://internal.example.com",
        }),
      ).toBe(true);

      expect(
        bypasses({
          noProxy: ["internal.example.com:80"],
          target: "https://internal.example.com",
        }),
      ).toBe(false);
    });

    test("should accept a pattern written as a full url", () => {
      expect(
        bypasses({
          noProxy: ["https://internal.example.com"],
          target: "https://internal.example.com",
        }),
      ).toBe(true);
    });

    test("should accept a target with no scheme", () => {
      expect(
        bypasses({
          noProxy: ["internal.example.com"],
          target: "internal.example.com",
        }),
      ).toBe(true);
    });

    test("should match any of several patterns", () => {
      expect(
        bypasses({
          noProxy: ["a.example.com", "b.example.com", "c.example.com"],
          target: "https://b.example.com",
        }),
      ).toBe(true);
    });

    test("should ignore blank patterns", () => {
      expect(
        bypasses({ noProxy: ["", "   "], target: "https://example.com" }),
      ).toBe(false);
    });

    test("should match an ip address literally", () => {
      expect(
        bypasses({ noProxy: ["10.0.0.5"], target: "http://10.0.0.5:8080" }),
      ).toBe(true);
    });

    test("should work with a OneUptime URL object", () => {
      expect(
        bypasses({
          noProxy: ["internal.example.com"],
          target: makeUrl({
            protocol: Protocol.HTTPS,
            hostname: "internal.example.com",
            route: "/status",
          }),
        }),
      ).toBe(true);
    });

    test("should not bypass when NO_PROXY is empty", () => {
      expect(bypasses({ noProxy: [], target: "https://example.com" })).toBe(
        false,
      );
    });

    test("should not bypass when no target is given", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        httpsProxyUrl: HTTPS_PROXY,
        noProxy: ["*"],
      });

      // No target means there is nothing to match NO_PROXY against.
      expect(proxyConfig.getHttpsProxyAgent()).not.toBeNull();
    });

    test("should not bypass when the proxy is not configured", () => {
      const proxyConfig: ProxyConfigModule = loadProxyConfig({
        noProxy: ["*"],
      });

      /*
       * With no proxy configured there is no agent either way, but the
       * important part is that getRequestProxyAgents does not throw.
       */
      expect(proxyConfig.getRequestProxyAgents("https://example.com")).toEqual(
        {},
      );
    });
  });
});
