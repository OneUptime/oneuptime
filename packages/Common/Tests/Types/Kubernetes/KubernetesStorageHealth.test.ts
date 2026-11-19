import {
  KUBERNETES_IMAGE_FS_DIFFERENCE_SHARE,
  KUBERNETES_STORAGE_READING_FRESH_MS,
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
          values: { percent: "80%", free: "20 GiB" },
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
      values: { percent: "97%", free: "1.5 GiB" },
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
        values: { percent: "85%", free: "15 GiB" },
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

  test("its root filesystem nearly full reads Disk nearly full", () => {
    expect(assessKubernetesNodeStorage(node(85), clock)).toEqual({
      level: StorageUsageLevel.Warning,
      status: { text: "Disk nearly full" },
      reasons: [
        {
          text: "Disk {{percent}} used, {{free}} free",
          values: { percent: "85%", free: "15 GiB" },
        },
      ],
    });
  });

  test("at the kubelet's eviction line (90% used) reads Disk almost full", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesNodeStorage(node(90), clock);
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.status).toEqual({ text: "Disk almost full" });
  });

  test("an image disk of its own counts at the same lines, the fullest first", () => {
    const verdict: KubernetesStorageVerdict | null =
      assessKubernetesNodeStorage(
        node(82, {
          latestImageFsCapacityBytes: 500 * GIB,
          latestImageFsAvailableBytes: 20 * GIB,
        }),
        clock,
      );
    expect(verdict?.level).toBe(StorageUsageLevel.Critical);
    expect(verdict?.reasons).toEqual([
      {
        text: "Image disk {{percent}} used, {{free}} free",
        values: { percent: "96%", free: "20 GiB" },
      },
      {
        text: "Disk {{percent}} used, {{free}} free",
        values: { percent: "82%", free: "18 GiB" },
      },
    ]);
  });

  test("an image disk alone can make the node nearly full", () => {
    expect(
      assessKubernetesNodeStorage(
        node(20, {
          latestImageFsCapacityBytes: 100 * GIB,
          latestImageFsAvailableBytes: 15 * GIB,
        }),
        clock,
      )?.status,
    ).toEqual({ text: "Disk nearly full" });
  });

  test("room on both, or a stale reading: no verdict", () => {
    expect(assessKubernetesNodeStorage(node(60), clock)).toBeNull();
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
