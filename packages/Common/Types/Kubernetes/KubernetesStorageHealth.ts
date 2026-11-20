import {
  DEFAULT_STORAGE_USAGE_THRESHOLDS,
  StorageUsage,
  StorageUsageLevel,
  StorageUsageThresholds,
  formatStorageBytes,
  getStorageUsage,
  getStorageUsedPercentFigure,
  readStorageNumber,
} from "../../Utils/Storage/StorageUsage";

/*
 * HOW FULL A KUBERNETES CLAIM'S OR NODE'S DISK IS, AND WHEN THAT NEEDS SOMEONE.
 *
 * Ingest keeps the latest disk reading on the object's KubernetesResource
 * row: a persistent volume claim's filesystem as the kubelet measures it
 * while a running pod mounts it (k8s.volume.*), and a node's root
 * filesystem (k8s.node.filesystem.*) with, when it is a disk of its own, the
 * filesystem that holds its container images (the kubelet's imagefs). The
 * lists, the pages and the cluster's Needs attention read that row through
 * these rules, so the claims list's amber bar, a claim listed under Needs
 * attention and the PVC Almost Full template agree, at the same lines.
 *
 *   - A claim's lines are StorageUsage's (KUBERNETES_STORAGE_USAGE_THRESHOLDS):
 *     nearly full from 80% used, almost out of space from 90%. Nearly full
 *     needs a look (warning); almost out of space is about to break: writes
 *     fail (critical).
 *   - A disk that holds the node's container images is almost full from 85%
 *     (KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS, #10057): the kubelet's
 *     defaults start on it there, deleting unused images
 *     (imageGCHighThresholdPercent) and evicting pods once less than 15% is
 *     free (imagefs.available<15%, DiskPressure). That is the image disk of
 *     a node that has one, and the root filesystem of a node that keeps its
 *     images there, as most nodes do ("nodefs, imagefs, and containerfs all
 *     refer to the same underlying filesystem", Kubernetes' node-pressure
 *     eviction page). A node's root filesystem that holds no images is
 *     almost full at 90%, where its nodefs eviction starts
 *     (nodefs.available<10%). At 90% the alerts and the red bar came 5
 *     points after the kubelet had started evicting pods from most nodes,
 *     and a disk the kubelet holds at 85% by evicting them may never reach
 *     90% at all.
 *   - Only a fresh reading counts. The kubelet measures a claim only while
 *     a pod mounts it, so the last reading of a claim nothing mounts any
 *     more stays on its row, and the lists still show it with its age; but
 *     a claim nothing writes to is filling no further, and a StatefulSet
 *     scaled down would leave its claims flagged for ever.
 *   - How fast a claim is filling comes from two readings a few hours apart
 *     (the row's baseline, which ingest moves forward as it goes), as a time
 *     until it is full.
 *
 * React-free and server-safe: the ingest, the API and the Dashboard read it,
 * through KubernetesHealth. The words are keys of the Dashboard's locales,
 * marked below; sizes and percents are values, in English digits, which the
 * Dashboard writes in the reader's.
 */

/*
 * Marks an English text as a key of the Dashboard's locales, as
 * KubernetesHealth's marker does: the extractor reads this file as a "keys"
 * root. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * The lines a claim is nearly full and almost out of space at: the claims
 * list's bars, the cluster's Needs attention, and the PVC Almost Full
 * template, which fires at the critical line. A node's root filesystem that
 * holds no images (its images have a disk of their own) is judged at them
 * too: 90% is where its nodefs eviction starts.
 */
export const KUBERNETES_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds =
  DEFAULT_STORAGE_USAGE_THRESHOLDS;

/*
 * The lines a disk that holds a node's container images is nearly full and
 * almost full at (#10057): the Nodes list's Disk and Image Disk bars, the
 * node's Disk Used charts, the cluster's Needs attention, and the High Node
 * Disk Usage and Node Image Disk Almost Full templates, which fire at the
 * critical line. 85% is where the kubelet's defaults start on such a disk:
 * image garbage collection (imageGCHighThresholdPercent 85, down to 80) and
 * the imagefs eviction (imagefs.available<15%). Nearly full stays at 80%,
 * where image garbage collection brings a disk back down to.
 */
export const KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: DEFAULT_STORAGE_USAGE_THRESHOLDS.warningPercent,
  criticalPercent: 85,
};

