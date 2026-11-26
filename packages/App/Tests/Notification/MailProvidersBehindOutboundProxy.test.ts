import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OutboundFetch from "Common/Server/Utils/OutboundFetch";
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
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import MailgunRegion from "Common/Types/Email/MailgunRegion";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import AmazonSesMailProvider from "../../FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider";
import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import MailgunMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MailgunMailProvider";
import { MailProviderSendOptions } from "../../FeatureSet/Notification/Services/MailProviders/MailProvider";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import PostmarkMailProvider from "../../FeatureSet/Notification/Services/MailProviders/PostmarkMailProvider";
import ResendMailProvider from "../../FeatureSet/Notification/Services/MailProviders/ResendMailProvider";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import http from "http";

/*
 * EMAIL SENT THROUGH A PROVIDER'S HTTP API GOES THROUGH THE OUTBOUND PROXY
 * (issue #10720).
 *
 * Amazon SES, Mailgun, Postmark, Resend and Microsoft Graph are each sent
 * with Node's fetch, which reads no HTTPS_PROXY: on a server whose mail
 * leaves only through a proxy, none of them sent a thing. Each goes through
 * OutboundFetch now. These send through the real providers' code to a proxy
 * on this machine (OutboundProxyFixture), which records who each CONNECT
 * signed in as and refuses it, so nothing leaves the machine:
 *
 *   - through the proxy, the CONNECT to the provider's host is signed in
 *     with the real user name and password, "@", ":" and "%" included, and
 *     the host is never looked up here - the proxy does that;
 *   - a refused tunnel, and a 407, are said as the proxy's refusal, which
 *     never names the proxy, and are not tried again;
 *   - NO_PROXY's hosts, and every host with no proxy set, are sent to
 *     directly: the host is looked up here, and answered as one DNS does not
 *     know (watchLookups), so the attempt never leaves the machine either.
 */

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

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(async () => {
  await OutboundFetch.destroySharedDispatchers();
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

/*
 * A deadline short enough that a failure is not tried again after the
 * backoff: each send makes one attempt.
 */
const ONE_ATTEMPT: MailProviderSendOptions = { timeoutMs: 1000 };

function mail(): EmailMessage {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "Incident #12 created",
    body: "<p>Checkout is down.</p>",
    vars: {},
  };
}

const SENDER: { fromEmail: Email; fromName: string } = {
  fromEmail: new Email("alerts@mail.example.test"),
  fromName: "Acme Alerts",
};

interface Provider {
  // As the provider's errors name it.
  name: string;
  // Where it sends, over https.
  host: string;
  send: (options: MailProviderSendOptions) => Promise<void>;
}

const PROVIDERS: Array<Provider> = [
  {
    name: "Resend",
    host: "api.resend.com",
    send: (options: MailProviderSendOptions): Promise<void> => {
      return new ResendMailProvider().send(
        mail(),
        {
          ...SENDER,
          transportType: MailTransportType.Resend,
          username: undefined,
          password: undefined,
          apiKey: "re_test_key",
        },
        options,
      );
    },
  },
  {
    name: "Postmark",
    host: "api.postmarkapp.com",
    send: (options: MailProviderSendOptions): Promise<void> => {
      return new PostmarkMailProvider().send(
        mail(),
        {
          ...SENDER,
          transportType: MailTransportType.Postmark,
          username: undefined,
          password: undefined,
          apiKey: "postmark-server-token",
        },
        options,
      );
    },
  },
  {
    name: "Mailgun",
    host: "api.mailgun.net",
    send: (options: MailProviderSendOptions): Promise<void> => {
      return new MailgunMailProvider().send(
        mail(),
        {
          ...SENDER,
          id: ObjectID.generate(),
          transportType: MailTransportType.Mailgun,
          username: undefined,
          password: undefined,
          apiKey: "mailgun-test-api-key",
          mailgunDomain: "mail.example.test",
          mailgunRegion: MailgunRegion.US,
        },
        options,
      );
    },
  },
  {
    name: "Amazon SES",
    host: "email.eu-west-1.amazonaws.com",
    send: (options: MailProviderSendOptions): Promise<void> => {
      return new AmazonSesMailProvider().send(
        mail(),
        {
          ...SENDER,
          id: ObjectID.generate(),
          transportType: MailTransportType.AmazonSES,
          username: undefined,
          password: undefined,
          awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
          awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          awsRegion: "eu-west-1",
        },
        options,
      );
    },
  },
  {
    name: "Microsoft Graph",
    host: "graph.microsoft.com",
    send: (options: MailProviderSendOptions): Promise<void> => {
      // Its access token is the OAuth client's (routed by #10442), not here.
      jest
        .spyOn(SMTPOAuthService, "getAccessToken")
        .mockResolvedValue("fake-access-token");

      const server: EmailServer = {
        transportType: MailTransportType.MicrosoftGraph,
        username: "sender@contoso.com",
        password: undefined,
        fromEmail: new Email("sender@contoso.com"),
        fromName: "OneUptime Alerts",
        authType: SMTPAuthenticationType.OAuth,
        clientId: "client-id",
        clientSecret: "client-secret",
        tokenUrl: URL.fromString(
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        ),
        scope: "https://graph.microsoft.com/.default",
        oauthProviderType: OAuthProviderType.ClientCredentials,
      };

      return new MicrosoftGraphMailProvider().send(mail(), server, options);
    },
  },
];

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The email was sent.");
}

