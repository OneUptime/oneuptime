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
  watchLookups,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

/*
 * Microsoft's names are never looked up here: a request that went around
 * the proxy would ask DNS for them, and is refused at once, so no test
 * reaches the real service, even with the routing broken.
 */
beforeEach(() => {
  watchLookups([BOT_CONNECTOR_HOST]);
});

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

/*
 * The policy parses the proxy setting whenever the SDK makes a client, so a
 * value that is no URL fails there, before the bot's HttpClient is asked,
 * with Node's own error, whose input is the whole value, password included
 * (CloudAdapter writes it to the log). BotFrameworkRouting refuses a value
 * like that itself, first, in words that name no password.
 */
describe("a proxy setting the pipeline cannot read", () => {
  const UNREADABLE: string = `http://${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.user)}:${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password)}@[proxy.internal:3128`;

  test("fails the SDK's own client as it is made, with the whole value, password and all", () => {
    process.env["HTTPS_PROXY"] = UNREADABLE;

    let thrown: unknown = undefined;

    try {
      sdksConnector(`https://${BOT_CONNECTOR_HOST}/teams/`);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { code?: unknown }).code).toBe("ERR_INVALID_URL");
    expect((thrown as { input?: unknown }).input).toBe(UNREADABLE);
  });

  test("is refused by the bot's authentication before the SDK reads it, naming no password", () => {
    process.env["HTTPS_PROXY"] = UNREADABLE;

    let thrown: unknown = undefined;

    try {
      BotFrameworkRouting.createAuthentication({});
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not a URL.",
    );

    // Nothing it carries holds the value: not its message, not a field.
    const carried: string = [
      (thrown as Error).message,
      ...Object.values(thrown as Record<string, unknown>).map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ].join(" ");

    expect(carried).not.toContain(
      encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password),
    );
    expect(carried).not.toContain("proxy.internal");
  });

  test.each([
    ["ALL_PROXY, when HTTPS_PROXY is not set", "ALL_PROXY"],
    ["HTTP_PROXY, when neither is", "HTTP_PROXY"],
    ["https_proxy, in lower case", "https_proxy"],
  ])(
    "reads the setting the pipeline reads: %s",
    (_name: string, variable: string) => {
      process.env[variable] = UNREADABLE;

      expect(() => {
        BotFrameworkRouting.createAuthentication({});
      }).toThrow("is not a URL.");
    },
  );

  test("leaves alone a setting the pipeline never reads: HTTP_PROXY behind a readable HTTPS_PROXY", () => {
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      3128,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["HTTP_PROXY"] = UNREADABLE;

    expect(() => {
      BotFrameworkRouting.createAuthentication({});
    }).not.toThrow();
    expect(() => {
      sdksConnector(`https://${BOT_CONNECTOR_HOST}/teams/`);
    }).not.toThrow();
  });
});
