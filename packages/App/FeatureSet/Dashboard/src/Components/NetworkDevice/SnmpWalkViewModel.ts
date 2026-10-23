import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailure,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpOidNameUtil, {
  SnmpOidDescription,
} from "Common/Utils/NetworkDevice/SnmpOidNameUtil";
import SnmpWalkResultUtil from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of a device's SNMP Walk page (issue #5184): where a walk can
 * start, how a walked OID reads (its name from the MIBs OneUptime knows, its
 * type, its value), what a failure means and what fixes it, which OIDs the
 * device already collects, and how a walk continued page by page is put
 * back together after a reload.
 *
 * React-free and window-free on purpose - App's tests import it - so the
 * components next door (SnmpWalkCard, SnmpWalkResults) only render.
 */

// How often the page re-reads a running walk, and how long it waits.
export const SNMP_WALK_POLL_INTERVAL_IN_MS: number = 3000;
export const SNMP_WALK_WAIT_IN_MS: number = 120000;
export const SNMP_WALK_MAX_POLL_ATTEMPTS: number = Math.ceil(
  SNMP_WALK_WAIT_IN_MS / SNMP_WALK_POLL_INTERVAL_IN_MS,
);
// Rejected reads in a row before the page stops waiting with an error.
export const SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES: number = 3;

// Rows drawn at a time; "Show more" draws the next lot.
export const SNMP_WALK_ROWS_PER_PAGE: number = 100;

/*
 * How many earlier walks of the device are read to put a continued walk
 * back together on the page: five pages, five thousand OIDs at most.
 */
export const SNMP_WALK_HISTORY_LIMIT: number = 5;

/*
 * The longest value carried into a new monitor's criteria. A longer one -
 * a description, a blob - makes a poor threshold, and an address bar.
 */
export const SNMP_WALK_MAX_MONITOR_VALUE_LENGTH: number = 200;

export interface SnmpWalkStartPoint {
  label: string;
  oid: string;
}

/*
 * The subtrees people walk most: the whole tree, the identity of the
 * device, its ports, the host-resources MIB that holds CPU, memory and
 * storage on most Linux-based gear, and the vendor's own branch, where its
 * health values usually are.
 */
export const SNMP_WALK_START_POINTS: Array<SnmpWalkStartPoint> = [
  { label: translationKey("Everything"), oid: SNMP_WALK_DEFAULT_ROOT_OID },
  { label: translationKey("System"), oid: "1.3.6.1.2.1.1" },
  { label: translationKey("Interfaces"), oid: "1.3.6.1.2.1.2" },
  { label: translationKey("Host resources"), oid: "1.3.6.1.2.1.25" },
  { label: translationKey("Vendor-specific"), oid: "1.3.6.1.4.1" },
];

/*
 * What a walked OID shows: its name, where the name came from, its type
 * the way snmpwalk prints it, and its value as text.
 */
export interface SnmpWalkRowView {
  oid: string;
  // "ifDescr.3"; absent when OneUptime knows nothing of the OID.
  name?: string | undefined;
  // The MIB module of the name: "IF-MIB".
  module?: string | undefined;
  // The name is only the nearest known group's ("enterprises.9.9...").
  isGroupName: boolean;
  // A vendor template's own name for this value: "CPU 5-min %".
  templateValueName?: string | undefined;
  // A vendor template's table that walks this OID's column.
  templateTableName?: string | undefined;
  templateColumnName?: string | undefined;
  templateLabel?: string | undefined;
  // Who the enterprise number belongs to, for an OID under enterprises.
  vendorName?: string | undefined;
  type: SnmpDataType;
  // As snmpwalk prints it: STRING, Hex-STRING, INTEGER, Counter64...
  typeLabel: string;
  // The value as the page shows it; empty for an SNMP NULL.
  valueText: string;
  // Hex octets or an OID: drawn in a fixed-width font.
  isMonospace: boolean;
  isCut: boolean;
  isNull: boolean;
  // Timeticks only: the duration the hundredths of a second add up to.
  durationText?: string | undefined;
  // What the filter box matches against, lower-cased.
  searchText: string;
}

