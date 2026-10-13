import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableResultRow,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
  SnmpTableValueType,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  MAX_COLUMNS_PER_TABLE,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  EXTREME_WLAN_SERVICE_TYPE_OID,
  UNIFI_VAP_ENTRY_OID,
  UNIFI_VAP_ESSID_OID,
  UNIFI_VAP_NAME_OID,
  UNIFI_VAP_USAGE_OID,
} from "../../../../Types/Monitor/SnmpMonitor/WifiInternalNetwork";
import { describe, expect, it } from "@jest/globals";

/*
 * An SSID table holds the networks people join (#4730). The walk that
 * stores a table leaves the rest out - a row that names no network, a
 * network the access point runs for itself - so the SNMP Tables tab, the
 * Wi-Fi tab, a row count, a metric and a criteria all see the same rows.
 * Every other kind of table keeps every row it walks.
 */

const UNIFI_VAP_RADIO: string = `${UNIFI_VAP_ENTRY_OID}.9`;
const UNIFI_VAP_STATIONS: string = `${UNIFI_VAP_ENTRY_OID}.8`;

function unifiVapTable(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "wifi_ssids",
    name: "SSIDs",
    kind: SnmpTableKind.WifiSsid,
    rowLabelColumnOids: [UNIFI_VAP_ESSID_OID, UNIFI_VAP_RADIO],
    columns: [
      {
        oid: UNIFI_VAP_ESSID_OID,
        name: "SSID",
        role: SnmpTableColumnRole.Ssid,
        valueType: SnmpTableValueType.Text,
      },
      {
        oid: UNIFI_VAP_RADIO,
        name: "Band",
        role: SnmpTableColumnRole.Band,
        valueType: SnmpTableValueType.Text,
      },
      {
        oid: UNIFI_VAP_STATIONS,
        name: "Clients",
        role: SnmpTableColumnRole.Clients,
      },
      {
        oid: UNIFI_VAP_USAGE_OID,
        name: "Usage",
        valueType: SnmpTableValueType.Text,
      },
    ],
    ...overrides,
  };
}

function vap(
  index: string,
  essid: string,
  usage: string = "user",
  stations: number = 0,
): SnmpTableResultRow {
  return {
    index: index,
    values: {
      [UNIFI_VAP_ESSID_OID]: essid,
      [UNIFI_VAP_RADIO]: "na",
      [UNIFI_VAP_STATIONS]: stations,
      [UNIFI_VAP_USAGE_OID]: usage,
    },
  };
}

// Five VAPs as UniFi reports them: two networks, two of UniFi's own, a slot with no name.
function unifiWalk(): SnmpTableResult {
  return {
    key: "wifi_ssids",
    rows: [
      vap("1", "element-9d2c4f0a7be13685"),
      vap("2", "Shop", "user", 3),
      vap("3", "vwire-17b0e3d95ca4f286", "downlink", 1),
      vap("4", "Shop-Guest", "guest", 2),
      vap("5", ""),
    ],
  };
}

function materializeOne(
  table: SnmpTableDefinition,
  result: SnmpTableResult,
): SnmpTableSnapshot {
  const snapshots: Array<SnmpTableSnapshot> = SnmpTableListUtil.materialize({
    tables: [table],
    results: [result],
  });

  expect(snapshots).toHaveLength(1);
  return snapshots[0]!;
}

function labelsOf(snapshot: SnmpTableSnapshot): Array<string> {
  return snapshot.rows.map((row: SnmpTableSnapshotRow): string => {
    return row.label;
  });
}

