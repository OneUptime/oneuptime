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
  MAX_SCRUBBED_ADDRESS_LENGTH,
  ScrubbedAddress,
  ScrubbedAddressPlace,
  markClientAddressScrubbed,
  readScrubbedAddress,
} from "../ScrubbedAddress";
import {
  MAX_JSON_LINE_LENGTH,
  MAX_TEXT_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readAttribute,
  readIpAddress,
  readRemoteIpAddress,
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
 * looked for in any log line, access log or not - as a lookup, "${jndi:"
 * and where to look, never the bare string a rule or a query names).
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

// Where a marker is in a lowercased text: its first character and the one past it.
interface MarkerMatch {
  start: number;
  end: number;
}

function isHexDigit(character: string | undefined): boolean {
  return (
    character !== undefined &&
    character.length === 1 &&
    "0123456789abcdef".indexOf(character) !== -1
  );
}

/*
 * Whether a JNDI lookup's name starts at `index` of a lowercased text:
 * where to look - a protocol ("ldap://", "dns://"), a nested lookup that
 * spells one ("${lower:l}dap://"), an escape ("ldap://") - raw or
 * percent-encoded. A "%" that encodes nothing is SQL's wildcard
 * ("LIKE '%${jndi:%'"), somebody searching for the string.
 */
function isLookupNameStart(lower: string, index: number): boolean {
  let character: string = lower[index] || "";

  // A percent-encoded character, read as the character it encodes.
  if (character === "%") {
    if (!isHexDigit(lower[index + 1]) || !isHexDigit(lower[index + 2])) {
      return false;
    }

    character = String.fromCharCode(
      parseInt(lower.slice(index + 1, index + 3), 16),
    ).toLowerCase();
  }

  const code: number = character.charCodeAt(0);

  return (
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    character === "$" ||
    character === "\\"
  );
}

/*
 * The first Log4Shell marker in a lowercased text that starts a lookup:
 * "${jndi:" followed by a name to look up, or "%24%7bjndi" followed by
 * its colon (":" or "%3a") and one. The bare marker followed by a quote,
 * a comma, a bracket, a space or nothing is somebody NAMING the string -
 * a detection rule, a WAF's configuration, a query that looks for it
 * (issue #6419) - and looks nothing up.
 */
function findLog4ShellLookup(
  lower: string,
  marker: string,
): MarkerMatch | null {
  let index: number = lower.indexOf(marker);

  while (index !== -1) {
    let end: number = index + marker.length;

    // An encoded marker stops before its colon.
    if (!marker.endsWith(":")) {
      if (lower[end] === ":") {
        end += 1;
      } else if (lower.startsWith("%3a", end)) {
        end += 3;
      } else {
        end = -1;
      }
    }

    if (end !== -1 && isLookupNameStart(lower, end)) {
      return { start: index, end };
    }

    index = lower.indexOf(marker, index + marker.length);
  }

  return null;
}

// The first marker of a group in a lowercased text that counts, or null.
function findWebAttackMarker(
  lower: string,
  group: { kind: WebAttackKind; markers: ReadonlyArray<string> },
): MarkerMatch | null {
  let first: MarkerMatch | null = null;

  for (const marker of group.markers) {
    let match: MarkerMatch | null = null;

    if (group.kind === WebAttackKind.Log4Shell) {
      match = findLog4ShellLookup(lower, marker);
    } else {
      const index: number = lower.indexOf(marker);
      match =
        index === -1 ? null : { start: index, end: index + marker.length };
    }

    if (match && (!first || match.start < first.start)) {
      first = match;
    }
  }

  return first;
}

// The attack a line carries, the first kind in the list's order.
export function readWebAttackKind(text: string): WebAttackKind | null {
  const lower: string = text.toLowerCase();

  for (const group of WEB_ATTACK_MARKERS) {
    if (findWebAttackMarker(lower, group)) {
      return group.kind;
    }
  }

  return null;
}

export interface AccessLogRequest {
  clientIp: string;
  /*
   * What a scrub rule left in the line's client field, when it hid the
   * client's address there (#10397): the line's client is hidden, never
   * read from elsewhere in it. Absent otherwise.
   */
  scrubbedClient?: ScrubbedAddress | undefined;
  method: string;
  target: string;
  status: number;
  userAgent: string;
}