/*
 * snmpwalk's words for the types, which everyone who has walked a device
 * has read. Protocol names, kept as they are in every language.
 */
const TYPE_LABELS: Record<string, string> = {
  [SnmpDataType.Integer]: "INTEGER",
  [SnmpDataType.OctetString]: "STRING",
  [SnmpDataType.ObjectIdentifier]: "OID",
  [SnmpDataType.IpAddress]: "IpAddress",
  [SnmpDataType.Counter]: "Counter32",
  [SnmpDataType.Counter32]: "Counter32",
  [SnmpDataType.Gauge]: "Gauge32",
  [SnmpDataType.Gauge32]: "Gauge32",
  [SnmpDataType.TimeTicks]: "Timeticks",
  [SnmpDataType.Opaque]: "Opaque",
  [SnmpDataType.Counter64]: "Counter64",
  [SnmpDataType.Null]: "NULL",
  [SnmpDataType.Boolean]: "BOOLEAN",
};

export function getSnmpWalkTypeLabel(row: SnmpWalkRow): string {
  if (row.type === SnmpDataType.OctetString && row.isHex) {
    return "Hex-STRING";
  }

  return TYPE_LABELS[row.type] || row.type;
}

const TICKS_PER_SECOND: number = 100;
const SECONDS_PER_DAY: number = 86400;

/*
 * Timeticks are hundredths of a second: 104524500 is 12 days, 02:20:45.
 * Undefined for a value that is not a count of ticks.
 */
export function formatSnmpTimeTicks(
  ticks: number | string | null,
  translator: Translator,
): string | undefined {
  const value: number = Number(ticks);

  if (ticks === null || ticks === "" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const totalSeconds: number = Math.floor(value / TICKS_PER_SECOND);
  const days: number = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const remainder: number = totalSeconds % SECONDS_PER_DAY;
  const hours: number = Math.floor(remainder / 3600);
  const minutes: number = Math.floor((remainder % 3600) / 60);
  const seconds: number = remainder % 60;

  const time: string = [hours, minutes, seconds]
    .map((part: number): string => {
      return String(part).padStart(2, "0");
    })
    .join(":");

  if (days === 0) {
    return time;
  }

  return translator.translatePlural(
    { one: "{{count}} day, {{time}}", other: "{{count}} days, {{time}}" },
    days,
    { time: time },
  );
}

export function toSnmpWalkRowView(
  row: SnmpWalkRow,
  translator: Translator,
): SnmpWalkRowView {
  const description: SnmpOidDescription = SnmpOidNameUtil.describe(row.oid);
  const isNull: boolean = row.value === null || row.value === undefined;
  const valueText: string = isNull ? "" : String(row.value);

  const durationText: string | undefined =
    row.type === SnmpDataType.TimeTicks && !isNull
      ? formatSnmpTimeTicks(row.value, translator)
      : undefined;

  const view: SnmpWalkRowView = {
    oid: row.oid,
    name: description.name,
    module: description.module,
    isGroupName: Boolean(description.isGroupName),
    templateValueName: description.templateValueName,
    templateTableName: description.templateTableName,
    templateColumnName: description.templateColumnName,
    templateLabel: description.templateLabel,
    vendorName: description.vendorName,
    type: row.type,
    typeLabel: getSnmpWalkTypeLabel(row),
    valueText: valueText,
    isMonospace:
      Boolean(row.isHex) || row.type === SnmpDataType.ObjectIdentifier,
    isCut: Boolean(row.isCut),
    isNull: isNull,
    durationText: durationText,
    searchText: "",
  };

  view.searchText = [
    row.oid,
    description.name,
    description.templateValueName,
    description.templateTableName,
    description.templateColumnName,
    description.vendorName,
    view.typeLabel,
    valueText,
  ]
    .filter((part: string | undefined): part is string => {
      return Boolean(part);
    })
    .join("\n")
    .toLowerCase();

  return view;
}

/*
 * A value longer than this is shown cut, with "Show all" beside it: a
 * certificate or a configuration blob would otherwise fill the screen.
 */
export const SNMP_WALK_VALUE_PREVIEW_LENGTH: number = 160;

export interface SnmpWalkRowLabels {
  /*
   * The row's title: a vendor template's name for the value ("CPU 5-min
   * %"), else its MIB name ("ifDescr.3"), else the OID itself - a group's
   * name ("enterprises.9.9...") only restates the OID.
   */
  title: string;
  isTitleTheOid: boolean;
  // The MIB module, beside a MIB-name title.
  titleModule?: string | undefined;
  // The MIB name under a template-name title: "memAvailReal.0 · UCD-SNMP-MIB".
  mibName?: string | undefined;
  // Where the name or the OID comes from: a vendor template, or a vendor.
  source?: string | undefined;
}

export function getSnmpWalkRowLabels(
  view: SnmpWalkRowView,
  translator: Translator,
): SnmpWalkRowLabels {
  const mibName: string | undefined =
    view.name && !view.isGroupName ? view.name : undefined;

  let source: string | undefined = undefined;

  if (view.templateValueName && view.templateLabel) {
    source = translator.translateTemplate("In the {{template}} template", {
      template: view.templateLabel,
    });
  } else if (view.templateTableName && view.templateLabel) {
    source = translator.translateTemplate(
      "The {{column}} column of the {{table}} table, in the {{template}} template",
      {
        column: view.templateColumnName || "",
        table: view.templateTableName,
        template: view.templateLabel,
      },
    );
  } else if (SnmpOidListUtil.getAlreadyCollectedBy(view.oid)) {
    /*
     * A per-port interface counter the interface walk already records for
     * every port: collecting one port's copy is rarely what is wanted.
     */
    source = translator.translateText(
      "The interface walk already charts this for every port.",
    );
  } else if (view.vendorName) {
    source = translator.translateTemplate("{{vendor}} MIB", {
      vendor: view.vendorName,
    });
  }

  if (view.templateValueName) {
    return {
      title: view.templateValueName,
      isTitleTheOid: false,
      mibName: mibName && view.module ? `${mibName} · ${view.module}` : mibName,
      source: source,
    };
  }

  if (mibName) {
    return {
      title: mibName,
      isTitleTheOid: false,
      titleModule: view.module,
      source: source,
    };
  }

  return { title: view.oid, isTitleTheOid: true, source: source };
}

/*
 * The rows whose OID, name, type or value holds every word of the filter,
 * in walk order. Plain substring matching: the words are the reader's, and
 * no pattern is built from them.
 */
export function filterSnmpWalkRows(
  rows: Array<SnmpWalkRowView>,
  query: string,
): Array<SnmpWalkRowView> {
  const words: Array<string> = query
    .toLowerCase()
    .split(" ")
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return rows;
  }

  return rows.filter((row: SnmpWalkRowView): boolean => {
    return words.every((word: string): boolean => {
      return row.searchText.includes(word);
    });
  });
}

