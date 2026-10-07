import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
  SnmpTableValueType,
  SnmpTableWalkRequest,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  DEFAULT_SNMP_TABLE_MAX_ROWS,
  MAX_COLUMNS_PER_TABLE,
  MAX_DEVICE_SPECIFIC_TABLES,
  MAX_EFFECTIVE_TABLES_PER_DEVICE,
  MAX_SNAPSHOT_CELLS_PER_DEVICE,
  MAX_SNMP_TABLE_MAX_ROWS,
  MAX_TABLES_PER_TEMPLATE,
  ROW_INDEX_SCOPE_PREFIX,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, it } from "@jest/globals";

// Sophos SFOS sfosIPSecVpnTunnelTable entry columns.
const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;
const IPSEC_ACTIVATED: string = `${IPSEC_ENTRY}.10`;

// Cambium Enterprise Wi-Fi cambiumRadioTable entry columns.
const RADIO_ENTRY: string = "1.3.6.1.4.1.17713.22.1.2.1";
const RADIO_BAND: string = `${RADIO_ENTRY}.3`;
const RADIO_CLIENTS: string = `${RADIO_ENTRY}.5`;
const RADIO_CHANNEL: string = `${RADIO_ENTRY}.6`;
const RADIO_WIDTH: string = `${RADIO_ENTRY}.7`;
const RADIO_POWER: string = `${RADIO_ENTRY}.8`;

function ipsecTable(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "ipsec_tunnels",
    name: "IPsec Tunnels",
    kind: SnmpTableKind.VpnTunnel,
    rowLabelColumnOids: [IPSEC_NAME],
    columns: [
      {
        oid: IPSEC_STATUS,
        name: "Status",
        role: SnmpTableColumnRole.Status,
        valueLabels: {
          "0": "inactive",
          "1": "active",
          "2": "partially active",
        },
        healthyValues: ["1"],
      },
      {
        oid: IPSEC_ACTIVATED,
        name: "Activated",
        valueLabels: { "0": "no", "1": "yes" },
      },
    ],
    ...overrides,
  };
}

function radioTable(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "wifi_radios",
    name: "Wi-Fi Radios",
    kind: SnmpTableKind.WifiRadio,
    rowLabelColumnOids: [RADIO_BAND],
    columns: [
      { oid: RADIO_BAND, name: "Band", role: SnmpTableColumnRole.Band },
      {
        oid: RADIO_CHANNEL,
        name: "Channel",
        role: SnmpTableColumnRole.Channel,
      },
      {
        oid: RADIO_WIDTH,
        name: "Channel Width",
        unit: "MHz",
        role: SnmpTableColumnRole.ChannelWidth,
      },
      {
        oid: RADIO_POWER,
        name: "TX Power",
        unit: "dBm",
        role: SnmpTableColumnRole.TxPower,
      },
      {
        oid: RADIO_CLIENTS,
        name: "Clients",
        role: SnmpTableColumnRole.Clients,
      },
    ],
    ...overrides,
  };
}

function ipsecResult(): SnmpTableResult {
  return {
    key: "ipsec_tunnels",
    rows: [
      {
        index: "10",
        values: {
          [IPSEC_NAME]: "Branch-10",
          [IPSEC_STATUS]: 1,
          [IPSEC_ACTIVATED]: 1,
        },
      },
      {
        index: "2",
        values: {
          [IPSEC_NAME]: "HQ-Branch2",
          [IPSEC_STATUS]: 0,
          [IPSEC_ACTIVATED]: 1,
        },
      },
      {
        index: "1",
        values: {
          [IPSEC_NAME]: "HQ-Branch1",
          [IPSEC_STATUS]: 2,
          [IPSEC_ACTIVATED]: 1,
        },
      },
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
    collectedAt: new Date("2026-10-07T10:00:00.000Z"),
  });

  expect(snapshots).toHaveLength(1);
  return snapshots[0]!;
}

function rowLabels(snapshot: SnmpTableSnapshot): Array<string> {
  return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
    return row.label;
  });
}

