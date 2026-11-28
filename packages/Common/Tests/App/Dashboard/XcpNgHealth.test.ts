import { describe, expect, test } from "@jest/globals";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import Route from "../../../Types/API/Route";
import { Translator, createTranslator } from "../../../Types/Translator";
import { XCP_NG_SR_NEAR_FULL_PERCENT as ALERT_NEAR_FULL_PERCENT } from "../../../Types/Monitor/XcpNgAlertTemplates";
import { XCP_NG_VM_RAN_RECENTLY_HOURS } from "../../../Types/XcpNg/XcpNgTelemetry";
import {
  XCP_NG_ATTENTION_KIND_ORDER,
  XCP_NG_SR_FULL_PERCENT,
  XCP_NG_SR_NEAR_FULL_PERCENT,
  XCP_NG_STORAGE_USAGE_THRESHOLDS,
  XcpNgPartKind,
  XcpNgProblem,
  assessXcpNgHost,
  assessXcpNgResource,
  assessXcpNgStorage,
  assessXcpNgVm,
  getXcpNgAllocationPercent,
  getXcpNgAttentionItems,
  getXcpNgIssueTargetId,
  getXcpNgPartKind,
  getXcpNgPoolHealth,
  getXcpNgProblemItems,
  getXcpNgStoragePercent,
  getXcpNgStorageUsage,
  isXcpNgControlDomain,
  isXcpNgHostDisabled,
  isXcpNgHostOffline,
  isXcpNgIssueAbout,
  isXcpNgProblemRow,
  isXcpNgStorageOverAllocated,
  isXcpNgVmDiskRepository,
  isXcpNgVmStoppedAfterRunning,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/XcpNgHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { StorageUsageLevel } from "../../../Utils/Storage/StorageUsage";

/*
 * What in an XCP-ng pool needs someone, and how bad it is: the one set of
 * rules the pool's health pill, its counts, its Needs attention card, a
 * part's own page and the Topology read (Pages/XcpNg/Utils/XcpNgHealth),
 * held to what the pool's alert templates fire on.
 */

const GIB: number = 1024 * 1024 * 1024;
const HOUR: number = 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

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
    lastSeenAt: ago(60 * 1000),
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
    parentHostExternalId: "host-xcp-01",
    parentHostName: "xcp-01",
    lastRunningAt: ago(60 * 1000),
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

const routeFor: (kind: XcpNgPartKind, externalId: string) => Route = (
  kind: XcpNgPartKind,
  externalId: string,
): Route => {
  return new Route(`/pool/${kind}/${encodeURIComponent(externalId)}`);
};

function reasonsOf(item: ResourceAttentionItem): Array<string> {
  return item.reasons.map((reason: ResourceAttentionText): string => {
    return reason.values
      ? Object.keys(reason.values).reduce(
          (text: string, key: string): string => {
            return text.replace(`{{${key}}}`, reason.values![key]!);
          },
          reason.text,
        )
      : reason.text;
  });
}

describe("the lines", () => {
  test("a storage repository warns where its alert fires (more than 90%) and is critical past 95%", () => {
    expect(XCP_NG_SR_NEAR_FULL_PERCENT).toBe(ALERT_NEAR_FULL_PERCENT);
    expect(XCP_NG_SR_NEAR_FULL_PERCENT).toBe(90);
    expect(XCP_NG_SR_FULL_PERCENT).toBe(95);
    expect(XCP_NG_STORAGE_USAGE_THRESHOLDS).toEqual({
      warningPercent: 90,
      criticalPercent: 95,
      isPastLineOnly: true,
    });
  });

  test("the kinds are listed hosts, then storage repositories, then VMs", () => {
    // The pool's own first, then its parts, then its jobs and readers (#10997).
    expect(XCP_NG_ATTENTION_KIND_ORDER).toEqual([
      "Pool",
      "Host",
      "Storage repository",
      "VM",
      "Backup job",
      "Xen Orchestra",
      "XAPI",
    ]);
  });

  test("each kind of row is a page kind, a virtual disk none", () => {
    expect(getXcpNgPartKind(host("a"))).toBe("Host");
    expect(getXcpNgPartKind(vm("a"))).toBe("VM");
    expect(getXcpNgPartKind(sr("a"))).toBe("StorageRepository");
    expect(getXcpNgPartKind(row({ kind: "VDI" }))).toBeNull();
    expect(getXcpNgPartKind(row({ kind: "Toaster" }))).toBeNull();
  });
});

describe("a host", () => {
  test("running and enabled needs nothing", () => {
    expect(assessXcpNgHost(host("a"))).toEqual({
      severity: null,
      reasons: [],
    });
  });

  test("Halted is critical, in Xen Orchestra's word", () => {
    const halted: XcpNgResource = host("a", {
      powerState: "Halted",
      isUp: false,
    });
    expect(isXcpNgHostOffline(halted)).toBe(true);
    expect(assessXcpNgHost(halted)).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "Halted" }],
    });
  });

  test("Unknown - the pool lost touch with it - is critical: not responding", () => {
    const unknown: XcpNgResource = host("a", {
      powerState: "Unknown",
      isUp: false,
    });
    expect(isXcpNgHostOffline(unknown)).toBe(true);
    expect(assessXcpNgHost(unknown).reasons).toEqual([
      { text: "Not responding" },
    ]);
    expect(assessXcpNgHost(unknown).severity).toBe(
      ResourceAttentionSeverity.Critical,
    );
  });

  test("down with no state reported is offline; no state at all is not", () => {
    expect(
      isXcpNgHostOffline(host("a", { powerState: undefined, isUp: false })),
    ).toBe(true);
    expect(
      assessXcpNgHost(host("a", { powerState: undefined, isUp: false }))
        .reasons,
    ).toEqual([{ text: "Offline" }]);
    expect(
      isXcpNgHostOffline(host("a", { powerState: undefined, isUp: undefined })),
    ).toBe(false);
    // Running with a stale isUp is what Xen Orchestra says: running.
    expect(
      isXcpNgHostOffline(host("a", { powerState: "Running", isUp: false })),
    ).toBe(false);
  });

  test("disabled is a warning: XAPI starts no VM on it", () => {
    const disabled: XcpNgResource = host("a", { isEnabled: false });
    expect(isXcpNgHostDisabled(disabled)).toBe(true);
    expect(assessXcpNgHost(disabled)).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "Disabled" }],
    });
    // Unknown enabled flag is not disabled.
    expect(isXcpNgHostDisabled(host("a", { isEnabled: undefined }))).toBe(
      false,
    );
  });

  test("halted and disabled says both, critical first", () => {
    expect(
      assessXcpNgHost(
        host("a", { powerState: "Halted", isUp: false, isEnabled: false }),
      ),
    ).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "Halted" }, { text: "Disabled" }],
    });
  });

  test("only a host is ever offline or disabled", () => {
    expect(isXcpNgHostOffline(vm("a", { isUp: false }))).toBe(false);
    expect(isXcpNgHostDisabled(vm("a", { isEnabled: false }))).toBe(false);
  });
});