export interface SnmpWalkMessage {
  title: string;
  detail: string;
  // Whether fixing it is done in the device's Settings: link there.
  isFixedInSettings: boolean;
}

/*
 * What a failed walk means and what to do, in the reader's language. The
 * agent's or probe's own words follow as the detail where they help (a
 * probe-side cause, an agent error); the credential cases say what to fix
 * instead of repeating "Wrong Digest".
 *
 * `rowsRead` is how much the walk read before it stopped. A device that
 * answered and then went quiet was not refused - its credentials worked -
 * so that is said instead of pointing at the community string.
 */
export function describeSnmpWalkFailure(
  failure: SnmpWalkFailure,
  snmpVersion: string | undefined,
  rowsRead: number,
  translator: Translator,
): SnmpWalkMessage {
  if (failure.kind === SnmpWalkFailureKind.Timeout && rowsRead > 0) {
    /*
     * How much it read is the summary's to say, right above; this says why
     * the walk stopped and what to do about it.
     */
    return {
      title: translator.translateText("The device stopped answering")!,
      detail: translator.translateText(
        "A busy device sometimes goes quiet part of the way. Continue walking to read the rest.",
      )!,
      isFixedInSettings: false,
    };
  }

  switch (failure.kind) {
    case SnmpWalkFailureKind.Authentication:
      return {
        title: translator.translateText("The device refused the credentials")!,
        detail: describeAuthenticationReason(
          failure.authenticationReason,
          translator,
        ),
        isFixedInSettings: true,
      };
    case SnmpWalkFailureKind.Timeout:
      return {
        title: translator.translateText("The device did not answer")!,
        detail:
          snmpVersion === SnmpVersion.V3
            ? translator.translateText(
                "Check that SNMP is enabled on the device and that UDP port 161 is open from the probe to it.",
              )!
            : translator.translateText(
                "A wrong community string looks exactly like this: an agent ignores a request whose community it does not know. Check the community, that SNMP is enabled on the device, and that UDP port 161 is open from the probe to it.",
              )!,
        isFixedInSettings: true,
      };
    case SnmpWalkFailureKind.Unreachable:
      return {
        title: translator.translateText(
          "The probe could not reach the device",
        )!,
        detail: failure.message,
        isFixedInSettings: false,
      };
    case SnmpWalkFailureKind.AgentError:
      return {
        title: translator.translateText("The device answered with an error")!,
        detail: failure.message,
        isFixedInSettings: false,
      };
    case SnmpWalkFailureKind.Configuration:
      return {
        title: translator.translateText(
          "The device's SNMP credentials are incomplete",
        )!,
        detail: failure.message,
        isFixedInSettings: true,
      };
    default:
      return {
        title: translator.translateText("The walk stopped with an error")!,
        detail: failure.message,
        isFixedInSettings: false,
      };
  }
}