/*
 * How long a disk reading still says how full the disk is now, measured
 * against the row's own clock (the snapshot's time). The agent reports a
 * mounted claim and every node twice a minute; a reading this old belongs
 * to a claim nothing mounts any more, or to an agent that stopped.
 */
export const KUBERNETES_STORAGE_READING_FRESH_MS: number = 15 * 60 * 1000;

/*
 * The fill rate is the growth between the row's baseline and the latest
 * reading: never over less than half an hour, which a burst of writes would
 * swing, and at most six hours back, so it follows what the workload does
 * now. Ingest halves the window once it reaches six hours, keeping a point
 * on the same line, so a rate is always there after the first half hour.
 */
export const KUBERNETES_VOLUME_FILL_MIN_WINDOW_MS: number = 30 * 60 * 1000;
export const KUBERNETES_VOLUME_FILL_MAX_WINDOW_MS: number = 6 * 60 * 60 * 1000;

// Further out than this, a projection from a few hours of writes means little.
export const KUBERNETES_VOLUME_FILL_HORIZON_MS: number =
  30 * 24 * 60 * 60 * 1000;

/*
 * A node's image filesystem is a disk of its own when its size, or the room
 * left on it, differs from the root filesystem's beyond this share of the
 * root filesystem: the same filesystem reads the same in one scrape.
 */
export const KUBERNETES_IMAGE_FS_DIFFERENCE_SHARE: number = 0.01;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

// A claim's status: the words the shared storage bar's pill says.
const STATUS_NEARLY_FULL: string = translationKey("Nearly full");
const STATUS_ALMOST_OUT_OF_SPACE: string = translationKey(
  "Almost out of space",
);
// A node's status: a node also has memory, CPU and pods to run out of.
const STATUS_DISK_NEARLY_FULL: string = translationKey("Disk nearly full");
const STATUS_DISK_ALMOST_FULL: string = translationKey("Disk almost full");

const REASON_USED_AND_FREE: string = translationKey(
  "{{percent}} used, {{free}} free",
);
const REASON_DISK_USED_AND_FREE: string = translationKey(
  "Disk {{percent}} used, {{free}} free",
);
const REASON_IMAGE_DISK_USED_AND_FREE: string = translationKey(
  "Image disk {{percent}} used, {{free}} free",
);
const REASON_INODES_USED: string = translationKey("Inodes {{percent}} used");
const REASON_NO_FREE_INODES: string = translationKey("No free inodes");
const REASON_FULL_WITHIN_AN_HOUR: string = translationKey(
  "Full in less than an hour",
);
const REASON_FULL_IN_HOURS: { one: string; other: string } = {
  one: translationKey("Full in about {{count}} hour"),
  other: translationKey("Full in about {{count}} hours"),
};
const REASON_FULL_IN_DAYS: { one: string; other: string } = {
  one: translationKey("Full in about {{count}} day"),
  other: translationKey("Full in about {{count}} days"),
};

/*
 * ---------------------------------------------------------------------------
 * Reading a row
 * ---------------------------------------------------------------------------
 */

/*
 * The disk columns of a KubernetesResource row, as Postgres (bigints as
 * text, dates as Date) or ModelAPI (numbers) hands them. On a claim's row
 * latestVolume* is the claim's filesystem; on a node's, its root
 * filesystem, and latestImageFs* its image filesystem when that is a disk of
 * its own (null when it is the same one).
 */
export interface KubernetesStorageRow {
  kind?: string | null | undefined;
  latestVolumeCapacityBytes?: number | string | null | undefined;
  latestVolumeAvailableBytes?: number | string | null | undefined;
  latestVolumeInodes?: number | string | null | undefined;
  latestVolumeInodesFree?: number | string | null | undefined;
  latestImageFsCapacityBytes?: number | string | null | undefined;
  latestImageFsAvailableBytes?: number | string | null | undefined;
  // When the disk reading was taken.
  latestVolumeMeasuredAt?: Date | string | null | undefined;
  /*
   * A claim's used bytes a few hours before, and when: how fast it is
   * filling.
   */
  latestVolumeUsedBaselineBytes?: number | string | null | undefined;
  latestVolumeUsedBaselineAt?: Date | string | null | undefined;
  /*
   * The latest metric of any kind mirrored onto the row: a claim's rows
   * written before latestVolumeMeasuredAt existed date their reading by it.
   */
  metricsUpdatedAt?: Date | string | null | undefined;
}

// One reason or status word, as KubernetesHealthText has it.
export interface KubernetesStorageText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

