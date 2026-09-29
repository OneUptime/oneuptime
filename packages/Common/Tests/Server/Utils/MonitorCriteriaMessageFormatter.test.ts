import MonitorCriteriaMessageFormatter from "../../../Server/Utils/Monitor/MonitorCriteriaMessageFormatter";
import { BasicDiskMetrics } from "../../../Types/Infrastructure/BasicMetrics";
import { ServerProcess } from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorCriteriaMessageFormatter builds the human-readable snippets that go
 * into monitor alert/incident messages. Every method here is pure and its
 * output is user-facing text, so these tests pin the exact formatting rules
 * (fraction-digit thresholds, byte scaling, truncation) that a copy-tweak
 * could quietly change.
 */

describe("MonitorCriteriaMessageFormatter.formatNumber", () => {
  test("returns null for null/undefined/NaN", () => {
    expect(MonitorCriteriaMessageFormatter.formatNumber(null)).toBeNull();
    expect(MonitorCriteriaMessageFormatter.formatNumber(undefined)).toBeNull();
    expect(MonitorCriteriaMessageFormatter.formatNumber(NaN)).toBeNull();
  });

  test("uses 2 fraction digits for magnitude < 10", () => {
    expect(MonitorCriteriaMessageFormatter.formatNumber(3.14159)).toBe("3.14");
  });

  test("uses 1 fraction digit for magnitude between 10 and 100", () => {
    expect(MonitorCriteriaMessageFormatter.formatNumber(42.789)).toBe("42.8");
  });

  test("uses 0 fraction digits for magnitude >= 100", () => {
    expect(MonitorCriteriaMessageFormatter.formatNumber(1234.9)).toBe("1235");
  });

  test("respects an explicit maximumFractionDigits override", () => {
    expect(
      MonitorCriteriaMessageFormatter.formatNumber(3.14159, {
        maximumFractionDigits: 4,
      }),
    ).toBe("3.1416");
  });

  test("applies the magnitude buckets to negative numbers too", () => {
    expect(MonitorCriteriaMessageFormatter.formatNumber(-5.5)).toBe("-5.50");
    expect(MonitorCriteriaMessageFormatter.formatNumber(-250.4)).toBe("-250");
  });
});

describe("MonitorCriteriaMessageFormatter.formatPercentage", () => {
  test("appends a percent sign with 1 decimal below 100", () => {
    expect(MonitorCriteriaMessageFormatter.formatPercentage(87.654)).toBe(
      "87.7%",
    );
  });

  test("uses 0 decimals at/above 100", () => {
    expect(MonitorCriteriaMessageFormatter.formatPercentage(100)).toBe("100%");
  });

  test("returns null for null input", () => {
    expect(MonitorCriteriaMessageFormatter.formatPercentage(null)).toBeNull();
  });
});

describe("MonitorCriteriaMessageFormatter.formatBytes", () => {
  test("keeps small values in bytes", () => {
    expect(MonitorCriteriaMessageFormatter.formatBytes(512)).toBe("512 B");
  });

  test("scales to KB (values < 10 keep 2 decimals)", () => {
    expect(MonitorCriteriaMessageFormatter.formatBytes(1536)).toBe("1.50 KB");
  });

  test("scales to MB", () => {
    expect(MonitorCriteriaMessageFormatter.formatBytes(5 * 1024 * 1024)).toBe(
      "5.00 MB",
    );
  });

  test("scales to GB with proper precision", () => {
    expect(
      MonitorCriteriaMessageFormatter.formatBytes(2.5 * 1024 * 1024 * 1024),
    ).toBe("2.50 GB");
  });

  test("large scaled values >= 100 drop the decimals", () => {
    // 512 GB -> value 512 in-unit, which is >= 100 so 0 fraction digits.
    expect(
      MonitorCriteriaMessageFormatter.formatBytes(512 * 1024 * 1024 * 1024),
    ).toBe("512 GB");
  });

  test("returns null for null/NaN", () => {
    expect(MonitorCriteriaMessageFormatter.formatBytes(null)).toBeNull();
    expect(MonitorCriteriaMessageFormatter.formatBytes(NaN)).toBeNull();
  });

  test("handles zero bytes", () => {
    expect(MonitorCriteriaMessageFormatter.formatBytes(0)).toBe("0.00 B");
  });
});

describe("MonitorCriteriaMessageFormatter.formatList", () => {
  test("returns empty string for an empty list", () => {
    expect(MonitorCriteriaMessageFormatter.formatList([])).toBe("");
  });

  test("joins items under the cap with commas", () => {
    expect(MonitorCriteriaMessageFormatter.formatList(["a", "b", "c"])).toBe(
      "a, b, c",
    );
  });

  test("truncates with a +N more suffix past the cap", () => {
    const result: string = MonitorCriteriaMessageFormatter.formatList(
      ["a", "b", "c", "d", "e", "f", "g"],
      3,
    );
    expect(result).toContain("a, b, c");
    expect(result).toContain("+4 more");
  });
});

