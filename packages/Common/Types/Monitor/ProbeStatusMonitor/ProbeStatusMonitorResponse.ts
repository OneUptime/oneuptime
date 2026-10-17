import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import ObjectID from "../../ObjectID";

// One probe a Probe Status monitor watches, as one evaluation found it.
export interface ProbeStatusMonitorProbe {
  probeId: string;
  // Plain text, as the probe's owner named it. Escaped wherever it is shown.
  probeName: string;
  isGlobalProbe: boolean;
  /*
   * The probe's Connection Status, which Probe:UpdateConnectionStatus sets:
   * Connected while OneUptime heard from the probe in the last three minutes,
   * and never turned Disconnected for OneUptime's own downtime. A probe no
   * tick has stamped yet counts as Disconnected - the dashboard shows it that
   * way too.
   */
  isConnected: boolean;
  // When OneUptime last heard from the probe. Unset if it never has.
  lastAliveAt?: Date | undefined;
}

/*
 * What a Probe Status monitor's criteria judge: the probes one of its steps
 * watches, as the project may see them, and the two counts its checks
 * (Connected Probes, Disconnected Probes) compare.
 *
 * Deliberately not a ProbeMonitorResponse: that is what a probe sends back
 * about a check it ran, and the sinks that read one (the response time,
 * online and status code series) would take this for a probe's check. No
 * probe runs a Probe Status monitor.
 */
export default interface ProbeStatusMonitorResponse {
  projectId: ObjectID;
  monitorId: ObjectID;
  monitorStepId: ObjectID;
  // In the step's order.
  probes: Array<ProbeStatusMonitorProbe>;
  connectedProbeCount: number;
  disconnectedProbeCount: number;
  /*
   * Probes the step names that are not counted: deleted since, or not a
   * probe this project may watch. A probe that is gone is not reported as
   * disconnected - nobody can reconnect it - and it is not counted as
   * connected either.
   */
  missingProbeIds: Array<string>;
  checkedAt: Date;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
