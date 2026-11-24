import OutboundFetch from "Common/Server/Utils/OutboundFetch";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import AwsDefaultCredentialChain, {
  AwsChainCredentials,
  AwsChainHttpError,
  AwsChainHttpResponse,
  defaultAwsChainHttpClient,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import {
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import GoogleSecOpsClient from "Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "Common/Server/Utils/VideoCall/VideoCallHttpClient";
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
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import http from "http";

jest.mock("Common/Server/Utils/Logger");

/*
 * THE SENDERS OF COMMON THAT SEND WITH NODE'S FETCH GO THROUGH THE OUTBOUND
 * PROXY (issue #10720).
 *
 * The marketplace client - which also carries Continue with Google, Sign in
 * with Microsoft and the self-hosted metering reporters - the AWS
 * credential chain's client, the meeting providers' client and Google
 * SecOps each sent with Node's fetch, which reads no HTTPS_PROXY. Each goes
 * through OutboundFetch now. These send through each one's real code to a
 * proxy and servers on this machine (OutboundProxyFixture), with Node's
 * real fetch: Common's jest runs in jsdom, which has none.
 */

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

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The request went through.");
}

function urlsSeenBy(server: LocalHttpServer): Array<string> {
  return server.requests.map((seen: { url: string }): string => {
    return seen.url;
  });
}

/*
 * Each sender, as its callers send: `send` sends a request to `url` and
 * gives back the status it was answered with; `failure` is what its
 * failure says, as its caller reads it.
 */
interface Sender {
  name: string;
  send: (url: string) => Promise<number>;
  failure: (error: Error) => string;
}

const SENDERS: Array<Sender> = [
  {
    name: "the marketplace client (sign-in with Google and Microsoft, the marketplaces, metering)",
    send: async (url: string): Promise<number> => {
      const response: MarketplaceHttpResponse =
        await defaultMarketplaceHttpClient({
          method: "POST",
          url: url,
          headers: { "Content-Type": "application/json" },
          body: '{"usage":1}',
          timeoutInMs: 5000,
        });

      return response.status;
    },
    failure: (error: Error): string => {
      return error.message;
    },
  },
  {
    name: "the AWS credential chain's client (STS)",
    send: async (url: string): Promise<number> => {
      const response: AwsChainHttpResponse = await defaultAwsChainHttpClient({
        method: "POST",
        url: url,
        headers: { Accept: "application/json" },
        body: "Action=AssumeRoleWithWebIdentity",
        timeoutMs: 5000,
      });

      return response.status;
    },
    failure: (error: Error): string => {
      return error.message;
    },
  },
  {
    name: "the meeting providers' client (Zoom, Google Meet, Microsoft Teams)",
    send: async (url: string): Promise<number> => {
      const response: VideoCallHttpResponse = await new VideoCallHttpClient({
        timeoutInMs: 5000,
      }).request({
        url: url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        stepLabel: "Zoom token request",
      });

      return response.status;
    },
    // Its failures say which step failed.
    failure: (error: Error): string => {
      return error.message.replace(/^Zoom token request failed: /, "");
    },
  },
];

const REFUSAL_403: (destination: string) => string = (
  destination: string,
): string => {
  return `The outbound proxy did not open a connection to ${destination}: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`;
};

describe.each(SENDERS)("$name", (sender: Sender) => {
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
      test("over http, the proxy is sent the whole URL, signed in with the real user name and password", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );

        expect(await sender.send("http://api.example.test/v1/send")).toBe(200);
        expect(urlsSeenBy(proxy)).toEqual(["http://api.example.test/v1/send"]);
        expect(proxy.requestCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
      });

      test("over https, the CONNECT is signed in with the real user name and password", async () => {
        const proxy: LocalHttpServer = await serve({ name: "proxy" });
        process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
          proxy.port,
          data.credentials,
        );

        await failureOf(sender.send("https://api.example.test/v1/send"));

        expect(proxy.connects).toEqual(["api.example.test:443"]);
        expect(proxy.connectCredentials).toEqual([
          signedInAs(data.credentials),
        ]);
      });
    },
  );

  test("a refused tunnel is said as the proxy's refusal, never naming the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(
      sender.send("https://api.example.test/v1/send"),
    );

    expect(sender.failure(failure)).toBe(REFUSAL_403("api.example.test:443"));
    expect(failure.message).not.toContain(PROXY_HOST_NAME);
    expect(failure.message).not.toContain(String(proxy.port));
    expect(failure.message).not.toContain("p@ss");
  });

  test("a 407 is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(
      sender.send("https://api.example.test/v1/send"),
    );

    expect(sender.failure(failure)).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to api.example.test:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
  });

  test("a host in NO_PROXY is sent to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({ name: "target" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = "127.0.0.1";

    expect(await sender.send(target.url("/direct"))).toBe(200);
    expect(urlsSeenBy(target)).toEqual(["/direct"]);
    expect(target.requestCredentials).toEqual([""]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy at all, it is sent directly", async () => {
    const target: LocalHttpServer = await serve({ name: "target" });

    expect(await sender.send(target.url("/direct"))).toBe(200);
    expect(urlsSeenBy(target)).toEqual(["/direct"]);
  });
});

