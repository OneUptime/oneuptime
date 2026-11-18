import {
  MANUFACTURER_REFRESH_ATTEMPTS,
  MANUFACTURER_REFRESH_CHUNK_SIZE,
  Service as NetworkDeviceServiceType,
  getManufacturerInputsFingerprintSql,
} from "../../../Server/Services/NetworkDeviceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  buildDiscoveredListEntries,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * NetworkDevice.manufacturer (OneUptime issue #9363): the maker the Devices
 * list's Vendor / Model column shows for a device, kept on it so the lists'
 * Vendor filter and sort find the device under it. The column draws the maker
 * from the device's asset facts - the Discovered Devices list's maker for a
 * device only that list knows one for - and the filter read `vendor` alone.
 *
 * These pin the server's side:
 *
 *   - refreshManufacturer works the maker out with the column's own function,
 *     writes only the devices whose maker changed, one statement each, and
 *     only while the device still holds what it was worked out from - a
 *     write in between is read again, never undone;
 *   - every write of what the maker is worked out from comes back to it: a
 *     create, an update through the service, a hook-free write, a merge of a
 *     key it reads, a connection's readings forgotten - and nothing else
 *     does;
 *   - nobody writes the column but the server, and whoever reads a device's
 *     vendor reads it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_DEVICE_ID: string = "33333333-3333-4333-8333-333333333334";
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ENDPOINT_ID: string = "40000000-0000-4000-8000-000000000001";
const CONNECTION_ID: string = "50000000-0000-4000-8000-000000000001";
const READ_AT: Date = new Date("2026-11-17T08:00:00.000Z");

function listVendor(vendor: string): JSONObject {
  return buildDiscoveredListEntries({
    reading: { endpointId: ENDPOINT_ID, name: "PROFUSION-733451", vendor },
    readAt: READ_AT,
  }) as unknown as JSONObject;
}

function merakiReading(): JSONObject {
  return buildControllerReading({
    provider: NetworkControllerProvider.Meraki,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.NetworkController,
      id: CONNECTION_ID,
      name: "Acme Retail",
    },
    readAt: READ_AT,
    values: { model: "MS120-8LP" },
  }) as unknown as JSONObject;
}

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

function flat(sql: string): string {
  return sql.split(/\s+/).join(" ").trim();
}

// A device as the table holds it, for the fake database below.
interface StoredDevice {
  vendor?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  lastSnmpSeenAt?: Date | null;
  discoveredDetails?: JSONObject | null;
  manufacturer?: string | null;
  deletedAt?: Date | null;
}

/*
 * What the read and the write do, over an in-memory table. The fingerprint
 * stands in for Postgres's: it changes whenever one of the five columns does.
 */
function fingerprintOf(device: StoredDevice): string {
  return JSON.stringify([
    device.vendor ?? null,
    device.sysDescr ?? null,
    device.sysObjectId ?? null,
    device.lastSnmpSeenAt ? device.lastSnmpSeenAt.getTime() : null,
    device.discoveredDetails ?? null,
  ]);
}

interface FakeDatabase {
  table: Map<string, StoredDevice>;
  query: Mock<QueryFunction>;
  // Runs after a read, before the writes that follow it: another writer.
  afterRead?: (() => void) | undefined;
}

function fakeDatabase(): FakeDatabase {
  const database: FakeDatabase = {
    table: new Map<string, StoredDevice>(),
    query: jest.fn<QueryFunction>(),
  };

  database.query.mockImplementation(
    async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
      const statement: string = flat(sql);

      if (statement.startsWith('SELECT nd."_id"::text AS "_id", nd."vendor"')) {
        const ids: Array<string> = parameters[0] as Array<string>;
        const rows: Array<JSONObject> = [];

        for (const id of ids) {
          const device: StoredDevice | undefined = database.table.get(id);

          if (!device || device.deletedAt) {
            continue;
          }

          rows.push({
            _id: id,
            vendor: device.vendor ?? null,
            sysDescr: device.sysDescr ?? null,
            sysObjectId: device.sysObjectId ?? null,
            lastSnmpSeenAt: (device.lastSnmpSeenAt ?? null) as never,
            discoveredDetails: device.discoveredDetails ?? null,
            manufacturer: device.manufacturer ?? null,
            inputsFingerprint: fingerprintOf(device),
          });
        }

        const afterRead: (() => void) | undefined = database.afterRead;
        database.afterRead = undefined;
        afterRead?.();

        return rows;
      }

      if (statement.includes('SET "manufacturer" = $2')) {
        const id: string = parameters[0] as string;
        const device: StoredDevice | undefined = database.table.get(id);

        if (
          !device ||
          device.deletedAt ||
          fingerprintOf(device) !== parameters[2]
        ) {
          return [];
        }

        device.manufacturer = parameters[1] as string | null;
        return [{ _id: id }];
      }

      throw new Error(`Unexpected statement: ${statement}`);
    },
  );

  return database;
}