describe("an SSID table, as a walk stores it", () => {
  it("keeps the networks people join, and nothing else", () => {
    expect(labelsOf(materializeOne(unifiVapTable(), unifiWalk()))).toEqual([
      "Shop / na",
      "Shop-Guest / na",
    ]);
  });

  it("keeps a hidden SSID: it has a name, and is the customer's", () => {
    expect(
      labelsOf(
        materializeOne(unifiVapTable(), {
          key: "wifi_ssids",
          rows: [vap("7", "Back-Office-Hidden")],
        }),
      ),
    ).toEqual(["Back-Office-Hidden / na"]);
  });

  it("reads the kind as stored, a string from JSON included", () => {
    const stored: SnmpTableDefinition = JSON.parse(
      JSON.stringify(unifiVapTable()),
    ) as SnmpTableDefinition;

    expect(stored.kind).toBe("WifiSsid");
    expect(labelsOf(materializeOne(stored, unifiWalk()))).toEqual([
      "Shop / na",
      "Shop-Guest / na",
    ]);
  });

  it("applies the row limit to the networks it keeps", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      unifiVapTable({ maxRows: 1 }),
      unifiWalk(),
    );

    expect(labelsOf(snapshot)).toEqual(["Shop / na"]);
  });

  it("keeps the walk's truncation as the probe reported it", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(unifiVapTable(), {
      ...unifiWalk(),
      isTruncated: true,
    });

    expect(snapshot.isTruncated).toBe(true);
    expect(snapshot.rows).toHaveLength(2);
  });

  it("stores a table of UniFi's own networks alone as an empty one, not as no table", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(unifiVapTable(), {
      key: "wifi_ssids",
      rows: [
        vap("1", "element-9d2c4f0a7be13685"),
        vap("3", "vwire-17b0e3d95ca4f286", "downlink"),
      ],
    });

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.failureCause).toBeUndefined();
    // An access point that broadcasts no SSID, not a walk that read nothing.
    expect(snapshot.leftOutRowCount).toBe(2);
    expect(snapshot).not.toHaveProperty("blankRowCount");
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(snapshot)).toBe(true);
  });

  it("counts the rows it leaves out: the views tell an access point that broadcasts no SSID from a walk that read nothing", () => {
    /*
     * Two of UniFi's own networks and the slot whose SSID column holds
     * nothing are left out - and that slot is blank: it tells nothing.
     */
    const walked: SnmpTableSnapshot = materializeOne(
      unifiVapTable(),
      unifiWalk(),
    );

    expect(walked.leftOutRowCount).toBe(3);
    expect(walked.blankRowCount).toBe(1);

    // An interface whose SSID column names none ("N/A") is no blank row.
    const interfaces: SnmpTableSnapshot = materializeOne(unifiVapTable(), {
      key: "wifi_ssids",
      rows: [vap("1", "N/A"), vap("2", "-")],
    });

    expect(interfaces.leftOutRowCount).toBe(2);
    expect(interfaces).not.toHaveProperty("blankRowCount");

    // A walk that read no row, or only networks, counts none.
    expect(
      materializeOne(unifiVapTable(), { key: "wifi_ssids", rows: [] }),
    ).not.toHaveProperty("leftOutRowCount");
    expect(
      materializeOne(unifiVapTable(), {
        key: "wifi_ssids",
        rows: [vap("2", "Shop", "user", 3)],
      }),
    ).not.toHaveProperty("leftOutRowCount");

    // Nor does a table of another kind, which keeps every row it walks.
    expect(
      materializeOne(
        unifiVapTable({ kind: SnmpTableKind.Generic }),
        unifiWalk(),
      ),
    ).not.toHaveProperty("leftOutRowCount");
  });

  it("counts no row whose SSID column read nothing: a mistyped column OID is no access point that broadcasts no SSID", () => {
    // The SSID column walks a column the device does not have.
    const mistyped: SnmpTableDefinition = unifiVapTable({
      columns: unifiVapTable().columns.map(
        (column: SnmpTableColumn): SnmpTableColumn => {
          return column.role === SnmpTableColumnRole.Ssid
            ? { ...column, oid: `${UNIFI_VAP_ENTRY_OID}.66` }
            : column;
        },
      ),
    });

    const snapshot: SnmpTableSnapshot = materializeOne(mistyped, unifiWalk());

    /*
     * No row names a network, so none is stored. UniFi's own two are still
     * told apart by their usage and name, but Shop, Shop-Guest and the empty
     * slot hold nothing in the SSID column: the table shows nothing about
     * what the access point broadcasts.
     */
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.leftOutRowCount).toBe(5);
    expect(snapshot.blankRowCount).toBe(3);
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(snapshot)).toBe(false);
  });

  it("leaves a failed walk's table as it was: no rows, and why", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(unifiVapTable(), {
      key: "wifi_ssids",
      rows: [],
      failureCause: "Request timed out",
    });

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.failureCause).toBe("Request timed out");
  });

  it("judges a table with no SSID column by what its rows report", () => {
    // Named by its rows, as ArubaOS names its ESSIDs: no name to judge.
    const table: SnmpTableDefinition = unifiVapTable({
      rowLabelColumnOids: undefined,
      columns: unifiVapTable().columns.filter(
        (column: SnmpTableColumn): boolean => {
          return column.role !== SnmpTableColumnRole.Ssid;
        },
      ),
    });

    const snapshot: SnmpTableSnapshot = materializeOne(table, {
      key: "wifi_ssids",
      rows: [vap("2", "Shop"), vap("3", "Anything", "downlink"), vap("5", "")],
    });

    expect(
      snapshot.rows.map((row: SnmpTableSnapshotRow): string => {
        return row.index;
      }),
    ).toEqual(["2", "5"]);
  });

  it("reads the SSID as shown, a value label included", () => {
    const table: SnmpTableDefinition = unifiVapTable();
    table.columns[0] = {
      ...table.columns[0]!,
      valueLabels: { "lab-1": "N/A" },
    };

    expect(
      labelsOf(
        materializeOne(table, {
          key: "wifi_ssids",
          rows: [vap("1", "lab-1"), vap("2", "Shop")],
        }),
      ),
    ).toEqual(["Shop / na"]);
  });
});

