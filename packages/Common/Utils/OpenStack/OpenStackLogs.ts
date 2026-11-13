import { getOpenStackShortHostName } from "../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_NOTIFICATION_LOGGER_PREFIX,
  OpenStackEvent,
  OpenStackEventAttribute,
  readOpenStackNotification,
} from "./OpenStackNotifications";
import {
  removeOpenStackSecretFields,
  scrubOpenStackSecrets,
  stripAnsiCodes,
} from "./OpenStackLogScrub";

/*
 * AN OPENSTACK SERVICE'S LOG LINE, READ AS IT ARRIVES.
 *
 * "Why did this instance fail to build?" lives in logs across nova-api, nova-conductor,
 * nova-scheduler, nova-compute, Neutron and Cinder, on several hosts. OpenStack's services
 * all log through oslo.log, so a line can say which service wrote it, for which request,
 * for whom, about which instance, whichever deployment tool put it where. The ingest reads
 * every record of a cloud through stampOpenStackLogRecord, before its drop filters and
 * pipelines, so they and the pages see it as it is read here.
 *
 * What a line looks like depends on who configured it, and none of it is what the
 * documentation's one format string says:
 *
 *   oslo.log's default, as Kolla-Ansible's and OpenStack-Helm's services write it:
 *     2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [req-g req-r 1a2b 3c4d - - default default] [instance: <uuid>] Failed
 *   DevStack, in the journal: no time and no process, in colour, with names and not ids:
 *     ERROR nova.compute.manager [None req-r demo admin] [instance: <uuid>] Failed
 *   One line per line of a traceback, each with its own prefix and no [context]:
 *     2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [instance: <uuid>] Traceback (most recent call last):
 *   oslo.log's JSON formatter, with use_json on.
 *   oslo.log's own journal handler, with use_journal on, as OpenStack-Ansible sets it,
 *     whose fields the agent hands over beside the line (journald.*).
 *
 * Logs are text anyone can write into. Nothing here runs a regular expression with a
 * quantifier: lines are read with indexOf and loops, so the time this takes is in line
 * with the record however long it is and whatever it holds
 * (Docs/notifications/README.md, "Megabyte-long values", and the hostile shapes in
 * OpenStackLogs.test.ts). The most this reads of one record is
 * MAX_OPENSTACK_LOG_BODY_LENGTH, and what is past it is not stored: an unread stretch
 * could hold what the scrub is there to take out.
 *
 * These attribute keys are stored in customers' logs and monitors: never rename one.
 */

export enum OpenStackLogAttribute {
  Service = "openstack.service",
  Component = "openstack.component",
  Logger = "openstack.logger",
  Host = "openstack.host",
  RequestId = "openstack.request_id",
  GlobalRequestId = "openstack.global_request_id",
  /*
   * What a request's lines have in common across services: its global ID where it has
   * one, else its own. Nova hands its own request ID to Neutron and Cinder as their global
   * ID, so every line of one build holds the same value here.
   */
  RequestRootId = "openstack.request_root_id",
  UserId = "openstack.user_id",
  UserName = "openstack.user_name",
  ProjectId = "openstack.project_id",
  ProjectName = "openstack.project_name",
  InstanceId = "openstack.instance_id",
  // oslo.log's own word: DEBUG, INFO, WARNING, ERROR, CRITICAL.
  Level = "openstack.log.level",
  Format = "openstack.log.format",
  // A failure every operator knows by its words: see OpenStackLogAlertTemplates.
  Signal = "openstack.log.signal",
  // A load balancer's check of a service, which is most of a quiet API's log.
  Noise = "openstack.log.noise",
}

// The resource attribute the agent stamps on every record of a cloud, as logs store it.
export const OPENSTACK_CLOUD_LOG_ATTRIBUTE: string =
  "resource.openstack.cloud.name";
export const OPENSTACK_REGION_LOG_ATTRIBUTE: string =
  "resource.openstack.region.name";

export enum OpenStackLogFormat {
  Oslo = "oslo",
  OsloJson = "oslo-json",
  // A notification or an instance action sent to OneUptime as JSON on its own.
  Notification = "notification",
  // Anything else a service's unit wrote: uWSGI's own lines, say.
  Other = "other",
}

export enum OpenStackLogSignal {
  NoValidHost = "no-valid-host",
  RabbitMqConnectionLost = "rabbitmq-connection-lost",
  DatabaseConnectionLost = "database-connection-lost",
  TokenValidationFailing = "token-validation-failing",
}

export const OPENSTACK_LOG_NOISE_HEALTH_CHECK: string = "health-check";

/*
 * The most of one record that is read and stored. A real one is far shorter: the agent
 * joins a traceback up to 256 KiB, and a notification is a few KiB.
 */
export const MAX_OPENSTACK_LOG_BODY_LENGTH: number = 1024 * 1024;

const TRUNCATED_NOTE: string = "… (truncated by OneUptime)";

// What Python starts a stack trace with.
const TRACEBACK_START: string = "Traceback (most recent call last)";

// The first line is all that is read for a line's fields.
const MAX_HEADER_LENGTH: number = 16 * 1024;
const MAX_LOGGER_LENGTH: number = 200;
const MAX_CONTEXT_LENGTH: number = 1024;
const MAX_ATTRIBUTE_LENGTH: number = 255;
// How far into a record its failure's words are looked for.
const MAX_SIGNAL_SCAN_LENGTH: number = 64 * 1024;
const MAX_INSTANCE_MENTION_SCAN_LENGTH: number = 4 * 1024;

