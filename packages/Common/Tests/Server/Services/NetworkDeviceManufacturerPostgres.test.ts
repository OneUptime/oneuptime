import Entities from "../../../Models/DatabaseModels/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService, {
  ManufacturerBackfillPage,
  getManufacturerInputsFingerprintSql,
} from "../../../Server/Services/NetworkDeviceService";
import logger from "../../../Server/Utils/Logger";
import PositiveNumber from "../../../Types/PositiveNumber";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../Types/JSON";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  buildDiscoveredListEntries,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import { getNetworkDeviceAssetFacts } from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * THE VENDOR FILTER AND SORT OF THE DEVICES LIST, EXECUTED on Postgres
 * (OneUptime issue #9363).
 *
 * The Devices, Archived and site lists filter and sort by
 * NetworkDevice.manufacturer: the maker each device's Vendor / Model column
 * shows, which the server keeps on it. The unit suites pin the statements;
 * only a database shows what they do:
 *
 *   - a device whose maker comes only from discovery - the Discovered
 *     Devices list, a scan's reading of its SNMP identity, its controller -
 *     is found by the Vendor filter; one with a saved vendor still is; when
 *     both are there the one the column shows wins; case and part of a word
 *     match as the other text filters match; a device nothing names a
 *     maker for is found by none but "is empty" - for every operator the
 *     chip offers, the devices it finds are exactly those whose column
 *     matches;
 *   - with the filter on, the database counts and pages the matching devices,
 *     every one on exactly one page;
 *   - the column's sort orders the list by the maker it shows;
 *   - each write of what the maker is worked out from writes it again: a
 *     merge of the list's maker, a connection's readings forgotten, a
 *     hook-free write of the discovered details - and a merge of anything
 *     else writes nothing, updatedAt included;
 *   - the inputs' fingerprint is the same for the same row, read twice or in
 *     another time zone, and another for a change to any of the five
 *     columns - a poll time a microsecond on included - so a maker worked out
 *     from what a device no longer holds is never written;
 *   - the backfill pages every device of every project, archived ones too,
 *     and a second run has nothing left to write.
 *
 * Opt in with RUN_POSTGRES_NETWORK_DEVICE_MANUFACTURER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check, which has the column
 * AddNetworkDeviceManufacturer1809182980000 adds. The NetworkDevice
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema) that is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from
 * NETWORK_DEVICE_MANUFACTURER_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from NETWORK_DEVICE_MANUFACTURER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_DEVICE_MANUFACTURER_TESTS"] === "true"
    ? describe
    : describe.skip;

// Columns a fixture row must fill; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const ENDPOINT_ID: string = "40000000-0000-4000-8000-000000000001";
const CONNECTION_ID: string = "50000000-0000-4000-8000-000000000001";
const SCAN_ID: string = "20000000-0000-4000-8000-000000000001";
const LIST_READ_AT: Date = new Date("2026-11-17T08:00:00.000Z");
const WALKED_AT: Date = new Date("2026-11-16T08:00:00.000Z");
const CREATED_AT: string = "2026-10-01T00:00:00.000Z";

function listVendor(vendor: string): JSONObject {
  return buildDiscoveredListEntries({
    reading: { endpointId: ENDPOINT_ID, name: "PROFUSION-733451", vendor },
    readAt: LIST_READ_AT,
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
    readAt: LIST_READ_AT,
    values: { model: "MS120-8LP" },
  }) as unknown as JSONObject;
}

function scannedObjectId(sysObjectId: string): JSONObject {
  return {
    sysObjectId: {
      value: sysObjectId,
      method: "snmp",
      readBy: {
        type: "discoveryScan",
        id: SCAN_ID,
        name: "Store subnets",
      },
      readAt: "2026-11-10T08:00:00.000Z",
    },
  };
}

// A device as a fixture writes it: its name, and what its maker is read from.
interface DeviceFixture {
  name: string;
  projectId?: ObjectID;
  vendor?: string;
  sysDescr?: string;
  sysObjectId?: string;
  lastSnmpSeenAt?: Date;
  discoveredDetails?: JSONObject;
  isArchived?: boolean;
}

