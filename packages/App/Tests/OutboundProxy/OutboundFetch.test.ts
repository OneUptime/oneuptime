import OutboundFetch, {
  OutboundProxyRefusal,
} from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import BadDataException from "Common/Types/Exception/BadDataException";
import ProxyTunnelRefusal from "Common/Utils/ProxyTunnelRefusal";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  PROXY_HOST_NAME,
  ProxyCredentials,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import {
  LocalHttpsServer,
  TestCertificate,
  TestCertificates,
  TunnelEnd,
  TunnellingProxy,
  generateTestCertificates,
  removeTestCertificates,
  trustAsDefaultCa,
  useDefaultCaRestored,
  useSelfSignedHttps,
} from "Common/Tests/Server/TestingUtils/SelfSignedHttpsFixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import https from "https";
import type { SpyInstance } from "jest-mock";

jest.mock("Common/Server/Utils/Logger");

/*
 * A SERVER REQUEST SENT WITH NODE'S FETCH GOES THROUGH THE OUTBOUND PROXY,
 * AS EVERY OTHER ONE DOES (issue #10720).
 *
 * Node's fetch reads no HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, so the HTTP
 * mail providers, Microsoft Graph mail, the marketplaces and the rest sent
 * their requests directly, which fails where the internet is reachable only
 * through the proxy. OutboundFetch.fetch sends them on the route
 * OutboundProxyAgents decides for their URL, NO_PROXY included, on undici's
 * agents.
 *
 * Every case sends real requests to a proxy and servers on this machine:
 * OutboundProxyFixture's, which record who each forwarded request and each
 * CONNECT signed in as, with a user name and password holding "@", ":" and
 * "%", and SelfSignedHttpsFixture's, whose servers and tunnelling proxies
 * answer with certificates nobody trusts. They are sent with Node's real
 * fetch, so they run here: Common's jest runs in jsdom, which has none.
 */

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(async () => {
  await OutboundFetch.destroySharedDispatchers();
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

// The error a request fails with: it must fail.
async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The request went through.");
}

// What each forwarded request asked the server for: a whole URL at a proxy.
function urlsSeenBy(server: LocalHttpServer): Array<string> {
  return server.requests.map((seen: { url: string }): string => {
    return seen.url;
  });
}

async function answerOf(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

/*
 * The dispatcher every fetch that brings none goes out on: undici keeps it
 * on the global object, the one inside Node and the package alike.
 */
function globalDispatcher(): unknown {
  return (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("undici.globalDispatcher.1")
  ];
}

// The redirect `server` answers with, wherever it was asked.
function redirectsTo(server: LocalHttpServer, location: string): void {
  server.handler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(302, { Location: location });
    response.end();
  };
}

describe.each([
  {
    kind: "with @, : and % in it",
    credentials: RESERVED_CHARACTER_CREDENTIALS,
  },
  {
    kind: "with no character a URL reserves",
    credentials: PLAIN_CREDENTIALS,
  },
])(
  "behind a proxy that checks a password $kind",
  (data: { kind: string; credentials: ProxyCredentials }) => {
    test("over http, the proxy is sent the whole URL, signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      const response: Response = await OutboundFetch.fetch(
        "http://service.example.test/v1/check?x=1",
      );

      expect(await answerOf(response)).toEqual({ answeredBy: "proxy" });
      expect(urlsSeenBy(proxy)).toEqual([
        "http://service.example.test/v1/check?x=1",
      ]);
      expect(proxy.requestCredentials).toEqual([signedInAs(data.credentials)]);
      // Forwarded, never tunnelled: a proxy that allows CONNECT to 443 alone takes it.
      expect(proxy.connects).toEqual([]);
    });

    test("over https, the CONNECT is signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      await failureOf(
        OutboundFetch.fetch("https://service.example.test/v1/check"),
      );

      expect(proxy.connects).toEqual(["service.example.test:443"]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
    });

    test("through ALL_PROXY, when no other variable names a proxy", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["ALL_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      await OutboundFetch.fetch("http://service.example.test/all");
      await failureOf(OutboundFetch.fetch("https://service.example.test/all"));

      expect(proxy.requestCredentials).toEqual([signedInAs(data.credentials)]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
    });

    test("a body Node's fetch makes, a FormData's included, reaches the proxy whole", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const form: FormData = new FormData();
      form.append("to", "oncall@example.test");
      form.append("message", new Blob(["MIME-Version: 1.0"]), "message.mime");

      await OutboundFetch.fetch("http://api.mail.example.test/v3/messages", {
        method: "POST",
        body: form,
      });

      expect(proxy.requests).toHaveLength(1);
      expect(proxy.requests[0]!.method).toBe("POST");
      expect(proxy.requests[0]!.body).toContain('name="to"');
      expect(proxy.requests[0]!.body).toContain("oncall@example.test");
      expect(proxy.requests[0]!.body).toContain('filename="message.mime"');
      expect(proxy.requests[0]!.body).toContain("MIME-Version: 1.0");
      expect(proxy.requests[0]!.body).not.toContain("[object FormData]");
      expect(proxy.requestCredentials).toEqual([signedInAs(data.credentials)]);
    });
  },
);

