import SnmpTableCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpTableCriteria";
import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableSnapshot,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpTrap from "../../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;

const RADIO_ENTRY: string = "1.3.6.1.4.1.17713.22.1.2.1";
const RADIO_BAND: string = `${RADIO_ENTRY}.3`;
const RADIO_WIDTH: string = `${RADIO_ENTRY}.7`;
const RADIO_POWER: string = `${RADIO_ENTRY}.8`;
const RADIO_STATE: string = `${RADIO_ENTRY}.13`;

const SOPHOS_TRAP_OID: string = "1.3.6.1.4.1.2604.5.1.8.1.1";
const SOPHOS_TRAP_MESSAGE: string = "1.3.6.1.4.1.2604.5.1.8.1.2";

const IPSEC_TABLE: SnmpTableDefinition = {
  key: "ipsec_tunnels",
  name: "IPsec Tunnels",
  kind: SnmpTableKind.VpnTunnel,
  rowLabelColumnOids: [IPSEC_NAME],
  columns: [
    {
      oid: IPSEC_STATUS,
      name: "Status",
      role: SnmpTableColumnRole.Status,
      valueLabels: { "0": "inactive", "1": "active", "2": "partially active" },
      healthyValues: ["1"],
    },
  ],
};

const RADIO_TABLE: SnmpTableDefinition = {
  key: "wifi_radios",
  name: "Wi-Fi Radios",
  kind: SnmpTableKind.WifiRadio,
  rowLabelColumnOids: [RADIO_BAND],
  columns: [
    { oid: RADIO_WIDTH, name: "Channel Width", unit: "MHz" },
    { oid: RADIO_POWER, name: "TX Power", unit: "dBm" },
    {
      oid: RADIO_STATE,
      name: "State",
      valueLabels: { ON: "On", OFF: "Off" },
    },
  ],
};

function tunnels(
  rows: Array<{ index: string; name: string; status: number }>,
): SnmpTableSnapshot {
  const result: SnmpTableResult = {
    key: "ipsec_tunnels",
    rows: rows.map((row: { index: string; name: string; status: number }) => {
      return {
        index: row.index,
        values: { [IPSEC_NAME]: row.name, [IPSEC_STATUS]: row.status },
      };
    }),
  };

  return SnmpTableListUtil.materialize({
    tables: [IPSEC_TABLE],
    results: [result],
  })[0]!;
}

function radios(): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: [RADIO_TABLE],
    results: [
      {
        key: "wifi_radios",
        rows: [
          {
            index: "1",
            values: {
              [RADIO_BAND]: "2.4GHz",
              [RADIO_WIDTH]: "20MHz",
              [RADIO_POWER]: 14,
              [RADIO_STATE]: "ON",
            },
          },
          {
            index: "2",
            values: {
              [RADIO_BAND]: "5GHz",
              [RADIO_WIDTH]: "80MHz",
              [RADIO_POWER]: 21,
              [RADIO_STATE]: "OFF",
            },
          },
        ],
      },
    ],
  })[0]!;
}

const THREE_TUNNELS: SnmpTableSnapshot = tunnels([
  { index: "1", name: "HQ-Branch1", status: 1 },
  { index: "2", name: "HQ-Branch2", status: 0 },
  { index: "3", name: "HQ-Branch3", status: 2 },
]);

function tableFilter(input: {
  filterType: FilterType;
  value?: string | number | undefined;
  tableKey?: string | undefined;
  column?: string | undefined;
  row?: string | undefined;
  checkOn?: CheckOn | undefined;
}): CriteriaFilter {
  return {
    checkOn: input.checkOn ?? CheckOn.SnmpTableValue,
    filterType: input.filterType,
    value: input.value,
    snmpMonitorOptions: {
      tableKey: input.tableKey ?? "ipsec_tunnels",
      tableColumnOid: input.column ?? IPSEC_STATUS,
      tableRow: input.row,
    },
  };
}

function evaluateValue(
  tables: Array<SnmpTableSnapshot> | undefined,
  filter: CriteriaFilter,
): string | null {
  return SnmpTableCriteria.evaluateTableValue({
    tables: tables,
    criteriaFilter: filter,
  });
}

