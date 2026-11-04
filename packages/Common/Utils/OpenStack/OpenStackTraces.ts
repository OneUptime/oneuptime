import { JSONObject, JSONValue } from "../../Types/JSON";
import type { SpanKind } from "../../Models/AnalyticsModels/Span";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_SCRUBBED_VALUE, scrubOpenStackSecrets } from "./OpenStackLogScrub";

/*
 * A SPAN FROM OSPROFILER'S OTLP DRIVER, READ AS IT ARRIVES.
 *
 * "Why does booting an instance take four minutes?" crosses Nova, Placement, Neutron and
 * Cinder, and OSProfiler is what OpenStack has for following it. It is per request by
 * design: a span exists only for a request signed with an HMAC key the services hold. The
 * driver that sends those spans as OTLP (osprofiler/drivers/otlp.py) is marked experimental,
 * and what it writes is not what anything downstream expects:
 *
 *   - service.name is "<project>-<service>", so nova-compute arrives as nova-nova-compute,
 *     and nova-api as nova-osapi_compute. The resource says nothing else: no cloud, no host.
 *   - A span's name is WSGI_POST_/v2.1/servers/<uuid>, SQL_SELECT or a word such as rpc,
 *     cut by Python's rstrip("-start"), which takes characters and not a suffix: scheduler
 *     arrives as "schedule".
 *   - A span's status is never set. A failure is an `error` attribute and a "log" event.
 *   - Its kind is guessed from words in the name, so every RPC call is INTERNAL, which leaves
 *     Nova's own hops off any service map.
 *   - Before OSProfiler 4.4.0, a request's first span has a parent that is never sent: the
 *     low 64 bits of the trace ID (OSProfiler bug 2132957). Nothing would read it as a root.
 *   - `args`, `kwargs`, `result` and `db.params` hold what a traced call was handed, written
 *     out as Python would print it: an instance's admin password and user data, a volume's
 *     connection info. They never reach storage, whatever a project's rules say.
 *
 * So every span in the driver's scope goes through this as it arrives, before drop filters,
 * scrub rules and pipelines, so they and the pages see it as it is read here. Everything
 * here is checked against what the driver really sent on a real cloud: see
 * Tests/Ops/openstack-e2e/traces-record.sh and the recordings in
 * Common/Tests/Fixtures/OpenStack/<release>/traces.
 *
 * Spans are text anyone holding the key can write into, so a value is read with indexOf and
 * loops, never a regular expression with a quantifier (AGENTS.md).
 *
 * These attribute keys are stored in customers' traces: never rename one.
 */

// The scope the driver's tracer is created under: `get_tracer(__name__)`.
export const OSPROFILER_DRIVER_SCOPE_NAME: string = "osprofiler.drivers.otlp";

export const OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE: string =
  "openstack.cloud.name";
export const OPENSTACK_NODE_RESOURCE_ATTRIBUTE: string = "openstack.node.name";
export const OPENSTACK_REGION_RESOURCE_ATTRIBUTE: string =
  "openstack.region.name";

// As a stored row holds them: resource attributes under a prefix, a scope's under its own.
export const OPENSTACK_CLOUD_SPAN_ATTRIBUTE: string =
  "resource.openstack.cloud.name";
export const OPENSTACK_NODE_SPAN_ATTRIBUTE: string =
  "resource.openstack.node.name";
export const OPENSTACK_REGION_SPAN_ATTRIBUTE: string =
  "resource.openstack.region.name";
export const OSPROFILER_SCOPE_SPAN_ATTRIBUTE: string = "scope.name";

export enum OpenStackTraceAttribute {
  // The same keys logs hold, so a trace and a log line say the same thing.
  Service = "openstack.service",
  Component = "openstack.component",
  // What the driver called the service, in case the name read from it is ever wrong.
  DriverService = "osprofiler.service.name",
  // The full name of a traced function: the driver's own `name`, which is left alone.
  FunctionName = "name",
}

// What a traced call was handed and what it answered. Never stored.
export const OSPROFILER_ATTRIBUTES_NEVER_STORED: ReadonlyArray<string> = [
  "args",
  "kwargs",
  "result",
  "db.params",
];

/*
 * What is kept of what the driver itself writes on a span, by name, and nothing else. The
 * driver is marked experimental and writes what a traced call was handed, so an attribute a
 * later release adds is dropped until someone has read what it holds, rather than stored
 * until someone notices. The collector deletes the four above by name, and this is what
 * catches a span that came some other way.
 */