describe("SnmpTableListUtil.normalizeKey", () => {
  it("lowercases and replaces everything but letters and digits", () => {
    expect(SnmpTableListUtil.normalizeKey("IPsec Tunnels")).toBe(
      "ipsec_tunnels",
    );
    expect(SnmpTableListUtil.normalizeKey("Wi-Fi Radios (5 GHz)")).toBe(
      "wi_fi_radios_5_ghz",
    );
  });

  it("trims leading and trailing separators", () => {
    expect(SnmpTableListUtil.normalizeKey("  --Fans--  ")).toBe("fans");
  });

  it("caps the key length", () => {
    expect(SnmpTableListUtil.normalizeKey("a".repeat(200))).toHaveLength(64);
  });

  it("returns an empty key for blank or symbol-only input", () => {
    expect(SnmpTableListUtil.normalizeKey(undefined)).toBe("");
    expect(SnmpTableListUtil.normalizeKey("  ")).toBe("");
    expect(SnmpTableListUtil.normalizeKey("---")).toBe("");
  });
});

describe("SnmpTableListUtil.validateTableList", () => {
  const options: { max: number; label: string } = {
    max: MAX_TABLES_PER_TEMPLATE,
    label: "OID Collection Template",
  };

  it("accepts a well-formed table and fills in the defaults", () => {
    const [table] = SnmpTableListUtil.validateTableList(
      [ipsecTable({ key: "", kind: undefined })],
      options,
    );

    expect(table!.key).toBe("ipsec_tunnels");
    expect(table!.kind).toBe(SnmpTableKind.Generic);
    expect(table!.columns).toHaveLength(2);
    expect(table!.rowLabelColumnOids).toEqual([IPSEC_NAME]);
  });

  it("drops a blank table row silently", () => {
    expect(
      SnmpTableListUtil.validateTableList(
        [{ key: "", name: "  ", columns: [{ oid: "", name: "" }] }],
        options,
      ),
    ).toEqual([]);
  });

  it("returns an empty list for undefined", () => {
    expect(SnmpTableListUtil.validateTableList(undefined, options)).toEqual([]);
  });

  it("normalizes OIDs, drops blank and duplicate columns", () => {
    const [table] = SnmpTableListUtil.validateTableList(
      [
        ipsecTable({
          rowLabelColumnOids: [`.${IPSEC_NAME}`, IPSEC_NAME, ""],
          columns: [
            { oid: `.${IPSEC_STATUS}`, name: " Status " },
            { oid: IPSEC_STATUS, name: "Status again" },
            { oid: "", name: "blank" },
          ],
        }),
      ],
      options,
    );

    expect(table!.rowLabelColumnOids).toEqual([IPSEC_NAME]);
    expect(table!.columns).toEqual([{ oid: IPSEC_STATUS, name: "Status" }]);
  });

  it("names an unnamed column by its OID", () => {
    const [table] = SnmpTableListUtil.validateTableList(
      [ipsecTable({ columns: [{ oid: IPSEC_STATUS, name: "" }] })],
      options,
    );

    expect(table!.columns[0]!.name).toBe(IPSEC_STATUS);
  });

  it("refuses a table without a name", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList([ipsecTable({ name: "" })], options);
    }).toThrow(BadDataException);
  });

  it("refuses a table with no columns", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ columns: [{ oid: "", name: "x" }] })],
        options,
      );
    }).toThrow(/needs at least one column/);
  });

  it("refuses a non-numeric column OID and names it", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList(
        [
          ipsecTable({
            columns: [{ oid: "sfosIPSecVpnConnStatus", name: "Status" }],
          }),
        ],
        options,
      );
    }).toThrow(/sfosIPSecVpnConnStatus/);
  });

  it("refuses a non-numeric row name column", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ rowLabelColumnOids: ["ifName"] })],
        options,
      );
    }).toThrow(/row name column/);
  });

  it("refuses more row name columns than allowed", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList(
        [
          ipsecTable({
            rowLabelColumnOids: [
              "1.3.6.1.1",
              "1.3.6.1.2",
              "1.3.6.1.3",
              "1.3.6.1.4",
            ],
          }),
        ],
        options,
      );
    }).toThrow(/at most 3/);
  });

  it("refuses a table that walks more columns than allowed", () => {
    const columns: Array<{ oid: string; name: string }> = [];

    for (let i: number = 1; i <= MAX_COLUMNS_PER_TABLE + 1; i++) {
      columns.push({ oid: `1.3.6.1.4.1.9.1.${i}`, name: `c${i}` });
    }

    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ rowLabelColumnOids: [], columns: columns })],
        options,
      );
    }).toThrow(/columns, more than the limit/);
  });

  it("counts a row name column that is also a value column once", () => {
    const columns: Array<{ oid: string; name: string }> = [];

    for (let i: number = 1; i <= MAX_COLUMNS_PER_TABLE; i++) {
      columns.push({ oid: `1.3.6.1.4.1.9.1.${i}`, name: `c${i}` });
    }

    expect(() => {
      SnmpTableListUtil.validateTableList(
        [
          ipsecTable({
            rowLabelColumnOids: ["1.3.6.1.4.1.9.1.1"],
            columns: columns,
          }),
        ],
        options,
      );
    }).not.toThrow();
  });

  it("refuses two tables with the same key", () => {
    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable(), ipsecTable({ name: "Other", key: "IPsec Tunnels" })],
        options,
      );
    }).toThrow(/two tables use the key "ipsec_tunnels"/);
  });

  it("refuses more tables than the cap", () => {
    const tables: Array<SnmpTableDefinition> = [];

    for (let i: number = 0; i <= MAX_TABLES_PER_TEMPLATE; i++) {
      tables.push(ipsecTable({ key: `t${i}`, name: `Table ${i}` }));
    }

    expect(() => {
      SnmpTableListUtil.validateTableList(tables, options);
    }).toThrow(/more than the limit of 10/);
  });

  it("validates the row limit", () => {
    expect(
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ maxRows: 25 })],
        options,
      )[0]!.maxRows,
    ).toBe(25);

    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ maxRows: MAX_SNMP_TABLE_MAX_ROWS + 1 })],
        options,
      );
    }).toThrow(/whole number from 1 to 250/);

    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ maxRows: 0 })],
        options,
      );
    }).toThrow(BadDataException);

    expect(() => {
      SnmpTableListUtil.validateTableList(
        [ipsecTable({ maxRows: 2.5 })],
        options,
      );
    }).toThrow(BadDataException);
  });

  it("keeps known roles and value types and drops unknown ones", () => {
    const [table] = SnmpTableListUtil.validateTableList(
      [
        ipsecTable({
          columns: [
            {
              oid: IPSEC_STATUS,
              name: "Status",
              role: "Nonsense" as SnmpTableColumnRole,
              valueType: "Nonsense" as SnmpTableValueType,
            },
            {
              oid: IPSEC_ACTIVATED,
              name: "Activated",
              role: SnmpTableColumnRole.Status,
              valueType: SnmpTableValueType.Text,
            },
          ],
        }),
      ],
      options,
    );

    expect(table!.columns[0]!.role).toBeUndefined();
    expect(table!.columns[0]!.valueType).toBeUndefined();
    expect(table!.columns[1]!.role).toBe(SnmpTableColumnRole.Status);
    expect(table!.columns[1]!.valueType).toBe(SnmpTableValueType.Text);
  });

  it("cleans value labels and healthy values", () => {
    const [table] = SnmpTableListUtil.validateTableList(
      [
        ipsecTable({
          columns: [
            {
              oid: IPSEC_STATUS,
              name: "Status",
              valueLabels: { " 1 ": " active ", "": "nothing", "2": "  " },
              healthyValues: ["1", " 1", "", "3"],
            },
          ],
        }),
      ],
      options,
    );

    expect(table!.columns[0]!.valueLabels).toEqual({ "1": "active" });
    expect(table!.columns[0]!.healthyValues).toEqual(["1", "3"]);
  });
});

