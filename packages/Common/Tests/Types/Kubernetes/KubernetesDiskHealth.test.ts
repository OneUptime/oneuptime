import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAttentionFinding,
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  assessKubernetesNode,
  assessKubernetesResource,
  assessKubernetesVolumeClaim,
  getKubernetesAttentionFindings,
  getKubernetesClusterHealth,
  getKubernetesHealthSeverity,
} from "../../../Types/Kubernetes/KubernetesHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * A nearly full claim and a node nearly out of disk under the cluster's
 * Needs attention (#9643, #9645). The disk comes from the metrics, the rest
 * of a row from the snapshot: the rules read both, so the claims list's
 * amber bar, the claim's status, the stored verdict and Needs attention say
 * the same thing, at the same lines.
 */

const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
// When the agent saw the rows: every rule measures against it.
const SEEN: Date = new Date("2026-11-19T12:00:00.000Z");

function ago(minutes: number): Date {
  return new Date(SEEN.getTime() - minutes * MINUTE);
}

function textsOf(assessment: {
  reasons: Array<KubernetesHealthText>;
}): Array<string> {
  return assessment.reasons.map((reason: KubernetesHealthText): string => {
    return reason.text;
  });
}

// A claim of `capacityGiB`, `usedPercent` used, by a reading `measuredMinutesAgo` old.
function claim(fields: {
  name?: string;
  namespace?: string;
  phase?: string;
  usedPercent?: number | null;
  capacityGiB?: number;
  measuredMinutesAgo?: number;
  inodes?: number;
  inodesFree?: number;
  ownerReferences?: JSONObject;
}): KubernetesHealthRow {
  const capacity: number = (fields.capacityGiB ?? 100) * GIB;
  const used: number | null =
    fields.usedPercent === undefined ? 50 : fields.usedPercent;
  return {
    kind: "PersistentVolumeClaim",
    namespaceKey: fields.namespace ?? "db",
    name: fields.name ?? "data-postgres-0",
    phase: fields.phase ?? "Bound",
    ownerReferences: fields.ownerReferences ?? null,
    spec: { volumeMode: "Filesystem" } as unknown as JSONObject,
    status: { phase: fields.phase ?? "Bound" } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24),
    latestVolumeCapacityBytes: used === null ? null : capacity,
    latestVolumeAvailableBytes:
      used === null ? null : Math.round(capacity * (1 - used / 100)),
    latestVolumeInodes: fields.inodes ?? null,
    latestVolumeInodesFree: fields.inodesFree ?? null,
    latestVolumeMeasuredAt: ago(fields.measuredMinutesAgo ?? 1),
  };
}

function node(fields: {
  name?: string;
  isReady?: boolean;
  diskPressure?: boolean;
  unschedulable?: boolean;
  usedPercent?: number | null;
  imageUsedPercent?: number;
  measuredMinutesAgo?: number;
}): KubernetesHealthRow {
  const used: number | null =
    fields.usedPercent === undefined ? 40 : fields.usedPercent;
  const row: KubernetesHealthRow = {
    kind: "Node",
    namespaceKey: "",
    name: fields.name ?? "node-1",
    isReady: fields.isReady ?? true,
    hasMemoryPressure: false,
    hasDiskPressure: fields.diskPressure ?? false,
    hasPidPressure: false,
    spec: {
      unschedulable: fields.unschedulable ?? false,
    } as unknown as JSONObject,
    status: {
      conditions: [
        {
          type: "Ready",
          status: fields.isReady === false ? "False" : "True",
          message: fields.isReady === false ? "kubelet stopped posting" : "",
          lastTransitionTime: ago(30).toISOString(),
        },
        ...(fields.diskPressure
          ? [
              {
                type: "DiskPressure",
                status: "True",
                message: "kubelet has disk pressure",
                lastTransitionTime: ago(20).toISOString(),
              },
            ]
          : []),
      ],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 30),
    latestVolumeCapacityBytes: used === null ? null : 100 * GIB,
    latestVolumeAvailableBytes:
      used === null ? null : Math.round(100 * GIB * (1 - used / 100)),
    latestVolumeMeasuredAt: ago(fields.measuredMinutesAgo ?? 1),
  };
  if (fields.imageUsedPercent !== undefined) {
    row.latestImageFsCapacityBytes = 400 * GIB;
    row.latestImageFsAvailableBytes = Math.round(
      400 * GIB * (1 - fields.imageUsedPercent / 100),
    );
  }
  return row;
}

