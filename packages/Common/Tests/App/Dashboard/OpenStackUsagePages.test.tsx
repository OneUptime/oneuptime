import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
  OpenStackInstanceMetricsMode,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackPlacement } from "../../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import OpenStackInstanceMetricsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackInstanceMetricsCard";
import { formatOpenStackBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList";
import OpenStackPlacementCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementCard";
import {
  OpenStackPlacementOfHost,
  OpenStackPlacementOfService,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementOfHost";
import OpenStackCloudHypervisorDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/HypervisorDetail";
import OpenStackCloudInstanceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/InstanceDetail";
import OpenStackCloudStoragePoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StoragePoolDetail";
import {
  CLOUD_ID,
  HYPERVISOR_ID,
  HYPERVISOR_NAME,
  computeServiceRow,
  hypervisorRow,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tile,
} from "./OpenStackPartHarness";

/*
 * What is really busy on the pages, beside what is promised: rendered for real over the real
 * cards, with the server's answers made up. Allocation is never shown as usage, and a page
 * with no source says what is missing and how to add it.
 */

configure({ testIdAttribute: "data-testid" });

const BURNER_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";
const QUIET_ID: string = "a1b2c3d4-0000-4000-8000-000000000002";

function instanceRow(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000011",
    kind: OpenStackResourceKind.Instance,
    name: "burner",
    externalId: BURNER_ID,
    hypervisorName: HYPERVISOR_NAME,
    regionName: "RegionOne",
    availabilityZone: "az1",
    openStackProjectId: "p1",
    status: "ACTIVE",
    facts: { flavorId: "f1" },
    lastSeenAt: new Date(),
    ...fields,
  };
}

function flavorRow(): Record<string, unknown> {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000012",
    kind: OpenStackResourceKind.Flavor,
    name: "m1.small",
    externalId: "RegionOne/f1",
    regionName: "RegionOne",
    vcpuCapacity: 2,
    memoryCapacityBytes: 2048 * 1024 * 1024,
    diskCapacityBytes: 20 * 1024 * 1024 * 1024,
    facts: {},
    lastSeenAt: new Date(),
  };
}

function reportFromSource(): void {
  server.metrics[OpenStackHypervisorMetric.InstancesCpuUsage] = [
    { group: OpenStackInstanceMetricSource.Libvirt, value: 3.8 },
  ];
  server.metrics[OpenStackHypervisorMetric.InstancesMemoryResident] = [
    { group: OpenStackInstanceMetricSource.Libvirt, value: 8 * 1024 * 1024 * 1024 },
  ];
  server.metrics[OpenStackHypervisorMetric.InstancesReporting] = [
    { group: OpenStackInstanceMetricSource.Libvirt, value: 2 },
  ];
}

