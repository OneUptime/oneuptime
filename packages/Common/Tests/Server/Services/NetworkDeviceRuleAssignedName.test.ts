import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import {
  ImportNaming,
  nameDeviceByRule,
} from "../../../Server/Services/NetworkDeviceNamingRuleEngineService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { DeviceNamingOutcome } from "../../../Types/NetworkDevice/DeviceNaming";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import { DiscoveryImportSettings } from "../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { buildNetworkDeviceFromDiscoveredHost } from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { buildNetworkDeviceFromDiscoveredDevice } from "../../../Utils/NetworkDiscovery/DiscoveredEndpointDeviceBuilder";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * NetworkDevice.ruleAssignedName (OneUptime issue #6619): the name a naming
 * rule gave a device. An import creates a rule-named device under the
 * rule's name and keeps the name discovery found as its discovered name -
 * the "original hostname" the issue asks to preserve - which is what the
 * create hook guarantees, driven here through the real onBeforeCreate:
 *
 *   - a create whose rule-assigned name IS its name records it, and keeps
 *     the payload's discovered name rather than overwriting it;
 *   - a rule-assigned name that is not the name (the collision fallback
 *     renamed the device) is dropped: a name not the rule's is not marked
 *     as the rule's;
 *   - only the server updates it: the column permissions let a device's
 *     creator create it, never update it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SITE_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
};

function internals(): DeviceServiceInternals {
  return new NetworkDeviceServiceType() as unknown as DeviceServiceInternals;
}

function createWith(fields: Record<string, unknown>): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;

  for (const [key, value] of Object.entries(fields)) {
    (device as unknown as Record<string, unknown>)[key] = value;
  }

  return { data: device, props: { isRoot: true } } as CreateBy<NetworkDevice>;
}

function created(result: OnCreate<NetworkDevice>): Record<string, unknown> {
  return result.createBy.data as unknown as Record<string, unknown>;
}

function naming(overrides: Partial<ImportNaming> = {}): ImportNaming {
  return {
    result: {
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216DRTPLR02",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    name: "UN1216DRTPLR02",
    discoveredName: "dmb-5",
    ...overrides,
  };
}

describe("a device a naming rule named keeps the name discovery found", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test("the rule's name is recorded, and the payload's discovered name is kept", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({
        name: " UN1216DRTPLR02 ",
        hostname: "10.48.145.55",
        ruleAssignedName: "UN1216DRTPLR02",
        discoveredName: " dmb-5 ",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(created(result)["name"]).toBe("UN1216DRTPLR02");
    expect(created(result)["ruleAssignedName"]).toBe("UN1216DRTPLR02");
    expect(created(result)["discoveredName"]).toBe("dmb-5");
    expect(created(result)["discoveredNameSource"]).toBe(
      DeviceNameSource.NetbiosName,
    );
  });

  test("a rule-assigned name that is not the device's name is dropped, and the name is discovery's", async () => {
    // The collision fallback renamed the device away from the rule's name.
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({
        name: "dmb-5 (10.48.145.55)",
        hostname: "10.48.145.55",
        ruleAssignedName: "UN1216DRTPLR02",
        discoveredName: "dmb-5",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(created(result)["ruleAssignedName"]).toBeUndefined();
    expect(created(result)["discoveredName"]).toBe("dmb-5 (10.48.145.55)");
  });

  test("named by a rule with no discovered name, the source is not kept alone", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({
        name: "UN1216DRTPLR02",
        hostname: "10.48.145.55",
        ruleAssignedName: "UN1216DRTPLR02",
        discoveredNameSource: DeviceNameSource.Address,
      }),
    );

    expect(created(result)["ruleAssignedName"]).toBe("UN1216DRTPLR02");
    expect(created(result)["discoveredName"]).toBeUndefined();
    expect(created(result)["discoveredNameSource"]).toBeUndefined();
  });

  test("a device named by a rule without any source keeps only the rule's name", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({
        name: "UN1216POPSCR01",
        hostname: "10.48.145.150",
        ruleAssignedName: "UN1216POPSCR01",
      }),
    );

    expect(created(result)["ruleAssignedName"]).toBe("UN1216POPSCR01");
    expect(created(result)["discoveredName"]).toBeUndefined();
  });

  test("a device nobody named by rule records no rule-assigned name", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({
        name: "WB1216KDS03",
        hostname: "10.48.145.53",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(created(result)["ruleAssignedName"]).toBeUndefined();
    expect(created(result)["discoveredName"]).toBe("WB1216KDS03");
  });
});