export interface KubernetesStorageVerdict {
  level: StorageUsageLevel.Warning | StorageUsageLevel.Critical;
  status: KubernetesStorageText;
  // Why, the fullest disk first.
  reasons: Array<KubernetesStorageText>;
}

export interface KubernetesVolumeFill {
  // How many bytes more are used each day, at the rate since the baseline.
  bytesPerDay: number;
  // How long until nothing more can be written at that rate; null when it is not filling.
  msToFull: number | null;
}

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const time: number =
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

// When the row's disk reading was taken, or null when it has none.
export function getKubernetesStorageMeasuredAt(
  row: KubernetesStorageRow,
): Date | null {
  const measuredAt: number | null =
    toTime(row.latestVolumeMeasuredAt) ??
    (row.kind === "PersistentVolumeClaim"
      ? toTime(row.metricsUpdatedAt)
      : null);
  return measuredAt === null ? null : new Date(measuredAt);
}

/*
 * The reading still says how full the disk is: taken no longer than
 * KUBERNETES_STORAGE_READING_FRESH_MS before the clock (the snapshot's time,
 * or now). A reading newer than the clock - one that arrived after the last
 * snapshot - is fresh.
 */
export function isKubernetesStorageReadingFresh(
  row: KubernetesStorageRow,
  clockMs: number,
): boolean {
  const measuredAt: Date | null = getKubernetesStorageMeasuredAt(row);
  return (
    measuredAt !== null &&
    clockMs - measuredAt.getTime() <= KUBERNETES_STORAGE_READING_FRESH_MS
  );
}

// A claim's filesystem: used, free, capacity.
export function getKubernetesVolumeUsage(
  row: KubernetesStorageRow,
): StorageUsage | null {
  return getStorageUsage(
    {
      capacity: row.latestVolumeCapacityBytes,
      available: row.latestVolumeAvailableBytes,
    },
    KUBERNETES_STORAGE_USAGE_THRESHOLDS,
  );
}

/*
 * Whether a node's row holds a reading of an image disk of its own: ingest
 * writes one only when a scrape shows the images' filesystem is not the root
 * one (isSeparateKubernetesImageFs), and clears it when it is.
 */
export function hasKubernetesSeparateImageFs(
  row: KubernetesStorageRow,
): boolean {
  const capacity: number | null = readStorageNumber(
    row.latestImageFsCapacityBytes,
  );
  return capacity !== null && capacity > 0;
}

/*
 * The lines a node's root filesystem is judged at: the image disk's, 85%,
 * unless its images have a disk of their own. A node whose row says nothing
 * of one keeps its images on its root filesystem, as most nodes do, so that
 * is the line its kubelet starts evicting pods at.
 */
export function getKubernetesNodeRootDiskThresholds(
  row: KubernetesStorageRow,
): StorageUsageThresholds {
  return hasKubernetesSeparateImageFs(row)
    ? KUBERNETES_STORAGE_USAGE_THRESHOLDS
    : KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS;
}

// A node's root filesystem: used, free, capacity, at its own lines.
export function getKubernetesNodeRootDiskUsage(
  row: KubernetesStorageRow,
): StorageUsage | null {
  return getStorageUsage(
    {
      capacity: row.latestVolumeCapacityBytes,
      available: row.latestVolumeAvailableBytes,
    },
    getKubernetesNodeRootDiskThresholds(row),
  );
}

export function getKubernetesVolumeInodeUsage(
  row: KubernetesStorageRow,
): StorageUsage | null {
  return getStorageUsage(
    {
      capacity: row.latestVolumeInodes,
      available: row.latestVolumeInodesFree,
    },
    KUBERNETES_STORAGE_USAGE_THRESHOLDS,
  );
}

// A node's image filesystem, when it is a disk of its own.
export function getKubernetesImageFsUsage(
  row: KubernetesStorageRow,
): StorageUsage | null {
  return getStorageUsage(
    {
      capacity: row.latestImageFsCapacityBytes,
      available: row.latestImageFsAvailableBytes,
    },
    KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS,
  );
}

/*
 * Whether a node's image filesystem (where container images and the files
 * containers write live: the kubelet reports it as every container's root
 * filesystem) is a disk of its own, from one scrape's readings of both.
 * Null when either is missing: then nothing can be said.
 */
