import { describe, expect, test } from "@jest/globals";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import Route from "../../../Types/API/Route";
import {
  PROXMOX_ATTENTION_KIND_ORDER,
  PROXMOX_STORAGE_FULL_PERCENT,
  PROXMOX_STORAGE_NEAR_FULL_PERCENT,
  ProxmoxAssessment,
  ProxmoxIssueTarget,
  ProxmoxPartKind,
  assessProxmoxGuest,
  assessProxmoxNode,
  assessProxmoxResource,
  assessProxmoxStorage,
  getProxmoxAttentionItems,
  getProxmoxClusterHealth,
  getProxmoxDisplayName,
  getProxmoxIssueTarget,
  getProxmoxStoragePercent,
  isProxmoxIssueAbout,
  isProxmoxTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * What on a Proxmox VE cluster needs someone, and how bad it is: the one
 * set of rules the cluster's health pill, its Needs attention card, a part's
 * own page and the Topology read (Pages/Proxmox/Utils/ProxmoxHealth).
 */

const GIB: number = 1024 * 1024 * 1024;

function row(fields: Partial<ProxmoxResource>): ProxmoxResource {
  return Object.assign(new ProxmoxResource(), fields);
}

function node(
  name: string,
  fields: Partial<ProxmoxResource> = {},
): ProxmoxResource {
  return row({
    kind: "Node",
    externalId: `node/${name}`,
    name: name,
    isUp: true,
    ...fields,
  });
}

function guest(
  vmid: number,
  name: string,
  fields: Partial<ProxmoxResource> = {},
): ProxmoxResource {
  return row({
    kind: "Guest",
    externalId: `qemu/${vmid}`,
    name: name,
    vmid: vmid,
    guestType: "qemu",
    isUp: true,
    ...fields,
  });
}

function storage(
  id: string,
  usedGiB: number | undefined,
  totalGiB: number | undefined,
  fields: Partial<ProxmoxResource> = {},
): ProxmoxResource {
  return row({
    kind: "Storage",
    externalId: `storage/${id}`,
    name: id.substring(id.lastIndexOf("/") + 1),
    isUp: true,
    latestDiskBytes: usedGiB === undefined ? undefined : usedGiB * GIB,
    maxDiskBytes: totalGiB === undefined ? undefined : totalGiB * GIB,
    ...fields,
  });
}

function texts(assessment: ProxmoxAssessment): Array<string> {
  return assessment.reasons.map((reason: ResourceAttentionText): string => {
    let text: string = reason.text;
    for (const [key, value] of Object.entries(reason.values || {})) {
      text = text.split(`{{${key}}}`).join(value);
    }
    return text;
  });
}

const ROUTES: Array<[ProxmoxPartKind, string]> = [];

function routeFor(kind: ProxmoxPartKind, externalId: string): Route {
  ROUTES.push([kind, externalId]);
  return new Route(`/${kind.toLowerCase()}/${encodeURIComponent(externalId)}`);
}

describe("a node", () => {
  test("online and not fenced: nothing to say", () => {
    expect(assessProxmoxNode(node("pve1"))).toEqual({
      severity: null,
      reasons: [],
    });
  });

  test("offline is critical", () => {
    const assessment: ProxmoxAssessment = assessProxmoxNode(
      node("pve1", { isUp: false }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment)).toEqual(["Offline"]);
  });

  test.each(["error", "fence"])(
    "HA %s is critical, with the state named",
    (state: string) => {
      const assessment: ProxmoxAssessment = assessProxmoxNode(
        node("pve1", { haState: state }),
      );
      expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
      expect(texts(assessment)).toEqual([`HA state: ${state}`]);
    },
  );

  test.each(["online", "maintenance", "unknown"])(
    "HA %s is not a problem by itself",
    (state: string) => {
      expect(assessProxmoxNode(node("pve1", { haState: state })).severity).toBe(
        null,
      );
    },
  );

  test("a node with no status yet is not called offline", () => {
    expect(
      assessProxmoxNode(node("pve1", { isUp: undefined })).severity,
    ).toBeNull();
  });
});

describe("a guest", () => {
  test("running, in a job, its last backup good: nothing to say", () => {
    expect(
      assessProxmoxGuest(
        guest(100, "web", {
          onboot: true,
          isBackedUp: true,
          lastBackupStatus: "ok",
        }),
      ).severity,
    ).toBeNull();
  });

  test("stopped on purpose is not a problem; stopped although it starts on boot is", () => {
    expect(
      assessProxmoxGuest(guest(100, "web", { isUp: false, onboot: false }))
        .severity,
    ).toBeNull();
    const onBoot: ProxmoxAssessment = assessProxmoxGuest(
      guest(100, "web", { isUp: false, onboot: true }),
    );
    expect(onBoot.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(onBoot)).toEqual(["Stopped, but starts on boot"]);
  });

  test("in no backup job, or a failed last backup, needs a look", () => {
    const assessment: ProxmoxAssessment = assessProxmoxGuest(
      guest(100, "web", { isBackedUp: false, lastBackupStatus: "failed" }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(assessment)).toEqual([
      "In no backup job",
      "Last backup failed",
    ]);
  });

  test("backup coverage not reported yet is not a gap", () => {
    expect(
      assessProxmoxGuest(guest(100, "web", { isBackedUp: undefined })).severity,
    ).toBeNull();
  });

  test("HA in error makes it critical, and its other reasons stay", () => {
    const assessment: ProxmoxAssessment = assessProxmoxGuest(
      guest(100, "web", {
        haState: "error",
        isUp: false,
        onboot: true,
      }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment)).toEqual([
      "HA state: error",
      "Stopped, but starts on boot",
    ]);
  });

  test("a template never runs: neither stopped, nor in need of a backup job", () => {
    const template: ProxmoxResource = guest(9000, "debian-template", {
      isTemplate: true,
      isUp: false,
      onboot: true,
      isBackedUp: false,
      lastBackupStatus: "failed",
    });
    expect(isProxmoxTemplate(template)).toBe(true);
    expect(assessProxmoxGuest(template)).toEqual({
      severity: null,
      reasons: [],
    });
  });

  test("a template HA gave up on is still critical", () => {
    expect(
      assessProxmoxGuest(
        guest(9000, "debian-template", { isTemplate: true, haState: "error" }),
      ).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("a storage", () => {
  test("unavailable is critical, whatever its size", () => {
    const assessment: ProxmoxAssessment = assessProxmoxStorage(
      storage("pve1/backup", undefined, undefined, { isUp: false }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment)).toEqual(["Unavailable"]);
  });

  test(`more than ${PROXMOX_STORAGE_FULL_PERCENT}% full is critical`, () => {
    const assessment: ProxmoxAssessment = assessProxmoxStorage(
      storage("pve1/local", 96, 100),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment)).toEqual(["96% full"]);
  });

  test(`more than ${PROXMOX_STORAGE_NEAR_FULL_PERCENT}% full needs a look`, () => {
    const assessment: ProxmoxAssessment = assessProxmoxStorage(
      storage("pve1/local", 90, 100),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(assessment)).toEqual(["90% full"]);
  });

  test("the thresholds are strict: exactly 85% and exactly 95% are not past them", () => {
    expect(
      assessProxmoxStorage(storage("pve1/a", 85, 100)).severity,
    ).toBeNull();
    expect(assessProxmoxStorage(storage("pve1/b", 95, 100)).severity).toBe(
      ResourceAttentionSeverity.Warning,
    );
  });

  test("a storage that reports no size has no share to judge", () => {
    expect(getProxmoxStoragePercent(storage("pve1/a", 10, undefined))).toBe(
      null,
    );
    expect(getProxmoxStoragePercent(storage("pve1/a", 10, 0))).toBe(null);
    expect(
      assessProxmoxStorage(storage("pve1/a", 10, undefined)).severity,
    ).toBeNull();
  });

  test("a bigint size off the wire still counts", () => {
    expect(
      getProxmoxStoragePercent(
        row({
          kind: "Storage",
          latestDiskBytes: "50" as unknown as number,
          maxDiskBytes: "200" as unknown as number,
        }),
      ),
    ).toBe(25);
  });
});

describe("assessProxmoxResource", () => {
  test("reads each kind by its own rules, and anything else as fine", () => {
    expect(assessProxmoxResource(node("pve1", { isUp: false })).severity).toBe(
      ResourceAttentionSeverity.Critical,
    );
    expect(
      assessProxmoxResource(guest(1, "a", { isBackedUp: false })).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(assessProxmoxResource(storage("pve1/a", 99, 100)).severity).toBe(
      ResourceAttentionSeverity.Critical,
    );
    expect(
      assessProxmoxResource(row({ kind: "Something", isUp: false })).severity,
    ).toBeNull();
  });
});

describe("the attention list", () => {
  const rows: Array<ProxmoxResource> = [
    guest(101, "web-10", { isBackedUp: false }),
    guest(102, "web-2", { isUp: false, onboot: true }),
    node("pve3", { isUp: false }),
    storage("pve1/local", 90, 100),
    storage("pve2/backup", undefined, undefined, { isUp: false }),
    node("pve1"),
    guest(103, "db", { haState: "fence" }),
  ];

  test("critical first; then the cluster, nodes, storage, guests and replication; names in number order", () => {
    const items: Array<ResourceAttentionItem> = getProxmoxAttentionItems({
      rows: rows,
      replicationJobs: [
        { jobId: "101-0", guestVmid: "101", failedSyncs: 3 },
        { jobId: "102-0", guestVmid: "102", failedSyncs: 0 },
      ],
      routeFor: routeFor,
    });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return `${item.severity}:${item.kind}:${item.name}`;
      }),
    ).toEqual([
      "critical:Node:pve3",
      "critical:Storage:backup",
      "critical:Guest:db",
      "warning:Storage:local",
      "warning:Guest:web-2",
      "warning:Guest:web-10",
      "warning:Replication job:101-0 (web-10)",
    ]);
    expect(PROXMOX_ATTENTION_KIND_ORDER).toEqual([
      "Cluster",
      "Node",
      "Storage",
      "Guest",
      "Replication job",
    ]);
  });

  test("each part links to its own page; a replication job to its guest's", () => {
    const items: Array<ResourceAttentionItem> = getProxmoxAttentionItems({
      rows: rows,
      replicationJobs: [{ jobId: "101-0", guestVmid: "101", failedSyncs: 1 }],
      routeFor: routeFor,
    });
    const byName: Map<string, ResourceAttentionItem> = new Map(
      items.map(
        (item: ResourceAttentionItem): [string, ResourceAttentionItem] => {
          return [item.name, item];
        },
      ),
    );

    expect(byName.get("pve3")?.route?.toString()).toBe(
      `/node/${encodeURIComponent("node/pve3")}`,
    );
    expect(byName.get("pve3")?.detail).toBe("node/pve3");
    expect(byName.get("101-0 (web-10)")?.route?.toString()).toBe(
      `/guest/${encodeURIComponent("qemu/101")}`,
    );
  });

  test("a replication job for a guest the inventory does not know names the job alone, with no link", () => {
    const items: Array<ResourceAttentionItem> = getProxmoxAttentionItems({
      rows: [],
      replicationJobs: [{ jobId: "999-0", guestVmid: "999", failedSyncs: 1 }],
      routeFor: routeFor,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("999-0");
    expect(items[0]!.route).toBeUndefined();
  });

  test("failed syncs are counted in the reader's plural forms", () => {
    const [one, many]: Array<ResourceAttentionItem> = [1, 3].map(
      (count: number): ResourceAttentionItem => {
        return getProxmoxAttentionItems({
          rows: [],
          replicationJobs: [
            { jobId: "100-0", guestVmid: "100", failedSyncs: count },
          ],
          routeFor: routeFor,
        })[0]!;
      },
    );
    expect(one!.reasons).toEqual([
      {
        text: "{{count}} failed syncs",
        plural: { one: "{{count}} failed sync", count: 1 },
      },
    ]);
    expect(many!.reasons[0]!.plural?.count).toBe(3);
  });

  test("a cluster Proxmox reports not quorate leads the list; quorate or unknown says nothing", () => {
    const notQuorate: Array<ResourceAttentionItem> = getProxmoxAttentionItems({
      rows: [node("pve1", { isUp: false })],
      isQuorate: false,
      clusterName: "pve-prod",
      routeFor: routeFor,
    });
    expect(notQuorate[0]).toEqual(
      expect.objectContaining({
        key: "cluster",
        kind: "Cluster",
        name: "pve-prod",
        severity: ResourceAttentionSeverity.Critical,
      }),
    );
    expect(notQuorate[0]!.route).toBeUndefined();

    for (const isQuorate of [true, null, undefined]) {
      expect(
        getProxmoxAttentionItems({
          rows: [],
          isQuorate: isQuorate,
          routeFor: routeFor,
        }),
      ).toEqual([]);
    }
  });

  test("the cluster's health is the worst of what is on the list", () => {
    expect(
      getProxmoxClusterHealth(
        getProxmoxAttentionItems({ rows: [node("pve1")], routeFor }),
      ),
    ).toBe("Healthy");
    expect(
      getProxmoxClusterHealth(
        getProxmoxAttentionItems({
          rows: [storage("pve1/local", 90, 100)],
          routeFor,
        }),
      ),
    ).toBe("Degraded");
    expect(
      getProxmoxClusterHealth(getProxmoxAttentionItems({ rows, routeFor })),
    ).toBe("Unhealthy");
  });

  test("rows of other kinds are left alone", () => {
    expect(
      getProxmoxAttentionItems({
        rows: [row({ kind: "Pool", externalId: "pool/a", isUp: false })],
        routeFor,
      }),
    ).toEqual([]);
  });
});

describe("a part's name", () => {
  test("is its info series' name, else its id's tail", () => {
    expect(getProxmoxDisplayName(node("pve1"))).toBe("pve1");
    expect(
      getProxmoxDisplayName(row({ kind: "Guest", externalId: "lxc/105" })),
    ).toBe("105");
    expect(
      getProxmoxDisplayName(row({ kind: "Guest", externalId: "odd" })),
    ).toBe("odd");
  });
});

describe("which part an open incident or alert is about", () => {
  function target(
    labels: Record<string, unknown> | null,
  ): ProxmoxIssueTarget | null {
    return getProxmoxIssueTarget({ seriesLabels: labels as never });
  }

  test("pve-exporter's id label names the part", () => {
    expect(target({ id: "node/pve2" })).toEqual({
      kind: "Node",
      externalId: "node/pve2",
      vmid: null,
      nodeName: "pve2",
    });
    expect(target({ id: "qemu/100" })).toEqual({
      kind: "Guest",
      externalId: "qemu/100",
      vmid: "100",
      nodeName: null,
    });
    expect(target({ "resource.id": "lxc/101" })?.externalId).toBe("lxc/101");
    expect(target({ id: "storage/pve1/local" })).toEqual({
      kind: "Storage",
      externalId: "storage/pve1/local",
      vmid: null,
      nodeName: "pve1",
    });
    expect(target({ id: "storage/local" })?.nodeName).toBeNull();
  });

  test("a vmid or a node label stands in when there is no id", () => {
    expect(target({ vmid: 104 })).toEqual({
      kind: "Guest",
      externalId: null,
      vmid: "104",
      nodeName: null,
    });
    expect(target({ "resource.proxmox.node.name": "pve3" })?.externalId).toBe(
      "node/pve3",
    );
    expect(target({ node: "pve4" })?.nodeName).toBe("pve4");
  });

  test("a replication job's id, or no labels at all, names no part", () => {
    expect(target({ id: "100-0" })).toBeNull();
    expect(target({})).toBeNull();
    expect(target(null)).toBeNull();
  });

  test("a record is about a guest by its id, or by its VMID when its type is unknown", () => {
    const web: ProxmoxResource = guest(100, "web");
    expect(isProxmoxIssueAbout({ seriesLabels: { id: "qemu/100" } }, web)).toBe(
      true,
    );
    expect(isProxmoxIssueAbout({ seriesLabels: { id: "lxc/100" } }, web)).toBe(
      false,
    );
    expect(isProxmoxIssueAbout({ seriesLabels: { vmid: "100" } }, web)).toBe(
      true,
    );
    expect(isProxmoxIssueAbout({ seriesLabels: { vmid: "101" } }, web)).toBe(
      false,
    );
  });

  test("a record is about a node by its name, in any case; never about a guest on it", () => {
    const pve2: ProxmoxResource = node("pve2");
    expect(
      isProxmoxIssueAbout(
        { seriesLabels: { "resource.proxmox.node.name": "PVE2" } },
        pve2,
      ),
    ).toBe(true);
    expect(
      isProxmoxIssueAbout({ seriesLabels: { id: "qemu/100" } }, pve2),
    ).toBe(false);
  });

  test("a record is about a storage by its whole id", () => {
    const local: ProxmoxResource = storage("pve1/local", 1, 2);
    expect(
      isProxmoxIssueAbout(
        { seriesLabels: { id: "storage/pve1/local" } },
        local,
      ),
    ).toBe(true);
    expect(
      isProxmoxIssueAbout(
        { seriesLabels: { id: "storage/pve2/local" } },
        local,
      ),
    ).toBe(false);
  });
});
