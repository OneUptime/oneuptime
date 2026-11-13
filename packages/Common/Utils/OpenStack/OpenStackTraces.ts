import { JSONObject, JSONValue } from "../../Types/JSON";
import type { SpanKind } from "../../Models/AnalyticsModels/Span";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_SCRUBBED_VALUE,
  scrubOpenStackSecrets,
} from "./OpenStackLogScrub";

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
 *     cut by Python's rstrip("-start"), which takes characters and not a suffix: vif_driver
 *     arrives as "vif_drive".
 *   - A span's status is never set. A failure is an `error` attribute and a "log" event, and
 *     most of those on a real cloud are the client looking a name up as an id first.
 *   - Its kind is guessed from words in the name, so every RPC call is INTERNAL, which leaves
 *     Nova's own hops off any service map, and a call inside nova-api that has "api" in its
 *     name is CLIENT.
 *   - Before OSProfiler 4.4.0, a request's first span has a parent that is never sent: the
 *     low 64 bits of the trace ID (OSProfiler bug 2132957). Nothing would read it as a root.
 *   - A service that forks its workers after making its driver sends nothing from them, so a
 *     span whose parent was in one names a parent that never arrives: nova-compute's
 *     build_and_run_instance does, under nova-conductor. That one is really missing, so it
 *     stays as it came, and the trace's page says why.
 *   - `args`, `kwargs`, `result` and `db.params` hold what a traced call was handed, written
 *     out as Python would print it: an instance's admin password and user data, a volume's
 *     connection info. They never reach storage, whatever a project's rules say.
 *
 * So every span in the driver's scope goes through this as it arrives, before drop filters,
 * scrub rules and pipelines, so they and the pages see it as it is read here. Everything
 * here is held to what the driver really sent on a real cloud: see
 * Tests/Ops/openstack-e2e/traces-record.sh, the recordings in
 * Common/Tests/Fixtures/OpenStack/traces/<release>, and OpenStackTracesRecordings.test.ts.
 *
 * Spans are text anyone holding the key can write into, so a value is read with indexOf and
 * loops, never a regular expression with a quantifier (Docs/notifications/README.md,
 * "Megabyte-long values").
 *
 * These attribute keys are stored in customers' traces: never rename one.
 */

// The scope the driver's tracer is created under: `get_tracer(__name__)`.
export const OSPROFILER_DRIVER_SCOPE_NAME: string = "osprofiler.drivers.otlp";
// OpenStack's own tracing, on the releases that ship it: readOpenStackNativeSpanInPlace.
export const OSLO_MESSAGING_SCOPE_NAME: string = "oslo.messaging";
export const OSLO_MIDDLEWARE_SCOPE_NAME: string = "oslo_middleware.tracing";
export const OPENSTACK_TRACE_SCOPE_NAMES: ReadonlyArray<string> = [
  OSPROFILER_DRIVER_SCOPE_NAME,
  OSLO_MIDDLEWARE_SCOPE_NAME,
  OSLO_MESSAGING_SCOPE_NAME,
];

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
// What oslo.messaging writes on a span: the same request ID a service's log lines hold.
export const OPENSTACK_REQUEST_ID_SPAN_ATTRIBUTE: string =
  "openstack.request_id";
export const OPENSTACK_GLOBAL_REQUEST_ID_SPAN_ATTRIBUTE: string =
  "openstack.global_request_id";

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
const HTTP_URL_ATTRIBUTE: string = "http.url";
const HTTP_ROUTE_ATTRIBUTE: string = "http.route";
const HTTP_STATUS_CODE_ATTRIBUTE: string = "http.status_code";
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
const SPAN_KIND_INTERNAL: OpenStackStoredSpanKind = "SPAN_KIND_INTERNAL";
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

export function isOpenStackNativeScope(scope: unknown): boolean {
  if (!scope || typeof scope !== "object") {
    return false;
  }

  const name: unknown = (scope as JSONObject)["name"];

  return (
    name === OSLO_MESSAGING_SCOPE_NAME || name === OSLO_MIDDLEWARE_SCOPE_NAME
  );
}

