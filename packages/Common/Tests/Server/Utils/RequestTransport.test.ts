import RequestTransport from "../../../Server/Utils/RequestTransport";
import {
  DEFAULT_HSTS_MAX_AGE_SECONDS,
  parseHstsMaxAgeSeconds,
} from "../../../Server/EnvironmentConfig";
import { ExpressRequest } from "../../../Server/Utils/Express";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * WHETHER A BROWSER IS ON HTTPS, AND WHICH ADDRESS IS TOLD TO STAY THERE.
 *
 * RequestTransport is the one rule behind two protections:
 *
 *   - CookieUtil marks every cookie Secure when the browser is on HTTPS, so
 *     an http:// request to the same host - typed, followed, or injected by
 *     someone on the network - never carries a session in clear text;
 *   - StartServer sends Strict-Transport-Security for the installation's own
 *     address when the installation is served over HTTPS.
 *
 * These cases hold the rule itself: which signals make a request HTTPS (the
 * scheme the ingress forwards, and HTTP_PROTOCOL=https for HOST only), which
 * never do (X-Forwarded-Host, a malformed Host header, a custom domain of an
 * HTTPS installation reached over plain HTTP), and what the HSTS header says.
 * CookiesStayOnHttps.test.ts drives the same rule through a real Express app.
 */

type TransportEnv = {
  httpProtocol: string;
  host: string;
  hstsMaxAgeSeconds: number;
};

type TransportEnvGlobal = typeof globalThis & {
  __requestTransportEnv: TransportEnv;
};

const INSTALLATION_HOST: string = "oneuptime.example.com";

// RFC 6797's max-age: delta-seconds, digits only. Browsers ignore anything else.
const MAX_AGE_HEADER: RegExp = /^max-age=\d+$/;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const envGlobal: TransportEnvGlobal = globalThis as TransportEnvGlobal;

  envGlobal.__requestTransportEnv = {
    httpProtocol: "https://",
    host: "oneuptime.example.com",
    hstsMaxAgeSeconds: 31536000,
  };

  for (const [name, key] of [
    ["HttpProtocol", "httpProtocol"],
    ["Host", "host"],
    ["HstsMaxAgeSeconds", "hstsMaxAgeSeconds"],
  ] as Array<[string, keyof TransportEnv]>) {
    Object.defineProperty(mocked, name, {
      configurable: true,
      enumerable: true,
      get: (): unknown => {
        return envGlobal.__requestTransportEnv[key];
      },
    });
  }

  return mocked;
});

function setEnv(overrides: Partial<TransportEnv>): void {
  const envGlobal: TransportEnvGlobal = globalThis as TransportEnvGlobal;

  envGlobal.__requestTransportEnv = {
    ...envGlobal.__requestTransportEnv,
    ...overrides,
  };
}

/*
 * A request as Express hands it to a route: `secure` is what Express worked
 * out from X-Forwarded-Proto through `trust proxy`, `headers.host` is the Host
 * the ingress passed on, and `hostname` is what Express would read from
 * X-Forwarded-Host - which the rule must never use.
 */
function request(data: {
  secure?: boolean;
  host?: string | Array<string> | undefined;
  forwardedHost?: string;
}): ExpressRequest {
  const headers: Record<string, string | Array<string>> = {};

  if (data.host !== undefined) {
    headers["host"] = data.host;
  }

  if (data.forwardedHost !== undefined) {
    headers["x-forwarded-host"] = data.forwardedHost;
  }

  return {
    secure: data.secure === true,
    headers: headers,
    hostname: data.forwardedHost || data.host,
  } as unknown as ExpressRequest;
}

beforeEach(() => {
  setEnv({
    httpProtocol: "https://",
    host: INSTALLATION_HOST,
    hstsMaxAgeSeconds: DEFAULT_HSTS_MAX_AGE_SECONDS,
  });
});

