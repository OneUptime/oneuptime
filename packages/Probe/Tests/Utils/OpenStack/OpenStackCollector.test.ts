import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  BACKOFF_BASE_IN_MS,
  REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
} from "../../../Utils/OpenStack/OpenStackBackoff";
import OpenStackCollector, {
  MAX_COLLECTION_TIME_IN_MS,
  formatSize,
  getCollectionBudgetInMs,
  getSlowServiceIntervalInMs,
  resolveOpenStackAddress,
} from "../../../Utils/OpenStack/OpenStackCollector";
import { getOpenStackCredentialKey } from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import { OpenStackCertificateError } from "../../../Utils/OpenStack/OpenStackTls";
import {
  COLLECTED_AT_MS,
  CollectorHarness,
  FakeClock,
  ReportedDatapoint,
  SECRET,
  collectionJob,
  createCollectorHarness,
  createFakeClock,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  RECORDED_AUTH_URL,
  RECORDED_REGION,
  RecordedCloud,
  RecordedScene,
  createRecordedCloud,
  jsonAnswer,
  loadScene,
  recordedJson,
  recordedTokenBody,
} from "./Helpers/RecordedCloud";

/*
 * One whole collection against what a real cloud answered: the promises of the issue,
 * each with a test. A failing Neutron leaves Nova's data intact. A Keystone outage backs
 * off instead of hammering it. Nothing stacks, nothing runs past its budget, nothing sent
 * goes over plain HTTP, and every kind of answer ends as a report.
 */

const HEALTHY: RecordedScene = loadScene("hibiscus-ovn", "healthy");

// What failing a service looks like, by the path its URL is under.
function failingUnder(
  prefix: string,
  response: OpenStackHttpResponse,
): (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined {
  return (request: OpenStackHttpRequest) => {
    return new globalThis.URL(request.url).pathname.startsWith(prefix)
      ? response
      : undefined;
  };
}

const SERVICE_UNAVAILABLE: OpenStackHttpResponse = {
  status: 503,
  headers: {},
  body: "<html>503 Service Unavailable</html>",
};

function logins(cloud: RecordedCloud): number {
  return cloud.requests.filter((request: OpenStackHttpRequest): boolean => {
    return request.method === "POST";
  }).length;
}

function summaryOf(
  report: OpenStackCollectionReport,
  service: OpenStackServiceType,
  regionName: string = RECORDED_REGION,
): OpenStackServiceSummary | undefined {
  return report.summary?.services.find(
    (summary: OpenStackServiceSummary): boolean => {
      return summary.service === service && summary.regionName === regionName;
    },
  );
}

function pointsNamed(
  report: OpenStackCollectionReport,
  metric: string,
): Array<ReportedDatapoint> {
  return datapointsOf(report.resourceMetrics).filter(
    (point: ReportedDatapoint): boolean => {
      return point.metric === metric;
    },
  );
}

function valueOf(
  report: OpenStackCollectionReport,
  metric: string,
  labels: Record<string, string> = {},
): number | undefined {
  return pointsNamed(report, metric).find((point: ReportedDatapoint) => {
    return Object.keys(labels).every((key: string): boolean => {
      return point.labels[key] === labels[key];
    });
  })?.value;
}

describe("a healthy cloud", () => {
  test("is read, every service, and reports what it found", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report).toMatchObject({
      openStackCloudId: "cloud-1",
      settingsVersion: 7,
      collectedAt: new Date(COLLECTED_AT_MS).toISOString(),
      status: "Succeeded",
    });
    expect(report.errorCode).toBeUndefined();

    expect(report.summary).toMatchObject({
      credentialKind: "applicationCredential",
      projectName: "admin",
      roleNames: ["admin"],
      regionNames: [RECORDED_REGION],
      computeMicroversions: { [RECORDED_REGION]: "2.87" },
      instanceReadModes: { [RECORDED_REGION]: "Full" },
      hypervisorCount: 1,
      instanceCount: 4,
      networkCount: 4,
      volumeCount: 3,
    });
    expect(report.summary?.requestCount).toBe(
      cloud.requests.length - logins(cloud),
    );
    expect(report.summary?.datapointCount).toBeGreaterThan(100);

    for (const service of Object.values(OpenStackServiceType)) {
      expect(summaryOf(report, service)?.outcome).toBe("Succeeded");
    }
  });

  test("the transport is closed when it is over", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: createRecordedCloud(HEALTHY).transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(harness.transportsOpened()).toBe(1);
    expect(harness.transportsClosed()).toBe(1);
  });

  test("nothing but GETs after the login: monitoring only reads", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    const notRead: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return request.method !== "GET";
      },
    );

    expect(notRead).toHaveLength(1);
    expect(notRead[0]?.url).toContain("/v3/auth/tokens");
  });

  test("the secret goes to Keystone in that one call, and nowhere else", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    const carrying: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return JSON.stringify(request).includes(SECRET);
      },
    );

    expect(carrying).toHaveLength(1);
    expect(carrying[0]?.url).toContain("/identity/v3/auth/tokens");
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  test("it asks for nothing the agent left off, and never the routes that do harm", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    const paths: Array<string> = cloud.paths();

    // Listing every port can saturate Neutron: openstack-exporter issue 540.
    expect(
      paths.some((p: string) => {
        return p.endsWith("/ports");
      }),
    ).toBe(false);
    // Nova no longer has this route.
    expect(
      paths.some((p: string) => {
        return p.includes("os-security-groups");
      }),
    ).toBe(false);
    expect(
      paths.some((p: string) => {
        return p.endsWith("/subnetpools");
      }),
    ).toBe(false);
    expect(
      paths.some((p: string) => {
        return p.includes("os-quota-sets");
      }),
    ).toBe(false);
    expect(
      paths.some((p: string) => {
        return p.includes("os-simple-tenant-usage");
      }),
    ).toBe(false);
    // This cloud is on OVN, and has no L3 agents to ask about.
    expect(
      paths.some((p: string) => {
        return p.endsWith("/l3-agents");
      }),
    ).toBe(false);
    // No VPN extension here, so its routes are not asked to say so.
    expect(
      paths.some((p: string) => {
        return p.includes("/vpn/");
      }),
    ).toBe(false);
  });

  test("on ML2/OVS it asks each router which agents hold it, as the exporter does", async () => {
    const scene: RecordedScene = loadScene("gazpacho-ovs", "healthy");
    const cloud: RecordedCloud = createRecordedCloud(scene);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(
      cloud.paths().filter((p: string) => {
        return p.endsWith("/l3-agents");
      }).length,
    ).toBeGreaterThan(0);
    expect(
      pointsNamed(report, "openstack_neutron_l3_agent_of_router").length,
    ).toBeGreaterThan(0);
  });

  /*
   * Neutron answers a reader's agent list with a 200 and nothing. Going on to ask each
   * router which agents hold it would cost a call per router, and tell it nothing.
   */
  test("on ML2/OVS with an empty agent list, as a reader is given, it asks no router about agents", async () => {
    const scene: RecordedScene = loadScene("gazpacho-ovs", "healthy");
    const cloud: RecordedCloud = createRecordedCloud(scene, {
      answer: (
        request: OpenStackHttpRequest,
      ): OpenStackHttpResponse | undefined => {
        return new globalThis.URL(request.url).pathname.endsWith("/v2.0/agents")
          ? { status: 200, headers: {}, body: JSON.stringify({ agents: [] }) }
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(
      cloud.paths().filter((p: string) => {
        return p.endsWith("/l3-agents");
      }),
    ).toEqual([]);
    expect(pointsNamed(report, "openstack_neutron_l3_agent_of_router")).toEqual(
      [],
    );
  });

  test("every list a real cloud pages, it pages by limit and marker", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      overrides: { pageSize: 2 },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_nova_total_vms")).toBe(4);
    expect(valueOf(report, "openstack_nova_flavors")).toBeGreaterThan(2);
    expect(valueOf(report, "openstack_neutron_networks")).toBe(4);

    const pagedServers: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/servers/detail");
      },
    );

    expect(pagedServers.length).toBeGreaterThan(1);
    expect(pagedServers[0]?.url).toContain("limit=2");
    expect(pagedServers[1]?.url).toContain("marker=");
  });

  test("lists name only the fields read, and security groups only their ids", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    const securityGroups: OpenStackHttpRequest | undefined =
      cloud.requests.find((request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/security-groups");
      });

    expect(
      new globalThis.URL(securityGroups!.url).searchParams.getAll("fields"),
    ).toEqual(["id"]);
  });

  test("the compute microversion is the last that says what a hypervisor holds", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    const hypervisors: OpenStackHttpRequest | undefined = cloud.requests.find(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/os-hypervisors/detail");
      },
    );

    expect(hypervisors?.headers).toMatchObject({
      "OpenStack-API-Version": "compute 2.87",
      "X-OpenStack-Nova-API-Version": "2.87",
    });
  });

  test("a cloud past that microversion has no such numbers, and Placement still says", async () => {
    // The recording's answer at 2.88 and later, which has none of them.
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (new globalThis.URL(request.url).pathname === "/compute/") {
          return jsonAnswer(200, {
            versions: [
              {
                id: "v2.1",
                status: "CURRENT",
                version: "2.200",
                min_version: "2.90",
              },
            ],
          });
        }

        return undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.summary?.computeMicroversions).toEqual({
      [RECORDED_REGION]: "2.90",
    });
    expect(pointsNamed(report, "openstack_nova_vcpus_available")).toEqual([]);
    expect(pointsNamed(report, "openstack_nova_running_vms")).toEqual([]);
    expect(
      pointsNamed(report, "openstack_placement_resource_total").length,
    ).toBe(3);
    expect(report.status).toBe("Succeeded");
  });
});