beforeEach(() => {
  resetServer();
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation((() => {
    return new ObjectID(CLOUD_ID);
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openHypervisor(fields: Record<string, unknown> = {}): Promise<void> {
  server.rows = [
    hypervisorRow(fields),
    computeServiceRow(),
    instanceRow(),
    instanceRow({
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000013",
      name: "quiet",
      externalId: QUIET_ID,
    }),
  ];
  await renderPage(
    OpenStackCloudHypervisorDetail,
    partPath("hypervisors", HYPERVISOR_ID),
  );
}

describe("a hypervisor's page", () => {
  test("with no source it says what is missing and how to add it, and shows no usage", async () => {
    await openHypervisor();
    const notice: HTMLElement = screen.getByTestId(
      "openstack-hypervisor-usage-missing",
    );
    expect(notice).toHaveTextContent("how busy this hypervisor is");
    expect(notice).toHaveTextContent("prometheus-libvirt-exporter");
    expect(notice).toHaveTextContent("Ceilometer");
    expect(screen.queryByTestId("openstack-hypervisor-usage")).toBeNull();
  });

  test("what is promised goes on saying it is promised, and is never drawn as usage", async () => {
    await openHypervisor();
    // 12 of 64 is allocation. Nothing reads it as CPU in use.
    expect(
      within(screen.getByTestId("openstack-hypervisor-tiles")).queryByText(
        "CPU in use",
      ),
    ).toBeNull();
    expect(screen.queryByText("CPU used by instances")).toBeNull();
  });

  test("with a source it shows what its instances really use, against what it really has", async () => {
    reportFromSource();
    await openHypervisor({
      vcpuCapacity: 64,
      facts: {
        allocationRatios: { VCPU: 16, MEMORY_MB: 1.5 },
        resourceTotals: { VCPU: 4, MEMORY_MB: 16384 },
      },
    });
    const usage: HTMLElement = screen.getByTestId("openstack-hypervisor-usage");
    // 3.8 threads of 4 real ones, not of the 64 a ratio of 16 promises.
    expect(within(usage).getByText("95%")).toBeInTheDocument();
    expect(usage).toHaveTextContent("3.8 CPU threads in use");
    // 8 GiB of 16.
    expect(within(usage).getByText("50%")).toBeInTheDocument();
  });

  test("over the line it says so, and names the instances responsible, most first", async () => {
    reportFromSource();
    server.metrics[OpenStackInstanceMetric.CpuUsage] = [
      { group: QUIET_ID, value: 0.1 },
      { group: BURNER_ID, value: 3.7 },
    ];
    server.metrics[OpenStackInstanceMetric.CpuContention] = [
      { group: QUIET_ID, value: 24 },
    ];
    await openHypervisor({
      facts: { resourceTotals: { VCPU: 4, MEMORY_MB: 16384 } },
    });

    expect(
      screen.getByTestId("openstack-hypervisor-over-line"),
    ).toHaveTextContent("instances responsible are named below");
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "openstack-hypervisor-busiest-instance",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("burner");
    expect(rows[0]).toHaveTextContent("3.7 CPU threads");
    expect(rows[1]).toHaveTextContent("quiet");
    // The one using the most isn't the one suffering.
    expect(rows[1]).toHaveTextContent("waiting 24%");
  });

  test("under the line it says nothing of the kind", async () => {
    reportFromSource();
    server.metrics[OpenStackHypervisorMetric.InstancesCpuUsage] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 1 },
    ];
    await openHypervisor({
      facts: { resourceTotals: { VCPU: 4, MEMORY_MB: 16384 } },
    });
    expect(screen.queryByTestId("openstack-hypervisor-over-line")).toBeNull();
  });

  test("a cloud that keeps no per-instance series says why no instance is named", async () => {
    reportFromSource();
    await openHypervisor();
    expect(
      screen.getByTestId("openstack-hypervisor-busiest-none"),
    ).toHaveTextContent("past 500 instances");
  });

  describe("with OneUptime's agent on its machine", () => {
    const NOW_MS: number = Date.now();

    function reading(
      device: string,
      direction: string,
      minutesAgo: number,
      value: number,
    ): JSONObject {
      return {
        value,
        timestamp: new Date(NOW_MS - minutesAgo * 60 * 1000).toISOString(),
        attributes: { device, direction },
      };
    }

    function agentReports(readings: Record<string, Array<JSONObject>>): void {
      server.records["Host"] = [
        {
          _id: "90000000-0000-4000-8000-000000000001",
          name: "compute-07",
          hostIdentifier: "compute-07",
        },
      ];
      const spy: jest.SpiedFunction<typeof AnalyticsModelAPI.aggregate> =
        jest.spyOn(AnalyticsModelAPI, "aggregate");
      const otherwise: unknown = spy.getMockImplementation();
      spy.mockImplementation((async (options: {
        aggregateBy: { query: { name: string } };
      }) => {
        const name: string = options.aggregateBy.query.name;
        if (readings[name]) {
          return { data: readings[name] };
        }
        return (otherwise as (given: unknown) => unknown)(options);
      }) as never);
    }

    test("what its disks and network are really moving sits beside what is promised", async () => {
      agentReports({
        "system.disk.io": [
          reading("sda", "read", 2, 0),
          reading("sda", "read", 1, 6 * 1024 * 1024),
          reading("sda1", "read", 2, 0),
          reading("sda1", "read", 1, 6 * 1024 * 1024),
          reading("sda", "write", 2, 0),
          reading("sda", "write", 1, 12 * 1024 * 1024),
        ],
        "system.network.io": [
          reading("eth0", "receive", 2, 0),
          reading("eth0", "receive", 1, 60 * 1024 * 1024),
          reading("tap1234abcd-12", "receive", 2, 0),
          reading("tap1234abcd-12", "receive", 1, 60 * 1024 * 1024),
          reading("eth0", "transmit", 2, 0),
          reading("eth0", "transmit", 1, 30 * 1024 * 1024),
        ],
      });

      await openHypervisor();

      const throughput: HTMLElement = screen.getByTestId(
        "openstack-hypervisor-host-throughput",
      );
      // A partition's bytes are its disk's, and a tap's are its interface's.
      expect(throughput).toHaveTextContent(
        `${formatOpenStackBytes(100 * 1024)}/s read`,
      );
      expect(throughput).toHaveTextContent(
        `${formatOpenStackBytes(200 * 1024)}/s written`,
      );
      expect(throughput).toHaveTextContent(
        `${formatOpenStackBytes(1024 * 1024)}/s in`,
      );
      expect(throughput).toHaveTextContent(
        `${formatOpenStackBytes(512 * 1024)}/s out`,
      );
      // Still what is promised, on its own tiles, which none of this has changed.
      expect(screen.getByTestId("openstack-hypervisor-tiles")).toHaveTextContent(
        "vCPUs allocated",
      );
    });

    test("an agent that reports neither says so, and is never read as nothing moving", async () => {
      agentReports({ "system.disk.io": [], "system.network.io": [] });

      await openHypervisor();

      const throughput: HTMLElement = screen.getByTestId(
        "openstack-hypervisor-host-throughput",
      );
      expect(within(throughput).getAllByText("Not reported")).toHaveLength(2);
      expect(throughput).not.toHaveTextContent("0 B/s");
    });

    test("no host, no tiles: nothing here says what it is moving", async () => {
      await openHypervisor();
      expect(
        screen.queryByTestId("openstack-hypervisor-host-throughput"),
      ).toBeNull();
    });

    test("a host name that fits two machines has no tiles either", async () => {
      server.records["Host"] = [
        { _id: "90000000-0000-4000-8000-000000000001", hostIdentifier: "a" },
        { _id: "90000000-0000-4000-8000-000000000002", hostIdentifier: "b" },
      ];
      await openHypervisor();
      expect(
        screen.queryByTestId("openstack-hypervisor-host-throughput"),
      ).toBeNull();
    });
  });

  test("its blast radius names what it takes with it beyond the cloud", async () => {
    server.rows = [hypervisorRow(), computeServiceRow()];
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
    }) => {
      return options.url.toString().includes("blast-radius")
        ? {
            data: {
              instanceCount: 2,
              volumeCount: 0,
              routerCount: 0,
              floatingIpCount: 0,
              projectCount: 0,
              projects: [],
              isKnown: true,
              acrossProducts: {
                hostCount: 1,
                hosts: [
                  {
                    id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000021",
                    name: "web-1",
                    isHypervisor: false,
                  },
                ],
                kubernetesNodeCount: 1,
                kubernetesNodes: [
                  {
                    clusterId: "6c1b2a3d-4e5f-4a6b-8c7d-000000000022",
                    clusterName: "prod",
                    nodeName: "node-1",
                    instanceId: BURNER_ID,
                  },
                ],
                kubernetesClusters: [
                  {
                    id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000022",
                    name: "prod",
                    nodeCount: 1,
                  },
                ],
                serviceCount: 1,
                services: [
                  {
                    id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000023",
                    name: "checkout",
                  },
                ],
              },
            },
          }
        : { data: { rows: [], totalsByKind: {} } };
    }) as never);
    await renderPage(
      OpenStackCloudHypervisorDetail,
      partPath("hypervisors", HYPERVISOR_ID),
    );
    const across: HTMLElement = screen.getByTestId(
      "openstack-hypervisor-blast-across-products",
    );
    expect(across).toHaveTextContent("web-1");
    expect(across).toHaveTextContent("prod");
    expect(across).toHaveTextContent("node-1");
    expect(across).toHaveTextContent("checkout");
  });
});

