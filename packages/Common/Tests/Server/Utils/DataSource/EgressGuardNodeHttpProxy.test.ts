/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import DataSourceEgressGuard, {
  GuardedNodeHttpAgents,
  PinnedAgents,
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import GuardedMcpHttpTransport, {
  McpHttpResponse,
} from "../../../../Server/Utils/AI/Mcp/McpHttpTransport";
import ExternalCalendarFetch, {
  ExternalCalendarFetchResult,
} from "../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EgressGuardException from "../../../../Types/Exception/EgressGuardException";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  approveOnLoopback,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "../../TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

jest.mock("../../../../Server/Utils/Logger");

/*
 * NODE'S OWN HTTP CLIENT, BEHIND AN OUTBOUND PROXY (issue #8932).
 *
 * External calendars, MCP servers, backups and OIDC send with Node's own
 * http client, which reads no proxy setting, so on a server that reaches the
 * internet only through a proxy each of them failed. The egress guard now
 * builds their agents to go through the proxy exactly as axios would
 * (OutboundProxy.getProxyFor):
 *
 *   - createPinnedAgents, for a request to one checked URL
 *     (calendars, MCP servers): a CONNECT tunnel for https, naming the
 *     host, the whole URL to the proxy for http; directly, at the approved
 *     address, when NO_PROXY names the host or no proxy is set;
 *   - createGuardedAgentsForNodeHttp, for a client that learns its hosts as
 *     it goes (backups, OIDC): through a proxy, the host is checked - looked
 *     up, every address held to the policy - before the proxy is asked for
 *     it; directly, every name is checked by the agent's lookup and every
 *     IP address before its socket opens.
 *
 * Either way the proxy's own name is looked up as usual and never held to
 * the egress policy: the proxies here listen on loopback, which the policy
 * refuses on every install.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  jest.restoreAllMocks();
});

interface SentRequest {
  statusCode: number;
  body: string;
}

// One request on `agent`, its answer or its error.
async function send(data: {
  url: string;
  agent: http.Agent;
  method?: string | undefined;
  body?: string | undefined;
}): Promise<SentRequest> {
  const url: URL = new URL(data.url);

  return await new Promise<SentRequest>(
    (resolve: (value: SentRequest) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = (
        url.protocol === "https:" ? https : http
      ).request(
        url,
        {
          method: data.method || "GET",
          agent: data.agent,
          headers:
            data.body !== undefined
              ? { "Content-Length": String(Buffer.byteLength(data.body)) }
              : {},
        },
        (response: http.IncomingMessage) => {
          let body: string = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({ statusCode: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);

      if (data.body !== undefined) {
        request.write(data.body);
      }

      request.end();
    },
  );
}

async function sendError(data: {
  url: string;
  agent: http.Agent;
}): Promise<Error> {
  try {
    await send(data);
  } catch (error) {
    return error as Error;
  }

  throw new Error("The request succeeded.");
}

/*
 * What the guard's DNS answers for `hostname`: a public address the policy
 * approves, or `address`. Nothing else resolves, and nothing else is
 * approved: unlike approveOnLoopback, loopback stays refused.
 */
function resolveOnly(
  hostname: string,
  address: string = "93.184.216.34",
): void {
  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    name: string,
  ) => {
    if (name !== hostname) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), {
        code: "ENOTFOUND",
      });
    }

    return [{ address: address, family: net.isIP(address) }];
  }) as never);
}

function pinnedTo(url: string, address: string): PinnedAgents {
  const addresses: Array<ResolvedAddress> = [
    { address: address, family: net.isIP(address) },
  ];

  return DataSourceEgressGuard.createPinnedAgents({
    url: new URL(url),
    addresses: addresses,
  });
}

function destroy(agents: PinnedAgents): void {
  agents.httpAgent.destroy();
  agents.httpsAgent.destroy();
}

