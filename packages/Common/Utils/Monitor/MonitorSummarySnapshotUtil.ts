import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ExceptionMonitorResponse from "../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import IncomingEmailMonitorRequest from "../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import IncomingMonitorRequest from "../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import LogMonitorResponse from "../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorEvaluationSummary from "../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
  MonitorSummaryTelemetrySnapshot,
} from "../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import ProfileMonitorResponse from "../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import ServerMonitorResponse from "../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import SyntheticMonitorResponse from "../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import TraceMonitorResponse from "../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ProbeMonitorResponse from "../../Types/Probe/ProbeMonitorResponse";

/*
 * Builds and reads the frozen "Monitor Summary" stored on an incident or
 * an alert (see Common/Types/Monitor/MonitorSummarySnapshot).
 *
 * Deliberately pure and free of database / React imports: the monitor
 * evaluation pipeline calls buildSnapshot on the server, and the incident
 * and alert pages call toSummaryInfoProps in the browser. Keeping the
 * per-monitor-type routing in one tested place is what stops the two ends
 * from disagreeing about where a Ping check lives in the payload.
 */

/*
 * Mirrors Common/Server/Utils/Monitor/DataToProcess, which cannot be
 * imported here - it is server-side and this module is bundled into the
 * dashboard. Kept structurally identical so a mismatch is a compile error
 * at the call site rather than a silent `any`.
 */
export type MonitorSummaryDataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | IncomingEmailMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse
  | ProfileMonitorResponse;

/*
 * The props the dashboard's SummaryInfo component takes. Declared here
 * (rather than imported from App) so the mapping can be unit-tested
 * without pulling React in.
 */
export interface MonitorSummaryInfoProps {
  monitorType: MonitorType;
  probeName?: string | undefined;
  probeMonitorResponses?: Array<ProbeMonitorResponse> | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
  incomingEmailMonitorRequest?: IncomingEmailMonitorRequest | undefined;
  incomingEmailMonitorHeartbeatCheckedAt?: Date | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
  /*
   * Structurally identical to App/.../SummaryView/Types/TelemetryMonitorSummary,
   * which lives in App and so cannot be imported here.
   */
  telemetryMonitorSummary?:
    | { lastCheckedAt?: Date | undefined; nextCheckAt?: Date | undefined }
    | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}

/*
 * Synthetic monitors carry base64 screenshots, one per browser × screen
 * size, and a single check can run to several megabytes. createdStateLog
 * already stores them unbounded; this column will not. Past the budget we
 * drop the screenshots (the largest thing by far) and flag it, so the row
 * stays a sane size and the view can say why the images are missing.
 */
export const MonitorSummarySnapshotMaxSizeInBytes: number = 1024 * 1024;

/*
 * How much of an oversized response body to keep. The head is where an
 * error page's title and message live, which is what a summary is for.
 */
export const MonitorSummaryResponseBodyMaxLengthInChars: number = 64 * 1024;

export default class MonitorSummarySnapshotUtil {
  /*
   * Capture the summary for a monitor evaluation that just opened an
   * incident or an alert. Returns null when there is nothing worth
   * storing - a Manual monitor (which has no summary card at all) or an
   * evaluation with no data and no criteria results behind it.
   */
  public static buildSnapshot(data: {
    monitorType: MonitorType;
    dataToProcess?: MonitorSummaryDataToProcess | undefined;
    monitorId?: string | undefined;
    monitorName?: string | undefined;
    probeName?: string | undefined;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    capturedAt: Date;
    maxSizeInBytes?: number | undefined;
  }): MonitorSummarySnapshot | null {
    if (!data.monitorType) {
      return null;
    }

    /*
     * Manual monitors never evaluate anything, and Summary.tsx renders
     * nothing for them. Storing an empty shell would only put an empty
     * card on the incident page.
     */
    if (MonitorTypeHelper.isManualMonitor(data.monitorType)) {
      return null;
    }

    const snapshot: MonitorSummarySnapshot = {
      version: MonitorSummarySnapshotVersion,
      source: MonitorSummarySnapshotSource.Captured,
      monitorType: data.monitorType,
      capturedAt: data.capturedAt,
    };

    if (data.monitorId) {
      snapshot.monitorId = data.monitorId;
    }

    if (data.monitorName) {
      snapshot.monitorName = data.monitorName;
    }

    if (data.probeName) {
      snapshot.probeName = data.probeName;
    }

    this.attachResponse({
      snapshot,
      monitorType: data.monitorType,
      dataToProcess: data.dataToProcess,
      capturedAt: data.capturedAt,
    });

    /*
     * The criteria evaluation is the "why". Prefer the one handed in by
     * the pipeline (it is the live object the incident was decided from)
     * and fall back to the copy the response carries.
     */
    const evaluationSummary: MonitorEvaluationSummary | undefined =
      data.evaluationSummary ||
      (data.dataToProcess as ProbeMonitorResponse | undefined)
        ?.evaluationSummary;

    if (evaluationSummary) {
      snapshot.evaluationSummary = evaluationSummary;
    }

    if (!this.hasAnyContent(snapshot)) {
      return null;
    }

    return this.enforceSizeBudget({
      snapshot,
      maxSizeInBytes:
        data.maxSizeInBytes ?? MonitorSummarySnapshotMaxSizeInBytes,
    });
  }