describe("SnmpTableListUtil.resolveEffectiveTables", () => {
  it("puts template tables first and appends device tables", () => {
    const resolution: {
      tables: Array<SnmpTableDefinition>;
      truncatedCount: number;
    } = SnmpTableListUtil.resolveEffectiveTables({
      templateTables: [ipsecTable()],
      deviceTables: [radioTable()],
    });

    expect(
      resolution.tables.map((table: SnmpTableDefinition) => {
        return table.key;
      }),
    ).toEqual(["ipsec_tunnels", "wifi_radios"]);
    expect(resolution.truncatedCount).toBe(0);
  });

  it("lets a device table replace the template table with the same key, in place", () => {
    const resolution: {
      tables: Array<SnmpTableDefinition>;
      truncatedCount: number;
    } = SnmpTableListUtil.resolveEffectiveTables({
      templateTables: [ipsecTable(), radioTable()],
      deviceTables: [ipsecTable({ name: "Only my tunnels", maxRows: 5 })],
    });

    expect(resolution.tables[0]!.name).toBe("Only my tunnels");
    expect(resolution.tables[0]!.maxRows).toBe(5);
    expect(resolution.tables[1]!.key).toBe("wifi_radios");
  });

  it("drops malformed stored tables instead of failing the whole poll", () => {
    const resolution: {
      tables: Array<SnmpTableDefinition>;
      truncatedCount: number;
    } = SnmpTableListUtil.resolveEffectiveTables({
      templateTables: [
        ipsecTable({ columns: [{ oid: "garbage", name: "x" }] }),
        radioTable(),
      ],
      deviceTables: undefined,
    });

    expect(
      resolution.tables.map((table: SnmpTableDefinition) => {
        return table.key;
      }),
    ).toEqual(["wifi_radios"]);
  });

  it("truncates beyond the effective cap and reports how many", () => {
    const tables: Array<SnmpTableDefinition> = [];

    for (let i: number = 0; i < MAX_EFFECTIVE_TABLES_PER_DEVICE + 3; i++) {
      tables.push(ipsecTable({ key: `t${i}`, name: `T${i}` }));
    }

    const resolution: {
      tables: Array<SnmpTableDefinition>;
      truncatedCount: number;
    } = SnmpTableListUtil.resolveEffectiveTables({
      templateTables: tables,
      deviceTables: [],
    });

    expect(resolution.tables).toHaveLength(MAX_EFFECTIVE_TABLES_PER_DEVICE);
    expect(resolution.truncatedCount).toBe(3);
  });

  it("composes the template and device caps into the effective cap", () => {
    expect(MAX_EFFECTIVE_TABLES_PER_DEVICE).toBe(
      MAX_TABLES_PER_TEMPLATE + MAX_DEVICE_SPECIFIC_TABLES,
    );
  });
});

