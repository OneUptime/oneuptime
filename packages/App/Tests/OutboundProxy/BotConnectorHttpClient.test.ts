import BotFrameworkRouting from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkRouting";
import {
  ConnectorClient,
  MicrosoftAppCredentials,
  ServiceClientCredentials,
  TeamDetails,
  TurnContext,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder";
import OutboundFetch, {
  OutboundProxyRefusal,
} from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import BadDataException from "Common/Types/Exception/BadDataException";
import ProxyTunnelRefusal from "Common/Utils/ProxyTunnelRefusal";
import {
  BOT_CONNECTOR_HOST,
  ConnectorCallSeen,
  botConnectorHandler,
} from "Common/Tests/Server/TestingUtils/BotFrameworkFixture";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  PROXY_HOST_NAME,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
  watchLookups,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import {
  LocalHttpsServer,
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
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import zlib from "zlib";

jest.mock("Common/Server/Utils/Logger");

/*
 * WHAT THE TEAMS BOT SENDS TO THE BOT CONNECTOR, ON THE OUTBOUND PROXY'S
 * ROUTE (issue #10763).
 *
 * The SDK's connector clients send with @azure/core-rest-pipeline, on a
 * proxy policy of its own (BotConnectorPipelineProxyPolicy says how it
 * reads the environment). The bot's are given BotConnectorHttpClient
 * (BotFrameworkRouting.getConnectorClientOptions), which sends each
 * request on the route OutboundProxyAgents decides. Here, real
 * ConnectorClients and a TeamsConnectorClient send real requests to a
 * proxy and servers on this machine: through the proxy, signed in with a
 * user name and password holding "@", ":" and "%", past it for NO_PROXY,
 * with no proxy at all, and refused by it; and what core-rest-pipeline's
 * own Node client did for them - streamed answers, compressed answers, the
 * credentials' headers - still done.
 *
 * A Bot Connector reached through a forward proxy has a name nothing
 * resolves (connector.botframework.test): only the proxy can answer for
 * it. Its https name (smba.trafficmanager.net) is reached through a proxy
 * that tunnels to a server here with a certificate for it.
 */

const UNRESOLVED_HOST: string = "connector.botframework.test";
const CONVERSATION_ID: string = "a:conversation";

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

/*
 * Microsoft's names are never looked up here: a request that went around
 * the proxy would ask DNS for them, and is refused at once, so no test
 * reaches the real service, even with the routing broken.
 */
let lookups: Array<string> = [];

beforeEach(() => {
  lookups = watchLookups([BOT_CONNECTOR_HOST]);
});

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();
const selfSignedHttps: ReturnType<typeof useSelfSignedHttps> =
  useSelfSignedHttps();

let certificate: TestCertificates | undefined = undefined;

beforeAll(() => {
  certificate = generateTestCertificates(BOT_CONNECTOR_HOST);
});

afterAll(() => {
  removeTestCertificates(certificate);
});

afterEach(async () => {
  await OutboundFetch.destroySharedDispatchers();
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

// The error a promise fails with: it must fail.
async function failureOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }

  throw new Error("It did not fail.");
}

// A connector client of the bot's, for the Bot Connector at `serviceUrl`.
function botConnector(
  serviceUrl: string,
  credentials: ServiceClientCredentials = MicrosoftAppCredentials.Empty,
): ConnectorClient {
  return new ConnectorClient(credentials, {
    baseUri: serviceUrl,
    ...BotFrameworkRouting.getConnectorClientOptions(),
  });
}

function sendMessage(
  client: ConnectorClient,
  text: string = "pong",
): Promise<{ id?: string | undefined }> {
  return client.conversations.sendToConversation(CONVERSATION_ID, {
    type: "message",
    text: text,
  });
}

// A server that answers as the Bot Connector does.
async function serveConnector(
  name: string,
): Promise<{ server: LocalHttpServer; seen: Array<ConnectorCallSeen> }> {
  const server: LocalHttpServer = await serve({ name: name });
  const seen: Array<ConnectorCallSeen> = [];

  server.handler = botConnectorHandler({ seen: seen });

  return { server, seen };
}

describe("through the outbound proxy", () => {
  test.each([
    [
      "a user name and password holding @, : and %",
      RESERVED_CHARACTER_CREDENTIALS,
    ],
    ["plain ones", PLAIN_CREDENTIALS],
  ])(
    "a message is forwarded whole, signed in with %s as written, decoded",
    async (_name: string, credentials: typeof PLAIN_CREDENTIALS) => {
      const proxy: { server: LocalHttpServer; seen: Array<ConnectorCallSeen> } =
        await serveConnector("proxy");

      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.server.port,
        credentials,
      );

      const sent: { id?: string | undefined } = await sendMessage(
        botConnector(`http://${UNRESOLVED_HOST}/teams/`),
      );

      expect(sent.id).toBe("message-1");
      expect(
        proxy.server.requests.map((request: { url: string }) => {
          return request.url;
        }),
      ).toEqual([
        `http://${UNRESOLVED_HOST}/teams/v3/conversations/a%3Aconversation/activities`,
      ]);
      expect(proxy.seen[0]!.activity).toMatchObject({
        type: "message",
        text: "pong",
      });
      expect(proxy.server.requestCredentials).toEqual([
        signedInAs(credentials),
      ]);
    },
  );

  test("an https Bot Connector is reached through the proxy's tunnel, its certificate checked as every request's is", async () => {
    const seen: Array<ConnectorCallSeen> = [];

    trustAsDefaultCa(certificate!.caCertificate);

    const connector: LocalHttpsServer = await selfSignedHttps.serve({
      name: BOT_CONNECTOR_HOST,
      certificate: certificate!.caSigned,
    });

    connector.handler = botConnectorHandler({ seen: seen });

    const proxy: TunnellingProxy = await selfSignedHttps.proxy({
      route: (authority: string): TunnelEnd | null => {
        return authority === `${BOT_CONNECTOR_HOST}:443`
          ? { host: connector.host, port: connector.port }
          : null;
      },
      credentials: signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const sent: { id?: string | undefined } = await sendMessage(
      botConnector(`https://${BOT_CONNECTOR_HOST}/teams/`),
    );

    expect(sent.id).toBe("message-1");
    expect(
      seen.map((call: ConnectorCallSeen): string => {
        return call.path;
      }),
    ).toEqual(["/teams/v3/conversations/a%3Aconversation/activities"]);
    expect(proxy.connects).toEqual([`${BOT_CONNECTOR_HOST}:443`]);
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(lookups).not.toContain(BOT_CONNECTOR_HOST);
  });

  test("what the bot's credentials put on a request reaches the Bot Connector", async () => {
    const proxy: { server: LocalHttpServer; seen: Array<ConnectorCallSeen> } =
      await serveConnector("proxy");
    const credentials: ServiceClientCredentials = {
      signRequest: async <
        T extends { headers: { set: (name: string, value: string) => void } },
      >(
        webResource: T,
      ): Promise<T> => {
        webResource.headers.set("Authorization", "Bearer bot-token");
        return webResource;
      },
    } as unknown as ServiceClientCredentials;

    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.server.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    await sendMessage(
      botConnector(`http://${UNRESOLVED_HOST}/teams/`, credentials),
    );

    expect(proxy.seen[0]!.authorization).toBe("Bearer bot-token");
  });

  test("an answer the SDK reads as a stream (an attachment) comes back whole", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const attachment: Buffer = Buffer.from(
      Array.from({ length: 70000 }, (_value: unknown, index: number) => {
        return index % 251;
      }),
    );

    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(attachment);
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const answer: { readableStreamBody?: NodeJS.ReadableStream | undefined } =
      await botConnector(
        `http://${UNRESOLVED_HOST}/`,
      ).attachments.getAttachment("attachment-1", "original");
    const chunks: Array<Buffer> = [];

    for await (const chunk of answer.readableStreamBody!) {
      chunks.push(Buffer.from(chunk as Buffer));
    }

    expect(Buffer.concat(chunks).equals(attachment)).toBe(true);
    expect(proxy.requests[0]!.url).toBe(
      `http://${UNRESOLVED_HOST}/v3/attachments/attachment-1/views/original`,
    );
  });

  test("a compressed answer is read as the pipeline reads one: decompressed", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const acceptEncodings: Array<string> = [];

    proxy.handler = (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      acceptEncodings.push(String(request.headers["accept-encoding"] || ""));
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      });
      response.end(zlib.gzipSync(JSON.stringify({ id: "compressed-1" })));
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const sent: { id?: string | undefined } = await sendMessage(
      botConnector(`http://${UNRESOLVED_HOST}/teams/`),
    );

    expect(sent.id).toBe("compressed-1");
    expect(acceptEncodings[0]).toContain("gzip");
  });
});

