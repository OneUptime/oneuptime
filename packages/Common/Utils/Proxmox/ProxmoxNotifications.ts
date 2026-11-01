/*
 * PROXMOX VE'S OWN NOTIFICATIONS, SENT TO ONEUPTIME.
 *
 * Proxmox VE tells its administrators what happened through its notification
 * system (Datacenter -> Notifications): a backup job that succeeded or
 * failed, a replication job that failed, a node that was fenced, updates
 * waiting to be installed, mail for root. Its agent-less way to send them
 * anywhere is a webhook target (Proxmox VE 8.3 and later), whose body is a
 * Handlebars template over the notification's title, message, severity,
 * timestamp, metadata fields and the target's own secrets.
 *
 * This module writes that target so it sends each notification to
 * OneUptime's OpenTelemetry logs endpoint as one log record of the cluster:
 * no agent, no new endpoint, and every log tool OneUptime has - the cluster's
 * Logs page, log monitors, pipelines, retention - works on it. It is shared by
 * the Dashboard, which shows the two commands that create the target on any
 * node, and the logs ingest, which recognises the records, gives them their
 * severity and reads each guest's backup result out of a backup job's
 * message (stampProxmoxNotification).
 *
 * The body is one fixed template. What differs per cluster - its name in
 * OneUptime and the ingestion key - lives in the target's secrets, which
 * Proxmox VE keeps in a root-only file and the template reads with
 * `{{ json secrets.cluster }}`: nothing anybody types ever becomes template
 * text. `json` writes a value as JSON (a string in quotes, escaped), so the
 * message, which holds the whole backup log, can never break the request.
 * A space stands beside every mustache, because `}}}` and `{{{` are
 * Handlebars' own triple-stash.
 *
 * These attribute keys are stored in customers' logs and monitors: never
 * rename one.
 */

// The name of the webhook target and of its matcher, on the cluster.
export const PROXMOX_NOTIFICATION_TARGET_NAME: string = "oneuptime";

// The instrumentation scope every notification record is sent under.
export const PROXMOX_NOTIFICATION_SCOPE_NAME: string =
  "proxmox-ve-notifications";

// Record attributes the template writes.
export enum ProxmoxNotificationAttribute {
  // vzdump, replication, fencing, package-updates, system-mail.
  Type = "pve.notification.type",
  // info, notice, warning, error, unknown.
  Severity = "pve.notification.severity",
  Title = "pve.notification.title",
  // A scheduled backup job's id (absent for "Run now").
  JobId = "pve.notification.job_id",
}

/*
 * The node that sent it, as a resource attribute. Read back through the
 * logs' `resource.` prefix.
 */
export const PROXMOX_NOTIFICATION_NODE_ATTRIBUTE: string = "proxmox.node.name";

export enum ProxmoxNotificationType {
  Backup = "vzdump",
  Replication = "replication",
  Fencing = "fencing",
  PackageUpdates = "package-updates",
  SystemMail = "system-mail",
}

export enum ProxmoxNotificationSeverity {
  Info = "info",
  Notice = "notice",
  Warning = "warning",
  Error = "error",
  Unknown = "unknown",
}

/*
 * The OpenTelemetry severity number for a Proxmox VE severity: INFO (9),
 * INFO2 (10) for a notice, WARN (13), ERROR (17), and UNSPECIFIED (0) for
 * "unknown" (root's mail) and anything else.
 */
export function getProxmoxNotificationSeverityNumber(
  severity: string | null | undefined,
): number {
  switch ((severity || "").trim().toLowerCase()) {
    case ProxmoxNotificationSeverity.Info:
      return 9;
    case ProxmoxNotificationSeverity.Notice:
      return 10;
    case ProxmoxNotificationSeverity.Warning:
      return 13;
    case ProxmoxNotificationSeverity.Error:
      return 17;
    default:
      return 0;
  }
}

/*
 * The webhook target's body: one OpenTelemetry (OTLP/JSON) logs request
 * holding one record. Proxmox VE renders it per notification; see the top
 * of this file for why every value goes through `json`.
 */
export const PROXMOX_NOTIFICATION_WEBHOOK_BODY: string = [
  '{"resourceLogs": [{"resource": {"attributes": [',
  '{"key": "proxmox.cluster.name", "value": {"stringValue": {{ json secrets.cluster }} } }',
  '{{#if fields.hostname}}, {"key": "proxmox.node.name", "value": {"stringValue": {{ json fields.hostname }} } }{{/if}}',
  ']}, "scopeLogs": [{"scope": {"name": "proxmox-ve-notifications"}, "logRecords": [{',
  '"timeUnixNano": "{{ timestamp }}000000000", ',
  '"body": {"stringValue": {{ json message }} }, ',
  '"attributes": [',
  '{"key": "pve.notification.type", "value": {"stringValue": {{ json fields.type }} } }, ',
  '{"key": "pve.notification.severity", "value": {"stringValue": {{ json severity }} } }, ',
  '{"key": "pve.notification.title", "value": {"stringValue": {{ json title }} } }',
  '{{#if fields.[job-id]}}, {"key": "pve.notification.job_id", "value": {"stringValue": {{ json fields.[job-id] }} } }{{/if}}',
  "]}]}]}]}",
].join("");