describe("SnmpTableListUtil.toWalkRequests", () => {
  it("sends only column OIDs (labels first, deduped) and the row limit", () => {
    const requests: Array<SnmpTableWalkRequest> =
      SnmpTableListUtil.toWalkRequests([
        ipsecTable({ maxRows: 12 }),
        radioTable(),
      ]);

    expect(requests[0]).toEqual({
      key: "ipsec_tunnels",
      columnOids: [IPSEC_NAME, IPSEC_STATUS, IPSEC_ACTIVATED],
      maxRows: 12,
    });

    // The radio band is both the row name and a value column: walked once.
    expect(requests[1]!.columnOids).toEqual([
      RADIO_BAND,
      RADIO_CHANNEL,
      RADIO_WIDTH,
      RADIO_POWER,
      RADIO_CLIENTS,
    ]);
    expect(requests[1]!.maxRows).toBe(DEFAULT_SNMP_TABLE_MAX_ROWS);
  });

  it("never sends names, labels or descriptions to the probe", () => {
    const [request] = SnmpTableListUtil.toWalkRequests([ipsecTable()]);

    expect(Object.keys(request!).sort()).toEqual([
      "columnOids",
      "key",
      "maxRows",
    ]);
  });
});

describe("SnmpTableListUtil.getMaxRows", () => {
  it("defaults, accepts and clamps", () => {
    expect(SnmpTableListUtil.getMaxRows(ipsecTable())).toBe(
      DEFAULT_SNMP_TABLE_MAX_ROWS,
    );
    expect(SnmpTableListUtil.getMaxRows(ipsecTable({ maxRows: 7 }))).toBe(7);
    expect(SnmpTableListUtil.getMaxRows(ipsecTable({ maxRows: 99999 }))).toBe(
      MAX_SNMP_TABLE_MAX_ROWS,
    );
    expect(SnmpTableListUtil.getMaxRows(ipsecTable({ maxRows: -4 }))).toBe(
      DEFAULT_SNMP_TABLE_MAX_ROWS,
    );
  });
});