describe("NO_PROXY", () => {
  test("a host it names is sent to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = "127.0.0.1";

    const response: Response = await OutboundFetch.fetch(target.url("/direct"));

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
    expect(urlsSeenBy(target)).toEqual(["/direct"]);
    expect(target.requestCredentials).toEqual([""]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("is read as axios reads it: a CIDR range, and a host with its port", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    process.env["NO_PROXY"] = "10.0.0.0/8, 127.0.0.0/8";
    await OutboundFetch.fetch(target.url("/by-range"));

    process.env["NO_PROXY"] = `127.0.0.1:${target.port}`;
    await OutboundFetch.fetch(target.url("/by-port"));

    // Another port of the same host is not named: it goes through the proxy.
    process.env["NO_PROXY"] = `127.0.0.1:${target.port + 1}`;
    await OutboundFetch.fetch(target.url("/other-port"));

    expect(urlsSeenBy(target)).toEqual(["/by-range", "/by-port"]);
    expect(urlsSeenBy(proxy)).toEqual([target.url("/other-port")]);
  });

  test("a wildcard names every host", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = "*";

    await OutboundFetch.fetch(target.url("/any"));

    expect(urlsSeenBy(target)).toEqual(["/any"]);
    expect(proxy.isUntouched).toBe(true);
  });
});

describe("with no proxy at all", () => {
  test("a request is sent directly, signed in to no proxy", async () => {
    const target: LocalHttpServer = await serve({ name: "target" });

    const first: Response = await OutboundFetch.fetch(target.url("/one"));
    const second: Response = await OutboundFetch.fetch(target.url("/two"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(await answerOf(first)).toEqual({ answeredBy: "target" });
    expect(await answerOf(second)).toEqual({ answeredBy: "target" });
    expect(urlsSeenBy(target)).toEqual(["/one", "/two"]);
    expect(target.requests[1]!.body).toBe('{"hello":"world"}');
    expect(target.requestCredentials).toEqual(["", ""]);
  });
});

describe("a request the proxy refuses", () => {
  test("a refused tunnel is the proxy's refusal, with its answer, and never its address", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("https://hooks.example.test/hook"),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toBe(
      "The outbound proxy did not open a connection to hooks.example.test:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(refusal.message).not.toContain(String(proxy.port));
    expect(refusal.message).not.toContain(PROXY_HOST_NAME);
    expect(refusal.message).not.toContain("p@ss");
    // Not a request that was cancelled or timed out.
    expect(refusal.name).toBe("OutboundProxyRefusal");
    expect(refusal.name).not.toBe("AbortError");
    expect((refusal as OutboundProxyRefusal).statusCode).toBe(403);
    expect((refusal as OutboundProxyRefusal).destination).toBe(
      "hooks.example.test:443",
    );
    expect((refusal as OutboundProxyRefusal).isRetryable).toBe(false);
    // Said the same wherever it is read.
    expect(ProxyTunnelRefusal.describe(refusal)).toBe(refusal.message);
  });

  test("a 407 to the CONNECT is the proxy not taking OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("https://api.example.test/v1"),
    );

    expect(refusal.message).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to api.example.test:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
    // Never the password, decoded or as written, nor the proxy.
    expect(refusal.message).not.toContain("p@ss");
    expect(refusal.message).not.toContain("p%40ss");
    expect(refusal.message).not.toContain(String(proxy.port));
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a 407 to a forwarded http request is said the same way", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="corp"' });
      response.end();
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("http://service.example.test/v1"),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to service.example.test:80 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
    expect(proxy.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a proxy that fails itself (5xx) is worth another try; one that refuses is not", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 503 Service Unavailable";
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("https://api.example.test/v1"),
    );

    expect((refusal as OutboundProxyRefusal).statusCode).toBe(503);
    expect((refusal as OutboundProxyRefusal).isRetryable).toBe(true);
    expect(refusal.message).toContain("it answered 503 Service Unavailable.");
  });

  test("the refusal of a redirect names where the redirect was going", async () => {
    const start: LocalHttpServer = await serve({ name: "start" });
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = "127.0.0.1";
    redirectsTo(start, "https://elsewhere.example.test/next");

    const refusal: Error = await failureOf(
      OutboundFetch.fetch(start.url("/start")),
    );

    expect((refusal as OutboundProxyRefusal).destination).toBe(
      "elsewhere.example.test:443",
    );
    expect(proxy.connects).toEqual(["elsewhere.example.test:443"]);
  });
});