describe("createPinnedAgents, for a request to one checked URL", () => {
  test("over http, a proxy named by host name is sent the whole URL, and its credentials", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] =
      `http://oneuptime:s%40cret@${PROXY_HOST_NAME}:${proxy.port}`;
    const agents: PinnedAgents = pinnedTo(
      "http://calendar.example.test:8080/team.ics",
      "203.0.113.9",
    );
    const authorizations: Array<string> = [];
    proxy.handler = (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      authorizations.push(String(request.headers["proxy-authorization"]));
      response.end("from the proxy");
    };

    const answer: SentRequest = await send({
      url: "http://calendar.example.test:8080/team.ics?x=1",
      agent: agents.httpAgent,
    });
    destroy(agents);

    expect(answer).toEqual({ statusCode: 200, body: "from the proxy" });
    expect(proxy.requests).toEqual([
      {
        method: "GET",
        url: "http://calendar.example.test:8080/team.ics?x=1",
        host: "calendar.example.test:8080",
        body: "",
      },
    ]);
    expect(authorizations).toEqual([
      `Basic ${Buffer.from("oneuptime:s@cret").toString("base64")}`,
    ]);
  });

  test("over https, the proxy is asked to tunnel to the host by name, never by the approved address", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    const agents: PinnedAgents = pinnedTo(
      "https://mcp.example.test/mcp",
      "203.0.113.9",
    );

    // The proxy refuses every tunnel here; where it was asked to is the point.
    const error: Error = await sendError({
      url: "https://mcp.example.test/mcp",
      agent: agents.httpsAgent,
    });
    destroy(agents);

    expect(error.message).toContain("403");
    expect(proxy.connects).toEqual(["mcp.example.test:443"]);
  });

  test("the proxy's own address is never held to the egress policy", async () => {
    // The proxy is on loopback, which the policy refuses on every install.
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolveOnly("calendar.example.test");
    const checked: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataSourceEgressGuard,
      "checkAddress",
    );

    const pinned: { url: URL } & PinnedAgents =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(
        "http://calendar.example.test/team.ics",
        { blockPrivateAddresses: true },
      );
    const answer: SentRequest = await send({
      url: pinned.url.href,
      agent: pinned.httpAgent,
    });
    destroy(pinned);

    expect(answer.statusCode).toBe(200);
    expect(proxy.requests).toHaveLength(1);
    expect(
      checked.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual(["93.184.216.34"]);
  });

  test("a host in NO_PROXY is dialled directly, at the approved address only", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = ".example.test";
    // The name resolves nowhere real: only the pin reaches the server.
    const agents: PinnedAgents = pinnedTo(
      `http://calendar.example.test:${target.port}/team.ics`,
      target.host,
    );

    const answer: SentRequest = await send({
      url: `http://calendar.example.test:${target.port}/team.ics`,
      agent: agents.httpAgent,
    });
    destroy(agents);

    expect(answer.statusCode).toBe(200);
    expect(
      target.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["/team.ics"]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("a proxy for the other scheme only leaves the request direct", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    const agents: PinnedAgents = pinnedTo(
      `http://calendar.example.test:${target.port}/team.ics`,
      target.host,
    );

    await send({
      url: `http://calendar.example.test:${target.port}/team.ics`,
      agent: agents.httpAgent,
    });
    destroy(agents);

    expect(target.requests).toHaveLength(1);
    expect(proxy.isUntouched).toBe(true);
  });

  test("ALL_PROXY, written without a scheme, carries an http request", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["ALL_PROXY"] = `${PROXY_HOST_NAME}:${proxy.port}`;
    const agents: PinnedAgents = pinnedTo(
      "http://calendar.example.test/team.ics",
      "203.0.113.9",
    );

    await send({
      url: "http://calendar.example.test/team.ics",
      agent: agents.httpAgent,
    });
    destroy(agents);

    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["http://calendar.example.test/team.ics"]);
  });

  test("a proxy setting that is no URL is refused, and the refusal does not repeat it", () => {
    process.env["HTTPS_PROXY"] = "::user:hunter2 not a url";

    let error: unknown = null;

    try {
      pinnedTo("https://mcp.example.test/mcp", "203.0.113.9");
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not a URL.",
    );
    expect((error as Error).message).not.toContain("hunter2");
  });

  test("a proxy Node cannot speak to is refused, rather than gone around", () => {
    process.env["HTTPS_PROXY"] = "socks5://user:hunter2@proxy.corp:1080";

    expect(() => {
      return pinnedTo("https://mcp.example.test/mcp", "203.0.113.9");
    }).toThrow(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
  });
});