describe("an instance's page", () => {
  async function openInstance(
    fields: Record<string, unknown> = {},
  ): Promise<void> {
    server.rows = [instanceRow(fields), flavorRow(), hypervisorRow(), computeServiceRow()];
    await renderPage(
      OpenStackCloudInstanceDetail,
      partPath("instances", BURNER_ID),
    );
  }

  test("with no source it says what is missing and how to add it", async () => {
    await openInstance();
    const notice: HTMLElement = screen.getByTestId(
      "openstack-instance-usage-missing",
    );
    expect(notice).toHaveTextContent("only what is promised");
    expect(notice).toHaveTextContent("prometheus-libvirt-exporter");
    expect(screen.queryByTestId("openstack-instance-usage")).toBeNull();
  });

  test("its flavor's size still says it is what is promised", async () => {
    await openInstance();
    expect(tile("openstack-instance-tiles", "vCPUs")).toHaveTextContent(
      "from its flavor",
    );
  });

  test("with a source its charts' numbers sit beside its flavor's size", async () => {
    server.metrics[OpenStackInstanceMetric.CpuUtilization] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 97.4 },
    ];
    server.metrics[OpenStackInstanceMetric.CpuUsage] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 1.9 },
    ];
    server.metrics[OpenStackInstanceMetric.MemoryUsage] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 1024 * 1024 * 1024 },
    ];
    server.metrics[OpenStackInstanceMetric.CpuContention] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 12 },
    ];
    await openInstance();
    const usage: HTMLElement = screen.getByTestId("openstack-instance-usage");
    expect(within(usage).getByText("97%")).toBeInTheDocument();
    expect(usage).toHaveTextContent("of 2 vCPUs from its flavor");
    expect(within(usage).getByText("12%")).toBeInTheDocument();
    expect(usage).toHaveTextContent(
      `of ${formatOpenStackBytes(2048 * 1024 * 1024)} from its flavor`,
    );
  });

  test("without a balloon driver, memory falls back to what it holds on its hypervisor", async () => {
    server.metrics[OpenStackInstanceMetric.MemoryResident] = [
      { group: OpenStackInstanceMetricSource.Libvirt, value: 1024 * 1024 * 1024 },
    ];
    await openInstance();
    expect(screen.getByTestId("openstack-instance-usage")).toHaveTextContent(
      formatOpenStackBytes(1024 * 1024 * 1024),
    );
  });

  test("an instance that isn't running says that, rather than how to add a source", async () => {
    await openInstance({ status: "SHUTOFF" });
    expect(
      screen.getByTestId("openstack-instance-usage-missing"),
    ).toHaveTextContent("isn't running");
  });

  test("a source that is read, on a cloud past the size, says to choose under Settings", async () => {
    reportFromSource();
    server.cloud = Object.assign(new OpenStackCloud(), {
      name: "prod-eu",
      instanceCount: 501,
    });
    await openInstance();
    expect(
      screen.getByTestId("openstack-instance-usage-missing"),
    ).toHaveTextContent("Choose what to keep under this cloud's Settings");
  });

  test("a source that is read, on a cloud that turned it off, says so", async () => {
    reportFromSource();
    server.cloud = Object.assign(new OpenStackCloud(), {
      name: "prod-eu",
      instanceMetricsOptions: { mode: OpenStackInstanceMetricsMode.Off },
    });
    await openInstance();
    expect(
      screen.getByTestId("openstack-instance-usage-missing"),
    ).toHaveTextContent("keep no per-instance series");
  });

  test("a selection this instance isn't in says so", async () => {
    reportFromSource();
    server.cloud = Object.assign(new OpenStackCloud(), {
      name: "prod-eu",
      instanceMetricsOptions: {
        mode: OpenStackInstanceMetricsMode.Selected,
        projectIds: ["someone-else"],
      },
    });
    await openInstance();
    expect(
      screen.getByTestId("openstack-instance-usage-missing"),
    ).toHaveTextContent("in none of them");
  });

  test("it has a tab of charts", async () => {
    await openInstance();
    expect(screen.getAllByText("Usage").length).toBeGreaterThan(0);
  });

  test("it names what it also is elsewhere in OneUptime, and nothing when it is nothing", async () => {
    await openInstance();
    expect(screen.queryByTestId("openstack-instance-links")).toBeNull();
    cleanup();
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
    }) => {
      return options.url.toString().includes("reach-of-instance")
        ? {
            data: {
              hostCount: 1,
              hosts: [
                {
                  id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000021",
                  name: "web-1",
                  isHypervisor: false,
                },
              ],
              kubernetesNodeCount: 0,
              kubernetesNodes: [],
              kubernetesClusters: [],
              serviceCount: 0,
              services: [],
            },
          }
        : { data: { rows: [], totalsByKind: {} } };
    }) as never);
    await openInstance();
    expect(screen.getByTestId("openstack-instance-links")).toHaveTextContent(
      "web-1",
    );
  });
});

