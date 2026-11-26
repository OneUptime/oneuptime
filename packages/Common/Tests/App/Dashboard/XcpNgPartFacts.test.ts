import { describe, expect, test } from "@jest/globals";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import { Translator, createTranslator } from "../../../Types/Translator";
import { getAllXcpNgAlertTemplates } from "../../../Types/Monitor/XcpNgAlertTemplates";
import {
  XCP_NG_HOST_ALERT_TEMPLATE_IDS,
  XCP_NG_MAX_TAGS,
  XCP_NG_STORAGE_ALERT_TEMPLATE_IDS,
  XCP_NG_VM_ALERT_TEMPLATE_IDS,
  XcpNgBusyPart,
  XcpNgRowsOnHost,
  getXcpNgBusiestParts,
  getXcpNgContentTypeWord,
  getXcpNgHostStatus,
  getXcpNgMemoryPercent,
  getXcpNgPartBadges,
  getXcpNgPartStatus,
  getXcpNgRowsOnHost,
  getXcpNgStorageStatus,
  getXcpNgStorageTypeLabel,
  getXcpNgVmMemory,
  getXcpNgVmStatus,
  parseXcpNgTags,
  sortXcpNgByName,
  sortXcpNgHostsForGlance,
  sortXcpNgStorageForGlance,
  summarizeXcpNgHosts,
  summarizeXcpNgStorage,
  summarizeXcpNgVms,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  XCP_NG_PART_ATTENTION_WORDS,
  getXcpNgPartAttention,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/XcpNgPartAttention";
import {
  XCP_NG_PROBLEM_WORDS,
  getXcpNgProblemPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgProblemPills";
import { XCP_NG_PAGE_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgPageDescriptions";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourcePartAttention } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";
import { ComponentProps as ResourceAttentionPillProps } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionPill";
import Route from "../../../Types/API/Route";
import { expectReadableDescriptionRecord } from "./MetricDescriptionRules";

/*
 * What an XCP-ng host, VM or storage repository is, in the words its pages
 * use (Pages/XcpNg/Utils/XcpNgPartFacts), what a part's page lists as
 * needing attention (XcpNgPartAttention), and what each count of what is
 * wrong on the pool's Overview opens (Components/XcpNg/XcpNgProblemPills).
 */

const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const ENGLISH: Translator = createTranslator(undefined, "en");
const SENTENCE_END: RegExp = /[.]$/;

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
    parentHostName: "a",
    ...fields,
  });
}

function sr(name: string, fields: RowFields = {}): XcpNgResource {
  return row({
    kind: "StorageRepository",
    externalId: `sr-${name}`,
    name: name,
    contentType: "user",
    isShared: true,
    latestDiskBytes: 40 * GIB,
    maxDiskBytes: 100 * GIB,
    virtualAllocationBytes: 50 * GIB,
    ...fields,
  });
}

describe("a host's state", () => {
  test("Xen Orchestra's words: Running green, Halted and Unknown red", () => {
    expect(getXcpNgHostStatus(host("a"))).toEqual({
      label: "Running",
      tone: "positive",
    });
    expect(
      getXcpNgHostStatus(host("a", { powerState: "Halted", isUp: false })),
    ).toEqual({ label: "Halted", tone: "danger" });
    expect(
      getXcpNgHostStatus(host("a", { powerState: "Unknown", isUp: false })),
    ).toEqual({ label: "Unknown", tone: "danger" });
  });

  test("with no state reported, up reads Running and down Halted; nothing at all reads nothing", () => {
    expect(
      getXcpNgHostStatus(host("a", { powerState: undefined, isUp: true })),
    ).toEqual({ label: "Running", tone: "positive" });
    expect(
      getXcpNgHostStatus(host("a", { powerState: undefined, isUp: false })),
    ).toEqual({ label: "Halted", tone: "danger" });
    expect(
      getXcpNgHostStatus(host("a", { powerState: undefined, isUp: undefined })),
    ).toBeNull();
  });

  test("a disabled host keeps its state, and wears a grey Disabled badge: someone chose it", () => {
    const disabled: XcpNgResource = host("a", { isEnabled: false });
    expect(getXcpNgHostStatus(disabled)).toEqual({
      label: "Running",
      tone: "positive",
    });
    expect(getXcpNgPartBadges(disabled)).toEqual([
      { key: "disabled", label: "Disabled", tone: "neutral" },
    ]);
    expect(getXcpNgPartBadges(host("a"))).toEqual([]);
  });
});

