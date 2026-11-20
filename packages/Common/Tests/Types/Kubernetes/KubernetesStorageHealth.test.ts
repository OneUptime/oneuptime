import {
  KUBERNETES_IMAGE_FS_DIFFERENCE_SHARE,
  KUBERNETES_STORAGE_READING_FRESH_MS,
  KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS,
  KUBERNETES_STORAGE_USAGE_THRESHOLDS,
  KUBERNETES_VOLUME_FILL_HORIZON_MS,
  KUBERNETES_VOLUME_FILL_MAX_WINDOW_MS,
  KUBERNETES_VOLUME_FILL_MIN_WINDOW_MS,
  KubernetesStorageRow,
  KubernetesStorageText,
  KubernetesStorageVerdict,
  KubernetesVolumeFill,
  assessKubernetesNodeStorage,
  assessKubernetesVolumeClaimStorage,
  getKubernetesImageFsUsage,
  hasKubernetesSeparateImageFs,
  getKubernetesNodeRootDiskUsage,
  getKubernetesNodeRootDiskThresholds,
  getKubernetesStorageMeasuredAt,
  getKubernetesVolumeFill,
  getKubernetesVolumeFillReason,
  getKubernetesVolumeUsage,
  isKubernetesStorageReadingFresh,
  isSeparateKubernetesImageFs,
} from "../../../Types/Kubernetes/KubernetesStorageHealth";
import {
  DEFAULT_STORAGE_USAGE_THRESHOLDS,
  StorageUsageLevel,
  getStorageUsage,
} from "../../../Utils/Storage/StorageUsage";
import { describe, expect, test } from "@jest/globals";

/*
 * When a Kubernetes claim's or node's disk needs someone (#9643, #9645):
 * the lines the claims list colours its bar at, read from the disk reading
 * ingest keeps on the row, only while that reading is fresh, with how fast
 * a claim is filling.
 */

const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
// The clock the rules measure against: the snapshot's time.
const CLOCK: Date = new Date("2026-11-19T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(CLOCK.getTime() - ms);
}

// A claim whose filesystem of `capacity` GiB is `usedPercent` used, measured `age` ago.
function claim(
  usedPercent: number,
  extra: Partial<KubernetesStorageRow> = {},
  capacityGiB: number = 100,
): KubernetesStorageRow {
  const capacity: number = capacityGiB * GIB;
  return {
    kind: "PersistentVolumeClaim",
    latestVolumeCapacityBytes: capacity,
    latestVolumeAvailableBytes: Math.round(capacity * (1 - usedPercent / 100)),
    latestVolumeMeasuredAt: ago(MINUTE),
    ...extra,
  };
}

function node(
  rootUsedPercent: number,
  extra: Partial<KubernetesStorageRow> = {},
): KubernetesStorageRow {
  return {
    kind: "Node",
    latestVolumeCapacityBytes: 100 * GIB,
    latestVolumeAvailableBytes: Math.round(
      100 * GIB * (1 - rootUsedPercent / 100),
    ),
    latestVolumeMeasuredAt: ago(MINUTE),
    ...extra,
  };
}

describe("the lines are the claims list's, from one definition", () => {
  test("nearly full at 80% used, almost out of space at 90%: what the bar draws", () => {
    expect(KUBERNETES_STORAGE_USAGE_THRESHOLDS).toBe(
      DEFAULT_STORAGE_USAGE_THRESHOLDS,
    );
    expect(KUBERNETES_STORAGE_USAGE_THRESHOLDS.warningPercent).toBe(80);
    expect(KUBERNETES_STORAGE_USAGE_THRESHOLDS.criticalPercent).toBe(90);
  });

  test.each([
    [79, StorageUsageLevel.Normal],
    [80, StorageUsageLevel.Warning],
    [89.9, StorageUsageLevel.Warning],
    [90, StorageUsageLevel.Critical],
    [100, StorageUsageLevel.Critical],
  ])(
    "a claim %p%% used reads %p, as the claims list's bar does",
    (usedPercent: number, level: StorageUsageLevel) => {
      const row: KubernetesStorageRow = claim(usedPercent);
      expect(getKubernetesVolumeUsage(row)?.level).toBe(level);
      // The same reading the list draws (KubernetesVolumeUsage, getStorageUsage's defaults).
      expect(
        getStorageUsage({
          capacity: row.latestVolumeCapacityBytes,
          available: row.latestVolumeAvailableBytes,
        })?.level,
      ).toBe(level);
    },
  );
});

