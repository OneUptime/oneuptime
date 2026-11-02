import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import { SnmpWalkRow } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpOidNameUtil, {
  SnmpOidDescription,
} from "Common/Utils/NetworkDevice/SnmpOidNameUtil";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import { getSnmpWalkTypeLabel } from "./SnmpWalkViewModel";

/*
 * A walk of a device, saved as a file (follow-up of issue #5184): to send
 * to a vendor's support, to keep beside a change, to compare with next
 * month's, or to read into a spreadsheet or a MIB browser.
 *
 *   - Text, the way `snmpwalk -On` prints a walk - one OID a line, numeric,
 *     with snmpwalk's words for the types - which every SNMP tool and
 *     every network engineer reads: ".1.3.6.1.2.1.1.5.0 = STRING: core-sw".
 *   - CSV, one row an OID: its OID, the name and MIB OneUptime knows it
 *     by, its type and its value, for a spreadsheet.
 *
 * Both hold every OID the walk read, in walk order - a walk continued page
 * by page as one list - and nothing of the filter the page shows them
 * through. A value is written as the probe read it: one longer than a walk
 * keeps (1,024 characters) is its start, as on the page.
 *
 * Pure and window-free: the card hands the text to the browser to save.
 */

export enum SnmpWalkExportFormat {
  Text = "text",
  Csv = "csv",
}

export interface SnmpWalkExportFile {
  content: string;
  filename: string;
  mimeType: string;
}

const MIME_TYPES: Record<SnmpWalkExportFormat, string> = {
  [SnmpWalkExportFormat.Text]: "text/plain;charset=utf-8;",
  [SnmpWalkExportFormat.Csv]: "text/csv;charset=utf-8;",
};

const EXTENSIONS: Record<SnmpWalkExportFormat, string> = {
  [SnmpWalkExportFormat.Text]: "txt",
  [SnmpWalkExportFormat.Csv]: "csv",
};

// The CSV's columns, in English: a file for tools as much as for people.
export const SNMP_WALK_CSV_COLUMNS: ReadonlyArray<string> = [
  "OID",
  "Name",
  "MIB",
  "Type",
  "Value",
];

const TICKS_PER_SECOND: number = 100;
const SECONDS_PER_DAY: number = 86400;

/*
 * A text value on one line, the way snmpwalk quotes it: in double quotes,
 * with a backslash before a quote or a backslash, and a line break or a tab
 * written as \n, \r or \t - so a multi-line sysDescr stays one OID's line.
 * Walked character by character: the value is the device's.
 */
export function quoteSnmpString(value: string): string {
  let quoted: string = '"';

  for (const character of value) {
    if (character === '"' || character === "\\") {
      quoted += `\\${character}`;
    } else if (character === "\n") {
      quoted += "\\n";
    } else if (character === "\r") {
      quoted += "\\r";
    } else if (character === "\t") {
      quoted += "\\t";
    } else {
      quoted += character;
    }
  }

  return `${quoted}"`;
}

/*
 * Timeticks the way snmpwalk prints them: the ticks in brackets, then the
 * time they add up to - "(104524500) 12 days, 2:20:45.00". Hundredths of a
 * second, so 12345 is 0:02:03.45.
 */
export function formatSnmpwalkTimeticks(ticks: number): string {
  const totalHundredths: number = Math.floor(ticks);
  const totalSeconds: number = Math.floor(totalHundredths / TICKS_PER_SECOND);
  const hundredths: number = totalHundredths % TICKS_PER_SECOND;
  const days: number = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const remainder: number = totalSeconds % SECONDS_PER_DAY;
  const hours: number = Math.floor(remainder / 3600);
  const minutes: number = Math.floor((remainder % 3600) / 60);
  const seconds: number = remainder % 60;

  const time: string = `${hours}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;

  const dayText: string =
    days === 0 ? "" : `${days} ${days === 1 ? "day" : "days"}, `;

  return `(${totalHundredths}) ${dayText}${time}`;
}

// An OID as snmpwalk -On writes it: numeric, from a leading dot.
export function toNumericOid(oid: string): string {
  const normalized: string = SnmpOidListUtil.normalizeOid(oid);

  return normalized ? `.${normalized}` : "";
}

/*
 * One OID's line: ".1.3.6.1.2.1.1.3.0 = Timeticks: (104524500) 12 days,
 * 2:20:45.00". The type in snmpwalk's words (getSnmpWalkTypeLabel), the
 * value in its form: text quoted, hex octets and numbers as they are, an
 * OID value numeric, an SNMP NULL as NULL.
 */
export function toSnmpwalkLine(row: SnmpWalkRow): string {
  const oid: string = toNumericOid(row.oid);

  if (
    row.value === null ||
    row.value === undefined ||
    row.type === SnmpDataType.Null
  ) {
    return `${oid} = NULL`;
  }

  const typeLabel: string = getSnmpWalkTypeLabel(row);
  const value: string = String(row.value);

  if (row.type === SnmpDataType.OctetString && !row.isHex) {
    return `${oid} = ${typeLabel}: ${quoteSnmpString(value)}`;
  }

  if (row.type === SnmpDataType.ObjectIdentifier) {
    return `${oid} = ${typeLabel}: ${toNumericOid(value) || value}`;
  }

  if (row.type === SnmpDataType.TimeTicks) {
    const ticks: number = Number(row.value);

    if (value.trim() !== "" && Number.isFinite(ticks) && ticks >= 0) {
      return `${oid} = ${typeLabel}: ${formatSnmpwalkTimeticks(ticks)}`;
    }
  }

  return `${oid} = ${typeLabel}: ${value}`;
}

// The whole walk as snmpwalk prints it, a line an OID.
export function buildSnmpwalkText(rows: ReadonlyArray<SnmpWalkRow>): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map(toSnmpwalkLine).join("\n")}\n`;
}