describe("nameDeviceByRule: the device an import builds under a rule's name", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test("a scan's host: the rule's name, discovery's name kept, created in the rule's site", async () => {
    const device: NetworkDevice = nameDeviceByRule({
      device: buildNetworkDeviceFromDiscoveredHost({
        projectId: PROJECT_ID,
        host: {
          ipAddress: "10.48.145.55",
          snmpReachable: false,
          netbiosName: "DMB-5",
        },
        // The scan's probe: a device created into a site keeps its own.
        scan: {
          useShortDeviceNames: false,
          probeId: new ObjectID("55555555-5555-4555-8555-555555555555"),
        },
        name: "UN1216DRTPLR02",
      }),
      naming: naming({ discoveredName: "DMB-5", siteId: SITE_ID }),
      address: "10.48.145.55",
      isDiscoveredDevice: false,
    });

    expect(device.name).toBe("UN1216DRTPLR02");
    expect(device.ruleAssignedName).toBe("UN1216DRTPLR02");
    expect(device.discoveredName).toBe("DMB-5");
    expect(device.discoveredNameSource).toBe(DeviceNameSource.NetbiosName);
    expect(device.siteId?.toString()).toBe(SITE_ID);
  });

  test("the create hook keeps what the builder named, discovery's name and all", async () => {
    // No site and no probe: nothing the hook reaches the database for.
    const device: NetworkDevice = nameDeviceByRule({
      device: buildNetworkDeviceFromDiscoveredHost({
        projectId: PROJECT_ID,
        host: {
          ipAddress: "10.48.145.55",
          snmpReachable: false,
          netbiosName: "DMB-5",
        },
        scan: { useShortDeviceNames: false },
        name: "UN1216DRTPLR02",
      }),
      naming: naming({ discoveredName: "DMB-5" }),
      address: "10.48.145.55",
      isDiscoveredDevice: false,
    });

    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate({
      data: device,
      props: { isRoot: true },
    } as CreateBy<NetworkDevice>);

    expect(created(result)["name"]).toBe("UN1216DRTPLR02");
    expect(created(result)["discoveredName"]).toBe("DMB-5");
    expect(created(result)["discoveredNameSource"]).toBe(
      DeviceNameSource.NetbiosName,
    );
    expect(created(result)["ruleAssignedName"]).toBe("UN1216DRTPLR02");
  });

  test("a device that already has a site keeps it", () => {
    const built: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: { ipAddress: "10.48.145.55", snmpReachable: false },
      scan: { useShortDeviceNames: false },
      name: "UN1216DRTPLR02",
    });
    const otherSite: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    );

    built.siteId = otherSite;

    expect(
      nameDeviceByRule({
        device: built,
        naming: naming({ siteId: SITE_ID }),
        address: "10.48.145.55",
        isDiscoveredDevice: false,
      }).siteId?.toString(),
    ).toBe(otherSite.toString());
  });

  test("a discovered device named by its address records that as its discovered name", () => {
    const settings: DiscoveryImportSettings = {
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: "None" as DiscoveryImportSettings["alerting"],
    };
    const device: NetworkDevice = nameDeviceByRule({
      device: buildNetworkDeviceFromDiscoveredDevice({
        projectId: PROJECT_ID,
        ipAddress: "10.64.145.159",
        facts: {
          endpointId: "endpoint-1",
          name: "10.64.145.159",
          macAddress: "38:8c:ef:09:9f:8a",
          siteId: SITE_ID,
        },
        settings: settings,
        name: "UN1216DRTSCR06",
      }),
      naming: naming({
        name: "UN1216DRTSCR06",
        discoveredName: "10.64.145.159",
      }),
      address: "10.64.145.159",
      isDiscoveredDevice: true,
    });

    expect(device.name).toBe("UN1216DRTSCR06");
    expect(device.ruleAssignedName).toBe("UN1216DRTSCR06");
    expect(device.discoveredNameSource).toBe(DeviceNameSource.Address);
    expect(device.discoveredName).toBe("10.64.145.159");
  });

  test("a discovered device a controller named records no source, as before", () => {
    const device: NetworkDevice = nameDeviceByRule({
      device: buildNetworkDeviceFromDiscoveredDevice({
        projectId: PROJECT_ID,
        ipAddress: "10.64.145.156",
        facts: {
          endpointId: "endpoint-2",
          name: "Samsung",
          macAddress: "c0:23:8d:ed:8b:07",
        },
        settings: {
          pollingIntervalInMinutes: 5,
          applyVendorTemplates: true,
          alerting: "None" as DiscoveryImportSettings["alerting"],
        },
        name: "UN1216DRTSCR03",
      }),
      naming: naming({ name: "UN1216DRTSCR03", discoveredName: "Samsung" }),
      address: "10.64.145.156",
      isDiscoveredDevice: true,
    });

    expect(device.ruleAssignedName).toBe("UN1216DRTSCR03");
    expect(device.discoveredNameSource).toBeUndefined();
    expect(device.discoveredName).toBeUndefined();
  });
});

describe("only the server updates the rule-assigned name: the column permissions", () => {
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
    device.ruleAssignedName = "UN1216DRTPLR02";

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
    Permission.CreateNetworkDevice,
  ])(
    "%s can import a device with its rule-assigned name",
    (permission: Permission) => {
      expect(check(permission, DatabaseRequestType.Create)).toBe("allowed");
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditNetworkDevice,
  ])(
    "%s cannot write a rule-assigned name on update",
    (permission: Permission) => {
      expect(check(permission, DatabaseRequestType.Update)).toBe(
        "refused: ruleAssignedName",
      );
    },
  );
});
