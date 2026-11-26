import {
  FAKE_XAPI_PASSWORD,
  FAKE_XAPI_USERNAME,
  FakeXapiCall,
  FakeXapiHostServer,
  FakeXapiPool,
  FakeXapiSettings,
  startFakeXapiPool,
} from "./Helpers/FakeXapiPool";
import { XapiLab, buildXapiLab } from "./Helpers/XapiLab";
import { TestCertificate, makeTestCertificate } from "./Helpers/XcpNgCertificates";
import {
  POOL_PRODUCTION,
  SCRAPE_SECONDS,
  readScrapeText,
} from "./Helpers/XcpNgFixtures";
import { parseOpenMetricsText } from "../../../Utils/XcpNg/OpenMetricsText";
import XapiCollector, {
  XapiCollectorDependencies,
  resetXapiCollectorState,
  selectNewMessages,
} from "../../../Utils/XcpNg/XapiCollector";
import XcpNgOtlpBuilder from "../../../Utils/XcpNg/XcpNgOtlpBuilder";
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
  XcpNgPoolMessage,
  XcpNgXapiPoolHost,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "Common/Types/XcpNg/XcpNgXapiAccount";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

/*
 * A PROBE READING A POOL STRAIGHT FROM XAPI (#10999), over real HTTPS and
 * JSON-RPC, against a stand-in pool of three hosts that each serve their
 * own certificate (Helpers/FakeXapiPool), answering with the XAPI recording
 * of #10995's lab. What is held:
 *
 *   - a read is the series Xen Orchestra served for the same pool,
 *     datapoint for datapoint (XapiXenOrchestraParity holds the port; this
 *     holds it end to end, through the wire);
 *   - trust: the master is pinned to the certificate a person trusted, and
 *     every other host to the one the pool itself lists for it - a host
 *     whose certificate is not the one vouched for gets nothing, not even
 *     the session;
 *   - the master moves: a member's HOST_IS_SLAVE is followed only to a host
 *     the pool vouched for; a master that is down gives way to the next
 *     known host; a host answering for another pool is never read for it;
 *   - which account it is: root, a read-only AD user, or one with more;
 *   - the pool's messages, read from a watermark, each delivered once;
 *   - its HA and master, for #10997.
 */

const NOW_MS: number = SCRAPE_SECONDS[1] * 1000;
const STRANGER: TestCertificate = makeTestCertificate("not-the-host");
const OTHER_POOL: string = "0e1ec7ed-0000-4000-8000-000000000000";

let pool: FakeXapiPool;

interface OpenedTransport {
  endpoint: XcpNgEndpoint;
  trustedFingerprint: string | null;
}

let opened: Array<OpenedTransport> = [];

function host(key: string): FakeXapiHostServer {
  return pool.hosts.find((candidate: FakeXapiHostServer) => {
    return candidate.key === key;
  })!;
}

