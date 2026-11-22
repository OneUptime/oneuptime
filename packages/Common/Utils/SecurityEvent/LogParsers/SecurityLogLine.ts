import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import {
  NETWORK_DEVICE_ID_ATTRIBUTE,
  NETWORK_DEVICE_NAME_ATTRIBUTE,
} from "../../../Types/NetworkDevice/NetworkDeviceTelemetryAttribute";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_NAME_MAX_LENGTH,
  SECURITY_LOG_PODMAN_HOST_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
  SECURITY_LOG_ROW_CLOUD_RESOURCE_KEY,
  SECURITY_LOG_ROW_FUNCTION_KEY,
} from "../../../Types/SecurityCase/SecurityConnection";
import {
  MAX_RESOURCE_ID_LENGTH,
  getResourceIdMatchKey,
} from "../../SecurityCase/SecurityConnectionMatch";
import { getResourceIdObservables } from "../SecurityRecordReading";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../../Types/SecurityEvent/OcsfEventClass";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_ID_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
  SECURITY_LOG_SOURCE_VALUE,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  ProcessReading,
  buildObservables,
  buildProcessFields,
} from "../NormalizerHelpers";
import { writeOwnValue } from "../../LookupTable";
import { TrustedProxies } from "../ClientAddressTrust";
import {
  EventAddressReading,
  SCRUBBED_ADDRESS_ATTRIBUTES,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  markAddressScrubbed,
  readEventAddress,
  readScrubbedAddress,
} from "../ScrubbedAddress";
import { readEventUsers } from "../ScrubbedUser";

/*
 * One log line as the log parsers read it: the line itself, the attributes
 * it was sent with (flattened, the way the Log table stores them) and where
 * it came from.
 *
 * Every parser reads a line with indexOf and slices, never a regular
 * expression with a repeat: these are lines anybody can write into a log
 * (a username in an SSH log is whatever an attacker typed), so the time a
 * parser takes must grow in line with the line, whatever it holds.
 */
export interface SecurityLogLine {
  body: string;
  attributes: JSONObject;
  time: Date;
  // The log record's own id, so an event can always be traced back to it.
  logId?: string | undefined;
  // The service the log was sent under.
  serviceName?: string | undefined;
  /*
   * The record the log was sent under - its primary entity: a Service, a
   * Host, a Kubernetes cluster... (Types/Telemetry/ServiceType) - so the
   * event is connected to it exactly (Types/SecurityCase/SecurityConnection).
   */
  resourceId?: string | undefined;
  resourceType?: string | undefined;
  /*
   * The request the line was written in, when it was written inside a
   * traced one: the Log record's own trace, span and session ids. Every
   * event the line becomes carries them, so it links to that trace, the
   * exception the request threw and the session it was part of.
   */
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;
  /*
   * The proxies the line's project trusts to forward a client's address
   * (Utils/SecurityEvent/ClientAddressTrust, #10416): its Trusted Proxies,
   * beside the private addresses every project trusts. Absent - Check a
   * log line, a test - only those.
   */
  trustedProxies?: TrustedProxies | undefined;
}

// The longest line a text parser reads; past it a line is cut, not skipped.
export const MAX_TEXT_LINE_LENGTH: number = 16 * 1024;

// The longest JSON document a JSON parser reads; a bigger one is skipped.
export const MAX_JSON_LINE_LENGTH: number = 256 * 1024;

// The longest message an event made from a log keeps.
export const MAX_EVENT_MESSAGE_LENGTH: number = 1000;

// An IP address, a port or a host name is never longer than this.
const MAX_TOKEN_LENGTH: number = 255;

// A trace, span or session id is never longer than this.
export const MAX_TELEMETRY_ID_LENGTH: number = 128;

