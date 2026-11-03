import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_MAX_OID_LENGTH,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "Common/Types/ObjectID";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  SNMP_WALK_POLL_INTERVAL_IN_MS,
  SnmpWalkMessage,
  SnmpWalkRowView,
  describeSnmpWalkFailure,
  formatSnmpTimeTicks,
  getCollectedOids,
  getSnmpWalkTypeLabel,
  isNumericSnmpWalkRow,
  isWalkableStart,
  toSnmpWalkRowView,
  translateSnmpWalkServerMessage,
} from "./SnmpWalkViewModel";

/*
 * The pure half of the Network's SNMP Walk page (issue #5548): walk many
 * devices at once - each from its own probe with its own SNMP credentials,
 * exactly as a device's own SNMP Walk page walks one (issue #5184) - and
 * read what they answered side by side, one OID a row: which devices answer
 * it and with what, which walked past it without it, and which could not be
 * walked at all and why. From there an OID is collected on every device
 * that answers it.
 *
 * Nothing new runs on a probe. Each device's walk is the same Network
 * Device Diagnostic of type "SNMP Walk" its own page creates, refused or
 * allowed by the same server checks, and kept the same two days - so a
 * device's own SNMP Walk page opens on the walk read from here, with
 * Continue walking, Download and Alert on it.
 *
 * React-free and window-free on purpose, as SnmpWalkViewModel is: App's
 * tests import it, and the card next door only renders.
 */

/*
 * Devices one walk reads. Each walks up to SNMP_WALK_MAX_OIDS OIDs, so this
 * bounds what the page holds and compares (fifty thousand OIDs at most) and
 * the burst a fleet's probes are handed at once.
 */
export const MULTI_DEVICE_SNMP_WALK_MAX_DEVICES: number = 50;

/*
 * How long the page waits for the last walk to be reported. Longer than a
 * device's own page waits (two minutes): fifty walks can queue on one probe,
 * which runs a few at a time, and a walk is still claimed for ten minutes
 * after it was asked for (NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES).
 */
export const MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS: number = 300000;
export const MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS: number =
  SNMP_WALK_POLL_INTERVAL_IN_MS;
export const MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS: number = Math.ceil(
  MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS /
    MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
);
export const MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES: number =
  SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES;

/*
 * Requests in flight at once when the page asks for the walks, and when it
 * collects an OID on many devices: each is the same request, with the same
 * checks, as on the device's own page, a few at a time.
 */
export const MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY: number = 5;

/*
 * Walks asked for within this long of the newest are one walk of the
 * devices, when the page puts the last one back together after a reload:
 * one press of Walk creates every row within seconds, and a device walked
 * on its own yesterday is not part of today's comparison.
 */
export const MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES: number = 10;

// Walk rows read, without their results, to find the last walk again.
export const MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT: number = 500;

/*
 * The address of the page holds what was walked - the devices and the OID -
 * so a reload, Back from a device, or a link a colleague was sent opens on
 * the same walk. A link carries at most this many devices: the page walks
 * fifty at a time, and says so, but a link from a selection of a hundred
 * still opens with all of them.
 */
export const MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM: string = "devices";
export const MULTI_DEVICE_SNMP_WALK_OID_PARAM: string = "oid";
export const MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES: number = 500;

export interface MultiDeviceSnmpWalkQuery {
  // Device ids, in the order they were picked, each once.
  deviceIds: Array<string>;
  // Where to start: a numeric OID, or empty for everything.
  startOid: string;
}

/*
 * What the page's address names, read as untrusted as any link: ids that
 * are not ids are dropped, a repeat counts once, and an OID that is not a
 * numeric OID (or is longer than an OID can be) is dropped.
 */
export function parseMultiDeviceSnmpWalkQuery(data: {
  devices: string | null | undefined;
  oid: string | null | undefined;
}): MultiDeviceSnmpWalkQuery {
  const deviceIds: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const part of (data.devices || "").split(",")) {
    const id: string = part.trim();

    if (!id || !ObjectID.isValidUUID(id) || seen.has(id.toLowerCase())) {
      continue;
    }

    seen.add(id.toLowerCase());
    deviceIds.push(id);

    if (deviceIds.length >= MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES) {
      break;
    }
  }

  const oid: string = SnmpOidListUtil.normalizeOid(data.oid || "");
  const startOid: string =
    oid && isWalkableStart(oid) && oid.length <= SNMP_WALK_MAX_OID_LENGTH
      ? oid
      : "";

  return { deviceIds: deviceIds, startOid: startOid };
}

/*
 * The page's query string for a walk: the devices as one comma-separated
 * list (ids hold no comma), and the OID when there is one. Built with
 * URLSearchParams, so every value is encoded.
 */
