import { NetworkControllerDeviceMatches } from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceMatcher";
import { NetworkTrafficUsageRecord } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import {
  MAX_ROWS_PER_INSERT,
  getRecordWindowKey,
  getWindowKey,
  toUsageRow,
  toUsageRowBatches,
} from "../../../../Server/Utils/NetworkController/NetworkTrafficUsageRows";
import { JSONObject } from "../../../../Types/JSON";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A read's records as the rows ClickHouse stores: each given the device
 * its traffic belongs to - an uplink its appliance's device, a network's
 * applications and clients its first matched appliance's - or the
 * project's own ID (the project's bucket); and batched so that no window
 * is ever split across two inserts, nor written when it is stored already.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MX_DEVICE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SITE_DEVICE: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const START: Date = new Date("2026-10-24T10:00:00.250Z");
const END: Date = new Date("2026-10-24T12:00:00.000Z");
const INGESTED: Date = new Date("2026-10-24T12:00:05.000Z");

const MATCHES: NetworkControllerDeviceMatches = {
  bySerial: new Map([["Q2XX-AAAA-0001", MX_DEVICE]]),
  byNetwork: new Map([["L_1", SITE_DEVICE]]),
};

function record(
  overrides: Partial<NetworkTrafficUsageRecord> = {},
): NetworkTrafficUsageRecord {
  return {
    kind: NetworkTrafficUsageKind.Application,
    controllerNetworkId: "L_1",
    controllerNetworkName: "Branch 1",
    deviceSerial: "",
    deviceName: "",
    interfaceName: "",
    application: "Microsoft Teams",
    destination: "teams.microsoft.com",
    protocol: "UDP",
    port: 3478,
    clientKey: "",
    clientName: "",
    clientIp: "",
    clientMac: "",
    clientManufacturer: "",
    sentOctets: 1536,
    receivedOctets: 4096,
    flows: 12,
    clients: 3,
    windowStartAt: START,
    windowEndAt: END,
    ...overrides,
  };
}

function row(data: Partial<NetworkTrafficUsageRecord>): JSONObject {
  return toUsageRow({
    record: record(data),
    projectId: PROJECT,
    connectionId: CONNECTION,
    matches: MATCHES,
    ingestedAt: INGESTED,
  });
}

describe("a window's key", () => {
  test("an uplink window is the organization's: one call covers every network", () => {
    expect(
      getWindowKey({
        kind: NetworkTrafficUsageKind.Uplink,
        controllerNetworkId: "L_1",
        windowStartAt: START,
      }),
    ).toBe(
      getWindowKey({
        kind: NetworkTrafficUsageKind.Uplink,
        controllerNetworkId: "",
        windowStartAt: START,
      }),
    );
  });

  test("an application or client window is its network's, to the millisecond", () => {
    expect(
      getRecordWindowKey(record({ kind: NetworkTrafficUsageKind.Client })),
    ).toBe(`client|L_1|${START.getTime()}`);
    expect(getRecordWindowKey(record())).not.toBe(
      getRecordWindowKey(record({ controllerNetworkId: "L_2" })),
    );
    expect(getRecordWindowKey(record())).not.toBe(
      getRecordWindowKey(
        record({ windowStartAt: new Date(START.getTime() + 1) }),
      ),
    );
  });
});

describe("a row", () => {
  test("an uplink belongs to its appliance's device", () => {
    expect(
      row({
        kind: NetworkTrafficUsageKind.Uplink,
        deviceSerial: "Q2XX-AAAA-0001",
        deviceName: "MX Branch 1",
        interfaceName: "wan1",
        application: "",
        destination: "",
      }),
    ).toMatchObject({
      projectId: PROJECT.toString(),
      connectionId: CONNECTION.toString(),
      networkDeviceId: MX_DEVICE.toString(),
      kind: "uplink",
      deviceSerial: "Q2XX-AAAA-0001",
      interfaceName: "wan1",
    });
  });

  test("a network's applications and clients belong to its matched appliance", () => {
    expect(row({})["networkDeviceId"]).toBe(SITE_DEVICE.toString());
    expect(
      row({ kind: NetworkTrafficUsageKind.Client, clientKey: "k1" })[
        "networkDeviceId"
      ],
    ).toBe(SITE_DEVICE.toString());
  });

  test("traffic of no device in OneUptime is the project's own bucket", () => {
    expect(
      row({
        kind: NetworkTrafficUsageKind.Uplink,
        deviceSerial: "Q2XX-ZZZZ-9999",
      })["networkDeviceId"],
    ).toBe(PROJECT.toString());
    expect(row({ controllerNetworkId: "L_9" })["networkDeviceId"]).toBe(
      PROJECT.toString(),
    );
  });

  test("every column ClickHouse keeps, the times in UTC to the millisecond", () => {
    const value: JSONObject = row({});

    expect(Object.keys(value).sort()).toEqual(
      [
        "_id",
        "createdAt",
        "projectId",
        "networkDeviceId",
        "connectionId",
        "kind",
        "controllerNetworkId",
        "controllerNetworkName",
        "deviceSerial",
        "deviceName",
        "interfaceName",
        "application",
        "destination",
        "protocol",
        "port",
        "clientKey",
        "clientName",
        "clientIp",
        "clientMac",
        "clientManufacturer",
        "sentOctets",
        "receivedOctets",
        "flows",
        "clients",
        "windowStartAt",
        "windowEndAt",
        "ingestedAt",
      ].sort(),
    );
    expect(value["windowStartAt"]).toBe("2026-10-24 10:00:00.250000000");
    expect(value["windowEndAt"]).toBe("2026-10-24 12:00:00.000000000");
    expect(value["ingestedAt"]).toBe("2026-10-24 12:00:05.000000000");
    expect(value["createdAt"]).toBe("2026-10-24 12:00:05");
    expect(value["sentOctets"]).toBe(1536);
    expect(ObjectID.isValidUUID(value["_id"] as string)).toBe(true);
    expect(row({})["_id"]).not.toBe(value["_id"]);
  });
});

