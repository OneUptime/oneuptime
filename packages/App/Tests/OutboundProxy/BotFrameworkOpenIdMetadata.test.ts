import BotFrameworkOpenIdMetadata, {
  BotFrameworkSigningKey,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkOpenIdMetadata";
import {
  AuthenticationConstants,
  AuthenticationError,
  GovernmentConstants,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder";
import OutboundFetch, {
  OutboundProxyRefusal,
} from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import BadDataException from "Common/Types/Exception/BadDataException";
import ProxyTunnelRefusal from "Common/Utils/ProxyTunnelRefusal";
import {
  KEY_SET_PATH,
  OPEN_ID_CONFIGURATION_PATH,
  SigningKey,
  botFrameworkKeysHandler,
  createSigningKey,
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
import { OpenIdMetadata } from "Common/node_modules/botframework-connector/lib/auth/openIdMetadata";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import http from "http";

jest.mock("Common/Server/Utils/Logger");

/*
 * THE KEYS THE TEAMS BOT CHECKS INCOMING MESSAGES WITH, FETCHED ON THE
 * OUTBOUND PROXY'S ROUTE (issue #10763).
 *
 * The Bot Framework SDK fetched its OpenID metadata and key set with
 * node-fetch, around any proxy the environment names.
 * BotFrameworkOpenIdMetadata fetches them with OutboundFetch, and the SDK's
 * token check reads them from it (routeEveryDocument puts it in the SDK's
 * cache): here, with real requests to a proxy and servers on this machine
 * (OutboundProxyFixture), through the proxy with a user name and password
 * holding "@", ":" and "%", past it for NO_PROXY, with no proxy at all, and
 * refused by it; and answering as the SDK's own OpenIdMetadata answers,
 * held to it on the same documents.
 *
 * A document's host is a name nothing resolves (login.botframework.test):
 * only a proxy that is asked can answer for it, as the forward proxy here
 * does. The suite of the whole bot (MicrosoftTeamsBotBehindOutboundProxy)
 * fetches the real documents' URLs over https through a tunnel.
 */

clearOutboundProxyEnvironmentForEachTest();

/*
 * Microsoft's names are never looked up here: a request that went around
 * the proxy would ask DNS for them, and is refused at once, so no test
 * reaches the real service, even with the routing broken.
 */
beforeEach(() => {
  watchLookups(MICROSOFT_HOSTS);
});

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

const UNRESOLVED_HOST: string = "login.botframework.test";

// The hosts of the documents the SDK reads its keys from, in either cloud.
const MICROSOFT_HOSTS: Array<string> = [
  "login.botframework.com",
  "login.microsoftonline.com",
  "login.botframework.azure.us",
  "login.microsoftonline.us",
];

afterEach(async () => {
  BotFrameworkOpenIdMetadata.getSdkCache().clear();
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

/*
 * A server that answers as the Bot Framework does, its key set holding
 * `keys`: as the target, or as a forward proxy for a name nothing resolves.
 */
async function serveBotFramework(data: {
  name: string;
  keys: Array<SigningKey>;
  keySetUrl: (server: LocalHttpServer) => string;
  endorsements?: Array<string> | undefined;
}): Promise<{ server: LocalHttpServer; seen: Array<string> }> {
  const server: LocalHttpServer = await serve({ name: data.name });
  const seen: Array<string> = [];

  server.handler = botFrameworkKeysHandler({
    keySetUrl: data.keySetUrl(server),
    keys: data.keys,
    seen: seen,
    endorsements: data.endorsements,
  });

  return { server, seen };
}

// Whether `pem` is the public half of `key`: it verifies what `key` signed.
function verifies(pem: string, key: SigningKey): boolean {
  const data: Buffer = Buffer.from("signed by the Bot Framework");
  const signature: Buffer = crypto.sign("RSA-SHA256", data, key.privateKey);

  return crypto.verify("RSA-SHA256", data, pem, signature);
}

describe("through the outbound proxy", () => {
  test.each([
    [
      "a user name and password holding @, : and %",
      RESERVED_CHARACTER_CREDENTIALS,
    ],
    ["plain ones", PLAIN_CREDENTIALS],
  ])(
    "both documents are asked of the proxy, signed in with %s as written, decoded",
    async (_name: string, credentials: typeof PLAIN_CREDENTIALS) => {
      const key: SigningKey = createSigningKey("key-1");
      const proxy: { server: LocalHttpServer; seen: Array<string> } =
        await serveBotFramework({
          name: "proxy",
          keys: [key],
          keySetUrl: (): string => {
            return `http://${UNRESOLVED_HOST}${KEY_SET_PATH}`;
          },
        });

      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.server.port,
        credentials,
      );

      const found: BotFrameworkSigningKey | null =
        await new BotFrameworkOpenIdMetadata(
          `http://${UNRESOLVED_HOST}${OPEN_ID_CONFIGURATION_PATH}`,
        ).getKey("key-1");

      expect(found).not.toBeNull();
      expect(verifies(found!.key, key)).toBe(true);
      expect(found!.endorsements).toEqual(["msteams"]);
      expect(
        proxy.server.requests.map((request: { url: string }): string => {
          return request.url;
        }),
      ).toEqual([
        `http://${UNRESOLVED_HOST}${OPEN_ID_CONFIGURATION_PATH}`,
        `http://${UNRESOLVED_HOST}${KEY_SET_PATH}`,
      ]);
      expect(proxy.server.requestCredentials).toEqual([
        signedInAs(credentials),
        signedInAs(credentials),
      ]);
    },
  );

  test("an https document is tunnelled, the CONNECT signed in with the real user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    // The proxy refuses every tunnel; what matters is what it was asked.
    await failureOf(
      new BotFrameworkOpenIdMetadata(
        AuthenticationConstants.ToBotFromChannelOpenIdMetadataUrl,
      ).getKey("key-1"),
    );

    expect(proxy.connects).toEqual(["login.botframework.com:443"]);
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(proxy.requests).toEqual([]);
  });
});

describe("past the outbound proxy", () => {
  test.each([
    ["the host's name", "127.0.0.1"],
    ["an address range, as axios reads NO_PROXY", "10.0.0.0/8,127.0.0.0/8"],
    ["the host with its port", "127.0.0.1:{port}"],
  ])(
    "a document whose host NO_PROXY names by %s is fetched directly",
    async (_name: string, noProxy: string) => {
      const key: SigningKey = createSigningKey("key-1");
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      const target: { server: LocalHttpServer; seen: Array<string> } =
        await serveBotFramework({
          name: "botframework",
          keys: [key],
          keySetUrl: (server: LocalHttpServer): string => {
            return server.url(KEY_SET_PATH);
          },
        });

      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );
      process.env["NO_PROXY"] = noProxy.replace(
        "{port}",
        String(target.server.port),
      );

      const found: BotFrameworkSigningKey | null =
        await new BotFrameworkOpenIdMetadata(
          target.server.url(OPEN_ID_CONFIGURATION_PATH),
        ).getKey("key-1");

      expect(verifies(found!.key, key)).toBe(true);
      expect(target.seen).toEqual([OPEN_ID_CONFIGURATION_PATH, KEY_SET_PATH]);
      expect(proxy.isUntouched).toBe(true);
    },
  );

  test("with no proxy set at all, both documents are fetched directly, as they always were", async () => {
    const key: SigningKey = createSigningKey("key-1");
    const target: { server: LocalHttpServer; seen: Array<string> } =
      await serveBotFramework({
        name: "botframework",
        keys: [key],
        keySetUrl: (server: LocalHttpServer): string => {
          return server.url(KEY_SET_PATH);
        },
      });

    const found: BotFrameworkSigningKey | null =
      await new BotFrameworkOpenIdMetadata(
        target.server.url(OPEN_ID_CONFIGURATION_PATH),
      ).getKey("key-1");

    expect(verifies(found!.key, key)).toBe(true);
    expect(target.seen).toEqual([OPEN_ID_CONFIGURATION_PATH, KEY_SET_PATH]);
    expect(target.server.requestCredentials).toEqual(["", ""]);
  });
});

describe("a fetch the outbound proxy refuses", () => {
  test("a refused tunnel fails in the proxy's words: what it answered and where the request was going, never the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      new BotFrameworkOpenIdMetadata(
        AuthenticationConstants.ToBotFromChannelOpenIdMetadataUrl,
      ).getKey("key-1"),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toBe(
      "The outbound proxy did not open a connection to login.botframework.com:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(ProxyTunnelRefusal.describe(refusal)).toBe(refusal.message);
    expect(refusal.message).not.toContain(PROXY_HOST_NAME);
    expect(refusal.message).not.toContain(String(proxy.port));
  });

  test("a 407 to the CONNECT is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      new BotFrameworkOpenIdMetadata(
        GovernmentConstants.ToBotFromChannelOpenIdMetadataUrl,
      ).getKey("key-1"),
    );

    expect(refusal.message).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to login.botframework.azure.us:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
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
      new BotFrameworkOpenIdMetadata(
        `http://${UNRESOLVED_HOST}${OPEN_ID_CONFIGURATION_PATH}`,
      ).getKey("key-1"),
    );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal.message).toContain(
      `it did not take OneUptime's user name and password, so the request to ${UNRESOLVED_HOST}:80 was not sent.`,
    );
  });

  test("a proxy setting this server cannot use fails before anything is sent, naming no password", async () => {
    process.env["HTTPS_PROXY"] =
      `socks5://${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.user)}:${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password)}@${PROXY_HOST_NAME}:1080`;

    const refusal: Error = await failureOf(
      new BotFrameworkOpenIdMetadata(
        AuthenticationConstants.ToBotFromChannelOpenIdMetadataUrl,
      ).getKey("key-1"),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
  });
});

