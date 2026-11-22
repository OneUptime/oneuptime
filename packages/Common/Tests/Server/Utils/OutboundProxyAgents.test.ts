/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import OutboundProxyAgents, {
  OutboundAgents,
} from "../../../Server/Utils/OutboundProxyAgents";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import WebsiteRequest from "../../../Types/WebsiteRequest";
import API from "../../../Utils/API";
import OutboundRequestRouting from "../../../Utils/OutboundRequestRouting";
import OutboundRequestRoutingInBrowser from "../../../Utils/OutboundRequestRouting.browser";
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
} from "../TestingUtils/OutboundProxyFixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROXY'S USER NAME AND PASSWORD REACH IT AS THE OPERATOR SET THEM (issue
 * #10442).
 *
 * A proxy URL writes a password that holds a character a URL reserves
 * percent-encoded: p@ss is HTTPS_PROXY=http://user:p%40ss@proxy:3128. Axios,
 * left to read the proxy from the environment, sent Proxy-Authorization as
 * written - user:p%40ss - for a forwarded http request and an https CONNECT
 * alike, so a proxy that checks the real password refused every such request
 * with 407. Every server request now goes out on agents that carry its route
 * (OutboundProxyAgents), whose proxy support decodes them.
 *
 * The first part asks the route itself; the rest sends real requests, as
 * each way of sending does - the shared API client, WebsiteRequest, a raw
 * axios request routed by hand, an axios instance routed by an interceptor -
 * to a proxy and a server on this machine (OutboundProxyFixture). Each is
 * sent as on a server: with axios's Node adapter, the one axios picks where
 * there is no XMLHttpRequest. Common's suites run in jsdom
 * (Tests/Utils/TimezoneEnvironment.js), whose XMLHttpRequest axios would
 * pick otherwise. The pinned requests (webhooks, data sources, LLM providers
 * and the rest) are held to the same in EgressGuardedRequestsBehindProxy.
 */

clearOutboundProxyEnvironmentForEachTest();

let browserAdapter: AxiosRequestConfig["adapter"] = undefined;

beforeAll(() => {
  browserAdapter = axios.defaults.adapter;
  axios.defaults.adapter = "http";
});

afterAll(() => {
  if (browserAdapter === undefined) {
    delete axios.defaults.adapter;
  } else {
    axios.defaults.adapter = browserAdapter;
  }
});

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

// What Node keeps of an agent's options, the proxy it was given among them.
function optionsOf(agent: unknown): Record<string, unknown> {
  return (agent as { options: Record<string, unknown> }).options;
}

function proxyEnvOf(agent: unknown): Record<string, unknown> {
  return optionsOf(agent)["proxyEnv"] as Record<string, unknown>;
}