export function buildMultiDeviceSnmpWalkQuery(
  query: MultiDeviceSnmpWalkQuery,
): string {
  const params: URLSearchParams = new URLSearchParams();

  if (query.deviceIds.length > 0) {
    params.set(MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM, query.deviceIds.join(","));
  }

  const oid: string = SnmpOidListUtil.normalizeOid(query.startOid);

  if (oid) {
    params.set(MULTI_DEVICE_SNMP_WALK_OID_PARAM, oid);
  }

  return params.toString();
}

/*
 * What the page knows of a picked device: enough to walk it, name it, and
 * say what it already collects. Read from the device, never its
 * credentials - the server resolves those when the walk is asked for.
 */
export interface MultiDeviceSnmpWalkDevice {
  id: string;
  name: string;
  hasProbe: boolean;
  probeName?: string | undefined;
  // Monitor-backed devices are never polled, so nothing is collected on them.
  isProbePolled: boolean;
  snmpOids: Array<SnmpOid>;
  templateId?: string | undefined;
  templateName?: string | undefined;
  templateOids: Array<SnmpOid>;
}

// Where each device's walk stands.
export enum DeviceWalkStatus {
  // The page is asking the server for the walk.
  Asking = "asking",
  // Asked for: the probe has it or picks it up soon (Pending, In Progress).
  Walking = "walking",
  // The probe reported what the device answered (a Completed diagnostic).
  Walked = "walked",
  // The probe could not run the walk at all (a Failed diagnostic).
  ProbeFailed = "probeFailed",
  /*
   * The walk never started: the server refused it (no SNMP credentials, a
   * walk of the device already running, the device archived) or the page
   * did (no probe to walk it from).
   */
  NotStarted = "notStarted",
  // The probe did not report the walk within the page's wait.
  TimedOut = "timedOut",
}

export interface DeviceWalk {
  deviceId: string;
  status: DeviceWalkStatus;
  diagnosticId?: string | undefined;
  createdAt?: Date | undefined;
  result?: NetworkDeviceDiagnosticSnmpWalkResult | undefined;
  /*
   * Why it did not start, or could not run: as the server or the probe
   * worded it, translated where it is shown
   * (translateMultiDeviceSnmpWalkMessage).
   */
  message?: string | undefined;
}

export function isDeviceWalkSettled(walk: DeviceWalk): boolean {
  return (
    walk.status !== DeviceWalkStatus.Asking &&
    walk.status !== DeviceWalkStatus.Walking
  );
}

// A walk row as the page reads it back from the API.
export interface StoredDeviceWalk {
  diagnosticId: string;
  deviceId: string;
  status?: string | undefined;
  statusMessage?: string | undefined;
  createdAt?: Date | string | undefined;
  rootOid?: string | undefined;
  afterOid?: string | undefined;
  result?: NetworkDeviceDiagnosticSnmpWalkResult | undefined;
}

// A date the API handed back, as milliseconds; NaN when there is none.
function toTime(value: Date | string | undefined): number {
  if (!value) {
    return Number.NaN;
  }

  return new Date(value).getTime();
}

function toDate(value: Date | string | undefined): Date | undefined {
  const time: number = toTime(value);

  return Number.isFinite(time) ? new Date(time) : undefined;
}

/*
 * Where a device's walk stands, from its row. A Completed row with no
 * result never happens with a current probe; it reads as a walk the probe
 * could not run rather than as one that found nothing.
 */
export function toDeviceWalk(stored: StoredDeviceWalk): DeviceWalk {
  const base: DeviceWalk = {
    deviceId: stored.deviceId,
    status: DeviceWalkStatus.Walking,
    diagnosticId: stored.diagnosticId,
    createdAt: toDate(stored.createdAt),
  };

  if (stored.status === NetworkDeviceDiagnosticStatus.Completed) {
    if (stored.result) {
      return {
        ...base,
        status: DeviceWalkStatus.Walked,
        result: stored.result,
      };
    }

    return {
      ...base,
      status: DeviceWalkStatus.ProbeFailed,
      message: stored.statusMessage,
    };
  }

  if (stored.status === NetworkDeviceDiagnosticStatus.Failed) {
    return {
      ...base,
      status: DeviceWalkStatus.ProbeFailed,
      message: stored.statusMessage,
    };
  }

  return base;
}

/*
 * The last walk of the picked devices under `rootOid`, after a reload:
 * each device's newest fresh walk of that subtree (a walk continued on the
 * device's own page is not one), kept when it was asked for within
 * MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES of the newest of them - the
 * walks one press of Walk created. In the order the devices were picked.
 */
