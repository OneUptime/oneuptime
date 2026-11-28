import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import {
  CROWDSEC_DECISION_BAN,
  CROWDSEC_DECISION_CAPTCHA,
  CROWDSEC_META_CONNECTION,
  CROWDSEC_ONEUPTIME_SCENARIO,
  CROWDSEC_TEST_ALERT_SCENARIO,
  CrowdSecAlertKind,
  CrowdSecOrigin,
} from "../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import { CrowdSecBehavior } from "../../../Types/SecurityEvent/CrowdSec/CrowdSecBehavior";
import { writeOwnValue } from "../../LookupTable";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  readNumber,
  readString,
  readValue,
} from "../NormalizerHelpers";
import {
  CrowdSecScenarioReading,
  readCrowdSecScenario,
} from "./CrowdSecScenarioReading";

/*
 * A CROWDSEC ALERT -> A DETECTION FINDING (OCSF class 2004), #11158.
 *
 * What CrowdSec's http notification plugin sends with its default format
 * ({{.|toJson}}): a list of the alerts that matched a profile, each as LAPI
 * models it (pkg/models/alert.go) - the scenario that fired, the source it
 * blames (an address or a range, with its AS and country), the events that
 * filled the bucket (each a list of key/value meta: source_ip, target_user,
 * target_fqdn, http_path...), the alert's context (key/value, each value a
 * JSON list), and the decisions LAPI's profile took ("ban for 4h"). The
 * same shape `cscli alerts list -o json` prints, so a team can send what
 * CrowdSec already holds too.
 *
 * Every alert is a Detection Finding; what it is about decides the rest:
 *
 *   detection  a scenario fired (crowdsecurity/ssh-bf, an AppSec rule):
 *              CrowdSec's own verdict. Its severity and MITRE ATT&CK
 *              techniques are its scenario's (CrowdSecScenarioReading), and
 *              it is what opens cases, through a CrowdSec connection;
 *   manual     a person's decision (`cscli decisions add`, an import);
 *   console    a decision made in CrowdSec's Console;
 *   blocklist  an address on a blocklist CrowdSec pulls (CAPI, lists);
 *   test       `cscli notifications test`'s generic alert;
 *   oneuptime  OneUptime's own ban, back through the plugin: a ban
 *              OneUptime made passes LAPI's profiles like any manual one,
 *              and a profile that notifies OneUptime sends it back. Known
 *              by its scenario and its meta (CrowdSecDecisions), and never
 *              read as CrowdSec's verdict, so it can open no case and
 *              trigger no block of its own: no loop.
 *
 * All but a detection are Informational: CrowdSec acted, a person or a
 * list decided. Each one's outcome is the decision it holds - Blocked for a
 * ban, Challenge for a captcha, Logged when nothing was applied (a
 * scenario in simulation mode, or one no profile remediates).
 *
 * The event names the address CrowdSec blamed as its principal, and the
 * host, user and URL the attack went for as its target, so cases gather
 * by the host attacked. Every field of the alert is kept in its
 * attributes, the readable ones under crowdsec.* - and its events, of
 * which a bucket can hold hundreds, the first ten whole and all of them
 * summed up a key at a time (crowdsec.event.target_user: every user the
 * brute force tried).
 */

export const DETECTION_FINDING_CLASS_UID: number = 2004;

export const CROWDSEC_VENDOR_NAME: string = "CrowdSec";
export const CROWDSEC_PRODUCT_NAME: string = "CrowdSec";

export enum CrowdSecAlertType {
  Detection = "detection",
  Manual = "manual",
  Console = "console",
  Blocklist = "blocklist",
  Test = "test",
  OneUptime = "oneuptime",
}

// The attribute that says which of those an event is.
export const CROWDSEC_ALERT_TYPE_ATTRIBUTE: string = "crowdsec.alert_type";

// How many of an alert's events are kept whole in its attributes.
export const CROWDSEC_EVENTS_KEPT_WHOLE: number = 10;

// The most distinct values one event or context key is summed up with.
export const CROWDSEC_VALUES_PER_KEY: number = 20;

// The longest a summed-up value gets.
export const CROWDSEC_SUMMARY_MAX_LENGTH: number = 1000;

// One decision of an alert, as LAPI writes it.
export interface CrowdSecDecisionReading {
  type: string;
  // As LAPI says it: "4h" when made, "3h59m49s" left when read back, "-1m2s" ended.
  duration: string;
  origin: string;
  scope: string;
  value: string;
  scenario: string;
  // LAPI's id of the decision, once it holds it.
  id: string;
  simulated: boolean;
}