export const OSPROFILER_ATTRIBUTES_KEPT: ReadonlySet<string> = new Set<string>([
  "http.path",
  "http.query",
  "http.method",
  "http.scheme",
  "http.hostname",
  "http.port",
  "db.statement",
  "name",
  "error",
  "status_code",
]);

// What ingest itself puts in a span's attribute map beside what the span came with.
const ATTRIBUTE_PREFIXES_NOT_THE_DRIVERS: ReadonlyArray<string> = [
  "resource.",
  "scope.",
  "oneuptime.",
];

// The driver's own span attributes, as it writes them.
const HTTP_PATH_ATTRIBUTE: string = "http.path";
const HTTP_QUERY_ATTRIBUTE: string = "http.query";
const HTTP_METHOD_ATTRIBUTE: string = "http.method";
const HTTP_HOSTNAME_ATTRIBUTE: string = "http.hostname";
const STATUS_CODE_ATTRIBUTE: string = "status_code";
const ERROR_ATTRIBUTE: string = "error";
const DB_STATEMENT_ATTRIBUTE: string = "db.statement";

// The word for an id in a span's name, where the id itself would make every name unique.
const ID_IN_NAME: string = "{id}";

const UUID_LENGTH: number = 36;
const HEX_ID_LENGTH: number = 32;
const SHORT_SPAN_ID_LENGTH: number = 16;
const MAX_STATUS_MESSAGE_LENGTH: number = 1024;
// A request names one or two parts. More than this is not a request anyone made by hand.
const MAX_RESOURCES_OF_ONE_SPAN: number = 8;
// How much of a pasted line is looked at for a Trace ID.
const MAX_TRACE_ID_INPUT_LENGTH: number = 4096;

export type OpenStackStoredSpanKind = `${SpanKind}`;

const SPAN_KIND_CONSUMER: OpenStackStoredSpanKind = "SPAN_KIND_CONSUMER";
const SPAN_KIND_PRODUCER: OpenStackStoredSpanKind = "SPAN_KIND_PRODUCER";
const SPAN_KIND_SERVER: OpenStackStoredSpanKind = "SPAN_KIND_SERVER";

function isHexCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 102) ||
    (code >= 65 && code <= 70)
  );
}

function isAllHex(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    if (!isHexCode(text.charCodeAt(index))) {
      return false;
    }
  }

  return text.length > 0;
}

function isAllDigits(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return text.length > 0;
}

// 8-4-4-4-12: what every OpenStack service but Keystone calls a thing by.
export function isOpenStackDashedUuid(text: string): boolean {
  if (text.length !== UUID_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < UUID_LENGTH; index++) {
    const code: number = text.charCodeAt(index);

    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 45) {
        return false;
      }
    } else if (!isHexCode(code)) {
      return false;
    }
  }

  return true;
}

// What can name a resource: a UUID, or the 32 hex characters Keystone calls a project by.
function isResourceId(text: string): boolean {
  return (
    isOpenStackDashedUuid(text) ||
    (text.length === HEX_ID_LENGTH && isAllHex(text))
  );
}

/*
 * ------------------------------------------------------------------
 * Which service a span is from
 * ------------------------------------------------------------------
 */

// The projects a driver's service.name can start with, and the service type each answers to.
const OPENSTACK_PROJECTS: ReadonlySet<string> = new Set<string>([
  "aodh",
  "barbican",
  "ceilometer",
  "cinder",
  "cloudkitty",
  "designate",
  "glance",
  "gnocchi",
  "heat",
  "ironic",
  "keystone",
  "magnum",
  "manila",
  "masakari",
  "neutron",
  "nova",
  "octavia",
  "placement",
  "senlin",
  "trove",
  "zun",
]);

/*
 * The services whose binary is not what each project told the driver, read from how each
 * starts: nova/api/openstack/wsgi_app.py names its applications, keystone/server/flask/core.py
 * and keystone/server/wsgi.py call theirs public, and glance/common/wsgi_app.py calls its api.
 * Keyed by what is left once the project's name has been read off.
 */
const SERVICE_WITH_ANOTHER_NAME: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["nova-osapi_compute", "nova-api"],
  ["nova-metadata", "nova-api-metadata"],
  ["keystone-public", "keystone"],
  ["keystone-admin", "keystone"],
  ["keystone-main", "keystone"],
  ["placement-placement", "placement-api"],
]);

export interface OpenStackDriverService {
  // The word an operator knows it by: nova-compute.
  service: string;
  // nova.
  component: string;
}

/*
 * What the driver wrote into service.name, as the word an operator knows. Whatever
 * `[profiler_otlp] service_name_prefix` a cloud set comes before the project, so what is
 * before the first project's name is left off.
 */