export function isSeparateKubernetesImageFs(data: {
  rootCapacityBytes: number | null;
  rootAvailableBytes: number | null;
  imageCapacityBytes: number | null;
  imageAvailableBytes: number | null;
}): boolean | null {
  const rootCapacity: number | null = data.rootCapacityBytes;
  const imageCapacity: number | null = data.imageCapacityBytes;

  if (
    rootCapacity === null ||
    imageCapacity === null ||
    data.rootAvailableBytes === null ||
    data.imageAvailableBytes === null ||
    rootCapacity <= 0 ||
    imageCapacity <= 0
  ) {
    return null;
  }

  if (rootCapacity !== imageCapacity) {
    return true;
  }

  return (
    Math.abs(data.rootAvailableBytes - data.imageAvailableBytes) >
    rootCapacity * KUBERNETES_IMAGE_FS_DIFFERENCE_SHARE
  );
}

/*
 * How fast a claim is filling: the growth of its used bytes between the
 * row's baseline and the latest reading. Null without a baseline, or over
 * less than KUBERNETES_VOLUME_FILL_MIN_WINDOW_MS.
 */
export function getKubernetesVolumeFill(
  row: KubernetesStorageRow,
): KubernetesVolumeFill | null {
  const usage: StorageUsage | null = getKubernetesVolumeUsage(row);
  const baselineUsed: number | null = readStorageNumber(
    row.latestVolumeUsedBaselineBytes,
  );
  const baselineAt: number | null = toTime(row.latestVolumeUsedBaselineAt);
  const measuredAt: Date | null = getKubernetesStorageMeasuredAt(row);

  if (!usage || baselineUsed === null || baselineAt === null || !measuredAt) {
    return null;
  }

  const windowMs: number = measuredAt.getTime() - baselineAt;

  if (windowMs < KUBERNETES_VOLUME_FILL_MIN_WINDOW_MS) {
    return null;
  }

  const bytesPerMs: number = (usage.used - baselineUsed) / windowMs;

  return {
    bytesPerDay: bytesPerMs * DAY_MS,
    msToFull: bytesPerMs > 0 ? usage.free / bytesPerMs : null,
  };
}

/*
 * When a claim filling at its rate will be full, as a reason: "Full in about
 * 3 days", "Full in about 5 hours". Null when it is not filling, or would
 * take longer than KUBERNETES_VOLUME_FILL_HORIZON_MS.
 */
export function getKubernetesVolumeFillReason(
  fill: KubernetesVolumeFill | null,
): KubernetesStorageText | null {
  if (
    !fill ||
    fill.msToFull === null ||
    fill.msToFull > KUBERNETES_VOLUME_FILL_HORIZON_MS
  ) {
    return null;
  }

  if (fill.msToFull < HOUR_MS) {
    return { text: REASON_FULL_WITHIN_AN_HOUR };
  }

  if (fill.msToFull < 2 * DAY_MS) {
    const hours: number = Math.max(1, Math.round(fill.msToFull / HOUR_MS));
    return {
      text: REASON_FULL_IN_HOURS.other,
      plural: { one: REASON_FULL_IN_HOURS.one, count: hours },
    };
  }

  const days: number = Math.round(fill.msToFull / DAY_MS);
  return {
    text: REASON_FULL_IN_DAYS.other,
    plural: { one: REASON_FULL_IN_DAYS.one, count: days },
  };
}

/*
 * ---------------------------------------------------------------------------
 * The verdicts
 * ---------------------------------------------------------------------------
 */

const LEVEL_RANK: Record<StorageUsageLevel, number> = {
  [StorageUsageLevel.Normal]: 0,
  [StorageUsageLevel.Warning]: 1,
  [StorageUsageLevel.Critical]: 2,
};

function worseLevel(
  a: StorageUsageLevel,
  b: StorageUsageLevel,
): StorageUsageLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// "91%": whole and rounded down, as the bar writes it.
function percentValue(usage: StorageUsage): string {
  return `${getStorageUsedPercentFigure(usage)}%`;
}

// "4.5 GiB": binary units, as the bar writes them, in English digits.
function freeValue(usage: StorageUsage): string {
  return formatStorageBytes(usage.free, "en");
}

function usedAndFree(
  template: string,
  usage: StorageUsage,
): KubernetesStorageText {
  return {
    text: template,
    values: { percent: percentValue(usage), free: freeValue(usage) },
  };
}

/*
 * A bound claim's disk, from a fresh reading: nearly full at 80% used,
 * almost out of space at 90%, by its bytes or its inodes - a filesystem with
 * space left but no inode free can create no file. Null when it has room,
 * or no fresh reading.
 */