describe("a storage pool's page", () => {
  const POOL_ID: string = "RegionOne/ctl@rbd#rbd";

  function poolRow(): Record<string, unknown> {
    return {
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000031",
      kind: OpenStackResourceKind.StoragePool,
      name: "ctl@rbd#rbd",
      externalId: POOL_ID,
      regionName: "RegionOne",
      diskCapacityBytes: 1024,
      diskAllocatedBytes: 10,
      facts: {},
      lastSeenAt: new Date(),
    };
  }

  async function openPool(answer: Record<string, unknown>): Promise<jest.Mock> {
    server.rows = [poolRow()];
    const posted: jest.Mock = jest.fn();
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
      data: unknown;
    }) => {
      const url: string = options.url.toString();
      if (url.includes("storage-pool-ceph-confirm")) {
        posted(options.data);
        return { data: {} };
      }
      return url.includes("storage-pool-ceph")
        ? {
            data: {
              clusters: [
                { id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000032", name: "ceph-east" },
              ],
              health: null,
              capacityUsedPercent: null,
              ...answer,
            },
          }
        : { data: { rows: [], totalsByKind: {} } };
    }) as never);
    await renderPage(
      OpenStackCloudStoragePoolDetail,
      partPath("storage-pools", POOL_ID),
    );
    return posted;
  }

  const CLUSTER_ID: string = "6c1b2a3d-4e5f-4a6b-8c7d-000000000032";

  test("says nothing on a project with no Ceph clusters", async () => {
    await openPool({
      link: {
        state: "no-clusters",
        clusterId: null,
        clusterName: null,
        cephPoolName: null,
      },
    });
    expect(screen.queryByTestId("openstack-storage-pool-ceph")).toBeNull();
  });

  test("says nothing once someone said it isn't on Ceph", async () => {
    await openPool({
      link: {
        state: "not-ceph",
        clusterId: null,
        clusterName: null,
        cephPoolName: null,
      },
    });
    expect(screen.queryByTestId("openstack-storage-pool-ceph")).toBeNull();
  });

  test("a name only suggests a cluster, and asks", async () => {
    const posted: jest.Mock = await openPool({
      link: {
        state: "suggested",
        clusterId: CLUSTER_ID,
        clusterName: "ceph-east",
        cephPoolName: "volumes",
      },
    });
    expect(
      screen.getByTestId("openstack-storage-pool-ceph-suggestion"),
    ).toHaveTextContent("Is that where this pool is?");
    expect(screen.queryByTestId("openstack-storage-pool-ceph-health")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Yes, this is it"));
    });
    await settle();
    expect(posted).toHaveBeenCalledWith({
      externalId: POOL_ID,
      cephClusterId: CLUSTER_ID,
    });
  });

  test("someone can say it isn't on Ceph", async () => {
    const posted: jest.Mock = await openPool({
      link: {
        state: "suggested",
        clusterId: CLUSTER_ID,
        clusterName: "ceph-east",
        cephPoolName: "volumes",
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("It isn't on Ceph"));
    });
    await settle();
    expect(posted).toHaveBeenCalledWith({
      externalId: POOL_ID,
      isNotCeph: true,
    });
  });

  test("what the driver says, it says, with how the cluster reads", async () => {
    await openPool({
      link: {
        state: "from-fsid",
        clusterId: CLUSTER_ID,
        clusterName: "ceph-east",
        cephPoolName: "volumes",
      },
      health: 1,
    });
    const card: HTMLElement = screen.getByTestId("openstack-storage-pool-ceph");
    expect(card).toHaveTextContent("Cinder's driver names this cluster");
    expect(card).toHaveTextContent("ceph-east");
    expect(
      screen.getByTestId("openstack-storage-pool-ceph-health"),
    ).toHaveTextContent("It reads HEALTH_WARN");
  });

  test("nothing known lets someone choose", async () => {
    await openPool({
      link: {
        state: "unknown",
        clusterId: null,
        clusterName: null,
        cephPoolName: null,
      },
    });
    expect(screen.getByTestId("openstack-storage-pool-ceph")).toHaveTextContent(
      "Nothing that was collected says whether this pool is on Ceph",
    );
  });
});