export function readOpenStackDriverService(
  driverName: string,
): OpenStackDriverService {
  const words: Array<string> = driverName.trim().split("-");
  let start: number = 0;

  while (start < words.length && !OPENSTACK_PROJECTS.has(words[start]!)) {
    start++;
  }

  // Not a project anyone knows: its name is still the best word there is.
  if (start === words.length) {
    const name: string = driverName.trim();

    return { service: name, component: words[0] || name };
  }

  const component: string = words[start]!;
  let rest: Array<string> = words.slice(start + 1);

  // <project>-<binary>, whose binary starts with the project: nova-nova-compute.
  if (rest[0] === component && rest.length > 1) {
    rest = rest.slice(1);
  }

  const read: string = [component, ...rest].join("-");

  return {
    service: SERVICE_WITH_ANOTHER_NAME.get(read) || read,
    component: component,
  };
}

/*
 * The name a span's service is stored under. OneUptime keeps one Service row per name in a
 * project, and two clouds in a project both run a nova-api, so the cloud comes first.
 */
export function getOpenStackTracedServiceName(data: {
  service: string;
  cloudName?: string | null | undefined;
}): string {
  return data.cloudName ? `${data.cloudName}/${data.service}` : data.service;
}

// That name without its cloud, for a page that is already about the cloud.
export function withoutOpenStackCloudName(data: {
  serviceName: string;
  cloudName: string;
}): string {
  const prefix: string = `${data.cloudName}/`;

  return data.serviceName.startsWith(prefix)
    ? data.serviceName.slice(prefix.length)
    : data.serviceName;
}

function readWireAttributeText(
  attributes: Array<JSONObject>,
  key: string,
): string {
  for (const attribute of attributes) {
    if (attribute["key"] === key) {
      const value: JSONValue | undefined = (
        attribute["value"] as JSONObject | undefined
      )?.["stringValue"];

      return typeof value === "string" ? value : "";
    }
  }

  return "";
}

function setWireAttributeText(
  attributes: Array<JSONObject>,
  key: string,
  text: string,
): void {
  for (const attribute of attributes) {
    if (attribute["key"] === key) {
      attribute["value"] = { stringValue: text };
      return;
    }
  }

  attributes.push({ key: key, value: { stringValue: text } });
}

export function isOSProfilerDriverScope(scope: unknown): boolean {
  return (
    Boolean(scope) &&
    typeof scope === "object" &&
    (scope as JSONObject)["name"] === OSPROFILER_DRIVER_SCOPE_NAME
  );
}

// Whether a block of OTLP holds the driver's spans: its scope is the one thing that says so.
function holdsDriverSpans(resourceSpans: JSONObject): boolean {
  const scopeSpans: unknown = resourceSpans["scopeSpans"];

  if (!Array.isArray(scopeSpans)) {
    return false;
  }

  for (const scopeSpan of scopeSpans) {
    if (isOSProfilerDriverScope((scopeSpan as JSONObject)?.["scope"])) {
      return true;
    }
  }

  return false;
}

/*
 * Gives a block of the driver's spans the service name operators know, in place, before
 * anything reads it: the Service row, the entity keys and every stored row take it from
 * there. Nothing else's block is touched, at the cost of one look at each scope's name.
 * Returns what it read, or null for anyone else's.
 */
export function normalizeOSProfilerResourceInPlace(
  resourceSpans: JSONObject,
): OpenStackDriverService | null {
  if (!holdsDriverSpans(resourceSpans)) {
    return null;
  }

  const resource: JSONObject | undefined = resourceSpans["resource"] as
    | JSONObject
    | undefined;
  const attributes: unknown = resource?.["attributes"];

  if (!Array.isArray(attributes)) {
    return null;
  }

  const wire: Array<JSONObject> = attributes as Array<JSONObject>;
  const driverName: string = readWireAttributeText(wire, "service.name");

  if (!driverName) {
    return null;
  }

  const read: OpenStackDriverService = readOpenStackDriverService(driverName);

  setWireAttributeText(wire, OpenStackTraceAttribute.DriverService, driverName);
  setWireAttributeText(
    wire,
    "service.name",
    getOpenStackTracedServiceName({
      service: read.service,
      cloudName: readWireAttributeText(wire, OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE),
    }),
  );

  return read;
}

/*
 * ------------------------------------------------------------------
 * What a request names
 * ------------------------------------------------------------------
 */

