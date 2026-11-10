import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import MonitorSummarySnapshot from "../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import TelemetryObservation, {
  TelemetryObservationKind,
} from "../../Types/Monitor/TelemetryObservation";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
  MonitorSummaryInfoProps,
} from "./MonitorSummarySnapshotUtil";

export enum IncomingEmailLogEntryKind {
  Email = "Email",
  ScheduledCheck = "ScheduledCheck",
}

/*
 * What an Incoming Email monitor's Monitoring Logs row was: an email, with
 * its subject and sender ("" when the email had none), or the worker's
 * scheduled check for missing email.
 */
export interface IncomingEmailLogEntry {
  kind: IncomingEmailLogEntryKind;
  subject: string;
  from: string;
}

// The Email column's words, shared by the cell, the CSV export and the docs.
export const INCOMING_EMAIL_SCHEDULED_CHECK_LABEL: string = "Scheduled check";
export const INCOMING_EMAIL_NO_SUBJECT_LABEL: string = "(no subject)";

/*
 * The count each telemetry signal's check stores, by the monitor's type.
 * Read by type rather than by whichever count a body happens to carry: a
 * row written before the monitor's type was changed is another type's
 * check, and says nothing about this one.
 */
const TELEMETRY_COUNT_BY_MONITOR_TYPE: ReadonlyMap<
  MonitorType,
  { key: string; kind: TelemetryObservationKind }
> = new Map<MonitorType, { key: string; kind: TelemetryObservationKind }>([
  [MonitorType.Logs, { key: "logCount", kind: TelemetryObservationKind.Logs }],
  [
    MonitorType.Traces,
    { key: "spanCount", kind: TelemetryObservationKind.Spans },
  ],
  [
    MonitorType.Exceptions,
    { key: "exceptionCount", kind: TelemetryObservationKind.Exceptions },
  ],
  [
    MonitorType.Profiles,
    { key: "profileCount", kind: TelemetryObservationKind.Profiles },
  ],
  [
    MonitorType.SecurityEvents,
    {
      key: "securityEventCount",
      kind: TelemetryObservationKind.SecurityEvents,
    },
  ],
  [
    MonitorType.Llm,
    { key: "llmBadAnswerCount", kind: TelemetryObservationKind.BadAiAnswers },
  ],
]);

/*
 * The "View Summary" modal on a monitor's Monitoring Logs page.
 *
 * A MonitorLog row's logBody is the payload one evaluation ran on: the same
 * DataToProcess an incident captures as its monitor summary, written with a
 * plain JSON round trip (MonitorLogUtil.saveMonitorLog). So the modal routes
 * it through MonitorSummarySnapshotUtil instead of keeping a table of its
 * own. The page used to hand the body to every SummaryInfo slot except the
 * email one, and every row of an Incoming Email monitor read "no email has
 * been received yet" - one routing table for incidents, alerts and logs is
 * what stops a monitor type from going missing in one of them.
 *
 * Pure, like the snapshot util, so it is tested without React.
 */