describe.each(PROVIDERS)("$name", (provider: Provider) => {
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
      test("is sent through it: the CONNECT is signed in with the real user name and password, and the host is not looked up here", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );
        const lookups: Array<string> = watchLookups([provider.host]);

        const failure: Error = await failureOf(provider.send(ONE_ATTEMPT));

        expect(proxy.connects).toEqual([`${provider.host}:443`]);
        expect(proxy.connectCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
        expect(lookups).not.toContain(provider.host);
        expect(failure.message).toBe(
          `${provider.name} could not be reached. The outbound proxy did not open a connection to ${provider.host}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
        );
      });
    },
  );

  test("a refused tunnel names neither the proxy nor its password, and is not tried again", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    // A whole minute to try again in: a refusal is not tried again anyway.
    const failure: Error = await failureOf(provider.send({ timeoutMs: 60000 }));

    expect(failure.message).not.toContain(PROXY_HOST_NAME);
    expect(failure.message).not.toContain(String(proxy.port));
    expect(failure.message).not.toContain("p@ss");
    expect(failure.message).not.toContain("p%40ss");
    expect(proxy.connects).toEqual([`${provider.host}:443`]);
    expect((failure as { isRetryable?: unknown }).isRetryable).toBe(false);
  });

  test("a 407 is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(provider.send(ONE_ATTEMPT));

    expect(failure.message).toBe(
      `${provider.name} could not be reached. The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${provider.host}:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`,
    );
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a host NO_PROXY names is sent to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = provider.host;
    const lookups: Array<string> = watchLookups([provider.host]);

    const failure: Error = await failureOf(provider.send(ONE_ATTEMPT));

    expect(lookups).toContain(provider.host);
    expect(proxy.isUntouched).toBe(true);
    expect(failure.message).toContain("ENOTFOUND");
  });

  test("with no proxy at all, it is sent directly", async () => {
    const lookups: Array<string> = watchLookups([provider.host]);

    const failure: Error = await failureOf(provider.send(ONE_ATTEMPT));

    expect(lookups).toContain(provider.host);
    expect(failure.message).toContain("ENOTFOUND");
  });
});

describe("a forwarded http request is the proxy's too", () => {
  /*
   * Every provider sends over https; HttpMailApi.post sends what it is
   * given, so a request over http, which a proxy forwards whole, is held to
   * the same: the real user name and password, and a 407 said as such.
   */
  test("over http, the proxy is sent the whole URL, signed in with the real user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const answer: MailApiAnswer = await HttpMailApi.post({
      providerName: "A mail API",
      request: {
        url: "http://mail-api.example.test/v1/send",
        headers: { "Content-Type": "application/json" },
        body: '{"to":"oncall@example.test"}',
      },
      timeoutMs: 5000,
    });

    expect(answer.status).toBe(200);
    expect(
      proxy.requests.map((seen: { url: string; body: string }): string => {
        return `${seen.url} ${seen.body}`;
      }),
    ).toEqual([
      'http://mail-api.example.test/v1/send {"to":"oncall@example.test"}',
    ]);
    expect(proxy.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
  });

  test("a 407 to it says the proxy did not take OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(407);
      response.end();
    };
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(
      HttpMailApi.post({
        providerName: "A mail API",
        request: {
          url: "http://mail-api.example.test/v1/send",
          headers: {},
          body: "{}",
        },
        timeoutMs: 5000,
      }),
    );

    expect(failure.message).toBe(
      "A mail API could not be reached. The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to mail-api.example.test:80 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
  });

  test("a proxy setting that cannot be used fails the send in words that name no password, and is not tried again", async () => {
    process.env["HTTPS_PROXY"] = "socks5://ops:p%40ss@socks.corp.example:1080";

    const failure: Error = await failureOf(
      HttpMailApi.post({
        providerName: "Resend",
        request: {
          url: "https://api.resend.com/emails",
          headers: {},
          body: "{}",
        },
        timeoutMs: 5000,
      }),
    );

    expect(failure).toBeInstanceOf(MailApiSendException);
    expect(failure.message).toBe(
      "Resend could not be reached. The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
    );
    expect((failure as { isRetryable?: unknown }).isRetryable).toBe(false);
  });
});