export function pickLatestDeviceWalks(data: {
  entries: Array<StoredDeviceWalk>;
  deviceIds: Array<string>;
  rootOid: string;
}): Array<StoredDeviceWalk> {
  const rootOid: string = SnmpOidListUtil.normalizeOid(data.rootOid);

  if (!rootOid) {
    return [];
  }

  const picked: Set<string> = new Set(data.deviceIds);
  const newestByDevice: Map<string, StoredDeviceWalk> = new Map();

  for (const entry of data.entries) {
    if (
      !picked.has(entry.deviceId) ||
      entry.afterOid ||
      SnmpOidListUtil.normalizeOid(entry.rootOid || "") !== rootOid ||
      !Number.isFinite(toTime(entry.createdAt))
    ) {
      continue;
    }

    const current: StoredDeviceWalk | undefined = newestByDevice.get(
      entry.deviceId,
    );

    if (!current || toTime(entry.createdAt) > toTime(current.createdAt)) {
      newestByDevice.set(entry.deviceId, entry);
    }
  }

  let newest: number = Number.NEGATIVE_INFINITY;

  for (const entry of newestByDevice.values()) {
    newest = Math.max(newest, toTime(entry.createdAt));
  }

  const runStart: number =
    newest - MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES * 60 * 1000;

  return data.deviceIds
    .map((deviceId: string): StoredDeviceWalk | undefined => {
      return newestByDevice.get(deviceId);
    })
    .filter(
      (entry: StoredDeviceWalk | undefined): entry is StoredDeviceWalk => {
        return Boolean(entry) && toTime(entry!.createdAt) >= runStart;
      },
    );
}

/*
 * Whether a walk still on its way when the page loads is worth waiting
 * for: asked for within the page's wait. One older than that is not coming.
 */
export function isWalkStillAwaited(data: {
  createdAt: Date | string | undefined;
  now: Date;
}): boolean {
  const createdAt: number = toTime(data.createdAt);

  return (
    Number.isFinite(createdAt) &&
    data.now.getTime() - createdAt < MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS
  );
}

/*
 * The last OID a walk read before it stopped short, which it read
 * everything up to; undefined for a walk that read its whole subtree.
 */
export function getWalkStopOid(
  result: NetworkDeviceDiagnosticSnmpWalkResult,
): string | undefined {
  if (result.stopReason === SnmpWalkStopReason.Complete) {
    return undefined;
  }

  return (
    result.nextOid ||
    result.rows[result.rows.length - 1]?.oid ||
    result.afterOid ||
    undefined
  );
}

/*
 * Whether a walk reached `oid`: it read its whole subtree, or stopped at or
 * after it. A device whose walk stopped before an OID may well answer it;
 * the page says the walk did not get that far rather than that the device
 * does not have it.
 */
export function doesWalkReachOid(
  result: NetworkDeviceDiagnosticSnmpWalkResult,
  oid: string,
): boolean {
  if (result.stopReason === SnmpWalkStopReason.Complete) {
    return true;
  }

  const stopOid: string | undefined = getWalkStopOid(result);

  return Boolean(stopOid) && compareOidArcs(toArcs(oid), toArcs(stopOid!)) <= 0;
}

/*
 * Whether a device's walk tells anything about the OIDs under its root: it
 * was walked, and either read its subtree (whole or in part) or ran to the
 * end of it. A walk the device refused, or never answered, says nothing
 * about which OIDs it has; the page lists it with the reason instead.
 */
export function isComparableWalk(walk: DeviceWalk): boolean {
  if (walk.status !== DeviceWalkStatus.Walked || !walk.result) {
    return false;
  }

  return (
    walk.result.stopReason !== SnmpWalkStopReason.Failed ||
    walk.result.rows.length > 0
  );
}

// One device's answer for an OID.
export interface DeviceAnswer {
  deviceId: string;
  row: SnmpWalkRow;
}

/*
 * One OID as the devices answered it: one row of the page's comparison.
 */
export interface SnmpWalkComparisonRow {
  oid: string;
  // The devices that answered it and what each read, in the order picked.
  answers: Array<DeviceAnswer>;
  /*
   * How many compared walks reached it: the devices that answered it, and
   * those that walked past it without it. Walks that stopped before it are
   * left out, so "answered by 3 of 4" never counts a walk that did not get
   * that far.
   */
  reachedCount: number;
}

type OidArcs = Array<number>;

function toArcs(oid: string): OidArcs {
  return SnmpOidListUtil.normalizeOid(oid)
    .split(".")
    .map((arc: string): number => {
      return Number(arc);
    });
}