export function assessKubernetesVolumeClaimStorage(
  row: KubernetesStorageRow,
  clockMs: number,
): KubernetesStorageVerdict | null {
  if (!isKubernetesStorageReadingFresh(row, clockMs)) {
    return null;
  }

  const space: StorageUsage | null = getKubernetesVolumeUsage(row);
  const inodes: StorageUsage | null = getKubernetesVolumeInodeUsage(row);
  const hasNoFreeInode: boolean = Boolean(inodes && inodes.free <= 0);

  const spaceLevel: StorageUsageLevel = space
    ? space.level
    : StorageUsageLevel.Normal;
  const inodeLevel: StorageUsageLevel = hasNoFreeInode
    ? StorageUsageLevel.Critical
    : inodes
      ? inodes.level
      : StorageUsageLevel.Normal;
  const level: StorageUsageLevel = worseLevel(spaceLevel, inodeLevel);

  if (level === StorageUsageLevel.Normal) {
    return null;
  }

  const spaceReasons: Array<KubernetesStorageText> = [];
  if (space && spaceLevel !== StorageUsageLevel.Normal) {
    spaceReasons.push(usedAndFree(REASON_USED_AND_FREE, space));
  }
  const inodeReasons: Array<KubernetesStorageText> = [];
  if (inodes && inodeLevel !== StorageUsageLevel.Normal) {
    inodeReasons.push(
      hasNoFreeInode
        ? { text: REASON_NO_FREE_INODES }
        : {
            text: REASON_INODES_USED,
            values: { percent: percentValue(inodes) },
          },
    );
  }

  const reasons: Array<KubernetesStorageText> =
    LEVEL_RANK[inodeLevel] > LEVEL_RANK[spaceLevel]
      ? [...inodeReasons, ...spaceReasons]
      : [...spaceReasons, ...inodeReasons];

  const fillReason: KubernetesStorageText | null =
    getKubernetesVolumeFillReason(getKubernetesVolumeFill(row));
  if (fillReason) {
    reasons.push(fillReason);
  }

  return {
    level: level as StorageUsageLevel.Warning | StorageUsageLevel.Critical,
    status: {
      text:
        level === StorageUsageLevel.Critical
          ? STATUS_ALMOST_OUT_OF_SPACE
          : STATUS_NEARLY_FULL,
    },
    reasons: reasons,
  };
}

/*
 * A node's disks, from a fresh reading: its root filesystem, and its image
 * filesystem when that is a disk of its own, each at its kubelet's lines. By
 * default the kubelet evicts pods at 15% free on the disk that holds the
 * images (the root filesystem on most nodes) and 10% free on a root
 * filesystem that holds none, and fails image pulls when the images' disk
 * fills. Null when both have room, or no fresh reading.
 */
export function assessKubernetesNodeStorage(
  row: KubernetesStorageRow,
  clockMs: number,
): KubernetesStorageVerdict | null {
  if (!isKubernetesStorageReadingFresh(row, clockMs)) {
    return null;
  }

  const disks: Array<{ usage: StorageUsage; template: string }> = [];
  const root: StorageUsage | null = getKubernetesNodeRootDiskUsage(row);
  if (root && root.level !== StorageUsageLevel.Normal) {
    disks.push({ usage: root, template: REASON_DISK_USED_AND_FREE });
  }
  const image: StorageUsage | null = getKubernetesImageFsUsage(row);
  if (image && image.level !== StorageUsageLevel.Normal) {
    disks.push({ usage: image, template: REASON_IMAGE_DISK_USED_AND_FREE });
  }

  if (disks.length === 0) {
    return null;
  }

  // The fullest first.
  disks.sort(
    (a: { usage: StorageUsage }, b: { usage: StorageUsage }): number => {
      return b.usage.usedPercent - a.usage.usedPercent;
    },
  );

  const level: StorageUsageLevel = disks.reduce(
    (worst: StorageUsageLevel, disk: { usage: StorageUsage }) => {
      return worseLevel(worst, disk.usage.level);
    },
    StorageUsageLevel.Normal,
  );

  return {
    level: level as StorageUsageLevel.Warning | StorageUsageLevel.Critical,
    status: {
      text:
        level === StorageUsageLevel.Critical
          ? STATUS_DISK_ALMOST_FULL
          : STATUS_DISK_NEARLY_FULL,
    },
    reasons: disks.map(
      (disk: {
        usage: StorageUsage;
        template: string;
      }): KubernetesStorageText => {
        return usedAndFree(disk.template, disk.usage);
      },
    ),
  };
}
