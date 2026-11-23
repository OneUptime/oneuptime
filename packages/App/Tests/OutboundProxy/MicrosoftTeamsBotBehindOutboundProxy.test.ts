import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import BotConnectorHttpClient from "Common/Server/Utils/Workspace/MicrosoftTeams/BotConnectorHttpClient";
import BotFrameworkOpenIdMetadata from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkOpenIdMetadata";
import BotFrameworkCredentialsFactory from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkTokenRequests";
import {
  AppCredentials,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder";
import OutboundFetch from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import {
  ACCESS_TOKEN,
  BOT_CONNECTOR_HOST,
  BOT_FRAMEWORK_LOGIN_HOST,
  ConnectorCallSeen,
  ENTRA_HOST,
  KEY_SET_PATH,
  OPEN_ID_CONFIGURATION_PATH,
  SigningKey,
  TokenRequestSeen,
  botConnectorHandler,
  botFrameworkKeysHandler,
  createSigningKey,
  entraTokenHandler,
  signChannelToken,
} from "Common/Tests/Server/TestingUtils/BotFrameworkFixture";
import {
  LocalHttpServer,
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
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger");

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
    MicrosoftTeamsAppTenantId: "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11",
  };
});

/*
 * THE TEAMS BOT, BEHIND AN OUTBOUND PROXY (issue #10763).
 *
 * Where the internet is reachable only through a proxy, the bot failed
 * every message from Teams: the Bot Framework SDK fetched the keys it
 * checks each message's token with directly (node-fetch), asked Microsoft
 * Entra ID for its own tokens directly (msal-node), and sent its replies
 * on a proxy policy of its own (@azure/core-rest-pipeline). Each now takes
 * the route every other request of the server takes (BotFrameworkRouting).
 *
 * Here the bot's own adapter (MicrosoftTeamsUtil.getBotAdapter) takes a
 * message signed as the Bot Framework signs one, from start to end, with
 * nothing leaving this machine: the Bot Framework's sign-in
 * (login.botframework.com), Entra ID (login.microsoftonline.com) and the
 * Bot Connector (smba.trafficmanager.net) are servers here, with
 * certificates for those names from CAs this process trusts for the test,
 * reached through a proxy that tunnels to them and takes only its own user
 * name and password, one holding "@", ":" and "%"
 * (SelfSignedHttpsFixture's TunnellingProxy). Nothing looks those names
 * up: a request that went around the proxy would ask DNS for them, and is
 * refused (watchLookups). The suites of each stack, beside this one, hold
 * NO_PROXY, going directly and the proxy's refusals to each in detail.
 */

const APP_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const APP_TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const SERVICE_URL: string = `https://${BOT_CONNECTOR_HOST}/teams/`;
const MICROSOFT_HOSTS: Array<string> = [
  BOT_FRAMEWORK_LOGIN_HOST,
  ENTRA_HOST,
  BOT_CONNECTOR_HOST,
];

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const selfSignedHttps: ReturnType<typeof useSelfSignedHttps> =
  useSelfSignedHttps();
const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

const certificates: Map<string, TestCertificates> = new Map<
  string,
  TestCertificates
>();

beforeAll(() => {
  for (const host of MICROSOFT_HOSTS) {
    certificates.set(host, generateTestCertificates(host));
  }
});

afterAll(() => {
  for (const certificate of certificates.values()) {
    removeTestCertificates(certificate);
  }
});