describe("the route a request is given", () => {
  test("with no proxy set at all, a request's config is left as it was", () => {
    const config: AxiosRequestConfig = {
      url: "https://api.example.test/v1/things",
      timeout: 5000,
    };

    expect(OutboundProxyAgents.routeAxiosRequest(config)).toBe(config);
    expect(config).toEqual({
      url: "https://api.example.test/v1/things",
      timeout: 5000,
    });
  });

  test("a request that sets its own proxy keeps it", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";

    const direct: AxiosRequestConfig = {
      url: "https://api.example.test/",
      proxy: false,
    };
    const named: AxiosRequestConfig = {
      url: "https://api.example.test/",
      proxy: { host: "other.example", port: 8080 },
    };

    OutboundProxyAgents.routeAxiosRequest(direct);
    OutboundProxyAgents.routeAxiosRequest(named);

    expect(direct).toEqual({ url: "https://api.example.test/", proxy: false });
    expect(named).toEqual({
      url: "https://api.example.test/",
      proxy: { host: "other.example", port: 8080 },
    });
  });

  test("a request with agents of its own is routed by them: axios adds no proxy on top", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    const httpsAgent: https.Agent = new https.Agent();
    const httpAgent: http.Agent = new http.Agent();
    const config: AxiosRequestConfig = {
      url: "https://api.example.test/",
      httpAgent,
      httpsAgent,
    };

    OutboundProxyAgents.routeAxiosRequest(config);

    expect(config.proxy).toBe(false);
    expect(config.httpsAgent).toBe(httpsAgent);
    expect(config.httpAgent).toBe(httpAgent);
    // Its agents' own redirects are its business.
    expect(config.beforeRedirect).toBeUndefined();

    httpAgent.destroy();
    httpsAgent.destroy();
  });

  test("with no proxy set, agents of the request's own still turn axios's proxy off", () => {
    const httpsAgent: https.Agent = new https.Agent();
    const config: AxiosRequestConfig = {
      url: "https://api.example.test/",
      httpsAgent,
    };

    OutboundProxyAgents.routeAxiosRequest(config);

    expect(config).toEqual({
      url: "https://api.example.test/",
      httpsAgent,
      proxy: false,
    });

    httpsAgent.destroy();
  });

  test("the scheme a request brings no agent for is routed as any other request's", () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp.example:3128";
    const httpsAgent: https.Agent = new https.Agent();
    const config: AxiosRequestConfig = {
      url: "http://api.example.test/",
      httpsAgent,
    };

    OutboundProxyAgents.routeAxiosRequest(config);

    expect(config.proxy).toBe(false);
    expect(config.httpsAgent).toBe(httpsAgent);
    expect(proxyEnvOf(config.httpAgent)).toEqual({
      http_proxy: "http://proxy.corp.example:3128/",
    });

    httpsAgent.destroy();
  });

  test("a request with none of its own goes through the proxy chosen for its URL, with axios's proxy off", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    const config: AxiosRequestConfig = {
      url: "https://api.example.test/v1/things",
    };

    OutboundProxyAgents.routeAxiosRequest(config);

    expect(config.proxy).toBe(false);
    expect(config.httpAgent).toBeUndefined();
    expect(config.httpsAgent).toBeInstanceOf(https.Agent);
    expect(proxyEnvOf(config.httpsAgent)).toEqual({
      https_proxy: "http://proxy.corp.example:3128/",
    });
    expect(typeof config.beforeRedirect).toBe("function");
  });

  test("a URL written as a base and a path is routed for the URL they make", () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp.example:3128";
    process.env["NO_PROXY"] = "internal.example.test";

    const proxied: AxiosRequestConfig = {
      baseURL: "http://api.example.test/v1/",
      url: "/things",
    };
    const direct: AxiosRequestConfig = {
      baseURL: "http://internal.example.test/",
      url: "things",
    };

    OutboundProxyAgents.routeAxiosRequest(proxied);
    OutboundProxyAgents.routeAxiosRequest(direct);

    expect(proxyEnvOf(proxied.httpAgent)).toEqual({
      http_proxy: "http://proxy.corp.example:3128/",
    });
    // NO_PROXY's host goes directly, on an agent that says so to axios too.
    expect(proxyEnvOf(direct.httpAgent)).toEqual({});
    expect(direct.proxy).toBe(false);
  });

  test("a NO_PROXY entry is read as axios reads it, CIDR ranges included", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    process.env["NO_PROXY"] = "10.0.0.0/8,.svc.cluster.local";

    for (const url of [
      "https://10.1.2.3/health",
      "https://app.oneuptime.svc.cluster.local/api",
    ]) {
      const config: AxiosRequestConfig = { url };
      OutboundProxyAgents.routeAxiosRequest(config);
      expect({ url, proxyEnv: proxyEnvOf(config.httpsAgent) }).toEqual({
        url,
        proxyEnv: {},
      });
    }
  });

  test("a redirect's own route runs after the request's beforeRedirect, and picks the agent for where it goes", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    process.env["NO_PROXY"] = "internal.example.test";
    const calls: Array<string> = [];
    const config: AxiosRequestConfig = {
      url: "https://api.example.test/start",
      beforeRedirect: (options: Record<string, unknown>): void => {
        calls.push(`own ${String(options["href"])}`);
      },
    };

    OutboundProxyAgents.routeAxiosRequest(config);

    const hop: Record<string, unknown> = {
      href: "https://internal.example.test/next",
      agents: { http: undefined, https: config.httpsAgent },
    };

    config.beforeRedirect!(
      hop,
      { headers: {}, statusCode: 302 },
      { headers: {}, url: "https://api.example.test/start", method: "GET" },
    );

    expect(calls).toEqual(["own https://internal.example.test/next"]);

    const agents: Record<string, unknown> = hop["agents"] as Record<
      string,
      unknown
    >;

    expect(proxyEnvOf(agents["https"])).toEqual({});
    expect(agents["https"]).not.toBe(config.httpsAgent);
  });

  test("the shared agents are one per proxy and scheme, and keep connections as Node's own agents do", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";

    const first: http.Agent = OutboundProxyAgents.getSharedAgentFor(
      new globalThis.URL("https://a.example.test/"),
    );
    const second: http.Agent = OutboundProxyAgents.getSharedAgentFor(
      new globalThis.URL("https://b.example.test/other"),
    );

    expect(second).toBe(first);
    expect(optionsOf(first)).toEqual(
      expect.objectContaining({
        keepAlive: true,
        scheduling: "lifo",
        timeout: 5000,
      }),
    );

    process.env["NO_PROXY"] = "b.example.test";

    const direct: http.Agent = OutboundProxyAgents.getSharedAgentFor(
      new globalThis.URL("https://b.example.test/other"),
    );

    expect(direct).not.toBe(first);
    expect(proxyEnvOf(direct)).toEqual({});
  });

  test("a proxy that is not http or https is refused, in words that name no password", () => {
    process.env["HTTPS_PROXY"] = "socks5://ops:p%40ss@socks.corp.example:1080";

    let refusal: unknown = undefined;

    try {
      OutboundProxyAgents.getProxyFor(
        new globalThis.URL("https://api.example.test/"),
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
    expect((refusal as Error).message).not.toContain("p%40ss");
  });

  test("a proxy that is no URL at all is refused, in words that name no password", () => {
    process.env["HTTPS_PROXY"] = "http://ops:p@ss@ not a url";

    expect(() => {
      OutboundProxyAgents.getProxyFor(
        new globalThis.URL("https://api.example.test/"),
      );
    }).toThrow(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not a URL.",
    );
  });

  describe("agents of a request's own (createAgents)", () => {
    test("both carry their route, so axios never reads the environment for either", () => {
      process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
      process.env["HTTP_PROXY"] = "http://proxy.corp.example:3128";

      const agents: OutboundAgents = OutboundProxyAgents.createAgents(
        new globalThis.URL("https://api.example.test/"),
      );

      expect(proxyEnvOf(agents.httpsAgent)).toEqual({
        https_proxy: "http://proxy.corp.example:3128/",
      });
      // The other scheme's agent goes directly: no redirect follows a pin.
      expect(proxyEnvOf(agents.httpAgent)).toEqual({});

      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    });

    test("certificate settings go on the https agent only, and nothing global", () => {
      process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";

      const agents: OutboundAgents = OutboundProxyAgents.createAgents(
        new globalThis.URL("https://api.example.test/"),
        { tls: { rejectUnauthorized: false, ca: "PEM" } },
      );

      expect(agents.httpsAgent.options.rejectUnauthorized).toBe(false);
      expect(agents.httpsAgent.options.ca).toBe("PEM");
      expect(optionsOf(agents.httpAgent)["rejectUnauthorized"]).toBeUndefined();
      expect(https.globalAgent.options.rejectUnauthorized).toBeUndefined();

      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    });

    test("direct agents go directly whatever the environment says", () => {
      process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
      process.env["ALL_PROXY"] = "http://proxy.corp.example:3128";

      const agents: OutboundAgents = OutboundProxyAgents.createAgents(
        new globalThis.URL("https://git.example.test/"),
        { direct: true },
      );

      expect(proxyEnvOf(agents.httpsAgent)).toEqual({});
      expect(proxyEnvOf(agents.httpAgent)).toEqual({});

      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    });
  });
});