// As SnmpWalkResultUtil.compareOids, on OIDs already split into arcs.
function compareOidArcs(left: OidArcs, right: OidArcs): number {
  const length: number = Math.min(left.length, right.length);

  for (let index: number = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return left[index]! < right[index]! ? -1 : 1;
    }
  }

  return left.length - right.length;
}

/*
 * Every OID any compared walk read, in OID order, with who answered it.
 * Each OID is split into arcs once, not on every comparison of the sort:
 * fifty walks of a thousand OIDs are fifty thousand OIDs to order.
 */
export function compareDeviceWalks(
  walks: Array<DeviceWalk>,
): Array<SnmpWalkComparisonRow> {
  const comparable: Array<DeviceWalk> = walks.filter(isComparableWalk);
  const answersByOid: Map<string, Array<DeviceAnswer>> = new Map();

  for (const walk of comparable) {
    const seen: Set<string> = new Set();

    for (const row of walk.result!.rows) {
      const oid: string = SnmpOidListUtil.normalizeOid(row.oid);

      if (!oid || seen.has(oid)) {
        continue;
      }

      seen.add(oid);

      let answers: Array<DeviceAnswer> | undefined = answersByOid.get(oid);

      if (!answers) {
        answers = [];
        answersByOid.set(oid, answers);
      }

      answers.push({ deviceId: walk.deviceId, row: row });
    }
  }

  const completeCount: number = comparable.filter(
    (walk: DeviceWalk): boolean => {
      return walk.result!.stopReason === SnmpWalkStopReason.Complete;
    },
  ).length;

  const stopArcs: Array<OidArcs> = [];

  for (const walk of comparable) {
    const stopOid: string | undefined = getWalkStopOid(walk.result!);

    if (stopOid) {
      stopArcs.push(toArcs(stopOid));
    }
  }

  const arcsByOid: Map<string, OidArcs> = new Map();

  for (const oid of answersByOid.keys()) {
    arcsByOid.set(oid, toArcs(oid));
  }

  const oids: Array<string> = Array.from(answersByOid.keys()).sort(
    (left: string, right: string): number => {
      return compareOidArcs(arcsByOid.get(left)!, arcsByOid.get(right)!);
    },
  );

  /*
   * A walk that stopped short reached every OID up to where it stopped. The
   * OIDs and the stops are both in order, so one pass counts, for each OID,
   * the stops it is past - rather than every OID against every stop.
   */
  stopArcs.sort(compareOidArcs);
  let stopsPassed: number = 0;

  return oids.map((oid: string): SnmpWalkComparisonRow => {
    const arcs: OidArcs = arcsByOid.get(oid)!;

    while (
      stopsPassed < stopArcs.length &&
      compareOidArcs(stopArcs[stopsPassed]!, arcs) < 0
    ) {
      stopsPassed++;
    }

    return {
      oid: oid,
      answers: answersByOid.get(oid)!,
      reachedCount: completeCount + stopArcs.length - stopsPassed,
    };
  });
}

// What one compared device holds for an OID, as its line under the row.
export enum DeviceAnswerKind {
  Answered = "answered",
  // Its walk reached the OID and the device does not have it.
  Missing = "missing",
  // Its walk stopped before the OID.
  NotReached = "notReached",
}

export type DeviceAnswerForOid =
  | { kind: DeviceAnswerKind.Answered; row: SnmpWalkRow }
  | { kind: DeviceAnswerKind.Missing }
  | { kind: DeviceAnswerKind.NotReached };

export function getDeviceAnswerForOid(data: {
  walk: DeviceWalk;
  row: SnmpWalkComparisonRow;
}): DeviceAnswerForOid {
  const answer: DeviceAnswer | undefined = data.row.answers.find(
    (entry: DeviceAnswer): boolean => {
      return entry.deviceId === data.walk.deviceId;
    },
  );

  if (answer) {
    return { kind: DeviceAnswerKind.Answered, row: answer.row };
  }

  if (data.walk.result && doesWalkReachOid(data.walk.result, data.row.oid)) {
    return { kind: DeviceAnswerKind.Missing };
  }

  return { kind: DeviceAnswerKind.NotReached };
}

// How the devices' values for one OID compare.
export enum ComparisonValuesKind {
  // Every device read the same value.
  Same = "same",
  // Numbers that differ: the lowest and the highest.
  Range = "range",
  // Text, or a mix, that differs: how many different values.
  Different = "different",
}

export type ComparisonValues =
  | { kind: ComparisonValuesKind.Same; row: SnmpWalkRow }
  | { kind: ComparisonValuesKind.Range; low: SnmpWalkRow; high: SnmpWalkRow }
  | { kind: ComparisonValuesKind.Different; count: number };

