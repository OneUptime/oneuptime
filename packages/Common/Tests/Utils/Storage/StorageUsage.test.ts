import {
  DEFAULT_STORAGE_USAGE_THRESHOLDS,
  StorageUsage,
  StorageUsageLevel,
  formatStorageBytes,
  formatStorageCount,
  formatStorageUsedPercent,
  getStorageUsage,
  getStorageUsageLevel,
  getStorageUsedPercentFigure,
  readStorageNumber,
} from "../../../Utils/Storage/StorageUsage";
import { describe, expect, test } from "@jest/globals";

const GIB: number = 1024 * 1024 * 1024;

describe("getStorageUsage", () => {
  test("reads used as everything that is not available, as df does", () => {
    const usage: StorageUsage | null = getStorageUsage({
      capacity: 50 * GIB,
      available: 14 * GIB,
    });

    expect(usage).toEqual({
      capacity: 50 * GIB,
      used: 36 * GIB,
      free: 14 * GIB,
      usedPercent: 72,
      level: StorageUsageLevel.Normal,
    });
  });

  test("takes what is used when the store reports no available", () => {
    const usage: StorageUsage | null = getStorageUsage({
      capacity: 1000,
      used: 850,
    });

    expect(usage?.used).toBe(850);
    expect(usage?.free).toBe(150);
    expect(usage?.usedPercent).toBe(85);
    expect(usage?.level).toBe(StorageUsageLevel.Warning);
  });

  test("believes available over used when a store reports both", () => {
    // Reserved blocks: used + available can be less than capacity.
    const usage: StorageUsage | null = getStorageUsage({
      capacity: 100,
      available: 5,
      used: 80,
    });

    expect(usage?.used).toBe(95);
    expect(usage?.free).toBe(5);
    expect(usage?.level).toBe(StorageUsageLevel.Critical);
  });

  test("reads the strings a bigint column arrives as", () => {
    const usage: StorageUsage | null = getStorageUsage({
      capacity: "53687091200",
      available: "5368709120",
    });

    expect(usage?.capacity).toBe(53687091200);
    expect(usage?.free).toBe(5368709120);
    expect(usage?.usedPercent).toBeCloseTo(90, 10);
  });

  test.each([
    ["no capacity", { capacity: null, available: 10 }],
    ["an empty capacity", { capacity: "", available: 10 }],
    ["a zero capacity", { capacity: 0, available: 0 }],
    ["a negative capacity", { capacity: -5, available: 1 }],
    ["a capacity that is not a number", { capacity: "lots", available: 1 }],
    ["neither available nor used", { capacity: 100 }],
    ["an available that is not a number", { capacity: 100, available: "x" }],
  ])(
    "is null for %s, so a page says nothing was reported",
    (_: string, input: any) => {
      expect(getStorageUsage(input)).toBeNull();
    },
  );

  test("never reads more free than the capacity, or less than none", () => {
    expect(getStorageUsage({ capacity: 100, available: 150 })).toMatchObject({
      used: 0,
      free: 100,
      usedPercent: 0,
    });
    expect(getStorageUsage({ capacity: 100, available: -3 })).toMatchObject({
      used: 100,
      free: 0,
      usedPercent: 100,
      level: StorageUsageLevel.Critical,
    });
  });

  test("never reads more used than the capacity holds (thin provisioning)", () => {
    expect(getStorageUsage({ capacity: 100, used: 140 })).toMatchObject({
      used: 100,
      free: 0,
      usedPercent: 100,
    });
    expect(getStorageUsage({ capacity: 100, used: -1 })).toMatchObject({
      used: 0,
      free: 100,
    });
  });

  test("takes a page's own lines", () => {
    // Ceph's nearfull is 85%.
    const usage: StorageUsage | null = getStorageUsage(
      { capacity: 100, used: 82 },
      { warningPercent: 85, criticalPercent: 95 },
    );

    expect(usage?.level).toBe(StorageUsageLevel.Normal);
  });
});

describe("getStorageUsageLevel", () => {
  test("turns nearly full at 80% and almost out of space at 90% by default", () => {
    expect(DEFAULT_STORAGE_USAGE_THRESHOLDS).toEqual({
      warningPercent: 80,
      criticalPercent: 90,
    });
    expect(getStorageUsageLevel(0)).toBe(StorageUsageLevel.Normal);
    expect(getStorageUsageLevel(79.99)).toBe(StorageUsageLevel.Normal);
    expect(getStorageUsageLevel(80)).toBe(StorageUsageLevel.Warning);
    expect(getStorageUsageLevel(89.99)).toBe(StorageUsageLevel.Warning);
    expect(getStorageUsageLevel(90)).toBe(StorageUsageLevel.Critical);
    expect(getStorageUsageLevel(100)).toBe(StorageUsageLevel.Critical);
  });
});