describe("a proxy setting that cannot be used", () => {
  test("a proxy that is not http or https fails before anything is sent, in words that name no password", async () => {
    process.env["HTTPS_PROXY"] = "socks5://ops:p%40ss@socks.corp.example:1080";

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("https://api.example.test/"),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
    expect(refusal.message).not.toContain("p%40ss");
  });

  test("a proxy that is no URL at all fails the same way", async () => {
    process.env["HTTPS_PROXY"] = "http://ops:p@ss@ not a url";

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("https://api.example.test/"),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not a URL.",
    );
  });

  test("a password that is not percent-encoded as a URL must be fails before anything is sent, and says how to write it", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] =
      `http://ops:50%off@${PROXY_HOST_NAME}:${proxy.port}`;

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("http://service.example.test/"),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The user name or password of the outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not written as a URL writes it: write each @, : and % in them as %40, %3A and %25.",
    );
    expect(refusal.message).not.toContain("50%off");
    expect(proxy.isUntouched).toBe(true);
  });

  test("a redirect to a scheme whose proxy cannot be used fails with the same words", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["HTTPS_PROXY"] = "socks5://socks.corp.example:1080";
    redirectsTo(proxy, "https://secure.example.test/next");

    const refusal: Error = await failureOf(
      OutboundFetch.fetch("http://service.example.test/start"),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
  });
});

describe("a user name or password alone", () => {
  test("signs in as Node's own agents do: a user name alone, and a password alone", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTP_PROXY"] = `http://token@${PROXY_HOST_NAME}:${proxy.port}`;
    await OutboundFetch.fetch("http://service.example.test/user-only");

    process.env["HTTP_PROXY"] =
      `http://:s%40cret@${PROXY_HOST_NAME}:${proxy.port}`;
    await OutboundFetch.fetch("http://service.example.test/password-only");

    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    await OutboundFetch.fetch("http://service.example.test/no-one");

    expect(proxy.requestCredentials).toEqual(["token:", ":s@cret", ""]);
  });
});