function toValueKey(row: SnmpWalkRow): string {
  if (row.value === null || row.value === undefined) {
    return "null:";
  }

  return `${row.isHex ? "hex" : "value"}:${String(row.value)}`;
}

function toFiniteNumber(row: SnmpWalkRow): number | undefined {
  if (
    !isNumericSnmpWalkRow(row) ||
    row.value === null ||
    row.value === undefined
  ) {
    return undefined;
  }

  const text: string = String(row.value).trim();
  const value: number = Number(text);

  return text !== "" && Number.isFinite(value) ? value : undefined;
}

export function summarizeComparisonValues(
  answers: Array<DeviceAnswer>,
): ComparisonValues | undefined {
  const first: DeviceAnswer | undefined = answers[0];

  if (!first) {
    return undefined;
  }

  const keys: Set<string> = new Set(
    answers.map((answer: DeviceAnswer): string => {
      return toValueKey(answer.row);
    }),
  );

  if (keys.size === 1) {
    return { kind: ComparisonValuesKind.Same, row: first.row };
  }

  let low: SnmpWalkRow | undefined = undefined;
  let high: SnmpWalkRow | undefined = undefined;
  let lowValue: number = Number.POSITIVE_INFINITY;
  let highValue: number = Number.NEGATIVE_INFINITY;
  let isAllNumbers: boolean = true;

  for (const answer of answers) {
    const value: number | undefined = toFiniteNumber(answer.row);

    if (value === undefined) {
      isAllNumbers = false;
      break;
    }

    if (value < lowValue) {
      lowValue = value;
      low = answer.row;
    }

    if (value > highValue) {
      highValue = value;
      high = answer.row;
    }
  }

  if (isAllNumbers && low && high) {
    return { kind: ComparisonValuesKind.Range, low: low, high: high };
  }

  return { kind: ComparisonValuesKind.Different, count: keys.size };
}

/*
 * A number of a range as the page shows it: a Timeticks as the time it
 * adds up to ("12 days, 02:20:45"), anything else as the device read it.
 */
export function formatComparisonNumber(
  row: SnmpWalkRow,
  translator: Translator,
): string {
  if (row.type === SnmpDataType.TimeTicks) {
    const duration: string | undefined = formatSnmpTimeTicks(
      row.value,
      translator,
    );

    if (duration) {
      return duration;
    }
  }

  return row.value === null || row.value === undefined ? "" : String(row.value);
}

// The distinct values the filter also matches, at most this many per OID.
export const MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES: number = 20;

/*
 * How an OID's row reads: its name, MIB and type as the first device to
 * answer it reads them (SnmpWalkViewModel), every type the devices answered
 * with when they do not agree, and the filter's text with the other
 * devices' values in it, so filtering by a value finds the OID whichever
 * device read it.
 */
export interface SnmpWalkComparisonRowView extends SnmpWalkRowView {
  typeLabels: Array<string>;
}

export function toComparisonRowView(
  row: SnmpWalkComparisonRow,
  translator: Translator,
): SnmpWalkComparisonRowView {
  const first: SnmpWalkRow = row.answers[0]!.row;
  const view: SnmpWalkRowView = toSnmpWalkRowView(first, translator);
  const typeLabels: Array<string> = [];
  const values: Array<string> = [];

  for (const answer of row.answers) {
    // The type alone: naming each device's copy of the OID again is wasted.
    const typeLabel: string = getSnmpWalkTypeLabel(answer.row);

    if (!typeLabels.includes(typeLabel)) {
      typeLabels.push(typeLabel);
    }

    const value: string =
      answer.row.value === null || answer.row.value === undefined
        ? ""
        : String(answer.row.value);

    if (
      value &&
      !values.includes(value) &&
      values.length < MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES
    ) {
      values.push(value);
    }
  }

  return {
    ...view,
    typeLabels: typeLabels,
    searchText: [view.searchText, ...typeLabels, ...values]
      .join("\n")
      .toLowerCase(),
  };
}

/*
 * The rows whose OID, name, type or any device's value holds every word of
 * the filter - and, with `onlyMissingOnSome`, only the OIDs some device
 * walked past without answering, which is where a fleet does not agree.
 * Plain substring matching, as on a device's page.
 */