describe("SnmpTableListUtil.parseNumericValue", () => {
  it("keeps finite numbers", () => {
    expect(SnmpTableListUtil.parseNumericValue(42)).toBe(42);
    expect(SnmpTableListUtil.parseNumericValue(-3.5)).toBe(-3.5);
    expect(SnmpTableListUtil.parseNumericValue(Infinity)).toBeUndefined();
    expect(SnmpTableListUtil.parseNumericValue(NaN)).toBeUndefined();
  });

  it("reads a number at the start of vendor text", () => {
    expect(SnmpTableListUtil.parseNumericValue("36")).toBe(36);
    expect(SnmpTableListUtil.parseNumericValue("-95 dBm")).toBe(-95);
    expect(SnmpTableListUtil.parseNumericValue("80MHz")).toBe(80);
    expect(SnmpTableListUtil.parseNumericValue(" 1.5")).toBe(1.5);
    expect(SnmpTableListUtil.parseNumericValue("2.4GHz")).toBe(2.4);
    expect(SnmpTableListUtil.parseNumericValue("99/88/0/0/0")).toBe(99);
    expect(SnmpTableListUtil.parseNumericValue(".5")).toBe(0.5);
    expect(SnmpTableListUtil.parseNumericValue("+7")).toBe(7);
  });

  it("does not read text that does not start with a number", () => {
    expect(SnmpTableListUtil.parseNumericValue("HQ-Branch1")).toBeUndefined();
    expect(SnmpTableListUtil.parseNumericValue("ON")).toBeUndefined();
    expect(SnmpTableListUtil.parseNumericValue("")).toBeUndefined();
    expect(SnmpTableListUtil.parseNumericValue(null)).toBeUndefined();
    expect(SnmpTableListUtil.parseNumericValue(undefined)).toBeUndefined();
  });

  it("reads nothing at all for a Text column", () => {
    expect(
      SnmpTableListUtil.parseNumericValue("11axg", SnmpTableValueType.Text),
    ).toBeUndefined();
    expect(
      SnmpTableListUtil.parseNumericValue(5, SnmpTableValueType.Text),
    ).toBeUndefined();
  });
});

describe("SnmpTableListUtil.buildCell", () => {
  it("shows the value label but keeps the raw value and its number", () => {
    expect(SnmpTableListUtil.buildCell(ipsecTable().columns[0]!, 0)).toEqual({
      raw: 0,
      display: "inactive",
      numeric: 0,
      isHealthy: false,
    });

    expect(SnmpTableListUtil.buildCell(ipsecTable().columns[0]!, 1)).toEqual({
      raw: 1,
      display: "active",
      numeric: 1,
      isHealthy: true,
    });
  });

  it("shows the raw text when no label matches", () => {
    expect(SnmpTableListUtil.buildCell(ipsecTable().columns[0]!, 7)).toEqual({
      raw: 7,
      display: "7",
      numeric: 7,
      isHealthy: false,
    });
  });

  it("treats a missing value as empty, unhealthy and non-numeric", () => {
    expect(
      SnmpTableListUtil.buildCell(ipsecTable().columns[0]!, undefined),
    ).toEqual({ raw: null, display: "", isHealthy: false });
  });

  it("omits health for columns without healthy values", () => {
    expect(SnmpTableListUtil.buildCell(radioTable().columns[1]!, "36")).toEqual(
      { raw: "36", display: "36", numeric: 36 },
    );
  });
});