  /*
   * Route the evaluated payload into the one slot its monitor type reads
   * from. monitorType is authoritative - it is the monitor's own column,
   * not something inferred from the payload - but each branch still
   * sanity-checks the shape so a mismatched payload (a cron re-evaluation
   * handing a telemetry response to a probeable monitor, say) is dropped
   * instead of rendering as a broken check.
   */
  private static attachResponse(data: {
    snapshot: MonitorSummarySnapshot;
    monitorType: MonitorType;
    dataToProcess?: MonitorSummaryDataToProcess | undefined;
    capturedAt: Date;
  }): void {
    const { snapshot, monitorType, dataToProcess } = data;

    if (MonitorTypeHelper.isTelemetryMonitor(monitorType)) {
      snapshot.telemetryMonitorSummary = this.buildTelemetrySummary({
        monitorType,
        dataToProcess,
        capturedAt: data.capturedAt,
      });
      return;
    }

    if (monitorType === MonitorType.Server) {
      if (this.isServerMonitorResponse(dataToProcess)) {
        snapshot.serverMonitorResponse = dataToProcess as ServerMonitorResponse;
      }
      return;
    }

    if (monitorType === MonitorType.IncomingRequest) {
      if (this.isIncomingMonitorRequest(dataToProcess)) {
        snapshot.incomingMonitorRequest =
          dataToProcess as IncomingMonitorRequest;
      }
      return;
    }

    if (monitorType === MonitorType.IncomingEmail) {
      if (this.isIncomingEmailMonitorRequest(dataToProcess)) {
        snapshot.incomingEmailMonitorRequest =
          dataToProcess as IncomingEmailMonitorRequest;
      }
      return;
    }

    /*
     * Everything else is served by a probe check: every probeable type,
     * plus Network Device, whose SNMP walk and trap results arrive as a
     * ProbeMonitorResponse even though the type is not "probeable" (its
     * schedule belongs to the device, not to a MonitorProbe row).
     */
    if (this.isProbeMonitorResponse(dataToProcess)) {
      const probeMonitorResponse: ProbeMonitorResponse =
        dataToProcess as ProbeMonitorResponse;

      snapshot.probeMonitorResponse = probeMonitorResponse;

      if (probeMonitorResponse.probeId) {
        snapshot.probeId = probeMonitorResponse.probeId.toString();
      }
    }
  }

  private static buildTelemetrySummary(data: {
    monitorType: MonitorType;
    dataToProcess?: MonitorSummaryDataToProcess | undefined;
    capturedAt: Date;
  }): MonitorSummaryTelemetrySnapshot {
    const summary: MonitorSummaryTelemetrySnapshot = {
      monitoredAt: data.capturedAt,
    };

    const payload: JSONObject = (data.dataToProcess || {}) as JSONObject;

    /*
     * The count the criteria was evaluated against. Metric monitors have
     * no single count (they aggregate a series), so they get the
     * evaluation log alone - which is where their numbers already live.
     */
    const counts: Array<{ key: string; title: string }> = [
      { key: "logCount", title: "Log Records" },
      { key: "securityEventCount", title: "Security Events" },
      { key: "spanCount", title: "Spans" },
      { key: "exceptionCount", title: "Exceptions" },
      { key: "profileCount", title: "Profiles" },
    ];

    for (const count of counts) {
      if (typeof payload[count.key] === "number") {
        summary.observedCount = payload[count.key] as number;
        summary.observedCountTitle = count.title;
        break;
      }
    }

    return summary;
  }

  /*
   * A snapshot with nothing but its own type stamp helps nobody - the
   * card would render an empty "no summary available" box on an incident
   * that plainly had a cause. Storing null instead lets the read path
   * fall back to the legacy createdStateLog reconstruction.
   */
  private static hasAnyContent(snapshot: MonitorSummarySnapshot): boolean {
    return Boolean(
      snapshot.probeMonitorResponse ||
        snapshot.serverMonitorResponse ||
        snapshot.incomingMonitorRequest ||
        snapshot.incomingEmailMonitorRequest ||
        snapshot.telemetryMonitorSummary ||
        snapshot.evaluationSummary,
    );
  }

