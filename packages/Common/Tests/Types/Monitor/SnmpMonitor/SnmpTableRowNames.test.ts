import {
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * How the rows of a walked table are named, beyond a name column of the
 * same table:
 *
 *   - a name column from a PARENT table, whose index is the start of this
 *     table's (Aruba Instant names radios "<access point> / Radio n");
 *   - a table that leaves out its name-only rows, because its name column
 *     names more than it has (ifName names every interface; the radio table
 *     wants the radios);
 *   - a table indexed by text (ArubaOS's ESSID table is indexed by the SSID
 *     itself), named by the decoded index.
 */

const AP_NAME: string = "1.3.6.1.4.1.14823.2.3.3.1.2.1.1.2";
const RADIO_INDEX: string = "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.2";
const RADIO_CLIENTS: string = "1.3.6.1.4.1.14823.2.3.3.1.2.2.1.21";
const IF_NAME: string = "1.3.6.1.2.1.31.1.1.1.1";
const ESSID_STATIONS: string = "1.3.6.1.4.1.14823.2.2.1.5.2.1.8.1.2";

const AP_A: string = "0.11.134.1.2.3";
const AP_B: string = "0.11.134.4.5.6";

function radios(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "wifi_radios",
    name: "Wi-Fi Radios",
    kind: SnmpTableKind.WifiRadio,
    rowLabelColumnOids: [AP_NAME, RADIO_INDEX],
    columns: [
      {
        oid: RADIO_INDEX,
        name: "Radio",
        valueLabels: { "0": "Radio 0", "1": "Radio 1" },
      },
      { oid: RADIO_CLIENTS, name: "Clients" },
    ],
    ...overrides,
  };
}

function materialize(
  definition: SnmpTableDefinition,
  result: SnmpTableResult,
): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: [SnmpTableListUtil.validateTable(definition, "Test")],
    results: [result],
  })[0]!;
}

function labels(snapshot: SnmpTableSnapshot): Array<string> {
  return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
    return row.label;
  });
}

function clusterWalk(): SnmpTableResult {
  return {
    key: "wifi_radios",
    rows: [
      { index: AP_A, values: { [AP_NAME]: "lobby" } },
      { index: AP_B, values: { [AP_NAME]: "warehouse" } },
      {
        index: `${AP_A}.0`,
        values: { [RADIO_INDEX]: 0, [RADIO_CLIENTS]: 4 },
      },
      {
        index: `${AP_A}.1`,
        values: { [RADIO_INDEX]: 1, [RADIO_CLIENTS]: 2 },
      },
      {
        index: `${AP_B}.0`,
        values: { [RADIO_INDEX]: 0, [RADIO_CLIENTS]: 9 },
      },
    ],
  };
}

describe("a name column from a parent table", () => {
  it("names each row by the parent whose index starts its own", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      radios({ skipNameOnlyRows: true }),
      clusterWalk(),
    );

    expect(labels(snapshot)).toEqual([
      "lobby / Radio 0",
      "lobby / Radio 1",
      "warehouse / Radio 0",
    ]);
  });

  it("prefers the row's own value over its parent's", () => {
    const walk: SnmpTableResult = clusterWalk();
    walk.rows[3]!.values[AP_NAME] = "lobby-annex";

    expect(
      labels(materialize(radios({ skipNameOnlyRows: true }), walk)),
    ).toContain("lobby-annex / Radio 1");
  });

  it("takes the nearest parent when several levels name a row", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      radios({ skipNameOnlyRows: true }),
      {
        key: "wifi_radios",
        rows: [
          { index: "7", values: { [AP_NAME]: "site" } },
          { index: "7.3", values: { [AP_NAME]: "ap-3" } },
          {
            index: "7.3.1",
            values: { [RADIO_INDEX]: 1, [RADIO_CLIENTS]: 1 },
          },
          {
            index: "7.4.0",
            values: { [RADIO_INDEX]: 0, [RADIO_CLIENTS]: 1 },
          },
        ],
      },
    );

    expect(labels(snapshot)).toEqual(["ap-3 / Radio 1", "site / Radio 0"]);
  });

  it("does not look past the row's own arcs: 1.2 is no parent of 1.20", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      radios({ skipNameOnlyRows: true }),
      {
        key: "wifi_radios",
        rows: [
          { index: "1.2", values: { [AP_NAME]: "wrong" } },
          {
            index: "1.20",
            values: { [RADIO_INDEX]: 0, [RADIO_CLIENTS]: 1 },
          },
        ],
      },
    );

    expect(labels(snapshot)).toEqual(["Radio 0"]);
  });

  it("names a row by its own columns when no parent names it", () => {
    const snapshot: SnmpTableSnapshot = materialize(radios(), {
      key: "wifi_radios",
      rows: [
        {
          index: `${AP_A}.0`,
          values: { [RADIO_INDEX]: 0, [RADIO_CLIENTS]: 1 },
        },
      ],
    });

    expect(labels(snapshot)).toEqual(["Radio 0"]);
  });
});