afterEach(async () => {
  BotFrameworkOpenIdMetadata.getSdkCache().clear();
  (
    AppCredentials as unknown as { cache: Map<string, unknown> }
  ).cache.clear();
  (MicrosoftTeamsUtil as unknown as { cachedAdapter: unknown }).cachedAdapter =
    null;
  await OutboundFetch.destroySharedDispatchers();
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

interface StandInMicrosoft {
  key: SigningKey;
  proxy: TunnellingProxy;
  keysSeen: Array<string>;
  tokenRequests: Array<TokenRequestSeen>;
  connectorCalls: Array<ConnectorCallSeen>;
}

function certificateFor(host: string): TestCertificates {
  return certificates.get(host)!;
}

async function serveHttps(host: string): Promise<LocalHttpsServer> {
  return await selfSignedHttps.serve({
    name: host,
    certificate: certificateFor(host).caSigned,
  });
}

/*
 * The three Microsoft services, each with a certificate for its own name
 * that this process trusts, behind a proxy that takes the user name and
 * password holding reserved characters, and no other.
 */
async function startMicrosoft(): Promise<StandInMicrosoft> {
  for (const host of MICROSOFT_HOSTS) {
    trustAsDefaultCa(certificateFor(host).caCertificate);
  }

  const key: SigningKey = createSigningKey("oneuptime-test-key");
  const keysSeen: Array<string> = [];
  const tokenRequests: Array<TokenRequestSeen> = [];
  const connectorCalls: Array<ConnectorCallSeen> = [];

  const botFrameworkLogin: LocalHttpsServer = await serveHttps(
    BOT_FRAMEWORK_LOGIN_HOST,
  );
  botFrameworkLogin.handler = botFrameworkKeysHandler({
    keySetUrl: `https://${BOT_FRAMEWORK_LOGIN_HOST}${KEY_SET_PATH}`,
    keys: [key],
    seen: keysSeen,
  });

  const entra: LocalHttpsServer = await serveHttps(ENTRA_HOST);
  entra.handler = entraTokenHandler({ seen: tokenRequests });

  const connector: LocalHttpsServer = await serveHttps(BOT_CONNECTOR_HOST);
  connector.handler = botConnectorHandler({ seen: connectorCalls });

  const ends: Record<string, LocalHttpsServer> = {
    [`${BOT_FRAMEWORK_LOGIN_HOST}:443`]: botFrameworkLogin,
    [`${ENTRA_HOST}:443`]: entra,
    [`${BOT_CONNECTOR_HOST}:443`]: connector,
  };

  const proxy: TunnellingProxy = await selfSignedHttps.proxy({
    route: (authority: string): TunnelEnd | null => {
      const end: LocalHttpsServer | undefined = ends[authority];

      return end ? { host: end.host, port: end.port } : null;
    },
    credentials: signedInAs(RESERVED_CHARACTER_CREDENTIALS),
  });

  return { key, proxy, keysSeen, tokenRequests, connectorCalls };
}

function useProxy(port: number): void {
  process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
    port,
    RESERVED_CHARACTER_CREDENTIALS,
  );
}

// A message from a person in Teams, to the bot, as Teams posts it.
function teamsMessage(): Record<string, unknown> {
  return {
    type: "message",
    id: "activity-1",
    channelId: "msteams",
    serviceUrl: SERVICE_URL,
    from: {
      id: "29:person",
      aadObjectId: "a0a0a0a0-0000-4000-8000-000000000001",
    },
    recipient: { id: `28:${APP_ID}` },
    conversation: { id: "a:conversation", tenantId: APP_TENANT_ID },
    channelData: { tenant: { id: APP_TENANT_ID } },
    text: "help",
  };
}

// What Teams gets back for what it posted.
class RecordingResponse {
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(body: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public json(body: unknown): this {
    return this.send(body);
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

function request(
  activity: Record<string, unknown>,
  token: string | null,
): ExpressRequest {
  return {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.parse(JSON.stringify(activity)),
  } as unknown as ExpressRequest;
}

function botAdapter(): CloudAdapter {
  return (
    MicrosoftTeamsUtil as unknown as { getBotAdapter: () => CloudAdapter }
  ).getBotAdapter();
}

// What the bot's adapter is made of, as the SDK keeps it.
interface AuthenticationInside {
  credentialsFactory: unknown;
  connectorClientOptions: { httpClient?: unknown } | undefined;
  toBotFromChannelOpenIdMetadataUrl: string;
  toBotFromEmulatorOpenIdMetadataUrl: string;
}

function insideOf(adapter: CloudAdapter): AuthenticationInside {
  return (
    adapter as unknown as {
      botFrameworkAuthentication: { inner: AuthenticationInside };
    }
  ).botFrameworkAuthentication.inner;
}

// Every console.error line, as text: CloudAdapter logs what failed a turn.
function captureConsoleErrors(): Array<string> {
  const lines: Array<string> = [];

  jest.spyOn(console, "error").mockImplementation((...args: Array<unknown>) => {
    lines.push(
      args
        .map((arg: unknown): string => {
          return arg instanceof Error
            ? `${arg.message} ${arg.stack || ""}`
            : String(arg);
        })
        .join(" "),
    );
  });

  return lines;
}

describe("the bot's own adapter is made of the routed stacks", () => {
  test("its tokens come from OneUptime's factory, its connector clients send on OneUptime's HttpClient, and every document its token check reads is fetched by OneUptime", () => {
    const inside: AuthenticationInside = insideOf(botAdapter());

    expect(inside.credentialsFactory).toBeInstanceOf(
      BotFrameworkCredentialsFactory,
    );
    expect(inside.connectorClientOptions?.httpClient).toBeInstanceOf(
      BotConnectorHttpClient,
    );

    for (const url of [
      inside.toBotFromChannelOpenIdMetadataUrl,
      inside.toBotFromEmulatorOpenIdMetadataUrl,
    ]) {
      expect({
        url,
        routed:
          BotFrameworkOpenIdMetadata.getSdkCache().get(url) instanceof
          BotFrameworkOpenIdMetadata,
      }).toEqual({ url, routed: true });
    }
  });
});

describe("a message from Teams, through the proxy", () => {
  test("its token is checked against the Bot Framework's keys fetched through the proxy, and the reply, with its token, goes through it too", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);
    const response: RecordingResponse = new RecordingResponse();
    const handled: Array<string> = [];

    useProxy(microsoft.proxy.port);

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: microsoft.key,
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (context: TurnContext): Promise<void> => {
        handled.push(String(context.activity.text));
        await context.sendActivity("pong");
      },
    );

    expect(response.statusCode).toBe(200);
    expect(handled).toEqual(["help"]);

    // The OpenID configuration, then the key set it names.
    expect(microsoft.keysSeen).toEqual([
      OPEN_ID_CONFIGURATION_PATH,
      KEY_SET_PATH,
    ]);

    // The bot's token, for the Bot Framework, from its own tenant.
    expect(microsoft.tokenRequests).toHaveLength(1);
    expect(microsoft.tokenRequests[0]!.path).toBe(
      `/${APP_TENANT_ID}/oauth2/v2.0/token`,
    );
    expect(microsoft.tokenRequests[0]!.form).toMatchObject({
      grant_type: "client_credentials",
      client_id: APP_ID,
      client_secret: "teams-client-secret",
      scope: "https://api.botframework.com/.default",
    });

    // The reply, sent with that token.
    expect(microsoft.connectorCalls).toEqual([
      {
        method: "POST",
        path: "/teams/v3/conversations/a%3Aconversation/activities/activity-1",
        authorization: `Bearer ${ACCESS_TOKEN}`,
        activity: expect.objectContaining({ text: "pong" }),
      },
    ]);

    // Each through the proxy, signed in with the real user name and password.
    expect(new Set(microsoft.proxy.connects)).toEqual(
      new Set(
        MICROSOFT_HOSTS.map((host: string): string => {
          return `${host}:443`;
        }),
      ),
    );
    expect(new Set(microsoft.proxy.connectCredentials)).toEqual(
      new Set([signedInAs(RESERVED_CHARACTER_CREDENTIALS)]),
    );

    // None of them went around it: nothing looked their names up here.
    expect(
      lookups.filter((host: string): boolean => {
        return MICROSOFT_HOSTS.includes(host);
      }),
    ).toEqual([]);
  });

  test("through the bot's own entry for Teams' posts (processBotActivity): a signed message is taken, its keys fetched through the proxy", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);
    const response: RecordingResponse = new RecordingResponse();

    useProxy(microsoft.proxy.port);

    // Teams says the person is typing: the bot answers nothing.
    await MicrosoftTeamsUtil.processBotActivity(
      request(
        { ...teamsMessage(), type: "typing", text: undefined },
        signChannelToken({
          key: microsoft.key,
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
    );

    expect(response.statusCode).toBe(200);
    expect(microsoft.keysSeen).toEqual([
      OPEN_ID_CONFIGURATION_PATH,
      KEY_SET_PATH,
    ]);
    expect(microsoft.proxy.connects).toContain(
      `${BOT_FRAMEWORK_LOGIN_HOST}:443`,
    );
    expect(
      lookups.filter((host: string): boolean => {
        return MICROSOFT_HOSTS.includes(host);
      }),
    ).toEqual([]);
  });

  test("a message signed with a key the Bot Framework does not publish is still refused: the check is the SDK's own", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const response: RecordingResponse = new RecordingResponse();
    let handled: boolean = false;

    captureConsoleErrors();
    useProxy(microsoft.proxy.port);

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: createSigningKey("oneuptime-test-key"),
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        handled = true;
      },
    );

    expect(handled).toBe(false);
    expect(response.statusCode).not.toBe(200);
    expect(microsoft.keysSeen).toEqual([
      OPEN_ID_CONFIGURATION_PATH,
      KEY_SET_PATH,
    ]);
    expect(microsoft.connectorCalls).toEqual([]);
  });

  test("a proactive message gets its token and is sent through the proxy", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);

    useProxy(microsoft.proxy.port);

    await botAdapter().continueConversationAsync(
      APP_ID,
      {
        channelId: "msteams",
        serviceUrl: SERVICE_URL,
        conversation: {
          id: "a:conversation",
          isGroup: false,
          conversationType: "personal",
          name: "",
        },
        bot: { id: `28:${APP_ID}`, name: "OneUptime" },
      },
      async (context: TurnContext): Promise<void> => {
        await context.sendActivity("An incident was declared.");
      },
    );

    expect(microsoft.tokenRequests).toHaveLength(1);
    expect(microsoft.connectorCalls).toEqual([
      {
        method: "POST",
        // The SDK sends it as a reply to the turn it starts for the purpose.
        path: expect.stringMatching(
          /^\/teams\/v3\/conversations\/a%3Aconversation\/activities\/[0-9a-f-]+$/,
        ),
        authorization: `Bearer ${ACCESS_TOKEN}`,
        activity: expect.objectContaining({
          text: "An incident was declared.",
        }),
      },
    ]);
    expect(new Set(microsoft.proxy.connects)).toEqual(
      new Set([`${ENTRA_HOST}:443`, `${BOT_CONNECTOR_HOST}:443`]),
    );
    expect(
      lookups.filter((host: string): boolean => {
        return MICROSOFT_HOSTS.includes(host);
      }),
    ).toEqual([]);
  });
});

