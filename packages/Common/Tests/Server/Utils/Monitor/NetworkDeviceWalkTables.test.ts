import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "../../../../Server/Services/NetworkDeviceOidTemplateService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpDataType from "../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import {
  PROBE_DID_NOT_WALK_TABLES_CAUSE,
  SnmpTableDefinition,
  SnmpTableFailureReason,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableSnapshot,
  SnmpTableSnapshotColumn,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../../Types/ObjectID";
import ProbeCapability from "../../../../Types/Probe/ProbeCapability";
import WifiRadioUtil, {
  WifiTablesState,
} from "../../../../Utils/NetworkDevice/WifiRadioUtil";
import logger from "../../../../Server/Utils/Logger";

/*
 * The ingest half of SNMP tables: the probe reports raw values per row index
 * and column OID, and the walk processor joins them back to the device's
 * effective definitions (template first, device-specific over it) before
 * anything else reads the response, then hands the inventory the snapshot to
 * store - merged so a table that failed this walk keeps its last good rows.
 */

const DEVICE_ID: ObjectID = new ObjectID(
  "8f2c1f0e-0000-4000-8000-0000000000aa",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITORED_AT: Date = new Date("2026-10-07T10:00:00.000Z");

const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;
const FAN_STATUS: string = "1.3.6.1.4.1.2604.5.1.9.3.1.3";

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

const FAN_TABLE: SnmpTableDefinition = {
  key: "fans",
  name: "Fans",
  columns: [{ oid: FAN_STATUS, name: "Status" }],
};

function ipsecResult(status: number): SnmpTableResult {
  return {
    key: "ipsec_tunnels",
    rows: [
      {
        index: "1",
        values: { [IPSEC_NAME]: "HQ-Branch1", [IPSEC_STATUS]: status },
      },
    ],
  };
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
  networkDevice.name = "hq-firewall";
  Object.assign(networkDevice, overrides);
  return networkDevice;
}

function storedSnapshot(status: number): SnmpTableSnapshot {
  return {
    key: "ipsec_tunnels",
    name: "IPsec Tunnels",
    kind: "Generic" as SnmpTableSnapshot["kind"],
    columns: [{ oid: IPSEC_STATUS, name: "Status" }],
    rows: [
      {
        index: "1",
        label: "HQ-Branch1",
        cells: {
          [IPSEC_STATUS]: {
            raw: status,
            display: String(status),
            numeric: status,
          },
        },
      },
    ],
  };
}

let templateFindSpy: jest.SpyInstance;

describe("NetworkDeviceWalkUtil.applyTableDefinitions", () => {
  beforeEach(() => {
    templateFindSpy = jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneBy")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("leaves the snapshot alone when no walk ran or the walk failed", async () => {
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: undefined,
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: walk({
          isOnline: false,
          tableResults: [ipsecResult(1)],
        }),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(templateFindSpy).not.toHaveBeenCalled();
  });

  test("costs no query for a device with no tables at all", async () => {
    // A probe that walks tables, handed none.
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ oidTemplateId: TEMPLATE_ID }),
        snmpResponse: walk(),
        probeCapabilities: [ProbeCapability.SnmpTables],
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    // A device that cannot have tables, whatever the probe.
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(templateFindSpy).not.toHaveBeenCalled();
  });

  test("reads the template once to tell whether a probe that does not walk tables skipped any", async () => {
    // A template with no tables: nothing was skipped, nothing to store.
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ oidTemplateId: TEMPLATE_ID }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(templateFindSpy).toHaveBeenCalledTimes(1);

    // A template with tables: they were skipped.
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
      TEMPLATE_ID,
    );
    template.tables = [IPSEC_TABLE];
    templateFindSpy.mockResolvedValue(template);

    const snapshot: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ oidTemplateId: TEMPLATE_ID }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      });

    expect(templateFindSpy).toHaveBeenCalledTimes(2);
    expect(snapshot![0]!.key).toBe("ipsec_tunnels");
    expect(snapshot![0]!.failureReason).toBe(
      SnmpTableFailureReason.ProbeDidNotWalkTables,
    );
  });

  test("materializes device-specific tables onto the response and returns the snapshot to store", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [ipsecResult(0)],
    });

    const snapshot: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: snmpResponse,
        monitoredAt: MONITORED_AT,
      });

    expect(snmpResponse.tables).toHaveLength(1);
    expect(snmpResponse.tables![0]!.rows[0]!.label).toBe("HQ-Branch1");
    expect(snmpResponse.tables![0]!.rows[0]!.cells[IPSEC_STATUS]!.display).toBe(
      "inactive",
    );
    expect(snapshot).toEqual(snmpResponse.tables);
    expect(snapshot![0]!.collectedAt).toBe(MONITORED_AT.toISOString());
  });

  test("reads the template's tables within the device's own project", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
      TEMPLATE_ID,
    );
    template.tables = [IPSEC_TABLE];
    templateFindSpy.mockResolvedValue(template);

    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [ipsecResult(1)],
    });

    await NetworkDeviceWalkUtil.applyTableDefinitions({
      device: device({ oidTemplateId: TEMPLATE_ID }),
      snmpResponse: snmpResponse,
      monitoredAt: MONITORED_AT,
    });

    expect(templateFindSpy).toHaveBeenCalledTimes(1);
    const query: { _id: ObjectID; projectId: ObjectID } = (
      templateFindSpy.mock.calls[0]![0] as {
        query: { _id: ObjectID; projectId: ObjectID };
      }
    ).query;
    expect(query._id.toString()).toBe(TEMPLATE_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(snmpResponse.tables![0]!.rows[0]!.cells[IPSEC_STATUS]!.display).toBe(
      "active",
    );
  });

  test("a device table overrides the template table with the same key", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
      TEMPLATE_ID,
    );
    template.tables = [IPSEC_TABLE, FAN_TABLE];
    templateFindSpy.mockResolvedValue(template);

    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [ipsecResult(1)],
    });

    await NetworkDeviceWalkUtil.applyTableDefinitions({
      device: device({
        oidTemplateId: TEMPLATE_ID,
        snmpTables: [{ ...IPSEC_TABLE, name: "My Tunnels" }],
      }),
      snmpResponse: snmpResponse,
      monitoredAt: MONITORED_AT,
    });

    expect(snmpResponse.tables![0]!.name).toBe("My Tunnels");
  });

  test("keeps the last good rows of a table whose walk failed, but judges this walk", async () => {
    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [
        { key: "ipsec_tunnels", rows: [], failureCause: "Request timed out" },
      ],
    });

    const snapshot: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: [storedSnapshot(1)],
        }),
        snmpResponse: snmpResponse,
        monitoredAt: MONITORED_AT,
      });

    // Criteria see the failure ...
    expect(snmpResponse.tables![0]!.rows).toEqual([]);
    expect(snmpResponse.tables![0]!.failureCause).toBe("Request timed out");
    // ... while the stored view keeps its rows, marked with the cause.
    expect(snapshot![0]!.rows).toHaveLength(1);
    expect(snapshot![0]!.failureCause).toBe("Request timed out");
  });

  test("clears the stored rows once every table is removed", async () => {
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTableSnapshot: [storedSnapshot(1)] }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toEqual([]);
  });

  test("leaves the stored rows alone when a probe that walks tables was handed none", async () => {
    // The tables were added after the probe claimed this poll.
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: [storedSnapshot(1)],
        }),
        snmpResponse: walk(),
        probeCapabilities: [
          ProbeCapability.NetworkDevicePing,
          ProbeCapability.SnmpTables,
        ],
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: walk(),
        probeCapabilities: [ProbeCapability.SnmpTables],
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * A probe from before SNMP tables (14.0.18) walks a device's OIDs and
 * interfaces and ignores the tables its poll config lists - on every poll.
 * The customer's Cambium access point showed CPU, memory and clients, and a
 * Wi-Fi tab that promised radios "after its next successful SNMP poll"
 * forever: the snapshot was left alone because no tables came back. Now the
 * tables are stored as not walked, with why, so the views can say to
 * update the probe.
 */
