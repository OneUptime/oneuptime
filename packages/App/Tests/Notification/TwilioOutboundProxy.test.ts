import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import logger from "Common/Server/Utils/Logger";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
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
  watchLookups,
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
import BadDataException from "Common/Types/Exception/BadDataException";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import fs from "fs";
import https from "https";
import path from "path";
import Twilio from "twilio";
import RequestClient from "twilio/lib/base/RequestClient";
import TwilioHttpClient, {
  TWILIO_HTTP_PROXY_FALLBACK_MESSAGE,
} from "../../FeatureSet/Notification/Utils/TwilioHttpClient";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * TWILIO'S SMS AND CALLS GO THROUGH THE OUTBOUND PROXY AS EVERY REQUEST OF
 * THE SERVER DOES (issue #10721).
 *
 * Twilio's own client read HTTP_PROXY alone: HTTPS_PROXY, ALL_PROXY and
 * NO_PROXY were ignored, every Twilio host went one way, and its CA bundle
 * was dropped behind a proxy. Each Twilio client is handed TwilioHttpClient
 * now. These send through the real Twilio client to proxies and servers on
 * this machine (OutboundProxyFixture, SelfSignedHttpsFixture); where a
 * request went is read from the proxy and from what this machine looked up
 * (watchLookups), so nothing leaves it.
 */

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

const TWILIO_HOST: string = "api.twilio.com";
// Twilio checks only that an account SID starts with "AC".
const ACCOUNT_SID: string = "AC-test-account";

// The variables that are no proxy's but change Twilio's client.
const TWILIO_VARIABLES: Array<string> = ["TWILIO_CA_BUNDLE", "http_proxy"];
const savedTwilioVariables: Map<string, string | undefined> = new Map<
  string,
  string | undefined
>();

beforeEach(() => {
  TwilioHttpClient.resetFallbackLog();

  for (const name of TWILIO_VARIABLES) {
    savedTwilioVariables.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
  (logger.warn as jest.Mock).mockClear();

  for (const name of TWILIO_VARIABLES) {
    const value: string | undefined = savedTwilioVariables.get(name);

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function client(): Twilio.Twilio {
  return Twilio(ACCOUNT_SID, "twilio-auth-token", {
    httpClient: TwilioHttpClient.create(),
  });
}

// An SMS, as SmsService sends one.
async function sendSms(): Promise<unknown> {
  return await client().messages.create({
    to: "+14155550100",
    from: "+14155550101",
    body: "Incident #12: Checkout is down.",
  });
}

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Twilio was reached.");
}

function warnings(): Array<unknown> {
  return (logger.warn as jest.Mock).mock.calls.map(
    (call: Array<unknown>): unknown => {
      return call[0];
    },
  );
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
    test("an SMS goes through HTTPS_PROXY: the CONNECT is signed in with the real user name and password, and Twilio's host is not looked up here", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const lookups: Array<string> = watchLookups([TWILIO_HOST]);

      await failureOf(sendSms());

      expect(proxy.connects).toEqual([`${TWILIO_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
      expect(lookups).not.toContain(TWILIO_HOST);
    });

    test("through ALL_PROXY, when no other variable names a proxy", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["ALL_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      await failureOf(sendSms());

      expect(proxy.connects).toEqual([`${TWILIO_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
    });

    test("an install that set HTTP_PROXY alone keeps sending through it, signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const lookups: Array<string> = watchLookups([TWILIO_HOST]);

      await failureOf(sendSms());

      expect(proxy.connects).toEqual([`${TWILIO_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
      expect(lookups).not.toContain(TWILIO_HOST);
    });
  },
);

describe("NO_PROXY", () => {
  test("a Twilio host it names is sent to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = TWILIO_HOST;
    const lookups: Array<string> = watchLookups([TWILIO_HOST]);

    const failure: Error = await failureOf(sendSms());

    expect(lookups).toContain(TWILIO_HOST);
    expect(proxy.isUntouched).toBe(true);
    expect((failure as { code?: unknown }).code).toBe("ENOTFOUND");
  });

  test("names a host for HTTP_PROXY's fallback too", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = ".twilio.com";
    const lookups: Array<string> = watchLookups([TWILIO_HOST]);

    await failureOf(sendSms());

    expect(lookups).toContain(TWILIO_HOST);
    expect(proxy.isUntouched).toBe(true);
    expect(warnings()).toEqual([]);
  });

  test("each Twilio host is decided for itself, not once for every one", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = TWILIO_HOST;
    const lookups: Array<string> = watchLookups([TWILIO_HOST]);
    const twilio: Twilio.Twilio = client();

    await failureOf(
      twilio.messages.create({
        to: "+14155550100",
        from: "+14155550101",
        body: "Incident #12",
      }),
    );
    await failureOf(
      twilio.request({
        method: "get",
        uri: "https://messaging.twilio.com/v1/Services",
      }),
    );

    expect(lookups).toContain(TWILIO_HOST);
    expect(proxy.connects).toEqual(["messaging.twilio.com:443"]);
  });
});

describe("with no proxy at all", () => {
  test("an SMS is sent directly", async () => {
    const lookups: Array<string> = watchLookups([TWILIO_HOST]);

    await failureOf(sendSms());

    expect(lookups).toContain(TWILIO_HOST);
  });
});

describe("a tunnel the proxy refuses", () => {
  test("fails as the proxy's refusal, which names where the SMS was going and never the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(sendSms());

    expect(failure.message).toBe(
      "The outbound proxy did not open a connection to api.twilio.com:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(failure.message).not.toContain(PROXY_HOST_NAME);
    expect(failure.message).not.toContain(String(proxy.port));
  });

  test("a 407 is the proxy not taking OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(sendSms());

    expect(failure.message).toBe(
      "The outbound proxy answered HTTP/1.1 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to api.twilio.com:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
    expect(failure.message).not.toContain("p@ss");
    expect(failure.message).not.toContain("p%40ss");
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("any other failure is left as Twilio's client gave it", () => {
    const failure: Error = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });

    expect(TwilioHttpClient.asProxyRefusal(failure)).toBeNull();
  });
});

describe("HTTP_PROXY, kept for an install that set it alone", () => {
  test("the server says so once in its log, however many SMS and calls go, naming no proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    await failureOf(sendSms());
    await failureOf(sendSms());
    await failureOf(
      client().calls.create({
        to: "+14155550100",
        from: "+14155550101",
        twiml: "<Response><Say>Incident #12</Say></Response>",
      }),
    );

    expect(proxy.connects).toHaveLength(3);
    expect(warnings()).toEqual([TWILIO_HTTP_PROXY_FALLBACK_MESSAGE]);
    expect(TWILIO_HTTP_PROXY_FALLBACK_MESSAGE).not.toContain(PROXY_HOST_NAME);
  });

  test("HTTPS_PROXY wins over it, and nothing is logged", async () => {
    const httpsProxy: LocalHttpServer = await serve({ name: "https proxy" });
    const httpProxy: LocalHttpServer = await serve({ name: "http proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${httpsProxy.port}`;
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${httpProxy.port}`;

    await failureOf(sendSms());

    expect(httpsProxy.connects).toEqual([`${TWILIO_HOST}:443`]);
    expect(httpProxy.isUntouched).toBe(true);
    expect(warnings()).toEqual([]);
  });

  test("ALL_PROXY wins over it", async () => {
    const allProxy: LocalHttpServer = await serve({ name: "all proxy" });
    const httpProxy: LocalHttpServer = await serve({ name: "http proxy" });
    process.env["ALL_PROXY"] = `http://${PROXY_HOST_NAME}:${allProxy.port}`;
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${httpProxy.port}`;

    await failureOf(sendSms());

    expect(allProxy.connects).toEqual([`${TWILIO_HOST}:443`]);
    expect(httpProxy.isUntouched).toBe(true);
  });

  test("a lowercase http_proxy alone, which Twilio's client never read, leaves it going directly", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["http_proxy"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    const lookups: Array<string> = watchLookups([TWILIO_HOST]);

    await failureOf(sendSms());

    expect(lookups).toContain(TWILIO_HOST);
    expect(proxy.isUntouched).toBe(true);
  });
});

describe("the route each request takes", () => {
  test.each([
    {
      environment: { HTTPS_PROXY: "http://https.proxy.test:3128" },
      proxy: "http://https.proxy.test:3128/",
    },
    {
      environment: { ALL_PROXY: "http://all.proxy.test:3128" },
      proxy: "http://all.proxy.test:3128/",
    },
    {
      environment: { HTTP_PROXY: "http://http.proxy.test:3128" },
      proxy: "http://http.proxy.test:3128/",
    },
    {
      environment: {
        HTTP_PROXY: "http://http.proxy.test:3128",
        NO_PROXY: "api.twilio.com:443",
      },
      proxy: null,
    },
    {
      environment: {
        HTTPS_PROXY: "http://https.proxy.test:3128",
        NO_PROXY: "10.0.0.0/8, .twilio.com",
      },
      proxy: null,
    },
    {
      environment: {
        HTTP_PROXY: "http://http.proxy.test:3128",
        NO_PROXY: "api.twilio.com:80",
      },
      proxy: "http://http.proxy.test:3128/",
    },
    { environment: {}, proxy: null },
  ])(
    "$environment: $proxy",
    (data: { environment: Record<string, string>; proxy: string | null }) => {
      Object.assign(process.env, data.environment);

      const proxy: URL | null = TwilioHttpClient.getProxyFor(
        new URL("https://api.twilio.com/2010-04-01/Accounts.json"),
      );

      expect(proxy ? proxy.href : null).toBe(data.proxy);
    },
  );

  test("a proxy setting that cannot be used fails the SMS in words that name no password", async () => {
    process.env["HTTPS_PROXY"] = "socks5://ops:p%40ss@socks.corp.example:1080";

    const failure: Error = await failureOf(sendSms());

    expect(failure).toBeInstanceOf(BadDataException);
    expect(failure.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
  });
});

/*
 * Twilio's CA bundle (TWILIO_CA_BUNDLE) and timeout go on the connection to
 * Twilio, inside the proxy's tunnel, never on the connection to an https://
 * proxy, which keeps the CAs the process trusts. Twilio's own client dropped
 * both behind HTTP_PROXY.
 */
describe("Twilio's CA bundle and timeout", () => {
  let certificates: TestCertificates | undefined = undefined;
  let caBundle: string = "";

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
    certificates = generateTestCertificates(TWILIO_HOST);
    caBundle = path.join(certificates.workDir, "twilio-ca-bundle.pem");
    fs.writeFileSync(caBundle, certificates.caCertificate);
  });

  afterAll(() => {
    removeTestCertificates(certificates);
  });

  // A Twilio stand-in at api.twilio.com, with a certificate the bundle vouches for.
  async function twilioStandIn(): Promise<LocalHttpsServer> {
    return await selfSigned.serve({ certificate: certificates!.caSigned });
  }

  async function proxyTo(
    target: LocalHttpsServer,
    certificate?: TestCertificate | undefined,
  ): Promise<TunnellingProxy> {
    return await selfSigned.proxy({
      route: (authority: string): TunnelEnd | null => {
        return authority === `${TWILIO_HOST}:${target.port}`
          ? { host: target.host, port: target.port }
          : null;
      },
      certificate: certificate,
    });
  }

  /*
   * A request through Twilio's http client, as Twilio's client sends one,
   * and the config axios sent it with.
   */
  async function ask(target: LocalHttpsServer): Promise<{
    statusCode: number;
    config: InternalAxiosRequestConfig | undefined;
  }> {
    const httpClient: RequestClient = TwilioHttpClient.create();
    let config: InternalAxiosRequestConfig | undefined = undefined;

    httpClient.axios.interceptors.response.use(
      (response: AxiosResponse): AxiosResponse => {
        config = response.config;
        return response;
      },
    );

    const response: { statusCode: number } = await httpClient.request({
      method: "get",
      uri: `https://${TWILIO_HOST}:${target.port}/2010-04-01/Accounts.json`,
      username: ACCOUNT_SID,
      password: "twilio-auth-token",
    });

    return { statusCode: response.statusCode, config: config };
  }

  test("through an http:// proxy's tunnel, Twilio is checked against the bundle, with Twilio's timeout", async () => {
    process.env["TWILIO_CA_BUNDLE"] = caBundle;
    const target: LocalHttpsServer = await twilioStandIn();
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTPS_PROXY"] = proxy.url;

    const answer: {
      statusCode: number;
      config: InternalAxiosRequestConfig | undefined;
    } = await ask(target);
    const agentOptions: https.AgentOptions = (
      answer.config!.httpsAgent as https.Agent
    ).options;

    expect(answer.statusCode).toBe(200);
    expect(proxy.connects).toEqual([`${TWILIO_HOST}:${target.port}`]);
    expect(target.requests).toHaveLength(1);
    expect(agentOptions.timeout).toBe(30000);
    expect(String(agentOptions.ca)).toBe(certificates!.caCertificate);
    expect(answer.config!.proxy).toBe(false);
  });

  test("through HTTP_PROXY's fallback, the bundle is kept, which Twilio's own client dropped", async () => {
    process.env["TWILIO_CA_BUNDLE"] = caBundle;
    const target: LocalHttpsServer = await twilioStandIn();
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTP_PROXY"] = proxy.url;

    const answer: { statusCode: number } = await ask(target);

    expect(answer.statusCode).toBe(200);
    expect(proxy.connects).toEqual([`${TWILIO_HOST}:${target.port}`]);
  });

  test("through an https:// proxy the process trusts, the proxy is checked against the process's CAs and Twilio against the bundle", async () => {
    process.env["TWILIO_CA_BUNDLE"] = caBundle;
    const target: LocalHttpsServer = await twilioStandIn();
    const proxy: TunnellingProxy = await proxyTo(target, certificates!.proxy);
    trustAsDefaultCa(certificates!.proxy.certificate);
    process.env["HTTPS_PROXY"] = proxy.url;

    const answer: { statusCode: number } = await ask(target);

    expect(answer.statusCode).toBe(200);
    expect(proxy.connects).toEqual([`${TWILIO_HOST}:${target.port}`]);
  });

  test("the bundle does not vouch for an https:// proxy the process does not trust", async () => {
    process.env["TWILIO_CA_BUNDLE"] = caBundle;
    const target: LocalHttpsServer = await twilioStandIn();
    const proxy: TunnellingProxy = await proxyTo(target, certificates!.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    await failureOf(ask(target));

    expect(proxy.connects).toEqual([]);
    expect(target.isUntouched).toBe(true);
  });

  test("with no bundle, a Twilio the process does not trust is refused inside the tunnel, and nothing reaches it", async () => {
    const target: LocalHttpsServer = await twilioStandIn();
    const proxy: TunnellingProxy = await proxyTo(target);
    process.env["HTTPS_PROXY"] = proxy.url;

    await failureOf(ask(target));

    expect(proxy.connects).toEqual([`${TWILIO_HOST}:${target.port}`]);
    expect(target.isUntouched).toBe(true);
  });
});