describe("a failing Neutron leaves Nova's data intact", () => {
  async function withNeutronDown(): Promise<{
    report: OpenStackCollectionReport;
    harness: CollectorHarness;
    cloud: RecordedCloud;
  }> {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/networking/", SERVICE_UNAVAILABLE),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    return {
      cloud,
      harness,
      report: await OpenStackCollector.collect(
        collectionJob(),
        harness.dependencies,
      ),
    };
  }

  test("every series of Nova, Placement, Cinder, Glance and Keystone is there", async () => {
    const { report } = await withNeutronDown();

    expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(4);
    expect(valueOf(report, "openstack_nova_up")).toBe(1);
    expect(valueOf(report, "openstack_placement_up")).toBe(1);
    expect(valueOf(report, "openstack_cinder_up")).toBe(1);
    expect(valueOf(report, "openstack_glance_up")).toBe(1);
    expect(valueOf(report, "openstack_identity_up")).toBe(1);
    expect(pointsNamed(report, "openstack_cinder_volume_gb")).toHaveLength(3);
  });

  test("Neutron says it is down, and has nothing it did not read", async () => {
    const { report } = await withNeutronDown();

    expect(valueOf(report, "openstack_neutron_up")).toBe(0);
    expect(pointsNamed(report, "openstack_neutron_networks")).toEqual([]);
    expect(pointsNamed(report, "openstack_neutron_floating_ip")).toEqual([]);
    // It answered, with an error: `up` is about the scrape, `_up` about the API.
    expect(valueOf(report, "up", { openstack_service: "network" })).toBe(1);
  });

  test("the report says exactly that: some worked, and which did not", async () => {
    const { report } = await withNeutronDown();

    expect(report.status).toBe("PartiallySucceeded");
    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.ServiceOverloaded,
    );
    expect(report.errorMessage).toContain("Networking (Neutron) in RegionOne");
    expect(summaryOf(report, OpenStackServiceType.Network)?.outcome).toBe(
      "Failed",
    );
    expect(summaryOf(report, OpenStackServiceType.Compute)?.outcome).toBe(
      "Succeeded",
    );
  });

  test("it stopped asking Neutron after it said to, rather than asking for every list", async () => {
    const { cloud } = await withNeutronDown();

    const neutron: Array<string> = cloud.paths().filter((p: string) => {
      return p.startsWith("/networking/");
    });

    // The one read, tried three times, and none of the lists after it.
    expect(neutron).toEqual([
      "/networking/v2.0/agents",
      "/networking/v2.0/agents",
      "/networking/v2.0/agents",
    ]);
  });

  test("the next collection leaves Neutron alone, and its series keep saying down", async () => {
    const { cloud, harness } = await withNeutronDown();
    const asked: number = cloud.paths().length;

    harness.clock.advance(30_000);

    const next: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    const askedThisTime: Array<string> = cloud.paths().slice(asked);

    expect(
      askedThisTime.some((p: string) => {
        return p.startsWith("/networking/");
      }),
    ).toBe(false);
    expect(summaryOf(next, OpenStackServiceType.Network)).toMatchObject({
      outcome: "BackingOff",
      errorCode: OpenStackCollectionErrorCode.ServiceOverloaded,
    });
    expect(
      summaryOf(next, OpenStackServiceType.Network)?.backingOffUntil,
    ).toBeTruthy();
    // A series that goes away reads as recovered, and it has not.
    expect(valueOf(next, "openstack_neutron_up")).toBe(0);
    expect(valueOf(next, "up", { openstack_service: "network" })).toBe(0);
    expect(valueOf(next, "openstack_nova_up")).toBe(1);
    expect(next.status).toBe("PartiallySucceeded");
  });

  test("when Neutron is back it is read again, and all is well", async () => {
    let isDown: boolean = true;

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        return isDown
          ? failingUnder("/networking/", SERVICE_UNAVAILABLE)(request)
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    isDown = false;
    harness.clock.advance(2 * BACKOFF_BASE_IN_MS);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(valueOf(report, "openstack_neutron_up")).toBe(1);
    expect(pointsNamed(report, "openstack_neutron_network")).toHaveLength(4);
  });

  test("a real recording of Nova's API stopped: its page of HTML is a failure, and the rest are fine", async () => {
    const scene: RecordedScene = loadScene("hibiscus-ovn", "compute-api-down");
    const cloud: RecordedCloud = createRecordedCloud(scene);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("PartiallySucceeded");
    expect(valueOf(report, "openstack_nova_up")).toBe(0);
    expect(pointsNamed(report, "openstack_nova_server_status")).toEqual([]);
    expect(valueOf(report, "openstack_neutron_up")).toBe(1);
    expect(valueOf(report, "openstack_cinder_up")).toBe(1);
    expect(valueOf(report, "openstack_placement_up")).toBe(1);
    expect(
      pointsNamed(report, "openstack_neutron_network").length,
    ).toBeGreaterThan(0);
    expect(report.errorMessage).toContain("Compute (Nova) in RegionOne");
    expect(report.errorMessage).not.toContain("<html");
  });

  test("one list failing keeps the rest of that service, and stops it vouching for rows", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/networking/v2.0/floatingips", {
        status: 500,
        headers: {},
        body: JSON.stringify({ NeutronError: { message: "database is gone" } }),
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(pointsNamed(report, "openstack_neutron_network")).toHaveLength(4);
    expect(pointsNamed(report, "openstack_neutron_floating_ip")).toEqual([]);
    /*
     * The exporter reads 1 here, since only every call failing reads 0. But 1 is what
     * lets the stale-row rule delete floating IPs it has not seen.
     */
    expect(valueOf(report, "openstack_neutron_up")).toBe(0);
    expect(report.status).toBe("PartiallySucceeded");
    expect(report.errorMessage).toContain("database is gone");
    expect(summaryOf(report, OpenStackServiceType.Network)?.outcome).toBe(
      "Partial",
    );
    // One route's bug is no reason to read the rest less often.
    expect(
      summaryOf(report, OpenStackServiceType.Network)?.backingOffUntil,
    ).toBeUndefined();
  });

  test("a count nothing keeps a row of failing costs only itself", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/compute/v2.1/os-aggregates", {
        status: 500,
        headers: {},
        body: "",
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_nova_up")).toBe(1);
    expect(report.status).toBe("Succeeded");
    expect(pointsNamed(report, "openstack_nova_vcpus_used")).toHaveLength(1);
  });

  test("a service whose collector breaks takes only itself down", async () => {
    // A malformed answer deep in Neutron's own reading: not a failure anyone planned for.
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/networking/v2.0/routers", {
        status: 200,
        headers: {},
        body: JSON.stringify({ routers: [null, 7, "x"] }),
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_nova_up")).toBe(1);
    expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(4);
  });

  test("a service that never answers costs its own time and nothing of anyone else's", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (
          new globalThis.URL(request.url).pathname.startsWith("/networking/")
        ) {
          // A transport that ignores its own timeout: the backstop is what ends it.
          return new Promise<OpenStackHttpResponse>(() => {});
        }

        return undefined;
      },
    });

    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      overrides: { collectionTimeoutInMs: 20 },
    });

    jest.useFakeTimers({
      doNotFake: ["setImmediate", "nextTick", "queueMicrotask"],
    });

    try {
      const collection: Promise<OpenStackCollectionReport> =
        OpenStackCollector.collect(collectionJob(), harness.dependencies);

      // Nova and the rest finish on their own, and only the backstop is left.
      for (let i: number = 0; i < 200; i++) {
        await new Promise<void>((resolve: () => void) => {
          setImmediate(resolve);
        });
      }

      jest.advanceTimersByTime(10_000);

      const report: OpenStackCollectionReport = await collection;

      expect(valueOf(report, "openstack_nova_up")).toBe(1);
      expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(
        4,
      );
      expect(valueOf(report, "openstack_neutron_up")).toBe(0);
      expect(valueOf(report, "up", { openstack_service: "network" })).toBe(0);
      expect(report.status).toBe("PartiallySucceeded");
      expect(report.errorCode).toBe(OpenStackCollectionErrorCode.TimedOut);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("a Keystone outage backs off instead of hammering it", () => {
  function keystoneAnswering(status: () => number): RecordedCloud {
    return createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (request.method === "POST" && status() !== 201) {
          return {
            status: status(),
            headers: {},
            body: JSON.stringify({ error: { message: "database is gone" } }),
          };
        }

        return undefined;
      },
    });
  }

  test("a login that fails says so, and asks nobody else", async () => {
    const cloud: RecordedCloud = keystoneAnswering(() => {
      return 503;
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
    expect(report.errorMessage).toContain("database is gone");
    expect(cloud.requests).toHaveLength(1);
    expect(harness.transportsClosed()).toBe(1);
  });

  test("its series say what the agent's do, and that it is Keystone that is down", async () => {
    const cloud: RecordedCloud = keystoneAnswering(() => {
      return 503;
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_identity_up")).toBe(0);
    // Every collection comes back empty, which is how an agent's say it too.
    expect(
      pointsNamed(report, "scrape_samples_scraped").map(
        (point: ReportedDatapoint) => {
          return [point.labels["openstack_service"], point.value];
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        ["compute", 0],
        ["network", 0],
        ["volume", 0],
        ["placement", 0],
        ["image", 0],
      ]),
    );
    // And no other API is called down for it: nobody asked them.
    expect(pointsNamed(report, "openstack_nova_up")).toEqual([]);
  });

  test("the next collections ask nothing at all, and say why", async () => {
    const cloud: RecordedCloud = keystoneAnswering(() => {
      return 503;
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    harness.clock.advance(BACKOFF_BASE_IN_MS / 2);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(cloud.requests).toHaveLength(1);
    expect(harness.transportsOpened()).toBe(1);
    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
    expect(report.errorMessage).toContain("database is gone");
    expect(report.errorMessage).toContain("The probe asks again at");
    // An incident must neither close nor flap meanwhile.
    expect(valueOf(report, "openstack_identity_up")).toBe(0);
  });

  test("each failure waits about twice as long, up to half an hour", async () => {
    const cloud: RecordedCloud = keystoneAnswering(() => {
      return 503;
    });
    const clock: FakeClock = createFakeClock();
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      clock: clock,
    });

    const tries: Array<number> = [];
    const start: number = clock.now();

    // A collection every two minutes, for two hours.
    for (let minute: number = 0; minute < 120; minute += 2) {
      const before: number = cloud.requests.length;

      await OpenStackCollector.collect(collectionJob(), harness.dependencies);

      if (cloud.requests.length > before) {
        tries.push((clock.now() - start) / 60_000);
      }

      clock.advance(120_000);
    }

    /*
     * Without backing off, sixty logins. With it: 1, 2, 4, 8, 16 and then 30 minutes
     * apart, rounded up to the next collection.
     */
    expect(tries).toEqual([0, 2, 4, 8, 16, 32, 62, 92]);
    expect(tries.length).toBeLessThan(10);
  });

  test("when Keystone is back, one login and everything is read again", async () => {
    let status: number = 503;

    const cloud: RecordedCloud = keystoneAnswering(() => {
      return status;
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    status = 201;
    harness.clock.advance(2 * BACKOFF_BASE_IN_MS);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(valueOf(report, "openstack_identity_up")).toBe(1);
  });

  test("a Keystone that does not answer at all is treated the same", async () => {
    let logins: number = 0;

    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        logins++;
        throw Object.assign(new Error("connect ETIMEDOUT"), {
          code: "ETIMEDOUT",
        });
      },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.ConnectionTimedOut,
    );
    expect(valueOf(report, "openstack_identity_up")).toBe(0);

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(logins).toBe(1);
  });

  test("a refused credential waits longer than that, because repeating one locks an account", async () => {
    const cloud: RecordedCloud = keystoneAnswering(() => {
      return 401;
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.InvalidCredential,
    );
    // Keystone answered, and said no: it is not Keystone that is down.
    expect(pointsNamed(report, "openstack_identity_up")).toEqual([]);

    harness.clock.advance(REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS - 1000);
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    expect(cloud.requests).toHaveLength(1);

    harness.clock.advance(2000);
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    expect(cloud.requests).toHaveLength(2);
  });

  test("a corrected credential is tried at once: the wait was for the old one", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        return request.method === "POST" && request.body?.includes("wrong")
          ? { status: 401, headers: {}, body: "" }
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(
      collectionJob({
        credential: {
          kind: "applicationCredential",
          id: "a",
          secret: "wrong",
        },
      }),
      harness.dependencies,
    );

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({
        credential: {
          kind: "applicationCredential",
          id: "a",
          secret: "right",
        },
      }),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
  });

  test("a certificate the probe does not trust is reported with what it showed", async () => {
    const presented: {
      fingerprint256: string;
      subject: string;
      issuer: string;
      isSelfSigned: boolean;
      host: string;
      port: number;
    } = {
      fingerprint256: "AA:BB",
      subject: "CN=keystone",
      issuer: "CN=keystone",
      isSelfSigned: true,
      host: "openstack.example",
      port: 443,
    };

    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        throw new OpenStackCertificateError({
          kind: "untrusted",
          presentedCertificate: presented,
          message: "openstack.example:443's certificate is not trusted.",
        });
      },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      presentedCertificate: presented,
    });
    // Nothing says Keystone is down: nothing was asked of it.
    expect(pointsNamed(report, "openstack_identity_up")).toEqual([]);
  });
});