// One CSV field: quoted where it must be, and never read as a formula.
function toCsvField(value: string): string {
  return TableColumnsToCsv.escapeCsvValue(
    TableColumnsToCsv.sanitizeForCsvInjection(value),
  );
}

/*
 * One OID's CSV row. The value is as the probe read it - a Timeticks as
 * its ticks, hex octets as hex - so the column sorts and sums as numbers.
 */
export function toSnmpWalkCsvRow(row: SnmpWalkRow): Array<string> {
  const description: SnmpOidDescription = SnmpOidNameUtil.describe(row.oid);
  const isNull: boolean = row.value === null || row.value === undefined;
  const name: string =
    description.name && !description.isGroupName ? description.name : "";

  return [
    SnmpOidListUtil.normalizeOid(row.oid),
    name,
    name ? description.module || "" : "",
    getSnmpWalkTypeLabel(row),
    isNull ? "" : String(row.value),
  ];
}

// The whole walk as CSV: the columns, then a row an OID, lines CRLF (RFC 4180).
export function buildSnmpWalkCsv(rows: ReadonlyArray<SnmpWalkRow>): string {
  const lines: Array<string> = [
    SNMP_WALK_CSV_COLUMNS.map(toCsvField).join(","),
    ...rows.map((row: SnmpWalkRow): string => {
      return toSnmpWalkCsvRow(row).map(toCsvField).join(",");
    }),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

// A part of a file name: letters, digits, dots and dashes, never empty.
function toFilenamePart(text: string, fallback: string): string {
  let part: string = "";
  let isAfterDash: boolean = false;

  for (const character of text.toLowerCase()) {
    const isKept: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === ".";

    if (isKept) {
      part += character;
      isAfterDash = false;
    } else if (!isAfterDash && part.length > 0) {
      part += "-";
      isAfterDash = true;
    }

    if (part.length >= 60) {
      break;
    }
  }

  while (part.endsWith("-") || part.endsWith(".")) {
    part = part.slice(0, -1);
  }

  return part || fallback;
}

/*
 * The file's name: the device, the subtree and when, so two walks of one
 * device saved the same day never take each other's name -
 * "core-sw-01-snmp-walk-1.3.6.1.2.1-2026-09-21-12-00-00.txt".
 */
export function getSnmpWalkExportFilename(data: {
  deviceName: string | undefined;
  rootOid: string;
  format: SnmpWalkExportFormat;
  exportedAt: Date;
}): string {
  const device: string = toFilenamePart(data.deviceName || "", "device");
  const root: string = toFilenamePart(
    SnmpOidListUtil.normalizeOid(data.rootOid),
    "walk",
  );
  const time: string = data.exportedAt
    .toISOString()
    .slice(0, 19)
    .split("T")
    .join("-")
    .split(":")
    .join("-");

  return `${device}-snmp-walk-${root}-${time}.${EXTENSIONS[data.format]}`;
}

/*
 * A UTF-8 byte order mark before a CSV, as the tables' CSV export writes
 * one (TableColumnsToCsv.downloadCsv): without it Excel reads the file in
 * the computer's own code page, and a location such as "Raum 3.14 - Köln"
 * comes out garbled.
 */
export const CSV_BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);

// What the card hands the browser to save, in either format.
export function buildSnmpWalkExport(data: {
  rows: ReadonlyArray<SnmpWalkRow>;
  format: SnmpWalkExportFormat;
  deviceName: string | undefined;
  rootOid: string;
  exportedAt: Date;
}): SnmpWalkExportFile {
  return {
    content:
      data.format === SnmpWalkExportFormat.Csv
        ? `${CSV_BYTE_ORDER_MARK}${buildSnmpWalkCsv(data.rows)}`
        : buildSnmpwalkText(data.rows),
    filename: getSnmpWalkExportFilename({
      deviceName: data.deviceName,
      rootOid: data.rootOid,
      format: data.format,
      exportedAt: data.exportedAt,
    }),
    mimeType: MIME_TYPES[data.format],
  };
}