describe("a VM's state", () => {
  test("Running green; Suspended grey, someone's choice", () => {
    expect(getXcpNgVmStatus(vm("a"), NOW)).toEqual({
      label: "Running",
      tone: "positive",
    });
    expect(
      getXcpNgVmStatus(
        vm("a", {
          powerState: "Suspended",
          isUp: false,
          lastRunningAt: ago(MINUTE),
        }),
        NOW,
      ),
    ).toEqual({ label: "Suspended", tone: "neutral" });
  });

  test("Halted or Paused and left off is grey; after running in the last day, amber", () => {
    for (const state of ["Halted", "Paused"]) {
      expect(
        getXcpNgVmStatus(
          vm("a", {
            powerState: state,
            isUp: false,
            lastRunningAt: ago(3 * 24 * HOUR),
          }),
          NOW,
        ),
      ).toEqual({ label: state, tone: "neutral" });
      expect(
        getXcpNgVmStatus(
          vm("a", {
            powerState: state,
            isUp: false,
            lastRunningAt: ago(HOUR),
          }),
          NOW,
        ),
      ).toEqual({ label: state, tone: "warning" });
    }
  });

  test("a control domain has no status series: Running while it reports, and a grey badge", () => {
    const dom0: XcpNgResource = vm("dom0", {
      isControlDomain: true,
      powerState: undefined,
      isUp: true,
    });
    expect(getXcpNgVmStatus(dom0, NOW)).toEqual({
      label: "Running",
      tone: "positive",
    });
    expect(getXcpNgPartBadges(dom0)).toEqual([
      { key: "control-domain", label: "Control domain", tone: "neutral" },
    ]);
    expect(
      getXcpNgVmStatus(vm("x", { powerState: undefined, isUp: false }), NOW),
    ).toBeNull();
  });
});

describe("a storage repository's state", () => {
  test("its fill, at the pool's lines: green, amber past 90%, red past 95%", () => {
    expect(getXcpNgStorageStatus(sr("a"))).toEqual({
      label: "{{percent}} used",
      values: { percent: "40%" },
      tone: "positive",
    });
    expect(
      getXcpNgStorageStatus(sr("a", { latestDiskBytes: 92 * GIB })),
    ).toEqual({
      label: "{{percent}} used",
      values: { percent: "92%" },
      tone: "warning",
    });
    expect(
      getXcpNgStorageStatus(sr("a", { latestDiskBytes: 99.5 * GIB })),
    ).toEqual({
      label: "{{percent}} used",
      values: { percent: "99%" },
      tone: "danger",
    });
  });

  test("allocated past its size and not full: amber, Over-provisioned", () => {
    expect(
      getXcpNgStorageStatus(sr("a", { virtualAllocationBytes: 150 * GIB })),
    ).toEqual({ label: "Over-provisioned", tone: "warning" });
  });

  test("no size to fill - an ISO library - has no state", () => {
    expect(
      getXcpNgStorageStatus(
        sr("iso", { contentType: "iso", maxDiskBytes: 0, latestDiskBytes: 0 }),
      ),
    ).toBeNull();
  });

  test("shared or local: a grey badge, none before it was reported", () => {
    expect(getXcpNgPartBadges(sr("a"))).toEqual([
      { key: "shared", label: "Shared", tone: "neutral" },
    ]);
    expect(getXcpNgPartBadges(sr("a", { isShared: false }))).toEqual([
      { key: "shared", label: "Local", tone: "neutral" },
    ]);
    expect(getXcpNgPartBadges(sr("a", { isShared: undefined }))).toEqual([]);
  });

  test("getXcpNgPartStatus reads each kind by its own rule, a virtual disk none", () => {
    expect(getXcpNgPartStatus(host("a"), NOW)?.label).toBe("Running");
    expect(getXcpNgPartStatus(vm("a"), NOW)?.label).toBe("Running");
    expect(getXcpNgPartStatus(sr("a"), NOW)?.label).toBe("{{percent}} used");
    expect(getXcpNgPartStatus(row({ kind: "VDI" }), NOW)).toBeNull();
  });
});

