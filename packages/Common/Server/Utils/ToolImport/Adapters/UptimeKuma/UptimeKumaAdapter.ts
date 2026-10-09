import BadDataException from "../../../../../Types/Exception/BadDataException";
import DnsRecordType from "../../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import {
  TOOL_IMPORT_MAX_RECORDS_PER_KIND,
  TOOL_IMPORT_MAX_UPLOAD_BYTES,
} from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  intervalNotes,
  timeoutNotes,
  toCertificateMonitor,
  toHttpMonitor,
  toUnsupportedMonitor,
} from "../../../../../Types/ToolImport/ToolImportMonitorMapping";
import {
  OBJECT_KEYS,
  readStatusCodeRanges,
} from "../../../../../Types/ToolImport/ToolImportMonitorRules";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getEmptyToolImportSnapshot,
  ImportedMonitor,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanDescription,
  cleanName,
} from "../../ToolImportAdapterSupport";
import { ToolImportFileAdapter } from "../../Types";

/*
 * UPTIME KUMA.
 *
 * Uptime Kuma runs on the person's own machines and has no API that lists
 * monitors, so it is read from a file the person uploads - either of the
 * two files Uptime Kuma itself gives:
 *
 *  - Its JSON backup (Uptime Kuma 1.x: Settings > Backup > Export): every
 *    monitor with all its settings. Uptime Kuma 2.0 removed this export.
 *  - Its metrics page (any version with an API key: /metrics, saved as a
 *    text file): every monitor's name, type and address, without how often
 *    it is checked or what it looks for - so they come over checked every
 *    five minutes, and the preview says to check them.
 *
 * The file is the person's, so it is read as untrusted text:
 *  - at most TOOL_IMPORT_MAX_UPLOAD_BYTES, refused before it is read;
 *  - JSON nested at most MAX_JSON_DEPTH deep, checked before it is parsed,
 *    then parsed by JSON.parse with every "__proto__", "constructor" and
 *    "prototype" key dropped, and read only through the shape readers -
 *    nothing in it is merged into an object, run, or used as a pattern;
 *  - the metrics page read line by line, by hand, with no regular
 *    expression over a whole line;
 *  - anything that is neither file is refused with a plain message.
 * Passwords, tokens and push keys in the backup are never copied, and the
 * file itself is never stored (ToolImportRunExecutor.startUpload).
 *
 * How Uptime Kuma's monitors map:
 *  - HTTP and keyword monitors are Website monitors (API monitors when they
 *    send headers or a body), with the same status codes for "up", the
 *    keyword where it should be, and an SSL Certificate monitor when Uptime
 *    Kuma warns before the certificate expires. JSON query monitors are API
 *    monitors, without the query (named in the preview).
 *  - Port, ping and DNS monitors are Port, Ping and DNS monitors; push
 *    monitors are Incoming Request monitors, down once no push has come for
 *    the interval and its retries; manual monitors are manual monitors.
 *  - Upside down monitors (up when the check fails) and the types OneUptime
 *    has no monitor for - Docker, databases, game servers, MQTT and the rest
 *    - are named as left out. Groups are folders, not checks: their
 *    monitors come over on their own.
 */

// The deepest a backup's JSON is ever nested: well below this.
export const MAX_JSON_DEPTH: number = 32;

// The most lines a metrics page is read for.
export const MAX_METRICS_LINES: number = 200_000;

const METRIC_NAME: string = "monitor_status";

// A file saved by some editors starts with a byte order mark.
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);

// What is left of the comma between two labels.
const LEADING_COMMA: RegExp = /^,/;

// A push monitor read from the metrics page waits this long: its interval is not on it.
const UNKNOWN_HEARTBEAT_SECONDS: number = 60 * 60;

const DNS_RECORD_TYPES: ReadonlyArray<string> = Object.values(DnsRecordType);

// Uptime Kuma's words for the types OneUptime has no monitor for.
const UNSUPPORTED_TYPE_NAMES: Record<string, string> = {
  docker: "Docker",
  "real-browser": "real browser",
  steam: "Steam game server",
  gamedig: "game server",
  mqtt: "MQTT",
  "kafka-producer": "Kafka producer",
  sqlserver: "SQL Server",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  radius: "RADIUS",
  redis: "Redis",
  "grpc-keyword": "gRPC",
  "tailscale-ping": "Tailscale ping",
  rabbitmq: "RabbitMQ",
  snmp: "SNMP",
  smtp: "SMTP",
  "system-service": "system service",
  pm2: "PM2",
};