describe("a request the ingress forwards as https is HTTPS", () => {
  const cases: Array<[string, string]> = [
    ["https://", INSTALLATION_HOST],
    ["https://", "status.customer.com"],
    ["http://", INSTALLATION_HOST],
    ["http://", "status.customer.com"],
    ["http://", "10.0.0.5"],
  ];

  test.each(cases)(
    "HTTP_PROTOCOL=%s, Host %s",
    (httpProtocol: string, host: string) => {
      setEnv({ httpProtocol });

      expect(RequestTransport.isHttps(request({ secure: true, host }))).toBe(
        true,
      );
    },
  );
});

describe("an HTTPS installation's own address is HTTPS, whatever the proxies in front send", () => {
  const spellings: Array<string> = [
    "oneuptime.example.com",
    "OneUptime.Example.COM",
    "oneuptime.example.com:443",
    "oneuptime.example.com:8443",
    "oneuptime.example.com.",
  ];

  test.each(spellings)("Host %s", (host: string) => {
    expect(RequestTransport.isHttps(request({ host }))).toBe(true);
    expect(RequestTransport.isInstallationAddress(request({ host }))).toBe(
      true,
    );
  });

  test("HOST written with a port still names the host", () => {
    setEnv({ host: "oneuptime.example.com:8443" });

    expect(
      RequestTransport.isHttps(request({ host: "oneuptime.example.com" })),
    ).toBe(true);
  });

  test("a Host header sent twice is read by its first value, as Node does", () => {
    expect(
      RequestTransport.isHttps(
        request({ host: [INSTALLATION_HOST, "status.customer.com"] }),
      ),
    ).toBe(true);
  });
});

describe("a custom domain of an HTTPS installation is HTTPS only when the ingress says so", () => {
  const otherHosts: Array<string> = [
    "status.customer.com",
    "dashboard.customer.com:80",
    "oneuptime.example.com.evil.com",
    "evil-oneuptime.example.com",
    "sub.oneuptime.example.com",
    "10.0.0.5",
    "localhost",
  ];

  test.each(otherHosts)("Host %s over plain HTTP", (host: string) => {
    expect(RequestTransport.isHttps(request({ host }))).toBe(false);
    expect(RequestTransport.isInstallationAddress(request({ host }))).toBe(
      false,
    );
  });

  test.each(otherHosts)(
    "Host %s with an https forwarded scheme",
    (host: string) => {
      expect(RequestTransport.isHttps(request({ secure: true, host }))).toBe(
        true,
      );
    },
  );
});

describe("a plain-HTTP installation stays plain HTTP", () => {
  beforeEach(() => {
    setEnv({ httpProtocol: "http://" });
  });

  test("its own address over plain HTTP", () => {
    expect(RequestTransport.isHttps(request({ host: INSTALLATION_HOST }))).toBe(
      false,
    );
  });

  test("a custom domain over plain HTTP", () => {
    expect(
      RequestTransport.isHttps(request({ host: "status.customer.com" })),
    ).toBe(false);
  });

  test("without a request, the installation's own protocol decides", () => {
    expect(RequestTransport.isHttps(undefined)).toBe(false);
  });
});

describe("what never makes a request the installation's address", () => {
  test("X-Forwarded-Host, which a caller writes, is not read", () => {
    const forged: ExpressRequest = request({
      host: "status.customer.com",
      forwardedHost: INSTALLATION_HOST,
    });

    expect(RequestTransport.isInstallationAddress(forged)).toBe(false);
    expect(RequestTransport.isHttps(forged)).toBe(false);
    expect(RequestTransport.getStrictTransportSecurity(forged)).toBeNull();
  });

  const malformed: Array<string> = [
    "",
    "   ",
    "oneuptime.example.com/path",
    "oneuptime.example.com?x",
    "oneuptime.example.com#x",
    "user@oneuptime.example.com",
    "oneuptime.example.com, status.customer.com",
    "oneuptime.example.com:notaport",
    "oneuptime example.com",
    "oneuptime.example.com\\",
  ];

  test.each(malformed)("a malformed Host header %j", (host: string) => {
    expect(RequestTransport.isInstallationAddress(request({ host }))).toBe(
      false,
    );
    expect(RequestTransport.isHttps(request({ host }))).toBe(false);
  });

  test("no Host header at all", () => {
    expect(RequestTransport.isInstallationAddress(request({}))).toBe(false);
    expect(RequestTransport.isInstallationAddress(undefined)).toBe(false);
  });

  test("a HOST that is not a host name matches nothing", () => {
    for (const host of ["", "not a host", "https://oneuptime.example.com"]) {
      setEnv({ host });

      expect(
        RequestTransport.isInstallationAddress(
          request({ host: "oneuptime.example.com" }),
        ),
      ).toBe(false);
    }
  });
});