describe("SnmpTableCriteria.evaluateTableValue", () => {
  it("is met when any row matches a numeric comparison, and names the rows", () => {
    const result: string | null = evaluateValue(
      [THREE_TUNNELS],
      tableFilter({ filterType: FilterType.NotEqualTo, value: "1" }),
    );

    expect(result).toContain("2 row(s) of SNMP table IPsec Tunnels");
    expect(result).toContain("HQ-Branch2 (Status: inactive)");
    expect(result).toContain("HQ-Branch3 (Status: partially active)");
    expect(result).not.toContain("HQ-Branch1");
  });

  it("is not met when no row matches", () => {
    expect(
      evaluateValue(
        [tunnels([{ index: "1", name: "A", status: 1 }])],
        tableFilter({ filterType: FilterType.NotEqualTo, value: 1 }),
      ),
    ).toBeNull();
  });

  it("matches a value label as well as the raw value", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.EqualTo, value: "inactive" }),
      ),
    ).toContain("HQ-Branch2");

    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.EqualTo, value: "0" }),
      ),
    ).toContain("HQ-Branch2");
  });

  it("only matches a negative text filter when neither form matches", () => {
    const result: string | null = evaluateValue(
      [THREE_TUNNELS],
      tableFilter({ filterType: FilterType.NotEqualTo, value: "active" }),
    );

    // The active tunnel is "1" raw and "active" shown: it must not match.
    expect(result).not.toContain("HQ-Branch1");
    expect(result).toContain("HQ-Branch2");
    expect(result).toContain("HQ-Branch3");
  });

  it("supports contains, starts with and ends with on labels", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.Contains, value: "partial" }),
      ),
    ).toContain("HQ-Branch3");
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.StartsWith, value: "in" }),
      ),
    ).toContain("HQ-Branch2");
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.EndsWith, value: "ive" }),
      ),
    ).toContain("3 row(s)");
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.EndsWith, value: "ially active" }),
      ),
    ).toContain("1 row(s)");
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.NotContains, value: "active" }),
      ),
    ).toBeNull();
  });

  it("compares numbers read out of vendor text", () => {
    const result: string | null = evaluateValue(
      [radios()],
      tableFilter({
        tableKey: "wifi_radios",
        column: RADIO_WIDTH,
        filterType: FilterType.GreaterThan,
        value: 40,
      }),
    );

    expect(result).toContain("5GHz (Channel Width: 80MHz MHz)");
    expect(result).not.toContain("2.4GHz");
  });

  it("does not treat '80MHz' as Equal To 80", () => {
    expect(
      evaluateValue(
        [radios()],
        tableFilter({
          tableKey: "wifi_radios",
          column: RADIO_WIDTH,
          filterType: FilterType.EqualTo,
          value: 80,
        }),
      ),
    ).toBeNull();

    expect(
      evaluateValue(
        [radios()],
        tableFilter({
          tableKey: "wifi_radios",
          column: RADIO_WIDTH,
          filterType: FilterType.EqualTo,
          value: "80MHz",
        }),
      ),
    ).toContain("5GHz");
  });

  it("matches text enumerations by raw value or label", () => {
    expect(
      evaluateValue(
        [radios()],
        tableFilter({
          tableKey: "wifi_radios",
          column: RADIO_STATE,
          filterType: FilterType.EqualTo,
          value: "OFF",
        }),
      ),
    ).toContain("5GHz (State: Off)");

    expect(
      evaluateValue(
        [radios()],
        tableFilter({
          tableKey: "wifi_radios",
          column: RADIO_STATE,
          filterType: FilterType.EqualTo,
          value: "Off",
        }),
      ),
    ).toContain("5GHz");
  });

  it("never compares text with a greater-than filter", () => {
    expect(
      evaluateValue(
        [radios()],
        tableFilter({
          tableKey: "wifi_radios",
          column: RADIO_STATE,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ),
    ).toBeNull();
  });

  it("narrows to one row by name, by index, or by exact index", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({
          filterType: FilterType.NotEqualTo,
          value: 1,
          row: "hq-branch3",
        }),
      ),
    ).toContain("1 row(s)");

    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.NotEqualTo, value: 1, row: "1" }),
      ),
    ).toBeNull();

    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({
          filterType: FilterType.NotEqualTo,
          value: 1,
          row: "index:2",
        }),
      ),
    ).toContain("HQ-Branch2");
  });

  it("is not evaluated for a table this walk did not produce or could not walk", () => {
    expect(
      evaluateValue(
        [],
        tableFilter({ filterType: FilterType.NotEqualTo, value: 1 }),
      ),
    ).toBeNull();
    expect(
      evaluateValue(
        undefined,
        tableFilter({ filterType: FilterType.NotEqualTo, value: 1 }),
      ),
    ).toBeNull();
    expect(
      evaluateValue(
        [{ ...THREE_TUNNELS, rows: [], failureCause: "Request timed out" }],
        tableFilter({ filterType: FilterType.IsEmpty }),
      ),
    ).toBeNull();
  });

  it("is not evaluated for a column the table does not have", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({
          filterType: FilterType.NotEqualTo,
          value: 1,
          column: "1.3.6.1.4.1.9.9.9",
        }),
      ),
    ).toBeNull();
  });

  it("accepts a column name instead of an OID", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({
          filterType: FilterType.EqualTo,
          value: 2,
          column: "status",
        }),
      ),
    ).toContain("HQ-Branch3");
  });

  it("supports is empty and is not empty", () => {
    const withMissing: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [IPSEC_TABLE],
      results: [
        {
          key: "ipsec_tunnels",
          rows: [
            { index: "1", values: { [IPSEC_NAME]: "A", [IPSEC_STATUS]: 1 } },
            { index: "2", values: { [IPSEC_NAME]: "B" } },
          ],
        },
      ],
    })[0]!;

    expect(
      evaluateValue(
        [withMissing],
        tableFilter({ filterType: FilterType.IsEmpty }),
      ),
    ).toContain("B (Status: (empty))");
    expect(
      evaluateValue(
        [withMissing],
        tableFilter({ filterType: FilterType.IsNotEmpty }),
      ),
    ).toContain("A (Status: active)");
  });

  it("summarises long lists of matching rows", () => {
    const many: SnmpTableSnapshot = tunnels(
      Array.from({ length: 9 }, (_: unknown, i: number) => {
        return { index: `${i + 1}`, name: `T${i + 1}`, status: 0 };
      }),
    );

    expect(
      evaluateValue(
        [many],
        tableFilter({ filterType: FilterType.EqualTo, value: 0 }),
      ),
    ).toContain(", and 4 more.");
  });

  it("does nothing without a threshold for a value filter", () => {
    expect(
      evaluateValue(
        [THREE_TUNNELS],
        tableFilter({ filterType: FilterType.EqualTo, value: undefined }),
      ),
    ).toBeNull();
  });
});