const UUID_LENGTH: number = 36;

export interface OpenStackLogLine {
  format: OpenStackLogFormat;
  time: Date | null;
  processId: string;
  level: string;
  logger: string;
  requestId: string;
  globalRequestId: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  instanceId: string;
  hostname: string;
  message: string;
}

export interface OpenStackLogStamp {
  // Written over whatever the record carried under the same keys.
  attributes: Record<string, string>;
  // What came out of the record for good: a traceback the agent handed over beside it.
  removedAttributes: Array<string>;
  // Null keeps the severity the record came with.
  severityNumber: number | null;
  // When the line says it happened: for a record that came without a time.
  time: Date | null;
  body: string;
  event: OpenStackEvent | null;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isUpperCaseLetter(code: number): boolean {
  return code >= 65 && code <= 90;
}

function cut(value: string, limit: number = MAX_ATTRIBUTE_LENGTH): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

// Never half of a character that takes two: storage refuses what is left of one.
function cutWhole(value: string, limit: number): string {
  const lastKept: number = value.charCodeAt(limit - 1);

  return value.slice(
    0,
    lastKept >= 0xd800 && lastKept <= 0xdbff ? limit - 1 : limit,
  );
}

function readDigits(text: string, from: number, count: number): number | null {
  if (from + count > text.length) {
    return null;
  }

  let value: number = 0;

  for (let index: number = from; index < from + count; index++) {
    const code: number = text.charCodeAt(index);

    if (!isDigit(code)) {
      return null;
    }

    value = value * 10 + (code - 48);
  }

  return value;
}

/*
 * oslo.log's asctime and msecs, at the start of a line: 2026-10-30 10:00:00.123, in the
 * machine's zone with none written. Read as UTC: the agent reads it first, in the zone it
 * is told, so this only says when for a record with no time of its own.
 */
function readLineTime(
  text: string,
  from: number,
): { time: Date; length: number } | null {
  const year: number | null = readDigits(text, from, 4);
  const month: number | null = readDigits(text, from + 5, 2);
  const day: number | null = readDigits(text, from + 8, 2);
  const hour: number | null = readDigits(text, from + 11, 2);
  const minute: number | null = readDigits(text, from + 14, 2);
  const second: number | null = readDigits(text, from + 17, 2);
  const milliseconds: number | null = readDigits(text, from + 20, 3);

  if (
    year === null ||
    month === null ||
    day === null ||
    hour === null ||
    minute === null ||
    second === null ||
    milliseconds === null ||
    text.charAt(from + 4) !== "-" ||
    text.charAt(from + 7) !== "-" ||
    (text.charAt(from + 10) !== " " && text.charAt(from + 10) !== "T") ||
    text.charAt(from + 13) !== ":" ||
    text.charAt(from + 16) !== ":" ||
    (text.charAt(from + 19) !== "." && text.charAt(from + 19) !== ",")
  ) {
    return null;
  }

  const time: Date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, milliseconds),
  );

  return Number.isNaN(time.getTime()) ? null : { time, length: 23 };
}

const LEVELS: ReadonlySet<string> = new Set([
  "TRACE",
  "DEBUG",
  "INFO",
  "AUDIT",
  "WARNING",
  "WARN",
  "ERROR",
  "CRITICAL",
  "FATAL",
]);

/*
 * A colon as well: oslo.messaging names a logger after what it notifies of, and Keystone's
 * extensions name their records OS-TRUST:trust and OS-OAUTH1:consumer.
 */
function isLoggerCharacter(code: number): boolean {
  return (
    isDigit(code) ||
    isUpperCaseLetter(code) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 46 ||
    code === 45 ||
    code === 58
  );
}

function isHexDigit(code: number): boolean {
  return (
    isDigit(code) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
  );
}

export function isOpenStackUuid(value: string): boolean {
  if (value.length !== UUID_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < UUID_LENGTH; index++) {
    const code: number = value.charCodeAt(index);

    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 45) {
        return false;
      }
    } else if (!isHexDigit(code)) {
      return false;
    }
  }

  return true;
}

