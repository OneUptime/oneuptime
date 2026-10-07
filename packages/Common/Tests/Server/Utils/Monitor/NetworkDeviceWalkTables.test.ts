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
import {
  SnmpTableDefinition,
  SnmpTableResult,
  SnmpTableSnapshot,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import ObjectID from "../../../../Types/ObjectID";
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
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({ oidTemplateId: TEMPLATE_ID }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(templateFindSpy).not.toHaveBeenCalled();
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

  test("leaves the stored rows alone when an older probe walked no tables", async () => {
    await expect(
      NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device({
          snmpTables: [IPSEC_TABLE],
          snmpTableSnapshot: [storedSnapshot(1)],
        }),
        snmpResponse: walk(),
        monitoredAt: MONITORED_AT,
      }),
    ).resolves.toBeUndefined();
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
