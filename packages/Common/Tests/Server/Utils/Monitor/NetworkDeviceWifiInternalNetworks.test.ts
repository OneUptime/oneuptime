import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import SnmpTableCriteria from "../../../../Server/Utils/Monitor/Criteria/SnmpTableCriteria";
import SnmpTableMetricUtil, {
  SnmpTablePoint,
} from "../../../../Server/Utils/Monitor/SnmpTableMetricUtil";
import SnmpTableTemplateUtil from "../../../../Server/Utils/Monitor/SnmpTableTemplateUtil";
import NetworkDeviceOidTemplateService from "../../../../Server/Services/NetworkDeviceOidTemplateService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../../Types/JSON";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  SNMP_TABLE_ROW_ATTRIBUTE,
  SnmpTableColumn,
  SnmpTableDefinition,
  SnmpTableFailureReason,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableResultRow,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../../Types/ObjectID";
import ProbeCapability from "../../../../Types/Probe/ProbeCapability";
import WifiRadioUtil, {
  WifiSsidView,
  WifiSummary,
} from "../../../../Utils/NetworkDevice/WifiRadioUtil";
import logger from "../../../../Server/Utils/Logger";

/*
 * Issue #4730 on the server: a UniFi access point that broadcasts one SSID
 * (DEMO, on 2.4 and 5 GHz) and whose VAP table also holds UniFi's device
 * adoption network on both bands and its wireless mesh link on 5 GHz. The
 * device was set up before the fix: its copy of the template's SSID table
 * walks no interface column, and its stored snapshot holds all five VAPs.
 *
 * What the next walk does: the criteria, the metrics and the templates read
 * DEMO's two rows, and the device stores them in place of the five. A walk
 * that fails, or a probe that does not walk tables, keeps the stored rows -
 * the two of them that are SSIDs, counting the three it leaves out - so the
 * stored column itself is clean after the next poll, walked or not.
 */

const DEVICE_ID: ObjectID = new ObjectID(
  "8f2c1f0e-0000-4000-8000-000000004730",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222224730",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444730",
);
const STORED_AT: Date = new Date("2026-10-12T09:00:00.000Z");
const MONITORED_AT: Date = new Date("2026-10-13T09:00:00.000Z");

const UNIFI_RADIO: string = "1.3.6.1.4.1.41112.1.6.1.1.1";
const UNIFI_VAP: string = "1.3.6.1.4.1.41112.1.6.1.2.1";

const ADOPTION_ESSID: string = "element-b85e2c71d09f3a64";
const MESH_LINK_ESSID: string = "vwire-3f61da08c27e95b4";

function unifiTable(key: string): SnmpTableDefinition {
  const table: SnmpTableDefinition | undefined = SnmpVendorTemplateUtil.getById(
    "ubiquiti-unifi-ap",
  )?.tables?.find((candidate: SnmpTableDefinition): boolean => {
    return candidate.key === key;
  });

  expect(table).toBeDefined();
  return table!;
}

// The template's tables as the device copied them before the fix.
function tablesCopiedBefore4730(): Array<SnmpTableDefinition> {
  const ssids: SnmpTableDefinition = unifiTable("wifi_ssids");

  return [
    unifiTable("wifi_radios"),
    {
      ...ssids,
      columns: ssids.columns.filter((column: SnmpTableColumn): boolean => {
        return column.oid !== `${UNIFI_VAP}.7`;
      }),
    },
  ];
}

function vap(
  index: string,
  essid: string,
  radio: "ng" | "na",
  usage: string = "user",
  withInterface?: string | undefined,
): SnmpTableResultRow {
  return {
    index: index,
    values: {
      [`${UNIFI_VAP}.6`]: essid,
      [`${UNIFI_VAP}.9`]: radio,
      [`${UNIFI_VAP}.4`]: radio === "ng" ? 6 : 149,
      [`${UNIFI_VAP}.8`]: 0,
      [`${UNIFI_VAP}.21`]: 20,
      [`${UNIFI_VAP}.3`]: 1000,
      [`${UNIFI_VAP}.22`]: 1,
      [`${UNIFI_VAP}.23`]: usage,
      ...(withInterface ? { [`${UNIFI_VAP}.7`]: withInterface } : {}),
    },
  };
}

