import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { MonitorEvaluationDetailsLimits } from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { toStorableJson } from "../Database/PostgresStorableValue";
import DataToProcess from "./DataToProcess";
import JsonTextScanner, { JsonTextScan } from "./JsonTextScanner";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";
import { redactForPersistence } from "./MonitorPayloadRedaction";

/*
 * WHAT A MONITOR'S LOGS, AN INCIDENT AND AN ALERT KEEP OF A CHECK.
 *
 * A check is kept in several places, and everyone who can read the monitor
 * - Viewer included - can read each of them:
 *
 *   - the monitor's own logs: a row per check (MonitorLog.logBody), the log
 *     of each status change (MonitorStatusTimeline.statusChangeLog), a
 *     server's latest report (Monitor.serverMonitorResponse), and a probe's
 *     latest check as a reader gets it (MonitorProbe.lastMonitoringLog,
 *     see MonitorProbeService);
 *   - an incident or an alert: its evaluation details, the monitor summary
 *     (the card the monitor page shows, frozen) and the raw check
 *     (createdStateLog, and the state timeline's log).
 *
 * The evaluation details are cut by MonitorEvidenceRedaction's rules; every
 * other copy is cut here, by the same rules:
 *
 *   - headers keep their names; a header whose name says credential or
 *     personal data loses its value, any other is read for text that looks
 *     like one;
 *   - a body keeps its shape: a JSON body - parsed, or the JSON text an API
 *     monitor's response is kept as - loses the values of the fields whose
 *     names say credential or personal data, and every text in it - a text
 *     body whole - is read by the text rules: a bearer token, a JWT, a
 *     secret in key=value or JSON text, a provider's token, a private key, a
 *     URL's password, an email address, a card number. A script's result is
 *     read as a JSON body is;
 *   - every other text the check carries is read by the text rules too: a
 *     failure, a script's error and log lines, a process's command line, the
 *     evaluation's own sentences;
 *   - the destination is the URL or host the step was configured with,
 *     {{monitorSecrets.*}} references as written, never the values the probe
 *     was handed and echoed back; a password or a secret query value in it
 *     is masked;
 *   - a monitor set not to keep response content (Monitor.keepResponseContent)
 *     keeps no body and no headers of the response - or of the request, on
 *     an Incoming Request monitor - and the copy says it left them out
 *     (isResponseContentOmitted).
 *
 * Left as they are: screenshots, which no text rule can read, and an
 * incoming email - its addresses, subject, body and headers. Incoming Email
 * monitors are to get evidence and a content switch of their own
 * (https://github.com/OneUptime/oneuptime/issues/6343).
 *
 * Nothing that judges a check reads these copies: the evaluation runs on
 * the check as it arrived. The two copies that are judged again later are
 * kept as they came: a probe's latest check, for probe agreement, which
 * people get redacted (MonitorProbeService); and an Incoming Request
 * monitor's latest request, for its heartbeat, which people still read as
 * it came (https://github.com/OneUptime/oneuptime/issues/6402).
 */

// The monitor types whose check carries a body this switch is about.
const RESPONSE_CONTENT_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.IncomingRequest,
];

// The response's or the request's headers.
const HEADER_FIELDS: ReadonlyArray<string> = [
  "responseHeaders",
  "requestHeaders",
];

// The response's or the request's body.
const BODY_FIELDS: ReadonlyArray<string> = ["responseBody", "requestBody"];

// A Custom Code monitor's run, and each run of a Synthetic monitor.
const SCRIPT_RESPONSE_FIELDS: ReadonlyArray<string> = [
  "customCodeMonitorResponse",
  "syntheticMonitorResponse",
];

// What a script returned: read as a JSON body is.
const SCRIPT_RESULT_FIELD: string = "result";

// A Synthetic monitor's screenshots: images, which no text rule can read.
const SCREENSHOTS_FIELD: string = "screenshots";

/*
 * An Incoming Email monitor's email, kept as it came until its own evidence
 * rules land (see the note above).
 */
const INCOMING_EMAIL_FIELDS: ReadonlySet<string> = new Set<string>([
  "emailFrom",
  "emailTo",
  "emailSubject",
  "emailBody",
  "emailBodyHtml",
  "emailHeaders",
  "attachments",
]);

// The snapshot's checks, one of which is set (MonitorSummarySnapshot).
type SnapshotCheckKey =
  | "probeMonitorResponse"
  | "serverMonitorResponse"
  | "incomingMonitorRequest";

const SNAPSHOT_CHECK_KEYS: ReadonlyArray<SnapshotCheckKey> = [
  "probeMonitorResponse",
  "serverMonitorResponse",
  "incomingMonitorRequest",
];