describe("when a reading was taken, and whether it still counts", () => {
  test("the reading's own time wins; a claim's older rows date it by metricsUpdatedAt", () => {
    const measured: Date = ago(2 * MINUTE);
    expect(
      getKubernetesStorageMeasuredAt(
        claim(50, {
          latestVolumeMeasuredAt: measured,
          metricsUpdatedAt: ago(DAY),
        }),
      ),
    ).toEqual(measured);
    expect(
      getKubernetesStorageMeasuredAt(
        claim(50, {
          latestVolumeMeasuredAt: null,
          metricsUpdatedAt: ago(3 * MINUTE),
        }),
      ),
    ).toEqual(ago(3 * MINUTE));
  });

  test("a node's metricsUpdatedAt moves with its CPU, so it never dates the disk", () => {
    expect(
      getKubernetesStorageMeasuredAt(
        node(50, {
          latestVolumeMeasuredAt: null,
          metricsUpdatedAt: ago(MINUTE),
        }),
      ),
    ).toBeNull();
  });

  test("dates arrive as text from Postgres", () => {
    expect(
      getKubernetesStorageMeasuredAt(
        claim(50, { latestVolumeMeasuredAt: ago(MINUTE).toISOString() }),
      ),
    ).toEqual(ago(MINUTE));
  });

  test("fresh for fifteen minutes before the clock, and when newer than it", () => {
    const clock: number = CLOCK.getTime();
    expect(KUBERNETES_STORAGE_READING_FRESH_MS).toBe(15 * MINUTE);
    expect(
      isKubernetesStorageReadingFresh(
        claim(50, { latestVolumeMeasuredAt: ago(15 * MINUTE) }),
        clock,
      ),
    ).toBe(true);
    expect(
      isKubernetesStorageReadingFresh(
        claim(50, { latestVolumeMeasuredAt: ago(15 * MINUTE + 1) }),
        clock,
      ),
    ).toBe(false);
    // A reading that arrived after the last snapshot.
    expect(
      isKubernetesStorageReadingFresh(
        claim(50, { latestVolumeMeasuredAt: new Date(clock + 4 * MINUTE) }),
        clock,
      ),
    ).toBe(true);
    expect(
      isKubernetesStorageReadingFresh(
        claim(50, { latestVolumeMeasuredAt: null, metricsUpdatedAt: null }),
        clock,
      ),
    ).toBe(false);
  });
});

describe("a claim's disk", () => {
  const clock: number = CLOCK.getTime();

  test("has room below 80%: no verdict", () => {
    expect(assessKubernetesVolumeClaimStorage(claim(79), clock)).toBeNull();
  });

  test("at 80% is nearly full, and says how much is used and free", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(claim(80), clock);
    expect(verdict).toEqual({
      level: StorageUsageLevel.Warning,
      status: { text: "Nearly full" },
      reasons: [
        {
          text: "{{percent}} used, {{free}} free",
          values: { percent: "80%", free: "20\u00A0GiB" },
        },
      ],
    });
  });

  test("at 89.9% is still nearly full, written 89% (rounded down, as the bar)", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(claim(89.9), clock);
    expect(verdict?.level).toBe(StorageUsageLevel.Warning);
    expect(verdict?.reasons[0]?.values?.["percent"]).toBe("89%");
  });

  test("at 90% is almost out of space", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(claim(97, {}, 50), clock);
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.status).toEqual({ text: "Almost out of space" });
    expect(verdict?.reasons[0]).toEqual({
      text: "{{percent}} used, {{free}} free",
      values: { percent: "97%", free: "1.5\u00A0GiB" },
    });
  });

  test("a stale reading flags nothing, however full: no pod mounts it, so nothing writes to it", () => {
    expect(
      assessKubernetesVolumeClaimStorage(
        claim(99, { latestVolumeMeasuredAt: ago(2 * HOUR) }),
        clock,
      ),
    ).toBeNull();
  });

  test("no reading, or a raw block device with none: nothing to say", () => {
    expect(
      assessKubernetesVolumeClaimStorage(
        {
          kind: "PersistentVolumeClaim",
          latestVolumeMeasuredAt: ago(MINUTE),
        },
        clock,
      ),
    ).toBeNull();
  });

  test("with space left but no inode free it can create no file: almost out of space", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(
        claim(40, { latestVolumeInodes: 1000, latestVolumeInodesFree: 0 }),
        clock,
      );
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.reasons).toEqual([{ text: "No free inodes" }]);
  });

  test("its inodes nearly used up read as nearly full, by their own share", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(
        claim(50, { latestVolumeInodes: 1000, latestVolumeInodesFree: 150 }),
        clock,
      );
    expect(verdict?.level).toBe(StorageUsageLevel.Warning);
    expect(verdict?.reasons).toEqual([
      { text: "Inodes {{percent}} used", values: { percent: "85%" } },
    ]);
  });

  test("the worse of its bytes and its inodes leads, and both are said", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(
        claim(84, { latestVolumeInodes: 1000, latestVolumeInodesFree: 50 }),
        clock,
      );
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(
      verdict?.reasons.map((reason: KubernetesStorageText): string => {
        return reason.text;
      }),
    ).toEqual(["Inodes {{percent}} used", "{{percent}} used, {{free}} free"]);
  });

  test("says when it will be full, when it is filling", () => {
    // 85% used now (85 GiB), 75 GiB six hours of growth ago: 10 GiB in 5 hours.
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesVolumeClaimStorage(
        claim(85, {
          latestVolumeUsedBaselineBytes: 75 * GIB,
          latestVolumeUsedBaselineAt: ago(5 * HOUR + MINUTE),
        }),
        clock,
      );
    expect(verdict?.reasons).toEqual([
      {
        text: "{{percent}} used, {{free}} free",
        values: { percent: "85%", free: "15\u00A0GiB" },
      },
      {
        text: "Full in about {{count}} hours",
        plural: { one: "Full in about {{count}} hour", count: 8 },
      },
    ]);
  });
});