// A kind of thing a span can say it touched, and the attribute it is stored under.
export const OPENSTACK_TRACE_RESOURCE_ATTRIBUTES: ReadonlyArray<{
  kind: OpenStackResourceKind;
  attribute: string;
}> = [
  // The same key a log line holds, so a trace and its lines name an instance alike.
  { kind: OpenStackResourceKind.Instance, attribute: "openstack.instance_id" },
  { kind: OpenStackResourceKind.Volume, attribute: "openstack.volume_id" },
  { kind: OpenStackResourceKind.Snapshot, attribute: "openstack.snapshot_id" },
  { kind: OpenStackResourceKind.Backup, attribute: "openstack.backup_id" },
  { kind: OpenStackResourceKind.Network, attribute: "openstack.network_id" },
  { kind: OpenStackResourceKind.Subnet, attribute: "openstack.subnet_id" },
  { kind: OpenStackResourceKind.Router, attribute: "openstack.router_id" },
  {
    kind: OpenStackResourceKind.FloatingIp,
    attribute: "openstack.floating_ip_id",
  },
  { kind: OpenStackResourceKind.Image, attribute: "openstack.image_id" },
  { kind: OpenStackResourceKind.Project, attribute: "openstack.project_id" },
];

/*
 * The words in a path that say the next one is that kind's id. Placement calls an instance
 * a consumer, and its allocations are what ties a boot's Placement calls to the instance.
 * Nova's attachments name a volume under an instance.
 */
const PATH_COLLECTIONS: ReadonlyMap<string, OpenStackResourceKind> = new Map<
  string,
  OpenStackResourceKind
>([
  ["servers", OpenStackResourceKind.Instance],
  ["allocations", OpenStackResourceKind.Instance],
  ["volumes", OpenStackResourceKind.Volume],
  ["os-volume_attachments", OpenStackResourceKind.Volume],
  ["snapshots", OpenStackResourceKind.Snapshot],
  ["backups", OpenStackResourceKind.Backup],
  ["networks", OpenStackResourceKind.Network],
  ["subnets", OpenStackResourceKind.Subnet],
  ["routers", OpenStackResourceKind.Router],
  ["floatingips", OpenStackResourceKind.FloatingIp],
  ["images", OpenStackResourceKind.Image],
  ["projects", OpenStackResourceKind.Project],
]);

/*
 * The query parameters that name a part, as services ask each other: Nova finds an
 * instance's ports with device_id. A device_id can be a router's too, and then nothing of
 * that id is an instance, so nothing joins.
 */
const QUERY_PARAMETERS: ReadonlyMap<string, OpenStackResourceKind> = new Map<
  string,
  OpenStackResourceKind
>([
  ["device_id", OpenStackResourceKind.Instance],
  ["instance_uuid", OpenStackResourceKind.Instance],
  ["instance_id", OpenStackResourceKind.Instance],
  ["server_id", OpenStackResourceKind.Instance],
  ["volume_id", OpenStackResourceKind.Volume],
  ["network_id", OpenStackResourceKind.Network],
  ["subnet_id", OpenStackResourceKind.Subnet],
  ["router_id", OpenStackResourceKind.Router],
  ["project_id", OpenStackResourceKind.Project],
  ["tenant_id", OpenStackResourceKind.Project],
]);

export interface OpenStackTraceResource {
  kind: OpenStackResourceKind;
  id: string;
}

// A segment that says it is an API version: v2.1, v3, v2.0.
function isApiVersion(segment: string): boolean {
  if (segment.length < 2 || segment.charCodeAt(0) !== 118) {
    return false;
  }

  return isAllDigits(segment.slice(1).split(".").join(""));
}

/*
 * What a request's path and query say it touched. A deployment can put an API under a
 * prefix of its own (/compute/v2.1 on DevStack, /v2.1 on Kolla-Ansible), so a known word is
 * looked for rather than a position. Cinder's paths hold the project right after the
 * version: /v3/<project>/volumes.
 */
export function readOpenStackRequestResources(data: {
  path?: string | null | undefined;
  query?: string | null | undefined;
}): Array<OpenStackTraceResource> {
  const found: Array<OpenStackTraceResource> = [];
  const add: (kind: OpenStackResourceKind, id: string) => void = (
    kind: OpenStackResourceKind,
    id: string,
  ): void => {
    if (
      found.length < MAX_RESOURCES_OF_ONE_SPAN &&
      !found.some((known: OpenStackTraceResource): boolean => {
        return known.kind === kind && known.id === id;
      })
    ) {
      found.push({ kind: kind, id: id });
    }
  };

  const segments: Array<string> = (data.path || "").split("/");

  for (let index: number = 1; index < segments.length; index++) {
    const segment: string = segments[index] || "";

    if (!isResourceId(segment)) {
      continue;
    }

    const before: string = segments[index - 1] || "";
    const kind: OpenStackResourceKind | undefined = PATH_COLLECTIONS.get(before);

    if (kind) {
      add(kind, segment);
    } else if (isApiVersion(before)) {
      add(OpenStackResourceKind.Project, segment);
    }
  }

  for (const pair of (data.query || "").split("&")) {
    const equals: number = pair.indexOf("=");

    if (equals > 0) {
      const kind: OpenStackResourceKind | undefined = QUERY_PARAMETERS.get(
        pair.slice(0, equals),
      );
      const value: string = pair.slice(equals + 1);

      if (kind && isResourceId(value)) {
        add(kind, value);
      }
    }
  }

  return found;
}