export default class UptimeKumaAdapter implements ToolImportFileAdapter {
  public source: ToolImportSource = ToolImportSource.UptimeKuma;

  public readFile(data: {
    content: string;
    fileName: string;
    now: Date;
  }): ToolImportSnapshot {
    if (Buffer.byteLength(data.content, "utf8") > TOOL_IMPORT_MAX_UPLOAD_BYTES) {
      throw new BadDataException(
        "This file is larger than 10 MB, which is more than an import reads.",
      );
    }

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.UptimeKuma,
    );
    snapshot.readAt = data.now.toISOString();

    if (data.fileName) {
      snapshot.accountName = data.fileName;
    }

    const text: string = (
      data.content.startsWith(BYTE_ORDER_MARK)
        ? data.content.slice(BYTE_ORDER_MARK.length)
        : data.content
    ).trim();

    if (text.startsWith("{")) {
      snapshot.monitors = this.readBackup(text, snapshot.notes);
    } else if (isMetricsPage(text)) {
      snapshot.monitors = this.readMetrics(text, snapshot.notes);
      snapshot.notes.push(
        makeToolImportNote(ToolImportNoteCode.MonitorsFromMetricsFile),
      );
    } else {
      throw new BadDataException(
        "This is not an Uptime Kuma backup or metrics file. Upload the JSON file Settings > Backup > Export gives, or the page /metrics shows.",
      );
    }

    if (snapshot.monitors.length === 0) {
      throw new BadDataException(
        "This Uptime Kuma file has no monitors in it.",
      );
    }

