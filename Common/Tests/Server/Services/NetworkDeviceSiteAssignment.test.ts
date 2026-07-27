import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - the device side of site auto-assignment:
 *
 *   - applySiteAssignmentRulesToDevice picks the highest-priority matching
 *     rule against the device's hostname (which may be an IP) / sysName and
 *     assigns via updateOneById so the update hooks refresh rollups,
 *   - onUpdateSuccess recomputes BOTH the old and the new site chain when
 *     siteId changes, re-evaluates rules when hostname changes, and never
 *     lets a rollup failure escape (device updates must not break).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const SITE_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SITE_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function fakeDevice(overrides: Record<string, unknown>): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
    ...overrides,
  } as unknown as NetworkDevice;
}

function fakeRule(data: {
  siteId: ObjectID;
  subnetCidr?: string;
  hostnamePattern?: string;
  priority?: number;
}): NetworkSiteAssignmentRule {
  return data as unknown as NetworkSiteAssignmentRule;
}

describe("NetworkDeviceService.applySiteAssignmentRulesToDevice", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("assigns the highest-priority matching rule's site", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ hostname: "10.0.5.9" }));
    jest.spyOn(NetworkSiteAssignmentRuleService, "findBy").mockResolvedValue([
      fakeRule({ siteId: SITE_A_ID, subnetCidr: "10.0.0.0/8", priority: 1 }),
      fakeRule({
        siteId: SITE_B_ID,
        subnetCidr: "10.0.5.0/24",
        priority: 10,
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const args: any = updateSpy.mock.calls[0]![0];
    expect(args.id.toString()).toBe(DEVICE_ID.toString());
    expect(args.data.siteId.toString()).toBe(SITE_B_ID.toString());
  });

  it("matches hostname patterns against the SNMP sysName too", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.0.5.9",
        sysName: "unit-1042-core",
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_A_ID, hostnamePattern: "unit-1042-*" }),
      ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_A_ID.toString(),
    );
  });

  it("does not update when no rule matches", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ hostname: "172.16.0.1" }));
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_A_ID, subnetCidr: "10.0.0.0/8" }),
      ]);
    const updateSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "updateOneById",
    );

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("does not update when the device is already in the winning site", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.0.5.9",
        siteId: SITE_A_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_A_ID, subnetCidr: "10.0.0.0/8" }),
      ]);
    const updateSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "updateOneById",
    );

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("re-assigns a device whose rules now resolve to a different site", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.0.5.9",
        siteId: SITE_A_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_B_ID, subnetCidr: "10.0.5.0/24" }),
      ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_B_ID.toString(),
    );
  });

  it("does nothing when the device no longer exists", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(null);
    const rulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteAssignmentRuleService,
      "findBy",
    );

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(rulesSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceService.onUpdateSuccess (site maintenance)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeOnUpdate(data: {
    data: Record<string, unknown>;
    previousDevices?: Array<NetworkDevice>;
  }): OnUpdate<NetworkDevice> {
    return {
      updateBy: {
        query: {},
        data: data.data,
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>,
      carryForward: data.previousDevices
        ? { previousDevices: data.previousDevices }
        : null,
    };
  }

  it("recomputes both the old and the new site chain on a siteId change", async () => {
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { siteId: SITE_B_ID },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
      }),
      [DEVICE_ID],
    );

    const rollupIds: Array<string> = rollupSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].toString();
      },
    );
    expect(rollupIds.sort()).toEqual(
      [SITE_A_ID.toString(), SITE_B_ID.toString()].sort(),
    );
  });

  it("recomputes only once when a device moves within the same site", async () => {
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { siteId: SITE_A_ID },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
      }),
      [DEVICE_ID],
    );

    expect(rollupSpy).toHaveBeenCalledTimes(1);
  });

  it("recomputes the old site when a device is un-assigned (siteId null)", async () => {
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { siteId: null },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
      }),
      [DEVICE_ID],
    );

    expect(rollupSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy.mock.calls[0]![0].toString()).toBe(SITE_A_ID.toString());
  });

  it("re-evaluates assignment rules when the hostname changes", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({ data: { hostname: "10.9.9.9" } }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
    expect(applyRulesSpy.mock.calls[0]![0].toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  it("does nothing for updates that touch neither siteId nor hostname", async () => {
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({ data: { name: "renamed" } }),
      [DEVICE_ID],
    );

    expect(rollupSpy).not.toHaveBeenCalled();
    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  it("NEVER throws - a rollup failure is logged, not propagated", async () => {
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockRejectedValue(new Error("rollup exploded"));

    await expect(
      (NetworkDeviceService as any).onUpdateSuccess(
        makeOnUpdate({
          data: { siteId: SITE_B_ID },
          previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
        }),
        [DEVICE_ID],
      ),
    ).resolves.toBeDefined();
  });
});

describe("NetworkDeviceService.onBeforeUpdate (previous-site capture)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("captures previous devices when siteId is being updated", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice({ siteId: SITE_A_ID })]);
    // The hook now validates that the new site is in the device's project.
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue({
      id: SITE_B_ID,
      _id: SITE_B_ID.toString(),
      projectId: PROJECT_ID,
    } as unknown as NetworkSite);

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { siteId: SITE_B_ID },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.carryForward.previousDevices).toHaveLength(1);
  });

  it("skips the fetch for updates that do not touch siteId", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "renamed" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });
});

/*
 * The FK behind siteId only requires the NetworkSite row to exist, so without
 * an explicit guard a tenant can point a device at another project's site and
 * make the rollup chain write there under root props.
 */
describe("NetworkDeviceService site tenancy guard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const OTHER_PROJECT_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );

  function fakeSite(projectId: ObjectID): NetworkSite {
    return {
      id: SITE_B_ID,
      _id: SITE_B_ID.toString(),
      projectId: projectId,
    } as unknown as NetworkSite;
  }

  it("onBeforeCreate rejects a site from another project", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite(OTHER_PROJECT_ID));

    await expect(
      (NetworkDeviceService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          siteId: SITE_B_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("onBeforeCreate rejects a siteId that does not resolve to a row", async () => {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(null);

    await expect(
      (NetworkDeviceService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          siteId: SITE_B_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("onBeforeCreate accepts a same-project site", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite(PROJECT_ID));

    const result: any = await (NetworkDeviceService as any).onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        siteId: SITE_B_ID,
      },
      props: { tenantId: PROJECT_ID },
    });

    expect(result.carryForward).toBeNull();
  });

  it("onBeforeUpdate rejects moving a device into another project's site", async () => {
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice({ siteId: SITE_A_ID })]);
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite(OTHER_PROJECT_ID));

    await expect(
      (NetworkDeviceService as any).onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { siteId: SITE_B_ID },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);
  });

  it("onBeforeUpdate scopes the previous-device read to the caller's project", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]);

    await (NetworkDeviceService as any).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { siteId: null },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkDevice>);

    const query: any = findBySpy.mock.calls[0]![0].query;
    expect(query._id).toBe(DEVICE_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  it("onUpdateSuccess recomputes nothing when the scoped update matched no rows", async () => {
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: DEVICE_ID.toString() },
          data: { siteId: SITE_B_ID },
          props: { tenantId: PROJECT_ID },
        } as unknown as UpdateBy<NetworkDevice>,
        carryForward: {
          previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
        },
      },
      [],
    );

    expect(rollupSpy).not.toHaveBeenCalled();
  });
});