function serviceOver(database: FakeDatabase): NetworkDeviceServiceType {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  jest
    .spyOn(service, "getRepository")
    .mockReturnValue({ manager: { query: database.query } } as never);
  return service;
}

function statementsMatching(
  database: FakeDatabase,
  fragment: string,
): Array<[string, Array<unknown>]> {
  return database.query.mock.calls
    .map((call: [string, Array<unknown>]): [string, Array<unknown>] => {
      return [flat(call[0]), call[1]];
    })
    .filter((call: [string, Array<unknown>]): boolean => {
      return call[0].includes(fragment);
    });
}

describe("refreshManufacturer works out the maker the column shows", () => {
  let database: FakeDatabase;
  let service: NetworkDeviceServiceType;

  beforeEach(() => {
    jest.restoreAllMocks();
    database = fakeDatabase();
    service = serviceOver(database);
  });

  test("a device only the Discovered Devices list names a maker for is written under that maker", async () => {
    database.table.set(DEVICE_ID, {
      discoveredDetails: listVendor("Sunnovo International"),
    });

    expect(await service.refreshManufacturer({ deviceIds: [DEVICE_ID] })).toBe(
      1,
    );
    expect(database.table.get(DEVICE_ID)?.manufacturer).toBe(
      "Sunnovo International",
    );
  });

  test("a saved vendor wins over the list's maker, as in the column", async () => {
    database.table.set(DEVICE_ID, {
      vendor: "Zebra",
      discoveredDetails: listVendor("Sunnovo International"),
    });

    await service.refreshManufacturer({ deviceIds: [DEVICE_ID] });

    expect(database.table.get(DEVICE_ID)?.manufacturer).toBe("Zebra");
  });

  test("a device that names no maker any more loses the one it was listed under", async () => {
    database.table.set(DEVICE_ID, {
      discoveredDetails: {},
      manufacturer: "Cisco Meraki",
    });

    expect(await service.refreshManufacturer({ deviceIds: [DEVICE_ID] })).toBe(
      1,
    );
    expect(database.table.get(DEVICE_ID)?.manufacturer).toBeNull();
  });

  test("one read for the devices, then one statement per device whose maker changed, and none for the rest", async () => {
    database.table.set(DEVICE_ID, { vendor: "Zebra", manufacturer: "Zebra" });
    database.table.set(OTHER_DEVICE_ID, {
      discoveredDetails: { controller: merakiReading() },
    });

    expect(
      await service.refreshManufacturer({
        deviceIds: [DEVICE_ID, new ObjectID(OTHER_DEVICE_ID)],
      }),
    ).toBe(1);

    const reads: Array<[string, Array<unknown>]> = statementsMatching(
      database,
      'FROM "NetworkDevice" AS nd WHERE nd."_id" = ANY($1::uuid[])',
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]![1]).toEqual([[DEVICE_ID, OTHER_DEVICE_ID]]);
    expect(reads[0]![0]).toContain('AND nd."deletedAt" IS NULL');
    expect(reads[0]![0]).toContain(
      `${getManufacturerInputsFingerprintSql("nd")} AS "inputsFingerprint"`,
    );

    const writes: Array<[string, Array<unknown>]> = statementsMatching(
      database,
      'SET "manufacturer" = $2',
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]![1][0]).toBe(OTHER_DEVICE_ID);
    expect(writes[0]![1][1]).toBe("Cisco Meraki");
    expect(database.table.get(OTHER_DEVICE_ID)?.manufacturer).toBe(
      "Cisco Meraki",
    );
  });

  test("the write is hook-free, of that one device, and only while it holds what its maker was worked out from", async () => {
    database.table.set(DEVICE_ID, { vendor: "Zebra" });

    await service.refreshManufacturer({ deviceIds: [DEVICE_ID] });

    const write: string = statementsMatching(
      database,
      'SET "manufacturer" = $2',
    )[0]![0];

    expect(write).toContain('UPDATE "NetworkDevice" AS nd');
    expect(write).toContain('WHERE nd."_id" = $1::uuid');
    expect(write).toContain('AND nd."deletedAt" IS NULL');
    expect(write).toContain(
      `AND ${getManufacturerInputsFingerprintSql("nd")} = $3`,
    );
    // A SELECT of what it wrote: the answer says whether it landed.
    expect(write).toContain('RETURNING nd."_id"');
    // Nothing anybody set changed.
    expect(write).not.toContain("updatedAt");
    expect(write).not.toContain("version");
  });

  test("the fingerprint is Postgres's, of all five columns, the poll time to the microsecond", () => {
    expect(getManufacturerInputsFingerprintSql("nd")).toBe(
      'md5(jsonb_build_array(nd."vendor", nd."sysDescr", nd."sysObjectId", extract(epoch from nd."lastSnmpSeenAt"), nd."discoveredDetails")::text)',
    );
  });

  test("a write in between is never undone: the device is read again and written from what it holds now", async () => {
    database.table.set(DEVICE_ID, {
      discoveredDetails: listVendor("Sunnovo International"),
    });

    // The list's sync merges another maker between the read and the write.
    database.afterRead = (): void => {
      database.table.get(DEVICE_ID)!.discoveredDetails =
        listVendor("Hon Hai Precision");
    };

    expect(await service.refreshManufacturer({ deviceIds: [DEVICE_ID] })).toBe(
      1,
    );
    expect(database.table.get(DEVICE_ID)?.manufacturer).toBe(
      "Hon Hai Precision",
    );
    expect(
      statementsMatching(database, 'nd."_id" = ANY($1::uuid[])'),
    ).toHaveLength(2);
  });

  test("a device that changes on every read is left to its next write, and said so", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    database.table.set(DEVICE_ID, { vendor: "Zebra" });

    let writes: number = 0;
    database.query.mockImplementation(
      async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        if (flat(sql).includes('SET "manufacturer" = $2')) {
          writes++;
          return [];
        }

        return [
          {
            _id: (parameters[0] as Array<string>)[0],
            vendor: `Zebra ${writes}`,
            manufacturer: null,
            inputsFingerprint: `fingerprint ${writes}`,
          },
        ];
      },
    );

    expect(await service.refreshManufacturer({ deviceIds: [DEVICE_ID] })).toBe(
      0,
    );
    expect(writes).toBe(MANUFACTURER_REFRESH_ATTEMPTS);
    expect(MANUFACTURER_REFRESH_ATTEMPTS).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(DEVICE_ID);
  });

  test("a deleted device, or an id that is none, is never written", async () => {
    database.table.set(DEVICE_ID, {
      vendor: "Zebra",
      deletedAt: new Date(),
    });

    expect(
      await service.refreshManufacturer({
        deviceIds: [DEVICE_ID, "not-a-uuid", ""],
      }),
    ).toBe(0);

    const reads: Array<[string, Array<unknown>]> = statementsMatching(
      database,
      'nd."_id" = ANY($1::uuid[])',
    );
    expect(reads[0]![1]).toEqual([[DEVICE_ID]]);
    expect(statementsMatching(database, 'SET "manufacturer"')).toHaveLength(0);
  });

  test("nothing to work out reads nothing", async () => {
    expect(await service.refreshManufacturer({ deviceIds: [] })).toBe(0);
    expect(database.query).not.toHaveBeenCalled();
  });

  test("the same device named twice, in either case, is read once", async () => {
    const upper: string = "ABCDEF01-2345-4678-9ABC-DEF012345678";
    database.table.set(upper.toLowerCase(), { vendor: "Zebra" });

    await service.refreshManufacturer({
      deviceIds: [upper, upper.toLowerCase()],
    });

    expect(
      statementsMatching(database, 'nd."_id" = ANY($1::uuid[])')[0]![1],
    ).toEqual([[upper.toLowerCase()]]);
  });

  test("thousands of devices are read MANUFACTURER_REFRESH_CHUNK_SIZE at a time", async () => {
    expect(MANUFACTURER_REFRESH_CHUNK_SIZE).toBe(500);

    const ids: Array<string> = [];

    for (let index: number = 0; index < 1201; index++) {
      const id: string = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      ids.push(id);
      database.table.set(id, { vendor: `Vendor ${index}` });
    }

    expect(await service.refreshManufacturer({ deviceIds: ids })).toBe(1201);

    const reads: Array<[string, Array<unknown>]> = statementsMatching(
      database,
      'nd."_id" = ANY($1::uuid[])',
    );
    expect(
      reads.map((read: [string, Array<unknown>]): number => {
        return (read[1][0] as Array<string>).length;
      }),
    ).toEqual([500, 500, 201]);
  });

  test("a device another writer holds past the lock timeout is left; the others are written", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    database.table.set(DEVICE_ID, { vendor: "Zebra" });
    database.table.set(OTHER_DEVICE_ID, { vendor: "Honeywell" });

    const lockTimeout: Error & { driverError?: { code: string } } = new Error(
      "canceling statement due to lock timeout",
    );
    lockTimeout.driverError = { code: "55P03" };

    const actual: QueryFunction = database.query.getMockImplementation()!;
    database.query.mockImplementation(
      async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        if (
          flat(sql).includes('SET "manufacturer" = $2') &&
          parameters[0] === DEVICE_ID
        ) {
          throw lockTimeout;
        }

        return actual(sql, parameters);
      },
    );

    expect(
      await service.refreshManufacturer({
        deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      }),
    ).toBe(1);
    expect(database.table.get(OTHER_DEVICE_ID)?.manufacturer).toBe("Honeywell");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(DEVICE_ID);
  });

  test("any other failure surfaces to the caller", async () => {
    database.table.set(DEVICE_ID, { vendor: "Zebra" });
    database.query.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      service.refreshManufacturer({ deviceIds: [DEVICE_ID] }),
    ).rejects.toThrow("connection reset");
  });
});