export function filterComparisonRows(data: {
  rows: Array<SnmpWalkComparisonRow>;
  views: Map<string, SnmpWalkComparisonRowView>;
  query: string;
  onlyMissingOnSome: boolean;
}): Array<SnmpWalkComparisonRow> {
  const words: Array<string> = data.query
    .toLowerCase()
    .split(" ")
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  return data.rows.filter((row: SnmpWalkComparisonRow): boolean => {
    if (data.onlyMissingOnSome && row.answers.length >= row.reachedCount) {
      return false;
    }

    if (words.length === 0) {
      return true;
    }

    const searchText: string = data.views.get(row.oid)?.searchText || "";

    return words.every((word: string): boolean => {
      return searchText.includes(word);
    });
  });
}

/*
 * The OIDs each device collects on every poll - its template's and its
 * own, as the poll merges them - plus the ones collected from this page
 * since the devices were read, so a Collect shows at once.
 */
export function getCollectedOidsByDevice(data: {
  devices: Array<MultiDeviceSnmpWalkDevice>;
  justCollected?: Map<string, Set<string>> | undefined;
}): Map<string, Set<string>> {
  const collected: Map<string, Set<string>> = new Map();

  for (const device of data.devices) {
    const oids: Set<string> = getCollectedOids({
      deviceOids: device.snmpOids,
      templateOids: device.templateOids,
    });

    for (const oid of data.justCollected?.get(device.id) || []) {
      oids.add(oid);
    }

    collected.set(device.id, oids);
  }

  return collected;
}

// An OID Collection Template that devices answering an OID are linked to.
export interface ComparisonTemplateTarget {
  templateId: string;
  templateName: string;
  // The answering devices linked to it that do not collect the OID yet.
  deviceIds: Array<string>;
}

/*
 * Who collects an OID already, and where Collect would add it:
 *
 *   - collected: devices that answered it and collect it on every poll;
 *   - collectable: devices that answered it, are polled by their probe, and
 *     do not collect it yet. A monitor-backed device is never polled, so a
 *     health OID on it would collect nothing - as on a device's own page;
 *   - templates: the OID Collection Templates those collectable devices are
 *     linked to, for "Collect on every device using ...".
 */
export interface ComparisonCollectState {
  collectedDeviceIds: Array<string>;
  collectableDeviceIds: Array<string>;
  templates: Array<ComparisonTemplateTarget>;
}

export function getComparisonCollectState(data: {
  row: SnmpWalkComparisonRow;
  devicesById: Map<string, MultiDeviceSnmpWalkDevice>;
  collectedOidsByDevice: Map<string, Set<string>>;
}): ComparisonCollectState {
  const collectedDeviceIds: Array<string> = [];
  const collectableDeviceIds: Array<string> = [];
  const templatesById: Map<string, ComparisonTemplateTarget> = new Map();

  for (const answer of data.row.answers) {
    const device: MultiDeviceSnmpWalkDevice | undefined = data.devicesById.get(
      answer.deviceId,
    );

    if (!device) {
      continue;
    }

    if (data.collectedOidsByDevice.get(device.id)?.has(data.row.oid)) {
      collectedDeviceIds.push(device.id);
      continue;
    }

    if (!device.isProbePolled) {
      continue;
    }

    collectableDeviceIds.push(device.id);

    if (device.templateId) {
      let target: ComparisonTemplateTarget | undefined = templatesById.get(
        device.templateId,
      );

      if (!target) {
        target = {
          templateId: device.templateId,
          templateName: device.templateName || "",
          deviceIds: [],
        };
        templatesById.set(device.templateId, target);
      }

      target.deviceIds.push(device.id);
    }
  }

  return {
    collectedDeviceIds: collectedDeviceIds,
    collectableDeviceIds: collectableDeviceIds,
    templates: Array.from(templatesById.values()),
  };
}

// How many walks stand where, for the line over the device list.
export interface DeviceWalkCounts {
  total: number;
  waiting: number;
  // Read what is under the OID (all of it, or part of it).
  answered: number;
  // Refused, silent, not started, not run, or not reported.
  failed: number;
}

export function countDeviceWalks(walks: Array<DeviceWalk>): DeviceWalkCounts {
  const counts: DeviceWalkCounts = {
    total: walks.length,
    waiting: 0,
    answered: 0,
    failed: 0,
  };

  for (const walk of walks) {
    if (!isDeviceWalkSettled(walk)) {
      counts.waiting++;
    } else if (isComparableWalk(walk)) {
      counts.answered++;
    } else {
      counts.failed++;
    }
  }

  return counts;
}

/*
 * The server's sentences for a device it will not walk that a device's
 * own page never meets - it walks one device, which is there and has an
 * address - as locale keys, so this page says them in the reader's
 * language. A test holds them to the server's wording
 * (Common/Server/Services/NetworkDeviceDiagnosticService.ts).
 */
