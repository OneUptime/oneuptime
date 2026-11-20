import { FindOperator } from "typeorm";
import DeviceManagementConnection from "../../../../Models/DatabaseModels/DeviceManagementConnection";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import ManagedDevice from "../../../../Models/DatabaseModels/ManagedDevice";
import ManagedDeviceApp from "../../../../Models/DatabaseModels/ManagedDeviceApp";
import DeviceManagementConnectionService from "../../../../Server/Services/DeviceManagementConnectionService";
import InventoryItemService, {
  SerialNumberHost,
} from "../../../../Server/Services/InventoryItemService";
import ManagedDeviceAppService from "../../../../Server/Services/ManagedDeviceAppService";
import ManagedDeviceService from "../../../../Server/Services/ManagedDeviceService";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Postgres, as a device management read asks it, played by maps: the
 * connection, its devices and their apps, and the project's Inventory
 * items. Each service method the read uses is spied on and answered from
 * the maps, with the query shapes the read sends - a value, a list
 * (QueryHelper.any), IS NULL (QueryHelper.isNull) - read the way Postgres
 * reads them, the unique keys kept (an item's project, type and key), and
 * a deleted device's apps deleted with it, as the foreign key does.
 *
 * Rows are kept as plain JSON copies, so a test sees what was written and
 * nothing the code kept a reference to.
 */

export interface FakeDeviceManagementDb {
  connection: DeviceManagementConnection;
  // What the read recorded on the connection, in order.
  recorded: Array<JSONObject>;
  devices: Map<string, JSONObject>;
  apps: Map<string, JSONObject>;
  items: Map<string, JSONObject>;
  // Writes made to Inventory items, in order: what, and to which item.
  itemWrites: Array<{
    kind: "create" | "update" | "delete";
    id: string;
    data?: JSONObject;
  }>;
  addItem: (item: JSONObject) => string;
}

// The columns OneUptime keeps as ObjectIDs; every other ID is the service's text.
const OBJECT_ID_COLUMNS: ReadonlySet<string> = new Set<string>([
  "projectId",
  "connectionId",
  "managedDeviceId",
  "inventoryItemId",
  "resourceId",
]);

let sequence: number = 0;

function nextId(): string {
  sequence++;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function plain(value: unknown): JSONObject {
  const json: JSONObject = {};

  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (field === undefined || typeof field === "function") {
      continue;
    }

    json[key] =
      field instanceof ObjectID
        ? field.toString()
        : field instanceof Date
          ? (new Date(field.getTime()) as unknown as JSONObject[string])
          : (JSON.parse(JSON.stringify(field)) as JSONObject[string]);
  }

  // A model's id is its _id.
  const id: unknown = (value as { _id?: unknown })._id;

  if (id) {
    json["_id"] = String(id);
  }

  return json;
}

function revive(row: JSONObject): JSONObject {
  const copy: JSONObject = {};

  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      copy[key] = new Date(value.getTime()) as unknown as JSONObject[string];
    } else if (
      typeof value === "string" &&
      key.endsWith("At") &&
      !Number.isNaN(Date.parse(value))
    ) {
      copy[key] = new Date(value) as unknown as JSONObject[string];
    } else if (
      typeof value === "string" &&
      OBJECT_ID_COLUMNS.has(key) &&
      ObjectID.isValidUUID(value)
    ) {
      copy[key] = new ObjectID(value) as unknown as JSONObject[string];
    } else {
      copy[key] = JSON.parse(JSON.stringify(value ?? null));
    }
  }

  copy["_id"] = row["_id"] as JSONObject[string];

  return copy;
}

function matches(value: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const sql: string = condition.getSql ? condition.getSql("x") : "";

    if (sql.includes("IS NOT NULL")) {
      return value !== null && value !== undefined;
    }

    if (sql.includes("IS NULL")) {
      return value === null || value === undefined;
    }

    if (sql.includes("TRUE = FALSE")) {
      return false;
    }

    const parameters: unknown = condition.objectLiteralParameters;
    const list: unknown = parameters
      ? Object.values(parameters as Record<string, unknown>)[0]
      : undefined;

    if (Array.isArray(list)) {
      return list.map(String).includes(String(value));
    }

    throw new Error(`The fake database does not read the condition ${sql}.`);
  }

  if (value === undefined || value === null) {
    return condition === undefined || condition === null;
  }

  return String(value) === String(condition);
}