describe("another product's page", () => {
  const PLACEMENT: OpenStackPlacement = {
    openStackCloudId: CLOUD_ID,
    cloudName: "prod-eu",
    kind: "instance",
    externalId: BURNER_ID,
    name: "web-1",
    regionName: "RegionOne",
    availabilityZone: "nova",
    hypervisorName: HYPERVISOR_NAME,
    hypervisorExternalId: HYPERVISOR_ID,
    openStackProjectId: "p1",
    openStackProjectName: "payments",
    status: "ACTIVE",
  };

  async function renderIt(element: React.ReactElement): Promise<void> {
    await act(async () => {
      render(<MemoryRouter>{element}</MemoryRouter>);
    });
    await settle();
  }

  test("links to the instance, its hypervisor, its zone, its project and its cloud", async () => {
    await renderIt(
      <OpenStackPlacementCard
        testId="placement"
        title="On OpenStack"
        description="Where it runs."
        placement={PLACEMENT}
      />,
    );
    const card: HTMLElement = screen.getByTestId("placement");
    for (const [testId, words] of [
      ["openstack-placement-cloud", "prod-eu"],
      ["openstack-placement-instance", "web-1"],
      ["openstack-placement-hypervisor", HYPERVISOR_NAME],
      ["openstack-placement-zone", "nova"],
      ["openstack-placement-project", "payments"],
    ] as Array<[string, string]>) {
      expect(within(card).getByTestId(testId)).toHaveTextContent(words);
      expect(
        within(within(card).getByTestId(testId)).getByRole("link"),
      ).toHaveAttribute("href", expect.stringContaining(CLOUD_ID));
    }
  });

  test("a hypervisor is no instance of itself", async () => {
    await renderIt(
      <OpenStackPlacementCard
        testId="placement"
        title="On OpenStack"
        description="Where it runs."
        placement={{ ...PLACEMENT, kind: "hypervisor", name: HYPERVISOR_NAME }}
      />,
    );
    expect(screen.queryByTestId("openstack-placement-instance")).toBeNull();
    expect(
      screen.getByTestId("openstack-placement-hypervisor"),
    ).toBeInTheDocument();
  });

  test("something on no cloud says nothing at all", async () => {
    jest.spyOn(API, "post").mockResolvedValue({
      data: { placement: null },
    } as never);
    await renderIt(<OpenStackPlacementOfHost hostId={ObjectID.generate()} />);
    expect(screen.queryByTestId("host-openstack-placement")).toBeNull();
  });

  test("a read that fails leaves the page as it would be for anything else", async () => {
    jest.spyOn(API, "post").mockRejectedValue(new Error("nope") as never);
    await renderIt(<OpenStackPlacementOfHost hostId={ObjectID.generate()} />);
    expect(screen.queryByTestId("host-openstack-placement")).toBeNull();
    expect(screen.queryByText("nope")).toBeNull();
  });

  test("a host on a cloud says where", async () => {
    jest.spyOn(API, "post").mockResolvedValue({
      data: { placement: PLACEMENT },
    } as never);
    await renderIt(<OpenStackPlacementOfHost hostId={ObjectID.generate()} />);
    expect(screen.getByTestId("host-openstack-placement")).toHaveTextContent(
      "web-1",
    );
  });

  test("a service says where it runs, through the host its telemetry names", async () => {
    jest.spyOn(API, "post").mockResolvedValue({
      data: {
        placements: [
          { hostName: "web-1", hostId: null, placement: PLACEMENT },
        ],
      },
    } as never);
    await renderIt(<OpenStackPlacementOfService serviceId={ObjectID.generate()} />);
    expect(screen.getByTestId("service-openstack-placement")).toHaveTextContent(
      HYPERVISOR_NAME,
    );
  });
});

