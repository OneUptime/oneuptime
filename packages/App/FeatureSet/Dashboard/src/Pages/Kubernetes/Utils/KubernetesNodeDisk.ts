import {
  KUBERNETES_STORAGE_READING_FRESH_MS,
  KubernetesStorageRow,
  getKubernetesImageFsUsage,
  getKubernetesNodeRootDiskUsage,
  getKubernetesStorageMeasuredAt,
} from "Common/Types/Kubernetes/KubernetesStorageHealth";
import { StorageUsage } from "Common/Utils/Storage/StorageUsage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW FULL A KUBERNETES NODE'S DISKS ARE (#9645).
 *
 * Ingest keeps each node's latest disk reading on its KubernetesResource
 * row (KubernetesStorageHealth): its root filesystem - where the kubelet
 * keeps its pods' logs and emptyDir volumes, and the disk it evicts pods
 * by - and, on a node whose container images have a disk of their own,
 * that image filesystem. The Nodes list and a node's page read
 * the row here and draw each with the shared StorageUsageBar, at the
 * kubelet's lines for it (#10057): a disk that holds the images, the image
 * disk or the root filesystem of a node without one, red from 85%; a root
 * filesystem that holds none, from 90%, as the claims list draws a claim.
 *
 * React-free, so App tests can read it.
 */

export interface KubernetesNodeDisk {
  // The root filesystem; null until the agent reported it.
  root: StorageUsage | null;
  // The image filesystem, when it is a disk of its own.
  image: StorageUsage | null;
  // When the agent last reported them.
  measuredAt: Date | null;
  /*
   * Older than the lines' fresh window (15 minutes): the agent stopped
   * reporting the node, so the reading no longer says how full it is.
   */
  isStale: boolean;
}

// What a list's disk cell says with no reading to draw.
export const KUBERNETES_NODE_DISK_NOT_REPORTED: string =
  translationKey("Not reported");

// What a node's page says with no reading to draw: why, and what to do.
export const KUBERNETES_NODE_DISK_NOT_REPORTED_EXPLANATION: string =
  translationKey(
    "No disk reading for this node yet. The Kubernetes agent's collector on each node reports it with the node's CPU and memory.",
  );

export function getKubernetesNodeDisk(
  row: KubernetesStorageRow,
  nowMs: number = Date.now(),
): KubernetesNodeDisk {
  const nodeRow: KubernetesStorageRow = { ...row, kind: "Node" };
  const measuredAt: Date | null = getKubernetesStorageMeasuredAt(nodeRow);
  const root: StorageUsage | null = getKubernetesNodeRootDiskUsage(nodeRow);
  const image: StorageUsage | null = getKubernetesImageFsUsage(nodeRow);

  return {
    root: root,
    image: image,
    measuredAt: root || image ? measuredAt : null,
    isStale:
      !measuredAt ||
      nowMs - measuredAt.getTime() > KUBERNETES_STORAGE_READING_FRESH_MS,
  };
}

export interface KubernetesNodeDiskCells {
  storageUsage: {
    usage: StorageUsage | null;
    noUsageText?: string | undefined;
  };
  secondaryStorageUsage?:
    | { usage: StorageUsage | null; noUsageText?: string | undefined }
    | undefined;
}

/*
 * The Nodes list's disk cells (ResourceTable): the root disk's bar, and the
 * image disk's on a node that has one. A stale reading shows as none, as
 * the list's CPU and memory show N/A.
 */
export function getKubernetesNodeDiskCells(
  disk: KubernetesNodeDisk,
): KubernetesNodeDiskCells {
  if (disk.isStale || !disk.root) {
    return {
      storageUsage: {
        usage: null,
        noUsageText: KUBERNETES_NODE_DISK_NOT_REPORTED,
      },
    };
  }

  const cells: KubernetesNodeDiskCells = {
    storageUsage: { usage: disk.root },
  };

  if (disk.image) {
    cells.secondaryStorageUsage = { usage: disk.image };
  }

  return cells;
}
