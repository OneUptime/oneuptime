import LatencyMatrixUtil from "../../../Utils/Monitor/LatencyMatrixUtil";
import LatencyMatrix, {
  LatencyMatrixCell,
} from "../../../Types/Monitor/LatencyMatrix";

describe("LatencyMatrixUtil.buildMatrix", () => {
  const now: Date = new Date("2026-07-11T12:00:00Z");

  it("builds a dense grid seeded with no-data cells", () => {
    const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
      monitors: [{ id: "m1", name: "Ping A" }],
      probes: [
        { id: "p1", name: "US East" },
        { id: "p2", name: "EU West" },
      ],
      results: [],
      now,
    });

    expect(matrix.monitors).toHaveLength(1);
    expect(matrix.probes).toHaveLength(2);
    expect(matrix.cells["m1"]!["p1"]!.hasData).toBe(false);
    expect(matrix.cells["m1"]!["p2"]!.hasData).toBe(false);
  });

  it("fills latency, online state, and age from the latest step", () => {
    const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
      monitors: [{ id: "m1", name: "Ping A" }],
      probes: [{ id: "p1", name: "US East" }],
      results: [
        {
          monitorId: "m1",
          probeId: "p1",
          lastMonitoringLog: {
            step1: {
              responseTimeInMs: 42,
              isOnline: true,
              monitoredAt: "2026-07-11T11:59:00Z",
            },
          },
        },
      ],
      now,
    });

    const cell: LatencyMatrixCell = matrix.cells["m1"]!["p1"]!;
    expect(cell.hasData).toBe(true);
    expect(cell.latencyInMs).toBe(42);
    expect(cell.isOnline).toBe(true);
    expect(cell.ageInSeconds).toBe(60);
  });

  it("picks the most recently monitored step across multiple steps", () => {
    const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
      monitors: [{ id: "m1", name: "Ping A" }],
      probes: [{ id: "p1", name: "US East" }],
      results: [
        {
          monitorId: "m1",
          probeId: "p1",
          lastMonitoringLog: {
            older: {
              responseTimeInMs: 100,
              isOnline: true,
              monitoredAt: "2026-07-11T10:00:00Z",
            },
            newer: {
              responseTimeInMs: 25,
              isOnline: true,
              monitoredAt: "2026-07-11T11:59:30Z",
            },
          },
        },
      ],
      now,
    });

    expect(matrix.cells["m1"]!["p1"]!.latencyInMs).toBe(25);
  });

  it("ignores results for unknown monitor/probe pairs", () => {
    const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
      monitors: [{ id: "m1", name: "Ping A" }],
      probes: [{ id: "p1", name: "US East" }],
      results: [
        {
          monitorId: "ghost",
          probeId: "p1",
          lastMonitoringLog: {
            step1: { responseTimeInMs: 5, monitoredAt: now.toISOString() },
          },
        },
      ],
      now,
    });

    expect(matrix.cells["m1"]!["p1"]!.hasData).toBe(false);
    expect(matrix.cells["ghost"]).toBeUndefined();
  });

  it("treats an empty log as no data", () => {
    const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
      monitors: [{ id: "m1", name: "Ping A" }],
      probes: [{ id: "p1", name: "US East" }],
      results: [{ monitorId: "m1", probeId: "p1", lastMonitoringLog: {} }],
      now,
    });

    expect(matrix.cells["m1"]!["p1"]!.hasData).toBe(false);
  });
});
