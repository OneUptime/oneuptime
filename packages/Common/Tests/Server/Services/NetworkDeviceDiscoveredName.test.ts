import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { buildNetworkDeviceFromDiscoveredHost } from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * NetworkDevice.discoveredName and discoveredNameSource (OneUptime issue
 * #4518): the name a discovery scan gave a device, and where it came from.
 * A later scan renames a device only while its name is still EXACTLY the
 * discovered one, so the pair has to mean "the device was created with this
 * name, from this source" — which is what the create hook guarantees, driven
 * here through the real onBeforeCreate:
 *
 *   - a create carrying a source records the name the device is created
 *     under (after the nameless-create default, trimmed), whatever the
 *     payload said the discovered name was;
 *   - a create without one records neither, so a device made by hand or
 *     through the API is a person's to name;
 *   - a source nobody can read is refused, on create and on update, while
 *     a blank one is no source;
 *   - after create, only the server writes the pair: the column permissions
 *     let an operator create a device with it, never update it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();

  return {
    service: service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

/*
 * A create with nothing that makes the hook reach for the database: no site,
 * no probe, no monitor, no template. Fields go through a loose record so a
 * test can hand the hook values the model's types would not allow.
 */
function createWith(fields: Record<string, unknown>): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;

  for (const [key, value] of Object.entries(fields)) {
    (device as unknown as Record<string, unknown>)[key] = value;
  }

  return {
    data: device,
    props: { isRoot: true },
  } as CreateBy<NetworkDevice>;
}

function created(result: OnCreate<NetworkDevice>): Record<string, unknown> {
  return result.createBy.data as unknown as Record<string, unknown>;
}

describe("a discovery import records the name the device is created under", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test("the name, trimmed, is recorded as the discovered name, with its source", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "  WB0024KDS04 ",
        hostname: "10.16.42.54",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(created(result)["name"]).toBe("WB0024KDS04");
    expect(created(result)["discoveredName"]).toBe("WB0024KDS04");
    expect(created(result)["discoveredNameSource"]).toBe(
      DeviceNameSource.NetbiosName,
    );
  });

  test("the payload's own discovered name is overridden by the name the device actually gets", async () => {
    /*
     * The Review dialog's collision retry renames the device object after the
     * first create fails: the recorded name must be the retried name, or the
     * device would look renamed by a person from its very first poll.
     */
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "WB0024KDS04 (10.16.42.54)",
        hostname: "10.16.42.54",
        discoveredName: "WB0024KDS04",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(created(result)["discoveredName"]).toBe("WB0024KDS04 (10.16.42.54)");
  });

  test("a nameless create from discovery records the address it is named after", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        hostname: " 10.16.42.52 ",
        discoveredNameSource: DeviceNameSource.Address,
      }),
    );

    expect(created(result)["name"]).toBe("10.16.42.52");
    expect(created(result)["discoveredName"]).toBe("10.16.42.52");
  });

  test("the device the shared builder makes goes through unchanged", async () => {
    const { internals } = buildDeviceService();
    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: {
        ipAddress: "10.16.42.55",
        snmpReachable: false,
        netbiosName: "WB0024KDS05",
        dnsHostname: "wb-0024-kds05.wbhq.com",
      },
      scan: { useShortDeviceNames: true },
    });

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate({
      data: device,
      props: { isRoot: true },
    } as CreateBy<NetworkDevice>);

    expect(created(result)["name"]).toBe("WB0024KDS05");
    expect(created(result)["discoveredName"]).toBe("WB0024KDS05");
    expect(created(result)["discoveredNameSource"]).toBe(
      DeviceNameSource.NetbiosName,
    );
    expect(created(result)["dnsName"]).toBe("wb-0024-kds05.wbhq.com");
  });
});

describe("a device nobody claims discovery named records nothing", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test("a device added by hand gets no discovered name", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({ name: "Register 4", hostname: "10.20.30.44" }),
    );

    expect(created(result)["discoveredName"]).toBeUndefined();
    expect(created(result)["discoveredNameSource"]).toBeUndefined();
  });

  test("a discovered name sent without a source is dropped", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "Register 4",
        hostname: "10.20.30.44",
        discoveredName: "Register 4",
      }),
    );

    expect(created(result)["discoveredName"]).toBeUndefined();
  });

  test("a null source records nothing either", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "Register 4",
        hostname: "10.20.30.44",
        discoveredNameSource: null,
        discoveredName: "Register 4",
      }),
    );

    expect(created(result)["discoveredName"]).toBeUndefined();
    expect(created(result)["discoveredNameSource"]).toBeUndefined();
  });

  test("a source with no name at all records nothing, and leaves the required check to say so", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({ discoveredNameSource: DeviceNameSource.Address }),
    );

    expect(created(result)["discoveredName"]).toBeUndefined();
    expect(created(result)["discoveredNameSource"]).toBeUndefined();
    expect(created(result)["name"]).toBeUndefined();
  });
});