export const MULTI_DEVICE_SNMP_WALK_SERVER_MESSAGES: Array<string> = [
  translationKey("This device is archived. Restore it to run diagnostics."),
  translationKey("This device has no hostname or IP address to reach."),
  translationKey(
    "This device has no probe assigned. Assign one under Device → Settings and try again.",
  ),
  translationKey("Network Device not found."),
];

/*
 * Why a device was not walked, when the page itself decided: it has no
 * probe to walk it from. A device's own page says the same.
 */
export const MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE: string = translationKey(
  "This device has no probe assigned, so there is nothing to walk it from.",
);

/*
 * Why a walk the page was waiting for will never be reported: its row is
 * gone, with the device or its probe. A device's own page says the same.
 */
export const MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE: string = translationKey(
  "This walk no longer exists. The device or its probe may have been deleted.",
);

/*
 * The message for one device in the reader's language: the walk's own
 * server sentences (SnmpWalkViewModel), this page's, or - anything else -
 * as the server or probe wrote it.
 */
export function translateMultiDeviceSnmpWalkMessage(
  message: string,
  translator: Translator,
): string {
  if (
    MULTI_DEVICE_SNMP_WALK_SERVER_MESSAGES.includes(message) ||
    message === MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE ||
    message === MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE
  ) {
    return translator.translateText(message) || message;
  }

  return translateSnmpWalkServerMessage(message, translator);
}

// Whether what stopped a device is fixed in its Settings.
function isMessageFixedInSettings(message: string | undefined): boolean {
  return (
    message === SNMP_WALK_NO_CREDENTIALS_MESSAGE ||
    message === MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE
  );
}

export enum DeviceWalkTone {
  Waiting = "waiting",
  Success = "success",
  Warning = "warning",
  Error = "error",
}

/*
 * One device's walk as its line on the page reads: a short title ("120
 * OIDs", "The device did not answer"), and - for a walk that did not read
 * everything - why, and whether the fix is in the device's Settings.
 */
export interface DeviceWalkView {
  tone: DeviceWalkTone;
  title: string;
  detail?: string | undefined;
  isFixedInSettings: boolean;
  rowCount: number;
}

export function describeDeviceWalk(data: {
  walk: DeviceWalk;
  probeName?: string | undefined;
  translator: Translator;
}): DeviceWalkView {
  const { walk, translator } = data;

  switch (walk.status) {
    case DeviceWalkStatus.Asking:
    case DeviceWalkStatus.Walking:
      return {
        tone: DeviceWalkTone.Waiting,
        title: translator.translateText("Walking…")!,
        isFixedInSettings: false,
        rowCount: 0,
      };
    case DeviceWalkStatus.NotStarted:
      return {
        tone: DeviceWalkTone.Error,
        title: translator.translateText("Not walked")!,
        detail: walk.message
          ? translateMultiDeviceSnmpWalkMessage(walk.message, translator)
          : undefined,
        isFixedInSettings: isMessageFixedInSettings(walk.message),
        rowCount: 0,
      };
    case DeviceWalkStatus.ProbeFailed:
      return {
        tone: DeviceWalkTone.Error,
        title: translator.translateText("The probe could not run this walk.")!,
        detail: walk.message
          ? translateMultiDeviceSnmpWalkMessage(walk.message, translator)
          : undefined,
        isFixedInSettings: false,
        rowCount: 0,
      };
    case DeviceWalkStatus.TimedOut:
      return {
        tone: DeviceWalkTone.Error,
        title: translator.translateText("No answer from the probe")!,
        detail: describeMultiDeviceSnmpWalkTimeout(data.probeName, translator),
        isFixedInSettings: false,
        rowCount: 0,
      };
    default:
      break;
  }

  const result: NetworkDeviceDiagnosticSnmpWalkResult | undefined = walk.result;

  if (!result) {
    return {
      tone: DeviceWalkTone.Error,
      title: translator.translateText("The probe could not run this walk.")!,
      isFixedInSettings: false,
      rowCount: 0,
    };
  }

  const rowCount: number = result.rows.length;

  if (result.stopReason === SnmpWalkStopReason.Failed) {
    const failure: SnmpWalkMessage | undefined = result.failure
      ? describeSnmpWalkFailure(
          result.failure,
          result.snmpVersion,
          rowCount,
          translator,
        )
      : undefined;

    if (rowCount > 0) {
      return {
        tone: DeviceWalkTone.Warning,
        title: translator.translatePlural(
          {
            one: "{{count}} OID before the walk stopped",
            other: "{{count}} OIDs before the walk stopped",
          },
          rowCount,
        ),
        detail: failure?.title,
        isFixedInSettings: false,
        rowCount: rowCount,
      };
    }

    return {
      tone: DeviceWalkTone.Error,
      title:
        failure?.title ||
        translator.translateText("The walk stopped with an error")!,
      detail: failure?.detail,
      isFixedInSettings: Boolean(failure?.isFixedInSettings),
      rowCount: 0,
    };
  }

  if (rowCount === 0) {
    return {
      tone: DeviceWalkTone.Warning,
      title: translator.translateText("Nothing under this OID")!,
      detail: translator.translateText(
        "The device may not implement it, or the SNMP view of its credentials may not include it.",
      ),
      isFixedInSettings: false,
      rowCount: 0,
    };
  }

  if (
    result.stopReason === SnmpWalkStopReason.OidLimit ||
    result.stopReason === SnmpWalkStopReason.TimeLimit
  ) {
    return {
      tone: DeviceWalkTone.Success,
      title: translator.translatePlural(
        {
          one: "{{count}} OID so far, more to read",
          other: "{{count}} OIDs so far, more to read",
        },
        rowCount,
      ),
      isFixedInSettings: false,
      rowCount: rowCount,
    };
  }

  return {
    tone: DeviceWalkTone.Success,
    title: translator.translatePlural(
      { one: "{{count}} OID", other: "{{count}} OIDs" },
      rowCount,
    ),
    isFixedInSettings: false,
    rowCount: rowCount,
  };
}