// The headers the target sends; the key is read from the target's secret.
export const PROXMOX_NOTIFICATION_WEBHOOK_HEADERS: ReadonlyArray<{
  name: string;
  value: string;
}> = [
  { name: "Content-Type", value: "application/json" },
  { name: "x-oneuptime-token", value: "{{ secrets.token }}" },
];

/*
 * Standard base64 of a string's UTF-8 bytes - what Proxmox VE's API wants
 * for a webhook's body, header values and secret values. Written out so it
 * runs the same in a browser, in Node and in a test, with no Buffer, btoa or
 * TextEncoder.
 */
const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(text: string): Array<number> {
  const bytes: Array<number> = [];
  for (const character of text) {
    const codePoint: number = character.codePointAt(0) as number;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

export function encodeProxmoxBase64(text: string): string {
  const bytes: Array<number> = utf8Bytes(text);
  let out: string = "";
  for (let index: number = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index] as number;
    const second: number | undefined = bytes[index + 1];
    const third: number | undefined = bytes[index + 2];
    const triple: number = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += second === undefined ? "=" : BASE64_ALPHABET[(triple >> 6) & 0x3f];
    out += third === undefined ? "=" : BASE64_ALPHABET[triple & 0x3f];
  }
  return out;
}

// One `name=<name>,value=<base64>` property string, as the API takes them.
function propertyString(name: string, value: string): string {
  return `name=${name},value=${encodeProxmoxBase64(value)}`;
}

// Single quotes for a shell, with any single quote in the value kept.
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

// The OTLP logs endpoint of a OneUptime, without a trailing slash.
export function getProxmoxNotificationLogsUrl(oneUptimeUrl: string): string {
  let base: string = oneUptimeUrl.trim();
  while (base.endsWith("/")) {
    base = base.substring(0, base.length - 1);
  }
  return `${base}/otlp/v1/logs`;
}

/*
 * The two commands that send a cluster's notifications to OneUptime, run as
 * root on any node (the configuration is the cluster's, in /etc/pve): the
 * webhook target, then a matcher with no rules - which Proxmox VE reads as
 * "every notification" - that sends to it. Every value travels base64, so
 * no shell or property-string character in a cluster's name or a URL can
 * change the command.
 */
export function buildProxmoxNotificationSetupCommands(data: {
  oneUptimeUrl: string;
  clusterName: string;
  ingestionKey: string;
}): string {
  const target: string = PROXMOX_NOTIFICATION_TARGET_NAME;
  const lines: Array<string> = [
    `pvesh create /cluster/notifications/endpoints/webhook --name ${target} \\`,
    `  --method post --url ${shellQuote(getProxmoxNotificationLogsUrl(data.oneUptimeUrl))} \\`,
  ];

  for (const header of PROXMOX_NOTIFICATION_WEBHOOK_HEADERS) {
    lines.push(`  --header ${propertyString(header.name, header.value)} \\`);
  }

  lines.push(
    `  --secret ${propertyString("token", data.ingestionKey)} \\`,
    `  --secret ${propertyString("cluster", data.clusterName)} \\`,
    `  --body ${encodeProxmoxBase64(PROXMOX_NOTIFICATION_WEBHOOK_BODY)} \\`,
    `  --comment ${shellQuote("Sends this cluster's notifications to OneUptime")}`,
    `pvesh create /cluster/notifications/matchers --name ${target} --target ${target} \\`,
    `  --comment ${shellQuote("Every notification, to OneUptime")}`,
  );

  return lines.join("\n");
}

// The commands that take the target and its matcher away again.
export function buildProxmoxNotificationRemoveCommands(): string {
  const target: string = PROXMOX_NOTIFICATION_TARGET_NAME;
  return [
    `pvesh delete /cluster/notifications/matchers/${target}`,
    `pvesh delete /cluster/notifications/endpoints/webhook/${target}`,
  ].join("\n");
}

/*
 * ---------------------------------------------------------------------------
 * A backup job's message
 * ---------------------------------------------------------------------------
 *
 * Proxmox VE writes a backup job's notification from its vzdump template:
 * an optional error line, then
 *
 *   Details
 *   =======
 *   VMID    Name      Status    Time      Size        Filename
 *   100     web-01    ok        3m 32s    18.4 GiB    vzdump-qemu-100-....vma.zst
 *   102     db-01     err       41s       0 B
 *
 *   Total running time: 4m 13s
 *   Total size: 18.4 GiB
 *
 *   Logs
 *   ====
 *   ...
 *
 * The table pads each column to its widest cell plus four spaces, with no
 * separator line. A row's status is ok, err, or todo for a guest the job
 * never got to; a guest with no name is "VM <vmid>"; Time is written like
 * "1h 1m 40s" and Size like "18.4 GiB". So each row is read token by token:
 * the VMID, the name up to the status, the duration's parts, the size's
 * number and unit, then the file name. Nothing here is a regular
 * expression over the message, which can hold a megabyte of logs: every
 * step is a split or a fixed comparison, linear in the text.
 */

export interface ProxmoxBackupGuestResult {
  vmid: number;
  name: string;
  // ok: backed up. failed: an error, or the job never got to the guest.
  status: "ok" | "failed";
  durationSeconds: number | null;
  bytes: number | null;
  filename: string | null;
}

// More rows than any cluster has guests: a bound on what one message holds.
export const MAX_PROXMOX_BACKUP_ROWS: number = 10000;

const DURATION_UNITS: Record<string, number> = {
  y: 365 * 24 * 3600,
  M: 30 * 24 * 3600,
  w: 7 * 24 * 3600,
  d: 24 * 3600,
  h: 3600,
  m: 60,
  s: 1,
};

const BYTE_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  PiB: 1024 ** 5,
  EiB: 1024 ** 6,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  PB: 1000 ** 5,
};