/*
 * Go's time.Time.String(), which LAPI writes an event's time in when it is
 * read back (models.Event.Timestamp from ent): "2022-02-12 14:10:23 +0000
 * UTC", with nanoseconds when it has them.
 */
const GO_TIME_STRING: RegExp =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))? ([+-])(\d{2})(\d{2}) [A-Za-z0-9+-]+(?: m=[+-][\d.]+)?$/;

// A time as CrowdSec writes one: RFC 3339 (nanoseconds and all), or Go's String().
export function parseCrowdSecTime(value: JSONValue): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const text: string = value.trim();
  const go: RegExpMatchArray | null = text.match(GO_TIME_STRING);
  const iso: string = go
    ? `${go[1]}T${go[2]}${go[3] ? `.${go[3].slice(0, 3).padEnd(3, "0")}` : ""}${go[4]}${go[5]}:${go[6]}`
    : text;
  const parsed: Date = new Date(iso);

  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= 0) {
    return null;
  }

  return parsed;
}

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A key/value meta list (an event's meta, an alert's context) as each key's
 * values, in the order written. A context value is a JSON list of strings
 * (alertcontext.TruncateContext); an event's is a string. Keys compare as
 * written.
 */
export function readCrowdSecMeta(
  list: JSONValue | undefined,
): Map<string, Array<string>> {
  const values: Map<string, Array<string>> = new Map();

  if (!Array.isArray(list)) {
    return values;
  }

  const add: (key: string, value: string) => void = (
    key: string,
    value: string,
  ): void => {
    const trimmed: string = value.trim();

    if (!trimmed) {
      return;
    }

    const kept: Array<string> = values.get(key) || [];

    if (!kept.includes(trimmed)) {
      kept.push(trimmed);
    }

    values.set(key, kept);
  };

  for (const item of list) {
    if (!isObject(item)) {
      continue;
    }

    const key: JSONValue = item["key"];
    const value: JSONValue = item["value"];

    if (typeof key !== "string" || !key.trim()) {
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      add(key.trim(), String(value));
      continue;
    }

    if (typeof value !== "string") {
      continue;
    }

    const text: string = value.trim();

    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed: unknown = JSON.parse(text);

        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === "string" || typeof entry === "number") {
              add(key.trim(), String(entry));
            }
          }
          continue;
        }
      } catch {
        // Not a list after all: kept as the text it is.
      }
    }

    add(key.trim(), text);
  }

  return values;
}

// Every event's meta, merged key by key.
function readEventsMeta(payload: JSONObject): Map<string, Array<string>> {
  const merged: Map<string, Array<string>> = new Map();
  const events: JSONValue = readValue(payload, "events");

  if (!Array.isArray(events)) {
    return merged;
  }

  for (const event of events) {
    if (!isObject(event)) {
      continue;
    }

    for (const [key, values] of readCrowdSecMeta(event["meta"])) {
      const kept: Array<string> = merged.get(key) || [];

      for (const value of values) {
        if (!kept.includes(value)) {
          kept.push(value);
        }
      }

      merged.set(key, kept);
    }
  }

  return merged;
}

export function readCrowdSecDecisions(
  payload: JSONObject,
): Array<CrowdSecDecisionReading> {
  const decisions: JSONValue = readValue(payload, "decisions");

  if (!Array.isArray(decisions)) {
    return [];
  }

  const read: Array<CrowdSecDecisionReading> = [];

  for (const decision of decisions) {
    if (!isObject(decision)) {
      continue;
    }

    read.push({
      type: readString(decision, "type"),
      duration: readString(decision, "duration"),
      origin: readString(decision, "origin"),
      scope: readString(decision, "scope"),
      value: readString(decision, "value"),
      scenario: readString(decision, "scenario"),
      id: readString(decision, "id"),
      simulated: decision["simulated"] === true,
    });
  }

  return read;
}

/*
 * Whether a payload is a CrowdSec alert: a scenario, the source it blames
 * (a scope and a value), and the bucket fields every alert LAPI models
 * carries. Falcon's alerts carry a "scenario" too, but no source of that
 * shape and none of the bucket's fields.
 */
