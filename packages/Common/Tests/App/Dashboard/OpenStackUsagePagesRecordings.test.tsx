import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, configure, screen, within } from "@testing-library/react";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import Navigation from "../../../UI/Utils/Navigation";
import { formatOpenStackBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList";
import OpenStackCloudHypervisorDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/HypervisorDetail";
import OpenStackCloudInstanceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/InstanceDetail";
import {
  InstanceMetricsRecording,
  RecordedServer,
  ReplayedPoint,
  getRecordedInstanceMetricsReleases,
  meanOf,
  readInstanceMetricsRecording,
  recordedServerNamed,
  replayRecordedSource,
} from "../../Helpers/OpenStackInstanceMetricsRecordings";
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
} from "./OpenStackPartHarness";

/*
 * THE PAGES, ON WHAT REAL CLOUDS REALLY SAID. Every recorded release's real instances, through both
 * real exporters and the path a real batch takes, then through the real pages: a CPU-burning instance
 * shows on its own page, and names itself on its hypervisor's. All that is stood in for is ClickHouse:
 * what a page asks of it is answered with the mean of what the scan wrote, for each group it asks by.
 */

configure({ testIdAttribute: "data-testid" });

const MIB: number = 1024 * 1024;
const RELEASES: Array<string> = getRecordedInstanceMetricsReleases();

const CASES: Array<[string, OpenStackInstanceMetricSource]> = RELEASES.flatMap(
  (release: string): Array<[string, OpenStackInstanceMetricSource]> => {
    return [
      [release, OpenStackInstanceMetricSource.Libvirt],
      [release, OpenStackInstanceMetricSource.Ceilometer],
    ];
  },
);

const DEVICE_METRICS: ReadonlyArray<string> = [
  OpenStackInstanceMetric.DiskReadRate,
  OpenStackInstanceMetric.DiskWriteRate,
  OpenStackInstanceMetric.DiskReadLatency,
  OpenStackInstanceMetric.DiskWriteLatency,
  OpenStackInstanceMetric.NetworkReceiveRate,
  OpenStackInstanceMetric.NetworkTransmitRate,
];

// What a read asks ClickHouse for: the mean of each group.
function answerByGroup(
  points: ReadonlyArray<ReplayedPoint>,
  groupOf: (point: ReplayedPoint) => string,
): Array<{ group: string; value: number }> {
  const groups: Map<string, Array<number>> = new Map();
  for (const point of points) {
    const group: string = groupOf(point);
    groups.set(group, [...(groups.get(group) || []), point.value]);
  }
  return Array.from(groups.entries()).map(
    ([group, values]: [string, Array<number>]): {
      group: string;
      value: number;
    } => {
      return { group, value: meanOf(values) };
    },
  );
}

function holdingWhatTheScanWrote(data: {
  points: ReadonlyArray<ReplayedPoint>;
  instanceMetricsGroup: "source" | "instance";
  instanceId?: string | undefined;
}): void {
  const names: Set<string> = new Set(
    data.points.map((point: ReplayedPoint): string => {
      return point.name;
    }),
  );
  for (const name of names) {
    const ofName: Array<ReplayedPoint> = data.points.filter(
      (point: ReplayedPoint): boolean => {
        return (
          point.name === name &&
          (!data.instanceId ||
            !point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] ||
            point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] ===
              data.instanceId)
        );
      },
    );
    const isHypervisorTotal: boolean = (
      Object.values(OpenStackHypervisorMetric) as Array<string>
    ).includes(name);
    server.metrics[name] = answerByGroup(
      ofName,
      (point: ReplayedPoint): string => {
        if (isHypervisorTotal || data.instanceMetricsGroup === "source") {
          if (DEVICE_METRICS.includes(name)) {
            return point.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE]!;
          }
          return point.attributes[OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE]!;
        }
        return point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE]!;
      },
    );
  }
}