describe("a cloud's settings", () => {
  async function openCard(fields: Record<string, unknown> = {}): Promise<void> {
    server.cloud = Object.assign(new OpenStackCloud(), {
      name: "prod-eu",
      instanceCount: 100,
      ...fields,
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <OpenStackInstanceMetricsCard modelId={new ObjectID(CLOUD_ID)} />
        </MemoryRouter>,
      );
    });
    await settle();
  }

  test("say what keeping them costs, on this cloud's own size", async () => {
    await openCard();
    expect(
      screen.getByTestId("openstack-instance-metrics-cost"),
    ).toHaveTextContent("This cloud has 100 instances");
    expect(
      screen.getByTestId("openstack-instance-metrics-cost"),
    ).toHaveTextContent("180,000");
  });

  test("only ask which projects and aggregates once that is the choice", async () => {
    await openCard();
    expect(
      screen.queryByTestId("openstack-instance-metrics-selection"),
    ).toBeNull();
    cleanup();
    await openCard({
      instanceMetricsOptions: { mode: OpenStackInstanceMetricsMode.Selected },
    });
    expect(
      screen.getByTestId("openstack-instance-metrics-selection"),
    ).toBeInTheDocument();
  });

  test("save what was chosen", async () => {
    const update: unknown = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    await openCard();
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    await settle();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: OpenStackCloud,
        data: {
          instanceMetricsOptions: expect.objectContaining({
            mode: OpenStackInstanceMetricsMode.Automatic,
          }),
        },
      }),
    );
  });
});