describe("a token is bought as seldom as it can be", () => {
  test("two collections, one login", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    harness.clock.advance(120_000);
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(logins(cloud)).toBe(1);
  });

  test("a token close to its end is replaced before it fails someone", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    // The recording's token ends at 12:48, and the margin is five minutes.
    harness.clock.advance(
      Date.parse("2026-11-04T12:44:00.000Z") - COLLECTED_AT_MS,
    );

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(logins(cloud)).toBe(2);
  });

  test("a changed secret or a newly trusted certificate never reuses the old token", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    await OpenStackCollector.collect(
      collectionJob({
        credential: {
          kind: "applicationCredential",
          id: "monitoring-credential",
          secret: "a-new-secret",
        },
      }),
      harness.dependencies,
    );
    await OpenStackCollector.collect(
      collectionJob({
        trustedCertificateFingerprints: [
          "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
        ],
      }),
      harness.dependencies,
    );

    expect(logins(cloud)).toBe(3);
  });

  test("a token revoked meanwhile costs one login, however many services notice", async () => {
    let isRevoked: boolean = false;
    let tokensMade: number = 0;

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (request.method === "POST") {
          tokensMade++;

          return jsonAnswer(201, recordedTokenBody(HEALTHY), {
            "x-subject-token": `token-${tokensMade}`,
          });
        }

        return isRevoked && request.headers["X-Auth-Token"] === "token-1"
          ? { status: 401, headers: {}, body: "" }
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    expect(logins(cloud)).toBe(1);

    isRevoked = true;
    harness.clock.advance(120_000);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    // Five services found out at once, and it took one login.
    expect(logins(cloud)).toBe(2);
    expect(report.status).toBe("Succeeded");
    expect(valueOf(report, "openstack_nova_up")).toBe(1);
    expect(valueOf(report, "openstack_neutron_up")).toBe(1);
    expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(4);

    // And the next collection starts from the new one.
    harness.clock.advance(120_000);
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    expect(logins(cloud)).toBe(2);
  });

  test("a kept token refused, and Keystone down when it is replaced: a Keystone outage, and treated as one", async () => {
    let isDown: boolean = false;

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (!isDown) {
          return undefined;
        }

        return request.method === "POST"
          ? { status: 503, headers: {}, body: "" }
          : { status: 401, headers: {}, body: "" };
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    isDown = true;
    harness.clock.advance(120_000);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(logins(cloud)).toBe(2);
    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
    expect(valueOf(report, "openstack_identity_up")).toBe(0);
    // No service is blamed for Keystone: not one of them is made to wait for it.
    expect(harness.memory.backoff.size()).toBe(1);

    harness.clock.advance(BACKOFF_BASE_IN_MS / 2);
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    expect(logins(cloud)).toBe(2);
  });

  test("a path access rules leave out is refused, and costs no login collection after collection", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/identity/v3/users", {
        status: 401,
        headers: {},
        body: "",
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const first: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(first.status).toBe("Succeeded");
    expect(valueOf(first, "openstack_identity_up")).toBe(1);
    expect(pointsNamed(first, "openstack_identity_users")).toEqual([]);

    harness.clock.advance(10 * 60_000);

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(logins(cloud)).toBe(1);
  });

  /*
   * The access rules and the policy files leave users and groups out on purpose, so every
   * credential the docs recommend meets this on every read of Keystone. A warning there
   * would send people looking for what is wrong with a cloud that is doing what it should.
   */
  test("being refused users and groups is what should happen, and warns nobody", async () => {
    const refusing: (prefix: string) => RecordedCloud = (
      prefix: string,
    ): RecordedCloud => {
      return createRecordedCloud(HEALTHY, {
        answer: failingUnder(prefix, { status: 403, headers: {}, body: "" }),
      });
    };

    for (const prefix of ["/identity/v3/users", "/identity/v3/groups"]) {
      const report: OpenStackCollectionReport =
        await OpenStackCollector.collect(
          collectionJob(),
          createCollectorHarness({ transport: refusing(prefix).transport })
            .dependencies,
        );

      expect(report.status).toBe("Succeeded");
      expect(report.summary?.warnings).toEqual([]);
    }

    // Any other read refused is news.
    const regions: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      createCollectorHarness({
        transport: refusing("/identity/v3/regions").transport,
      }).dependencies,
    );

    expect(regions.summary?.warnings.join(" ")).toContain("refused regions");
  });
});