function instanceRowOf(server_: RecordedServer): Record<string, unknown> {
  return {
    _id: new ObjectID(
      `6c1b2a3d-4e5f-4a6b-8c7d-${server_.id.replace(/-/g, "").substring(0, 12)}`,
    ).toString(),
    kind: OpenStackResourceKind.Instance,
    name: server_.name,
    externalId: server_.id,
    hypervisorName: HYPERVISOR_NAME,
    regionName: "RegionOne",
    availabilityZone: "nova",
    openStackProjectId: server_.projectId || "the-project",
    status: server_.status,
    facts: { flavorId: "ou-tiny" },
    lastSeenAt: new Date(),
  };
}

// estate.sh's ou.tiny, as the inventory holds a flavor.
function tinyFlavorRow(): Record<string, unknown> {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000012",
    kind: OpenStackResourceKind.Flavor,
    name: "ou.tiny",
    externalId: "RegionOne/ou-tiny",
    regionName: "RegionOne",
    vcpuCapacity: 1,
    memoryCapacityBytes: 128 * MIB,
    diskCapacityBytes: 1024 * MIB,
    facts: {},
    lastSeenAt: new Date(),
  };
}

// What Placement said of the runner on every release.
const RUNNER_TOTALS: Record<string, unknown> = {
  vcpuCapacity: 16,
  facts: {
    allocationRatios: { VCPU: 4, MEMORY_MB: 1 },
    resourceTotals: { VCPU: 4, MEMORY_MB: 15982 },
  },
};

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

test("there are recordings to read", () => {
  expect(RELEASES.length).toBeGreaterThanOrEqual(4);
});