describe("a table that leaves out its name-only rows", () => {
  it("lists only the rows that hold one of its values", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      radios({ skipNameOnlyRows: true }),
      clusterWalk(),
    );

    expect(
      snapshot.rows.map((row: SnmpTableSnapshotRow) => {
        return row.index;
      }),
    ).toEqual([`${AP_A}.0`, `${AP_A}.1`, `${AP_B}.0`]);
  });

  it("leaves out every interface ifName names that is not one of its radios", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      {
        key: "wifi_radios",
        name: "Wi-Fi Radios",
        kind: SnmpTableKind.WifiRadio,
        rowLabelColumnOids: [IF_NAME],
        skipNameOnlyRows: true,
        columns: [{ oid: RADIO_CLIENTS, name: "Clients" }],
      },
      {
        key: "wifi_radios",
        rows: [
          { index: "1", values: { [IF_NAME]: "esa0" } },
          { index: "99", values: { [IF_NAME]: "eth0" } },
          {
            index: "1001",
            values: { [IF_NAME]: "AP1_r1_802.11a/n", [RADIO_CLIENTS]: 3 },
          },
        ],
      },
    );

    expect(labels(snapshot)).toEqual(["AP1_r1_802.11a/n"]);
  });

  it("counts its row limit in the rows it keeps, not the names that came along", () => {
    const walk: SnmpTableResult = clusterWalk();

    const snapshot: SnmpTableSnapshot = materialize(
      radios({ skipNameOnlyRows: true, maxRows: 3 }),
      walk,
    );

    expect(snapshot.rows).toHaveLength(3);
  });

  it("keeps a name-only row in a table that does not ask for this - a tunnel the device names but reports no status for", () => {
    const snapshot: SnmpTableSnapshot = materialize(radios(), clusterWalk());

    expect(labels(snapshot)).toEqual([
      "lobby",
      "lobby / Radio 0",
      "lobby / Radio 1",
      "warehouse",
      "warehouse / Radio 0",
    ]);
  });

  it("is stored only when on", () => {
    expect(
      SnmpTableListUtil.validateTable(radios({ skipNameOnlyRows: true }), "T")
        .skipNameOnlyRows,
    ).toBe(true);
    expect(
      "skipNameOnlyRows" in
        SnmpTableListUtil.validateTable(
          radios({ skipNameOnlyRows: false }),
          "T",
        ),
    ).toBe(false);
    expect(
      "skipNameOnlyRows" in SnmpTableListUtil.validateTable(radios(), "T"),
    ).toBe(false);
  });
});

describe("a table indexed by text", () => {
  function essids(rowIndexIsText: boolean | undefined): SnmpTableDefinition {
    return {
      key: "wifi_ssids",
      name: "SSIDs",
      kind: SnmpTableKind.WifiSsid,
      ...(rowIndexIsText === undefined
        ? {}
        : { rowIndexIsText: rowIndexIsText }),
      columns: [{ oid: ESSID_STATIONS, name: "Clients" }],
    };
  }

  it("names rows by the SSID the index spells", () => {
    const snapshot: SnmpTableSnapshot = materialize(essids(true), {
      key: "wifi_ssids",
      rows: [
        { index: "4.67.111.114.112", values: { [ESSID_STATIONS]: 120 } },
        { index: "5.71.117.101.115.116", values: { [ESSID_STATIONS]: 3 } },
      ],
    });

    expect(labels(snapshot)).toEqual(["Corp", "Guest"]);
  });

  it("keeps the index for a table that does not ask for it", () => {
    expect(
      labels(
        materialize(essids(undefined), {
          key: "wifi_ssids",
          rows: [
            { index: "4.67.111.114.112", values: { [ESSID_STATIONS]: 1 } },
          ],
        }),
      ),
    ).toEqual(["4.67.111.114.112"]);
  });

  it("is stored only when on", () => {
    expect(
      SnmpTableListUtil.validateTable(essids(true), "T").rowIndexIsText,
    ).toBe(true);
    expect(
      "rowIndexIsText" in SnmpTableListUtil.validateTable(essids(false), "T"),
    ).toBe(false);
  });

  it.each([
    ["4.67.111.114.112", "Corp"],
    // UTF-8: "Café" is five bytes.
    ["5.67.97.102.195.169", "Café"],
    ["1.65", "A"],
    ["8.71.117.101.115.116.32.50.71", "Guest 2G"],
  ])("decodes %s as %s", (index: string, text: string) => {
    expect(SnmpTableListUtil.decodeTextIndex(index)).toBe(text);
  });

  it.each([
    // A length that does not match the bytes after it: not a string index.
    ["3.67.111.114.112"],
    ["5.67.111.114.112"],
    // Nothing after the length.
    ["0"],
    ["4"],
    // Control characters are no SSID.
    ["2.65.10"],
    ["2.65.127"],
    // Arcs that are no bytes.
    ["2.65.256"],
    ["2.65.x"],
    // Bytes that are not UTF-8.
    ["2.65.195"],
    ["2.255.254"],
    // Only spaces.
    ["2.32.32"],
  ])("leaves %s undecoded", (index: string) => {
    expect(SnmpTableListUtil.decodeTextIndex(index)).toBeUndefined();
  });

  it("falls back to the index when it is not text, and to a name column when there is one", () => {
    const snapshot: SnmpTableSnapshot = materialize(
      {
        ...essids(true),
        rowLabelColumnOids: [IF_NAME],
      },
      {
        key: "wifi_ssids",
        rows: [
          { index: "1.2.3", values: { [ESSID_STATIONS]: 1 } },
          {
            index: "4.67.111.114.112",
            values: { [ESSID_STATIONS]: 1, [IF_NAME]: "named" },
          },
        ],
      },
    );

    expect(labels(snapshot)).toEqual(["1.2.3", "named"]);
  });
});
