import {
  ParsedXcpNgResource,
  XcpNgPoolResourceBuffer,
  XcpNgPoolSnapshotBufferEntry,
  bufferXcpNgSnapshotMetric,
  emptyXcpNgResourceEntry,
  getXcpNgDatapointTime,
  getXcpNgDatapointValue,
  getXcpNgLabel,
  getXcpNgResourceRows,
  isXcpNgSnapshotMetric,
  isXcpNgStaleDatapoint,
} from "../../../../Server/Utils/Telemetry/XcpNgSnapshotScan";
import XcpNgResourceKind from "../../../../Types/XcpNg/XcpNgResourceKind";
import { JSONObject } from "../../../../Types/JSON";
import {
  PRODUCTION_POOL_ID,
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  UNNAMED_POOL_ID,
  getDatapoints,
  getResourceOfPool,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "./XcpNgScrapeFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * The XCP-ng snapshot scan against the recorded Xen Orchestra scrapes: two
 * XCP-ng 8.3 pools behind one Xen Orchestra 6.9 (xo-server-openmetrics
 * 1.9.4's exact output, Fixtures/XcpNg), turned into the OTLP the XCP-ng
 * Agent sends, and folded the way the metrics ingest folds it - every
 * datapoint of a pool's block through bufferXcpNgSnapshotMetric.
 */

const GiB: number = 1024 * 1024 * 1024;

const HOST: { prod1: string; prod2: string; prod3: string; lab1: string } = {
  prod1: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
  prod2: "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
  prod3: "f0e1d2c3-b4a5-4968-8776-655443322110",
  lab1: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
};

const VM: {
  web01: string;
  db01: string;
  app02: string;
  win03: string;
  dom0prod1: string;
  dom0prod2: string;
  labvm01: string;
  dom0lab1: string;
} = {
  web01: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
  db01: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  app02: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
  win03: "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
  dom0prod1: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
  dom0prod2: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  labvm01: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  dom0lab1: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
};

const SR: {
  prodLocal: string;
  prodNfs: string;
  prodTools: string;
  labLocal: string;
} = {
  prodLocal: "ad4b8c63-1f2e-4d3c-8b4a-596877665544",
  prodNfs: "1d2c3b4a-5e6f-4789-9abc-def012345678",
  prodTools: "c0ffee00-1111-4222-8333-444455556666",
  labLocal: "77aa88bb-99cc-4ddd-8eee-ff0011223344",
};

const VDI: {
  web01Disk: string;
  db01Disk: string;
  orphanDisk: string;
  labDisk: string;
} = {
  web01Disk: "aa11bb22-cc33-4d44-8e55-ff6677889900",
  db01Disk: "bb22cc33-dd44-4e55-8f66-007788990011",
  orphanDisk: "cc33dd44-ee55-4f66-8077-118899001122",
  labDisk: "dd44ee55-ff66-4077-8188-229900112233",
};

interface Folded {
  resourceBuffer: Map<string, XcpNgPoolResourceBuffer>;
  poolBuffer: Map<string, XcpNgPoolSnapshotBufferEntry>;
}

function foldScrape(
  scrape: 1 | 2,
  options: { staleSeries?: Array<string> } = {},
): Folded {
  const resourceMetrics: Array<JSONObject> = toAgentResourceMetrics(
    parseOpenMetrics(readRecordedScrape(scrape)),
    {
      scrapeSeconds: scrape === 1 ? SCRAPE_1_NOW_SECONDS : SCRAPE_2_NOW_SECONDS,
      staleSeries: options.staleSeries || [],
    },
  );
  const folded: Folded = { resourceBuffer: new Map(), poolBuffer: new Map() };
  for (const poolId of [PRODUCTION_POOL_ID, UNNAMED_POOL_ID]) {
    for (const { metricName, datapoint } of getDatapoints(
      getResourceOfPool(resourceMetrics, poolId),
    )) {
      bufferXcpNgSnapshotMetric({
        poolIdStr: poolId,
        metricName,
        datapoint,
        resourceBuffer: folded.resourceBuffer,
        poolBuffer: folded.poolBuffer,
      });
    }
  }
  return folded;
}

function rowsOf(folded: Folded, poolId: string): Array<ParsedXcpNgResource> {
  return getXcpNgResourceRows(folded.resourceBuffer.get(poolId));
}

function rowOf(
  rows: Array<ParsedXcpNgResource>,
  kind: XcpNgResourceKind,
  externalId: string,
): ParsedXcpNgResource {
  const row: ParsedXcpNgResource | undefined = rows.find(
    (r: ParsedXcpNgResource) => {
      return r.kind === kind && r.externalId === externalId;
    },
  );
  if (!row) {
    throw new Error(`No ${kind} row ${externalId}`);
  }
  return row;
}

function countOf(
  rows: Array<ParsedXcpNgResource>,
  kind: XcpNgResourceKind,
): number {
  return rows.filter((r: ParsedXcpNgResource) => {
    return r.kind === kind;
  }).length;
}

function dp(
  labels: Record<string, string>,
  value: number | string,
  options: { seconds?: number; flags?: number; asInt?: boolean } = {},
): JSONObject {
  const point: JSONObject = {
    attributes: Object.entries(labels).map(([key, v]: [string, string]) => {
      return { key, value: { stringValue: v } };
    }),
    timeUnixNano: `${options.seconds ?? SCRAPE_1_NOW_SECONDS}000000000`,
  };
  if (options.asInt) {
    point["asInt"] = value;
  } else {
    point["asDouble"] = value;
  }
  if (options.flags !== undefined) {
    point["flags"] = options.flags;
  }
  return point;
}

function freshBuffers(): Folded {
  return { resourceBuffer: new Map(), poolBuffer: new Map() };
}

function feed(
  folded: Folded,
  metricName: string,
  datapoint: JSONObject,
  poolId: string = PRODUCTION_POOL_ID,
): void {
  bufferXcpNgSnapshotMetric({
    poolIdStr: poolId,
    metricName,
    datapoint,
    resourceBuffer: folded.resourceBuffer,
    poolBuffer: folded.poolBuffer,
  });
}

describe("XcpNgSnapshotScan against the recorded scrape", () => {
  describe("two pools behind one Xen Orchestra", () => {
    const scrape1: Folded = foldScrape(1);

    test("each pool is folded on its own", () => {
      expect(Array.from(scrape1.resourceBuffer.keys()).sort()).toEqual(
        [PRODUCTION_POOL_ID, UNNAMED_POOL_ID].sort(),
      );
    });

    test("both pools were read, and both reported connected", () => {
      for (const poolId of [PRODUCTION_POOL_ID, UNNAMED_POOL_ID]) {
        const snap: XcpNgPoolSnapshotBufferEntry | undefined =
          scrape1.poolBuffer.get(poolId);
        expect(snap?.wasRead).toBe(true);
        expect(snap?.sawPoolConnected).toBe(true);
        expect(snap?.readAt).toBeInstanceOf(Date);
      }
    });

    test("the Production pool has its 3 hosts, 6 VMs (2 control domains), 3 storage repositories and 3 virtual disks", () => {
      const rows: Array<ParsedXcpNgResource> = rowsOf(
        scrape1,
        PRODUCTION_POOL_ID,
      );
      expect(countOf(rows, XcpNgResourceKind.Host)).toBe(3);
      expect(countOf(rows, XcpNgResourceKind.VM)).toBe(6);
      expect(
        rows.filter((r: ParsedXcpNgResource) => {
          return r.kind === XcpNgResourceKind.VM && r.isControlDomain;
        }).length,
      ).toBe(2);
      expect(countOf(rows, XcpNgResourceKind.StorageRepository)).toBe(3);
      expect(countOf(rows, XcpNgResourceKind.VDI)).toBe(3);
    });

    test("the unnamed pool has its host, its VM and control domain, its storage repository and disk", () => {
      const rows: Array<ParsedXcpNgResource> = rowsOf(scrape1, UNNAMED_POOL_ID);
      expect(countOf(rows, XcpNgResourceKind.Host)).toBe(1);
      expect(countOf(rows, XcpNgResourceKind.VM)).toBe(2);
      expect(countOf(rows, XcpNgResourceKind.StorageRepository)).toBe(1);
      expect(countOf(rows, XcpNgResourceKind.VDI)).toBe(1);
      expect(rowOf(rows, XcpNgResourceKind.Host, HOST.lab1).name).toBe(
        "xcp-lab-01",
      );
    });

    test("no object of one pool leaks into the other", () => {
      const prodIds: Set<string> = new Set(
        rowsOf(scrape1, PRODUCTION_POOL_ID).map((r: ParsedXcpNgResource) => {
          return r.externalId;
        }),
      );
      for (const row of rowsOf(scrape1, UNNAMED_POOL_ID)) {
        expect(prodIds.has(row.externalId)).toBe(false);
      }
    });
  });

  describe("hosts", () => {
    const rows: Array<ParsedXcpNgResource> = rowsOf(
      foldScrape(1),
      PRODUCTION_POOL_ID,
    );

    test("a running, enabled host with its readings", () => {
      const host: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.Host,
        HOST.prod1,
      );
      expect(host.name).toBe("xcp-prod-01");
      expect(host.powerState).toBe("Running");
      expect(host.isUp).toBe(true);
      expect(host.isEnabled).toBe(true);
      expect(host.latestCpuPercent).toBe(62);
      expect(host.cpuCount).toBe(4);
      expect(host.maxMemoryBytes).toBe(64 * GiB);
      expect(host.latestMemoryBytes).toBe(55 * GiB);
      expect(host.latestMemoryPercent).toBe(85.94);
      expect(host.uptimeSeconds).toBe(10 * 86400);
      expect(host.loadAverage).toBe(2.48);
      // web-01 (2 vCPUs) and its control domain (4) run on it.
      expect(host.runningVcpuCount).toBe(6);
      expect(host.tags).toBe("rack-a");
    });

    test("the host power read over IPMI names no pool, so the agent drops it", () => {
      expect(rowOf(rows, XcpNgResourceKind.Host, HOST.prod1).powerWatts).toBe(
        null,
      );
    });

    test("a host in maintenance mode is running and disabled", () => {
      const host: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.Host,
        HOST.prod2,
      );
      expect(host.isUp).toBe(true);
      expect(host.isEnabled).toBe(false);
      expect(host.tags).toBe("");
    });

    test("a halted host is reported by its status alone", () => {
      const host: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.Host,
        HOST.prod3,
      );
      expect(host.powerState).toBe("Halted");
      expect(host.isUp).toBe(false);
      expect(host.isEnabled).toBe(true);
      expect(host.latestCpuPercent).toBe(null);
      expect(host.maxMemoryBytes).toBe(null);
      expect(host.uptimeSeconds).toBe(null);
      expect(host.cpuCount).toBe(null);
    });

    test("hosts are never storage repositories' or VMs' parents of themselves", () => {
      for (const host of rows.filter((r: ParsedXcpNgResource) => {
        return r.kind === XcpNgResourceKind.Host;
      })) {
        expect(host.parentHostExternalId).toBe(null);
        expect(host.isControlDomain).toBe(null);
      }
    });
  });

  describe("VMs", () => {
    const rows: Array<ParsedXcpNgResource> = rowsOf(
      foldScrape(1),
      PRODUCTION_POOL_ID,
    );

    test("a running VM with its host, its readings and its tags", () => {
      const vm: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.web01,
      );
      expect(vm.name).toBe("web-01");
      expect(vm.powerState).toBe("Running");
      expect(vm.isUp).toBe(true);
      expect(vm.isControlDomain).toBe(false);
      expect(vm.parentHostExternalId).toBe(HOST.prod1);
      expect(vm.parentHostName).toBe("xcp-prod-01");
      expect(vm.latestCpuPercent).toBe(24);
      expect(vm.cpuCount).toBe(2);
      expect(vm.maxMemoryBytes).toBe(4 * GiB);
      // The guest reports 35% free: 65% in use.
      expect(vm.latestMemoryPercent).toBe(65);
      expect(vm.uptimeSeconds).toBe(48 * 3600);
      expect(vm.tags).toBe("production,web");
      expect(vm.lastRunningAt).toEqual(new Date(SCRAPE_1_NOW_SECONDS * 1000));
    });

    test("a VM on the host in maintenance mode still names that host", () => {
      expect(
        rowOf(rows, XcpNgResourceKind.VM, VM.db01).parentHostExternalId,
      ).toBe(HOST.prod2);
    });

    test("a halted VM is in the inventory, with no host and no readings", () => {
      const vm: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.app02,
      );
      expect(vm.powerState).toBe("Halted");
      expect(vm.isUp).toBe(false);
      expect(vm.parentHostExternalId).toBe(null);
      expect(vm.latestCpuPercent).toBe(null);
      expect(vm.uptimeSeconds).toBe(null);
      expect(vm.lastRunningAt).toBe(null);
    });

    test("a suspended VM is not up", () => {
      const vm: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.win03,
      );
      expect(vm.powerState).toBe("Suspended");
      expect(vm.isUp).toBe(false);
      expect(vm.tags).toBe("windows");
    });

    test("a control domain is a VM marked as one, running, on its host", () => {
      const dom0: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.dom0prod1,
      );
      expect(dom0.name).toBe("Control domain on host: xcp-prod-01");
      expect(dom0.isControlDomain).toBe(true);
      expect(dom0.powerState).toBe("Running");
      expect(dom0.isUp).toBe(true);
      expect(dom0.parentHostExternalId).toBe(HOST.prod1);
      // A control domain reports no free memory: its use stays unknown.
      expect(dom0.latestMemoryBytes).toBe(null);
      expect(dom0.latestMemoryPercent).toBe(null);
    });
  });

  describe("storage repositories and virtual disks", () => {
    const rows: Array<ParsedXcpNgResource> = rowsOf(
      foldScrape(1),
      PRODUCTION_POOL_ID,
    );

    test("a shared storage repository, its fill and its over-allocation", () => {
      const sr: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.StorageRepository,
        SR.prodNfs,
      );
      expect(sr.name).toBe("NFS VM store");
      expect(sr.srType).toBe("nfs");
      expect(sr.contentType).toBe("user");
      expect(sr.isShared).toBe(true);
      expect(sr.parentHostExternalId).toBe(null);
      expect(sr.maxDiskBytes).toBe(2048 * GiB);
      expect(sr.latestDiskBytes).toBe(Math.round(1894.4 * GiB));
      expect(sr.latestDiskPercent).toBe(92.5);
      expect(sr.virtualAllocationBytes).toBe(Math.round(2662.4 * GiB));
      expect(sr.virtualAllocationBytes!).toBeGreaterThan(sr.maxDiskBytes!);
      expect(sr.tags).toBe("shared-storage");
    });

    test("a local storage repository names its host", () => {
      const sr: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.StorageRepository,
        SR.prodLocal,
      );
      expect(sr.isShared).toBe(false);
      expect(sr.parentHostExternalId).toBe(HOST.prod1);
      expect(sr.parentHostName).toBe("xcp-prod-01");
      expect(sr.srType).toBe("lvm");
      expect(sr.latestDiskPercent).toBe(24);
    });

    test("an ISO library that reports no size has no fill percentage", () => {
      const sr: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.StorageRepository,
        SR.prodTools,
      );
      expect(sr.maxDiskBytes).toBe(0);
      expect(sr.latestDiskPercent).toBe(null);
      expect(sr.contentType).toBe("iso");
    });

    test("a virtual disk names its storage repository and its VM", () => {
      const vdi: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VDI,
        VDI.web01Disk,
      );
      expect(vdi.name).toBe("web-01 system");
      expect(vdi.storageRepositoryExternalId).toBe(SR.prodNfs);
      expect(vdi.storageRepositoryName).toBe("NFS VM store");
      expect(vdi.srType).toBe("nfs");
      expect(vdi.vmExternalId).toBe(VM.web01);
      expect(vdi.vmName).toBe("web-01");
      expect(vdi.maxDiskBytes).toBe(20 * GiB);
      expect(vdi.latestDiskBytes).toBe(8 * GiB);
      // A disk's fill against its virtual size is not a storage alarm.
      expect(vdi.latestDiskPercent).toBe(null);
    });

    test("a disk attached to no VM names none", () => {
      const vdi: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VDI,
        VDI.orphanDisk,
      );
      expect(vdi.vmExternalId).toBe(null);
      expect(vdi.vmName).toBe(null);
    });

    test("the host disk series per storage repository never fold into it", () => {
      const sr: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.StorageRepository,
        SR.prodNfs,
      );
      expect(sr.latestCpuPercent).toBe(null);
      expect(sr.uptimeSeconds).toBe(null);
    });
  });

  describe("a minute later (scrape 2)", () => {
    const rows: Array<ParsedXcpNgResource> = rowsOf(
      foldScrape(2),
      PRODUCTION_POOL_ID,
    );

    test("the VM shut down reads halted, and this batch did not see it run", () => {
      const vm: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.web01,
      );
      expect(vm.powerState).toBe("Halted");
      expect(vm.isUp).toBe(false);
      expect(vm.lastRunningAt).toBe(null);
    });

    test("the VM started runs on its host", () => {
      const vm: ParsedXcpNgResource = rowOf(
        rows,
        XcpNgResourceKind.VM,
        VM.app02,
      );
      expect(vm.powerState).toBe("Running");
      expect(vm.parentHostExternalId).toBe(HOST.prod1);
      expect(vm.lastRunningAt).toEqual(new Date(SCRAPE_2_NOW_SECONDS * 1000));
    });

    test("the deleted disk is gone from the batch", () => {
      expect(
        rows.some((r: ParsedXcpNgResource) => {
          return r.externalId === VDI.orphanDisk;
        }),
      ).toBe(false);
      expect(countOf(rows, XcpNgResourceKind.VDI)).toBe(2);
    });

    test("the storage repository filled to 93%", () => {
      expect(
        rowOf(rows, XcpNgResourceKind.StorageRepository, SR.prodNfs)
          .latestDiskPercent,
      ).toBe(93);
    });

    test("the host's running vCPUs follow its VMs", () => {
      // app-02 (1) and the control domain (4); web-01 stopped.
      expect(
        rowOf(rows, XcpNgResourceKind.Host, HOST.prod1).runningVcpuCount,
      ).toBe(5);
    });
  });

  describe("staleness markers", () => {
    test("a pool whose every series just disappeared was not read", () => {
      const allNames: Array<string> = Array.from(
        new Set(
          parseOpenMetrics(readRecordedScrape(1)).map((s: { name: string }) => {
            return s.name;
          }),
        ),
      );
      const folded: Folded = foldScrape(1, { staleSeries: allNames });
      expect(folded.poolBuffer.size).toBe(0);
      expect(folded.resourceBuffer.size).toBe(0);
    });

    test("a VM whose status series disappeared does not look reported", () => {
      const folded: Folded = foldScrape(1, {
        staleSeries: ["xcp_vm_status", "xcp_vm_uptime_seconds"],
      });
      const vm: ParsedXcpNgResource = rowOf(
        rowsOf(folded, PRODUCTION_POOL_ID),
        XcpNgResourceKind.VM,
        VM.web01,
      );
      // Its RRD series still say it runs on its host; its status is unknown.
      expect(vm.powerState).toBe(null);
      expect(vm.parentHostExternalId).toBe(HOST.prod1);
      expect(
        rowsOf(folded, PRODUCTION_POOL_ID).some((r: ParsedXcpNgResource) => {
          return r.externalId === VM.win03;
        }),
      ).toBe(false);
    });
  });
});

