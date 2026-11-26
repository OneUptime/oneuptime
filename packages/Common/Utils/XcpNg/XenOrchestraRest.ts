import {
  XcpNgMessageDefinition,
  getXcpNgMessageDefinition,
} from "../../Types/XcpNg/XcpNgMessageCatalog";
import {
  XCP_NG_MAX_BACKUP_ERROR_LENGTH,
  XCP_NG_MAX_BACKUP_JOBS,
  XCP_NG_MAX_BACKUP_VMS_PER_RUN,
  XCP_NG_MAX_PATCHES_PER_HOST,
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgBackupSchedule,
  XcpNgBackupStatus,
  XcpNgBackupVmResult,
  XcpNgMissingPatch,
} from "../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "../../Types/XcpNg/XcpNgProbeCollection";

/*
 * ------------------------------------------------------------------
 * Reading Xen Orchestra's REST API (/rest/v0) - pure
 * ------------------------------------------------------------------
 *
 * What the probe asks Xen Orchestra for its pools' alarms, HA, master,
 * patches and backups, and how it reads the answers - from Xen
 * Orchestra's own source (@xen-orchestra/rest-api, xo-server's
 * xapi-object-to-xo and xo-server-backup-reports, master on 26 November
 * 2026) and its OpenAPI examples:
 *
 *   GET /rest/v0/messages?fields=id,name,time,$object,$pool,body&filter=...
 *       XAPI's messages, except the three alarm names: `time` in SECONDS,
 *       `$object` the UUID of what it is about, `$pool` its pool. No
 *       priority: Xen Orchestra's objects drop it (XcpNgMessageCatalog).
 *   GET /rest/v0/alarms?fields=id,name,time,object,$pool,body&filter=...
 *       ALARM, BOND_STATUS_CHANGED and MULTIPATH_PERIODIC_ALERT, parsed:
 *       `time` in MILLISECONDS, `object` {type, uuid}, and `body` {value,
 *       name} - an ALARM's perfmon variable, and its value times 100 to one
 *       decimal ("95.0"), as a string since NaN is no JSON number.
 *   GET /rest/v0/pools?fields=id,HA_enabled,master
 *       whether HA is on and the master's host id. Nothing of HA's plan.
 *   GET /rest/v0/backup-logs?fields=...&filter=start:>=<ms>
 *   GET /rest/v0/backup-logs/<id>
 *       a run: its status, its job, and its tasks - one per VM, with the
 *       VM's own tasks (snapshot, export, transfer) under it.
 *   GET /rest/v0/backup-jobs?fields=id,name,mode,type
 *   GET /rest/v0/schedules?fields=id,jobId,cron,timezone,enabled
 *   GET /rest/v0/hosts?fields=id,$pool,power_state
 *   GET /rest/v0/hosts/<id>/missing_patches
 *       a host's missing patches; refused (403) on a Xen Orchestra
 *       Appliance whose licence does not cover it.
 *
 * Filters are Xen Orchestra's complex-matcher: `a:b c:d` is AND,
 * `|(x y)` is OR, `name:>=5` compares a number, and a property's value
 * matches as a substring - exact for a UUID, which no other UUID holds.
 *
 * Every reader takes what it is given as untrusted JSON: anything that is
 * not what Xen Orchestra sends is skipped, never thrown.
 * ------------------------------------------------------------------
 */

// The longest message body kept, as the XAPI path keeps it.
export const XO_MAX_MESSAGE_BODY_LENGTH: number = 2000;

export const XO_MESSAGE_FIELDS: string = "id,name,time,$object,$pool,body";
export const XO_ALARM_FIELDS: string = "id,name,time,object,$pool,body";
export const XO_POOL_FIELDS: string = "id,name_label,HA_enabled,master";
export const XO_HOST_FIELDS: string = "id,$pool,name_label,power_state";
export const XO_BACKUP_LOG_SUMMARY_FIELDS: string =
  "id,jobId,jobName,scheduleId,start,end,status";
export const XO_BACKUP_JOB_FIELDS: string = "id,name,mode,type";
export const XO_SCHEDULE_FIELDS: string = "id,jobId,cron,timezone,enabled";