describe("every other kind of table", () => {
  it.each([
    SnmpTableKind.Generic,
    SnmpTableKind.WifiRadio,
    SnmpTableKind.WifiAccessPoint,
    SnmpTableKind.VpnTunnel,
    SnmpTableKind.RoutingAdjacency,
    SnmpTableKind.Hardware,
    undefined,
  ])("keeps every row it walks: %p", (kind: SnmpTableKind | undefined) => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      unifiVapTable({ kind: kind }),
      unifiWalk(),
    );

    expect(snapshot.rows).toHaveLength(5);
  });

  it("lets a table of your own walk every VAP UniFi runs, its own networks included", () => {
    // The way to watch the mesh link: a Generic table on unifiVapTable.
    const own: SnmpTableDefinition = unifiVapTable({
      key: "unifi_vaps",
      name: "UniFi VAPs",
      kind: SnmpTableKind.Generic,
    });

    expect(
      labelsOf(materializeOne(own, { ...unifiWalk(), key: "unifi_vaps" })),
    ).toEqual([
      "element-9d2c4f0a7be13685 / na",
      "Shop / na",
      "vwire-17b0e3d95ca4f286 / na",
      "Shop-Guest / na",
      "na",
    ]);
  });
});

describe("SnmpTableListUtil.isListedRow", () => {
  it("is true for a row of a table that is no SSID table, whatever it holds", () => {
    expect(
      SnmpTableListUtil.isListedRow(
        unifiVapTable({ kind: SnmpTableKind.Generic }),
        vap("3", "vwire-17b0e3d95ca4f286", "downlink"),
      ),
    ).toBe(true);
  });

  it("is false for UniFi's mesh link and adoption network, true for a network", () => {
    const table: SnmpTableDefinition = unifiVapTable();

    expect(
      SnmpTableListUtil.isListedRow(
        table,
        vap("3", "vwire-17b0e3d95ca4f286", "downlink"),
      ),
    ).toBe(false);
    expect(
      SnmpTableListUtil.isListedRow(
        table,
        vap("1", "element-9d2c4f0a7be13685"),
      ),
    ).toBe(false);
    expect(SnmpTableListUtil.isListedRow(table, vap("2", "Shop"))).toBe(true);
  });

  it("is false for a row whose SSID names no network", () => {
    const table: SnmpTableDefinition = unifiVapTable();

    for (const essid of ["", "  ", "N/A", "-"]) {
      expect(SnmpTableListUtil.isListedRow(table, vap("9", essid))).toBe(false);
    }
  });

  it("is false for a row the walk reported no SSID for", () => {
    expect(
      SnmpTableListUtil.isListedRow(unifiVapTable(), {
        index: "9",
        values: { [UNIFI_VAP_STATIONS]: 4 },
      }),
    ).toBe(false);
  });

  it("is true for a row with no values in a table with no SSID column", () => {
    expect(
      SnmpTableListUtil.isListedRow(
        unifiVapTable({
          columns: [{ oid: UNIFI_VAP_STATIONS, name: "Clients" }],
        }),
        { index: "9", values: {} },
      ),
    ).toBe(true);
  });
});