describe("gentle by construction", () => {
  test("identity and image are read about every five minutes, however often the rest are", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const identityReads: Array<number> = [];
    const imageReads: Array<number> = [];
    const computeReads: Array<number> = [];

    for (let minute: number = 0; minute <= 20; minute += 2) {
      const before: number = cloud.paths().length;

      const report: OpenStackCollectionReport =
        await OpenStackCollector.collect(collectionJob(), harness.dependencies);

      const asked: Array<string> = cloud.paths().slice(before);

      if (asked.includes("/identity/v3/projects")) {
        identityReads.push(minute);
      } else {
        // Not due: nothing about it, not even that it is up.
        expect(summaryOf(report, OpenStackServiceType.Identity)?.outcome).toBe(
          "NotDue",
        );
        expect(pointsNamed(report, "openstack_identity_up")).toEqual([]);
      }

      if (asked.includes("/image/v2/images")) {
        imageReads.push(minute);
      }

      if (asked.includes("/compute/v2.1/servers/detail")) {
        computeReads.push(minute);
      }

      harness.clock.advance(120_000);
    }

    expect(identityReads).toEqual([0, 4, 8, 12, 16, 20]);
    expect(imageReads).toEqual([0, 4, 8, 12, 16, 20]);
    expect(computeReads).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  test.each([
    [1, 4.5],
    [2, 3.5],
    [3, 2.5],
    [4, 3.5],
    [5, 4.5],
    [10, 9.5],
    [60, 59.5],
  ])(
    "a cloud collected every %s minutes reads the slow services when %s minutes have passed",
    (interval: number, minutes: number) => {
      expect(getSlowServiceIntervalInMs(interval)).toBe(minutes * 60_000);
    },
  );

  test("instances are read by what changed between full reads", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    harness.clock.advance(120_000);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    const servers: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/servers/detail");
      },
    );

    expect(servers).toHaveLength(2);
    expect(servers[0]?.url).not.toContain("changes-since");
    expect(servers[1]?.url).toContain("changes-since=");
    expect(report.summary?.instanceReadModes).toEqual({
      [RECORDED_REGION]: "Incremental",
    });
    // Every instance is still sent: the pages cannot tell how the list was come by.
    expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(4);
  });

  test("a collection out of time stops, keeps what it read, and vouches for nothing", async () => {
    const clock: FakeClock = createFakeClock();

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (
          new globalThis.URL(request.url).pathname ===
          "/compute/v2.1/os-hypervisors/detail"
        ) {
          // This one read takes the whole budget.
          clock.advance(200_000);
        }

        return undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      clock: clock,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ collectionIntervalInMinutes: 2 }),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_nova_up")).toBe(0);
    expect(valueOf(report, "up", { openstack_service: "compute" })).toBe(0);
    // What it had read by then is sent.
    expect(
      pointsNamed(report, "openstack_nova_agent_state").length,
    ).toBeGreaterThan(0);
    expect(summaryOf(report, OpenStackServiceType.Compute)).toMatchObject({
      outcome: "Partial",
      errorCode: OpenStackCollectionErrorCode.TimedOut,
    });
    expect(report.status).toBe("PartiallySucceeded");
  });

  test("the budget is nine-tenths of the interval, so it reports before the next is due", () => {
    expect(getCollectionBudgetInMs(2)).toBe(108_000);
    expect(getCollectionBudgetInMs(1)).toBe(54_000);
    expect(getCollectionBudgetInMs(0)).toBe(54_000);
    expect(getCollectionBudgetInMs(Number.NaN)).toBe(54_000);
    expect(getCollectionBudgetInMs(60)).toBe(MAX_COLLECTION_TIME_IN_MS);
  });

  test("a 429 is honoured, and a service that says it twice is left alone next time", async () => {
    let answered: boolean = false;

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        if (
          new globalThis.URL(request.url).pathname.startsWith("/placement/") &&
          !answered
        ) {
          answered = true;

          return {
            status: 429,
            headers: { "retry-after": "2" },
            body: "",
          };
        }

        return undefined;
      },
    });
    const clock: FakeClock = createFakeClock();
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      clock: clock,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(clock.sleeps).toContain(2000);
    expect(report.status).toBe("Succeeded");
  });

  test("Placement's allocations go first when they cannot be read, and the rest stays", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        return request.url.endsWith("/allocations")
          ? { status: 403, headers: {}, body: "" }
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_placement_up")).toBe(1);
    expect(
      pointsNamed(report, "openstack_placement_resource_total"),
    ).toHaveLength(3);
    expect(
      pointsNamed(report, "openstack_placement_resource_provider_allocations"),
    ).toEqual([]);
    expect(report.status).toBe("Succeeded");
  });

  /*
   * Recorded on every release: a credential on a project with no quota, which is the home
   * the docs give it, is answered 409 by Neutron's list of security groups. It tried to
   * make that project's default one on the way.
   */
  test("Neutron's 409 for a project with no quota is that project's lot, and no failure", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/networking/v2.0/security-groups", {
        status: 409,
        headers: {},
        body: JSON.stringify({
          NeutronError: {
            message: "Quota exceeded for resources: ['security_group'].",
          },
        }),
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary?.warnings).toEqual([]);
    expect(valueOf(report, "openstack_neutron_up")).toBe(1);
    expect(pointsNamed(report, "openstack_neutron_security_groups")).toEqual(
      [],
    );
    expect(pointsNamed(report, "openstack_neutron_network")).toHaveLength(4);
    expect(summaryOf(report, OpenStackServiceType.Network)).toMatchObject({
      outcome: "Succeeded",
    });
    expect(
      summaryOf(report, OpenStackServiceType.Network)?.errorCode,
    ).toBeUndefined();
    // Asked once: a retry would not change Neutron's mind.
    expect(
      cloud.paths().filter((p: string) => {
        return p === "/networking/v2.0/security-groups";
      }),
    ).toHaveLength(1);
  });

  test("a read with a real cloud's 403 for a plain reader costs only that read", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        const url: globalThis.URL = new globalThis.URL(request.url);

        if (url.pathname.endsWith("/os-services")) {
          return { status: 403, headers: {}, body: "" };
        }

        return undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(valueOf(report, "openstack_nova_up")).toBe(1);
    expect(pointsNamed(report, "openstack_nova_agent_state")).toEqual([]);
    expect(pointsNamed(report, "openstack_nova_server_status")).toHaveLength(4);
    expect(report.summary?.warnings.join(" ")).toContain("refused services");
  });
});

