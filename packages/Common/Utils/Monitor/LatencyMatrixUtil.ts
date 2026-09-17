import LatencyMatrix, {
  LatencyMatrixAxisItem,
  LatencyMatrixCell,
} from "../../Types/Monitor/LatencyMatrix";
import { JSONObject } from "../../Types/JSON";

export interface LatencyMatrixMonitorInput {
  id: string;
  name: string;
}

export interface LatencyMatrixProbeInput {
  id: string;
  name: string;
}

export interface LatencyMatrixProbeResult {
  monitorId: string;
  probeId: string;
  /*
   * MonitorProbe.lastMonitoringLog: a map of monitorStepId -> the last
   * ProbeMonitorResponse for that step. The matrix uses the most recently
   * monitored step's response time and online state.
   */
  lastMonitoringLog?: JSONObject | undefined;
}

export default class LatencyMatrixUtil {
  /*
   * Shapes probe/monitor axes plus each monitor-probe pair's last-check
   * snapshot into a dense grid. Pure over its inputs so it's unit-testable
   * without a database.
   */
  public static buildMatrix(data: {
    monitors: Array<LatencyMatrixMonitorInput>;
    probes: Array<LatencyMatrixProbeInput>;
    results: Array<LatencyMatrixProbeResult>;
    now: Date;
  }): LatencyMatrix {
    const monitors: Array<LatencyMatrixAxisItem> = data.monitors.map(
      (monitor: LatencyMatrixMonitorInput) => {
        return { id: monitor.id, name: monitor.name };
      },
    );
    const probes: Array<LatencyMatrixAxisItem> = data.probes.map(
      (probe: LatencyMatrixProbeInput) => {
        return { id: probe.id, name: probe.name };
      },
    );

    const cells: Record<string, Record<string, LatencyMatrixCell>> = {};

    // Seed every cell as "no data" so the grid is dense.
    for (const monitor of monitors) {
      cells[monitor.id] = {};
      for (const probe of probes) {
        cells[monitor.id]![probe.id] = {
          monitorId: monitor.id,
          probeId: probe.id,
          hasData: false,
        };
      }
    }

    for (const result of data.results) {
      const row: Record<string, LatencyMatrixCell> | undefined =
        cells[result.monitorId];
      if (!row || !row[result.probeId]) {
        continue;
      }

      const latest: {
        latencyInMs?: number | undefined;
        isOnline?: boolean | undefined;
        monitoredAt?: Date | undefined;
      } | null = LatencyMatrixUtil.extractLatest(result.lastMonitoringLog);

      if (!latest) {
        continue;
      }

      const cell: LatencyMatrixCell = {
        monitorId: result.monitorId,
        probeId: result.probeId,
        hasData: true,
        latencyInMs: latest.latencyInMs,
        isOnline: latest.isOnline,
      };

      if (latest.monitoredAt) {
        cell.ageInSeconds = Math.max(
          0,
          Math.round(
            (data.now.getTime() - new Date(latest.monitoredAt).getTime()) /
              1000,
          ),
        );
      }

      row[result.probeId] = cell;
    }

    return { monitors, probes, cells };
  }

  /*
   * Picks the most-recently-monitored step from a lastMonitoringLog and
   * returns its latency / online / timestamp. Returns null when the log is
   * empty or malformed.
   */
  private static extractLatest(log: JSONObject | undefined): {
    latencyInMs?: number | undefined;
    isOnline?: boolean | undefined;
    monitoredAt?: Date | undefined;
  } | null {
    if (!log || typeof log !== "object") {
      return null;
    }

    let best: {
      latencyInMs?: number | undefined;
      isOnline?: boolean | undefined;
      monitoredAt?: Date | undefined;
    } | null = null;
    let bestTime: number = -Infinity;

    for (const stepId of Object.keys(log)) {
      const response: JSONObject | undefined = log[stepId] as
        | JSONObject
        | undefined;
      if (!response || typeof response !== "object") {
        continue;
      }

      const monitoredAtValue: unknown = response["monitoredAt"];
      const monitoredAt: Date | undefined = monitoredAtValue
        ? new Date(monitoredAtValue as string)
        : undefined;
      const time: number =
        monitoredAt && !isNaN(monitoredAt.getTime())
          ? monitoredAt.getTime()
          : 0;

      if (time >= bestTime) {
        bestTime = time;
        const latencyValue: unknown = response["responseTimeInMs"];
        const onlineValue: unknown = response["isOnline"];
        best = {
          latencyInMs:
            typeof latencyValue === "number" ? latencyValue : undefined,
          isOnline: typeof onlineValue === "boolean" ? onlineValue : undefined,
          monitoredAt:
            monitoredAt && !isNaN(monitoredAt.getTime())
              ? monitoredAt
              : undefined,
        };
      }
    }

    return best;
  }
}