function select(
  rows: Map<string, JSONObject>,
  query: Record<string, unknown>,
): Array<JSONObject> {
  return Array.from(rows.values()).filter((row: JSONObject): boolean => {
    return Object.entries(query).every(
      ([key, condition]: [string, unknown]): boolean => {
        return matches(row[key], condition);
      },
    );
  });
}

function toModel<T>(type: { new (): T }, row: JSONObject): T {
  const model: T = new type();
  Object.assign(model as unknown as Record<string, unknown>, revive(row));
  return model;
}

export function installFakeDeviceManagementDb(
  connection: DeviceManagementConnection,
): FakeDeviceManagementDb {
  const db: FakeDeviceManagementDb = {
    connection,
    recorded: [],
    devices: new Map<string, JSONObject>(),
    apps: new Map<string, JSONObject>(),
    items: new Map<string, JSONObject>(),
    itemWrites: [],
    addItem: (item: JSONObject): string => {
      const id: string = String(item["_id"] || nextId());
      db.items.set(id, { ...plain(item), _id: id });
      return id;
    },
  };

  jest
    .spyOn(DeviceManagementConnectionService, "findOneById")
    .mockImplementation((async () => {
      return db.connection;
    }) as never);

  jest
    .spyOn(DeviceManagementConnectionService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      db.recorded.push(JSON.parse(JSON.stringify(data.data)));

      for (const key of ["pullState", "lastPullResult"]) {
        if (data.data[key] !== undefined) {
          (db.connection as unknown as JSONObject)[key] = JSON.parse(
            JSON.stringify(data.data[key]),
          );
        }
      }
    }) as never);

  // Devices.
  jest.spyOn(ManagedDeviceService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
    skip?: number;
    limit?: number;
  }) => {
    const rows: Array<JSONObject> = select(db.devices, data.query).sort(
      (left: JSONObject, right: JSONObject): number => {
        return String(left["_id"]).localeCompare(String(right["_id"]));
      },
    );
    const skip: number = Number(data.skip || 0);

    return rows
      .slice(skip, skip + Number(data.limit || rows.length))
      .map((row: JSONObject): ManagedDevice => {
        return toModel(ManagedDevice, row);
      });
  }) as never);

  jest.spyOn(ManagedDeviceService, "create").mockImplementation((async (data: {
    data: ManagedDevice;
  }) => {
    const id: string = nextId();
    const row: JSONObject = { ...plain(data.data), _id: id };

    for (const existing of db.devices.values()) {
      if (
        existing["connectionId"] === row["connectionId"] &&
        existing["providerDeviceId"] === row["providerDeviceId"]
      ) {
        throw new Error("duplicate key value violates unique constraint");
      }
    }

    db.devices.set(id, row);
    return toModel(ManagedDevice, row);
  }) as never);

  jest
    .spyOn(ManagedDeviceService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: JSONObject | undefined = db.devices.get(data.id.toString());

      if (row) {
        Object.assign(row, plain(data.data));
      }
    }) as never);

  jest
    .spyOn(ManagedDeviceService, "updateBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      data: JSONObject;
    }) => {
      const rows: Array<JSONObject> = select(db.devices, data.query);

      for (const row of rows) {
        Object.assign(row, plain(data.data));
      }

      return rows.length;
    }) as never);

  jest
    .spyOn(ManagedDeviceService, "hardDeleteBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const rows: Array<JSONObject> = select(db.devices, data.query);

      for (const row of rows) {
        db.devices.delete(String(row["_id"]));

        // The apps go with the device, as the foreign key does it.
        for (const [appId, app] of db.apps) {
          if (app["managedDeviceId"] === row["_id"]) {
            db.apps.delete(appId);
          }
        }
      }

      return rows.length;
    }) as never);

  // Apps.
  jest
    .spyOn(ManagedDeviceAppService, "findBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      return select(db.apps, data.query).map(
        (row: JSONObject): ManagedDeviceApp => {
          return toModel(ManagedDeviceApp, row);
        },
      );
    }) as never);

  jest
    .spyOn(ManagedDeviceAppService, "create")
    .mockImplementation((async (data: { data: ManagedDeviceApp }) => {
      const id: string = nextId();
      const row: JSONObject = { ...plain(data.data), _id: id };
      db.apps.set(id, row);
      return toModel(ManagedDeviceApp, row);
    }) as never);

  jest
    .spyOn(ManagedDeviceAppService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: JSONObject | undefined = db.apps.get(data.id.toString());

      if (row) {
        Object.assign(row, plain(data.data));
      }
    }) as never);

  jest
    .spyOn(ManagedDeviceAppService, "hardDeleteBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const rows: Array<JSONObject> = select(db.apps, data.query);

      for (const row of rows) {
        db.apps.delete(String(row["_id"]));
      }

      return rows.length;
    }) as never);

  // Inventory items.
  jest.spyOn(InventoryItemService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    return select(db.items, data.query).map(
      (row: JSONObject): InventoryItem => {
        return toModel(InventoryItem, row);
      },
    );
  }) as never);

  jest
    .spyOn(InventoryItemService, "findHostsBySerialNumber")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      serialNumbers: Array<string>;
    }) => {
      const serials: Array<string> = data.serialNumbers.map(
        (serial: string): string => {
          return serial.trim().toLowerCase();
        },
      );

      return Array.from(db.items.values())
        .filter((row: JSONObject): boolean => {
          return (
            row["projectId"] === data.projectId.toString() &&
            row["entityType"] === "host"
          );
        })
        .map((row: JSONObject): SerialNumberHost => {
          const attributes: JSONObject =
            (row["descriptiveAttributes"] as JSONObject) || {};
          const identity: JSONObject =
            (row["identifyingAttributes"] as JSONObject) || {};

          return {
            id: String(row["_id"]),
            serialNumber: String(attributes["host.serial_number"] || "")
              .trim()
              .toLowerCase(),
            hostName: String(identity["host.name"] || "")
              .trim()
              .toLowerCase(),
          };
        })
        .filter((host: SerialNumberHost): boolean => {
          return (
            (Boolean(host.serialNumber) &&
              serials.includes(host.serialNumber)) ||
            (Boolean(host.hostName) && serials.includes(host.hostName))
          );
        });
    }) as never);

  jest.spyOn(InventoryItemService, "create").mockImplementation((async (data: {
    data: InventoryItem;
  }) => {
    const row: JSONObject = { ...plain(data.data) };

    for (const existing of db.items.values()) {
      if (
        existing["projectId"] === row["projectId"] &&
        existing["entityType"] === row["entityType"] &&
        existing["entityKey"] === row["entityKey"]
      ) {
        throw new Error("duplicate key value violates unique constraint");
      }
    }

    const id: string = nextId();
    row["_id"] = id;
    db.items.set(id, row);
    db.itemWrites.push({ kind: "create", id, data: row });
    return toModel(InventoryItem, row);
  }) as never);

  jest
    .spyOn(InventoryItemService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const id: string = data.id.toString();
      const row: JSONObject | undefined = db.items.get(id);
      const update: JSONObject = plain(data.data);

      // A column written null is cleared, as Postgres does.
      for (const [key, value] of Object.entries(data.data)) {
        if (value === null) {
          update[key] = null;
        }
      }

      if (row) {
        Object.assign(row, update);
      }

      db.itemWrites.push({ kind: "update", id, data: update });
    }) as never);

  jest
    .spyOn(InventoryItemService, "hardDeleteBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const rows: Array<JSONObject> = select(db.items, data.query);

      for (const row of rows) {
        const id: string = String(row["_id"]);
        db.items.delete(id);
        db.itemWrites.push({ kind: "delete", id });

        // A device's link to it is cleared, as the foreign key does it.
        for (const device of db.devices.values()) {
          if (device["inventoryItemId"] === id) {
            device["inventoryItemId"] = null;
          }
        }
      }

      return rows.length;
    }) as never);

  return db;
}