describe("SnmpTableListUtil.materialize", () => {
  it("names rows by their label column and sorts them by index", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      ipsecTable(),
      ipsecResult(),
    );

    expect(rowLabels(snapshot)).toEqual([
      "HQ-Branch1",
      "HQ-Branch2",
      "Branch-10",
    ]);
    expect(
      snapshot.rows.map((row: SnmpTableSnapshotRow) => {
        return row.index;
      }),
    ).toEqual(["1", "2", "10"]);
    expect(snapshot.kind).toBe(SnmpTableKind.VpnTunnel);
    expect(snapshot.collectedAt).toBe("2026-10-07T10:00:00.000Z");
  });

  it("keys cells by column OID with labels, numbers and health", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      ipsecTable(),
      ipsecResult(),
    );

    expect(snapshot.rows[1]!.cells[IPSEC_STATUS]).toEqual({
      raw: 0,
      display: "inactive",
      numeric: 0,
      isHealthy: false,
    });
    expect(snapshot.rows[1]!.cells[IPSEC_ACTIVATED]!.display).toBe("yes");
    // The row-name column is not a value column, so it is not a cell.
    expect(snapshot.rows[1]!.cells[IPSEC_NAME]).toBeUndefined();
  });

  it("describes columns without their value labels", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      ipsecTable(),
      ipsecResult(),
    );

    expect(snapshot.columns[0]).toEqual({
      oid: IPSEC_STATUS,
      name: "Status",
      role: SnmpTableColumnRole.Status,
      healthyValues: ["1"],
    });
  });

  it("names rows by index when there is no label column or no label value", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      ipsecTable({ rowLabelColumnOids: [] }),
      ipsecResult(),
    );

    expect(rowLabels(snapshot)).toEqual(["1", "2", "10"]);

    const blankLabel: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [{ index: "4", values: { [IPSEC_NAME]: "  ", [IPSEC_STATUS]: 1 } }],
    });

    expect(rowLabels(blankLabel)).toEqual(["4"]);
  });

  it("joins several label columns and uses value labels in them", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      radioTable({ rowLabelColumnOids: [RADIO_BAND, RADIO_CHANNEL] }),
      {
        key: "wifi_radios",
        rows: [
          {
            index: "2",
            values: { [RADIO_BAND]: "5GHz", [RADIO_CHANNEL]: "36" },
          },
        ],
      },
    );

    expect(rowLabels(snapshot)).toEqual(["5GHz / 36"]);
  });

  it("reads numbers out of vendor strings", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(radioTable(), {
      key: "wifi_radios",
      rows: [
        {
          index: "1",
          values: {
            [RADIO_BAND]: "2.4GHz",
            [RADIO_CHANNEL]: "6",
            [RADIO_WIDTH]: "20MHz",
            [RADIO_POWER]: 17,
            [RADIO_CLIENTS]: 12,
          },
        },
      ],
    });

    const cells: SnmpTableSnapshotRow["cells"] = snapshot.rows[0]!.cells;
    expect(cells[RADIO_CHANNEL]!.numeric).toBe(6);
    expect(cells[RADIO_WIDTH]!.numeric).toBe(20);
    expect(cells[RADIO_POWER]!.numeric).toBe(17);
    expect(cells[RADIO_CLIENTS]!.numeric).toBe(12);
  });

  it("skips results for tables that are no longer defined", () => {
    expect(
      SnmpTableListUtil.materialize({
        tables: [radioTable()],
        results: [ipsecResult()],
      }),
    ).toEqual([]);
  });

  it("leaves out defined tables the probe did not report", () => {
    expect(
      SnmpTableListUtil.materialize({
        tables: [ipsecTable(), radioTable()],
        results: [ipsecResult()],
      }).map((snapshot: SnmpTableSnapshot) => {
        return snapshot.key;
      }),
    ).toEqual(["ipsec_tunnels"]);

    expect(
      SnmpTableListUtil.materialize({
        tables: [ipsecTable()],
        results: undefined,
      }),
    ).toEqual([]);
  });

  it("carries failure and truncation through", () => {
    const failed: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [],
      failureCause: "Request timed out",
    });

    expect(failed.failureCause).toBe("Request timed out");
    expect(failed.rows).toEqual([]);

    const truncated: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      ...ipsecResult(),
      isTruncated: true,
    });

    expect(truncated.isTruncated).toBe(true);
  });

  it("ignores rows without an index and caps rows at the table's limit", () => {
    const snapshot: SnmpTableSnapshot = materializeOne(
      ipsecTable({ maxRows: 2 }),
      {
        key: "ipsec_tunnels",
        rows: [
          ...ipsecResult().rows,
          { index: "", values: { [IPSEC_STATUS]: 1 } },
        ],
      },
    );

    expect(rowLabels(snapshot)).toEqual(["HQ-Branch1", "HQ-Branch2"]);
  });
});

describe("SnmpTableListUtil.compareRowIndexes", () => {
  it("compares index arcs numerically", () => {
    const indexes: Array<string> = ["10", "2", "1.10", "1.9", "1", "3.1.2"];

    expect(indexes.sort(SnmpTableListUtil.compareRowIndexes)).toEqual([
      "1",
      "1.9",
      "1.10",
      "2",
      "3.1.2",
      "10",
    ]);
  });

  it("falls back to text order for non-numeric arcs", () => {
    expect(SnmpTableListUtil.compareRowIndexes("a", "b")).toBeLessThan(0);
    expect(SnmpTableListUtil.compareRowIndexes("1.b", "1.a")).toBeGreaterThan(
      0,
    );
    expect(SnmpTableListUtil.compareRowIndexes("5", "5")).toBe(0);
  });
});