describe.each(CASES)(
  "%s, read from %s",
  (release: string, source: OpenStackInstanceMetricSource) => {
    const recording: InstanceMetricsRecording =
      readInstanceMetricsRecording(release);
    const burner: RecordedServer = recordedServerNamed(recording, "ou-burner");
    const idle: RecordedServer = recordedServerNamed(recording, "ou-running");
    const research: RecordedServer = recordedServerNamed(
      recording,
      "ou-research-1",
    );
    const stopped: RecordedServer = recordedServerNamed(
      recording,
      "ou-stopped",
    );
    const points: Array<ReplayedPoint> = replayRecordedSource({
      recording,
      source,
    });

    async function openBurner(): Promise<HTMLElement> {
      holdingWhatTheScanWrote({
        points,
        instanceMetricsGroup: "source",
        instanceId: burner.id,
      });
      server.rows = [
        instanceRowOf(burner),
        tinyFlavorRow(),
        hypervisorRow(RUNNER_TOTALS),
        computeServiceRow(),
      ];
      await renderPage(
        OpenStackCloudInstanceDetail,
        partPath("instances", burner.id),
      );
      return screen.getByTestId("openstack-instance-usage");
    }

    async function openHypervisor(
      fields: Record<string, unknown> = RUNNER_TOTALS,
    ): Promise<HTMLElement> {
      holdingWhatTheScanWrote({ points, instanceMetricsGroup: "instance" });
      server.rows = [
        hypervisorRow(fields),
        computeServiceRow(),
        instanceRowOf(burner),
        instanceRowOf(idle),
        instanceRowOf(research),
        instanceRowOf(stopped),
      ];
      await renderPage(
        OpenStackCloudHypervisorDetail,
        partPath("hypervisors", HYPERVISOR_ID),
      );
      return screen.getByTestId("openstack-hypervisor-usage");
    }

    describe("the burning instance's own page", () => {
      test("shows all of its one vCPU in use, beside what its flavor promised", async () => {
        const usage: HTMLElement = await openBurner();
        // Nearly all of it, to the percent a real runner gives it.
        expect(
          within(usage).getByText(/^(9[5-9]|10[0-5])%$/),
        ).toBeInTheDocument();
        expect(usage).toHaveTextContent("of 1 vCPUs from its flavor");
      });

      test("shows what the guest uses of its memory, nowhere near the flavor's size that the balloon reads", async () => {
        const usage: HTMLElement = await openBurner();
        expect(usage).toHaveTextContent(
          `of ${formatOpenStackBytes(128 * MIB)} from its flavor`,
        );
        // Not 128 MiB, which is what libvirt's memory_usage_bytes says of every instance.
        expect(within(usage).queryByText("128 MiB")).toBeNull();
      });

      test("shows what it writes to its disk", async () => {
        const usage: HTMLElement = await openBurner();
        expect(usage).toHaveTextContent("written");
        expect(usage).toHaveTextContent(/[1-9][\d.]* MiB\/s/);
      });

      test("shows what its interface sends", async () => {
        const usage: HTMLElement = await openBurner();
        expect(usage).toHaveTextContent(/[\d.]+ B\/s out/);
      });

      test("shows how long a write takes", async () => {
        const usage: HTMLElement = await openBurner();
        expect(usage).toHaveTextContent("for its slowest disk, a request");
      });

      test(
        source === OpenStackInstanceMetricSource.Libvirt
          ? "shows what its vCPU waited, which on a runner with room is next to nothing"
          : "says this source doesn't say what its vCPU waited, rather than a 0",
        async () => {
          const usage: HTMLElement = await openBurner();
          if (source === OpenStackInstanceMetricSource.Libvirt) {
            expect(usage).toHaveTextContent("of its vCPUs' time");
            expect(within(usage).getByText("0%")).toBeInTheDocument();
          } else {
            expect(usage).toHaveTextContent("This source doesn't say");
          }
        },
      );

      test("has no notice saying a source is missing", async () => {
        await openBurner();
        expect(
          screen.queryByTestId("openstack-instance-usage-missing"),
        ).toBeNull();
      });
    });

    describe("its hypervisor's page", () => {
      test("names it first, using one CPU thread of the one vCPU it was given", async () => {
        await openHypervisor();
        const rows: Array<HTMLElement> = screen.getAllByTestId(
          "openstack-hypervisor-busiest-instance",
        );
        expect(rows[0]).toHaveTextContent("ou-burner");
        expect(rows[0]).toHaveTextContent(
          "1.0 CPU threads, of 1 vCPUs it was given",
        );
      });

      test("names the two idle instances after it, and never the shut-off one", async () => {
        await openHypervisor();
        const rows: Array<HTMLElement> = screen.getAllByTestId(
          "openstack-hypervisor-busiest-instance",
        );
        expect(rows).toHaveLength(3);
        expect(rows[1]).toHaveTextContent(/ou-(running|research-1)/);
        expect(rows[2]).toHaveTextContent(/ou-(running|research-1)/);
        for (const row of rows) {
          expect(row).not.toHaveTextContent("ou-stopped");
        }
      });

      test("says what its instances really use, one thread of the four it really has", async () => {
        const usage: HTMLElement = await openHypervisor();
        expect(within(usage).getByText("25%")).toBeInTheDocument();
        expect(usage).toHaveTextContent("1.0 CPU threads in use");
      });

      test("beside what is promised on it, which it never reads as usage", async () => {
        await openHypervisor();
        expect(
          screen.getByTestId("openstack-hypervisor-tiles"),
        ).toHaveTextContent("vCPUs allocated");
        expect(
          within(screen.getByTestId("openstack-hypervisor-tiles")).queryByText(
            "CPU used by instances",
          ),
        ).toBeNull();
      });

      test("isn't over any line, with one thread busy of four", async () => {
        await openHypervisor();
        expect(
          screen.queryByTestId("openstack-hypervisor-over-line"),
        ).toBeNull();
      });

      test("a hypervisor with only that one thread would be over the line, and name it as the one responsible", async () => {
        // The load is what was recorded. The size of the hypervisor is made up to put it over.
        await openHypervisor({
          facts: { resourceTotals: { VCPU: 1, MEMORY_MB: 15982 } },
        });
        expect(
          screen.getByTestId("openstack-hypervisor-over-line"),
        ).toHaveTextContent("instances responsible are named below");
        expect(
          screen.getAllByTestId("openstack-hypervisor-busiest-instance")[0],
        ).toHaveTextContent("ou-burner");
      });
    });
  },
);