describe("without a request, the installation's own protocol decides", () => {
  test("an HTTPS installation", () => {
    expect(RequestTransport.isHttps(undefined)).toBe(true);
  });
});

describe("Strict-Transport-Security", () => {
  test("an HTTPS installation tells browsers to keep its own address on HTTPS for a year", () => {
    expect(
      RequestTransport.getStrictTransportSecurity(
        request({ host: INSTALLATION_HOST }),
      ),
    ).toBe("max-age=31536000");
    expect(DEFAULT_HSTS_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  test("whatever the ingress forwarded: browsers ignore the header over plain HTTP", () => {
    for (const secure of [true, false]) {
      expect(
        RequestTransport.getStrictTransportSecurity(
          request({ secure, host: `${INSTALLATION_HOST}:443` }),
        ),
      ).toBe("max-age=31536000");
    }
  });

  test("never names the subdomains of HOST or asks to be preloaded", () => {
    const header: string | null = RequestTransport.getStrictTransportSecurity(
      request({ host: INSTALLATION_HOST }),
    );

    expect(header).not.toBeNull();
    expect(header!.toLowerCase()).not.toContain("includesubdomains");
    expect(header!.toLowerCase()).not.toContain("preload");
  });

  test("is never sent for a status page's or a dashboard's custom domain, even over HTTPS", () => {
    for (const host of ["status.customer.com", "dashboard.customer.com"]) {
      expect(
        RequestTransport.getStrictTransportSecurity(
          request({ secure: true, host }),
        ),
      ).toBeNull();
    }
  });

  test("is never sent by a plain-HTTP installation, even when a proxy in front says https", () => {
    setEnv({ httpProtocol: "http://" });

    for (const secure of [true, false]) {
      expect(
        RequestTransport.getStrictTransportSecurity(
          request({ secure, host: INSTALLATION_HOST }),
        ),
      ).toBeNull();
    }
  });

  test("HSTS_MAX_AGE_SECONDS sets the max-age, and 0 tells browsers to forget the rule", () => {
    setEnv({ hstsMaxAgeSeconds: 0 });

    expect(
      RequestTransport.getStrictTransportSecurity(
        request({ host: INSTALLATION_HOST }),
      ),
    ).toBe("max-age=0");

    setEnv({ hstsMaxAgeSeconds: 86400 });

    expect(
      RequestTransport.getStrictTransportSecurity(
        request({ host: INSTALLATION_HOST }),
      ),
    ).toBe("max-age=86400");
  });

  test("without a request there is no address to name, so no header", () => {
    expect(RequestTransport.getStrictTransportSecurity(undefined)).toBeNull();
  });

  test("is never pinned to localhost or a name under it: every local development server answers there", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "localhost.",
      "oneuptime.localhost",
      "app.dev.localhost",
    ]) {
      setEnv({ host });

      for (const requestHost of [host, `${host}:8443`]) {
        expect({
          host,
          header: RequestTransport.getStrictTransportSecurity(
            request({ secure: true, host: requestHost }),
          ),
        }).toEqual({ host, header: null });
      }
    }
  });

  test("is never sent when HOST is an IP address, which browsers never pin", () => {
    for (const [host, requestHost] of [
      ["10.0.0.5", "10.0.0.5"],
      ["127.0.0.1", "127.0.0.1:8443"],
      ["[2001:db8::1]", "[2001:db8::1]:443"],
      ["[::1]", "[::1]"],
    ] as Array<[string, string]>) {
      setEnv({ host });

      expect({
        host,
        header: RequestTransport.getStrictTransportSecurity(
          request({ secure: true, host: requestHost }),
        ),
      }).toEqual({ host, header: null });
    }
  });

  test("names that only look like localhost or an address are pinned as usual", () => {
    for (const host of [
      "localhost.example.com",
      "mylocalhost",
      "10.0.0.5.example.com",
      "oneuptime-localhost.com",
    ]) {
      setEnv({ host });

      expect({
        host,
        header: RequestTransport.getStrictTransportSecurity(request({ host })),
      }).toEqual({ host, header: "max-age=31536000" });
    }
  });

  test("the cookies of such an installation still stay on HTTPS", () => {
    for (const host of ["localhost", "10.0.0.5"]) {
      setEnv({ host });

      expect(RequestTransport.isHttps(request({ host }))).toBe(true);
    }
  });
});

