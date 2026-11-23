import BotFrameworkCredentialsFactory, {
  BotFrameworkTokenNetwork,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkTokenRequests";
import {
  AppCredentials,
  AuthenticationConstants,
  ConfigurationServiceClientCredentialFactory,
  GovernmentConstants,
  MicrosoftAppCredentials,
  MsalAppCredentials,
  ServiceClientCredentials,
} from "Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder";
import OutboundFetch from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import ProxyTunnelRefusal from "Common/Utils/ProxyTunnelRefusal";
import {
  ACCESS_TOKEN,
  ENTRA_HOST,
  TokenRequestSeen,
  entraTokenHandler,
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
  AuthError,
  NetworkResponse,
} from "Common/node_modules/@azure/msal-node";
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

jest.mock("Common/Server/Utils/Logger");

/*
 * THE TEAMS BOT'S TOKENS, ASKED FOR ON THE OUTBOUND PROXY'S ROUTE (issue
 * #10763).
 *
 * The Bot Framework SDK asks Microsoft Entra ID for the bot's tokens with
 * @azure/msal-node, whose own network client sends with no proxy at all.
 * BotFrameworkCredentialsFactory hands it credentials whose MSAL client
 * sends on BotFrameworkTokenNetwork, on the route OutboundProxyAgents
 * decides. Here, with real requests to a proxy and servers on this machine:
 *
 *   - the network on its own, over http to a name nothing resolves
 *     (login.microsoftonline.test), which only a forward proxy that is
 *     asked can answer for: through the proxy, signed in with a user name
 *     and password holding "@", ":" and "%", past it for NO_PROXY, with no
 *     proxy at all, and refused by it;
 *   - the credentials the bot sends with, end to end: MSAL refuses an http
 *     authority, so their tokens are asked of login.microsoftonline.com (and
 *     .us) over https, through a proxy that tunnels to a server here with a
 *     certificate for that name from a CA this process trusts for the test.
 *     Nothing looks those names up (watchLookups): a request that went
 *     around the proxy would.
 */

const APP_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const APP_TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const APP_PASSWORD: string = "teams-client-secret";
const UNRESOLVED_HOST: string = "login.microsoftonline.test";
const GOVERNMENT_ENTRA_HOST: string = "login.microsoftonline.us";
const TOKEN_PATH: string = `/${APP_TENANT_ID}/oauth2/v2.0/token`;
const TOKEN_FORM: string = `client_id=${APP_ID}&grant_type=client_credentials`;

// The bot's settings, as MicrosoftTeamsUtil.getBotAuthenticationOptions gives them.
const COMMERCIAL_SETTINGS: Record<string, string> = {
  MicrosoftAppId: APP_ID,
  MicrosoftAppPassword: APP_PASSWORD,
  MicrosoftAppType: "SingleTenant",
  MicrosoftAppTenantId: APP_TENANT_ID,
};
const GOVERNMENT_SETTINGS: Record<string, string> = {
  ...COMMERCIAL_SETTINGS,
  ChannelService: "https://botframework.azure.us",
};

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();
const selfSignedHttps: ReturnType<typeof useSelfSignedHttps> =
  useSelfSignedHttps();

const certificates: Map<string, TestCertificates> = new Map<
  string,
  TestCertificates
>();

beforeAll(() => {
  for (const host of [ENTRA_HOST, GOVERNMENT_ENTRA_HOST]) {
    certificates.set(host, generateTestCertificates(host));
  }
});

afterAll(() => {
  for (const certificate of certificates.values()) {
    removeTestCertificates(certificate);
  }
});

afterEach(async () => {
  (AppCredentials as unknown as { cache: Map<string, unknown> }).cache.clear();
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

// A server that answers as Entra ID's token endpoint does.
async function serveEntra(
  name: string,
): Promise<{ server: LocalHttpServer; seen: Array<TokenRequestSeen> }> {
  const server: LocalHttpServer = await serve({ name: name });
  const seen: Array<TokenRequestSeen> = [];

  server.handler = entraTokenHandler({ seen: seen });

  return { server, seen };
}

function postToken(url: string): Promise<NetworkResponse<unknown>> {
  return new BotFrameworkTokenNetwork().sendPostRequestAsync(url, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: TOKEN_FORM,
  });
}

describe("MSAL's network for the bot, on its own", () => {
  describe("through the outbound proxy", () => {
    test.each([
      [
        "a user name and password holding @, : and %",
        RESERVED_CHARACTER_CREDENTIALS,
      ],
      ["plain ones", PLAIN_CREDENTIALS],
    ])(
      "a token request is forwarded whole, signed in with %s as written, decoded",
      async (_name: string, credentials: typeof PLAIN_CREDENTIALS) => {
        const proxy: {
          server: LocalHttpServer;
          seen: Array<TokenRequestSeen>;
        } = await serveEntra("proxy");

        process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
          proxy.server.port,
          credentials,
        );

        const response: NetworkResponse<unknown> = await postToken(
          `http://${UNRESOLVED_HOST}${TOKEN_PATH}`,
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ access_token: ACCESS_TOKEN });
        expect(response.headers["content-type"]).toBe("application/json");
        expect(proxy.server.requests).toEqual([
          {
            method: "POST",
            url: `http://${UNRESOLVED_HOST}${TOKEN_PATH}`,
            host: UNRESOLVED_HOST,
            body: TOKEN_FORM,
          },
        ]);
        expect(proxy.server.requestCredentials).toEqual([
          signedInAs(credentials),
        ]);
      },
    );

    test("a GET is forwarded the same way", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });

      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      const response: NetworkResponse<unknown> =
        await new BotFrameworkTokenNetwork().sendGetRequestAsync(
          `http://${UNRESOLVED_HOST}/common/discovery/instance`,
          { headers: { Accept: "application/json" } },
          5000,
        );

      expect(response.body).toEqual({ answeredBy: "proxy" });
      expect(proxy.requests[0]!.url).toBe(
        `http://${UNRESOLVED_HOST}/common/discovery/instance`,
      );
      expect(proxy.requestCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
    });

    test("an https token request is tunnelled, the CONNECT signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });

      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      // The proxy refuses every tunnel; what matters is what it was asked.
      await failureOf(postToken(`https://${ENTRA_HOST}${TOKEN_PATH}`));

      expect(proxy.connects).toEqual([`${ENTRA_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
    });
  });

  describe("past the outbound proxy", () => {
    test.each([
      ["the host's name", "127.0.0.1"],
      ["an address range, as axios reads NO_PROXY", "10.0.0.0/8,127.0.0.0/8"],
    ])(
      "a token request to a host NO_PROXY names by %s is sent directly",
      async (_name: string, noProxy: string) => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        const entra: {
          server: LocalHttpServer;
          seen: Array<TokenRequestSeen>;
        } = await serveEntra("entra");

        process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          RESERVED_CHARACTER_CREDENTIALS,
        );
        process.env["NO_PROXY"] = noProxy;

        const response: NetworkResponse<unknown> = await postToken(
          entra.server.url(TOKEN_PATH),
        );

        expect(response.body).toMatchObject({ access_token: ACCESS_TOKEN });
        expect(entra.seen).toHaveLength(1);
        expect(proxy.isUntouched).toBe(true);
      },
    );

    test("with no proxy set at all, it is sent directly, as it always was", async () => {
      const entra: { server: LocalHttpServer; seen: Array<TokenRequestSeen> } =
        await serveEntra("entra");

      const response: NetworkResponse<unknown> = await postToken(
        entra.server.url(TOKEN_PATH),
      );

      expect(response.status).toBe(200);
      expect(entra.seen).toEqual([
        {
          path: TOKEN_PATH,
          form: { client_id: APP_ID, grant_type: "client_credentials" },
        },
      ]);
      expect(entra.server.requestCredentials).toEqual([""]);
    });
  });

  describe("a request the outbound proxy refuses fails as an MSAL AuthError, which MSAL hands on, in the proxy's words", () => {
    test("a refused tunnel: what the proxy answered and where the request was going, never the proxy", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });

      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      const refusal: Error = await failureOf(
        postToken(`https://${ENTRA_HOST}${TOKEN_PATH}`),
      );

      expect(refusal).toBeInstanceOf(AuthError);
      expect(refusal.message).toBe(
        `The outbound proxy did not open a connection to ${ENTRA_HOST}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
      );
      expect(ProxyTunnelRefusal.describe(refusal)).toBe(refusal.message);
      expect(refusal.message).not.toContain(PROXY_HOST_NAME);
      expect(refusal.message).not.toContain(String(proxy.port));
    });

    test("a 407 to the CONNECT: the proxy did not take OneUptime's user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });

      proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      const refusal: Error = await failureOf(
        postToken(`https://${ENTRA_HOST}${TOKEN_PATH}`),
      );

      expect(refusal).toBeInstanceOf(AuthError);
      expect(refusal.message).toBe(
        `The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${ENTRA_HOST}:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`,
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
        response.writeHead(407, {
          "Proxy-Authenticate": 'Basic realm="proxy"',
        });
        response.end();
      };
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      const refusal: Error = await failureOf(
        postToken(`http://${UNRESOLVED_HOST}${TOKEN_PATH}`),
      );

      expect(refusal).toBeInstanceOf(AuthError);
      expect(refusal.message).toContain(
        `it did not take OneUptime's user name and password, so the request to ${UNRESOLVED_HOST}:80 was not sent.`,
      );
    });

    test("a proxy setting this server cannot use fails before anything is sent, naming no password", async () => {
      process.env["HTTPS_PROXY"] =
        `socks5://${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.user)}:${encodeURIComponent(RESERVED_CHARACTER_CREDENTIALS.password)}@${PROXY_HOST_NAME}:1080`;

      const refusal: Error = await failureOf(
        postToken(`https://${ENTRA_HOST}${TOKEN_PATH}`),
      );

      expect(refusal).toBeInstanceOf(AuthError);
      expect(refusal.message).toBe(
        "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
      );
    });
  });

  describe("answers as MSAL's own network answers", () => {
    test("a body that is no JSON is read as MSAL reads one: an error, with the status it came with", async () => {
      const server: LocalHttpServer = await serve({ name: "entra" });

      server.handler = (
        _request: http.IncomingMessage,
        response: http.ServerResponse,
      ): void => {
        response.writeHead(502, { "Content-Type": "text/html" });
        response.end("<html>Bad Gateway</html>");
      };

      const response: NetworkResponse<unknown> = await postToken(
        server.url(TOKEN_PATH),
      );

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({
        error: "server_error",
        error_description: expect.stringContaining(
          "A server error occured.\nHttp status code: 502",
        ),
      });
    });

    test("a GET with a timeout that is not answered in time fails as MSAL's does", async () => {
      const server: LocalHttpServer = await serve({ name: "silent" });

      server.handler = (): void => {
        // Never answers.
      };

      const failure: Error = await failureOf(
        new BotFrameworkTokenNetwork().sendGetRequestAsync(
          server.url("/discovery"),
          {},
          200,
        ),
      );

      expect(failure.message).toBe("Request time out");
    });
  });
});