    return snapshot;
  }

  // ---- The JSON backup.

  public readBackup(
    text: string,
    notes: Array<ToolImportNote>,
  ): Array<ImportedMonitor> {
    const backup: unknown = parseUntrustedJson(text);

    if (
      !backup ||
      typeof backup !== "object" ||
      Array.isArray(backup) ||
      !Array.isArray((backup as Record<string, unknown>)["monitorList"])
    ) {
      throw new BadDataException(
        "This file is not an Uptime Kuma backup: it has no list of monitors.",
      );
    }

    const list: Array<Record<string, unknown>> = asArray(
      (backup as Record<string, unknown>)["monitorList"],
    )
      .filter((value: unknown): boolean => {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
      })
      .map(asRecord)
      // Groups are folders, not checks.
      .filter((monitor: Record<string, unknown>): boolean => {
        return asString(monitor["type"]).toLowerCase() !== "group";
      });

    const monitors: Array<ImportedMonitor> = [];
    const certificates: Array<ImportedMonitor> = [];
    const seen: Set<string> = new Set<string>();

    for (const raw of capRecords({
      kind: ToolImportResourceKind.Monitor,
      records: list,
      notes: notes,
    })) {
      const monitor: ImportedMonitor | null = this.toMonitor(raw);

      if (!monitor || seen.has(monitor.sourceId)) {
        continue;
      }

      seen.add(monitor.sourceId);
      monitors.push(monitor);

      if (
        raw["expiryNotification"] === true &&
        monitor.destination &&
        (monitor.monitorType === MonitorType.Website ||
          monitor.monitorType === MonitorType.API)
      ) {
        const certificate: ImportedMonitor | null = toCertificateMonitor({
          sourceId: monitor.sourceId,
          name: monitor.name,
          url: monitor.destination,
          intervalSeconds: monitor.intervalSeconds,
          isPaused: monitor.isPaused,
        });

        if (certificate) {
          certificates.push(certificate);
        }
      }
    }

    return [...monitors, ...certificates];
  }

  public toMonitor(raw: Record<string, unknown>): ImportedMonitor | null {
    const id: string = asString(raw["id"]);
    const type: string = asString(raw["type"]).toLowerCase();

    if (!id || !type) {
      return null;
    }

    const name: string = cleanName(raw["name"], `Monitor ${id}`);
    const description: string | undefined = cleanDescription(
      raw["description"],
    );
    const intervalSeconds: number | undefined =
      asNumber(raw["interval"]) || undefined;
    const isPaused: boolean =
      raw["active"] === false || raw["active"] === 0 || raw["active"] === "0";

    if (asBoolean(raw["upsideDown"], false)) {
      return toUnsupportedMonitor({
        sourceId: id,
        name: name,
        sourceType: type,
        destination: asString(raw["url"]) || asString(raw["hostname"]) || undefined,
        skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
      });
    }

    if (type === "http" || type === "keyword" || type === "json-query") {
      const keyword: string = asString(raw["keyword"]);
      const notes: Array<ToolImportNote> = [];

      if (type === "json-query") {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorAssertionsLeftOut),
        );
      }

      const monitor: ImportedMonitor = toHttpMonitor({
        sourceId: id,
        name: name,
        description: description,
        sourceType: type,
        url: asString(raw["url"]),
        method: asString(raw["method"]) || "GET",
        headers: readJsonHeaders(raw["headers"]),
        body: asString(raw["body"]) || undefined,
        followRedirects:
          asNumber(raw["maxredirects"]) === 0 ? false : undefined,
        timeoutSeconds: asNumber(raw["timeout"]) || undefined,
        intervalSeconds: intervalSeconds,
        acceptedStatusCodes: readStatusCodeRanges(
          asArray(raw["accepted_statuscodes"]),
        ),
        keyword:
          type === "keyword" && keyword
            ? {
                value: keyword,
                isPresent: !asBoolean(raw["invertKeyword"], false),
                isCaseSensitive: true,
              }
            : undefined,
        signsIn:
          Boolean(asString(raw["basic_auth_user"])) ||
          ["basic", "ntlm", "mtls", "oauth2-cc"].includes(
            asString(raw["authMethod"]).toLowerCase(),
          ),
        isPaused: isPaused,
        notes: notes,
      });

      return monitor;
    }

    const notes: Array<ToolImportNote> = [
      ...intervalNotes(intervalSeconds),
      ...timeoutNotes(asNumber(raw["timeout"]) || undefined),
    ];

    if (isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    const base: ImportedMonitor = {
      sourceId: id,
      name: name,
      sourceType: type,
      monitorType: null,
      intervalSeconds: intervalSeconds,
      isPaused: isPaused,
      notes: notes,
    };

    if (description) {
      base.description = description;
    }

    if (type === "ping") {
      return {
        ...base,
        monitorType: MonitorType.Ping,
        destination: asString(raw["hostname"]),
      };
    }

    if (type === "port") {
      return {
        ...base,
        monitorType: MonitorType.Port,
        destination: asString(raw["hostname"]),
        port: asNumber(raw["port"]) || undefined,
        timeoutSeconds: asNumber(raw["timeout"]) || undefined,
      };
    }

    if (type === "dns") {
      const recordType: string = asString(raw["dns_resolve_type"]).toUpperCase();
      const monitor: ImportedMonitor = {
        ...base,
        monitorType: MonitorType.DNS,
        destination: asString(raw["hostname"]),
        dnsRecordType: DNS_RECORD_TYPES.includes(recordType)
          ? (recordType as DnsRecordType)
          : DnsRecordType.A,
      };
      const server: string = asString(raw["dns_resolve_server"]);

      if (server) {
        monitor.dnsServer = server;
      }

      return monitor;
    }

    if (type === "push") {
      const retries: number = asNumber(raw["maxretries"]) || 0;
      const retryInterval: number =
        asNumber(raw["retryInterval"]) || intervalSeconds || 0;

      return {
        ...base,
        monitorType: MonitorType.IncomingRequest,
        // Not checked on an interval: it waits to be pushed to.
        notes: [
          ...base.notes.filter((note: ToolImportNote): boolean => {
            return note.code !== ToolImportNoteCode.MonitorIntervalChanged;
          }),
          makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
        ],
        heartbeatTimeoutSeconds: (intervalSeconds || 60) + retries * retryInterval,
      };
    }

    if (type === "manual") {
      return { ...base, monitorType: MonitorType.Manual, notes: [] };
    }

    return toUnsupportedMonitor({
      sourceId: id,
      name: name,
      sourceType: UNSUPPORTED_TYPE_NAMES[type] || type,
      destination: asString(raw["url"]) || asString(raw["hostname"]) || undefined,
    });
  }

  // ---- The metrics page.

  public readMetrics(
    text: string,
    notes: Array<ToolImportNote>,
  ): Array<ImportedMonitor> {
    const monitors: Array<ImportedMonitor> = [];
    const seen: Set<string> = new Set<string>();
    const lines: Array<string> = text.split("\n");

    if (lines.length > MAX_METRICS_LINES) {
      throw new BadDataException(
        "This metrics file is longer than an Uptime Kuma metrics page can be.",
      );
    }

    for (const line of lines) {
      const labels: Record<string, string> | null = readMetricLabels(line);

      if (!labels) {
        continue;
      }

      const name: string = cleanName(labels["monitor_name"], "");

      if (!name) {
        continue;
      }

      // 2.x names each monitor's id; 1.x only its name.
      const sourceId: string = labels["monitor_id"]
        ? labels["monitor_id"]
        : `name:${name.toLowerCase()}`;

      if (seen.has(sourceId)) {
        continue;
      }

      seen.add(sourceId);

      const raw: Record<string, unknown> = {
        id: sourceId,
        name: name,
        type: labels["monitor_type"] || "",
        url: nullable(labels["monitor_url"]),
        hostname: nullable(labels["monitor_hostname"]),
        port: nullable(labels["monitor_port"]),
      };

      if (asString(raw["type"]).toLowerCase() === "group") {
        continue;
      }

      const monitor: ImportedMonitor | null = this.toMonitor(raw);

      if (!monitor) {
        continue;
      }

      if (monitor.monitorType === MonitorType.IncomingRequest) {
        monitor.heartbeatTimeoutSeconds = UNKNOWN_HEARTBEAT_SECONDS;
      }

      monitors.push(monitor);

      if (monitors.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
            kind: ToolImportResourceKind.Monitor,
            limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
          }),
        );
        break;
      }
    }

    return monitors;
  }
}


