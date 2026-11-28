import { JSONArray, JSONObject, JSONValue } from "../JSON";
import NormalizedSecurityEvent from "./NormalizedSecurityEvent";
import OcsfSeverity from "./OcsfSeverity";
import SecurityEventRequestOutcome from "./SecurityEventRequestOutcome";
import {
  TrustedProxySource,
  isTrustedProxySource,
} from "../../Utils/SecurityEvent/TrustedProxySources";

/*
 * CHECK A LOG LINE (#11046): what a pasted line becomes, read by the server
 * exactly as the every-minute scan reads the project's logs - the same
 * parsers, with the project's trusted proxies, its connected edges, its own
 * load balancers and its Access Logs settings - so the client it names is
 * the one the stored event will name. Read in the browser, with no trust,
 * a line written behind a proxy named the proxy (Server/Utils/
 * SecurityEvent/SecurityLogLineCheck).
 *
 * The request, its limits and its answer are written and read here, so the
 * server and the page agree on them.
 */

export const SECURITY_LOG_LINE_CHECK_PATH: string = "/security-log-lines/check";

// A paste holds a line or a few; past these, the rest is not read.
export const MAX_CHECKED_LINES: number = 20;
export const MAX_SHOWN_EVENTS: number = 5;
// The longest paste read: the longest JSON line the scan reads, and a little.
export const MAX_CHECKED_TEXT_LENGTH: number = 300 * 1024;

/*
 * The lines of a paste, as the scan would have stored them: a JSON record
 * pasted across lines is one record, minified as a log body holds it; any
 * other paste is one log line a line.
 */
export function splitPastedLogLines(text: string): Array<string> {
  const trimmed: string = (text || "").slice(0, MAX_CHECKED_TEXT_LENGTH).trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return [JSON.stringify(JSON.parse(trimmed))];
    } catch {
      // Not one JSON record: a JSON line each, or text.
    }
  }

  return trimmed
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .slice(0, MAX_CHECKED_LINES);
}

// Why an address an event says it was forwarded by is trusted as a proxy.
export interface CheckedTrustedProxy {
  address: string;
  source: TrustedProxySource;
  // The edge whose range holds it, for an edge: "Cloudflare". '' otherwise.
  edgeName: string;
}

export interface SecurityLogLineCheckResult {
  // Lines read - a pretty-printed JSON record is one.
  linesRead: number;
  // How many events the lines make: more than `events` past MAX_SHOWN_EVENTS.
  eventCount: number;
  // The first MAX_SHOWN_EVENTS of them, as the scan would store them.
  events: Array<NormalizedSecurityEvent>;
  // Why each proxy the events say they came through is trusted.
  trustedProxies: Array<CheckedTrustedProxy>;
}

export const NO_CHECKED_EVENTS: SecurityLogLineCheckResult = {
  linesRead: 0,
  eventCount: 0,
  events: [],
  trustedProxies: [],
};

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readArray(value: JSONValue | undefined): Array<JSONValue> {
  return Array.isArray(value) ? value : [];
}

function readTexts(value: JSONValue | undefined): Array<string> {
  return readArray(value).filter((item: JSONValue): item is string => {
    return typeof item === "string";
  });
}

function isSeverity(value: unknown): value is OcsfSeverity {
  return (
    typeof value === "string" &&
    (Object.values(OcsfSeverity) as Array<string>).includes(value)
  );
}

function isRequestOutcome(
  value: unknown,
): value is SecurityEventRequestOutcome {
  return (
    typeof value === "string" &&
    (Object.values(SecurityEventRequestOutcome) as Array<string>).includes(
      value,
    )
  );
}

// An event as the answer carries it: every field, its time as ISO text.
export function checkedEventToJSON(event: NormalizedSecurityEvent): JSONObject {
  const json: JSONObject = {
    ...(event as unknown as JSONObject),
    time: event.time.toISOString(),
    attributes: { ...event.attributes },
    mitreTactics: [...event.mitreTactics],
    mitreTechniques: [...event.mitreTechniques],
    observables: [...event.observables],
  };

  // An id it may have been stored under before is the store's business, not the check's.
  delete json["eventUidAliases"];

  for (const key of Object.keys(json)) {
    if (json[key] === undefined) {
      delete json[key];
    }
  }

  return json;
}

