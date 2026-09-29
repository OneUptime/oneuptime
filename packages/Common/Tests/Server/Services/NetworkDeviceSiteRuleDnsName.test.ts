import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { SiteAssignmentRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import CidrMatchUtil from "../../../Utils/NetworkSite/CidrMatchUtil";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - site assignment keeps working when a device's FQDN
 * moves out of `name` and into `dnsName` (OneUptime/oneuptime#3678).
 *
 * A discovery scan can now name a device by its short hostname, and the bulk
 * "shorten names" action renames existing devices to `{ name: short,
 * dnsName: fqdn }`. Site assignment rules are frequently written against the
 * FQDN (`*.corp.example.com`), so:
 *
 *   - every device read that feeds the matcher selects `dnsName` and hands it
 *     to CidrMatchUtil (the per-device path AND the "Run now" path, which
 *     must never disagree),
 *   - a write that touches only `dnsName` is an identity change: it takes the
 *     pre-write snapshot, and re-runs the rules when the value really moved -
 *     compared case- and whitespace-insensitively like the other identity
 *     columns,
 *   - and a device a `*.corp.example.com` rule placed stays in that site
 *     after the rename, rather than being claimed by a broader lower-priority
 *     subnet rule the moment its name stops containing the domain.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const FQDN_SITE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBNET_SITE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const FQDN_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBNET_RULE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const DEVICE_IP: string = "10.18.167.31";
const FQDN: string = "wb-0660-kds01.wbhq.com";
const SHORT_NAME: string = "wb-0660-kds01";

function fakeDevice(overrides: Record<string, unknown>): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
    hostname: DEVICE_IP,
    ...overrides,
  } as unknown as NetworkDevice;
}

// The rule that placed the device, written against the FQDN.
const FQDN_RULE: NetworkSiteAssignmentRule = {
  id: FQDN_RULE_ID,
  _id: FQDN_RULE_ID.toString(),
  projectId: PROJECT_ID,
  siteId: FQDN_SITE_ID,
  hostnamePattern: "*.wbhq.com",
  priority: 10,
} as unknown as NetworkSiteAssignmentRule;

/*
 * The broad catch-all that would take the device if the FQDN rule stopped
 * matching it: every address in 10/8, at a LOWER priority.
 */
const SUBNET_RULE: NetworkSiteAssignmentRule = {
  id: SUBNET_RULE_ID,
  _id: SUBNET_RULE_ID.toString(),
  projectId: PROJECT_ID,
  siteId: SUBNET_SITE_ID,
  subnetCidr: "10.0.0.0/8",
  priority: 1,
} as unknown as NetworkSiteAssignmentRule;

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

beforeEach(() => {
  // The service singleton is process-wide; every case starts cold.
  NetworkDeviceService.emptySiteAssignmentRuleCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceService.emptySiteAssignmentRuleCache.clear();
});

describe("NetworkDeviceService.applySiteAssignmentRulesToDevice - dnsName", () => {
  // A candidate the read never fetches is silently undefined.
  it("selects dnsName on the device read", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({}));
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    const select: any = findOneByIdSpy.mock.calls[0]![0].select;
    expect(select.dnsName).toBe(true);
    // The existing identity columns are still read beside it.
    expect(select.hostname).toBe(true);
    expect(select.name).toBe(true);
    expect(select.sysName).toBe(true);
  });

  /*
   * toRuleMatchTarget is module-private, so it is observed where it lands:
   * the target handed to the matcher.
   */
  it("hands dnsName to the matcher alongside the other identity columns", async () => {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDevice({
        name: SHORT_NAME,
        sysName: "KDS01",
        dnsName: FQDN,
      }),
    );
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([FQDN_RULE]);
    jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const pickRuleSpy: jest.SpyInstance = jest.spyOn(CidrMatchUtil, "pickRule");

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(pickRuleSpy).toHaveBeenCalledTimes(1);
    expect(pickRuleSpy.mock.calls[0]![1]).toEqual({
      ip: DEVICE_IP,
      hostname: DEVICE_IP,
      sysName: "KDS01",
      name: SHORT_NAME,
      dnsName: FQDN,
    });
  });

  it("assigns a short-named device whose FQDN lives only in dnsName", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ name: SHORT_NAME, dnsName: FQDN }));
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([SUBNET_RULE, FQDN_RULE]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      FQDN_SITE_ID.toString(),
    );
  });

  it("falls through to the subnet rule when the device has no dnsName", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDevice({ name: SHORT_NAME, dnsName: undefined }));
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([SUBNET_RULE, FQDN_RULE]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      SUBNET_SITE_ID.toString(),
    );
  });
});

