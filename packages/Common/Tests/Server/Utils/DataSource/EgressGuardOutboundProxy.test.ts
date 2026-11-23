/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import DataSourceEgressGuard, {
  EgressLookupFunction,
  OUTBOUND_PROXY_ENVIRONMENT_VARIABLES,
  PinnedAgents,
  PinnedTarget,
  ResolvedAddress,
  UNAPPROVED_LOOKUP_MESSAGE,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  approveOnLoopback,
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "../../TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, { AxiosResponse } from "axios";
import dns from "dns";
import http from "http";
import https from "https";

/*
 * A PINNED REQUEST BEHIND AN OUTBOUND PROXY NAMED BY HOST NAME (issue
 * #8873).
 *
 * Every HTTP request OneUptime pins - a data source's, an LLM provider's,
 * custom domain verification, a Runbook HTTP step, an OAuth token URL, a
 * tool import, every webhook - is sent on agents whose lookup answers the
 * checked host's name from the addresses its check approved. Axios sends
 * through HTTPS_PROXY / HTTP_PROXY / ALL_PROXY, apart from the hosts in
 * NO_PROXY, and has those agents connect to the proxy; the lookup used to
 * answer the proxy's name from the pin too, so the request dialled the
 * target's address on the proxy's port. It now looks the proxy's own name
 * up as any request's would be, and refuses every other name.
 *
 * The first part asks the lookup itself; the rest sends real requests,
 * through axios's Node adapter as production does, to a proxy and servers
 * on this machine (OutboundProxyFixture says how). Every caller's own
 * suite - EgressGuardedRequestsBehindProxy - holds it to the same.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

let canUse127002: boolean = false;

beforeAll(async () => {
  canUse127002 = await canListenOn("127.0.0.2");
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface LookupAnswer {
  error: NodeJS.ErrnoException | null;
  address: unknown;
}

function look(
  lookup: EgressLookupFunction,
  hostname: string,
  options: { all?: boolean; family?: number },
): Promise<LookupAnswer> {
  return new Promise((resolve: (answer: LookupAnswer) => void) => {
    lookup(
      hostname,
      options,
      (error: NodeJS.ErrnoException | null, address: unknown) => {
        resolve({ error: error, address: address });
      },
    );
  });
}

function systemLookup(hostname: string): Promise<unknown> {
  return new Promise(
    (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
      dns.lookup(
        hostname,
        { all: true },
        (error: NodeJS.ErrnoException | null, addresses: unknown) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(addresses);
        },
      );
    },
  );
}

describe("the pinned lookup of a request to one URL", () => {
  const target: PinnedTarget = {
    url: new URL("https://Data.Example.com/v1/query"),
    addresses: [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ],
  };

  test("answers the URL's host name with the addresses its check approved, as the socket asks for them", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);

    expect(
      (await look(lookup, "data.example.com", { all: true })).address,
    ).toEqual(target.addresses);
    expect(
      (await look(lookup, "DATA.EXAMPLE.COM", { family: 4 })).address,
    ).toBe("93.184.216.34");
    expect(
      (await look(lookup, "data.example.com", { all: true, family: 6 }))
        .address,
    ).toEqual([target.addresses[1]]);
  });

  test.each(OUTBOUND_PROXY_ENVIRONMENT_VARIABLES)(
    "looks the name of a proxy set in %s up as the system does",
    async (variable: string) => {
      process.env[variable] = variable.startsWith("all")
        ? `${PROXY_HOST_NAME}:3128`
        : `http://${PROXY_HOST_NAME}:3128`;

      const lookup: EgressLookupFunction =
        DataSourceEgressGuard.createPinnedLookupForTarget(target);
      const answer: LookupAnswer = await look(lookup, PROXY_HOST_NAME, {
        all: true,
      });

      expect(answer.error).toBeNull();
      expect(answer.address).toEqual(await systemLookup(PROXY_HOST_NAME));
      expect(answer.address).not.toEqual(target.addresses);
    },
  );

  test("refuses every name that is neither the URL's host nor a proxy's", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp.example:3128";

    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);

    for (const name of [
      PROXY_HOST_NAME,
      "169.254.169.254.nip.io",
      "data.example.com.evil.example",
      "example.com",
      "metadata.google.internal",
    ]) {
      const answer: LookupAnswer = await look(lookup, name, { all: true });

      expect(answer.error?.message).toBe(UNAPPROVED_LOOKUP_MESSAGE);
      expect(answer.error?.code).toBe("ENOTFOUND");
    }
  });

  test("reads the proxy's name when the socket asks, not when the agents were built", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);

    expect((await look(lookup, PROXY_HOST_NAME, {})).error?.code).toBe(
      "ENOTFOUND",
    );

    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:3128`;

    expect((await look(lookup, PROXY_HOST_NAME, {})).error).toBeNull();
  });

  test("answers asynchronously, as dns.lookup does", () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);
    let answered: boolean = false;

    lookup("elsewhere.example", {}, () => {
      answered = true;
    });
    lookup("data.example.com", {}, () => {
      answered = true;
    });

    expect(answered).toBe(false);
  });

  test("is the lookup both agents carry", async () => {
    const agents: PinnedAgents =
      DataSourceEgressGuard.createPinnedAgents(target);

    for (const agent of [agents.httpAgent, agents.httpsAgent]) {
      const lookup: EgressLookupFunction = (
        agent as unknown as { options: { lookup: EgressLookupFunction } }
      ).options.lookup;

      expect((await look(lookup, "data.example.com", {})).address).toBe(
        "93.184.216.34",
      );
      expect((await look(lookup, "example.com", {})).error?.message).toBe(
        UNAPPROVED_LOOKUP_MESSAGE,
      );
    }

    agents.httpAgent.destroy();
    agents.httpsAgent.destroy();
  });
});

/*
 * What the target is approved at: 127.0.0.2 where this machine has it, so
 * the address the proxy is reached at (127.0.0.1) is not the target's.
 */
function targetAddress(): string {
  return canUse127002 ? "127.0.0.2" : "127.0.0.1";
}

async function pin(
  url: string,
  address: string,
): Promise<{ url: URL; addresses: Array<ResolvedAddress> } & PinnedAgents> {
  approveOnLoopback({ [new URL(url).hostname]: [address] });

  return await DataSourceEgressGuard.assertUrlAllowedAndPin(url);
}

async function send(
  url: string,
  agents: PinnedAgents,
): Promise<AxiosResponse<string>> {
  try {
    return await axios.request<string>({
      url: url,
      adapter: "http",
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      maxRedirects: 0,
      timeout: 5000,
      responseType: "text",
      validateStatus: (): boolean => {
        return true;
      },
    });
  } finally {
    agents.httpAgent.destroy();
    agents.httpsAgent.destroy();
  }
}

/*
 * The code a request failed with, when it did: an https request whose
 * tunnel the proxy refused fails with Node's ERR_PROXY_TUNNEL, as the
 * pinned agents open their tunnels themselves (#10442).
 */
async function failureCodeOf(sending: Promise<unknown>): Promise<string> {
  try {
    await sending;
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }

  return "";
}

describe("a pinned request behind an outbound proxy named by host name", () => {
  test("an http request goes to the proxy, which is asked for the target by name", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ host: targetAddress() });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const url: string = target.url("/q?limit=1", "data.example.test");
    const pinned: { url: URL } & PinnedAgents = await pin(url, target.host);
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.data)).toEqual({ answeredBy: "proxy" });
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0]!.url).toBe(url);
    expect(proxy.requests[0]!.host).toBe(`data.example.test:${target.port}`);
    expect(target.isUntouched).toBe(true);
  });

  test("an https request is tunnelled through the proxy to the target by name", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "https://secure.example.test/v1/query",
      targetAddress(),
    );
    // The proxy refuses every tunnel here: its refusal, not an answer.
    expect(await failureCodeOf(send(pinned.url.href, pinned))).toBe(
      "ERR_PROXY_TUNNEL",
    );
    expect(proxy.connects).toEqual(["secure.example.test:443"]);
  });

  test("a proxy given by address is reached as it always was", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://127.0.0.1:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "http://data.example.test:8086/q",
      targetAddress(),
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(response.status).toBe(200);
    expect(proxy.requests[0]!.url).toBe("http://data.example.test:8086/q");
  });

  test("a proxy written without a scheme, in lowercase http_proxy, as axios reads it", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["http_proxy"] = `${PROXY_HOST_NAME}:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "http://data.example.test/q",
      targetAddress(),
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(response.status).toBe(200);
    expect(proxy.requests[0]!.url).toBe("http://data.example.test/q");
  });

  test("ALL_PROXY is gone through when no other variable names a proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["ALL_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "http://data.example.test/q",
      targetAddress(),
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(response.status).toBe(200);
    expect(proxy.requests[0]!.url).toBe("http://data.example.test/q");
  });

  test("a host in NO_PROXY is dialled directly, at the address its check approved", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ host: targetAddress() });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = "direct.example.test";

    const pinned: { url: URL } & PinnedAgents = await pin(
      target.url("/q", "direct.example.test"),
      target.host,
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    // direct.example.test resolves nowhere real: only the pin reaches the server.
    expect(JSON.parse(response.data)).toEqual({ answeredBy: "target" });
    expect(target.requests).toHaveLength(1);
    expect(proxy.isUntouched).toBe(true);
  });

  test("a name that resolves somewhere new after its check is still dialled at the approved address, with no proxy", async () => {
    if (!canUse127002) {
      return;
    }

    // This machine says localhost is 127.0.0.1; the check said 127.0.0.2.
    const approved: LocalHttpServer = await serve({ host: "127.0.0.2" });
    const elsewhere: LocalHttpServer = await serve({
      port: approved.port,
      name: "elsewhere",
    });

    const pinned: { url: URL } & PinnedAgents = await pin(
      approved.url("/q", "localhost"),
      "127.0.0.2",
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(JSON.parse(response.data)).toEqual({ answeredBy: "target" });
    expect(elsewhere.isUntouched).toBe(true);
  });
});

/*
 * REGRESSION (#8873). A proxy on 127.0.0.1, and a decoy on the target's
 * approved address, 127.0.0.2, at the proxy's own port: where the old
 * lookup - every name answered from the pin - sent the request.
 */
describe("the target's address on the proxy's port is never dialled", () => {
  async function proxyAndDecoy(): Promise<{
    proxy: LocalHttpServer;
    decoy: LocalHttpServer;
  }> {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const decoy: LocalHttpServer = await serve({
      host: "127.0.0.2",
      port: proxy.port,
      name: "decoy",
    });

    return { proxy, decoy };
  }

  test("an http request reaches the proxy, not the decoy", async () => {
    if (!canUse127002) {
      return;
    }

    const { proxy, decoy } = await proxyAndDecoy();
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "http://data.example.test/q",
      "127.0.0.2",
    );
    const response: AxiosResponse<string> = await send(pinned.url.href, pinned);

    expect(JSON.parse(response.data)).toEqual({ answeredBy: "proxy" });
    expect(decoy.isUntouched).toBe(true);
  });

  test("an https request's tunnel is asked of the proxy, not of the decoy", async () => {
    if (!canUse127002) {
      return;
    }

    const { proxy, decoy } = await proxyAndDecoy();
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const pinned: { url: URL } & PinnedAgents = await pin(
      "https://secure.example.test/q",
      "127.0.0.2",
    );

    expect(await failureCodeOf(send(pinned.url.href, pinned))).toBe(
      "ERR_PROXY_TUNNEL",
    );

    expect(proxy.connects).toEqual(["secure.example.test:443"]);
    expect(decoy.isUntouched).toBe(true);
  });

  /*
   * Why an HTTP agent never carries the lookup a raw socket does
   * (createPinnedLookup, every name from the pin): on one, behind this
   * proxy, the request is the decoy's. This is the bug, kept in view.
   */
  test("agents on the lookup that answers every name from the pin send it to the decoy", async () => {
    if (!canUse127002) {
      return;
    }

    const { proxy, decoy } = await proxyAndDecoy();
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const everyName: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup([
        { address: "127.0.0.2", family: 4 },
      ]);
    const response: AxiosResponse<string> = await send(
      "http://data.example.test/q",
      {
        httpAgent: new http.Agent({ lookup: everyName as never }),
        httpsAgent: new https.Agent({ lookup: everyName as never }),
      },
    );

    expect(JSON.parse(response.data)).toEqual({ answeredBy: "decoy" });
    // Sent as to a proxy - the whole URL - to the target's own address.
    expect(
      decoy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["http://data.example.test/q"]);
    expect(proxy.isUntouched).toBe(true);
  });
});
