import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { SiteAssignmentRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - "Run now" for a site assignment rule
 * (OneUptime/oneuptime#3191).
 *
 * Rules only fire on device create, on an identity change, or on the next
 * poll of a device with no site, so a rule written after an estate was
 * imported never reaches it. applySiteAssignmentRuleToExistingDevices is the
 * manual path that does, and it keeps two promises of the automatic one:
 *
 *   - priority still decides. A device this rule matches but a
 *     higher-priority rule also matches is reported, never moved: one rule's
 *     button must not do another rule's work.
 *   - a device that already belongs to a site is left alone unless the caller
 *     explicitly asked to overwrite, because nothing records whether that
 *     site was chosen by a rule or by a person.
 *
 * Everything else here is about being honest with the operator: the counters
 * have to add up, one device's failure must not abandon the rest of the
 * fleet, and a run that stopped at the cap has to say so.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const SITE_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SITE_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function deviceId(index: number): ObjectID {
  /*
   * Deterministic per-index ids so a paging test can assert exactly which
   * devices were touched without hard-coding ten thousand UUIDs.
   */
  const suffix: string = index.toString(16).padStart(12, "0");
  return new ObjectID(`00000000-0000-4000-8000-${suffix}`);
}

function fakeDevice(data: {
  index?: number | undefined;
  id?: ObjectID | undefined;
  siteId?: ObjectID | undefined;
  hostname?: string | undefined;
  sysName?: string | undefined;
  name?: string | undefined;
}): NetworkDevice {
  const id: ObjectID = data.id || deviceId(data.index ?? 0);

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    siteId: data.siteId,
    hostname: data.hostname,
    sysName: data.sysName,
    name: data.name,
  } as unknown as NetworkDevice;
}

function fakeRule(data: {
  id?: ObjectID | undefined;
  // null means "a rule row with no site", which is a state the run rejects.
  siteId?: ObjectID | null | undefined;
  subnetCidr?: string | undefined;
  hostnamePattern?: string | undefined;
  priority?: number | undefined;
  createdAt?: Date | undefined;
}): NetworkSiteAssignmentRule {
  const id: ObjectID = data.id || RULE_ID;

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    siteId: data.siteId === undefined ? SITE_A_ID : data.siteId || undefined,
    subnetCidr: data.subnetCidr,
    hostnamePattern: data.hostnamePattern,
    priority: data.priority ?? 0,
    createdAt: data.createdAt,
  } as unknown as NetworkSiteAssignmentRule;
}

function mockRules(rules: Array<NetworkSiteAssignmentRule>): jest.SpyInstance {
  return jest
    .spyOn(NetworkSiteAssignmentRuleService, "findBy")
    .mockResolvedValue(rules);
}

// A findBy that pages over a fixed list, honouring skip and limit.
function mockDevices(devices: Array<NetworkDevice>): jest.SpyInstance {
  return jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(async (data: any) => {
      const skip: number = data.skip || 0;
      const limit: number = data.limit || devices.length;
      return devices.slice(skip, skip + limit) as any;
    });
}

/*
 * The same, but generated on demand: a truncation test needs more devices
 * than it is worth building arrays for.
 */
function mockGeneratedDevices(totalDevices: number): jest.SpyInstance {
  return jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(async (data: any) => {
      const skip: number = data.skip || 0;
      const limit: number = data.limit || 0;
      const page: Array<NetworkDevice> = [];

      for (
        let index: number = skip;
        index < Math.min(skip + limit, totalDevices);
        index++
      ) {
        page.push(fakeDevice({ index: index, hostname: "10.0.5.9" }));
      }

      return page as any;
    });
}

function mockUpdate(): jest.SpyInstance {
  return jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(undefined as never);
}

function run(
  overrides: {
    ruleId?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
    reassignDevicesAlreadyInASite?: boolean | undefined;
  } = {},
): Promise<SiteAssignmentRuleRunResult> {
  return NetworkDeviceService.applySiteAssignmentRuleToExistingDevices({
    ruleId: overrides.ruleId || RULE_ID,
    projectId: overrides.projectId || PROJECT_ID,
    reassignDevicesAlreadyInASite:
      overrides.reassignDevicesAlreadyInASite ?? false,
  });
}