describe("past the outbound proxy", () => {
  test.each([
    ["the host's name", "127.0.0.1"],
    ["an address range, as axios reads NO_PROXY", "10.0.0.0/8,127.0.0.0/8"],
    ["the host with its port", "127.0.0.1:{port}"],
  ])(
    "a Bot Connector NO_PROXY names by %s is sent to directly",
    async (_name: string, noProxy: string) => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const connector: {
        server: LocalHttpServer;
        seen: Array<ConnectorCallSeen>;
      } = await serveConnector("connector");

      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );
      process.env["NO_PROXY"] = noProxy.replace(
        "{port}",
        String(connector.server.port),
      );

      await sendMessage(botConnector(connector.server.url("/teams/")));

      expect(connector.seen).toHaveLength(1);
      expect(connector.server.requestCredentials).toEqual([""]);
      expect(proxy.isUntouched).toBe(true);
    },
  );

  test("with no proxy set at all, a message is sent directly, as it always was", async () => {
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");

    const sent: { id?: string | undefined } = await sendMessage(
      botConnector(connector.server.url("/teams/")),
    );

    expect(sent.id).toBe("message-1");
    expect(connector.seen[0]!.path).toBe(
      "/teams/v3/conversations/a%3Aconversation/activities",
    );
  });
});

