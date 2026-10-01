import Entities from "../../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import {
  describeNetworkDevice,
  ErasedInventorySource,
  INVENTORY_SOURCES,
  InventorySyncResult,
  syncInventorySource,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The inventory mirror's reconcile EXECUTED on Postgres (issue #4107).
 *
 * Two things only a real database shows:
 *
 *   1. A mirrored network device's Attributes card now carries its serial,
 *      MAC, make, model and firmware. The unit suites prove `describe`
 *      builds that bag; this proves the reconcile writes it into the
 *      migrated `jsonb` column and that it reads back intact.
 *
 *   2. The drift check compared `JSON.stringify` of the bag it built with
 *      the bag it read back. jsonb does not keep insertion order — it
 *      stores keys shortest-first — so any bag with keys of different
 *      lengths looked drifted on every pass and every such row was
 *      rewritten every fifteen minutes. The cloud-resource mirror had been
 *      doing it all along; the richer network-device bag would have joined
 *      it. The unit suite simulates jsonb's ordering; this uses jsonb.
 *
 * Opt in with RUN_POSTGRES_INVENTORY_MIRROR_TESTS=true against a Postgres
 * migrated to the current head — the Postgres Schema Drift workflow's
 * database right after its drift check. The NetworkDevice, CloudResource
 * and InventoryItem STRUCTURES are cloned into a unique schema (search_path
 * holds only that schema) that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * INVENTORY_MIRROR_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * INVENTORY_MIRROR_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_MIRROR_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "NetworkDevice",
  "CloudResource",
  "InventoryItem",
];

// Columns a fixture row must fill; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
];

const PROJECT_ID: ObjectID = ObjectID.generate();

function sourceFor(resourceType: string): ErasedInventorySource {
  const source: ErasedInventorySource | undefined = INVENTORY_SOURCES.find(
    (candidate: ErasedInventorySource) => {
      return candidate.resourceType === resourceType;
    },
  );
  if (!source) {
    throw new Error(`No inventory source for ${resourceType}`);
  }
  return source;
}