describe("words", () => {
  test("tags as Xen Orchestra sends them: comma-separated, each once, at most twenty", () => {
    expect(parseXcpNgTags("production,web")).toEqual(["production", "web"]);
    expect(parseXcpNgTags(" a , ,b,a ")).toEqual(["a", "b"]);
    expect(parseXcpNgTags("")).toEqual([]);
    expect(parseXcpNgTags(undefined)).toEqual([]);
    const many: string = Array.from({ length: 30 }, (_: unknown, i: number) => {
      return `t${i}`;
    }).join(",");
    expect(parseXcpNgTags(many)).toHaveLength(XCP_NG_MAX_TAGS);
  });

  test("a storage repository's type by its technology's name; an unknown one as XAPI reports it", () => {
    expect(getXcpNgStorageTypeLabel("nfs")).toBe("NFS");
    expect(getXcpNgStorageTypeLabel("lvmoiscsi")).toBe("iSCSI (LVM)");
    expect(getXcpNgStorageTypeLabel("linstor")).toBe("XOSTOR");
    expect(getXcpNgStorageTypeLabel("LVM")).toBe("LVM (local)");
    expect(getXcpNgStorageTypeLabel("ext")).toBe("EXT (local)");
    expect(getXcpNgStorageTypeLabel("glusterfs")).toBe("GlusterFS");
    expect(getXcpNgStorageTypeLabel("newfs")).toBe("newfs");
    expect(getXcpNgStorageTypeLabel(undefined)).toBe("");
  });

  test("what a storage repository holds, in words; an unknown content type as reported", () => {
    expect(getXcpNgContentTypeWord("user")).toBe("VM disks");
    expect(getXcpNgContentTypeWord("iso")).toBe("ISO library");
    expect(getXcpNgContentTypeWord("disk")).toBe("Removable media");
    expect(getXcpNgContentTypeWord("custom")).toBe("custom");
    expect(getXcpNgContentTypeWord(null)).toBe("");
  });
});

describe("a VM's memory, as far as Xen Orchestra can see it", () => {
  test("in use while its guest tools say what is free", () => {
    expect(
      getXcpNgVmMemory(
        vm("a", {
          latestMemoryBytes: 2 * GIB,
          maxMemoryBytes: 4 * GIB,
          latestMemoryPercent: 50,
        }),
      ),
    ).toEqual({ inUseBytes: 2 * GIB, givenBytes: 4 * GIB, percent: 50 });
  });

  test("without the guest tools: what it was given, and no percent - never a 100% that reads as full", () => {
    expect(getXcpNgVmMemory(vm("a", { maxMemoryBytes: 4 * GIB }))).toEqual({
      inUseBytes: null,
      givenBytes: 4 * GIB,
      percent: null,
    });
  });

  test("a percent worked out when the row has none; nothing to divide by, none", () => {
    expect(
      getXcpNgMemoryPercent(
        host("a", { latestMemoryBytes: 64 * GIB, maxMemoryBytes: 256 * GIB }),
      ),
    ).toBe(25);
    expect(
      getXcpNgMemoryPercent(host("a", { latestMemoryBytes: 64 * GIB })),
    ).toBeNull();
    expect(
      getXcpNgVmMemory(vm("a", { maxMemoryBytes: 0 })).givenBytes,
    ).toBeNull();
  });
});

describe("the pool counted", () => {
  const rows: Array<XcpNgResource> = [
    host("a"),
    host("b", { isEnabled: false }),
    host("c", { powerState: "Halted", isUp: false }),
    vm("web"),
    vm("db", { powerState: "Halted", isUp: false }),
    vm("cache", { powerState: "Paused", isUp: false }),
    vm("win", { powerState: "Suspended", isUp: false }),
    vm("dom0-a", { isControlDomain: true, powerState: undefined }),
    vm("dom0-b", { isControlDomain: true, powerState: undefined }),
    sr("nfs", { latestDiskBytes: 30 * GIB, maxDiskBytes: 100 * GIB }),
    sr("local", {
      isShared: false,
      latestDiskBytes: 10 * GIB,
      maxDiskBytes: 50 * GIB,
    }),
    sr("tools", {
      contentType: "iso",
      latestDiskBytes: GIB,
      maxDiskBytes: 0,
    }),
    sr("cd", { contentType: "disk", latestDiskBytes: 4 * GIB }),
    row({ kind: "VDI", externalId: "vdi-1" }),
  ];

  test("hosts: running, offline, disabled", () => {
    expect(summarizeXcpNgHosts(rows)).toEqual({
      total: 3,
      running: 2,
      offline: 1,
      disabled: 1,
    });
  });

  test("VMs, control domains counted apart, never as VMs", () => {
    expect(summarizeXcpNgVms(rows)).toEqual({
      total: 4,
      running: 1,
      halted: 1,
      paused: 1,
      suspended: 1,
      controlDomains: 2,
    });
  });

  test("storage for VM disks: ISO libraries and removable media left out, as the pool's row counts it", () => {
    expect(summarizeXcpNgStorage(rows)).toEqual({
      repositories: 4,
      vmDiskRepositories: 2,
      capacityBytes: 150 * GIB,
      usedBytes: 40 * GIB,
    });
  });
});