// A UUID as XAPI writes it, and Xen Orchestra's ids of its own objects.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// What a value may hold to go into a filter unquoted.
const RAW_FILTER_VALUE: RegExp = /^[0-9A-Za-z._$-]+$/;

/*
 * Whether a character is a control character no line a person reads
 * should carry: C0 but tab, line feed and carriage return, and DEL.
 */
function isUnreadableControl(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    code === 0x7f
  );
}

function dropControlCharacters(text: string): string {
  let out: string = "";
  for (const character of text) {
    if (!isUnreadableControl(character.charCodeAt(0))) {
      out += character;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text: string = value.trim();
  return text ? text : null;
}

// A number, or a string that is only one; anything else is null.
function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const number: number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

// A XAPI UUID, lower case, or null.
export function readXoUuid(value: unknown): string | null {
  const text: string | null = readText(value);
  if (!text) {
    return null;
  }
  const lower: string = text.toLowerCase();
  return UUID_PATTERN.test(lower) ? lower : null;
}

// What Xen Orchestra wrote, made fit for a line a person reads.
export function cleanXoText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  // Cut before cleaning: a body can be long, and only its start is kept.
  const text: string = dropControlCharacters(
    value.substring(0, maxLength * 2 + 16),
  ).trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, Math.max(0, maxLength - 1))}…`;
}

// An answer that is a list: a JSON array, or the values of an object.
function readList(json: unknown): Array<unknown> {
  if (Array.isArray(json)) {
    return json;
  }
  if (isRecord(json)) {
    return Object.values(json);
  }
  return [];
}

/*
 * ---------------------------------------------------------------
 * Filters
 * ---------------------------------------------------------------
 */

export interface XoPoolSince {
  poolId: string;
  // The time the read starts at, in the endpoint's own unit.
  since: number;
}

/*
 * One filter for every pool's new messages: each pool from its own
 * watermark - a pool's times are its master's clock, so one watermark for
 * every pool would lose a pool whose clock runs behind. Pools with no
 * valid UUID or time are left out; none left is null.
 */
export function buildXoPerPoolTimeFilter(
  pools: Array<XoPoolSince>,
): string | null {
  const terms: Array<string> = [];

  for (const pool of pools) {
    const poolId: string | null = readXoUuid(pool.poolId);
    if (!poolId || !Number.isFinite(pool.since) || pool.since < 0) {
      continue;
    }
    terms.push(`($pool:${poolId} time:>=${Math.floor(pool.since)})`);
  }

  if (terms.length === 0) {
    return null;
  }

  if (terms.length === 1) {
    return (terms[0] as string).substring(1, (terms[0] as string).length - 1);
  }

  return `|(${terms.join(" ")})`;
}

// The messages among these ids that still exist: `id:|(a b c)`.
export function buildXoIdFilter(ids: Array<string>): string | null {
  const valid: Array<string> = [];

  for (const id of ids) {
    const text: string | null = readText(id);
    if (text && RAW_FILTER_VALUE.test(text) && !valid.includes(text)) {
      valid.push(text);
    }
  }

  if (valid.length === 0) {
    return null;
  }

  return valid.length === 1 ? `id:${valid[0]}` : `id:|(${valid.join(" ")})`;
}

// The messages of one pool, whatever their time: the first read's.
export function buildXoPoolFilter(poolId: string): string | null {
  const id: string | null = readXoUuid(poolId);
  return id ? `$pool:${id}` : null;
}

// The backup runs that started at or after a time (ms).
export function buildXoBackupLogFilter(sinceMs: number): string {
  return `start:>=${Math.max(0, Math.floor(sinceMs))}`;
}

// A REST path with its query, every value encoded.
export function buildXoPath(
  path: string,
  query: Record<string, string | null | undefined>,
): string {
  const parts: Array<string> = [];

  for (const key of Object.keys(query)) {
    const value: string | null | undefined = query[key];
    if (value === null || value === undefined) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}

/*
 * ---------------------------------------------------------------
 * Messages and alarms
 * ---------------------------------------------------------------
 */

// XAPI's timestamps are whole seconds; Xen Orchestra keeps them so.
function toIsoFromSeconds(seconds: number): string {
  return new Date(Math.floor(seconds) * 1000).toISOString();
}

/*
 * An ALARM's body as XAPI writes it (perfmon), rebuilt from what Xen
 * Orchestra's alarms endpoint parsed out of it, so a message reads the same
 * whichever way it came: "value: 0.95\nconfig:\n<variable>\n<name
 * value="cpu_usage"/>\n</variable>". Xen Orchestra multiplied the value by
 * 100; it is divided back.
 */
export function buildXcpNgAlarmBody(data: {
  variable: string;
  value: string | null;
}): string {
  const shown: number | null = readFiniteNumber(data.value);
  const raw: string =
    shown === null
      ? (data.value || "NaN").trim() || "NaN"
      : String(Math.round((shown / 100) * 10000) / 10000);
  const variable: string = data.variable.replace(/"/g, "");
  return `value: ${raw}\nconfig:\n<variable>\n<name value="${variable}"/>\n</variable>`;
}

// A threshold ALARM's variable and value from its XAPI body.
export interface XcpNgAlarmReading {
  variable: string;
  // As perfmon measured it: a fraction for the *_usage variables.
  value: number | null;
}

const ALARM_VALUE_PREFIX: string = "value:";
const ALARM_NAME_PREFIX: string = '<name value="';

/*
 * The variable and value of a perfmon ALARM's body ("value: 0.95\nconfig:
 * ... <name value="cpu_usage"/>"), read with fixed comparisons over a body
 * that is at most XO_MAX_MESSAGE_BODY_LENGTH long. Null for a body that is
 * not one.
 */
export function readXcpNgAlarmBody(
  body: string | null | undefined,
): XcpNgAlarmReading | null {
  if (!body) {
    return null;
  }

  const text: string = body.substring(0, XO_MAX_MESSAGE_BODY_LENGTH);
  const trimmed: string = text.trimStart();

  if (!trimmed.startsWith(ALARM_VALUE_PREFIX)) {
    return null;
  }

  const firstLine: string = trimmed
    .substring(ALARM_VALUE_PREFIX.length)
    .split("\n")[0] as string;
  const valueText: string = firstLine.trim();
  const value: number = Number(valueText);

  const nameStart: number = text.indexOf(ALARM_NAME_PREFIX);
  if (nameStart < 0) {
    return null;
  }
  const afterName: string = text.substring(
    nameStart + ALARM_NAME_PREFIX.length,
  );
  const nameEnd: number = afterName.indexOf('"');
  if (nameEnd <= 0) {
    return null;
  }

  return {
    variable: afterName.substring(0, nameEnd).trim(),
    value: valueText && Number.isFinite(value) ? value : null,
  };
}

function toPoolMessage(data: {
  id: string;
  poolId: string;
  name: string;
  timeSeconds: number;
  objectUuid: string;
  objectClass: string | null;
  body: string;
}): XcpNgPoolMessage {
  const definition: XcpNgMessageDefinition = getXcpNgMessageDefinition({
    name: data.name,
  });

  return {
    uuid: data.id,
    poolId: data.poolId,
    name: data.name,
    priority: definition.priority,
    /*
     * Xen Orchestra names the object's type only for an alarm; a message
     * takes the class its name is raised on, and the server looks the
     * object up in the pool's inventory.
     */
    objectClass: data.objectClass || definition.objectType,
    objectUuid: data.objectUuid,
    timestamp: toIsoFromSeconds(data.timeSeconds),
    body: cleanXoText(data.body, XO_MAX_MESSAGE_BODY_LENGTH),
  };
}

/*
 * /rest/v0/messages, as XcpNgPoolMessage: times in seconds. A message with
 * no id, name, pool or time is skipped.
 */
export function readXoMessages(json: unknown): Array<XcpNgPoolMessage> {
  const messages: Array<XcpNgPoolMessage> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }

    const id: string | null = readText(entry["id"]) || readText(entry["uuid"]);
    const name: string | null = readText(entry["name"]);
    const poolId: string | null =
      readXoUuid(entry["$pool"]) || readXoUuid(entry["$poolId"]);
    const time: number | null = readFiniteNumber(entry["time"]);

    if (!id || !name || !poolId || time === null || time < 0) {
      continue;
    }

    messages.push(
      toPoolMessage({
        id: id,
        poolId: poolId,
        name: name.toUpperCase(),
        timeSeconds: time,
        objectUuid: readXoUuid(entry["$object"]) || "",
        objectClass: null,
        body: typeof entry["body"] === "string" ? entry["body"] : "",
      }),
    );
  }

  return messages;
}

/*
 * /rest/v0/alarms, as XcpNgPoolMessage: Xen Orchestra gives their times in
 * milliseconds (seconds times 1000) and their object's type.
 */
export function readXoAlarms(json: unknown): Array<XcpNgPoolMessage> {
  const messages: Array<XcpNgPoolMessage> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }

    const id: string | null = readText(entry["id"]) || readText(entry["uuid"]);
    const name: string | null = readText(entry["name"]);
    const poolId: string | null =
      readXoUuid(entry["$pool"]) || readXoUuid(entry["$poolId"]);
    const timeMs: number | null = readFiniteNumber(entry["time"]);

    if (!id || !name || !poolId || timeMs === null || timeMs < 0) {
      continue;
    }

    const object: Record<string, unknown> = isRecord(entry["object"])
      ? (entry["object"] as Record<string, unknown>)
      : {};
    const objectType: string | null = readText(object["type"]);
    const body: Record<string, unknown> = isRecord(entry["body"])
      ? (entry["body"] as Record<string, unknown>)
      : {};
    const bodyName: string | null = readText(body["name"]);
    const upperName: string = name.toUpperCase();

    /*
     * An ALARM's body was perfmon's XML, parsed; the other two alarm names
     * carry plain text, which Xen Orchestra put in `name`.
     */
    const text: string =
      upperName === "ALARM" && bodyName
        ? buildXcpNgAlarmBody({
            variable: bodyName,
            value:
              typeof body["value"] === "string"
                ? (body["value"] as string)
                : typeof body["value"] === "number"
                  ? String(body["value"])
                  : null,
          })
        : bodyName || (typeof entry["body"] === "string" ? entry["body"] : "");

    messages.push(
      toPoolMessage({
        id: id,
        poolId: poolId,
        name: upperName,
        // Whole seconds, as every other message.
        timeSeconds: Math.floor(timeMs / 1000),
        objectUuid: readXoUuid(object["uuid"]) || "",
        objectClass:
          objectType && objectType.toLowerCase() !== "unknown"
            ? objectType
            : null,
        body: text,
      }),
    );
  }

  return messages;
}

// The ids in an answer of `fields=id`: the open messages that still exist.
export function readXoIds(json: unknown): Set<string> {
  const ids: Set<string> = new Set<string>();

  for (const entry of readList(json)) {
    if (typeof entry === "string") {
      // A list without fields is of hrefs: /rest/v0/messages/<id>.
      const id: string = entry.substring(entry.lastIndexOf("/") + 1).trim();
      if (id) {
        ids.add(id);
      }
      continue;
    }
    if (isRecord(entry)) {
      const id: string | null = readText(entry["id"]);
      if (id) {
        ids.add(id);
      }
    }
  }

  return ids;
}

/*
 * ---------------------------------------------------------------
 * Pools and hosts
 * ---------------------------------------------------------------
 */

// /rest/v0/pools: whether HA is on, and the master.
export function readXoPools(json: unknown): Array<XcpNgPoolState> {
  const pools: Array<XcpNgPoolState> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const poolId: string | null =
      readXoUuid(entry["id"]) || readXoUuid(entry["uuid"]);
    if (!poolId) {
      continue;
    }
    const state: XcpNgPoolState = {
      poolId: poolId,
      haEnabled: entry["HA_enabled"] === true,
    };
    const master: string | null = readXoUuid(entry["master"]);
    if (master) {
      state.masterHostUuid = master;
    }
    pools.push(state);
  }

  return pools;
}

export interface XoHostReading {
  hostId: string;
  poolId: string;
  name: string;
  isRunning: boolean;
}

// /rest/v0/hosts: which hosts a patch check asks about.
export function readXoHosts(json: unknown): Array<XoHostReading> {
  const hosts: Array<XoHostReading> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const hostId: string | null =
      readXoUuid(entry["id"]) || readXoUuid(entry["uuid"]);
    const poolId: string | null = readXoUuid(entry["$pool"]);
    if (!hostId || !poolId) {
      continue;
    }
    hosts.push({
      hostId: hostId,
      poolId: poolId,
      name: readText(entry["name_label"]) || hostId,
      isRunning: entry["power_state"] === "Running",
    });
  }

  return hosts;
}

/*
 * /rest/v0/hosts/<id>/missing_patches: XCP-ng's packages (name, version,
 * release, description, size) or XenServer's updates (name, description).
 * Kept by name, at most XCP_NG_MAX_PATCHES_PER_HOST; the count is all of
 * them.
 */
export function readXoMissingPatches(json: unknown): {
  patchCount: number;
  patches: Array<XcpNgMissingPatch>;
} {
  const patches: Array<XcpNgMissingPatch> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const name: string | null =
      readText(entry["name"]) || readText(entry["id"]);
    if (!name) {
      continue;
    }
    const version: string | null = readText(entry["version"]);
    const release: string | null = readText(entry["release"]);
    const key: string = `${name}\n${version || ""}\n${release || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const patch: XcpNgMissingPatch = {
      name: cleanXoText(name, 200),
    };
    if (version) {
      patch.version = cleanXoText(version, 100);
    }
    if (release) {
      patch.release = cleanXoText(release, 100);
    }
    const description: string = cleanXoText(entry["description"], 300);
    if (description) {
      patch.description = description;
    }
    const size: number | null = readFiniteNumber(entry["size"]);
    if (size !== null && size >= 0) {
      patch.size = Math.round(size);
    }
    patches.push(patch);
  }

  patches.sort((left: XcpNgMissingPatch, right: XcpNgMissingPatch): number => {
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });

  return {
    patchCount: patches.length,
    patches: patches.slice(0, XCP_NG_MAX_PATCHES_PER_HOST),
  };
}

