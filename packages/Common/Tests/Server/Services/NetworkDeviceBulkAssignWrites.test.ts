/*
 * What the server does with the writes the Devices list's bulk actions send:
 * Set Site / Clear Site ({ siteId }), Set Device Role / Clear Device Role
 * ({ networkDeviceRoleId }) and Apply Vendor Template ({ snmpOids,
 * snmpTables }). The actions send one ordinary device update per device -
 * nothing here is a new endpoint - so this suite holds the server hooks to
 * what the actions promise, through the real NetworkDeviceService:
 *
 *   - a site move gives a device without a probe the site's default probe,
 *     keeps a device's own, and re-rolls the health of the site it left and
 *     the site it joined; a clear re-rolls only the one it left;
 *   - a site or role of another project is refused, in words the bulk result
 *     shows against the device;
 *   - a role change reconciles the device's alert-policy monitors inline;
 *   - a vendor template merge is held to the same limits as any edit of the
 *     device's own lists, with the message the result shows.
 *
 * Two tests are here for the reason the actions write ONE DEVICE AT A TIME
 * rather than one update for the whole selection: the server decides the
 * site's default probe for the whole set an update matches (any device with
 * a probe of its own stops it for all of them), and leaves alert-policy
 * reconciliation to the five-minute sweep past a handful of devices. Per
 * device, every device gets its own answer, at once.
 */

jest.mock("../../../Server/Services/NetworkAlertPolicyEngineService", () => {
  return {
    __esModule: true,
    MAX_INLINE_RECONCILE_DEVICES: 5,
    MAX_MONITORS_PER_POLICY_SYNC: 500,
    default: {
      reconcileDevice: jest.fn(),
      reconcileDevices: jest.fn(),
      syncPolicy: jest.fn(),
      deleteMonitorsOwnedByPolicy: jest.fn(),
      deletePolicyMonitorsForDevices: jest.fn(),
      setPolicyMonitorsPaused: jest.fn(),
      onMonitorTemplateSynced: jest.fn(),
      createRunContext: jest.fn(),
    },
  };
});

import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import ProbeService from "../../../Server/Services/ProbeService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Probe from "../../../Models/DatabaseModels/Probe";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
} from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  SnmpTableDefinition,
  SnmpTableKind,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import { MAX_DEVICE_SPECIFIC_TABLES } from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444441",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const BUILDING_A: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const BUILDING_B: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
// A site of another project: not in this project's directory.
const FOREIGN_SITE: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000ff",
);
const ACCESS_SWITCH_ROLE: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const FOREIGN_ROLE: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-0000000000ff",
);
const SITE_PROBE: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const OWN_PROBE: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);

const CNMATRIX: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("cambium-cnmatrix")!;

type DeviceServiceInternals = {
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<NetworkDevice>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

function device(fields: {
  id?: ObjectID;
  probeId?: ObjectID;
  siteId?: ObjectID;
  oidTemplateId?: ObjectID;
  snmpOids?: Array<SnmpOid>;
}): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(fields.id || DEVICE_ID);
  value.projectId = PROJECT_ID;

  if (fields.probeId) {
    value.probeId = fields.probeId;
  }

  if (fields.siteId) {
    value.siteId = fields.siteId;
  }

  if (fields.oidTemplateId) {
    value.oidTemplateId = fields.oidTemplateId;
  }

  if (fields.snmpOids) {
    value.snmpOids = fields.snmpOids;
  }

  return value;
}

