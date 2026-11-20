import { describe, expect, test } from "@jest/globals";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import Route from "../../../Types/API/Route";
import { Translator, createTranslator } from "../../../Types/Translator";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import {
  PROXMOX_ATTENTION_KIND_ORDER,
  PROXMOX_POWER_TASK_STALE_MS,
  PROXMOX_STORAGE_FULL_PERCENT,
  PROXMOX_STORAGE_NEAR_FULL_PERCENT,
  ProxmoxAssessment,
  ProxmoxIssueTarget,
  ProxmoxPartKind,
  ProxmoxProblem,
  assessProxmoxGuest,
  assessProxmoxNode,
  assessProxmoxResource,
  assessProxmoxStorage,
  getProxmoxAttentionItems,
  getProxmoxClusterHealth,
  getProxmoxDisplayName,
  getProxmoxGuestStopFacts,
  getProxmoxIssueTarget,
  getProxmoxProblemItems,
  getProxmoxStoragePercent,
  isProxmoxIssueAbout,
  isProxmoxProblemRow,
  isProxmoxTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxHealth";
import { summarizeProxmoxBackups } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { getResourceAttentionSinceText } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionRow";

/*
 * What on a Proxmox VE cluster needs someone, and how bad it is: the one
 * set of rules the cluster's health pill, its Needs attention card, a part's
 * own page and the Topology read (Pages/Proxmox/Utils/ProxmoxHealth).
 */

const GIB: number = 1024 * 1024 * 1024;

/*
 * A row's fields as a test writes them: any of them may be undefined, as a
 * column whose series never arrived reads.
 */
type RowFields = {
  [Key in keyof ProxmoxResource]?: ProxmoxResource[Key] | undefined;
};

function row(fields: RowFields): ProxmoxResource {
  return Object.assign(new ProxmoxResource(), fields);
}

function node(name: string, fields: RowFields = {}): ProxmoxResource {
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
  fields: RowFields = {},
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
  fields: RowFields = {},
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
    /*
     * A node's id would only repeat its name ("node/pve3" under "pve3"); a
     * guest's says its VMID and a storage's its node.
     */
    expect(byName.get("pve3")?.detail).toBeUndefined();
    expect(byName.get("101-0 (web-10)")?.detail).toBe("qemu/101");
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

/*
 * The Overview's counts of what is wrong - "1 node offline", "1 HA error",
 * "Last backup failed 2", "In no backup job 3" - each said how many, never
 * which or why (#9594). Each opens exactly the parts it counts.
 */
describe("what the Overview's counts open", () => {
  const NOW: Date = new Date("2026-11-02T12:00:00.000Z");
  const STALE_MS: number = 15 * 60 * 1000;

  function minutesBefore(minutes: number): Date {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  }

  test("the nodes offline: Offline first, then HA's word, and when one stopped being reported", () => {
    const rows: Array<ProxmoxResource> = [
      node("pve1", { lastSeenAt: minutesBefore(1) }),
      node("pve2", { isUp: false, lastSeenAt: minutesBefore(1) }),
      node("pve3", {
        isUp: false,
        haState: "fence",
        lastSeenAt: minutesBefore(180),
      }),
      guest(101, "web", { parentNodeName: "pve2" }),
    ];

    const items: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "nodesOffline" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["Node:node/pve2", "Node:node/pve3"]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[0]!.reasons).toEqual([{ text: "Offline" }]);
    expect(items[0]!.route?.toString()).toBe("/node/node%2Fpve2");
    // Its siblings still report it as down, just now: no "last reported".
    expect(items[0]!.lastReportAt).toBeUndefined();

    expect(items[1]!.reasons).toEqual([
      { text: "Offline" },
      { text: "HA state: {{state}}", values: { state: "fence" } },
    ]);
    // Nobody has reported it for three hours: the dialog says when.
    expect(items[1]!.lastReportAt).toEqual(minutesBefore(180));
    // A node names no line under its name: it would repeat it.
    expect(items[1]!.detail).toBeUndefined();
  });

  test("an HA state: every part in it, its HA word first, each guest a step from its node", () => {
    const rows: Array<ProxmoxResource> = [
      node("pve1"),
      guest(101, "web", { haState: "error", parentNodeName: "pve1" }),
      guest(102, "db", {
        haState: "error",
        parentNodeName: "pve1",
        isBackedUp: false,
      }),
      guest(103, "cache", { haState: "started", parentNodeName: "pve1" }),
    ];

    const items: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "haState", state: "error" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });

    // By name, as people number them.
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["db", "web"]);
    // The count's reason first, then the rest the rules say, once each.
    expect(items[0]!.reasons).toEqual([
      { text: "HA state: {{state}}", values: { state: "error" } },
      { text: "In no backup job" },
    ]);
    expect(items[0]!.detail).toBe("qemu/102");
    expect(items[0]!.facts).toEqual([
      {
        key: "node",
        label: "Node",
        value: "pve1",
        route: new Route("/node/node%2Fpve1"),
      },
    ]);
  });

  test("the guests whose last backup failed: Last backup failed first, and when", () => {
    const failedAt: Date = minutesBefore(120);
    const rows: Array<ProxmoxResource> = [
      guest(101, "web", {
        lastBackupStatus: "failed",
        lastBackupAt: failedAt,
        isBackedUp: true,
        parentNodeName: "pve9",
      }),
      guest(102, "db", { lastBackupStatus: "ok", isBackedUp: true }),
      // A template is backed up like a guest, but never counted.
      guest(9000, "template", {
        isTemplate: true,
        lastBackupStatus: "failed",
      }),
    ];

    const items: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "backupFailed" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[0]!.reasons).toEqual([{ text: "Last backup failed" }]);
    expect(items[0]!.since).toEqual({
      at: failedAt,
      template: "Failed {{time}}",
    });
    // A node the inventory does not hold is named, a step from nowhere.
    expect(items[0]!.facts).toEqual([
      { key: "node", label: "Node", value: "pve9", route: undefined },
    ]);
  });

  test("the guests in no backup job, and each count lists what the card counts", () => {
    const rows: Array<ProxmoxResource> = [
      guest(101, "web", { isBackedUp: false }),
      guest(102, "db", { isBackedUp: false, lastBackupStatus: "failed" }),
      guest(103, "cache", { isBackedUp: true, lastBackupStatus: "failed" }),
      // Not reported yet: in neither count.
      guest(104, "queue", {}),
      guest(9000, "template", { isTemplate: true, isBackedUp: false }),
    ];

    const notInJob: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "noBackupJob" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });
    const failed: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "backupFailed" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });

    expect(
      notInJob.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["db", "web"]);
    expect(notInJob[0]!.reasons).toEqual([
      { text: "In no backup job" },
      { text: "Last backup failed" },
    ]);

    // The Backups card's figures and the lists they open agree.
    const summary: ReturnType<typeof summarizeProxmoxBackups> =
      summarizeProxmoxBackups(rows);
    expect(notInJob).toHaveLength(summary.notInJob);
    expect(failed).toHaveLength(summary.failed);
  });

  /*
   * "8/10 guests running" said nothing of the guest stopped although it
   * starts on boot (#9729): it opens the guests that should be running,
   * each with why, its node and what holds it.
   */
  test("the guests that should be running: stopped though they start on boot, or given up on by HA", () => {
    const rows: Array<ProxmoxResource> = [
      node("pve1"),
      node("pve2", { isUp: false }),
      // Stopped on purpose: off, and left off.
      guest(101, "scratch", { isUp: false, onboot: false }),
      guest(102, "web", {
        isUp: false,
        onboot: true,
        parentNodeName: "pve1",
        isBackedUp: false,
      }),
      // Its node went down, and it with it.
      guest(103, "db", { isUp: false, onboot: true, parentNodeName: "pve2" }),
      // HA gave up on it.
      guest(104, "api", {
        isUp: false,
        onboot: false,
        haState: "error",
        parentNodeName: "pve1",
      }),
      // A stop-mode backup holds it.
      guest(105, "mail", {
        isUp: false,
        onboot: true,
        lockState: "backup",
        parentNodeName: "pve1",
      }),
      // Running, whatever HA says: not one the running count leaves out.
      guest(106, "cache", { isUp: true, haState: "error" }),
      // Its state is not reported yet: not called stopped.
      guest(107, "queue", { isUp: undefined, onboot: true }),
      // A template never runs.
      guest(9000, "template", { isTemplate: true, isUp: false, onboot: true }),
    ];

    const items: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: rows,
      problem: { kind: "guestsStopped" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });

    // HA's give-up is critical, first; then by name, as people number them.
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["api", "db", "mail", "web"]);

    const api: ResourceAttentionItem = items[0]!;
    expect(api.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(api.reasons).toEqual([
      { text: "HA state: {{state}}", values: { state: "error" } },
    ]);

    // The node it is on went offline: said right after why it is listed.
    const db: ResourceAttentionItem = items[1]!;
    expect(db.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(db.reasons).toEqual([
      { text: "Stopped, but starts on boot" },
      { text: "Its node is offline" },
    ]);
    expect(db.facts).toEqual([
      {
        key: "node",
        label: "Node",
        value: "pve2",
        route: new Route("/node/node%2Fpve2"),
      },
    ]);

    // What holds it, in the words its page uses for the lock.
    expect(items[2]!.reasons).toEqual([
      { text: "Stopped, but starts on boot" },
      { text: "Backup running" },
    ]);

    // The rest of what the rules say follows, once each.
    expect(items[3]!.reasons).toEqual([
      { text: "Stopped, but starts on boot" },
      { text: "In no backup job" },
    ]);
    expect(items[3]!.detail).toBe("qemu/102");
    expect(items[3]!.route?.toString()).toBe("/guest/qemu%2F102");
  });

  test("a lock Proxmox has no word for reads as Proxmox writes it", () => {
    const items: Array<ResourceAttentionItem> = getProxmoxProblemItems({
      rows: [
        guest(101, "web", {
          isUp: false,
          onboot: true,
          lockState: "mounted",
        }),
      ],
      problem: { kind: "guestsStopped" },
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
    });
    expect(items[0]!.reasons).toEqual([
      { text: "Stopped, but starts on boot" },
      { text: "Locked: {{lock}}", values: { lock: "mounted" } },
    ]);
  });

  test("every guest that should run does: nothing to open", () => {
    expect(
      getProxmoxProblemItems({
        rows: [
          guest(101, "web"),
          guest(102, "scratch", { isUp: false, onboot: false }),
        ],
        problem: { kind: "guestsStopped" },
        routeFor: routeFor,
        now: NOW,
        staleMs: STALE_MS,
      }),
    ).toEqual([]);
  });

  test("a row is counted by the very test the Overview counts it by", () => {
    expect(
      isProxmoxProblemRow(guest(1, "web", { isUp: false, onboot: true }), {
        kind: "guestsStopped",
      }),
    ).toBe(true);
    expect(
      isProxmoxProblemRow(guest(1, "web", { isUp: true, onboot: true }), {
        kind: "guestsStopped",
      }),
    ).toBe(false);
    expect(
      isProxmoxProblemRow(guest(1, "web", { isUp: false, haState: "fence" }), {
        kind: "guestsStopped",
      }),
    ).toBe(true);
    expect(
      isProxmoxProblemRow(node("pve1", { isUp: false }), {
        kind: "guestsStopped",
      }),
    ).toBe(false);
    expect(
      isProxmoxProblemRow(node("pve1", { isUp: false }), {
        kind: "nodesOffline",
      }),
    ).toBe(true);
    expect(
      isProxmoxProblemRow(node("pve1", { isUp: undefined }), {
        kind: "nodesOffline",
      }),
    ).toBe(false);
    expect(
      isProxmoxProblemRow(guest(1, "web", { haState: "fence" }), {
        kind: "haState",
        state: "error",
      }),
    ).toBe(false);
    expect(
      isProxmoxProblemRow(guest(1, "web", { isBackedUp: false }), {
        kind: "backupFailed",
      }),
    ).toBe(false);
  });
});