export default class MonitorLogSummaryUtil {
  public static toSummaryInfoProps(data: {
    monitorType: MonitorType;
    logBody: JSONObject | null | undefined;
    /*
     * The row's time. Telemetry monitors show it as "Monitored At"; a
     * payload of theirs carries no time of its own.
     */
    monitoredAt?: Date | undefined;
    // Only a probe check has one.
    probeName?: string | undefined;
  }): MonitorSummaryInfoProps {
    const typeOnly: MonitorSummaryInfoProps = {
      monitorType: data.monitorType,
    };

    if (
      !data.logBody ||
      typeof data.logBody !== "object" ||
      Array.isArray(data.logBody)
    ) {
      return typeOnly;
    }

    /*
     * The ObjectIDs in a stored body are wrapped by their toJSON, and its
     * dates are ISO strings. deserialize() restores what JSONFunctions
     * recognises and leaves the rest as it is, which the views render.
     */
    const dataToProcess: MonitorSummaryDataToProcess =
      JSONFunctions.deserialize(
        data.logBody,
      ) as unknown as MonitorSummaryDataToProcess;

    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: data.monitorType,
        dataToProcess: dataToProcess,
        probeName: data.probeName,
        /*
         * Only a telemetry summary reads this, and it is dropped below when
         * the row has no time.
         */
        capturedAt: data.monitoredAt || new Date(),
        /*
         * The size budget bounds what an incident stores. A log row is
         * already stored, and the modal shows all of it: a synthetic check
         * keeps its screenshots.
         */
        maxSizeInBytes: 0,
      });

    if (!snapshot) {
      return typeOnly;
    }

    const props: MonitorSummaryInfoProps =
      MonitorSummarySnapshotUtil.toSummaryInfoProps(snapshot);

    if (!data.monitoredAt && props.telemetryMonitorSummary) {
      // Better "-" than the moment the modal was opened.
      delete props.telemetryMonitorSummary;
    }

    if (props.telemetryMonitorSummary) {
      /*
       * A row is one check that has run: no next check to wait for, and
       * what it saw beside when it ran - the same words as its Observed
       * column.
       */
      props.telemetryMonitorSummary.isPastCheck = true;

      const observation: TelemetryObservation | null =
        this.getTelemetryObservation({
          monitorType: data.monitorType,
          logBody: data.logBody,
        });

      if (observation) {
        props.telemetryMonitorSummary.observation = observation;
      }
    }

    return props;
  }

  /*
   * What a telemetry monitor's check saw (TelemetryObservation), read from
   * its Monitoring Logs row. Null for a monitor of any other type, and for a
   * body that does not hold what its type's check stores - an empty body, or
   * one written before the monitor's type was changed - which the page shows
   * as a dash, never as a count of 0.
   */
  public static getTelemetryObservation(data: {
    monitorType: MonitorType;
    logBody: JSONObject | null | undefined;
  }): TelemetryObservation | null {
    if (!MonitorTypeHelper.isTelemetryMonitor(data.monitorType)) {
      return null;
    }

    const logBody: JSONObject | null | undefined = data.logBody;

    if (!logBody || typeof logBody !== "object" || Array.isArray(logBody)) {
      return null;
    }

    if (MonitorTypeHelper.isMetricBackedMonitor(data.monitorType)) {
      return this.getMetricObservation(logBody);
    }

    const counted: { key: string; kind: TelemetryObservationKind } | undefined =
      TELEMETRY_COUNT_BY_MONITOR_TYPE.get(data.monitorType);

    if (!counted) {
      return null;
    }

    const count: number | null = this.toCount(logBody[counted.key]);

    if (count === null) {
      return null;
    }

    return { kind: counted.kind, count: count };
  }

  /*
   * A metric-backed check stores what its queries read: metricResult, one
   * result per query and formula, and on a grouped monitor seriesBreakdown,
   * one entry per series. A grouped monitor also seeds a series for each
   * host or device that stopped reporting, with no data; those are not
   * counted, so "3 series" is the series that reported.
   */
  private static getMetricObservation(
    logBody: JSONObject,
  ): TelemetryObservation | null {
    const metricResult: unknown = logBody["metricResult"];
    const seriesBreakdown: unknown = logBody["seriesBreakdown"];

    if (!Array.isArray(metricResult) && !Array.isArray(seriesBreakdown)) {
      return null;
    }

    if (Array.isArray(seriesBreakdown) && seriesBreakdown.length > 0) {
      const seriesWithData: number = seriesBreakdown.filter(
        (series: unknown): boolean => {
          if (!series || typeof series !== "object") {
            return false;
          }

          return (
            this.countDataPoints((series as JSONObject)["aggregatedResults"]) >
            0
          );
        },
      ).length;

      if (seriesWithData > 0) {
        return {
          kind: TelemetryObservationKind.MetricSeries,
          count: seriesWithData,
        };
      }
    }

    const dataPoints: number = this.countDataPoints(metricResult);

    if (dataPoints > 0) {
      return {
        kind: TelemetryObservationKind.MetricDataPoints,
        count: dataPoints,
      };
    }

    return { kind: TelemetryObservationKind.NoMetricData, count: 0 };
  }

  // The data points in a list of AggregatedResults: each one's `data`.
  private static countDataPoints(results: unknown): number {
    if (!Array.isArray(results)) {
      return 0;
    }

    let count: number = 0;

    for (const result of results) {
      if (!result || typeof result !== "object") {
        continue;
      }

      const points: unknown = (result as JSONObject)["data"];

      if (Array.isArray(points)) {
        count += points.length;
      }
    }

    return count;
  }

  // A stored count: a whole number of at least 0, or nothing.
  private static toCount(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }

    return Math.floor(value);
  }

  /*
   * The Email column of an Incoming Email monitor's Monitoring Logs: which
   * email a row evaluated, so a reader can find one - a sender's
   * verification email, say - without opening every row.
   *
   * The worker's scheduled "has an email arrived lately?" check
   * (Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus) writes a row too,
   * every 30 seconds while a criteria checks Email Received, and it carries a
   * copy of the last email. Read by subject alone, each of those rows would
   * look like that email arriving again, so a check is named as one.
   *
   * Null for a row with no incoming email payload at all: an empty body, or
   * one written before the monitor's type was changed.
   */
  public static getIncomingEmailLogEntry(
    logBody: JSONObject | null | undefined,
  ): IncomingEmailLogEntry | null {
    if (!logBody || typeof logBody !== "object" || Array.isArray(logBody)) {
      return null;
    }

    if (logBody["onlyCheckForIncomingEmailReceivedAt"] === true) {
      return {
        kind: IncomingEmailLogEntryKind.ScheduledCheck,
        subject: "",
        from: "",
      };
    }

    // processIncomingEmailFromQueue stamps every email with its arrival.
    if (!logBody["emailReceivedAt"]) {
      return null;
    }

    const subject: unknown = logBody["emailSubject"];
    const from: unknown = logBody["emailFrom"];

    return {
      kind: IncomingEmailLogEntryKind.Email,
      subject: typeof subject === "string" ? subject.trim() : "",
      from: typeof from === "string" ? from.trim() : "",
    };
  }

  /*
   * The Email column as one line of text, for the table's CSV export - which
   * would otherwise write the whole logBody JSON the column is backed by.
   */
  public static formatIncomingEmailLogEntry(
    entry: IncomingEmailLogEntry | null,
  ): string {
    if (!entry) {
      return "";
    }

    if (entry.kind === IncomingEmailLogEntryKind.ScheduledCheck) {
      return INCOMING_EMAIL_SCHEDULED_CHECK_LABEL;
    }

    const subject: string = entry.subject || INCOMING_EMAIL_NO_SUBJECT_LABEL;

    return entry.from ? `${subject} <${entry.from}>` : subject;
  }

  /*
   * The id of the probe that ran the check, if the row names one, whatever
   * shape the body is in. It is stored, and sent over the wire, the way
   * ObjectID serialises itself: {"_type": "ObjectID", "value": "..."}. The
   * dashboard's HTTP client (HTTPResponse) deserialises that back into an
   * ObjectID, so that is what the Logs page sees; a body read any other way -
   * straight from the API, or from ClickHouse in a test - still holds the
   * envelope. Older fixtures use a plain string.
   */
  public static getProbeId(
    logBody: JSONObject | null | undefined,
  ): string | undefined {
    if (!logBody || typeof logBody !== "object") {
      return undefined;
    }

    const probeId: unknown = logBody["probeId"];

    if (typeof probeId === "string") {
      return probeId || undefined;
    }

    if (probeId instanceof ObjectID) {
      return probeId.toString() || undefined;
    }

    if (probeId && typeof probeId === "object") {
      const value: unknown = (probeId as JSONObject)["value"];

      if (typeof value === "string" && value) {
        return value;
      }
    }

    return undefined;
  }
}