describe("how fast a claim is filling", () => {
  test("needs a baseline at least half an hour before the reading", () => {
    expect(KUBERNETES_VOLUME_FILL_MIN_WINDOW_MS).toBe(30 * MINUTE);
    expect(KUBERNETES_VOLUME_FILL_MAX_WINDOW_MS).toBe(6 * HOUR);
    expect(getKubernetesVolumeFill(claim(85))).toBeNull();
    expect(
      getKubernetesVolumeFill(
        claim(85, {
          latestVolumeUsedBaselineBytes: 80 * GIB,
          latestVolumeUsedBaselineAt: ago(MINUTE + 29 * MINUTE),
        }),
      ),
    ).toBeNull();
  });

  test("is the growth of its used bytes since the baseline, and when that fills the rest", () => {
    const fill: KubernetesVolumeFill | null = getKubernetesVolumeFill(
      claim(90, {
        latestVolumeUsedBaselineBytes: 89 * GIB,
        latestVolumeUsedBaselineAt: ago(MINUTE + 2 * HOUR),
      }),
    );
    // 1 GiB in 2 hours: 12 GiB a day, and 10 GiB free lasts 20 hours.
    expect(fill?.bytesPerDay).toBeCloseTo(12 * GIB, 0);
    expect(fill?.msToFull).toBeCloseTo(20 * HOUR, -3);
  });

  test("is never filling while it shrinks, or while only its capacity grew", () => {
    expect(
      getKubernetesVolumeFill(
        claim(80, {
          latestVolumeUsedBaselineBytes: 90 * GIB,
          latestVolumeUsedBaselineAt: ago(3 * HOUR),
        }),
      )?.msToFull,
    ).toBeNull();
    // Resized from 100 to 200 GiB: still 80 GiB used, so no growth.
    expect(
      getKubernetesVolumeFill(
        claim(
          40,
          {
            latestVolumeUsedBaselineBytes: 80 * GIB,
            latestVolumeUsedBaselineAt: ago(3 * HOUR),
          },
          200,
        ),
      )?.msToFull,
    ).toBeNull();
  });

  test.each([
    [30 * MINUTE, { text: "Full in less than an hour" }],
    [
      HOUR + 10 * MINUTE,
      {
        text: "Full in about {{count}} hours",
        plural: { one: "Full in about {{count}} hour", count: 1 },
      },
    ],
    [
      47 * HOUR,
      {
        text: "Full in about {{count}} hours",
        plural: { one: "Full in about {{count}} hour", count: 47 },
      },
    ],
    [
      2 * DAY,
      {
        text: "Full in about {{count}} days",
        plural: { one: "Full in about {{count}} day", count: 2 },
      },
    ],
    [
      29.6 * DAY,
      {
        text: "Full in about {{count}} days",
        plural: { one: "Full in about {{count}} day", count: 30 },
      },
    ],
  ])(
    "full in %p ms reads %p",
    (msToFull: number, reason: KubernetesStorageText) => {
      expect(
        getKubernetesVolumeFillReason({ bytesPerDay: GIB, msToFull: msToFull }),
      ).toEqual(reason);
    },
  );

  test("says nothing past a month, or while it is not filling", () => {
    expect(KUBERNETES_VOLUME_FILL_HORIZON_MS).toBe(30 * DAY);
    expect(
      getKubernetesVolumeFillReason({
        bytesPerDay: GIB,
        msToFull: 30 * DAY + 1,
      }),
    ).toBeNull();
    expect(
      getKubernetesVolumeFillReason({ bytesPerDay: -GIB, msToFull: null }),
    ).toBeNull();
    expect(getKubernetesVolumeFillReason(null)).toBeNull();
  });
});

