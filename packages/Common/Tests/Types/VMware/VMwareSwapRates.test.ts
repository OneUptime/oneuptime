import {
  VMWARE_SWAP_RATE_COUNTER_METRICS,
  VMWARE_SWAP_RATE_METRICS,
  VMWARE_SWAP_RATE_METRIC_NAME_PREFIX,
  VMWARE_SWAP_RATE_METRIC_UNIT,
  VMWARE_SWAP_RATE_SOURCE_ATTRIBUTE,
  VMWARE_SWAP_RATE_SOURCE_VALUES,
  VMwareSwapRateCounterMetric,
  VMwareSwapRateMetric,
  VMwareSwapRateSource,
  VSPHERE_SWAP_IN_RATE_COUNTER,
  VSPHERE_SWAP_OUT_RATE_COUNTER,
  getVMwareSwapRateMetricDescription,
  isVMwareSwapRateMetricName,
  toVSphereBytesPerSecond,
} from "../../../Types/VMware/VMwareSwapRates";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether a VMware part is swapping now (#11468): vSphere's own swap rate
 * counters, the metrics a probe sends them as, and the swap rates OneUptime
 * writes for every VM and resource pool from either collector's reports.
 */

describe("vSphere's counters and the probe's metrics", () => {
  test("are the level-1 mem counters, named as vSphere names them", () => {
    expect(VSPHERE_SWAP_OUT_RATE_COUNTER).toBe("mem.swapoutRate.average");
    expect(VSPHERE_SWAP_IN_RATE_COUNTER).toBe("mem.swapinRate.average");
  });

  test("are sent as vcenter.* metrics, a VM's and a host's", () => {
    expect([...VMWARE_SWAP_RATE_COUNTER_METRICS].sort()).toEqual([
      "vcenter.host.memory.swap_in.rate",
      "vcenter.host.memory.swap_out.rate",
      "vcenter.vm.memory.swap_in.rate",
      "vcenter.vm.memory.swap_out.rate",
    ]);
    // The probe's own vSphere rates are not OneUptime's reserved names.
    for (const metric of VMWARE_SWAP_RATE_COUNTER_METRICS) {
      expect(isVMwareSwapRateMetricName(metric)).toBe(false);
    }
    expect(VMwareSwapRateCounterMetric.VirtualMachineSwapOut).toBe(
      "vcenter.vm.memory.swap_out.rate",
    );
  });
});

describe("OneUptime's swap rate metrics", () => {
  test("a VM's and a resource pool's, in each direction, in By/s", () => {
    expect(VMWARE_SWAP_RATE_METRICS).toEqual([
      "oneuptime.vmware.vm.memory.swap_out.rate",
      "oneuptime.vmware.vm.memory.swap_in.rate",
      "oneuptime.vmware.resource_pool.memory.swap_out.rate",
      "oneuptime.vmware.resource_pool.memory.swap_in.rate",
    ]);
    expect(VMWARE_SWAP_RATE_METRIC_UNIT).toBe("By/s");
    for (const metric of VMWARE_SWAP_RATE_METRICS) {
      expect(metric.startsWith(VMWARE_SWAP_RATE_METRIC_NAME_PREFIX)).toBe(true);
    }
  });

  test("each says what it is, and the VM's where it comes from", () => {
    for (const metric of VMWARE_SWAP_RATE_METRICS) {
      const description: string = getVMwareSwapRateMetricDescription(metric);
      expect(description.length).toBeGreaterThan(40);
      expect(description).toContain("bytes per second");
    }
    expect(
      getVMwareSwapRateMetricDescription(
        VMwareSwapRateMetric.VirtualMachineSwapOut,
      ),
    ).toContain("mem.swapoutRate");
    expect(
      getVMwareSwapRateMetricDescription(VMwareSwapRateMetric.ResourcePoolSwapOut),
    ).not.toContain("mem.swapoutRate");
  });

  test("say where a point's rate came from, in a datapoint attribute", () => {
    expect(VMWARE_SWAP_RATE_SOURCE_ATTRIBUTE).toBe("source");
    expect(VMWARE_SWAP_RATE_SOURCE_VALUES).toEqual({
      [VMwareSwapRateSource.VSphere]: "vsphere",
      [VMwareSwapRateSource.Derived]: "derived",
    });
    expect(Object.values(VMwareSwapRateSource).sort()).toEqual([
      "Derived",
      "vSphere",
    ]);
  });

  test("are told by their reserved prefix, in any letter case, and nothing near it", () => {
    for (const name of [
      ...VMWARE_SWAP_RATE_METRICS,
      "oneuptime.vmware.host.memory.swap_out.rate",
      "OneUptime.VMware.VM.Memory.Swap_Out.Rate",
      "  oneuptime.vmware.vm.memory.swap_in.rate ",
    ]) {
      expect({ name, reserved: isVMwareSwapRateMetricName(name) }).toEqual({
        name,
        reserved: true,
      });
    }
    for (const name of [
      "oneuptime.vmware",
      "oneuptime.vmwares.vm",
      "custom.oneuptime.vmware.vm.memory.swap_out.rate",
      "vcenter.vm.memory.swapped",
      "",
      null,
      undefined,
    ]) {
      expect({ name, reserved: isVMwareSwapRateMetricName(name) }).toEqual({
        name,
        reserved: false,
      });
    }
  });
});

describe("toVSphereBytesPerSecond", () => {
  test("reads vSphere's kilobytes and megabytes per second as bytes per second", () => {
    expect(toVSphereBytesPerSecond(512, "kiloBytesPerSecond")).toBe(524288);
    expect(toVSphereBytesPerSecond(2, "megaBytesPerSecond")).toBe(2097152);
    expect(toVSphereBytesPerSecond(0, "kiloBytesPerSecond")).toBe(0);
    expect(toVSphereBytesPerSecond(1.5, " kiloBytesPerSecond ")).toBe(1536);
  });

  test("a unit no rate is in, a missing sample (-1) or not a number is no rate", () => {
    expect(toVSphereBytesPerSecond(5, "percent")).toBeNull();
    expect(toVSphereBytesPerSecond(5, null)).toBeNull();
    expect(toVSphereBytesPerSecond(5, undefined)).toBeNull();
    expect(toVSphereBytesPerSecond(-1, "kiloBytesPerSecond")).toBeNull();
    expect(
      toVSphereBytesPerSecond(Number.NaN, "kiloBytesPerSecond"),
    ).toBeNull();
    expect(
      toVSphereBytesPerSecond(Number.POSITIVE_INFINITY, "kiloBytesPerSecond"),
    ).toBeNull();
  });
});