/*
 * What walks stored before #4730: every VAP under the SSID kind - the rows
 * a table of no SSID kind keeps, as every walk kept them then.
 */
function storedBeforeTheFix(
  table: SnmpTableDefinition = unifiVapTable(),
): SnmpTableSnapshot {
  return {
    ...materializeOne({ ...table, kind: SnmpTableKind.Generic }, unifiWalk()),
    kind: SnmpTableKind.WifiSsid,
  };
}

describe("SnmpTableListUtil.withListedRows - stored snapshots, read as a walk stores them now", () => {
  it("leaves the networks a walk no longer keeps out of a snapshot stored before it", () => {
    const stored: SnmpTableSnapshot = storedBeforeTheFix();
    expect(stored.rows).toHaveLength(5);

    const read: Array<SnmpTableSnapshot> = SnmpTableListUtil.withListedRows([
      stored,
    ]);

    expect(labelsOf(read[0]!)).toEqual(["Shop / na", "Shop-Guest / na"]);
    // The rows a walk would store now are what a walk stores now.
    expect(read[0]!.rows).toEqual(
      materializeOne(unifiVapTable(), unifiWalk()).rows,
    );
  });

  it("keeps everything else about the stored table: its failure, its time, its columns", () => {
    const stored: SnmpTableSnapshot = {
      ...storedBeforeTheFix(),
      failureCause: "Request timed out",
      collectedAt: "2026-10-12T08:00:00.000Z",
      isTruncated: true,
    };

    const read: SnmpTableSnapshot = SnmpTableListUtil.withListedRows([
      stored,
    ])[0]!;

    // It counts the rows it leaves out, as a walk does ...
    expect(read.leftOutRowCount).toBe(3);
    expect(read.leftOutRowCount).toBe(stored.rows.length - read.rows.length);
    // ... the empty slot among them as blank ...
    expect(read.blankRowCount).toBe(1);

    // ... and keeps everything else as it was.
    expect({
      ...read,
      rows: [],
      leftOutRowCount: undefined,
      blankRowCount: undefined,
    }).toEqual({
      ...stored,
      rows: [],
    });
  });

  it("returns a snapshot nothing is left out of as it is, and never changes the one it is given", () => {
    const listed: SnmpTableSnapshot = materializeOne(
      unifiVapTable(),
      unifiWalk(),
    );
    const stored: SnmpTableSnapshot = storedBeforeTheFix();
    const copy: string = JSON.stringify(stored);

    const read: Array<SnmpTableSnapshot> = SnmpTableListUtil.withListedRows([
      listed,
      stored,
    ]);

    expect(read[0]).toBe(listed);
    expect(read[1]).not.toBe(stored);
    expect(JSON.stringify(stored)).toBe(copy);
  });

  it.each([
    SnmpTableKind.Generic,
    SnmpTableKind.WifiRadio,
    SnmpTableKind.WifiAccessPoint,
    SnmpTableKind.Hardware,
  ])("keeps every stored row of a %s table", (kind: SnmpTableKind) => {
    const stored: SnmpTableSnapshot = {
      ...storedBeforeTheFix(),
      kind: kind,
    };

    expect(SnmpTableListUtil.withListedRows([stored])[0]).toBe(stored);
  });

  it("reads a table with no SSID column by its rows' values alone", () => {
    const table: SnmpTableDefinition = unifiVapTable({
      rowLabelColumnOids: undefined,
      columns: unifiVapTable().columns.filter(
        (column: SnmpTableColumn): boolean => {
          return column.role !== SnmpTableColumnRole.Ssid;
        },
      ),
    });

    expect(
      SnmpTableListUtil.listedRows(storedBeforeTheFix(table)).map(
        (row: SnmpTableSnapshotRow): string => {
          return row.index;
        },
      ),
    ).toEqual(["1", "2", "4", "5"]);
  });

  it("reads a stored row with no cells as naming no network", () => {
    const stored: SnmpTableSnapshot = storedBeforeTheFix();
    stored.rows = [
      {
        index: "9",
        label: "9",
        cells: undefined as unknown as SnmpTableSnapshotRow["cells"],
      },
    ];

    expect(SnmpTableListUtil.listedRows(stored)).toEqual([]);
  });

  it("reads nothing from nothing", () => {
    expect(SnmpTableListUtil.withListedRows(undefined)).toEqual([]);
    expect(SnmpTableListUtil.withListedRows([])).toEqual([]);
    expect(
      SnmpTableListUtil.listedRows({
        ...storedBeforeTheFix(),
        rows: undefined as unknown as Array<SnmpTableSnapshotRow>,
      }),
    ).toEqual([]);
  });

  it("adds what it leaves out to what the walk already left out", () => {
    // A snapshot that left two rows out at its walk and stored one it would not keep now.
    const stored: SnmpTableSnapshot = {
      ...materializeOne(unifiVapTable(), {
        key: "wifi_ssids",
        rows: [vap("1", "element-9d2c4f0a7be13685"), vap("2", "Shop")],
      }),
    };
    expect(stored.leftOutRowCount).toBe(1);

    const storedRow: SnmpTableSnapshotRow = storedBeforeTheFix().rows.find(
      (row: SnmpTableSnapshotRow): boolean => {
        return row.label.startsWith("vwire-");
      },
    )!;

    const read: SnmpTableSnapshot = SnmpTableListUtil.withListedRows([
      { ...stored, rows: [...stored.rows, storedRow] },
    ])[0]!;

    expect(labelsOf(read)).toEqual(["Shop / na"]);
    expect(read.leftOutRowCount).toBe(2);
  });
});