/*
 * Every source of a maker, and every order of precedence between them, as
 * the Devices list meets them.
 */
const FLEET: ReadonlyArray<DeviceFixture> = [
  // Only the Discovered Devices list names its maker (issue #9305).
  {
    name: "kitchen-display-04",
    discoveredDetails: listVendor("Sunnovo International"),
  },
  // A vendor saved on the device, and nothing else.
  { name: "label-printer-02", vendor: "Zebra" },
  // Both: the saved one is the one the column shows.
  {
    name: "label-printer-03",
    vendor: "Zebra",
    discoveredDetails: listVendor("Sunnovo International"),
  },
  // What its own poll read, and the list's maker: the poll's.
  {
    name: "core-sw-01",
    vendor: "Cisco Systems, Inc.",
    sysObjectId: "1.3.6.1.4.1.9.1.1208",
    lastSnmpSeenAt: WALKED_AT,
    discoveredDetails: listVendor("Hon Hai Precision"),
  },
  // An SNMP agent's name is no maker: the list's maker is.
  {
    name: "pi-sensor-07",
    vendor: "Net-SNMP",
    sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
    lastSnmpSeenAt: WALKED_AT,
    discoveredDetails: listVendor("Raspberry Pi Trading"),
  },
  // Its controller's own name, over the list's maker.
  {
    name: "store-12-sw",
    discoveredDetails: {
      ...listVendor("Sunnovo International"),
      controller: merakiReading(),
    },
  },
  // The platform its sysDescr names, over the enterprise arc's vendor.
  {
    name: "edge-sw-09",
    vendor: "Broadcom",
    sysObjectId: "1.3.6.1.4.1.4413.1.1",
    sysDescr: "EdgeSwitch 24-Port Lite, 1.8.2.5249835, Linux 3.6.5-f4a26ed5",
    lastSnmpSeenAt: WALKED_AT,
  },
  // A ping-only device a discovery scan read over SNMP (issue #5185).
  {
    name: "branch-rtr-3",
    discoveredDetails: scannedObjectId("1.3.6.1.4.1.9.1.1208"),
  },
  // Nothing names a maker.
  { name: "10.0.0.9" },
  // Archived: the Archived list filters by Vendor too.
  {
    name: "old-printer-01",
    vendor: "Zebra",
    isArchived: true,
  },
];

// What a device's Vendor / Model column shows, by the cell's own function.
function shownMaker(device: DeviceFixture): string | null {
  return (
    getNetworkDeviceAssetFacts({
      name: device.name,
      vendor: device.vendor,
      sysDescr: device.sysDescr,
      sysObjectId: device.sysObjectId,
      lastSnmpSeenAt: device.lastSnmpSeenAt,
      discoveredDetails: device.discoveredDetails,
    }).manufacturer || null
  );
}

// What each text operator matches, as the other text filters match it.
type TextMatch = (shown: string | null) => boolean;

const CHIP_OPERATORS: Array<[string, unknown, TextMatch]> = [
  [
    "contains, in any case",
    new Search("SUNNOVO"),
    (shown: string | null): boolean => {
      return Boolean(shown && shown.toLowerCase().includes("sunnovo"));
    },
  ],
  [
    "contains part of a word",
    new Search("zeb"),
    (shown: string | null): boolean => {
      return Boolean(shown && shown.toLowerCase().includes("zeb"));
    },
  ],
  [
    "does not contain - a device with no maker included",
    new NotContains("zebra"),
    (shown: string | null): boolean => {
      return !shown || !shown.toLowerCase().includes("zebra");
    },
  ],
  [
    "is, exactly",
    new EqualTo("Cisco Meraki"),
    (shown: string | null): boolean => {
      return shown === "Cisco Meraki";
    },
  ],
  [
    "is not",
    new NotEqual("Zebra"),
    (shown: string | null): boolean => {
      return shown !== null && shown !== "Zebra";
    },
  ],
  [
    "starts with",
    new StartsWith("cis"),
    (shown: string | null): boolean => {
      return Boolean(shown && shown.toLowerCase().startsWith("cis"));
    },
  ],
  [
    "ends with",
    new EndsWith("TRADING"),
    (shown: string | null): boolean => {
      return Boolean(shown && shown.toLowerCase().endsWith("trading"));
    },
  ],
  [
    "is empty",
    new IsNull(),
    (shown: string | null): boolean => {
      return shown === null;
    },
  ],
  [
    "is not empty",
    new NotNull(),
    (shown: string | null): boolean => {
      return shown !== null;
    },
  ],
];