describe("NetworkDeviceService.applySiteAssignmentRuleToExistingDevices - dnsName", () => {
  function mockDevices(devices: Array<NetworkDevice>): jest.SpyInstance {
    return jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation(async (data: any) => {
        const skip: number = data.skip || 0;
        const limit: number = data.limit || devices.length;
        return devices.slice(skip, skip + limit) as any;
      });
  }

  function run(ruleId: ObjectID): Promise<SiteAssignmentRuleRunResult> {
    return NetworkDeviceService.applySiteAssignmentRuleToExistingDevices({
      ruleId: ruleId,
      projectId: PROJECT_ID,
      reassignDevicesAlreadyInASite: false,
    });
  }

  it("selects dnsName on the paged device read", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([FQDN_RULE]);
    const devicesSpy: jest.SpyInstance = mockDevices([]);

    await run(FQDN_RULE_ID);

    const select: any = devicesSpy.mock.calls[0]![0].select;
    expect(select.dnsName).toBe(true);
    expect(select.hostname).toBe(true);
    expect(select.name).toBe(true);
    expect(select.sysName).toBe(true);
  });

  /*
   * "Run now" and the automatic path share toRuleMatchTarget. If only one of
   * them learned about dnsName the button would disagree with what discovery
   * does to the very same device.
   */
  it("hands the manual run the same target the per-device path builds", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([FQDN_RULE]);
    mockDevices([fakeDevice({ name: SHORT_NAME, dnsName: FQDN })]);
    jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const ruleMatchesSpy: jest.SpyInstance = jest.spyOn(
      CidrMatchUtil,
      "ruleMatches",
    );

    await run(FQDN_RULE_ID);

    expect(ruleMatchesSpy.mock.calls[0]![1]).toEqual({
      ip: DEVICE_IP,
      hostname: DEVICE_IP,
      sysName: undefined,
      name: SHORT_NAME,
      dnsName: FQDN,
    });
  });

  it("assigns a device the rule only matches through dnsName", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([SUBNET_RULE, FQDN_RULE]);
    mockDevices([fakeDevice({ name: SHORT_NAME, dnsName: FQDN })]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: SiteAssignmentRuleRunResult = await run(FQDN_RULE_ID);

    expect(result.devicesMatched).toBe(1);
    expect(result.devicesAssigned).toBe(1);
    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      FQDN_SITE_ID.toString(),
    );
  });

  /*
   * Priority still decides on the manual path: running the broad subnet rule
   * must not take a device the FQDN rule outranks it on, and that outranking
   * only exists because the FQDN is visible in dnsName.
   */
  it("reports a dnsName-matched device as claimed when the lower-priority subnet rule is run", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([SUBNET_RULE, FQDN_RULE]);
    mockDevices([fakeDevice({ name: SHORT_NAME, dnsName: FQDN })]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: SiteAssignmentRuleRunResult = await run(SUBNET_RULE_ID);

    expect(result.devicesMatched).toBe(1);
    expect(result.devicesClaimedByHigherPriorityRule).toBe(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceService.onBeforeUpdate - dnsName is an identity column", () => {
  it("takes the pre-write snapshot for a write of only dnsName", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice({ siteId: FQDN_SITE_ID })]);

    const result: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { dnsName: FQDN },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.carryForward.previousDevices).toHaveLength(1);
  });

  // onUpdateSuccess compares the old dnsName, so the snapshot must carry it.
  it("selects dnsName in the snapshot", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]);

    await (NetworkDeviceService as any).onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: SHORT_NAME },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    const select: any = findBySpy.mock.calls[0]![0].select;
    expect(select.dnsName).toBe(true);
    expect(select.name).toBe(true);
    expect(select.hostname).toBe(true);
    expect(select.sysName).toBe(true);
    expect(select.siteId).toBe(true);
  });
});