/*
 * A poll that reads no SSID table - its walk failed, or its probe walks no
 * tables - keeps the stored rows. It keeps the ones a walk keeps now, so a
 * device whose walks keep failing still has a clean stored column: every
 * reader of it (the REST API, MCP, an export) sees SSIDs alone, not only the
 * views that read it through withListedRows.
 */
describe("SnmpTableListUtil.mergeWithPrevious - a poll that reads no SSID table", () => {
  function failedWalk(): Array<SnmpTableSnapshot> {
    return [
      materializeOne(unifiVapTable(), {
        key: "wifi_ssids",
        rows: [],
        failureCause: "Request timed out",
      }),
    ];
  }

  it("keeps the stored SSIDs a walk keeps now, marked with the failure, and counts the rest", () => {
    const stored: SnmpTableSnapshot = storedBeforeTheFix();
    expect(stored.rows).toHaveLength(5);

    const merged: SnmpTableSnapshot = SnmpTableListUtil.mergeWithPrevious({
      current: failedWalk(),
      previous: [stored],
      definedKeys: ["wifi_ssids"],
    })[0]!;

    expect(labelsOf(merged)).toEqual(["Shop / na", "Shop-Guest / na"]);
    expect(merged.leftOutRowCount).toBe(3);
    expect(merged.failureCause).toBe("Request timed out");
    // The stored snapshot it read is left as it was.
    expect(stored.rows).toHaveLength(5);
  });

  it("keeps a snapshot stored since the fix as it was, counting nothing twice", () => {
    const walked: SnmpTableSnapshot = materializeOne(
      unifiVapTable(),
      unifiWalk(),
    );

    const merged: SnmpTableSnapshot = SnmpTableListUtil.mergeWithPrevious({
      current: failedWalk(),
      previous: [walked],
      definedKeys: ["wifi_ssids"],
    })[0]!;

    expect(merged).toEqual({ ...walked, failureCause: "Request timed out" });
    expect(merged.leftOutRowCount).toBe(3);
  });

  it("does the same for a probe that walks no tables", () => {
    const merged: SnmpTableSnapshot = SnmpTableListUtil.mergeWithPrevious({
      current: SnmpTableListUtil.notWalked({
        tables: [unifiVapTable()],
        failureCause: "The probe did not walk this table.",
      }),
      previous: [storedBeforeTheFix()],
      definedKeys: ["wifi_ssids"],
    })[0]!;

    expect(labelsOf(merged)).toEqual(["Shop / na", "Shop-Guest / na"]);
    expect(merged.leftOutRowCount).toBe(3);
    expect(merged.failureCause).toBe("The probe did not walk this table.");
  });

  it("keeps every stored row of any other kind of table", () => {
    const stored: SnmpTableSnapshot = {
      ...storedBeforeTheFix(),
      kind: SnmpTableKind.Generic,
    };

    const merged: SnmpTableSnapshot = SnmpTableListUtil.mergeWithPrevious({
      current: [
        {
          ...failedWalk()[0]!,
          kind: SnmpTableKind.Generic,
        },
      ],
      previous: [stored],
      definedKeys: ["wifi_ssids"],
    })[0]!;

    expect(merged.rows).toHaveLength(5);
    expect(merged).not.toHaveProperty("leftOutRowCount");
    expect(merged.failureCause).toBe("Request timed out");
  });
});