// Deep enough for any real check, shallow enough to bound the walk.
const MAX_DEPTH: number = 12;

export interface RedactedCheck {
  check: JSONObject;
  // Its body and headers were left out: the monitor keeps no response content.
  isResponseContentOmitted: boolean;
}

export default class MonitorRecordEvidence {
  /*
   * Does the monitor keep the response content of its checks? Unless it was
   * switched off - a monitor read without the column keeps it, as every
   * monitor did before the switch.
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
   * A check as the monitor's logs keep it, and as an incident or an alert
   * keeps it raw: the credential names the logger knows masked wherever
   * they stand (MonitorPayloadRedaction.redactForPersistence), then the
   * evidence rules above. Never changes what it is handed - the evaluator
   * is still reading it - and says, on the copy, when it left the content
   * out.
   */
  public static redactCheck(input: {
    check: DataToProcess | JSONValue;
    keepResponseContent: boolean;
    // The step the check ran: its destination is the one shown.
    monitorStep?: MonitorStep | undefined;
  }): JSONObject {
    const structural: JSONValue = redactForPersistence(
      input.check as unknown as JSONValue,
    );

    const redacted: RedactedCheck = MonitorRecordEvidence.redactCheckContent({
      check: structural,
      keepResponseContent: input.keepResponseContent,
      monitorStep: input.monitorStep,
    });

    if (redacted.isResponseContentOmitted) {
      redacted.check["isResponseContentOmitted"] = true;
    }

    return redacted.check;
  }

  /*
   * A probe's latest check of each step (MonitorProbe.lastMonitoringLog,
   * keyed by step id) as a reader gets it: each cut as the monitor's logs
   * are, by its monitor's switch and its step's destination. A monitor that
   * could not be read keeps no response content: the switch is unknown.
   */
  public static redactLastChecks(input: {
    lastChecks: JSONObject;
    monitor: Monitor | undefined;
  }): JSONObject {
    const keepResponseContent: boolean = input.monitor
      ? MonitorRecordEvidence.keepsResponseContent(input.monitor)
      : false;

    const steps: Array<MonitorStep> =
      input.monitor?.monitorSteps?.data?.monitorStepsInstanceArray || [];

    const result: JSONObject = {};

    for (const stepId of Object.keys(input.lastChecks)) {
      result[stepId] = MonitorRecordEvidence.redactCheck({
        check: input.lastChecks[stepId] as JSONValue,
        keepResponseContent: keepResponseContent,
        monitorStep: steps.find((step: MonitorStep): boolean => {
          return step.id?.toString() === stepId;
        }),
      });
    }

    return result;
  }

  /*
   * The raw check as an incident, an alert or a state timeline may keep it:
   * redacted as the monitor's logs are, and made storable for jsonb.
   */
  public static toStoredCheck(input: {
    dataToProcess: DataToProcess;
    keepResponseContent: boolean;
    monitorStep?: MonitorStep | undefined;
  }): JSONObject {
    return toStorableJson(
      MonitorRecordEvidence.redactCheck({
        check: input.dataToProcess,
        keepResponseContent: input.keepResponseContent,
        monitorStep: input.monitorStep,
      }),
    ) as unknown as JSONObject;
  }

  /*
   * The monitor summary an incident or an alert keeps: a copy, so the
   * capture the creators share is never changed under them. Its check is
   * cut as the stored check is, without the logger's name walk: a summary
   * has always been read field by field, and that walk reads names such as
   * a DNSSEC signature's expiry as a credential.
   */
  public static redactSnapshot(input: {
    snapshot: MonitorSummarySnapshot;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }): MonitorSummarySnapshot {
    const snapshot: MonitorSummarySnapshot = { ...input.snapshot };
    const keepResponseContent: boolean =
      MonitorRecordEvidence.keepsResponseContent(input.monitor);

    let isResponseContentOmitted: boolean = false;

    for (const key of SNAPSHOT_CHECK_KEYS) {
      const check:
        | ProbeMonitorResponse
        | ServerMonitorResponse
        | IncomingMonitorRequest
        | undefined = snapshot[key];

      if (!check) {
        continue;
      }

      const redacted: RedactedCheck = MonitorRecordEvidence.redactCheckContent({
        check: check as unknown as JSONValue,
        keepResponseContent: keepResponseContent,
        monitorStep: input.monitorStep,
      });

      (snapshot as unknown as JSONObject)[key] = redacted.check;
      isResponseContentOmitted =
        isResponseContentOmitted || redacted.isResponseContentOmitted;
    }

    if (snapshot.evaluationSummary) {
      snapshot.evaluationSummary = MonitorRecordEvidence.redactTexts(
        snapshot.evaluationSummary as unknown as JSONValue,
        0,
      ) as unknown as MonitorSummarySnapshot["evaluationSummary"];
    }

    if (isResponseContentOmitted) {
      snapshot.isResponseContentOmitted = true;
      // It was not cut for size: it was left out.
      delete snapshot.isResponseBodyTruncated;
    }

    return snapshot;
  }