export function cutText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1)}…`;
}

/*
 * The word that starts at `from`: everything up to the next space (or the
 * end). Bounded by MAX_TOKEN_LENGTH so a line of one endless word cannot
 * make a token of it.
 */
export function readWord(text: string, from: number): string {
  if (from < 0 || from >= text.length) {
    return "";
  }

  const end: number = text.indexOf(" ", from);
  const word: string = end === -1 ? text.slice(from) : text.slice(from, end);

  return word.length > MAX_TOKEN_LENGTH ? "" : word;
}

/*
 * HOW EVERY FORMAT READS AN ADDRESS (#10419).
 *
 * Security Events reads logs after ingest's scrub rules have run, so where
 * an IP Address rule hid an address the line holds what the rule left:
 * "[REDACTED]", a mask, or a Hash rule's token ("Failed password for root
 * from [HASHED:3f9a1c0be27d4e5a] port 52314 ssh2"). readIpAddress and
 * readRemoteIpAddress - what every format reads its source and destination
 * with - keep that value, in the one spelling ScrubbedAddress reads, where
 * they used to drop it. Handed over as the event's principalIp or targetIp,
 * it becomes no address and the marker that says a scrub rule hid it
 * (buildLogSecurityEvent), and the log scan looks a page's tokens up in the
 * address vault (Server/Utils/SecurityEvent/AddressVault), so the event
 * names the address behind each one it holds.
 *
 * A parser takes them from the field it always took the address from, so
 * the vault names only what the line would have named unscrubbed. A
 * message, or an attribute copied from the record, keeps what the rule
 * left, as stored.
 *
 * readIpAddressOnly and readRemoteIpAddressOnly read an address and nothing
 * else: for a value that is no address field (a device's host name), and
 * the parsers that tell a hidden address apart themselves (SSH's, the web
 * access log's).
 */

// An address worth recording, and nothing else: a valid IPv4 or IPv6 address, else "".
export function readIpAddressOnly(value: string): string {
  const candidate: string = (value || "").trim();

  if (!candidate || candidate.length > 64) {
    return "";
  }

  return IP.isIP(candidate) ? candidate : "";
}

/*
 * What a scrub rule left where an address was written, read through the
 * port, brackets, "::ffff:" or full stop around it, in the one spelling
 * the scan resolves: else "".
 */
function readScrubbedAddressValue(value: string): string {
  return readScrubbedAddress(value || "")?.value || "";
}

/*
 * An address field's value: a valid IPv4 or IPv6 address, or what a scrub
 * rule left in its place, else "".
 */
export function readIpAddress(value: string): string {
  return readIpAddressOnly(value) || readScrubbedAddressValue(value);
}

/*
 * The address a request came from, worth recording as an entity: a valid
 * address that is not this machine's own (127.0.0.1, ::1) and not "any"
 * (0.0.0.0, ::), else "". An IPv4 address written as IPv6
 * (::ffff:203.0.113.7, as Windows writes a Kerberos client's) is read as
 * the IPv4 address it is. Nothing else: never what a scrub rule left.
 */
export function readRemoteIpAddressOnly(value: string): string {
  let candidate: string = (value || "").trim();

  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped: string = candidate.slice("::ffff:".length);

    if (readIpAddressOnly(mapped) && !mapped.includes(":")) {
      candidate = mapped;
    }
  }

  const address: string = readIpAddressOnly(candidate);

  if (!address) {
    return "";
  }

  const lower: string = address.toLowerCase();

  if (
    lower === "::1" ||
    lower === "::" ||
    lower === "0.0.0.0" ||
    lower.startsWith("127.")
  ) {
    return "";
  }

  return address;
}

/*
 * The address a request came from, as a field holds it: a remote address
 * (readRemoteIpAddressOnly), or what a scrub rule left in its place - an IP
 * Address rule keeps this machine's own addresses, so what it hid was
 * another's - else "".
 */
export function readRemoteIpAddress(value: string): string {
  return readRemoteIpAddressOnly(value) || readScrubbedAddressValue(value);
}

/*
 * Of the fields a record may name one address in, in the order they are
 * preferred, the one the event names: the first address, else the first
 * value a scrub rule left, else "" - an address wins wherever it is read,
 * as a hidden one says only that a rule hid it (ScrubbedAddress, #10397).
 * Each value as read by readIpAddress or readRemoteIpAddress.
 */
export function pickAddress(values: ReadonlyArray<string>): string {
  let scrubbed: string = "";

  for (const value of values) {
    const text: string = (value || "").trim();

    if (!text) {
      continue;
    }

    if (!readScrubbedAddress(text)) {
      return text;
    }

    scrubbed = scrubbed || text;
  }

  return scrubbed;
}

// The most attributes an event made from one structured record keeps.
export const MAX_RECORD_ATTRIBUTES: number = 300;

// The longest value of an attribute an event made from a record keeps.
export const MAX_RECORD_ATTRIBUTE_VALUE_LENGTH: number = 1000;

/*
 * A record's fields as an event's attributes: flat key=text pairs, at most
 * MAX_RECORD_ATTRIBUTES of them, each value cut to
 * MAX_RECORD_ATTRIBUTE_VALUE_LENGTH - a source decides how much a record
 * holds, the event keeps a bounded copy of it.
 */
export function boundAttributes(
  flattened: JSONObject,
  maxValueLength: number = MAX_RECORD_ATTRIBUTE_VALUE_LENGTH,
): JSONObject {
  const bounded: JSONObject = {};
  let count: number = 0;

  for (const key of Object.keys(flattened)) {
    if (count >= MAX_RECORD_ATTRIBUTES) {
      break;
    }

    const raw: unknown = flattened[key];

    if (raw === null || raw === undefined) {
      continue;
    }

    /*
     * Written as the copy's own key, so a field named "__proto__" is an
     * attribute like any other (issue #8487): it was left out, since an
     * assignment would have dropped it. Its value is always text here.
     */
    const value: string = typeof raw === "string" ? raw : String(raw);
    writeOwnValue(bounded, key, cutText(value, maxValueLength));
    count++;
  }

  return bounded;
}

// A port number 1-65535, else 0.
export function readPort(value: string): number {
  const candidate: string = (value || "").trim();

  if (!candidate || candidate.length > 5) {
    return 0;
  }

  for (let index: number = 0; index < candidate.length; index++) {
    const code: number = candidate.charCodeAt(index);

    if (code < 48 || code > 57) {
      return 0;
    }
  }

  const port: number = Number(candidate);

  return port >= 1 && port <= 65535 ? port : 0;
}

/*
 * The first value of a flattened attribute among `keys`, as text: OTLP
 * resource attributes (host.name), journald fields and syslog fields name
 * the same things differently.
 */
export function readAttribute(
  attributes: JSONObject,
  keys: Array<string>,
): string {
  for (const key of keys) {
    const value: unknown = attributes[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, MAX_TOKEN_LENGTH);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

// The host a line was written on, from the attributes OTLP and syslog set.
export function readLogHost(line: SecurityLogLine): string {
  return readAttribute(line.attributes, [
    "host.name",
    "resource.host.name",
    "hostname",
    "syslog.hostname",
    "_HOSTNAME",
    "k8s.node.name",
  ]);
}

/*
 * The network device a line came from, when ingest matched it to one: its
 * `networkDevice.id` (a real id, else nothing) and its name. Ingest sets
 * both on every syslog line and trap it matched to a device, over whatever
 * the line said under those names, so a device's own messages carry its
 * real id. Every event read from the line carries them too, which puts a
 * firewall's denied connections - naming the hosts on either side of it,
 * never the firewall - on that firewall's Security Events page
 * (Types/SecurityEvent/SecurityEventScope).
 */
export function readLogNetworkDevice(
  attributes: JSONObject | undefined | null,
): JSONObject {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }

  const id: unknown = attributes[NETWORK_DEVICE_ID_ATTRIBUTE];

  if (typeof id !== "string" || !ObjectID.isValidUUID(id.trim())) {
    return {};
  }

  const device: JSONObject = {
    [NETWORK_DEVICE_ID_ATTRIBUTE]: id.trim(),
  };
  const name: unknown = attributes[NETWORK_DEVICE_NAME_ATTRIBUTE];

  if (typeof name === "string" && name.trim()) {
    device[NETWORK_DEVICE_NAME_ATTRIBUTE] = cutText(
      name.trim(),
      MAX_TOKEN_LENGTH,
    );
  }

  return device;
}

// The Docker or Podman runtime a container's line names, and the attribute it puts on its events.
const CONTAINER_HOST_ATTRIBUTES: Readonly<Record<string, string>> = {
  docker: SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
  podman: SECURITY_LOG_PODMAN_HOST_ATTRIBUTE,
};

/*
 * The Docker or Podman host a container's line was written on (#9628): the
 * host name its agent stamps on every line, under the runtime that ran the
 * container. A container's logs are filed under its own service, so this is
 * how an event read from one reaches the host's Security Events page - the
 * same lines its Logs page shows. A line of any other runtime, or of no
 * container, names no container host.
 */
export function readLogContainerHost(
  attributes: JSONObject | undefined | null,
): JSONObject {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }

  const runtime: string = readAttribute(attributes, [
    "resource.container.runtime",
    "container.runtime",
  ]).toLowerCase();
  const attribute: string | undefined = Object.prototype.hasOwnProperty.call(
    CONTAINER_HOST_ATTRIBUTES,
    runtime,
  )
    ? CONTAINER_HOST_ATTRIBUTES[runtime]
    : undefined;
  const host: string = readAttribute(attributes, [
    "resource.host.name",
    "host.name",
  ]);

  // readAttribute bounds the host name, which DNS keeps to 253 characters.
  if (!attribute || !host) {
    return {};
  }

  return { [attribute]: host };
}

// The longest function name a line's faas.name is read as.
export const MAX_LOG_FUNCTION_NAME_LENGTH: number =
  SECURITY_LOG_FUNCTION_NAME_MAX_LENGTH;

// A row's text attribute, trimmed: "" when it is none, or longer than `limit` - never cut.
function readExactAttribute(
  attributes: JSONObject | undefined | null,
  key: string,
  limit: number,
): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
    ? attributes[key]
    : undefined;
  const text: string = typeof value === "string" ? value.trim() : "";

  return text.length <= limit ? text : "";
}

/*
 * The cloud resource a line is of (#9779): its resource.cloud.resource_id,
 * as the stream stamped it - the value the resource's Logs page filters on
 * - so every event read from the line reaches that resource's Security
 * Events page and its Connected Signals. An Azure resource ID is kept by
 * its key, in lower case (#10034): Azure compares its IDs without case, and
 * a collector or a pipeline stamps one in any case it likes. An ARN or a
 * Google Cloud name is kept as written. Kept whole: a value cut to fit
 * would name another resource, so one longer than any cloud's ID is left
 * out.
 */
export function readLogCloudResource(
  attributes: JSONObject | undefined | null,
): JSONObject {
  const id: string = readExactAttribute(
    attributes,
    SECURITY_LOG_ROW_CLOUD_RESOURCE_KEY,
    MAX_RESOURCE_ID_LENGTH,
  );

  return id
    ? { [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: getResourceIdMatchKey(id) }
    : {};
}

/*
 * The serverless function a line is of (#9780): its resource.faas.name,
 * which ingest stamps on every row of a function's telemetry and the
 * function's Logs page filters on, whatever Service the line is filed
 * under. Every event read from the line carries it, which puts the event
 * on that function's Security Events page.
 */
export function readLogFunction(
  attributes: JSONObject | undefined | null,
): JSONObject {
  const name: string = readExactAttribute(
    attributes,
    SECURITY_LOG_ROW_FUNCTION_KEY,
    MAX_LOG_FUNCTION_NAME_LENGTH,
  );

  return name ? { [SECURITY_LOG_FUNCTION_ATTRIBUTE]: name } : {};
}

export interface LogSecurityEventInput {
  line: SecurityLogLine;
  format: SecurityLogFormat;
  classUid: number;
  /*
   * The class's name, for a record no OCSF class fits (class 0): what the
   * source calls that kind of record. Left out, it is OCSF's name.
   */
  className?: string | undefined;
  activityName: string;
  statusName: string;
  severity: OcsfSeverity;
  message: string;
  time?: Date | undefined;
  /*
   * Who made the record, when the line says so itself: a CEF or LEEF
   * header's vendor and product, a Windows provider, Microsoft Entra ID's
   * own records among an Azure export. Left out, the format's.
   */
  vendorName?: string | undefined;
  productName?: string | undefined;
  // The rule that found it, for a record that is a finding.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  // The source's own id for the record (an audit ID, a CloudTrail event ID).
  eventUid?: string | undefined;
  // Ids it may have been stored under before (NormalizedSecurityEvent.eventUidAliases).
  eventUidAliases?: Array<string> | undefined;
  // Distinguishes the events of one line that holds several records.
  recordIndex?: number | undefined;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  principalProcess?: string | undefined;
  // The process the line is about (a command sudo ran), and its parent.
  process?: ProcessReading | undefined;
  parentProcess?: ProcessReading | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  targetPort?: number | undefined;
  targetResource?: string | undefined;
  /*
   * The cloud resources the record is about, by the id their Cloud
   * Resource keeps (CloudAuditResources): named among the observables.
   */
  resourceIds?: Array<string> | undefined;
  // What the parser read, already flat: the attributes rules match on.
  attributes: JSONObject;
  mitreTactics?: Array<string> | undefined;
  mitreTechniques?: Array<string> | undefined;
}

/*
 * A host the event names: what the field held, unless it is what a scrub
 * rule left of an address (#10419) - a FortiGate's hostname, a CloudTrail
 * call's sourceIPAddress, a device's dvc is an address as often as a name.
 * That is no host: taken for one, "[REDACTED]" would be one host every
 * hidden event shares, which the rules that count per host would add up.
 * The address the record names in its address field says it was hidden.
 */
export function readEventHost(value: string | null | undefined): string {
  const text: string = (value || "").trim();

  return text && readScrubbedAddress(text) ? "" : text;
}

/*
 * A parser's reading of a line, as the security event it becomes. The
 * vendor and product are the format's (SecurityLogFormat), the class and
 * category OCSF's, and every event carries where it came from: the source
 * "logs", its format and the id of the log record.
 */
export function buildLogSecurityEvent(
  input: LogSecurityEventInput,
): NormalizedSecurityEvent {
  const definition: SecurityLogFormatDefinition | undefined =
    getSecurityLogFormatDefinition(input.format);
  const category: { categoryUid: number; categoryName: string } =
    ocsfCategoryForClassUid(input.classUid);
  // A record no OCSF class fits (class 0) keeps the name its source gives it.
  const className: string =
    (input.classUid === 0 ? (input.className || "").trim() : "") ||
    ocsfEventClassByUid(input.classUid)?.name ||
    "Base Event";
  const logId: string = input.line.logId || "";

  const principalHost: string = readEventHost(input.principalHost);
  const targetHost: string = readEventHost(input.targetHost);

  /*
   * An address a scrub rule hid is no address (#10419): what the rule left
   * is the field's value as the parser read it (readIpAddress), and the
   * event names no address there, so threat intel, entity risk and the
   * rules that count per address never take "[REDACTED]" for an address
   * every hidden event shares (#10415).
   */
  const principalAddress: EventAddressReading = readEventAddress(
    input.principalIp,
  );
  const targetAddress: EventAddressReading = readEventAddress(input.targetIp);
  const principalIp: string = principalAddress.address;
  const targetIp: string = targetAddress.address;

  const attributes: JSONObject = {
    ...input.attributes,
    [SECURITY_LOG_SOURCE_ATTRIBUTE]: SECURITY_LOG_SOURCE_VALUE,
    [SECURITY_LOG_FORMAT_ATTRIBUTE]: input.format,
  };

  /*
   * ...and the event says a scrub rule hid it, with what the rule left, so
   * the log scan can look a Hash rule's token up in the address vault
   * (#10395) and name the rule (#10397). Every format reads its addresses
   * from the line's text. A parser that marked an address itself (SSH's,
   * the web access log's) knows where it read it, and keeps its marker.
   */
  for (const [role, reading] of [
    [ScrubbedAddressRole.Principal, principalAddress],
    [ScrubbedAddressRole.Target, targetAddress],
  ] as Array<[ScrubbedAddressRole, EventAddressReading]>) {
    if (
      reading.scrubbed &&
      attributes[SCRUBBED_ADDRESS_ATTRIBUTES[role].hidden] === undefined
    ) {
      markAddressScrubbed(attributes, {
        role,
        scrubbed: reading.scrubbed,
        place: ScrubbedAddressPlace.LogBody,
      });
    }
  }

  /*
   * A user a scrub rule hid is no user: Redact's and a mask's are none at
   * all, a Hash token stays one, and the event says which (ScrubbedUser,
   * #10435). Every parser's user fields reach the event through here.
   */
  const {
    principalUser,
    targetUser,
  }: { principalUser: string; targetUser: string } = readEventUsers({
    principalUser: input.principalUser,
    targetUser: input.targetUser,
    attributes,
    signal: "log",
  });

  if (logId) {
    attributes[SECURITY_LOG_ID_ATTRIBUTE] = logId;
  }

  if (input.line.serviceName) {
    attributes["oneuptime.log.service"] = input.line.serviceName;
  }

  /*
   * The record the log was sent under, when the log names one (a real id
   * and its type): what connects the event to that host or service exactly.
   */
  const resourceId: string = (input.line.resourceId || "").trim();
  const resourceType: string = (input.line.resourceType || "").trim();

  if (resourceType && ObjectID.isValidUUID(resourceId)) {
    attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE] = resourceId;
    attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE] = resourceType;
  }

  Object.assign(attributes, readLogNetworkDevice(input.line.attributes));
  Object.assign(attributes, readLogContainerHost(input.line.attributes));
  Object.assign(attributes, readLogCloudResource(input.line.attributes));
  Object.assign(attributes, readLogFunction(input.line.attributes));

  const recordSuffix: string =
    input.recordIndex !== undefined ? `:${input.recordIndex}` : "";
  const eventUid: string =
    input.eventUid || (logId ? `log:${logId}${recordSuffix}` : "");
  const eventUidAliases: Array<string> = (input.eventUidAliases || []).filter(
    (alias: string): boolean => {
      return Boolean(alias) && alias !== eventUid;
    },
  );

  return {
    time: input.time || input.line.time,
    eventUid,
    categoryUid: category.categoryUid,
    categoryName: category.categoryName,
    classUid: input.classUid,
    className,
    activityName: input.activityName,
    severityId: OcsfSeverityId[input.severity],
    severityName: input.severity,
    statusName: input.statusName,
    message: cutText(input.message, MAX_EVENT_MESSAGE_LENGTH),
    vendorName: cutText(
      (input.vendorName || "").trim() || definition?.vendorName || "",
      MAX_TOKEN_LENGTH,
    ),
    productName: cutText(
      (input.productName || "").trim() || definition?.productName || "",
      MAX_TOKEN_LENGTH,
    ),
    ruleId: cutText((input.ruleId || "").trim(), MAX_TOKEN_LENGTH),
    ruleName: cutText((input.ruleName || "").trim(), MAX_TOKEN_LENGTH),
    mitreTactics: input.mitreTactics || [],
    mitreTechniques: input.mitreTechniques || [],
    principalUser,
    principalHost,
    principalIp,
    principalProcess: (input.principalProcess || "").trim(),
    ...buildProcessFields({
      process: input.process,
      parent: input.parentProcess,
    }),
    targetUser,
    targetHost,
    targetIp,
    targetPort: input.targetPort || 0,
    targetResource: (input.targetResource || "").trim(),
    observables: buildObservables([
      principalUser,
      targetUser,
      principalHost,
      targetHost,
      principalIp,
      targetIp,
      ...getResourceIdObservables(input.resourceIds),
    ]),
    attributes,
    traceId: readTelemetryId(input.line.traceId),
    spanId: readTelemetryId(input.line.spanId),
    sessionId: readTelemetryId(input.line.sessionId),
    ...(input.eventUid && eventUidAliases.length > 0
      ? { eventUidAliases }
      : {}),
  };
}

/*
 * A trace, span or session id from a log record: trimmed, and '' for
 * anything no id is - empty, all zeros (OpenTelemetry's "no trace"), or
 * longer than any id.
 */
export function readTelemetryId(value: string | undefined): string {
  const id: string = (value || "").trim();

  if (!id || id.length > MAX_TELEMETRY_ID_LENGTH) {
    return "";
  }

  for (let index: number = 0; index < id.length; index++) {
    if (id[index] !== "0" && id[index] !== "-") {
      return id;
    }
  }

  return "";
}
