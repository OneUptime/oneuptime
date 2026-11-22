/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import DataSourceEgressGuard, {
  PinnedAgentOptions,
  PinnedAgents,
  PinnedTarget,
} from "../../../Server/Utils/DataSource/EgressGuard";
import SafeWebhookRequest, {
  WebhookTarget,
} from "../../../Server/Utils/SafeWebhookRequest";
import { TargetTlsOptions } from "../../../Server/Utils/OutboundProxyAgents";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { getRequestErrorCode } from "../../../Utils/RequestErrorCode";
import {
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
} from "../TestingUtils/OutboundProxyFixture";
import {
  LocalHttpsServer,
  TestCertificate,
  TestCertificates,
  TunnelEnd,
  TunnellingProxy,
  generateTestCertificates,
  removeTestCertificates,
  trustAsDefaultCa,
  useDefaultCaRestored,
  useSelfSignedHttps,
} from "../TestingUtils/SelfSignedHttpsFixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import https from "https";
import tls from "tls";

jest.mock("../../../Server/Utils/Logger");

/*
 * A WEBHOOK'S CERTIFICATE, CHECKED AS ITS STEP SAYS, FOR ITS REQUEST ALONE
 * (issue #10440).
 *
 * SafeWebhookRequest sends every webhook of the server: notification
 * webhooks, workflow API steps, a playbook's Send Webhook. Its `tls` is how
 * that one request checks its server's certificate - not at all, or by the
 * step's own CA certificate alone - for the steps that have Allow
 * self-signed certificates and CA certificate. These send for real, to
 * HTTPS servers on this machine whose certificates nobody trusts
 * (SelfSignedHttpsFixture), at a made-up name the target is pinned to:
 *
 *   - unset, a self-signed certificate is refused, and the server never sees
 *     the request;
 *   - rejectUnauthorized false lets it through; so does a CA certificate
 *     that signed it, or the server's own - and that still checks the host
 *     name, which a CA certificate of another key, or a certificate for
 *     another name, fails;
 *   - only that request: the next one is checked as before, and nothing
 *     global changes;
 *   - behind an outbound proxy the setting reaches the server through the
 *     tunnel and never the proxy's own connection (axios's tunnel copied a
 *     request's TLS settings onto an https:// proxy's, #10277).
 */

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const { serve, proxy: startProxy } = useSelfSignedHttps();

const HOST: string = "hooks-tls.example.test";
// Another name for the same server, which its certificates do not list.
const OTHER_HOST: string = "hooks-tls-other.example.test";

let certificates: TestCertificates;
let canUse127002: boolean = false;

beforeAll(async () => {
  certificates = generateTestCertificates(HOST);
  canUse127002 = await canListenOn("127.0.0.2");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function serverWith(
  certificate: TestCertificate,
): Promise<LocalHttpsServer> {
  return await serve({
    host: canUse127002 ? "127.0.0.2" : "127.0.0.1",
    certificate,
  });
}

// The server's URL under `host`, pinned to the server's address.
function targetOf(
  server: LocalHttpsServer,
  host: string = HOST,
): WebhookTarget {
  return {
    url: new globalThis.URL(`https://${host}:${server.port}/hook`),
    addresses: [{ address: server.host, family: 4 }],
  };
}

interface Outcome {
  status?: number | undefined;
  // The code a refused request failed with.
  code?: string | undefined;
}

async function send(
  server: LocalHttpsServer,
  data?: { tls?: TargetTlsOptions | undefined; host?: string | undefined },
): Promise<Outcome> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.send<JSONObject>(targetOf(server, data?.host), {
        method: HTTPMethod.POST,
        data: { via: "webhook" },
        timeout: 10000,
        tls: data?.tls,
      });

    return { status: response.statusCode };
  } catch (error) {
    return { code: getRequestErrorCode(error) };
  }
}

describe("a webhook whose server signed its own certificate", () => {
  test("with no settings, is refused before anything is sent", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(await send(server)).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(server.isUntouched).toBe(true);
  });

  test("with the checks off (rejectUnauthorized false), goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(await send(server, { tls: { rejectUnauthorized: false } })).toEqual(
      { status: 200 },
    );
    expect(server.requests).toEqual([
      { method: "POST", url: "/hook", host: `${HOST}:${server.port}` },
    ]);
  });

  test("with its own certificate as the CA certificate, goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(
      await send(server, {
        tls: { ca: certificates.selfSigned.certificate },
      }),
    ).toEqual({ status: 200 });
  });

  test("with a certificate of another key as the CA certificate, is refused", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(
      await send(server, {
        tls: { ca: certificates.otherSelfSigned.certificate },
      }),
    ).toEqual({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    expect(server.isUntouched).toBe(true);
  });
});

describe("a webhook whose server's certificate a private CA signed", () => {
  test("is refused without the CA, and goes through with it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(await send(server)).toEqual({
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    expect(
      await send(server, { tls: { ca: certificates.caCertificate } }),
    ).toEqual({ status: 200 });
    expect(server.requests).toHaveLength(1);
  });

  test("with its CA, still refuses a certificate that is not for the URL's host", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(
      await send(server, {
        tls: { ca: certificates.caCertificate },
        host: OTHER_HOST,
      }),
    ).toEqual({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(server.isUntouched).toBe(true);
  });

  test("with the checks off, takes a certificate for another host too: why the CA certificate is the safer way", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(
      await send(server, {
        tls: { rejectUnauthorized: false },
        host: OTHER_HOST,
      }),
    ).toEqual({ status: 200 });
  });
});