describe("backfillManufacturerPage", () => {
  test("pages every device by id, of every project and archived ones too, and works each one out", async () => {
    const query: Mock<QueryFunction> = jest.fn<QueryFunction>(
      async (): Promise<unknown> => {
        return [{ _id: DEVICE_ID }, { _id: OTHER_DEVICE_ID }];
      },
    );
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const refresh: SpyInstance<
      NetworkDeviceServiceType["refreshManufacturer"]
    > = jest.spyOn(service, "refreshManufacturer").mockResolvedValue(1);

    expect(
      await service.backfillManufacturerPage({
        afterId: DEVICE_ID,
        limit: 500,
      }),
    ).toEqual({ read: 2, written: 1, lastId: OTHER_DEVICE_ID });

    const sql: string = flat(query.mock.calls[0]![0]);
    expect(sql).toContain('WHERE nd."deletedAt" IS NULL');
    expect(sql).toContain('AND nd."_id" > $2::uuid');
    expect(sql).toContain('ORDER BY nd."_id" ASC');
    expect(sql).toContain("LIMIT $1");
    expect(sql).not.toContain("projectId");
    expect(sql).not.toContain("isArchived");
    expect(query.mock.calls[0]![1]).toEqual([500, DEVICE_ID]);
    expect(refresh.mock.calls[0]![0]).toEqual({
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
    });
  });

  test("the first page starts at the first id; an empty page ends it", async () => {
    const query: Mock<QueryFunction> = jest.fn<QueryFunction>(
      async (): Promise<unknown> => {
        return [];
      },
    );
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const refresh: SpyInstance<
      NetworkDeviceServiceType["refreshManufacturer"]
    > = jest.spyOn(service, "refreshManufacturer");

    expect(await service.backfillManufacturerPage({ limit: 0 })).toEqual({
      read: 0,
      written: 0,
      lastId: undefined,
    });
    expect(flat(query.mock.calls[0]![0])).not.toContain("$2");
    expect(query.mock.calls[0]![1]).toEqual([1]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<NetworkDevice>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

describe("a create is listed under the maker it is created with", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  async function createdManufacturer(
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;

    for (const [key, value] of Object.entries(fields)) {
      (device as unknown as Record<string, unknown>)[key] = value;
    }

    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const result: OnCreate<NetworkDevice> = await (
      service as unknown as DeviceServiceInternals
    ).onBeforeCreate({
      data: device,
      props: { isRoot: true },
    } as CreateBy<NetworkDevice>);

    return (result.createBy.data as unknown as Record<string, unknown>)[
      "manufacturer"
    ];
  }

  test("a device imported from the Discovered Devices list: the list's maker", async () => {
    expect(
      await createdManufacturer({
        name: "PROFUSION-733451",
        hostname: "10.34.15.10",
        discoveredDetails: listVendor("Sunnovo International"),
      }),
    ).toBe("Sunnovo International");
  });

  test("a device a scan imported with its SNMP identity: the maker it names", async () => {
    expect(
      await createdManufacturer({
        name: "edge-sw-07",
        hostname: "10.20.12.7",
        discoveredDetails: {
          sysObjectId: {
            value: "1.3.6.1.4.1.9.1.1208",
            method: "snmp",
            readBy: {
              type: "discoveryScan",
              id: "80000000-0000-4000-8000-000000000001",
              name: "Store subnets",
            },
            readAt: "2026-10-23T09:00:00.000Z",
          },
        },
      }),
    ).toBe("Cisco");
  });

  test("whatever a create sends there is replaced", async () => {
    expect(
      await createdManufacturer({
        name: "by hand",
        hostname: "10.0.0.1",
        manufacturer: "Made up",
      }),
    ).toBeUndefined();

    expect(
      await createdManufacturer({
        name: "PROFUSION-733451",
        hostname: "10.34.15.10",
        manufacturer: "Made up",
        discoveredDetails: listVendor("Sunnovo International"),
      }),
    ).toBe("Sunnovo International");
  });

  test("worked out from what the create keeps, never from what it drops", async () => {
    // Not an entry of the column: dropped, so it names no maker.
    expect(
      await createdManufacturer({
        name: "by hand",
        hostname: "10.0.0.1",
        discoveredDetails: { vendor: "Sunnovo International" },
      }),
    ).toBeUndefined();
  });
});

describe("every write of what the maker is worked out from comes back to it", () => {
  let service: NetworkDeviceServiceType;
  let refresh: SpyInstance<NetworkDeviceServiceType["refreshManufacturer"]>;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    refresh = jest.spyOn(service, "refreshManufacturer").mockResolvedValue(0);
  });

  function onUpdate(data: Record<string, unknown>): OnUpdate<NetworkDevice> {
    return {
      updateBy: {
        query: { _id: DEVICE_ID },
        data: data,
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>,
      carryForward: { previousDevices: [] },
    };
  }

  test.each([
    [{ vendor: "Zebra" }],
    [{ sysDescr: "EdgeSwitch 24-Port Lite, 1.8.2.5249835, Linux 3.6.5" }],
    [{ sysObjectId: "1.3.6.1.4.1.9.1.1208" }],
    [{ discoveredDetails: null }],
  ])(
    "an update through the service of %j",
    async (data: Record<string, unknown>) => {
      await (service as unknown as DeviceServiceInternals).onUpdateSuccess(
        onUpdate(data),
        [new ObjectID(DEVICE_ID), new ObjectID(OTHER_DEVICE_ID)],
      );

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        refresh.mock.calls[0]![0].deviceIds.map(
          (id: ObjectID | string): string => {
            return id.toString();
          },
        ),
      ).toEqual([DEVICE_ID, OTHER_DEVICE_ID]);
    },
  );

  test("an update of anything else reads nothing more", async () => {
    await (service as unknown as DeviceServiceInternals).onUpdateSuccess(
      onUpdate({ description: "core switch", isPollingEnabled: false }),
      [new ObjectID(DEVICE_ID)],
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  test("an update that matched no device reads nothing", async () => {
    await (service as unknown as DeviceServiceInternals).onUpdateSuccess(
      onUpdate({ vendor: "Zebra" }),
      [],
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  test("a failure to work it out never fails the saved update", async () => {
    refresh.mockRejectedValueOnce(new Error("connection reset"));
    const error: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    await expect(
      (service as unknown as DeviceServiceInternals).onUpdateSuccess(
        onUpdate({ vendor: "Zebra" }),
        [new ObjectID(DEVICE_ID)],
      ),
    ).resolves.toBeDefined();
    expect(error).toHaveBeenCalled();
  });

  describe("a hook-free write", () => {
    // The write itself: DatabaseService's, which the service's override calls.
    let write: SpyInstance<
      DatabaseService<NetworkDevice>["updateColumnsByIdWithoutHooks"]
    >;

    beforeEach(() => {
      write = jest
        .spyOn(DatabaseService.prototype, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
    });

    test.each([
      [{ lastSnmpSeenAt: null }],
      [{ discoveredDetails: null }],
      [{ vendor: null }],
    ])(
      "of %j works the maker out again, once the write is done",
      async (data: Record<string, unknown>) => {
        await service.updateColumnsByIdWithoutHooks({
          id: new ObjectID(DEVICE_ID),
          data: data as never,
          skipUpdateDateColumn: true,
        });

        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0]![0]).toEqual({
          id: new ObjectID(DEVICE_ID),
          data: data,
          skipUpdateDateColumn: true,
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0]![0].deviceIds[0]!.toString()).toBe(
          DEVICE_ID,
        );
        expect(write.mock.invocationCallOrder[0]!).toBeLessThan(
          refresh.mock.invocationCallOrder[0]!,
        );
      },
    );

    test("of anything else does not", async () => {
      await service.updateColumnsByIdWithoutHooks({
        id: new ObjectID(DEVICE_ID),
        data: { nextPollAt: new Date(), isPollingEnabled: true },
      });

      expect(write).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    });

    test("a failure to work it out never fails the write", async () => {
      refresh.mockRejectedValueOnce(new Error("connection reset"));
      const error: SpyInstance<typeof logger.error> = jest
        .spyOn(logger, "error")
        .mockImplementation((() => {
          return undefined;
        }) as never);

      await expect(
        service.updateColumnsByIdWithoutHooks({
          id: new ObjectID(DEVICE_ID),
          data: { discoveredDetails: null } as never,
        }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    });

    test("a failed write surfaces, and works nothing out", async () => {
      write.mockRejectedValueOnce(new Error("connection reset"));

      await expect(
        service.updateColumnsByIdWithoutHooks({
          id: new ObjectID(DEVICE_ID),
          data: { discoveredDetails: null } as never,
        }),
      ).rejects.toThrow("connection reset");
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});

describe("a merge of a key the maker reads comes back to it", () => {
  let service: NetworkDeviceServiceType;
  let query: Mock<QueryFunction>;
  let refresh: SpyInstance<NetworkDeviceServiceType["refreshManufacturer"]>;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    // Postgres writes every device it is sent.
    query = jest.fn<QueryFunction>(
      async (_sql: string, parameters: Array<unknown>): Promise<unknown> => {
        return (
          JSON.parse(parameters[0] as string) as Array<{ id: string }>
        ).map((row: { id: string }) => {
          return { _id: row.id };
        });
      },
    );
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    refresh = jest.spyOn(service, "refreshManufacturer").mockResolvedValue(0);
  });

  test("only for the devices it wrote one of those keys into", async () => {
    const written: number = await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        { deviceId: DEVICE_ID, set: listVendor("Sunnovo International") },
        {
          deviceId: OTHER_DEVICE_ID,
          set: {
            macAddress: {
              value: "00:1b:54:c2:7a:01",
              method: "arpTable",
              readBy: {
                type: "networkDevice",
                id: "60000000-0000-4000-8000-000000000001",
                name: "core-rtr-01",
              },
              readAt: READ_AT.toISOString(),
            },
          },
        },
      ],
    });

    expect(written).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0]).toEqual({ deviceIds: [DEVICE_ID] });
  });

  test("a key it drops counts too: a controller's reading taken away", async () => {
    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: DEVICE_ID, unset: ["controller"] }],
    });

    expect(refresh.mock.calls[0]![0]).toEqual({ deviceIds: [DEVICE_ID] });
  });

  test("a device the merge did not write is not read", async () => {
    query.mockImplementation(async (): Promise<unknown> => {
      return [];
    });

    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        { deviceId: DEVICE_ID, set: listVendor("Sunnovo International") },
      ],
      skipLockedDevices: true,
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  test("a merge of other keys alone reads nothing more", async () => {
    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: DEVICE_ID, unset: ["otherMachine", "ipAddress"] }],
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  test("a failure to work it out never fails the merge", async () => {
    refresh.mockRejectedValueOnce(new Error("connection reset"));
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    expect(
      await service.mergeDiscoveredDetails({
        projectId: PROJECT_ID,
        patches: [
          { deviceId: DEVICE_ID, set: listVendor("Sunnovo International") },
        ],
      }),
    ).toBe(1);
  });
});

describe("a deleted connection's readings forgotten come back to it", () => {
  test("each device that lost its controller's reading is worked out again", async () => {
    jest.restoreAllMocks();
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const query: Mock<QueryFunction> = jest.fn<QueryFunction>(
      async (sql: string): Promise<unknown> => {
        return flat(sql).includes(`- 'controller' WHERE`)
          ? [{ _id: DEVICE_ID }, { _id: OTHER_DEVICE_ID }]
          : [[], 0];
      },
    );
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const refresh: SpyInstance<
      NetworkDeviceServiceType["refreshManufacturer"]
    > = jest.spyOn(service, "refreshManufacturer").mockResolvedValue(2);

    expect(
      await service.forgetControllerReadings({
        projectId: PROJECT_ID,
        connectionId: new ObjectID(CONNECTION_ID),
      }),
    ).toBe(2);

    const sql: string = flat(query.mock.calls[0]![0]);
    expect(sql).toContain('WITH "forgotten" AS ( UPDATE "NetworkDevice" AS nd');
    expect(sql).toContain('RETURNING nd."_id" ) SELECT "_id" FROM "forgotten"');
    expect(refresh.mock.calls[0]![0]).toEqual({
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
    });
  });

  test("nothing forgotten reads nothing more", async () => {
    jest.restoreAllMocks();
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const query: Mock<QueryFunction> = jest.fn<QueryFunction>(
      async (): Promise<unknown> => {
        return [];
      },
    );
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const refresh: SpyInstance<
      NetworkDeviceServiceType["refreshManufacturer"]
    > = jest.spyOn(service, "refreshManufacturer");

    expect(
      await service.forgetControllerReadings({
        projectId: PROJECT_ID,
        connectionId: new ObjectID(CONNECTION_ID),
      }),
    ).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the column: written by nobody but the server, read by whoever reads the vendor", () => {
  function userWith(permission: Permission): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission;

    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      currentPlan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: tenantPermission,
      },
    };
  }

  function check(
    permission: Permission,
    requestType: DatabaseRequestType,
  ): string {
    const device: NetworkDevice = new NetworkDevice();
    device.manufacturer = "Typed by hand";

    try {
      ColumnPermissions.checkDataColumnPermissions(
        NetworkDevice,
        device,
        userWith(permission),
        requestType,
      );
      return "allowed";
    } catch (err) {
      if (err instanceof ColumnWriteRefusedException) {
        return `refused: ${err.columnName}`;
      }
      throw err;
    }
  }

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditNetworkDevice,
    Permission.CreateNetworkDevice,
  ])("%s can never write it", (permission: Permission) => {
    expect(check(permission, DatabaseRequestType.Create)).toBe(
      "refused: manufacturer",
    );
    expect(check(permission, DatabaseRequestType.Update)).toBe(
      "refused: manufacturer",
    );
  });

  test("whoever may read a device's vendor may read it, and nobody else", () => {
    const model: NetworkDevice = new NetworkDevice();
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } | null = model.getColumnAccessControlFor("manufacturer");

    expect(access?.create).toEqual([]);
    expect(access?.update).toEqual([]);
    expect([...(access?.read || [])].sort()).toEqual(
      [...(model.getColumnAccessControlFor("vendor")?.read || [])].sort(),
    );
    expect([...(access?.read || [])].sort()).toEqual(
      [
        ...(model.getColumnAccessControlFor("discoveredDetails")?.read || []),
      ].sort(),
    );
  });

  test("an optional short text the server fills in, beside the vendor", () => {
    const model: NetworkDevice = new NetworkDevice();
    const column:
      | {
          type?: TableColumnType;
          required?: boolean;
          computed?: boolean;
          canReadOnRelationQuery?: boolean;
        }
      | undefined = model.getTableColumnMetadata("manufacturer");

    expect(column?.type).toBe(TableColumnType.ShortText);
    expect(column?.required).toBe(false);
    expect(column?.computed).toBe(true);
    expect(column?.canReadOnRelationQuery).toBe(
      model.getTableColumnMetadata("vendor").canReadOnRelationQuery,
    );
  });
});