describe("createGuardedAgentsForNodeHttp, for a client that learns its hosts as it goes", () => {
  test("with no proxy, a name is checked by the agent's lookup and dialled at the approved address", async () => {
    const target: LocalHttpServer = await serve({ name: "target" });
    approveOnLoopback({ "storage.example.test": [target.host] });
    const agents: GuardedNodeHttpAgents =
      DataSourceEgressGuard.createGuardedAgentsForNodeHttp({});

    const url: string = `http://storage.example.test:${target.port}/bucket/part-1`;
    const answer: SentRequest = await send({
      url,
      agent: agents.agentFor(new URL(url)),
      method: "PUT",
      body: "part one",
    });
    agents.destroy();

    expect(answer.statusCode).toBe(200);
    expect(target.requests).toEqual([
      {
        method: "PUT",
        url: "/bucket/part-1",
        host: `storage.example.test:${target.port}`,
        body: "part one",
      },
    ]);
  });

  test("with no proxy, an IP address the policy refuses is refused before a socket opens", async () => {
    const agents: GuardedNodeHttpAgents =
      DataSourceEgressGuard.createGuardedAgentsForNodeHttp({
        targetLabel: "Backup destination",
      });
    const connect: ReturnType<typeof jest.spyOn> = jest.spyOn(net, "connect");

    const url: string = "http://169.254.169.254/latest/meta-data/";
    const error: Error = await sendError({
      url,
      agent: agents.agentFor(new URL(url)),
    });
    agents.destroy();

    expect(error).toBeInstanceOf(EgressGuardException);
    expect(error.message).toContain("Backup destination host 169.254.169.254");
    expect(connect).not.toHaveBeenCalled();
  });

  test("with no proxy, a name that resolves somewhere refused is refused", async () => {
    resolveOnly("rebind.example.test", "169.254.169.254");
    const agents: GuardedNodeHttpAgents =
      DataSourceEgressGuard.createGuardedAgentsForNodeHttp({});

    const url: string = "http://rebind.example.test/x";
    const error: Error = await sendError({
      url,
      agent: agents.agentFor(new URL(url)),
    });
    agents.destroy();

    expect(error).toBeInstanceOf(EgressGuardException);
  });

  test.each(["http", "https"])(
    "over %s through a proxy, the host is checked before the proxy is asked for it",
    async (scheme: string) => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env[scheme === "https" ? "HTTPS_PROXY" : "HTTP_PROXY"] =
        `http://${PROXY_HOST_NAME}:${proxy.port}`;
      resolveOnly("idp.example.test");
      const agents: GuardedNodeHttpAgents =
        DataSourceEgressGuard.createGuardedAgentsForNodeHttp({
          blockPrivateAddresses: true,
        });

      const allowed: string = `${scheme}://idp.example.test/.well-known/openid-configuration`;

      try {
        await send({ url: allowed, agent: agents.agentFor(new URL(allowed)) });
      } catch {
        // The proxy refuses every tunnel here.
      }

      // A name that resolves nowhere: refused here, never asked of the proxy.
      const refused: string = `${scheme}://internal.example.test/x`;
      const error: Error = await sendError({
        url: refused,
        agent: agents.agentFor(new URL(refused)),
      });

      // An address the policy refuses: the same.
      const metadata: string = `${scheme}://169.254.169.254/latest/`;
      const metadataError: Error = await sendError({
        url: metadata,
        agent: agents.agentFor(new URL(metadata)),
      });
      agents.destroy();

      expect(error).toBeInstanceOf(EgressGuardException);
      expect(metadataError).toBeInstanceOf(EgressGuardException);

      if (scheme === "https") {
        expect(proxy.connects).toEqual(["idp.example.test:443"]);
        expect(proxy.requests).toEqual([]);
      } else {
        expect(
          proxy.requests.map((request: { url: string }) => {
            return request.url;
          }),
        ).toEqual(["http://idp.example.test/.well-known/openid-configuration"]);
        expect(proxy.connects).toEqual([]);
      }
    },
  );

  test("a body reaches the proxy whole, and a second request takes the same agent", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolveOnly("storage.example.test");
    const agents: GuardedNodeHttpAgents =
      DataSourceEgressGuard.createGuardedAgentsForNodeHttp(
        {},
        { keepAlive: true },
      );

    const first: URL = new URL("http://storage.example.test/bucket/a");
    const second: URL = new URL("http://storage.example.test/bucket/b");
    const agent: http.Agent = agents.agentFor(first);

    expect(agents.agentFor(second)).toBe(agent);

    await send({
      url: first.href,
      agent,
      method: "PUT",
      body: "a".repeat(4096),
    });
    await send({ url: second.href, agent, method: "PUT", body: "second" });
    agents.destroy();

    expect(
      proxy.requests.map((request: { url: string; body: string }) => {
        return [request.url, request.body.length];
      }),
    ).toEqual([
      ["http://storage.example.test/bucket/a", 4096],
      ["http://storage.example.test/bucket/b", 6],
    ]);
  });

  test("a host in NO_PROXY gets the direct agent", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    process.env["NO_PROXY"] = "minio.internal,10.0.0.0/8";
    const agents: GuardedNodeHttpAgents =
      DataSourceEgressGuard.createGuardedAgentsForNodeHttp({});

    const direct: http.Agent = agents.agentFor(
      new URL("https://minio.internal/b"),
    );
    const proxied: http.Agent = agents.agentFor(
      new URL("https://s3.amazonaws.com/b"),
    );

    expect(agents.agentFor(new URL("https://10.1.2.3/b"))).toBe(direct);
    expect(proxied).not.toBe(direct);
    expect(agents.agentFor(new URL("https://storage.googleapis.com/b"))).toBe(
      proxied,
    );
    agents.destroy();
  });
});