/*
 * Whether a block of OTLP holds OpenStack's spans: its scope is the one thing that says so. On a
 * cloud with OSProfiler on, oslo's spans leave through OSProfiler's driver, so a block with nothing
 * signed holds only theirs, under the same service.name.
 */
function holdsDriverSpans(resourceSpans: JSONObject): boolean {
  const scopeSpans: unknown = resourceSpans["scopeSpans"];

  if (!Array.isArray(scopeSpans)) {
    return false;
  }

  for (const scopeSpan of scopeSpans) {
    const scope: unknown = (scopeSpan as JSONObject)?.["scope"];

    if (isOSProfilerDriverScope(scope) || isOpenStackNativeScope(scope)) {
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
      cloudName: readWireAttributeText(
        wire,
        OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
      ),
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
 * that id is an instance, so nothing joins. The same parameter given several times is a
 * list, as `server list` asks for every instance's ports at once: that is about none of
 * them, so it names none.
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
    const kind: OpenStackResourceKind | undefined =
      PATH_COLLECTIONS.get(before);

    if (kind) {
      add(kind, segment);
    } else if (isApiVersion(before)) {
      add(OpenStackResourceKind.Project, segment);
    }
  }

  const valuesOfParameter: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  for (const pair of (data.query || "").split("&")) {
    const equals: number = pair.indexOf("=");

    if (equals > 0) {
      const parameter: string = pair.slice(0, equals);

      if (QUERY_PARAMETERS.has(parameter)) {
        const values: Set<string> =
          valuesOfParameter.get(parameter) || new Set<string>();

        values.add(pair.slice(equals + 1));
        valuesOfParameter.set(parameter, values);
      }
    }
  }

  for (const [parameter, values] of valuesOfParameter) {
    const value: string | undefined =
      values.size === 1 ? Array.from(values)[0] : undefined;

    if (value && isResourceId(value)) {
      add(QUERY_PARAMETERS.get(parameter)!, value);
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
 * characters - s t a r from the end, so what ends in one of those loses it. These are the
 * names OpenStack's own trace_cls calls give that do; the rest (rpc, compute_api, neutron_api,
 * volume_api, nova_image) come through whole.
 */
const DRIVER_NAME_REPAIRS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["drive", "driver"],
  ["vif_drive", "vif_driver"],
  ["schedule", "scheduler"],
  ["l3-agen", "l3-agent"],
  ["ovs_dvr_agen", "ovs_dvr_agent"],
]);

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
function getShortFunctionName(wholeName: string): string {
  // A closure: oslo_messaging.rpc.server.expected_exceptions.<locals>.outer.<locals>.inner
  const closure: number = wholeName.indexOf(".<locals>");
  const functionName: string =
    closure === -1 ? wholeName : wholeName.slice(0, closure);
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
 * so a call from nova-api to nova-compute crosses services with no span saying so. An RPC
 * call has two spans: Nova's rpcapi modules on the caller's side, and its manager modules on
 * the side that answers, whose parent is the caller's. Stored as PRODUCER and CONSUMER, they
 * are what they are.
 *
 * The driver calls anything with "api" in its name a CLIENT, which is every span named
 * compute_api or neutron_api: functions inside the service, the second of them a tenth of a
 * millisecond spent finding a method. A CLIENT is a call that leaves a service, so a traced
 * function other than RPC is INTERNAL, and SQL and an HTTP call stay what they came as.
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

  if (typeof functionName !== "string" || !functionName) {
    return data.kind;
  }

  if (data.name === "rpc") {
    if (functionName.includes(".rpcapi.")) {
      return SPAN_KIND_PRODUCER;
    }

    // nova-scheduler's is the wrapper oslo.messaging puts around the method, and is all it sends.
    if (
      functionName.includes(".manager.") ||
      functionName.startsWith("oslo_messaging.rpc.server.")
    ) {
      return SPAN_KIND_CONSUMER;
    }
  }

  return SPAN_KIND_INTERNAL;
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

/*
 * Whether what went wrong in this span is only something not being there. `openstack server
 * show <name>` asks for the name as an id first, which is how every OpenStack client finds
 * a thing by name, so Nova raises InstanceNotFound on a request that is about to succeed. On
 * a real cloud those were most of the failures the driver wrote. The event stays on the
 * span, and the status stays for what really failed.
 */
function isOnlyNotFound(events: unknown): boolean {
  if (!Array.isArray(events)) {
    return false;
  }

  for (const event of events) {
    const kind: string = readEventAttributeText(
      event as JSONObject,
      "error.kind",
    );

    if (kind) {
      return kind.endsWith("NotFound");
    }
  }

  return false;
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
      const text: string =
        kind && message ? `${kind}: ${message}` : kind || message;

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

/*
 * Traced functions that only hand back another. Nova's ClientWrapper.proxy finds the Neutron
 * client's method: a tenth of a millisecond, with nothing under it, and the call it leads to is
 * a span of its own beside it. That is a quarter of a real boot's spans, one line in a waterfall
 * for every call to Neutron, and enough of them under one parent to read as an N+1. So they
 * are not kept.
 */
const FUNCTIONS_THAT_SAY_NOTHING: ReadonlySet<string> = new Set<string>([
  "nova.network.neutron.ClientWrapper.proxy",
]);

// What a request's path and query name, each under its own attribute, for its part's page.
function writeRequestResources(attributes: JSONObject): void {
  const resources: Array<OpenStackTraceResource> =
    readOpenStackRequestResources({
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
}

export interface OpenStackDriverSpan {
  name: string;
  kind: OpenStackStoredSpanKind;
  parentSpanId: string;
  isFailed: boolean;
  statusMessage: string;
  // Not worth a row: see FUNCTIONS_THAT_SAY_NOTHING.
  saysNothing: boolean;
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

  writeRequestResources(attributes);

  const statusCode: number = Number(attributes[STATUS_CODE_ATTRIBUTE]);
  const isFailed: boolean =
    (isTrue(attributes[ERROR_ATTRIBUTE]) && !isOnlyNotFound(data.events)) ||
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
    saysNothing:
      !isFailed &&
      FUNCTIONS_THAT_SAY_NOTHING.has(
        String(attributes[OpenStackTraceAttribute.FunctionName] || ""),
      ),
  };
}

/*
 * ------------------------------------------------------------------
 * OpenStack's own tracing
 * ------------------------------------------------------------------
 *
 * oslo.middleware 8.2.0 and oslo.messaging 18.3.1 trace with nothing signed. What they write was
 * read from Tests/Ops/openstack-e2e/traces-record.sh's native-* scenes, and is plainer than the
 * driver's: a span is what it says it is, so its kind and parent stand as they came.
 *
 *   oslo_middleware.tracing   HTTP POST /servers, SERVER, with http.url and http.status_code
 *   oslo.messaging            conductor.schedule_and_build_instances, PRODUCER, and
 *                             schedule_and_build_instances receive, CONSUMER, with
 *                             openstack.request_id
 *
 * Kept by name, for the same reason the driver's are.
 */
const OPENSTACK_NATIVE_ATTRIBUTES_KEPT: ReadonlySet<string> = new Set<string>([
  HTTP_METHOD_ATTRIBUTE,
  HTTP_ROUTE_ATTRIBUTE,
  HTTP_STATUS_CODE_ATTRIBUTE,
  "http.user_agent",
  "messaging.system",
  "messaging.operation",
  "messaging.destination.name",
  "messaging.message.id",
  "rpc.method",
  "rpc.service",
  OPENSTACK_REQUEST_ID_SPAN_ATTRIBUTE,
  OPENSTACK_GLOBAL_REQUEST_ID_SPAN_ATTRIBUTE,
  "openstack.project_id",
  "openstack.user_id",
  "openstack.domain_id",
]);

// A URL's path and query, without reading it twice: this is what anyone could have asked for.
function readPathAndQueryOfUrl(url: string): { path: string; query: string } {
  const scheme: number = url.indexOf("://");
  const pathAt: number = url.indexOf("/", scheme === -1 ? 0 : scheme + 3);

  if (pathAt === -1) {
    return { path: "", query: "" };
  }

  const queryAt: number = url.indexOf("?", pathAt);

  return queryAt === -1
    ? { path: url.slice(pathAt), query: "" }
    : { path: url.slice(pathAt, queryAt), query: url.slice(queryAt + 1) };
}

function isErrorStatus(status: unknown): boolean {
  const code: unknown = (status as JSONObject | null | undefined)?.["code"];

  return code === 2 || code === "STATUS_CODE_ERROR";
}

/*
 * One span of oslo's, as it arrives. Its URL becomes the path and query the driver's spans hold,
 * so a request's name, the parts it names and the log line it is held to are the same whichever
 * of the two sent it. Its address and what else it held go.
 */
export function readOpenStackNativeSpanInPlace(data: {
  name: string;
  kind: OpenStackStoredSpanKind;
  parentSpanId: string;
  attributes: JSONObject;
  events: unknown;
  // As it came, on the wire. oslo.messaging sets it from what a call raised.
  status: unknown;
  service: OpenStackDriverService | null;
}): OpenStackDriverSpan {
  const attributes: JSONObject = data.attributes;
  const url: unknown = attributes[HTTP_URL_ATTRIBUTE];
  const route: unknown = attributes[HTTP_ROUTE_ATTRIBUTE];
  const asked: { path: string; query: string } =
    typeof url === "string"
      ? readPathAndQueryOfUrl(url)
      : { path: typeof route === "string" ? route : "", query: "" };

  for (const key of Object.keys(attributes)) {
    if (
      !OPENSTACK_NATIVE_ATTRIBUTES_KEPT.has(key) &&
      !ATTRIBUTE_PREFIXES_NOT_THE_DRIVERS.some((prefix: string): boolean => {
        return key.startsWith(prefix);
      })
    ) {
      delete attributes[key];
    }
  }

  // http.route is the path as the service sees it, so a console's token in it goes too.
  if (typeof route === "string") {
    attributes[HTTP_ROUTE_ATTRIBUTE] = scrubPath(route);
  }

  if (asked.path) {
    attributes[HTTP_PATH_ATTRIBUTE] = scrubPath(asked.path);
  }

  if (asked.query) {
    attributes[HTTP_QUERY_ATTRIBUTE] = scrubOpenStackSecrets(asked.query);
  }

  scrubDriverEventsInPlace(data.events);

  if (data.service) {
    attributes[OpenStackTraceAttribute.Service] = data.service.service;
    attributes[OpenStackTraceAttribute.Component] = data.service.component;
  }

  writeRequestResources(attributes);

  const method: unknown = attributes[HTTP_METHOD_ATTRIBUTE];
  const path: unknown = attributes[HTTP_PATH_ATTRIBUTE];
  const statusCode: number = Number(attributes[HTTP_STATUS_CODE_ATTRIBUTE]);
  const isServerError: boolean =
    Number.isFinite(statusCode) && statusCode >= 500;
  const raised: boolean = isErrorStatus(data.status);
  const raisedMessage: unknown = (
    data.status as JSONObject | null | undefined
  )?.["message"];

  return {
    name:
      data.name.startsWith("HTTP ") &&
      typeof method === "string" &&
      typeof path === "string"
        ? `${method} ${getOpenStackPathInSpanName(path)}`
        : data.name,
    kind: data.kind,
    parentSpanId: data.parentSpanId,
    isFailed: isServerError || raised,
    // Its first line: what follows is a traceback, which its exception event holds.
    statusMessage: raised
      ? scrubOpenStackSecrets(String(raisedMessage || ""))
          .slice(0, MAX_STATUS_MESSAGE_LENGTH)
          .split("\n")[0]!
          .trim()
      : isServerError
        ? `HTTP ${statusCode}`
        : "",
    saysNothing: false,
  };
}

// The hostname a REQUESTS_ span went to, which the driver keeps and a person may look for.
export function readOpenStackDriverRequestHost(attributes: JSONObject): string {
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
export function readOpenStackTraceId(
  text: string | null | undefined,
): string | null {
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
  parentSpanId?: string | { toString: () => string } | null | undefined;
  attributes?: JSONObject | null | undefined;
}

/*
 * Who sent a trace. It changes what a page can say of it: OSProfiler only sends what someone
 * signed, across every service it reached, and oslo sends every API request, joined over RPC
 * and not over HTTP unless a cloud added the guide's line to keystoneauth.
 */
export enum OpenStackTraceSource {
  OSProfiler = "osprofiler",
  Native = "native",
}

export function getOpenStackTraceSource(
  attributes: JSONObject | null | undefined,
): OpenStackTraceSource | null {
  const scope: unknown = attributes?.[OSPROFILER_SCOPE_SPAN_ATTRIBUTE];

  if (scope === OSPROFILER_DRIVER_SCOPE_NAME) {
    return OpenStackTraceSource.OSProfiler;
  }

  return scope === OSLO_MESSAGING_SCOPE_NAME ||
    scope === OSLO_MIDDLEWARE_SCOPE_NAME
    ? OpenStackTraceSource.Native
    : null;
}

/*
 * Whether a span shows oslo's HTTP span carrying on a trace from another service. oslo.middleware
 * reads traceparent as it comes in and nothing sends one as OpenStack ships, so a parent here is
 * the guide's line in keystoneauth at work.
 */
export function isOpenStackTraceCarriedOverHttp(row: {
  parentSpanId?: string | { toString: () => string } | null | undefined;
  attributes?: JSONObject | null | undefined;
}): boolean {
  return (
    row.attributes?.[OSPROFILER_SCOPE_SPAN_ATTRIBUTE] ===
      OSLO_MIDDLEWARE_SCOPE_NAME && Boolean(row.parentSpanId?.toString())
  );
}

export interface OpenStackTracedServices {
  lastSpanAt: Date | null;
  // Which services have sent a span, by the word an operator knows.
  services: Array<string>;
  // The traces these rows belong to, the newest first.
  traceIds: Array<string>;
  /*
   * The same, those that cross the most services first. What a map is drawn from: with nothing
   * signed, the newest traces are whatever a poller last asked one API for.
   */
  widestTraceIds: Array<string>;
  // Who sent them. Both, on a cloud with oslo's on where someone also signed a request.
  sources: Array<OpenStackTraceSource>;
  carriedOverHttp: boolean;
}

// Whether tracing is working, as far as a cloud's own spans can say.
export function readOpenStackTracedServices(
  rows: ReadonlyArray<OpenStackTraceRow>,
): OpenStackTracedServices {
  const services: Set<string> = new Set<string>();
  const newestOfTrace: Map<string, number> = new Map<string, number>();
  const servicesOfTrace: Map<string, Set<string>> = new Map();
  const sources: Set<OpenStackTraceSource> = new Set<OpenStackTraceSource>();
  let carriedOverHttp: boolean = false;
  let last: number = 0;

  for (const row of rows) {
    const service: unknown = row.attributes?.[OpenStackTraceAttribute.Service];
    const source: OpenStackTraceSource | null = getOpenStackTraceSource(
      row.attributes,
    );

    if (source) {
      sources.add(source);
    }

    carriedOverHttp = carriedOverHttp || isOpenStackTraceCarriedOverHttp(row);

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

      if (typeof service === "string" && service) {
        const ofTrace: Set<string> =
          servicesOfTrace.get(row.traceId) || new Set<string>();

        ofTrace.add(service);
        servicesOfTrace.set(row.traceId, ofTrace);
      }
    }
  }

  const traceIds: Array<string> = Array.from(newestOfTrace.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1];
    })
    .map((entry: [string, number]): string => {
      return entry[0];
    });
  const widthOf: (traceId: string) => number = (traceId: string): number => {
    return servicesOfTrace.get(traceId)?.size || 0;
  };

  return {
    lastSpanAt: last ? new Date(last) : null,
    services: Array.from(services).sort(),
    traceIds: traceIds,
    // A sort that keeps its ties in order, so the newest of the same width come first.
    widestTraceIds: [...traceIds].sort((a: string, b: string): number => {
      return widthOf(b) - widthOf(a);
    }),
    sources: Array.from(sources).sort(),
    carriedOverHttp: carriedOverHttp,
  };
}

/*
 * ------------------------------------------------------------------
 * What a trace cannot show
 * ------------------------------------------------------------------
 */

/*
 * The services a signed request crosses that send no span on a stock cloud, each for its own
 * reason, as Tests/Ops/openstack-e2e/traces-record.sh recorded them. A page says these out loud,
 * because a boot's trace that has no scheduler in it reads as if nothing was scheduled.
 */
export enum OpenStackTraceGap {
  /*
   * Placement keeps a config of its own, and OSProfiler registers [profiler_otlp] on the global
   * one only, so the driver's first read of it ends the driver: "no such option profiler_otlp".
   * One line in Placement's code fixes it, and the guide gives it.
   */
  DriverCannotStart = "driver-cannot-start",
  /*
   * On eventlet it makes its driver and then forks its workers, and nothing made in a worker
   * arrived. One worker runs in the process that made the driver, so nothing has to survive a
   * fork, which the rig's signed-boot-whole scene proved on 2025.2. On 2026.2 they run on threads
   * and send spans as they are, and a page then simply lists them as sent.
   */
  ForkedWorkers = "forked-workers",
  // The same, with no setting for it: cinder-volume forks a process per backend, on 2026.2 too.
  AlwaysForks = "always-forks",
}

const OPENSTACK_TRACE_GAPS: ReadonlyMap<string, OpenStackTraceGap> = new Map<
  string,
  OpenStackTraceGap
>([
  ["placement-api", OpenStackTraceGap.DriverCannotStart],
  ["nova-conductor", OpenStackTraceGap.ForkedWorkers],
  ["nova-scheduler", OpenStackTraceGap.ForkedWorkers],
  ["cinder-volume", OpenStackTraceGap.AlwaysForks],
]);

export function getOpenStackTraceGap(
  service: string,
): OpenStackTraceGap | null {
  return OPENSTACK_TRACE_GAPS.get(service) || null;
}

// The services a stock cloud leaves out of a trace, but for any this one has shown it can send.
export function getOpenStackServicesLeftOutOfTraces(
  servicesSeen: ReadonlyArray<string>,
): Array<string> {
  return Array.from(OPENSTACK_TRACE_GAPS.keys())
    .filter((service: string): boolean => {
      return !servicesSeen.includes(service);
    })
    .sort();
}

/*
 * Whether any span names a parent that never arrived. Ingest reads a request's first span as a
 * root, so what is left of these is a span under something that sent nothing.
 */
export function hasOpenStackSpanMissingItsParent(
  spans: ReadonlyArray<{
    spanId?: string | null | undefined;
    parentSpanId?: string | null | undefined;
  }>,
): boolean {
  const ids: Set<string> = new Set<string>();

  for (const span of spans) {
    if (span.spanId) {
      ids.add(span.spanId);
    }
  }

  return spans.some((span: { parentSpanId?: string | null | undefined }) => {
    return Boolean(span.parentSpanId) && !ids.has(span.parentSpanId!);
  });
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