/*
 * What a device's line says when its probe never reported. Names the
 * probe when the page knows it, as a device's own page does.
 */
export function describeMultiDeviceSnmpWalkTimeout(
  probeName: string | undefined,
  translator: Translator,
): string {
  if (probeName) {
    return translator.translateTemplate(
      'The probe "{{probe}}" did not report the walk within five minutes. Check that the probe is online and runs a version that can walk SNMP.',
      { probe: probeName },
    );
  }

  return translator.translateText(
    "The device's probe did not report the walk within five minutes. Check that the probe is online and runs a version that can walk SNMP.",
  )!;
}

/*
 * The line over the results: how many OIDs, under what, and - when some
 * walks stopped at their limit - that there is more to read, which a
 * device's own page continues.
 */
export function describeMultiDeviceSnmpWalkSummary(data: {
  rootOid: string;
  walks: Array<DeviceWalk>;
  rows: Array<SnmpWalkComparisonRow>;
  translator: Translator;
}): string | undefined {
  const comparable: Array<DeviceWalk> = data.walks.filter(isComparableWalk);

  if (comparable.length === 0) {
    return undefined;
  }

  if (data.rows.length === 0) {
    return data.translator.translateTemplate(
      "Nothing under {{oid}} on any device that answered. They may not implement it, or the SNMP views of their credentials may not include it.",
      { oid: data.rootOid },
    );
  }

  return data.translator.translatePlural(
    {
      one: "{{count}} OID under {{oid}}.",
      other: "{{count}} OIDs under {{oid}}.",
    },
    data.rows.length,
    { oid: data.rootOid },
  );
}

/*
 * How many devices' walks stopped at their limit, with more under the OID
 * to read: their own SNMP Walk page continues each one.
 */
export function countWalksWithMoreToRead(walks: Array<DeviceWalk>): number {
  return walks.filter((walk: DeviceWalk): boolean => {
    return (
      walk.status === DeviceWalkStatus.Walked &&
      Boolean(walk.result) &&
      (walk.result!.stopReason === SnmpWalkStopReason.OidLimit ||
        walk.result!.stopReason === SnmpWalkStopReason.TimeLimit)
    );
  }).length;
}

/*
 * When the shown walk was read: the newest of its device walks, the time
 * the last one was asked for.
 */
export function getWalkedAt(walks: Array<DeviceWalk>): Date | undefined {
  let newest: Date | undefined = undefined;

  for (const walk of walks) {
    if (walk.createdAt && (!newest || walk.createdAt > newest)) {
      newest = walk.createdAt;
    }
  }

  return newest;
}

/*
 * Runs `step` for every item, at most `concurrency` at a time, and resolves
 * once every step has settled. A step reports its own failure: one that
 * throws anyway fails only its own item, never the rest.
 */
export async function runWithConcurrency<T>(data: {
  items: Array<T>;
  concurrency: number;
  step: (item: T) => Promise<void>;
}): Promise<void> {
  let next: number = 0;
  const workerCount: number = Math.min(
    Math.max(1, Math.floor(data.concurrency)),
    data.items.length,
  );

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < data.items.length) {
      const item: T = data.items[next]!;
      next++;

      try {
        await data.step(item);
      } catch {
        // The step reports its own failures.
      }
    }
  };

  const workers: Array<Promise<void>> = [];

  for (let index: number = 0; index < workerCount; index++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}