function describeAuthenticationReason(
  reason: SnmpWalkAuthenticationReason | undefined,
  translator: Translator,
): string {
  switch (reason) {
    case SnmpWalkAuthenticationReason.UnknownUser:
      return translator.translateText(
        "The device does not know this SNMPv3 user name.",
      )!;
    case SnmpWalkAuthenticationReason.WrongDigest:
      return translator.translateText(
        "The authentication password or protocol does not match the device's.",
      )!;
    case SnmpWalkAuthenticationReason.UnsupportedSecurityLevel:
      return translator.translateText(
        "The device does not accept this security level for this user.",
      )!;
    case SnmpWalkAuthenticationReason.Decryption:
      return translator.translateText(
        "The privacy password or protocol does not match the device's.",
      )!;
    case SnmpWalkAuthenticationReason.NotInTimeWindow:
    case SnmpWalkAuthenticationReason.UnknownEngineId:
      return translator.translateText(
        "The device did not accept the request's SNMP engine time. Walk again; if it happens again, check the device's SNMP engine settings.",
      )!;
    case SnmpWalkAuthenticationReason.AccessDenied:
      return translator.translateText(
        "The device's access control does not let these credentials read this part of the tree.",
      )!;
    default:
      return translator.translateText(
        "Check the SNMP user, passwords and protocols in the device's Settings.",
      )!;
  }
}

/*
 * What the page says when the probe never reported. Names the probe when it
 * can, because "your probe" sends the reader to the probe list and "Rack 3"
 * to the right one.
 */
export function snmpWalkTimeoutMessage(
  probeName: string | undefined,
  translator: Translator,
): string {
  if (probeName) {
    return translator.translateTemplate(
      'The probe "{{probe}}" did not report the walk within two minutes. Check that the probe is online and runs a version that can walk SNMP.',
      { probe: probeName },
    );
  }

  return translator.translateText(
    "This device's probe did not report the walk within two minutes. Check that the probe is online and runs a version that can walk SNMP.",
  )!;
}

/*
 * The sentences the server answers with when it cannot run a walk - on the
 * page when the walk is asked for, or on the walk's row when an old probe
 * claims it (Common/Types/NetworkDevice/NetworkDeviceSnmpWalk.ts) - as
 * locale keys, so the page says them in the reader's language like the
 * rest of it. A test holds them to the server's wording.
 */
export const SNMP_WALK_SERVER_MESSAGES: Array<string> = [
  translationKey(
    "This device has no SNMP credentials to walk it with. Add a community string or an SNMPv3 user in its Settings, or give it (or its site) an SNMP credential profile.",
  ),
  translationKey(
    "This device's SNMP credential profile could not be read just now. Try the walk again in a moment.",
  ),
  translationKey(
    "This device is already being walked. Wait for that walk to finish, then walk it again.",
  ),
  translationKey(
    "This device's probe runs a version that cannot walk SNMP. Update the probe to the latest version, then walk again.",
  ),
];