// What the access point answers, in its VAP table's order.
function accessPointWalk(
  withInterfaces: boolean = false,
): Array<SnmpTableResult> {
  const name: (value: string) => string | undefined = (
    value: string,
  ): string | undefined => {
    return withInterfaces ? value : undefined;
  };

  return [
    {
      key: "wifi_radios",
      rows: [
        {
          index: "1",
          values: {
            [`${UNIFI_RADIO}.3`]: "ng",
            [`${UNIFI_RADIO}.2`]: "wifi0",
            [`${UNIFI_RADIO}.6`]: 22,
          },
        },
        {
          index: "2",
          values: {
            [`${UNIFI_RADIO}.3`]: "na",
            [`${UNIFI_RADIO}.2`]: "wifi1",
            [`${UNIFI_RADIO}.6`]: 7,
          },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        vap("1", ADOPTION_ESSID, "ng", "user", name("ath0")),
        vap("2", "DEMO", "ng", "user", name("ath1")),
        vap("3", ADOPTION_ESSID, "na", "user", name("ath2")),
        vap("4", MESH_LINK_ESSID, "na", "downlink", name("vwire3")),
        vap("5", "DEMO", "na", "user", name("ath4")),
      ],
    },
  ];
}

/*
 * The snapshot a walk stored before the fix: every VAP, under the SSID
 * kind - what materialize kept for a table that leaves no row out.
 */
function snapshotStoredBefore4730(): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: tablesCopiedBefore4730().map(
      (table: SnmpTableDefinition): SnmpTableDefinition => {
        return { ...table, kind: SnmpTableKind.Generic };
      },
    ),
    results: accessPointWalk(),
    collectedAt: STORED_AT,
  }).map((snapshot: SnmpTableSnapshot): SnmpTableSnapshot => {
    return {
      ...snapshot,
      kind:
        snapshot.key === "wifi_ssids"
          ? SnmpTableKind.WifiSsid
          : SnmpTableKind.WifiRadio,
    };
  });
}

function walk(
  overrides: Partial<SnmpMonitorResponse> = {},
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 20,
    failureCause: "",
    oidResponses: [],
    ...overrides,
  };
}

function device(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const networkDevice: NetworkDevice = new NetworkDevice();
  networkDevice.id = DEVICE_ID;
  networkDevice.projectId = PROJECT_ID;
  networkDevice.name = "UAP-AC-Lite";
  networkDevice.snmpTables = tablesCopiedBefore4730();
  networkDevice.snmpTableSnapshot = snapshotStoredBefore4730();
  Object.assign(networkDevice, overrides);
  return networkDevice;
}

function ssidsOf(
  snapshots: Array<SnmpTableSnapshot> | undefined,
): SnmpTableSnapshot {
  const ssids: SnmpTableSnapshot | undefined = (snapshots || []).find(
    (snapshot: SnmpTableSnapshot): boolean => {
      return snapshot.key === "wifi_ssids";
    },
  );

  expect(ssids).toBeDefined();
  return ssids!;
}

function labelsOf(snapshot: SnmpTableSnapshot): Array<string> {
  return snapshot.rows.map((row: SnmpTableSnapshotRow): string => {
    return row.label;
  });
}

function wifiTabSsids(snapshots: Array<SnmpTableSnapshot>): Array<string> {
  const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

  return summary.ssids.map((ssid: WifiSsidView): string => {
    return `${ssid.ssid}|${ssid.band}`;
  });
}

function rowCountFilter(filterType: FilterType, value: number): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpTableRowCount,
    filterType: filterType,
    value: value,
    snmpMonitorOptions: { tableKey: "wifi_ssids" },
  };
}

const DEMO_ROWS: Array<string> = ["DEMO / 2.4 GHz", "DEMO / 5 GHz"];

let templateFindSpy: jest.SpyInstance;

