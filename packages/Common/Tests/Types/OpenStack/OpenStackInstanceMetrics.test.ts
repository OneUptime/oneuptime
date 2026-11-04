import { describe, expect, test } from "@jest/globals";
import {
  MAX_OPENSTACK_INSTANCE_METRICS_SELECTIONS,
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OPENSTACK_INSTANCE_METRIC_UNITS,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
  OpenStackInstanceMetricsMode,
  OpenStackInstanceMetricsOptions,
  estimateOpenStackInstanceMetricsVolume,
  findOpenStackDeviceAfterInstanceId,
  findOpenStackInstanceId,
  getDefaultOpenStackInstanceMetricsOptions,
  getOpenStackHypervisorCapacity,
  getOpenStackInstanceIdOfProviderId,
  isOpenStackInstanceId,
  isOpenStackInstanceMetricsKept,
  isOpenStackInstanceMetricsOnForCloud,
  mergeOpenStackInstanceUsage,
  normalizeOpenStackInstanceMetricsOptions,
  rankOpenStackInstancesByCpu,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";

const UUID: string = "a1b2c3d4-0000-4000-8000-000000000001";

function optionsOf(
  mode: OpenStackInstanceMetricsMode,
  fields?: Partial<OpenStackInstanceMetricsOptions>,
): OpenStackInstanceMetricsOptions {
  return { mode, projectIds: [], aggregates: [], ...fields };
}

describe("which instance a name holds", () => {
  test.each([
    [UUID, UUID],
    [`${UUID}-vda`, UUID],
    [`instance-00000001-${UUID}-tap1234abcd-ef`, UUID],
    [UUID.toUpperCase(), UUID],
    ["nova-instance-instance-00000001-fa163e12ab34", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%s is %s", (value: unknown, expected: unknown) => {
    expect(findOpenStackInstanceId(value as string)).toBe(expected);
  });

  test.each([
    [`${UUID}-vda`, "vda"],
    [`instance-00000001-${UUID}-tap1234abcd-ef`, "tap1234abcd-ef"],
    [UUID, null],
    [`${UUID}-`, null],
    ["no uuid here-vda", null],
  ])("the device after it in %s is %s", (value: string, expected: unknown) => {
    expect(findOpenStackDeviceAfterInstanceId(value)).toBe(expected);
  });

  test("only a whole UUID is an instance's id", () => {
    expect(isOpenStackInstanceId(UUID)).toBe(true);
    expect(isOpenStackInstanceId(`${UUID}-vda`)).toBe(false);
    expect(isOpenStackInstanceId("0123456789abcdef0123456789abcdef")).toBe(
      false,
    );
    expect(isOpenStackInstanceId(null)).toBe(false);
  });
});

describe("a Kubernetes node's spec.providerID", () => {
  test.each([
    [`openstack:///${UUID}`, UUID],
    [`openstack://RegionOne/${UUID}`, UUID],
    [`  openstack:///${UUID}  `, UUID],
    [`openstack:///${UUID.toUpperCase()}`, UUID],
    ["aws:///us-east-1a/i-0abc", null],
    [`gce://project/zone/${UUID}`, null],
    [`openstack:///${UUID}/extra`, null],
    ["openstack:///not-a-uuid", null],
    ["", null],
    [null, null],
  ])("%s is %s", (value: unknown, expected: unknown) => {
    expect(getOpenStackInstanceIdOfProviderId(value as string)).toBe(expected);
  });
});

describe("what a cloud chose to keep", () => {
  test("nothing saved means automatic", () => {
    expect(normalizeOpenStackInstanceMetricsOptions(null).options).toEqual(
      getDefaultOpenStackInstanceMetricsOptions(),
    );
    expect(
      normalizeOpenStackInstanceMetricsOptions(undefined).options?.mode,
    ).toBe(OpenStackInstanceMetricsMode.Automatic);
  });

  test("what is saved is cleaned, and anything else in it is dropped", () => {
    expect(
      normalizeOpenStackInstanceMetricsOptions({
        mode: "selected",
        projectIds: [" a ", "a", "", "b"],
        aggregates: ["fast"],
        somethingElse: true,
      }).options,
    ).toEqual({
      mode: OpenStackInstanceMetricsMode.Selected,
      projectIds: ["a", "b"],
      aggregates: ["fast"],
    });
  });

  test.each([
    [{ mode: "everything" }, "automatic, all, selected or off"],
    [{ projectIds: "a" }, "by their IDs"],
    [{ aggregates: [1] }, "by their IDs"],
    ["automatic", "right form"],
    [[], "right form"],
  ])(
    "%j is refused with a sentence that says why",
    (value: unknown, words: string) => {
      expect(normalizeOpenStackInstanceMetricsOptions(value).error).toContain(
        words,
      );
    },
  );

  test("past a stated number of selections, it says to keep all or none", () => {
    const projectIds: Array<string> = Array.from(
      { length: MAX_OPENSTACK_INSTANCE_METRICS_SELECTIONS + 1 },
      (_value: unknown, index: number): string => {
        return `p${index}`;
      },
    );
    expect(
      normalizeOpenStackInstanceMetricsOptions({ projectIds }).error,
    ).toContain("every instance");
  });

  describe("the stated size", () => {
    test("automatic keeps series up to and including it, and stops one past it", () => {
      const options: OpenStackInstanceMetricsOptions = optionsOf(
        OpenStackInstanceMetricsMode.Automatic,
      );
      expect(
        isOpenStackInstanceMetricsOnForCloud({
          options,
          instanceCount: OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
        }),
      ).toBe(true);
      expect(
        isOpenStackInstanceMetricsOnForCloud({
          options,
          instanceCount: OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT + 1,
        }),
      ).toBe(false);
    });

    test("every instance means every instance, at any size", () => {
      expect(
        isOpenStackInstanceMetricsOnForCloud({
          options: optionsOf(OpenStackInstanceMetricsMode.All),
          instanceCount: 1000000,
        }),
      ).toBe(true);
    });

    test("off means off, at any size", () => {
      expect(
        isOpenStackInstanceMetricsOnForCloud({
          options: optionsOf(OpenStackInstanceMetricsMode.Off),
          instanceCount: 1,
        }),
      ).toBe(false);
    });

    test("a cloud that hasn't counted yet is small", () => {
      expect(
        isOpenStackInstanceMetricsOnForCloud({
          options: optionsOf(OpenStackInstanceMetricsMode.Automatic),
          instanceCount: null,
        }),
      ).toBe(true);
    });
  });

  describe("one instance", () => {
    const selected: OpenStackInstanceMetricsOptions = optionsOf(
      OpenStackInstanceMetricsMode.Selected,
      { projectIds: ["chosen"], aggregates: ["fast"] },
    );

    test.each([
      ["its project is chosen", "chosen", [], true],
      ["its hypervisor's aggregate is chosen", "other", ["slow", "fast"], true],
      ["neither is", "other", ["slow"], false],
      ["nothing is known of it yet", null, [], false],
    ])(
      "selected, and %s",
      (
        _name: string,
        projectId: string | null,
        aggregates: Array<string>,
        kept: boolean,
      ) => {
        expect(
          isOpenStackInstanceMetricsKept({
            options: selected,
            instanceCount: 10000,
            projectId,
            aggregates,
          }),
        ).toBe(kept);
      },
    );

    test("selected is not held to the size: choosing is what the size is for", () => {
      expect(
        isOpenStackInstanceMetricsKept({
          options: selected,
          instanceCount: OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT * 100,
          projectId: "chosen",
          aggregates: [],
        }),
      ).toBe(true);
    });

    test("automatic past the size keeps none, whatever its project", () => {
      expect(
        isOpenStackInstanceMetricsKept({
          options: optionsOf(OpenStackInstanceMetricsMode.Automatic),
          instanceCount: OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT + 1,
          projectId: "chosen",
          aggregates: [],
        }),
      ).toBe(false);
    });
  });
});

describe("what keeping them costs", () => {
  test("libvirt: a row per series per collection, once a minute", () => {
    const volume: ReturnType<typeof estimateOpenStackInstanceMetricsVolume> =
      estimateOpenStackInstanceMetricsVolume({
        source: OpenStackInstanceMetricSource.Libvirt,
        instances: 100,
        vcpusPerInstance: 2,
        disksPerInstance: 1,
        interfacesPerInstance: 1,
      });
    // 7 + 2 + 6 + 2 kept, and 5 + 6 + 2 worked out.
    expect(volume.seriesPerInstance).toBe(30);
    expect(volume.series).toBe(3000);
    expect(volume.rowsPerHour).toBe(180000);
    expect(volume.rowsPerMonth).toBe(180000 * 730);
  });

  test("Ceilometer: what it says every two minutes, and only what changed worked out", () => {
    const volume: ReturnType<typeof estimateOpenStackInstanceMetricsVolume> =
      estimateOpenStackInstanceMetricsVolume({
        source: OpenStackInstanceMetricSource.Ceilometer,
        instances: 100,
      });
    // 5 + 6 + 2 kept at 30 an hour, and 5 + 6 + 2 worked out at 12.
    expect(volume.seriesPerInstance).toBe(26);
    expect(volume.rowsPerHour).toBe((13 * 30 + 13 * 12) * 100);
  });

  test("grows with each disk and interface", () => {
    const one: number = estimateOpenStackInstanceMetricsVolume({
      source: OpenStackInstanceMetricSource.Libvirt,
      instances: 1,
    }).seriesPerInstance;
    expect(
      estimateOpenStackInstanceMetricsVolume({
        source: OpenStackInstanceMetricSource.Libvirt,
        instances: 1,
        disksPerInstance: 2,
        interfacesPerInstance: 2,
      }).seriesPerInstance,
    ).toBe(one + 6 + 6 + 2 + 2);
  });

  test("an empty cloud costs nothing", () => {
    expect(
      estimateOpenStackInstanceMetricsVolume({
        source: OpenStackInstanceMetricSource.Libvirt,
        instances: 0,
      }).rowsPerMonth,
    ).toBe(0);
  });
});

describe("the busiest instances", () => {
  const readings: ReturnType<typeof mergeOpenStackInstanceUsage> =
    mergeOpenStackInstanceUsage({
      cpuCores: new Map([
        ["idle", 0.1],
        ["burner", 3.9],
        ["middle", 1],
      ]),
      cpuPercent: new Map([["burner", 97.5]]),
      contentionPercent: new Map([["middle", 20]]),
      memoryResidentBytes: new Map([
        ["holder", 1000],
        ["burner", 10],
      ]),
    });

  test("are ranked by the CPU threads each uses, and an instance reading any one series is in the list", () => {
    expect(
      rankOpenStackInstancesByCpu(readings).map(
        (reading: (typeof readings)[number]): string => {
          return reading.instanceId;
        },
      ),
    ).toEqual(["burner", "middle", "idle", "holder"]);
  });

  test("hold what each source said, and nothing it didn't", () => {
    const burner: (typeof readings)[number] = readings.find(
      (reading: (typeof readings)[number]): boolean => {
        return reading.instanceId === "burner";
      },
    )!;
    expect(burner).toEqual({
      instanceId: "burner",
      cpuCores: 3.9,
      cpuPercent: 97.5,
      contentionPercent: null,
      memoryResidentBytes: 10,
    });
  });

  test("are cut to what was asked for", () => {
    expect(rankOpenStackInstancesByCpu(readings, 2)).toHaveLength(2);
  });

  test("ties fall the same way every time", () => {
    const tied: ReturnType<typeof rankOpenStackInstancesByCpu> =
      rankOpenStackInstancesByCpu(
        mergeOpenStackInstanceUsage({
          cpuCores: new Map([
            ["b", 1],
            ["a", 1],
          ]),
          cpuPercent: new Map(),
          contentionPercent: new Map(),
          memoryResidentBytes: new Map(),
        }),
      );
    expect(tied[0]!.instanceId).toBe("a");
  });
});

describe("every series says its unit", () => {
  test.each([
    ...Object.values(OpenStackInstanceMetric),
    ...Object.values(OpenStackHypervisorMetric),
  ])("%s", (name: string) => {
    expect(
      OPENSTACK_INSTANCE_METRIC_UNITS[
        name as keyof typeof OPENSTACK_INSTANCE_METRIC_UNITS
      ],
    ).toBeTruthy();
  });
});

describe("what a hypervisor has", () => {
  test("is what Placement says, in threads and bytes, before any ratio", () => {
    expect(
      getOpenStackHypervisorCapacity({
        facts: {
          resourceTotals: { VCPU: 8, MEMORY_MB: 16384 },
          allocationRatios: { VCPU: 16, MEMORY_MB: 1.5 },
        },
        vcpuCapacity: 128,
        memoryCapacityBytes: 25769803776,
      }),
    ).toEqual({ cores: 8, memoryBytes: 16384 * 1024 * 1024 });
  });

  test("an older row's capacity is brought back through its ratio", () => {
    expect(
      getOpenStackHypervisorCapacity({
        facts: { allocationRatios: { VCPU: 16, MEMORY_MB: 2 } },
        vcpuCapacity: 128,
        memoryCapacityBytes: 2048,
      }),
    ).toEqual({ cores: 8, memoryBytes: 1024 });
  });

  test("with no ratio, what is promised is taken as it is", () => {
    expect(
      getOpenStackHypervisorCapacity({
        facts: {},
        vcpuCapacity: 8,
        memoryCapacityBytes: 1024,
      }),
    ).toEqual({ cores: 8, memoryBytes: 1024 });
  });

  test("nothing known is nothing, never zero", () => {
    expect(getOpenStackHypervisorCapacity({ facts: null })).toEqual({
      cores: null,
      memoryBytes: null,
    });
  });
});
