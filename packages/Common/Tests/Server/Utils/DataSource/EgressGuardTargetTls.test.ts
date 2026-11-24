/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import DataSourceEgressGuard, {
  PinnedAgents,
  ResolvedAddress,
  TargetTlsOptions,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import {
  approveOnLoopback,
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
} from "../../TestingUtils/OutboundProxyFixture";
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
} from "../../TestingUtils/SelfSignedHttpsFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
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
import https from "https";
import tls from "tls";

jest.mock("../../../../Server/Utils/Logger");

/*
 * HOW A REQUEST CHECKS ITS TARGET'S CERTIFICATE, FOR THAT REQUEST ONLY
 * (TargetTlsOptions, issue #10277).
 *
 * A Runbook HTTP step may skip the checks of the server's certificate, or
 * trust a CA certificate of its own. The egress guard puts that on the https
 * agent it builds for that one request (createPinnedAgentsForNodeHttp), and
 * nowhere else:
 *
 *   - directly, the agent's TLS connection to the target checks as told;
 *   - through an http:// outbound proxy, so does the TLS connection inside
 *     the CONNECT tunnel;
 *   - through an https:// outbound proxy, the connection to the proxy keeps
 *     the CAs the process trusts: a CA certificate of the step's never
 *     replaces them there, and skipping the target's checks never skips the
 *     proxy's;
 *   - the http agent carries none of it, an unset TargetTlsOptions leaves the
 *     agent as every request's, and nothing global changes.
 *
 * Real HTTPS servers and proxies on loopback (SelfSignedHttpsFixture), at a
 * made-up name only the guard's check knows (approveOnLoopback).
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();
useDefaultCaRestored();

const { serve, proxy: startProxy } = useSelfSignedHttps();

const HOST: string = "egress-tls.example.test";
const OTHER_HOST: string = "egress-tls-other.example.test";

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
  const server: LocalHttpsServer = await serve({
    host: canUse127002 ? "127.0.0.2" : "127.0.0.1",
    certificate,
  });

  approveOnLoopback({ [HOST]: [server.host], [OTHER_HOST]: [server.host] });

  return server;
}

interface Outcome {
  // The answer's status, when there was one.
  status?: number | undefined;
  // The error's code, when there was none.
  code?: string | undefined;
}

// One GET of `url` on the agents the guard builds for it with `targetTls`.
async function get(
  url: string,
  targetTls?: TargetTlsOptions | undefined,
): Promise<Outcome> {
  const pinned: { url: URL; addresses: Array<ResolvedAddress> } & PinnedAgents =
    await DataSourceEgressGuard.assertUrlAllowedAndPinForNodeHttp(
      url,
      { targetLabel: "Test request" },
      targetTls,
    );

  try {
    return await new Promise<Outcome>((resolve: (outcome: Outcome) => void) => {
      const request: http.ClientRequest = (
        pinned.url.protocol === "https:" ? https : http
      ).request(
        pinned.url,
        {
          method: "GET",
          agent:
            pinned.url.protocol === "https:"
              ? pinned.httpsAgent
              : pinned.httpAgent,
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve({ status: response.statusCode });
          });
        },
      );

      request.on("error", (error: NodeJS.ErrnoException) => {
        resolve({ code: error.code });
      });
      request.end();
    });
  } finally {
    pinned.httpAgent.destroy();
    pinned.httpsAgent.destroy();
  }
}

function urlOf(server: LocalHttpsServer, host: string = HOST): string {
  return `https://${host}:${server.port}/health`;
}

const SKIP: TargetTlsOptions = { rejectUnauthorized: false };

describe("a request straight to the target", () => {
  test("is checked as every request's when told nothing", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(await get(urlOf(server))).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(await get(urlOf(server), {})).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(
      await get(urlOf(server), { rejectUnauthorized: true, ca: [] }),
    ).toEqual({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    expect(server.isUntouched).toBe(true);
  });

  test("takes any certificate, for any host, when told not to check", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(await get(urlOf(server), SKIP)).toEqual({ status: 200 });
    expect(await get(urlOf(server, OTHER_HOST), SKIP)).toEqual({
      status: 200,
    });
  });

  test("trusts the CA certificate it is given, and that alone", async () => {
    const signed: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(
      await get(urlOf(signed), { ca: certificates.caCertificate }),
    ).toEqual({ status: 200 });
    expect(
      await get(urlOf(signed), { ca: [certificates.caCertificate] }),
    ).toEqual({ status: 200 });
    expect(
      await get(urlOf(signed), {
        ca: certificates.otherSelfSigned.certificate,
      }),
    ).toEqual({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  });

  test("with a CA certificate, still checks the host name", async () => {
    const signed: LocalHttpsServer = await serverWith(certificates.caSigned);

    expect(
      await get(urlOf(signed, OTHER_HOST), { ca: certificates.caCertificate }),
    ).toEqual({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(signed.isUntouched).toBe(true);
  });

  test("takes a self-signed certificate as its own CA", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    expect(
      await get(urlOf(server), { ca: certificates.selfSigned.certificate }),
    ).toEqual({ status: 200 });
  });
});

describe("the agents built", () => {
  const TARGET: { url: URL; addresses: Array<ResolvedAddress> } = {
    url: new URL("https://egress-tls.example.test/health"),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  };

  test("carry the setting on the https agent only", () => {
    const agents: PinnedAgents =
      DataSourceEgressGuard.createPinnedAgentsForNodeHttp(TARGET, {
        rejectUnauthorized: false,
        ca: "PEM",
      });

    try {
      expect(agents.httpsAgent.options.rejectUnauthorized).toBe(false);
      expect(agents.httpsAgent.options.ca).toBe("PEM");

      // An http.Agent's options are not in its type: they are at run time.
      const httpOptions: Record<string, unknown> = (
        agents.httpAgent as unknown as { options: Record<string, unknown> }
      ).options;

      expect(httpOptions["rejectUnauthorized"]).toBeUndefined();
      expect(httpOptions["ca"]).toBeUndefined();
    } finally {
      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    }
  });

  test("set nothing for what they are not told, nor for a check left on", () => {
    for (const targetTls of [
      undefined,
      {},
      { rejectUnauthorized: true },
      { ca: "" },
      { ca: "   " },
      { ca: [] },
    ] as Array<TargetTlsOptions | undefined>) {
      const agents: PinnedAgents =
        DataSourceEgressGuard.createPinnedAgentsForNodeHttp(TARGET, targetTls);

      try {
        expect({
          targetTls,
          keys: Object.keys(agents.httpsAgent.options).filter(
            (key: string): boolean => {
              return key === "rejectUnauthorized" || key === "ca";
            },
          ),
        }).toEqual({ targetTls, keys: [] });
      } finally {
        agents.httpAgent.destroy();
        agents.httpsAgent.destroy();
      }
    }
  });

  test("change nothing global", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const defaults: Array<string> = tls.getCACertificates("default");

    await get(urlOf(server), SKIP);
    await get(urlOf(server), { ca: certificates.selfSigned.certificate });

    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBeUndefined();
    expect(https.globalAgent.options.rejectUnauthorized).toBeUndefined();
    expect(https.globalAgent.options.ca).toBeUndefined();
    expect(tls.getCACertificates("default")).toEqual(defaults);

    // A request on agents built after them is checked as every request's.
    expect(await get(urlOf(server))).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
  });
});

describe("a request through an outbound proxy", () => {
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

  test("an http:// proxy: the setting reaches the target through the tunnel", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server);
    process.env["HTTPS_PROXY"] = proxy.url;

    expect(await get(urlOf(server))).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(await get(urlOf(server), SKIP)).toEqual({ status: 200 });
    expect(
      await get(urlOf(server), { ca: certificates.selfSigned.certificate }),
    ).toEqual({ status: 200 });
    expect(proxy.connects).toEqual([
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
      `${HOST}:${server.port}`,
    ]);
    expect(server.requests).toHaveLength(2);
  });

  test("an https:// proxy the process trusts keeps its CAs: the target's CA certificate is the target's alone", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    trustAsDefaultCa(certificates.proxy.certificate);
    process.env["HTTPS_PROXY"] = proxy.url;

    expect(
      await get(urlOf(server), { ca: certificates.selfSigned.certificate }),
    ).toEqual({ status: 200 });
    expect(await get(urlOf(server), SKIP)).toEqual({ status: 200 });
    expect(await get(urlOf(server))).toEqual({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(proxy.connects).toHaveLength(3);
  });

  test("an https:// proxy nobody trusts is refused, whatever the target's setting", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    for (const targetTls of [
      SKIP,
      { ca: certificates.selfSigned.certificate },
      { ca: certificates.proxy.certificate },
    ]) {
      expect(await get(urlOf(server), targetTls)).toEqual({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      });
    }

    // Refused at the proxy's own handshake: nothing was asked of it.
    expect(proxy.connects).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });
});
