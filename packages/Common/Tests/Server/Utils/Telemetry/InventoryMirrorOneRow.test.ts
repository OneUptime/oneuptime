import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import NetworkDeviceRoleService from "../../../../Server/Services/NetworkDeviceRoleService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import {
  ErasedInventorySource,
  INVENTORY_SOURCES,
  InventoryRowProjection,
  MirrorInventoryRowOutcome,
  mirrorInventoryRow,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { keyForInventoryEntity } from "../../../../Utils/Telemetry/EntityKey";

/*
 * Copying ONE inventory row into the registry now (mirrorInventoryRow) - what
 * a network device someone refreshed gets the moment its new reading lands,
 * instead of waiting up to fifteen minutes for the mirror's pass. It must do
 * exactly what the pass does for that row: the same query (an archived
 * device is not copied), the same projection, a write only when the item
 * drifted.
 */

const PROJECT_ID: string = "0f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const DEVICE_ID: string = "6f2e5c1a-0b3d-4e5f-8a9b-1c2d3e4f5a6b";
const ITEM_ID: string = "60000000-0000-4000-8000-000000000001";

let deviceQueries: Array<JSONObject>;
let rows: Array<NetworkDevice>;
let existing: Array<InventoryItem>;
let created: Array<InventoryItem>;
let updated: Array<{ id: ObjectID; data: JSONObject }>;

function switchRow(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row._id = DEVICE_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.name = "core-sw-01";
  row.hostname = "10.20.0.1";
  row.sysName = "core-sw-01";
  row.vendor = "Cisco";
  row.deviceModel = "WS-C3850-48P";
  row.serialNumber = "FOC1840X0AB";
  row.lastSnmpSeenAt = new Date("2026-10-28T11:59:00.000Z");
  Object.assign(row, overrides);
  return row;
}

function networkSource(): ErasedInventorySource {
  return INVENTORY_SOURCES.find((source: ErasedInventorySource) => {
    return source.resourceType === "NetworkDevice";
  })!;
}

beforeEach(() => {
  deviceQueries = [];
  rows = [switchRow()];
  existing = [];
  created = [];
  updated = [];

  jest.spyOn(NetworkDeviceService, "findBy").mockImplementation((async (data: {
    query: JSONObject;
  }) => {
    deviceQueries.push(data.query);
    return rows;
  }) as never);
  jest.spyOn(NetworkDeviceRoleService, "findBy").mockResolvedValue([]);
  jest.spyOn(InventoryItemService, "findBy").mockImplementation((async () => {
    return existing;
  }) as never);
  jest.spyOn(InventoryItemService, "create").mockImplementation((async (data: {
    data: InventoryItem;
  }) => {
    created.push(data.data);
    return data.data;
  }) as never);
  jest
    .spyOn(InventoryItemService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      updated.push(data);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchOne", () => {
  test("reads the one row with the pass's own query, so an archived device is not copied", async () => {
    const projection: InventoryRowProjection | null =
      await networkSource().fetchOne(new ObjectID(DEVICE_ID));

    expect(deviceQueries).toEqual([{ isArchived: false, _id: DEVICE_ID }]);
    expect(projection?.id.toString()).toBe(DEVICE_ID);
    expect(projection?.displayName).toBe("core-sw-01");
    expect(projection?.descriptiveAttributes).toMatchObject({
      "host.name": "core-sw-01",
      "host.ip": "10.20.0.1",
      "device.model.name": "WS-C3850-48P",
      "host.serial_number": "FOC1840X0AB",
    });
  });

  test("a row that is not there is null", async () => {
    rows = [];

    expect(await networkSource().fetchOne(new ObjectID(DEVICE_ID))).toBeNull();
  });

  test("every source can read one row", () => {
    for (const source of INVENTORY_SOURCES) {
      expect(typeof source.fetchOne).toBe("function");
    }
  });
});

describe("mirrorInventoryRow", () => {
  test("a device with no item yet gets one", async () => {
    const outcome: MirrorInventoryRowOutcome = await mirrorInventoryRow({
      resourceType: "NetworkDevice",
      resourceId: new ObjectID(DEVICE_ID),
    });

    expect(outcome).toBe("created");
    expect(created).toHaveLength(1);
    expect(created[0]!.entityKey).toBe(
      keyForInventoryEntity(PROJECT_ID, EntityType.NetworkDevice, DEVICE_ID),
    );
    expect(updated).toEqual([]);
  });

  test("an item that drifted is rewritten with what the device says now", async () => {
    const item: InventoryItem = new InventoryItem();
    item._id = ITEM_ID;
    item.entityKey = keyForInventoryEntity(
      PROJECT_ID,
      EntityType.NetworkDevice,
      DEVICE_ID,
    );
    item.displayName = "core-sw-01";
    item.resourceType = "NetworkDevice";
    item.resourceId = new ObjectID(DEVICE_ID);
    item.descriptiveAttributes = { "device.firmware.version": "16.9.1" };
    existing = [item];

    rows = [switchRow({ firmwareVersion: "16.12.4" })];

    const outcome: MirrorInventoryRowOutcome = await mirrorInventoryRow({
      resourceType: "NetworkDevice",
      resourceId: new ObjectID(DEVICE_ID),
    });

    expect(outcome).toBe("updated");
    expect(updated).toHaveLength(1);
    expect(
      (updated[0]!.data["descriptiveAttributes"] as JSONObject)[
        "device.firmware.version"
      ],
    ).toBe("16.12.4");
  });

  test("an item that says what the device says is left alone", async () => {
    await mirrorInventoryRow({
      resourceType: "NetworkDevice",
      resourceId: new ObjectID(DEVICE_ID),
    });
    existing = [created[0]!];
    existing[0]!._id = ITEM_ID;
    created = [];

    const outcome: MirrorInventoryRowOutcome = await mirrorInventoryRow({
      resourceType: "NetworkDevice",
      resourceId: new ObjectID(DEVICE_ID),
    });

    expect(outcome).toBe("unchanged");
    expect(created).toEqual([]);
    expect(updated).toEqual([]);
  });

  test("a row the pass would not copy, or a kind it does not mirror, is not copied", async () => {
    rows = [];

    expect(
      await mirrorInventoryRow({
        resourceType: "NetworkDevice",
        resourceId: new ObjectID(DEVICE_ID),
      }),
    ).toBe("notMirrored");
    expect(
      await mirrorInventoryRow({
        resourceType: "Monitor",
        resourceId: new ObjectID(DEVICE_ID),
      }),
    ).toBe("notMirrored");
    expect(created).toEqual([]);
  });
});