describe("a claim's status says its disk", () => {
  test("a bound claim with room is Bound, as before", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim({ usedPercent: 60 }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status.text).toBe("Bound");
    expect(assessment.tone).toBe("positive");
  });

  test("80% used: Nearly full, a warning, with how much is used and free", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim({ usedPercent: 85 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(assessment.status.text).toBe("Nearly full");
    expect(assessment.tone).toBe("warning");
    expect(assessment.reasons).toEqual([
      {
        text: "{{percent}} used, {{free}} free",
        values: { percent: "85%", free: "15\u00A0GiB" },
      },
    ]);
  });

  test("90% used: Almost out of space, critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim({ usedPercent: 97, capacityGiB: 10 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.status.text).toBe("Almost out of space");
    expect(assessment.tone).toBe("danger");
  });

  test("a reading older than fifteen minutes says nothing: no pod mounts it now", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim({ usedPercent: 99, measuredMinutesAgo: 16 }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status.text).toBe("Bound");
  });

  test("a reading taken after the snapshot is fresh: the metrics run ahead of it", () => {
    expect(
      assessKubernetesVolumeClaim(
        claim({ usedPercent: 91, measuredMinutesAgo: -4 }),
      ).severity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });

  test("a lost claim stays Lost, a pending one Pending: only a bound one is measured", () => {
    expect(
      assessKubernetesVolumeClaim(claim({ phase: "Lost", usedPercent: 95 }))
        .status.text,
    ).toBe("Lost");
    expect(
      textsOf(
        assessKubernetesVolumeClaim(claim({ phase: "Lost", usedPercent: 95 })),
      ),
    ).toEqual(["Lost its volume"]);
    expect(
      assessKubernetesVolumeClaim(claim({ phase: "Pending", usedPercent: 95 }))
        .status.text,
    ).toBe("Pending");
  });

  test("a row read without its disk columns gets the snapshot's verdict alone", () => {
    const row: KubernetesHealthRow = claim({ usedPercent: 95 });
    delete row.latestVolumeCapacityBytes;
    delete row.latestVolumeAvailableBytes;
    expect(assessKubernetesVolumeClaim(row).status.text).toBe("Bound");
  });

  test("the stored verdict is the same one (getKubernetesHealthSeverity)", () => {
    expect(getKubernetesHealthSeverity(claim({ usedPercent: 82 }))).toBe(
      KubernetesHealthSeverity.Warning,
    );
    expect(getKubernetesHealthSeverity(claim({ usedPercent: 92 }))).toBe(
      KubernetesHealthSeverity.Critical,
    );
    expect(getKubernetesHealthSeverity(claim({ usedPercent: 50 }))).toBeNull();
  });
});

