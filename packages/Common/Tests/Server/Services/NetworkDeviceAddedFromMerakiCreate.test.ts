import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import AuditLogService from "../../../Server/Services/AuditLogService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../Server/Services/ProbeService";
import ColumnsOnlyOneUptimeWrites from "../../../Server/Utils/Database/ColumnsOnlyOneUptimeWrites";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import logger from "../../../Server/Utils/Logger";
import { buildNetworkDeviceFromController } from "../../../Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import NetworkControllerDeviceAddRunner, {
  getDeviceAddColumnsLeftOutReason,
} from "../../../Server/Utils/NetworkController/NetworkControllerDeviceAddRunner";
import { NetworkControllerDevice } from "../../../Server/Utils/NetworkController/NetworkControllerTypes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ServerOwned from "../../../Types/Database/ServerOwned";
import BadDataException from "../../../Types/Exception/BadDataException";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import { readNetworkDeviceDiscoveredDetails } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DEVICE ADDED FROM MERAKI, THROUGH THE CREATE EVERY DEVICE TAKES
 * (#10188).
 *
 * Add devices creates each device as the person who asked
 * (NetworkControllerDeviceAddRunner), through NetworkDeviceService.create
 * - the column permissions, ColumnsOnlyOneUptimeWrites and the hooks of
 * every create - with what Meraki says the box is written as OneUptime's
 * (buildNetworkDeviceFromController). On 16.0.0 the serial number was the
 * person's, nobody may give one on a create, and every device was refused.
 * Since #10053 a person's own value in such a column is dropped without a
 * word: a create that dropped the serial number would add a device the
 * next read and the next ask no longer find by it.
 *
 * So, for every role that may create devices, the device the job builds
 * goes through the create whole: its serial number, MAC, address, role,
 * site, probe and Meraki's reading are stored, and its creator is the
 * person. Every column the build fills is either the person's to create
 * or marked as OneUptime's - a column that is neither fails here by name.
 * The same values sent as a person's own lose the serial number, as the
 * API means them to; the job never sends a device that would
 * (assertCreateKeepsAll).
 */

const PROJECT: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000201");
const PERSON: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000202");
const ROLE: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000203");
const SITE: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000204");
const PROBE: ObjectID = new ObjectID("10188000-0000-4000-8000-000000000205");
const CONNECTION: string = "10188000-0000-4000-8000-000000000206";
const READ_AT: Date = new Date("2026-11-20T09:00:00.000Z");

const SWITCH: NetworkControllerDevice = {
  serial: "Q2HP-0660-SW01",
  name: "SW-1",
  model: "MS225-48LP",
  mac: "88:15:44:aa:00:01",
  lanIp: "10.66.0.2",
  firmware: "switch-16-7",
  productType: "switch",
  controllerNetworkId: "L_0660",
  networkName: "Store 0660",
  address: "1 Main Street, Springfield",
};

function propsWith(
  permissions: Array<Permission>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: PROJECT,
    userId: PERSON,
    userTenantAccessPermission: { [PROJECT.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

// Every role a person may create network devices with.
const CREATORS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a Project Owner", propsWith([Permission.ProjectOwner])],
  ["a Project Admin", propsWith([Permission.ProjectAdmin])],
  ["a Project Member", propsWith([Permission.ProjectMember])],
  ["a Settings Admin", propsWith([Permission.SettingsAdmin])],
  ["a Settings Member", propsWith([Permission.SettingsMember])],
  [
    "a custom role that may create network devices",
    propsWith([Permission.CreateNetworkDevice]),
  ],
  ["a server admin", propsWith([], { isMasterAdmin: true })],
];

function built(): NetworkDevice {
  return buildNetworkDeviceFromController({
    projectId: PROJECT,
    device: SWITCH,
    name: "SW-1 (Store 0660)",
    connection: {
      id: CONNECTION,
      name: "Acme Retail",
      provider: NetworkControllerProvider.Meraki,
    },
    readAt: READ_AT,
    roleId: ROLE,
    siteId: SITE,
    probeId: PROBE,
  });
}

let devices: InMemoryTable;

beforeEach(() => {
  stubProjectDirectory({});
  devices = useInMemoryTable(NetworkDeviceService, []);

  jest
    .spyOn(ProbeService, "isProbeAttachableToProject")
    .mockResolvedValue(true);
  jest
    .spyOn(
      NetworkDeviceService as unknown as {
        onCreateSuccess: (onCreate: unknown, created: unknown) => unknown;
      },
      "onCreateSuccess",
    )
    .mockImplementation(async (_onCreate: unknown, created: unknown) => {
      return created;
    });
  jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);

  for (const silenced of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

function storedRow(): StoredRow {
  expect(devices.inserts).toHaveLength(1);
  return devices.rows[0]!;
}

describe("the device Add devices builds, through NetworkDeviceService.create", () => {
  test.each(CREATORS)(
    "%s: stored whole - its serial number, MAC, address, role, site, probe and Meraki's reading - with the person as its creator",
    async (_role: string, props: DatabaseCommonInteractionProps) => {
      const device: NetworkDevice = built();

      // Nothing the build gave it would be left out of the person's create.
      expect(() => {
        NetworkControllerDeviceAddRunner.assertCreateKeepsAll(device, props);
      }).not.toThrow();

      await NetworkDeviceService.create({ data: device, props });

      const row: StoredRow = storedRow();
      expect(row["serialNumber"]).toBe("Q2HP-0660-SW01");
      expect(row["macAddress"]).toBe("88:15:44:aa:00:01");
      expect(row["hostname"]).toBe("10.66.0.2");
      expect(row["name"]).toBe("SW-1 (Store 0660)");
      expect(String(row["networkDeviceRoleId"])).toBe(ROLE.toString());
      expect(String(row["siteId"])).toBe(SITE.toString());
      expect(String(row["probeId"])).toBe(PROBE.toString());
      expect(row["manufacturer"]).toBe("Cisco Meraki");
      expect(
        readNetworkDeviceDiscoveredDetails(row["discoveredDetails"]).controller
          ?.values.serialNumber,
      ).toBe("Q2HP-0660-SW01");
      expect(String(row["createdByUserId"])).toBe(PERSON.toString());
    },
  );

  test("every column the build fills is the person's to create, or written as OneUptime's - none is dropped or refused", () => {
    const device: NetworkDevice = built();
    const record: Record<string, unknown> = device as unknown as Record<
      string,
      unknown
    >;
    const creator: Array<Permission> = [Permission.CreateNetworkDevice];

    const filled: Array<string> = device
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return record[column] !== undefined;
      });

    expect(filled.sort()).toEqual(
      [
        "discoveredDetails",
        "hostname",
        "macAddress",
        "name",
        "networkDeviceRoleId",
        "probeId",
        "projectId",
        "serialNumber",
        "siteId",
      ].sort(),
    );

    for (const column of filled) {
      const createList: Array<Permission> =
        device.getColumnAccessControlFor(column)?.create || [];
      const isPersons: boolean = creator.some((permission: Permission) => {
        return createList.includes(permission);
      });
      const isOneUptimes: boolean = ServerSetColumns.isMarked(device, column);

      // A column only OneUptime writes is marked as OneUptime's.
      if (
        device.getTableColumnMetadata(column)?.serverOwned ===
        ServerOwned.Always
      ) {
        expect([column, isOneUptimes]).toEqual([column, true]);
      }

      expect([column, isPersons || isOneUptimes]).toEqual([column, true]);
    }

    // What Meraki says the box is, OneUptime's; what Add Device asks, the person's.
    expect(ServerSetColumns.getMarked(device).sort()).toEqual(
      ["discoveredDetails", "macAddress", "serialNumber"].sort(),
    );
  });

  test("no MAC from Meraki: none is written, nor marked", () => {
    const device: NetworkDevice = buildNetworkDeviceFromController({
      projectId: PROJECT,
      device: { ...SWITCH, mac: "" },
      name: "SW-1",
      connection: {
        id: CONNECTION,
        name: "Acme Retail",
        provider: NetworkControllerProvider.Meraki,
      },
      readAt: READ_AT,
    });

    expect(device.macAddress).toBeUndefined();
    expect(ServerSetColumns.isMarked(device, "macAddress")).toBe(false);
    expect(ServerSetColumns.isMarked(device, "serialNumber")).toBe(true);
  });
});

describe("the same values, sent as a person's own", () => {
  function sentByAPerson(): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT;
    device.name = "SW-1";
    device.hostname = "10.66.0.2";
    device.serialNumber = "Q2HP-0660-SW01";
    device.macAddress = "88:15:44:aa:00:01";
    return device;
  }

  test("a person's create keeps the MAC and leaves the serial number out: only OneUptime writes one (#10053)", async () => {
    await NetworkDeviceService.create({
      data: sentByAPerson(),
      props: propsWith([Permission.ProjectOwner]),
    });

    const row: StoredRow = storedRow();
    expect(row["serialNumber"]).toBeUndefined();
    expect(row["macAddress"]).toBe("88:15:44:aa:00:01");
  });

  test("the job never sends such a device: it is that device's failure, naming the column", () => {
    const props: DatabaseCommonInteractionProps = propsWith([
      Permission.ProjectOwner,
    ]);

    expect(
      ColumnsOnlyOneUptimeWrites.getSentByCaller({
        model: sentByAPerson(),
        record: sentByAPerson(),
        props,
      }),
    ).toEqual(["serialNumber"]);

    let refusal: unknown = null;

    try {
      NetworkControllerDeviceAddRunner.assertCreateKeepsAll(
        sentByAPerson(),
        props,
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(
      getDeviceAddColumnsLeftOutReason(["serialNumber"]),
    );
    expect((refusal as Error).message).toBe(
      "OneUptime could not write this device's serialNumber from Meraki, so it was not added. Contact OneUptime support.",
    );
  });

  test("OneUptime itself, or a server admin, may write it as their own", () => {
    for (const props of [
      { isRoot: true, tenantId: PROJECT },
      propsWith([], { isMasterAdmin: true }),
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(() => {
        NetworkControllerDeviceAddRunner.assertCreateKeepsAll(
          sentByAPerson(),
          props,
        );
      }).not.toThrow();
    }
  });
});