// What a stored span's attributes say it touched: the one reading the pages use.
export function readOpenStackSpanResources(
  attributes: JSONObject | null | undefined,
): Array<OpenStackTraceResource> {
  const found: Array<OpenStackTraceResource> = [];

  if (!attributes) {
    return found;
  }

  for (const { kind, attribute } of OPENSTACK_TRACE_RESOURCE_ATTRIBUTES) {
    const value: unknown = attributes[attribute];

    if (typeof value === "string" && value) {
      found.push({ kind: kind, id: value });
    }
  }

  return found;
}

/*
 * ------------------------------------------------------------------
 * What a span says, read as it arrives
 * ------------------------------------------------------------------
 */

/*
 * The words the driver's rstrip("-start") eats the end of, put back. It takes any of the
 * characters - s t a r from the end, so what ends in one of those loses it.
 */
const DRIVER_NAME_REPAIRS: ReadonlyMap<string, string> = new Map<string, string>(
  [["schedule", "scheduler"]],
);

// A path with what makes it unique taken out, so the same call has the same name each time.
export function getOpenStackPathInSpanName(path: string): string {
  return path
    .split("/")
    .map((segment: string): string => {
      return isResourceId(segment) || isAllDigits(segment)
        ? ID_IN_NAME
        : segment;
    })
    .join("/");
}

/*
 * A traced function's name without its package: nova.compute.manager.ComputeManager.
 * build_and_run_instance reads ComputeManager.build_and_run_instance. The whole of it stays
 * in the `name` attribute.
 */
function getShortFunctionName(functionName: string): string {
  const last: number = functionName.lastIndexOf(".");

  if (last <= 0) {
    return functionName;
  }

  const beforeLast: number = functionName.lastIndexOf(".", last - 1);

  return beforeLast === -1 ? functionName : functionName.slice(beforeLast + 1);
}

/*
 * The name a span is stored under: what a person reading a waterfall wants, and the same
 * each time so operations group. What the driver wrote is:
 *
 *   WSGI_POST_/compute/v2.1/servers/<uuid>   a request a service answered
 *   REQUESTS_GET_10.0.0.1                    one it sent, with trace_requests on
 *   SQL_SELECT                               a statement, with trace_sqlalchemy on
 *   rpc, compute_api, neutron_api, ...       a traced function, whose name is in `name`
 */
export function readOpenStackDriverSpanName(data: {
  name: string;
  attributes: JSONObject;
}): string {
  const name: string = data.name;
  const path: unknown = data.attributes[HTTP_PATH_ATTRIBUTE];
  const method: unknown = data.attributes[HTTP_METHOD_ATTRIBUTE];

  if (
    (name.startsWith("WSGI_") || name.startsWith("REQUESTS_")) &&
    typeof method === "string" &&
    typeof path === "string"
  ) {
    return `${method} ${getOpenStackPathInSpanName(path)}`;
  }

  if (name.startsWith("SQL_")) {
    return `SQL ${name.slice("SQL_".length)}`;
  }

  const functionName: unknown =
    data.attributes[OpenStackTraceAttribute.FunctionName];
  const word: string = DRIVER_NAME_REPAIRS.get(name) || name;

  return typeof functionName === "string" && functionName
    ? `${word} ${getShortFunctionName(functionName)}`
    : word;
}

/*
 * The kind a span should be stored with. A service's own function is INTERNAL to the driver,
 * so a call from nova-api to nova-conductor crosses services with no span saying so. An RPC
 * call has two spans: Nova's rpcapi modules on the caller's side, and its manager modules on
 * the side that answers, whose parent is the caller's. Stored as PRODUCER and CONSUMER, they
 * are what they are, and the service map's own rule (a SERVER or CONSUMER span whose parent
 * is another service's) draws the edge.
 */
