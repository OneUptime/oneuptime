import { describe, expect, test } from "@jest/globals";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  PROXMOX_MAX_TAGS,
  PROXMOX_NODE_ALERT_TEMPLATE_IDS,
  PROXMOX_STORAGE_ALERT_TEMPLATE_IDS,
  ProxmoxBackupSummary,
  ProxmoxBusyGuest,
  ProxmoxGuestBackup,
  ProxmoxGuestSummary,
  formatProxmoxDuration,
  getProxmoxBusiestGuests,
  getProxmoxDiskPercent,
  getProxmoxGuestAlertTemplateIds,
  getProxmoxGuestBackup,
  getProxmoxGuestKind,
  getProxmoxHaBadge,
  getProxmoxLockBadge,
  getProxmoxMemoryPercent,
  getProxmoxNodeName,
  getProxmoxPartStatus,
  getProxmoxRowsOnNode,
  getProxmoxStorageContentWords,
  getProxmoxStorageTypeLabel,
  parseProxmoxTags,
  sortProxmoxGuests,
  summarizeProxmoxBackups,
  summarizeProxmoxGuests,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxPartFacts";
import { ResourcePartStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";

/*
 * What a Proxmox node, guest or storage is, in the words its pages use
 * (Pages/Proxmox/Utils/ProxmoxPartFacts): its status and badges, a guest's
 * kind, tags, lock and last backup, a cluster's guests and backups counted,
 * a node's parts, and which recommended alerts watch each kind of part.
 */

const NOW: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const GIB: number = 1024 * 1024 * 1024;

function row(fields: Partial<ProxmoxResource>): ProxmoxResource {
  return Object.assign(new ProxmoxResource(), fields);
}

function guest(
  vmid: number,
  fields: Partial<ProxmoxResource> = {},
): ProxmoxResource {
  return row({
    kind: "Guest",
    externalId: `qemu/${vmid}`,
    name: `vm-${vmid}`,
    vmid: vmid,
    guestType: "qemu",
    isUp: true,
    ...fields,
  });
}

describe("a part's status", () => {
  function status(fields: Partial<ProxmoxResource>): ResourcePartStatus | null {
    return getProxmoxPartStatus(row(fields));
  }

  test("a node is Online or Offline", () => {
    expect(status({ kind: "Node", isUp: true })).toEqual({
      label: "Online",
      tone: "positive",
    });
    expect(status({ kind: "Node", isUp: false })).toEqual({
      label: "Offline",
      tone: "danger",
    });
  });

  test("a storage is Available or Unavailable", () => {
    expect(status({ kind: "Storage", isUp: true })?.label).toBe("Available");
    expect(status({ kind: "Storage", isUp: false })).toEqual({
      label: "Unavailable",
      tone: "danger",
    });
  });

  test("a guest is Running, or Stopped - a warning only when it starts on boot", () => {
    expect(status({ kind: "Guest", isUp: true })?.label).toBe("Running");
    expect(status({ kind: "Guest", isUp: false })).toEqual({
      label: "Stopped",
      tone: "neutral",
    });
    expect(status({ kind: "Guest", isUp: false, onboot: true })).toEqual({
      label: "Stopped",
      tone: "warning",
    });
  });

  test("a template is a Template, never Stopped, even before its status arrives", () => {
    expect(status({ kind: "Guest", isUp: false, isTemplate: true })).toEqual({
      label: "Template",
      tone: "neutral",
    });
    expect(
      status({ kind: "Guest", isUp: undefined, isTemplate: true })?.label,
    ).toBe("Template");
  });

  test("before Proxmox reported a status there is none", () => {
    expect(status({ kind: "Node", isUp: undefined })).toBeNull();
    expect(status({ kind: "Guest", isUp: null as unknown as boolean })).toBe(
      null,
    );
  });
});

describe("a guest's kind", () => {
  test("a QEMU guest is a VM, an LXC guest a Container", () => {
    expect(getProxmoxGuestKind(row({ guestType: "qemu" }))).toBe("VM");
    expect(getProxmoxGuestKind(row({ guestType: "lxc" }))).toBe("Container");
  });

  test("without its type, its id says it", () => {
    expect(getProxmoxGuestKind(row({ externalId: "lxc/101" }))).toBe(
      "Container",
    );
    expect(getProxmoxGuestKind(row({ externalId: "qemu/100" }))).toBe("VM");
    expect(getProxmoxGuestKind(row({ externalId: "odd" }))).toBe("");
    expect(getProxmoxGuestKind(row({}))).toBe("");
  });
});

describe("a node's name", () => {
  test("comes from its id, else its name", () => {
    expect(
      getProxmoxNodeName(row({ externalId: "node/pve1", name: "Rack 3" })),
    ).toBe("pve1");
    expect(getProxmoxNodeName(null, "node/pve2")).toBe("pve2");
    expect(
      getProxmoxNodeName(row({ externalId: "qemu/100", name: "web" })),
    ).toBe("web");
    expect(getProxmoxNodeName(null, "qemu/100")).toBe("");
  });
});

describe("a guest's tags", () => {
  test("are split as Proxmox VE writes them, each once, in order", () => {
    expect(parseProxmoxTags("prod;web")).toEqual(["prod", "web"]);
    expect(parseProxmoxTags("prod, web db;prod")).toEqual([
      "prod",
      "web",
      "db",
    ]);
    expect(parseProxmoxTags(" ; ,")).toEqual([]);
    expect(parseProxmoxTags("")).toEqual([]);
    expect(parseProxmoxTags(null)).toEqual([]);
    expect(parseProxmoxTags(undefined)).toEqual([]);
  });

  test(`no more than ${PROXMOX_MAX_TAGS} are kept`, () => {
    const many: string = Array.from({ length: 50 }, (_: unknown, i: number) => {
      return `t${i}`;
    }).join(";");
    expect(parseProxmoxTags(many)).toHaveLength(PROXMOX_MAX_TAGS);
  });

  test("a huge tags label is split in linear time", () => {
    const huge: string = `${";".repeat(200000)}x${" ,".repeat(200000)}`;
    const started: number = Date.now();
    expect(parseProxmoxTags(huge)).toEqual(["x"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("a guest's badges", () => {
  test("a lock reads as what the task is doing", () => {
    expect(getProxmoxLockBadge("backup")).toEqual({
      key: "lock",
      label: "Backup running",
      tone: "neutral",
    });
    expect(getProxmoxLockBadge("migrate")?.label).toBe("Migrating");
    expect(getProxmoxLockBadge("snapshot-delete")?.label).toBe(
      "Deleting a snapshot",
    );
    expect(getProxmoxLockBadge("suspended")?.label).toBe("Suspended");
  });

  test("a lock Proxmox adds later still shows, by its name", () => {
    expect(getProxmoxLockBadge("fstrim")).toEqual({
      key: "lock",
      label: "Locked: {{lock}}",
      values: { lock: "fstrim" },
      tone: "neutral",
    });
  });

  test("no lock, no badge", () => {
    expect(getProxmoxLockBadge("")).toBeNull();
    expect(getProxmoxLockBadge("  ")).toBeNull();
    expect(getProxmoxLockBadge(null)).toBeNull();
  });

  test("HA's state is red when HA gave up, green when normal, grey otherwise", () => {
    expect(getProxmoxHaBadge("error")?.tone).toBe("danger");
    expect(getProxmoxHaBadge("fence")?.tone).toBe("danger");
    expect(getProxmoxHaBadge("started")?.tone).toBe("positive");
    expect(getProxmoxHaBadge("online")?.tone).toBe("positive");
    expect(getProxmoxHaBadge("migrate")).toEqual({
      key: "ha",
      label: "HA: {{state}}",
      values: { state: "migrate" },
      tone: "neutral",
    });
    expect(getProxmoxHaBadge(undefined)).toBeNull();
  });
});

describe("a guest's last backup", () => {
  test("its result wins over its job coverage", () => {
    const failed: ProxmoxGuestBackup = getProxmoxGuestBackup(
      guest(100, {
        isBackedUp: false,
        lastBackupStatus: "failed",
        lastBackupAt: new Date(NOW.getTime() - HOUR),
        lastSuccessfulBackupAt: new Date(NOW.getTime() - 25 * HOUR),
      }),
    );
    expect(failed.state).toBe("failed");
    expect(failed.isInJob).toBe(false);
    expect(failed.lastSuccessfulBackupAt?.getTime()).toBe(
      NOW.getTime() - 25 * HOUR,
    );
  });

  test("a good backup carries its size and how long it took", () => {
    const ok: ProxmoxGuestBackup = getProxmoxGuestBackup(
      guest(100, {
        lastBackupStatus: "ok",
        lastBackupAt: "2026-11-01T05:00:00.000Z" as unknown as Date,
        lastBackupBytes: "19755850547" as unknown as number,
        lastBackupDurationSeconds: 212,
      }),
    );
    expect(ok.state).toBe("ok");
    expect(ok.lastBackupAt?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(ok.bytes).toBe(19755850547);
    expect(ok.durationSeconds).toBe(212);
  });

  test("before any result: in a job, in none, or nothing reported", () => {
    expect(getProxmoxGuestBackup(guest(1, { isBackedUp: true })).state).toBe(
      "no-result",
    );
    expect(getProxmoxGuestBackup(guest(1, { isBackedUp: false })).state).toBe(
      "not-in-job",
    );
    expect(getProxmoxGuestBackup(guest(1)).state).toBe("unknown");
    expect(getProxmoxGuestBackup(guest(1)).isInJob).toBeNull();
  });
});

describe("a cluster's backups and guests, counted", () => {
  const rows: Array<ProxmoxResource> = [
    guest(100, {
      isBackedUp: true,
      lastBackupStatus: "ok",
      lastBackupAt: new Date(NOW.getTime() - 7 * HOUR),
    }),
    guest(101, {
      isBackedUp: true,
      lastBackupStatus: "failed",
      lastBackupAt: new Date(NOW.getTime() - 2 * HOUR),
      isUp: false,
    }),
    guest(102, { isBackedUp: false, guestType: "lxc", externalId: "lxc/102" }),
    guest(103, {}),
    // A template is backed up like any guest, but never counted as one that runs.
    guest(9000, {
      isTemplate: true,
      isUp: false,
      isBackedUp: false,
      lastBackupStatus: "failed",
      lastBackupAt: new Date(NOW.getTime() - MINUTE),
    }),
    row({ kind: "Node", externalId: "node/pve1", isUp: true }),
  ];

  test("backups: results from the notifications, coverage from the exporter, templates left out", () => {
    const summary: ProxmoxBackupSummary = summarizeProxmoxBackups(rows);
    expect(summary).toEqual({
      guests: 4,
      coverageKnown: 3,
      inJob: 2,
      notInJob: 1,
      withResult: 2,
      ok: 1,
      failed: 1,
      newestBackupAt: new Date(NOW.getTime() - 2 * HOUR),
    });
  });

  test("guests: what can run, how many do, and the templates on their own", () => {
    const summary: ProxmoxGuestSummary = summarizeProxmoxGuests(rows);
    expect(summary).toEqual({
      total: 4,
      running: 3,
      stopped: 1,
      templates: 1,
      vms: 3,
      containers: 1,
    });
  });

  test("an empty cluster counts nothing", () => {
    expect(summarizeProxmoxBackups([]).newestBackupAt).toBeNull();
    expect(summarizeProxmoxGuests([]).total).toBe(0);
  });
});

describe("a node's parts", () => {
  test("its guests and storage, by the node they report", () => {
    const rows: Array<ProxmoxResource> = [
      row({ kind: "Node", externalId: "node/pve1", parentNodeName: undefined }),
      guest(100, { parentNodeName: "pve1" }),
      guest(101, { parentNodeName: "pve2" }),
      row({
        kind: "Storage",
        externalId: "storage/pve1/local",
        parentNodeName: "pve1",
      }),
      row({
        kind: "Storage",
        externalId: "storage/pve2/local",
        parentNodeName: "pve2",
      }),
    ];
    const onNode: {
      guests: Array<ProxmoxResource>;
      storage: Array<ProxmoxResource>;
    } = getProxmoxRowsOnNode(rows, "pve1");
    expect(
      onNode.guests.map((g: ProxmoxResource) => {
        return g.externalId;
      }),
    ).toEqual(["qemu/100"]);
    expect(
      onNode.storage.map((s: ProxmoxResource) => {
        return s.externalId;
      }),
    ).toEqual(["storage/pve1/local"]);
    expect(getProxmoxRowsOnNode(rows, "")).toEqual({ guests: [], storage: [] });
  });

  test("guests read in VMID order, then by name", () => {
    const sorted: Array<string> = sortProxmoxGuests([
      guest(110, { name: "b" }),
      guest(9, { name: "z" }),
      row({ kind: "Guest", externalId: "qemu/x", name: "web-10" }),
      guest(100, { name: "a" }),
      row({ kind: "Guest", externalId: "qemu/y", name: "web-2" }),
    ]).map((g: ProxmoxResource): string => {
      return g.name || "";
    });
    expect(sorted).toEqual(["z", "a", "b", "web-2", "web-10"]);
  });

  test("the busiest running guests, by CPU then memory, leave out stopped, stale and templates", () => {
    const fresh: Date = new Date(NOW.getTime() - MINUTE);
    const busy: Array<ProxmoxBusyGuest> = getProxmoxBusiestGuests({
      rows: [
        guest(1, {
          latestCpuPercent: 10,
          latestMemoryPercent: 90,
          metricsUpdatedAt: fresh,
        }),
        guest(2, { latestCpuPercent: 80, metricsUpdatedAt: fresh }),
        guest(3, {
          latestCpuPercent: 10,
          latestMemoryPercent: 20,
          metricsUpdatedAt: fresh,
        }),
        guest(4, {
          latestCpuPercent: 99,
          isUp: false,
          metricsUpdatedAt: fresh,
        }),
        guest(5, {
          latestCpuPercent: 99,
          metricsUpdatedAt: new Date(NOW.getTime() - 20 * MINUTE),
        }),
        guest(6, {
          latestCpuPercent: 99,
          isTemplate: true,
          metricsUpdatedAt: fresh,
        }),
        guest(7, { latestCpuPercent: 50 }),
      ],
      now: NOW,
      staleMs: 15 * MINUTE,
      limit: 2,
    });
    expect(
      busy.map((b: ProxmoxBusyGuest) => {
        return b.row.vmid;
      }),
    ).toEqual([2, 1]);
  });
});

describe("how a part reads", () => {
  test("a task's duration", () => {
    expect(formatProxmoxDuration(45)).toBe("45s");
    expect(formatProxmoxDuration(212)).toBe("3m 32s");
    expect(formatProxmoxDuration(3900)).toBe("1h 5m");
    expect(formatProxmoxDuration(0)).toBe("0s");
    expect(formatProxmoxDuration(null)).toBe("");
    expect(formatProxmoxDuration(Number.NaN)).toBe("");
  });

  test("a storage's type as Proxmox VE's own UI names it", () => {
    expect(getProxmoxStorageTypeLabel("zfspool")).toBe("ZFS");
    expect(getProxmoxStorageTypeLabel("lvmthin")).toBe("LVM-Thin");
    expect(getProxmoxStorageTypeLabel("pbs")).toBe("Proxmox Backup Server");
    expect(getProxmoxStorageTypeLabel("dir")).toBe("Directory");
    expect(getProxmoxStorageTypeLabel("newtype")).toBe("newtype");
    expect(getProxmoxStorageTypeLabel(undefined)).toBe("");
  });

  test("what a storage holds, in words, each once", () => {
    expect(
      getProxmoxStorageContentWords("images,rootdir,backup,images"),
    ).toEqual(["Disk images", "Container disks", "Backups"]);
    expect(getProxmoxStorageContentWords("iso, vztmpl,snippets")).toEqual([
      "ISO images",
      "Container templates",
      "Snippets",
    ]);
    expect(getProxmoxStorageContentWords("newcontent")).toEqual(["newcontent"]);
    expect(getProxmoxStorageContentWords("")).toEqual([]);
  });

  test("memory and disk shares, from the share Proxmox gives or from bytes", () => {
    expect(getProxmoxMemoryPercent(row({ latestMemoryPercent: 42 }))).toBe(42);
    expect(
      getProxmoxMemoryPercent(
        row({ latestMemoryBytes: 4 * GIB, maxMemoryBytes: 16 * GIB }),
      ),
    ).toBe(25);
    expect(getProxmoxMemoryPercent(row({ latestMemoryBytes: 4 * GIB }))).toBe(
      null,
    );
    expect(
      getProxmoxDiskPercent(
        row({ latestDiskBytes: 30 * GIB, maxDiskBytes: 120 * GIB }),
      ),
    ).toBe(25);
    expect(
      getProxmoxDiskPercent(row({ maxDiskBytes: 0, latestDiskBytes: 1 })),
    ).toBe(null);
  });

  test("numbers and dates off the wire", () => {
    expect(toProxmoxNumber("12")).toBe(12);
    expect(toProxmoxNumber("")).toBeNull();
    expect(toProxmoxNumber("abc")).toBeNull();
    expect(toProxmoxNumber(undefined)).toBeNull();
    expect(toProxmoxDate("2026-11-01T05:00:00.000Z")?.toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
    expect(toProxmoxDate("not a date")).toBeNull();
    expect(toProxmoxDate(null)).toBeNull();
  });
});

describe("the alerts that watch each kind of part", () => {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.Proxmox,
    );
  const templateIds: Set<string> = new Set(
    recommendations.map((recommendation: MonitorRecommendation): string => {
      return recommendation.templateId;
    }),
  );

  test.each([
    ["node", PROXMOX_NODE_ALERT_TEMPLATE_IDS],
    ["storage", PROXMOX_STORAGE_ALERT_TEMPLATE_IDS],
    ["VM", getProxmoxGuestAlertTemplateIds({ guestType: "qemu" })],
    ["container", getProxmoxGuestAlertTemplateIds({ guestType: "lxc" })],
  ])(
    "every %s alert is a recommendation the cluster offers",
    (_kind: string, ids: Array<string>) => {
      for (const id of ids) {
        expect({ id, offered: templateIds.has(id) }).toEqual({
          id,
          offered: true,
        });
      }
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  test("only a container is watched for its root disk", () => {
    expect(getProxmoxGuestAlertTemplateIds({ guestType: "lxc" })).toContain(
      "pve-lxc-disk-near-full",
    );
    expect(
      getProxmoxGuestAlertTemplateIds({ guestType: "qemu" }),
    ).not.toContain("pve-lxc-disk-near-full");
  });

  test("the notification alerts are among them: a fenced node, a failed backup job", () => {
    expect(PROXMOX_NODE_ALERT_TEMPLATE_IDS).toContain("pve-node-fenced");
    expect(getProxmoxGuestAlertTemplateIds(null)).toContain(
      "pve-backup-job-failed",
    );
  });
});
