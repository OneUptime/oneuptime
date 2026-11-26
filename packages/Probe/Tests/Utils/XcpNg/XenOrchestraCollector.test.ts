import {
  FAKE_XO_SECRET,
  FakeXenOrchestra,
  FakeXoRequest,
  FakeXoSettings,
  READ_ONLY_TOKEN,
  READ_ONLY_USER,
  startFakeXenOrchestra,
} from "./Helpers/FakeXenOrchestraServer";
import { TestCertificate, makeTestCertificate } from "./Helpers/XcpNgCertificates";
import {
  POOL_PRODUCTION,
  POOL_UNNAMED,
  SCRAPE_SECONDS,
  readScrapeText,
} from "./Helpers/XcpNgFixtures";
import XenOrchestraCollector, {
  XenOrchestraCollectorDependencies,
  resetXenOrchestraCollectorState,
} from "../../../Utils/XcpNg/XenOrchestraCollector";
import {
  XcpNgEndpoint,
  XcpNgTransportHandle,
  createXcpNgTransport,
} from "../../../Utils/XcpNg/XcpNgHttp";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
  XcpNgPoolSummary,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

/*
 * A PROBE READING XEN ORCHESTRA (#10996), over real HTTPS, against a
 * stand-in that answers as xo-server, its OpenMetrics plugin and its REST
 * API do (Helpers/FakeXenOrchestraServer) - with Xen Orchestra's own kind
 * of certificate: self-signed, naming no address. What is held:
 *
 *   - a read is the very scrape the XCP-ng Agent reads, turned into the
 *     same OTLP (XcpNgAgentParity holds the series themselves);
 *   - the certificate: nothing is sent to one nobody trusted, a trusted
 *     fingerprint is enough whatever name the certificate holds, and a
 *     changed one is refused - with what was presented, to trust it;
 *   - each way Xen Orchestra says no, worded as what to fix;
 *   - the secret goes only to the plugin, as its Bearer token, and the API
 *     token only to the REST API, as its cookie; neither is ever in a URL;
 *   - the API token: read-only or not, what it may read, and when it
 *     expires, checked at most hourly.
 */

const XO_CERTIFICATE: TestCertificate = makeTestCertificate("xo-server");
const ANOTHER_CERTIFICATE: TestCertificate = makeTestCertificate("xo-server");
const XO_HOST: string = "xo.example.test";
const NOW_MS: number = SCRAPE_SECONDS[1] * 1000;

let xo: FakeXenOrchestra;

interface OpenedTransport {
  endpoint: XcpNgEndpoint;
  pinnedAddresses: Array<string>;
  trustedFingerprint: string | null;
}

let opened: Array<OpenedTransport> = [];

function dependencies(
  overrides?: Partial<XenOrchestraCollectorDependencies> | undefined,
): XenOrchestraCollectorDependencies {
  return {
    // The name resolves to the stand-in, as DNS would to Xen Orchestra.
    resolve: async (): Promise<Array<string>> => {
      return ["127.0.0.1"];
    },
    createTransport: (data: {
      endpoint: XcpNgEndpoint;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
    }): XcpNgTransportHandle => {
      opened.push(data);
      return createXcpNgTransport({ ...data, requestTimeoutInMs: 5000 });
    },
    now: (): Date => {
      return new Date(NOW_MS);
    },
    scopeVersion: "test",
    ...(overrides || {}),
  };
}

function job(overrides?: Partial<XcpNgCollectionJob>): XcpNgCollectionJob {
  return {
    xcpNgConnectionId: "8f3cfbd5-2a32-4bd8-9f6a-2d6a0f5c9c01",
    connectionName: "Paris Xen Orchestra",
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: `https://${XO_HOST}:${xo.port}`,
    trustedCertificateFingerprint: XO_CERTIFICATE.fingerprint256,
    collectionIntervalInMinutes: 1,
    settingsVersion: 1,
    openMetricsSecret: FAKE_XO_SECRET,
    apiToken: READ_ONLY_TOKEN.id,
    ...(overrides || {}),
  };
}

function testJob(
  overrides?: Partial<XcpNgConnectionTestJob>,
): XcpNgConnectionTestJob {
  return {
    xcpNgConnectionTestId: "5f0ad1b6-7c8e-4f3c-9d41-0a6c1f0c2d10",
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: `https://${XO_HOST}:${xo.port}`,
    trustedCertificateFingerprint: XO_CERTIFICATE.fingerprint256,
    openMetricsSecret: FAKE_XO_SECRET,
    apiToken: READ_ONLY_TOKEN.id,
    ...(overrides || {}),
  };
}

function settle(settings: Partial<FakeXoSettings>): void {
  Object.assign(xo.settings, settings);
}

