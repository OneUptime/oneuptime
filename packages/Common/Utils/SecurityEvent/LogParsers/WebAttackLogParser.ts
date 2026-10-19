import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { readString } from "../NormalizerHelpers";
import {
  MAX_JSON_LINE_LENGTH,
  MAX_TEXT_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
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
 * the request target and the status. The request target is the event's
 * target resource, which the rules match on; a line whose request cannot be
 * read keeps the whole line there, so the rules still see the attack.
 */

export const WEB_HTTP_ACTIVITY_CLASS_UID: number = 4002;

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

    const request: AccessLogRequest | null =
      readJsonAccessLog(text) || readCommonLogFormat(text);
    const clientIp: string = request?.clientIp || findFirstIpAddress(text);
    const target: string = request?.target || text;

    const attributes: JSONObject = {
      "web.attack.kind": kind,
    };

    if (request?.method) {
      attributes["http.request.method"] = request.method;
    }

    if (request?.target) {
      attributes["url.original"] = cutText(request.target, 2000);
    }

    if (request?.status) {
      attributes["http.response.status_code"] = String(request.status);
    }

    if (request?.userAgent) {
      attributes["user_agent.original"] = cutText(request.userAgent, 1000);
    }

    let statusName: string = "";

    if (request?.status) {
      statusName = request.status >= 400 ? "Failure" : "Success";
    }

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.WebAttack,
        classUid: WEB_HTTP_ACTIVITY_CLASS_UID,
        activityName: request?.method || "",
        statusName,
        severity: OcsfSeverity.Medium,
        message: text,
        principalIp: clientIp,
        targetResource: cutText(target, 2000),
        attributes,
      }),
    ];
  }
}