beforeEach(() => {
  templateFindSpy = jest
    .spyOn(NetworkDeviceOidTemplateService, "findOneBy")
    .mockResolvedValue(null);
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the issue #4730 access point's stored snapshot, before its next walk", () => {
  test("holds all five VAPs, as the walks before the fix stored them", () => {
    expect(labelsOf(ssidsOf(snapshotStoredBefore4730()))).toEqual([
      `${ADOPTION_ESSID} / 2.4 GHz`,
      "DEMO / 2.4 GHz",
      `${ADOPTION_ESSID} / 5 GHz`,
      `${MESH_LINK_ESSID} / 5 GHz`,
      "DEMO / 5 GHz",
    ]);
  });

  test("shows DEMO on two bands in the Wi-Fi tab already", () => {
    expect(wifiTabSsids(snapshotStoredBefore4730())).toEqual([
      "DEMO|2.4 GHz",
      "DEMO|5 GHz",
    ]);
  });
});

describe("the issue #4730 access point's next walk", () => {
  test("stores DEMO's two rows in place of the five", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(),
    });

    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: snmpResponse,
        probeCapabilities: [ProbeCapability.SnmpTables],
        monitoredAt: MONITORED_AT,
      });

    expect(labelsOf(ssidsOf(stored))).toEqual(DEMO_ROWS);
    expect(ssidsOf(stored).collectedAt).toBe(MONITORED_AT.toISOString());
    expect(wifiTabSsids(stored!)).toEqual(["DEMO|2.4 GHz", "DEMO|5 GHz"]);
    expect(templateFindSpy).not.toHaveBeenCalled();
  });

  test("gives the criteria DEMO's two rows: an SNMP Table Row Count reads 2", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(),
    });

    await NetworkDeviceWalkUtil.applyTableDefinitions({
      device: device(),
      snmpResponse: snmpResponse,
      monitoredAt: MONITORED_AT,
    });

    expect(labelsOf(ssidsOf(snmpResponse.tables))).toEqual(DEMO_ROWS);

    const met: string | null = SnmpTableCriteria.evaluateTableRowCount({
      tables: snmpResponse.tables,
      criteriaFilter: rowCountFilter(FilterType.EqualTo, 2),
    });

    expect(met).not.toBeNull();
    expect(met).toContain("SNMP table SSIDs has 2 row(s)");

    // An alert for "more than two SSIDs" does not fire on UniFi's own networks.
    expect(
      SnmpTableCriteria.evaluateTableRowCount({
        tables: snmpResponse.tables,
        criteriaFilter: rowCountFilter(FilterType.GreaterThan, 2),
      }),
    ).toBeNull();
  });

  test("writes no metric series for UniFi's own networks", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(),
    });

    await NetworkDeviceWalkUtil.applyTableDefinitions({
      device: device(),
      snmpResponse: snmpResponse,
      monitoredAt: MONITORED_AT,
    });

    const ssidRows: Array<string> = SnmpTableMetricUtil.getPoints(
      snmpResponse.tables,
    )
      .filter((point: SnmpTablePoint): boolean => {
        return point.attributes["snmpTableKey"] === "wifi_ssids";
      })
      .map((point: SnmpTablePoint): string => {
        return String(point.attributes[SNMP_TABLE_ROW_ATTRIBUTE]);
      });

    expect(ssidRows.length).toBeGreaterThan(0);
    expect(Array.from(new Set(ssidRows))).toEqual(DEMO_ROWS);
  });

  test("gives a template DEMO's two rows: {{tables.wifi_ssids.rowCount}} is 2", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(),
    });

    await NetworkDeviceWalkUtil.applyTableDefinitions({
      device: device(),
      snmpResponse: snmpResponse,
      monitoredAt: MONITORED_AT,
    });

    const variables: JSONObject = SnmpTableTemplateUtil.toTemplateVariables(
      snmpResponse.tables!,
    );
    const ssids: JSONObject = variables["wifi_ssids"] as JSONObject;

    expect(ssids["rowCount"]).toBe(2);
    expect(
      (ssids["rows"] as Array<JSONObject>).map((row: JSONObject): unknown => {
        return row["name"];
      }),
    ).toEqual(DEMO_ROWS);
  });

  test("reads an OID Collection Template made from the vendor's tables the same way", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
      TEMPLATE_ID,
    );
    template.tables = tablesCopiedBefore4730();
    templateFindSpy.mockResolvedValue(template);

    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(),
    });

    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [], oidTemplateId: TEMPLATE_ID }),
        snmpResponse: snmpResponse,
        monitoredAt: MONITORED_AT,
      });

    expect(templateFindSpy).toHaveBeenCalledTimes(1);
    expect(labelsOf(ssidsOf(snmpResponse.tables))).toEqual(DEMO_ROWS);
    expect(labelsOf(ssidsOf(stored))).toEqual(DEMO_ROWS);
  });

  test("walks each SSID's interface on a device set up from today's template", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: accessPointWalk(true),
    });

    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [unifiTable("wifi_radios"), unifiTable("wifi_ssids")],
          snmpTableSnapshot: [],
        }),
        snmpResponse: snmpResponse,
        monitoredAt: MONITORED_AT,
      });

    const ssids: SnmpTableSnapshot = ssidsOf(stored);

    expect(labelsOf(ssids)).toEqual(DEMO_ROWS);
    expect(
      ssids.rows.map((row: SnmpTableSnapshotRow): string => {
        return row.cells[`${UNIFI_VAP}.7`]!.display;
      }),
    ).toEqual(["ath1", "ath4"]);
  });
});