describe("isNeverPinned", () => {
  const cases: Array<[string | null, boolean]> = [
    [null, true],
    ["localhost", true],
    ["a.localhost", true],
    ["192.168.1.10", true],
    ["[fe80::1]", true],
    ["::1", true],
    ["oneuptime.example.com", false],
    ["localhost.example.com", false],
    ["notlocalhost", false],
    ["999.1.1.1", false],
  ];

  test.each(cases)("%j -> %s", (hostname: string | null, never: boolean) => {
    expect(RequestTransport.isNeverPinned(hostname)).toBe(never);
  });
});

describe("HSTS_MAX_AGE_SECONDS", () => {
  const cases: Array<[string | undefined, number]> = [
    [undefined, DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["   ", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["0", 0],
    [" 86400 ", 86400],
    ["63072000", 63072000],
    ["-1", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["1.5", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["one year", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["Infinity", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["NaN", DEFAULT_HSTS_MAX_AGE_SECONDS],
    // Spellings Number() would take that are not seconds written as digits.
    ["1e3", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["0x10", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["+600", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["1_000", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["600 600", DEFAULT_HSTS_MAX_AGE_SECONDS],
    // A few zeros too many: kept as the year, not written as 3.1536e+22.
    ["31536000000000000000000", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["9007199254740993", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ["9007199254740991", 9007199254740991],
    ["000600", 600],
  ];

  test.each(cases)(
    "%j reads as %s",
    (raw: string | undefined, seconds: number) => {
      expect(parseHstsMaxAgeSeconds(raw)).toBe(seconds);
    },
  );

  test("whatever is configured, the header carries max-age as plain digits, which is all browsers read", () => {
    const configured: Array<string | undefined> = [
      ...cases.map((entry: [string | undefined, number]) => {
        return entry[0];
      }),
      "1e21",
      "1e400",
      "-0",
      "  31536000  ",
      "99999999999999999999999999999999999999999",
    ];

    for (const raw of configured) {
      setEnv({ hstsMaxAgeSeconds: parseHstsMaxAgeSeconds(raw) });

      const header: string | null = RequestTransport.getStrictTransportSecurity(
        request({ host: INSTALLATION_HOST }),
      );

      expect({ raw, wellFormed: MAX_AGE_HEADER.test(header || "") }).toEqual({
        raw,
        wellFormed: true,
      });
    }
  });
});

describe("hostnameOf", () => {
  const cases: Array<[string | undefined, string | null]> = [
    ["OneUptime.Example.COM", "oneuptime.example.com"],
    ["oneuptime.example.com:443", "oneuptime.example.com"],
    ["oneuptime.example.com.", "oneuptime.example.com"],
    ["[::1]:8080", "[::1]"],
    ["192.168.1.10:80", "192.168.1.10"],
    [undefined, null],
    ["", null],
    ["a/b", null],
    ["x@y", null],
  ];

  test.each(cases)(
    "%j",
    (authority: string | undefined, hostname: string | null) => {
      expect(RequestTransport.hostnameOf(authority)).toBe(hostname);
    },
  );
});