describe("what a host holds", () => {
  test("its VMs by name, its control domain apart, its local storage", () => {
    const rows: Array<XcpNgResource> = [
      vm("web-10", { parentHostExternalId: "host-a" }),
      vm("web-2", { parentHostExternalId: "host-a" }),
      vm("other", { parentHostExternalId: "host-b" }),
      vm("dom0", { isControlDomain: true, parentHostExternalId: "host-a" }),
      sr("local", { isShared: false, parentHostExternalId: "host-a" }),
      sr("nfs"),
    ];
    const onHost: XcpNgRowsOnHost = getXcpNgRowsOnHost(rows, "host-a");
    expect(
      onHost.vms.map((candidate: XcpNgResource) => {
        return candidate.name;
      }),
    ).toEqual(["web-2", "web-10"]);
    expect(onHost.controlDomain?.name).toBe("dom0");
    expect(
      onHost.storageRepositories.map((candidate: XcpNgResource) => {
        return candidate.name;
      }),
    ).toEqual(["local"]);
    expect(getXcpNgRowsOnHost(rows, "")).toEqual({
      vms: [],
      controlDomain: null,
      storageRepositories: [],
    });
  });
});

describe("orders", () => {
  test("by name as people number them; the UUID settles a tie", () => {
    expect(
      sortXcpNgByName([
        vm("b", { externalId: "2" }),
        vm("web-10"),
        vm("web-2"),
        vm("b", { externalId: "1" }),
      ]).map((candidate: XcpNgResource): string => {
        return `${candidate.name}/${candidate.externalId}`;
      }),
    ).toEqual(["b/1", "b/2", "web-2/vm-web-2", "web-10/vm-web-10"]);
  });

  test("hosts at a glance: down first, then disabled, then the rest, each by name", () => {
    expect(
      sortXcpNgHostsForGlance([
        host("xcp-10"),
        host("xcp-2", { isEnabled: false }),
        host("xcp-3"),
        host("xcp-9", { powerState: "Unknown", isUp: false }),
        host("xcp-1", { powerState: "Halted", isUp: false }),
      ]).map((candidate: XcpNgResource): string => {
        return candidate.name || "";
      }),
    ).toEqual(["xcp-1", "xcp-9", "xcp-2", "xcp-3", "xcp-10"]);
  });

  test("storage at a glance: VM disks first, the fullest first; ISO libraries last", () => {
    expect(
      sortXcpNgStorageForGlance([
        sr("tools", { contentType: "iso", maxDiskBytes: 0 }),
        sr("half", { latestDiskBytes: 50 * GIB }),
        sr("full", { latestDiskBytes: 95 * GIB }),
        sr("empty", { latestDiskBytes: 0 }),
      ]).map((candidate: XcpNgResource): string => {
        return candidate.name || "";
      }),
    ).toEqual(["full", "half", "empty", "tools"]);
  });
});