describe("a request that follows redirects is routed again at each one", () => {
  test("from a host in NO_PROXY to one outside it: the second request goes through the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const start: LocalHttpServer = await serve({ name: "start" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = "127.0.0.1";
    redirectsTo(start, "http://elsewhere.example.test/next");

    const response: Response = await OutboundFetch.fetch(start.url("/start"));

    expect(response.status).toBe(200);
    expect(urlsSeenBy(start)).toEqual(["/start"]);
    expect(urlsSeenBy(proxy)).toEqual(["http://elsewhere.example.test/next"]);
    expect(proxy.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("from a proxied host to one in NO_PROXY: the second request goes directly", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const final: LocalHttpServer = await serve({ name: "final" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = "127.0.0.1";
    redirectsTo(proxy, final.url("/final"));

    const response: Response = await OutboundFetch.fetch(
      "http://service.example.test/start",
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "final" });
    expect(urlsSeenBy(proxy)).toEqual(["http://service.example.test/start"]);
    expect(urlsSeenBy(final)).toEqual(["/final"]);
    expect(final.requestCredentials).toEqual([""]);
  });

  test("from http to https: the second request is tunnelled through HTTPS_PROXY", async () => {
    const httpProxy: LocalHttpServer = await serve({ name: "http proxy" });
    const httpsProxy: LocalHttpServer = await serve({ name: "https proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${httpProxy.port}`;
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      httpsProxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    redirectsTo(httpProxy, "https://service.example.test/secure");

    await failureOf(OutboundFetch.fetch("http://service.example.test/start"));

    expect(urlsSeenBy(httpProxy)).toEqual([
      "http://service.example.test/start",
    ]);
    expect(httpsProxy.connects).toEqual(["service.example.test:443"]);
    expect(httpsProxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a request that refuses redirects still refuses them", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    redirectsTo(proxy, "http://elsewhere.example.test/stolen");

    await failureOf(
      OutboundFetch.fetch("http://service.example.test/start", {
        redirect: "error",
      }),
    );

    expect(urlsSeenBy(proxy)).toEqual(["http://service.example.test/start"]);
  });
});

describe("a request that must go directly (direct: true)", () => {
  test("goes directly whatever the environment says, and asks no proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["ALL_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const response: Response = await OutboundFetch.fetch(
      target.url("/latest/api/token"),
      { method: "PUT" },
      { direct: true },
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
    expect(urlsSeenBy(target)).toEqual(["/latest/api/token"]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("is not failed by a proxy setting it never uses", async () => {
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = "socks5://socks.corp.example:1080";

    const response: Response = await OutboundFetch.fetch(
      target.url("/metadata"),
      undefined,
      { direct: true },
    );

    expect(response.status).toBe(200);
  });
});

describe("nothing else changes", () => {
  test("the global fetch is the one sent with, so what stands in for it in a test still does", async () => {
    const target: LocalHttpServer = await serve({ name: "target" });
    const spy: SpyInstance<typeof fetch> = jest.spyOn(globalThis, "fetch");

    await OutboundFetch.fetch(target.url("/seen"), { method: "GET" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(target.url("/seen"));
    expect(spy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ method: "GET", dispatcher: expect.anything() }),
    );
  });

  test("no global agent or dispatcher is changed: a request that brings none still goes as it did", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    const dispatcherBefore: unknown = globalDispatcher();

    await failureOf(OutboundFetch.fetch("https://service.example.test/"));

    expect(globalDispatcher()).toBe(dispatcherBefore);
    expect(
      (https.globalAgent as unknown as { options: Record<string, unknown> })
        .options["proxyEnv"],
    ).toBeUndefined();
    expect(
      (http.globalAgent as unknown as { options: Record<string, unknown> })
        .options["proxyEnv"],
    ).toBeUndefined();
  });

  test("a URL fetch cannot read fails as fetch fails it", async () => {
    const failure: Error = await failureOf(OutboundFetch.fetch("not a url"));

    // Node's own TypeError, of the realm outside the test's.
    expect(failure.name).toBe("TypeError");
  });
});

/*
 * A request's own certificate settings, on the connection to its target
 * only: inside a proxy's tunnel, and never on the connection to an
 * https:// proxy, which keeps the CAs the process trusts.
 */
describe("certificate settings of a request's own", () => {
  const TARGET_HOST: string = "internal.example.test";
  let certificates: TestCertificates | undefined = undefined;
  let localCertificates: TestCertificates | undefined = undefined;

  const selfSigned: {
    serve: (data: {
      host?: string | undefined;
      name?: string | undefined;
      certificate: TestCertificate;
    }) => Promise<LocalHttpsServer>;
    proxy: (data: {
      route: (authority: string) => TunnelEnd | null;
      certificate?: TestCertificate | undefined;
    }) => Promise<TunnellingProxy>;
  } = useSelfSignedHttps();

  beforeAll(() => {
    certificates = generateTestCertificates(TARGET_HOST);
    localCertificates = generateTestCertificates("localhost");
  });

  afterAll(() => {
    removeTestCertificates(certificates);
    removeTestCertificates(localCertificates);
  });

  // A tunnelling proxy that opens a tunnel to `target` for TARGET_HOST.
  async function proxyTo(
    target: LocalHttpsServer,
    proxyCertificate?: TestCertificate | undefined,
  ): Promise<TunnellingProxy> {
    return await selfSigned.proxy({
      route: (authority: string): TunnelEnd | null => {
        return authority === `${TARGET_HOST}:${target.port}`
          ? { host: target.host, port: target.port }
          : null;
      },
      certificate: proxyCertificate,
    });
  }

  test("a CA of the request's own is trusted for its target, directly", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: localCertificates!.caSigned,
    });

    const response: Response = await OutboundFetch.fetch(
      `https://localhost:${target.port}/direct`,
      undefined,
      { tls: { ca: localCertificates!.caCertificate } },
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
    expect(target.requests).toHaveLength(1);
  });

  test("through an http:// proxy's tunnel, the target is checked against the request's CA", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.caSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTPS_PROXY"] = proxy.url;

    const response: Response = await OutboundFetch.fetch(
      `https://${TARGET_HOST}:${target.port}/through`,
      undefined,
      { tls: { ca: certificates!.caCertificate } },
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
    expect(proxy.connects).toEqual([`${TARGET_HOST}:${target.port}`]);
  });

  test("through an https:// proxy the process trusts, the proxy is checked against the process's CAs and the target against the request's", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.caSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target, certificates!.proxy);
    trustAsDefaultCa(certificates!.proxy.certificate);
    process.env["HTTPS_PROXY"] = proxy.url;

    const response: Response = await OutboundFetch.fetch(
      `https://${TARGET_HOST}:${target.port}/through`,
      undefined,
      { tls: { ca: certificates!.caCertificate } },
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
    expect(proxy.connects).toEqual([`${TARGET_HOST}:${target.port}`]);
  });

  test("the request's CA does not vouch for an https:// proxy the process does not trust", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.caSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target, certificates!.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    await failureOf(
      OutboundFetch.fetch(
        `https://${TARGET_HOST}:${target.port}/through`,
        undefined,
        { tls: { ca: certificates!.caCertificate } },
      ),
    );

    expect(proxy.connects).toEqual([]);
    expect(target.isUntouched).toBe(true);
  });

  test("turning the target's check off does not turn the proxy's off", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.selfSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target, certificates!.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    await failureOf(
      OutboundFetch.fetch(
        `https://${TARGET_HOST}:${target.port}/through`,
        undefined,
        { tls: { rejectUnauthorized: false } },
      ),
    );

    expect(proxy.connects).toEqual([]);
    expect(target.isUntouched).toBe(true);

    // Trusted, the proxy tunnels, and the target's check is off as asked.
    trustAsDefaultCa(certificates!.proxy.certificate);

    const response: Response = await OutboundFetch.fetch(
      `https://${TARGET_HOST}:${target.port}/through`,
      undefined,
      { tls: { rejectUnauthorized: false } },
    );

    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
  });

  test("with no settings of its own, a target nobody trusts is refused through the tunnel, and nothing reaches it", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.selfSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTPS_PROXY"] = proxy.url;

    await failureOf(
      OutboundFetch.fetch(`https://${TARGET_HOST}:${target.port}/through`),
    );

    expect(proxy.connects).toEqual([`${TARGET_HOST}:${target.port}`]);
    expect(target.isUntouched).toBe(true);
  });

  test("the next request after one with settings of its own is checked as every request is", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: certificates!.selfSigned,
    });
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTPS_PROXY"] = proxy.url;

    const allowed: Response = await OutboundFetch.fetch(
      `https://${TARGET_HOST}:${target.port}/allowed`,
      undefined,
      { tls: { rejectUnauthorized: false } },
    );

    expect(await answerOf(allowed)).toEqual({ answeredBy: "target" });

    await failureOf(
      OutboundFetch.fetch(`https://${TARGET_HOST}:${target.port}/checked`),
    );

    expect(
      target.requests.map((seen: { url: string }): string => {
        return seen.url;
      }),
    ).toEqual(["/allowed"]);
  });

  test("a response's body is read whole after its request's own agents are let go", async () => {
    const target: LocalHttpsServer = await selfSigned.serve({
      certificate: localCertificates!.caSigned,
    });

    const response: Response = await OutboundFetch.fetch(
      `https://localhost:${target.port}/body`,
      undefined,
      { tls: { ca: [localCertificates!.caCertificate] } },
    );

    // Read after fetch returned, and its agents were closed.
    expect(await answerOf(response)).toEqual({ answeredBy: "target" });
  });
});