describePostgres(
  "the Vendor filter and sort of the device lists, on Postgres",
  () => {
    const schema: string = `device_manufacturer_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_DEVICE_MANUFACTURER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["NETWORK_DEVICE_MANUFACTURER_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_DEVICE_MANUFACTURER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=3000`,
          max: 4,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."NetworkDevice" (LIKE public."NetworkDevice" INCLUDING ALL)`,
      );
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'NetworkDevice' AND is_nullable = 'NO'`,
        [schema],
      );
      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."NetworkDevice" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest.spyOn(logger, "warn").mockImplementation((() => {
        return undefined;
      }) as never);
      await database.query(`DELETE FROM "${schema}"."NetworkDevice"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Inserted as a write that knew nothing of the maker would leave it.
    async function insertDevice(device: DeviceFixture): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "hostname", "vendor", "sysDescr",
          "sysObjectId", "lastSnmpSeenAt", "discoveredDetails", "isArchived",
          "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, '10.0.0.1', $4, $5, $6, $7, $8::jsonb, $9,
               $10, $10, 1)`,
        [
          id,
          (device.projectId || PROJECT_ID).toString(),
          device.name,
          device.vendor ?? null,
          device.sysDescr ?? null,
          device.sysObjectId ?? null,
          device.lastSnmpSeenAt ?? null,
          device.discoveredDetails
            ? JSON.stringify(device.discoveredDetails)
            : null,
          Boolean(device.isArchived),
          CREATED_AT,
        ],
      );

      return id;
    }

    async function insertFleet(): Promise<Map<string, DeviceFixture>> {
      const devices: Map<string, DeviceFixture> = new Map();

      for (const device of FLEET) {
        devices.set(await insertDevice(device), device);
      }

      await NetworkDeviceService.refreshManufacturer({
        deviceIds: Array.from(devices.keys()),
      });

      return devices;
    }

    async function rowOf(id: string): Promise<{
      manufacturer: string | null;
      updatedAt: Date;
      version: number;
    }> {
      const rows: Array<{
        manufacturer: string | null;
        updatedAt: Date;
        version: number;
      }> = await database.query(
        `SELECT "manufacturer", "updatedAt", "version" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    // The device list's read, as the dashboard's list request makes it.
    async function listIds(data: {
      query: Record<string, unknown>;
      sort?: Record<string, SortOrder>;
      skip?: number;
      limit?: number;
    }): Promise<Array<string>> {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: { projectId: PROJECT_ID, ...data.query } as never,
        select: { _id: true, name: true, manufacturer: true },
        sort: (data.sort || { name: SortOrder.Ascending }) as never,
        skip: data.skip || 0,
        limit: data.limit || 100,
        props: { isRoot: true },
      });

      return devices.map((device: NetworkDevice): string => {
        return device.id!.toString();
      });
    }

    test("the migrated table has the column, as the migration added it", async () => {
      const columns: Array<{
        data_type: string;
        character_maximum_length: number;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'NetworkDevice'
         AND column_name = 'manufacturer'`,
        [schema],
      );

      expect(columns).toEqual([
        {
          data_type: "character varying",
          character_maximum_length: 100,
          is_nullable: "YES",
          column_default: null,
        },
      ]);
    });

    describe("the filter finds each device under the maker its column shows", () => {
      test("a maker from discovery only, a saved one, both, and none", async () => {
        const devices: Map<string, DeviceFixture> = await insertFleet();
        const idOf: (name: string) => string = (name: string): string => {
          for (const [id, device] of devices) {
            if (device.name === name) {
              return id;
            }
          }
          throw new Error(name);
        };

        // The Devices list: the project's live devices, and the chip.
        const live: (filter: unknown) => Promise<Array<string>> = async (
          filter: unknown,
        ): Promise<Array<string>> => {
          return await listIds({
            query: { isArchived: false, manufacturer: filter },
          });
        };

        // Only the Discovered Devices list names it: found.
        expect(await live(new Search("sunnovo"))).toEqual([
          idOf("kitchen-display-04"),
        ]);

        // A saved vendor: still found, and with it the one that also has the list's maker.
        expect(await live(new Search("zebra"))).toEqual([
          idOf("label-printer-02"),
          idOf("label-printer-03"),
        ]);

        // Both there, the column shows the saved one: never found by the list's.
        expect(await live(new Search("hon hai"))).toEqual([]);

        // Its controller, an SNMP agent's list maker, a scan's reading, the sysDescr's platform.
        expect(await live(new EqualTo("Cisco Meraki"))).toEqual([
          idOf("store-12-sw"),
        ]);
        expect(await live(new Search("raspberry"))).toEqual([
          idOf("pi-sensor-07"),
        ]);
        expect(await live(new EqualTo("Cisco"))).toEqual([
          idOf("branch-rtr-3"),
        ]);
        expect(await live(new Search("ubiquiti"))).toEqual([
          idOf("edge-sw-09"),
        ]);
        expect(await live(new Search("broadcom"))).toEqual([]);

        // Nothing names one: found by "is empty" alone.
        expect(await live(new IsNull())).toEqual([idOf("10.0.0.9")]);

        // The Archived list finds an archived device the same way.
        expect(
          await listIds({
            query: { isArchived: true, manufacturer: new Search("zebra") },
          }),
        ).toEqual([idOf("old-printer-01")]);

        // The vendor column alone, as the filter read it before: misses it.
        expect(
          await listIds({
            query: { isArchived: false, vendor: new Search("sunnovo") },
          }),
        ).toEqual([]);
      });

      test.each(CHIP_OPERATORS)(
        "%s: exactly the devices whose column matches",
        async (_operator: string, filter: unknown, matches: TextMatch) => {
          const devices: Map<string, DeviceFixture> = await insertFleet();

          const expected: Array<string> = Array.from(devices.entries())
            .filter(([, device]: [string, DeviceFixture]): boolean => {
              return matches(shownMaker(device));
            })
            .map(([id]: [string, DeviceFixture]): string => {
              return id;
            })
            .sort();

          expect(
            (await listIds({ query: { manufacturer: filter } })).sort(),
          ).toEqual(expected);
        },
      );

      test("what is kept is what the column shows, for every device", async () => {
        const devices: Map<string, DeviceFixture> = await insertFleet();

        for (const [id, device] of devices) {
          expect([device.name, (await rowOf(id)).manufacturer]).toEqual([
            device.name,
            shownMaker(device),
          ]);
        }
      });
    });

    test("with the filter on, the database counts and pages the matching devices", async () => {
      const matching: Array<string> = [];

      for (let index: number = 0; index < 23; index++) {
        matching.push(
          await insertDevice({
            name: `display-${String(index).padStart(2, "0")}`,
            discoveredDetails: listVendor("Sunnovo International"),
          }),
        );
      }

      const others: Array<string> = [];

      for (let index: number = 0; index < 5; index++) {
        others.push(
          await insertDevice({ name: `printer-${index}`, vendor: "Zebra" }),
        );
      }

      others.push(await insertDevice({ name: "10.0.0.9" }));
      // Another project's device under the same maker is never counted.
      others.push(
        await insertDevice({
          name: "elsewhere",
          projectId: OTHER_PROJECT_ID,
          discoveredDetails: listVendor("Sunnovo International"),
        }),
      );

      await NetworkDeviceService.refreshManufacturer({
        deviceIds: [...matching, ...others],
      });

      const count: PositiveNumber = await NetworkDeviceService.countBy({
        query: {
          projectId: PROJECT_ID,
          manufacturer: new Search("sunnovo"),
        } as never,
        props: { isRoot: true },
      });
      expect(count.toNumber()).toBe(23);

      const pages: Array<Array<string>> = [];

      for (const skip of [0, 10, 20]) {
        pages.push(
          await listIds({
            query: { manufacturer: new Search("sunnovo") },
            skip: skip,
            limit: 10,
          }),
        );
      }

      expect(
        pages.map((page: Array<string>): number => {
          return page.length;
        }),
      ).toEqual([10, 10, 3]);
      // Every matching device on exactly one page.
      expect(pages.flat().sort()).toEqual([...matching].sort());
    });

    test("the Vendor / Model column's sort orders the list by the maker it shows", async () => {
      const devices: Map<string, DeviceFixture> = await insertFleet();

      const ascending: Array<string> = await listIds({
        query: { manufacturer: new NotNull() },
        sort: { manufacturer: SortOrder.Ascending },
      });
      const makersAscending: Array<string | null> = ascending.map(
        (id: string): string | null => {
          return shownMaker(devices.get(id)!);
        },
      );

      expect(makersAscending).toEqual([
        "Cisco",
        "Cisco Meraki",
        "Cisco Systems, Inc.",
        "Raspberry Pi Trading",
        "Sunnovo International",
        "Ubiquiti",
        "Zebra",
        "Zebra",
        "Zebra",
      ]);

      const descending: Array<string> = await listIds({
        query: { manufacturer: new NotNull() },
        sort: { manufacturer: SortOrder.Descending },
      });

      expect(
        descending.map((id: string): string | null => {
          return shownMaker(devices.get(id)!);
        }),
      ).toEqual([...makersAscending].reverse());
    });

    describe("every write of what the maker is read from writes it again", () => {
      test("a merge of the list's maker lists the device under it at once", async () => {
        const id: string = await insertDevice({ name: "kitchen-display-04" });

        await NetworkDeviceService.mergeDiscoveredDetails({
          projectId: PROJECT_ID,
          patches: [{ deviceId: id, set: listVendor("Sunnovo International") }],
        });

        expect((await rowOf(id)).manufacturer).toBe("Sunnovo International");
        expect(
          await listIds({ query: { manufacturer: new Search("sunnovo") } }),
        ).toEqual([id]);

        // The list's maker changes: the device follows.
        await NetworkDeviceService.mergeDiscoveredDetails({
          projectId: PROJECT_ID,
          patches: [{ deviceId: id, set: listVendor("Hon Hai Precision") }],
        });

        expect((await rowOf(id)).manufacturer).toBe("Hon Hai Precision");
      });

      test("a merge of anything else writes nothing, updatedAt and version included", async () => {
        const id: string = await insertDevice({
          name: "kitchen-display-04",
          discoveredDetails: listVendor("Sunnovo International"),
        });
        await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] });
        const before: { updatedAt: Date; version: number } = await rowOf(id);

        await NetworkDeviceService.mergeDiscoveredDetails({
          projectId: PROJECT_ID,
          patches: [
            {
              deviceId: id,
              set: {
                macAddress: {
                  value: "20:4b:22:91:d7:21",
                  method: "arpTable",
                  readBy: {
                    type: "networkDevice",
                    id: "60000000-0000-4000-8000-000000000001",
                    name: "core-rtr-01",
                  },
                  readAt: LIST_READ_AT.toISOString(),
                },
              },
            },
          ],
        });

        const after: {
          manufacturer: string | null;
          updatedAt: Date;
          version: number;
        } = await rowOf(id);
        expect(after.manufacturer).toBe("Sunnovo International");
        expect(new Date(after.updatedAt).toISOString()).toBe(
          new Date(before.updatedAt).toISOString(),
        );
        expect(after.version).toBe(before.version);
      });

      test("a connection's readings forgotten take its controller's maker with them", async () => {
        const id: string = await insertDevice({
          name: "store-12-sw",
          discoveredDetails: {
            ...listVendor("Sunnovo International"),
            controller: merakiReading(),
          },
        });
        await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] });
        expect((await rowOf(id)).manufacturer).toBe("Cisco Meraki");

        expect(
          await NetworkDeviceService.forgetControllerReadings({
            projectId: PROJECT_ID,
            connectionId: new ObjectID(CONNECTION_ID),
          }),
        ).toBe(1);

        // The list's maker is what the column shows now.
        expect((await rowOf(id)).manufacturer).toBe("Sunnovo International");
      });

      test("a hook-free write of the discovered details - an address change's - writes it again", async () => {
        const id: string = await insertDevice({
          name: "kitchen-display-04",
          discoveredDetails: listVendor("Sunnovo International"),
        });
        await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] });

        await NetworkDeviceService.updateColumnsByIdWithoutHooks({
          id: new ObjectID(id),
          data: { discoveredDetails: null } as never,
          skipUpdateDateColumn: true,
        });

        expect((await rowOf(id)).manufacturer).toBeNull();
        expect(
          await listIds({ query: { manufacturer: new IsNull() } }),
        ).toEqual([id]);
      });

      test("a device whose maker has not changed is not written", async () => {
        const id: string = await insertDevice({
          name: "label-printer-02",
          vendor: "Zebra",
        });

        expect(
          await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] }),
        ).toBe(1);
        const before: { updatedAt: Date; version: number } = await rowOf(id);

        expect(
          await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] }),
        ).toBe(0);
        const after: { updatedAt: Date; version: number } = await rowOf(id);

        expect(new Date(after.updatedAt).toISOString()).toBe(
          new Date(before.updatedAt).toISOString(),
        );
        expect(new Date(after.updatedAt).toISOString()).toBe(CREATED_AT);
        expect(after.version).toBe(before.version);
      });

      test("a deleted device is never written", async () => {
        const id: string = await insertDevice({
          name: "label-printer-02",
          vendor: "Zebra",
        });
        await database.query(
          `UPDATE "${schema}"."NetworkDevice" SET "deletedAt" = now() WHERE "_id" = $1`,
          [id],
        );

        expect(
          await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] }),
        ).toBe(0);
        expect((await rowOf(id)).manufacturer).toBeNull();
      });
    });

    describe("a maker is written only while the device holds what it was worked out from", () => {
      async function fingerprintOf(id: string): Promise<string> {
        const rows: Array<{ fingerprint: string }> = await database.query(
          `SELECT ${getManufacturerInputsFingerprintSql("nd")} AS "fingerprint"
         FROM "${schema}"."NetworkDevice" AS nd WHERE nd."_id" = $1`,
          [id],
        );
        return rows[0]!.fingerprint;
      }

      test("the same row gives the same fingerprint, in any time zone", async () => {
        const id: string = await insertDevice({
          name: "core-sw-01",
          vendor: "Cisco",
          lastSnmpSeenAt: WALKED_AT,
          discoveredDetails: listVendor("Hon Hai Precision"),
        });
        // A poll time to the microsecond, as now() stamps one.
        await database.query(
          `UPDATE "${schema}"."NetworkDevice" SET "lastSnmpSeenAt" = '2026-11-16 08:00:00.123456+00' WHERE "_id" = $1`,
          [id],
        );

        const fingerprint: string = await fingerprintOf(id);
        expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
        expect(await fingerprintOf(id)).toBe(fingerprint);

        const runner: ReturnType<DataSource["createQueryRunner"]> =
          database.createQueryRunner();
        try {
          await runner.query(`SET TIME ZONE 'Asia/Kolkata'`);
          const rows: Array<{ fingerprint: string }> = await runner.query(
            `SELECT ${getManufacturerInputsFingerprintSql("nd")} AS "fingerprint"
           FROM "${schema}"."NetworkDevice" AS nd WHERE nd."_id" = $1`,
            [id],
          );
          expect(rows[0]!.fingerprint).toBe(fingerprint);
        } finally {
          await runner.release();
        }
      });

      test.each([
        [`"vendor" = 'Cisco Systems'`],
        [`"sysDescr" = 'Cisco IOS Software, C2960X Software'`],
        [`"sysObjectId" = '1.3.6.1.4.1.9.1.1209'`],
        [`"lastSnmpSeenAt" = "lastSnmpSeenAt" + interval '1 microsecond'`],
        [`"discoveredDetails" = "discoveredDetails" - 'vendor'`],
      ])("a change of %s gives another", async (assignment: string) => {
        const id: string = await insertDevice({
          name: "core-sw-01",
          vendor: "Cisco",
          lastSnmpSeenAt: WALKED_AT,
          discoveredDetails: listVendor("Hon Hai Precision"),
        });
        const before: string = await fingerprintOf(id);

        await database.query(
          `UPDATE "${schema}"."NetworkDevice" SET ${assignment} WHERE "_id" = $1`,
          [id],
        );

        expect(await fingerprintOf(id)).not.toBe(before);
      });

      test("a change of any other column gives the same", async () => {
        const id: string = await insertDevice({
          name: "core-sw-01",
          vendor: "Cisco",
          lastSnmpSeenAt: WALKED_AT,
        });
        const before: string = await fingerprintOf(id);

        await database.query(
          `UPDATE "${schema}"."NetworkDevice"
         SET "name" = 'core-sw-02', "lastSeenAt" = now(), "isReachable" = true,
             "manufacturer" = 'Cisco'
         WHERE "_id" = $1`,
          [id],
        );

        expect(await fingerprintOf(id)).toBe(before);
      });

      test("a write that lands between the read and the write is never undone", async () => {
        const id: string = await insertDevice({
          name: "kitchen-display-04",
          discoveredDetails: listVendor("Sunnovo International"),
        });

        /*
         * The list's sync merges another maker after the refresh has read the
         * device and before it writes it: the write finds the device changed
         * and reads it again.
         */
        const query: (
          sql: string,
          parameters?: Array<unknown>,
        ) => Promise<unknown> = database.manager.query.bind(database.manager);
        let merged: boolean = false;

        jest
          .spyOn(database.manager, "query")
          .mockImplementation(
            async (
              sql: string,
              parameters?: Array<unknown>,
            ): Promise<never> => {
              if (!merged && sql.includes('SET "manufacturer" = $2')) {
                merged = true;
                await query(
                  `UPDATE "${schema}"."NetworkDevice"
                 SET "discoveredDetails" = $2::jsonb WHERE "_id" = $1`,
                  [id, JSON.stringify(listVendor("Hon Hai Precision"))],
                );
              }

              return (await query(sql, parameters)) as never;
            },
          );

        expect(
          await NetworkDeviceService.refreshManufacturer({ deviceIds: [id] }),
        ).toBe(1);
        expect(merged).toBe(true);
        expect((await rowOf(id)).manufacturer).toBe("Hon Hai Precision");
      });
    });

    test("the backfill works out every device of every project, archived ones too, and a second run writes nothing", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 7; index++) {
        ids.push(
          await insertDevice({
            name: `display-${index}`,
            projectId: index % 2 === 0 ? PROJECT_ID : OTHER_PROJECT_ID,
            isArchived: index === 3,
            discoveredDetails: listVendor("Sunnovo International"),
          }),
        );
      }

      ids.push(await insertDevice({ name: "10.0.0.9" }));

      async function runBackfill(): Promise<number> {
        let afterId: string | undefined = undefined;
        let written: number = 0;

        while (true) {
          const page: ManufacturerBackfillPage =
            await NetworkDeviceService.backfillManufacturerPage({
              afterId: afterId,
              limit: 3,
            });
          written += page.written;

          if (page.read < 3 || !page.lastId) {
            return written;
          }

          afterId = page.lastId;
        }
      }

      expect(await runBackfill()).toBe(7);

      for (const id of ids.slice(0, 7)) {
        const row: { manufacturer: string | null; updatedAt: Date } =
          await rowOf(id);
        expect(row.manufacturer).toBe("Sunnovo International");
        expect(new Date(row.updatedAt).toISOString()).toBe(CREATED_AT);
      }
      expect((await rowOf(ids[7]!)).manufacturer).toBeNull();

      expect(await runBackfill()).toBe(0);
    });
  },
);