describe("the busiest", () => {
  const fresh: Date = ago(MINUTE);
  const rows: Array<XcpNgResource> = [
    vm("quiet", {
      latestCpuPercent: 5,
      latestMemoryPercent: 90,
      latestMemoryBytes: 9 * GIB,
      maxMemoryBytes: 10 * GIB,
      metricsUpdatedAt: fresh,
    }),
    vm("busy", {
      latestCpuPercent: 80,
      latestMemoryPercent: 10,
      latestMemoryBytes: GIB,
      maxMemoryBytes: 10 * GIB,
      metricsUpdatedAt: fresh,
    }),
    vm("tied", {
      latestCpuPercent: 80,
      latestMemoryPercent: 20,
      metricsUpdatedAt: fresh,
    }),
    vm("no-tools", { latestCpuPercent: 40, metricsUpdatedAt: fresh }),
    vm("stale", { latestCpuPercent: 99, metricsUpdatedAt: ago(HOUR) }),
    vm("stopped", {
      powerState: "Halted",
      isUp: false,
      latestCpuPercent: 70,
      metricsUpdatedAt: fresh,
    }),
    vm("dom0", {
      isControlDomain: true,
      latestCpuPercent: 95,
      metricsUpdatedAt: fresh,
    }),
    host("h1", { latestCpuPercent: 30, metricsUpdatedAt: fresh }),
  ];

  function names(parts: Array<XcpNgBusyPart>): Array<string> {
    return parts.map((part: XcpNgBusyPart): string => {
      return part.row.name || "";
    });
  }

  test("by CPU: running, fresh, no control domain; a tie broken by memory", () => {
    expect(
      names(
        getXcpNgBusiestParts({
          rows: rows,
          kind: XcpNgResourceKind.VM,
          now: NOW,
          staleMs: 15 * MINUTE,
          limit: 10,
        }),
      ),
    ).toEqual(["tied", "busy", "no-tools", "quiet"]);
  });

  test("by memory: a VM without guest tools is never ranked by it", () => {
    expect(
      names(
        getXcpNgBusiestParts({
          rows: rows,
          kind: XcpNgResourceKind.VM,
          now: NOW,
          staleMs: 15 * MINUTE,
          limit: 10,
          rankBy: "memory",
        }),
      ),
    ).toEqual(["quiet", "tied", "busy"]);
  });

  test("hosts ranked apart from VMs, and the list cut at its limit", () => {
    expect(
      names(
        getXcpNgBusiestParts({
          rows: rows,
          kind: XcpNgResourceKind.Host,
          now: NOW,
          staleMs: 15 * MINUTE,
          limit: 5,
        }),
      ),
    ).toEqual(["h1"]);
    expect(
      getXcpNgBusiestParts({
        rows: rows,
        kind: XcpNgResourceKind.VM,
        now: NOW,
        staleMs: 15 * MINUTE,
        limit: 2,
      }),
    ).toHaveLength(2);
  });

  test("each part carries its readings", () => {
    const [busy] = getXcpNgBusiestParts({
      rows: [rows[1]!],
      kind: XcpNgResourceKind.VM,
      now: NOW,
      staleMs: 15 * MINUTE,
      limit: 5,
    });
    expect(busy).toEqual({
      row: rows[1],
      cpuPercent: 80,
      memoryPercent: 10,
      memoryBytes: GIB,
    });
  });
});

describe("the recommended alerts each part's page lists", () => {
  test("are templates the pool offers, each kind's own", () => {
    const ids: Array<string> = getAllXcpNgAlertTemplates().map(
      (template: { id: string }): string => {
        return template.id;
      },
    );
    for (const id of [
      ...XCP_NG_HOST_ALERT_TEMPLATE_IDS,
      ...XCP_NG_VM_ALERT_TEMPLATE_IDS,
      ...XCP_NG_STORAGE_ALERT_TEMPLATE_IDS,
    ]) {
      expect(ids).toContain(id);
    }
    expect(XCP_NG_HOST_ALERT_TEMPLATE_IDS[0]).toBe("xcp-ng-host-offline");
    expect(XCP_NG_VM_ALERT_TEMPLATE_IDS[0]).toBe("xcp-ng-vm-stopped");
    expect(XCP_NG_STORAGE_ALERT_TEMPLATE_IDS[0]).toBe("xcp-ng-sr-near-full");
  });
});

describe("what a part's page lists as needing attention", () => {
  const routeFor: (kind: string, externalId: string) => Route = (
    kind: string,
    externalId: string,
  ): Route => {
    return new Route(`/pool/${kind}/${encodeURIComponent(externalId)}`);
  };

  test("a host's: itself, the VMs it runs and its storage, named as its card names it", () => {
    const attention: ResourcePartAttention = getXcpNgPartAttention({
      kind: "Host",
      externalId: "host-a",
      row: host("a", { isEnabled: false }),
      hostRows: [
        vm("db", {
          powerState: "Halted",
          isUp: false,
          lastRunningAt: ago(HOUR),
        }),
        sr("local", { isShared: false, latestDiskBytes: 99 * GIB }),
      ],
      routeFor: routeFor,
      now: NOW,
    });
    expect(
      attention.items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["StorageRepository:sr-local", "Host:host-a", "VM:vm-db"]);
    expect(attention.current).toEqual({
      key: "Host:host-a",
      label: "This host",
    });
    expect(attention.description).toBe(
      XCP_NG_PART_ATTENTION_WORDS.Host.description,
    );
  });

  test("a VM's and a storage repository's: the part alone", () => {
    const attention: ResourcePartAttention = getXcpNgPartAttention({
      kind: "VM",
      externalId: "vm-db",
      row: vm("db", {
        powerState: "Paused",
        isUp: false,
        lastRunningAt: ago(HOUR),
      }),
      hostRows: [host("a", { powerState: "Halted" })],
      routeFor: routeFor,
      now: NOW,
    });
    expect(attention.items).toHaveLength(1);
    expect(attention.current).toEqual({ key: "VM:vm-db", label: "This VM" });
    expect(
      getXcpNgPartAttention({
        kind: "StorageRepository",
        externalId: "sr-x",
        row: null,
        routeFor: routeFor,
        now: NOW,
      }),
    ).toEqual({
      items: [],
      description: XCP_NG_PART_ATTENTION_WORDS.StorageRepository.description,
      current: {
        key: "StorageRepository:sr-x",
        label: "This storage repository",
      },
    });
  });
});

