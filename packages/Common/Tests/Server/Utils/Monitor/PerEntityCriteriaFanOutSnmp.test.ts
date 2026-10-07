jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import PerEntityCriteriaFanOut, {
  FanOutEntity,
} from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import {
  SnmpTableDefinition,
  SnmpTableSnapshot,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import { describe, expect, it } from "@jest/globals";

/*
 * Network Device monitors see many entities per poll - every port, and now
 * every row of every walked SNMP table. A criteria opts into one alert per
 * entity with "*". These tests drive the evaluator with the response shape
 * the poll pipeline actually produces (the walk under `snmpResponse`), which
 * is the shape the interface fan-out used to miss.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;

const IPSEC_TABLE: SnmpTableDefinition = {
  key: "ipsec_tunnels",
  name: "IPsec Tunnels",
  rowLabelColumnOids: [IPSEC_NAME],
  columns: [
    {
      oid: IPSEC_STATUS,
      name: "Status",
      valueLabels: { "0": "inactive", "1": "active" },
    },
  ],
};

function tunnels(
  rows: Array<{ index: string; name: string; status: number }>,
): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: [IPSEC_TABLE],
    results: [
      {
        key: "ipsec_tunnels",
        rows: rows.map(
          (row: { index: string; name: string; status: number }) => {
            return {
              index: row.index,
              values: { [IPSEC_NAME]: row.name, [IPSEC_STATUS]: row.status },
            };
          },
        ),
      },
    ],
  })[0]!;
}

function port(name: string, utilizationPercent: number): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: name,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: utilizationPercent,
  };
}

function devicePoll(input: {
  tables?: Array<SnmpTableSnapshot> | undefined;
  interfaces?: Array<SnmpInterface> | undefined;
}): DataToProcess {
  const response: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    monitoredAt: new Date("2026-10-07T10:00:00.000Z"),
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 12,
      failureCause: "",
      oidResponses: [],
      interfaces: input.interfaces,
      tables: input.tables,
    },
  };

  return response as DataToProcess;
}

function criteriaWith(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "criteria-tunnels",
    name: "Tunnel down",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: filters,
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function tunnelDownFilter(tableRow: string | undefined): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpTableValue,
    filterType: FilterType.NotEqualTo,
    value: "1",
    snmpMonitorOptions: {
      tableKey: "ipsec_tunnels",
      tableColumnOid: IPSEC_STATUS,
      tableRow: tableRow,
    },
  };
}

function deviceMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.name = "hq-firewall";
  return monitor;
}

type CollectPerSeriesMatches = (input: {
  dataToProcess: DataToProcess;
  monitor: Monitor;
  monitorStep: MonitorStep;
  criteriaInstance: MonitorCriteriaInstance;
}) => Promise<Array<PerSeriesCriteriaMatch>>;

const collectPerSeriesMatches: CollectPerSeriesMatches = (
  MonitorCriteriaEvaluator as unknown as {
    collectPerSeriesMatches: CollectPerSeriesMatches;
  }
).collectPerSeriesMatches.bind(MonitorCriteriaEvaluator);

async function collect(input: {
  filters: Array<CriteriaFilter>;
  dataToProcess: DataToProcess;
}): Promise<Array<PerSeriesCriteriaMatch>> {
  return collectPerSeriesMatches({
    dataToProcess: input.dataToProcess,
    monitor: deviceMonitor(),
    monitorStep: new MonitorStep(),
    criteriaInstance: criteriaWith(input.filters),
  });
}

describe("PerEntityCriteriaFanOut — SNMP table rows", () => {
  it("raises one match per breaching row, labelled with the table and the row", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [tunnelDownFilter("*")],
      dataToProcess: devicePoll({
        tables: [
          tunnels([
            { index: "1", name: "HQ-Branch1", status: 1 },
            { index: "2", name: "HQ-Branch2", status: 0 },
            { index: "3", name: "HQ-Branch3", status: 0 },
          ]),
        ],
      }),
    });

    expect(
      matches.map((match: PerSeriesCriteriaMatch) => {
        return match.labels;
      }),
    ).toEqual([
      {
        snmpTable: "IPsec Tunnels",
        snmpTableRow: "HQ-Branch2",
        snmpTableRowIndex: "2",
      },
      {
        snmpTable: "IPsec Tunnels",
        snmpTableRow: "HQ-Branch3",
        snmpTableRowIndex: "3",
      },
    ]);

    // Each row is its own series, so each alert resolves on its own.
    expect(matches[0]!.fingerprint).not.toBe(matches[1]!.fingerprint);
    expect(matches[0]!.rootCause).toContain("HQ-Branch2");
    expect(matches[0]!.rootCause).not.toContain("HQ-Branch3");
  });

  it("keeps two rows with the same name apart", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [tunnelDownFilter("*")],
      dataToProcess: devicePoll({
        tables: [
          tunnels([
            { index: "1", name: "Same", status: 0 },
            { index: "2", name: "Same", status: 0 },
          ]),
        ],
      }),
    });

    expect(matches).toHaveLength(2);
    expect(matches[0]!.fingerprint).not.toBe(matches[1]!.fingerprint);
  });

  it("does not fan out without the wildcard", async () => {
    const filters: Array<CriteriaFilter> = [tunnelDownFilter(undefined)];

    expect(
      PerEntityCriteriaFanOut.isSnmpTableFanOutConfigured(
        criteriaWith(filters),
      ),
    ).toBe(false);

    expect(
      PerEntityCriteriaFanOut.getSnmpTableRowEntities({
        criteriaInstance: criteriaWith(filters),
        dataToProcess: devicePoll({
          tables: [tunnels([{ index: "1", name: "A", status: 0 }])],
        }),
      }),
    ).toEqual([]);
  });

  it("has nothing to fan out over when the table failed or was not walked", () => {
    const failed: SnmpTableSnapshot = {
      ...tunnels([{ index: "1", name: "A", status: 0 }]),
      failureCause: "timeout",
    };

    for (const tables of [[failed], [], undefined]) {
      expect(
        PerEntityCriteriaFanOut.getSnmpTableRowEntities({
          criteriaInstance: criteriaWith([tunnelDownFilter("*")]),
          dataToProcess: devicePoll({ tables: tables }),
        }),
      ).toEqual([]);
    }
  });

  it("narrows only the wildcard filter of the matching table", () => {
    const otherTableFilter: CriteriaFilter = {
      ...tunnelDownFilter("*"),
      snmpMonitorOptions: {
        tableKey: "wifi_radios",
        tableColumnOid: "1.3.6.1.4.1.17713.22.1.2.1.8",
        tableRow: "*",
      },
    };

    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpTableRowEntities({
        criteriaInstance: criteriaWith([
          tunnelDownFilter("*"),
          otherTableFilter,
        ]),
        dataToProcess: devicePoll({
          tables: [tunnels([{ index: "7", name: "Tunnel7", status: 0 }])],
        }),
      });

    expect(entities).toHaveLength(1);

    const narrowedOwn: CriteriaFilter = entities[0]!.narrowFilter(
      tunnelDownFilter("*"),
    );
    expect(narrowedOwn.snmpMonitorOptions?.tableRow).toBe("Tunnel7");

    // Another table's wildcard is left for that table's own entities.
    expect(entities[0]!.narrowFilter(otherTableFilter)).toBe(otherTableFilter);

    // A filter that is not a table filter is untouched.
    const cpu: CriteriaFilter = {
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.GreaterThan,
      value: 90,
    };
    expect(entities[0]!.narrowFilter(cpu)).toBe(cpu);
  });

  it("is detected as per-entity configuration", () => {
    expect(
      PerEntityCriteriaFanOut.isSnmpTableFanOutConfigured(
        criteriaWith([tunnelDownFilter(" * ")]),
      ),
    ).toBe(true);
  });
});

describe("PerEntityCriteriaFanOut — SNMP interfaces on a real device poll", () => {
  /*
   * Regression: the interface list lives under `snmpResponse` on the
   * response the poll pipeline evaluates. Reading it from the top level
   * found nothing, so "*" never produced per-port alerts on a real poll.
   */
  it("fans out over the ports in snmpResponse", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [
        {
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          filterType: FilterType.GreaterThan,
          value: "80",
          snmpMonitorOptions: { interfaceName: "*" },
        },
      ],
      dataToProcess: devicePoll({
        interfaces: [port("Gi0/1", 95), port("Gi0/2", 10), port("Gi0/3", 88)],
      }),
    });

    expect(
      matches.map((match: PerSeriesCriteriaMatch) => {
        return match.labels["interfaceName"];
      }),
    ).toEqual(["Gi0/1", "Gi0/3"]);
  });

  it("still accepts a bare walk passed directly", () => {
    expect(
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: criteriaWith([
          {
            checkOn: CheckOn.SnmpInterfaceIsDown,
            filterType: FilterType.True,
            value: undefined,
            snmpMonitorOptions: { interfaceName: "*" },
          },
        ]),
        dataToProcess: {
          interfaces: [port("Gi0/9", 1)],
        } as unknown as DataToProcess,
      }).map((entity: FanOutEntity) => {
        return entity.labels["interfaceName"];
      }),
    ).toEqual(["Gi0/9"]);
  });

  it("fans out over ports and table rows in the same criteria", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [
        {
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          filterType: FilterType.GreaterThan,
          value: "80",
          snmpMonitorOptions: { interfaceName: "*" },
        },
      ],
      dataToProcess: devicePoll({
        interfaces: [port("Gi0/1", 95)],
        tables: [tunnels([{ index: "1", name: "T1", status: 0 }])],
      }),
    });

    // Only the port filter is wildcarded, so only ports fan out.
    expect(matches).toHaveLength(1);
    expect(matches[0]!.labels["interfaceName"]).toBe("Gi0/1");
  });
});
