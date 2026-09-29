import ProbeMonitorResponse from "../Probe/ProbeMonitorResponse";
import IncomingEmailMonitorRequest from "./IncomingEmailMonitor/IncomingEmailMonitorRequest";
import IncomingMonitorRequest from "./IncomingMonitor/IncomingMonitorRequest";
import MonitorEvaluationSummary from "./MonitorEvaluationSummary";
import MonitorType from "./MonitorType";
import ServerMonitorResponse from "./ServerMonitor/ServerMonitorResponse";

/*
 * A frozen copy of the "Monitor Summary" card, taken at the moment a
 * monitor's criteria opened an incident or an alert.
 *
 * The monitor page renders that card from live data - the probe's last
 * monitoring log, the server agent's last push, the monitor's incoming
 * request. All of that ages out (MonitorLog rows have a ClickHouse
 * retention, MonitorProbe.lastMonitoringLog is overwritten on the next
 * check), so an incident opened last quarter has no way to show what the
 * monitor actually saw. Storing the snapshot on the incident/alert row is
 * what makes "why did this fire?" answerable after the evidence is gone.
 *
 * Everything here must survive a JSON round-trip through a jsonb column,
 * so it holds only plain data - no database models, no class instances
 * beyond the ones JSONFunctions.serialize already knows how to encode.
 */

/*
 * Telemetry monitors (logs / metrics / traces / exceptions / profiles and
 * the infrastructure types built on them) have no per-probe check log to
 * capture. What they do have is the moment of evaluation and the count
 * the criteria was evaluated against, which is the useful half of the
 * live card plus the number that actually tripped it.
 */
export interface MonitorSummaryTelemetrySnapshot {
  monitoredAt?: Date | undefined;
  // e.g. 412 log records, 3 spans, 7 exceptions. Undefined for metric monitors.
  observedCount?: number | undefined;
  // What observedCount counts: "Logs", "Spans", "Exceptions", "Profiles".
  observedCountTitle?: string | undefined;
}

export enum MonitorSummarySnapshotSource {
  // Captured at incident/alert creation by the monitor evaluation pipeline.
  Captured = "Captured",
  /*
   * Reconstructed on read from the incident's createdStateLog, for rows
   * created before the snapshot column existed. Best-effort: it has no
   * probe name and no monitor name, because those were never in the log.
   */
  Legacy = "Legacy",
}

export const MonitorSummarySnapshotVersion: number = 1;

export default interface MonitorSummarySnapshot {
  /*
   * Bumped when the shape changes incompatibly. Readers that do not
   * understand a version render nothing rather than guessing.
   */
  version: number;
  source: MonitorSummarySnapshotSource;
  monitorType: MonitorType;
  monitorId?: string | undefined;
  monitorName?: string | undefined;
  capturedAt?: Date | undefined;

  // Which probe produced the check below. Probeable monitor types only.
  probeId?: string | undefined;
  probeName?: string | undefined;

  // Exactly one of these is set, chosen by monitorType.
  probeMonitorResponse?: ProbeMonitorResponse | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  incomingEmailMonitorRequest?: IncomingEmailMonitorRequest | undefined;
  telemetryMonitorSummary?: MonitorSummaryTelemetrySnapshot | undefined;

  // The criteria evaluation that decided to open this incident / alert.
  evaluationSummary?: MonitorEvaluationSummary | undefined;

  /*
   * Set when the synthetic-monitor screenshots were stripped to keep the
   * stored row within MonitorSummarySnapshotUtil's size budget. The view
   * says so rather than silently showing a check with no screenshots.
   */
  areScreenshotsOmitted?: boolean | undefined;

  // Same idea for an oversized Website / API response body.
  isResponseBodyTruncated?: boolean | undefined;
}