function poolIdsOf(report: { summary?: { pools: Array<XcpNgPoolSummary> } | undefined }): Array<string> {
  return (report.summary?.pools || [])
    .map((pool: XcpNgPoolSummary): string => {
      return pool.poolId;
    })
    .sort();
}

beforeAll(async () => {
  xo = await startFakeXenOrchestra({ certificate: XO_CERTIFICATE });
});

afterAll(async () => {
  await xo.close();
});

const DEFAULTS: FakeXoSettings = {} as FakeXoSettings;

beforeEach(() => {
  resetXenOrchestraCollectorState();
  opened = [];
  xo.requests.length = 0;
  if (Object.keys(DEFAULTS).length === 0) {
    Object.assign(DEFAULTS, JSON.parse(JSON.stringify(xo.settings)));
  }
  Object.assign(xo.settings, JSON.parse(JSON.stringify(DEFAULTS)));
});

afterEach(() => {
  // Nothing the probe sent ever carried a secret in its address.
  for (const request of xo.requests) {
    expect(request.url).not.toContain(FAKE_XO_SECRET);
    expect(request.url).not.toContain(READ_ONLY_TOKEN.id);
  }
});

describe("XenOrchestraCollector.collect", () => {
  it("reads the plugin's scrape into one OTLP resource per pool, as the agent's collector does", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.errorCode).toBeUndefined();
    expect(report.summary?.connectionType).toBe(XcpNgConnectionType.XenOrchestra);
    expect(poolIdsOf(report)).toEqual([POOL_PRODUCTION, POOL_UNNAMED].sort());
    expect(report.resourceMetrics).toHaveLength(2);
    expect(report.summary?.resourceCount).toBe(2);
    expect(report.summary?.datapointCount).toBeGreaterThan(100);

    // Where it was read from, as the agent's prometheus receiver says it.
    const attributes: Array<JSONObject> = (
      (report.resourceMetrics![0] as JSONObject)["resource"] as JSONObject
    )["attributes"] as Array<JSONObject>;
    expect(
      attributes.find((attribute: JSONObject) => {
        return attribute["key"] === "server.address";
      })?.["value"],
    ).toEqual({ stringValue: XO_HOST });

    // The production pool's counts, as Xen Orchestra reports them.
    const production: XcpNgPoolSummary | undefined = report.summary?.pools.find(
      (pool: XcpNgPoolSummary) => {
        return pool.poolId === POOL_PRODUCTION;
      },
    );
    expect(production?.poolName).toBe("Production");
    expect(production?.hostCount).toBe(3);
  });

  it("sends the secret only to the plugin, as its Bearer token, and the API token only to the REST API, as its cookie", async () => {
    await XenOrchestraCollector.collect(job(), dependencies());

    const metrics: Array<FakeXoRequest> = xo.requests.filter(
      (request: FakeXoRequest) => {
        return request.url.startsWith("/openmetrics/");
      },
    );
    const rest: Array<FakeXoRequest> = xo.requests.filter(
      (request: FakeXoRequest) => {
        return request.url.startsWith("/rest/v0/");
      },
    );

    expect(metrics.length).toBeGreaterThan(0);
    expect(rest.length).toBeGreaterThan(0);

    for (const request of metrics) {
      expect(request.authorization).toBe(`Bearer ${FAKE_XO_SECRET}`);
      expect(request.cookie || "").not.toContain(READ_ONLY_TOKEN.id);
    }

    for (const request of rest) {
      expect(request.authorization || "").not.toContain(FAKE_XO_SECRET);
      expect(request.cookie).toBe(`authenticationToken=${READ_ONLY_TOKEN.id}`);
      // Reads only.
      expect(request.method).toBe("GET");
    }
  });

  it("reports the API token's user, its expiry and what it may read - never the token", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.summary?.apiToken).toEqual({
      userName: READ_ONLY_USER.name,
      expiresAt: new Date(READ_ONLY_TOKEN.expiration).toISOString(),
      isReadOnly: true,
      canReadAlarms: true,
      canReadMessages: true,
      canReadBackupLogs: true,
    });
    expect(JSON.stringify(report)).not.toContain(READ_ONLY_TOKEN.id);
    expect(JSON.stringify(report)).not.toContain(FAKE_XO_SECRET);
  });

  it("checks the API token at most hourly, and again at once for new settings", async () => {
    let nowMs: number = NOW_MS;
    const deps: XenOrchestraCollectorDependencies = dependencies({
      now: (): Date => {
        return new Date(nowMs);
      },
    });
    const restReads: () => number = (): number => {
      return xo.requests.filter((request: FakeXoRequest) => {
        return request.url === "/rest/v0/users/me";
      }).length;
    };

    await XenOrchestraCollector.collect(job(), deps);
    expect(restReads()).toBe(1);

    nowMs += 30 * 60_000;
    const cached: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      deps,
    );
    expect(restReads()).toBe(1);
    // Sent again, so the server keeps its expiry.
    expect(cached.summary?.apiToken?.expiresAt).toBe(
      new Date(READ_ONLY_TOKEN.expiration).toISOString(),
    );

    await XenOrchestraCollector.collect(job({ settingsVersion: 2 }), deps);
    expect(restReads()).toBe(2);

    nowMs += 61 * 60_000;
    await XenOrchestraCollector.collect(job({ settingsVersion: 2 }), deps);
    expect(restReads()).toBe(3);
  });

  it("reads metrics without an API token, and never calls the REST API then", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ apiToken: undefined }),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary?.apiToken).toBeUndefined();
    expect(
      xo.requests.some((request: FakeXoRequest) => {
        return request.url.startsWith("/rest/");
      }),
    ).toBe(false);
  });

  it("trusts Xen Orchestra's own certificate by its fingerprint alone, though it names no address", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(opened[0]?.trustedFingerprint).toBe(XO_CERTIFICATE.fingerprint256);
    // Connected to the address the name resolved to, never re-resolved.
    expect(opened[0]?.pinnedAddresses).toEqual(["127.0.0.1"]);
    expect(opened[0]?.endpoint).toEqual({ host: XO_HOST, port: xo.port });
  });

  it("sends nothing to a certificate nobody trusted, and says which one it was", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ trustedCertificateFingerprint: undefined }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.UntrustedCertificate);
    expect(report.presentedCertificate?.fingerprint256).toBe(
      XO_CERTIFICATE.fingerprint256,
    );
    expect(report.errorMessage).toContain(XO_HOST);
    // The handshake was refused before any request: no secret left the probe.
    expect(xo.requests).toEqual([]);
  });

  it("refuses a certificate that changed since it was trusted", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({
        trustedCertificateFingerprint: ANOTHER_CERTIFICATE.fingerprint256,
      }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.CertificateChanged);
    expect(report.presentedCertificate?.fingerprint256).toBe(
      XO_CERTIFICATE.fingerprint256,
    );
    expect(xo.requests).toEqual([]);
  });

  it("says the secret is wrong when the plugin refuses it", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ openMetricsSecret: "not-the-secret" }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.WrongSecret);
  });

  it("says the plugin is not loaded when Xen Orchestra cannot proxy to it", async () => {
    settle({ plugin: "off" });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.PluginNotLoaded);
  });

  it("says Xen Orchestra reports no pool, rather than sending nothing as a success", async () => {
    settle({ noPools: true });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NoPools);
  });

  it("tells a web page that is not Xen Orchestra's plugin from a refusal", async () => {
    settle({ notXenOrchestra: true });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NotXenOrchestra);
  });

  it("keeps the metrics when the token is not read-only, and says so as the token's problem", async () => {
    settle({
      users: [{ ...READ_ONLY_USER, permission: "admin", privileges: [] }],
    });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.resourceMetrics).toHaveLength(2);
    expect(report.summary?.apiToken?.errorCode).toBe(
      XcpNgCollectionErrorCode.TokenNotReadOnly,
    );
    expect(report.summary?.apiToken?.isReadOnly).toBe(false);
  });

  it("names a privilege that writes when a custom role has one", async () => {
    settle({
      users: [
        {
          ...READ_ONLY_USER,
          privileges: [
            ...READ_ONLY_USER.privileges,
            { action: "shutdown", resource: "vm", effect: "allow" },
          ],
        },
      ],
    });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.summary?.apiToken?.errorCode).toBe(
      XcpNgCollectionErrorCode.TokenNotReadOnly,
    );
    expect(report.summary?.apiToken?.errorMessage).toContain("vm:shutdown");
  });

  it("ignores a denied privilege when deciding what the token may do", async () => {
    settle({
      users: [
        {
          ...READ_ONLY_USER,
          privileges: [
            ...READ_ONLY_USER.privileges,
            { action: "delete", resource: "vm", effect: "deny" },
          ],
        },
      ],
    });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.summary?.apiToken?.isReadOnly).toBe(true);
    expect(report.summary?.apiToken?.errorCode).toBeUndefined();
  });

  for (const [resource, words] of [
    ["alarm", "alarms"],
    ["message", "messages"],
    ["backup-log", "backup logs"],
  ] as const) {
    it(`says a read-only token that cannot read ${words} cannot, as Xen Orchestra answers it an empty list`, async () => {
      settle({
        users: [
          {
            ...READ_ONLY_USER,
            privileges: READ_ONLY_USER.privileges.filter(
              (privilege: { resource: string }) => {
                return privilege.resource !== resource;
              },
            ),
          },
        ],
      });

      const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
        job(),
        dependencies(),
      );

      expect(report.status).toBe("Succeeded");
      expect(report.summary?.apiToken?.isReadOnly).toBe(true);
      expect(report.summary?.apiToken?.errorCode).toBe(
        XcpNgCollectionErrorCode.TokenCannotReadAlarms,
      );
      expect(report.summary?.apiToken?.errorMessage).toContain(words);
    });
  }

  it("takes a privilege on every resource (*) as reading each list", async () => {
    settle({
      users: [
        {
          ...READ_ONLY_USER,
          privileges: [{ action: "read", resource: "*", effect: "allow" }],
        },
      ],
    });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.summary?.apiToken).toMatchObject({
      isReadOnly: true,
      canReadAlarms: true,
      canReadMessages: true,
      canReadBackupLogs: true,
    });
  });

  it("says Xen Orchestra refused the token once it expired - Xen Orchestra forgets it", async () => {
    settle({ nowMs: READ_ONLY_TOKEN.expiration + 1 });

    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    // The metrics come through the secret all the same.
    expect(report.status).toBe("Succeeded");
    expect(report.summary?.apiToken?.errorCode).toBe(
      XcpNgCollectionErrorCode.TokenRejected,
    );
  });

  it("refuses an address with a path, before connecting anywhere", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ address: `https://${XO_HOST}:${xo.port}/somewhere/else` }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.InvalidAddress);
    expect(opened).toEqual([]);
  });

  it("says when nothing answers at the address", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      // A port nothing listens on.
      job({ address: `https://${XO_HOST}:1` }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect([
      XcpNgCollectionErrorCode.ConnectionRefused,
      XcpNgCollectionErrorCode.ConnectionFailed,
    ]).toContain(report.errorCode);
  });

  it("refuses a read larger than one upload takes", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies({ maxPayloadBytes: 1000 }),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.PayloadTooLarge);
  });

  it("marks a series Xen Orchestra stopped serving stale on the next read", async () => {
    // The second read leaves out the unnamed pool's untimed connection series.
    const first: string = readScrapeText(1);
    const second: string = first
      .split("\n")
      .filter((line: string) => {
        return !(
          line.startsWith("xcp_pool_connected") && line.includes(POOL_UNNAMED)
        );
      })
      .join("\n");
    settle({ scrapes: [first, second] });

    await XenOrchestraCollector.collect(job(), dependencies());
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    const text: string = JSON.stringify(report.resourceMetrics);
    // flags 1: the OTLP "no recorded value" marker, as the receiver sends it.
    expect(text).toContain('"flags":1');
  });
});

