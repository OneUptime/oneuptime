import {
  FAKE_XO_SECRET,
  FakeXenOrchestra,
  READ_ONLY_TOKEN,
  READ_ONLY_USER,
  startFakeXenOrchestra,
} from "./Helpers/FakeXenOrchestraServer";
import {
  TestCertificate,
  makeTestCertificate,
} from "./Helpers/XcpNgCertificates";
import { POOL_PRODUCTION, POOL_UNNAMED } from "./Helpers/XcpNgFixtures";
import XenOrchestraCollector, {
  XenOrchestraCollectorDependencies,
  resetXenOrchestraCollectorState,
} from "../../../Utils/XcpNg/XenOrchestraCollector";
import {
  XcpNgEndpoint,
  XcpNgHttpRequest,
  XcpNgHttpResponse,
  XcpNgTransportHandle,
  createXcpNgTransport,
} from "../../../Utils/XcpNg/XcpNgHttp";
import FakeXenOrchestraRest from "Common/Tests/Helpers/XcpNg/FakeXenOrchestraRest";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgEventsJobState,
  XcpNgEventsReport,
  XcpNgPoolEventsJobState,
  XcpNgPoolEventsReport,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

/*
 * A Xen Orchestra collection that reads the pools' alarms, HA, master,
 * backups and patches with its metrics (#10997): over the real HTTPS a
 * probe opens, against the stand-in of #10996 for the plugin and the token
 * check and the stand-in of #10997 for the REST API's messages, alarms,
 * pools, hosts and backups (FakeXenOrchestraRest), which answer different
 * routes of one Xen Orchestra.
 */

const XO_CERTIFICATE: TestCertificate = makeTestCertificate("xo-server");
const XO_HOST: string = "xo.example.test";
const NOW_MS: number = 1795000000 * 1000;

// The routes the events reader reads, served by #10997's stand-in.
const EVENT_ROUTES: ReadonlyArray<string> = [
  "/rest/v0/pools",
  "/rest/v0/hosts",
  "/rest/v0/messages",
  "/rest/v0/alarms",
  "/rest/v0/backup-logs",
  "/rest/v0/backup-jobs",
  "/rest/v0/schedules",
];

let xo: FakeXenOrchestra;
let rest: FakeXenOrchestraRest;

function isEventRoute(path: string): boolean {
  const pathname: string = new URL(path, "https://xo.example.test").pathname;
  return EVENT_ROUTES.some((route: string): boolean => {
    return pathname === route || pathname.startsWith(`${route}/`);
  });
}

function dependencies(): XenOrchestraCollectorDependencies {
  return {
    resolve: async (): Promise<Array<string>> => {
      return ["127.0.0.1"];
    },
    createTransport: (data: {
      endpoint: XcpNgEndpoint;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
    }): XcpNgTransportHandle => {
      const handle: XcpNgTransportHandle = createXcpNgTransport({
        ...data,
        requestTimeoutInMs: 5000,
      });
      return {
        transport: (request: XcpNgHttpRequest): Promise<XcpNgHttpResponse> => {
          return isEventRoute(request.path)
            ? rest.handle(request)
            : handle.transport(request);
        },
        close: handle.close,
      };
    },
    now: (): Date => {
      return new Date(NOW_MS);
    },
    scopeVersion: "test",
  };
}

function freshEvents(): XcpNgEventsJobState {
  return {
    pools: [POOL_PRODUCTION, POOL_UNNAMED].map(
      (poolId: string): XcpNgPoolEventsJobState => {
        return { poolId: poolId, openMessageIds: [] };
      },
    ),
    checkPatches: true,
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
    events: freshEvents(),
    ...(overrides || {}),
  };
}

beforeAll(async () => {
  xo = await startFakeXenOrchestra({ certificate: XO_CERTIFICATE });
});

afterAll(async () => {
  await xo.close();
});

beforeEach(() => {
  resetXenOrchestraCollectorState();
  xo.requests.length = 0;
  xo.settings.users = [READ_ONLY_USER];
  xo.settings.tokens = [READ_ONLY_TOKEN];
  rest = new FakeXenOrchestraRest();
  rest.token = READ_ONLY_TOKEN.id;
});

describe("a Xen Orchestra collection with the pools' events", () => {
  it("carries each pool's alarms state, HA, master, the backups and the patches with the metrics", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );

    expect(report.status).toBe("Succeeded");
    const events: XcpNgEventsReport = report.events as XcpNgEventsReport;
    expect(events.problems).toEqual({});
    expect(
      events.pools
        .map((pool: XcpNgPoolEventsReport): string => {
          return pool.poolId;
        })
        .sort(),
    ).toEqual([POOL_PRODUCTION, POOL_UNNAMED].sort());
    const production: XcpNgPoolEventsReport | undefined = events.pools.find(
      (pool: XcpNgPoolEventsReport): boolean => {
        return pool.poolId === POOL_PRODUCTION;
      },
    );
    expect(production?.poolState?.haEnabled).toBe(true);
    expect(production?.messageWatermark.readUntil).toBe(
      new Date(1794995000 * 1000).toISOString(),
    );
    expect(events.backupRuns).toHaveLength(4);
    expect(events.backupJobs?.length).toBe(4);
    expect(events.hostPatches?.length).toBe(3);

    // The token went to every events read as its cookie, never elsewhere.
    expect(rest.requests.length).toBeGreaterThan(5);
    for (const request of rest.requests) {
      expect(request.method).toBe("GET");
      expect(request.headers["Cookie"]).toBe(
        `authenticationToken=${READ_ONLY_TOKEN.id}`,
      );
      expect(request.path).not.toContain(READ_ONLY_TOKEN.id);
      expect(request.path).not.toContain(FAKE_XO_SECRET);
    }
  });

  it("reads no events for a job without their state: an older server", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ events: undefined }),
      dependencies(),
    );
    expect(report.status).toBe("Succeeded");
    expect(report.events).toBeUndefined();
    expect(rest.requests).toEqual([]);
  });

  it("reads no events without an API token: the metrics alone", async () => {
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job({ apiToken: undefined }),
      dependencies(),
    );
    expect(report.status).toBe("Succeeded");
    expect(report.events).toBeUndefined();
    expect(rest.requests).toEqual([]);
  });

  it("a token whose user could change Xen Orchestra is never used for them, and says so", async () => {
    xo.settings.users = [{ ...READ_ONLY_USER, permission: "admin" }];
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );
    expect(report.status).toBe("Succeeded");
    expect(rest.requests).toEqual([]);
    expect(report.events?.pools).toEqual([]);
    expect(report.events?.problems.messages).toContain(
      "could change Xen Orchestra",
    );
  });

  it("an events read that fails never fails the metrics", async () => {
    rest.fail({ pathPrefix: "/rest/v0/", throwMessage: "socket hang up" });
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );
    expect(report.status).toBe("Succeeded");
    expect(report.resourceMetrics?.length).toBe(2);
    expect(report.events?.pools).toEqual([]);
    expect(report.events?.problems.messages).toContain("socket hang up");
  });

  it("a warning of the events read is the collection's too", async () => {
    // Backup jobs the token may not read come back empty.
    rest.privileges.delete("backup-job");
    const report: XcpNgCollectionReport = await XenOrchestraCollector.collect(
      job(),
      dependencies(),
    );
    expect(report.events?.backupJobs).toBeUndefined();
    expect(report.events?.warnings[0]).toContain("no backup jobs");
    expect(report.summary?.warnings).toContain(report.events?.warnings[0]);
  });
});
