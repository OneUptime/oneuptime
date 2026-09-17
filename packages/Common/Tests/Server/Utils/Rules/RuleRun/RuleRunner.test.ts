import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjectiveMonitorRule from "../../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import StatusPageMonitorRule from "../../../../../Models/DatabaseModels/StatusPageMonitorRule";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import StatusPageMonitorRuleEngineService from "../../../../../Server/Services/StatusPageMonitorRuleEngineService";
import StatusPageMonitorRuleService from "../../../../../Server/Services/StatusPageMonitorRuleService";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import RuleRunner from "../../../../../Server/Utils/Rules/RuleRun/RuleRunner";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  RULE_RUN_RESOURCES_PER_PASS,
  RuleRunPassResult,
  RuleRunType,
} from "../../../../../Types/Rules/RuleRun";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - one pass of "Run now".
 *
 * Everything a rule DOES to a resource is the engine's business and is tested
 * there. What the runner owns is everything around it: refusing a rule that is
 * missing, from another project, switched off or has nothing to add; walking
 * the project in stable, cursor-driven pages so no resource is skipped or seen
 * twice; handing each resource exactly the one rule being run; counting
 * honestly (a failure is not an update); and never letting one bad resource
 * end the pass.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

function resourceId(index: number): ObjectID {
  return new ObjectID(
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  );
}

function resources(count: number, offset: number = 0): Array<BaseModel> {
  const list: Array<BaseModel> = [];

  for (let index: number = offset; index < offset + count; index++) {
    list.push({
      id: resourceId(index),
      _id: resourceId(index).toString(),
    } as unknown as BaseModel);
  }

  return list;
}

interface FakeRegistryEntry {
  ruleFindOneBy: jest.Mock;
  resourceFindBy: jest.Mock;
  apply: jest.Mock;
}

function fakeDefinition(data: {
  rule: Record<string, unknown> | null;
  resources?: Array<BaseModel> | undefined;
  apply?:
    | ((
        resource: BaseModel,
      ) => RuleApplicationResult | Promise<RuleApplicationResult>)
    | undefined;
}): FakeRegistryEntry {
  const ruleFindOneBy: jest.Mock = jest.fn(async () => {
    return data.rule;
  });
  const resourceFindBy: jest.Mock = jest.fn(async () => {
    return data.resources || [];
  });
  const apply: jest.Mock = jest.fn(
    async (input: { resource: BaseModel }): Promise<RuleApplicationResult> => {
      return data.apply
        ? await data.apply(input.resource)
        : RuleApplicationResultUtil.noMatch();
    },
  );

  const definition: RuleRunDefinition = {
    ruleModelType: BaseModel,
    resourceModelType: BaseModel,
    ruleService: { findOneBy: ruleFindOneBy },
    resourceService: { findBy: resourceFindBy },
    engine: {
      ruleSelect: { name: true, labelsToAdd: { _id: true } },
      resourceSelectForRuleRun: { title: true },
      applyRulesToExistingResource: apply,
    },
  } as unknown as RuleRunDefinition;

  jest.spyOn(RuleRunRegistry, "getDefinition").mockReturnValue(definition);

  return {
    ruleFindOneBy: ruleFindOneBy,
    resourceFindBy: resourceFindBy,
    apply: apply,
  };
}

function labelRule(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Tag production",
    isEnabled: true,
    labelsToAdd: [{ id: LABEL_ID }],
    ...overrides,
  };
}

function runPass(
  overrides: {
    ruleType?: RuleRunType;
    cursor?: ObjectID | null;
    allowOwnerNotification?: boolean;
  } = {},
): Promise<RuleRunPassResult> {
  return RuleRunner.runPass({
    ruleType: overrides.ruleType || RuleRunType.MonitorLabelRule,
    ruleId: RULE_ID,
    projectId: PROJECT_ID,
    cursor: overrides.cursor === undefined ? null : overrides.cursor,
    allowOwnerNotification: overrides.allowOwnerNotification || false,
  });
}