describe("the AWS credential chain", () => {
  const ROLE_ARN: string = "arn:aws:iam::123456789012:role/oneuptime-ses";
  const TOKEN_FILE: string = "/var/run/secrets/eks.amazonaws.com/token";

  function webIdentityChain(): AwsDefaultCredentialChain {
    return new AwsDefaultCredentialChain({
      env: {
        AWS_ROLE_ARN: ROLE_ARN,
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
        AWS_REGION: "eu-west-1",
      },
      readFile: async (): Promise<string> => {
        return "web-identity-token";
      },
      httpClient: defaultAwsChainHttpClient,
    });
  }

  test("asks STS through the proxy, and says the proxy's refusal in its words", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(webIdentityChain().getCredentials());

    expect(proxy.connects).toEqual(["sts.eu-west-1.amazonaws.com:443"]);
    expect(proxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(failure.message).toBe(
      `AWS STS could not be reached at sts.eu-west-1.amazonaws.com. ${REFUSAL_403("sts.eu-west-1.amazonaws.com:443")}`,
    );
  });

  test("a refusal reaches the chain as the proxy's, which a caller of the client can tell", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 502 Bad Gateway";
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const failure: Error = await failureOf(
      defaultAwsChainHttpClient({
        method: "POST",
        url: "https://sts.eu-west-1.amazonaws.com/",
        headers: {},
        timeoutMs: 5000,
      }),
    );

    expect(failure).toBeInstanceOf(AwsChainHttpError);
    expect((failure as AwsChainHttpError).isOutboundProxyFailure).toBe(true);
    // A proxy that failed itself is worth asking again.
    expect((failure as AwsChainHttpError).isProxyFailureRetryable).toBe(true);
    expect((failure as AwsChainHttpError).isTimeout).toBe(false);
  });

  /*
   * The instance metadata service answers this machine alone: a proxy
   * elsewhere could not reach it, and could reach its own host's instead.
   * It is asked directly whatever the environment says, as AWS's SDK for
   * JavaScript asks it.
   */
  test("reads the instance profile directly, with every proxy variable set and NO_PROXY naming nothing", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const metadata: LocalHttpServer = await serve({ name: "metadata" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["ALL_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    metadata.handler = (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      if (request.method === "PUT" && request.url === "/latest/api/token") {
        response.end("imds-session-token");
        return;
      }

      if (request.url === "/latest/meta-data/iam/security-credentials/") {
        response.end("oneuptime-instance");
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          Code: "Success",
          AccessKeyId: "ASIAINSTANCEEXAMPLE",
          SecretAccessKey: "instanceSecretEXAMPLE0123456789abcdef",
          Token: "IQoJb3JpZ2luX2VjEInstanceSessionToken",
          Expiration: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      );
    };

    const credentials: AwsChainCredentials =
      await new AwsDefaultCredentialChain({
        env: {
          AWS_EC2_METADATA_SERVICE_ENDPOINT: `http://127.0.0.1:${metadata.port}`,
        },
        httpClient: defaultAwsChainHttpClient,
      }).getCredentials();

    expect(credentials.source).toBe("instance-profile");
    expect(credentials.accessKeyId).toBe("ASIAINSTANCEEXAMPLE");
    expect(urlsSeenBy(metadata)).toEqual([
      "/latest/api/token",
      "/latest/meta-data/iam/security-credentials/",
      "/latest/meta-data/iam/security-credentials/oneuptime-instance",
    ]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("asks a container agent directly too", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const agent: LocalHttpServer = await serve({ name: "agent" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    const response: AwsChainHttpResponse = await defaultAwsChainHttpClient({
      method: "GET",
      url: agent.url("/v1/credentials"),
      headers: { Accept: "application/json" },
      timeoutMs: 5000,
      direct: true,
    });

    expect(response.status).toBe(200);
    expect(urlsSeenBy(agent)).toEqual(["/v1/credentials"]);
    expect(proxy.isUntouched).toBe(true);
  });
});

/*
 * Google SecOps signs in at Google's token host alone (its token_uri is
 * held to Google's hosts), so where its requests went is read from what
 * this machine looked up (watchLookups): nothing leaves it.
 */
describe("Google SecOps", () => {
  const TOKEN_HOST: string = "oauth2.googleapis.com";
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  function client(): GoogleSecOpsClient {
    return new GoogleSecOpsClient({
      region: "us",
      instanceResourceName:
        "projects/my-project/locations/us/instances/3f0a-instance",
      serviceAccountJson: JSON.stringify({
        client_email: "poller@example.iam.gserviceaccount.com",
        private_key: privateKey,
        token_uri: `https://${TOKEN_HOST}/token`,
      }),
      requestTimeoutInMs: 5000,
    });
  }

  test.each([
    {
      kind: "with @, : and % in it",
      credentials: RESERVED_CHARACTER_CREDENTIALS,
    },
    {
      kind: "with no character a URL reserves",
      credentials: PLAIN_CREDENTIALS,
    },
  ])(
    "signs in through the proxy, whose password is $kind, and its host is not looked up here",
    async (data: { kind: string; credentials: ProxyCredentials }) => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const lookups: Array<string> = watchLookups([TOKEN_HOST]);

      const failure: Error = await failureOf(client().testAuthentication());

      expect(proxy.connects).toEqual([`${TOKEN_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
      expect(lookups).not.toContain(TOKEN_HOST);
      expect(failure.message).toContain(REFUSAL_403(`${TOKEN_HOST}:443`));
      expect(failure.message).not.toContain(String(proxy.port));
    },
  );

  test("a 407 is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(client().testAuthentication());

    expect(failure.message).toContain(
      `The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${TOKEN_HOST}:443 was not sent.`,
    );
  });

  test("a host in NO_PROXY is asked directly, and the proxy never is", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = ".googleapis.com";
    const lookups: Array<string> = watchLookups([TOKEN_HOST]);

    await failureOf(client().testAuthentication());

    expect(lookups).toContain(TOKEN_HOST);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy at all, it is asked directly", async () => {
    const lookups: Array<string> = watchLookups([TOKEN_HOST]);

    await failureOf(client().testAuthentication());

    expect(lookups).toContain(TOKEN_HOST);
  });
});
