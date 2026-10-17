import { JSONObject } from "../JSON";

/*
 * Step configuration for Probe Status monitors: which probes the monitor
 * watches. Everything about a probe itself - its name, its key, who owns it
 * - stays on the probe, under Monitors > Settings > Probes. The monitor is
 * the alerting layer only: it reads each probe's connection status every
 * minute and its criteria decide what a disconnected probe means.
 *
 * A monitor may watch the probes of its own project and the global probes,
 * the same probes its other monitors can run on. Writes are held to that by
 * MonitorStepsProjectValidator, and the evaluator reads no other probe, so a
 * probe id from another project tells this one nothing.
 */
export default interface MonitorStepProbeStatusMonitor {
  probeIds: Array<string>;
}

export class MonitorStepProbeStatusMonitorUtil {
  public static getDefault(): MonitorStepProbeStatusMonitor {
    return {
      probeIds: [],
    };
  }

  /*
   * Each probe once, in the order first given. Ids are compared without
   * regard to case - Postgres renders them in lower case and a caller may
   * send upper - and kept as first written. Anything that is not a non-empty
   * string is left out rather than failing the parse: the validator decides
   * what a write may name, and a stored step must always read back.
   */
  public static normalizeProbeIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const probeIds: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }

      const probeId: string = item.trim();

      if (!probeId) {
        continue;
      }

      const key: string = probeId.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      probeIds.push(probeId);
    }

    return probeIds;
  }

  public static fromJSON(json: JSONObject): MonitorStepProbeStatusMonitor {
    return {
      probeIds: MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
        json["probeIds"],
      ),
    };
  }

  public static toJSON(monitor: MonitorStepProbeStatusMonitor): JSONObject {
    return {
      probeIds: MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
        monitor.probeIds,
      ),
    };
  }
}