describe("the credentials the bot sends with", () => {
  interface StandInEntra {
    proxy: TunnellingProxy;
    seen: Array<TokenRequestSeen>;
  }

  /*
   * Entra ID at `host`, over https with a certificate this process trusts,
   * behind a proxy that takes only the reserved-character user name and
   * password.
   */
  async function entraBehindProxy(host: string): Promise<StandInEntra> {
    const certificate: TestCertificates = certificates.get(host)!;
    const seen: Array<TokenRequestSeen> = [];

    trustAsDefaultCa(certificate.caCertificate);

    const entra: LocalHttpsServer = await selfSignedHttps.serve({
      name: host,
      certificate: certificate.caSigned,
    });

    entra.handler = entraTokenHandler({ seen: seen });

    const proxy: TunnellingProxy = await selfSignedHttps.proxy({
      route: (authority: string): TunnelEnd | null => {
        return authority === `${host}:443`
          ? { host: entra.host, port: entra.port }
          : null;
      },
      credentials: signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    return { proxy, seen };
  }

  async function credentialsFor(
    settings: Record<string, string>,
  ): Promise<MsalAppCredentials> {
    const government: boolean = Boolean(settings["ChannelService"]);
    const credentials: ServiceClientCredentials =
      await new BotFrameworkCredentialsFactory(settings).createCredentials(
        APP_ID,
        government
          ? GovernmentConstants.ToChannelFromBotOAuthScope
          : AuthenticationConstants.ToChannelFromBotOAuthScope,
        government
          ? GovernmentConstants.ToChannelFromBotLoginUrl
          : AuthenticationConstants.ToChannelFromBotLoginUrl,
        true,
      );

    expect(credentials).toBeInstanceOf(MsalAppCredentials);

    return credentials as MsalAppCredentials;
  }

  test.each([
    [
      "Azure's public cloud",
      COMMERCIAL_SETTINGS,
      ENTRA_HOST,
      "https://api.botframework.com",
    ],
    [
      "Azure Government",
      GOVERNMENT_SETTINGS,
      GOVERNMENT_ENTRA_HOST,
      "https://api.botframework.us",
    ],
  ])(
    "%s: the SDK's choice of authority and scope, the token asked for through the proxy with the real user name and password",
    async (
      _cloud: string,
      settings: Record<string, string>,
      host: string,
      scope: string,
    ) => {
      const entra: StandInEntra = await entraBehindProxy(host);
      const lookups: Array<string> = watchLookups([host]);
      const credentials: MsalAppCredentials = await credentialsFor(settings);

      expect(credentials.oAuthEndpoint).toBe(
        `https://${host}/${APP_TENANT_ID}`,
      );
      expect(credentials.oAuthScope).toBe(scope);

      expect(await credentials.getToken()).toBe(ACCESS_TOKEN);
      expect(entra.seen).toEqual([
        {
          path: TOKEN_PATH,
          form: expect.objectContaining({
            grant_type: "client_credentials",
            client_id: APP_ID,
            client_secret: APP_PASSWORD,
            scope: `${scope}/.default`,
          }),
        },
      ]);
      expect(entra.proxy.connects).toEqual([`${host}:443`]);
      expect(entra.proxy.connectCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
      expect(lookups).not.toContain(host);
    },
  );

  test("they are the same as the SDK's own but for the client they ask with", async () => {
    const ours: MsalAppCredentials = await credentialsFor(COMMERCIAL_SETTINGS);
    const theSdks: ServiceClientCredentials =
      await new ConfigurationServiceClientCredentialFactory(
        COMMERCIAL_SETTINGS,
      ).createCredentials(
        APP_ID,
        AuthenticationConstants.ToChannelFromBotOAuthScope,
        AuthenticationConstants.ToChannelFromBotLoginUrl,
        true,
      );

    expect(theSdks).toBeInstanceOf(MicrosoftAppCredentials);
    expect({
      appId: ours.appId,
      oAuthEndpoint: ours.oAuthEndpoint,
      oAuthScope: ours.oAuthScope,
    }).toEqual({
      appId: (theSdks as MicrosoftAppCredentials).appId,
      oAuthEndpoint: (theSdks as MicrosoftAppCredentials).oAuthEndpoint,
      oAuthScope: (theSdks as MicrosoftAppCredentials).oAuthScope,
    });
  });

  test("one MSAL client per authority, and the SDK's cache keeps the token between credentials", async () => {
    const entra: StandInEntra = await entraBehindProxy(ENTRA_HOST);
    const factory: BotFrameworkCredentialsFactory =
      new BotFrameworkCredentialsFactory(COMMERCIAL_SETTINGS);
    const first: ServiceClientCredentials = await factory.createCredentials(
      APP_ID,
      AuthenticationConstants.ToChannelFromBotOAuthScope,
      AuthenticationConstants.ToChannelFromBotLoginUrl,
      true,
    );
    const second: ServiceClientCredentials = await factory.createCredentials(
      APP_ID,
      AuthenticationConstants.ToChannelFromBotOAuthScope,
      AuthenticationConstants.ToChannelFromBotLoginUrl,
      true,
    );

    expect(
      (second as unknown as { clientApplication: unknown }).clientApplication,
    ).toBe(
      (first as unknown as { clientApplication: unknown }).clientApplication,
    );

    expect(await (first as MsalAppCredentials).getToken()).toBe(ACCESS_TOKEN);
    expect(await (second as MsalAppCredentials).getToken()).toBe(ACCESS_TOKEN);
    expect(entra.seen).toHaveLength(1);
  });

  test("the factory answers for the app as the SDK's does, and with no app id asks for no token at all", async () => {
    const factory: BotFrameworkCredentialsFactory =
      new BotFrameworkCredentialsFactory(COMMERCIAL_SETTINGS);

    expect(await factory.isValidAppId(APP_ID)).toBe(true);
    expect(await factory.isValidAppId("another-app")).toBe(false);
    expect(await factory.isAuthenticationDisabled()).toBe(false);

    const anonymous: BotFrameworkCredentialsFactory =
      new BotFrameworkCredentialsFactory({});

    expect(await anonymous.isAuthenticationDisabled()).toBe(true);
    expect(
      await anonymous.createCredentials(
        "",
        undefined,
        AuthenticationConstants.ToChannelFromBotLoginUrl,
        true,
      ),
    ).toBe(MicrosoftAppCredentials.Empty);
  });

  test("a host in NO_PROXY is asked directly: the proxy never is", async () => {
    const entra: StandInEntra = await entraBehindProxy(ENTRA_HOST);
    const lookups: Array<string> = watchLookups([ENTRA_HOST]);

    process.env["NO_PROXY"] = ENTRA_HOST;

    await failureOf((await credentialsFor(COMMERCIAL_SETTINGS)).getToken());

    // Directly: its name was looked up here (and is no real host here).
    expect(lookups).toContain(ENTRA_HOST);
    expect(entra.proxy.connects).toEqual([]);
    expect(entra.seen).toEqual([]);
  });

  test("with no proxy set at all, the token is asked for directly, as it always was", async () => {
    const entra: StandInEntra = await entraBehindProxy(ENTRA_HOST);
    const lookups: Array<string> = watchLookups([ENTRA_HOST]);

    delete process.env["HTTPS_PROXY"];

    await failureOf((await credentialsFor(COMMERCIAL_SETTINGS)).getToken());

    expect(lookups).toContain(ENTRA_HOST);
    expect(entra.proxy.connects).toEqual([]);
  });

  test("a token the proxy refuses fails in its words, through MSAL, never naming the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      (await credentialsFor(COMMERCIAL_SETTINGS)).getToken(),
    );

    expect(refusal.message).toBe(
      `The outbound proxy did not open a connection to ${ENTRA_HOST}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );
    expect(refusal.message).not.toContain(String(proxy.port));
  });

  test("a 407 says the proxy did not take OneUptime's user name and password, which it was sent decoded", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });

    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const refusal: Error = await failureOf(
      (await credentialsFor(COMMERCIAL_SETTINGS)).getToken(),
    );

    expect(refusal.message).toContain(
      "it did not take OneUptime's user name and password",
    );
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("the SDK's own credentials, as the bot used them before, ask for the token around the proxy", async () => {
    const entra: StandInEntra = await entraBehindProxy(ENTRA_HOST);
    const lookups: Array<string> = watchLookups([ENTRA_HOST]);
    const theSdks: ServiceClientCredentials =
      await new ConfigurationServiceClientCredentialFactory(
        COMMERCIAL_SETTINGS,
      ).createCredentials(
        APP_ID,
        AuthenticationConstants.ToChannelFromBotOAuthScope,
        AuthenticationConstants.ToChannelFromBotLoginUrl,
        true,
      );

    await failureOf((theSdks as MicrosoftAppCredentials).getToken());

    expect(entra.proxy.connects).toEqual([]);
    expect(lookups).toContain(ENTRA_HOST);
  });
});