describe("the browser build", () => {
  test("takes a twin of the API client's routing that leaves every request as it is", () => {
    const packageJson: { browser: Record<string, string> } = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "..", "package.json"),
        "utf8",
      ),
    );

    expect(packageJson.browser["./Utils/OutboundRequestRouting.ts"]).toBe(
      "./Utils/OutboundRequestRouting.browser.ts",
    );

    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    const config: AxiosRequestConfig = { url: "https://api.example.test/" };

    expect(OutboundRequestRoutingInBrowser.route(config)).toBe(config);
    expect(config).toEqual({ url: "https://api.example.test/" });
  });

  test("whose twin brings neither the server's proxy rules nor Node's http modules", () => {
    const twin: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Utils",
        "OutboundRequestRouting.browser.ts",
      ),
      "utf8",
    );
    const imports: Array<string> = twin
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("import");
      });

    expect(imports).toEqual([
      'import type { AxiosRequestConfig } from "axios";',
    ]);
  });

  test("while on the server the API client is routed by OutboundProxyAgents", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    const config: AxiosRequestConfig = { url: "https://api.example.test/" };

    OutboundRequestRouting.route(config);

    expect(config.proxy).toBe(false);
    expect(proxyEnvOf(config.httpsAgent)).toEqual({
      https_proxy: "http://proxy.corp.example:3128/",
    });
  });
});