describe("the payload cap", () => {
  test("a collection too large to upload says so, and still says who is up", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: createRecordedCloud(HEALTHY).transport,
      overrides: { maxPayloadBytes: 1000 },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.PayloadTooLarge);
    expect(report.errorMessage).toContain(
      "KiB of metrics, more than the 1 KiB",
    );
    expect(report.errorMessage).toContain("Use the OpenStack agent");

    const names: Set<string> = new Set(
      datapointsOf(report.resourceMetrics).map((point: ReportedDatapoint) => {
        return point.metric;
      }),
    );

    expect(names).toEqual(
      new Set([
        "up",
        "scrape_samples_scraped",
        "scrape_duration_seconds",
        "openstack_identity_up",
        "openstack_nova_up",
        "openstack_placement_up",
        "openstack_neutron_up",
        "openstack_cinder_up",
        "openstack_glance_up",
      ]),
    );
  });

  test("the ceiling is the one VMware's path has", () => {
    expect(OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES).toBe(48 * 1024 * 1024);
    expect(formatSize(48 * 1024 * 1024)).toBe("48 MiB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MiB");
    expect(formatSize(300 * 1024)).toBe("300 KiB");
  });
});

describe("regions", () => {
  function twoRegions(): RecordedCloud {
    return createRecordedCloud(HEALTHY, {
      tokenOverrides: {
        catalog: [
          {
            type: "compute",
            name: "nova",
            endpoints: [
              {
                url: "https://openstack.example/compute/v2.1",
                interface: "public",
                region_id: "RegionOne",
              },
              {
                url: "https://openstack.example/compute/v2.1",
                interface: "public",
                region_id: "RegionTwo",
              },
            ],
          },
          {
            type: "identity",
            name: "keystone",
            endpoints: [
              {
                url: "https://openstack.example/identity",
                interface: "public",
                region_id: "RegionOne",
              },
            ],
          },
        ],
      },
    });
  }

  test("each region is read on its own, and Keystone once, with every region saying the same of it", async () => {
    const cloud: RecordedCloud = twoRegions();
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: ["RegionOne", "RegionTwo"] }),
      harness.dependencies,
    );

    expect(
      pointsNamed(report, "openstack_nova_up")
        .map((point: ReportedDatapoint) => {
          return point.labels["openstack.region.name"];
        })
        .sort(),
    ).toEqual(["RegionOne", "RegionTwo"]);

    expect(
      cloud.paths().filter((p: string) => {
        return p === "/identity/v3/projects";
      }),
    ).toHaveLength(1);

    expect(
      pointsNamed(report, "openstack_identity_up")
        .map((point: ReportedDatapoint) => {
          return point.labels["openstack.region.name"];
        })
        .sort(),
    ).toEqual(["RegionOne", "RegionTwo"]);
  });

  test("a service one region has and another does not reads as not deployed there", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: twoRegions().transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: ["RegionOne"] }),
      harness.dependencies,
    );

    expect(summaryOf(report, OpenStackServiceType.Volume)?.outcome).toBe(
      "NotDeployed",
    );
    // A job for it answers with nothing, as the agent's does for a cloud without it.
    expect(valueOf(report, "up", { openstack_service: "volume" })).toBe(1);
    expect(
      valueOf(report, "scrape_samples_scraped", {
        openstack_service: "volume",
      }),
    ).toBe(0);
    expect(pointsNamed(report, "openstack_cinder_up")).toEqual([]);
    expect(report.status).toBe("Succeeded");
  });

  test("a cloud set to read every region reads what the catalog names", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: twoRegions().transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: [] }),
      harness.dependencies,
    );

    expect(report.summary?.regionNames).toEqual(["RegionOne", "RegionTwo"]);
  });

  test("a region the catalog does not name is left out, and said", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: twoRegions().transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: ["RegionOne", "Gone"] }),
      harness.dependencies,
    );

    expect(report.summary?.regionNames).toEqual(["RegionOne"]);
    expect(report.summary?.warnings[0]).toBe(
      "The catalog has no region named Gone, so it was left out.",
    );
  });

  test("no region at all that the catalog names fails, naming what it does", async () => {
    const cloud: RecordedCloud = twoRegions();
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: ["Gone"] }),
      harness.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.RegionNotFound,
      errorMessage:
        "The catalog has no region named Gone. It names RegionOne, RegionTwo.",
    });

    // Keystone did nothing wrong, so it is not made to wait, or asked to log in again.
    await OpenStackCollector.collect(
      collectionJob({ regions: ["Gone"] }),
      harness.dependencies,
    );
    expect(logins(cloud)).toBe(1);

    const fixed: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: ["RegionOne"] }),
      harness.dependencies,
    );
    expect(fixed.summary?.regionNames).toEqual(["RegionOne"]);
    expect(logins(cloud)).toBe(1);
  });

  test("a token with no catalog says so, and what to do", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: createRecordedCloud(HEALTHY, {
        tokenOverrides: { catalog: [] },
      }).transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.NoCatalog);
    expect(report.errorMessage).toContain("Scope the credential to a project");
  });

  test("the regions to speak for when nothing can be read are the last known", async () => {
    let isDown: boolean = false;

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        return isDown && request.method === "POST"
          ? { status: 503, headers: {}, body: "" }
          : undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    // Set to read whatever the catalog names, and it has seen one.
    const job: OpenStackCollectionJob = collectionJob({ regions: [] });

    await OpenStackCollector.collect(job, harness.dependencies);

    // The token is gone, so the next collection has to log in, and cannot.
    harness.memory.forgetSession(
      getOpenStackCredentialKey({
        openStackCloudId: job.openStackCloudId,
        authUrl: RECORDED_AUTH_URL,
        credential: job.credential,
        trustedFingerprints: job.trustedCertificateFingerprints,
      }),
    );
    isDown = true;

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      job,
      harness.dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(
      valueOf(report, "openstack_identity_up", {
        "openstack.region.name": RECORDED_REGION,
      }),
    ).toBe(0);
  });

  test("a cloud never seen has no regions to say anything of, and its report still says why", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        return { status: 503, headers: {}, body: "" };
      },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ regions: [] }),
      harness.dependencies,
    );

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
    expect(datapointsOf(report.resourceMetrics)).toEqual([]);
  });
});