  /*
   * Keep the stored jsonb bounded. Only synthetic / custom-code checks
   * can realistically blow the budget, and only because of their base64
   * screenshots, so that is the one thing we drop. Everything else - the
   * script logs, the captured metrics, the evaluation log - is small and
   * is exactly what someone reading an old incident needs.
   */
  private static enforceSizeBudget(data: {
    snapshot: MonitorSummarySnapshot;
    maxSizeInBytes: number;
  }): MonitorSummarySnapshot {
    const { snapshot, maxSizeInBytes } = data;

    if (maxSizeInBytes <= 0) {
      return snapshot;
    }

    if (this.getApproximateSizeInBytes(snapshot) <= maxSizeInBytes) {
      return snapshot;
    }

    const syntheticResponses: Array<SyntheticMonitorResponse> | undefined =
      snapshot.probeMonitorResponse?.syntheticMonitorResponse;

    if (syntheticResponses && syntheticResponses.length > 0) {
      snapshot.probeMonitorResponse = {
        ...(snapshot.probeMonitorResponse as ProbeMonitorResponse),
        syntheticMonitorResponse: syntheticResponses.map(
          (response: SyntheticMonitorResponse): SyntheticMonitorResponse => {
            const withoutScreenshots: SyntheticMonitorResponse = {
              ...response,
            };
            delete withoutScreenshots.screenshots;
            return withoutScreenshots;
          },
        ),
      };

      snapshot.areScreenshotsOmitted = true;

      if (this.getApproximateSizeInBytes(snapshot) <= maxSizeInBytes) {
        return snapshot;
      }
    }

    /*
     * Second largest payload after screenshots: the response body of a
     * Website / API check against a big HTML page. Keep the head of it -
     * that is where the error page's title and message are - and say it
     * was cut.
     */
    const responseBody: string | JSONObject | undefined =
      snapshot.probeMonitorResponse?.responseBody;

    if (
      typeof responseBody === "string" &&
      responseBody.length > MonitorSummaryResponseBodyMaxLengthInChars
    ) {
      snapshot.probeMonitorResponse = {
        ...(snapshot.probeMonitorResponse as ProbeMonitorResponse),
        responseBody: responseBody.slice(
          0,
          MonitorSummaryResponseBodyMaxLengthInChars,
        ),
      };

      snapshot.isResponseBodyTruncated = true;
    }

    /*
     * Still over budget with nothing safe left to shed. Keep it: an
     * oversized-but-complete summary is still better than none, and jsonb
     * tolerates it.
     */
    return snapshot;
  }

  private static getApproximateSizeInBytes(
    snapshot: MonitorSummarySnapshot,
  ): number {
    try {
      return JSON.stringify(snapshot).length;
    } catch {
      /*
       * A payload we cannot stringify cannot be stored either. Report it
       * as infinitely large so the caller sheds what it can; the write
       * itself is guarded by serialize() below.
       */
      return Number.MAX_SAFE_INTEGER;
    }
  }

  /*
   * Encode for the jsonb column. Dates and ObjectIDs inside the payload
   * are wrapped by JSONFunctions so they come back as the same types on
   * read, the way telemetryQuery already round-trips.
   */
  public static serialize(
    snapshot: MonitorSummarySnapshot | null | undefined,
  ): JSONObject | null {
    if (!snapshot) {
      return null;
    }

    return JSONFunctions.serialize(snapshot as unknown as JSONObject);
  }

  /*
   * Read a stored snapshot back. Returns null for anything this build
   * does not understand rather than rendering a half-decoded card.
   */
  public static deserialize(
    stored: JSONObject | null | undefined,
  ): MonitorSummarySnapshot | null {
    if (!stored || typeof stored !== "object") {
      return null;
    }

    const snapshot: MonitorSummarySnapshot = JSONFunctions.deserialize(
      stored,
    ) as unknown as MonitorSummarySnapshot;

    if (!snapshot || !snapshot.monitorType) {
      return null;
    }

    if (snapshot.version !== MonitorSummarySnapshotVersion) {
      return null;
    }

    return snapshot;
  }