describe("XenOrchestraCollector.test", () => {
  it("says what it reads: the pools, and the token's expiry and reach", async () => {
    const report: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(poolIdsOf(report)).toEqual([POOL_PRODUCTION, POOL_UNNAMED].sort());
    expect(report.summary?.apiToken?.isReadOnly).toBe(true);
    expect(report.summary?.apiToken?.expiresAt).toBe(
      new Date(READ_ONLY_TOKEN.expiration).toISOString(),
    );
  });

  it("fails on a token that is not read-only: OneUptime holds only read-only ones", async () => {
    settle({
      users: [{ ...READ_ONLY_USER, permission: "admin", privileges: [] }],
    });

    const report: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob(),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.TokenNotReadOnly);
    // What it saw before the token still shows.
    expect(report.summary?.pools.length).toBe(2);
  });

  it("tells an unloaded plugin from one this Xen Orchestra does not have, with a token", async () => {
    settle({ plugin: "off", pluginState: "missing" });
    const missing: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob(),
      dependencies(),
    );
    expect(missing.errorCode).toBe(XcpNgCollectionErrorCode.PluginUnavailable);

    settle({ plugin: "off", pluginState: "not-loaded" });
    const notLoaded: XcpNgConnectionTestReport =
      await XenOrchestraCollector.test(testJob(), dependencies());
    expect(notLoaded.errorCode).toBe(XcpNgCollectionErrorCode.PluginNotLoaded);
    expect(notLoaded.errorMessage).toContain("Auto-load");
  });

  it("says the plugin is not loaded without a token to tell more", async () => {
    settle({ plugin: "off", pluginState: "missing" });

    const report: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob({ apiToken: undefined }),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.PluginNotLoaded);
  });

  it("succeeds without a token, and says what a token would add", async () => {
    const report: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob({ apiToken: undefined }),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary?.warnings.join(" ")).toContain("No API token");
  });

  it("shows the certificate presented, to be trusted from the test", async () => {
    const report: XcpNgConnectionTestReport = await XenOrchestraCollector.test(
      testJob({ trustedCertificateFingerprint: undefined }),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.UntrustedCertificate);
    expect(report.presentedCertificate?.fingerprint256).toBe(
      XO_CERTIFICATE.fingerprint256,
    );
    expect(xo.requests).toEqual([]);
  });
});