describe("answers as the SDK's own OpenIdMetadata answers", () => {
  // The Bot Framework, served directly, counting what it is asked.
  async function directBotFramework(
    keys: Array<SigningKey>,
    endorsements?: Array<string> | undefined,
  ): Promise<{ server: LocalHttpServer; seen: Array<string>; url: string }> {
    const target: { server: LocalHttpServer; seen: Array<string> } =
      await serveBotFramework({
        name: "botframework",
        keys: keys,
        keySetUrl: (server: LocalHttpServer): string => {
          return server.url(KEY_SET_PATH);
        },
        endorsements: endorsements,
      });

    return {
      ...target,
      url: target.server.url(OPEN_ID_CONFIGURATION_PATH),
    };
  }

  test("the same documents give the same key, endorsed the same, as the SDK's own", async () => {
    const key: SigningKey = createSigningKey("key-1");
    const target: { url: string } = await directBotFramework(
      [key],
      ["msteams", "webchat"],
    );

    const ours: BotFrameworkSigningKey | null =
      await new BotFrameworkOpenIdMetadata(target.url).getKey("key-1");
    const theSdks: { key: string; endorsements?: Array<string> } | null =
      await new OpenIdMetadata(target.url).getKey("key-1");

    expect(theSdks).not.toBeNull();
    expect(verifies(theSdks!.key, key)).toBe(true);
    expect(verifies(ours!.key, key)).toBe(true);
    expect(crypto.createPublicKey(ours!.key).export({ format: "jwk" })).toEqual(
      crypto.createPublicKey(theSdks!.key).export({ format: "jwk" }),
    );
    expect(ours!.endorsements).toEqual(theSdks!.endorsements);
  });

  test("a key id the set does not hold is none, for both", async () => {
    const target: { url: string } = await directBotFramework([
      createSigningKey("key-1"),
    ]);

    expect(
      await new BotFrameworkOpenIdMetadata(target.url).getKey("another"),
    ).toBeNull();
    expect(await new OpenIdMetadata(target.url).getKey("another")).toBeNull();
  });

  test("a key with no RSA modulus and exponent is none", async () => {
    const server: LocalHttpServer = await serve({ name: "botframework" });

    server.handler = (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          String(request.url).endsWith(KEY_SET_PATH)
            ? {
                keys: [
                  { kid: "key-1", kty: "EC", crv: "P-256", x: "x", y: "y" },
                ],
              }
            : { jwks_uri: server.url(KEY_SET_PATH) },
        ),
      );
    };

    const url: string = server.url(OPEN_ID_CONFIGURATION_PATH);

    expect(
      await new BotFrameworkOpenIdMetadata(url).getKey("key-1"),
    ).toBeNull();
    expect(await new OpenIdMetadata(url).getKey("key-1")).toBeNull();
  });

  test.each([
    [OPEN_ID_CONFIGURATION_PATH, "Failed to load openID config: 404"],
    [KEY_SET_PATH, "Failed to load Keys: 404"],
  ])(
    "a document that does not load (%s) fails the check as the SDK fails it",
    async (missing: string, words: string) => {
      const key: SigningKey = createSigningKey("key-1");
      const target: { server: LocalHttpServer; url: string } =
        await directBotFramework([key]);
      const answer: typeof target.server.handler = target.server.handler;

      target.server.handler = (
        request: http.IncomingMessage,
        response: http.ServerResponse,
        body: string,
      ): void => {
        if (String(request.url).endsWith(missing)) {
          response.writeHead(404);
          response.end();
          return;
        }

        answer(request, response, body);
      };

      const ours: Error = await failureOf(
        new BotFrameworkOpenIdMetadata(target.url).getKey("key-1"),
      );
      const theSdks: Error = await failureOf(
        new OpenIdMetadata(target.url).getKey("key-1"),
      );

      expect(ours).toBeInstanceOf(AuthenticationError);
      expect(ours.message).toBe(words);
      expect((ours as unknown as { statusCode: number }).statusCode).toBe(500);
      expect(ours.message).toBe(theSdks.message);
    },
  );

  test("a key it holds is read from what it fetched; one it does not is fetched again at most once an hour", async () => {
    const target: { seen: Array<string>; url: string } =
      await directBotFramework([createSigningKey("key-1")]);
    const metadata: BotFrameworkOpenIdMetadata = new BotFrameworkOpenIdMetadata(
      target.url,
    );
    const start: number = Date.now();
    const clock: { now: number } = { now: start };

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return clock.now;
    });

    await metadata.getKey("key-1");
    await metadata.getKey("key-1");
    expect(target.seen).toHaveLength(2);

    // Not yet an hour: a key it does not hold is not fetched for.
    clock.now = start + 59 * 60 * 1000;
    expect(await metadata.getKey("key-2")).toBeNull();
    expect(target.seen).toHaveLength(2);

    // Past the hour: it is fetched for, once.
    clock.now = start + 61 * 60 * 1000;
    expect(await metadata.getKey("key-2")).toBeNull();
    expect(await metadata.getKey("key-2")).toBeNull();
    expect(target.seen).toHaveLength(4);
  });

  test("the keys are fetched again once they are a day old, or sooner when the SDK is told so", async () => {
    const target: { seen: Array<string>; url: string } =
      await directBotFramework([createSigningKey("key-1")]);
    const daily: BotFrameworkOpenIdMetadata = new BotFrameworkOpenIdMetadata(
      target.url,
    );
    const hourly: BotFrameworkOpenIdMetadata = new BotFrameworkOpenIdMetadata(
      target.url,
      2,
    );
    const start: number = Date.now();
    const clock: { now: number } = { now: start };

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return clock.now;
    });

    await daily.getKey("key-1");
    await hourly.getKey("key-1");
    expect(target.seen).toHaveLength(4);

    clock.now = start + 3 * 60 * 60 * 1000;
    await daily.getKey("key-1");
    await hourly.getKey("key-1");
    expect(target.seen).toHaveLength(6);

    clock.now = start + 25 * 60 * 60 * 1000;
    await daily.getKey("key-1");
    expect(target.seen).toHaveLength(8);
  });

  test("checks that need the keys at the same moment wait for one fetch", async () => {
    const target: { seen: Array<string>; url: string } =
      await directBotFramework([createSigningKey("key-1")]);
    const metadata: BotFrameworkOpenIdMetadata = new BotFrameworkOpenIdMetadata(
      target.url,
    );

    const found: Array<BotFrameworkSigningKey | null> = await Promise.all(
      [1, 2, 3, 4, 5].map((): Promise<BotFrameworkSigningKey | null> => {
        return metadata.getKey("key-1");
      }),
    );

    expect(
      found.every((key: BotFrameworkSigningKey | null): boolean => {
        return key !== null;
      }),
    ).toBe(true);
    expect(target.seen).toEqual([OPEN_ID_CONFIGURATION_PATH, KEY_SET_PATH]);
  });
});