describe("NetworkDeviceService.onUpdateSuccess - dnsName writes", () => {
  it("re-evaluates the rules when only dnsName changes on a placed device", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { dnsName: FQDN },
        previousDevices: [
          fakeDevice({ siteId: SUBNET_SITE_ID, dnsName: undefined }),
        ],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
    expect(applyRulesSpy.mock.calls[0]![0].toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  it("re-evaluates when dnsName is cleared on a placed device", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { dnsName: null },
        previousDevices: [fakeDevice({ siteId: FQDN_SITE_ID, dnsName: FQDN })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * Same normalisation as sysName: a rewrite that differs only in case or
   * surrounding whitespace cannot change a case-insensitive match, so it must
   * not drag a hand-placed device back to whatever a rule prefers.
   */
  it("treats a case-only or whitespace-only dnsName rewrite as unchanged", async () => {
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { dnsName: "  WB-0660-KDS01.WBHQ.COM " },
        previousDevices: [fakeDevice({ siteId: FQDN_SITE_ID, dnsName: FQDN })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  // Null, undefined and "" all normalise to the same empty identity.
  it("treats writing an empty dnsName over a missing one as unchanged", async () => {
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { dnsName: "" },
        previousDevices: [
          fakeDevice({ siteId: FQDN_SITE_ID, dnsName: undefined }),
        ],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).not.toHaveBeenCalled();
  });

  it("re-evaluates an unchanged dnsName write when the device has no site", async () => {
    const applyRulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { dnsName: FQDN },
        previousDevices: [fakeDevice({ dnsName: FQDN })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
  });

  // A site write still wins the branch; dnsName does not re-run the rules.
  it("does not re-run the rules when dnsName rides along with a site change", async () => {
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    await (NetworkDeviceService as any).onUpdateSuccess(
      makeOnUpdate({
        data: { siteId: FQDN_SITE_ID, dnsName: FQDN },
        previousDevices: [fakeDevice({ siteId: SUBNET_SITE_ID })],
      }),
      [DEVICE_ID],
    );

    expect(applyRulesSpy).not.toHaveBeenCalled();
  });
});

/*
 * The end-to-end rename, through both hooks and the real rule evaluation -
 * only the database reads and the site write are stubbed.
 *
 * Before: the device is named by its FQDN and sits in the site the
 * `*.wbhq.com` rule (priority 10) put it in. A broad `10.0.0.0/8` rule
 * (priority 1) also matches its address.
 *
 * The write: the bulk "shorten names" action's `{ name: short, dnsName:
 * fqdn }`. `name` really changed, so onUpdateSuccess re-runs the rules.
 */
describe("NetworkDeviceService - renaming a rule-placed device to its short hostname", () => {
  async function renameThroughHooks(data: {
    payload: Record<string, unknown>;
    deviceAfterWrite: NetworkDevice;
  }): Promise<jest.SpyInstance> {
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        fakeDevice({ siteId: FQDN_SITE_ID, name: FQDN, dnsName: undefined }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(data.deviceAfterWrite);
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([SUBNET_RULE, FQDN_RULE]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const updateBy: UpdateBy<NetworkDevice> = {
      query: { _id: DEVICE_ID.toString() },
      data: data.payload,
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>;

    const onUpdate: OnUpdate<NetworkDevice> = await (
      NetworkDeviceService as any
    ).onBeforeUpdate(updateBy);

    await (NetworkDeviceService as any).onUpdateSuccess(onUpdate, [DEVICE_ID]);

    return updateSpy;
  }

  it("stays in the FQDN rule's site - the lower-priority subnet rule does not take it", async () => {
    const applyRulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "applySiteAssignmentRulesToDevice",
    );

    const updateSpy: jest.SpyInstance = await renameThroughHooks({
      payload: { name: SHORT_NAME, dnsName: FQDN },
      deviceAfterWrite: fakeDevice({
        siteId: FQDN_SITE_ID,
        name: SHORT_NAME,
        dnsName: FQDN,
      }),
    });

    // The rename was an identity change, so the rules really were consulted...
    expect(applyRulesSpy).toHaveBeenCalledTimes(1);
    // ...and the winner is still the site the device is already in.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  /*
   * The control that proves the test above is not vacuous: the same rename
   * WITHOUT the FQDN kept anywhere hands the device to the subnet rule. This
   * is exactly the regression dnsName matching exists to prevent.
   */
  it("would be moved to the subnet rule's site if the FQDN were not kept", async () => {
    const updateSpy: jest.SpyInstance = await renameThroughHooks({
      payload: { name: SHORT_NAME },
      deviceAfterWrite: fakeDevice({
        siteId: FQDN_SITE_ID,
        name: SHORT_NAME,
        dnsName: undefined,
      }),
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
      SUBNET_SITE_ID.toString(),
    );
  });

  // The FQDN already living in sysName keeps the match just as well.
  it("stays in the FQDN rule's site when the FQDN is in sysName instead", async () => {
    const updateSpy: jest.SpyInstance = await renameThroughHooks({
      payload: { name: SHORT_NAME },
      deviceAfterWrite: fakeDevice({
        siteId: FQDN_SITE_ID,
        name: SHORT_NAME,
        sysName: FQDN,
        dnsName: undefined,
      }),
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