describe("SnmpTableCriteria.evaluateTableRowCount", () => {
  function evaluateCount(filter: CriteriaFilter): string | null {
    return SnmpTableCriteria.evaluateTableRowCount({
      tables: [THREE_TUNNELS],
      criteriaFilter: { ...filter, checkOn: CheckOn.SnmpTableRowCount },
    });
  }

  it("compares the number of rows", () => {
    expect(
      evaluateCount(tableFilter({ filterType: FilterType.LessThan, value: 4 })),
    ).toBe("SNMP table IPsec Tunnels has 3 row(s), which is less than 4.");
    expect(
      evaluateCount(
        tableFilter({ filterType: FilterType.GreaterThan, value: 3 }),
      ),
    ).toBeNull();
  });

  it("counts only the rows in scope, so a named row can be required to exist", () => {
    expect(
      evaluateCount(
        tableFilter({
          filterType: FilterType.EqualTo,
          value: 0,
          row: "HQ-Branch9",
        }),
      ),
    ).toContain("has 0 row(s)");
  });

  it("is not evaluated without a numeric threshold or a usable table", () => {
    expect(
      evaluateCount(
        tableFilter({ filterType: FilterType.EqualTo, value: "x" }),
      ),
    ).toBeNull();
    expect(
      SnmpTableCriteria.evaluateTableRowCount({
        tables: [{ ...THREE_TUNNELS, failureCause: "timeout" }],
        criteriaFilter: tableFilter({
          checkOn: CheckOn.SnmpTableRowCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      }),
    ).toBeNull();
  });
});

describe("SnmpTableCriteria.evaluateTrapVarbind", () => {
  const sophosTrap: SnmpTrap = {
    sourceIpAddress: "10.0.0.1",
    trapOid: SOPHOS_TRAP_OID,
    snmpVersion: "2c",
    receivedAt: new Date(),
    varbinds: [
      { oid: "1.3.6.1.4.1.2604.5.1.8.1.3.0", value: "XGS2100_SFOS" },
      {
        oid: `${SOPHOS_TRAP_MESSAGE}.0`,
        value:
          "Alert_Id : 17825 Message : IPSec tunnel HQ-Branch2 is down between 10.0.0.1 and 10.0.0.2",
      },
      { oid: "1.3.6.1.4.1.2604.5.1.8.1.4.0", value: "17825" },
    ],
  };

  function evaluateVarbind(filter: Partial<CriteriaFilter>): string | null {
    return SnmpTableCriteria.evaluateTrapVarbind({
      snmpTrap: sophosTrap,
      criteriaFilter: {
        checkOn: CheckOn.SnmpTrapVarbindValue,
        filterType: FilterType.Contains,
        value: "",
        ...filter,
      } as CriteriaFilter,
    });
  }

  it("finds text in any varbind when no OID is configured", () => {
    expect(
      evaluateVarbind({ filterType: FilterType.Contains, value: "is down" }),
    ).toContain(`varbind ${SOPHOS_TRAP_MESSAGE}.0`);
  });

  it("scopes to one varbind and its instances", () => {
    expect(
      evaluateVarbind({
        filterType: FilterType.Contains,
        value: "XGS",
        snmpMonitorOptions: { oid: SOPHOS_TRAP_MESSAGE },
      }),
    ).toBeNull();

    expect(
      evaluateVarbind({
        filterType: FilterType.Contains,
        value: "HQ-Branch2",
        snmpMonitorOptions: { oid: `.${SOPHOS_TRAP_MESSAGE}` },
      }),
    ).toContain("HQ-Branch2");

    // A sibling OID that merely shares a prefix is not in scope.
    expect(
      evaluateVarbind({
        filterType: FilterType.Contains,
        value: "17825",
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.2604.5.1.8.1.4" },
      }),
    ).toContain("17825");
    expect(
      evaluateVarbind({
        filterType: FilterType.Contains,
        value: "17825",
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.2604.5.1.8.1.40" },
      }),
    ).toBeNull();
  });

  it("is met by a negative filter only when no varbind matches", () => {
    expect(
      evaluateVarbind({ filterType: FilterType.NotContains, value: "tunnel" }),
    ).toBeNull();
    expect(
      evaluateVarbind({ filterType: FilterType.NotContains, value: "fan" }),
    ).toContain("not contains fan");
    expect(
      evaluateVarbind({ filterType: FilterType.NotEqualTo, value: "17825" }),
    ).toBeNull();
  });

  it("compares numeric varbinds as numbers", () => {
    expect(
      evaluateVarbind({
        filterType: FilterType.GreaterThan,
        value: 17000,
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.2604.5.1.8.1.4" },
      }),
    ).toContain("17825");
    expect(
      evaluateVarbind({
        filterType: FilterType.EqualTo,
        value: "17825.0",
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.2604.5.1.8.1.4" },
      }),
    ).not.toBeNull();
  });

  it("treats an absent varbind as empty", () => {
    expect(
      evaluateVarbind({
        filterType: FilterType.IsEmpty,
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.9" },
      }),
    ).toContain("is empty");
    expect(
      evaluateVarbind({
        filterType: FilterType.IsNotEmpty,
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.9" },
      }),
    ).toBeNull();
  });

  it("ignores filter types that do not apply to a value", () => {
    expect(evaluateVarbind({ filterType: FilterType.True })).toBeNull();
  });
});

describe("SnmpTableCriteria observations", () => {
  it("describes what the table showed", () => {
    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [THREE_TUNNELS],
        criteriaFilter: tableFilter({
          filterType: FilterType.EqualTo,
          value: 5,
        }),
      }),
    ).toBe(
      "Status in SNMP table IPsec Tunnels was HQ-Branch1: active, HQ-Branch2: inactive, HQ-Branch3: partially active.",
    );

    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [THREE_TUNNELS],
        criteriaFilter: tableFilter({
          checkOn: CheckOn.SnmpTableRowCount,
          filterType: FilterType.EqualTo,
          value: 5,
        }),
      }),
    ).toBe("SNMP table IPsec Tunnels had 3 row(s).");
  });

  it("explains a missing, failed or unconfigured table", () => {
    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [],
        criteriaFilter: tableFilter({ filterType: FilterType.EqualTo }),
      }),
    ).toBe("SNMP table ipsec_tunnels was not walked on this poll.");

    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [{ ...THREE_TUNNELS, failureCause: "timeout" }],
        criteriaFilter: tableFilter({ filterType: FilterType.EqualTo }),
      }),
    ).toBe("SNMP table IPsec Tunnels could not be walked: timeout");

    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [THREE_TUNNELS],
        criteriaFilter: {
          checkOn: CheckOn.SnmpTableValue,
          filterType: FilterType.EqualTo,
          value: 1,
        },
      }),
    ).toContain("No SNMP table is configured");
  });

  it("describes a trap's varbinds, or why there is nothing to describe", () => {
    expect(
      SnmpTableCriteria.describeTrapVarbindObservation({
        snmpTrap: undefined,
        criteriaFilter: tableFilter({ filterType: FilterType.EqualTo }),
      }),
    ).toBe("Only evaluated when an SNMP trap arrives from the device.");

    expect(
      SnmpTableCriteria.describeTrapVarbindObservation({
        snmpTrap: {
          sourceIpAddress: "10.0.0.1",
          trapOid: "1.3.6.1.6.3.1.1.5.3",
          snmpVersion: "2c",
          receivedAt: new Date(),
          varbinds: [{ oid: "1.3.6.1.2.1.2.2.1.1.3", value: "3" }],
        },
        criteriaFilter: tableFilter({ filterType: FilterType.EqualTo }),
      }),
    ).toBe(
      'SNMP trap 1.3.6.1.6.3.1.1.5.3 carried: 1.3.6.1.2.1.2.2.1.1.3 = "3".',
    );
  });
});