describe("a calendar and an MCP server, read whole through a proxy", () => {
  const CALENDAR: string = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:1",
    "SUMMARY:Maintenance",
    "DTSTART:20261201T100000Z",
    "DTEND:20261201T110000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  test("an external calendar's link is read through an http proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolveOnly("calendar.example.test");
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "text/calendar" });
      response.end(CALENDAR);
    };

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(
        "http://calendar.example.test/team.ics",
        { timeoutInMs: 5000 },
      );

    expect(result).toEqual({ ok: true, body: CALENDAR });
    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["http://calendar.example.test/team.ics"]);
  });

  test("a calendar link that resolves somewhere refused is never asked of the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolveOnly("calendar.example.test", "169.254.169.254");

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(
        "http://calendar.example.test/team.ics",
        { timeoutInMs: 5000 },
      );

    expect(result.ok).toBe(false);
    expect(proxy.isUntouched).toBe(true);
  });

  test("an MCP server answers through an http proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolveOnly("mcp.example.test");
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
      body: string,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ echoed: JSON.parse(body) }));
    };

    const response: McpHttpResponse = await new GuardedMcpHttpTransport().send({
      method: "POST",
      url: "http://mcp.example.test/mcp",
      headers: { "Content-Type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
      signal: new AbortController().signal,
      maxResponseBytes: 1024 * 1024,
    });

    let text: string = "";

    for await (const chunk of response.readChunks()) {
      text += chunk;
    }

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      echoed: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["http://mcp.example.test/mcp"]);
  });
});
