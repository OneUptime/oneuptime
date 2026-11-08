import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { toStorableJson } from "../Database/PostgresStorableValue";
import DataToProcess from "./DataToProcess";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";
import { redactForPersistence } from "./MonitorPayloadRedaction";

/*
 * WHAT AN INCIDENT OR AN ALERT KEEPS OF THE CHECK THAT OPENED IT.
 *
 * Three copies of a check land on an incident or an alert and on its state
 * timeline: the evaluation details, the monitor summary (the card the
 * monitor page shows, frozen), and the raw payload (createdStateLog, and the
 * state timeline's log). All three are read by everyone who can read the
 * record, and they outlive the monitor's own one-day log by as long as the
 * record lives. So all three are cut here, by the same rules:
 *
 *   - credential headers keep their name and lose their value - the raw
 *     payload exactly as the monitor's own log is redacted
 *     (MonitorPayloadRedaction.redactForPersistence), the summary by
 *     MonitorEvidenceRedaction's wider list;
 *   - the summary names the URL or host the step was configured with,
 *     {{monitorSecrets.*}} references as written, never the values the
 *     probe was handed and echoed back; a password or a secret query value
 *     in it is masked;
 *   - a monitor set not to keep response content (Monitor.keepResponseContent)
 *     keeps no response body, request body or excerpt on them at all.
 */

// The monitor types whose check carries a body this switch is about.
const RESPONSE_CONTENT_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.IncomingRequest,
];

export default class MonitorRecordEvidence {
  /*
   * Does the monitor keep the response content of the check that opened an
   * incident or an alert on it? Unless it was switched off - a monitor read
   * without the column keeps it, as every monitor did before the switch.
   */
  public static keepsResponseContent(monitor: Monitor | undefined): boolean {
    return monitor?.keepResponseContent !== false;
  }

  // The monitor types whose Settings page offers the switch.
  public static isResponseContentMonitorType(
    monitorType: MonitorType | undefined,
  ): boolean {
    return Boolean(
      monitorType && RESPONSE_CONTENT_MONITOR_TYPES.includes(monitorType),
    );
  }

  /*
   * The raw payload as an incident, an alert or a state timeline may keep
   * it: redacted as the monitor log is, without its bodies when the monitor
   * keeps no response content, and made storable for jsonb.
   */
  public static toStoredCheck(input: {
    dataToProcess: DataToProcess;
    keepResponseContent: boolean;
  }): JSONObject {
    const redacted: JSONObject = redactForPersistence(
      input.dataToProcess as unknown as JSONValue,
    ) as JSONObject;

    if (
      !input.keepResponseContent &&
      redacted &&
      typeof redacted === "object"
    ) {
      delete redacted["responseBody"];
      delete redacted["requestBody"];
    }

    return toStorableJson(redacted) as unknown as JSONObject;
  }

  /*
   * The monitor summary an incident or an alert keeps: a copy, so the
   * capture the creators share is never changed under them.
   */
  public static redactSnapshot(input: {
    snapshot: MonitorSummarySnapshot;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }): MonitorSummarySnapshot {
    const snapshot: MonitorSummarySnapshot = { ...input.snapshot };
    const keepResponseContent: boolean =
      MonitorRecordEvidence.keepsResponseContent(input.monitor);

    if (snapshot.probeMonitorResponse) {
      const probeResponse: ProbeMonitorResponse = {
        ...snapshot.probeMonitorResponse,
      };

      const headers: Dictionary<string> | undefined =
        MonitorEvidenceRedaction.redactHeaders(probeResponse.responseHeaders);

      if (headers) {
        probeResponse.responseHeaders = headers;
      }

      const destination: string | undefined =
        MonitorRecordEvidence.getStepDestination(input.monitorStep);

      if (destination) {
        probeResponse.monitorDestination = MonitorRecordEvidence.isUrlLike(
          destination,
        )
          ? (MonitorEvidenceRedaction.redactUrl(
              destination,
            ) as unknown as ProbeMonitorResponse["monitorDestination"])
          : (destination as unknown as ProbeMonitorResponse["monitorDestination"]);
      } else if (probeResponse.monitorDestination) {
        const echoed: string = MonitorRecordEvidence.toText(
          probeResponse.monitorDestination,
        );

        if (MonitorRecordEvidence.isUrlLike(echoed)) {
          probeResponse.monitorDestination = MonitorEvidenceRedaction.redactUrl(
            echoed,
          ) as unknown as ProbeMonitorResponse["monitorDestination"];
        }
      }

      if (!keepResponseContent && probeResponse.responseBody !== undefined) {
        delete probeResponse.responseBody;
        snapshot.isResponseContentOmitted = true;
        delete snapshot.isResponseBodyTruncated;
      }

      snapshot.probeMonitorResponse = probeResponse;
    }

    if (snapshot.incomingMonitorRequest) {
      const request: IncomingMonitorRequest = {
        ...snapshot.incomingMonitorRequest,
      };

      const headers: Dictionary<string> | undefined =
        MonitorEvidenceRedaction.redactHeaders(request.requestHeaders);

      if (headers) {
        request.requestHeaders = headers;
      }

      if (!keepResponseContent && request.requestBody !== undefined) {
        delete request.requestBody;
        snapshot.isResponseContentOmitted = true;
      }

      snapshot.incomingMonitorRequest = request;
    }

    return snapshot;
  }

  // The step's destination as it was configured: a URL, a host, an address.
  public static getStepDestination(
    monitorStep: MonitorStep | undefined,
  ): string | undefined {
    const text: string = MonitorRecordEvidence.toText(
      monitorStep?.data?.monitorDestination,
    );

    return text || undefined;
  }

  public static getStepPort(
    monitorStep: MonitorStep | undefined,
  ): number | undefined {
    const port: unknown = monitorStep?.data?.monitorDestinationPort;

    if (port === undefined || port === null) {
      return undefined;
    }

    const value: number = Number(MonitorRecordEvidence.toText(port));

    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  /*
   * A destination as text: a string, a number, a URL / Hostname / IP / Port
   * object, or the JSON envelope one is stored as.
   */
  public static toText(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "";
    }

    if (typeof value === "object") {
      const envelope: JSONObject = value as JSONObject;

      if (envelope["_type"] && typeof envelope["value"] === "string") {
        return (envelope["value"] as string).trim();
      }

      const text: string = String(value);

      return text === "[object Object]" ? "" : text.trim();
    }

    return "";
  }

  private static isUrlLike(text: string): boolean {
    return text.indexOf("://") !== -1;
  }
}
