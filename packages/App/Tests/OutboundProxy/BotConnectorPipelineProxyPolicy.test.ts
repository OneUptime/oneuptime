import BotFrameworkRouting from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkRouting";
import {
  ConnectorClient,
  MicrosoftAppCredentials,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder";
import { OutboundProxyRefusal } from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import {
  BOT_CONNECTOR_HOST,
  ConnectorCallSeen,
  botConnectorHandler,
} from "Common/Tests/Server/TestingUtils/BotFrameworkFixture";
import {
  LocalHttpServer,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger");

/*
 * WHY THE BOT'S CONNECTOR CLIENTS ARE GIVEN AN HTTPCLIENT OF ONEUPTIME'S
 * (issue #10763).
 *
 * The SDK's ConnectorClient sends with @azure/core-rest-pipeline, whose
 * proxy policy reads HTTPS_PROXY, HTTP_PROXY, ALL_PROXY and NO_PROXY
 * itself (@typespec/ts-http-runtime 0.3.8 under core-rest-pipeline
 * 1.25.0). These hold what it does with them, beside what the bot's
 * clients (BotConnectorHttpClient) do in the same environment, with real
 * requests to a proxy and a Bot Connector on this machine:
 *
 *   - it signs in with the password decoded, as OneUptime does: #10442's
 *     bug was never this one's;
 *   - it reads no CIDR range in NO_PROXY, which OneUptime reads as axios
 *     does;
 *   - it reads NO_PROXY once, when the process makes its first client;
 *   - it sends an http request through HTTPS_PROXY, where OneUptime takes
 *     the proxy of the request's scheme;
 *   - a tunnel the proxy refuses comes back as if the Bot Connector had
 *     answered 403 itself.
 *
 * The policy keeps NO_PROXY in its module from the first client made, so
 * the first test here makes the first client, with NO_PROXY set, and every
 * test after it reads the policy that one set. They run in order.
 */

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

// What NO_PROXY says when the first client is made: an address range.
const NO_PROXY_AT_FIRST: string = "10.0.0.0/8,127.0.0.0/8";

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

// The SDK's own connector client, as the bot's were made before.
function sdksConnector(serviceUrl: string): ConnectorClient {
  return new ConnectorClient(MicrosoftAppCredentials.Empty, {
    baseUri: serviceUrl,
  });
}

// One of the bot's, on BotConnectorHttpClient.
function botsConnector(serviceUrl: string): ConnectorClient {
  return new ConnectorClient(MicrosoftAppCredentials.Empty, {
    baseUri: serviceUrl,
    ...BotFrameworkRouting.getConnectorClientOptions(),
  });
}

function sendMessage(client: ConnectorClient): Promise<unknown> {
  return client.conversations.sendToConversation("a:conversation", {
    type: "message",
    text: "pong",
  });
}

async function serveConnector(
  name: string,
): Promise<{ server: LocalHttpServer; seen: Array<ConnectorCallSeen> }> {
  const server: LocalHttpServer = await serve({ name: name });
  const seen: Array<ConnectorCallSeen> = [];

  server.handler = botConnectorHandler({ seen: seen });

  return { server, seen };
}

describe("@azure/core-rest-pipeline's own proxy policy, beside the bot's HttpClient", () => {
  test("decodes the password, but reads no address range in NO_PROXY: the SDK's client goes through the proxy where the bot's goes directly", async () => {
    const proxy: { server: LocalHttpServer; seen: Array<ConnectorCallSeen> } =
      await serveConnector("proxy");
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");

    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.server.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = NO_PROXY_AT_FIRST;

    await sendMessage(sdksConnector(connector.server.url("/teams/")));

    expect(proxy.seen).toHaveLength(1);
    expect(proxy.server.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(connector.seen).toHaveLength(0);

    await sendMessage(botsConnector(connector.server.url("/teams/")));

    expect(connector.seen).toHaveLength(1);
    expect(proxy.seen).toHaveLength(1);
  });

  test("reads NO_PROXY once: naming the host itself later changes nothing for the SDK's client", async () => {
    const proxy: { server: LocalHttpServer; seen: Array<ConnectorCallSeen> } =
      await serveConnector("proxy");
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");

    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.server.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    // A name it would read, had it read NO_PROXY again.
    process.env["NO_PROXY"] = "127.0.0.1";

    await sendMessage(sdksConnector(connector.server.url("/teams/")));

    expect(proxy.seen).toHaveLength(1);
    expect(connector.seen).toHaveLength(0);

    await sendMessage(botsConnector(connector.server.url("/teams/")));

    expect(connector.seen).toHaveLength(1);
  });

  test("sends an http request through HTTPS_PROXY: the bot's takes the proxy of its scheme, and here there is none", async () => {
    const proxy: { server: LocalHttpServer; seen: Array<ConnectorCallSeen> } =
      await serveConnector("proxy");
    const connector: {
      server: LocalHttpServer;
      seen: Array<ConnectorCallSeen>;
    } = await serveConnector("connector");

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.server.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    await sendMessage(sdksConnector(connector.server.url("/teams/")));

    expect(proxy.seen).toHaveLength(1);
    expect(connector.seen).toHaveLength(0);

    await sendMessage(botsConnector(connector.server.url("/teams/")));

    expect(connector.seen).toHaveLength(1);
    expect(proxy.seen).toHaveLength(1);
  });

  test("a refused tunnel reads as the Bot Connector's own 403 to the SDK's client, and as the proxy's refusal to the bot's", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    let theSdks: unknown = undefined;

    try {
      await sendMessage(sdksConnector(`https://${BOT_CONNECTOR_HOST}/teams/`));
    } catch (error) {
      theSdks = error;
    }

    expect((theSdks as { statusCode?: unknown }).statusCode).toBe(403);
    expect(String((theSdks as Error).message)).not.toContain("proxy");

    let theBots: unknown = undefined;

    try {
      await sendMessage(botsConnector(`https://${BOT_CONNECTOR_HOST}/teams/`));
    } catch (error) {
      theBots = error;
    }

    expect(theBots).toBeInstanceOf(OutboundProxyRefusal);
    expect((theBots as Error).message).toContain(
      `The outbound proxy did not open a connection to ${BOT_CONNECTOR_HOST}:443: it answered 403 Forbidden.`,
    );
  });
});