/*
 * ---------------------------------------------------------------
 * Backups
 * ---------------------------------------------------------------
 */

export type XoBackupLogStatus = XcpNgBackupStatus | "pending";

export interface XoBackupLogSummary {
  id: string;
  jobId: string;
  jobName: string;
  scheduleId: string | null;
  // ms, Xen Orchestra's clock.
  start: number;
  end: number | null;
  status: XoBackupLogStatus;
}

export function readXoBackupStatus(value: unknown): XoBackupLogStatus | null {
  switch (value) {
    case "success":
      return XcpNgBackupStatus.Success;
    case "failure":
      return XcpNgBackupStatus.Failure;
    case "skipped":
      return XcpNgBackupStatus.Skipped;
    case "interrupted":
      return XcpNgBackupStatus.Interrupted;
    case "pending":
      return "pending";
    default:
      return null;
  }
}

// /rest/v0/backup-logs, with the summary fields.
export function readXoBackupLogSummaries(
  json: unknown,
): Array<XoBackupLogSummary> {
  const logs: Array<XoBackupLogSummary> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const id: string | null =
      readText(entry["id"]) ||
      (typeof entry["id"] === "number" ? String(entry["id"]) : null);
    const jobId: string | null = readText(entry["jobId"]);
    const start: number | null = readFiniteNumber(entry["start"]);
    const status: XoBackupLogStatus | null = readXoBackupStatus(
      entry["status"],
    );

    if (!id || !jobId || start === null || !status) {
      continue;
    }

    logs.push({
      id: id,
      jobId: jobId,
      jobName: cleanXoText(entry["jobName"], 200) || jobId,
      scheduleId: readText(entry["scheduleId"]),
      start: start,
      end: readFiniteNumber(entry["end"]),
      status: status,
    });
  }

  logs.sort((left: XoBackupLogSummary, right: XoBackupLogSummary): number => {
    return left.start - right.start || (left.id < right.id ? -1 : 1);
  });

  return logs;
}