export function isCrowdSecAlert(payload: JSONObject): boolean {
  if (!isObject(payload)) {
    return false;
  }

  const scenario: JSONValue = payload["scenario"];
  const source: JSONValue = payload["source"];

  if (typeof scenario !== "string" || !scenario.trim() || !isObject(source)) {
    return false;
  }

  const scope: JSONValue = source["scope"];
  const value: JSONValue = source["value"] ?? source["ip"];

  if (typeof scope !== "string" || !scope.trim() || typeof value !== "string") {
    return false;
  }

  return [
    "scenario_hash",
    "scenario_version",
    "leakspeed",
    "events_count",
    "capacity",
  ].some((key: string): boolean => {
    return Object.prototype.hasOwnProperty.call(payload, key);
  });
}

// Which kind of alert it is (see the top of this file).
export function readCrowdSecAlertType(payload: JSONObject): CrowdSecAlertType {
  const scenario: string = readString(payload, "scenario").trim();
  const kind: string = readString(payload, "kind").trim().toLowerCase();
  const decisions: Array<CrowdSecDecisionReading> =
    readCrowdSecDecisions(payload);
  const meta: Map<string, Array<string>> = readCrowdSecMeta(
    readValue(payload, "meta"),
  );

  if (
    scenario === CROWDSEC_ONEUPTIME_SCENARIO ||
    meta.has(CROWDSEC_META_CONNECTION) ||
    decisions.some((decision: CrowdSecDecisionReading): boolean => {
      return decision.scenario === CROWDSEC_ONEUPTIME_SCENARIO;
    })
  ) {
    return CrowdSecAlertType.OneUptime;
  }

  if (scenario === CROWDSEC_TEST_ALERT_SCENARIO) {
    return CrowdSecAlertType.Test;
  }

  const origin: string = decisions[0]?.origin || "";

  if (
    kind === CrowdSecAlertKind.Capi ||
    origin === CrowdSecOrigin.Capi ||
    origin === CrowdSecOrigin.Lists
  ) {
    return CrowdSecAlertType.Blocklist;
  }

  if (kind === CrowdSecAlertKind.Papi || origin === CrowdSecOrigin.Console) {
    return CrowdSecAlertType.Console;
  }

  if (
    kind === CrowdSecAlertKind.Cscli ||
    origin === CrowdSecOrigin.Cscli ||
    origin === CrowdSecOrigin.CscliImport
  ) {
    return CrowdSecAlertType.Manual;
  }

  return CrowdSecAlertType.Detection;
}

// What a decision did, as the event's outcome (OCSF disposition).
function outcomeOf(data: {
  decision: CrowdSecDecisionReading | undefined;
  simulated: boolean;
}): string {
  if (data.simulated || !data.decision) {
    return "Logged";
  }

  const type: string = data.decision.type.toLowerCase();

  if (type === CROWDSEC_DECISION_BAN) {
    return "Blocked";
  }

  if (type === CROWDSEC_DECISION_CAPTCHA) {
    return "Challenge";
  }

  return "Other";
}

// "banned for 4h", "challenged for 4h", or what a custom type did; '' for none.
function describeDecision(
  decision: CrowdSecDecisionReading | undefined,
): string {
  if (!decision || !decision.type) {
    return "";
  }

  const type: string = decision.type.toLowerCase();
  const done: string =
    type === CROWDSEC_DECISION_BAN
      ? "banned"
      : type === CROWDSEC_DECISION_CAPTCHA
        ? "challenged"
        : `given a ${decision.type} decision`;
  const duration: string = decision.duration.trim();

  return duration && !duration.startsWith("-")
    ? `${done} for ${duration}`
    : done;
}

function firstOf(...lists: Array<Array<string> | undefined>): string {
  for (const list of lists) {
    if (list && list.length > 0) {
      return list[0] || "";
    }
  }

  return "";
}

function summary(values: Array<string>): string {
  const text: string = values.slice(0, CROWDSEC_VALUES_PER_KEY).join(",");

  return text.length > CROWDSEC_SUMMARY_MAX_LENGTH
    ? text.slice(0, CROWDSEC_SUMMARY_MAX_LENGTH)
    : text;
}