// The update one bulk action sends for one device.
function bulkWrite(
  data: Record<string, unknown>,
  ids: Array<ObjectID> = [DEVICE_ID],
): UpdateBy<NetworkDevice> {
  return {
    query:
      ids.length === 1
        ? { _id: ids[0]!.toString() }
        : {
            _id: ids.map((id: ObjectID): string => {
              return id.toString();
            }),
          },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

function writtenProbeId(updateBy: UpdateBy<NetworkDevice>): string | undefined {
  const value: unknown = (updateBy.data as unknown as Record<string, unknown>)[
    "probeId"
  ];

  return value instanceof ObjectID ? value.toString() : undefined;
}

// Building A carries the default probe the move hands out.
function stubBuildingWithProbe(): void {
  const building: NetworkSite = new NetworkSite(BUILDING_A);
  building.projectId = PROJECT_ID;
  building.probeId = SITE_PROBE;

  jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(building);
  jest.spyOn(NetworkSiteService, "getAncestorIds").mockResolvedValue([]);
  jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([building]);

  jest
    .spyOn(ProbeService, "getProbesAttachableToProject")
    .mockImplementation(
      async (data: { probeIds: Array<ObjectID> }): Promise<Array<Probe>> => {
        return [new Probe(data.probeIds[0]!)];
      },
    );
}

function oids(count: number, arc: number = 9999): Array<SnmpOid> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      oid: `1.3.6.1.4.1.${arc}.1.${index + 1}.0`,
      name: `Own ${index + 1}`,
    };
  });
}

function ownTables(count: number): Array<SnmpTableDefinition> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      key: `own_table_${index + 1}`,
      name: `Own table ${index + 1}`,
      kind: SnmpTableKind.Generic,
      columns: [
        {
          oid: `1.3.6.1.4.1.9999.2.${index + 1}.1.2`,
          name: "Value",
        },
      ],
    };
  });
}

const reconcileDeviceMock: jest.Mock =
  NetworkAlertPolicyEngineService.reconcileDevice as unknown as jest.Mock;

describe("bulk writes: Set Site sends { siteId }, one device at a time", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: {
        NetworkSite: [BUILDING_A.toString(), BUILDING_B.toString()],
      },
    });
    stubBuildingWithProbe();
  });

  test("a device without a probe of its own picks up the site's default probe", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      bulkWrite({ siteId: BUILDING_A }),
    );

    expect(writtenProbeId(result.updateBy)).toBe(SITE_PROBE.toString());
  });

  test("a device with a probe of its own keeps it", async () => {
    const { service, internals } = buildDeviceService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([device({ probeId: OWN_PROBE })] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      bulkWrite({ siteId: BUILDING_A }),
    );

    expect(writtenProbeId(result.updateBy)).toBeUndefined();
  });

  /*
   * Why the action writes per device. One update for both would be judged
   * as a set: the device with a probe stops the inheritance for the device
   * without one, which would then sit in the site with no probe at all.
   */
  test("one update across a mixed selection would cost the probe-less device its probe - so the action never sends one", async () => {
    const { service, internals } = buildDeviceService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        device({}),
        device({ id: OTHER_DEVICE_ID, probeId: OWN_PROBE }),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      bulkWrite({ siteId: BUILDING_A }, [DEVICE_ID, OTHER_DEVICE_ID]),
    );

    expect(writtenProbeId(result.updateBy)).toBeUndefined();
  });

  test("a site of another project is refused, in words the result can show", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    await expect(
      internals.onBeforeUpdate(bulkWrite({ siteId: FOREIGN_SITE })),
    ).rejects.toThrow("references records that are not in this project");
  });

  test("re-rolls the health of the site the device left and the site it joined", async () => {
    const { internals } = buildDeviceService();
    const recompute: SpyInstance<
      typeof NetworkSiteService.recomputeRollupForSiteAndAncestors
    > = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined);

    await internals.onUpdateSuccess(
      {
        updateBy: bulkWrite({ siteId: BUILDING_A }),
        carryForward: {
          previousDevices: [device({ siteId: BUILDING_B })],
        },
      } as unknown as OnUpdate<NetworkDevice>,
      [DEVICE_ID],
    );

    const rerolled: Array<string> = recompute.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(rerolled.sort()).toEqual(
      [BUILDING_A.toString(), BUILDING_B.toString()].sort(),
    );
  });
});