  /*
   * Best-effort reconstruction for incidents and alerts created before
   * this column existed. createdStateLog is the same evaluated payload,
   * just untyped and without the monitor type - which the caller supplies
   * from the monitor the incident is attached to.
   *
   * It cannot recover the probe name (never stored) and it is only as
   * good as the monitor's type *today*, so a monitor whose type changed
   * gets nothing useful. That is why new rows carry a real snapshot; this
   * is purely so existing incidents are not blank.
   */
  public static fromLegacyCreatedStateLog(data: {
    createdStateLog?: JSONObject | null | undefined;
    monitorType?: MonitorType | undefined;
    monitorId?: string | undefined;
    monitorName?: string | undefined;
    capturedAt?: Date | undefined;
  }): MonitorSummarySnapshot | null {
    if (!data.monitorType || !data.createdStateLog) {
      return null;
    }

    if (typeof data.createdStateLog !== "object") {
      return null;
    }

    /*
     * createdStateLog was written with a plain JSON.stringify, so its
     * dates are ISO strings and its ObjectIDs are already flattened.
     * deserialize() restores whatever JSONFunctions can recognise and
     * leaves the rest as-is, which the views render fine.
     */
    const dataToProcess: MonitorSummaryDataToProcess =
      JSONFunctions.deserialize(
        data.createdStateLog,
      ) as unknown as MonitorSummaryDataToProcess;

    const snapshot: MonitorSummarySnapshot | null = this.buildSnapshot({
      monitorType: data.monitorType,
      dataToProcess: dataToProcess,
      monitorId: data.monitorId,
      monitorName: data.monitorName,
      capturedAt: data.capturedAt || new Date(),
    });

    if (!snapshot) {
      return null;
    }

    snapshot.source = MonitorSummarySnapshotSource.Legacy;

    return snapshot;
  }

  /*
   * Map a snapshot onto the props the dashboard's SummaryInfo component
   * already takes, so the incident and alert pages render the exact same
   * per-monitor-type views as the monitor page. Every monitor type goes
   * through here, telemetry included - one render path means a new leaf
   * view added to SummaryInfo shows up on incidents for free.
   */
  public static toSummaryInfoProps(
    snapshot: MonitorSummarySnapshot,
  ): MonitorSummaryInfoProps {
    const props: MonitorSummaryInfoProps = {
      monitorType: snapshot.monitorType,
    };

    if (snapshot.probeName) {
      props.probeName = snapshot.probeName;
    }

    if (snapshot.probeMonitorResponse) {
      props.probeMonitorResponses = [snapshot.probeMonitorResponse];
    }

    if (snapshot.serverMonitorResponse) {
      props.serverMonitorResponse = snapshot.serverMonitorResponse;
    }

    if (snapshot.incomingMonitorRequest) {
      props.incomingMonitorRequest = snapshot.incomingMonitorRequest;
      /*
       * The live card shows the monitor's current heartbeat time. On a
       * capture the equivalent is when this very request was checked.
       */
      props.incomingRequestMonitorHeartbeatCheckedAt =
        snapshot.incomingMonitorRequest.checkedAt;
    }

    if (snapshot.incomingEmailMonitorRequest) {
      props.incomingEmailMonitorRequest = snapshot.incomingEmailMonitorRequest;
      props.incomingEmailMonitorHeartbeatCheckedAt =
        snapshot.incomingEmailMonitorRequest.checkedAt;
    }

    if (snapshot.telemetryMonitorSummary) {
      /*
       * Only "monitored at". The live card's companion field is "next
       * check at", which has no meaning on a frozen capture, and
       * TelemetryMonitorView already renders "-" for a missing one.
       */
      props.telemetryMonitorSummary = {
        lastCheckedAt: snapshot.telemetryMonitorSummary.monitoredAt,
      };
    }

    if (snapshot.evaluationSummary) {
      props.evaluationSummary = snapshot.evaluationSummary;
    }

    return props;
  }

  /*
   * Does this snapshot have anything to put on screen? A capture whose
   * payload was dropped (a shape mismatch, a monitor with no check data)
   * still carries the evaluation log, which is worth showing on its own.
   */
  public static hasRenderableContent(
    snapshot: MonitorSummarySnapshot | null | undefined,
  ): boolean {
    if (!snapshot) {
      return false;
    }

    return this.hasAnyContent(snapshot);
  }

  private static isProbeMonitorResponse(
    data: MonitorSummaryDataToProcess | undefined,
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    /*
     * monitorStepId is the field only a probe check has - every probe
     * response is scoped to the monitor step it ran.
     */
    return Boolean((data as ProbeMonitorResponse).monitorStepId);
  }

  private static isServerMonitorResponse(
    data: MonitorSummaryDataToProcess | undefined,
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    return Boolean((data as ServerMonitorResponse).requestReceivedAt);
  }

  private static isIncomingMonitorRequest(
    data: MonitorSummaryDataToProcess | undefined,
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    return Boolean((data as IncomingMonitorRequest).incomingRequestReceivedAt);
  }

  private static isIncomingEmailMonitorRequest(
    data: MonitorSummaryDataToProcess | undefined,
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    return Boolean((data as IncomingEmailMonitorRequest).emailReceivedAt);
  }
}