function dependencies(
  overrides?: Partial<XapiCollectorDependencies> | undefined,
): XapiCollectorDependencies {
  return {
    resolve: async (): Promise<Array<string>> => {
      return ["127.0.0.1"];
    },
    // Each host's address reaches its own stand-in, as the pool's network would.
    createTransport: (data: {
      endpoint: XcpNgEndpoint;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
      requestTimeoutInMs?: number | undefined;
    }): XcpNgTransportHandle => {
      opened.push({
        endpoint: data.endpoint,
        trustedFingerprint: data.trustedFingerprint,
      });
      const server: FakeXapiHostServer | undefined = pool.hostByAddress(
        data.endpoint.host,
      );
      return createXcpNgTransport({
        endpoint: { host: data.endpoint.host, port: server ? server.port : 1 },
        pinnedAddresses: ["127.0.0.1"],
        trustedFingerprint: data.trustedFingerprint,
        requestTimeoutInMs: 5000,
      });
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
    xcpNgConnectionId: "3e9b7f0c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    connectionName: "Production pool",
    connectionType: XcpNgConnectionType.Xapi,
    address: "https://10.0.0.11",
    trustedCertificateFingerprint: host("prod1").certificate.fingerprint256,
    collectionIntervalInMinutes: 1,
    settingsVersion: 1,
    username: FAKE_XAPI_USERNAME,
    password: FAKE_XAPI_PASSWORD,
    ...(overrides || {}),
  };
}

function testJob(
  overrides?: Partial<XcpNgConnectionTestJob>,
): XcpNgConnectionTestJob {
  return {
    xcpNgConnectionTestId: "7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b",
    connectionType: XcpNgConnectionType.Xapi,
    address: "https://10.0.0.11",
    trustedCertificateFingerprint: host("prod1").certificate.fingerprint256,
    username: FAKE_XAPI_USERNAME,
    password: FAKE_XAPI_PASSWORD,
    ...(overrides || {}),
  };
}

// What the next read starts from: the job a first read's report makes.
function nextJob(
  report: XcpNgCollectionReport,
  overrides?: Partial<XcpNgCollectionJob>,
): XcpNgCollectionJob {
  return job({
    xapiPoolId: report.xapiPoolId,
    xapiMasterAddress: report.xapiMasterAddress,
    xapiPoolHosts: report.xapiPoolHosts,
    messageWatermark: report.messageWatermark,
    ...(overrides || {}),
  });
}

async function startPool(
  settings?: Partial<FakeXapiSettings> | undefined,
): Promise<void> {
  const lab: XapiLab = buildXapiLab({
    pool: "production",
    scrape: 1,
    nowSeconds: SCRAPE_SECONDS[1],
  });
  pool = await startFakeXapiPool({ lab: lab, settings: settings });
}

function callsAt(key: string, method?: string): Array<FakeXapiCall> {
  return pool.calls.filter((call: FakeXapiCall) => {
    return call.hostKey === key && (!method || call.method === method);
  });
}

// The pool's resource, without where it was read from or what XAPI cannot give.
function comparable(resourceMetrics: JSONArray): JSONObject {
  const resource: JSONObject = JSON.parse(
    JSON.stringify(
      (resourceMetrics as Array<JSONObject>).find((entry: JSONObject) => {
        return JSON.stringify(entry["resource"]).includes(POOL_PRODUCTION);
      }),
    ),
  );
  (resource["resource"] as JSONObject)["attributes"] = (
    (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
  ).filter((attribute: JSONObject) => {
    return !["server.address", "server.port"].includes(
      String(attribute["key"]),
    );
  });
  const scope: JSONObject = (resource["scopeMetrics"] as Array<JSONObject>)[0]!;
  scope["metrics"] = (scope["metrics"] as Array<JSONObject>).filter(
    (metric: JSONObject) => {
      return metric["name"] !== "xcp_vm_power_consumption_watts";
    },
  );
  return resource;
}

beforeEach(async () => {
  resetXapiCollectorState();
  opened = [];
  await startPool();
});

afterEach(async () => {
  // The password is never in a report, a URL or a call anybody records.
  for (const request of pool.requests) {
    expect(request).not.toContain(FAKE_XAPI_PASSWORD);
  }
  await pool.close();
});

describe("XapiCollector.collect", () => {
  it("reads the pool through its master into the very series Xen Orchestra served for it", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.errorMessage).toBeUndefined();
    expect(report.status).toBe("Succeeded");
    expect(report.resourceMetrics).toHaveLength(1);

    const throughXenOrchestra: JSONArray = XcpNgOtlpBuilder.build({
      samples: parseOpenMetricsText(readScrapeText(1)).samples,
      scrapeTimeMs: NOW_MS,
      target: { host: "xo.example.test", port: 443 },
      scopeVersion: "test",
    }).resourceMetrics;

    expect(comparable(report.resourceMetrics!)).toEqual(
      comparable(throughXenOrchestra),
    );
    expect(JSON.stringify(report)).not.toContain(FAKE_XAPI_PASSWORD);
  });

  it("says what it reached: the pool, its master, XCP-ng's version and the account", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.summary).toMatchObject({
      connectionType: XcpNgConnectionType.Xapi,
      masterAddress: "10.0.0.11",
      masterHostName: "xcp-prod-01",
      productName: "XCP-ng",
      productVersion: "8.3.0",
      xapiVersion: "24.39",
      account: {
        kind: XcpNgXapiAccountKind.Root,
        name: FAKE_XAPI_USERNAME,
        roles: [],
      },
    });
    expect(report.summary?.pools).toEqual([
      expect.objectContaining({
        poolId: POOL_PRODUCTION,
        poolName: "Production",
        hostCount: 3,
      }),
    ]);
  });

  it("keeps what the next read starts from: the pool, its master and each host's certificate", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.xapiPoolId).toBe(POOL_PRODUCTION);
    expect(report.xapiMasterAddress).toBe("https://10.0.0.11");
    expect(
      report.xapiPoolHosts?.map((poolHost: XcpNgXapiPoolHost) => {
        return [
          poolHost.address,
          poolHost.certificateFingerprint,
          poolHost.isMaster,
        ];
      }),
    ).toEqual(
      expect.arrayContaining([
        ["10.0.0.11", host("prod1").certificate.fingerprint256, true],
        ["10.0.0.12", host("prod2").certificate.fingerprint256, false],
        ["10.0.0.13", host("prod3").certificate.fingerprint256, false],
      ]),
    );
  });

  it("says the pool's HA and its master, for the HA overview (#10997)", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.poolStates).toEqual([
      {
        poolId: POOL_PRODUCTION,
        haEnabled: true,
        haHostFailuresToTolerate: 1,
        haPlanExistsFor: 0,
        haOvercommitted: true,
        masterHostUuid: host("prod1").uuid,
      },
    ]);
  });

  it("reads each running host's metrics from the host itself, pinned to the certificate the pool lists for it", async () => {
    await XapiCollector.collect(job(), dependencies());

    // The master over the login's connection; the other running host on its own.
    expect(pool.requests).toContain("prod1 GET /rrd_updates");
    expect(pool.requests).toContain("prod2 GET /rrd_updates");
    // A halted host is not asked.
    expect(pool.requests).not.toContain("prod3 GET /rrd_updates");

    expect(
      opened.find((transport: OpenedTransport) => {
        return transport.endpoint.host === "10.0.0.12";
      })?.trustedFingerprint,
    ).toBe(host("prod2").certificate.fingerprint256);
    // The password went to the master only.
    expect(callsAt("prod2", "session.login_with_password")).toEqual([]);
  });

  it("only ever reads, and logs out", async () => {
    await XapiCollector.collect(job(), dependencies());

    for (const call of pool.calls) {
      expect(call.method).toMatch(
        /^(session\.(login_with_password|logout|get_is_local_superuser|get_subject|get_auth_user_name)|[A-Za-z_]+\.get_all_records|host\.get_servertime|message\.get_since|subject\.get_roles|role\.get_name_label)$/,
      );
    }
    expect(callsAt("prod1", "session.logout")).toHaveLength(1);
  });

  it("sends a host nothing - not even the session - when its certificate is not the one the pool vouched for", async () => {
    pool.settings.vouchedFingerprints = {
      prod2: STRANGER.fingerprint256,
    };

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(pool.requests).not.toContain("prod2 GET /rrd_updates");
    expect(report.summary?.warnings.join(" ")).toContain("xcp-prod-02");
  });

  it("reads only the master's metrics from a pool that lists no host certificates", async () => {
    pool.settings.listCertificates = false;

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(pool.requests).toContain("prod1 GET /rrd_updates");
    expect(pool.requests).not.toContain("prod2 GET /rrd_updates");
    expect(report.summary?.warnings.join(" ")).toContain("certificate");
  });

  it("tells the first read of a pool member where its master is, and sends the master nothing", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job({
        address: "https://10.0.0.12",
        trustedCertificateFingerprint: host("prod2").certificate.fingerprint256,
      }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NotPoolMaster);
    expect(report.errorMessage).toContain("10.0.0.11");
    expect(callsAt("prod1")).toEqual([]);
  });

  it("follows the master to another host after a failover, to the certificate the pool vouched for", async () => {
    const first: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );
    pool.settings.masterKey = "prod2";

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      nextJob(first),
      dependencies(),
    );

    expect(report.errorMessage).toBeUndefined();
    expect(report.status).toBe("Succeeded");
    expect(report.xapiMasterAddress).toBe("https://10.0.0.12");
    expect(report.summary?.masterHostName).toBe("xcp-prod-02");
    expect(callsAt("prod2", "session.login_with_password")).toHaveLength(1);
  });

  it("tries the pool's other known hosts when the master is down", async () => {
    const first: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );
    pool.settings.downHosts = ["prod1"];
    pool.settings.masterKey = "prod2";

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      nextJob(first),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.xapiMasterAddress).toBe("https://10.0.0.12");
    // The host that is down is left out of the metrics, and said so.
    expect(report.summary?.warnings.join(" ")).toContain("xcp-prod-01");
  });

  it("never reads a host that answers for another pool in this one's place", async () => {
    pool.settings.answersForPool = { prod1: OTHER_POOL };

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job({ xapiPoolId: POOL_PRODUCTION }),
      dependencies(),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NotPoolMaster);
    expect(report.resourceMetrics).toBeUndefined();
  });

  it("says the login is wrong, without the password", async () => {
    pool.settings.password = "another-password";

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.InvalidLogin);
    expect(report.errorMessage).not.toContain(FAKE_XAPI_PASSWORD);
  });

  it("says when the account may not read the pool", async () => {
    pool.settings.deniedMethods = ["VM.get_all_records"];

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NoPermission);
  });

  it("sends nothing to a certificate nobody trusted, and says which one it was", async () => {
    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job({ trustedCertificateFingerprint: undefined }),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.UntrustedCertificate);
    expect(report.presentedCertificate?.fingerprint256).toBe(
      host("prod1").certificate.fingerprint256,
    );
    expect(pool.requests).toEqual([]);
  });

  it("tells a web server from XAPI", async () => {
    pool.settings.notXapiHosts = ["prod1"];

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NotXapi);
  });

  it("names a read-only Active Directory user as read-only", async () => {
    pool.settings.username = "EXAMPLE\\oneuptime";
    pool.settings.account = {
      isLocalSuperuser: false,
      authUserName: "EXAMPLE\\oneuptime",
      roles: ["read-only"],
    };

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job({ username: "EXAMPLE\\oneuptime" }),
      dependencies(),
    );

    expect(report.summary?.account).toEqual({
      kind: XcpNgXapiAccountKind.ReadOnly,
      name: "EXAMPLE\\oneuptime",
      roles: ["read-only"],
    });
  });

  it("names a user with a role that changes the pool as able to", async () => {
    pool.settings.username = "EXAMPLE\\ops";
    pool.settings.account = {
      isLocalSuperuser: false,
      authUserName: "EXAMPLE\\ops",
      roles: ["read-only", "pool-operator"],
    };

    const report: XcpNgCollectionReport = await XapiCollector.collect(
      job({ username: "EXAMPLE\\ops" }),
      dependencies(),
    );

    expect(report.summary?.account?.kind).toBe(XcpNgXapiAccountKind.Elevated);
    expect(report.summary?.account?.roles).toEqual([
      "read-only",
      "pool-operator",
    ]);
  });

  it("starts reading messages at the master's clock, and delivers each new one once", async () => {
    pool.settings.serverTime = "20261118T07:06:40Z";
    pool.settings.messages = [
      {
        uuid: "a0000000-0000-4000-8000-000000000001",
        name: "VM_STARTED",
        priority: "5",
        cls: "VM",
        obj_uuid: "",
        timestamp: "20261118T07:00:00Z",
        body: "before OneUptime read the pool",
      },
    ];

    const first: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );

    // Its history is not delivered: only what comes after it was connected.
    expect(first.messages).toEqual([]);
    expect(first.messageWatermark).toEqual({
      readUntil: "2026-11-18T07:06:40.000Z",
      uuidsAtReadUntil: [],
    });

    pool.settings.messages.push(
      {
        uuid: "a0000000-0000-4000-8000-000000000002",
        name: "VM_CRASHED",
        priority: "2",
        cls: "VM",
        obj_uuid: "b0000000-0000-4000-8000-000000000001",
        timestamp: "20261118T07:07:10Z",
        body: "x".repeat(2500),
      },
      {
        uuid: "a0000000-0000-4000-8000-000000000003",
        name: "HA_HOST_FAILED",
        priority: "1",
        cls: "Host",
        obj_uuid: host("prod3").uuid,
        timestamp: "20261118T07:07:10Z",
        body: "",
      },
    );

    const second: XcpNgCollectionReport = await XapiCollector.collect(
      nextJob(first),
      dependencies(),
    );

    expect(
      second.messages?.map((message: XcpNgPoolMessage) => {
        return [message.name, message.priority, message.objectClass];
      }),
    ).toEqual([
      ["VM_CRASHED", 2, "VM"],
      ["HA_HOST_FAILED", 1, "Host"],
    ]);
    expect(second.messages?.[0]?.poolId).toBe(POOL_PRODUCTION);
    expect(second.messages?.[0]?.timestamp).toBe("2026-11-18T07:07:10.000Z");
    // A long body is cut, never sent whole.
    expect(second.messages?.[0]?.body.length).toBe(2000);
    expect(second.messageWatermark?.readUntil).toBe("2026-11-18T07:07:10.000Z");

    // The same second again: only the one not delivered yet.
    pool.settings.messages.push({
      uuid: "a0000000-0000-4000-8000-000000000004",
      name: "ALARM",
      priority: "3",
      cls: "Host",
      obj_uuid: host("prod1").uuid,
      timestamp: "20261118T07:07:10Z",
      body: "value: 0.95\nconfig: cpu_usage",
    });

    const third: XcpNgCollectionReport = await XapiCollector.collect(
      nextJob(second),
      dependencies(),
    );

    expect(
      third.messages?.map((message: XcpNgPoolMessage) => {
        return message.uuid;
      }),
    ).toEqual(["a0000000-0000-4000-8000-000000000004"]);
  });

  it("keeps where message reading stood when the messages could not be read", async () => {
    const first: XcpNgCollectionReport = await XapiCollector.collect(
      job(),
      dependencies(),
    );
    pool.settings.deniedMethods = ["message.get_since"];

    const second: XcpNgCollectionReport = await XapiCollector.collect(
      nextJob(first),
      dependencies(),
    );

    expect(second.status).toBe("Succeeded");
    expect(second.messages).toEqual([]);
    expect(second.messageWatermark).toEqual(first.messageWatermark);
    expect(second.summary?.warnings.join(" ")).toContain("messages");
  });
});

