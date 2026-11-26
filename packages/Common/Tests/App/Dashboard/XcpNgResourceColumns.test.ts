import { describe, expect, test } from "@jest/globals";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import { createTranslator, Translator } from "../../../Types/Translator";
import { EMPTY_VALUE_MARK } from "../../../Types/EmptyValueMark";
import {
  XCP_NG_HOST_COLUMN_DESCRIPTIONS,
  XCP_NG_STORAGE_USAGE_COLUMNS,
  XCP_NG_VM_COLUMN_DESCRIPTIONS,
  getXcpNgHostColumns,
  getXcpNgStorageColumns,
  getXcpNgVmColumns,
  toXcpNgListResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgResourceColumns";
import {
  InfrastructureResource,
  ResourceColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_PAGE_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgPageDescriptions";
import { StorageUsageLevel } from "../../../Utils/Storage/StorageUsage";

/*
 * The rows and columns of an XCP-ng pool's lists - its hosts, VMs and
 * storage repositories, and a host's own tabs (Components/XcpNg/
 * XcpNgResourceColumns): what each cell says, in the reader's words, and
 * what it leaves out.
 */

const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const ENGLISH: Translator = createTranslator(undefined, "en");

type RowFields = {
  [Key in keyof XcpNgResource]?: XcpNgResource[Key] | undefined;
};

function row(fields: RowFields): XcpNgResource {
  return Object.assign(new XcpNgResource(), fields);
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function host(name: string, fields: RowFields = {}): XcpNgResource {
  return row({
    kind: "Host",
    externalId: `host-${name}`,
    name: name,
    powerState: "Running",
    isUp: true,
    isEnabled: true,
    latestCpuPercent: 42,
    latestMemoryBytes: 64 * GIB,
    maxMemoryBytes: 256 * GIB,
    cpuCount: 32,
    runningVcpuCount: 12,
    uptimeSeconds: 41 * 86400 + 5 * 3600,
    metricsUpdatedAt: ago(MINUTE),
    ...fields,
  });
}

function vm(name: string, fields: RowFields = {}): XcpNgResource {
  return row({
    kind: "VM",
    externalId: `vm-${name}`,
    name: name,
    powerState: "Running",
    isUp: true,
    isControlDomain: false,
    parentHostExternalId: "host-a",
    parentHostName: "xcp-01",
    latestCpuPercent: 12,
    maxMemoryBytes: 8 * GIB,
    cpuCount: 4,
    uptimeSeconds: 2 * 86400,
    metricsUpdatedAt: ago(MINUTE),
    ...fields,
  });
}

function sr(name: string, fields: RowFields = {}): XcpNgResource {
  return row({
    kind: "StorageRepository",
    externalId: `sr-${name}`,
    name: name,
    contentType: "user",
    srType: "nfs",
    isShared: true,
    latestDiskBytes: 40 * GIB,
    maxDiskBytes: 100 * GIB,
    virtualAllocationBytes: 60 * GIB,
    ...fields,
  });
}

function list(source: XcpNgResource): InfrastructureResource {
  return toXcpNgListResource(source, { now: NOW, translator: ENGLISH });
}

function cell(
  columns: Array<ResourceColumn>,
  key: string,
  resource: InfrastructureResource,
): string {
  const column: ResourceColumn | undefined = columns.find(
    (candidate: ResourceColumn): boolean => {
      return candidate.key === key;
    },
  );
  if (!column) {
    throw new Error(`no ${key} column`);
  }
  return column.getValue
    ? column.getValue(resource)
    : resource.additionalAttributes[key] || "";
}

describe("a host's row", () => {
  test("its state as Xen Orchestra says it, its CPU and memory, its uptime", () => {
    const resource: InfrastructureResource = list(host("xcp-01"));
    expect(resource.name).toBe("xcp-01");
    expect(resource.status).toBe("Running");
    expect(resource.statusTone).toBe("positive");
    expect(resource.statusReasons).toBeUndefined();
    expect(resource.cpuUtilization).toBe(42);
    expect(resource.memoryUsageBytes).toBe(64 * GIB);
    expect(resource.memoryLimitBytes).toBe(256 * GIB);
    expect(resource.age).toBe("41d 5h");
    expect(resource.namespace).toBe("");
    expect(resource.additionalAttributes["externalId"]).toBe("host-xcp-01");
    expect(resource.additionalAttributes["vcpus"]).toBe("12/32");
  });

  test("a disabled host keeps its state and says so in grey under it: someone chose it", () => {
    const resource: InfrastructureResource = list(
      host("xcp-02", { isEnabled: false }),
    );
    expect(resource.status).toBe("Running");
    expect(resource.statusTone).toBe("positive");
    expect(resource.statusReasons).toEqual([
      { text: "Disabled: starts no new VMs" },
    ]);
  });

  test("a halted host is red, and draws no stale CPU, memory or uptime", () => {
    const resource: InfrastructureResource = list(
      host("xcp-03", { powerState: "Halted", isUp: false }),
    );
    expect(resource.status).toBe("Halted");
    expect(resource.statusTone).toBe("danger");
    expect(resource.cpuUtilization).toBeNull();
    expect(resource.memoryUsageBytes).toBeNull();
    expect(resource.age).toBe("");
  });

  test("a reading older than 15 minutes is no reading of now", () => {
    const resource: InfrastructureResource = list(
      host("xcp-04", { metricsUpdatedAt: ago(HOUR) }),
    );
    expect(resource.cpuUtilization).toBeNull();
    expect(resource.memoryUsageBytes).toBeNull();
  });

  test("power only while it runs; threads alone without running vCPUs", () => {
    expect(
      list(host("a", { powerWatts: 241 })).additionalAttributes["power"],
    ).toBe("241");
    expect(
      list(host("a", { powerWatts: 241, powerState: "Halted", isUp: false }))
        .additionalAttributes["power"],
    ).toBeUndefined();
    const threadsOnly: InfrastructureResource = list(
      host("a", { runningVcpuCount: undefined }),
    );
    expect(threadsOnly.additionalAttributes["vcpus"]).toBeUndefined();
    expect(threadsOnly.additionalAttributes["threads"]).toBe("32");
  });
});

describe("the hosts list's columns", () => {
  const rows: Array<XcpNgResource> = [
    host("a", { externalId: "host-a", powerWatts: 300 }),
    host("b", { externalId: "host-b", runningVcpuCount: undefined }),
    vm("web", { parentHostExternalId: "host-a" }),
    vm("db", {
      parentHostExternalId: "host-a",
      powerState: "Halted",
      isUp: false,
    }),
    vm("dom0", { parentHostExternalId: "host-a", isControlDomain: true }),
  ];
  const resources: Array<InfrastructureResource> = rows
    .filter((candidate: XcpNgResource): boolean => {
      return candidate.kind === "Host";
    })
    .map(list);
  const columns: Array<ResourceColumn> = getXcpNgHostColumns({
    rows: rows,
    resources: resources,
    translator: ENGLISH,
  });

  test("vCPUs on threads, the VMs each runs, and power where a host reports it", () => {
    expect(
      columns.map((column: ResourceColumn): string => {
        return column.title;
      }),
    ).toEqual(["vCPUs/Threads", "VMs", "Power"]);
    expect(cell(columns, "vcpus", resources[0]!)).toBe("12/32");
    expect(cell(columns, "vcpus", resources[1]!)).toBe("32");
    // Its control domain is not one of its VMs.
    expect(cell(columns, "vms", resources[0]!)).toBe("1/2 running");
    expect(cell(columns, "vms", resources[1]!)).toBe(EMPTY_VALUE_MARK);
    expect(cell(columns, "power", resources[0]!)).toBe("300\u00A0W");
    expect(cell(columns, "power", resources[1]!)).toBe(EMPTY_VALUE_MARK);
  });

  test("a count column is drawn in the reader's digits; power folds under CPU on a narrow screen", () => {
    const vcpus: ResourceColumn = columns[0]!;
    expect(vcpus.isCount).toBe(true);
    const power: ResourceColumn = columns[2]!;
    expect(power.foldInto).toBe("cpuUtilization");
  });

  test("no VM reported, no power reported: no column of dashes", () => {
    expect(
      getXcpNgHostColumns({
        rows: [host("a")],
        resources: [list(host("a"))],
        translator: ENGLISH,
      }).map((column: ResourceColumn): string => {
        return column.title;
      }),
    ).toEqual(["vCPUs/Threads"]);
  });

  test("each column says what it means, in the shared catalog's words where it has them", () => {
    expect(XCP_NG_HOST_COLUMN_DESCRIPTIONS).toEqual({
      status: XCP_NG_METRIC_DESCRIPTIONS.hostsTableStatus,
      cpu: XCP_NG_METRIC_DESCRIPTIONS.hostsTableCpu,
      memory: XCP_NG_METRIC_DESCRIPTIONS.hostsTableMemory,
      age: XCP_NG_METRIC_DESCRIPTIONS.hostsTableUptime,
    });
    expect(columns[0]!.description).toBe(
      XCP_NG_PAGE_DESCRIPTIONS.hostsTableVcpus,
    );
  });
});

describe("a VM's row", () => {
  test("its host, its state, its vCPUs and tags", () => {
    const resource: InfrastructureResource = list(
      vm("web-01", { tags: "production,web" }),
    );
    expect(resource.namespace).toBe("xcp-01");
    expect(resource.status).toBe("Running");
    expect(resource.age).toBe("2d 0h");
    expect(resource.additionalAttributes["vcpus"]).toBe("4");
    expect(resource.additionalAttributes["tags"]).toBe("production, web");
  });

  test("memory in use while its guest tools say, as a bar against what it was given", () => {
    const resource: InfrastructureResource = list(
      vm("a", { latestMemoryBytes: 2 * GIB }),
    );
    expect(resource.memoryUsageBytes).toBe(2 * GIB);
    expect(resource.memoryLimitBytes).toBe(8 * GIB);
  });

  test("without the guest tools: what it was given, plain, with no bar that would read as full", () => {
    const resource: InfrastructureResource = list(
      vm("a", { latestMemoryBytes: undefined }),
    );
    expect(resource.memoryUsageBytes).toBe(8 * GIB);
    expect(resource.memoryLimitBytes).toBeNull();
  });

  test("a stopped VM says when it last ran, amber when it stopped in the last day", () => {
    const resource: InfrastructureResource = list(
      vm("db", {
        powerState: "Halted",
        isUp: false,
        lastRunningAt: ago(3 * HOUR),
      }),
    );
    expect(resource.status).toBe("Halted");
    expect(resource.statusTone).toBe("warning");
    // The figure held to its word, as a page draws it.
    expect(resource.age).toBe("Last running 3\u00A0hours ago");
    expect(resource.cpuUtilization).toBeNull();
  });

  test("halted and left off, grey; suspended, grey; never seen running, no age", () => {
    const off: InfrastructureResource = list(
      vm("old", {
        powerState: "Halted",
        isUp: false,
        lastRunningAt: ago(9 * 24 * HOUR),
      }),
    );
    expect(off.statusTone).toBe("neutral");
    const suspended: InfrastructureResource = list(
      vm("win", { powerState: "Suspended", isUp: false }),
    );
    expect(suspended.status).toBe("Suspended");
    expect(suspended.statusTone).toBe("neutral");
    const never: InfrastructureResource = list(
      vm("new", {
        powerState: "Halted",
        isUp: false,
        lastRunningAt: undefined,
      }),
    );
    expect(never.age).toBe("");
  });

  test("a control domain, when shown, is marked as one", () => {
    const resource: InfrastructureResource = list(
      vm("Control domain on host: xcp-01", {
        isControlDomain: true,
        powerState: undefined,
      }),
    );
    expect(resource.status).toBe("Running");
    expect(resource.statusReasons).toEqual([{ text: "Control domain" }]);
  });
});

describe("the VMs list's columns", () => {
  test("vCPUs, and tags where a VM has some, folded under the name on a narrow screen", () => {
    const resources: Array<InfrastructureResource> = [
      list(vm("a", { tags: "web" })),
      list(vm("b", { cpuCount: undefined })),
    ];
    const columns: Array<ResourceColumn> = getXcpNgVmColumns({
      resources: resources,
    });
    expect(
      columns.map((column: ResourceColumn): string => {
        return column.title;
      }),
    ).toEqual(["vCPUs", "Tags"]);
    expect(cell(columns, "vcpus", resources[0]!)).toBe("4");
    expect(cell(columns, "vcpus", resources[1]!)).toBe(EMPTY_VALUE_MARK);
    expect(cell(columns, "tags", resources[1]!)).toBe(EMPTY_VALUE_MARK);
    expect(columns[1]!.foldInto).toBe("name");
    expect(columns[1]!.isName).toBe(true);
    expect(
      getXcpNgVmColumns({
        resources: [list(vm("c", { cpuCount: undefined }))],
      }),
    ).toEqual([]);
    expect(XCP_NG_VM_COLUMN_DESCRIPTIONS.memory).toBe(
      XCP_NG_METRIC_DESCRIPTIONS.vmsTableMemory,
    );
  });
});

describe("a storage repository's row", () => {
  test("shared by the pool, or local to its host: one column", () => {
    expect(list(sr("nfs")).namespace).toBe("Shared");
    expect(
      list(sr("local", { isShared: false, parentHostName: "xcp-01" }))
        .namespace,
    ).toBe("xcp-01");
    expect(list(sr("odd", { isShared: undefined })).namespace).toBe("");
  });

  test("'Shared' is in the reader's words; a host's name as written", () => {
    const german: Translator = createTranslator((text: string) => {
      return text === "Shared" ? "Freigegeben" : undefined;
    }, "de");
    expect(
      toXcpNgListResource(sr("nfs"), { now: NOW, translator: german })
        .namespace,
    ).toBe("Freigegeben");
  });

  test("how full it is, at the pool's lines; no size, no bar but words", () => {
    const resource: InfrastructureResource = list(
      sr("nfs", { latestDiskBytes: 92 * GIB }),
    );
    expect(resource.storageUsage?.usage?.usedPercent).toBe(92);
    expect(resource.storageUsage?.usage?.level).toBe(StorageUsageLevel.Warning);
    const iso: InfrastructureResource = list(
      sr("tools", { contentType: "iso", maxDiskBytes: 0 }),
    );
    expect(iso.storageUsage?.usage).toBeNull();
    expect(iso.storageUsage?.noUsageText).toBe("Not measured");
    expect(resource.status).toBe("");
    expect(XCP_NG_STORAGE_USAGE_COLUMNS).toEqual({
      usedDescription: XCP_NG_METRIC_DESCRIPTIONS.storageTableUsed,
      freeDescription: XCP_NG_PAGE_DESCRIPTIONS.storageFree,
    });
  });
});

describe("the storage list's columns", () => {
  const rows: Array<XcpNgResource> = [
    sr("nfs", { externalId: "sr-nfs" }),
    sr("thin", {
      externalId: "sr-thin",
      srType: "lvmoiscsi",
      virtualAllocationBytes: 150 * GIB,
    }),
    sr("tools", {
      externalId: "sr-tools",
      contentType: "iso",
      srType: "iso",
      maxDiskBytes: 0,
      latestDiskBytes: 0,
      virtualAllocationBytes: 0,
    }),
    row({
      kind: "VDI",
      externalId: "d1",
      storageRepositoryExternalId: "sr-nfs",
    }),
    row({
      kind: "VDI",
      externalId: "d2",
      storageRepositoryExternalId: "sr-nfs",
    }),
    row({
      kind: "VDI",
      externalId: "d3",
      storageRepositoryExternalId: "sr-thin",
    }),
  ];
  const resources: Array<InfrastructureResource> = rows
    .filter((candidate: XcpNgResource): boolean => {
      return candidate.kind === "StorageRepository";
    })
    .map(list);
  const columns: Array<ResourceColumn> = getXcpNgStorageColumns({
    rows: rows,
    resources: resources,
    translator: ENGLISH,
  });

  test("size, allocated, type, content and virtual disks", () => {
    expect(
      columns.map((column: ResourceColumn): string => {
        return column.title;
      }),
    ).toEqual(["Size", "Allocated", "Type", "Content", "Virtual Disks"]);
    expect(cell(columns, "size", resources[0]!)).toBe("100\u00A0GiB");
    expect(cell(columns, "size", resources[2]!)).toBe(EMPTY_VALUE_MARK);
    expect(cell(columns, "srType", resources[1]!)).toBe("iSCSI (LVM)");
    expect(cell(columns, "contentType", resources[0]!)).toBe("VM disks");
    expect(cell(columns, "contentType", resources[2]!)).toBe("ISO library");
    expect(cell(columns, "virtualDisks", resources[0]!)).toBe("2");
    expect(cell(columns, "virtualDisks", resources[2]!)).toBe("0");
  });

  test("allocated against the size, in amber and in words when it is past it", () => {
    const allocated: ResourceColumn = columns[1]!;
    expect(cell(columns, "allocated", resources[0]!)).toBe("60\u00A0GiB (60%)");
    expect(cell(columns, "allocated", resources[1]!)).toBe(
      "150\u00A0GiB (150%): over-provisioned",
    );
    expect(allocated.getTone!(resources[0]!)).toBeUndefined();
    expect(allocated.getTone!(resources[1]!)).toBe("warning");
    // No allocation at all reads as nothing.
    expect(cell(columns, "allocated", resources[2]!)).toBe(EMPTY_VALUE_MARK);
  });

  test("a host's own storage tab draws no virtual disk count it did not read", () => {
    expect(
      getXcpNgStorageColumns({
        rows: rows,
        resources: resources,
        translator: ENGLISH,
        showVirtualDisks: false,
      }).map((column: ResourceColumn): string => {
        return column.title;
      }),
    ).toEqual(["Size", "Allocated", "Type", "Content"]);
  });

  test("the size folds under the Used bar; the disk count is a count", () => {
    expect(columns[0]!.foldInto).toBe("storageUsage");
    expect(columns[4]!.isCount).toBe(true);
  });
});