describe("NetworkDeviceWalkUtil.applyTableDefinitions with a probe that does not walk tables", () => {
  const CAMBIUM_TABLES: Array<SnmpTableDefinition> =
    SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!.tables!;

  beforeEach(() => {
    templateFindSpy = jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneBy")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["declares no capabilities at all", undefined],
    ["declares an empty list", []],
    ["declares only ping-first polling", [ProbeCapability.NetworkDevicePing]],
  ])(
    "stores every defined table as not walked when the probe %s",
    async (_label: string, probeCapabilities: Array<string> | undefined) => {
      const snmpResponse: SnmpMonitorResponse = walk();

      const snapshot: Array<SnmpTableSnapshot> | undefined =
        await NetworkDeviceWalkUtil.applyTableDefinitions({
          device: device({ snmpTables: [IPSEC_TABLE, FAN_TABLE] }),
          snmpResponse: snmpResponse,
          probeCapabilities: probeCapabilities,
          monitoredAt: MONITORED_AT,
        });

      expect(
        snapshot!.map((table: SnmpTableSnapshot) => {
          return table.key;
        }),
      ).toEqual(["ipsec_tunnels", "fans"]);

      for (const table of snapshot!) {
        expect(table.rows).toEqual([]);
        expect(table.failureCause).toBe(PROBE_DID_NOT_WALK_TABLES_CAUSE);
        expect(table.failureReason).toBe(
          SnmpTableFailureReason.ProbeDidNotWalkTables,
        );
        // Nothing was collected, so there is no collection time to show.
        expect(table.collectedAt).toBeUndefined();
      }

      // Named and described from the definition, so the views can list it.
      expect(snapshot![0]!.name).toBe("IPsec Tunnels");
      expect(
        snapshot![0]!.columns.map((column: SnmpTableSnapshotColumn) => {
          return column.oid;
        }),
      ).toEqual([IPSEC_STATUS]);

      // Criteria judge what this walk read: still nothing.
      expect(snmpResponse.tables).toBeUndefined();
    },
  );

  test("the stored cause says what to do, and names the first probe version that walks tables", () => {
    expect(PROBE_DID_NOT_WALK_TABLES_CAUSE).toContain("14.0.18");
    expect(PROBE_DID_NOT_WALK_TABLES_CAUSE).toContain("update the probe");
  });

  test("keeps the rows an earlier walk stored, marked with the reason", async () => {
    const snapshot: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: [
            { ...storedSnapshot(1), collectedAt: "2026-10-06T09:00:00.000Z" },
          ],
        }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      });

    expect(snapshot).toHaveLength(1);
    expect(snapshot![0]!.rows).toEqual(storedSnapshot(1).rows);
    // When those rows were really collected.
    expect(snapshot![0]!.collectedAt).toBe("2026-10-06T09:00:00.000Z");
    expect(snapshot![0]!.failureReason).toBe(
      SnmpTableFailureReason.ProbeDidNotWalkTables,
    );
    expect(snapshot![0]!.failureCause).toBe(PROBE_DID_NOT_WALK_TABLES_CAUSE);
  });

  test("polls by the same probe store the same thing, however many there are", async () => {
    let stored: Array<SnmpTableSnapshot> | undefined = undefined;

    const results: Array<Array<SnmpTableSnapshot> | undefined> = [];

    for (let poll: number = 0; poll < 3; poll++) {
      stored = await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          ...(stored ? { snmpTableSnapshot: stored } : {}),
        }),
        snmpResponse: walk(),
        monitoredAt: new Date(MONITORED_AT.getTime() + poll * 300000),
      });
      results.push(stored);
    }

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  test("an updated probe's walk replaces the not-walked tables completely", async () => {
    const notWalked: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      });

    const snmpResponse: SnmpMonitorResponse = walk({
      tableResults: [ipsecResult(1)],
    });

    const walked: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: notWalked!,
        }),
        snmpResponse: snmpResponse,
        probeCapabilities: [ProbeCapability.SnmpTables],
        monitoredAt: MONITORED_AT,
      });

    expect(walked![0]!.rows[0]!.cells[IPSEC_STATUS]!.display).toBe("active");
    expect(walked![0]!.failureCause).toBeUndefined();
    expect(walked![0]!.failureReason).toBeUndefined();
    expect(walked![0]!.collectedAt).toBe(MONITORED_AT.toISOString());
  });

  test("a walk that then fails says why it failed, not that the probe cannot walk", async () => {
    const notWalked: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: [storedSnapshot(1)],
        }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      });

    const failed: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: notWalked!,
        }),
        snmpResponse: walk({
          tableResults: [
            {
              key: "ipsec_tunnels",
              rows: [],
              failureCause: "Request timed out",
            },
          ],
        }),
        probeCapabilities: [ProbeCapability.SnmpTables],
        monitoredAt: MONITORED_AT,
      });

    expect(failed![0]!.rows).toEqual(storedSnapshot(1).rows);
    expect(failed![0]!.failureCause).toBe("Request timed out");
    expect(failed![0]!.failureReason).toBeUndefined();
  });

  test("a failed walk or no walk at all still leaves the snapshot alone", async () => {
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: walk({ isOnline: false }),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: [IPSEC_TABLE] }),
        snmpResponse: undefined,
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();
  });

  test("a device with no tables costs nothing, whatever the probe", async () => {
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device(),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(templateFindSpy).not.toHaveBeenCalled();
  });

  /*
   * The customer's case, from the poll to what the Wi-Fi tab decides: a
   * Cambium access point with the Enterprise Wi-Fi template's tables,
   * polled by a probe that does not walk them.
   */
  test("a Cambium access point polled by such a probe: the Wi-Fi tab is told to ask for a probe update", async () => {
    const snapshot: Array<SnmpTableSnapshot> | undefined =
      await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ snmpTables: CAMBIUM_TABLES }),
        snmpResponse: walk({
          oidResponses: [
            {
              oid: "1.3.6.1.4.1.17713.22.1.1.1.6.0",
              name: "CPU %",
              value: 53,
              type: SnmpDataType.Integer,
            },
          ],
        }),
        probeCapabilities: [ProbeCapability.NetworkDevicePing],
        monitoredAt: MONITORED_AT,
      });

    expect(
      snapshot!.map((table: SnmpTableSnapshot) => {
        return table.kind;
      }),
    ).toEqual([SnmpTableKind.WifiRadio, SnmpTableKind.WifiSsid]);

    // Before: no Wi-Fi table stored, so the tab waited for a poll forever.
    expect(WifiRadioUtil.hasWifiTables(snapshot)).toBe(true);
    expect(
      WifiRadioUtil.getTablesState(WifiRadioUtil.getSummary(snapshot)),
    ).toBe(WifiTablesState.NotWalkedByProbe);
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult with tables", () => {
  let inventorySpy: jest.SpyInstance;
  let metricsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(device({ snmpTables: [IPSEC_TABLE] }));
    jest
      .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
    inventorySpy = jest
      .spyOn(NetworkInventoryUtil, "updateFromWalk")
      .mockResolvedValue(undefined);
    metricsSpy = jest
      .spyOn(NetworkDeviceMetricUtil, "saveWalkMetrics")
      .mockResolvedValue(undefined);
    templateFindSpy = jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneBy")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("selects the columns needed to resolve tables", async () => {
    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      snmpResponse: walk({ tableResults: [ipsecResult(1)] }),
      monitoredAt: MONITORED_AT,
    });

    const select: Record<string, boolean> = (
      (NetworkDeviceService.findOneBy as unknown as jest.Mock).mock
        .calls[0]![0] as { select: Record<string, boolean> }
    ).select;

    expect(select["snmpTables"]).toBe(true);
    expect(select["oidTemplateId"]).toBe(true);
    expect(select["snmpTableSnapshot"]).toBe(true);
  });

  test("hands the inventory the snapshot and the metrics the materialized tables", async () => {
    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      snmpResponse: walk({ tableResults: [ipsecResult(0)] }),
      monitoredAt: MONITORED_AT,
    });

    const inventoryArgs: {
      snmpTableSnapshot: Array<SnmpTableSnapshot>;
    } = inventorySpy.mock.calls[0]![0] as {
      snmpTableSnapshot: Array<SnmpTableSnapshot>;
    };
    expect(inventoryArgs.snmpTableSnapshot[0]!.rows[0]!.label).toBe(
      "HQ-Branch1",
    );

    const metricArgs: { snmpResponse: SnmpMonitorResponse } = metricsSpy.mock
      .calls[0]![0] as { snmpResponse: SnmpMonitorResponse };
    expect(metricArgs.snmpResponse.tables![0]!.key).toBe("ipsec_tunnels");
  });

  test("tells the tables apart by what the probe declared", async () => {
    // A probe that walks tables, handed none: the snapshot is left alone.
    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      snmpResponse: walk(),
      probeCapabilities: [ProbeCapability.SnmpTables],
      monitoredAt: MONITORED_AT,
    });

    expect(
      (inventorySpy.mock.calls[0]![0] as { snmpTableSnapshot: unknown })
        .snmpTableSnapshot,
    ).toBeUndefined();

    // A probe that does not: the tables are stored as not walked.
    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      snmpResponse: walk(),
      monitoredAt: MONITORED_AT,
    });

    const stored: Array<SnmpTableSnapshot> = (
      inventorySpy.mock.calls[1]![0] as {
        snmpTableSnapshot: Array<SnmpTableSnapshot>;
      }
    ).snmpTableSnapshot;

    expect(stored).toHaveLength(1);
    expect(stored[0]!.failureReason).toBe(
      SnmpTableFailureReason.ProbeDidNotWalkTables,
    );

    // The metrics and criteria see no tables either way.
    for (const call of metricsSpy.mock.calls) {
      expect(
        (call[0] as { snmpResponse: SnmpMonitorResponse }).snmpResponse.tables,
      ).toBeUndefined();
    }
  });

  test("a table lookup failure is logged and never stops the poll", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(
        device({ oidTemplateId: TEMPLATE_ID, snmpTables: [IPSEC_TABLE] }),
      );
    templateFindSpy.mockRejectedValue(new Error("db down"));
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      snmpResponse: walk({ tableResults: [ipsecResult(0)] }),
      monitoredAt: MONITORED_AT,
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(inventorySpy).toHaveBeenCalledTimes(1);
    expect(
      (inventorySpy.mock.calls[0]![0] as { snmpTableSnapshot: unknown })
        .snmpTableSnapshot,
    ).toBeUndefined();
    expect(metricsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("NetworkInventoryUtil.updateFromWalk stores the table snapshot", () => {
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue(device());
    updateSpy = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function writtenColumns(): Record<string, unknown> {
    return (updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> })
      .data;
  }

  test("writes the snapshot it is given", async () => {
    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      snmpResponse: walk(),
      isOnline: true,
      pollMode: "snmp",
      snmpTableSnapshot: [storedSnapshot(1)],
    });

    expect(writtenColumns()["snmpTableSnapshot"]).toEqual([storedSnapshot(1)]);
  });

  test("writes an empty snapshot to clear it", async () => {
    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      snmpResponse: walk(),
      isOnline: true,
      pollMode: "snmp",
      snmpTableSnapshot: [],
    });

    expect(writtenColumns()["snmpTableSnapshot"]).toEqual([]);
  });

  test("does not touch the snapshot when given none", async () => {
    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      snmpResponse: walk(),
      isOnline: true,
      pollMode: "snmp",
    });

    expect("snmpTableSnapshot" in writtenColumns()).toBe(false);
  });
});
