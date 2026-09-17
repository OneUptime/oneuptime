import { Green, Red, Yellow } from "../../../Types/BrandColors";
import {
  getSloMonitorStatusSummary,
  SloMonitorStatusInput,
  SloMonitorStatusRow,
  SloMonitorStatusSegment,
  SloMonitorStatusSummary,
  SloMonitorStatusTone,
} from "../../../Utils/Slo/SloMonitorStatusSummary";
import { describe, expect, test } from "@jest/globals";

type MonitorFunction = (
  id: string,
  overrides: Partial<SloMonitorStatusInput>,
) => SloMonitorStatusInput;

const operational: MonitorFunction = (
  id: string,
  overrides: Partial<SloMonitorStatusInput>,
): SloMonitorStatusInput => {
  return {
    id: id,
    name: id,
    statusName: "Operational",
    statusColor: Green,
    isOperationalState: true,
    isOfflineState: false,
    statusPriority: 1,
    isMonitoringPaused: false,
    ...overrides,
  };
};

const offline: MonitorFunction = (
  id: string,
  overrides: Partial<SloMonitorStatusInput>,
): SloMonitorStatusInput => {
  return operational(id, {
    statusName: "Offline",
    statusColor: Red,
    isOperationalState: false,
    isOfflineState: true,
    statusPriority: 3,
    ...overrides,
  });
};

const degraded: MonitorFunction = (
  id: string,
  overrides: Partial<SloMonitorStatusInput>,
): SloMonitorStatusInput => {
  return operational(id, {
    statusName: "Degraded",
    statusColor: Yellow,
    isOperationalState: false,
    isOfflineState: false,
    statusPriority: 2,
    ...overrides,
  });
};

type LabelsFunction = (summary: SloMonitorStatusSummary) => Array<string>;

const rowNames: LabelsFunction = (
  summary: SloMonitorStatusSummary,
): Array<string> => {
  return summary.rows.map((row: SloMonitorStatusRow) => {
    return row.name;
  });
};

const segmentLabels: LabelsFunction = (
  summary: SloMonitorStatusSummary,
): Array<string> => {
  return summary.segments.map((segment: SloMonitorStatusSegment) => {
    return `${segment.label}:${segment.count}`;
  });
};

describe("getSloMonitorStatusSummary", () => {
  test("an empty SLO has nothing to summarise", () => {
    expect(getSloMonitorStatusSummary([])).toEqual({
      total: 0,
      needsAttentionCount: 0,
      pausedCount: 0,
      segments: [],
      rows: [],
    });
  });

  const mixed: SloMonitorStatusSummary = getSloMonitorStatusSummary([
    operational("api", {}),
    offline("checkout", {}),
    degraded("search", {}),
    // Monitoring disabled while its last status says Offline.
    offline("batch", { isMonitoringPaused: true }),
    operational("web", { statusName: null, statusColor: null }),
    operational("auth", {}),
  ]);

  test("counts what needs attention, leaving paused monitors out", () => {
    expect(mixed.total).toBe(6);
    expect(mixed.needsAttentionCount).toBe(3);
    expect(mixed.pausedCount).toBe(1);
  });

  test("orders rows most urgent first, operational last, by name within a tone", () => {
    expect(rowNames(mixed)).toEqual([
      "checkout",
      "search",
      "web",
      "batch",
      "api",
      "auth",
    ]);
  });

  test("a paused monitor reads Paused, not its stale last status", () => {
    const batch: SloMonitorStatusRow = mixed.rows.find(
      (row: SloMonitorStatusRow) => {
        return row.name === "batch";
      },
    )!;

    expect(batch.tone).toBe(SloMonitorStatusTone.Paused);
    expect(batch.statusLabel).toBe("Paused");
  });

  test("a monitor with no status reads Unknown", () => {
    const web: SloMonitorStatusRow = mixed.rows.find(
      (row: SloMonitorStatusRow) => {
        return row.name === "web";
      },
    )!;

    expect(web.tone).toBe(SloMonitorStatusTone.Unknown);
    expect(web.statusLabel).toBe("Unknown");
  });

  test("the bar runs healthy first, then worsening, then unmeasured", () => {
    expect(segmentLabels(mixed)).toEqual([
      "Operational:2",
      "Degraded:1",
      "Offline:1",
      "Unknown:1",
      "Paused:1",
    ]);
  });

  test("every row keeps its own status colour", () => {
    expect(
      mixed.rows.find((row: SloMonitorStatusRow) => {
        return row.name === "checkout";
      })!.statusColor,
    ).toBe(Red);
  });

  test("groups by status semantics, not by a hardcoded name", () => {
    const summary: SloMonitorStatusSummary = getSloMonitorStatusSummary([
      operational("a", { statusName: "Up" }),
      offline("b", { statusName: "Hard down" }),
      degraded("c", { statusName: "Slow", statusPriority: 5 }),
      degraded("d", { statusName: "Maintenance", statusPriority: 4 }),
      degraded("e", { statusName: "Slow", statusPriority: 5 }),
    ]);

    expect(
      summary.segments.map((segment: SloMonitorStatusSegment) => {
        return [segment.tone, segment.label, segment.count];
      }),
    ).toEqual([
      [SloMonitorStatusTone.Operational, "Up", 1],
      // Same tone: ordered by the project's status priority.
      [SloMonitorStatusTone.Degraded, "Maintenance", 1],
      [SloMonitorStatusTone.Degraded, "Slow", 2],
      [SloMonitorStatusTone.Offline, "Hard down", 1],
    ]);

    // Within degraded rows the lower priority number comes first.
    expect(rowNames(summary)).toEqual(["b", "d", "c", "e", "a"]);
  });

  test("paused and unknown monitors each collapse into one segment", () => {
    const summary: SloMonitorStatusSummary = getSloMonitorStatusSummary([
      offline("a", { isMonitoringPaused: true }),
      operational("b", { isMonitoringPaused: true }),
      operational("c", { statusName: undefined }),
      offline("d", { statusName: "" }),
    ]);

    expect(segmentLabels(summary)).toEqual(["Unknown:2", "Paused:2"]);
    expect(summary.needsAttentionCount).toBe(2);
    expect(summary.pausedCount).toBe(2);
  });

  test("does not reorder the caller's array", () => {
    const input: Array<SloMonitorStatusInput> = [
      operational("z", {}),
      offline("a", {}),
    ];

    getSloMonitorStatusSummary(input);

    expect(
      input.map((monitor: SloMonitorStatusInput) => {
        return monitor.id;
      }),
    ).toEqual(["z", "a"]);
  });
});