describe("XcpNgSnapshotScan datapoint handling", () => {
  test("only xcp_ series of hosts, VMs, storage, disks and pools are folded", () => {
    expect(isXcpNgSnapshotMetric("xcp_host_status")).toBe(true);
    expect(isXcpNgSnapshotMetric("xcp_vm_cpu_usage")).toBe(true);
    expect(isXcpNgSnapshotMetric("xcp_sr_physical_size_bytes")).toBe(true);
    expect(isXcpNgSnapshotMetric("xcp_vdi_virtual_size_bytes")).toBe(true);
    expect(isXcpNgSnapshotMetric("xcp_pool_connected")).toBe(true);
    expect(isXcpNgSnapshotMetric("xcp_xostor_up")).toBe(false);
    expect(isXcpNgSnapshotMetric("xo_pool_total")).toBe(false);
    expect(isXcpNgSnapshotMetric("xcp_ng.host.running")).toBe(false);
    expect(isXcpNgSnapshotMetric("pve_up")).toBe(false);
  });

  test("a staleness marker, a missing value and a non-finite value are never folded", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_host_cpu_average",
      dp({ uuid: HOST.prod1, type: "host" }, 0.5, { flags: 1 }),
    );
    feed(folded, "xcp_host_cpu_average", {
      attributes: [{ key: "uuid", value: { stringValue: HOST.prod1 } }],
      timeUnixNano: "1795000000000000000",
    });
    feed(
      folded,
      "xcp_host_cpu_average",
      dp({ uuid: HOST.prod1, type: "host" }, "NaN"),
    );
    feed(
      folded,
      "xcp_host_cpu_average",
      dp({ uuid: HOST.prod1, type: "host" }, "Infinity"),
    );
    expect(folded.resourceBuffer.size).toBe(0);
    expect(folded.poolBuffer.size).toBe(0);
  });

  test("a series without the label that names its object folds nothing, but still reads the pool", () => {
    const folded: Folded = freshBuffers();
    feed(folded, "xcp_host_cpu_average", dp({ type: "host" }, 0.5));
    feed(folded, "xcp_sr_physical_size_bytes", dp({ sr_name: "x" }, 5));
    feed(folded, "xcp_vdi_virtual_size_bytes", dp({ sr_uuid: SR.prodNfs }, 5));
    expect(
      getXcpNgResourceRows(folded.resourceBuffer.get(PRODUCTION_POOL_ID)),
    ).toEqual([]);
    expect(folded.poolBuffer.get(PRODUCTION_POOL_ID)?.wasRead).toBe(true);
  });

  test("xcp_pool_connected below 1 reads the pool without saying it is connected", () => {
    const folded: Folded = freshBuffers();
    feed(folded, "xcp_pool_connected", dp({}, 0));
    expect(folded.poolBuffer.get(PRODUCTION_POOL_ID)).toEqual({
      wasRead: true,
      sawPoolConnected: false,
      readAt: new Date(SCRAPE_1_NOW_SECONDS * 1000),
    });
  });

  test("integer values (asInt, as a string) are read", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_host_running_vcpus",
      dp({ uuid: HOST.prod1, type: "host" }, "12", { asInt: true }),
    );
    expect(
      getXcpNgResourceRows(folded.resourceBuffer.get(PRODUCTION_POOL_ID))[0]
        ?.runningVcpuCount,
    ).toBe(12);
  });

  test("UUIDs are stored lower case, whatever case they arrive in", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_vm_status",
      dp({ uuid: VM.web01.toUpperCase(), power_state: "Running" }, 1),
    );
    feed(
      folded,
      "xcp_vm_cpu_usage",
      dp(
        { uuid: VM.web01, type: "vm", host_id: HOST.prod1.toUpperCase() },
        0.1,
      ),
    );
    const rows: Array<ParsedXcpNgResource> = getXcpNgResourceRows(
      folded.resourceBuffer.get(PRODUCTION_POOL_ID),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalId).toBe(VM.web01);
    expect(rows[0]?.parentHostExternalId).toBe(HOST.prod1);
  });

  test("an older reading arriving after a newer one never overwrites it", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_host_cpu_average",
      dp({ uuid: HOST.prod1, type: "host" }, 0.9, { seconds: 1795000120 }),
    );
    feed(
      folded,
      "xcp_host_cpu_average",
      dp({ uuid: HOST.prod1, type: "host" }, 0.1, { seconds: 1795000060 }),
    );
    feed(
      folded,
      "xcp_host_status",
      dp({ uuid: HOST.prod1, power_state: "Halted", enabled: "true" }, 1, {
        seconds: 1795000180,
      }),
    );
    feed(
      folded,
      "xcp_host_status",
      dp({ uuid: HOST.prod1, power_state: "Running", enabled: "true" }, 1, {
        seconds: 1795000000,
      }),
    );
    const host: ParsedXcpNgResource | undefined = getXcpNgResourceRows(
      folded.resourceBuffer.get(PRODUCTION_POOL_ID),
    )[0];
    expect(host?.latestCpuPercent).toBe(90);
    expect(host?.powerState).toBe("Halted");
    expect(host?.lastSeenAt).toEqual(new Date(1795000180 * 1000));
  });

  test("a name is never blanked by a series that does not carry it", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_vm_status",
      dp({ uuid: VM.web01, power_state: "Running", vm_name: "web-01" }, 1),
    );
    feed(
      folded,
      "xcp_vm_uptime_seconds",
      dp({ uuid: VM.web01 }, 60, { seconds: SCRAPE_2_NOW_SECONDS }),
    );
    expect(
      getXcpNgResourceRows(folded.resourceBuffer.get(PRODUCTION_POOL_ID))[0]
        ?.name,
    ).toBe("web-01");
  });

  test("a disk detached from its VM stops naming it", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_vdi_virtual_size_bytes",
      dp(
        {
          vdi_uuid: VDI.web01Disk,
          sr_uuid: SR.prodNfs,
          vm_uuid: VM.web01,
          vm_name: "web-01",
        },
        10,
      ),
    );
    feed(
      folded,
      "xcp_vdi_physical_usage_bytes",
      dp({ vdi_uuid: VDI.web01Disk, sr_uuid: SR.prodNfs }, 5, {
        seconds: SCRAPE_2_NOW_SECONDS,
      }),
    );
    const vdi: ParsedXcpNgResource | undefined = getXcpNgResourceRows(
      folded.resourceBuffer.get(PRODUCTION_POOL_ID),
    )[0];
    expect(vdi?.vmExternalId).toBe(null);
    expect(vdi?.vmName).toBe(null);
  });

  test("Paused and Suspended VMs are not up; only Running is", () => {
    for (const [powerState, isUp] of [
      ["Running", true],
      ["Halted", false],
      ["Paused", false],
      ["Suspended", false],
    ] as Array<[string, boolean]>) {
      const folded: Folded = freshBuffers();
      feed(
        folded,
        "xcp_vm_status",
        dp({ uuid: VM.web01, power_state: powerState }, 1),
      );
      expect(
        getXcpNgResourceRows(folded.resourceBuffer.get(PRODUCTION_POOL_ID))[0]
          ?.isUp,
      ).toBe(isUp);
    }
  });

  test("an Unknown host is not up", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_host_status",
      dp({ uuid: HOST.prod1, power_state: "Unknown", enabled: "true" }, 1),
    );
    const host: ParsedXcpNgResource | undefined = getXcpNgResourceRows(
      folded.resourceBuffer.get(PRODUCTION_POOL_ID),
    )[0];
    expect(host?.isUp).toBe(false);
    expect(host?.powerState).toBe("Unknown");
  });

  test("memory in use is never negative, and a percentage stays within 0 and 100", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_host_memory_total_bytes",
      dp({ uuid: HOST.prod1, type: "host" }, 100),
    );
    feed(
      folded,
      "xcp_host_memory_free_bytes",
      dp({ uuid: HOST.prod1, type: "host" }, 150),
    );
    const host: ParsedXcpNgResource | undefined = getXcpNgResourceRows(
      folded.resourceBuffer.get(PRODUCTION_POOL_ID),
    )[0];
    expect(host?.latestMemoryBytes).toBe(0);
    expect(host?.latestMemoryPercent).toBe(0);
  });

  test("a storage repository fuller than its size reads 100%", () => {
    const folded: Folded = freshBuffers();
    feed(
      folded,
      "xcp_sr_physical_size_bytes",
      dp({ sr_uuid: SR.prodNfs }, 100),
    );
    feed(
      folded,
      "xcp_sr_physical_usage_bytes",
      dp({ sr_uuid: SR.prodNfs }, 140),
    );
    expect(
      getXcpNgResourceRows(folded.resourceBuffer.get(PRODUCTION_POOL_ID))[0]
        ?.latestDiskPercent,
    ).toBe(100);
  });

  test("getXcpNgDatapointTime falls back to now for a missing or unreadable time", () => {
    const before: number = Date.now();
    for (const timeUnixNano of [
      undefined,
      "",
      "abc",
      "99999999999999999999999999",
    ]) {
      const point: JSONObject = { attributes: [] };
      if (timeUnixNano !== undefined) {
        point["timeUnixNano"] = timeUnixNano;
      }
      const time: Date = getXcpNgDatapointTime(point);
      expect(isNaN(time.getTime())).toBe(false);
      expect(time.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
    expect(
      getXcpNgDatapointTime({ timeUnixNano: 1795000000000000000 }).getTime(),
    ).toBe(1795000000000);
  });

  test("getXcpNgLabel trims, and reads an empty label as none", () => {
    const point: JSONObject = dp(
      { host_name: "  xcp-prod-01 ", tags: "  " },
      1,
    );
    expect(getXcpNgLabel(point, "host_name")).toBe("xcp-prod-01");
    expect(getXcpNgLabel(point, "tags")).toBe(null);
    expect(getXcpNgLabel(point, "absent")).toBe(null);
    expect(getXcpNgLabel({}, "absent")).toBe(null);
  });

  test("isXcpNgStaleDatapoint reads the no-recorded-value flag", () => {
    expect(isXcpNgStaleDatapoint({ flags: 1 })).toBe(true);
    expect(isXcpNgStaleDatapoint({ flags: 3 })).toBe(true);
    expect(isXcpNgStaleDatapoint({ flags: 0 })).toBe(false);
    expect(isXcpNgStaleDatapoint({})).toBe(false);
  });

  test("getXcpNgDatapointValue prefers asDouble, falls back to asInt", () => {
    expect(getXcpNgDatapointValue({ asDouble: 1.5, asInt: "2" })).toBe(1.5);
    expect(getXcpNgDatapointValue({ asInt: "2" })).toBe(2);
    expect(getXcpNgDatapointValue({ asDouble: "x" })).toBe(null);
    expect(getXcpNgDatapointValue({})).toBe(null);
  });

  test("an empty entry is every reading unknown", () => {
    const entry: ReturnType<typeof emptyXcpNgResourceEntry> =
      emptyXcpNgResourceEntry(XcpNgResourceKind.Host, HOST.prod1, new Date(0));
    expect(entry.cpuCores.size).toBe(0);
    expect(entry.runningAt).toBe(null);
    expect(entry.isUp).toBe(null);
  });

  test("getXcpNgResourceRows of no buffer is no rows", () => {
    expect(getXcpNgResourceRows(undefined)).toEqual([]);
  });
});