describe("a message from Teams, when the proxy is not the way", () => {
  test("a host in NO_PROXY is fetched directly: the proxy is never asked for the keys", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);
    const response: RecordingResponse = new RecordingResponse();

    captureConsoleErrors();
    useProxy(microsoft.proxy.port);
    process.env["NO_PROXY"] = BOT_FRAMEWORK_LOGIN_HOST;

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: microsoft.key,
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        return undefined;
      },
    );

    // Directly: its name was looked up here (and is no real host here).
    expect(lookups).toContain(BOT_FRAMEWORK_LOGIN_HOST);
    expect(microsoft.proxy.connects).toEqual([]);
    expect(response.statusCode).toBe(500);
  });

  test("with no proxy set at all, the keys are fetched directly, as they always were", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);
    const response: RecordingResponse = new RecordingResponse();

    captureConsoleErrors();

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: microsoft.key,
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        return undefined;
      },
    );

    expect(lookups).toContain(BOT_FRAMEWORK_LOGIN_HOST);
    expect(microsoft.proxy.connects).toEqual([]);
    expect(response.statusCode).toBe(500);
  });
});

describe("a message from Teams, when the proxy refuses", () => {
  async function refusingProxy(statusLine: string): Promise<LocalHttpServer> {
    const proxy: LocalHttpServer = await serve({
      host: "127.0.0.1",
      name: "proxy",
    });

    proxy.connectStatusLine = statusLine;

    return proxy;
  }

  test("a refused tunnel fails the check in the proxy's words: what it answered and where the request was going, never the proxy", async () => {
    const proxy: LocalHttpServer = await refusingProxy(
      "HTTP/1.1 403 Forbidden",
    );
    const errors: Array<string> = captureConsoleErrors();
    const response: RecordingResponse = new RecordingResponse();
    let handled: boolean = false;

    useProxy(proxy.port);

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: createSigningKey("oneuptime-test-key"),
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        handled = true;
      },
    );

    expect(handled).toBe(false);
    expect(proxy.connects).toEqual([`${BOT_FRAMEWORK_LOGIN_HOST}:443`]);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(
      `The outbound proxy did not open a connection to ${BOT_FRAMEWORK_LOGIN_HOST}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );

    // Neither what Teams is answered nor what the server logs names the proxy.
    for (const said of [String(response.body), ...errors]) {
      expect(said).not.toContain(`${PROXY_HOST_NAME}:${proxy.port}`);
      expect(said).not.toContain(`127.0.0.1:${proxy.port}`);
      expect(said).not.toContain(RESERVED_CHARACTER_CREDENTIALS.password);
      expect(said).not.toContain(
        encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password),
      );
    }
  });

  test("a 407 says the proxy did not take OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await refusingProxy(
      "HTTP/1.1 407 Proxy Authentication Required",
    );
    const response: RecordingResponse = new RecordingResponse();

    captureConsoleErrors();
    useProxy(proxy.port);

    await botAdapter().process(
      request(
        teamsMessage(),
        signChannelToken({
          key: createSigningKey("oneuptime-test-key"),
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        return undefined;
      },
    );

    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(response.body).toBe(
      `The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${BOT_FRAMEWORK_LOGIN_HOST}:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`,
    );
  });
});

/*
 * What the bot did before: the SDK's own stacks, made as getBotAdapter made
 * its adapter until this change. The same message, through the same proxy,
 * never reaches it.
 */
describe("the SDK's own stacks, as the bot used them before", () => {
  test("fetch the keys around the proxy, so the message fails its token check", async () => {
    const microsoft: StandInMicrosoft = await startMicrosoft();
    const lookups: Array<string> = watchLookups(MICROSOFT_HOSTS);
    const response: RecordingResponse = new RecordingResponse();
    let handled: boolean = false;

    captureConsoleErrors();
    useProxy(microsoft.proxy.port);

    // No routed metadata in the SDK's cache: it makes its own.
    BotFrameworkOpenIdMetadata.getSdkCache().clear();

    await new CloudAdapter(
      new ConfigurationBotFrameworkAuthentication(
        MicrosoftTeamsUtil.getBotAuthenticationOptions(),
      ),
    ).process(
      request(
        teamsMessage(),
        signChannelToken({
          key: microsoft.key,
          audience: APP_ID,
          serviceUrl: SERVICE_URL,
        }),
      ),
      response as unknown as ExpressResponse,
      async (): Promise<void> => {
        handled = true;
      },
    );

    expect(handled).toBe(false);
    expect(response.statusCode).toBe(500);
    expect(microsoft.proxy.connects).toEqual([]);
    expect(lookups).toContain(BOT_FRAMEWORK_LOGIN_HOST);
  });
});