describe("what is off unless someone asks", () => {
  test("ports, every one a page at a time, when nothing narrows them", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ options: { collectPorts: true } }),
      harness.dependencies,
    );

    const ports: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return new globalThis.URL(request.url).pathname.endsWith("/ports");
      },
    );

    expect(ports.length).toBeGreaterThan(0);

    const query: globalThis.URLSearchParams = new globalThis.URL(ports[0]!.url)
      .searchParams;

    expect(query.get("limit")).toBe("1000");
    expect(query.getAll("fields")).toContain("binding:vif_type");
    expect(query.has("network_id")).toBe(false);
    expect(valueOf(report, "openstack_neutron_ports")).toBeGreaterThan(0);
    expect(
      pointsNamed(report, "openstack_neutron_port").length,
    ).toBeGreaterThan(0);
  });

  test("ports, one list per network and project named, and a port in both counted once", async () => {
    const asked: Array<globalThis.URLSearchParams> = [];

    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        const url: globalThis.URL = new globalThis.URL(request.url);

        if (!url.pathname.endsWith("/ports")) {
          return undefined;
        }

        asked.push(url.searchParams);

        return jsonAnswer(200, {
          ports: [{ id: "the-one-port", network_id: "n", fixed_ips: [] }],
          ports_links: [],
        });
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({
        options: {
          collectPorts: true,
          portNetworkIds: ["network-a"],
          portProjectIds: ["project-b"],
        },
      }),
      harness.dependencies,
    );

    expect(
      asked.map((query: globalThis.URLSearchParams) => {
        return [query.get("network_id"), query.get("project_id")];
      }),
    ).toEqual([
      ["network-a", null],
      [null, "project-b"],
    ]);
    expect(valueOf(report, "openstack_neutron_ports")).toBe(1);
  });

  test("ports refused cost only themselves, and vouch for nothing they did not read", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: failingUnder("/networking/v2.0/ports", {
        status: 403,
        headers: {},
        body: "",
      }),
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ options: { collectPorts: true } }),
      harness.dependencies,
    );

    expect(valueOf(report, "openstack_neutron_up")).toBe(1);
    expect(pointsNamed(report, "openstack_neutron_ports")).toEqual([]);
    expect(pointsNamed(report, "openstack_neutron_network")).toHaveLength(4);
  });

  test("what each project may use, a call per project, and the list of projects read once", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY, {
      answer: (request: OpenStackHttpRequest) => {
        const pathname: string = new globalThis.URL(request.url).pathname;

        if (pathname.includes("/os-quota-sets/")) {
          return jsonAnswer(200, {
            quota_set: { cores: { in_use: 1, reserved: 0, limit: 20 } },
          });
        }

        if (pathname.includes("/quotas/")) {
          return jsonAnswer(200, {
            quota: { floatingip: { used: 1, reserved: 0, limit: 50 } },
          });
        }

        return undefined;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ options: { collectProjectLimits: true } }),
      harness.dependencies,
    );

    // Nothing that is only a domain has quotas, and all but those are asked about.
    const projects: number = (
      recordedJson(HEALTHY, "keystone-projects")?.[
        "projects"
      ] as Array<JSONObject>
    ).filter((project: JSONObject): boolean => {
      return project["is_domain"] !== true;
    }).length;

    expect(
      cloud.paths().filter((p: string) => {
        return p.includes("/os-quota-sets/") && p.startsWith("/compute/");
      }),
    ).toHaveLength(projects);
    expect(
      pointsNamed(report, "openstack_nova_quota_cores").length,
    ).toBeGreaterThan(0);
    expect(
      pointsNamed(report, "openstack_neutron_quota_floatingip").length,
    ).toBeGreaterThan(0);
  });

  test("by default no project is asked about, on any service", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    expect(
      cloud.paths().filter((p: string) => {
        return p.includes("/os-quota-sets/") || p.includes("/quotas/");
      }),
    ).toEqual([]);
  });
});