type ClientField = Pick<AccessLogRequest, "clientIp" | "scrubbedClient">;

/*
 * A client field's value: the address it holds, or what a scrub rule left
 * of one - the field's own, so the line's client is hidden.
 */
function readClientField(value: string): ClientField {
  const clientIp: string = readIpAddress(value);

  if (clientIp) {
    return { clientIp };
  }

  const scrubbedClient: ScrubbedAddress | null = readScrubbedAddress(value);

  return scrubbedClient ? { clientIp: "", scrubbedClient } : { clientIp: "" };
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
   * right before the " - " that common log format puts after it. Either
   * may hold what a scrub rule left of the address instead.
   */
  let client: ClientField = readClientField(readWord(text, 0));

  if (!client.clientIp && !client.scrubbedClient) {
    const identityIndex: number = text.indexOf(" - ");

    if (identityIndex !== -1 && identityIndex < openQuote) {
      const before: string = text.slice(0, identityIndex);
      client = readClientField(before.slice(before.lastIndexOf(" ") + 1));
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

  return { ...client, method, target, status, userAgent };
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
    ...readClientField(readFirstField(record, JSON_CLIENT_FIELDS)),
    method: HTTP_METHODS.includes(method) ? method : "",
    target,
    status: readStatus(readFirstField(record, JSON_STATUS_FIELDS)),
    userAgent: readFirstField(record, JSON_AGENT_FIELDS),
  };
}

/*
 * The words a line names its client's address after, the most telling
 * first: nginx's error log ("client: 203.0.113.7,"), Apache's ("[client
 * 203.0.113.7:51234]"), key=value lines ("remote_addr=203.0.113.7",
 * "src=203.0.113.7") and an application's own words ("... from
 * 203.0.113.7"). Never a forwarded-for header's value, which whoever sent
 * the request wrote.
 */
export const CLIENT_ADDRESS_LABELS: ReadonlyArray<string> = [
  "client_ip",
  "clientip",
  "client_addr",
  "client.address",
  "client.ip",
  "client",
  "remote_addr",
  "remoteaddr",
  "remote_ip",
  "remoteip",
  "remote_address",
  "remote.address",
  "remote",
  "source_ip",
  "sourceip",
  "src_ip",
  "srcip",
  "source.address",
  "source.ip",
  "source",
  "src",
  "from",
  "ip",
];

// How many times one label is looked at in a line before the next is tried.
const MAX_LABEL_OCCURRENCES: number = 64;

// The longest address a label is followed by, with its brackets and port.
const MAX_ADDRESS_TOKEN_LENGTH: number = 64;

// What may stand between a label and its address: "client: ", "ip=", '"ip":"'.
const LABEL_SEPARATORS: string = " :=\"'";

// What ends an address: the space, comma or bracket after it.
const ADDRESS_ENDS: string = " \t\r\n,;)]\"'|&<>";

function isLabelCharacter(character: string | undefined): boolean {
  if (!character) {
    return false;
  }

  const code: number = character.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    character === "_" ||
    character === "." ||
    character === "-"
  );
}

/*
 * An address as a line writes it, without what is around it: the port of
 * "203.0.113.7:51234", the brackets and port of "[2001:db8::7]:443", the
 * full stop that ends a sentence. Read as the client's (readRemoteIpAddress:
 * never this machine's own, an IPv4 address written as IPv6 read as IPv4).
 */
export function readAddressToken(token: string): string {
  let address: string = token;

  if (address.startsWith("[")) {
    const close: number = address.indexOf("]");
    address = close === -1 ? address.slice(1) : address.slice(1, close);
  } else {
    const colon: number = address.indexOf(":");

    if (colon !== -1 && address.indexOf(":", colon + 1) === -1) {
      address = address.slice(0, colon);
    }
  }

  while (address.endsWith(".")) {
    address = address.slice(0, -1);
  }

  return readRemoteIpAddress(address);
}