function isDigits(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const character of text) {
    if (character < "0" || character > "9") {
      return false;
    }
  }
  return true;
}

// A plain decimal number ("18", "18.4"), or null.
function readDecimal(text: string): number | null {
  if (text.length === 0) {
    return null;
  }
  const parts: Array<string> = text.split(".");
  if (parts.length > 2 || !isDigits(parts[0] as string)) {
    return null;
  }
  if (parts.length === 2 && !isDigits(parts[1] as string)) {
    return null;
  }
  const value: number = Number(text);
  return Number.isFinite(value) ? value : null;
}

// One part of a duration ("3m", "32s", "0.5s", "<0.1s"), in seconds.
function readDurationPart(token: string): number | null {
  const body: string = token.startsWith("<") ? token.substring(1) : token;
  if (body.length < 2) {
    return null;
  }
  const unit: string = body.substring(body.length - 1);
  const multiplier: number | undefined = DURATION_UNITS[unit];
  if (multiplier === undefined) {
    return null;
  }
  const amount: number | null = readDecimal(body.substring(0, body.length - 1));
  return amount === null ? null : amount * multiplier;
}

// "1h 1m 40s" -> 3700; null when it is not a duration.
export function parseProxmoxDuration(text: string): number | null {
  const tokens: Array<string> = text.trim().split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  let total: number = 0;
  for (const token of tokens) {
    const seconds: number | null = readDurationPart(token);
    if (seconds === null) {
      return null;
    }
    total += seconds;
  }
  return total;
}

// "18.4 GiB" -> bytes; null when it is not a size.
export function parseProxmoxBytes(text: string): number | null {
  const tokens: Array<string> = text.trim().split(" ").filter(Boolean);
  if (tokens.length !== 2) {
    return null;
  }
  const amount: number | null = readDecimal(tokens[0] as string);
  const multiplier: number | undefined = BYTE_UNITS[tokens[1] as string];
  if (amount === null || multiplier === undefined) {
    return null;
  }
  return Math.round(amount * multiplier);
}

function readStatus(token: string): "ok" | "failed" | null {
  if (token === "ok") {
    return "ok";
  }
  if (token === "err" || token === "todo") {
    return "failed";
  }
  return null;
}

// One row of the Details table, or null when it is not one.
function readBackupRow(line: string): ProxmoxBackupGuestResult | null {
  const tokens: Array<string> = line.split(" ").filter(Boolean);
  if (tokens.length < 2 || !isDigits(tokens[0] as string)) {
    return null;
  }
  const vmid: number = Number(tokens[0]);
  if (!Number.isSafeInteger(vmid) || vmid <= 0) {
    return null;
  }

  // The status is the first status word after the name.
  let statusIndex: number = -1;
  for (let index: number = 1; index < tokens.length; index++) {
    if (readStatus(tokens[index] as string) !== null && index >= 2) {
      statusIndex = index;
      break;
    }
  }
  if (statusIndex < 0) {
    return null;
  }

  const rest: Array<string> = tokens.slice(statusIndex + 1);

  // The size: a number followed by a byte unit.
  let sizeIndex: number = -1;
  for (let index: number = 0; index + 1 < rest.length; index++) {
    if (
      readDecimal(rest[index] as string) !== null &&
      BYTE_UNITS[rest[index + 1] as string] !== undefined
    ) {
      sizeIndex = index;
      break;
    }
  }

  const durationTokens: Array<string> =
    sizeIndex >= 0 ? rest.slice(0, sizeIndex) : rest.slice(0, 1);
  const durationSeconds: number | null =
    durationTokens.length > 0
      ? parseProxmoxDuration(durationTokens.join(" "))
      : null;
  const bytes: number | null =
    sizeIndex >= 0
      ? parseProxmoxBytes(`${rest[sizeIndex]} ${rest[sizeIndex + 1]}`)
      : null;
  const filenameTokens: Array<string> =
    sizeIndex >= 0 ? rest.slice(sizeIndex + 2) : [];
  // A failed guest has no file: the renderer writes its empty cell "null".
  const filename: string = filenameTokens.join(" ");

  return {
    vmid: vmid,
    name: tokens.slice(1, statusIndex).join(" "),
    status: readStatus(tokens[statusIndex] as string) as "ok" | "failed",
    durationSeconds: durationSeconds,
    bytes: bytes,
    filename: filename.length > 0 && filename !== "null" ? filename : null,
  };
}