describe("what the catalog names is held to what a person's address is", () => {
  function withEndpoint(url: string): RecordedCloud {
    return createRecordedCloud(HEALTHY, {
      tokenOverrides: {
        catalog: [
          {
            type: "compute",
            name: "nova",
            endpoints: [
              {
                url: "https://openstack.example/compute/v2.1",
                interface: "public",
                region_id: RECORDED_REGION,
              },
            ],
          },
          {
            type: "network",
            name: "neutron",
            endpoints: [
              { url: url, interface: "public", region_id: RECORDED_REGION },
            ],
          },
        ],
      },
    });
  }

  test.each([
    [
      "plain HTTP",
      "http://10.0.0.5:9696",
      OpenStackCollectionErrorCode.InsecureEndpoint,
      "plain HTTP. A token is never sent unencrypted.",
    ],
    [
      "the cloud metadata address",
      "https://169.254.169.254/latest",
      OpenStackCollectionErrorCode.AddressNotAllowed,
      "a loopback, link-local or cloud metadata address",
    ],
    [
      "loopback",
      "https://127.0.0.1:9696",
      OpenStackCollectionErrorCode.AddressNotAllowed,
      "a loopback, link-local or cloud metadata address",
    ],
    [
      "a URL with a user in it",
      "https://user:secret@example.com:9696",
      OpenStackCollectionErrorCode.InvalidAddress,
      "with a user name in it",
    ],
    [
      "something that is not a URL",
      "not a url at all",
      OpenStackCollectionErrorCode.InvalidAddress,
      "is not a URL",
    ],
  ])(
    "%s is never spoken to, and no token goes near it",
    async (
      _name: string,
      url: string,
      code: OpenStackCollectionErrorCode,
      words: string,
    ) => {
      const cloud: RecordedCloud = withEndpoint(url);
      const harness: CollectorHarness = createCollectorHarness({
        transport: cloud.transport,
      });

      const report: OpenStackCollectionReport =
        await OpenStackCollector.collect(collectionJob(), harness.dependencies);

      const network: OpenStackServiceSummary | undefined = summaryOf(
        report,
        OpenStackServiceType.Network,
      );

      expect(network?.outcome).toBe("Failed");
      expect(network?.errorCode).toBe(code);
      expect(network?.errorMessage).toContain(words);

      for (const request of cloud.requests) {
        expect(request.url.startsWith("https://openstack.example/")).toBe(true);
      }

      // Its collection reads as one that got no answer, and the rest are fine.
      expect(valueOf(report, "up", { openstack_service: "network" })).toBe(0);
      expect(valueOf(report, "openstack_nova_up")).toBe(1);
      expect(report.status).toBe("PartiallySucceeded");
      expect(report.errorCode).toBe(code);
    },
  );

  test("a catalog whose internal URLs are plain HTTP is fine while they are not picked", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ endpointInterface: "public" }),
      harness.dependencies,
    );

    expect(report.status).toBe("Succeeded");
  });

  test("an interface the catalog does not have reads as not deployed, and not as something else", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ endpointInterface: "internal" }),
      harness.dependencies,
    );

    expect(summaryOf(report, OpenStackServiceType.Compute)?.outcome).toBe(
      "NotDeployed",
    );
    expect(
      cloud.paths().every((p: string) => {
        return p.startsWith("/identity/");
      }),
    ).toBe(true);
  });
});