describe("a VM", () => {
  test("running needs nothing", () => {
    expect(assessXcpNgVm(vm("a"), NOW)).toEqual({
      severity: null,
      reasons: [],
    });
  });

  test("halted after running in the last day is a warning", () => {
    const stopped: XcpNgResource = vm("a", {
      powerState: "Halted",
      isUp: false,
      lastRunningAt: ago(2 * HOUR),
    });
    expect(isXcpNgVmStoppedAfterRunning(stopped, NOW)).toBe(true);
    expect(assessXcpNgVm(stopped, NOW)).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "Halted after running" }],
    });
  });

  test("paused after running in the last day is a warning in its own word", () => {
    expect(
      assessXcpNgVm(
        vm("a", {
          powerState: "Paused",
          isUp: false,
          lastRunningAt: ago(HOUR),
        }),
        NOW,
      ).reasons,
    ).toEqual([{ text: "Paused after running" }]);
  });

  test("the day is the VM Stopped alert's: exactly 24 hours counts, a minute more does not", () => {
    expect(XCP_NG_VM_RAN_RECENTLY_HOURS).toBe(24);
    const at: (ms: number) => XcpNgResource = (ms: number): XcpNgResource => {
      return vm("a", {
        powerState: "Halted",
        isUp: false,
        lastRunningAt: ago(ms),
      });
    };
    expect(isXcpNgVmStoppedAfterRunning(at(24 * HOUR), NOW)).toBe(true);
    expect(isXcpNgVmStoppedAfterRunning(at(24 * HOUR + 60 * 1000), NOW)).toBe(
      false,
    );
  });

  test("halted and never seen running, or long ago, was switched off on purpose", () => {
    expect(
      assessXcpNgVm(
        vm("a", {
          powerState: "Halted",
          isUp: false,
          lastRunningAt: undefined,
        }),
        NOW,
      ).severity,
    ).toBeNull();
    expect(
      assessXcpNgVm(
        vm("a", {
          powerState: "Halted",
          isUp: false,
          lastRunningAt: ago(3 * 24 * HOUR),
        }),
        NOW,
      ).severity,
    ).toBeNull();
  });

  test("suspended is someone's choice, however recently it ran", () => {
    expect(
      isXcpNgVmStoppedAfterRunning(
        vm("a", {
          powerState: "Suspended",
          isUp: false,
          lastRunningAt: ago(HOUR),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("a control domain is its host's own: never a stopped VM", () => {
    const dom0: XcpNgResource = vm("dom0", {
      isControlDomain: true,
      powerState: "Halted",
      isUp: false,
      lastRunningAt: ago(HOUR),
    });
    expect(isXcpNgControlDomain(dom0)).toBe(true);
    expect(isXcpNgVmStoppedAfterRunning(dom0, NOW)).toBe(false);
    expect(isXcpNgControlDomain(host("a", { isControlDomain: true }))).toBe(
      false,
    );
  });

  test("a last running time in the future (a clock ahead) is not a stop", () => {
    expect(
      isXcpNgVmStoppedAfterRunning(
        vm("a", {
          powerState: "Halted",
          isUp: false,
          lastRunningAt: new Date(NOW.getTime() + HOUR),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("a last running time off the wire, as a string, reads as a date", () => {
    expect(
      isXcpNgVmStoppedAfterRunning(
        vm("a", {
          powerState: "Halted",
          isUp: false,
          lastRunningAt: ago(HOUR).toISOString() as unknown as Date,
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("a storage repository", () => {
  test("its fill reads as the shared bar reads it", () => {
    const usage: ReturnType<typeof getXcpNgStorageUsage> = getXcpNgStorageUsage(
      sr("a", { latestDiskBytes: 40 * GIB, maxDiskBytes: 100 * GIB }),
    );
    expect(usage?.usedPercent).toBe(40);
    expect(usage?.free).toBe(60 * GIB);
    expect(usage?.level).toBe(StorageUsageLevel.Normal);
    expect(getXcpNgStoragePercent(sr("a"))).toBe(40);
  });

  test("exactly 90% has not crossed the line; 91% warns; 96% is critical", () => {
    const at: (percent: number) => XcpNgResource = (
      percent: number,
    ): XcpNgResource => {
      return sr("a", {
        latestDiskBytes: percent * GIB,
        maxDiskBytes: 100 * GIB,
        virtualAllocationBytes: 0,
      });
    };
    expect(assessXcpNgStorage(at(90)).severity).toBeNull();
    expect(assessXcpNgStorage(at(91))).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "{{percent}} full", values: { percent: "91%" } }],
    });
    expect(assessXcpNgStorage(at(95)).severity).toBe(
      ResourceAttentionSeverity.Warning,
    );
    expect(assessXcpNgStorage(at(96)).severity).toBe(
      ResourceAttentionSeverity.Critical,
    );
  });

  test("the percent is rounded down, as the bar writes it", () => {
    expect(
      assessXcpNgStorage(
        sr("a", {
          latestDiskBytes: 91.9 * GIB,
          maxDiskBytes: 100 * GIB,
          virtualAllocationBytes: 0,
        }),
      ).reasons,
    ).toEqual([{ text: "{{percent}} full", values: { percent: "91%" } }]);
  });

  test("allocated past its size is a warning that says how far, in English sizes the sentence writes in its own digits", () => {
    const thin: XcpNgResource = sr("a", {
      latestDiskBytes: 30 * GIB,
      maxDiskBytes: 100 * GIB,
      virtualAllocationBytes: 130 * GIB,
    });
    expect(isXcpNgStorageOverAllocated(thin)).toBe(true);
    expect(getXcpNgAllocationPercent(thin)).toBeCloseTo(130);
    expect(assessXcpNgStorage(thin)).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: "{{allocated}} allocated of {{size}}",
          values: { allocated: "130\u00A0GiB", size: "100\u00A0GiB" },
        },
      ],
    });
  });

  test("allocated exactly its size is not over-provisioned", () => {
    expect(
      isXcpNgStorageOverAllocated(
        sr("a", { virtualAllocationBytes: 100 * GIB, maxDiskBytes: 100 * GIB }),
      ),
    ).toBe(false);
  });

  test("full and over-provisioned says both, the worst severity", () => {
    const both: XcpNgResource = sr("a", {
      latestDiskBytes: 97 * GIB,
      maxDiskBytes: 100 * GIB,
      virtualAllocationBytes: 150 * GIB,
    });
    const assessment: ReturnType<typeof assessXcpNgStorage> =
      assessXcpNgStorage(both);
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(
      assessment.reasons.map((reason: ResourceAttentionText) => {
        return reason.text;
      }),
    ).toEqual(["{{percent}} full", "{{allocated}} allocated of {{size}}"]);
  });

  test("an ISO library or removable media holds no VM disk, and a repository with no size has no fill", () => {
    expect(isXcpNgVmDiskRepository(sr("a"))).toBe(true);
    expect(isXcpNgVmDiskRepository(sr("iso", { contentType: "iso" }))).toBe(
      false,
    );
    expect(isXcpNgVmDiskRepository(sr("cd", { contentType: "disk" }))).toBe(
      false,
    );
    expect(isXcpNgVmDiskRepository(sr("zero", { maxDiskBytes: 0 }))).toBe(
      false,
    );
    expect(isXcpNgVmDiskRepository(host("a"))).toBe(false);
    const library: XcpNgResource = sr("iso", {
      contentType: "iso",
      latestDiskBytes: 0,
      maxDiskBytes: 0,
      virtualAllocationBytes: 0,
    });
    expect(getXcpNgStorageUsage(library)).toBeNull();
    expect(getXcpNgStoragePercent(library)).toBeNull();
    expect(getXcpNgAllocationPercent(library)).toBeNull();
    expect(assessXcpNgStorage(library)).toEqual({
      severity: null,
      reasons: [],
    });
  });

  test("sizes off the wire as bigint strings read as numbers", () => {
    expect(
      getXcpNgStoragePercent(
        sr("a", {
          latestDiskBytes: String(50 * GIB) as unknown as number,
          maxDiskBytes: String(100 * GIB) as unknown as number,
        }),
      ),
    ).toBe(50);
  });

  test("only a storage repository has a fill or an allocation", () => {
    expect(getXcpNgStorageUsage(host("a"))).toBeNull();
    expect(getXcpNgAllocationPercent(vm("a"))).toBeNull();
  });
});

describe("what needs attention in the pool", () => {
  const rows: Array<XcpNgResource> = [
    host("xcp-01"),
    host("xcp-02", { isEnabled: false }),
    host("xcp-10", { powerState: "Halted", isUp: false }),
    vm("web-01"),
    vm("db-01", {
      powerState: "Halted",
      isUp: false,
      lastRunningAt: ago(2 * HOUR),
    }),
    vm("old", {
      powerState: "Halted",
      isUp: false,
      lastRunningAt: ago(10 * 24 * HOUR),
    }),
    vm("win-03", { powerState: "Suspended", isUp: false }),
    vm("Control domain on host: xcp-10", {
      isControlDomain: true,
      powerState: undefined,
      isUp: false,
      lastRunningAt: ago(HOUR),
    }),
    sr("NFS VM store", {
      latestDiskBytes: 92 * GIB,
      maxDiskBytes: 100 * GIB,
    }),
    sr("Local storage", {
      isShared: false,
      parentHostExternalId: "host-xcp-01",
      parentHostName: "xcp-01",
      latestDiskBytes: 10 * GIB,
      maxDiskBytes: 100 * GIB,
      virtualAllocationBytes: 200 * GIB,
    }),
    sr("XCP-ng Tools", {
      contentType: "iso",
      latestDiskBytes: 0,
      maxDiskBytes: 0,
      virtualAllocationBytes: 0,
    }),
    row({ kind: "VDI", externalId: "vdi-1", name: "db-01 data" }),
  ];

  const items: Array<ResourceAttentionItem> = getXcpNgAttentionItems({
    rows: rows,
    routeFor: routeFor,
    now: NOW,
  });

  test("most urgent first: the halted host, then the warnings by kind", () => {
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return `${item.severity} ${item.kind} ${item.name}`;
      }),
    ).toEqual([
      "critical Host xcp-10",
      "warning Host xcp-02",
      "warning Storage repository Local storage",
      "warning Storage repository NFS VM store",
      "warning VM db-01",
    ]);
  });

  test("each says why, a step from its page", () => {
    const byName: Map<string, ResourceAttentionItem> = new Map(
      items.map((item: ResourceAttentionItem) => {
        return [item.name, item];
      }),
    );
    expect(reasonsOf(byName.get("xcp-10")!)).toEqual(["Halted"]);
    expect(reasonsOf(byName.get("xcp-02")!)).toEqual(["Disabled"]);
    expect(reasonsOf(byName.get("db-01")!)).toEqual(["Halted after running"]);
    expect(reasonsOf(byName.get("NFS VM store")!)).toEqual(["92% full"]);
    expect(reasonsOf(byName.get("Local storage")!)).toEqual([
      "200\u00A0GiB allocated of 100\u00A0GiB",
    ]);
    expect(byName.get("xcp-10")!.route?.toString()).toBe(
      "/pool/Host/host-xcp-10",
    );
    expect(byName.get("db-01")!.route?.toString()).toBe("/pool/VM/vm-db-01");
    expect(byName.get("NFS VM store")!.route?.toString()).toBe(
      "/pool/StorageRepository/sr-NFS%20VM%20store",
    );
  });

  test("a local storage repository names its host under its name (every host has a 'Local storage')", () => {
    const local: ResourceAttentionItem | undefined = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.name === "Local storage";
      },
    );
    expect(local?.detail).toBe("xcp-01");
    const shared: ResourceAttentionItem | undefined = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.name === "NFS VM store";
      },
    );
    expect(shared?.detail).toBeUndefined();
  });

  test("never a control domain, a suspended VM, a VM off for days, an ISO library or a virtual disk", () => {
    const names: Array<string> = items.map(
      (item: ResourceAttentionItem): string => {
        return item.name;
      },
    );
    for (const name of [
      "Control domain on host: xcp-10",
      "win-03",
      "old",
      "XCP-ng Tools",
      "db-01 data",
    ]) {
      expect(names).not.toContain(name);
    }
  });

  test("the pool's health follows it: anything critical is Unhealthy, a warning Degraded, nothing Healthy", () => {
    expect(getXcpNgPoolHealth(items)).toBe("Unhealthy");
    expect(
      getXcpNgPoolHealth(
        getXcpNgAttentionItems({
          rows: [host("a", { isEnabled: false })],
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Degraded");
    expect(
      getXcpNgPoolHealth(
        getXcpNgAttentionItems({
          rows: [host("a"), vm("b"), sr("c")],
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Healthy");
  });

  test("a part with no UUID has no page to step to", () => {
    const [item] = getXcpNgAttentionItems({
      rows: [host("a", { externalId: "", powerState: "Halted", isUp: false })],
      routeFor: routeFor,
      now: NOW,
    });
    expect(item!.route).toBeUndefined();
  });

  test("an unnamed part reads as the start of its UUID", () => {
    const [item] = getXcpNgAttentionItems({
      rows: [
        host("a", {
          name: "",
          externalId: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
          powerState: "Halted",
          isUp: false,
        }),
      ],
      routeFor: routeFor,
      now: NOW,
    });
    expect(item!.name).toBe("9c6c0b6e");
  });

  test("assessXcpNgResource reads each kind by its own rules, a virtual disk by none", () => {
    expect(
      assessXcpNgResource(host("a", { powerState: "Halted" }), NOW).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
    expect(
      assessXcpNgResource(row({ kind: "VDI", externalId: "x" }), NOW),
    ).toEqual({ severity: null, reasons: [] });
  });
});

describe("what each of the Overview's counts opens", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  const rows: Array<XcpNgResource> = [
    host("xcp-01"),
    host("xcp-02", { isEnabled: false }),
    host("xcp-03", {
      powerState: "Unknown",
      isUp: false,
      lastSeenAt: ago(2 * HOUR),
    }),
    host("xcp-04", { powerState: "Halted", isUp: false }),
    vm("db-01", {
      powerState: "Paused",
      isUp: false,
      lastRunningAt: ago(3 * HOUR),
      parentHostExternalId: "host-xcp-02",
      parentHostName: "xcp-02",
    }),
    vm("ghost", {
      powerState: "Halted",
      isUp: false,
      lastRunningAt: ago(HOUR),
      parentHostExternalId: "host-gone",
      parentHostName: "gone",
    }),
    sr("NFS", { latestDiskBytes: 97 * GIB, virtualAllocationBytes: 120 * GIB }),
    sr("Local storage", {
      isShared: false,
      parentHostExternalId: "host-xcp-01",
      parentHostName: "xcp-01",
      latestDiskBytes: 10 * GIB,
      virtualAllocationBytes: 300 * GIB,
    }),
  ];

  function itemsOf(
    problem: XcpNgProblem,
    options: { translator: Translator | undefined } = { translator: ENGLISH },
  ): Array<ResourceAttentionItem> {
    return getXcpNgProblemItems({
      rows: rows,
      problem: problem,
      routeFor: routeFor,
      now: NOW,
      staleMs: 15 * 60 * 1000,
      translator: options.translator,
    });
  }

  test("hosts offline: each with its state as the reason", () => {
    const items: Array<ResourceAttentionItem> = itemsOf({
      kind: "hostsOffline",
    });
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return `${item.name}: ${reasonsOf(item).join(", ")}`;
      }),
    ).toEqual(["xcp-03: Not responding", "xcp-04: Halted"]);
  });

  test("a host the pool lost touch with says what that means, and when it last reported", () => {
    const [unknown] = itemsOf({ kind: "hostsOffline" });
    expect(unknown!.explanation).toBe(
      "The pool cannot tell whether this host runs: it lost touch with it. Its VMs may still be running, or may have stopped with it.",
    );
    expect(unknown!.lastReportAt).toEqual(ago(2 * HOUR));
    // One Xen Orchestra reports Halted now says nothing of when.
    const halted: ResourceAttentionItem = itemsOf({ kind: "hostsOffline" })[1]!;
    expect(halted.lastReportAt).toBeUndefined();
    expect(halted.explanation).toBeUndefined();
  });

  test("hosts disabled: what it means and what to do", () => {
    const items: Array<ResourceAttentionItem> = itemsOf({
      kind: "hostsDisabled",
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("xcp-02");
    expect(reasonsOf(items[0]!)).toEqual(["Disabled"]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[0]!.explanation).toContain("maintenance mode");
  });

  test("VMs stopped: since when they last ran, and the host they ran on a step away", () => {
    const items: Array<ResourceAttentionItem> = itemsOf({ kind: "vmsStopped" });
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["db-01", "ghost"]);
    const db: ResourceAttentionItem = items[0]!;
    expect(reasonsOf(db)).toEqual(["Paused after running"]);
    expect(db.since).toEqual({
      at: ago(3 * HOUR),
      template: "Last running {{time}}",
    });
    expect(db.facts).toEqual([
      {
        key: "host",
        label: "Host",
        value: "xcp-02",
        route: routeFor("Host", "host-xcp-02"),
      },
    ]);
    expect(db.explanation).toContain("in the last 24 hours");
    // A host the pool no longer reports is named, with no page to open.
    expect(items[1]!.facts).toEqual([
      { key: "host", label: "Host", value: "gone", route: undefined },
    ]);
  });

  test("storage filling up: the fill first, then the rest of what the rules say", () => {
    const items: Array<ResourceAttentionItem> = itemsOf({
      kind: "storageFull",
    });
    expect(items).toHaveLength(1);
    expect(reasonsOf(items[0]!)).toEqual([
      "97% full",
      "120\u00A0GiB allocated of 100\u00A0GiB",
    ]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
  });

  test("storage over-provisioned: the allocation first, the full one first, a local one's host a step away", () => {
    const items: Array<ResourceAttentionItem> = itemsOf({
      kind: "storageOverAllocated",
    });
    // NFS is also 97% full: critical, so first.
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return `${item.name}: ${reasonsOf(item)[0]}`;
      }),
    ).toEqual([
      "NFS: 120\u00A0GiB allocated of 100\u00A0GiB",
      "Local storage: 300\u00A0GiB allocated of 100\u00A0GiB",
    ]);
    expect(reasonsOf(items[0]!)).toEqual([
      "120\u00A0GiB allocated of 100\u00A0GiB",
      "97% full",
    ]);
    expect(items[1]!.facts?.[0]?.route).toEqual(
      routeFor("Host", "host-xcp-01"),
    );
  });

  test("a count lists exactly what isXcpNgProblemRow says it counts", () => {
    for (const problem of [
      { kind: "hostsOffline" },
      { kind: "hostsDisabled" },
      { kind: "vmsStopped" },
      { kind: "storageFull" },
      { kind: "storageOverAllocated" },
    ] as Array<XcpNgProblem>) {
      const counted: number = rows.filter((candidate: XcpNgResource) => {
        return isXcpNgProblemRow(candidate, problem, NOW);
      }).length;
      expect({ problem: problem.kind, count: itemsOf(problem).length }).toEqual(
        { problem: problem.kind, count: counted },
      );
    }
  });

  test("the explanation is in the reader's words; without a translator none is drawn", () => {
    const german: Translator = createTranslator((text: string) => {
      return text.startsWith("XAPI starts no VM on a disabled host")
        ? "XAPI startet auf einem deaktivierten Host keine VM."
        : undefined;
    }, "de");
    expect(
      itemsOf({ kind: "hostsDisabled" }, { translator: german })[0]!
        .explanation,
    ).toBe("XAPI startet auf einem deaktivierten Host keine VM.");
    expect(
      itemsOf({ kind: "hostsDisabled" }, { translator: undefined })[0]!
        .explanation,
    ).toBeUndefined();
  });
});

describe("which part an open incident or alert is about", () => {
  test("the templates' xcp_ng.id, as a datapoint or a resource attribute, in any case", () => {
    expect(
      getXcpNgIssueTargetId({ seriesLabels: { "xcp_ng.id": "ABC-1" } }),
    ).toBe("abc-1");
    expect(
      getXcpNgIssueTargetId({
        seriesLabels: { "resource.xcp_ng.id": " abc-2 " },
      }),
    ).toBe("abc-2");
  });

  test("a person's own monitor grouped by Xen Orchestra's uuid or sr_uuid", () => {
    expect(getXcpNgIssueTargetId({ seriesLabels: { uuid: "host-1" } })).toBe(
      "host-1",
    );
    expect(getXcpNgIssueTargetId({ seriesLabels: { sr_uuid: "sr-1" } })).toBe(
      "sr-1",
    );
    // xcp_ng.id wins: a host disk series carries the host's uuid and an sr_uuid.
    expect(
      getXcpNgIssueTargetId({
        seriesLabels: { "xcp_ng.id": "host-1", sr_uuid: "sr-1" },
      }),
    ).toBe("host-1");
  });

  test("no labels, or none naming an object, names nothing", () => {
    expect(getXcpNgIssueTargetId({ seriesLabels: null })).toBeNull();
    expect(
      getXcpNgIssueTargetId({ seriesLabels: { host_name: "xcp-01" } }),
    ).toBeNull();
    expect(getXcpNgIssueTargetId({ seriesLabels: { uuid: "  " } })).toBeNull();
  });

  test("isXcpNgIssueAbout matches the part's UUID, whatever its case", () => {
    expect(
      isXcpNgIssueAbout(
        { seriesLabels: { "xcp_ng.id": "9C6C0B6E" } },
        { externalId: "9c6c0b6e" },
      ),
    ).toBe(true);
    expect(
      isXcpNgIssueAbout(
        { seriesLabels: { "xcp_ng.id": "other" } },
        { externalId: "9c6c0b6e" },
      ),
    ).toBe(false);
    expect(
      isXcpNgIssueAbout({ seriesLabels: {} }, { externalId: "9c6c0b6e" }),
    ).toBe(false);
    expect(
      isXcpNgIssueAbout(
        { seriesLabels: { "xcp_ng.id": "x" } },
        { externalId: "" },
      ),
    ).toBe(false);
  });
});
