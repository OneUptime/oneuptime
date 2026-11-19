import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesStorageText,
  getKubernetesStorageMeasuredAt,
  getKubernetesVolumeFill,
  getKubernetesVolumeFillReason,
  getKubernetesVolumeInodeUsage,
  getKubernetesVolumeUsage,
} from "Common/Types/Kubernetes/KubernetesStorageHealth";
import { StorageUsage } from "Common/Utils/Storage/StorageUsage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW FULL A PERSISTENT VOLUME CLAIM IS (#9539).
 *
 * The kubernetes-agent reports the usage of every volume a running pod
 * mounts, named by its claim, and ingest keeps each claim's latest reading
 * on its KubernetesResource row: the filesystem's capacity, what is still
 * available to write, and its inodes. This reads that row into the shared
 * StorageUsage, which the claim's list, its page and its volume's pages
 * draw with StorageUsageBar.
 *
 * A claim with no reading says why, as far as OneUptime can tell: it is not
 * bound to a volume yet, it is a raw block device (no filesystem to
 * measure), or nothing has reported it - no running pod mounts it, its
 * storage driver does not report usage, or the agent predates it.
 */

export enum KubernetesVolumeUsageGap {
  NotBound = "not-bound",
  Block = "block",
  NotReported = "not-reported",
}

// The columns of a claim's row the reading is made of.
export interface KubernetesVolumeClaimUsageRow {
  latestVolumeCapacityBytes?: number | string | null | undefined;
  latestVolumeAvailableBytes?: number | string | null | undefined;
  latestVolumeInodes?: number | string | null | undefined;
  latestVolumeInodesFree?: number | string | null | undefined;
  // When the reading was taken; rows from before it was kept read metricsUpdatedAt.
  latestVolumeMeasuredAt?: Date | string | null | undefined;
  // Its used bytes a few hours before, and when: how fast it is filling.
  latestVolumeUsedBaselineBytes?: number | string | null | undefined;
  latestVolumeUsedBaselineAt?: Date | string | null | undefined;
  metricsUpdatedAt?: Date | string | null | undefined;
  // The claim's phase (status.phase) and volumeMode (spec.volumeMode).
  status?: JSONObject | null | undefined;
  spec?: JSONObject | null | undefined;
}

export interface KubernetesVolumeClaimUsage {
  // Bytes used, free and the filesystem's size; null when none was reported.
  space: StorageUsage | null;
  // Inodes used, free and the filesystem's total; null for none.
  inodes: StorageUsage | null;
  // When the agent last reported it.
  measuredAt: Date | null;
  // Why there is no usage to show; null when there is.
  gap: KubernetesVolumeUsageGap | null;
  /*
   * When it will be full at the rate it filled over the last few hours
   * ("Full in about 3 days"), as the cluster's Needs attention says it;
   * null when it is not filling, or would take more than a month.
   */
  fill: KubernetesStorageText | null;
}

/*
 * What a list's Used cell says in place of a bar, short enough for a cell:
 * never a blank.
 */
export const KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT: Record<
  KubernetesVolumeUsageGap,
  string
> = {
  [KubernetesVolumeUsageGap.NotBound]: translationKey("Not bound"),
  [KubernetesVolumeUsageGap.Block]: translationKey("Block device"),
  [KubernetesVolumeUsageGap.NotReported]: translationKey("Not reported"),
};

// What a claim's page says instead, in a sentence: why, and what to do.
export const KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION: Record<
  KubernetesVolumeUsageGap,
  string
> = {
  [KubernetesVolumeUsageGap.NotBound]: translationKey(
    "This claim is not bound to a volume yet, so there is nothing to measure. Its usage appears once it is bound and a running pod mounts it.",
  ),
  [KubernetesVolumeUsageGap.Block]: translationKey(
    "This claim is a raw block device. It has no filesystem, so Kubernetes reports no usage for it.",
  ),
  [KubernetesVolumeUsageGap.NotReported]: translationKey(
    "Kubernetes reports a claim's usage only while a running pod mounts it, and only when its storage driver supports it. If a pod mounts this claim, update the kubernetes-agent Helm chart, which reports volume usage by default.",
  ),
};