describe("RuleRunner.runPass", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("rule resolution", () => {
    it("looks the rule up scoped to the project, with the engine's select", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({ rule: labelRule() });

      await runPass();

      const args: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = fake.ruleFindOneBy.mock.calls[0]![0] as never;

      expect(String(args.query["_id"])).toBe(RULE_ID.toString());
      expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(args.select).toEqual({
        name: true,
        labelsToAdd: { _id: true },
        _id: true,
        isEnabled: true,
      });
      expect(args.props).toEqual({ isRoot: true });
    });

    it("rejects a rule it cannot find, touching no resources", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({ rule: null });

      await expect(runPass()).rejects.toThrow(
        new BadDataException("Rule not found."),
      );
      expect(fake.resourceFindBy).not.toHaveBeenCalled();
    });

    it("refuses a disabled rule, touching no resources", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({
        rule: labelRule({ isEnabled: false }),
      });

      await expect(runPass()).rejects.toThrow(
        "This rule is disabled. Enable it before running it.",
      );
      expect(fake.resourceFindBy).not.toHaveBeenCalled();
    });

    it("refuses a label rule with nothing to add", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({
        rule: labelRule({ labelsToAdd: [] }),
      });

      await expect(runPass()).rejects.toThrow(
        "This rule has no labels to add, so running it would do nothing.",
      );
      expect(fake.resourceFindBy).not.toHaveBeenCalled();
    });

    it("runs a label rule that only inherits labels", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({
        rule: labelRule({ labelsToAdd: [], inheritLabelsFromMonitors: true }),
      });

      await runPass({ ruleType: RuleRunType.IncidentLabelRule });

      expect(fake.resourceFindBy).toHaveBeenCalledTimes(1);
    });

    it("refuses an owner rule with no owners to add", async () => {
      fakeDefinition({
        rule: labelRule({
          labelsToAdd: undefined,
          ownerUsers: [],
          ownerTeams: [],
          inheritOwnersFromMonitors: false,
        }),
      });

      await expect(
        runPass({ ruleType: RuleRunType.IncidentOwnerRule }),
      ).rejects.toThrow(
        "This rule has no owners to add, so running it would do nothing.",
      );
    });

    it("runs an owner rule with only teams, and a privacy rule with no action fields", async () => {
      const owner: FakeRegistryEntry = fakeDefinition({
        rule: labelRule({
          labelsToAdd: undefined,
          ownerTeams: [{ id: LABEL_ID }],
        }),
      });
      await runPass({ ruleType: RuleRunType.HostOwnerRule });
      expect(owner.resourceFindBy).toHaveBeenCalledTimes(1);

      jest.restoreAllMocks();

      const privacy: FakeRegistryEntry = fakeDefinition({
        rule: { id: RULE_ID, isEnabled: true },
      });
      await runPass({ ruleType: RuleRunType.IncidentPrivacyRule });
      expect(privacy.resourceFindBy).toHaveBeenCalledTimes(1);
    });

    it("refuses a rule type with no registered engine", async () => {
      jest.spyOn(RuleRunRegistry, "getDefinition").mockReturnValue(null);

      await expect(runPass()).rejects.toThrow("This rule cannot be run.");
    });
  });

  describe("paging", () => {
    it("reads the first page of the project in id order", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({ rule: labelRule() });

      await runPass();

      const args: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        sort: Record<string, unknown>;
        limit: number;
        skip: number;
      } = fake.resourceFindBy.mock.calls[0]![0] as never;

      expect(Object.keys(args.query)).toEqual(["projectId"]);
      expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(args.select).toEqual({ title: true, _id: true, projectId: true });
      expect(args.sort).toEqual({ _id: SortOrder.Ascending });
      expect(args.limit).toBe(RULE_RUN_RESOURCES_PER_PASS);
      expect(args.skip).toBe(0);
    });

    /*
     * An offset would shift while the run itself writes; an id cursor cannot,
     * because applying a rule never changes a resource's id.
     */
    it("continues after the cursor instead of using an offset", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({ rule: labelRule() });

      await runPass({ cursor: resourceId(199) });

      const args: { query: Record<string, unknown>; skip: number } = fake
        .resourceFindBy.mock.calls[0]![0] as never;

      expect(Object.keys(args.query).sort()).toEqual(["_id", "projectId"]);
      expect(args.query["_id"]).toBeDefined();
      expect(args.skip).toBe(0);
    });

    it("hands back the last id of a full page as the next cursor", async () => {
      fakeDefinition({
        rule: labelRule(),
        resources: resources(RULE_RUN_RESOURCES_PER_PASS),
      });

      const result: RuleRunPassResult = await runPass();

      expect(result.resourcesEvaluated).toBe(RULE_RUN_RESOURCES_PER_PASS);
      expect(result.nextCursor).toBe(
        resourceId(RULE_RUN_RESOURCES_PER_PASS - 1).toString(),
      );
    });

    it("ends the run on a short page", async () => {
      fakeDefinition({ rule: labelRule(), resources: resources(3) });

      const result: RuleRunPassResult = await runPass();

      expect(result.resourcesEvaluated).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it("ends the run on an empty page", async () => {
      fakeDefinition({ rule: labelRule(), resources: [] });

      const result: RuleRunPassResult = await runPass();

      expect(result.resourcesEvaluated).toBe(0);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("applying", () => {
    it("hands every resource exactly the one rule being run", async () => {
      const fake: FakeRegistryEntry = fakeDefinition({
        rule: labelRule(),
        resources: resources(2),
      });

      await runPass({ allowOwnerNotification: true });

      expect(fake.apply).toHaveBeenCalledTimes(2);

      for (const call of fake.apply.mock.calls) {
        const input: {
          rules: Array<Record<string, unknown>>;
          allowOwnerNotification: boolean;
        } = call[0] as never;

        expect(input.rules).toHaveLength(1);
        expect(input.rules[0]!["id"]).toBe(RULE_ID);
        expect(input.allowOwnerNotification).toBe(true);
      }
    });

    it("counts matches, updates, additions and failures separately", async () => {
      const outcomes: Array<RuleApplicationResult> = [
        RuleApplicationResultUtil.updated(2),
        RuleApplicationResultUtil.updated(1),
        RuleApplicationResultUtil.alreadyApplied(),
        RuleApplicationResultUtil.noMatch(),
        RuleApplicationResultUtil.failed(),
      ];

      fakeDefinition({
        rule: labelRule(),
        resources: resources(outcomes.length),
        apply: (resource: BaseModel): RuleApplicationResult => {
          return outcomes[
            resources(outcomes.length).findIndex((candidate: BaseModel) => {
              return candidate.id!.toString() === resource.id!.toString();
            })
          ]!;
        },
      });

      const result: RuleRunPassResult = await runPass();

      expect(result).toMatchObject({
        resourcesEvaluated: 5,
        resourcesMatched: 4,
        resourcesUpdated: 2,
        itemsAdded: 3,
        resourcesFailed: 1,
        itemsRemoved: 0,
      });
    });

    it("keeps going after an engine throws, counting that resource as failed", async () => {
      let calls: number = 0;

      fakeDefinition({
        rule: labelRule(),
        resources: resources(3),
        apply: (): RuleApplicationResult => {
          calls++;

          if (calls === 2) {
            throw new Error("connection reset");
          }

          return RuleApplicationResultUtil.updated(1);
        },
      });

      const result: RuleRunPassResult = await runPass();

      expect(calls).toBe(3);
      expect(result.resourcesUpdated).toBe(2);
      expect(result.resourcesFailed).toBe(1);
    });
  });

  describe("owner notification", () => {
    it.each([
      [RuleRunType.HostOwnerRule, true, true, true],
      [RuleRunType.HostOwnerRule, true, undefined, true],
      [RuleRunType.HostOwnerRule, true, false, false],
      [RuleRunType.HostOwnerRule, false, true, false],
      [RuleRunType.HostLabelRule, true, true, false],
    ])(
      "%s with allow=%s and rule notify=%s reports notified=%s",
      async (
        ruleType: RuleRunType,
        allow: boolean,
        notifyOwners: boolean | undefined,
        expected: boolean,
      ) => {
        fakeDefinition({
          rule: labelRule({
            ownerUsers: [{ id: LABEL_ID }],
            notifyOwners: notifyOwners,
          }),
        });

        const result: RuleRunPassResult = await runPass({
          ruleType: ruleType,
          allowOwnerNotification: allow,
        });

        expect(result.ownersNotified).toBe(expected);
      },
    );
  });

  describe("status page monitor rules", () => {
    function mockStatusPageRule(rule: Partial<StatusPageMonitorRule> | null): {
      findOneBy: jest.SpyInstance;
      sync: jest.SpyInstance;
    } {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(StatusPageMonitorRuleService, "findOneBy")
        .mockResolvedValue(rule as never);
      const sync: jest.SpyInstance = jest
        .spyOn(StatusPageMonitorRuleEngineService, "syncResourcesForRule")
        .mockResolvedValue({
          monitorIdsAdded: ["a", "b"],
          statusPageResourceIdsRemoved: ["c"],
          statusPageResourceIdsUpdated: ["d", "e", "f"],
          monitorIdsReleased: ["c"],
        } as never);

      return { findOneBy: findOneBy, sync: sync };
    }

    it("re-syncs the page and reports what changed in a single pass", async () => {
      const mocks: {
        findOneBy: jest.SpyInstance;
        sync: jest.SpyInstance;
      } = mockStatusPageRule({ isEnabled: true });

      const result: RuleRunPassResult = await runPass({
        ruleType: RuleRunType.StatusPageMonitorRule,
        cursor: resourceId(5),
      });

      expect(result).toMatchObject({
        itemsAdded: 2,
        itemsRemoved: 1,
        resourcesUpdated: 3,
        nextCursor: null,
      });

      const query: Record<string, unknown> = (
        mocks.findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(String(query["_id"])).toBe(RULE_ID.toString());
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      expect(
        String(
          (
            mocks.sync.mock.calls[0]![0] as {
              statusPageMonitorRuleId: ObjectID;
            }
          ).statusPageMonitorRuleId,
        ),
      ).toBe(RULE_ID.toString());
    });

    it("refuses a status page monitor rule from another project or switched off", async () => {
      const missing: {
        findOneBy: jest.SpyInstance;
        sync: jest.SpyInstance;
      } = mockStatusPageRule(null);

      await expect(
        runPass({ ruleType: RuleRunType.StatusPageMonitorRule }),
      ).rejects.toThrow("Rule not found.");
      expect(missing.sync).not.toHaveBeenCalled();

      jest.restoreAllMocks();

      const disabled: {
        findOneBy: jest.SpyInstance;
        sync: jest.SpyInstance;
      } = mockStatusPageRule({ isEnabled: false });

      await expect(
        runPass({ ruleType: RuleRunType.StatusPageMonitorRule }),
      ).rejects.toThrow("This rule is disabled.");
      expect(disabled.sync).not.toHaveBeenCalled();
    });
  });

  /*
   * SLO monitor rules are self-syncing like status page monitor rules, but an
   * SLO's monitors are the union of every enabled rule of that SLO, so the
   * run hands the engine the rule's SLO - read off the project-pinned rule,
   * never off the request - and reports attach/detach counts in one pass.
   */
  describe("SLO monitor rules", () => {
    const SLO_ID: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    interface SloRuleMocks {
      findOneBy: jest.SpyInstance;
      sync: jest.SpyInstance;
      statusPageSync: jest.SpyInstance;
      getDefinition: jest.SpyInstance;
    }

    function mockSloRule(
      rule: Partial<ServiceLevelObjectiveMonitorRule> | null,
    ): SloRuleMocks {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(ServiceLevelObjectiveMonitorRuleService, "findOneBy")
        .mockResolvedValue(rule as never);
      const sync: jest.SpyInstance = jest
        .spyOn(
          ServiceLevelObjectiveMonitorRuleEngineService,
          "syncMonitorsForSlo",
        )
        .mockResolvedValue({
          monitorIdsAdded: ["a", "b", "c"],
          monitorIdsRemoved: ["d"],
        } as never);
      const statusPageSync: jest.SpyInstance = jest
        .spyOn(StatusPageMonitorRuleEngineService, "syncResourcesForRule")
        .mockResolvedValue({} as never);
      const getDefinition: jest.SpyInstance = jest.spyOn(
        RuleRunRegistry,
        "getDefinition",
      );

      return {
        findOneBy: findOneBy,
        sync: sync,
        statusPageSync: statusPageSync,
        getDefinition: getDefinition,
      };
    }

    it("re-syncs the rule's SLO and reports what changed in a single pass", async () => {
      const mocks: SloRuleMocks = mockSloRule({
        isEnabled: true,
        serviceLevelObjectiveId: SLO_ID,
      });

      const result: RuleRunPassResult = await runPass({
        ruleType: RuleRunType.ServiceLevelObjectiveMonitorRule,
        cursor: resourceId(5),
      });

      // Attach/detach counts only; there is nothing to walk or refresh.
      expect(result).toEqual({
        resourcesEvaluated: 0,
        resourcesMatched: 0,
        resourcesUpdated: 0,
        itemsAdded: 3,
        itemsRemoved: 1,
        resourcesFailed: 0,
        nextCursor: null,
        ownersNotified: false,
      });

      const args: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = mocks.findOneBy.mock.calls[0]![0] as never;

      expect(String(args.query["_id"])).toBe(RULE_ID.toString());
      expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(args.select).toMatchObject({
        isEnabled: true,
        serviceLevelObjectiveId: true,
      });
      expect(args.props).toEqual({ isRoot: true });

      expect(mocks.sync).toHaveBeenCalledTimes(1);
      expect(
        String(
          (
            mocks.sync.mock.calls[0]![0] as {
              serviceLevelObjectiveId: ObjectID;
            }
          ).serviceLevelObjectiveId,
        ),
      ).toBe(SLO_ID.toString());

      // Neither the resource walk nor the status page engine is involved.
      expect(mocks.getDefinition).not.toHaveBeenCalled();
      expect(mocks.statusPageSync).not.toHaveBeenCalled();
    });

    it("reports an SLO already in step as a pass that changed nothing", async () => {
      const mocks: SloRuleMocks = mockSloRule({
        isEnabled: true,
        serviceLevelObjectiveId: SLO_ID,
      });
      mocks.sync.mockResolvedValue({
        monitorIdsAdded: [],
        monitorIdsRemoved: [],
      } as never);

      const result: RuleRunPassResult = await runPass({
        ruleType: RuleRunType.ServiceLevelObjectiveMonitorRule,
      });

      expect(result).toMatchObject({
        itemsAdded: 0,
        itemsRemoved: 0,
        nextCursor: null,
      });
    });

    it("refuses an SLO monitor rule from another project or switched off", async () => {
      const missing: SloRuleMocks = mockSloRule(null);

      await expect(
        runPass({ ruleType: RuleRunType.ServiceLevelObjectiveMonitorRule }),
      ).rejects.toThrow("Rule not found.");
      expect(missing.sync).not.toHaveBeenCalled();

      jest.restoreAllMocks();

      const disabled: SloRuleMocks = mockSloRule({
        isEnabled: false,
        serviceLevelObjectiveId: SLO_ID,
      });

      await expect(
        runPass({ ruleType: RuleRunType.ServiceLevelObjectiveMonitorRule }),
      ).rejects.toThrow("This rule is disabled.");
      expect(disabled.sync).not.toHaveBeenCalled();
    });

    it("refuses a rule that names no SLO instead of syncing nothing", async () => {
      const mocks: SloRuleMocks = mockSloRule({ isEnabled: true });

      await expect(
        runPass({ ruleType: RuleRunType.ServiceLevelObjectiveMonitorRule }),
      ).rejects.toThrow("Rule not found.");
      expect(mocks.sync).not.toHaveBeenCalled();
    });
  });
});