// A Keystone id: 32 hex digits, with or without a UUID's dashes.
export function isOpenStackKeystoneId(value: string): boolean {
  if (isOpenStackUuid(value)) {
    return true;
  }

  if (value.length !== 32) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    if (!isHexDigit(value.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

function isAbsent(value: string | undefined): boolean {
  return !value || value === "-" || value === "None" || value === "none";
}

/*
 * What is inside the [brackets] after the logger:
 *
 *   -                                       no request: a periodic task, a thread
 *   req-g req-r user project - - default default   oslo.log's, with a global ID
 *   None req-r user project - - default default    the same, with none
 *   req-r user project - - -                       before global IDs, and OpenStack-Helm's
 *   None req-r project-name user-name              DevStack's own identity format
 */
function readContext(context: string, line: OpenStackLogLine): void {
  const words: Array<string> = context.trim().split(" ");
  const first: string | undefined = words[0];
  const second: string | undefined = words[1];

  if (!first || first === "-") {
    return;
  }

  let identity: Array<string> = [];

  if (second && second.startsWith("req-")) {
    if (!isAbsent(first) && first.startsWith("req-")) {
      line.globalRequestId = first;
    }
    line.requestId = second;
    identity = words.slice(2);
  } else if (first.startsWith("req-")) {
    line.requestId = first;
    identity = words.slice(1);
  } else {
    return;
  }

  /*
   * Two words is DevStack's "%(project_name)s %(user_name)s". Any other number is oslo.log's
   * default, which starts with the user and then the project.
   */
  const isProjectFirst: boolean = identity.length === 2;
  const user: string | undefined = isProjectFirst ? identity[1] : identity[0];
  const project: string | undefined = isProjectFirst
    ? identity[0]
    : identity[1];

  if (!isAbsent(user)) {
    if (isOpenStackKeystoneId(user!)) {
      line.userId = cut(user!);
    } else {
      line.userName = cut(user!);
    }
  }

  if (!isAbsent(project)) {
    if (isOpenStackKeystoneId(project!)) {
      line.projectId = cut(project!);
    } else {
      line.projectName = cut(project!);
    }
  }
}

function emptyLine(format: OpenStackLogFormat): OpenStackLogLine {
  return {
    format,
    time: null,
    processId: "",
    level: "",
    logger: "",
    requestId: "",
    globalRequestId: "",
    userId: "",
    userName: "",
    projectId: "",
    projectName: "",
    instanceId: "",
    hostname: "",
    message: "",
  };
}

/*
 * The fields of a line of text, from its first line. Null when it is not oslo.log's, which
 * every other line a unit writes is not, uWSGI's own for one.
 */
export function readOpenStackLogLine(text: string): OpenStackLogLine | null {
  const lineEnd: number = text.indexOf("\n");
  const header: string =
    lineEnd === -1
      ? text.slice(0, MAX_HEADER_LENGTH)
      : text.slice(0, Math.min(lineEnd, MAX_HEADER_LENGTH));
  const line: OpenStackLogLine = emptyLine(OpenStackLogFormat.Oslo);
  let position: number = 0;

  const time: { time: Date; length: number } | null = readLineTime(header, 0);

  if (time) {
    line.time = time.time;
    position = time.length;

    if (header.charCodeAt(position) !== 32) {
      return null;
    }
    position++;

    const processStart: number = position;

    while (position < header.length && isDigit(header.charCodeAt(position))) {
      position++;
    }

    if (position > processStart && header.charCodeAt(position) === 32) {
      line.processId = header.slice(processStart, position);
      position++;
    } else {
      return null;
    }
  }

  const levelStart: number = position;

  while (
    position < header.length &&
    position - levelStart <= 8 &&
    isUpperCaseLetter(header.charCodeAt(position))
  ) {
    position++;
  }

  const level: string = header.slice(levelStart, position);

  if (!LEVELS.has(level) || header.charCodeAt(position) !== 32) {
    return null;
  }

  line.level = level === "WARN" ? "WARNING" : level;
  position++;

  const loggerStart: number = position;

  /*
   * A colon only inside a name: Keystone's extensions log their notifications under
   * oslo.messaging.notification.identity.OS-TRUST:trust.created, and "ERROR something: went
   * wrong" has no logger at all.
   */
  while (
    position < header.length &&
    position - loggerStart <= MAX_LOGGER_LENGTH &&
    (isLoggerCharacter(header.charCodeAt(position)) ||
      (header.charCodeAt(position) === 58 &&
        isLoggerCharacter(header.charCodeAt(position + 1))))
  ) {
    position++;
  }

  // "ERROR something: went wrong" is a sentence, which no logger's name ends like.
  if (
    position === loggerStart ||
    position - loggerStart > MAX_LOGGER_LENGTH ||
    header.charCodeAt(position - 1) === 58
  ) {
    return null;
  }

  line.logger = header.slice(loggerStart, position);

  // A level and a logger alone say little: the rest of the line says it is really oslo.log's.
  const atContext: boolean = header.charAt(position + 1) === "[";

  if (header.charCodeAt(position) === 32) {
    position++;
  } else if (position < header.length) {
    return null;
  }

  if (atContext) {
    const close: number = header.indexOf("]", position);
    const content: string =
      close === -1 || close - position > MAX_CONTEXT_LENGTH
        ? ""
        : header.slice(position + 1, close);

    if (content && !content.startsWith("instance:")) {
      readContext(content, line);
      position = close + 1;

      if (header.charCodeAt(position) === 32) {
        position++;
      }
    }
  }

  const instancePrefix: string = "[instance: ";

  if (header.startsWith(instancePrefix, position)) {
    const close: number = header.indexOf("]", position);

    if (close !== -1) {
      const id: string = header.slice(position + instancePrefix.length, close);

      if (isOpenStackUuid(id)) {
        line.instanceId = id;
        position = close + 1;

        if (header.charCodeAt(position) === 32) {
          position++;
        }
      }
    }
  }

  line.message = text.slice(position);

  return line;
}

function readString(
  source: Record<string, unknown> | null,
  ...keys: Array<string>
): string {
  if (!source) {
    return "";
  }

  for (const key of keys) {
    const value: unknown = source[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/*
 * oslo.log's JSON formatter: `message` is the line, `levelname` and `name` its level and
 * logger, `context` the request, `error_summary` the exception a line in text ends with, and
 * `traceback` a list of lines. `msg` and `args` are not read and do not stay: `args` is the
 * values a service was logging, secrets included. The message comes back as it was written,
 * for a notification to be read from, and the body with its secrets gone.
 */
function readOsloJson(parsed: Record<string, unknown>): {
  line: OpenStackLogLine;
  body: string;
  rawMessage: string;
} | null {
  if (
    typeof parsed["levelname"] !== "string" ||
    typeof parsed["name"] !== "string" ||
    typeof parsed["message"] !== "string"
  ) {
    return null;
  }

  const line: OpenStackLogLine = emptyLine(OpenStackLogFormat.OsloJson);
  const context: Record<string, unknown> | null = asRecord(parsed["context"]);
  const extra: Record<string, unknown> | null = asRecord(parsed["extra"]);
  const instance: Record<string, unknown> | null = asRecord(
    extra ? extra["instance"] : undefined,
  );

  const summary: string = readString(parsed, "error_summary");
  const rawMessage: string = parsed["message"] as string;

  line.level = cut(parsed["levelname"] as string, 16);
  line.logger = cut(parsed["name"] as string, MAX_LOGGER_LENGTH);
  line.message = scrubOpenStackSecrets(
    summary ? `${rawMessage}: ${summary}` : rawMessage,
  );
  line.processId = readString(parsed, "process");
  line.hostname = cut(readString(parsed, "hostname"));
  line.requestId = cut(readString(context, "request_id"));
  line.globalRequestId = cut(readString(context, "global_request_id"));
  line.userId = cut(readString(context, "user", "user_id"));
  line.userName = cut(readString(context, "user_name"));
  line.projectId = cut(readString(context, "project", "project_id", "tenant"));
  line.projectName = cut(readString(context, "project_name"));

  const instanceId: string =
    readString(instance, "uuid") ||
    readString(extra, "instance_uuid") ||
    readString(context, "instance_uuid", "resource_uuid");

  if (isOpenStackUuid(instanceId)) {
    line.instanceId = instanceId;
  }

  const created: unknown = parsed["created"];

  if (typeof created === "number" && Number.isFinite(created)) {
    const time: Date = new Date(created * 1000);
    line.time = Number.isNaN(time.getTime()) ? null : time;
  }

  const traceback: unknown = parsed["traceback"];
  const body: string = Array.isArray(traceback)
    ? scrubOpenStackSecrets(
        [
          line.message,
          ...traceback.filter((item: unknown): boolean => {
            return typeof item === "string";
          }),
        ].join("\n"),
      )
    : line.message;

  return { line, body, rawMessage };
}

function readRecordString(
  attributes: Record<string, unknown>,
  ...keys: Array<string>
): string {
  for (const key of keys) {
    const value: unknown = attributes[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

/*
 * DevStack's units, by the short name it gives each service, as the binary every other
 * deployment names it by. The operator's word, and what the cloud's own service list says.
 */
const DEVSTACK_UNIT_SERVICES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["n-api", "nova-api"],
  ["n-api-meta", "nova-api-metadata"],
  ["n-cond-cell1", "nova-conductor"],
  ["n-super-cond", "nova-conductor"],
  ["n-sch", "nova-scheduler"],
  ["n-cpu", "nova-compute"],
  ["n-novnc-cell1", "nova-novncproxy"],
  ["n-spice-cell1", "nova-spicehtml5proxy"],
  ["n-sproxy-cell1", "nova-serialproxy"],
  ["c-api", "cinder-api"],
  ["c-sch", "cinder-scheduler"],
  ["c-vol", "cinder-volume"],
  ["c-bak", "cinder-backup"],
  ["g-api", "glance-api"],
  ["q-svc", "neutron-server"],
  ["neutron-api", "neutron-server"],
  ["q-agt", "neutron-openvswitch-agent"],
  ["q-dhcp", "neutron-dhcp-agent"],
  ["q-l3", "neutron-l3-agent"],
  ["q-meta", "neutron-metadata-agent"],
  ["q-ovn-metadata-agent", "neutron-ovn-metadata-agent"],
  ["q-ovn-agent", "neutron-ovn-agent"],
  ["ceilometer-acompute", "ceilometer-polling"],
  ["keystone", "keystone"],
  ["placement-api", "placement-api"],
]);

/*
 * The words a unit, file or container is named with beside the service's own, which only
 * say how it runs.
 */
const SERVICE_NAME_ENDINGS: ReadonlyArray<string> = [
  "-os-compute",
  "-wsgi-public",
  "-wsgi-admin",
  "-wsgi",
];

function withoutEnding(name: string): string {
  for (const ending of SERVICE_NAME_ENDINGS) {
    if (name.endsWith(ending)) {
      return name.slice(0, name.length - ending.length);
    }
  }

  return name;
}

// A systemd unit as a service: devstack@n-cpu.service is nova-compute.
export function getOpenStackServiceOfUnit(unit: string): string {
  let name: string = unit.trim();

  if (name.endsWith(".service")) {
    name = name.slice(0, name.length - ".service".length);
  }

  const at: number = name.indexOf("@");

  if (at !== -1) {
    name = name.slice(at + 1);
  }

  return DEVSTACK_UNIT_SERVICES.get(name) || withoutEnding(name);
}

/*
 * A log file as a service: /var/log/kolla/nova/nova-compute.log is nova-compute. oslo.log names
 * a file after the program that runs it, and with log_dir and no log_file a service under uWSGI
 * has no program of its own: "<frozen importlib._bootstrap>.log". Its folder says whose it is.
 */
export function getOpenStackServiceOfFile(path: string): string {
  const slash: number = path.lastIndexOf("/");
  let name: string = slash === -1 ? path : path.slice(slash + 1);

  if (name.endsWith(".log")) {
    name = name.slice(0, name.length - ".log".length);
  }

  if (name.indexOf(" ") !== -1 || name.charAt(0) === "<") {
    const folderSlash: number =
      slash > 0 ? path.lastIndexOf("/", slash - 1) : -1;

    return slash > 0 ? path.slice(folderSlash + 1, slash) : "";
  }

  return withoutEnding(name);
}

// The project a service belongs to: nova for nova-compute, nova for nova.compute.manager.
function getComponent(serviceOrLogger: string): string {
  let end: number = 0;

  while (end < serviceOrLogger.length) {
    const code: number = serviceOrLogger.charCodeAt(end);

    if (code === 45 || code === 46 || code === 95) {
      break;
    }
    end++;
  }

  return serviceOrLogger.slice(0, end);
}

// The words of each failure, in the spellings the services use for it.
const SIGNAL_PHRASES: ReadonlyArray<{
  signal: OpenStackLogSignal;
  phrases: ReadonlyArray<string>;
}> = [
  {
    signal: OpenStackLogSignal.NoValidHost,
    phrases: ["No valid host was found", "NoValidHost"],
  },
  {
    signal: OpenStackLogSignal.RabbitMqConnectionLost,
    phrases: [
      "MessagingTimeout",
      "Timed out waiting for a reply to message ID",
      "Unable to connect to AMQP server",
    ],
  },
  {
    signal: OpenStackLogSignal.DatabaseConnectionLost,
    phrases: [
      "DBConnectionError",
      "Lost connection to MySQL server",
      "Can't connect to MySQL server",
      "MySQL server has gone away",
      "Lost connection to server during query",
      "could not connect to server",
      "SQL connection failed",
    ],
  },
  {
    signal: OpenStackLogSignal.TokenValidationFailing,
    phrases: [
      "not a recognized Fernet token",
      // keystonemiddleware, in the service that was handed the token. What a real cloud logs.
      "Authorization failed for token",
      "Failed to validate token",
      "Token validation failure",
      "Unable to validate token",
      "Could not validate the token",
    ],
  },
];

/*
 * Which failure a record says happened, if any. Only at WARNING or worse: a DEBUG line
 * mentioning one is not one. "AMQP server on <host> is unreachable" has the address in
 * the middle, so it is looked for in two pieces.
 */
export function readOpenStackLogSignal(data: {
  level: string;
  text: string;
}): OpenStackLogSignal | null {
  if (
    data.level !== "WARNING" &&
    data.level !== "ERROR" &&
    data.level !== "CRITICAL" &&
    data.level !== "FATAL"
  ) {
    return null;
  }

  const text: string = data.text.slice(0, MAX_SIGNAL_SCAN_LENGTH);

  for (const entry of SIGNAL_PHRASES) {
    for (const phrase of entry.phrases) {
      if (text.indexOf(phrase) !== -1) {
        return entry.signal;
      }
    }
  }

  const amqp: number = text.indexOf("AMQP server on ");

  if (amqp !== -1 && text.indexOf("is unreachable", amqp) !== -1) {
    return OpenStackLogSignal.RabbitMqConnectionLost;
  }

  // oslo.messaging's own words for losing it, which name no bus: [Errno 111], timed out.
  if (
    text.indexOf("impl_rabbit") !== -1 &&
    text.indexOf("Connection failed: ") !== -1
  ) {
    return OpenStackLogSignal.RabbitMqConnectionLost;
  }

  return null;
}

const HEALTH_CHECK_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/healthcheck",
  "/healthcheck/",
  "/healthz",
]);

// What an API's path starts with where one server holds them all, as DevStack's Apache does.
const API_PATH_PREFIXES: ReadonlyArray<string> = [
  "/identity",
  "/compute",
  "/volume",
  "/image",
  "/placement",
  "/networking",
];

function isHealthCheckPath(path: string): boolean {
  if (HEALTH_CHECK_PATHS.has(path)) {
    return true;
  }

  for (const prefix of API_PATH_PREFIXES) {
    if (
      path.startsWith(prefix) &&
      HEALTH_CHECK_PATHS.has(path.slice(prefix.length))
    ) {
      return true;
    }
  }

  return false;
}

/*
 * How an API's own log writes a request, and what that says of the path: oslo.log's request
 * line has "GET /path" in quotes, and uWSGI's own says ] GET /path => generated.
 */
const HEALTH_CHECK_METHODS: ReadonlyArray<string> = [
  '"GET ',
  '"HEAD ',
  '"OPTIONS ',
  "] GET ",
  "] HEAD ",
  "] OPTIONS ",
];

/*
 * A request line for a load balancer's check. HAProxy asks each API for / or
 * /healthcheck every few seconds on most clouds, and each answer is a line. Only the
 * API's own access lines count: a person's "GET /" reads the same, and costs nothing.
 */
function isHealthCheckMessage(text: string): boolean {
  const message: string = text.slice(0, 1024);

  for (const method of HEALTH_CHECK_METHODS) {
    const at: number = message.indexOf(method);

    if (at === -1) {
      continue;
    }

    const pathStart: number = at + method.length;
    let pathEnd: number = pathStart;

    while (pathEnd < message.length) {
      const code: number = message.charCodeAt(pathEnd);

      if (code === 32 || code === 34) {
        break;
      }
      pathEnd++;
    }

    if (isHealthCheckPath(message.slice(pathStart, pathEnd))) {
      return true;
    }
  }

  return false;
}

function isHealthCheckLine(line: OpenStackLogLine): boolean {
  return (
    (line.level === "INFO" || line.level === "DEBUG") &&
    isHealthCheckMessage(line.message)
  );
}

// uWSGI's own line for a request, which its service's unit holds beside oslo.log's.
function isUwsgiRequestLine(body: string): boolean {
  return body.startsWith("[pid: ");
}

/*
 * What a line calls an instance when it was not written with its prefix: "instance <uuid>",
 * instance_uuid=<uuid>, 'instance_id': '<uuid>'. Neutron says a port's device_id and its
 * calls to Nova's server_uuid, and Placement an allocation's consumer. A port's device can be a
 * router, and a consumer a migration: then this says an instance that is none, and no instance's
 * page ever asks for it.
 */
const INSTANCE_MENTIONS: ReadonlyArray<string> = [
  "instance",
  "server_uuid",
  "device_id",
  "consumer",
];

/*
 * An instance named in a line that was not written with its prefix. An instance's Logs tab shows
 * what names its UUID, and a Neutron or Cinder line says it this way, when it says it.
 */
function findInstanceMention(message: string): string {
  const text: string = message.slice(0, MAX_INSTANCE_MENTION_SCAN_LENGTH);
  const lower: string = text.toLowerCase();

  for (const mention of INSTANCE_MENTIONS) {
    let from: number = 0;

    for (;;) {
      const at: number = lower.indexOf(mention, from);

      if (at === -1) {
        break;
      }

      let position: number = at + mention.length;
      const limit: number = Math.min(text.length, position + 16);

      while (position < limit) {
        const code: number = text.charCodeAt(position);

        if (
          isHexDigit(code) &&
          isOpenStackUuid(text.slice(position, position + UUID_LENGTH))
        ) {
          return text.slice(position, position + UUID_LENGTH);
        }

        position++;
      }

      from = at + mention.length;
    }
  }

  return "";
}

const SEVERITY_BY_LEVEL: ReadonlyMap<string, number> = new Map<string, number>([
  ["TRACE", 1],
  ["DEBUG", 5],
  ["INFO", 9],
  ["AUDIT", 9],
  ["WARNING", 13],
  ["ERROR", 17],
  ["CRITICAL", 21],
  ["FATAL", 21],
]);

// journald's PRIORITY, for a line that does not say its own level.
function severityOfPriority(priority: string): number | null {
  switch (priority) {
    case "0":
    case "1":
    case "2":
      return 21;
    case "3":
      return 17;
    case "4":
      return 13;
    case "5":
    case "6":
      return 9;
    case "7":
      return 5;
    default:
      return null;
  }
}

export function isOpenStackLogRecord(
  attributes: Record<string, unknown>,
): boolean {
  const cloud: unknown = attributes[OPENSTACK_CLOUD_LOG_ATTRIBUTE];

  return typeof cloud === "string" && cloud !== "";
}

// The record's service, from what said which unit, file or container wrote it.
function readRecordService(attributes: Record<string, unknown>): string {
  const unit: string = readRecordString(attributes, "journald.unit");

  if (unit) {
    return getOpenStackServiceOfUnit(unit);
  }

  const file: string = readRecordString(
    attributes,
    "log.file.path",
    "log.file.name",
  );

  if (file) {
    return getOpenStackServiceOfFile(file);
  }

  const container: string = readRecordString(
    attributes,
    "resource.k8s.container.name",
    "k8s.container.name",
  );

  if (container) {
    return withoutEnding(container);
  }

  const identifier: string = readRecordString(
    attributes,
    "journald.identifier",
  );

  return identifier ? withoutEnding(identifier) : "";
}

function readRecordHost(
  attributes: Record<string, unknown>,
  line: OpenStackLogLine | null,
): string {
  return (
    readRecordString(
      attributes,
      "journald.hostname",
      "resource.openstack.node.name",
      "resource.k8s.node.name",
      "resource.host.name",
      "host.name",
    ) || (line ? line.hostname : "")
  );
}

// oslo.log's own journal handler says these beside the line, and the line may leave them out.
function fillFromJournal(
  line: OpenStackLogLine,
  attributes: Record<string, unknown>,
): void {
  line.logger =
    line.logger ||
    cut(
      readRecordString(attributes, "journald.logger_name"),
      MAX_LOGGER_LENGTH,
    );
  line.level =
    line.level ||
    cut(readRecordString(attributes, "journald.logger_level"), 16);
  line.requestId =
    line.requestId || cut(readRecordString(attributes, "journald.request_id"));
  line.globalRequestId =
    line.globalRequestId ||
    cut(readRecordString(attributes, "journald.global_request_id"));
  line.userId =
    line.userId || cut(readRecordString(attributes, "journald.user_id"));
  line.userName =
    line.userName || cut(readRecordString(attributes, "journald.user_name"));
  line.projectId =
    line.projectId || cut(readRecordString(attributes, "journald.project_id"));
  line.projectName =
    line.projectName ||
    cut(readRecordString(attributes, "journald.project_name"));
}

function holdsOsloJournalFields(attributes: Record<string, unknown>): boolean {
  return Boolean(
    readRecordString(
      attributes,
      "journald.logger_name",
      "journald.logger_level",
    ),
  );
}

/*
 * Where the JSON object starting at a place ends, by its braces outside its strings: -1 if it
 * never does. What follows it can hold braces of its own.
 */
export function findJsonObjectEnd(text: string, start: number): number {
  let depth: number = 0;
  let isInString: boolean = false;

  for (let index: number = start; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (isInString) {
      if (code === 92) {
        index++;
      } else if (code === 34) {
        isInString = false;
      }
    } else if (code === 34) {
      isInString = true;
    } else if (code === 123) {
      depth++;
    } else if (code === 125) {
      depth--;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/*
 * A notification, from the JSON in its line, as the service wrote it. Something can follow
 * the JSON: oslo.log adds the exception being handled to an error, and DevStack's format the
 * function that logged it to a DEBUG line. What must never be stored is taken out of the
 * fields, the body is written from what is left, and what followed stays, its secrets gone.
 */
function readNotificationMessage(message: string): {
  parsed: Record<string, unknown>;
  text: string;
  rest: string;
} | null {
  const start: number = message.indexOf("{");

  if (start === -1) {
    return null;
  }

  const end: number = findJsonObjectEnd(message, start);

  if (end === -1) {
    return null;
  }

  const parsed: Record<string, unknown> | null = readJson(
    message.slice(start, end + 1),
  );

  if (!parsed) {
    return null;
  }

  const cleaned: Record<string, unknown> = removeOpenStackSecretFields(
    parsed,
  ) as Record<string, unknown>;

  return {
    parsed: cleaned,
    text: JSON.stringify(cleaned),
    rest: scrubOpenStackSecrets(message.slice(end + 1)),
  };
}

function setIfPresent(
  attributes: Record<string, string>,
  key: string,
  value: string,
): void {
  if (value) {
    attributes[key] = cut(value);
  }
}

/*
 * Reads one record of an OpenStack cloud: what it says as attributes, the severity it is
 * stored with, its body with its secrets gone, and the event it holds if it is a
 * notification. Never throws: a record it cannot read keeps what it came with, its
 * secrets gone.
 */
export function stampOpenStackLogRecord(data: {
  attributes: Record<string, unknown>;
  body: string;
  severityNumber: number;
}): OpenStackLogStamp {
  const removedAttributes: Array<string> = [];
  let source: string = data.body || "";

  /*
   * oslo.log's journal handler keeps a traceback beside the line. It belongs in the body,
   * which holds it already when the line's format wrote it, as the default format does.
   */
  const exceptionInfo: unknown = data.attributes["journald.exception_info"];

  if (typeof exceptionInfo === "string" && exceptionInfo) {
    if (source.indexOf(TRACEBACK_START) === -1) {
      source = source ? `${source}\n${exceptionInfo}` : exceptionInfo;
    }

    removedAttributes.push("journald.exception_info");
  }

  const wasCut: boolean = source.length > MAX_OPENSTACK_LOG_BODY_LENGTH;

  if (wasCut) {
    source = cutWhole(source, MAX_OPENSTACK_LOG_BODY_LENGTH);
  }

  /*
   * JSON is read as it was written, and its secrets taken out field by field. The scrub of a
   * line reads text: "memcache_password = " at the end of a string of JSON looks to it like a
   * value opening at the quote that closes the string, and what it took then no longer parses.
   */
  const written: string = stripAnsiCodes(source);
  let body: string = scrubOpenStackSecrets(written, { wasCut });
  let line: OpenStackLogLine | null = null;
  let notification: Record<string, unknown> | null = null;
  let rawMessage: string = "";

  if (written.charAt(0) === "{") {
    const parsed: Record<string, unknown> | null = readJson(written);

    if (parsed && typeof parsed["event_type"] === "string") {
      const cleaned: Record<string, unknown> = removeOpenStackSecretFields(
        parsed,
      ) as Record<string, unknown>;
      notification = cleaned;
      body = JSON.stringify(cleaned);
      line = emptyLine(OpenStackLogFormat.Notification);
    } else if (parsed) {
      const json: {
        line: OpenStackLogLine;
        body: string;
        rawMessage: string;
      } | null = readOsloJson(parsed);

      if (json) {
        line = json.line;
        body = json.body;
        rawMessage = json.rawMessage;
      }
    }
  } else {
    line = readOpenStackLogLine(body);

    if (line && line.logger.startsWith(OPENSTACK_NOTIFICATION_LOGGER_PREFIX)) {
      // Its fields come from the line with its secrets gone, and its JSON from before that.
      const asWritten: OpenStackLogLine | null =
        body === written ? line : readOpenStackLogLine(written);

      rawMessage = asWritten ? asWritten.message : line.message;
    }
  }

  if (!line && holdsOsloJournalFields(data.attributes)) {
    line = emptyLine(OpenStackLogFormat.Oslo);
    line.message = body;
    rawMessage = written;
  }

  if (line) {
    fillFromJournal(line, data.attributes);
  }

  const logger: string = line ? line.logger : "";

  if (
    line &&
    !notification &&
    logger.startsWith(OPENSTACK_NOTIFICATION_LOGGER_PREFIX)
  ) {
    const read: {
      parsed: Record<string, unknown>;
      text: string;
      rest: string;
    } | null = readNotificationMessage(rawMessage || line.message);

    if (read) {
      notification = read.parsed;

      /*
       * The line as it came, with its fields replaced by what may be kept. A line's message
       * is what it ends with, so where it starts needs no looking for. oslo.log's JSON
       * formatter has no line around its message to keep.
       */
      body =
        line.format === OpenStackLogFormat.OsloJson
          ? `${read.text}${read.rest}`
          : `${body.slice(0, body.length - line.message.length)}${read.text}${read.rest}`;
    }
  }

  if (line && !line.instanceId && !notification) {
    const mentioned: string = findInstanceMention(line.message);

    if (mentioned) {
      line.instanceId = mentioned;
    }
  }

  const event: OpenStackEvent | null = notification
    ? readOpenStackNotification({
        message: notification,
        instanceId: line ? line.instanceId : "",
        requestId: line ? line.requestId : "",
        userId: line ? line.userId : "",
        projectId: line ? line.projectId : "",
        lineTime: line ? line.time : null,
      })
    : null;

  const attributes: Record<string, string> = {};

  // An unread line is still somebody's, from what said who wrote it.
  const service: string =
    readRecordService(data.attributes) ||
    (event ? event.publisherService : "") ||
    getComponent(logger);
  const host: string = getOpenStackShortHostName(
    readRecordHost(data.attributes, line) || (event ? event.host : ""),
  );

  setIfPresent(attributes, OpenStackLogAttribute.Service, service);
  setIfPresent(
    attributes,
    OpenStackLogAttribute.Component,
    getComponent(service || logger),
  );
  setIfPresent(attributes, OpenStackLogAttribute.Host, host);
  attributes[OpenStackLogAttribute.Format] = line
    ? line.format
    : OpenStackLogFormat.Other;

  let severityNumber: number | null = null;

  if (line) {
    setIfPresent(attributes, OpenStackLogAttribute.Logger, logger);
    setIfPresent(attributes, OpenStackLogAttribute.Level, line.level);

    const requestId: string = line.requestId || (event ? event.requestId : "");
    const globalRequestId: string = line.globalRequestId;

    setIfPresent(attributes, OpenStackLogAttribute.RequestId, requestId);
    setIfPresent(
      attributes,
      OpenStackLogAttribute.GlobalRequestId,
      globalRequestId,
    );
    setIfPresent(
      attributes,
      OpenStackLogAttribute.RequestRootId,
      globalRequestId || requestId,
    );
    setIfPresent(
      attributes,
      OpenStackLogAttribute.UserId,
      line.userId || (event ? event.userId : ""),
    );
    setIfPresent(attributes, OpenStackLogAttribute.UserName, line.userName);
    setIfPresent(
      attributes,
      OpenStackLogAttribute.ProjectId,
      line.projectId || (event ? event.projectId : ""),
    );
    setIfPresent(
      attributes,
      OpenStackLogAttribute.ProjectName,
      line.projectName,
    );
    setIfPresent(
      attributes,
      OpenStackLogAttribute.InstanceId,
      line.instanceId || (event ? event.instanceId : ""),
    );

    const level: string = event && !line.level ? event.priority : line.level;
    const known: number | undefined = SEVERITY_BY_LEVEL.get(
      level.toUpperCase(),
    );

    /*
     * A TRACE line with no [context] is a traceback's own line, in the format oslo.log's
     * exception prefix once wrote. With one, it is oslo.log's lowest level.
     */
    if (known !== undefined) {
      severityNumber =
        level === "TRACE" &&
        !line.requestId &&
        line.format === OpenStackLogFormat.Oslo
          ? 17
          : known;
    }

    const signal: OpenStackLogSignal | null = readOpenStackLogSignal({
      level: level.toUpperCase(),
      text: body,
    });

    if (signal) {
      attributes[OpenStackLogAttribute.Signal] = signal;
    }

    if (isHealthCheckLine(line)) {
      attributes[OpenStackLogAttribute.Noise] =
        OPENSTACK_LOG_NOISE_HEALTH_CHECK;
    }
  }

  if (!line && isUwsgiRequestLine(body) && isHealthCheckMessage(body)) {
    attributes[OpenStackLogAttribute.Noise] = OPENSTACK_LOG_NOISE_HEALTH_CHECK;
  }

  if (severityNumber === null && !data.severityNumber) {
    severityNumber = severityOfPriority(
      readRecordString(data.attributes, "journald.priority"),
    );
  }

  if (event) {
    attributes[OpenStackEventAttribute.Type] = cut(event.type);
    setIfPresent(attributes, OpenStackEventAttribute.Priority, event.priority);
    attributes[OpenStackEventAttribute.Outcome] = event.outcome;
    attributes[OpenStackEventAttribute.Importance] = event.importance;
    setIfPresent(
      attributes,
      OpenStackEventAttribute.Publisher,
      event.publisher,
    );
    setIfPresent(
      attributes,
      OpenStackEventAttribute.MessageId,
      event.messageId,
    );
    if (event.reason) {
      attributes[OpenStackEventAttribute.Reason] = event.reason;
    }
    setIfPresent(
      attributes,
      OpenStackEventAttribute.Exception,
      event.exception,
    );
    if (event.failure) {
      attributes[OpenStackEventAttribute.Failure] = event.failure;
    }
    if (event.part) {
      attributes[OpenStackEventAttribute.PartKind] = event.part.kind;
      setIfPresent(attributes, OpenStackEventAttribute.PartId, event.part.id);
      setIfPresent(
        attributes,
        OpenStackEventAttribute.PartName,
        event.part.name,
      );
    }
  }

  return {
    attributes,
    removedAttributes,
    severityNumber,
    time: event && event.time ? event.time : line ? line.time : null,
    // Written last: nothing that reads a value can take it for one, or take it away.
    body: wasCut ? `${body}${TRUNCATED_NOTE}` : body,
    event,
  };
}