function readString(
  object: JSONObject | null | undefined,
  key: string,
): string {
  const value: unknown = object ? object[key] : undefined;

  return typeof value === "string" ? value : "";
}

export function getKubernetesVolumeClaimUsage(
  row: KubernetesVolumeClaimUsageRow,
): KubernetesVolumeClaimUsage {
  // The claim's own row, read by the cluster's rules (KubernetesStorageHealth).
  const claimRow: KubernetesVolumeClaimUsageRow & { kind: string } = {
    ...row,
    kind: "PersistentVolumeClaim",
  };
  const space: StorageUsage | null = getKubernetesVolumeUsage(claimRow);
  const inodes: StorageUsage | null = getKubernetesVolumeInodeUsage(claimRow);

  let gap: KubernetesVolumeUsageGap | null = null;

  if (!space) {
    const phase: string = readString(row.status, "phase");

    if (phase && phase !== "Bound") {
      gap = KubernetesVolumeUsageGap.NotBound;
    } else if (readString(row.spec, "volumeMode") === "Block") {
      gap = KubernetesVolumeUsageGap.Block;
    } else {
      gap = KubernetesVolumeUsageGap.NotReported;
    }
  }

  return {
    space: space,
    inodes: inodes,
    measuredAt:
      space || inodes ? getKubernetesStorageMeasuredAt(claimRow) : null,
    gap: gap,
    fill: space
      ? getKubernetesVolumeFillReason(getKubernetesVolumeFill(claimRow))
      : null,
  };
}

/*
 * A list's storageUsage for a claim (ResourceTable): its bar, or the words
 * that say why there is none.
 */
export function getKubernetesVolumeClaimStorageCell(
  usage: KubernetesVolumeClaimUsage,
): { usage: StorageUsage | null; noUsageText?: string | undefined } {
  if (usage.space) {
    return { usage: usage.space };
  }

  return {
    usage: null,
    noUsageText:
      KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT[
        usage.gap || KubernetesVolumeUsageGap.NotReported
      ],
  };
}

// The claim a PersistentVolume is bound to, as "namespace/name", for a lookup.
export function getKubernetesVolumeClaimKey(
  namespace: string,
  name: string,
): string {
  return `${namespace}/${name}`;
}

/*
 * True when the cluster has claims to report and not one of them reports
 * usage: the agent most likely predates it, or has volume metrics off. A
 * cluster with no bound claim, or with even one reading, is not that.
 */
export function isVolumeUsageMissingFromCluster(
  claims: Array<KubernetesVolumeClaimUsage>,
): boolean {
  let hasBoundFilesystemClaim: boolean = false;

  for (const claim of claims) {
    if (claim.space || claim.inodes) {
      return false;
    }
    if (claim.gap === KubernetesVolumeUsageGap.NotReported) {
      hasBoundFilesystemClaim = true;
    }
  }

  return hasBoundFilesystemClaim;
}

/*
 * A volume's used and free are its claim's: the kubelet measures a volume
 * where a pod mounts it, through the claim bound to it. A volume no claim
 * is bound to (Available, Released) has nothing to measure.
 */
export function getPersistentVolumeStorageCell(data: {
  phase: string;
  claimNamespace: string;
  claimName: string;
  claimUsages: Map<string, KubernetesVolumeClaimUsage>;
}): { usage: StorageUsage | null; noUsageText?: string | undefined } {
  if (!data.claimName || (data.phase && data.phase !== "Bound")) {
    return {
      usage: null,
      noUsageText:
        KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT[
          KubernetesVolumeUsageGap.NotBound
        ],
    };
  }

  const claim: KubernetesVolumeClaimUsage | undefined = data.claimUsages.get(
    getKubernetesVolumeClaimKey(data.claimNamespace, data.claimName),
  );

  if (!claim) {
    return {
      usage: null,
      noUsageText:
        KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT[
          KubernetesVolumeUsageGap.NotReported
        ],
    };
  }

  return getKubernetesVolumeClaimStorageCell(claim);
}