describe("the address", () => {
  test.each([
    ["plain HTTP", "http://keystone.example.com", "Use https://"],
    ["nothing at all", "", "Enter Keystone's address"],
  ])(
    "%s never leaves the probe",
    async (_name: string, authUrl: string, words: string) => {
      const harness: CollectorHarness = createCollectorHarness({
        transport: async (): Promise<OpenStackHttpResponse> => {
          throw new Error("Nothing should be asked.");
        },
      });

      const report: OpenStackCollectionReport =
        await OpenStackCollector.collect(
          collectionJob({ authUrl: authUrl }),
          harness.dependencies,
        );

      expect(report.status).toBe("Failed");
      expect(report.errorCode).toBe(
        OpenStackCollectionErrorCode.InvalidAddress,
      );
      expect(report.errorMessage).toContain(words);
      expect(harness.transportsOpened()).toBe(0);
    },
  );

  test("a private address is where a cloud usually is", async () => {
    expect(await resolveOpenStackAddress("https://10.20.30.40:5000")).toEqual([
      "10.20.30.40",
    ]);
  });

  test.each([
    ["multicast", "https://224.0.0.1"],
    ["the metadata address", "https://169.254.169.254"],
    ["loopback", "https://127.0.0.1"],
  ])(
    "the guard refuses %s, as every other address in OneUptime",
    async (_name: string, url: string) => {
      await expect(resolveOpenStackAddress(url)).rejects.toThrow(
        "OpenStack address",
      );
    },
  );
});

describe("what is asked for, against the access rules the docs give", () => {
  const rules: Array<{ service: string; path: string }> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../agents/OpenStackAgent/access/application-credential-access-rules.json",
      ),
      "utf8",
    ),
  ) as Array<{ service: string; path: string }>;

  // What the service's own URL starts with, in the recording's catalog.
  const SERVICES: ReadonlyArray<{ prefix: string; service: string }> = [
    { prefix: "/identity", service: "identity" },
    { prefix: "/compute", service: "compute" },
    { prefix: "/placement", service: "placement" },
    { prefix: "/networking", service: "network" },
    { prefix: "/volume", service: "block-storage" },
    { prefix: "/image", service: "image" },
  ];

  function isAllowed(pathname: string): boolean {
    const service: { prefix: string; service: string } | undefined =
      SERVICES.find((candidate: { prefix: string }): boolean => {
        return pathname.startsWith(candidate.prefix);
      });

    if (!service) {
      return false;
    }

    const within: string = pathname.substring(service.prefix.length);

    return rules
      .filter((rule: { service: string }): boolean => {
        return rule.service === service.service;
      })
      .some((rule: { path: string }): boolean => {
        const pattern: RegExp = new RegExp(
          `^${rule.path
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "@@")
            .replace(/\*/g, "[^/]+")
            .replace(/@@/g, ".*")}$`,
        );

        return pattern.test(within);
      });
  }

  /*
   * Every read a default collection makes is a path the credential the docs lead with may
   * make, or it would be refused. Those below are what such a credential goes without,
   * and they cost only themselves: nothing keeps a row of them. They are the exporter's
   * reads too, and the rig's access matrix is what should say whether to open them.
   */
  const GOES_WITHOUT: ReadonlyArray<string> = [
    "/identity/v3/users",
    "/identity/v3/groups",
  ];

  test("a default collection only reads what the access rules list, or what it can go without", async () => {
    const cloud: RecordedCloud = createRecordedCloud(HEALTHY);
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
    });

    await OpenStackCollector.collect(collectionJob(), harness.dependencies);

    const notListed: Set<string> = new Set();

    for (const request of cloud.requests) {
      const pathname: string = new globalThis.URL(request.url).pathname;

      // The login, and Nova's list of versions: neither is behind a token's rules.
      if (pathname.endsWith("/auth/tokens") || pathname === "/compute/") {
        continue;
      }

      if (!isAllowed(pathname)) {
        notListed.add(
          pathname.replace(
            /^(\/placement\/resource_providers\/)[^/]+(\/.*)$/,
            "$1*$2",
          ),
        );
      }
    }

    expect(Array.from(notListed).sort()).toEqual([...GOES_WITHOUT].sort());
  });
});

describe("the report is always sent", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a transport that throws something strange is a failure in words", async () => {
    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        throw "not even an error";
      },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.Internal);
    expect(report.errorMessage).toContain("not even an error");
    expect(harness.transportsClosed()).toBe(1);
  });

  test("how long it took is measured, and never negative", async () => {
    const clock: FakeClock = createFakeClock();

    const harness: CollectorHarness = createCollectorHarness({
      clock: clock,
      transport: async (): Promise<OpenStackHttpResponse> => {
        clock.advance(1500);
        throw new Error("gone");
      },
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      harness.dependencies,
    );

    expect(report.durationInMs).toBe(1500);
  });
});