/*
 * A message from the server in the reader's language when it is one of the
 * walk's own sentences; anything else as the server wrote it.
 */
export function translateSnmpWalkServerMessage(
  message: string,
  translator: Translator,
): string {
  if (!SNMP_WALK_SERVER_MESSAGES.includes(message)) {
    return message;
  }

  return translator.translateText(message) || message;
}

/*
 * What collecting an OID from the page came to, said in that OID's row -
 * where the reader pressed Collect, however far down the list.
 */
export interface SnmpWalkRowNotice {
  oid: string;
  kind: "success" | "error";
  text: string;
}

/*
 * One walk as the page keeps it: the row it was read from, and what it read.
 */
export interface SnmpWalkPage {
  diagnosticId: string;
  createdAt?: Date | undefined;
  result: NetworkDeviceDiagnosticSnmpWalkResult;
}

/*
 * A walk row as the page reads it from the API.
 */
export interface SnmpWalkHistoryEntry {
  diagnosticId: string;
  status: string | undefined;
  createdAt?: Date | undefined;
  rootOid?: string | undefined;
  afterOid?: string | undefined;
  result?: NetworkDeviceDiagnosticSnmpWalkResult | undefined;
}

/*
 * The walk the page shows after a reload: the newest finished walk of the
 * device and the walks it continued, oldest first, so a walk read in three
 * pages comes back as one. A page is joined to the one before it only when
 * it continued exactly where that one stopped, under the same root.
 * `entries` are the device's latest walks, newest first.
 */
export function chainSnmpWalkPages(
  entries: Array<SnmpWalkHistoryEntry>,
): Array<SnmpWalkPage> {
  const finished: Array<SnmpWalkHistoryEntry> = entries.filter(
    (entry: SnmpWalkHistoryEntry): boolean => {
      return (
        entry.status === NetworkDeviceDiagnosticStatus.Completed &&
        Boolean(entry.result)
      );
    },
  );

  const newest: SnmpWalkHistoryEntry | undefined = finished[0];

  if (!newest || !newest.result) {
    return [];
  }

  const chain: Array<SnmpWalkPage> = [
    {
      diagnosticId: newest.diagnosticId,
      createdAt: newest.createdAt,
      result: newest.result,
    },
  ];

  let current: NetworkDeviceDiagnosticSnmpWalkResult = newest.result;

  for (const entry of finished.slice(1)) {
    if (!current.afterOid) {
      break;
    }

    const previous: NetworkDeviceDiagnosticSnmpWalkResult | undefined =
      entry.result;

    if (
      !previous ||
      previous.rootOid !== current.rootOid ||
      previous.nextOid !== current.afterOid
    ) {
      continue;
    }

    chain.unshift({
      diagnosticId: entry.diagnosticId,
      createdAt: entry.createdAt,
      result: previous,
    });
    current = previous;
  }

  return chain;
}

// Every OID of a walk read in pages, in walk order, each once.
export function getSnmpWalkRows(
  pages: Array<SnmpWalkPage>,
): Array<SnmpWalkRow> {
  const seen: Set<string> = new Set();
  const rows: Array<SnmpWalkRow> = [];

  for (const page of pages) {
    for (const row of page.result.rows) {
      if (seen.has(row.oid)) {
        continue;
      }

      seen.add(row.oid);
      rows.push(row);
    }
  }

  return rows;
}

/*
 * Where the next walk continues, when the last one left something unread:
 * it stopped at the OID or time limit, or failed after reading something.
 */
export function getSnmpWalkContinueAfter(
  pages: Array<SnmpWalkPage>,
): string | undefined {
  const last: SnmpWalkPage | undefined = pages[pages.length - 1];

  if (!last || last.result.stopReason === SnmpWalkStopReason.Complete) {
    return undefined;
  }

  return last.result.nextOid || undefined;
}

/*
 * The OIDs the device collects on every poll: its OID Collection
 * Template's and its own, as the poll merges them. A walked OID in here is
 * already collected.
 */