describe("only the one request", () => {
  test("the next webhook, with no settings, is checked as before", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(await send(server, { tls: { rejectUnauthorized: false } })).toEqual(
      { status: 200 },
    );
    expect(await send(server)).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(
      await send(server, {
        tls: { ca: certificates.selfSigned.certificate },
      }),
    ).toEqual({ status: 200 });
    expect(await send(server)).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(server.requests).toHaveLength(2);
  });

  test("two webhooks at once each keep their own setting", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const [skipped, checked] = await Promise.all([
      send(server, { tls: { rejectUnauthorized: false } }),
      send(server),
    ]);

    expect(skipped).toEqual({ status: 200 });
    expect(checked).toEqual({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
  });

  test("nothing global changes: NODE_TLS_REJECT_UNAUTHORIZED, the global agent, the default CAs", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const defaults: Array<string> = tls.getCACertificates("default");

    await send(server, { tls: { rejectUnauthorized: false } });
    await send(server, { tls: { ca: certificates.selfSigned.certificate } });

    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBeUndefined();
    expect(https.globalAgent.options.rejectUnauthorized).toBeUndefined();
    expect(https.globalAgent.options.ca).toBeUndefined();
    expect(tls.getCACertificates("default")).toEqual(defaults);
  });

  test("the settings go on that request's https agent only, which is freed after it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const built: Array<{ agents: PinnedAgents; destroyed: Array<string> }> = [];
    const realCreate: (
      target: PinnedTarget,
      options?: PinnedAgentOptions | undefined,
    ) => PinnedAgents = DataSourceEgressGuard.createPinnedAgents.bind(
      DataSourceEgressGuard,
    );

    jest
      .spyOn(DataSourceEgressGuard, "createPinnedAgents")
      .mockImplementation(
        (
          target: PinnedTarget,
          options?: PinnedAgentOptions | undefined,
        ): PinnedAgents => {
          const agents: PinnedAgents = realCreate(target, options);
          const entry: { agents: PinnedAgents; destroyed: Array<string> } = {
            agents,
            destroyed: [],
          };

          for (const kind of ["httpAgent", "httpsAgent"] as const) {
            const destroy: () => void = agents[kind].destroy.bind(agents[kind]);

            agents[kind].destroy = (): void => {
              entry.destroyed.push(kind);
              destroy();
            };
          }

          built.push(entry);
          return agents;
        },
      );

    await send(server, { tls: { rejectUnauthorized: false } });
    await send(server, { tls: { ca: certificates.selfSigned.certificate } });

    const [skips, trusts] = built as [
      { agents: PinnedAgents; destroyed: Array<string> },
      { agents: PinnedAgents; destroyed: Array<string> },
    ];

    expect(skips.agents.httpsAgent.options.rejectUnauthorized).toBe(false);
    expect(trusts.agents.httpsAgent.options.ca).toBe(
      certificates.selfSigned.certificate,
    );

    for (const entry of built) {
      const httpOptions: Record<string, unknown> = (
        entry.agents.httpAgent as unknown as {
          options: Record<string, unknown>;
        }
      ).options;

      expect(httpOptions["rejectUnauthorized"]).toBeUndefined();
      expect(httpOptions["ca"]).toBeUndefined();
      expect(entry.destroyed.sort()).toEqual(["httpAgent", "httpsAgent"]);
    }
  });
});

describe("behind an outbound proxy", () => {
  // A proxy that tunnels the webhook's name and port to the server.
  async function proxyTo(
    server: LocalHttpsServer,
    certificate?: TestCertificate | undefined,
  ): Promise<TunnellingProxy> {
    return await startProxy({
      certificate,
      route: (authority: string): TunnelEnd | null => {
        return authority === `${HOST}:${server.port}`
          ? { host: server.host, port: server.port }
          : null;
      },
    });
  }

  test("an http:// proxy: the setting reaches the server through the tunnel", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server);
    process.env["HTTPS_PROXY"] = proxy.url;

    expect(await send(server)).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(await send(server, { tls: { rejectUnauthorized: false } })).toEqual(
      { status: 200 },
    );
    expect(
      await send(server, {
        tls: { ca: certificates.selfSigned.certificate },
      }),
    ).toEqual({ status: 200 });
    expect(proxy.connects).toEqual([
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
    ]);
    expect(server.requests).toHaveLength(2);
  });

  test("an https:// proxy the process trusts: the CA certificate is the server's alone", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    trustAsDefaultCa(certificates.proxy.certificate);
    process.env["HTTPS_PROXY"] = proxy.url;

    /*
     * Had the webhook's CA certificate reached the proxy's connection, the
     * proxy's certificate - not signed by it - would have been refused.
     */
    expect(
      await send(server, {
        tls: { ca: certificates.selfSigned.certificate },
      }),
    ).toEqual({ status: 200 });
    expect(await send(server, { tls: { rejectUnauthorized: false } })).toEqual(
      { status: 200 },
    );
    expect(await send(server)).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(proxy.connects).toHaveLength(3);
    expect(server.requests).toHaveLength(2);
  });

  test("an https:// proxy nobody trusts: the checks off never loosen the proxy's connection", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    expect(await send(server, { tls: { rejectUnauthorized: false } })).toEqual(
      { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    );
    // The proxy's own certificate was refused before it was asked anything.
    expect(proxy.connects).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });
});