describe("batches", () => {
  test("windows stored already are left out, and counted", () => {
    const records: Array<NetworkTrafficUsageRecord> = [
      record(),
      record({ application: "Zoom" }),
      record({ kind: NetworkTrafficUsageKind.Client, clientKey: "k1" }),
    ];

    const result: ReturnType<typeof toUsageRowBatches> = toUsageRowBatches({
      records,
      storedWindowKeys: new Set([getRecordWindowKey(records[0]!)]),
      projectId: PROJECT,
      connectionId: CONNECTION,
      matches: MATCHES,
      ingestedAt: INGESTED,
    });

    expect(result.skippedRecords).toBe(2);
    expect(result.batches).toHaveLength(1);
    expect(
      result.batches[0]!.map((value: JSONObject) => {
        return value["kind"];
      }),
    ).toEqual(["client"]);
  });

  test("never split a window, and hold to the row limit otherwise", () => {
    const records: Array<NetworkTrafficUsageRecord> = [];

    // Three uplink windows of 2,400 rows each: 1,200 appliances, two uplinks.
    for (let window: number = 0; window < 3; window++) {
      for (let index: number = 0; index < 2400; index++) {
        records.push(
          record({
            kind: NetworkTrafficUsageKind.Uplink,
            deviceSerial: `Q2XX-AAAA-${index}`,
            windowStartAt: new Date(START.getTime() + window * 300_000),
          }),
        );
      }
    }

    const { batches } = toUsageRowBatches({
      records,
      storedWindowKeys: new Set(),
      projectId: PROJECT,
      connectionId: CONNECTION,
      matches: MATCHES,
      ingestedAt: INGESTED,
    });

    expect(
      batches.map((batch: Array<JSONObject>) => {
        return batch.length;
      }),
    ).toEqual([4800, 2400]);

    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(MAX_ROWS_PER_INSERT);
    }

    // Each window's rows are in one batch only.
    const batchOfWindow: Map<string, number> = new Map();
    batches.forEach((batch: Array<JSONObject>, index: number) => {
      for (const value of batch) {
        const key: string = value["windowStartAt"] as string;
        expect(batchOfWindow.get(key) ?? index).toBe(index);
        batchOfWindow.set(key, index);
      }
    });
  });

  test("a network's applications and clients of a window go in one insert", () => {
    const records: Array<NetworkTrafficUsageRecord> = [];

    for (let index: number = 0; index < 3000; index++) {
      records.push(
        record({
          kind: NetworkTrafficUsageKind.Uplink,
          deviceSerial: `Q2XX-${index}`,
        }),
      );
    }

    for (let index: number = 0; index < 1500; index++) {
      records.push(record({ application: `App ${index}` }));
    }

    for (let index: number = 0; index < 1000; index++) {
      records.push(
        record({
          kind: NetworkTrafficUsageKind.Client,
          clientKey: `k${index}`,
        }),
      );
    }

    const { batches } = toUsageRowBatches({
      records,
      storedWindowKeys: new Set(),
      projectId: PROJECT,
      connectionId: CONNECTION,
      matches: MATCHES,
      ingestedAt: INGESTED,
    });

    // 3,000 + 2,500 is past the limit: the network's window starts a batch.
    expect(
      batches.map((batch: Array<JSONObject>) => {
        return batch.length;
      }),
    ).toEqual([3000, 2500]);
    expect(
      new Set(
        batches[1]!.map((value: JSONObject) => {
          return value["kind"];
        }),
      ),
    ).toEqual(new Set(["application", "client"]));
  });

  test("a window larger than the limit goes whole, in a batch of its own", () => {
    const records: Array<NetworkTrafficUsageRecord> = [
      record({ application: "Small" }),
      ...Array.from(
        { length: MAX_ROWS_PER_INSERT + 10 },
        (_: unknown, index: number) => {
          return record({
            kind: NetworkTrafficUsageKind.Uplink,
            deviceSerial: `Q2XX-${index}`,
          });
        },
      ),
    ];

    const { batches } = toUsageRowBatches({
      records,
      storedWindowKeys: new Set(),
      projectId: PROJECT,
      connectionId: CONNECTION,
      matches: MATCHES,
      ingestedAt: INGESTED,
    });

    expect(
      batches.map((batch: Array<JSONObject>) => {
        return batch.length;
      }),
    ).toEqual([1, MAX_ROWS_PER_INSERT + 10]);
  });

  test("nothing to write is no batch", () => {
    expect(
      toUsageRowBatches({
        records: [],
        storedWindowKeys: new Set(),
        projectId: PROJECT,
        connectionId: CONNECTION,
        matches: MATCHES,
        ingestedAt: INGESTED,
      }),
    ).toEqual({ batches: [], skippedRecords: 0 });
  });
});
