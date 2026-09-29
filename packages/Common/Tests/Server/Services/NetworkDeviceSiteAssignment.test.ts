import NetworkDeviceLabelRuleEngineService from "../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "../../../Server/Services/NetworkDeviceOwnerRuleEngineService";
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
 *     rule against the device's hostname (which may be an IP), SNMP sysName
 *     and display name, and assigns via updateOneById so the update hooks
 *     refresh rollups,
 *   - onUpdateSuccess recomputes BOTH the old and the new site chain when the
 *     site changes - under either the `siteId` column or the `site` relation
 *     the dashboard actually posts,
 *   - onUpdateSuccess re-evaluates the rules when an identity column
 *     (hostname / name / sysName) really changes value, or when the device
 *     has no site yet, and NOT when the SNMP walk rewrites the same sysName
 *     on a device someone placed by hand,
 *   - and never lets a rollup failure escape (device updates must not break).
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

  /*
   * Verbatim reproduction of OneUptime/oneuptime#2940: the devices were
   * imported from a discovery scan, so `hostname` is the responding IP and
   * the string the user recognises ("UN0664LANSWI03") lives in `name`. The
   * rule they wrote is `*0664*` at priority 1.
   */
  it("assigns a discovery-imported device whose NAME matches the pattern", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.242.170.222",
        name: "UN0664LANSWI03",
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_A_ID, hostnamePattern: "*0664*", priority: 1 }),
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

  it("does not assign a device whose name does not match the pattern", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.242.167.10",
        name: "UN0661LANSWI03",
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_A_ID, hostnamePattern: "*0664*", priority: 1 }),
      ]);
    const updateSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "updateOneById",
    );

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  // The name is useless to the matcher if the read never fetches it.
  it("selects every column the matcher reads", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ hostname: "10.0.5.9" }));
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    const select: any = findOneByIdSpy.mock.calls[0]![0].select;
    expect(select.name).toBe(true);
    expect(select.hostname).toBe(true);
    expect(select.sysName).toBe(true);
    expect(select.siteId).toBe(true);
    expect(select.projectId).toBe(true);
  });

  it("scopes the rule lookup to the device's own project", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ hostname: "10.0.5.9" }));
    const rulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(rulesSpy.mock.calls[0]![0].query.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  it("prefers the sysName match when hostname is an IP", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        hostname: "10.242.170.222",
        name: "10.242.170.222",
        sysName: "UN0664LANSWI03",
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        fakeRule({ siteId: SITE_B_ID, hostnamePattern: "*0664*" }),
      ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_B_ID.toString(),
    );
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

  /*
   * The SNMP walk is what finally gives a discovery-imported device its
   * identity: at import time sysName is empty, and NetworkInventoryUtil
   * writes it on the first successful poll. Before this, nothing re-ran the
   * rules for that write, so the device stayed site-less forever
   * (OneUptime/oneuptime#2940).
   */
  it("re-evaluates assignment rules when the SNMP walk first writes sysName", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { sysName: "UN0664LANSWI03", lastSeenAt: new Date() },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates assignment rules when the device is renamed", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { name: "UN0664LANSWI03" },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID, name: "sw-01" })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The walk rewrites the SAME sysName every polling cycle. Re-running the
   * rules on each of those would drag a device someone deliberately placed in
   * another site back to whatever a rule prefers, every few minutes.
   */
  it("does NOT re-evaluate when the walk rewrites an unchanged sysName on a placed device", async () => {
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { sysName: "UN0664LANSWI03", lastSeenAt: new Date() },
        previousDevices: [
          fakeDevice({ siteId: SITE_A_ID, sysName: "UN0664LANSWI03" }),
        ],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  it("treats a case-only or whitespace-only rewrite as unchanged", async () => {
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { sysName: "  un0664lanswi03 " },
        previousDevices: [
          fakeDevice({ siteId: SITE_A_ID, sysName: "UN0664LANSWI03" }),
        ],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  /*
   * The self-healing half: a device with no site cannot have its site
   * "clobbered", so an unchanged identity write is still worth a rule pass.
   * This is what eventually assigns devices that were imported before the
   * rule existed - on their next poll.
   */
  it("DOES re-evaluate an unchanged identity write when the device has no site", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { sysName: "UN0664LANSWI03" },
        previousDevices: [fakeDevice({ sysName: "UN0664LANSWI03" })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates when no previous snapshot is available for a device", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { sysName: "UN0664LANSWI03" },
        previousDevices: [],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates only the devices whose identity actually moved", async () => {
    const OTHER_DEVICE_ID: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { sysName: "renamed-switch" },
          props: { isRoot: true },
        } as unknown as UpdateBy<NetworkDevice>,
        carryForward: {
          previousDevices: [
            fakeDevice({ siteId: SITE_A_ID, sysName: "renamed-switch" }),
            {
              id: OTHER_DEVICE_ID,
              _id: OTHER_DEVICE_ID.toString(),
              projectId: PROJECT_ID,
              siteId: SITE_A_ID,
              sysName: "old-name",
            } as unknown as NetworkDevice,
          ],
        },
      },
      [DEVICE_ID, OTHER_DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
    expect(applyRulesSpy.mock.calls[0]![0].toString()).toBe(
      OTHER_DEVICE_ID.toString(),
    );
  });

  /*
   * The dashboard's device form posts the `site` RELATION plus every other
   * field on the form (name, hostname, ...). Reading only `siteId` meant a
   * site picked by hand refreshed no rollups AND fell through to the rule
   * re-evaluation branch, which promptly overwrote the user's choice.
   */
  it("treats the dashboard's `site` relation key as a site change", async () => {
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: {
          name: "Core Switch",
          hostname: "10.242.170.222",
          site: { _id: SITE_B_ID.toString() },
        },
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
    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  it("recomputes the old site when the `site` relation is cleared", async () => {
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { site: null },
        previousDevices: [fakeDevice({ siteId: SITE_A_ID })],
      }),
      [DEVICE_ID],
    );

    expect(rollupSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy.mock.calls[0]![0].toString()).toBe(SITE_A_ID.toString());
  });

  it("does nothing for updates that touch neither the site nor an identity column", async () => {
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({ data: { pollingIntervalInMinutes: 10 } }),
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

  it("skips the fetch for updates that touch neither the site nor an identity column", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  it("captures previous devices when an identity column is updated", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        fakeDevice({ siteId: SITE_A_ID, sysName: "old-name" }),
      ]);

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { sysName: "UN0664LANSWI03" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.carryForward.previousDevices).toHaveLength(1);
  });

  /*
   * onUpdateSuccess compares the previous identity values against the
   * payload, so the snapshot has to carry them.
   */
  it("selects the identity columns onUpdateSuccess needs to compare", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]);

    await (NetworkDeviceService as any).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "renamed" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    const select: any = findBySpy.mock.calls[0]![0].select;
    expect(select.name).toBe(true);
    expect(select.hostname).toBe(true);
    expect(select.sysName).toBe(true);
    expect(select.siteId).toBe(true);
  });

  it("captures previous devices for the dashboard's `site` relation key", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice({ siteId: SITE_A_ID })]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue({
      id: SITE_B_ID,
      _id: SITE_B_ID.toString(),
      projectId: PROJECT_ID,
    } as unknown as NetworkSite);

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { site: { _id: SITE_B_ID.toString() } },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.carryForward.previousDevices).toHaveLength(1);
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

  it("onBeforeCreate rejects a foreign site given as the `site` relation", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite(OTHER_PROJECT_ID));

    await expect(
      (NetworkDeviceService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          site: { _id: SITE_B_ID.toString() },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("onBeforeUpdate rejects a foreign site given as the `site` relation", async () => {
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice({ siteId: SITE_A_ID })]);
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite(OTHER_PROJECT_ID));

    await expect(
      (NetworkDeviceService as any).onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { site: { _id: SITE_B_ID.toString() } },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);
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

/*
 * The create-side chain: label rules, then owner rules, then either a rollup
 * refresh (the device was created straight into a site) or a rule pass. It is
 * detached from the create response on purpose - a rule failure must never
 * fail the device write - so the tests drain the microtask queue.
 */
describe("NetworkDeviceService.onCreateSuccess (rule chain)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function flushDetachedChain(): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }

  it("applies label rules, owner rules and site assignment to a new device", async () => {
    const labelSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    const ownerSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      fakeDevice({ hostname: "10.242.170.222", name: "UN0664LANSWI03" }),
    );
    await flushDetachedChain();

    expect(labelSpy).toHaveBeenCalledTimes(1);
    expect(ownerSpy).toHaveBeenCalledTimes(1);
    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
    expect(applyRulesSpy.mock.calls[0]![0].toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  it("refreshes the rollup instead when the device was created into a site", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      fakeDevice({ siteId: SITE_A_ID }),
    );
    await flushDetachedChain();

    expect(rollupSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy.mock.calls[0]![0].toString()).toBe(SITE_A_ID.toString());
    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  /*
   * A device created from the dashboard carries the `site` relation and no
   * `siteId`; reading only the column made the chain run the assignment rules
   * over a device the user had just placed by hand.
   */
  it("recognises a site given as the `site` relation on the created device", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      fakeDevice({ site: { id: SITE_A_ID } }),
    );
    await flushDetachedChain();

    expect(rollupSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy.mock.calls[0]![0].toString()).toBe(SITE_A_ID.toString());
    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  it("returns the created device and never throws when a rule engine fails", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockRejectedValue(new Error("label engine exploded"));
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);

    const created: NetworkDevice = await (
      NetworkDeviceService as any
    ).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      fakeDevice({ hostname: "10.0.0.1" }),
    );
    await flushDetachedChain();

    expect(created.id!.toString()).toBe(DEVICE_ID.toString());
  });

  it("does nothing for a device with no project", async () => {
    const labelSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceLabelRuleEngineService,
      "applyRulesToNetworkDevice",
    );

    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      { id: DEVICE_ID, _id: DEVICE_ID.toString() } as unknown as NetworkDevice,
    );
    await flushDetachedChain();

    expect(labelSpy).not.toHaveBeenCalled();
  });
});