export function getCollectedOids(data: {
  deviceOids: Array<SnmpOid> | undefined;
  templateOids: Array<SnmpOid> | undefined;
}): Set<string> {
  return new Set(
    SnmpOidListUtil.mergeOidLists(data.templateOids, data.deviceOids).map(
      (entry: SnmpOid): string => {
        return entry.oid;
      },
    ),
  );
}

/*
 * A health OID list with a walked OID added, named as the walk names it.
 * An OID already on the list is left as it is: the list's own name and
 * description for it win.
 */
export function addWalkedOid(
  list: Array<SnmpOid> | undefined,
  oid: string,
): Array<SnmpOid> {
  const existing: Array<SnmpOid> = list || [];
  const normalized: string = SnmpOidListUtil.normalizeOid(oid);

  if (
    existing.some((entry: SnmpOid): boolean => {
      return SnmpOidListUtil.normalizeOid(entry.oid) === normalized;
    })
  ) {
    return existing;
  }

  return [...existing, SnmpOidNameUtil.toHealthOid(normalized)];
}

/*
 * The condition a monitor started from a walked OID begins with, by the
 * OID's type. A threshold is the person's to set; the condition is chosen
 * so the value the walk read is a sensible starting point:
 *
 *   - a gauge or a counter (CPU, memory, temperature, traffic): above it;
 *   - timeticks (uptime): below it - the uptime only goes down when the
 *     device restarts;
 *   - text, a state, an address: not equal to it - alert when it changes.
 */
export function getSnmpWalkAlertCondition(type: SnmpDataType): FilterType {
  switch (type) {
    case SnmpDataType.Gauge:
    case SnmpDataType.Gauge32:
    case SnmpDataType.Counter:
    case SnmpDataType.Counter32:
    case SnmpDataType.Counter64:
      return FilterType.GreaterThan;
    case SnmpDataType.TimeTicks:
      return FilterType.LessThan;
    default:
      return FilterType.NotEqualTo;
  }
}

/*
 * The query string of the monitor-create page for "Alert on it": the
 * device, the OID, its type and the value the walk read (when short enough
 * to be a threshold). Built with URLSearchParams, so every value is encoded.
 */
export function buildSnmpWalkAlertQuery(data: {
  networkDeviceId: string;
  row: SnmpWalkRow;
}): string {
  const params: URLSearchParams = new URLSearchParams();
  params.set("networkDeviceId", data.networkDeviceId);
  params.set("snmpOid", SnmpOidListUtil.normalizeOid(data.row.oid));
  params.set("snmpOidType", data.row.type);

  const value: string =
    data.row.value === null || data.row.value === undefined
      ? ""
      : String(data.row.value);

  if (
    value &&
    !data.row.isHex &&
    !data.row.isCut &&
    value.length <= SNMP_WALK_MAX_MONITOR_VALUE_LENGTH
  ) {
    params.set("snmpOidValue", value);
  }

  return params.toString();
}

/*
 * What the monitor-create page reads back from "Alert on it"'s query
 * string: the OID, the name the walk gives it, the condition for its type,
 * and the value the walk read as the starting threshold - or null when the
 * query names no usable OID. The page is reachable by any link, so nothing
 * here is taken on trust: the OID must be numeric, an unknown type reads as
 * text, and a value too long to be a threshold is left out.
 */
export interface SnmpWalkAlertPrefill {
  oid: string;
  oidName: string;
  filterType: FilterType;
  value: string | number | undefined;
}

export function parseSnmpWalkAlertQuery(data: {
  snmpOid: string | null;
  snmpOidType: string | null;
  snmpOidValue: string | null;
}): SnmpWalkAlertPrefill | null {
  const oid: string = SnmpOidListUtil.normalizeOid(data.snmpOid || "");

  if (!oid || !SnmpOidListUtil.isValidOid(oid)) {
    return null;
  }

  const type: SnmpDataType =
    Object.values(SnmpDataType).find((entry: string): boolean => {
      return entry === data.snmpOidType;
    }) || SnmpDataType.Unknown;

  const filterType: FilterType = getSnmpWalkAlertCondition(type);
  const rawValue: string = data.snmpOidValue || "";

  let value: string | number | undefined =
    rawValue && rawValue.length <= SNMP_WALK_MAX_MONITOR_VALUE_LENGTH
      ? rawValue
      : undefined;

  if (
    value !== undefined &&
    filterType !== FilterType.NotEqualTo &&
    Number.isFinite(Number(value))
  ) {
    value = Number(value);
  }

  return {
    oid: oid,
    oidName: SnmpOidNameUtil.suggestedHealthOidName(oid) || oid,
    filterType: filterType,
    value: value,
  };
}

