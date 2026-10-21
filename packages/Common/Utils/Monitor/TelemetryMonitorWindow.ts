import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorType from "../../Types/Monitor/MonitorType";
import RollingTime from "../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../Types/RollingTime/RollingTimeUtil";

// What a step saved without a window falls back to: the last minute.
export const DEFAULT_TELEMETRY_MONITOR_WINDOW_MS: number = 60_000;

/*
 * How far back a telemetry monitor's check looks - the window it judges each
 * time it runs. A check whose window holds time OneUptime was not receiving
 * waits until that time is behind it (ReceivingCoverage, issue #2825), so the
 * worker needs the window's length before it runs the check.
 *
 * Mirrors what each check actually reads: the log, trace, exception, profile
 * and security-event checks look back `lastXSeconds*` seconds, the metric and
 * infrastructure checks a rolling time. Anything missing or unreadable reads
 * as the defaults the checks themselves fall back to.
 */
export default class TelemetryMonitorWindow {
  public static getWindowInMs(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep | undefined;
  }): number {
    const step: MonitorStep["data"] | undefined = data.monitorStep?.data;

    switch (data.monitorType) {
      case MonitorType.Logs:
        return this.fromSeconds(step?.logMonitor?.lastXSecondsOfLogs);
      case MonitorType.Traces:
        return this.fromSeconds(step?.traceMonitor?.lastXSecondsOfSpans);
      case MonitorType.Exceptions:
        return this.fromSeconds(
          step?.exceptionMonitor?.lastXSecondsOfExceptions,
        );
      case MonitorType.Profiles:
        return this.fromSeconds(step?.profileMonitor?.lastXSecondsOfProfiles);
      case MonitorType.SecurityEvents:
        return this.fromSeconds(
          step?.securityEventsMonitor?.lastXSecondsOfEvents,
        );
      case MonitorType.Llm:
        return this.fromSeconds(step?.llmMonitor?.lastXSecondsOfCalls);
      case MonitorType.Metrics:
        return this.fromRollingTime(step?.metricMonitor?.rollingTime);
      case MonitorType.Kubernetes:
        return this.fromRollingTime(step?.kubernetesMonitor?.rollingTime);
      case MonitorType.Docker:
        return this.fromRollingTime(step?.dockerMonitor?.rollingTime);
      case MonitorType.Host:
        return this.fromRollingTime(step?.hostMonitor?.rollingTime);
      case MonitorType.Podman:
        return this.fromRollingTime(step?.podmanMonitor?.rollingTime);
      case MonitorType.Proxmox:
        return this.fromRollingTime(step?.proxmoxMonitor?.rollingTime);
      case MonitorType.VMware:
        return this.fromRollingTime(step?.vmwareMonitor?.rollingTime);
      case MonitorType.DockerSwarm:
        return this.fromRollingTime(step?.dockerSwarmMonitor?.rollingTime);
      case MonitorType.Ceph:
        return this.fromRollingTime(step?.cephMonitor?.rollingTime);
      case MonitorType.StorageArray:
        return this.fromRollingTime(step?.storageArrayMonitor?.rollingTime);
      case MonitorType.IoTDevice:
        return this.fromRollingTime(step?.iotMonitor?.rollingTime);
      default:
        return DEFAULT_TELEMETRY_MONITOR_WINDOW_MS;
    }
  }

  private static fromSeconds(seconds: number | undefined | null): number {
    const value: number = Number(seconds);

    return Number.isFinite(value) && value > 0
      ? value * 1000
      : DEFAULT_TELEMETRY_MONITOR_WINDOW_MS;
  }

  private static fromRollingTime(
    rollingTime: RollingTime | undefined | null,
  ): number {
    const windowInMs: number = RollingTimeUtil.getWindowInMs(
      rollingTime || RollingTime.Past1Minute,
    );

    return windowInMs > 0 ? windowInMs : DEFAULT_TELEMETRY_MONITOR_WINDOW_MS;
  }
}