/*
 * #10017: who or what stopped a guest that should be running, and when -
 * from its last power task in the cluster's task log, as the Proxmox AI
 * agent reads it (agents/ResourceAIAgent, ProxmoxGuestTasks) and the ingest
 * keeps it on the guest's row. Each row below holds what the ingest stores
 * for a real task-log entry: GET /nodes/pve1/tasks?vmid=101 answering
 * {"upid": "UPID:pve1:0001A2B3:0C4D5E6F:6733F0A1:qmstop:101:alice@pve:",
 *  "type": "qmstop", "user": "alice@pve", "status": "OK", "endtime": ...}.
 */
describe("who or what stopped a guest that should be running", () => {
  const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
  const STALE_MS: number = 15 * 60 * 1000;
  const ENGLISH: Translator = createTranslator(undefined, "en");

  function minutesBefore(minutes: number): Date {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  }

  // A guest that starts on boot and is stopped, with what the agent read.
  function stoppedGuest(
    vmid: number,
    name: string,
    task: {
      type: string;
      user: string;
      status: string;
      endedMinutesAgo: number;
      readMinutesAgo?: number;
    } | null,
    fields: RowFields = {},
  ): ProxmoxResource {
    return guest(vmid, name, {
      isUp: false,
      onboot: true,
      parentNodeName: "pve1",
      ...(task
        ? {
            lastPowerTaskType: task.type,
            lastPowerTaskUser: task.user,
            lastPowerTaskStatus: task.status,
            lastPowerTaskAt: minutesBefore(task.endedMinutesAgo),
            powerTaskReadAt: minutesBefore(task.readMinutesAgo ?? 2),
          }
        : {}),
      ...fields,
    });
  }

  // The dialog's rows, worded in English unless a test says otherwise.
  function itemsOf(
    rows: Array<ProxmoxResource>,
    problem: ProxmoxProblem = { kind: "guestsStopped" },
    options: { translator: Translator | undefined } = { translator: ENGLISH },
  ): Array<ResourceAttentionItem> {
    return getProxmoxProblemItems({
      rows: rows,
      problem: problem,
      routeFor: routeFor,
      now: NOW,
      staleMs: STALE_MS,
      translator: options.translator,
    });
  }

  // The row's since line, as the dialog draws it.
  function sinceText(item: ResourceAttentionItem): string {
    return getResourceAttentionSinceText(ENGLISH, item.since!, NOW);
  }

  test("stopped by someone: who, and when, as the dialog says it", () => {
    const [item] = itemsOf([
      stoppedGuest(101, "web-1", {
        type: "qmstop",
        user: "alice@pve",
        status: "OK",
        endedMinutesAgo: 120,
      }),
    ]);

    expect(item!.since).toEqual({
      at: minutesBefore(120),
      template: "Stopped by {{user}} {{time}}",
      values: { user: "alice@pve" },
    });
    // The number held to its unit, as every English line holds it.
    expect(sinceText(item!)).toBe(
      `Stopped by alice@pve 2${NO_BREAK_SPACE}hours ago`,
    );
    // Nothing more to explain, and still why it is listed and where it is.
    expect(item!.explanation).toBeUndefined();
    expect(item!.message).toBeUndefined();
    expect(item!.reasons[0]).toEqual({ text: "Stopped, but starts on boot" });
    expect(item!.facts?.[0]?.value).toBe("pve1");
  });

  test.each<[string, string, string, string]>([
    ["qmshutdown", "carol@pam", "Shut down by {{user}} {{time}}", "qemu"],
    ["vzstop", "dave@pve", "Stopped by {{user}} {{time}}", "lxc"],
    ["vzshutdown", "root@pam", "Shut down by {{user}} {{time}}", "lxc"],
    // HA's stop on someone's request names who asked.
    ["hastop", "bob@pve", "Stopped through HA by {{user}} {{time}}", "qemu"],
    [
      "hashutdown",
      "bob@pve",
      "Stopped through HA by {{user}} {{time}}",
      "qemu",
    ],
    ["qmsuspend", "erin@pve", "Hibernated by {{user}} {{time}}", "qemu"],
    [
      "qmrestore",
      "backup@pbs!restore",
      "Restored from a backup by {{user}} {{time}}",
      "qemu",
    ],
    [
      "vzrestore",
      "root@pam",
      "Restored from a backup by {{user}} {{time}}",
      "lxc",
    ],
  ])(
    "%s by %s: %s",
    (type: string, user: string, template: string, guestType: string) => {
      const [item] = itemsOf([
        stoppedGuest(
          101,
          "web-1",
          { type, user, status: "OK", endedMinutesAgo: 30 },
          { externalId: `${guestType}/101`, guestType: guestType },
        ),
      ]);
      expect(item!.since).toEqual({
        at: minutesBefore(30),
        template: template,
        values: { user: user },
      });
    },
  );

  test("a start that failed: when, and Proxmox's own reason as the row's message", () => {
    const [item] = itemsOf([
      stoppedGuest(103, "api-1", {
        type: "qmstart",
        user: "root@pam",
        status: "start failed: QEMU exited with code 1",
        endedMinutesAgo: 10,
      }),
    ]);

    expect(item!.since).toEqual({
      at: minutesBefore(10),
      template: "Last start failed {{time}}",
    });
    expect(sinceText(item!)).toBe(
      `Last start failed 10${NO_BREAK_SPACE}minutes ago`,
    );
    expect(item!.message).toBe("start failed: QEMU exited with code 1");
  });

  test("a last start that went well, and no task since: shut down from inside, or crashed", () => {
    const [item] = itemsOf([
      stoppedGuest(104, "cache-1", {
        type: "qmstart",
        user: "root@pam",
        status: "OK",
        endedMinutesAgo: 2 * 24 * 60,
      }),
    ]);

    expect(item!.explanation).toBe(
      "No Proxmox task stopped it since it last started: it was shut down from inside, or it crashed.",
    );
    expect(item!.since).toEqual({
      at: minutesBefore(2 * 24 * 60),
      template: "Last started {{time}}",
    });
    expect(sinceText(item!)).toBe(`Last started 2${NO_BREAK_SPACE}days ago`);
  });

  test("a start that finished with warnings went well too", () => {
    const [item] = itemsOf([
      stoppedGuest(104, "cache-1", {
        type: "vzstart",
        user: "root@pam",
        status: "WARNINGS: 1",
        endedMinutesAgo: 60,
      }),
    ]);
    expect(item!.since?.template).toBe("Last started {{time}}");
    expect(item!.message).toBeUndefined();
  });

  test("HA in error: what it means and what to do, with the start it failed", () => {
    const [item] = itemsOf([
      stoppedGuest(
        103,
        "api-1",
        {
          type: "qmstart",
          user: "root@pam",
          status: "start failed: QEMU exited with code 1",
          endedMinutesAgo: 12,
        },
        { onboot: false, haState: "error" },
      ),
    ]);

    expect(item!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(item!.reasons[0]).toEqual({
      text: "HA state: {{state}}",
      values: { state: "error" },
    });
    expect(item!.explanation).toBe(
      "HA could not start it and stopped trying. Set its HA state to disabled, fix what keeps it from starting, then set it to started.",
    );
    expect(item!.message).toBe("start failed: QEMU exited with code 1");
    expect(sinceText(item!)).toBe(
      `Last start failed 12${NO_BREAK_SPACE}minutes ago`,
    );
  });

  test("HA fencing its node: what HA waits for, whether or not the task log was read", () => {
    const [item] = itemsOf([
      stoppedGuest(105, "db-1", null, { onboot: false, haState: "fence" }),
    ]);
    expect(item!.explanation).toBe(
      "Its node is outside the quorate part of the cluster. Once that node is fenced, HA starts it on another node.",
    );
    expect(item!.since).toBeUndefined();
  });

  test("the HA resources in error a count opens say the same", () => {
    const [item] = itemsOf(
      [
        stoppedGuest(
          103,
          "api-1",
          {
            type: "qmstart",
            user: "root@pam",
            status: "start failed: QEMU exited with code 1",
            endedMinutesAgo: 12,
          },
          { onboot: false, haState: "error" },
        ),
      ],
      { kind: "haState", state: "error" },
    );
    expect(item!.explanation).toContain("HA could not start it");
    expect(item!.message).toBe("start failed: QEMU exited with code 1");
    expect(item!.since?.template).toBe("Last start failed {{time}}");
  });

  test("the explanation is in the reader's words; without a translator a list draws none, and keeps the rest", () => {
    const rows: Array<ProxmoxResource> = [
      stoppedGuest(104, "cache-1", {
        type: "qmstart",
        user: "root@pam",
        status: "OK",
        endedMinutesAgo: 60,
      }),
    ];
    const german: Translator = createTranslator((text: string) => {
      return text ===
        "No Proxmox task stopped it since it last started: it was shut down from inside, or it crashed."
        ? "Seit dem letzten Start hat keine Proxmox-Aufgabe ihn gestoppt: Er wurde von innen heruntergefahren oder ist abgestürzt."
        : undefined;
    }, "de");
    expect(
      itemsOf(rows, { kind: "guestsStopped" }, { translator: german })[0]!
        .explanation,
    ).toBe(
      "Seit dem letzten Start hat keine Proxmox-Aufgabe ihn gestoppt: Er wurde von innen heruntergefahren oder ist abgestürzt.",
    );

    const [untranslated] = itemsOf(
      rows,
      { kind: "guestsStopped" },
      { translator: undefined },
    );
    expect(untranslated!.explanation).toBeUndefined();
    expect(untranslated!.since?.template).toBe("Last started {{time}}");
  });

  test("a guest the agent has not read, or not for a day, says nothing of who stopped it", () => {
    const items: Array<ResourceAttentionItem> = itemsOf([
      stoppedGuest(101, "never-read", null),
      stoppedGuest(102, "read-long-ago", {
        type: "qmstop",
        user: "alice@pve",
        status: "OK",
        endedMinutesAgo: 3 * 24 * 60,
        readMinutesAgo: 24 * 60 + 1,
      }),
      stoppedGuest(103, "read-today", {
        type: "qmstop",
        user: "alice@pve",
        status: "OK",
        endedMinutesAgo: 3 * 24 * 60,
        readMinutesAgo: 24 * 60 - 1,
      }),
    ]);
    const byName: Record<string, ResourceAttentionItem> = {};
    for (const item of items) {
      byName[item.name] = item;
    }
    expect(byName["never-read"]!.since).toBeUndefined();
    expect(byName["read-long-ago"]!.since).toBeUndefined();
    expect(sinceText(byName["read-today"]!)).toBe(
      `Stopped by alice@pve 3${NO_BREAK_SPACE}days ago`,
    );
  });

  test("a task log with no start or stop of it, a task this does not word, or no user: nothing said", () => {
    const items: Array<ResourceAttentionItem> = itemsOf([
      // The agent read it and found no start or stop: the type is cleared.
      stoppedGuest(101, "a", null, { powerTaskReadAt: minutesBefore(2) }),
      stoppedGuest(102, "b", {
        type: "qmigrate",
        user: "alice@pve",
        status: "OK",
        endedMinutesAgo: 30,
      }),
      stoppedGuest(103, "c", {
        type: "qmstop",
        user: "",
        status: "OK",
        endedMinutesAgo: 30,
      }),
    ]);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.since).toBeUndefined();
      expect(item.explanation).toBeUndefined();
      expect(item.message).toBeUndefined();
    }
  });

  test("only the guests that should be running and the ones HA gave up on: a failed backup keeps its own since", () => {
    const failedBackup: ProxmoxResource = stoppedGuest(
      101,
      "web-1",
      {
        type: "qmstop",
        user: "alice@pve",
        status: "OK",
        endedMinutesAgo: 120,
      },
      { lastBackupStatus: "failed", lastBackupAt: minutesBefore(300) },
    );
    const [backupItem] = itemsOf([failedBackup], { kind: "backupFailed" });
    expect(backupItem!.since).toEqual({
      at: minutesBefore(300),
      template: "Failed {{time}}",
    });
  });

  test("a guest that runs says nothing of a stop, whatever its row still holds", () => {
    expect(
      getProxmoxGuestStopFacts(
        stoppedGuest(
          101,
          "web-1",
          {
            type: "qmstop",
            user: "alice@pve",
            status: "OK",
            endedMinutesAgo: 120,
          },
          { isUp: true },
        ),
        NOW,
      ),
    ).toBeNull();
    expect(getProxmoxGuestStopFacts(node("pve1", { isUp: false }), NOW)).toBe(
      null,
    );
  });

  test("the reading's dates as the API hands them - ISO strings - are read too", () => {
    const row: ProxmoxResource = stoppedGuest(101, "web-1", null, {
      lastPowerTaskType: "qmstop",
      lastPowerTaskUser: "alice@pve",
      lastPowerTaskStatus: "OK",
      lastPowerTaskAt: minutesBefore(120).toISOString() as unknown as Date,
      powerTaskReadAt: minutesBefore(1).toISOString() as unknown as Date,
    });
    expect(getProxmoxGuestStopFacts(row, NOW)?.since?.at).toEqual(
      minutesBefore(120),
    );
  });

  test("the window is a day, far longer than the agent takes to read every stopped guest", () => {
    expect(PROXMOX_POWER_TASK_STALE_MS).toBe(24 * 60 * 60 * 1000);
  });
});