describe("SnmpTableListUtil.capSnapshotsForStorage", () => {
  function bigSnapshot(
    key: string,
    rows: number,
    columns: number,
  ): SnmpTableSnapshot {
    const snapshotColumns: SnmpTableSnapshot["columns"] = [];

    for (let c: number = 0; c < columns; c++) {
      snapshotColumns.push({ oid: `1.3.6.1.4.1.9.${c}`, name: `c${c}` });
    }

    const snapshotRows: Array<SnmpTableSnapshotRow> = [];

    for (let r: number = 0; r < rows; r++) {
      snapshotRows.push({ index: `${r}`, label: `${r}`, cells: {} });
    }

    return {
      key: key,
      name: key,
      kind: SnmpTableKind.Generic,
      columns: snapshotColumns,
      rows: snapshotRows,
    };
  }

  it("keeps everything that fits", () => {
    const snapshots: Array<SnmpTableSnapshot> = [bigSnapshot("a", 10, 5)];

    expect(SnmpTableListUtil.capSnapshotsForStorage(snapshots)).toEqual(
      snapshots,
    );
  });

  it("cuts the table that hits the cell budget and empties the ones after it", () => {
    const capped: Array<SnmpTableSnapshot> =
      SnmpTableListUtil.capSnapshotsForStorage([
        bigSnapshot("a", 200, 20),
        bigSnapshot("b", 100, 20),
        bigSnapshot("c", 10, 2),
      ]);

    expect(capped[0]!.rows).toHaveLength(200);
    expect(capped[0]!.isTruncated).toBeUndefined();
    // 5000 - 4000 = 1000 cells left, 20 per row.
    expect(capped[1]!.rows).toHaveLength(50);
    expect(capped[1]!.isTruncated).toBe(true);
    expect(capped[2]!.rows).toHaveLength(0);
    expect(capped[2]!.isTruncated).toBe(true);

    const storedCells: number = capped.reduce(
      (total: number, snapshot: SnmpTableSnapshot) => {
        return total + snapshot.rows.length * snapshot.columns.length;
      },
      0,
    );
    expect(storedCells).toBeLessThanOrEqual(MAX_SNAPSHOT_CELLS_PER_DEVICE);
  });
});

describe("SnmpTableListUtil.mergeWithPrevious", () => {
  const previous: SnmpTableSnapshot = materializeOne(
    ipsecTable(),
    ipsecResult(),
  );

  it("replaces a table that walked cleanly", () => {
    const current: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [
        { index: "1", values: { [IPSEC_NAME]: "Only", [IPSEC_STATUS]: 1 } },
      ],
    });

    expect(
      SnmpTableListUtil.mergeWithPrevious({
        current: [current],
        previous: [previous],
        definedKeys: ["ipsec_tunnels"],
      }),
    ).toEqual([current]);
  });

  it("keeps the last good rows of a table that failed, with the new cause", () => {
    const failed: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [],
      failureCause: "timeout",
    });

    const [merged] = SnmpTableListUtil.mergeWithPrevious({
      current: [failed],
      previous: [previous],
      definedKeys: ["ipsec_tunnels"],
    });

    expect(merged!.rows).toEqual(previous.rows);
    expect(merged!.failureCause).toBe("timeout");
  });

  it("stores a failed table with no history as it is", () => {
    const failed: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [],
      failureCause: "timeout",
    });

    expect(
      SnmpTableListUtil.mergeWithPrevious({
        current: [failed],
        previous: [],
        definedKeys: ["ipsec_tunnels"],
      }),
    ).toEqual([failed]);
  });

  it("keeps a defined table this walk did not report, and drops undefined ones", () => {
    expect(
      SnmpTableListUtil.mergeWithPrevious({
        current: [],
        previous: [previous],
        definedKeys: ["ipsec_tunnels"],
      }),
    ).toEqual([previous]);

    expect(
      SnmpTableListUtil.mergeWithPrevious({
        current: [],
        previous: [previous],
        definedKeys: ["wifi_radios"],
      }),
    ).toEqual([]);
  });

  it("orders the result by the definitions", () => {
    const radios: SnmpTableSnapshot = materializeOne(radioTable(), {
      key: "wifi_radios",
      rows: [],
    });

    expect(
      SnmpTableListUtil.mergeWithPrevious({
        current: [previous, radios],
        previous: undefined,
        definedKeys: ["wifi_radios", "ipsec_tunnels"],
      }).map((snapshot: SnmpTableSnapshot) => {
        return snapshot.key;
      }),
    ).toEqual(["wifi_radios", "ipsec_tunnels"]);
  });
});