describe("a walk of the issue #4730 access point that reads no SSIDs", () => {
  test("a failed walk keeps the stored SSIDs, marked: DEMO's two rows, with the three UniFi networks counted as left out", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [
        accessPointWalk()[0]!,
        { key: "wifi_ssids", rows: [], failureCause: "Request timed out" },
      ],
    });

    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: snmpResponse,
        monitoredAt: MONITORED_AT,
      });

    // The criteria judge this walk: no rows, and why.
    expect(ssidsOf(snmpResponse.tables).rows).toEqual([]);
    expect(
      SnmpTableCriteria.evaluateTableRowCount({
        tables: snmpResponse.tables,
        criteriaFilter: rowCountFilter(FilterType.LessThan, 2),
      }),
    ).toBeNull();

    /*
     * The stored view keeps its last rows until a walk succeeds - the ones a
     * walk keeps now: the five stored before the fix are DEMO's two, and the
     * three UniFi runs for itself are counted, not kept, for every reader of
     * the column (the REST API included), not only the views that read it.
     */
    expect(labelsOf(ssidsOf(stored))).toEqual(DEMO_ROWS);
    expect(ssidsOf(stored).leftOutRowCount).toBe(3);
    expect(ssidsOf(stored).failureCause).toBe("Request timed out");
    expect(ssidsOf(stored).collectedAt).toBe(
      ssidsOf(device().snmpTableSnapshot).collectedAt,
    );
    expect(wifiTabSsids(stored!)).toEqual(["DEMO|2.4 GHz", "DEMO|5 GHz"]);
  });

  test("a probe from before SNMP tables keeps the stored SSIDs too: DEMO's two rows, the three UniFi networks counted as left out", async () => {
    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      });

    expect(labelsOf(ssidsOf(stored))).toEqual(DEMO_ROWS);
    expect(ssidsOf(stored).leftOutRowCount).toBe(3);
    expect(ssidsOf(stored).failureReason).toBe(
      SnmpTableFailureReason.ProbeDidNotWalkTables,
    );
    expect(wifiTabSsids(stored!)).toEqual(["DEMO|2.4 GHz", "DEMO|5 GHz"]);
  });

  test("a failed walk of a device stored after the fix keeps what it stored, and its count", async () => {
    // The next walk, after the fix: DEMO's two rows and the three counted.
    const walked: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: walk({ tableResults: accessPointWalk() }),
        monitoredAt: MONITORED_AT,
      });

    expect(labelsOf(ssidsOf(walked))).toEqual(DEMO_ROWS);
    expect(ssidsOf(walked).leftOutRowCount).toBe(3);

    // A walk that then fails keeps them as they are: nothing counted twice.
    const stored: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTableSnapshot: walked || [] }),
        snmpResponse: walk({
          tableResults: [
            accessPointWalk()[0]!,
            { key: "wifi_ssids", rows: [], failureCause: "Request timed out" },
          ],
        }),
        monitoredAt: MONITORED_AT,
      });

    expect(labelsOf(ssidsOf(stored))).toEqual(DEMO_ROWS);
    expect(ssidsOf(stored).leftOutRowCount).toBe(3);
    expect(ssidsOf(stored).failureCause).toBe("Request timed out");
  });
});