/*
 * JSON from a file the person uploads: refused when it is nested deeper
 * than a backup ever is - checked in one pass before JSON.parse, so a file
 * of ten million "[" cannot exhaust anything - and parsed with the keys
 * that name an object's machinery dropped.
 */
export function parseUntrustedJson(text: string): unknown {
  if (getJsonDepth(text) > MAX_JSON_DEPTH) {
    throw new BadDataException(
      "This file is not an Uptime Kuma backup: it is nested deeper than a backup is.",
    );
  }

  try {
    return JSON.parse(text, (key: string, value: unknown): unknown => {
      return OBJECT_KEYS.includes(key) ? undefined : value;
    });
  } catch {
    throw new BadDataException(
      "This file is not an Uptime Kuma backup: it is not valid JSON.",
    );
  }
}

// How deep the objects and arrays of a JSON text are nested, strings aside.
export function getJsonDepth(text: string): number {
  let depth: number = 0;
  let deepest: number = 0;
  let inString: boolean = false;
  let escaped: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const char: string = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
      deepest = Math.max(deepest, depth);
    } else if (char === "}" || char === "]") {
      depth--;
    }
  }

  return deepest;
}

// A backup writes a monitor's headers as a JSON object inside a string.
function readJsonHeaders(value: unknown): Array<{ name: string; value: string }> {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  let headers: unknown;

  try {
    headers = parseUntrustedJson(value);
  } catch {
    return [];
  }

  return Object.entries(asRecord(headers)).map(
    ([name, headerValue]: [string, unknown]) => {
      return { name: name, value: asString(headerValue) };
    },
  );
}

// Whether a text is Prometheus' exposition of Uptime Kuma's monitors.
function isMetricsPage(text: string): boolean {
  return text.split("\n", 2000).some((line: string): boolean => {
    return line.trim().startsWith(`${METRIC_NAME}{`);
  });
}

// "null" is how the metrics page writes a label that has no value.
function nullable(value: string | undefined): string {
  return value && value !== "null" ? value : "";
}

/*
 * The labels of one `monitor_status{...} value` line, read character by
 * character (a label value may hold an escaped quote, comma or brace), or
 * null for any other line.
 */
export function readMetricLabels(line: string): Record<string, string> | null {
  const text: string = line.trim();

  if (!text.startsWith(`${METRIC_NAME}{`)) {
    return null;
  }

  const labels: Record<string, string> = {};
  let index: number = METRIC_NAME.length + 1;

  while (index < text.length) {
    // The label's name, up to "=".
    let name: string = "";

    while (index < text.length && text[index] !== "=" && text[index] !== "}") {
      name += text[index];
      index++;
    }

    if (text[index] === "}") {
      return labels;
    }

    index++; // "="

    if (text[index] !== '"') {
      return null;
    }

    index++; // opening quote

    let value: string = "";
    let isClosed: boolean = false;

    while (index < text.length) {
      const char: string = text[index]!;

      if (char === "\\" && index + 1 < text.length) {
        const next: string = text[index + 1]!;
        value += next === "n" ? "\n" : next;
        index += 2;
        continue;
      }

      if (char === '"') {
        isClosed = true;
        index++;
        break;
      }

      value += char;
      index++;
    }

    if (!isClosed) {
      return null;
    }

    const key: string = name.trim().replace(LEADING_COMMA, "").trim();

    if (key && !OBJECT_KEYS.includes(key)) {
      labels[key] = value;
    }

    // A comma before the next label, or the closing brace.
    while (index < text.length && (text[index] === "," || text[index] === " ")) {
      index++;
    }

    if (text[index] === "}") {
      return labels;
    }
  }

  return null;
}