describe("SnmpTableListUtil lookups and row scopes", () => {
  const snapshot: SnmpTableSnapshot = materializeOne(
    ipsecTable(),
    ipsecResult(),
  );

  it("finds a snapshot by key, normalizing the key", () => {
    expect(
      SnmpTableListUtil.findSnapshot([snapshot], "IPsec Tunnels")?.key,
    ).toBe("ipsec_tunnels");
    expect(SnmpTableListUtil.findSnapshot([snapshot], "")).toBeUndefined();
    expect(SnmpTableListUtil.findSnapshot(undefined, "x")).toBeUndefined();
  });

  it("finds a column by OID (with or without a leading dot) or by name", () => {
    expect(SnmpTableListUtil.findColumn(snapshot, IPSEC_STATUS)?.name).toBe(
      "Status",
    );
    expect(
      SnmpTableListUtil.findColumn(snapshot, `.${IPSEC_STATUS}`)?.name,
    ).toBe("Status");
    expect(SnmpTableListUtil.findColumn(snapshot, "activated")?.oid).toBe(
      IPSEC_ACTIVATED,
    );
    expect(SnmpTableListUtil.findColumn(snapshot, "")).toBeUndefined();
    expect(SnmpTableListUtil.findColumn(snapshot, "nope")).toBeUndefined();
  });

  it("scopes rows: all, by name, by index and by exact index", () => {
    expect(SnmpTableListUtil.scopeRows(snapshot, undefined)).toHaveLength(3);
    expect(SnmpTableListUtil.scopeRows(snapshot, "*")).toHaveLength(3);
    expect(
      SnmpTableListUtil.scopeRows(snapshot, "hq-branch2").map(
        (row: SnmpTableSnapshotRow) => {
          return row.index;
        },
      ),
    ).toEqual(["2"]);
    expect(
      SnmpTableListUtil.scopeRows(snapshot, "10").map(
        (row: SnmpTableSnapshotRow) => {
          return row.label;
        },
      ),
    ).toEqual(["Branch-10"]);
    expect(
      SnmpTableListUtil.scopeRows(snapshot, `${ROW_INDEX_SCOPE_PREFIX}1`).map(
        (row: SnmpTableSnapshotRow) => {
          return row.label;
        },
      ),
    ).toEqual(["HQ-Branch1"]);
    expect(SnmpTableListUtil.scopeRows(snapshot, "missing")).toEqual([]);
  });

  it("scopes a row by name when unique, by exact index when not", () => {
    expect(SnmpTableListUtil.getRowScope(snapshot, snapshot.rows[0]!)).toBe(
      "HQ-Branch1",
    );

    const duplicated: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [
        { index: "1", values: { [IPSEC_NAME]: "Same", [IPSEC_STATUS]: 1 } },
        { index: "2", values: { [IPSEC_NAME]: "Same", [IPSEC_STATUS]: 0 } },
      ],
    });

    expect(SnmpTableListUtil.getRowScope(duplicated, duplicated.rows[1]!)).toBe(
      `${ROW_INDEX_SCOPE_PREFIX}2`,
    );

    // A name that is also another row's index is ambiguous too.
    const clashing: SnmpTableSnapshot = materializeOne(ipsecTable(), {
      key: "ipsec_tunnels",
      rows: [
        { index: "1", values: { [IPSEC_NAME]: "2", [IPSEC_STATUS]: 1 } },
        { index: "2", values: { [IPSEC_NAME]: "B", [IPSEC_STATUS]: 1 } },
      ],
    });

    expect(SnmpTableListUtil.getRowScope(clashing, clashing.rows[0]!)).toBe(
      `${ROW_INDEX_SCOPE_PREFIX}1`,
    );

    // Every scope produced selects exactly its own row.
    for (const table of [snapshot, duplicated, clashing]) {
      for (const row of table.rows) {
        expect(
          SnmpTableListUtil.scopeRows(
            table,
            SnmpTableListUtil.getRowScope(table, row),
          ),
        ).toEqual([row]);
      }
    }
  });
});

describe("SnmpTableListUtil.parseKind", () => {
  it("accepts known kinds and defaults the rest to Generic", () => {
    expect(SnmpTableListUtil.parseKind("WifiRadio")).toBe(
      SnmpTableKind.WifiRadio,
    );
    expect(SnmpTableListUtil.parseKind("Whatever")).toBe(SnmpTableKind.Generic);
    expect(SnmpTableListUtil.parseKind(undefined)).toBe(SnmpTableKind.Generic);
  });
});