// The address that follows the label at `labelEnd` of a lowercased text, else "".
function readAddressAfterLabel(lower: string, labelEnd: number): string {
  let index: number = labelEnd;

  while (
    index < lower.length &&
    index - labelEnd < 4 &&
    LABEL_SEPARATORS.indexOf(lower[index]!) !== -1
  ) {
    // "from ::ffff:203.0.113.7" (Node's remoteAddress): the "::" is the address's.
    if (lower.startsWith("::", index)) {
      break;
    }

    index++;
  }

  if (index === labelEnd) {
    return "";
  }

  let end: number = index;

  // "[2001:db8::7]:443": the brackets hold the address, a port may follow.
  if (lower[index] === "[") {
    const close: number = lower
      .slice(index, index + MAX_ADDRESS_TOKEN_LENGTH)
      .indexOf("]");

    if (close === -1) {
      return "";
    }

    end = index + close + 1;
  }

  while (end < lower.length && ADDRESS_ENDS.indexOf(lower[end]!) === -1) {
    end++;

    if (end - index > MAX_ADDRESS_TOKEN_LENGTH) {
      return "";
    }
  }

  return end === index ? "" : readAddressToken(lower.slice(index, end));
}

/*
 * What ends a value a scrub rule left after a label: what ends an address,
 * but a bracket - "[REDACTED]" and a Hash rule's token are bracketed.
 */
const SCRUBBED_ADDRESS_ENDS: string = " \t\r\n,;)\"'|&<>";

/*
 * What a scrub rule left after the label at `labelEnd`, read from the text
 * as written - OneUptime's rules write "[REDACTED]" and a token's hex in
 * one case - else null. A bracket that closes around it ("[client
 * [REDACTED]:51234]", Apache's error log) is the line's, not the value's.
 */
function readScrubbedAfterLabel(
  text: string,
  lower: string,
  labelEnd: number,
): ScrubbedAddress | null {
  let index: number = labelEnd;

  while (
    index < lower.length &&
    index - labelEnd < 4 &&
    LABEL_SEPARATORS.indexOf(lower[index]!) !== -1
  ) {
    if (lower.startsWith("::", index)) {
      break;
    }

    index++;
  }

  if (index === labelEnd) {
    return null;
  }

  let end: number = index;

  while (
    end < text.length &&
    SCRUBBED_ADDRESS_ENDS.indexOf(text[end]!) === -1
  ) {
    end++;

    if (end - index > MAX_SCRUBBED_ADDRESS_LENGTH) {
      return null;
    }
  }

  const token: string = text.slice(index, end);

  if (!token) {
    return null;
  }

  return (
    readScrubbedAddress(token) ||
    (token.endsWith("]") ? readScrubbedAddress(token.slice(0, -1)) : null)
  );
}

/*
 * What a line in no known format says of its client: its address, else
 * what a scrub rule left where the address was (#10397), else nothing.
 */
export interface ClientAddressReading {
  address: string;
  scrubbed: ScrubbedAddress | null;
}

/*
 * The client's address of a line in no known format: its first word, when
 * that is an address, else the first address a line names after one of
 * CLIENT_ADDRESS_LABELS. Never just any word that reads as one - a version
 * ("ClickHouse 26.7.38.18", issue #6419), a server's own address or an
 * upstream's is no client.
 *
 * An address wins wherever it is: only a line that names none says what a
 * scrub rule left in one of those places - its first word, else the first
 * label (in the labels' order) followed by one - so the address a line
 * names is the one it always was.
 */
export function readClientAddressReading(text: string): ClientAddressReading {
  const firstWord: string = readWord(text, 0);
  const firstAddress: string = readAddressToken(firstWord);

  if (firstAddress) {
    return { address: firstAddress, scrubbed: null };
  }

  let scrubbed: ScrubbedAddress | null = readScrubbedAddress(firstWord);
  const lower: string = text.toLowerCase();
  /*
   * A label's value is read again as written, at the places the lower-case
   * copy found it - which are the same places while lowering kept the
   * text's length.
   */
  const canReadAsWritten: boolean = lower.length === text.length;

  for (const label of CLIENT_ADDRESS_LABELS) {
    let index: number = lower.indexOf(label);
    let looked: number = 0;

    while (index !== -1 && looked < MAX_LABEL_OCCURRENCES) {
      if (!isLabelCharacter(lower[index - 1])) {
        const address: string = readAddressAfterLabel(
          lower,
          index + label.length,
        );

        if (address) {
          return { address, scrubbed: null };
        }

        if (!scrubbed && canReadAsWritten) {
          scrubbed = readScrubbedAfterLabel(text, lower, index + label.length);
        }
      }

      index = lower.indexOf(label, index + label.length);
      looked++;
    }
  }

  return { address: "", scrubbed };
}

