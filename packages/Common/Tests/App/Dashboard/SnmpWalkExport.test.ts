import { describe, expect, test } from "@jest/globals";
import {
  CSV_BYTE_ORDER_MARK,
  SNMP_WALK_CSV_COLUMNS,
  SnmpWalkExportFile,
  SnmpWalkExportFormat,
  buildSnmpWalkCsv,
  buildSnmpWalkExport,
  buildSnmpwalkText,
  formatSnmpwalkTimeticks,
  getSnmpWalkExportFilename,
  quoteSnmpString,
  toNumericOid,
  toSnmpWalkCsvRow,
  toSnmpwalkLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkExport";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import { SnmpWalkRow } from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A device's SNMP walk, saved as a file (#5281, the follow-up of #5184): as
 * `snmpwalk -On` prints a walk - one OID a line, numeric, in snmpwalk's
 * words for the types - for a vendor's support, a change record or a MIB
 * browser; and as CSV for a spreadsheet. Every OID the walk read, in walk
 * order, values as the probe read them.
 */

function row(
  oid: string,
  type: SnmpDataType,
  value: string | number | null,
  extra: Partial<SnmpWalkRow> = {},
): SnmpWalkRow {
  return { oid: oid, type: type, value: value, ...extra };
}

// A Catalyst's system group and a few of every type a walk reads.
const ROWS: Array<SnmpWalkRow> = [
  row(
    "1.3.6.1.2.1.1.1.0",
    SnmpDataType.OctetString,
    'Cisco IOS Software [Cupertino], "C9300"\r\nTechnical Support: http://www.cisco.com\\techsupport',
  ),
  row("1.3.6.1.2.1.1.2.0", SnmpDataType.ObjectIdentifier, "1.3.6.1.4.1.9.1.2494"),
  row("1.3.6.1.2.1.1.3.0", SnmpDataType.TimeTicks, 104524500),
  row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "edge-sw-01"),
  row("1.3.6.1.2.1.1.7.0", SnmpDataType.Integer, 6),
  row("1.3.6.1.2.1.2.2.1.6.1", SnmpDataType.OctetString, "00 1A 2B 3C 4D 5E", {
    isHex: true,
  }),
  row("1.3.6.1.2.1.2.2.1.10.1", SnmpDataType.Counter32, 1007),
  row("1.3.6.1.2.1.2.2.1.5.1", SnmpDataType.Gauge32, 1000000000),
  row("1.3.6.1.2.1.31.1.1.1.6.1", SnmpDataType.Counter64, "18446744073709551615"),
  row("1.3.6.1.2.1.4.20.1.1.10.20.0.1", SnmpDataType.IpAddress, "10.20.0.1"),
  row("1.3.6.1.2.1.1.9.1.4.1", SnmpDataType.Null, null),
];