describe("NetworkDeviceService.applySiteAssignmentRuleToExistingDevices", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("rule resolution", () => {
    it("rejects a rule id that is not one of the project's rules", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.0.0/8" })]);
      mockDevices([]);

      await expect(run({ ruleId: OTHER_RULE_ID })).rejects.toThrow(
        BadDataException,
      );
    });

    /*
     * The tenant guard: the rules are loaded by project, so a rule id from
     * another project is simply not in the list and the run refuses. Nothing
     * about another tenant's estate is read or written.
     */
    it("refuses to run a rule belonging to another project", async () => {
      const rulesSpy: jest.SpyInstance = mockRules([]);
      const devicesSpy: jest.SpyInstance = mockDevices([
        fakeDevice({ hostname: "10.0.5.9" }),
      ]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      await expect(run({ projectId: OTHER_PROJECT_ID })).rejects.toThrow(
        "Assignment rule not found.",
      );

      expect(rulesSpy.mock.calls[0]![0].query.projectId.toString()).toBe(
        OTHER_PROJECT_ID.toString(),
      );
      expect(devicesSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("rejects a rule that has no site to assign to", async () => {
      mockRules([fakeRule({ siteId: null, subnetCidr: "10.0.0.0/8" })]);
      mockDevices([]);

      await expect(run()).rejects.toThrow(
        "This assignment rule has no site to assign devices to.",
      );
    });

    it("scopes both the rule and the device query to the project", async () => {
      const rulesSpy: jest.SpyInstance = mockRules([
        fakeRule({ subnetCidr: "10.0.0.0/8" }),
      ]);
      const devicesSpy: jest.SpyInstance = mockDevices([]);

      await run();

      expect(rulesSpy.mock.calls[0]![0].query.projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(devicesSpy.mock.calls[0]![0].query.projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    /*
     * Paging over rows the run is itself writing to is only safe under a
     * stable sort. Ids never change when a site is assigned; a createdAt or
     * name sort would let a row shift between pages and be skipped.
     */
    it("pages devices under a stable id sort", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.0.0/8" })]);
      const devicesSpy: jest.SpyInstance = mockDevices([]);

      await run();

      expect(devicesSpy.mock.calls[0]![0].sort).toEqual({
        _id: SortOrder.Ascending,
      });
    });
  });

  describe("matching", () => {
    it("assigns a matching device that has no site", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(1);
      expect(result.devicesMatched).toBe(1);
      expect(result.devicesAssigned).toBe(1);
      expect(updateSpy).toHaveBeenCalledTimes(1);

      const args: any = updateSpy.mock.calls[0]![0];
      expect(args.id.toString()).toBe(deviceId(0).toString());
      expect(args.data.siteId.toString()).toBe(SITE_A_ID.toString());
    });

    /*
     * Through updateOneById as root, never a bulk UPDATE: onUpdateSuccess is
     * what refreshes the rollups of the site the device left and the one it
     * joined, and a raw write would leave both stale.
     */
    it("assigns through updateOneById so site rollups are refreshed", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      await run();

      expect(updateSpy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    });

    it("leaves a device no criterion matches alone", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "172.16.0.1" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(1);
      expect(result.devicesMatched).toBe(0);
      expect(result.devicesAssigned).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    /*
     * A discovery import stores the responding IP in `hostname` and the SNMP
     * identity in `name` / `sysName`, so a retroactive run has to try a
     * hostname pattern against all three - exactly as the per-device path
     * does, or the button would disagree with the scan.
     */
    it("matches a hostname pattern against the SNMP sysName", async () => {
      mockRules([fakeRule({ hostnamePattern: "unit-1042-*" })]);
      mockDevices([
        fakeDevice({ hostname: "10.0.5.9", sysName: "unit-1042-core" }),
      ]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesAssigned).toBe(1);
      expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
        SITE_A_ID.toString(),
      );
    });

    it("matches a hostname pattern against the display name", async () => {
      mockRules([fakeRule({ hostnamePattern: "*0664*" })]);
      mockDevices([
        fakeDevice({ hostname: "10.0.5.9", name: "UN0664LANSWI03" }),
      ]);

      mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesAssigned).toBe(1);
    });

    it("requires every populated criterion to match", async () => {
      mockRules([
        fakeRule({ subnetCidr: "10.0.5.0/24", hostnamePattern: "core-*" }),
      ]);
      mockDevices([
        // In the subnet, wrong name.
        fakeDevice({ index: 0, hostname: "10.0.5.9", name: "edge-1" }),
        // Right name, outside the subnet.
        fakeDevice({ index: 1, hostname: "172.16.0.4", name: "core-1" }),
        // Both.
        fakeDevice({ index: 2, hostname: "10.0.5.10", name: "core-2" }),
      ]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(3);
      expect(result.devicesMatched).toBe(1);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0]![0].id.toString()).toBe(
        deviceId(2).toString(),
      );
    });

    it("never matches a rule with no criteria at all", async () => {
      mockRules([fakeRule({})]);
      mockDevices([
        fakeDevice({ index: 0, hostname: "10.0.5.9" }),
        fakeDevice({ index: 1, name: "anything" }),
      ]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(2);
      expect(result.devicesMatched).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe("devices that already belong to a site", () => {
    it("counts a device already in this rule's site without updating it", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9", siteId: SITE_A_ID })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(result.devicesAlreadyInRuleSite).toBe(1);
      expect(result.devicesAssigned).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    /*
     * The default. Nothing in the schema says whether SITE_B was chosen by a
     * rule or by a person, so a plain run must not overwrite it.
     */
    it("leaves a device in another site alone by default", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9", siteId: SITE_B_ID })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(result.devicesSkippedAlreadyInAnotherSite).toBe(1);
      expect(result.devicesAssigned).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("moves a device out of another site when explicitly asked to", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9", siteId: SITE_B_ID })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run({
        reassignDevicesAlreadyInASite: true,
      });

      expect(result.devicesAssigned).toBe(1);
      expect(result.devicesSkippedAlreadyInAnotherSite).toBe(0);
      expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
        SITE_A_ID.toString(),
      );
    });

    /*
     * Even with the overwrite flag on, a device already in the rule's own
     * site is a no-op - re-running a rule must not churn writes (each one
     * would recompute a site rollup) for nothing.
     */
    it("still skips a device already in this rule's site when overwriting", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9", siteId: SITE_A_ID })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run({
        reassignDevicesAlreadyInASite: true,
      });

      expect(result.devicesAlreadyInRuleSite).toBe(1);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe("priority", () => {
    it("leaves a device a higher-priority rule also matches to that rule", async () => {
      mockRules([
        fakeRule({ subnetCidr: "10.0.0.0/8", priority: 1 }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.5.0/24",
          priority: 10,
        }),
      ]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(result.devicesClaimedByHigherPriorityRule).toBe(1);
      expect(result.devicesAssigned).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("assigns when this rule is the one that outranks the others", async () => {
      mockRules([
        fakeRule({ subnetCidr: "10.0.5.0/24", priority: 10 }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.0.0/8",
          priority: 1,
        }),
      ]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesAssigned).toBe(1);
      expect(result.devicesClaimedByHigherPriorityRule).toBe(0);
      expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
        SITE_A_ID.toString(),
      );
    });

    // Ties go to the older rule, the same way the automatic path breaks them.
    it("yields to an equally ranked but older rule", async () => {
      mockRules([
        fakeRule({
          subnetCidr: "10.0.5.0/24",
          priority: 5,
          createdAt: new Date("2024-02-01T00:00:00Z"),
        }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.5.0/24",
          priority: 5,
          createdAt: new Date("2024-01-01T00:00:00Z"),
        }),
      ]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesClaimedByHigherPriorityRule).toBe(1);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("wins an equally ranked tie when it is the older rule", async () => {
      mockRules([
        fakeRule({
          subnetCidr: "10.0.5.0/24",
          priority: 5,
          createdAt: new Date("2024-01-01T00:00:00Z"),
        }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.5.0/24",
          priority: 5,
          createdAt: new Date("2024-02-01T00:00:00Z"),
        }),
      ]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9" })]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesAssigned).toBe(1);
      expect(updateSpy.mock.calls[0]![0].data.siteId.toString()).toBe(
        SITE_A_ID.toString(),
      );
    });

    /*
     * Priority is checked AFTER the already-in-a-site checks, so a device a
     * higher-priority rule wants is still reported under the reason the
     * operator can act on first.
     */
    it("reports a device already in another site before consulting priority", async () => {
      mockRules([
        fakeRule({ subnetCidr: "10.0.0.0/8", priority: 1 }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.5.0/24",
          priority: 10,
        }),
      ]);
      mockDevices([fakeDevice({ hostname: "10.0.5.9", siteId: SITE_B_ID })]);

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesSkippedAlreadyInAnotherSite).toBe(1);
      expect(result.devicesClaimedByHigherPriorityRule).toBe(0);
    });
  });

  describe("resilience and reporting", () => {
    it("counts a failed device update and keeps going", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([
        fakeDevice({ index: 0, hostname: "10.0.5.9" }),
        fakeDevice({ index: 1, hostname: "10.0.5.10" }),
        fakeDevice({ index: 2, hostname: "10.0.5.11" }),
      ]);

      const updateSpy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceService, "updateOneById")
        .mockImplementation(async (data: any) => {
          if (data.id.toString() === deviceId(1).toString()) {
            throw new Error("deadlock detected");
          }
          return undefined as never;
        });

      const result: SiteAssignmentRuleRunResult = await run();

      expect(updateSpy).toHaveBeenCalledTimes(3);
      expect(result.devicesMatched).toBe(3);
      expect(result.devicesAssigned).toBe(2);
      expect(result.devicesFailed).toBe(1);
    });

    /*
     * A row with no usable id cannot be updated. It still has to be
     * accounted for, or the buckets would not add up to devicesMatched and
     * the summary would silently under-report.
     */
    it("counts a device with no id as a failure rather than losing it", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([
        {
          projectId: PROJECT_ID,
          hostname: "10.0.5.9",
        } as unknown as NetworkDevice,
      ]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(result.devicesFailed).toBe(1);
      expect(result.devicesAssigned).toBe(0);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("returns an all-zero result for a project with no devices", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockDevices([]);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result).toEqual({
        devicesEvaluated: 0,
        devicesMatched: 0,
        devicesAssigned: 0,
        devicesAlreadyInRuleSite: 0,
        devicesSkippedAlreadyInAnotherSite: 0,
        devicesClaimedByHigherPriorityRule: 0,
        devicesFailed: 0,
        isTruncated: false,
      });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    /*
     * Every evaluated device lands in exactly one bucket, or a zero
     * assignment count could never be explained to the operator.
     */
    it("accounts for every matched device in exactly one bucket", async () => {
      mockRules([
        fakeRule({ subnetCidr: "10.0.0.0/8", priority: 1 }),
        fakeRule({
          id: OTHER_RULE_ID,
          siteId: SITE_B_ID,
          subnetCidr: "10.0.9.0/24",
          priority: 10,
        }),
      ]);
      mockDevices([
        // Assigned.
        fakeDevice({ index: 0, hostname: "10.0.5.9" }),
        // Already in this rule's site.
        fakeDevice({ index: 1, hostname: "10.0.5.10", siteId: SITE_A_ID }),
        // In another site.
        fakeDevice({ index: 2, hostname: "10.0.5.11", siteId: SITE_B_ID }),
        // Claimed by the higher-priority rule.
        fakeDevice({ index: 3, hostname: "10.0.9.4" }),
        // No match at all.
        fakeDevice({ index: 4, hostname: "172.16.0.1" }),
      ]);
      mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(5);
      expect(result.devicesMatched).toBe(4);
      expect(
        result.devicesAssigned +
          result.devicesAlreadyInRuleSite +
          result.devicesSkippedAlreadyInAnotherSite +
          result.devicesClaimedByHigherPriorityRule +
          result.devicesFailed,
      ).toBe(result.devicesMatched);
    });
  });

  describe("paging and the run cap", () => {
    it("walks every page of a multi-page estate", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      const devicesSpy: jest.SpyInstance = mockGeneratedDevices(2500);
      const updateSpy: jest.SpyInstance = mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(2500);
      expect(result.devicesAssigned).toBe(2500);
      expect(updateSpy).toHaveBeenCalledTimes(2500);
      expect(result.isTruncated).toBe(false);

      // 1000 + 1000 + 500, and the short page ends the walk.
      expect(devicesSpy).toHaveBeenCalledTimes(3);
      expect(devicesSpy.mock.calls[1]![0].skip).toBe(1000);
      expect(devicesSpy.mock.calls[2]![0].skip).toBe(2000);
    });

    it("stops at the cap and reports the run as truncated", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockGeneratedDevices(10500);
      mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(10000);
      expect(result.isTruncated).toBe(true);
    });

    /*
     * A full last page is not proof that more devices exist. An estate of
     * exactly the cap must not report a truncation, or the UI would tell the
     * operator to run it again forever.
     */
    it("does not report truncation for an estate of exactly the cap", async () => {
      mockRules([fakeRule({ subnetCidr: "10.0.5.0/24" })]);
      mockGeneratedDevices(10000);
      mockUpdate();

      const result: SiteAssignmentRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(10000);
      expect(result.isTruncated).toBe(false);
    });
  });
});