  /*
   * The evidence rules on one check, without the logger's name walk. The
   * check's own object is copied; what it holds is copied where a rule
   * changes it, and never changed in place.
   */
  private static redactCheckContent(input: {
    check: JSONValue;
    keepResponseContent: boolean;
    monitorStep?: MonitorStep | undefined;
  }): RedactedCheck {
    if (!MonitorRecordEvidence.isPlainObject(input.check)) {
      return {
        check: MonitorRecordEvidence.redactTexts(
          input.check,
          0,
        ) as unknown as JSONObject,
        isResponseContentOmitted: false,
      };
    }

    const source: JSONObject = input.check as JSONObject;
    const check: JSONObject = {};
    let isResponseContentOmitted: boolean = false;

    for (const key of Object.keys(source)) {
      const value: JSONValue = source[key] as JSONValue;

      if (HEADER_FIELDS.includes(key) || BODY_FIELDS.includes(key)) {
        if (!input.keepResponseContent) {
          if (value !== undefined) {
            isResponseContentOmitted = true;
          }

          continue;
        }

        check[key] = HEADER_FIELDS.includes(key)
          ? MonitorRecordEvidence.redactHeaderMap(value)
          : MonitorRecordEvidence.redactBody(value);
        continue;
      }

      if (key === "monitorDestination") {
        check[key] = MonitorRecordEvidence.redactDestination({
          echoed: value,
          monitorStep: input.monitorStep,
        });
        continue;
      }

      if (SCRIPT_RESPONSE_FIELDS.includes(key)) {
        check[key] = Array.isArray(value)
          ? (value as Array<JSONValue>).map((item: JSONValue) => {
              return MonitorRecordEvidence.redactScriptResponse(item);
            })
          : MonitorRecordEvidence.redactScriptResponse(value);
        continue;
      }

      if (INCOMING_EMAIL_FIELDS.has(key)) {
        check[key] = value;
        continue;
      }

      check[key] = MonitorRecordEvidence.redactTexts(value, 1);
    }

    return {
      check: check,
      isResponseContentOmitted: isResponseContentOmitted,
    };
  }

  /*
   * A header map: names kept, values as the evidence rules keep them. A
   * header sent more than once arrives as a list: each value is read as
   * text.
   */
  private static redactHeaderMap(value: JSONValue): JSONValue {
    if (!MonitorRecordEvidence.isPlainObject(value)) {
      return MonitorRecordEvidence.redactTexts(value, 1);
    }

    const headers: JSONObject = value as JSONObject;
    const redacted: Dictionary<string> =
      MonitorEvidenceRedaction.redactHeaders(
        headers as unknown as Dictionary<string>,
      ) || {};
    const result: JSONObject = {};

    for (const name of Object.keys(redacted)) {
      const original: JSONValue = headers[name] as JSONValue;

      result[name] =
        typeof original === "string" ||
        redacted[name] === MonitorEvidenceRedaction.REDACTED
          ? (redacted[name] as JSONValue)
          : MonitorRecordEvidence.redactTexts(original, 2);
    }

    return result;
  }

  // A body: JSON by the name and text rules, any other text by the text rules.
  private static redactBody(value: JSONValue): JSONValue {
    if (typeof value === "string") {
      return MonitorEvidenceRedaction.redactText(
        MonitorRecordEvidence.maskNamedJsonValues(value),
      );
    }

    if (value === null || value === undefined || typeof value !== "object") {
      return value;
    }

    return MonitorEvidenceRedaction.redactJson(value);
  }