describe("bulk writes: Clear Site sends { siteId: null }", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({ projectId: PROJECT_ID });
    stubBuildingWithProbe();
  });

  test("is accepted, looks up no site and hands out no probe", async () => {
    const { service, internals } = buildDeviceService();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([device({ siteId: BUILDING_B })] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      bulkWrite({ siteId: null }),
    );

    expect(writtenProbeId(result.updateBy)).toBeUndefined();
    expect(NetworkSiteService.findOneById).not.toHaveBeenCalled();
  });

  test("re-rolls only the site the device left", async () => {
    const { internals } = buildDeviceService();
    const recompute: SpyInstance<
      typeof NetworkSiteService.recomputeRollupForSiteAndAncestors
    > = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined);

    await internals.onUpdateSuccess(
      {
        updateBy: bulkWrite({ siteId: null }),
        carryForward: {
          previousDevices: [device({ siteId: BUILDING_B })],
        },
      } as unknown as OnUpdate<NetworkDevice>,
      [DEVICE_ID],
    );

    expect(
      recompute.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      }),
    ).toEqual([BUILDING_B.toString()]);
  });
});

describe("bulk writes: Set / Clear Device Role send { networkDeviceRoleId }", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    reconcileDeviceMock.mockReset();
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { NetworkDeviceRole: [ACCESS_SWITCH_ROLE.toString()] },
    });
  });

  afterEach(() => {
    reconcileDeviceMock.mockReset();
  });

  test("a role of the project is accepted", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    await expect(
      internals.onBeforeUpdate(
        bulkWrite({ networkDeviceRoleId: ACCESS_SWITCH_ROLE }),
      ),
    ).resolves.toBeDefined();
  });

  test("a role of another project is refused", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    await expect(
      internals.onBeforeUpdate(bulkWrite({ networkDeviceRoleId: FOREIGN_ROLE })),
    ).rejects.toThrow("references records that are not in this project");
  });

  test("clearing the role is accepted", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    await expect(
      internals.onBeforeUpdate(bulkWrite({ networkDeviceRoleId: null })),
    ).resolves.toBeDefined();
  });

  test.each([
    ["setting a role", ACCESS_SWITCH_ROLE],
    ["clearing the role", null],
  ] as Array<[string, ObjectID | null]>)(
    "%s reconciles the device's alert-policy monitors at once",
    async (_label: string, role: ObjectID | null) => {
      const { internals } = buildDeviceService();

      await internals.onUpdateSuccess(
        {
          updateBy: bulkWrite({ networkDeviceRoleId: role }),
          carryForward: { previousDevices: [device({})] },
        } as unknown as OnUpdate<NetworkDevice>,
        [DEVICE_ID],
      );

      expect(reconcileDeviceMock).toHaveBeenCalledTimes(1);
      expect(reconcileDeviceMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });
    },
  );

  /*
   * The other reason the action writes per device: an update over more than
   * a handful of devices leaves their alert-policy monitors to the sweep,
   * minutes later. One device per write is reconciled before the next.
   */
  test("one update across more than a handful of devices would leave them to the sweep - so the action never sends one", async () => {
    const { internals } = buildDeviceService();
    const ids: Array<ObjectID> = Array.from(
      { length: 6 },
      (_value: unknown, index: number) => {
        return new ObjectID(
          `44444444-4444-4444-8444-${String(index + 10).padStart(12, "0")}`,
        );
      },
    );

    await internals.onUpdateSuccess(
      {
        updateBy: bulkWrite({ networkDeviceRoleId: ACCESS_SWITCH_ROLE }, ids),
        carryForward: {
          previousDevices: ids.map((id: ObjectID): NetworkDevice => {
            return device({ id: id });
          }),
        },
      } as unknown as OnUpdate<NetworkDevice>,
      ids,
    );

    expect(reconcileDeviceMock).not.toHaveBeenCalled();
  });
});