describe("SnmpMonitorCriteria routes the table and varbind checks", () => {
  function pollResponse(input: {
    tables?: Array<SnmpTableSnapshot> | undefined;
    walked?: boolean | undefined;
    trap?: SnmpTrap | undefined;
  }): ProbeMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      isOnline: true,
      monitoredAt: new Date(),
      ...(input.walked === false
        ? {}
        : {
            snmpResponse: {
              isOnline: true,
              responseTimeInMs: 10,
              failureCause: "",
              oidResponses: [],
              tables: input.tables,
            },
          }),
      ...(input.trap ? { snmpTrapResponse: input.trap } : {}),
    };
  }

  it("evaluates a table value on a poll", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({ tables: [THREE_TUNNELS] }),
        criteriaFilter: tableFilter({
          filterType: FilterType.NotEqualTo,
          value: 1,
        }),
      }),
    ).resolves.toContain("HQ-Branch2");
  });

  it("evaluates a table row count on a poll", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({ tables: [THREE_TUNNELS] }),
        criteriaFilter: tableFilter({
          checkOn: CheckOn.SnmpTableRowCount,
          filterType: FilterType.EqualTo,
          value: 3,
        }),
      }),
    ).resolves.toContain("has 3 row(s)");
  });

  it("does not evaluate table checks on a poll that ran no walk", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({ walked: false }),
        criteriaFilter: tableFilter({
          checkOn: CheckOn.SnmpTableRowCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      }),
    ).resolves.toBeNull();
  });

  it("evaluates trap varbinds only on trap events", async () => {
    const trap: SnmpTrap = {
      sourceIpAddress: "10.0.0.1",
      trapOid: SOPHOS_TRAP_OID,
      snmpVersion: "2c",
      receivedAt: new Date(),
      varbinds: [
        { oid: `${SOPHOS_TRAP_MESSAGE}.0`, value: "IPSec tunnel X is down" },
      ],
    };

    const filter: CriteriaFilter = {
      checkOn: CheckOn.SnmpTrapVarbindValue,
      filterType: FilterType.Contains,
      value: "is down",
    };

    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({ walked: false, trap: trap }),
        criteriaFilter: filter,
      }),
    ).resolves.toContain("is down");

    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({ tables: [THREE_TUNNELS] }),
        criteriaFilter: filter,
      }),
    ).resolves.toBeNull();
  });

  it("never lets a trap event evaluate a table check", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: pollResponse({
          tables: [THREE_TUNNELS],
          trap: {
            sourceIpAddress: "10.0.0.1",
            trapOid: SOPHOS_TRAP_OID,
            snmpVersion: "2c",
            receivedAt: new Date(),
            varbinds: [],
          },
        }),
        criteriaFilter: tableFilter({
          filterType: FilterType.NotEqualTo,
          value: 1,
        }),
      }),
    ).resolves.toBeNull();
  });
});