  /*
   * A body that came as JSON text - an API monitor's response is kept as
   * one - with the values of the fields whose names say credential or
   * personal data masked where they sit in the text, as an incident's
   * excerpt finds them (JsonTextScanner, ResponseExcerpt.readText). Each
   * becomes the JSON string "[REDACTED]", so the rest is kept as written and
   * the text still parses. A text that is not one whole JSON object or
   * array, or is longer than MonitorEvaluationDetailsLimits.scannedBodyChars,
   * is returned as it is, for the text rules alone - as the excerpt reads it.
   */
  private static maskNamedJsonValues(text: string): string {
    if (
      !text ||
      text.length > MonitorEvaluationDetailsLimits.scannedBodyChars
    ) {
      return text;
    }

    const firstCharacter: string = text.trimStart().charAt(0);

    if (firstCharacter !== "{" && firstCharacter !== "[") {
      return text;
    }

    const scan: JsonTextScan | null = JsonTextScanner.scan({
      text: text,
      isSensitiveName: (name: string): boolean => {
        return MonitorEvidenceRedaction.isSensitiveName(name);
      },
    });

    if (!scan || scan.sensitiveSpans.length === 0) {
      return text;
    }

    const masked: string = JSON.stringify(MonitorEvidenceRedaction.REDACTED);
    let result: string = "";
    let cursor: number = 0;

    // In text order and never overlapping.
    for (const span of scan.sensitiveSpans) {
      result += text.slice(cursor, span.start) + masked;
      cursor = span.end;
    }

    return result + text.slice(cursor);
  }

  // A script's run: its result read as a JSON body, the rest as text.
  private static redactScriptResponse(value: JSONValue): JSONValue {
    if (!MonitorRecordEvidence.isPlainObject(value)) {
      return MonitorRecordEvidence.redactTexts(value, 1);
    }

    const source: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of Object.keys(source)) {
      const child: JSONValue = source[key] as JSONValue;

      if (key === SCRIPT_RESULT_FIELD) {
        result[key] = MonitorRecordEvidence.redactBody(child);
      } else if (key === SCREENSHOTS_FIELD) {
        result[key] = child;
      } else {
        result[key] = MonitorRecordEvidence.redactTexts(child, 2);
      }
    }

    return result;
  }

  /*
   * The destination the step was configured with, a URL redacted; without
   * a step, the one the probe echoed, a URL redacted the same way.
   */
  private static redactDestination(input: {
    echoed: JSONValue;
    monitorStep?: MonitorStep | undefined;
  }): JSONValue {
    const configured: string | undefined =
      MonitorRecordEvidence.getStepDestination(input.monitorStep);

    if (configured) {
      return MonitorRecordEvidence.isUrlLike(configured)
        ? MonitorEvidenceRedaction.redactUrl(configured)
        : configured;
    }

    const echoed: string = MonitorRecordEvidence.toText(input.echoed);

    if (echoed && MonitorRecordEvidence.isUrlLike(echoed)) {
      return MonitorEvidenceRedaction.redactUrl(echoed);
    }

    return MonitorRecordEvidence.redactTexts(input.echoed, 1);
  }

  /*
   * Every text in a value read by the text rules; objects and arrays
   * copied, anything else - numbers, dates, ids - kept as it is. A typed
   * value OneUptime wrote ({"_type": "ObjectID", "value": ...}, a date, a
   * port) is kept as it is too: it is read back as its type, which a
   * changed value could fail. Past MAX_DEPTH a subtree is dropped rather
   * than passed through unread.
   */
  private static redactTexts(value: JSONValue, depth: number): JSONValue {
    if (depth > MAX_DEPTH) {
      return null;
    }

    if (typeof value === "string") {
      return MonitorEvidenceRedaction.redactText(value);
    }

    if (Array.isArray(value)) {
      return (value as Array<JSONValue>).map((item: JSONValue) => {
        return MonitorRecordEvidence.redactTexts(item, depth + 1);
      }) as JSONValue;
    }

    if (
      !MonitorRecordEvidence.isPlainObject(value) ||
      MonitorRecordEvidence.isTypedValue(value)
    ) {
      return value;
    }

    const source: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of Object.keys(source)) {
      result[key] = MonitorRecordEvidence.redactTexts(
        source[key] as JSONValue,
        depth + 1,
      );
    }

    return result;
  }

  // The step of the monitor a check ran, by the id a probe check carries.
  public static findCheckStep(input: {
    monitor: Monitor | undefined;
    check: DataToProcess | JSONValue | undefined;
  }): MonitorStep | undefined {
    const stepId: unknown = (input.check as JSONObject | undefined)?.[
      "monitorStepId"
    ];
    const id: string = MonitorRecordEvidence.toText(stepId);

    if (!id) {
      return undefined;
    }

    return (
      input.monitor?.monitorSteps?.data?.monitorStepsInstanceArray || []
    ).find((step: MonitorStep): boolean => {
      return step.id?.toString() === id;
    });
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

  private static isPlainObject(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  // A value JSONFunctions.serialize wrote: {"_type": "...", "value": ...}.
  private static isTypedValue(value: unknown): boolean {
    const envelope: JSONObject = value as JSONObject;

    return (
      typeof envelope["_type"] === "string" &&
      Object.prototype.hasOwnProperty.call(envelope, "value")
    );
  }
}