export function readOpenStackDriverSpanKind(data: {
  kind: OpenStackStoredSpanKind;
  name: string;
  attributes: JSONObject;
}): OpenStackStoredSpanKind {
  if (data.name.startsWith("WSGI_")) {
    return SPAN_KIND_SERVER;
  }

  const functionName: unknown =
    data.attributes[OpenStackTraceAttribute.FunctionName];

  if (data.name === "rpc" && typeof functionName === "string") {
    if (functionName.includes(".rpcapi.")) {
      return SPAN_KIND_PRODUCER;
    }

    if (functionName.includes(".manager.")) {
      return SPAN_KIND_CONSUMER;
    }
  }

  return data.kind;
}

/*
 * The parent a span really has. Before OSProfiler 4.4.0 a request's first span names one
 * that is never sent, the low 64 bits of the trace ID, as the driver cuts base_id down.
 */
export function readOpenStackDriverParentSpanId(data: {
  traceId: string;
  parentSpanId: string;
}): string {
  if (
    data.parentSpanId.length === SHORT_SPAN_ID_LENGTH &&
    data.traceId.length === HEX_ID_LENGTH &&
    data.traceId.endsWith(data.parentSpanId)
  ) {
    return "";
  }

  return data.parentSpanId;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function readEventAttributeText(event: JSONObject, key: string): string {
  const attributes: unknown = event["attributes"];

  return Array.isArray(attributes)
    ? readWireAttributeText(attributes as Array<JSONObject>, key)
    : "";
}

/*
 * The one thing a failed span's event holds that a person can write into: an exception's
 * message, which quotes what it was handed. Scrubbed in place.
 */
function scrubDriverEventsInPlace(events: unknown): void {
  if (!Array.isArray(events)) {
    return;
  }

  for (const event of events) {
    const attributes: unknown = (event as JSONObject)?.["attributes"];

    if (Array.isArray(attributes)) {
      for (const attribute of attributes as Array<JSONObject>) {
        const value: JSONObject | undefined = attribute["value"] as
          | JSONObject
          | undefined;
        const text: JSONValue | undefined = value?.["stringValue"];

        if (value && typeof text === "string") {
          value["stringValue"] = scrubOpenStackSecrets(text);
        }
      }
    }
  }
}

function readFailureMessage(events: unknown): string {
  if (!Array.isArray(events)) {
    return "";
  }

  for (const event of events) {
    const kind: string = readEventAttributeText(
      event as JSONObject,
      "error.kind",
    );
    const message: string = readEventAttributeText(
      event as JSONObject,
      "message",
    );

    if (kind || message) {
      const text: string = kind && message ? `${kind}: ${message}` : kind || message;

      return text.length > MAX_STATUS_MESSAGE_LENGTH
        ? text.slice(0, MAX_STATUS_MESSAGE_LENGTH)
        : text;
    }
  }

  return "";
}

/*
 * Nova's console tokens are a way into an instance's console, and this is the one place an
 * API holds a secret in its path rather than a header.
 */
function scrubPath(path: string): string {
  const word: string = "/os-console-auth-tokens/";
  const at: number = path.indexOf(word);

  if (at === -1) {
    return path;
  }

  const start: number = at + word.length;
  const end: number = path.indexOf("/", start);

  return `${path.slice(0, start)}${OPENSTACK_SCRUBBED_VALUE}${end === -1 ? "" : path.slice(end)}`;
}

export interface OpenStackDriverSpan {
  name: string;
  kind: OpenStackStoredSpanKind;
  parentSpanId: string;
  isFailed: boolean;
  statusMessage: string;
}

/*
 * One span of the driver's, as it arrives: what its row should say, with its attributes and
 * events put right in place. The caller hands over what it holds for this span alone: every
 * span has its own attribute map at ingest, and its own events on the wire.
 */
export function readOSProfilerSpanInPlace(data: {
  name: string;
  kind: OpenStackStoredSpanKind;
  traceId: string;
  parentSpanId: string;
  // Flat: the resource's under `resource.`, as a stored row holds them.
  attributes: JSONObject;
  // As they came, on the wire.
  events: unknown;
  service: OpenStackDriverService | null;
}): OpenStackDriverSpan {
  const attributes: JSONObject = data.attributes;

  for (const key of Object.keys(attributes)) {
    if (
      !OSPROFILER_ATTRIBUTES_KEPT.has(key) &&
      !ATTRIBUTE_PREFIXES_NOT_THE_DRIVERS.some((prefix: string): boolean => {
        return key.startsWith(prefix);
      })
    ) {
      delete attributes[key];
    }
  }

  // A secret in a query or a statement goes before anything is read from them.
  const path: unknown = attributes[HTTP_PATH_ATTRIBUTE];
  const query: unknown = attributes[HTTP_QUERY_ATTRIBUTE];

  if (typeof path === "string") {
    attributes[HTTP_PATH_ATTRIBUTE] = scrubPath(path);
  }

  if (typeof query === "string") {
    attributes[HTTP_QUERY_ATTRIBUTE] = scrubOpenStackSecrets(query);
  }

  if (typeof attributes[DB_STATEMENT_ATTRIBUTE] === "string") {
    attributes[DB_STATEMENT_ATTRIBUTE] = scrubOpenStackSecrets(
      attributes[DB_STATEMENT_ATTRIBUTE] as string,
    );
  }

  scrubDriverEventsInPlace(data.events);

  if (data.service) {
    attributes[OpenStackTraceAttribute.Service] = data.service.service;
    attributes[OpenStackTraceAttribute.Component] = data.service.component;
  }

  const resources: Array<OpenStackTraceResource> = readOpenStackRequestResources({
    path: attributes[HTTP_PATH_ATTRIBUTE] as string | undefined,
    query: attributes[HTTP_QUERY_ATTRIBUTE] as string | undefined,
  });

  for (const { kind, attribute } of OPENSTACK_TRACE_RESOURCE_ATTRIBUTES) {
    const resource: OpenStackTraceResource | undefined = resources.find(
      (candidate: OpenStackTraceResource): boolean => {
        return candidate.kind === kind;
      },
    );

    if (resource) {
      attributes[attribute] = resource.id;
    }
  }

  const statusCode: number = Number(attributes[STATUS_CODE_ATTRIBUTE]);
  const isFailed: boolean =
    isTrue(attributes[ERROR_ATTRIBUTE]) ||
    (Number.isFinite(statusCode) && statusCode >= 500);

  return {
    name: readOpenStackDriverSpanName({
      name: data.name,
      attributes: attributes,
    }),
    kind: readOpenStackDriverSpanKind({
      kind: data.kind,
      name: data.name,
      attributes: attributes,
    }),
    parentSpanId: readOpenStackDriverParentSpanId({
      traceId: data.traceId,
      parentSpanId: data.parentSpanId,
    }),
    isFailed: isFailed,
    statusMessage: isFailed ? readFailureMessage(data.events) : "",
  };
}

// The hostname a REQUESTS_ span went to, which the driver keeps and a person may look for.
export function readOpenStackDriverRequestHost(
  attributes: JSONObject,
): string {
  const host: unknown = attributes[HTTP_HOSTNAME_ATTRIBUTE];

  return typeof host === "string" ? host : "";
}

/*
 * ------------------------------------------------------------------
 * From what the client prints to the trace
 * ------------------------------------------------------------------
 */

/*
 * What the `openstack` client prints when a request was signed, as the trace it means:
 *
 *   Trace ID: 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee
 *
 * That is OSProfiler's base_id, and the driver turns it into the OTLP trace ID whole, as a
 * number, so the two differ only in the dashes. A whole pasted line is fine. Null when there
 * is no ID in it. The client's "short trace ID" is only the low half and cannot name a
 * trace, so it is not taken.
 */
export function readOpenStackTraceId(text: string | null | undefined): string | null {
  const input: string = (text || "").slice(0, MAX_TRACE_ID_INPUT_LENGTH);
  let start: number = 0;

  for (let index: number = 0; index <= input.length; index++) {
    const code: number = index < input.length ? input.charCodeAt(index) : 32;

    if (isHexCode(code) || code === 45) {
      continue;
    }

    const word: string = input.slice(start, index);

    if (isOpenStackDashedUuid(word)) {
      return word.split("-").join("").toLowerCase();
    }

    if (word.length === HEX_ID_LENGTH && isAllHex(word)) {
      return word.toLowerCase();
    }

    start = index + 1;
  }

  return null;
}

/*
 * ------------------------------------------------------------------
 * The command that signs a request, for this cloud
 * ------------------------------------------------------------------
 */

export const OPENSTACK_TRACE_INSTANCE_NAME: string = "oneuptime-trace-test";

// As a shell reads it: a name with anything but plain characters goes in single quotes.
export function quoteForOpenStackCommand(value: string): string {
  let isPlain: boolean = value.length > 0;

  for (let index: number = 0; index < value.length && isPlain; index++) {
    const code: number = value.charCodeAt(index);

    isPlain =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 45 ||
      code === 46 ||
      code === 95 ||
      code === 58;
  }

  return isPlain ? value : `'${value.split("'").join("'\\''")}'`;
}

function openStackCommand(data: {
  regionName?: string | null | undefined;
  words: Array<string>;
}): string {
  return [
    "openstack",
    ...(data.regionName
      ? [`--os-region-name ${quoteForOpenStackCommand(data.regionName)}`]
      : []),
    ...data.words,
  ].join(" ");
}

/*
 * Reads the key without echoing it. OS_PROFILE does what --os-profile does, and stays out of
 * the shell's history and the machine's process list. Every openstack command in this shell
 * is signed until OS_PROFILE is unset.
 */
export const OPENSTACK_TRACE_KEY_COMMAND: string =
  "read -rs OS_PROFILE && export OS_PROFILE";

export const OPENSTACK_TRACE_END_COMMAND: string = "unset OS_PROFILE";

// A read that changes nothing, to prove the wiring.
export function getOpenStackTraceListCommand(data: {
  regionName?: string | null | undefined;
}): string {
  return openStackCommand({
    regionName: data.regionName,
    words: ["server", "list"],
  });
}

// What a value not known is written as, for the person to fill in.
const UNKNOWN_FLAVOR: string = "<flavor>";
const UNKNOWN_IMAGE: string = "<image>";
const UNKNOWN_NETWORK: string = "<network>";

export function getOpenStackTraceBootCommand(data: {
  regionName?: string | null | undefined;
  flavor?: string | null | undefined;
  image?: string | null | undefined;
  network?: string | null | undefined;
}): string {
  return openStackCommand({
    regionName: data.regionName,
    words: [
      "server",
      "create",
      "--wait",
      "--flavor",
      data.flavor ? quoteForOpenStackCommand(data.flavor) : UNKNOWN_FLAVOR,
      "--image",
      data.image ? quoteForOpenStackCommand(data.image) : UNKNOWN_IMAGE,
      "--network",
      data.network ? quoteForOpenStackCommand(data.network) : UNKNOWN_NETWORK,
      OPENSTACK_TRACE_INSTANCE_NAME,
    ],
  });
}

export function getOpenStackTraceDeleteCommand(data: {
  regionName?: string | null | undefined;
}): string {
  return openStackCommand({
    regionName: data.regionName,
    words: ["server", "delete", "--wait", OPENSTACK_TRACE_INSTANCE_NAME],
  });
}

/*
 * ------------------------------------------------------------------
 * What a cloud's spans say about its tracing
 * ------------------------------------------------------------------
 */

// A row of the Span table, as far as this reads one.
export interface OpenStackTraceRow {
  startTime?: Date | string | null | undefined;
  traceId?: string | null | undefined;
  attributes?: JSONObject | null | undefined;
}

export interface OpenStackTracedServices {
  lastSpanAt: Date | null;
  // Which services have sent a span, by the word an operator knows.
  services: Array<string>;
  // The traces these rows belong to, the newest first.
  traceIds: Array<string>;
}

// Whether tracing is working, as far as a cloud's own spans can say.
export function readOpenStackTracedServices(
  rows: ReadonlyArray<OpenStackTraceRow>,
): OpenStackTracedServices {
  const services: Set<string> = new Set<string>();
  const newestOfTrace: Map<string, number> = new Map<string, number>();
  let last: number = 0;

  for (const row of rows) {
    const service: unknown = row.attributes?.[OpenStackTraceAttribute.Service];

    if (typeof service === "string" && service) {
      services.add(service);
    }

    const time: number = row.startTime ? new Date(row.startTime).getTime() : 0;
    const at: number = Number.isNaN(time) ? 0 : time;

    last = Math.max(last, at);

    if (row.traceId) {
      newestOfTrace.set(
        row.traceId,
        Math.max(newestOfTrace.get(row.traceId) || 0, at),
      );
    }
  }

  return {
    lastSpanAt: last ? new Date(last) : null,
    services: Array.from(services).sort(),
    traceIds: Array.from(newestOfTrace.entries())
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1];
      })
      .map((entry: [string, number]): string => {
        return entry[0];
      }),
  };
}

/*
 * The word for an API by its row's service type. Its row is named for its type in Keystone's
 * catalog, and a trace knows it by the binary that answers.
 */
const TRACED_SERVICE_OF_API: Readonly<Record<string, string>> = {
  compute: "nova-api",
  identity: "keystone",
  image: "glance-api",
  network: "neutron-server",
  placement: "placement-api",
  volume: "cinder-api",
};

export function getOpenStackTracedServiceOfApi(serviceType: string): string {
  return TRACED_SERVICE_OF_API[serviceType] || "";
}

// Which service type answers to a traced service, so a trace can link to its API's page.
export function getOpenStackApiOfTracedService(service: string): string | null {
  for (const [serviceType, traced] of Object.entries(TRACED_SERVICE_OF_API)) {
    if (traced === service) {
      return serviceType;
    }
  }

  return null;
}
