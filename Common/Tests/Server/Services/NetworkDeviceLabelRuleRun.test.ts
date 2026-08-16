import NetworkDeviceLabelRuleEngineService from "../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceLabelRuleService from "../../../Server/Services/NetworkDeviceLabelRuleService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import Label from "../../../Models/DatabaseModels/Label";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../../Models/DatabaseModels/NetworkDeviceLabelRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { LabelRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it, afterEach, beforeEach } from "@jest/globals";

/*
 * Contract under test - "Run now" for a network device label rule
 * (OneUptime/oneuptime#3191).
 *
 * The automatic engine only fires when a device is created, so a rule
 * written after an estate was discovered never touches any of it.
 * applyRuleToExistingNetworkDevices is the manual counterpart: the same
 * matcher, the same "already-attached labels are not duplicated" guarantee,
 * applied across a whole project instead of to one row.
 *
 * The things worth pinning down are the ones a bulk path can get wrong that a
 * one-row path cannot: it must attach labels in as few statements as the work
 * allows, count a device once no matter how many pages or labels it appears
 * under, survive a failed batch, and refuse to run a rule the user has
 * switched off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PREREQUISITE_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function deviceId(index: number): ObjectID {
  const suffix: string = index.toString(16).padStart(12, "0");
  return new ObjectID(`00000000-0000-4000-8000-${suffix}`);
}

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function fakeDevice(data: {
  index?: number | undefined;
  name?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): NetworkDevice {
  const id: ObjectID = deviceId(data.index ?? 0);

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    name: data.name,
    description: data.description,
    labels: (data.labels || []).map((labelId: ObjectID) => {
      return fakeLabel(labelId);
    }),
  } as unknown as NetworkDevice;
}

function fakeRule(data: {
  isEnabled?: boolean | undefined;
  labelsToAdd?: Array<ObjectID> | undefined;
  networkDeviceLabels?: Array<ObjectID> | undefined;
  networkDeviceNamePattern?: string | undefined;
  networkDeviceDescriptionPattern?: string | undefined;
}): NetworkDeviceLabelRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Tag core switches",
    isEnabled: data.isEnabled ?? true,
    labelsToAdd: (data.labelsToAdd || [LABEL_A_ID]).map((id: ObjectID) => {
      return fakeLabel(id);
    }),
    networkDeviceLabels: (data.networkDeviceLabels || []).map(
      (id: ObjectID) => {
        return fakeLabel(id);
      },
    ),
    networkDeviceNamePattern: data.networkDeviceNamePattern,
    networkDeviceDescriptionPattern: data.networkDeviceDescriptionPattern,
  } as unknown as NetworkDeviceLabelRule;
}

function mockRule(rule: NetworkDeviceLabelRule | null): jest.SpyInstance {
  return jest
    .spyOn(NetworkDeviceLabelRuleService, "findOneBy")
    .mockResolvedValue(rule);
}

function mockDevices(devices: Array<NetworkDevice>): jest.SpyInstance {
  return jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(async (data: any) => {
      const skip: number = data.skip || 0;
      const limit: number = data.limit || devices.length;
      return devices.slice(skip, skip + limit) as any;
    });
}

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
        page.push(fakeDevice({ index: index, name: "core-switch" }));
      }

      return page as any;
    });
}

/*
 * The relation query builder the engine attaches labels through. Recorded as
 * (labelId, deviceIds) pairs so a test can assert the shape of the writes -
 * one statement per label, not one per device.
 */
interface RelationAdd {
  labelId: string;
  deviceIds: Array<string>;
}

function mockRelationBuilder(data?: {
  failOnLabelId?: string | undefined;
}): Array<RelationAdd> {
  const adds: Array<RelationAdd> = [];

  const builder: any = {
    createQueryBuilder: () => {
      return builder;
    },
    relation: () => {
      return builder;
    },
    of: (deviceIds: Array<string>) => {
      builder.pendingDeviceIds = deviceIds;
      return builder;
    },
    add: async (labelId: string) => {
      if (data?.failOnLabelId && labelId === data.failOnLabelId) {
        throw new Error("duplicate key value violates unique constraint");
      }

      adds.push({
        labelId: labelId,
        deviceIds: [...(builder.pendingDeviceIds as Array<string>)],
      });
    },
  };

  jest
    .spyOn(NetworkDeviceService, "getRepository")
    .mockReturnValue(builder as any);

  return adds;
}