describe("a node's disks", () => {
  const clock: number = CLOCK.getTime();

  // A node whose images have a disk of their own, 100 GiB with `imageFree` free.
  function withImageDisk(
    rootUsed: number,
    imageFree: number = 90 * GIB,
  ): KubernetesStorageRow {
    return node(rootUsed, {
      latestImageFsCapacityBytes: 100 * GIB,
      latestImageFsAvailableBytes: imageFree,
    });
  }

  test("its root filesystem nearly full reads Disk nearly full", () => {
    expect(assessKubernetesNodeStorage(node(82), clock)).toEqual({
      level: StorageUsageLevel.Warning,
      status: { text: "Disk nearly full" },
      reasons: [
        {
          text: "Disk {{percent}} used, {{free}} free",
          values: { percent: "82%", free: "18\u00A0GiB" },
        },
      ],
    });
  });

  /*
   * A root filesystem that holds the node's images, as on most nodes: the
   * kubelet starts deleting images and evicting pods from it at 85% used
   * (imagefs.available<15%), so it is almost full there (#10057).
   */
  test("holding the images, as a node with no image disk of its own does, it is almost full at the kubelet's 85%", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesNodeStorage(node(85), clock);
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.status).toEqual({ text: "Disk almost full" });
    expect(verdict?.reasons).toEqual([
      {
        text: "Disk {{percent}} used, {{free}} free",
        values: { percent: "85%", free: "15\u00A0GiB" },
      },
    ]);
    expect(assessKubernetesNodeStorage(node(84), clock)?.level).toBe(
      StorageUsageLevel.Warning,
    );
  });

  test("holding no images, it is almost full at its own eviction line, 90%", () => {
    expect(assessKubernetesNodeStorage(withImageDisk(85), clock)?.level).toBe(
      StorageUsageLevel.Warning,
    );
    expect(assessKubernetesNodeStorage(withImageDisk(89), clock)?.level).toBe(
      StorageUsageLevel.Warning,
    );
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesNodeStorage(withImageDisk(90), clock);
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.status).toEqual({ text: "Disk almost full" });
  });

  test("an image disk of its own is almost full at the kubelet's 85%, the fullest disk first", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesNodeStorage(
        node(82, {
          latestImageFsCapacityBytes: 500 * GIB,
          latestImageFsAvailableBytes: 75 * GIB,
        }),
        clock,
      );
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.reasons).toEqual([
      {
        text: "Image disk {{percent}} used, {{free}} free",
        values: { percent: "85%", free: "75\u00A0GiB" },
      },
      {
        text: "Disk {{percent}} used, {{free}} free",
        values: { percent: "82%", free: "18\u00A0GiB" },
      },
    ]);
  });

  test("an image disk alone can make the node nearly full", () => {
    expect(
      assessKubernetesNodeStorage(withImageDisk(20, 18 * GIB), clock)?.status,
    ).toEqual({ text: "Disk nearly full" });
  });

  test("room on both, or a stale reading: no verdict", () => {
    expect(assessKubernetesNodeStorage(node(60), clock)).toBeNull();
    expect(assessKubernetesNodeStorage(node(79), clock)).toBeNull();
    expect(
      assessKubernetesNodeStorage(
        node(95, { latestVolumeMeasuredAt: ago(HOUR) }),
        clock,
      ),
    ).toBeNull();
  });

  test("the image disk reads from its own columns", () => {
    expect(getKubernetesImageFsUsage(node(50))).toBeNull();
    expect(
      getKubernetesImageFsUsage(
        node(50, {
          latestImageFsCapacityBytes: "1099511627776",
          latestImageFsAvailableBytes: "549755813888",
        }),
      )?.usedPercent,
    ).toBe(50);
  });
});