describe("XapiCollector.test", () => {
  it("logs in at the address entered and says what the account can read", async () => {
    const report: XcpNgConnectionTestReport = await XapiCollector.test(
      testJob(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary?.account?.kind).toBe(XcpNgXapiAccountKind.Root);
    expect(report.summary?.productName).toBe("XCP-ng");
    expect(report.summary?.pools[0]).toMatchObject({
      poolId: POOL_PRODUCTION,
      hostCount: 3,
    });
    // A test reads no host's metrics.
    expect(
      pool.requests.some((request: string) => {
        return request.includes("/rrd_updates");
      }),
    ).toBe(false);
  });

  it("at a pool member, says where the master is", async () => {
    const report: XcpNgConnectionTestReport = await XapiCollector.test(
      testJob({
        address: "https://10.0.0.13",
        trustedCertificateFingerprint: host("prod3").certificate.fingerprint256,
      }),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.NotPoolMaster);
    expect(report.errorMessage).toContain("10.0.0.11");
  });

  it("shows the master's certificate to be trusted", async () => {
    const report: XcpNgConnectionTestReport = await XapiCollector.test(
      testJob({ trustedCertificateFingerprint: undefined }),
      dependencies(),
    );

    expect(report.errorCode).toBe(XcpNgCollectionErrorCode.UntrustedCertificate);
    expect(report.presentedCertificate?.fingerprint256).toBe(
      host("prod1").certificate.fingerprint256,
    );
  });

  it("warns of hosts the pool lists no certificate for", async () => {
    pool.settings.listCertificates = false;

    const report: XcpNgConnectionTestReport = await XapiCollector.test(
      testJob(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary?.warnings.join(" ")).toContain("xcp-prod-02");
  });
});

describe("selectNewMessages", () => {
  const message: (uuid: string, timestamp: string) => XcpNgPoolMessage = (
    uuid: string,
    timestamp: string,
  ): XcpNgPoolMessage => {
    return {
      uuid,
      poolId: POOL_PRODUCTION,
      name: "VM_CRASHED",
      priority: 2,
      objectClass: "VM",
      objectUuid: "",
      timestamp,
      body: "",
    };
  };

  it("delivers the oldest first, at most the cap, and moves the watermark to the newest delivered", () => {
    const result: ReturnType<typeof selectNewMessages> = selectNewMessages({
      watermark: { readUntil: "2026-11-18T07:00:00.000Z", uuidsAtReadUntil: [] },
      received: [
        message("c", "2026-11-18T07:00:03.000Z"),
        message("a", "2026-11-18T07:00:01.000Z"),
        message("b", "2026-11-18T07:00:02.000Z"),
      ],
      max: 2,
    });

    expect(
      result.messages.map((entry: XcpNgPoolMessage) => {
        return entry.uuid;
      }),
    ).toEqual(["a", "b"]);
    // The third is read next time, from where these stopped.
    expect(result.watermark).toEqual({
      readUntil: "2026-11-18T07:00:02.000Z",
      uuidsAtReadUntil: ["b"],
    });
  });

  it("never delivers one of the watermark's own second twice", () => {
    const result: ReturnType<typeof selectNewMessages> = selectNewMessages({
      watermark: {
        readUntil: "2026-11-18T07:00:02.000Z",
        uuidsAtReadUntil: ["b"],
      },
      received: [
        message("a", "2026-11-18T07:00:01.000Z"),
        message("b", "2026-11-18T07:00:02.000Z"),
        message("d", "2026-11-18T07:00:02.000Z"),
      ],
    });

    expect(
      result.messages.map((entry: XcpNgPoolMessage) => {
        return entry.uuid;
      }),
    ).toEqual(["d"]);
    expect(result.watermark.uuidsAtReadUntil.sort()).toEqual(["b", "d"]);
  });

  it("keeps the watermark when nothing is new", () => {
    const watermark: { readUntil: string; uuidsAtReadUntil: Array<string> } = {
      readUntil: "2026-11-18T07:00:02.000Z",
      uuidsAtReadUntil: ["b"],
    };

    expect(
      selectNewMessages({
        watermark,
        received: [message("b", "2026-11-18T07:00:02.000Z")],
      }),
    ).toEqual({ messages: [], watermark });
  });

  it("drops a message with no readable time", () => {
    expect(
      selectNewMessages({
        watermark: {
          readUntil: "2026-11-18T07:00:00.000Z",
          uuidsAtReadUntil: [],
        },
        received: [message("x", "not a time")],
      }).messages,
    ).toEqual([]);
  });
});