function run(
  overrides: {
    ruleId?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
  } = {},
): Promise<LabelRuleRunResult> {
  return NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices({
    ruleId: overrides.ruleId || RULE_ID,
    projectId: overrides.projectId || PROJECT_ID,
  });
}

describe("NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices", () => {
  beforeEach(() => {
    // Silence the logs the failure-path tests deliberately provoke.
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("rule resolution", () => {
    it("rejects a rule that does not exist", async () => {
      mockRule(null);
      mockDevices([]);

      await expect(run()).rejects.toThrow(BadDataException);
    });

    /*
     * The tenant guard: the lookup is scoped, so another project's rule id
     * reads as "not found" and nothing of that project is touched.
     */
    it("looks the rule up scoped to the project", async () => {
      const ruleSpy: jest.SpyInstance = mockRule(null);
      const devicesSpy: jest.SpyInstance = mockDevices([]);

      await expect(run({ projectId: OTHER_PROJECT_ID })).rejects.toThrow(
        "Label rule not found.",
      );

      const query: any = ruleSpy.mock.calls[0]![0].query;
      expect(query._id.toString()).toBe(RULE_ID.toString());
      expect(query.projectId.toString()).toBe(OTHER_PROJECT_ID.toString());
      expect(devicesSpy).not.toHaveBeenCalled();
    });

    /*
     * Running a rule the operator has switched off would contradict the
     * toggle sitting right next to the button.
     */
    it("refuses to run a disabled rule", async () => {
      mockRule(fakeRule({ isEnabled: false }));
      const devicesSpy: jest.SpyInstance = mockDevices([]);

      await expect(run()).rejects.toThrow(
        "This label rule is disabled. Enable it before running it.",
      );
      expect(devicesSpy).not.toHaveBeenCalled();
    });

    it("refuses to run a rule that attaches no labels", async () => {
      mockRule(fakeRule({ labelsToAdd: [] }));
      const devicesSpy: jest.SpyInstance = mockDevices([]);

      await expect(run()).rejects.toThrow(
        "This label rule has no labels to add, so running it would do nothing.",
      );
      expect(devicesSpy).not.toHaveBeenCalled();
    });

    it("scopes the device query to the project and pages it by id", async () => {
      mockRule(fakeRule({}));
      const devicesSpy: jest.SpyInstance = mockDevices([]);
      mockRelationBuilder();

      await run();

      expect(devicesSpy.mock.calls[0]![0].query.projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(devicesSpy.mock.calls[0]![0].sort).toEqual({
        _id: SortOrder.Ascending,
      });
    });
  });

  describe("matching", () => {
    it("attaches the rule's labels to every matching device", async () => {
      mockRule(
        fakeRule({
          networkDeviceNamePattern: "core-.*",
          labelsToAdd: [LABEL_A_ID],
        }),
      );
      mockDevices([
        fakeDevice({ index: 0, name: "core-switch-1" }),
        fakeDevice({ index: 1, name: "edge-router-1" }),
        fakeDevice({ index: 2, name: "core-switch-2" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(3);
      expect(result.devicesMatched).toBe(2);
      expect(result.devicesLabeled).toBe(2);
      expect(result.labelsAttached).toBe(2);
      expect(adds).toEqual([
        {
          labelId: LABEL_A_ID.toString(),
          deviceIds: [deviceId(0).toString(), deviceId(2).toString()],
        },
      ]);
    });

    /*
     * The glob syntax the neighbouring site assignment rules use has to keep
     * working here too - a rule written as `*0664*` used to compile to
     * nothing and silently label no device (OneUptime/oneuptime#2940).
     */
    it("accepts a '*' wildcard pattern as well as a regex", async () => {
      mockRule(fakeRule({ networkDeviceNamePattern: "*0664*" }));
      mockDevices([
        fakeDevice({ index: 0, name: "UN0664LANSWI03" }),
        fakeDevice({ index: 1, name: "UN0999LANSWI03" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(adds[0]!.deviceIds).toEqual([deviceId(0).toString()]);
    });

    it("matches on the description pattern too", async () => {
      mockRule(
        fakeRule({ networkDeviceDescriptionPattern: "production|critical" }),
      );
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1", description: "production core" }),
        fakeDevice({ index: 1, name: "sw-2", description: "lab bench" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(adds[0]!.deviceIds).toEqual([deviceId(0).toString()]);
    });

    it("requires every populated criterion to match", async () => {
      mockRule(
        fakeRule({
          networkDeviceNamePattern: "core-.*",
          networkDeviceDescriptionPattern: "production",
        }),
      );
      mockDevices([
        fakeDevice({ index: 0, name: "core-1", description: "lab" }),
        fakeDevice({ index: 1, name: "edge-1", description: "production" }),
        fakeDevice({ index: 2, name: "core-2", description: "production" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(adds[0]!.deviceIds).toEqual([deviceId(2).toString()]);
    });

    // The prerequisite filter is any-of, matching the automatic engine.
    it("honours the prerequisite label filter", async () => {
      mockRule(
        fakeRule({
          networkDeviceLabels: [PREREQUISITE_LABEL_ID],
          labelsToAdd: [LABEL_A_ID],
        }),
      );
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1", labels: [PREREQUISITE_LABEL_ID] }),
        fakeDevice({ index: 1, name: "sw-2", labels: [] }),
        fakeDevice({ index: 2, name: "sw-3", labels: [LABEL_B_ID] }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(adds[0]!.deviceIds).toEqual([deviceId(0).toString()]);
    });

    /*
     * A rule with no criteria matches everything, which is what the
     * automatic engine already does on device create. The manual run has to
     * agree with it, or the button would mean something different from the
     * rule it is attached to.
     */
    it("matches every device when the rule has no criteria", async () => {
      mockRule(fakeRule({}));
      mockDevices([
        fakeDevice({ index: 0, name: "anything" }),
        fakeDevice({ index: 1 }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(2);
      expect(adds[0]!.deviceIds).toHaveLength(2);
    });

    /*
     * A pattern that is neither a valid regex nor a wildcard glob can never
     * match; it must label nothing rather than throw the run away.
     */
    it("matches nothing for an unusable pattern instead of failing", async () => {
      mockRule(fakeRule({ networkDeviceNamePattern: "core-[" }));
      mockDevices([fakeDevice({ index: 0, name: "core-[" })]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(0);
      expect(adds).toHaveLength(0);
    });
  });

  describe("idempotence", () => {
    it("does not re-attach a label the device already carries", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1", labels: [LABEL_A_ID] }),
        fakeDevice({ index: 1, name: "sw-2", labels: [] }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(2);
      expect(result.devicesLabeled).toBe(1);
      expect(result.labelsAttached).toBe(1);
      expect(adds[0]!.deviceIds).toEqual([deviceId(1).toString()]);
    });

    /*
     * A second run of the same rule is the common case - the operator clicks
     * it again to be sure. It has to be a clean no-op, reported as such.
     */
    it("attaches nothing on a second run of the same rule", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1", labels: [LABEL_A_ID] }),
        fakeDevice({ index: 1, name: "sw-2", labels: [LABEL_A_ID] }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(2);
      expect(result.devicesLabeled).toBe(0);
      expect(result.labelsAttached).toBe(0);
      expect(adds).toHaveLength(0);
    });

    it("adds only the labels a partially labelled device is missing", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID, LABEL_B_ID] }));
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1", labels: [LABEL_A_ID] }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesLabeled).toBe(1);
      expect(result.labelsAttached).toBe(1);
      expect(adds).toEqual([
        {
          labelId: LABEL_B_ID.toString(),
          deviceIds: [deviceId(0).toString()],
        },
      ]);
    });
  });

  describe("write batching", () => {
    /*
     * One statement per label, not one per device. A per-device write would
     * turn a ten-thousand-device estate into ten thousand round trips inside
     * a single HTTP request.
     */
    it("writes one batch per label, whatever the device count", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID, LABEL_B_ID] }));
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1" }),
        fakeDevice({ index: 1, name: "sw-2" }),
        fakeDevice({ index: 2, name: "sw-3" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(adds).toHaveLength(2);
      expect(adds[0]!.deviceIds).toHaveLength(3);
      expect(adds[1]!.deviceIds).toHaveLength(3);
      expect(result.devicesLabeled).toBe(3);
      expect(result.labelsAttached).toBe(6);
    });

    /*
     * Postgres refuses a statement with more than 65535 parameters, so a
     * batch is chunked well below that.
     */
    it("chunks a batch that would otherwise be one huge statement", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockGeneratedDevices(1000);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(adds).toHaveLength(2);
      expect(adds[0]!.deviceIds).toHaveLength(500);
      expect(adds[1]!.deviceIds).toHaveLength(500);
      expect(result.labelsAttached).toBe(1000);
      expect(result.devicesLabeled).toBe(1000);
    });
  });

  describe("resilience and reporting", () => {
    it("counts a failed batch and keeps going with the other labels", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID, LABEL_B_ID] }));
      mockDevices([
        fakeDevice({ index: 0, name: "sw-1" }),
        fakeDevice({ index: 1, name: "sw-2" }),
      ]);
      const adds: Array<RelationAdd> = mockRelationBuilder({
        failOnLabelId: LABEL_A_ID.toString(),
      });

      const result: LabelRuleRunResult = await run();

      expect(adds).toHaveLength(1);
      expect(adds[0]!.labelId).toBe(LABEL_B_ID.toString());
      expect(result.labelsAttached).toBe(2);
      expect(result.labelsFailed).toBe(2);
      // The devices still gained label B, so they count as labelled.
      expect(result.devicesLabeled).toBe(2);
    });

    it("reports no devices labelled when every batch fails", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockDevices([fakeDevice({ index: 0, name: "sw-1" })]);
      mockRelationBuilder({ failOnLabelId: LABEL_A_ID.toString() });

      const result: LabelRuleRunResult = await run();

      expect(result.devicesMatched).toBe(1);
      expect(result.devicesLabeled).toBe(0);
      expect(result.labelsAttached).toBe(0);
      expect(result.labelsFailed).toBe(1);
    });

    it("returns an all-zero result for a project with no devices", async () => {
      mockRule(fakeRule({}));
      mockDevices([]);
      const adds: Array<RelationAdd> = mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result).toEqual({
        devicesEvaluated: 0,
        devicesMatched: 0,
        devicesLabeled: 0,
        labelsAttached: 0,
        labelsFailed: 0,
        isTruncated: false,
      });
      expect(adds).toHaveLength(0);
    });
  });

  describe("paging and the run cap", () => {
    it("walks every page of a multi-page estate", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      const devicesSpy: jest.SpyInstance = mockGeneratedDevices(2500);
      mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(2500);
      expect(result.devicesLabeled).toBe(2500);
      expect(result.isTruncated).toBe(false);
      expect(devicesSpy).toHaveBeenCalledTimes(3);
      expect(devicesSpy.mock.calls[1]![0].skip).toBe(1000);
    });

    /*
     * devicesLabeled is a distinct count, so a device cannot be counted
     * twice by appearing under two labels or in two chunks.
     */
    it("counts each labelled device once across pages and labels", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID, LABEL_B_ID] }));
      mockGeneratedDevices(1500);
      mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesLabeled).toBe(1500);
      expect(result.labelsAttached).toBe(3000);
    });

    it("stops at the cap and reports the run as truncated", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockGeneratedDevices(10500);
      mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(10000);
      expect(result.isTruncated).toBe(true);
    });

    it("does not report truncation for an estate of exactly the cap", async () => {
      mockRule(fakeRule({ labelsToAdd: [LABEL_A_ID] }));
      mockGeneratedDevices(10000);
      mockRelationBuilder();

      const result: LabelRuleRunResult = await run();

      expect(result.devicesEvaluated).toBe(10000);
      expect(result.isTruncated).toBe(false);
    });
  });
});