/*
 * An event as the server answered it: each field of the kind it is, or
 * empty when the answer holds something else, never guessed at.
 */
export function readCheckedEvent(
  value: JSONValue | undefined,
): NormalizedSecurityEvent | null {
  const data: JSONObject | null = readObject(value);

  if (!data) {
    return null;
  }

  const time: Date = new Date(readText(data["time"]));
  const severityName: JSONValue | undefined = data["severityName"];
  const attributes: JSONObject = readObject(data["attributes"]) || {};

  if (Number.isNaN(time.getTime()) || !isSeverity(severityName)) {
    return null;
  }

  const event: NormalizedSecurityEvent = {
    time,
    eventUid: readText(data["eventUid"]),
    categoryUid: readNumber(data["categoryUid"]),
    categoryName: readText(data["categoryName"]),
    classUid: readNumber(data["classUid"]),
    className: readText(data["className"]),
    activityName: readText(data["activityName"]),
    severityId: readNumber(data["severityId"]),
    severityName,
    statusName: readText(data["statusName"]),
    message: readText(data["message"]),
    vendorName: readText(data["vendorName"]),
    productName: readText(data["productName"]),
    ruleId: readText(data["ruleId"]),
    ruleName: readText(data["ruleName"]),
    mitreTactics: readTexts(data["mitreTactics"]),
    mitreTechniques: readTexts(data["mitreTechniques"]),
    principalUser: readText(data["principalUser"]),
    principalHost: readText(data["principalHost"]),
    principalIp: readText(data["principalIp"]),
    principalProcess: readText(data["principalProcess"]),
    processName: readText(data["processName"]),
    processPath: readText(data["processPath"]),
    processCommandLine: readText(data["processCommandLine"]),
    parentProcessName: readText(data["parentProcessName"]),
    parentProcessPath: readText(data["parentProcessPath"]),
    parentProcessCommandLine: readText(data["parentProcessCommandLine"]),
    targetUser: readText(data["targetUser"]),
    targetHost: readText(data["targetHost"]),
    targetIp: readText(data["targetIp"]),
    targetPort: readNumber(data["targetPort"]),
    targetResource: readText(data["targetResource"]),
    observables: readTexts(data["observables"]),
    attributes,
    traceId: readText(data["traceId"]),
    spanId: readText(data["spanId"]),
    sessionId: readText(data["sessionId"]),
  };

  if (isRequestOutcome(data["requestOutcome"])) {
    event.requestOutcome = data["requestOutcome"];
  }

  return event;
}

export function securityLogLineCheckResultToJSON(
  result: SecurityLogLineCheckResult,
): JSONObject {
  return {
    linesRead: result.linesRead,
    eventCount: result.eventCount,
    events: result.events.map(checkedEventToJSON) as JSONArray,
    trustedProxies: result.trustedProxies.map(
      (proxy: CheckedTrustedProxy): JSONObject => {
        return {
          address: proxy.address,
          source: proxy.source,
          edgeName: proxy.edgeName,
        };
      },
    ),
  };
}

/*
 * What the server answered, read: an event or a proxy it cannot read is
 * left out, and a count is never less than what it holds.
 */
export function readSecurityLogLineCheckResult(
  value: JSONValue | undefined,
): SecurityLogLineCheckResult {
  const data: JSONObject = readObject(value) || {};
  const events: Array<NormalizedSecurityEvent> = [];
  const trustedProxies: Array<CheckedTrustedProxy> = [];

  for (const item of readArray(data["events"])) {
    const event: NormalizedSecurityEvent | null = readCheckedEvent(item);

    if (event) {
      events.push(event);
    }
  }

  for (const item of readArray(data["trustedProxies"])) {
    const proxy: JSONObject | null = readObject(item);
    const address: string = readText(proxy?.["address"]).trim();
    const source: JSONValue | undefined = proxy?.["source"];

    if (address && isTrustedProxySource(source)) {
      trustedProxies.push({
        address,
        source,
        edgeName: readText(proxy?.["edgeName"]).trim(),
      });
    }
  }

  const linesRead: number = Math.max(
    0,
    Math.floor(readNumber(data["linesRead"])),
  );
  const eventCount: number = Math.max(
    events.length,
    Math.floor(readNumber(data["eventCount"])),
  );

  return { linesRead, eventCount, events, trustedProxies };
}