describe("MonitorCriteriaMessageFormatter.formatSnippet", () => {
  test("collapses whitespace runs into single spaces", () => {
    expect(
      MonitorCriteriaMessageFormatter.formatSnippet("hello   \n\t  world"),
    ).toBe("hello world");
  });

  test("truncates with an ellipsis past maxLength", () => {
    const result: string = MonitorCriteriaMessageFormatter.formatSnippet(
      "abcdefghij",
      5,
    );
    expect(result).toBe("abcde…");
  });

  test("leaves short text untouched", () => {
    expect(MonitorCriteriaMessageFormatter.formatSnippet("short", 100)).toBe(
      "short",
    );
  });
});

describe("MonitorCriteriaMessageFormatter.describeProcesses", () => {
  test("returns null for no processes", () => {
    expect(MonitorCriteriaMessageFormatter.describeProcesses([])).toBeNull();
  });

  test("summarizes processes as name (pid N)", () => {
    const processes: Array<ServerProcess> = [
      { pid: 100, name: "node", command: "node index.js" },
      { pid: 200, name: "nginx", command: "nginx" },
    ];
    const result: string | null =
      MonitorCriteriaMessageFormatter.describeProcesses(processes);
    expect(result).toContain("node (pid 100)");
    expect(result).toContain("nginx (pid 200)");
  });
});

describe("MonitorCriteriaMessageFormatter.computeDiskUsagePercent", () => {
  const baseDisk: BasicDiskMetrics = {
    total: 0,
    free: 0,
    used: 0,
    diskPath: "/",
    percentUsed: NaN,
    percentFree: NaN,
  };

  test("returns null for a missing disk metric", () => {
    expect(
      MonitorCriteriaMessageFormatter.computeDiskUsagePercent(
        undefined as unknown as BasicDiskMetrics,
      ),
    ).toBeNull();
  });

  test("prefers percentUsed when present", () => {
    expect(
      MonitorCriteriaMessageFormatter.computeDiskUsagePercent({
        ...baseDisk,
        percentUsed: 73,
      }),
    ).toBe(73);
  });

  test("derives from percentFree when percentUsed is absent", () => {
    expect(
      MonitorCriteriaMessageFormatter.computeDiskUsagePercent({
        ...baseDisk,
        percentUsed: NaN,
        percentFree: 40,
      }),
    ).toBe(60);
  });

  test("falls back to used/total ratio", () => {
    expect(
      MonitorCriteriaMessageFormatter.computeDiskUsagePercent({
        ...baseDisk,
        percentUsed: NaN,
        percentFree: NaN,
        total: 200,
        used: 50,
      }),
    ).toBe(25);
  });

  test("returns null when nothing usable is present", () => {
    expect(
      MonitorCriteriaMessageFormatter.computeDiskUsagePercent({
        ...baseDisk,
      }),
    ).toBeNull();
  });
});

describe("MonitorCriteriaMessageFormatter.summarizeNumericSeries", () => {
  test("returns null for an empty series", () => {
    expect(
      MonitorCriteriaMessageFormatter.summarizeNumericSeries([]),
    ).toBeNull();
  });

  test("single value reports latest and one data point", () => {
    const result: string | null =
      MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.06], "sec");
    expect(result).toBe("latest 0.06 sec across 1 data point");
  });

  test("multi value reports latest, min, max and count", () => {
    const result: string | null =
      MonitorCriteriaMessageFormatter.summarizeNumericSeries(
        [10, 5, 20, 15],
        "ms",
      );
    expect(result).toContain("latest 15.00 ms");
    expect(result).toContain("min 5.00 ms");
    expect(result).toContain("max 20.00 ms");
    expect(result).toContain("across 4 data points");
  });

  test("omits the unit suffix when no unit is given", () => {
    const result: string | null =
      MonitorCriteriaMessageFormatter.summarizeNumericSeries([1, 2]);
    expect(result).toContain("latest 2.00 (min 1.00, max 2.00)");
    expect(result).not.toContain("undefined");
  });
});

describe("MonitorCriteriaMessageFormatter.formatResultValue", () => {
  test("returns the string 'undefined' for null/undefined", () => {
    expect(MonitorCriteriaMessageFormatter.formatResultValue(null)).toBe(
      "undefined",
    );
    expect(MonitorCriteriaMessageFormatter.formatResultValue(undefined)).toBe(
      "undefined",
    );
  });

  test("JSON-stringifies objects", () => {
    expect(
      MonitorCriteriaMessageFormatter.formatResultValue({ a: 1, b: "x" }),
    ).toBe('{"a":1,"b":"x"}');
  });

  test("returns [object] for a value that cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(MonitorCriteriaMessageFormatter.formatResultValue(circular)).toBe(
      "[object]",
    );
  });

  test("stringifies primitives via toString", () => {
    expect(MonitorCriteriaMessageFormatter.formatResultValue(42)).toBe("42");
    expect(MonitorCriteriaMessageFormatter.formatResultValue(true)).toBe(
      "true",
    );
  });
});
