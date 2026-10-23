import {
  DISCOVERED_DETAILS_MERGE_CHUNK_SIZE,
  Service as NetworkDeviceServiceType,
} from "../../../Server/Services/NetworkDeviceService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { SERVER_MANAGED_COLUMNS_BY_TABLE } from "../../../Utils/DeveloperDocs/TerraformSchema";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * NetworkDevice.discoveredDetails (OneUptime issue #5185): what discovery
 * found out about a device, where and when - kept apart from the device's own
 * columns, so nothing a person saved and nothing the device's poll read is
 * ever overwritten by it. These pin the server's side of that promise:
 *
 *   - the one write after create is a batched jsonb merge, scoped to the
 *     project and to live devices, that touches only the keys it names and
 *     writes only what the column's reader accepts;
 *   - an import may create a device with it, and nobody may update it - not
 *     even a project owner; only the server, hook-free;
 *   - a device moved to another address keeps none of it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const SCAN_READER: JSONObject = {
  type: "discoveryScan",
  id: "80000000-0000-4000-8000-000000000001",
  name: "Store subnets",
};
const READ_AT: string = "2026-10-23T09:00:00.000Z";

function sysNameEntry(value: string = "edge-sw-07"): JSONObject {
  return { value: value, method: "snmp", readBy: SCAN_READER, readAt: READ_AT };
}

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<NetworkDevice>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<NetworkDevice>>;
  clearDiscoveredDetailsAfterAddressChange: (
    onUpdate: OnUpdate<NetworkDevice>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<void>;
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

describe("mergeDiscoveredDetails - the one write after create", () => {
  type QueryFunction = (
    sql: string,
    parameters: Array<unknown>,
  ) => Promise<unknown>;

  let query: Mock<QueryFunction>;
  let service: NetworkDeviceServiceType;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
      return [];
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  function rowsOf(callIndex: number): Array<JSONObject> {
    const parameters: Array<unknown> = query.mock.calls[callIndex]![1];
    return JSON.parse(parameters[0] as string) as Array<JSONObject>;
  }

  test("one statement: (details - unset) || set, for live devices of the project only", async () => {
    const sent: number = await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: DEVICE_ID,
          set: { sysName: sysNameEntry() },
          unset: ["otherMachine"],
        },
      ],
    });

    expect(sent).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);

    const sql: string = query.mock.calls[0]![0].replace(/\s+/g, " ");
    expect(sql).toContain('UPDATE "NetworkDevice" AS nd');
    expect(sql).toContain(
      'SET "discoveredDetails" = (COALESCE(nd."discoveredDetails", \'{}\'::jsonb) - patch."unset") || patch."set"',
    );
    expect(sql).toContain(
      'FROM jsonb_to_recordset($1::jsonb) AS patch("id" uuid, "set" jsonb, "unset" text[])',
    );
    expect(sql).toContain('WHERE nd."_id" = patch."id"');
    expect(sql).toContain('AND nd."projectId" = $2');
    expect(sql).toContain('AND nd."deletedAt" IS NULL');
    // Never a column other than the one it owns, and never updatedAt.
    expect(sql).not.toContain("updatedAt");

    expect(query.mock.calls[0]![1][1]).toBe(PROJECT_ID.toString());
    expect(rowsOf(0)).toEqual([
      {
        id: DEVICE_ID.toString(),
        set: { sysName: sysNameEntry() },
        unset: ["otherMachine"],
      },
    ]);
  });

  test("only what the column's reader accepts is written", async () => {
    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: DEVICE_ID,
          set: {
            sysName: sysNameEntry(),
            // Wrong reader for a MAC: never credited to a scan.
            macAddress: {
              value: "00:1b:54:c2:7a:01",
              method: "arpTable",
              readBy: SCAN_READER,
              readAt: READ_AT,
            },
            // Not a key of the column.
            vendor: sysNameEntry("Cisco"),
          },
          unset: ["vendor", "sysLocation", "name", "sysName"],
        },
      ],
    });

    expect(rowsOf(0)).toEqual([
      {
        id: DEVICE_ID.toString(),
        set: { sysName: sysNameEntry() },
        // Not a key of the column: never dropped. Set in the same patch: kept.
        unset: ["sysLocation"],
      },
    ]);
  });

  test("a patch with nothing left to write, or no real device id, sends nothing", async () => {
    const sent: number = await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        { deviceId: DEVICE_ID, set: { vendor: "x" }, unset: ["name"] },
        { deviceId: "not-a-uuid", set: { sysName: sysNameEntry() } },
        { deviceId: "", set: { sysName: sysNameEntry() } },
      ],
    });

    expect(sent).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test("a dropped key needs no value: unset alone is a patch", async () => {
    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [{ deviceId: DEVICE_ID.toString(), unset: ["otherMachine"] }],
    });

    expect(rowsOf(0)).toEqual([
      { id: DEVICE_ID.toString(), set: {}, unset: ["otherMachine"] },
    ]);
  });

  test("thousands of devices go in statements of DISCOVERED_DETAILS_MERGE_CHUNK_SIZE", async () => {
    expect(DISCOVERED_DETAILS_MERGE_CHUNK_SIZE).toBe(500);

    const patches: Array<{ deviceId: string; set: JSONObject }> = [];
    for (let index: number = 0; index < 1201; index++) {
      patches.push({
        deviceId: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
        set: { sysName: sysNameEntry(`sw-${index}`) },
      });
    }

    const sent: number = await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: patches,
    });

    expect(sent).toBe(1201);
    expect(query).toHaveBeenCalledTimes(3);
    expect([rowsOf(0).length, rowsOf(1).length, rowsOf(2).length]).toEqual([
      500, 500, 201,
    ]);
    // Every chunk is the same project's, and one jsonb parameter however big.
    for (const call of query.mock.calls) {
      expect(call[1]).toHaveLength(2);
      expect(call[1][1]).toBe(PROJECT_ID.toString());
    }
  });

  test("a failed statement surfaces to the caller, who logs it", async () => {
    query.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      service.mergeDiscoveredDetails({
        projectId: PROJECT_ID,
        patches: [{ deviceId: DEVICE_ID, set: { sysName: sysNameEntry() } }],
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("a create may carry them; the server keeps only what it would write", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  function createWith(
    fields: Record<string, unknown>,
  ): CreateBy<NetworkDevice> {
    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;

    for (const [key, value] of Object.entries(fields)) {
      (device as unknown as Record<string, unknown>)[key] = value;
    }

    return { data: device, props: { isRoot: true } } as CreateBy<NetworkDevice>;
  }

  async function createdDetails(discoveredDetails: unknown): Promise<unknown> {
    const { internals } = buildDeviceService();
    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({
        name: "edge-sw-07",
        hostname: "10.20.12.7",
        discoveredDetails: discoveredDetails,
      }),
    );

    return (result.createBy.data as unknown as Record<string, unknown>)[
      "discoveredDetails"
    ];
  }

  test("an import's details are kept as they are", async () => {
    expect(
      await createdDetails({
        sysName: sysNameEntry(),
        foundBy: { readBy: SCAN_READER, readAt: READ_AT },
      }),
    ).toEqual({
      sysName: sysNameEntry(),
      foundBy: { readBy: SCAN_READER, readAt: READ_AT },
    });
  });

  test("anything OneUptime would not have written is dropped, not refused", async () => {
    expect(
      await createdDetails({
        sysName: sysNameEntry(),
        vendor: sysNameEntry("Cisco"),
        dnsName: {
          value: "x",
          method: "snmp",
          readBy: SCAN_READER,
          readAt: READ_AT,
        },
      }),
    ).toEqual({ sysName: sysNameEntry() });
  });

  test("nothing worth keeping is no details at all", async () => {
    expect(await createdDetails({ vendor: "x" })).toBeNull();
    expect(await createdDetails("garbage")).toBeNull();
  });

  test("a create without them is left without them", async () => {
    const { internals } = buildDeviceService();
    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWith({ name: "by hand", hostname: "10.0.0.1" }),
    );

    expect(
      (result.createBy.data as unknown as Record<string, unknown>)[
        "discoveredDetails"
      ],
    ).toBeUndefined();
  });
});

describe("the column: created with the device, updated by nobody but the server", () => {
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
    fields: Record<string, unknown>,
    permission: Permission,
    requestType: DatabaseRequestType,
  ): string {
    const device: NetworkDevice = new NetworkDevice();
    for (const [key, value] of Object.entries(fields)) {
      (device as unknown as Record<string, unknown>)[key] = value;
    }

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
    "%s can import a device with what its scan read",
    (permission: Permission) => {
      expect(
        check(
          {
            name: "edge-sw-07",
            hostname: "10.20.12.7",
            discoveredDetails: { sysName: sysNameEntry() },
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
  ])("%s can never write what discovery read", (permission: Permission) => {
    expect(
      check(
        { discoveredDetails: { sysName: sysNameEntry("typed") } },
        permission,
        DatabaseRequestType.Update,
      ),
    ).toBe("refused: discoveredDetails");
  });

  test("everyone who can read a device can read where its details came from", () => {
    const access: { read?: Array<Permission> } | null =
      new NetworkDevice().getColumnAccessControlFor("discoveredDetails");

    for (const permission of [
      Permission.Viewer,
      Permission.SettingsViewer,
      Permission.ReadNetworkDevice,
    ]) {
      expect(access?.read).toContain(permission);
    }
  });

  test("an optional JSON column, left out of the Terraform configuration", () => {
    const model: NetworkDevice = new NetworkDevice();
    const column: { type?: TableColumnType; required?: boolean } | undefined =
      model.getTableColumnMetadata("discoveredDetails");

    expect(column?.type).toBe(TableColumnType.JSON);
    expect(column?.required).toBe(false);
    expect(SERVER_MANAGED_COLUMNS_BY_TABLE["NetworkDevice"]).toContain(
      "discoveredDetails",
    );
  });
});

describe("a device moved to another address keeps none of it", () => {
  function previous(id: ObjectID, hostname: string): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.id = id;
    device.projectId = PROJECT_ID;
    device.hostname = hostname;
    return device;
  }

  function onUpdate(
    data: Record<string, unknown>,
    previousDevices: Array<NetworkDevice>,
  ): OnUpdate<NetworkDevice> {
    return {
      updateBy: {
        query: { _id: DEVICE_ID.toString() },
        data: data,
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>,
      carryForward: { previousDevices: previousDevices },
    };
  }

  type UpdateSpy = SpyInstance<
    NetworkDeviceServiceType["updateColumnsByIdWithoutHooks"]
  >;

  function clearedIds(spy: UpdateSpy): Array<string> {
    return spy.mock.calls.map((call: Array<unknown>): string => {
      const input: JSONObject = call[0] as JSONObject;
      expect(input["data"]).toEqual({ discoveredDetails: null });
      expect(input["skipUpdateDateColumn"]).toBe(true);
      return (input["id"] as ObjectID).toString();
    });
  }

  test("a new address clears them, hook-free and without moving updatedAt", async () => {
    const { service, internals } = buildDeviceService();
    const spy: UpdateSpy = jest
      .spyOn(service, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await internals.clearDiscoveredDetailsAfterAddressChange(
      onUpdate({ hostname: "10.20.12.99" }, [
        previous(DEVICE_ID, "10.20.12.7"),
      ]),
      [DEVICE_ID],
    );

    expect(clearedIds(spy)).toEqual([DEVICE_ID.toString()]);
  });

  test("the same address, in another case or with spaces, keeps them", async () => {
    const { service, internals } = buildDeviceService();
    const spy: UpdateSpy = jest
      .spyOn(service, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await internals.clearDiscoveredDetailsAfterAddressChange(
      onUpdate({ hostname: " CORE-FW-01.acme.example " }, [
        previous(DEVICE_ID, "core-fw-01.acme.example"),
      ]),
      [DEVICE_ID],
    );

    expect(spy).not.toHaveBeenCalled();
  });

  test("a write that does not touch the address keeps them", async () => {
    const { service, internals } = buildDeviceService();
    const spy: UpdateSpy = jest
      .spyOn(service, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await internals.clearDiscoveredDetailsAfterAddressChange(
      onUpdate({ name: "renamed" }, [previous(DEVICE_ID, "10.20.12.7")]),
      [DEVICE_ID],
    );

    expect(spy).not.toHaveBeenCalled();
  });

  test("of several devices, only those whose address changed - and only those updated", async () => {
    const { service, internals } = buildDeviceService();
    const spy: UpdateSpy = jest
      .spyOn(service, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    const third: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333335",
    );

    await internals.clearDiscoveredDetailsAfterAddressChange(
      onUpdate({ hostname: "10.20.12.7" }, [
        previous(DEVICE_ID, "10.20.12.7"),
        previous(OTHER_DEVICE_ID, "10.20.12.8"),
        previous(third, "10.20.12.9"),
      ]),
      [DEVICE_ID, OTHER_DEVICE_ID],
    );

    expect(clearedIds(spy)).toEqual([OTHER_DEVICE_ID.toString()]);
  });

  test("the update hook runs it in its own try: a failure costs nothing else", async () => {
    const { service, internals } = buildDeviceService();
    jest
      .spyOn(service, "updateColumnsByIdWithoutHooks")
      .mockRejectedValue(new Error("connection reset"));
    const reconcile: SpyInstance<() => Promise<void>> = jest
      .spyOn(
        service as unknown as {
          reconcileAlertPoliciesAfterUpdate: () => Promise<void>;
        },
        "reconcileAlertPoliciesAfterUpdate",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        service as unknown as {
          applySiteAssignmentRulesToDevice: () => Promise<void>;
        },
        "applySiteAssignmentRulesToDevice",
      )
      .mockResolvedValue(undefined);

    const update: OnUpdate<NetworkDevice> = onUpdate(
      { hostname: "10.20.12.99" },
      [previous(DEVICE_ID, "10.20.12.7")],
    );

    await expect(internals.onUpdateSuccess(update, [DEVICE_ID])).resolves.toBe(
      update,
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
