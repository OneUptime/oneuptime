import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MAX_DESCRIPTION_LENGTH,
  expectReadableDescriptionRecord,
} from "./MetricDescriptionRules";
import {
  XCP_NG_METRIC_DESCRIPTIONS,
  XcpNgMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_SR_NEAR_FULL_PERCENT } from "../../../Types/Monitor/XcpNgAlertTemplates";
import { XcpNgSeries } from "../../../Types/XcpNg/XcpNgTelemetry";

/*
 * The words behind every (i) on the XCP-ng pages. The shared rules make
 * each one a short, finished sentence in the product's words; the anchors
 * below make each one say what the pages actually read - the inventory's
 * latest report, the series ingest folds into each column, the storage
 * repositories the pool's totals count - and they read the code those
 * claims depend on, so a change that makes a sentence untrue fails here.
 */

const D: Record<XcpNgMetric, string> = XCP_NG_METRIC_DESCRIPTIONS;

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

const SCAN_SOURCE: string = readSource(
  "Common/Server/Utils/Telemetry/XcpNgSnapshotScan.ts",
);
const RESOURCE_SERVICE_SOURCE: string = readSource(
  "Common/Server/Services/XcpNgResourceService.ts",
);

// The names shortened, or spelt as XCP-ng never spells itself.
const XO_SHORT: RegExp = /\bXO\b/;
const SR_SHORT: RegExp = /\bSRs?\b/;
const XCP_NG_MISSPELT: RegExp = /\bxcp-?ng\b/;

const ALL: Array<[XcpNgMetric, string]> = Object.entries(D) as Array<
  [XcpNgMetric, string]
>;

describe("XCP-ng metric descriptions follow the house rules", () => {
  test("every description is a short, finished sentence and no two repeat", () => {
    expectReadableDescriptionRecord(D, "XCP_NG_METRIC_DESCRIPTIONS");

    for (const [, text] of ALL) {
      expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    }
  });

  test("the pages' every part has a text: thirty of them", () => {
    expect(ALL).toHaveLength(30);
  });

  test("the products are named as they name themselves, never shortened", () => {
    for (const [key, text] of ALL) {
      // Xen Orchestra, never "XO"; a storage repository, never "SR", where there is room.
      expect({ key, xo: XO_SHORT.test(text) }).toEqual({ key, xo: false });
      expect({ key, sr: SR_SHORT.test(text) }).toEqual({ key, sr: false });
      expect({ key, xcpng: XCP_NG_MISSPELT.test(text) }).toEqual({
        key,
        xcpng: false,
      });
      // Another hypervisor's words.
      for (const word of ["Proxmox", "guest VM", "node", "vCenter", "ESXi"]) {
        expect({ key, word, found: text.includes(word) }).toEqual({
          key,
          word,
          found: false,
        });
      }
    }
  });

  test("a control domain is explained where a reader first meets one", () => {
    // The Overview's VMs tile, a host's memory and its load.
    for (const key of [
      "vmsRunning",
      "hostMemory",
      "hostLoad",
    ] as Array<XcpNgMetric>) {
      expect({ key, explained: D[key].includes("dom0") }).toEqual({
        key,
        explained: true,
      });
    }
  });

  test("no text weighs a reading against the time picker it ignores without saying so", () => {
    for (const key of [
      "hostAvailability",
      "poolInventoryCounts",
    ] as Array<XcpNgMetric>) {
      expect(D[key]).toContain("rather than the selected time range");
    }
  });
});