describePostgres("inventory mirror reconcile against Postgres", () => {
  const schema: string = `inventory_mirror_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INVENTORY_MIRROR_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["INVENTORY_MIRROR_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INVENTORY_MIRROR_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );
      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    /*
     * A failed mirror write is caught and logged at error, not thrown —
     * that is the reconcile's design. So a Postgres rejection would show
     * up here as a quiet zero; failing on any error log makes it loud.
     */
    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      throw new Error(`reconcile logged an error: ${String(message)}`);
    });
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    // The only side effects that leave Postgres.
    jest
      .spyOn(InventoryItemService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(InventoryItemService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const DEVICE_ID: ObjectID = ObjectID.generate();

  async function insertPolledSwitch(): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "slug", "hostname", "dnsName",
          "macAddress", "vendor", "deviceModel", "serialNumber",
          "firmwareVersion", "softwareVersion", "sysDescr", "isArchived",
          "version")
       VALUES ($1, $2, 'core-sw-01', 'core-sw-01', '10.20.0.1',
               'core-sw-01.corp.example.com', '00:1b:54:c2:7a:01', 'Cisco',
               'WS-C3850-48P', 'FOC1840X0AB', '16.12.4', '16.12.04',
               'Cisco IOS Software, Catalyst L3 Switch Software, Version 16.12.4',
               false, 1)`,
      [DEVICE_ID.toString(), PROJECT_ID.toString()],
    );
  }

  async function setDeviceColumn(
    column: string,
    value: string | null,
  ): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."NetworkDevice" SET "${column}" = $1 WHERE "_id" = $2`,
      [value, DEVICE_ID.toString()],
    );
  }

  async function mirroredBag(): Promise<JSONObject> {
    const rows: Array<{ descriptiveAttributes: JSONObject }> =
      await database.query(
        `SELECT "descriptiveAttributes" FROM "${schema}"."InventoryItem"
         WHERE "resourceId" = $1`,
        [DEVICE_ID.toString()],
      );
    expect(rows).toHaveLength(1);
    return rows[0]!.descriptiveAttributes;
  }

  async function syncNetwork(): Promise<InventorySyncResult> {
    return syncInventorySource(sourceFor("NetworkDevice"));
  }

  test("a polled switch is mirrored with its full asset bag", async () => {
    await insertPolledSwitch();

    const result: InventorySyncResult = await syncNetwork();
    expect(result).toEqual({ created: 1, updated: 0, deleted: 0, archived: 0 });

    expect(await mirroredBag()).toEqual({
      "net.device.hostname": "10.20.0.1",
      "net.device.dns_name": "core-sw-01.corp.example.com",
      "host.mac": "00-1B-54-C2-7A-01",
      "device.manufacturer": "Cisco",
      "device.model.name": "WS-C3850-48P",
      "host.serial_number": "FOC1840X0AB",
      "device.firmware.version": "16.12.4",
      "os.version": "16.12.04",
      "os.description":
        "Cisco IOS Software, Catalyst L3 Switch Software, Version 16.12.4",
    });
  });

  test("jsonb really does hand the bag back in a different key order", async () => {
    /*
     * Pins the premise of the drift fix, so the steady-state test below
     * cannot pass for the wrong reason.
     */
    await insertPolledSwitch();
    await syncNetwork();

    const device: NetworkDevice = new NetworkDevice();
    device.hostname = "10.20.0.1";
    device.dnsName = "core-sw-01.corp.example.com";
    device.macAddress = "00:1b:54:c2:7a:01";
    device.vendor = "Cisco";
    device.deviceModel = "WS-C3850-48P";
    device.serialNumber = "FOC1840X0AB";
    device.firmwareVersion = "16.12.4";
    device.softwareVersion = "16.12.04";
    device.sysDescr =
      "Cisco IOS Software, Catalyst L3 Switch Software, Version 16.12.4";

    const built: JSONObject = describeNetworkDevice(device) as JSONObject;
    const readBack: JSONObject = await mirroredBag();

    expect(readBack).toEqual(built);
    expect(Object.keys(readBack)).not.toEqual(Object.keys(built));
    // The comparison the drift check used to make.
    expect(JSON.stringify(readBack)).not.toBe(JSON.stringify(built));
  });

  test("a second pass over an unchanged switch writes nothing", async () => {
    await insertPolledSwitch();
    await syncNetwork();

    const before: Array<{ version: number; updatedAt: Date }> =
      await database.query(
        `SELECT "version", "updatedAt" FROM "${schema}"."InventoryItem"`,
      );

    expect(await syncNetwork()).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      archived: 0,
    });

    const after: Array<{ version: number; updatedAt: Date }> =
      await database.query(
        `SELECT "version", "updatedAt" FROM "${schema}"."InventoryItem"`,
      );
    expect(after).toEqual(before);
  });

  test("a cloud resource's four-key bag is steady too", async () => {
    await database.query(
      `INSERT INTO "${schema}"."CloudResource"
         ("_id", "projectId", "name", "resourceIdentifier", "cloudProvider",
          "cloudRegion", "cloudAccountId", "isArchived", "version")
       VALUES ($1, $2, 'i-0abc',
               'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc', 'aws',
               'us-east-1', '123456789012', false, 1)`,
      [ObjectID.generate().toString(), PROJECT_ID.toString()],
    );

    const cloud: ErasedInventorySource = sourceFor("CloudResource");
    expect((await syncInventorySource(cloud)).created).toBe(1);
    expect(await syncInventorySource(cloud)).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      archived: 0,
    });
  });

  test("a chassis swap reaches the card on the next pass", async () => {
    await insertPolledSwitch();
    await syncNetwork();

    await setDeviceColumn("serialNumber", "FOC2231Y0ZZ");
    await setDeviceColumn("firmwareVersion", "17.3.1");

    expect((await syncNetwork()).updated).toBe(1);
    const bag: JSONObject = await mirroredBag();
    expect(bag["host.serial_number"]).toBe("FOC2231Y0ZZ");
    expect(bag["device.firmware.version"]).toBe("17.3.1");
    // Nothing else moved.
    expect(bag["device.model.name"]).toBe("WS-C3850-48P");
  });

  /*
   * The mirror replaces the bag rather than merging into it, so a fact
   * that stops being known leaves the card instead of lingering.
   */
  test("a cleared MAC leaves the card", async () => {
    await insertPolledSwitch();
    await syncNetwork();

    await setDeviceColumn("macAddress", null);

    expect((await syncNetwork()).updated).toBe(1);
    const bag: JSONObject = await mirroredBag();
    expect(Object.keys(bag)).not.toContain("host.mac");
    expect(Object.keys(bag)).toHaveLength(8);
  });

  test("a device that was mirrored before its first walk fills in", async () => {
    await database.query(
      `INSERT INTO "${schema}"."NetworkDevice"
         ("_id", "projectId", "name", "slug", "hostname", "isArchived",
          "version")
       VALUES ($1, $2, 'core-sw-01', 'core-sw-01', '10.20.0.1', false, 1)`,
      [DEVICE_ID.toString(), PROJECT_ID.toString()],
    );
    await syncNetwork();
    expect(await mirroredBag()).toEqual({ "net.device.hostname": "10.20.0.1" });

    await setDeviceColumn("vendor", "Cisco");
    await setDeviceColumn("serialNumber", "FOC1840X0AB");

    expect((await syncNetwork()).updated).toBe(1);
    expect(await mirroredBag()).toEqual({
      "net.device.hostname": "10.20.0.1",
      "device.manufacturer": "Cisco",
      "host.serial_number": "FOC1840X0AB",
    });
  });

  test("the mirrored row is still read back through the service", async () => {
    await insertPolledSwitch();
    await syncNetwork();

    const item: InventoryItem | null = await InventoryItemService.findOneBy({
      query: { resourceId: DEVICE_ID },
      select: { descriptiveAttributes: true, displayName: true },
      props: { isRoot: true },
    });

    expect(item?.displayName).toBe("core-sw-01");
    expect(item?.descriptiveAttributes?.["host.serial_number"]).toBe(
      "FOC1840X0AB",
    );
  });
});
