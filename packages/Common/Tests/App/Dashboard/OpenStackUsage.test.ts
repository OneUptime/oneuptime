import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { OPENSTACK_CEPH_STATUS_FACT } from "../../../Types/OpenStack/OpenStackLinks";
import {
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackInstanceMetricsMode,
  OpenStackInstanceMetricsOptions,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackAssessment,
  assessOpenStackStoragePool,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { ResourceAttentionSeverity } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  OpenStackCounterPoint,
  OpenStackHypervisorLoad,
  OpenStackUsageGap,
  getOpenStackCounterRate,
  getOpenStackHostThroughput,
  getOpenStackHypervisorLoad,
  getOpenStackHypervisorPhysicalCapacity,
  getOpenStackInstanceUsageGap,
  isOpenStackInstanceContended,
  isOpenStackInstanceCpuSaturated,
  isOpenStackPhysicalNetworkDevice,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackUsage";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

function row(fields: Partial<OpenStackResource>): OpenStackResource {
  return Object.assign(new OpenStackResource(), fields);
}

function options(
  mode: OpenStackInstanceMetricsMode,
): OpenStackInstanceMetricsOptions {
  return { mode, projectIds: [], aggregates: [] };
}

describe("what a page says when it has no usage to show", () => {
  function gapOf(
    fields: Partial<Parameters<typeof getOpenStackInstanceUsageGap>[0]>,
  ): OpenStackUsageGap {
    return getOpenStackInstanceUsageGap({
      hasUsage: false,
      row: row({ status: "ACTIVE" }),
      options: options(OpenStackInstanceMetricsMode.Automatic),
      instanceCount: 10,
      hypervisorHasSource: false,
      ...fields,
    });
  }

  test("nothing, when there is usage to show", () => {
    expect(gapOf({ hasUsage: true })).toBeNull();
  });

  test("an instance that isn't running has nothing to read, whatever else is so", () => {
    expect(gapOf({ row: row({ status: "SHUTOFF" }) })).toBe("not-running");
    expect(gapOf({ row: row({ status: "ERROR" }) })).toBe("not-running");
  });

  test("no sign of a source says how to add one", () => {
    expect(gapOf({})).toBe("no-source");
  });

  test("a running instance on a host that reports says what was chosen", () => {
    const reporting: Partial<
      Parameters<typeof getOpenStackInstanceUsageGap>[0]
    > = { hypervisorHasSource: true };
    expect(
      gapOf({
        ...reporting,
        instanceCount: 501,
      }),
    ).toBe("not-kept-past-size");
    expect(
      gapOf({
        ...reporting,
        options: options(OpenStackInstanceMetricsMode.Off),
      }),
    ).toBe("not-kept-off");
    expect(
      gapOf({
        ...reporting,
        options: options(OpenStackInstanceMetricsMode.Selected),
      }),
    ).toBe("not-kept-selected");
  });

  test("a host that reports and a cloud that keeps everything is a new instance, or one with no source on its host", () => {
    expect(gapOf({ hypervisorHasSource: true })).toBe("no-source");
  });
});

describe("a hypervisor's real load", () => {
  test("is measured against what it really has", () => {
    const load: OpenStackHypervisorLoad = getOpenStackHypervisorLoad({
      cpuCores: 3,
      memoryResidentBytes: 500,
      physicalCores: 4,
      physicalMemoryBytes: 1000,
    });
    expect(load.cpuPercent).toBe(75);
    expect(load.memoryPercent).toBe(50);
    expect(load.isCpuSaturated).toBe(false);
    expect(load.isMemoryPressured).toBe(false);
  });

  test("is over its line past the template's own number, and not on it", () => {
    expect(
      getOpenStackHypervisorLoad({
        cpuCores: OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
        memoryResidentBytes: null,
        physicalCores: 100,
        physicalMemoryBytes: null,
      }).isCpuSaturated,
    ).toBe(false);
    expect(
      getOpenStackHypervisorLoad({
        cpuCores: OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT + 0.5,
        memoryResidentBytes: null,
        physicalCores: 100,
        physicalMemoryBytes: null,
      }).isCpuSaturated,
    ).toBe(true);
    expect(
      getOpenStackHypervisorLoad({
        cpuCores: null,
        memoryResidentBytes: OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT + 1,
        physicalCores: null,
        physicalMemoryBytes: 100,
      }).isMemoryPressured,
    ).toBe(true);
  });

  test("with nothing to measure against, says nothing", () => {
    const load: OpenStackHypervisorLoad = getOpenStackHypervisorLoad({
      cpuCores: 3,
      memoryResidentBytes: null,
      physicalCores: null,
      physicalMemoryBytes: 0,
    });
    expect(load.cpuPercent).toBeNull();
    expect(load.memoryPercent).toBeNull();
    expect(load.isCpuSaturated).toBe(false);
  });

  test("what it really has comes from Placement's totals, before any ratio", () => {
    expect(
      getOpenStackHypervisorPhysicalCapacity(
        row({
          vcpuCapacity: 64,
          memoryCapacityBytes: 1000,
          facts: {
            allocationRatios: { VCPU: 16 },
            resourceTotals: { VCPU: 4, MEMORY_MB: 16384 },
          },
        }),
      ),
    ).toEqual({ cores: 4, memoryBytes: 16384 * 1024 * 1024 });
  });

  test("an older row works it out from what Placement will promise, over its ratio", () => {
    expect(
      getOpenStackHypervisorPhysicalCapacity(
        row({
          vcpuCapacity: 64,
          memoryCapacityBytes: 3000,
          facts: { allocationRatios: { VCPU: 16, MEMORY_MB: 1.5 } },
        }),
      ),
    ).toEqual({ cores: 4, memoryBytes: 2000 });
  });

  test("and with no ratio reads what it has", () => {
    expect(
      getOpenStackHypervisorPhysicalCapacity(row({ vcpuCapacity: 8 })),
    ).toEqual({ cores: 8, memoryBytes: null });
  });
});

describe("an instance's own lines", () => {
  test("saturated is the template's", () => {
    expect(isOpenStackInstanceCpuSaturated(96)).toBe(true);
    expect(isOpenStackInstanceCpuSaturated(95)).toBe(false);
    expect(isOpenStackInstanceCpuSaturated(null)).toBe(false);
  });

  test("waiting is past a tenth of its time", () => {
    expect(isOpenStackInstanceContended(10.5)).toBe(true);
    expect(isOpenStackInstanceContended(10)).toBe(false);
    expect(isOpenStackInstanceContended(null)).toBe(false);
  });
});

describe("Ceph's trouble in a cloud's Needs attention", () => {
  function pool(
    healthStatus: number | null,
    fields: Partial<OpenStackResource> = {},
  ): OpenStackResource {
    return row({
      kind: OpenStackResourceKind.StoragePool,
      diskCapacityBytes: 100,
      diskAllocatedBytes: 10,
      facts: {
        [OPENSTACK_CEPH_STATUS_FACT]: {
          clusterId: "c",
          clusterName: "ceph-east",
          healthStatus,
        },
      },
      ...fields,
    });
  }

  test("a pool half empty on a cluster reading HEALTH_ERR is critical, and says why", () => {
    const assessment: OpenStackAssessment = assessOpenStackStoragePool(pool(2));
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      expect.objectContaining({
        values: { cluster: "ceph-east" },
      }),
    ]);
  });

  test("HEALTH_WARN is a warning", () => {
    expect(assessOpenStackStoragePool(pool(1)).severity).toBe(
      ResourceAttentionSeverity.Warning,
    );
  });

  test("HEALTH_OK, or a cluster that hasn't said, is nothing", () => {
    expect(assessOpenStackStoragePool(pool(0)).severity).toBeNull();
    expect(assessOpenStackStoragePool(pool(null)).severity).toBeNull();
  });

  test("a full pool on a healthy cluster is what it always was", () => {
    expect(
      assessOpenStackStoragePool(pool(0, { diskAllocatedBytes: 90 })).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessOpenStackStoragePool(pool(null, { diskAllocatedBytes: 99 }))
        .severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("a full pool on a degraded cluster says both, and the worse of them", () => {
    const assessment: OpenStackAssessment = assessOpenStackStoragePool(
      pool(2, { diskAllocatedBytes: 90 }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toHaveLength(2);
  });

  test("a pool with no link is judged only as it always was", () => {
    expect(
      assessOpenStackStoragePool(
        row({
          kind: OpenStackResourceKind.StoragePool,
          diskCapacityBytes: 100,
          diskAllocatedBytes: 10,
          facts: {},
        }),
      ).severity,
    ).toBeNull();
  });
});

describe("what a machine is moving, by its own agent", () => {
  const MINUTE_MS: number = 60 * 1000;
  const START_MS: number = 1_800_000_000_000;

  function series(
    device: string,
    direction: string,
    values: Array<number>,
  ): Array<OpenStackCounterPoint> {
    return values.map((value: number, index: number): OpenStackCounterPoint => {
      return {
        device,
        direction,
        value,
        timeMs: START_MS + index * MINUTE_MS,
      };
    });
  }

  test("is what a counter added over the time between its readings", () => {
    expect(
      getOpenStackHostThroughput({
        disk: [
          ...series("sda", "read", [0, 6000, 12000]),
          ...series("sda", "write", [0, 12000, 24000]),
        ],
        network: [
          ...series("eth0", "receive", [1000, 7000]),
          ...series("eth0", "transmit", [1000, 1000]),
        ],
      }),
    ).toEqual({
      diskReadBytesPerSecond: 100,
      diskWriteBytesPerSecond: 200,
      networkReceiveBytesPerSecond: 100,
      networkTransmitBytesPerSecond: 0,
    });
  });

  test("adds up a machine's real interfaces, and doesn't count a packet at each hop", () => {
    const sameBytes: Array<number> = [0, 60000];
    expect(
      getOpenStackHostThroughput({
        disk: [],
        network: [
          ...series("eth0", "receive", sameBytes),
          ...series("ens3", "receive", [0, 6000]),
          ...series("bond0", "receive", [0, 6000]),
          ...series("tap1234abcd-12", "receive", sameBytes),
          ...series("qbr1234abcd-12", "receive", sameBytes),
          ...series("qvo1234abcd-12", "receive", sameBytes),
          ...series("br-int", "receive", sameBytes),
          ...series("br-ex", "receive", sameBytes),
          ...series("ovs-system", "receive", sameBytes),
          ...series("genev_sys_6081", "receive", sameBytes),
          ...series("vxlan_sys_4789", "receive", sameBytes),
          ...series("virbr0", "receive", sameBytes),
          ...series("lo", "receive", sameBytes),
        ],
      }).networkReceiveBytesPerSecond,
    ).toBe(1200);
  });

  test("adds up whole disks, and doesn't count a read again on what it passed through", () => {
    const sameBytes: Array<number> = [0, 60000];
    expect(
      getOpenStackHostThroughput({
        disk: [
          ...series("sda", "read", [0, 6000]),
          ...series("vdb", "read", [0, 6000]),
          ...series("nvme0n1", "read", [0, 6000]),
          ...series("sda1", "read", sameBytes),
          ...series("vdb2", "read", sameBytes),
          ...series("nvme0n1p1", "read", sameBytes),
          ...series("dm-0", "read", sameBytes),
          ...series("md0", "read", sameBytes),
          ...series("loop0", "read", sameBytes),
          ...series("sr0", "read", sameBytes),
        ],
        network: [],
      }).diskReadBytesPerSecond,
    ).toBeCloseTo(300);
  });

  test("a counter that restarted counts what it reads now, never a huge negative", () => {
    expect(
      getOpenStackCounterRate({
        points: series("eth0", "receive", [1e12, 1e12 + 6000, 6000]),
        direction: "receive",
        isCounted: isOpenStackPhysicalNetworkDevice,
      }),
    ).toBe(100);
  });

  test("a single reading has no rate, and no rate isn't the same as none moving", () => {
    expect(
      getOpenStackCounterRate({
        points: series("eth0", "receive", [1000]),
        direction: "receive",
        isCounted: isOpenStackPhysicalNetworkDevice,
      }),
    ).toBeNull();
    expect(getOpenStackHostThroughput({ disk: [], network: [] })).toEqual({
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null,
      networkReceiveBytesPerSecond: null,
      networkTransmitBytesPerSecond: null,
    });
  });

  test("a device with one reading doesn't stop the others being added up", () => {
    expect(
      getOpenStackCounterRate({
        points: [
          ...series("eth0", "receive", [0, 6000]),
          ...series("eth1", "receive", [5000]),
        ],
        direction: "receive",
        isCounted: isOpenStackPhysicalNetworkDevice,
      }),
    ).toBe(100);
  });

  test("whatever order the readings came in, and however they rose, it is the same rate", () => {
    const random: SeededRandom = seededRandom(5736);
    for (let round: number = 0; round < 200; round++) {
      let value: number = random(1e9);
      const count: number = 2 + random(12);
      const points: Array<OpenStackCounterPoint> = [];
      let added: number = 0;
      for (let index: number = 0; index < count; index++) {
        if (index > 0) {
          const rise: number = random(1e6);
          value += rise;
          added += rise;
        }
        points.push({
          device: "eth0",
          direction: "receive",
          value,
          timeMs: START_MS + index * MINUTE_MS,
        });
      }
      expect(
        getOpenStackCounterRate({
          points: shuffled(points, random),
          direction: "receive",
          isCounted: isOpenStackPhysicalNetworkDevice,
        }),
      ).toBeCloseTo(added / (((count - 1) * MINUTE_MS) / 1000));
    }
  });
});