describe("a source nobody can read is refused", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test.each([
    ["a made-up source", "typed"],
    ["the enum key instead of its value", "NetbiosName"],
    ["a number", 3],
    ["an object", { source: "address" }],
  ])("on create: %s", async (_label: string, source: unknown) => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeCreate(
        createWith({
          name: "Register 4",
          hostname: "10.20.30.44",
          discoveredNameSource: source,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("the message names every source it accepts", async () => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeCreate(
        createWith({
          name: "Register 4",
          hostname: "10.20.30.44",
          discoveredNameSource: "typed",
        }),
      ),
    ).rejects.toThrow(
      "Discovered Name Source must be one of: system-name, netbios-name, dns-name, address.",
    );
  });

  test("on update, before any read", async () => {
    const { service, internals } = buildDeviceService();
    const findBySpy: SpyInstance<typeof service.findBy> = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { discoveredNameSource: "typed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("on update, a known source and a cleared one pass", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    for (const source of [DeviceNameSource.SystemName, null]) {
      const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { discoveredNameSource: source },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>);

      expect(
        (result.updateBy.data as unknown as Record<string, unknown>)[
          "discoveredNameSource"
        ],
      ).toBe(source);
    }
  });

  test("an update that does not mention the source is untouched", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { description: "Kitchen display, store 24" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(result.updateBy.data).not.toHaveProperty("discoveredNameSource");
    expect(result.updateBy.data).not.toHaveProperty("discoveredName");
  });
});

describe("a blank source is no source", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test.each([
    ["empty", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])(
    "on create (%s): the device is created, with no discovered name",
    async (_label: string, source: string) => {
      const { internals } = buildDeviceService();

      const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
        createWith({
          name: "Register 4",
          hostname: "10.20.30.44",
          discoveredName: "Register 4",
          discoveredNameSource: source,
        }),
      );

      expect(created(result)["name"]).toBe("Register 4");
      expect(created(result)["discoveredName"]).toBeUndefined();
      expect(created(result)["discoveredNameSource"]).toBeUndefined();
    },
  );

  test("on create, a known source with spaces around it is recorded without them", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "WB0024KDS04",
        hostname: "10.16.42.54",
        discoveredNameSource: " netbios-name ",
      }),
    );

    expect(created(result)["discoveredNameSource"]).toBe(
      DeviceNameSource.NetbiosName,
    );
    expect(created(result)["discoveredName"]).toBe("WB0024KDS04");
  });

  test("on update, a blank source clears it, and a spaced one is trimmed", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    for (const [written, stored] of [
      ["", null],
      ["  ", null],
      [" dns-name ", DeviceNameSource.DnsName],
    ] as Array<[string, string | null]>) {
      const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { discoveredNameSource: written },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>);

      expect(
        (result.updateBy.data as unknown as Record<string, unknown>)[
          "discoveredNameSource"
        ],
      ).toBe(stored);
    }
  });
});

describe("only the server updates the pair: the column permissions", () => {
  // A user holding one permission in the project, as the API hands props over.
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

  function deviceWith(fields: Record<string, unknown>): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();

    for (const [key, value] of Object.entries(fields)) {
      (device as unknown as Record<string, unknown>)[key] = value;
    }

    return device;
  }

  // "allowed", or the column the check refused.
  function check(
    fields: Record<string, unknown>,
    permission: Permission,
    requestType: DatabaseRequestType,
  ): string {
    try {
      ColumnPermissions.checkDataColumnPermissions(
        NetworkDevice,
        deviceWith(fields),
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
    Permission.CreateNetworkDevice,
  ])(
    "%s can import a device with its discovered name and source",
    (permission: Permission) => {
      expect(
        check(
          {
            name: "WB0024KDS04",
            hostname: "10.16.42.54",
            discoveredName: "WB0024KDS04",
            discoveredNameSource: DeviceNameSource.NetbiosName,
          },
          permission,
          DatabaseRequestType.Create,
        ),
      ).toBe("allowed");
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditNetworkDevice,
  ])(
    "%s can rename a device, but never mark a name as discovered",
    (permission: Permission) => {
      expect(
        check({ name: "Kitchen 4" }, permission, DatabaseRequestType.Update),
      ).toBe("allowed");

      expect(
        check(
          { discoveredNameSource: DeviceNameSource.Address },
          permission,
          DatabaseRequestType.Update,
        ),
      ).toBe("refused: discoveredNameSource");

      expect(
        check(
          { name: "Kitchen 4", discoveredName: "Kitchen 4" },
          permission,
          DatabaseRequestType.Update,
        ),
      ).toBe("refused: discoveredName");
    },
  );
});

describe("a rename by a person needs nothing from the server to be respected", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  /*
   * The update hook does not touch the discovered name when the name changes:
   * the rename pass compares the two, so a name that differs from the
   * discovered one is a person's by construction. Pinned here so a future
   * "helpful" hook that kept them in step would fail loudly — it would turn
   * every typed name into one a scan may overwrite.
   */
  test("renaming a device leaves its discovered name and source as they were", async () => {
    const { service, internals } = buildDeviceService();
    const previous: NetworkDevice = new NetworkDevice(DEVICE_ID);
    previous.projectId = PROJECT_ID;
    previous.name = "WB0024KDS04";
    jest.spyOn(service, "findBy").mockResolvedValue([previous] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "Kitchen display 4" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(result.updateBy.data).toEqual({ name: "Kitchen display 4" });
  });
});