describe("SnmpTableCriteria.evaluateTableRowIsUnhealthy", () => {
  function evaluateUnhealthy(input: {
    tables: Array<SnmpTableSnapshot> | undefined;
    filterType: FilterType;
    row?: string | undefined;
  }): string | null {
    return SnmpTableCriteria.evaluateTableRowIsUnhealthy({
      tables: input.tables,
      criteriaFilter: {
        checkOn: CheckOn.SnmpTableRowIsUnhealthy,
        filterType: input.filterType,
        value: undefined,
        snmpMonitorOptions: {
          tableKey: "ipsec_tunnels",
          tableRow: input.row,
        },
      },
    });
  }

  it("names the rows outside their healthy values", () => {
    const result: string | null = evaluateUnhealthy({
      tables: [THREE_TUNNELS],
      filterType: FilterType.True,
    });

    expect(result).toBe(
      "2 unhealthy row(s) in SNMP table IPsec Tunnels: HQ-Branch2 (Status: inactive), HQ-Branch3 (Status: partially active).",
    );
  });

  it("is met by False only when every row is healthy", () => {
    expect(
      evaluateUnhealthy({
        tables: [THREE_TUNNELS],
        filterType: FilterType.False,
      }),
    ).toBeNull();

    expect(
      evaluateUnhealthy({
        tables: [tunnels([{ index: "1", name: "A", status: 1 }])],
        filterType: FilterType.False,
      }),
    ).toBe("Every row in SNMP table IPsec Tunnels is healthy.");

    expect(
      evaluateUnhealthy({
        tables: [tunnels([{ index: "1", name: "A", status: 1 }])],
        filterType: FilterType.True,
      }),
    ).toBeNull();
  });

  it("respects the row scope", () => {
    expect(
      evaluateUnhealthy({
        tables: [THREE_TUNNELS],
        filterType: FilterType.True,
        row: "HQ-Branch1",
      }),
    ).toBeNull();
    expect(
      evaluateUnhealthy({
        tables: [THREE_TUNNELS],
        filterType: FilterType.True,
        row: "HQ-Branch3",
      }),
    ).toContain("1 unhealthy row(s)");
  });

  it("is not evaluated for a table that declares no healthy values, has no rows in scope, or failed", () => {
    expect(
      SnmpTableCriteria.evaluateTableRowIsUnhealthy({
        tables: [radios()],
        criteriaFilter: {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { tableKey: "wifi_radios" },
        },
      }),
    ).toBeNull();

    expect(
      evaluateUnhealthy({
        tables: [THREE_TUNNELS],
        filterType: FilterType.False,
        row: "nope",
      }),
    ).toBeNull();

    expect(
      evaluateUnhealthy({
        tables: [{ ...THREE_TUNNELS, failureCause: "timeout" }],
        filterType: FilterType.False,
      }),
    ).toBeNull();
  });

  it("is routed by SnmpMonitorCriteria and fans out per row with '*'", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          monitorStepId: ObjectID.generate(),
          probeId: ObjectID.generate(),
          failureCause: "",
          isOnline: true,
          monitoredAt: new Date(),
          snmpResponse: {
            isOnline: true,
            responseTimeInMs: 1,
            failureCause: "",
            oidResponses: [],
            tables: [THREE_TUNNELS],
          },
        },
        criteriaFilter: {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { tableKey: "ipsec_tunnels", tableRow: "*" },
        },
      }),
    ).resolves.toContain("2 unhealthy row(s)");
  });

  it("describes the observation", () => {
    expect(
      SnmpTableCriteria.describeTableObservation({
        tables: [THREE_TUNNELS],
        criteriaFilter: {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { tableKey: "ipsec_tunnels" },
        },
      }),
    ).toBe(
      "SNMP table IPsec Tunnels had 3 row(s) in scope, 2 of them unhealthy.",
    );
  });
});