// An error as Xen Orchestra logs one: { message, name, code, stack }.
function readXoError(value: unknown): string | null {
  if (typeof value === "string") {
    return cleanXoText(value, XCP_NG_MAX_BACKUP_ERROR_LENGTH) || null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const message: string | null =
    readText(value["message"]) || readText(value["code"]);
  if (!message) {
    return null;
  }
  // Never the stack: it says where in Xen Orchestra, not what went wrong.
  return cleanXoText(message, XCP_NG_MAX_BACKUP_ERROR_LENGTH) || null;
}

function toIsoFromMs(value: unknown): string | undefined {
  const ms: number | null = readFiniteNumber(value);
  if (ms === null || ms < 0) {
    return undefined;
  }
  const date: Date = new Date(ms);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface XoTaskLike {
  message?: unknown;
  status?: unknown;
  result?: unknown;
  data?: unknown;
  tasks?: unknown;
  start?: unknown;
  end?: unknown;
}

function readTasks(value: unknown): Array<XoTaskLike> {
  return Array.isArray(value)
    ? (value.filter((task: unknown) => {
        return isRecord(task);
      }) as Array<XoTaskLike>)
    : [];
}

// The deepest task under this one that failed, said with where it was.
function findFailure(task: XoTaskLike, depth: number): string | null {
  if (depth > 6) {
    return null;
  }

  for (const child of readTasks(task.tasks)) {
    if (child.status !== "failure") {
      continue;
    }
    const deeper: string | null = findFailure(child, depth + 1);
    if (deeper) {
      return deeper;
    }
    const error: string | null = readXoError(child.result);
    if (error) {
      const what: string | null = readText(child.message);
      return what ? `${what}: ${error}` : error;
    }
  }

  return null;
}

// What a VM's backup sent: every "transfer" under it, summed.
function sumTransferred(task: XoTaskLike, depth: number): number {
  if (depth > 6) {
    return 0;
  }
  let total: number = 0;
  for (const child of readTasks(task.tasks)) {
    if (child.message === "transfer" && isRecord(child.result)) {
      const size: number | null = readFiniteNumber(
        (child.result as Record<string, unknown>)["size"],
      );
      if (size !== null && size > 0) {
        total += size;
      }
    }
    total += sumTransferred(child, depth + 1);
  }
  return total;
}

const STATUS_ORDER: Readonly<Record<XcpNgBackupStatus, number>> = {
  [XcpNgBackupStatus.Failure]: 0,
  [XcpNgBackupStatus.Interrupted]: 1,
  [XcpNgBackupStatus.Skipped]: 2,
  [XcpNgBackupStatus.Success]: 3,
};

// "unhealthy VDI chain", as Xen Orchestra's reports explain it.
const UNHEALTHY_VDI_CHAIN: string = "unhealthy VDI chain";

/*
 * One finished run, from its full log (/rest/v0/backup-logs/<id>) - read
 * the way Xen Orchestra's own backup reports read it
 * (xo-server-backup-reports): each task of type VM is a VM's backup; a VM
 * whose task has a result failed (or was skipped, with why); one without
 * failed in the task under it that has one (an export to a remote, a
 * snapshot); "get SR record" and "get remote adapter" are a target the run
 * could not reach. Null for a run still pending, or a log that is not one.
 */
export function readXoBackupRun(json: unknown): XcpNgBackupRun | null {
  if (!isRecord(json)) {
    return null;
  }

  const id: string | null =
    readText(json["id"]) ||
    (typeof json["id"] === "number" ? String(json["id"]) : null);
  const jobId: string | null = readText(json["jobId"]);
  const status: XoBackupLogStatus | null = readXoBackupStatus(json["status"]);
  const startedAt: string | undefined = toIsoFromMs(json["start"]);

  if (!id || !jobId || !status || status === "pending" || !startedAt) {
    return null;
  }

  const data: Record<string, unknown> = isRecord(json["data"])
    ? (json["data"] as Record<string, unknown>)
    : {};

  const jobErrors: Array<string> = [];
  const runError: string | null = readXoError(json["result"]);
  if (runError) {
    jobErrors.push(runError);
  }

  const vms: Array<XcpNgBackupVmResult> = [];
  const seenVms: Set<string> = new Set<string>();

  for (const task of readTasks(json["tasks"])) {
    const taskData: Record<string, unknown> = isRecord(task.data)
      ? (task.data as Record<string, unknown>)
      : {};

    if (
      task.message === "get SR record" ||
      task.message === "get remote adapter"
    ) {
      const error: string | null = readXoError(task.result);
      const target: string | null = readText(taskData["id"]);
      jobErrors.push(
        `${String(task.message)}${target ? ` ${target}` : ""}: ${
          error || "failed"
        }`,
      );
      continue;
    }

    if (taskData["type"] !== "VM") {
      // Metadata backups (a pool's, Xen Orchestra's): a failure is the run's.
      if (task.status === "failure") {
        const error: string | null =
          readXoError(task.result) || findFailure(task, 0);
        if (error) {
          jobErrors.push(error);
        }
      }
      continue;
    }

    const vmId: string | null = readXoUuid(taskData["id"]);
    if (!vmId || seenVms.has(vmId)) {
      continue;
    }
    seenVms.add(vmId);

    let vmStatus: XoBackupLogStatus | null = readXoBackupStatus(task.status);
    // A VM still pending in a finished run never finished: interrupted.
    if (!vmStatus || vmStatus === "pending") {
      vmStatus = XcpNgBackupStatus.Interrupted;
    }

    const result: XcpNgBackupVmResult = {
      vmId: vmId,
      status: vmStatus,
    };

    const vmName: string = cleanXoText(taskData["name_label"], 200);
    if (vmName) {
      result.vmName = vmName;
    }

    if (vmStatus !== XcpNgBackupStatus.Success) {
      let error: string | null = readXoError(task.result);
      if (error === UNHEALTHY_VDI_CHAIN) {
        error =
          "unhealthy VDI chain: Xen Orchestra skipped the VM to protect its disks' chain until it is coalesced";
      }
      error = error || findFailure(task, 0);
      if (error) {
        result.error = cleanXoText(error, XCP_NG_MAX_BACKUP_ERROR_LENGTH);
      }
    }

    const vmStartedAt: string | undefined = toIsoFromMs(task.start);
    const vmEndedAt: string | undefined = toIsoFromMs(task.end);
    if (vmStartedAt) {
      result.startedAt = vmStartedAt;
    }
    if (vmEndedAt) {
      result.endedAt = vmEndedAt;
    }

    const bytes: number = sumTransferred(task, 0);
    if (bytes > 0) {
      result.bytes = bytes;
    }

    vms.push(result);
  }

  // The VMs the run included, from its "vms" info: what it was asked to do.
  const includedVmIds: Array<string> = [];
  const infos: Array<unknown> = Array.isArray(json["infos"])
    ? (json["infos"] as Array<unknown>)
    : [];
  for (const info of infos) {
    if (!isRecord(info) || info["message"] !== "vms") {
      continue;
    }
    const infoData: unknown = info["data"];
    const listed: unknown = isRecord(infoData)
      ? (infoData as Record<string, unknown>)["vms"]
      : undefined;
    if (Array.isArray(listed)) {
      for (const vm of listed) {
        const vmId: string | null = readXoUuid(vm);
        if (vmId && !includedVmIds.includes(vmId)) {
          includedVmIds.push(vmId);
        }
      }
    }
  }
  for (const vm of vms) {
    if (!includedVmIds.includes(vm.vmId)) {
      includedVmIds.push(vm.vmId);
    }
  }

  vms.sort((left: XcpNgBackupVmResult, right: XcpNgBackupVmResult): number => {
    return STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  });

  const run: XcpNgBackupRun = {
    runId: id,
    jobId: jobId,
    jobName: cleanXoText(json["jobName"], 200) || jobId,
    status: status,
    startedAt: startedAt,
    vms: vms.slice(0, XCP_NG_MAX_BACKUP_VMS_PER_RUN),
    includedVmIds: includedVmIds.slice(0, XCP_NG_MAX_BACKUP_VMS_PER_RUN * 2),
  };

  if (vms.length > XCP_NG_MAX_BACKUP_VMS_PER_RUN) {
    run.omittedVmCount = vms.length - XCP_NG_MAX_BACKUP_VMS_PER_RUN;
  }

  const scheduleId: string | null = readText(json["scheduleId"]);
  if (scheduleId) {
    run.scheduleId = scheduleId;
  }
  const mode: string | null = readText(data["mode"]);
  if (mode) {
    run.mode = cleanXoText(mode, 50);
  }
  const endedAt: string | undefined = toIsoFromMs(json["end"]);
  if (endedAt) {
    run.endedAt = endedAt;
  }
  if (jobErrors.length > 0) {
    run.error = cleanXoText(
      Array.from(new Set(jobErrors)).join("; "),
      XCP_NG_MAX_BACKUP_ERROR_LENGTH,
    );
  }

  return run;
}

export interface XoBackupJobReading {
  jobId: string;
  name: string;
  mode: string | null;
  jobType: string | null;
}

// /rest/v0/backup-jobs: VM, mirror and metadata backup jobs alike.
export function readXoBackupJobs(json: unknown): Array<XoBackupJobReading> {
  const jobs: Array<XoBackupJobReading> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const jobId: string | null = readText(entry["id"]);
    if (!jobId) {
      continue;
    }
    jobs.push({
      jobId: jobId,
      name: cleanXoText(entry["name"], 200) || jobId,
      mode: readText(entry["mode"]),
      jobType: readText(entry["type"]),
    });
  }

  return jobs;
}

export interface XoScheduleReading {
  scheduleId: string;
  jobId: string;
  cron: string;
  timezone: string | null;
  enabled: boolean;
}

// /rest/v0/schedules: when each job runs.
export function readXoSchedules(json: unknown): Array<XoScheduleReading> {
  const schedules: Array<XoScheduleReading> = [];

  for (const entry of readList(json)) {
    if (!isRecord(entry)) {
      continue;
    }
    const scheduleId: string | null = readText(entry["id"]);
    const jobId: string | null = readText(entry["jobId"]);
    const cron: string | null = readText(entry["cron"]);
    if (!scheduleId || !jobId || !cron) {
      continue;
    }
    schedules.push({
      scheduleId: scheduleId,
      jobId: jobId,
      cron: cleanXoText(cron, 100),
      timezone: readText(entry["timezone"]),
      enabled: entry["enabled"] === true,
    });
  }

  return schedules;
}

/*
 * Each job with its schedules: what the server works out how late a VM's
 * backup may be from. Jobs are kept in Xen Orchestra's order, at most
 * XCP_NG_MAX_BACKUP_JOBS.
 */
export function buildXcpNgBackupJobInfos(data: {
  jobs: Array<XoBackupJobReading>;
  schedules: Array<XoScheduleReading>;
}): Array<XcpNgBackupJobInfo> {
  const schedulesByJob: Map<string, Array<XcpNgBackupSchedule>> = new Map();

  for (const schedule of data.schedules) {
    let list: Array<XcpNgBackupSchedule> | undefined = schedulesByJob.get(
      schedule.jobId,
    );
    if (!list) {
      list = [];
      schedulesByJob.set(schedule.jobId, list);
    }
    const entry: XcpNgBackupSchedule = {
      scheduleId: schedule.scheduleId,
      cron: schedule.cron,
      enabled: schedule.enabled,
    };
    if (schedule.timezone) {
      entry.timezone = schedule.timezone;
    }
    list.push(entry);
  }

  return data.jobs
    .slice(0, XCP_NG_MAX_BACKUP_JOBS)
    .map((job: XoBackupJobReading): XcpNgBackupJobInfo => {
      const info: XcpNgBackupJobInfo = {
        jobId: job.jobId,
        name: job.name,
        schedules: schedulesByJob.get(job.jobId) || [],
      };
      if (job.mode) {
        info.mode = job.mode;
      }
      if (job.jobType) {
        info.jobType = job.jobType;
      }
      return info;
    });
}