/*
 * The one-line summary over the results: how many OIDs, under what, and
 * whether there is more to read.
 */
export function describeSnmpWalkSummary(data: {
  pages: Array<SnmpWalkPage>;
  translator: Translator;
}): string | undefined {
  const rows: Array<SnmpWalkRow> = getSnmpWalkRows(data.pages);
  const last: SnmpWalkPage | undefined = data.pages[data.pages.length - 1];
  const rootOid: string = last?.result.rootOid || SNMP_WALK_DEFAULT_ROOT_OID;

  /*
   * A walk that failed says why on its own; "nothing under it" would blame
   * the device's tree for what was a refusal or a silence.
   */
  if (last?.result.stopReason === SnmpWalkStopReason.Failed) {
    if (rows.length === 0) {
      return undefined;
    }

    return data.translator.translatePlural(
      {
        one: "{{count}} OID read under {{oid}} before the walk stopped.",
        other: "{{count}} OIDs read under {{oid}} before the walk stopped.",
      },
      rows.length,
      { oid: rootOid },
    );
  }

  if (rows.length === 0) {
    return data.translator.translateTemplate(
      "Nothing under {{oid}}. The device may not implement it, or the SNMP view of its credentials may not include it.",
      { oid: rootOid },
    );
  }

  const stopReason: SnmpWalkStopReason | undefined = last?.result.stopReason;

  if (
    stopReason === SnmpWalkStopReason.OidLimit ||
    stopReason === SnmpWalkStopReason.TimeLimit
  ) {
    return data.translator.translatePlural(
      {
        one: "{{count}} OID read under {{oid}} so far. There is more to read.",
        other:
          "{{count}} OIDs read under {{oid}} so far. There is more to read.",
      },
      rows.length,
      { oid: rootOid },
    );
  }

  return data.translator.translatePlural(
    {
      one: "{{count}} OID under {{oid}}.",
      other: "{{count}} OIDs under {{oid}}.",
    },
    rows.length,
    { oid: rootOid },
  );
}

/*
 * Whether an OID's value is a number a poll records as a metric - a gauge,
 * a counter, an integer, timeticks - rather than text, an OID or an
 * address, which can be alerted on but not charted.
 */
export function isNumericSnmpWalkRow(row: SnmpWalkRow): boolean {
  switch (row.type) {
    case SnmpDataType.Integer:
    case SnmpDataType.Counter:
    case SnmpDataType.Counter32:
    case SnmpDataType.Counter64:
    case SnmpDataType.Gauge:
    case SnmpDataType.Gauge32:
    case SnmpDataType.TimeTicks:
      return true;
    default:
      return false;
  }
}

/*
 * Whether a start the person typed can be walked: a numeric OID, as the
 * server will check. Empty means everything.
 */
export function isWalkableStart(value: string): boolean {
  const normalized: string = SnmpOidListUtil.normalizeOid(value);
  return normalized === "" || SnmpOidListUtil.isValidOid(normalized);
}

// The OID a typed start walks: empty walks everything.
export function toWalkRoot(value: string): string {
  const normalized: string = SnmpOidListUtil.normalizeOid(value);
  return normalized || SNMP_WALK_DEFAULT_ROOT_OID;
}

/*
 * The start point the typed OID is, for drawing its chip as chosen.
 */
export function getSelectedStartPoint(
  value: string,
): SnmpWalkStartPoint | undefined {
  const root: string = toWalkRoot(value);

  return SNMP_WALK_START_POINTS.find((point: SnmpWalkStartPoint): boolean => {
    return SnmpWalkResultUtil.compareOids(point.oid, root) === 0;
  });
}
