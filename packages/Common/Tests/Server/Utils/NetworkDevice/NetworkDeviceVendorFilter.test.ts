import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../../Server/Types/Database/Hooks";
import {
  MANUFACTURER_INPUTS_PAGE_SIZE,
  ManufacturerInputsQueryRunner,
  ShownVendorMatcher,
  buildManufacturerInputsStatement,
  buildMatchingIdsCondition,
  findDeviceIdsByShownVendor,
  readQueryProjectId,
  readShownVendorMatcher,
  withShownVendorFilter,
} from "../../../../Server/Utils/NetworkDevice/NetworkDeviceVendorFilter";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import { DEFAULT_DISCOVERY_IMPORT_SETTINGS } from "../../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../../Types/ObjectID";
import {
  NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS,
  NetworkDeviceAssetSource,
  getNetworkDeviceAssetFacts,
} from "../../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { buildNetworkDeviceFromDiscoveredDevice } from "../../../../Utils/NetworkDiscovery/DiscoveredEndpointDeviceBuilder";

/*
 * OneUptime issue #9363: the Devices list's Vendor / Model column showed a
 * maker that came only from the Discovered Devices list (#9359) - or one
 * read off the device's sysDescr or sysObjectID - and the Vendor filter,
 * which compared the `vendor` column alone, never found it.
 *
 * The filter now asks the column's own question (the asset facts' maker) of
 * every device of the project, on the server. These hold it to the column:
 * for every device below and every operator, the filter matches exactly the
 * devices whose shown maker matches.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);

function id(n: number): string {
  return `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// A device imported from a Discovered Devices row: its maker is the row's.
function importedFromList(vendor: string): NetworkDevice {
  return buildNetworkDeviceFromDiscoveredDevice({
    projectId: PROJECT_ID,
    ipAddress: "10.34.15.10",
    facts: {
      endpointId: "40000000-0000-4000-8000-000000000001",
      name: "PROFUSION-733451",
      macAddress: "20:4b:22:91:d7:21",
      vendor: vendor,
    },
    settings: DEFAULT_DISCOVERY_IMPORT_SETTINGS,
    readAt: new Date("2026-11-17T08:00:00.000Z"),
  });
}

interface DeviceRow extends Record<string, unknown> {
  _id: string;
}

function row(n: number, device: NetworkDeviceAssetSource): DeviceRow {
  return { ...(device as Record<string, unknown>), _id: id(n) };
}

const LIST_ONLY: DeviceRow = row(
  1,
  importedFromList("Sunnovo International") as NetworkDeviceAssetSource,
);

const DEVICES: Array<DeviceRow> = [
  // The issue's device: the maker is only in discoveredDetails.
  LIST_ONLY,
  // A saved vendor.
  row(2, { vendor: "Lantronix" }),
  // ENTITY-MIB's maker, kept as walked.
  row(3, {
    vendor: "Cisco Systems, Inc.",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysDescr: "Cisco IOS Software, Version 15.0(2)SE11",
    lastSnmpSeenAt: new Date("2026-11-17T08:00:00.000Z"),
  }),
  // The sysDescr names the platform; the column holds the bare arc.
  row(4, {
    vendor: "Broadcom",
    sysObjectId: "1.3.6.1.4.1.4413.1.1.43",
    sysDescr:
      "EdgeSwitch 24-Port Lite, 1.9.3.5089037, Linux 3.6.5-f4a26ed5, 0.0.00.0000",
    lastSnmpSeenAt: new Date("2026-11-17T08:00:00.000Z"),
  }),
  // Only the sysDescr says who: no vendor column at all.
  row(5, {
    sysDescr:
      "Meraki MX85 Cloud Managed Security Appliance, firmware MX 18.107",
  }),
  // An SNMP agent's name is never a maker; nothing else names one.
  row(6, {
    vendor: "Net-SNMP",
    sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
    sysDescr: "Linux fw01 5.10.0-21-amd64 #1 SMP x86_64",
    lastSnmpSeenAt: new Date("2026-11-17T08:00:00.000Z"),
  }),
  // Nothing at all.
  row(7, {}),
  // A saved vendor beats the list's maker.
  row(8, {
    vendor: "Axis",
    discoveredDetails: importedFromList("Sunnovo International")
      .discoveredDetails,
  }),
];

function shown(device: DeviceRow): string | undefined {
  return getNetworkDeviceAssetFacts(device as NetworkDeviceAssetSource)
    .manufacturer;
}

// A fake database: the rows of one project, paged by id as the statement asks.
function fakeRunner(
  rows: Array<DeviceRow>,
  calls?: Array<{ sql: string; params: Array<unknown> }>,
): ManufacturerInputsQueryRunner {
  return async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    calls?.push({ sql, params });
    const projectId: string = params[0] as string;
    const after: string | undefined =
      params.length === 3 ? (params[1] as string) : undefined;
    const limit: number = params[params.length - 1] as number;

    if (projectId !== PROJECT_ID.toString()) {
      return [];
    }

    return rows
      .filter((device: DeviceRow) => {
        return !after || device._id > after;
      })
      .sort((a: DeviceRow, b: DeviceRow) => {
        return a._id < b._id ? -1 : 1;
      })
      .slice(0, limit);
  };
}

describe("the devices the fixtures stand for", () => {
  test("show the makers the column names", () => {
    expect(DEVICES.map(shown)).toEqual([
      "Sunnovo International",
      "Lantronix",
      "Cisco Systems, Inc.",
      "Ubiquiti",
      "Cisco Meraki",
      undefined,
      undefined,
      "Axis",
    ]);
  });
});

describe("readShownVendorMatcher", () => {
  test.each([
    ["contains", new Search("sunnovo"), "Sunnovo International", true],
    ["contains, any case", new Search("  SUNNOVO "), "Sunnovo Intl", true],
    ["contains, no", new Search("cisco"), "Sunnovo International", false],
    ["contains, nothing shown", new Search("cisco"), undefined, false],
    ["does not contain", new NotContains("cisco"), "Ubiquiti", true],
    ["does not contain, no", new NotContains("ubi"), "Ubiquiti", false],
    ["does not contain, nothing shown", new NotContains("x"), undefined, true],
    ["starts with", new StartsWith("cisco"), "Cisco Meraki", true],
    ["starts with, no", new StartsWith("meraki"), "Cisco Meraki", false],
    ["ends with", new EndsWith("meraki"), "Cisco Meraki", true],
    ["ends with, no", new EndsWith("cisco"), "Cisco Meraki", false],
    ["is", new EqualTo("cisco meraki"), "Cisco Meraki", true],
    ["is, no", new EqualTo("cisco"), "Cisco Meraki", false],
    ["is not", new NotEqual("cisco"), "Cisco Meraki", true],
    ["is not, no", new NotEqual("CISCO MERAKI"), "Cisco Meraki", false],
    ["is not, nothing shown", new NotEqual("cisco"), undefined, true],
    ["is empty", new IsNull(), undefined, true],
    ["is empty, blank", new IsNull(), "  ", true],
    ["is empty, no", new IsNull(), "Axis", false],
    ["is not empty", new NotNull(), "Axis", true],
    ["is not empty, no", new NotNull(), undefined, false],
    ["any of", new Includes(["Axis", "ubiquiti"]), "Ubiquiti", true],
    ["any of, no", new Includes(["Axis"]), "Ubiquiti", false],
    ["a bare value is equality", "lantronix", "Lantronix", true],
    ["a bare value, no", "lantron", "Lantronix", false],
    ["null is empty", null, undefined, true],
  ])(
    "%s",
    (
      _name: string,
      value: unknown,
      shownVendor: string | undefined,
      expected: boolean,
    ) => {
      const matcher: ShownVendorMatcher | null = readShownVendorMatcher(value);

      expect(matcher).not.toBeNull();
      expect(matcher!(shownVendor)).toBe(expected);
    },
  );

  test("a LIKE wildcard in the value matches only itself", () => {
    const matcher: ShownVendorMatcher = readShownVendorMatcher(
      new Search("%"),
    )!;

    expect(matcher("Cisco")).toBe(false);
    expect(matcher("100% Networks")).toBe(true);
  });

  test("an operator it does not answer is left to the column", () => {
    expect(readShownVendorMatcher(new GreaterThan(3))).toBeNull();
    expect(readShownVendorMatcher(42)).toBeNull();
  });
});

describe("the filter matches exactly the devices whose shown maker matches", () => {
  const values: Array<[string, unknown]> = [
    ["contains sunnovo", new Search("sunnovo")],
    ["contains cisco", new Search("cisco")],
    ["is Ubiquiti", new EqualTo("Ubiquiti")],
    ["is not Axis", new NotEqual("Axis")],
    ["does not contain cisco", new NotContains("cisco")],
    ["starts with cisco", new StartsWith("cisco")],
    ["ends with international", new EndsWith("international")],
    ["is empty", new IsNull()],
    ["is not empty", new NotNull()],
  ];

  test.each(values)("%s", async (_name: string, value: unknown) => {
    const matcher: ShownVendorMatcher = readShownVendorMatcher(value)!;

    const ids: Array<string> = await findDeviceIdsByShownVendor({
      projectId: PROJECT_ID,
      matcher: matcher,
      runQuery: fakeRunner(DEVICES),
      pageSize: 3,
    });

    expect(ids).toEqual(
      DEVICES.filter((device: DeviceRow) => {
        return matcher(shown(device));
      }).map((device: DeviceRow) => {
        return device._id;
      }),
    );
  });

  test("the issue's device: a maker only discovery knows is found", async () => {
    expect(
      await findDeviceIdsByShownVendor({
        projectId: PROJECT_ID,
        matcher: readShownVendorMatcher(new Search("Sunnovo"))!,
        runQuery: fakeRunner(DEVICES),
      }),
    ).toEqual([LIST_ONLY._id]);
  });
});

describe("the maker reads only the columns the filter reads", () => {
  test.each(
    DEVICES.map((device: DeviceRow) => {
      return [device._id, device];
    }),
  )("%s", (_id: string, device: DeviceRow) => {
    const inputsOnly: Record<string, unknown> = {};

    for (const column of NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS) {
      inputsOnly[column] = device[column];
    }

    // Every other column the facts read, filled with something that names a maker.
    const everythingElse: NetworkDeviceAssetSource = {
      ...(inputsOnly as NetworkDeviceAssetSource),
      name: "Juniper core",
      hostname: "juniper-core.example.com",
      dnsName: "juniper-core.example.com",
      sysName: "juniper-core",
      deviceModel: "EX4300",
      serialNumber: "PE3714100218",
      firmwareVersion: "21.4R3",
      softwareVersion: "21.4R3",
      sysLocation: "Rack 4",
      sysContact: "noc@example.com",
      site: { name: "HQ" },
      networkDeviceRole: { key: "core", name: "Core Switch" },
    };

    expect(
      getNetworkDeviceAssetFacts(inputsOnly as NetworkDeviceAssetSource)
        .manufacturer,
    ).toBe(shown(device));
    expect(getNetworkDeviceAssetFacts(everythingElse).manufacturer).toBe(
      shown(device),
    );
  });
});

describe("buildManufacturerInputsStatement", () => {
  test("reads one page of the project's devices, with their maker's inputs", () => {
    const statement: { sql: string; params: Array<unknown> } =
      buildManufacturerInputsStatement({
        projectId: PROJECT_ID,
        limit: 500,
      });

    expect(statement.sql)
      .toBe(`SELECT d."_id"::text AS "_id", d."vendor", d."sysDescr", d."sysObjectId", d."lastSnmpSeenAt", d."discoveredDetails"
FROM "NetworkDevice" d
WHERE d."projectId" = $1::uuid
  AND d."deletedAt" IS NULL
ORDER BY d."_id" ASC
LIMIT $2`);
    expect(statement.params).toEqual([PROJECT_ID.toString(), 500]);
  });

  test("continues after the last device read, every value a parameter", () => {
    const statement: { sql: string; params: Array<unknown> } =
      buildManufacturerInputsStatement({
        projectId: PROJECT_ID,
        afterDeviceId: id(9),
        limit: 0,
      });

    expect(statement.sql).toContain(`AND d."_id" > $2::uuid`);
    expect(statement.sql).toContain(`LIMIT $3`);
    expect(statement.params).toEqual([PROJECT_ID.toString(), id(9), 1]);
  });

  test("pages until a short page", async () => {
    const calls: Array<{ sql: string; params: Array<unknown> }> = [];

    await findDeviceIdsByShownVendor({
      projectId: PROJECT_ID,
      matcher: readShownVendorMatcher(new NotNull())!,
      runQuery: fakeRunner(DEVICES, calls),
      pageSize: 4,
    });

    // 8 devices in pages of 4: two full pages, then an empty one.
    expect(
      calls.map((call: { params: Array<unknown> }) => {
        return call.params;
      }),
    ).toEqual([
      [PROJECT_ID.toString(), 4],
      [PROJECT_ID.toString(), id(4), 4],
      [PROJECT_ID.toString(), id(8), 4],
    ]);
  });

  test("the default page is a few thousand devices", () => {
    expect(MANUFACTURER_INPUTS_PAGE_SIZE).toBe(2000);
  });
});

describe("buildMatchingIdsCondition", () => {
  test("holds the row's id to the matching ids, through the table alias", () => {
    const condition: FindOperator<unknown> = buildMatchingIdsCondition([
      id(1),
      id(2),
    ]);

    expect(condition.type).toBe("raw");

    const sql: string = (
      condition.getSql as unknown as (alias: string) => string
    )("NetworkDevice.vendor");

    expect(sql).toMatch(
      /^\(NetworkDevice\._id = ANY\(CAST\(:[A-Za-z0-9]{10} AS uuid\[\]\)\)\)$/,
    );
    expect(Object.values(condition.objectLiteralParameters || {})).toEqual([
      [id(1), id(2)],
    ]);
  });
});

describe("readQueryProjectId", () => {
  test("the caller's project first", () => {
    expect(
      readQueryProjectId({
        tenantId: PROJECT_ID,
        query: { projectId: OTHER_PROJECT_ID },
      })?.toString(),
    ).toBe(PROJECT_ID.toString());
  });

  test("else the project the query names", () => {
    expect(
      readQueryProjectId({
        query: { projectId: OTHER_PROJECT_ID.toString() },
      })?.toString(),
    ).toBe(OTHER_PROJECT_ID.toString());
    expect(
      readQueryProjectId({
        tenantId: PROJECT_ID,
        isMultiTenantRequest: true,
        query: { projectId: OTHER_PROJECT_ID },
      })?.toString(),
    ).toBe(OTHER_PROJECT_ID.toString());
  });

  test("none when neither says", () => {
    expect(readQueryProjectId({ query: {} })).toBeUndefined();
    expect(
      readQueryProjectId({ query: { projectId: "not-an-id" } }),
    ).toBeUndefined();
  });
});

describe("withShownVendorFilter", () => {
  test("a query with no Vendor filter is left as it was, unread", async () => {
    const calls: Array<{ sql: string; params: Array<unknown> }> = [];
    const query: Record<string, unknown> = { name: new Search("core") };

    expect(
      await withShownVendorFilter({
        query: query,
        tenantId: PROJECT_ID,
        runQuery: fakeRunner(DEVICES, calls),
      }),
    ).toBe(query);
    expect(calls).toHaveLength(0);
  });

  test("a read across projects keeps the column's filter", async () => {
    const query: Record<string, unknown> = { vendor: new Search("x") };

    expect(
      await withShownVendorFilter({
        query: query,
        runQuery: fakeRunner(DEVICES),
      }),
    ).toBe(query);
  });

  test("the Vendor filter becomes the ids of the matching devices", async () => {
    const vendor: Search<string> = new Search("sunnovo");
    const query: Record<string, unknown> = {
      vendor: vendor,
      name: new Search("PROFUSION"),
    };

    const rewritten: Record<string, unknown> = await withShownVendorFilter({
      query: query,
      tenantId: PROJECT_ID,
      runQuery: fakeRunner(DEVICES),
    });

    // A new query: the caller's is left as it was.
    expect(query["vendor"]).toBe(vendor);
    expect(rewritten["name"]).toBe(query["name"]);

    const condition: FindOperator<unknown> = rewritten[
      "vendor"
    ] as FindOperator<unknown>;
    expect(condition).toBeInstanceOf(FindOperator);
    expect(Object.values(condition.objectLiteralParameters || {})).toEqual([
      [LIST_ONLY._id],
    ]);
  });

  test("another project's devices are never read", async () => {
    const rewritten: Record<string, unknown> = await withShownVendorFilter({
      query: { vendor: new NotNull() },
      tenantId: OTHER_PROJECT_ID,
      runQuery: fakeRunner(DEVICES),
    });

    expect(
      Object.values(
        (rewritten["vendor"] as FindOperator<unknown>)
          .objectLiteralParameters || {},
      ),
    ).toEqual([[]]);
  });

  test("a condition already written is not read again", async () => {
    const condition: FindOperator<unknown> = buildMatchingIdsCondition([]);
    const query: Record<string, unknown> = { vendor: condition };

    expect(
      await withShownVendorFilter({
        query: query,
        tenantId: PROJECT_ID,
        runQuery: fakeRunner(DEVICES),
      }),
    ).toBe(query);
  });
});

describe("NetworkDeviceService", () => {
  test("its reads answer the Vendor filter on the maker the list shows", async () => {
    const service: typeof NetworkDeviceService = NetworkDeviceService;
    const repository: unknown = {
      manager: {
        query: fakeRunner(DEVICES),
      },
    };
    const getRepository: jest.SpiedFunction<() => unknown> = jest
      .spyOn(
        service as unknown as { getRepository: () => unknown },
        "getRepository",
      )
      .mockReturnValue(repository);

    try {
      const onFind: OnFind<NetworkDevice> = await (
        service as unknown as {
          onBeforeFind: (
            findBy: FindBy<NetworkDevice>,
          ) => Promise<OnFind<NetworkDevice>>;
        }
      ).onBeforeFind({
        query: { vendor: new Search("sunnovo") },
        select: { _id: true },
        props: { tenantId: PROJECT_ID },
      } as unknown as FindBy<NetworkDevice>);

      const condition: FindOperator<unknown> = (
        onFind.findBy.query as Record<string, unknown>
      )["vendor"] as FindOperator<unknown>;

      expect(condition).toBeInstanceOf(FindOperator);
      expect(Object.values(condition.objectLiteralParameters || {})).toEqual([
        [LIST_ONLY._id],
      ]);
    } finally {
      getRepository.mockRestore();
    }
  });

  test("its read hook keeps no device from anyone", () => {
    expect(NetworkDeviceService.getColumnsReadHooksNarrowBy()).toEqual([]);
  });
});