/*
 * The one rule every view reads "this access point broadcasts no SSID" by:
 * the SNMP Tables card, the Wi-Fi tab's SSIDs card and its Clients tile.
 */
describe("SnmpTableListUtil.showsOnlyOwnNetworks", () => {
  const OWN_NETWORKS: Array<SnmpTableResultRow> = [
    vap("1", "element-9d2c4f0a7be13685"),
    vap("3", "vwire-17b0e3d95ca4f286", "downlink", 1),
  ];

  function walked(rows: Array<SnmpTableResultRow>): SnmpTableSnapshot {
    return materializeOne(unifiVapTable(), { key: "wifi_ssids", rows: rows });
  }

  it("is true when every row the walk read is a network the access point runs for itself", () => {
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(walked(OWN_NETWORKS))).toBe(
      true,
    );
  });

  it("is true for a snapshot stored before #4730 that holds only those", () => {
    const stored: SnmpTableSnapshot = {
      ...materializeOne(
        { ...unifiVapTable(), kind: SnmpTableKind.Generic },
        { key: "wifi_ssids", rows: OWN_NETWORKS },
      ),
      kind: SnmpTableKind.WifiSsid,
    };

    expect(stored.rows).toHaveLength(2);
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(stored)).toBe(true);
  });

  it("is true for an access point whose interfaces name none", () => {
    expect(
      SnmpTableListUtil.showsOnlyOwnNetworks(
        walked([vap("1", "N/A"), vap("2", "N/A")]),
      ),
    ).toBe(true);
  });

  it("is false when the walk read no row: the device may not implement the table, or the SNMP view may hide it", () => {
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(walked([]))).toBe(false);
  });

  it("is false when the table lists a network", () => {
    expect(
      SnmpTableListUtil.showsOnlyOwnNetworks(
        walked([...OWN_NETWORKS, vap("2", "Shop")]),
      ),
    ).toBe(false);
  });

  it("is false when a row's SSID column held nothing: that row may be a network", () => {
    expect(
      SnmpTableListUtil.showsOnlyOwnNetworks(
        walked([...OWN_NETWORKS, vap("5", "")]),
      ),
    ).toBe(false);
  });

  it("is false for a walk cut short: the networks may come after the rows it kept", () => {
    expect(
      SnmpTableListUtil.showsOnlyOwnNetworks(
        materializeOne(unifiVapTable(), {
          key: "wifi_ssids",
          rows: OWN_NETWORKS,
          isTruncated: true,
        }),
      ),
    ).toBe(false);
  });

  it("is false for a table of any other kind", () => {
    expect(
      SnmpTableListUtil.showsOnlyOwnNetworks({
        ...walked(OWN_NETWORKS),
        kind: SnmpTableKind.Generic,
      }),
    ).toBe(false);
  });

  it("stays true through a failed walk that keeps those rows: the views say they are old", () => {
    const merged: SnmpTableSnapshot = SnmpTableListUtil.mergeWithPrevious({
      current: [
        materializeOne(unifiVapTable(), {
          key: "wifi_ssids",
          rows: [],
          failureCause: "Request timed out",
        }),
      ],
      previous: [walked(OWN_NETWORKS)],
      definedKeys: ["wifi_ssids"],
    })[0]!;

    expect(merged.failureCause).toBe("Request timed out");
    expect(SnmpTableListUtil.showsOnlyOwnNetworks(merged)).toBe(true);
  });
});