describe("bulk writes: Apply Vendor Template sends the merged { snmpOids, snmpTables }", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  function vendorWrite(data: {
    snmpOids?: Array<SnmpOid>;
    snmpTables?: Array<SnmpTableDefinition>;
  }): UpdateBy<NetworkDevice> {
    return bulkWrite(data as Record<string, unknown>);
  }

  test("the device's own OIDs with the template's added are accepted as sent", async () => {
    const { service, internals } = buildDeviceService();
    const own: Array<SnmpOid> = oids(3);
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([device({ snmpOids: own })] as never);

    const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      own,
      CNMATRIX.id,
    );

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      vendorWrite({ snmpOids: merged }),
    );

    const stored: Array<SnmpOid> = (
      result.updateBy.data as unknown as { snmpOids: Array<SnmpOid> }
    ).snmpOids;

    expect(
      stored.map((entry: SnmpOid): string => {
        return entry.oid;
      }),
    ).toEqual(
      merged.map((entry: SnmpOid): string => {
        return entry.oid;
      }),
    );
  });

  test("a merge past what a device may poll is refused with the limit, which the result shows", async () => {
    const { service, internals } = buildDeviceService();
    const own: Array<SnmpOid> = oids(MAX_EFFECTIVE_OIDS_PER_DEVICE - 2);
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([device({ snmpOids: own })] as never);

    const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      own,
      CNMATRIX.id,
    );

    expect(merged.length).toBeGreaterThan(MAX_EFFECTIVE_OIDS_PER_DEVICE);

    await expect(
      internals.onBeforeUpdate(vendorWrite({ snmpOids: merged })),
    ).rejects.toThrow(
      `Device-Specific Health OIDs: ${merged.length} OIDs is more than the limit of ${MAX_EFFECTIVE_OIDS_PER_DEVICE}.`,
    );
  });

  /*
   * The action leaves a device linked to an OID Collection Template alone,
   * judged from a fresh read. A device linked after that read is still held
   * to the linked budget by the server.
   */
  test("a device linked to an OID Collection Template by the time the write lands is held to the linked budget", async () => {
    const { service, internals } = buildDeviceService();
    const own: Array<SnmpOid> = oids(MAX_DEVICE_SPECIFIC_OIDS - 1);
    jest.spyOn(service, "findBy").mockResolvedValue([
      device({
        snmpOids: own,
        oidTemplateId: new ObjectID("dddddddd-0000-4000-8000-000000000001"),
      }),
    ] as never);

    const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      own,
      CNMATRIX.id,
    );

    await expect(
      internals.onBeforeUpdate(vendorWrite({ snmpOids: merged })),
    ).rejects.toThrow(`more than the limit of ${MAX_DEVICE_SPECIFIC_OIDS}`);
  });

  test("the template's tables added to the device's own are accepted", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    const merged: Array<SnmpTableDefinition> =
      SnmpVendorTemplateUtil.mergeTables(ownTables(2), CNMATRIX.id);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      vendorWrite({ snmpTables: merged }),
    );

    const stored: Array<SnmpTableDefinition> = (
      result.updateBy.data as unknown as {
        snmpTables: Array<SnmpTableDefinition>;
      }
    ).snmpTables;

    expect(
      stored.map((table: SnmpTableDefinition): string => {
        return table.key;
      }),
    ).toEqual(
      merged.map((table: SnmpTableDefinition): string => {
        return table.key;
      }),
    );
  });

  test("tables past the device's limit are refused with the limit", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    const merged: Array<SnmpTableDefinition> =
      SnmpVendorTemplateUtil.mergeTables(
        ownTables(MAX_DEVICE_SPECIFIC_TABLES - 1),
        CNMATRIX.id,
      );

    expect(merged.length).toBeGreaterThan(MAX_DEVICE_SPECIFIC_TABLES);

    await expect(
      internals.onBeforeUpdate(vendorWrite({ snmpTables: merged })),
    ).rejects.toThrow(
      `Device-Specific SNMP Tables: ${merged.length} tables is more than the limit of ${MAX_DEVICE_SPECIFIC_TABLES}.`,
    );
  });

  /*
   * Every template the dialog offers fits a device that has nothing yet, so
   * "Apply" on a freshly discovered device never fails for the template's
   * own size - whatever templates are added to the list later.
   */
  test.each(
    SnmpVendorTemplateUtil.getAll().map((template: SnmpVendorTemplate) => {
      return [template.id];
    }),
  )("%s fits a device that has nothing yet", async (templateId: string) => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([device({})] as never);

    await expect(
      internals.onBeforeUpdate(
        vendorWrite({
          snmpOids: SnmpVendorTemplateUtil.mergeOids([], templateId),
          snmpTables: SnmpVendorTemplateUtil.mergeTables([], templateId),
        }),
      ),
    ).resolves.toBeDefined();
  });
});