describe("a request the outbound proxy refuses", () => {
  test("a refused tunnel fails once, in the proxy's words: what it answered and where the message was going, never the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      sendMessage(botConnector(`https://${BOT_CONNECTOR_HOST}/teams/`)),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toBe(
      `The outbound proxy did not open a connection to ${BOT_CONNECTOR_HOST}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );
    expect(ProxyTunnelRefusal.describe(refusal)).toBe(refusal.message);
    expect(refusal.message).not.toContain(PROXY_HOST_NAME);
    expect(refusal.message).not.toContain(String(proxy.port));

    // A refusal is not tried again: the proxy would refuse it again.
    expect(proxy.connects).toEqual([`${BOT_CONNECTOR_HOST}:443`]);
  });

  test("a 407 to the CONNECT is the proxy not taking OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      sendMessage(botConnector(`https://${BOT_CONNECTOR_HOST}/teams/`)),
    );

    expect(refusal.message).toBe(
      `The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${BOT_CONNECTOR_HOST}:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`,
    );
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a 407 to a forwarded request is said the same way", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="proxy"' });
      response.end();
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      sendMessage(botConnector(`http://${UNRESOLVED_HOST}/teams/`)),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toContain(
      `it did not take OneUptime's user name and password, so the request to ${UNRESOLVED_HOST}:80 was not sent.`,
    );
  });

  test("a proxy setting this server cannot use fails before anything is sent, naming no password", async () => {
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");

    process.env["HTTP_PROXY"] =
      `socks5://${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.user)}:${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password)}@${PROXY_HOST_NAME}:1080`;

    const refusal: Error = await failureOf(
      sendMessage(botConnector(connector.server.url("/teams/"))),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
    expect(connector.server.isUntouched).toBe(true);
  });
});

describe("the team's details, which botbuilder's TeamsInfo reads with a client it makes for itself", () => {
  const TEAM_ID: string = "19:team@thread.tacv2";

  // A turn of the bot's, its connector client the one the adapter made.
  function turnFrom(data: {
    serviceUrl: string;
    connector?: ConnectorClient | undefined;
    teamId?: string | undefined;
  }): TurnContext {
    const key: symbol = Symbol("ConnectorClient");

    return {
      activity: {
        serviceUrl: data.serviceUrl,
        channelData: data.teamId ? { team: { id: data.teamId } } : {},
      },
      adapter: { ConnectorClientKey: key },
      turnState: new Map<symbol, unknown>(
        data.connector ? [[key, data.connector]] : [],
      ),
    } as unknown as TurnContext;
  }

  test("are read through the proxy, on the bot's HttpClient", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const serviceUrl: string = `http://${UNRESOLVED_HOST}/teams/`;

    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: TEAM_ID,
          name: "Incident Response",
          aadGroupId: "a1b2c3d4-0000-4000-8000-000000000001",
        }),
      );
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const details: TeamDetails = await BotFrameworkRouting.getTeamDetails(
      turnFrom({
        serviceUrl: serviceUrl,
        connector: botConnector(serviceUrl),
        teamId: TEAM_ID,
      }),
    );

    expect(details.aadGroupId).toBe("a1b2c3d4-0000-4000-8000-000000000001");
    expect(proxy.requests[0]!.url).toBe(
      `http://${UNRESOLVED_HOST}/teams/v3/teams/${encodeURIComponent(TEAM_ID)}`,
    );
    expect(proxy.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a team named, rather than the turn's, is read the same way", async () => {
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");
    const serviceUrl: string = connector.server.url("/teams/");

    await BotFrameworkRouting.getTeamDetails(
      turnFrom({ serviceUrl: serviceUrl, connector: botConnector(serviceUrl) }),
      "19:another@thread.tacv2",
    );

    expect(connector.seen[0]!.path).toBe(
      `/teams/v3/teams/${encodeURIComponent("19:another@thread.tacv2")}`,
    );
  });

  test("outside a team, or with no connector client, it fails as TeamsInfo fails", async () => {
    await expect(
      BotFrameworkRouting.getTeamDetails(
        turnFrom({
          serviceUrl: "http://127.0.0.1/teams/",
          connector: botConnector("http://127.0.0.1/teams/"),
        }),
      ),
    ).rejects.toThrow(
      "This method is only valid within the scope of a MS Teams Team.",
    );
    await expect(
      BotFrameworkRouting.getTeamDetails(
        turnFrom({ serviceUrl: "http://127.0.0.1/teams/", teamId: TEAM_ID }),
      ),
    ).rejects.toThrow("This method requires a connector client.");
  });
});