describe("a page whose lines are crossed only past them", () => {
  test("turns at a value past the line, never at it, as Ceph's ratios do", () => {
    const ceph: {
      warningPercent: number;
      criticalPercent: number;
      isPastLineOnly: boolean;
    } = {
      warningPercent: 85,
      criticalPercent: 95,
      isPastLineOnly: true,
    };

    expect(getStorageUsageLevel(85, ceph)).toBe(StorageUsageLevel.Normal);
    expect(getStorageUsageLevel(85.1, ceph)).toBe(StorageUsageLevel.Warning);
    expect(getStorageUsageLevel(95, ceph)).toBe(StorageUsageLevel.Warning);
    expect(getStorageUsageLevel(95.1, ceph)).toBe(StorageUsageLevel.Critical);
  });
});

describe("the used percent a page writes", () => {
  test("rounds down, so it changes level at exactly the figure written", () => {
    const nearlyCritical: StorageUsage = getStorageUsage({
      capacity: 1000,
      used: 899,
    })!;

    expect(getStorageUsedPercentFigure(nearlyCritical)).toBe(89);
    expect(nearlyCritical.level).toBe(StorageUsageLevel.Warning);

    const almostFull: StorageUsage = getStorageUsage({
      capacity: 1000,
      used: 999,
    })!;

    // Not "100%" while anything at all is left.
    expect(getStorageUsedPercentFigure(almostFull)).toBe(99);
    expect(formatStorageUsedPercent(almostFull, "en")).toBe("99%");
  });

  test("is written in the reader's digits and percent sign", () => {
    const usage: StorageUsage = getStorageUsage({ capacity: 100, used: 72 })!;

    expect(formatStorageUsedPercent(usage, "en")).toBe("72%");
    expect(formatStorageUsedPercent(usage, "de")).toBe("72\u00A0%");
    expect(formatStorageUsedPercent(usage, "fa")).toBe("۷۲٪");
  });
});

describe("formatStorageBytes", () => {
  test("writes binary units, as Kubernetes sizes a volume", () => {
    expect(formatStorageBytes(50 * GIB, "en")).toBe("50\u00A0GiB");
    expect(formatStorageBytes(36.2 * GIB, "en")).toBe("36.2\u00A0GiB");
    expect(formatStorageBytes(512 * GIB, "en")).toBe("512\u00A0GiB");
    expect(formatStorageBytes(1.5 * 1024 * GIB, "en")).toBe("1.5\u00A0TiB");
    expect(formatStorageBytes(5000 * GIB, "en")).toBe("4.9\u00A0TiB");
    expect(formatStorageBytes(1536, "en")).toBe("1.5\u00A0KiB");
    expect(formatStorageBytes(300 * 1024 * 1024, "en")).toBe("300\u00A0MiB");
  });

  test("writes a few bytes as bytes, and nothing as zero bytes", () => {
    expect(formatStorageBytes(0, "en")).toBe("0\u00A0B");
    expect(formatStorageBytes(999, "en")).toBe("999\u00A0B");
    expect(formatStorageBytes(-20, "en")).toBe("0\u00A0B");
    expect(formatStorageBytes(Number.NaN, "en")).toBe("0\u00A0B");
  });

  test("moves up a unit rather than writing 1024 of the one below", () => {
    expect(formatStorageBytes(1024 * 1024 - 10, "en")).toBe("1\u00A0MiB");
  });

  test("keeps its number and its unit on one line", () => {
    expect(formatStorageBytes(36.2 * GIB, "en")).not.toContain(" ");
  });

  test("writes the number in the reader's digits, the unit as written", () => {
    expect(formatStorageBytes(36.2 * GIB, "de")).toBe("36,2\u00A0GiB");
    expect(formatStorageBytes(36.2 * GIB, "fa")).toBe("۳۶٫۲\u00A0GiB");
  });
});

describe("formatStorageCount", () => {
  test("writes inodes compactly, keeping the scale letter", () => {
    expect(formatStorageCount(512, "en")).toBe("512");
    expect(formatStorageCount(830000, "en")).toBe("830K");
    expect(formatStorageCount(3276800, "en")).toBe("3.3M");
    expect(formatStorageCount(12_500_000_000, "en")).toBe("12.5B");
    expect(formatStorageCount(-1, "en")).toBe("0");
  });

  test("writes the number in the reader's digits", () => {
    expect(formatStorageCount(3276800, "de")).toBe("3,3M");
  });
});

describe("readStorageNumber", () => {
  test("reads numbers and numeric strings, and nothing else", () => {
    expect(readStorageNumber(5)).toBe(5);
    expect(readStorageNumber("5")).toBe(5);
    expect(readStorageNumber("")).toBeNull();
    expect(readStorageNumber(null)).toBeNull();
    expect(readStorageNumber(undefined)).toBeNull();
    expect(readStorageNumber("five")).toBeNull();
    expect(readStorageNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