/*
 * Every guest of a backup job's message, in the table's order. Empty when
 * the message has no Details table (another kind of notification, or a
 * job-level failure before any guest ran).
 */
export function parseProxmoxBackupDetails(
  message: string | null | undefined,
): Array<ProxmoxBackupGuestResult> {
  if (!message) {
    return [];
  }

  const lines: Array<string> = message.split("\n");
  const results: Array<ProxmoxBackupGuestResult> = [];
  let state: "before" | "underline" | "header" | "rows" = "before";

  for (const rawLine of lines) {
    const line: string = rawLine.endsWith("\r")
      ? rawLine.substring(0, rawLine.length - 1)
      : rawLine;
    const trimmed: string = line.trim();

    if (state === "before") {
      if (trimmed === "Details") {
        state = "underline";
      }
      continue;
    }

    if (state === "underline") {
      // The ===== under "Details"; anything else means this was not it.
      state =
        trimmed.length > 0 && trimmed.split("=").join("") === ""
          ? "header"
          : "before";
      continue;
    }

    if (state === "header") {
      if (trimmed.length === 0) {
        continue;
      }
      if (!trimmed.startsWith("VMID")) {
        return results;
      }
      state = "rows";
      continue;
    }

    // Rows run until the blank line before "Total running time".
    if (trimmed.length === 0 || trimmed.startsWith("Total ")) {
      break;
    }
    const row: ProxmoxBackupGuestResult | null = readBackupRow(trimmed);
    if (row) {
      results.push(row);
      if (results.length >= MAX_PROXMOX_BACKUP_ROWS) {
        break;
      }
    }
  }

  return results;
}

/*
 * ---------------------------------------------------------------------------
 * Reading a record at ingest
 * ---------------------------------------------------------------------------
 */

export interface ProxmoxNotificationStamp {
  type: string;
  severity: string;
  severityNumber: number;
  jobId: string | null;
  nodeName: string | null;
  // A backup job's guests, newest result per guest; empty otherwise.
  backupResults: Array<ProxmoxBackupGuestResult>;
}

function readString(
  attributes: Record<string, unknown>,
  key: string,
): string | null {
  const value: unknown = attributes[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

// A record the notification template wrote: it carries its type.
export function isProxmoxNotificationLogRecord(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(
    attributes && readString(attributes, ProxmoxNotificationAttribute.Type),
  );
}

/*
 * What a notification record says: its type and severity (the number the
 * record is stored with), the node and backup job it came from, and - for a
 * backup job - each guest's result. `attributes` is the record's merged
 * attribute map as the logs ingest builds it (resource attributes with
 * their `resource.` prefix). Null for any other record.
 */
export function stampProxmoxNotification(data: {
  attributes: Record<string, unknown>;
  body: string | null | undefined;
}): ProxmoxNotificationStamp | null {
  const type: string | null = readString(
    data.attributes,
    ProxmoxNotificationAttribute.Type,
  );
  if (!type) {
    return null;
  }
  const severity: string =
    readString(data.attributes, ProxmoxNotificationAttribute.Severity) ||
    ProxmoxNotificationSeverity.Unknown;

  return {
    type: type,
    severity: severity,
    severityNumber: getProxmoxNotificationSeverityNumber(severity),
    jobId: readString(data.attributes, ProxmoxNotificationAttribute.JobId),
    nodeName:
      readString(
        data.attributes,
        `resource.${PROXMOX_NOTIFICATION_NODE_ATTRIBUTE}`,
      ) || readString(data.attributes, PROXMOX_NOTIFICATION_NODE_ATTRIBUTE),
    backupResults:
      type === ProxmoxNotificationType.Backup
        ? parseProxmoxBackupDetails(data.body)
        : [],
  };
}