function readPort(text: string): number {
  const port: number = Number(text);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

export default class CrowdSecNormalizer {
  public static isCrowdSecAlert(payload: JSONObject): boolean {
    return isCrowdSecAlert(payload);
  }

  // Whether a normalized event is a scenario's detection: what may open a case.
  public static isDetection(event: NormalizedSecurityEvent): boolean {
    return (
      event.attributes[CROWDSEC_ALERT_TYPE_ATTRIBUTE] ===
      CrowdSecAlertType.Detection
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const type: CrowdSecAlertType = readCrowdSecAlertType(payload);
    const scenario: string = readString(payload, "scenario").trim();
    const reading: CrowdSecScenarioReading = readCrowdSecScenario(scenario);
    const decisions: Array<CrowdSecDecisionReading> =
      readCrowdSecDecisions(payload);
    const decision: CrowdSecDecisionReading | undefined = decisions[0];
    const simulated: boolean =
      payload["simulated"] === true || decision?.simulated === true;
    const context: Map<string, Array<string>> = readCrowdSecMeta(
      readValue(payload, "meta"),
    );
    const eventsMeta: Map<string, Array<string>> = readEventsMeta(payload);

    const scope: string = readString(payload, "source.scope").trim();
    const sourceValue: string = readString(payload, "source.value").trim();
    const sourceIp: string =
      readString(payload, "source.ip").trim() ||
      (scope.toLowerCase() === "ip" ? sourceValue : "");
    const sourceRange: string =
      readString(payload, "source.range").trim() ||
      (scope.toLowerCase() === "range" ? sourceValue : "");

    const targetHost: string = firstOf(
      eventsMeta.get("target_fqdn"),
      context.get("target_fqdn"),
      eventsMeta.get("target_host"),
      context.get("target_host"),
      eventsMeta.get("machine"),
    );
    const targetUser: string = firstOf(
      eventsMeta.get("target_user"),
      context.get("target_user"),
    );
    const targetResource: string = firstOf(
      context.get("target_uri"),
      eventsMeta.get("target_uri"),
      eventsMeta.get("http_path"),
    );
    const targetIp: string = firstOf(
      eventsMeta.get("target_ip"),
      eventsMeta.get("dst_ip"),
    );
    const targetPort: number = readPort(
      firstOf(eventsMeta.get("target_port"), eventsMeta.get("dst_port")),
    );

    const isDetection: boolean = type === CrowdSecAlertType.Detection;
    const severity: OcsfSeverity = isDetection
      ? reading.severity
      : OcsfSeverity.Informational;
    const title: string = reading.label || scenario || "CrowdSec alert";
    const who: string =
      sourceValue || sourceIp || sourceRange || "an unknown source";

    const time: Date =
      (isDetection
        ? parseCrowdSecTime(readValue(payload, "stop_at")) ||
          parseCrowdSecTime(readValue(payload, "start_at")) ||
          parseCrowdSecTime(readValue(payload, "created_at"))
        : parseCrowdSecTime(readValue(payload, "created_at")) ||
          parseCrowdSecTime(readValue(payload, "stop_at")) ||
          parseCrowdSecTime(readValue(payload, "start_at"))) || new Date();

    const uuid: string = readString(payload, "uuid").trim();
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    return {
      time,
      eventUid: uuid ? `crowdsec:${uuid}` : contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: "Detection Finding",
      activityName: "Create",
      severityId: OcsfSeverityId[severity],
      severityName: severity,
      statusName: outcomeOf({ decision, simulated }),
      message: this.describe({
        type,
        title,
        who,
        targetHost,
        decision,
        simulated,
      }),
      vendorName: CROWDSEC_VENDOR_NAME,
      productName: CROWDSEC_PRODUCT_NAME,
      ruleId: scenario,
      ruleName: title,
      mitreTactics: isDetection ? reading.tactics : [],
      mitreTechniques: isDetection ? reading.techniques : [],
      principalUser: "",
      principalHost: "",
      principalIp: sourceIp,
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser,
      targetHost,
      targetIp,
      targetPort,
      targetResource,
      observables: buildObservables([
        sourceIp,
        sourceRange,
        targetHost,
        targetUser,
        targetIp,
        ...decisions.map((item: CrowdSecDecisionReading): string => {
          return item.value;
        }),
      ]),
      attributes: this.readAttributes({
        payload,
        type,
        reading,
        decisions,
        context,
        eventsMeta,
        simulated,
      }),
    };
  }

  private static describe(data: {
    type: CrowdSecAlertType;
    title: string;
    who: string;
    targetHost: string;
    decision: CrowdSecDecisionReading | undefined;
    simulated: boolean;
  }): string {
    const done: string = describeDecision(data.decision);

    switch (data.type) {
      case CrowdSecAlertType.OneUptime:
        return `OneUptime's ban of ${data.who} is held by CrowdSec${done ? `: ${done}` : ""}`;
      case CrowdSecAlertType.Test:
        return `CrowdSec's test notification (cscli notifications test), for ${data.who}`;
      case CrowdSecAlertType.Blocklist:
        return `${data.who} is on the CrowdSec blocklist ${data.title}${done ? `, ${done}` : ""}`;
      case CrowdSecAlertType.Console:
        return `${data.who} ${done || "acted on"} from CrowdSec's Console (${data.title})`;
      case CrowdSecAlertType.Manual:
        return `${data.who} ${done || "acted on"} by hand in CrowdSec (${data.title})`;
      default: {
        const on: string = data.targetHost ? ` on ${data.targetHost}` : "";
        const outcome: string = data.simulated
          ? " (simulation mode: nothing applied)"
          : done
            ? `, ${done}`
            : "";

        return `${data.title} from ${data.who}${on}${outcome}`;
      }
    }
  }

  private static readAttributes(data: {
    payload: JSONObject;
    type: CrowdSecAlertType;
    reading: CrowdSecScenarioReading;
    decisions: Array<CrowdSecDecisionReading>;
    context: Map<string, Array<string>>;
    eventsMeta: Map<string, Array<string>>;
    simulated: boolean;
  }): JSONObject {
    const events: JSONValue = readValue(data.payload, "events");
    const eventCount: number = Array.isArray(events) ? events.length : 0;
    const trimmed: JSONObject = Array.isArray(events)
      ? {
          ...data.payload,
          events: events.slice(0, CROWDSEC_EVENTS_KEPT_WHOLE),
        }
      : data.payload;

    // Every field as it came, the first events whole.
    const attributes: JSONObject = flattenPayload(trimmed);

    const set: (key: string, value: string | number | undefined) => void = (
      key: string,
      value: string | number | undefined,
    ): void => {
      if (value === undefined || value === "") {
        return;
      }

      writeOwnValue<JSONValue>(attributes, key, String(value));
    };

    set(CROWDSEC_ALERT_TYPE_ATTRIBUTE, data.type);
    set("crowdsec.scenario", readString(data.payload, "scenario"));
    set(
      "crowdsec.scenario_version",
      readString(data.payload, "scenario_version"),
    );
    set("crowdsec.scenario_hash", readString(data.payload, "scenario_hash"));
    set("crowdsec.kind", readString(data.payload, "kind"));
    set("crowdsec.machine_id", readString(data.payload, "machine_id"));
    set("crowdsec.alert_id", readString(data.payload, "id"));
    set("crowdsec.uuid", readString(data.payload, "uuid"));
    set("crowdsec.message", readString(data.payload, "message"));
    set("crowdsec.simulated", String(data.simulated));
    set(
      "crowdsec.remediation",
      data.payload["remediation"] === true ? "true" : "false",
    );
    set(
      "crowdsec.events_count",
      readNumber(data.payload, "events_count") ?? undefined,
    );
    set(
      "crowdsec.events_kept",
      Math.min(eventCount, CROWDSEC_EVENTS_KEPT_WHOLE),
    );
    set("crowdsec.capacity", readNumber(data.payload, "capacity") ?? undefined);
    set("crowdsec.leakspeed", readString(data.payload, "leakspeed"));
    set("crowdsec.start_at", readString(data.payload, "start_at"));
    set("crowdsec.stop_at", readString(data.payload, "stop_at"));

    if (data.type === CrowdSecAlertType.Detection) {
      set("crowdsec.behavior", data.reading.behavior);
      set("crowdsec.behavior_from", data.reading.isFromHub ? "hub" : "name");
    } else {
      set("crowdsec.behavior", CrowdSecBehavior.Unknown);
    }

    for (const key of [
      "scope",
      "value",
      "ip",
      "range",
      "as_number",
      "as_name",
      "cn",
      "latitude",
      "longitude",
    ]) {
      set(`crowdsec.source.${key}`, readString(data.payload, `source.${key}`));
    }

    data.decisions.forEach(
      (decision: CrowdSecDecisionReading, index: number): void => {
        const prefix: string = `crowdsec.decisions.${index}`;
        set(`${prefix}.type`, decision.type);
        set(`${prefix}.duration`, decision.duration);
        set(`${prefix}.origin`, decision.origin);
        set(`${prefix}.scope`, decision.scope);
        set(`${prefix}.value`, decision.value);
        set(`${prefix}.scenario`, decision.scenario);
        set(`${prefix}.id`, decision.id);
      },
    );

    for (const [key, values] of data.context) {
      set(`crowdsec.context.${key}`, summary(values));
    }

    for (const [key, values] of data.eventsMeta) {
      set(`crowdsec.event.${key}`, summary(values));
    }

    return attributes;
  }
}