export function readClientAddress(text: string): string {
  return readClientAddressReading(text).address;
}

// The client of a line with an attack in it, and what a scrub rule left of it.
interface LineClient {
  ip: string;
  scrubbed: { scrubbed: ScrubbedAddress; place: ScrubbedAddressPlace } | null;
}

/*
 * The client of a line with an attack in it, the most telling first: the
 * access log's own client field, the address the line's attributes name
 * (OpenTelemetry's client.address), then the line's own words. An address
 * wins wherever it is read. When none is, what a scrub rule left of one
 * says the client was hidden (#10397): the access log's field first - it
 * is the line's client - then the attributes', then the line's words.
 *
 * An access log's client is its client field. What a common log format
 * line holds after its request line opens - the target, the referrer, the
 * user agent - is what the sender wrote ("GET /?from=198.51.100.9"), so a
 * label is looked for only before it; and a line whose client field a
 * scrub rule hid is looked at for no other address at all.
 */
function readLineClient(data: {
  text: string;
  accessLog: AccessLogRequest | null;
  fromAttributes: AccessLogRequest;
}): LineClient {
  const { text, accessLog, fromAttributes } = data;
  const ip: string = accessLog?.clientIp || fromAttributes.clientIp;

  if (ip) {
    return { ip, scrubbed: null };
  }

  if (accessLog?.scrubbedClient) {
    return {
      ip: "",
      scrubbed: {
        scrubbed: accessLog.scrubbedClient,
        place: ScrubbedAddressPlace.LogBody,
      },
    };
  }

  const requestLineStart: number =
    accessLog && !text.startsWith("{") ? text.indexOf('"') : -1;
  const labelled: ClientAddressReading = readClientAddressReading(
    requestLineStart === -1 ? text : text.slice(0, requestLineStart),
  );

  if (labelled.address) {
    return { ip: labelled.address, scrubbed: null };
  }

  if (fromAttributes.scrubbedClient) {
    return {
      ip: "",
      scrubbed: {
        scrubbed: fromAttributes.scrubbedClient,
        place: ScrubbedAddressPlace.LogAttributes,
      },
    };
  }

  return {
    ip: "",
    scrubbed: labelled.scrubbed
      ? { scrubbed: labelled.scrubbed, place: ScrubbedAddressPlace.LogBody }
      : null,
  };
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
    ...readClientField(
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
  const group:
    | { kind: WebAttackKind; markers: ReadonlyArray<string> }
    | undefined = WEB_ATTACK_MARKERS.find(
    (item: { kind: WebAttackKind }): boolean => {
      return item.kind === kind;
    },
  );
  const match: MarkerMatch | null = group
    ? findWebAttackMarker(text.toLowerCase(), group)
    : null;

  if (!match) {
    return "";
  }

  const markerStart: number = match.start;
  const markerEnd: number = match.end;

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
    const client: LineClient = readLineClient({
      text,
      accessLog,
      fromAttributes,
    });
    const outcome: SecurityEventRequestOutcome | undefined =
      requestOutcomeFromStatusCode(statusCode);

    const attributes: JSONObject = {
      [WEB_ATTACK_KIND_ATTRIBUTE]: kind,
    };

    // A scrub rule hid the client's address: the event says so, and names none.
    if (client.scrubbed) {
      markClientAddressScrubbed(attributes, client.scrubbed);
    }

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
      principalIp: client.ip,
      targetResource: cutText(target, 2000),
      attributes,
    });

    if (outcome) {
      event.requestOutcome = outcome;
    }

    return [event];
  }
}