describe("the inventory's columns say what ingest folds into them", () => {
  test("a host's CPU is Xen Orchestra's average over its CPU threads", () => {
    expect(SCAN_SOURCE).toContain(`case XcpNgSeries.HostCpuAverage:`);
    expect(SCAN_SOURCE).toContain(
      'setReading(entry, "cpuPercent", data.value * 100, data.observedAt);',
    );
    expect(XcpNgSeries.HostCpuAverage).toBe("xcp_host_cpu_average");

    expect(D.hostCpu).toContain("averaged over all of its CPU threads");
    expect(D.hostsTableCpu).toContain("averaged over all of its CPU threads");
  });

  test("a VM's CPU is its share of the vCPUs it was given", () => {
    expect(SCAN_SOURCE).toContain(`case XcpNgSeries.VmCpuUsage:`);
    expect(XcpNgSeries.VmCpuUsage).toBe("xcp_vm_cpu_usage");

    for (const key of [
      "vmCpu",
      "vmsTableCpu",
      "topVmsByCpu",
    ] as Array<XcpNgMetric>) {
      expect({ key, text: D[key].includes("vCPUs it was given") }).toEqual({
        key,
        text: true,
      });
    }
  });

  test("a host's memory in use is its total less its free memory", () => {
    expect(SCAN_SOURCE).toContain(
      "memoryUsed = Math.max(0, entry.memoryTotalBytes - entry.memoryFreeBytes);",
    );
    expect(D.hostMemory).toContain("its total memory less what is free");
    expect(D.hostMemory).toContain("control domain (dom0)");
  });

  test("a VM's memory in use needs its guest tools", () => {
    // Free memory a VM reports comes from its guest (xcp_vm_memory_internal_free_bytes).
    expect(SCAN_SOURCE).toContain(
      `case XcpNgSeries.VmMemoryInternalFreeBytes:`,
    );

    for (const key of ["vmMemory", "vmsTableMemory"] as Array<XcpNgMetric>) {
      expect({ key, tools: D[key].includes("guest tools") }).toEqual({
        key,
        tools: true,
      });
    }
  });

  test("a host's load is its control domain's load average", () => {
    expect(SCAN_SOURCE).toContain(`case XcpNgSeries.HostLoadAverage:`);
    expect(SCAN_SOURCE).toContain(
      'setReading(entry, "loadAverage", data.value, data.observedAt);',
    );
    expect(D.hostLoad).toContain("control domain (dom0");
  });

  test("a host's running vCPUs and its power are the series Xen Orchestra names them", () => {
    expect(SCAN_SOURCE).toContain(`case XcpNgSeries.HostRunningVcpus:`);
    expect(D.hostRunningVcpus).toContain("vCPUs");
    expect(D.hostPower).toContain("watts");
    expect(D.hostPower).toContain("DCMI or IPMI");
  });
});

describe("the pool's storage totals", () => {
  test("count only the storage repositories that hold VM disks, as the text says", () => {
    // ISO libraries and removable media ("iso", "disk") are left out of both sums.
    expect(RESOURCE_SERVICE_SOURCE).toContain(
      `COALESCE("contentType", '') NOT IN ('iso', 'disk')`,
    );
    expect(D.storageUsed).toContain("that hold VM disks");
    expect(D.storageUsed).toContain("ISO libraries and removable media");
    expect(D.storageUsed).toContain("counted once");
  });

  test("a storage repository's fill names the alert template's own threshold", () => {
    expect(D.storageRepositoryUsed).toContain(
      `above ${XCP_NG_SR_NEAR_FULL_PERCENT}%`,
    );
    expect(D.storageRepositoryUsed).toContain("Storage Repository Near Full");
  });
});

describe("the lists say what each cell shows when there is nothing to report", () => {
  test("the VMs list's memory without guest tools is the memory given, with no bar", () => {
    expect(D.vmsTableMemory).toContain(
      "the column shows the memory it was given, with no bar",
    );
  });

  test("a VM that is not running shows when it last ran", () => {
    expect(D.vmsTableUptime).toContain("when it was last seen running");
  });

  test("control domains are hidden unless shown, and templates never listed", () => {
    expect(D.vmsTableStatus).toContain(
      "Control domains are hidden unless you show them",
    );
    expect(D.vmsTableStatus).toContain("templates are not listed");
  });

  test("a host's status says what Disabled means", () => {
    expect(D.hostsTableStatus).toContain("Disabled");
    expect(D.hostsTableStatus).toContain("maintenance mode");
    expect(D.hostEnabled).toContain("maintenance mode");
  });

  test("an Unknown host is one the pool master could not reach", () => {
    expect(D.hostStatus).toContain(
      "Unknown means the pool master could not reach it",
    );
  });
});