describe("the lines a node's disk is judged at (#10057)", () => {
  test("a disk that holds the images: nearly full at 80%, almost full at 85%", () => {
    expect(KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS).toEqual({
      warningPercent: 80,
      criticalPercent: 85,
    });
    // The claims list keeps its own.
    expect(KUBERNETES_STORAGE_USAGE_THRESHOLDS).toEqual({
      warningPercent: 80,
      criticalPercent: 90,
    });
  });

  test("a root filesystem holds the images unless the row reads an image disk of its own", () => {
    expect(hasKubernetesSeparateImageFs(node(50))).toBe(false);
    expect(
      hasKubernetesSeparateImageFs(
        node(50, {
          latestImageFsCapacityBytes: null,
          latestImageFsAvailableBytes: null,
        }),
      ),
    ).toBe(false);
    expect(
      hasKubernetesSeparateImageFs(
        node(50, { latestImageFsCapacityBytes: "0" }),
      ),
    ).toBe(false);
    expect(
      hasKubernetesSeparateImageFs(
        node(50, { latestImageFsCapacityBytes: "1099511627776" }),
      ),
    ).toBe(true);

    expect(getKubernetesNodeRootDiskThresholds(node(50))).toBe(
      KUBERNETES_IMAGE_DISK_USAGE_THRESHOLDS,
    );
    expect(
      getKubernetesNodeRootDiskThresholds(
        node(50, { latestImageFsCapacityBytes: 100 * GIB }),
      ),
    ).toBe(KUBERNETES_STORAGE_USAGE_THRESHOLDS);
  });

  test.each([
    [79, StorageUsageLevel.Normal, StorageUsageLevel.Normal],
    [80, StorageUsageLevel.Warning, StorageUsageLevel.Warning],
    [84, StorageUsageLevel.Warning, StorageUsageLevel.Warning],
    [85, StorageUsageLevel.Critical, StorageUsageLevel.Warning],
    [89, StorageUsageLevel.Critical, StorageUsageLevel.Warning],
    [90, StorageUsageLevel.Critical, StorageUsageLevel.Critical],
  ])(
    "a root filesystem %p%% used reads %p holding the images and %p holding none",
    (
      used: number,
      holdingImages: StorageUsageLevel,
      holdingNone: StorageUsageLevel,
    ) => {
      expect(getKubernetesNodeRootDiskUsage(node(used))?.level).toBe(
        holdingImages,
      );
      expect(
        getKubernetesNodeRootDiskUsage(
          node(used, {
            latestImageFsCapacityBytes: 100 * GIB,
            latestImageFsAvailableBytes: 50 * GIB,
          }),
        )?.level,
      ).toBe(holdingNone);
    },
  );

  test("a claim is still almost out of space at 90%, never at 85%", () => {
    expect(
      getKubernetesVolumeUsage({
        latestVolumeCapacityBytes: 100 * GIB,
        latestVolumeAvailableBytes: 15 * GIB,
      })?.level,
    ).toBe(StorageUsageLevel.Warning);
  });
});

describe("whether a node's images have a disk of their own", () => {
  const TB: number = 1024 * GIB;

  test("one scrape reads the same filesystem the same: no", () => {
    // As a KinD node's kubelet reported its root and image filesystems.
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 2129040207872,
        rootAvailableBytes: 308024541184,
        imageCapacityBytes: 2129040207872,
        imageAvailableBytes: 308024541184,
      }),
    ).toBe(false);
  });

  test("a different size: yes", () => {
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 100 * GIB,
        rootAvailableBytes: 50 * GIB,
        imageCapacityBytes: TB,
        imageAvailableBytes: 50 * GIB,
      }),
    ).toBe(true);
  });

  test("the same size but other room left, past a sliver: yes", () => {
    expect(KUBERNETES_IMAGE_FS_DIFFERENCE_SHARE).toBe(0.01);
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 100 * GIB,
        rootAvailableBytes: 50 * GIB,
        imageCapacityBytes: 100 * GIB,
        imageAvailableBytes: 48 * GIB,
      }),
    ).toBe(true);
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 100 * GIB,
        rootAvailableBytes: 50 * GIB,
        imageCapacityBytes: 100 * GIB,
        imageAvailableBytes: 49.5 * GIB,
      }),
    ).toBe(false);
  });

  test("a reading missing: nothing can be said", () => {
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 100 * GIB,
        rootAvailableBytes: null,
        imageCapacityBytes: 100 * GIB,
        imageAvailableBytes: 50 * GIB,
      }),
    ).toBeNull();
    expect(
      isSeparateKubernetesImageFs({
        rootCapacityBytes: 0,
        rootAvailableBytes: 0,
        imageCapacityBytes: 100 * GIB,
        imageAvailableBytes: 50 * GIB,
      }),
    ).toBeNull();
  });
});