describe("what each count of what is wrong opens", () => {
  function item(severity: ResourceAttentionSeverity): ResourceAttentionItem {
    return {
      key: `${severity}`,
      kind: "Host",
      icon: "ServerStack" as ResourceAttentionItem["icon"],
      name: "a",
      severity: severity,
      reasons: [],
    };
  }

  test("no pill while nothing it counts is wrong", () => {
    expect(
      getXcpNgProblemPill({
        problem: { kind: "hostsOffline" },
        items: [],
        translator: ENGLISH,
        testId: "x",
      }),
    ).toBeUndefined();
  });

  test("a count, its tone from what it lists, and the dialog of exactly those parts", () => {
    const pill: ResourceAttentionPillProps | undefined = getXcpNgProblemPill({
      problem: { kind: "hostsOffline" },
      items: [item(ResourceAttentionSeverity.Critical)],
      translator: ENGLISH,
      testId: "hosts-offline",
    });
    expect(pill?.label).toBe("1 offline");
    expect(pill?.tone).toBe("danger");
    expect(pill?.testId).toBe("hosts-offline");
    expect(pill?.hint).toBe("Show which hosts and why");
    expect(pill?.dialog.title).toBe("1 host is offline");
    expect(pill?.dialog.items).toHaveLength(1);
    expect(pill?.dialog.showKind).toBe(false);
    expect(pill?.dialog.emptyMessage).toBe("Every host is running now.");
  });

  test("a disabled host is someone's choice: its count is grey whatever its severity", () => {
    const pill: ResourceAttentionPillProps | undefined = getXcpNgProblemPill({
      problem: { kind: "hostsDisabled" },
      items: [
        item(ResourceAttentionSeverity.Warning),
        item(ResourceAttentionSeverity.Critical),
      ],
      translator: ENGLISH,
      testId: "x",
    });
    expect(pill?.tone).toBe("neutral");
    expect(pill?.label).toBe("2 disabled");
    expect(pill?.dialog.title).toBe("2 hosts are disabled");
  });

  test("warnings only read amber; a count of several, in the plural", () => {
    const pill: ResourceAttentionPillProps | undefined = getXcpNgProblemPill({
      problem: { kind: "vmsStopped" },
      items: [
        item(ResourceAttentionSeverity.Warning),
        item(ResourceAttentionSeverity.Warning),
      ],
      translator: ENGLISH,
      testId: "x",
    });
    expect(pill?.tone).toBe("warning");
    expect(pill?.label).toBe("2 stopped");
    expect(pill?.dialog.title).toBe("2 VMs stopped after running");
  });

  test("every count has words of its own, whole sentences where it says one", () => {
    for (const [kind, words] of Object.entries(XCP_NG_PROBLEM_WORDS)) {
      expect({ kind, ends: SENTENCE_END.test(words.description) }).toEqual({
        kind,
        ends: true,
      });
      expect({ kind, ends: SENTENCE_END.test(words.emptyMessage) }).toEqual({
        kind,
        ends: true,
      });
      expect(words.label.one).toContain("{{count}}");
      expect(words.title.other).toContain("{{count}}");
    }
  });
});

describe("the pages' own tooltips", () => {
  test("read as short, finished sentences, as the shared catalog's must", () => {
    expectReadableDescriptionRecord(
      XCP_NG_PAGE_DESCRIPTIONS,
      "XcpNgPageDescriptions:XCP_NG_PAGE_DESCRIPTIONS",
    );
  });
});