describe("the templates walk what the rules read", () => {
  function ssidTable(templateId: string): SnmpTableDefinition {
    const table: SnmpTableDefinition | undefined =
      SnmpVendorTemplateUtil.getById(templateId)?.tables?.find(
        (candidate: SnmpTableDefinition): boolean => {
          return candidate.kind === SnmpTableKind.WifiSsid;
        },
      );

    expect(table).toBeDefined();
    return table!;
  }

  function column(table: SnmpTableDefinition, oid: string): SnmpTableColumn {
    const found: SnmpTableColumn | undefined = table.columns.find(
      (candidate: SnmpTableColumn): boolean => {
        return candidate.oid === oid;
      },
    );

    expect(found).toBeDefined();
    return found!;
  }

  it("UniFi's SSIDs table names each SSID's interface, as text", () => {
    const table: SnmpTableDefinition = ssidTable("ubiquiti-unifi-ap");

    expect(column(table, UNIFI_VAP_NAME_OID)).toMatchObject({
      name: "Interface",
      valueType: SnmpTableValueType.Text,
    });
    expect(column(table, UNIFI_VAP_USAGE_OID).valueType).toBe(
      SnmpTableValueType.Text,
    );
    expect(column(table, UNIFI_VAP_ESSID_OID).role).toBe(
      SnmpTableColumnRole.Ssid,
    );
  });

  it("the Extreme controller's WLANs table names each service type", () => {
    expect(
      column(
        ssidTable("extreme-wireless-controller"),
        EXTREME_WLAN_SERVICE_TYPE_OID,
      ),
    ).toMatchObject({
      name: "Service Type",
      // A kind of service: shown by its label, never charted.
      valueType: SnmpTableValueType.Text,
      valueLabels: {
        "0": "standard",
        "3": "WDS",
        "4": "third-party",
        "5": "remote",
        "6": "mesh",
      },
    });

    // The agent hands the enumeration over as a number; it reads as its label, no number.
    expect(
      SnmpTableListUtil.buildCell(
        column(
          ssidTable("extreme-wireless-controller"),
          EXTREME_WLAN_SERVICE_TYPE_OID,
        ),
        5,
      ),
    ).toEqual({ raw: 5, display: "remote" });
  });

  it.each(["ubiquiti-unifi-ap", "extreme-wireless-controller"])(
    "%s: its SSID table still saves, within the column limit",
    (templateId: string) => {
      const table: SnmpTableDefinition = ssidTable(templateId);

      expect(
        SnmpTableListUtil.getWalkedColumnOids(table).length,
      ).toBeLessThanOrEqual(MAX_COLUMNS_PER_TABLE);
      expect(() => {
        return SnmpTableListUtil.validateTable(table, "Vendor template");
      }).not.toThrow();
    },
  );
});