describe("as snmpwalk prints it", () => {
  test("one OID a line, numeric from a leading dot, in snmpwalk's words for the types", () => {
    expect(buildSnmpwalkText(ROWS).split("\n")).toEqual([
      '.1.3.6.1.2.1.1.1.0 = STRING: "Cisco IOS Software [Cupertino], \\"C9300\\"\\r\\nTechnical Support: http://www.cisco.com\\\\techsupport"',
      ".1.3.6.1.2.1.1.2.0 = OID: .1.3.6.1.4.1.9.1.2494",
      ".1.3.6.1.2.1.1.3.0 = Timeticks: (104524500) 12 days, 2:20:45.00",
      '.1.3.6.1.2.1.1.5.0 = STRING: "edge-sw-01"',
      ".1.3.6.1.2.1.1.7.0 = INTEGER: 6",
      ".1.3.6.1.2.1.2.2.1.6.1 = Hex-STRING: 00 1A 2B 3C 4D 5E",
      ".1.3.6.1.2.1.2.2.1.10.1 = Counter32: 1007",
      ".1.3.6.1.2.1.2.2.1.5.1 = Gauge32: 1000000000",
      // A Counter64 past 2^53 keeps its every digit.
      ".1.3.6.1.2.1.31.1.1.1.6.1 = Counter64: 18446744073709551615",
      ".1.3.6.1.2.1.4.20.1.1.10.20.0.1 = IpAddress: 10.20.0.1",
      ".1.3.6.1.2.1.1.9.1.4.1 = NULL",
      // The file ends with a line break.
      "",
    ]);
  });

  test("a multi-line value stays one OID's line, and copies back to what the device said", () => {
    const line: string = toSnmpwalkLine(ROWS[0]!);

    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");

    const quoted: string = line.slice(line.indexOf('"'));
    // JSON reads the same escapes: the value comes back as it was.
    expect(JSON.parse(quoted)).toBe(ROWS[0]!.value);
  });

  test("a text value is quoted and escaped, a tab included", () => {
    expect(quoteSnmpString("")).toBe('""');
    expect(quoteSnmpString('a "b" \\ c\td')).toBe('"a \\"b\\" \\\\ c\\td"');
    expect(quoteSnmpString("Raum 3.14, Köln")).toBe('"Raum 3.14, Köln"');
  });

  test("an OID is written numeric from a leading dot, however it was stored", () => {
    expect(toNumericOid("1.3.6.1")).toBe(".1.3.6.1");
    expect(toNumericOid(".1.3.6.1")).toBe(".1.3.6.1");
    expect(toNumericOid(" 1.3.6.1 ")).toBe(".1.3.6.1");
    expect(toNumericOid("")).toBe("");
    expect(
      toSnmpwalkLine(row(".1.3.6.1.2.1.1.2.0", SnmpDataType.ObjectIdentifier, ".1.3.6.1.4.1.9")),
    ).toBe(".1.3.6.1.2.1.1.2.0 = OID: .1.3.6.1.4.1.9");
  });

  test.each([
    [0, "(0) 0:00:00.00"],
    [12345, "(12345) 0:02:03.45"],
    [360000, "(360000) 1:00:00.00"],
    [8640000, "(8640000) 1 day, 0:00:00.00"],
    [104524500, "(104524500) 12 days, 2:20:45.00"],
    [4294967295, "(4294967295) 497 days, 2:27:52.95"],
  ])("timeticks %p read %p, as snmpwalk prints them", (ticks: number, text: string) => {
    expect(formatSnmpwalkTimeticks(ticks)).toBe(text);
  });

  test("timeticks that are not a count are written as read", () => {
    expect(
      toSnmpwalkLine(row("1.3.6.1.2.1.1.3.0", SnmpDataType.TimeTicks, "soon")),
    ).toBe(".1.3.6.1.2.1.1.3.0 = Timeticks: soon");
    expect(
      toSnmpwalkLine(row("1.3.6.1.2.1.1.3.0", SnmpDataType.TimeTicks, "")),
    ).toBe(".1.3.6.1.2.1.1.3.0 = Timeticks: ");
  });

  test("a walk that read nothing is an empty file", () => {
    expect(buildSnmpwalkText([])).toBe("");
  });

  test("a long walk's file is written in time that grows with it", () => {
    const rows: Array<SnmpWalkRow> = [];

    for (let index: number = 0; index < 3000; index++) {
      rows.push(
        row(
          `1.3.6.1.4.1.9.9.${index}.0`,
          SnmpDataType.OctetString,
          `${'"\\'.repeat(100)}${"x".repeat(1024)}`,
        ),
      );
    }

    const run: FastestRun<void> = fastestRun({
      run: (): void => {
        buildSnmpwalkText(rows);
        buildSnmpWalkCsv(rows);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});

describe("as CSV", () => {
  test("its columns, then a row an OID: the OID, its MIB name and module, its type and its value", () => {
    expect(SNMP_WALK_CSV_COLUMNS).toEqual(["OID", "Name", "MIB", "Type", "Value"]);

    // Every row but the multi-line sysDescr, whose own line breaks are its.
    const singleLineRows: Array<SnmpWalkRow> = ROWS.slice(1);
    const lines: Array<string> =
      buildSnmpWalkCsv(singleLineRows).split("\r\n");

    expect(lines[0]).toBe("OID,Name,MIB,Type,Value");
    expect(lines[1]).toBe(
      "1.3.6.1.2.1.1.2.0,sysObjectID.0,SNMPv2-MIB,OID,1.3.6.1.4.1.9.1.2494",
    );
    // A Timeticks as its ticks, so the column sorts and sums as numbers.
    expect(lines[2]).toBe(
      "1.3.6.1.2.1.1.3.0,sysUpTime.0,SNMPv2-MIB,Timeticks,104524500",
    );
    expect(lines[3]).toBe(
      "1.3.6.1.2.1.1.5.0,sysName.0,SNMPv2-MIB,STRING,edge-sw-01",
    );
    expect(lines[5]).toBe(
      "1.3.6.1.2.1.2.2.1.6.1,ifPhysAddress.1,IF-MIB,Hex-STRING,00 1A 2B 3C 4D 5E",
    );
    // A Counter64 keeps its every digit.
    expect(lines[8]).toBe(
      "1.3.6.1.2.1.31.1.1.1.6.1,ifHCInOctets.1,IF-MIB,Counter64,18446744073709551615",
    );
    // An SNMP NULL has no value.
    expect(lines[10]).toBe(
      "1.3.6.1.2.1.1.9.1.4.1,sysORUpTime.1,SNMPv2-MIB,NULL,",
    );
    // Lines end CRLF, the file with one too (RFC 4180).
    expect(lines).toHaveLength(singleLineRows.length + 2);
    expect(lines[lines.length - 1]).toBe("");
  });

  test("a value with a comma, a quote or a line break is quoted, and copies back whole", () => {
    const csvRow: Array<string> = toSnmpWalkCsvRow(ROWS[0]!);

    expect(csvRow[4]).toBe(ROWS[0]!.value);

    const text: string = buildSnmpWalkCsv([ROWS[0]!]);

    expect(text).toContain(
      '"Cisco IOS Software [Cupertino], ""C9300""\r\nTechnical Support: http://www.cisco.com\\techsupport"',
    );
  });

  test("a value a spreadsheet would run as a formula is written as text", () => {
    const text: string = buildSnmpWalkCsv([
      row("1.3.6.1.2.1.1.4.0", SnmpDataType.OctetString, "=HYPERLINK(\"x\")"),
      row("1.3.6.1.2.1.1.6.0", SnmpDataType.OctetString, "@SUM(A1)"),
      row("1.3.6.1.2.1.1.5.0", SnmpDataType.OctetString, "+1-555"),
      // A negative number is a number.
      row("1.3.6.1.4.1.9.9.1.0", SnmpDataType.Integer, -4),
    ]);

    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toContain("'@SUM(A1)");
    expect(text).toContain("'+1-555");
    expect(text).toContain(",INTEGER,-4");
  });

  test("an OID OneUptime knows no name for has an empty name and MIB", () => {
    expect(
      toSnmpWalkCsvRow(row("1.3.6.1.4.1.99999.1.2.3", SnmpDataType.Integer, 1)),
    ).toEqual(["1.3.6.1.4.1.99999.1.2.3", "", "", "INTEGER", "1"]);
  });
});

describe("the file the card saves", () => {
  const EXPORTED_AT: Date = new Date("2026-09-21T12:00:00.000Z");

  test("text: the walk as snmpwalk prints it, a plain-text file named after the device, the subtree and when", () => {
    const file: SnmpWalkExportFile = buildSnmpWalkExport({
      rows: ROWS,
      format: SnmpWalkExportFormat.Text,
      deviceName: "edge-sw-01",
      rootOid: "1.3.6.1",
      exportedAt: EXPORTED_AT,
    });

    expect(file.content).toBe(buildSnmpwalkText(ROWS));
    expect(file.filename).toBe("edge-sw-01-snmp-walk-1.3.6.1-2026-09-21-12-00-00.txt");
    expect(file.mimeType).toBe("text/plain;charset=utf-8;");
  });

  test("CSV: a byte order mark first, so Excel reads it in UTF-8", () => {
    const file: SnmpWalkExportFile = buildSnmpWalkExport({
      rows: ROWS,
      format: SnmpWalkExportFormat.Csv,
      deviceName: "edge-sw-01",
      rootOid: ".1.3.6.1.2.1.2",
      exportedAt: EXPORTED_AT,
    });

    expect(CSV_BYTE_ORDER_MARK).toBe("\u{FEFF}");
    expect(file.content.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
    expect(file.content.slice(1)).toBe(buildSnmpWalkCsv(ROWS));
    expect(file.filename).toBe(
      "edge-sw-01-snmp-walk-1.3.6.1.2.1.2-2026-09-21-12-00-00.csv",
    );
    expect(file.mimeType).toBe("text/csv;charset=utf-8;");
  });

  test.each([
    ["Core Switch 01 (Rack 3)", "core-switch-01-rack-3"],
    ["  edge/sw:01  ", "edge-sw-01"],
    ["Kern-Switch Köln", "kern-switch-k-ln"],
    // A name with no letters a file name keeps: the device, by what it is.
    ["コアスイッチ", "device"],
    ["", "device"],
  ])("a device named %p saves as %p", (deviceName: string, part: string) => {
    expect(
      getSnmpWalkExportFilename({
        deviceName: deviceName,
        rootOid: "1.3.6.1",
        format: SnmpWalkExportFormat.Text,
        exportedAt: EXPORTED_AT,
      }),
    ).toBe(`${part}-snmp-walk-1.3.6.1-2026-09-21-12-00-00.txt`);
  });

  test("a long device name is cut, and no name ever reaches past the file system's reach", () => {
    const filename: string = getSnmpWalkExportFilename({
      deviceName: "a".repeat(500),
      rootOid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1.2.3.4.5.6.7.8.9.10.11.12.13.14",
      format: SnmpWalkExportFormat.Csv,
      exportedAt: EXPORTED_AT,
    });

    expect(filename.length).toBeLessThan(160);
    expect(filename.startsWith(`${"a".repeat(60)}-snmp-walk-`)).toBe(true);
  });
});