describe("a node's status says its disk", () => {
  test("a Ready node with room is Ready", () => {
    expect(assessKubernetesNode(node({ usedPercent: 50 })).status.text).toBe(
      "Ready",
    );
  });

  test("a Ready node almost out of disk reads Disk almost full, critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ usedPercent: 93 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.status.text).toBe("Disk almost full");
    expect(assessment.tone).toBe("danger");
    expect(assessment.reasons).toEqual([
      {
        text: "Disk {{percent}} used, {{free}} free",
        values: { percent: "93%", free: "7\u00A0GiB" },
      },
    ]);
  });

  test("a node not ready still reads Not ready, its full disk among why", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ isReady: false, usedPercent: 93 }),
    );
    expect(assessment.status.text).toBe("Not ready");
    expect(textsOf(assessment)).toEqual([
      "Not ready",
      "Disk {{percent}} used, {{free}} free",
    ]);
    expect(assessment.message).toBe("kubelet stopped posting");
  });

  test("disk pressure and a nearly full disk: Disk pressure, with how full it is", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ diskPressure: true, usedPercent: 86 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(assessment.status.text).toBe("Disk pressure");
    expect(textsOf(assessment)).toEqual([
      "Disk pressure",
      "Disk {{percent}} used, {{free}} free",
    ]);
  });

  test("disk pressure and an almost full disk: the disk leads, and pressure is still said", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ diskPressure: true, usedPercent: 95 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.status.text).toBe("Disk almost full");
    expect(textsOf(assessment)).toEqual([
      "Disk {{percent}} used, {{free}} free",
      "Disk pressure",
    ]);
    // Kubernetes' own message stays the condition's.
    expect(assessment.message).toBe("kubelet has disk pressure");
  });

  test("a cordoned node nearly out of disk needs a look all the same", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ unschedulable: true, usedPercent: 84 }),
    );
    expect(assessment.status.text).toBe("Disk nearly full");
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
  });

  test("its image disk of its own counts too", () => {
    expect(
      textsOf(
        assessKubernetesNode(node({ usedPercent: 30, imageUsedPercent: 88 })),
      ),
    ).toEqual(["Image disk {{percent}} used, {{free}} free"]);
  });

  test("a stale reading, or none, leaves the node as its conditions say", () => {
    expect(
      assessKubernetesNode(node({ usedPercent: 95, measuredMinutesAgo: 20 }))
        .status.text,
    ).toBe("Ready");
    expect(assessKubernetesNode(node({ usedPercent: null })).status.text).toBe(
      "Ready",
    );
  });

  test("the dispatcher hands the node its clock: the snapshot's time", () => {
    expect(assessKubernetesResource(node({ usedPercent: 92 })).severity).toBe(
      KubernetesHealthSeverity.Critical,
    );
    expect(
      assessKubernetesResource(node({ usedPercent: 92 }), {
        now: new Date(0),
      }).severity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });
});

describe("the cluster's Needs attention lists a full claim and a full node", () => {
  test("each is a finding of its own, with why, the most urgent first", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        claim({ name: "data-kafka-0", namespace: "queue", usedPercent: 82 }),
        claim({ name: "data-postgres-0", usedPercent: 96 }),
        claim({ name: "cache", usedPercent: 10 }),
        node({ name: "node-2", usedPercent: 91 }),
      ]);

    expect(
      findings.map((finding: KubernetesAttentionFinding): string => {
        return `${finding.severity} ${finding.key}`;
      }),
    ).toEqual([
      "critical Node:node-2",
      "critical PersistentVolumeClaim:db/data-postgres-0",
      "warning PersistentVolumeClaim:queue/data-kafka-0",
    ]);

    const postgres: KubernetesAttentionFinding = findings[1]!;
    expect(postgres.reasons).toEqual([
      {
        text: "{{percent}} used, {{free}} free",
        values: { percent: "96%", free: "4\u00A0GiB" },
      },
    ]);
  });

  test("a claim nearly full makes the cluster Degraded, almost full Unhealthy", () => {
    expect(
      getKubernetesClusterHealth(
        getKubernetesAttentionFindings([claim({ usedPercent: 85 })]),
      ),
    ).toBe("Degraded");
    expect(
      getKubernetesClusterHealth(
        getKubernetesAttentionFindings([claim({ usedPercent: 95 })]),
      ),
    ).toBe("Unhealthy");
  });

  test("a generic ephemeral volume's claim is listed as any other claim", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        claim({
          name: "web-0-scratch",
          usedPercent: 92,
          ownerReferences: {
            items: [{ kind: "Pod", name: "web-0", uid: "pod-uid" }],
          } as unknown as JSONObject,
        }),
      ]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return finding.key;
      }),
    ).toEqual(["PersistentVolumeClaim:db/web-0-scratch"]);
  });
});
