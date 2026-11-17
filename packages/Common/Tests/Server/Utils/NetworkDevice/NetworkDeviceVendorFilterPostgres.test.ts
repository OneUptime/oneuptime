import {
  ManufacturerInputsQueryRunner,
  buildMatchingIdsCondition,
  findDeviceIdsByShownVendor,
  readShownVendorMatcher,
} from "../../../../Server/Utils/NetworkDevice/NetworkDeviceVendorFilter";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import ObjectID from "../../../../Types/ObjectID";
import {
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReaderType,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, EntitySchema, FindOperator } from "typeorm";

/*
 * The Devices list's Vendor filter (OneUptime issue #9363), EXECUTED on
 * Postgres.
 *
 * The unit suite (NetworkDeviceVendorFilter) reads the statement's text and
 * the condition's SQL; only a database shows that the statement returns the
 * maker's inputs as the asset facts read them (jsonb as an object, a
 * timestamp as a Date), pages by id within one project and leaves deleted
 * devices out, and that the condition TypeORM writes from the vendor key -
 * through the alias it hands the Raw - narrows the list and its count to
 * the matching devices, beside the list's other filters.
 *
 * Self-contained: a NetworkDevice table with only the columns read here, in
 * a unique schema that is dropped afterwards, so any Postgres will do. Opt
 * in with RUN_POSTGRES_NETWORK_DEVICE_VENDOR_FILTER_TESTS=true. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * NETWORK_DEVICE_VENDOR_FILTER_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from NETWORK_DEVICE_VENDOR_FILTER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_DEVICE_VENDOR_FILTER_TESTS"] === "true"
    ? describe
    : describe.skip;

interface DeviceRow {
  _id: string;
  projectId: string;
  name: string;
  vendor: string | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  lastSnmpSeenAt: Date | null;
  discoveredDetails: unknown;
  isArchived: boolean;
  deletedAt: Date | null;
}

// The NetworkDevice table, as far as the filter and the list read it.
const NetworkDeviceSchema: EntitySchema<DeviceRow> =
  new EntitySchema<DeviceRow>({
    name: "NetworkDevice",
    tableName: "NetworkDevice",
    columns: {
      _id: { type: "uuid", primary: true },
      projectId: { type: "uuid" },
      name: { type: "varchar" },
      vendor: { type: "varchar", nullable: true },
      sysDescr: { type: "text", nullable: true },
      sysObjectId: { type: "varchar", nullable: true },
      lastSnmpSeenAt: { type: "timestamptz", nullable: true },
      discoveredDetails: { type: "jsonb", nullable: true },
      isArchived: { type: "boolean", default: false },
      deletedAt: { type: "timestamptz", nullable: true },
    },
  });

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);

function id(n: number): string {
  return `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function listVendor(vendor: string): unknown {
  return {
    vendor: {
      value: vendor,
      method: NetworkDeviceDiscoveryMethod.DiscoveredDeviceList,
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveredDevice,
        id: "40000000-0000-4000-8000-000000000001",
        name: "PROFUSION-733451",
      },
      readAt: "2026-11-17T08:00:00.000Z",
    },
  };
}

function device(n: number, fields: Partial<DeviceRow>): DeviceRow {
  return {
    _id: id(n),
    projectId: PROJECT_ID.toString(),
    name: `device-${n}`,
    vendor: null,
    sysDescr: null,
    sysObjectId: null,
    lastSnmpSeenAt: null,
    discoveredDetails: null,
    isArchived: false,
    deletedAt: null,
    ...fields,
  };
}

const ROWS: Array<DeviceRow> = [
  // The issue's device: the maker is only on the Discovered Devices list.
  device(1, { discoveredDetails: listVendor("Sunnovo International") }),
  device(2, { vendor: "Lantronix" }),
  // Polled: ENTITY-MIB's maker.
  device(3, {
    vendor: "Cisco Systems, Inc.",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysDescr: "Cisco IOS Software, Version 15.0(2)SE11",
    lastSnmpSeenAt: new Date("2026-11-17T08:00:00.000Z"),
  }),
  // Only the sysDescr names it.
  device(4, {
    sysDescr:
      "Meraki MX85 Cloud Managed Security Appliance, firmware MX 18.107",
  }),
  // An SNMP agent beside the list's maker: the list's maker is shown.
  device(5, {
    vendor: "Net-SNMP",
    sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
    sysDescr: "Linux cam01 5.10.0-21-amd64 #1 SMP x86_64",
    lastSnmpSeenAt: new Date("2026-11-17T08:00:00.000Z"),
    discoveredDetails: listVendor("Sunnovo International"),
  }),
  device(6, {}),
  // Archived: listed by the filter, left out by the list's own condition.
  device(7, {
    discoveredDetails: listVendor("Sunnovo International"),
    isArchived: true,
  }),
  // Deleted: never read.
  device(8, {
    discoveredDetails: listVendor("Sunnovo International"),
    deletedAt: new Date("2026-11-16T08:00:00.000Z"),
  }),
  // Another project's device.
  device(9, {
    projectId: OTHER_PROJECT_ID.toString(),
    discoveredDetails: listVendor("Sunnovo International"),
  }),
];

describePostgres("the Devices list's Vendor filter, on Postgres", () => {
  const schema: string = `network_device_vendor_filter_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let runQuery: ManufacturerInputsQueryRunner;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["NETWORK_DEVICE_VENDOR_FILTER_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["NETWORK_DEVICE_VENDOR_FILTER_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_DEVICE_VENDOR_FILTER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [NetworkDeviceSchema],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`CREATE TABLE "NetworkDevice" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "name" varchar NOT NULL,
      "vendor" varchar,
      "sysDescr" text,
      "sysObjectId" varchar,
      "lastSnmpSeenAt" timestamptz,
      "discoveredDetails" jsonb,
      "isArchived" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz
    )`);
    await database.getRepository(NetworkDeviceSchema).insert(ROWS);

    runQuery = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      return (await database.query(sql, params)) as Array<
        Record<string, unknown>
      >;
    };
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function idsFor(value: unknown, pageSize?: number): Promise<string[]> {
    return await findDeviceIdsByShownVendor({
      projectId: PROJECT_ID,
      matcher: readShownVendorMatcher(value)!,
      runQuery: runQuery,
      pageSize: pageSize,
    });
  }

  test("a maker only discovery knows is found, as the column shows it", async () => {
    expect(await idsFor(new Search("sunnovo"))).toEqual([id(1), id(5), id(7)]);
  });

  test("so is one read off the sysDescr", async () => {
    expect(await idsFor(new EqualTo("Cisco Meraki"))).toEqual([id(4)]);
  });

  test("the empty cells", async () => {
    expect(await idsFor(new IsNull())).toEqual([id(6)]);
  });

  test("the same devices, a page of two at a time", async () => {
    expect(await idsFor(new NotEqual("Lantronix"), 2)).toEqual([
      id(1),
      id(3),
      id(4),
      id(5),
      id(6),
      id(7),
    ]);
  });

  test("the condition narrows the list and its count, beside the other filters", async () => {
    const condition: FindOperator<unknown> = buildMatchingIdsCondition(
      await idsFor(new Search("sunnovo")),
    );

    const where: Record<string, unknown> = {
      projectId: PROJECT_ID.toString(),
      isArchived: false,
      vendor: condition,
    };

    const found: Array<DeviceRow> = await database
      .getRepository(NetworkDeviceSchema)
      .find({
        where: where,
        order: { _id: "ASC" },
        select: { _id: true, name: true },
      });

    expect(
      found.map((row: DeviceRow) => {
        return row._id;
      }),
    ).toEqual([id(1), id(5)]);

    expect(
      await database.getRepository(NetworkDeviceSchema).count({ where: where }),
    ).toBe(2);
  });

  test("no match is no device", async () => {
    expect(
      await database.getRepository(NetworkDeviceSchema).count({
        where: {
          projectId: PROJECT_ID.toString(),
          vendor: buildMatchingIdsCondition([]),
        } as Record<string, unknown>,
      }),
    ).toBe(0);
  });
});