/*
 * Each way a server request is sent with no agents of its own, as its
 * callers send it. `origin` is a scheme and host, `path` what it asks for.
 */
interface Sender {
  name: string;
  send: (url: string) => Promise<unknown>;
}

const SENDERS: Array<Sender> = [
  {
    name: "the API client (Slack, Teams, GitHub, the probe's and Runner's calls to the server)",
    send: async (url: string): Promise<unknown> => {
      return await API.get<JSONObject>({ url: URL.fromString(url) });
    },
  },
  {
    name: "WebsiteRequest",
    send: async (url: string): Promise<unknown> => {
      return await WebsiteRequest.fetch(URL.fromString(url), {
        timeout: 5000,
      });
    },
  },
  {
    name: "a raw axios request routed by hand (hCaptcha, Google Analytics, the marketing webhook, Slack uploads)",
    send: async (url: string): Promise<unknown> => {
      return await axios.post(
        url,
        "{}",
        OutboundProxyAgents.routeAxiosRequest({
          url,
          headers: { "content-type": "application/json" },
          timeout: 5000,
        }),
      );
    },
  },
  {
    name: "an axios instance routed by an interceptor (the Runner's client, acme-client's orders)",
    send: async (url: string): Promise<unknown> => {
      const parsed: globalThis.URL = new globalThis.URL(url);
      const instance: AxiosInstance = axios.create({
        baseURL: parsed.origin,
        timeout: 5000,
      });

      instance.interceptors.request.use(OutboundProxyAgents.routeAxiosRequest);

      return await instance.get(`${parsed.pathname}${parsed.search}`);
    },
  },
];

async function settle(sending: Promise<unknown>): Promise<void> {
  try {
    await sending;
  } catch {
    // The proxy refuses every tunnel here; who signed in is the point.
  }
}

describe.each(SENDERS)(
  "$name, behind a proxy that checks its password",
  (sender: Sender) => {
    describe.each([
      {
        kind: "with @, : and % in it",
        credentials: RESERVED_CHARACTER_CREDENTIALS,
      },
      {
        kind: "with no character a URL reserves",
        credentials: PLAIN_CREDENTIALS,
      },
    ])("$kind", (data: { kind: string; credentials: ProxyCredentials }) => {
      test("over http, the proxy is sent the whole URL, signed in with the real user name and password", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );

        await sender.send("http://service.example.test/v1/check?x=1");

        expect(
          proxy.requests.map((seen: { url: string }) => {
            return seen.url;
          }),
        ).toEqual(["http://service.example.test/v1/check?x=1"]);
        expect(proxy.requestCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
      });

      test("over https, the CONNECT is signed in with the real user name and password", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );

        await settle(sender.send("https://service.example.test/v1/check"));

        expect(proxy.connects).toEqual(["service.example.test:443"]);
        expect(proxy.connectCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
      });

      test("through ALL_PROXY, when no other variable names a proxy", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["ALL_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );

        await sender.send("http://service.example.test/all");

        expect(proxy.requestCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
      });
    });

    test("a host in NO_PROXY is sent to directly, and the proxy is never asked", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const target: LocalHttpServer = await serve({ name: "target" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );
      process.env["NO_PROXY"] = "127.0.0.1";

      await sender.send(target.url("/direct"));

      expect(
        target.requests.map((seen: { url: string }) => {
          return seen.url;
        }),
      ).toEqual(["/direct"]);
      expect(proxy.isUntouched).toBe(true);
    });

    test("with no proxy at all, it is sent directly", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const target: LocalHttpServer = await serve({ name: "target" });

      await sender.send(target.url("/direct"));

      expect(target.requests).toHaveLength(1);
      expect(target.requestCredentials).toEqual([""]);
      expect(proxy.isUntouched).toBe(true);
    });
  },
);