describe("routeEveryDocument puts it in the SDK's cache", () => {
  const DOCUMENTS: Array<string> = [
    "https://login.botframework.com/v1/.well-known/openidconfiguration",
    "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    "https://login.botframework.azure.us/v1/.well-known/openidconfiguration",
    "https://login.microsoftonline.us/cab8a31a-1906-4287-a0d8-4eef66b95f6e/v2.0/.well-known/openid-configuration",
  ];

  test("for each document either cloud's token checks read: a channel's and the Emulator's, in Azure's public cloud and Azure Government", () => {
    expect(BotFrameworkOpenIdMetadata.getDocumentUrls()).toEqual(DOCUMENTS);

    BotFrameworkOpenIdMetadata.routeEveryDocument();

    const cache: Map<string, unknown> =
      BotFrameworkOpenIdMetadata.getSdkCache();

    expect(Array.from(cache.keys()).sort()).toEqual([...DOCUMENTS].sort());

    for (const url of DOCUMENTS) {
      const metadata: unknown = cache.get(url);

      expect(metadata).toBeInstanceOf(BotFrameworkOpenIdMetadata);
      expect((metadata as BotFrameworkOpenIdMetadata).url).toBe(url);
    }
  });

  test("in place of the SDK's own metadata; again, it changes nothing", () => {
    const cache: Map<string, unknown> =
      BotFrameworkOpenIdMetadata.getSdkCache();
    const theSdks: OpenIdMetadata = new OpenIdMetadata(DOCUMENTS[0]!);

    cache.set(DOCUMENTS[0]!, theSdks);
    BotFrameworkOpenIdMetadata.routeEveryDocument();

    const routed: unknown = cache.get(DOCUMENTS[0]!);

    expect(routed).toBeInstanceOf(BotFrameworkOpenIdMetadata);

    BotFrameworkOpenIdMetadata.routeEveryDocument();

    expect(cache.get(DOCUMENTS[0]!)).toBe(routed);
  });
});