describe("a request that follows redirects is routed again at each one, as axios routed it", () => {
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

  test("from a host in NO_PROXY to one outside it: the second request goes through the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const start: LocalHttpServer = await serve({ name: "start" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = "127.0.0.1";
    redirectsTo(start, "http://elsewhere.example.test/next");

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({ url: URL.fromString(start.url("/start")) });

    expect(response.statusCode).toBe(200);
    expect(
      start.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["/start"]);
    expect(
      proxy.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["http://elsewhere.example.test/next"]);
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

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString("http://service.example.test/start"),
      });

    expect(response.statusCode).toBe(200);
    expect(
      proxy.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["http://service.example.test/start"]);
    expect(
      final.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["/final"]);
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

    await settle(
      API.get<JSONObject>({
        url: URL.fromString("http://service.example.test/start"),
      }),
    );

    expect(
      httpProxy.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["http://service.example.test/start"]);
    expect(httpsProxy.connects).toEqual(["service.example.test:443"]);
    expect(httpsProxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a request that follows only same-server redirects still refuses another server's", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    redirectsTo(proxy, "http://elsewhere.example.test/stolen");

    let refusal: unknown = undefined;

    try {
      await API.get<JSONObject>({
        url: URL.fromString("http://service.example.test/start"),
        options: { sameServerRedirectsOnly: true },
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeDefined();
    expect(proxy.requests).toHaveLength(1);
  });
});

describe("a proxy that refuses the tunnel", () => {
  async function refusalOf(url: string): Promise<Error> {
    try {
      await API.get<JSONObject>({ url: URL.fromString(url) });
    } catch (error) {
      return error as Error;
    }

    throw new Error("The request went through.");
  }

  test("is said to have refused it, with its answer and never its address", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const refusal: Error = await refusalOf("https://hooks.example.test/hook");

    expect(refusal.message).toBe(
      "Request failed to https://hooks.example.test/hook. The outbound proxy did not open a connection to hooks.example.test:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(refusal.message).not.toContain(String(proxy.port));
    expect(API.getFriendlyErrorMessage(refusal)).not.toContain(
      String(proxy.port),
    );
  });

  test("with a 407, is said to have refused OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await refusalOf("https://api.example.test/v1");

    expect(refusal.message).toContain(
      "The outbound proxy did not take OneUptime's user name and password: it answered HTTP/1.1 407 Proxy Authentication Required, so the request to api.example.test:443 was not sent.",
    );
    // Never the password, encoded or not.
    expect(refusal.message).not.toContain("p@ss");
    expect(refusal.message).not.toContain("p%40ss");
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });
});

describe("an axios interceptor of OutboundProxyAgents", () => {
  test("is the function itself, which needs no object to be called on", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";
    const route: (
      config: InternalAxiosRequestConfig,
    ) => InternalAxiosRequestConfig = OutboundProxyAgents.routeAxiosRequest;
    const config: InternalAxiosRequestConfig = {
      url: "https://api.example.test/",
      headers: {} as InternalAxiosRequestConfig["headers"],
    };

    expect(route(config).proxy).toBe(false);
  });
});
